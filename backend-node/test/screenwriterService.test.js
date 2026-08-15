const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getDb, closeDb } = require('../src/db');
const { loadConfig } = require('../src/config');

// ---- mock aiClient ----
const aiClient = require('../src/services/aiClient');
const origGenerateText = aiClient.generateText;

function mockAi(responseText) {
  aiClient.generateText = async () => responseText;
}
function restoreAi() {
  aiClient.generateText = origGenerateText;
}

const swService = require('../src/services/screenwriterService');

// ---- 使用真实 MySQL 数据库（清理本测试的高位/唯一标记数据） ----
function createTestDb() {
  const db = getDb(loadConfig().database);
  db.prepare('DELETE FROM sw_chat_messages').run();
  db.prepare('DELETE FROM sw_chat_sessions').run();
  db.prepare('DELETE FROM sw_dialogues').run();
  db.prepare('DELETE FROM sw_storyboards').run();
  db.prepare('DELETE FROM sw_scenes').run();
  db.prepare('DELETE FROM sw_episodes').run();
  db.prepare('DELETE FROM sw_characters').run();
  db.prepare('DELETE FROM sw_outlines').run();
  db.prepare("DELETE FROM sw_jobs WHERE job_id LIKE 'job_test_%'").run();
  db.prepare("DELETE FROM drama_templates WHERE template_id = 'tpl_test'").run();
  db.prepare("DELETE FROM sw_genres WHERE genre_key = 'urban_romance'").run();
  db.prepare("DELETE FROM sw_styles WHERE style_key = 'sweet'").run();
  db.prepare("DELETE FROM sw_shot_types WHERE shot_key = 'medium'").run();
  db.prepare("DELETE FROM sw_dialogue_emotions WHERE emotion_key = 'happy'").run();
  return db;
}

