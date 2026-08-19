'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { loadConfig } = require(path.resolve(__dirname, '../src/config/index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '../src/db/index.js'));
const opsService = require(path.resolve(__dirname, '../src/services/opsService.js'));

const cfg = loadConfig();
const db = getDb(cfg.database);
const log = { info() {}, warn() {}, error() {} };

test.before(() => {
  console.log('probe: before');
});
test.after(async () => {
  console.log('probe: after');
  closeDb();
  try {
    const qs = require(path.resolve(__dirname, '..', 'src', 'services', 'queueService.js'));
    await Promise.race([qs.closeQueue(), new Promise((r) => setTimeout(r, 3000))]);
  } catch (_) {}
});

test('probe A getScalingAdvice', async () => {
  const r = await opsService.getScalingAdvice(db, log);
  assert.ok(r && typeof r === 'object' && Array.isArray(r.reasons));
  assert.ok(typeof r.suggestion === 'string' && r.metrics && r.metrics.cpu_pct >= 0);
  console.log('probe: A done');
});

test('probe B backup skip', async () => {
  process.env.OPS_SKIP_DB = '1';
  process.env.OPS_SKIP_STORAGE = '1';
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe_'));
    const r = await opsService.runScript('backup', { args: [tmp], timeoutMs: 30000 });
    assert.equal(r.code, 0);
    console.log('probe: B done');
  } finally {
    delete process.env.OPS_SKIP_DB;
    delete process.env.OPS_SKIP_STORAGE;
  }
});
