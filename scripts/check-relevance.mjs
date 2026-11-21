// Real Decisions API exercise with transparent synthetic labels, not calibration.
// node --env-file=.env scripts/check-relevance.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../backend/store.mjs';
import { createAI } from '../backend/ai.mjs';
import { createOpenAIRouterFromEnv } from '../config/openai-failover.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = join(rootDir, 'var', 'check-relevance');
const store = new Store({ casesDir: process.env.SHERPAS_CASES_DIR ? resolve(rootDir, process.env.SHERPAS_CASES_DIR) : undefined }).init();
const started = performance.now();
const report = { started_at: new Date().toISOString(), status: 'running', synthetic_examples: true,
  limitations: 'Sixteen deliberately clear, author-labeled synthetic events across four supplied family cases. One run, no independent labels or representative holdout. This evaluates integration and routing sensitivity; it does not establish statistical calibration, general recall or financial correctness.',
  thresholds: [0.1, 0.2, 0.3, 0.5], concurrency: 2, cases: [] };

const definitions = [
  { kind: 'direct_financial', expected_assess: true, expected_predicate: 'financial_relevance',
    summary: family => `SYNTHETIC EVALUATION EVENT: ${family.name} directly reports that their main existing earned income will decrease by 10% starting next month. Treat the report as an explicit self-reported proposed change to that household's income; the original financial snapshot has not yet been updated.`,
    label_reason: 'An explicit change to existing household income warrants financial assessment.' },
  { kind: 'relationship_concern', expected_assess: true, expected_predicate: 'relationship_relevance',
    summary: family => `SYNTHETIC EVALUATION EVENT: A member of ${family.name} says: "My finances have not changed, but I still have an unanswered question about the plan you explained to me. Please give me a shorter explanation and check whether I understand it." No financial update is asserted.`,
    label_reason: 'An explicit unresolved question and communication preference warrant relationship assessment.' },
  { kind: 'irrelevant', expected_assess: false, expected_predicate: null,
    summary: () => 'SYNTHETIC EVALUATION EVENT: An unrelated office in a different city finished repainting an internal conference room. This notice does not involve this family, their employer, properties, accounts, goals, services, communication preferences or advisor. No financial, relationship or service change is reported.',
    label_reason: 'The event explicitly has no connection to this family or the advisory service.' },
  { kind: 'insufficient_evidence', expected_assess: true, expected_predicate: 'insufficient_evidence',
    summary: family => `SYNTHETIC EVALUATION EVENT: An incomplete unverified alert specifically names ${family.name} and claims there may have been a change to this household's income or debt. The amount, affected person, effective date and supporting source are all missing. Do not treat the claim as confirmed, but its potential relevance cannot yet be ruled out.`,
    label_reason: 'A specifically attributed potentially material claim with missing support warrants assessment for clarification, not automatic dismissal or a fact update.' },
];

try {
  const router = createOpenAIRouterFromEnv(process.env);
  const ai = createAI({ rootDir, router });
  const cases = store.listFamilies().flatMap(family => definitions.map(definition => ({ family_id: family.id,
    case_id: `${family.id}:${definition.kind}`, kind: definition.kind, expected_assess: definition.expected_assess,
    expected_predicate: definition.expected_predicate, label_reason: definition.label_reason, summary: definition.summary(family) })));
  let cursor = 0;
  async function worker() {
    while (cursor < cases.length) {
      const item = cases[cursor++]; const began = performance.now();
      try {
        const result = await ai.relevance({ family: store.context(item.family_id), event: {
          id: item.case_id, origin: 'advisor_input', scope: 'global', kind: item.kind,
          family_ids: [], summary: item.summary, simulated: true, occurred_at: store.now(), observed_at: store.now(),
        } });
        const probabilities = result.probabilities;
        const values = Object.values(probabilities);
        const missing = values.some(value => value === null);
        report.cases.push({ ...item, status: 'passed', probabilities, model: result.model, credential: result.credential,
          latency_ms: result.latency_ms, missing_predicate: missing,
          route_by_threshold: Object.fromEntries(report.thresholds.map(threshold => [threshold, missing || values.some(value => value >= threshold) ? 'assess' : 'discard'])) });
        console.log(`PASS ${item.case_id} (${result.latency_ms} ms)`);
      } catch (error) {
        const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(error.code) ? error.code : 'provider_request_failed';
        report.cases.push({ ...item, status: 'failed', code, http_status: Number.isInteger(error?.status) ? error.status : null,
          latency_ms: Math.round(performance.now() - began) });
        console.error(`FAIL ${item.case_id} (${code})`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  report.cases.sort((a, b) => a.case_id.localeCompare(b.case_id));
  const successful = report.cases.filter(item => item.status === 'passed');
  report.threshold_results = report.thresholds.map(threshold => {
    const false_negatives = successful.filter(item => item.expected_assess && item.route_by_threshold[threshold] === 'discard').map(item => item.case_id);
    const false_positives = successful.filter(item => !item.expected_assess && item.route_by_threshold[threshold] === 'assess').map(item => item.case_id);
    const positives = successful.filter(item => item.expected_assess).length;
    const negatives = successful.length - positives;
    return { threshold, evaluated: successful.length, expected_positive: positives, expected_negative: negatives,
      false_negative_count: false_negatives.length, false_negatives, false_positive_count: false_positives.length, false_positives,
      observed_false_negative_rate: positives ? false_negatives.length / positives : null,
      true_positive_count: positives - false_negatives.length, true_negative_count: negatives - false_positives.length };
  });
  const complete = successful.length === cases.length && successful.every(item => !item.missing_predicate);
  const conservative = complete ? report.threshold_results.find(result => result.false_negative_count === 0 && result.true_negative_count > 0) : null;
  report.threshold_recommendation = conservative ? {
    threshold: conservative.threshold, applied_to_configuration: false,
    basis: 'Lowest tested threshold with no observed misses and at least one correct discard in this small synthetic set. Conservative provisional suggestion only; compare on representative independently labeled cases before treating it as calibrated.',
  } : { threshold: null, applied_to_configuration: false, basis: 'Incomplete evidence or no tested threshold demonstrated both zero observed misses and any correct discard.' };
  report.status = complete ? 'passed' : 'incomplete';
  if (!complete) process.exitCode = 1;
} catch (error) {
  report.status = 'failed';
  report.error = typeof error?.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(error.code) ? error.code : 'evaluation_failed';
  process.exitCode = 1;
} finally {
  store.close();
  report.completed_at = new Date().toISOString(); report.elapsed_ms = Math.round(performance.now() - started);
  await mkdir(reportDir, { recursive: true, mode: 0o700 });
  await writeFile(join(reportDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (report.threshold_results) console.log(JSON.stringify(report.threshold_results.map(({ threshold, false_negative_count, false_positive_count, true_negative_count }) => ({ threshold, false_negative_count, false_positive_count, true_negative_count }))));
  console.log(`Report: ${join(reportDir, 'latest.json')}`);
}
