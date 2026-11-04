---
motto: 长任务的难处不在“做”，而在“等”“停”和“断了之后”。
learn:
  - 后台命令：开发服务器和长时间构建怎么跑，结束时怎么通知 Agent
  - 目标循环：模型说“完成了”不算，检查通过才算；两道刹车
  - 崩溃之后：哪些工作做了、哪些没做，记录停在哪里就知道断在哪里
  - 崩溃的三个位置：为什么「没有结果」不等于「没有执行」，以及 Pi durable 怎样用“意图先于效果”和重启计数封住窗口
  - 重放安全和幂等：什么时候可以重做，什么时候只能问模型
prereq: 第 3、7、13 章
time: 90 分钟
build: extensions/background、extensions/goal（Pi 与 mox 两个版本），以及 mox 的崩溃恢复（mox/src/resume.ts）
---

## 三种“长”

前面的 Agent 处理的都是一问一答式的任务：用户提问，Agent 跑几轮，回答，结束。真实的工作里有三种“长”会打破这个模式：

1. **命令本身很长。** `npm run dev` 永远不会结束；完整的测试套件跑十分钟。bash 工具要等命令结束才返回，Agent 就卡在那里。
2. **任务本身很长。** “把所有失败的测试修好”需要很多轮，模型可能在第三轮就宣布“完成了”。
3. **运行本身会断。** 笔记本合上了，进程被杀了，网络断了。重新打开时，Agent 应该从哪里继续？

## 后台命令

### 设计

三个工具：

- `bash_background`：启动命令，**立即**返回一个编号；
- `bash_output`：返回自上次查看以来的**新**输出和当前状态；
- `bash_kill`：结束命令（连同它启动的子进程）。

@code extensions/background/jobs.ts#BackgroundJobs collapse=true

几个细节：输出只保留最后 1MB（一个跑了一整天的开发服务器不能把内存吃光）；`bash_output` 只返回新内容（模型每次查看都只付新增部分的 token）；结束时杀整个进程组（第 5 章）；会话结束时清理所有后台命令。

### 结束时通知，而不是轮询

最关键的设计在命令**结束**的时候。模型如果不知道命令什么时候结束，就只能反复调用 `bash_output`——每次都是一次完整的模型请求。更好的办法是让 Agent 闲下来，命令结束时**通知它**：

@code extensions/background/index.ts#createBackgroundExtension collapse=true

`pi.sendMessage` 的两个选项决定了通知怎么送达：`deliverAs: 'followUp'`——Agent 正在工作时，排在当前任务之后（第 3 章的追加队列）；`triggerTurn: true`——Agent 空闲时，开始新的一轮。

@lab node labs/ch18/background.ts

第 0.4 秒，模型启动构建、看了一眼进度，告诉用户“结束时会收到通知”，这次运行结束。第 1.0 秒，构建完成，通知唤醒了 Agent，模型根据最后的输出继续工作。中间这 0.6 秒没有任何模型请求。

mox 版本（`extensions/background/mox.ts`）提供同样的三个工具，但 mox 的扩展不能主动开始新的一轮，命令结束时只在终端提示。

## 目标循环：做完才停

@figure assets/course/ch18-goal.png 目标循环：模型说“完成了”不算，门上的检查通过才算；原地打转或轮数用完就停

### “完成了”不算数

第 13 章的 Stop 钩子展示过一个思路：模型准备停下时，检查一下，不满足就让它继续。目标循环把这个思路做成一个完整的工作方式：

```text
/goal "node test.js" 修好 add 函数
```

模型每次准备停下，扩展都运行一遍检查命令。退出码为 0 才算完成；否则把检查输出的最后部分交给模型，再来一轮。

@code extensions/goal/goal.ts#evaluate

挂在 Pi 的 `agent_before_settle` 上——运行真正结束前的最后一个决策点（第 9 章），处理函数可以追加一条消息并要求继续：

@pi packages/coding-agent/docs/extensions.md#L665-L689

### 两道刹车

一个永远不满足的目标会让 Agent 一直跑下去，烧掉大量 token。所以要有刹车：

