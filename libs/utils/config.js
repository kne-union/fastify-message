/**
 * 配置常量定义
 */
const CONFIG_CONSTANTS = {
  // 时间范围
  TIME_RANGES: {
    '7d': { value: 7, unit: 'day', label: '近7天' },
    '1m': { value: 1, unit: 'month', label: '近1个月' },
    '3m': { value: 3, unit: 'month', label: '近3个月' },
    '1y': { value: 1, unit: 'year', label: '近1年' }
  },

  // 统计相关
  STATISTICS_ATTRIBUTES: ['total', 'success', 'failed'],
  STATISTICS_PERIODS: ['h', 'd']
};

module.exports = { CONFIG_CONSTANTS };
