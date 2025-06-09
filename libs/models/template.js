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
      content: {
        type: DataTypes.TEXT,
        comment: '模版内容'
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
      comment: '消息模版'
    }
  };
};
