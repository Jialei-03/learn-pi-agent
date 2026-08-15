# Learn Pi Agent 仓库设计规范

## 1. 项目定位

仓库名称为 `learn-pi-agent`。

这是一个面向中文初学者的 Pi Agent 学习与源码讲解仓库。内容从大模型 API、消息、上下文、流式响应和工具调用等基础概念出发，结合 OpenAI、Anthropic 等主流协议、相关行业术语与经典论文，逐步进入 Pi 的模型适配层、Agent Loop、运行状态、Session、工具、扩展、资源加载与上下文压缩源码。

仓库不以实现一个新的 Agent 框架为目标。必要的代码或运行记录只用于验证 Pi 的机制，不发展为独立产品。

## 2. 目标读者

- 第一次系统学习 Agent 的中文读者。
- 会阅读基础 TypeScript，但不了解 Pi monorepo 的开发者。
- 已经使用过模型 API，希望理解 Agent 内部控制流的开发者。
- 想从 Pi 源码了解 coding agent 工程边界的读者。

读者不需要预先了解 Agent 框架、MCP、RAG、多 Agent 或上下文压缩。

## 3. 核心目标

仓库需要帮助读者完成四个递进目标：

1. 理解模型 API 与 Agent 的区别。
2. 理解消息、上下文、流式事件、工具调用和 Agent Loop。
3. 理解 Pi 的 `pi-ai`、`pi-agent-core` 与 `pi-coding-agent` 分层。
4. 能够沿一条真实运行链路独立阅读 Pi 源码。

## 4. 非目标

第一阶段明确不做以下事项：

- 不实现新的通用 Agent 框架。
- 不开发聊天产品或完整教学版 Agent。
- 不搭建 VitePress、网站主题或在线部署。
- 不追求覆盖 Pi 的每一个文件和功能。
- 不把仓库写成论文精读合集或行业热词百科。
- 不在正文中绑定某个需要付费的模型服务。

## 5. 内容组织方案

仓库采用“概念与源码螺旋递进”的组织方式。每引入一个基础概念，就在合适的位置说明主流 API 如何表达该概念、相关论文提供了什么思想背景，以及 Pi 如何将其工程化。

主线顺序如下：

```text
大模型 API
→ 消息与上下文
→ 流式响应
→ 工具调用
→ 最小 Agent Loop
→ Pi 总体架构
→ pi-ai 模型适配层
→ pi-agent-core
→ AgentSession 与产品运行层
→ Session、树与恢复
→ 资源、工具、扩展与技能
→ 上下文窗口与压缩
→ 完整源码运行追踪
```

计划目录如下：

```text
learn-pi-agent/
├─ README.md
├─ ROADMAP.md
├─ CONTRIBUTING.md
├─ LICENSE
├─ docs/
│  ├─ 00-start/
│  ├─ 01-foundations/
│  ├─ 02-pi-core/
│  ├─ 03-pi-runtime/
│  ├─ 04-sessions-and-context/
│  ├─ 05-source-traces/
│  └─ 06-advanced/
└─ references/
   ├─ papers.md
   ├─ api-comparison.md
   ├─ glossary.md
   ├─ source-map.md
   └─ version-baseline.md
```

目录数字只表示推荐阅读顺序，不要求所有文章采用相同写法。

## 6. 章节类型与写作方式

仓库不采用固定章节模板。不同内容选择不同叙事结构：

- 基础概念：从问题、直觉和最小例子展开。
- API 对比：通过请求、响应、JSON 和对照表展开。
- 源码解析：通过模块职责、入口、类型、调用链和关键分支展开。
- 运行追踪：通过真实输入、事件、消息变化和函数位置展开。
- 论文背景：通过论文问题、核心思想、与 Pi 的联系和不能等同之处展开。
- 参考手册：采用术语表、索引或版本清单。

所有文章遵守以下质量要求：

