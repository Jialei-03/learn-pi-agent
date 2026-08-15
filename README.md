# Learn Pi Agent

从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。

> **中文内容 · 持续建设中**  
> 这是一个面向学习者的非官方仓库，不属于 Pi 官方项目。若你发现源码解释、版本信息或文献引用有误，欢迎通过 Issue 指正。

## 这个仓库解决什么问题

Agent 领域不缺术语，也不缺“十分钟做一个 Agent”的示例，真正稀缺的是一条能把概念、协议和工程源码连起来的学习路径。初学者常常知道 `tool calling`、`memory`、`MCP` 这些词，却仍然回答不了：模型到底做了什么？工具是谁执行的？一次会话怎样在多轮调用中保持连续？

本仓库以 [Pi](https://github.com/earendil-works/pi) 为工程样本，采用下面这条递进路线：

**基础直觉 → 行业 API → 论文背景 → Pi 工程实现 → 源码运行追踪**

它不是：

- 重新实现一个 Agent 框架；
- 把 Pi 源码逐文件翻译成中文；
- 用流行术语替代对真实运行过程的解释；
- 承诺某一种 Agent 架构适用于所有问题。

它希望帮助你建立一张可靠的认知地图：先理解模型、消息、上下文和工具调用，再进入 Pi 的包结构与运行循环，最后能够沿着一次真实请求追踪状态、事件、工具和会话是如何流动的。

![从基础直觉到源码追踪的递进学习路径](assets/diagrams/learning-path.svg)

## 适合谁

- 第一次系统学习 AI Agent，希望先把基础概念理顺的读者；
- 会一点 JavaScript / TypeScript，想从真实项目学习工程设计的开发者；
- 调用过模型 API，但还没有完整理解 tool call、agent loop 与 session 的读者；
- 想理解 coding agent 如何连接模型、终端、文件系统和会话状态的读者。

不要求你已经写过 Agent。阅读源码章节时，具备 TypeScript 的函数、对象、异步迭代等基础会更轻松。

## 从这里开始

第一次来，建议依次阅读：

1. [你将学到什么](docs/00-start/01-what-you-will-learn.md)：先建立学习目标；
2. [如何使用本仓库](docs/00-start/02-how-to-use-this-repo.md)：选择适合自己的阅读路线；
3. [源码版本为什么重要](docs/00-start/03-source-version.md)：理解为什么源码链接必须固定 commit；
4. [第一章：从大模型到 Agent](docs/01-foundations/01-from-llm-to-agent.md)：从一次模型调用走到最小 Agent Loop；
5. [完整学习路线](ROADMAP.md)：查看后续章节如何逐层展开。

如果你只有 30 分钟，直接完成[这里的第一次练习](docs/00-start/02-how-to-use-this-repo.md#第一个-30-分钟)即可。

当前首篇正文已经完成：**[从大模型到 Agent：中间到底多了什么？](docs/01-foundations/01-from-llm-to-agent.md)**。它用一次天气工具调用解释模型、宿主程序、工具结果与循环之间的边界。

## 为什么选择 Pi

Pi 把模型适配、Agent 核心循环、编码场景会话与终端界面拆成相对清楚的包。它足够小，适合沿调用链阅读；又包含流式消息、工具、事件、会话树、上下文压缩、扩展与技能等真实 Agent 系统会遇到的问题。

本仓库主要参考：

- [Pi 官方仓库](https://github.com/earendil-works/pi)
- [Pi 官方文档](https://pi.dev/docs/latest)
- [本仓库固定的版本基线](references/version-baseline.md)
- [Pi 源码地图](references/source-map.md)
- [术语表](references/glossary.md)
- [论文阅读索引](references/papers.md)

## 阅读原则

每个重要概念尽量回答四类问题：

1. **它解决什么问题？** 先从可感知的场景出发；
2. **行业接口怎样表达它？** 对照 OpenAI、Anthropic 或 MCP 等官方协议；
3. **研究工作提供了什么背景？** 连接经典论文，但不把论文当成权威口号；
4. **Pi 怎样落地？** 回到固定版本的源码、类型、事件和调用链。

章节不会套用同一张固定模板。概念章节重视直觉和反例，API 章节重视消息结构对比，源码章节重视调用链与状态变化，论文索引则重视“为什么值得读”。

## 内容边界

首个版本只使用 Markdown 与 SVG，不包含 VitePress、部署配置或可运行的 Agent 实现。外部 API 与上游源码都可能变化，因此文章会标注核对日期，源码链接尽量固定到具体 commit；遇到文章与最新上游不一致时，请先查看[版本基线](references/version-baseline.md)。

## 参与贡献

欢迎补充例子、修正链接、讨论不同解释，尤其欢迎初学者指出“哪一句仍然看不懂”。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE)
