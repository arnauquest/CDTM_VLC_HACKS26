import { acousticCapabilities } from './gemini-acoustic.mjs';
import { createOpenAIRouterFromEnv } from '../config/openai-failover.mjs';
import { createAgentRunner } from './agents/runner.mjs';
import { assessmentSchema, postAnalysisSchema, factRecordSchemas, validateSchema } from './agents/contracts.mjs';
import { assessmentPrompt, postAnalysisPrompt } from './agents/prompts.mjs';

const predicates = {
  financial_relevance: "Does this event potentially change or update this family's financial facts, exposures, obligations, goals or an existing plan assumption? Use only provided event and family data. Keep relevance separate from whether to contact.",
  relationship_relevance: 'Does this event connect to an expressed question, confirmed communication preference, unresolved concern or upcoming decision for this family, including a useful clarification when direct financial change is zero?',
  insufficient_evidence: 'Is relevant information missing, stale or contradictory such that ruling out this event for this family would be premature?',
};

function trimProjections(value, key = '') {
  if (Array.isArray(value)) {
    if (/projection|trajectory|simulation|year_by_year|cashflow_forecast/i.test(key) && value.length > 4) {
      return { compacted: true, original_length: value.length, first_entries: value.slice(0, 2).map(item => trimProjections(item)), last_entry: trimProjections(value.at(-1)) };
    }
    return value.map(item => trimProjections(item, key));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, trimProjections(item, `${key}.${name}`)]));
  return value;
}

const excerpt = (value, max = 1200) => typeof value === 'string' ? value.slice(0, max) : value ?? null;
function compactDerived(value) {
  if (typeof value === 'string') return excerpt(value, 1600);
  if (Array.isArray(value)) return value.length > 8
    ? { excerpted: true, original_count: value.length, first_entries: value.slice(0, 3).map(compactDerived), last_entries: value.slice(-2).map(compactDerived) }
    : value.map(compactDerived);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactDerived(item)]));
  return value;
}
function compactSource(source = {}) {
  const selectMetrics = (metrics, keys) => metrics && ({ ...Object.fromEntries(keys.filter(key => Object.hasOwn(metrics, key)).map(key => [key, compactDerived(metrics[key])])),
    omitted_derived_sections: Object.keys(metrics).filter(key => !keys.includes(key)) });
  return { ...source,
    ...(source.financial && { financial: { ...source.financial, key_metrics: selectMetrics(source.financial.key_metrics, ['facts', 'ratios', 'protection', 'debtManagement', 'cashflowStatement']) } }),
    ...(source.investment && { investment: { ...source.investment, key_metrics: selectMetrics(source.investment.key_metrics, ['facts', 'capacity', 'cashNeeds', 'targetAllocationInForce', 'concentrationAndDiversification']), analysis: compactDerived(source.investment.analysis) } }),
  };
}
function compactTurns(turns, { maxTurns = 8, maxChars = 7000, perTurn = 1500 } = {}) {
  const selected = []; let remaining = maxChars;
  for (const turn of (Array.isArray(turns) ? turns : []).slice(-maxTurns).reverse()) {
    if (remaining <= 0) break;
    const text = excerpt(turn.text ?? turn.content, Math.min(perTurn, remaining));
    if (typeof text !== 'string') continue;
    selected.push({ id: turn.id, role: turn.role || turn.speaker, person_id: turn.person_id, text, created_at: turn.created_at,
      start_ms: turn.start_ms, end_ms: turn.end_ms, excerpted: text.length < String(turn.text ?? turn.content).length });
    remaining -= text.length;
  }
  return selected.reverse();
}
function compactConversation(conversation) {
  return { id: conversation.id, person_id: conversation.person_id, state: conversation.state,
    started_at: conversation.started_at, ended_at: conversation.ended_at,
    summary: excerpt(conversation.summary || conversation.analysis_summary, 1200),
    self_report: conversation.self_report ? { value: excerpt(conversation.self_report.value, 1000), person_id: conversation.self_report.person_id } : null,
    turns: compactTurns(conversation.turns, { maxTurns: 6, maxChars: 3000, perTurn: 1200 }), original_turn_count: conversation.turns?.length || 0 };
}
function compactFollowup(followup) {
  return { id: followup.id, person_ids: followup.person_ids, state: followup.state, purpose: excerpt(followup.purpose, 400),
    due_at: followup.due_at, timezone: followup.timezone, timing_basis: excerpt(followup.timing_basis, 200),
    cancel_conditions: (followup.cancel_conditions || []).slice(0, 6).map(item => excerpt(item, 150)),
    original_cancel_condition_count: followup.cancel_conditions?.length || 0 };
}

