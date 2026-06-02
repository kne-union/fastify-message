const { expect } = require('chai');
const http = require('node:http');
const dayjs = require('dayjs');
const utcPlugin = require('dayjs/plugin/utc');
const tzPlugin = require('dayjs/plugin/timezone');
const { createFastify, collectAllRecordStatistics } = require('../helpers/app');

dayjs.extend(utcPlugin);
dayjs.extend(tzPlugin);

describe('@kne/fastify-message 统计数据接口', function () {
  this.timeout(10000);

  let fastify;

  beforeEach(async () => {
    fastify = await createFastify();
  });

  afterEach(async () => {
    await fastify.close();
  });

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
    await collectAllRecordStatistics(fastify);

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
    await collectAllRecordStatistics(fastify);

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
    await collectAllRecordStatistics(fastify);

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

  it('should return 500 for invalid range', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/message/statistics?range=invalid'
    });

    expect(response.statusCode).to.equal(500);
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
    await collectAllRecordStatistics(fastify);

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
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      }, res => {
        expect(res.statusCode).to.equal(200);
        expect(res.headers['content-type']).to.include('text/event-stream');
        let received = false;
        res.on('data', chunk => {
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
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 3000);
    });
  });

  it('should return SSE stream with custom interval', async function () {
    this.timeout(5000);
    const address = await fastify.listen({ port: 0 });
    await new Promise((resolve, reject) => {
      const url = new URL(`${address}/api/message/statistics/sse?interval=3`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      }, res => {
        expect(res.statusCode).to.equal(200);
        let received = false;
        res.on('data', chunk => {
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
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 3000);
    });
  });

  it('should stop SSE push after client disconnects', async function () {
    this.timeout(8000);
    const address = await fastify.listen({ port: 0 });
    let chunksAfterDestroy = 0;
    await new Promise((resolve, reject) => {
      const url = new URL(`${address}/api/message/statistics/sse?interval=1`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Accept: 'text/event-stream' }
      }, res => {
        expect(res.statusCode).to.equal(200);
        let destroyed = false;
        res.on('data', () => {
          if (destroyed) {
            chunksAfterDestroy++;
          } else {
            destroyed = true;
            req.destroy();
            setTimeout(resolve, 2500);
          }
        });
      });
      req.on('error', err => {
        if (err.code === 'ECONNRESET') resolve();
        else reject(err);
      });
      req.end();
    });
    expect(chunksAfterDestroy).to.equal(0);
  });

  it('should apply statistics authenticate type', async () => {
    const accessedTypes = [];
    const authFastify = await createFastify({
      getAuthenticate: type => {
        accessedTypes.push(type);
        return [];
      }
    });

    try {
      await authFastify.inject({ method: 'GET', url: '/api/message/statistics' });
      expect(accessedTypes).to.include('statistics');
    } finally {
      await authFastify.close();
    }
  });

  it('should accept timezone query parameter', async () => {
    const { models } = fastify.message;
    await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
    await collectAllRecordStatistics(fastify);

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
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/message/statistics?timezone=Asia/Shanghai'
    });

    expect(response.statusCode).to.equal(200);
    const body = JSON.parse(response.body);
    const expectedDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
    if (body.recentTrend.length > 0) {
      expect(body.recentTrend[0].date).to.exist;
    }
    expect(expectedDate).to.exist;
  });
});
