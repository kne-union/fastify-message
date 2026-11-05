const { expect } = require('chai');
const nodemailer = require('nodemailer');
const { createFastify } = require('../helpers/app');

const stubTransport = ({ verifyError } = {}) => {
  const original = nodemailer.createTransport;
  const calls = [];
  nodemailer.createTransport = config => {
    const call = { config, sent: [], verified: false };
    calls.push(call);
    return {
      verify: async () => {
        if (verifyError) throw new Error(verifyError);
        call.verified = true;
      },
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

describe('@kne/fastify-message 租户邮件设置 mailSetting', function () {
  this.timeout(10000);

  describe('SMTP 配置', () => {
    let fastify, stub;

    beforeEach(async () => {
      stub = stubTransport();
      fastify = await createFastify();
    });

    afterEach(async () => {
      stub.restore();
      await fastify.close();
    });

    it('未配置时返回默认值，保存后不回传密码，密码为空时保留原密码', async () => {
      const { mailSetting } = fastify.message.services;
      expect(await mailSetting.smtpDetail({ tenantId: 'c1' })).to.include({ configured: false, hasPassword: false });

      const saved = await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com', port: 587, secure: false, user: 'u@c1.com', pass: 'p1', fromName: 'C1' });
      expect(saved).to.include({ configured: true, hasPassword: true, host: 'smtp.c1.com', port: 587, secure: false, fromName: 'C1' });
      expect(saved).to.not.have.property('pass');

      await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp2.c1.com', user: 'u@c1.com', pass: '' });
      const config = await mailSetting.getEmailConfig({ tenantId: 'c1' });
      expect(config).to.include({ host: 'smtp2.c1.com', pass: 'p1' });
      expect(await mailSetting.smtpDetail({ tenantId: 'c2' })).to.include({ configured: false });
    });

    it('停用或删除后 getEmailConfig 返回空，tenantId 为空或配置不完整返回 400', async () => {
      const { mailSetting } = fastify.message.services;
      await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com', user: 'u', pass: 'p', enabled: false });
      expect(await mailSetting.getEmailConfig({ tenantId: 'c1' })).to.equal(null);

      await mailSetting.smtpSave({ tenantId: 'c1', enabled: true });
      expect(await mailSetting.getEmailConfig({ tenantId: 'c1' })).to.include({ host: 'smtp.c1.com' });

      await mailSetting.smtpRemove({ tenantId: 'c1' });
      expect(await mailSetting.smtpDetail({ tenantId: 'c1' })).to.include({ configured: false });

      await expectHttpError(mailSetting.smtpDetail({}), 400);
      await expectHttpError(mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com' }), 400);
    });

    it('启用时保存前校验连接，未通过不落库；停用时不校验', async () => {
      const { mailSetting } = fastify.message.services;
      await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com', user: 'u@c1.com', pass: 'saved' });
      expect(stub.calls).to.have.length(1);
      expect(stub.calls[0].verified).to.equal(true);
      expect(stub.calls[0].config.auth).to.deep.equal({ user: 'u@c1.com', pass: 'saved' });

      stub.restore();
      stub = stubTransport({ verifyError: 'Invalid login' });
      const error = await expectHttpError(mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.bad.com', user: 'u@c1.com' }), 400);
      expect(error.message).to.include('Invalid login');
      expect(await mailSetting.smtpDetail({ tenantId: 'c1' })).to.include({ host: 'smtp.c1.com' });
      await expectHttpError(mailSetting.smtpSave({ tenantId: 'c2', host: 'smtp.bad.com', user: 'u', pass: 'p' }), 400);
      expect(await mailSetting.smtpDetail({ tenantId: 'c2' })).to.include({ configured: false });

      await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.bad.com', user: 'u@c1.com', enabled: false });
      expect(await mailSetting.smtpDetail({ tenantId: 'c1' })).to.include({ host: 'smtp.bad.com', enabled: false });
    });
  });

  describe('模版定制', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify({ mailSettingTemplateCodes: ({ tenantId }) => (tenantId === 'all' ? null : ['invite', 'remind']) });
      await fastify.message.models.template.bulkCreate([
        { code: 'invite', type: 0, level: 0, name: '邀请', subject: '系统邀请 {{ name }}', content: '<p>{{ name }}</p>', variables: [{ name: 'name', example: '张三' }] },
        { code: 'remind', type: 0, level: 0, name: '提醒', subject: '提醒', content: 'c' },
        { code: 'register', type: 0, level: 0, name: '注册', subject: '注册', content: 'c' },
        { code: 'invite', type: 1, level: 0, name: '邀请短信', content: 'c' }
      ]);
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('列表只包含白名单内的系统邮件模版，未配置白名单时返回全部', async () => {
      const { mailSetting } = fastify.message.services;
      const { list } = await mailSetting.templateList({ tenantId: 'c1' });
      expect(list.map(item => `${item.code}:${item.type}`)).to.deep.equal(['invite:0', 'remind:0', 'invite:1']);
      expect(list[0]).to.include({ name: '邀请', customized: false, templateId: null, status: null });

      const emails = await mailSetting.templateList({ tenantId: 'c1', type: 0 });
      expect(emails.list.map(item => item.code)).to.deep.equal(['invite', 'remind']);
      const scoped = await mailSetting.templateList({ tenantId: 'c1', codes: ['remind', 'register'] });
      expect(scoped.list.map(item => `${item.code}:${item.type}`)).to.deep.equal(['remind:0']);

      const all = await mailSetting.templateList({ tenantId: 'all', type: 0 });
      expect(all.list.map(item => item.code)).to.deep.equal(['invite', 'register', 'remind']);
      await expectHttpError(mailSetting.templateList({ tenantId: 'c1', type: 2 }), 400);

      await expectHttpError(mailSetting.templateCustomize({ tenantId: 'c1', code: 'register' }), 403);
    });

    it('定制、编辑、停用、重置只影响当前租户的发送', async () => {
      const { mailSetting, messageTemplate } = fastify.message.services;
      const subjectOf = async tenantId => (await messageTemplate({ code: 'invite', type: 0, tenantId, props: { name: '李四' } })).content.subject;

      const own = await mailSetting.templateCustomize({ tenantId: 'c1', code: 'invite' });
      expect(own).to.include({ code: 'invite', name: '邀请', tenantId: 'c1', level: 1, status: 0 });
      expect((await mailSetting.templateCustomize({ tenantId: 'c1', code: 'invite' })).id).to.equal(own.id);

      await mailSetting.templateSave({ tenantId: 'c1', code: 'invite', subject: '客户邀请 {{ name }}', content: '<p>hi</p>', description: 'd' });
      expect(await subjectOf('c1')).to.equal('客户邀请 李四');
      expect(await subjectOf('c2')).to.equal('系统邀请 李四');

      const detail = await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite' });
      expect(detail.customized).to.equal(true);
      expect(detail.template.subject).to.equal('客户邀请 {{ name }}');
      expect((await mailSetting.templateList({ tenantId: 'c1' })).list[0]).to.include({ customized: true, templateId: own.id, status: 0 });

      await mailSetting.templateSetStatus({ tenantId: 'c1', code: 'invite', status: 1 });
      expect(await subjectOf('c1')).to.equal('系统邀请 李四');

      await mailSetting.templateReset({ tenantId: 'c1', code: 'invite' });
      expect((await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite' })).customized).to.equal(false);
      const again = await mailSetting.templateCustomize({ tenantId: 'c1', code: 'invite' });
      expect(again.code).to.equal('invite');
    });

    it('短信模版按类型独立定制，不影响同编码的邮件模版', async () => {
      const { mailSetting, messageTemplate } = fastify.message.services;
      const sms = await mailSetting.templateSave({ tenantId: 'c1', code: 'invite', type: 1, content: '客户短信 {{ name }}' });
      expect(sms).to.include({ code: 'invite', type: 1, level: 1, tenantId: 'c1', name: '邀请短信' });
      expect((await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite', type: 1 })).customized).to.equal(true);
      expect((await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite' })).customized).to.equal(false);

      const smsMessage = await messageTemplate({ code: 'invite', type: 1, tenantId: 'c1', props: { name: '李四' } });
      expect(smsMessage.content.text).to.equal('客户短信 李四');
      expect(await mailSetting.templatePreview({ tenantId: 'c1', code: 'invite', type: 1, template: { content: '草稿 {{ name }}' }, props: { name: '王五' } })).to.include({ text: '草稿 王五' });

      await mailSetting.templateReset({ tenantId: 'c1', code: 'invite', type: 1 });
      expect((await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite', type: 1 })).customized).to.equal(false);
      await expectHttpError(mailSetting.templateSave({ tenantId: 'c1', code: 'remind', type: 1, content: 'x' }), 404);
    });

    it('未定制时保存即创建租户模版，保存失败不留副本', async () => {
      const { mailSetting } = fastify.message.services;
      await expectHttpError(mailSetting.templateSave({ tenantId: 'c1', code: 'invite', subject: '客户 {{ name', content: '<p>x</p>' }), 400);
      expect((await mailSetting.templateDetail({ tenantId: 'c1', code: 'invite' })).customized).to.equal(false);

      const saved = await mailSetting.templateSave({ tenantId: 'c1', code: 'invite', subject: '客户邀请 {{ name }}', content: '<p>hi</p>' });
      expect(saved).to.include({ code: 'invite', name: '邀请', tenantId: 'c1', level: 1, status: 0, subject: '客户邀请 {{ name }}' });
      expect((await mailSetting.templateList({ tenantId: 'c1' })).list[0]).to.include({ customized: true, templateId: saved.id });

      await mailSetting.templateSave({ tenantId: 'c1', code: 'invite', subject: '再改 {{ name }}', content: '<p>hi</p>' });
      const list = await fastify.message.models.template.findAll({ where: { code: 'invite', type: 0, level: 1, tenantId: 'c1' } });
      expect(list).to.have.length(1);
      expect(list[0].subject).to.equal('再改 {{ name }}');
      await expectHttpError(mailSetting.templateSave({ tenantId: 'c1', code: 'register', subject: 's', content: 'c' }), 403);
    });

    it('预览默认使用示例变量，传 template 时渲染未保存的内容', async () => {
      const { mailSetting } = fastify.message.services;
      const preview = await mailSetting.templatePreview({ tenantId: 'c1', code: 'invite' });
      expect(preview).to.include({ subject: '系统邀请 张三', html: '<p>张三</p>' });

      const draft = await mailSetting.templatePreview({ tenantId: 'c1', code: 'invite', template: { subject: '草稿 {{ name }}', content: '<b>{{ name }}</b>' }, props: { name: '王五' } });
      expect(draft).to.include({ subject: '草稿 王五', html: '<b>王五</b>' });
    });

    it('白名单内模版默认开放给租户，关闭后租户端不可见、不可定制，平台代管不受影响', async () => {
      const { mailSetting } = fastify.message.services;
      const invite = await fastify.message.models.template.findOne({ where: { code: 'invite', type: 0, level: 0 } });
      expect(invite.tenantOpen).to.equal(true);

      await mailSetting.setTenantOpen({ id: invite.id, tenantOpen: false });
      const { list } = await mailSetting.templateList({ tenantId: 'c1', type: 0 });
      expect(list.map(item => item.code)).to.deep.equal(['remind']);
      await expectHttpError(mailSetting.templateDetail({ tenantId: 'c1', code: 'invite' }), 404);
      await expectHttpError(mailSetting.templateCustomize({ tenantId: 'c1', code: 'invite' }), 404);

      const managed = await mailSetting.templateList({ tenantId: 'c1', type: 0, includeTenantClosed: true });
      expect(managed.list.map(item => item.code)).to.deep.equal(['invite', 'remind']);
      await mailSetting.templateCustomize({ tenantId: 'c1', code: 'invite', includeTenantClosed: true });

      await mailSetting.setTenantOpen({ id: invite.id, tenantOpen: true });
      expect((await mailSetting.templateList({ tenantId: 'c1', type: 0 })).list.map(item => item.code)).to.deep.equal(['invite', 'remind']);
    });

    it('只能设置白名单内的全局系统模版，平台模版列表标注 tenantCustomizable', async () => {
      const { mailSetting } = fastify.message.services;
      const register = await fastify.message.models.template.findOne({ where: { code: 'register', type: 0, level: 0 } });
      await expectHttpError(mailSetting.setTenantOpen({ id: register.id, tenantOpen: false }), 403);
      await expectHttpError(mailSetting.setTenantOpen({ id: '999999', tenantOpen: false }), 404);

      const own = await mailSetting.templateCustomize({ tenantId: 'c1', code: 'remind' });
      await expectHttpError(mailSetting.setTenantOpen({ id: own.id, tenantOpen: false }), 403);

      const { pageData } = await fastify.message.services.template.list({ filter: { tenantId: '' } });
      const marked = await mailSetting.withTenantCustomizable(pageData);
      const flags = Object.fromEntries(marked.map(item => [`${item.code}:${item.type}`, item.tenantCustomizable]));
      expect(flags).to.deep.equal({ 'invite:0': true, 'remind:0': true, 'register:0': false, 'invite:1': true });
    });
  });

  describe('发送使用租户 SMTP', () => {
    let stub;

    beforeEach(() => {
      stub = stubTransport();
    });

    afterEach(() => {
      stub.restore();
    });

    it('未传 getEmailConfig 时使用 mailSetting 保存的配置，未配置的租户沿用全局发送器', async () => {
      const received = [];
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'global@example.com' },
        senders: { 0: async mailOptions => received.push(mailOptions) }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });
        await services.mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com', user: 'u@c1.com', pass: 'p', fromName: 'C1', fromAddress: 'noreply@c1.com' });
        stub.calls.length = 0;

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
    });

    it('smtpTest 未填写密码时使用已保存的密码', async () => {
      const fastify = await createFastify();
      try {
        const { mailSetting } = fastify.message.services;
        await mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.c1.com', user: 'u@c1.com', pass: 'saved' });
        stub.calls.length = 0;
        const result = await mailSetting.smtpTest({ tenantId: 'c1', host: 'smtp.c1.com', user: 'u@c1.com', to: 'a@b.com' });
        expect(result.success).to.equal(true);
        expect(stub.calls[0].config.auth).to.deep.equal({ user: 'u@c1.com', pass: 'saved' });
        expect(stub.calls[0].sent[0].to).to.equal('a@b.com');
      } finally {
        await fastify.close();
      }
    });

    it('传 getEmailConfig 时 services.mailSetting 仍存在，发送走外置实现、包内存储不参与', async () => {
      const received = [];
      const external = [];
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'global@example.com' },
        senders: { 0: async mailOptions => received.push(mailOptions) },
        getEmailConfig: async ({ tenantId }) => {
          external.push(tenantId);
          return tenantId === 'c1' ? { host: 'smtp.external.com', user: 'u@ext.com', pass: 'p' } : null;
        }
      });
      try {
        const { models, services } = fastify.message;
        expect(services.mailSetting).to.be.an('object');
        await models.template.create({ code: 'hello', type: 0, level: 0, subject: 's', content: 'c' });
        stub.calls.length = 0;

        expect((await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 'c1' })).status).to.equal(0);
        expect(external).to.deep.equal(['c1']);
        expect(stub.calls[0].config).to.include({ host: 'smtp.external.com' });

        // 包内 SMTP 存储仍可读写，但不参与发送
        await services.mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.local.com', user: 'u', pass: 'p' });
        expect(await services.mailSetting.smtpDetail({ tenantId: 'c1' })).to.include({ configured: true, host: 'smtp.local.com' });
        // 读取入口只有一个：getEmailConfig 内部走宿主实现，包内表不参与发送取值
        expect(await services.mailSetting.getEmailConfig({ tenantId: 'c1' })).to.include({ host: 'smtp.external.com' });
        external.length = 0;
        const receivedBefore = received.length;
        expect((await services.sendMessage({ code: 'hello', type: 0, name: 'a@b.com', tenantId: 'c1' })).status).to.equal(0);
        expect(external).to.deep.equal(['c1']);
        // transporter 已按外部配置缓存，这条只校验没有回落到全局发送器
        expect(received).to.have.length(receivedBefore);
      } finally {
        await fastify.close();
      }
    });

    it('getEmailConfig 返回值不受包内存储影响，未开配置的租户返回空回退全局', async () => {
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'global@example.com' },
        senders: { 0: async () => {} },
        getEmailConfig: async ({ tenantId }) => (tenantId === 'c1' ? { host: 'smtp.external.com', user: 'u@ext.com', pass: 'p' } : null)
      });
      try {
        const { services } = fastify.message;
        await services.mailSetting.smtpSave({ tenantId: 'c1', host: 'smtp.local.com', user: 'u', pass: 'p' });
        await services.mailSetting.smtpSave({ tenantId: 'c2', host: 'smtp.local.com', user: 'u', pass: 'p' });

        expect(await services.mailSetting.getEmailConfig({ tenantId: 'c1' })).to.include({ host: 'smtp.external.com' });
        expect(await services.mailSetting.getEmailConfig({ tenantId: 'c2' })).to.equal(null);
        // 不传 tenantId 时与包内实现一致，直接返回空
        expect(await services.mailSetting.getEmailConfig({})).to.equal(null);
      } finally {
        await fastify.close();
      }
    });

    it('mailSetting 的方法在任何插件参数下都完整挂载，结构不随 getEmailConfig 变化', async () => {
      const methods = [
        'getEmailConfig',
        'smtpDetail',
        'smtpSave',
        'smtpRemove',
        'smtpTest',
        'templateList',
        'templateDetail',
        'templateCustomize',
        'templateSave',
        'templateSetStatus',
        'templateReset',
        'templatePreview',
        'withTenantCustomizable',
        'setTenantOpen'
      ];

      const builtinFastify = await createFastify();
      const externalFastify = await createFastify({ getEmailConfig: async () => null });
      try {
        for (const fastify of [builtinFastify, externalFastify]) {
          const { mailSetting } = fastify.message.services;
          expect(mailSetting).to.be.an('object');
          expect(Object.keys(mailSetting).sort()).to.deep.equal([...methods].sort());
          methods.forEach(method => expect(mailSetting[method], method).to.be.a('function'));
        }
      } finally {
        await builtinFastify.close();
        await externalFastify.close();
      }
    });
  });
});
