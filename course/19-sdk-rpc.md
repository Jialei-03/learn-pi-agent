---
motto: 终端、打印、JSON、RPC 都是同一个会话对象的外壳。RPC 的难点不在 JSON，而在一条 stdout 上谁先说话、谁来认领。
learn:
  - 沿 pi 命令读到 createAgentSession，说清楚各种运行模式在哪里分叉、共用什么
  - 说清楚 RPC 的一条 stdout 怎样同时装下响应和事件，客户端怎样按 id 认领、应对乱序、崩溃和取消
  - 解释 prompt 的响应为什么只代表“收下了”，abort 的响应在 Pi 和 mox 里又代表什么
  - 说明 stdout 为什么要被接管、事件为什么只带增量、JSONL 为什么只能按 \n 切，并用 Pi 自带的 RpcClient 驱动 mox
prereq: 第 3、7、12 章
time: 70 分钟
build: mox/src/rpc.ts —— mox 的 JSON 事件流与 RPC 模式
---

到目前为止，用 Agent 的都是坐在终端前的人。但调用者越来越多是程序：IDE 插件在侧边栏画进度，CI 在 Agent 跑完后判断成败，网页后端把输出推给浏览器，第 20 章的评测框架一口气跑几百次。

它们问的是同一组问题：怎么启动？怎么知道做到哪了？运行到一半怎么插话、叫停？Pi 给了五种答案：

| 方式 | 怎么用 | 进程边界 | 适合 |
| --- | --- | --- | --- |
| 交互 | `pi` | 无 | 人在终端里用 |
| 打印 | `pi -p "任务"` | 一次性 | 脚本、命令替换：只要最后的文字 |
| JSON 事件流 | `pi --mode json "任务"` | 一次性 | CI：要知道过程（工具调用、用量） |
| RPC | `pi --mode rpc` | 长期运行的子进程 | 其他语言、需要隔离、要来回交互（IDE、自定义界面） |
| SDK | `createAgentSession()` | 无 | Node.js 宿主，要完整的 API |

这不是五套实现。沿着 `pi` 命令走一遍，看它们在哪里分叉。

## 从 pi 命令走到 AgentSession

