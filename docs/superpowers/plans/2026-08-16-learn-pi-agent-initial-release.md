# Learn Pi Agent Initial Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `learn-pi-agent` 的首个公开 Markdown 版本，让中文初学者能够理解项目定位、按路线开始学习，并从“模型调用”自然过渡到 Pi Agent。

**Architecture:** 仓库只包含 Markdown 文档和 MIT License，不引入 VitePress、Node.js 依赖或部署配置。内容按“入口说明 → 学习路线 → 版本与参考 → 第一篇基础正文”组织，所有易变的 Pi 源码说明固定到同一个上游 commit，最后通过浏览器创建公开 GitHub 仓库并推送本地 `main` 分支。

**Tech Stack:** Git、GitHub、Markdown、PowerShell 只读验证命令

## Global Constraints

- 仓库名必须为 `learn-pi-agent`，可见性必须为 Public，默认分支必须为 `main`。
- 正文使用简体中文；仓库名、文件名和核心技术关键词使用英文。
- 第一阶段只做 Markdown，不添加 VitePress、网站部署、Node.js 依赖或独立 Agent 实现。
- Pi 主线使用 `https://github.com/earendil-works/pi`。
- 首个版本的 Pi 基线 commit 必须为 `086c32e74530564922d011ade23ff582c9d63116`，核对日期为 `2026-08-16`。
- OpenAI、Anthropic、MCP 等易变协议必须链接官方文档并标注核对日期；论文必须链接论文原文。
- 不得写入 API Key、GitHub Token、浏览器凭据或本地隐私路径。
- 不采用统一章节模板；不同章节按内容选择自然结构。
- GitHub 描述使用：`从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。`
- GitHub Topics 使用：`pi-agent`、`ai-agent`、`agent-loop`、`tool-calling`、`llm`、`typescript`、`source-code`、`chinese`。

---

## File Structure

首个公开版本新增或保留以下文件：

```text
README.md
ROADMAP.md
CONTRIBUTING.md
LICENSE
docs/superpowers/specs/2026-08-16-learn-pi-agent-design.md
docs/superpowers/plans/2026-08-16-learn-pi-agent-initial-release.md
docs/00-start/01-what-you-will-learn.md
docs/00-start/02-how-to-use-this-repo.md
docs/00-start/03-source-version.md
docs/01-foundations/01-from-llm-to-agent.md
references/papers.md
references/glossary.md
references/source-map.md
references/version-baseline.md
```

职责划分：

- `README.md`：一分钟内说明仓库定位、适合读者、阅读入口和内容边界。
- `ROADMAP.md`：展示从模型 API 到 Pi 源码追踪的递进课程地图。
- `CONTRIBUTING.md`：记录非固定模板的写作原则、来源规则和版本规则。
- `LICENSE`：MIT License 全文。
- `docs/00-start/*`：读者入门、使用方式和版本说明。
- `docs/01-foundations/01-from-llm-to-agent.md`：第一篇基础正文。
- `references/papers.md`：按主题组织的论文入口，不写成论文精读。
- `references/glossary.md`：统一中英文术语和简短定义。
- `references/source-map.md`：固定 commit 下的 Pi 包级源码地图。
- `references/version-baseline.md`：记录外部来源、版本和核对日期。

---

### Task 1: 创建仓库入口与学习路线

**Files:**
- Create: `README.md`
- Create: `ROADMAP.md`
- Create: `LICENSE`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-16-learn-pi-agent-design.md` 中已经批准的定位、范围和成功标准。
- Produces: 后续所有文档使用的项目简介、主导航和阶段命名。

- [ ] **Step 1: 运行入口文件存在性检查并确认它失败**

Run:

```powershell
$requiredRootFiles = @('README.md', 'ROADMAP.md', 'LICENSE')
$missingRootFiles = $requiredRootFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingRootFiles.Count -eq 0) { throw 'Expected root files to be missing before Task 1' }
$missingRootFiles
```

Expected: 输出 `README.md`、`ROADMAP.md` 和 `LICENSE`，命令成功结束。

- [ ] **Step 2: 编写 README**

`README.md` 必须按以下顺序包含：

```markdown
# Learn Pi Agent

