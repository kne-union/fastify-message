### HTTP 接口 (API)

基础路径：`/api/v1/message`

---

#### GET /statistics

获取消息统计数据概览。

**权限类型**：`statistics`

**查询参数**：

| 参数   | 类型     | 必填 | 默认值 | 描述                                |
|------|--------|----|-----|-----------------------------------|
| range | String | 否  | 7d  | 时间范围: 7d=近7天, 1m=近1个月, 1y=近1年 |

**响应示例**：

```json
{
  "range": "7d",
  "rangeLabel": "近7天",
  "totalRecords": 256,
  "byType": {
    "0": 200,
    "1": 56
  },
  "byCode": {
    "welcome": 100,
    "verify": 80,
    "notify": 76
  },
  "templateStats": {
    "total": 5,
    "byStatus": {
      "0": 4,
      "1": 1
    },
    "byType": {
      "0": 3,
      "1": 2
    }
  },
  "recentTrend": [
    { "date": "2026-05-07", "count": 10 },
    { "date": "2026-05-08", "count": 15 },
    { "date": "2026-05-09", "count": 8 }
  ],
  "recentTrendByType": [
    { "date": "2026-05-07", "type": 0, "count": 8 },
    { "date": "2026-05-07", "type": 1, "count": 2 },
    { "date": "2026-05-08", "type": 0, "count": 12 },
    { "date": "2026-05-08", "type": 1, "count": 3 }
  ]
}
```

**响应字段说明**：

| 字段                     | 类型     | 描述                        |
|------------------------|--------|---------------------------|
| range                  | String | 当前时间范围参数                  |
| rangeLabel             | String | 时间范围中文描述                  |
| totalRecords           | Number | 时间范围内发送记录数                |
| byType                 | Object | 按消息类型统计（键：0=邮件，1=短信）     |
| byCode                 | Object | 按模板编码统计                   |
| templateStats          | Object | 模板统计信息                    |
| templateStats.total    | Number | 模板总数                      |
| templateStats.byStatus | Object | 按模板状态统计（键：0=启用，1=禁用）     |
| templateStats.byType   | Object | 按模板类型统计（键：0=邮件，1=短信）     |
| recentTrend            | Array  | 时间范围内发送趋势                  |
| recentTrendByType      | Array  | 时间范围内按类型发送趋势              |

---

#### GET /statistics/sse

SSE 实时推送当天消息统计数据。

**权限类型**：`statistics`

**查询参数**：

| 参数       | 类型     | 必填 | 默认值 | 描述                    |
|----------|--------|----|-----|-----------------------|
| interval | Number | 否  | 5   | 推送间隔时间（秒），最小1秒，默认5秒 |

**说明**：该接口为 Server-Sent Events (SSE) 接口，仅推送当天的实时统计数据，建立连接后按指定间隔自动推送。数据按小时粒度展示发送趋势。

**事件格式**：

- `data` 事件：推送当天统计数据（JSON格式）
- `error` 事件：推送错误信息

**响应示例**：

```json
{
  "date": "2026-05-13",
  "totalRecords": 42,
  "byType": {
    "0": 35,
    "1": 7
  },
  "byCode": {
    "welcome": 20,
    "verify": 12,
    "notify": 10
  },
  "hourlyTrend": [
    { "hour": 8, "count": 5 },
    { "hour": 9, "count": 12 },
    { "hour": 10, "count": 8 }
  ],
  "hourlyTrendByType": [
    { "hour": 8, "type": 0, "count": 4 },
    { "hour": 8, "type": 1, "count": 1 },
    { "hour": 9, "type": 0, "count": 10 },
    { "hour": 9, "type": 1, "count": 2 }
  ]
}
```

**响应字段说明**：

| 字段                       | 类型     | 描述                          |
|--------------------------|--------|-----------------------------|
| date                     | String | 当天日期                        |
| totalRecords             | Number | 当天发送记录数                     |
| byType                   | Object | 按消息类型统计（键：0=邮件，1=短信）       |
| byCode                   | Object | 按模板编码统计                     |
| hourlyTrend              | Array  | 按小时发送趋势                     |
| hourlyTrend[].hour       | Number | 小时（0-23）                    |
| hourlyTrend[].count      | Number | 发送数量                        |
| hourlyTrendByType        | Array  | 按小时按类型发送趋势                  |
| hourlyTrendByType[].hour | Number | 小时（0-23）                    |
| hourlyTrendByType[].type | Number | 消息类型                        |
| hourlyTrendByType[].count | Number | 发送数量                        |

