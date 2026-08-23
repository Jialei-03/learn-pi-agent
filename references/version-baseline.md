# 版本与来源基线

本文档是仓库的“时间坐标”。凡是讨论 Pi 源码行为的文章，默认基于这里记录的 commit；凡是讨论供应商 API 或协议的文章，应同时给出官方链接与核对日期。

## 首个公开版本的基线

| 来源 | 固定值或官方文档 | 核对日期 |
| --- | --- | --- |
| Pi repository | [earendil-works/pi](https://github.com/earendil-works/pi) | 2026-08-16 |
| Pi commit | [`086c32e74530564922d011ade23ff582c9d63116`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116) | 2026-08-16 |
| Pi docs | [pi.dev/docs/latest](https://pi.dev/docs/latest) | 2026-08-16 |
| OpenAI function calling | [Function calling guide](https://developers.openai.com/api/docs/guides/function-calling) | 2026-08-22 |
| OpenAI Tool Search | [Tool Search guide](https://developers.openai.com/api/docs/guides/tools-tool-search) | 2026-08-24 |
| OpenAI prompt engineering | [Prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering) | 2026-08-24 |
| OpenAI Structured Outputs | [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | 2026-08-24 |
| OpenAI Chat Completions | [Chat Completions reference](https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions) | 2026-08-22 |
| OpenAI Responses | [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) | 2026-08-22 |
| Anthropic Messages | [Create a message](https://platform.claude.com/docs/en/api/messages/create) | 2026-08-22 |
| Anthropic tool use | [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) | 2026-08-22 |
| Anthropic Tool Search | [Tool Search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) | 2026-08-24 |
| Anthropic Context Windows | [Context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) | 2026-08-24 |
| Anthropic Structured Outputs | [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) | 2026-08-24 |
| Anthropic Context Engineering | [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 2026-08-24 |
| Anthropic streaming | [Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) | 2026-08-22 |
| MCP specification | [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/) | 2026-08-16 |
| JSON Schema | [Understanding JSON Schema：Object](https://json-schema.org/understanding-json-schema/reference/object) | 2026-08-24 |
| Temporal Event History | [Event History](https://docs.temporal.io/encyclopedia/event-history) | 2026-08-24 |
| Temporal Workflow replay | [Workflow Definition](https://docs.temporal.io/workflow-definition) | 2026-08-24 |
| Temporal Activity idempotency | [Activity Definition](https://docs.temporal.io/activity-definition) | 2026-08-24 |

> API 文档是“在核对日期打开的最新官方文档”，不是本仓库保存的协议快照。打开链接时看到更新版本是正常现象；若字段或语义发生变化，应在正文中留下变更说明。

## 固定 commit、核对日期与当前 HEAD

这三个概念回答不同问题：

- **固定 commit**：文章实际依据哪一份 Pi 源码？它应该长期不变，保证链接可复现；
- **核对日期**：作者最后一次确认链接和描述的时间是什么？它帮助判断易变信息是否可能过期；
- **当前 HEAD**：Pi 默认分支此刻指向哪里？它反映最新上游，不自动替代文章基线。

在 2026-08-16 的核对中：

```text
文章固定基线：086c32e74530564922d011ade23ff582c9d63116
远端 HEAD：    086c32e74530564922d011ade23ff582c9d63116
```

两者当时相同。以后即使远端 HEAD 前进，首个版本的源码链接仍保留原 commit；升级文章时应先验证变化，再决定建立新基线或只补充差异说明。

## 这个 Pi 基线告诉了我们什么

固定版本的 [Pi README](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/README.md) 把项目称为 **Pi Agent Harness**，并给出三个学习主干：

- `@earendil-works/pi-ai`：统一多模型供应商的 LLM API；
- `@earendil-works/pi-agent-core`：带工具调用与状态管理的 Agent runtime；
- `@earendil-works/pi-coding-agent`：交互式 coding agent CLI。

同一 README 还列出 `pi-tui` 和 `pi-telemetry`。仓库在此 commit 下还存在 client、protocol、server、evals 等目录；本课程第一阶段没有忽略它们，而是暂时只选择最能解释本地 coding agent 主路径的包。完整目录以[固定版本的 packages 页面](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages)为准。

## 安全相关的版本事实

固定版本 README 明确说明：Pi 本身不包含限制文件系统、进程、网络或凭据访问的内置权限系统，默认继承启动它的用户与进程权限。因此，“模型请求工具”与“宿主被允许执行什么”必须分开讨论；阅读本仓库不应被理解为对任意环境直接运行 coding agent 的安全背书。

## 哪些信息最容易变化

| 信息 | 变化风险 | 本仓库的处理方式 |
| --- | --- | --- |
| Pi 文件路径、类型名、事件顺序 | 高 | 源码链接固定 commit，升级时沿调用方重新验证 |
| 支持的模型与 Provider | 高 | 不在概念章节维护穷举列表，查询 Pi 与供应商官方文档 |
| OpenAI / Anthropic 请求字段 | 高 | 链接官方文档并标注核对日期 |
| MCP 当前协议版本 | 高 | 链接 specification 入口，具体版本结论单独注明 |
| Agent Loop 的基本语义 | 中 | 同时用伪代码、API 语义和 Pi 固定源码验证 |
| 论文标题与原文地址 | 低 | 直接链接 arXiv 或正式发表页面 |

## 升级基线时的检查清单

1. 记录旧 commit、新 commit、核对日期与上游变更范围；
2. 检查 `packages/ai/src/types.ts` 的消息、内容块与流事件；
3. 检查 `packages/agent/src/types.ts` 与 `agent-loop.ts` 的循环输入、事件、工具执行和停止条件；
4. 检查 coding-agent 的 AgentSession 与资源装配入口；
5. 更新[源码地图](source-map.md)，但不要让一篇文章混用两个版本的链接；
6. 对照官方 API 文档重新验证示例字段；
7. 在提交说明中写明“哪些解释改变了”，而不只写“升级版本”。

## 引用原则

- Pi 工程事实优先引用固定 commit 的源码或 README；
- API 行为优先引用供应商官方文档；
- 研究结论链接论文原文，并说明适用设置；
- 本仓库的图解和类比属于教学解释，不替代上面三类证据。

相关入口：[源码地图](source-map.md) · [术语表](glossary.md) · [论文索引](papers.md)
