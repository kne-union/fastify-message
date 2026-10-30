const fp = require('fastify-plugin');
const fs = require('fs-extra');
const path = require('node:path');
const merge = require('lodash/merge');
const mapValues = require('lodash/mapValues');
const set = require('lodash/set');
const pick = require('lodash/pick');
const nodemailer = require('nodemailer');
const { renderTemplate, validateTemplateHtml, htmlToText } = require('@kne/message-template');

const TEMPLATE_EXTNAMES = ['.liquid', '.html', '.txt'];

// 发送记录状态
const RECORD_STATUS = { success: 0, failed: 1, pending: 2 };

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// LIKE 通配符转义，配合 ESCAPE '!' 使用；sqlite 没有默认转义符，所以不用反斜杠
const escapeLike = value => String(value).replace(/[!%_]/g, char => `!${char}`);

// 邮件显示名去掉换行防止头注入，引号和反斜杠转义
const formatAddress = (name, address) =>
  `"${String(name)
    .replace(/[\r\n]/g, ' ')
    .replace(/["\\]/g, '\\$&')}" <${address}>`;

// 附件内容（Buffer / 流）不入库，只保留描述信息
const stripAttachments = data => {
  if (!data || !Array.isArray(data.attachments)) {
    return data;
  }
  return Object.assign({}, data, {
    attachments: data.attachments.map(item => pick(item, ['filename', 'contentType', 'cid', 'path', 'href']))
  });
};

