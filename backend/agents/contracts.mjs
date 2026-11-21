const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const list = items => ({ type: 'array', items });
const strings = list(str);
const choice = values => ({ type: 'string', enum: values });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const owners = { type: 'array', items: str, minItems: 1, description: 'Exact existing household first_name values; never IDs or invented owners.' };
const incomeRecord = object({ name: str, type: nullable(str), yearly: nullable(num), owner: owners, starts: nullable({ type: 'integer' }), ends: nullable({ type: 'integer' }) });
const liabilityRecord = object({ name: str, type: nullable(str), balance: nullable(num), interest_rate: nullable(num), monthly_payment: nullable(num), owner: owners });
const expenseRecord = object({ name: str, type: nullable(str), yearly: nullable(num), monthly: nullable(num), owner: owners });
const accountRecord = object({ name: str, account_type: nullable(str), tax_treatment: nullable(str), balance: nullable(num),
  yearly_contribution_total: nullable(num), yearly_contribution_client: nullable(num), yearly_employer_match: nullable(num), owner: owners });
export const factRecordSchemas = { incomes: incomeRecord, liabilities: liabilityRecord, expenses: expenseRecord, accounts: accountRecord };
const factChange = object({
  person_id: nullable(str), field_path: str,
  new_value: { anyOf: [str, num, bool, { type: 'null' }, object({ first_name: str, name: nullable(str), role: choice(['child']), age: nullable(num) }), incomeRecord, liabilityRecord, expenseRecord, accountRecord] },
  unit: str, effective_at: nullable(str), evidence_ref: str,
  status: choice(['self_reported', 'confirmed', 'needs_confirmation']),
});
const followup = object({ person_ids: strings, purpose: str, due_at: nullable(str), timezone: str, timing_basis: str, cancel_conditions: strings });
export const assessmentSchema = object({
  family_id: str, expected_state_version: { type: 'integer' }, policy_version: { type: 'integer' },
  fact_changes: list(factChange), evidence_refs: strings, missing_information: strings,
  contact: object({
    decision: choice(['now', 'later', 'none', 'needs_information']), reason: str,
    urgency: choice(['urgent', 'normal', 'low']), requires_review: bool,
    review_reasons: strings, review_lane: choice(['none', 'batch', 'individual']),
    channel: choice(['browser_voice', 'text', 'audio']), person_ids: strings, purpose: str,
  }),
  followup_proposals: list(followup),
  draft: object({ text: str, voice_script: str, permitted_fact_refs: strings,
    conversation_objectives: strings, anticipated_questions_and_answers: strings,
    conversation_branches: strings, questions_to_ask: strings, response_boundaries: strings,
    escalation_conditions: strings, handoff_response: str }),
});
export const postAnalysisSchema = object({
  conversation_id: str, family_id: str, expected_state_version: { type: 'integer' },
  observation_additions: list(object({ person_id: str, conversation_id: str, kind: str,
    statement: str, quote: str,
    transcript_span: nullable(object({ start_ms: num, end_ms: num })),
    acoustic_evidence_ref: nullable(str), confirmed_by_client: bool, context_event_id: nullable(str),
  })),
  preference_changes: list(object({ person_id: str, field_path: choice(['language', 'timezone', 'channel', 'contact_windows', 'frequency', 'explanation_style']),
    new_value: { anyOf: [str, strings] }, evidence_ref: str, quote: str })),
  fact_changes: list(factChange), open_questions: strings, summary: str,
  followup_proposals: list(followup),
});

// Small strict validator for the schemas above; no external runtime dependency.
export function validateSchema(value, schema, path = '$') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(option => { try { validateSchema(value, option, path); return true; } catch { return false; } })) throw new Error(`Invalid agent output at ${path}`);
    return;
  }
  const type = schema.type;
  if ((type === 'null' && value !== null) || (type === 'array' && !Array.isArray(value)) ||
    (type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) ||
    (type === 'string' && typeof value !== 'string') || (type === 'boolean' && typeof value !== 'boolean') ||
    (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
    (type === 'integer' && !Number.isInteger(value))) throw new Error(`Invalid agent output at ${path}`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid agent output at ${path}`);
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`Invalid agent output at ${path}`);
    value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
  }
  if (type === 'object') {
    for (const key of schema.required) if (!Object.hasOwn(value, key)) throw new Error(`Missing agent output at ${path}.${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`Unexpected agent output at ${path}.${key}`);
      validateSchema(item, schema.properties[key], `${path}.${key}`);
    }
  }
}
