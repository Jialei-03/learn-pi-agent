---
motto: 长任务的难处不在“做”，而在“等”“停”和“断了之后”。
learn:
  - 后台命令：开发服务器和长时间构建怎么跑，mox 的扩展为什么叫不醒一个空闲的 Agent，又怎样用 agent_end 做到“结束时通知”
  - 目标循环：模型说“完成了”不算，检查通过才算；读懂 cli.ts 里那个 while 循环，以及两道刹车
  - 崩溃之后：session.ts 恢复时补“中断”做了什么，没做什么；旧版 mox 的“重放安全”为什么不见了
  - 崩溃的三个位置：为什么「没有结果」不等于「没有执行」，以及 Pi durable 怎样用“意图先于效果”和重启计数封住窗口
  - 重放安全和幂等：什么时候可以重做，什么时候只能问模型
prereq: 第 3、7、9 章
time: 90 分钟
build: extensions/background/mox.ts、extensions/goal/mox.ts（给 mox 写两个扩展，Pi 版本在同目录的 index.ts）；读懂 mox/src/session.ts 的崩溃恢复
---

## 三种“长”

前面的 Agent 处理的都是一问一答式的任务：用户提问，Agent 跑几轮，回答，结束。真实的工作里有三种“长”会打破这个模式：

1. **命令本身很长。** `npm run dev` 永远不会结束；完整的测试套件跑十分钟。bash 工具要等命令结束才返回，Agent 就卡在那里。
2. **任务本身很长。** “把所有失败的测试修好”需要很多轮，模型可能在第三轮就宣布“完成了”。
3. **运行本身会断。** 笔记本合上了，进程被杀了，网络断了。重新打开时，Agent 应该从哪里继续？

前两种用 mox 的扩展接口就能解决，这一章写两个扩展：后台命令和目标循环。第三种在 mox 的 `session.ts` 里已经有一段处理，读完它，再去看 Pi 的 durable 包怎样把同一个问题做到极致。

## 后台命令

### 设计

三个工具：

- `bash_background`：启动命令，**立即**返回一个编号；
- `bash_output`：返回自上次查看以来的**新**输出和当前状态；
- `bash_kill`：结束命令（连同它启动的子进程）。

@code extensions/background/jobs.ts#BackgroundJobs collapse=true

几个细节：输出只保留最后 1MB（一个跑了一整天的开发服务器不能把内存吃光）；`bash_output` 只返回新内容（模型每次查看都只付新增部分的 token）；结束时杀整个进程组（第 5 章）；会话结束时清理所有后台命令。这个类和 Pi 版本共用，mox 扩展只负责把它接到 mox 的接口上。

### 结束时通知：Pi 能做的事，mox 做不到

最关键的设计在命令**结束**的时候。模型如果不知道命令什么时候结束，就只能反复调用 `bash_output`，每次都是一次完整的模型请求。更好的办法是让 Agent 闲下来，命令结束时**通知它**。Pi 的扩展可以随时往会话里发一条消息，选项决定怎么送达：

@code extensions/background/index.ts#L15-L26 hl=18,20-23,26

`deliverAs: 'followUp'`：Agent 正在工作时，排在当前任务之后（第 3 章的追加队列）；`triggerTurn: true`：Agent 空闲时，开始新的一轮。扩展自己决定什么时候开口。

mox 的扩展接口里没有这样的东西。八个接口（`registerTool`、`registerCommand`、`addSystemPrompt`、`ask`、四个事件）里，没有一个能“往会话里塞一句话并叫醒 Agent”。扩展唯一的一次发言机会，是 `agent_end`：Agent 准备停下的那一刻，处理函数可以返回一个字符串，`cli.ts` 把它当作新的用户消息再跑一轮（后面的目标循环用的也是这个）。

所以 mox 的后台命令换了一种约定：**由模型在启动时声明**。`bash_background` 有一个 `notify` 参数：

- 构建、测试这类会结束、而且模型需要结果的命令，设 `notify: true`。模型说完话之后，`agent_end` 处理函数发现还有 notify 的命令在跑，就**等**到它结束，再把结局当作下一句话交给模型。等待期间没有任何模型请求。
- 开发服务器这类不会结束的命令不设 notify，Agent 照常停下。没有人会等它。

