---
motto: 循环本身只有十行，难的是决定什么时候停。
learn:
  - 把保护全部拿掉的朴素循环，在生产环境里会坏在哪四个地方
  - 截断、工具失败、停止权、运行中插话、取消，各自正确的处理方式，以及 Pi 的 runLoop 里对应的位置
  - 插话（steering）和追加任务（follow-up）为什么要分开排队
  - 逐段读懂 Pi 的 runLoop，以及它刻意没有做的事
  - 实战：给 mox 的 runLoop 加上这些保护，并用同一份脚本和 Pi 对照
prereq: 第 1、2 章
time: 60 分钟
build: 实战：给 mox 的 runLoop 加上保护 —— 每个调用都有结果、截断不执行、异常变结果、插话、取消（mox/src/loop.ts）
---

第 1 章的循环只认一个信号：这次回复里有没有工具请求。这一章我们把它放进五个情形里，让它坏四次，然后逐段读 Pi 的 `runLoop` 是怎样处理每一种情形的，最后在 mox 里把这些保护写出来。

五个情形的模型回复都由脚本决定，每个情形都会交给两个实现：

- **v0**：一个稻草人：把保护全部拿掉、只剩主路径的循环。它只存在于 `labs/ch03/runners.ts` 里，用来演示，不是另一个 Agent；
- **Pi**：Pi 真实的 `runAgentLoop`，模型换成 Pi 的 faux provider。

## 起点：v0

v0 只保留第 1 章主路径上的五件事：请求模型、记下回复、执行工具、放回结果、没有工具请求就停：

@code labs/ch03/runners.ts#naive

先确认成功路径没问题：

@lab node labs/ch03/compare.ts success | md

两个实现完全一致。问题都出在成功路径之外。

## 让它坏四次

@figure assets/course/ch03-four-failures.png 同一个循环的四种坏法：半截参数被执行、异常炸断循环、停不下来、插话被挡在门外

### 坏法一：输出被截断，半截参数照样执行

模型的单次输出有长度上限。如果在生成 `write` 的参数时撞到上限，参数的 JSON 就停在了半路。第 2 章说过，这时服务商会返回停止原因 `length`（Anthropic 叫 `max_tokens`）。

这段残缺的 JSON 最后变成什么，取决于适配器怎么解析它。严格解析会失败；而宽松的“部分 JSON”解析器——流式界面预览参数时用的那种——会把它补成一个**合法的对象**，`content` 是一个只有前一半的字符串。实验模拟的是后一种情况：模型给出的参数格式正确，只是内容只写了一半。v0 不看停止原因：

@lab node labs/ch03/compare.ts truncated | md

v0 把半个文件写到了磁盘上，然后告诉用户“已写入”。模型以为写好了，用户也以为写好了。Pi 多发了一次请求，最终写入的是完整内容——下面会看到它是怎么做到的。

### 坏法二：工具抛异常，整个运行崩掉

@lab node labs/ch03/compare.ts missing | md

“文件不存在”是再普通不过的情况，模型完全有能力处理：换个文件，或者问用户。但 v0 让异常直接冲出了循环，模型根本没机会看到这个错误，已经积累的对话也一起丢了。

### 坏法三：模型不肯停

v0 只在模型“不再调用工具”时才停，**停不停完全由模型决定**。如果模型陷入“再确认一次”的循环：

@lab node labs/ch03/compare.ts runaway | md

实验加了一个安全阀，第 8 次请求后强行拦下；真实的 v0 会一直跑，直到把额度耗光。注意第二列：**Pi 的 `runLoop` 也一样停不下来**，它没有最大轮数。只有宿主通过 `finishTurn` 叫停，才会在第 3 轮干净地结束（第三列）。第 1 章可以想到的 `MAX_TURNS` 把一个**产品策略**（最多几轮？按什么计？超了怎么办？）写死在了循环里，Pi 把它留给了宿主，后面有专门一节。

### 坏法四：用户中途插话，没人接

运行到一半，用户补了一句“只用一句话回答”。v0 的 `messages` 是函数内部的局部变量，外面根本递不进去：

@lab node labs/ch03/compare.ts steer | md

插话一直躺在队列里，模型给出了用户已经明确不想要的长篇介绍。

## 修好它：Pi 的 runLoop

@figure assets/course/ch03-guards.png 同一个循环加上五处检查点：坏响应出口、截断拦截、异常转结果、宿主的停止杆、两个排队入口

Pi 的 `runLoop` 完整函数约 160 行，先整体浏览一遍，后面逐段读：

@pi packages/agent/src/agent-loop.ts#runLoop

结构上最大的变化是**两层循环**：

- **内层**的条件是“还有工具结果要交给模型，或者有插话要交给模型”。只要其中一个成立，就再请求一次。
- **外层**在内层退出、本该结束的时候，看一眼有没有追加任务。有就带着它回到内层，没有才真正结束。

