# 课程章节结构

18 章围绕 Pi 的主运行链展开。下面链接到实际正文；推荐阅读顺序见[学习路线](00-source-learning-path.md)。

1. [从一次模型调用到 Agent：沿源码读懂一个工具循环](01-from-llm-to-agent.md)
2. [模型 API 与消息协议：一条消息怎样穿过 Provider](02-model-api-and-message-protocols.md)
3. [Agent Loop：状态、事件、队列与停止条件](03-agent-loop-state-machine-and-stopping.md)
4. [Tools：从工具声明到真实副作用](04-tools-and-function-calling.md)
5. [Context Engineering：每次请求到底给模型什么](05-context-engineering-and-structured-output.md)
6. [Session 与 Compaction：会话树怎样变成模型输入](06-session-memory-retrieval-and-compaction.md)
7. [MCP：外部服务怎样进入 Pi 的工具链](07-mcp-protocol-and-pi-integration.md)
8. [Skills 与 Prompt Templates：工作方法怎样进入请求](08-skills-and-prompt-templates.md)
9. [Extensions 与 Packages：能力怎样注册并参与运行](09-extensions-plugins-and-packages.md)
10. [Workflow 与 Agent：下一步由谁决定](10-workflow-vs-agent.md)
11. [Workflow Patterns：把多个 Agent 节点连接起来](11-workflow-patterns.md)
12. [Planning 与 Reasoning：从推理配置到可执行计划](12-planning-and-reasoning-patterns.md)
13. [SDK 与应用集成：从启动装配到资源释放](13-agent-sdk-and-app-integration.md)
14. [Multi-Agent：多个独立循环怎样协作](14-multi-agent-and-a2a.md)
15. [执行环境：工具的动作到底在哪里发生](15-sandbox-code-agent-and-computer-use.md)
16. [Durable：提交、任务状态与崩溃后的继续执行](16-durable-execution-and-human-in-the-loop.md)
17. [Security：信任边界怎样在代码中落实](17-security-guardrails-and-governance.md)
18. [Observability 与 Evaluation：怎样用证据改进 Pi](18-observability-evaluation-and-harness-engineering.md)

源码阅读覆盖模型消息和 Provider、Agent 状态与循环、工具流水线、Context 与 Session、资源与扩展、SDK 生命周期、MCP、Durable 和评测。通用模式与可选扩展示例会在正文明确说明其边界。
