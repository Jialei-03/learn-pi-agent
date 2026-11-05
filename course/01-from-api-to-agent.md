---
motto: 模型只会返回文字。让它“做事”的，是你写的那个循环。
learn:
  - 为什么只靠聊天接口，模型读不到你的文件
  - 工具调用的完整往返：模型提出请求，程序执行，结果放回历史
  - Pi 的 runLoop 主路径：请求模型、取出工具调用、执行、把结果放回上下文
  - 为什么每次请求都要重发全部历史，这对成本意味着什么
  - 实战：给 mox 写出最小的循环和 read 工具，让它读文件并回答问题
prereq: 第 0 章；会用 fetch 发 HTTP 请求
time: 40 分钟
build: 实战：给 mox 写出第一个能跑的 Agent —— 最小的 runLoop（mox/src/loop.ts）和 read 工具（mox/src/tools.ts）
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

## Pi 里的第一个 Agent

Pi 把“工具、调用模型、循环”放进三个不同的层（第 0 章的四层结构）。一次“这个项目是做什么的？”会依次经过它们：

- **工具**在产品层（`packages/coding-agent`）定义，比如 `read`、`ls`；
- **调用模型**在模型层（`packages/ai`）：给它一份上下文，还你一条带内容块的助手消息；
- **循环**在循环层（`packages/agent`）：`runLoop` 把上面两样串起来。

### 工具说明：写给模型看的说明书

先看工具。下面是 Pi 的 `read` 工具的参数格式：一个必填的 `path`，两个可选的 `offset` 和 `limit`，用来分段读大文件。

@pi packages/coding-agent/src/core/tools/read.ts#L13-L17

参数格式是 JSON Schema。除了它，每个工具还有名字和一段 `description`。**模型选工具、填参数，全靠这几样东西**，它们会原样出现在每次请求里。Pi 给 `read` 写的说明比想象的长得多，明确告诉模型输出会被截断、遇到大文件该怎么分段读：

@pi packages/coding-agent/src/core/tools/read.ts#L85-L98

### 消息：模型的请求和程序的回答

模型要读文件时，助手消息里会多出一个 `toolCall` 内容块：`id`、`name`、`arguments`（已经解析成对象）。程序执行之后，把结果写成一条 `role: 'toolResult'` 的消息，`toolCallId` 指回那个 `id`：

@pi packages/ai/src/types.ts#ToolCall

@pi packages/ai/src/types.ts#ToolResultMessage

两种消息靠 `id` 配对。一条回复里可以有好几个 `toolCall`，每一个都必须有自己的 `toolResult`，否则下一次请求不合法，模型服务商会直接拒绝。

### 循环的主路径

下面是 `runLoop` 里最核心的一段（完整函数第 3 章细读）。先忽略 `finishTurn`、截断检查这些旁枝，只看高亮的几行：

@pi packages/agent/src/agent-loop.ts#L250-L287 hl=251,252,268,279,283-286

1. **请求模型**（第 251 行）：`streamAssistantResponse` 把当前上下文交给模型层，等回复流完，得到一条完整的助手消息；
2. **回复进入历史**（第 252 行）：不管是文字还是工具请求，都要记下来，否则下一次请求时模型会“忘记”自己说过什么；
3. **取出工具请求**（第 268 行）：回复里所有的 `toolCall` 块；
4. **执行**（第 279 行）：`executeToolCalls` 找到同名工具，校验参数，调用它的 `execute`，得到结果（Pi 默认并行执行一批只读工具，第 4 章讲）；
5. **结果放回历史**（第 283 至 286 行）：追加进上下文，内层循环的条件“还有工具结果要交给模型”成立，回到第 1 步。

循环结束的条件只有一个：**模型的回复里没有工具请求了**（再加上没有排队的消息，第 3 章）。

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
<figcaption>Agent 循环：橙色部分就是“循环”。每转一圈，历史多出一条模型回复和若干条工具结果。</figcaption>
</figure>

::: compare Claude Code 官方文档怎么描述这件事
Claude Code 的文档把它称为 **agentic loop**：收集上下文、采取行动、验证结果，三个阶段交织进行，每一次工具调用的结果都会影响下一步的决定。文档还专门说明，Claude Code 本身就是“包在模型外面、提供工具并管理上下文的那一层”，并把这一层称为 agentic harness。这门课要读懂的，就是这一层。（[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)）
:::

### 让 Pi 真跑一遍

