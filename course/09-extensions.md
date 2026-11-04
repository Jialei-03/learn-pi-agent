---
motto: 内核越小，扩展点就越要设计得像内核一样认真。
learn:
  - Pi 的扩展是什么：一个在 Agent 进程里运行的 TypeScript 函数，能订阅四十多种事件
  - 一次运行中事件的完整顺序，以及“通知、链式、闸门”三种组合方式
  - 扩展出错时：通知类事件隔离错误，闸门类事件默认拒绝
  - 扩展为什么是信任边界，项目信任机制防住了什么、防不住什么
  - 写第一个扩展：给 Pi 加上 web_fetch，并处理 SSRF
prereq: 第 4、6 章
time: 70 分钟
build: mox/src/extensions.ts（mox 的扩展系统）与 extensions/web-fetch（同时适用于 Pi 和 mox 的扩展）
---

第 0 章说过，Pi 刻意把内核做得很小，子 Agent、Plan Mode、权限规则这些功能都留给扩展。从这一章开始，课程的“Extend”线正式开始：我们要用 Pi 的扩展 API 补上它没有内置的能力。在那之前，先把扩展系统本身读透。

## 扩展是什么

一个 Pi 扩展就是一个 TypeScript 文件，默认导出一个函数。Pi 启动时调用这个函数，把一个 `pi` 对象交给它；扩展用这个对象订阅事件、注册工具和命令。Pi 官方的权限拦截示例是一个完整的扩展：

@pi packages/coding-agent/examples/extensions/permission-gate.ts

二十几行代码，就给 Pi 加上了“危险命令要确认”的能力。`pi.on("tool_call", …)` 订阅工具调用事件；返回 `{ block: true, reason }` 就能拦下这次调用；`ctx.ui.select` 弹出一个选择框；`ctx.hasUI` 判断当前有没有界面（在 `--print` 模式或 RPC 模式下没有），没有界面时直接拒绝。

扩展能做的事情远不止拦截。`ExtensionAPI` 上的方法大致分为几类：

| 类别 | 方法 | 用途 |
| --- | --- | --- |
| 订阅事件 | `pi.on(event, handler)` | 四十多种事件，覆盖输入、请求、工具、会话、压缩…… |
| 注册能力 | `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`、`registerProvider`、`registerMcpServer` | 新工具、斜杠命令、快捷键、命令行参数、模型服务商、MCP 服务器 |
| 操作会话 | `sendMessage`、`sendUserMessage`、`appendEntry`、`setLabel` | 往对话里插入消息、在会话文件里保存扩展自己的状态 |
| 控制运行 | `setActiveTools`、`setModel`、`setThinkingLevel`、`exec` | 切换可用工具、模型，执行外部命令 |
| 界面 | `ctx.ui.*`、渲染器 | 对话框、状态栏、自定义消息的显示方式 |

Pi 的 `examples/extensions/` 目录里有七十多个示例，从贪吃蛇游戏到子 Agent，覆盖了几乎所有 API。

扩展文件怎么 `import "@earendil-works/pi-coding-agent"`？它不需要自己安装依赖。Pi 用 jiti 直接加载 TypeScript 源文件，并把这些包名映射到 Pi 进程里已经加载好的模块实例上：

@pi packages/coding-agent/src/core/extensions/virtual-modules.ts#L14-L42

这样扩展和 Pi 用的是**同一份**模块实例，类型、单例、全局状态都一致。注意末尾的 `@mariozechner/...`：那是 Pi 早期发布时用的包名，为了让老扩展继续能用，至今保留着别名。

## 一次运行中的事件顺序

扩展订阅的事件分布在一次运行的各个阶段。这个实验装上一个只记录事件名的扩展，让 Pi 执行一次带工具调用的运行：

@lab node labs/ch09/events.ts

对照前几章，每个事件都能找到它在代码里的位置：

