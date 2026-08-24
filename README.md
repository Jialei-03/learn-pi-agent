# Learn Pi Agent

从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。

> 中文内容 · 持续建设中 · 非官方 Pi 项目

## 这是什么

Agent 领域不缺术语，也不缺“十分钟做一个 Agent”的示例。这个仓库关注一条更扎实的学习路径：

**基础直觉 → 行业 API → 论文背景 → Pi 工程实现 → 源码运行追踪**

你会逐步回答这些问题：

- 模型到底负责什么？
- 工具是谁执行的？
- 一次会话怎样在多轮调用中保持连续？
- OpenAI、Anthropic 等 API 的差异为什么需要 Provider 层吸收？
- Pi 如何把模型、循环、工具、事件和会话组织成一个可运行的 coding agent？

本项目只负责讲解，不布置作业，也不要求你先自己实现一个 Agent。

![从基础直觉到源码追踪的学习路径](assets/mox-illustrations/mox-learning-path.png)

## 从哪里开始

完整章节结构记录在[课程章节结构](docs/00-course-structure.md)中；下面只保留当前学习入口：

从第一章开始，按章节编号继续阅读：

1. [第 1 章：从 LLM 到 Agent，再到 Harness](docs/01-from-llm-to-agent.md)
2. [第 2 章：模型 API 与消息协议](docs/02-model-api-and-message-protocols.md)
3. [第 3 章：Pi Agent Loop——状态、事件与停止条件](docs/03-agent-loop-state-machine-and-stopping.md)
4. [第 4 章：Tools 与 Function Calling——从结构化请求到可控执行](docs/04-tools-and-function-calling.md)
5. [第 5 章：Context Engineering 与 Structured Output——模型每轮究竟看见什么](docs/05-context-engineering-and-structured-output.md)
6. [第 6 章：Session、Memory、Retrieval 与 Compaction——信息怎样跨越多轮任务](docs/06-session-memory-retrieval-and-compaction.md)
7. [第 7 章：MCP——Agent 怎样用统一协议连接外部能力](docs/07-mcp-protocol-and-pi-integration.md)
8. [第 8 章：Skills 与 Prompt Templates——怎样把工作方法交给 Agent](docs/08-skills-and-prompt-templates.md)
9. [第 9 章：Extensions、Plugins 与 Packages——怎样扩展并分发 Agent Harness](docs/09-extensions-plugins-and-packages.md)
10. [第 10 章：Workflow 与 Agent——下一步由谁决定](docs/10-workflow-vs-agent.md)
11. [第 11 章：Workflow Patterns——怎样连接多个模型与 Agent 节点](docs/11-workflow-patterns.md)
12. [第 12 章：Planning 与 Reasoning Patterns——模型怎样形成、执行和修正行动方案](docs/12-planning-and-reasoning-patterns.md)
13. [第 13 章：Agent SDK 与应用集成——把 Agent 能力装进真实产品](docs/13-agent-sdk-and-app-integration.md)
14. [第 14 章：Multi-Agent 与 A2A——多个 Agent 怎样分工与协作](docs/14-multi-agent-and-a2a.md)
15. [第 15 章：Sandbox、Code Agent 与 Computer Use——动作在哪里执行，由谁允许](docs/15-sandbox-code-agent-and-computer-use.md)

前四章从模型协议进入 Agent Loop 与工具执行；第五、六章继续追踪 Context 怎样组成、信息怎样跨越多轮；第七章解释 Host 如何通过 MCP 发现并调用外部能力；第八、九章说明工作方法、扩展代码与分发单元怎样进入 Harness；第十至十二章进入多步骤任务，依次划清 Workflow 与 Agent 的控制权、讲解常见组合结构，并区分 Reasoning、Execution Plan 与 Plan Mode；第十三章把这些能力通过 Agent SDK 装进应用，第十四章进入多 Agent 编排与 A2A，第十五章再把所有动作放回真实文件、进程、网络、浏览器与 Sandbox 中。

## 适合谁

- 第一次系统学习 AI Agent 的读者；
- 调用过模型 API，但还没有完整理解 tool call、agent loop 与 session 的开发者；
- 会一点 JavaScript / TypeScript，希望从真实项目学习工程设计的人；
- 想理解 coding agent 如何连接模型、终端、文件系统和会话状态的人。

不要求你已经写过 Agent。能看懂 TypeScript 的函数、对象和异步迭代，会让源码章节更轻松。

## 你会看到的内容

- 用直觉解释模型、上下文、消息、工具、事件和状态；
- 对照 OpenAI 与 Anthropic 的真实 API 文档；
- 连接 ReAct、Toolformer 等经典论文；
- 沿固定版本追踪 Pi 的调用链和运行事件；
- 解释 Pi 为什么拆成 `pi-ai`、`pi-agent-core` 和 `pi-coding-agent`。

## 参与方式

如果你发现解释、链接或版本信息有误，可以在 GitHub 提交 Issue 或 Pull Request。这个项目更重视“哪一句仍然看不懂”的反馈，而不是堆叠更多术语。

## License

MIT License。