- **轮数上限**：最多几轮。
- **原地打转检测**：上一轮什么文件都没改，检查也还是失败，再继续也不会有不同的结果。工作目录的“指纹”（每个文件的路径、大小、修改时间）在两轮之间没有变化，就停下来交给人。

@lab node labs/ch18/goal.ts

第一个场景：模型先是嘴上说“已经修好了”，检查失败，测试的输出（`add(2, 3) = -1，期望 5`）被交回给它；第二轮它真的改了代码，检查通过。第二个场景：模型一直声称修好了却什么都没改，第二轮就被原地打转检测拦下。

这种“把同一个目标反复喂给 Agent，直到客观的检查通过”的做法，社区里常被叫作 Ralph loop。它的前提是有一个**可靠的、可以自动运行的检查**——测试、类型检查、lint。目标越难自动验证（“把界面做得好看一点”），这个模式就越不适用。

## 崩溃之后

### 记录停在哪里，就知道断在哪里

第 7 章让会话的每一条消息一形成就写盘。这正是崩溃恢复的基础：重新打开会话，看最后一条记录是什么：

- **用户消息或工具结果**：模型还欠一个回复。重新请求就行，最多是同一个请求发了两次。
- **助手的工具调用，但缺少结果**：麻烦在这里。工具可能还没开始执行，也可能执行完了，只是结果还没来得及写下。

### 实验

一个子进程运行 mox，模型一次发出三个工具调用：读 README、执行部署命令（往 `deploy.log` 追加一行）、等待 30 秒。部署命令一执行完，父进程就用 `SIGKILL` 杀掉子进程：

@lab node labs/ch18/crash.ts

看第一段：会话记录里只有三个工具调用，**一个结果都没有**，可是 `deploy.log` 里已经有了一行。原因是第 4 章的设计：同一批工具的结果按调用顺序、在全部执行完之后才一起写入。部署命令早就完成了，但它在等那个 `sleep 30`。

**朴素的做法**是把没有结果的调用全部重新执行一遍：部署执行了两次。对读文件来说重放无害，对部署、发邮件、扣款来说就是事故。

### 重放安全

mox 的做法是让工具**声明**自己能不能重放（Pi 的 durable 包用的是同一条规则，后面会读到它的实现）：

@code mox/src/resume.ts#settleInterrupted

`read` 声明了 `replaySafe`（只读，执行多少遍结果都一样），恢复时直接重新执行。其他工具不知道有没有生效，就如实写一条“中断”结果，交给模型去**查证**：实验里模型先 `cat deploy.log`，发现部署已经做过了，没有重复。

`mox --continue` 打开一个没跑完的会话时，会自动做这件事，然后从断点继续：

@code mox/src/cli.ts#region:resume

### mox 漏掉了什么：三个位置的崩溃，记录看起来都一样

上面的实验里，部署命令和 `sleep 30` 都被写成了“中断”，但它们的处境并不相同：部署命令已经做完了，`sleep 30` 还在跑。如果进程死得更早——比如 `bash` 刚要启动——会话里的记录和现在**一模一样**：一条带三个调用的助手消息，没有任何结果。mox 只记录“助手发出调用”和“工具返回结果”，没有记录“工具开始了”。

把一个工具调用的时间线切开，崩溃可能落在三个位置：

- **① 调用已记录，工具还没开始。** 什么都没发生，重新来就行。
- **② 意图已记录，工具刚要开始。** 只有执行前就把“我要执行了”写进存储的实现，才有这个位置。
- **③ 工具跑完了，结果没来得及写。** 效果已经发生。

下面的实验用一个最小的模型，把“三个位置 × 三种恢复策略”排成一张表。它不是 Pi 的代码，只复刻 Pi 的记录方式：“崩溃”就是在那个位置抛出异常、丢掉内存里的一切，恢复时只能读存储；外部世界（部署了几次）不受崩溃影响。

@lab node labs/ch18/sandwich.ts

三列策略分别是：**朴素重放**（没有结果的调用全部重新执行）、**mox**（只靠 `replaySafe` 声明）、**效果三明治**（执行前先把“意图”写进存储，执行后再写结果）。逐行看：

