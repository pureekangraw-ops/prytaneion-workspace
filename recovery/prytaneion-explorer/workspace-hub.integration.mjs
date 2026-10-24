// Exact pinned Hub implementation, fixture upstream only. Never network to Drive.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {fixture,initial,command} from './workspace-continuity.fixture.mjs';
import {providerMcp} from './provider-mcp.mjs';
import {hash,WORKSPACE_TOOLS} from './workspace-continuity.mjs';
const root=process.env.HUB_SOURCE;if(!root)throw Error('HUB_SOURCE_REQUIRED');
const pinned='3da763a3083654fe69945da0e8e6d5e86eb706e3';assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),pinned);
const {privateHub}=await import(pathToFileURL(root+'/src/private.js'));
const {database}=await import(pathToFileURL(root+'/test/db.js'));
const goRoot=process.env.GO_SOURCE;if(!goRoot)throw Error('GO_SOURCE_REQUIRED');
const {default:goWorker}=await import(pathToFileURL(goRoot+'/worker/index.js'));
const {WORKSPACE_TOOLS:goSchema}=await import(pathToFileURL(goRoot+'/worker/workspace-catalog.mjs'));assert.deepEqual(goSchema,WORKSPACE_TOOLS);
const f=fixture(),endpoint='https://provider.example/hub-mcp/google';
const env={HUB_DB:database(),ALLOWED_ORIGINS:'https://provider.example',MANAGED_CONNECTORS:JSON.stringify([{id:'google',name:'Google',protocol:'mcp',endpoint}]),SERVICE_ENDPOINTS:JSON.stringify({[endpoint]:'PROVIDER'}),PROVIDER:{fetch:r=>providerMcp(r,f.env,f.fetcher)}};
let hub=privateHub(env,()=>{throw Error('NO_NETWORK')});
await hub.connections();let counter=0;const receipts=[];
async function call(name,payload){
 const context={access:{aud:'fixture-aud',getIdentity:async()=>({email:'owner@example.test'})}};
 const request=new Request('https://go-together.pureekangraw.workers.dev/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:++counter,method:'tools/call',params:{name:'google_workspace_'+name,arguments:payload}})});
 const response=await goWorker.fetch(request,{ACCESS_AUD:'fixture-aud',OWNER_EMAIL:'owner@example.test',HUB_V2:hub},context);
 assert.equal(response.status,200);const rpc=await response.json();assert.ok(!rpc.result.isError,JSON.stringify(rpc));
 const result=JSON.parse(rpc.result.content[0].text);assert.equal(result._hubReceipt.state,'RESPONDED');assert.equal(result._hubReceipt.taskSuccess,null);receipts.push(result._hubReceipt.messageId);delete result._hubReceipt;return result;
}
const first=await call('write',command());assert.equal(first.receipt.version,1);
const replay=await call('write',command());assert.equal(replay.duplicate,true);assert.equal(replay.receipt.fileId,first.receipt.fileId);
hub=privateHub(env,()=>{throw Error('NO_NETWORK')}); // new caller context, same durable source
const resumed=await call('read',{workId:'WORK-ONE'});assert.deepEqual(resumed.manifest,initial());
const transferred={...resumed.manifest,currentWriter:'ATLAS',writerEpoch:1,checkpoint:'CP-2',nextAction:'Synthetic artifact'};
await call('write',command(transferred,{writeRequestId:'handoff',expectedVersion:1}));
const artifactText='workspace-continuity-ok';const manifest={...transferred,checkpoint:'CP-3',artifact:{reference:'fixture://result',sha256:await hash(artifactText)},nextAction:'Owner review'};
const written=await call('write',command(manifest,{writeRequestId:'result',writer:'ATLAS',expectedVersion:2,expectedEpoch:1,artifactText}));
const readback=await call('read',{workId:'WORK-ONE',version:3});assert.deepEqual(readback,written);assert.equal(readback.artifactText,artifactText);
assert.deepEqual(await call('receipt',{workId:'WORK-ONE',writeRequestId:'result'}),written.receipt);
console.log(JSON.stringify({scope:'GO_PINNED_HUB_PROVIDER_SQLITE_DRIVE_FIXTURE_NOT_LIVE',hubHead:pinned,workId:'WORK-ONE',transportReceipts:receipts,sourceReceipt:written.receipt,artifactText},null,2));f.db.close();
