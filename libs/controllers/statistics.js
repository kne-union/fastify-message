const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  fastify.get(
    `${options.prefix}/statistics`,
    {
      onRequest: options.getAuthenticate('statistics'),
      schema: {
        summary: '获取消息统计概览',
        query: {
          type: 'object',
          properties: {
            range: { type: 'string', default: '7d', description: '时间范围: 7d=近7天, 1m=近1个月, 3m=近3个月, 1y=近1年' },
            timezone: { type: 'string', description: '时区，如 Asia/Shanghai，默认服务器时区' },
            type: { type: 'integer', description: '按消息类型筛选: 0=邮件, 1=短信' },
            code: { type: 'string', description: '按模板编码筛选' }
          }
        }
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
        summary: 'SSE实时推送消息统计数据',
        query: {
          type: 'object',
          properties: {
            range: { type: 'string', default: '7d', description: '时间范围: 7d=近7天, 1m=近1个月, 3m=近3个月, 1y=近1年' },
            timezone: { type: 'string', description: '时区，如 Asia/Shanghai，默认服务器时区' },
            type: { type: 'integer', description: '按消息类型筛选: 0=邮件, 1=短信' },
            code: { type: 'string', description: '按模板编码筛选' },
            interval: { type: 'integer', minimum: 1, default: 5, description: '推送间隔时间（秒），最小1秒，默认5秒' }
          }
        }
      }
    },
    async (request, reply) => {
      const { range = '7d', timezone, type, code, interval } = request.query;
      await services.sseStatistics({ range, timezone, type, code, interval }, reply);
    }
  );
});