**使用示例**：

```javascript
// 默认5秒推送一次
const eventSource = new EventSource('/api/v1/message/statistics/sse');

// 每10秒推送一次
const eventSource = new EventSource('/api/v1/message/statistics/sse?interval=10');

// 注意：浏览器原生 EventSource 不支持自定义 headers，
// 如需认证可通过 URL 参数传递 token，或使用第三方库如 eventsource-parser

eventSource.onmessage = (event) => {
  const statistics = JSON.parse(event.data);
  console.log('当天实时统计:', statistics);
};

eventSource.addEventListener('error', (event) => {
  const error = JSON.parse(event.data);
  console.error('统计错误:', error);
});
```

---

#### GET /records

获取消息发送记录列表。

**权限类型**：`record`

**查询参数**：

| 参数           | 类型     | 必填 | 默认值 | 描述                 |
|--------------|--------|----|-----|----------------------|
| currentPage  | Number | 否  | 1   | 页码                   |
| perPage      | Number | 否  | 20  | 每页数量                 |
| filter[type] | Number | 否  | -   | 发送类型：0=邮件，1=短信      |
| filter[code] | String | 否  | -   | 模板编码（精确匹配）           |
| filter[name] | String | 否  | -   | 发送对象/邮箱/手机号（精确匹配）   |

**响应示例**：

```json
{
  "totalCount": 100,
  "currentPage": 1,
  "perPage": 20,
  "pageData": [
    {
      "id": "1",
      "name": "user@example.com",
      "type": 0,
      "code": "welcome",
      "props": { "username": "John" },
      "content": { "subject": "欢迎", "html": "<p>你好</p>" },
      "templateId": "1",
      "createdAt": "2026-05-12T10:00:00.000Z"
    }
  ]
}
```

---

#### GET /records/:id

获取单条发送记录详情。

**权限类型**：`record`

**路径参数**：

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 记录ID |

**错误响应**：

| 状态码 | 描述   |
|-----|------|
| 404 | 记录不存在 |

---

#### GET /templates

获取消息模版列表。

**权限类型**：`template`

**查询参数**：

| 参数              | 类型     | 必填 | 默认值 | 描述               |
|-----------------|--------|----|-----|------------------|
| currentPage     | Number | 否  | 1   | 页码               |
| perPage         | Number | 否  | 20  | 每页数量             |
| filter[type]    | Number | 否  | -   | 模版类型：0=邮件，1=短信  |
| filter[code]    | String | 否  | -   | 模版编码（精确匹配）       |
| filter[level]   | Number | 否  | -   | 模版级别：0=系统，1=业务  |
| filter[status]  | Number | 否  | -   | 状态：0=启用，1=禁用    |

**响应示例**：

```json
{
  "totalCount": 10,
  "currentPage": 1,
  "perPage": 20,
  "pageData": [
    {
      "id": "1",
      "name": "欢迎邮件",
      "code": "welcome",
      "type": 0,
      "level": 0,
      "status": 0,
      "content": "<!-- subject -->欢迎<!-- html --><p>你好</p>",
      "createdAt": "2026-05-12T10:00:00.000Z"
    }
  ]
}
```

---

#### GET /templates/:id

获取单个消息模版详情。

**权限类型**：`template`

**路径参数**：

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 模版ID |

**错误响应**：

| 状态码 | 描述   |
|-----|------|
| 404 | 模版不存在 |

---

#### POST /templates/send

根据模版发送消息。模版类型由模版自身决定，无需指定。

**权限类型**：`template:send`

**请求体**：

| 参数        | 类型     | 必填 | 描述            |
|-----------|--------|----|---------------|
| templateId | String | 是  | 模版ID          |
| name      | String | 是  | 发送对象（邮箱/手机号）   |
| props     | Object | 否  | 模版变量          |

**请求示例**：

```json
{
  "templateId": "1",
  "name": "user@example.com",
  "props": {
    "username": "John",
    "content": "Welcome!"
  }
}
```

**响应示例**：

```json
{
  "success": true
}
```

**错误响应**：

| 状态码 | 描述         |
|-----|------------|
| 400 | 模版已禁用，无法发送消息 |
| 404 | 模版不存在      |

---

### 服务方法 (Services)

#### includeTemplate

从指定目录导入模板文件到数据库。

