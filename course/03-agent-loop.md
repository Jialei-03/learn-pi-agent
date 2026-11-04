---
motto: 循环本身只有十行，难的是决定什么时候停。
learn:
  - 第 1 章那个十行循环在生产环境里会坏在哪四个地方
  - 截断、工具失败、停止权、运行中插话，各自正确的处理方式
  - 插话（steering）和追加任务（follow-up）为什么要分开排队
  - 逐段读懂 Pi 的 runLoop，以及它刻意没有做的事
prereq: 第 1、2 章
time: 60 分钟
build: mox/src/loop.ts —— 一个与 Pi 的 runLoop 行为一致的 Agent Loop
---

第 1 章的循环只认一个信号：这次回复里有没有工具请求。这一章我们把它放进五个情形里，让它坏四次，然后写出一个能处理所有情形的版本，最后逐段对照 Pi 的实现。

五个情形的模型回复都由脚本决定，每个情形都会交给三个实现：

- **v0**：第 1 章那样的朴素循环；
- **mox**：本章写的 `mox/src/loop.ts`；
- **Pi**：Pi 真实的 `runAgentLoop`，模型换成 Pi 的 faux provider。

## 起点：v0

把第 1 章的循环换成第 2 章的内部格式，它长这样：

@code labs/ch03/compare.ts#naive

先确认成功路径没问题：

@lab node labs/ch03/compare.ts success | md

三个实现完全一致。问题都出在成功路径之外。

## 让它坏四次

@figure assets/course/ch03-four-failures.png 同一个循环的四种坏法：半截参数被执行、异常炸断循环、停不下来、插话被挡在门外

### 坏法一：输出被截断，半截参数照样执行

模型的单次输出有长度上限。如果在生成 `write_file` 的参数时撞到上限，参数的 JSON 就停在了半路。第 2 章说过，这时服务商会返回停止原因 `length`（Anthropic 叫 `max_tokens`）。

这段残缺的 JSON 最后变成什么，取决于适配器怎么解析它。严格解析会失败；而宽松的“部分 JSON”解析器——流式界面预览参数时用的那种，有些 SDK 在结束时也这样拼装参数——会把它补成一个**合法的对象**，`content` 是一个只有前一半的字符串。实验模拟的是后一种情况：模型给出的参数格式正确，只是内容只写了一半。v0 不看停止原因：

@lab node labs/ch03/compare.ts truncated | md

v0 把半个文件写到了磁盘上，然后告诉用户“已写入”。模型以为写好了，用户也以为写好了。mox 和 Pi 多发了一次请求，最终写入的是完整内容——下面会看到它们是怎么做到的。

### 坏法二：工具抛异常，整个运行崩掉

@lab node labs/ch03/compare.ts missing | md

“文件不存在”是再普通不过的情况，模型完全有能力处理：换个文件，或者问用户。但 v0 让异常直接冲出了循环，模型根本没机会看到这个错误，已经积累的对话也一起丢了。

### 坏法三：模型不肯停

v0 只在模型“不再调用工具”时才停，**停不停完全由模型决定**。如果模型陷入“再确认一次”的循环：

@lab node labs/ch03/compare.ts runaway | md

实验加了一个安全阀，第 8 次请求后强行拦下。真实的 v0 会一直跑，直到把额度耗光。第 1 章的 `MAX_TURNS` 能挡住这种情况，但它把一个**产品策略**（最多几轮？按什么计？超了怎么办？）写死在了循环里。

### 坏法四：用户中途插话，没人接

运行到一半，用户补了一句“只用一句话回答”。v0 的 `messages` 是函数内部的局部变量，外面根本递不进去：

@lab node labs/ch03/compare.ts steer | md

插话一直躺在队列里，模型给出了用户已经明确不想要的长篇介绍。

## 修好它：mox 的 runLoop

@figure assets/course/ch03-guards.png 同一个循环加上五处检查点：坏响应出口、截断拦截、异常转结果、宿主的停止杆、两个排队入口

