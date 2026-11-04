---
motto: 二十章的部件，拼起来就是一个能用的 Agent；拼的过程，就是最后一课。
learn:
  - mox 的全貌：每个模块出自哪一章、管什么
  - 一次请求的完整旅程：所有部件同时工作时的先后顺序
  - 组合时才会暴露的问题：职责、顺序和默认值
  - mox、Pi、Claude Code 的功能对照
  - 练习，以及“设计一个 coding agent”这道面试题
prereq: 前面所有章节
time: 40 分钟
build: 回顾整个 mox：约 2900 行核心代码，加上约 2000 行扩展
---

## mox 的全貌

第 1 章的 mox 只有一个文件、不到一百行：一个循环、两个工具。二十章之后，它长成了这样：

<figure class="diagram">
<svg viewBox="0 0 720 330" role="img" aria-label="mox 的分层结构">
<g font-size="12">
<g font-weight="700" fill="var(--muted)" font-size="11">
<text x="14" y="34">接口</text><text x="14" y="88">扩展</text><text x="14" y="156">上下文</text><text x="14" y="214">工具</text><text x="14" y="264">循环</text><text x="14" y="312">模型</text>
</g>
<g fill="var(--bg)" stroke="var(--line-2)">
<rect x="60" y="14" width="200" height="34" rx="6"/><rect x="266" y="14" width="200" height="34" rx="6"/><rect x="472" y="14" width="236" height="34" rx="6"/>
</g>
<g fill="var(--ink)" text-anchor="middle"><text x="160" y="36">命令行 cli.ts（5）</text><text x="366" y="36">JSON / RPC rpc.ts（19）</text><text x="590" y="36">评测 evals/（20）</text></g>
<rect x="60" y="58" width="648" height="62" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
<text x="384" y="76" text-anchor="middle" font-weight="700" fill="var(--accent-ink)">扩展系统 extensions.ts（9）：事件 · 工具 · 命令</text>
<g fill="var(--accent-ink)" font-size="11" text-anchor="middle">
<text x="384" y="94">web-fetch（9）· 记忆（10）· 钩子（13）· 权限（14）· 沙箱（15）</text>
<text x="384" y="110">计划模式 · 任务清单 · 检查点（16）· 后台命令 · 目标循环（18）</text>
</g>
<g fill="var(--bg-soft)" stroke="var(--line-2)">
<rect x="60" y="130" width="124" height="40" rx="6"/><rect x="190" y="130" width="124" height="40" rx="6"/><rect x="320" y="130" width="124" height="40" rx="6"/><rect x="450" y="130" width="124" height="40" rx="6"/><rect x="580" y="130" width="128" height="40" rx="6"/>
</g>
<g fill="var(--ink)" text-anchor="middle" font-size="11">
<text x="122" y="148">系统提示</text><text x="122" y="162">context.ts（6）</text>
<text x="252" y="148">会话树</text><text x="252" y="162">session.ts（7）</text>
<text x="382" y="148">压缩</text><text x="382" y="162">compaction.ts（8）</text>
<text x="512" y="148">Skills / 模板</text><text x="512" y="162">skills.ts（11）</text>
<text x="644" y="148">崩溃恢复</text><text x="644" y="162">resume.ts（18）</text>
</g>
<g fill="var(--bg)" stroke="var(--line-2)">
<rect x="60" y="182" width="210" height="44" rx="6"/><rect x="276" y="182" width="210" height="44" rx="6"/><rect x="492" y="182" width="216" height="44" rx="6"/>
</g>
<g fill="var(--ink)" text-anchor="middle" font-size="11">
<text x="165" y="200">read · write · edit · bash</text><text x="165" y="215">coding/（5）</text>
<text x="381" y="200">MCP 客户端</text><text x="381" y="215">mcp/（12）</text>
<text x="600" y="200">子 Agent</text><text x="600" y="215">subagent.ts（17）</text>
</g>
<rect x="60" y="238" width="648" height="38" rx="6" fill="var(--ink)"/>
<text x="384" y="261" text-anchor="middle" fill="var(--bg)">Agent 循环 loop.ts（3）· 工具流水线 tools.ts、schema.ts（4）· 发送前修复 transcript.ts（7）</text>
<g fill="var(--bg)" stroke="var(--line-2)">
<rect x="60" y="288" width="320" height="34" rx="6"/><rect x="388" y="288" width="320" height="34" rx="6"/>
</g>
<g fill="var(--ink)" text-anchor="middle" font-size="11"><text x="220" y="310">适配器 anthropic.ts · openai.ts · scripted.ts（2）</text><text x="548" y="310">SSE 解析 sse.ts · 半截 JSON partial-json.ts（2）</text></g>
</g>
</svg>
<figcaption>括号里是章节号。越往下越接近“和模型说话”，越往上越接近“和人、和别的程序说话”。每一层只依赖它下面的层——这和 Pi 的分包是同一个原则（第 0 章）。</figcaption>
</figure>

