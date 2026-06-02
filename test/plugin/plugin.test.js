const { expect } = require('chai');
const Fastify = require('fastify');
const path = require('node:path');
const fs = require('fs-extra');
const { DataTypes } = require('sequelize');
const qs = require('qs');
const {
  createFastify,
  createFastifyWithAccount,
  createFastifyWithDefaultAuthenticate
} = require('../helpers/app');

describe('@kne/fastify-message 插件注册', function () {
  this.timeout(10000);

  let fastify;

  afterEach(async () => {
    if (fastify) {
      await fastify.close();
      fastify = null;
    }
  });

  it('should add message decorator with default options', async () => {
    fastify = await createFastify();
    expect(fastify.message).to.exist;
    expect(fastify.message.models).to.exist;
    expect(fastify.message.services).to.exist;
    expect(fastify.message.controllers).to.exist;
  });

  it('should add models to message namespace', async () => {
    fastify = await createFastify();
    expect(fastify.message.models.template).to.exist;
    expect(fastify.message.models.record).to.exist;
  });

  it('should add services to message namespace', async () => {
    fastify = await createFastify();
    expect(fastify.message.services.includeTemplate).to.exist;
    expect(fastify.message.services.messageTemplate).to.exist;
    expect(fastify.message.services.parseTemplate).to.exist;
    expect(fastify.message.services.sendMessage).to.exist;
    expect(fastify.message.services.record).to.exist;
    expect(fastify.message.services.template).to.exist;
    expect(fastify.message.services.queryStatistics).to.exist;
    expect(fastify.message.services.sseStatistics).to.exist;
  });

  it('should use custom name option', async () => {
    fastify = await createFastify({ name: 'customMessage' });
    expect(fastify.customMessage).to.exist;
    expect(fastify.customMessage.models).to.exist;
  });

  it('should use default account models and authenticate middlewares when account exists', async () => {
    fastify = await createFastifyWithAccount();
    expect(fastify.message).to.exist;

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/message/records'
    });

    expect(response.statusCode).to.equal(200);
  });

  it('should fail with default getUserModel when account plugin is missing', async () => {
    const app = Fastify({
      routerOptions: {
        querystringParser: str => qs.parse(str)
      }
    });
    await app.register(require('@fastify/sensible'));
    await app.register(require('fastify-cron'));
    await app.register(require('@kne/fastify-sequelize'), {
      db: { dialect: 'sqlite', storage: ':memory:', logging: false }
    });
    app.sequelize.instance.define('user', {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true
      }
    }, {
      tableName: 't_user',
      timestamps: false
    });

    try {
      await app.register(require('../../index'), {
        prefix: '/api/message',
        isTest: true,
        templateDir: null
      });
      await app.ready();
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).to.exist;
    } finally {
      await app.close();
    }
  });

  it('should use default getAuthenticate error middleware when account plugin is missing', async () => {
    fastify = await createFastifyWithDefaultAuthenticate();

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/message/records'
    });

    expect(response.statusCode).to.equal(500);
    const body = JSON.parse(response.body);
    expect(body.message).to.include('fastify-account plugin must be registered');
  });

  it('should start successfully with templateDir and load templates after sync', async () => {
    const tempDir = path.join(__dirname, '..', 'temp-startup-templates');
    await fs.ensureDir(tempDir);
    try {
      await fs.writeFile(
        path.join(tempDir, 'startup_test.ejs'),
        '<!-- subject -->启动测试<!-- html --><div>启动测试内容</div>'
      );

      fastify = await createFastify({ templateDir: tempDir });

      const templates = await fastify.message.models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].code).to.equal('startup');
    } finally {
      await fs.remove(tempDir);
    }
  });

  it('should load templates with correct fields from templateDir on startup', async () => {
    const tempDir = path.join(__dirname, '..', 'temp-startup-fields');
    await fs.ensureDir(tempDir);
    try {
      await fs.writeFile(
        path.join(tempDir, 'verify_1_验证码.ejs'),
        '<!-- subject -->您的验证码<!-- html --><div>验证码为：<%= code %></div>'
      );
      await fs.writeFile(
        path.join(tempDir, 'welcome.ejs'),
        '<!-- subject -->欢迎<!-- html --><p>欢迎您</p>'
      );

      fastify = await createFastify({ templateDir: tempDir });

      const templates = await fastify.message.models.template.findAll({ order: [['code', 'ASC']] });
      expect(templates.length).to.equal(2);

      const verifyTpl = templates.find(t => t.code === 'verify');
      expect(verifyTpl).to.exist;
      expect(verifyTpl.type).to.equal(1);
      expect(verifyTpl.name).to.equal('验证码');
      expect(verifyTpl.level).to.equal(0);
      expect(verifyTpl.content).to.include('您的验证码');

      const welcomeTpl = templates.find(t => t.code === 'welcome');
      expect(welcomeTpl).to.exist;
      expect(welcomeTpl.type).to.equal(0);
      expect(welcomeTpl.name).to.equal('welcome');
      expect(welcomeTpl.level).to.equal(0);
    } finally {
      await fs.remove(tempDir);
    }
  });

  it('should update existing template when templateDir has same code on startup', async () => {
    const tempDir = path.join(__dirname, '..', 'temp-startup-update');
    await fs.ensureDir(tempDir);
    try {
      await fs.writeFile(
        path.join(tempDir, 'welcome.ejs'),
        '<!-- subject -->旧主题<!-- html --><div>旧内容</div>'
      );

      fastify = await createFastify({ templateDir: tempDir });

      let templates = await fastify.message.models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].content).to.include('旧内容');

      await fs.writeFile(
        path.join(tempDir, 'welcome.ejs'),
        '<!-- subject -->新主题<!-- html --><div>新内容</div>'
      );

      await fastify.message.services.includeTemplate(tempDir);

      templates = await fastify.message.models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].content).to.include('新内容');
    } finally {
      await fs.remove(tempDir);
    }
  });

  it('should not crash when templateDir does not exist on startup', async () => {
    fastify = await createFastify({ templateDir: '/non/existent/path' });
    expect(fastify.message).to.exist;
    const templates = await fastify.message.models.template.findAll();
    expect(templates.length).to.equal(0);
  });
});
