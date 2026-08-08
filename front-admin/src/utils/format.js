/**
 * 数字/积分展示工具（兼容 Dashboard 统计卡片、Y 轴刻度、Tooltip 等场景）
 */

/**
 * 千分位整数格式化（不显示小数点后的 0）
 * @param {number} v
 * @returns {string}
 * @example 1234567 -> "1,234,567"
 */
export function fmtInt(v) {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString('zh-CN');
}

/**
 * 金额格式化（元，千分位 + 最多 2 位小数）
 */
export function fmtYuan(v, { prefix = '￥' } = {}) {
  const n = Number(v) || 0;
  return prefix + n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * 中文大数缩写（万 / 亿 / 万亿），用于趋势图 Y 轴 / 统计卡片等紧凑场景
 * - < 1 万：整数千分位
 * - ≥ 1 万 且 < 1 亿：X.X 万（保留 1 位小数）
 * - ≥ 1 亿 且 < 1 万亿：X.XX 亿（保留 2 位小数，因为亿已经很大，需要精度）
 * - ≥ 1 万亿：X.XX 万亿
 * - 负值：保留负号，绝对值转换后再加回去
 *
 * @param {number} raw 原始数值
 * @param {object} opts
 * @param {boolean} [opts.forceSuffix] 是否始终带后缀（当 < 1 万时是否显示"个"或空）
 * @param {string} [opts.unit] 追加单位（如"积分"、"元"），仅在 < 1 万时追加，避免与 万/亿 混淆
 * @returns {string}
 */
export function fmtBigNumber(raw, opts = {}) {
  const { forceSuffix = false, unit = '' } = opts;
  const n = Number(raw);
  if (!isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  if (abs < 10000) {
    // 小于 1 万：千分位 + 可选单位
    const body = fmtInt(abs);
    return sign + body + (forceSuffix ? unit : unit);
  }
  if (abs < 1e8) {
    // 1 万 ~ 1 亿
    const body = (abs / 1e4).toFixed(1);
    return sign + body + '万';
  }
  if (abs < 1e12) {
    // 1 亿 ~ 1 万亿
    const body = (abs / 1e8).toFixed(2);
    return sign + body + '亿';
  }
  // ≥ 1 万亿
  const body = (abs / 1e12).toFixed(2);
  return sign + body + '万亿';
}

/**
 * ECharts axisLabel formatter：返回"中文缩写 + 原始 tooltip 值"
 * 当图表需要在 Y 轴刻度使用缩写、但在 Tooltip 里显示完整千分位时使用
 * @returns {(v:number)=>string}
 */
export function makeYAxisFormatter() {
  return function yAxisFmt(v) {
    return fmtBigNumber(v);
  };
}

/**
 * Tooltip 里显示的完整数值（千分位 + 单位）
 */
export function fmtTooltipPoints(v) {
  return fmtInt(v) + ' 积分';
}
export function fmtTooltipYuan(v) {
  return fmtYuan(v);
}