<figure class="diagram">
<svg viewBox="0 0 720 280" role="img" aria-label="从 pi 命令到 AgentSession：三种运行模式和 SDK 共用同一个会话对象">
<defs><marker id="a19a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker></defs>
<g font-size="12" text-anchor="middle" fill="var(--ink)">
<rect x="20" y="8" width="130" height="44" rx="8" fill="var(--bg-soft)" stroke="var(--line-2)"/><text x="85" y="27" font-weight="700">pi 命令行</text><text x="85" y="43" font-size="11" fill="var(--muted)">参数 + 是否终端</text>
<rect x="190" y="8" width="330" height="44" rx="8" fill="var(--bg-soft)" stroke="var(--line-2)"/><text x="355" y="27" font-weight="700">main.ts：resolveAppMode()</text><text x="355" y="43" font-size="11" fill="var(--muted)">非交互模式：先 takeOverStdout()</text>
<rect x="20" y="94" width="200" height="70" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="120" y="116" font-weight="700">InteractiveMode</text><text x="120" y="134" font-size="11" fill="var(--muted)">终端界面，给人用</text>
<rect x="250" y="94" width="200" height="70" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="116" font-weight="700">runPrintMode</text><text x="350" y="134" font-size="11" fill="var(--muted)">一次运行，然后退出</text><text x="350" y="150" font-size="11" fill="var(--muted)">text：最终回答 · json：事件流</text>
<rect x="480" y="94" width="220" height="70" rx="8" fill="var(--bg)" stroke="var(--accent)"/><text x="590" y="116" font-weight="700">runRpcMode</text><text x="590" y="134" font-size="11" fill="var(--muted)">长期运行：stdin 进命令</text><text x="590" y="150" font-size="11" fill="var(--muted)">stdout 出响应和事件</text>
<rect x="20" y="210" width="540" height="56" rx="10" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="290" y="233" font-weight="700" fill="var(--accent-ink)">AgentSession（由 createAgentSession 装配）</text><text x="290" y="252" font-size="11" fill="var(--accent-ink)">prompt() · steer() · abort() · subscribe(listener)</text>
<rect x="590" y="210" width="110" height="56" rx="10" fill="var(--bg)" stroke="var(--line-2)"/><text x="645" y="233" font-weight="700">你的程序</text><text x="645" y="252" font-size="11" fill="var(--muted)">Node.js · SDK</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.3" fill="none" marker-end="url(#a19a)">
<path d="M150 30H188"/><path d="M290 52L120 92"/><path d="M355 52V92"/><path d="M420 52L590 92"/>
<path d="M120 164V208"/><path d="M350 164V208"/><path d="M520 164V208"/><path d="M588 238H562"/>
</g>
</svg>
<figcaption>三种运行模式和 SDK 调用者拿到的是同一个 AgentSession（它之下是第 2、3 章的模型适配器和 Agent 循环）；差别只在谁订阅它的事件、怎样写出去。</figcaption>
</figure>

`pi` 启动后做的第一个决定是进哪个模式：

@pi packages/coding-agent/src/main.ts#L112-L127 hl=113-122

`--mode rpc`、`--mode json` 是明说的；否则 `-p`，或者 stdin、stdout 有一个不是终端（管道、CI），自动进打印模式。JSON 模式没有自己的运行器：`toPrintOutputMode` 把它映射成 `runPrintMode` 的一种输出风格。所以只有三个运行器：交互、打印（含 JSON）、RPC。

第二个决定紧随其后：只要不是交互模式，就在加载任何扩展之前调用 `takeOverStdout()`。

@pi packages/coding-agent/src/core/output-guard.ts#takeOverStdout hl=50-52,54-63

它把 `process.stdout.write` 换成写 stderr 的函数，同时存下真正的 stdout 写函数；协议记录只经 `writeRawStdout` 写，用的就是存下来的那个。于是扩展里的 `console.log`、第三方库的 `process.stdout.write` 全部落到 stderr，不可能混进协议（下面的 `wire.ts` 实验会验证）。mox 靠约定：cli.ts 的 `say()` 在 json、rpc 模式下写 stderr。约定挡不住别人写的代码，接管可以。

三个运行器拿到的都是 `runtime.session`，一个 `AgentSession`。它从哪来，就是 SDK 的入口。

## SDK 入口：createAgentSession 装配了什么

@figure assets/agent-sdk-illustrations/03-create-session-assembly.png createAgentSession 把工作目录、模型、工具、会话、资源和设置六样东西装配成一个 AgentSession

`pi` 命令自己最终也调用它（`main()` → `createAgentSessionRuntime` → `createAgentSessionFromServices` → `createAgentSession`）。先看没传的参数：

@pi packages/coding-agent/src/core/sdk.ts#L191-L207 hl=198,200-201,203-207

每项都有默认值：`modelRuntime`（模型与凭证，第 2 章）读 `auth.json`、`models.json`；`settingsManager` 读配置文件；`sessionManager` 默认写磁盘（第 7 章）；没传 `resourceLoader` 就建 `DefaultResourceLoader` 并 `reload()`，扫描扩展、Skills 和提示模板（第 9、11 章）。**每一项都是宿主可以替换的边界**。课程的实验就这么用：

@code labs/shared/pi-session.ts#L45-L49 hl=46-48

模型换成脚本（注册 faux 提供方，不需要 API Key），`resourceLoader` 只加载实验自己的扩展（不读本机的 `~/.pi`），会话和设置放内存。换掉四个边界，就是一个离线、确定的 Pi。

函数的末尾把这些零件交给 `AgentSession`：

@pi packages/coding-agent/src/core/sdk.ts#L455-L481 hl=456-458,461,463,476-480

`agent` 是第 3 章那个循环加上状态（来自 pi-agent-core）；`AgentSession` 把它和会话、设置、资源、模型运行时、工具选择绑在一起，拥有一段对话、排队的消息、压缩状态和扩展运行时。返回值里的 `extensionsResult`、`modelFallbackMessage`（恢复旧会话时原模型不可用）是给界面提示用户的。

宿主最常调用 `session.prompt(text)`，RPC 的 `prompt` 命令就建立在它上面：

@pi packages/coding-agent/src/core/agent-session.ts#L2157-L2195 hl=2158-2170,2193-2195

- **运行中收到 prompt**：必须带 `streamingBehavior`，`"steer"` 是插话，`"followUp"` 是追加任务（第 3 章的两个队列），不带就抛错。Pi 不替调用者猜意图。
- **空闲时**：校验模型和凭证，`_startRun`。`prompt()` 的 Promise 要等整个运行（含自动重试）结束才完成。
- **`preflightResult`**：注释写着“Internal hook used by RPC mode”。预检通过时调用，参数是 `"started"` 或 `"queued"`（扩展命令、输入处理器接管时是 `"handled"`，在函数前半段），让调用者**在 Promise 完成之前**就知道提示被怎样处理。

SDK 的 `prompt()` 回答“做完了”；RPC 必须在做完之前回话，所以有这个回调。mox 没有 AgentSession 这一层，它的“SDK”就是模块本身（`runLoop`、`Session`、`ExtensionHost`），cli.ts 的 `execute` 相当于 `prompt()`。

## 打印模式与 JSON 模式：订阅会话，写到 stdout

打印和 JSON 模式是最简单的 SDK 宿主：建会话、订阅、`prompt`、退出。

@pi packages/coding-agent/src/modes/print-mode.ts#L106-L119 hl=108-112,113-118

JSON 模式下，每个事件经 `toJsonEvent` 变成一行 JSON，用 `writeRawStdout` 写出；文本模式的订阅什么也不写。JSON 模式还有第二个订阅，管背压：Agent 的每个事件都要先 `await waitForRawStdoutBackpressure()`，等 stdout 写队列排空。消费方读得慢，Agent 就被拖慢，而不是在内存里无限堆事件。

文本模式在最后把结果翻译成退出码：

@pi packages/coding-agent/src/modes/print-mode.ts#L139-L160 hl=145-147,154-157

停止原因是 `error`、`aborted`：原因写 stderr，退出码 1。`length`（第 3 章的截断）文字照打，退出码也是 1。JSON 模式不做这个翻译：失败的回复只是流里一条 `stopReason: "error"` 的消息，进程照样以 0 退出，要判断成败得读事件。

事件本身也不是原样写出的：

@pi packages/coding-agent/src/modes/json-event.ts#L40-L61 hl=49-51,56-60

SDK 的 `message_update` 带两份累计快照：`event.message`（整条消息的当前状态）和 `assistantMessageEvent.partial`。进程内订阅者拿快照不花钱；写进管道，每个增量都带一份越来越长的快照。`toJsonEvent` 把两份都去掉，只留 `usage` 和增量（`toolcall_start` 补上 id 和工具名，快照没了，客户端无处去查）。量一下差多少：

@lab node labs/ch19/delta-size.ts

SDK 形状的字节数随回复长度平方增长，线上形状线性增长。客户端自己重建：从 `message_start` 的初始消息出发叠加增量，**以 `message_end` 里的完整消息为准**。mox 的 `toWireEvent` 更简单，七种事件，`text_delta` 平铺：

@lab node labs/ch19/json.ts

线上的事件形状，Pi 的 `toJsonEvent` 和 mox 的 `toWireEvent` 对照：

::: tabs
@@ Pi
@pi packages/coding-agent/src/modes/json-event.ts#L40-L61
只处理 `message_update`：去掉累计快照，保留 `usage` 和增量；其他事件原样输出。
@@ mox
@code mox/src/rpc.ts#toWireEvent
只挑出外部关心的七种事件，`text_delta` 平铺；内部事件的形状改了，协议不受影响。
:::

还有一点：`agent_end` 只表示一次底层运行结束，之后还可能有自动重试、压缩后重试、排队的追加任务；`agent_settled` 才表示 Pi 不会再自己继续。mox 也在最后发一个。

## RPC：一条 stdout，三类记录

RPC 模式让 Agent 一直运行：命令走 stdin，响应和事件共用 stdout。三类记录：

| 记录 | 方向 | id | 说明 |
| --- | --- | --- | --- |
| 命令 | stdin | 客户端填，可选 | `{"id":"req_1","type":"prompt","message":"…"}` |
| 响应 | stdout | 原样带回命令的 id | 每条命令恰好一条：`{"id":"req_1","type":"response","success":true,…}` |
| 事件 | stdout | 没有 | 会话里发生的事，随时出现：`{"type":"agent_start"}` |

下面的时序图是一次典型的交互。注意 ⑤：运行还在进行，`get_state` 已经得到回复。

<figure class="diagram">
<svg viewBox="0 0 720 392" role="img" aria-label="RPC 时序图：客户端、RPC 服务端、Agent 循环之间的命令、响应和事件">
<defs>
<marker id="a19c" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker>
<marker id="a19r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker>
<marker id="a19e" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--faint)"/></marker>
</defs>
<g font-size="12" text-anchor="middle" fill="var(--ink)">
<rect x="25" y="8" width="170" height="38" rx="8" fill="var(--bg-soft)" stroke="var(--line-2)"/><text x="110" y="31" font-weight="700">客户端（RpcClient）</text>
<rect x="255" y="8" width="210" height="38" rx="8" fill="var(--bg-soft)" stroke="var(--line-2)"/><text x="360" y="31" font-weight="700">RPC 服务端（pi / mox 进程）</text>
<rect x="525" y="8" width="170" height="38" rx="8" fill="var(--ink)"/><text x="610" y="31" font-weight="700" fill="var(--bg)">AgentSession · 循环</text>
<rect x="600" y="112" width="20" height="228" rx="4" fill="var(--accent-soft)" stroke="var(--accent)"/>
</g>
<g stroke="var(--line-2)" stroke-width="1.2" stroke-dasharray="4 4"><path d="M110 46V380"/><path d="M360 46V380"/><path d="M610 46V112"/><path d="M610 340V380"/></g>
<g stroke="var(--ink-2)" stroke-width="1.4" fill="none" marker-end="url(#a19c)"><path d="M112 82H358"/><path d="M362 112H598"/><path d="M112 210H358"/><path d="M112 278H358"/><path d="M362 306H598"/></g>
<g stroke="var(--accent)" stroke-width="1.6" fill="none" marker-end="url(#a19r)"><path d="M358 142H112"/><path d="M358 240H112"/><path d="M358 364H112"/></g>
<g stroke="var(--faint)" stroke-width="1.4" stroke-dasharray="5 4" fill="none" marker-end="url(#a19e)"><path d="M598 174H112"/><path d="M598 334H112"/></g>
<g font-size="11.5" text-anchor="middle" fill="var(--ink-2)">
<text x="235" y="76">① prompt  id=req_1</text>
<text x="480" y="106">session.prompt(…)</text>
<text x="235" y="136" fill="var(--accent-ink)" font-weight="600">② response req_1 · started（收下了）</text>
<text x="360" y="168" fill="var(--muted)">③ 事件：agent_start、message_*、tool_*……（没有 id）</text>
<text x="235" y="204">④ get_state  id=req_2（运行中）</text>
<text x="235" y="234" fill="var(--accent-ink)" font-weight="600">⑤ response req_2：立刻回复，不等运行</text>
<text x="235" y="272">⑥ abort  id=req_3</text>
<text x="480" y="300">session.abort()</text>
<text x="360" y="328" fill="var(--muted)">⑦ agent_end → agent_settled { aborted: true }</text>
<text x="235" y="358" fill="var(--accent-ink)" font-weight="600">⑧ response req_3（Pi：此时会话已空闲）</text>
<text x="660" y="228" fill="var(--accent-ink)" transform="rotate(90 660 228)">运行中</text>
</g>
</svg>
<figcaption>黑色实线是命令（stdin），橙色实线是响应（stdout，带 id，只回答一条命令），灰色虚线是事件（stdout，没有 id）。运行期间，新的命令照常得到回复。</figcaption>
</figure>

