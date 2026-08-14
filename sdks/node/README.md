# @localmini/open-api — LocalMiniDrama 开放平台 Node.js SDK

LocalMiniDrama 开放平台 API 的官方 Node.js SDK。Node 18+ 内置 `fetch`，**零运行时依赖**。

## 安装

```bash
npm install @localmini/open-api
```

（本仓库 monorepo 内置，路径：`sdks/node`）

## 快速开始

```js
const { OpenApiClient } = require('@localmini/open-api');

const client = new OpenApiClient({
  baseUrl: 'https://your-host/api/v1/open', // 或本地 'http://localhost:5679/api/v1/open'
  apiKey: 'lmd_xxxxxxxxxxxxxxxx',
});

// 创建项目
const drama = await client.createDrama({ title: '我的短剧', genre: '都市' });
console.log('新建项目 ID:', drama.id);

// 项目列表
const list = await client.listDramas({ page: 1, page_size: 20 });
console.log('项目总数:', list.pagination.total);

// 生成剧本大纲
const outline = await client.generateOutline({ idea: '一个外卖骑手意外获得读心术的故事', episode_count: 10 });

// 提交图片生成（异步）
const task = await client.createImage({ drama_id: drama.id, prompt: '都市夜景，霓虹灯下' });
console.log('任务 ID:', task.task_id);
```

## 接口一览

| 方法 | 对应接口 | 需要 scope |
| --- | --- | --- |
| `listDramas(params)` | `GET /dramas` | `drama:read` |
| `getDrama(id)` | `GET /dramas/{id}` | `drama:read` |
| `createDrama(payload)` | `POST /dramas` | `drama:write` |
| `generateOutline(payload)` | `POST /screenplay/outlines` | `screenplay:generate` |
| `generateCharacters(payload)` | `POST /screenplay/characters` | `screenplay:generate` |
| `createImage(payload)` | `POST /images` | `image:generate` |
| `getImageTask(taskId)` | `GET /images/{id}` | `image:generate` |
| `listAssets(params)` | `GET /assets` | `asset:read` |

## 鉴权

SDK 自动在请求头携带 `X-API-Key: <apiKey>`。请在「开发者控制台」创建应用并生成密钥，
并确保密钥具备对应接口的权限范围（scope）。

## 错误处理

所有非 2xx 响应都会抛出 `OpenApiError`，包含 `status`（HTTP 状态码）与 `code`（业务错误码）：

```js
const { OpenApiClient, OpenApiError } = require('@localmini/open-api');

try {
  await client.createDrama({ title: 'x' });
} catch (err) {
  if (err instanceof OpenApiError) {
    console.error(err.status, err.code, err.message);
    if (err.code === 'DAILY_QUOTA_EXCEEDED') { /* 处理配额 */ }
  }
}
```

常见错误码：

- `MISSING_API_KEY` 缺少 API Key
- `INVALID_API_KEY` 无效的 API Key
- `API_KEY_EXPIRED` / `API_KEY_REVOKED` / `API_KEY_INACTIVE`
- `IP_DENIED` IP 不在白名单
- `SCOPE_NOT_ALLOWED` 无对应权限范围
- `RATE_LIMITED` 超过分钟限流
- `DAILY_QUOTA_EXCEEDED` 超过当日配额

## 在线文档

Swagger UI：`GET /api/v1/open/docs`
纯 JSON spec：`GET /api/v1/open/docs/openapi.json`

## 测试

```bash
node test/smoke.test.js   # 本地单测：校验请求构造与错误归一化
```
