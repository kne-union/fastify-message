const fp = require('fastify-plugin');
const fs = require('fs-extra');
const path = require('node:path');
const template = require('lodash/template');
const merge = require('lodash/merge');
const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');
const pify = require('pify');

module.exports = fp(async (fastify, options) => {
  const emailConfig = Object.assign(
    {},
    {
      port: 465,
      secure: true
    },
    options.emailConfig
  );
  const isTest = options.isTest;
  const { models, services } = fastify[options.name];
  const includeTemplate = async dir => {
    if (!(await fs.exists(dir))) {
      console.log('template dir not exists');
      return;
    }
    console.log('------start include template------');
    const list = await fs.readdir(dir);
    for (const file of list) {
      const filePath = path.join(dir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const filename = file.replace(path.extname(file), '');
      const tempArray = filename.split('_');
      const code = tempArray[0],
        type = tempArray[1] || 0,
        name = tempArray[2] || code;
      const codeTemplate = await models.template.findOne({
        where: {
          code,
          type,
          level: 0
        }
      });

      if (codeTemplate) {
        codeTemplate.content = content;
        codeTemplate.name = name;
        await codeTemplate.save();
        console.log(`update template: ${code}`);
        continue;
      }
      await models.template.create({
        code,
        type,
        name,
        content,
        level: 0
      });
      console.log(`create template: ${code}`);
    }
    console.log('------end include template------');
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
        code,
        type,
        level
      }
    });
    if (!codeTemplate) {
      throw new Error('template not found');
    }

    const content = parseTemplate(template(codeTemplate.content)(props).split(/<!--(\s*)-->/g));

    return {
      content,
      props,
      code,
      type,
      templateId: codeTemplate.id
    };
  };

  const sendMessage = async ({ type = 0, name, props, code, level = 0, client, options: targetOptions }) => {
    targetOptions = Object.assign({}, targetOptions);
    const { content, templateId } = await messageTemplate({ code, type, level, props });
    const sendOptions = await (async () => {
      if (type === 0) {
        const currentClient = merge(
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
        );
        const smtp = nodemailer.createTransport(currentClient);

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
          await pify(smtp.sendMail.bind(smtp))(mailOptions);
        }
        return mailOptions;
      }
      const currentSender = options.senders?.[type];
      if (typeof currentSender === 'function') {
        const { content, templateId } = await messageTemplate({ code, type, level, props });
        if (!isTest) {
          return await currentSender({ code, templateId, content, props, name, type, level, options: targetOptions });
        }

        return { content, props, level, options: targetOptions };
      }
    })(type);
    await models.record.create({ type, code, templateId, props, name, content: sendOptions });
  };

  Object.assign(fastify[options.name].services, {
    includeTemplate,
    messageTemplate,
    parseTemplate,
    sendMessage
  });
});
