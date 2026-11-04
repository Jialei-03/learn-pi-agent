---
motto: 工具是写给模型的接口。它出错的方式，决定了模型能不能自己改正。
learn:
  - 一个工具由哪几部分组成，哪些是给模型看的，哪些是给程序和界面看的
  - 一个工具调用从“模型提出”到“结果交回”要经过的六道关
  - 参数校验为什么要“宽进严出”，错误信息为什么要写给模型看
  - 执行前拦截、执行后改写，以及它们为什么是权限系统的地基
  - 并行与串行、批次终止：一批工具调用怎样被当成一个整体处理
prereq: 第 3 章
time: 60 分钟
build: mox/src/tools.ts 与 mox/src/schema.ts —— 带校验、钩子和并行执行的工具流水线
---

第 3 章的循环把工具执行交给了一个很简单的 `runTools`：找到工具，调用它，异常变成错误结果。这一章把它扩展成一条完整的流水线。我们会看到，生产级 Agent 在“执行一个工具”这件事上，要处理的远不止调用一个函数。

## 工具是一份契约

一个工具对两个读者说话。

**对模型**，它是一份说明书：名字、用途描述、参数格式。模型只能看到这三样，并据此决定要不要调用、怎么填参数。**对程序**，它是一个函数，外加几项运行时的约定：能不能和别的工具同时执行、参数格式不对时能不能先修一修。

Pi 的工具类型把这两部分放在一起：

@pi packages/agent/src/types.ts#L478-L511

除了 `name`、`description`、`parameters` 这三个发给模型的字段，其余都只在程序这一侧生效：`label` 给界面显示，`prepareArguments` 修正参数，`executionMode` 控制并发，`execute` 真正干活。

工具的返回值同样分成两部分：

@pi packages/agent/src/types.ts#L423-L446

`content` 发给模型，`details` 留给界面和日志。比如一个编辑文件的工具，可以把完整的 diff 放进 `details` 供界面渲染，只在 `content` 里告诉模型“修改成功，替换了 3 行”。**发给模型的内容越精炼越好**，因为它会留在历史里，之后的每一次请求都要为它付费（第 1 章）。

注释里还有一条约定值得注意：报告失败要么抛异常，要么返回 `isError: true`，**不要只在 `content` 里用文字描述失败**。因为界面、钩子、统计都依赖这个标记判断成功还是失败。

mox 的工具接口是同一个设计的精简版：

@code mox/src/tools.ts#region:tool-interface

## 一个工具调用要过几道关

@figure assets/course/ch04-pipeline.png 一次工具调用经过的六道工序：找到工具、修正参数、校验、执行前钩子、执行、执行后钩子；并行执行，按原来的顺序交回

模型发来一个工具调用之后，到结果交回模型之前，Pi 依次做了这些事：