export function compactFamily(family) {
  if (!family?.id || !Number.isInteger(family.version) || !Array.isArray(family.people)) throw new Error('invalid_family_context');
  const relationship = family.relationship || {};
  return trimProjections({ id: family.id, name: family.name, version: family.version, people: family.people,
    facts: family.facts, source: compactSource(family.source), currency: family.currency, monetary_units: family.monetary_units, projection_status: family.projection_status,
    relationship: { preferences: relationship.preferences || family.preferences || {}, summary: excerpt(relationship.summary, 4000),
      open_questions: (relationship.open_questions || family.open_questions || []).slice(-20).map(item => excerpt(item, 350)),
      observations: (relationship.observations || []).slice(-16).map(item => ({ id: item.id, person_id: item.person_id,
        conversation_id: item.conversation_id, event_id: item.event_id, kind: item.kind, statement: excerpt(item.statement, 500),
        quote: excerpt(item.quote, 400), transcript_span: item.transcript_span, confirmed_by_client: item.confirmed_by_client })) },
    fact_evidence: family.fact_evidence?.slice(-40).map(item => ({ id: item.id, source_path: item.source_path, sha256: item.sha256,
      imported_at: item.imported_at, person_id: item.person_id, field_path: item.field_path, new_value: item.new_value,
      effective_at: item.effective_at, unit: item.unit, status: item.status, evidence_ref: item.evidence_ref })),
    recent_conversations: (family.recent_conversations || []).slice(-3).map(compactConversation),
    recent_communications: (family.recent_communications || []).slice(-3).map(item => ({ id: item.id, person_ids: item.person_ids,
      state: item.state, delivered_at: item.delivered_at, purpose: excerpt(item.contact?.purpose || item.purpose, 600),
      channel: item.contact?.channel, text: excerpt(item.draft?.text, 1200) })),
    pending_followups: (family.pending_followups || family.followups || []).slice(-12).map(compactFollowup),
    history_scope: 'Recent evidence excerpts only; omitted history is not evidence that a concern is resolved.',
  });
}

function fitContext(input, limit) {
  const size = () => JSON.stringify(input).length;
  const source = input.family_context.source;
  const candidates = [];
  for (const section of ['financial', 'investment']) {
    const metrics = source?.[section]?.key_metrics;
    for (const key of Object.keys(metrics || {})) if (!['facts', 'ratios', 'omitted_derived_sections'].includes(key)) candidates.push({ section, key, size: JSON.stringify(metrics[key]).length });
  }
  for (const item of candidates.sort((a, b) => b.size - a.size)) {
    if (size() <= limit) break;
    const metrics = source[item.section].key_metrics;
    delete metrics[item.key];
    metrics.omitted_derived_sections = [...(metrics.omitted_derived_sections || []), item.key];
  }
  if (size() > limit) throw new Error('agent_context_too_large');
  return input;
}

function inputFor({ event, family, policy, now, instruction }) {
  const context = compactFamily(family);
  const { people, fact_evidence, recent_conversations, pending_followups, ...familyContext } = context;
  const { open_questions, ...relationship } = familyContext.relationship;
  familyContext.relationship = relationship;
  const input = { event, family_context: familyContext, people,
    fact_evidence: fact_evidence || Object.keys(context.source || {}).map(section => ({ id: `family:${family.id}:source:${section}`, section })),
    recent_conversations, open_questions, pending_followups,
    contact_policy: policy, now, expected_state_version: context.version,
    instruction: instruction || null };
  // Reserve room for the current conversation in postanalysis without dropping
  // effective facts, original financial profiles, positions or persona evidence.
  return fitContext(input, 155000);
}

