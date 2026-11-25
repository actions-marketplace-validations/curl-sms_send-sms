'use strict';

// Minimal stand-in for the curl-sms API, used by unit tests and the CI end-to-end job.
// Behaviour by receiver:
//   +4915100000429 -> 429 once, then success
//   +4915100000422 -> 422 invalid_receiver
//   anything else  -> 202 with a test-mode message
const http = require('node:http');

function message(receiver, i = 0) {
  return {
    id: `01JDQ8M3V6R1T5ZK2X9N4C7B0${i}`,
    mode: 'test',
    receiver,
    status: 'queued',
    segments: 1,
    encoding: 'gsm7',
    price: '0.00',
    error_code: null,
    created_at: '2026-11-25T10:15:00.000Z',
    send_at: null,
    sent_at: null,
    delivered_at: null,
    refunded: false,
  };
}

function createServer() {
  const requests = [];
  let throttled = false;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const send = (status, obj, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
      };
      if (req.method !== 'POST' || req.url !== '/api/sms/send') return send(404, { error: { code: 'not_found', message: 'Not found.' } });
      if (!/^Bearer cs_(test|live)_/.test(req.headers.authorization || '')) {
        return send(401, { error: { code: 'unauthorized', message: 'API key missing or invalid.' } });
      }
      const receivers = body.receivers || [body.receiver];
      if (receivers.includes('+4915100000422')) {
        return send(422, { error: { code: 'invalid_receiver', message: 'Invalid receiver number.', index: receivers.indexOf('+4915100000422') } });
      }
      if (receivers.includes('+4915100000429') && !throttled) {
        throttled = true;
        return send(429, { error: { code: 'rate_limited', message: 'Too many requests.' } }, { 'Retry-After': '1' });
      }
      if (body.receivers) {
        const messages = receivers.map((r, i) => message(r, i));
        return send(202, { ids: messages.map((m) => m.id), messages });
      }
      return send(202, message(body.receiver));
    });
  });
  return { server, requests };
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  createServer().server.listen(port, '127.0.0.1', () => console.log(`mock curl-sms API on http://127.0.0.1:${port}`));
}
