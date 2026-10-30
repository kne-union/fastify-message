module.exports = ({ DataTypes, options }) => {
  return {
    model: {
      name: {
        type: DataTypes.STRING,
        comment: '模版名称'
      },
      code: {
        type: DataTypes.STRING,
        comment: '模版编码',
        allowNull: false
      },
      type: {
        type: DataTypes.INTEGER,
        comment: '模版类型: 0:email,1:SMS',
        allowNull: false
      },
      subject: {
        type: DataTypes.TEXT,
        comment: '邮件主题模版（Liquid）'
      },
      content: {
        type: DataTypes.TEXT,
        comment: '模版正文（Liquid）：邮件为 HTML，短信为纯文本'
      },
      description: {
        type: DataTypes.TEXT,
        comment: '模版描述'
      },
      variables: {
        type: DataTypes.JSON,
        comment: '模版变量 [{ name, label, example }]'
      },
      extra: {
        type: DataTypes.JSON,
        comment: '其它分段（Liquid），如短信服务商模版编码'
      },
      level: {
        type: DataTypes.INTEGER,
        comment: '模版级别: 0:系统,1:业务',
        defaultValue: 1
      },
      status: {
        type: DataTypes.INTEGER,
        comment: '状态: 0:启用,1:禁用',
        defaultValue: 0
      }
    },
    associate: ({ template }) => {
      template.belongsTo(options.getUserModel(), {
        foreignKey: 'userId',
        comment: '创建用户，为空时为系统初始化默认创建'
      });
    },
    options: {
      // code + type + level 唯一索引由 upgradeSchema 创建：老库存在重复或软删除数据时，sync 直接建唯一索引会失败并阻断启动
      comment: '消息模版'
    }
  };
};
