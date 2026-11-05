---
motto: 工具是写给模型的接口。它出错的方式，决定了模型能不能自己改正。
learn:
  - 一个工具由哪几部分组成，哪些是给模型看的，哪些是给程序和界面看的
  - 一个工具调用从“模型提出”到“结果交回”要经过的六道关
  - 参数校验为什么要“宽进严出”，错误信息为什么要写给模型看
  - 执行前拦截、执行后改写，以及它们为什么是权限系统的地基
  - 并行与串行、批次终止、执行进度：一批工具调用怎样被当成一个整体处理
  - 实战：给 mox 写 Tool 接口、execute 和 beforeTool / afterTool
prereq: 第 3 章
time: 60 分钟
build: 实战：给 mox 写 Tool 接口、execute 和 beforeTool/afterTool 两个钩子（mox/src/loop.ts）
---

第 3 章的循环里有一句“执行模型要的工具”，当时只当它是“找到工具，调用它，出错就变成错误结果”。这一章把它展开。生产级 Agent 在“执行一个工具”这件事上，要处理的远不止调用一个函数：参数写错了怎么办，有人想在执行前拦一下怎么办，三个工具能不能同时跑，耗时的工具怎么让界面看到进度。

先看一个现象：模型调用 `read_file`，把参数名写成了 `file`，还把数字 `20` 写成了字符串 `"20"`。Pi 会怎么处理？

@lab node labs/ch04/pi-validate.ts

第一次调用没有执行：校验失败，模型收到一份逐条列出问题的清单，下一次就改对了。更值得注意的是第二次：`limit` 仍然是 `"20"`，Pi 没有报错，工具函数收到的却已经是数字 20。这一章的前半部分，就是读懂这两种行为背后的设计。章末回到 mox，用几十行写出它的工具接口和钩子，再看没有这些设计的时候，同样的错误会变成什么。

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

## 校验：宽进严出

### 错误信息是写给模型看的

参数校验失败时，错误信息不是给开发者看的日志，而是**下一轮模型的输入**。它要回答模型的三个问题：哪个参数错了？错在哪？我实际发了什么？开头的实验里，Pi 的错误信息逐条列出路径和问题（`path: missing`、`file: unknown field`），最后附上收到的原始参数：

@pi packages/ai/src/utils/validation.ts#L54-L69 hl=58

高亮的第 58 行注释也值得注意：校验之前先**复制**一份参数。工具和钩子可能会修改参数，如果直接改了历史里那条工具调用，下一次请求的前缀就变了，提示缓存会失效（第 6 章），会话记录也和模型当时实际说的话对不上。

### 宽进：先修正明显无害的错误

开头实验的第二次调用里，模型把 `limit` 写成了字符串 `"20"`，Pi 却**没有**把它当成错误，工具函数收到的已经是数字 20。这是 Pi 刻意的设计。它的校验器开启了类型修正（`coerce: true`）：

@pi packages/ai/src/utils/validation.ts#L8-L18

注释里列出了模型最常犯的几类格式错误：把数字写成字符串、把单个值当成数组、给可选参数传 `null`。这些错误的意图毫无歧义，直接修正可以省掉一次来回；而 `"abc"` 不可能是整数，修不了的就严格报错。

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

@lab node labs/ch04/pi-hooks.ts

“真正执行过的命令”里没有第一条：被拦下的命令从未到达工具函数，模型看到的是拒绝的理由，结果带着 `isError`。第二条命令的输出里，密钥在模型看到之前就被替换了，模型的历史里永远不会出现原文，也就不会在后续回答里泄露它。

这两个钩子是后面好几章的地基：

- 第 13 章的 Hooks 扩展，把它们暴露成外部命令，兼容 Claude Code 的 `PreToolUse` / `PostToolUse` 协议；
- 第 14 章的权限系统，在 `beforeToolCall` 里按规则决定允许、询问还是拒绝；
- Pi 的扩展系统把它们包装成 `tool_call` 和 `tool_result` 事件（第 9 章）。

::: warn 用正则拦命令不是安全措施
第三条命令 `find / -delete` 就是证据：换一个写法，同样的破坏性操作就溜过去了。`rm -rf "/"`、`cd / && rm -rf .` 也都能绕开；第一条命令里无害的 `rm -rf build` 还跟着整条被拦下了。字符串匹配适合拦截“明显的误操作”，不适合抵御“有意的攻击”。真正的边界在操作系统层面（第 15 章）。
:::

### 嵌套的工具调用也要过同一条流水线

Pi 有一种工具会调用别的工具：`codemode` 让模型写一段 JavaScript，脚本里可以调用其他工具（第 15 章）。如果这些嵌套调用绕过了流水线，权限钩子就形同虚设——模型只要把危险操作包进脚本里就行。Pi 为此单独导出了一个函数，让嵌套调用走完全相同的步骤：

