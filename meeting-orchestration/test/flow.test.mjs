import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {resolve,join,sep,basename} from 'node:path';
import {MeetingFlow} from '../src/flow.mjs';
import {MemoryStore,JsonFileStore} from '../src/store.mjs';
import {FakeClock,FakeServices} from '../src/fake-adapters.mjs';

const schedule={type:'schedule',eventId:'evt_schedule',requestId:'request_demo',version:1,title:'Synthetic planning call',attendee:'customer@example.invalid',startISO:'2026-10-20T11:00:00Z'};
function setup(store=new MemoryStore()){const services=new FakeServices(),clock=new FakeClock(),logs=[];return {store,services,clock,logs,flow:new MeetingFlow({store,adapters:services.adapters,clock,log:row=>logs.push(row)})};}

test('schedule and simultaneous duplicate trigger produce one of every effect',async()=>{
  const {flow,services}=setup();
  const result=await Promise.all([flow.handle(schedule),flow.handle({...schedule}),flow.handle({...schedule})]);
  assert.ok(result.every(row=>row.eventStatus==='complete'));
  assert.deepEqual(services.effects,{meeting:1,calendar:1,invite:1,crm:1,reminder:0});
  assert.equal(services.calendar.get(schedule.requestId).shortcode,'FAKE-MEET-1');
  assert.equal(services.crm.get(schedule.requestId).status,'scheduled');
  assert.equal(services.invites.size,1);
});

test('429 retry waits requested interval, then retries without duplicate effect',async()=>{
  const {flow,services,clock}=setup();services.fail('meeting',{code:'RATE_LIMITED',retryable:true,retryAfterMs:750});
  assert.equal((await flow.handle(schedule)).eventStatus,'complete');
  assert.deepEqual(clock.sleeps,[750]);assert.equal(services.calls.meeting,2);assert.equal(services.effects.meeting,1);
});

test('lost acknowledgement after committed meeting is reconciled with same key',async()=>{
  const {flow,services}=setup();services.fail('meeting',{code:'TEMPORARY',retryable:true,afterCommit:true});
  assert.equal((await flow.handle(schedule)).eventStatus,'complete');
  assert.equal(services.calls.meeting,2);assert.equal(services.effects.meeting,1);assert.equal(services.meetings.size,1);
});

test('exhausted downstream retries pause; duplicate does not reset budget; explicit resume recovers',async()=>{
  const {flow,services,clock}=setup();services.fail('crm',...Array.from({length:3},()=>({code:'TEMPORARY',retryable:true})));
  const failed=await flow.handle(schedule);assert.equal(failed.eventStatus,'failed');assert.equal(failed.pausedStep,'crm');
  assert.deepEqual(clock.sleeps,[100,200]);assert.equal(services.calls.crm,3);assert.equal(services.effects.crm,0);
  const previous=services.counters();await flow.handle(schedule);assert.deepEqual(services.counters(),previous);
  assert.equal((await flow.handle(schedule,{resume:true})).eventStatus,'complete');
  assert.deepEqual(services.effects,{meeting:1,calendar:1,invite:1,crm:1,reminder:0});
  assert.equal(services.calls.meeting,1);assert.equal(services.calls.calendar,1);assert.equal(services.calls.invite,1);
});

test('long Retry-After defers instead of retrying early or sleeping without bound',async()=>{
  const {flow,services,clock}=setup();services.fail('meeting',{code:'RATE_LIMITED',retryable:true,retryAfterMs:10000});
  const result=await flow.handle(schedule);assert.equal(result.eventStatus,'failed');assert.equal(result.notBefore,clock.now()+10000);
  assert.deepEqual(clock.sleeps,[]);await flow.handle(schedule,{resume:true});assert.equal(services.calls.meeting,1);
  clock.advance(10000);assert.equal((await flow.handle(schedule,{resume:true})).eventStatus,'complete');assert.equal(services.meetings.size,1);
});

test('permanent error makes no automatic retry and logs no private values or raw error',async()=>{
  const {flow,services,logs}=setup();services.fail('calendar',{code:'AUTH_REQUIRED',retryable:false,privateMessage:'Bearer SECRET_TOKEN for customer@example.invalid / Synthetic planning call'});
  const result=await flow.handle(schedule);assert.equal(result.eventStatus,'failed');assert.equal(services.calls.calendar,1);
  const text=JSON.stringify(logs);assert.ok(!text.includes('SECRET_TOKEN'));assert.ok(!text.includes(schedule.attendee));assert.ok(!text.includes(schedule.title));assert.ok(!text.includes('Bearer'));
  assert.ok(logs.some(row=>row.code==='AUTH_REQUIRED'));
});

test('reschedule invalidates old reminder; cancellation invalidates replacement',async()=>{
  const {flow,services,clock,store}=setup();await flow.handle(schedule);
  const reschedule={...schedule,type:'reschedule',eventId:'evt_reschedule',version:2,startISO:'2026-10-20T12:00:00Z'};
  await flow.handle(reschedule);await flow.handle(reschedule);
  clock.advance(60*60*1000);assert.equal((await flow.sendDueReminders()).sent,0);
  assert.equal(services.meetings.size,1);assert.equal(services.calendar.size,1);assert.equal(services.crm.size,1);assert.equal(services.invites.size,2);
  assert.equal(services.calendar.get(schedule.requestId).startISO,'2026-10-20T12:00:00.000Z');
  const cancel={type:'cancel',eventId:'evt_cancel',requestId:schedule.requestId,version:3};await flow.handle(cancel);await flow.handle(cancel);
  clock.advance(2*60*60*1000);assert.equal((await flow.sendDueReminders()).sent,0);
  assert.equal((await store.read()).requests[schedule.requestId].status,'cancelled');
  assert.equal(services.calendar.get(schedule.requestId).status,'cancelled');assert.equal(services.crm.get(schedule.requestId).status,'cancelled');assert.equal(services.reminders.size,0);
  assert.equal([...services.invites.values()].at(-1).attendee,schedule.attendee);
});

