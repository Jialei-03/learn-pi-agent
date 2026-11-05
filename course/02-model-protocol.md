---
motto: mox 只说一种方言，Pi 会说所有方言，中间差的就是一层翻译。
learn:
  - 读懂 mox/src/model.ts：怎样把 SSE 字节流拼成一条 OpenAI 格式的消息，包括按 index 拼工具调用分片和 finish_reason
  - 同一段带工具调用的对话，在 mox、Pi 的 OpenAI 适配器和 Pi 的 Anthropic 适配器的请求体里分别长什么样
  - 工具参数为什么不能边收边执行；流在半路被截断时怎样发现，mox 和 Pi 的做法有什么共同点
  - 请求失败时“抛异常”（mox）和“返回错误消息”（Pi）各有什么取舍
  - 动手：给 mox 写一个 Anthropic 适配器，循环一行不用改
prereq: 第 1 章
time: 60 分钟
build: 读懂 mox/src/model.ts（45 行，只有一个适配器 openai()）；练习里给它补一个 Anthropic 适配器
---

## mox 只说一种方言

第 1 章的 Agent 能跑，是因为 `model.ts` 替它说了模型服务商的话。现在想一想：要是用户想换成 Anthropic 的模型，要改多少地方？

先看 mox 是怎么表示一条消息的。整个 `model.ts` 的开头七行，就是它的全部“内部格式”：

@code mox/src/model.ts#L2-L7 hl=2-4,7

这就是 OpenAI Chat Completions 的线上格式：assistant 消息带 `tool_calls`，参数 `arguments` 是一段 **JSON 文本**，工具结果是 `role: 'tool'` 加 `tool_call_id`。mox 没有给它再套一层自己的格式，`runLoop` 里写的 `message.tool_calls`、`role: 'tool'`、`call.function.arguments` 都是 OpenAI 的字段名。`Model` 是一个函数：给它消息，还你 `{ message, finish }`。

这个选择有一笔账：

- **省下的**：没有翻译层。消息从模型回来，原样放进历史；下一次请求，历史原样发出去（下面的实验会证明是“逐字相同”）。会话文件（第 7 章）直接把消息一行行写进 JSONL，也不需要转换。整个模型层 43 行。
- **付出的**：mox 只能连说 OpenAI 方言的服务。MiniMax、DeepSeek、OpenRouter、Ollama 都说，Anthropic 的原生接口不说。通过网关（比如 OpenRouter）仍然可以用 Claude，但 Anthropic 原生接口才有的东西——思考块和签名、`cache_control`、`is_error`——mox 够不着。

Pi 的选择相反。它想让同一个循环跑在二十多家服务商上，所以在循环下面放了一层**防腐层**：循环只认 Pi 自己的内部格式，每家服务商配一个适配器，负责双向翻译。

@figure assets/course/ch02-adapters.png Pi 的做法：每家服务商一个适配器，外面的格式各不相同，循环只看到统一的内部消息。mox 只保留了其中一个适配器（OpenAI）

两种内部格式的差别，几乎就是翻译层要处理的全部麻烦：

| | mox（= OpenAI 格式） | Pi 的内部格式 |
| --- | --- | --- |
| 工具参数 | `arguments`：JSON **字符串**，解析留给循环 | `arguments`：**对象**，解析在适配器里做完 |
| 工具结果 | `role: 'tool'`，没有错误标记（`runLoop` 约定以“错误：”开头） | `role: 'toolResult'`，带 `isError` |
| 内容 | 字符串（`content: string \| null`） | 内容块数组：文字、工具调用、思考 |
| 停止原因 | 服务商的原始字符串（`finish`），循环只认 `length`；没收到就报错 | 归一化成 `stop` / `toolUse` / `length` / `error` / `aborted`，原始值另存 |
| 思考内容 | 没有位置放 | `thinking` 块，带签名 |
| 用量与费用 | 不记录 | `usage`，含缓存读写和费用 |

## 同一段对话，三份请求体

构造一段典型的对话：用户提问 → 模型在同一条回复里请求读两个文件 → 两条工具结果（其中一条失败）。把它分别交给三个发送方：mox 的 `openai()`、Pi 的 OpenAI 适配器、Pi 的 Anthropic 适配器。请求都发给本地的假服务，下面打印的是假服务**真正收到的请求体**：

@lab node labs/ch02/wire.ts

第一份最重要：mox 发出的 `messages`，和它自己的消息数组加一条 system **逐字相同**（实验里有一行断言守着）。mox 做的“翻译”是零。

后两份是 Pi 的翻译结果。OpenAI 这一份和 mox 几乎一样，只是工具结果里没有 `error` 字样：Pi 的内部消息里有 `isError`，OpenAI 格式没地方放，只能丢掉。Anthropic 那一份才是真正的翻译，差异整理成表：

