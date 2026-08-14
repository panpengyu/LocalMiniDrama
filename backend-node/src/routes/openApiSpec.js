// ---------------------------------------------------------------
// 开放平台（Open Platform）OpenAPI 3.0 规范（Sprint 15: S15-T04）
// 访问端点: GET /api/v1/open/docs → Swagger UI
// 纯 JSON spec: GET /api/v1/open/docs/openapi.json
// ---------------------------------------------------------------
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'LocalMiniDrama — 开放平台 API（Open Platform）',
    version: '1.0.0',
    description:
      '面向第三方开发者的开放 API。通过「开发者控制台」创建应用、生成 API Key（SHA-256 哈希存储），' +
      '调用本开放 API 时在请求头携带密钥完成认证，并由 API 网关统一执行限流、配额与权限范围(scope)校验。' +
      'Sprint 15：API Key 管理系统 + 网关限流 + 开放接口（项目管理/剧本生成/图片生成/素材查询）。',
    contact: { name: 'LocalMiniDrama Team' },
    license: { name: 'Proprietary' },
  },
  servers: [{ url: '/api/v1/open', description: 'Open Platform API base' }],
  // 认证方案：API Key（X-API-Key 或 Bearer）
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: '应用 API Key，形如 lmd_xxx。也可使用 Authorization: Bearer <key>',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'INVALID_API_KEY' },
          message: { type: 'string', example: '无效的 API Key' },
        },
      },
      Drama: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          title: { type: 'string' },
          description: { type: 'string' },
          genre: { type: 'string' },
          style: { type: 'string', example: 'realistic' },
          status: { type: 'string', example: 'draft' },
          total_episodes: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Outline: {
        type: 'object',
        description: '剧本大纲',
        properties: {
          outline_id: { type: 'string' },
          title: { type: 'string' },
          genre: { type: 'string' },
          style: { type: 'string' },
          structure: { type: 'string' },
          summary: { type: 'string' },
          synopsis: { type: 'array', items: { type: 'object' } },
          episodes: { type: 'array', items: { type: 'object' } },
        },
      },
      ImageTask: {
        type: 'object',
        properties: {
          image_id: { type: 'integer' },
          task_id: { type: 'string' },
          status: { type: 'string', example: 'pending' },
        },
      },
      PagedDramas: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Drama' } },
          pagination: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              page_size: { type: 'integer' },
              total: { type: 'integer' },
              total_pages: { type: 'integer' },
            },
          },
        },
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  tags: [
    { name: '项目管理', description: '第三方应用项目（短剧）的创建与查询' },
    { name: '剧本生成', description: '调用 AI 生成剧本大纲 / 角色档案' },
    { name: '图片生成', description: '调用 AI 生成分镜 / 场景图片（异步任务）' },
    { name: '素材查询', description: '素材库检索' },
  ],
  paths: {
    /* ================= 项目管理 ================= */
    '/dramas': {
      get: {
        tags: ['项目管理'],
        summary: '项目列表',
        description: '返回当前 API Key 所属用户的短剧项目列表（分页）。需权限范围 drama:read。',
        security: [{ ApiKeyAuth: ['drama:read'] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 }, description: '页码' },
          { name: 'page_size', in: 'query', schema: { type: 'integer', default: 20 }, description: '每页数量(≤100)' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: '按状态过滤，如 draft' },
          { name: 'genre', in: 'query', schema: { type: 'string' }, description: '按题材过滤' },
          { name: 'keyword', in: 'query', schema: { type: 'string' }, description: '标题/描述关键字' },
        ],
        responses: {
          200: {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PagedDramas' } } },
          },
          401: { description: '缺少/无效 API Key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          403: { description: '无权限范围或 IP 不在白名单', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          429: { description: '超过分钟限流或当日配额', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
      post: {
        tags: ['项目管理'],
        summary: '创建项目',
        description: '创建一个新短剧项目（数据归属 API Key 用户）。需权限范围 drama:write。',
        security: [{ ApiKeyAuth: ['drama:write'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', description: '项目标题（必填）' },
                  description: { type: 'string', description: '简介' },
                  genre: { type: 'string', description: '题材，如 都市' },
                  style: { type: 'string', description: '风格，如 realistic' },
                  metadata: { type: 'object', description: '扩展元数据' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '创建成功', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { $ref: '#/components/schemas/Drama' } } } } } },
          400: { description: '参数缺失', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          403: { description: '无 drama:write 权限范围', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },
    '/dramas/{id}': {
      get: {
        tags: ['项目管理'],
        summary: '项目详情',
        description: '返回指定项目的完整详情（含分集/角色/场景等）。需权限范围 drama:read。',
        security: [{ ApiKeyAuth: ['drama:read'] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: '项目 ID' },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Drama' } } } },
          404: { description: '项目不存在' },
          401: { description: '认证失败', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
        },
      },
    },

    /* ================= 剧本生成 ================= */
    '/screenplay/outlines': {
      post: {
        tags: ['剧本生成'],
        summary: '生成剧本大纲',
        description: '根据创意梗概（idea）调用 AI 生成剧本大纲并落库。需权限范围 screenplay:generate。注意：此接口调用外部 AI，可能耗时。',
        security: [{ ApiKeyAuth: ['screenplay:generate'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idea'],
                properties: {
                  idea: { type: 'string', description: '创意梗概（必填）' },
                  drama_id: { type: 'integer', description: '关联项目 ID（可选）' },
                  title: { type: 'string' },
                  genre: { type: 'string', description: '题材' },
                  style: { type: 'string' },
                  structure: { type: 'string', description: '结构模板，如 three_act' },
                  episode_count: { type: 'integer', default: 10 },
                  target_audience: { type: 'string' },
                  model: { type: 'string', description: 'AI 模型' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '生成成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/Outline' } } } },
          400: { description: 'idea 必填', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          403: { description: '无 screenplay:generate 权限' },
        },
      },
    },
    '/screenplay/characters': {
      post: {
        tags: ['剧本生成'],
        summary: '生成角色档案',
        description: '基于大纲生成主角/配角/反派角色档案。需权限范围 screenplay:generate。',
        security: [{ ApiKeyAuth: ['screenplay:generate'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['outline_id'],
                properties: {
                  outline_id: { type: 'string', description: '大纲 ID（必填）' },
                  drama_id: { type: 'integer' },
                  count: { type: 'integer', description: '角色数量' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '生成成功' },
          400: { description: 'outline_id 必填' },
        },
      },
    },

    /* ================= 图片生成 ================= */
    '/images': {
      post: {
        tags: ['图片生成'],
        summary: '提交图片生成',
        description: '提交一个图片生成任务（异步），返回 task_id 用于查询。需权限范围 image:generate。',
        security: [{ ApiKeyAuth: ['image:generate'] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['drama_id'],
                properties: {
                  drama_id: { type: 'integer', description: '项目 ID（必填）' },
                  scene_id: { type: 'integer' },
                  storyboard_id: { type: 'integer' },
                  prompt: { type: 'string', description: '正向提示词' },
                  negative_prompt: { type: 'string' },
                  frame_type: { type: 'string', description: '画面类型' },
                  reference_images: { type: 'array', items: { type: 'string' }, description: '参考图 URL 列表' },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  size: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: '已提交', content: { 'application/json': { schema: { $ref: '#/components/schemas/ImageTask' } } } },
          400: { description: 'drama_id 必填' },
        },
      },
    },
    '/images/{id}': {
      get: {
        tags: ['图片生成'],
        summary: '查询图片生成结果',
        description: '按任务 ID 查询图片生成进度与结果。需权限范围 image:generate。',
        security: [{ ApiKeyAuth: ['image:generate'] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '任务 ID' },
        ],
        responses: {
          200: { description: 'OK' },
          404: { description: '任务不存在' },
        },
      },
    },

    /* ================= 素材查询 ================= */
    '/assets': {
      get: {
        tags: ['素材查询'],
        summary: '素材列表',
        description: '检索素材库。需权限范围 asset:read。',
        security: [{ ApiKeyAuth: ['asset:read'] }],
        parameters: [
          { name: 'drama_id', in: 'query', schema: { type: 'integer' }, description: '按项目过滤' },
          { name: 'type', in: 'query', schema: { type: 'string' }, description: '素材类型' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'page_size', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          200: { description: 'OK' },
          401: { description: '认证失败' },
        },
      },
    },
  },
};