function seedDictData(db) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO drama_templates (template_id, category, key, name, description, prompt_system, prompt_example, output_schema, parameters_json, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tpl_test', 'structure', 'three_act', '测试模板', '测试用', 'test prompt', 'test example', '{}', '{}', 1, 1, now, now);
  db.prepare('INSERT INTO sw_genres (genre_key, label_zh, description, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('urban_romance', '都市爱情', '测试', 1, 1, now);
  db.prepare('INSERT INTO sw_styles (style_key, label_zh, description, tone, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('sweet', '甜宠', '测试', '甜蜜', 1, 1, now);
  db.prepare('INSERT INTO sw_shot_types (shot_key, label_zh, description, purpose, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('medium', '中景', '测试', '对话', 1, 1, now);
  db.prepare('INSERT INTO sw_dialogue_emotions (emotion_key, label_zh, category, description, sort_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('happy', '开心', 'positive', '测试', 1, 1, now);
}

// ============ 测试开始 ============

describe('screenwriterService - 工具函数', () => {
  it('uid() 生成带前缀的唯一ID', () => {
    const id1 = swService.uid('test');
    const id2 = swService.uid('test');
    assert.ok(id1.startsWith('test_'));
    assert.ok(id2.startsWith('test_'));
    assert.notEqual(id1, id2);
  });

  it('nowStr() 返回 YYYY-MM-DD HH:MM:SS 格式', () => {
    const s = swService.nowStr();
    assert.match(s, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('screenwriterService - S1-T03 generateOutline', () => {
  let db;
  before(() => { db = createTestDb(); });
  after(() => { closeDb(); restoreAi(); });

  it('idea 为空时抛出错误', async () => {
    await assert.rejects(() => swService.generateOutline(db, null, { idea: '' }), /不能为空/);
  });

  it('正常生成大纲并落库', async () => {
    mockAi(JSON.stringify({
      title: '测试剧本',
      logline: '一个测试故事',
      themes: ['成长', '爱情'],
      acts: [
        { act_number: 1, title: '建置', summary: '主角登场', key_events: ['事件A', '事件B'] },
        { act_number: 2, title: '对抗', summary: '冲突升级', key_events: ['事件C'] },
        { act_number: 3, title: '结局', summary: '高潮收尾', key_events: ['事件D'] },
      ],
    }));

    const result = await swService.generateOutline(db, null, {
      idea: '一个测试创意',
      title: '测试剧本',
      genre: 'urban_romance',
      style: 'sweet',
      episodeCount: 8,
    });

    assert.ok(result.outlineId);
    assert.equal(result.title, '测试剧本');
    assert.equal(result.episodeCount, 8);

    // 验证落库
    const row = db.prepare('SELECT * FROM sw_outlines WHERE outline_id = ?').get(result.outlineId);
    assert.ok(row);
    assert.equal(row.title, '测试剧本');
    assert.equal(row.status, 'completed');
  });

  it('AI 返回非 JSON 时走兜底逻辑', async () => {
    mockAi('这不是JSON');
    const result = await swService.generateOutline(db, null, {
      idea: '另一个创意',
      title: '兜底剧本',
    });
    assert.ok(result.outlineId);
    assert.equal(result.title, '兜底剧本');
    assert.ok(result.acts.length >= 3);
  });
});

describe('screenwriterService - S1-T04 generateCharacters', () => {
  let db, outlineId;

  before(async () => {
    db = createTestDb();
    mockAi(JSON.stringify({
      title: '角色测试剧', logline: '测试', themes: ['成长'],
      acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }],
    }));
    const r = await swService.generateOutline(db, null, { idea: '测试角色生成' });
    outlineId = r.outlineId;
  });
  after(() => { closeDb(); restoreAi(); });

  it('缺少 outlineId 时抛出错误', async () => {
    await assert.rejects(() => swService.generateCharacters(db, null, {}), /缺少outlineId/);
  });

  it('正常生成角色并落库', async () => {
    mockAi(JSON.stringify({
      characters: [
        { name: '张三', role: 'protagonist', age: 25, gender: 'male', personality: '勇敢', appearance: '高大', background: '贫民', motivation: '复仇', arc: '成长', appearance_prompt: 'man', voice_profile: { tone: '低沉' }, tags: ['主角'] },
        { name: '李四', role: 'antagonist', age: 30, gender: 'female', personality: '狡猾', appearance: '美丽', background: '豪门', motivation: '权力', arc: '堕落', appearance_prompt: 'woman', voice_profile: { tone: '尖细' }, tags: ['反派'] },
      ],
    }));

    const result = await swService.generateCharacters(db, null, { outlineId, count: 2 });
    assert.equal(result.count, 2);
    assert.equal(result.characters[0].name, '张三');
    assert.equal(result.characters[1].name, '李四');

    // 验证落库
    const rows = db.prepare('SELECT * FROM sw_characters WHERE outline_id = ?').all(outlineId);
    assert.equal(rows.length, 2);
  });

  it('AI 返回空数组时走兜底生成至少2个角色', async () => {
    mockAi('null');
    const result = await swService.generateCharacters(db, null, { outlineId });
    assert.ok(result.count >= 2);
  });
});

describe('screenwriterService - S1-T05 generateEpisodes', () => {
  let db, outlineId;

  before(async () => {
    db = createTestDb();
    mockAi(JSON.stringify({
      title: '分集测试', logline: '测试', themes: ['成长'],
      acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }],
    }));
    const r = await swService.generateOutline(db, null, { idea: '测试分集' });
    outlineId = r.outlineId;
  });
  after(() => { closeDb(); restoreAi(); });

  it('缺少 outlineId 时抛出错误', async () => {
    await assert.rejects(() => swService.generateEpisodes(db, null, {}), /缺少outlineId/);
  });

  it('正常生成分集并落库', async () => {
    mockAi(JSON.stringify({
      episodes: [
        { episodeNumber: 1, title: '第一集', summary: '开篇', cliffhanger: '悬念1', scenes: [{ sceneNumber: 1, title: '场景1', description: '描述', location: '室内', timeOfDay: 'day', characters: ['张三'], mood: 'tense' }] },
        { episodeNumber: 2, title: '第二集', summary: '发展', cliffhanger: '悬念2', scenes: [{ sceneNumber: 1, title: '场景1', description: '描述', location: '室外', timeOfDay: 'night', characters: ['李四'], mood: 'calm' }] },
      ],
    }));

    const result = await swService.generateEpisodes(db, null, { outlineId });
    assert.equal(result.episodeCount, 2);
    assert.ok(result.episodes.length >= 2);

    // 验证分集落库
    const eps = db.prepare('SELECT * FROM sw_episodes WHERE outline_id = ?').all(outlineId);
    assert.equal(eps.length, 2);
    // 验证场景落库
    const scenes = db.prepare('SELECT * FROM sw_scenes WHERE outline_id = ?').all(outlineId);
    assert.equal(scenes.length, 2);
  });

  it('AI 返回非 JSON 时走兜底', async () => {
    mockAi('error');
    const result = await swService.generateEpisodes(db, null, { outlineId, episodeCount: 3 });
    assert.ok(result.episodes.length >= 1);
  });
});

describe('screenwriterService - S1-T06 generateStoryboard', () => {
  let db, episodeId;

  before(async () => {
    db = createTestDb();
    // 先创建大纲
    mockAi(JSON.stringify({ title: '分镜测试', logline: '测试', themes: [], acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }] }));
    const outline = await swService.generateOutline(db, null, { idea: '测试分镜' });
    // 再创建分集
    mockAi(JSON.stringify({
      episodes: [{ episodeNumber: 1, title: '第一集', summary: '测试', cliffhanger: '悬念', scenes: [{ sceneNumber: 1, title: '场景1', description: '描述', location: '室内', timeOfDay: 'day', characters: [], mood: 'tense' }] }],
    }));
    const eps = await swService.generateEpisodes(db, null, { outlineId: outline.outlineId });
    episodeId = eps.episodes[0].episodeId;
  });
  after(() => { closeDb(); restoreAi(); });

  it('缺少 episodeId 时抛出错误', async () => {
    await assert.rejects(() => swService.generateStoryboard(db, null, {}), /缺少episodeId/);
  });

  it('正常生成分镜并落库', async () => {
    mockAi(JSON.stringify({
      frames: [
        { frame_number: 1, shot_type: 'wide', emotion: 'tense', prompt: 'test prompt', visual_description: '描述1', characters: [], camera_movement: 'static', composition: 'center', duration: '3秒', transition: 'cut' },
        { frame_number: 2, shot_type: 'close', emotion: 'happy', prompt: 'test prompt2', visual_description: '描述2', characters: [], camera_movement: 'pan', composition: 'left', duration: '2秒', transition: 'fade' },
      ],
    }));

    const result = await swService.generateStoryboard(db, null, { episodeId });
    assert.equal(result.count, 2);
    const rows = db.prepare('SELECT * FROM sw_storyboards WHERE episode_id = ?').all(episodeId);
    assert.equal(rows.length, 2);
  });

  it('AI 返回非 JSON 时走兜底', async () => {
    mockAi('error');
    const result = await swService.generateStoryboard(db, null, { episodeId });
    assert.ok(result.count >= 1);
  });
});

describe('screenwriterService - S1-T07 generateDialogue', () => {
  let db, episodeId;

  before(async () => {
    db = createTestDb();
    mockAi(JSON.stringify({ title: '台词测试', logline: '测试', themes: [], acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }] }));
    const outline = await swService.generateOutline(db, null, { idea: '测试台词' });
    mockAi(JSON.stringify({
      episodes: [{ episodeNumber: 1, title: '第一集', summary: '测试', cliffhanger: '悬念', scenes: [{ sceneNumber: 1, title: '场景1', description: '描述', location: '室内', timeOfDay: 'day', characters: [], mood: 'tense' }] }],
    }));
    const eps = await swService.generateEpisodes(db, null, { outlineId: outline.outlineId });
    episodeId = eps.episodes[0].episodeId;
    // 先生成分镜（台词生成依赖分镜）
    mockAi(JSON.stringify({
      frames: [{ frame_number: 1, shot_type: 'medium', emotion: 'neutral', prompt: 'test', visual_description: '描述', characters: [] }],
    }));
    await swService.generateStoryboard(db, null, { episodeId });
  });
  after(() => { closeDb(); restoreAi(); });

  it('缺少 episodeId 时抛出错误', async () => {
    await assert.rejects(() => swService.generateDialogue(db, null, {}), /缺少episodeId/);
  });

  it('正常生成台词并落库', async () => {
    mockAi(JSON.stringify({
      lines: [
        { frame_number: 1, character_name: '旁白', line_text: '夜深了。', emotion: 'sad', action_description: '描述', duration_estimate: '3秒' },
        { frame_number: 1, character_name: '张三', line_text: '你好。', emotion: 'happy', action_description: '挥手', duration_estimate: '2秒' },
      ],
    }));

    const result = await swService.generateDialogue(db, null, { episodeId });
    assert.equal(result.count, 2);
    const rows = db.prepare('SELECT * FROM sw_dialogues WHERE episode_id = ?').all(episodeId);
    assert.equal(rows.length, 2);
  });

  it('AI 返回非 JSON 时走兜底', async () => {
    mockAi('error');
    const result = await swService.generateDialogue(db, null, { episodeId });
    assert.ok(result.count >= 1);
  });
});

describe('screenwriterService - CRUD 查询', () => {
  let db, outlineId;

  before(async () => {
    db = createTestDb();
    seedDictData(db);
    mockAi(JSON.stringify({ title: 'CRUD测试', logline: '测试', themes: ['成长'], acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }] }));
    const r = await swService.generateOutline(db, null, { idea: '测试CRUD', userId: 990100 });
    outlineId = r.outlineId;
  });
  after(() => { closeDb(); restoreAi(); });

  it('listOutlines 返回大纲列表', () => {
    const items = swService.listOutlines(db, { userId: 990100 });
    assert.ok(items.length >= 1);
    assert.equal(items[0].title, 'CRUD测试');
  });

  it('getOutline 返回大纲详情', async () => {
    const o = await swService.getOutline(db, outlineId);
    assert.ok(o);
    assert.equal(o.outlineId, outlineId);
    assert.ok(o.acts);
  });

  it('getOutline 不存在的ID返回null', async () => {
    const o = await swService.getOutline(db, 'nonexistent');
    assert.equal(o, null);
  });

  it('listTemplates 返回模板列表', () => {
    const items = swService.listTemplates(db);
    assert.ok(items.length >= 1);
    assert.ok(items.some((t) => t.templateId === 'tpl_test'), '应包含测试模板');
  });

  it('listTemplates 按category过滤', () => {
    const items = swService.listTemplates(db, 'structure');
    assert.ok(items.length >= 1);
    assert.ok(items.some((t) => t.templateId === 'tpl_test'));
    const empty = swService.listTemplates(db, 'nonexistent');
    assert.equal(empty.length, 0);
  });

  it('listGenres 返回题材字典', () => {
    const items = swService.listGenres(db);
    assert.ok(items.length >= 1);
    assert.ok(items.some((g) => g.key === 'urban_romance'), '应包含测试题材');
  });

  it('listStyles 返回风格字典', () => {
    const items = swService.listStyles(db);
    assert.ok(items.length >= 1);
    assert.ok(items.some((s) => s.key === 'sweet'), '应包含测试风格');
  });

  it('listShotTypes 返回镜头类型字典', () => {
    const items = swService.listShotTypes(db);
    assert.ok(items.length >= 1);
  });

  it('listEmotions 返回情绪字典', () => {
    const items = swService.listEmotions(db);
    assert.ok(items.length >= 1);
  });
});