几个数字：mox 的核心（`mox/src/`）约 2900 行，`extensions/` 下的扩展约 2000 行（其中不少同时有 Pi 和 mox 两个版本，共用一份核心逻辑）。作为对照，第 1 章那个能读文件的 Agent 不到 100 行——一个能用的 Agent 和一个能跑的 Agent，差的就是中间这些。

## 一次请求的完整旅程

把前面各章的扩展同时装进 mox：钩子（第 13 章的配置）、权限（acceptEdits 模式，禁止读 `.env`）、记忆、检查点、目标循环、沙箱，再加上 Skills 目录和子 Agent。设定目标“`node test.js` 通过”，然后让它修一个 bug：

@lab node labs/ch21/journey.ts

每一行开头是负责这一步的章节。按顺序看一遍，就是整门课的缩影：扩展加载（第 9 章）→ 设定目标（18）→ 提问前拍快照（16）→ 组装系统提示（6、10、11、13）→ 循环开始（3），每次请求前修复历史（7）→ 交给子 Agent 调研（17）→ 修改文件（5，acceptEdits 下自动放行，14）→ 危险命令被钩子拦下（13）→ `.env` 被拦下（13、14）→ 测试在沙箱里运行（15）→ 保存记忆（10）→ 准备停下时检查目标（18）。

::: steps 一次提问的旅程：从输入到目标达成
--- `host.load` 依次装入 hooks、permissions、memory、checkpoint、goal、sandbox，**sandbox 最后加载**：权限和钩子看到的是改写之前的命令。然后广播 `session_start`。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::on --> B["设定目标<br/>第 18 章"]:::dim --> C["提问前<br/>第 13、16 章"]:::dim --> D["系统提示<br/>第 6、10、11 章"]:::dim --> E["循环<br/>第 3、7 章"]:::dim --> F["工具过关<br/>第 13 到 17 章"]:::dim --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- `/goal "node test.js" 修好 add`：目标扩展只是记下检查命令。真正的检查要等到模型准备停下。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::on --> C["提问前<br/>第 13、16 章"]:::dim --> D["系统提示<br/>第 6、10、11 章"]:::dim --> E["循环<br/>第 3、7 章"]:::dim --> F["工具过关<br/>第 13 到 17 章"]:::dim --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- 用户提问。`host.emitInput` 触发 `input` 事件：钩子扩展跑 `UserPromptSubmit`（没有拦下），检查点扩展给工作目录拍快照，再把提示交给循环。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::done --> C["提问前<br/>第 13、16 章"]:::on --> D["系统提示<br/>第 6、10、11 章"]:::dim --> E["循环<br/>第 3、7 章"]:::dim --> F["工具过关<br/>第 13 到 17 章"]:::dim --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- `emitBeforeAgentStart` 让各扩展往系统提示里加东西：记忆的内容、钩子 `SessionStart` 补充的项目信息，加上 `buildSystemPrompt` 里的工具说明和 Skills 目录。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::done --> C["提问前<br/>第 13、16 章"]:::done --> D["系统提示<br/>第 6、10、11 章"]:::on --> E["循环<br/>第 3、7 章"]:::dim --> F["工具过关<br/>第 13 到 17 章"]:::dim --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- `runLoop` 开始。每一轮先修复历史再请求模型（实验里一共 7 轮）。第 1 轮模型调用 `agent` 工具，把调研交给子 Agent（第 17 章）。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::done --> C["提问前<br/>第 13、16 章"]:::done --> D["系统提示<br/>第 6、10、11 章"]:::done --> E["循环<br/>第 3、7 章"]:::on --> F["工具过关<br/>第 13 到 17 章"]:::dim --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- 模型的每个工具调用都要过 `tool_call` 闸门。edit 在 acceptEdits 下自动放行，`rm -rf build` 和读 `.env` 被拦下，`node test.js` 在沙箱里运行，`save_memory` 由记忆扩展处理——细节见下一个动画。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::done --> C["提问前<br/>第 13、16 章"]:::done --> D["系统提示<br/>第 6、10、11 章"]:::done --> E["循环<br/>第 3、7 章"]:::done --> F["工具过关<br/>第 13 到 17 章"]:::on --> G["准备停下<br/>第 18 章"]:::dim
  G -- 没达成：followUp --> E
