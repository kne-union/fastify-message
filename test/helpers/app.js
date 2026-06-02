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

  if (options.templateDir) {
    await fastify.sequelize.instance.sync();
    await fastify[options.name || 'message'].services.includeTemplate(options.templateDir);
  } else {
    await fastify.sequelize.instance.sync({ force: true });
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
  await fastify.sequelize.instance.sync({ force: true });

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
  await fastify.sequelize.instance.sync({ force: true });

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
    : await fastify.listen({ port: 0 });
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