从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。

## 这个仓库解决什么问题
```

正文需要明确：

- 这是中文学习与源码讲解仓库，不是 Pi 官方仓库。
- 不是重新实现一个 Agent，也不是逐文件翻译。
- 适合 Agent 初学者、会基础 TypeScript 的开发者和希望理解 coding agent 的读者。
- 学习方法是“基础直觉 → 行业 API → 论文背景 → Pi 工程实现 → 源码运行追踪”。
- 第一篇入口链接到 `docs/01-foundations/01-from-llm-to-agent.md`。
- 学习路线链接到 `ROADMAP.md`。
- 版本说明链接到 `references/version-baseline.md`。
- 官方 Pi 项目链接到 `https://github.com/earendil-works/pi` 和 `https://pi.dev/docs/latest`。
- 使用醒目标注说明正文为中文、仓库正在渐进建设、欢迎通过 issue 指正文献或源码错误。

- [ ] **Step 3: 编写 ROADMAP**

`ROADMAP.md` 必须包含以下阶段及每阶段学习结果：

```text
阶段 0：如何使用仓库与固定源码版本
阶段 1：模型 API、消息、上下文、流式响应、工具调用、最小 Agent Loop
阶段 2：Pi 总体架构、pi-ai、Agent 类型、Agent Loop、事件与状态
阶段 3：AgentSession、工具、扩展、Skills、ResourceLoader、System Prompt
阶段 4：JSONL Session、树、resume/fork、上下文窗口与 compaction
阶段 5：简单 prompt、工具调用、会话恢复和压缩的完整源码追踪
阶段 6：MCP、安全、评测和多 Agent 等扩展视野
```

每个阶段需要区分 `已完成`、`进行中`、`计划中`。首个版本仅将以下内容标记为已完成：仓库介绍、学习方式、版本基线、第一篇“从大模型到 Agent”。其余内容标记为计划中，不使用空链接。

- [ ] **Step 4: 添加 MIT License**

`LICENSE` 使用标准 MIT License 文本，年份为 `2026`，copyright holder 使用 `learn-pi-agent contributors`。

- [ ] **Step 5: 运行入口文件验证**

Run:

```powershell
$requiredRootFiles = @('README.md', 'ROADMAP.md', 'LICENSE')
$missingRootFiles = $requiredRootFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingRootFiles.Count -gt 0) { throw "Missing root files: $($missingRootFiles -join ', ')" }
$requiredReadmeTerms = @('Pi Agent', '中文', 'ROADMAP.md', 'earendil-works/pi')
$readmeText = Get-Content -Raw -LiteralPath 'README.md'
$missingReadmeTerms = $requiredReadmeTerms | Where-Object { -not $readmeText.Contains($_) }
if ($missingReadmeTerms.Count -gt 0) { throw "README missing terms: $($missingReadmeTerms -join ', ')" }
'Task 1 validation passed'
```

Expected: `Task 1 validation passed`。

- [ ] **Step 6: 提交入口与路线**

```powershell
git add -- README.md ROADMAP.md LICENSE
git commit -m "docs: add project introduction and learning roadmap"
```

---

### Task 2: 创建读者入门文档

**Files:**
- Create: `docs/00-start/01-what-you-will-learn.md`
- Create: `docs/00-start/02-how-to-use-this-repo.md`
- Create: `docs/00-start/03-source-version.md`

**Interfaces:**
- Consumes: `README.md` 的项目定位和 `ROADMAP.md` 的阶段名称。
- Produces: README 的正式阅读入口，以及 references 中版本基线的通俗说明。

- [ ] **Step 1: 运行入门文件检查并确认它失败**

Run:

```powershell
$startFiles = @(
  'docs/00-start/01-what-you-will-learn.md',
  'docs/00-start/02-how-to-use-this-repo.md',
  'docs/00-start/03-source-version.md'
)
$existingStartFiles = $startFiles | Where-Object { Test-Path -LiteralPath $_ }
if ($existingStartFiles.Count -gt 0) { throw "Expected start files to be absent: $($existingStartFiles -join ', ')" }
'Start files are absent as expected'
```

