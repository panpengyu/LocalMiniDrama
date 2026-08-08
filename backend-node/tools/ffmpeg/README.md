# FFmpeg 本地目录

将 ffmpeg 可执行文件放在此目录下，后端会优先使用，**无需配置环境变量**。

## 需要拷贝的文件

- `ffmpeg`（macOS/Linux）或 `ffmpeg.exe`（Windows）
- `ffprobe`（若需要探测时长等信息）

从 FFmpeg 官方构建目录的 `bin` 下复制到本目录即可。

## 路径优先级

1. 环境变量 `FFMPEG_PATH` / `FFPROBE_PATH`（若已设置）
2. 本目录下的 `ffmpeg`（或 Windows 下 `ffmpeg.exe`）
3. 系统 PATH 中的 `ffmpeg`（BS 部署推荐方式：`brew install ffmpeg` 或 `apt install ffmpeg`）
