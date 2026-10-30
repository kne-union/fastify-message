const { expect } = require('chai');
const nodemailer = require('nodemailer');
const { createFastify } = require('../helpers/app');

// 替换 nodemailer.createTransport，记录建连配置与发送内容
const stubTransport = () => {
  const original = nodemailer.createTransport;
  const calls = [];
  nodemailer.createTransport = config => {
    const call = { config, sent: [], verified: false, closed: false };
    calls.push(call);
    return {
      verify: async () => {
        if (config.auth && config.auth.pass === 'wrong') throw new Error('Invalid login');
        call.verified = true;
        return true;
      },
      sendMail: async mailOptions => call.sent.push(mailOptions),
      close: () => (call.closed = true)
    };
  };
  return { calls, restore: () => (nodemailer.createTransport = original) };
};

describe('@kne/fastify-message 租户模版与租户 SMTP', function () {
  this.timeout(10000);

  describe('租户模版选择', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('传 tenantId 时租户启用的模版优先，停用或其它租户回退到全局模版', async () => {
      const { models, services } = fastify.message;
      await models.template.create({ code: 'invite', type: 0, level: 0, subject: '系统', content: 'c' });
      const own = await models.template.create({ code: 'invite', type: 0, level: 1, tenantId: 't1', subject: '租户', content: 'c' });

      expect((await services.messageTemplate({ code: 'invite', type: 0, tenantId: 't1' })).content.subject).to.equal('租户');
      expect((await services.messageTemplate({ code: 'invite', type: 0, tenantId: 't2' })).content.subject).to.equal('系统');
      expect((await services.messageTemplate({ code: 'invite', type: 0 })).content.subject).to.equal('系统');

      await own.update({ status: 1 });
      expect((await services.messageTemplate({ code: 'invite', type: 0, tenantId: 't1' })).content.subject).to.equal('系统');
    });

    it('全局没有、仅其它租户有的模版视为不存在', async () => {
      const { models, services } = fastify.message;
      await models.template.create({ code: 'only', type: 0, level: 1, tenantId: 't1', content: 'c' });
      const record = await services.sendMessage({ code: 'only', type: 0, name: 'a@b.com', tenantId: 't2' });
      expect(record.status).to.equal(1);
      expect(record.error).to.equal('template not found');
    });

    it('发送记录保存 tenantId，模版管理按 tenantId 隔离编码', async () => {
      const { models, services } = fastify.message;
      const sys = await models.template.create({ code: 'notice', type: 0, level: 0, subject: 's', content: 'c' });
      const record = await services.sendMessage({ code: 'notice', type: 0, name: 'a@b.com', tenantId: 't1' });
      expect(record.tenantId).to.equal('t1');

      const copied = await services.template.copy({ id: sys.id, tenantId: 't1' });
      expect(copied.code).to.equal('notice');
      expect(copied.tenantId).to.equal('t1');
      expect(copied.status).to.equal(1);
      const globalCopy = await services.template.copy({ id: sys.id });
      expect(globalCopy.code).to.equal('notice');
      expect(globalCopy.tenantId).to.equal('');

      await services.template.create({ code: 'biz', type: 0, tenantId: 't1', content: 'c' });
      await services.template.create({ code: 'biz', type: 0, content: 'c' });
      try {
        await services.template.create({ code: 'biz', type: 0, tenantId: 't1', content: 'c' });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.statusCode).to.equal(409);
      }
    });

    it('模版列表接口默认只返回全局模版，可按 tenantId 查询', async () => {
      const { models } = fastify.message;
      await models.template.bulkCreate([
        { code: 'g', type: 0, level: 1 },
        { code: 't', type: 0, level: 1, tenantId: 't1' }
      ]);
      const list = async query => (await fastify.inject({ method: 'GET', url: `/api/message/templates${query}` })).json().pageData.map(item => item.code);
      expect(await list('')).to.deep.equal(['g']);
      const tenantList = (await fastify.inject({ method: 'GET', url: '/api/message/templates?filter[tenantId]=t1' })).json().pageData;
      expect(tenantList.map(item => item.code)).to.deep.equal(['t']);
      expect(tenantList[0].tenantId).to.equal('t1');
    });
  });

  describe('租户 SMTP', () => {
    let stub;

    beforeEach(() => {
      stub = stubTransport();
    });

    afterEach(() => {
      stub.restore();
    });

    it('getEmailConfig 返回配置时使用租户 SMTP 与发件人，重发仍使用租户配置', async () => {
      let fail = true;
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { host: 'smtp.global.com', user: 'global@example.com', pass: 'g' },
        senders: { 0: async () => {} },
        getEmailConfig: async ({ tenantId }) => {
          if (tenantId !== 't1') return null;
          if (fail) throw new Error('smtp down');
          return { host: 'smtp.tenant.com', port: 587, secure: false, user: 'u@tenant.com', pass: 'p', fromName: 'Tenant', fromAddress: 'noreply@tenant.com' };
        }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });
        const failed = await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 't1', options: { title: '标题' } });
        expect(failed.status).to.equal(1);

        fail = false;
        const retried = await services.record.retry({ id: failed.id });
        expect(retried.status).to.equal(0);
        expect(stub.calls).to.have.length(1);
        expect(stub.calls[0].config).to.include({ host: 'smtp.tenant.com', port: 587, secure: false });
        expect(stub.calls[0].config.auth).to.deep.equal({ user: 'u@tenant.com', pass: 'p' });
        expect(stub.calls[0].sent[0].from).to.equal('"Tenant" <noreply@tenant.com>');
      } finally {
        await fastify.close();
      }
    });

    it('租户未配置 SMTP 时沿用全局发送器', async () => {
      let received;
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'global@example.com' },
        senders: { 0: async mailOptions => (received = mailOptions) },
        getEmailConfig: async () => null
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });
        const record = await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 't1' });
        expect(record.status).to.equal(0);
        expect(received.from).to.equal('"global@example.com" <global@example.com>');
        expect(stub.calls).to.have.length(0);
      } finally {
        await fastify.close();
      }
    });

    it('verifyEmailConfig 校验连接并可发送测试邮件，失败返回 400', async () => {
      const fastify = await createFastify();
      try {
        const { services } = fastify.message;
        const result = await services.verifyEmailConfig({ config: { host: 'smtp.tenant.com', user: 'u@tenant.com', pass: 'p' }, to: 'a@b.com' });
        expect(result.success).to.equal(true);
        expect(stub.calls[0].verified).to.equal(true);
        expect(stub.calls[0].closed).to.equal(true);
        expect(stub.calls[0].sent[0].to).to.equal('a@b.com');
        expect(stub.calls[0].sent[0].from).to.equal('"u@tenant.com" <u@tenant.com>');

        try {
          await services.verifyEmailConfig({ config: { host: 'smtp.tenant.com', user: 'u', pass: 'wrong' } });
          throw new Error('Should have thrown');
        } catch (error) {
          expect(error.statusCode).to.equal(400);
          expect(error.message).to.equal('Invalid login');
        }
      } finally {
        await fastify.close();
      }
    });
  });
});
