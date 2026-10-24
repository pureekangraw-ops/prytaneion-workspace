import test from 'node:test';
import assert from 'node:assert/strict';
import {providerMcp,providerCall} from './provider-mcp.mjs';
test('MCP discovery is per provider and never includes secrets or arbitrary proxy',async()=>{
 for(const group of ['github','cloudflare','notion','google']){
 const r=await providerMcp(new Request('https://adapter/hub-mcp/'+group,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}),{GO_HUB_DIRECT_GITHUB_TOKEN:'secret-value'});
 const text=await r.text();assert.doesNotMatch(text,/secret-value|PANTHEON/);assert.ok(JSON.parse(text).result.tools.every(t=>t.name.startsWith(group+'_')));
 }
});
test('fixed GitHub route refuses path escapes and forwards original API errors',async()=>{
 const env={GO_HUB_DIRECT_GITHUB_TOKEN:'test-secret'};let count=0;
 const fetcher=async(url,init)=>{count++;assert.equal(url,'https://api.github.com/repos/owner/repo');assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer test-secret');return Response.json({message:'Not Found'},{status:404});};
 await assert.rejects(providerCall(env,'github','github_file',{repo:'owner/repo',path:'../bad'},fetcher),/INVALID_PATH/);assert.equal(count,0);
 const out=await providerCall(env,'github','github_repo',{repo:'owner/repo'},fetcher);assert.equal(out.upstream_status,404);assert.deepEqual(out.body,{message:'Not Found'});
});
test('Notion sends declared version and bounded paging without caller URLs',async()=>{
 const env={GO_HUB_DIRECT_NOTION_TOKEN:'notion-secret'};
 const out=await providerCall(env,'notion','notion_search',{query:'YGG',page_size:5},async(url,init)=>{assert.equal(url,'https://api.notion.com/v1/search');assert.equal(init.headers['notion-version'],'2026-03-11');assert.deepEqual(JSON.parse(init.body),{query:'YGG',page_size:5});return Response.json({results:[],has_more:false});});assert.equal(out.ok,true);
 await assert.rejects(providerCall(env,'notion','notion_search',{url:'https://evil.example'}),/INVALID_ARGUMENTS/);
});
test('Cloudflare account comes only from binding and redirects never forward credentials',async()=>{
 const env={GO_HUB_DIRECT_CLOUDFLARE_TOKEN:'cf-secret',GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
 let calls=0;await assert.rejects(providerCall(env,'cloudflare','cloudflare_worker',{script:'safe'},async(url)=>{calls++;assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+env.GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/safe/deployments');return new Response(null,{status:302,headers:{location:'https://evil.example'}});}),/REDIRECT_REFUSED/);assert.equal(calls,1);
});
