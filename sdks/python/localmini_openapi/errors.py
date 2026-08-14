# -*- coding: utf-8 -*-
"""LocalMiniDrama 开放平台 API —— 异常类型定义（Sprint 15: S15-T04）。"""

from __future__ import annotations


class OpenApiError(Exception):
    """开放平台 API 通用错误。

    Attributes:
        status: HTTP 状态码
        code:   业务错误码（如 RATE_LIMITED / INVALID_API_KEY / SCOPE_NOT_ALLOWED）
    """

    def __init__(self, status: int, code: str, message: str):
        super().__init__("[{}] {}: {}".format(status, code, message))
        self.status = status
        self.code = code
        self.message = message


class OpenApiRateLimitError(OpenApiError):
    """请求被限流或超出配额（HTTP 429）。"""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(status, code, message)
        self.retry_after = None


class OpenApiPermissionError(OpenApiError):
    """权限范围不足或 IP 不在白名单（HTTP 403）。"""
