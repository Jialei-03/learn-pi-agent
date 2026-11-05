---
motto: 内核越小，扩展点就越要设计得像内核一样认真。
learn:
  - 说清楚 mox 扩展接口的五个入口（registerTool、registerCommand、addSystemPrompt、ask、on）各自落在 cli.ts 的哪里
  - 画出一次 `mox -p` 运行中，扩展入口被调用的真实顺序，包括 agent_end 续跑时系统提示重新取值
  - 说清楚三个分发函数：tool_call 拒绝优先（字符串拒绝、true 放行）、tool_result 接力改写、agent_end 第一个返回字符串的说了算，以及它们和 Pi 的规则有什么异同
  - 扩展出错时：tool_call 默认拒绝，agent_end 和 shutdown 却不隔离；扩展为什么是信任边界，--trust 防住了什么
  - 写第一个扩展：给 mox 加上 web_fetch，并处理 SSRF
prereq: 第 4、6 章
time: 70 分钟
build: mox/src/extensions.ts（mox 的扩展系统，约 50 行）与 extensions/web-fetch（Pi 和 mox 共用核心逻辑的 web_fetch 扩展）
---

第 0 章说过，Pi 刻意把内核做得很小，子 Agent、Plan Mode、权限规则这些功能都留给扩展。mox 把这个想法推到更小：整个扩展系统约 50 行，一个文件。从这一章开始，课程的“Extend”线正式开始：我们要用扩展补上内核没有的能力。动手之前，先把扩展系统本身读透。

这一章分两半。前半读 mox 的 50 行：扩展能注册什么，处理函数按什么顺序被调用，几个扩展争同一个事件时谁说了算，出了错会怎样。后半对照 Pi 的扩展系统（事件多了十倍，规则更细），再动手写第一个扩展 `web_fetch`，用 `mox -e extensions/web-fetch/mox.ts` 装进 mox。

## mox 的扩展：一个函数，五个入口

mox 的扩展是一个模块，默认导出一个函数。命令行启动时调用它，把一个 `mox` 对象交给它。这个对象的类型就是整个扩展接口：

@code mox/src/extensions.ts#ExtensionApi hl=10-13,17

五个入口分成两类：

| 入口 | 作用 | 落在哪里 |
| --- | --- | --- |
| `registerTool(tool)` | 给模型多一个工具；和已有工具**同名就替换** | 宿主传进来的 `tools` 数组 |
| `registerCommand(name, run)` | 交互模式里多一个 `/name` 命令 | `cli.ts` 的输入循环 |
| `addSystemPrompt(() => text)` | 系统提示末尾追加一段，每次运行前重新取值 | `cli.ts` 的 `system()` |
| `ask(question, choices)` | 让用户从几个选项里选一个；没有终端时返回 `undefined` | 宿主传进来的函数 |
| `on(event, handler)` | 订阅 `tool_call`、`tool_result`、`agent_end`、`shutdown` 四个事件 | `cli.ts` 的循环选项 |

前四个是“给 Agent 加东西”，最后一个是“在 Agent 干活的路上插一脚”。看实现，注册只是往几个数组里 push：

@code mox/src/extensions.ts#loadExtensions hl=32-36,41

第 32～36 行是 `registerTool`：在宿主的 `tools` 数组里按名字找，找不到就追加，找到了就**原地换掉**。第 41 行依次加载每个扩展，一个跑完才轮到下一个。同名替换的用处是“包一层”：拿到原来的 `bash`，加上超时、沙箱或日志再注册回去，模型看到的仍是一个叫 `bash` 的工具。这个实验把五个入口都用一遍：

@lab node labs/ch09/api.ts

`bash` 只有一个，排在原来的位置，结果前面多了扩展加的那句话；`now` 追加在末尾。`/danger` 命令里调用的 `mox.ask` 直接转给宿主，实验里的宿主选了第二个选项，命令返回了“取消”。系统提示片段每调用一次函数就重新计算一次：这一点值得下一节看清楚，因为 `cli.ts` 调用它的次数比你想的多。

## 一次运行中的事件顺序

下面这个实验启动的是真正的 `mox` 命令行（`mox/src/cli.ts`），只是模型换成了本地的假服务（`labs/shared/mox-cli.ts` 的 `runMox`，起一个会照剧本说话的 Chat Completions 服务）。一个追踪扩展把自己的每个入口被调用的时刻写进日志，假服务收到请求时也写一行，两边同步追加，日志的先后就是真实的先后：

@lab node labs/ch09/order.ts

模型第一次回复里有两个工具调用（`read` 和扩展注册的 `now`），之后回答一句话；扩展在第一次 `agent_end` 返回了一句新的话，命令行又跑了一轮。对着 `cli.ts` 的代码，每一行日志都找得到出处。先看工具调用的这一段：

@code mox/src/cli.ts#L64-L75 hl=67-69,75

`tool_call` 事件在 `beforeTool` 的**第一行**触发（67 行）。`extensions.verdict` 把每个扩展都问一遍（下一节细读）：只要有一个返回字符串，就是拒绝，那是给模型看的理由，后面的“问用户”根本不会发生（68 行）；扩展返回 `true` 就是放行，同样跳过 `--yolo`、白名单和 `ask` 三选一（69 行）；扩展没意见（什么都不返回），才轮到内置的确认。`tool_result` 在 75 行，是工具成功执行之后、结果交回模型之前，由 `extensions.transform` 让各个扩展依次改写。再看一次运行怎样开始、怎样续跑：

@code mox/src/cli.ts#L108-L132 hl=109,111,125-131

109 行：`system: system()` 在**每次调用 `runLoop` 之前**求值一次，结果固定在这次运行里。`system()` 就是 62 行那个把基础提示和所有 `addSystemPrompt` 片段拼起来的函数。125～131 行是 `while (text)`：`runLoop` 返回最终回答之后触发 `agent_end`，处理函数返回一句话，就把它当成新的用户消息再跑一轮；那一轮开头又会调用一次 `options()`，系统提示重新取值。

