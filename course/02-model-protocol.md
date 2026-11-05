---
motto: 循环不该知道它在和哪家模型说话。
learn:
  - 同一段带工具调用的对话，在 Anthropic 和 OpenAI 的请求体里分别长什么样，Pi 的适配器翻译了什么
  - 流式响应怎样被一段段拼回一条完整消息，以及工具参数为什么不能边收边执行
  - 把各家的停止原因翻译成统一的几个词，未知值和断流为什么要当成错误
  - Pi 的模型层怎样用统一格式和“适配器不抛异常”的约定屏蔽二十多家服务商
  - 实战：给 mox 写出 model.ts —— 流式 SSE、拼工具调用分片、finish_reason 和断流报错
prereq: 第 1 章
time: 60 分钟
build: 实战：给 mox 写出模型调用 model.ts（45 行）：流式 SSE、按 index 拼工具调用分片、finish_reason、断流报错
---

## 为什么需要一个内部格式

第 1 章的循环读的是助手消息里的 `toolCall` 块，写的是 `toolResult` 消息。这些是 **Pi 自己的格式**，不是任何一家服务商的格式。现在想一想：OpenAI 的回复里是 `tool_calls`、工具结果是 `role: "tool"`；Anthropic 的回复里是 `tool_use` 块、工具结果是 user 消息里的 `tool_result` 块。如果循环直接说某一家的话，想支持另一家就得几乎每一行都改。

解决办法是在中间加一层：**循环只认一种内部格式，每家服务商配一个适配器，负责双向翻译。** 这是软件工程里常说的“防腐层”。

@figure assets/course/ch02-adapters.png 每家服务商一个适配器：外面的格式各不相同，循环只看到统一的内部消息

Pi 的内部格式有三处刻意的设计：

- 内容是**块的数组**：文字、思考、工具调用并列放在 `content` 里，一条回复可以同时有几种。
- 工具参数 `arguments` 是**对象**，不是 JSON 字符串。解析的麻烦留在适配器里，循环拿到的永远是可以直接用的值（解析失败时 `arguments` 是 `{}`，原因记在 `argumentsError` 里）。
- 停止原因是**归一化**过的几个词，原始值另存在 `rawStopReason` 里，方便调试。

先看内容块的几种形状：文字、思考（带签名）、工具调用，以及用量：

@pi packages/ai/src/types.ts#L416-L488 collapse=true

再看停止原因和消息的种类：

@pi packages/ai/src/types.ts#L489-L489

@pi packages/ai/src/types.ts#L659-L659

一个模型在 Pi 里是一个函数：给它一份上下文，它还你一条**事件流**（最后那条助手消息可以用 `.result()` 取出）。这个函数有一份契约，写在类型旁边的注释里：

@pi packages/ai/src/types.ts#L388-L403

注意最后两条：**一旦返回了流，请求、模型、运行时的失败都要编码在流里**，错误结束必须产出一条 `stopReason` 为 `error` 或 `aborted` 的助手消息。本章后面会专门讲为什么。

## 同一段对话，两种线上格式

构造一段典型的对话：用户提问 → 模型在同一条回复里请求读两个文件 → 两条工具结果（其中一条失败）。把它交给 Pi 的两个适配器，请求发给本地的假服务，下面打印的是假服务**真正收到的请求体**：

@lab node labs/ch02/wire.ts

把差异整理成表：

| | Anthropic Messages | OpenAI Chat Completions |
| --- | --- | --- |
| 系统提示 | 顶层 `system` 字段 | `messages` 里第一条 `role: "system"` |
| 工具说明 | `tools[].input_schema` | `tools[].function.parameters` |
| 模型的工具请求 | assistant `content` 里的 `tool_use` 块，`input` 是对象 | assistant 的 `tool_calls` 数组，`arguments` 是 **JSON 字符串** |
| 工具结果 | **user** 消息里的 `tool_result` 块；同一批结果放在同一条 user 消息里 | 每个结果一条独立的 `role: "tool"` 消息 |
| 关联方式 | `tool_use_id` | `tool_call_id` |
| 失败的结果 | `is_error: true` | 没有专门字段，只能写进文字（上面 OpenAI 那份里，第二条结果的失败标记就丢了） |

Pi 内部的 5 条消息（含 system），翻译成 Anthropic 是 3 条（两条结果合并了，system 提到顶层），翻译成 OpenAI 还是 5 条。两个适配器各自负责这些差异，循环完全不需要知道。

Anthropic 那边最容易写错的是工具结果的位置：它要求 `tool_result` **紧跟在**发出对应 `tool_use` 的那条 assistant 消息之后。Pi 把连续的工具结果合并进同一条 user 消息，注释里还记下了这么做的另一个原因——有些第三方的 Anthropic 兼容端点只接受这种形式：

@pi packages/ai/src/api/anthropic-messages.ts#L1497-L1521

::: insight “兼容”从来不是完全兼容
很多服务商声称“兼容 OpenAI 格式”或“兼容 Anthropic 格式”，但细节各有出入：有的不接受 `content: null`，有的要求工具结果必须合并，有的不认识某些字段。Pi 的 `openai-completions.ts` 里有一个函数专门根据服务商名字和地址推断兼容性设置。生产级的模型层，有相当一部分代码是在处理这些“兼容但不完全兼容”的情况。
:::

## 流式：一条消息是怎样拼出来的

等整条回复生成完才拿到结果，用户要干等。真实的 Agent 都用**流式**响应：模型每生成几个字就发一段过来，界面可以实时显示，用户也可以在看到苗头不对时立刻取消。

流式响应用的是 SSE（Server-Sent Events）格式：一串文本行，`event:` 行说明事件类型，`data:` 行是 JSON，空行表示一个事件结束。

```text
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"th\": \"src/"}}

```

### 字节流怎样变成事件

解码 SSE 有一个容易忽略的坑：**网络包的边界和行的边界毫无关系。** 一次 `read` 可能只拿到半行，也可能一次拿到好几个事件，甚至把一个中文字符（UTF-8 编码 3 个字节）切成两半。Pi 的解码器是一个异步生成器：

@pi packages/ai/src/api/anthropic-messages.ts#iterateSseMessages collapse=true

