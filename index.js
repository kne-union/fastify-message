const fp = require('fastify-plugin');
const autoload = require('@fastify/autoload');
const path = require('path');

/**
 * messageType:
 *   发送渠道: 短信，邮箱
 *   发送模板:
 * channel: xxxx
 * props:
 *  模板变量的值
 * */

module.exports = fp(
  async (fastify, options) => {
    fastify.register(autoload, {
      dir: path.resolve(__dirname, './libs'),
      options
    });
  },
  {
    name: 'fastify-file-manager',
    dependencies: ['fastify-sequelize']
  }
);