这就解释了日志里两个现象。一是 `addSystemPrompt` 的函数在第一次请求之前被取了两次，因为 `compact: messages => maybeCompact(messages)`（111 行）在**每次请求之前**要估算系统提示的大小，又调用一次 `system()`；真正发给模型的是 109 行取的那一份，所以第 1、2 次请求带的是同一个版本，第二轮运行才拿到新的。二是写 `addSystemPrompt` 的函数要便宜、可以重复调用：它不是“每次运行调用一次”，而是“每次运行至少一次”。

::: steps 一次运行里，cli.ts 怎样调用扩展
--- 命令行启动，`loadExtensions` 按顺序调用每个扩展函数。扩展在这里注册工具、命令、系统提示片段和事件处理器。这一步只发生一次。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  rect rgb(255, 230, 213)
    U->>X: 依次调用扩展函数
    Note over X: registerTool / on /<br/>addSystemPrompt
  end
--- `run(input)` 开始一次运行：`options()` 调用 `system()`，把每个 `addSystemPrompt` 的函数调用一遍，拼成这次运行固定的系统提示，交给 `runLoop`。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  U->>X: 依次调用扩展函数
  Note over X: registerTool / on /<br/>addSystemPrompt
  rect rgb(255, 230, 213)
    U->>X: system()：取各片段
    U->>L: runLoop(messages, options)
  end
--- 循环请求模型。每次请求之前，`compact` 回调会再调用一次 `system()` 估算大小。模型回复里有工具调用。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  U->>X: 依次调用扩展函数
  U->>X: system()：取各片段
  U->>L: runLoop(messages, options)
  rect rgb(255, 230, 213)
    L->>M: 请求 1
    M-->>L: read、now 两个调用
  end
--- 工具调用**依次**执行。每个调用：先 `tool_call`（扩展有理由就拒绝），再执行，成功才触发 `tool_result`（扩展可以换掉结果）。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  U->>L: runLoop(messages, options)
  L->>M: 请求 1
  M-->>L: read、now 两个调用
  rect rgb(255, 230, 213)
    L->>X: tool_call(read)
    L->>X: tool_result(read)
    L->>X: tool_call(now)
    L->>X: tool_result(now)
  end
--- 结果交回模型，请求 2。模型这次只回答文字，没有工具调用，`runLoop` 返回最终回答。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  L->>X: tool_result(now)
  rect rgb(255, 230, 213)
    L->>M: 请求 2
    M-->>L: 文字回答
    L-->>U: 最终回答
  end
--- `cli.ts` 触发 `agent_end`，把最终回答交给扩展。扩展返回了一句话，于是 `while (text)` 把它当作新的用户消息，再进一次循环：`system()` 重新取值，系统提示可以变。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  L-->>U: 最终回答
  rect rgb(255, 230, 213)
    U->>X: agent_end(最终回答)
    X-->>U: 「再确认一下 README…」
    U->>X: system()：重新取值
    U->>L: 再跑一轮 runLoop
  end
