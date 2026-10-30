module.exports = ({ DataTypes, options }) => {
  return {
    model: {
      name: {
        type: DataTypes.STRING,
        comment: '发送对象'
      },
      type: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '发送类型: 0:邮件'
      },
      code: {
        type: DataTypes.STRING,
        comment: '模版编码'
      },
      props: {
        type: DataTypes.JSON,
        comment: '消息模版变量'
      },
      content: {
        type: DataTypes.JSON,
        comment: '消息内容'
      },
      options: {
        type: DataTypes.JSON,
        comment: '发送参数（附件只保留描述信息），重发时使用'
      },
      status: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '发送状态: 0:成功,1:失败,2:待发送'
      },
      error: {
        type: DataTypes.TEXT,
        comment: '失败原因'
      },
      retryCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: '重试次数'
      },
      tenantId: {
        type: DataTypes.STRING,
        comment: '所属租户，重发时据此取租户模版与 SMTP 配置'
      }
    },
    associate: ({ record, template }) => {
      record.belongsTo(options.getUserModel(), {
        foreignKey: 'userId',
        comment: '发送用户，为空时为系统发送'
      });
      record.belongsTo(template);
    },
    options: {
      comment: '系统消息记录',
      // status 索引由 upgradeSchema 在补列后创建：老库的 status 列不存在，sync 建索引会失败并阻断启动
      indexes: [{ fields: ['created_at'] }, { fields: ['type'] }, { fields: ['code'] }, { fields: ['type', 'code'] }]
    }
  };
};