<figure class="diagram">
<svg viewBox="0 0 720 640" role="img" aria-label="Pi 的两层 Agent Loop 流程">
<defs><marker id="a3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--ink-2)"/></marker><marker id="a3o" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--accent)"/></marker></defs>
<g font-size="12.5" text-anchor="middle" fill="var(--ink)">
<rect x="230" y="16" width="240" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="39">把待处理的消息放进上下文</text>
<rect x="230" y="74" width="240" height="36" rx="8" fill="var(--ink)"/><text x="350" y="97" fill="var(--bg)">请求模型（发送完整上下文）</text>
<polygon points="350,130 450,152 350,174 250,152" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="156">error / aborted？</text>
<polygon points="350,196 450,218 350,240 250,218" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="222">stopReason = length？</text>
<rect x="230" y="262" width="240" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="285">执行工具；异常变成错误结果</text>
<rect x="230" y="322" width="240" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="345">finishTurn：问宿主</text>
<rect x="230" y="382" width="240" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="405">读取插话队列</text>
<polygon points="350,440 460,464 350,488 240,464" fill="var(--bg)" stroke="var(--accent)"/><text x="350" y="468">有工具结果或插话？</text>
<rect x="230" y="510" width="240" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="350" y="533">读取追加任务</text>
<polygon points="350,566 470,590 350,614 230,590" fill="var(--bg)" stroke="var(--accent)"/><text x="350" y="594">有追加任务 / 宿主要求继续？</text>
<rect x="540" y="134" width="150" height="36" rx="8" fill="var(--bg-soft)"/><text x="615" y="157" fill="var(--muted)">结束运行</text>
<rect x="520" y="200" width="186" height="36" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="613" y="223">每个调用 → 错误结果</text>
<rect x="540" y="322" width="150" height="36" rx="8" fill="var(--bg-soft)"/><text x="615" y="345" fill="var(--muted)">结束运行</text>
<rect x="540" y="572" width="150" height="36" rx="8" fill="var(--bg-soft)"/><text x="615" y="595" fill="var(--muted)">结束运行</text>
</g>
<g font-size="11" font-weight="700" fill="var(--accent)" text-anchor="middle">
<circle cx="490" cy="152" r="9" fill="var(--accent-soft)"/><text x="490" y="156">1</text>
<circle cx="500" cy="218" r="9" fill="var(--accent-soft)"/><text x="500" y="222">2</text>
<circle cx="490" cy="280" r="9" fill="var(--accent-soft)"/><text x="490" y="284">3</text>
<circle cx="214" cy="340" r="9" fill="var(--accent-soft)"/><text x="214" y="344">4</text>
<circle cx="214" cy="400" r="9" fill="var(--accent-soft)"/><text x="214" y="404">5</text>
<circle cx="214" cy="528" r="9" fill="var(--accent-soft)"/><text x="214" y="532">5</text>
</g>
<g stroke="var(--ink-2)" stroke-width="1.2" fill="none" marker-end="url(#a3)">
<path d="M350 52V72"/><path d="M350 110V128"/><path d="M350 174V194"/><path d="M350 240V260"/><path d="M350 298V320"/><path d="M350 358V380"/><path d="M350 418V438"/><path d="M350 488V508"/><path d="M350 546V564"/>
<path d="M450 152H538"/><path d="M450 218H518"/><path d="M613 236V300H470"/><path d="M470 340H538"/><path d="M470 590H538"/>
</g>
<g font-size="11" fill="var(--muted)"><text x="458" y="146">是</text><text x="458" y="212">是</text><text x="358" y="190">否</text><text x="358" y="256">否</text><text x="478" y="334">end</text><text x="358" y="504">否</text><text x="478" y="584">否</text></g>
<g stroke="var(--accent)" stroke-width="1.5" fill="none" marker-end="url(#a3o)">
<path d="M240 464H160V34H228"/>
<path d="M230 590H90V34H158" stroke-dasharray="5 4"/>
</g>
<g font-size="11.5" fill="var(--accent-ink)" font-weight="600"><text x="168" y="258" transform="rotate(-90 168 258)" text-anchor="middle">内层循环 · 是</text><text x="82" y="300" transform="rotate(-90 82 300)" text-anchor="middle">外层循环 · 是</text></g>
</svg>
<figcaption>Pi 的 runLoop 的完整流程。数字对应正文的 ①～⑤；实线回到顶部是内层循环，虚线是外层循环。</figcaption>
</figure>

**外层与内层循环**，以及启动时先查一次插话队列（用户可能在 Agent 准备期间就已经输入了）：

@pi packages/agent/src/agent-loop.ts#L184-L192

### ① 响应本身失败：直接结束

第 2 章约定了适配器不抛异常，网络错误、服务端错误、用户取消都编码在 `stopReason` 里。循环看到 `error` 或 `aborted` 就结束，**不执行这条回复里的任何工具调用**——一条失败的回复里的工具请求是不可信的。它仍然调用 `finishTurn` 通知宿主（让宿主有机会记录和清理），但不采纳它的返回值，直接结束：