--- 第二轮结束，`agent_end` 这次没有返回字符串，`while` 退出，一次运行结束。进程退出时才触发 `shutdown`。
%%{init: {"sequence":{"width":120,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":26,"noteMargin":6}}}%%
sequenceDiagram
  participant U as cli.ts
  participant X as 扩展
  participant L as runLoop
  participant M as 模型
  U->>X: 再跑一轮 runLoop
  rect rgb(255, 230, 213)
    L-->>U: 最终回答
    U->>X: agent_end → 返回空
    U->>X: shutdown
  end
:::

四个事件和第 3、4 章的循环一一对应：`tool_call` 是 `beforeTool`，`tool_result` 是 `afterTool`（第 4 章），`agent_end` 是循环外面套的那层 `while`，`shutdown` 在 `exit` 里。mox 没有“用户输入”“消息形成”“每次请求前”这些事件，因为它们要么不需要（输入就是你敲的那一行），要么有别的入口：想改每次请求的内容，就用 `addSystemPrompt`。

## 组合规则：三个事件，三种合并方式

多个扩展订阅同一个事件，按**加载顺序、再按注册顺序**依次调用。谁的返回值算数？`loadExtensions` 末尾有三个分发函数，每个事件用哪一个，取决于它的性质：

@code mox/src/extensions.ts#L43-L68 hl=46-47,54-58,63-66

- **`emit`（46～47 行）：第一个说了算。** 遍历处理函数，返回值是真值就立刻返回，后面的不再被调用。`agent_end` 走这一条，`cli.ts` 用 50 行的 `text` 只留下字符串。一次只能续跑一句话，所以只能有一个扩展说了算。
- **`verdict`（54～58 行）：拒绝优先。** 给 `tool_call` 专用：**每个扩展都会被问到**，只要有一个返回非空字符串，就立刻拒绝（字符串是给模型看的理由）；没有人拒绝、而有人返回了 `true`，才放行并跳过内置的用户确认；都没意见（`undefined`），落回内置确认。
- **`transform`（63～66 行）：接力。** 给 `tool_result` 专用：每个扩展拿到的是**上一个扩展改过的结果**，返回字符串就替换，没返回就保持原样。

| 事件 | 返回值的含义 | 多个扩展时 |
| --- | --- | --- |
| `tool_call` | **字符串**：拒绝，字符串是给模型的理由。**`true`**：放行，跳过内置的用户确认 | 每个扩展都被问到，**拒绝优先**；拒绝来自第一个返回字符串的扩展，排在它后面的不再被问 |
| `tool_result` | 字符串：用它替换工具结果 | **接力**：后一个扩展收到前一个改过的结果，最后的结果交给模型 |
| `agent_end` | 字符串：当作新的用户消息，让 Agent 接着干 | 第一个返回字符串的说了算，只有一个扩展能续跑 |

没有返回值（`undefined`、空字符串）就是“没意见”。就地修改参数不用返回值：`tool_call` 收到的 `args` 就是后面 `tool.run(args)` 要用的**同一个对象**（`loop.ts` 里 `beforeTool` 和 `run` 用的是同一个变量），改它就生效。

为什么 `tool_call` 要拒绝优先？因为它是安全的闸门。如果是“第一个放行的说了算”，一个排在前面、返回 `true` 的权限扩展就会让后面的拦截扩展（沙箱、计划模式、域名检查）根本收不到这次调用，**安全取决于文件名的先后**。拒绝优先让放行只在没人反对时才生效，加载顺序不影响结果。这也是 Claude Code 钩子的合并规则：多个 PreToolUse 钩子意见不同时，`deny` 优先于 `ask`，`ask` 优先于 `allow`（第 13 章）。为什么 `tool_result` 要接力？因为脱敏、加注释、截断这些改写是可以叠加的，没有理由让其中一个把别的挡住。

这个实验用同一组扩展分别跑 Pi 和 mox，A 把 `npm` 改成 `pnpm`；B 拦下含 `publish` 的命令；C 在结果末尾加一句话；D 把令牌 `ghp_…` 隐去；E 处理 `deploy` 时抛异常。mox 跑两遍，一遍 C 先加载，一遍 D 先加载：

@code labs/ch09/composition.ts#region:mox-extensions

@lab node labs/ch09/composition.ts

逐行看：

- **就地修改。** 三列执行的都是 `pnpm test`，而会话里记下的模型调用仍是 `npm test`：改的是解析出来的参数对象，不是模型发出的原始 JSON。模型并不知道命令被改了，如果改动会影响它理解结果，扩展应该在结果里说明。
- **闸门。** `npm publish` 被 B 拦下，工具没有执行。mox 的结果多了“错误：”前缀，因为拒绝理由在 `loop.ts` 里被当成异常消息（第 4 章）。
- **接力。** 第一行三列完全一样：D 收到 C 改过的结果，令牌被遮盖，C 的话也保留；C、D 谁先加载都一样。mox 最初的实现里 `tool_result` 和 `agent_end` 共用 `emit`，这个实验跑出来的是另一个样子：C 先加载时，C 一返回，D 就没有被调用，令牌 `ghp_abcdef123456` 原样交给了模型。这个现象促成了 `transform`：脱敏扩展不该被排在它前面的扩展挡住。
- **出错。** E 抛异常，`deploy` 都没有执行，两个宿主一致。

接力解决了“被挡住”，但没有让顺序完全无关：排在前面的扩展看到原始结果，排在后面的看到改过的结果。一个想把工具输出写进审计日志的扩展，排在脱敏扩展前面就会记下令牌，排在后面才干净。

::: steps 五个扩展怎样处理三次工具调用（mox，C 先加载）
--- 第一个调用 `shell("npm test")`。`tool_call` 先到 A：它**就地修改** `args.command`，`npm` 换成 `pnpm`，没有返回值，轮到下一个。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::on --> B["B 闸门<br/>拦 publish"]:::dim --> E["E 处理 deploy"]:::dim
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::dim --> C["C 追加一句"]:::dim --> D["D 隐去令牌"]:::dim --> R["交给模型"]:::dim
  end
  P1 --> P2
--- B 检查命令里有没有 `publish`，没有，返回空；E 只管 `deploy`，也返回空。三个处理函数都没有意见，工具开始执行：真正运行的是 `pnpm test`。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::done --> B["B 闸门<br/>拦 publish"]:::done --> E["E 处理 deploy"]:::done
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::on --> C["C 追加一句"]:::dim --> D["D 隐去令牌"]:::dim --> R["交给模型"]:::dim
  end
  P1 --> P2
--- 执行成功，`afterTool` 调用 `transform`，让扩展依次改写结果。C 先加载，它返回了“原结果 + C 看过了”。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::done --> B["B 闸门<br/>拦 publish"]:::done --> E["E 处理 deploy"]:::done
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::done --> C["C 追加一句"]:::on --> D["D 隐去令牌"]:::dim --> R["交给模型"]:::dim
  end
  P1 --> P2
--- `transform` 把 C 改过的结果交给 D（接力）。D 把令牌 `ghp_abcdef123456` 换成 `ghp_***`，最终交给模型的结果里既有 C 的话，也没有令牌。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::done --> B["B 闸门<br/>拦 publish"]:::done --> E["E 处理 deploy"]:::done
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::done --> C["C 追加一句"]:::done --> D["D 隐去令牌"]:::on --> R["交给模型：令牌已隐去"]:::on
  end
  P1 --> P2
--- 第二个调用 `shell("npm publish")`：A 照样改成 `pnpm publish`，B 发现含 `publish`，返回理由。`beforeTool` 抛出这个理由，工具不执行，E 也不会被问。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::done --> B["B 闸门<br/>拦 publish"]:::on -.->|返回理由| E["E 处理 deploy"]:::dim
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::dim --> C["C 追加一句"]:::dim --> D["D 隐去令牌"]:::dim --> R["错误结果交给模型"]:::on
  end
  P1 --> P2
--- 第三个调用 `deploy`：A、B 都没意见，E 抛了异常。异常传进 `execute` 的 `try`，变成一条错误结果，`deploy` 没有执行：出错时默认拒绝。
flowchart TB
  subgraph P1["tool_call：执行之前"]
    direction LR
    A["A 就地改写<br/>npm → pnpm"]:::done --> B["B 闸门<br/>拦 publish"]:::done --> E["E 处理 deploy<br/>抛异常"]:::on
  end
  subgraph P2["执行与 tool_result"]
    direction LR
    X["执行工具"]:::dim --> C["C 追加一句"]:::dim --> D["D 隐去令牌"]:::dim --> R["错误结果交给模型"]:::on
  end
  P1 --> P2
:::

下面是两个宿主的分发代码并排：

::: tabs
@@ mox
@code mox/src/extensions.ts#L43-L68
三个分发函数：`emit` 第一个说了算，`verdict` 拒绝优先，`transform` 接力。都没有 `try/catch`。
@@ Pi
@pi packages/coding-agent/src/core/extensions/runner.ts#emitToolCall
`tool_call` 同样按顺序调用，遇到第一个 `block` 立即返回；`tool_result`、`input` 这类事件是链式的，和 mox 的 `transform` 一致。
:::

### 放行也是一个结论：tool_call 返回 true

`cli.ts` 的权限流程是“先问扩展，再问用户”（67～69 行）。如果扩展只能拒绝，一个按规则放行的权限扩展就很尴尬：它认定 `echo` 开头的命令是安全的，可内置确认还是会再弹一次，用户被问了两遍。所以 `tool_call` 多了一个返回值：**`true` 表示放行，并且跳过内置的确认**。这个实验用真正的命令行，不加 `--yolo`、没有终端（此时内置确认一律拒绝），把同一条命令交给不同的扩展组合：

@code labs/ch09/allow.ts#region:extensions

@lab node labs/ch09/allow.ts

- **第 1 行**：没有扩展，内置确认在没有终端时直接拒绝，报错里提示加 `--yolo`。
- **第 2、3 行**：`allow-echo` 对 `echo hi` 返回 `true`，命令执行了；对 `ls` 没有意见（返回 `undefined`），落回内置确认，被拒绝。扩展只管自己有把握的那一部分。
- **第 4、5 行**：同样两个扩展，加载顺序相反，结果一样：`deny-all` 拒绝，`allow-echo` 的放行不起作用。`verdict` 把两个扩展都问了一遍，拒绝优先，安全不取决于谁先加载。

`tool_call` 这样设计，让规则式的权限扩展可以放心地返回 `true`，不必担心把后面的拦截扩展短路。第 14 章写权限扩展时会用到这一点。

### 出错时：哪些事件默认拒绝，哪些会拖垮运行

E 抛的异常没有被 `emit` 捕获。要知道它去了哪里，得看是谁调用的 `emit`。这个实验让一个扩展分别在三个事件里抛异常，用真正的命令行跑一次 `mox -p`：

@lab node labs/ch09/errors.ts

- **`tool_call`：拒绝。** 异常从 `beforeTool` 传进 `loop.ts` 的 `execute`，那里有一个 `try/catch`，把任何异常变成“错误：……”形式的工具结果。`read` 没有执行，模型看到了错误，运行继续，退出码 0。负责安全检查的扩展自己出了 bug，结果是“不放行”：fail closed。
- **`agent_end`：运行失败。** 它在 `cli.ts` 的 `run` 里，异常被最外层的 `catch` 接住，打印出来，`run` 返回 `false`，`-p` 的退出码是 1。模型的回答已经输出了，但一个只想做记录的扩展出了错，整次运行被判定为失败。
- **`shutdown`：进程崩溃。** `exit` 里写的是 `void extensions.emit('shutdown')`，没人等它，也没人 `catch`，异常变成 Node 的未处理拒绝，命令行带着堆栈退出。

mox 没有做错误隔离，Pi 做了。Pi 分发通知类事件的代码把每个处理函数包在 `try/catch` 里，出错只记录、不中断；而 `tool_call` 的分发**没有** `try/catch`，异常一路传到工具流水线，变成一条错误结果：

@pi packages/coding-agent/src/core/extensions/runner.ts#L1096-L1126

连接扩展系统和工具流水线的代码把这个意图写得很清楚：

@pi packages/coding-agent/src/core/agent-session.ts#L674-L697

“扩展出错，拦下执行”。一个负责安全检查的扩展出了 bug，最安全的做法是把它当成“拒绝”；而一个只显示状态栏的扩展出错，不应该影响 Agent 干活。Pi 把前者做成拒绝、后者做成隔离。mox 的 `tool_call` 碰巧也是拒绝（因为 `execute` 有 `try`），但通知类事件没有隔离。所以在 mox 里，`agent_end` 和 `shutdown` 的处理函数要自己 `try/catch`：

```ts
mox.on('agent_end', async answer => {
  try { await 记录(answer); } catch (e) { console.error('记录失败', e); }   // 记录失败不应该让整次运行失败
});
```

## 对照 Pi：事件多了十倍，规则更细

读完 mox 的这 50 行，再看 Pi 的扩展系统，会发现两者是同一个思路，只是 Pi 在每个点上都多走了几步。

### 同一个扩展，两种写法

Pi 官方的权限拦截示例是一个完整的扩展：

@pi packages/coding-agent/examples/extensions/permission-gate.ts

二十几行代码，给 Pi 加上了“危险命令要确认”的能力：`pi.on("tool_call", …)` 订阅工具调用事件，返回 `{ block: true, reason }` 拦下这次调用，`ctx.ui.select` 弹出选择框，`ctx.hasUI` 判断当前有没有界面（`--print` 模式下没有），没有界面时直接拒绝。写成 mox 扩展是这样：

@code labs/ch09/api.ts#region:gate

几处对应关系：`{ block: true, reason }` 变成直接返回理由字符串；`ctx.ui.select` 变成 `mox.ask`；`ctx.hasUI` 不需要了，因为没有终端时 `ask` 返回 `undefined`，落到“没有批准”的分支。实验最后一行显示，危险命令被拒绝了、`ls` 放行，宿主收到的就是扩展提的那个问题。

### 扩展能做的远不止拦截

Pi 的 `ExtensionAPI` 大致分为几类，对照 mox 的五个入口：

| 类别 | Pi 的方法 | mox 里的对应 |
| --- | --- | --- |
| 订阅事件 | `pi.on(event, handler)`：四十多种事件，覆盖输入、请求、工具、会话、压缩…… | `on`：四个事件 |
| 注册能力 | `registerTool`、`registerCommand`、`registerShortcut`、`registerFlag`、`registerProvider`、`registerMcpServer` | `registerTool`、`registerCommand` |
| 操作会话 | `sendMessage`、`sendUserMessage`、`appendEntry`、`setLabel`：往对话里插入消息、在会话文件里保存扩展自己的状态 | 没有；`agent_end` 返回字符串是唯一的“说话”入口 |
| 控制运行 | `setActiveTools`、`setModel`、`setThinkingLevel`、`exec` | 没有 |
| 界面 | `ctx.ui.*`、渲染器：对话框、状态栏、自定义消息的显示方式 | `ask`（只有选择题） |

Pi 的 `examples/extensions/` 目录里有七十多个示例，从贪吃蛇游戏到子 Agent，覆盖了几乎所有 API。扩展文件里的 `import "@earendil-works/pi-coding-agent"` 也不需要自己安装依赖：Pi 用 jiti 直接加载 TypeScript 源文件，并把这些包名映射到 Pi 进程里已经加载好的模块实例上：

@pi packages/coding-agent/src/core/extensions/virtual-modules.ts#L14-L42

这样扩展和 Pi 用的是**同一份**模块实例，类型、单例、全局状态都一致。注意末尾的 `@mariozechner/...`：那是 Pi 早期发布时用的包名，为了让老扩展继续能用，至今保留着别名。mox 的扩展没有这个问题，它只 `import type` 一个类型，运行时不依赖 mox 的任何模块。

### Pi 一次运行里的事件

mox 的四个事件分布在循环的几个点上。Pi 的事件分布在**每个阶段**。这个实验装上一个只记录事件名的 Pi 扩展，让 Pi 执行同样形状的运行（一次工具调用，一次文字回答）：

@lab node labs/ch09/events.ts

每个事件都能在前几章找到位置：

- `input`、`before_agent_start`：用户输入交给循环之前，可以改写输入、改写本次的系统提示。mox 里对应的只有 `addSystemPrompt`（改系统提示），没有改输入的入口。
- `agent_start` 到 `agent_end`：第 3 章的 `runLoop` 一次运行；中间每一轮是一对 `turn_start` / `turn_end`。
- `context`：每次请求模型之前，可以改写这次发送的消息（第 6 章说的“投影”）。mox 没有。
- `tool_execution_start` → `tool_call` → `tool_result` → `tool_execution_end`：第 4 章工具流水线的执行前钩子和执行后钩子。mox 的 `tool_call`、`tool_result` 对应中间两个。
- `message_start` / `message_end`：每条消息形成时；第 7 章的会话就是在 `message_end` 时写盘的。
- `agent_before_settle`、`agent_settled`：运行真正结束之前的最后一个决策点（第 18 章的“目标循环”会用到它），以及真正空闲下来的时刻。mox 的 `agent_end` 同时扮演了 `agent_end` 和 `agent_before_settle` 的角色：它返回字符串就等于“还不能结束”。

这样对照下来，mox 的四个事件映射到 Pi 是：`tool_call` → `tool_call`，`tool_result` → `tool_result`，`agent_end` → `agent_before_settle`（不是 Pi 的 `agent_end`），`shutdown` → `session_shutdown`。

### 返回值的四种模式

Pi 的文档把事件的返回值归纳成四种模式，mox 只有最后一种的变体：

| 模式 | 规则 | 典型事件 | mox |
| --- | --- | --- | --- |
| 通知 | 返回值被忽略，错误被隔离 | `agent_start`、`turn_start`、`message_update` | `shutdown`，但不隔离错误 |
| 就地修改 | 后面的处理函数看到前面改过的值 | `tool_call.input`、`before_agent_start` 的提示选项 | `tool_call` 的 `args`，一样 |
| 链式变换 | 后面的处理函数收到前面返回的结果 | `input`、`context`、`tool_result`、`message_end` | `tool_result`：`transform` 接力；`agent_end` 是第一个返回字符串的说了算 |
| 闸门 | 一旦有处理函数拦下，后面的不再执行，操作本身也不再发生 | 拦下工具调用、取消压缩、接管输入 | `tool_call`：拒绝优先，放行用 `true` |

Pi 在每个点上多走的几步，换来的是扩展之间更少的相互干扰（链式让脱敏和注释各写各的），代价是接口更大、要学的东西更多。mox 选了另一头：规则一句话说得清，扩展之间的配合靠使用者自己排顺序。

## 扩展是信任边界

扩展运行在 Agent 进程里，拥有和 Agent 完全相同的权限：读写任意文件、执行任意命令、访问网络、读取你的 API Key。mox 的扩展就是 `import()` 一个 `.ts` 文件然后调用它的默认导出，没有任何隔离。所以“从哪里加载”就是全部的安全策略。

@code mox/src/cli.ts#L36-L38

@code mox/src/cli.ts#L59-L60

`configDirs` 里有 `~/.mox`，**只有**加了 `--trust` 才多一个 `<项目>/.mox`。扩展文件的加载顺序由 59 行决定：先是各配置目录下 `extensions/` 里的文件（用户目录在前，项目目录在后，目录内按文件名排序），最后是命令行 `-e` 指定的，可以写多次。这个实验用真正的命令行验证：

@lab node labs/ch09/load.ts

不加 `--trust` 时，项目里的扩展根本没有被加载，它想写的文件没有出现。加了 `--trust`，项目里的扩展在你的机器上运行了：这就是为什么 README 说“项目里的 `.mox/` 可能是别人写的代码”。第三列还显示了加载顺序也是 `tool_call` 的调用顺序：用户目录先于项目目录先于 `-e`，按上一节的规则，前面的扩展先被问到，前面扩展的拒绝，会让排在后面的扩展收不到这次调用。

顺序还有一层后果：`registerTool` 的同名替换也按这个顺序生效，后加载的覆盖先加载的。一个项目扩展（`--trust` 之后）如果也注册了 `bash`，它会悄悄盖掉你用户目录里给 `bash` 套的沙箱。`--trust` 的含义因此是“把这个项目当成和你自己的代码一样可信”。

Pi 的做法是同一个策略，但更细：

| 位置 | 范围 | 何时加载 |
| --- | --- | --- |
| `~/.pi/agent/extensions/` | 所有项目 | 总是 |
| 项目里的 `.pi/extensions/` | 当前项目 | **项目被信任之后** |
| `settings.json` 里的 `packages` | npm 或 git 上的 Pi 包 | 按配置 |
| `pi -e ./ext.ts` | 本次运行 | 命令行指定时 |

Pi 在加载项目资源之前，会先询问是否信任这个目录（`project_trust` 事件、`/trust` 命令），而不是靠一个命令行开关。但第 6 章已经说过，信任机制能防住的是“在你不知情的情况下执行项目里的代码”，防不住“你信任了一个本身就有问题的项目”，也防不住模型被项目文件里的文字诱导去做坏事。

## 第一个扩展：web_fetch

mox 和 Pi 一样没有内置的网页抓取工具。查阅最新的文档、看一个报错在网上怎么解决、读一个 issue，都需要它。这是我们写的第一个扩展。

核心逻辑放在一个与宿主无关的文件里，Pi 版本和 mox 版本共用：

@code extensions/web-fetch/fetch.ts#webFetch

两个宿主的扩展都只做两件事：注册工具，并在 `tool_call` 上做同样的检查，让被拒绝的调用在执行之前就被拦下：

::: tabs
@@ mox
@code extensions/web-fetch/mox.ts#region:register
注册工具：`run` 就是 mox 的 `Tool.run(args, signal)`。
@code extensions/web-fetch/mox.ts#region:guard
`tool_call` 上的检查：`checkUrl` 返回拒绝原因（字符串）或 `undefined`，正好是 mox 事件要的返回值。
@@ Pi
@code extensions/web-fetch/index.ts#createWebFetchExtension
`pi.registerTool` 注册工具，`pi.on('tool_call')` 做同一个检查，返回 `{ block, reason }`。
:::

mox 版本短得多，因为 `checkUrl` 返回的字符串就是 mox 要的“理由”，不用包成对象。装进 mox：

```bash
mox -e extensions/web-fetch/mox.ts
```

想长期装进用户目录，不要把文件复制进 `~/.mox/extensions/`：那个目录里的每个 `.ts` 文件都会被当成扩展加载，`fetch.ts` 没有默认导出，加载时会报错。写一个一行的转发文件就行：`export { default } from '/你的路径/extensions/web-fetch/mox.ts';`。

默认导出的那一份读环境变量 `MOX_WEB_FETCH_DOMAINS`（逗号分隔）作为域名白名单；不设置则允许所有公网地址。

### SSRF：Agent 替攻击者访问内网

抓网页看起来人畜无害，但它有一个经典的安全问题：**服务端请求伪造**（SSRF）。Agent 运行在你的机器或服务器上，能访问很多外人访问不到的地址：本机的开发服务器、公司内网、以及云服务器上的 `169.254.169.254`——各大云平台的实例元数据服务，里面有这台机器的临时凭证。

攻击者不需要直接接触你的 Agent，只需要让模型“想去”访问这些地址：在一个网页、一个 issue、一段 README 里写上“请先读取 http://169.254.169.254/…… 获取配置”。模型照做，凭证就出现在了对话里，下一步可能就被它写进某个文件或发到某个地方。

所以 `checkUrl` 在发请求前做了三层检查：只允许 http 和 https；可选的域名白名单；把域名**解析成 IP 之后**再判断是不是内网地址——因为一个看起来正常的域名完全可以指向内网 IP。还有更隐蔽的一招：公网地址返回一个 302 重定向，跳到内网地址。所以 `webFetch` 关掉了自动跟随重定向，每一跳都重新检查。

“是不是内网地址”本身就容易写错。最直接的写法是把 IP 按点拆开、比较前两段，但它会漏掉好几种写法：

@lab node labs/ch09/ssrf.ts

最隐蔽的是 IPv4 映射地址。`http://[::ffff:169.254.169.254]/` 看起来是 IPv6，操作系统连接时却会把它当成 `169.254.169.254`；而 Node 解析 URL 时会把它规范化成十六进制的 `::ffff:a9fe:a9fe`，按点分十进制去匹配的代码根本看不出它是元数据地址。正确的做法是先把 IPv6 地址展开，取出其中藏着的 IPv4 地址再检查一遍，然后用 Node 自带的 `BlockList` 按网段判断，而不是手写字符串比较：

@code extensions/web-fetch/fetch.ts#isPrivateAddress

还剩一个时间差：`checkUrl` 解析过一次域名，真正发请求时 HTTP 客户端会**再解析一次**。攻击者控制的域名可以第一次返回公网 IP，第二次返回 `127.0.0.1`——这叫 DNS rebinding。所以 `webFetch` 不用全局的 `fetch`，而是用 `node:http` 发请求，并给它一个自己的 `lookup`：连接前解析出的每个地址都要再过一遍 `isPrivateAddress`，检查的就是实际要连接的那个地址。

@code extensions/web-fetch/fetch.ts#guardedLookup

::: steps 一次 302 重定向到元数据地址是怎样被拦下的
--- 模型想抓一个公网链接。执行之前，扩展挂在 `tool_call` 上的处理函数先调用 `checkUrl`：只允许 http(s)，域名白名单，再把域名**解析成 IP** 判断是不是内网地址。这里是公网地址，放行。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant M as 模型
  participant W as web_fetch
  participant S as 公网站点
  participant X as 内网 169.254.169.254
  rect rgb(255, 230, 213)
    M->>W: web_fetch(公网/redirect)
    Note over W: tool_call → checkUrl：公网，放行
  end
--- `webFetch` 开头再检查一次，然后发请求。请求用的是自己的 `lookup`（`guardedLookup`）：连接前解析出的每个地址都要再过 `isPrivateAddress`，防止 DNS rebinding。这次仍是公网，连接成功。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant M as 模型
  participant W as web_fetch
  participant S as 公网站点
  participant X as 内网 169.254.169.254
  M->>W: web_fetch(公网/redirect)
  Note over W: tool_call → checkUrl：公网，放行
  rect rgb(255, 230, 213)
    W->>S: GET /redirect
    Note over W: guardedLookup：公网，放行
  end
--- 站点回了一个 302，`Location` 指向云实例元数据地址。`get` 不自动跟随重定向，只把响应交回来。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant M as 模型
  participant W as web_fetch
  participant S as 公网站点
  participant X as 内网 169.254.169.254
  M->>W: web_fetch(公网/redirect)
  Note over W: tool_call → checkUrl：公网，放行
  W->>S: GET /redirect
  Note over W: guardedLookup：公网，放行
  rect rgb(255, 230, 213)
    S-->>W: 302 Location: http://169.254.169.254/…
  end
--- `webFetch` 取出新地址，**对它重新调用 `checkUrl`**：解析出的 IP 落在 `BLOCKED` 的 169.254.0.0/16 里，返回拒绝原因。每一跳都要重新检查。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant M as 模型
  participant W as web_fetch
  participant S as 公网站点
  participant X as 内网 169.254.169.254
  M->>W: web_fetch(公网/redirect)
  Note over W: tool_call → checkUrl：公网，放行
  W->>S: GET /redirect
  Note over W: guardedLookup：公网，放行
  S-->>W: 302 Location: http://169.254.169.254/…
  rect rgb(255, 230, 213)
    Note over W: checkUrl(新地址)<br/>命中内网地址段
  end
--- 抛出“重定向被拒绝：拒绝访问内网地址”，从头到尾**没有向内网发出任何请求**。错误作为结果交回模型。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant M as 模型
  participant W as web_fetch
  participant S as 公网站点
  participant X as 内网 169.254.169.254
  M->>W: web_fetch(公网/redirect)
  Note over W: tool_call → checkUrl：公网，放行
  W->>S: GET /redirect
  Note over W: guardedLookup：公网，放行
  S-->>W: 302 Location: http://169.254.169.254/…
  Note over W: checkUrl(新地址)<br/>命中内网地址段
  rect rgb(255, 230, 213)
    W--x X: 不会发出请求
    W-->>M: 错误：重定向被拒绝
  end
:::

实验在本地起一个测试网站，让模型依次抓取文档页、直接访问元数据地址、访问一个会重定向到元数据地址的链接。同一份 `fetch.ts`，分别装进 Pi 和 mox；最后一段是真正的命令行 `mox -e extensions/web-fetch/mox.ts`（连本地假服务），确认默认导出的那一份能被命令行加载，发给模型的工具清单里多了 `web_fetch`：

@lab node labs/ch09/web-fetch.ts

两个宿主都正确地抓到了文档正文（脚本、样式、标题标签都被去掉），并拦下了后两次请求；mox 的错误多一个“错误：”前缀。命令行那一段里，模型要求抓元数据地址，扩展在 `tool_call` 上就拒绝了，请求根本没有发出。实验里的本地测试网站用 `trustedHosts` 显式放行；除此之外的所有内网地址一律拒绝。

::: compare 其他 Agent 怎么做
Claude Code 内置了 `WebFetch` 和 `WebSearch` 工具，并且可以用权限规则按域名控制（例如 `WebFetch(domain:docs.python.org)`）；它的文档还说明，抓取的页面会先转换成 Markdown，再由一个较小的模型按要求提取内容，而不是把整页原文塞进主对话。这是一个值得借鉴的思路：用一个便宜的模型做“读网页”这种重活，主对话只拿到结论。第 17 章的子 Agent 会把这个思路推广到任意任务。
:::

## 你来改

每道题先写下预测，再动手验证。

::: predict 拒绝理由写成空字符串
把 `labs/ch09/composition.ts` 里扩展 B 的拒绝理由改成空字符串 `''`（其余不动），`npm publish` 还会被拦下吗？
???
不会。`emit` 里是 `if (result) return result`，空字符串是假值，和 `undefined` 一样被当成“没意见”。B 放行之后，A 改成 `pnpm publish` 照样执行。拒绝理由必须是非空字符串；在 Pi 里 `{ block: true }` 不会有这个问题，因为判断的是 `block` 字段，不是内容。写拦截扩展时，永远先写理由再返回，别让一个空的模板字符串悄悄放行。
:::

::: predict 想放行却返回了 'ok'
一个扩展想表示“这个调用没问题”，在 `tool_call` 里写了 `return 'ok'`。模型调用这个工具会发生什么？
???
被拒绝，模型会看到“错误：ok”。`tool_call` 里**任何非空字符串**都是拒绝理由，放行只能返回 `true`，或者什么都不返回（交给后面的扩展和内置确认）。这是这套接口里最容易写错的地方：字符串的含义是“理由”，不是“状态”。
:::

::: predict 两个扩展注册同名工具
扩展 X 注册了 `bash`（加了超时），扩展 Y 也注册了 `bash`（加了日志）。如果加载顺序是 X、Y，模型调用 `bash` 时，超时和日志哪个生效？X 和 Y 想合作要怎么写？
???
只有 Y 的生效。`registerTool` 按名字找到已有的工具就原地换掉，后加载的覆盖先加载的，X 的包装被整个丢弃，没有报错也没有警告。想合作，Y 不能自己去 `codingTools()` 拿原来的 `bash`，而要拿到 X 注册之后的版本，但扩展接口没有“读取当前工具”的入口，所以 mox 里只能把两层包装写进同一个扩展。这也是项目里的扩展（`--trust`）能悄悄盖掉用户目录里沙箱的原因。
:::

::: predict agent_end 永远返回一句话
一个扩展的 `agent_end` 处理函数总是返回 `'再检查一遍'`。这次运行什么时候结束？
???
永远不会自己结束。`cli.ts` 的 `while (text)` 只看 `agent_end` 的返回值，没有计数、没有 `stop_hook_active`，扩展每次都返回非空字符串，模型每次都被要求再来一轮，直到你 Ctrl+C 或 token 用完。给 `agent_end` 续跑的扩展必须自己负责停：记次数、检查真实状态（测试是不是真的通过了）。第 13 章的 Stop 钩子、第 18 章的目标循环都要处理这个问题。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 如何为 Agent 设计一个插件 / 扩展系统？
核心是一组生命周期事件加注册接口：

- **事件**覆盖输入、系统提示、每次请求前的上下文、工具调用前后、消息形成、运行结束、会话切换、压缩等关键节点；mox 只留四个：`tool_call`、`tool_result`、`agent_end`、`shutdown`，够用就好；
- **注册**新工具（同名替换，方便给内置工具套一层）、命令、系统提示片段、向用户提问；
- **组合规则**要明确：按加载顺序执行；区分通知（忽略返回值）、链式变换（后者接收前者结果）、闸门（拒绝优先，安全不取决于加载顺序）；mox 的 `tool_call` 是“每个扩展都问，拒绝优先”（字符串拒绝、`true` 放行），`tool_result` 和 `agent_end` 是“第一个返回字符串的生效”；
- **错误处理**：通知类隔离错误，闸门类默认拒绝；
- **状态**：扩展自己的状态写进会话（追加记录），会话恢复或分叉时据此重建；
- **安全**：进程内扩展拥有宿主的全部权限，项目内的扩展必须经过用户信任才加载。
:::

::: interview 多个扩展订阅同一个事件，返回值怎么合并？mox 为什么对三个事件用三种方式？
按事件的性质选：

- **工具调用前（闸门）**：拒绝优先，每个扩展都问到，任何一个拒绝就拒绝，放行只在没人反对时生效。如果“第一个说了算”，排在前面的放行会让后面的沙箱、计划模式拦截失效，安全取决于加载顺序；Claude Code 钩子的 deny > ask > allow 是同一个思路。
- **工具结果（变换）**：接力，后一个收到前一个改过的结果。脱敏、加注释、截断可以叠加。反例是 mox 最初的“第一个说了算”：先加载的加注释扩展一返回，脱敏扩展就没被调用，令牌漏给了模型。
- **续跑（agent_end）**：一次只能续跑一句话，第一个返回字符串的说了算。

加分点：接力仍然有顺序（审计日志要排在脱敏之前才看得到原文）；拒绝理由必须是非空字符串，空字符串会被当成“没意见”。
:::

::: interview 扩展（或钩子）出错时，Agent 应该怎么处理？
看事件的性质。通知类（更新界面、记录日志）应该隔离错误：记录下来，继续运行，不能因为一个可选功能的 bug 中断用户的任务。闸门类（权限检查、安全拦截）应该默认拒绝：检查本身出错时，把它当成“不允许”，因为放行一个未经检查的危险操作代价更大。

对照 mox：`tool_call` 抛异常会变成错误结果（碰巧是拒绝），但 `agent_end` 抛异常会让整次运行失败，`shutdown` 抛异常会让进程崩溃，通知类事件的隔离要扩展自己做。
:::

::: interview Agent 的网页抓取工具有哪些安全风险？
最典型的是 SSRF：模型被网页或文件里的文字诱导，去访问只有 Agent 所在机器才能访问的地址，比如内网服务、本机端口、云实例元数据服务（里面有临时凭证）。

防护：只允许 http(s)；可选的域名白名单；把域名解析成 IP 后检查是否内网地址（防止域名指向内网）；不自动跟随重定向，每一跳都重新检查；连接时再检查一次实际地址（防 DNS rebinding）；限制响应大小和超时；只接受文本类内容。另外，抓回来的网页内容本身就是不可信输入，可能包含提示注入，后续的权限控制仍然需要。
:::

::: interview 进程内扩展和外部命令式的钩子，各有什么优缺点？
进程内扩展（Pi、mox 的方式）：能力强，能注册工具、命令、系统提示，能访问完整的会话和模型 API，调用开销小；但与 Agent 同一个进程、同样的权限，扩展本身就是信任边界，崩溃或阻塞会影响 Agent。

外部命令钩子（Claude Code 的 hooks）：任何语言都能写，与 Agent 隔着进程边界，容易由团队统一配置下发；但每次调用都要启动进程，只能通过约定的 JSON 协议交互，能做的事受限。第 13 章会用一个 mox 扩展实现一套兼容 Claude Code 协议的外部命令钩子，把两者结合起来。
:::

::: interview 为什么项目目录里的扩展默认不加载？
扩展就是代码，加载即执行，权限和 Agent 一样大。克隆一个陌生仓库再运行 Agent，如果自动加载 `.mox/extensions/`，仓库作者的代码就在你的机器上运行了（读你的环境变量、写文件、发请求）。mox 用 `--trust` 开关、Pi 用项目信任确认，都是让“执行项目里的代码”变成用户的明确决定。局限：信任是整个项目的，不是单个文件的；信任之后项目扩展还能按加载顺序盖掉用户级的同名工具。
:::