<figure class="diagram">
<svg viewBox="0 0 720 250" role="img" aria-label="工具调用的六道关">
<defs><marker id="a4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a4r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--red)"/></marker></defs>
<rect x="88" y="14" width="392" height="22" rx="6" fill="var(--bg-soft)"/><text x="284" y="29" text-anchor="middle" font-size="11.5" fill="var(--muted)">准备阶段：按调用顺序逐个进行</text>
<rect x="488" y="14" width="152" height="22" rx="6" fill="var(--accent-soft)"/><text x="564" y="29" text-anchor="middle" font-size="11.5" fill="var(--accent-ink)">执行阶段：可以并行</text>
<g font-size="12.5" text-anchor="middle" fill="var(--ink)">
<rect x="4" y="60" width="74" height="52" rx="8" fill="var(--ink)"/><text x="41" y="83" fill="var(--bg)">模型的</text><text x="41" y="100" fill="var(--bg)">toolCall</text>
<rect x="88" y="60" width="90" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="133" y="83">① 找到工具</text><text x="133" y="101" font-size="11" fill="var(--faint)">按名字查找</text>
<rect x="188" y="60" width="90" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="233" y="83">② 修正参数</text><text x="233" y="101" font-size="11" fill="var(--faint)">prepareArguments</text>
<rect x="288" y="60" width="90" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="333" y="83">③ 宽进严出</text><text x="333" y="101" font-size="11" fill="var(--faint)">修正 + 校验</text>
<rect x="388" y="60" width="90" height="52" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="433" y="83">④ 执行前钩子</text><text x="433" y="101" font-size="11" fill="var(--faint)">可以拦截</text>
<rect x="488" y="60" width="70" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/><text x="523" y="83">⑤ 执行</text><text x="523" y="101" font-size="11" fill="var(--faint)">signal</text>
<rect x="568" y="60" width="72" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/><text x="604" y="83">⑥ 执行后</text><text x="604" y="101" font-size="11" fill="var(--faint)">可改写</text>
<rect x="650" y="60" width="66" height="52" rx="8" fill="var(--ink)"/><text x="683" y="83" fill="var(--bg)">tool</text><text x="683" y="100" fill="var(--bg)">Result</text>
<rect x="88" y="176" width="552" height="40" rx="8" fill="var(--bg-soft)"/>
<text x="364" y="193" font-size="12.5" fill="var(--ink)">直接得到一条 isError 的结果，工具函数不会被调用</text>
<text x="364" y="209" font-size="11" fill="var(--faint)">工具不存在 · 参数修不好 · 被钩子拦下 · 已取消</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a4)">
<path d="M78 86H86"/><path d="M178 86H186"/><path d="M278 86H286"/><path d="M378 86H386"/><path d="M478 86H486"/><path d="M558 86H566"/><path d="M640 86H648"/><path d="M640 196H683V114"/>
</g>
<g stroke="var(--red)" stroke-width="1.1" fill="none" stroke-dasharray="3 3" marker-end="url(#a4r)">
<path d="M133 112V174"/><path d="M233 112V174"/><path d="M333 112V174"/><path d="M433 112V174"/>
</g>
<text x="604" y="140" font-size="11" fill="var(--faint)" text-anchor="middle">异常也变成</text><text x="604" y="154" font-size="11" fill="var(--faint)" text-anchor="middle">isError 结果</text>
</svg>
<figcaption>任何一道关失败，都会直接产生一条错误结果交回模型，而不是让异常冲出循环。</figcaption>
</figure>

::: steps 一个写错参数的调用怎样过六道关
--- 模型发来一个调用：`read_file`，参数 `{ file: "README.md", limit: "20" }`，名字和类型都写错了。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::on --> G1["① 找工具"]:::dim --> G2["② 修正"]:::dim --> G3["③ 校验"]:::dim --> G4["④ 前钩子"]:::dim
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::dim
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::dim --> G6["⑥ 后钩子"]:::dim --> R["toolResult"]:::dim
  end
  P --> X
--- **① 找到工具。** 按名字在工具表里查找，`read_file` 存在，继续。名字不存在的话，到这里就会直接得到一条错误结果。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::done --> G1["① 找工具"]:::on --> G2["② 修正"]:::dim --> G3["③ 校验"]:::dim --> G4["④ 前钩子"]:::dim
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::dim
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::dim --> G6["⑥ 后钩子"]:::dim --> R["toolResult"]:::dim
  end
  P --> X
--- **② 修正。** 先复制一份参数（不能改到历史里那条调用），再交给 `prepareArguments`，然后做类型修正：`limit: "20"` 变成数字 20。意图毫无歧义，不算错误。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::done --> G1["① 找工具"]:::done --> G2["② 修正"]:::on --> G3["③ 校验"]:::dim --> G4["④ 前钩子"]:::dim
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::dim
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::dim --> G6["⑥ 后钩子"]:::dim --> R["toolResult"]:::dim
  end
  P --> X
--- **③ 严格校验失败。** `path` 缺失、`file` 不认识。得到的是一条 `isError` 结果，列出每个问题并附上收到的原始参数；后面三道关都不会走，工具函数没有被调用。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::done --> G1["① 找工具"]:::done --> G2["② 修正"]:::done --> G3["③ 校验"]:::on --> G4["④ 前钩子"]:::dim
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::on
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::dim --> G6["⑥ 后钩子"]:::dim --> R["toolResult"]:::dim
  end
  P --> X
