import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {providerCall,providerMcp} from './provider-mcp.mjs';
import {hash} from './workspace-continuity.mjs';
const root='1z7oD62E_zdJe9gbl6ZoA4brtcoPeykSq',folder='1zXE9WehOb_dE1M53wUfb6AipWaIs-auK';
export function fixture(path=':memory:'){
 const db=new DatabaseSync(path);db.exec('CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, metadata TEXT, content TEXT);CREATE TABLE IF NOT EXISTS ids(n INTEGER PRIMARY KEY AUTOINCREMENT);');
 const state={mode:null,creates:0,calls:[],folderParent:root};
 async function fetcher(url,options={}){
  state.calls.push({url,method:options.method||'GET'});
  assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,'Bearer SYNTHETIC_ONLY');
  const u=new URL(url);assert.equal(u.origin,'https://www.googleapis.com');
  if(u.pathname.endsWith('/generateIds')){const n=db.prepare('INSERT INTO ids DEFAULT VALUES').run().lastInsertRowid;return Response.json({ids:['generated_id_'+n]});}
  if(options.method==='POST'){
   assert.equal(u.pathname,'/upload/drive/v3/files');state.creates++;
   const text=await options.body.text(),boundary=options.headers['content-type'].split('boundary=')[1];
   const chunks=text.split('--'+boundary);const metadata=JSON.parse(chunks[1].split('\r\n\r\n')[1].trim());const content=chunks[2].split('\r\n\r\n')[1].trim();
   assert.deepEqual(metadata.parents,[folder]);assert.equal(metadata.mimeType,'application/json');
   if(state.mode==='before'){state.mode=null;throw Error('synthetic interruption before insert');}
   try{db.prepare('INSERT INTO files VALUES(?,?,?)').run(metadata.id,JSON.stringify(metadata),content);}catch(e){if(e.errcode===1555||String(e).includes('UNIQUE'))return Response.json({}, {status:409});throw e;}
   if(state.mode==='after'){state.mode=null;throw Error('synthetic lost upload response');}
   return Response.json({id:metadata.id});
  }
  const id=u.pathname.split('/').at(-1);
  if(id===folder)return Response.json({id,parents:[state.folderParent],mimeType:'application/vnd.google-apps.folder'});
  const row=db.prepare('SELECT * FROM files WHERE id=?').get(id);if(!row)return Response.json({}, {status:404});
  if(u.searchParams.get('alt')==='media')return new Response(row.content);
  return Response.json({...JSON.parse(row.metadata),size:String(Buffer.byteLength(row.content))});
 }
 const env={GO_HUB_DIRECT_GOOGLE_ACCESS_TOKEN:'SYNTHETIC_ONLY',WORKSPACE_CONTINUITY_CONFIG:JSON.stringify({workId:'WORK-ONE',rootFileId:'root_file_id_01',initialWriter:'GO',writers:['GO','ATLAS']})};
 const call=(name,args)=>providerCall(env,'google','google_workspace_'+name,args,fetcher);
 return {db,state,env,fetcher,call};
}
export const initial=()=>({workId:'WORK-ONE',zone:'ZONE_2',blueprintVersion:'workspace-v1',source:{repo:'https://github.com/example/synthetic',branch:'fixture',commit:'a'.repeat(40)},live:null,currentWriter:'GO',writerEpoch:0,checkpoint:'CP-1',evidence:[{status:'PENDING',reference:'fixture://acceptance',scope:'synthetic only'}],artifact:null,nextAction:'Handoff to ATLAS'});
export const command=(manifest=initial(),extra={})=>({workId:'WORK-ONE',writeRequestId:'req-1',writer:'GO',expectedVersion:0,expectedEpoch:0,manifest,artifactText:null,approved:true,...extra});
