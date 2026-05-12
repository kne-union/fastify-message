const fp = require('fastify-plugin');
const path = require('node:path');

module.exports = fp(async function(fastify, options) {
  options = Object.assign({}, {
    name: 'message', dbTableNamePrefix: 't_message_', prefix: '/api/v1/message', getUserModel: () => {
      if (!fastify.account) {
        throw new Error('fastify-account plugin must be registered before fastify-message,or set options.getUserModel');
      }
      return fastify.account.models.user;
    }, senders: {}, getAuthenticate: (type) => {
      if (!fastify.account) {
        throw new Error('fastify-account plugin must be registered before fastify-message,or set options.getAuthenticate');
      }
      const { authenticate } = fastify.account;
      return [authenticate.user, authenticate.admin];
    }
  }, options);

  fastify.register(require('@kne/fastify-namespace'), {
    name: options.name,
    options,
    modules: [['models', await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
      prefix: options.dbTableNamePrefix, getUserModel: options.getUserModel
    })], ['services', path.resolve(__dirname, './libs/services')], ['controllers', path.resolve(__dirname, './libs/controllers')]]
  });

  fastify.register(fp((fastify, options) => {
    fastify.sequelize.syncPromise.then(() => {
      return fastify[options.name].services.includeTemplate(options.templateDir);
    });
  }), options);
});
