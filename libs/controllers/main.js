const fp = require('fastify-plugin');

const RECORD_TAG = '消息-发送记录';
const TEMPLATE_TAG = '消息-消息模版';

const variablesSchema = {
  type: 'array',
  nullable: true,
  description: '模版变量列表，供编辑器插入变量与预览示例',
  items: {
    type: 'object',
    additionalProperties: true,
    description: '模版变量',
    properties: {
      name: { type: 'string', description: '变量路径，支持 a.b' },
      label: { type: 'string', nullable: true, description: '变量展示名' },
      example: { description: '示例值，预览时使用' }
    }
  }
};

const extraSchema = { type: 'object', nullable: true, additionalProperties: true, description: '其它分段（Liquid），如短信服务商模版编码' };

const templateProperties = {
  id: { type: 'string', description: '模版ID' },
  name: { type: 'string', description: '模版名称' },
  code: { type: 'string', description: '模版编码' },
  type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
  level: { type: 'integer', description: '模版级别: 0=系统, 1=业务' },
  status: { type: 'integer', description: '状态: 0=启用, 1=禁用' },
  subject: { type: 'string', nullable: true, description: '邮件主题模版（Liquid）' },
  content: { type: 'string', nullable: true, description: '模版正文（Liquid）：邮件为 HTML，短信为纯文本' },
  description: { type: 'string', nullable: true, description: '模版描述' },
  variables: variablesSchema,
  extra: extraSchema,
  tenantId: { type: 'string', description: '所属租户，空字符串为全局模版' },
  createdAt: { type: 'string', description: '创建时间' },
  updatedAt: { type: 'string', description: '更新时间' }
};

const templateResponse = description => ({ 200: { description, type: 'object', properties: templateProperties } });

const idParams = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '模版ID' }
  },
  required: ['id']
};

const templateBodyProperties = {
  name: { type: 'string', description: '模版名称' },
  code: { type: 'string', description: '模版编码，同类型业务模版内唯一' },
  subject: { type: 'string', description: '邮件主题模版（Liquid），短信不需要' },
  content: { type: 'string', description: '模版正文（Liquid）：邮件为 HTML，短信为纯文本' },
  description: { type: 'string', description: '模版描述' },
  variables: variablesSchema,
  extra: extraSchema
};

const recordProperties = {
  id: { type: 'string', description: '记录ID' },
  name: { type: 'string', description: '发送对象（邮箱/手机号）' },
  type: { type: 'integer', description: '发送类型: 0=邮件, 1=短信' },
  code: { type: 'string', description: '模板编码' },
  props: { type: 'object', nullable: true, description: '模板变量', additionalProperties: true },
  content: { type: 'object', nullable: true, description: '实际发送内容，失败或待发送时为空', additionalProperties: true },
  status: { type: 'integer', description: '发送状态: 0=成功, 1=失败, 2=待发送' },
  error: { type: 'string', nullable: true, description: '失败原因' },
  retryCount: { type: 'integer', description: '重试次数' },
  templateId: { type: 'string', description: '模板ID' },
  userId: { type: 'string', nullable: true, description: '发送用户ID，系统发送时为空' },
  tenantId: { type: 'string', nullable: true, description: '所属租户，全局发送时为空' },
  createdAt: { type: 'string', description: '创建时间' },
  updatedAt: { type: 'string', description: '更新时间' }
};