| | Anthropic Messages | OpenAI Chat Completions |
| --- | --- | --- |
| 系统提示 | 顶层 `system` 字段 | `messages` 里第一条 `role: "system"` |
| 工具说明 | `tools[].input_schema` | `tools[].function.parameters` |
| 模型的工具请求 | assistant `content` 里的 `tool_use` 块，`input` 是对象 | assistant 的 `tool_calls` 数组，`arguments` 是 **JSON 字符串** |
| 工具结果 | **user** 消息里的 `tool_result` 块；同一批结果放在同一条 user 消息里 | 每个结果一条独立的 `role: "tool"` 消息 |
| 关联方式 | `tool_use_id` | `tool_call_id` |
| 失败的结果 | `is_error: true` | 没有专门字段，只能写进文字 |

四条内部消息，mox 发五条（多一条 system），Pi 发 Anthropic 时是三条：两条工具结果合并成了同一条 user 消息。Anthropic 最容易写错的就是工具结果的位置：`tool_result` 必须**紧跟在**发出对应 `tool_use` 的那条 assistant 消息之后。Pi 的翻译函数注释里还记下了合并的另一个原因，有些第三方的 Anthropic 兼容端点只接受这种形式：

@pi packages/ai/src/api/anthropic-messages.ts#L1497-L1521

::: insight “兼容”从来不是完全兼容
很多服务商声称“兼容 OpenAI 格式”或“兼容 Anthropic 格式”，但细节各有出入：有的不接受 `content: null`，有的要求工具结果必须合并，有的不认识某些字段。Pi 的 `openai-completions.ts` 里有一个函数专门根据服务商名字和地址推断兼容性设置。mox 的 `openai()` 没有这层处理：它发出去的是标准形状，对方不认就会报错。这是“只说一种方言”的代价之一：方言有口音。
:::

## 读 model.ts：一条消息是怎样拼出来的

`openai()` 返回的是 `Model` 函数。这一节逐段读它。第 1 章的 Agent 能等整条回复生成完才拿到结果，但真实的 Agent 都用**流式**响应：模型每生成几个字就发一段过来，界面可以实时显示，用户也可以在看到苗头不对时立刻取消。

@code mox/src/model.ts#openai hl=11-17,23-25,27-30,32-37,38

分成四步：

1. **发请求**（第 11 至 16 行）。请求体里 `messages` 就是传进来的数组，`stream: true` 要求服务端用 SSE 分段回复，`tools` 每项包一层 `{ type: 'function', function: … }`。`signal` 直接交给 `fetch`，取消就靠它。
2. **请求失败直接抛**（第 17 行）。HTTP 状态不是 2xx，把状态码和前 500 个字符的响应正文塞进一个异常。后面“失败的两种写法”一节会专门讲这个选择。
3. **切行**（第 23 至 25 行）。网络包的边界和行的边界毫无关系：一次 `read` 可能只拿到半行，也可能一次拿到好几个事件，甚至把一个中文字符（UTF-8 里占 3 个字节）切成两半。所以每一块先用 `decoder.decode(chunk, { stream: true })` 解码（`stream: true` 让它把被切开的字符前半截留到下一块），拼进 `buffer`，只处理 `\n` 之前的完整行，最后那个可能不完整的片段用 `lines.pop()` 留给下一轮。
4. **处理每一行**（第 27 至 38 行）。只看以 `data:` 开头的行，`[DONE]` 跳过；解析出 `choices[0]`，`delta.content` 是文字，累加进 `text` 并立即通过 `onText` 送出去；`delta.tool_calls` 是工具调用的分片；`finish_reason` 记在 `finish` 里。

第 4 步里最容易写错的是工具调用。**OpenAI 的流里没有“块”的概念**，一个工具调用的各个片段靠 `index` 区分（不是靠 `id`，`id` 和函数名只在第一个片段里出现，后面的片段只带 `arguments` 的一小截）。第 33 到 36 行就是拼接规则：按 `index` 找到（或新建）`calls` 里的那一项，`id` 和 `name` 取第一次出现的，`arguments` 一律追加。同一条回复里有两个工具调用时，它们的片段可以交错到达，`index` 保证各拼各的。

下面的实验用 OpenAI 格式的测试样本做三件事：先把 1945 字节按每 7 字节一刀切开，找出一刀切在汉字中间的那个位置；再逐块列出每个数据块带来什么、累计成什么；最后拿 mox 的 `openai()` 真正返回的消息，和这张表算出来的结果核对：

@lab node labs/ch02/stream.ts | md

