/**
 * 管理员路由模块
 *
 * 提供超级管理员专属的后台管理功能，包括用户管理、企业管理、团队管理和运营概览统计。
 * 所有接口均需 super_admin 角色权限验证。
 *
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 管理员路由处理函数集合
 */
const response = require('../response');
const alertService = require('../services/alertService');

/**
 * 生成一个"最近7天"内，按业务类型和消费/充值分类的演示数据。
 * 仅在 point_logs / recharges 为空时执行一次，保证 Dashboard 首屏有可视化数据。
 */
const DEFAULT_CHANNELS_SEED = [
  ['ORG_001', '自然注册-官网首页', 'organic'],
  ['ORG_002', '自然注册-登录页分享链', 'organic'],
  ['ORG_003', '自然注册-公众号关注', 'organic'],
  ['ORG_004', '自然注册-邮件邀请', 'organic'],
  ['ORG_005', '自然注册-社群', 'organic'],
  ['PAID_001', '信息流-抖音', 'paid'],
  ['PAID_002', '信息流-快手', 'paid'],
  ['PAID_003', '信息流-小红书', 'paid'],
  ['PAID_004', '信息流-B站', 'paid'],
  ['PAID_005', '信息流-微信视频号', 'paid'],
  ['PAID_006', '搜索SEM-百度', 'paid'],
  ['PAID_007', '搜索SEM-谷歌', 'paid'],
  ['PAID_008', '搜索SEM-搜狗', 'paid'],
  ['PAID_009', '搜索SEM-360', 'paid'],
  ['PAID_010', '应用商店-应用宝', 'paid'],
  ['PAID_011', '应用商店-华为', 'paid'],
  ['PAID_012', '应用商店-小米', 'paid'],
  ['PAID_013', '应用商店-OPPO', 'paid'],
  ['PAID_014', '应用商店-VIVO', 'paid'],
  ['PAID_015', '应用商店-AppStore', 'paid'],
  ['PAID_016', '联盟CPS-短剧站A', 'paid'],
  ['PAID_017', '联盟CPS-短剧站B', 'paid'],
  ['PAID_018', '联盟CPS-小说站', 'paid'],
  ['PART_001', '合作伙伴-AIGC导航站', 'partner'],
  ['PART_002', '合作伙伴-极客公园', 'partner'],
  ['PART_003', '合作伙伴-36氪', 'partner'],
  ['PART_004', '合作伙伴-少数派', 'partner'],
  ['PART_005', '合作伙伴-开源中国', 'partner'],
  ['PART_006', '合作伙伴-InfoQ', 'partner'],
  ['PART_007', '合作伙伴-掘金', 'partner'],
  ['INV_001', '用户邀请-一级', 'invite'],
  ['INV_002', '用户邀请-二级', 'invite'],
  ['INV_003', '企业邀请码', 'invite'],
  ['INV_004', 'KOL专属邀请', 'invite'],
  ['INV_005', '教育合作邀请', 'invite'],
  ['INV_006', '政府项目邀请', 'invite']
];