--- 没有工具调用了，循环调用 `getFollowUp`，触发 `before_settle`，目标扩展运行 `node test.js`。通过则结束；不通过就返回 `followUp`，回到循环。
flowchart LR
  A["加载扩展<br/>第 9 章"]:::done --> B["设定目标<br/>第 18 章"]:::done --> C["提问前<br/>第 13、16 章"]:::done --> D["系统提示<br/>第 6、10、11 章"]:::done --> E["循环<br/>第 3、7 章"]:::done --> F["工具过关<br/>第 13 到 17 章"]:::done --> G["准备停下<br/>第 18 章"]:::on
  G -- 没达成：followUp --> E
:::

::: steps 一个工具调用要过的关
--- 第 3 轮，模型想执行 `rm -rf build`。`beforeToolCall` 按加载顺序逐个问各扩展的 `tool_call` 处理函数，**第一个返回 `block` 的就结束**。先轮到钩子扩展。
flowchart LR
  CALL["Bash：rm -rf build"]:::on --> H{"钩子<br/>第 13 章"}:::dim --> P{"权限<br/>第 14 章"}:::dim --> SB["沙箱<br/>第 15 章"]:::dim --> EX["执行工具"]:::dim --> POST["结果给模型"]:::dim
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::dim
  P -- "deny 或 ask" --> B1
--- 钩子扩展把 `bash` 翻译成 `Bash` 交给 `block-dangerous.sh`，脚本 `exit 2`：`interpret` 得到 `deny`，处理函数返回 `block`。权限和沙箱都没轮到，错误结果（“禁止执行破坏性命令”）交给模型。
flowchart LR
  CALL["Bash：rm -rf build"]:::done --> H{"钩子<br/>第 13 章"}:::on --> P{"权限<br/>第 14 章"}:::dim --> SB["沙箱<br/>第 15 章"]:::dim --> EX["执行工具"]:::dim --> POST["结果给模型"]:::dim
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::on
  P -- "deny 或 ask" --> B1
--- 第 4 轮，模型想读 `.env`。同样先过钩子：`protect-env.mjs` 拒绝。即使钩子放行，权限扩展里的 `Read(.env)` deny 规则也会拦下它：两层各管一层。
flowchart LR
  CALL["Read：.env"]:::done --> H{"钩子<br/>第 13 章"}:::on --> P{"权限<br/>第 14 章"}:::dim --> SB["沙箱<br/>第 15 章"]:::dim --> EX["执行工具"]:::dim --> POST["结果给模型"]:::dim
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::on
  P -- "deny 或 ask" --> B1
--- 第 5 轮，`node test.js`。钩子扩展没有意见（`verdict` 里没有 `block`），放行到下一个处理函数。
flowchart LR
  CALL["Bash：node test.js"]:::done --> H{"钩子<br/>第 13 章"}:::done --> P{"权限<br/>第 14 章"}:::dim --> SB["沙箱<br/>第 15 章"]:::dim --> EX["执行工具"]:::dim --> POST["结果给模型"]:::dim
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::dim
  P -- "deny 或 ask" --> B1
