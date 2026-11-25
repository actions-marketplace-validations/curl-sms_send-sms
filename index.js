'use strict';

const { run } = require('./lib.js');

run().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stdout.write(`::error title=curl-sms::${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
