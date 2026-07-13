const ROLE_LEVELS = {
  super_admin: 5,
  enterprise_admin: 4,
  team_admin: 3,
  team_member: 2,
  individual: 1,
  user: 1
};

function getUserRoleLevel(role) {
  return ROLE_LEVELS[role] || ROLE_LEVELS.user;
}

function isSuperAdmin(user) {
  return user.role === 'super_admin';
}

function canViewDrama(user, drama) {
  if (isSuperAdmin(user)) {
    return true;
  }
  
  if (user.role === 'enterprise_admin') {
    return user.enterprise_id === drama.enterprise_id;
  }
  
  if (user.role === 'team_admin') {
    return user.team_id === drama.team_id;
  }
  
  if (user.role === 'team_member') {
    return user.team_id === drama.team_id;
  }
  
  return user.id === drama.created_by;
}

function getDramaListFilter(user) {
  if (isSuperAdmin(user)) {
    return { sql: '', params: [] };
  }
  
  if (user.role === 'enterprise_admin') {
    return {
      sql: ' AND enterprise_id = ?',
      params: [user.enterprise_id]
    };
  }
  
  if (user.role === 'team_admin' || user.role === 'team_member') {
    return {
      sql: ' AND team_id = ?',
      params: [user.team_id]
    };
  }
  
  return {
    sql: ' AND created_by = ?',
    params: [user.id]
  };
}

module.exports = {
  getUserRoleLevel,
  isSuperAdmin,
  canViewDrama,
  getDramaListFilter,
  ROLE_LEVELS
};