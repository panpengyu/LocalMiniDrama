import request from '@/utils/request'

/**
 * 管理端 - 运营概览 Dashboard API 封装
 * 所有接口走 /api/v1/admin/* ，后端已通过 requireAuth + requireRole(['super_admin']) 校验
 */
export const dashboardAPI = {
  /**
   * 核心统计（6 个总数 + 详细分布）
   * 返回: {
   *   totalUsers, totalTeams, totalChannels, totalStoryboards,
   *   totalRechargeAmount(元), totalConsumePoints,
   *   // 兼容字段
   *   totalProjects, totalEnterprises, individualUsers, enterpriseUsers,
   *   draftProjects, publishedProjects, generatingProjects, archivedProjects
   * }
   */
  getStats() {
    return request.get('/admin/stats')
  },

  /**
   * 近 N 天（默认 7 天）积分收支趋势
   * 返回: { days, dates: ['YYYY-MM-DD'...], consumePoints: [], rechargePoints: [] }
   */
  getStatsTrend(days = 7) {
    return request.get('/admin/stats/trend', { params: { days } })
  },

  /**
   * 消费构成（按业务分类）
   * 返回: { items: [{ name: '图片生成'|'视频生成'|'文本生成'|'语音合成'|'其他', value }] }
   */
  getConsumptionBreakdown() {
    return request.get('/admin/stats/consumption')
  },

  /**
   * 创作漏斗分析（Sprint 4 - S4-T05/T06）
   * 返回: { stages: [{key,label,count,conversionRate}], overallRate }
   */
  getCreationFunnel() {
    return request.get('/admin/stats/funnel')
  },

  /**
   * 模型成本看板（Sprint 4 - S4-T05/T06）
   * 返回: { items: [{model,serviceType,provider,totalCalls,successCount,failedCount,successRate,avgLatency,totalCost,avgQuality}], summary: {totalModels,totalCalls,totalCost,avgSuccessRate} }
   */
  getModelCost() {
    return request.get('/admin/stats/model-cost')
  },

  /**
   * AI洞察（Sprint 4 - S4-T05/T06）
   * 返回: { insights: [{level,type,message,data}], generatedAt }
   */
  getAiInsights() {
    return request.get('/admin/stats/insights')
  }
}
