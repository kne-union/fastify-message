module.exports = ({DataTypes}) => {
    return {
        name: 'modelName',//此处定义modelName，默认根据文件名转驼峰命名，可以缺省
        model: {
            name: DataTypes.STRING
        }, associate: ({/*这里可以获取models*/}, fastify) => {
            //可以这样获取某个namespace的models fastify.account.models
        }, options: {
            indexed: []
        }
    };
};