::: steps 工具调用的分片是怎样被拼成一个完整调用的
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
--- `finish_reason: tool_calls` 到达，记进 `finish`。接着是一个只带用量、`choices` 为空的块（被第 29 行的 `continue` 跳过）和 `[DONE]`（第 27 行跳过）。流结束。
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
--- `for await` 结束，第 43 行把 `text`、`calls`、`finish` 装成 `{ message, finish }` 返回。**从这一刻起，`runLoop` 才第一次看到这些工具调用**，参数是完整的。
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

### 真实的流和样本有什么不同

测试样本是教科书式的：参数分三片到达。真实模型的流更乱一些。下面是 MiniMax-M3.1-Flash 的一次真实回复（`labs/ch02/record-stream.ts` 用 mox 的 `openai()` 发出请求，只在 `fetch` 外面包一层，把响应体的字节原样抄下来；响应体里没有 Key）：

@lab node labs/ch02/inspect-recorded.ts | md

三处和样本不同，每一处 mox 都处理得了，但值得知道：

- **思考内容走另一个字段。** 23 个块的 `delta` 里是 `reasoning_content`，不是 `content`。mox 的第 30 行只看 `content`，所以这 441 个字符被直接丢掉了：不显示，也不进历史。
- **工具调用不一定分片。** 这次两个调用各占一整块，`arguments` 一次给全。拼接规则对这种情况也成立（追加到空串上），因为 `index` 在第 33 行把它们分到了 `calls[0]` 和 `calls[1]`。
- **没有用量块。** 请求里没有要求 `stream_options.include_usage`，所以 mox 不知道这次花了多少 token。

把这段真实字节流交给 mox 和 Pi 的 OpenAI 适配器，再把测试样本的 OpenAI 版本和 Anthropic 版本也交给 Pi，看四个结果：

@lab node labs/ch02/replay.ts | md

两份样本里，mox 和 Pi 对文字、工具名、参数甚至真实的 `call_…` id 都读出了完全相同的结果；Anthropic 格式的样本只有 Pi 读得了，读出来的内容和 OpenAI 版本一致。差别在最右一列：Pi 多保存了 441 字符的思考内容，把原始的 `tool_calls` 归一化成了 `toolUse`。

### Anthropic 的流只在 Pi 一侧

mox 没有 Anthropic 适配器，但值得看一眼它的流长什么样，因为练习里要你写一个。Anthropic 的流是分块（content block）组织的。一条回复由若干个块组成（文字块、工具调用块、思考块），每个块都有“开始 → 若干增量 → 结束”三个阶段，最后由 `message_delta` 给出停止原因和输出 token 数：

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

对比 OpenAI 的流：Anthropic 有明确的“这个块结束了”事件，OpenAI 没有，只能等流结束；Anthropic 的停止原因在最后的 `message_delta` 里，OpenAI 的在带 `finish_reason` 的块里，并且之后可能还有一个只带用量的块和 `[DONE]`。Pi 的 Anthropic 适配器按服务端给的 `index` 记录“正在生成的块”，收到增量就拼接，收到 `content_block_stop` 再对完整的参数做最终解析。

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

## 工具参数为什么不能边收边执行

注意上面实验里“参数能解析成 JSON？”那一列：`{"pa` 和 `{"path": "src/` 都不能。为了让界面能提前显示“正在读 src/……”，Pi 有一个增量 JSON 解析器，每收到一段就更新一次参数快照，界面可以实时显示模型正在写的文件内容。

但预览**只能用于显示**。

::: predict
假设 Agent 在收到 `{"path": "src/cl` 时就急着执行 `read`，会发生什么？
???
它会去读 `src/cl`。如果解析器宽松到能把残缺的 JSON 补成 `{"path": "src/cl"}`，这就是一个完全合法的参数，类型检查拦不住它。运气好的话文件不存在，返回一个错误；运气不好的话，恰好有一个叫 `src/cl` 的文件或目录，Agent 会带着错误的信息继续工作，而且没有任何报错。

同样的道理也适用于第 3 章的“输出截断”：被截断的参数在语法上可能是完整的，在语义上却是错的。**只有在参数明确结束之后，才能执行工具。**
:::

mox 在这一点上是靠**结构**保证的，而不是靠小心：`Model` 函数只有整条回复结束才返回，`runLoop` 没有机会看到半截的调用；参数始终是字符串，直到 `execute` 里第 52 行 `JSON.parse` 才变成对象，残缺的 JSON 在这里直接抛异常（下面会看到它被变成一条错误结果）。代价是 mox 的界面看不到“模型正在写什么文件”的预览，只能看到正文文字。

## 停止原因：mox 只认一个词

