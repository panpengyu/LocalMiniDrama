/**
 * 分页相关默认值（所有列表接口共享，避免魔法数字散落各处）。
 * 若某个接口需要不同的默认分页大小，请在该接口处显式传参覆盖。
 */
const DEFAULT_PAGE_SIZE = 20;

module.exports = { DEFAULT_PAGE_SIZE };
