---
motto: 先想清楚再动手，边做边记录，做错了能退回去。
learn:
  - 计划模式：只读调研 → 提交计划 → 用户批准 → 执行；为什么用工具调用而不是解析文本来交接
  - 任务清单：让长任务的进度对模型和用户都可见；状态为什么要存在会话里
  - 检查点：每次提问前给代码拍快照，/rewind 同时回退代码和对话
  - 扩展之间怎么协作：事件总线和工具注解
  - 读 Pi 官方的三个示例，看它们各自的局限：正则猜计划、白名单漏命令、stash 抓不到新文件
prereq: 第 7、9、14 章
time: 90 分钟
build: extensions/plan-mode、extensions/todo、extensions/checkpoint —— 三个协同工作的 Pi 扩展
---

## 三个缺口

前面的章节让 Agent 能做事、能安全地做事。这一章解决的是“做大一点的事”时暴露出来的三个问题：

1. **动手太快。** 一个涉及十几个文件的需求，模型读了两个文件就开始改。方向错了，改得越多，越难收拾。
2. **做着做着就忘了。** 长任务进行到一半，模型忘了还有哪几步没做；用户也看不出它做到哪了。
3. **做错了退不回去。** 对话可以用会话树回到过去（第 7 章），文件改动却没法跟着回去。

Claude Code 对应的功能是计划模式、TodoWrite 工具和检查点（`/rewind`）。Pi 没有内置任何一个，但它的示例目录里有三个相关的扩展：`plan-mode`、`todo.ts`、`git-checkpoint.ts`。这一章先读它们，再写我们自己的版本，看看每个设计决定背后的取舍。

## 计划模式

### 先看一次完整的过程

计划模式把一次任务分成两段：**调研和规划**时只能读文件、运行只读命令；用户**批准计划**之后，才能修改文件。下面的实验把三个扩展装进同一个 Pi 会话（计划模式、第 14 章的权限扩展、本章的任务清单）：用户先输入 `/plan`，模型读文件、试着编辑（被拦下）、运行一条只读命令，然后提交计划，用户批准，模型开始编辑。

@lab node labs/ch16/plan.ts

三处值得停下来看：

- 第二行：计划模式里的 `edit` 被拒绝，**没有弹确认框**。用户不需要为一个注定被拒绝的调用点“允许”。
- 整个过程只有一个对话框，就是批准计划的那个。批准之后的 `edit` 没有再问：批准时选的是“自动接受编辑”，权限扩展随之切到了 `acceptEdits`。
- `exit_plan_mode` 只在计划模式里出现在模型的工具列表里，批准之后就消失了。

