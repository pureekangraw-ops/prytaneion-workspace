const names=["Centre","SPECTRUM","Factory","Copilot","PRISM","MIMIR","Drive","Notion","Linear","GitHub","Sales"];
const bucket=status=>["OPEN","ON PROCESS"].includes(status)?"active":["WAIT CONFIRM","AWAY","RETURNED"].includes(status)?"waiting":status==="COMPLETE"?"done":["CANCEL","CANCELLED"].includes(status)?"cancelled":status==="UNKNOWN"?"unknown":"attention";
export function createOfficeOverview({centre,probes={}}={}) {
  return {
    async works({offset=0,limit=25,view="all"}={}) {
      const response=await centre?.action({action:"v4_inventory",offset,limit,view});
      if(!response?.ok)throw Error("OFFICE_CENTRE_UNAVAILABLE");
      const index=await response.json();
      const works=await Promise.all(index.works.map(async identity=>{
        try {
          const read=await centre.action({action:"v4_inspect",workId:identity.workId,checkpointId:identity.checkpointId});
          const body=await read.json();
          if(!read.ok || body.work?.workId!==identity.workId || body.work?.checkpointId!==identity.checkpointId)throw Error();
          const w=body.work;
          return {workId:w.workId,checkpointId:w.checkpointId,name:w.name,status:w.status,holder:w.holder,lastUpdated:w.lastUpdated,attention:w.attention,waitReason:w.waitReason,readback:w.readback,result:w.result,source:"CENTRE_WORK_OWNER",checkedAt:new Date().toISOString()};
        }catch{return {workId:identity.workId,checkpointId:identity.checkpointId,name:identity.name,status:"UNKNOWN",source:"CENTRE_WORK_OWNER",checkedAt:new Date().toISOString()};}
      }));
      const counts={active:0,waiting:0,done:0,attention:0,cancelled:0,unknown:0};for(const w of works)counts[bucket(w.status)]++;
      return {ok:true,works,counts,total:index.total,nextOffset:index.nextOffset,coverage:"INDEXED_WORKS",countsCoverage:"CURRENT_PAGE",checkedAt:new Date().toISOString()};
    },
    async activity({limit=12}={}) {
      const current=await this.works({offset:0,limit:Math.max(25,Number(limit)||12),view:"current"});
      const items=current.works
        .filter(w=>!["CANCEL","CANCELLED"].includes(String(w.status||"").toUpperCase()))
        .sort((a,b)=>String(b.lastUpdated||b.checkedAt||"").localeCompare(String(a.lastUpdated||a.checkedAt||"")))
        .slice(0,Math.min(25,Math.max(1,Number(limit)||12)))
        .map(w=>({
          workId:w.workId,
          checkpointId:w.checkpointId,
          name:w.name,
          status:w.status,
          holder:w.holder||null,
          waitReason:w.waitReason||null,
          movedAt:w.lastUpdated||w.checkedAt,
          source:w.source,
          movement:w.waitReason?("รอ: "+w.waitReason):w.holder?("อยู่กับ "+w.holder):("สถานะ "+w.status),
        }));
      return {ok:true,items,coverage:current.coverage,checkedAt:new Date().toISOString()};
    },
    async health() {
      const current=await this.works({offset:0,limit:50,view:"current"});
      const mismatches=[];
      for(const w of current.works){
        const s=String(w.status||"UNKNOWN").toUpperCase();
        if(["ON PROCESS","ON_PROCESS","DOING"].includes(s) && !w.holder)mismatches.push({workId:w.workId,kind:"OWNER_MISSING",message:"งานกำลังทำแต่ยังไม่เห็นผู้ถือ Work"});
        if(["OPEN"].includes(s) && w.holder)mismatches.push({workId:w.workId,kind:"OPEN_WITH_HOLDER",message:"งานยัง OPEN แต่มีผู้ถือ Work"});
        if(s==="UNKNOWN")mismatches.push({workId:w.workId,kind:"OWNER_TRUTH_UNKNOWN",message:"อ่าน Owner Source ไม่สำเร็จ"});
      }
      const unknown=current.works.filter(w=>String(w.status||"").toUpperCase()==="UNKNOWN").length;
      const waiting=current.works.filter(w=>bucket(w.status)==="waiting").length;
      return {
        ok:true,
        state:mismatches.length||unknown?"ATTENTION":"STABLE",
        counts:{current:current.works.length,waiting,unknown,mismatches:mismatches.length},
        mismatches:mismatches.slice(0,20),
        checkedAt:new Date().toISOString(),
        basis:"CENTRE_WORK_OWNER"
      };
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
      const [salesResponse,quoteResponse,paymentResponse]=await Promise.all([centre?.action({action:"spectrum_list",...input}),centre?.action({action:"quote_list",...input}),centre?.action({action:"payment_list",...input})]);
      if(!salesResponse?.ok||!quoteResponse?.ok||!paymentResponse?.ok)throw Error("OFFICE_SALES_UNAVAILABLE");
      const sales=await salesResponse.json(),quote=await quoteResponse.json(),payment=await paymentResponse.json();
      return {...sales,quotes:quote.quotes||[],quoteSource:quote.source||"UNKNOWN",quoteCheckedAt:quote.checkedAt||null,quoteNextCursor:quote.nextCursor||null,payments:payment.payments||[],paymentSource:payment.source||"UNKNOWN",paymentCheckedAt:payment.checkedAt||null,paymentNextCursor:payment.nextCursor||null};
    },
    async dailySummary() {
      const [works,sales,system]=await Promise.all([this.works({offset:0,limit:50,view:"current"}),this.sales({limit:50}),this.system()]);
      const quoteCounts={QUOTE_DRAFT:0,QUOTE_SENT:0};
      for(const quote of sales.quotes||[]){const status=String(quote.status||"UNKNOWN").toUpperCase();if(Object.hasOwn(quoteCounts,status))quoteCounts[status]++;}
      const confirmed={},reviewStatuses=new Set(["PAYMENT_CONFIRMED","PAYMENT_FAILED","REFUND_PENDING","REFUNDED","DISPUTED","UNKNOWN"]);
      let pending=0,goReviewRequired=0;
      for(const payment of sales.payments||[]){
        const status=String(payment.status||"UNKNOWN").toUpperCase();
        if(status==="PAYMENT_PENDING")pending++;
        if(status==="PAYMENT_CONFIRMED"){
          const currency=String(payment.currency||"UNKNOWN").toUpperCase(),amount=Number(payment.amount);
          if(currency!=="UNKNOWN"&&Number.isFinite(amount))confirmed[currency]=(confirmed[currency]||0)+amount;
        }
        if(reviewStatuses.has(status)||String(payment.evidenceFreshness?.state||"UNKNOWN").toUpperCase()!=="FRESH")goReviewRequired++;
      }
      const ownerMismatches=works.works.filter(work=>{
        const status=String(work.status||"UNKNOWN").toUpperCase();
        return (["ON PROCESS","ON_PROCESS","DOING"].includes(status)&&!work.holder)||(status==="OPEN"&&Boolean(work.holder));
      }).length;
      const live=system.components.filter(component=>component.status==="LIVE").length;
      const unknown=system.components.length-live;
      const coverage={work:works.nextOffset===null,sales:!sales.nextCursor&&!sales.quoteNextCursor,money:!sales.paymentNextCursor};
      const coverageIncomplete=Object.values(coverage).some(value=>!value)?1:0;
      const attentionTotal=works.counts.unknown+ownerMismatches+goReviewRequired+coverageIncomplete;
      const activity=works.works
        .filter(work=>!["CANCEL","CANCELLED"].includes(String(work.status||"").toUpperCase()))
        .sort((a,b)=>String(b.lastUpdated||b.checkedAt||"").localeCompare(String(a.lastUpdated||a.checkedAt||"")))
        .slice(0,12)
        .map(work=>({workId:work.workId,name:work.name,status:work.status,holder:work.holder||null,waitReason:work.waitReason||null,movedAt:work.lastUpdated||work.checkedAt,movement:work.waitReason?("รอ: "+work.waitReason):work.holder?("อยู่กับ "+work.holder):("สถานะ "+work.status)}));
      return {
        ok:true,
        work:{active:works.counts.active,waiting:works.counts.waiting,attention:works.counts.attention,unknown:works.counts.unknown,total:works.total,observed:works.works.length,coverageComplete:coverage.work},
        sales:{briefsReceived:(sales.briefs||[]).length,quoteDrafts:quoteCounts.QUOTE_DRAFT,quotesSent:quoteCounts.QUOTE_SENT,coverageComplete:coverage.sales},
        money:{providerConfirmedByCurrency:confirmed,pending,goReviewRequired,authority:"GO_REVIEW_REQUIRED",coverageComplete:coverage.money},
        system:{live,unknown,total:system.components.length},
        attention:{total:attentionTotal,workUnknown:works.counts.unknown,ownerMismatches,moneyReview:goReviewRequired,coverageIncomplete,nextAction:attentionTotal?"GO_REVIEW":"NONE"},
        worksPreview:works.works.slice(0,6),
        activity,
        source:{work:"CENTRE_WORK_OWNER",sales:sales.source||"UNKNOWN",money:sales.paymentSource||"UNKNOWN",system:system.coverage},
        checkedAt:new Date().toISOString()
      };
    }
  };
}
