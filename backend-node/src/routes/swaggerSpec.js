// ---------------------------------------------------------------
// Sprint 1: AI编剧助手模块 OpenAPI 3.0 规范
// 访问端点: GET /api/v1/docs → Swagger UI
// ---------------------------------------------------------------
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'LocalMiniDrama — AI编剧助手 API (Sprint 1)',
    version: '1.0.0',
    description: '高端智能漫剧创作平台：AI编剧助手后端接口（Sprint 1 交付物）。支持大纲/角色/分集/分镜/台词的同步与异步生成，多轮对话式编剧，任务进度查询/取消。数据全部落库 MySQL。',
    contact: { name: 'LocalMiniDrama Team' },
  },
  servers: [{ url: '/api/v1', description: 'API v1 base' }],
  tags: [
    { name: '字典/模板', description: '剧本结构模板、题材、风格、镜头类型、情绪字典' },
    { name: 'AI生成-同步', description: '等待 AI 返回后一次性响应（适合短平快）' },
    { name: 'AI生成-异步', description: '进入 Bull 队列，通过 /jobs/:id 轮询进度（推荐长文本）' },
    { name: '查询', description: '大纲/角色/分集/分镜/台词 CRUD 查询' },
    { name: '多轮对话', description: 'S1-T02 多轮对话式编剧：会话 + 消息历史' },
    { name: '任务队列', description: 'Bull 任务：查询 / 列表 / 取消' },
  ],
  paths: {

    // ================= 字典/模板 =================
    '/ai/screenwriter/templates': {
      get: {
        tags: ['字典/模板'],
        summary: '剧本结构模板列表（drama_templates）',
        description: 'S1-T08 交付：三幕式、英雄之旅、起承转合等剧本结构模板。数据存在 MySQL drama_templates 表。',
        parameters: [{ name: 'category', in: 'query', schema: { type: 'string', example: 'structure' }, required: false, description: '按类别过滤，如 structure' }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/genres': {
      get: { tags: ['字典/模板'], summary: '题材字典', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/styles': {
      get: { tags: ['字典/模板'], summary: '风格字典', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/shot-types': {
      get: { tags: ['字典/模板'], summary: '镜头类型字典', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/emotions': {
      get: { tags: ['字典/模板'], summary: '台词情绪字典', responses: { 200: { description: 'OK' } } },
    },

    // ================= 生成（同步） =================
    '/ai/screenwriter/outline/sync': {
      post: {
        tags: ['AI生成-同步'],
        summary: 'S1-T03 同步生成剧本大纲',
        description: '输入一句话创意，实时返回三幕式/英雄之旅/起承转合结构大纲。数据落库 MySQL sw_outlines。',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/OutlineGenerateRequest' },
            example: { idea: '寒门学子意外救下落难富家千金，门第差距被迫分离，历经千帆最终牵手', title: '寒门暖婚', genre: 'urban_romance', style: 'sweet', structure: 'three_act', episodeCount: 8 },
          } },
        },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { mode: 'sync', jobId: 'swjob_xxx', result: { outlineId: 'outline_xxx', title: '寒门暖婚', logline: '...', themes: [], acts: [] } } } } } },
      },
    },
    '/ai/screenwriter/characters/sync': {
      post: {
        tags: ['AI生成-同步'],
        summary: 'S1-T04 同步生成角色档案（主角/配角/反派）',
        requestBody: { required: true, content: { 'application/json': { example: { outlineId: 'outline_xxx', count: 5 } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/episodes/sync': {
      post: {
        tags: ['AI生成-同步'],
        summary: 'S1-T05 同步拆分分集剧情（每集3-5分钟）',
        requestBody: { required: true, content: { 'application/json': { example: { outlineId: 'outline_xxx', episodeCount: 10 } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/storyboard/sync': {
      post: {
        tags: ['AI生成-同步'],
        summary: 'S1-T06 同步生成分镜脚本（含镜头语言）',
        requestBody: { required: true, content: { 'application/json': { example: { episodeId: 'ep_xxx' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/dialogue/sync': {
      post: {
        tags: ['AI生成-同步'],
        summary: 'S1-T07 同步生成对话台词（角色+场景匹配）',
        requestBody: { required: true, content: { 'application/json': { example: { episodeId: 'ep_xxx' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= 生成（异步 Bull 队列） =================
    '/ai/screenwriter/outline': {
      post: {
        tags: ['AI生成-异步'],
        summary: 'S1-T09 异步生成大纲 → 进入 Bull 队列（Redis），通过 /jobs/:id 轮询进度',
        requestBody: { required: true, content: { 'application/json': { example: { idea: '女医生穿越古代成为冷宫弃妃', title: '医妃倾天下', genre: 'historical_fantasy', style: 'revenge', episodeCount: 10 } } } },
        responses: { 200: { description: '已入队', content: { 'application/json': { example: { mode: 'async', jobId: 'swjob_xxx', bullJobId: 'swjob_xxx', jobType: 'outline' } } } } },
      },
    },
    '/ai/screenwriter/characters': { post: { tags: ['AI生成-异步'], summary: '异步生成角色档案', responses: { 200: { description: 'OK' } } } },
    '/ai/screenwriter/episodes':   { post: { tags: ['AI生成-异步'], summary: '异步拆分分集剧情', responses: { 200: { description: 'OK' } } } },
    '/ai/screenwriter/storyboard': { post: { tags: ['AI生成-异步'], summary: '异步生成分镜脚本', responses: { 200: { description: 'OK' } } } },
    '/ai/screenwriter/dialogue':   { post: { tags: ['AI生成-异步'], summary: '异步生成台词对白', responses: { 200: { description: 'OK' } } } },

    // ================= 修改 / 重生成 =================
    '/ai/screenwriter/outlines/{outlineId}': {
      patch: {
        tags: ['修改/重生成'],
        summary: '修改大纲（逐段修改，保留未变更字段）',
        description: 'Sprint 1 增量功能：支持创作者对AI生成内容的逐段修改（平台文档 3.1 节技术要点）',
        parameters: [{ name: 'outlineId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { example: { title: '新标题', logline: '新一句话梗概', structure: 'heros_journey', themeAdd: ['新主题'], removeActNumber: 0 } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/episodes/{episodeId}/regenerate': {
      post: {
        tags: ['修改/重生成'],
        summary: '重新生成单集剧情（不影响其他集）',
        description: 'Sprint 1 增量功能：支持修改某一集而不重写整个分集',
        parameters: [{ name: 'episodeId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { 'application/json': { example: { promptAppend: '增加一场雨中对峙戏，强化女主身份暴露悬念' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/scene-description': {
      post: {
        tags: ['修改/重生成'],
        summary: '场景描述生成（含美术风格建议）',
        description: '平台文档 3.1 节方案图第 6 步：根据场景 location/time/characters 生成美术风格建议',
        requestBody: { required: true, content: { 'application/json': { example: { outlineId: 'outline_xxx', episodeId: 'ep_xxx', sceneId: 'sc_xxx', location: '中式古宅庭院', timeOfDay: '黄昏', characters: ['林深', '苏暖'], style: 'sweet' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= Sprint 2 增量：逐段修改 / 重生成 =================
    '/ai/screenwriter/characters/{characterId}': {
      patch: {
        tags: ['修改/重生成'],
        summary: '保存角色编辑结果（S2-T03）',
        description: '用户在角色档案卡片修改姓名/角色定位/外貌/性格/背景后持久化',
        parameters: [{ name: 'characterId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { name: '苏暖', role: 'protagonist', appearance: '长直发、白衬衫', personality: '倔强善良', background: '普通家庭，有个弟弟' } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/characters/{characterId}/regenerate': {
      post: {
        tags: ['修改/重生成'],
        summary: '单角色 AI 重写（S2-T03）',
        description: 'Sprint 2 逐段修改和重新生成：保留角色定位（主角/反派）不变，AI 重新丰富外貌/性格/背景细节',
        parameters: [{ name: 'characterId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: false, content: { 'application/json': { example: { prompt_append: '强化女主外表冷静但内心柔软的反差' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/screenwriter/outlines/{outlineId}/regenerate-act': {
      post: {
        tags: ['修改/重生成'],
        summary: '大纲单幕重写（S2-T01）',
        description: 'Sprint 2 逐段修改：三幕式/起承转合中某一幕的 AI 重写，保持其他幕不变',
        parameters: [{ name: 'outlineId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { act_index: 1, prompt_append: '在这一幕加入关键证据的伏笔' } } },
        },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= Sprint 2: 一键创建项目 =================
    '/ai/screenwriter/create-project': {
      post: {
        tags: ['AI生成-同步'],
        summary: '一键创建项目（S2-T04）',
        description: '将 AI 编剧生成的大纲/角色/分集/场景/分镜一键映射为正式项目（dramas + characters + episodes + scenes + storyboards）',
        requestBody: {
          required: true,
          content: { 'application/json': { example: { outline_id: 'outline_xxx', name: '我的短剧' } } },
        },
        responses: {
          200: {
            description: '创建成功',
            content: { 'application/json': { example: { projectId: 1, dramaId: 1, title: '我的短剧', characterCount: 5, episodeCount: 8, sceneCount: 12, storyboardCount: 40 } } },
          },
        },
      },
    },

    // ================= 查询 =================
    '/ai/screenwriter/outlines': {
      get: { tags: ['查询'], summary: '大纲列表', parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }], responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/outlines/{outlineId}': {
      get: { tags: ['查询'], summary: '大纲详情（含三幕式结构）', parameters: [{ name: 'outlineId', in: 'path', required: true }], responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/outlines/{outlineId}/characters': {
      get: { tags: ['查询'], summary: '角色列表（属于某大纲）', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/outlines/{outlineId}/episodes': {
      get: { tags: ['查询'], summary: '分集列表', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/episodes/{episodeId}': {
      get: { tags: ['查询'], summary: '分集详情（含悬念、场景）', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/episodes/{episodeId}/frames': {
      get: { tags: ['查询'], summary: '分镜列表（含镜头语言）', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/episodes/{episodeId}/dialogues': {
      get: { tags: ['查询'], summary: '台词列表', responses: { 200: { description: 'OK' } } },
    },

    // ================= 多轮对话 =================
    '/ai/screenwriter/chat': {
      post: {
        tags: ['多轮对话'],
        summary: '发送消息（多轮对话式编剧）',
        description: 'S1-T02 交付：自动关联大纲/角色上下文，保留最近 20 轮历史，自动创建新 session 或续接现有',
        requestBody: { required: true, content: { 'application/json': { example: { message: '帮我把第一幕改成英雄之旅12阶段版本，强化女主穿越后的身份悬念', sessionId: 'swchat_xxx', outlineId: 'outline_xxx', contextType: 'outline' } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { sessionId: 'swchat_xxx', reply: '好的，调整如下...', messageOrder: 4 } } } } },
      },
      get: { tags: ['多轮对话'], summary: '会话列表', responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/chat/{sessionId}': {
      get: { tags: ['多轮对话'], summary: '对话历史（最近 N 条）', parameters: [{ name: 'limit', in: 'query', schema: { default: 50 } }], responses: { 200: { description: 'OK' } } },
    },

    // ================= 任务队列 =================
    '/ai/screenwriter/jobs': {
      get: { tags: ['任务队列'], summary: '任务列表（最近 N 条）', parameters: [{ name: 'jobType', in: 'query' }, { name: 'limit', in: 'query', schema: { default: 20 } }], responses: { 200: { description: 'OK' } } },
    },
    '/ai/screenwriter/jobs/{jobId}': {
      get: {
        tags: ['任务队列'],
        summary: '任务状态（含 Bull 队列状态 + 进度 progress 0→100）',
        description: 'S1-T09 交付：支持进度查询；异步任务进度按 20→40→60→80→100 每阶段写回 MySQL sw_jobs.progress',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { job: { status: 'completed', progress: 100, result: {} }, bull: { jobId: 'swjob_xxx', state: 'completed' } } } } } },
      },
      delete: { tags: ['任务队列'], summary: '取消任务（若未开始）', responses: { 200: { description: 'OK' } } },
    },
  },
  components: {
    schemas: {
      OutlineGenerateRequest: {
        type: 'object',
        required: ['idea'],
        properties: {
          idea:          { type: 'string', description: '一句话创意，核心必填', example: '寒门学子意外救下落难富家千金' },
          title:         { type: 'string', description: '可选标题，未填时 AI 自动生成' },
          genre:         { type: 'string', description: '题材字典 key，见 GET /genres', example: 'urban_romance' },
          structure:     { type: 'string', enum: ['three_act', 'heros_journey', 'qi_cheng_zhuan_he'], default: 'three_act' },
          style:         { type: 'string', description: '风格字典 key', example: 'sweet' },
          episodeCount:  { type: 'integer', minimum: 3, maximum: 100, default: 10 },
          targetAudience:{ type: 'string', example: '女性 18-35 岁' },
          userId:        { type: 'integer' },
        },
      },
    },
  },
};
