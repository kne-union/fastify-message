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
        subject: '欢迎',
        content: '<h1>你好，{{ name }}！</h1>',
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
        subject: '欢迎加入',
        content: '<p>欢迎您</p>',
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
          subject: '主题',
          content: '内容',
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
          subject: '自定义主题',
          content: '<p>HTML内容</p>',
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

    it('should send email through a pooled nodemailer transport and close it on shutdown', async () => {
      const originalCreateTransport = nodemailer.createTransport;
      const sentOptions = [];
      const transportConfigs = [];
      let closed = 0;
      nodemailer.createTransport = config => {
        transportConfigs.push(config);
        return {
          sendMail: async mailOptions => {
            sentOptions.push(mailOptions);
          },
          close: () => {
            closed += 1;
          }
        };
      };

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
          content: '<p>无主题内容</p>',
          level: 0
        });

        for (const name of ['smtp@example.com', 'smtp2@example.com']) {
          await services.sendMessage({ code: 'smtp_email', type: 0, name, props: {} });
        }

        expect(sentOptions.map(item => item.to)).to.deep.equal(['smtp@example.com', 'smtp2@example.com']);
        expect(sentOptions[0].subject).to.equal('默认主题');
        expect(sentOptions[0].text).to.include('无主题内容');
        expect(transportConfigs.length).to.equal(1);
        expect(transportConfigs[0].pool).to.equal(true);
        expect(closed).to.equal(0);
      } finally {
        await fastifyWithSmtp.close();
        nodemailer.createTransport = originalCreateTransport;
      }
      expect(closed).to.equal(1);
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
          content: '验证码{{ code }}',
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

    it('should record failure when non-email sender is missing', async () => {
      const { models, services } = fastify.message;
      await models.template.create({
        code: 'push_notice',
        type: 2,
        name: '推送',
        content: '推送内容',
        level: 0
      });

      const record = await services.sendMessage({
        code: 'push_notice',
        type: 2,
        name: 'user-1',
        props: {}
      });
      expect(record.status).to.equal(1);
      expect(record.error).to.equal('未配置类型 2 的消息发送器');
    });

    it('should still create record when statistics collection fails', async () => {
      const { models, services } = fastify.message;
      await models.template.create({
        code: 'stat_error',
        type: 0,
        name: '统计异常',
        subject: '统计',
        content: '内容',
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
        subject: '成功',
        content: '内容',
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
        { success: 1 }
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
          subject: '失败',
          content: '内容',
          level: 0
        });

        const result = await services.sendMessage({
          code: 'stat_failed',
          type: 0,
          name: 'user@example.com',
          props: {}
        });
        expect(result.status).to.equal(1);

        const records = await models.record.findAll({ where: { code: 'stat_failed' } });
        expect(records.length).to.equal(1);
        expect(records[0].status).to.equal(1);
        expect(records[0].error).to.equal('send failed');
        expect(collects.map(item => item.channel)).to.deep.equal(['stat_failed:0', 'stat_failed:0']);
        expect(collects.map(item => item.data)).to.deep.equal([
          { total: 1 },
          { failed: 1 }
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
        path.join(tempDir, 'welcome.liquid'),
        '<!-- subject -->欢迎 {{ name }}<!-- description -->欢迎邮件<!-- variables -->[{"name":"name","label":"姓名","example":"张三"}]<!-- html --><div>欢迎</div>'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].code).to.equal('welcome');
      expect(templates[0].type).to.equal(0);
      expect(templates[0].level).to.equal(0);
      expect(templates[0].subject).to.equal('欢迎 {{ name }}');
      expect(templates[0].description).to.equal('欢迎邮件');
      expect(templates[0].content).to.equal('<div>欢迎</div>');
      expect(templates[0].variables).to.deep.equal([{ name: 'name', label: '姓名', example: '张三' }]);
    });

    it('should parse filename with type and name, sms body from text and others to extra', async () => {
      const { includeTemplate } = fastify.message.services;
      const { models } = fastify.message;

      await fs.writeFile(
        path.join(tempDir, 'verify_1_验证码.liquid'),
        '<!-- text -->您的验证码 {{ code }}<!-- templateCode -->SMS_001'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].code).to.equal('verify');
      expect(templates[0].type).to.equal(1);
      expect(templates[0].name).to.equal('验证码');
      expect(templates[0].content).to.equal('您的验证码 {{ code }}');
      expect(templates[0].extra).to.deep.equal({ templateCode: 'SMS_001' });
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
        path.join(tempDir, 'welcome.liquid'),
        '<!-- subject -->新主题<!-- html --><div>新内容</div>'
      );

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.length).to.equal(1);
      expect(templates[0].subject).to.equal('新主题');
      expect(templates[0].content).to.equal('<div>新内容</div>');
    });

    it('should skip legacy ejs files and templates with invalid syntax', async () => {
      const { includeTemplate } = fastify.message.services;
      const { models } = fastify.message;

      await fs.writeFile(path.join(tempDir, 'legacy.ejs'), '<!-- html --><div><%= name %></div>');
      await fs.writeFile(path.join(tempDir, 'broken.liquid'), '<!-- html --><div>{{ name </div>');
      await fs.writeFile(path.join(tempDir, 'filter.liquid'), '<!-- html --><div>{{ name | upcase }}</div>');
      await fs.writeFile(path.join(tempDir, 'ok.html'), '<div>{{ name }}</div>');

      await includeTemplate(tempDir);

      const templates = await models.template.findAll();
      expect(templates.map(item => item.code)).to.deep.equal(['ok']);
      expect(templates[0].content).to.equal('<div>{{ name }}</div>');
    });
  });

  describe('renderMessage 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should escape html variables by default and keep raw output', () => {
      const { renderMessage } = fastify.message.services;
      const result = renderMessage({
        template: { type: 0, subject: '你好 {{ user.name }}', content: '<p>{{ user.name }}</p><div>{{ link | raw }}</div>' },
        props: { user: { name: '<张三>' }, link: '<a href="#">点击</a>' }
      });
      expect(result.subject).to.equal('你好 <张三>');
      expect(result.html).to.equal('<p>&lt;张三&gt;</p><div><a href="#">点击</a></div>');
      expect(result.text).to.include('<张三>');
    });

    it('should render if / else condition', () => {
      const { renderMessage } = fastify.message.services;
      const template = { type: 0, content: '{% if vip %}<p>尊敬的会员</p>{% else %}<p>您好</p>{% endif %}' };
      expect(renderMessage({ template, props: { vip: true } }).html).to.equal('<p>尊敬的会员</p>');
      expect(renderMessage({ template, props: {} }).html).to.equal('<p>您好</p>');
    });

    it('should render sms in text mode without escaping and render extra sections', () => {
      const { renderMessage } = fastify.message.services;
      const result = renderMessage({
        template: { type: 1, content: '{{ name }} 的验证码 {{ code }}', extra: { templateCode: 'SMS_{{ scene }}' } },
        props: { name: 'A&B', code: '1234', scene: 'login' }
      });
      expect(result).to.deep.equal({ text: 'A&B 的验证码 1234', templateCode: 'SMS_login' });
    });
  });

  describe('template 管理服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should create business template and reject invalid syntax or duplicated code', async () => {
      const { services } = fastify.message;
      const tpl = await services.template.create({ name: '通知', code: 'notice', type: 0, subject: '通知', content: '<p>{{ name }}</p>' });
      expect(tpl.level).to.equal(1);
      expect(tpl.status).to.equal(0);

      try {
        await services.template.create({ name: '通知2', code: 'notice', type: 0, content: '<p>x</p>' });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.statusCode).to.equal(409);
      }

      try {
        await services.template.create({ name: '错误', code: 'bad', type: 0, content: '<p>{% for a in b %}{% endfor %}</p>' });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.statusCode).to.equal(400);
        expect(error.message).to.include('content');
      }
    });

    it('should forbid editing or removing system templates and copy them as disabled business templates', async () => {
      const { models, services } = fastify.message;
      const system = await models.template.create({ code: 'welcome', type: 0, level: 0, name: '欢迎', content: '<p>欢迎</p>' });

      for (const action of [() => services.template.save({ id: system.id, name: 'x' }), () => services.template.remove({ id: system.id })]) {
        try {
          await action();
          throw new Error('Should have thrown');
        } catch (error) {
          expect(error.statusCode).to.equal(403);
        }
      }

      const copy = await services.template.copy({ id: system.id });
      expect(copy.code).to.equal('welcome');
      expect(copy.level).to.equal(1);
      expect(copy.status).to.equal(1);
      expect(copy.content).to.equal('<p>欢迎</p>');

      const copy2 = await services.template.copy({ id: copy.id });
      expect(copy2.code).to.equal('welcome_copy');
    });

    it('should save, set status and remove business template', async () => {
      const { models, services } = fastify.message;
      const tpl = await services.template.create({ name: '短信', code: 'sms', type: 1, content: '验证码 {{ code }}' });

      const saved = await services.template.save({ id: tpl.id, content: '新验证码 {{ code }}', variables: [{ name: 'code', label: '验证码' }] });
      expect(saved.content).to.equal('新验证码 {{ code }}');
      expect(saved.variables).to.deep.equal([{ name: 'code', label: '验证码' }]);

      const disabled = await services.template.setStatus({ id: tpl.id, status: 1 });
      expect(disabled.status).to.equal(1);

      await services.template.remove({ id: tpl.id });
      expect(await models.template.count()).to.equal(0);
    });

    it('should render unsaved template with variables example as props', async () => {
      const { services } = fastify.message;
      const result = await services.template.render({
        template: { type: 0, subject: '{{ user.name }} 你好', content: '<p>{{ code }}</p>', variables: [{ name: 'user.name', example: '张三' }, { name: 'code', example: '8888' }] }
      });
      expect(result.subject).to.equal('张三 你好');
      expect(result.html).to.equal('<p>8888</p>');
      expect(result.props).to.deep.equal({ user: { name: '张三' }, code: '8888' });
    });
  });
});
