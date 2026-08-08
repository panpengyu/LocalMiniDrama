# 异常告警定时扫描部署文档

> 模块：数据异常检测 → 告警通知
> 适用版本：backend-node v1.2.8+
> 最后更新：2026-08-08

## 一、功能概述

通过 crontab 定时任务，每 5 分钟自动扫描数据库中的数据异常（负余额、余额不一致、超大单笔等），并按已激活的告警渠道（钉钉/企业微信/飞书）发送告警消息。

### 核心组件

| 组件 | 路径 | 说明 |
|------|------|------|
| 扫描脚本 | `scripts/alert-scan.js` | Node.js 脚本，调用 `alertService.scanAndAlert` |
| 部署脚本 | `scripts/crontab-alert-scan.sh` | crontab 安装/卸载/状态查看 |
| 告警服务 | `src/services/alertService.js` | 核心逻辑：扫描异常 + 限流 + 发送 |
| npm 命令 | `package.json` | `alert:scan` / `alert:cron:*` |
| 数据库表 | `anomaly_alert_channels` / `anomaly_alert_events` | 渠道配置 + 发送历史 |

## 二、前置条件检查

### 2.1 数据库连接

```bash
# 验证 MySQL 连接（配置见 configs/config.yaml）
mysql -h localhost -P 3306 -u root -proot localminidrama -e "SELECT 1;"
```

预期配置（`configs/config.yaml`）：

```yaml
database:
  type: mysql
  host: localhost
  port: 3306
  user: root
  password: root
  database: localminidrama
```

### 2.2 告警表是否存在

```bash
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
  SHOW TABLES LIKE 'anomaly_alert_%';
"
```

预期输出包含 `anomaly_alert_channels` 和 `anomaly_alert_events`。
若不存在，执行迁移：`npm run migrate`。

### 2.3 日志目录可写

```bash
ls -ld data/
# 预期：drwxr-xr-x 且所有者为当前用户
touch data/.write_test && rm data/.write_test && echo "可写"
```

### 2.4 告警渠道状态确认

```bash
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
SELECT id, name, channel_type, enabled, severity_mask, type_mask, rate_limit_minutes
FROM anomaly_alert_channels ORDER BY id;
"
```

**关键检查项：**
- `enabled=1` 的渠道会在扫描时**真实发送消息**，部署前确认 webhook 地址有效
- `rate_limit_minutes=0` 表示不限流，异常多时会产生大量发送请求
- 确认 `severity_mask` 和 `type_mask` 订阅范围符合预期

## 三、部署执行步骤

### 步骤 1：停用告警渠道（避免首次扫描误发）

```bash
cd backend-node

# 停用所有渠道（首次验证用）
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=0;
"

# 或仅停用指定渠道
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=0 WHERE id=3;
"
```

### 步骤 2：手动执行一次扫描验证

```bash
npm run alert:scan
```

**预期输出：**

```
MySQL connected successfully
[alert-scan] 开始扫描 (overrides={})
[alert-scan] 扫描完成：耗时=XXXms, 发现异常=N, 发送=0（成功=0 失败=0 跳过=0）
{"timestamp":"...","elapsed_ms":XXX,"scanned":N,"dispatched":0,"ok":0,"failed":0,"skipped":0}
```

验证点：
- ✅ 退出码为 0
- ✅ `MySQL connected successfully`
- ✅ `发送=0`（渠道已停用，不会发消息）
- ✅ `发现异常=N`（确认扫描逻辑生效）

### 步骤 3：安装 crontab 定时任务

```bash
# 默认每 5 分钟扫描一次
npm run alert:cron:install

# 或自定义间隔（如每 10 分钟）
ALERT_SCAN_INTERVAL=10 npm run alert:cron:install
```

**预期输出：**

```
✅ 告警扫描定时任务已安装
   间隔：每 5 分钟（分钟字段：0,5,10,15,20,25,30,35,40,45,50,55）
   命令：cd /path/to/backend-node && npm run alert:scan
   日志：/path/to/backend-node/data/alert-scan.log
```

### 步骤 4：验证 crontab 已注册

```bash
npm run alert:cron:status
# 或直接查看
crontab -l | grep alert-scan
```

### 步骤 5：恢复告警渠道

确认扫描无误后，恢复需要生效的渠道：

```bash
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=1 WHERE id=3;
"
```

### 步骤 6：等待并检查定时执行结果