<figure class="diagram">
<svg viewBox="0 0 720 270" role="img" aria-label="计划模式的状态流转">
<defs><marker id="a16" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a16o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
<g font-size="12.5" text-anchor="middle" fill="var(--ink)">
<rect x="16" y="108" width="110" height="44" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="71" y="135">普通模式</text>
<rect x="170" y="84" width="200" height="92" rx="10" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="270" y="106" font-weight="700" fill="var(--accent-ink)">计划模式</text><text x="270" y="126" font-size="11.5">只能读文件、跑只读命令</text><text x="270" y="144" font-size="11.5">exit_plan_mode 出现在工具列表</text><text x="270" y="162" font-size="11.5">权限扩展也切到 plan 模式</text>
<polygon points="470,94 536,130 470,166 404,130" fill="var(--bg)" stroke="var(--accent)"/><text x="470" y="127" font-size="12">用户审批</text><text x="470" y="143" font-size="11.5" fill="var(--muted)">计划</text>
<rect x="566" y="16" width="140" height="62" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="636" y="36" font-weight="700">批准 · 自动接受编辑</text><text x="636" y="54" font-size="11.5" fill="var(--muted)">回到普通模式</text><text x="636" y="70" font-size="11.5" fill="var(--muted)">权限切到 acceptEdits</text>
<rect x="566" y="100" width="140" height="62" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="636" y="120" font-weight="700">批准 · 逐个确认</text><text x="636" y="138" font-size="11.5" fill="var(--muted)">回到普通模式</text><text x="636" y="154" font-size="11.5" fill="var(--muted)">权限切到 default</text>
<rect x="566" y="184" width="140" height="62" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="636" y="204" font-weight="700">不批准 + 意见</text><text x="636" y="222" font-size="11.5" fill="var(--muted)">意见作为工具结果</text><text x="636" y="238" font-size="11.5" fill="var(--muted)">交回给模型</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.3" fill="none" marker-end="url(#a16)">
<path d="M126 130H168"/><path d="M370 130H402"/><path d="M536 130L564 52"/><path d="M536 130H564"/><path d="M536 130L564 214"/>
</g>
<path d="M566 215H270V178" stroke="var(--accent)" stroke-width="1.5" fill="none" stroke-dasharray="5 4" marker-end="url(#a16o)"/>
<g font-size="11.5" fill="var(--muted)" text-anchor="middle"><text x="147" y="122">/plan</text><text x="386" y="122">提交</text><text x="420" y="236" fill="var(--accent-ink)">继续规划，重新提交</text></g>
</svg>
<figcaption>计划模式的状态流转。批准后回到普通模式，同时把权限切到用户选的那一档；不批准则带着意见回到计划模式。</figcaption>
</figure>

这个过程里有三个设计决定：计划怎么交接，只读怎么保证，扩展之间怎么协作。

### 计划怎么交接：解析文本，还是调用工具

模型怎么告诉 Agent“计划写好了”？Pi 的示例从模型的回答里找一个 `Plan:` 标题，再解析下面的编号列表：

@pi packages/coding-agent/examples/extensions/plan-mode/utils.ts#extractTodoItems

这段代码的每一行都在猜模型的格式：标题可能加粗，编号可能用 `.` 或 `)`，太短的条目被丢掉，以反引号开头的被跳过，超过 50 个字符的被截断。模型换一种写法（比如用“## 计划”），计划就“不存在”了。执行阶段也是同样的做法：示例让模型每做完一步在回答里写一个 `[DONE:n]` 标记，再用正则扫出来打钩：

@pi packages/coding-agent/examples/extensions/plan-mode/utils.ts#extractDoneSteps

而且审批发生在**一次运行结束之后**（示例在 `agent_end` 事件里弹出选择框）：模型已经把话说完，用户的修改意见要作为一条新消息重新开始一轮。

我们的版本用一个工具 `exit_plan_mode`：模型写完计划后调用它，参数就是计划本身。工具调用是**结构化**的，也是模型**明确发出**的信号——不需要猜它写完了没有、格式是什么。审批发生在这次工具调用**之内**：对话框弹出，用户选择，选择的结果就是工具的返回值，模型在同一次运行里接着干。这也是 Claude Code 的做法（它的工具就叫 ExitPlanMode）。用户有三个选项：

- **批准，并自动接受编辑**：退出计划模式，同时把权限切到 `acceptEdits`；
- **批准，编辑逐个确认**；
- **不批准**：输入修改意见，作为工具结果交给模型，继续规划。

### 只读怎么保证

计划模式的承诺是“调研阶段什么都不会被改”。Pi 的示例分两层兑现。第一层是工具：进入计划模式时，把 `edit` 和 `write`（常量 `PLAN_MODE_DISABLED_TOOLS`）从启用的工具里去掉，模型根本看不到它们：

@pi packages/coding-agent/examples/extensions/plan-mode/index.ts#L86-L109

`bash` 去不掉，因为调研离不开它（`git log`、`grep`）。所以第二层是命令：`tool_call` 钩子在计划模式下检查每一条 bash 命令，不安全就拦下：

@pi packages/coding-agent/examples/extensions/plan-mode/index.ts#L163-L174

判断函数是一份正则白名单（`^ls`、`^cat`、`^git status`……）加一份正则黑名单（`rm`、`mv`、输出重定向、`npm install`……）：命中黑名单一律否决，没命中白名单也否决。

@pi packages/coding-agent/examples/extensions/plan-mode/utils.ts#L80-L101 hl=80,86,89,90,98-100

我们的版本不另写一份正则，而是直接复用第 14 章的规则引擎：`decidePermission` 的 `plan` 模式只放行它认定为只读的调用。第 14 章已经花了大力气处理复合命令、包装命令、重定向，计划模式白拿一份。同一批命令交给两边：

@lab node labs/ch16/readonly.ts | md

正则白名单漏过了五条会修改东西的命令：`find -delete` 和 `sort -o` 只是在白名单命令后面多了一个参数；`git branch new-feature` 在黑名单里只防了 `branch -d` 一种写法；`curl … | sh` 里 `curl` 在白名单上、`sh` 不在黑名单上。这不是示例写得粗心：**一条命令是自由文本，同一个命令加上不同的参数，效果就不同**，枚举“好的”和“坏的”永远有缺口（第 14 章的黑名单与白名单之争）。mox 的引擎更保守——它认定的只读命令少，所以误拦了 `sed -n`——但它也不是完备的：`tree -o` 同样被放过了。

所以计划模式是**护栏，不是边界**。它用工具列表、闸门和一段隐藏的提示，让模型在调研阶段“不想也不能”乱动；要真正保证只读，得在操作系统层面限制进程（第 15 章的沙箱，只读挂载工作目录）。这条原则和第 14 章一脉相承。

### 扩展之间的协作

计划模式要和第 14 章的权限扩展配合，这里有两个问题。

**谁来拒绝？** 如果两个扩展各管各的，进入计划模式后模型试图编辑文件，权限扩展（default 模式）会先弹出“允许吗？”，用户点了允许，计划模式再把它拦下——白问了一次。解决办法是让计划模式**通知**权限扩展切换模式。Pi 提供了扩展之间的事件总线 `pi.events`：计划模式发出 `permissions:set-mode`，权限扩展监听它。进入计划模式时切到 `plan`，批准时切到 `acceptEdits` 或 `default`。两个扩展互不依赖：没装权限扩展，事件就没人接收，计划模式自己的只读检查照样生效。上面实验里“被拒绝的 `edit` 没有弹框”，靠的就是这个事件。

**内部工具要不要审批？** `exit_plan_mode` 和下一节的 `todo_write` 只改变 Agent 自己的状态，不碰文件、不碰网络。权限扩展不认识它们，按“未知工具”处理就会弹框确认——在计划模式里甚至会直接拒绝。我们让这类工具声明 `annotations: { readOnlyHint: true }`，权限扩展信任这个声明——但只信任扩展注册的工具。MCP 工具的同名注解来自外部服务器，第 12 章说过不能信。

### mox 的计划模式扩展

把上面三件事放在一起，就是这个扩展。关注几处：`setActive` 同时做几件事（工具列表、会话记录、权限模式）；`tool_call` 闸门复用规则引擎；`exit_plan_mode` 的审批和三种结局；最后的 `restore` 让开关状态跟着会话走。

@code extensions/plan-mode/index.ts#createPlanModeExtension collapse=true hl=22-26,41-48,58-62,69-75

`pi.appendEntry('plan-mode', …)` 把开关状态记成会话里的一条自定义记录。恢复会话、在会话树上切换分支时（`session_start`、`session_tree` 事件），扩展沿着当前分支找最后一条记录——和下一节任务清单是同一个思路。

## 任务清单

### todo_write

长任务需要一份清单，让模型自己知道做到哪了，也让用户看得到。先看 Pi 示例的设计：工具参数是一个动作（`list`、`add`、`toggle`、`clear`）加上条目 id：

@pi packages/coding-agent/examples/extensions/todo.ts#L31-L35

模型每次只发一个小动作，开销很低，但它必须自己记住每一项的 id；说错了 id，得到的是一条“Todo #7 not found”。我们的工具参照 Claude Code 的 TodoWrite，走另一个方向：

- 每次写入**完整的**清单，而不是增删单项。模型看到的永远是完整的当前状态，也不会出现“删掉了不存在的第 3 项”这类错误；代价是每次都要重复输出整张清单。
- 状态只有三种：`pending`、`in_progress`、`completed`。**同一时间只能有一个 `in_progress`**：逼着模型一件一件地做，做完立即标记。

@code extensions/todo/index.ts#createTodoExtension collapse=true hl=45-55,60-63,65-67

工具的描述里写清楚了什么时候用（三步以上的任务）、什么时候不用（简单的一两步）。这和第 11 章 Skill 的描述一样重要：模型照着描述决定行为。

### 状态存在哪里

清单是状态，状态要放在某个地方。三个选择，各自会坏在哪里：

| 存放位置 | 会坏在哪里 |
| --- | --- |
| 扩展的内存 | 会话恢复（`--continue`）时丢失 |
| 一个文件 | 用户在会话树上回到过去（第 7 章），文件里的清单还是“现在”的，和对话对不上 |
| 工具结果的 `details` | 几乎没有；代价是每个结果都带着一份完整清单，多占一点会话文件 |

Pi 官方 todo 示例的做法值得学：**状态存在工具结果的 `details` 里**。每次 `todo` 的结果都带着完整的清单；需要当前状态时，沿着当前分支找到最后一次结果：

@pi packages/coding-agent/examples/extensions/todo.ts#L110-L133

会话本身就是事件日志，状态是从日志推出来的。切换分支（`session_tree` 事件）时重新推一遍，清单就自动回到那个时间点的样子。本章的计划模式扩展用 `pi.appendEntry` 记录开关状态，是同一个思路。

### 让清单留在视线里

清单写在第 5 轮的工具结果里，到第 50 轮时，模型还记得吗？长任务中途压缩（第 8 章）之后，那条结果可能已经不在上下文里了。所以每次用户提问时，如果还有没完成的项，扩展把当前清单作为一条隐藏消息附上。

@lab node labs/ch16/todo.ts

实验依次展示了：正常的更新；两个 `in_progress` 被拒绝，**状态保持不变**（清单是模型的工作记忆，不能被一次错误的调用弄乱）；下一次提问时附上的隐藏清单；回到会话树上更早的节点，清单也回到了那时的样子。

## 检查点

### Pi 的示例：git stash create

Pi 的示例是一个不到 60 行的扩展：

@pi packages/coding-agent/examples/extensions/git-checkpoint.ts#L10-L53 hl=15-18,22-26,29-31,44,51

思路很巧：`git stash create` 生成一个包含当前改动的 stash 提交，却不改变工作区。每一轮开始前（`turn_start`）创建一个，记在内存里的 `Map` 中；用户 fork 的时候（`session_before_fork`），问一句“要不要把代码也恢复到那时”，要就 `git stash apply`。逐段看它的局限：

- **工作区干净时什么都不返回。** 第 22 行拿到空字符串，第 24 行的 `if (ref && …)` 就不记。第一轮往往是最需要回退的那一轮，恰好没有检查点（下面的实验验证）。
- **第一轮还有另一个原因。** `currentEntryId` 只在 `tool_result` 事件里被赋值（第 15-18 行）；在会话里第一次出现工具结果之前，它是 `undefined`，快照即使创建了也不会被记下。
- **只包含 git 已跟踪的文件。** 模型新建的文件不在快照里（下面的实验验证）。
- **检查点只存在内存里。** 一次运行结束（`agent_settled`，第 49-52 行）就清空，会话恢复后也没有了。
- **只能在 fork 的时候恢复**，而且没有界面时（第 33 行）不恢复。

### 影子仓库

我们的做法是一个“影子” git 仓库：它的 `.git` 放在 Agent 的数据目录里（不碰项目自己的 `.git`），工作目录就是项目目录。每次用户提问、Agent 动手之前，`git add -A` 加 `git commit`，就是一个完整的快照。

<figure class="diagram">
<svg viewBox="0 0 720 270" role="img" aria-label="检查点：每次提问前拍快照，rewind 时先备份、再恢复文件、再回到对话中的位置">
<defs><marker id="a16c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a16co" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
<g font-size="12.5" text-anchor="middle" fill="var(--ink)">
<text x="20" y="20" text-anchor="start" font-weight="700" fill="var(--muted)">平时：每次提问</text>
<rect x="20" y="30" width="100" height="44" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="70" y="57">提问 1</text>
<rect x="136" y="30" width="100" height="44" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="186" y="50" fill="var(--accent-ink)" font-weight="700">拍快照 S1</text><text x="186" y="66" font-size="11" fill="var(--accent-ink)">add -A + commit</text>
<rect x="252" y="30" width="100" height="44" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="302" y="57">Agent 改文件</text>
<rect x="368" y="30" width="100" height="44" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="418" y="57">提问 2</text>
<rect x="484" y="30" width="100" height="44" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="534" y="50" fill="var(--accent-ink)" font-weight="700">拍快照 S2</text><text x="534" y="66" font-size="11" fill="var(--accent-ink)">add -A + commit</text>
<rect x="600" y="30" width="100" height="44" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="650" y="57">Agent 改文件</text>
<text x="20" y="108" text-anchor="start" font-size="11.5" fill="var(--muted)">每个快照的 commit 用 pi.appendEntry 记进会话：恢复会话、切换分支后检查点还在</text>
<text x="20" y="140" text-anchor="start" font-weight="700" fill="var(--muted)">/rewind 选「提问 1」，恢复代码和对话</text>
<rect x="20" y="152" width="210" height="62" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="125" y="174" font-weight="700">① 先拍一张当前状态 B</text><text x="125" y="192" font-size="11.5" fill="var(--muted)">/rewind 本身也可以撤销</text><text x="125" y="207" font-size="11.5" fill="var(--muted)">B 也记进会话</text>
<rect x="255" y="152" width="210" height="62" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="360" y="174" font-weight="700" fill="var(--accent-ink)">② read-tree -u --reset S1</text><text x="360" y="192" font-size="11.5" fill="var(--accent-ink)">快照里有的写回去，之后新建的删掉</text><text x="360" y="207" font-size="11.5" fill="var(--accent-ink)">被 .gitignore 忽略的不动</text>
<rect x="490" y="152" width="210" height="62" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="595" y="174" font-weight="700">③ navigateTree(提问 1)</text><text x="595" y="192" font-size="11.5" fill="var(--muted)">对话回到那条记录</text><text x="595" y="207" font-size="11.5" fill="var(--muted)">旧对话留在旧分支，新对话从这里长出</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.3" fill="none" marker-end="url(#a16c)">
<path d="M120 52H134"/><path d="M236 52H250"/><path d="M352 52H366"/><path d="M468 52H482"/><path d="M584 52H598"/><path d="M230 183H253"/><path d="M465 183H488"/>
</g>
<path d="M186 76V120H360V150" stroke="var(--accent)" stroke-width="1.5" fill="none" stroke-dasharray="5 4" marker-end="url(#a16co)"/>
<text x="370" y="138" font-size="11.5" fill="var(--accent-ink)" text-anchor="start">用 S1 恢复</text>
<rect x="20" y="232" width="680" height="28" rx="8" fill="var(--bg-soft)"/><text x="360" y="251" font-size="12" text-anchor="middle" fill="var(--muted)">快照只在 Agent 的数据目录里；项目自己的 .git 不受影响，项目的 .gitignore 照样生效</text>
</svg>
<figcaption>检查点的两条路径。上面是平时：每次用户提问、Agent 动手之前拍一张快照；下面是 /rewind：先备份当前状态，再恢复文件，最后把对话移回那次提问。</figcaption>
</figure>

快照和恢复都在 `CheckpointStore` 里：

@code extensions/checkpoint/store.ts#CheckpointStore hl=18,20,33,36,51,53

- **`--git-dir` 指向影子仓库，`--work-tree` 指向项目目录**（18 行）：两边分开，项目自己的 `.git` 不受影响；工作目录相同，所以项目的 `.gitignore` 照样生效，再额外排除 `node_modules/` 这类大目录（33 行）。
- **影子仓库禁用钩子**（20 行 `core.hooksPath=/dev/null`）。第 15 章说过，`.git/hooks` 是执行代码的入口。
- **没有变化也生成一个提交**（36 行 `--allow-empty`），这样每个检查点都有自己的 id，不会出现“这次提问没有快照”。
- **恢复用 `git read-tree -u --reset`**（53 行）：快照里有的文件写回去，之后新建的文件删掉，被忽略的文件不动。
- **恢复之前先拍一张**（51 行）：`/rewind` 本身也可以撤销。

快照的 commit 记在会话里（`pi.appendEntry`），所以会话恢复后检查点还在，切换分支时也能找到对应的检查点。`/rewind` 让用户选择回到哪次提问之前、恢复什么：

@code extensions/checkpoint/index.ts#createCheckpointExtension collapse=true hl=26-34,47-53

恢复对话用的是 `ctx.navigateTree`：把当前位置移到那条检查点记录，后面的对话留在旧分支上，新的对话从这里长出来——这正是第 7 章的会话树。

下面的实验里，第一次提问让模型用三种方式改文件（`edit` 工具改的、`bash` 追加的、新建的文件），第二次提问删掉一个文件，然后 `/rewind` 回到第一次提问之前。最后还跑了一次 Pi 示例用的 `git stash create` 做对照：

@lab node labs/ch16/checkpoint.ts

三种改动和一次删除，全部回到了原样，对话也回到了第一次提问之前（0 条消息）。对照部分验证了上面读源码得到的两个结论：干净的工作区里 `git stash create` 什么都不返回；新建的 `src/list.ts` 不在快照里。

### 取舍

影子仓库给整个工作目录拍快照，所以 bash 造成的改动也能恢复。Claude Code 的检查点只跟踪它的文件编辑工具改过的文件：bash 单独改的文件不能恢复，你自己在编辑器里的改动也不受影响。两种设计各有道理：

| | 整个工作目录（本章） | 只跟踪 Agent 编辑过的文件（Claude Code） |
| --- | --- | --- |
| bash 的改动 | 能恢复 | 不能（除非这个文件也被编辑工具改过） |
| 你同时手动改的文件 | **也会被回退** | 不受影响 |
| 开销 | 每次提问扫描一遍工作目录（git 是增量的，通常很快） | 只保存改过的文件 |

如果你习惯在 Agent 工作时自己也改代码，回退整个目录可能把你的改动一起带走。`/rewind` 之前拍的那张快照就是为这种情况准备的。另外，两者都**不能代替 git**：检查点是会话级的后悔药，长期的历史还是要靠提交。

mox 版本（`extensions/checkpoint/mox.ts`）只恢复代码，对话用 mox 自带的 `/tree` 和 `/branch`。

::: compare Claude Code
- **计划模式**：是权限模式的一种（Shift+Tab 切换）。模型用 ExitPlanMode 工具提交计划，用户可以选择批准并自动接受编辑、批准但逐个确认、或者继续规划。
- **TodoWrite**：内置工具，界面上实时显示清单。
- **检查点**：每次提问自动创建，保存最近 100 个，随会话保存（会话恢复后仍可 `/rewind`），默认保留约 30 天。`/rewind`（或连按两次 Esc）可以恢复代码和对话、只恢复对话、只恢复代码，还可以“从这里开始压缩”或“压缩到这里”。限制：bash 单独改的文件、子 Agent 的改动、外部改动不跟踪；符号链接和硬链接的文件不恢复。

官方文档：[Checkpointing](https://code.claude.com/docs/en/checkpointing)
:::

## 你来改

每道题先写下预测，再动手验证。

::: predict 去掉 exit_plan_mode 的只读注解
删掉 `extensions/plan-mode/index.ts` 里 `exit_plan_mode` 工具定义中的 `annotations: { readOnlyHint: true }` 这一行，运行 `node labs/ch16/plan.ts`。模型提交计划时会发生什么？用户能看到审批对话框吗？
???
提交本身就被拒绝了：`权限：计划模式：只能读，不能执行 exit_plan_mode`。用户看不到审批对话框，模型被困在计划模式里，之后的 `edit` 也全部被拒绝，文件没有被改；实验末尾的断言会报错。

原因是两道闸门各管各的。计划模式自己的闸门放行了 `exit_plan_mode`（代码里的 `ALWAYS_ALLOWED`），但权限扩展也处在 `plan` 模式，而它不认识这个工具，就按“不是只读”处理。注解正是让它认出“这个工具只改 Agent 自己的状态”的办法。任何一道闸门说“拦下”，调用就被拦下。
:::

::: predict 用 checkout 代替 read-tree
把 `extensions/checkpoint/store.ts` 里 `restore` 的 `this.git(['read-tree', '-u', '--reset', commit])` 换成 `this.git(['checkout', commit, '--', '.'])`，运行 `node labs/ch16/checkpoint.ts`。`/rewind` 之后三个文件分别是什么状态？恢复提示里会写什么？
???
`src/cli.ts` 和 `README.md` 回到了原样，但 `src/list.ts` 还留在磁盘上，实验末尾的断言会报错。`checkout <commit> -- .` 只把快照里**有**的文件写回来，不会删除快照里没有、之后才出现的文件。

更糟的是恢复提示仍然写着“删除 src/list.ts”：提示是用两个快照的差异算出来的，并不是实际执行过的操作。提示和现实对不上，比没有提示更危险。`read-tree -u --reset` 让工作目录和索引都变成快照的样子，多出来的文件才会被删掉。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 什么是计划模式？怎么实现？
把任务分成两段：先只读地调研、写出计划，用户批准后才执行。实现上：

- 只读限制复用权限系统（plan 模式只放行只读操作），并用一段隐藏的提示告诉模型现在的规则；
- 计划用一个专门的工具提交（参数就是计划），而不是从回答里解析文本——工具调用是结构化的、明确的信号；
- 批准时可以顺便调整权限模式（比如自动接受编辑），不批准时把意见作为工具结果交还；
- 计划模式的开关状态记在会话里，恢复和切换分支时跟着走。

价值：方向性的错误在动手之前就被发现；用户在最便宜的时候参与决策。
:::

::: interview Agent 的任务清单（todo）工具应该怎么设计？
- 每次写入完整清单，而不是增量修改：模型看到的总是完整状态，避免引用不存在的条目。
- 状态少而明确（待办、进行中、完成），同时只允许一个进行中，促使模型逐项推进、及时标记。
- 工具描述写清楚什么时候该用。
- 状态存在会话里（工具结果的 details），从当前分支推导，保证恢复和分支后正确。
- 让清单留在模型的视线里：压缩后重新提醒，或每次提问时附上未完成的项。
- 校验失败时拒绝并保持原状态。
:::

::: interview 怎样实现“撤销 Agent 的改动”？有哪些方案？
- **影子 git 仓库**：每次提问前给整个工作目录拍快照（遵守 .gitignore），恢复时 read-tree。能恢复 bash 的改动和新建的文件，但会连同用户同时手动做的改动一起回退。
- **只跟踪编辑工具改过的文件**（Claude Code）：在编辑前保存文件原样，精确但不覆盖 bash 的改动。
- **git stash create**（Pi 示例）：轻量，但干净的工作区不产生快照，也不包含未跟踪的文件。
- 共同的要点：恢复前先保存当前状态（撤销可以撤销）；检查点和会话记录关联，对话与代码一起回退；它们都不能代替版本控制。
:::

::: interview 多个扩展（或插件）之间如何协作而不互相依赖？
- **事件总线**：一方发出事件（“切换到 plan 模式”），另一方如果存在就响应，不存在也不影响发出方。
- **声明式的元信息**：工具声明自己的性质（只读、破坏性），由权限等扩展统一解读，而不是互相写死对方的工具名。声明的可信度取决于来源：进程内的扩展可信，外部 MCP 服务器的声明不可信。
- **状态放在共享的会话记录里**，而不是彼此的内存。
- **注意执行顺序**：多个闸门作用于同一个事件时，谁先运行会影响用户体验（比如先弹了确认框，再被另一个扩展拦下）。
:::

::: interview 计划模式怎样保证“只读”？一份命令白名单够吗？
分层，而且要诚实地说明每一层能挡住什么：

- **工具层**：计划模式下把写文件的工具从模型的工具列表里去掉，或者让权限引擎拒绝所有非只读的调用；
- **命令层**：bash 去不掉，要逐条判断。复用权限系统的规则引擎，比另写一份正则更可靠：它已经处理了复合命令、包装命令和重定向；
- **提示层**：用一段隐藏的提示告诉模型现在的规则，减少无谓的尝试。

白名单不够：命令是自由文本，`find -delete`、`sort -o`、`curl … | sh`、`git branch <名字>` 这类“白名单命令加一个参数”会漏过去，Pi 的示例就漏了五条，mox 的引擎也漏了 `tree -o`。真正的边界在操作系统层：沙箱里只读挂载工作目录。计划模式是护栏，让模型“不想也不能”乱动，不是安全边界。
:::
