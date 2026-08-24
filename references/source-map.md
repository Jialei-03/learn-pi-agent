# Pi 源码地图：先找到主干

源码地图的作用不是一次展示所有目录，而是帮你回答第一个工程问题：**一次 coding agent 交互大致跨过哪些层？**

本文所有 Pi 链接固定到 commit `086c32e74530564922d011ade23ff582c9d63116`。如果你阅读最新 `main`，目录和职责可能已经变化，请先看[版本基线](version-baseline.md)。

![Pi 主要包的职责与依赖方向](../assets/diagrams/pi-package-map.svg)

## 第一层：五个需要先认识的包

| 源码入口 | 初学者可以先记住的一句话 | 暂时不要误解为 |
| --- | --- | --- |
| [`packages/ai`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/ai) | 统一多供应商模型 API、消息、工具与流式事件 | 它不是完整 Agent，也不负责直接执行编码工具 |
| [`packages/agent`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/agent) | Agent runtime：维护运行状态，组织模型调用、工具调用和事件 | 它不是完整 CLI 产品界面 |
| [`packages/coding-agent`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent) | 面向编码场景的产品运行层，装配会话、工具、资源和交互 | 它不等于底层模型 Provider |
| [`packages/tui`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/tui) | 终端 UI 与差分渲染能力 | UI 显示的事件不是模型直接控制终端 |
| [`packages/telemetry`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/telemetry) | 供应商中立的遥测契约、适配与类型 | 可观测性本身不会保证任务正确 |

可以先把主依赖方向理解成：

```text
模型供应商
    ↑ 请求与流式响应
pi-ai
    ↑ 统一消息、模型与工具类型
pi-agent-core
    ↑ Agent 状态、事件与工具循环
pi-coding-agent
    ↙                 ↘
 pi-tui            编码工具 / 资源 / 会话

pi-telemetry 从关键边界观察运行，但不是主控制链。
```

箭头表达“上层调用下层、响应向上返回”的学习视角，不是完整的构建依赖图。

## 第二层：先读九个关键入口

### 1. 模型世界的类型：`pi-ai/src/types.ts`

打开 [`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/ai/src/types.ts)，先搜索这些概念：Message、Content、Tool、Context、Stream Event。

阅读目标不是记住所有联合类型，而是看出模型边界需要表达哪些事实：谁发的消息，消息包含文字还是工具请求，工具结果如何关联，响应为何可以增量到达。

### 2. Agent 世界的类型：`pi-agent-core/src/types.ts`

打开 [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/types.ts)，观察 AgentMessage、AgentTool、AgentEvent、AgentLoopConfig 等类型如何在模型消息之外增加运行所需的信息。

一个重要阅读问题是：哪些类型要传给模型，哪些只存在于宿主程序？两者不一定相同。

### 3. 低层循环：`agent-loop.ts`

打开 [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/agent-loop.ts)，搜索 `runAgentLoop`、`runLoop`、`streamAssistantResponse` 和 `executeToolCalls`。

这个固定版本体现了几件关键事实：

- 循环内部主要使用 `AgentMessage[]`，到 LLM 调用边界才转换为模型可接受的 `Message[]`；
- 循环发出 agent、turn、message、tool execution 等事件，界面可以消费这些事件；
- assistant 响应中出现 tool call 后，宿主执行工具并把结果追加到上下文；
- 循环还处理停止、错误、中止、steering 与 follow-up，并非只有一条永远成功的 happy path。

### 4. coding-agent 会话树：`session-manager.ts`

打开 [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/session-manager.ts)，搜索 `SessionEntry`、`leafId`、`getBranch`、`buildContextEntries` 与 `buildSessionContext`。

这条路径说明本地 coding-agent 怎样把 JSONL Entry 组织成追加写入的消息树，再从当前叶子投影出恢复后的活动消息。完整文件历史、活动分支与本轮 Context 是三个不同集合。

### 5. Durable Harness 的 API 骨架与目标规范

打开 [`packages/agent/src/harness/agent-harness.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/harness/agent-harness.ts)，先确认固定 commit 的实现状态：`AgentHarness.create()` 尚不能恢复已有记录，`prompt()`、`resume()`、`abort()` 等路径会抛出 `HarnessNotImplemented`。[`packages/coding-agent/src/server/create-harness.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/server/create-harness.ts) 负责装配 Tool 与 System Prompt，但调用的仍是这套 scaffold。

再阅读标题标明 **implementation specification** 的 [`packages/agent/docs/harness.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/docs/harness.md)。这里的 Session、Lane、完整 Operation State、effect sandwich 与 replay policy 是目标设计：它说明 Durable Harness 应怎样识别已确认状态、未确认副作用与安全重放边界，不能当成当前固定源码已经具备的运行行为。