Expected: `Start files are absent as expected`。

- [ ] **Step 2: 编写“你将学到什么”**

`docs/00-start/01-what-you-will-learn.md` 使用读者能力而不是文件清单来描述结果：

- 能解释普通模型调用与 Agent 的区别。
- 能读懂 user、assistant、tool call、tool result 和流式事件。
- 能画出 Pi 的三层主结构并说明职责。
- 能沿 `AgentSession → Agent/AgentHarness → runAgentLoop → pi-ai provider` 查找调用链。
- 能解释 Session 树和 compaction 解决的问题。
- 明确本仓库不保证读者学完即可重写完整 Pi。

- [ ] **Step 3: 编写“如何使用本仓库”**

`docs/00-start/02-how-to-use-this-repo.md` 给出三种阅读方式：

1. 初学者顺序阅读：从基础章节开始，不先跳到完整源码图。
2. 有 API 经验的读者：从 API 对比与工具调用开始，再进入 pi-ai。
3. 有 Agent 经验的读者：从源码地图和运行追踪开始，遇到概念再回看基础章节。

同时加入作者的第一个 30 分钟行动：

```text
1. 阅读 Pi 官方 README 的包列表。
2. 在纸上或笔记中写下 pi-ai、pi-agent-core、pi-coding-agent 各自的一句话职责。
3. 阅读“从大模型到 Agent”。
4. 用自己的话回答：模型什么时候只是返回消息，程序什么时候真正执行动作？
```

- [ ] **Step 4: 编写“源码版本为什么重要”**

`docs/00-start/03-source-version.md` 解释：

- Pi 仍在快速演进，`main` 的文件路径和行为会改变。
- 本仓库区分“当前上游状态”和“文章写作基线”。
- 首个基线 commit 为 `086c32e74530564922d011ade23ff582c9d63116`。
- 读者应该优先点击带 commit 的源码链接，而不是依赖文章中的历史行号。
- 详细记录链接到 `../../references/version-baseline.md`。

- [ ] **Step 5: 验证三个入门文件**

Run:

```powershell
$startFiles = @(
  'docs/00-start/01-what-you-will-learn.md',
  'docs/00-start/02-how-to-use-this-repo.md',
  'docs/00-start/03-source-version.md'
)
$missingStartFiles = $startFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingStartFiles.Count -gt 0) { throw "Missing start files: $($missingStartFiles -join ', ')" }
$sourceVersionText = Get-Content -Raw -LiteralPath 'docs/00-start/03-source-version.md'
if (-not $sourceVersionText.Contains('086c32e74530564922d011ade23ff582c9d63116')) { throw 'Source version page is missing baseline commit' }
'Task 2 validation passed'
```

Expected: `Task 2 validation passed`。

- [ ] **Step 6: 提交入门文档**

```powershell
git add -- docs/00-start
git commit -m "docs: add reader onboarding guide"
```

---

### Task 3: 固定来源、术语、论文和源码地图

**Files:**
- Create: `references/version-baseline.md`
- Create: `references/source-map.md`
- Create: `references/glossary.md`
- Create: `references/papers.md`

**Interfaces:**
- Consumes: Pi commit `086c32e74530564922d011ade23ff582c9d63116`、Pi 官方 README、Pi 官方文档以及论文原文链接。
- Produces: 后续文章引用源码、术语和论文时使用的单一基准。

- [ ] **Step 1: 重新验证远端基线 commit**

Run:

