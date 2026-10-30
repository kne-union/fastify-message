const Fastify = require('fastify');
const { DataTypes } = require('sequelize');
const qs = require('qs');
const http = require('node:http');

const createTestUserModel = sequelize => {
  return sequelize.define('user', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    username: {
      type: DataTypes.STRING
    }
  }, {
    tableName: 't_user',
    timestamps: false
  });
};

// 线上 @kne/fastify-sequelize 会执行模型 associate；测试用的版本不会，这里补上同样的关联列（不加外键约束）
const applyAssociations = (fastify, name = 'message') => {
  const { models } = fastify[name];
  const UserModel = fastify.sequelize.instance.models.user;
  models.template.belongsTo(UserModel, { foreignKey: 'userId', constraints: false });
  models.record.belongsTo(UserModel, { foreignKey: 'userId', constraints: false });
  models.record.belongsTo(models.template, { constraints: false });
};

// 线上顺序：sequelize.sync 建表后由插件执行 upgradeSchema 补建索引；测试的 syncPromise 提前 resolve，这里按同样顺序补上
const syncTables = async (fastify, name = 'message', syncOptions) => {
  await fastify.sequelize.instance.sync(syncOptions);
  await fastify[name].services.upgradeSchema();
};

const createFastify = async (options = {}) => {
  const fastify = Fastify({
    routerOptions: {
      querystringParser: str => qs.parse(str)
    }
  });

  await fastify.register(require('@fastify/sensible'));
  await fastify.register(require('fastify-cron'));

  await fastify.register(require('@kne/fastify-sequelize'), {
    db: { dialect: 'sqlite', storage: ':memory:', logging: false }
  });

  const UserModel = createTestUserModel(fastify.sequelize.instance);
  await UserModel.sync({ force: true });

  if (!fastify.sequelize.syncPromise) {
    fastify.sequelize.syncPromise = Promise.resolve();
  }

  await fastify.register(require('../../index'), {
    name: 'message',
    dbTableNamePrefix: 't_message_',
    prefix: '/api/message',
    isTest: true,
    getUserModel: () => UserModel,
    templateDir: null,
    getAuthenticate: () => [],
    ...options
  });

  await fastify.ready();
  applyAssociations(fastify, options.name);

  if (options.templateDir) {
    await syncTables(fastify, options.name);
    await fastify[options.name || 'message'].services.includeTemplate(options.templateDir);
  } else {
    await syncTables(fastify, options.name, { force: true });
  }

  return fastify;
};

const createFastifyWithAccount = async (options = {}) => {
  const fastify = Fastify({
    routerOptions: {
      querystringParser: str => qs.parse(str)
    }
  });

  await fastify.register(require('@fastify/sensible'));
  await fastify.register(require('fastify-cron'));

  await fastify.register(require('@kne/fastify-sequelize'), {
    db: { dialect: 'sqlite', storage: ':memory:', logging: false }
  });

  const UserModel = createTestUserModel(fastify.sequelize.instance);
  await UserModel.sync({ force: true });

  fastify.decorate('account', {
    models: { user: UserModel },
    authenticate: {
      user: async () => {},
      admin: async () => {}
    }
  });

  if (!fastify.sequelize.syncPromise) {
    fastify.sequelize.syncPromise = Promise.resolve();
  }

  await fastify.register(require('../../index'), {
    prefix: '/api/message',
    isTest: true,
    templateDir: null,
    ...options
  });

  await fastify.ready();
  applyAssociations(fastify, options.name);
  await syncTables(fastify, options.name, { force: true });

  return fastify;
};

const createFastifyWithDefaultAuthenticate = async (options = {}) => {
  const fastify = Fastify({
    routerOptions: {
      querystringParser: str => qs.parse(str)
    }
  });

  await fastify.register(require('@fastify/sensible'));
  await fastify.register(require('fastify-cron'));

  await fastify.register(require('@kne/fastify-sequelize'), {
    db: { dialect: 'sqlite', storage: ':memory:', logging: false }
  });

  const UserModel = createTestUserModel(fastify.sequelize.instance);
  await UserModel.sync({ force: true });

  if (!fastify.sequelize.syncPromise) {
    fastify.sequelize.syncPromise = Promise.resolve();
  }

  await fastify.register(require('../../index'), {
    prefix: '/api/message',
    isTest: true,
    templateDir: null,
    getUserModel: () => UserModel,
    ...options
  });

  await fastify.ready();
  applyAssociations(fastify, options.name);
  await syncTables(fastify, options.name, { force: true });

  return fastify;
};

const collectRecordStatistics = async (fastify, records, options = {}) => {
  const list = Array.isArray(records) ? records : [records];
  const statisticsServices = fastify.messageStatistics.services;
  const data = { total: 1, success: 1, failed: 0 };
  const unit = { total: 'count', success: 'count', failed: 'count' };

  for (const record of list) {
    const plain = typeof record.get === 'function' ? record.get({ plain: true }) : record;
    const time = options.time || plain.createdAt || new Date();
    await statisticsServices.collect({ channel: `${plain.code}:${plain.type}`, data, unit, time });
  }
};

const collectAllRecordStatistics = async fastify => {
  const records = await fastify.message.models.record.findAll();
  await collectRecordStatistics(fastify, records);
};

const getRealtimeStatistics = async (fastify, params = {}) => {
  const currentAddress = fastify.server.address();
  const baseUrl = currentAddress && typeof currentAddress === 'object'
    ? `http://127.0.0.1:${currentAddress.port}`
    : await fastify.listen({ port: 0, host: '127.0.0.1' });
  const query = qs.stringify(params);
  const url = new URL(`${baseUrl}/api/message/statistics/sse${query ? `?${query}` : ''}`);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Accept: 'text/event-stream' }
    }, res => {
      res.on('data', chunk => {
        if (settled) return;
        const match = chunk.toString().match(/data:\s*(.+)/);
        if (!match) return;
        req.destroy();
        finish(resolve, JSON.parse(match[1]));
      });
    });
    req.on('error', err => {
      if (err.code !== 'ECONNRESET') finish(reject, err);
    });
    req.end();
    timer = setTimeout(() => {
      req.destroy();
      finish(reject, new Error('SSE statistics response timeout'));
    }, 3000);
  });
};

module.exports = {
  createFastify,
  createFastifyWithAccount,
  createFastifyWithDefaultAuthenticate,
  collectRecordStatistics,
  collectAllRecordStatistics,
  getRealtimeStatistics
};
