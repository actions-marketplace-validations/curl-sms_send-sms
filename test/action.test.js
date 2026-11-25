'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const { run, parseReceivers, defaultIdempotencyKey } = require('../lib.js');
const { createServer } = require('./mock-server.js');

let baseUrl;
let mock;

before(async () => {
  mock = createServer();
  await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${mock.server.address().port}`;
});

after(() => mock.server.close());

function setup(inputs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-sms-'));
  const env = {
    GITHUB_OUTPUT: path.join(dir, 'output'),
    GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
    GITHUB_REPOSITORY: 'curl-sms/example',
    GITHUB_RUN_ID: '42',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'deploy',
    'INPUT_BASE-URL': baseUrl,
    'INPUT_FAIL-ON-ERROR': 'true',
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const lines = [];
  const outputs = () => {
    const text = fs.existsSync(env.GITHUB_OUTPUT) ? fs.readFileSync(env.GITHUB_OUTPUT, 'utf8') : '';
    const result = {};
    for (const m of text.matchAll(/^(\w+)<<(\S+)\r?\n([\s\S]*?)\r?\n\2$/gm)) result[m[1]] = m[3];
    return result;
  };
  return { env, lines, log: (l) => lines.push(l), outputs, sleep: async () => {} };
}

test('sends one SMS and sets outputs', async () => {
  const s = setup({ 'api-key': 'cs_test_example', receiver: '+4915123456789', body: 'Deploy failed' });
  const code = await run(s);
  assert.equal(code, 0);
  const out = s.outputs();
  assert.equal(out.status, 'queued');
  assert.equal(out.mode, 'test');
  assert.equal(out.segments, '1');
  assert.deepEqual(JSON.parse(out.ids), [out.id]);
  const req = mock.requests.at(-1);
  assert.deepEqual(req.body, { receiver: '+4915123456789', body: 'Deploy failed' });
  assert.equal(req.headers.authorization, 'Bearer cs_test_example');
  assert.match(req.headers['idempotency-key'], /^gha-curl-sms\/example-42-1-deploy-[0-9a-f]{16}$/);
  assert.match(req.headers['user-agent'], /^curl-sms-github-action\//);
  assert.ok(s.lines.includes('::add-mask::cs_test_example'));
  assert.match(fs.readFileSync(s.env.GITHUB_STEP_SUMMARY, 'utf8'), /SMS sent with curl-sms/);
});

test('sends to several receivers with send_at', async () => {
  const s = setup({
    'api-key': 'cs_test_example',
    receiver: '+4915123456789,\n+4917612345678',
    body: 'Release v2 is out',
    'send-at': '2026-12-24T09:00:00+01:00',
  });
  assert.equal(await run(s), 0);
  assert.deepEqual(mock.requests.at(-1).body, {
    receivers: ['+4915123456789', '+4917612345678'],
    body: 'Release v2 is out',
    send_at: '2026-12-24T09:00:00+01:00',
  });
  assert.equal(JSON.parse(s.outputs().ids).length, 2);
});

test('retries 429 with the same idempotency key', async () => {
  const s = setup({ 'api-key': 'cs_test_example', receiver: '+4915100000429', body: 'Hi', 'idempotency-key': 'my-key' });
  const before = mock.requests.length;
  assert.equal(await run(s), 0);
  const reqs = mock.requests.slice(before);
  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs.map((r) => r.headers['idempotency-key']), ['my-key', 'my-key']);
});

test('fails on 422 without retry and reports the code', async () => {
  const s = setup({ 'api-key': 'cs_test_example', receiver: '+4915100000422', body: 'Hi' });
  const before = mock.requests.length;
  assert.equal(await run(s), 1);
  assert.equal(mock.requests.length - before, 1);
  assert.ok(s.lines.some((l) => l.startsWith('::error') && l.includes('invalid_receiver') && l.includes('receiver 1')));
});

test('only warns when fail-on-error is false', async () => {
  const s = setup({ 'api-key': 'cs_test_example', receiver: '+4915100000422', body: 'Hi', 'fail-on-error': 'false' });
  assert.equal(await run(s), 0);
  assert.ok(s.lines.some((l) => l.startsWith('::warning')));
});

test('rejects missing inputs before calling the API', async () => {
  const before = mock.requests.length;
  assert.equal(await run(setup({ 'api-key': '', receiver: '+4915123456789', body: 'x' })), 1);
  assert.equal(await run(setup({ 'api-key': 'cs_test_example', receiver: '', body: 'x' })), 1);
  assert.equal(await run(setup({ 'api-key': 'cs_test_example', receiver: '+4915123456789', body: '' })), 1);
  assert.equal(mock.requests.length, before);
});

test('parseReceivers splits on commas, semicolons and new lines', () => {
  assert.deepEqual(parseReceivers(' +491 ,\n+492;+493\n\n'), ['+491', '+492', '+493']);
});

test('default idempotency key is stable and depends on the message', () => {
  const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'j' };
  const a = defaultIdempotencyKey(env, { receiver: '+491', body: 'a' });
  assert.equal(a, defaultIdempotencyKey(env, { receiver: '+491', body: 'a' }));
  assert.notEqual(a, defaultIdempotencyKey(env, { receiver: '+491', body: 'b' }));
  assert.ok(a.length <= 255);
});
