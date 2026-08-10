// ============================================================
// s7Transitions.test.js — Sprint 7
// S7-T06: 转场效果库测试
// 覆盖场景：
//   1) TRANSITIONS 常量 — 6 种转场效果完整定义
//   2) listTransitions — 列出所有转场效果
//   3) getTransition — 按 key 获取转场
//   4) buildTransitionFilter — 单片段无需转场
//   5) buildTransitionFilter — 多片段硬切拼接
//   6) buildTransitionFilter — 多片段含转场（fade/dissolve/slide/zoom/rotate）
//   7) getFilter — 各转场效果返回正确滤镜参数
//   8) 转场时长校验（hard_cut=0, 其余=0.5）
// ============================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TRANSITIONS,
  listTransitions,
  getTransition,
  buildTransitionFilter,
} = require('../src/services/transitionEffects');

// ============================================================
// 1. TRANSITIONS 常量 — 6 种转场效果
// ============================================================

test('S7-TR-01: TRANSITIONS — 包含 6 种转场效果', () => {
  const keys = Object.keys(TRANSITIONS);
  assert.strictEqual(keys.length, 6, '应有 6 种转场效果');
  const expected = ['hard_cut', 'fade', 'dissolve', 'slide', 'zoom', 'rotate'];
  for (const k of expected) {
    assert.ok(TRANSITIONS[k], `应包含 ${k} 转场`);
    assert.ok(TRANSITIONS[k].name, `${k} 应有名称`);
    assert.ok(TRANSITIONS[k].description, `${k} 应有描述`);
    assert.strictEqual(typeof TRANSITIONS[k].getFilter, 'function', `${k} 应有 getFilter 方法`);
  }
});

test('S7-TR-02: TRANSITIONS — 转场时长校验', () => {
  assert.strictEqual(TRANSITIONS.hard_cut.duration, 0, '硬切时长为 0');
  assert.strictEqual(TRANSITIONS.fade.duration, 0.5, '淡入淡出时长为 0.5');
  assert.strictEqual(TRANSITIONS.dissolve.duration, 0.5, '叠化时长为 0.5');
  assert.strictEqual(TRANSITIONS.slide.duration, 0.5, '滑动时长为 0.5');
  assert.strictEqual(TRANSITIONS.zoom.duration, 0.5, '缩放时长为 0.5');
  assert.strictEqual(TRANSITIONS.rotate.duration, 0.5, '旋转时长为 0.5');
});

// ============================================================
// 2. listTransitions — 列出所有转场效果
// ============================================================

test('S7-TR-03: listTransitions — 返回 6 条转场效果', () => {
  const list = listTransitions();
  assert.strictEqual(list.length, 6);
  const keys = list.map((t) => t.key);
  assert.ok(keys.includes('hard_cut'));
  assert.ok(keys.includes('fade'));
  assert.ok(keys.includes('dissolve'));
  assert.ok(keys.includes('slide'));
  assert.ok(keys.includes('zoom'));
  assert.ok(keys.includes('rotate'));
  // 每条都有 key/name/description/duration
  for (const t of list) {
    assert.ok(t.key);
    assert.ok(t.name);
    assert.ok(t.description);
    assert.strictEqual(typeof t.duration, 'number');
  }
});

// ============================================================
// 3. getTransition — 按 key 获取
// ============================================================

test('S7-TR-04: getTransition — 按 key 获取转场', () => {
  const fade = getTransition('fade');
  assert.ok(fade);
  assert.strictEqual(fade.name, '淡入淡出');
  assert.strictEqual(fade.duration, 0.5);
  const hardCut = getTransition('hard_cut');
  assert.ok(hardCut);
  assert.strictEqual(hardCut.duration, 0);
});

test('S7-TR-05: getTransition — 不存在的 key 返回 null', () => {
  const result = getTransition('non_existent');
  assert.strictEqual(result, null);
});

// ============================================================
// 4. getFilter — 各转场效果滤镜参数
// ============================================================

test('S7-TR-06: hard_cut.getFilter — 返回 null（无滤镜）', () => {
  const filter = TRANSITIONS.hard_cut.getFilter(3.0, 3.0);
  assert.strictEqual(filter, null);
});

test('S7-TR-07: fade.getFilter — 返回 fade 类型滤镜', () => {
  const filter = TRANSITIONS.fade.getFilter(3.0, 3.0);
  assert.ok(filter);
  assert.strictEqual(filter.type, 'fade');
  assert.ok(filter.params.includes('st=3'));
  assert.ok(filter.params.includes('d=0.5'));
});

