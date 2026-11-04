---
motto: 循环不该知道它在和哪家模型说话。
learn:
  - 同一段带工具调用的对话，在 Anthropic 和 OpenAI 的请求体里分别长什么样
  - 流式响应怎样被一段段拼回一条完整消息，以及工具参数为什么不能边收边执行
  - 把各家的停止原因翻译成统一的几个词，未知值为什么要当成错误
  - Pi 的模型层怎样用一个统一格式和“适配器不抛异常”的约定，屏蔽二十多家服务商
prereq: 第 1 章
time: 60 分钟
build: mox/src/providers —— Anthropic 与 OpenAI 两个流式适配器，加一个离线脚本模型
---

## 为什么需要一个内部格式

第 1 章的 Agent 直接使用 OpenAI 的线上格式：循环里写着 `reply.tool_calls`、`role: 'tool'`、`tool_call_id`。现在想支持 Anthropic 的模型，会发现几乎每一行都要改——Anthropic 没有 `tool_calls` 字段，工具结果也不是 `role: 'tool'`。

解决办法是在中间加一层：**循环只认一种内部格式，每家服务商配一个适配器，负责双向翻译。** 这是软件工程里常说的“防腐层”。

@figure assets/course/ch02-adapters.png 每家服务商一个适配器：外面的格式各不相同，循环只看到统一的内部消息

下面是 mox 的内部格式。字段名刻意和 Pi 保持一致（`toolCall`、`toolResult`、`stopReason`），这样你读 Pi 源码时会发现自己已经认识这些结构：

@code mox/src/types.ts#region:messages

和 OpenAI 格式相比，有三处刻意的不同：

- 工具参数 `arguments` 是**对象**，不是 JSON 字符串。解析的麻烦留在适配器里，循环拿到的永远是可以直接用的值。
- 工具结果有自己的角色 `toolResult`，还带着 `isError`。Anthropic 和 OpenAI 一个有这个字段、一个没有，内部格式取两者之长。
- 停止原因是**归一化**过的四五个词，原始值另存在 `rawStopReason` 里，方便调试。

一个模型在 mox 里就是一个接口：给它 `Context`，它还你一条 `AssistantMessage`。

@code mox/src/types.ts#region:model

注意注释里的约定：**`stream()` 永远不抛异常。** 本章最后会解释为什么。

## 同一段对话，两种线上格式

构造一段典型的对话：用户提问 → 模型在同一条回复里请求读两个文件 → 两条工具结果（其中一条失败）。把它分别翻译成两家的请求体：

@lab node labs/ch02/wire.ts

把差异整理成表：

| | Anthropic Messages | OpenAI Chat Completions |
| --- | --- | --- |
| 系统提示 | 顶层 `system` 字段 | `messages` 里第一条 `role: "system"` |
| 工具说明 | `tools[].input_schema` | `tools[].function.parameters` |
| 模型的工具请求 | assistant `content` 里的 `tool_use` 块，`input` 是对象 | assistant 的 `tool_calls` 数组，`arguments` 是 **JSON 字符串** |
| 工具结果 | **user** 消息里的 `tool_result` 块；同一批结果放在同一条 user 消息里 | 每个结果一条独立的 `role: "tool"` 消息 |
| 关联方式 | `tool_use_id` | `tool_call_id` |
| 失败的结果 | `is_error: true` | 没有专门字段，只能写进文字 |

内部的 4 条消息，翻译成 Anthropic 是 3 条（两条结果合并了），翻译成 OpenAI 是 5 条（多了一条 system）。两个适配器各自负责这些差异，循环完全不需要知道。

Anthropic 那边最容易写错的就是工具结果的位置：它要求 `tool_result` **紧跟在**发出对应 `tool_use` 的那条 assistant 消息之后。mox 的做法是把连续的工具结果合并进同一条 user 消息。Pi 做的是同一件事，注释里还记下了这么做的另一个原因——有些第三方的 Anthropic 兼容端点只接受这种形式：