读法：`reader.read()` 拿到一块字节，`decoder.decode(value, { stream: true })` 解码（`stream: true` 让它把被切开的字符前半截留到下一块），拼进 `buffer`；`consumeLine` 只在遇到换行时才切出完整的一行，剩下的留给下一轮；一行一行喂给 `decodeSseLine`，空行把攒好的 `event` 和 `data` 合成一个事件 `yield` 出去。每次循环开头还检查 `signal`，取消时立刻抛出。

课程的离线实验用本地假服务回放预先准备的 SSE 样本，并且**故意每 7 个字节切一刀**，不管切在哪里。样本是测试样本，没有保存可核验的线上采集来源；解码器在这种条件下仍然要给出正确的结果。

### Anthropic 的事件序列

Anthropic 的流是分块（content block）组织的。一条回复由若干个块组成（文字块、工具调用块、思考块），每个块都有“开始 → 若干增量 → 结束”三个阶段，最后由 `message_delta` 给出停止原因和输出 token 数：

```text
message_start          → 输入 token 数
content_block_start    index=0  type=text
content_block_delta    index=0  text_delta "我先看看"
content_block_delta    index=0  text_delta "入口文件。"
content_block_stop     index=0
content_block_start    index=1  type=tool_use  name=read_file
content_block_delta    index=1  input_json_delta "{\"pa"
content_block_delta    index=1  input_json_delta "th\": \"src/"
content_block_delta    index=1  input_json_delta "cli.ts\"}"
content_block_stop     index=1             ← 参数到这里才完整
message_delta          stop_reason=tool_use，输出 token 数
message_stop
```

<figure class="diagram">
<svg viewBox="0 0 720 360" role="img" aria-label="Anthropic 流式事件如何组装成一条消息">
<defs><marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--faint)"/></marker></defs>
<text x="16" y="20" font-size="11.5" font-weight="600" fill="var(--faint)">到达的 SSE 事件（按时间）</text>
<text x="404" y="20" font-size="11.5" font-weight="600" fill="var(--faint)">Pi 的适配器手里的 AssistantMessage</text>
<g font-size="11.5" class="mono" fill="var(--ink-2)">
<text x="16" y="48">message_start</text>
<text x="16" y="74">content_block_start #0 text</text>
<text x="16" y="100">  text_delta "我先看看"</text>
<text x="16" y="126">  text_delta "入口文件。"</text>
<text x="16" y="152">content_block_stop  #0</text>
<text x="16" y="178">content_block_start #1 tool_use</text>
<text x="16" y="204">  input_json_delta '{"pa'</text>
<text x="16" y="230">  input_json_delta 'th": "src/'</text>
<text x="16" y="256">  input_json_delta 'cli.ts"}'</text>
<text x="16" y="282" fill="var(--accent-ink)" font-weight="600">content_block_stop  #1</text>
<text x="16" y="308">message_delta stop_reason=tool_use</text>
<text x="16" y="334">message_stop</text>
</g>
<rect x="404" y="34" width="300" height="312" rx="12" fill="var(--bg-soft)"/>
<g font-size="12">
<text x="420" y="60" fill="var(--muted)" class="mono">content[0]  text</text>
<rect x="420" y="70" width="268" height="58" rx="8" fill="var(--bg)" stroke="var(--line-2)"/>
<text x="432" y="92" fill="var(--faint)" class="mono">"我先看看"</text>
<text x="432" y="116" fill="var(--ink)" class="mono">"我先看看入口文件。"</text>
<text x="420" y="158" fill="var(--muted)" class="mono">content[1]  toolCall read_file</text>
<rect x="420" y="168" width="268" height="100" rx="8" fill="var(--bg)" stroke="var(--line-2)"/>
<text x="432" y="190" fill="var(--faint)" class="mono">预览 {}</text>
<text x="432" y="214" fill="var(--faint)" class="mono">预览 {"path":"src/"}</text>
<text x="432" y="238" fill="var(--faint)" class="mono">预览 {"path":"src/cli.ts"}</text>
<text x="600" y="214" fill="var(--faint)" font-size="11">只能显示</text>
<rect x="420" y="276" width="268" height="30" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
<text x="432" y="296" fill="var(--accent-ink)" class="mono" font-weight="600">arguments {"path":"src/cli.ts"}</text>
<text x="420" y="334" fill="var(--muted)" class="mono">stopReason  <tspan fill="var(--faint)">pending →</tspan> <tspan fill="var(--ink)">toolUse</tspan></text>
</g>
<g stroke="var(--faint)" stroke-width="1" fill="none" marker-end="url(#a2)" stroke-dasharray="3 3">
<path d="M250 112H416"/><path d="M262 230H416"/><path d="M200 330H412"/>
</g>
<path d="M200 278H416" stroke="var(--accent)" stroke-width="1.4" fill="none" marker-end="url(#a2)"/>
<text x="250" y="270" font-size="11" fill="var(--accent-ink)">参数到这里才完整，才能执行</text>
</svg>
<figcaption>同一条回复，左边是网络上陆续到达的事件，右边是适配器逐步拼出的消息。灰色的预览只用于界面显示。</figcaption>
</figure>

Pi 的适配器按服务端给的 `index` 登记“正在生成的块”（`openBlocks`），收到增量就拼接，收到 `content_block_stop` 再做最终解析。工具调用块的三个阶段在代码里是这样的：

@pi packages/ai/src/api/anthropic-messages.ts#L756-L772

@pi packages/ai/src/api/anthropic-messages.ts#L793-L803

@pi packages/ai/src/api/anthropic-messages.ts#L809-L835 collapse=true

::: steps Anthropic 的流式事件怎样拼成一条消息
--- `message_start` 到达：适配器记下响应 id、输入 token 数，`content` 还是空数组，`stopReason` 是初始值 `pending`。此时没有任何可以执行的东西。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  rect rgb(255, 230, 213)
    S->>A: message_start
    Note over M: content 为空<br/>stopReason = pending
  end