@pi packages/agent/src/agent-loop.ts#L254-L265

### ② 输出被截断：一个都不执行

`stopReason` 是 `length` 时，回复里的每一个工具调用都被替换成一条错误结果，告诉模型“参数可能不完整，请重新发起”。工具函数根本不会被调用，磁盘上什么都不会发生。这个替换由一个专门的函数完成，它对每个调用都发出“开始执行”和“执行结束”事件，所以界面上能看到这个工具“执行失败了”，而不是悄悄消失：

@pi packages/agent/src/agent-loop.ts#failToolCallsFromTruncatedMessage

Pi 其实有两道关。第一道在提供商层：一个工具调用结束时，Pi 用 `parseToolCallArguments` **严格**解析完整的参数文本（只修复字符串里的非法转义，不补全缺失的括号），解析不了就把参数置为空对象，并把原因记在 `argumentsError` 里，工具校验时报错交还给模型：

@pi packages/ai/src/utils/json-parse.ts#parseToolCallArguments

所以在 Pi 里，被截断的 JSON 通常过不了第一道关。循环里的 `length` 检查是第二道：它不依赖任何一家适配器的解析细节，哪怕参数“碰巧”是合法的（比如截断恰好发生在两个调用之间，或者某个适配器用了宽松解析），也不会执行。

为什么是**所有**调用都不执行，而不是只跳过最后一个？截断发生在整条回复的末尾，看起来只有最后一个调用受影响。但你没有办法可靠地判断前面的调用是不是模型本来想要的完整计划的一部分：模型可能本打算“先删除旧文件，再写入新文件”，截断让第二步消失了，只执行第一步反而更糟。Pi 的注释说得很直接：

@pi packages/agent/src/agent-loop.ts#L272-L281

截断后循环**继续**，因为错误结果也是结果（`hasMoreToolCalls` 为真），模型会看到它并重新发起完整的调用。

### ③ 工具失败：变成一条结果

工具执行放在 `executePreparedToolCall` 里（第 4 章细读）。任何异常——文件不存在、参数不对——都被转换成一条 `isError: true` 的结果；工具名是模型“幻觉”出来的、参数过不了校验，则在更早的 `prepareToolCall` 里就变成错误结果：

@pi packages/agent/src/agent-loop.ts#L841-L867

这是 Agent 设计里最基本的原则之一：**能变成消息的失败，就交回给模型。** 模型看到错误后通常能自己纠正：换个路径、修正参数、或者向用户说明情况。只有模型无法处理的失败（比如请求本身失败）才应该终止运行。

### ④ 停止权：交给宿主

每一轮结束时，循环调用 `finishTurn` 问一句宿主（运行这个循环的程序）：还继续吗？

- 返回 `{ action: 'end' }`：立即结束，不再看任何队列。成本上限、轮数上限、超时、检测到重复操作，都在这里实现。
- 返回 `{ action: 'continue' }`：**保证至少再请求一次**，即使模型认为自己已经完成了。比如宿主运行了测试，发现还没通过。
- 不返回：按正常规则调度。

注意 `continue` 的一个细节：如果这一轮本来就会有下一轮（有工具结果或插话），这个“额外继续”的标记会被清除，避免多发一次请求。

这就是 `MAX_TURNS` 的正确归宿：**循环只负责在每轮结束时问一次“还继续吗”，答案由宿主决定。** 上面“不肯停”的情形，就是用 `finishTurn` 数到 3 轮实现的。

### ⑤ 插话和追加任务：两个队列

用户在 Agent 运行时输入的内容有两种意图：

- **插话（steering）**：“只用一句话回答”“别改那个文件”——纠正正在进行的工作，越早让模型看到越好。
- **追加任务（follow-up）**：“做完之后再帮我写个测试”——不应该打断当前工作，等它告一段落再处理。

所以它们进两个不同的队列，在不同的位置被取出：插话在**每一轮结束后**取，下一次请求就能看到；追加任务在**内层循环退出后**才取。

::: steps 插话与追加任务分别在哪一次请求出现
--- 运行开始：上下文里只有用户的任务 U。**第 1 次请求**发给模型，它要求读 README。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  rect rgb(255, 230, 213)
    L->>M: 请求 1：看到 U
    M-->>L: 调用 read_file
  end
--- 工具执行期间，用户同时输入了两句话：S（“只用一句话回答”，纠正方向）进**插话队列**，F（“再列出 src 目录”，新任务）进**追加任务队列**。两个队列都还没有被读取。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  L->>M: 请求 1：看到 U
  M-->>L: 调用 read_file
  rect rgb(255, 230, 213)
    L->>T: 执行 read_file
    Q->>Q: S 进插话队列，F 进追加队列
  end
--- 每轮结束时，循环先问 `finishTurn`，再调用 `getSteering()` 取走 S，放进 `pending`。F 没有动。因为有工具结果和插话，内层循环条件成立，进入下一轮。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  L->>M: 请求 1：看到 U
  M-->>L: 调用 read_file
  L->>T: 执行 read_file
  Q->>Q: S 进插话队列，F 进追加队列
  rect rgb(255, 230, 213)
    T-->>L: 工具结果
    L->>Q: getSteering() 取走 S
  end