```bash
# 等待 5 分钟后查看日志
tail -n 50 data/alert-scan.log

# 查看最新告警事件
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
SELECT id, channel_id, anomaly_type, severity, status, LEFT(summary,40) AS summary, created_at
FROM anomaly_alert_events ORDER BY id DESC LIMIT 10;
"
```

## 四、环境变量配置（可选）

在 crontab 或启动环境中设置以下变量自定义扫描行为：

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `ANOMALY_DEFAULT_AMOUNT_TH` | 单笔积分超大阈值 | 代码内置（如 200000000） |
| `ANOMALY_DEFAULT_BALANCE_TH` | 余额异常阈值 | 代码内置 |
| `ANOMALY_LOG_LEVEL` | 日志级别（`debug` 输出详细日志） | `info` |

示例（修改 crontab 行追加环境变量）：

```cron
0,5,10,15,20,25,30,35,40,45,50,55 * * * * cd /path/to/backend-node \
  && ANOMALY_DEFAULT_AMOUNT_TH=50000000 npm run alert:scan >> data/alert-scan.log 2>&1
```

## 五、回滚方案

### 5.1 完全卸载定时任务

```bash
cd backend-node
npm run alert:cron:uninstall
```

验证：

```bash
npm run alert:cron:status
# 预期：状态：未安装 ❌
crontab -l | grep alert-scan
# 预期：无输出
```

### 5.2 临时停用所有告警渠道（保留 crontab）

```bash
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=0;
SELECT id, name, enabled FROM anomaly_alert_channels;
"
```

此方式 crontab 仍会每 5 分钟扫描，但因无激活渠道，`发送=0`，不会产生告警事件。

### 5.3 恢复渠道

```bash
# 恢复指定渠道
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=1 WHERE id=3;
"

# 恢复全部渠道
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
UPDATE anomaly_alert_channels SET enabled=1;
"
```

### 5.4 清理告警历史事件（可选）

```bash
# 清理失败事件
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
DELETE FROM anomaly_alert_events WHERE status='failed';
"

# 清空全部历史
mysql -h localhost -P 3306 -u root -proot localminidrama -e "
TRUNCATE TABLE anomaly_alert_events;
"
```

## 六、常用运维命令速查

| 操作 | 命令 |
|------|------|
| 立即扫描一次 | `npm run alert:scan` |
| debug 模式扫描 | `npm run alert:scan:verbose` |
| 安装定时任务 | `npm run alert:cron:install` |
| 卸载定时任务 | `npm run alert:cron:uninstall` |
| 查看任务状态 | `npm run alert:cron:status` |
| 查看扫描日志 | `tail -f data/alert-scan.log` |
| 查看告警渠道 | 见 2.4 节 SQL |
| 查看告警历史 | 见步骤 6 SQL |

## 七、故障排查

### 7.1 扫描脚本报 `表不存在`

```
Error: anomaly_alert_channels / events 表不存在，请先跑 migration
```

解决：`npm run migrate`，确认 `anomaly_alert_%` 表已创建。

### 7.2 crontab 不执行

排查：
1. `crontab -l` 确认任务已注册
2. 检查 cron 服务：`sudo launchctl list | grep cron`（macOS）
3. 检查日志目录权限：`ls -ld data/`
4. 查看日志：`cat data/alert-scan.log`

### 7.3 告警发送失败（errcode:93000 等）

企业微信 `errcode:93000` 通常原因：
- webhook key 已失效 → 重新获取机器人 webhook 地址
- IP 未加白名单 → 在企业微信后台添加服务器 IP
- 频率超限 → 调大 `rate_limit_minutes`

### 7.4 扫描发现异常但未发送

检查：
1. 是否有 `enabled=1` 的渠道
2. 渠道 `severity_mask` 是否包含异常的 severity 位（1/2/4）
3. 渠道 `type_mask` 是否包含该异常类型（或为 `*`）
4. 是否被限流（同指纹在 `rate_limit_minutes` 内已发过）

## 八、验证记录

| 日期 | 操作 | 结果 |
|------|------|------|
| 2026-08-08 | 停用渠道后执行 `npm run alert:scan` | ✅ 耗时 123ms，发现异常 5，发送 0，退出码 0 |
| 2026-08-08 | 告警事件总数核查 | ✅ 维持 4 条，无新增（渠道停用生效） |
| 2026-08-08 | 渠道 ID=3 状态恢复 | ✅ enabled=1 已恢复 |
