
# fastify-message


### 描述

管理消息发送，支持sms消息，email消息等


### 安装

```shell
npm i --save @kne/fastify-message
```


### 概述

### 项目概述

fastify-message 是一个基于 Fastify 框架的消息管理插件，提供了模板管理和消息发送功能。目前支持邮件发送，并预留了短信发送的扩展接口。

### 主要特性

- 支持邮件模板管理
- 支持模板变量替换
- 支持 HTML 和纯文本邮件格式
- 支持邮件发送记录追踪
- 支持系统级和业务级模板分类
- 支持模板状态管理（启用/禁用）

### 安装

```bash
npm install fastify-message
```

### 基础配置

```javascript
const fastify = require('fastify')();

fastify.register(require('fastify-message'), {
  name: 'message', // 插件注册名称
  emailConfig: {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'your-email@example.com',
    pass: 'your-password',
    defaultSubject: '系统通知' // 默认邮件主题
  },
  isTest: false // 测试模式下不会真实发送邮件
});
```

### 模板格式

模板文件使用 EJS 语法，支持以下特殊注释标记来区分不同部分：

```html
<!-- subject -->
邮件主题

<!-- html -->
<h1>你好，<%= username %>！</h1>
<div><%= content %></div>
```

### 模板命名规则

模板文件命名格式：`code_type_name.ejs`

- code: 模板编码
- type: 模板类型（可选，默认为0）
  - 0: 邮件
  - 1: 短信
- name: 模板名称（可选，默认使用code）

示例：`welcome_0_欢迎邮件.ejs`

### 使用示例

```javascript
// 发送邮件
await fastify.message.services.sendMessage({
  type: 0, // 0: 邮件
  name: 'recipient@example.com', // 收件人
  code: 'welcome', // 模板编码
  props: { // 模板变量
    username: 'John',
    content: 'Welcome to our platform!'
  },
  options: {
    title: '系统通知', // 发件人名称
    attachments: [] // 附件列表
  }
});

// 导入模板文件
await fastify.message.services.includeTemplate('./templates');
```


### 示例

#### 示例代码



### API

### 服务方法 (Services)

#### includeTemplate
从指定目录导入模板文件到数据库。

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| dir | String | 是 | 模板文件目录路径 |

| 返回值 | 类型 | 描述 |
|--------|------|------|
| - | Promise<void> | 无返回值 |

示例：
```javascript
await fastify.message.services.includeTemplate('./templates');
```

#### messageTemplate
根据模板编码和参数生成消息内容。

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| code | String | 是 | - | 模板编码 |
| type | Number | 否 | 0 | 模板类型（0:邮件） |
| level | Number | 否 | 0 | 模板级别 |
| props | Object | 是 | - | 模板变量 |

| 返回值字段 | 类型 | 描述 |
|------------|------|------|
| content.subject | String | 邮件主题 |
| content.html | String | HTML内容 |
| content.text | String | 纯文本内容 |
| props | Object | 模板变量 |
| code | String | 模板编码 |
| type | Number | 模板类型 |
| templateId | Number | 模板ID |

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

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| text | String | 是 | 模板文本内容 |

| 返回值字段 | 类型 | 描述 |
|------------|------|------|
| subject | String | <!-- subject --> 标记内容 |
| html | String | <!-- html --> 标记内容 |
| text | String | <!-- text --> 标记内容（可选） |

#### sendMessage
发送消息（邮件/短信）。

| 参数 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| type | Number | 否 | 0 | 消息类型（0:邮件） |
| name | String | 是 | - | 接收者（邮件地址/手机号） |
| props | Object | 是 | - | 模板变量 |
| code | String | 是 | - | 模板编码 |
| level | Number | 否 | 0 | 模板级别 |
| client | Object | 否 | - | 客户端配置（覆盖默认配置） |
| options | Object | 否 | - | 发送选项 |

options 参数详情：

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| title | String | 否 | 发件人名称 |
| subject | String | 否 | 邮件主题 |
| attachments | Array | 否 | 附件列表 |

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

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| id | Number | - | 主键 |
| code | String | - | 模板编码 |
| type | Number | 0 | 模板类型 |
| name | String | - | 模板名称 |
| content | String | - | 模板内容 |
| level | Number | 0 | 模板级别 |
| status | Number | 1 | 模板状态（1:启用） |
| createdAt | Date | - | 创建时间 |
| updatedAt | Date | - | 更新时间 |

#### Record 模型

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| id | Number | - | 主键 |
| type | Number | - | 消息类型 |
| code | String | - | 模板编码 |
| templateId | Number | - | 模板ID |
| props | Object | - | 模板变量 |
| name | String | - | 接收者 |
| content | Object | - | 发送内容 |
| status | Number | 1 | 发送状态 |
| createdAt | Date | - | 创建时间 |
| updatedAt | Date | - | 更新时间 |