::: tabs
@@ mox
@code mox/src/providers/anthropic.ts#toAnthropicMessages hl=30-34
连续的 `toolResult` 合并进同一条 user 消息。
@@ Pi
@pi packages/ai/src/api/anthropic-messages.ts#L1497-L1521
同样合并，并且在注释里写明了兼容第三方端点的原因。
:::

::: insight “兼容”从来不是完全兼容
很多服务商声称“兼容 OpenAI 格式”或“兼容 Anthropic 格式”，但细节各有出入：有的不接受 `content: null`，有的要求工具结果必须合并，有的不认识某些字段。Pi 的 `openai-completions.ts` 里有一个函数专门根据服务商名字和地址推断兼容性设置。生产级的模型层，有相当一部分代码是在处理这些“兼容但不完全兼容”的情况。
:::

## 流式：一条消息是怎样拼出来的

第 1 章的 Agent 等整条回复生成完才拿到结果。真实的 Agent 都用**流式**响应：模型每生成几个字就发一段过来，界面可以实时显示，用户也可以在看到苗头不对时立刻取消。

流式响应用的是 SSE（Server-Sent Events）格式：一串文本行，`event:` 行说明事件类型，`data:` 行是 JSON，空行表示一个事件结束。

```text
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"th\": \"src/"}}

```

解码 SSE 有一个容易忽略的坑：**网络包的边界和行的边界毫无关系。** 一次 `read` 可能只拿到半行，也可能一次拿到好几个事件，甚至把一个中文字符（UTF-8 编码 3 个字节）切成两半。mox 的解码器只在遇到换行时才处理一行，并用 `TextDecoder` 的 `stream: true` 处理跨包的多字节字符：

@code mox/src/sse.ts#readSse

课程的实验用一个本地假服务回放录制好的流，并且**故意每 7 个字节切一刀**，不管切在哪里。解码器在这种条件下仍然要给出正确的结果。

### 两家的事件序列

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

OpenAI 的流没有“块”的概念。每个 chunk 带一个 `delta`，里面可能有文字，也可能有 `tool_calls` 的片段。工具调用靠 `index` 区分（不是靠 `id`，`id` 只在第一个片段里出现）。最后一个带 `finish_reason` 的 chunk 之后，如果请求了 `include_usage`，还会有一个 `choices` 为空、只带用量的 chunk，然后是 `data: [DONE]`。

<figure class="diagram">
<svg viewBox="0 0 720 360" role="img" aria-label="Anthropic 流式事件如何组装成一条消息">
<defs><marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--faint)"/></marker></defs>
<text x="16" y="20" font-size="11.5" font-weight="600" fill="var(--faint)">到达的 SSE 事件（按时间）</text>
<text x="404" y="20" font-size="11.5" font-weight="600" fill="var(--faint)">适配器手里的 AssistantMessage</text>
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


mox 的 Anthropic 适配器按服务端给的 `index` 记录“正在生成的块”，收到增量就拼接，收到 `content_block_stop` 再做最终解析：

@code mox/src/providers/anthropic.ts#parseAnthropicStream collapse=true

::: steps Anthropic 的流式事件怎样拼成一条消息
--- `message_start` 到达：适配器只记下输入 token 数，`content` 还是空数组。此时没有任何可以执行的东西。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  rect rgb(255, 230, 213)
    S->>A: message_start
    Note over M: content 为空
  end
--- 文字块：`content_block_start` 让适配器往 `content` 里推一个空的 text 块，并在 `open` 表里按服务端的 `index` 登记；两个 `text_delta` 依次拼接到这个块上。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空
  rect rgb(255, 230, 213)
    S->>A: block_start #0 text
    S->>A: text_delta ×2
    A->>M: text = 我先看看入口文件。
  end
--- 工具调用块：`block_start #1 tool_use` 让适配器推入一个 `toolCall`，名字是 `read_file`，`arguments` 先是空对象，另外开一个字符串攒参数。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  rect rgb(255, 230, 213)
    S->>A: block_start #1 tool_use
    A->>M: toolCall read_file，arguments 为空
  end