每条回复结束时，服务商都会告诉你它为什么停下。各家用词不同，Pi 的适配器把它们翻译成统一的几个词，mox 则原样保留，只在一个地方用到：

| Pi 归一化 | Anthropic | OpenAI | mox 的做法 |
| --- | --- | --- | --- |
| `stop` | `end_turn`、`stop_sequence`、`pause_turn` | `stop` | 回复里没有工具调用就结束 |
| `toolUse` | `tool_use` | `tool_calls` | **不看 `finish`**：`runLoop` 只看 `message.tool_calls` 有没有 |
| `length` | `max_tokens` | `length` | 唯一被识别的值：工具调用一个都不执行（第 3 章） |
| `error` | `refusal`、未知值 | `content_filter`、未知值 | 不识别，和 `stop` 同样处理 |
| `aborted` | （本地取消） | （本地取消） | 没有这个值；取消表现为异常 |

最后两行是 mox 和 Pi 最大的差别。**服务商哪天新增了一个停止原因，你的代码应该怎么办？** 把未知值当成 `stop` 是最省事的写法，也是最危险的：如果新原因的含义其实是“被截断了”，你的 Agent 就会在不知不觉中执行半截参数。Pi 的两个适配器给出了两种不同的“不猜”。Anthropic 适配器遇到未知值直接抛出异常：

@pi packages/ai/src/api/anthropic-messages.ts#mapStopReason

OpenAI 兼容适配器面对的服务商五花八门，它选择把未知值映射为错误，同时把原始值写进错误信息：

@pi packages/ai/src/api/openai-completions.ts#mapStopReason

两种做法的共同点是 **fail closed**：不确定的时候走失败路径，而不是走成功路径。这是 Agent 工程里反复出现的原则，第 14 章的权限系统还会再遇到它。

mox 的 `openai()` 对**未知的** `finish_reason` 是宽容的：原样放进 `finish`，`runLoop` 不认识就当没有。但对“**根本没有收到** `finish_reason`”，它和 Pi 一样 fail closed，下一节讲这个。

## 流被掐断时

网络不可靠。连接可能在任何时候断开：模型刚说了半句话，或者工具参数刚生成到一半。

“断开”有两种。一种是连接被重置，`fetch` 的响应体会抛出异常，`for await` 把它冒泡出去，调用方一定知道出事了。另一种更隐蔽：服务端提前收尾，或者中间的代理把流截断后**正常关闭**。对读流的代码来说这只是流结束了，没有异常。这时手里有一条“看起来还挺完整”的消息：一段文字，加上一个参数残缺的工具调用。如果代码把“流结束了”当成“回复结束了”，用户只会看到一句没头没尾的话，**没有任何报错**。

怎样区分“正常结束”和“被截断”？服务商在回复的最后会明确发一个停止原因（OpenAI 的 `finish_reason`，Anthropic 的 `stop_reason`）。流结束了却没收到它，就说明回复没有走完。mox 为此只写了两处：

@code mox/src/model.ts#L19-L19

@code mox/src/model.ts#L41-L42

`finish` 的初始值是**空串**，不是 `'stop'`；收到 `finish_reason` 才改写；`for await` 结束后如果还是空串，直接抛错。关键是初始值：如果它是 `'stop'`，“什么都没收到”和“正常停止”就无法区分，检查也就无从写起。

实验用假服务发送到一半就正常结束连接，在三个位置截断同一段 OpenAI 格式的流，最后一行是没有断开的对照：

@lab node labs/ch02/cut.ts | md

三种截断，mox 和 Pi 的结论一致：

- **文字说到一半。** `openai()` 抛出“模型的响应在完成之前就断开了”，`runLoop` 不捕获，异常冒出，历史里仍然只有那条 user 消息。Pi 返回 `stopReason=error`，错误信息是 `Stream ended without finish_reason`，已收到的半句话原样保留在消息里。
- **参数 `{"pa` 之后。** 同样的结果，半截参数没有机会被执行。
- **参数已经完整，只差 `finish_reason`。** 参数其实能解析，但 mox 也不执行它：它无法区分“只差最后一块”和“被截断在任意位置”。这是 fail closed 的代价：偶尔放弃一个其实完整的回复，换来永远不会把残缺的回复当成正常结束。

两边的**报告方式**不同：mox 抛异常，Pi 返回 `error` 消息（下一节）。Pi 的做法有两道保险：每条回复的停止原因初始值是 `pending`（一个不属于任何正常结果的值），只有收到服务商明确的停止原因才会被改写；流结束时检查这个值：

@pi packages/ai/src/api/anthropic-messages.ts#L890-L922

