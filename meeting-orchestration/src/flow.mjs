import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const keyPattern=/^[A-Za-z0-9_-]{1,80}$/;
const validKey=value=>typeof value==='string'&&keyPattern.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const SAFE_CODES=new Set(['RATE_LIMITED','TEMPORARY','PERMANENT','AUTH_REQUIRED','ADAPTER_PROTOCOL']);

export class AdapterError extends Error {
  constructor(code,{retryable=false,retryAfterMs=0,message='Adapter failure'}={}){
    super(message);this.code=code;this.retryable=retryable;this.retryAfterMs=retryAfterMs;
  }
}

function normalize(raw){
  if(!raw||!['schedule','reschedule','cancel'].includes(raw.type)||!validKey(raw.requestId)||!validKey(raw.eventId)||!Number.isSafeInteger(raw.version)||raw.version<1)throw new Error('INVALID_EVENT');
  const event={type:raw.type,eventId:raw.eventId,requestId:raw.requestId,version:raw.version};
  if(event.type!=='cancel'){
    if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200||typeof raw.attendee!=='string'||!raw.attendee.includes('@')||raw.attendee.length>200||!Number.isFinite(Date.parse(raw.startISO)))throw new Error('INVALID_EVENT');
    Object.assign(event,{title:raw.title.trim(),attendee:raw.attendee,startISO:new Date(raw.startISO).toISOString()});
  }
  return event;
}