--- `input_json_delta` 到达三次，片段只是 JSON 文本，适配器把它们拼进字符串，并用 `previewJson` 补齐括号生成预览给界面看。`arguments` **仍然是空对象**。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  rect rgb(255, 230, 213)
    S->>A: input_json_delta ×3
    Note over A: 攒下 JSON 文本，只生成预览
  end
--- `content_block_stop #1`：块结束，才对完整的参数文本做最终解析，`arguments` 变成 `{ path: src/cli.ts }`，发出 `toolcall_end`。**从这一刻起才可以执行。**
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  S->>A: input_json_delta ×3
  Note over A: 攒下 JSON 文本，只生成预览
  rect rgb(255, 230, 213)
    S->>A: block_stop #1
    A->>M: arguments = 解析后的对象
  end
--- `message_delta` 带来停止原因 `tool_use`，被归一化为 `toolUse`，同时记下原始值和输出 token 数；循环最后拿到的是一条完整的消息。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端 SSE
  participant A as 适配器
  participant M as AssistantMessage
  S->>A: message_start
  Note over M: content 为空
  S->>A: block_start #0 text
  S->>A: text_delta ×2
  A->>M: text = 我先看看入口文件。
  S->>A: block_start #1 tool_use
  A->>M: toolCall read_file，arguments 为空
  S->>A: input_json_delta ×3
  Note over A: 攒下 JSON 文本，只生成预览
  S->>A: block_stop #1
  A->>M: arguments = 解析后的对象
  rect rgb(255, 230, 213)
    S->>A: message_delta stop_reason=tool_use
    A->>M: stopReason = toolUse
    Note over M: 发出 done 事件
  end
:::

运行实验，观察事件是怎样一个个到达的：

@lab node labs/ch02/replay.ts --events

### 工具参数为什么不能边收边执行

注意上面输出里的“预览”一列。为了让界面能提前显示“正在读 src/……”，mox 会把不完整的 JSON 补齐括号和引号后试着解析（`previewJson`）。Pi 做得更彻底，它有一个增量 JSON 解析器，每收到一段就更新一次参数快照，界面可以实时显示模型正在写的文件内容。

但预览**只能用于显示**。

::: predict
假设 Agent 在收到 `{"path": "src/cl` 时就急着执行 `read`，会发生什么？
???
它会去读 `src/cl`。这是一个完全合法的字符串，类型检查拦不住它。运气好的话文件不存在，返回一个错误；运气不好的话，恰好有一个叫 `src/cl` 的文件或目录，Agent 会带着错误的信息继续工作，而且没有任何报错。

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

mox 的映射函数：

@code mox/src/providers/anthropic.ts#mapAnthropicStopReason

最后一个分支值得停下来想一想：**服务商哪天新增了一个停止原因，你的代码应该怎么办？**

把未知值当成 `stop` 是最省事的写法，也是最危险的：如果新原因的含义其实是“被截断了”，你的 Agent 就会在不知不觉中执行半截参数。mox 选择把未知值当成错误，宁可失败也不猜。

Pi 的两个适配器在这里给出了两种不同的“不猜”。Anthropic 适配器遇到未知值直接抛出异常：

@pi packages/ai/src/api/anthropic-messages.ts#mapStopReason

OpenAI 兼容适配器面对的服务商五花八门，它选择把未知值映射为错误，同时把原始值写进错误信息：

@pi packages/ai/src/api/openai-completions.ts#mapStopReason

两种做法的共同点是 **fail closed**：不确定的时候走失败路径，而不是走成功路径。这是 Agent 工程里反复出现的原则，第 14 章的权限系统还会再遇到它。

## 流被掐断时

网络不可靠。连接可能在任何时候断开：模型刚说了半句话，或者工具参数刚生成到一半。

这时适配器手里有一条“看起来还挺完整”的消息：一段文字，加上一个参数为空的工具调用。如果适配器把“流结束了”当成“回复结束了”，并且停止原因的默认值恰好是 `stop`，循环就会认为模型说完了，用户只看到一句没头没尾的话，**而且没有任何报错**。

实验让假服务在发送到一半时断开连接：

@lab node labs/ch02/cut.ts