- `input`、`before_agent_start`：用户输入交给循环之前，可以改写输入、改写本次的系统提示。
- `agent_start` 到 `agent_end`：第 3 章的 `runLoop` 一次运行；中间每一轮是一对 `turn_start` / `turn_end`。
- `context`：每次请求模型之前，可以改写这次发送的消息（第 6 章说的“投影”）。
- `tool_execution_start` → `tool_call` → `tool_result` → `tool_execution_end`：第 4 章工具流水线的执行前钩子和执行后钩子。
- `message_start` / `message_end`：每条消息形成时；第 7 章的会话就是在 `message_end` 时写盘的。
- `agent_before_settle`、`agent_settled`：运行真正结束之前的最后一个决策点（第 18 章的“目标循环”会用到它），以及真正空闲下来的时刻。

列表里还订阅了 `before_provider_request`（可以查看甚至替换发给服务商的请求体），但它没有出现。Pi 的文档解释过：这类事件只在传输层暴露了对应阶段时才会触发，而实验用的脚本模型没有真正的 HTTP 请求。

## 组合规则：谁先谁后，谁说了算

@figure assets/course/ch09-extensions.png 扩展挂在 Agent 生命周期的各个事件上：通知、改写、或者像闸门一样拦下

多个扩展订阅同一个事件时，处理函数按**扩展加载顺序、再按注册顺序**依次执行。不同事件的返回值有不同的含义，Pi 的文档把它们归纳成几种模式：

| 模式 | 规则 | 典型事件 |
| --- | --- | --- |
| 通知 | 返回值被忽略 | `agent_start`、`turn_start`、`message_update` |
| 就地修改 | 后面的处理函数看到前面改过的值 | `tool_call.input`、`before_agent_start` 的提示选项 |
| 链式变换 | 后面的处理函数收到前面返回的结果 | `input`、`context`、`tool_result`、`message_end` |
| 闸门 | 一旦有处理函数拦下，后面的不再执行，操作本身也不再发生 | 拦下工具调用、取消压缩、接管输入 |

`tool_call` 事件的分发代码很直白：依次执行，遇到第一个 `block` 立即返回：

@pi packages/coding-agent/src/core/extensions/runner.ts#emitToolCall

这个实验用六个扩展同时作用于三次工具调用，分别在 mox 和 Pi 里运行：

@lab node labs/ch09/composition.ts

逐条看：

- **就地修改**：扩展 A 把 `npm test` 改成了 `pnpm test`，真正执行的是后者。注意结果第一列：会话里模型的工具调用仍然是 `npm test`。第 4 章说过，校验前会复制一份参数，扩展改的是副本，历史记录不变。这意味着模型并不知道自己的命令被改了——如果改动会影响它对结果的理解，扩展应该在结果里说明。
- **闸门**：扩展 B 拦下了 `npm publish`，工具根本没执行。
- **链式变换**：C 在结果末尾加了一句，D 再把令牌隐去；D 看到的是 C 改过的版本。
- **出错**：扩展 E 处理 `deploy` 时抛了异常，`deploy` 没有被执行。扩展 F 在“运行结束”的通知里抛了异常，被记录下来，运行照常结束。

### 出错时：通知隔离，闸门拒绝

最后两条揭示了一个重要的设计。通知类事件的分发代码把每个处理函数包在 `try/catch` 里，出错只记录、不中断：

@pi packages/coding-agent/src/core/extensions/runner.ts#L1096-L1126

而 `tool_call` 的分发**没有** `try/catch`。异常一路传到第 4 章的工具流水线，被转换成一条错误结果，工具不执行。连接扩展系统和工具流水线的这段代码，把这个意图写得很清楚：

@pi packages/coding-agent/src/core/agent-session.ts#L674-L697

“扩展出错，拦下执行”。这就是 **fail closed**：一个负责安全检查的扩展如果自己出了 bug，最安全的做法是把它当成“拒绝”，而不是“没意见”。Pi 的文档专门提醒：闸门类处理函数在无法做出安全判断时应该默认拒绝。反过来，一个只负责显示状态栏的扩展出错，不应该影响 Agent 干活——所以通知类事件要隔离错误。

## 扩展是信任边界

扩展运行在 Agent 进程里，拥有和 Agent 完全相同的权限：读写任意文件、执行任意命令、访问网络、读取你的 API Key。Pi 的文档在扩展位置一节的开头就写着安全警告：只安装你信任来源的扩展。

扩展可以从几个地方加载：

