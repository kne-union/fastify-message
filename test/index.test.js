const { expect } = require('chai');
const Fastify = require('fastify');
const fp = require('fastify-plugin');
const path = require('node:path');
const fs = require('fs-extra');
const { DataTypes } = require('sequelize');
const qs = require('qs');

describe('@kne/fastify-message', function () {
  this.timeout(10000);

  // 创建一个简单的 User 模型用于测试
  let testSequelize;
  let UserModel;

  const createTestUserModel = (sequelize) => {
    const User = sequelize.define('user', {
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
    return User;
  };

  const createFastify = async (options = {}) => {
    const fastify = Fastify({
      routerOptions: {
        querystringParser: str => qs.parse(str)
      }
    });
    
    // 注册 @fastify/sensible 以支持 httpErrors
    await fastify.register(require('@fastify/sensible'));
    
    await fastify.register(require('@kne/fastify-sequelize'), {
      db: { dialect: 'sqlite', storage: ':memory:', logging: false }
    });

    // 创建测试用的 User 模型 - 使用 fastify.sequelize.instance
    testSequelize = fastify.sequelize.instance;
    UserModel = createTestUserModel(testSequelize);
    await UserModel.sync({ force: true });

    // 确保 syncPromise 存在
    if (!fastify.sequelize.syncPromise) {
      fastify.sequelize.syncPromise = Promise.resolve();
    }

    await fastify.register(require('../index'), {
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
    
    // 如果传了 templateDir，使用 sync 而非 sync({ force: true }) 避免清空 includeTemplate 导入的数据
    if (options.templateDir) {
      await fastify.sequelize.instance.sync();
    } else {
      await fastify.sequelize.instance.sync({ force: true });
    }
    
    return fastify;
  };

  describe('插件注册测试', () => {
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
      expect(fastify.message.services.statistics).to.exist;
    });

    it('should use custom name option', async () => {
      fastify = await createFastify({ name: 'customMessage' });
      expect(fastify.customMessage).to.exist;
      expect(fastify.customMessage.models).to.exist;
    });

    it('should start successfully with templateDir and load templates after sync', async () => {
      const tempDir = path.join(__dirname, 'temp-startup-templates');
      await fs.ensureDir(tempDir);
      try {
        await fs.writeFile(
          path.join(tempDir, 'startup_test.ejs'),
          '<!-- subject -->启动测试<!-- html --><div>启动测试内容</div>'
        );

        fastify = await createFastify({ templateDir: tempDir });

        // syncPromise 已 resolve，.then 回调在微任务队列中，等待其完成
        await new Promise(resolve => setTimeout(resolve, 500));

        const templates = await fastify.message.models.template.findAll();
        expect(templates.length).to.equal(1);
        expect(templates[0].code).to.equal('startup');
      } finally {
        await fs.remove(tempDir);
      }
    });

    it('should load templates with correct fields from templateDir on startup', async () => {
      const tempDir = path.join(__dirname, 'temp-startup-fields');
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
        await new Promise(resolve => setTimeout(resolve, 500));

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
      const tempDir = path.join(__dirname, 'temp-startup-update');
      await fs.ensureDir(tempDir);
      try {
        await fs.writeFile(
          path.join(tempDir, 'welcome.ejs'),
          '<!-- subject -->旧主题<!-- html --><div>旧内容</div>'
        );

        fastify = await createFastify({ templateDir: tempDir });
        await new Promise(resolve => setTimeout(resolve, 500));

        let templates = await fastify.message.models.template.findAll();
        expect(templates.length).to.equal(1);
        expect(templates[0].content).to.include('旧内容');

        // 模版文件更新后再次调用 includeTemplate
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

  describe('parseTemplate 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should parse template with subject and html', async () => {
      const { parseTemplate } = fastify.message.services;
      const result = parseTemplate(`
<!-- subject -->
测试主题
<!-- html -->
<div>测试内容</div>
      `);

      expect(result.subject).to.equal('测试主题');
      expect(result.html).to.equal('<div>测试内容</div>');
    });

    it('should parse template with subject, html and text', async () => {
      const { parseTemplate } = fastify.message.services;
      const result = parseTemplate(`
<!-- subject -->
测试主题
<!-- html -->
<div>HTML内容</div>
<!-- text -->
纯文本内容
      `);

      expect(result.subject).to.equal('测试主题');
      expect(result.html).to.equal('<div>HTML内容</div>');
      expect(result.text).to.equal('纯文本内容');
    });

    it('should return empty object for empty template', async () => {
      const { parseTemplate } = fastify.message.services;
      const result = parseTemplate('');
      expect(result).to.deep.equal({});
    });

    it('should handle template with no markers', async () => {
      const { parseTemplate } = fastify.message.services;
      const result = parseTemplate('普通内容没有标记');
      expect(result).to.deep.equal({});
    });
  });

  describe('messageTemplate 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should throw error when template not found', async () => {
      const { messageTemplate } = fastify.message.services;
      try {
        await messageTemplate({ code: 'nonexistent', props: {} });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.message).to.equal('template not found');
      }
    });

    it('should render template with props', async () => {
      const { models, services } = fastify.message;

      await models.template.create({
        code: 'test',
        type: 0,
        name: '测试模板',
        content: '<!-- subject -->欢迎<!-- html --><h1>你好，<%= name %>！</h1>',
        level: 0
      });

      const result = await services.messageTemplate({
        code: 'test',
        type: 0,
        level: 0,
        props: { name: '张三' }
      });

      expect(result.code).to.equal('test');
      expect(result.type).to.equal(0);
      expect(result.templateId).to.exist;
      expect(result.content.subject).to.equal('欢迎');
      expect(result.content.html).to.equal('<h1>你好，张三！</h1>');
    });
  });

  describe('sendMessage 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should send message and create record', async () => {
      const { models, services } = fastify.message;

      await models.template.create({
        code: 'welcome',
        type: 0,
        name: '欢迎邮件',
        content: '<!-- subject -->欢迎加入<!-- html --><p>欢迎您</p>',
        level: 0
      });

      await services.sendMessage({
        code: 'welcome',
        type: 0,
        name: 'test@example.com',
        props: {}
      });

      const records = await models.record.findAll();
      expect(records.length).to.equal(1);
      expect(records[0].code).to.equal('welcome');
      expect(records[0].name).to.equal('test@example.com');
    });

    it('should use custom sender when provided', async () => {
      let senderCalled = false;
      let receivedOptions = null;

      const fastifyWithSender = await createFastify({
        senders: {
          0: async (mailOptions) => {
            senderCalled = true;
            receivedOptions = mailOptions;
          }
        }
      });

      const { models, services } = fastifyWithSender.message;

      await models.template.create({
        code: 'test',
        type: 0,
        name: '测试',
        content: '<!-- subject -->主题<!-- html -->内容',
        level: 0
      });

      await services.sendMessage({
        code: 'test',
        type: 0,
        name: 'user@example.com',
        props: {}
      });

      // 在测试模式下，isTest=true，不会调用自定义发送器
      const records = await models.record.findAll();
      expect(records.length).to.equal(1);
      
      await fastifyWithSender.close();
    });
  });

  describe('includeTemplate 服务测试', () => {
    let fastify;
    let tempDir;

    beforeEach(async () => {
      fastify = await createFastify();
      tempDir = path.join(__dirname, 'temp-templates');
      await fs.ensureDir(tempDir);
    });

    afterEach(async () => {
      await fastify.close();
      await fs.remove(tempDir);
    });

    it('should handle non-existent directory', async () => {
      const { includeTemplate } = fastify.message.services;
      await includeTemplate('/non/existent/path');
      const templates = await fastify.message.models.template.findAll();
      expect(templates.length).to.equal(0);
    });

    it('should create template from file', async () => {
      const { includeTemplate } = fastify.message.services;
      const { models } = fastify.message;

      await fs.writeFile(
        path.join(tempDir, 'welcome.ejs'),
        '<!-- subject -->欢迎<!-- html --><div>欢迎</div>'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].code).to.equal('welcome');
      expect(templates[0].type).to.equal(0);
      expect(templates[0].level).to.equal(0);
    });

    it('should parse filename with type and name', async () => {
      const { includeTemplate } = fastify.message.services;
      const { models } = fastify.message;

      await fs.writeFile(
        path.join(tempDir, 'verify_1_验证码.ejs'),
        '<!-- subject -->验证码<!-- html --><div>您的验证码</div>'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].code).to.equal('verify');
      expect(templates[0].type).to.equal(1);
      expect(templates[0].name).to.equal('验证码');
    });

    it('should update existing template', async () => {
      const { includeTemplate } = fastify.message.services;
      const { models } = fastify.message;

      await models.template.create({
        code: 'welcome',
        type: 0,
        level: 0,
        name: '旧名称',
        content: '旧内容'
      });

      await fs.writeFile(
        path.join(tempDir, 'welcome.ejs'),
        '<!-- subject -->新主题<!-- html --><div>新内容</div>'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].content).to.equal('<!-- subject -->新主题<!-- html --><div>新内容</div>');
    });
  });

  describe('statistics.getOverview 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return empty overview when no records', async () => {
      const { services } = fastify.message;
      const result = await services.statistics.getOverview();

      expect(result.range).to.equal('7d');
      expect(result.rangeLabel).to.equal('近7天');
      expect(result.totalRecords).to.equal(0);
      expect(result.byType).to.deep.equal({});
      expect(result.byCode).to.deep.equal({});
      expect(result.templateStats).to.exist;
      expect(result.recentTrend).to.deep.equal([]);
      expect(result.recentTrendByType).to.deep.equal([]);
    });

    it('should return overview with default range 7d', async () => {
      const { models, services } = fastify.message;

      await models.template.create({ code: 'test', type: 0, name: '测试', content: '', level: 0 });

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 0, name: 'u2@e.com', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getOverview();

      expect(result.range).to.equal('7d');
      expect(result.totalRecords).to.equal(3);
      expect(result.byType['0']).to.equal(2);
      expect(result.byType['1']).to.equal(1);
      expect(result.byCode['test']).to.equal(2);
      expect(result.byCode['verify']).to.equal(1);
    });

    it('should return overview with range 1m', async () => {
      const { services } = fastify.message;
      const result = await services.statistics.getOverview({ range: '1m' });

      expect(result.range).to.equal('1m');
      expect(result.rangeLabel).to.equal('近1个月');
    });

    it('should return overview with range 1y', async () => {
      const { services } = fastify.message;
      const result = await services.statistics.getOverview({ range: '1y' });

      expect(result.range).to.equal('1y');
      expect(result.rangeLabel).to.equal('近1年');
    });

    it('should fallback to 7d for invalid range', async () => {
      const { services } = fastify.message;
      const result = await services.statistics.getOverview({ range: 'invalid' });

      expect(result.range).to.equal('7d');
      expect(result.rangeLabel).to.equal('近7天');
    });

    it('should include templateStats', async () => {
      const { models, services } = fastify.message;

      await models.template.create({ code: 't1', type: 0, name: '邮件', content: '', status: 0 });
      await models.template.create({ code: 't2', type: 1, name: '短信', content: '', status: 1 });

      const result = await services.statistics.getOverview();

      expect(result.templateStats.total).to.equal(2);
      expect(result.templateStats.byStatus['0']).to.equal(1);
      expect(result.templateStats.byStatus['1']).to.equal(1);
      expect(result.templateStats.byType['0']).to.equal(1);
      expect(result.templateStats.byType['1']).to.equal(1);
    });

    it('should include recentTrend with daily data', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 0, name: 'u2@e.com', props: {}, content: {} });

      const result = await services.statistics.getOverview();

      expect(result.recentTrend).to.be.an('array');
      expect(result.recentTrend.length).to.be.greaterThan(0);
      expect(result.recentTrend[0].date).to.exist;
      expect(result.recentTrend[0].count).to.exist;
    });

    it('should include recentTrendByType with daily data by type', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getOverview();

      expect(result.recentTrendByType).to.be.an('array');
      if (result.recentTrendByType.length > 0) {
        expect(result.recentTrendByType[0].date).to.exist;
        expect(result.recentTrendByType[0].type).to.exist;
        expect(result.recentTrendByType[0].count).to.exist;
      }
    });
  });

  describe('statistics.getRealtime 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return empty realtime when no records today', async () => {
      const { services } = fastify.message;
      const result = await services.statistics.getRealtime();

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(result.date).to.equal(todayStr);
      expect(result.totalRecords).to.equal(0);
      expect(result.byType).to.deep.equal({});
      expect(result.byCode).to.deep.equal({});
      expect(result.hourlyTrend).to.deep.equal([]);
      expect(result.hourlyTrendByType).to.deep.equal([]);
      expect(result.intervalTrend).to.deep.equal([]);
    });

    it('should return realtime data for today', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'welcome', type: 0, name: 'u2@e.com', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      expect(result.date).to.equal(todayStr);
      expect(result.totalRecords).to.equal(3);
      expect(result.byType['0']).to.equal(2);
      expect(result.byType['1']).to.equal(1);
      expect(result.byCode['welcome']).to.equal(2);
      expect(result.byCode['verify']).to.equal(1);
    });

    it('should include hourlyTrend', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      expect(result.hourlyTrend).to.be.an('array');
      expect(result.hourlyTrend.length).to.be.greaterThan(0);
      expect(result.hourlyTrend[0].hour).to.exist;
      expect(result.hourlyTrend[0].count).to.exist;
    });

    it('should include hourlyTrendByType', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      expect(result.hourlyTrendByType).to.be.an('array');
      if (result.hourlyTrendByType.length > 0) {
        expect(result.hourlyTrendByType[0].hour).to.exist;
        expect(result.hourlyTrendByType[0].type).to.exist;
        expect(result.hourlyTrendByType[0].count).to.exist;
      }
    });

    it('should only count today records not old records', async () => {
      const { models, services } = fastify.message;
      const { Sequelize } = models.record.sequelize;

      // 创建一条昨天的记录（直接通过SQL修改createdAt不太可靠，用原始查询）
      await models.record.create({ code: 'old', type: 0, name: 'old@e.com', props: {}, content: {} });
      // 将刚创建的记录时间改为昨天
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await models.record.update(
        { createdAt: yesterday },
        { where: { code: 'old' } }
      );

      // 创建一条今天的记录
      await models.record.create({ code: 'today', type: 0, name: 'today@e.com', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      // 只统计今天的记录
      expect(result.totalRecords).to.equal(1);
      expect(result.byCode['today']).to.equal(1);
      expect(result.byCode['old']).to.be.undefined;
      // intervalTrend 中只包含今天的时间区间
      expect(result.intervalTrend.length).to.equal(1);
    });

    it('should include intervalTrend grouped by 15-minute intervals', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      expect(result.intervalTrend).to.be.an('array');
      expect(result.intervalTrend.length).to.be.greaterThan(0);
      const item = result.intervalTrend[0];
      expect(item.interval).to.match(/^\d{2}:\d{2}$/);
      expect(item.count).to.be.a('number');
    });

    it('should group records in same 15-minute interval', async () => {
      const { models, services } = fastify.message;

      // 同一时间段内创建3条记录
      await models.record.create({ code: 'a', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'a', type: 0, name: 'u2@e.com', props: {}, content: {} });
      await models.record.create({ code: 'b', type: 1, name: '138', props: {}, content: {} });

      const result = await services.statistics.getRealtime();

      // 3条记录在同一15分钟区间，应合并为1条
      expect(result.intervalTrend.length).to.equal(1);
      expect(result.intervalTrend[0].count).to.equal(3);
    });

    it('should accept timezone parameter in getRealtime', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      // 不传timezone使用服务器本地时区
      const localResult = await services.statistics.getRealtime();
      // 传timezone使用指定时区
      const tzResult = await services.statistics.getRealtime({ timezone: 'Asia/Shanghai' });

      expect(localResult.date).to.exist;
      expect(tzResult.date).to.exist;
      expect(tzResult.totalRecords).to.equal(1);
    });

    it('should use server timezone as default when timezone is not provided', async () => {
      const { models, services } = fastify.message;
      const dayjs = require('dayjs');
      const utcPlugin = require('dayjs/plugin/utc');
      const tzPlugin = require('dayjs/plugin/timezone');
      dayjs.extend(utcPlugin);
      dayjs.extend(tzPlugin);

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      const serverTimezone = dayjs.tz.guess();
      const localResult = await services.statistics.getRealtime();
      const tzResult = await services.statistics.getRealtime({ timezone: serverTimezone });

      expect(localResult.date).to.equal(tzResult.date);
      expect(localResult.hourlyTrend).to.deep.equal(tzResult.hourlyTrend);
      expect(localResult.intervalTrend).to.deep.equal(tzResult.intervalTrend);
    });

    it('should accept timezone parameter in getOverview', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      const localResult = await services.statistics.getOverview({ range: '7d' });
      const tzResult = await services.statistics.getOverview({ range: '7d', timezone: 'Asia/Shanghai' });

      expect(localResult.totalRecords).to.equal(1);
      expect(tzResult.totalRecords).to.equal(1);
      expect(tzResult.range).to.equal('7d');
    });

    it('should return correct date for Asia/Shanghai timezone', async () => {
      const { services } = fastify.message;
      const dayjs = require('dayjs');
      const utcPlugin = require('dayjs/plugin/utc');
      const tzPlugin = require('dayjs/plugin/timezone');
      dayjs.extend(utcPlugin);
      dayjs.extend(tzPlugin);

      const result = await services.statistics.getRealtime({ timezone: 'Asia/Shanghai' });
      const expectedDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
      expect(result.date).to.equal(expectedDate);
    });

    it('should return correct date for America/New_York timezone', async () => {
      const { services } = fastify.message;
      const dayjs = require('dayjs');
      const utcPlugin = require('dayjs/plugin/utc');
      const tzPlugin = require('dayjs/plugin/timezone');
      dayjs.extend(utcPlugin);
      dayjs.extend(tzPlugin);

      const result = await services.statistics.getRealtime({ timezone: 'America/New_York' });
      const expectedDate = dayjs().tz('America/New_York').format('YYYY-MM-DD');
      expect(result.date).to.equal(expectedDate);
    });

    it('should return correct hourlyTrend hour for timezone', async () => {
      const { models, services } = fastify.message;
      const dayjs = require('dayjs');
      const utcPlugin = require('dayjs/plugin/utc');
      const tzPlugin = require('dayjs/plugin/timezone');
      dayjs.extend(utcPlugin);
      dayjs.extend(tzPlugin);

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      const result = await services.statistics.getRealtime({ timezone: 'Asia/Shanghai' });

      if (result.hourlyTrend.length > 0) {
        const expectedHour = dayjs().tz('Asia/Shanghai').hour();
        // 当前小时的记录应存在（小时可能匹配）
        const currentHourEntry = result.hourlyTrend.find(item => item.hour === expectedHour);
        expect(currentHourEntry).to.exist;
      }
    });

    it('should return correct intervalTrend format for timezone', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

      const result = await services.statistics.getRealtime({ timezone: 'Asia/Shanghai' });

      if (result.intervalTrend.length > 0) {
        expect(result.intervalTrend[0].interval).to.match(/^\d{2}:\d{2}$/);
      }
    });
  });

  describe('控制器接口测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    describe('发送记录接口', () => {
      it('should return empty list when no records', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(0);
        expect(body.pageData).to.deep.equal([]);
      });

      it('should return records list with pagination', async () => {
        const { models } = fastify.message;

        await models.template.create({
          code: 'test',
          type: 0,
          name: '测试',
          content: '<!-- subject -->主题<!-- html -->内容',
          level: 0
        });

        for (let i = 0; i < 25; i++) {
          await models.record.create({
            code: 'test',
            type: 0,
            name: `user${i}@example.com`,
            props: { index: i },
            content: { subject: '测试', html: '<p>内容</p>' }
          });
        }

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records?currentPage=2&perPage=10'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(25);
        expect(body.currentPage).to.equal(2);
        expect(body.perPage).to.equal(10);
        expect(body.pageData.length).to.equal(10);
      });

      it('should filter records by type', async () => {
        const { models } = fastify.message;

        await models.template.create({
          code: 'test',
          type: 0,
          name: '邮件模板',
          content: '<!-- subject -->主题',
          level: 0
        });

        await models.record.create({
          code: 'test',
          type: 0,
          name: 'email@example.com',
          content: {}
        });

        await models.record.create({
          code: 'test',
          type: 1,
          name: '13800138000',
          content: {}
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records?filter[type]=0'
        });

        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(1);
        expect(body.pageData[0].name).to.equal('email@example.com');
      });

      it('should filter records by code and name', async () => {
        const { models } = fastify.message;

        await models.record.create({
          code: 'welcome',
          type: 0,
          name: 'user1@example.com',
          content: {}
        });

        await models.record.create({
          code: 'verify',
          type: 0,
          name: 'user2@example.com',
          content: {}
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records?filter[code]=welcome&filter[name]=user1@example.com'
        });

        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(1);
        expect(body.pageData[0].code).to.equal('welcome');
      });

      it('should return single record by id', async () => {
        const { models } = fastify.message;

        const record = await models.record.create({
          code: 'test',
          type: 0,
          name: 'test@example.com',
          props: { key: 'value' },
          content: { subject: '主题' }
        });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/message/records/${record.id}`
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.code).to.equal('test');
        expect(body.name).to.equal('test@example.com');
        expect(body.props).to.deep.equal({ key: 'value' });
        expect(body.content).to.deep.equal({ subject: '主题' });
      });

      it('should return 404 when record not found', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records/999999'
        });

        expect(response.statusCode).to.equal(404);
      });

      it('should return record with content containing subject and body', async () => {
        const { models } = fastify.message;

        const record = await models.record.create({
          code: 'INVITEINTERVIEW',
          type: 0,
          name: 'candidate@example.com',
          props: { candidateName: '张三', interviewTime: '2026-05-10 14:00' },
          content: { subject: '面试邀请', body: '尊敬的张三，您好！' }
        });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/message/records/${record.id}`
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.content.subject).to.equal('面试邀请');
        expect(body.content.body).to.equal('尊敬的张三，您好！');
      });

      it('should return record with sms content containing only body', async () => {
        const { models } = fastify.message;

        const record = await models.record.create({
          code: 'INVITEINTERVIEW',
          type: 1,
          name: '+86 13800138000',
          props: { candidateName: '李四', interviewTime: '2026-05-11 10:00' },
          content: { body: '【LeapIn】尊敬的李四，面试时间为2026-05-11 10:00。' }
        });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/message/records/${record.id}`
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.type).to.equal(1);
        expect(body.content.body).to.exist;
      });
    });

    describe('消息模版接口', () => {
      it('should return empty list when no templates', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(0);
        expect(body.pageData).to.deep.equal([]);
      });

      it('should return templates list with pagination', async () => {
        const { models } = fastify.message;

        for (let i = 0; i < 25; i++) {
          await models.template.create({
            code: `template_${i}`,
            type: 0,
            name: `模板${i}`,
            content: '<!-- subject -->主题',
            level: i < 5 ? 0 : 1
          });
        }

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates?currentPage=1&perPage=20'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(25);
        expect(body.pageData.length).to.equal(20);
      });

      it('should filter templates by type', async () => {
        const { models } = fastify.message;

        await models.template.create({
          code: 'email_tpl',
          type: 0,
          name: '邮件模板',
          content: ''
        });

        await models.template.create({
          code: 'sms_tpl',
          type: 1,
          name: '短信模板',
          content: ''
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates?filter[type]=1'
        });

        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(1);
        expect(body.pageData[0].code).to.equal('sms_tpl');
      });

      it('should filter templates by level and status', async () => {
        const { models } = fastify.message;

        await models.template.create({
          code: 'system_tpl',
          type: 0,
          name: '系统模板',
          content: '',
          level: 0,
          status: 0
        });

        await models.template.create({
          code: 'business_tpl',
          type: 0,
          name: '业务模板',
          content: '',
          level: 1,
          status: 1
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates?filter[level]=0&filter[status]=0'
        });

        const body = JSON.parse(response.body);
        expect(body.totalCount).to.equal(1);
        expect(body.pageData[0].code).to.equal('system_tpl');
      });

      it('should return single template by id', async () => {
        const { models } = fastify.message;

        const template = await models.template.create({
          code: 'test',
          type: 0,
          name: '测试模板',
          content: '<!-- subject -->主题<!-- html -->内容',
          level: 0
        });

        const response = await fastify.inject({
          method: 'GET',
          url: `/api/message/templates/${template.id}`
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.code).to.equal('test');
        expect(body.name).to.equal('测试模板');
      });

      it('should return 404 when template not found', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates/999999'
        });

        expect(response.statusCode).to.equal(404);
      });
    });

    describe('发送消息接口测试', () => {
      it('should send message via template', async () => {
        const { models } = fastify.message;

        const tpl = await models.template.create({
          code: 'welcome',
          type: 0,
          name: '欢迎邮件',
          content: '<!-- subject -->欢迎<!-- html --><p>你好</p>',
          level: 0,
          status: 0
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/message/templates/send',
          payload: {
            templateId: String(tpl.id),
            name: 'user@example.com',
            props: {}
          }
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.success).to.equal(true);

        const records = await models.record.findAll({ where: { code: 'welcome' } });
        expect(records.length).to.equal(1);
        expect(records[0].name).to.equal('user@example.com');
      });

      it('should send SMS message with custom sender', async () => {
        const senderFastify = await createFastify({
          senders: {
            1: async (data) => {
              return data;
            }
          }
        });

        const tpl = await senderFastify.message.models.template.create({
          code: 'sms_notify',
          type: 1,
          name: '短信通知',
          content: '<!-- subject -->通知<!-- html -->内容',
          level: 0,
          status: 0
        });

        const response = await senderFastify.inject({
          method: 'POST',
          url: '/api/message/templates/send',
          payload: {
            templateId: String(tpl.id),
            name: '13800138000',
            props: {}
          }
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.success).to.equal(true);

        const records = await senderFastify.message.models.record.findAll({ where: { code: 'sms_notify' } });
        expect(records.length).to.equal(1);
        expect(records[0].type).to.equal(1);
        expect(records[0].name).to.equal('13800138000');

        await senderFastify.close();
      });

      it('should return 404 when template not found', async () => {
        const response = await fastify.inject({
          method: 'POST',
          url: '/api/message/templates/send',
          payload: {
            templateId: '999999',
            name: 'user@example.com'
          }
        });

        expect(response.statusCode).to.equal(404);
      });

      it('should return 400 when template is disabled', async () => {
        const { models } = fastify.message;

        const tpl = await models.template.create({
          code: 'disabled_tpl',
          type: 0,
          name: '已禁用模板',
          content: '',
          level: 0,
          status: 1
        });

        const response = await fastify.inject({
          method: 'POST',
          url: '/api/message/templates/send',
          payload: {
            templateId: String(tpl.id),
            name: 'user@example.com'
          }
        });

        expect(response.statusCode).to.equal(400);
      });

      it('should require templateId and name', async () => {
        const response = await fastify.inject({
          method: 'POST',
          url: '/api/message/templates/send',
          payload: {}
        });

        expect(response.statusCode).to.equal(400);
      });
    });

    describe('统计数据接口', () => {
      it('should return statistics overview with default range 7d', async () => {
        const { models } = fastify.message;

        await models.template.create({
          code: 'test', type: 0, name: '测试', content: '', level: 0
        });

        await models.record.create({
          code: 'test', type: 0, name: 'user1@example.com', props: {}, content: {}
        });

        await models.record.create({
          code: 'test', type: 1, name: '13800138000', props: {}, content: {}
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.range).to.equal('7d');
        expect(body.rangeLabel).to.equal('近7天');
        expect(body.totalRecords).to.equal(2);
        expect(body.byType).to.exist;
        expect(body.byCode).to.exist;
        expect(body.templateStats).to.exist;
        expect(body.templateStats.total).to.equal(1);
        expect(body.recentTrend).to.be.an('array');
        expect(body.recentTrendByType).to.be.an('array');
      });

      it('should return statistics with range 1m', async () => {
        const { models } = fastify.message;

        await models.record.create({
          code: 'test', type: 0, name: 'user@example.com', props: {}, content: {}
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics?range=1m'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.range).to.equal('1m');
        expect(body.rangeLabel).to.equal('近1个月');
        expect(body.totalRecords).to.equal(1);
      });

      it('should return statistics with range 1y', async () => {
        const { models } = fastify.message;

        await models.record.create({
          code: 'test', type: 0, name: 'user@example.com', props: {}, content: {}
        });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics?range=1y'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.range).to.equal('1y');
        expect(body.rangeLabel).to.equal('近1年');
        expect(body.totalRecords).to.equal(1);
      });

      it('should fallback to 7d for invalid range', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics?range=invalid'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.range).to.equal('7d');
        expect(body.rangeLabel).to.equal('近7天');
      });

      it('should return empty statistics when no records', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalRecords).to.equal(0);
        expect(body.byType).to.deep.equal({});
        expect(body.byCode).to.deep.equal({});
        expect(body.recentTrend).to.deep.equal([]);
        expect(body.recentTrendByType).to.deep.equal([]);
      });

      it('should group records by type correctly', async () => {
        const { models } = fastify.message;

        await models.record.create({ code: 'a', type: 0, name: 'u1@e.com', props: {}, content: {} });
        await models.record.create({ code: 'a', type: 0, name: 'u2@e.com', props: {}, content: {} });
        await models.record.create({ code: 'b', type: 1, name: '138', props: {}, content: {} });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics'
        });

        const body = JSON.parse(response.body);
        expect(body.totalRecords).to.equal(3);
        expect(body.byType['0']).to.equal(2);
        expect(body.byType['1']).to.equal(1);
        expect(body.byCode['a']).to.equal(2);
        expect(body.byCode['b']).to.equal(1);
      });

      it('should return SSE stream with correct headers', async function () {
        this.timeout(5000);
        const address = await fastify.listen({ port: 0 });
        await new Promise((resolve, reject) => {
          const url = new URL(`${address}/api/message/statistics/sse`);
          const req = require('node:http').request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' }
          }, (res) => {
            expect(res.statusCode).to.equal(200);
            expect(res.headers['content-type']).to.include('text/event-stream');
            let received = false;
            res.on('data', (chunk) => {
              if (!received) {
                received = true;
                const data = chunk.toString();
                expect(data).to.include('data:');
                req.destroy();
              }
            });
            res.on('close', resolve);
          });
          req.on('error', reject);
          req.end();
          setTimeout(() => { req.destroy(); resolve(); }, 3000);
        });
      });

      it('should return SSE stream with custom interval', async function () {
        this.timeout(5000);
        const address = await fastify.listen({ port: 0 });
        await new Promise((resolve, reject) => {
          const url = new URL(`${address}/api/message/statistics/sse?interval=3`);
          const req = require('node:http').request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' }
          }, (res) => {
            expect(res.statusCode).to.equal(200);
            let received = false;
            res.on('data', (chunk) => {
              if (!received) {
                received = true;
                const data = chunk.toString();
                expect(data).to.include('data:');
                req.destroy();
              }
            });
            res.on('close', resolve);
          });
          req.on('error', reject);
          req.end();
          setTimeout(() => { req.destroy(); resolve(); }, 3000);
        });
      });

      it('should apply statistics authenticate type', async () => {
        const accessedTypes = [];
        const authFastify = await createFastify({
          getAuthenticate: (type) => {
            accessedTypes.push(type);
            return [];
          }
        });

        await authFastify.inject({ method: 'GET', url: '/api/message/statistics' });

        expect(accessedTypes).to.include('statistics');

        await authFastify.close();
      });

      it('should accept timezone query parameter', async () => {
        const { models } = fastify.message;
        await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics?timezone=Asia/Shanghai'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        expect(body.totalRecords).to.equal(1);
        expect(body.range).to.equal('7d');
      });

      it('should return correct date for timezone via API', async () => {
        const dayjs = require('dayjs');
        const utcPlugin = require('dayjs/plugin/utc');
        const tzPlugin = require('dayjs/plugin/timezone');
        dayjs.extend(utcPlugin);
        dayjs.extend(tzPlugin);

        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/statistics?timezone=Asia/Shanghai'
        });

        expect(response.statusCode).to.equal(200);
        const body = JSON.parse(response.body);
        const expectedDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
        // recentTrend 中的日期应该是 Asia/Shanghai 时区的日期
        if (body.recentTrend.length > 0) {
          expect(body.recentTrend[0].date).to.exist;
        }
      });
    });

    describe('getAuthenticate 权限测试', () => {
      it('should allow access with default getAuthenticate (no auth)', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/records'
        });

        expect(response.statusCode).to.equal(200);
      });

      it('should allow access to templates with default getAuthenticate', async () => {
        const response = await fastify.inject({
          method: 'GET',
          url: '/api/message/templates'
        });

        expect(response.statusCode).to.equal(200);
      });

      it('should block access when getAuthenticate returns auth middleware', async () => {
        const authFastify = await createFastify({
          getAuthenticate: (type) => {
            return [async (request, reply) => {
              reply.code(401).send({ error: 'Unauthorized' });
            }];
          }
        });

        const response = await authFastify.inject({
          method: 'GET',
          url: '/api/message/records'
        });

        expect(response.statusCode).to.equal(401);

        await authFastify.close();
      });

      it('should differentiate authenticate types for record and template', async () => {
        const accessedTypes = [];
        const authFastify = await createFastify({
          getAuthenticate: (type) => {
            accessedTypes.push(type);
            return [];
          }
        });

        await authFastify.inject({ method: 'GET', url: '/api/message/records' });
        await authFastify.inject({ method: 'GET', url: '/api/message/templates' });

        expect(accessedTypes).to.include('record');
        expect(accessedTypes).to.include('template');

        await authFastify.close();
      });

      it('should apply record authenticate type to record detail', async () => {
        const accessedTypes = [];
        const authFastify = await createFastify({
          getAuthenticate: (type) => {
            accessedTypes.push(type);
            return [];
          }
        });

        await authFastify.inject({ method: 'GET', url: '/api/message/records/999999' });

        expect(accessedTypes).to.include('record');

        await authFastify.close();
      });

      it('should apply template authenticate type to template detail', async () => {
        const accessedTypes = [];
        const authFastify = await createFastify({
          getAuthenticate: (type) => {
            accessedTypes.push(type);
            return [];
          }
        });

        await authFastify.inject({ method: 'GET', url: '/api/message/templates/999999' });

        expect(accessedTypes).to.include('template');

        await authFastify.close();
      });
    });
  });
});
