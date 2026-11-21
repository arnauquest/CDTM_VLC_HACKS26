import { randomUUID, createHash } from 'node:crypto';
import { analyzeAcoustics } from './acoustic.mjs';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message,status=422) => Object.assign(new Error(message),{status});
const communicationHash = c => hash({draft:c.draft,channel:c.contact.channel});
const clean = (s,n=20000) => typeof s==='string'?s.slice(0,n):'';
export class Engine {
 constructor({store,ai,voice,concurrency=2,acoustic=analyzeAcoustics,acousticOptions={},wallNow=()=>new Date().toISOString()}) { Object.assign(this,{store,ai,voice,concurrency,acoustic,acousticOptions,wallNow});this.running=0;this.activeJobs=new Set();this.locks=new Map();this.stopped=true; }
 trace(stage,status,message,extra={}) { return this.store.trace({stage,status,message,...extra}); }
 start(){this.stopped=false;this.store.recoverJobs(this.wallNow());this.seedSchedules();this.timer=setInterval(()=>this.tick(),500);this.timer.unref();this.tick();}
 stop(){this.stopped=true;clearInterval(this.timer);}
 queue(stage,data){return this.store.put('jobs',{...data,stage,status:'queued',attempts:0,retry_at:this.wallNow()});}
 createEvent(input,actor={role:'advisor'}) {
  const origin=actor.role==='client'?'client_form':input.origin||'advisor_input';
  const scope=actor.role==='client'?'family':input.scope||'global';
  if(!['family','family_set','global'].includes(scope))throw fail('Invalid event scope');
  let ids=actor.role==='client'?[actor.family_id]:input.family_ids||[];
  if(!Array.isArray(ids))throw fail('family_ids must be an array');
  ids=[...new Set(ids)];for(const id of ids)this.store.getFamily(id);
  if(scope!=='global'&&!ids.length)throw fail('Directed events require a family');
  if(!clean(input.summary).trim())throw fail('Event summary is required');
  const dedupeKey=input.dedupe_key?`${actor.role==='client'?actor.family_id+':':''}${clean(input.dedupe_key,200)}`:randomUUID();
  const existing=this.store.list('events',{dedupe_key:dedupeKey})[0];if(existing)return existing;
  const event=this.store.transaction(()=>{
   const e=this.store.put('events',{origin,scope,family_ids:ids,kind:clean(input.kind,80)||'update',summary:clean(input.summary),payload:input.payload||{},source_refs:input.source_refs||[],occurred_at:input.occurred_at||this.store.now(),observed_at:this.store.now(),simulated:input.simulated!==false,dedupe_key:dedupeKey,status:'queued',actor:actor.role});
   const families=scope==='global'?this.store.listFamilies():ids.map(id=>this.store.getFamily(id));
   for(const family of families)this.queue('assessment',{event_id:e.id,family_id:family.id,dedupe_key:`${e.id}:${family.id}:assessment`});
   this.trace('event','queued',`Event accepted for ${families.length} families`,{event_id:e.id,data:{scope,families:families.map(f=>f.id)}});return e;
  });this.tick();return event;
 }
 async tick(){if(this.stopped||this.ticking||this.scheduling)return;this.ticking=true;try{for(const id of this.activeJobs){const active=this.store.get('jobs',id);if(active?.status==='leased'&&Date.parse(active.lease_until)-Date.parse(this.wallNow())<60000)this.store.patch('jobs',id,{lease_until:new Date(Date.parse(this.wallNow())+180000).toISOString()});}this.store.recoverJobs(this.wallNow());this.runDue();while(this.running<this.concurrency){const job=this.store.claimJob(this.wallNow(),180000);if(!job)break;this.running++;this.activeJobs.add(job.id);this.runJob(job).finally(()=>{this.activeJobs.delete(job.id);this.running--;this.tick();});}}catch(e){this.trace('worker','failed',clean(e.message,300));}finally{this.ticking=false;}}
 async runJob(job){try{if(job.stage==='post_analysis')await this.post(job);else await this.assess(job);this.store.patch('jobs',job.id,{status:'completed',completed_at:this.store.now(),lease_until:null});}catch(e){const retry=(job.attempts||1)<2&&e.status!==422;this.store.patch('jobs',job.id,{status:retry?'queued':'failed',retry_at:new Date(Date.parse(this.wallNow())+5000).toISOString(),error:clean(e.message,400),lease_until:null});if(job.conversation_id&&this.store.get('conversations',job.conversation_id))this.store.patch('conversations',job.conversation_id,{analysis_state:retry?'pending':'failed',analysis_error:clean(e.message,400)});this.trace(job.stage,'failed',clean(e.message,400),{event_id:job.event_id,family_id:job.family_id,data:{job_id:job.id,retrying:retry}});}finally{if(job.event_id){const pending=this.store.list('jobs',{event_id:job.event_id}).filter(x=>['queued','leased'].includes(x.status));if(!pending.length){const failed=this.store.list('jobs',{event_id:job.event_id}).some(x=>x.status==='failed');this.store.patch('events',job.event_id,{status:failed?'needs_attention':'completed'});}}}}
 async assess(job){
  const previous=this.store.get('executions',job.id);if(previous){if(previous.communication_id)await this.deliver(previous.communication_id);return;}
  const event=this.store.get('events',job.event_id);if(!event)throw fail('Event missing',404);
  if(event.scope!=='global'&&!event.family_ids.includes(job.family_id))throw fail('Job family is outside event scope',403);
  const dueFollowup=event.payload?.followup_id&&this.store.get('followups',event.payload.followup_id);
  if(dueFollowup&&(dueFollowup.family_id!==job.family_id||['cancelled','resolved'].includes(dueFollowup.state)))return;
  let family=this.store.context(job.family_id);const policy=this.store.getPolicy();
  this.trace('scope','completed',event.scope==='family'?'Directed event: relevance classification bypassed':'Family included by event scope',{event_id:event.id,family_id:family.id});
  if(event.scope!=='family'&&!job.instruction){this.trace('relevance','running','Evaluating financial and relationship relevance',{event_id:event.id,family_id:family.id});const relevance=await this.ai.relevance({event,family});this.store.put('assessments',{event_id:event.id,family_id:family.id,kind:'relevance',result:relevance});this.trace('relevance','completed',relevance.reason||relevance.route_reason||relevance.route,{event_id:event.id,family_id:family.id,data:relevance});if(relevance.route==='discard'){this.store.put('executions',{id:job.id,family_id:family.id});return;}}
  this.trace('assessment','running','Preparing this family’s next useful contact',{event_id:event.id,family_id:family.id});
  const result=await this.ai.assess({event,family,policy,now:this.store.now(),instruction:job.instruction});
  if(result.family_id!==family.id)throw fail('Agent returned another family');
  if(result.expected_state_version!==undefined&&result.expected_state_version!==family.version)throw fail('Agent returned a stale family version',409);
  const communication=this.store.transaction(()=>{
   if(this.store.getFamily(family.id).version!==family.version)throw fail('Family changed during analysis; retrying',409);
   this.store.put('assessments',{event_id:event.id,family_id:family.id,kind:'assessment',result});
   let changes=result.fact_changes||[];const pending=changes.filter(c=>c.status==='needs_confirmation'||!['client_form','client_message','advisor_input'].includes(event.origin)||(/^household\.\d+$/.test(c.field_path?.replace(/^facts\./,''))&&event.actor!=='advisor'));
   for(const change of pending)this.store.put('fact_proposals',{family_id:family.id,event_id:event.id,change,state:'pending',dedupe_key:hash([event.id,family.id,change])});
   changes=changes.filter(c=>!pending.includes(c)).map(c=>({...c,status:event.actor==='advisor'?'confirmed':'self_reported',effective_at:c.effective_at||event.occurred_at||this.store.now(),evidence_ref:c.evidence_ref||event.id}));
   if(changes.length)this.store.updateFamily(family.id,{expectedVersion:family.version,factChanges:changes},event.actor||'system');
   family=this.store.getFamily(family.id);
   this.trace('facts','completed',changes.length?`${changes.length} facts updated with history`:'Financial facts unchanged',{event_id:event.id,family_id:family.id,data:{applied:changes,pending}});
   for(const proposal of result.followup_proposals||[])this.schedule(family.id,proposal,{event_id:event.id});
   const contact=result.contact;
   this.trace('contact_decision','completed',contact.reason,{event_id:event.id,family_id:family.id,data:contact});
   if(dueFollowup)this.store.patch('followups',dueFollowup.id,{state:contact.decision==='none'?'resolved':'evaluated',evaluation_event_id:event.id});
   let c=null;
   if(['now','needs_information'].includes(contact.decision)&&(result.draft?.text||result.draft?.voice_script)){
    const person_ids=contact.person_ids?.length?contact.person_ids:[family.people[0].id];
    if(person_ids.some(id=>!family.people.some(p=>p.id===id)))throw fail('Unknown communication recipient');
    c=this.store.put('communications',{event_id:event.id,family_id:family.id,person_ids,contact:{...contact,channel:contact.channel||'browser_voice',requires_review:contact.requires_review||pending.length>0},draft:result.draft,content_version:1,facts_hash:hash(family.facts),state:'prepared',policy_version:policy.version,assessment:result,dedupe_key:`${event.id}:${family.id}:contact:${job.instruction?job.id:'initial'}`});
   }
   this.store.put('executions',{id:job.id,family_id:family.id,communication_id:c?.id});return c;
  });
  if(communication)await this.deliver(communication.id);
 }
 async deliver(id){let c=this.store.get('communications',id);if(!c)throw fail('Communication not found',404);if(['rejected','cancelled','completed','superseded'].includes(c.state))return c;
  const policy=this.store.getPolicy(), family=this.store.getFamily(c.family_id);
  if(c.facts_hash!==hash(family.facts)){return this.store.patch('communications',id,{state:'awaiting_review',stale:true,review_reason:'Financial facts changed; prepare a revised communication'});}
  const approval=c.approval&&c.approval.content_hash===communicationHash(c)&&c.approval.facts_hash===c.facts_hash;
  const requires=policy.mode==='manual'||c.contact.requires_review;
  if(requires&&!approval){c=this.store.patch('communications',id,{state:'awaiting_review',policy_version:policy.version,authorization_kind:null});this.trace('approval','waiting','Advisor review required',{event_id:c.event_id,family_id:c.family_id,data:{communication_id:id,mode:policy.mode,reasons:c.contact.review_reasons}});return c;}
  if(c.state==='delivered'&&c.policy_version===policy.version&&c.authorization_kind===(approval?'advisor_approval':'policy_auto'))return c;
  c=this.store.patch('communications',id,{state:'delivered',policy_version:policy.version,authorization_kind:approval?'advisor_approval':'policy_auto',delivered_at:c.delivered_at||this.store.now(),delivery_kind:'simulated_in_app'});
  this.trace('delivery','completed','Available in the client inbox',{event_id:c.event_id,family_id:c.family_id,data:{communication_id:id,channel:c.contact.channel,authorization:c.authorization_kind}});return c;
 }
 async approve(id,{content_version,facts_hash,channel},actor){
  if(channel!==undefined&&!['browser_voice','text','audio'].includes(channel))throw fail('Invalid communication channel');
  this.store.transaction(()=>{let c=this.store.get('communications',id);if(!c)throw fail('Communication not found',404);if(['rejected','cancelled','completed','superseded'].includes(c.state))throw fail('This communication cannot be approved',409);if(content_version!==c.content_version||facts_hash!==c.facts_hash)throw fail('Review version changed',409);if(hash(this.store.getFamily(c.family_id).facts)!==c.facts_hash)throw fail('Facts changed; request a revision',409);
   if(channel&&channel!==c.contact.channel){const oldChannel=c.contact.channel;c=this.store.patch('communications',id,{contact:{...c.contact,channel},content_version:c.content_version+1});this.store.put('audit_log',{actor:actor.id||actor.role,action:'communication_channel_selected',target_id:id,family_id:c.family_id,before_channel:oldChannel,after_channel:channel,before_version:content_version,after_version:c.content_version});}
   const approval=this.store.put('approvals',{communication_id:id,reviewer_id:actor.id||actor.role,content_version:c.content_version,channel:c.contact.channel,content_hash:communicationHash(c),facts_hash,approved_at:this.store.now()});this.store.patch('communications',id,{approval,stale:false});
  });return this.deliver(id);
 }
 reject(id,reason='Rejected by advisor'){const c=this.store.patch('communications',id,{state:'rejected',rejection_reason:clean(reason,500)});this.trace('approval','rejected',c.rejection_reason,{family_id:c.family_id,event_id:c.event_id});return c;}
 requestChanges(id,instruction){const c=this.store.get('communications',id);if(!c)throw fail('Communication not found',404);if(!clean(instruction).trim())throw fail('Changes instruction required');this.store.patch('communications',id,{state:'superseded'});return this.queue('assessment',{event_id:c.event_id,family_id:c.family_id,instruction:clean(instruction),dedupe_key:`revision:${id}:${randomUUID()}`});}
 async setMode(mode,version){const p=this.store.setPolicy(mode,version);for(const c of this.store.list('communications'))if(['awaiting_review','prepared','delivered'].includes(c.state))await this.deliver(c.id);return p;}
 schedule(family_id,p,origin={}){const family=this.store.getFamily(family_id);if(!p.purpose)return null;const ids=p.person_ids?.length?p.person_ids:[family.people[0].id];if(ids.some(id=>!family.people.some(x=>x.id===id)))throw fail('Invalid follow-up recipient');const due=p.due_at&&Number.isFinite(Date.parse(p.due_at))?new Date(p.due_at).toISOString():null;
  return this.store.put('followups',{family_id,person_ids:ids,purpose:clean(p.purpose,2000),due_at:due,timezone:p.timezone||'America/Chicago',cancel_conditions:p.cancel_conditions||[],timing_basis:p.timing_basis||'Agent proposal',state:due?'scheduled':'pending_date',...origin,dedupe_key:p.dedupe_key||hash([family_id,origin.conversation_id||origin.event_id,p.purpose])});}
 seedSchedules(){for(const f of this.store.listFamilies()){this.schedule(f.id,{purpose:'Monthly relationship review: check for unresolved questions and useful updates; no contact is required if nothing is useful.',due_at:new Date(Date.parse(this.store.now())+30*86400000).toISOString(),dedupe_key:`monthly:${f.id}:initial`},{recurrence:'monthly'});for(const goal of f.source?.financial?.goals?.chartGoals||[]){const at=Date.parse(goal.date)-30*86400000;if(at>Date.parse(this.store.now())&&at<Date.parse(this.store.now())+730*86400000)this.schedule(f.id,{purpose:`Prepare for upcoming goal: ${goal.name} on ${goal.date}`,due_at:new Date(at).toISOString(),dedupe_key:`goal:${f.id}:${goal.name}:${goal.date}`},{kind:'milestone'});}}}
 runDue(){if(this.scheduling)return;this.scheduling=true;try{for(const f of this.store.list('followups',{state:'scheduled'})){if(Date.parse(f.due_at)>Date.parse(this.store.now()))continue;this.store.transaction(()=>{if(this.store.get('followups',f.id).state!=='scheduled')return;this.store.patch('followups',f.id,{state:'evaluating'});const event=this.createEvent({origin:'scheduler',kind:'followup',scope:'family',family_ids:[f.family_id],summary:f.purpose,payload:{followup_id:f.id,cancel_conditions:f.cancel_conditions,conversation_id:f.conversation_id},dedupe_key:`due:${f.id}`,simulated:true},{role:'system'});this.store.patch('followups',f.id,{evaluation_event_id:event.id});if(f.recurrence==='monthly')this.schedule(f.family_id,{...f,due_at:new Date(Date.parse(f.due_at)+30*86400000).toISOString(),dedupe_key:`monthly:${f.family_id}:${f.due_at}`},{recurrence:'monthly'});});}}finally{this.scheduling=false;}}
 async startConversation(id,{person_id,audio=true}={}){return this.withLock(`start:${id}`,async()=>{
  const old=this.store.list('conversations',{communication_id:id}).find(x=>x.state==='active');if(old){if(person_id&&old.person_id!==person_id)throw fail('Conversation belongs to another recipient',403);return old;}
  let c=await this.deliver(id);if(c.state!=='delivered')throw fail('Communication is not authorized for delivery',409);person_id||=c.person_ids[0];if(!c.person_ids.includes(person_id))throw fail('Recipient is outside this communication',403);
  const opening=c.contact.channel==='text'?c.draft.text:c.draft.voice_script||c.draft.text;if(!clean(opening).trim())throw fail('Prepared opening is missing for the approved channel');const preparedHash=communicationHash(c);let audioResult=null,audio_error=null;if(audio)try{audioResult=await this.voice.synthesize({text:opening});}catch(e){audio_error=clean(e.message,200);}
  c=await this.deliver(id);if(c.state!=='delivered'||communicationHash(c)!==preparedHash)throw fail('Authorization or preparation changed before conversation start',409);
  const conversation=this.store.put('conversations',{family_id:c.family_id,person_id,communication_id:id,event_id:c.event_id,bundle:c.draft,authorization:c.authorization_kind,state:'active',started_at:this.store.now(),turns:[{id:randomUUID(),role:'assistant',text:opening,start_ms:0,end_ms:0,audio:audioResult,created_at:this.store.now()}],audio_error});this.trace('conversation','started','Client conversation opened',{event_id:c.event_id,family_id:c.family_id,data:{conversation_id:conversation.id}});return conversation;
 });}
 async withLock(id,fn){const previous=this.locks.get(id)||Promise.resolve();const current=previous.catch(()=>{}).then(fn);this.locks.set(id,current);try{return await current;}finally{if(this.locks.get(id)===current)this.locks.delete(id);}}
 async turn(id,input){return this.withLock(id,async()=>{let c=this.store.get('conversations',id);if(!c||c.state!=='active')throw fail('Conversation is not active',409);const key=input.request_id?`${id}:${input.request_id}`:randomUUID();const prior=this.store.list('turn_requests',{dedupe_key:key})[0];if(prior?.state==='completed')return prior.result;
  let transcription=null,text=clean(input.text,6000);if(input.audio_base64){transcription=await this.voice.transcribe(input);text=transcription.text;}if(!text.trim())throw fail('A spoken or written response is required');
  const elapsed=Math.max(0,Date.parse(this.store.now())-Date.parse(c.started_at));const userTurn={id:prior?.user_turn_id||randomUUID(),role:'user',text,audio:transcription,start_ms:elapsed,end_ms:elapsed,created_at:this.store.now()};
  if(!c.turns.some(t=>t.id===userTurn.id)){c=this.store.patch('conversations',id,{turns:[...c.turns,userTurn]});}
  const request=this.store.put('turn_requests',{id:prior?.id,dedupe_key:key,conversation_id:id,family_id:c.family_id,user_turn_id:userTurn.id,state:'processing'});
  try{const reply=await this.voice.reply({bundle:c.bundle,family:this.store.context(c.family_id),turns:c.turns.slice(0,-1),userText:text});let audioResult=null,audio_error=null;if(input.audio!==false)try{audioResult=await this.voice.synthesize({text:reply.text});}catch(e){audio_error=clean(e.message,200);}
   const assistantTurn={id:randomUUID(),role:'assistant',text:reply.text,audio:audioResult,start_ms:elapsed,end_ms:elapsed,created_at:this.store.now()};c=this.store.patch('conversations',id,{turns:[...c.turns,assistantTurn],handoff_requested:c.handoff_requested||reply.handoff_requested});const result={conversation:c,reply:assistantTurn,audio_error};this.store.patch('turn_requests',request.id,{state:'completed',result});this.trace('conversation_turn','completed',reply.handoff_requested?'Human assistance requested':'Response prepared within conversation scope',{family_id:c.family_id,event_id:c.event_id,data:{conversation_id:id,credential:reply.credential}});return result;
  }catch(e){this.store.patch('turn_requests',request.id,{state:'failed',error:clean(e.message,300)});throw e;}});}
 async checkIn(id,{value,request_id}={}){return this.withLock(id,async()=>{
  const c=this.store.get('conversations',id);if(!c||c.state!=='active')throw fail('Conversation is not active',409);
  if(typeof value!=='string'||!value.trim()||value.length>1000)throw fail('Invalid check-in');
  const dedupe_key=request_id?`${id}:checkin:${request_id}`:hash([id,'checkin',value]);
  if(c.turns.some(t=>t.dedupe_key===dedupe_key))return c;
  const elapsed=Math.max(0,Date.parse(this.store.now())-Date.parse(c.started_at));const turn={id:randomUUID(),role:'user',person_id:c.person_id,text:value,evidence_kind:'explicit_checkin',dedupe_key,start_ms:elapsed,end_ms:elapsed,audio:null,created_at:this.store.now()};
  return this.store.patch('conversations',id,{self_report:{value,person_id:c.person_id,at:this.store.now(),evidence_ref:turn.id},turns:[...c.turns,turn]});
 });}
 async acousticEvidence(c){
  const inputs=(c.turns||[]).filter(t=>t.role==='user'&&t.audio?.audio_id).map(t=>{
   const a=t.audio;const ends=(a.words||[]).map(w=>w.end).filter(Number.isFinite);const duration=ends.length?Math.max(...ends)*1000:null;
   return {schema_version:'1',conversation_id:c.id,family_id:c.family_id,person_id:t.person_id||c.person_id,
    audio:{audio_id:a.audio_id,path:a.path,mime:a.mime,sha256:a.sha256,bytes:a.bytes},
    speaker_segments:[{person_id:t.person_id||c.person_id,role:'customer',start_ms:0,end_ms:duration,attribution:'authenticated_session_recipient'}],
    time_mapping:{turn_id:t.id,audio_start_ms:0,audio_end_ms:duration,conversation_start_ms:t.start_ms,conversation_end_ms:t.end_ms,alignment_basis:'turn_timestamp; word timestamps relative to recording'},
    language:a.language_code||null,transcript_ref:{conversation_id:c.id,turn_id:t.id,text:t.text,words:a.words||[]}};
  });
  this.store.patch('conversations',c.id,{acoustic_inputs:inputs,customer_audio_refs:inputs.map(x=>x.audio)});
  const results=[];for(const input of inputs)results.push(await this.acoustic(input,this.acousticOptions));
  if(!results.length)results.push(await this.acoustic({conversation_id:c.id,family_id:c.family_id,person_id:c.person_id},this.acousticOptions));
  const status=['available','pending','failed','low_quality','no_speech','unavailable','not_configured'].find(state=>results.some(r=>r.status===state));
  return {schema_version:'1',conversation_id:c.id,family_id:c.family_id,person_id:c.person_id,status,reason_code:results[0].reason_code,
   evidence_basis:results.flatMap(r=>r.evidence_basis||[]),observations:results.flatMap(r=>r.observations||[]),measurements:results.flatMap(r=>r.measurements||[]),
   customer_audio_refs:inputs.map(x=>x.audio),turn_results:results.map((r,i)=>({...r,turn_id:inputs[i]?.time_mapping.turn_id||null})),
   quality:{warnings:results.length>1&&results.some(r=>r.status!==status)?['Mixed per-turn acoustic availability; inspect turn_results']:[]}};
 }
 async finish(id){return this.withLock(id,async()=>{const c=this.store.get('conversations',id);if(!c)throw fail('Conversation missing',404);if(c.state==='completed')return c;const done=this.store.patch('conversations',id,{state:'completed',ended_at:this.store.now(),analysis_state:'pending'});this.store.patch('communications',c.communication_id,{state:'completed'});this.queue('post_analysis',{family_id:c.family_id,event_id:c.event_id,conversation_id:id,dedupe_key:`post:${id}:${hash(c.turns)}`});this.trace('conversation','completed','Conversation complete; relationship analysis queued',{family_id:c.family_id,event_id:c.event_id,data:{conversation_id:id}});this.tick();return done;});}
 async post(job){
  if(this.store.get('executions',job.id))return;
  const c=this.store.get('conversations',job.conversation_id);if(!c)throw fail('Conversation missing',404);if(c.family_id!==job.family_id)throw fail('Conversation is outside job family',403);
  const family=this.store.context(job.family_id),event=this.store.get('events',c.event_id);this.trace('relationship_analysis','running','Reviewing words, context and explicit preferences',{family_id:family.id,event_id:c.event_id});
  const acousticResult=await this.acousticEvidence(c);
  const result=await this.ai.postAnalyze({conversation:c,event,family,policy:this.store.getPolicy(),now:this.store.now(),acousticResult});
  if(result.family_id!==family.id||result.conversation_id!==undefined&&result.conversation_id!==c.id)throw fail('Analysis returned another family or conversation');
  const normalize=s=>String(s||'').replace(/\s+/g,' ').trim();
  const hasQuote=(person,quote)=>normalize(quote)&&c.turns.some(t=>t.role==='user'&&(t.person_id||c.person_id)===person&&normalize(t.text).includes(normalize(quote)));
  const observations=(result.observation_additions||[]).map(o=>({...o,conversation_id:c.id}));
  for(const o of observations){if(!family.people.some(p=>p.id===o.person_id))throw fail('Observation attributed to unknown person');if(!hasQuote(o.person_id,o.quote))throw fail('Observation quote not found in client transcript');}
  const preferences=(result.preference_changes||[]).map(p=>{if(!hasQuote(p.person_id,p.quote))throw fail('Preference quote not found in client transcript');return {person_id:p.person_id,key:p.field_path||p.key,value:p.new_value??p.value,evidence_ref:p.evidence_ref||c.id,explicit_request:true};});
  this.store.transaction(()=>{
   const proposed=(result.fact_changes||[]).filter(x=>x.status==='needs_confirmation'||/^household\.\d+$/.test(x.field_path?.replace(/^facts\./,'')));
   for(const change of proposed)this.store.put('fact_proposals',{family_id:family.id,conversation_id:c.id,event_id:c.event_id,change,state:'pending',dedupe_key:hash([c.id,change])});
   this.store.updateFamily(family.id,{expectedVersion:family.version,observations,preferenceChanges:preferences,factChanges:(result.fact_changes||[]).filter(x=>!proposed.includes(x)).map(x=>({...x,status:'self_reported',effective_at:x.effective_at||c.ended_at||this.store.now(),evidence_ref:x.evidence_ref||c.id})),openQuestions:result.open_questions,summary:result.summary},'relationship_agent');
   for(const p of result.followup_proposals||[])this.schedule(family.id,p,{conversation_id:c.id,event_id:c.event_id});
   this.store.put('assessments',{family_id:family.id,event_id:c.event_id,conversation_id:c.id,kind:'relationship',result,acoustic:acousticResult});
   this.store.patch('conversations',c.id,{analysis_state:'completed',analysis_error:null,acoustic_status:acousticResult.status,acoustic_result:acousticResult});
   this.store.put('executions',{id:job.id,family_id:family.id,conversation_id:c.id});
   this.trace('relationship_analysis','completed','Profile updated and useful follow-ups scheduled',{family_id:family.id,event_id:c.event_id,data:{conversation_id:c.id,observations:observations.length,followups:result.followup_proposals,acoustic_status:acousticResult.status}});
  });
 }
}
