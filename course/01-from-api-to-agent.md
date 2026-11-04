---
motto: 模型只会返回文字。让它“做事”的，是你写的那个循环。
learn:
  - 为什么只靠聊天接口，模型读不到你的文件
  - 工具调用的完整往返：模型提出请求，程序执行，结果放回历史
  - 为什么每次请求都要重发全部历史，这对成本意味着什么
  - 同样的三件事在 Pi 里分别由哪一层负责
prereq: 第 0 章；会用 fetch 发 HTTP 请求
time: 40 分钟
build: mox/stage-01/agent.ts —— 一个能看目录、读文件并回答问题的 Agent
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

## 第一个 Agent

下面是 mox 的第一版。一个文件，没有任何依赖。它有两个只读工具：列目录和读文件。

先看工具说明。这是写给模型看的“说明书”，格式是 OpenAI Chat Completions 的 `tools` 字段：

@code mox/stage-01/agent.ts#tools

`description` 很重要。模型选工具、填参数，全靠这几句话。第 5 章会看到 Pi 为每个工具写了多长的说明，以及为什么。

再看循环本身：

@code mox/stage-01/agent.ts#runAgent hl=67-68,70,73

整个 Agent 的核心就是这十几行，四个编号对应四件事：

1. **把完整的历史发给模型。** 第一次请求只有 system 和 user 两条消息。
2. **模型的回复进入历史。** 不管它是文字还是工具请求，都要追加进去，否则下一次请求时模型会“忘记”自己说过什么。
3. **如果回复里有工具请求，由我们来执行。** `handlers[call.function.name]` 就是普通的 TypeScript 函数。
4. **执行结果放回历史。** 用 `role: 'tool'` 加上 `tool_call_id`，让模型知道这条结果对应它的哪一个请求。

循环结束的条件只有一个：**模型的回复里没有工具请求了。** 模型觉得信息足够、直接给出回答，循环就结束。

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
<rect x="374" y="210" width="190" height="44" rx="9" fill="var(--bg)" stroke="var(--accent)"/><text x="469" y="230" fill="var(--ink)">③ 程序执行工具</text><text x="469" y="246" font-size="11" fill="var(--faint)">read_file("README.md")</text>
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


`MAX_TURNS` 是一个保护钱包的安全阀。第 3 章会解释为什么“最多跑几轮”不应该写死在循环里。

## 跑起来

没有设置 `MOX_API_KEY` 时，程序使用一个**脚本模型**：它返回的 JSON 和真实 API 的格式完全相同，只是决策规则是写死的（先列目录，看到 README 就读，读完就回答）。循环代码分辨不出它面对的是脚本还是真模型，这正是我们想要的。

@lab cd labs/fixtures/mox-project && node ../../../mox/stage-01/agent.ts 这个项目是做什么的？

用户只问了一句话，程序却向模型发了三次请求。下面的回放把这次运行拆成一步一步，左边点选步骤，右边看每一刻的完整消息列表。请求步骤可以展开“真实发送的请求体”。

@trace node labs/ch01/trace.ts

::: predict
第三次请求一共发送了几条消息？其中有几条是模型自己之前说的话？
???
6 条：system、user、模型的第一次回复（请求 list_dir）、list_dir 的结果、模型的第二次回复（请求 read_file）、read_file 的结果。其中 2 条是模型自己说过的话。模型没有记忆，它“记得”自己刚才请求过什么，完全是因为我们把它的回复也放进了历史。
:::

## 三个关键事实

### 模型从不执行任何东西

模型的回复只是一段 JSON：`{"name": "read_file", "arguments": "{\"path\": \"README.md\"}"}`。执不执行、怎么执行、在哪个目录执行，全部由你的程序决定。

这句话有两层含义。好的一面：**程序拥有最终控制权**，可以在执行前检查参数、拒绝危险操作、要求用户确认（第 14 章的权限系统就建立在这一点上）。需要警惕的一面：**程序也承担全部后果**。模型被一段恶意的 README 诱导，请求执行 `rm -rf ~`，真正执行这条命令的是你的程序，用的是你的账户权限。

### API 不保存任何状态

第二次请求发送了 4 条消息，第三次发送了 6 条。每一次都是**从头发送全部历史**，因为模型 API 是无状态的：服务端不记得你上一次发过什么。

这直接决定了 Agent 的成本结构。假设每轮新增的内容大约等长，第 *n* 次请求要处理的输入大约是第 1 次的 *n* 倍，一次运行的总输入量随轮数**平方级**增长。一个修了 30 轮的 bug，最后几次请求每次都要把前面所有的文件内容和命令输出再读一遍。

这也是为什么生产级 Agent 都在意两件事：

