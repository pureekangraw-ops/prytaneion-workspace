import {workspaceAdapter} from './workspace-continuity.mjs';
import { PROVIDER_TOOLS } from './provider-catalog.mjs';
import { probeDirectProvider } from './read-service.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
async function bounded(response,max=524288){
 const reader=response.body?.getReader(); if(!reader)return '';
 let size=0;const parts=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('UPSTREAM_RESPONSE_TOO_LARGE');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let n=0;for(const p of parts){bytes.set(p,n);n+=p.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
const valid=(x,re)=>typeof x==='string'&&re.test(x);
const repoRE=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const idRE=/^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i;
export async function providerCall(env,group,name,args={},fetcher=fetch){
 const definition=PROVIDER_TOOLS[group]?.find(t=>t.name===name);if(!definition)throw Error('UNKNOWN_TOOL');
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(definition.inputSchema.properties,k)))throw Error('INVALID_ARGUMENTS');
 if(group==='google'&&name.startsWith('google_workspace_')){const adapter=workspaceAdapter(env,fetcher);return adapter[name.slice('google_workspace_'.length)](args);}
 if(name.endsWith('_status'))return probeDirectProvider(env,group,fetcher);
 const key={github:'GO_HUB_DIRECT_GITHUB_TOKEN',cloudflare:'GO_HUB_DIRECT_CLOUDFLARE_TOKEN',notion:'GO_HUB_DIRECT_NOTION_TOKEN'}[group];
 const token=env[key];if(!valid(token,/^[\x21-\x7e]{1,8192}$/))throw Error('CREDENTIAL_UNAVAILABLE');
 const headers={authorization:'Bearer '+token,accept:'application/json'};
 let url,method='GET',body;
 if(group==='github'){
  if(!valid(args.repo,repoRE))throw Error('INVALID_REPOSITORY');
  headers['user-agent']='YGG-Provider-Adapter';headers['x-github-api-version']='2022-11-28';headers.accept='application/vnd.github+json';
  url='https://api.github.com/repos/'+args.repo;
  if(name==='github_file'){
   if(!valid(args.path,/^[^\x00-\x1f\\]{1,300}$/)||args.path.startsWith('/')||args.path.split('/').some(p=>['..','.',''].includes(p)))throw Error('INVALID_PATH');
   if(args.ref!==undefined&&!valid(args.ref,/^[^\x00-\x1f]{1,120}$/))throw Error('INVALID_REF');
   url+='/contents/'+args.path.split('/').map(encodeURIComponent).join('/');if(args.ref)url+='?ref='+encodeURIComponent(args.ref);
  }
 }else if(group==='cloudflare'){
  const account=env.GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID;if(!valid(account,/^[a-f0-9]{32}$/))throw Error('ACCOUNT_NOT_CONFIGURED');
  url='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts';
  if(name==='cloudflare_worker'){if(!valid(args.script,/^[a-zA-Z0-9_-]{1,100}$/))throw Error('INVALID_SCRIPT');url+='/'+encodeURIComponent(args.script)+'/deployments';}
 }else if(group==='notion'){
  headers['notion-version']='2026-03-11';url='https://api.notion.com/v1/';
  if(args.page_size!==undefined&&(!Number.isInteger(args.page_size)||args.page_size<1||args.page_size>100))throw Error('INVALID_PAGE_SIZE');
  if(args.start_cursor!==undefined&&!valid(args.start_cursor,/^[^\x00-\x1f]{1,300}$/))throw Error('INVALID_CURSOR');
  if(name==='notion_search'){
   if(args.query!==undefined&&(typeof args.query!=='string'||args.query.length>200))throw Error('INVALID_QUERY');
   url+='search';method='POST';headers['content-type']='application/json';body=JSON.stringify({...args,page_size:args.page_size||20});
  }else{
   const id=name==='notion_page'?args.page_id:args.block_id;if(!valid(id,idRE))throw Error('INVALID_NOTION_ID');
   url+=(name==='notion_page'?'pages/'+id:'blocks/'+id+'/children');
   if(name==='notion_children'){const q=new URLSearchParams({page_size:String(args.page_size||20)});if(args.start_cursor)q.set('start_cursor',args.start_cursor);url+='?'+q;}
  }
 }else throw Error('UNSUPPORTED_PROVIDER');
 const r=await fetcher(url,{method,headers,body,redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(r.status>=300&&r.status<400){await r.body?.cancel();throw Error('UPSTREAM_REDIRECT_REFUSED');}
 const raw=await bounded(r);let data;try{data=JSON.parse(raw);}catch{data=raw;}
 if(name==='github_file'&&r.ok&&(data.type!=='file'||data.size>100000||data.encoding!=='base64'))throw Error('UNSUPPORTED_FILE');
 return {ok:r.ok,upstream_status:r.status,body:data};
}
export async function providerMcp(req,env,fetcher=fetch){
 const group=new URL(req.url).pathname.match(/^\/hub-mcp\/(github|cloudflare|notion|google)$/)?.[1];
 if(!group)return json({error:'NOT_FOUND'},404);if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 let x;try{x=JSON.parse(await bounded(req,262144));}catch{return json({error:'INVALID_JSON'},400);}
 if(x.method==='notifications/initialized')return new Response(null,{status:202});
 const reply=result=>json({jsonrpc:'2.0',id:x.id,result});
 if(x.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'ygg-'+group+'-adapter',version:'1.0.0'}});
 if(x.method==='tools/list')return reply({tools:PROVIDER_TOOLS[group]});
 if(x.method==='tools/call'){
  try{return reply({content:[{type:'text',text:JSON.stringify(await providerCall(env,group,x.params?.name,x.params?.arguments,fetcher))}]});}
  catch(e){return reply({isError:true,content:[{type:'text',text:/^[A-Z_]+$/.test(e.message)?e.message:'PROVIDER_UNAVAILABLE'}]});}
 }
 return json({jsonrpc:'2.0',id:x.id,error:{code:-32601,message:'Method not found'}});
}