--- 模型把错误信息当作下一轮的输入，第二次改成 `{ path, limit: 20 }`。这次 ①～④ 全部通过：`beforeToolCall` 没有拦下它，**⑤ 执行**真正开始。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::done --> G1["① 找工具"]:::done --> G2["② 修正"]:::done --> G3["③ 校验"]:::done --> G4["④ 前钩子"]:::done
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::done
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::on --> G6["⑥ 后钩子"]:::dim --> R["toolResult"]:::dim
  end
  P --> X
--- **⑥ 执行后。** `afterToolCall` 可以改写结果（比如隐去密钥），最后得到一条正常的 `toolResult`，按调用顺序交回模型。一次请求变成两次，但没有任何异常冲出循环。
flowchart TB
  subgraph P["准备阶段：按调用顺序逐个进行"]
    direction LR
    C["toolCall"]:::done --> G1["① 找工具"]:::done --> G2["② 修正"]:::done --> G3["③ 校验"]:::done --> G4["④ 前钩子"]:::done
    G3 -.->|失败| E["isError 结果<br/>交回模型"]:::done
  end
  subgraph X["执行阶段：可以并行"]
    direction LR
    G5["⑤ 执行"]:::done --> G6["⑥ 后钩子"]:::on --> R["toolResult"]:::on
  end
  P --> X
:::

前四道关在 Pi 里由同一个函数完成：

@pi packages/agent/src/agent-loop.ts#prepareToolCall

注意它的返回类型只有两种：`prepared`（可以执行了）和 `immediate`（已经有结果了，不用执行）。工具不存在、参数不合法、被钩子拦下、已经取消，都属于后者。这种“要么准备好，要么已经有答案”的二分法，让后面的执行逻辑完全不需要关心失败的原因。

mox 的流水线结构相同，分成 `prepare` 和 `execute` 两半：

@code mox/src/tools.ts#prepare

## 校验：宽进严出

### 错误信息是写给模型看的

参数校验失败时，错误信息不是给开发者看的日志，而是**下一轮模型的输入**。它要回答模型的三个问题：哪个参数错了？错在哪？我实际发了什么？

这个实验让模型第一次调用时把参数名写错（`file` 而不是 `path`），还把数字写成了字符串：

@lab node labs/ch04/validate.ts

两个实现都只用了 3 次请求：第一次调用失败，模型看到错误信息后第二次就改对了。Pi 的错误信息格式正是为此设计的——逐条列出路径和问题，最后附上收到的原始参数：

@pi packages/ai/src/utils/validation.ts#L54-L69 hl=58

高亮的第 58 行注释也值得注意：校验之前先**复制**一份参数。工具和钩子可能会修改参数，如果直接改了历史里那条工具调用，下一次请求的前缀就变了，提示缓存会失效（第 6 章），会话记录也和模型当时实际说的话对不上。mox 用 `structuredClone` 做了同样的事。

### 宽进：先修正明显无害的错误

仔细看实验输出：模型把 `limit` 写成了字符串 `"20"`，但两个实现都**没有**把它当成错误。

这是 Pi 刻意的设计。它的校验器开启了类型修正（`coerce: true`）：

@pi packages/ai/src/utils/validation.ts#L8-L18

注释里列出了模型最常犯的几类格式错误：把数字写成字符串、把单个值当成数组、给可选参数传 `null`。这些错误的意图毫无歧义，直接修正可以省掉一次来回；而 `"abc"` 不可能是整数，修不了的就严格报错。mox 实现了同样的规则：

@code mox/src/schema.ts#coerce

::: insight 宽进严出是一种权衡
修正得越多，模型越少因为格式问题浪费一次请求；但修正规则本身也可能猜错意图。好的修正只做“意图毫无歧义”的转换，并且修正发生在校验之前，修不好的仍然交给严格校验。不要为了“让调用成功”去猜测缺失的必填参数。
:::

