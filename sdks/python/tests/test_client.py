# -*- coding: utf-8 -*-
"""LocalMiniDrama 开放平台 Python SDK —— 客户端冒烟测试（Sprint 15: S15-T04）。

通过 monkeypatch urllib 验证：
   1) URL / 鉴权头 / body 构造正确
   2) 成功路径数据解包
   3) 429 归一化为 OpenApiRateLimitError
   4) 403 归一化为 OpenApiPermissionError
"""
import io
import json
import unittest
import urllib.error
from unittest import mock

from localmini_openapi import (
    OpenApiClient,
    OpenApiError,
    OpenApiPermissionError,
    OpenApiRateLimitError,
)


class _FakeResponse(object):
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


def _http_error(code, payload):
    """构造一个真实的 urllib HTTPError。"""
    body = json.dumps(payload).encode("utf-8")
    fp = io.BytesIO(body)
    return urllib.error.HTTPError(
        url="http://test/api/v1/open/dramas",
        code=code,
        msg="error",
        hdrs={},
        fp=fp,
    )


class OpenApiClientTest(unittest.TestCase):
    def setUp(self):
        self.client = OpenApiClient(api_key="lmd_test", base_url="http://test/api/v1/open")

    def test_success_data_unwrap_and_auth_header(self):
        captured = {}

        def fake_urlopen(req, **kwargs):
            # urllib 会把 header 名规范化（如 X-api-key），HTTP 协议大小写不敏感，故转小写断言
            headers = {k.lower(): v for k, v in req.header_items()}
            captured["url"] = req.full_url
            captured["method"] = req.get_method()
            captured["header"] = headers.get("x-api-key")
            captured["content_type"] = headers.get("content-type")
            return _FakeResponse({"success": True, "data": {"id": 1, "title": "t"}}, status=201)

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            drama = self.client.create_drama(title="t")

        self.assertEqual(drama["id"], 1)
        self.assertIn("/dramas", captured["url"])
        self.assertEqual(captured["header"], "lmd_test")
        self.assertEqual(captured["content_type"], "application/json")

    def test_query_params(self):
        captured = {}

        def fake_urlopen(req, **kwargs):
            captured["url"] = req.full_url
            return _FakeResponse({"success": True, "data": {"items": [], "pagination": {}}})

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            self.client.list_dramas(page=2, page_size=30, status="draft", keyword=None)

        self.assertIn("page=2", captured["url"])
        self.assertIn("page_size=30", captured["url"])
        self.assertIn("status=draft", captured["url"])
        self.assertNotIn("keyword", captured["url"])

    def test_rate_limit_error(self):
        err = _http_error(429, {"code": "RATE_LIMITED", "message": "请求过于频繁"})
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(OpenApiRateLimitError) as ctx:
                self.client.list_dramas()
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(ctx.exception.code, "RATE_LIMITED")

    def test_permission_error(self):
        err = _http_error(403, {"code": "SCOPE_NOT_ALLOWED", "message": "无权限范围"})
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(OpenApiPermissionError) as ctx:
                self.client.create_drama(title="x")
        self.assertEqual(ctx.exception.code, "SCOPE_NOT_ALLOWED")

    def test_required_title(self):
        with self.assertRaises(ValueError):
            self.client.create_drama(title="")


if __name__ == "__main__":
    unittest.main()