下面是 mox 的完整循环。它和 v0 的区别集中在五个编号的位置：

@code mox/src/loop.ts#runLoop collapse=false

结构上最大的变化是**两层循环**：

- **内层**的条件是“还有工具结果要交给模型，或者有插话要交给模型”。只要其中一个成立，就再请求一次。
- **外层**在内层退出、本该结束的时候，看一眼有没有追加任务。有就带着它回到内层，没有才真正结束。

<figure class="diagram">
<svg viewBox="0 0 720 640" role="img" aria-label="mox 和 Pi 的两层 Agent Loop 流程">
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
<figcaption>runLoop 的完整流程。数字对应正文的 ①～⑤；实线回到顶部是内层循环，虚线是外层循环。</figcaption>
</figure>


### ① 响应本身失败：直接结束

第 2 章约定了适配器不抛异常，网络错误、服务端错误、用户取消都编码在 `stopReason` 里。循环看到 `error` 或 `aborted` 就结束，**不执行这条回复里的任何工具调用**——一条失败的回复里的工具请求是不可信的。

### ② 输出被截断：一个都不执行

`stopReason` 是 `length` 时，回复里的每一个工具调用都被替换成一条错误结果，告诉模型“参数可能不完整，请重新发起”。工具函数根本不会被调用，磁盘上什么都不会发生。

Pi 其实有两道关。第一道在提供商层：一个工具调用结束时，Pi 用 `parseToolCallArguments` **严格**解析完整的参数文本（只修复字符串里的非法转义，不补全缺失的括号），解析不了就把参数置为空对象，并把原因记在 `argumentsError` 里，工具校验时报错交还给模型：

@pi packages/ai/src/utils/json-parse.ts#parseToolCallArguments

所以在 Pi 里，被截断的 JSON 通常过不了第一道关。循环里的 `length` 检查是第二道：它不依赖任何一家适配器的解析细节，哪怕参数“碰巧”是合法的（比如截断恰好发生在两个调用之间，或者某个适配器用了宽松解析），也不会执行。

为什么是**所有**调用都不执行，而不是只跳过最后一个？截断发生在整条回复的末尾，看起来只有最后一个调用受影响。但你没有办法可靠地判断前面的调用是不是模型本来想要的完整计划的一部分：模型可能本打算“先删除旧文件，再写入新文件”，截断让第二步消失了，只执行第一步反而更糟。Pi 的注释说得很直接：

@pi packages/agent/src/agent-loop.ts#L272-L281

截断后循环**继续**，因为错误结果也是结果（`hasMoreToolCalls` 为真），模型会看到它并重新发起完整的调用。下面的回放把这个过程拆成一步一步：

@trace node labs/ch03/trace.ts truncated

### ③ 工具失败：变成一条结果

工具执行放在 `runTools` 里。任何异常——文件不存在、参数不对、工具名是模型“幻觉”出来的——都被转换成一条 `isError: true` 的结果：

@code mox/src/tools.ts#runTools

这是 Agent 设计里最基本的原则之一：**能变成消息的失败，就交回给模型。** 模型看到错误后通常能自己纠正：换个路径、修正参数、或者向用户说明情况。只有模型无法处理的失败（比如请求本身失败）才应该终止运行。

### ④ 停止权：交给宿主

每一轮结束时，循环调用 `finishTurn` 问一句宿主（运行这个循环的程序）：还继续吗？

- 返回 `'end'`：立即结束，不再看任何队列。成本上限、轮数上限、超时、检测到重复操作，都在这里实现。
- 返回 `'continue'`：**保证至少再请求一次**，即使模型认为自己已经完成了。比如宿主运行了测试，发现还没通过。
- 不返回：按正常规则调度。

注意 `'continue'` 的一个细节：如果这一轮本来就会有下一轮（有工具结果或插话），这个“额外继续”的标记会被清除，避免多发一次请求。

