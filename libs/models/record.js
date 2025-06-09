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
        type: DataTypes.JSONB,
        comment: '消息内容'
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
      comment: '系统消息记录'
    }
  };
};