module.exports = fp(async (fastify, options) => {
  const { Op } = fastify[options.name].models.record.sequelize.Sequelize;
  const { services } = fastify[options.name];

  // 查看发送记录列表
  fastify.get(
    `${options.prefix}/records`,
    {
      onRequest: options.getAuthenticate('record'),
      schema: {
        tags: [RECORD_TAG],
        description: '分页获取消息发送记录列表，按创建时间倒序；perPage 最大 100',
        summary: '查看发送记录',
        querystring: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer', default: 1, description: '页码' },
            perPage: { type: 'integer', default: 20, description: '每页数量，超过 100 按 100 处理' },
            filter: {
              type: 'object',
              default: {},
              description: '筛选条件，除时间范围外均为精确匹配',
              properties: {
                type: { type: 'integer', description: '发送类型: 0=邮件, 1=短信' },
                code: { type: 'string', description: '模板编码' },
                name: { type: 'string', description: '发送对象（邮箱/手机号）' },
                status: { type: 'integer', description: '发送状态: 0=成功, 1=失败, 2=待发送' },
                templateId: { type: 'string', description: '模板ID' },
                tenantId: { type: 'string', description: '所属租户' },
                startTime: { type: 'string', format: 'date-time', description: '发送时间起（含）' },
                endTime: { type: 'string', format: 'date-time', description: '发送时间止（含）' }
              }
            }
          }
        },
        response: {
          200: {
            description: '发送记录分页结果',
            type: 'object',
            properties: {
              totalCount: { type: 'integer', description: '总数量' },
              currentPage: { type: 'integer', description: '当前页码' },
              perPage: { type: 'integer', description: '每页数量' },
              pageData: {
                type: 'array',
                description: '当前页发送记录列表',
                items: {
                  type: 'object',
                  description: '发送记录',
                  properties: recordProperties
                }
              }
            }
          }
        }
      }
    },
    async request => {
      const { currentPage = 1, perPage = 20, filter = {} } = request.query;
      const { type, code, name, status, templateId, tenantId, startTime, endTime } = filter;

      const where = {};
      if (type !== undefined) where.type = type;
      if (code) where.code = code;
      if (name) where.name = name;
      if (status !== undefined) where.status = status;
      if (templateId) where.templateId = templateId;
      if (tenantId) where.tenantId = tenantId;
      if (startTime || endTime) {
        where.createdAt = Object.assign({}, startTime ? { [Op.gte]: new Date(startTime) } : {}, endTime ? { [Op.lte]: new Date(endTime) } : {});
      }

      return await services.record.list({ filter: where, perPage: Math.min(perPage, 100), currentPage });
    }
  );

  // 发送消息
  fastify.post(
    `${options.prefix}/templates/send`,
    {
      onRequest: options.getAuthenticate('template:send'),
      schema: {
        tags: [TEMPLATE_TAG],
        description: '使用指定模版渲染内容并通过对应类型的发送器（邮件 / 短信）发送，同时写入发送记录（失败也会记录原因）；模版不存在返回 404，模版已禁用返回 400',
        summary: '发送消息',
        body: {
          type: 'object',
          required: ['templateId', 'name'],
          properties: {
            templateId: { type: 'string', description: '模版ID' },
            name: { type: 'string', description: '发送对象（邮箱/手机号）' },
            props: { type: 'object', description: '模版变量，用于渲染模版内容，不传为空对象', additionalProperties: true }
          }
        },
        response: {
          200: {
            description: '发送结果，投递失败时 success 为 false，失败原因见发送记录',
            type: 'object',
            properties: {
              success: { type: 'boolean', description: '是否发送成功' },
              recordId: { type: 'string', description: '发送记录ID' }
            }
          }
        }
      }
    },
    async request => {
      const { templateId, name, props = {} } = request.body;
      return await services.template.send({ templateId, name, props, userId: request.userInfo?.id });
    }
  );

  // 查看单条发送记录
  fastify.get(
    `${options.prefix}/records/:id`,
    {
      onRequest: options.getAuthenticate('record'),
      schema: {
        tags: [RECORD_TAG],
        description: '获取单条消息发送记录详情，记录不存在返回 404',
        summary: '查看发送记录详情',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '记录ID' }
          },
          required: ['id']
        },
        response: {
          200: {
            description: '发送记录详情',
            type: 'object',
            properties: recordProperties
          }
        }
      }
    },
    async request => await services.record.detail({ id: request.params.id })
  );

  // 重发失败 / 待发送的记录
  fastify.post(
    `${options.prefix}/records/:id/retry`,
    {
      onRequest: options.getAuthenticate('record:retry'),
      schema: {
        tags: [RECORD_TAG],
        summary: '重发消息',
        description: '按模版当前内容和记录中的变量重新发送失败或待发送的记录；成功记录返回 400，记录或模版不存在返回 404，模版已禁用返回 400',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '记录ID' }
          },
          required: ['id']
        },
        response: {
          200: {
            description: '重发后的发送记录',
            type: 'object',
            properties: recordProperties
          }
        }
      }
    },
    async request => await services.record.retry({ id: request.params.id })
  );

  // 查看消息模版列表
  fastify.get(
    `${options.prefix}/templates`,
    {
      onRequest: options.getAuthenticate('template'),
      schema: {
        tags: [TEMPLATE_TAG],
        description: '分页获取消息模版列表，按创建时间倒序；perPage 最大 100',
        summary: '查看消息模版',
        querystring: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer', default: 1, description: '页码' },
            perPage: { type: 'integer', default: 20, description: '每页数量，超过 100 按 100 处理' },
            filter: {
              type: 'object',
              default: {},
              description: '筛选条件，keyword 为模糊搜索（不区分大小写），其余均为精确匹配',
              properties: {
                type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
                code: { type: 'string', description: '模版编码' },
                level: { type: 'integer', description: '模版级别: 0=系统, 1=业务' },
                status: { type: 'integer', description: '状态: 0=启用, 1=禁用' },
                tenantId: { type: 'string', description: '所属租户，不传时只查全局模版' },
                keyword: { type: 'string', description: '按模版名称、编码模糊搜索' }
              }
            }
          }
        },
        response: {
          200: {
            description: '消息模版分页结果',
            type: 'object',
            properties: {
              totalCount: { type: 'integer', description: '总数量' },
              currentPage: { type: 'integer', description: '当前页码' },
              perPage: { type: 'integer', description: '每页数量' },
              pageData: {
                type: 'array',
                description: '当前页消息模版列表',
                items: {
                  type: 'object',
                  description: '消息模版',
                  properties: templateProperties
                }
              }
            }
          }
        }
      }
    },
    async request => {
      const { currentPage = 1, perPage = 20, filter = {} } = request.query;
      const { type, code, level, status, tenantId, keyword } = filter;

      const where = { tenantId: tenantId || '' };
      if (type !== undefined) where.type = type;
      if (code) where.code = code;
      if (level !== undefined) where.level = level;
      if (status !== undefined) where.status = status;

      return await services.template.list({ filter: where, keyword, perPage: Math.min(perPage, 100), currentPage });
    }
  );

  // 查看单个消息模版
  fastify.get(
    `${options.prefix}/templates/:id`,
    {
      onRequest: options.getAuthenticate('template'),
      schema: {
        tags: [TEMPLATE_TAG],
        description: '获取单个消息模版详情，模版不存在返回 404',
        summary: '查看消息模版详情',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '模版ID' }
          },
          required: ['id']
        },
        response: {
          200: {
            description: '消息模版详情',
            type: 'object',
            properties: templateProperties
          }
        }
      }
    },
    async request => await services.template.detail({ id: request.params.id })
  );

  // 渲染消息模版（预览）
  fastify.post(
    `${options.prefix}/templates/render`,
    {
      onRequest: options.getAuthenticate('template'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '渲染消息模版',
        description: '用变量渲染模版，邮件返回 { subject, html, text }，短信返回 { text }，并带上 extra 各分段；传 template 时渲染未保存的内容（预览），props 与 variables[].example 合并（props 优先）；语法错误返回 400',
        body: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: '模版ID，未传 template 时必填' },
            template: {
              type: 'object',
              description: '未保存的模版内容，优先于 templateId',
              properties: {
                type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
                subject: { type: 'string', description: '邮件主题模版' },
                content: { type: 'string', description: '模版正文' },
                variables: variablesSchema,
                extra: extraSchema
              }
            },
            props: { type: 'object', additionalProperties: true, description: '模版变量，未传的变量使用 variables[].example' }
          }
        },
        response: {
          200: {
            description: '渲染结果',
            type: 'object',
            additionalProperties: true,
            properties: {
              type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
              subject: { type: 'string', description: '渲染后的邮件主题' },
              html: { type: 'string', description: '渲染后的邮件 HTML' },
              text: { type: 'string', description: '渲染后的纯文本（短信正文或邮件纯文本）' },
              props: { type: 'object', additionalProperties: true, description: '实际用于渲染的变量' }
            }
          }
        }
      }
    },
    async request => await services.template.render(request.body)
  );

  // 新建业务模版
  fastify.post(
    `${options.prefix}/templates`,
    {
      onRequest: options.getAuthenticate('template:manage'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '新建消息模版',
        description: '新建业务模版（level=1），保存前校验 Liquid 语法；编码在同类型业务模版内重复返回 409，语法错误返回 400',
        body: {
          type: 'object',
          required: ['name', 'code', 'type'],
          properties: Object.assign({}, templateBodyProperties, {
            type: { type: 'integer', enum: [0, 1], description: '模版类型: 0=邮件, 1=短信' }
          })
        },
        response: templateResponse('新建的消息模版')
      }
    },
    async request => await services.template.create(Object.assign({}, request.body, { userId: request.userInfo?.id }))
  );

  // 修改业务模版
  fastify.put(
    `${options.prefix}/templates/:id`,
    {
      onRequest: options.getAuthenticate('template:manage'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '修改消息模版',
        description: '修改业务模版，类型不可修改；系统模版不可修改（403），可复制后修改副本；语法错误返回 400，编码重复返回 409',
        params: idParams,
        body: { type: 'object', properties: templateBodyProperties },
        response: templateResponse('修改后的消息模版')
      }
    },
    async request => await services.template.save(Object.assign({}, request.body, { id: request.params.id }))
  );

  // 启用 / 禁用模版
  fastify.post(
    `${options.prefix}/templates/:id/status`,
    {
      onRequest: options.getAuthenticate('template:manage'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '启用/禁用消息模版',
        description: '禁用后无法通过接口发送消息',
        params: idParams,
        body: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'integer', enum: [0, 1], description: '状态: 0=启用, 1=禁用' } }
        },
        response: templateResponse('修改状态后的消息模版')
      }
    },
    async request => await services.template.setStatus({ id: request.params.id, status: request.body.status })
  );

  // 复制模版
  fastify.post(
    `${options.prefix}/templates/:id/copy`,
    {
      onRequest: options.getAuthenticate('template:manage'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '复制消息模版',
        description: '复制为禁用状态的业务模版副本，与已有业务模版编码冲突时追加 _copy 后缀',
        params: idParams,
        response: templateResponse('复制出的消息模版')
      }
    },
    async request => await services.template.copy({ id: request.params.id, userId: request.userInfo?.id })
  );

  // 删除业务模版
  fastify.delete(
    `${options.prefix}/templates/:id`,
    {
      onRequest: options.getAuthenticate('template:manage'),
      schema: {
        tags: [TEMPLATE_TAG],
        summary: '删除消息模版',
        description: '删除业务模版，系统模版不可删除（403）；删除后可重建同编码模版',
        params: idParams,
        response: { 200: { description: '删除成功', type: 'object', properties: {} } }
      }
    },
    async request => await services.template.remove({ id: request.params.id })
  );
});