### 服务端：读命令的循环不等任何运行

Pi 的 RPC 服务端读到一行，就交给 `handleInputLine`：

@pi packages/coding-agent/src/modes/rpc/rpc-mode.ts#L750-L800 hl=753-760,767-779,784-786,791-797

- 解析失败：写一条**没有 id**、`command` 为 `parse` 的失败响应，进程不崩。
- `extension_ui_response` 是客户端对扩展对话框的回答，直接交给等它的 Promise，自己不产生响应（第 14 章的审批弹窗靠这个转到客户端）。
- 其余命令交给 `handleCommand`，拿到响应就写出；抛异常也变成带 id 的失败响应。

关键在调用处：

@pi packages/coding-agent/src/modes/rpc/rpc-mode.ts#L802-L815 hl=808-810

`void handleInputLine(line)`：**不 await**。每一行立刻开始处理，上一条没做完，下一条已经在跑。这是响应乱序的来源，也是 `abort` 能在运行中生效的前提：读循环若等着 `prompt` 做完，`abort` 就得排在整个运行后面。stdin 关闭则触发 `shutdown()`。

`prompt` 命令同样不等运行：

@pi packages/coding-agent/src/modes/rpc/rpc-mode.ts#L394-L429 hl=398,403-406,409-410,413,426-428

