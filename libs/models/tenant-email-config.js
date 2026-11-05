module.exports = ({ DataTypes }) => {
  return {
    model: {
      tenantId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: '租户标识，由宿主项目定义（如客户 id）'
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: '是否启用，停用时发送回退到全局配置'
      },
      host: {
        type: DataTypes.STRING,
        comment: 'SMTP 服务器'
      },
      port: {
        type: DataTypes.INTEGER,
        defaultValue: 465,
        comment: 'SMTP 端口'
      },
      secure: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: '是否使用 SSL'
      },
      user: {
        type: DataTypes.STRING,
        comment: 'SMTP 账号'
      },
      pass: {
        type: DataTypes.STRING,
        comment: 'SMTP 密码，接口不回传'
      },
      fromName: {
        type: DataTypes.STRING,
        comment: '发件人名称'
      },
      fromAddress: {
        type: DataTypes.STRING,
        comment: '发件人地址，为空时使用 SMTP 账号'
      }
    },
    options: {
      paranoid: false,
      indexes: [{ unique: true, fields: ['tenant_id'] }],
      comment: '租户 SMTP 配置'
    }
  };
};
