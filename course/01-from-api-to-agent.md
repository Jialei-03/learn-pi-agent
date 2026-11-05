---
motto: 模型只会返回文字。让它“做事”的，是你写的那个循环。
learn:
  - 为什么只靠聊天接口，模型读不到你的文件
  - 工具调用的完整往返：模型提出请求，程序执行，结果放回历史
  - 为什么每次请求都要重发全部历史，这对成本意味着什么
  - 读懂 mox 的 model.ts、loop.ts、tools.ts 怎样合成一个 Agent，并用真实模型跑起来
  - 同样的三件事在 Pi 里分别由哪一层负责
prereq: 第 0 章；会用 fetch 发 HTTP 请求
time: 40 分钟
build: 读懂并运行 mox 的 model.ts + loop.ts + tools.ts —— 第一个能看目录、读文件并回答问题的 Agent
---

## 模型读不到你的文件

在一个项目目录里，直接问模型“这个项目是做什么的？”。你会得到一段听起来很合理、但完全是猜的回答。原因很简单：模型的 API 是一个**文本进、文本出**的函数。它运行在服务商的机器上，看不到你的磁盘，也不能执行任何命令。

那 Claude Code 是怎么“读”文件的？答案是：**它自己也不读。** 读文件的是运行在你电脑上的那个程序。模型做的只是在回复里写下一段结构化的请求——“请帮我读 README.md”——然后由程序去执行，把结果作为下一次请求的一部分发回给模型。

这个机制叫做**工具调用**（tool calling，也叫 function calling）。主流模型 API 都支持它，只是格式各有不同（第 2 章细讲）。它由三部分组成：

1. **工具说明**：在请求里告诉模型“你可以用哪些工具”，每个工具有名字、用途描述和参数格式（JSON Schema）。
2. **工具请求**：模型的回复里不再只有文字，还可以包含“调用某个工具、参数是什么”。
3. **工具结果**：程序执行后，把结果作为一条新消息追加到对话里，再发起下一次请求。

把这三步放进一个循环，就得到了一个 Agent。

@figure assets/course/ch01-harness.png 模型只返回一张写着请求的卡片；真正打开文件柜的，是运行在你电脑上的程序

::: compare Claude Code 官方文档怎么描述这件事
Claude Code 的文档把它称为 **agentic loop**：收集上下文、采取行动、验证结果，三个阶段交织进行，每一次工具调用的结果都会影响下一步的决定。文档还专门说明，Claude Code 本身就是“包在模型外面、提供工具并管理上下文的那一层”，并把这一层称为 agentic harness。这门课要造的，就是这一层。（[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)）
:::

## 第一个 Agent：三个文件