`void session.prompt(...)`：运行可能持续几分钟。响应由 `preflightResult` 回调写出，`return undefined` 表示“我自己写过响应了”。`.catch` 只处理**预检之前**的失败（运行中没带 `streamingBehavior`、没有模型、没有凭证）；运行中途的失败没有响应，它们在事件流里（消息的 `stopReason: "error"`）。`steer`、`follow_up`、`abort` 则是 `await` 做完才返回响应。

所以 `prompt` 的响应只说“收下了”：运行已开始（`started`）、排进队列（`queued`），或被扩展命令直接处理（`handled`，没有运行，别等 `agent_settled`）。做完看 `agent_settled`。

`prompt` 命令的处理，Pi 的 RPC 服务端和 mox 的 `startRpc` 并排看：

::: tabs
@@ Pi
@pi packages/coding-agent/src/modes/rpc/rpc-mode.ts#L394-L429
`void session.prompt(…)`，响应由 `preflightResult` 回调写出；运行中必须带 `streamingBehavior`。
@@ mox
@code mox/src/rpc.ts#L48-L57
用 `busy` 标志在“收下”的那一刻置位；运行中的 `prompt` 一律作为插话排队（`queued`），否则 `started` 并开始运行。
:::

让真实的 Pi 在运行 bash 时同时收到三条命令，看响应按什么顺序回来：

@lab node labs/ch19/wire.ts

- `prompt` 的响应排在 `agent_start` 之前：先收下，再开始。
- 先发的 `bash`（要跑 0.4 秒）响应最后到，后发的两条没有等它。**响应不按发送顺序回来**；表格是“按到达顺序认领”的后果：每个命令都拿到了别人的数据。
- 事件没有 id，只有 `bash_execution_update` 例外：它是 bash 的流式输出，得告诉客户端属于哪条命令。
- 扩展里的 `console.log` 出现在 stderr。所有记录经 `writeRawStdout` 排进同一条写队列，一条写完才写下一条，不会在一行中间交错。
- mox 的命令都是同步处理的，响应顺序碰巧等于发送顺序，但协议不保证。最后一行是 mox 的一个真实 bug：`isRunning()` 要等 `execute` 里创建了 `AbortController` 才为真，背靠背的两条 `prompt` 都得到 `started`，开出两个并发的运行，往同一个会话里交错写消息。现在 `startRpc` 用 `busy` 标志在“收下”那一刻就置位。

::: steps RPC 的一次往返：三条命令同时在途
--- 客户端发出 `prompt`，id 是 `p`。服务端的读循环 `void handleInputLine(line)`：**不 await**，这一行立刻开始处理。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  C->>S: prompt id=p
--- `prompt` 命令调用 `session.prompt`，并且不等运行。响应由 `preflightResult` 回调在预检通过时写出：`started` 只说“收下了”，运行还没做完。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  C->>S: prompt id=p
  S-->>C: response p started（preflightResult 回调写出）
  S-)A: void session.prompt(…)，不等运行
