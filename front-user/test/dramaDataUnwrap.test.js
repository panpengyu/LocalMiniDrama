import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 从真实工具模块导入被测函数（不再复制逻辑到测试文件）
import { unwrapDramaResponse, estimateNodeCount } from '../src/utils/dramaData.js';

/* ---------------------------------------------------------------------- *
 *  模拟 @localmini/shared request.js 拦截器的返回值解包逻辑
 *
 * 真实链路：
 *   后端响应 body  →  axios response.data  →  拦截器 success 分支  →  返回给调用方
 *   {success:t, data:<dramaObj>}
 *                        │         res.data !== undefined  →  返回 res.data  (dramaObj 本身)
 *                        │         res.data === undefined  →  返回 res      (兜底)
 *                        └──────────────────────────────────────────────┘
 *
 * 调用方（WorkbenchCanvas.vue loadDrama）拿到的结果已经是"解包后的值"，
 * 不能再二次 .data，否则会把 valid drama 解包成 undefined → null （就是我们修复的 bug）。
 * ---------------------------------------------------------------------- */
function runResponseInterceptor(axiosResponse) {
  if (axiosResponse.config?.responseType === 'blob') {
    return axiosResponse.data;
  }
  const res = axiosResponse.data; // 即后端 body
  if (res.success !== false) {
    return res.data !== undefined ? res.data : res;
  }
  throw new Error(res.error?.message || '请求失败');
}

/** 修复前的 buggy 赋值逻辑（仅用于回归哨兵测试） */
function assignDramaValue_BUGGY(interceptorReturn) {
  return interceptorReturn?.data || null;
}

/* ---------------------------------------------------------------------- *
 *  mock 数据
 * ---------------------------------------------------------------------- */

const NORMAL_DRAMA_OBJ = {
  id: 42,
  title: '测试短剧：长夜将明',
  description: '一个 3 人、2 场景、3 镜头的正常项目',
  characters: [
    { id: 1, name: '林岚' },
    { id: 2, name: '陆沉' },
    { id: 3, name: '老周' },
  ],
  scenes: [
    { id: 10, name: '咖啡馆大厅' },
    { id: 11, name: '公寓阳台' },
  ],
  props: [
    { id: 100, name: '咖啡杯' },
  ],
  episodes: [
    {
      id: 1,
      index: 1,
      title: '第 1 集',
      storyboards: [
        { id: 1001, shotNo: '1-1' },
        { id: 1002, shotNo: '1-2' },
      ],
    },
    {
      id: 2,
      index: 2,
      title: '第 2 集',
      storyboards: [{ id: 2001, shotNo: '2-1' }],
    },
  ],
  metadata: {},
};

// 3 角色 + 2 场景 + 1 道具 + 3 分镜 = 9 个节点
const NORMAL_DRAMA_EXPECTED_NODES = 3 + 2 + 1 + 3;

const BACKEND_BODY_EMPTY_PROJECT = { success: true, data: null };
const BACKEND_BODY_NORMAL_PROJECT = { success: true, data: NORMAL_DRAMA_OBJ };

/* ============================================================ */
describe('[dramaData.js] unwrapDramaResponse', () => {

  it('正常项目: 返回完整 drama 对象（不再二次 .data 解包）', () => {
    const axiosResp = { config: {}, data: BACKEND_BODY_NORMAL_PROJECT };
    const unwrapped = runResponseInterceptor(axiosResp);

    const dramaValue = unwrapDramaResponse(unwrapped);
    assert.strictEqual(dramaValue, NORMAL_DRAMA_OBJ);
    assert.ok(dramaValue !== null);
    assert.strictEqual(dramaValue.id, 42);
    assert.strictEqual(dramaValue.characters.length, 3);
  });

  it('空项目(无drama): 返回 null', () => {
    const axiosResp = { config: {}, data: BACKEND_BODY_EMPTY_PROJECT };
    const unwrapped = runResponseInterceptor(axiosResp);

    assert.strictEqual(unwrapDramaResponse(unwrapped), null);
  });

  it('null / undefined 输入均安全返回 null', () => {
    assert.strictEqual(unwrapDramaResponse(null), null);
    assert.strictEqual(unwrapDramaResponse(undefined), null);
  });

  it('兜底分支: 后端 body 没 .data 字段时仍返回对象本身', () => {
    const bodyWithoutData = { success: true, id: 99, title: '直接返回' };
    const axiosResp = { config: {}, data: bodyWithoutData };
    const unwrapped = runResponseInterceptor(axiosResp);

    assert.strictEqual(unwrapDramaResponse(unwrapped), bodyWithoutData);
  });
});

