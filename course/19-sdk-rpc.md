---
motto: Agent 不只是一个终端程序，它也是一个可以被别的程序调用的部件。
learn:
  - 五种用法：交互、打印、JSON 事件流、RPC、SDK，各自适合谁
  - 进程边界的取舍：语言无关、隔离 vs. 完整的 API、零开销
  - 协议设计：stdout 只放协议；“收下了”不等于“做完了”；按 id 配对；以最终消息为准
  - 分帧：只按 \n 切分，以及“验证文档里的每一条说法”
  - 给 mox 加上 JSON 模式和 RPC 模式；用脚本模型测试集成
prereq: 第 3、7、12 章
time: 50 分钟
build: mox/src/rpc.ts —— mox 的 JSON 事件流与 RPC 模式
---

## 谁在调用 Agent

到目前为止，使用 Agent 的都是坐在终端前的人。可是越来越多的调用者是程序：IDE 插件、CI 流水线、聊天机器人、网页应用、另一个 Agent，还有下一章的评测框架。它们需要的东西不一样：

@pi packages/coding-agent/docs/cli-integration.md#L9-L16

再加上 SDK——直接在自己的进程里使用 Agent 的类和函数，不经过任何进程边界。

| 方式 | 进程边界 | 适合 |
| --- | --- | --- |
| SDK | 没有 | 同一种语言（Node.js）写的宿主，需要完整的 API |
| 打印模式 | 有，一次性 | 脚本、命令替换，只要最后的文字 |
| JSON 事件流 | 有，一次性 | 需要知道过程（工具调用、进度）的一次性任务，比如 CI |
| RPC | 有，长期运行 | 其他语言、需要隔离、需要来回交互的客户端（IDE、自定义界面） |

## SDK：同一个进程

这门课从第 9 章起一直在用 Pi 的 SDK：实验里的 `createPiSession` 就是用 SDK 组装出一个完整的 Pi 会话——模型换成脚本，资源加载器只加载实验自己的扩展，界面换成脚本化的对象：

@code labs/shared/pi-session.ts#createPiSession collapse=true

SDK 的好处是一切都可以直接拿到：订阅事件、插话、在会话树上导航、提供界面和命令的实现。代价是宿主必须是同一种语言，Agent 的崩溃就是宿主的崩溃。

mox 的“SDK”就是它的模块本身：`runLoop`、`Session`、`ExtensionHost`——这门课的每个 mox 实验都是这样直接调用它们的。

## JSON 事件流：一次运行

`mox --mode json -p "任务"` 跑一次，把事件一行一个 JSON 写到 stdout，跑完退出。实验用脚本模型代替真实模型（`MOX_API=scripted`，后文详述）：

@lab node labs/ch19/json.ts

几条规则：

- **stdout 只放协议。** 给人看的提示、日志、错误一律写 stderr。stdout 里混进一行普通文字，读取方的解析就会出错——第 12 章 MCP 服务器的 `console.log` 是同一个问题。mox 在这两种模式下把所有“说给人听”的输出都改到了 stderr。
- **增量只用来显示，以最终消息为准。** `text_delta` 让界面实时显示文字，`message_end` 带着完整的消息。重建时先拼增量，消息结束时用 `message_end` 替换。
- **“这次运行结束”和“不会再动了”是两回事。** 在 Pi 里，`agent_end` 之后还可能有自动重试、压缩后重试、排队的追加任务，`agent_settled` 才表示真正停了。mox 也在最后发一个 `agent_settled`。

## RPC：长期运行的子进程

RPC 模式让 Agent 一直运行，客户端通过 stdin 发命令，从 stdout 读响应和事件。三种记录：

- **命令**：`{"id": "2", "type": "prompt", "message": "构建项目"}`，`id` 可选；
- **响应**：`{"id": "2", "type": "response", "command": "prompt", "success": true, "data": {...}}`，用 `id` 和命令配对；
- **事件**：和 JSON 模式一样，没有 `id`，描述的是会话里发生的事。

最容易误解的是 `prompt` 的响应。Pi 的处理：

@pi packages/coding-agent/src/modes/rpc/rpc-mode.ts#L394-L413

响应在预检（模型可用、输入合法……）通过后就发出，说明这条提示**被收下了**：开始运行、排进了队列、或者被扩展命令直接处理了（`disposition` 字段区分这几种情况）。它**不**表示运行完成。完成要等 `agent_settled` 事件。

mox 的实现：

@code mox/src/rpc.ts#startRpc collapse=true

一个完整的会话，左边的箭头 `→` 是客户端发出的，`←` 是 mox 发回的：

@lab node labs/ch19/rpc.ts

逐条看：第二条提示到达时 mox 正在运行，于是它作为插话排队（`queued`，第 3 章），在下一轮被模型看到并回答；写坏的命令得到一个 `parse` 错误响应，mox 继续运行；客户端关闭 stdin 是“请退出”的信号，mox 等当前运行结束后正常退出。

Pi 提供了一个类型化的客户端 `RpcClient`，它负责启动子进程、按 `id` 配对响应、把事件分发给监听者。一个细节值得学：

