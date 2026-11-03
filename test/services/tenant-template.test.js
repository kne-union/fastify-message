const { expect } = require('chai');
const nodemailer = require('nodemailer');
const { createFastify } = require('../helpers/app');

const stubTransport = () => {
  const original = nodemailer.createTransport;
  const calls = [];
  nodemailer.createTransport = config => {
    const call = { config, sent: [] };
    calls.push(call);
    return {
      verify: async () => {},
      sendMail: async mailOptions => call.sent.push(mailOptions),
      close: () => {}
    };
  };
  return { calls, restore: () => (nodemailer.createTransport = original) };
};

const expectHttpError = async (promise, statusCode) => {
  try {
    await promise;
  } catch (error) {
    expect(error.statusCode).to.equal(statusCode);
    return error;
  }
  throw new Error('Should have thrown');
};

describe('@kne/fastify-message 租户模版开放范围 tenantTemplate', function () {
  this.timeout(10000);

  describe('白名单 ∩ tenantOpen', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify({ mailSettingTemplateCodes: ({ tenantId }) => (tenantId === 'all' ? null : ['invite', 'remind']) });
      await fastify.message.models.template.bulkCreate([
        { code: 'invite', type: 0, level: 0, name: '邀请', subject: 's', content: 'c' },
        { code: 'remind', type: 0, level: 0, name: '提醒', subject: 's', content: 'c' },
        { code: 'register', type: 0, level: 0, name: '注册', subject: 's', content: 'c' },
        { code: 'off', type: 0, level: 0, name: '停用', subject: 's', content: 'c', status: 1 },
        { code: 'invite', type: 1, level: 0, name: '邀请短信', content: 'c' }
      ]);
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('list 只返回白名单内启用的系统模版，按类型区分，未配置白名单时返回全部', async () => {
      const { tenantTemplate } = fastify.message.services;
      expect((await tenantTemplate.list({ tenantId: 'c1' })).map(item => item.code)).to.deep.equal(['invite', 'remind']);
      expect((await tenantTemplate.list({ tenantId: 'c1', type: 1 })).map(item => item.name)).to.deep.equal(['邀请短信']);
      expect((await tenantTemplate.list({ tenantId: 'all' })).map(item => item.code)).to.deep.equal(['invite', 'register', 'remind']);
      await expectHttpError(tenantTemplate.list({ tenantId: 'c1', type: 2 }), 400);
    });

    it('get 不在白名单返回 403，不存在返回 404', async () => {
      const { tenantTemplate } = fastify.message.services;
      expect(await tenantTemplate.get({ tenantId: 'c1', code: 'invite' })).to.include({ code: 'invite', type: 0, name: '邀请' });
      await expectHttpError(tenantTemplate.get({ tenantId: 'c1', code: 'register' }), 403);
      await expectHttpError(tenantTemplate.get({ tenantId: 'all', code: 'missing' }), 404);
    });

    it('白名单内模版默认开放，关闭后租户端不可见，平台代管传 includeTenantClosed 不受影响', async () => {
      const { tenantTemplate } = fastify.message.services;
      const invite = await fastify.message.models.template.findOne({ where: { code: 'invite', type: 0, level: 0 } });
      expect(invite.tenantOpen).to.equal(true);

      await tenantTemplate.setTenantOpen({ id: invite.id, tenantOpen: false });
      expect((await tenantTemplate.list({ tenantId: 'c1' })).map(item => item.code)).to.deep.equal(['remind']);
      await expectHttpError(tenantTemplate.get({ tenantId: 'c1', code: 'invite' }), 404);
      expect((await tenantTemplate.list({ tenantId: 'c1', includeTenantClosed: true })).map(item => item.code)).to.deep.equal(['invite', 'remind']);
      expect(await tenantTemplate.get({ tenantId: 'c1', code: 'invite', includeTenantClosed: true })).to.include({ code: 'invite' });

      await tenantTemplate.setTenantOpen({ id: invite.id, tenantOpen: true });
      expect((await tenantTemplate.list({ tenantId: 'c1' })).map(item => item.code)).to.deep.equal(['invite', 'remind']);
    });

    it('只能设置白名单内的全局系统模版，平台模版列表标注 tenantCustomizable', async () => {
      const { tenantTemplate, template } = fastify.message.services;
      const register = await fastify.message.models.template.findOne({ where: { code: 'register', type: 0, level: 0 } });
      await expectHttpError(tenantTemplate.setTenantOpen({ id: register.id, tenantOpen: false }), 403);
      await expectHttpError(tenantTemplate.setTenantOpen({ id: '999999', tenantOpen: false }), 404);

      const remind = await fastify.message.models.template.findOne({ where: { code: 'remind', type: 0, level: 0 } });
      const own = await template.copy({ id: remind.id, tenantId: 'c1' });
      await expectHttpError(tenantTemplate.setTenantOpen({ id: own.id, tenantOpen: false }), 403);

      const { pageData } = await template.list({ filter: { tenantId: '' } });
      const marked = await tenantTemplate.withTenantCustomizable(pageData);
      const flags = Object.fromEntries(marked.map(item => [`${item.code}:${item.type}`, item.tenantCustomizable]));
      expect(flags).to.deep.equal({ 'invite:0': true, 'remind:0': true, 'register:0': false, 'off:0': false, 'invite:1': true });
    });
  });

  describe('发送使用 getEmailConfig 提供的租户 SMTP', () => {
    let stub;

    beforeEach(() => {
      stub = stubTransport();
    });

    afterEach(() => {
      stub.restore();
    });

    it('返回配置的租户用租户 SMTP 发送，返回空或未配置钩子时沿用全局发送器', async () => {
      const received = [];
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'global@example.com' },
        senders: { 0: async mailOptions => received.push(mailOptions) },
        getEmailConfig: async ({ tenantId }) => (tenantId === 'c1' ? { host: 'smtp.c1.com', user: 'u@c1.com', pass: 'p', fromName: 'C1', fromAddress: 'noreply@c1.com' } : null)
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });

        expect((await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 'c1' })).status).to.equal(0);
        expect(stub.calls).to.have.length(1);
        expect(stub.calls[0].config).to.include({ host: 'smtp.c1.com' });
        expect(stub.calls[0].sent[0].from).to.equal('"C1" <noreply@c1.com>');

        expect((await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 'c2' })).status).to.equal(0);
        expect(received).to.have.length(1);
        expect(stub.calls).to.have.length(1);
      } finally {
        await fastify.close();
      }

      const plain = await createFastify({ isTest: false, emailConfig: { user: 'global@example.com' }, senders: { 0: async mailOptions => received.push(mailOptions) } });
      try {
        await plain.message.models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });
        expect((await plain.message.services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 'c1' })).status).to.equal(0);
        expect(received).to.have.length(2);
      } finally {
        await plain.close();
      }
    });
  });
});