--- 权限扩展：`decidePermission` 对 Bash 子命令逐个看，`node test.js` 匹配 allow 规则 `Bash(node *)`，返回 allow，不弹窗，也不会因为没有界面而拒绝。
flowchart LR
  CALL["Bash：node test.js"]:::done --> H{"钩子<br/>第 13 章"}:::done --> P{"权限<br/>第 14 章"}:::on --> SB["沙箱<br/>第 15 章"]:::dim --> EX["执行工具"]:::dim --> POST["结果给模型"]:::dim
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::dim
  P -- "deny 或 ask" --> B1
--- 最后一个是沙箱扩展：`wrapCommand` 把 `event.input.command` 改写成 `sandbox-exec … /bin/bash -c 'node test.js'`。它排在最后，权限和钩子才看到原始命令。命令在沙箱里执行，输出 PASS，再经过 `tool_result` 交给模型。
flowchart LR
  CALL["Bash：node test.js"]:::done --> H{"钩子<br/>第 13 章"}:::done --> P{"权限<br/>第 14 章"}:::done --> SB["沙箱<br/>第 15 章"]:::on --> EX["执行工具"]:::on --> POST["结果给模型"]:::on
  H -- "exit 2：block" --> B1["错误结果<br/>交给模型"]:::dim
  P -- "deny 或 ask" --> B1
:::

上面三道关，在 mox 里是三个扩展挂在**同一个** `tool_call` 事件上，按加载顺序依次运行。并排看它们的处理函数：

::: tabs
@@ 钩子
@code extensions/hooks/mox.ts#L41-L52
翻译成 Claude Code 的工具名，运行外部脚本；`block` 就拦下，`updatedInput` 就地改写参数。
@@ 权限
@code extensions/permissions/mox.ts#L15-L26
`decidePermission` 的结果：allow 放行，deny 拦下，ask 在没有界面时按拒绝处理。
@@ 沙箱
@code extensions/sandbox/mox.ts#L33-L39
不判断放行与否，只把 `command` 改写成沙箱命令，所以必须最后加载。
:::

## 组合时才暴露的问题

每个部件单独测试都没问题，装在一起时却会冲突。这门课的实验里实际遇到过的：

1. **职责重叠。** 上面的实验第一次运行时，`save_memory` 被拒绝了：记忆扩展有自己的审核规则（第 10 章：用户说了“记住”就生效），权限扩展又把它当作未知工具要求确认，没有界面就拒绝。两个扩展都在管“这次写入该不该发生”。解决办法是明确由谁负责——这里把 `save_memory` 写进了 allow 规则。
2. **容器不该被审批。** 同一次运行里，`agent` 工具也被拒绝了。子 Agent 和 codemode 脚本（第 15 章）一样，本身没有任何外部效果，它发起的每个工具调用都会单独经过检查。正确的做法是检查效果，不检查容器。
3. **顺序。** 沙箱扩展会改写 bash 命令，必须在权限扩展之后运行，否则权限规则看到的是 `sandbox-exec …`（第 15 章）。计划模式和权限扩展各自拦截时，先运行的那个会先弹出一个白问的对话框（第 16 章）。
4. **默认值的叠加。** “未知工具默认要确认”“没有界面时确认等于拒绝”，单独看都是对的，叠在一起就挡住了正常的功能。
5. **状态放在哪里。** 任务清单、计划模式、检查点的状态都放在会话记录里，切换分支和恢复会话时才不会错乱（第 16 章）。
6. **环境泄漏。** 你电脑上的 `~/.agents/skills`（第 11 章）、代理环境变量（第 15 章）、全局 MCP 配置（第 12 章）都曾混进实验结果。测试和评测必须在隔离的环境里运行。
7. **路径。** macOS 的 `/var` 是 `/private/var` 的符号链接，权限规则（第 14 章）和沙箱策略（第 15 章）都在这里出过错。
8. **生命周期。** MCP 服务器、后台命令是子进程，不在退出时清理，`mox -p` 就退不出来（第 12、18 章）。

