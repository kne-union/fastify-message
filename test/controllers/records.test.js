const { expect } = require('chai');
const { createFastify } = require('../helpers/app');

describe('@kne/fastify-message 发送记录接口', function () {
  this.timeout(10000);

  let fastify;

  beforeEach(async () => {
    fastify = await createFastify();
  });

  afterEach(async () => {
    await fastify.close();
  });

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

  it('should return 500 when record detail service throws unknown error', async () => {
    fastify.message.services.record.detail = async () => {
      throw new Error('unexpected record error');
    };

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/message/records/1'
    });

    expect(response.statusCode).to.equal(500);
    const body = JSON.parse(response.body);
    expect(body.message).to.equal('unexpected record error');
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
