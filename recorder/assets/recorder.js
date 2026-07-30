const $=(s)=>document.querySelector(s);
const state={stream:null,recorder:null,chunks:[],videoBlob:null,photos:{}};
const required=["front","left","rear","right"];
$("#date").value=new Date().toLocaleDateString("en-CA");
function update(){
  const checks=[
    ["Date entered",Boolean($("#date").value)],
    ["Weight entered",Number($("#weight").value)>0],
    ["Video recorded",Boolean(state.videoBlob)],
    ...required.map(a=>[`${a} photo captured`,Boolean(state.photos[a])])
  ];
  $("#checklist").innerHTML=checks.map(([t,ok])=>`<li>${ok?"✓":"○"} ${t}</li>`).join("");
  $("#download").disabled=!checks.every(x=>x[1]);
}
async function startCamera(){
  try{
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:1080},height:{ideal:1920}},audio:true});
    $("#camera").srcObject=state.stream;
    await $("#camera").play();
    $("#start-video").disabled=false;
    document.querySelectorAll("[data-angle]").forEach(b=>b.disabled=false);
    $("#message").textContent="";
  }catch(e){$("#message").textContent="Camera access failed: "+e.message;}
}
function startVideo(){
  state.chunks=[];
  const type=MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")?"video/webm;codecs=vp9,opus":"video/webm";
  state.recorder=new MediaRecorder(state.stream,{mimeType:type});
  state.recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data)};
  state.recorder.onstop=()=>{state.videoBlob=new Blob(state.chunks,{type});update();$("#message").textContent="Video recorded locally. Review before filing."};
  state.recorder.start();
  $("#start-video").disabled=true;$("#stop-video").disabled=false;
}
function stopVideo(){state.recorder?.stop();$("#stop-video").disabled=true;$("#start-video").disabled=false;}
function capture(angle){
  const v=$("#camera"),c=$("#canvas");
  c.width=v.videoWidth;c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0,c.width,c.height);
  c.toBlob(blob=>{
    state.photos[angle]=blob;
    const url=URL.createObjectURL(blob);
    const existing=document.querySelector(`[data-photo="${angle}"]`);
    const html=`<div class="photo" data-photo="${angle}"><img src="${url}" alt="${angle} capture"><span>${angle}</span></div>`;
    if(existing)existing.outerHTML=html;else $("#photos").insertAdjacentHTML("beforeend",html);
    update();
  },"image/jpeg",.92);
}
async function sha256(blob){
  const bytes=await blob.arrayBuffer();
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function downloadManifest(){
  $("#download").disabled=true;$("#message").textContent="Calculating file fingerprints…";
  const date=$("#date").value;
  const manifest={
    schemaVersion:1,
    date,
    weightLb:Number($("#weight").value),
    createdAt:new Date().toISOString(),
    project:window.MRB_CONFIG?.project||{},
    files:{
      video:{name:`${date}-daily-inspection.webm`,sha256:await sha256(state.videoBlob),size:state.videoBlob.size},
      photos:{}
    },
    status:"prepared-not-submitted"
  };
  for(const angle of required){
    const b=state.photos[angle];
    manifest.files.photos[angle]={name:`${date}-${angle}.jpg`,sha256:await sha256(b),size:b.size};
  }
  const blob=new Blob([JSON.stringify(manifest,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${date}-daily-packet-manifest.json`;a.click();
  $("#message").textContent="Manifest downloaded. Media remains on this device until the storage/upload workflow is connected.";
  update();
}
$("#start-camera").addEventListener("click",startCamera);
$("#start-video").addEventListener("click",startVideo);
$("#stop-video").addEventListener("click",stopVideo);
document.querySelectorAll("[data-angle]").forEach(b=>b.addEventListener("click",()=>capture(b.dataset.angle)));
$("#date").addEventListener("input",update);$("#weight").addEventListener("input",update);$("#download").addEventListener("click",downloadManifest);
update();
