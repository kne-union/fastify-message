const fp = require('fastify-plugin');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const {
  CONFIG_CONSTANTS
} = require('../utils/config');

dayjs.extend(utc);
dayjs.extend(timezone);

// 查询用客户端时间：parseRange 使用客户端时区计算日期范围
const parseRange = (range = '7d', tz) => {
  const config = CONFIG_CONSTANTS.TIME_RANGES[range];
  if (!config) {
    throw new Error(`不支持的时间范围: ${range}, 支持: ${Object.keys(CONFIG_CONSTANTS.TIME_RANGES).join(',')}`);
  }
  // 写入数据全使用服务器时间，查询用客户端时间
  const now = tz ? dayjs().tz(tz) : dayjs();
  const unitStartMap = { day: 'day', month: 'month', year: 'year' };
  const startUnit = unitStartMap[config.unit];
  const startTime = startUnit
    ? now.subtract(config.value, startUnit).startOf(startUnit)
    : now.subtract(config.value, config.unit);
  return { startTime: startTime.toDate(), endTime: now.toDate(), label: config.label, range };
};

// 查询用客户端时间：formatDate 使用客户端时区格式化日期
const formatDate = (date, tz) => {
  const d = tz ? dayjs(date).tz(tz) : dayjs(date);
  return d.format('YYYY-MM-DD');
};

// 查询用客户端时间：提取客户端时区下的小时
const getHour = (date, tz) => {
  const d = tz ? dayjs(date).tz(tz) : dayjs(date);
  return d.hour();
};

const safeNum = v => {
  const n = Number(v);
  return (typeof n === 'number' && !isNaN(n) ? n : 0);
};

const getSumData = item => (item.data || {}).sum || item.data || {};

// channel 格式: "code" (1段) 或 "code:type" (2段)
// code = 模板编码, type = 消息类型 (0=邮件, 1=短信)
const parseChannel = channel => {
  const parts = channel.split(':');
  return parts.length >= 2
    ? { code: parts[0], type: parts[1] }
    : { code: channel, type: null };
};

const buildChannels = async (statisticsServices, code, type) => {
  const metaResult = await statisticsServices.channelMeta.list();
  const list = Array.isArray(metaResult) ? metaResult : metaResult.list || [];
  const rootChannels = list.map(meta => meta.channel).filter(Boolean);
  const codes = code ? rootChannels.filter(ch => ch === code) : rootChannels;
  const messageTypes = type !== undefined && type !== null ? [String(type)] : ['0', '1'];
  const channels = [];
  for (const c of codes) {
    channels.push(c);
    for (const mt of messageTypes) channels.push(`${c}:${mt}`);
  }
  return channels;
};

// 创建空的 dailyMap 条目
const createDailyMapEntry = () => ({
  total: 0,
  byType: {}
});