- `read` 在任何位置、任何策略下都没问题：只读，重放安全。
- `deploy` 的第 ③ 行是事故现场：朴素重放让部署生效了两次。mox 和三明治都只生效一次，并把“中断”告诉模型，让它去查证。
- 第 ① 行是 mox 的浪费：部署根本没开始，mox 却写下“中断”，模型要多花一轮 `cat deploy.log`，才知道还得重新部署。三明治在执行前写了意图，所以**没有意图，就说明工具肯定没开始**，可以直接执行，模型什么都不用管。
- 第 ② 和 ③ 行，三明治自己也分不清：意图写下了，但不知道工具有没有开始。这段窗口关不上，因为外部效果和本地写入不可能是同一个原子操作。能做的只有三件事：声明重放安全；给外部操作带上幂等键（最后一组的第 ③ 行：朴素重放让带键的部署执行了 2 次，但只生效 1 次）；老老实实告诉模型“不知道”。

所以三明治的价值不是消灭不确定性，而是把它**压缩到最小的一段**：意图提交和结果提交之间。这段之外的状态都是确定的，恢复时不用问任何人。

### Pi durable：每个工具调用是一个任务

Pi 的 `durable` 包（实验性）是一个从头为“随时可能断”设计的 Agent 运行时：对话、模型请求、工具调用，都在展示给用户**之前**先提交进存储。工具调用的恢复逻辑在 `packages/durable/src/harness/tool.ts`，创建它的地方在 `generation.ts`，重启时的账目在 `scheduler.ts`。规范把上面那个模式叫“效果三明治”：

@pi packages/durable/docs/spec.md#L2372-L2383

最后两句是关键：重新打开时如果停在“意图”阶段，说明效果**可能**已经发生；阶段处理函数可以安全地重试、去轮询外部句柄，或者记录“中断”。一个工具调用在 Pi 里要经过三次提交，三次提交把时间线分成三段，崩溃位置对应的处理方式也就确定了：

<figure class="diagram">
<svg viewBox="0 0 720 392" role="img" aria-label="一个工具调用的三次提交，以及崩溃落在不同位置时的恢复方式">
<defs><marker id="a18" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a18o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
<g font-size="12.5" text-anchor="middle" fill="var(--ink)">
<text x="20" y="30" text-anchor="start" font-weight="700">提交 ①：助手消息 + 工具任务</text>
<text x="300" y="30" font-weight="700">提交 ②：意图</text>
<text x="560" y="30" font-weight="700">提交 ③：结果 + 终态</text>
<rect x="64" y="44" width="12" height="52" rx="3" fill="var(--accent)"/><rect x="294" y="44" width="12" height="52" rx="3" fill="var(--accent)"/><rect x="554" y="44" width="12" height="52" rx="3" fill="var(--accent)"/>
<rect x="90" y="50" width="190" height="40" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="185" y="67" font-size="12">call 阶段：校验参数，</text><text x="185" y="83" font-size="12">运行 beforeTool 钩子</text>
<rect x="318" y="50" width="218" height="40" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="427" y="74" fill="var(--accent-ink)">execute()：外部效果真正发生</text>
<text x="630" y="60" fill="var(--muted)" font-size="12">完成</text>
<path d="M20 70H92" stroke="var(--ink-2)" stroke-width="1.2" fill="none"/><path d="M280 70H316" stroke="var(--ink-2)" stroke-width="1.2" fill="none"/><path d="M536 70H700" stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a18)"/>
<path d="M70 106V114H298V106" stroke="var(--ink-2)" stroke-width="1.2" fill="none"/><path d="M302 106V114H556V106" stroke="var(--accent)" stroke-width="1.6" fill="none"/><path d="M560 106V114H700V106" stroke="var(--line-2)" stroke-width="1.2" fill="none"/>
<text x="184" y="132" fill="var(--ink-2)">崩溃位置 ①</text><text x="429" y="132" fill="var(--accent-ink)" font-weight="700">崩溃位置 ② ③：效果可能已经发生</text><text x="630" y="132" fill="var(--muted)">位置之外</text>
<path d="M184 140V160" stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a18)"/>
<rect x="50" y="162" width="268" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="184" y="184" font-size="12">检查点还是 call：重走 call 阶段</text><text x="184" y="202" font-size="12" fill="var(--muted)">工具肯定没开始，放心重来</text>
<rect x="590" y="162" width="116" height="52" rx="8" fill="var(--bg-soft)"/><text x="648" y="184" font-size="12" fill="var(--muted)">结果已在存储里</text><text x="648" y="202" font-size="12" fill="var(--muted)">无需恢复</text>
<path d="M429 140V226" stroke="var(--accent)" stroke-width="1.5" fill="none" marker-end="url(#a18o)"/>
<polygon points="429,228 549,262 429,296 309,262" fill="var(--bg)" stroke="var(--accent)"/><text x="429" y="258" font-size="12">存下的 replay 和现在</text><text x="429" y="274" font-size="12">注册的都是 safe？</text>
<path d="M309 262H264" stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a18)"/><path d="M549 262H588" stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a18)"/>
<text x="286" y="254" font-size="11.5" fill="var(--muted)">否</text><text x="568" y="254" font-size="11.5" fill="var(--muted)">是</text>
<rect x="30" y="236" width="232" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="146" y="258" font-size="12">写 interrupted 错误结果</text><text x="146" y="276" font-size="12" fill="var(--muted)">带已提交的部分输出，交模型查证</text>
<rect x="590" y="236" width="116" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="648" y="258" font-size="12">清掉上次进度</text><text x="648" y="276" font-size="12">用存下的参数重跑</text>
<path d="M429 296V318" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="4 3" fill="none" marker-end="url(#a18)"/>
<rect x="20" y="320" width="680" height="56" rx="10" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="360" y="344" font-size="12" fill="var(--accent-ink)">每次崩溃，任务的 restarts 加一；提交新的检查点（真正的进展）才会把它清零。</text><text x="360" y="364" font-size="12" fill="var(--accent-ink)">restarts 达到 restartLimit（默认 5）：不再运行，写一条 restart_limit 错误结果。</text>
</g>
</svg>
<figcaption>一个工具调用的三次提交。意图提交之前崩溃，工具肯定没开始；两次提交之间崩溃，效果可能已经发生，只有双方都声明过重放安全的才重跑。</figcaption>
</figure>