@pi packages/agent/src/agent-loop.ts#L812-L829

注释里说得很直白：工具调用工具时用它，**这样钩子（比如权限检查）同样适用于这些调用**。安全检查必须放在所有路径都会经过的地方，而不是“大多数路径”会经过的地方。

## 并行还是串行

第 2 章提到，模型可以在一条回复里请求多个工具。比如同时读三个文件。这些调用应该一个接一个执行，还是同时执行？

这个实验让模型一次请求三个工具，分别耗时 300、100、200 毫秒，并比较 Pi 的三种配置：

@lab node labs/ch04/pi-parallel.ts | md

默认情况下，三个工具同时执行，总耗时约等于最慢的那个（300 毫秒）。注意最后两列的区别：工具**完成**的顺序是 b → c → a（谁快谁先），但交给模型的结果**仍然按调用顺序**排列。界面可以按完成顺序实时显示进度，历史记录必须保持稳定的顺序。后两行里，全局设成 `sequential`，或者只要有一个工具声明了 `executionMode: 'sequential'`，整批都变成串行。

Pi 的并行执行有一个容易被忽略的细节：**准备阶段仍然是按顺序进行的**，只有执行阶段才并行：

@pi packages/agent/src/agent-loop.ts#executeToolCallsParallel collapse=true

::: steps 三个并行工具怎样完成、怎样交回
--- 模型一次请求了三个工具。**准备阶段按调用顺序逐个进行**：每个调用依次过校验和 `beforeToolCall`，因为权限钩子可能要弹窗，三个询问同时弹出会让用户分不清。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as 循环
  participant A as 工具 a（300ms）
  participant B as 工具 b（100ms）
  participant C as 工具 c（200ms）
  rect rgb(255, 230, 213)
    R->>R: prepare(a)，prepare(b)，prepare(c)
  end
--- 准备完成后，三个工具**同时开始执行**，每个执行都是一个还没有结束的 Promise，放进 `pending`。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant R as 循环
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
  participant R as 循环
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
  participant R as 循环
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
  participant R as 循环
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
  participant R as 循环
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

它先用 `realpath` 把路径解析到真实文件，这样通过符号链接或相对路径指向同一个文件的两次写入，也会被正确地排进同一个队列。第 5 章讲 Pi 的 `edit` 和 `write` 时会再看到它。

## 批次终止：工具能让运行提前结束

第 3 章的循环在“有工具结果”时总会再请求一次模型。但有些工具执行完，任务就已经完成了。比如一个 `submit` 工具把最终答案交给外部系统，这时再问一次模型纯属浪费。

工具可以在结果里设置 `terminate: true`，建议循环就此结束。规则是：**一批工具全部同意才结束**：

@lab node labs/ch04/pi-terminate.ts | md

只要批次里混着一个普通工具，它的结果模型还没看过，就必须再请求一次。Pi 的判断只有一行：

@pi packages/agent/src/agent-loop.ts#shouldTerminateToolBatch

`length > 0` 这个条件不是多余的：JavaScript 里空数组的 `every()` 返回 `true`，没有它，一个空批次会被误判为“全部同意终止”。

## 工具执行中的进度

最后一个细节：耗时的工具（运行测试、下载文件）可以在执行过程中报告部分输出。Pi 的 `execute` 接收一个 `onUpdate` 回调，每次调用都会发出一个 `tool_execution_update` 事件，界面据此实时显示命令输出。实验让 Pi 的 `bash` 工具跑一个每 0.3 秒打印一行的命令：

@lab node labs/ch04/pi-progress.ts | md

输出每来一行，界面就能刷新一次，不用等命令结束。对应的实现：

@pi packages/agent/src/agent-loop.ts#executePreparedToolCall

注意 `acceptingUpdates` 这个标记：工具返回之后再调用 `onUpdate` 会被忽略。否则一个写得不严谨的工具在返回之后仍然往界面推送内容，就会出现“结果已经显示完毕，进度却还在跳”的错乱。

## 实战：给 mox 加上工具接口和钩子

**目标**：在 `mox/src/loop.ts` 里写出工具调用的执行：一个 `Tool` 类型、一个 `execute` 函数，以及 `beforeTool` / `afterTool` 两个钩子。mox 只做最小可用版：参数只做 `JSON.parse`，工具一个接一个执行，结果只有一个字符串。Pi 的校验、并行、终止、进度，都留给后面的练习。

### 第一步：Tool 是一个 JSON Schema 加一个函数

