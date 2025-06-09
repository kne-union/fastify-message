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