::: insight “没有收到结束信号”不等于“结束了”
初始值用 `pending`（Pi）或空串（mox）而不是 `stop`，是一个很小但很关键的设计：它让“什么都没发生”和“正常结束”可以区分。很多 Agent 的偶发性“回答到一半就停了”问题，根源就在这里。

如果 mox 的 `finish` 初始值是 `'stop'`，文字说到一半被截断时，`runLoop` 会把半句话当作最终回答；参数残缺时，只能靠 `runLoop` 里的 `JSON.parse` 碰巧拦住，而参数恰好完整时工具照常执行。一条本该报错的失败，会伪装成一次成功。
:::

## 失败的两种写法：抛异常，还是返回错误

上一节出现了两种“出事了”的报告方式。`openai()` 遇到明确的失败，**抛异常**：

- HTTP 状态不是 2xx：`模型请求失败（429）：…`（第 17 行）；
- 取消：`fetch` 抛出 `AbortError`；
- 连接重置：响应体抛出异常；
- 流结束了却没收到 `finish_reason`：`模型的响应在完成之前就断开了`（上一节）。

`runLoop` 不捕获这些异常，它们一路冒出来，由调用方处理。mox 的调用方是 `cli.ts`，它只有一个 `catch`：

@code mox/src/cli.ts#L135-L137

Pi 的适配器遵守一个相反的约定：**适配器永远不抛异常**。失败也是一条正常的 `AssistantMessage`，只是 `stopReason` 是 `error` 或 `aborted`，`errorMessage` 里写着原因。同样三种失败，在两边的样子：

@lab node labs/ch02/errors.ts | md

读这张表的重点是后三列：失败之后，**历史里留下了什么**。

- mox 的 `messages` 里还是只有那条 user 消息：失败的回复根本没有进历史，因为异常发生在 `options.model(...)` 返回之前，`push(message)` 还没执行。好处是历史永远是合法的，下一次请求可以直接重发；`cli.ts` 里每条消息是在 `onEvent` 里保存的，所以会话文件里也不会有半截回复。
- 代价是**已经流出的文字就丢了**。取消那一行，屏幕上已经显示了“我先看看”，但历史里没有它，会话文件里也没有。
- Pi 把失败的回复也当作一条消息，半句话保留在里面，可以展示、可以写进会话用于排查。代价是历史里多了一种“不能原样发回 API 的消息”，每个读历史的地方都得知道它。

Pi 把这个约定写进了流式事件的类型定义：成功的流以 `done` 结束，失败的流以 `error` 结束，而 `error` 事件携带的仍然是一条完整的 `AssistantMessage`。

@pi packages/ai/src/types.ts#L807-L840

| | mox：抛异常 | Pi：返回错误消息 |
| --- | --- | --- |
| 调用方要写什么 | `try/catch`；忘了就整个运行崩掉 | 看 `stopReason` 分支，只有一种返回值 |
| 部分内容 | 流出过但没记录 | 保留在消息里 |
| 历史 | 失败的回复不进历史，永远合法 | 失败的回复进历史，读历史的代码要认识它 |
| 重试 | 没有；`cli.ts` 打印错误，用户再输一次 | 内置，区分可重试和不可重试的错误 |
| 代码量 | 一行 `throw` | 每个适配器都要把各种失败翻译成消息 |

两种做法没有对错。mox 的场景是“一个人在终端里用”，失败了就让用户知道、再试一次；Pi 要服务 RPC、SDK、长时间无人值守的运行（第 18、19 章），失败必须成为可以记录、可以重试、可以恢复的状态。注意 mox 的做法有个现成的补救点：`Model` 只是一个函数，要加重试，包一层就行，`runLoop` 不用动（见“你来改”）。

## Pi 的模型层还做了什么

主路径上，mox 四十多行的 `openai()` 和 Pi 一千多行的适配器做的是同一件事。Pi 多出来的代码在处理这些问题，右列是 mox 在同一个位置的做法：

| Pi 多做的事 | 为什么需要 | mox |
| --- | --- | --- |
| **思考块与签名**（`thinking`、`thinkingSignature`） | 支持推理的模型会返回思考内容和一段加密签名，下一次请求必须原样带回，否则服务端拒绝或丢失推理连续性 | 丢掉 `reasoning_content`，不回传 |
| **提示缓存标记**（`cache_control`） | 在历史末尾打上缓存标记，让下一次请求复用前缀，显著降低成本（第 6 章） | 不打标记；缓存与否由服务端决定 |
| **用量与费用**（`usage.cost`） | 根据模型目录里的单价计算每次请求的花费，界面可以实时显示 | 不请求用量块，不记录 |
| **模型目录**（`models.generated.ts`） | 每个模型的上下文窗口、最大输出、是否支持图片和推理，压缩和截断都依赖这些数字 | 窗口大小靠环境变量 `MOX_CONTEXT_WINDOW`，默认 128000 |
| **重试与超时**（`utils/provider-retry.ts`） | 区分可重试的错误（限流、过载）和不可重试的错误（参数错误） | 没有 |
| **JSON 修复**（`parseJsonWithRepair`） | 有的服务商偶尔会发出不严格的 JSON | 没有；解析失败变成错误结果交给模型 |
| **兼容性推断** | 根据服务商名字和地址决定字段格式，处理“兼容但不完全兼容” | 没有 |