function validateScope(output, family, policy, conversation) {
  if (output.family_id !== family.id || output.expected_state_version !== family.version) throw new Error('agent_scope_or_version_mismatch');
  if (policy && output.policy_version !== (policy.version ?? policy.policy_version)) throw new Error('agent_policy_version_mismatch');
  if (conversation && output.conversation_id !== conversation.id) throw new Error('agent_conversation_mismatch');
  const people = new Set(family.people.map(person => person.id));
  const owners = new Set((family.facts?.household || family.people).map(person => person.first_name || person.name));
  for (const change of output.fact_changes || []) {
    if (!change.evidence_ref.trim()) throw new Error('agent_fact_evidence_missing');
    if (change.new_value && typeof change.new_value === 'object') {
      const path = change.field_path.replace(/^facts\./, '');
      const root = path.split('.')[0];
      if (!/^(incomes|liabilities|expenses|accounts|household)\.\d+$/.test(path)) throw new Error('agent_record_path_invalid');
      if (root === 'household') {
        if (change.new_value.role !== 'child' || !change.new_value.first_name) throw new Error('agent_household_record_invalid');
      } else {
        validateSchema(change.new_value, factRecordSchemas[root]);
        if (change.new_value.owner.some(owner => !owners.has(owner))) throw new Error('agent_record_owner_out_of_scope');
      }
    }
  }
  for (const entry of [...(output.fact_changes || []), ...(output.preference_changes || []), ...(output.observation_additions || [])]) {
    if (entry.person_id !== null && !people.has(entry.person_id)) throw new Error('agent_person_out_of_scope');
  }
  for (const person of [...(output.contact?.person_ids || []), ...output.followup_proposals.flatMap(item => item.person_ids)]) {
    if (!people.has(person)) throw new Error('agent_person_out_of_scope');
  }
  for (const followup of output.followup_proposals) {
    if (!followup.purpose.trim() || !followup.cancel_conditions.length) throw new Error('agent_followup_without_purpose_or_cancellation');
    if (followup.due_at !== null && (!Number.isFinite(Date.parse(followup.due_at)) || !/Z$/.test(followup.due_at))) throw new Error('agent_followup_invalid_utc_date');
    try { new Intl.DateTimeFormat('en', { timeZone: followup.timezone }); } catch { throw new Error('agent_followup_invalid_timezone'); }
  }
}

const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
function validateTranscript(output, conversation, acousticResult) {
  const turns = conversation.turns || conversation.transcript_with_speakers || [];
  const customerTurns = Array.isArray(turns) ? turns.filter(turn => ['user', 'customer', 'client'].includes(turn.role || turn.speaker)) : [];
  for (const observation of output.observation_additions) {
    if (observation.conversation_id !== conversation.id) throw new Error('agent_observation_conversation_mismatch');
    const matches = customerTurns.filter(turn => (turn.person_id || conversation.person_id) === observation.person_id && normalize(turn.text).includes(normalize(observation.quote)));
    if (!observation.quote.trim() || !matches.length) throw new Error('agent_unverified_transcript_quote');
    if (observation.transcript_span && !matches.some(turn => Number.isFinite(turn.start_ms) && Number.isFinite(turn.end_ms) &&
      observation.transcript_span.start_ms === turn.start_ms && observation.transcript_span.end_ms === turn.end_ms &&
      observation.transcript_span.end_ms >= observation.transcript_span.start_ms)) throw new Error('agent_unverified_transcript_span');
    if ((!acousticResult || acousticResult.status !== 'available') && observation.acoustic_evidence_ref !== null) throw new Error('agent_acoustic_evidence_unavailable');
    if (observation.acoustic_evidence_ref !== null && !(acousticResult?.observations || []).some(o => o.id === observation.acoustic_evidence_ref && o.person_id === observation.person_id && matches.some(t => t.id === o.turn_id))) throw new Error('agent_acoustic_reference_unverified');
    if (/vocal|acoustic|tone|prosod|voice|intensity/i.test(observation.kind) && (!observation.acoustic_evidence_ref || observation.confirmed_by_client)) throw new Error('agent_acoustic_estimate_requires_tentative_evidence');
    if ((!acousticResult || acousticResult.status !== 'available') && /vocal|acoustic|tone|prosod|voice|intensity/i.test(observation.kind)) throw new Error('agent_acoustic_inference_unavailable');
  }
  for (const preference of output.preference_changes) {
    if (!preference.quote.trim() || !customerTurns.some(turn => (turn.person_id || conversation.person_id) === preference.person_id && normalize(turn.text).includes(normalize(preference.quote)))) throw new Error('agent_unverified_preference_quote');
  }
}

