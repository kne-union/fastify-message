const fp = require('fastify-plugin');
const fs = require('fs-extra');
const path = require('node:path');
const template = require('lodash/template');
const merge = require('lodash/merge');
const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');

module.exports = fp(async (fastify, options) => {
  const emailConfig = Object.assign({}, {
    port: 465, secure: true
  }, options.emailConfig);
  const isTest = options.isTest;
  const { models, services } = fastify[options.name];

  // 采集消息统计数据
  const collectMessageStatistics = async ({ code, type, success = true }) => {
    try {
      const statisticsServices = fastify[`${options.name}Statistics`]?.services;
      if (!statisticsServices) return;

      const data = { total: 1, success: success ? 1 : 0, failed: success ? 0 : 1 };
      const unit = { total: 'count', success: 'count', failed: 'count' };
      const time = new Date();

      // 1-segment channel: code
      await statisticsServices.collect({
        channel: code, data, unit, time
      });
      // 2-segment channel: code:type
      await statisticsServices.collect({
        channel: `${code}:${type}`, data, unit, time
      });
    } catch (e) {
      fastify.log.error(`采集消息统计数据失败: ${e.message}`);
    }
  };
  const includeTemplate = async dir => {
    if (!(await fs.exists(dir))) {
      fastify.log.info('template dir not exists');
      return;
    }
    fastify.log.info('------start include template------');
    const list = await fs.readdir(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const content = await fs.readFile(filePath, 'utf8');
      const filename = file.replace(path.extname(file), '');
      const tempArray = filename.split('_');
      const code = tempArray[0], type = Number(tempArray[1]) || 0, name = tempArray[2] || code;
      const codeTemplate = await models.template.findOne({
        where: {
          code, type, level: 0
        }
      });

      if (codeTemplate) {
        codeTemplate.content = content;
        codeTemplate.name = name;
        await codeTemplate.save();
        fastify.log.info(`update template: ${code}`);
        continue;
      }
      await models.template.create({
        code, type, name, content, level: 0
      });
      fastify.log.info(`create template: ${code}`);
    }
    fastify.log.info('------end include template------');
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

  const messageTemplate = async ({ code, type = 0, level = 0, props }) => {
    const codeTemplate = await models.template.findOne({
      where: {
        code, type, level
      }
    });
    if (!codeTemplate) {
      throw new Error('template not found');
    }

    const content = parseTemplate(template(codeTemplate.content)(props));

    return {
      content, props, code, type, templateId: codeTemplate.id
    };
  };

  const sendMessage = async ({ type = 0, name, props, code, level = 0, client, options: targetOptions }) => {
    targetOptions = Object.assign({}, targetOptions);
    const { content, templateId } = await messageTemplate({ code, type, level, props });
    const sendOptions = await (async () => {
      const currentSender = options.senders?.[type];
      if (type === 0) {
        const mailOptions = {
          ...targetOptions,
          from: `"${targetOptions.title || emailConfig.user}" <${emailConfig.user}>`,
          to: name,
          subject: content.subject || options.subject || emailConfig.defaultSubject || 'Message reminder',
          text: content.text || convert(content.html),
          html: content.html,
          attachments: options.attachments || []
        };

        if (!isTest) {
          if (typeof currentSender === 'function') {
            await currentSender(mailOptions);
          } else {
            const currentClient = merge({}, {
              host: emailConfig.host, port: emailConfig.port, secure: emailConfig.secure, auth: {
                user: emailConfig.user, pass: emailConfig.pass
              }
            }, client);
            const smtp = nodemailer.createTransport(currentClient);
            try {
              await smtp.sendMail(mailOptions);
            } finally {
              smtp.close();
            }
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
    })(type);
    await models.record.create({ type, code, templateId, props, name, content: sendOptions });
    await collectMessageStatistics({ code, type, success: true });
  };

  Object.assign(fastify[options.name].services, {
    includeTemplate, messageTemplate, parseTemplate, sendMessage,
    
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
      
      detail: async ({ id }) => {
        const record = await models.record.findByPk(id);
        if (!record) {
          throw new Error('记录不存在');
        }
        return record;
      }
    },

    // 消息模版相关服务
    template: {
      list: async ({ filter = {}, perPage = 20, currentPage = 1 }) => {
        const { count, rows } = await models.template.findAndCountAll({
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
      
      detail: async ({ id }) => {
        const template = await models.template.findByPk(id);
        if (!template) {
          throw new Error('模版不存在');
        }
        return template;
      },

      send: async ({ templateId, name, props = {} }) => {
        const tpl = await models.template.findByPk(templateId);
        if (!tpl) {
          throw new Error('模版不存在');
        }
        if (tpl.status !== 0) {
          throw new Error('模版已禁用，无法发送消息');
        }
        await sendMessage({
          type: tpl.type,
          name,
          props,
          code: tpl.code,
          level: tpl.level
        });
        return { success: true };
      }
    }
  });
});
