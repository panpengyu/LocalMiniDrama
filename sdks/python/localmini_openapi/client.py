# -*- coding: utf-8 -*-
"""LocalMiniDrama 开放平台 API —— Python SDK 客户端（Sprint 15: S15-T04）。

仅依赖 Python 标准库（urllib），无需第三方 HTTP 库。
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

from .errors import (
    OpenApiError,
    OpenApiPermissionError,
    OpenApiRateLimitError,
)

# 默认基地址：本地开发默认指向本机后端；生产环境可通过环境变量 OPENAPI_BASE_URL 覆盖
_DEFAULT_BASE_URL = os.environ.get("OPENAPI_BASE_URL", "http://localhost:5679/api/v1/open")


class OpenApiClient(object):
    """LocalMiniDrama 开放平台 API 客户端。

    Args:
        api_key: 应用 API Key（必填）
        base_url: 开放 API 基地址，默认本地开发地址
        timeout: 请求超时（秒）
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 60.0,
    ) -> None:
        if not api_key:
            raise ValueError("OpenApiClient: api_key 是必填项")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    # ------------------------------------------------------------------
    # 底层请求
    # ------------------------------------------------------------------
    def request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        """发起一次请求，返回服务端 data 字段（成功路径）。"""
        url = self.base_url + path
        if query:
            params = {
                k: str(v)
                for k, v in query.items()
                if v is not None and str(v) != ""
            }
            if params:
                url = url + "?" + urllib.parse.urlencode(params)

        headers = {
            "Accept": "application/json",
            "X-API-Key": self.api_key,
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                payload = json.loads(raw) if raw else {}
                # 成功路径：解包 { success, data }
                if isinstance(payload, dict) and "data" in payload:
                    return payload.get("data")
                return payload
        except urllib.error.HTTPError as e:
            return self._raise_http_error(e)
        except urllib.error.URLError as e:
            raise OpenApiError(0, "NETWORK_ERROR", "网络错误: {}".format(e)) from e

    @staticmethod
    def _raise_http_error(e: urllib.error.HTTPError) -> None:
        raw = None
        try:
            raw = e.read().decode("utf-8")
            payload = json.loads(raw)
        except Exception:  # noqa: BLE001
            payload = None
        error_body = payload.get("error", payload) if isinstance(payload, dict) else payload
        code = error_body.get("code") if isinstance(error_body, dict) else None
        message = error_body.get("message") if isinstance(error_body, dict) else (raw or "请求失败")
        code = code or "HTTP_{}".format(e.code)
        message = message or "请求失败"
        status = e.code
        if status == 403:
            raise OpenApiPermissionError(status, code, message) from e
        if status == 429:
            raise OpenApiRateLimitError(status, code, message) from e
        raise OpenApiError(status, code, message) from e

    # ------------------------------------------------------------------
    # 项目管理
    # ------------------------------------------------------------------
    def list_dramas(self, page: int = 1, page_size: int = 20, status: str = None,
                    genre: str = None, keyword: str = None) -> Any:
        """项目列表。需要权限范围 drama:read。"""
        return self.request("GET", "/dramas", query={
            "page": page, "page_size": page_size, "status": status,
            "genre": genre, "keyword": keyword,
        })

    def get_drama(self, drama_id: int) -> Any:
        """项目详情。需要权限范围 drama:read。"""
        return self.request("GET", "/dramas/{}".format(drama_id))

    def create_drama(self, title: str, description: str = None, genre: str = None,
                     style: str = None, metadata: dict = None) -> Any:
        """创建项目。需要权限范围 drama:write。"""
        if not title or not str(title).strip():
            raise ValueError("title 必填")
        return self.request("POST", "/dramas", body={
            "title": title, "description": description, "genre": genre,
            "style": style, "metadata": metadata,
        })

    # ------------------------------------------------------------------
    # 剧本生成
    # ------------------------------------------------------------------
    def generate_outline(self, idea: str, drama_id: int = None, title: str = None,
                         genre: str = None, style: str = None, structure: str = None,
                         episode_count: int = 10, target_audience: str = None,
                         model: str = None) -> Any:
        """生成剧本大纲。需要权限范围 screenplay:generate。"""
        if not idea or not str(idea).strip():
            raise ValueError("idea 必填")
        return self.request("POST", "/screenplay/outlines", body={
            "idea": idea, "drama_id": drama_id, "title": title, "genre": genre,
            "style": style, "structure": structure, "episode_count": episode_count,
            "target_audience": target_audience, "model": model,
        })

    def generate_characters(self, outline_id: str, drama_id: int = None,
                            count: int = None) -> Any:
        """生成角色档案。需要权限范围 screenplay:generate。"""
        if not outline_id:
            raise ValueError("outline_id 必填")
        return self.request("POST", "/screenplay/characters", body={
            "outline_id": outline_id, "drama_id": drama_id, "count": count,
        })

    # ------------------------------------------------------------------
    # 图片生成
    # ------------------------------------------------------------------
    def create_image(self, drama_id: int, prompt: str = None, scene_id: int = None,
                     storyboard_id: int = None, negative_prompt: str = None,
                     frame_type: str = None, reference_images: list = None,
                     provider: str = None, model: str = None, size: str = None) -> Any:
        """提交图片生成任务（异步）。需要权限范围 image:generate。"""
        if not drama_id:
            raise ValueError("drama_id 必填")
        return self.request("POST", "/images", body={
            "drama_id": drama_id, "prompt": prompt, "scene_id": scene_id,
            "storyboard_id": storyboard_id, "negative_prompt": negative_prompt,
            "frame_type": frame_type, "reference_images": reference_images,
            "provider": provider, "model": model, "size": size,
        })

    def get_image_task(self, task_id: str) -> Any:
        """查询图片生成结果。需要权限范围 image:generate。"""
        return self.request("GET", "/images/{}".format(task_id))

    # ------------------------------------------------------------------
    # 素材查询
    # ------------------------------------------------------------------
    def list_assets(self, drama_id: int = None, type_: str = None,
                    page: int = 1, page_size: int = 20) -> Any:
        """素材列表。需要权限范围 asset:read。"""
        return self.request("GET", "/assets", query={
            "drama_id": drama_id, "type": type_, "page": page, "page_size": page_size,
        })
