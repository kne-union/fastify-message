const fp = require('fastify-plugin');
const pick = require('lodash/pick');

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const SMTP_FIELDS = ['enabled', 'host', 'port', 'secure', 'user', 'pass', 'fromName', 'fromAddress'];

// 租户邮件设置：SMTP 配置与系统邮件模版的租户定制。tenantId 由宿主项目定义，鉴权与租户校验也由宿主项目负责
module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify[options.name];
  const { Op } = models.template.sequelize.Sequelize;

  const requireTenantId = tenantId => {
    if (tenantId === undefined || tenantId === null || tenantId === '') {
      throw createHttpError(400, 'tenantId 不能为空');
    }
    return String(tenantId);
  };

  const toSmtpDetail = config =>
    config
      ? Object.assign(
          { configured: true, hasPassword: !!config.pass },
          pick(
            config,
            SMTP_FIELDS.filter(key => key !== 'pass')
          )
        )
      : { configured: false, enabled: false, port: 465, secure: true, hasPassword: false };

  const findSmtp = async tenantId => await models.tenantEmailConfig.findOne({ where: { tenantId: requireTenantId(tenantId) } });

  // 未传 getEmailConfig 时发送使用的默认实现：读取该租户已启用的配置
  const getEmailConfig = async ({ tenantId }) => {
    if (!tenantId) return null;
    const config = await models.tenantEmailConfig.findOne({ where: { tenantId: String(tenantId), enabled: true } });
    return config ? pick(config.get({ plain: true }), SMTP_FIELDS) : null;
  };

  // 可定制的模版类型：0 邮件、1 短信
  const TEMPLATE_TYPES = [0, 1];

  const toTemplateType = (type = 0) => {
    const value = Number(type);
    if (!TEMPLATE_TYPES.includes(value)) {
      throw createHttpError(400, `不支持的模版类型 ${type}`);
    }
    return value;
  };

  const getTemplateCodes = async ({ tenantId, type }) => {
    const codes = typeof options.mailSettingTemplateCodes === 'function' ? await options.mailSettingTemplateCodes({ tenantId, type }) : options.mailSettingTemplateCodes;
    return Array.isArray(codes) ? codes : null;
  };

  // 可定制的系统模版：全局、启用、level 0，配置了 mailSettingTemplateCodes 时按白名单过滤，传 codes 时再取交集
  const listSystemTemplates = async ({ tenantId, type, codes: scopeCodes }) => {
    const whitelist = await getTemplateCodes({ tenantId, type });
    const codes = [whitelist, Array.isArray(scopeCodes) ? scopeCodes : null].filter(Boolean).reduce((result, list) => (result ? result.filter(code => list.includes(code)) : list), null);
    return await models.template.findAll({
      where: Object.assign({ type, level: 0, status: 0, tenantId: '' }, codes ? { code: { [Op.in]: codes } } : {}),
      order: [['code', 'ASC']]
    });
  };

  const getSystemTemplate = async ({ tenantId, code, type }) => {
    const codes = await getTemplateCodes({ tenantId, type });
    if (codes && !codes.includes(code)) {
      throw createHttpError(403, `模版 ${code} 不允许定制`);
    }
    const tpl = await models.template.findOne({ where: { code, type, level: 0, status: 0, tenantId: '' } });
    if (!tpl) {
      throw createHttpError(404, '模版不存在');
    }
    return tpl;
  };

  const findTenantTemplate = async ({ tenantId, code, type }) => await models.template.findOne({ where: { code, type, level: 1, tenantId } });

  const getTenantTemplate = async ({ tenantId, code, type }) => {
    await getSystemTemplate({ tenantId, code, type });
    const own = await findTenantTemplate({ tenantId, code, type });
    if (!own) {
      throw createHttpError(404, '模版尚未定制');
    }
    return own;
  };

  const copySystemTemplate = async ({ tenantId, code, type, userId }) => {
    const system = await getSystemTemplate({ tenantId, code, type });
    const copied = await services.template.copy({ id: system.id, tenantId, userId });
    await copied.update({ name: system.name, status: 0 });
    return copied;
  };

  const smtpPayload = (input, current) => {
    const data = pick(input, SMTP_FIELDS);
    if (!data.pass) {
      delete data.pass;
    }
    const next = Object.assign({}, current, data);
    if (!next.host || !next.user) {
      throw createHttpError(400, 'SMTP 配置不完整');
    }
    return data;
  };

  Object.assign(fastify[options.name].services, {
    mailSetting: {
      getEmailConfig,

      smtpDetail: async ({ tenantId }) => {
        const config = await findSmtp(tenantId);
        return toSmtpDetail(config && config.get({ plain: true }));
      },

      // 密码为空时保留原密码；启用时须连接测试通过才保存
      smtpSave: async ({ tenantId, ...input }) => {
        const tenantKey = requireTenantId(tenantId);
        const current = await findSmtp(tenantKey);
        const plain = current ? current.get({ plain: true }) : {};
        const data = smtpPayload(input, plain);
        const next = Object.assign({}, plain, data);
        if (next.enabled !== false) {
          try {
            await services.verifyEmailConfig({ config: pick(next, SMTP_FIELDS) });
          } catch (e) {
            throw createHttpError(400, `SMTP 连接测试未通过：${e.message}`);
          }
        }
        if (current) {
          await current.update(data);
          return toSmtpDetail(current.get({ plain: true }));
        }
        const created = await models.tenantEmailConfig.create(Object.assign({ tenantId: tenantKey }, data));
        return toSmtpDetail(created.get({ plain: true }));
      },

      smtpRemove: async ({ tenantId }) => {
        await models.tenantEmailConfig.destroy({ where: { tenantId: requireTenantId(tenantId) } });
        return {};
      },

      // 未填写密码时使用已保存的密码测试
      smtpTest: async ({ tenantId, to, ...input }) => {
        const current = await findSmtp(tenantId);
        const plain = current ? current.get({ plain: true }) : {};
        const config = Object.assign({}, plain, smtpPayload(input, plain));
        return await services.verifyEmailConfig({ config: pick(config, SMTP_FIELDS), to });
      },

      // 不传 type 时返回全部可定制类型（邮件在前、短信在后）；codes 用于宿主按场景进一步收窄
      templateList: async ({ tenantId, type, codes }) => {
        const tenantKey = requireTenantId(tenantId);
        const types = type === undefined || type === null || type === '' ? TEMPLATE_TYPES : [toTemplateType(type)];
        const list = [];
        for (const itemType of types) {
          const systemTemplates = await listSystemTemplates({ tenantId: tenantKey, type: itemType, codes });
          const ownList = systemTemplates.length ? await models.template.findAll({ where: { type: itemType, level: 1, tenantId: tenantKey, code: { [Op.in]: systemTemplates.map(item => item.code) } } }) : [];
          systemTemplates.forEach(tpl => {
            const own = ownList.find(item => item.code === tpl.code);
            list.push({
              code: tpl.code,
              type: itemType,
              name: tpl.name,
              description: tpl.description,
              systemTemplateId: tpl.id,
              customized: !!own,
              templateId: own ? own.id : null,
              status: own ? own.status : null,
              updatedAt: own ? own.updatedAt : null
            });
          });
        }
        return { list };
      },

      templateDetail: async ({ tenantId, code, type }) => {
        const tenantKey = requireTenantId(tenantId);
        const templateType = toTemplateType(type);
        const system = await getSystemTemplate({ tenantId: tenantKey, code, type: templateType });
        const own = await findTenantTemplate({ tenantId: tenantKey, code, type: templateType });
        return { customized: !!own, template: own || system };
      },

      // 以系统模版为底稿创建租户模版，保留编码与名称并直接启用（内容与系统模版一致，不影响发送）
      templateCustomize: async ({ tenantId, code, type, userId }) => {
        const tenantKey = requireTenantId(tenantId);
        const templateType = toTemplateType(type);
        const own = await findTenantTemplate({ tenantId: tenantKey, code, type: templateType });
        if (own) {
          return own;
        }
        return await copySystemTemplate({ tenantId: tenantKey, code, type: templateType, userId });
      },

      // 只允许修改主题、正文与说明，编码、类型、变量沿用系统模版；尚未定制时保存即创建租户模版，保存失败不留副本
      templateSave: async ({ tenantId, code, type, subject, content, description, userId }) => {
        const tenantKey = requireTenantId(tenantId);
        const templateType = toTemplateType(type);
        await getSystemTemplate({ tenantId: tenantKey, code, type: templateType });
        const own = await findTenantTemplate({ tenantId: tenantKey, code, type: templateType });
        const target = own || (await copySystemTemplate({ tenantId: tenantKey, code, type: templateType, userId }));
        try {
          return await services.template.save({ id: target.id, subject, content, description });
        } catch (e) {
          if (!own) {
            await services.template.remove({ id: target.id });
          }
          throw e;
        }
      },

      templateSetStatus: async ({ tenantId, code, type, status }) => {
        const own = await getTenantTemplate({ tenantId: requireTenantId(tenantId), code, type: toTemplateType(type) });
        return await services.template.setStatus({ id: own.id, status });
      },

      // 删除租户模版，恢复使用系统模版
      templateReset: async ({ tenantId, code, type }) => {
        const own = await getTenantTemplate({ tenantId: requireTenantId(tenantId), code, type: toTemplateType(type) });
        await services.template.remove({ id: own.id });
        return {};
      },

      // 传 template 时预览未保存的内容，变量定义沿用当前生效的模版
      templatePreview: async ({ tenantId, code, type, template, props }) => {
        const tenantKey = requireTenantId(tenantId);
        const templateType = toTemplateType(type);
        const system = await getSystemTemplate({ tenantId: tenantKey, code, type: templateType });
        const current = (await findTenantTemplate({ tenantId: tenantKey, code, type: templateType })) || system;
        const target = template ? Object.assign({ type: templateType, variables: current.variables, extra: current.extra }, pick(template, ['subject', 'content'])) : current.get({ plain: true });
        return await services.template.render({ template: target, props });
      }
    }
  });
});
