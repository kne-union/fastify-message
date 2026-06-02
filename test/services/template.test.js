const { expect } = require('chai');
const path = require('node:path');
const fs = require('fs-extra');
const nodemailer = require('nodemailer');
const { createFastify } = require('../helpers/app');

describe('@kne/fastify-message 模板与消息服务', function () {
  this.timeout(10000);

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
      const fastifyWithSender = await createFastify({
        senders: {
          0: async mailOptions => mailOptions
        }
      });

      try {
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

        const records = await models.record.findAll();
        expect(records.length).to.equal(1);
      } finally {
        await fastifyWithSender.close();
      }
    });

    it('should call custom email sender when not in test mode', async () => {
      let receivedOptions;
      const fastifyWithSender = await createFastify({
        isTest: false,
        senders: {
          0: async mailOptions => {
            receivedOptions = mailOptions;
          }
        }
      });

      try {
        const { models, services } = fastifyWithSender.message;
        await models.template.create({
          code: 'custom_email',
          type: 0,
          name: '自定义邮件',
          content: '<!-- subject -->自定义主题<!-- html --><p>HTML内容</p>',
          level: 0
        });

        await services.sendMessage({
          code: 'custom_email',
          type: 0,
          name: 'user@example.com',
          props: {},
          options: { title: 'Test Sender' }
        });

        expect(receivedOptions.to).to.equal('user@example.com');
        expect(receivedOptions.subject).to.equal('自定义主题');
        expect(receivedOptions.from).to.include('Test Sender');
      } finally {
        await fastifyWithSender.close();
      }
    });

    it('should send email through nodemailer transport when no custom sender is configured', async () => {
      const originalCreateTransport = nodemailer.createTransport;
      let sentOptions;
      let closed = false;
      nodemailer.createTransport = () => ({
        sendMail: async mailOptions => {
          sentOptions = mailOptions;
        },
        close: () => {
          closed = true;
        }
      });

      const fastifyWithSmtp = await createFastify({
        isTest: false,
        emailConfig: {
          host: 'smtp.example.com',
          user: 'noreply@example.com',
          pass: 'secret',
          defaultSubject: '默认主题'
        }
      });

      try {
        const { models, services } = fastifyWithSmtp.message;
        await models.template.create({
          code: 'smtp_email',
          type: 0,
          name: 'SMTP邮件',
          content: '<!-- html --><p>无主题内容</p>',
          level: 0
        });

        await services.sendMessage({
          code: 'smtp_email',
          type: 0,
          name: 'smtp@example.com',
          props: {}
        });

        expect(sentOptions.to).to.equal('smtp@example.com');
        expect(sentOptions.subject).to.equal('默认主题');
        expect(sentOptions.text).to.include('无主题内容');
        expect(closed).to.equal(true);
      } finally {
        nodemailer.createTransport = originalCreateTransport;
        await fastifyWithSmtp.close();
      }
    });

    it('should call custom non-email sender when not in test mode', async () => {
      let senderPayload;
      const fastifyWithSms = await createFastify({
        isTest: false,
        senders: {
          1: async data => {
            senderPayload = data;
            return { providerMessageId: 'sms-1', ...data.content };
          }
        }
      });

      try {
        const { models, services } = fastifyWithSms.message;
        await models.template.create({
          code: 'sms_code',
          type: 1,
          name: '短信',
          content: '<!-- html -->验证码<%= code %>',
          level: 0
        });

        await services.sendMessage({
          code: 'sms_code',
          type: 1,
          name: '13800138000',
          props: { code: '123456' },
          options: { scene: 'login' }
        });

        const records = await models.record.findAll({ where: { code: 'sms_code' } });
        expect(senderPayload.name).to.equal('13800138000');
        expect(senderPayload.options.scene).to.equal('login');
        expect(records[0].content.providerMessageId).to.equal('sms-1');
      } finally {
        await fastifyWithSms.close();
      }
    });

    it('should throw when non-email sender is missing', async () => {
      const { models, services } = fastify.message;
      await models.template.create({
        code: 'push_notice',
        type: 2,
        name: '推送',
        content: '<!-- html -->推送内容',
        level: 0
      });

      try {
        await services.sendMessage({
          code: 'push_notice',
          type: 2,
          name: 'user-1',
          props: {}
        });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.message).to.equal('未配置类型 2 的消息发送器');
      }
    });

    it('should still create record when statistics collection fails', async () => {
      const { models, services } = fastify.message;
      await models.template.create({
        code: 'stat_error',
        type: 0,
        name: '统计异常',
        content: '<!-- subject -->统计<!-- html -->内容',
        level: 0
      });
      fastify.messageStatistics.services.collect = async () => {
        throw new Error('collect failed');
      };

      await services.sendMessage({
        code: 'stat_error',
        type: 0,
        name: 'user@example.com',
        props: {}
      });

      const records = await models.record.findAll({ where: { code: 'stat_error' } });
      expect(records.length).to.equal(1);
    });

    it('should collect total before send and success only after successful send', async () => {
      const { models, services } = fastify.message;
      const collects = [];
      fastify.messageStatistics.services.collect = async payload => {
        collects.push(payload);
      };
      await models.template.create({
        code: 'stat_success',
        type: 0,
        name: '成功统计',
        content: '<!-- subject -->成功<!-- html -->内容',
        level: 0
      });

      await services.sendMessage({
        code: 'stat_success',
        type: 0,
        name: 'user@example.com',
        props: {}
      });

      expect(collects.map(item => item.channel)).to.deep.equal(['stat_success:0', 'stat_success:0']);
      expect(collects.map(item => item.data)).to.deep.equal([
        { total: 1 },
        { total: 0, success: 1 }
      ]);
    });

    it('should collect failed without success when sender throws', async () => {
      const collects = [];
      const fastifyWithFailingSender = await createFastify({
        isTest: false,
        senders: {
          0: async () => {
            throw new Error('send failed');
          }
        }
      });

      try {
        const { models, services } = fastifyWithFailingSender.message;
        fastifyWithFailingSender.messageStatistics.services.collect = async payload => {
          collects.push(payload);
        };
        await models.template.create({
          code: 'stat_failed',
          type: 0,
          name: '失败统计',
          content: '<!-- subject -->失败<!-- html -->内容',
          level: 0
        });

        try {
          await services.sendMessage({
            code: 'stat_failed',
            type: 0,
            name: 'user@example.com',
            props: {}
          });
          throw new Error('Should have thrown');
        } catch (error) {
          expect(error.message).to.equal('send failed');
        }

        const records = await models.record.findAll({ where: { code: 'stat_failed' } });
        expect(records.length).to.equal(0);
        expect(collects.map(item => item.channel)).to.deep.equal(['stat_failed:0', 'stat_failed:0']);
        expect(collects.map(item => item.data)).to.deep.equal([
          { total: 1 },
          { total: 0, failed: 1 }
        ]);
      } finally {
        await fastifyWithFailingSender.close();
      }
    });
  });

  describe('includeTemplate 服务测试', () => {
    let fastify;
    let tempDir;

    beforeEach(async () => {
      fastify = await createFastify();
      tempDir = path.join(__dirname, '..', 'temp-templates');
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
});
