const { expect } = require('chai');
const dayjs = require('dayjs');
const utcPlugin = require('dayjs/plugin/utc');
const tzPlugin = require('dayjs/plugin/timezone');
const {
  createFastify,
  collectRecordStatistics,
  collectAllRecordStatistics,
  getRealtimeStatistics
} = require('../helpers/app');

dayjs.extend(utcPlugin);
dayjs.extend(tzPlugin);

describe('@kne/fastify-message 统计服务', function () {
  this.timeout(10000);

  describe('statistics overview 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return empty overview when no records', async () => {
      const { services } = fastify.message;
      const result = await services.queryStatistics({});

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
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({});

      expect(result.range).to.equal('7d');
      expect(result.totalRecords).to.equal(3);
      expect(result.byType['0']).to.equal(2);
      expect(result.byType['1']).to.equal(1);
      expect(result.byCode['test']).to.equal(2);
      expect(result.byCode['verify']).to.equal(1);
    });

    it('should return overview with range 1m', async () => {
      const { services } = fastify.message;
      const result = await services.queryStatistics({ range: '1m' });

      expect(result.range).to.equal('1m');
      expect(result.rangeLabel).to.equal('近1个月');
    });

    it('should return overview with range 1y', async () => {
      const { services } = fastify.message;
      const result = await services.queryStatistics({ range: '1y' });

      expect(result.range).to.equal('1y');
      expect(result.rangeLabel).to.equal('近1年');
    });

    it('should throw error for invalid range', async () => {
      const { services } = fastify.message;
      try {
        await services.queryStatistics({ range: 'invalid' });
        throw new Error('Should have thrown');
      } catch (error) {
        expect(error.message).to.include('不支持的时间范围');
      }
    });

    it('should include templateStats', async () => {
      const { models, services } = fastify.message;

      await models.template.create({ code: 't1', type: 0, name: '邮件', content: '', status: 0 });
      await models.template.create({ code: 't2', type: 1, name: '短信', content: '', status: 1 });
      await models.record.create({ code: 't1', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({});

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
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({});

      expect(result.recentTrend).to.be.an('array');
      expect(result.recentTrend.length).to.be.greaterThan(0);
      expect(result.recentTrend[0].date).to.exist;
      expect(result.recentTrend[0].count).to.exist;
    });

    it('should include recentTrendByType with daily data by type', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 1, name: '138', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({});

      expect(result.recentTrendByType).to.be.an('array');
      if (result.recentTrendByType.length > 0) {
        expect(result.recentTrendByType[0].date).to.exist;
        expect(result.recentTrendByType[0].type).to.exist;
        expect(result.recentTrendByType[0].count).to.exist;
      }
    });

    it('should filter overview by code and type', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'welcome', type: 1, name: '138', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '139', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({ code: 'welcome', type: 1 });

      expect(result.totalRecords).to.equal(0);
      expect(result.byCode.welcome).to.be.undefined;
      expect(result.byType['1']).to.equal(1);
      expect(result.byType['0']).to.be.undefined;
    });

    it('should return empty overview when code filter has no channel', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await services.queryStatistics({ code: 'missing' });

      expect(result.totalRecords).to.equal(0);
      expect(result.byType).to.deep.equal({});
      expect(result.byCode).to.deep.equal({});
    });

    it('should return empty overview when statistics query fails', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);
      fastify.messageStatistics.services.query = async () => {
        throw new Error('query failed');
      };

      const result = await services.queryStatistics({});

      expect(result.totalRecords).to.equal(0);
      expect(result.recentTrend).to.deep.equal([]);
      expect(result.templateStats.total).to.equal(0);
    });
  });

  describe('statistics realtime 服务测试', () => {
    let fastify;

    beforeEach(async () => {
      fastify = await createFastify();
    });

    afterEach(async () => {
      await fastify.close();
    });

    it('should return empty realtime when no records today', async () => {
      const result = await getRealtimeStatistics(fastify);
      const todayStr = dayjs().format('YYYY-MM-DD');

      expect(result.date).to.equal(todayStr);
      expect(result.totalRecords).to.equal(0);
      expect(result.byType).to.deep.equal({});
      expect(result.byCode).to.deep.equal({});
      expect(result.hourlyTrend).to.deep.equal([]);
      expect(result.hourlyTrendByType).to.deep.equal([]);
      expect(result.intervalTrend).to.deep.equal([]);
    });

    it('should return realtime data for today', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'welcome', type: 0, name: 'u2@e.com', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '138', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify);

      expect(result.date).to.equal(dayjs().format('YYYY-MM-DD'));
      expect(result.totalRecords).to.equal(3);
      expect(result.byType['0']).to.equal(2);
      expect(result.byType['1']).to.equal(1);
      expect(result.byCode['welcome']).to.equal(2);
      expect(result.byCode['verify']).to.equal(1);
    });

    it('should include hourlyTrend', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify);

      expect(result.hourlyTrend).to.be.an('array');
      expect(result.hourlyTrend.length).to.be.greaterThan(0);
      expect(result.hourlyTrend[0].hour).to.exist;
      expect(result.hourlyTrend[0].count).to.exist;
    });

    it('should include hourlyTrendByType', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'test', type: 1, name: '138', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify);

      expect(result.hourlyTrendByType).to.be.an('array');
      if (result.hourlyTrendByType.length > 0) {
        expect(result.hourlyTrendByType[0].hour).to.exist;
        expect(result.hourlyTrendByType[0].type).to.exist;
        expect(result.hourlyTrendByType[0].count).to.exist;
      }
    });

    it('should only count today records not old records', async () => {
      const { models } = fastify.message;
      const oldRecord = await models.record.create({ code: 'old', type: 0, name: 'old@e.com', props: {}, content: {} });
      const yesterday = dayjs().subtract(1, 'day').toDate();

      await models.record.update({ createdAt: yesterday }, { where: { code: 'old' } });
      await collectRecordStatistics(fastify, { ...oldRecord.get({ plain: true }), createdAt: yesterday });

      const todayRecord = await models.record.create({ code: 'today', type: 0, name: 'today@e.com', props: {}, content: {} });
      await collectRecordStatistics(fastify, todayRecord);

      const result = await getRealtimeStatistics(fastify);

      expect(result.totalRecords).to.equal(1);
      expect(result.byCode['today']).to.equal(1);
      expect(result.byCode['old']).to.be.undefined;
      expect(result.intervalTrend.length).to.equal(1);
    });

    it('should include intervalTrend grouped by 15-minute intervals', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'verify', type: 1, name: '138', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify);

      expect(result.intervalTrend).to.be.an('array');
      expect(result.intervalTrend.length).to.be.greaterThan(0);
      expect(result.intervalTrend[0].interval).to.match(/^\d{2}:\d{2}$/);
      expect(result.intervalTrend[0].count).to.be.a('number');
    });

    it('should group records in same 15-minute interval', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'a', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await models.record.create({ code: 'a', type: 0, name: 'u2@e.com', props: {}, content: {} });
      await models.record.create({ code: 'b', type: 1, name: '138', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify);

      expect(result.intervalTrend.length).to.equal(1);
      expect(result.intervalTrend[0].count).to.equal(3);
    });

    it('should accept timezone parameter in getRealtime', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const localResult = await getRealtimeStatistics(fastify);
      const tzResult = await getRealtimeStatistics(fastify, { timezone: 'Asia/Shanghai' });

      expect(localResult.date).to.exist;
      expect(tzResult.date).to.exist;
      expect(tzResult.totalRecords).to.equal(1);
    });

    it('should use server timezone as default when timezone is not provided', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const serverTimezone = dayjs.tz.guess();
      const localResult = await getRealtimeStatistics(fastify);
      const tzResult = await getRealtimeStatistics(fastify, { timezone: serverTimezone });

      expect(localResult.date).to.equal(tzResult.date);
      expect(localResult.hourlyTrend).to.deep.equal(tzResult.hourlyTrend);
      expect(localResult.intervalTrend).to.deep.equal(tzResult.intervalTrend);
    });

    it('should accept timezone parameter in getOverview', async () => {
      const { models, services } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const localResult = await services.queryStatistics({ range: '7d' });
      const tzResult = await services.queryStatistics({ range: '7d', timezone: 'Asia/Shanghai' });

      expect(localResult.totalRecords).to.equal(1);
      expect(tzResult.totalRecords).to.equal(1);
      expect(tzResult.range).to.equal('7d');
    });

    it('should return correct date for Asia/Shanghai timezone', async () => {
      const result = await getRealtimeStatistics(fastify, { timezone: 'Asia/Shanghai' });
      const expectedDate = dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
      expect(result.date).to.equal(expectedDate);
    });

    it('should return correct date for America/New_York timezone', async () => {
      const result = await getRealtimeStatistics(fastify, { timezone: 'America/New_York' });
      const expectedDate = dayjs().tz('America/New_York').format('YYYY-MM-DD');
      expect(result.date).to.equal(expectedDate);
    });

    it('should return correct hourlyTrend hour for timezone', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify, { timezone: 'Asia/Shanghai' });

      if (result.hourlyTrend.length > 0) {
        const expectedHour = dayjs().tz('Asia/Shanghai').hour();
        const currentHourEntry = result.hourlyTrend.find(item => item.hour === expectedHour);
        expect(currentHourEntry).to.exist;
      }
    });

    it('should return correct intervalTrend format for timezone', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'test', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);

      const result = await getRealtimeStatistics(fastify, { timezone: 'Asia/Shanghai' });

      if (result.intervalTrend.length > 0) {
        expect(result.intervalTrend[0].interval).to.match(/^\d{2}:\d{2}$/);
      }
    });

    it('should return empty realtime data when statistics query fails', async () => {
      const { models } = fastify.message;

      await models.record.create({ code: 'welcome', type: 0, name: 'u1@e.com', props: {}, content: {} });
      await collectAllRecordStatistics(fastify);
      fastify.messageStatistics.services.query = async () => {
        throw new Error('query failed');
      };

      const result = await getRealtimeStatistics(fastify);

      expect(result.totalRecords).to.equal(0);
      expect(result.byType).to.deep.equal({});
      expect(result.byCode).to.deep.equal({});
    });

    it('should return empty payload when SSE fetchData throws', async () => {
      let payload;
      fastify.messageStatistics.services.sseStream.send = async (reply, options) => {
        payload = await options.fetchData({ timezone: 'Invalid/Timezone' });
      };

      await fastify.message.services.sseStatistics({ timezone: 'Invalid/Timezone' }, {});

      expect(payload).to.deep.equal({});
    });
  });
});