// 查询 statistics 并解析结果
const queryAndParse = async (statisticsServices, { channels, startTime, endTime, timezone: tz, type: typeFilter }) => {
  if (channels.length === 0) return null;

  const statResult = await statisticsServices.query({
    channels, startTime, endTime,
    attributeNames: CONFIG_CONSTANTS.STATISTICS_ATTRIBUTES,
    aggregates: ['sum'],
    timezone: tz || undefined
  });

  const result = {
    totalRecords: 0,
    byType: {},
    byCode: {},
    dailyMap: {},
    hourlyMap: {},
    hourlyTypeMap: {}
  };

  for (const item of statResult.list || []) {
    const { code: codeName, type: typeName } = parseChannel(item.channel);
    if (typeFilter !== undefined && typeFilter !== null && typeName && typeName !== String(typeFilter)) continue;
    if (typeFilter !== undefined && typeFilter !== null && !typeName) continue;

    const sum = getSumData(item);
    const count = safeNum(sum.total);
    const isHourly = item.period === 'h';
    const date = formatDate(item.time, tz);
    const hour = isHourly ? getHour(item.time, tz) : null;

    // ─── 1-segment channel: 全局 + 按日 聚合 ───
    if (!typeName) {
      result.totalRecords += count;
      result.byCode[codeName] = (result.byCode[codeName] || 0) + count;

      // 按日汇总
      if (!result.dailyMap[date]) result.dailyMap[date] = createDailyMapEntry();
      result.dailyMap[date].total += count;

      // 小时级趋势（仅 period='h'）
      if (isHourly) {
        if (!result.hourlyMap[date]) result.hourlyMap[date] = {};
        result.hourlyMap[date][hour] = (result.hourlyMap[date][hour] || 0) + count;
      }
    }

    // ─── 2-segment channel: byType 聚合 ───
    if (typeName) {
      result.byType[typeName] = (result.byType[typeName] || 0) + count;

      if (result.dailyMap[date]) {
        result.dailyMap[date].byType[typeName] = (result.dailyMap[date].byType[typeName] || 0) + count;
      }

      if (isHourly) {
        if (!result.hourlyTypeMap[date]) result.hourlyTypeMap[date] = {};
        if (!result.hourlyTypeMap[date][hour]) result.hourlyTypeMap[date][hour] = {};
        result.hourlyTypeMap[date][hour][typeName] = (result.hourlyTypeMap[date][hour][typeName] || 0) + count;
      }
    }
  }

  return result;
};

// 构建历史日趋势数组
const buildDailyTrendArrays = (parsed) => {
  const sorted = Object.entries(parsed.dailyMap).sort(([a], [b]) => a.localeCompare(b));
  const recentTrend = sorted.map(([date, d]) => ({ date, count: d.total }));
  const recentTrendByType = [];
  sorted.forEach(([date, d]) => {
    Object.entries(d.byType).forEach(([type, count]) => recentTrendByType.push({ date, type: Number(type), count }));
  });
  return { recentTrend, recentTrendByType };
};

// 构建小时趋势数组
const buildHourlyTrendArrays = (parsed, todayStr) => {
  const hourlyTrend = [];
  const hourlyTrendByType = [];

  const dates = Object.keys(parsed.hourlyMap).sort();
  for (const date of dates) {
    const hoursMap = parsed.hourlyMap[date] || {};
    const typeMap = parsed.hourlyTypeMap[date] || {};

    // 只处理当天的数据（SSE 场景），或所有数据（历史场景）
    const allHours = [...new Set([
      ...Object.keys(hoursMap).map(Number),
      ...Object.keys(typeMap).reduce((acc, h) => {
        acc.push(Number(h));
        return acc;
      }, [])
    ])].sort((a, b) => a - b);

    for (const hour of allHours) {
      if (todayStr && date !== todayStr) continue;
      hourlyTrend.push({
        date, hour,
        count: hoursMap[hour] || 0
      });

      const types = typeMap[hour] || {};
      for (const [typeName, count] of Object.entries(types)) {
        if (count > 0) hourlyTrendByType.push({ date, hour, type: Number(typeName), count });
      }
    }
  }

  return { hourlyTrend, hourlyTrendByType };
};