### 提交 ①：助手消息和工具任务一起写入

mox 靠“最后一条助手消息里，有没有对应的结果”来推断哪些调用没做完。Pi 不推断：助手消息写入的**同一次提交**里，每个工具调用都建好了自己的任务记录。

@pi packages/durable/src/harness/generation.ts#L1028-L1055 hl=1030,1041,1054

- 第 1030 行 `appendAssistant` 写入助手消息；第 1041 行 `createToolTask` 为每个调用创建一个任务，初始阶段是 `call`。它们在同一个 `runtime.commit` 里，要么都在存储里，要么都不在。所以“消息里有调用，却没有任何记录说明处理到哪了”这种状态不会出现：只要消息在，任务就在。
- 第 1036-1040 行处理顺序执行的批次（有工具声明了 `sequential`）：只为第一个调用建任务，其余的 id 放进 `pending`，检查点记着“还有谁没开始”。
- 第 1054 行返回 `waiting`，`on: tools`：生成任务自己也挂起，等所有工具任务结束（`allSettled`）。崩溃之后，“这一轮还欠哪些工具结果”同样是存储里查得到的。

“要么都在要么都不在”靠的是规范列出的第一条不变量：

@pi packages/durable/docs/spec.md#L65-L67

### 提交 ②：先写意图，再执行

工具任务的 `call` 阶段先解析工具、校验参数、运行 `beforeTool` 钩子，最后提交意图并执行。`execute` 阶段只在恢复时才会进入：

@pi packages/durable/src/harness/tool.ts#L195-L227 hl=196-198,199,208,222-226

