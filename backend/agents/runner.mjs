import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';

export function childEnvironment(env) {
  // Keep subscription login configuration, but never inherit service/API credentials.
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|WEBHOOK_SECRET|TEAM_KEY|MCP_TOKEN|^CODEX_API_KEY$)/i.test(key)));
}

export async function resolveExecutable(value, env = process.env) {
  if (!value) throw new Error('agent_binary_not_configured');
  const candidates = isAbsolute(value) ? [value] : (env.PATH || process.env.PATH || '').split(delimiter).map(dir => resolve(dir, value));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Next PATH entry. */ }
  }
  throw new Error('agent_binary_not_found');
}

export function executeProcess({ executable, args, cwd, env, stdin, timeoutMs = 120000, maxOutputBytes = 2_000_000, onProgress = () => {} }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', size = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolvePromise(result);
    };
    const timer = setTimeout(() => finish(new Error('agent_timeout')), timeoutMs);
    child.on('error', () => finish(new Error('agent_spawn_failed')));
    child.stdout.on('data', data => {
      size += data.length;
      if (size > maxOutputBytes) return finish(new Error('agent_output_limit'));
      stdout += data.toString(); onProgress();
    });
    child.stderr.on('data', data => {
      size += data.length;
      if (size > maxOutputBytes) return finish(new Error('agent_output_limit'));
      stderr += data.toString();
    });
    child.on('close', code => finish(code === 0 ? null : new Error(`agent_process_failed_${code ?? 'signal'}`), { stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}

export function parseFinal(provider, stdout) {
  if (provider === 'claude') {
    const result = JSON.parse(stdout);
    if (result.is_error) throw new Error('agent_provider_error');
    return result.structured_output ?? JSON.parse(result.result);
  }
  const events = stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const text = events.filter(event => event.type === 'text').map(event => event.part?.text ?? event.text ?? '').join('');
  if (provider === 'opencode' && text) return JSON.parse(text);
  const last = events.findLast(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  if (last?.item?.text) return JSON.parse(last.item.text);
  throw new Error('agent_output_missing');
}

export function createAgentRunner({ rootDir, env, trace = () => {}, processRunner = executeProcess }) {
  return async ({ stage, input, schema, prompt }) => {
    const provider = (env.AGENT_PROVIDER || 'codex').toLowerCase();
    if (!['codex', 'claude', 'opencode'].includes(provider)) throw new Error('agent_provider_unsupported');
    const executable = await resolveExecutable(env[`${provider.toUpperCase()}_BIN`] || provider, env);
    const jobId = randomUUID();
    const jobDir = join(resolve(rootDir, env.AGENT_WORKSPACES_DIR || 'var/agents'), jobId);
    await mkdir(jobDir, { recursive: true, mode: 0o700 });
    const schemaPath = join(jobDir, 'schema.json'), resultPath = join(jobDir, 'result.json');
    await writeFile(join(jobDir, 'input.json'), JSON.stringify(input, null, 2), { mode: 0o600 });
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const model = env[`${provider.toUpperCase()}_MODEL`] || env.AGENT_MODEL || null;
    const childEnv = childEnvironment(env);
    const message = `${prompt}\n\nINPUT:\n${JSON.stringify(input)}\n\nOUTPUT_SCHEMA:\n${JSON.stringify(schema)}`;
    let args;
    if (provider === 'codex') {
      args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json',
        '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"',
        '--output-schema', schemaPath, '--output-last-message', resultPath, '-C', jobDir];
      if (model) args.push('--model', model);
      args.push('-');
    } else if (provider === 'claude') {
      args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence', '--tools', ''];
      if (model) args.push('--model', model);
    } else {
      args = ['run', '--format', 'json', '--standalone'];
      if (model) args.push('--model', model);
      childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { '*': 'deny' } });
    }
    const started = Date.now();
    trace({ stage, provider, model: model || 'provider_default', job_id: jobId, status: 'started' });
    let lastProgress = started;
    try {
      const result = await processRunner({ executable, args, cwd: jobDir, env: childEnv, stdin: message,
        timeoutMs: Math.min(120000, Math.max(1000, Number(env.AGENT_TIMEOUT_MS) || 120000)),
        onProgress: () => { if (Date.now() - lastProgress > 5000) { lastProgress = Date.now(); trace({ stage, provider, job_id: jobId, status: 'running' }); } },
      });
      let output;
      if (provider === 'codex') {
        try { output = JSON.parse(await readFile(resultPath, 'utf8')); } catch { output = parseFinal(provider, result.stdout); }
      } else output = parseFinal(provider, result.stdout);
      const latency_ms = Date.now() - started;
      trace({ stage, provider, job_id: jobId, status: 'completed', latency_ms });
      return { output, provider, model: model || 'provider_default', latency_ms, job_id: jobId };
    } catch (error) {
      trace({ stage, provider, job_id: jobId, status: 'failed', code: /^agent_/.test(error.message) ? error.message : 'agent_invalid_output' });
      throw error;
    }
  };
}
