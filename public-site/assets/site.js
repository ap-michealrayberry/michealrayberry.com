const q=(s)=>document.querySelector(s);
const fmtDate=(v)=>v?new Intl.DateTimeFormat("en-US",{year:"numeric",month:"short",day:"numeric"}).format(new Date(v+"T12:00:00")):"—";
const fmtTime=(v)=>v?new Intl.DateTimeFormat("en-US",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
async function json(path){const r=await fetch(path,{cache:"no-store"});if(!r.ok)throw new Error(path+" returned "+r.status);return r.json();}
function statusClass(status){return ["accepted","violation","incomplete","pending"].includes(status)?status:"pending";}
async function boot(){
  try{
    const [snapshot,days,violations]=await Promise.all([
      json("./data/project.json"),json("./data/days.json"),json("./data/violations.json")
    ]);
    const p=snapshot.project,s=snapshot.summary;
    q("#record-status").textContent=(p.status||"unknown")+" record";
    q("#start-weight").textContent=Number(p.startWeightLb).toFixed(0);
    q("#goal-weight").textContent=Number(p.goalWeightLb).toFixed(0);
    q("#current-weight").textContent=s.currentWeightLb==null?"—":Number(s.currentWeightLb).toFixed(1)+" lb";
    q("#accepted-days").textContent=s.acceptedDays??"—";
    q("#violation-count").textContent=s.violations??violations.length;
    q("#last-updated").textContent=fmtTime(s.lastUpdated);
    q("#project-summary").textContent=`Started ${fmtDate(p.startDate)}. Daily documentation deadline: ${p.deadline}.`;
    if(p.configStatus){
      q("#config-notice").hidden=false;
      q("#config-notice").textContent=p.configStatus;
    }
    q("#days-body").innerHTML=days.length?days.slice().reverse().map(d=>{
      const evidence=[d.videoUrl?"video":"",Object.keys(d.photos||{}).length?`${Object.keys(d.photos).length} photos`:""].filter(Boolean).join(" · ")||"Not published";
      return `<tr><td>${d.projectDay}</td><td>${fmtDate(d.date)}</td><td>${d.weightLb==null?"—":Number(d.weightLb).toFixed(1)+" lb"}</td><td><span class="pill ${statusClass(d.status)}">${d.status}</span></td><td>${evidence}</td></tr>`;
    }).join(""):`<tr><td colspan="5">No daily packets published.</td></tr>`;
    q("#violations-list").className=violations.length?"":"empty";
    q("#violations-list").innerHTML=violations.length?violations.map(v=>`<div class="violation-row"><strong>${fmtDate(v.date)}</strong><span>${v.nature}</span><span class="pill ${v.resolved?"accepted":"violation"}">${v.resolved?"resolved":"unresolved"}</span></div>`).join(""):"No violations on the published record.";
  }catch(err){
    q("#record-status").textContent="Record unavailable";
    q("#project-summary").textContent="The published snapshot could not be loaded.";
    q("#days-body").innerHTML=`<tr><td colspan="5">${err.message}</td></tr>`;
  }
}
boot();
