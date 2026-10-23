const fp = require('fastify-plugin');

const RECORD_TAG = '消息-发送记录';
const TEMPLATE_TAG = '消息-消息模版';

module.exports = fp(async (fastify, options) => {
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
              description: '筛选条件，均为精确匹配',
              properties: {
                type: { type: 'integer', description: '发送类型: 0=邮件, 1=短信' },
                code: { type: 'string', description: '模板编码' },
                name: { type: 'string', description: '发送对象（邮箱/手机号）' }
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
                  properties: {
                    id: { type: 'string', description: '记录ID' },
                    name: { type: 'string', description: '发送对象（邮箱/手机号）' },
                    type: { type: 'integer', description: '发送类型: 0=邮件, 1=短信' },
                    code: { type: 'string', description: '模板编码' },
                    props: { type: 'object', description: '模板变量', additionalProperties: true },
                    content: { type: 'object', description: '消息内容', additionalProperties: true },
                    templateId: { type: 'string', description: '模板ID' },
                    createdAt: { type: 'string', description: '创建时间' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async request => {
      const { currentPage = 1, perPage = 20, filter = {} } = request.query;
      const { type, code, name } = filter;

      const where = {};
      if (type !== undefined) where.type = type;
      if (code) where.code = code;
      if (name) where.name = name;

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
        description: '使用指定模版渲染内容并通过对应类型的发送器（邮件 / 短信）发送，同时写入发送记录；模版不存在返回 404，模版已禁用返回 400',
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
            description: '发送成功',
            type: 'object',
            properties: {
              success: { type: 'boolean', description: '是否发送成功' }
            }
          }
        }
      }
    },
    async request => {
      const { templateId, name, props = {} } = request.body;
      try {
        return await services.template.send({ templateId, name, props });
      } catch (error) {
        if (error.message === '模版已禁用，无法发送消息') {
          throw fastify.httpErrors.badRequest(error.message);
        }
        if (error.message === '模版不存在' || error.message === 'template not found') {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
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
            properties: {
              id: { type: 'string', description: '记录ID' },
              name: { type: 'string', description: '发送对象（邮箱/手机号）' },
              type: { type: 'integer', description: '发送类型: 0=邮件, 1=短信' },
              code: { type: 'string', description: '模板编码' },
              props: { type: 'object', description: '模板变量', additionalProperties: true },
              content: { type: 'object', description: '消息内容', additionalProperties: true },
              templateId: { type: 'string', description: '模板ID' },
              createdAt: { type: 'string', description: '创建时间' }
            }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      try {
        return await services.record.detail({ id });
      } catch (error) {
        if (error.message === '记录不存在') {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    }
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
              description: '筛选条件，均为精确匹配',
              properties: {
                type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
                code: { type: 'string', description: '模版编码' },
                level: { type: 'integer', description: '模版级别: 0=系统, 1=业务' },
                status: { type: 'integer', description: '状态: 0=启用, 1=禁用' }
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
                  properties: {
                    id: { type: 'string', description: '模版ID' },
                    name: { type: 'string', description: '模版名称' },
                    code: { type: 'string', description: '模版编码' },
                    type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
                    level: { type: 'integer', description: '模版级别: 0=系统, 1=业务' },
                    status: { type: 'integer', description: '状态: 0=启用, 1=禁用' },
                    content: { type: 'string', description: '模版内容' },
                    createdAt: { type: 'string', description: '创建时间' }
                  }
                }
              }
            }
          }
        }
      }
    },
    async request => {
      const { currentPage = 1, perPage = 20, filter = {} } = request.query;
      const { type, code, level, status } = filter;

      const where = {};
      if (type !== undefined) where.type = type;
      if (code) where.code = code;
      if (level !== undefined) where.level = level;
      if (status !== undefined) where.status = status;

      return await services.template.list({ filter: where, perPage: Math.min(perPage, 100), currentPage });
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
            properties: {
              id: { type: 'string', description: '模版ID' },
              name: { type: 'string', description: '模版名称' },
              code: { type: 'string', description: '模版编码' },
              type: { type: 'integer', description: '模版类型: 0=邮件, 1=短信' },
              level: { type: 'integer', description: '模版级别: 0=系统, 1=业务' },
              status: { type: 'integer', description: '状态: 0=启用, 1=禁用' },
              content: { type: 'string', description: '模版内容' },
              createdAt: { type: 'string', description: '创建时间' }
            }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      try {
        return await services.template.detail({ id });
      } catch (error) {
        if (error.message === '模版不存在') {
          throw fastify.httpErrors.notFound(error.message);
        }
        throw error;
      }
    }
  );
});