describe('screenwriterService - S1-T02 多轮对话', () => {
  let db;

  before(() => { db = createTestDb(); });
  after(() => { closeDb(); restoreAi(); });

  it('message 为空时抛出错误', async () => {
    await assert.rejects(() => swService.chatWithScreenwriter(db, null, { message: '' }), /不能为空/);
  });

  it('首次对话创建 session 并存储消息', async () => {
    mockAi('这是AI的回复');
    const result = await swService.chatWithScreenwriter(db, null, {
      message: '帮我设计一个霸总角色',
      userId: 990001,
    });

    assert.ok(result.sessionId);
    assert.equal(result.reply, '这是AI的回复');
    assert.ok(result.messageOrder >= 2);

    // 验证 session 落库
    const sess = db.prepare('SELECT * FROM sw_chat_sessions WHERE session_id = ?').get(result.sessionId);
    assert.ok(sess);
    assert.equal(sess.messages_count, 2);

    // 验证消息落库
    const msgs = db.prepare('SELECT * FROM sw_chat_messages WHERE session_id = ? ORDER BY message_order').all(result.sessionId);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[1].role, 'assistant');
  });

  it('同一 sessionId 第二轮对话保留历史', async () => {
    mockAi('第二轮回复');
    const first = await swService.chatWithScreenwriter(db, null, { message: '第一轮', userId: 990001 });
    const second = await swService.chatWithScreenwriter(db, null, {
      sessionId: first.sessionId,
      message: '第二轮',
    });

    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.reply, '第二轮回复');

    // 应该有4条消息（2轮 × 2条）
    const msgs = db.prepare('SELECT * FROM sw_chat_messages WHERE session_id = ?').all(first.sessionId);
    assert.equal(msgs.length, 4);
  });

  it('getChatHistory 返回对话历史', async () => {
    mockAi('历史测试回复');
    const r = await swService.chatWithScreenwriter(db, null, { message: '测试历史' });
    const history = swService.getChatHistory(db, r.sessionId);
    assert.ok(history.length >= 2);
    assert.equal(history[0].role, 'user');
  });

  it('listChatSessions 返回会话列表', async () => {
    mockAi('会话列表测试');
    await swService.chatWithScreenwriter(db, null, { message: '测试', userId: 990200 });
    const sessions = swService.listChatSessions(db, { userId: 990200 });
    assert.ok(sessions.length >= 1);
    assert.equal(sessions[0].userId, 990200);
  });

  it('关联 outlineId 时上下文注入', async () => {
    // 先创建大纲
    mockAi(JSON.stringify({ title: '对话上下文', logline: '测试', themes: [], acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }] }));
    const outline = await swService.generateOutline(db, null, { idea: '测试对话上下文' });

    mockAi('基于大纲的回复');
    const result = await swService.chatWithScreenwriter(db, null, {
      message: '修改第一幕',
      outlineId: outline.outlineId,
    });

    assert.ok(result.reply);
    // 验证 session 关联了 outlineId
    const sess = db.prepare('SELECT * FROM sw_chat_sessions WHERE session_id = ?').get(result.sessionId);
    assert.equal(sess.outline_id, outline.outlineId);
  });
});