--- 响应排在 `agent_start` 之前：先收下，再开始。事件没有 id，只是会话里发生的事。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  S-->>C: response p started（preflightResult 回调写出）
  S-)A: void session.prompt(…)，不等运行
  A-->>C: agent_start 事件（没有 id）
  A-->>C: tool_execution_start 事件，bash 开始跑
--- 运行还在进行时，客户端连发三条命令：`bash`（id=b，要跑 0.4 秒）、`get_state`（s）、`get_messages`（m）。每条先在 `pendingRequests` 登记，再写 stdin。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  A-->>C: tool_execution_start 事件，bash 开始跑
  C->>S: bash id=b（要跑 0.4 秒）
  C->>S: get_state id=s
  C->>S: get_messages id=m
--- 读循环不等任何运行，也不等上一条命令：快命令先答。`get_state` 和 `get_messages` 的响应先到，id 分别是 `s` 和 `m`。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  C->>S: get_messages id=m
  S-->>C: response s（get_state）
  S-->>C: response m（get_messages）
--- 最慢的 `bash` 最后才回复。发送顺序 b、s、m，到达顺序是 s、m、b：响应不按发送顺序回来，所以客户端必须按 id 认领。运行结束后，`agent_end` 和 `agent_settled` 事件才表示 Pi 不会再自己继续。
sequenceDiagram
  participant C as 客户端 RpcClient
  participant S as RPC 服务端
  participant A as AgentSession
  S-->>C: response m（get_messages）
  S-->>C: response b（bash，最后到）
  A-->>C: agent_end 与 agent_settled 事件
:::

### 客户端：按 id 认领

服务端乱序回复，客户端就必须按 id 认领。先看 Pi 的 `RpcClient` 怎样发送：

@pi packages/coding-agent/src/modes/rpc/rpc-client.ts#L576-L604 hl=576-577,580-583,585-594,597

id 是客户端自己的单调计数（`req_1`、`req_2`……）。每条命令先在 `pendingRequests` 里登记 `{resolve, reject}`，再写 stdin。**并发就是这样得到的**：任意多条命令同时在途，每个调用方各自 `await` 自己的 Promise。30 秒没有响应，就删掉登记项并 reject。

接收一侧：

@pi packages/coding-agent/src/modes/rpc/rpc-client.ts#L523-L543 hl=528-533,535-539,540-542

- `type: "response"`、有 id、登记表里**有这个 id**：认领，删除登记，resolve。
- **否则一律当事件**分发给所有监听器。推论：没有 id 的响应（`parse` 错误），以及超时后才到的响应，都会以“事件”的身份出现在监听器里。
- 分发前先复制监听器数组，监听器在回调里取消订阅，不会让后面的监听器漏事件。
- 整个函数包在一个 `try/catch` 里：非 JSON 的行被忽略，**监听器抛出的异常也被吞掉，排在它后面的监听器收不到这个事件**。

::: steps 客户端怎样认领一行输出
--- 客户端读到 stdout 的一行，交给 `handleLine`。这一行是 `get_state` 的响应，id 是 `s`，调用方此刻正在 `await` 对应的 Promise。
flowchart LR
  IN["stdout 的一行<br/>get_state 的响应：id=s，type=response"]:::on --> P{"JSON.parse<br/>成功？"}:::dim
  P -- 否 --> IGN["catch：忽略这一行"]:::dim
  P -- 是 --> R{"type 是 response<br/>且 id 在 pendingRequests？"}:::dim
  R -- 是 --> CL["认领：delete 登记<br/>pending.resolve(data)"]:::dim
  R -- 否 --> EV["当作事件<br/>复制监听器数组，逐个调用"]:::dim
--- 先 `JSON.parse`。整个函数包在 `try/catch` 里，所以解析失败的行（比如别人写的日志）会被静默忽略，不会让客户端崩溃。
flowchart LR
  IN["stdout 的一行<br/>get_state 的响应：id=s，type=response"]:::done --> P{"JSON.parse<br/>成功？"}:::on
  P -- 否 --> IGN["catch：忽略这一行"]:::dim
  P -- 是 --> R{"type 是 response<br/>且 id 在 pendingRequests？"}:::dim
  R -- 是 --> CL["认领：delete 登记<br/>pending.resolve(data)"]:::dim
  R -- 否 --> EV["当作事件<br/>复制监听器数组，逐个调用"]:::dim
--- 检查 `type === "response"`、有 id，且 `pendingRequests.has(id)`。三个条件都成立：删掉登记项，`resolve` 调用方的 Promise，`return`，不再当事件分发。这就是“按 id 认领”。
flowchart LR
  IN["stdout 的一行<br/>get_state 的响应：id=s，type=response"]:::done --> P{"JSON.parse<br/>成功？"}:::done
  P -- 否 --> IGN["catch：忽略这一行"]:::dim
  P -- 是 --> R{"type 是 response<br/>且 id 在 pendingRequests？"}:::done
  R -- 是 --> CL["认领：delete 登记<br/>pending.resolve(data)"]:::on
  R -- 否 --> EV["当作事件<br/>复制监听器数组，逐个调用"]:::dim