对应 Pi 的 `AgentTool`（上面读过的 `types.ts`）。mox 把它压缩到只剩发给模型的三个字段，加一个 `run`：

@code mox/src/loop.ts#L4-L20 hl=4,16,17

第 4 行就是全部定义：`ToolSpec`（`name`、`description`、`parameters`，由 `runLoop` 原样发给模型）加一个 `run`。`run` 收到解析好的参数和取消信号，返回一个字符串。没有 `label`、`details`、`isError`、`executionMode`。第 16、17 行是两个钩子：`beforeTool` 返回字符串就拒绝，字符串是给模型看的理由；`afterTool` 返回字符串就替换结果。

### 第二步：execute，所有失败走同一个出口

对应 Pi 的 `prepareToolCall` 加 `executePreparedToolCall`。mox 把它们合成一个函数：

@code mox/src/loop.ts#execute hl=48,49,50,51,52,53,54,55,56,58,59

第 47 到 60 行是一个大 `try`。取消了、输出被截断了（第 3 章）、工具不存在、`JSON.parse` 失败、被钩子拒绝、工具函数抛异常，全部走到第 59 行：`result = 错误：${message}`。模型看到的永远是一条以“错误：”开头的文字，所以**异常信息本身就是写给模型的反馈**。`beforeTool` 在 `JSON.parse` 之后、`run` 之前，拿到的是解析好的参数对象，返回字符串就等于拒绝（第 54 行把理由包成异常，走同一个出口）；`afterTool` 只在 `run` 成功之后才调用，第 56 行的 `||` 让返回空字符串不替换结果。

::: tabs
@@ mox
@code mox/src/loop.ts#L44-L60
五步：找工具、`JSON.parse`、`beforeTool`、`run`、`afterTool`，其余全靠 `catch`。
@@ Pi
@pi packages/agent/src/agent-loop.ts#prepareToolCall
六道关：多了“修正”和“校验”，并且把“已经有结果”和“可以执行”分成两种返回类型。
:::

### 第三步：在 runLoop 里一个接一个执行

@code mox/src/loop.ts#L36-L37 hl=37

`for` 循环里 `await execute(...)`：上一个调用做完，下一个才开始，每个调用都必须有一条结果，否则下一次请求不合法（第 3 章）。结果按调用的顺序写进 `messages`。这是 mox 对“并行还是串行”的全部回答。

### 第四步：钩子接到哪里去

`runLoop` 不知道什么是“权限”或“扩展”，它只认这两个函数。接线在 `cli.ts` 里：

@code mox/src/cli.ts#L64-L75 hl=67,68,69,75

扩展先说话（第 9 章会详细读 `extensions.ts`）：拒绝就把理由返回，放行（`true`）就跳过向用户确认；都没意见，才轮到只读工具免确认、`--yolo` 和询问用户。`afterTool` 把结果交给扩展依次改写。子 Agent 也必须带上同一对钩子：

@code mox/src/cli.ts#L88-L94 hl=93

第 93 行把同一对 `beforeTool`、`afterTool` 传给子 Agent 的 `runLoop`。**这是 mox 保证权限检查不被绕过的全部手段**：每个调用 `runLoop` 的地方，都必须记得把钩子带上，漏掉一处，子 Agent 就能不经确认执行 `bash`。Pi 的做法是把这件事变成接口，上面读过的 `runToolCall`。

### 验证

`labs/ch04/practice.ts` 用脚本模型驱动你的 `runLoop`，逐项检查：

@lab node labs/ch04/practice.ts | md

默认检验课程自带的参考实现。想检验你自己写的，把 `MOX_DIR` 指向你的 mox 目录（目录里要有 `src/loop.ts`）：

```bash
MOX_DIR=~/my-mox node labs/ch04/practice.ts
```

### 和 Pi 比，mox 省掉了什么

最大的差别是 `JSON.parse` 之后什么都没有。这个实验用 mox 真实的 `read` 工具（第 5 章写），把两种常见错误交给 mox 原样、mox 加上本章末尾的参考校验、Pi：

@lab node labs/ch04/validate.ts

情形 A，参数名写错：mox 交给模型的是 Node 内部的一句 `EISDIR: illegal operation on a directory, read`。`path` 缺失时 `at()` 悄悄用了默认的 `'.'`，`read` 就去读了工作目录，报了一个和“参数名写错”毫无关系的错误。模型多半猜得出来（脚本里它第二次就改对了），但这是在赌。Pi 的信息是 `path: missing`。