@code extensions/background/mox.ts#createBackgroundMoxExtension hl=22,25,31,34,40,42,52,53 collapse=false

逐段看：

- **第 22 行：`shutdown` 事件。** mox 退出时（`-p` 跑完，或者 `/exit`）清理所有后台命令。没有这一行，`mox -p "启动开发服务器"` 结束后，`sleep` 还留在系统里。
- **第 25–28 行：`addSystemPrompt`。** 系统提示每次运行前重新取值，所以下一次提问时，模型能看到“当前的后台命令：#2 运行中（134 秒）：npm run dev”。这是 mox 给“长期存在的状态”留的唯一通道。
- **第 31–44 行：`agent_end`。** 循环里先看有没有已经结束、还没告诉过模型的 notify 命令，有就返回报告；没有但还有 notify 命令在跑，就 `await` 它们的“结束”信号（`Promise.race`，另加一个最长等待的超时）；都没有，返回空，让 Agent 停下。
- **第 52–53 行：启动时登记。** 每个命令有一个“结束了”的 Promise（`exited`），`onExit` 把它解开；`notify` 为真的编号放进 `notify` 集合，`agent_end` 只关心这些。
- **超时的计时器要 `unref`。** 否则它会挡住进程退出：命令明明结束了，`mox -p` 还要再等十分钟。这是实验写出来之后才发现的一个真问题。

用真正的 `mox -p` 跑一遍，模型是一个照剧本说话的假服务器，它记下每次请求到达的时刻：

@lab node labs/ch18/background.ts

- 第 1–3 次请求紧挨着：启动构建（`notify: true`）、看一眼进度（还没有输出）、告诉用户“结束时会收到通知”。
- 第 3 次到第 4 次之间隔了约一秒，正好是构建的时长。这一秒里，mox 在 `agent_end` 里等；**没有任何模型请求**。第 4 次请求的最后一条消息，就是扩展交来的报告：退出码和最后的输出，模型据此回答“构建成功”。
- 第二段：不设 notify 的 `sleep 60`。mox 没有等它，立刻退出；退出时 `shutdown` 把它杀掉了，进程不在了。

Pi 的版本在同一个场景下是这样的（同样的构建，通知由 `sendMessage` 发出，空闲的 Agent 被唤醒）：

@lab node labs/ch18/background-pi.ts

两种做法的差别：Pi 的扩展在任何时刻都能开口，Agent 空闲时也能被叫醒；mox 的扩展只能在 Agent 要停下的那一刻接话，而且要靠 `await` 把这一刻拖长。对 `mox -p` 这种一次性运行，这就够用；对交互模式，等待期间输入框是占住的（`controller` 还在，打的字会作为插话排队），Ctrl+C 也叫不停这个 `await`，因为处理函数拿不到取消信号。这是 mox 接口的真实边界，也是练习题的好材料。

::: steps 后台命令：启动、看一眼、等待、被叫醒
--- 模型调用 `bash_background`，参数里 `notify: true`。扩展让 `BackgroundJobs` 启动进程，记下编号 #1 在 `notify` 集合里，**立即**返回，不等命令结束，这次工具调用几乎没有耗时。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  M->>X: bash_background(构建, notify)
  X->>J: jobs.start(command)
  X-->>M: 已启动 #1（立即返回）
--- 模型想看看进度，调用 `bash_output`。`jobs.read` 只返回自上次查看以来的新输出，模型只为新增的部分付 token。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  X-->>M: 已启动 #1（立即返回）
  M->>X: bash_output(1)
  X-->>M: 运行中，没有新输出
--- 模型知道结束时会收到通知，不再轮询：告诉用户“构建在后台进行”，这一轮没有工具调用，`runLoop` 返回。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  X-->>M: 运行中，没有新输出
  M-->>C: 构建在后台进行（没有工具调用）
  Note over M,C: runLoop 返回