module.exports = fp(async (fastify, options) => {
  const emailConfig = Object.assign(
    {},
    {
      port: 465,
      secure: true
    },
    options.emailConfig
  );
  const retryConfig = Object.assign({ times: 0, delay: 1000 }, options.retry);
  const isTest = options.isTest;
  const { models, services } = fastify[options.name];
  const { Op } = models.template.sequelize.Sequelize;

  // 大小写不敏感的模糊匹配，LOWER + LIKE + ESCAPE 在 PostgreSQL / MySQL / SQLite 中写法一致
  const likeCondition = (model, attribute, pattern) => {
    const sequelize = model.sequelize;
    const column = sequelize.getQueryInterface().quoteIdentifier(model.getAttributes()[attribute].field || attribute);
    return sequelize.literal(`LOWER(${column}) LIKE ${sequelize.escape(pattern.toLowerCase())} ESCAPE '!'`);
  };

  // 采集消息统计数据
  const collectMessageStatistics = async ({ code, type, total = 0, success = 0, failed = 0 }) => {
    try {
      const statisticsServices = fastify[`${options.name}Statistics`]?.services;
      if (!statisticsServices) return;

      const data = Object.assign({}, total > 0 ? { total } : {}, success > 0 ? { success } : {}, failed > 0 ? { failed } : {});
      const unit = { total: 'count', success: 'count', failed: 'count' };
      const time = new Date();

      await statisticsServices.collect({
        channel: `${code}:${type}`,
        data,
        unit,
        time
      });
    } catch (e) {
      fastify.log.error(`采集消息统计数据失败: ${e.message}`);
    }
  };

  const parseTemplate = text => {
    const regex = /<!--\s*([^\n]+?)\s*-->\s*([\s\S]*?)(?=\s*<!--|$)/g;
    let match;
    const result = {};

    while ((match = regex.exec(text)) !== null) {
      const fieldName = match[1].trim();
      result[fieldName] = match[2].trim();
    }

    return result;
  };

  const parseVariables = value => {
    if (!value) return [];
    try {
      const list = JSON.parse(value);
      return Array.isArray(list) ? list.filter(item => item && item.name) : [];
    } catch (e) {
      throw new Error(`variables 不是合法的 JSON 数组: ${e.message}`);
    }
  };

  // 模版文件 → 模版字段：邮件正文取 html 分段，短信正文取 text 分段，没有分段标记时整个文件作为正文
  const parseTemplateFile = (text, type = 0) => {
    const sections = parseTemplate(text);
    if (Object.keys(sections).length === 0) {
      return { subject: '', description: null, variables: [], content: String(text || '').trim(), extra: {} };
    }
    const bodyKey = type === 0 ? 'html' : 'text';
    const extra = Object.keys(sections)
      .filter(key => key !== bodyKey && !['subject', 'description', 'variables'].includes(key))
      .reduce((result, key) => Object.assign(result, { [key]: sections[key] }), {});
    return {
      subject: sections.subject || '',
      description: sections.description || null,
      variables: parseVariables(sections.variables),
      content: sections[bodyKey] || '',
      extra
    };
  };

  // 保存 / 导入前校验 Liquid 语法白名单
  const validateTemplate = ({ subject, content, extra }) => {
    const fields = Object.assign({ subject, content }, extra);
    Object.keys(fields).forEach(field => {
      const value = fields[field];
      if (typeof value !== 'string' || !value) return;
      const { ok, error } = validateTemplateHtml(value);
      if (!ok) {
        throw new Error(`模版语法错误(${field}): ${error}`);
      }
    });
  };

  const getExampleProps = variables =>
    (variables || []).reduce((result, item) => {
      if (item && item.name && item.example !== undefined && item.example !== null && item.example !== '') {
        set(result, item.name, item.example);
      }
      return result;
    }, {});

  // 发送与预览共用：邮件 subject 文本渲染、html 转义渲染；短信 / extra 各段文本渲染
  const renderMessage = ({ template, props = {} }) => {
    const type = Number(template.type) || 0;
    const renderText = value => (typeof value === 'string' ? renderTemplate(value, props, { type: 'text' }) : value);
    const extra = mapValues(template.extra || {}, renderText);
    if (type === 0) {
      const html = renderTemplate(template.content || '', props);
      return Object.assign({}, extra, {
        subject: renderText(template.subject || ''),
        html,
        text: extra.text || (html ? htmlToText(html) : '')
      });
    }
    return Object.assign({}, extra, { text: renderText(template.content || '') });
  };

  // 导入模版目录；disableMissing 时把目录中已不存在的系统模版停用（不删除，保留历史记录关联）
  const includeTemplate = async (dir, { disableMissing = true } = {}) => {
    if (!dir || !(await fs.exists(dir))) {
      fastify.log.info('template dir not exists');
      return;
    }
    fastify.log.info('------start include template------');
    const list = await fs.readdir(dir);
    const seen = new Set();
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const extname = path.extname(file);
      if (!TEMPLATE_EXTNAMES.includes(extname.toLowerCase())) {
        fastify.log.warn(`skip template file: ${file}, only ${TEMPLATE_EXTNAMES.join(' / ')} are supported`);
        continue;
      }
      const filename = path.basename(file, extname);
      const tempArray = filename.split('_');
      const code = tempArray[0],
        type = Number(tempArray[1]) || 0,
        name = tempArray.slice(2).join('_') || code;
      seen.add(`${code}:${type}`);
      let fields;
      try {
        fields = parseTemplateFile(await fs.readFile(filePath, 'utf8'), type);
        validateTemplate(fields);
      } catch (e) {
        fastify.log.error(`skip template file: ${file}, ${e.message}`);
        continue;
      }
      const codeTemplate = await models.template.findOne({
        where: {
          code,
          type,
          level: 0
        }
      });

      if (codeTemplate) {
        Object.assign(codeTemplate, fields, { name });
        await codeTemplate.save();
        fastify.log.info(`update template: ${code}`);
        continue;
      }
      await models.template.create(Object.assign({ code, type, name, level: 0 }, fields));
      fastify.log.info(`create template: ${code}`);
    }
    if (disableMissing) {
      const systemTemplates = await models.template.findAll({ where: { level: 0, status: 0 } });
      for (const tpl of systemTemplates) {
        if (seen.has(`${tpl.code}:${tpl.type}`)) continue;
        tpl.status = 1;
        await tpl.save();
        fastify.log.warn(`disable template: ${tpl.code}, template file not found`);
      }
    }
    fastify.log.info('------end include template------');
  };

  // 指定 level 时只取该级别；未指定时优先取启用的业务模版（level 1），没有再回退到系统模版
  const findSendableTemplate = async ({ code, type, level }) => {
    const hasLevel = level !== undefined && level !== null;
    const list = await models.template.findAll({
      where: Object.assign({ code, type }, hasLevel ? { level } : {}),
      order: [['level', 'DESC']]
    });
    if (list.length === 0) {
      throw createHttpError(404, 'template not found');
    }
    const target = list.find(item => Number(item.status) === 0);
    if (!target) {
      throw createHttpError(400, '模版已禁用，无法发送消息');
    }
    return target;
  };

  const messageTemplate = async ({ code, type = 0, level, props }) => {
    const codeTemplate = await findSendableTemplate({ code, type, level });
    const content = renderMessage({ template: codeTemplate, props });

    return {
      content,
      props,
      code,
      type,
      level: codeTemplate.level,
      templateId: codeTemplate.id
    };
  };

  // SMTP 连接按配置复用（连接池），插件关闭时统一释放
  const transporters = new Map();
  const getTransporter = config => {
    const key = JSON.stringify(config);
    if (!transporters.has(key)) {
      transporters.set(key, nodemailer.createTransport(Object.assign({ pool: true }, config)));
    }
    return transporters.get(key);
  };
  fastify.addHook('onClose', async () => {
    transporters.forEach(transporter => transporter.close());
    transporters.clear();
  });

  const deliver = async ({ type, name, content, props, code, templateId, level, client, targetOptions }) => {
    const currentSender = options.senders?.[type];
    if (type === 0) {
      const mailOptions = {
        ...targetOptions,
        from: formatAddress(targetOptions.title || emailConfig.user, emailConfig.user),
        to: name,
        subject: content.subject || options.subject || emailConfig.defaultSubject || 'Message reminder',
        text: content.text,
        html: content.html,
        attachments: targetOptions.attachments || options.attachments || []
      };

      if (!isTest) {
        if (typeof currentSender === 'function') {
          await currentSender(mailOptions);
        } else {
          const transporter = getTransporter(
            merge(
              {},
              {
                host: emailConfig.host,
                port: emailConfig.port,
                secure: emailConfig.secure,
                auth: {
                  user: emailConfig.user,
                  pass: emailConfig.pass
                }
              },
              client
            )
          );
          await transporter.sendMail(mailOptions);
        }
      }
      return mailOptions;
    }
    if (typeof currentSender === 'function') {
      if (!isTest) {
        return await currentSender({ code, templateId, content, props, name, type, level, options: targetOptions });
      }
      return { content, props, level, options: targetOptions };
    }
    throw new Error(`未配置类型 ${type} 的消息发送器`);
  };

  // 按 options.retry 重试，返回发送结果；失败时 error.retryCount 为已重试次数
  const deliverWithRetry = async payload => {
    let retryCount = 0;
    while (true) {
      try {
        return { sendOptions: await deliver(payload), retryCount };
      } catch (error) {
        if (retryCount >= retryConfig.times) {
          error.retryCount = retryCount;
          throw error;
        }
        retryCount += 1;
        await sleep(retryConfig.delay);
      }
    }
  };

  const processRecord = async ({ record, content, level, client, targetOptions }) => {
    const { type, code, name, props, templateId } = record;
    try {
      const { sendOptions, retryCount } = await deliverWithRetry({
        type,
        name,
        content,
        props,
        code,
        templateId,
        level,
        client,
        targetOptions
      });
      await record.update({ status: RECORD_STATUS.success, content: stripAttachments(sendOptions), error: null, retryCount: record.retryCount + retryCount });
      await collectMessageStatistics({ code, type, success: 1 });
      return record;
    } catch (error) {
      fastify.log.error(`消息发送失败(record ${record.id}, ${code}:${type}): ${error.message}`);
      await record.update({ status: RECORD_STATUS.failed, error: error.message, retryCount: record.retryCount + (error.retryCount || 0) });
      await collectMessageStatistics({ code, type, failed: 1 });
      return record;
    }
  };

  // 发送失败在模块内处理（记日志、写失败记录、计入统计），不向业务抛错：返回发送记录，status 为 0 成功 / 1 失败 / 2 待发送
  // async 为 true 时先写入待发送记录并立即返回，后台发送；失败的记录可通过 record.retry 重发
  const sendMessage = async ({ type = 0, name, props = {}, code, level, client, options: targetOptions, userId, async: isAsync = false }) => {
    targetOptions = Object.assign({}, targetOptions);
    const recordFields = Object.assign({ type, code, props, name, retryCount: 0, options: stripAttachments(targetOptions) }, userId ? { userId } : {});
    try {
      let rendered;
      try {
        rendered = await messageTemplate({ code, type, level, props });
      } catch (error) {
        // 模版不存在 / 已停用 / 渲染失败：同样记为失败记录，方便在后台排查
        fastify.log.error(`消息发送失败(${code}:${type}): ${error.message}`);
        await collectMessageStatistics({ code, type, total: 1, failed: 1 });
        return await models.record.create(Object.assign({}, recordFields, { status: RECORD_STATUS.failed, error: error.message }));
      }
      const { content, templateId, level: templateLevel } = rendered;
      await collectMessageStatistics({ code, type, total: 1 });
      const record = await models.record.create(Object.assign({}, recordFields, { templateId, status: RECORD_STATUS.pending }));
      const task = processRecord({ record, content, level: templateLevel, client, targetOptions });
      if (isAsync) {
        task.catch(error => fastify.log.error(`消息发送失败(record ${record.id}): ${error.message}`));
        return record;
      }
      return await task;
    } catch (error) {
      fastify.log.error(`消息发送失败(${code}:${type})，发送记录写入异常: ${error.message}`);
      return null;
    }
  };

  const getRecord = async id => {
    const record = await models.record.findByPk(id);
    if (!record) {
      throw createHttpError(404, '记录不存在');
    }
    return record;
  };

  // 失败 / 待发送记录重发：按模版当前内容和记录中的 props 重新渲染
  const retryRecord = async ({ id }) => {
    const record = await getRecord(id);
    if (Number(record.status) === RECORD_STATUS.success) {
      throw createHttpError(400, '仅失败或待发送的记录可以重发');
    }
    const tpl = await models.template.findByPk(record.templateId);
    if (!tpl) {
      throw createHttpError(404, '模版不存在');
    }
    if (Number(tpl.status) !== 0) {
      throw createHttpError(400, '模版已禁用，无法发送消息');
    }
    await record.update({ status: RECORD_STATUS.pending });
    const content = renderMessage({ template: tpl, props: record.props || {} });
    return await processRecord({ record, content, level: tpl.level, targetOptions: Object.assign({}, record.options) });
  };

  // 启动时补发上次进程退出前未完成的记录
  const processPendingRecords = async () => {
    const list = await models.record.findAll({ where: { status: RECORD_STATUS.pending }, order: [['createdAt', 'ASC']] });
    for (const record of list) {
      await retryRecord({ id: record.id }).catch(error => fastify.log.error(`补发消息失败(record ${record.id}): ${error.message}`));
    }
    return { total: list.length };
  };

  const getTemplate = async id => {
    const tpl = await models.template.findByPk(id);
    if (!tpl) {
      throw createHttpError(404, '模版不存在');
    }
    return tpl;
  };

  const assertEditable = tpl => {
    if (Number(tpl.level) === 0) {
      throw createHttpError(403, '系统模版不可修改或删除，可复制后修改副本');
    }
  };

  const assertCodeUnique = async ({ code, type, level, excludeId }) => {
    const exists = await models.template.findOne({
      where: Object.assign({ code, type, level }, excludeId ? { id: { [Op.ne]: excludeId } } : {})
    });
    if (exists) {
      throw createHttpError(409, `模版编码 ${code} 已存在`);
    }
  };

  const pickTemplateFields = data =>
    ['name', 'subject', 'content', 'description', 'variables', 'extra'].reduce((result, key) => {
      if (data[key] !== undefined) result[key] = data[key];
      return result;
    }, {});

  const validateOrBadRequest = fields => {
    try {
      validateTemplate(fields);
    } catch (e) {
      throw createHttpError(400, e.message);
    }
  };

  Object.assign(fastify[options.name].services, {
    includeTemplate,
    messageTemplate,
    parseTemplate,
    parseTemplateFile,
    validateTemplate,
    renderMessage,
    sendMessage,
    processPendingRecords,

    // 发送记录相关服务
    record: {
      list: async ({ filter = {}, perPage = 20, currentPage = 1 }) => {
        const { count, rows } = await models.record.findAndCountAll({
          where: filter,
          limit: perPage,
          offset: (currentPage - 1) * perPage,
          order: [['createdAt', 'DESC']]
        });

        return {
          pageData: rows,
          totalCount: count,
          perPage,
          currentPage
        };
      },

      detail: async ({ id }) => await getRecord(id),

      retry: retryRecord
    },

    // 消息模版相关服务
    template: {
      list: async ({ filter = {}, keyword, perPage = 20, currentPage = 1 }) => {
        const where = Object.assign({}, filter);
        if (keyword) {
          const pattern = `%${escapeLike(keyword)}%`;
          where[Op.or] = [likeCondition(models.template, 'name', pattern), likeCondition(models.template, 'code', pattern)];
        }
        const { count, rows } = await models.template.findAndCountAll({
          where,
          limit: perPage,
          offset: (currentPage - 1) * perPage,
          order: [['createdAt', 'DESC']]
        });

        return {
          pageData: rows,
          totalCount: count,
          perPage,
          currentPage
        };
      },

      detail: async ({ id }) => await getTemplate(id),

      create: async ({ code, type = 0, userId, ...data }) => {
        const fields = pickTemplateFields(data);
        validateOrBadRequest(fields);
        await assertCodeUnique({ code, type, level: 1 });
        return await models.template.create(Object.assign({ code, type, level: 1, status: 0 }, fields, userId ? { userId } : {}));
      },

      save: async ({ id, code, ...data }) => {
        const tpl = await getTemplate(id);
        assertEditable(tpl);
        const fields = pickTemplateFields(data);
        validateOrBadRequest(Object.assign({ subject: tpl.subject, content: tpl.content, extra: tpl.extra }, fields));
        if (code && code !== tpl.code) {
          await assertCodeUnique({ code, type: tpl.type, level: tpl.level, excludeId: tpl.id });
          fields.code = code;
        }
        Object.assign(tpl, fields);
        await tpl.save();
        return tpl;
      },

      // 软删除前改写编码，释放 code + type + level 唯一索引，删除后可重建同编码模版
      remove: async ({ id }) => {
        const tpl = await getTemplate(id);
        assertEditable(tpl);
        tpl.code = `${String(tpl.code).slice(0, 200)}#deleted#${tpl.id}`;
        await tpl.save();
        await tpl.destroy();
        return {};
      },

      setStatus: async ({ id, status }) => {
        const tpl = await getTemplate(id);
        tpl.status = Number(status) === 1 ? 1 : 0;
        await tpl.save();
        return tpl;
      },

      // 复制为停用的业务模版；系统模版复制后保留编码（启用后即覆盖同编码系统模版），已存在时追加 _copy 后缀
      copy: async ({ id, userId }) => {
        const tpl = await getTemplate(id);
        const used = (
          await models.template.findAll({
            attributes: ['code'],
            where: {
              type: tpl.type,
              level: 1,
              [Op.or]: [{ code: tpl.code }, likeCondition(models.template, 'code', `${escapeLike(`${tpl.code}_copy`)}%`)]
            }
          })
        ).map(item => item.code);
        let code = tpl.code;
        for (let i = 1; used.includes(code); i++) {
          code = `${tpl.code}_copy${i > 1 ? i : ''}`;
        }
        return await models.template.create(
          Object.assign(
            {
              code,
              type: tpl.type,
              level: 1,
              status: 1,
              name: `${tpl.name || tpl.code}（副本）`
            },
            pickTemplateFields({
              subject: tpl.subject,
              content: tpl.content,
              description: tpl.description,
              variables: tpl.variables,
              extra: tpl.extra
            }),
            userId ? { userId } : {}
          )
        );
      },

      // 传 template 时渲染未保存的内容（预览）；props 与 variables[].example 合并，props 优先
      render: async ({ templateId, template, props }) => {
        const target = template ? Object.assign({ type: 0 }, template) : await getTemplate(templateId);
        try {
          validateTemplate(target);
          const data = merge({}, getExampleProps(target.variables), props);
          return Object.assign({ type: Number(target.type) || 0, props: data }, renderMessage({ template: target, props: data }));
        } catch (e) {
          throw createHttpError(400, e.message);
        }
      },

      // 管理端按模版发送：发送的就是这一条模版，不做业务 / 系统模版回退
      send: async ({ templateId, name, props = {}, userId }) => {
        const tpl = await getTemplate(templateId);
        if (Number(tpl.status) !== 0) {
          throw createHttpError(400, '模版已禁用，无法发送消息');
        }
        const record = await sendMessage({
          type: tpl.type,
          name,
          props,
          code: tpl.code,
          level: tpl.level,
          userId
        });
        return { success: Number(record?.status) === RECORD_STATUS.success, recordId: record?.id };
      }
    }
  });
});

module.exports.RECORD_STATUS = RECORD_STATUS;