### 6. MCP 适配入口：`extensions.md` 与 Tool 类型

固定版本的 Pi 没有内置 MCP Client；接入点位于 coding-agent Extension。先看 [`packages/coding-agent/docs/extensions.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/extensions.md) 中的 `pi.registerTool(...)`、动态工具与 `session_shutdown`，再对照 [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/types.ts) 的 `AgentTool`、[`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/ai/src/types.ts) 的 `ToolResultMessage`，确认 MCP Tool 的 Schema、内容块、异常和取消信号怎样跨越两套类型边界。

### 7. 工作方法怎样进入 Context：`skills.ts` 与 `prompt-templates.ts`

[`packages/coding-agent/src/core/skills.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/skills.ts) 负责发现 Skill、解析 `name` 与 `description`，并生成 system prompt 中的 `<available_skills>` 索引；[`system-prompt.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/system-prompt.ts) 决定何时装入这份索引。再读 [`agent-session.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session.ts) 的 `_expandSkillCommand()` 与 [`prompt-templates.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/prompt-templates.ts)，区分模型通过 `read` 激活 Skill、用户显式展开 `/skill:name`，以及 Prompt Template 在模型调用前做字符串替换的三条路径。

### 8. 扩展点怎样被加载与串联：`extensions`、`resource-loader.ts` 与 `package-manager.ts`

先用 [`packages/coding-agent/docs/extensions.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/extensions.md) 建立 Extension API 与事件地图，再进入 [`extensions/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/extensions/types.ts)、[`extensions/loader.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/extensions/loader.ts) 和 [`extensions/runner.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/extensions/runner.ts)，分别观察类型边界、factory 注册和 Handler 串联。最后结合 [`resource-loader.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/resource-loader.ts) 的 project trust / reload 顺序与 [`package-manager.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/package-manager.ts) 的 npm、Git、本地来源及过滤规则，区分“运行时扩展点”和“资源分发单元”。

### 9. 把 Pi 嵌入 Workflow：`sdk.md` 与 `AgentSession`

[`packages/coding-agent/docs/sdk.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/sdk.md) 说明应用怎样通过 `createAgentSession()`、`ModelRuntime` 与 `SessionManager` 创建 Pi Agent 节点。`session.prompt()` 等待一次完整 Agent Run，`session.messages` 暴露消息状态，`subscribe()` 提供生命周期与流式事件，`session.abort()` 与 `session.dispose()` 分别承接取消和资源清理；这些接口让外层 Workflow 保留业务步骤、并发、批准与副作用控制，同时把开放性调查交给 Pi 的 Agent Loop。不同 Workflow Node 使用独立的内存 Session 时，共享信息应通过显式输入传递。

### 第 12 章的 Planning 与 Reasoning 源码锚点

模型推理的统一表示位于 [`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/ai/src/types.ts)：`ThinkingLevel` 是请求强度，`ThinkingContent` 是 Provider 返回后统一的内容块，`Usage.reasoning` 是供应商能够报告时的 token 统计。[`packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/agent.ts) 把 Agent State 中的 `thinkingLevel` 映射进模型请求。

Pi Coding Agent README 明确说明核心不内置 Plan Mode，但仓库的 [`examples/extensions/plan-mode`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/plan-mode) 展示了扩展式实现：用 `setActiveTools()` 切换工具、在 `tool_call` 阶段拦截非只读 Bash、通过 `before_agent_start` 注入模式上下文，并用 Extension State 与 UI 保存计划进度。这正好说明“模型生成计划”和“产品真正限制、批准并执行计划”属于不同工程层。

### 第 13 章的 Agent SDK 与应用集成源码锚点

[`packages/coding-agent/src/core/sdk.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/sdk.ts) 定义 `CreateAgentSessionOptions` 与 `createAgentSession()` 的真实装配顺序：目录、`ModelRuntime`、模型、Tool Allowlist、`ResourceLoader`、`SessionManager` 和 `SettingsManager` 在这里汇合。[`packages/coding-agent/src/core/agent-session.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session.ts) 则给出应用最常接触的运行边界：`prompt()`、`subscribe()`、`messages`、`abort()`、`dispose()` 以及 Session 级事件。

模型与认证目录由 [`model-runtime.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/model-runtime.ts) 集中管理；新建、切换、分叉和导入 Session 时，活跃对象替换逻辑位于 [`agent-session-runtime.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session-runtime.ts)。配合 [`examples/sdk`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/sdk) 阅读，可以验证内存/持久化 Session、工具选择、完整控制与运行时替换的公开用法。

### 第 14 章的 Multi-Agent 与 A2A 源码锚点

Pi Coding Agent README 的 [Philosophy](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/README.md) 明确说明核心不内置 Subagent；同一仓库的 [`examples/extensions/subagent`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/subagent) 则展示一种可选实现。[`agents.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/subagent/agents.ts) 从用户级或项目级 Markdown 发现 Agent 定义；[`index.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/subagent/index.ts) 注册 `subagent` Tool，为任务启动独立 `pi --mode json -p --no-session` 进程，并实现 single、parallel、chain、流式更新、并发限制、结果截断和取消传播。

A2A 不属于 Pi 固定源码。第 14 章使用 [A2A 1.0.0 Specification](https://a2a-protocol.org/v1.0.0/specification/) 与固定仓库 commit [`16ba52690519bf55b9388e34d4db356efa88aa51`](https://github.com/a2aproject/A2A/tree/16ba52690519bf55b9388e34d4db356efa88aa51) 定义跨系统边界；将 Pi 暴露为 A2A Server 时，需要在 `AgentSession` 外另写 Agent Card、Task Store、协议操作、认证和事件映射 Adapter。

### 第 15 章的 Sandbox、Code Agent 与 Computer Use 源码锚点

Pi 根目录 [README 的 Security 段落](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/README.md) 是本章的权限起点：固定版本没有限制文件、进程、网络和凭据访问的内置权限系统，默认继承启动 Pi 的用户与进程权限。[`createCodingTools()`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/tools/index.ts) 组合默认 `read`、`bash`、`edit` 与 `write`；[`path-utils.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/tools/path-utils.ts) 说明 `cwd` 是相对路径的解析起点，绝对路径不会被自动收回工作区。