--- `run` 的 while 循环调用 `extensions.emit('agent_end', final)`。后台扩展的处理函数发现 #1 是 notify 命令、还在跑，于是 `await` 它的结束信号。这一刻没有任何模型请求。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  C->>X: agent_end
  Note over X,J: await 命令结束（约 1 秒）
--- 构建结束，`BackgroundJobs` 调用 `onExit`，解除扩展的等待。处理函数读出最后的输出，拼成报告。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  Note over X,J: await 命令结束（约 1 秒）
  J-->>X: onExit（退出码 0）
  X-->>C: 返回报告（字符串）
--- 返回值非空，`run` 把它作为新的用户消息追加进会话，再调用 `runLoop`。模型看到退出码和最后的输出，继续工作。
sequenceDiagram
  participant M as 模型
  participant C as cli.ts 的 run
  participant X as 后台扩展
  participant J as BackgroundJobs
  X-->>C: 返回报告（字符串）
  C->>M: 用户消息：后台命令 #1 已退出
  M-->>C: 构建成功，可以继续部署了
:::

## 目标循环：做完才停

@figure assets/course/ch18-goal.png 目标循环：模型说“完成了”不算，门上的检查通过才算；原地打转或轮数用完就停

### “完成了”不算数

第 13 章的 Stop 钩子展示过一个思路：模型准备停下时，检查一下，不满足就让它继续。目标循环把这个思路做成一个完整的工作方式：

```text
/goal "node test.js" 修好 add 函数
```

模型每次准备停下，扩展都运行一遍检查命令。退出码为 0 才算完成；否则把检查输出的最后部分交给模型，再来一轮。检查和判断的逻辑与 Pi 版本共用：

@code extensions/goal/goal.ts#evaluate

“再来一轮”由谁执行？mox 的 `cli.ts` 里有一个不起眼的 while 循环：

@code mox/src/cli.ts#L119-L141 hl=125,129,130,131

第 130 行是整个机制的入口：`runLoop` 返回（模型不再调用工具）之后，把最后的回答交给 `agent_end` 事件；处理函数返回的**第一个非空字符串**成为 `text`，循环回到第 125 行，把它当作一条新的用户消息追加到会话（第 126–128 行）、再跑一轮 `runLoop`。第 131 行把这句话打印在终端上（“扩展让 Agent 继续”），所以用户看得见每一次续跑。返回空，`text` 为 `undefined`，循环结束，这一次提问完成。

扩展只是回答了一个问题：“要不要再来一轮，说什么？” 其余都是 `cli.ts` 的事。对照 Pi，同一个“准备停下”的时刻叫 `agent_before_settle`，是运行真正结束前的最后一个决策点（第 9 章）：

@pi packages/coding-agent/docs/extensions.md#L665-L689

同一个处理函数，Pi 和 mox 的写法并排看：

::: tabs
@@ Pi
@code extensions/goal/index.ts#L22-L32
返回 `entries` 加 `continue: true`：把失败信息追加成一条自定义消息，再跑一轮。
@@ mox
@code extensions/goal/mox.ts#L25-L32
返回字符串：内核把这段文字当作下一条用户消息。`evaluate` 完全共用 `goal.ts`。
:::

设定目标的方式也不同：交互模式里 `/goal "检查命令" 目标描述` 是一个注册的命令（`registerCommand`）；`mox -p` 是一次性的，不处理 `/` 开头的命令，所以扩展还认环境变量 `MOX_GOAL="检查命令"`，CI 里可以直接用：

```bash
MOX_GOAL="npm test" mox -p "修好失败的测试" --yolo -e extensions/goal/mox.ts
```

### 两道刹车

一个永远不满足的目标会让 Agent 一直跑下去，烧掉大量 token。所以要有刹车：

- **轮数上限**：最多几轮。
- **原地打转检测**：上一轮什么文件都没改，检查也还是失败，再继续也不会有不同的结果。工作目录的“指纹”（每个文件的路径、大小、修改时间）在两轮之间没有变化，就停下来交给人。

@lab node labs/ch18/goal.ts

