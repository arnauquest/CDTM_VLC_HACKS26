import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.mjs';
import { handleFrontendAdmin } from './frontend-admin.mjs';

const ADMIN = { id:'local-admin',role:'admin' };
const FAMILY = 'michael-carter';
function fixture(t) {
  const store = new Store().init(); t.after(()=>store.close());
  const env = { OPENAI_API_KEY:'private-openai-test-key', ELEVENLABS_API_KEY:'private-eleven-test-key', ELEVENLABS_VOICE_ID:'configured-voice', VOICE_ANALYSIS_PROVIDER:'none' };
  const ai = { capabilities:()=>({agent_provider:'codex'}), assess:()=>{throw new Error('Provider must not run');} };
  const request = (path,method='GET',input={},session=ADMIN) => handleFrontendAdmin({path,method,input,session,store,ai,env,url:new URL(path,'http://localhost')});
  return {store,env,request};
}

test('published brand is public; draft is separate and publishing/reset persist truthful fields', async t => {
  const {store,request} = fixture(t);
  const initial = (await request('/brand','GET',{},null)).body;
  assert.equal(initial.integrationActive,false); assert.equal(initial.voiceProfileId,'configured-voice');
  assert.equal(await request('/families'),null);
  await request('/brand/draft','PUT',{appName:'Nueva marca',colors:{primary:'#123abc'}});
  assert.equal((await request('/brand','GET',{},null)).body.appName,'sherpas');
  const published = (await request('/brand/publish','POST')).body;
  assert.equal(published.appName,'Nueva marca'); assert.equal(published.colors.primary,'#123ABC');
  await request('/brand/reset','POST');
  assert.equal((await request('/brand','GET',{},null)).body.appName,'Nueva marca');
  await request('/brand/publish','POST'); assert.equal((await request('/api/brand','GET',{},null)).body.appName,'sherpas');
  assert.equal(store.list('audit_log').filter(a=>a.action==='brand_published').length,2);
});

test('brand mutations require admin and reject script URLs, SVG, foreign voices and injected CSS', async t => {
  const {request} = fixture(t);
  await assert.rejects(request('/brand/publish','POST',{},null),{status:401});
  await assert.rejects(request('/brand/publish','POST',{}, {role:'advisor'}),{status:403});
  for (const payload of [{logoUrl:'javascript:alert(1)'},{logoUrl:'https://example.com/track.png'},{colors:{primary:'red; background:url(x)'}},{fontUrl:'https://example.com/font.css'},{voiceProfileId:'invented-clone'},{__bad:'field'}]) await assert.rejects(request('/brand/draft','PUT',payload),{status:422});
  await assert.rejects(request('/brand/assets','POST',{kind:'logo',dataUrl:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}),{status:422});
  await assert.rejects(request('/brand/assets','POST',{kind:'logo',dataUrl:'data:image/png;base64,SGVsbG8='}),{status:422});
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const upload = await request('/brand/assets','POST',{kind:'logo',dataUrl:png}); assert.equal(upload.status,201); assert.equal(upload.body.url,png);
  assert.equal((await request('/brand/publish','POST',{logoUrl:png})).body.logoUrl,png);
  assert.deepEqual((await request('/brand/voices')).body.map(v=>v.id),['configured-voice']);
});

test('summary uses real families and assessment decisions, unknown metrics remain null', async t => {
  const {store,request} = fixture(t);
  const empty = (await request('/admin/summary')).body; assert.equal(empty.activeFamilies,4); assert.equal(empty.activeConsultants,1); assert.equal(empty.silenceRate,null); assert.equal(empty.slaMinutes,null);
  store.put('assessments',{event_id:'one',family_id:FAMILY,kind:'assessment',result:{contact:{decision:'now'}}});
  store.put('assessments',{event_id:'one',family_id:FAMILY,kind:'assessment',result:{contact:{decision:'none'}}});
  store.put('assessments',{event_id:'two',family_id:FAMILY,kind:'assessment',result:{contact:{decision:'now'}}});
  const summary = (await request('/admin/summary')).body; assert.equal(summary.assessmentCount,2); assert.equal(summary.silenceRate,0.5);
  const workload = (await request('/admin/consultants/workload')).body; assert.equal(workload.length,1); assert.equal(workload[0].id,'local-advisor'); assert.equal(workload[0].capacity,null);
  assert.deepEqual((await request('/admin/consultants/workload?filter=overloaded')).body,[]);
});

