# Linear Learning Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除冗余导读层，把 Learn Pi Agent 改成从第一章开始、按编号从头读到尾的单线学习仓库。

**Architecture:** README 只承担仓库定位与唯一阅读入口；ROADMAP 只列线性章节顺序和状态；版本信息留在 references 中按需查阅。删除 `docs/00-start` 后同步清理公开内容中的旧链接，历史设计与实施记录保持不变。

**Tech Stack:** Markdown、SVG、Git、PowerShell 文档验证

## Global Constraints

- 正文继续使用简体中文。
- 不新增多路线、读者分流或“第一个 30 分钟”等学习方法内容。
- 第一个学习入口必须直接指向 `docs/01-foundations/01-from-llm-to-agent.md`。
- `references/version-baseline.md` 保留，但不列为读者开始学习前的必读步骤。
- 面向读者的正文不布置练习、作业、自测或思考题，不要求读者回答、记录、画图或复述。
- 可以用问题引出讲解，但必须在正文中直接给出解释，不能把问题留给读者。
- 不改写第一章的知识讲解，只清理结尾自测并改写衔接；不新增第二章，不修改 Pi 基线 commit。
- CONTRIBUTING 中面向贡献者的质量检查清单保留。
- 历史 specs 和 plans 保留为决策记录，不按当前导航倒改历史。

---

## File Structure

删除：

```text
docs/00-start/01-what-you-will-learn.md
docs/00-start/02-how-to-use-this-repo.md
docs/00-start/03-source-version.md
```

修改：

```text
README.md       # 唯一、直接的阅读入口
ROADMAP.md      # 简短的线性章节清单
CONTRIBUTING.md # 增加“正文不布置作业”的写作规则
docs/01-foundations/01-from-llm-to-agent.md # 删除结尾自测，保留知识讲解
references/source-map.md # 把三轮阅读任务改成三条直接讲解的观察主线
references/papers.md # 删除记录任务
```

保留：

```text
docs/01-foundations/01-from-llm-to-agent.md
references/version-baseline.md
docs/superpowers/specs/*
docs/superpowers/plans/*
```

---

### Task 1: 删除导读层并建立唯一入口

**Files:**
- Delete: `docs/00-start/01-what-you-will-learn.md`
- Delete: `docs/00-start/02-how-to-use-this-repo.md`
- Delete: `docs/00-start/03-source-version.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 已完成的第一章和 `references/version-baseline.md`。
- Produces: README 中唯一的线性阅读入口。

- [ ] **Step 1: 运行旧导读存在性检查**

Run:

```powershell
$oldStartFiles = Get-ChildItem -LiteralPath 'docs/00-start' -File -Filter '*.md'
if ($oldStartFiles.Count -ne 3) { throw "Expected 3 old start files, found $($oldStartFiles.Count)" }
$oldStartFiles.Name
```

Expected: 输出三篇旧导读文件。

- [ ] **Step 2: 删除三篇旧导读**

使用 `apply_patch` 删除三个文件；目录为空后无需保留占位文件。

- [ ] **Step 3: 简化 README 的学习入口**

把原来的“从这里开始”改成：

```markdown
## 从这里开始

按编号从头读到尾即可，不需要先选择阅读路线：

1. [第 1 章：从大模型到 Agent](docs/01-foundations/01-from-llm-to-agent.md)
2. 后续章节按照 [ROADMAP](ROADMAP.md) 的顺序继续。

