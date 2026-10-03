import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { onRequestPost as observer } from '../functions/api/observer.js';
import { onRequestPost as subscribe, onRequestGet as subscriptionLink } from '../functions/api/subscribe.js';
import { onRequestGet as formConfig } from '../functions/api/form-config.js';
import { onRequestPost as assistant } from '../functions/api/assistant.js';
import { onRequest as protect } from '../functions/assistant/_middleware.js';

const origin = 'https://michealrayberry.com';
const env = { APPS_SCRIPT_URL:'https://script.google.com/macros/s/TEST/exec', OBSERVER_SECRET:'private-observer-key', SUBSCRIBE_RELAY_KEY:'private-subscribe-key', TURNSTILE_SECRET:'private-turnstile-key', TURNSTILE_SITE_KEY:'public-widget-key', ACCESS_TEAM_DOMAIN:'mrb-test.cloudflareaccess.com', ACCESS_AUD:'assistant-audience', ASSISTANT_DEVICE_KEY:'private-device-key' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', {modulusLength:2048});
const jwk = { ...publicKey.export({format:'jwk'}), kid:'test-key' };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(overrides = {}) {
  const input = b64({alg:'RS256',kid:'test-key'})+'.'+b64({iss:'https://'+env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],sub:'participant',exp:Math.floor(Date.now()/1000)+7200,...overrides});
  return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
}
const formRequest = (route, values, headers = {}) => new Request(origin+route,{ method:'POST',headers:{origin,...headers},body:new URLSearchParams(values) });
const apiRequest = (payload, cookie = '', token = jwt()) => new Request(origin+'/api/assistant',{method:'POST',headers:{origin,'content-type':'application/json','Cf-Access-Jwt-Assertion':token,cookie},body:JSON.stringify(payload)});
const realFetch = globalThis.fetch;
const answer = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('Cloudflare form relay and authenticated assistant regressions', async t => {
  let calls, verification, relayResult;
  function network() {
    calls=[]; verification={success:true,hostname:'michealrayberry.com',action:'observer'}; relayResult={ok:true};
    globalThis.fetch = async (url, options) => {
      calls.push({url:String(url),options});
      if (String(url).endsWith('/certs')) return answer({keys:[jwk]});
      if (String(url).includes('/siteverify')) return answer(verification);
      return answer(relayResult);
    };
  }
  try {
    await t.test('Observer POST delivers to the server endpoint; no secret in URL', async () => {
      network();
      const response=await observer({env,request:formRequest('/api/observer',{message:'Please check the record.',type:'Question','cf-turnstile-response':'valid-token'})});
      assert.equal(response.status,303); assert.equal(response.headers.get('location'),origin+'/observer/received/');
      const relay=calls.find(c=>c.url.includes('script.google.com'));
      assert.equal(relay.options.method,'POST'); assert.equal(new URL(relay.url).search,'');
      assert.equal(JSON.parse(relay.options.body).secret,env.OBSERVER_SECRET);
    });
    for (const [name, change] of [['wrong widget hostname',{hostname:'attacker.example'}],['wrong widget action',{action:'subscribe'}],['failed verification',{success:false}]]) {
      await t.test('Observer rejects '+name, async () => {
        network(); Object.assign(verification,change);
        const response=await observer({env,request:formRequest('/api/observer',{type:'Question',message:'Note','cf-turnstile-response':'token'})});
        assert.ok(response.headers.get('location').endsWith('error=verify'));
        assert.ok(!calls.some(c=>c.url.includes('script.google.com')));
      });
    }
    await t.test('Cross-site requests and honeypot submissions cannot reach the relay', async () => {
      network();
      await observer({env,request:formRequest('/api/observer',{type:'Question',message:'Note','cf-turnstile-response':'token'},{origin:'https://attacker.example'})});
      await observer({env,request:formRequest('/api/observer',{type:'Question',message:'Note',website:'filled','cf-turnstile-response':'token'})});
      assert.equal(calls.length,0);
    });
    await t.test('Widget configuration exposes only the public key and fails closed when absent',async()=>{
      assert.deepEqual(await formConfig({env}).json(),{sitekey:env.TURNSTILE_SITE_KEY});
      assert.equal(formConfig({env:{}}).status,503);
    });
    await t.test('Subscribe, confirm, and unsubscribe use server-to-server POST',async()=>{
      network(); verification.action='subscribe'; relayResult={ok:true,state:'pending'};
      const response=await subscribe({env,request:formRequest('/api/subscribe',{email:'observer@example.com','cf-turnstile-response':'token'})});
      assert.equal(response.status,200);
      for (const action of ['confirm','unsubscribe']) await subscriptionLink({env,request:new Request(origin+'/api/subscribe?'+action+'='+'a'.repeat(32))});
      const relays=calls.filter(c=>c.url.includes('script.google.com')); assert.equal(relays.length,3);
      for (const call of relays) { assert.equal(call.options.method,'POST'); assert.equal(new URL(call.url).search,''); assert.equal(JSON.parse(call.options.body).key,env.SUBSCRIBE_RELAY_KEY); }
    });
    await t.test('Upstream failure gives an unsuccessful submission',async()=>{
      network(); globalThis.fetch=async()=>{throw new Error('offline');};
      const response=await subscriptionLink({env,request:new Request(origin+'/api/subscribe?confirm='+'a'.repeat(32))});
      assert.equal(response.status,400);
    });
    await t.test('Assistant rejects unsigned, expired, wrong-audience, and unconfigured access',async()=>{
      network();
      for (const token of ['forged',jwt({exp:1}),jwt({aud:['different-app']})]) assert.equal((await assistant({env,request:apiRequest({action:'ping'},'',token)})).status,403);
      assert.equal((await protect({env:{},request:new Request(origin+'/assistant/'),next:()=>{throw new Error('must not run');}})).status,503);
      assert.equal((await protect({env,request:new Request(origin+'/assistant/'),next:()=>{throw new Error('must not run');}})).status,403);
    });
    await t.test('Assistant uses HttpOnly cookies, ignores injected credentials, and revokes on logout',async()=>{
      network();
      const storage=new Map(); const sessions={put:async(k,v)=>storage.set(k,v),get:async(k)=>storage.has(k)?JSON.parse(storage.get(k)):null,delete:async(k)=>storage.delete(k)};
      const configured={...env,ASSISTANT_SESSIONS:sessions};
      relayResult={ok:true,token:'PRIVATE-UPSTREAM-UNLOCK',expires:Date.now()+7200000};
      const response=await assistant({env:configured,request:apiRequest({action:'unlock',code:'long-code-000000000000000000'})});
      assert.equal(response.status,200); const cookie=response.headers.get('set-cookie');
      assert.match(cookie,/HttpOnly; Secure; SameSite=Strict; Path=\//);
      assert.equal((await response.json()).token,'SERVER-SESSION');
      relayResult={ok:true};
      const grant=cookie.split(';')[0];
      assert.equal((await assistant({env:configured,request:apiRequest({action:'ping',key:'injected',unlock:'injected'},grant)})).status,200);
      const payload=JSON.parse(calls.at(-1).options.body);
      assert.equal(payload.key,env.ASSISTANT_DEVICE_KEY); assert.equal(payload.unlock,'PRIVATE-UPSTREAM-UNLOCK');
      assert.equal((await assistant({env:configured,request:apiRequest({action:'apreview'},grant)})).status,400);
      assert.equal((await assistant({env:configured,request:apiRequest({action:'ping'},grant,jwt({sub:'another-user'}))})).status,401);
      assert.equal((await assistant({env:{...configured,ASSISTANT_SESSION_VERSION:'2'},request:apiRequest({action:'ping'},grant)})).status,401);
      await assistant({env:configured,request:apiRequest({action:'logout'},grant)});
      assert.equal((await assistant({env:configured,request:apiRequest({action:'ping'},grant)})).status,401);
    });
    await t.test('Protected assistant responses cannot be cached or indexed',async()=>{
      network();
      const response=await protect({env,request:new Request(origin+'/assistant/',{headers:{'Cf-Access-Jwt-Assertion':jwt()}}),next:async()=>new Response('protected')});
      assert.equal(response.headers.get('cache-control'),'no-store'); assert.match(response.headers.get('x-robots-tag'),/noindex/);
      assert.match(response.headers.get('permissions-policy'),/camera=\(self\)/);
    });
  } finally { globalThis.fetch=realFetch; }
});