Pi 的 `AssistantMessage` 比 mox 的多出来的字段，基本就是这张表的缩影：

@pi packages/ai/src/types.ts#AssistantMessage collapse=true

### 测试：脚本模型

课程的默认离线实验不需要 API Key。这依赖一个关键的测试手段：**脚本模型**。`Model` 是一个函数，所以脚本模型也只是一个函数：它提供与真实模型相同的调用接口，包括通过 `onText` 一段段流出文字，但回复由测试脚本决定。

@code labs/shared/scripted.ts#scripted collapse=true

Pi 的测试大量使用同样的手段，它叫 faux provider（`packages/ai/src/providers/faux.ts`）。第 1 章和第 3 章的对照实验，就是用 Pi 的 faux provider 驱动 Pi 真实的循环。

测试 Agent 时有三种互补的手段：

- **脚本模型**：测试循环和工具在各种模型行为下是否正确（截断、出错、调用不存在的工具）。确定、快速、免费。
- **协议样本和真实录制**：例如 `labs/ch02/fixtures` 里预先准备的 SSE 数据（测试样本，没有线上来源），和 `labs/ch02/recorded` 里 MiniMax 的真实字节流，用来检查切包和解析。
- **真实 API 观察**：在明确授权和配置凭据后调用服务商，记录可公开的响应字段。

它们测试的都是“程序对模型行为的反应”，而不是“模型本身好不好”。后者是评测（第 20 章）要回答的问题。

## 请求里还有几个关键开关

上面的请求体只用到了最基本的字段。真实的 Agent 还会碰到下面几个，它们都会影响循环的行为。

**`tool_choice`：模型必须调用工具吗？** 常见取值是 `auto`（模型自己决定）、`none`（禁止调用工具）、`required` / `any`（必须调用某个工具），或者指定某一个工具。Agent 主循环几乎总是用 `auto`——强制调用会让模型无法给出最终回答。mox 的请求体里根本没有这个字段（第 15 行），等于永远是 `auto`；Pi 的统一类型只暴露了两个值：

@pi packages/ai/src/types.ts#L135

强制调用更常见于“用工具来拿结构化输出”的场景：只给模型一个工具，要求它必须调用，工具的参数就是你想要的 JSON。

**并行工具调用：一条回复里可以有多个工具请求。** 前面的实验里，模型在同一条回复中请求读两个文件，真实的 MiniMax 回复也是这样。OpenAI 用 `parallel_tool_calls` 控制是否允许这样做，Anthropic 在 `tool_choice` 里用 `disable_parallel_tool_use` 关掉它。mox 不发这个参数，模型愿意并行请求就并行请求；`runLoop` 则一律**顺序**执行，每个请求都有对应的结果。允许并行能省下请求次数，但循环必须正确处理“一批”结果：每个请求都要有对应的结果，并且要决定这批工具是并行执行还是依次执行（第 4 章）。

**思考内容：要原样还回去。** 支持推理的模型会在回复里带上思考内容。Anthropic 返回 `thinking` 块和一段 `signature`；OpenAI 的推理模型返回加密的推理内容；MiniMax 这次的流里是 `reasoning_content` 字段。它们的共同要求是：**下一次请求时原样带回**，尤其是在工具调用的中间。服务端靠签名确认这段推理确实是它自己生成的，并据此延续推理过程。Pi 把它们统一成一种内容块：

@pi packages/ai/src/types.ts#L428-L436

回头看前面的 `replay.ts` 输出：Pi 把那 441 个字符存成了 `thinking` 块，`thinkingSignature` 记着它来自哪个字段，下一次请求会按同样的字段名带回去；mox 把它们丢了。第 1 章那次真实运行照样三轮就答完了，所以对短任务来说丢掉思考内容未必出事，但这是 mox 为简单付出的又一笔代价：换成对此严格的服务端，多轮工具调用可能被拒绝或变笨。这也是适配器不能随意“清洗”历史的原因之一：删掉或改写一个思考块，下一次请求就可能被拒绝。

