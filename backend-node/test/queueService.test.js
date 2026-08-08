const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const queueService = require('../src/services/queueService');

describe('queueService - 常量与配置', () => {
  it('QUEUE_NAME 定义正确', () => {
    assert.equal(queueService.QUEUE_NAME, 'screenwriter_queue');
  });

  it('VALID_JOB_TYPES 包含5个核心类型 + tts', () => {
    assert.ok(queueService.VALID_JOB_TYPES.includes('outline'));
    assert.ok(queueService.VALID_JOB_TYPES.includes('characters'));
    assert.ok(queueService.VALID_JOB_TYPES.includes('episodes'));
    assert.ok(queueService.VALID_JOB_TYPES.includes('storyboard'));
    assert.ok(queueService.VALID_JOB_TYPES.includes('dialogue'));
    assert.ok(queueService.VALID_JOB_TYPES.includes('tts'));
  });

  it('getQueueOpts 返回合理的默认值', () => {
    const opts = queueService.getQueueOpts();
    assert.ok(opts.attempts >= 1);
    assert.ok(opts.backoff);
    assert.ok(opts.backoff.delay >= 1000);
  });

  it('getConcurrency 返回正整数', () => {
    const c = queueService.getConcurrency();
    assert.ok(c >= 1);
  });
});

describe('queueService - 无效 jobType 验证', () => {
  it('createJob 对无效 jobType 抛出错误', async () => {
    await assert.rejects(
      () => queueService.createJob({ jobType: 'invalid_type', payload: {} }),
      /Invalid job_type/
    );
  });
});

describe('queueService - MemoryQueue 降级模式', () => {
  let MemoryQueue;

  before(() => {
    // 通过 require 获取内部 MemoryQueue 类
    // 由于 MemoryQueue 不直接导出，我们通过 closeQueue + 禁用配置来测试
    // 这里直接测试 queueService 的公开接口行为
  });

  it('closeQueue 后 isFallback 为 false（初始状态）', () => {
    // closeQueue 重置状态
    assert.equal(queueService.isFallback(), false);
    assert.equal(queueService.isRedisOk(), false);
  });
});

describe('queueService - closeQueue 清理', () => {
  it('closeQueue 不抛异常', async () => {
    await queueService.closeQueue();
    assert.equal(queueService.isFallback(), false);
    assert.equal(queueService.isRedisOk(), false);
  });
});

describe('queueService - onEvent 事件注册', () => {
  it('onEvent 是可导出的函数', () => {
    assert.equal(typeof queueService.onEvent, 'function');
  });

  it('closeQueue 是可导出的函数', () => {
    assert.equal(typeof queueService.closeQueue, 'function');
  });
});