- **196-198 行是三明治的上半片。** 提交的检查点里有三样东西：`final`（经过修复、校验、钩子改写之后的**最终参数**），`replay`（工具**当时**声明的重放策略，没声明就是 `unsafe`），以及状态 `running`。这次提交成功之后，第 199 行才真正执行。
- **崩在 196 行之前**（位置 ①）：检查点还是 `call`，重启后从头再走一遍 `call` 阶段。工具肯定没开始，所以安全；代价是 `beforeTool` 钩子可能多跑一次。Pi 的测试 `reruns beforeTool when interrupted before intent, and executes once` 专门验证了这一点：钩子运行 2 次，工具只执行 1 次。
- **崩在 198 行之后**（位置 ② ③）：检查点是 `execute`，重启后进入 202 行开始的恢复函数。第 208 行是这里最重要的判断：**存下来的策略和现在注册的策略都是 `safe`**，才重新执行，并且用**存下来的参数** `args`，不重新解析，因为重新解析可能得到不同的参数。要求两边一致，是因为工具可能在两次启动之间被升级：写下意图时它没有承诺幂等，就不能事后靠一个新的声明追认；反过来，新版本撤回了声明，旧记录也不该再重放。
- **其他情况**（222-226 行）：写一条 `interrupted` 错误结果，说“可能已经部分执行”。`settleFromSlot` 会把这次执行**已经提交的部分输出**一起放进结果，模型能看到工具做到了哪一步。状态记成 `failed`，这个调用拥有的子对话会随之中止。

测试把这条路径完整地跑了一遍：工具执行到一半时关闭存储，重新打开。

@pi packages/durable/test/harness-tools-recovery.test.ts#L109-L134 hl=122-124,126,129-131

重新打开后，存储里的检查点正是 `{ phase: "execute", arguments: {}, replay: "unsafe" }`；工具一共只运行了 1 次（`state.runs`）；模型收到的结果是崩溃前已提交的输出 `run 1`，加上那句“was interrupted and may have partially run”。mox 的 `INTERRUPTED` 做的是同一件事，只是没有那半截输出。

### 提交 ③：结果和终态一起写入

下半片同样是一次提交：

@pi packages/durable/src/harness/tool.ts#L846-L871 hl=848,871

`appendToolResult`（848 行）把结果写成对话里的一个条目，同一个回调随后返回 `terminal`（871 行）——任务的终态。规范说终态转换是原子的：

@pi packages/durable/docs/spec.md#L2399-L2404

写终态记录、追加结果条目、退休任务的文档、结算被它完成的提交，要么全部发生，要么全部不发生。所以存储里不会出现“结果条目已经在对话里，任务却还是 running”这种半成品。mox 用“最后一条消息是不是结果”来判断调用做完没有，在 Pi 里变成了“任务是不是终态”。

### 崩溃也要记账：restartLimit

不确定的窗口已经压到最小，还剩一个隐患：如果某个工具调用（或某次模型请求）会**必然**让进程崩溃——内存耗尽，或者死循环吃满 CPU——“重启、重放、再崩溃”就会无限循环下去。durable 给每个任务记一个重启计数 `restarts`，在调度器打开存储的那一刻结算：

@pi packages/durable/src/harness/scheduler.ts#L453-L457

所有重启前还处于 `running` 的任务，一律改回 `pending`，`restarts` 加一，检查点原样保留。调度器**不知道**是哪个任务害死了进程，所以也不去找：每个正在跑的任务都记一次。（正常的 `close()` 不算崩溃：它把任务写回 `pending`，不加一。）两个阶段的第一步，都先检查这个计数：

@pi packages/durable/src/harness/live.ts#L248-L255

计数达到 `settings.restartLimit`（默认 5），任务就不再运行，而是写一条 `restart_limit` 错误结果：“Tool X was interrupted 3 times in a row; it is not run again”。工具任务在 `call` 和 `execute` 两个阶段的开头（`tool.ts` 第 151 行和第 206 行）都调用它。提交一个**新的**检查点，比如从 `call` 进入 `execute`，算作真正的进展，计数清零。所以重放安全的工具也有上限：连续被打断太多次，同样不再重试。

模型请求适用同一套规则。崩溃时正在进行的请求，算一次失败的尝试：已经收到的半截回复保留为一条 aborted 记录，等待退避时间后再试，直到同一个上限。规范里的表格列出了不同任务到达上限时的结局：

@pi packages/durable/docs/spec.md#L2542-L2547

### 幂等：重放安全不是免责声明

“重放安全”是工具作者的承诺：这个调用重复执行，不会产生额外的效果。承诺要靠幂等来兑现。durable 在三个层面用到它。