--- 下一轮开头，`pending` 里的 S 先被推进上下文，紧跟在工具结果后面。**第 2 次请求**里模型看到 U 和 S，于是只用一句话回答，没有再调用工具。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  L->>M: 请求 1：看到 U
  M-->>L: 调用 read_file
  L->>T: 执行 read_file
  Q->>Q: S 进插话队列，F 进追加队列
  T-->>L: 工具结果
  L->>Q: getSteering() 取走 S
  rect rgb(255, 230, 213)
    L->>M: 请求 2：看到 U、S
    M-->>L: 一句话回答，没有工具调用
  end
--- 这一轮既没有工具结果，插话队列也空了，**内层循环退出**。本该结束的这一刻，外层才调用 `getFollowUp()` 取走 F，作为 `pending` 回到内层。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  L->>M: 请求 1：看到 U
  M-->>L: 调用 read_file
  L->>T: 执行 read_file
  Q->>Q: S 进插话队列，F 进追加队列
  T-->>L: 工具结果
  L->>Q: getSteering() 取走 S
  L->>M: 请求 2：看到 U、S
  M-->>L: 一句话回答，没有工具调用
  rect rgb(255, 230, 213)
    L->>Q: getFollowUp() 取走 F
  end
--- **第 3 次请求**里模型看到 U、S、F，回答完毕。这次追加队列也是空的，外层循环 `return end('done')`。S 在第 2 次请求出现，F 在第 3 次出现，和实验输出一致。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant Q as 用户（两个队列）
  participant L as runLoop
  participant M as 模型
  participant T as read_file
  L->>M: 请求 1：看到 U
  M-->>L: 调用 read_file
  L->>T: 执行 read_file
  Q->>Q: S 进插话队列，F 进追加队列
  T-->>L: 工具结果
  L->>Q: getSteering() 取走 S
  L->>M: 请求 2：看到 U、S
  M-->>L: 一句话回答，没有工具调用
  L->>Q: getFollowUp() 取走 F
  rect rgb(255, 230, 213)
    L->>M: 请求 3：看到 U、S、F
    M-->>L: 回答 F
    Note over L: 两个队列都空，运行结束
  end
:::


这个实验让用户在工具执行期间同时插话（S）和追加任务（F），模型每次回复都报告它看到了哪些用户消息：

@lab node labs/ch03/queues.ts

S 在第 2 次请求里就出现了，紧跟在工具结果后面；F 要等模型对“原任务 + 插话”给出回答之后，才在第 3 次请求里出现。

