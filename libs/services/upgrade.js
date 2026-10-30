const fp = require('fastify-plugin');

const UNIQUE_FIELDS = ['code', 'type', 'level'];

// 1.x 的 lodash 模版插值：<%= x %>（原样）/ <%- x %>（转义）都迁移为 Liquid 的 {{ x }}（转义输出）
const EJS_INTERPOLATE = /<%[=-]\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*%>/g;
const LEGACY_SECTION = /<!--\s*(subject|html|text)\s*-->/;

const convertEjs = value => (typeof value === 'string' ? value.replace(EJS_INTERPOLATE, '{{ $1 }}') : value);

const hasEjs = value => typeof value === 'string' && value.includes('<%');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const sequelize = models.template.sequelize;
  const queryInterface = sequelize.getQueryInterface();

  const describeTable = async table => {
    try {
      return await queryInterface.describeTable(table);
    } catch (e) {
      return null;
    }
  };

  // 只补缺失的列（可空 / 带默认值），不改已有列，PostgreSQL / MySQL / SQLite 通用
  const addMissingColumns = async model => {
    const table = model.getTableName();
    const columns = await describeTable(table);
    if (!columns) return [];
    const added = [];
    for (const [name, attribute] of Object.entries(model.getAttributes())) {
      const field = attribute.field || name;
      if (attribute.primaryKey || columns[field] || attribute.type?.key === 'VIRTUAL') continue;
      await queryInterface.addColumn(
        table,
        field,
        Object.assign({ type: attribute.type, allowNull: true }, attribute.defaultValue !== undefined ? { defaultValue: attribute.defaultValue } : {}, attribute.comment ? { comment: attribute.comment } : {})
      );
      added.push(field);
    }
    return added;
  };

  // 软删除的模版先改写编码再建唯一索引，避免历史删除数据与现有模版冲突
  const releaseDeletedCodes = async () => {
    const { Op } = sequelize.Sequelize;
    const deleted = await models.template.findAll({ paranoid: false, where: { deletedAt: { [Op.ne]: null } } });
    for (const tpl of deleted) {
      if (String(tpl.code).includes('#deleted#')) continue;
      await models.template.update({ code: `${String(tpl.code).slice(0, 200)}#deleted#${tpl.id}` }, { where: { id: tpl.id }, paranoid: false, silent: true });
    }
  };

  const ensureUniqueIndex = async () => {
    const table = models.template.getTableName();
    if (!(await describeTable(table))) return 'skipped';
    const indexes = await queryInterface.showIndex(table);
    const sameFields = index => {
      const fields = (index.fields || []).map(item => item.attribute || item.name);
      return fields.length === UNIQUE_FIELDS.length && UNIQUE_FIELDS.every(field => fields.includes(field));
    };
    const current = indexes.filter(sameFields);
    if (current.some(index => index.unique)) return 'exists';

    await releaseDeletedCodes();
    const duplicates = await models.template.findAll({
      attributes: UNIQUE_FIELDS,
      group: UNIQUE_FIELDS,
      having: sequelize.where(sequelize.fn('COUNT', sequelize.col('id')), '>', 1),
      raw: true
    });
    if (duplicates.length > 0) {
      fastify.log.warn(`[fastify-message] 模版存在重复的 code + type + level，未创建唯一索引: ${duplicates.map(item => `${item.code}:${item.type}:${item.level}`).join(', ')}`);
      return 'duplicated';
    }
    // 先建唯一索引再删旧索引，建索引失败时保留原索引
    try {
      await queryInterface.addIndex(table, UNIQUE_FIELDS, { unique: true, name: `${table}_code_type_level_unique` });
    } catch (e) {
      fastify.log.warn(`[fastify-message] 创建模版唯一索引失败，保留原索引: ${e.message}`);
      return 'failed';
    }
    for (const index of current) {
      await queryInterface.removeIndex(table, index.name);
    }
    return 'created';
  };

  const ensureStatusIndex = async () => {
    const table = models.record.getTableName();
    if (!(await describeTable(table))) return 'skipped';
    const indexes = await queryInterface.showIndex(table);
    if (indexes.some(index => (index.fields || []).map(item => item.attribute || item.name).join() === 'status')) return 'exists';
    await queryInterface.addIndex(table, ['status'], { name: `${table}_status` });
    return 'created';
  };

  // 补字段、建索引；新库和 1.x 老库都要执行（2.x 新增列上的索引不在模型里声明，避免 sync 在老库上失败）。表不存在时跳过
  const upgradeSchema = async () => {
    const result = {
      template: await addMissingColumns(models.template),
      record: await addMissingColumns(models.record),
      uniqueIndex: await ensureUniqueIndex(),
      statusIndex: await ensureStatusIndex()
    };
    if (result.template.length || result.record.length || result.uniqueIndex === 'created' || result.statusIndex === 'created') {
      fastify.log.info(`[fastify-message] 表结构已升级: ${JSON.stringify(result)}`);
    }
    return result;
  };

  // 1.x 模版内容迁移：合并分段拆成 subject / content / extra，<%= x %> 改为 {{ x }}；含 EJS 逻辑语法的跳过，需人工处理
  const migrateTemplates = async () => {
    const migrated = [];
    const skipped = [];
    const list = await models.template.findAll();
    for (const tpl of list) {
      const content = tpl.content || '';
      const extra = tpl.extra || {};
      const legacySections = LEGACY_SECTION.test(content);
      if (!legacySections && ![tpl.subject, content, ...Object.values(extra)].some(hasEjs)) continue;

      const fields = legacySections ? services.parseTemplateFile(content, Number(tpl.type) || 0) : { subject: tpl.subject, content, extra };
      const next = {
        subject: convertEjs(tpl.subject || fields.subject || ''),
        content: convertEjs(fields.content),
        extra: Object.fromEntries(Object.entries(Object.assign({}, extra, fields.extra)).map(([key, value]) => [key, convertEjs(value)]))
      };
      const item = { id: tpl.id, code: tpl.code, type: tpl.type, level: tpl.level };
      if ([next.subject, next.content, ...Object.values(next.extra)].some(hasEjs)) {
        skipped.push(Object.assign(item, { reason: '含 EJS 逻辑语法（<% %>），需人工改写为 Liquid' }));
        continue;
      }
      try {
        services.validateTemplate(next);
      } catch (e) {
        skipped.push(Object.assign(item, { reason: e.message }));
        continue;
      }
      if (legacySections && !tpl.description && fields.description) next.description = fields.description;
      if (legacySections && !(tpl.variables || []).length && fields.variables.length) next.variables = fields.variables;
      Object.assign(tpl, next);
      await tpl.save();
      migrated.push(item);
    }
    if (migrated.length) {
      fastify.log.info(`[fastify-message] 已迁移 1.x 模版: ${migrated.map(item => item.code).join(', ')}`);
    }
    if (skipped.length) {
      fastify.log.warn(`[fastify-message] 以下模版需人工迁移: ${skipped.map(item => `${item.code}(${item.reason})`).join('; ')}`);
    }
    return { migrated, skipped };
  };

  Object.assign(services, { upgradeSchema, migrateTemplates });
});
