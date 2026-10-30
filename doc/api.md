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
| filter[status] | Number | 否  | -   | 发送状态：0=成功，1=失败，2=待发送 |
| filter[templateId] | String | 否  | -   | 模板ID                 |
| filter[startTime] | String | 否  | -   | 发送时间起（ISO 时间，含）      |
| filter[endTime] | String | 否  | -   | 发送时间止（ISO 时间，含）      |

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
      "status": 0,
      "error": null,
      "retryCount": 0,
      "templateId": "1",
      "userId": null,
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:01.000Z"
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

#### POST /records/:id/retry

按模版当前内容和记录中的变量重发失败或待发送的记录，返回更新后的记录。

**权限类型**：`record:retry`

**路径参数**：

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 记录ID |

**错误响应**：

| 状态码 | 描述   |
|-----|------|
| 400 | 记录已发送成功，或模版已禁用 |
| 404 | 记录或模版不存在 |

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
| filter[keyword] | String | 否  | -   | 按模版名称、编码模糊搜索（不区分大小写，`%`、`_` 按字面匹配） |

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
      "subject": "欢迎 {{ username }}",
      "content": "<p>你好，{{ username }}</p>",
      "description": "注册成功后发送",
      "variables": [{ "name": "username", "label": "用户名", "example": "张三" }],
      "extra": {},
      "createdAt": "2026-05-12T10:00:00.000Z",
      "updatedAt": "2026-05-12T10:00:00.000Z"
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

#### POST /templates

新建业务模版（level=1，默认启用），保存前校验 Liquid 语法白名单。

**权限类型**：`template:manage`

**请求体**：

| 参数          | 类型     | 必填 | 描述                                   |
|-------------|--------|----|--------------------------------------|
| name        | String | 是  | 模版名称                                 |
| code        | String | 是  | 模版编码，同类型业务模版内唯一                      |
| type        | Number | 是  | 模版类型：0=邮件，1=短信                       |
| subject     | String | 否  | 邮件主题模版                               |
| content     | String | 否  | 模版正文：邮件为 HTML，短信为纯文本                 |
| description | String | 否  | 模版描述                                 |
| variables   | Array  | 否  | 变量声明 `[{ name, label, example }]`    |
| extra       | Object | 否  | 其它分段，如短信服务商模版编码                      |

**错误响应**：

| 状态码 | 描述                 |
|-----|--------------------|
| 400 | 模版语法错误             |
| 409 | 模版编码已存在            |

---

#### PUT /templates/:id

修改业务模版，类型不可修改，请求体字段同新建（均为可选）。

**权限类型**：`template:manage`

**错误响应**：

| 状态码 | 描述                    |
|-----|-----------------------|
| 400 | 模版语法错误                |
| 403 | 系统模版不可修改，可复制后修改副本     |
| 404 | 模版不存在                 |
| 409 | 模版编码已存在               |

---

#### POST /templates/:id/status

启用 / 禁用模版，禁用后无法通过接口发送。

**权限类型**：`template:manage`

| 参数     | 类型     | 必填 | 描述           |
|--------|--------|----|--------------|
| status | Number | 是  | 0=启用，1=禁用    |

---

#### POST /templates/:id/copy

复制为禁用状态的业务模版副本，与已有业务模版编码冲突时追加 `_copy` 后缀。系统模版可通过复制得到可编辑的副本。

**权限类型**：`template:manage`

---

#### DELETE /templates/:id

删除业务模版，系统模版返回 403。

**权限类型**：`template:manage`

---

#### POST /templates/render

渲染模版（预览）。传 `template` 时渲染未保存的内容，`props` 不传时使用 `variables[].example`。

**权限类型**：`template`

**请求体**：

| 参数         | 类型     | 必填 | 描述                                                  |
|------------|--------|----|-----------------------------------------------------|
| templateId | String | 否  | 模版ID，未传 template 时必填                                |
| template   | Object | 否  | 未保存的模版 `{ type, subject, content, variables, extra }` |
| props      | Object | 否  | 模版变量                                                |

**响应示例**：

```json
{
  "type": 0,
  "subject": "欢迎 张三",
  "html": "<p>你好，张三</p>",
  "text": "你好，张三",
  "props": { "username": "张三" }
}
```

