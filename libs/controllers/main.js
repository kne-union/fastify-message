const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify[options.name];

  // 查看发送记录列表
  fastify.get(
    `${options.prefix}/records`,
    {
      onRequest: options.getAuthenticate('record'),
      schema: {
        description: '获取消息发送记录列表',
        summary: '查看发送记录',
        querystring: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer', default: 1, description: '页码' },
            perPage: { type: 'integer', default: 20, description: '每页数量' },
            filter: {
              type: 'object',
              default: {},
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
            type: 'object',
            properties: {
              totalCount: { type: 'integer', description: '总数量' },
              currentPage: { type: 'integer', description: '当前页码' },
              perPage: { type: 'integer', description: '每页数量' },
              pageData: {
                type: 'array',
                items: {
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
      
      return await services.record.list({ filter: where, perPage, currentPage });
    }
  );

  // 发送消息
  fastify.post(
    `${options.prefix}/templates/send`,
    {
      onRequest: options.getAuthenticate('template:send'),
      schema: {
        description: '根据模版发送消息',
        summary: '发送消息',
        body: {
          type: 'object',
          required: ['templateId', 'name'],
          properties: {
            templateId: { type: 'string', description: '模版ID' },
            name: { type: 'string', description: '发送对象（邮箱/手机号）' },
            props: { type: 'object', description: '模版变量', additionalProperties: true }
          }
        },
        response: {
          200: {
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
        throw fastify.httpErrors.notFound(error.message);
      }
    }
  );

  // 查看单条发送记录
  fastify.get(
    `${options.prefix}/records/:id`,
    {
      onRequest: options.getAuthenticate('record'),
      schema: {
        description: '获取单条消息发送记录详情',
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
        throw fastify.httpErrors.notFound(error.message);
      }
    }
  );

  // 查看消息模版列表
  fastify.get(
    `${options.prefix}/templates`,
    {
      onRequest: options.getAuthenticate('template'),
      schema: {
        description: '获取消息模版列表',
        summary: '查看消息模版',
        querystring: {
          type: 'object',
          properties: {
            currentPage: { type: 'integer', default: 1, description: '页码' },
            perPage: { type: 'integer', default: 20, description: '每页数量' },
            filter: {
              type: 'object',
              default: {},
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
            type: 'object',
            properties: {
              totalCount: { type: 'integer', description: '总数量' },
              currentPage: { type: 'integer', description: '当前页码' },
              perPage: { type: 'integer', description: '每页数量' },
              pageData: {
                type: 'array',
                items: {
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
      
      return await services.template.list({ filter: where, perPage, currentPage });
    }
  );

  // 查看单个消息模版
  fastify.get(
    `${options.prefix}/templates/:id`,
    {
      onRequest: options.getAuthenticate('template'),
      schema: {
        description: '获取单个消息模版详情',
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
        throw fastify.httpErrors.notFound(error.message);
      }
    }
  );
});