### 兼容垫片：给特定模型的习惯打补丁

格式修正之外，还有一类更具体的问题：某些模型对某个工具有固定的“坏习惯”。Pi 的 `edit` 工具接受一个 `edits` 数组，但实际运行中发现，有的模型会把整个数组序列化成 JSON 字符串发过来，有的只发一个对象而不是数组，还有的用老版本的参数格式：

@pi packages/coding-agent/src/core/tools/edit.ts#prepareEditArguments

注释里直接写出了是哪些模型。这就是 `prepareArguments` 的用途：**在通用校验之前，针对单个工具做定向修正。** 它是在真实使用中积累下来的经验，你自己的 Agent 上线后也会慢慢长出这样的代码。

## 钩子：执行前拦截，执行后改写

流水线上有两个留给宿主的插口。`beforeToolCall` 在参数校验之后、执行之前调用，可以拦下这次调用；`afterToolCall` 在执行之后调用，可以逐字段改写结果。Pi 的类型说明写得很清楚：

@pi packages/agent/src/types.ts#L319-L341

这个实验用两个钩子做了两件典型的事：拦下会删除根目录的命令，以及把输出里的密钥隐去：

@lab node labs/ch04/hooks.ts

“真正执行过的命令”一行只有 `cat .env`：被拦下的命令从未到达工具函数。而第二次调用的输出里，密钥在模型看到之前就被替换了——模型的历史里永远不会出现原文，也就不会在后续回答里泄露它。

这两个钩子是后面好几章的地基：

- 第 13 章的 Hooks 扩展，把它们暴露成外部命令，兼容 Claude Code 的 `PreToolUse` / `PostToolUse` 协议；
- 第 14 章的权限系统，在 `beforeToolCall` 里按规则决定允许、询问还是拒绝；
- Pi 的扩展系统把它们包装成 `tool_call` 和 `tool_result` 事件（第 9 章）。

::: warn 用正则拦命令不是安全措施
实验里的拦截规则只要稍加变化就能绕过：`rm -rf "/"`、`cd / && rm -rf .`、`find / -delete`……它连带着把无害的 `rm -rf build` 也一起拦下了。字符串匹配适合拦截“明显的误操作”，不适合抵御“有意的攻击”。真正的边界在操作系统层面（第 15 章）。
:::

### 嵌套的工具调用也要过同一条流水线

Pi 有一种工具会调用别的工具：`codemode` 让模型写一段 JavaScript，脚本里可以调用其他工具（第 15 章）。如果这些嵌套调用绕过了流水线，权限钩子就形同虚设——模型只要把危险操作包进脚本里就行。Pi 为此单独导出了一个函数，让嵌套调用走完全相同的步骤：

@pi packages/agent/src/agent-loop.ts#L812-L829

注释里说得很直白：工具调用工具时用它，**这样钩子（比如权限检查）同样适用于这些调用**。安全检查必须放在所有路径都会经过的地方，而不是“大多数路径”会经过的地方。

## 并行还是串行

第 2 章提到，模型可以在一条回复里请求多个工具。比如同时读三个文件。这些调用应该一个接一个执行，还是同时执行？

这个实验让模型一次请求三个工具，分别耗时 300、100、200 毫秒：

@lab node labs/ch04/parallel.ts | md

默认情况下，三个工具同时执行，总耗时约等于最慢的那个（300 毫秒）。注意最后两列的区别：工具**完成**的顺序是 b → c → a（谁快谁先），但交给模型的结果**仍然按调用顺序**排列。界面可以按完成顺序实时显示进度，历史记录必须保持稳定的顺序。

Pi 的并行执行有一个容易被忽略的细节：**准备阶段仍然是按顺序进行的**，只有执行阶段才并行：

::: tabs
@@ Pi
@pi packages/agent/src/agent-loop.ts#executeToolCallsParallel collapse=true
@@ mox
@code mox/src/tools.ts#L123-L134
先按顺序 `await prepare`，再把每个执行放进 `pending`，最后 `Promise.all`；结果按 `calls` 的下标排列。
:::