--- 文字块：`content_block_start` 让适配器往 `content` 里推一个空的 text 块，并在 `openBlocks` 里按服务端的 `index` 登记；两个 `text_delta` 依次拼接到这个块上，每次都发出 `text_delta` 事件。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空<br/>stopReason = pending
  rect rgb(255, 230, 213)
    S->>A: block_start #0 text
    S->>A: text_delta ×2
    A->>M: text = 我先看看入口文件。
  end
--- 工具调用块：`block_start #1 tool_use` 让适配器推入一个 `toolCall`，名字是 `read_file`，`arguments` 先是空对象，另外开一个 `ToolCallArgumentsStream` 攒参数。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空<br/>stopReason = pending
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  rect rgb(255, 230, 213)
    S->>A: block_start #1 tool_use
    A->>M: toolCall read_file，arguments 为空
  end
--- `input_json_delta` 到达三次，片段只是 JSON 文本，适配器把它们喂给增量解析器，每次更新 `arguments` 的预览快照，界面可以据此显示“正在读 src/……”。但这只是**预览**。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空<br/>stopReason = pending
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  rect rgb(255, 230, 213)
    S->>A: input_json_delta ×3
    Note over A: 攒下 JSON 文本，更新预览
  end
--- `content_block_stop #1`：块结束，才对完整的参数文本做最终解析（`arguments.finish()`），发出 `toolcall_end`。**从这一刻起才可以执行。**
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空<br/>stopReason = pending
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  S->>A: input_json_delta ×3
  Note over A: 攒下 JSON 文本，更新预览
  rect rgb(255, 230, 213)
    S->>A: block_stop #1
    A->>M: arguments = 最终解析的对象
  end
--- `message_delta` 带来停止原因 `tool_use`，被归一化为 `toolUse`，同时记下原始值和输出 token 数；最后发出 `done`，循环拿到的是一条完整的消息。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as Pi 的适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空<br/>stopReason = pending
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  S->>A: input_json_delta ×3
  Note over A: 攒下 JSON 文本，更新预览
  S->>A: block_stop #1
  A->>M: arguments = 最终解析的对象
  rect rgb(255, 230, 213)
    S->>A: message_delta stop_reason=tool_use
    A->>M: stopReason = toolUse
    Note over M: 发出 done 事件
  end
:::


运行实验，观察适配器每发出一个事件时，手里那条消息是什么样的：

@lab node labs/ch02/events.ts | md

注意最后几行：`toolcall_delta` 的时候 `arguments` 已经能显示 `{"path":"src/cli.ts"}`，但只有 `toolcall_end` 之后才是最终解析的结果。界面可以拿预览来显示，循环只能等 `toolcall_end`。

### OpenAI 的流：没有“块”，靠 index

OpenAI 的流没有“块”的概念。每个 chunk 带一个 `delta`，里面可能有文字，也可能有 `tool_calls` 的片段。工具调用靠 `index` 区分（不是靠 `id`，`id` 和函数名只在第一个片段里出现，后面的片段只带 `arguments` 的一小截）。最后一个带 `finish_reason` 的 chunk 之后，如果请求了 `include_usage`，还会有一个 `choices` 为空、只带用量的 chunk，然后是 `data: [DONE]`。Pi 的 OpenAI 适配器里，按 `index` 找到（或新建）对应调用块的是这一段：

@pi packages/ai/src/api/openai-completions.ts#L485-L530 collapse=true

下面的实验用 OpenAI 格式的测试样本做三件事：先把 1945 字节按每 7 字节切开，找出一刀切在汉字中间的位置；再逐块列出每个数据块带来什么、累计成什么；最后拿 Pi 的适配器真正返回的消息和这张表算出来的结果核对：

@lab node labs/ch02/stream.ts | md

### 真实的流和样本有什么不同

测试样本是教科书式的：参数分三片到达。真实模型的流更乱一些。下面是 MiniMax-M3.1-Flash 的一次真实回复（`labs/ch02/record-stream.ts` 在 `fetch` 外面包一层，把响应体的字节原样抄下来；响应体里没有 Key）：

@lab node labs/ch02/inspect-recorded.ts | md

三处和样本不同：

- **思考内容走另一个字段。** 23 个块的 `delta` 里是 `reasoning_content`，不是 `content`；
- **工具调用不一定分片。** 这次两个调用各占一整块，`arguments` 一次给全；`index` 把它们分到两个调用里；
- **没有用量块。** 请求里没有要求 `include_usage`，这次回复的 token 数不可知。

把测试样本的 OpenAI 和 Anthropic 两个版本，以及这段真实字节流，交给 Pi 的适配器：

@lab node labs/ch02/replay.ts | md

两种线上格式的样本归一化之后内容完全一致；真实回复里，Pi 把那 441 个字符的思考内容存成了 `thinking` 块，把原始的 `tool_calls` 归一化成了 `toolUse`。

## 工具参数为什么不能边收边执行

注意上面实验里“参数能解析成 JSON？”那一列，以及 `events.ts` 里的预览：`{"pa` 和 `{"path": "src/` 都不能。为了让界面能提前显示“正在读 src/……”，Pi 有一个增量 JSON 解析器（`ToolCallArgumentsStream`），每收到一段就更新一次参数快照，界面可以实时显示模型正在写的文件内容。

但预览**只能用于显示**。

::: predict
假设 Agent 在收到 `{"path": "src/cl` 时就急着执行 `read`，会发生什么？
???
它会去读 `src/cl`。宽松的解析器能把残缺的 JSON 补成 `{"path": "src/cl"}`，这是一个完全合法的参数，类型检查拦不住它。运气好的话文件不存在，返回一个错误；运气不好的话，恰好有一个叫 `src/cl` 的文件或目录，Agent 会带着错误的信息继续工作，而且没有任何报错。

同样的道理也适用于第 3 章的“输出截断”：被截断的参数在语法上可能是完整的，在语义上却是错的。**只有在参数块明确结束之后，才能执行工具。**
:::

## 停止原因：把各家的说法翻译成几个词

每条回复结束时，服务商都会告诉你它为什么停下。各家用词不同，适配器负责翻译成统一的几个词：

