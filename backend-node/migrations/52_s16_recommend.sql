-- ============================================================
-- Sprint 16: 素材推荐引擎 + 全平台优化 + 正式商用
-- Migration 52
--
-- 对应任务：
--   S16-T01 素材推荐引擎   → recommend_logs(推荐展示/反馈留痕) + user_preference_profiles(用户偏好画像)
--   S16-T02 全链路性能压测 → perf_test_results(压测结果持久化)
--   S16-T03 安全渗透测试   → security_scan_results(扫描结果持久化)
--   S16-T05 监控告警全覆盖 → frontend_error_logs(前端错误上报)
--   S16-T06 用户文档与帮助中心 → help_docs(帮助文档, 含种子数据)
--
-- 兼容性：全部 CREATE TABLE IF NOT EXISTS 幂等；MySQL 引擎。
-- ============================================================

-- ------------------------------------------------------------
-- S16-T01 推荐行为留痕表
--   item_type: material(素材) / template(模板)
--   dimension: character(角色) / scene(场景) / prop(道具) / template(模板)
--   action:    impression(曝光) / click(点击) / collect(收藏) / apply(采纳使用)
--   source:    personalized(个性化) / trending(热门) / cold_start(冷启动)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommend_logs (
  id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT      NOT NULL COMMENT '用户ID',
  item_type  VARCHAR(16) NOT NULL COMMENT 'material/template',
  dimension  VARCHAR(16) NOT NULL COMMENT 'character/scene/prop/template',
  item_id    BIGINT      NOT NULL COMMENT '素材/模板ID',
  action     VARCHAR(16) NOT NULL DEFAULT 'impression' COMMENT 'impression/click/collect/apply',
  source     VARCHAR(16) NOT NULL DEFAULT 'personalized' COMMENT 'personalized/trending/cold_start',
  score      FLOAT       NULL COMMENT '推荐分(0~1)',
  rank_pos   INT         NULL COMMENT '推荐位次(rank为保留字故用rank_pos)',
  meta       TEXT        NULL COMMENT '附加信息(JSON)',
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_time (user_id, created_at),
  KEY idx_item (item_type, item_id),
  KEY idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T01 推荐曝光与反馈留痕';

-- ------------------------------------------------------------
-- S16-T01 用户偏好画像(增量快照)
--   genre_weights:  题材偏好权重 JSON {genre: 累计权重}
--   style_weights:  风格偏好权重 JSON {style: 累计权重}
--   tag_weights:    素材标签偏好权重 JSON {tag_id: 累计权重}
--   material_dims:  素材维度活跃度 JSON {character: n, scene: n, prop: n}
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_preference_profiles (
  user_id       BIGINT   NOT NULL PRIMARY KEY COMMENT '用户ID',
  genre_weights TEXT     NULL COMMENT '题材偏好权重 JSON',
  style_weights TEXT     NULL COMMENT '风格偏好权重 JSON',
  tag_weights   TEXT     NULL COMMENT '素材标签偏好权重 JSON',
  material_dims TEXT     NULL COMMENT '素材维度活跃度 JSON',
  total_actions INT      NOT NULL DEFAULT 0 COMMENT '参与计算的累计行为数',
  computed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '画像计算时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T01 用户偏好画像';

-- ------------------------------------------------------------
-- S16-T02 性能压测结果持久化
--   场景:      health/login/dramas/materials/templates/recommend/...
--   并发/时长: 压测参数
--   p50/p90/p95/p99: 延迟百分位(ms)
--   qps/error_rate: 吞吐与错误率
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perf_test_results (
  id              BIGINT      AUTO_INCREMENT PRIMARY KEY,
  scenario        VARCHAR(64) NOT NULL COMMENT '压测场景',
  method          VARCHAR(8)  NULL COMMENT 'HTTP方法',
  path            VARCHAR(255) NULL COMMENT '请求路径',
  concurrency     INT         NOT NULL DEFAULT 0 COMMENT '并发数',
  duration_ms     INT         NOT NULL DEFAULT 0 COMMENT '压测时长ms',
  total_requests  INT         NOT NULL DEFAULT 0 COMMENT '总请求数',
  success_count   INT         NOT NULL DEFAULT 0 COMMENT '成功数',
  fail_count      INT         NOT NULL DEFAULT 0 COMMENT '失败数',
  qps             FLOAT       NOT NULL DEFAULT 0 COMMENT '吞吐(请求/秒)',
  p50_ms          FLOAT       NOT NULL DEFAULT 0 COMMENT 'P50延迟ms',
  p90_ms          FLOAT       NOT NULL DEFAULT 0 COMMENT 'P90延迟ms',
  p95_ms          FLOAT       NOT NULL DEFAULT 0 COMMENT 'P95延迟ms',
  p99_ms          FLOAT       NOT NULL DEFAULT 0 COMMENT 'P99延迟ms',
  error_rate      FLOAT       NOT NULL DEFAULT 0 COMMENT '错误率',
  env             VARCHAR(64) NULL COMMENT '运行环境标识(host/pid)',
  started_at      DATETIME    NULL COMMENT '开始时间',
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_scenario (scenario),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T02 性能压测结果';

-- ------------------------------------------------------------
-- S16-T03 安全渗透扫描结果持久化
--   category:   security_headers/sql_injection/xss/path_traversal/ssrf/auth/access_control/sensitive_info/rate_limit
--   severity:   critical/high/medium/low/info/pass
--   status:     pass(通过) / fail(发现) / error(执行异常)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_scan_results (
  id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
  scan_id    VARCHAR(64) NOT NULL COMMENT '扫描批次ID',
  category   VARCHAR(32) NOT NULL COMMENT 'OWASP类别',
  name       VARCHAR(128) NOT NULL COMMENT '检查项名称',
  status     VARCHAR(12) NOT NULL DEFAULT 'pass' COMMENT 'pass/fail/error',
  severity   VARCHAR(12) NOT NULL DEFAULT 'info' COMMENT 'critical/high/medium/low/info',
  detail     TEXT        NULL COMMENT '详情/证据',
  fix        TEXT        NULL COMMENT '修复建议',
  checked_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_scan (scan_id),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T03 安全扫描结果';

-- ------------------------------------------------------------
-- S16-T05 前端错误上报
--   level:     error/warning/info
--   category:  js_error/unhandledrejection/resource_error/route_error/api_error
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frontend_error_logs (
  id          BIGINT      AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT      NULL COMMENT '用户ID(已登录)',
  level       VARCHAR(12) NOT NULL DEFAULT 'error' COMMENT 'error/warning/info',
  category    VARCHAR(32) NOT NULL DEFAULT 'js_error' COMMENT '错误类别',
  message     VARCHAR(1024) NULL COMMENT '错误消息',
  source      VARCHAR(255) NULL COMMENT '来源文件/URL',
  lineno      INT         NULL COMMENT '行号',
  colno       INT         NULL COMMENT '列号',
  stack       TEXT        NULL COMMENT '堆栈',
  page_url    VARCHAR(512) NULL COMMENT '页面URL',
  user_agent  VARCHAR(255) NULL COMMENT 'UA',
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  KEY idx_category (category),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T05 前端错误上报';

-- ------------------------------------------------------------
-- S16-T06 帮助文档表(帮助中心)
--   category: manual(使用手册)/faq(常见问题)/video(视频教程)/best_practice(最佳实践)
--   doc_key:  唯一标识(如 manual-quickstart / faq-quota)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_docs (
  id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
  category    VARCHAR(32)  NOT NULL COMMENT 'manual/faq/video/best_practice',
  doc_key     VARCHAR(64)  NOT NULL COMMENT '唯一标识',
  title       VARCHAR(255) NOT NULL COMMENT '标题',
  summary     VARCHAR(512) NULL COMMENT '摘要',
  content     LONGTEXT     NULL COMMENT '正文(Markdown/富文本)',
  sort_order  INT          NOT NULL DEFAULT 0 COMMENT '排序',
  is_published TINYINT     NOT NULL DEFAULT 1 COMMENT '0草稿 1发布',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_doc_key (doc_key),
  KEY idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S16-T06 帮助文档';

-- ------------------------------------------------------------
-- S16-T06 帮助文档种子数据(真实内容, 幂等 INSERT)
-- ------------------------------------------------------------
INSERT INTO help_docs (category, doc_key, title, summary, content, sort_order) VALUES
('manual','manual-quickstart','快速开始','注册账号、创建第一个项目到出片的全流程导览','## 快速开始\n\n欢迎使用本地短剧助手。本手册带你完成第一次创作：\n\n1. **注册与登录**：访问平台首页，注册账号并完成登录。\n2. **创建项目**：点击「新建剧本」，填写标题、题材与风格，系统将生成项目骨架。\n3. **完善剧本**：使用 AI 编剧助手生成故事大纲、角色设定、分集剧本。\n4. **生成画面**：在分镜画布中为每镜生成图像与视频。\n5. **合成出片**：一键合成剧集视频并导出。\n\n> 提示：首次创作建议使用「示例剧本」体验完整流程。',1),
('manual','manual-storyboard','分镜画布使用指南','画布节点编辑、连线、批量生成与性能模式','## 分镜画布使用指南\n\n分镜画布是核心创作界面：\n\n- **节点**：每镜一个节点，可编辑画面描述、运镜与提示词。\n- **连线**：拖拽连线表达镜头顺序。\n- **批量生成**：选中多镜可批量生成图像。\n- **性能模式**：节点超过 500 时建议开启，提升 60fps 流畅度。',2),
('manual','manual-materials','素材库与模板使用','三级素材库、素材标签与模板市场','## 素材库与模板使用\n\n- **三级素材库**：角色库/场景库/道具库，支持标签筛选与一键引用。\n- **模板市场**：精选开播模板，一键应用即可创建完整项目。\n- **推荐引擎**：首页与素材页提供「为你推荐」，基于创作历史智能匹配。',3),
('faq','faq-quota','会员与配额常见问题','积分、配额、升级与退订','## 会员与配额常见问题\n\n- **问：积分如何获得？**\n  答：通过充值或开通会员获得，具体规则见会员中心。\n- **问：生成次数配额用完了怎么办？**\n  答：可升级会员等级提升配额，或在配额中心购买额外次数。\n- **问：余额为负会怎样？**\n  答：欠费后创作类接口将暂停，充值后自动恢复。',10),
('faq','faq-ai','AI 生成常见问题','生成失败、模型配置与效果优化','## AI 生成常见问题\n\n- **问：生成失败如何排查？**\n  答：检查「AI 配置」页的模型密钥与余额，再重试。\n- **问：如何提升画面一致性？**\n  答：在角色卡启用一致性锚点（SD2），并保持提示词描述统一。\n- **问：视频生成太慢？**\n  答：高峰期队列排队属正常，可错峰提交或升级会员插队。',11),
('faq','faq-account','账号与安全常见问题','登录、密码、多端会话','## 账号与安全常见问题\n\n- **问：忘记密码怎么办？**\n  答：使用登录页「忘记密码」找回。\n- **问：如何退出其他设备会话？**\n  答：在账号设置中可下线全部会话。\n- **问：账号被盗怎么办？**\n  答：立即修改密码并联系客服冻结账号。',12),
('video','video-quickstart','新手入门视频教程','5 分钟快速上手','### 新手入门\n\n视频教程地址见帮助中心「视频教程」分类（即将上线）。内容涵盖注册、建项、出片全流程。',20),
('video','video-advanced','进阶创作视频教程','一致性、批量生成与团队协作','### 进阶创作\n\n视频教程地址见帮助中心「视频教程」分类（即将上线）。内容涵盖角色一致性、批量出图、团队协作与版本管理。',21),
('best_practice','bp-style','画面一致性最佳实践','如何保持角色/场景跨镜一致','## 画面一致性最佳实践\n\n1. 为每个角色建立「角色卡」，固定外貌描述。\n2. 开启 SD2 一致性锚点并上传参考图。\n3. 场景提示词复用统一描述模板。\n4. 批量生成前先验证单镜效果再铺开。',30),
('best_practice','bp-queue','高峰期高效出片最佳实践','队列调度与错峰策略','## 高峰期高效出片最佳实践\n\n- 预览阶段使用低分辨率快速验证。\n- 大批量生成安排在非高峰时段。\n- 拆分大任务为小批量提交，便于跟踪失败项。',31),
('best_practice','bp-api','开放平台接入最佳实践','API Key、限流与配额管理','## 开放平台接入最佳实践\n\n- 在「开发者控制台」申请应用并等待审批。\n- 密钥只在前端代码之外使用，务必用服务端中转。\n- 关注每日配额与限流，预留重试与退避策略。\n- 通过控制台监控调用量与错误日志。',32)
ON DUPLICATE KEY UPDATE title=VALUES(title), summary=VALUES(summary), content=VALUES(content), sort_order=VALUES(sort_order);