--- 下一行是 `agent_start`：不是响应，直接落到“事件”分支。`handleLine` 先复制监听器数组再逐个调用，监听器在回调里取消订阅也不会让后面的漏事件。
flowchart LR
  IN["stdout 的一行<br/>agent_start 事件：只有 type，没有 id"]:::on --> P{"JSON.parse<br/>成功？"}:::done
  P -- 否 --> IGN["catch：忽略这一行"]:::dim
  P -- 是 --> R{"type 是 response<br/>且 id 在 pendingRequests？"}:::done
  R -- 是 --> CL["认领：delete 登记<br/>pending.resolve(data)"]:::dim
  R -- 否 --> EV["当作事件<br/>复制监听器数组，逐个调用"]:::on
--- 再看一种：服务端写坏命令时回的 `parse` 失败响应，**没有 id**。它不满足认领条件，也走到事件分支，以“事件”的身份出现在监听器里（超时之后才到的响应也是这样）。监听器如果抛异常，被外层 `catch` 吞掉，排在它后面的监听器收不到这一条。
flowchart LR
  IN["stdout 的一行<br/>parse 失败响应：type=response，没有 id"]:::on --> P{"JSON.parse<br/>成功？"}:::done
  P -- 否 --> IGN["catch：忽略这一行"]:::dim
  P -- 是 --> R{"type 是 response<br/>且 id 在 pendingRequests？"}:::done
  R -- 是 --> CL["认领：delete 登记<br/>pending.resolve(data)"]:::dim
  R -- 否 --> EV["当作事件<br/>复制监听器数组，逐个调用"]:::on
:::

子进程崩溃时：

@pi packages/coding-agent/src/modes/rpc/rpc-client.ts#L107-L125 hl=107-112,113-118,119-125

进程退出、出错、stdin 写失败，都走 `rejectPendingRequests`：登记表里所有在等的请求**立刻**失败，错误里带着 stderr，而不是各自等满 30 秒。之后的 `send` 开头检查 `exitError`，直接抛出。第 12 章 MCP 客户端的“崩溃”场景是同一个设计。

最后是最容易写错的顺序：

@pi packages/coding-agent/src/modes/rpc/rpc-client.ts#L513-L517

**先**收集事件，**再**发提示。反过来的话，很快的运行可能在监听器装上之前就结束，客户端永远等不到 `agent_settled`。另一个坑：`prompt` 返回 `handled` 时没有运行，`promptAndWait` 会等到超时，调用方要自己看 `disposition`。

让 Pi 自己的 `RpcClient` 同时驱动真实的 Pi 和 mox：

@lab node labs/ch19/client.ts

mox 只实现了 `prompt`、`abort`、`get_state`、`get_messages` 四条命令，但协议骨架（id、响应、事件）一致，同一个客户端能直接驱动它；没实现的命令得到 `success: false`，`RpcClient` 把它变成异常。第 5、6 行验证了上面读到的两条规则：`parse` 响应以事件身份到达，第一个监听器抛异常，第二个就收不到。最后一行是崩溃：`bash()` 挂起时进程被杀，请求立刻失败。

### mox 的实现

mox 的服务端是同一套结构，只留骨架：

@code mox/src/rpc.ts#startRpc collapse=true

对应关系：`handle` ↔ `handleCommand`，`respond` ↔ `success`/`error`，`toWireEvent` ↔ `toJsonEvent`；读 stdin 按字节里的 `\n` 切分（见“分帧”）。mox 的一次完整会话，`→` 是客户端发的，`←` 是 mox 回的：

@lab node labs/ch19/rpc.ts

第 10 行的 `prompt` 到达时 mox 正在运行，作为插话排队（`queued`），下一轮被模型看到；写坏的命令得到 `parse` 失败响应，mox 继续运行。

## 取消与退出：三个层次

取消有三层：

| 层次 | 做法 | 效果 |
| --- | --- | --- |
| abort | RPC `abort` 命令；SDK `session.abort()` | 停掉当前运行，会话还能继续用 |
| dispose | 关闭 stdin（Pi 的 `shutdown()`）；SDK `session.dispose()` | 中止运行、释放资源，会话不再复用 |
| 杀进程 | SIGTERM、SIGKILL | Pi 对 SIGTERM 也走 `shutdown`；`RpcClient.stop()` 先 SIGTERM，1 秒后 SIGKILL |

@figure assets/agent-sdk-illustrations/06-abort-vs-dispose.png abort 只停下当前运行，会话还能继续；dispose 断开监听、清理资源，会话不再复用

@pi packages/coding-agent/src/core/agent-session.ts#L2519-L2529 hl=2521,2527,2528

@pi packages/coding-agent/src/core/agent-session.ts#L1428-L1443 hl=1430-1434,1442-1443