这些问题都很难从任何一个部件的文档里读出来，面试里却经常被问到：“你在做 Agent 的时候遇到过什么坑？”

## mox、Pi、Claude Code

| 能力 | mox（本课） | Pi v1.5 | Claude Code |
| --- | --- | --- | --- |
| 循环、工具流水线、并行工具 | 自己写（3、4） | 内置 | 内置 |
| 会话树、分支 | 自己写（7） | 内置 | 会话恢复、`/branch` |
| 压缩 | 自己写，单份摘要（8） | 内置，切开的轮次写两份摘要 | 内置 |
| 扩展 / 插件 | 简化的事件系统（9） | 四十多种事件 | 插件、mods |
| 长期记忆 | 扩展（10） | 无，本课写了扩展 | 内置自动记忆 |
| Skills、提示模板 | 自己写（11） | 内置 | 内置 |
| MCP | 只有 stdio（12） | 内置，四种暴露方式、OAuth | 内置，默认推迟加载 |
| 钩子 | 扩展（13） | 无，本课写了兼容扩展 | 内置 |
| 权限规则与模式 | 扩展（14） | 无，本课写了兼容扩展 | 内置，还有 auto 模式 |
| 沙箱 | Seatbelt 扩展（15） | 容器、微型虚拟机方案；本课写了 Seatbelt 扩展 | 内置 |
| 计划模式、任务清单、检查点 | 扩展（16） | 示例扩展 | 内置 |
| 子 Agent | 进程内（17） | 示例扩展，独立进程 | 内置 |
| 后台命令、目标循环、崩溃恢复 | 扩展、resume（18） | durable 包（实验性） | 后台命令、会话恢复 |
| SDK / JSON / RPC | 模块、JSON、RPC（19） | 全部内置 | Agent SDK、无界面模式 |
| 评测 | 小框架（20） | evals 包 | — |

Pi 的取舍很清楚：内核小而完整，很多功能留给扩展和示例。Claude Code 则把这些都做成了产品功能。学习时 Pi 更合适：每一种机制都能看到最直接的实现，缺的部分自己补上，补的过程就是理解的过程。

## 练习

每道题都能在 mox 上动手完成，括号里是相关的章节：

1. **给 mox 加 `grep` 和 `find` 工具**（5）。注意输出截断、遵守 `.gitignore`、结果太多时提示模型缩小范围。
2. **实现 MCP 的 Streamable HTTP 传输**（12）。读 Pi 的 `packages/mcp/src/transports/streamable-http.ts`，处理会话 ID 和重连。
3. **让 explore 子 Agent 真正只读**（14、17）。给子 Agent 定义加上权限模式，在它的工具钩子里用 plan 模式检查。
4. **给 mox 的 bash 工具加 `spawnHook`**（15），让沙箱扩展不再改写命令参数，权限扩展的顺序问题随之消失。
5. **只跟踪 Agent 改过的文件的检查点**（16），和影子仓库的方案做对比。
6. **压缩写两份摘要**（8）：切开的那一轮单独总结，和 Pi 对齐。
7. **RPC 的确认子协议**（14、19）：权限扩展需要确认时，通过 RPC 把问题发给客户端，等它回答。
8. **“意图先写”**（18）：执行工具之前先在会话里记下意图，恢复时据此判断。
9. **LLM 评分器**（20）：给“解释代码”这类开放任务写一个评分提示，用十几条人工标注校准它。
10. **为你自己的工作流写一个 Skill 和一个子 Agent，然后用评测证明它们有用**（11、17、20）。

## 面试

所有章节的面试题汇总在[面试题库](../interview.html)。最后一道，是把整门课串起来的那一道。

::: interview 请你设计一个 coding agent。
按层次讲，每一层说清楚“做什么”和“难在哪”：

