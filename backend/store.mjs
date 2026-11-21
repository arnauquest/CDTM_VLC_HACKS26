import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CASES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../referencias/sherpas/recursos-oficiales/cases');
const clone = value => structuredClone(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const slug = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
const immutableTypes = new Set(['fact_changes', 'audit_log', 'approvals', 'traces']);
const factRoots = new Set(['incomes', 'expenses', 'accounts', 'other_assets', 'liabilities', 'insurance', 'goals', 'household']);
const immutableFields = new Set(['id', 'family_id', 'person_id', 'source', 'source_ref', 'source_person_ref', 'risk_profile', 'role', 'first_name']);
const moneyFields = /^(yearly|monthly|balance|value|amount|coverage|yearly_.*|monthly_payment|value_at_purchase)$/;
const recordFields = new Set(['name','type','yearly','monthly','owner','starts','ends','account_type','tax_treatment','balance','yearly_contribution_total','yearly_contribution_client','yearly_employer_match','value','interest_rate','monthly_payment','coverage','yearly_premium','amount','frequency','start_year','end_year','yearly_costs','planned_purchase','planned_loan','value_at_purchase','year','years','from_year','to_year']);
const prefFields = new Set(['language', 'timezone', 'channel', 'contact_windows', 'frequency', 'explanation_style', 'source', 'confirmed', 'confirmed_by_client', 'evidence_ref']);
export function storeError(code, message, status = 422) { return Object.assign(new Error(message), { code, status, statusCode: status }); }
const invalid = message => { throw storeError('VALIDATION_ERROR', message); };
function safe(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) invalid('Numbers must be finite');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (blocked.has(key)) invalid('Unsafe object key'); safe(child); }
}
function date(value) { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid('A valid ISO date is required'); return new Date(value).toISOString(); }
function checkVersion(expected, actual) { if (expected !== actual) throw storeError('VERSION_CONFLICT', `Expected version ${expected}; current version is ${actual}`, 409); }
function validateValue(value, key, unit) {
  safe(value);
  const numericField = (moneyFields.test(key) && !['coverage','yearly_costs'].includes(key)) || ['interest_rate','starts','ends','start_year','end_year','year','years','from_year','to_year','age','retirement_age'].includes(key);
  if (numericField && value !== null && typeof value !== 'number') invalid(`Fact field ${key} must be a number or null`);
  if (['name','type','account_type','tax_treatment','frequency','employment'].includes(key) && value !== null && typeof value !== 'string') invalid(`Fact field ${key} must be text or null`);
  if (typeof value === 'number') {
    if (Math.abs(value) > 1e15 || value < 0) invalid('Fact numbers must be nonnegative and within supported limits');
    if (moneyFields.test(key) && !['USD', 'USD/year', 'USD/month', 'USD/yearly', 'USD/monthly', 'USD; rates=ratio'].includes(unit)) invalid('Monetary facts require explicit USD units in original dollars');
    if (key === 'interest_rate' && (value > 1 || !['ratio', 'decimal', 'fraction', 'USD; rates=ratio'].includes(unit))) invalid('Interest rates require a decimal ratio between 0 and 1');
  }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (immutableFields.has(k) || (!Array.isArray(value) && !recordFields.has(k))) invalid(`Protected or unsupported fact field: ${k}`);
    validateValue(v, k, unit);
  }
}

