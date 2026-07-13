/**
 * 管理员路由模块
 * 
 * 提供超级管理员专属的后台管理功能，包括用户管理、企业管理、团队管理和统计数据查询。
 * 所有接口均需 super_admin 角色权限验证。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @returns {object} 管理员路由处理函数集合
 */
const response = require('../response');

function adminRoutes(db, log) {
  /**
   * 获取系统统计数据
   * 
   * 返回用户数、项目数、企业数、团队数及项目状态分布等统计信息。
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @returns {object} 统计数据对象
   */
  async function getStats(req, res) {
    try {
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const projectCount = db.prepare('SELECT COUNT(*) as count FROM dramas').get().count;
      const enterpriseCount = db.prepare('SELECT COUNT(*) as count FROM enterprises').get().count;
      const teamCount = db.prepare('SELECT COUNT(*) as count FROM teams').get().count;
      
      const individualCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE user_type = ?').get('individual').count;
      const enterpriseUserCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE user_type = ?').get('enterprise').count;
      
      const draftCount = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'draft'").get().count;
      const publishedCount = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'published'").get().count;
      const generatingCount = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'generating'").get().count;
      const archivedCount = db.prepare("SELECT COUNT(*) as count FROM dramas WHERE status = 'archived'").get().count;

      response.success(res, {
        totalUsers: userCount,
        totalProjects: projectCount,
        totalEnterprises: enterpriseCount,
        totalTeams: teamCount,
        individualUsers: individualCount,
        enterpriseUsers: enterpriseUserCount,
        draftProjects: draftCount,
        publishedProjects: publishedCount,
        generatingProjects: generatingCount,
        archivedProjects: archivedCount
      });
    } catch (err) {
      log.error('admin/stats', { error: err.message });
      response.internalError(res, err.message);
    }
  }

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
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.name - 企业名称
   * @param {string} [req.body.contact_person] - 联系人
   * @param {string} [req.body.contact_phone] - 联系电话
   * @param {string} [req.body.address] - 地址
   * @param {string} [req.body.remark] - 备注
   * @returns {object} 创建的企业信息
   */
  async function createEnterprise(req, res) {
    try {
      const { name, contact_person, contact_phone, address, remark } = req.body;
      
      if (!name) {
        return response.badRequest(res, '企业名称不能为空');
      }
      
      const result = db.prepare(
        'INSERT INTO enterprises (name, contact_person, contact_phone, address, remark, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())'
      ).run(name, contact_person || '', contact_phone || '', address || '', remark || '');
      
      const enterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?').get(result.lastInsertRowid);
      response.success(res, { enterprise, message: '创建成功' });
    } catch (err) {
      log.error('admin/enterprises/create', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 更新企业信息
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 企业ID
   * @param {string} [req.body.name] - 企业名称
   * @param {string} [req.body.contact_person] - 联系人
   * @param {string} [req.body.contact_phone] - 联系电话
   * @param {string} [req.body.address] - 地址
   * @param {string} [req.body.remark] - 备注
   * @param {number} [req.body.status] - 状态
   * @returns {object} 更新后的企业信息
   */
  async function updateEnterprise(req, res) {
    try {
      const { id } = req.params;
      const { name, contact_person, contact_phone, address, remark, status } = req.body;
      
      const updates = [];
      const params = [];
      
      if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
      }
      if (contact_person !== undefined) {
        updates.push('contact_person = ?');
        params.push(contact_person);
      }
      if (contact_phone !== undefined) {
        updates.push('contact_phone = ?');
        params.push(contact_phone);
      }
      if (address !== undefined) {
        updates.push('address = ?');
        params.push(address);
      }
      if (remark !== undefined) {
        updates.push('remark = ?');
        params.push(remark);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
      }
      
      if (updates.length === 0) {
        return response.badRequest(res, '没有需要更新的字段');
      }
      
      updates.push('updated_at = NOW()');
      params.push(id);
      
      db.prepare(`UPDATE enterprises SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      
      const enterprise = db.prepare('SELECT * FROM enterprises WHERE id = ?').get(id);
      response.success(res, { enterprise, message: '更新成功' });
    } catch (err) {
      log.error('admin/enterprises/update', { error: err.message });
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
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {string} req.body.name - 团队名称
   * @param {number} [req.body.enterprise_id] - 所属企业ID
   * @param {string} [req.body.description] - 描述
   * @returns {object} 创建的团队信息
   */
  async function createTeam(req, res) {
    try {
      const { name, enterprise_id, description } = req.body;
      
      if (!name) {
        return response.badRequest(res, '团队名称不能为空');
      }
      
      const result = db.prepare(
        'INSERT INTO teams (name, enterprise_id, description, status, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(), NOW())'
      ).run(name, enterprise_id || null, description || '');
      
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
      response.success(res, { team, message: '创建成功' });
    } catch (err) {
      log.error('admin/teams/create', { error: err.message });
      response.internalError(res, err.message);
    }
  }

  /**
   * 更新团队信息
   * 
   * @param {object} req - Express 请求对象
   * @param {object} res - Express 响应对象
   * @param {number} req.params.id - 团队ID
   * @param {string} [req.body.name] - 团队名称
   * @param {number} [req.body.enterprise_id] - 所属企业ID
   * @param {string} [req.body.description] - 描述
   * @param {number} [req.body.status] - 状态
   * @returns {object} 更新后的团队信息
   */
  async function updateTeam(req, res) {
    try {
      const { id } = req.params;
      const { name, enterprise_id, description, status } = req.body;
      
      const updates = [];
      const params = [];
      
      if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
      }
      if (enterprise_id !== undefined) {
        updates.push('enterprise_id = ?');
        params.push(enterprise_id);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }
      if (status !== undefined) {
        updates.push('status = ?');
        params.push(status);
      }
      
      if (updates.length === 0) {
        return response.badRequest(res, '没有需要更新的字段');
      }
      
      updates.push('updated_at = NOW()');
      params.push(id);
      
      db.prepare(`UPDATE teams SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      
      const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
      response.success(res, { team, message: '更新成功' });
    } catch (err) {
      log.error('admin/teams/update', { error: err.message });
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

  return {
    getStats,
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
    deleteTeam
  };
}

module.exports = adminRoutes;