export function createAI({ rootDir = process.cwd(), env = process.env, trace = () => {}, runner, router } = {}) {
  const emit = event => { try { trace(event); } catch { /* Optional telemetry. */ } };
  const run = runner || createAgentRunner({ rootDir, env, trace: emit });
  let decisionsRouter = router;
  const provider = (env.AGENT_PROVIDER || 'codex').toLowerCase();
  const model = env.OPENAI_DECISIONS_MODEL || 'gpt-6-luna';
  const thresholdValue = Number(env.DECISIONS_RELEVANCE_THRESHOLD ?? 0.2);
  if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 1) throw new Error('invalid_relevance_threshold');
  return {
    capabilities() {
      return { agent_provider: provider, agent_model: env[`${provider.toUpperCase()}_MODEL`] || env.AGENT_MODEL || 'provider_default',
        decisions: { provider: 'openai', model, configured: Boolean(env.OPENAI_API_KEY || router), threshold: thresholdValue, calibration: 'provisional_not_evaluated' },
        providers: { codex: { implemented: true, authentication: 'local_subscription_login', verification: 'runtime_required' },
          claude: { implemented: true, authentication: 'local_login', verification: 'untested_login' },
          opencode: { implemented: true, authentication: 'local_login', verification: 'untested_login' } },
        isolation: 'private_job_directory; Codex read-only sandbox is not filesystem read isolation; tools disabled where supported',
        acoustic: acousticCapabilities(env) };
    },
    async relevance({ event, family }) {
      const started = Date.now();
      decisionsRouter ||= createOpenAIRouterFromEnv(env, { onEvent: event => emit({ stage: 'relevance', provider: 'openai', ...event }) });
      emit({ stage: 'relevance', provider: 'openai', model, status: 'started', family_id: family.id });
      const { response, credential } = await decisionsRouter.request('/v1/decisions', { timeoutMs: 120000, body: {
        model, input: JSON.stringify({ event, family: compactFamily(family) }),
        questions: Object.entries(predicates).map(([name, instructions]) => ({ type: 'predicate', name, instructions })),
      } });
      const result = await response.json();
      const probabilities = Object.fromEntries(Object.keys(predicates).map(name => {
        const answers = (result.answers || []).filter(answer => answer.name === name);
        const answer = answers.length === 1 ? answers[0] : null;
        return [name, answer?.type === 'predicate' && typeof answer.probability === 'number' && answer.probability >= 0 && answer.probability <= 1 ? answer.probability : null];
      }));
      const missing = Object.values(probabilities).some(value => value === null);
      const relevant = Object.values(probabilities).some(value => value !== null && value >= thresholdValue);
      const route = missing || relevant ? 'assess' : 'discard';
      const reason = missing ? 'At least one predicate is missing or refused; assess conservatively.' : relevant ? 'At least one relevance or uncertainty probability meets the provisional threshold.' : 'All three probabilities are below the provisional threshold.';
      const output = { event_id: event.id || event.event_id, family_id: family.id, state_version: family.version,
        probabilities, route, reason, route_reason: reason, provider: 'openai_decisions', model: result.model || model,
        credential, latency_ms: Date.now() - started, prompt_version: 'relevance-v1',
        threshold: thresholdValue, calibration: 'provisional_not_evaluated', usage: result.usage || null };
      emit({ stage: 'relevance', status: 'completed', provider: 'openai', model, family_id: family.id, route, latency_ms: output.latency_ms });
      return output;
    },
    async assess(args) {
      const result = await run({ stage: 'assessment', input: inputFor(args), schema: assessmentSchema, prompt: assessmentPrompt });
      validateSchema(result.output, assessmentSchema);
      validateScope(result.output, args.family, args.policy);
      return { ...result.output, provider: result.provider, model: result.model, latency_ms: result.latency_ms, prompt_version: 'assessment-v1', job_id: result.job_id };
    },
    async postAnalyze({ conversation, event, family, policy, now, acousticResult }) {
      const acousticStatus = acousticResult?.status || 'not_configured';
      const base = inputFor({ event, family: { ...family, recent_conversations: (family.recent_conversations || []).filter(item => item.id !== conversation.id) }, policy, now });
      const priorRelationship = base.family_context.relationship;
      delete base.family_context.relationship;
      const transcript = conversation.turns || conversation.transcript_with_speakers || [];
      const input = { ...base, conversation_id: conversation.id,
        prior_relationship_profile: priorRelationship, current_family_version: family.version,
        transcript_with_speakers: compactTurns(transcript, { maxTurns: 24, maxChars: 22000, perTurn: 3000 }),
        transcript_original_turn_count: Array.isArray(transcript) ? transcript.length : 0,
        customer_person_id: conversation.person_id, customer_audio_ref: conversation.audio_ref || null,
        acoustic_status: acousticStatus, acoustic_result: acousticStatus === 'not_configured' ? null : acousticResult,
        self_report: conversation.self_report || null, communication_bundle: conversation.bundle?.draft || conversation.bundle || null,
        authorization_record: conversation.authorization_record || conversation.bundle?.authorization || null,
        contact_history: base.family_context.recent_communications || [] };
      fitContext(input, 180000);
      const result = await run({ stage: 'post_analysis', input, schema: postAnalysisSchema, prompt: postAnalysisPrompt });
      validateSchema(result.output, postAnalysisSchema);
      validateScope(result.output, family, null, conversation);
      validateTranscript(result.output, conversation, acousticResult);
      return { ...result.output, provider: result.provider, model: result.model, latency_ms: result.latency_ms,
        prompt_version: 'post-analysis-v1', job_id: result.job_id, acoustic_status: acousticStatus };
    },
  };
}