第一个场景：模型先是嘴上说“已经修好了”，检查失败，测试的输出（`add(2, 3) = -1，期望 5`）被交回给它；第二轮它真的改了代码，检查通过，终端上出现“目标达成”。第二个场景：模型一直声称修好了却什么都没改，第二轮就被原地打转检测拦下，没有等到轮数上限。最后一段不经过命令行，直接调用扩展：`/goal` 命令设定目标，Agent 说“已经修好了”准备停下时，`agent_end` 返回的就是那句“目标还没有达成（第 1/2 轮）……”。

同样的两个场景，Pi 版本的结果（目标由 `agent_before_settle` 追加一条自定义消息，Agent 被叫醒继续；轮数和打转的判断用的是同一个 `evaluate`）：

@lab node labs/ch18/goal-pi.ts

这种“把同一个目标反复喂给 Agent，直到客观的检查通过”的做法，社区里常被叫作 Ralph loop。它的前提是有一个**可靠的、可以自动运行的检查**——测试、类型检查、lint。目标越难自动验证（“把界面做得好看一点”），这个模式就越不适用。

::: steps 目标循环：嘴上说完成不算，检查通过才算
--- `MOX_GOAL="node test.js"` 之后，模型第一轮什么文件都没改，就说“已经修好了”，没有工具调用，`runLoop` 返回。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  M-->>L: 已经修好了（没改文件）
--- `run` 的 while 循环调用 `extensions.emit('agent_end', final)`：Agent 准备停下的最后一个决策点。目标扩展的处理函数调用 `evaluate`。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  M-->>L: 已经修好了（没改文件）
  L->>G: agent_end
  G->>C: evaluate 运行检查
--- `runCheck` 在工作目录里跑检查命令，退出码不是 0，输出里写着 `add(2, 3) = -1，期望 5`。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  G->>C: evaluate 运行检查
  C-->>G: 失败：add(2, 3) = -1
--- `evaluate` 检查两道刹车：`goal.round` 加一，没超过轮数上限；`fingerprint` 对比上一轮的指纹——这是第一次失败，还没有可比较的，于是记下当前指纹，返回 `continue`。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  C-->>G: 失败：add(2, 3) = -1
  Note over G: round 加一，记下指纹
--- 处理函数把失败信息（检查输出的最后 15 行以内）作为字符串返回。`run` 把它追加成用户消息，再跑一轮 `runLoop`，模型被告知“只说完成了不算数”，开始改代码。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  Note over G: round 加一，记下指纹
  G-->>L: 返回字符串：目标还没有达成……
  L->>M: 用户消息：目标还没有达成
  M->>L: edit：减号改加号
--- 第二轮模型真的改了代码，再次准备停下，第二次 `agent_end`。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  M->>L: edit：减号改加号
  M-->>L: 这次真的修好了
  L->>G: agent_end（第二次）
--- 检查命令退出码为 0，`evaluate` 返回 `done`，扩展清掉目标，打印“目标达成”，不返回字符串，循环结束。如果模型这一轮仍然什么都没改，指纹和上一轮相同，`evaluate` 会返回 `stop`，交给人。
sequenceDiagram
  participant M as 模型
  participant L as cli.ts 的 run
  participant G as 目标扩展
  participant C as node test.js
  L->>G: agent_end（第二次）
  G->>C: runCheck
  C-->>G: 退出码 0
  G-->>L: done，不返回字符串，循环结束
:::

## 崩溃之后

### 记录停在哪里，就知道断在哪里

第 7 章让会话的每一条消息一形成就写盘：`runLoop` 每 `push` 一条消息，`cli.ts` 的 `onEvent` 就 `session.save` 一次。这正是崩溃恢复的基础：重新打开会话，看最后一条记录是什么：

- **用户消息或工具结果**：模型还欠一个回复。重新请求就行，最多是同一个请求发了两次。
- **助手的工具调用，但缺少结果**：麻烦在这里。工具可能还没开始执行，也可能执行完了，只是结果还没来得及写下。

mox 的工具是**顺序**执行的（第 3 章），每个调用的结果在它执行完的那一刻就写盘。所以最多只有**一个**调用处在“执行了一半”的状态，排在它后面的调用还没开始。但会话文件里看不出这个区别。

### 实验：kill -9