::: steps 流在半路断开时适配器怎么判断
--- 流开始时一切正常：适配器收到一段文字，以及工具调用的前半截参数，消息里已经有“看起来还挺完整”的内容。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as 适配器
  participant L as 循环
  rect rgb(255, 230, 213)
    S->>A: 文字块 + 工具调用开头
    Note over A: 参数只攒到 {"pa
  end
--- 连接在这里断开：没有 `content_block_stop`，也**没有 `message_delta`**，所以没有任何停止原因。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as 适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  rect rgb(255, 230, 213)
    S--x A: 连接断开
  end
--- `for await` 因为流结束而退出。mox 检查 `rawStopReason` 是否存在；Pi 则检查停止原因是否还是初始值 `pending`。两边都判定为失败，已收到的内容原样保留。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as 适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  S--x A: 连接断开
  rect rgb(255, 230, 213)
    Note over A: 没有收到停止原因
    A->>L: 返回消息 stopReason = error
  end
--- 循环只需要处理一种返回值：看到 `error`，直接结束运行，**不执行其中的工具调用**；用户看到的是明确的错误，而不是一句没头没尾的话。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant S as 服务端
  participant A as 适配器
  participant L as 循环
  S->>A: 文字块 + 工具调用开头
  Note over A: 参数只攒到 {"pa
  S--x A: 连接断开
  Note over A: 没有收到停止原因
  A->>L: 返回消息 stopReason = error
  rect rgb(255, 230, 213)
    Note over L: 按 stopReason 分支<br/>error：结束运行
  end
:::

两个实现都正确地报告了错误，只是发现问题的位置不同：mox 在流结束后检查“有没有收到停止原因”；Pi 在解析最后一个不完整的事件时就失败了。

Pi 在这里有两道保险。第一，每条回复的停止原因初始值是 `pending`（一个不属于任何正常结果的值），只有收到服务商明确的停止原因才会被改写；第二，流结束时检查这个值：

@pi packages/ai/src/api/anthropic-messages.ts#L890-L922

::: insight “没有收到结束信号”不等于“结束了”
初始值用 `pending` 而不是 `stop`，是一个很小但很关键的设计：它让“什么都没发生”和“正常结束”在类型上就可以区分。很多 Agent 的偶发性“回答到一半就停了”问题，根源就在这里。
:::

## 约定：适配器不抛异常

再看一眼上面那段 Pi 代码的末尾：`catch` 里没有把异常继续抛出去，而是把错误写进 `output.stopReason` 和 `output.errorMessage`，作为一个 `error` 事件推给调用方。mox 的 `failedMessage` 做的是同一件事。

为什么不直接抛异常？

1. **循环只需要处理一种返回值。** 不管成功还是失败，拿到的都是一条 `AssistantMessage`，看 `stopReason` 分支即可。不会有某个代码路径忘了 `try/catch`，导致整个 Agent 崩溃。
2. **部分内容得以保留。** 流在中途失败时，已经收到的文字仍然在消息里，可以展示给用户，也可以写进会话记录用于排查。
3. **错误本身成为历史的一部分。** 失败的回复也被记录下来，会话恢复时能看到“这里出过错”。

Pi 把这个约定写进了流式事件的类型定义：成功的流以 `done` 结束，失败的流以 `error` 结束，而 `error` 事件携带的仍然是一条完整的 `AssistantMessage`。

@pi packages/ai/src/types.ts#L807-L840

## Pi 的模型层还做了什么

把同一段录制的字节流交给 mox 的两个适配器和 Pi 的两个适配器，四个实现得到同样的内容：

@lab node labs/ch02/replay.ts

主路径上，mox 两百多行的适配器和 Pi 一千多行的适配器做的是同一件事。Pi 多出来的代码在处理这些问题：

| Pi 多做的事 | 为什么需要 |
| --- | --- |
| **思考块与签名**（`thinking`、`thinkingSignature`） | 支持推理的模型会返回思考内容和一段加密签名，下一次请求必须原样带回，否则服务端拒绝或丢失推理连续性 |
| **提示缓存标记**（`cache_control`） | 在历史末尾打上缓存标记，让下一次请求复用前缀，显著降低成本（第 6 章） |
| **用量与费用**（`usage.cost`） | 根据模型目录里的单价计算每次请求的花费，界面可以实时显示 |
| **模型目录**（`models.generated.ts`） | 每个模型的上下文窗口、最大输出、是否支持图片和推理，压缩和截断都依赖这些数字 |
| **重试与超时**（`utils/provider-retry.ts`） | 区分可重试的错误（限流、过载）和不可重试的错误（参数错误） |
| **JSON 修复**（`parseJsonWithRepair`） | 有的服务商偶尔会发出不严格的 JSON |
| **兼容性推断** | 根据服务商名字和地址决定字段格式，处理“兼容但不完全兼容” |

Pi 的 `AssistantMessage` 比 mox 的多出来的字段，基本就是这张表的缩影：

@pi packages/ai/src/types.ts#AssistantMessage collapse=true

### 测试：脚本模型

你可能已经注意到，这门课的所有实验都不需要 API Key。这依赖一个关键的测试手段：**脚本模型**。它实现和真实模型完全相同的接口，包括流式事件，但回复由测试脚本决定：

@code mox/src/providers/scripted.ts#scripted collapse=true

Pi 的测试大量使用同样的手段，它叫 faux provider（`packages/ai/src/providers/faux.ts`）。第 1 章和第 3 章的对照实验，就是用 Pi 的 faux provider 驱动 Pi 真实的循环。

测试 Agent 时有两种互补的手段：

- **脚本模型**：测试循环和工具在各种模型行为下是否正确（截断、出错、调用不存在的工具）。确定、快速、免费。
- **录制的线上数据**：测试适配器能否正确解析真实服务商的字节流，就像本章的 `labs/ch02/fixtures`。

它们测试的都是“程序对模型行为的反应”，而不是“模型本身好不好”。后者是评测（第 20 章）要回答的问题。

## 请求里还有几个关键开关

上面的请求体只用到了最基本的字段。真实的 Agent 还会碰到下面几个，它们都会影响循环的行为。

**`tool_choice`：模型必须调用工具吗？** 常见取值是 `auto`（模型自己决定）、`none`（禁止调用工具）、`required` / `any`（必须调用某个工具），或者指定某一个工具。Agent 主循环几乎总是用 `auto`——强制调用会让模型无法给出最终回答。Pi 的统一类型只暴露了两个值：

@pi packages/ai/src/types.ts#L135

强制调用更常见于“用工具来拿结构化输出”的场景：只给模型一个工具，要求它必须调用，工具的参数就是你想要的 JSON。

**并行工具调用：一条回复里可以有多个工具请求。** 第 2 节的例子里，模型在同一条回复中请求读两个文件。OpenAI 用 `parallel_tool_calls` 控制是否允许这样做，Anthropic 在 `tool_choice` 里用 `disable_parallel_tool_use` 关掉它。允许并行能省下请求次数，但循环必须正确处理“一批”结果：每个请求都要有对应的结果，并且要决定这批工具是并行执行还是依次执行（第 4 章）。

**思考内容：要原样还回去。** 支持推理的模型会在回复里带上思考内容。Anthropic 返回 `thinking` 块和一段 `signature`；OpenAI 的推理模型返回加密的推理内容。它们的共同要求是：**下一次请求时原样带回**，尤其是在工具调用的中间。服务端靠签名确认这段推理确实是它自己生成的，并据此延续推理过程。Pi 把它们统一成一种内容块：

@pi packages/ai/src/types.ts#L428-L436

这也是适配器不能随意“清洗”历史的原因之一：删掉或改写一个思考块，下一次请求就可能被拒绝。

**服务端状态：能用，但 Pi 不用。** 第 1 章说模型 API 是无状态的。严格地说，有的 API 提供了服务端保存对话的选项，例如 OpenAI 的 Responses API 可以把回复存在服务端，下一次只传一个 id。Pi 的 Responses 适配器刻意关掉了它（`store: false`），并要求服务端把加密的推理内容随回复返回，由 Pi 自己在下一次请求时带回：

@pi packages/ai/src/api/openai-responses.ts#L363-L371

原因很实际：历史掌握在自己手里，才能压缩（第 8 章）、分叉和回退（第 7 章）、在不同服务商之间切换模型，以及在本地完整地记录会话。这几乎是所有 coding agent 的共同选择。

## 接上真实模型

现在 mox 有了两个流式适配器，可以同时支持 Anthropic 和任何 OpenAI 兼容的服务：

```ts
import { anthropic } from './mox/src/providers/anthropic.ts';
import { openai } from './mox/src/providers/openai.ts';

const claude = anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, model: 'claude-sonnet-4-5' });
const deepseek = openai({ apiKey: process.env.DEEPSEEK_API_KEY!, model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });

const reply = await claude.stream(context, { onEvent: e => e.type === 'text_delta' && process.stdout.write(e.delta) });
```

第 3 章会把它们接进一个真正健壮的循环。

## 面试题

先自己回答，再展开对照要点。

::: interview 如何设计一个支持多家模型的 Agent？
核心是**内部统一格式 + 每家一个适配器**（防腐层）：

- 内部格式定义消息、内容块（文字、工具调用、思考）、工具结果、停止原因、用量。循环和上层只认内部格式。
- 适配器负责双向翻译：请求方向处理系统提示位置、工具说明格式、工具结果的表示与合并；响应方向把流式事件组装成内部消息，并归一化停止原因。
- 约定适配器不抛异常，失败编码在消息里，保留部分内容。

加分点：提到“兼容格式不等于完全兼容”，需要按服务商做兼容性配置；思考块签名需要原样回传；用模型目录记录上下文窗口等元数据，供压缩和截断使用。
:::

::: interview 流式响应中的工具调用参数怎么处理？为什么不能提前执行？
参数以 JSON 文本片段的形式逐段到达（Anthropic 的 `input_json_delta`、OpenAI 的 `tool_calls[i].function.arguments`）。适配器先把片段拼接起来，可以用容错解析生成预览供界面显示，但**只有在参数块明确结束后**（Anthropic 的 `content_block_stop`，OpenAI 的流结束）才做最终解析。

不能提前执行，是因为不完整的参数在语法上可能完全合法（`"src/cl"` 是一个合法字符串），执行后果不可预测。同理，回复因为长度上限被截断时，参数也不可信。
:::

::: interview Stop reason 有哪些？遇到 length 或未知值时应该怎么办？
归一化后通常是：正常结束、请求工具、长度截断、错误、取消。

- **length**：文字可以保留展示，但其中的工具调用一个都不能执行，应该生成错误结果告诉模型“参数可能不完整，请重新发起”。
- **未知值**：按失败处理（fail closed），并保留原始值便于排查。把未知值当作正常结束，可能在新语义出现时悄悄执行错误的操作。
- **流在给出停止原因之前就断开**：同样是失败，不能当成正常结束。用一个“未决”初始值来区分。
:::

::: interview tool_call_id 有什么用？
它把模型的工具请求和程序返回的结果一一对应起来。一条回复里可以有多个工具调用，结果的顺序、执行是否并行都可能变化，只有靠 id 才能可靠关联。

服务商通常会校验：每个工具请求都必须有对应的结果，id 必须匹配，否则请求会被拒绝。这也是为什么压缩上下文时不能把一个工具请求和它的结果拆开（第 8 章）。
:::

::: interview 怎样测试一个依赖大模型的 Agent？
分层测试：

- **脚本模型**（mock / faux provider）：实现与真实模型相同的接口，回复由脚本控制。用来测试循环、工具、错误处理在各种模型行为下是否正确，确定且免费。
- **录制的线上数据**：用真实服务商的响应字节测试适配器的解析，包括故意切碎、中途断开等网络异常。
- **评测**：用真实模型在固定任务集上运行，衡量结果质量，这是另一类问题，需要统计和对照（第 20 章）。

关键认识：单元测试测的是“程序对模型行为的反应”，不是“模型好不好”。
:::
