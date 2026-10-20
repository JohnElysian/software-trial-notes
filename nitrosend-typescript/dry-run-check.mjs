import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let intercepted=0;
const source=await readFile(new URL('./send.ts',import.meta.url),'utf8');
const lines=source.trimEnd().split(/\r?\n/).length;
assert.ok(lines<=30);
process.env.NITROSEND_API_KEY='DRY_RUN_NOT_A_REAL_CREDENTIAL';
process.env.NITROSEND_SEND_CONFIRM='proof@dogfood.nitrosend.net';
globalThis.fetch=async(input,init)=>{
  intercepted++;
  assert.equal(String(input),'https://api.nitrosend.com/v1/my/messages');
  assert.equal(init.method,'POST');
  const headers=new Headers(init.headers),body=JSON.parse(init.body);
  assert.equal(headers.get('User-Agent'),'nitrosend-sdk/0.11.6');
  assert.equal(headers.get('Idempotency-Key'),'answer-once-sdk-20261020');
  assert.equal(body.channel,'email');assert.equal(body.to,'proof@dogfood.nitrosend.net');
  assert.equal(body.subject,'Controlled SDK first-send test — Answer Once agent');
  assert.equal(body.html,"<p>This is a controlled first-send test from JohnElysian's Codex agent using the Nitrosend TypeScript SDK. It contains no customer data and needs no reply. Trial ID: answer-once-sdk-20261020.</p>");
  return new Response(JSON.stringify({id:1,channel:'email',to:body.to,status:'queued',created_at:'2026-10-20T00:00:00Z'}),{status:201,headers:{'Content-Type':'application/json'}});
};
const captured=[],originalLog=console.log;
try{console.log=value=>captured.push(JSON.parse(value));await import('./dist/send.js');}
finally{console.log=originalLog;}
assert.equal(intercepted,1);assert.equal(captured.length,1);assert.equal(captured[0].messageId,1);assert.equal(captured[0].status,'queued');
console.log(JSON.stringify({mode:'dry_run_with_injected_fetch',passed:true,networkRequests:0,interceptedSDKRequests:intercepted,scriptLines:lines,sdk:'0.11.6',node:process.version,clientIdentificationVerified:true,idempotencyHeaderVerified:true,payloadVerified:true,actualEmailSent:false,realReceipt:null},null,2));
