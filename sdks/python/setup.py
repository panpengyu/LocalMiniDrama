# -*- coding: utf-8 -*-
"""LocalMiniDrama 开放平台 API —— Python SDK 打包脚本（Sprint 15: S15-T04）。"""

from setuptools import find_packages, setup

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="localmini-openapi",
    version="1.0.0",
    description="LocalMiniDrama 开放平台 API 的 Python SDK（短剧创作平台开放接口）",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="LocalMiniDrama Team",
    license="MIT",
    packages=find_packages(exclude=["tests", "tests.*"]),
    python_requires=">=3.8",
    install_requires=[],
    classifiers=[
        "Programming Language :: Python :: 3",
        "Operating System :: OS Independent",
        "Topic :: Software Development :: Libraries :: Python Modules",
    ],
)
