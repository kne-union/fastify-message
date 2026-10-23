const { expect } = require('chai');
const Fastify = require('fastify');

describe('@kne/fastify-message OpenAPI 文档完整性', function () {
  this.timeout(10000);

  it('所有路由都有 tags、summary，参数都有用途说明，并声明 200 响应', async () => {
    const fastify = Fastify({ logger: false });
    const routes = [];
    fastify.addHook('onRoute', route => route.method !== 'HEAD' && routes.push(route));
    await fastify.register(require('@fastify/sensible'));
    await fastify.register(require('fastify-cron'));
    await fastify.register(require('@kne/fastify-sequelize'), {
      db: { dialect: 'sqlite', storage: ':memory:', logging: false }
    });
    const UserModel = fastify.sequelize.instance.define('user', {}, { tableName: 't_user', timestamps: false });
    if (!fastify.sequelize.syncPromise) {
      fastify.sequelize.syncPromise = Promise.resolve();
    }
    await fastify.register(require('../../index'), {
      prefix: '/api/message',
      templateDir: null,
      getUserModel: () => UserModel,
      getAuthenticate: () => []
    });
    await fastify.ready();

    const missing = [];
    const checkProps = (where, schema) => {
      if (!schema) return;
      [].concat(schema.oneOf || [], schema.anyOf || [], schema).forEach(item => {
        Object.entries(item.properties || {}).forEach(([key, prop]) => {
          if (!prop.description) missing.push(`${where}.${key}`);
          if (prop.type === 'object') checkProps(`${where}.${key}`, prop);
        });
      });
    };
    // collect、query、sse 等路由由 @kne/fastify-statistics 注册，不在本插件维护范围
    const messageRoutes = routes.filter(route => /^\/api\/message\/(records|templates|statistics)/.test(route.url));
    messageRoutes.forEach(route => {
      const { schema = {} } = route;
      const name = `${route.method} ${route.url}`;
      if (!(schema.tags && schema.tags.length)) missing.push(`${name} tags`);
      if (!schema.summary) missing.push(`${name} summary`);
      if (!(schema.response && schema.response[200] && schema.response[200].description)) missing.push(`${name} response`);
      checkProps(`${name} body`, schema.body);
      checkProps(`${name} query`, schema.querystring || schema.query);
      checkProps(`${name} params`, schema.params);
    });
    await fastify.close();
    expect(messageRoutes.length).to.equal(7);
    expect(missing).to.deep.equal([]);
  });
});