```powershell
$expectedPiCommit = '086c32e74530564922d011ade23ff582c9d63116'
$actualPiCommit = (git ls-remote https://github.com/earendil-works/pi.git HEAD).Split("`t")[0]
"Historical baseline: $expectedPiCommit"
"Current upstream HEAD: $actualPiCommit"
if ($actualPiCommit -ne $expectedPiCommit) { 'Upstream changed after planning; retain the historical baseline and record this newer HEAD in the verification log' }
```

Expected at plan creation time: historical baseline 与 current upstream HEAD 都为 `086c32e74530564922d011ade23ff582c9d63116`。如果执行时 HEAD 已变化，不替换历史基线；在 `version-baseline.md` 的“核对记录”中同时记录新 HEAD 和实际执行日期。

- [ ] **Step 2: 编写版本基线**

`references/version-baseline.md` 必须包含：

| 来源 | 固定值或文档 | 核对日期 |
|---|---|---|
| Pi repository | `https://github.com/earendil-works/pi` | `2026-08-16` |
| Pi commit | `086c32e74530564922d011ade23ff582c9d63116` | `2026-08-16` |
| Pi docs | `https://pi.dev/docs/latest` | `2026-08-16` |
| OpenAI function calling | `https://developers.openai.com/api/docs/guides/function-calling` | `2026-08-16` |
| OpenAI Chat Completions | `https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create` | `2026-08-16` |
| Anthropic tool use | `https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools` | `2026-08-16` |
| MCP specification | `https://modelcontextprotocol.io/specification/` | `2026-08-16` |

文档还要解释固定 commit、核对日期和当前 HEAD 的区别。

- [ ] **Step 3: 编写包级源码地图**

`references/source-map.md` 只做第一层地图，不提前深入每个实现细节。必须包含这些固定链接和职责：

