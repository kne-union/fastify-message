// 新增的响应 schema 只用于 OpenAPI 文档：字段可空、对象允许额外字段，避免序列化改变实际输出
const str = description => ({ type: 'string', nullable: true, description });
const num = description => ({ type: 'number', nullable: true, description });
// 结构不固定的字段不声明类型，原样输出
const any = description => ({ description });
const obj = (description, properties = {}) => ({ type: 'object', nullable: true, additionalProperties: true, description, properties });

const success = (description, schema) => ({ 200: Object.assign({}, schema || { type: 'object', additionalProperties: true }, { description }) });

const MESSAGE_TYPE = '消息类型：0 邮件，1 短信';

const statistics = {
  type: 'object',
  additionalProperties: true,
  properties: {
    range: str('时间范围：7d / 1m / 3m / 1y'),
    rangeLabel: str('时间范围名称，如「近7天」'),
    totalRecords: num('范围内发送的消息总数'),
    byType: any(`按消息类型统计的发送数，键为类型（${MESSAGE_TYPE}）`),
    byCode: any('按模板编码统计的发送数，键为模板编码'),
    recentTrend: any('每日趋势，每项为 { date, count }'),
    recentTrendByType: any('每日按类型趋势，每项为 { date, type, count }'),
    hourlyTrend: any('按小时趋势，每项为 { date, hour, count }'),
    hourlyTrendByType: any('按小时、类型趋势，每项为 { date, hour, type, count }'),
    templateStats: obj('模板统计（不受时间范围筛选）', {
      total: num('模板总数'),
      byStatus: any('按状态统计的模板数，键为状态（0 启用，1 禁用）'),
      byType: any(`按类型统计的模板数，键为类型（${MESSAGE_TYPE}）`)
    })
  }
};

module.exports = { str, num, any, obj, success, MESSAGE_TYPE, statistics };
