const isTest = work => /^(?:SMOKE|TEST)[-_:]/i.test(String(work.workId||"")) || /\bruntime smoke\b/i.test(String(work.name||"")) || (work.scope||[]).some(s=>["SMOKE","TEST"].includes(String(s).toUpperCase()));
const terminal = work => ["COMPLETE","CANCEL","CANCELLED"].includes(work.status);
const rank = work => work.status==="WAIT CONFIRM"?0:work.status==="ON PROCESS"?1:work.status==="OPEN"?2:3;
export function officeWorkPage(works, view="all") {
  return works.filter(w=>view==="current" ? !isTest(w)&&!terminal(w) : view==="results" ? !isTest(w)&&w.status==="COMPLETE" : view==="history" ? isTest(w)||terminal(w) : true)
    .sort((a,b)=>(view==="current"?rank(a)-rank(b):0) || (Date.parse(b.lastUpdated)||0)-(Date.parse(a.lastUpdated)||0) || String(a.workId).localeCompare(String(b.workId)));
}
