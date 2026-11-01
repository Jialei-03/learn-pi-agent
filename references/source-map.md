# Pi 源码地图：从入口到关键机制

这份地图把课程里的问题定位到具体代码。先看入口和调用关系，再阅读数据类型、分支与测试；不需要把仓库每个文件从头到尾读完。

## 主包及辅助包

| 包 | 阅读重点 |
| --- | --- |
| [`coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) | CLI、SDK、Session、资源、编码工具和交互界面 |
| [`agent`](https://github.com/earendil-works/pi/tree/main/packages/agent) | Agent 状态、模型工具循环、队列和事件 |
| [`ai`](https://github.com/earendil-works/pi/tree/main/packages/ai) | 消息、模型注册、认证与 Provider 适配 |
| [`tui`](https://github.com/earendil-works/pi/tree/main/packages/tui) | 输入控件、终端布局和渲染 |
| [`mcp`](https://github.com/earendil-works/pi/tree/main/packages/mcp) | 独立 MCP 客户端和传输 |
| [`codemode`](https://github.com/earendil-works/pi/tree/main/packages/codemode) | 程序化工具组合的运行能力 |
| [`durable`](https://github.com/earendil-works/pi/tree/main/packages/durable) | 提交、会话、任务、存储和恢复 |
| [`chord`](https://github.com/earendil-works/pi/tree/main/packages/chord) | 显式 Context、类型化状态、Host 与通信基础 |
| [`telemetry`](https://github.com/earendil-works/pi/tree/main/packages/telemetry) | 遥测契约和 Schema |
| [`evals`](https://github.com/earendil-works/pi/tree/main/packages/evals) | 行为评测及文档对照运行 |
| [`schema`](https://github.com/earendil-works/pi/tree/main/packages/schema) | Schema 与 JSON 数据相关基础 |
| [`env`](https://github.com/earendil-works/pi/tree/main/packages/env) | 执行环境相关能力 |

这张表表达职责，不是完整构建依赖图。存在于仓库的包不一定是本地 CLI 每次请求的必经路径。

## 从一条用户输入进入

1. [`cli.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli.ts) 到 [`main.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts)：程序入口、参数和模式。
2. [`agent-session-services.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session-services.ts) 和 [`sdk.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)：服务及 AgentSession 装配。
3. [`interactive-mode.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts)：用户提交和事件显示。
4. [`agent-session.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)：输入预处理、扩展、运行、持久化与取消。
5. [`agent.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts)：`prompt`、上下文快照和状态事件处理。
6. [`agent-loop.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)：模型、工具、继续与停止。

## 按机制深入

| 问题 | 文件与关键位置 | 对应章节 |
| --- | --- | --- |
| 系统指令和工具声明如何记录 | `ai/src/types.ts` 的 `SystemMessage`、`Context`；`agent.ts` 的初始系统消息 | 1、2、5 |
| 请求怎样变成服务协议 | `ai/src/api/anthropic-messages.ts` 的 `buildParams`、`convertMessages` | 2 |
| 谁决定下一轮 | `agent-loop.ts` 的 `runLoop`、`prepareRequest`、`finishTurn` | 3 |
| 工具参数和实际动作 | `prepareToolCall`、`executePreparedToolCall`；`coding-agent/src/core/tools` | 4、15 |
| 会话怎样恢复 | `session-manager.ts` 的分支、投影与上下文构建 | 6 |
| 压缩怎样切历史 | `core/compaction/compaction.ts` | 6 |
| MCP 如何注册 | `extensions/mcp/index.ts`、`tools.ts` 和 `packages/mcp/src/client.ts` | 7 |
| Skill 和模板怎样展开 | `skills.ts`、`prompt-templates.ts`、`_expandSkillCommand` | 8 |
| 扩展钩子如何串联 | `extensions/loader.ts`、`runner.ts`、`wrapper.ts` | 9 |
| Session 如何创建和替换 | `sdk.ts`、`agent-session-runtime.ts` | 13 |
| 子 Agent 怎样执行 | `examples/extensions/subagent` 的进程与结果处理 | 11、14 |
| 持久任务怎样恢复 | `durable/src/harness/harness.ts`、`submissions.ts`、`tool.ts` | 16 |
| 评测如何计划和配对 | `evals/src/plan.ts`、`docker.ts`、`report.ts` | 18 |

## 测试怎样成为证据

`agent/test` 聚焦循环与状态；`coding-agent/test` 覆盖会话、扩展、工具与产品边界；`mcp/test` 验证协议；`durable/test` 注入存储、取消与恢复故障。单元测试与真实模型评测有不同用途，执行状态见[内容核对方法](version-baseline.md)。