**服务端状态：能用，但 Pi 不用。** 第 1 章说模型 API 是无状态的。严格地说，有的 API 提供了服务端保存对话的选项，例如 OpenAI 的 Responses API 可以把回复存在服务端，下一次只传一个 id。Pi 的 Responses 适配器刻意关掉了它（`store: false`），并要求服务端把加密的推理内容随回复返回，由 Pi 自己在下一次请求时带回：

@pi packages/ai/src/api/openai-responses.ts#L363-L371

原因很实际：历史掌握在自己手里，才能压缩（第 8 章）、分叉和回退（第 7 章）、在不同服务商之间切换模型，以及在本地完整地记录会话。mox 同样把历史握在自己手里：每次请求都发完整的 `messages`，这几乎是所有 coding agent 的共同选择。

## 接上真实模型

mox 的 `openai()` 在命令行里通过三个环境变量使用，第 1 章已经跑过：

```bash
export MOX_BASE_URL=https://api.minimaxi.com/v1
export MOX_API_KEY=你的 Key
export MOX_MODEL=MiniMax-M3.1-Flash
node mox/src/cli.ts -p "src/cli.ts 是做什么的？"     # 或者 npm link 之后直接 mox -p "…"
```

换成别的服务商只需要改这三个值，因为大家说的是同一种方言。

### 一次真实 MiniMax M3.1 Flash 工具调用

下面的记录是在 2026-11-05 使用 MiniMax 的 OpenAI 兼容接口**实际请求两次**得到的（用单独的 Python 脚本，不经过 mox），模型响应返回的名称为 `MiniMax-M3.1-Flash`。提问和 README 均为本实验临时创建的公开示例；没有发送你的项目文件。页面展示来自仓库中的脱敏记录，不会在构建时发起联网或消耗额度。

@lab node labs/ch02/show-minimax-record.mjs --markdown | md

沿着这份真实记录读：第一轮 SSE 的 `tool_calls` 先收到 `id` 和函数名，再收到 `arguments`。脚本组装后验证工具名和路径，在临时目录读取 `README.md`；随后把**原样的 id**放进 `tool_call_id`，附上真实文件内容，发起第二轮请求。最后一段是第二轮实际返回的回答。这一轮发出的 `messages` 和 mox 第二次请求的形状完全一样：assistant 的 `tool_calls` 加一条 `role: 'tool'`。