这门课的动手部分都用 [Mox-agent](https://github.com/Jialei-03/Mox-agent)（以下简称 mox）：一个零依赖的 coding agent，全部代码六百多行，每个机制一个文件。它在本仓库的 `mox/` 目录里（Git 子模块，固定在一个提交上）。第一个 Agent 不需要读完它，只要三个文件：`model.ts`（45 行）、`loop.ts`（63 行）、`tools.ts`（158 行，七个工具，先只看 `read`）。

先看工具说明。这是写给模型看的“说明书”，格式是 OpenAI Chat Completions 的 `tools` 字段。mox 有七个工具：`read`、`write`、`edit`、`bash`、`grep`、`find`、`ls`，名字和参数与 Pi 的内置工具一致。下面是 `read`，其余六个写法一样：

@code mox/src/tools.ts#L29-L44 hl=30-33

三个字段要分清：`name` 和 `description` 是给**模型**看的，模型选工具、填参数全靠这几句话（注意 `description` 里已经告诉模型输出最多 2000 行或 50KB，大文件要用 `offset` 分段读）；`parameters` 是 JSON Schema，告诉模型参数怎么写；`run` 是给**程序**用的，模型永远看不到它。`run` 里先读文件、按 `offset` 和 `limit` 取行、截到 2000 行或 50KB 以内，没读完就在末尾提示“用 offset=N 接着读”。`Tool` 类型就是“说明书 + 一个函数”：

@code mox/src/loop.ts#Tool

再看循环本身。这是整个 Agent 的核心：

@code mox/src/loop.ts#runLoop hl=29,35,37,38-40

四处高亮对应四件事：

1. **把完整的历史发给模型**（第 29 行）。第一次请求只有 system 和 user 两条消息。`options.model` 是 `model.ts` 里 `openai()` 返回的函数，它负责 HTTP、流式解析，下一章细读。
2. **模型的回复进入历史**（第 35 行）。不管它是文字还是工具请求，都要追加进去，否则下一次请求时模型会“忘记”自己说过什么。
3. **回复里有几个工具请求，就执行几个**（第 37 行）。`execute` 找到同名的 `Tool`，解析参数，调用 `run`。注意是 `for` 循环：一条回复里的多个调用**按顺序**一个个执行。
4. **执行结果放回历史**（同一行）。用 `role: 'tool'` 加 `tool_call_id`，让模型知道这条结果对应它的哪一个请求。

循环结束的条件在第 40 行：**回复里没有工具请求，并且没有人插话**（`steering` 是第 3 章的主题，这里先当它永远为空）。模型觉得信息足够、直接给出回答，循环就结束。

`execute` 负责执行一个调用。它现在看起来比“调用函数，拿结果”多了不少东西，那些是第 3 章要逐个讲的保护；第一个 Agent 只需要看主路径：

@code mox/src/loop.ts#execute hl=50-52,55

找工具（第 50 行）、把参数从 JSON 文本解析成对象（第 52 行）、调用 `run`（第 55 行）。`call.function.arguments` 是**字符串**——OpenAI 格式里工具参数就是一段 JSON 文本，不是对象。

### 工具调用的 id 从哪里来？

`runLoop` 里的 `call.id` 来自模型返回的工具调用，不是 `read` 运行后生成的。离线实验没有调用真实模型：[`scripted.ts`](https://github.com/Jialei-03/learn-pi-agent/blob/main/labs/shared/scripted.ts) 用 `call_${n}_${i}` 生成 `call_1_1`、`call_2_1` 等编号，模拟接口回复。接入真实 API 时，程序使用响应里返回的工具调用 id（比如 MiniMax 返回的 `call_01a1…`）；API 文档说明它的关联用途，并不一定公开该 id 是模型还是服务端组件生成的。

Agent 在执行工具之后，把同一个 id 放进 `tool_call_id` 回传。第 2 章的 MiniMax 实际调用记录展示了一次真实返回值和对应结果。这个 id 不表示工具已经执行成功，成功与否需要看工具结果。

<figure class="diagram">
<svg viewBox="0 0 720 300" role="img" aria-label="Agent 循环：请求、执行、放回历史">
<defs><marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a1o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
<rect x="150" y="96" width="440" height="190" rx="14" fill="var(--bg-soft)"/>
<text x="164" y="278" font-size="11.5" fill="var(--faint)">你写的程序（Agent Loop）</text>
<g font-size="13" text-anchor="middle">
<rect x="16" y="120" width="104" height="44" rx="9" fill="var(--bg)" stroke="var(--line-2)"/><text x="68" y="147" fill="var(--ink)">用户提问</text>
<rect x="170" y="120" width="150" height="44" rx="9" fill="var(--bg)" stroke="var(--line-2)"/><text x="245" y="140" fill="var(--ink)">① 发送完整历史</text><text x="245" y="156" font-size="11" fill="var(--faint)">system + user + …</text>
<rect x="380" y="18" width="120" height="44" rx="9" fill="var(--ink)"/><text x="440" y="45" fill="var(--bg)" font-weight="600">模型 API</text>
<polygon points="440,118 510,142 440,166 370,142" fill="var(--bg)" stroke="var(--line-2)"/><text x="440" y="139" font-size="12" fill="var(--ink)">② 回复里有</text><text x="440" y="154" font-size="12" fill="var(--ink)">工具请求？</text>
<rect x="612" y="120" width="96" height="44" rx="9" fill="var(--bg)" stroke="var(--line-2)"/><text x="660" y="147" fill="var(--ink)">回答用户</text>
<rect x="374" y="210" width="190" height="44" rx="9" fill="var(--bg)" stroke="var(--accent)"/><text x="469" y="230" fill="var(--ink)">③ 程序执行工具</text><text x="469" y="246" font-size="11" fill="var(--faint)">read("README.md")</text>
<rect x="170" y="210" width="170" height="44" rx="9" fill="var(--bg)" stroke="var(--accent)"/><text x="255" y="230" fill="var(--ink)">④ 结果追加到历史</text><text x="255" y="246" font-size="11" fill="var(--faint)">role: tool + tool_call_id</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.3" fill="none" marker-end="url(#a1)">
<path d="M120 142H168"/><path d="M320 132C350 100 360 62 378 48"/><path d="M440 62V116"/><path d="M510 142H610"/>
</g>
<g stroke="var(--accent)" stroke-width="1.5" fill="none" marker-end="url(#a1o)">
<path d="M440 166V208"/><path d="M374 232H342"/><path d="M245 210V166"/>
</g>
<g font-size="11.5" fill="var(--muted)"><text x="560" y="135">否</text><text x="448" y="192" fill="var(--accent-ink)">是</text><text x="512" y="40">只返回 JSON，不执行任何东西</text></g>
</svg>
<figcaption>第 1 章的 Agent：橙色部分就是“循环”。每转一圈，历史多出一条模型回复和若干条工具结果。</figcaption>
</figure>


::: steps 一句提问如何变成三次请求
--- `runLoop` 的 `messages` 里只有用户那一句。每次请求前它会在最前面补上 `system`，所以第一次请求发出去的是 `system`、`user` 两条。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant A as 你的程序 runLoop
  participant M as 模型 API
  rect rgb(255, 230, 213)
    U->>A: 这个项目是做什么的？
    Note over A: messages：user（发出时加 system，共 2 条）
  end
--- **第 1 次请求**（第 29 行）：把这 2 条完整地发给模型。模型的回复里有工具请求 `ls`，所以第 40 行的判断不成立，循环继续。回复先进入历史（第 35 行）。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant A as 你的程序 runLoop
  participant M as 模型 API
  U->>A: 这个项目是做什么的？
  Note over A: messages：user（发出时加 system，共 2 条）
  rect rgb(255, 230, 213)
    A->>M: 请求 1：2 条消息
    M-->>A: tool_calls：ls(.)
    Note over A: 回复进入历史（第 35 行）
  end
--- **执行并放回历史。** 第 37 行：`execute` 找到 `ls` 工具真正列目录，结果以 `role: tool` 加 `tool_call_id` 追加进历史。历史现在是 user、assistant、tool 三条，下次发出时加上 system 共 4 条。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant A as 你的程序 runLoop
  participant M as 模型 API
  U->>A: 这个项目是做什么的？
  Note over A: messages：user（发出时加 system，共 2 条）
  A->>M: 请求 1：2 条消息
  M-->>A: tool_calls：ls(.)
  Note over A: 回复进入历史（第 35 行）
  rect rgb(255, 230, 213)
    A->>A: execute → ls 工具列目录
    Note over A: 追加 tool 结果
  end
--- **第 2 次请求**发送 4 条，不是只发新增的那条，因为 API 不保存状态。模型看到目录里有 README，请求 `read`。再执行、再放回，历史长到 6 条。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant A as 你的程序 runLoop
  participant M as 模型 API
  U->>A: 这个项目是做什么的？
  Note over A: messages：user（发出时加 system，共 2 条）
  A->>M: 请求 1：2 条消息
  M-->>A: tool_calls：ls(.)
  Note over A: 回复进入历史（第 35 行）
  A->>A: execute → ls 工具列目录
  Note over A: 追加 tool 结果
  rect rgb(255, 230, 213)
    A->>M: 请求 2：4 条消息
    M-->>A: tool_calls：read(README.md)
    A->>A: execute → read 工具读 README
    Note over A: 历史长到 6 条（含 system）
  end
--- **第 3 次请求**发送 6 条，其中 2 条是模型自己说过的话。这次回复里没有 `tool_calls`，也没有人插话，第 40 行 `return`，循环结束：一句提问，三次请求。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant A as 你的程序 runLoop
  participant M as 模型 API
  U->>A: 这个项目是做什么的？
  Note over A: messages：user（发出时加 system，共 2 条）
  A->>M: 请求 1：2 条消息
  M-->>A: tool_calls：ls(.)
  Note over A: 回复进入历史（第 35 行）
  A->>A: execute → ls 工具列目录
  Note over A: 追加 tool 结果
  A->>M: 请求 2：4 条消息
  M-->>A: tool_calls：read(README.md)
  A->>A: execute → read 工具读 README
  Note over A: 历史长到 6 条（含 system）
  rect rgb(255, 230, 213)
    A->>M: 请求 3：6 条消息
    M-->>A: 文字回答，没有 tool_calls
    A-->>U: 回答用户
  end
:::

## 跑起来

先用一个**脚本模型**把整条链路在本地走一遍。脚本模型只是一个返回预先写好的回复的函数，类型和真实模型的 `Model` 完全相同（[`labs/shared/scripted.ts`](https://github.com/Jialei-03/learn-pi-agent/blob/main/labs/shared/scripted.ts)）：它的决策规则写死——先 `ls`，看到 README 就读，读完就回答。循环、工具、消息格式全是 mox 的真实代码，所以 `ls` 真的会列出 `labs/fixtures/mox-project` 里的文件，`read` 真的会读出 README。循环分辨不出它面对的是脚本还是真模型，这正是我们想要的。

@lab node labs/ch01/first-agent.ts

用户只问了一句话，程序却向模型发了三次请求。下面的回放把这次运行拆成一步一步，左边点选步骤，右边看每一刻的完整消息列表。请求步骤可以展开“真实发送的请求体”：它就是 `model.ts` 第 15 行 `JSON.stringify` 出来的东西。

@trace node labs/ch01/trace.ts

::: predict
第三次请求一共发送了几条消息？其中有几条是模型自己之前说的话？
???
6 条：system、user、模型的第一次回复（请求 `ls`）、`ls` 的结果、模型的第二次回复（请求 `read`）、`read` 的结果。其中 2 条是模型自己说过的话。模型没有记忆，它“记得”自己刚才请求过什么，完全是因为我们把它的回复也放进了历史。
:::

## 三个关键事实

### 模型从不执行任何东西

模型的回复只是一段 JSON：`{"name": "read", "arguments": "{\"path\": \"README.md\"}"}`。执不执行、怎么执行、在哪个目录执行，全部由你的程序决定。

这句话有两层含义。好的一面：**程序拥有最终控制权**，可以在执行前检查参数、拒绝危险操作、要求用户确认（第 14 章的权限系统就建立在这一点上）。需要警惕的一面：**程序也承担全部后果**。模型被一段恶意的 README 诱导，请求执行 `rm -rf ~`，真正执行这条命令的是你的程序，用的是你的账户权限。

### API 不保存任何状态

第二次请求发送了 4 条消息，第三次发送了 6 条。每一次都是**从头发送全部历史**，因为模型 API 是无状态的：服务端不记得你上一次发过什么。

这直接决定了 Agent 的成本结构。假设每轮新增的内容大约等长，第 *n* 次请求要处理的输入大约是第 1 次的 *n* 倍，一次运行的总输入量随轮数**平方级**增长。一个修了 30 轮的 bug，最后几次请求每次都要把前面所有的文件内容和命令输出再读一遍。

这也是为什么生产级 Agent 都在意两件事：

- **提示缓存**（prompt caching）：如果请求的前缀和上一次完全相同，服务商可以复用已经算过的结果，按更低的价格计费。这要求历史**只追加、不修改**，第 6 章会看到 Pi 为此做的设计。
- **上下文压缩**（compaction）：历史太长时，把早期内容换成摘要。第 8 章细讲。

### 循环由“有没有工具请求”驱动

我们的循环只看一件事：这次回复里有没有工具请求。这个判断简单到几乎不像设计，但它意味着**任务什么时候结束，完全由模型决定**。模型想继续查，循环就继续转；模型觉得够了，循环就停。

这既是 Agent 灵活的来源，也是它不可预测的来源。注意 mox 的 `runLoop` 里**没有最大轮数**：模型只要一直请求工具，它就一直转。第 3 章会让一个朴素的循环坏四次（半截参数被执行、异常炸断运行、停不下来、插话递不进去），再回头看 mox 的循环里哪几行是在防这些事。

::: note 这个循环有个名字：ReAct
2022 年的论文 *ReAct: Synergizing Reasoning and Acting in Language Models*（Yao 等）提出让模型交替进行“推理”和“行动”：先想一步（Thought），再调用一个工具（Action），看到结果（Observation）后接着想。早期的实现要求模型按固定文本格式输出 `Thought: … Action: …`，再由程序用正则解析。

今天的工具调用把这件事做成了 API 的一部分：Action 变成结构化的 `tool_calls`，Observation 变成 `role: tool` 消息，推理则放进模型的思考内容里（第 2 章）。面试里被问到 ReAct，可以直接说：我们写的这个循环就是它的现代形态。
:::

## 接上真实模型

mox 的 `openai()` 说的是 OpenAI Chat Completions 格式，几乎所有服务商都兼容它：MiniMax、DeepSeek、OpenAI、OpenRouter，本地的 Ollama 也可以（模型需要支持工具调用）。命令行靠三个环境变量选择模型：

```bash
export MOX_BASE_URL=https://api.minimaxi.com/v1   # 服务商的地址，不写就是 OpenAI
export MOX_API_KEY=你的 Key
export MOX_MODEL=MiniMax-M3.1-Flash                # 这门课推荐的模型，便宜、支持工具调用

# 其他服务商只需要换这三个值，例如本地 Ollama：
#   MOX_BASE_URL=http://localhost:11434/v1  MOX_API_KEY=ollama  MOX_MODEL=qwen2.5-coder
```

然后在任何项目目录里运行。不想装命令的话，直接用路径；想要一个 `mox` 命令，先在 `mox/` 里 `npm link`：

```bash
node path/to/learn-pi-agent/mox/src/cli.ts -p "入口文件在哪里？它做了什么？"   # -p：执行一次就退出
cd path/to/learn-pi-agent/mox && npm link                                          # 之后任何目录都能用
mox                                                                                  # 交互模式
```

`cli.ts` 做的事，对第一个 Agent 来说只有这几行：用环境变量造出模型，造出工具，把用户的话放进历史，交给 `runLoop`：

@code mox/src/cli.ts#L39-L40

第 4 到第 20 章会陆续把它剩下的 160 行讲完：权限确认、会话、压缩、扩展、子 Agent 都在这个文件里装上。

### 一次真实运行

下面是用 MiniMax-M3.1-Flash 把**同一个循环**真实跑了一遍的记录（2026-11-05，`labs/ch01/record.ts` 录制；录制在临时目录的项目副本里进行，路径和用户名已经替换）。循环、工具和上面的脚本实验是同一份代码，只有模型换成了真的：

@lab node labs/ch01/show-real.ts | md

和脚本模型对比，有三处值得看。第一，真实模型**一次请求了两个工具**：先 `ls` 又 `find`，下一轮同时 `read` README 并 `ls src`。`runLoop` 的 `for` 循环把它们按顺序执行，每个都有自己的 `tool` 消息。第二，第一次回复里有一句文字（“I'll take a look…”）和工具调用**同时出现**：文字会经过 `onText` 流到屏幕上，工具调用则要等整条回复结束才执行。第三，同一个问题，脚本模型三次请求就答完，真实模型走了五次：多读了 `src/cli.ts`，最后还用 `bash` 看了有没有 `package.json`。哪些信息“够了”由模型判断，循环只管它要什么就给什么，直到它不再要。

@trace node labs/ch01/trace.ts real

::: warn 循环里的保护是第 3 章的内容
如果让模型读一个不存在的文件，mox 不会崩溃：`execute` 把异常变成一条以“错误：”开头的工具结果，模型会看到它，换一个文件或者告诉你没有。这个保护写在 `execute` 的 `catch` 里（第 58-60 行）。一个没有这几行的朴素循环会怎样坏，第 3 章让它真的坏四次给你看。
:::

::: predict 不把模型的回复放进历史
把 `loop.ts` 第 35 行的 `push(message)` 删掉，只保留执行工具、放回结果的那一行。用真实模型运行，模型第一次请求了 `ls`，程序执行了它。第二次请求会发生什么？
???
服务商直接拒绝这次请求（HTTP 400）。第二次请求的 `messages` 里有一条 `role: 'tool'` 的消息，它的 `tool_call_id` 在前面任何一条 assistant 消息里都找不到：模型的回复没有进历史，工具结果就成了“没人要求过的回答”。OpenAI 格式要求每条工具结果都对应前面某条 assistant 消息里的 `tool_calls`。就算服务商不校验，模型也不记得自己调用过什么，只能看到一份来路不明的目录列表。所以第 35 行不是装饰：**历史要完整记录双方说过的每一句话**。
:::

## Pi 里的同一件事

mox 把三件事分成三个文件：工具说明在 `tools.ts`，调用模型在 `model.ts`，循环在 `loop.ts`。Pi 把它们放进了三个不同的**包**，对应第 0 章的分层。

**工具**在产品层定义。下面是 Pi 的 `read` 工具的参数格式，和 mox 的 `read` 几乎一样，都有 `offset` 和 `limit` 用来分段读大文件：

::: tabs
@@ Pi
@pi packages/coding-agent/src/core/tools/read.ts#L13-L17
参数格式：`path`、`offset`、`limit`。
@@ mox
@code mox/src/tools.ts#L30-L32
`parameters` 里同样的 `path`、`offset`、`limit`；`description` 同样告诉模型输出会被截断、要用 `offset` 接着读，只是短得多。
:::

Pi 的说明文字比 mox 长得多，把输出会被截断、遇到大文件该怎么分段读讲得更细：

@pi packages/coding-agent/src/core/tools/read.ts#L85-L98

**调用模型**在模型层（`packages/ai`），**循环**在循环层（`packages/agent`）。我们把同一个任务交给 Pi：用它真实的 `runAgentLoop` 和自带的 `ls`、`read` 工具，模型换成 Pi 自己的脚本模型（faux provider），决策规则与上面的 mox 实验相同。

@lab node labs/ch01/pi-read.ts

形状和 mox 完全一样：三次请求，消息数从 2 条增长到 6 条，执行两次工具。唯一的区别是开头那条 `system`：Pi 把“当前有哪些工具”也记录成了历史里的一条系统消息，第 6 章会解释这个设计。

两者的差距不在主路径上，而在主路径之外：

| | mox | Pi |
| --- | --- | --- |
| 消息格式 | 直接使用 OpenAI 的线上格式，没有翻译层 | 统一的内部格式，由适配器翻译成各家格式（第 2 章） |
| 输出方式 | 流式，文字通过 `onText` 边生成边显示；整条回复结束后才返回（第 2 章） | 流式，并且工具参数也有增量事件，界面可以实时预览（第 2 章） |
| 工具失败 | 变成一条“错误：…”结果交回给模型（第 3 章） | 同样交回给模型，并带有结构化的错误标记（第 3、4 章） |
| 停止条件 | 没有工具请求、没有插话就停；`length` 时不执行工具 | 还要考虑宿主在每轮结束时的决定、追加任务（第 3 章） |
| 工具 | 七个：read、write、edit、bash、grep、find、ls，名字和参数与 Pi 一致，输出同样截到 2000 行 / 50KB，顺序执行，不校验参数 | 同样七个，加上参数校验、并行控制和长得多的说明（第 4、5 章） |
| 历史 | `session.ts` 逐条追加到 JSONL，可以恢复，但只有一条线 | JSONL 会话树，可以分叉和回退（第 7 章） |

接下来的每一章，都是在读 mox 的某一个文件，再看 Pi 在同一个位置多做了什么。

## 面试题

先自己回答，再展开对照要点。

::: interview 什么是 Agent？它和一次普通的 LLM 调用、和一个 workflow 有什么区别？
- **普通 LLM 调用**：一次请求、一次回答，模型不能行动。
- **Agent**：模型在一个循环里反复“决定下一步 → 由程序执行 → 看到结果”，直到它认为任务完成。关键特征是**下一步由模型决定**。
- **Workflow**：步骤和顺序由代码写死，模型只负责其中某些节点的生成。下一步由程序决定。

加分点：二者不是对立的，生产系统常常是 workflow 里嵌 agent 节点，或者 agent 调用一个固定流程作为工具。选择标准是任务路径是否可以预先确定。
:::

::: interview 一次 Agent 运行会发几次模型请求？由什么决定？
次数不固定，等于“模型返回工具请求的次数 + 1”（最后一次是不带工具请求的回答）。决定因素是模型的判断：它认为信息够了就停。

生产系统还会加入其他因素：输出被截断时要重试，宿主可以强制结束或要求继续，用户在运行中插入的消息会引出额外的轮次。能说出“停止权不应该只在模型手里”是加分点。
:::

::: interview 为什么每次请求都要发送完整历史？怎样控制成本？
模型 API 是无状态的，服务端不保存对话。每次请求都要带上完整历史，所以输入量随轮数增长，总成本近似平方级。

控制手段：
1. **提示缓存**：保持历史前缀稳定（只追加不修改），让服务商复用缓存，降低单价。
2. **控制工具输出大小**：截断长输出、分页读取大文件。
3. **上下文压缩**：历史过长时用摘要替换早期内容。
4. **子 Agent**：把探索性的工作放进独立上下文，只把结论带回主对话。
:::

::: interview 工具调用时，谁在执行工具？这对安全意味着什么？
执行者永远是 Agent 程序本身，模型只返回结构化的请求。因此程序是唯一的控制点：可以校验参数、拒绝危险操作、要求用户确认。

反过来，程序也承担全部风险：它用当前用户的权限执行命令。如果模型被文件内容、网页或命令输出里的恶意指令诱导（间接提示注入），执行危险操作的是程序本身。所以安全设计要放在程序这一侧：权限规则、审批、沙箱。不能指望模型自己拒绝。
:::