- **提示缓存**（prompt caching）：如果请求的前缀和上一次完全相同，服务商可以复用已经算过的结果，按更低的价格计费。这要求历史**只追加、不修改**，第 6 章会看到 Pi 为此做的设计。
- **上下文压缩**（compaction）：历史太长时，把早期内容换成摘要。第 8 章细讲。

### 循环由“有没有工具请求”驱动

我们的循环只看一件事：这次回复里有没有工具请求。这个判断简单到几乎不像设计，但它意味着**任务什么时候结束，完全由模型决定**。模型想继续查，循环就继续转；模型觉得够了，循环就停。

这既是 Agent 灵活的来源，也是它不可预测的来源。第 3 章会给这个循环加上宿主的停止权、输出截断的处理和运行中插话，让它变得可控。

::: note 这个循环有个名字：ReAct
2022 年的论文 *ReAct: Synergizing Reasoning and Acting in Language Models*（Yao 等）提出让模型交替进行“推理”和“行动”：先想一步（Thought），再调用一个工具（Action），看到结果（Observation）后接着想。早期的实现要求模型按固定文本格式输出 `Thought: … Action: …`，再由程序用正则解析。

今天的工具调用把这件事做成了 API 的一部分：Action 变成结构化的 `tool_calls`，Observation 变成 `role: tool` 消息，推理则放进模型的思考内容里（第 2 章）。面试里被问到 ReAct，可以直接说：我们写的这个循环就是它的现代形态。
:::

## 接上真实模型

mox 第一版使用 OpenAI Chat Completions 格式，几乎所有服务商都兼容这个格式。设置三个环境变量即可（模型需要支持工具调用）：

```bash
# DeepSeek（地址和模型名以服务商文档为准）
export MOX_BASE_URL=https://api.deepseek.com/v1
export MOX_API_KEY=sk-...
export MOX_MODEL=deepseek-chat

# 或者本地的 Ollama，不需要真实的 Key
export MOX_BASE_URL=http://localhost:11434/v1
export MOX_API_KEY=ollama
export MOX_MODEL=qwen2.5-coder
```

然后在任何项目目录里运行：

```bash
node path/to/mox/stage-01/agent.ts "入口文件在哪里？它做了什么？"
```

真实模型的路径会比脚本模型灵活得多：它可能先列目录，再读两三个文件，甚至读完发现不对再回头。观察 stderr 里每次请求的消息数，你会直观地感受到历史是怎样增长的。

::: warn 第一版很脆弱
试着问一个会让模型读不存在文件的问题，比如“读一下 CHANGELOG.md”。`readFileSync` 抛出异常，整个程序崩溃，前面所有的对话都丢了。模型本来完全有能力处理“文件不存在”——换个文件读，或者告诉你没有。第 3 章会修好它。
:::

## Pi 里的同一件事

mox 第一版把三件事写在一个文件里：工具、调用模型、循环。Pi 把它们放进了三个不同的层。

**工具**在产品层定义。下面是 Pi 的 `read` 工具的参数格式，和 mox 的 `read_file` 几乎一样，只是多了 `offset` 和 `limit`，用来分段读大文件：

@pi packages/coding-agent/src/core/tools/read.ts#L13-L17

它的说明文字比 mox 长得多，明确告诉模型输出会被截断、遇到大文件该怎么分段读：

@pi packages/coding-agent/src/core/tools/read.ts#L85-L98

**调用模型**在模型层（`packages/ai`），**循环**在循环层（`packages/agent`）。我们把同一个任务交给 Pi：用它真实的 `runAgentLoop` 和自带的 `ls`、`read` 工具，模型换成 Pi 自己的脚本模型（faux provider），决策规则与 mox 的脚本模型相同。

@lab node labs/ch01/pi-read.ts

形状和 mox 完全一样：三次请求，消息数从 2 条增长到 6 条，执行两次工具。唯一的区别是开头那条 `system`：Pi 把“当前有哪些工具”也记录成了历史里的一条系统消息，第 6 章会解释这个设计。

两者的差距不在主路径上，而在主路径之外：

| | mox 第一版 | Pi |
| --- | --- | --- |
| 消息格式 | 直接使用 OpenAI 的线上格式 | 统一的内部格式，由适配器翻译成各家格式（第 2 章） |
| 输出方式 | 等整条回复生成完 | 流式，边生成边显示（第 2 章） |
| 工具失败 | 程序崩溃 | 变成一条错误结果交回给模型（第 3 章） |
| 停止条件 | 只看有没有工具请求 | 还要考虑截断、宿主决定、运行中的插话（第 3 章） |
| 工具 | 两个玩具工具 | 带截断、校验、并行控制的生产级工具（第 4、5 章） |
| 历史 | 存在内存里，进程退出就没了 | 写进 JSONL 会话文件，可以恢复和分叉（第 7 章） |

接下来的每一章，都是在把左边这一列变成右边这一列。

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