一个真正的 `mox -p` 进程，模型一次发出三个工具调用：读 README、执行部署命令（往 `deploy.log` 追加一行，然后 `sleep 30`）、读源码。部署命令把那一行写进去之后，整个进程组被 `kill -9`。然后用 `mox -c` 恢复：

@lab node labs/ch18/crash.ts

看第一段：会话里有助手的三个调用，只有 c1 的结果。`deploy.log` 里已经有了一行：c2 的效果**已经发生**，命令还在 sleep。c3 其实根本没开始，可是会话里它和 c2 一模一样：都没有结果。

**朴素的做法**是把没有结果的调用全部重新执行一遍：部署执行了两次。对读文件来说重放无害，对部署、发邮件、扣款来说就是事故。

### session.ts 补上“中断”

mox 的恢复只有九行，写在 `openSession` 的末尾：

@code mox/src/session.ts#L36-L44 hl=37,38,39,40,41

- 第 37–38 行：找到**最后一条**助手消息，收集它后面已经有结果的 `tool_call_id`。只看最后一条，因为之前的助手消息之后一定跟着完整的结果，否则那次请求早就发不出去了。
- 第 39–43 行：最后一条助手消息里没有结果的调用，每个补一条结果“中断：上次运行在这个工具执行时退出，结果未知，需要的话请检查后重试。”，既追加到内存里的 `messages`，也 `save` 进文件。
- 为什么要补？OpenAI 的接口要求助手消息里的每个 `tool_call` 都有对应的 tool 消息，缺一个，这个请求就会被 400 拒绝。实验的最后一段数过：补之前有 2 个没有结果的调用，补之后是 0 个。

进程如果恰好死在写一行记录的中途，文件的最后会剩下半行 JSON。`openSession` 在读文件时也准备了这种情况（同一个函数的第 21–25 行）：文件不以换行结尾，就先补一个换行，免得新记录和那半行粘在一起；解析不了的行直接跳过，不让一个坏行把整个会话变得打不开。

补完之后模型看到两个“中断”，自己决定怎么办。实验里它先 `cat deploy.log`，发现部署已经做过，没有重复。`mox -c` 恢复会话时自动做这件事，用户什么都不用管。

### 旧版 mox 多做的，和 mox 现在少做的

课程原来用的 mox 比现在多一层：工具可以声明 `replaySafe`，恢复时 `read` 这类只读工具直接**重新执行**，不写“中断”，其余才交给模型。现在的 mox 没有这一层。这是有意的取舍，不是疏忽：每个工具多一个声明、恢复时多一段执行逻辑，换来的只是模型少花一轮重读文件。实验里 c3 就是这样：它被写成“中断”，模型想继续时要自己把源码再读一次。

四种恢复策略放在一起，看每一种在三个崩溃位置会发生什么。这个实验不是 mox 的代码，只是一个最小模型：“崩溃”就是在那个位置抛出异常、丢掉内存里的一切，恢复时只能读存储；外部世界（部署了几次）不受崩溃影响。

把一个工具调用的时间线切开，崩溃可能落在三个位置：

- **① 调用已记录，工具还没开始。** 什么都没发生，重新来就行。
- **② 意图已记录，工具刚要开始。** 只有执行前就把“我要执行了”写进存储的实现，才有这个位置。
- **③ 工具跑完了，结果没来得及写。** 效果已经发生。

@lab node labs/ch18/sandwich.ts

四列策略分别是：**朴素重放**（没有结果的调用全部重新执行）、**mox**（一律写“中断”）、**声明重放安全**（旧版 mox 和 Pi durable 的规则：声明过的工具直接重跑，其余写“中断”）、**效果三明治**（执行前先把“意图”写进存储，执行后再写结果）。逐行看：

- `deploy` 的第 ③ 行是事故现场：朴素重放让部署生效了两次。后三种都只生效一次，并把“中断”告诉模型，让它去查证。
- `read` 的三行是 mox 的代价：重放无害，mox 却也写“中断”，模型多花一轮重读。声明重放安全的两列把这一轮省掉了。
- 第 ① 行是 mox 的另一处浪费：部署根本没开始，mox 却写下“中断”，模型要多花一轮 `cat deploy.log`，才知道还得重新部署。三明治在执行前写了意图，所以**没有意图，就说明工具肯定没开始**，可以直接执行，模型什么都不用管。
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