[`bash.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/tools/bash.ts) 展示本地命令怎样以 `cwd`、进程环境与 `AbortSignal` 启动，并提供可替换的 `BashOperations`；[Environment Variables 文档](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/environment-variables.md) 列出 Provider Key 和默认传给 Bash 的 `PI_*` 会话变量。`permission-gate.ts` 与 `protected-paths.ts` 展示 Extension Policy Gate，但字符串或路径规则仍依赖已知 Tool 路径，不能替代操作系统隔离。

[Containerization 文档](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/containerization.md) 区分“整个 Pi 在隔离环境中运行”和“宿主 Pi 把 Tool 执行路由进隔离环境”。[`sandbox` 示例](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/sandbox) 包装 Bash，适合观察局部覆盖；[`gondolin` 示例](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/gondolin) 则替换 read、write、edit、bash、grep、find 与 ls Operations，把执行发送到挂载工作区的本地 microVM。比较二者时，应逐一检查内置 Tool、用户 Shell、Extension 和自定义 Tool 究竟在哪个进程与权限边界中运行。

### 第 16 章的 Durable Execution 与 Human-in-the-loop 源码锚点

固定版本中，当前可运行的持久化路径首先位于 coding-agent [`AgentSession`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session.ts) 与 [`SessionManager`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/session-manager.ts)：`message_end` 把用户、assistant 与 Tool Result 写入追加式 JSONL 会话树，恢复时再从活动分支投影模型消息。这能恢复对话事实，但不等于保存每个外部副作用的精确程序位置。

第二层是 [`AgentHarness`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/harness/agent-harness.ts) 的公开 API scaffold。固定 commit 中，已有记录的 `create()` 与 `prompt()`、`resume()`、`abort()` 等运行方法仍会抛出 `HarnessNotImplemented`；[`create-harness.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/server/create-harness.ts) 只负责装配 Tool 与 System Prompt，不能据此推断 Durable 路径已经完成。

第三层是标题明确写作 **implementation specification** 的 [`docs/harness.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/docs/harness.md)。其中 Operation State、事务提交、effect sandwich、`safe` / `never` replay policy 与 Lane 是目标 Durable Harness 的设计语义。源码阅读必须把可运行 Session、API 骨架和目标规范分开。

### 第 17 章的 Security、Guardrails 与 Governance 源码锚点

固定版本 [`security.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/docs/security.md) 给出 Pi 的安全边界：Project Trust 控制项目级设置、Extension、Skill、Prompt、Theme、System Prompt 文件与项目 Package 的加载，不是 Sandbox；`AGENTS.override.md`、`AGENTS.md` 与 `CLAUDE.md` 等 Context 文件仍会加载，除非关闭 Context 加载。相同文档明确说明 Pi 没有内置 Sandbox，Tool、Extension、Package、Shell、测试与语言服务器继承 Pi 进程的本地用户权限。