test('S7-TR-08: dissolve.getFilter — 返回 xfade dissolve 滤镜', () => {
  const filter = TRANSITIONS.dissolve.getFilter(3.0, 3.0);
  assert.ok(filter);
  assert.strictEqual(filter.type, 'xfade');
  assert.ok(filter.params.includes('transition=dissolve'));
  assert.ok(filter.params.includes('duration=0.5'));
});

test('S7-TR-09: slide.getFilter — 返回 xfade slideleft 滤镜', () => {
  const filter = TRANSITIONS.slide.getFilter(3.0, 3.0);
  assert.ok(filter);
  assert.strictEqual(filter.type, 'xfade');
  assert.ok(filter.params.includes('transition=slideleft'));
});

test('S7-TR-10: zoom.getFilter — 返回 xfade zoomin 滤镜', () => {
  const filter = TRANSITIONS.zoom.getFilter(3.0, 3.0);
  assert.ok(filter);
  assert.strictEqual(filter.type, 'xfade');
  assert.ok(filter.params.includes('transition=zoomin'));
});

test('S7-TR-11: rotate.getFilter — 返回 xfade radial 滤镜', () => {
  const filter = TRANSITIONS.rotate.getFilter(3.0, 3.0);
  assert.ok(filter);
  assert.strictEqual(filter.type, 'xfade');
  assert.ok(filter.params.includes('transition=radial'));
});

// ============================================================
// 5. buildTransitionFilter — 构建转场滤镜
// ============================================================

test('S7-TR-12: buildTransitionFilter — 空片段返回空滤镜', () => {
  const result = buildTransitionFilter([]);
  assert.strictEqual(result.filterComplex, '');
  assert.strictEqual(result.inputs, 0);
});

test('S7-TR-13: buildTransitionFilter — 单片段无需转场', () => {
  const clips = [{ duration: 3.0, transition_type: 'hard_cut' }];
  const result = buildTransitionFilter(clips);
  assert.ok(result.filterComplex);
  assert.ok(result.filterComplex.includes('[0:v]'));
  assert.strictEqual(result.inputs, 1);
});

test('S7-TR-14: buildTransitionFilter — 两片段硬切拼接', () => {
  const clips = [
    { duration: 3.0, transition_type: 'hard_cut' },
    { duration: 2.5, transition_type: 'hard_cut' },
  ];
  const result = buildTransitionFilter(clips);
  assert.ok(result.filterComplex);
  assert.strictEqual(result.inputs, 2);
  // 硬切应使用 setpts 而非 xfade
  assert.ok(result.filterComplex.includes('setpts'));
});

test('S7-TR-15: buildTransitionFilter — 两片段含 fade 转场', () => {
  // buildTransitionFilter 检查 clips[i-1].transition_type 决定 i-1→i 的转场
  // 因此第一段设为 fade，第二段设为 hard_cut
  const clips = [
    { duration: 3.0, transition_type: 'fade' },
    { duration: 2.5, transition_type: 'hard_cut' },
  ];
  const result = buildTransitionFilter(clips);
  assert.ok(result.filterComplex);
  assert.strictEqual(result.inputs, 2);
  // fade 的 duration=0.5 > 0 → 应使用 xfade 转场
  assert.ok(
    result.filterComplex.includes('xfade') || result.filterComplex.includes('fade'),
    '应包含转场滤镜'
  );
});

test('S7-TR-16: buildTransitionFilter — 多片段含多种转场', () => {
  const clips = [
    { duration: 3.0, transition_type: 'hard_cut' },
    { duration: 2.5, transition_type: 'fade' },
    { duration: 4.0, transition_type: 'dissolve' },
    { duration: 3.5, transition_type: 'slide' },
  ];
  const result = buildTransitionFilter(clips);
  assert.ok(result.filterComplex);
  assert.strictEqual(result.inputs, 4);
  assert.ok(result.filterComplex.length > 50, '滤镜复杂度应较高');
});

test('S7-TR-17: buildTransitionFilter — 默认 transition_type 兜底为 hard_cut', () => {
  const clips = [
    { duration: 3.0 }, // 无 transition_type
    { duration: 2.5, transition_type: 'unknown_type' }, // 未知类型
  ];
  const result = buildTransitionFilter(clips);
  assert.ok(result.filterComplex);
  assert.strictEqual(result.inputs, 2);
  // 未知类型应兜底为 hard_cut，不报错
});