**提交。** 用户的一条消息，在网络重试时不能被投递两遍。提交可以带一个 `requestId`，存储按它去重：

@pi packages/durable/src/harness/submissions.ts#L232-L240

同一个 `requestId` 再来一次，返回的是**已有**的那次提交，不是一份新的；类型对不上则直接报错。“至少一次”的重试，加上去重，得到的是“恰好一次”的效果。

**工具。** 重放安全的工具如果调用了外部服务，还得靠自己。durable 的 README 在“嵌套调用”一节里说得很直白：重放安全的调用者重跑时，会拿回它已经发起过的嵌套调用；但被崩溃打断、结果没来得及提交的那一个，遵循它自己的重放策略，所以带外部效果的重放安全工具仍然需要它自己的幂等。

**你自己的任务。** 官方示例 `12-recovery.ts` 展示了没有框架帮忙时，怎样用 memo 手写一个三明治：

@pi packages/durable/test/examples/12-recovery.ts#L26-L49 hl=32-35,41-48

- memo 是“第一个写入者获胜”的小值，跟着任务存储。第 32-35 行：先查 memo，没有就先写 memo，再打印。进程死在打印之后、检查点保存之前，重启后任务重新进入同一个 tick，看到 memo，不会打印第二遍。
- 这个顺序有代价：memo 写在效果**之前**，如果进程死在“写 memo”和“打印”之间，这个 tick 永远不会被打印。换成先打印再写 memo，死在两者之间就会打印两遍。只靠本地存储，只有这两种顺序，只能二选一；想两头都不出事，得靠对方的幂等键（下表最后一行）。
- 第 41-48 行是三明治的下半片：提交结果，或者用 `sleepUntil` 提交下一个检查点和唤醒时间。等待本身也被持久化：任务睡着时不占用任何执行，进程重启后，到点的任务照样醒来。

把几种做法并排放在一起：

| 做法 | 崩在“写意图”之后、“做事”之前 | 崩在“做事”之后、“记结果”之前 | 结果 |
| --- | --- | --- | --- |
| 朴素重放（只记结果） | 重做一遍：没问题 | 重做一遍：**重复** | 至少一次 |
| 先写意图，恢复时不重做（上面的 memo） | 事没做，却以为做了：**漏做** | 不重复 | 至多一次 |
| 先写意图，恢复时交给模型查证（Pi 的工具任务，mox 的“中断”） | 写“中断”，模型查证后补做 | 写“中断”，模型查证后不重复 | 不盲目重复，多花一轮 |
| 做事时带幂等键，恢复时直接重放 | 重做，对方按键去重 | 重做，对方按键去重 | 实际上恰好一次（要对方支持） |

::: compare Claude Code
- **后台命令**：Bash 工具的 `run_in_background` 参数让命令在后台运行，配合读取输出、结束任务的工具；也可以把正在运行的命令或子 Agent 移到后台（Ctrl+B）。后台任务结束时会通知。
- **会话恢复**：`claude --continue` / `--resume` 恢复会话。
- **定时与循环**：`/loop` 按固定间隔反复执行一个提示；云端还有按计划运行的任务。

