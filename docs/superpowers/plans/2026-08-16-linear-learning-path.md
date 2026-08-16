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
- 不重写第一章，不新增第二章，不修改 Pi 基线 commit。
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

### Task 3: 全仓验证、合并并推送

**Files:**
- Modify: Markdown files only if validation finds a concrete broken link.

**Interfaces:**
- Consumes: Task 1 的唯一入口和 Task 2 的线性 ROADMAP。
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
$markdownFiles = Get-ChildItem -Recurse -File -Filter '*.md'
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