export class Store {
  constructor({ dbPath = ':memory:', casesDir = DEFAULT_CASES, mode = 'auto' } = {}) {
    if (!['auto', 'manual'].includes(mode)) invalid('Mode must be auto or manual');
    if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
    this.casesDir = casesDir; this.initialMode = mode; this.depth = 0;
  }
  init() {
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS source_documents (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, source_path TEXT NOT NULL, sha256 TEXT NOT NULL, imported_at TEXT NOT NULL, snapshot TEXT NOT NULL, encoding TEXT NOT NULL, UNIQUE(family_id,source_path));
      CREATE TABLE IF NOT EXISTS families (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities (type TEXT NOT NULL, id TEXT NOT NULL, dedupe_key TEXT, created_at TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY(type,id), UNIQUE(type,dedupe_key));
      CREATE INDEX IF NOT EXISTS entity_type_date ON entities(type,created_at);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS source_no_update BEFORE UPDATE ON source_documents BEGIN SELECT RAISE(ABORT,'Source snapshots are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS source_no_delete BEFORE DELETE ON source_documents BEGIN SELECT RAISE(ABORT,'Source snapshots are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON entities WHEN OLD.type IN ('fact_changes','audit_log','approvals','traces') BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON entities WHEN OLD.type IN ('fact_changes','audit_log','approvals','traces') BEGIN SELECT RAISE(ABORT,'History is append-only'); END;`);
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('policy', JSON.stringify({ mode: this.initialMode, version: 1 }));
    this.transaction(() => {
      for (const entry of readdirSync(this.casesDir, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
        if (this.db.prepare('SELECT id FROM families WHERE id=?').get(entry.name)) continue;
        const source = {}; const importedAt = this.now();
        for (const file of readdirSync(join(this.casesDir, entry.name)).sort()) {
          const sourcePath = join(this.casesDir, entry.name, file); const bytes = readFileSync(sourcePath);
          const encoding = file.endsWith('.pdf') ? 'base64' : 'utf8'; const snapshot = bytes.toString(encoding);
          this.db.prepare('INSERT OR IGNORE INTO source_documents VALUES (?,?,?,?,?,?,?)').run(`source:${entry.name}:${file}`, entry.name, sourcePath, hash(bytes), importedAt, snapshot, encoding);
          const key = ({ 'financial-health.json': 'financial', 'investment-analysis.json': 'investment', 'signals.json': 'signals', 'legal-values.json': 'legal_values', 'persona.md': 'persona' })[file];
          if (key) source[key] = file.endsWith('.json') ? JSON.parse(snapshot) : snapshot;
        }
        if (!source.financial?.profile || !Array.isArray(source.financial.case?.household)) invalid(`Missing financial source for ${entry.name}`);
        const people = source.financial.case.household.map(person => ({ ...person, id: `${entry.name}:${slug(person.first_name)}`, name: person.first_name, family_id: entry.name }));
        const family = { id: entry.name, name: entry.name.split('-').map(s => s[0].toUpperCase()+s.slice(1)).join(' '), version: 1, people,
          facts: { ...clone(source.financial.profile), household: clone(source.financial.case.household) },
          relationship: { observations: [], preferences: {}, open_questions: [], summary: '' }, source, projection_status: 'source_snapshot' };
        this.db.prepare('INSERT INTO families VALUES (?,?)').run(entry.name, JSON.stringify(family));
      }
    });
    return this;
  }
  close() { this.db.close(); }
  transaction(fn) {
    const outer = this.depth === 0; const savepoint = `store_${this.depth}`;
    this.db.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`); this.depth++;
    try { const result = fn(); if (result?.then) invalid('Store transactions must be synchronous'); this.db.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`); return result; }
    catch (error) { this.db.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`); if (!outer) this.db.exec(`RELEASE ${savepoint}`); throw error; }
    finally { this.depth--; }
  }
  now() { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get('clock'); return row ? JSON.parse(row.value) : new Date().toISOString(); }
  setClock(iso) { return this.transaction(() => { const next = date(iso); if (Date.parse(next) < Date.parse(this.now())) invalid('Clock cannot move backwards'); this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('clock', JSON.stringify(next)); return next; }); }
  getPolicy() { return JSON.parse(this.db.prepare('SELECT value FROM settings WHERE key=?').get('policy').value); }
  setPolicy(mode, expectedVersion) {
    if (!['auto','manual'].includes(mode)) invalid('Mode must be auto or manual');
    return this.transaction(() => { const prior = this.getPolicy(); checkVersion(expectedVersion, prior.version); const policy = { mode, version: prior.version+1 };
      this.db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(policy), 'policy');
      this.put('audit_log', { actor: 'advisor', action: 'policy_updated', target_id: 'policy', before_version: prior.version, after_version: policy.version, mode }); return policy; });
  }
  listFamilies() { return this.db.prepare('SELECT doc FROM families ORDER BY id').all().map(r => JSON.parse(r.doc)); }
  getFamily(id) { const row = this.db.prepare('SELECT doc FROM families WHERE id=?').get(id); if (!row) throw storeError('NOT_FOUND', `Family ${id} not found`, 404); return JSON.parse(row.doc); }
  context(id) {
    const f = this.getFamily(id);
    const evidence = this.list('source_documents', { family_id: id }).map(({ snapshot, ...rest }) => rest);
    return { id, family_id: id, name: f.name, version: f.version, expected_state_version: f.version, currency: 'USD', monetary_units: 'original USD (not cents)', people: f.people, facts: f.facts,
      relationship: f.relationship, preferences: f.relationship.preferences, open_questions: f.relationship.open_questions,
      projection_status: f.projection_status, source: { financial: { profile: f.source.financial.profile, case: f.source.financial.case, score: f.source.financial.score, goals: f.source.financial.goals, key_metrics: f.source.financial.key_metrics }, investment: { key_metrics: f.source.investment?.key_metrics, positions: f.source.investment?.positions, narrative: f.source.investment?.narrative }, persona: f.source.persona, signals: f.source.signals },
      fact_evidence: [...evidence, ...this.list('fact_changes', { family_id: id })], recent_conversations: this.list('conversations', { family_id: id }).slice(-3),
      recent_communications: this.list('communications', { family_id: id }).slice(-3), pending_followups: this.list('followups', { family_id: id }).filter(x => !['cancelled','completed','done','resolved','evaluated'].includes(x.state ?? x.status)), contact_policy: { ...this.getPolicy(), policy_version: this.getPolicy().version }, now: this.now() };
  }
  updateFamily(id, { expectedVersion, factChanges = [], observations = [], preferenceChanges = [], openQuestions, summary }, actor = 'system') {
    return this.transaction(() => {
      const f = this.getFamily(id); checkVersion(expectedVersion, f.version);
      if (![factChanges, observations, preferenceChanges].every(Array.isArray)) invalid('Changes must be arrays');
      for (const change of factChanges) {
        safe(change); const path = change.field_path?.replace(/^facts\./, '');
        if (typeof path !== 'string') invalid('Fact path is required');
        const parts = path.split('.'); if (!factRoots.has(parts[0]) || parts.some(p => blocked.has(p) || immutableFields.has(p))) invalid(`Protected or unsupported fact path: ${path}`);
        if (!['self_reported', 'confirmed', 'needs_confirmation'].includes(change.status)) invalid('A supported fact status is required');
        if (!change.evidence_ref || typeof change.evidence_ref !== 'string') invalid('Fact evidence_ref is required');
        date(change.effective_at); if (typeof change.unit !== 'string' || !change.unit) invalid('Fact unit is required');
        if (change.person_id && !f.people.some(p => p.id === change.person_id)) invalid('Person is outside this family');
        if (parts.length < 2) invalid('Cannot replace a whole fact collection');
        const newChild = parts[0] === 'household' && parts.length === 2;
        if (newChild) {
          const child = change.new_value;
          if (change.status !== 'confirmed') invalid('A new household association requires advisor confirmation');
          if (!child || typeof child !== 'object' || !child.first_name?.trim() || child.role !== 'child' || Object.keys(child).some(k => !['first_name','name','role','age'].includes(k))) invalid('New household member must be a named child');
          if (child.age != null && (!Number.isFinite(child.age) || child.age < 0 || child.age > 120)) invalid('Invalid child age');
          if (f.people.some(p => p.id === `${id}:${slug(child.first_name)}`)) invalid('Household member already exists');
        }
        let target = f.facts;
        for (const part of parts.slice(0,-1)) { if (!Object.hasOwn(target, part) || target[part] === null || typeof target[part] !== 'object') invalid(`Unknown fact path: ${path}`); target = target[part]; }
        const key = parts.at(-1);
        if (key === 'owner' || parts.includes('owner')) invalid('Existing ownership associations are protected');
        if (Array.isArray(target)) { if (!/^(0|[1-9]\d*)$/.test(key) || +key > target.length) invalid('Array edits must use an existing or next index'); if (+key < target.length) invalid('Edit a field rather than replacing an existing record'); }
        else if (!Object.hasOwn(target, key)) invalid(`Unknown fact field: ${path}`);
        if (change.new_value === undefined) invalid('new_value is required');
        if (change.unit === 'USD; rates=ratio' && (!Array.isArray(target) || !change.new_value || typeof change.new_value !== 'object' || Array.isArray(change.new_value))) invalid('Mixed currency/rate units are supported only for a new record');
        const prior = target[key]; if (prior !== undefined && prior !== null && typeof prior !== typeof change.new_value) invalid('Fact type must remain unchanged');
        if (!newChild) validateValue(change.new_value, key, change.unit);
        if (Array.isArray(target) && !newChild) {
          if (!change.new_value || typeof change.new_value !== 'object' || Array.isArray(change.new_value) || typeof change.new_value.name !== 'string') invalid('New fact records require a name and object value');
          if (['incomes','liabilities','accounts'].includes(parts[0]) && (!Array.isArray(change.new_value.owner) || !change.new_value.owner.length)) invalid('New financial records require known household owners');
          if (change.new_value.owner != null && (!Array.isArray(change.new_value.owner) || !change.new_value.owner.length || !change.new_value.owner.every(name => f.people.some(p => p.first_name === name)))) invalid('Record owner must belong to this family');
        }
        if (change.status !== 'needs_confirmation') {
          target[key] = clone(change.new_value);
          if (newChild) {
            const child = { first_name: change.new_value.first_name.trim(), role: 'child', ...(change.new_value.age != null ? { age: change.new_value.age } : {}) };
            target[key] = child;
            f.people.push({ ...child, id: `${id}:${slug(child.first_name)}`, name: change.new_value.name?.trim() || child.first_name, family_id: id });
          }
        }
        this.put('fact_changes', { ...clone(change), family_id: id, field_path: path, old_value: prior ?? null, actor, before_version: f.version, after_version: f.version+1, applied: change.status !== 'needs_confirmation' });
      }
      for (const observation of observations) {
        safe(observation); if (!observation.statement || typeof observation.statement !== 'string') invalid('Observation statement is required');
        if (observation.person_id && !f.people.some(p => p.id === observation.person_id)) invalid('Person is outside this family');
        const key = observation.dedupe_key ?? hash(JSON.stringify([observation.person_id, observation.conversation_id, observation.evidence_ref, observation.kind, observation.statement, observation.transcript_span]));
        if (!f.relationship.observations.some(o => o.dedupe_key === key)) f.relationship.observations.push({ ...clone(observation), id: `observation_${randomUUID()}`, dedupe_key: key, created_at: this.now() });
      }
      for (const change of preferenceChanges) {
        safe(change); if (!f.people.some(p => p.id === change.person_id)) invalid('Preference person is outside this family');
        if (!(change.confirmed || change.confirmed_by_client || change.explicit_request)) invalid('Preferences require explicit request or confirmation');
        const values = change.preferences ?? ((change.field || change.key) ? { [change.field || change.key]: change.new_value ?? change.value } : Object.fromEntries(Object.entries(change).filter(([k]) => !['person_id','explicit_request','conversation_id'].includes(k))));
        for (const key of Object.keys(values)) if (!prefFields.has(key)) invalid(`Unsupported preference: ${key}`);
        f.relationship.preferences[change.person_id] = { ...f.relationship.preferences[change.person_id], ...clone(values), updated_at: this.now() };
      }
      if (openQuestions !== undefined) { if (!Array.isArray(openQuestions) || !openQuestions.every(x => typeof x === 'string')) invalid('openQuestions must contain strings'); f.relationship.open_questions = clone(openQuestions); }
      if (summary !== undefined) { if (typeof summary !== 'string') invalid('summary must be text'); f.relationship.summary = summary; }
      if (factChanges.some(c => c.status !== 'needs_confirmation')) f.projection_status = 'stale';
      f.version++; this.db.prepare('UPDATE families SET doc=? WHERE id=?').run(JSON.stringify(f), id);
      this.put('audit_log', { actor, action: 'family_updated', family_id: id, target_id: id, before_version: f.version-1, after_version: f.version }); return f;
    });
  }
  get(type, id) {
    if (type === 'source_documents') { const row = this.db.prepare('SELECT * FROM source_documents WHERE id=?').get(id); return row ? { ...row } : null; }
    const row = this.db.prepare('SELECT doc FROM entities WHERE type=? AND id=?').get(type, id); return row ? JSON.parse(row.doc) : null;
  }
  list(type, filters = {}) {
    const { limit, ...match } = filters;
    const rows = type === 'source_documents' ? this.db.prepare('SELECT * FROM source_documents ORDER BY imported_at,id').all().map(r => ({...r})) : this.db.prepare('SELECT doc FROM entities WHERE type=? ORDER BY created_at,rowid').all(type).map(r => JSON.parse(r.doc));
    const result = rows.filter(doc => Object.entries(match).every(([k,v]) => JSON.stringify(doc[k]) === JSON.stringify(v)));
    return limit === undefined ? result : result.slice(0, Math.max(0, Number(limit)));
  }
  put(type, object, { expectedVersion } = {}) {
    if (!type || type === 'source_documents' || type === 'families') invalid('Protected entity type'); safe(object);
    if (!object || typeof object !== 'object' || Array.isArray(object)) invalid('Entity must be an object');
    return this.transaction(() => {
      if (object.dedupe_key != null) { const found = this.db.prepare('SELECT doc FROM entities WHERE type=? AND dedupe_key=?').get(type, String(object.dedupe_key)); if (found && JSON.parse(found.doc).id !== object.id) return JSON.parse(found.doc); }
      const id = object.id ?? `${type.replace(/s$/, '')}_${randomUUID()}`; const before = this.get(type, id);
      if (before && immutableTypes.has(type)) throw storeError('IMMUTABLE_RECORD', `${type} is append-only`, 409);
      if (expectedVersion !== undefined) checkVersion(expectedVersion, before?.version ?? 0);
      if (before?.family_id && object.family_id && before.family_id !== object.family_id) invalid('Cannot change family association');
      const now = this.now(); const result = { ...clone(object), ...(before?.family_id ? { family_id: before.family_id } : {}), id, version: (before?.version ?? 0)+1, created_at: before?.created_at ?? object.created_at ?? now, updated_at: now };
      this.db.prepare('INSERT INTO entities VALUES (?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET dedupe_key=excluded.dedupe_key,doc=excluded.doc').run(type, id, result.dedupe_key == null ? null : String(result.dedupe_key), result.created_at, JSON.stringify(result)); return result;
    });
  }
  patch(type, id, changes, options = {}) {
    return this.transaction(() => { const prior = this.get(type, id); if (!prior) throw storeError('NOT_FOUND', `${type} ${id} not found`, 404);
      if (changes.id !== undefined && changes.id !== id) invalid('Cannot change entity id');
      return this.put(type, { ...prior, ...changes, id, created_at: prior.created_at }, options); });
  }
  trace(entry) { return this.put('traces', entry); }
  claimJob(now = this.now(), leaseMs = 120000) {
    const stamp = date(now); if (!Number.isFinite(leaseMs) || leaseMs <= 0) invalid('Lease must be positive');
    return this.transaction(() => {
      const job = this.list('jobs').find(j => ['queued','retry','retrying'].includes(j.status) && (!j.retry_at || Date.parse(j.retry_at) <= Date.parse(stamp)) && (!j.due_at || Date.parse(j.due_at) <= Date.parse(stamp)));
      return job ? this.patch('jobs', job.id, { status: 'leased', attempts: (job.attempts ?? 0)+1, lease_until: new Date(Date.parse(stamp)+leaseMs).toISOString(), leased_at: stamp }) : null;
    });
  }
  recoverJobs(now = this.now()) {
    const stamp = date(now);
    return this.transaction(() => this.list('jobs').filter(j => ['leased','running'].includes(j.status) && j.lease_until && Date.parse(j.lease_until) <= Date.parse(stamp)).map(j => this.patch('jobs', j.id, { status: 'queued', lease_until: null, recovered_at: stamp })));
  }
}
export default Store;
