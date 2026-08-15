const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const imageClient = require('../src/services/imageClient');

// ---- 使用真实 MySQL（localminidrama），测试数据以 test_ 前缀隔离并在 before/after 清理 ----
function makeDb() {
  const db = getDb(loadConfig().database);
  db.prepare("DELETE FROM image_proxy_cache WHERE cache_key LIKE 'test_%'").run();
  return db;
}

function cleanup(db) {
  db.prepare("DELETE FROM image_proxy_cache WHERE cache_key LIKE 'test_%'").run();
}

describe('image_proxy_cache', () => {
  let db;
  before(() => { db = makeDb(); });
  after(() => { cleanup(db); closeDb(); });

  it('getProxyCache returns null when entry expired by expire_hours', () => {
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    db.prepare(
      'INSERT INTO image_proxy_cache (cache_key, proxy_url, created_at) VALUES (?, ?, ?)'
    ).run('test_scenes/expired.jpg', 'https://example.com/a.jpg', old);

    assert.equal(imageClient.getProxyCache(db, 'test_scenes/expired.jpg'), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM image_proxy_cache WHERE cache_key = 'test_scenes/expired.jpg'").get().c, 0);
  });

  it('getProxyCache returns url when entry still fresh', () => {
    imageClient.setProxyCache(db, 'test_scenes/fresh.jpg', 'https://example.com/fresh.jpg');
    assert.equal(imageClient.getProxyCache(db, 'test_scenes/fresh.jpg'), 'https://example.com/fresh.jpg');
  });

  it('deleteProxyCache removes row', () => {
    imageClient.setProxyCache(db, 'test_k1', 'https://example.com/x.jpg');
    imageClient.deleteProxyCache(db, 'test_k1');
    assert.equal(imageClient.getProxyCache(db, 'test_k1'), null);
  });
});