工具执行顺序由 [`agent-loop.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/agent-loop.ts) 证明：参数先准备并校验，再进入 `beforeToolCall`，通过后执行 Tool，最后进入 `afterToolCall`。coding-agent 的 [`AgentSession`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session.ts) 把 Extension `tool_call` / `tool_result` 事件接到这两个位置；[`extensions/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/extensions/types.ts) 进一步明确 `event.input` 可被原地修改、后续 Handler 能看到变化，但修改后不会再次执行 Schema 校验。

[`permission-gate.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/permission-gate.ts)、[`protected-paths.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/protected-paths.ts) 与 [`project-trust.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/examples/extensions/project-trust.ts) 是理解 Hook 与 UI 的教学入口，不应被当成完整 Shell Policy、路径 Sandbox 或企业授权系统。[`telemetry/README.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/telemetry/README.md) 则说明诊断信号的数据最小化边界：Prompt、Tool 参数与结果、文件内容、Header 和凭证不应默认进入 Telemetry。

### 第 18 章的 Observability、Evaluation 与 Harness Engineering 源码锚点

运行中通知首先来自 [`AgentEvent`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/types.ts)：Agent、Turn、Message 与 Tool Execution 各有 start / update / end 边界。Coding Agent 的 [`AgentSessionEvent`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/agent-session.ts) 继续加入 `agent_settled`、队列、Compaction、Retry 与 Session 更新；[`extensions/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent/src/core/extensions/types.ts) 则同时包含被动生命周期事件和能改变 Context、Provider 请求或 Tool 行为的 Hook。三者不能因为都叫 Event 就被描述成同一层 Telemetry。

[`packages/telemetry`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/telemetry) 已实现显式 Callback 型 `TelemetryContext` / `TelemetrySpan` 契约、No-op、无时间戳的内存参考 Adapter、Schema 类型工具与 Adapter Conformance；[`packages/agent/src/harness/telemetry.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/harness/telemetry.ts) 已声明 `pi.ai.request`、`pi.harness.*`、`pi.session.write` 词汇和类型化 Starter。固定源码中，`packages/ai` 会接收并传播 `telemetryContext`，但可运行 Agent Loop / Provider 主链尚未调用这些 Starter 生成完整 Span Tree；`docs/harness.md` 的完整 Telemetry 树仍属于目标实现规范。

[`packages/evals/README.md`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/evals/README.md) 和 [`pi-harness.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/evals/src/pi-harness.ts) 展示已经可运行的评测路径：在隔离临时 Workspace / Agent Directory 中创建真实 `AgentSession`，执行 Prompt / Reload，规范化 Transcript，统计 Token、Tool Call、成本与总耗时，并在清理前保存原生 Session JSONL Artifact。[`summary.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/evals/src/vitest-evals/summary.ts) 按相同 Input 和 Repetition 配对 Baseline / Candidate，分别报告 Pass Rate Lift、Token、Latency、Estimated Cost 和不完整观察；[`extensions.eval.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/evals/src/extensions.eval.ts) 则把 System Prompt 差异、Extension 源码、Reload、Tool 注册、真实执行与最终回答放入同一 Eval。

## 三条核心观察主线

### 消息主线

用户消息通过 `runAgentLoop` 进入循环，并加入 `currentContext.messages`。Agent 内部消息到达模型调用边界时，由 `convertToLlm` 转换为 LLM 能接受的消息；模型响应和 Tool Result 随后继续追加到上下文。

### 事件主线

`agent_start` 和 `turn_start` 标记运行边界，`message_start`、增量事件与 `message_end` 描述响应过程，`agent_end` 给出这次循环的结束结果。UI、日志和遥测通过这些事件观察运行，而不需要接管核心循环。

### 工具主线

模型响应中的 Tool Call 先被筛选并校验参数，宿主再执行对应工具，把结果转换为 Tool Result。循环根据工具结果、错误和终止条件决定继续调用模型还是结束。

消息、事件和工具三条主线共同构成进入 `coding-agent` 前的最小地图。`coding-agent` 在这套运行机制之上继续装配 AgentSession、CLI、会话存储、扩展和具体编码工具。

## 为什么不从 CLI 入口一路单步

CLI 入口往往同时处理参数、配置、认证、终端、主题、扩展和会话恢复。对初学者而言，入口最“真实”，却未必最适合第一次理解核心机制。先从类型和 loop 建立最小主干，再回到 coding-agent 看能力怎样装配，能显著减少无关细节。

## 地图之外还有什么

固定版本 `packages` 目录还包括 client、protocol、server、evals 与 session backend 等内容。它们会在需要解释远程协议、评测或存储时进入课程，不在第一张图上并不代表不重要。

回到学习主线：[第一章：从大模型到 Agent](../docs/01-from-llm-to-agent.md)。