/* ============================================================ */
describe('[dramaData.js] estimateNodeCount', () => {

  it('正常项目: 3角色+2场景+1道具+3分镜 = 9', () => {
    const dramaValue = unwrapDramaResponse(
      runResponseInterceptor({ config: {}, data: BACKEND_BODY_NORMAL_PROJECT }),
    );
    assert.strictEqual(estimateNodeCount(dramaValue), NORMAL_DRAMA_EXPECTED_NODES);
  });

  it('空项目(null): 返回 0，不抛异常，不返回 NaN', () => {
    let result;
    assert.doesNotThrow(() => { result = estimateNodeCount(null); });
    assert.strictEqual(result, 0);
    assert.ok(!Number.isNaN(result), '空项目节点数不能是 NaN');
  });

  it('undefined / 空对象: 返回 0', () => {
    assert.strictEqual(estimateNodeCount(undefined), 0);
    assert.strictEqual(estimateNodeCount({}), 0);
  });

  it('复杂项目: 10角色+8场景+15道具+50分镜 = 83（含缺失/null storyboards 兼容）', () => {
    const complexDrama = {
      id: 777,
      characters: Array.from({ length: 10 }, (_, i) => ({ id: i })),
      scenes: Array.from({ length: 8 }, (_, i) => ({ id: i })),
      props: Array.from({ length: 15 }, (_, i) => ({ id: i })),
      episodes: [
        { storyboards: Array.from({ length: 30 }, (_, i) => ({ id: i })) },
        { storyboards: Array.from({ length: 20 }, (_, i) => ({ id: i })) },
        { /* 没有 storyboards 字段 */ },
        { storyboards: null },
      ],
    };
    const expected = 10 + 8 + 15 + 30 + 20 + 0 + 0;
    assert.strictEqual(estimateNodeCount(complexDrama), expected);
  });

  /* ------ 边界测试：四个字段全为 null ------ */
  it('全 null: characters/scenes/props/episodes 均为 null → 返回 0，不返回 NaN', () => {
    const drama = { id: 1, characters: null, scenes: null, props: null, episodes: null };
    let result;
    assert.doesNotThrow(() => { result = estimateNodeCount(drama); });
    assert.strictEqual(result, 0);
    assert.ok(!Number.isNaN(result));
  });

  /* ------ 边界测试：四个字段全为空数组 ------ */
  it('全空数组: characters/scenes/props/episodes 均为 [] → 返回 0', () => {
    const drama = { id: 1, characters: [], scenes: [], props: [], episodes: [] };
    assert.strictEqual(estimateNodeCount(drama), 0);
  });

  /* ------ 边界测试：四个字段全为 undefined ------ */
  it('全 undefined: 四个字段均未定义 → 返回 0', () => {
    const drama = { id: 1 };
    assert.strictEqual(estimateNodeCount(drama), 0);
  });

  /* ------ 边界测试：逐字段 null，其余正常 ------ */
  it('characters=null 其余正常 → 只计场景+道具+分镜', () => {
    const drama = {
      characters: null,
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
      episodes: [{ storyboards: [{ id: 1 }] }],
    };
    assert.strictEqual(estimateNodeCount(drama), 0 + 1 + 1 + 1);
  });

  it('scenes=null 其余正常 → 只计角色+道具+分镜', () => {
    const drama = {
      characters: [{ id: 1 }],
      scenes: null,
      props: [{ id: 1 }],
      episodes: [{ storyboards: [{ id: 1 }] }],
    };
    assert.strictEqual(estimateNodeCount(drama), 1 + 0 + 1 + 1);
  });

  it('props=null 其余正常 → 只计角色+场景+分镜', () => {
    const drama = {
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: null,
      episodes: [{ storyboards: [{ id: 1 }] }],
    };
    assert.strictEqual(estimateNodeCount(drama), 1 + 1 + 0 + 1);
  });

  it('episodes=null 其余正常 → 只计角色+场景+道具', () => {
    const drama = {
      characters: [{ id: 1 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }],
      episodes: null,
    };
    assert.strictEqual(estimateNodeCount(drama), 1 + 1 + 1 + 0);
  });

  /* ------ 边界测试：分镜字段各种 null/undefined 变体 ------ */
  it('episodes 内 storyboards 为 null/undefined/缺失 → 均计 0', () => {
    const drama = {
      characters: [{ id: 1 }],
      scenes: [],
      props: [],
      episodes: [
        { storyboards: null },           // 0
        { storyboards: undefined },      // 0
        { /* 完全没有 storyboards */ },   // 0
        { storyboards: [] },             // 0
        { storyboards: [{ id: 1 }, { id: 2 }] }, // 2
      ],
    };
    assert.strictEqual(estimateNodeCount(drama), 1 + 0 + 0 + 2);
  });

  /* ------ 边界测试：混合 null 和空数组 ------ */
  it('混合: characters=[] scenes=null props=[] episodes=null → 返回 0', () => {
    const drama = { characters: [], scenes: null, props: [], episodes: null };
    assert.strictEqual(estimateNodeCount(drama), 0);
    assert.ok(!Number.isNaN(estimateNodeCount(drama)));
  });

  /* ------ 边界测试：episodes 本身为空数组但其他字段有值 ------ */
  it('episodes=[] 角色场景道具有值 → 不计分镜，只计资产', () => {
    const drama = {
      characters: [{ id: 1 }, { id: 2 }],
      scenes: [{ id: 1 }],
      props: [{ id: 1 }, { id: 2 }, { id: 3 }],
      episodes: [],
    };
    assert.strictEqual(estimateNodeCount(drama), 2 + 1 + 3 + 0);
  });

  /* ------ 边界测试：episode 对象本身为 null ------ */
  it('episodes 数组含 null 元素 → 跳过 null 元素不抛异常', () => {
    const drama = {
      characters: [],
      scenes: [],
      props: [],
      episodes: [null, { storyboards: [{ id: 1 }] }, undefined, { storyboards: [] }],
    };
    let result;
    assert.doesNotThrow(() => { result = estimateNodeCount(drama); });
    // null.reduce 会抛异常？不会 — reduce 跳过 null 但 null.storyboards 会 TypeError
    // 实际上 (null)?.storyboards?.length → undefined → || 0 → 0，所以安全
    assert.ok(!Number.isNaN(result));
  });

  /* ------ 边界测试：只有分镜，资产全空 ------ */
  it('只有分镜: 角色/场景/道具为 null，仅 episodes 有分镜 → 只计分镜数', () => {
    const drama = {
      characters: null,
      scenes: null,
      props: null,
      episodes: [
        { storyboards: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] },
        { storyboards: [{ id: 5 }] },
      ],
    };
    assert.strictEqual(estimateNodeCount(drama), 0 + 0 + 0 + 5);
  });
});

