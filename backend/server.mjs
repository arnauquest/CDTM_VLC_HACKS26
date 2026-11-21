import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store } from './store.mjs';
import { Engine } from './engine.mjs';
import { handleFrontendAdvisor } from './frontend-advisor.mjs';
import { handleFrontendAdmin } from './frontend-admin.mjs';
import { handleFrontendClient } from './frontend-client.mjs';
import { createAI } from './ai.mjs';
import { createVoice } from './voice.mjs';
import { createOpenAIRouterFromEnv } from '../config/openai-failover.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const error=(message,status=422)=>Object.assign(new Error(message),{status});
export function createApplication({rootDir=ROOT,env=process.env,store:injectedStore,ai:injectedAI,voice:injectedVoice,startWorker=true}={}){
 const store=injectedStore||new Store({dbPath:resolve(rootDir,env.SQLITE_PATH||'var/sherpas.sqlite3'),casesDir:resolve(rootDir,env.SHERPAS_CASES_DIR||'../../referencias/sherpas/recursos-oficiales/cases'),mode:env.COMMUNICATION_MODE||'auto'}).init();
 const trace=e=>store.trace({stage:e.stage||e.operation||'provider',status:e.status||'info',message:e.message||e.operation||'Provider activity',...e});
 const router=env.OPENAI_API_KEY?createOpenAIRouterFromEnv(env,{onEvent:e=>trace({stage:'api_routing',message:`OpenAI ${e.label}`,data:e})}):null;
 const ai=injectedAI||createAI({rootDir,env,trace,router});const voice=injectedVoice||createVoice({rootDir,env,trace,router});
 const engine=new Engine({store,ai,voice,concurrency:Math.max(1,Math.min(4,Number(env.AGENT_MAX_CONCURRENCY)||2))});
 const sessions=new Map();const allowedOrigins=new Set([`http://localhost:${env.APP_PORT||3000}`,`http://127.0.0.1:${env.APP_PORT||3000}`,'http://localhost:5173','http://127.0.0.1:5173',...(env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
 const safeMessage=e=>{let m=String(e.message||'Request failed');for(const [k,v]of Object.entries(env))if(v&&/KEY|TOKEN|SECRET/.test(k))m=m.split(v).join('[redacted]');return m.slice(0,600);};
 const redact=value=>{if(typeof value!=='string')return value;for(const [key,secret]of Object.entries(env))if(typeof secret==='string'&&secret&&/KEY|TOKEN|SECRET/i.test(key))value=value.split(secret).join('[redacted]');return value;};
 const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data,(_key,value)=>redact(value)));};
 async function body(req){if(req.parsedJson)return req.parsedJson;let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>15*1024*1024)throw error('Request body too large',413);chunks.push(chunk);}try{const value=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};if(!value||typeof value!=='object'||Array.isArray(value))throw error('Object body required',400);req.parsedJson=value;return value;}catch{throw error('Invalid JSON object body',400);}}
 function session(req){const token=req.headers.authorization?.replace(/^Bearer /,'')||req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sherpas_session='))?.slice(16);const s=sessions.get(token);if(!s||s.expires<Date.now())throw error('Choose a local demo session first',401);return s;}
 function advisor(s){if(!['admin','advisor'].includes(s.role))throw error('Advisor access required',403);}
 function familyAccess(s,id){store.getFamily(id);if(s.role==='client'&&s.family_id!==id)throw error('This family is outside your session',403);}
 function getEntity(s,type,id){const x=store.get(type,id);if(!x)throw error('Not found',404);if(x.family_id)familyAccess(s,x.family_id);else advisor(s);return x;}
 const sanitize=x=>JSON.parse(JSON.stringify(x,(key,value)=>key==='path'&&typeof value==='string'?undefined:value));
 const scoped=(s,type)=>store.list(type).filter(x=>s.role!=='client'||x.family_id===s.family_id);
 const visibleCommunication=(s,c)=>s.role!=='client'||['delivered','completed'].includes(c.state);
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if(origin){if(!allowedOrigins.has(origin)){send(res,{error:'Origin not allowed'},403);return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,Idempotency-Key'});res.end();return;}
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname.split('/').filter(Boolean);const method=req.method;
   if(!['GET','POST','PATCH','PUT'].includes(method))throw error('Method not allowed',405);
   if(method==='GET'&&url.pathname==='/'){res.writeHead(302,{Location:'/app/'});res.end();return;}
   if(method==='GET'&&url.pathname==='/app'){res.writeHead(302,{Location:'/app/'});res.end();return;}
   if(method==='GET'&&url.pathname.startsWith('/app/')){const base=resolve(rootDir,'ui/front');const file=resolve(base,decodeURIComponent(url.pathname.slice(5)||'index.html'));const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.webp':'image/webp'}[extname(file)];if(!file.startsWith(base+'/')||!mime)throw error('Asset not found',404);let bytes;try{bytes=await readFile(file);}catch{throw error('Asset not found',404);}res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);return;}
   if(method==='GET'&&url.pathname==='/ops'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(resolve(rootDir,'backend/public/ops.html')));return;}
   if(url.pathname==='/api/health'&&method==='GET'){send(res,{ok:true,local_demo:true,now:store.now(),mode:store.getPolicy(),providers:{agents:ai.capabilities(),voice:voice.capabilities(),acoustic:'not_configured'},running_jobs:engine.running});return;}
   if(url.pathname==='/api/session'&&method==='POST'){const input=await body(req);if(!['admin','advisor','client'].includes(input.role))throw error('Unknown role');if(input.role==='client')store.getFamily(input.family_id);const token=randomBytes(24).toString('hex');const s={id:randomBytes(8).toString('hex'),role:input.role,family_id:input.role==='client'?input.family_id:null,expires:Date.now()+12*3600000};sessions.set(token,s);res.setHeader('Set-Cookie',`sherpas_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);send(res,{...s,token,local_demo:true});return;}
   if(url.pathname==='/api/demo/families'&&method==='GET'){send(res,store.listFamilies().map(f=>({id:f.id,name:f.name})));return;}
   if(method==='GET'&&url.pathname==='/api/brand'){const r=await handleFrontendAdmin({path:url.pathname,method,input:{},session:null,store,engine,voice,ai,env,rootDir,url});send(res,r.body,r.status||200);return;}
   const s=session(req);
   if(path[0]!=='api')throw error('Route not found',404);
   if(url.pathname==='/api/session'&&method==='GET'){send(res,s);return;}
   if(url.pathname==='/api/me'&&method==='GET'){const family=s.role==='client'?store.getFamily(s.family_id):null;send(res,{id:family?.people[0]?.id||'local-advisor',name:family?.people[0]?.name||(s.role==='admin'?'Administrador local':'Asesor local'),avatarUrl:null,role:{advisor:'consultor',client:'cliente',admin:'admin'}[s.role],tenant:{id:'local-demo',name:'CDTM Valencia Hacks 2026'},family:family?{id:family.id,name:family.name}:undefined,local_demo:true});return;}
   if(url.pathname==='/api/auth/logout'&&method==='POST'){sessions.delete(req.headers.authorization?.replace(/^Bearer /,'')||req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('sherpas_session='))?.slice(16));res.setHeader('Set-Cookie','sherpas_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');send(res,{ok:true});return;}
   const adapterInput=method==='GET'?{}:await body(req);
   for(const handler of [handleFrontendAdvisor,handleFrontendClient,handleFrontendAdmin]){const r=await handler({path:url.pathname,method,input:adapterInput,session:s,store,engine,voice,ai,env,rootDir,url});if(r){if(r.headers){res.writeHead(r.status||200,{'Cache-Control':'no-store',...r.headers});res.end(Buffer.isBuffer(r.body)?r.body:String(r.body));}else send(res,sanitize(r.body),r.status||200);return;}}

   if(url.pathname==='/api/overview'&&method==='GET'){advisor(s);send(res,{policy:store.getPolicy(),now:store.now(),families:store.listFamilies().map(f=>({id:f.id,name:f.name,version:f.version,people:f.people,relationship:f.relationship,projection_status:f.projection_status})),events:store.list('events').slice(-100),jobs:store.list('jobs').slice(-100),communications:store.list('communications').slice(-100),followups:store.list('followups').slice(-100),conversations:sanitize(store.list('conversations').slice(-50)),traces:store.list('traces').slice(-150)});return;}
   if(path[1]==='policy'){advisor(s);send(res,method==='GET'?store.getPolicy():await(async()=>{const b=await body(req);return engine.setMode(b.mode,b.expected_version);})());return;}
   if(path[1]==='families'){
    if(path.length===2&&method==='GET'){send(res,store.listFamilies().filter(f=>s.role!=='client'||f.id===s.family_id).map(({source,...f})=>f));return;}
    const id=path[2];familyAccess(s,id);
    if(path.length===3&&method==='GET'){const f=store.getFamily(id);send(res,{...f,history:store.list('fact_changes',{family_id:id}),followups:store.list('followups',{family_id:id}),communications:store.list('communications',{family_id:id}).filter(c=>visibleCommunication(s,c)),conversations:sanitize(store.list('conversations',{family_id:id}))});return;}
    if(path[3]==='information'&&method==='POST'){const b=await body(req);send(res,engine.createEvent({origin:s.role==='client'?'client_form':'advisor_input',scope:'family',family_ids:[id],summary:b.summary||b.request,payload:{proposed_changes:b.changes||[],person_id:b.person_id},kind:b.kind||'client_update',dedupe_key:req.headers['idempotency-key']||b.request_id},{...s,family_id:id}),202);return;}
    if(path[3]==='facts'&&method==='PATCH'){advisor(s);const b=await body(req);send(res,store.updateFamily(id,{expectedVersion:b.expected_version,factChanges:b.changes.map(x=>({...x,status:'confirmed',effective_at:x.effective_at||store.now(),evidence_ref:x.evidence_ref||'advisor_confirmation'}))},s.id));return;}
    if(path[3]==='preferences'&&method==='PATCH'){const b=await body(req);send(res,store.updateFamily(id,{expectedVersion:b.expected_version,preferenceChanges:[{person_id:b.person_id,preferences:b.preferences,explicit_request:true}]},s.id));return;}
   }
   if(path[1]==='events'){
    advisor(s);if(method==='POST'&&path.length===2){const b=await body(req);b.dedupe_key=req.headers['idempotency-key']||b.dedupe_key;send(res,engine.createEvent(b,s),202);return;}
    if(method==='GET'){send(res,path[2]?getEntity(s,'events',path[2]):store.list('events').slice(-100));return;}
   }
   if(path[1]==='communications'){
    if(method==='GET'){if(path[2]){const c=getEntity(s,'communications',path[2]);if(!visibleCommunication(s,c))throw error('Not found',404);send(res,c);}else send(res,scoped(s,'communications').filter(c=>visibleCommunication(s,c)));return;}
    if(path[2]==='approve-batch'){advisor(s);const b=await body(req);const out=[];for(const item of b.items||[])try{const c=getEntity(s,'communications',item.id);if(c.contact.requires_review||c.contact.review_lane==='individual')throw error('This communication needs individual review',409);out.push({id:item.id,ok:true,communication:await engine.approve(item.id,item,s)});}catch(e){out.push({id:item.id,ok:false,error:safeMessage(e),status:e.status||500});}send(res,out);return;}
    const c=getEntity(s,'communications',path[2]);const b=await body(req);
    if(path[3]==='start'){send(res,sanitize(await engine.startConversation(c.id,b)));return;}
    advisor(s);
    if(path[3]==='approve'){send(res,await engine.approve(c.id,b,s));return;}
    if(path[3]==='reject'){send(res,engine.reject(c.id,b.reason));return;}
    if(path[3]==='revise'){send(res,engine.requestChanges(c.id,b.instruction),202);return;}
   }
   if(path[1]==='conversations'){
    if(path.length===2&&method==='GET'){send(res,sanitize(scoped(s,'conversations')));return;}
    const c=getEntity(s,'conversations',path[2]);
    if(method==='GET'){send(res,sanitize(c));return;}
    const b=await body(req);
    if(path[3]==='turns'){send(res,sanitize(await engine.turn(c.id,{...b,request_id:req.headers['idempotency-key']||b.request_id})));return;}
    if(path[3]==='finish'){send(res,sanitize(await engine.finish(c.id)));return;}
    if(path[3]==='check-in'){send(res,sanitize(await engine.checkIn(c.id,{...b,request_id:req.headers['idempotency-key']||b.request_id})));return;}
   }
   if(path[1]==='audio'&&method==='GET'){
    const id=path[2];if(!/^[a-f0-9-]{36}$/.test(id))throw error('Invalid audio ID');let audio;
    for(const c of scoped(s,'conversations'))for(const t of c.turns||[])if(t.audio?.audio_id===id)audio=t.audio;
    if(!audio)throw error('Audio not found in this session',404);const file=resolve(audio.path);const base=resolve(rootDir,'var/recordings')+'/';if(!file.startsWith(base))throw error('Invalid recording path',403);res.writeHead(200,{'Content-Type':audio.mime,'Cache-Control':'private, no-store'});res.end(await readFile(file));return;
   }
   if(path[1]==='transcribe'&&method==='POST'){advisor(s);const b=await body(req);send(res,sanitize(await voice.transcribe(b)));return;}
   if(path[1]==='followups'){
    if(method==='GET'){send(res,scoped(s,'followups'));return;}
    const f=getEntity(s,'followups',path[2]);const b=await body(req);if(path[3]==='cancel'){send(res,store.patch('followups',f.id,{state:'cancelled',cancel_reason:String(b.reason||'Requested cancellation').slice(0,500)}));return;}
    advisor(s);if(path[3]==='schedule'){if(!b.due_at||!Number.isFinite(Date.parse(b.due_at)))throw error('Invalid due date');send(res,store.patch('followups',f.id,{state:'scheduled',due_at:new Date(b.due_at).toISOString()}));return;}
   }
   if(path[1]==='jobs'){
    advisor(s);if(method==='GET'){send(res,store.list('jobs').slice(-100));return;}
    const j=getEntity(s,'jobs',path[2]);if(path[3]==='retry'){if(j.status!=='failed')throw error('Only failed jobs can be retried',409);send(res,store.patch('jobs',j.id,{status:'queued',retry_at:engine.wallNow(),attempts:0,error:null}));engine.tick();return;}
   }
   if(path[1]==='traces'&&method==='GET'){advisor(s);let rows=store.list('traces');if(url.searchParams.get('family_id'))rows=rows.filter(x=>x.family_id===url.searchParams.get('family_id'));if(url.searchParams.get('event_id'))rows=rows.filter(x=>x.event_id===url.searchParams.get('event_id'));send(res,rows.slice(-300));return;}
   if(path[1]==='clock'){advisor(s);if(method==='GET'){send(res,{now:store.now()});return;}const b=await body(req);const now=store.setClock(b.now);engine.tick();send(res,{now});return;}
   if(path[1]==='fact-proposals'){advisor(s);if(method==='GET'){send(res,store.list('fact_proposals'));return;}const p=getEntity(s,'fact_proposals',path[2]);if(path[3]==='confirm'){if(p.state!=='pending')throw error('Proposal is no longer pending',409);const f=store.getFamily(p.family_id);store.updateFamily(f.id,{expectedVersion:f.version,factChanges:[{...p.change,status:'confirmed',effective_at:p.change.effective_at||store.now()}]},s.id);send(res,store.patch('fact_proposals',p.id,{state:'confirmed'}));return;}}
   throw error('Route not found',404);
  }catch(e){if(!res.headersSent)send(res,{error:safeMessage(e),code:e.code||'request_failed'},e.status||e.statusCode||500);else res.end();}
 });
 if(startWorker)engine.start();
 let closing;
 const close=callback=>{closing??=new Promise((resolve,reject)=>{engine.stop();server.close(err=>{try{store.close();if(err&&err.code!=='ERR_SERVER_NOT_RUNNING')reject(err);else resolve();}catch(e){reject(e);}});server.closeIdleConnections?.();});if(typeof callback==='function')closing.then(()=>callback(),callback);return closing;};
 return {server,store,engine,ai,voice,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApplication();const port=Number(process.env.APP_PORT)||3000;const host=process.env.APP_HOST||'127.0.0.1';if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Prototype server must bind to loopback');app.server.listen(port,host,()=>console.log(`Sherpas backend: http://${host}:${port}/ops`));
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0)));
}