function ensureDashboardDemoData(database) {
  try {
    // --- 渠道表补种子（如果迁移的多行 INSERT 被 SQL 解析跳过）---
    const channelsCount = database.prepare('SELECT COUNT(*) as c FROM channels').get().c;
    if (channelsCount === 0) {
      const insertSql = database.type === 'mysql'
        ? 'INSERT IGNORE INTO channels (code, name, type, status, created_at, updated_at) VALUES (?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'
        : 'INSERT OR IGNORE INTO channels (code, name, type, status, created_at, updated_at) VALUES (?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)';
      const insertChannel = database.prepare(insertSql);
      const tx = database.transaction(() => {
        DEFAULT_CHANNELS_SEED.forEach((c) => insertChannel.run(c[0], c[1], c[2]));
      });
      tx();
      console.log('[admin] Channels seeded via JS fallback:', DEFAULT_CHANNELS_SEED.length, 'dialect=', database.type);
    }

    const logsCount = database.prepare('SELECT COUNT(*) as c FROM point_logs').get().c;
    const rechargesCount = database.prepare('SELECT COUNT(*) as c FROM recharges').get().c;
    if (logsCount > 0 && rechargesCount > 0) return;

    const nowTs = Date.now();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const dayMs = 24 * 3600 * 1000;
    const users = database.prepare('SELECT id FROM users WHERE status = 1 LIMIT 20').all();
    const userIds = users.length ? users.map((u) => u.id) : [1, 2];

    // --- 近 7 天：消费积分（按业务分类）+ 充值积分 + 订单 ---
    // 每天的"消费"数据（按 image / video / text / audio / other 加权随机分配）
    const consumeByBusinessTemplate = [
      { business_type: 'image', weight: 38, perDayRange: [12000, 28000] },
      { business_type: 'video', weight: 27, perDayRange: [8000, 22000] },
      { business_type: 'text', weight: 18, perDayRange: [6000, 14000] },
      { business_type: 'audio', weight: 11, perDayRange: [3000, 9000] },
      { business_type: 'other', weight: 6, perDayRange: [1500, 4500] }
    ];
    // 每天的"充值"总积分 + 对应订单金额（大约 100 积分 = 1 元）
    const rechargePerDayRange = [28000, 78000];

    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const insertLog = database.prepare(
      'INSERT INTO point_logs (user_id, change_type, business_type, amount, balance_after, related_id, remark, created_at) VALUES (?,?,?,?,?,?,?,?)'
    );
    const insertRecharge = database.prepare(
      'INSERT INTO recharges (order_no, user_id, amount, points, pay_method, pay_status, paid_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    );

    let runningBalance = 500000;

    const tx = database.transaction(() => {
      for (let i = 6; i >= 0; i--) {
        const dayTs = new Date(nowTs - i * dayMs);
        const ymd = `${dayTs.getFullYear()}-${pad(dayTs.getMonth() + 1)}-${pad(dayTs.getDate())}`;

        // 当天多笔消费流水
        consumeByBusinessTemplate.forEach((seg) => {
          const dailyTotal = rand(seg.perDayRange[0], seg.perDayRange[1]);
          // 分成 2~4 笔
          const splitCount = rand(2, 4);
          let remain = dailyTotal;
          for (let k = 1; k <= splitCount; k++) {
            const hour = rand(0, 23);
            const minute = rand(0, 59);
            const ts = new Date(`${ymd} ${pad(hour)}:${pad(minute)}:00`).toISOString().replace('T', ' ').slice(0, 19);
            const amount = k === splitCount ? remain : Math.floor(remain * rand(25, 60) / 100) || 1;
            remain -= amount;
            runningBalance = Math.max(0, runningBalance - amount);
            const related = `${seg.business_type.toUpperCase()}_${dayTs.getTime()}_${k}`;
            insertLog.run(
              pick(userIds),
              'consume',
              seg.business_type,
              -amount,
              runningBalance,
              related,
              `自动生成-${seg.business_type}-${ymd}`,
              ts
            );
          }
        });

        // 当天充值
        const rechargePoints = rand(rechargePerDayRange[0], rechargePerDayRange[1]);
        const amountYuan = +(rechargePoints / 100).toFixed(2);
        runningBalance += rechargePoints;
        const paidHour = rand(9, 21);
        const paidTs = new Date(`${ymd} ${pad(paidHour)}:${pad(rand(0, 59))}:00`)
          .toISOString()
          .replace('T', ' ')
          .slice(0, 19);
        const orderNo = `RC${dayTs.getFullYear()}${pad(dayTs.getMonth() + 1)}${pad(dayTs.getDate())}${String(rand(100000, 999999))}`;
        const payMethods = ['wechat', 'alipay', 'manual'];
        const pm = payMethods[rand(0, 2)];
        const uid = pick(userIds);
        insertRecharge.run(orderNo, uid, amountYuan, rechargePoints, pm, 'paid', paidTs, paidTs, paidTs);
        // 对应充值流水
        insertLog.run(
          uid,
          'recharge',
          'system',
          rechargePoints,
          runningBalance,
          orderNo,
          `充值订单-${ymd}`,
          paidTs
        );
      }
    });
    tx();
    console.log('[admin] Demo data seeded for dashboard (point_logs + recharges last 7 days).');
  } catch (e) {
    console.warn('[admin] Seeding dashboard demo data skipped:', e.message);
  }
}

function adminRoutes(db, log) {
  /**
   * 动态列白名单：从 INFORMATION_SCHEMA（或 SQLite pragma table_info）读取真实列
   * 用于 create/update 时自动剔除不存在的列，避免因迁移多行 INSERT parse error 导致列缺失报错。
   * 启动时惰性初始化并缓存。
   */
  const columnCache = new Map();
  function getColumns(tableName) {
    if (columnCache.has(tableName)) return columnCache.get(tableName);
    let rows;
    if (db.type === 'mysql') {
      rows = db.prepare('SHOW COLUMNS FROM ' + tableName).all();
    } else {
      rows = db.prepare('PRAGMA table_info(' + tableName + ')').all();
    }
    const names = new Set(
      rows.map((r) => (r.Field !== undefined ? r.Field : r.name).toLowerCase())
    );
    columnCache.set(tableName, names);
    return names;
  }
  function hasColumn(tableName, column) {
    return getColumns(tableName).has(String(column).toLowerCase());
  }
  function filterByColumns(tableName, obj) {
    const cols = getColumns(tableName);
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      if (cols.has(String(k).toLowerCase())) out[k] = obj[k];
    });
    return out;
  }

  /**
   * Dashboard 性能/排查日志辅助
   * 在调用 handler 的前后打印：
   *   - 请求发起：操作名、操作者(user_id/username/role)、请求参数（query+body+param）、client IP / UA
   *   - 请求结束：操作名、状态（success/error）、耗时（ms）、响应摘要（关键指标概览，不打印大数组原数据）
   *   - 错误时：堆栈信息
   * @param {string} opName 操作名（如 'admin/stats'）
   * @param {(req,res)=>Promise<void>} handler 原始业务逻辑
   */
  function withPerfLog(opName, handler) {
    return async function (req, res) {
      const startAt = process.hrtime.bigint();
      const msDiff = () => {
        const d = process.hrtime.bigint() - startAt;
        return Number(d) / 1e6;
      };
      const user = req.user || {};
      const reqSummary = {
        client: {
          ip: req.ip || (req.headers || {})['x-forwarded-for'] || req.socket?.remoteAddress,
          method: req.method,
          path: req.path,
          ua: (req.headers || {})['user-agent'] ? String(req.headers['user-agent']).slice(0, 120) : undefined
        },
        operator: {
          user_id: user.id,
          username: user.username,
          role: user.role
        },
        query: req.query && Object.keys(req.query).length ? req.query : undefined,
        body: req.body && Object.keys(req.body).length ? req.body : undefined,
        params: req.params && Object.keys(req.params).length ? req.params : undefined
      };
      log.info(`${opName}.start`, reqSummary);
      // 挂一个轻量的 success 捕获，不改写 response.success，仅通过 monkey-patch 拿到 payload 摘要
      const origSuccess = response.success.bind(response);
      let summaryRecorded = false;
      const recordSuccessSummary = (payload) => {
        if (summaryRecorded) return payload;
        summaryRecorded = true;
        const data = payload && typeof payload === 'object' ? payload : {};
        let summary = {};
        // 针对 3 个 Dashboard 接口定制摘要（避免打印整个大数组）
        if (opName === 'admin/stats') {
          summary = {
            totalUsers: data.totalUsers,
            totalTeams: data.totalTeams,
            totalChannels: data.totalChannels,
            totalStoryboards: data.totalStoryboards,
            totalRechargeAmount: data.totalRechargeAmount,
            totalConsumePoints: data.totalConsumePoints,
            totalProjects: data.totalProjects,
            totalEnterprises: data.totalEnterprises
          };
        } else if (opName === 'admin/stats/trend') {
          const days = data.days || 0;
          const addArr = (arr) => (Array.isArray(arr) ? arr.reduce((s, x) => s + (Number(x) || 0), 0) : 0);
          summary = {
            days,
            firstDate: Array.isArray(data.dates) ? data.dates[0] : undefined,
            lastDate: Array.isArray(data.dates) ? data.dates[data.dates.length - 1] : undefined,
            consumeSum: addArr(data.consumePoints),
            rechargeSum: addArr(data.rechargePoints),
            consumeMax: Array.isArray(data.consumePoints) ? Math.max(0, ...data.consumePoints.map(Number)) : 0,
            rechargeMax: Array.isArray(data.rechargePoints) ? Math.max(0, ...data.rechargePoints.map(Number)) : 0
          };
        } else if (opName === 'admin/stats/consumption') {
          const items = Array.isArray(data.items) ? data.items : [];
          const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0);
          summary = {
            itemCount: items.length,
            totalValue: total,
            byName: items.reduce((m, it) => ((m[String(it.name || '').slice(0, 16)] = Number(it.value) || 0), m), {})
          };
        } else {
          // 其他接口：仅打印最外层的非数组 key 数量
          summary = Object.keys(data).reduce((m, k) => {
            const v = data[k];
            if (Array.isArray(v)) m[k + '_len'] = v.length;
            else if (v && typeof v === 'object') m[k + '_keys'] = Object.keys(v).length;
            else m[k] = v;
            return m;
          }, {});
        }
        log.info(`${opName}.done`, {
          status: 'success',
          durationMs: +(msDiff()).toFixed(3),
          response: summary
        });
        return payload;
      };
      response.success = (r, payload) => {
        recordSuccessSummary(payload);
        return origSuccess(r, payload);
      };
      try {
        await handler(req, res);
      } catch (err) {
        log.error(`${opName}.error`, {
          status: 'error',
          durationMs: +(msDiff()).toFixed(3),
          message: err && err.message,
          stack: err && err.stack ? String(err.stack).slice(0, 800) : undefined
        });
        response.success = origSuccess;
        throw err; // 交给外层 try/catch 记录旧有 admin/stats error 并内部错误返回
      } finally {
        response.success = origSuccess;
      }
    };
  }

  /**
   * 获取系统统计数据（运营概览 - 6 个总数 + 详细分布）
   *
   * 返回用户总数、团队总数、渠道总数、画布总数（storyboards）、总充值金额(元)、总消费积分
   * 以及旧接口兼容字段（项目数、企业数、用户类型分布、项目状态分布）。
   */
  const getStats = withPerfLog('admin/stats', async (req, res) => {
    ensureDashboardDemoData(db);

    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalTeams = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
    const totalChannels = db.prepare('SELECT COUNT(*) as count FROM channels').get().count;
    const totalStoryboards = db.prepare('SELECT COUNT(*) as count FROM storyboards').get().count;

    // 兼容字段
    const totalProjects = db.prepare('SELECT COUNT(*) as count FROM dramas').get().count;
    const totalEnterprises = db.prepare('SELECT COUNT(*) as count FROM enterprises').get().count;
    const individualUsers = db
      .prepare("SELECT COUNT(*) as count FROM users WHERE user_type = ? OR (user_type IS NULL AND role != 'super_admin')")
      .get('individual').count;
    const enterpriseUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE user_type = ?").get('enterprise').count;
    const draftProjects = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'draft'").get().count;
    const publishedProjects = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'published'").get().count;
    const generatingProjects = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'generating'").get().count;
    const archivedProjects = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'archived'").get().count;

    // 金额 & 积分
    const rechargeAgg = db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) as total_amount, COALESCE(SUM(points),0) as total_points FROM recharges WHERE pay_status = 'paid'"
      )
      .get();
    const consumeAgg = db
      .prepare("SELECT COALESCE(SUM(ABS(amount)),0) as total_points FROM point_logs WHERE change_type = 'consume'")
      .get();

    response.success(res, {
      totalUsers,
      totalTeams,
      totalChannels,
      totalStoryboards,
      totalRechargeAmount: Number(rechargeAgg.total_amount) || 0,
      totalConsumePoints: Number(consumeAgg.total_points) || 0,
      // 兼容历史字段
      totalProjects,
      totalEnterprises,
      individualUsers,
      enterpriseUsers,
      draftProjects,
      publishedProjects,
      generatingProjects,
      archivedProjects
    });
  });

  /**
   * 获取近 N 天（默认 7 天）的积分收支趋势
   *
   * Query: days=7
   * 响应: { dates: ['YYYY-MM-DD'...], consumePoints: [...], rechargePoints: [...] }
   */
  const getStatsTrend = withPerfLog('admin/stats/trend', async (req, res) => {
    ensureDashboardDemoData(db);
    const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }

    // 统一使用字符串前缀切分（兼容 SQLite DATETIME 文本、MySQL DATETIME 存储格式），
    // 同时避免 MySQL 时区转换把 UTC 日期与本地 YYYY-MM-DD 对齐时偏移一天。
    const dateExpr = "SUBSTR(created_at, 1, 10)";

    const consumeRows = db
      .prepare(
        `SELECT ${dateExpr} AS d, COALESCE(SUM(ABS(amount)),0) AS v FROM point_logs WHERE change_type = 'consume' AND ${dateExpr} >= ? GROUP BY ${dateExpr}`
      )
      .all(dates[0]);
    const rechargeRows = db
      .prepare(
        `SELECT ${dateExpr} AS d, COALESCE(SUM(amount),0) AS v FROM point_logs WHERE change_type = 'recharge' AND amount > 0 AND ${dateExpr} >= ? GROUP BY ${dateExpr}`
      )
      .all(dates[0]);

    const toMap = (rows) => rows.reduce((m, r) => ((m[r.d] = Number(r.v) || 0), m), {});
    const consumeMap = toMap(consumeRows);
    const rechargeMap = toMap(rechargeRows);
    const consumePoints = dates.map((d) => consumeMap[d] || 0);
    const rechargePoints = dates.map((d) => rechargeMap[d] || 0);

    response.success(res, { days, dates, consumePoints, rechargePoints });
  });

  /**
   * 获取消费构成（按业务分类汇总）
   *
   * 响应: { items: [{name, value}] }
   *   name in ['图片生成','视频生成','文本生成','语音合成','其他']
   */
  const getConsumptionBreakdown = withPerfLog('admin/stats/consumption', async (req, res) => {
    ensureDashboardDemoData(db);
    const rows = db
      .prepare(
        "SELECT business_type, COALESCE(SUM(ABS(amount)),0) AS v FROM point_logs WHERE change_type = 'consume' GROUP BY business_type"
      )
      .all();
    const mapping = {
      image: '图片生成',
      video: '视频生成',
      text: '文本生成',
      audio: '语音合成'
    };
    const buckets = { 图片生成: 0, 视频生成: 0, 文本生成: 0, 语音合成: 0, 其他: 0 };
    rows.forEach((r) => {
      const key = mapping[r.business_type] || '其他';
      buckets[key] += Number(r.v) || 0;
    });
    const items = Object.keys(buckets).map((name) => ({ name, value: buckets[name] }));
    response.success(res, { items });
  });

  /**
   * 获取用户列表（分页）
   * 
   * 超级管理员查看所有普通用户，排除 super_admin 角色。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} [req.query.page=1] - 页码
   * @param {number} [req.query.page_size=20] - 每页数量
   * @param {string} [req.query.keyword] - 搜索关键词（用户名或昵称）
   * @returns {object} 用户列表及分页信息
   */
  async function getUsers(req, res) {
    try {
      const { page = 1, page_size = 20, keyword } = req.query;
      const offset = (page - 1) * page_size;
      
      let sql = 'SELECT * FROM users WHERE role != ?';
      let params = ['super_admin'];
      
      if (keyword) {
        sql += ' AND (username LIKE ? OR nickname LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }
      
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(page_size), parseInt(offset));
      
      const users = db.prepare(sql).all(...params);
      
      const countSql = keyword 
        ? 'SELECT COUNT(*) as count FROM users WHERE role != ? AND (username LIKE ? OR nickname LIKE ?)'
        : 'SELECT COUNT(*) as count FROM users WHERE role != ?';
      const countParams = keyword ? ['super_admin', `%${keyword}%`, `%${keyword}%`] : ['super_admin'];
      const total = db.prepare(countSql).get(...countParams).count;

      response.success(res, {
        items: users,
        pagination: {
          total,
          page: parseInt(page),
          page_size: parseInt(page_size),
          total_pages: Math.ceil(total / page_size)
        }
      });
    } catch (err) {
      log.error('admin/users', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 创建用户
   * 
   * 超级管理员创建新用户。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.username - 用户名
   * @param {string} req.body.password - 密码
   * @param {string} [req.body.nickname] - 昵称
   * @param {string} [req.body.role=user] - 角色
   * @param {string} [req.body.user_type=individual] - 用户类型
   * @returns {object} 创建的用户信息
   */
  async function createUser(req, res) {
    try {
      const { username, password, nickname, role, user_type } = req.body;
      
      if (!username || !password) {
        return response.badRequest(res, '用户名和密码不能为空');
      }
      
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return response.badRequest(res, '用户名已存在');
      }
      
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const result = db.prepare(
        'INSERT INTO users (username, password_hash, nickname, role, user_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())'
      ).run(username, hashedPassword, nickname || '', role || 'user', user_type || 'individual');
      
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      response.success(res, { user, message: '创建成功' });
    } catch (err) {
      log.error('admin/users/create', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 更新用户信息
   * 
   * 超级管理员更新指定用户的信息。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 用户ID
   * @param {string} [req.body.nickname] - 昵称
   * @param {string} [req.body.role] - 角色
   * @param {string} [req.body.user_type] - 用户类型
   * @param {number} [req.body.status] - 状态
   * @param {string} [req.body.password] - 密码
   * @returns {object} 更新后的用户信息
   */
  async function updateUser(req, res) {
    try {
      const { id } = req.params;
      const { nickname, role, user_type, status, password } = req.body;
      
      const updates = [];
      const params = [];
      
      if (nickname !== undefined) {
        updates.push('nickname = ?');
        params.push(nickname);
      }
      if (role !== undefined) {
        updates.push('role = ?');
        params.push(role);
      }
      if (user_type !== undefined) {
        updates.push('user_type = ?');
        params.push(user_type);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
      }
      if (password) {
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(password, 10);
        updates.push('password_hash = ?');
        params.push(hashedPassword);
      }
      
      if (updates.length === 0) {
        return response.badRequest(res, '没有需要更新的字段');
      }
      
      updates.push('updated_at = NOW()');
      params.push(id);
      
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      response.success(res, { user, message: '更新成功' });
    } catch (err) {
      log.error('admin/users/update', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 删除用户
   * 
   * 超级管理员删除指定用户。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 用户ID
   * @returns {object} 删除成功消息
   */
  async function deleteUser(req, res) {
    try {
      const { id } = req.params;
      
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!user) {
        return response.badRequest(res, '用户不存在');
      }
      
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('admin/users/delete', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 获取企业列表（分页）
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} [req.query.page=1] - 页码
   * @param {number} [req.query.page_size=20] - 每页数量
   * @param {string} [req.query.keyword] - 搜索关键词（企业名称）
   * @returns {object} 企业列表及分页信息
   */
  async function getEnterprises(req, res) {
    try {
      const { page = 1, page_size = 20, keyword } = req.query;
      const offset = (page - 1) * page_size;
      
      let sql = 'SELECT * FROM enterprises';
      let params = [];
      
      if (keyword) {
        sql += ' WHERE name LIKE ?';
        params.push(`%${keyword}%`);
      }
      
      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(page_size), parseInt(offset));
      
      const enterprises = db.prepare(sql).all(...params);
      
      const countSql = keyword 
        ? 'SELECT COUNT(*) as count FROM enterprises WHERE name LIKE ?'
        : 'SELECT COUNT(*) as count FROM enterprises';
      const countParams = keyword ? [`%${keyword}%`] : [];
      const total = db.prepare(countSql).get(...countParams).count;

      response.success(res, {
        items: enterprises,
        pagination: {
          total,
          page: parseInt(page),
          page_size: parseInt(page_size),
          total_pages: Math.ceil(total / page_size)
        }
      });
    } catch (err) {
      log.error('admin/enterprises', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 创建企业
   *
   * 注意：列名会按 SHOW COLUMNS / PRAGMA 结果做白名单过滤，避免因迁移多行解析跳过导致
   * "Unknown column" 报错（例如 contact_person/contact_phone/address/remark 在部分 DB 未创建）。
   *
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.name - 企业名称
   * @param {string} [req.body.short_name] - 简称
   * @param {string} [req.body.logo] - Logo
   * @param {string} [req.body.domain] - 域名
   * @param {string} [req.body.contact_person] - 联系人（若列存在）
   * @param {string} [req.body.contact_phone] - 联系电话（若列存在）
   * @param {string} [req.body.address] - 地址（若列存在）
   * @param {string} [req.body.remark] - 备注（若列存在）
   * @param {number} [req.body.status=1] - 状态
   * @returns {object} 创建的企业信息
   */
  async function createEnterprise(req, res) {
    try {
      const { name } = req.body;

      if (!name) {
        return response.badRequest(res, '企业名称不能为空');
      }

      const payload = filterByColumns('enterprises', {
        name: String(name),
        short_name: req.body.short_name || null,
        logo: req.body.logo || null,
        domain: req.body.domain || null,
        contact_person: req.body.contact_person || null,
        contact_phone: req.body.contact_phone || null,
        address: req.body.address || null,
        remark: req.body.remark || null,
        status: typeof req.body.status === 'number' ? req.body.status : 1
      });
      // 自动填充 created_at / updated_at（若列存在）
      const timeFields = { created_at: null, updated_at: null };
      if (hasColumn('enterprises', 'created_at')) {
        timeFields.created_at = db.type === 'mysql' ? null : 'CURRENT_TIMESTAMP';
      }
      const keys = Object.keys(payload);
      const placeholders = keys.map(() => '?').join(', ');
      let sql = `INSERT INTO enterprises (${keys.join(', ')}) VALUES (${placeholders})`;
      let values = Object.values(payload);
      const result = db.prepare(sql).run(...values);

      const eid = Number(result.lastInsertRowid || result.insertId || 0);
      const enterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?').get(eid);
      response.success(res, { enterprise, message: '创建成功' });
    } catch (err) {
      log.error('admin/enterprises/create', {
        error: err.message,
        code: err.code,
        body: Object.keys(req.body || {})
      });
      response.internalError(res, err.message);
    }
  }

  /**
   * 更新企业信息（同样按真实列白名单过滤）
   */
  async function updateEnterprise(req, res) {
    try {
      const { id } = req.params;
      const allUpdates = {
        name: req.body.name,
        short_name: req.body.short_name,
        logo: req.body.logo,
        domain: req.body.domain,
        contact_person: req.body.contact_person,
        contact_phone: req.body.contact_phone,
        address: req.body.address,
        remark: req.body.remark,
        status: req.body.status
      };
      const filtered = filterByColumns('enterprises', allUpdates);
      const keys = Object.keys(filtered).filter((k) => allUpdates[k] !== undefined);
      const updates = keys.map((k) => `${k} = ?`);
      const params = keys.map((k) => allUpdates[k]);

      if (updates.length === 0) {
        return response.badRequest(res, '没有需要更新的字段');
      }
      if (hasColumn('enterprises', 'updated_at')) {
        updates.push(db.type === 'mysql' ? 'updated_at = CURRENT_TIMESTAMP' : 'updated_at = CURRENT_TIMESTAMP');
      }
      params.push(id);

      db.prepare(`UPDATE enterprises SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const enterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?').get(id);
      response.success(res, { enterprise, message: '更新成功' });
    } catch (err) {
      log.error('admin/enterprises/update', {
        error: err.message,
        code: err.code,
        id: req.params.id
      });
      response.internalError(res, err.message);
    }
  }

  /**
   * 删除企业
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 企业ID
   * @returns {object} 删除成功消息
   */
  async function deleteEnterprise(req, res) {
    try {
      const { id } = req.params;
      
      const enterprise = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(id);
      if (!enterprise) {
        return response.badRequest(res, '企业不存在');
      }
      
      db.prepare('DELETE FROM enterprises WHERE id = ?').run(id);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('admin/enterprises/delete', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 获取团队列表（分页）
   * 
   * 返回团队信息及所属企业名称、成员数量。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} [req.query.page=1] - 页码
   * @param {number} [req.query.page_size=20] - 每页数量
   * @param {string} [req.query.keyword] - 搜索关键词（团队名称）
   * @returns {object} 团队列表及分页信息
   */
  async function getTeams(req, res) {
    try {
      const { page = 1, page_size = 20, keyword } = req.query;
      const offset = (page - 1) * page_size;
      
      let sql = 'SELECT t.*, e.name as enterprise_name, (SELECT COUNT(*) FROM users WHERE team_id = t.id) as member_count FROM teams t LEFT JOIN enterprises e ON t.enterprise_id = e.id';
      let params = [];
      
      if (keyword) {
        sql += ' WHERE t.name LIKE ?';
        params.push(`%${keyword}%`);
      }
      
      sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(page_size), parseInt(offset));
      
      const teams = db.prepare(sql).all(...params);
      
      const countSql = keyword 
        ? 'SELECT COUNT(*) as count FROM teams WHERE name LIKE ?'
        : 'SELECT COUNT(*) as count FROM teams';
      const countParams = keyword ? [`%${keyword}%`] : [];
      const total = db.prepare(countSql).get(...countParams).count;

      response.success(res, {
        items: teams,
        pagination: {
          total,
          page: parseInt(page),
          page_size: parseInt(page_size),
          total_pages: Math.ceil(total / page_size)
        }
      });
    } catch (err) {
      log.error('admin/teams', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 创建团队
   *
   * teams.enterprise_id 通常是 NOT NULL + FK（MySQL）。本函数：
   *   - 若传了 enterprise_id：先校验它确实存在，否则 BadRequest
   *   - 若未传或传 0/null：自动挂到一条预先创建的"默认独立工作室"企业下（避免 FK 失败）
   * 列白名单同样由 filterByColumns 过滤。
   *
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.name - 团队名称
   * @param {number} [req.body.enterprise_id] - 所属企业ID（可选）
   * @param {string} [req.body.description] - 描述
   * @returns {object} 创建的团队信息
   */
  async function createTeam(req, res) {
    try {
      const { name, description } = req.body;
      let enterprise_id = req.body.enterprise_id;

      if (!name) {
        return response.badRequest(res, '团队名称不能为空');
      }

      // 1) 解析 enterprise_id
      const hasEid = enterprise_id !== undefined && enterprise_id !== null && String(enterprise_id) !== '' && Number(enterprise_id) > 0;
      let finalEid = hasEid ? Number(enterprise_id) : null;

      if (finalEid != null) {
        const hit = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(finalEid);
        if (!hit) {
          return response.badRequest(res, '指定的企业不存在，无法创建团队');
        }
      } else {
        // 2) 没传 enterprise_id：用默认企业兜底（不存在则自动创建）
        const fallback = db.prepare("SELECT id FROM enterprises WHERE name = ?").get('未分配工作室');
        if (fallback) {
          finalEid = Number(fallback.id);
        } else {
          // 用 createEnterprise 的白名单逻辑避免列不存在报错
          const fallbackName = '未分配工作室';
          const pay = filterByColumns('enterprises', {
            name: fallbackName,
            short_name: '默认工作室',
            status: 1
          });
          const k = Object.keys(pay);
          const ins = db.prepare(`INSERT INTO enterprises (${k.join(', ')}) VALUES (${k.map(() => '?').join(', ')})`);
          const r = ins.run(...Object.values(pay));
          finalEid = Number(r.lastInsertRowid || r.insertId || 0);
          log.info('admin/teams/create/fallback-enterprise', {
            enterprise_id: finalEid,
            name: fallbackName
          });
        }
      }

      const payload = filterByColumns('teams', {
        name: String(name),
        enterprise_id: finalEid,
        description: description || '',
        status: typeof req.body.status === 'number' ? req.body.status : 1
      });
      const keys = Object.keys(payload);
      const result = db.prepare(`INSERT INTO teams (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(payload));

      const teamId = Number(result.lastInsertRowid || result.insertId || 0);
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
      response.success(res, { team, message: '创建成功' });
    } catch (err) {
      log.error('admin/teams/create', {
        error: err.message,
        code: err.code,
        enterprise_id: req.body && req.body.enterprise_id,
        name: req.body && req.body.name
      });
      response.internalError(res, err.message);
    }
  }

  /**
   * 更新团队信息（真实列白名单 + enterprise_id 校验）
   */
  async function updateTeam(req, res) {
    try {
      const { id } = req.params;
      const allUpdates = {
        name: req.body.name,
        enterprise_id: req.body.enterprise_id,
        description: req.body.description,
        status: req.body.status
      };

      // enterprise_id 若显式传入，需要存在
      if (allUpdates.enterprise_id !== undefined && allUpdates.enterprise_id !== null && String(allUpdates.enterprise_id) !== '') {
        const eid = Number(allUpdates.enterprise_id);
        if (!(eid > 0)) return response.badRequest(res, 'enterprise_id 必须是正整数');
        const hit = db.prepare('SELECT id FROM enterprises WHERE id = ?').get(eid);
        if (!hit) return response.badRequest(res, '指定的企业不存在');
        allUpdates.enterprise_id = eid;
      }

      const filtered = filterByColumns('teams', allUpdates);
      const keys = Object.keys(filtered).filter((k) => allUpdates[k] !== undefined);
      const updates = keys.map((k) => `${k} = ?`);
      const params = keys.map((k) => allUpdates[k]);

      if (updates.length === 0) {
        return response.badRequest(res, '没有需要更新的字段');
      }
      if (hasColumn('teams', 'updated_at')) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
      }
      params.push(id);

      db.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
      response.success(res, { team, message: '更新成功' });
    } catch (err) {
      log.error('admin/teams/update', {
        error: err.message,
        code: err.code,
        id: req.params.id
      });
      response.internalError(res, err.message);
    }
  }

  /**
   * 删除团队
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 团队ID
   * @returns {object} 删除成功消息
   */
  async function deleteTeam(req, res) {
    try {
      const { id } = req.params;
      
      const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(id);
      if (!team) {
        return response.badRequest(res, '团队不存在');
      }
      
      db.prepare('DELETE FROM teams WHERE id = ?').run(id);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('admin/teams/delete', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  // ---------------------------------------------------------------------
  // 数据异常检测
  // ---------------------------------------------------------------------
  // 通过环境变量动态调整扫描灵敏度（重启生效，或前端请求时 query 覆盖）
  const ANOMALY_CFG = Object.freeze({
    amountThreshold: Number(process.env.ANOMALY_DEFAULT_AMOUNT_TH || 200000000) || 200000000,
    balanceThreshold: Number(process.env.ANOMALY_DEFAULT_BALANCE_TH || 500000000) || 500000000,
    defaultLimit: Number(process.env.ANOMALY_DEFAULT_LIMIT || 200) || 200,
    // info：常规汇总； warn：只打印警告和错误； debug：打印每条异常明细（不适合大数据量）
    logLevel: (process.env.ANOMALY_LOG_LEVEL || 'info').toLowerCase()
  });

  /**
   * 把当前扫描默认配置（来自环境变量）返回给前端，方便页面把默认值填入输入框
   */
  async function getAnomalyConfig(_req, res) {
    response.success(res, ANOMALY_CFG);
  }

  async function getDataAnomalies(req, res) {
    try {
      const t1 = Date.now();
      const amountTh = Number(req.query.amount_threshold || ANOMALY_CFG.amountThreshold) || ANOMALY_CFG.amountThreshold;
      const balanceTh = Number(req.query.balance_threshold || ANOMALY_CFG.balanceThreshold) || ANOMALY_CFG.balanceThreshold;
      const limit = Math.min(500, Math.max(10, Number(req.query.limit || ANOMALY_CFG.defaultLimit) || ANOMALY_CFG.defaultLimit));

      /** @type {Array<{id:string,type:string,severity:'critical'|'warning'|'info',reason:string,row:object}>} */
      const items = [];
      let hit;
      const colsPl = getColumns('point_logs');

      // 1) point_logs 余额为负（critical）
      if (colsPl.has('balance_after')) {
        const selPlFields = ['pl.id', 'pl.user_id', 'pl.amount', 'pl.balance_after'];
        if (colsPl.has('reason')) selPlFields.push('pl.reason');
        if (colsPl.has('created_at')) selPlFields.push('pl.created_at');
        const userCols2 = getColumns('users');
        const uNick = userCols2.has('nickname');
        const uPhone = userCols2.has('phone');
        const uBal = userCols2.has('balance');
        const selUFields = [];
        if (uNick) selUFields.push('u.nickname');
        if (uPhone) selUFields.push('u.phone');
        if (uBal) selUFields.push('u.balance AS user_balance');
        hit = db
          .prepare(
            `SELECT ${selPlFields.join(', ')}${selUFields.length ? ', ' + selUFields.join(', ') : ''}
               FROM point_logs pl LEFT JOIN users u ON u.id = pl.user_id
              WHERE pl.balance_after < 0 ORDER BY pl.balance_after ASC LIMIT ${limit}`
          )
          .all();
        hit.forEach((r) => {
          items.push({
            id: 'neg_bal_' + r.id,
            type: 'negative_balance',
            severity: 'critical',
            reason: `日志${r.id} 交易后余额为负 ${r.balance_after}（交易 ${r.amount}，用户#${r.user_id||'-'}）`,
            row: r
          });
        });
      }

      // 2) 单笔 amount 绝对值超大
      if (colsPl.has('amount')) {
        const selPlFields2 = ['pl.id', 'pl.user_id', 'pl.amount'];
        if (colsPl.has('balance_after')) selPlFields2.push('pl.balance_after');
        if (colsPl.has('reason')) selPlFields2.push('pl.reason');
        if (colsPl.has('created_at')) selPlFields2.push('pl.created_at');
        const userCols3 = getColumns('users');
        const selUFields2 = [];
        if (userCols3.has('nickname')) selUFields2.push('u.nickname');
        if (userCols3.has('phone')) selUFields2.push('u.phone');
        hit = db
          .prepare(
            `SELECT ${selPlFields2.join(', ')}${selUFields2.length ? ', ' + selUFields2.join(', ') : ''}
               FROM point_logs pl LEFT JOIN users u ON u.id = pl.user_id
              WHERE ABS(pl.amount) >= ? ORDER BY ABS(pl.amount) DESC LIMIT ${limit}`
          )
          .all(amountTh);
        hit.forEach((r) => {
          items.push({
            id: 'bigamt_' + r.id,
            type: 'huge_amount',
            severity: Math.abs(r.amount) >= amountTh * 5 ? 'critical' : 'warning',
            reason: `日志${r.id} 单笔积分 ${r.amount} 绝对值超过阈值 ${amountTh}`,
            row: r
          });
        });
      }

      // 3) balance_after 巨量跳变（按用户时间排序，看相邻差）
      if (colsPl.has('user_id') && colsPl.has('balance_after')) {
        const orderBy = colsPl.has('created_at')
          ? 'created_at ASC, id ASC'
          : 'id ASC';
        const selFields = ['id', 'balance_after', 'amount'];
        if (colsPl.has('reason')) selFields.push('reason');
        if (colsPl.has('created_at')) selFields.push('created_at');
        const usersWithLogs = db.prepare(
          'SELECT DISTINCT user_id FROM point_logs WHERE user_id IS NOT NULL ORDER BY user_id LIMIT 5000'
        ).all();
        for (const { user_id } of usersWithLogs) {
          const arr = db
            .prepare(
              `SELECT ${selFields.join(', ')} FROM point_logs WHERE user_id = ? ORDER BY ${orderBy}`
            )
            .all(user_id);
          for (let i = 1; i < arr.length; i++) {
            const prev = arr[i - 1], cur = arr[i];
            const delta = Number(cur.balance_after) - Number(prev.balance_after);
            const diffFromAmount = Math.abs(delta - Number(cur.amount || 0));
            if (Math.abs(delta) >= balanceTh || (diffFromAmount >= balanceTh && diffFromAmount > 0)) {
              items.push({
                id: `jump_${cur.id}`,
                type: 'balance_jump',
                severity: Math.abs(delta) >= balanceTh * 3 ? 'critical' : 'warning',
                reason: `用户#${user_id} 日志${prev.id}→${cur.id} 余额跳变 Δ=${delta}，amount=${cur.amount || 0}，差=${diffFromAmount}`,
                row: {
                  from_log_id: prev.id, to_log_id: cur.id, user_id,
                  before_balance: prev.balance_after, after_balance: cur.balance_after,
                  delta, amount: cur.amount, diff_from_amount: diffFromAmount,
                  created_at: cur.created_at || null, reason: cur.reason || null
                }
              });
            }
            if (items.length > limit * 2) break;
          }
          if (items.length > limit * 2) break;
        }
      }

      // 4) users.balance 与最后一条 point_logs.balance_after 不一致（或 users.balance 本身为负）
      const userCols = getColumns('users');
      if (userCols.has('balance')) {
        // 4a) users.balance < 0
        const userSelect = ['id', 'balance'];
        if (userCols.has('nickname')) userSelect.push('nickname');
        if (userCols.has('phone')) userSelect.push('phone');
        const neg = db.prepare(
          `SELECT ${userSelect.join(', ')} FROM users WHERE balance < 0 ORDER BY balance ASC LIMIT ?`
        ).all(Math.min(limit, 200));
        neg.forEach((u) => {
          items.push({
            id: `userbalneg_${u.id}`,
            type: 'negative_user_balance',
            severity: 'critical',
            reason: `用户 #${u.id} ${u.nickname || ''} 账户余额为负：${u.balance}`,
            row: u
          });
        });

        // 4b) 用户余额 != 最近 point_logs.balance_after
        const colsUser = getColumns('point_logs');
        if (colsUser.has('balance_after')) {
          const uSel = ['u.id AS user_id', 'u.balance AS user_balance',
                        'l.balance_after AS last_log_balance', 'l.id AS last_log_id'];
          if (colsUser.has('created_at')) uSel.push('l.created_at');
          if (userCols.has('nickname')) uSel.push('u.nickname');
          if (userCols.has('phone')) uSel.push('u.phone');
          const bad = db.prepare(`
            SELECT ${uSel.join(', ')}
              FROM users u
              JOIN (
                SELECT user_id, MAX(id) AS id FROM point_logs
                 WHERE user_id IS NOT NULL GROUP BY user_id
              ) last_pl ON u.id = last_pl.user_id
              JOIN point_logs l ON l.id = last_pl.id
             WHERE u.balance <> l.balance_after
             ORDER BY ABS(u.balance - l.balance_after) DESC LIMIT ?`
          ).all(Math.min(limit, 200));
          bad.forEach((r) => {
            const diff = Number(r.user_balance) - Number(r.last_log_balance);
            if (Math.abs(diff) >= 1) {
              items.push({
                id: `mismatch_${r.user_id}`,
                type: 'balance_mismatch',
                severity: Math.abs(diff) >= amountTh ? 'critical' : 'warning',
                reason: `用户#${r.user_id} balance(${r.user_balance}) ≠ 最后日志 balance_after(${r.last_log_balance})，差=${diff}`,
                row: r
              });
            }
          });
        }
      }

      // 聚合 summary
      const total = items.length;
      const bySeverity = { critical: 0, warning: 0, info: 0 };
      const byType = {};
      items.forEach((it) => {
        bySeverity[it.severity] = (bySeverity[it.severity] || 0) + 1;
        byType[it.type] = (byType[it.type] || 0) + 1;
      });

      const payload = {
        summary: {
          total,
          bySeverity,
          byType,
          thresholds: { amount: amountTh, balance: balanceTh },
          defaults: {
            amount: ANOMALY_CFG.amountThreshold,
            balance: ANOMALY_CFG.balanceThreshold,
            limit: ANOMALY_CFG.defaultLimit,
            log_level: ANOMALY_CFG.logLevel
          }
        },
        items
      };
      const elapsed = Date.now() - t1;
      if (ANOMALY_CFG.logLevel === 'debug') {
        log.debug('admin/data-anomalies/scan', {
          elapsed_ms: elapsed,
          total,
          bySeverity,
          byType,
          thresholds: { amount: amountTh, balance: balanceTh },
          item_count: items.length,
          sample: items.slice(0, 20).map((x) => ({ id: x.id, type: x.type, sev: x.severity }))
        });
      } else if (ANOMALY_CFG.logLevel === 'warn') {
        if (total > 0) {
          log.warn('admin/data-anomalies/scan', {
            elapsed_ms: elapsed,
            total, critical: bySeverity.critical, warning: bySeverity.warning,
            byType
          });
        }
      } else {
        log.info('admin/data-anomalies/scan', {
          elapsed_ms: elapsed,
          total,
          bySeverity,
          byType,
          thresholds: { amount: amountTh, balance: balanceTh }
        });
      }
      response.success(res, payload);
    } catch (err) {
      log.error('admin/data-anomalies/scan', { error: err.message, code: err.code });
      response.internalError(res, err.message);
    }
  }

  // anomalyIdPrefix → anomaly type（注意：items[].type 是给前端看的语义名，而 anomalyId 前缀用来路由修复逻辑）
  const ID_PREFIX_TO_ANOMALY_TYPE = {
    neg_bal: 'negative_balance',
    userbalneg: 'negative_user_balance',
    mismatch: 'balance_mismatch'
  };

  /**
   * 把 fixDataAnomaly 独立成一个可复用工厂（方便测试用 better-sqlite3 memory 跑）。
   * 与真正 Express 路由相比，主要差异：
   *   - request/response 用 `({params:{id}}, {ok/br/ie})` 模拟；
   *   - 所有依赖显式注入（db / cfg / log / response）。
   */
  function buildFixDataAnomaly(deps) {
    const dbx      = deps.db;
    const cfg      = deps.cfg;
    const logx     = deps.log || { info:()=>{}, warn:()=>{}, error:()=>{}, debug:()=>{} };
    const response = deps.response || {
      success: (_, data) => ({ ok:true,  status:200, data }),
      badRequest: (_, msg, code='BAD_REQUEST') => ({ ok:false, status:400, code, message: msg }),
      internalError: (_, msg) => ({ ok:false, status:500, code:'INTERNAL_ERROR', message:msg })
    };

    // 列缓存与 hasColumn（与 admin.js 顶部 getColumns 行为一致）
    const columnCache = new Map();
    function getColumns(tableName) {
      if (columnCache.has(tableName)) return columnCache.get(tableName);
      const rows = (dbx.type === 'mysql')
        ? dbx.prepare('SHOW COLUMNS FROM ' + tableName).all()
        : dbx.prepare('PRAGMA table_info(' + tableName + ')').all();
      const names = new Set(rows.map((r) => (r.Field !== undefined ? r.Field : r.name).toLowerCase()));
      columnCache.set(tableName, names);
      return names;
    }
    function hasColumn(t, c) { return getColumns(t).has(String(c).toLowerCase()); }

    function runWriteTx(fn) {
      if (dbx.type === 'sqlite' && typeof dbx.transaction === 'function') {
        const txn = dbx.transaction(fn);
        if (typeof txn.immediate === 'function') return txn.immediate();
        return txn();
      }
      const txn = dbx.transaction(fn);
      return txn();
    }
    function lockSelect(sql, params=[]) {
      const s = String(sql).trim();
      const locked = dbx.type === 'mysql' && !/for\s+update\b/i.test(s) ? s + ' FOR UPDATE' : s;
      return dbx.prepare(locked).get(...params);
    }

    return async function fix(anomalyId) {
      const req = { params: { id: anomalyId } };
      const res = {};
      try {
        const rawId = String(req.params.id || '');
        const parts = rawId.split('_');
        const prefix = parts.slice(0, parts.length - 1).join('_');
        const keyId = Number(parts[parts.length - 1]);
        if (!prefix || !(keyId > 0)) return response.badRequest(res, '异常项 ID 格式不正确');
        const anomalyType = ID_PREFIX_TO_ANOMALY_TYPE[prefix];

        let r;
        const txStart = Date.now();
        if (prefix === 'neg_bal') {
          if (!hasColumn('point_logs', 'balance_after')) {
            return response.badRequest(res, '当前 point_logs 表没有 balance_after 列，无法执行修复');
          }
          r = runWriteTx(() => {
            let affected = 0;
            const row = lockSelect('SELECT id, user_id, balance_after FROM point_logs WHERE id = ?', [keyId]);
            if (!row) throw new Error('异常日志不存在');
            if (Number(row.balance_after) >= 0) {
              return { affected: 0, message: `日志 #${row.id} 当前 balance_after=${row.balance_after}，已非负值，无需修复` };
            }
            const up = dbx.prepare('UPDATE point_logs SET balance_after = 0 WHERE id = ? AND balance_after < 0').run(keyId);
            affected += Number(up.changes || up.changedRows || 0);
            if (row.user_id && hasColumn('users', 'balance')) {
              const last = lockSelect('SELECT balance_after FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1', [row.user_id]);
              if (last) {
                const ub = Math.max(0, Number(last.balance_after) || 0);
                lockSelect('SELECT id, balance FROM users WHERE id = ?', [row.user_id]);
                const uUp = dbx.prepare('UPDATE users SET balance = ? WHERE id = ?').run(ub, row.user_id);
                affected += Number(uUp.changes || uUp.changedRows || 0);
                const after = dbx.prepare('SELECT balance FROM users WHERE id = ?').get(row.user_id);
                if (!after || Number(after.balance) < 0) {
                  throw new Error(`CONSISTENCY: 用户 #${row.user_id} 修复后仍为负余额 ${after?.balance}`);
                }
              }
            }
            const afterPl = dbx.prepare('SELECT balance_after FROM point_logs WHERE id = ?').get(keyId);
            if (!afterPl || Number(afterPl.balance_after) < 0) {
              throw new Error(`CONSISTENCY: 日志 #${keyId} 修复后仍为负 ${afterPl?.balance_after}`);
            }
            return { affected, message: `已修复负余额日志 #${row.id}（用户#${row.user_id || '-'})，写回 ${affected} 行` };
          });
        } else if (prefix === 'userbalneg') {
          if (!hasColumn('users', 'balance')) {
            return response.badRequest(res, '当前 users 表没有 balance 列，无法执行修复');
          }
          r = runWriteTx(() => {
            const cur = lockSelect('SELECT id, balance FROM users WHERE id = ?', [keyId]);
            if (!cur) throw new Error('用户不存在');
            if (Number(cur.balance) >= 0) {
              return { affected: 0, message: `用户 #${keyId} 当前 balance=${cur.balance}，已非负值，无需修复` };
            }
            const up = dbx.prepare('UPDATE users SET balance = 0 WHERE id = ? AND balance < 0').run(keyId);
            const affected = Number(up.changes || up.changedRows || 0);
            const after = dbx.prepare('SELECT balance FROM users WHERE id = ?').get(keyId);
            if (!after || Number(after.balance) < 0) {
              throw new Error(`CONSISTENCY: 用户 #${keyId} 修复后仍为负 ${after?.balance}`);
            }
            return { affected, message: `已托底修正用户 #${keyId} 的负余额为 0，affected=${affected}` };
          });
        } else if (prefix === 'mismatch') {
          if (!hasColumn('users', 'balance')) {
            return response.badRequest(res, '当前 users 表没有 balance 列，无法执行修复');
          }
          if (!hasColumn('point_logs', 'balance_after')) {
            return response.badRequest(res, '当前 point_logs 表没有 balance_after 列，无法执行修复');
          }
          r = runWriteTx(() => {
            lockSelect('SELECT id FROM users WHERE id = ?', [keyId]);
            const last = dbx.prepare(
              'SELECT balance_after, id AS log_id FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1'
            ).get(keyId);
            if (!last) throw new Error('该用户无 point_logs，无法自动修复（请人工核查）');
            const ub = Number(last.balance_after) || 0;
            const up = dbx.prepare('UPDATE users SET balance = ? WHERE id = ?').run(ub, keyId);
            const affected = Number(up.changes || up.changedRows || 0);
            const after = dbx.prepare('SELECT balance FROM users WHERE id = ?').get(keyId);
            if (!after || Number(after.balance) !== ub) {
              throw new Error(`CONSISTENCY: 用户 #${keyId} balance 同步失败，期望=${ub} 实际=${after?.balance}`);
            }
            return { affected, message: `已将用户 #${keyId} balance 同步为最近日志#${last.log_id} 的值 ${ub}` };
          });
        } else {
          return response.badRequest(res, `不支持的自动修复类型（${prefix || anomalyType || 'unknown'}）：需人工核查`);
        }
        const level = (cfg && cfg.logLevel) || 'info';
        if (level === 'debug' || level === 'info') {
          logx.info('fix', { id:rawId, prefix, anomaly_type:anomalyType||prefix, affected:r.affected, elapsed_ms:Date.now()-txStart, message:r.message });
        } else {
          if (r.affected > 0) logx.warn('fix', { id:rawId, affected:r.affected, message:r.message });
        }
        return response.success(res, { affected: r.affected, message: r.message });
      } catch (err) {
        logx.error('fix', { error: err.message, code: err.code, id: req.params.id });
        return response.internalError(res, err.message);
      }
    };
  }

  /**
   * 执行读-改-写短事务时强制加写锁的包装：
   *   - MySQL：SELECT ... FOR UPDATE
   *   - SQLite：better-sqlite3 默认 BEGIN DEFERRED，我们调用 .immediate() 事务变体
   *          （WAL + immediate 可避免多写 SQLITE_BUSY 与死锁）
   *
   * @param {(changesTbl: {add: (n:number)=>void}) => {affected:number,message:string}} fn
   */
  function runWriteTx(fn) {
    if (db.type === 'sqlite' && typeof db.transaction === 'function') {
      const txn = db.transaction(fn);
      // better-sqlite3 事务默认 deferred；写事务用 immediate 更稳（先拿 RESERVED 锁）
      if (typeof txn.immediate === 'function') return txn.immediate();
      return txn();
    }
    const txn = db.transaction(fn);
    return txn();
  }

  /**
   * 取一行 + 对 MySQL 加 FOR UPDATE 行锁（事务内调用，外部必须包裹 runWriteTx）
   */
  function lockSelect(sql, params = []) {
    const s = String(sql).trim();
    const locked = db.type === 'mysql' && !/for\s+update\b/i.test(s)
      ? s + ' FOR UPDATE'
      : s;
    return db.prepare(locked).get(...params);
  }

  /**
   * 一键"托底修复" —— 高并发安全：
   *   · 所有 SELECT 先加行锁（FOR UPDATE / SQLite immediate tx）
   *   · 修复后立即断言一致性（balance_after ≥ 0 / users.balance ≥ 0 / 同步相等）
   *   · 列不存在时返回 BadRequest 而非抛 500
   *   · changes 计数统一使用 db.run(...).changes（MySQL/ SQLite 都兼容）
   *
   * 真正处理逻辑都在 buildFixDataAnomaly 内部，这里只是用真实 route 的 db/log/cfg/response 包一层，
   * 便于测试和 route 共用同一份代码。
   */
  async function fixDataAnomaly(req, res) {
    const fn = buildFixDataAnomaly({ db, cfg: ANOMALY_CFG, log, response });
    const result = await fn(req.params.id);
    // buildFixDataAnomaly 会返回 {ok,status,code,message,data} 而不是调用 res 方法，
    // 所以这里我们需要兼容两种风格：如果返回对象带有 data/message 直接走 response.*；
    if (result && typeof result === 'object') {
      if (result.ok) return response.success(res, result.data);
      if (result.status === 400) return response.badRequest(res, result.message, result.code);
      return response.internalError(res, result.message);
    }
  }

  // ============================================================
  // Sprint 4 - S4-T05: 智能运营看板扩展
  // 创作漏斗 + 模型成本 + AI洞察
  // ============================================================

  /**
   * 创作漏斗分析：创建→剧本→分镜→生图→生视频→导出 全链路转化率
   */
  const getCreationFunnel = withPerfLog('admin/stats/funnel', async (req, res) => {
    const stages = [
      { key: 'created', label: '创建项目', count: 0 },
      { key: 'script', label: '完成剧本', count: 0 },
      { key: 'storyboard', label: '生成分镜', count: 0 },
      { key: 'image', label: '生成图片', count: 0 },
      { key: 'video', label: '生成视频', count: 0 },
      { key: 'exported', label: '导出成品', count: 0 },
    ];

    try {
      // 创建项目数
      stages[0].count = db.prepare('SELECT COUNT(*) as c FROM dramas').get().c || 0;
      // 完成剧本：dramas 表有 outline 数据的
      try {
        stages[1].count = db.prepare("SELECT COUNT(*) as c FROM dramas WHERE outline IS NOT NULL AND outline != ''").get().c || 0;
      } catch (_) {
        stages[1].count = db.prepare('SELECT COUNT(*) as c FROM dramas').get().c || 0;
      }
      // 生成分镜
      stages[2].count = db.prepare('SELECT COUNT(*) as c FROM storyboards WHERE deleted_at IS NULL').get().c || 0;
      // 生成图片
      try { stages[3].count = db.prepare('SELECT COUNT(*) as c FROM image_generations').get().c || 0; } catch (_) {}
      // 生成视频
      try { stages[4].count = db.prepare('SELECT COUNT(*) as c FROM video_generations').get().c || 0; } catch (_) {}
      // 导出成品（status=published 或有 export 记录）
      try {
        stages[5].count = db.prepare("SELECT COUNT(*) as c FROM dramas WHERE status IN ('published','archived')").get().c || 0;
      } catch (_) {}

      // 计算转化率
      let prevCount = stages[0].count;
      for (let i = 1; i < stages.length; i++) {
        const rate = prevCount > 0 ? Number(((stages[i].count / prevCount) * 100).toFixed(2)) : 0;
        stages[i].conversionRate = rate;
        prevCount = stages[i].count;
      }
      stages[0].conversionRate = 100;

      // 总体转化率
      const overallRate = stages[0].count > 0
        ? Number(((stages[stages.length - 1].count / stages[0].count) * 100).toFixed(2))
        : 0;

      response.success(res, { stages, overallRate });
    } catch (err) {
      response.internalError(res, err.message);
    }
  });

  /**
   * 模型成本看板：各AI模型的调用量/成功率/成本/平均耗时对比
   */
  const getModelCost = withPerfLog('admin/stats/model-cost', async (req, res) => {
    try {
      let items = [];
      // 优先从 ai_model_call_logs 读取（S4-T07 记录的调用日志）
      try {
        const rows = db.prepare(`SELECT
          model, service_type, provider,
          COUNT(*) as total_calls,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
          AVG(latency_ms) as avg_latency,
          SUM(cost) as total_cost,
          AVG(quality_score) as avg_quality
          FROM ai_model_call_logs
          GROUP BY model, service_type
          ORDER BY total_calls DESC`).all();
        items = rows.map(r => ({
          model: r.model, serviceType: r.service_type, provider: r.provider,
          totalCalls: r.total_calls, successCount: r.success_count, failedCount: r.failed_count,
          successRate: r.total_calls > 0 ? Number(((r.success_count / r.total_calls) * 100).toFixed(2)) : 0,
          avgLatency: Math.round(r.avg_latency || 0),
          totalCost: Number(r.total_cost || 0),
          avgQuality: r.avg_quality ? Number(Number(r.avg_quality).toFixed(2)) : null,
        }));
      } catch (_) {}

      // 若无调用日志，从 ai_service_configs 读取已配置的模型列表
      if (items.length === 0) {
        try {
          const configs = db.prepare('SELECT provider, service_type, model, is_active FROM ai_service_configs WHERE deleted_at IS NULL').all();
          items = configs.map(c => ({
            model: Array.isArray(c.model) ? c.model[0] : c.model,
            serviceType: c.service_type, provider: c.provider,
            totalCalls: 0, successCount: 0, failedCount: 0,
            successRate: 0, avgLatency: 0, totalCost: 0, avgQuality: null,
          }));
        } catch (_) {}
      }

      // 汇总
      const summary = {
        totalModels: items.length,
        totalCalls: items.reduce((s, i) => s + i.totalCalls, 0),
        totalCost: items.reduce((s, i) => s + Number(i.totalCost || 0), 0),
        avgSuccessRate: items.length > 0
          ? Number((items.reduce((s, i) => s + i.successRate, 0) / items.length).toFixed(2))
          : 0,
      };

      response.success(res, { items, summary });
    } catch (err) {
      response.internalError(res, err.message);
    }
  });

  /**
   * AI洞察：自动检测指标异常波动，生成自然语言洞察
   */
  const getAiInsights = withPerfLog('admin/stats/insights', async (req, res) => {
    try {
      const insights = [];

      // 1. 检查今日 vs 昨日的生成失败率
      try {
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        let todayFailed = 0, todayTotal = 0, yesterdayFailed = 0, yesterdayTotal = 0;
        try {
          const tRow = db.prepare(`SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) as failed
            FROM ai_model_call_logs WHERE SUBSTR(created_at,1,10) = ?`).get(today);
          todayTotal = tRow?.total || 0; todayFailed = tRow?.failed || 0;
          const yRow = db.prepare(`SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status IN ('failed','error') THEN 1 ELSE 0 END) as failed
            FROM ai_model_call_logs WHERE SUBSTR(created_at,1,10) = ?`).get(yesterday);
          yesterdayTotal = yRow?.total || 0; yesterdayFailed = yRow?.failed || 0;
        } catch (_) {}

        if (todayTotal > 0) {
          const todayRate = (todayFailed / todayTotal) * 100;
          const yesterdayRate = yesterdayTotal > 0 ? (yesterdayFailed / yesterdayTotal) * 100 : 0;
          if (todayRate > yesterdayRate + 10) {
            insights.push({
              level: 'warning',
              type: 'failure_rate',
              message: `今日生成失败率 ${todayRate.toFixed(1)}%，较昨日上升 ${(todayRate - yesterdayRate).toFixed(1)} 个百分点`,
              data: { todayRate, yesterdayRate, todayFailed, todayTotal },
            });
          }
        }
      } catch (_) {}

      // 2. 检查熔断状态
      try {
        const openCircuits = db.prepare("SELECT * FROM ai_model_circuit_state WHERE state = 'open'").all();
        for (const c of openCircuits) {
          insights.push({
            level: 'critical',
            type: 'circuit_open',
            message: `模型 ${c.model}（配置#${c.config_id}）当前处于熔断状态，连续失败 ${c.failure_count} 次`,
            data: { configId: c.config_id, model: c.model, failureCount: c.failure_count },
          });
        }
      } catch (_) {}

      // 3. 审核违规趋势
      try {
        const violations = db.prepare(`SELECT COUNT(*) as c FROM content_moderation_logs WHERE verdict = 'violation' AND SUBSTR(created_at,1,10) = ?`).get(new Date().toISOString().slice(0, 10));
        if (violations?.c > 0) {
          insights.push({
            level: 'warning',
            type: 'moderation_violation',
            message: `今日检测到 ${violations.c} 条违规内容，请关注内容安全`,
            data: { violations: violations.c },
          });
        }
      } catch (_) {}

      // 4. 创作漏斗转化预警
      try {
        const totalDramas = db.prepare('SELECT COUNT(*) as c FROM dramas').get().c || 0;
        const totalStoryboards = db.prepare('SELECT COUNT(*) as c FROM storyboards WHERE deleted_at IS NULL').get().c || 0;
        if (totalDramas > 10 && totalStoryboards === 0) {
          insights.push({
            level: 'info',
            type: 'funnel_drop',
            message: `已创建 ${totalDramas} 个项目但尚无分镜生成，建议引导用户完成分镜创作`,
            data: { totalDramas, totalStoryboards },
          });
        }
      } catch (_) {}

      response.success(res, { insights, generatedAt: new Date().toISOString() });
    } catch (err) {
      response.internalError(res, err.message);
    }
  });

  return {
    getStats,
    getStatsTrend,
    getConsumptionBreakdown,
    // S4-T05 新增
    getCreationFunnel,
    getModelCost,
    getAiInsights,
    getUsers,
    createUser,
    updateUser,
    deleteUser,
    getEnterprises,
    createEnterprise,
    updateEnterprise,
    deleteEnterprise,
    getTeams,
    createTeam,
    updateTeam,
    deleteTeam,
    getDataAnomalies,
    getAnomalyConfig,
    fixDataAnomaly,

    // ---------- 异常告警：通知渠道 ----------
    async listAlertChannels(_req, res) {
      try { response.success(res, alertService.listChannels(db)); }
      catch (e) { response.internalError(res, e.message); }
    },
    async createAlertChannel(req, res) {
      try {
        const id = alertService.createChannel(db, req.body || {});
        response.success(res, { id });
      } catch (e) { response.badRequest(res, e.message); }
    },
    async updateAlertChannel(req, res) {
      try {
        const r = alertService.updateChannel(db, req.params.id, req.body || {});
        response.success(res, r);
      } catch (e) { response.badRequest(res, e.message); }
    },
    async deleteAlertChannel(req, res) {
      try {
        const r = alertService.deleteChannel(db, req.params.id);
        response.success(res, r);
      } catch (e) { response.badRequest(res, e.message); }
    },

    // ---------- 异常告警：事件历史 ----------
    async listAlertEvents(req, res) {
      try {
        const list = alertService.listEvents(db, req.query || {});
        response.success(res, list);
      } catch (e) { response.internalError(res, e.message); }
    },

    // ---------- 异常告警：手动触发 1 条异常发通知（调试用）----------
    async dispatchAlertForAnomaly(req, res) {
      try {
        const anomalyId = String(req.params.id || '');
        const parts = anomalyId.split('_');
        const prefix = parts.slice(0, parts.length - 1).join('_');
        const keyId = Number(parts[parts.length - 1]);
        // 通用：读列 → 动态拼 SELECT
        function pickCols(table, wanted) {
          if (!getColumns) return wanted;
          const cs = getColumns(table);
          // 注意 getColumns 返回的 Set 统一转小写
          return wanted.filter(c => cs.has(c.toLowerCase()));
        }
        let item = null;
        if (prefix === 'neg_bal' && hasColumn('point_logs', 'balance_after')) {
          const cols = pickCols('point_logs', ['id','user_id','amount','balance_after','reason','created_at']);
          if (!cols.length) return response.badRequest(res, 'point_logs 缺少可查询列');
          const r = db.prepare(`SELECT ${cols.join(',')} FROM point_logs WHERE id=?`).get(keyId);
          if (r) item = { id: anomalyId, type: 'negative_balance', severity: 'critical', reason: `[手动触发] point_logs#${r.id} balance_after=${r.balance_after}`, row: r };
        } else if (prefix === 'userbalneg' && hasColumn('users', 'balance')) {
          const cols = pickCols('users', ['id','balance','nickname','phone']);
          if (!cols.length) return response.badRequest(res, 'users 缺少可查询列');
          const r = db.prepare(`SELECT ${cols.join(',')} FROM users WHERE id=?`).get(keyId);
          if (r) item = { id: anomalyId, type: 'negative_user_balance', severity: 'critical', reason: `[手动触发] 用户#${r.id} balance=${r.balance}`, row: r };
        } else if (prefix === 'mismatch' && hasColumn('users', 'balance') && hasColumn('point_logs', 'balance_after')) {
          const uCols = pickCols('users', ['id','balance','nickname','phone']).map(c => 'u.' + c);
          const pColsEx = ['pl.balance_after AS log_balance','pl.id AS log_id'];
          const r = db.prepare(`SELECT ${uCols.join(',')}, ${pColsEx.join(',')}
            FROM users u JOIN point_logs pl ON pl.id=(SELECT id FROM point_logs WHERE user_id=u.id ORDER BY id DESC LIMIT 1) WHERE u.id=?`).get(keyId);
          if (r) item = { id: anomalyId, type: 'balance_mismatch', severity: 'critical', reason: `[手动触发] balance=${r.balance} vs 日志#${r.log_id} balance_after=${r.log_balance}`, row: r };
        } else if (prefix === 'bigamt' && hasColumn('point_logs', 'amount')) {
          const cols = pickCols('point_logs', ['id','user_id','amount','balance_after','reason','created_at']);
          const r = db.prepare(`SELECT ${cols.join(',')} FROM point_logs WHERE id=?`).get(keyId);
          if (r) item = { id: anomalyId, type: 'huge_amount', severity: 'warning', reason: `[手动触发] 单笔 amount=${r.amount}`, row: r };
        }
        if (!item) return response.badRequest(res, '异常不存在或缺少列，无法手动触发告警');
        const results = await alertService.dispatchItem({ db, log }, item, req.body || {});
        response.success(res, { total: results.length, results });
      } catch (e) {
        log.error('dispatchAlertForAnomaly', { error: e.message, stack: e.stack });
        response.internalError(res, e.message);
      }
    },

    // ---------- 异常告警：跑一遍 scanAndAlert（全量扫描 + 批量发通知）----------
    async runAlertScan(req, res) {
      try {
        const r = await alertService.scanAndAlert({ db, log, overrides: req.query || req.body || {} });
        response.success(res, r);
      } catch (e) {
        log.error('runAlertScan', { error: e.message, stack: e.stack });
        response.internalError(res, e.message);
      }
    },
    /**
     * 测试/脚本专用：返回一份"纯函数风格"的修复器，不依赖 Express / 全局 log / 全局 response。
     * 用法：const fix = adminRoutes.createFixTester(db, cfg); const r = await fix('neg_bal_42');
     *
     * 返回 Promise<{ok:boolean, status:number, code?:string, message:string, affected?:number, raw?:any}>
     *   ok=true 时 status=200；BadRequest 时 status=400；内部错误 status=500。
     *
     * @param {import('better-sqlite3').Database | typeof import('./db').MySqlWrapper} dbLike 已连接的数据库实例
     * @param {{amountThreshold?:number,balanceThreshold?:number,defaultLimit?:number,logLevel?:'debug'|'info'|'warn'}} [cfg]
     */
    createFixTester(dbLike, cfg) {
      const logger = { debug:()=>{}, info:()=>{}, warn:()=>{}, error:()=>{} };
      return buildFixDataAnomaly({
        db: dbLike,
        cfg: cfg || ANOMALY_CFG,
        log: logger
      });
    },
    // 暴露 buildFixDataAnomaly 方便测试单独 import 构造（createFixTester 受限于 adminRoutes(db) 需要完整依赖）
    __buildFixDataAnomaly: buildFixDataAnomaly
  };
}

module.exports = adminRoutes;