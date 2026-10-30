const { expect } = require('chai');
const { createFastify } = require('../helpers/app');

describe('@kne/fastify-message 模板接口与权限', function () {
  this.timeout(10000);

  let fastify;

  beforeEach(async () => {
    fastify = await createFastify();
  });

  afterEach(async () => {
    await fastify.close();
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
          subject: '主题',
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
        subject: '主题',
        content: '内容',
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

    it('should return 500 when template detail service throws unknown error', async () => {
      fastify.message.services.template.detail = async () => {
        throw new Error('unexpected template error');
      };

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/message/templates/1'
      });

      expect(response.statusCode).to.equal(500);
      const body = JSON.parse(response.body);
      expect(body.message).to.equal('unexpected template error');
    });
  });

  describe('发送消息接口测试', () => {
    it('should send message via template', async () => {
      const { models } = fastify.message;

      const tpl = await models.template.create({
        code: 'welcome',
        type: 0,
        name: '欢迎邮件',
        subject: '欢迎',
        content: '<p>你好</p>',
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
          1: async data => data
        }
      });

      try {
        const tpl = await senderFastify.message.models.template.create({
          code: 'sms_notify',
          type: 1,
          name: '短信通知',
          subject: '通知',
          content: '内容',
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
      } finally {
        await senderFastify.close();
      }
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

    it('should return 500 when template send service throws unknown error', async () => {
      fastify.message.services.template.send = async () => {
        throw new Error('unexpected send error');
      };

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/message/templates/send',
        payload: {
          templateId: '1',
          name: 'user@example.com'
        }
      });

      expect(response.statusCode).to.equal(500);
      const body = JSON.parse(response.body);
      expect(body.message).to.equal('unexpected send error');
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

  describe('消息模版管理接口', () => {
    it('should create, update, copy, set status and delete template', async () => {
      const created = await fastify.inject({
        method: 'POST',
        url: '/api/message/templates',
        payload: {
          name: '订单通知',
          code: 'order',
          type: 0,
          subject: '订单 {{ orderNo }}',
          content: '<p>{{ orderNo }} 已发货</p>',
          variables: [{ name: 'orderNo', label: '订单号', example: 'A001' }]
        }
      });
      expect(created.statusCode).to.equal(200);
      const tpl = JSON.parse(created.body);
      expect(tpl.level).to.equal(1);
      expect(tpl.variables).to.deep.equal([{ name: 'orderNo', label: '订单号', example: 'A001' }]);

      const saved = await fastify.inject({
        method: 'PUT',
        url: `/api/message/templates/${tpl.id}`,
        payload: { name: '订单发货通知', description: '发货后发送' }
      });
      expect(saved.statusCode).to.equal(200);
      expect(JSON.parse(saved.body).name).to.equal('订单发货通知');

      const status = await fastify.inject({ method: 'POST', url: `/api/message/templates/${tpl.id}/status`, payload: { status: 1 } });
      expect(JSON.parse(status.body).status).to.equal(1);

      const copied = await fastify.inject({ method: 'POST', url: `/api/message/templates/${tpl.id}/copy` });
      expect(JSON.parse(copied.body).code).to.equal('order_copy');

      const removed = await fastify.inject({ method: 'DELETE', url: `/api/message/templates/${tpl.id}` });
      expect(removed.statusCode).to.equal(200);
      expect(await fastify.message.models.template.count()).to.equal(1);
    });

    it('should return 400 for invalid syntax, 409 for duplicated code and 403 for system template', async () => {
      const invalid = await fastify.inject({
        method: 'POST',
        url: '/api/message/templates',
        payload: { name: '错误', code: 'bad', type: 0, content: '<p>{{ name </p>' }
      });
      expect(invalid.statusCode).to.equal(400);

      const payload = { name: '短信', code: 'sms', type: 1, content: '验证码 {{ code }}' };
      await fastify.inject({ method: 'POST', url: '/api/message/templates', payload });
      const duplicated = await fastify.inject({ method: 'POST', url: '/api/message/templates', payload });
      expect(duplicated.statusCode).to.equal(409);

      const system = await fastify.message.models.template.create({ code: 'sys', type: 0, level: 0, name: '系统', content: '<p>x</p>' });
      const forbidden = await fastify.inject({ method: 'DELETE', url: `/api/message/templates/${system.id}` });
      expect(forbidden.statusCode).to.equal(403);
    });

    it('should render saved template by id with props', async () => {
      const tpl = await fastify.message.models.template.create({ code: 'hello', type: 1, level: 1, name: '问候', content: '你好 {{ name }}' });
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/message/templates/render',
        payload: { templateId: String(tpl.id), props: { name: '李四' } }
      });
      expect(response.statusCode).to.equal(200);
      const body = JSON.parse(response.body);
      expect(body.type).to.equal(1);
      expect(body.text).to.equal('你好 李四');
    });

    it('should filter templates by keyword', async () => {
      const { models } = fastify.message;
      await models.template.create({ code: 'order_ship', type: 0, name: '发货通知', content: '' });
      await models.template.create({ code: 'register', type: 0, name: '注册验证码', content: '' });

      const response = await fastify.inject({ method: 'GET', url: '/api/message/templates?filter[keyword]=发货' });
      const body = JSON.parse(response.body);
      expect(body.totalCount).to.equal(1);
      expect(body.pageData[0].code).to.equal('order_ship');
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
        getAuthenticate: () => {
          return [async (request, reply) => {
            reply.code(401).send({ error: 'Unauthorized' });
          }];
        }
      });

      try {
        const response = await authFastify.inject({
          method: 'GET',
          url: '/api/message/records'
        });

        expect(response.statusCode).to.equal(401);
      } finally {
        await authFastify.close();
      }
    });

    it('should differentiate authenticate types for record and template', async () => {
      const accessedTypes = [];
      const authFastify = await createFastify({
        getAuthenticate: type => {
          accessedTypes.push(type);
          return [];
        }
      });

      try {
        await authFastify.inject({ method: 'GET', url: '/api/message/records' });
        await authFastify.inject({ method: 'GET', url: '/api/message/templates' });

        expect(accessedTypes).to.include('record');
        expect(accessedTypes).to.include('template');
      } finally {
        await authFastify.close();
      }
    });

    it('should apply record authenticate type to record detail', async () => {
      const accessedTypes = [];
      const authFastify = await createFastify({
        getAuthenticate: type => {
          accessedTypes.push(type);
          return [];
        }
      });

      try {
        await authFastify.inject({ method: 'GET', url: '/api/message/records/999999' });
        expect(accessedTypes).to.include('record');
      } finally {
        await authFastify.close();
      }
    });

    it('should apply template authenticate type to template detail', async () => {
      const accessedTypes = [];
      const authFastify = await createFastify({
        getAuthenticate: type => {
          accessedTypes.push(type);
          return [];
        }
      });

      try {
        await authFastify.inject({ method: 'GET', url: '/api/message/templates/999999' });
        expect(accessedTypes).to.include('template');
      } finally {
        await authFastify.close();
      }
    });
  });
});
