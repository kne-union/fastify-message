const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify.project;
  fastify.get(
    `${options.prefix}/welcome`,
    {
      onRequest: [],
      schema: {
        description: '接口说明',
        summary: '接口主题',
        query: {},
        response: {
          200: {
            description: '返回值说明',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', description: '信息' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async request => {
      return { message: 'welcome' };
    }
  );
});