- [`packages/ai`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/ai)：统一多供应商模型 API。
- [`packages/agent`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/agent)：Agent runtime、工具调用、状态和 harness。
- [`packages/coding-agent`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/coding-agent)：交互式 coding agent 产品运行层。
- [`packages/tui`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/tui)：终端 UI。
- [`packages/telemetry`](https://github.com/earendil-works/pi/tree/086c32e74530564922d011ade23ff582c9d63116/packages/telemetry)：供应商中立的遥测契约。
- [`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/ai/src/types.ts)：模型消息、内容块和事件类型。
- [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/types.ts)：Agent 消息、工具和事件类型。
- [`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/086c32e74530564922d011ade23ff582c9d63116/packages/agent/src/agent-loop.ts)：低层 Agent Loop。

正文明确告诉初学者：先读类型和 loop，再进入 `coding-agent`，不要从 CLI/TUI 所有入口同时展开。

- [ ] **Step 4: 编写术语表**

`references/glossary.md` 至少定义这些术语，并在首次出现时同时写中英文：

```text
Large Language Model (LLM) / 大语言模型
Model Provider / 模型供应商
Message / 消息
Context / 上下文
Context Window / 上下文窗口
Token
Streaming / 流式响应
Content Block / 内容块
Tool / 工具
Tool Call / 工具调用请求
Tool Result / 工具结果
Agent Loop / Agent 循环
Turn / 轮次
Session / 会话
Compaction / 上下文压缩
Harness / 运行编排层
Extension / 扩展
Skill / 技能
MCP / Model Context Protocol
```

术语表必须强调：上下文不是模型自动保存的永久记忆；工具调用是模型提出的结构化请求，真正执行动作的是宿主程序。

- [ ] **Step 5: 编写论文索引**

`references/papers.md` 按主题而不是发表年份组织，每篇只包含“为什么与本仓库有关”的一到两句话：

- 基础模型：Attention Is All You Need、Language Models are Few-Shot Learners、InstructGPT。
- 推理与行动：Chain-of-Thought、ReAct。
- 工具使用：Toolformer、Gorilla。
- 记忆与上下文：Generative Agents、Lost in the Middle、MemGPT、LongLLMLingua。
- 评测：AgentBench、SWE-bench。

链接使用论文原文的 arXiv 或正式发表页面，不引用二手摘要替代论文。

- [ ] **Step 6: 验证参考文件的基线一致性**

Run:

```powershell
$referenceFiles = @(
  'references/version-baseline.md',
  'references/source-map.md',
  'references/glossary.md',
  'references/papers.md'
)
$missingReferenceFiles = $referenceFiles | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missingReferenceFiles.Count -gt 0) { throw "Missing reference files: $($missingReferenceFiles -join ', ')" }
$referenceText = ($referenceFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_ }) -join "`n"
if (-not $referenceText.Contains('086c32e74530564922d011ade23ff582c9d63116')) { throw 'References are missing the Pi baseline commit' }
if ($referenceText.Contains('github.com/badlogic/pi-mono/blob/main')) { throw 'References contain an unpinned legacy Pi source link' }
'Task 3 validation passed'
```

Expected: `Task 3 validation passed`。

- [ ] **Step 7: 提交参考资料**

```powershell
git add -- references
git commit -m "docs: add source and research references"
```

---

### Task 4: 编写第一篇“从大模型到 Agent”

**Files:**
- Create: `docs/01-foundations/01-from-llm-to-agent.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: `references/glossary.md` 的术语、`references/papers.md` 的论文入口和项目定位。
- Produces: 初学者的第一篇正文，以及后续“模型 API”“消息与上下文”“工具调用”“最小 Agent Loop”章节的共同直觉。

- [ ] **Step 1: 写出文章验收清单并确认当前文件不存在**

Run:

```powershell
$chapterPath = 'docs/01-foundations/01-from-llm-to-agent.md'
if (Test-Path -LiteralPath $chapterPath) { throw "$chapterPath should not exist before Task 4" }
$requiredIdeas = @('模型调用', '上下文', '循环', '工具', '宿主程序', 'Pi')
$requiredIdeas
```

Expected: 输出六个必须在正文中得到解释的概念。

- [ ] **Step 2: 编写开场问题和普通模型调用**

文章使用一个具体问题开场：“为什么一个能回答问题的大模型，还不等于一个能完成任务的 Agent？”

第一部分用下面的最小抽象建立直觉：

```ts
const response = await model.generate(messages);
```

正文必须解释：

- 模型接收本次请求中的消息并生成结果。
- 对话历史通常由应用在后续请求中再次发送，不应说成模型自动拥有永久记忆。
- 普通文本响应本身不会读取文件、执行命令或调用外部服务。

- [ ] **Step 3: 从限制自然引出 Agent**

用下面的等式作为教学近似，而不是严格学术定义：

```text
Agent ≈ Model + Context + Loop + Tools + State
```

逐项解释它们解决的问题，并明确真正执行工具的是宿主程序。随后用伪代码展示最小循环：

```ts
while (true) {
  const message = await model.generate(context);
  context.push(message);

  if (!message.toolCall) break;

  const result = await executeTool(message.toolCall);
  context.push(result);
}
```

正文提醒读者：真实 Pi 还需要流式事件、参数校验、错误处理、取消、队列、会话持久化和供应商适配，但本章暂不展开。

- [ ] **Step 4: 用一次工具调用串起完整过程**

使用“查询当前天气”作为概念例子：

```text
用户问题
→ 模型返回 get_weather 调用请求
→ 宿主程序校验并执行 get_weather
→ 工具结果写入上下文
→ 模型根据结果生成最终回答
```

不发送真实网络请求，不绑定具体模型，不把 OpenAI 或 Anthropic 的字段格式提前塞进本章；API 格式留给下一篇。

- [ ] **Step 5: 连接到 Pi，但不提前深入源码**

结尾只建立三层导航：

```text
pi-ai：统一模型供应商
pi-agent-core：处理 Agent Loop、工具调用与状态
pi-coding-agent：把核心能力组织成交互式 coding agent
```

链接到 `../../references/source-map.md`，并用三个问题收尾：

1. 如果没有循环，模型返回一次工具调用后会发生什么？
2. 工具结果为什么还要再次发送给模型？
3. 哪部分代码应该知道 OpenAI 与 Anthropic 的格式差异？

- [ ] **Step 6: 更新 README 与 ROADMAP 的状态和入口**

README 的“开始学习”链接指向该文章。ROADMAP 将第一篇标记为已完成，但不把后续计划章节写成可点击的死链接。

- [ ] **Step 7: 验证第一篇正文**

Run:

```powershell
$chapterPath = 'docs/01-foundations/01-from-llm-to-agent.md'
if (-not (Test-Path -LiteralPath $chapterPath)) { throw 'First chapter is missing' }
$chapterText = Get-Content -Raw -LiteralPath $chapterPath
$requiredIdeas = @('模型调用', '上下文', '循环', '工具', '宿主程序', 'Pi')
$missingIdeas = $requiredIdeas | Where-Object { -not $chapterText.Contains($_) }
if ($missingIdeas.Count -gt 0) { throw "First chapter missing ideas: $($missingIdeas -join ', ')" }
if ($chapterText -match 'api[_-]?key|sk-[A-Za-z0-9]') { throw 'First chapter may contain credential-like text' }
'Task 4 validation passed'
```

Expected: `Task 4 validation passed`。

- [ ] **Step 8: 提交第一篇正文**

```powershell
git add -- README.md ROADMAP.md docs/01-foundations/01-from-llm-to-agent.md
git commit -m "docs: explain the path from models to agents"
```

---

### Task 5: 添加贡献指南并完成本地文档审查

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: Markdown files only when the verification finds a concrete issue.

**Interfaces:**
- Consumes: 所有首个版本 Markdown 文件。
- Produces: 统一写作约束和一份通过的本地验证结果。

- [ ] **Step 1: 编写贡献指南**

`CONTRIBUTING.md` 必须说明：

- 不使用固定章节模板，按概念、API 对比、源码解析、运行追踪、论文背景和参考手册选择自然结构。
- 新章节开头应让读者知道它解决什么问题。
- 源码事实、官方说明和作者推断必须明确区分。
- Pi 源码链接必须固定到基线 commit；若升级基线，需要先更新版本记录。
- 当前 API 只引用官方文档并标注核对日期。
- 论文优先引用原文，并说明与 Pi 的具体关系。
- 不接受 API Key、Token、浏览器数据、本地绝对路径和大段无许可转载。
- issue 和 PR 标题建议使用中文，代码标识保留原始英文。

- [ ] **Step 2: 检查所有内部 Markdown 链接**

Run:

```powershell
$markdownFiles = Get-ChildItem -Recurse -File -Filter '*.md'
$brokenLinks = [System.Collections.Generic.List[string]]::new()
foreach ($file in $markdownFiles) {
  $content = Get-Content -Raw -LiteralPath $file.FullName
  foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\((?!https?://|mailto:|#)([^)#]+)(?:#[^)]+)?\)')) {
    $relativeTarget = $match.Groups[1].Value
    $resolvedTarget = Join-Path -Path $file.DirectoryName -ChildPath $relativeTarget
    if (-not (Test-Path -LiteralPath $resolvedTarget)) {
      $brokenLinks.Add("$($file.FullName): $relativeTarget")
    }
  }
}
if ($brokenLinks.Count -gt 0) { throw "Broken Markdown links:`n$($brokenLinks -join "`n")" }
'Internal Markdown links passed'
```

Expected: `Internal Markdown links passed`。

- [ ] **Step 3: 检查敏感信息和本地路径**

Run:

```powershell
$trackedTextFiles = git ls-files '*.md' 'LICENSE'
$content = ($trackedTextFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_ }) -join "`n"
$forbiddenPatterns = @(
  'sk-[A-Za-z0-9]{16,}',
  'gh[pousr]_[A-Za-z0-9]{16,}',
  'C:\\Users\\',
  '/Users/[^/]+/',
  '/home/[^/]+/'
)
foreach ($pattern in $forbiddenPatterns) {
  if ($content -match $pattern) { throw "Sensitive or local-path pattern found: $pattern" }
}
'Sensitive information scan passed'
```

Expected: `Sensitive information scan passed`。

- [ ] **Step 4: 检查版本链接和 Git 差异**

Run:

```powershell
$allMarkdown = (Get-ChildItem -Recurse -File -Filter '*.md' | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
if ($allMarkdown.Contains('github.com/earendil-works/pi/blob/main/')) { throw 'Found unpinned Pi blob link' }
if ($allMarkdown.Contains('github.com/earendil-works/pi/tree/main/')) { throw 'Found unpinned Pi tree link' }
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 只显示本任务尚未提交的 `CONTRIBUTING.md` 或验证中明确修复的 Markdown 文件。

- [ ] **Step 5: 提交贡献指南和验证修复**

```powershell
git add -- CONTRIBUTING.md README.md ROADMAP.md docs references
git commit -m "docs: add contribution and source quality rules"
```

---

### Task 6: 创建公开 GitHub 仓库并推送首个版本

**Files:**
- No new local content files.
- External state: GitHub public repository `learn-pi-agent`.

**Interfaces:**
- Consumes: 通过本地验证、工作树干净的 `main` 分支。
- Produces: 可公开访问的 GitHub 仓库 `https://github.com/Jialei-03/learn-pi-agent`、远程 `origin`、描述和 Topics。

- [ ] **Step 1: 验证发布前 Git 状态**

Run:

```powershell
if ((git branch --show-current) -ne 'main') { throw 'Default local branch must be main' }
if (git status --porcelain) { throw 'Working tree must be clean before publication' }
git log --oneline --decorate -10
```

Expected: 当前分支为 `main`，工作树干净，日志包含设计、计划、入口、入门、参考、第一篇和贡献指南提交。

- [ ] **Step 2: 通过已登录的 GitHub 界面创建仓库**

在 `https://github.com/new` 创建仓库：

- Repository name: `learn-pi-agent`
- Description: `从基础概念、主流模型 API 与经典论文出发，逐步读懂 Pi Agent 的设计思想与源码实现。`
- Visibility: `Public`
- Initialize this repository with a README: unchecked
- Add `.gitignore`: none
- Choose a license: none

创建动作已经由用户明确授权。提交创建前再次核对可见性为 Public，避免误建为私有仓库或在远端生成冲突的初始提交。

- [ ] **Step 3: 设置远端并推送**

从 GitHub 创建成功页面核对 owner 为当前登录账户 `Jialei-03`，然后执行：

```powershell
$learnPiAgentRemote = 'https://github.com/Jialei-03/learn-pi-agent.git'
if ($learnPiAgentRemote -ne 'https://github.com/Jialei-03/learn-pi-agent.git') { throw 'Unexpected GitHub clone URL' }
git remote add origin $learnPiAgentRemote
git push -u origin main
```

Expected: 推送成功，`main` 跟踪 `origin/main`。仓库创建成功页面必须显示 `Jialei-03/learn-pi-agent`；如果 GitHub 实际 owner 与该值不一致，停止执行而不是修改远端 URL。

- [ ] **Step 4: 添加 Topics**

在仓库页面的 About 设置中添加以下 Topics：

```text
pi-agent
ai-agent
agent-loop
tool-calling
llm
typescript
source-code
chinese
```

- [ ] **Step 5: 验证公开仓库**

Run:

```powershell
git remote -v
git status --short --branch
git ls-remote --heads origin main
```

Expected:

- `origin` 的 fetch/push URL 都以 `/learn-pi-agent.git` 结尾。
- 本地显示 `main...origin/main`，没有未提交文件。
- `git ls-remote` 返回 `refs/heads/main`。

随后在未使用登录态的公开网页请求中验证仓库首页返回成功，并确认页面显示 Public、README、ROADMAP 和第一篇正文。

---

## Final Verification Checklist

- [ ] `git status --short --branch` 显示干净的 `main...origin/main`。
- [ ] 所有内部 Markdown 链接通过验证。
- [ ] 敏感信息和本地路径扫描通过。
- [ ] 所有 Pi 源码链接固定到 commit `086c32e74530564922d011ade23ff582c9d63116`。
- [ ] README、ROADMAP、入门页、参考页和第一篇正文可以在 GitHub 直接阅读。
- [ ] GitHub 仓库为 Public，仓库名为 `learn-pi-agent`。
- [ ] GitHub Description 和八个 Topics 与 Global Constraints 完全一致。
- [ ] 未添加 VitePress、网站部署或 Agent 产品代码。
