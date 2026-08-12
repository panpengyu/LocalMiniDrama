-- ============================================================
-- Sprint 11: 团队协作 + 版本管理
-- Migration 44
--
-- 说明：
--   S11-T02 协作权限管理  → collaboration_members  项目协作成员 + 角色分工(编剧/美术/剪辑/审核)
--   S11-T04 操作锁定       → node_locks             画布节点级编辑锁(乐观锁+过期时间)
--   S11-T06 版本快照系统  → canvas_versions        画布保存自动创建的 JSON 版本快照(支持列表/对比/回退)
--   S11-T05 协作通知系统  → collaboration_notifications 成员加入/修改/评论 通知
--   S11-T08 协作记录审计  → collaboration_activities    每个成员的操作历史(按时间/成员/操作类型查询)
--
-- 兼容性：
--   - 全部为新增独立表，不改动既有表结构，旧数据不受影响
--   - 采用 CREATE TABLE IF NOT EXISTS，重复执行幂等
-- ============================================================

-- ------------------------------------------------------------
-- 1) 协作成员表（S11-T02）
--    role_tag: 协作角色分工 owner(所有者) / screenwriter(编剧) / artist(美术) / editor(剪辑) / reviewer(审核) / viewer(只读)
--    status:   active(生效) / removed(已移除)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collaboration_members (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id      BIGINT      NOT NULL COMMENT '项目(剧本)ID',
  user_id       BIGINT      NOT NULL COMMENT '协作用户ID',
  role_tag      VARCHAR(20) NOT NULL DEFAULT 'viewer' COMMENT '协作角色: owner/screenwriter/artist/editor/reviewer/viewer',
  invited_by    BIGINT      NULL COMMENT '邀请人用户ID',
  status        VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active/removed',
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_drama_user (drama_id, user_id),
  KEY idx_drama (drama_id),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S11-T02 项目协作成员与角色分工';

-- ------------------------------------------------------------
-- 2) 画布节点锁表（S11-T04）
--    node_key: 画布内节点唯一标识(如 character:12 / storyboard:88 / scene:5)
--    一个节点同一时刻至多一个持有者，通过 UNIQUE(drama_id, node_key) 实现互斥
--    expires_at: 锁自动过期时间(心跳续约)，防止持有者掉线导致死锁
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_locks (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id      BIGINT      NOT NULL COMMENT '项目ID',
  node_key      VARCHAR(128) NOT NULL COMMENT '节点唯一键: type:id',
  locked_by     BIGINT      NOT NULL COMMENT '持锁用户ID',
  locked_by_name VARCHAR(128) NULL COMMENT '持锁用户名(冗余展示)',
  socket_id     VARCHAR(64) NULL COMMENT '持锁的 socket 连接ID',
  version       BIGINT      NOT NULL DEFAULT 0 COMMENT 'CRDT/乐观锁逻辑版本号',
  acquired_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME    NOT NULL COMMENT '锁过期时间(心跳续约)',
  UNIQUE KEY uk_drama_node (drama_id, node_key),
  KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S11-T04 画布节点级编辑锁';

-- ------------------------------------------------------------
-- 3) 画布版本快照表（S11-T06）
--    snapshot: 保存时刻的完整画布布局 JSON(节点/连线/视图/3D 等)
--    version_no: 项目内自增版本号(1,2,3...)，便于列表与对比
--    change_summary: 变更摘要(如"新增3个节点，删除1条连线")
--    parent_version: 派生自哪个版本(支持分支/回退溯源)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canvas_versions (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id       BIGINT      NOT NULL COMMENT '项目ID',
  version_no     INT         NOT NULL COMMENT '项目内版本序号',
  snapshot       LONGTEXT    NOT NULL COMMENT '画布布局完整快照(JSON字符串)',
  node_count     INT         NOT NULL DEFAULT 0 COMMENT '快照节点数(便于摘要)',
  edge_count     INT         NOT NULL DEFAULT 0 COMMENT '快照连线数',
  change_summary VARCHAR(500) NULL COMMENT '变更摘要',
  operator_id    BIGINT      NULL COMMENT '操作者用户ID',
  operator_name  VARCHAR(128) NULL COMMENT '操作者用户名(冗余展示)',
  source         VARCHAR(20) NOT NULL DEFAULT 'save' COMMENT '来源: save(保存)/rollback(回退)/manual(手动)',
  parent_version INT         NULL COMMENT '派生自的版本序号(回退/分支溯源)',
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_drama_version (drama_id, version_no),
  KEY idx_drama_created (drama_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S11-T06 画布版本快照';

-- ------------------------------------------------------------
-- 4) 协作通知表（S11-T05）
--    type: member_join(成员加入) / node_change(节点修改) / comment(评论) / lock(锁定) / version(版本)
--    is_read: 0未读 1已读
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collaboration_notifications (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id      BIGINT      NOT NULL COMMENT '项目ID',
  recipient_id  BIGINT      NOT NULL COMMENT '接收者用户ID',
  actor_id      BIGINT      NULL COMMENT '触发者用户ID',
  actor_name    VARCHAR(128) NULL COMMENT '触发者用户名(冗余展示)',
  type          VARCHAR(24) NOT NULL DEFAULT 'node_change' COMMENT 'member_join/node_change/comment/lock/version',
  title         VARCHAR(200) NULL COMMENT '通知标题',
  content       VARCHAR(1000) NULL COMMENT '通知内容',
  payload       TEXT        NULL COMMENT '结构化附加数据(JSON)',
  is_read       TINYINT     NOT NULL DEFAULT 0 COMMENT '0未读 1已读',
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recipient_read (recipient_id, is_read),
  KEY idx_drama (drama_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S11-T05 协作通知';

-- ------------------------------------------------------------
-- 5) 协作操作审计表（S11-T08）
--    action_type: node_create/node_update/node_delete/node_move/edge_create/edge_delete/lock/unlock/version_save/version_rollback/member_join/member_remove/comment
--    target_key:  操作对象节点键(可空，如成员操作)
--    detail:      结构化细节(JSON)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collaboration_activities (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  drama_id      BIGINT      NOT NULL COMMENT '项目ID',
  user_id       BIGINT      NOT NULL COMMENT '操作者用户ID',
  user_name     VARCHAR(128) NULL COMMENT '操作者用户名(冗余展示)',
  action_type   VARCHAR(32) NOT NULL COMMENT '操作类型',
  target_key    VARCHAR(128) NULL COMMENT '操作对象节点键',
  detail        TEXT        NULL COMMENT '操作细节(JSON)',
  socket_id     VARCHAR(64) NULL COMMENT '来源 socket 连接ID',
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_drama_created (drama_id, created_at),
  KEY idx_user (user_id),
  KEY idx_action (action_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='S11-T08 协作操作审计';
