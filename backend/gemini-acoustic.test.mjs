import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { analyzeAcoustics } from './acoustic.mjs';
import { createGeminiAcoustic, acousticCapabilities } from './gemini-acoustic.mjs';
const env = { VOICE_ANALYSIS_PROVIDER:'gemini', GEMINI_API_KEY:'fixture-secret', GEMINI_VOICE_ANALYSIS_MODEL:'gemini-3.5-flash-lite' };
const result = () => ({ status:'available', warnings:[], observations:[{start_ms:0,end_ms:800,audible_cue:'Slow delivery with a pause.',tentative_tone:'Possibly hesitant',confidence:'medium'}] });
async function fixture(t) { const rootDir=await mkdtemp(join(tmpdir(),'gemini-tone-'));t.after(()=>rm(rootDir,{recursive:true,force:true}));const dir=join(rootDir,'var/recordings');await mkdir(dir,{recursive:true});const path=join(dir,'sample.wav');const bytes=Buffer.from('synthetic fixture audio');await writeFile(path,bytes);return {rootDir,input:{person_id:'p',family_id:'f',conversation_id:'c',audio:{audio_id:'a',path,mime:'audio/wav',sha256:createHash('sha256').update(bytes).digest('hex')},time_mapping:{turn_id:'t',audio_end_ms:1000},transcript_ref:{text:'PRIVATE TRANSCRIPT'},wealth:'PRIVATE FINANCES'}}; }
function responder(value=result()) { return async () => new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]})); }
test('Gemini receives only audio and instructions; observations retain person, turn and uncalibrated semantics',async t=>{
 const {rootDir,input}=await fixture(t);let called=false;
 const analyzer=createGeminiAcoustic({env,rootDir,fetchImpl:async(url,options)=>{called=true;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');assert.equal(options.headers['x-goog-api-key'],'fixture-secret');assert.equal(options.redirect,'error');assert.ok(options.signal);assert.ok(!options.body.includes('PRIVATE'));return responder()(url,options);}});
 const out=await analyzeAcoustics(input,{env,analyzer});assert.equal(called,true);assert.equal(out.status,'available');assert.equal(out.observations[0].person_id,'p');assert.equal(out.observations[0].turn_id,'t');assert.equal(out.observations[0].confirmed_by_client,false);assert.deepEqual(out.measurements,[]);
});
test('missing credentials and audio remain explicit and do not call Gemini',async t=>{
 const {rootDir,input}=await fixture(t);const empty={...env,GEMINI_API_KEY:''};assert.equal(acousticCapabilities(empty).configured,false);
 const analyzer=createGeminiAcoustic({env:empty,rootDir,fetchImpl:()=>assert.fail('network')});assert.equal((await analyzeAcoustics(input,{env:empty,analyzer})).reason_code,'gemini_key_missing');assert.equal((await analyzeAcoustics({},{env,analyzer})).reason_code,'audio_missing');
});
test('outside paths, symlinks and modified recordings cannot be uploaded',async t=>{
 const {rootDir,input}=await fixture(t);const outside=join(rootDir,'private.wav');await writeFile(outside,'private');const link=join(rootDir,'var/recordings/link.wav');await symlink(outside,link);
 const analyzer=createGeminiAcoustic({env,rootDir,fetchImpl:()=>assert.fail('network')});
 for(const audio of [{...input.audio,path:outside},{...input.audio,path:link},{...input.audio,sha256:'wrong'}]) assert.equal((await analyzeAcoustics({...input,audio},{env,analyzer})).status,'failed');
});
test('provider limits and malformed timestamps fail safely without invented observations',async t=>{
 const {rootDir,input}=await fixture(t);
 for(const fetchImpl of [async()=>new Response('sensitive provider detail',{status:429}),responder({...result(),observations:[{...result().observations[0],end_ms:99999}]}),async()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]}))]){
 const out=await analyzeAcoustics(input,{env,analyzer:createGeminiAcoustic({env,rootDir,fetchImpl})});assert.notEqual(out.status,'available');assert.deepEqual(out.observations,[]);assert.ok(!JSON.stringify(out).includes('sensitive provider detail'));
 }
});
test('silence and low-quality audio produce no emotional measurements',async t=>{
 const {rootDir,input}=await fixture(t);for(const status of ['no_speech','low_quality']) {const out=await analyzeAcoustics(input,{env,analyzer:createGeminiAcoustic({env,rootDir,fetchImpl:responder({...result(),status})})});assert.equal(out.status,status);assert.deepEqual(out.observations,[]);assert.deepEqual(out.measurements,[]);}
});
