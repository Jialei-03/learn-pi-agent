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

![Mox 带着读者从基础直觉走向源码追踪](assets/mox-illustrations/mox-learning-path.png)

## 从哪里开始

按编号从头读到尾即可：

1. [第 1 章：从大模型到 Agent](https://github.com/Jialei-03/learn-pi-agent/blob/main/docs/01-foundations/01-from-llm-to-agent.md)
2. [完整阅读路线](https://github.com/Jialei-03/learn-pi-agent/blob/main/ROADMAP.md)

第一章先建立 Model、Context、Loop、Tools、State 的直觉，再进入 OpenAI 与 Anthropic 的工具调用表达，最后回到 Pi 的三层包结构。

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

## Mox：本仓库的 IP

Mox 是 `dive into X` 的白色状态助手：白色圆润身体、黑色椭圆脸、顶部橙灯、右肩功能模块和小 X。它不是装饰，而是用动作解释“模型—工具—上下文—循环”如何共同工作。

配图使用独立的 [Mox Illustrations Skill](https://github.com/Jialei-03/mox-illustrations) 生成。角色外形以[这张九状态设定图](https://github.com/Jialei-03/learn-pi-agent/blob/main/assets/mox-illustrations/mox-reference-sheet.png)为准；仓库中的配图会优先使用 Mox。保留的旧 SVG 只作为尚未替换章节的过渡资产。

## 参考入口

- [Pi 官方仓库](https://github.com/earendil-works/pi)
- [Pi 官方文档](https://pi.dev/docs/latest)
- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Anthropic Tool Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [ReAct 论文](https://arxiv.org/abs/2210.03629)
- [Toolformer 论文](https://arxiv.org/abs/2302.04761)

外部 API 与上游源码会变化；正文会标注核对日期，关键说明尽量固定到对应版本。

## 参与方式

如果你发现解释、链接或版本信息有误，可以在 GitHub 提交 Issue 或 Pull Request。这个项目更重视“哪一句仍然看不懂”的反馈，而不是堆叠更多术语。

## License

MIT License。