describe('screenwriterService - sw_jobs 双写', () => {
  let db;
  before(() => { db = createTestDb(); });
  after(() => { closeDb(); });

  it('createJobRecord 创建任务记录', () => {
    swService.createJobRecord(db, { jobId: 'job_test_1', jobType: 's1t07_outline', status: 'pending', payload: { test: 1 } });
    const row = db.prepare('SELECT * FROM sw_jobs WHERE job_id = ?').get('job_test_1');
    assert.ok(row);
    assert.equal(row.status, 'pending');
    assert.equal(row.job_type, 's1t07_outline');
  });

  it('updateJobRecord 更新任务状态', () => {
    swService.updateJobRecord(db, 'job_test_1', { status: 'completed', progress: 100, result: { ok: true } });
    const row = db.prepare('SELECT * FROM sw_jobs WHERE job_id = ?').get('job_test_1');
    assert.equal(row.status, 'completed');
    assert.equal(row.progress, 100);
  });

  it('getJobRecord 返回任务记录', () => {
    const job = swService.getJobRecord(db, 'job_test_1');
    assert.ok(job);
    assert.equal(job.jobId, 'job_test_1');
  });

  it('getJobRecord 不存在的ID返回null', () => {
    const job = swService.getJobRecord(db, 'nonexistent');
    assert.equal(job, null);
  });

  it('listJobs 返回任务列表', () => {
    swService.createJobRecord(db, { jobId: 'job_test_2', jobType: 's1t07_characters', status: 'pending' });
    const list = swService.listJobs(db, { limit: 10 });
    assert.ok(list.length >= 2);
  });

  it('listJobs 按 jobType 过滤', () => {
    const list = swService.listJobs(db, { jobType: 's1t07_outline', limit: 10 });
    assert.equal(list.length, 1);
    assert.equal(list[0].jobType, 's1t07_outline');
  });
});