| 归一化 | Anthropic | OpenAI | 循环应该怎么做（第 3 章） |
| --- | --- | --- | --- |
| `stop` | `end_turn`、`stop_sequence`、`pause_turn` | `stop` | 正常结束；如果没有工具请求，本次运行完成 |
| `toolUse` | `tool_use` | `tool_calls` | 执行工具，带着结果再请求一次 |
| `length` | `max_tokens` | `length` | 输出被截断：文字可以保留，**工具调用一个都不能执行** |
| `error` | `refusal`、未知值 | `content_filter`、未知值 | 结束运行，把原因告诉用户 |
| `aborted` | （本地取消） | （本地取消） | 用户取消，结束运行 |

最后一个分支值得停下来想一想：**服务商哪天新增了一个停止原因，你的代码应该怎么办？**

把未知值当成 `stop` 是最省事的写法，也是最危险的：如果新原因的含义其实是“被截断了”，你的 Agent 就会在不知不觉中执行半截参数。Pi 的两个适配器给出了两种不同的“不猜”。Anthropic 适配器遇到未知值直接抛出异常：

@pi packages/ai/src/api/anthropic-messages.ts#mapStopReason

OpenAI 兼容适配器面对的服务商五花八门，它选择把未知值映射为错误，同时把原始值写进错误信息：

@pi packages/ai/src/api/openai-completions.ts#mapStopReason

两种做法的共同点是 **fail closed**：不确定的时候走失败路径，而不是走成功路径。这是 Agent 工程里反复出现的原则，第 14 章的权限系统还会再遇到它。

## 流被掐断时

网络不可靠。连接可能在任何时候断开：模型刚说了半句话，或者工具参数刚生成到一半。

“断开”有两种。一种是连接被重置，响应体会抛出异常，调用方一定知道出事了。另一种更隐蔽：服务端提前收尾，或者中间的代理把流截断后**正常关闭**。对读流的代码来说这只是流结束了，没有异常。这时手里有一条“看起来还挺完整”的消息：一段文字，加上一个参数残缺的工具调用。如果代码把“流结束了”当成“回复结束了”，用户只会看到一句没头没尾的话，**而且没有任何报错**。

实验用假服务发送到一半就正常结束连接，OpenAI 和 Anthropic 两种格式各在三个位置截断：

@lab node labs/ch02/cut.ts | md

