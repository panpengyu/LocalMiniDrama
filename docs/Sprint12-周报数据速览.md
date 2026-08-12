# Sprint 12 周报数据速览

> 数据来源：`docs/Sprint12-交付清单与测试报告.md`
> 生成日期：2026-08-12
> 主数据库：本地真实 MySQL 8（`localminidrama`）

## Sprint 12 交付数据

| 指标 | 数值 |
|------|------|
| Sprint 主题 | 素材管理 + 对象存储 + 后台深度运营（M3 里程碑） |
| 任务完成 | 8 / 8（全部验收通过） |
| 单元测试 - 素材/存储 | s12MaterialStorage.test.js：20 项全绿 |
| 单元测试 - 运营服务 | s12OpsServices.test.js：17 项全绿 |
| S12 新增单测合计 | 39 项 |
| 全量回归 | 572 tests / 572 pass / 0 fail（通过率 100%） |
| 回归对比 | Sprint 11 的 533 → 572（+39） |
| 欠费闭环端到端验证 | 5 / 5 全绿（识别→通知→幂等→限权→不误伤） |
| 附带修复 | libraryDedup 跨库兼容缺陷（569→572 全绿） |
| 测试数据 | 全部落地本地真实 MySQL（无 mock），用后即清 |

## 本周额外交付（SQLite 兼容加固 R1/R2）

| 指标 | 数值 |
|------|------|
| 修复模块 | settingsService（global/user 设置）、promptOverridesService |
| 修复内容 | UPSERT 增加 SQLite `ON CONFLICT` 分支，MySQL 行为不变 |
| 附带 | 补建缺失的 `global_settings` 表（迁移 48） |
| 双库验证 | MySQL 12 + SQLite 12 = 24 / 24 全绿 |
| 回归 | 572 / 572 全绿（MySQL 主库零回归） |