- 开头让读者知道本章解决什么问题。
- 先解释需求和直觉，再展示复杂源码。
- 每次只引入当前理解所需的新概念。
- 明确区分源码事实、官方说明和作者推断。
- 外部概念只在有真实关联时出现，不强行加入热词或论文。
- 涉及 Pi 源码时标注仓库与 commit。
- 涉及当前 API 时标注核对日期并链接官方文档。
- 结论与引用尽量靠近，便于读者核验。

## 7. 行业 API、热词与论文的角色

Pi 始终是内容主线。外部材料承担三种辅助作用：

1. 主流 API 对比帮助解释 `pi-ai` 为什么需要统一供应商协议。
2. 经典论文帮助解释 Agent Loop、推理与行动、工具使用、记忆和压缩的思想背景。
3. MCP、structured outputs、context engineering、observability、evals 等行业术语帮助读者建立当前技术坐标。

每次引用都要说明“它为什么与当前 Pi 机制有关”。不能仅因为概念热门就加入正文，也不能在没有来源依据时声称 Pi 直接实现了某篇论文。

## 8. 版本与可核验性

Pi 与模型 API 都会变化。仓库采用版本基线机制：

- `references/version-baseline.md` 记录 Pi 上游仓库、完整 commit SHA 与核对日期。
- 源码链接尽量指向固定 commit，不长期依赖 `main` 行号。
- OpenAI、Anthropic 和 MCP 等外部协议记录文档核对日期与版本。
- 章节中若描述个人推断，使用明确措辞，不写成官方事实。
- 版本升级时新增核对记录，不静默修改历史结论。

## 9. 第一阶段交付范围

首个公开版本只建立可阅读、可继续扩展的 Markdown 基线：

```text
README.md
ROADMAP.md
CONTRIBUTING.md
LICENSE
docs/00-start/01-what-you-will-learn.md
docs/00-start/02-how-to-use-this-repo.md
docs/00-start/03-source-version.md
docs/01-foundations/01-from-llm-to-agent.md
references/papers.md
references/glossary.md
references/source-map.md
references/version-baseline.md
```

第一篇正文为“从大模型到 Agent”。它只建立模型调用、上下文、控制循环和行动能力的基础直觉，不提前深入完整 Pi 源码。

第二个内容里程碑才进入“主流模型 API”，对比 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages，并说明这些差异如何引出 Pi 的统一模型协议层。

## 10. GitHub 仓库元数据

- 仓库名：`learn-pi-agent`
- 可见性：公开
- 默认分支：`main`
- 正文语言：简体中文
- 仓库名与技术关键词：英文
- License：MIT
- 建议描述：`从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。`
- 建议 Topics：`pi-agent`、`ai-agent`、`agent-loop`、`tool-calling`、`llm`、`typescript`、`source-code`、`chinese`

## 11. 贡献与质量检查

第一阶段的验证重点是文档质量而非应用测试：

- 检查 Markdown 内部链接是否指向存在的文件。
- 检查外部链接是否使用官方文档、论文原文或上游源码。
- 检查引用的 Pi 文件路径是否存在于版本基线 commit。
- 检查文章是否区分事实与推断。
- 检查术语在不同章节中的中文译法是否一致。
- 检查仓库中不存在 API Key、访问令牌或本地隐私路径。

后续可以加入轻量的 Markdown lint 和链接检查，但首个提交不引入构建工具链。

## 12. 读者和作者的第一步

读者的第一步是阅读“从大模型到 Agent”，理解模型调用与 Agent 控制循环的差异。

作者的第一步是固定 Pi 源码版本基线，然后撰写这篇文章。版本基线先于源码解析，避免后续章节的文件路径、类型和行为因上游变化而失真。

## 13. 成功标准

第一阶段成功需要同时满足：

- GitHub 上存在名为 `learn-pi-agent` 的公开仓库。
- README 能在一分钟内说明项目适合谁、讲什么和不讲什么。
- ROADMAP 能展示从基础概念到源码追踪的递进路径。
- 第一篇正文不要求读者预先了解 Agent 框架。
- 版本基线能精确定位讲解所依据的 Pi commit。
- 所有外部事实都有可核验的官方文档、上游源码或论文原文来源。
- 仓库不包含网站部署配置和独立 Agent 产品实现。