这份记录省略了模型的推理原文，也不包含 API Key。这一次第一轮没有返回非空 `reasoning_content`（`reasoning_chars` 为 0），而前面 mox 录制的那次返回了 441 个字符：同一个模型，是否带思考内容随问题而变。根据 [MiniMax 官方 OpenAI SDK 文档](https://platform.minimax.io/docs/api-reference/text-openai-api)，如果工具调用前返回了该字段，多轮请求需要保留完整的 assistant 消息，包括 `tool_calls` 和 `reasoning_content`。mox 的 `openai()` 不保存这个字段，所以对会返回思考内容的任务，它没有按文档的要求传回。

要自己重新运行这个 Python 实验，需要 Python 3、可用的 MiniMax API Key 和模型权限；它会产生真实用量。先在当前终端设置 `MINIMAX_API_KEY`，然后运行：

```bash
python3 labs/ch02/minimax-live.py

# 中国区密钥可按账户平台设置对应端点
MINIMAX_BASE_URL=https://api.minimaxi.com/v1 python3 labs/ch02/minimax-live.py
```

国际区默认使用 `https://api.minimax.io/v1`。可选 `--record 路径.json` 保存脱敏观察；脚本不读取个人项目，不打印密钥，也不保存推理原文。想重新录制 mox 的那份字节流，设好 `MOX_*` 三个变量后运行 `node labs/ch02/record-stream.ts`。API、权限、模型版本和输出会变化；一次成功不能替代其他环境的验证。第 3 章继续讨论完整循环与失败处理。

## 练习：给 mox 写一个 Anthropic 适配器

mox 刻意没有 Anthropic 适配器，补上它正好把本章的东西串起来。`Model` 是个函数，所以适配器就是另一个返回 `Model` 的函数；`runLoop` 认的是 `{ message, finish }` 的形状，不关心背后是谁。你要做三件事：

1. **请求方向。** `system` 消息提到顶层 `system` 字段；assistant 的 `tool_calls` 变成 `tool_use` 块，`arguments` 从 JSON 文本解析成对象 `input`；一批连续的 `role: 'tool'` 消息合并成同一条 user 消息里的 `tool_result` 块，`is_error` 怎么填？mox 的工具消息没有错误标记，只能依赖 `runLoop` 的约定（失败结果以“错误：”开头）。
2. **响应方向。** 事件靠 `data:` 里的 `type` 区分。`content_block_start` 遇到 `tool_use` 建一个调用，用块的 `index` 记下来；`input_json_delta` 追加到对应调用的 `arguments`（保持字符串，不要提前解析）；`text_delta` 追加文字并调用 `onText`。
3. **停止原因。** `end_turn` → `stop`，`tool_use` → `tool_calls`，`max_tokens` → `length`。其余一律抛异常，没收到 `stop_reason` 也抛异常——在这里做 fail closed，本章前面看到的那个坑就不会出现。

先自己写，再对照参考答案。请求方向的翻译只要三十行：

@code labs/ch02/adapter.ts#toAnthropic

响应方向的主体是把 OpenAI 版本里的“按 `index` 拼分片”换成“按块 `index` 拼分片”，其余的缓冲、切行、取消都和 `openai()` 一样：

@code labs/ch02/adapter.ts#L51-L80 hl=53,62-65,67-68,70,76-78

参考答案对照三项检查：读 Anthropic 样本的结果与 `openai()` 读 OpenAI 样本一致；同一段对话翻译出的请求体与 Pi 发出的结构一致；流断开时报错而不是当成正常结束；最后放进 `runLoop`，循环一行没改。

@lab node labs/ch02/adapter-demo.ts

## 你来改

每道题先写下预测，再动手验证。改 `mox/` 里的文件之前先看一眼 `git -C mox status`，做完用 `git -C mox checkout .` 还原。

::: predict 把 finish 的初始值改回 'stop'
把 `mox/src/model.ts` 第 19 行 `finish = ''` 改回 `finish = 'stop'`（第 42 行的检查就永远不会触发）。重新运行 `node labs/ch02/cut.ts`，mox 那两列会变成什么？
???
三种截断都不再抛异常。文字说到一半：`openai()` 返回半句话，`runLoop` 看到没有工具调用，**正常结束**，半句话成了最终回答，没有任何报错。参数 `{"pa` 之后：`runLoop` 的 `JSON.parse` 抛异常，变成一条错误结果交给模型，是碰巧拦住的。参数完整、只差 `finish_reason`：工具照常执行。检查所在的那一行是整个“断流保护”的全部，初始值是它的前提。
:::

::: predict 把思考内容存进消息
`openai()` 的第 30 行只处理 `delta.content`。如果你把 `delta.reasoning_content` 也拼进 `text`，用 `labs/ch02/recorded/minimax-m31-flash-stream.sse` 重跑 `replay.ts`，mox 的“文字”一列会变成什么？
???
会变成 441 个字符的英文思考内容后面接上那句中文，并且被 `onText` 当成正文显示在屏幕上，还会作为 assistant 的 `content` 写进历史，下一次请求被当作模型“说过的话”发回去。这是个糟糕的改法：思考内容是单独的东西，应该有自己的字段（Pi 的 `thinking` 块），显示时用灰色，保存时带上签名，而不是混进正文。
:::

::: predict 给 mox 保存并回传 reasoning_content
更对的做法：让 `AssistantMsg` 多一个可选的 `reasoning_content` 字段，`openai()` 把 `delta.reasoning_content` 拼进去，下一次请求原样带回。MiniMax 的文档要求多轮工具调用时这样做；DeepSeek 的文档则相反，带回会返回 400。这个改动该放在 `openai()` 里无条件做吗？
???
不该。同样叫“OpenAI 兼容”，两家对思考内容的要求相反：MiniMax 要求带回，DeepSeek 带回会被拒绝。无条件保存并回传，会让 mox 在其中一家上出错；不保存（mox 现在的做法），在 MiniMax 上对短任务没出问题，对依赖推理连续性的长任务可能变差。可行的做法是给 `openai()` 加一个选项（比如 `keepReasoning`），按服务商开关，这正是 Pi 里“兼容性推断”要处理的事情：根据服务商名字和地址决定字段怎么发。mox 把这个选择留给了使用者，代价是默认行为不是对所有服务商都最优。
:::

::: predict 给 Model 包一层重试
写一个 `retry(model, times)`，返回的函数在 `model(request)` 抛出异常时重试，最多 `times` 次。这个包装放在哪里？`runLoop` 要不要改？取消（`AbortError`）该不该重试？
???
放在组装 `model` 的地方（`cli.ts` 第 39 行 `openai(...)` 的外面），`runLoop` 一行都不用改，因为它只依赖 `Model` 这个函数类型。取消**不应该**重试：捕获到异常后先检查 `request.signal?.aborted`，是用户取消就原样抛出。还要决定哪些错误值得重试：429 和 5xx 值得，400（请求本身有问题）重试多少次都一样。这正是 Pi 的 `provider-retry.ts` 做的事，只是它还要处理退避和服务端给的等待时间。
:::

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
