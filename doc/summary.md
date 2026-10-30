### 项目概述

fastify-message 是一个基于 Fastify 框架的消息管理插件，提供模板管理和消息发送功能，支持邮件，并通过 `senders` 扩展短信等渠道。

模板语法基于 [@kne/message-template](https://github.com/kne-union/message-template)（Liquid 白名单子集），与前端 `components-thirdparty:TemplateEditor` 编辑器、预览共用同一套语法与渲染规则。

### 主要特性

- 邮件 / 短信模板管理：新建、修改、删除、复制、启用 / 禁用，系统模板只读
- Liquid 模板语法：变量 `{{ name }}`、原样输出 `{{ name | raw }}`、条件 `{% if %}…{% else %}…{% endif %}`
- 保存与导入前校验语法白名单，非法模板拒绝保存
- 邮件 HTML 模式自动转义变量，短信文本模式不转义
- 模板变量声明（`variables`），预览时使用示例值
- 系统级（目录导入）和业务级（接口创建）模板分类；业务模板启用后覆盖同编码系统模板
- 发送记录追踪（成功 / 失败 / 待发送及失败原因）与发送统计，失败记录可重发
- 支持异步发送与失败重试，SMTP 连接池复用
- 兼容 PostgreSQL、MySQL、SQLite，启动时自动升级表结构

### 安装

```bash
npm install @kne/fastify-message
```

### 基础配置

```javascript
const fastify = require('fastify')();

fastify.register(require('@kne/fastify-message'), {
  name: 'message', // 插件注册名称
  templateDir: path.resolve(__dirname, './messageTemplate'), // 系统模板目录
  emailConfig: {
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'your-email@example.com',
    pass: 'your-password',
    defaultSubject: '系统通知' // 默认邮件主题
  },
  retry: { times: 2, delay: 1000 }, // 发送失败重试次数与间隔（毫秒），默认不重试
  autoUpgrade: true, // 启动时自动补齐表字段与索引、迁移 1.x 模板，默认开启；关闭后需自行调用 services.upgradeSchema()
  isTest: false // 测试模式下不会真实发送邮件
});
```

### 模板格式

模板文件扩展名为 `.liquid`（也支持 `.html`、`.txt`），用注释标记分段：

```html
<!-- subject -->
欢迎加入 {{ appName }}
<!-- description -->
新用户注册成功后发送
<!-- variables -->
[{ "name": "username", "label": "用户名", "example": "张三" }, { "name": "appName", "label": "应用名", "example": "LeapIn" }]
<!-- html -->
<h1>你好，{{ username }}！</h1>
{% if vip %}<p>尊敬的会员，欢迎回来</p>{% else %}<p>欢迎使用 {{ appName }}</p>{% endif %}
```

| 分段 | 说明 |
|----|----|
| subject | 邮件主题（文本模式渲染） |
| description | 模板描述 |
| variables | 变量声明 JSON 数组 `[{ name, label, example }]`，`name` 支持 `a.b` 路径 |
| html | 邮件正文（HTML 模式渲染，变量自动转义） |
| text | 短信正文；邮件中作为纯文本备用正文，缺省时由 html 自动转换 |
| 其它 | 进入 `extra`，按文本模式渲染后传给发送器，如短信服务商的 `templateCode` |

没有任何分段标记时，整个文件作为正文。语法不在白名单内（如过滤器、`for` 循环、`<%= %>`）的文件会被跳过并记录错误日志。

### 模板命名规则

模板文件命名格式：`code_type_name.liquid`

- code: 模板编码
- type: 模板类型（可选，默认为0）
  - 0: 邮件
  - 1: 短信
- name: 模板名称（可选，默认使用code）

示例：`welcome_0_欢迎邮件.liquid`、`verify_1_验证码.liquid`

### 模板选择规则

`sendMessage` 未传 `level` 时，先使用启用中的同编码业务模板（level 1），没有再使用系统模板（level 0）。因此可以在后台把系统模板复制为业务模板（复制后保留编码、默认停用），修改后启用即可替换线上内容；停用业务模板后自动回退到系统模板。停用的模板不能发送。

模板目录中删除的文件，对应的系统模板会在下次启动时被停用（不删除，保留发送记录关联）；文件恢复后需在后台手动启用。

### 使用示例

```javascript
// 发送邮件
await fastify.message.services.sendMessage({
  type: 0, // 0: 邮件
  name: 'recipient@example.com', // 收件人
  code: 'welcome', // 模板编码
  props: { // 模板变量
    username: 'John',
    appName: 'LeapIn'
  },
  options: {
    title: '系统通知', // 发件人名称
    attachments: [] // 附件列表，内容不入库，发送记录只保存文件名等描述
  },
  userId, // 可选，发送人
  async: false // 为 true 时立即返回待发送记录，后台发送
});

// 重发失败记录
await fastify.message.services.record.retry({ id: recordId });

// 导入模板文件
await fastify.message.services.includeTemplate('./messageTemplate');
```

### 从 1.x 升级到 2.0

2.0 将模板引擎从 lodash template（EJS 风格）切换为 Liquid，属于破坏性变更：

1. 模板文件中的 `<%= name %>` 改为 `{{ name }}`，需要输出原始 HTML 的变量改为 `{{ name | raw }}`；`<% if (a) { %>…<% } %>` 改为 `{% if a %}…{% endif %}`
2. 模板文件扩展名由 `.ejs` 改为 `.liquid`（`.ejs` 文件不再导入）
3. 数据库无需手工执行 SQL：启动时（`autoUpgrade` 默认开启）自动为模板表、记录表补齐新字段，把 `code + type + level` 索引改为唯一索引并创建记录 `status` 索引，PostgreSQL / MySQL / SQLite 通用。存在重复编码时跳过唯一索引并输出告警，处理重复数据后重启即可；也可以手动调用 `services.upgradeSchema()`
4. 数据库中已有模板自动迁移（`services.migrateTemplates()`）：1.x 的合并内容拆成 `subject` / `content` / `extra`，`<%= x %>`、`<%- x %>` 改为 `{{ x }}`（2.0 默认转义输出）；含 `<% if %>` 等逻辑语法的模板会跳过并在日志中列出，需在后台人工改写
5. 短信发送器收到的 `content` 为 `{ text, ...extra }`，邮件为 `{ subject, html, text, ...extra }`
6. `sendMessage` 未传 `level` 时会优先使用同编码的启用业务模板；只想用系统模板时显式传 `level: 0`
7. 发送失败在模块内部处理：写入发送记录（`status = 1`，`error` 为原因）、输出错误日志并计入失败统计，`sendMessage` 不会返回 rejected Promise，业务按返回记录的 `status` 判断即可
8. 记录表 `content` 字段类型由 `JSONB` 改为 `JSON`（已有 PostgreSQL 表无需修改）

### 安全提示

`{{ name | raw }}` 会原样输出 HTML，变量来自用户输入时有注入风险，只用于可信内容。发件人名称 `options.title` 会自动去除换行并转义引号。
