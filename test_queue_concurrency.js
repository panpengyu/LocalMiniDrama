/**
 * 并发限流队列验证脚本
 *  - 验证 MergeAsyncQueue (concurrency=2) 替换 setImmediate 后的正确限流
 *  - 验证 BgmAsyncQueue (concurrency=4) 的限流
 *  - 模拟 10 并发视频合成 + 6 并发 BGM 生成，确认并发峰值不超过上限
 */
'use strict';
const path = require('path');
const backendDir = path.join(__dirname, 'backend-node');
process.chdir(backendDir);

const { AsyncQueue } = require('./backend-node/src/utils/concurrency');
const dramaService = require('./backend-node/src/services/dramaService');
const bgmService = require('./backend-node/src/services/bgmService');

// ---------------- 工具：模拟一个耗时任务 ----------------
function makeSlowTask(label, durationMs) {
  return () => new Promise((resolve) => {
    setTimeout(() => resolve({ label, done: Date.now() }), durationMs);
  });
}

// ---------------- 通用队列并发验证器 ----------------
async function verifyQueueConcurrency(queue, taskCount, taskMs, expectMax) {
  const stats0 = queue.stats;
  console.log(`\n===== [${stats0.name}] 开始验证：提交 ${taskCount} 个任务，每个耗时 ${taskMs}ms，期望并发上限=${expectMax} =====`);
  console.log(`  初始状态: ${JSON.stringify(stats0)}`);

  let peakRunning = 0;
  const startTimes = [];
  const endTimes = [];
  const sampleTimer = setInterval(() => {
    const s = queue.stats;
    if (s.running > peakRunning) peakRunning = s.running;
    if (s.running > 0 || s.queued > 0) {
      console.log(`  [采样] running=${s.running}/${s.concurrency}  queued=${s.queued}  completed=${s.completed}`);
    }
  }, 20);

  const t0 = Date.now();
  const promises = [];
  for (let i = 0; i < taskCount; i++) {
    startTimes.push(Date.now());
    promises.push(queue.add(makeSlowTask(`task-${i}`, taskMs)).then(() => { endTimes.push(Date.now()); }));
  }
  await Promise.all(promises);
  clearInterval(sampleTimer);
  // 最终再取一次峰值（防止采样漏掉）
  const finalStats = queue.stats;
  if (finalStats.running > peakRunning) peakRunning = finalStats.running;

  const totalMs = Date.now() - t0;
  console.log(`  ----- 结果 -----`);
  console.log(`  提交任务数: ${taskCount}`);
  console.log(`  并发上限(concurrency): ${stats0.concurrency}`);
  console.log(`  实测并发峰值(peakRunning): ${peakRunning}`);
  console.log(`  期望并发上限(expectMax): ${expectMax}`);
  console.log(`  总耗时: ${totalMs}ms  (理论最小: ${Math.ceil(taskCount / expectMax) * taskMs}ms)`);
  console.log(`  完成/提交: ${finalStats.completed}/${finalStats.submitted}`);
  console.log(`  最终状态: ${JSON.stringify(finalStats)}`);

  const pass = peakRunning <= expectMax && finalStats.completed === taskCount;
  console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'}: ${pass ? `并发峰值 ${peakRunning} ≤ 上限 ${expectMax}，全部完成` : `并发峰值 ${peakRunning} > 上限 ${expectMax} 或未全部完成`}`);
  return { pass, peakRunning, expectMax, totalMs, taskCount };
}

// ---------------- 主流程 ----------------
(async () => {
  const results = [];

  // 1) 验证 MergeAsyncQueue 实例（从 dramaService 拿，确认读自 config.yaml）
  const mergeQ = dramaService._MergeAsyncQueue;
  console.log('\n########################################################################');
  console.log('# 1. MergeAsyncQueue 配置来源验证（dramaService._MergeAsyncQueue）');
  console.log('########################################################################');
  console.log(`  stats=${JSON.stringify(mergeQ.stats)}`);
  console.log(`  concurrency=${mergeQ.concurrency}  (config.yaml queue.merge_concurrency=2)`);
  results.push({ name: 'MergeAsyncQueue 配置读取', pass: mergeQ.concurrency === 2, detail: `concurrency=${mergeQ.concurrency}` });

  // 2) 10 并发视频合成任务 → 期望并发峰值 ≤ 2
  console.log('\n########################################################################');
  console.log('# 2. 模拟 10 并发视频合成任务（替换原 setImmediate 无界并发）');
  console.log('########################################################################');
  results.push(Object.assign({ name: 'MergeAsyncQueue 10并发限流' },
    await verifyQueueConcurrency(mergeQ, 10, 150, 2)));

  // 3) 6 并发 BGM 生成任务 → 期望并发峰值 ≤ 4
  console.log('\n########################################################################');
  console.log('# 3. 模拟 6 并发 BGM 生成任务（BgmAsyncQueue concurrency=4）');
  console.log('########################################################################');
  const bgmQ = bgmService._BgmAsyncQueue;
  console.log(`  BgmAsyncQueue stats=${JSON.stringify(bgmQ.stats)}`);
  results.push(Object.assign({ name: 'BgmAsyncQueue 6并发限流' },
    await verifyQueueConcurrency(bgmQ, 6, 120, 4)));

  // 4) 同时跑两个队列（混合并发）—— 验证互不干扰
  console.log('\n########################################################################');
  console.log('# 4. 混合并发：8视频合成 + 6 BGM 同时提交，验证两个队列互不干扰');
  console.log('########################################################################');
  let mergePeak = 0, bgmPeak = 0;
  const ms = setInterval(() => {
    const m = mergeQ.stats; if (m.running > mergePeak) mergePeak = m.running;
    const b = bgmQ.stats; if (b.running > bgmPeak) bgmPeak = b.running;
  }, 15);
  const mixed = [];
  for (let i = 0; i < 8; i++) mixed.push(mergeQ.add(makeSlowTask(`merge-${i}`, 120)));
  for (let i = 0; i < 6; i++) mixed.push(bgmQ.add(makeSlowTask(`bgm-${i}`, 100)));
  await Promise.all(mixed);
  clearInterval(ms);
  const mixedPass = mergePeak <= 2 && bgmPeak <= 4;
  console.log(`  混合结果: mergePeak=${mergePeak}(≤2 ${mergePeak<=2?'✅':'❌'})  bgmPeak=${bgmPeak}(≤4 ${bgmPeak<=4?'✅':'❌'})  → ${mixedPass?'✅ PASS':'❌ FAIL'}`);
  results.push({ name: '混合并发互不干扰', pass: mixedPass, detail: `mergePeak=${mergePeak} bgmPeak=${bgmPeak}` });

  // ---------------- 汇总 ----------------
  console.log('\n\n==================== 验证汇总 ====================');
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}  ${r.detail || ''}`);
    if (!r.pass) allPass = false;
  }
  console.log(`\n  总体: ${allPass ? '✅ 全部通过 — MergeAsyncQueue 已正确替换 setImmediate 并限流' : '❌ 存在失败项'}`);
  process.exit(allPass ? 0 : 1);
})().catch((e) => { console.error('脚本异常:', e); process.exit(2); });
