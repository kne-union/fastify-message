const fp = require('fastify-plugin');
const path = require('node:path');

module.exports = fp(async function (fastify, options) {
  options = Object.assign(
    {},
    {
      name: 'message',
      dbTableNamePrefix: 't_message_',
      getUserModel: () => {
        if (!fastify.account) {
          throw new Error('fastify-account plugin must be registered before fastify-trtc-conference,or set options.getUserModel');
        }
        return fastify.account.models.user;
      }
    },
    options
  );

  fastify.register(require('@kne/fastify-namespace'), {
    name: options.name,
    options,
    modules: [
      [
        'models',
        await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
          prefix: options.dbTableNamePrefix,
          getUserModel: options.getUserModel
        })
      ],
      ['services', path.resolve(__dirname, './libs/services')]
    ]
  });

  fastify.register(async (fastify, options) => {
    await fastify[options.name].services.includeTemplate(options.templateDir);
  }, options);
});