::: steps 一个工具调用的三次提交，崩在哪里都有去处
--- 模型一次回复里发出工具调用。第一次提交，`appendAssistant` 写助手消息、`createToolTask` 为每个调用建任务（阶段 `call`），两者在**同一个** `runtime.commit` 里：消息在，任务就在。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::on --> K["call 阶段"]:::dim --> C2["提交 ②<br/>意图"]:::dim --> E["执行"]:::dim --> C3["提交 ③<br/>结果+终态"]:::dim
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::dim
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::dim
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::dim
--- 任务进入 `call` 阶段：解析工具、校验参数、运行 `beforeTool` 钩子。这一段还没有任何外部效果。如果进程在这里被杀（位置 ①），存储里的阶段仍是 `call`，重启后从头再走一遍；工具肯定没开始，代价只是钩子可能多跑一次。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::done --> K["call 阶段"]:::on --> C2["提交 ②<br/>意图"]:::dim --> E["执行"]:::dim --> C3["提交 ③<br/>结果+终态"]:::dim
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::on
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::dim
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::dim
--- 第二次提交是三明治的上半片：检查点写入 `final`（最终参数）、`replay`（当时声明的重放策略，默认 `unsafe`）和状态 `running`，阶段变成 `execute`。这次提交成功，才执行工具。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::done --> K["call 阶段"]:::done --> C2["提交 ②<br/>意图"]:::on --> E["执行"]:::dim --> C3["提交 ③<br/>结果+终态"]:::dim
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::dim
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::dim
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::dim
--- 工具执行（`tool.ts` 第 199 行）。位置 ② 是意图刚提交、工具刚要开始，位置 ③ 是工具已跑完、结果还没来得及写。两种崩溃留下的存储状态一模一样：阶段是 `execute`，没有终态。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::done --> K["call 阶段"]:::done --> C2["提交 ②<br/>意图"]:::done --> E["执行"]:::on --> C3["提交 ③<br/>结果+终态"]:::dim
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::dim
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::on
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::dim
--- 重启后进入 `execute` 的恢复函数。先看重启计数 `cutOffTooOften`，再比较**存下来的**策略与**现在注册的**策略：两边都是 `safe` 才用存下来的参数重跑；否则写一条 `interrupted` 结果，“可能已经部分执行”，交给模型查证。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::done --> K["call 阶段"]:::done --> C2["提交 ②<br/>意图"]:::done --> E["执行"]:::done --> C3["提交 ③<br/>结果+终态"]:::dim
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::dim
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::done
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::on
--- 第三次提交是下半片：`appendToolResult` 把结果写进对话，同一个回调返回终态 `terminal`。结果条目和任务终态要么都在、要么都不在，所以不会出现“结果已经在对话里，任务却还是 running”。
flowchart LR
  A["助手消息"]:::done --> C1["提交 ①<br/>消息+任务"]:::done --> K["call 阶段"]:::done --> C2["提交 ②<br/>意图"]:::done --> E["执行"]:::done --> C3["提交 ③<br/>结果+终态"]:::on
  K -.崩溃.-> R1["崩在位置 ①<br/>仍是 call，从头来"]:::dim
  E -.崩溃.-> R2["崩在位置 ② ③<br/>阶段是 execute"]:::done
  R2 --> R3["恢复函数：safe 且 safe 重跑<br/>否则写 interrupted"]:::done
:::

### 提交 ①：助手消息和工具任务一起写入

mox 的 `session.ts` 靠“最后一条助手消息里，有没有对应的结果”来推断哪些调用没做完。Pi 不推断：助手消息写入的**同一次提交**里，每个工具调用都建好了自己的任务记录。

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

重新打开后，存储里的检查点正是 `{ phase: "execute", arguments: {}, replay: "unsafe" }`；工具一共只运行了 1 次（`state.runs`）；模型收到的结果是崩溃前已提交的输出 `run 1`，加上那句“was interrupted and may have partially run”。mox 补的那条“中断”做的是同一件事，只是没有那半截输出。

