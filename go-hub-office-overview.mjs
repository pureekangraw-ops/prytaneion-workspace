const names=["Centre","SPECTRUM","Factory","Copilot","PRISM","MIMIR","Drive","Notion","Linear","GitHub","Sales"];
const bucket=status=>["OPEN","ON PROCESS"].includes(status)?"active":["WAIT CONFIRM","AWAY","RETURNED"].includes(status)?"waiting":status==="COMPLETE"?"done":["CANCEL","CANCELLED"].includes(status)?"cancelled":status==="UNKNOWN"?"unknown":"attention";
export function createOfficeOverview({centre,probes={}}={}) {
  return {
    async works({offset=0,limit=25}={}) {
      const response=await centre?.action({action:"v4_inventory",offset,limit});
      if(!response?.ok)throw Error("OFFICE_CENTRE_UNAVAILABLE");
      const index=await response.json();
      const works=await Promise.all(index.works.map(async identity=>{
        try {
          const read=await centre.action({action:"v4_inspect",workId:identity.workId,checkpointId:identity.checkpointId});
          const body=await read.json();
          if(!read.ok || body.work?.workId!==identity.workId || body.work?.checkpointId!==identity.checkpointId)throw Error();
          const w=body.work;
          return {workId:w.workId,checkpointId:w.checkpointId,name:w.name,status:w.status,holder:w.holder,lastUpdated:w.lastUpdated,attention:w.attention,readback:w.readback,result:w.result,source:"CENTRE_WORK_OWNER",checkedAt:new Date().toISOString()};
        }catch{return {workId:identity.workId,checkpointId:identity.checkpointId,name:identity.name,status:"UNKNOWN",source:"CENTRE_WORK_OWNER",checkedAt:new Date().toISOString()};}
      }));
      const counts={active:0,waiting:0,done:0,attention:0,cancelled:0,unknown:0};for(const w of works)counts[bucket(w.status)]++;
      return {ok:true,works,counts,total:index.total,nextOffset:index.nextOffset,coverage:"INDEXED_WORKS",countsCoverage:"CURRENT_PAGE",checkedAt:new Date().toISOString()};
    },
    async system() {
      const components=await Promise.all(names.map(async name=>{
        let status="UNKNOWN";
        try {if(probes[name]){const result=await probes[name]();if(result?.ok===true)status="LIVE";}}catch{}
        return {name,status,checkedAt:new Date().toISOString()};
      }));
      return {ok:true,components,coverage:"CONFIGURED_READBACKS"};
    },
    async sales(input={}) {
      const response=await centre?.action({action:"spectrum_list",...input});
      if(!response?.ok)throw Error("OFFICE_SALES_UNAVAILABLE");return response.json();
    }
  };
}
