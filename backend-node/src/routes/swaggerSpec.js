// ---------------------------------------------------------------
// OpenAPI 3.0 规范（Sprint 1 + Sprint 4）
// 访问端点: GET /api/v1/docs → Swagger UI
// ---------------------------------------------------------------
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'LocalMiniDrama — AI创作平台 API',
    version: '4.0.0',
    description: '高端智能漫剧创作平台后端接口。Sprint 1：AI编剧助手（大纲/角色/分集/分镜/台词生成、多轮对话、任务队列）。Sprint 4：智能分镜生成、智能配音TTS流水线、AI模型智能路由引擎、内容审核服务、智能运营看板。数据全部落库 MySQL。',
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
    { name: '智能分镜(S4)', description: 'S4-T01 智能分镜生成：剧本段落→专业分镜（镜头类型/运镜/构图/情绪/时长）' },
    { name: '智能配音(S4)', description: 'S4-T03 智能配音TTS流水线：角色音色绑定/台词提取/批量TTS/情感语调' },
    { name: '模型路由(S4)', description: 'S4-T07 AI模型智能路由引擎：自动选择模型 + 故障转移 + 熔断器' },
    { name: '内容审核(S4)', description: 'S4-T08 内容审核服务：文本/图片/视频审核 + 违规拦截 + 人工复审' },
    { name: '运营看板(S4)', description: 'S4-T05 智能运营看板：创作漏斗 + 模型成本 + AI洞察' },
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

    // ================= Sprint 2/3: 角色一致性 =================
    '/ai/consistency/check': {
      post: {
        tags: ['角色一致性'],
        summary: '一致性校验（S2-T08 / S3-T01）',
        description: '比对生成图与角色参考图的余弦相似度 + 视觉模型兜底，返回相似度分数和是否通过阈值',
        requestBody: {
          required: true,
          content: { 'application/json': { example: { dramaId: 1, storyboardId: 24, characterId: 5, generatedImageUrl: '/static/projects/1/images/ig_xxx.jpg', referenceImageUrl: null, threshold: 0.85 } } },
        },
        responses: {
          200: {
            description: '校验完成',
            content: { 'application/json': { example: { checkId: 'cchk_xxx', similarityScore: 0.9123, threshold: 0.85, passed: true, method: 'cosine_embedding' } } },
          },
        },
      },
    },
    '/ai/consistency/embeddings': {
      post: {
        tags: ['角色一致性'],
        summary: '为角色生成面部 embedding（S2-T07 角色指纹）',
        description: '调用视觉模型提取角色图片的面部特征向量，存储到 character_embeddings 表并同步回 characters 主表',
        requestBody: {
          required: true,
          content: { 'application/json': { example: { characterId: 5, characterType: 'project', imageUrl: null, viewAngle: 'front', model: 'vision-embedding' } } },
        },
        responses: { 200: { description: '生成完成' } },
      },
    },
    '/ai/consistency/embeddings/batch': {
      post: {
        tags: ['角色一致性'],
        summary: '批量为剧中角色生成 embedding（S2-T07）',
        description: '遍历某 drama 下所有角色，逐个调用 generateCharacterEmbedding',
        requestBody: { required: true, content: { 'application/json': { example: { dramaId: 1, model: 'vision-embedding' } } } },
        responses: { 200: { description: '批量完成' } },
      },
    },
    '/ai/consistency/embeddings/{characterId}': {
      get: {
        tags: ['角色一致性'],
        summary: '获取角色 embedding 元数据（S3-T01 前端展示）',
        description: '不返回原始向量数组，仅返回维度/模型/生成时间/阈值，供前端一致性面板概览',
        parameters: [
          { name: 'characterId', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'characterType', in: 'query', schema: { type: 'string', default: 'project' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/consistency/logs': {
      get: {
        tags: ['角色一致性'],
        summary: '一致性校验历史（S3-T01 前端面板）',
        description: '支持按 drama/storyboard/character 过滤，展示分数和通过状态，默认返回最近 20 条',
        parameters: [
          { name: 'dramaId', in: 'query', schema: { type: 'integer' } },
          { name: 'characterId', in: 'query', schema: { type: 'integer' } },
          { name: 'storyboardId', in: 'query', schema: { type: 'integer' } },
          { name: 'passed', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/consistency/stats/{characterId}': {
      get: {
        tags: ['角色一致性'],
        summary: '角色一致性统计（S3-T01 分数面板）',
        description: '返回某角色的校验总数、平均分、通过率、最近一次分数和通过状态，用于角色详情页一致性概览',
        parameters: [{ name: 'characterId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { example: { totalChecks: 24, avgScore: 0.8872, passRate: 0.875, recentScore: 0.9012, recentPassed: true } } },
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

    // ================= Sprint 4: 智能分镜生成 (S4-T01) =================
    '/ai/storyboard/generate': {
      post: {
        tags: ['智能分镜(S4)'],
        summary: 'S4-T01 智能分镜生成（剧本段落→专业分镜列表）',
        description: '输入剧本段落，AI 生成专业分镜脚本，包含镜头类型/运镜/构图/情绪/时长/转场/视觉描述/SD Prompt。生成结果落库 ai_storyboard_generations。',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/StoryboardGenerateRequest' },
            example: {
              scriptText: '林深推开门，看到满地碎片，他惊恐地后退。苏暖从阴影中走出，手中握着一把染血的匕首。',
              dramaId: 100, episodeId: 10, style: 'vertical_916', count: 8,
              characters: [{ name: '林深' }, { name: '苏暖' }],
            },
          } },
        },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { generationId: 'sbg_xxx', count: 8, frames: [{ frame_number: 1, shot_type: 'close_up', shot_type_label: '特写', camera_movement: 'push', camera_movement_label: '推镜头', duration: '3秒', visual_description: '特写：林深惊恐的眼神', prompt: 'comic panel, close_up, tense atmosphere' }] } } } } } },
      },
    },
    '/ai/storyboard/polish-prompt': {
      post: {
        tags: ['智能分镜(S4)'],
        summary: 'S4-T01 单帧提示词润色',
        description: '对单个分镜的视觉描述进行 AI 润色，生成优化后的 SD Prompt。',
        requestBody: { required: true, content: { 'application/json': { example: { frame: { shot_type: 'close_up', emotion: 'tense', visual_description: '主角惊恐' }, style: 'vertical_916' } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { prompt: 'comic panel, masterpiece, close_up, tense atmosphere' } } } } } },
      },
    },
    '/ai/storyboard/generations': {
      get: {
        tags: ['智能分镜(S4)'],
        summary: '生成批次列表',
        parameters: [
          { name: 'dramaId', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/storyboard/generations/{id}': {
      get: {
        tags: ['智能分镜(S4)'],
        summary: '生成批次详情（含分镜帧列表）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 404: { description: '批次不存在' } },
      },
    },
    '/ai/storyboard/dictionaries': {
      get: {
        tags: ['智能分镜(S4)'],
        summary: '分镜字典（镜头类型/运镜/构图/情绪/转场）',
        description: '返回专业镜头语言字典，供前端下拉选择和分镜渲染使用。',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { shotTypes: { close_up: '特写' }, cameraMovements: { push: '推镜头' }, compositions: { rule_of_thirds: '三分法' }, emotions: { tense: '紧张' }, transitions: { cut: '硬切' } } } } } } },
      },
    },

    // ================= Sprint 4: 智能配音 TTS 流水线 (S4-T03) =================
    '/ai/tts/voices': {
      get: { tags: ['智能配音(S4)'], summary: '音色列表（预设音色字典）', responses: { 200: { description: 'OK' } } },
    },
    '/ai/tts/emotions': {
      get: { tags: ['智能配音(S4)'], summary: '情感语调列表（neutral/happy/sad/angry/tense 等）', responses: { 200: { description: 'OK' } } },
    },
    '/ai/tts/voice-bindings': {
      get: {
        tags: ['智能配音(S4)'],
        summary: '角色音色绑定列表',
        parameters: [{ name: 'dramaId', in: 'query', schema: { type: 'integer' }, description: '按项目过滤' }],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['智能配音(S4)'],
        summary: '绑定/更新角色音色',
        description: '为角色绑定独特音色，支持情感语调参数。同一项目同一角色重复绑定为更新。数据落库 character_voice_bindings。',
        requestBody: { required: true, content: { 'application/json': { example: { dramaId: 1, characterId: 101, characterName: '林深', voiceId: 'male_deep', emotion: 'tense', isDefault: true } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/tts/voice-bindings/{id}': {
      delete: { tags: ['智能配音(S4)'], summary: '删除音色绑定', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
    },
    '/ai/tts/extract-dialogues': {
      post: {
        tags: ['智能配音(S4)'],
        summary: '从分镜提取台词',
        description: '从 storyboards 表的 dialogue/narration 字段提取台词，支持 "角色名:台词" 多行格式，自动识别旁白。',
        requestBody: { required: true, content: { 'application/json': { example: { dramaId: 100, episodeId: 10 } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { items: [{ storyboardId: 1, characterName: '林深', text: '这里到底发生过什么？', sortOrder: 0 }] } } } } } },
      },
    },
    '/ai/tts/batch-synthesize': {
      post: {
        tags: ['智能配音(S4)'],
        summary: '批量 TTS 合成',
        description: '批量合成台词语音，自动匹配角色音色绑定，应用情感语调参数。生成音频落盘 storage/audio/，批次记录落库 tts_batch_jobs，分镜配音关联落库 storyboard_dubbing。',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/BatchTTSRequest' },
            example: { dramaId: 1, episodeId: 10, items: [{ characterName: '林深', text: '这里到底发生过什么？', storyboardId: 1, emotion: 'tense' }] },
          } },
        },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { batchId: 1, total: 1, success: 1, failed: 0, results: [{ index: 0, status: 'success', characterName: '林深', audioPath: 'audio/tts_xxx.mp3' }] } } } } } },
      },
    },
    '/ai/tts/dubbing/episode/{id}': {
      get: {
        tags: ['智能配音(S4)'],
        summary: '分集配音记录',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'episode_id' }],
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= Sprint 4: AI模型智能路由 (S4-T07) =================
    '/ai/model-routing/rules': {
      get: {
        tags: ['模型路由(S4)'],
        summary: '路由规则列表',
        parameters: [
          { name: 'taskType', in: 'query', schema: { type: 'string' }, description: 'image/video/text/tts' },
          { name: 'isActive', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'OK' } },
      },
      post: {
        tags: ['模型路由(S4)'],
        summary: '创建/更新路由规则（upsert）',
        description: '定义任务类型的模型路由策略：主模型 + 备选模型 + 成本上限 + 质量层级。相同 ruleKey 触发更新。数据落库 ai_routing_rules。',
        requestBody: { required: true, content: { 'application/json': { example: { ruleKey: 'image_standard', taskType: 'image', qualityTier: 'standard', primaryConfigId: 1, primaryModel: 'dall-e-3', fallbackConfigId: 2, fallbackModel: 'sdxl', maxCostPerCall: 0.5, priority: 100 } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/model-routing/rules/{id}': {
      delete: { tags: ['模型路由(S4)'], summary: '删除路由规则', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
    },
    '/ai/model-routing/route': {
      post: {
        tags: ['模型路由(S4)'],
        summary: '智能路由决策（返回推荐模型）',
        description: '根据任务类型/质量层级/成本预算自动选择最优模型。主模型熔断时自动故障转移到备选模型。支持 preferModel 指定优先模型。',
        requestBody: { required: true, content: { 'application/json': { example: { taskType: 'image', qualityTier: 'standard', costBudget: 0.5, preferModel: 'dall-e-3' } } } },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { config: { id: 1, provider: 'openai' }, model: 'dall-e-3', rule: { ruleKey: 'image_standard' }, isFallback: false } } } } } },
      },
    },
    '/ai/model-routing/stats': {
      get: {
        tags: ['模型路由(S4)'],
        summary: '模型调用统计与综合评分',
        description: '从 ai_model_call_logs 聚合各模型的调用量/成功率/耗时/成本/质量评分，综合评分 = 成功率40% + 速度分30% + 质量分30%。',
        parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30 }, description: '统计最近 N 天' }],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/model-routing/circuit/{configId}/{model}': {
      get: {
        tags: ['模型路由(S4)'],
        summary: '查询模型熔断状态',
        description: '返回熔断器状态：closed（正常）/ open（熔断中，拒绝请求）/ half_open（半开探测）。',
        parameters: [
          { name: 'configId', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'model', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { state: 'closed', failureCount: 0 } } } } } },
      },
    },
    '/ai/model-routing/call-log': {
      post: {
        tags: ['模型路由(S4)'],
        summary: '记录模型调用日志',
        description: '记录每次模型调用的成本/耗时/质量评分/状态。status=success 重置熔断器，status=failed/timeout 增加失败计数。数据落库 ai_model_call_logs。',
        requestBody: { required: true, content: { 'application/json': { example: { configId: 1, serviceType: 'image', model: 'dall-e-3', taskType: 'image_gen', status: 'success', latencyMs: 1500, cost: 0.04, qualityScore: 92 } } } },
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= Sprint 4: 内容审核 (S4-T08) =================
    '/ai/moderation/check': {
      post: {
        tags: ['内容审核(S4)'],
        summary: '内容审核（单条）',
        description: '审核文本/图片/视频内容，内置关键词检测 + 可配置外部审核API（阿里云绿网/腾讯云天御）。支持 strict/standard/loose 三种模式。违规内容自动拦截，审核记录落库 content_moderation_logs。',
        requestBody: {
          required: true,
          content: { 'application/json': {
            schema: { $ref: '#/components/schemas/ModerationRequest' },
            example: { resourceType: 'text', contentSnapshot: '待审核的剧本台词', mode: 'standard', dramaId: 100 },
          } },
        },
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { verdict: 'safe', riskLabel: 'safe', riskScore: 0, isBlocked: false, logId: 1 } } } } } },
      },
    },
    '/ai/moderation/check-batch': {
      post: {
        tags: ['内容审核(S4)'],
        summary: '批量内容审核',
        requestBody: { required: true, content: { 'application/json': { example: { mode: 'standard', items: [{ resourceType: 'text', contentSnapshot: '内容1' }, { resourceType: 'text', contentSnapshot: '内容2' }] } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/moderation/logs': {
      get: {
        tags: ['内容审核(S4)'],
        summary: '审核记录列表',
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'integer' } },
          { name: 'dramaId', in: 'query', schema: { type: 'integer' } },
          { name: 'verdict', in: 'query', schema: { type: 'string', enum: ['safe', 'pending', 'violation'] } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/moderation/logs/{id}': {
      get: {
        tags: ['内容审核(S4)'],
        summary: '审核记录详情',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'OK' }, 404: { description: '记录不存在' } },
      },
    },
    '/ai/moderation/logs/{id}/review': {
      patch: {
        tags: ['内容审核(S4)'],
        summary: '人工复审',
        description: '人工更新审核结论：safe/pending/violation。verdict=violation 时自动标记拦截。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: { required: true, content: { 'application/json': { example: { verdict: 'violation', reviewNote: '人工判定违规' } } } },
        responses: { 200: { description: 'OK' } },
      },
    },
    '/ai/moderation/rules': {
      get: {
        tags: ['内容审核(S4)'],
        summary: '审核规则配置（按模式）',
        parameters: [{ name: 'mode', in: 'query', schema: { type: 'string', enum: ['strict', 'standard', 'loose'], default: 'standard' } }],
        responses: { 200: { description: 'OK' } },
      },
    },

    // ================= Sprint 4: 智能运营看板 (S4-T05) =================
    '/admin/stats/funnel': {
      get: {
        tags: ['运营看板(S4)'],
        summary: '创作漏斗分析（全链路转化率）',
        description: '统计创建项目→完成剧本→生成分镜→生成图片→生成视频→导出成品各阶段数量与转化率。',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { stages: [{ key: 'created', label: '创建项目', count: 100, conversionRate: 100 }, { key: 'script', label: '完成剧本', count: 80, conversionRate: 80 }], overallRate: 30 } } } } } },
      },
    },
    '/admin/stats/model-cost': {
      get: {
        tags: ['运营看板(S4)'],
        summary: 'AI模型成本看板',
        description: '各AI模型的调用量/成功率/成本/平均耗时对比，汇总总成本与平均成功率。',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { items: [{ model: 'dall-e-3', serviceType: 'image', totalCalls: 100, successRate: 95, avgLatency: 1500, totalCost: 4.5 }], summary: { totalModels: 3, totalCalls: 500, totalCost: 22.5, avgSuccessRate: 93.5 } } } } } } },
      },
    },
    '/admin/stats/insights': {
      get: {
        tags: ['运营看板(S4)'],
        summary: 'AI智能洞察（异常检测）',
        description: '自动检测指标异常波动：生成失败率上升、模型熔断、审核违规趋势、创作漏斗转化预警，生成自然语言洞察。',
        responses: { 200: { description: 'OK', content: { 'application/json': { example: { success: true, data: { insights: [{ level: 'warning', type: 'failure_rate', message: '今日生成失败率 15.2%，较昨日上升 10 个百分点' }], generatedAt: '2026-08-09T10:00:00Z' } } } } } },
      },
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
      StoryboardGenerateRequest: {
        type: 'object',
        required: ['scriptText'],
        properties: {
          scriptText:  { type: 'string', description: '剧本段落文本', example: '林深推开门，看到满地碎片...' },
          dramaId:     { type: 'integer', description: '项目ID' },
          episodeId:   { type: 'integer', description: '分集ID' },
          style:       { type: 'string', enum: ['cinematic_235', 'vertical_916', 'anime_jp', 'noir_mood'], default: 'vertical_916', description: '镜头风格' },
          count:       { type: 'integer', minimum: 1, maximum: 40, default: 8, description: '生成分镜数量' },
          characters:  { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } }, description: '角色列表' },
          scenes:      { type: 'array', items: { type: 'object' }, description: '场景列表' },
        },
      },
      BatchTTSRequest: {
        type: 'object',
        required: ['items'],
        properties: {
          dramaId:   { type: 'integer', description: '项目ID' },
          episodeId: { type: 'integer', description: '分集ID' },
          items: {
            type: 'array',
            description: '台词列表',
            items: {
              type: 'object',
              required: ['text'],
              properties: {
                characterName: { type: 'string', description: '角色名（用于匹配音色绑定）', example: '林深' },
                text:          { type: 'string', description: '台词文本', example: '这里到底发生过什么？' },
                storyboardId:  { type: 'integer', description: '关联分镜ID' },
                voiceId:       { type: 'string', description: '指定音色ID（覆盖角色绑定）' },
                emotion:       { type: 'string', enum: ['neutral', 'happy', 'sad', 'angry', 'tense', 'epic', 'warm', 'romantic'], description: '情感语调' },
                speed:         { type: 'number', minimum: 0.5, maximum: 2.0, description: '语速（覆盖情感参数）' },
              },
            },
          },
        },
      },
      ModerationRequest: {
        type: 'object',
        required: ['resourceType'],
        properties: {
          resourceType:     { type: 'string', enum: ['text', 'image', 'video'], description: '资源类型' },
          resourceId:       { type: 'integer', description: '资源ID（如 image_generations.id）' },
          resourceUrl:      { type: 'string', description: '资源URL（图片/视频审核时填写）' },
          contentSnapshot:  { type: 'string', description: '内容快照（文本内容或图片URL）' },
          mode:             { type: 'string', enum: ['strict', 'standard', 'loose'], default: 'standard', description: '审核模式：strict(严格)/standard(标准)/loose(宽松)' },
          dramaId:          { type: 'integer', description: '项目ID' },
        },
      },
    },
  },
};
