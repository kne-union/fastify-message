const { expect } = require('chai');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const { createFastify } = require('../helpers/app');

const waitFor = async (check, timeout = 2000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('waitFor timeout');
};

describe('@kne/fastify-message 2.0 发送与管理增强', function () {
  this.timeout(10000);

  describe('模版选择', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('未指定 level 时启用的业务模版优先，停用后回退到系统模版', async () => {
      const { models, services } = fastify.message;
      await models.template.create({ code: 'notice', type: 0, level: 0, subject: '系统', content: '<p>sys</p>' });
      const business = await models.template.create({ code: 'notice', type: 0, level: 1, subject: '业务', content: '<p>biz</p>' });

      let result = await services.messageTemplate({ code: 'notice', type: 0, props: {} });
      expect(result.content.subject).to.equal('业务');
      expect(result.level).to.equal(1);

      await business.update({ status: 1 });
      result = await services.messageTemplate({ code: 'notice', type: 0, props: {} });
      expect(result.content.subject).to.equal('系统');

      result = await services.messageTemplate({ code: 'notice', type: 0, level: 0, props: {} });
      expect(result.level).to.equal(0);
    });

    it('停用的模版不能通过 sendMessage 发送，记为失败记录且不抛错', async () => {
      const { models, services } = fastify.message;
      await models.template.create({ code: 'off', type: 0, level: 0, status: 1, subject: 's', content: 'c' });
      const record = await services.sendMessage({ code: 'off', type: 0, name: 'a@b.com' });
      expect(record.status).to.equal(1);
      expect(record.error).to.equal('模版已禁用，无法发送消息');
      expect(await models.record.count()).to.equal(1);
    });

    it('模版不存在时 sendMessage 不抛错，记为失败记录', async () => {
      const { services } = fastify.message;
      const record = await services.sendMessage({ code: 'missing', type: 0, name: 'a@b.com' });
      expect(record.status).to.equal(1);
      expect(record.error).to.equal('template not found');
    });
  });

  describe('邮件发送参数', () => {
    it('保留调用方附件，记录中只存附件描述；发件人显示名转义', async () => {
      let received;
      const fastify = await createFastify({
        isTest: false,
        emailConfig: { user: 'noreply@example.com' },
        senders: { 0: async mailOptions => (received = mailOptions) }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'att', type: 0, level: 0, subject: 's', content: 'c' });
        await services.sendMessage({
          code: 'att',
          type: 0,
          name: 'a@b.com',
          options: { title: 'Ops "Team"\r\nBcc: x@y.com', attachments: [{ filename: 'a.txt', content: Buffer.from('hello') }] }
        });
        expect(received.attachments[0].content.toString()).to.equal('hello');
        expect(received.from).to.equal('"Ops \\"Team\\"  Bcc: x@y.com" <noreply@example.com>');
        const record = await models.record.findOne({ where: { code: 'att' } });
        expect(record.content.attachments).to.deep.equal([{ filename: 'a.txt' }]);
        expect(record.options.attachments).to.deep.equal([{ filename: 'a.txt' }]);
      } finally {
        await fastify.close();
      }
    });
  });

  describe('异步发送、重试与重发', () => {
    it('async 发送先返回待发送记录，后台完成后更新为成功', async () => {
      let release;
      const fastify = await createFastify({
        isTest: false,
        senders: { 0: () => new Promise(resolve => (release = resolve)) }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'later', type: 0, level: 0, subject: 's', content: 'c' });
        const record = await services.sendMessage({ code: 'later', type: 0, name: 'a@b.com', async: true });
        expect(record.status).to.equal(2);
        await waitFor(() => typeof release === 'function');
        release();
        await waitFor(async () => (await models.record.findByPk(record.id)).status === 0);
      } finally {
        await fastify.close();
      }
    });

    it('按 options.retry 重试，成功后记录重试次数', async () => {
      let calls = 0;
      const fastify = await createFastify({
        isTest: false,
        retry: { times: 2, delay: 1 },
        senders: {
          0: async () => {
            calls += 1;
            if (calls < 3) throw new Error(`fail ${calls}`);
          }
        }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'retry', type: 0, level: 0, subject: 's', content: 'c' });
        const record = await services.sendMessage({ code: 'retry', type: 0, name: 'a@b.com' });
        expect(calls).to.equal(3);
        expect(record.status).to.equal(0);
        expect(record.retryCount).to.equal(2);
      } finally {
        await fastify.close();
      }
    });

    it('失败记录可以通过接口重发，成功记录不能重发', async () => {
      let shouldFail = true;
      const fastify = await createFastify({
        isTest: false,
        senders: {
          0: async () => {
            if (shouldFail) throw new Error('smtp down');
          }
        }
      });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'resend', type: 0, level: 0, subject: 'Hi {{ name }}', content: 'c' });
        const result = await services.sendMessage({ code: 'resend', type: 0, name: 'a@b.com', props: { name: 'Tom' } });
        expect(result.status).to.equal(1);
        expect(result.error).to.equal('smtp down');
        const failed = await models.record.findOne({ where: { code: 'resend' } });
        expect(failed.status).to.equal(1);

        const tpl = await models.template.findOne({ where: { code: 'resend' } });
        const sendResponse = await fastify.inject({ method: 'POST', url: '/api/message/templates/send', payload: { templateId: tpl.id, name: 'a@b.com', props: { name: 'Tom' } } });
        expect(sendResponse.statusCode).to.equal(200);
        expect(sendResponse.json().success).to.equal(false);
        expect(sendResponse.json().recordId).to.be.ok;

        shouldFail = false;
        const response = await fastify.inject({ method: 'POST', url: `/api/message/records/${failed.id}/retry` });
        expect(response.statusCode).to.equal(200);
        expect(response.json().status).to.equal(0);
        expect(response.json().content.subject).to.equal('Hi Tom');

        const again = await fastify.inject({ method: 'POST', url: `/api/message/records/${failed.id}/retry` });
        expect(again.statusCode).to.equal(400);
        const missing = await fastify.inject({ method: 'POST', url: '/api/message/records/999999/retry' });
        expect(missing.statusCode).to.equal(404);
      } finally {
        await fastify.close();
      }
    });

    it('processPendingRecords 补发待发送记录', async () => {
      const fastify = await createFastify({ isTest: false, senders: { 1: async data => ({ sent: data.content.text }) } });
      try {
        const { models, services } = fastify.message;
        const tpl = await models.template.create({ code: 'pending', type: 1, level: 0, content: '码 {{ code }}' });
        await models.record.create({ type: 1, code: 'pending', templateId: tpl.id, name: '138', props: { code: '42' }, status: 2 });
        const result = await services.processPendingRecords();
        expect(result.total).to.equal(1);
        const record = await models.record.findOne({ where: { code: 'pending' } });
        expect(record.status).to.equal(0);
        expect(record.content.sent).to.equal('码 42');
      } finally {
        await fastify.close();
      }
    });
  });

  describe('管理接口', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('关键词搜索不区分大小写，% 和 _ 按字面匹配', async () => {
      const { models } = fastify.message;
      await models.template.bulkCreate([
        { code: 'Order_Ship', type: 0, level: 1, name: '发货' },
        { code: 'orderXship', type: 0, level: 1, name: '其它' },
        { code: 'rate', type: 0, level: 1, name: '100% 好评' },
        { code: 'rate2', type: 0, level: 1, name: '100 好评' }
      ]);
      const search = async keyword => {
        const response = await fastify.inject({ method: 'GET', url: `/api/message/templates?filter[keyword]=${encodeURIComponent(keyword)}` });
        return response.json().pageData.map(item => item.code).sort();
      };
      expect(await search('order_')).to.deep.equal(['Order_Ship']);
      expect(await search('100%')).to.deep.equal(['rate']);
    });

    it('发送记录按状态、模版和时间范围筛选', async () => {
      const { models } = fastify.message;
      const tpl = await models.template.create({ code: 'f', type: 0, level: 0, content: 'c' });
      await models.record.bulkCreate([
        { code: 'f', type: 0, name: 'a', templateId: tpl.id, status: 0, createdAt: new Date('2026-01-01T00:00:00Z') },
        { code: 'f', type: 0, name: 'b', templateId: tpl.id, status: 1, createdAt: new Date('2026-02-01T00:00:00Z') },
        { code: 'f', type: 0, name: 'c', status: 1, createdAt: new Date('2026-03-01T00:00:00Z') }
      ]);
      const query = async params => {
        const response = await fastify.inject({ method: 'GET', url: `/api/message/records?${params}` });
        return response.json().pageData.map(item => item.name).sort();
      };
      expect(await query('filter[status]=1')).to.deep.equal(['b', 'c']);
      expect(await query(`filter[templateId]=${tpl.id}`)).to.deep.equal(['a', 'b']);
      expect(await query('filter[startTime]=2026-01-15T00:00:00Z&filter[endTime]=2026-02-15T00:00:00Z')).to.deep.equal(['b']);
    });

    it('render 合并变量示例值，传入的 props 优先', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/message/templates/render',
        payload: {
          template: {
            type: 0,
            subject: '{{ a }}-{{ b }}',
            content: '<p>x</p>',
            variables: [{ name: 'a', example: 'A' }, { name: 'b', example: 'B' }]
          },
          props: { b: 'b' }
        }
      });
      expect(response.json().subject).to.equal('A-b');
    });

    it('删除业务模版后可以重建同编码模版', async () => {
      const payload = { name: 'n', code: 'dup', type: 0, content: '<p>1</p>' };
      const created = await fastify.inject({ method: 'POST', url: '/api/message/templates', payload });
      await fastify.inject({ method: 'DELETE', url: `/api/message/templates/${created.json().id}` });
      const recreated = await fastify.inject({ method: 'POST', url: '/api/message/templates', payload });
      expect(recreated.statusCode).to.equal(200);
      expect(recreated.json().code).to.equal('dup');
    });

    it('数据库唯一索引兜底 code + type + level 重复', async () => {
      const { models } = fastify.message;
      await models.template.create({ code: 'uniq', type: 0, level: 1 });
      try {
        await models.template.create({ code: 'uniq', type: 0, level: 1 });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.name).to.equal('SequelizeUniqueConstraintError');
      }
    });
  });

  describe('includeTemplate 停用缺失的系统模版', () => {
    it('模版目录中已删除的文件对应的系统模版被停用，业务模版不受影响', async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'message-tpl-'));
      await fs.writeFile(path.join(dir, 'keep_0_保留.liquid'), '<!-- subject -->保留<!-- html --><p>keep</p>');
      await fs.writeFile(path.join(dir, 'gone_0_删除.liquid'), '<!-- subject -->删除<!-- html --><p>gone</p>');
      const fastify = await createFastify({ templateDir: dir });
      try {
        const { models, services } = fastify.message;
        await models.template.create({ code: 'biz', type: 0, level: 1, content: 'c' });
        await fs.remove(path.join(dir, 'gone_0_删除.liquid'));
        await services.includeTemplate(dir);
        const status = async (code, level) => (await models.template.findOne({ where: { code, level } })).status;
        expect(await status('keep', 0)).to.equal(0);
        expect(await status('gone', 0)).to.equal(1);
        expect(await status('biz', 1)).to.equal(0);
      } finally {
        await fastify.close();
        await fs.remove(dir);
      }
    });
  });
});