我们把同一个任务交给 Pi：用它真实的 `runAgentLoop` 和自带的 `ls`、`read` 工具，模型换成 Pi 自己的脚本模型（faux provider）：先 `ls`，看到 README 就读，读完就回答。循环、工具、消息格式全是 Pi 的真实代码，所以 `ls` 真的会列出 `labs/fixtures/mox-project` 里的文件，`read` 真的会读出 README。循环分辨不出它面对的是脚本还是真模型，这正是我们想要的。

@lab node labs/ch01/pi-read.ts | md

用户只问了一句话，Pi 却向模型发了三次请求，上下文从 2 条长到 6 条。下面的回放把这次运行拆成一步一步，左边点选步骤，右边看每一刻的完整消息列表。请求步骤可以展开“交给适配器之前”的内部消息：

@trace node labs/ch01/trace.ts

::: steps 一句提问如何变成三次请求
--- 用户问了一句话。`runLoop` 手里的上下文只有两条：声明了可用工具的**系统消息**和用户的 `user` 消息，还没有任何工具结果。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as Pi 的 runLoop
  participant M as 模型层 + 模型 API
  participant T as 工具 ls / read
  rect rgb(255, 230, 213)
    U->>L: 这个项目是做什么的？
    Note over L: 上下文：system（含工具声明）、user
  end
--- **第 1 次请求**（第 251 行）：`streamAssistantResponse` 把这 2 条交给模型层。回复里有一个 `ls` 工具调用，`stopReason` 是 `toolUse`；回复先进入 `newMessages`（第 252 行）。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as Pi 的 runLoop
  participant M as 模型层 + 模型 API
  participant T as 工具 ls / read
  U->>L: 这个项目是做什么的？
  Note over L: 上下文：system（含工具声明）、user
  rect rgb(255, 230, 213)
    L->>M: 请求 1：2 条消息
    M-->>L: toolCall：ls(path=.)
    Note over L: 助手消息记录下来
  end
--- **执行并放回历史。** 第 268 行取出回复里的 `toolCall` 块，第 279 行 `executeToolCalls` 找到同名工具真正执行，第 283 至 286 行把结果以 `toolResult` 消息（带 `toolCallId`）追加进上下文。现在是 4 条。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as Pi 的 runLoop
  participant M as 模型层 + 模型 API
  participant T as 工具 ls / read
  U->>L: 这个项目是做什么的？
  Note over L: 上下文：system（含工具声明）、user
  L->>M: 请求 1：2 条消息
  M-->>L: toolCall：ls(path=.)
  Note over L: 助手消息记录下来
  rect rgb(255, 230, 213)
    L->>T: executeToolCalls → ls
    T-->>L: toolResult
    Note over L: 追加 toolResult：上下文 4 条
  end
--- **第 2 次请求**交出去的是 4 条，不是只发新增的那条，因为 API 不保存状态。模型看到目录里有 README，请求 `read`。再执行、再放回，上下文长到 6 条。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as Pi 的 runLoop
  participant M as 模型层 + 模型 API
  participant T as 工具 ls / read
  U->>L: 这个项目是做什么的？
  Note over L: 上下文：system（含工具声明）、user
  L->>M: 请求 1：2 条消息
  M-->>L: toolCall：ls(path=.)
  Note over L: 助手消息记录下来
  L->>T: executeToolCalls → ls
  T-->>L: toolResult
  Note over L: 追加 toolResult：上下文 4 条
  rect rgb(255, 230, 213)
    L->>M: 请求 2：4 条消息
    M-->>L: toolCall：read(path=README.md)
    L->>T: executeToolCalls → read
    Note over L: 上下文 6 条
  end
--- **第 3 次请求**发送 6 条，其中 2 条是模型自己说过的话。这次回复里没有 `toolCall`，`hasMoreToolCalls` 为 false，内层循环的条件不再成立，运行结束：一句提问，三次请求。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as Pi 的 runLoop
  participant M as 模型层 + 模型 API
  participant T as 工具 ls / read
  U->>L: 这个项目是做什么的？
  Note over L: 上下文：system（含工具声明）、user
  L->>M: 请求 1：2 条消息
  M-->>L: toolCall：ls(path=.)
  Note over L: 助手消息记录下来
  L->>T: executeToolCalls → ls
  T-->>L: toolResult
  Note over L: 追加 toolResult：上下文 4 条
  L->>M: 请求 2：4 条消息
  M-->>L: toolCall：read(path=README.md)
  L->>T: executeToolCalls → read
  Note over L: 上下文 6 条
  rect rgb(255, 230, 213)
    L->>M: 请求 3：6 条消息
    M-->>L: 文字回答，没有 toolCall
    L-->>U: 回答用户
  end
