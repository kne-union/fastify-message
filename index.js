const fp = require('fastify-plugin');
const autoload = require('@fastify/autoload');
const path = require('path');

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