| 位置 | 范围 | 何时加载 |
| --- | --- | --- |
| `~/.pi/agent/extensions/` | 所有项目 | 总是 |
| 项目里的 `.pi/extensions/` | 当前项目 | **项目被信任之后** |
| `settings.json` 里的 `packages` | npm 或 git 上的 Pi 包 | 按配置 |
| `pi -e ./ext.ts` | 本次运行 | 命令行指定时 |

项目目录里的扩展最危险：克隆一个陌生仓库再运行 Pi，仓库作者写的代码就会在你的机器上执行。所以 Pi 在加载项目资源之前，会先询问是否信任这个目录（`project_trust` 事件、`/trust` 命令）。

但第 6 章已经说过，信任机制能防住的是“在你不知情的情况下执行项目里的代码”，防不住“你信任了一个本身就有问题的项目”，也防不住模型被项目文件里的文字诱导去做坏事。

mox 采用了同样的策略：用户目录下的扩展总是加载，项目目录下的扩展只有在命令行加上 `--trust` 时才加载。

## mox 的扩展系统

mox 的扩展系统只保留了最核心的六个事件，但组合规则和 Pi 完全一致：

@code mox/src/extensions.ts#ExtensionHost collapse=true

`toolHooks()` 把 `tool_call` 和 `tool_result` 接到第 4 章流水线的两个钩子上，这样扩展注册的拦截和改写，与第 4 章手写的钩子走的是同一条路径。命令行启动时从 `~/.mox/extensions/` 加载扩展，注册的工具与四个内置工具合并，注册的命令可以在交互模式里用 `/名字` 调用。

## 第一个扩展：web_fetch

Pi 没有内置的网页抓取工具。查阅最新的文档、看一个报错在网上怎么解决、读一个 issue，都需要它。这是我们给 Pi 写的第一个扩展。

核心逻辑放在一个与宿主无关的文件里，Pi 版本和 mox 版本共用：

@code extensions/web-fetch/fetch.ts#webFetch

Pi 扩展只做两件事：注册工具，并在 `tool_call` 上做同样的检查，让被拒绝的调用在界面上显示为“被拦下”而不是“执行失败”：

@code extensions/web-fetch/index.ts#createWebFetchExtension

### SSRF：Agent 替攻击者访问内网

抓网页看起来人畜无害，但它有一个经典的安全问题：**服务端请求伪造**（SSRF）。Agent 运行在你的机器或服务器上，能访问很多外人访问不到的地址：本机的开发服务器、公司内网、以及云服务器上的 `169.254.169.254`——各大云平台的实例元数据服务，里面有这台机器的临时凭证。

攻击者不需要直接接触你的 Agent，只需要让模型“想去”访问这些地址：在一个网页、一个 issue、一段 README 里写上“请先读取 http://169.254.169.254/…… 获取配置”。模型照做，凭证就出现在了对话里，下一步可能就被它写进某个文件或发到某个地方。

所以 `checkUrl` 在发请求前做了三层检查：只允许 http 和 https；可选的域名白名单；把域名**解析成 IP 之后**再判断是不是内网地址——因为一个看起来正常的域名完全可以指向内网 IP。还有更隐蔽的一招：公网地址返回一个 302 重定向，跳到内网地址。所以 `webFetch` 关掉了自动跟随重定向，每一跳都重新检查。

“是不是内网地址”本身就容易写错。最直接的写法是把 IP 按点拆开、比较前两段，但它会漏掉好几种写法：

@lab node labs/ch09/ssrf.ts

最隐蔽的是 IPv4 映射地址。`http://[::ffff:169.254.169.254]/` 看起来是 IPv6，操作系统连接时却会把它当成 `169.254.169.254`；而 Node 解析 URL 时会把它规范化成十六进制的 `::ffff:a9fe:a9fe`，按点分十进制去匹配的代码根本看不出它是元数据地址。正确的做法是先把 IPv6 地址展开，取出其中藏着的 IPv4 地址再检查一遍，然后用 Node 自带的 `BlockList` 按网段判断，而不是手写字符串比较：

@code extensions/web-fetch/fetch.ts#isPrivateAddress