:::


注意开头那条 `system` 消息：Pi 把“当前有哪些工具可用”也记录成了上下文里的一条系统消息（`toolsAdded`），第 6 章会解释这个设计。

::: predict
第三次请求一共发送了几条消息？其中有几条是模型自己之前说的话？
???
6 条：system、user、模型的第一次回复（请求 `ls`）、`ls` 的结果、模型的第二次回复（请求 `read`）、`read` 的结果。其中 2 条是模型自己说过的话。模型没有记忆，它“记得”自己刚才请求过什么，完全是因为 Pi 把它的回复也放进了上下文。
:::

### 工具调用的 id 从哪里来？

`toolCall.id` 来自模型返回的内容，不是工具运行后生成的。离线实验没有调用真实模型：Pi 的脚本模型直接给了 `call_1`、`call_2`。接入真实 API 时，程序使用响应里返回的工具调用 id；API 文档说明它的关联用途，并不一定公开该 id 是模型还是服务端组件生成的。Agent 在执行工具之后，把同一个 id 放进 `toolCallId` 回传。第 2 章的 MiniMax 实际调用记录展示了一次真实返回值和对应结果。这个 id 不表示工具已经执行成功，成功与否要看结果里的 `isError`。

## 三个关键事实

### 模型从不执行任何东西

模型的回复只是一段 JSON：`{"name": "read", "arguments": "{\"path\": \"README.md\"}"}`。执不执行、怎么执行、在哪个目录执行，全部由你的程序决定。

这句话有两层含义。好的一面：**程序拥有最终控制权**，可以在执行前检查参数、拒绝危险操作、要求用户确认（第 14 章的权限系统就建立在这一点上）。需要警惕的一面：**程序也承担全部后果**。模型被一段恶意的 README 诱导，请求执行 `rm -rf ~`，真正执行这条命令的是你的程序，用的是你的账户权限。

### API 不保存任何状态

第二次请求交出去 4 条消息，第三次 6 条。每一次都是**从头发送全部历史**，因为模型 API 是无状态的：服务端不记得你上一次发过什么。

这直接决定了 Agent 的成本结构。假设每轮新增的内容大约等长，第 *n* 次请求要处理的输入大约是第 1 次的 *n* 倍，一次运行的总输入量随轮数**平方级**增长。一个修了 30 轮的 bug，最后几次请求每次都要把前面所有的文件内容和命令输出再读一遍。

这也是为什么生产级 Agent 都在意两件事：

- **提示缓存**（prompt caching）：如果请求的前缀和上一次完全相同，服务商可以复用已经算过的结果，按更低的价格计费。这要求历史**只追加、不修改**，第 6 章会看到 Pi 为此做的设计。
- **上下文压缩**（compaction）：历史太长时，把早期内容换成摘要。第 8 章细讲。

### 循环由“有没有工具请求”驱动

循环只看一件事：这次回复里有没有工具请求（Pi 的 `runLoop` 里就是第 268 行那个 `toolCalls.length > 0`）。这个判断简单到几乎不像设计，但它意味着**任务什么时候结束，完全由模型决定**。模型想继续查，循环就继续转；模型觉得够了，循环就停。

这既是 Agent 灵活的来源，也是它不可预测的来源。注意 Pi 的 `runLoop` 里同样**没有最大轮数**：模型只要一直请求工具，它就一直转。第 3 章会让一个朴素的循环坏四次（半截参数被执行、异常炸断运行、停不下来、插话递不进去），再逐段读 Pi 是怎样防这些事的。

::: note 这个循环有个名字：ReAct
2022 年的论文 *ReAct: Synergizing Reasoning and Acting in Language Models*（Yao 等）提出让模型交替进行“推理”和“行动”：先想一步（Thought），再调用一个工具（Action），看到结果（Observation）后接着想。早期的实现要求模型按固定文本格式输出 `Thought: … Action: …`，再由程序用正则解析。

今天的工具调用把这件事做成了 API 的一部分：Action 变成结构化的 `tool_calls`，Observation 变成 `role: tool` 消息，推理则放进模型的思考内容里（第 2 章）。面试里被问到 ReAct，可以直接说：这一章的循环就是它的现代形态。
:::

## 实战：给 mox 加上第一个能跑的 Agent