**情形 B 才是真正的危险，因为没有任何报错。** `offset: "3", limit: "2"`，mox 的 `read` 成功返回了，内容却不对：本该读 2 行，读出了 6 行。`offset - 1 + limit` 里 `limit` 是字符串，`2 + "2"` 得到的是 `"22"`，切片一直读到末尾；`offset + count` 同样是字符串拼接，`"3" + 6` 得到 `"36"`，于是“后面还有”的提示也没了。字符串和数字混用在 JavaScript 里不报错，只是悄悄给出另一个答案。同一类错误碰到 `bash` 的 `timeout * 1000` 却无害（乘法会转数字），每个工具是否安全全凭它碰巧用了哪个运算符。

并行也一样。实验让三个工具分别耗时 300、100、200 毫秒，并排放上 mox、mox 加并行参考实现、Pi：

@lab node labs/ch04/parallel.ts | md

第一行是 mox：约 600 毫秒，完成顺序就是调用顺序。串行有真实的好处：任意两个工具不会同时运行，不用考虑两个 `bash` 写同一个文件，也不会同时弹出多个确认。代价是三次读文件要等三倍的时间。批次终止和执行进度，mox 都没有：每次带工具的一轮之后都多问一次模型，`Event` 里只有 `tool_start` 和 `tool_end`。

| | mox | Pi |
| --- | --- | --- |
| 参数 | `JSON.parse`，其余靠工具自己 | 修正 + 严格校验，错误信息写给模型看 |
| 执行 | 一个接一个 | 默认并行，可声明串行 |
| 结果 | 一个字符串，失败靠“错误：”前缀 | `content` + `details` + `isError` + `terminate` |
| 进度 | 没有 | `onUpdate` |
| 嵌套调用 | 靠调用者记得带上钩子 | 单独导出的函数，走同一条流水线 |

### 你来改

参考实现不在 `mox/` 里，在实验目录：

- `labs/ch04/validated.ts`：给工具的 `run` 包一层 `withValidation`，先修正（宽进）再按 JSON Schema 检查（严出），错误信息逐条列出问题并附上收到的原始参数。实验里的第二列就是它。它只认 `type`、`required`、`minimum`、`additionalProperties`，要支持完整的 JSON Schema，就该引入一个校验库。
- `labs/ch04/parallel-loop.ts`：`runLoop` 的一份拷贝，把 `execute` 拆成 `prepare`（找工具、解析、`beforeTool`）和 `settle`（`run`、`afterTool`），先依次 `prepare`，再 `Promise.all`。

读懂它们，然后做下面的预测题。

::: predict 把 withValidation 里的 coerce 去掉
把 `labs/ch04/validated.ts` 第 28 行的 `const fixed = coerce(value, prop);` 改成 `const fixed = value;`，再让模型发 `{ path: "notes.txt", offset: "3", limit: "2" }`。会发生什么？
???
`offset` 和 `limit` 都会被判定为类型不对，工具函数不会被调用，模型看到：

```text
read 的参数不合法：
  - offset: 应该是 number，收到 "3"
  - limit: 应该是 number，收到 "2"
```

后面还跟着收到的原始参数。模型会重试一次，请求多一次。对比有 `coerce` 的版本：同样的输入一次成功，省掉一个来回。这就是“宽进”换来的东西；代价是修正规则必须只做意图毫无歧义的转换。
:::

::: predict 把准备阶段也放进 Promise.all
在 `runLoopParallel` 里，把 `for (const call of calls) prepared.push(await prepare(...))` 改成 `Promise.all(calls.map(call => prepare(...)))`。如果 `beforeTool` 是一个要用户确认的函数（假设每次确认耗时 50ms），两个调用 a、b 的“询问”和“执行”顺序会怎样？
???
原来的顺序是：问 a → 答 a → 问 b → 答 b → 执行 a → 执行 b。改了之后，`beforeTool(a)` 开始等待的同时 `beforeTool(b)` 也开始了：问 a → 问 b → 答 a → 答 b。两个确认同时出现在终端上，用户看到两个“允许吗？”却分不清哪个是哪个；在 mox 的 `cli.ts` 里，第二个 `ask` 还会覆盖第一个保存的回调，第一个询问永远等不到回答。准备阶段必须按顺序，这不是性能问题，而是交互问题。
:::

::: predict afterTool 想把结果清空，返回了空字符串
在你的 `runLoop` 里，如果 `afterTool` 想“完全隐藏”输出，返回 `''`，模型会看到什么？
???
模型看到的还是原文。`execute` 里 `(await options.afterTool?.(...)) || result` 用 `||`，空字符串是假值，被当成“没有替换”。想隐藏内容，就返回一个占位文字，比如 `'（输出已隐藏）'`。这是 mox“返回字符串表示有话要说”的约定带来的一个小坑，Pi 的 `afterToolCall` 用的是显式的字段补丁，没有这个问题。
:::

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