test('notifications scope client communications and report actionable items without fabricated read receipts', async t => {
  const {store,request} = fixture(t);
  store.put('communications',{family_id:FAMILY,state:'delivered'}); store.put('communications',{family_id:'samantha-lewis',state:'delivered'}); store.put('communications',{family_id:FAMILY,state:'awaiting_review'});
  store.put('jobs',{status:'failed'}); store.put('conversations',{family_id:FAMILY,handoff_requested:true});
  const client = (await request('/notifications/count','GET',{}, {role:'client',family_id:FAMILY})).body;
  assert.equal(client.unread,1); assert.equal(client.readReceiptsTracked,false);
  assert.equal((await request('/notifications/count')).body.unread,3);
  await assert.rejects(request('/admin/summary','GET',{}, {role:'client',family_id:FAMILY}),{status:403});
});

test('compliance CSV exports actual durable records and neutralizes formula injection and secrets', async t => {
  const {store,env,request} = fixture(t);
  store.put('audit_log',{actor:'=HYPERLINK("https://example.com")',action:`note ${env.OPENAI_API_KEY}`,family_id:FAMILY});
  const report = await request('/admin/compliance/report'); assert(Buffer.isBuffer(report.body)); assert.match(report.headers['Content-Type'],/text\/csv/);
  const text = report.body.toString('utf8'); assert(text.includes(FAMILY)); assert(text.includes('source_documents')); assert(text.includes("'=HYPERLINK")); assert(!text.includes(env.OPENAI_API_KEY)); assert(text.includes('[redacted]'));
});

test('integration diagnostics reveal configuration only and billing never invents subscriptions or charges', async t => {
  const {store,env,request} = fixture(t);
  const items = (await request('/admin/integrations')).body; assert.equal(items.find(i=>i.id==='openai').configured,true); assert.equal(items.find(i=>i.id==='acoustic').configured,false);
  const checked = (await request('/admin/integrations/openai/verify','POST')).body; assert.equal(checked.diagnostic.networkChecked,false); assert.equal(checked.status,'pending');
  const all = JSON.stringify({items,checked}); assert(!all.includes(env.OPENAI_API_KEY)); assert(!all.includes(env.ELEVENLABS_API_KEY));
  assert.equal(store.list('audit_log').at(-1).action,'integration_configuration_checked');
  const billing = (await request('/admin/billing')).body; assert.equal(billing.configured,false); assert.equal(billing.chargesEnabled,false); assert.equal(billing.renewalDate,null);
  await assert.rejects(request('/admin/billing/seats','POST'),{status:409}); await assert.rejects(request('/admin/billing/invoices'),{status:404});
});

test('onboarding preference persists without creating families, identity and guardrail changes fail explicitly', async t => {
  const {store,request} = fixture(t);
  assert.deepEqual((await request('/admin/onboarding/queue')).body,[]);
  await request('/admin/onboarding/settings','PUT',{autoAccept:true}); assert.equal((await request('/admin/onboarding/settings')).body.autoAccept,true); assert.equal(store.listFamilies().length,4);
  const users = (await request('/admin/users')).body; assert(users.every(u=>u.localDemo)); assert.equal(users.find(u=>u.role==='consultor').familiesAssigned,4);
  const rules = (await request('/admin/governance/guardrails')).body; assert(rules.every(r=>r.enabled&&!r.editable)); assert(!JSON.stringify(rules).includes('FINRA'));
  for(const [route,method] of [['/admin/users','POST'],['/admin/users/local-advisor','PATCH'],['/admin/governance/guardrails/family_scope','PATCH'],['/admin/portfolios/reassign','POST']]) await assert.rejects(request(route,method),{status:409});
  await assert.rejects(request('/admin/onboarding/missing/accept','POST'),{status:404});
});
