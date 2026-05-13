const fp = require('fastify-plugin');
const fs = require('fs-extra');
const path = require('node:path');
const template = require('lodash/template');
const merge = require('lodash/merge');
const nodemailer = require('nodemailer');
const { convert } = require('html-to-text');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

module.exports = fp(async (fastify, options) => {
  // 按指定时区获取"今天0点"的UTC Date对象
  const getTodayStart = tz => {
    if (!tz) {
      return dayjs().startOf('day').toDate();
    }
    // 在目标时区下取今天0点，再转回UTC
    return dayjs().tz(tz).startOf('day').toDate();
  };

  // 按指定时区格式化日期
  const formatDate = (date, tz) => {
    if (!tz) {
      return dayjs(date).format('YYYY-MM-DD');
    }
    return dayjs(date).tz(tz).format('YYYY-MM-DD');
  };

  const resolveTimezone = tz => tz || dayjs.tz.guess();

  const emailConfig = Object.assign({}, {
    port: 465, secure: true
  }, options.emailConfig);
  const isTest = options.isTest;
  const { models, services } = fastify[options.name];
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
    
    // 统计相关服务
    statistics: {
      getOverview: async ({ range = '7d', timezone } = {}) => {
        const { Sequelize } = models.record.sequelize;
        const recordModel = models.record;
        const templateModel = models.template;
        const createdAtCol = recordModel.rawAttributes.createdAt.field;
        const dialect = recordModel.sequelize.getDialect();
        const effectiveTimezone = resolveTimezone(timezone);

        // 根据range计算起始时间
        const rangeMap = {
          '7d': { days: 7, label: '近7天' },
          '1m': { days: 30, label: '近1个月' },
          '1y': { days: 365, label: '近1年' }
        };
        const normalizedRange = rangeMap[range] ? range : '7d';
        const rangeConfig = rangeMap[normalizedRange];
        // 按时区计算起始日期：先获取目标时区"今天0点"的UTC时间，再往前推N天
        const todayStart = getTodayStart(effectiveTimezone);
        const startDate = new Date(todayStart);
        startDate.setDate(startDate.getDate() - rangeConfig.days);

        const whereRange = { createdAt: { [Sequelize.Op.gte]: startDate } };

        // 按时区格式化日期的SQL：SQLite用strftime+utc偏移，MySQL用DATE_FORMAT+CONVERT_TZ，PostgreSQL用TO_CHAR+AT TIME ZONE
        const dateFn = (() => {
          if (!effectiveTimezone || dialect === 'sqlite') {
            return col => Sequelize.fn('DATE', Sequelize.col(col));
          }
          if (dialect === 'postgres') {
            return col => Sequelize.fn('TO_CHAR', Sequelize.literal(`"${col}" AT TIME ZONE '${effectiveTimezone}'`), 'YYYY-MM-DD');
          }
          return col => Sequelize.fn('DATE_FORMAT', Sequelize.fn('CONVERT_TZ', Sequelize.col(col), '+00:00', Sequelize.literal(`'${effectiveTimezone}'`)), '%Y-%m-%d');
        })();

        // 并行执行所有查询
        const [totalRecords, byType, byCode, totalTemplates, templatesByStatus, templatesByType, recentTrend, recentTrendByType] = await Promise.all([
          recordModel.count({ where: whereRange }),
          recordModel.findAll({
            attributes: ['type', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            where: whereRange,
            group: ['type'],
            raw: true
          }),
          recordModel.findAll({
            attributes: ['code', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            where: whereRange,
            group: ['code'],
            raw: true
          }),
          templateModel.count(),
          templateModel.findAll({
            attributes: ['status', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            group: ['status'],
            raw: true
          }),
          templateModel.findAll({
            attributes: ['type', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            group: ['type'],
            raw: true
          }),
          recordModel.findAll({
            attributes: [
              [dateFn(createdAtCol), 'date'],
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: whereRange,
            group: [dateFn(createdAtCol)],
            order: [[dateFn(createdAtCol), 'ASC']],
            raw: true
          }),
          recordModel.findAll({
            attributes: [
              [dateFn(createdAtCol), 'date'],
              'type',
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: whereRange,
            group: [dateFn(createdAtCol), 'type'],
            order: [[dateFn(createdAtCol), 'ASC']],
            raw: true
          })
        ]);

        // SQLite 需要在JS层做时区偏移修正DATE结果
        const adjustDate = dateStr => {
          if (!effectiveTimezone || dialect !== 'sqlite') return dateStr;
          // SQLite DATE返回UTC日期，用dayjs转到目标时区取日期
          return dayjs.utc(dateStr).tz(effectiveTimezone).format('YYYY-MM-DD');
        };

        return {
          range: normalizedRange,
          rangeLabel: rangeConfig.label,
          totalRecords,
          byType: byType.reduce((acc, item) => {
            acc[String(item.type)] = Number(item.count);
            return acc;
          }, {}),
          byCode: byCode.reduce((acc, item) => {
            acc[item.code] = Number(item.count);
            return acc;
          }, {}),
          templateStats: {
            total: totalTemplates,
            byStatus: templatesByStatus.reduce((acc, item) => {
              acc[String(item.status)] = Number(item.count);
              return acc;
            }, {}),
            byType: templatesByType.reduce((acc, item) => {
              acc[String(item.type)] = Number(item.count);
              return acc;
            }, {})
          },
          recentTrend: recentTrend.map(item => ({ date: adjustDate(item.date), count: Number(item.count) })),
          recentTrendByType: recentTrendByType.map(item => ({ date: adjustDate(item.date), type: item.type, count: Number(item.count) }))
        };
      },

      getRealtime: async ({ timezone } = {}) => {
        const { Sequelize } = models.record.sequelize;
        const recordModel = models.record;
        const createdAtCol = recordModel.rawAttributes.createdAt.field;
        const dialect = recordModel.sequelize.getDialect();
        const effectiveTimezone = resolveTimezone(timezone);

        // 当天起始时间（按指定时区）
        const todayStart = getTodayStart(effectiveTimezone);

        const whereToday = { createdAt: { [Sequelize.Op.gte]: todayStart } };

        // SQLite: strftime取UTC时间后JS层偏移；MySQL: CONVERT_TZ转时区后提取；PostgreSQL: AT TIME ZONE转时区后提取
        const hourExtract = (() => {
          if (!effectiveTimezone || dialect === 'sqlite') {
            return dialect === 'sqlite'
              ? Sequelize.fn('strftime', '%H', Sequelize.col(createdAtCol))
              : Sequelize.fn('EXTRACT', Sequelize.literal(`HOUR FROM "${createdAtCol}"`));
          }
          if (dialect === 'postgres') {
            return Sequelize.fn('EXTRACT', Sequelize.literal(`HOUR FROM "${createdAtCol}" AT TIME ZONE '${effectiveTimezone}'`));
          }
          return Sequelize.fn('EXTRACT', Sequelize.literal(`HOUR FROM CONVERT_TZ("${createdAtCol}", '+00:00', '${effectiveTimezone}')`));
        })();

        // 15分钟间隔提取：SQLite用strftime，MySQL用DATE_FORMAT+EXTRACT，PostgreSQL用TO_CHAR+EXTRACT
        const intervalExtract = (() => {
          if (dialect === 'sqlite') {
            return Sequelize.literal(`strftime('%H', "${createdAtCol}") || ':' || printf('%02d', CAST(strftime('%M', "${createdAtCol}") AS INTEGER) / 15 * 15)`);
          }
          if (!effectiveTimezone) {
            if (dialect === 'postgres') {
              return Sequelize.literal(`TO_CHAR("${createdAtCol}", 'HH24:') || LPAD((FLOOR(EXTRACT(MINUTE FROM "${createdAtCol}") / 15) * 15)::TEXT, 2, '0')`);
            }
            return Sequelize.literal(`CONCAT(DATE_FORMAT("${createdAtCol}", '%H:'), LPAD(FLOOR(EXTRACT(MINUTE FROM "${createdAtCol}") / 15) * 15, 2, '0'))`);
          }
          if (dialect === 'postgres') {
            return Sequelize.literal(`TO_CHAR("${createdAtCol}" AT TIME ZONE '${effectiveTimezone}', 'HH24:') || LPAD((FLOOR(EXTRACT(MINUTE FROM "${createdAtCol}" AT TIME ZONE '${effectiveTimezone}') / 15) * 15)::TEXT, 2, '0')`);
          }
          return Sequelize.literal(`CONCAT(DATE_FORMAT(CONVERT_TZ("${createdAtCol}", '+00:00', '${effectiveTimezone}'), '%H:'), LPAD(FLOOR(EXTRACT(MINUTE FROM CONVERT_TZ("${createdAtCol}", '+00:00', '${effectiveTimezone}')) / 15) * 15, 2, '0'))`);
        })();

        const [totalRecords, byType, byCode, hourlyTrend, hourlyTrendByType, intervalTrend] = await Promise.all([
          recordModel.count({ where: whereToday }),
          recordModel.findAll({
            attributes: ['type', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            where: whereToday,
            group: ['type'],
            raw: true
          }),
          recordModel.findAll({
            attributes: ['code', [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']],
            where: whereToday,
            group: ['code'],
            raw: true
          }),
          recordModel.findAll({
            attributes: [
              [hourExtract, 'hour'],
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: whereToday,
            group: [hourExtract],
            order: [[hourExtract, 'ASC']],
            raw: true
          }),
          recordModel.findAll({
            attributes: [
              [hourExtract, 'hour'],
              'type',
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: whereToday,
            group: [hourExtract, 'type'],
            order: [[hourExtract, 'ASC'], ['type', 'ASC']],
            raw: true
          }),
          recordModel.findAll({
            attributes: [
              [intervalExtract, 'interval'],
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
            ],
            where: whereToday,
            group: [intervalExtract],
            order: [[intervalExtract, 'ASC']],
            raw: true
          })
        ]);

        // SQLite的hour/interval是UTC，需按timezone偏移修正
        const adjustHour = hour => {
          if (!effectiveTimezone || dialect !== 'sqlite') return Number(hour);
          // 构建一个UTC时间点（今天+hour:00），转目标时区后取hour
          const utcTime = dayjs.utc().startOf('day').hour(Number(hour));
          return utcTime.tz(effectiveTimezone).hour();
        };

        const adjustInterval = intervalStr => {
          if (!effectiveTimezone || dialect !== 'sqlite') return intervalStr;
          const [h, m] = intervalStr.split(':').map(Number);
          // 构建一个UTC时间点（今天+hour:minute），转目标时区后格式化
          const utcTime = dayjs.utc().startOf('day').hour(h).minute(m);
          return utcTime.tz(effectiveTimezone).format('HH:mm');
        };

        return {
          date: formatDate(todayStart, effectiveTimezone),
          totalRecords,
          byType: byType.reduce((acc, item) => {
            acc[String(item.type)] = Number(item.count);
            return acc;
          }, {}),
          byCode: byCode.reduce((acc, item) => {
            acc[item.code] = Number(item.count);
            return acc;
          }, {}),
          hourlyTrend: hourlyTrend.map(item => ({ hour: adjustHour(item.hour), count: Number(item.count) })),
          hourlyTrendByType: hourlyTrendByType.map(item => ({
            hour: adjustHour(item.hour),
            type: Number(item.type),
            count: Number(item.count)
          })),
          intervalTrend: intervalTrend.map(item => ({ interval: adjustInterval(item.interval), count: Number(item.count) }))
        };
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