/* ============================================================ */
describe('[回归哨兵] 旧写法 res?.data || null 在正常项目下会丢数据', () => {

  it('旧写法产出 null，新写法(unwrapDramaResponse)产出完整对象 → 两者必须不同', () => {
    const unwrapped = runResponseInterceptor({
      config: {},
      data: BACKEND_BODY_NORMAL_PROJECT,
    });

    const buggyResult = assignDramaValue_BUGGY(unwrapped);
    const fixedResult = unwrapDramaResponse(unwrapped);

    assert.strictEqual(buggyResult, null, 'BUGGY: 二次 .data 导致正常项目变 null');
    assert.strictEqual(fixedResult, NORMAL_DRAMA_OBJ, 'FIXED: 拿到完整 drama');
    assert.notStrictEqual(buggyResult, fixedResult, '修复前后行为必须不同');
  });

  it('空项目下两种写法都得到 null → 修复不影响空分支', () => {
    for (const v of [null, undefined]) {
      assert.strictEqual(assignDramaValue_BUGGY(v), null);
      assert.strictEqual(unwrapDramaResponse(v), null);
    }
  });
});

/* ============================================================ *
 *  Sprint 9 摄像机控制模块安全检查
 *
 *  数据流：dramaAPI.get → unwrapDramaResponse → drama.value
 *         → rebuildGraph() → rawNodes → <DirectorStage3D :nodes="rawNodes" />
 *
 *  3D 摄像机模块（CameraController / DirectorStage3D / ViewSyncManager 等）
 *  通过 props 接收已构建的节点数组，不直接调用 dramaAPI.get。
 *  以下用例对源码做静态扫描，确保未来不会有人在这些模块中引入
 *  直接的 drama API 调用或 .data 二次解包，从架构上防止同类 bug。
 * ============================================================ */
describe('[Sprint 9] 摄像机控制模块不直接依赖 drama 数据加载', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const director3dDir = path.resolve(__dirname, '../src/components/director3d');

  // 需要检查的 Sprint 9 3D 模块源文件
  const files = [
    'CameraController.js',
    'DirectorStage3D.vue',
    'ViewSyncManager.js',
    'LODManager.js',
    'Node3DFactory.js',
  ];

  for (const file of files) {
    it(`${file} 不直接调用 dramaAPI（通过 props 接收数据）`, () => {
      const fullPath = path.join(director3dDir, file);
      const src = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        !src.includes('dramaAPI'),
        `${file} 不应直接导入或调用 dramaAPI — 3D 模块应通过 props 接收已构建的节点`,
      );
    });

    it(`${file} 不包含 .data || null 二次解包模式`, () => {
      const fullPath = path.join(director3dDir, file);
      const src = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(
        !src.includes('?.data') || src.includes('response.data'),
        `${file} 不应对已解包的对象使用 ?.data 二次访问`,
      );
    });
  }

  it('DirectorStage3D.vue 通过 props.nodes 接收节点数据（不自己加载 drama）', () => {
    const src = fs.readFileSync(
      path.join(director3dDir, 'DirectorStage3D.vue'),
      'utf-8',
    );
    assert.ok(
      src.includes("nodes: { type: Array"),
      'DirectorStage3D 应声明 nodes prop 接收节点列表',
    );
  });
});