export class MeetingFlow {
  constructor({store,adapters,clock={now:()=>Date.now(),sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))},log=()=>{},maxAttempts=3,maxDelayMs=2000,baseDelayMs=100,attemptTimeoutMs=1000}){
    if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>5||!Number.isFinite(maxDelayMs)||maxDelayMs<1||maxDelayMs>10000||!Number.isFinite(baseDelayMs)||baseDelayMs<1||!Number.isFinite(attemptTimeoutMs)||attemptTimeoutMs<1||attemptTimeoutMs>30000)throw new Error('INVALID_RETRY_POLICY');
    Object.assign(this,{store,adapters,clock,log,maxAttempts,maxDelayMs,baseDelayMs,attemptTimeoutMs});
    this.tail=Promise.resolve();
  }
  exclusive(fn){const result=this.tail.then(fn,fn);this.tail=result.catch(()=>{});return result;}
  safeLog(event,requestId,details={}){this.log({event,correlation:hash(requestId).slice(0,12),...details});}
  async timedCall(call,key){
    const controller=new AbortController();let timer;
    try{return await Promise.race([Promise.resolve().then(()=>call(key,{signal:controller.signal})),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AdapterError('TEMPORARY',{retryable:true}));},this.attemptTimeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
  async step(state,job,name,call,{resume=false}={}){
    const checkpoint=job.steps[name]??={status:'pending',attempts:0};
    if(checkpoint.status==='complete')return checkpoint.result;
    if(checkpoint.status==='failed'&&!resume)throw new Error('STEP_PAUSED');
    if(checkpoint.notBefore&&this.clock.now()<checkpoint.notBefore)throw new Error('STEP_PAUSED');
    // Retry budget resets only on an explicit caller-requested resume, never
    // merely because a duplicate trigger arrived. Idempotency key stays stable.
    if(resume)checkpoint.attempts=0;
    const idempotencyKey=`${job.requestId}:${job.version}:${name}`;
    while(checkpoint.attempts<this.maxAttempts){
      checkpoint.attempts++;checkpoint.status='in_flight';
      await this.store.write(state);
      try{
        const result=await this.timedCall(call,idempotencyKey);
        const resultId=name==='meeting'?result?.shortcode:result?.id;
        if(!result||typeof result!=='object'||typeof resultId!=='string'||!resultId||resultId.length>256)throw new AdapterError('ADAPTER_PROTOCOL');
        checkpoint.result=result;checkpoint.status='complete';delete checkpoint.notBefore;
        await this.store.write(state);
        this.safeLog('step_complete',job.requestId,{operation:name,attempt:checkpoint.attempts});
        return result;
      }catch(error){
        const code=SAFE_CODES.has(error?.code)?error.code:'ADAPTER_FAILED';
        const retryable=error instanceof AdapterError&&error.retryable;
        checkpoint.status='failed';checkpoint.code=code;
        const delay=Math.max(this.baseDelayMs*2**(checkpoint.attempts-1),Number.isFinite(error?.retryAfterMs)?Math.max(0,error.retryAfterMs):0);
        this.safeLog('step_failed',job.requestId,{operation:name,attempt:checkpoint.attempts,code,retryable});
        if(!retryable||checkpoint.attempts>=this.maxAttempts){await this.store.write(state);throw new Error('STEP_PAUSED');}
        if(delay>this.maxDelayMs){checkpoint.notBefore=this.clock.now()+delay;await this.store.write(state);throw new Error('STEP_PAUSED');}
        checkpoint.notBefore=this.clock.now()+delay;await this.store.write(state);
        await this.clock.sleep(delay);delete checkpoint.notBefore;
      }
    }
    checkpoint.status='failed';checkpoint.code='RETRY_EXHAUSTED';await this.store.write(state);throw new Error('STEP_PAUSED');
  }
  handle(raw,{resume=false}={}){return this.exclusive(async()=>{
    const event=normalize(raw),signature=hash(JSON.stringify(event)),state=await this.store.read();
    let job=state.events[event.eventId],request=state.requests[event.requestId];
    if(job&&job.signature!==signature)throw new Error('EVENT_ID_CONFLICT');
    if(job?.status==='complete'||job?.status==='ignored')return this.result(state,job);
    if(!job){
      if(event.type==='schedule'&&(request||event.version!==1))throw new Error('REQUEST_ALREADY_EXISTS_OR_BAD_VERSION');
      if(event.type!=='schedule'&&!request)throw new Error('REQUEST_NOT_FOUND');
      if(request&&event.version<=request.version){
        job={...event,signature,status:'ignored',steps:{}};state.events[event.eventId]=job;await this.store.write(state);return this.result(state,job);
      }
      if(request?.activeEventId)throw new Error('UNSETTLED_PRIOR_EVENT');
      if(request&&event.version!==request.version+1)throw new Error('OUT_OF_ORDER_VERSION');
      job={...event,signature,status:'pending',steps:{}};state.events[event.eventId]=job;
      if(!request){request={requestId:event.requestId,version:0,status:'pending'};state.requests[event.requestId]=request;}
      request.activeEventId=event.eventId;
      // Immediately invalidate an older reminder before an update can fail.
      for(const reminder of Object.values(state.reminders))if(reminder.requestId===event.requestId)reminder.active=false;
      await this.store.write(state);
    }
    if(job.status==='failed'&&!resume)return this.result(state,job);
    try{
      if(event.type==='schedule'){
        const meeting=await this.step(state,job,'meeting',(key,context)=>this.adapters.meeting.create({requestId:event.requestId},key,context),{resume});
        if(typeof meeting.shortcode!=='string'||!meeting.shortcode)throw new Error('BAD_MEETING_ADAPTER_RESULT');
        request.shortcode=meeting.shortcode;
      }
      const status=event.type==='cancel'?'cancelled':'scheduled';
      const details=event.type==='cancel'?request.details:{title:event.title,startISO:event.startISO,attendee:event.attendee};
      const payload={requestId:event.requestId,version:event.version,status,shortcode:request.shortcode,...details};
      request.calendar=await this.step(state,job,'calendar',(key,context)=>this.adapters.calendar.upsert(payload,key,context),{resume});
      request.invite=await this.step(state,job,'invite',(key,context)=>this.adapters.invitation.send(payload,key,context),{resume});
      request.crm=await this.step(state,job,'crm',(key,context)=>this.adapters.crm.upsert(payload,key,context),{resume});
      request.details=details;
      request.status=status;request.version=event.version;delete request.activeEventId;
      if(status==='scheduled'){
        const reminderId=`${event.requestId}:${event.version}`;
        state.reminders[reminderId]={requestId:event.requestId,version:event.version,dueAt:Date.parse(event.startISO)-5*60*1000,active:true,steps:{},status:'pending'};
      }
      job.status='complete';await this.store.write(state);
      this.safeLog('event_complete',event.requestId,{type:event.type,version:event.version});
    }catch(error){
      job.status='failed';job.failure=error.message==='STEP_PAUSED'?'ADAPTER_STEP_PAUSED':'INTERNAL_OR_PROTOCOL_FAILURE';
      await this.store.write(state);
      this.safeLog('event_paused',event.requestId,{code:job.failure});
    }
    return this.result(state,job);
  });}
  result(state,job){
    const failed=Object.entries(job.steps).find(([,step])=>step.status!=='complete');
    return {eventId:job.eventId,requestId:job.requestId,eventStatus:job.status,requestStatus:state.requests[job.requestId]?.status??'unknown',shortcode:state.requests[job.requestId]?.shortcode??null,...(failed?{pausedStep:failed[0],code:failed[1].code??'PENDING',notBefore:failed[1].notBefore??null}:{})};
  }
  sendDueReminders({resumeFailed=false}={}){return this.exclusive(async()=>{
    const state=await this.store.read();let sent=0;
    for(const reminder of Object.values(state.reminders)){
      const request=state.requests[reminder.requestId];
      if(!reminder.active||reminder.status==='complete'||reminder.status==='failed'&&!resumeFailed||reminder.dueAt>this.clock.now()||request?.status!=='scheduled'||request.activeEventId||request.version!==reminder.version)continue;
      try{
        await this.step(state,reminder,'reminder',(key,context)=>this.adapters.invitation.remind({requestId:reminder.requestId,shortcode:request.shortcode,version:reminder.version,...request.details},key,context),{resume:resumeFailed});
        reminder.status='complete';reminder.active=false;sent++;await this.store.write(state);
      }catch{reminder.status='failed';await this.store.write(state);}
    }
    return {sent};
  });}
}
