const fp = require('fastify-plugin');
const { success, statistics } = require('../schema/response');

const TAG = '消息-统计';

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/statistics`,
    {
      onRequest: options.getAuthenticate('statistics'),
      schema: {
        tags: [TAG],
        summary: '获取消息统计概览',
        description: '按时间范围汇总消息发送数量、类型/模板分布、每日与按小时趋势，以及模板数量统计；不支持的 range 报错，其他查询异常时返回空统计',
        query: {
          type: 'object',
          properties: {
            range: { type: 'string', default: '7d', description: '时间范围: 7d=近7天, 1m=近1个月, 3m=近3个月, 1y=近1年' },
            timezone: { type: 'string', description: '时区，如 Asia/Shanghai，默认服务器时区' },
            type: { type: 'integer', description: '按消息类型筛选: 0=邮件, 1=短信' },
            code: { type: 'string', description: '按模板编码筛选' }
          }
        },
        response: success('消息统计数据', statistics)
      }
    },
    async request => {
      const { range = '7d', timezone, type, code } = request.query;
      return await services.queryStatistics({ range, timezone, type, code });
    }
  );

  // SSE 实时统计数据推送
  fastify.get(
    `${options.prefix}/statistics/sse`,
    {
      onRequest: options.getAuthenticate('statistics'),
      schema: {
        tags: [TAG],
        summary: 'SSE实时推送消息统计数据',
        description: '以 text/event-stream 长连接按 interval 推送当天的实时统计（发送总数、类型/模板分布、按小时趋势等），客户端断开后停止；range 参数当前未使用',
        query: {
          type: 'object',
          properties: {
            range: { type: 'string', default: '7d', description: '时间范围: 7d=近7天, 1m=近1个月, 3m=近3个月, 1y=近1年' },
            timezone: { type: 'string', description: '时区，如 Asia/Shanghai，默认服务器时区' },
            type: { type: 'integer', description: '按消息类型筛选: 0=邮件, 1=短信' },
            code: { type: 'string', description: '按模板编码筛选' },
            interval: { type: 'integer', minimum: 1, default: 5, description: '推送间隔时间（秒），最小1秒，默认5秒' }
          }
        },
        response: { 200: { description: 'text/event-stream 事件流，每条 data 为当天实时统计 JSON' } }
      }
    },
    async (request, reply) => {
      const { range = '7d', timezone, type, code, interval } = request.query;
      await services.sseStatistics({ range, timezone, type, code, interval }, reply);
    }
  );
});