文档：[Interactive mode](https://code.claude.com/docs/en/interactive-mode)
:::

## 你来改

每道题先写下预测，再动手验证。

::: predict 把所有工具都声明成重放安全
在 `labs/ch18/crash.ts` 里，把第三步的 `const tools = createCodingTools(cwd);` 改成 `const tools = createCodingTools(cwd).map(t => ({ ...t, replaySafe: true }));`，运行 `node labs/ch18/crash.ts`。恢复阶段会花多久？模型还有机会查证吗？部署命令一共执行了几次？
???
恢复要多等 30 秒，部署一共执行了 2 次，模型没有任何机会查证。三个调用都被当成重放安全，直接重新执行：部署又做了一遍，`sleep 30` 也真的又睡了 30 秒；会话里不会出现“中断”结果，模型看到的全是看似正常的输出。实验里新加的断言（三个结果应该是 `[读 README 成功, 中断, 中断]`）会在这一步报错，这正是它的用处。`replaySafe` 是工具作者对“重复执行不产生额外效果”的承诺，不是性能开关：承诺错了，恢复本身就会制造事故。
:::

::: predict 升级之后才声明重放安全
假设 `work` 工具在上一个版本里没有声明 `replay`，执行到一半进程崩溃了。你随后把它升级成声明 `replay: "safe"`，再重启。Pi durable 会重跑它吗？反过来呢：旧记录里是 `safe`，新版本撤回了声明？
???
两种情况都不重跑，模型都会收到 `interrupted` 错误结果。`execute` 阶段的判断是 `replay === "safe" && tool?.replay === "safe"`（`tool.ts` 第 208 行）：左边是写下意图时**存进检查点**的策略，右边是现在注册的策略，必须同时成立。第一种情况存下来的是 `unsafe`（默认值），事后声明不能追认当时没有的承诺；第二种情况新版本撤回了声明，旧记录就不该被重放。策略被冻结在意图里，崩溃之前的决定不会被之后的代码改写。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview Agent 如何处理长时间运行的命令（开发服务器、长测试）？
放到后台：启动后立即返回编号，Agent 可以继续做别的；提供“读取新输出”和“结束”两个操作；输出只保留末尾一段，只返回增量；结束时杀整个进程组，会话结束时清理所有后台进程。

关键是避免轮询：命令结束时由宿主通知 Agent——正在工作就排进追加队列，空闲就唤醒新的一轮。这样等待期间不消耗任何模型请求。
:::

::: interview 怎样防止 Agent 过早宣布“完成”？
不要相信模型的自我报告，用客观的检查：测试、类型检查、lint、构建。在 Agent 准备停下的时刻（Stop 钩子或 settle 事件）运行检查，失败就把输出交还给模型继续。

同时要有刹车：轮数上限；原地打转检测（两轮之间没有任何改动、检查结果也没变）；成本上限。最终仍然失败时，停下来交给人，而不是无限重试。前提是任务有可自动运行的验证手段。
:::

::: interview Agent 进程崩溃后，如何安全地恢复？
- 前提：每条消息一形成就持久化，记录停在哪里就知道断在哪里。
- 模型还欠一个回复：重新请求，并对“导致崩溃的请求”计数、设上限。
- 工具调用缺少结果：不知道效果是否发生。区分重放安全（只读、幂等）的工具和其他工具：前者直接重新执行，后者记录“中断”，交给模型查证现状再决定。
- 更彻底的做法是“效果三明治”：执行前提交意图，执行后提交结果；恢复时根据停在哪个阶段决定重试、查询外部状态或记录中断。
- 外部操作尽量设计成幂等（带请求 ID），这样重试才安全。
:::

::: interview “至少一次”和“至多一次”在 Agent 里分别意味着什么？
至少一次：崩溃后总是重新执行，不会漏，但可能重复——对读操作无害，对部署、发消息、付款是事故。至多一次：崩溃后从不重新执行，不会重复，但可能漏。Agent 的工具调用通常无法做到“恰好一次”，因为外部效果和持久化不是一个原子操作。实际的办法是按工具区分：幂等的用至少一次；有副作用的用至多一次，并把“不确定”如实告诉模型，或者让外部系统支持幂等键，把至少一次变成实际上的恰好一次。
:::

::: interview 什么是“效果三明治”？它解决了什么，没解决什么？
做法：每个有外部效果的步骤，先提交“意图”，再执行，再提交“结果”或下一阶段。重启时看停在哪个阶段：

- 停在意图之前：效果肯定没发生，直接重新开始，不用问任何人；
- 停在意图之后、结果之前：效果**可能**发生了，要么安全地重试（重放安全、幂等），要么去查询外部句柄，要么如实记下“中断”交给模型或人去查证；
- 结果已提交：无需恢复。

解决的是“没有结果”这个状态含糊不清的问题：把不确定压缩到意图提交和结果提交之间的一小段。没解决的是这一小段本身：外部效果和本地存储不是同一个原子操作，所以窗口永远关不上，只能靠重放安全、幂等键或事后查证兜底。加分点：提到存下来的重放策略要和当前注册的一致才重放；崩溃要计数、设上限，防止必然崩溃的调用无限重启。
:::