这就是第 1 章 `MAX_TURNS` 的正确归宿：**循环只负责在每轮结束时问一次“还继续吗”，答案由宿主决定。** 我们的实验里，“不肯停”的情形就是用 `finishTurn` 数到 3 轮实现的。

### ⑤ 插话和追加任务：两个队列

用户在 Agent 运行时输入的内容有两种意图：

- **插话（steering）**：“只用一句话回答”“别改那个文件”——纠正正在进行的工作，越早让模型看到越好。
- **追加任务（follow-up）**：“做完之后再帮我写个测试”——不应该打断当前工作，等它告一段落再处理。

所以它们进两个不同的队列，在不同的位置被取出：插话在**每一轮结束后**取，下一次请求就能看到；追加任务在**内层循环退出后**才取。

这个实验让用户在工具执行期间同时插话（S）和追加任务（F），模型每次回复都报告它看到了哪些用户消息：

@lab node labs/ch03/queues.ts

S 在第 2 次请求里就出现了，紧跟在工具结果后面；F 要等模型对“原任务 + 插话”给出回答之后，才在第 3 次请求里出现。mox 和 Pi 的顺序完全一致。

::: compare Claude Code 里的同一个设计
Claude Code 的官方文档描述了完全相同的行为：在 Claude 工作时输入一句纠正并回车，消息会先排队；如果 Claude 正在执行工具，它会**在这些工具执行完之后、同一轮之内**读到这条消息，并据此调整下一步。按 Esc 则是立刻停止（取消），排队的消息随后发出。（[How Claude Code works · Interrupt and steer](https://code.claude.com/docs/en/how-claude-code-works)）
:::

## 对照 Pi 的 runLoop

现在打开 Pi 的 `runLoop`。完整函数约 160 行，先整体浏览一遍：

@pi packages/agent/src/agent-loop.ts#runLoop

骨架和 mox 一一对应。逐段看几个关键位置。

**外层与内层循环**，以及启动时先查一次插话队列（用户可能在 Agent 准备期间就已经输入了）：

@pi packages/agent/src/agent-loop.ts#L184-L192

**① 失败的回复**：仍然调用 `finishTurn` 通知宿主（让宿主有机会记录和清理），但不采纳它的返回值，直接结束：

@pi packages/agent/src/agent-loop.ts#L254-L265

**② 截断时的错误结果**由一个专门的函数生成。它对每个调用都发出“开始执行”和“执行结束”事件，所以界面上能看到这个工具“执行失败了”，而不是悄悄消失：

@pi packages/agent/src/agent-loop.ts#failToolCallsFromTruncatedMessage

**④⑤ 每轮结束时的决策顺序**：先问宿主，再取插话；工具结果或插话已经足以引出下一轮时，清除“额外继续”标记：

@pi packages/agent/src/agent-loop.ts#L295-L308

**⑤ 外层的收尾**：先取追加任务，再处理宿主要求的“额外继续”，都没有才结束：

@pi packages/agent/src/agent-loop.ts#L310-L327

| 编号 | mox | Pi |
| --- | --- | --- |
| ① 坏响应直接结束 | `if (reply.stopReason === 'error' …) return end(…)` | 同样结束，但先通知 `finishTurn` |
| ② 截断不执行 | `calls.map(refuseTruncated)` | `failToolCallsFromTruncatedMessage`，并发出执行事件 |
| ③ 异常变结果 | `runTools` 里的 `try/catch` | `executeToolCalls` 内部的 catch（第 4 章细读） |
| ④ 宿主决定停止 | `finishTurn` 返回 `'end'` / `'continue'` | `finishTurn` 返回 `{ action: 'end' }` / `{ action: 'continue' }` |
| ⑤ 两种排队消息 | `getSteering` / `getFollowUp` | `getSteeringMessages` / `getFollowUpMessages` |

### Pi 多做的事

mox 的循环约 60 行，Pi 的约 160 行。多出来的部分每一项都对应一个真实需求：

**两个准备钩子。** `prepareNextTurn` 在两轮之间运行，可以替换上下文、切换模型——上下文压缩（第 8 章）就在这里发生。因为它可能很耗时，结束后会再查一次插话队列，让准备期间输入的消息赶上这一轮。`prepareRequest` 在请求发出前做最后的调整，它不再查队列：

@pi packages/agent/src/agent-loop.ts#L193-L216

**细粒度的事件。** mox 只有 `message` 一种消息事件，Pi 区分开始、增量更新和结束，工具执行也有开始、进度和结束。终端界面就是靠这些事件实时刷新的，会话文件则在 `message_end` 时写入（第 0 章看过）：

@pi packages/agent/src/types.ts#L528-L551

**队列的投递模式。** mox 的插话队列每次取出全部消息。Pi 的 `Agent` 类默认**每次只取一条**（`one-at-a-time`），也可以配置成一次取全部（`all`）：

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

同一个 `signal` 被传给模型的流式请求、每一个工具、以及钩子。模型流收到信号后中断 HTTP 连接，回复的停止原因变成 `aborted`，循环按 ① 的规则结束。工具这一侧，`bash` 工具在信号触发时杀掉**整个进程树**，而不只是 shell 本身——否则 `npm test` 启动的子进程会继续在后台运行：

@pi packages/coding-agent/src/core/tools/bash.ts#L124-L143

但信号只是一个**通知**。JavaScript 没有办法强行中断一段正在运行的代码，工具必须自己监听信号并提前退出。这个实验让模型调用一个需要 2 秒的工具，用户在 100 毫秒时取消，对比一个监听信号的工具和一个不理会信号的工具：

@lab node labs/ch03/abort.ts | md

监听信号的工具在 100 毫秒时就退出了，运行随即以 `aborted` 结束。不理会信号的工具一直跑满 2 秒，期间用户按了 Esc 却什么都没发生——而且它的结果显示“成功”，因为工具确实做完了。mox 和 Pi 的表现完全一致：**取消是协作式的，循环能做的只是把信号传到每一个地方。**

这对写工具的人提出了要求：任何可能耗时的工具都应该接收 `signal`，把它传给 `fetch`、子进程或者自己的等待逻辑。第 5 章读 Pi 的 `read` 工具时，会看到它在每个可能阻塞的位置都检查了信号。

## 你来改

每道题先写下预测，再动手验证。

::: predict 删掉截断检查
把 `mox/src/loop.ts` 里 ② 的判断去掉，让截断的回复也正常执行工具（把 `reply.stopReason === 'length' ? calls.map(refuseTruncated) :` 删掉）。运行 `node labs/ch03/compare.ts truncated`，mox 一列的请求次数和磁盘上的文件会变成什么？
???
请求次数从 3 变成 2，磁盘上只剩半截内容，和 v0 一模一样。工具执行本身是成功的，模型拿到“写入成功”，也就不会再发一次完整调用。这说明截断检查必须放在**执行之前**——执行之后再补救已经晚了，副作用已经发生。
:::

::: predict 把插话改成追加任务
在 `labs/ch03/compare.ts` 的 `mox()` 里，把 `getSteering:` 改成 `getFollowUp:`，运行 `node labs/ch03/compare.ts steer`。mox 要请求几次？用户会先看到什么？
???
请求 3 次，最终回答仍然是一句话。但在那之前，第 2 次请求已经生成了一段长篇介绍，因为那时插话还在追加任务队列里排着，要等内层循环结束才被取出。用户先看到不想要的长答案，再看到短答案。这就是“纠正方向”必须走插话队列的原因。
:::

::: predict 按工具调用次数设预算
不改 `runLoop`，让“不肯停”的情形在累计执行 2 次 `read` 之后就结束。你会改哪个回调？Pi 那一列又该怎么改？
???
改 `finishTurn`：在 mox 里按 `world.toolRuns.length >= 2` 返回 `'end'`，在 Pi 里返回 `{ action: 'end' }`。两边的请求次数都会变成 2。停止策略属于宿主，循环只负责在每轮结束时问一次“还继续吗”。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview Agent Loop 的停止条件有哪些？谁有权决定停止？
至少四类：

1. **模型认为完成**：回复里没有工具请求。
2. **响应失败**：错误或用户取消，直接结束，不执行其中的工具调用。
3. **宿主决定**：每轮结束时由宿主根据策略（轮数、成本、时间、重复检测、测试是否通过）决定结束，或者强制再继续一轮。
4. **队列为空**：没有待处理的插话和追加任务。

关键观点：停止权不能只在模型手里。循环提供机制（每轮一次的决策点、取消信号），具体策略由宿主实现，所以生产级循环本身通常没有写死的轮数上限。
:::

::: interview 模型输出被截断时应该怎么处理？为什么所有工具调用都不执行？
看停止原因：截断时（`length` / `max_tokens`）文字可以保留，但**其中的所有工具调用都不执行**，而是为每个调用生成一条错误结果，说明参数可能不完整，让模型重新发起。循环继续，模型下一轮会发出完整调用。

全部不执行的原因：被截断的参数在语法上可能完全合法，执行后果不可预测；而且截断可能破坏了一组调用的完整性，只执行其中一部分可能比都不执行更糟。检查必须在执行之前，副作用一旦发生就无法补救。
:::

::: interview 工具执行失败时，Agent 应该怎么处理？
把失败转换成一条带错误标记的工具结果，交回给模型，而不是让异常终止运行。模型通常能自己纠正：换路径、修参数、或者告诉用户。

需要区分两类失败：工具层面的失败（文件不存在、命令返回非零）交给模型；系统层面的失败（模型请求本身失败、被取消）才终止运行。还要处理模型调用不存在的工具、参数不符合格式等情况，同样作为错误结果返回。
:::

::: interview 用户在 Agent 运行过程中发送消息，应该怎么处理？
区分两种意图，分两个队列：

- **插话（steering）**：纠正正在进行的工作。在每轮工具执行完之后取出，下一次请求就能看到。不打断正在执行的工具。
- **追加任务（follow-up）**：等当前工作告一段落（内层循环本该结束时）才取出。

还要考虑投递粒度（逐条还是一次全部）、准备阶段（比如压缩）期间到达的消息能否赶上当前轮、以及“立即停止”是另一个操作（取消），不应和插话混在一起。Claude Code 的“回车排队”和“Esc 停止”就是这两种操作。
:::

::: interview 如何防止 Agent 无限循环或成本失控？
在宿主层实现策略，通过循环提供的决策点生效：

- 每轮结束时检查累计轮数、token 用量、费用、耗时，超过上限就结束；
- 检测重复：连续多次相同的工具调用和相同的参数，判定为卡住；
- 给工具执行设置超时，给整个运行提供取消信号；
- 把上限暴露给用户配置，而不是写死在循环里。

加分点：说明为什么不把上限写进循环本身（策略随产品而变，循环只提供机制），以及截断、失败等情况下的重试本身也要计入预算。
:::

::: interview 用户取消一次运行时，Agent 应该怎么处理？
每次运行创建一个取消控制器（`AbortController`），把同一个信号传给模型请求、所有工具和钩子：

- 模型流收到信号后中断连接，回复标记为“已取消”，循环不再执行其中的工具调用；
- 正在执行的工具负责响应信号：中断网络请求、杀掉子进程（要杀整个进程树，而不是只杀 shell）；
- 取消是协作式的，不响应信号的工具会一直跑完，所以写工具时要把信号传到每个可能阻塞的地方；
- 已经发生的副作用无法撤销，需要配合检查点或版本控制（第 16 章）。

加分点：区分“取消”与“插话”（插话不打断正在执行的工具）；说清楚取消后排队的消息怎么处理——Pi 把它们退回输入框，Claude Code 的文档说会在停止后接着发送它们。两种规则都合理，关键是要有明确的规则。
:::