test('due reminder sends once and only for current scheduled version',async()=>{
  const {flow,services,clock}=setup();await flow.handle(schedule);clock.advance(55*60*1000);
  assert.equal((await flow.sendDueReminders()).sent,1);assert.equal((await flow.sendDueReminders()).sent,0);assert.equal(services.effects.reminder,1);
});

test('failed update suppresses old reminder and rejects a competing newer event',async()=>{
  const {flow,services,clock}=setup();await flow.handle(schedule);services.fail('calendar',{code:'PERMANENT',retryable:false});
  const update={...schedule,type:'reschedule',eventId:'evt_reschedule',version:2,startISO:'2026-10-20T12:00:00Z'};
  assert.equal((await flow.handle(update)).eventStatus,'failed');clock.advance(60*60*1000);assert.equal((await flow.sendDueReminders()).sent,0);
  await assert.rejects(flow.handle({type:'cancel',eventId:'evt_cancel',requestId:schedule.requestId,version:3}),/UNSETTLED_PRIOR_EVENT/);
  assert.equal((await flow.handle(update,{resume:true})).eventStatus,'complete');
});

test('event id reuse with changed payload and out-of-order update cannot add effects',async()=>{
  const {flow,services}=setup();await flow.handle(schedule);const previous=services.counters();
  await assert.rejects(flow.handle({...schedule,title:'Changed payload'}),/EVENT_ID_CONFLICT/);
  await assert.rejects(flow.handle({...schedule,type:'reschedule',eventId:'evt_skip',version:3}),/OUT_OF_ORDER_VERSION/);
  assert.deepEqual(services.counters(),previous);
});

test('file checkpoint resumes after constructing a fresh flow instance',async()=>{
  const root=await realpath(process.cwd()),folder=await mkdtemp(join(root,'.test-tmp-'));
  try{
    const store=new JsonFileStore(join(folder,'state.json')),{flow,services,clock}=setup(store);services.fail('crm',{code:'PERMANENT',retryable:false});
    assert.equal((await flow.handle(schedule)).eventStatus,'failed');
    const restarted=new MeetingFlow({store:new JsonFileStore(join(folder,'state.json')),adapters:services.adapters,clock});
    assert.equal((await restarted.handle(schedule,{resume:true})).eventStatus,'complete');
    assert.deepEqual(services.effects,{meeting:1,calendar:1,invite:1,crm:1,reminder:0});
  }finally{
    const target=resolve(folder);if(!target.startsWith(root+sep)||!basename(target).startsWith('.test-tmp-'))throw new Error('Refusing cleanup outside test workspace.');
    await rm(target,{recursive:true,force:true});
  }
});

test('hanging adapter is timed out and aborted within a bounded attempt budget',async()=>{
  const store=new MemoryStore(),clock=new FakeClock();let calls=0,aborts=0;
  const services=new FakeServices(),adapters=services.adapters;
  adapters.meeting.create=(_payload,_key,{signal})=>{calls++;signal.addEventListener('abort',()=>aborts++);return new Promise(()=>{});};
  const flow=new MeetingFlow({store,clock,adapters,attemptTimeoutMs:5});
  const result=await flow.handle(schedule);assert.equal(result.eventStatus,'failed');assert.equal(calls,3);assert.equal(aborts,3);assert.deepEqual(clock.sleeps,[100,200]);assert.equal(services.meetings.size,0);
});

test('reserved ids and malformed events fail before any side effect',async()=>{
  const {flow,services}=setup();
  await assert.rejects(flow.handle({...schedule,eventId:'__proto__'}),/INVALID_EVENT/);
  await assert.rejects(flow.handle({...schedule,requestId:123}),/INVALID_EVENT/);
  await assert.rejects(flow.handle({...schedule,startISO:'not-a-date'}),/INVALID_EVENT/);
  assert.deepEqual(services.effects,{meeting:0,calendar:0,invite:0,crm:0,reminder:0});
});

test('invalid adapter result is a protocol failure before downstream effects',async()=>{
  const {store,services,clock}=setup(),adapters=services.adapters;adapters.meeting.create=async()=>({unexpected:'no shortcode'});
  const flow=new MeetingFlow({store,adapters,clock}),result=await flow.handle(schedule);
  assert.equal(result.eventStatus,'failed');assert.equal(result.pausedStep,'meeting');assert.equal(result.code,'ADAPTER_PROTOCOL');
  assert.deepEqual(services.effects,{meeting:0,calendar:0,invite:0,crm:0,reminder:0});
});

test('paused reminder has explicit bounded resume that honours Retry-After',async()=>{
  const {flow,services,clock}=setup();await flow.handle(schedule);clock.advance(55*60*1000);
  services.fail('reminder',{code:'RATE_LIMITED',retryable:true,retryAfterMs:10000});
  assert.equal((await flow.sendDueReminders()).sent,0);assert.equal(services.calls.reminder,1);
  assert.equal((await flow.sendDueReminders({resumeFailed:true})).sent,0);assert.equal(services.calls.reminder,1);
  clock.advance(10000);assert.equal((await flow.sendDueReminders()).sent,0);assert.equal(services.calls.reminder,1);
  assert.equal((await flow.sendDueReminders({resumeFailed:true})).sent,1);assert.equal(services.calls.reminder,2);assert.equal(services.effects.reminder,1);
  assert.equal((await flow.sendDueReminders({resumeFailed:true})).sent,0);assert.equal(services.calls.reminder,2);
});