短信返回 `{ type: 1, text, props, ...extra }`。语法错误返回 400。

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
  "success": true,
  "recordId": "12"
}
```

投递失败时同样写入发送记录（`status = 1`），接口仍返回 200，`success` 为 `false`，失败原因见发送记录。

**错误响应**：

| 状态码 | 描述         |
|-----|------------|
| 400 | 模版已禁用，无法发送消息 |
| 404 | 模版不存在      |

---

### 服务方法 (Services)

#### includeTemplate

从指定目录导入 `.liquid` / `.html` / `.txt` 模板文件到数据库（level=0，同编码同类型覆盖）。语法校验不通过或扩展名不支持的文件会被跳过并记录日志；目录中已不存在的系统模板会被停用。

| 参数  | 类型     | 必填 | 描述       |
|-----|--------|----|----------|
| dir | String | 是  | 模板文件目录路径 |
| options.disableMissing | Boolean | 否 | 是否停用目录中已不存在的系统模板，默认 `true` |

| 返回值 | 类型            | 描述   |
|-----|---------------|------|
| -   | Promise<void> | 无返回值 |

示例：

```javascript
await fastify.message.services.includeTemplate('./templates');
```

#### messageTemplate

根据模板编码和参数生成消息内容。未传 `level` 时优先使用启用的业务模板（level 1），没有再使用系统模板；模板不存在抛出 404，模板已停用抛出 400（错误对象带 `statusCode`）。

| 参数    | 类型     | 必填 | 默认值 | 描述         |
|-------|--------|----|-----|------------|
| code  | String | 是  | -   | 模板编码       |
| type  | Number | 否  | 0   | 模板类型（0:邮件） |
| level | Number | 否  | -   | 模板级别，不传时业务模板优先 |
| props | Object | 是  | -   | 模板变量       |

| 返回值字段           | 类型     | 描述     |
|-----------------|--------|--------|
| content.subject | String | 邮件主题   |
| content.html    | String | HTML内容 |
| content.text    | String | 纯文本内容  |
| props           | Object | 模板变量   |
| code            | String | 模板编码   |
| type            | Number | 模板类型   |
| level           | Number | 实际使用的模板级别 |
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

解析模板文本中的注释分段，返回 `{ [分段名]: 内容 }`，没有分段标记时返回空对象。

| 参数   | 类型     | 必填 | 描述     |
|------|--------|----|--------|
| text | String | 是  | 模板文本内容 |

#### parseTemplateFile

把模板文件内容解析为模版字段 `{ subject, description, variables, content, extra }`：邮件正文取 `html` 分段，短信正文取 `text` 分段，其余分段进入 `extra`。

| 参数   | 类型     | 必填 | 默认值 | 描述            |
|------|--------|----|-----|---------------|
| text | String | 是  | -   | 模板文件内容        |
| type | Number | 否  | 0   | 模板类型：0=邮件，1=短信 |

#### validateTemplate

校验 `{ subject, content, extra }` 的 Liquid 语法白名单（基于 `@kne/message-template` 的 `validateTemplateHtml`），不通过时抛出 `Error('模版语法错误(字段): 原因')`。

#### renderMessage

渲染模版，发送与预览共用。

| 参数       | 类型     | 必填 | 描述                                           |
|----------|--------|----|----------------------------------------------|
| template | Object | 是  | `{ type, subject, content, extra }`          |
| props    | Object | 否  | 模板变量                                         |

- 邮件：返回 `{ subject, html, text, ...extra }`，`subject` 文本模式渲染，`html` 变量自动转义（`{{ name | raw }}` 原样输出），`text` 缺省时由 html 转换
- 短信：返回 `{ text, ...extra }`，文本模式渲染不转义

#### sendMessage

发送消息（邮件/短信），先写入待发送记录，发送后更新为成功或失败。按插件配置 `retry: { times, delay }` 重试；SMTP 连接按配置复用连接池，插件关闭时释放。

| 参数      | 类型     | 必填 | 默认值 | 描述            |
|---------|--------|----|-----|---------------|
| type    | Number | 否  | 0   | 消息类型（0:邮件）    |
| name    | String | 是  | -   | 接收者（邮件地址/手机号） |
| props   | Object | 否  | {}  | 模板变量          |
| code    | String | 是  | -   | 模板编码          |
| level   | Number | 否  | -   | 模板级别，不传时业务模板优先 |
| client  | Object | 否  | -   | 客户端配置（覆盖默认配置） |
| options | Object | 否  | -   | 发送选项          |
| userId  | String | 否  | -   | 发送人，写入记录      |
| async   | Boolean | 否 | false | 为 true 时立即返回待发送记录，后台发送 |

返回发送记录（Record 模型实例），**不会 reject**：投递失败、模版不存在或已停用时记录 `status = 1`、`error` 为原因，并输出错误日志、计入失败统计；业务通过 `record.status` 判断结果。仅发送记录本身写库失败时返回 `null`（同样只记日志）。

options 参数详情：

| 字段          | 类型     | 必填 | 描述    |
|-------------|--------|----|-------|
| title       | String | 否  | 发件人名称（自动去除换行、转义引号） |
| subject     | String | 否  | 邮件主题  |
| attachments | Array  | 否  | 附件列表，未传时使用插件配置 `attachments`；发送记录中只保存 `filename` 等描述，不保存附件内容 |

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

filter 为 Sequelize where 条件，HTTP 接口会转换 `type`、`code`、`name`、`status`、`templateId` 与时间范围

#### record.detail

获取单条发送记录详情，不存在时抛出 404。

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 记录ID |

#### record.retry

重发失败或待发送的记录，参数 `{ id }`，返回更新后的记录；再次投递失败不抛错，记录保持 `status = 1`。记录不存在（404）、已成功（400）、模版缺失或停用时抛错。

#### processPendingRecords

补发所有待发送（`status = 2`）的记录，插件启动时自动执行（`isTest` 时不执行）。返回 `{ total }`。

#### upgradeSchema

为模板表、记录表补齐缺失字段，把 `code + type + level` 索引改为唯一索引（先释放已删除模板的编码；存在重复数据时跳过并告警），并创建记录表 `status` 索引。这两个索引不在模型中声明（1.x 老库执行 `sequelize.sync` 时新列尚不存在，建索引会失败并阻断启动），新库同样由本方法创建。PostgreSQL / MySQL / SQLite 通用，`autoUpgrade` 开启时启动自动执行。返回 `{ template: [新增列], record: [新增列], uniqueIndex: 'created' | 'exists' | 'duplicated' | 'failed' | 'skipped', statusIndex: 'created' | 'exists' | 'skipped' }`。

#### migrateTemplates

迁移 1.x 模板内容：合并分段拆成 `subject` / `content` / `extra`，`<%= x %>`、`<%- x %>` 改为 `{{ x }}`；含 EJS 逻辑语法或迁移后校验不通过的模板跳过。`autoUpgrade` 开启时启动自动执行。返回 `{ migrated: [...], skipped: [{ id, code, type, level, reason }] }`。

#### template.list

查询消息模版列表。

| 参数         | 类型     | 必填 | 默认值 | 描述   |
|------------|--------|----|-----|------|
| filter     | Object | 否  | {}  | 过滤条件 |
| perPage    | Number | 否  | 20  | 每页数量 |
| currentPage | Number | 否  | 1   | 页码   |

filter 支持的字段：`type`、`code`、`level`、`status`；`keyword` 按名称、编码模糊搜索

#### template.detail

获取单个消息模版详情。

| 参数 | 类型     | 必填 | 描述   |
|----|--------|----|------|
| id | String | 是  | 模版ID |

#### template.create / save / remove / setStatus / copy / render

对应 HTTP 接口的服务方法，参数与接口请求体一致（`save` / `remove` / `setStatus` / `copy` 额外传 `id`）。错误对象带 `statusCode`（400 语法错误、403 系统模版只读、404 模版不存在、409 编码重复）。

- `remove` 软删除前会把编码改写为 `原编码#deleted#id`，删除后可重建同编码模板
- `copy` 复制系统模板时保留编码、默认停用，启用后即覆盖同编码系统模板
- `render` 的 `props` 与 `variables[].example` 合并，`props` 优先