::: compare Claude Code 里的同一个设计
Claude Code 的官方文档描述了完全相同的行为：在 Claude 工作时输入一句纠正并回车，消息会先排队；如果 Claude 正在执行工具，它会**在这些工具执行完之后、同一轮之内**读到这条消息，并据此调整下一步。按 Esc 则是立刻停止（取消），排队的消息随后发出。（[How Claude Code works · Interrupt and steer](https://code.claude.com/docs/en/how-claude-code-works)）
:::

### 每轮结束时的决策顺序

先问宿主，再取插话；工具结果或插话已经足以引出下一轮时，清除“额外继续”标记：

@pi packages/agent/src/agent-loop.ts#L295-L308

外层的收尾：先取追加任务，再处理宿主要求的“额外继续”，都没有才结束：

@pi packages/agent/src/agent-loop.ts#L310-L327

### Pi 多做的事

上面是骨架。Pi 的循环比骨架多出来的部分，每一项都对应一个真实需求：

**两个准备钩子。** `prepareNextTurn` 在两轮之间运行，可以替换上下文、切换模型——上下文压缩（第 8 章）就在这里发生。因为它可能很耗时，结束后会再查一次插话队列，让准备期间输入的消息赶上这一轮。`prepareRequest` 在请求发出前做最后的调整，它不再查队列：

@pi packages/agent/src/agent-loop.ts#L193-L216

**细粒度的事件。** Pi 区分消息的开始、增量更新和结束，工具执行也有开始、进度和结束。终端界面就是靠这些事件实时刷新的，会话文件则在 `message_end` 时写入（第 0 章看过）：

@pi packages/agent/src/types.ts#L528-L551

**队列的投递模式。** Pi 的 `Agent` 类默认**每次只取一条**插话（`one-at-a-time`），也可以配置成一次取全部（`all`）：

@pi packages/agent/src/agent.ts#L149-L176

两种模式的区别在于模型对每条插话是否有单独回应的机会。用户连续说了“改成英文”和“标题也改一下”：逐条投递时，模型先处理第一条，第二条在下一轮出现；一次投递时，模型在同一次回复里同时处理两条。前者更可控，后者省一次请求。

**从已有会话继续。** 恢复一个会话时，如果最后一条消息是模型的回答，直接重发同样的历史没有意义——模型没有新的输入。Pi 的 `continue()` 会先看队列里有没有插话或追加任务，有就以它们作为新输入开始运行，没有就拒绝：

@pi packages/agent/src/agent.ts#L395-L420

### Pi 刻意没做的事

读完 `runLoop`，你会发现一件事：**它没有最大轮数，没有费用上限，也没有超时。**

这不是疏忽。最多跑几轮、花多少钱、多久超时，都是产品策略，不同的界面、不同的用户、不同的任务需要不同的答案。循环只提供机制（`finishTurn` 和取消信号），策略由宿主实现。

这和第 0 章说的分层原则是同一个道理：循环层不知道它运行在终端里还是服务器上，也就不应该替上层决定“跑多久算太久”。

## 取消：按下 Esc 之后发生了什么

停止权还有最后一种形式：用户主动取消。它和 `finishTurn` 不同——`finishTurn` 只在每轮结束时被问到，而取消可能发生在任何时刻：模型正在生成，或者一个命令正在运行。

Pi 的做法是**每次运行一个 `AbortController`**。运行开始时创建，取消就是调用它的 `abort()`：

@pi packages/agent/src/agent.ts#L517-L537

同一个 `signal` 被传给模型的流式请求、每一个工具、以及钩子。模型流收到信号后中断 HTTP 连接，回复的停止原因变成 `aborted`，循环按 ① 的规则结束。

::: steps 按下 Esc 之后：信号传到哪里，谁会停下
--- 运行开始时创建一个 `AbortController`，**同一个 signal** 会传给模型的流式请求和每一个工具。模型回复了一个 `long_task` 调用，工具开始执行，需要 2 秒。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as runLoop
  participant T as 工具（2 秒）
  participant M as 模型
  rect rgb(255, 230, 213)
    L->>T: execute(args, signal)
    Note over T: 预计 2000ms 后完成
  end
--- 100 毫秒时用户按下 Esc：宿主调用 `abort()`。信号只是一个**通知**，此刻工具仍在运行，循环没有办法强行打断它。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as runLoop
  participant T as 工具（2 秒）
  participant M as 模型
  L->>T: execute(args, signal)
  Note over T: 预计 2000ms 后完成
  rect rgb(255, 230, 213)
    U->>L: Esc → abort()
    L-->>T: signal 触发
  end
--- **监听信号的工具**收到通知后清掉计时器、抛出“已取消”，约 100ms 就返回错误结果；**不理会信号的工具**对通知视而不见，跑满 2 秒，结果显示成功。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as runLoop
  participant T as 工具（2 秒）
  participant M as 模型
  L->>T: execute(args, signal)
  Note over T: 预计 2000ms 后完成
  U->>L: Esc → abort()
  L-->>T: signal 触发
  rect rgb(255, 230, 213)
    T-->>L: 监听：100ms 返回错误<br/>不监听：2000ms 返回成功
  end
--- 工具一返回，循环带着结果再请求一次模型。此时信号已经是 aborted，模型流立刻以 `aborted` 结束，按 ① 的规则，运行以 `aborted` 收场。取消是协作式的：循环能做的只是把信号传到每一个地方。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant U as 用户
  participant L as runLoop
  participant T as 工具（2 秒）
  participant M as 模型
  L->>T: execute(args, signal)
  Note over T: 预计 2000ms 后完成
  U->>L: Esc → abort()
  L-->>T: signal 触发
  T-->>L: 监听：100ms 返回错误<br/>不监听：2000ms 返回成功
  rect rgb(255, 230, 213)
    L->>M: 请求（signal 已 aborted）
    M-->>L: stopReason = aborted
    Note over L: 结束运行
  end
:::


但信号只是一个**通知**。JavaScript 没有办法强行中断一段正在运行的代码，工具必须自己监听信号并提前退出。这个实验让模型调用一个需要 2 秒的工具，用户在 100 毫秒时取消，对比一个监听信号的工具和一个不理会信号的工具：

@lab node labs/ch03/abort.ts | md

监听信号的工具在 100 毫秒时就退出了，运行随即以 `aborted` 结束。不理会信号的工具一直跑满 2 秒，期间用户按了 Esc 却什么都没发生——而且它的结果显示“成功”，因为工具确实做完了。**取消是协作式的，循环能做的只是把信号传到每一个地方。**

这对写工具的人提出了要求：任何可能耗时的工具都应该接收 `signal`，把它传给 `fetch`、子进程或者自己的等待逻辑。`bash` 是最典型的例子：取消 shell 不等于取消 shell 启动的一切。实验用 `sleep 40; echo done` 做命令（bash 是父进程，`sleep` 是它的子进程），100 毫秒时取消，300 毫秒后检查 `sleep` 还在不在：

@lab node labs/ch03/abort-bash.ts | md

朴素写法只给 `spawn` 一个 `signal` 选项：Node 对直接启动的 bash 发 `SIGTERM`，`sleep` 却继续跑，工具早就返回了“已取消”，系统里还留着一个孤儿进程。真实的场景是 `npm test`：取消之后它的子进程会继续在后台占着 CPU、改着文件。Pi 的 `bash` 工具在信号触发时杀掉**整个进程树**：

@pi packages/coding-agent/src/core/tools/bash.ts#L124-L143

第 5 章读 Pi 的 `read` 工具时，会看到它在每个可能阻塞的位置都检查了信号。

## 实战：给 mox 的 runLoop 加上保护

**这一章的目标**：把第 1 章写的最小循环升级成“不会被坏响应、坏工具、用户打断弄垮”的循环。mox 的 `runLoop` 只有 20 行，`execute` 20 行，和 Pi 的 160 行相比，保护集中在五个位置。每一步都对应上面读过的 Pi 的一段。

### 第 1 步：把执行一个调用拆成 execute

循环里“找工具、解析参数、调用 `run`”的那几行拆成一个函数 `execute(call, …)`，它**永远有返回值**：整个函数体包在 `try/catch` 里，任何异常——工具不存在、参数 JSON 坏了、`run` 自己抛出——都落进 `catch`，变成一条以“错误：”开头的结果字符串。`runLoop` 里对每个调用都 `push` 一条 `role: 'tool'` 的消息：

@code mox/src/loop.ts#execute hl=48-49,51-52,58-60

@code mox/src/loop.ts#L35-L37 hl=36,37

注释写得很直白：失败、拒绝、取消也一样，否则下一次请求不合法。这对应 Pi 的 `executePreparedToolCall` 的 `catch`。mox 的 `tool` 消息没有 `isError` 字段（OpenAI 格式没地方放），模型靠“错误：”这个前缀认出失败；`tool_end` 事件带着 `error` 标记，界面据此把它画成红色。mox 的 `bash` 在退出码非 0 时同样抛异常，所以一条失败的命令对模型来说也是一条“错误”结果。

### 第 2 步：截断不执行

`execute` 的第 49 行：`finish === 'length'` 就抛异常，工具函数根本不会被调用。回到第 37 行，它变成一条“错误：输出被截断，参数可能不完整，请重新调用”的结果；回复里的**所有**调用都这样处理，原因和 Pi 的注释一样。截断后循环继续，模型看到这条结果会重新发起：

::: tabs
@@ mox
@code mox/src/loop.ts#L48-L52 hl=49
`finish` 是整条回复的属性，所以所有调用都被拒绝。
@@ Pi
@pi packages/agent/src/agent-loop.ts#L272-L281
Pi 用 `failToolCallsFromTruncatedMessage` 对所有调用生成错误结果。
:::

### 第 3 步：插话

选项里加一个 `steer?: () => string[]`。所有工具结果放回历史之后调用它，取走用户这段时间插的话，每一条 `push` 成 `user` 消息。退出条件也跟着变成“没有工具调用，**并且**没有插话”：只要有插话，哪怕模型已经给出最终回答，也要再请求一次，让模型看到它：

@code mox/src/loop.ts#L38-L40 hl=38-40

### 第 4 步：取消

选项里加 `signal`。它被传给模型的 `fetch`、每个工具的 `run(args, signal)`，`execute` 开头还检查一次 `signal.aborted`：取消发生时，一条回复里还没开始的调用也**照样有一条结果**（“用户取消了”），历史才是合法的。下一次请求模型的 `fetch` 因为 signal 已触发而抛出 `AbortError`，`runLoop` 不捕获，异常一路冒出，宿主的 `catch` 看到 `signal.aborted` 就知道是自己取消的（命令行里：`print(controller.signal.aborted ? '（已取消）' : …)`）。

@code mox/src/loop.ts#L23-L34 hl=32

### 第 5 步：宿主：叫停和追加任务

mox 的 `runLoop` **没有 `finishTurn`、没有追加任务队列、没有 `prepareNextTurn`**。这三件事去了别处：

| Pi 的钩子 | mox 里怎么做 |
| --- | --- |
| `finishTurn` 返回 `end`：叫停 | 宿主在 `onEvent` 里数 `tool_end`，够数就 `controller.abort()`；`runLoop` 在下一次请求时抛出 `AbortError` |
| `finishTurn` 返回 `continue`、`getFollowUpMessages`：续跑、追加任务 | 循环**外面**：`runLoop` 返回后，命令行问扩展的 `agent_end` 事件“还有下一句吗”，有就当新的用户消息再调一次 `runLoop`（扩展系统是第 9 章，现在宿主里直接写一个 `while`） |
| `prepareNextTurn`：压缩上下文 | `compact` 选项：循环每次请求前调用，由它就地改写 `messages`（第 8 章） |

追加任务那个 `while` 就是命令行里的 `run()`：

@code mox/src/cli.ts#L124-L132 hl=129-130

用户在运行中输入的每一句，在 mox 的命令行里都进 `steering`（`if (controller) { steering.push(text) }`），没有单独的“追加任务”队列；追加任务只能由 `agent_end` 给出。叫停和拒绝是两件事：`beforeTool` 拒绝的是**这一次调用**，循环照常继续，模型换个办法再试，所以它挡不住“不肯停”；要真正停下来只能取消。

### 第 6 步：检验

`practice.ts` 用和 `compare.ts` 同一份脚本检验你的 `runLoop`，右边列出 Pi 的结果：五个情形，加上取消时每个调用都有结果、幻觉出来的工具名变成错误结果、追加任务在循环外面续跑。默认检验参考实现，设置 `MOX_DIR` 就检验你自己写的：

```bash
node labs/ch03/practice.ts                      # 参考实现
MOX_DIR=~/my-mox node labs/ch03/practice.ts     # 你自己写的
```

@lab node labs/ch03/practice.ts | md

两个地方值得停下来看。第一，“停不下来（不设限）”那一行：mox 和 Pi 一样，没有宿主策略就一直转到安全阀；加上宿主叫停，mox 靠取消停在第 3 轮（抛出 `AbortError`），Pi 靠 `finishTurn` 停在第 3 轮（正常返回）。前者代码更少，后者让宿主不必区分“被叫停”和“出错了”。第二，截断那一行：mox 和 Pi 都是 3 次请求、磁盘上是完整内容。下面的回放把 mox 处理这个情形的过程拆成一步一步：

@trace node labs/ch03/trace.ts truncated

### mox 比 Pi 省掉了什么

| | mox 的 `runLoop` | Pi 的 `runLoop` |
| --- | --- | --- |
| 结构 | 一层循环，约 40 行（含 `execute`） | 内外两层循环，约 160 行 |
| 失败的回复 | 模型函数抛异常，冒出循环 | 看 `stopReason`，`error` / `aborted` 直接结束，不执行其中的工具调用 |
| 宿主叫停 | 取消信号（抛异常） | `finishTurn`（正常返回），还能要求“至少再来一轮” |
| 追加任务 | 循环外：`agent_end` 事件 | 循环里：第二个队列 |
| 插话 | `steer`，每次取全部 | `getSteeringMessages`，默认逐条 |
| 准备阶段 | `compact` 选项，压缩期间输入的话要等这一轮结束才进历史 | `prepareNextTurn`，结束后再查一次插话队列 |
| 事件 | `text`、`message`、`tool_start`、`tool_end` 四种 | 开始、增量、结束，工具执行有进度 |
| 工具执行 | 顺序 | 默认并行（第 4 章） |

### 你来改

每道题先写下预测，再动手验证。改 `mox/` 里的文件之前先看一眼 `git -C mox status`，做完用 `git -C mox checkout .` 还原；自己写的 mox 直接改你的目录。

::: predict 删掉截断检查
把 `execute` 里 `if (finish === 'length') throw …` 那一行去掉。运行 `node labs/ch03/practice.ts`，mox 一列的请求次数和磁盘上的文件会变成什么？
???
请求次数从 3 变成 2，磁盘上只剩半截内容，和 v0 一模一样；`practice.ts` 里截断那一条断言会失败。工具执行本身是成功的，模型拿到“写入成功”，也就不会再发一次完整调用。这说明截断检查必须放在**执行之前**——执行之后再补救已经晚了，副作用已经发生。（实验里的参数是合法 JSON，所以 `JSON.parse` 没能拦住；真实的残缺参数通常拦得住，但你不能赌这一点。）
:::

::: predict 给 mox 装一个“最多 3 次工具调用”
不改 `runLoop`，让“不肯停”的情形在累计 3 次工具调用之后就停下，用 `beforeTool` 来实现：数到第 4 次就返回一个理由字符串拒绝它。请求次数会是 3 吗？
???
不会。`beforeTool` 拒绝的是**这一次调用**，不是整个运行：返回理由后，`execute` 把它变成一条错误结果，循环照常继续，模型看到“错误：已达到上限”之后很可能再试一次，被拒，再试……直到安全阀拦下。要真正停下来，要在 `onEvent` 里数 `tool_end` 然后 `controller.abort()`（`practice.ts` 里“宿主叫停”那一行就是这样做的）。叫停和拒绝是两件事，这也是 Pi 要单独给一个 `finishTurn` 的原因。
:::

::: predict 把插话改成追加任务
在 `labs/ch03/practice.ts` 的第 ① 部分，不用 `steer`，改成让宿主在 `runLoop` 返回之后把插话当作下一句话再调一次 `runLoop`（像第 ④ 部分那样）。运行 steer 情形，mox 要请求几次？用户会先看到什么？
???
请求 3 次，最终回答仍然是一句话。但在那之前，第 2 次请求已经生成了一段长篇介绍，因为那时插话还没有进入历史，要等 `runLoop` 返回之后才被取出。用户先看到不想要的长答案，再看到短答案。这就是“纠正方向”必须走 `steer`、不能走“循环外续跑”的原因。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview Agent Loop 的停止条件有哪些？谁有权决定停止？
至少四类：

1. **模型认为完成**：回复里没有工具请求（mox 还要求没有待处理的插话）。
2. **响应失败**：错误或用户取消。Pi 把它们编码成消息的 `stopReason`，循环直接结束；mox 里它们是异常，冒出循环。两种都不执行其中的工具调用。
3. **宿主决定**：根据策略（轮数、成本、时间、重复检测、测试是否通过）叫停，或者强制再继续一轮。Pi 提供 `finishTurn`；mox 靠取消信号叫停，靠 `agent_end` 事件续跑。
4. **队列为空**：没有待处理的插话和追加任务。

关键观点：停止权不能只在模型手里。循环提供机制（决策点、取消信号），具体策略由宿主实现，所以生产级循环本身通常没有写死的轮数上限。mox 和 Pi 都是这样。
:::

::: interview 模型输出被截断时应该怎么处理？为什么所有工具调用都不执行？
看停止原因：截断时（`length` / `max_tokens`）文字可以保留，但**其中的所有工具调用都不执行**，而是为每个调用生成一条错误结果，说明参数可能不完整，让模型重新发起。循环继续，模型下一轮会发出完整调用。

全部不执行的原因：被截断的参数在语法上可能完全合法，执行后果不可预测；而且截断可能破坏了一组调用的完整性，只执行其中一部分可能比都不执行更糟。检查必须在执行之前，副作用一旦发生就无法补救。加分点：别指望 `JSON.parse` 失败来兜底，它只能拦住“恰好残缺”的参数。
:::

::: interview 工具执行失败时，Agent 应该怎么处理？
把失败转换成一条带错误标记的工具结果，交回给模型，而不是让异常终止运行。模型通常能自己纠正：换路径、修参数、或者告诉用户。mox 的做法是 `execute` 外面一个 `try/catch`，把一切异常写成“错误：…”；Pi 的结果消息带结构化的 `isError`。

需要区分两类失败：工具层面的失败（文件不存在、命令返回非零）交给模型；系统层面的失败（模型请求本身失败、被取消）才终止运行。还要处理模型调用不存在的工具、参数不符合格式等情况，同样作为错误结果返回。无论怎样，**每个工具调用都必须有一条对应的结果**，否则下一次请求会被服务商拒绝。
:::

::: interview 用户在 Agent 运行过程中发送消息，应该怎么处理？
区分两种意图：

- **插话（steering）**：纠正正在进行的工作。在每轮工具执行完之后取出，下一次请求就能看到。不打断正在执行的工具。
- **追加任务（follow-up）**：等当前工作告一段落（循环本该结束时）才取出。可以做成循环里的第二个队列（Pi），也可以放在循环外，由 Agent 结束时的事件续跑（mox 的 `agent_end`）。

还要考虑投递粒度（逐条还是一次全部）、准备阶段（比如压缩）期间到达的消息能否赶上当前轮、以及“立即停止”是另一个操作（取消），不应和插话混在一起。Claude Code 的“回车排队”和“Esc 停止”就是这两种操作。
:::

::: interview 如何防止 Agent 无限循环或成本失控？
在宿主层实现策略，通过循环提供的决策点生效：

- 每轮结束时检查累计轮数、token 用量、费用、耗时，超过上限就结束（Pi 的 `finishTurn`；mox 在事件回调里数，够了就取消）；
- 检测重复：连续多次相同的工具调用和相同的参数，判定为卡住；
- 给工具执行设置超时，给整个运行提供取消信号；
- 把上限暴露给用户配置，而不是写死在循环里。

注意“拒绝工具调用”不是叫停：权限钩子拒绝的只是那一次调用，模型会换个办法再试。加分点：说明为什么不把上限写进循环本身（策略随产品而变，循环只提供机制），以及截断、失败等情况下的重试本身也要计入预算。
:::

::: interview 用户取消一次运行时，Agent 应该怎么处理？
每次运行创建一个取消控制器（`AbortController`），把同一个信号传给模型请求、所有工具和钩子：

- 模型请求收到信号后中断连接：Pi 把它编码成 `aborted` 的回复，mox 抛出 `AbortError`；两者都不会再执行其中的工具调用；
- 正在执行的工具负责响应信号：中断网络请求、杀掉子进程（要杀整个进程树，而不是只杀 shell：mox 让命令独占一个进程组再整组杀掉，Pi 杀整个进程树）；
- 取消是协作式的，不响应信号的工具会一直跑完，所以写工具时要把信号传到每个可能阻塞的地方；
- 取消发生时，一条回复里还没开始的调用也要有结果，历史才是合法的；
- 已经发生的副作用无法撤销，需要配合检查点或版本控制（第 16 章）。

加分点：区分“取消”与“插话”（插话不打断正在执行的工具）；说清楚取消后排队的消息怎么处理——Pi 把它们退回输入框，Claude Code 的文档说会在停止后接着发送它们。两种规则都合理，关键是要有明确的规则。
:::