| 参数  | 类型     | 必填 | 描述       |
|-----|--------|----|----------|
| dir | String | 是  | 模板文件目录路径 |

| 返回值 | 类型            | 描述   |
|-----|---------------|------|
| -   | Promise<void> | 无返回值 |

示例：

```javascript
await fastify.message.services.includeTemplate('./templates');
```

#### messageTemplate

根据模板编码和参数生成消息内容。

| 参数    | 类型     | 必填 | 默认值 | 描述         |
|-------|--------|----|-----|------------|
| code  | String | 是  | -   | 模板编码       |
| type  | Number | 否  | 0   | 模板类型（0:邮件） |
| level | Number | 否  | 0   | 模板级别       |
| props | Object | 是  | -   | 模板变量       |

| 返回值字段           | 类型     | 描述     |
|-----------------|--------|--------|
| content.subject | String | 邮件主题   |
| content.html    | String | HTML内容 |
| content.text    | String | 纯文本内容  |
| props           | Object | 模板变量   |
| code            | String | 模板编码   |
| type            | Number | 模板类型   |
| templateId      | Number | 模板ID   |

示例：

```javascript
const message = await fastify.message.services.messageTemplate({
  code: 'welcome',
  props: {
    username: 'John',
    content: 'Welcome!'
  }
});
```

#### parseTemplate

解析模板文本中的特殊注释标记。

| 参数   | 类型     | 必填 | 描述     |
|------|--------|----|--------|
| text | String | 是  | 模板文本内容 |

| 返回值字段   | 类型     | 描述                     |
|---------|--------|------------------------|
| subject | String | <!-- subject --> 标记内容  |
| html    | String | <!-- html --> 标记内容     |
| text    | String | <!-- text --> 标记内容（可选） |

#### sendMessage

发送消息（邮件/短信）。

| 参数      | 类型     | 必填 | 默认值 | 描述            |
|---------|--------|----|-----|---------------|
| type    | Number | 否  | 0   | 消息类型（0:邮件）    |
| name    | String | 是  | -   | 接收者（邮件地址/手机号） |
| props   | Object | 是  | -   | 模板变量          |
| code    | String | 是  | -   | 模板编码          |
| level   | Number | 否  | 0   | 模板级别          |
| client  | Object | 否  | -   | 客户端配置（覆盖默认配置） |
| options | Object | 否  | -   | 发送选项          |

options 参数详情：

| 字段          | 类型     | 必填 | 描述    |
|-------------|--------|----|-------|
| title       | String | 否  | 发件人名称 |
| subject     | String | 否  | 邮件主题  |
| attachments | Array  | 否  | 附件列表  |

示例：

```javascript
await fastify.message.services.sendMessage({
  type: 0,
  name: 'user@example.com',
  code: 'welcome',
  props: {
    username: 'John',
    content: 'Welcome!'
  },
  options: {
    title: 'System',
    attachments: [
      {
        filename: 'welcome.pdf',
        path: './welcome.pdf'
      }
    ]
  }
});
```

#### statistics.getOverview

获取消息统计数据概览。

| 参数   | 类型     | 必填 | 默认值 | 描述                                |
|------|--------|----|-----|-----------------------------------|
| range | String | 否  | 7d  | 时间范围: 7d=近7天, 1m=近1个月, 1y=近1年 |

| 返回值字段                    | 类型     | 描述                        |
|---------------------------|--------|---------------------------|
| range                     | String | 当前时间范围参数                  |
| rangeLabel                | String | 时间范围中文描述                  |
| totalRecords              | Number | 时间范围内发送记录数                |
| byType                    | Object | 按消息类型统计（键：0=邮件，1=短信）     |
| byCode                    | Object | 按模板编码统计                   |
| templateStats             | Object | 模板统计信息                    |
| templateStats.total       | Number | 模板总数                      |
| templateStats.byStatus    | Object | 按模板状态统计（键：0=启用，1=禁用）     |
| templateStats.byType      | Object | 按模板类型统计（键：0=邮件，1=短信）     |
| recentTrend               | Array  | 时间范围内发送趋势                  |
| recentTrend[].date        | String | 日期                        |
| recentTrend[].count       | Number | 发送数量                      |
| recentTrendByType         | Array  | 时间范围内按类型发送趋势              |
| recentTrendByType[].date  | String | 日期                        |
| recentTrendByType[].type  | Number | 消息类型                      |
| recentTrendByType[].count | Number | 发送数量                      |

示例：