#### template.send

根据模版ID发送消息。

| 参数        | 类型     | 必填 | 默认值 | 描述            |
|-----------|--------|----|-----|---------------|
| templateId | String | 是  | -   | 模版ID          |
| name      | String | 是  | -   | 接收者（邮箱/手机号）   |
| props     | Object | 否  | {}  | 模版变量          |
| userId    | String | 否  | -   | 发送人          |

| 返回值字段   | 类型      | 描述     |
|---------|---------|--------|
| success | Boolean | 是否发送成功 |
| recordId | String | 发送记录ID |

错误（带 `statusCode`）：
- 模版不存在 → 404 `模版不存在`
- 模版已禁用 → 400 `模版已禁用，无法发送消息`

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
| subject   | String | -   | 邮件主题模版（Liquid）  |
| content   | String | -   | 模板正文（Liquid）：邮件为 HTML，短信为纯文本 |
| description | String | -  | 模板描述       |
| variables | Array  | -   | 变量声明 `[{ name, label, example }]` |
| extra     | Object | -   | 其它分段（Liquid）    |
| level     | Number | 1   | 模板级别（0:系统，1:业务） |
| status    | Number | 0   | 模板状态（0:启用） |

索引：`code + type + level` 唯一。
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
| content    | Object | -   | 实际发送内容（JSON），附件只保存描述 |
| options    | Object | -   | 发送参数，重发时使用 |
| status     | Number | 0   | 发送状态（0:成功，1:失败，2:待发送） |
| error      | String | -   | 失败原因 |
| retryCount | Number | 0   | 重试次数 |
| userId     | Number | -   | 发送人 |
| createdAt  | Date   | -   | 创建时间 |
| updatedAt  | Date   | -   | 更新时间 |
