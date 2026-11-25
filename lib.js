'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');

const VERSION = '1.0.0';

/** Reads an action input the way the runner passes it (INPUT_<NAME>). */
function getInput(env, name) {
  return (env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '').trim();
}

function parseReceivers(value) {
  return value
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultIdempotencyKey(env, payload) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const parts = [env.GITHUB_REPOSITORY, env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT, env.GITHUB_JOB].filter(Boolean);
  return ['gha', ...parts, hash].join('-').replace(/[^\x21-\x7e]/g, '_').slice(0, 255);
}

function writeFileCommand(file, name, value) {
  if (!file) return;
  const delimiter = `ghadelim_${crypto.randomUUID()}`;
  fs.appendFileSync(file, `${name}<<${delimiter}${os.EOL}${value}${os.EOL}${delimiter}${os.EOL}`);
}

function mask(value) {
  return value.length <= 4 ? '****' : `…${value.slice(-4)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the action. Returns the process exit code.
 * `deps` lets tests inject env, fetch, logging and sleep.
 */
async function run(deps = {}) {
  const env = deps.env || process.env;
  const fetchFn = deps.fetch || globalThis.fetch;
  const log = deps.log || ((line) => process.stdout.write(`${line}\n`));
  const wait = deps.sleep || sleep;

  const apiKey = getInput(env, 'api-key');
  const receivers = parseReceivers(getInput(env, 'receiver'));
  const body = getInput(env, 'body');
  const sendAt = getInput(env, 'send-at');
  const failOnError = getInput(env, 'fail-on-error').toLowerCase() !== 'false';
  const language = getInput(env, 'language') || 'en';
  const baseUrl = (getInput(env, 'base-url') || 'https://curl-sms.com').replace(/\/+$/, '');

  const fail = (message) => {
    log(failOnError ? `::error title=curl-sms::${message}` : `::warning title=curl-sms::${message}`);
    return failOnError ? 1 : 0;
  };

  if (apiKey) log(`::add-mask::${apiKey}`);
  if (!apiKey) return fail('Input api-key is empty. Add your key as a secret, e.g. api-key: ${{ secrets.CURLSMS_API_KEY }}');
  if (receivers.length === 0) return fail('Input receiver is empty.');
  if (receivers.length > 100) return fail(`At most 100 receivers per request, got ${receivers.length}.`);
  if (!body) return fail('Input body is empty.');

  const payload = receivers.length === 1 ? { receiver: receivers[0], body } : { receivers, body };
  if (sendAt) payload.send_at = sendAt;
  const idempotencyKey = getInput(env, 'idempotency-key') || defaultIdempotencyKey(env, payload);

  const maxAttempts = 3;
  let response;
  let data;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await fetchFn(`${baseUrl}/api/sms/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Language': language,
          'Idempotency-Key': idempotencyKey,
          'User-Agent': `curl-sms-github-action/${VERSION}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt === maxAttempts) return fail(`Network error: ${err.message}`);
      await wait(1000 * 2 ** (attempt - 1));
      continue;
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 1000 * 2 ** (attempt - 1));
      continue;
    }
    break;
  }

  try {
    data = await response.json();
  } catch {
    return fail(`Unexpected response (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const e = (data && data.error) || {};
    const where = Number.isInteger(e.index) ? ` (receiver ${e.index + 1})` : '';
    return fail(`HTTP ${response.status} ${e.code || 'error'}: ${e.message || 'request failed'}${where}`);
  }

  const messages = Array.isArray(data.messages) ? data.messages : [data];
  const first = messages[0];
  const outputs = {
    id: first.id,
    ids: JSON.stringify(messages.map((m) => m.id)),
    status: first.status,
    mode: first.mode,
    segments: String(first.segments),
    price: first.price,
  };
  for (const [name, value] of Object.entries(outputs)) writeFileCommand(env.GITHUB_OUTPUT, name, value);

  const receiverList = messages.map((m) => mask(m.receiver || '')).join(', ');
  log(`SMS ${outputs.status}: ${messages.length} message(s) to ${receiverList}, mode ${outputs.mode}, ${outputs.segments} part(s), id ${outputs.id}`);
  if (env.GITHUB_STEP_SUMMARY) {
    const rows = messages.map((m) => `| \`${m.id}\` | ${mask(m.receiver || '')} | ${m.status} | ${m.mode} | ${m.segments} | ${m.price} |`);
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      ['### SMS sent with curl-sms', '', '| ID | Receiver | Status | Mode | Parts | Price (EUR) |', '|---|---|---|---|---|---|', ...rows, ''].join(os.EOL) + os.EOL,
    );
  }
  return 0;
}

module.exports = { run, parseReceivers, defaultIdempotencyKey, getInput, VERSION };
