import {AdapterError} from './flow.mjs';

// Pure local fakes. No vendor URL, network request, credential or SDK call.
// The fake service ledger survives a flow instance restart in the tests. A real
// provider adapter must honour idempotency keys or reconcile by external key.
export class FakeServices {
  constructor(){this.ledger=new Map();this.meetings=new Map();this.calendar=new Map();this.crm=new Map();this.invites=new Map();this.reminders=new Map();this.calls={meeting:0,calendar:0,invite:0,crm:0,reminder:0};this.effects={meeting:0,calendar:0,invite:0,crm:0,reminder:0};this.faults={};}
  fail(name,...faults){this.faults[name]=faults;}
  async effect(name,payload,key,commit){
    this.calls[name]++;
    if(this.ledger.has(key))return structuredClone(this.ledger.get(key));
    const fault=this.faults[name]?.shift();
    if(fault&&!fault.afterCommit)throw new AdapterError(fault.code,{retryable:fault.retryable,retryAfterMs:fault.retryAfterMs,message:fault.privateMessage});
    const result=commit();this.effects[name]++;this.ledger.set(key,structuredClone(result));
    if(fault?.afterCommit)throw new AdapterError(fault.code,{retryable:fault.retryable,message:fault.privateMessage});
    return structuredClone(result);
  }
  get adapters(){return {
    meeting:{create:(payload,key)=>this.effect('meeting',payload,key,()=>{const value={shortcode:`FAKE-MEET-${this.meetings.size+1}`};this.meetings.set(payload.requestId,value);return value;})},
    calendar:{upsert:(payload,key)=>this.effect('calendar',payload,key,()=>{const value={id:`FAKE-CALENDAR-${payload.requestId}`,...payload};this.calendar.set(payload.requestId,value);return {id:value.id};})},
    invitation:{send:(payload,key)=>this.effect('invite',payload,key,()=>{this.invites.set(key,{...payload});return {id:`FAKE-INVITE-${this.invites.size}`};}),remind:(payload,key)=>this.effect('reminder',payload,key,()=>{this.reminders.set(key,{...payload});return {id:`FAKE-REMINDER-${this.reminders.size}`};})},
    crm:{upsert:(payload,key)=>this.effect('crm',payload,key,()=>{const value={id:`FAKE-CRM-${payload.requestId}`,...payload};this.crm.set(payload.requestId,value);return {id:value.id};})}
  };}
  counters(){return {calls:{...this.calls},effects:{...this.effects},records:{meetings:this.meetings.size,calendar:this.calendar.size,invitations:this.invites.size,crm:this.crm.size,reminders:this.reminders.size}};}
}

export class FakeClock {
  constructor(start=Date.parse('2026-10-20T10:00:00Z')){this.time=start;this.sleeps=[];}
  now=()=>this.time;
  sleep=async ms=>{this.sleeps.push(ms);this.time+=ms;};
  advance(ms){this.time+=ms;}
}