从这一章起，每章末尾都有一个实战：**把刚才读的 Pi 的机制，在 mox 里写出最小的版本**。mox 是我们一步步搭出来的 coding agent，到第 21 章就是一个完整的、能用的命令行 Agent。[Mox-agent](https://github.com/Jialei-03/Mox-agent) 仓库（本仓库的 `mox/` 子模块）是参考答案：高亮的片段就是你要写出来的样子，写完用本章的 `practice.ts` 检验。

**这一章的目标**：在你的 mox 目录里写出能跑的第一个 Agent：一个 `runLoop`（请求模型 → 执行工具 → 把结果放回去，直到模型不再调用工具）和一个 `read` 工具。和 Pi 相比，mox 的消息直接用 OpenAI 的格式（`tool_calls`、`role: 'tool'`），省掉了 Pi 的翻译层（第 2 章会读）。

### 第 1 步：模型调用先用参考实现的

模型调用（HTTP、流式解析）是第 2 章的实战。现在把参考实现的 `model.ts` 原样复制过来，只需要认识它的类型：

```bash
cp mox/src/model.ts ~/my-mox/src/model.ts      # ~/my-mox 是第 0 章建的目录
```

@code mox/src/model.ts#L2-L7 hl=3-4,7

注意 `Msg` 就是 OpenAI 的消息：assistant 带 `tool_calls`，参数 `arguments` 是 **JSON 字符串**；工具结果是 `role: 'tool'` 加 `tool_call_id`。`Model` 是一个函数：给它消息和工具说明，还你 `{ message, finish }`。

### 第 2 步：写 read 工具

工具 = 说明书 + 一个函数。`name`、`description`、`parameters` 是给模型看的（对应 Pi 的 `read` 工具定义），`run` 是给程序用的。先写最简单的版本：把文件内容原样返回。`Tool` 类型放在 `loop.ts` 里（下一步），`tools.ts` 导出 `codingTools(cwd)`，返回工具数组：

```ts
// ~/my-mox/src/tools.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool } from './loop.ts';

export function codingTools(cwd: string): Tool[] {
  return [
    {
      name: 'read',
      description: '读取文本文件。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] },
      run: ({ path }) => readFileSync(resolve(cwd, path), 'utf8'),
    },
  ];
}
```

参考实现的 `read` 更完整：按 `offset`、`limit` 取行，输出截到 2000 行或 50KB，没读完就提示“用 offset=N 接着读”。这些是第 5 章的内容，对应 Pi 的 `read` 工具里那一大段说明：

@code mox/src/tools.ts#L29-L44 hl=30-33

### 第 3 步：写 runLoop 的主路径

`loop.ts` 里先写 `Tool` 类型和循环。循环对应上面 Pi 的第 251 到 286 行，五件事各一行：

```ts
// ~/my-mox/src/loop.ts
import type { Model, Msg, ToolSpec } from './model.ts';

export type Tool = ToolSpec & { run: (args: any, signal?: AbortSignal) => Promise<string> | string };
export type LoopOptions = { model: Model; system: string; tools: Tool[] };

/** 在 messages 上就地追加，返回模型最后的回答。 */
export async function runLoop(messages: Msg[], options: LoopOptions): Promise<string> {
  const specs = options.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  while (true) {
    // ① 把完整的历史发给模型（system 每次加在最前面，不进 messages）
    const { message } = await options.model({ messages: [{ role: 'system', content: options.system }, ...messages], tools: specs });
    messages.push(message);                                                   // ② 回复进入历史
    for (const call of message.tool_calls ?? []) {                             // ③ 回复里有几个工具请求，就执行几个
      const tool = options.tools.find(t => t.name === call.function.name)!;
      const result = await tool.run(JSON.parse(call.function.arguments));
      messages.push({ role: 'tool', tool_call_id: call.id, content: result });  // ④ 结果放回历史
    }
    if (!message.tool_calls?.length) return message.content ?? '';            // ⑤ 没有工具请求，结束
  }
}
```

参考实现里同一个循环长得更复杂，高亮的几行就是上面这五件事；其余几行是第 3 章要加的保护（截断、错误、插话、取消），现在先不管：

@code mox/src/loop.ts#runLoop hl=29,35,37,40

两个细节：`messages` 是**就地追加**的，调用者传进去的数组在运行结束后就是完整的历史，会话保存（第 7 章）靠这一点；一条回复里的多个调用用 `for` **顺序**执行，而 Pi 默认并行。

### 第 4 步：检验

`practice.ts` 用脚本模型（离线、确定）驱动你的循环和工具：读 README、再回答，并检查每次请求发出的消息、`tool_call_id` 的配对、一条回复里两个调用的执行顺序。默认检验参考实现，设置 `MOX_DIR` 就检验你自己写的：

```bash
node labs/ch01/practice.ts                      # 参考实现
MOX_DIR=~/my-mox node labs/ch01/practice.ts     # 你自己写的
```

@lab node labs/ch01/practice.ts

### 第 5 步：接上真实模型

mox 的模型调用说 OpenAI Chat Completions 格式，MiniMax、DeepSeek、OpenAI、OpenRouter 和本地的 Ollama 都兼容。设置三个环境变量（模型需要支持工具调用），再用 `chat.ts` 把你的循环接上去：

```bash
export MOX_BASE_URL=https://api.minimaxi.com/v1   # 服务商的地址，不写就是 OpenAI
export MOX_API_KEY=你的 Key
export MOX_MODEL=MiniMax-M3.1-Flash                # 这门课推荐的模型
MOX_DIR=~/my-mox node labs/ch01/chat.ts "入口文件在哪里？它做了什么？"
```

（参考实现自带的命令行是 `node mox/src/cli.ts -p "…"`，或者在 `mox/` 里 `npm link` 之后直接用 `mox`；它到第 21 章才由你搭完。）

下面是用 MiniMax-M3.1-Flash 把**参考实现的同一个循环**真实跑了一遍的记录（2026-11-05，`labs/ch01/record.ts` 录制；在临时目录的项目副本里进行，路径和用户名已替换）：

@lab node labs/ch01/show-real.ts | md

和脚本模型对比，有三处值得看。第一，真实模型**一次请求了两个工具**：先 `ls` 又 `find`，下一轮同时 `read` README 并 `ls src`。循环的 `for` 把它们按顺序执行，每个都有自己的 `tool` 消息。第二，第一次回复里有一句文字和工具调用**同时出现**：文字边生成边显示，工具调用要等整条回复结束才执行。第三，同一个问题，脚本模型三次请求就答完，真实模型走了五次：哪些信息“够了”由模型判断，循环只管它要什么就给什么。

@trace node labs/ch01/trace-real.ts

### mox 比 Pi 省掉了什么

| | mox（你刚写的） | Pi |
| --- | --- | --- |
| 消息格式 | 直接使用 OpenAI 的线上格式，没有翻译层 | 统一的内部格式，由适配器翻译成各家格式（第 2 章） |
| 输出方式 | 文字边生成边显示，工具调用整条回复结束才执行 | 流式，并且工具参数也有增量事件，界面可以实时预览（第 2 章） |
| 工具失败 | 现在还会让异常冒出循环；第 3 章补上 | 变成一条带 `isError` 的结果交回给模型（第 3 章） |
| 停止条件 | 只看有没有工具请求 | 还要考虑截断、宿主决定、运行中的插话（第 3 章） |
| 工具 | 一个 `read`，顺序执行 | 七个内置工具，参数校验，并行控制（第 4、5 章） |
| 历史 | 存在内存里，进程退出就没了 | 写进 JSONL 会话文件，可以恢复和分叉（第 7 章） |

接下来每一章实战，都是在把左边这一列一格一格变成右边那一列的最小版本。

### 你来改

::: predict 不把模型的回复放进历史
把你的 `runLoop` 里第 ② 步的 `messages.push(message)` 删掉，只保留执行工具、放回结果的那一行。用真实模型运行，模型第一次请求了 `ls`，程序执行了它。第二次请求会发生什么？
???
服务商直接拒绝这次请求（HTTP 400）。第二次请求的 `messages` 里有一条 `role: 'tool'` 的消息，它的 `tool_call_id` 在前面任何一条 assistant 消息里都找不到：模型的回复没有进历史，工具结果就成了“没人要求过的回答”。OpenAI 格式要求每条工具结果都对应前面某条 assistant 消息里的 `tool_calls`。就算服务商不校验，模型也不记得自己调用过什么，只能看到一份来路不明的目录列表。所以这一行不是装饰：**历史要完整记录双方说过的每一句话**。（`practice.ts` 里“要带上模型自己的回复和工具结果”那条断言也会失败。）
:::

::: predict 读一个不存在的文件
用真实模型问你的 mox “读一下 CHANGELOG.md”（这个文件不存在）。你的 `run` 里的 `readFileSync` 会抛异常。运行会怎样？
???
异常从 `tool.run` 冒出 `runLoop`，整个运行崩溃，之前的对话（`messages`）虽然还在内存里，但调用者拿不到最终回答。模型本来完全有能力处理“文件不存在”——换个文件读，或者告诉你没有——但它根本没机会看到这个错误。第 3 章实战会把异常变成一条以“错误：”开头的工具结果，交回给模型。
:::

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