@pi packages/coding-agent/src/modes/rpc/rpc-client.ts#L513-L517

**先**开始收集事件，**再**发送提示。顺序反过来的话，一个很快就完成的运行可能在监听器装上之前就结束了，客户端永远等不到 `agent_settled`。

## 分帧：只按 \n 切

“一行一条 JSON”听起来没什么可说的，但“行”的定义并不统一。Pi 的读取代码专门写了一个按 `\n` 切分的读取器：

@pi packages/coding-agent/src/modes/rpc/jsonl.ts#L14-L58

两个细节：`StringDecoder` 处理被拆在两个数据块里的多字节字符（第 2、12 章的老问题）；只认 `\n`，因为 JSON 字符串里可以原样出现 U+2028、U+2029 这两个 Unicode 分隔符，`JSON.stringify` 不会转义它们。代码注释说 Node.js 的 readline 也会在这两个字符处断行。这句话值得验证一下：

@lab node labs/ch19/framing.ts

在 Node 22 上，readline 并没有在 U+2028 处断行——注释描述的可能是旧版本的行为。但 Python 的 `str.splitlines()` 确实会，用它写客户端就会把一条记录切成两半。两点启示：

1. 规则本身是对的：**只按 `\n` 切分**，不管用什么语言、什么库，都不要依赖“读一行”的默认含义。
2. **文档和注释也会过时。** 读源码时看到的每一条说法，能验证的就动手验证。

## 用脚本模型测试集成

RPC 和 JSON 模式的实验都用了 `MOX_API=scripted MOX_SCRIPT=labs/ch19/script.ts`：mox 不调用任何模型服务，而是由脚本决定每次的回复。这和 Pi 的 faux 模型是同一个思路。集成测试要验证的是协议、事件顺序、进程生命周期、取消、错误处理——这些都和模型说了什么无关，用脚本模型可以做到确定、快速、不花钱。下一章的评测则反过来：关心的正是真实模型的表现。

::: compare Claude Code
- **打印模式**：`claude -p "任务"`；`--output-format json` 输出一个包含结果和用量的 JSON，`stream-json` 输出事件流；`--input-format stream-json` 可以从 stdin 持续输入消息。
- **Agent SDK**：TypeScript 和 Python 的 SDK，把 Claude Code 的整套能力（工具、权限、钩子、子 Agent、MCP、会话）嵌进自己的程序；可以用 `canUseTool` 回调自己实现权限审批（第 14 章）。
- 在 CI 里运行时，通常配合 `--allowedTools` 之类的参数预先放行需要的工具（第 14 章说的“无人值守”）。

文档：[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 要把一个 Agent 集成进 IDE / CI / Web 应用，有哪些方式？怎么选？
- **SDK**（进程内）：宿主是同一种语言，需要完整的 API 和零开销；代价是没有隔离，语言绑定。
- **打印模式**：脚本里只要最终文字。
- **JSON 事件流**：一次性任务需要过程信息（工具调用、进度、用量），比如 CI。
- **RPC**（长期运行的子进程）：其他语言、需要隔离、需要多轮交互和控制（插话、取消、切换模型）的客户端，比如 IDE 插件。
- 选择的关键是：要不要进程边界（隔离、语言无关）、一次性还是长期、需要多少控制。
:::

::: interview 设计一个 Agent 的 RPC 协议，要注意哪些问题？
- 记录分三类：命令、响应（带 id 配对）、事件（会话活动，不带 id）。
- 响应只表示命令被收下；运行完成要用事件表示（并区分“一次运行结束”和“不会再自动继续”）。
- 运行中收到新提示怎么办：排队、插话还是拒绝，要在响应里说明。
- 错误：命令失败返回失败响应；无法解析的输入返回解析错误，不能让进程崩溃。
- 分帧：严格的 JSONL，只按 `\n` 切，处理多字节字符；stdout 只放协议，日志走 stderr。
- 生命周期：关闭 stdin 表示退出；处理子进程意外退出、背压。
- 交互式的子协议：扩展要弹对话框时，怎么把请求转给客户端、等它回答。
- 客户端先订阅事件，再发送请求，避免竞态。
:::

::: interview 客户端怎样从事件流里重建一条正在生成的消息？
用增量事件（文本增量、工具参数增量）实时拼出显示内容；收到消息结束事件时，用其中完整的消息替换拼出来的结果——以最终消息为准，因为增量可能被截断、重试，或者经过了修复（第 2 章：工具参数的增量只能用来预览）。对每条消息按 id 或顺序归档，处理“运行结束后还会继续”（重试、压缩、追加任务）的情况。
:::

::: interview 不调用真实模型，怎样测试 Agent 的集成？
用一个脚本化的模型（Pi 的 faux 模型、mox 的 scripted）：根据请求内容返回预先写好的回复和工具调用，仍然走真实的流式事件路径。这样可以确定、快速、免费地测试协议、事件顺序、工具执行、取消、错误恢复、进程生命周期。脚本模型测不了“模型会不会这样做”，那是评测（evals）的工作。
:::
