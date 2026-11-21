import { acousticCapabilities } from './gemini-acoustic.mjs';
import { createHash } from 'node:crypto';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
const body = (value, status = 200, headers) => ({ status, body: value, ...(headers ? { headers } : {}) });
const unsupported = message => { throw fail(message, 409); };
const editableBrand = new Set(['appName', 'tenantName', 'logoUrl', 'logoInverseUrl', 'iconUrl', 'colors', 'fontFamily', 'fontUrl', 'legalFooter', 'voiceProfileId', 'integrationActive']);
const defaultBrand = env => ({ appName: 'sherpas', tenantName: 'Demo local · CDTM Valencia Hacks 2026', logoUrl: null, logoInverseUrl: null, iconUrl: null,
  colors: { primary: '#0F2942', accent: '#10B981' }, fontFamily: null, fontUrl: null,
  legalFooter: 'Demostración local con familias sintéticas. Las comunicaciones requieren la autorización configurada.',
  voiceProfileId: env.ELEVENLABS_VOICE_ID || null, integrationActive: false });

function assertAdmin(session) {
  if (!session) throw fail('Selecciona una sesión local primero.', 401);
  if (session.role !== 'admin') throw fail('Esta operación requiere el rol administrador de la demo local.', 403);
}
function plainObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Se requiere un objeto JSON.'); }
function string(value, label, limit) { if (typeof value !== 'string' || value.length > limit) throw fail(`${label}: texto de hasta ${limit} caracteres requerido.`); return value.trim(); }
function safeText(value, env) {
  let text = String(value ?? '');
  for (const [key, secret] of Object.entries(env)) if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && typeof secret === 'string' && secret) text = text.split(secret).join('[redacted]');
  return text;
}
function imageData(value) {
  if (typeof value !== 'string' || value.length > 2.8e6) throw fail('La imagen debe ser un data URI de hasta 2 MiB.', 413);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail('Usa PNG, JPEG o WebP en base64. SVG y URLs externas no están admitidos.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw fail('La imagen supera 2 MiB.', 413);
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw fail('Contenido base64 inválido.');
  const valid = match[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'image/jpeg' ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail('El contenido de la imagen no coincide con su tipo.');
  return { url: value, mime: match[1], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
function validateBrand(input, current, env) {
  plainObject(input);
  for (const key of Object.keys(input)) if (!editableBrand.has(key)) throw fail(`Campo de marca no admitido: ${key}`);
  const result = structuredClone(current);
  for (const field of ['appName','tenantName','legalFooter']) if (input[field] !== undefined) result[field] = string(input[field], field, field === 'legalFooter' ? 4000 : 120);
  if (!result.appName) throw fail('El nombre de la marca es obligatorio.');
  if (input.colors !== undefined) {
    plainObject(input.colors);
    for (const [key, value] of Object.entries(input.colors)) {
      if (!['primary','accent'].includes(key) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw fail('Los colores deben usar #RRGGBB.');
      result.colors[key] = value.toUpperCase();
    }
  }
  for (const field of ['logoUrl','logoInverseUrl','iconUrl']) if (input[field] !== undefined) result[field] = input[field] === null || input[field] === '' ? null : imageData(input[field]).url;
  if (input.fontUrl) throw fail('Las fuentes externas no están configuradas en esta demo.');
  if (input.fontFamily !== undefined) {
    if (input.fontFamily !== null && (typeof input.fontFamily !== 'string' || !/^[a-zA-Z0-9 ,'-]{1,100}$/.test(input.fontFamily))) throw fail('Nombre de fuente inválido.');
    result.fontFamily = input.fontFamily;
  }
  if (input.voiceProfileId !== undefined && input.voiceProfileId !== null && input.voiceProfileId !== env.ELEVENLABS_VOICE_ID) throw fail('Solo se puede seleccionar la voz configurada en este entorno.');
  result.voiceProfileId = env.ELEVENLABS_VOICE_ID || null;
  result.integrationActive = false; result.fontUrl = null;
  return result;
}
function notifications(store, session) {
  const comms = store.list('communications');
  if (session.role === 'client' || session.role === 'cliente') {
    const pending = comms.filter(c => c.family_id === session.family_id && c.state === 'delivered');
    return { unread: pending.length, countKind: 'available_communications', readReceiptsTracked: false };
  }
  return { unread: comms.filter(c => c.state === 'awaiting_review').length + store.list('jobs').filter(j => j.status === 'failed').length + store.list('conversations').filter(c => c.handoff_requested && !c.handoff_resolved_at).length,
    countKind: 'pending_reviews_failed_jobs_and_handoffs', readReceiptsTracked: false };
}
function summary(store) {
  const decisions = new Map();
  for (const a of store.list('assessments')) if (a.kind === 'assessment' && a.result?.contact?.decision) decisions.set(`${a.event_id}:${a.family_id}`, a.result.contact.decision);
  const none = [...decisions.values()].filter(d => d === 'none').length;
  return { activeFamilies: store.listFamilies().length, activeConsultants: 1, slaMinutes: null,
    silenceRate: decisions.size ? none / decisions.size : null, assessmentCount: decisions.size,
    unreadNotifications: notifications(store, { role: 'admin' }).unread, localDemo: true,
    dataAvailability: { slaMinutes: 'No hay medición de SLA contractual.', silenceRate: 'Proporción de decisiones reales de análisis sin contacto, por evento y familia.', activeConsultants: 'Un asesor compartido en la demo local; no es un directorio de empleados.' } };
}
function integrations(env, ai) {
  const capabilities = ai?.capabilities?.() || {};
  const entry = (id, name, configured, note) => ({ id, name, configured, status: configured ? 'pending' : 'disconnected', statusLabel: configured ? 'Configurado · conexión no comprobada' : 'No configurado', canVerify: true, canConfigure: false, diagnostic: { kind: 'configuration_only', networkChecked: false, note } });
  return [
    entry('openai', 'OpenAI · clasificación y conversación', Boolean(env.OPENAI_API_KEY), 'Se comprueba únicamente la presencia de la configuración local.'),
    entry('elevenlabs', 'ElevenLabs · transcripción y voz', Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID), 'La clave y la voz deben estar configuradas; esta comprobación no genera audio ni consume créditos.'),
    entry('agents', `Agentes locales · ${capabilities.agent_provider || env.AGENT_PROVIDER || 'codex'}`, true, 'Adaptador local disponible. La sesión del proveedor se valida al ejecutar un análisis real.'),
    entry('acoustic', 'Análisis acústico', acousticCapabilities(env).configured, 'Gemini analiza grabaciones del cliente al terminar la conversación. Sus observaciones son tentativas; esta comprobación no envía audio.')
  ];
}
const guardrails = () => [
  { id: 'family_scope', label: 'Ámbito de familia y destinatario', hint: 'El backend comprueba familia y personas antes de guardar hechos y preparar contactos.', enabled: true, editable: false },
  { id: 'approval_binding', label: 'Autorización vinculada a contenido y hechos', hint: 'La aprobación valida versiones, hechos y canal; se revisa antes de iniciar una conversación.', enabled: true, editable: false },
  { id: 'immutable_sources', label: 'Fuentes y registro de cambios inmutables', hint: 'SQLite conserva snapshots con SHA-256, cambios de hechos y auditoría de solo adición. No es una certificación regulatoria.', enabled: true, editable: false },
  { id: 'quoted_observations', label: 'Observaciones apoyadas en evidencia del cliente', hint: 'Se validan citas de intervenciones del cliente y se separan de los hechos financieros.', enabled: true, editable: false }
];
function compliance(store, env) {
  const rows = [['record_type','id','family_id','timestamp','state','version','actor','action','evidence_ref','sha256']];
  for (const family of store.listFamilies()) rows.push(['family',family.id,family.id,'',family.projection_status,family.version,'','','','']);
  for (const type of ['source_documents','fact_changes','audit_log','approvals','communications','conversations','jobs']) {
    for (const item of store.list(type)) rows.push([type,item.id,item.family_id || '',item.created_at || item.imported_at || item.approved_at || '',item.state || item.status || '',item.version || '',item.actor || item.reviewer_id || '',item.action || '',item.evidence_ref || '',item.sha256 || '']);
  }
  const cell = value => { let text = safeText(value, env); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"','""')}"`; };
  return Buffer.from('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n');
}

/** Return null for paths owned by other adapters. Only GET /brand is public. */
export async function handleFrontendAdmin({ path, method = 'GET', input = {}, session, store, engine, voice, ai, env = process.env, rootDir, url } = {}) {
  let route = Array.isArray(path) ? '/' + path.join('/') : path || url?.pathname || '';
  route = route.split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/$/, '') || '/';
  const isOwned = route === '/brand' || route.startsWith('/brand/') || route === '/notifications/count' || route.startsWith('/admin/');
  if (!isOwned) return null;
  const currentBrand = () => store.get('frontend_settings','brand_published')?.value || defaultBrand(env);
  if (route === '/brand' && method === 'GET') return body(currentBrand());
  if (!session) throw fail('Selecciona una sesión local primero.', 401);
  if (route === '/notifications/count' && method === 'GET') return body(notifications(store, session));
  assertAdmin(session);
  const audit = (action, target_id, details = {}) => store.put('audit_log', { actor: session.id || 'local-admin', action, target_id, ...details });
  const saveSetting = (id, value) => store.put('frontend_settings', { id, value });
  if (route === '/brand/voices' && method === 'GET') return body(env.ELEVENLABS_VOICE_ID ? [{ id: env.ELEVENLABS_VOICE_ID, label: 'Voz configurada en ElevenLabs · entorno local', status: env.ELEVENLABS_API_KEY ? 'configured' : 'missing_credentials', cloned: null }] : []);
  if (route === '/brand/assets' && method === 'POST') {
    if (!['logo','icon'].includes(input.kind)) throw fail('El tipo de imagen debe ser logo o icon.');
    const asset = imageData(input.dataUrl || input.data_url || (input.mime && input.base64 ? `data:${input.mime};base64,${input.base64}` : undefined));
    store.put('brand_assets', { dedupe_key: asset.sha256, kind: input.kind, ...asset });
    return body({ url: asset.url, mime: asset.mime, sha256: asset.sha256 }, 201);
  }
  if (route === '/brand/draft' && method === 'PUT') {
    const value = validateBrand(input, store.get('frontend_settings','brand_draft')?.value || currentBrand(), env);
    store.transaction(() => { saveSetting('brand_draft',value); audit('brand_draft_saved','brand'); }); return body(value);
  }
  if (route === '/brand/publish' && method === 'POST') {
    const pending = Object.keys(input).length ? input : store.get('frontend_settings','brand_draft')?.value || currentBrand();
    const value = validateBrand(pending, currentBrand(), env);
    store.transaction(() => { saveSetting('brand_published',value); saveSetting('brand_draft',value); audit('brand_published','brand'); }); return body(value);
  }
  if (route === '/brand/reset' && method === 'POST') {
    const value = defaultBrand(env); store.transaction(() => { saveSetting('brand_draft',value); audit('brand_draft_reset','brand'); }); return body(value);
  }
  if (route === '/admin/summary' && method === 'GET') return body(summary(store));
  if (route === '/admin/consultants/workload' && method === 'GET') {
    const filter = url?.searchParams?.get('filter') || 'all';
    if (!['all','overloaded','low_sla','inactive'].includes(filter)) throw fail('Filtro no admitido.');
    return body(filter === 'all' ? [{ id: 'local-advisor', name: 'Asesor local de la demo', title: 'Sesión compartida · familias sintéticas', avatarUrl: null, familiesAssigned: store.listFamilies().length, capacity: null, slaMinutes: null, slaTarget: null, silenceRate: summary(store).silenceRate, status: 'not_measured', statusLabel: 'Capacidad y SLA sin configurar', active: true, localDemo: true }] : []);
  }
  if (route === '/admin/portfolios/reassign' && method === 'POST') unsupported('La demo tiene un único asesor local. La reasignación requiere un directorio real de asesores y no está implementada.');
  if (route === '/admin/compliance/report' && method === 'GET') return body(compliance(store,env), 200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="auditoria-local.csv"', 'Cache-Control':'no-store' });
  if (route === '/admin/onboarding/queue' && method === 'GET') return body([]);
  if (route === '/admin/onboarding/settings' && method === 'GET') return body({ autoAccept:false, ...store.get('frontend_settings','onboarding')?.value, registrationAvailable:false, note:'Preferencia local; el registro de nuevas familias no está implementado.' });
  if (route === '/admin/onboarding/settings' && method === 'PUT') {
    if (typeof input.autoAccept !== 'boolean' || Object.keys(input).some(key => key !== 'autoAccept')) throw fail('autoAccept debe ser booleano.');
    store.transaction(() => { saveSetting('onboarding',{autoAccept:input.autoAccept}); audit('onboarding_preference_updated','onboarding',{auto_accept:input.autoAccept}); });
    return body({ autoAccept:input.autoAccept, registrationAvailable:false });
  }
  if (/^\/admin\/onboarding\/[^/]+\/(accept|reject)$/.test(route) && method === 'POST') throw fail('No existe una solicitud de registro en esta demo.',404);
  if (route === '/admin/users' && method === 'GET') return body([
    { id:'local-admin',name:'Administrador local',role:'admin',roleLabel:'Administrador · sesión de demo',scopeLabel:'Configuración local; no es una cuenta de producción',familiesAssigned:null,avatarUrl:null,localDemo:true },
    { id:'local-advisor',name:'Asesor local de la demo',role:'consultor',backendRole:'advisor',roleLabel:'Asesor · sesión de demo',scopeLabel:'Todas las familias sintéticas',familiesAssigned:store.listFamilies().length,avatarUrl:null,localDemo:true }
  ]);
  if ((route === '/admin/users' && method === 'POST') || (/^\/admin\/users\/[^/]+$/.test(route) && method === 'PATCH')) unsupported('La demo usa roles de sesión locales. Crear cuentas o cambiar permisos requiere un sistema de identidad que no está configurado.');
  if (route === '/admin/governance/guardrails' && method === 'GET') return body(guardrails());
  if (/^\/admin\/governance\/guardrails\/[^/]+$/.test(route) && method === 'PATCH') unsupported('Estas reglas las aplica el backend y son de solo lectura; no se pueden desactivar desde la demo.');
  if (route === '/admin/integrations' && method === 'GET') return body(integrations(env,ai));
  const verify = /^\/admin\/integrations\/([^/]+)\/verify$/.exec(route);
  if (verify && method === 'POST') {
    const found = integrations(env,ai).find(item => item.id === verify[1]); if (!found) throw fail('Integración desconocida.',404);
    const diagnostic = { ...found, checkedAt:new Date().toISOString(), diagnostic:{...found.diagnostic,passed:found.configured} };
    audit('integration_configuration_checked',found.id,{configured:found.configured,network_checked:false}); return body(diagnostic);
  }
  if (route === '/admin/billing' && method === 'GET') return body({ configured:false, status:'not_configured', planName:'Demo local · facturación no configurada', seatsUsed:null, seatsTotal:null, renewalDate:null, invoicesAvailable:false, chargesEnabled:false, note:'Esta aplicación no gestiona suscripciones, facturas ni cargos. El uso de proveedores se factura fuera de esta demo.' });
  if (route === '/admin/billing/seats' && method === 'POST') unsupported('Facturación no configurada: no se pueden comprar asientos ni realizar cargos.');
  if (route === '/admin/billing/invoices' && method === 'GET') throw fail('No hay facturas gestionadas por esta demo.',404);
  throw fail('Ruta de administración no encontrada.',404);
}
export default handleFrontendAdmin;
