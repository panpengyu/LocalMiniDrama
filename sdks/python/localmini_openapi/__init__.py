# -*- coding: utf-8 -*-
"""LocalMiniDrama 开放平台 API 的 Python SDK（Sprint 15: S15-T04）。"""

from .client import OpenApiClient
from .errors import OpenApiError, OpenApiRateLimitError, OpenApiPermissionError

__all__ = ["OpenApiClient", "OpenApiError", "OpenApiRateLimitError", "OpenApiPermissionError"]

__version__ = "1.0.0"