```javascript
// 近7天统计（默认）
const stats = await fastify.message.services.statistics.getOverview();

// 近1个月统计
const stats = await fastify.message.services.statistics.getOverview({ range: '1m' });

// 近1年统计
const stats = await fastify.message.services.statistics.getOverview({ range: '1y' });

console.log('时间范围:', stats.rangeLabel);
console.log('发送数:', stats.totalRecords);
```

#### statistics.getRealtime

获取当天实时统计数据，按小时粒度展示发送趋势。

| 返回值字段                         | 类型     | 描述                          |
|--------------------------------|--------|-----------------------------|
| date                           | String | 当天日期                        |
| totalRecords                   | Number | 当天发送记录数                     |
| byType                         | Object | 按消息类型统计（键：0=邮件，1=短信）       |
| byCode                         | Object | 按模板编码统计                     |
| hourlyTrend                    | Array  | 按小时发送趋势                     |
| hourlyTrend[].hour             | Number | 小时（0-23）                    |
| hourlyTrend[].count            | Number | 发送数量                        |
| hourlyTrendByType              | Array  | 按小时按类型发送趋势                  |
| hourlyTrendByType[].hour       | Number | 小时（0-23）                    |
| hourlyTrendByType[].type       | Number | 消息类型                        |
| hourlyTrendByType[].count      | Number | 发送数量                        |

示例：

```javascript
const realtime = await fastify.message.services.statistics.getRealtime();
console.log('当天日期:', realtime.date);
console.log('当天发送数:', realtime.totalRecords);
console.log('按小时趋势:', realtime.hourlyTrend);
```

#### record.list

查询发送记录列表。

| 参数         | 类型     | 必填 | 默认值 | 描述   |
|------------|--------|----|-----|------|
| filter     | Object | 否  | {}  | 过滤条件 |
| perPage    | Number | 否  | 20  | 每页数量 |
| currentPage | Number | 否  | 1   | 页码   |

filter 支持的字段：`type`、`code`、`name`

#### record.detail

获取单条发送记录详情。

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 记录ID |

#### template.list

查询消息模版列表。

| 参数         | 类型     | 必填 | 默认值 | 描述   |
|------------|--------|----|-----|------|
| filter     | Object | 否  | {}  | 过滤条件 |
| perPage    | Number | 否  | 20  | 每页数量 |
| currentPage | Number | 否  | 1   | 页码   |

filter 支持的字段：`type`、`code`、`level`、`status`

#### template.detail

获取单个消息模版详情。

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 模版ID |

#### template.send

根据模版ID发送消息。

| 参数        | 类型     | 必填 | 默认值 | 描述            |
|-----------|--------|----|-----|---------------|
| templateId | String | 是  | -   | 模版ID          |
| name      | String | 是  | -   | 接收者（邮箱/手机号）   |
| props     | Object | 否  | {}  | 模版变量          |

| 返回值字段   | 类型      | 描述     |
|---------|---------|--------|
| success | Boolean | 是否发送成功 |

错误：
- 模版不存在 → 抛出 `Error('模版不存在')`
- 模版已禁用 → 抛出 `Error('模版已禁用，无法发送消息')`

示例：

```javascript
const result = await fastify.message.services.template.send({
  templateId: '1',
  name: 'user@example.com',
  props: { username: 'John' }
});
```

---

### 数据模型 (Models)

#### Template 模型

| 字段        | 类型     | 默认值 | 描述         |
|-----------|--------|-----|------------|
| id        | Number | -   | 主键         |
| code      | String | -   | 模板编码       |
| type      | Number | 0   | 模板类型       |
| name      | String | -   | 模板名称       |
| content   | String | -   | 模板内容       |
| level     | Number | 0   | 模板级别       |
| status    | Number | 0   | 模板状态（0:启用） |
| createdAt | Date   | -   | 创建时间       |
| updatedAt | Date   | -   | 更新时间       |

#### Record 模型

| 字段         | 类型     | 默认值 | 描述   |
|------------|--------|-----|------|
| id         | Number | -   | 主键   |
| type       | Number | -   | 消息类型 |
| code       | String | -   | 模板编码 |
| templateId | Number | -   | 模板ID |
| props      | Object | -   | 模板变量 |
| name       | String | -   | 接收者  |
| content    | Object | -   | 发送内容 |
| createdAt  | Date   | -   | 创建时间 |
| updatedAt  | Date   | -   | 更新时间 |
