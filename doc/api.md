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
