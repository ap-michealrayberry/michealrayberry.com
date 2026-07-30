const login=document.querySelector("#login"),consoleView=document.querySelector("#console"),message=document.querySelector("#login-message");
function unlock(){
  const key=document.querySelector("#ap-key").value.trim();
  if(!key){message.textContent="Enter the AP key.";return;}
  sessionStorage.setItem("mrb_v2_ap_key",key);
  login.hidden=true;consoleView.hidden=false;
}
function lock(){sessionStorage.removeItem("mrb_v2_ap_key");consoleView.hidden=true;login.hidden=false;document.querySelector("#ap-key").value="";}
document.querySelector("#unlock").addEventListener("click",unlock);
document.querySelector("#lock").addEventListener("click",lock);
if(sessionStorage.getItem("mrb_v2_ap_key")){login.hidden=true;consoleView.hidden=false;}