::: steps 三个并行工具怎样完成、怎样交回
--- 模型一次请求了三个工具。**准备阶段按调用顺序逐个进行**：每个调用依次过校验和 `beforeToolCall`，因为权限钩子可能要弹窗，三个询问同时弹出会让用户分不清。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  rect rgb(255, 230, 213)
    R->>R: prepare(a)，prepare(b)，prepare(c)
  end
--- 准备完成后，三个工具**同时开始执行**，每个执行都是一个还没有结束的 Promise，放进 `pending`。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  R->>R: prepare(a)，prepare(b)，prepare(c)
  rect rgb(255, 230, 213)
    R->>A: execute
    R->>B: execute
    R->>C: execute
  end
--- 100ms：b 先完成，发出 `tool_end` 事件，界面可以立刻显示它的进度。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  R->>R: prepare(a)，prepare(b)，prepare(c)
  R->>A: execute
  R->>B: execute
  R->>C: execute
  rect rgb(255, 230, 213)
    B-->>R: 完成（tool_end）
  end
--- 200ms：c 完成。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  R->>R: prepare(a)，prepare(b)，prepare(c)
  R->>A: execute
  R->>B: execute
  R->>C: execute
  B-->>R: 完成（tool_end）
  rect rgb(255, 230, 213)
    C-->>R: 完成（tool_end）
  end
--- 300ms：a 最后完成。`Promise.all(pending)` 到这时才返回，总耗时约等于最慢的那一个。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  R->>R: prepare(a)，prepare(b)，prepare(c)
  R->>A: execute
  R->>B: execute
  R->>C: execute
  B-->>R: 完成（tool_end）
  C-->>R: 完成（tool_end）
  rect rgb(255, 230, 213)
    A-->>R: 完成（tool_end）
  end
--- 完成顺序是 b → c → a，但结果按**调用顺序** a → b → c 放进历史：界面可以按完成顺序显示，历史必须保持稳定。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as runTools
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  R->>R: prepare(a)，prepare(b)，prepare(c)
  R->>A: execute
  R->>B: execute
  R->>C: execute
  B-->>R: 完成（tool_end）
  C-->>R: 完成（tool_end）
  A-->>R: 完成（tool_end）
  rect rgb(255, 230, 213)
    Note over R: 结果顺序 a、b、c，放回历史
  end
:::

为什么不连准备阶段一起并行？因为准备阶段包含 `beforeToolCall`，而权限钩子可能需要弹窗询问用户。三个询问同时弹出来，用户分不清哪个是哪个；按顺序问，才能一次只回答一个。

### 什么时候必须串行

有的工具不能和别的工具同时执行。最常见的情况是两个工具写同一个文件：同时执行时，后写的会覆盖先写的。Pi 用两种方式处理：

- **工具级别**：工具声明 `executionMode: 'sequential'`，只要一批里有它，整批都串行执行（实验第三种情形）。
- **资源级别**：`edit` 和 `write` 工具对同一个文件的修改排队执行，对不同文件的修改仍然并行。

后者的实现是一个按文件路径分组的队列：

@pi packages/coding-agent/src/core/tools/file-mutation-queue.ts#withFileMutationQueue collapse=true

它先用 `realpath` 把路径解析到真实文件，这样通过符号链接或相对路径指向同一个文件的两次写入，也会被正确地排进同一个队列。第 5 章实现 mox 的文件工具时会用到同样的思路。

## 批次终止：工具能让运行提前结束

第 3 章的循环在“有工具结果”时总会再请求一次模型。但有些工具执行完，任务就已经完成了。比如一个 `submit` 工具把最终答案交给外部系统，这时再问一次模型纯属浪费。

工具可以在结果里设置 `terminate: true`，建议循环就此结束。规则是：**一批工具全部同意才结束**：

@lab node labs/ch04/terminate.ts | md

只要批次里混着一个普通工具，它的结果模型还没看过，就必须再请求一次。Pi 的判断只有一行：