describe('screenwriterService - 查询辅助函数', () => {
  let db, outlineId, episodeId;

  before(async () => {
    db = createTestDb();
    // 创建完整数据链
    mockAi(JSON.stringify({ title: '查询测试', logline: '测试', themes: ['成长'], acts: [{ act_number: 1, title: '第一幕', summary: '测试', key_events: ['事件'] }] }));
    const outline = await swService.generateOutline(db, null, { idea: '测试查询' });
    outlineId = outline.outlineId;

    mockAi(JSON.stringify({
      characters: [{ name: '查询角色', role: 'protagonist', age: 25, gender: 'male', personality: '勇敢' }],
    }));
    await swService.generateCharacters(db, null, { outlineId });

    mockAi(JSON.stringify({
      episodes: [{ episodeNumber: 1, title: '查询集', summary: '测试', cliffhanger: '悬念', scenes: [{ sceneNumber: 1, title: '场景', description: '描述', location: '室内', timeOfDay: 'day', characters: [], mood: 'tense' }] }],
    }));
    const eps = await swService.generateEpisodes(db, null, { outlineId });
    episodeId = eps.episodes[0].episodeId;

    mockAi(JSON.stringify({
      frames: [{ frame_number: 1, shot_type: 'medium', emotion: 'happy', prompt: 'test', visual_description: '描述', characters: [] }],
    }));
    await swService.generateStoryboard(db, null, { episodeId });

    mockAi(JSON.stringify({
      lines: [{ frame_number: 1, character_name: '查询角色', line_text: '测试台词', emotion: 'happy', action_description: '动作' }],
    }));
    await swService.generateDialogue(db, null, { episodeId });
  });
  after(() => { closeDb(); restoreAi(); });

  it('listCharacters 返回角色列表', async () => {
    const chars = await swService.listCharacters(db, outlineId);
    assert.ok(chars.length >= 1);
    assert.equal(chars[0].name, '查询角色');
  });

  it('listEpisodes 返回分集列表', () => {
    const eps = swService.listEpisodes(db, outlineId);
    assert.ok(eps.length >= 1);
    assert.equal(eps[0].title, '查询集');
  });

  it('getEpisode 返回分集详情', async () => {
    const ep = await swService.getEpisode(db, episodeId);
    assert.ok(ep);
    assert.equal(ep.episodeId, episodeId);
  });

  it('getEpisode 不存在返回null', async () => {
    const ep = await swService.getEpisode(db, 'nonexistent');
    assert.equal(ep, null);
  });

  it('listFrames 返回分镜列表', async () => {
    const frames = await swService.listFrames(db, episodeId);
    assert.ok(frames.length >= 1);
    assert.equal(frames[0].shotType, 'medium');
  });

  it('listDialogues 返回台词列表', async () => {
    const dias = await swService.listDialogues(db, episodeId);
    assert.ok(dias.length >= 1);
    assert.equal(dias[0].lineText, '测试台词');
  });
});