还剩一个时间差：`checkUrl` 解析过一次域名，真正发请求时 HTTP 客户端会**再解析一次**。攻击者控制的域名可以第一次返回公网 IP，第二次返回 `127.0.0.1`——这叫 DNS rebinding。所以 `webFetch` 不用全局的 `fetch`，而是用 `node:http` 发请求，并给它一个自己的 `lookup`：连接前解析出的每个地址都要再过一遍 `isPrivateAddress`，检查的就是实际要连接的那个地址。

@code extensions/web-fetch/fetch.ts#guardedLookup

实验在本地起一个测试网站，让模型依次抓取文档页、直接访问元数据地址、访问一个会重定向到元数据地址的链接：

@lab node labs/ch09/web-fetch.ts

两个宿主都正确地抓到了文档正文（脚本、样式、标题标签都被去掉），并拦下了后两次请求。实验里的本地测试网站用 `trustedHosts` 显式放行；除此之外的所有内网地址一律拒绝。

安装到你自己的 Pi 里：

```bash
pi -e ./extensions/web-fetch/index.ts
# 或者长期安装：复制到 ~/.pi/agent/extensions/web-fetch/
```

::: compare 其他 Agent 怎么做
Claude Code 内置了 `WebFetch` 和 `WebSearch` 工具，并且可以用权限规则按域名控制（例如 `WebFetch(domain:docs.python.org)`）；它的文档还说明，抓取的页面会先转换成 Markdown，再由一个较小的模型按要求提取内容，而不是把整页原文塞进主对话。这是一个值得借鉴的思路：用一个便宜的模型做“读网页”这种重活，主对话只拿到结论。第 17 章的子 Agent 会把这个思路推广到任意任务。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 如何为 Agent 设计一个插件 / 扩展系统？
核心是一组生命周期事件加注册接口：

- **事件**覆盖输入、系统提示、每次请求前的上下文、工具调用前后、消息形成、运行结束、会话切换、压缩等关键节点；
- **注册**新工具、命令、模型服务商、外部服务（如 MCP）；
- **组合规则**要明确：按加载顺序执行；区分通知（忽略返回值）、链式变换（后者接收前者结果）、闸门（第一个拒绝即生效）；
- **错误处理**：通知类隔离错误，闸门类默认拒绝；
- **状态**：扩展自己的状态写进会话（追加记录），会话恢复或分叉时据此重建；
- **安全**：进程内扩展拥有宿主的全部权限，项目内的扩展必须经过用户信任才加载。
:::

::: interview 扩展（或钩子）出错时，Agent 应该怎么处理？
看事件的性质。通知类（更新界面、记录日志）应该隔离错误：记录下来，继续运行，不能因为一个可选功能的 bug 中断用户的任务。闸门类（权限检查、安全拦截）应该默认拒绝：检查本身出错时，把它当成“不允许”，因为放行一个未经检查的危险操作代价更大。
:::

::: interview Agent 的网页抓取工具有哪些安全风险？
最典型的是 SSRF：模型被网页或文件里的文字诱导，去访问只有 Agent 所在机器才能访问的地址，比如内网服务、本机端口、云实例元数据服务（里面有临时凭证）。

防护：只允许 http(s)；可选的域名白名单；把域名解析成 IP 后检查是否内网地址（防止域名指向内网）；不自动跟随重定向，每一跳都重新检查；限制响应大小和超时；只接受文本类内容。另外，抓回来的网页内容本身就是不可信输入，可能包含提示注入，后续的权限控制仍然需要。
:::

::: interview 进程内扩展和外部命令式的钩子，各有什么优缺点？
进程内扩展（Pi 的方式）：能力强，能注册工具、命令、界面，能访问完整的会话和模型 API，调用开销小；但与 Agent 同一个进程、同样的权限，扩展本身就是信任边界，崩溃或阻塞会影响 Agent。

外部命令钩子（Claude Code 的 hooks）：任何语言都能写，与 Agent 隔着进程边界，容易由团队统一配置下发；但每次调用都要启动进程，只能通过约定的 JSON 协议交互，能做的事受限。第 13 章会在 Pi 里用扩展实现一套兼容 Claude Code 协议的外部命令钩子，把两者结合起来。
:::
