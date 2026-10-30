const { expect } = require('chai');
const { DataTypes } = require('sequelize');
const { createFastify } = require('../helpers/app');

const TEMPLATE_TABLE = 't_message_template';
const RECORD_TABLE = 't_message_record';

// 按 1.x 的表结构重建模版表和记录表
const createLegacyTables = async fastify => {
  const queryInterface = fastify.sequelize.instance.getQueryInterface();
  const base = {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
    deleted_at: { type: DataTypes.DATE }
  };
  await queryInterface.dropTable(RECORD_TABLE);
  await queryInterface.dropTable(TEMPLATE_TABLE);
  await queryInterface.createTable(TEMPLATE_TABLE, Object.assign({
    name: DataTypes.STRING,
    code: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.INTEGER, allowNull: false },
    content: DataTypes.TEXT,
    level: { type: DataTypes.INTEGER, defaultValue: 1 },
    status: { type: DataTypes.INTEGER, defaultValue: 0 },
    user_id: DataTypes.INTEGER
  }, base));
  await queryInterface.addIndex(TEMPLATE_TABLE, ['code', 'type', 'level']);
  await queryInterface.createTable(RECORD_TABLE, Object.assign({
    name: DataTypes.STRING,
    type: { type: DataTypes.INTEGER, defaultValue: 0 },
    code: DataTypes.STRING,
    props: DataTypes.JSON,
    content: DataTypes.JSON,
    template_id: DataTypes.INTEGER,
    user_id: DataTypes.INTEGER
  }, base));
  return queryInterface;
};

const insertTemplate = (queryInterface, row) => {
  const now = new Date();
  return queryInterface.bulkInsert(TEMPLATE_TABLE, [Object.assign({ level: 1, status: 0, created_at: now, updated_at: now }, row)]);
};

describe('@kne/fastify-message 1.x 升级', function () {
  this.timeout(10000);
  let fastify;

  beforeEach(async () => {
    fastify = await createFastify();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('1.x 老表上执行 sequelize.sync 不报错（新列的索引由 upgradeSchema 补建）', async () => {
    const queryInterface = await createLegacyTables(fastify);
    await insertTemplate(queryInterface, { code: 'a', type: 0, level: 1, content: 'old', deleted_at: new Date() });
    await insertTemplate(queryInterface, { code: 'a', type: 0, level: 1, content: 'new' });
    await fastify.sequelize.instance.sync();

    const result = await fastify.message.services.upgradeSchema();
    expect(result.statusIndex).to.equal('created');
    expect(result.uniqueIndex).to.equal('created');
    const recordIndexes = await queryInterface.showIndex(RECORD_TABLE);
    expect(recordIndexes.some(index => index.fields.map(item => item.attribute).join() === 'status')).to.equal(true);
    expect((await fastify.message.services.upgradeSchema()).statusIndex).to.equal('exists');
  });

  it('upgradeSchema 补齐新字段并把 code + type + level 索引改为唯一，已删除模版释放编码', async () => {
    const queryInterface = await createLegacyTables(fastify);
    await insertTemplate(queryInterface, { code: 'a', type: 0, level: 1, content: 'old', deleted_at: new Date() });
    await insertTemplate(queryInterface, { code: 'a', type: 0, level: 1, content: 'new' });
    await queryInterface.bulkInsert(RECORD_TABLE, [{ name: 'x', type: 0, code: 'a', created_at: new Date(), updated_at: new Date() }]);

    const { services, models } = fastify.message;
    const result = await services.upgradeSchema();
    expect(result.template).to.include.members(['subject', 'description', 'variables', 'extra']);
    expect(result.record).to.include.members(['options', 'status', 'error', 'retry_count']);
    expect(result.uniqueIndex).to.equal('created');

    const indexes = await queryInterface.showIndex(TEMPLATE_TABLE);
    const unique = indexes.find(index => index.unique && index.fields.map(item => item.attribute).join() === 'code,type,level');
    expect(unique).to.exist;

    const deleted = await models.template.findOne({ paranoid: false, where: { content: 'old' } });
    expect(deleted.code).to.match(/^a#deleted#\d+$/);
    const record = await models.record.findOne({ where: { code: 'a' } });
    expect(record.status).to.equal(0);
    expect(record.retryCount).to.equal(0);

    expect((await services.upgradeSchema()).uniqueIndex).to.equal('exists');
  });

  it('存在重复编码时保留原索引并跳过唯一索引', async () => {
    const queryInterface = await createLegacyTables(fastify);
    await insertTemplate(queryInterface, { code: 'dup', type: 0, level: 1 });
    await insertTemplate(queryInterface, { code: 'dup', type: 0, level: 1 });
    const result = await fastify.message.services.upgradeSchema();
    expect(result.uniqueIndex).to.equal('duplicated');
  });

  it('migrateTemplates 拆分 1.x 合并内容并把 <%= x %> 改为 {{ x }}，含 EJS 逻辑的模版跳过', async () => {
    const queryInterface = await createLegacyTables(fastify);
    await fastify.message.services.upgradeSchema();
    await insertTemplate(queryInterface, { code: 'mail', type: 0, content: '<!-- subject -->你好 <%= name %><!-- html --><p><%- user.name %></p><!-- text -->纯文本 <%= name %>' });
    await insertTemplate(queryInterface, { code: 'sms', type: 1, content: '验证码 <%= code %>' });
    await insertTemplate(queryInterface, { code: 'logic', type: 0, content: '<% if (a) { %>x<% } %>' });
    await insertTemplate(queryInterface, { code: 'liquid', type: 0, subject: 's', content: '<p>{{ a }}</p>' });

    const { services, models } = fastify.message;
    const result = await services.migrateTemplates();
    expect(result.migrated.map(item => item.code).sort()).to.deep.equal(['mail', 'sms']);
    expect(result.skipped.map(item => item.code)).to.deep.equal(['logic']);

    const mail = await models.template.findOne({ where: { code: 'mail' } });
    expect(mail.subject).to.equal('你好 {{ name }}');
    expect(mail.content).to.equal('<p>{{ user.name }}</p>');
    expect(mail.extra).to.deep.equal({ text: '纯文本 {{ name }}' });
    const sms = await models.template.findOne({ where: { code: 'sms' } });
    expect(sms.content).to.equal('验证码 {{ code }}');

    const rendered = await services.messageTemplate({ code: 'mail', type: 0, props: { name: 'Tom', user: { name: '<b>' } } });
    expect(rendered.content.html).to.equal('<p>&lt;b&gt;</p>');
    expect((await services.migrateTemplates()).migrated).to.deep.equal([]);
  });
});