两个函数都很短。`abort()` 先记一个标志（`agent_settled.aborted` 就来自它），取消重试、压缩、分支摘要，再 `agent.abort()` 发出取消信号（第 5 章 bash 的进程树就在这个信号上被杀），最后 `await this.waitForIdle()`。最后一行决定了 RPC 里 `abort` 的响应何时写：`case "abort"` 要 `await session.abort()`，所以响应在会话空闲**之后**才到。`dispose()` 同样 `agent.abort()`，但不等运行结束，接着让扩展上下文失效、断开事件、清空监听器。

@lab node labs/ch19/abort.ts

- **Pi**：abort 的响应排在 `agent_end`、`agent_settled`（`aborted=true`）之后。收到响应，会话已空闲，下一条 `prompt` 立刻开始新的运行。
- **mox**：响应只说“取消信号已发出”，运行还要收尾。此时立刻发新 `prompt`，`isRunning()` 仍为真，它被当成插话排了队，没有新运行开始。mox 的客户端要等 `agent_settled` 才算取消完成。
- **关闭 stdin**：Pi 立即中止运行并退出；mox 等当前运行结束再退出。想让它做完再走，要先等 `agent_settled` 再关 stdin。
- Pi 的文档还说明 `abort` 不清队列：界面上的 Esc 要先发 `clear_queue` 再发 `abort`。

## 分帧：只按 \n 切

stdout 上的“一行”怎么定义？Pi 专门写了严格的 LF 分帧：

@pi packages/coding-agent/src/modes/rpc/jsonl.ts#L14-L58

`StringDecoder` 处理被拆在两个数据块里的多字节字符（第 2、12 章的老问题）；只认 `\n`，因为 JSON 字符串里可以原样出现 U+2028、U+2029，`JSON.stringify` 不会转义它们。注释说 Node.js 的 readline 会在这两处断行，验证一下：

@lab node labs/ch19/framing.ts

Node 22 的 readline 并没有在 U+2028 处断行，注释可能描述的是旧版本。但 Python 的 `str.splitlines()` 确实会，用它写客户端会把一条记录切成两半。规则是对的：**只按 `\n` 切**，别依赖任何库“读一行”的默认含义。注释也会过时，能验证的说法就动手验证。

## 不调用模型，测试整条链路

这一章的实验，包括真实的 Pi，都不调用模型。mox 用 `MOX_API=scripted MOX_SCRIPT=labs/ch19/script.ts`；Pi 的命令行没有这样的开关，实验用扩展 `labs/ch19/faux-ext.ts` 注册 faux 提供方，再 `--provider faux`。集成测试验证的是协议、事件顺序、进程生命周期、取消，和模型说了什么无关。下一章的评测则反过来，关心的正是真实模型的表现。

