import { boardView, WORK_STATUS, openWorkPass, returnWork, validateWorkRecord } from "./go-hub-centre-v4.js";
import { HEIMDALL_HEALTH, cardCompleteness, workCardView, workProfile } from "./go-hub-work-card.js";

function text(v){return String(v??"").trim();}
function lower(v){return text(v).toLowerCase();}
function clone(v){return v==null?v:structuredClone(v);}
function freeze(v){if(v&&typeof v==="object"&&!Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const PROJECT_TYPES=Object.freeze(["WORK_CENTRE","FACTORY","MAINTENANCE"]);

function projectBoard(works){
  return freeze(works.flatMap(w => PROJECT_TYPES.map(type => {
    const ref=w.projectRefs?.[type]||null;
    return {projectType:type,projectRef:ref?.ref||null,status:ref?.status||w.status,destination:ref?.destination||w.destination||null,workspace:ref?.workspace||null,workId:w.workId,lastUpdated:ref?.lastUpdated||w.lastUpdated};
  })));
}

function supportBoardView(missions=[]){
  const rows=(Array.isArray(missions)?missions:[]).map(item=>{
    const rooms=Array.isArray(item?.roomStates)?item.roomStates:[];
    const finishedRooms=rooms.filter(r=>r?.session?.status==="FINISHED").length;
    const activeRooms=rooms.filter(r=>r?.session?.status==="ACTIVE").length;
    const evidenceCount=rooms.reduce((sum,r)=>sum+(r?.session?.evidenceRefs?.length||0),0);
    const unknownCount=rooms.reduce((sum,r)=>sum+(r?.session?.unknowns?.length||0),0);
    const status=item?.status==="FINISHED"?"FINISHED":
      finishedRooms===rooms.length&&rooms.length?"READY_FOR_GO":
      finishedRooms>0?"PARTIAL":
      activeRooms>0?"ACTIVE":text(item?.status)||"UNKNOWN";
    return {
      missionId:text(item?.missionId)||null,
      mission:text(item?.mission)||null,
      requestedResult:text(item?.requestedResult)||null,
      status,
      priority:text(item?.priority).toUpperCase()||"NORMAL",
      dependencies:Array.isArray(item?.dependencies)?item.dependencies.map(text).filter(Boolean):[],
      assignedRooms:Array.isArray(item?.assignedRooms)?item.assignedRooms.map(text).filter(Boolean):[],
      finishedRooms,totalRooms:rooms.length,evidenceCount,unknownCount,
      rooms:rooms.map(r=>({
        roomId:text(r?.roomId)||null,
        status:text(r?.session?.status)||"UNKNOWN",
        evidenceCount:r?.session?.evidenceRefs?.length||0,
        unknownCount:r?.session?.unknowns?.length||0,
        finalResult:clone(r?.session?.finalResult??null),
      })),
      startedAt:item?.startedAt||null,finishedAt:item?.finishedAt||null,
    };
  });
  return freeze({
    projectionOnly:true,
    generatedFor:"GO",
    counts:{
      missions:rows.length,
      active:rows.filter(x=>x.status==="ACTIVE").length,
      partial:rows.filter(x=>x.status==="PARTIAL").length,
      readyForGo:rows.filter(x=>x.status==="READY_FOR_GO").length,
      finished:rows.filter(x=>x.status==="FINISHED").length,
      unknowns:rows.reduce((sum,x)=>sum+x.unknownCount,0),
    },
    cards:rows,
  });
}

function supportBoardTargets(missions=[],{maxConcurrent=3}={}){
  const list=Array.isArray(missions)?missions:[];
  const rank={URGENT:3,HIGH:2,NORMAL:1,LOW:0};
  const completed=new Set(list.filter(m=>text(m?.status).toUpperCase()==="FINISHED").map(m=>text(m?.missionId)).filter(Boolean));
  const candidates=list
    .filter(m=>text(m?.status).toUpperCase()!=="FINISHED")
    .map(m=>{
      const dependencies=Array.isArray(m?.dependencies)?m.dependencies.map(text).filter(Boolean):[];
      const blockedBy=dependencies.filter(id=>!completed.has(id));
      return {
        missionId:text(m?.missionId)||null,
        mission:text(m?.mission)||null,
        priority:text(m?.priority).toUpperCase()||"NORMAL",
        blockedBy,
        runnable:blockedBy.length===0,
      };
    })
    .sort((a,b)=>{
      if(a.runnable!==b.runnable)return a.runnable?-1:1;
      return (rank[b.priority]||0)-(rank[a.priority]||0);
    });
  const limit=Math.max(0,Number(maxConcurrent)||0);
  return freeze({
    runnable:candidates.filter(x=>x.runnable).slice(0,limit),
    waiting:candidates.filter(x=>!x.runnable),
  });
}

function searchable(work){
  const card=workCardView(work);
  return [
    work.workId,card.jobCode,work.name,work.command,work.status,card.status,work.workType,
    work.holder,work.waitReason,work.destination,...card.destinations,...card.scope,
  ].map(lower).filter(Boolean);
}
function matchesFilters(work,filters={}){
  const card=workCardView(work);
  const identity=lower(filters.identity||filters.workId||filters.jobCode);
  if(identity&&lower(work.workId)!==identity&&lower(card.jobCode)!==identity)return false;
  const status=lower(filters.status||filters.action);
  if(status&&lower(work.status)!==status&&lower(card.status)!==status)return false;
  const destination=lower(filters.destination);
  if(destination&&!card.destinations.some(value=>lower(value)===destination))return false;
  const scope=lower(filters.scope);
  if(scope&&!card.scope.some(value=>lower(value)===scope||lower(value).includes(scope)))return false;
  const type=lower(filters.type||filters.workType);
  if(type&&lower(card.type)!==type)return false;
  const q=lower(filters.query);
  if(q&&!searchable(work).some(value=>value.includes(q)))return false;
  return true;
}
function sortWorks(works){
  return [...works].sort((a,b)=>{
    const bt=Date.parse(text(b.lastUpdated||b.createdAt));
    const at=Date.parse(text(a.lastUpdated||a.createdAt));
    if(Number.isFinite(bt)&&Number.isFinite(at)&&bt!==at)return bt-at;
    return text(a.workId).localeCompare(text(b.workId));
  });
}
function resolveFrom(works,identity){
  const key=lower(identity);
  if(!key)throw new Error("WORK_IDENTITY_REQUIRED");
  const matches=works.filter(work=>lower(work.workId)===key||lower(workCardView(work).jobCode)===key);
  if(matches.length>1)throw new Error("WORK_IDENTITY_AMBIGUOUS");
  return matches.length?clone(matches[0]):null;
}
function scanWorks(works,{at=new Date().toISOString(),staleAfterMs=0}={}){
  const cautions=[];
  const codeMap=new Map();
  for(const work of works){
    const card=workCardView(work);
    const completeness=cardCompleteness(card);
    if(!completeness.complete){
      cautions.push({workId:work.workId,jobCode:card.jobCode,kind:"INCOMPLETE_CARD",missing:[...completeness.missing]});
    }
    const list=codeMap.get(card.jobCode)||[];
    list.push(work.workId);codeMap.set(card.jobCode,list);
    if(work.status===WORK_STATUS.ON_PROCESS&&!text(work.holder)){
      cautions.push({workId:work.workId,jobCode:card.jobCode,kind:"ACTIVE_WITHOUT_HOLDER"});
    }
    if(Number(staleAfterMs)>0&&[WORK_STATUS.OPEN,WORK_STATUS.ON_PROCESS,WORK_STATUS.WAIT_CONFIRM].includes(work.status)){
      const last=Date.parse(text(work.lastUpdated||work.createdAt));
      const now=Date.parse(text(at));
      if(Number.isFinite(last)&&Number.isFinite(now)&&now-last>=Number(staleAfterMs)){
        cautions.push({workId:work.workId,jobCode:card.jobCode,kind:"STALE",lastUpdated:work.lastUpdated||work.createdAt});
      }
    }
  }
  for(const [jobCode,workIds] of codeMap){
    if(workIds.length>1)cautions.push({jobCode,kind:"DUPLICATE_JOB_CODE",workIds:[...workIds]});
  }
  return freeze({health:cautions.length?HEIMDALL_HEALTH.CAUTION:HEIMDALL_HEALTH.NORMAL,cautions});
}
function reportFor(works,scanOptions={}){
  const items=boardView(works);
  const cards=items.map(item=>item.card);
  const scan=scanWorks(works,scanOptions);
  return freeze({
    health:scan.health,
    cautions:scan.cautions,
    items,
    cards,
    projectBoard:projectBoard(works),
    counts:Object.values(WORK_STATUS).reduce((o,s)=>(o[s]=items.filter(x=>x.status===s).length,o),{}),
    cardCounts:["Work","Resume","Done","Cancel"].reduce((o,s)=>(o[s]=cards.filter(x=>x.status===s).length,o),{}),
    active:items.filter(x=>x.status===WORK_STATUS.ON_PROCESS),
    waiting:items.filter(x=>x.status===WORK_STATUS.WAIT_CONFIRM),
    resumable:items.filter(x=>[WORK_STATUS.OPEN,WORK_STATUS.WAIT_CONFIRM].includes(x.status)),
  });
}

export function createHeimdallV4({works=[],workIndex=null}={}){
  const store=new Map(works.map(w=>[w.workId,clone(w)]));
  const source=workIndex||null;
  async function hydrate(){if(source?.all){for(const w of await source.all())store.set(w.workId,clone(w));}return [...store.values()];}
  async function persist(w){validateWorkRecord(w);store.set(w.workId,clone(w));if(source?.replace)await source.replace(w);return clone(w);}
  return Object.freeze({
    hydrate,
    get(workId){return clone(store.get(text(workId))||null);},
    async resolve(identity){const all=await hydrate();return resolveFrom(all,identity);},
    async profile(identity){const work=await this.resolve(identity);return work?workProfile(work):null;},
    async put(work){if(!work?.workId)throw new Error("Work ID is required");if(store.has(work.workId)&&JSON.stringify(store.get(work.workId))!==JSON.stringify(work))throw new Error("DUPLICATE_WORK_ID");return persist(work);},
    async search(query=""){const all=await hydrate();const q=lower(query);return sortWorks(all.filter(w=>!q||searchable(w).some(value=>value.includes(q)))).map(clone);},
    async lookup(filters={}){const all=await hydrate();return sortWorks(all.filter(work=>matchesFilters(work,filters))).map(clone);},
    async active(){await hydrate();return sortWorks([...store.values()].filter(w=>w.status===WORK_STATUS.ON_PROCESS)).map(clone);},
    async waiting(){await hydrate();return sortWorks([...store.values()].filter(w=>w.status===WORK_STATUS.WAIT_CONFIRM)).map(clone);},
    async resumable(){await hydrate();return sortWorks([...store.values()].filter(w=>[WORK_STATUS.OPEN,WORK_STATUS.WAIT_CONFIRM].includes(w.status))).map(clone);},
    async scan(options={}){const all=await hydrate();return scanWorks(all,options);},
    async openPass(workId,input={}){const w=store.get(text(workId));if(!w)throw new Error("WORK_NOT_FOUND");return persist(openWorkPass(w,{...input,actor:input.holder||input.actor}));},
    async closePass(workId,input={}){const w=store.get(text(workId));if(!w)throw new Error("WORK_NOT_FOUND");return persist(returnWork(w,{...input,actor:input.holder||input.actor}));},
    async board(){await hydrate();return boardView(sortWorks([...store.values()]));},
    async projectBoard(){await hydrate();return projectBoard(sortWorks([...store.values()]));},
    supportBoard(missions=[]){return supportBoardView(missions);},
    supportTargets(missions=[],options={}){return supportBoardTargets(missions,options);},
    async report(options={}){const all=await hydrate();return reportFor(sortWorks(all),options);},
    warp({workId,destination,owner,at=new Date().toISOString()}={}){const w=store.get(text(workId));if(!w)throw new Error("WORK_NOT_FOUND");const next=clone(w);next.destination=text(destination)||next.destination;next.destinationOwner=text(owner)||null;next.lastUpdated=at;store.set(next.workId,next);return freeze({workId:next.workId,destination:next.destination,owner:next.destinationOwner,projectRefs:clone(next.projectRefs||{}),lastUpdated:at,routeArchitecture:"UNCHANGED"});}
  });
}

export function createThinHeimdall({works=[]}={}){
  const store=new Map(works.map(w=>[w.workId,clone(w)]));
  const values=()=>[...store.values()];
  const syncBoard=()=>boardView(sortWorks(values()));
  return freeze({
    put(work){if(!work?.workId)throw new Error("Work ID is required");if(store.has(work.workId)&&JSON.stringify(store.get(work.workId))!==JSON.stringify(work))throw new Error("DUPLICATE_WORK_ID");store.set(work.workId,clone(work));return clone(work);},
    get(workId){return clone(store.get(text(workId))||null);},
    resolve(identity){return resolveFrom(values(),identity);},
    profile(identity){const work=resolveFrom(values(),identity);return work?workProfile(work):null;},
    search(query=""){const q=lower(query);return sortWorks(values().filter(w=>!q||searchable(w).some(value=>value.includes(q)))).map(clone);},
    lookup(filters={}){return sortWorks(values().filter(work=>matchesFilters(work,filters))).map(clone);},
    scan(options={}){return scanWorks(values(),options);},
    board:syncBoard,
    projectBoard:()=>projectBoard(sortWorks(values())),
    supportBoard:missions=>supportBoardView(missions),
    supportTargets:(missions,options={})=>supportBoardTargets(missions,options),
    report(options={}){return reportFor(sortWorks(values()),options);}
  });
}
export { projectBoard, supportBoardView, supportBoardTargets, PROJECT_TYPES, scanWorks, reportFor };