1. **模型适配**：统一的消息格式，适配不同服务商的流式协议；工具参数的增量只用于预览；停止原因归一化，未知的按失败处理（第 2 章）。
2. **循环**：模型回复 → 执行工具 → 结果交回，直到没有工具调用；处理截断、出错、取消；插话和追加任务两个队列（第 3 章）。
3. **工具流水线**：查找、修正、校验、执行前钩子、执行、执行后钩子；并行执行、按顺序返回；同一文件的修改串行（第 4 章）。核心工具：读（带截断）、精确替换的编辑、带进程树清理的 bash（第 5 章）。
4. **上下文**：分节的系统提示和项目约定文件；稳定前缀保护提示缓存（第 6 章）。会话持久化为只追加的树，支持分支和恢复（第 7 章）。快满时压缩，绝不切开工具调用与结果（第 8 章）。
5. **扩展能力**：插件系统（第 9 章）；按需加载的 Skills（第 11 章）；MCP 接入外部工具，工具多时推迟加载（第 12 章）；子 Agent 隔离上下文（第 17 章）；长期记忆（第 10 章）。
6. **安全**：权限规则与模式（第 14 章）；沙箱作为硬边界（第 15 章）；钩子作为团队规矩（第 13 章）；对注入保持警惕：网页、工具结果、记忆、MCP 描述都是不可信的数据。
7. **长任务与可靠性**：计划模式、任务清单、检查点（第 16 章）；后台命令、目标循环、崩溃恢复（第 18 章）。
8. **集成与评测**：SDK、JSON、RPC 三种嵌入方式（第 19 章）；用评测而不是感觉来判断改动的好坏（第 20 章）。

最后补一句取舍：哪些功能放进内核、哪些做成扩展，决定了这个 Agent 是“小而可改”（Pi）还是“大而全”（Claude Code）。
:::

::: interview 从零写一个最小的 Agent，需要哪些部分？
一个调用模型的函数（支持工具定义）、一个循环（有工具调用就执行，把结果加进历史，再请求；没有就结束）、几个工具（至少能读文件、执行命令），再加一个轮数上限。第 1 章的版本不到 100 行。接下来每加一个能力（流式、并行、权限、压缩……），代码量和复杂度都在“正确处理边界情况”上，而不是主干上。
:::

::: interview 你的 Agent 出了问题（越改越乱、成本暴涨、卡住不动），怎么排查？
- 先看轨迹：会话记录里每一轮模型说了什么、调用了什么、得到了什么（第 7、20 章）。
- 越改越乱：是不是在原地打转（重复的调用）、有没有验证、上下文是不是被压缩丢了关键信息（第 8 章）、指令是不是互相矛盾。
- 成本暴涨：看每次请求的输入 token 和缓存命中率——系统提示或工具列表是不是在变（第 6、12 章）；是不是读进了大文件或大量工具结果（第 5、12、17 章）。
- 卡住不动：在等什么——一个不会结束的命令（第 18 章）、一个没回答的权限确认（第 14 章）、一个没响应的 MCP 服务器（第 12 章）、子进程没清理。
- 找到原因后，把这个场景变成一个评测任务，防止它再次发生（第 20 章）。
:::

::: interview 如果让你改进 Pi 或 Claude Code 的某个设计，你会改什么？
这是一道开放题，用这门课里亲手验证过的事实来回答最有说服力。比如：

- Pi 的 RPC 代码注释说 Node 的 readline 会在 U+2028 处断行，在 Node 22 上实测并不会（第 19 章）——注释需要更新，但“只按 \n 切分”的规则是对的。
- Pi 的 git-checkpoint 示例用 `git stash create`，干净的工作区不产生快照，也不包含新建的文件（第 16 章），可以换成影子仓库。
- Claude Code 的检查点不跟踪 bash 的改动，代价是更安全地对待用户自己的修改（第 16 章）——这是一个取舍，可以提供第二种模式。
- 权限系统里，容器类工具（子 Agent、codemode）应该默认免审，只审它们发起的调用（第 15、21 章）。

重点不在于提出了什么，而在于能说清楚现在的设计为什么这样做、改了之后会失去什么。
:::
