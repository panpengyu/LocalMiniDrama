# localmini-openapi — LocalMiniDrama 开放平台 Python SDK

LocalMiniDrama 开放平台 API 的官方 Python SDK。**仅依赖标准库**（urllib），无需第三方 HTTP 库。

## 安装

```bash
# 从源码安装
pip install -e ./sdks/python

# 或使用 pip
pip install localmini-openapi
```

## 快速开始

```python
from localmini_openapi import OpenApiClient

client = OpenApiClient(
    api_key="lmd_xxxxxxxxxxxxxxxx",
    base_url="https://your-host/api/v1/open",  # 或本地 "http://localhost:5679/api/v1/open"
)

# 创建项目
drama = client.create_drama(title="我的短剧", genre="都市")
print("新建项目 ID:", drama["id"])

# 项目列表
items = client.list_dramas(page=1, page_size=20)
print("项目总数:", items["pagination"]["total"])

# 生成剧本大纲
outline = client.generate_outline(
    idea="一个外卖骑手意外获得读心术的故事",
    episode_count=10,
)

# 提交图片生成（异步）
task = client.create_image(drama_id=drama["id"], prompt="都市夜景，霓虹灯下")
print("任务 ID:", task["task_id"])
```

## 方法一览

| 方法 | 对应接口 | 需要 scope |
| --- | --- | --- |
| `list_dramas(...)` | `GET /dramas` | `drama:read` |
| `get_drama(id)` | `GET /dramas/{id}` | `drama:read` |
| `create_drama(...)` | `POST /dramas` | `drama:write` |
| `generate_outline(...)` | `POST /screenplay/outlines` | `screenplay:generate` |
| `generate_characters(...)` | `POST /screenplay/characters` | `screenplay:generate` |
| `create_image(...)` | `POST /images` | `image:generate` |
| `get_image_task(task_id)` | `GET /images/{id}` | `image:generate` |
| `list_assets(...)` | `GET /assets` | `asset:read` |

## 鉴权

SDK 自动在请求头携带 `X-API-Key: <api_key>`。请在「开发者控制台」创建应用并生成密钥，
并确保密钥具备对应接口的权限范围（scope）。

## 错误处理

非 2xx 响应会抛出 `OpenApiError`（HTTP 429 → `OpenApiRateLimitError`，HTTP 403 → `OpenApiPermissionError`），
均含 `status` 与 `code` 属性：

```python
from localmini_openapi import OpenApiClient, OpenApiRateLimitError

try:
    client.create_drama(title="x")
except OpenApiRateLimitError as e:
    print(e.status, e.code)  # 429 RATE_LIMITED
```

常见错误码：
`MISSING_API_KEY` / `INVALID_API_KEY` / `API_KEY_EXPIRED` / `API_KEY_REVOKED` /
`API_KEY_INACTIVE` / `IP_DENIED` / `SCOPE_NOT_ALLOWED` / `RATE_LIMITED` / `DAILY_QUOTA_EXCEEDED`

## 在线文档

Swagger UI：`GET /api/v1/open/docs`
纯 JSON spec：`GET /api/v1/open/docs/openapi.json`

## 测试

```bash
python -m unittest discover -s tests
```
