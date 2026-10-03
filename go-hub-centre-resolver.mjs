function text(v){return String(v??"").trim();}
function norm(v){return text(v).toLowerCase().replace(/[^a-z0-9ก-๙]+/g," ").replace(/\s+/g," ").trim();}
function tokens(v){return [...new Set(norm(v).split(" ").filter(Boolean))];}
function values(work){
  return [work?.workId,work?.checkpointId,work?.jobCode,work?.name,work?.command,work?.status,work?.workType,work?.destination,...(work?.scope||[]),...(work?.requestedDestinations||[])].filter(Boolean);
}
function exactKeys(work){
  return [work?.workId,work?.checkpointId,work?.jobCode,work?.name,work?.command].map(norm).filter(Boolean);
}
function similarity(query,work){
  const q=norm(query), qt=tokens(query);
  if(!q||!qt.length)return 0;
  const hay=values(work).map(norm);
  if(hay.includes(q))return 1;
  let score=0;
  for(const value of hay){
    if(!value)continue;
    if(value.includes(q)||q.includes(value))score=Math.max(score,0.82);
    const vt=new Set(tokens(value));
    const overlap=qt.filter(t=>vt.has(t)).length;
    if(overlap){
      const union=new Set([...qt,...vt]).size;
      score=Math.max(score,overlap/Math.max(1,union));
    }
  }
  if(["OPEN","ON PROCESS","WAIT CONFIRM"].includes(text(work?.status).toUpperCase()))score=Math.min(1,score+0.08);
  return score;
}
function view(work,score=null){
  return {
    workId:work.workId,
    checkpointId:work.checkpointId||null,
    jobCode:work.jobCode||null,
    name:work.name||null,
    command:work.command||null,
    status:work.status||null,
    workType:work.workType||null,
    ...(score==null?{}:{score:Number(score.toFixed(3))}),
  };
}

export function resolveCentreWork(works=[],input={}){
  const list=Array.isArray(works)?works:[];
  const explicit=[input.workId,input.checkpointId,input.jobCode].map(norm).filter(Boolean);
  const query=norm(input.query||input.name||input.command||"");
  if(!explicit.length&&!query) throw Object.assign(new Error("CENTRE_RESOLVE_QUERY_REQUIRED"),{status:400});

  const exact=list.filter(work=>{
    const keys=exactKeys(work);
    return explicit.some(v=>keys.includes(v)) || (query && keys.includes(query));
  });
  if(exact.length===1){
    return {ok:true,status:"RESOLVED",match:"EXACT",work:view(exact[0]),candidates:[],createAllowed:false,nextAction:"RESUME_EXISTING"};
  }
  if(exact.length>1){
    return {ok:true,status:"AMBIGUOUS",match:"EXACT",work:null,candidates:exact.map(x=>view(x,1)),createAllowed:false,nextAction:"CHOOSE_EXISTING"};
  }

  const searchText=query||explicit.join(" ");
  const nearby=list.map(work=>({work,score:similarity(searchText,work)}))
    .filter(x=>x.score>=0.34)
    .sort((a,b)=>b.score-a.score)
    .slice(0,Math.min(Math.max(Number(input.limit||5),1),10));
  if(nearby.length){
    return {ok:true,status:"NEARBY",match:"SIMILAR",work:null,candidates:nearby.map(x=>view(x.work,x.score)),createAllowed:false,nextAction:"CHOOSE_NEARBY"};
  }
  return {ok:true,status:"NOT_FOUND",match:"NONE",work:null,candidates:[],createAllowed:true,nextAction:"CREATE_NEW"};
}