源码仍在变化。正文中的 Pi 源码链接固定到同一 commit；遇到路径或行为差异时，再查阅[版本基线](references/version-baseline.md)。
```

删除以下内容：

- 三篇 `docs/00-start` 链接；
- “如果你只有 30 分钟”；
- “当前首篇正文已经完成”的重复说明。

- [ ] **Step 4: 验证唯一入口**

Run:

```powershell
if (Test-Path -LiteralPath 'docs/00-start') {
  $remaining = Get-ChildItem -LiteralPath 'docs/00-start' -Force
  if ($remaining.Count -gt 0) { throw 'docs/00-start still contains files' }
}
$readme = Get-Content -Raw -LiteralPath 'README.md'
if (-not $readme.Contains('按编号从头读到尾即可')) { throw 'README lacks linear reading instruction' }
if (-not $readme.Contains('docs/01-foundations/01-from-llm-to-agent.md')) { throw 'README does not start at chapter 1' }
if ($readme.Contains('02-how-to-use-this-repo')) { throw 'README still links the removed guide' }
'Task 1 passed'
```

Expected: `Task 1 passed`。

- [ ] **Step 5: 提交删除与入口调整**

```powershell
git add -- README.md docs/00-start
git commit -m "docs: remove redundant reader onboarding"
```

---

### Task 2: 把 ROADMAP 压缩成线性章节清单

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: README 的“按编号从头读到尾”规则。
- Produces: 唯一的后续章节顺序。

- [ ] **Step 1: 写出 ROADMAP 验收条件**

新的 ROADMAP 只保留三部分：

```text
一句阅读规则
线性章节表
状态说明
```

章节表按以下顺序排列：

```text
1. 从大模型到 Agent
2. 模型 API 与消息
3. 工具调用
4. 最小 Agent Loop
5. Pi 的包级架构
6. pi-ai：统一模型供应商
7. pi-agent-core：状态、事件与循环
8. pi-coding-agent：会话、工具与资源
9. Session、上下文窗口与 compaction
10. 完整源码运行追踪
11. MCP、安全、评测与多 Agent
```

第 1 章标为 `已完成` 并链接正文；其余标为 `计划中`，不创建空链接。

- [ ] **Step 2: 重写 ROADMAP**

删除阶段 0–6 的长段解释、读者能力描述和分流语言，改为一个 Markdown 表格：

```markdown
| 顺序 | 内容 | 状态 |
| --- | --- | --- |
| 1 | [从大模型到 Agent](docs/01-foundations/01-from-llm-to-agent.md) | 已完成 |
| 2 | 模型 API 与消息 | 计划中 |
```

继续补全上述 11 项。表格后只解释：`已完成` 可以点击，`计划中` 暂不创建空文件。

- [ ] **Step 3: 验证 ROADMAP 没有旧导读和多路线**

Run:

```powershell
$roadmap = Get-Content -Raw -LiteralPath 'ROADMAP.md'
$requiredRows = @('从大模型到 Agent','模型 API 与消息','工具调用','最小 Agent Loop','Pi 的包级架构','pi-ai','pi-agent-core','pi-coding-agent','Session','完整源码运行追踪','MCP、安全、评测与多 Agent')
foreach ($row in $requiredRows) {
  if (-not $roadmap.Contains($row)) { throw "ROADMAP missing: $row" }
}
foreach ($removed in @('阶段 0','如何使用本仓库','选择阅读路径','初学者顺序阅读')) {
  if ($roadmap.Contains($removed)) { throw "ROADMAP still contains: $removed" }
}
'Task 2 passed'
```

Expected: `Task 2 passed`。

- [ ] **Step 4: 提交线性路线图**

```powershell
git add -- ROADMAP.md
git commit -m "docs: simplify the learning roadmap"
```

---

### Task 3: 删除面向读者的作业和自测

**Files:**
- Modify: `docs/01-foundations/01-from-llm-to-agent.md`
- Modify: `references/source-map.md`
- Modify: `references/papers.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: 第一章、源码地图和论文索引中的现有教学内容。
- Produces: 只负责解释、不向读者布置任务的正文规则与内容。

- [ ] **Step 1: 运行作业式表达检查并确认当前存在匹配**

Run:

```powershell
$readerFiles = @(
  'README.md',
  'ROADMAP.md',
  'docs/01-foundations/01-from-llm-to-agent.md',
  'references/source-map.md',
  'references/papers.md'
)
$taskPhrases = @(
  '第一次练习',
  '带着三个问题',
  '先不用查看答案',
  '用一张不超过',
  '第一次阅读：只跟',
  '第二次阅读：只跟',
  '第三次阅读：只跟',
  '读论文时建议记录'
)
$hits = foreach ($file in $readerFiles) {
  Select-String -LiteralPath $file -SimpleMatch -Pattern $taskPhrases
}
if (-not $hits) { throw 'Expected homework-style phrases before Task 3' }
$hits
```

Expected: 至少命中第一章、源码地图和论文索引中的任务式表达。

- [ ] **Step 2: 把第一章结尾改成直接衔接**

删除 `## 带着三个问题进入下一阶段` 及其三个问题和“画图讲给别人听”的要求，替换为：

```markdown
## 下一阶段：模型 API 如何表达这个过程

本章建立了模型、宿主程序、上下文、工具与循环之间的基本关系。下一章会沿同一次工具调用，直接比较 OpenAI 与 Anthropic 如何表示消息、Tool Call 和 Tool Result，并说明这些差异为什么需要由 `pi-ai` 的 Provider 层吸收。
```

保留此前已经直接解释答案的教学问句，例如“如果没有循环会发生什么”。

- [ ] **Step 3: 把源码地图的阅读任务改成观察主线**

把 `## 推荐阅读顺序` 改为 `## 三条核心观察主线`：

- `### 消息主线`：直接说明消息进入、转换和追加的位置；
- `### 事件主线`：直接说明从 `agent_start` 到 `agent_end` 的事件作用；
- `### 工具主线`：直接说明 Tool Call、校验、执行、Tool Result 和终止条件；
- 结尾说明这三条主线共同构成进入 `coding-agent` 前的最小地图，不要求读者分三轮完成任务。