同一件事——“重启后，没有结果的工具调用怎么处理”——Pi 的 durable 和 mox 的写法对照：

::: tabs
@@ Pi durable
@pi packages/durable/src/harness/tool.ts#L202-L227
重启时有任务记录：阶段、存下来的参数和策略。重放要求存下的策略和现在注册的策略都是 `safe`，并且用存下的参数。
@@ mox
@code mox/src/session.ts#L36-L44
只有“最后一条助手消息里有哪些调用没有结果”这一条线索，所以不区分工具，也不区分崩在哪个位置：没有结果的一律写“中断”。
:::

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

::: compare Claude Code
- **后台命令**：Bash 工具的 `run_in_background` 参数让命令在后台运行，配合读取输出、结束任务的工具；也可以把正在运行的命令或子 Agent 移到后台（Ctrl+B）。后台任务结束时会通知。
- **会话恢复**：`claude --continue` / `--resume` 恢复会话。
- **定时与循环**：`/loop` 按固定间隔反复执行一个提示；云端还有按计划运行的任务。

文档：[Interactive mode](https://code.claude.com/docs/en/interactive-mode)
:::

## 你来改

每道题先写下预测，再动手验证。

::: predict 删掉 agent_end 处理函数
把 `extensions/background/mox.ts` 里整个 `mox.on('agent_end', …)` 注释掉，运行 `node labs/ch18/background.ts`。模型一共发出几次请求？构建的结局，模型能看到吗？
???
三次请求，模型看不到结局。前三次请求照旧：启动、看一眼、说完话；然后 `run` 的 while 循环调用 `agent_end`，没有处理函数，返回空，`mox -p` 结束，`exit()` 触发 `shutdown`，`jobs.killAll()` 把还没跑完的构建杀掉。构建在 0.9 秒时才会结束，这时进程早就没了。实验里 `requests.length === 4` 的断言会失败。这说明 mox 里“等”的责任完全在 `agent_end` 这个处理函数上：没有它，后台命令只是一个会被 `shutdown` 清理掉的孤儿。
:::

::: predict 每一轮都改一点东西，但永远修不好
目标是 `false`（永远失败的检查），`maxRounds` 是 3。模型每一轮都先 `write` 一次 `notes.txt`（内容每次不同），再回复一句话。这个模型一共发出几次请求？是哪道刹车拦下的？
???
8 次请求，轮数上限拦下的。每一轮是两次请求（`write` 一次，回复一次）。原地打转检测（指纹）不会触发，因为每一轮 `notes.txt` 都变了：路径、大小或修改时间不同，指纹就不同。第 1、2、3 次检查失败，`round` 分别是 1、2、3，都不超过上限，各自返回“目标还没有达成（第 n/3 轮）”；第 4 次检查失败，`round` 变成 4，大于 3，`evaluate` 返回 `stop`：“已经尝试了 3 轮，检查仍然没有通过”。所以 `maxRounds` 是**续跑**的次数，模型实际工作了 4 轮。两道刹车拦的是两种不同的失败：没改东西，和改了东西但没用。
:::

::: predict 检查命令写成 true
`MOX_GOAL="true"`，模型第一轮就回答“我不知道怎么做”，什么都没改。目标循环会怎么样？
???
立刻“目标达成”，不续跑一轮。`true` 的退出码永远是 0，`evaluate` 第一次检查就返回 `done`。目标循环把“完成”的定义整个交给了检查命令：检查是真的，循环才有意义；检查是假的（或者太宽松，比如只检查文件存在），循环就成了一个盖章机器。这也是第 20 章评分要用“隐藏的测试”的原因：Agent 能看到的检查，既要让它有方向，也要小心它去迎合。
:::

::: predict 崩在 c3 开始之前
实验 `labs/ch18/crash.ts` 里，把脚本模型的三个调用改成只有两个（读 README、部署），其余不变。恢复之后，模型看到的“中断”有几条？
???
一条。助手消息里只有两个调用，c1 有结果，c2 没有，`openSession` 只给 c2 补“中断”。这说明 mox 的恢复补的是“最后一条助手消息里没有结果的调用”，数量取决于崩溃时那一批里还剩几个：执行到第几个被杀，后面的就都是没有结果的。顺序执行让这个数字很小，而且一定是连续的一段（从被打断的那个调用开始，到这一批的末尾）。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview Agent 如何处理长时间运行的命令（开发服务器、长测试）？
放到后台：启动后立即返回编号，Agent 可以继续做别的；提供“读取新输出”和“结束”两个操作；输出只保留末尾一段，只返回增量；结束时杀整个进程组，会话结束时清理所有后台进程。

关键是避免轮询：命令结束时由宿主通知 Agent。能随时往会话里发消息的框架（Pi）可以直接叫醒空闲的 Agent；只能在“准备停下”那一刻接话的（mox）就让模型在启动时声明要不要等，然后在那一刻等命令结束，把结局当作下一句话交回去。两种做法等待期间都不消耗模型请求。
:::

::: interview 怎样防止 Agent 过早宣布“完成”？
不要相信模型的自我报告，用客观的检查：测试、类型检查、lint、构建。在 Agent 准备停下的时刻（Stop 钩子、Pi 的 settle 事件、mox 的 `agent_end`）运行检查，失败就把输出交还给模型继续。

同时要有刹车：轮数上限；原地打转检测（两轮之间没有任何改动、检查结果也没变）；成本上限。最终仍然失败时，停下来交给人，而不是无限重试。前提是任务有可自动运行的验证手段，而且检查本身要可靠：检查太宽松，循环就会放行没做完的活。
:::

::: interview Agent 进程崩溃后，如何安全地恢复？
- 前提：每条消息一形成就持久化，记录停在哪里就知道断在哪里（mox：`runLoop` 每 push 一条，`onEvent` 就 `save` 一条）。
- 模型还欠一个回复：重新请求，并对“导致崩溃的请求”计数、设上限。
- 工具调用缺少结果：不知道效果是否发生。最低限度要补上结果，否则下一次请求不合法（mox 补“中断”）；区分重放安全（只读、幂等）的工具和其他工具，前者直接重新执行，后者记录“中断”，交给模型查证现状再决定。
- 更彻底的做法是“效果三明治”：执行前提交意图，执行后提交结果；恢复时根据停在哪个阶段决定重试、查询外部状态或记录中断。
- 外部操作尽量设计成幂等（带请求 ID），这样重试才安全。
:::

::: interview “至少一次”和“至多一次”在 Agent 里分别意味着什么？
至少一次：崩溃后总是重新执行，不会漏，但可能重复——对读操作无害，对部署、发消息、付款是事故。至多一次：崩溃后从不重新执行，不会重复，但可能漏。Agent 的工具调用通常无法做到“恰好一次”，因为外部效果和持久化不是一个原子操作。实际的办法是按工具区分：幂等的用至少一次；有副作用的用至多一次，并把“不确定”如实告诉模型，或者让外部系统支持幂等键，把至少一次变成实际上的恰好一次。mox 对所有工具都取至多一次，代价是只读工具也要多花一轮。
:::

::: interview 什么是“效果三明治”？它解决了什么，没解决什么？
做法：每个有外部效果的步骤，先提交“意图”，再执行，再提交“结果”或下一阶段。重启时看停在哪个阶段：

- 停在意图之前：效果肯定没发生，直接重新开始，不用问任何人；
- 停在意图之后、结果之前：效果**可能**发生了，要么安全地重试（重放安全、幂等），要么去查询外部句柄，要么如实记下“中断”交给模型或人去查证；
- 结果已提交：无需恢复。

解决的是“没有结果”这个状态含糊不清的问题：把不确定压缩到意图提交和结果提交之间的一小段。没解决的是这一小段本身：外部效果和本地存储不是同一个原子操作，所以窗口永远关不上，只能靠重放安全、幂等键或事后查证兜底。加分点：提到存下来的重放策略要和当前注册的一致才重放；崩溃要计数、设上限，防止必然崩溃的调用无限重启。
:::
