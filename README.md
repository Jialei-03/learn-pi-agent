# Learn Pi Agent

从真实代码出发，系统理解 Pi Agent 的整体架构与关键实现。

**[打开学习网站](https://learn-pi-agent-course.leslie102303.chatgpt.site)** · [课程路线](docs/00-source-learning-path.md) · [源码地图](references/source-map.md)

## 学习目标

课程沿一次真实请求展开：用户输入如何进入 Session，怎样经过 Agent Loop 和 Provider，工具怎样执行，结果怎样回到模型，消息又怎样持久化和显示。之后继续研究扩展、MCP、Durable、安全与评测。

每章将概念、源码入口、关键代码和行为证据放在一起。源码摘录保留原始命名，教学示意与应用伪代码另作说明。正文负责讲解，不布置作业，也不要求先实现一套 Agent。

## 从哪里开始

先读[学习路线](docs/00-source-learning-path.md)，再从[第一章](docs/01-from-llm-to-agent.md)进入。章节编号保持稳定，便于收藏和引用。全局架构不等于穷举每个 Provider 和 UI 组件；重点是理解主干与关键边界，并知道其他包如何接入。

## 内容与维护

- [可运行示例](examples/read-loop/README.md)：用同一份模型脚本运行网页循环、内置文件工具与完整 SDK 会话。
- `docs/`：18 章课程与导航。
- `references/`：源码地图、术语、论文与内容维护证据。
- `assets/`：Mox 教学配图与原有素材。角色规范见 [Mox IP](references/mox-ip.md)。
- `website/`：网站源码和构建脚本，从 Markdown 生成页面。
- `scripts/`：源码摘录与内容验证工具。
- `video-series/`：按课程组织的配套讲述索引。

网站是发布时的课程快照。更新正文后需要重新构建和发布，详见[网站说明](website/README.md)。

## License

MIT。Pi 源码、引用论文与外部资料仍遵循其各自许可；配图用于本项目的教学解释。
