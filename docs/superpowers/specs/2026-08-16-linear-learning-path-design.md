# Learn Pi Agent 单线学习路径设计

日期：2026-08-16

## 目标

降低初学者进入正文前的阅读成本。仓库只提供一条按编号从头到尾的学习主线，不再根据读者背景设置多条阅读路线，也不再单独讲“如何使用本仓库”。

## 当前问题

`docs/00-start` 包含“你将学到什么”“如何使用本仓库”“源码版本为什么重要”三篇前置文章。读者在进入第一章前需要做额外选择，其中部分信息与 README、ROADMAP 和 `references/version-baseline.md` 重复。

## 设计决定

1. 删除整个 `docs/00-start` 目录。
2. README 只保留一份简短、严格有序的学习目录。
3. 学习入口从第一篇实际内容开始：`docs/01-foundations/01-from-llm-to-agent.md`。
4. 版本固定原则压缩为 README 中的一段提示；详细信息继续放在 `references/version-baseline.md`，作为需要时查阅的参考资料，不列为必读步骤。
5. ROADMAP 删除阶段 0 的“如何使用仓库”，从基础章节开始呈现学习顺序。
6. 后续内容按编号线性增加，不再按“初学者、API 读者、Agent 读者”分流。

## 新的主线

```text
README
→ 第 1 章：从大模型到 Agent
→ 第 2 章：模型 API 与消息
→ 第 3 章：工具调用
→ 第 4 章：Agent Loop
→ Pi 架构与源码
```

未完成的章节只在 ROADMAP 中显示标题和学习目标，不创建空文件或死链接。

## 需要修改的内容

- 删除 `docs/00-start/01-what-you-will-learn.md`。
- 删除 `docs/00-start/02-how-to-use-this-repo.md`。
- 删除 `docs/00-start/03-source-version.md`。
- 简化 README 的“从这里开始”，移除三条导读链接和“第一个 30 分钟”。
- 简化 ROADMAP，移除阶段 0 及其导读链接，并重新表达从第 1 章开始的顺序。
- 检查 CONTRIBUTING、正文和 references 中是否仍指向被删除文件。

早期设计与实施计划保留为历史记录，其中出现旧路径不代表当前学习导航仍使用这些文件。

## 验收标准

- README 中只出现一条从头到尾的学习路线。
- 第一个正文入口直接指向“从大模型到 Agent”。
- `docs/00-start` 不再存在。
- 公开内容不存在指向已删除导读的内部链接。
- ROADMAP 不要求读者先选择阅读方式。
- 版本基线仍可从 README 和需要版本信息的正文中访问。
- Markdown 内部链接、敏感信息检查和 `git diff --check` 全部通过。

## 不在本次范围内

- 不重写第一章正文。
- 不新增第二章内容。
- 不改变 Pi 固定源码 commit。
- 不增加网页框架或部署配置。