::: steps 流在半路断开时适配器怎么判断
--- 流开始时一切正常：适配器收到一段文字，以及工具调用的前半截参数，消息里已经有“看起来还挺完整”的内容。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as Pi 的适配器
  participant L as 循环
  rect rgb(255, 230, 213)
    S->>A: 文字块 + 工具调用开头
    Note over A: 参数只攒到 {"pa
  end
--- 连接在这里断开：没有 `content_block_stop`，也**没有 `message_delta`**，所以没有任何停止原因。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as Pi 的适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  rect rgb(255, 230, 213)
    S--xA: 连接断开
  end
--- `for await` 因为流结束而退出。Anthropic 适配器发现看到了 `message_start` 却没有 `message_stop`；OpenAI 适配器发现没收到 `finish_reason`。两边都判定为失败，已收到的内容原样保留在消息里。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as Pi 的适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  S--xA: 连接断开
  rect rgb(255, 230, 213)
    Note over A: 没有收到停止原因<br/>stopReason 仍是 pending
    A->>L: 返回消息 stopReason = error
  end
--- 循环只需要处理一种返回值：看到 `error`，直接结束运行，**不执行其中的工具调用**；用户看到的是明确的错误，而不是一句没头没尾的话。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as Pi 的适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  S--xA: 连接断开
  Note over A: 没有收到停止原因<br/>stopReason 仍是 pending
  A->>L: 返回消息 stopReason = error
  rect rgb(255, 230, 213)
    Note over L: 按 stopReason 分支<br/>error：结束运行
  end
:::


六种情况 Pi 都判定为失败，已收到的内容原样保留（包括残缺的 `read_file({})`，它不会被执行）。它怎么发现的？有两道保险。第一，每条回复的停止原因初始值是 `pending`（一个不属于任何正常结果的值），只有收到服务商明确的停止原因才会被改写；第二，流结束时检查这个值：

@pi packages/ai/src/api/anthropic-messages.ts#L890-L922

OpenAI 适配器在流结束时做同样的检查：

@pi packages/ai/src/api/openai-completions.ts#L684-L692

::: insight “没有收到结束信号”不等于“结束了”
初始值用 `pending` 而不是 `stop`，是一个很小但很关键的设计：它让“什么都没发生”和“正常结束”在类型上就可以区分。很多 Agent 的偶发性“回答到一半就停了”问题，根源就在这里。
:::

## 约定：适配器不抛异常

再看一眼上面那段 Pi 代码的末尾：`catch` 里没有把异常继续抛出去，而是把错误写进 `output.stopReason` 和 `output.errorMessage`，作为一个 `error` 事件推给调用方。同样三种失败，在 Pi 里的样子：

@lab node labs/ch02/errors.ts | md

适配器一次异常都没有抛：限流、服务端出错、用户取消，都变成了一条正常返回的消息，取消时已经收到的半句话还保留在里面。

为什么不直接抛异常？

1. **循环只需要处理一种返回值。** 不管成功还是失败，拿到的都是一条 `AssistantMessage`，看 `stopReason` 分支即可。不会有某个代码路径忘了 `try/catch`，导致整个 Agent 崩溃。
2. **部分内容得以保留。** 流在中途失败时，已经收到的文字仍然在消息里，可以展示给用户，也可以写进会话记录用于排查。
3. **错误本身成为历史的一部分。** 失败的回复也被记录下来，会话恢复时能看到“这里出过错”。

代价是历史里多了一种“不能原样发回 API 的消息”，每个读历史的地方都得知道它。Pi 把这个约定写进了流式事件的类型定义：成功的流以 `done` 结束，失败的流以 `error` 结束，而 `error` 事件携带的仍然是一条完整的 `AssistantMessage`。

@pi packages/ai/src/types.ts#AssistantMessageEvent

## Pi 的模型层还做了什么

主路径上，各家适配器做的都是同一件事：翻译请求、拼流、归一化停止原因。Pi 多出来的代码在处理这些问题：

| Pi 多做的事 | 为什么需要 |
| --- | --- |
| **思考块与签名**（`thinking`、`thinkingSignature`） | 支持推理的模型会返回思考内容和一段加密签名，下一次请求必须原样带回，否则服务端拒绝或丢失推理连续性 |
| **提示缓存标记**（`cache_control`） | 在历史末尾打上缓存标记，让下一次请求复用前缀，显著降低成本（第 6 章） |
| **用量与费用**（`usage.cost`） | 根据模型目录里的单价计算每次请求的花费，界面可以实时显示 |
| **模型目录**（`models.generated.ts`） | 每个模型的上下文窗口、最大输出、是否支持图片和推理，压缩和截断都依赖这些数字 |
| **重试与超时**（`utils/provider-retry.ts`） | 区分可重试的错误（限流、过载）和不可重试的错误（参数错误） |
| **JSON 修复**（`parseJsonWithRepair`） | 有的服务商偶尔会发出不严格的 JSON |
| **兼容性推断** | 根据服务商名字和地址决定字段格式，处理“兼容但不完全兼容” |

Pi 的 `AssistantMessage` 多出来的字段，基本就是这张表的缩影：

@pi packages/ai/src/types.ts#AssistantMessage collapse=true

### 测试：脚本模型

课程的默认离线实验不需要 API Key。这依赖一个关键的测试手段：**脚本模型**。它提供与真实模型相同的调用接口，包括流式事件，但回复由测试脚本决定。Pi 的测试大量使用这个手段，它叫 faux provider（`packages/ai/src/providers/faux.ts`）。第 1 章和第 3 章的对照实验，就是用 Pi 的 faux provider 驱动 Pi 真实的循环。

测试 Agent 时有三种互补的手段：

- **脚本模型**：测试循环和工具在各种模型行为下是否正确（截断、出错、调用不存在的工具）。确定、快速、免费。
- **协议样本和真实录制**：例如 `labs/ch02/fixtures` 里预先准备的 SSE 数据（测试样本，没有线上来源），和 `labs/ch02/recorded` 里 MiniMax 的真实字节流，用来检查切包和解析。
- **真实 API 观察**：在明确授权和配置凭据后调用服务商，记录可公开的响应字段。

它们测试的都是“程序对模型行为的反应”，而不是“模型本身好不好”。后者是评测（第 20 章）要回答的问题。

## 请求里还有几个关键开关

上面的请求体只用到了最基本的字段。真实的 Agent 还会碰到下面几个，它们都会影响循环的行为。

**`tool_choice`：模型必须调用工具吗？** 常见取值是 `auto`（模型自己决定）、`none`（禁止调用工具）、`required` / `any`（必须调用某个工具），或者指定某一个工具。Agent 主循环几乎总是用 `auto`——强制调用会让模型无法给出最终回答。Pi 的统一类型只暴露了两个值：

@pi packages/ai/src/types.ts#L135

强制调用更常见于“用工具来拿结构化输出”的场景：只给模型一个工具，要求它必须调用，工具的参数就是你想要的 JSON。

**并行工具调用：一条回复里可以有多个工具请求。** 前面的实验里，模型在同一条回复中请求读两个文件，真实的 MiniMax 回复也是这样。OpenAI 用 `parallel_tool_calls` 控制是否允许这样做，Anthropic 在 `tool_choice` 里用 `disable_parallel_tool_use` 关掉它。允许并行能省下请求次数，但循环必须正确处理“一批”结果：每个请求都要有对应的结果，并且要决定这批工具是并行执行还是依次执行（第 4 章）。

**思考内容：要原样还回去。** 支持推理的模型会在回复里带上思考内容。Anthropic 返回 `thinking` 块和一段 `signature`；OpenAI 的推理模型返回加密的推理内容；MiniMax 这次的流里是 `reasoning_content` 字段。它们的共同要求是：**下一次请求时原样带回**，尤其是在工具调用的中间。服务端靠签名确认这段推理确实是它自己生成的，并据此延续推理过程。Pi 把它们统一成一种内容块：

@pi packages/ai/src/types.ts#L428-L436

回头看前面的 `replay.ts` 输出：Pi 把那 441 个字符存成了 `thinking` 块，`thinkingSignature` 记着它来自哪个字段，下一次请求会按同样的字段名带回去。这也是适配器不能随意“清洗”历史的原因之一：删掉或改写一个思考块，下一次请求就可能被拒绝。

**服务端状态：能用，但 Pi 不用。** 第 1 章说模型 API 是无状态的。严格地说，有的 API 提供了服务端保存对话的选项，例如 OpenAI 的 Responses API 可以把回复存在服务端，下一次只传一个 id。Pi 的 Responses 适配器刻意关掉了它（`store: false`），并要求服务端把加密的推理内容随回复返回，由 Pi 自己在下一次请求时带回：

@pi packages/ai/src/api/openai-responses.ts#L363-L371

原因很实际：历史掌握在自己手里，才能压缩（第 8 章）、分叉和回退（第 7 章）、在不同服务商之间切换模型，以及在本地完整地记录会话。这几乎是所有 coding agent 的共同选择。

### 一次真实 MiniMax M3.1 Flash 工具调用

下面的记录是在 2026-11-05 使用 MiniMax 的 OpenAI 兼容接口**实际请求两次**得到的（用单独的 Python 脚本），模型响应返回的名称为 `MiniMax-M3.1-Flash`。提问和 README 均为本实验临时创建的公开示例；没有发送你的项目文件。页面展示来自仓库中的脱敏记录，不会在构建时发起联网或消耗额度。

@lab node labs/ch02/show-minimax-record.mjs --markdown | md

沿着这份真实记录读：第一轮 SSE 的 `tool_calls` 先收到 `id` 和函数名，再收到 `arguments`。脚本组装后验证工具名和路径，在临时目录读取 `README.md`；随后把**原样的 id**放进 `tool_call_id`，附上真实文件内容，发起第二轮请求。最后一段是第二轮实际返回的回答。这一轮发出的 `messages` 就是上面 `wire.ts` 里 OpenAI 那一份的形状：assistant 的 `tool_calls` 加一条 `role: 'tool'`。

这份记录省略了模型的推理原文，也不包含 API Key。这一次第一轮没有返回非空 `reasoning_content`（`reasoning_chars` 为 0），而前面单独录制的那次返回了 441 个字符：同一个模型，是否带思考内容随问题而变。根据 [MiniMax 官方 OpenAI SDK 文档](https://platform.minimax.io/docs/api-reference/text-openai-api)，如果工具调用前返回了该字段，多轮请求需要保留完整的 assistant 消息，包括 `tool_calls` 和 `reasoning_content`。Pi 把它存成 `thinking` 块、下一次请求再带回，正好满足这个要求。

要自己重新运行这个 Python 实验，需要 Python 3、可用的 MiniMax API Key 和模型权限；它会产生真实用量。先在当前终端设置 `MINIMAX_API_KEY`，然后运行：

```bash
python3 labs/ch02/minimax-live.py

# 中国区密钥可按账户平台设置对应端点
MINIMAX_BASE_URL=https://api.minimaxi.com/v1 python3 labs/ch02/minimax-live.py
```

国际区默认使用 `https://api.minimax.io/v1`。可选 `--record 路径.json` 保存脱敏观察；脚本不读取个人项目，不打印密钥，也不保存推理原文。想重新录制那份流式响应的字节，设好 `MOX_BASE_URL`、`MOX_API_KEY`、`MOX_MODEL` 三个变量后运行 `node labs/ch02/record-stream.ts`。API、权限、模型版本和输出会变化；一次成功不能替代其他环境的验证。第 3 章继续讨论完整循环与失败处理。


## 实战：给 mox 加上模型调用

**这一章的目标**：写出 mox 的 `model.ts`：一个 `openai()` 函数，发出流式请求，把返回的 SSE 拼成一条助手消息和一个 `finish`。mox **只有这一个适配器**：它的内部消息格式直接就是 OpenAI 的格式（第 1 章已经在用了），所以请求方向不需要任何翻译，响应方向只需要拼流。整个文件 45 行，对应上面 Pi 里 `iterateSseMessages` 加 OpenAI 适配器的主干。

### 第 1 步：类型和请求

类型第 1 章已经见过。`Model` 是一个函数，`openai()` 返回它。请求体里 `messages` 就是传进来的数组，`stream: true` 要求服务端用 SSE 分段回复，`tools` 每项包一层 `{ type: 'function', function: … }`。`signal` 直接交给 `fetch`，取消就靠它。请求失败（HTTP 状态不是 2xx）就抛一个带状态码和正文的异常：

@code mox/src/model.ts#L9-L17 hl=11-16,17

### 第 2 步：切行

对应 Pi 的 `consumeLine`。每一块用 `decoder.decode(chunk, { stream: true })` 解码，拼进 `buffer`，只处理换行之前的完整行，最后那个可能不完整的片段用 `lines.pop()` 留给下一轮：

@code mox/src/model.ts#L19-L26 hl=19,23-25

注意 `finish` 的初始值是**空串**。为什么不是 `'stop'`？第 4 步解释。

### 第 3 步：处理每一行

只看以 `data:` 开头的行，`[DONE]` 和没有 `choices` 的用量块跳过；`delta.content` 是文字，累加进 `text` 并立即通过 `onText` 送出去；`delta.tool_calls` 是工具调用的分片：**按 `index` 找到或新建 `calls` 里的那一项**，`id` 和 `name` 取第一次出现的，`arguments` 一律追加。这四行就是 Pi 里 `ensureToolCallBlock` 那一大段的最小版本：

@code mox/src/model.ts#L27-L38 hl=30,32-37,38

::: steps 工具调用的分片是怎样被拼成一个完整调用的（mox 的 openai()）
--- 流从一个只带 `role` 的开场块开始。`openai()` 此时有三个空东西：`text = ''`、`calls = []`、`finish = ''`（空串表示“还没收到结束信号”）。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  rect rgb(255, 230, 213)
    S->>O: 开场块（只有 role）
    Note over O: text 空，calls 空
  end
--- 文字块：两个 `delta.content` 依次拼进 `text`，**每一块当场**通过 `onText` 送到屏幕上，不等整条回复结束。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  S->>O: 开场块（只有 role）
  Note over O: text 空，calls 空
  rect rgb(255, 230, 213)
    S->>O: content “我先看看”
    S->>O: content “入口文件。”
    O-->>R: onText 两次，屏幕上先出现文字
  end
--- 第一个工具调用片段到达：`index=0`，带着 `id` 和函数名，`arguments` 还是空串。`calls[0]` 在这一刻被创建。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  S->>O: 开场块（只有 role）
  Note over O: text 空，calls 空
  S->>O: content “我先看看”
  S->>O: content “入口文件。”
  O-->>R: onText 两次，屏幕上先出现文字
  rect rgb(255, 230, 213)
    S->>O: tool_calls index=0 id=call_01 read_file
    Note over O: calls[0] 创建：id、name 有了，arguments 为空
  end
--- 三个参数片段依次追加：`{"pa` → `{"path": "src/` → `{"path": "src/cli.ts"}`。前两个状态都不是合法 JSON，只有拼完的最后一个才是。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  S->>O: 开场块（只有 role）
  Note over O: text 空，calls 空
  S->>O: content “我先看看”
  S->>O: content “入口文件。”
  O-->>R: onText 两次，屏幕上先出现文字
  S->>O: tool_calls index=0 id=call_01 read_file
  Note over O: calls[0] 创建：id、name 有了，arguments 为空
  rect rgb(255, 230, 213)
    S->>O: arguments 片段 ×3（index=0）
    Note over O: 逐片追加，拼完才是合法 JSON
  end
--- `finish_reason: tool_calls` 到达，记进 `finish`。接着是一个只带用量、`choices` 为空的块（被 `continue` 跳过）和 `[DONE]`。流结束。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  S->>O: 开场块（只有 role）
  Note over O: text 空，calls 空
  S->>O: content “我先看看”
  S->>O: content “入口文件。”
  O-->>R: onText 两次，屏幕上先出现文字
  S->>O: tool_calls index=0 id=call_01 read_file
  Note over O: calls[0] 创建：id、name 有了，arguments 为空
  S->>O: arguments 片段 ×3（index=0）
  Note over O: 逐片追加，拼完才是合法 JSON
  rect rgb(255, 230, 213)
    S->>O: finish_reason = tool_calls
    S->>O: 用量块、[DONE]
    Note over O: finish = tool_calls
  end
--- `for await` 结束，先检查 `finish` 不是空串，再把 `text`、`calls`、`finish` 装成 `{ message, finish }` 返回。**从这一刻起，`runLoop` 才第一次看到这些工具调用**，参数是完整的。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant O as openai()
  participant R as 返回的消息
  S->>O: 开场块（只有 role）
  Note over O: text 空，calls 空
  S->>O: content “我先看看”
  S->>O: content “入口文件。”
  O-->>R: onText 两次，屏幕上先出现文字
  S->>O: tool_calls index=0 id=call_01 read_file
  Note over O: calls[0] 创建：id、name 有了，arguments 为空
  S->>O: arguments 片段 ×3（index=0）
  Note over O: 逐片追加，拼完才是合法 JSON
  S->>O: finish_reason = tool_calls
  S->>O: 用量块、[DONE]
  Note over O: finish = tool_calls
  rect rgb(255, 230, 213)
    O-->>R: 返回 message + finish
    Note over R: content、tool_calls[0] 参数完整
  end
:::


### 第 4 步：收尾，断流要报错

流结束之后，如果 `finish` 还是空串，说明连接中途断了（或者代理把流截断后正常关闭），说到一半的话不能当成回答，直接抛错。这就是 Pi 的 `pending` 检查：

@code mox/src/model.ts#L41-L43 hl=42-43

这里的关键是第 2 步那个**空串初始值**：如果 `finish` 初始是 `'stop'`，“什么都没收到”和“正常停止”就无法区分，第 42 行的检查也就无从写起。

### 第 5 步：检验

`practice.ts` 用本地假服务驱动你的 `openai()`：被切成 7 字节一片的测试样本、真实的 MiniMax 录制（并和 Pi 读出的结果对照）、三种位置的断流、HTTP 429、取消：

```bash
node labs/ch02/practice.ts                      # 参考实现
MOX_DIR=~/my-mox node labs/ch02/practice.ts     # 你自己写的
```

@lab node labs/ch02/practice.ts | md

### mox 比 Pi 省掉了什么

读上面的表：mox 和 Pi 在**真实录制**上读出了完全一致的工具调用，但 mox 只留下了两样：文字和工具调用。

| | mox 的 `openai()` | Pi 的适配器 |
| --- | --- | --- |
| 格式 | 只说 OpenAI 的方言 | 每家一个适配器 |
| 思考内容 | 丢掉 `reasoning_content` | `thinking` 块，带签名，原样回传 |
| 停止原因 | 原样保留 `finish`，循环只认 `length` | 归一化成 `stop` / `toolUse` / `length` / `error` / `aborted` |
| 用量与缓存 | 不请求用量块，不打缓存标记 | `usage.cost`，`cache_control` |
| 失败 | **抛异常**：HTTP 错误、取消、断流 | **返回**一条 `stopReason: error / aborted` 的消息 |
| 重试 | 没有 | `provider-retry` |

“抛异常还是返回错误”是最值得想的一行。practice 输出里 HTTP 429、断流、取消三种失败，mox 全部是抛异常：调用者（第 3 章的 `runLoop` 不捕获它，命令行里有一个 `catch`）必须自己处理。好处是代码少，失败的回复永远不会进历史，历史保持合法；代价是已经流出的半句话丢了，也没有地方记录“这里出过错”。mox 的场景是“一个人在终端里用”，失败了让用户知道、再试一次就够；Pi 要服务 RPC、SDK 和无人值守的运行（第 18、19 章），失败必须是可记录、可重试的状态。

### 你来改

::: predict 把 finish 的初始值改回 'stop'
把 `model.ts` 里 `finish = ''` 改成 `finish = 'stop'`（第 42 行的检查永远不会触发）。重新运行 `practice.ts`，哪几条检查会失败？
???
三条断流检查全部失败：`openai()` 不再抛错，文字说到一半时返回半句话和 `finish='stop'`，参数残缺时返回残缺的参数，参数完整只差 `finish_reason` 时返回正常的消息。一条本该报错的失败伪装成了一次成功：第 3 章的循环会把半句话当作最终回答。检查所在的那一行是整个“断流保护”的全部，空串初始值是它的前提。
:::

::: predict 保存并回传 reasoning_content
更对的做法：让助手消息多一个可选的 `reasoning_content` 字段，`openai()` 把 `delta.reasoning_content` 拼进去，下一次请求原样带回。MiniMax 的文档要求多轮工具调用时这样做；DeepSeek 的文档则相反，带回会返回 400。这个改动该在 `openai()` 里无条件做吗？
???
不该。同样叫“OpenAI 兼容”，两家对思考内容的要求相反：MiniMax 要求带回，DeepSeek 带回会被拒绝。无条件保存并回传，会让 mox 在其中一家上出错；不保存（mox 现在的做法），在 MiniMax 上对短任务没出问题，对依赖推理连续性的长任务可能变差。可行的做法是给 `openai()` 加一个选项（比如 `keepReasoning`），按服务商开关，这正是 Pi 里“兼容性推断”要处理的事情。
:::

::: predict 给 Model 包一层重试
写一个 `retry(model, times)`，返回的函数在 `model(request)` 抛出异常时重试，最多 `times` 次。这个包装放在哪里？循环要不要改？取消（`AbortError`）该不该重试？
???
放在组装 `model` 的地方（命令行里 `openai(...)` 的外面），循环一行都不用改，因为它只依赖 `Model` 这个函数类型。取消**不应该**重试：捕获到异常后先检查 `request.signal?.aborted`，是用户取消就原样抛出。还要决定哪些错误值得重试：429 和 5xx 值得，400（请求本身有问题）重试多少次都一样。这正是 Pi 的 `provider-retry.ts` 做的事，只是它还要处理退避和服务端给的等待时间。
:::

**练习：给 mox 写一个 Anthropic 适配器。** mox 刻意没有它，补上正好把本章的东西串起来。适配器就是另一个返回 `Model` 的函数，循环认的是 `{ message, finish }` 的形状，不关心背后是谁。三件事：

1. **请求方向。** `system` 消息提到顶层 `system` 字段；assistant 的 `tool_calls` 变成 `tool_use` 块，`arguments` 从 JSON 文本解析成对象 `input`；一批连续的 `role: 'tool'` 消息合并成同一条 user 消息里的 `tool_result` 块。mox 的工具消息没有错误标记，`is_error` 只能依赖约定（失败结果以“错误：”开头）。
2. **响应方向。** 事件靠 `data:` 里的 `type` 区分。`content_block_start` 遇到 `tool_use` 建一个调用，用块的 `index` 记下来；`input_json_delta` 追加到对应调用的 `arguments`（保持字符串，不要提前解析）；`text_delta` 追加文字并调用 `onText`。
3. **停止原因。** `end_turn` → `stop`，`tool_use` → `tool_calls`，`max_tokens` → `length`。其余一律抛异常，没收到 `stop_reason` 也抛异常。

先自己写，再对照参考答案。请求方向的翻译只要三十行：

@code labs/ch02/adapter.ts#toAnthropic

参考答案对照三项检查：读 Anthropic 样本的结果与 `openai()` 读 OpenAI 样本一致；同一段对话翻译出的请求体与 Pi 发出的结构一致；流断开时报错；最后放进 `runLoop`，循环一行没改。

@lab node labs/ch02/adapter-demo.ts

## 面试题

先自己回答，再展开对照要点。

::: interview 如何设计一个支持多家模型的 Agent？
核心是**内部统一格式 + 每家一个适配器**（防腐层）：

- 内部格式定义消息、内容块（文字、工具调用、思考）、工具结果、停止原因、用量。循环和上层只认内部格式。
- 适配器负责双向翻译：请求方向处理系统提示位置、工具说明格式、工具结果的表示与合并；响应方向把流式事件组装成内部消息，并归一化停止原因。
- 失败怎么表达要有约定：Pi 让适配器不抛异常，失败编码在消息里，保留部分内容。

另一条路是像 mox 那样直接采用某一家的格式（OpenAI 兼容格式事实上是通用语），换来极小的代码量，代价是够不着别家独有的能力（思考签名、缓存标记），也没有地方放归一化的停止原因和用量。

加分点：提到“兼容格式不等于完全兼容”，需要按服务商做兼容性配置；思考块签名需要原样回传；用模型目录记录上下文窗口等元数据，供压缩和截断使用。
:::

::: interview 流式响应中的工具调用参数怎么处理？为什么不能提前执行？
参数以 JSON 文本片段的形式逐段到达（Anthropic 的 `input_json_delta`、OpenAI 的 `tool_calls[i].function.arguments`）。适配器先把片段拼接起来：OpenAI 的流靠 `index` 区分各个调用，`id` 和名字只在第一片出现，参数一律追加；Anthropic 的流有明确的块边界。可以用容错解析生成预览供界面显示，但**只有在参数块明确结束后**（Anthropic 的 `content_block_stop`，OpenAI 的流结束）才做最终解析。

不能提前执行，是因为不完整的参数在语法上可能完全合法（`"src/cl"` 是一个合法字符串），执行后果不可预测。同理，回复因为长度上限被截断时，参数也不可信。mox 的做法是让模型函数整条回复结束才返回，参数保持字符串，到执行时才解析。
:::

::: interview Stop reason 有哪些？遇到 length 或未知值时应该怎么办？
归一化后通常是：正常结束、请求工具、长度截断、错误、取消。

- **length**：文字可以保留展示，但其中的工具调用一个都不能执行，应该生成错误结果告诉模型“参数可能不完整，请重新发起”。
- **未知值**：按失败处理（fail closed），并保留原始值便于排查。把未知值当作正常结束，可能在新语义出现时悄悄执行错误的操作。
- **流在给出停止原因之前就断开**：同样是失败，不能当成正常结束。用一个“未决”初始值来区分（Pi 的 `pending`，mox 的空串），流结束时检查它；如果把初始值设成 `stop`，被代理截断的流就会被当作正常结束，只能靠后面的 JSON 解析碰运气拦住残缺的参数。
:::

::: interview 模型调用失败时，是抛异常还是返回错误？各有什么取舍？
两种都见过：

- **抛异常**（mox）：代码最少，历史不会混进失败的回复，永远合法；但调用方必须处处 `try/catch`，已经流出的部分内容没有记录，重试要靠调用方另外包一层。
- **返回错误消息**（Pi）：不管成功失败，调用方只处理一种返回值，看 `stopReason` 分支；部分内容保留，错误成为历史的一部分，便于排查和恢复；代价是历史里出现“不能原样发回 API”的消息，每个读历史的地方都要认识它。

选择取决于运行环境：一个人坐在终端前，失败了让他知道再试一次就够；无人值守、需要恢复的运行，失败必须是可记录、可重试的状态。
:::

::: interview tool_call_id 有什么用？
它把模型的工具请求和程序返回的结果一一对应起来。一条回复里可以有多个工具调用，结果的顺序、执行是否并行都可能变化，只有靠 id 才能可靠关联。

服务商通常会校验：每个工具请求都必须有对应的结果，id 必须匹配，否则请求会被拒绝。mox 的 `runLoop` 因此保证“每个调用都有一条结果”，失败、拒绝、取消也一样（第 3 章）。这也是为什么压缩上下文时不能把一个工具请求和它的结果拆开（第 8 章）。
:::

::: interview 怎样测试一个依赖大模型的 Agent？
分层测试：

- **脚本模型**（mock / faux provider）：实现与真实模型相同的接口，回复由脚本控制。用来测试循环、工具、错误处理在各种模型行为下是否正确，确定且免费。mox 的 `Model` 是一个函数，脚本模型就是一个返回预设回复的函数。
- **协议样本与真实录制**：用本地样本检验解析和断流处理；把真实模型的响应字节原样录下来回放，区分可核验的响应和模拟数据。
- **评测**：用真实模型在固定任务集上运行，衡量结果质量，这是另一类问题，需要统计和对照（第 20 章）。

关键认识：单元测试测的是“程序对模型行为的反应”，不是“模型好不好”。
:::