::: compare Claude Code：`-p` 与 Agent SDK
- **打印与事件流**：`claude -p "任务"` 对应打印模式；`--output-format` 可选 `text`、`json`、`stream-json`。`stream-json` 每行一个事件，需要加 `--verbose`，再加 `--include-partial-messages` 才有 token 级增量（`stream_event`）。流以 `system/init` 开头，最后一行是带结果、花费和会话信息的 `result`；Pi 没有单独的结果记录，最终回答就是最后一条 `message_end`。
- **长期运行与控制**：Agent SDK 的 streaming input 模式是长生命周期的进程，可排队发送消息、中途中断；单条消息模式不支持。这和“打印 vs. RPC”是同一条分界线。中断也分层：SIGINT 或 SDK 的 `interrupt()` 结束当前一轮；SIGTERM 直接退出（退出码 143），进行中的一轮不留结果。
- 文档：[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)、[Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
:::

## 你来改

::: predict 去掉 busy 标志会怎样？
把 mox `startRpc` 里的 `busy` 去掉，只用 `host.isRunning()` 判断“正在运行”。客户端背靠背写两条 `prompt`。两条的响应各是什么？会出现几个 `agent_start`？
???
两条都得到 `started`，出现两个 `agent_start`，两个循环交错运行，共用一个会话。原因：`isRunning()` 看的是 `controller` 是否存在，而 `controller` 要等 `run` 里的 `await host.emitInput(...)` 和 `execute` 里的 `await maybeCompact()` 之后才创建；第一条命令在第一个 `await` 处就让出了控制权，第二条进来时 `controller` 还是空的。两个循环往同一个会话追加消息，工具调用和结果的对应会乱，下一次请求可能被服务商直接拒绝。修复是在“收下”的那一刻就置位：状态要在**决定**的地方改，而不是在**执行**的地方改。改回去再运行 `node labs/ch19/wire.ts`，最后的断言会失败。
:::

::: predict abort 的响应到了，马上发下一条 prompt
客户端发出 `abort`，一收到它的响应就立刻发一条新的 `prompt`。对真实的 Pi 和对 mox，这条 `prompt` 的响应各是什么？
???
Pi：`started`，新的运行立刻开始。Pi 的 `abort` 要等会话空闲才回复，响应到达时旧的运行已经结束。mox：`queued`，而且没有新运行开始。mox 的 `abort` 同步回复，旧的运行还在收尾（`controller` 还在），新 `prompt` 被当成插话排进队列，要等下一次运行启动才会被取走。同一个“响应”，有的实现是“已发出”，有的是“已完成”：客户端要读文档、做实验，或只信 `agent_settled`。（`node labs/ch19/abort.ts` 的第四行。）
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 要把一个 Agent 集成进 IDE / CI / Web 应用，有哪些方式？怎么选？
- **SDK**（进程内）：宿主是同一种语言，要完整的 API 和零开销；代价是没有隔离，Agent 崩溃就是宿主崩溃。
- **打印模式**：脚本里只要最终文字；退出码反映成败（Pi 里 error、aborted、length 都是 1）。
- **JSON 事件流**：一次性任务要过程信息（工具调用、用量），比如 CI；成败要读事件，不看退出码。
- **RPC**（长期运行的子进程）：其他语言、需要隔离、需要多轮交互和控制（插话、取消、切换模型），比如 IDE 插件。
- 关键是三问：要不要进程边界，一次性还是长期，需要多少控制。加分点：Pi 的几种方式共用同一个 `AgentSession`，差别只在输入输出的形式。
:::

::: interview 设计一个 Agent 的 RPC 协议，要注意哪些问题？
- **记录分三类**：命令、响应（带 id 配对）、事件（会话活动，不带 id；属于某条命令的流式输出是例外）。
- **响应不保证按发送顺序**：服务端并发处理命令（读循环不等运行），客户端按 id 认领；没有 id 的响应、迟到的响应要有去处。
- **响应只表示命令被收下**：完成用事件表示，并区分“一次运行结束”（`agent_end`）和“不会再自动继续”（`agent_settled`）。
- **运行中收到新提示**：排队、插话还是拒绝，让调用者显式声明意图（Pi 的 `streamingBehavior`），或在响应里说明（`disposition`）。
- **取消**：`abort` 的响应是“已发出”还是“已停下”；是否清队列；关闭 stdin 是等待还是中止。
- **错误**：命令失败回失败响应，解析失败回解析错误，不能让进程崩溃。
- **分帧与通道**：严格 JSONL，只按 `\n` 切；stdout 只放协议（像 Pi 一样接管 stdout，让任何 `console.log` 落到 stderr）；写队列串行化；尊重背压。
- **生命周期与交互**：关闭 stdin 表示退出；扩展要弹对话框时，怎么转给客户端、等它回答。
:::

::: interview 客户端怎样按 id 配对响应？并发命令、超时、子进程崩溃怎么处理？
- 为每条命令生成唯一 id，在 `Map<id, {resolve, reject}>` 里登记，再写 stdin；读到 `type: "response"` 且 id 在表里就认领并删除。多条命令可以同时在途，乱序也不怕。
- 登记项带超时：到点删除并 reject。迟到的响应找不到登记项，不能误交给别人：丢弃，或像 `RpcClient` 一样当事件处理（监听器要有这个预期）。
- 子进程退出、出错、stdin 写失败：立刻 reject 所有登记项并附上 stderr，后续发送直接抛错，不等超时。
- 隔离监听器的异常，否则一个出错会让后面的监听器漏事件（`RpcClient` 的 `try/catch` 就有这个陷阱）。
- 先订阅事件再发 `prompt`；`handled` 的 `prompt` 没有运行，不要等 `agent_settled`。
:::

::: interview 客户端怎样从事件流里重建一条正在生成的消息？
用增量事件（文本增量、工具参数增量）实时拼出显示内容；收到 `message_end` 时，用其中完整的消息替换拼出来的结果，以最终消息为准，因为增量可能被截断、重试或修复（第 2 章：工具参数的增量只能用来预览）。线上的 `message_update` 只带增量，不带累计快照，客户端要自己从 `message_start` 的初始消息开始累积；这样流量线性增长，而 SDK 形状的流量随长度平方增长。还要处理“运行结束后还会继续”（重试、压缩、追加任务），以 `agent_settled` 为准。
:::

::: interview 取消一次运行，有哪几个层次？它们的区别是什么？
- **abort**：停掉当前运行，会话保留，可以继续 `prompt`。响应何时回复取决于实现：Pi 等会话空闲才回复，收到就能发下一条；mox 回复的只是“信号已发出”，要等 `agent_settled`。
- **dispose / 关闭 stdin**：中止运行并释放资源（断开监听、让扩展上下文失效），会话不再复用。想让运行做完再退出，要先等 `agent_settled`。
- **杀进程**：SIGTERM 给善后的机会，SIGKILL 没有；客户端要让所有在途请求同时失败。
- 加分点：取消要传到最底层，bash 的进程树要被杀掉（第 5 章），否则运行“停了”，子进程还在跑；`abort` 不清排队的消息，需要时先 `clear_queue`。
:::

::: interview 不调用真实模型，怎样测试 Agent 的集成？
用脚本化的模型（Pi 的 faux 提供方、mox 的 scripted）：按请求内容返回预先写好的回复和工具调用，仍走真实的流式事件路径。这样可以确定、快速、免费地测试协议、事件顺序、工具执行、取消、错误恢复、进程生命周期；对真实的 Pi 进程，用扩展注册这样的提供方。它测不了“模型会不会这样做”，那是评测（evals）的事。让输出稳定：固定随机数、不打印时间戳、不依赖事件个数（增量的分块可能随机）。
:::