- [ ] **Step 4: 清理论文任务并增加写作规则**

从 `references/papers.md` 删除：

```markdown
读论文时建议记录四项：**任务设置、输入输出、主要比较、作者承认的局限**。只记住方法名字，很容易把研究结论扩张到论文没有验证的场景。
```

在 `CONTRIBUTING.md` 的“写作原则”下增加：

```markdown
### 正文只负责讲解

面向读者的章节不布置练习、作业、自测或思考题，也不要求读者回答、记录、画图或复述。可以用问题引出概念，但必须紧接着给出解释；章节结尾只做知识总结和下一章衔接。
```

- [ ] **Step 5: 验证作业式表达已经消失**

Run:

```powershell
$hits = foreach ($file in $readerFiles) {
  Select-String -LiteralPath $file -SimpleMatch -Pattern $taskPhrases
}
if ($hits) { throw "Homework-style phrases remain:`n$($hits -join "`n")" }
$contributing = Get-Content -Raw -LiteralPath 'CONTRIBUTING.md'
if (-not $contributing.Contains('正文只负责讲解')) { throw 'CONTRIBUTING lacks the no-homework rule' }
'Task 3 passed'
```

Expected: `Task 3 passed`。

- [ ] **Step 6: 提交教学表达调整**

```powershell
git add -- CONTRIBUTING.md docs/01-foundations/01-from-llm-to-agent.md references/source-map.md references/papers.md
git commit -m "docs: remove homework from reader content"
```

---

### Task 4: 全仓验证、合并并推送

**Files:**
- Modify: Markdown files only if validation finds a concrete broken link.

**Interfaces:**
- Consumes: Task 1 的唯一入口、Task 2 的线性 ROADMAP 和 Task 3 的纯讲解内容。
- Produces: 公开仓库 `main` 上无断链的简化学习路径。

- [ ] **Step 1: 检查公开内容是否仍引用旧导读**

历史 specs/plans 不参与当前导航检查。

Run:

```powershell
$publicFiles = @('README.md','ROADMAP.md','CONTRIBUTING.md') +
  (Get-ChildItem -LiteralPath 'docs/01-foundations','references' -File -Filter '*.md' | ForEach-Object FullName)
$oldPathHits = $publicFiles | Select-String -Pattern 'docs/00-start|02-how-to-use-this-repo|03-source-version'
if ($oldPathHits) { throw "Public content still references old guides:`n$($oldPathHits -join "`n")" }
'Old guide references: PASS'
```

- [ ] **Step 2: 检查全部内部 Markdown 链接**

Run:

```powershell
$readerRoots = @(
  'README.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'docs/01-foundations',
  'references'
)
$markdownFiles = foreach ($root in $readerRoots) {
  if (Test-Path -LiteralPath $root -PathType Leaf) {
    Get-Item -LiteralPath $root
  } else {
    Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.md'
  }
}
$broken = [System.Collections.Generic.List[string]]::new()
foreach ($file in $markdownFiles) {
  $content = Get-Content -Raw -LiteralPath $file.FullName
  foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\((?!https?://|mailto:|#)([^)#]+)(?:#[^)]+)?\)')) {
    $target = Join-Path $file.DirectoryName $match.Groups[1].Value
    if (-not (Test-Path -LiteralPath $target)) { $broken.Add("$($file.FullName): $target") }
  }
}
if ($broken.Count -gt 0) { throw "Broken Markdown links:`n$($broken -join "`n")" }
'Internal links: PASS'
```

- [ ] **Step 3: 运行版本、敏感信息与 Git 检查**

Run:

```powershell
$publicText = ($publicFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_ }) -join "`n"
if ($publicText.Contains('github.com/earendil-works/pi/blob/' + 'main/')) { throw 'Unpinned Pi blob link' }
if ($publicText.Contains('github.com/earendil-works/pi/tree/' + 'main/')) { throw 'Unpinned Pi tree link' }
foreach ($pattern in @('sk-[A-Za-z0-9]{16,}','gh[pousr]_[A-Za-z0-9]{16,}','C:\\Users\\')) {
  if ($publicText -match $pattern) { throw "Sensitive pattern: $pattern" }
}
git diff --check
```

Expected: 无错误。

- [ ] **Step 4: 合并到 main 并验证远端一致性**

执行分支收尾流程，合并完成后推送：

```powershell
git push origin main
$local = git rev-parse main
$remote = (git ls-remote origin refs/heads/main).Split("`t")[0]
if ($local -ne $remote) { throw "Remote mismatch: $local vs $remote" }
'Remote main: PASS'
```

Expected: `Remote main: PASS`。