module.exports = fp(async (fastify, options) => {
  const statisticsServices = fastify[`${options.name}Statistics`].services;
  const { template: TemplateModel } = fastify[options.name].models;
  const { Sequelize } = TemplateModel.sequelize;

  // ─── queryStatistics (history 接口) ───
  const queryStatistics = async ({ range = '7d', timezone, type, code }) => {
    const { startTime, endTime, label, range: rangeKey } = parseRange(range, timezone);
    const emptyResult = {
      range: rangeKey, rangeLabel: label,
      totalRecords: 0, byType: {}, byCode: {},
      recentTrend: [], recentTrendByType: [],
      hourlyTrend: [], hourlyTrendByType: [],
      templateStats: { total: 0, byStatus: {}, byType: {} }
    };
    try {
      const channels = await buildChannels(statisticsServices, code, type);
      const parsed = await queryAndParse(statisticsServices, { channels, startTime, endTime, timezone, type });
      if (!parsed) return emptyResult;

      const { recentTrend, recentTrendByType } = buildDailyTrendArrays(parsed);
      const { hourlyTrend, hourlyTrendByType } = buildHourlyTrendArrays(parsed);

      // 查询模板统计（独立于 statistics 服务）
      const [totalTemplates, templatesByStatus, templatesByType] = await Promise.all([
        TemplateModel.count(),
        TemplateModel.findAll({
          attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
          group: ['status'],
          raw: true
        }),
        TemplateModel.findAll({
          attributes: ['type', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
          group: ['type'],
          raw: true
        })
      ]);

      return {
        range: rangeKey, rangeLabel: label,
        totalRecords: parsed.totalRecords,
        byType: parsed.byType,
        byCode: parsed.byCode,
        recentTrend, recentTrendByType,
        hourlyTrend, hourlyTrendByType,
        templateStats: {
          total: totalTemplates,
          byStatus: templatesByStatus.reduce((acc, item) => {
            acc[String(item.status)] = Number(item.count);
            return acc;
          }, {}),
          byType: templatesByType.reduce((acc, item) => {
            acc[String(item.type)] = Number(item.count);
            return acc;
          }, {})
        }
      };
    } catch (e) {
      fastify.log.error(`查询统计数据失败: ${e.message}`);
      return emptyResult;
    }
  };

  // ─── buildSseData (SSE 接口) ───
  const buildSseData = async ({ timezone: tz, type, code }) => {
    // 查询用客户端时间："今天"的边界使用客户端时区
    const now = tz ? dayjs().tz(tz) : dayjs();
    const todayStart = now.startOf('day').toDate();
    const todayEnd = now.endOf('day').toDate();
    const todayStr = now.format('YYYY-MM-DD');

    // 默认值
    let totalRecords = 0;
    let byType = {};
    let byCode = {};
    let hourlyTrend = [];
    let hourlyTrendByType = [];
    let intervalTrend = [];

    try {
      const channels = await buildChannels(statisticsServices, code, type);
      const parsed = await queryAndParse(statisticsServices, { channels, startTime: todayStart, endTime: todayEnd, timezone: tz, type });
      if (parsed) {
        totalRecords = parsed.totalRecords;
        byType = parsed.byType;
        byCode = parsed.byCode;

        const hourlyArrays = buildHourlyTrendArrays(parsed, todayStr);

        // SSE 格式：简化为 {hour, count}
        hourlyTrend = hourlyArrays.hourlyTrend
          .filter(h => h.date === todayStr)
          .map(({ hour, count }) => ({ hour, count }));

        hourlyTrendByType = hourlyArrays.hourlyTrendByType
          .filter(h => h.date === todayStr)
          .map(({ hour, type, count }) => ({ hour, type, count }));

        intervalTrend = hourlyTrend.map(({ hour, count }) => ({
          interval: `${String(hour).padStart(2, '0')}:00`,
          count
        }));
      }
    } catch (e) {
      fastify.log.error(`SSE统计查询失败: ${e.message}`);
    }

    return {
      date: todayStr,
      totalRecords,
      byType,
      byCode,
      hourlyTrend,
      hourlyTrendByType,
      intervalTrend
    };
  };

  // ─── sseStatistics ───
  const sseStatistics = async ({ range = '7d', timezone, type, code, interval }, reply) => {
    await statisticsServices.sseStream.send(reply, {
      name: `${options.name}Statistics`,
      params: { type, code, timezone },
      fetchData: async ({ type, code, timezone } = {}) => {
        try {
          return await buildSseData({ timezone, type, code });
        } catch (e) {
          fastify.log.error(`SSE获取数据失败: ${e.message}`);
          return {};
        }
      },
      interval: interval || 5
    });
  };

  Object.assign(fastify[options.name].services, {
    queryStatistics,
    sseStatistics
  });
});
