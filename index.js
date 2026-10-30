const fp = require('fastify-plugin');
const path = require('node:path');

module.exports = fp(async function (fastify, options) {
  options = Object.assign(
    {},
    {
      name: 'message',
      dbTableNamePrefix: 't_message_',
      prefix: '/api/v1/message',
      getUserModel: () => {
        if (!fastify.account) {
          throw new Error('fastify-account plugin must be registered before fastify-message,or set options.getUserModel');
        }
        return fastify.account.models.user;
      },
      senders: {},
      getAuthenticate: type => {
        if (!fastify.account) {
          return [
            () => {
              throw new Error('fastify-account plugin must be registered before fastify-message,or set options.getAuthenticate');
            }
          ];
        }
        const { authenticate } = fastify.account;
        return [authenticate.user, authenticate.admin];
      }
    },
    options
  );

  fastify.register(require('@kne/fastify-statistics'), {
    dbTableNamePrefix: options.dbTableNamePrefix,
    modelPrefix: `${options.name}Statistics`,
    prefix: options.prefix,
    name: `${options.name}Statistics`
  });

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
      ['services', path.resolve(__dirname, './libs/services')],
      ['controllers', path.resolve(__dirname, './libs/controllers')]
    ]
  });

  fastify.register(
    fp(async (fastify, options) => {
      const { services } = fastify[options.name];
      fastify.sequelize.syncPromise
        .then(async () => {
          if (options.autoUpgrade !== false) {
            await services.upgradeSchema();
            await services.migrateTemplates();
          }
          await services.includeTemplate(options.templateDir);
          if (!options.isTest) {
            await services.processPendingRecords();
          }
        })
        .catch(e => fastify.log.error(e, '[fastify-message] 初始化失败'));
    }),
    options
  );
});
