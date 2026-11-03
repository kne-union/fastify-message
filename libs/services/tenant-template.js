const fp = require('fastify-plugin');

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// 租户可定制的模版类型：0 邮件、1 短信
const TEMPLATE_TYPES = [0, 1];

// 系统模版开放给租户的范围：mailSettingTemplateCodes 白名单 ∩ 平台 tenantOpen 开关。
// 租户消息设置（SMTP、租户模版定制、鉴权）由 fastify-tenant 实现，这里只回答「哪些系统模版可以给该租户定制」
module.exports = fp(async (fastify, options) => {
  const { models } = fastify[options.name];
  const { Op } = models.template.sequelize.Sequelize;

  const toTemplateType = (type = 0) => {
    const value = Number(type);
    if (!TEMPLATE_TYPES.includes(value)) {
      throw createHttpError(400, `不支持的模版类型 ${type}`);
    }
    return value;
  };

  // 返回 null 表示未配置白名单，全部系统模版都可定制
  const getTemplateCodes = async ({ tenantId, type }) => {
    const codes = typeof options.mailSettingTemplateCodes === 'function' ? await options.mailSettingTemplateCodes({ tenantId, type }) : options.mailSettingTemplateCodes;
    return Array.isArray(codes) ? codes : null;
  };

  // includeTenantClosed 供平台代租户管理时使用，不受 tenantOpen 限制
  const systemTemplateWhere = ({ type, includeTenantClosed }) =>
    Object.assign({ type, level: 0, status: 0, tenantId: '' }, includeTenantClosed ? {} : { tenantOpen: { [Op.ne]: false } });

  const isTemplateCustomizable = async tpl => {
    if (Number(tpl.level) !== 0 || tpl.tenantId || !TEMPLATE_TYPES.includes(Number(tpl.type))) {
      return false;
    }
    const codes = await getTemplateCodes({ type: Number(tpl.type) });
    return !codes || codes.includes(tpl.code);
  };

  Object.assign(fastify[options.name].services, {
    tenantTemplate: {
      // 可给该租户定制的系统模版（全局、启用、level 0），按 code 排序
      list: async ({ tenantId, type, includeTenantClosed } = {}) => {
        const templateType = toTemplateType(type);
        const codes = await getTemplateCodes({ tenantId, type: templateType });
        return await models.template.findAll({
          where: Object.assign(systemTemplateWhere({ type: templateType, includeTenantClosed }), codes ? { code: { [Op.in]: codes } } : {}),
          order: [['code', 'ASC']]
        });
      },

      // 不在白名单返回 403，不存在或未开放返回 404
      get: async ({ tenantId, code, type, includeTenantClosed } = {}) => {
        const templateType = toTemplateType(type);
        const codes = await getTemplateCodes({ tenantId, type: templateType });
        if (codes && !codes.includes(code)) {
          throw createHttpError(403, `模版 ${code} 不允许定制`);
        }
        const tpl = await models.template.findOne({ where: Object.assign(systemTemplateWhere({ type: templateType, includeTenantClosed }), { code }) });
        if (!tpl) {
          throw createHttpError(404, '模版不存在');
        }
        return tpl;
      },

      isCustomizable: isTemplateCustomizable,

      // 平台端模版列表标注 tenantCustomizable：白名单内的全局系统模版才可设置是否开放给租户
      withTenantCustomizable: async list => {
        const result = [];
        for (const tpl of list) {
          const plain = typeof tpl.get === 'function' ? tpl.get({ plain: true }) : tpl;
          result.push(Object.assign({}, plain, { tenantCustomizable: await isTemplateCustomizable(plain) }));
        }
        return result;
      },

      // 关闭后租户端不可见、不可定制；已定制的租户模版仍按原状态参与发送
      setTenantOpen: async ({ id, tenantOpen }) => {
        const tpl = await models.template.findByPk(id);
        if (!tpl) {
          throw createHttpError(404, '模版不存在');
        }
        if (!(await isTemplateCustomizable(tpl))) {
          throw createHttpError(403, `模版 ${tpl.code} 不在可定制范围内`);
        }
        tpl.tenantOpen = !!tenantOpen;
        await tpl.save();
        return tpl;
      }
    }
  });
});
