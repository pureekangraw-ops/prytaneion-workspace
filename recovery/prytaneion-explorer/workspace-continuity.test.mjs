import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {providerCall,providerMcp} from './provider-mcp.mjs';
import {hash} from './workspace-continuity.mjs';
import {fixture,initial,command} from './workspace-continuity.fixture.mjs';
test('same Work ID: GO checkpoint → durable restart → handoff → ATLAS result → exact version/receipt/artifact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'continuity-'));let f=fixture(join(dir,'drive.sqlite'));
 try{
 const first=await f.call('write',command());assert.equal(first.receipt.version,1);f.db.close();f=fixture(join(dir,'drive.sqlite'));
 const read=await f.call('read',{workId:'WORK-ONE'});assert.deepEqual(read.manifest,initial());
 const transferred={...read.manifest,currentWriter:'ATLAS',writerEpoch:1,checkpoint:'CP-2',nextAction:'Produce synthetic result'};
 await f.call('write',command(transferred,{writeRequestId:'handoff',expectedVersion:1}));
 const artifactText='workspace-continuity-ok',sha=await hash(artifactText);
 const result={...transferred,checkpoint:'CP-3',artifact:{reference:'fixture://result.txt',sha256:sha},evidence:[{status:'VERIFIED',reference:'fixture://result.txt',scope:'literal output only'}],nextAction:'Owner reviews result'};
 const final=await f.call('write',command(result,{writeRequestId:'result',writer:'ATLAS',expectedVersion:2,expectedEpoch:1,artifactText}));
 assert.equal(final.artifactText,artifactText);assert.equal(final.receipt.artifactHash,sha);assert.equal(final.receipt.execution,'NOT_ASSERTED');assert.equal(final.receipt.artifactReadback,'INLINE_SHA256_VERIFIED');
 assert.deepEqual(await f.call('receipt',{workId:'WORK-ONE',writeRequestId:'result'}),final.receipt);
 assert.deepEqual((await f.call('read',{workId:'WORK-ONE',version:1})).manifest,initial());
 }finally{f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('concurrent writers contend atomically on same pre-generated file ID, one winner',async()=>{
 const f=fixture();try{const results=await Promise.allSettled([f.call('write',command()),f.call('write',command({...initial(),checkpoint:'OTHER'},{writeRequestId:'other'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);}finally{f.db.close();}
});
test('idempotent replay, changed request collision, stale version and stale writer rejected',async()=>{
 const f=fixture();try{await f.call('write',command());const creates=f.state.creates;assert.equal((await f.call('write',command())).duplicate,true);assert.equal(f.state.creates,creates);
 await assert.rejects(f.call('write',command({...initial(),checkpoint:'changed'})),/IDEMPOTENCY_CONFLICT/);
 await f.call('write',command({...initial(),currentWriter:'ATLAS',writerEpoch:1},{writeRequestId:'handoff',expectedVersion:1}));
 await assert.rejects(f.call('write',command(initial(),{writeRequestId:'stale',expectedVersion:2})),/STALE_WRITER/);
 await assert.rejects(f.call('write',command(initial(),{writeRequestId:'old-version'})),/VERSION_CONFLICT/);
 }finally{f.db.close();}
});
test('interrupted writes reconcile committed slot; pre-commit loss retries same slot without duplicates',async()=>{
 for(const mode of ['before','after']){const f=fixture();try{f.state.mode=mode;
 if(mode==='before'){await assert.rejects(f.call('write',command()),/WRITE_UNCERTAIN/);assert.equal((await f.call('receipt',{workId:'WORK-ONE',writeRequestId:'req-1'})).status,'NOT_FOUND');}
 else assert.equal((await f.call('write',command())).receipt.version,1);
 const final=await f.call('write',command());assert.equal(final.receipt.fileId,'root_file_id_01');assert.equal(f.db.prepare('SELECT count(*) n FROM files').get().n,1);
 }finally{f.db.close();}}
});
test('scope, approval, artifact hash, epoch and missing configuration fail closed',async()=>{
 const f=fixture();try{
 await assert.rejects(f.call('write',command(initial(),{approved:false})),/APPROVAL_REQUIRED/);
 await assert.rejects(f.call('write',command(initial(),{workId:'OTHER'})),/SCOPE_DENIED/);
 await assert.rejects(f.call('write',command(initial(),{artifactText:'bad'})),/ARTIFACT_MISMATCH/);
 await assert.rejects(f.call('write',command({...initial(),currentWriter:'ATLAS',writerEpoch:0})),/STALE_WRITER/);
 f.state.folderParent='RECOVERY-VAULT';await assert.rejects(f.call('read',{workId:'WORK-ONE'}),/SCOPE_DENIED/);assert.equal(f.state.creates,0);
 await assert.rejects(providerCall({},'google','google_workspace_read',{workId:'WORK-ONE'},f.fetcher),/NOT_CONFIGURED/);
 }finally{f.db.close();}
});
test('stored tampering is rejected and unsupported args never become a Drive proxy',async()=>{
 const f=fixture();try{await f.call('write',command());f.db.prepare('UPDATE files SET content=?').run('{"record":{},"sha256":"bad"}');await assert.rejects(f.call('read',{workId:'WORK-ONE'}),/CHAIN_INVALID/);
 await assert.rejects(f.call('read',{workId:'WORK-ONE',url:'https://evil'}),/INVALID_ARGUMENTS/);
 }finally{f.db.close();}
});
test('existing private Google MCP discovers and calls bounded Workspace operations',async()=>{
 const f=fixture();try{const call=async(method,params)=>{const r=await providerMcp(new Request('https://provider/hub-mcp/google',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env,f.fetcher);return r.json();};
 const list=await call('tools/list');assert.ok(list.result.tools.some(t=>t.name==='google_workspace_write'));
 const written=await call('tools/call',{name:'google_workspace_write',arguments:command()});const data=JSON.parse(written.result.content[0].text);assert.equal(data.receipt.version,1);
 assert.ok(!JSON.stringify(written).includes('SYNTHETIC_ONLY'));
 }finally{f.db.close();}
});