::: tabs
@@ Pi
@pi packages/agent/src/agent-loop.ts#shouldTerminateToolBatch
@@ mox
@code mox/src/tools.ts#L136-L138
同一条规则：先判断长度，再要求 `every` 都是 `terminate`。
:::

`length > 0` 这个条件不是多余的：JavaScript 里空数组的 `every()` 返回 `true`，没有它，一个空批次会被误判为“全部同意终止”。

mox 的循环在第 4 章也接上了这个规则（第 3 章展示的 `runLoop` 里，`hasMoreToolCalls` 那一行）：

@code mox/src/tools.ts#runTools collapse=true

## 工具执行中的进度

最后一个细节：耗时的工具（运行测试、下载文件）可以在执行过程中报告部分输出。Pi 的 `execute` 接收一个 `onUpdate` 回调，每次调用都会发出一个 `tool_execution_update` 事件，界面据此实时显示命令输出：

@pi packages/agent/src/agent-loop.ts#executePreparedToolCall

注意 `acceptingUpdates` 这个标记：工具返回之后再调用 `onUpdate` 会被忽略。否则一个写得不严谨的工具在返回之后仍然往界面推送内容，就会出现“结果已经显示完毕，进度却还在跳”的错乱。

## 面试题

先自己回答，再展开对照要点。

::: interview 设计一个 Agent 工具时要考虑哪些方面？
- **给模型的接口**：名字和描述要说清楚用途、限制和适用场景（比如输出会被截断、大文件要分段读）；参数格式用 JSON Schema，必填项尽量少。
- **给程序的约定**：失败用异常或错误标记表示，而不是只写在文字里；声明能否与其他工具并行；支持取消信号；耗时操作报告进度。
- **结果的设计**：发给模型的内容精炼（它会留在历史里反复计费），给界面的详细数据分开放。
- **安全**：所有调用都经过统一的流水线（包括嵌套调用），让权限检查无法被绕过。
:::

::: interview 模型传来的工具参数不合法时，应该怎么处理？
宽进严出：

1. 先修正意图毫无歧义的格式错误（数字写成字符串、单个值当数组、可选参数传 null），省一次来回；
2. 再严格校验，修不好的返回错误结果给模型，**不执行工具**；
3. 错误信息写给模型看：逐条列出参数路径、问题、以及收到的原始参数，模型通常下一轮就能改对；
4. 针对特定工具和特定模型的固定坏习惯，用兼容垫片定向修正。

校验前要复制参数，避免工具修改了历史里的原始调用。
:::

::: interview 一条回复里有多个工具调用时，并行执行要注意什么？
- 结果要**按调用顺序**交回模型，即使完成顺序不同；界面可以按完成顺序显示进度。
- 需要用户确认的步骤（权限询问）应该按顺序进行，只并行真正的执行阶段。
- 有冲突的操作要串行：工具级别声明“必须串行”，或资源级别排队（比如对同一文件的写入按真实路径排队）。
- 取消信号要传给每一个并行执行的工具。
:::

::: interview 如何在不修改工具本身的情况下，拦截或改写工具调用？
在执行流水线上提供两个钩子：执行前钩子可以拦截调用（返回一条错误结果给模型，工具不执行）；执行后钩子可以改写结果（比如隐去密钥、截断过长输出）。

关键点：钩子必须位于所有调用都会经过的路径上，包括工具调用工具的嵌套情况，否则可以被绕过。拦截时给模型一个清楚的理由，它通常会换一种做法。还要认识到基于字符串匹配的拦截只能防误操作，防不了有意攻击。
:::

::: interview 工具怎样让 Agent 提前结束运行？
工具在结果里标记“建议终止”，循环在一批工具执行完之后检查：只有整批都标记了终止才结束，因为其他工具的结果模型还没看过。实现时注意空批次的边界情况（空数组的 every 为真）。

典型场景：提交最终答案的工具、把任务交给人工处理的工具。被权限钩子拦下的调用也可以标记终止，让 Agent 在被拒绝后停下来等用户。
:::
