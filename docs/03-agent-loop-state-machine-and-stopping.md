# Agent Loop：一次运行为什么有两轮模型调用

按一次回车，模型却收到了两次请求。第一次返回 `read("README.md")`，第二次根据读到的内容回答。用户发起的一次请求在 Pi 里叫一次运行（run）。其中每次模型响应及其引出的整批工具处理，是一轮（turn）。要解释第二轮从哪里来，可以从 `runLoop` 中几个变量的值入手。

![Mox 操作模型和工具之间的循环](../assets/mox-mechanisms/loop.png)

## 谁保管这次运行

`Agent.prompt()` 首先检查 `activeRun`。已有运行时，再次直接调用 `prompt` 会抛错。正常情况下，`runWithLifecycle` 创建一个 `AbortController`，把取消信号交给执行函数，并设置 `state.isStreaming`。这里的标记覆盖一次运行的生命期，也包含等待工具的时间。新输入可以通过下文的队列进入。[运行入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L380) · [生命期与清理](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L518)

进入 `runAgentLoop`，先准备两组消息。

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L119)

```ts
const initialMessages = declareToolChanges(context, prompts);
const newMessages: AgentMessage[] = [...initialMessages];
const currentContext: AgentContext = {
	...context,
	messages: [...context.messages, ...initialMessages],
};
```

`...context.messages` 在新数组中展开已有元素。假设旧上下文已有系统消息 S，已经声明 `read`，本次普通输入是 U，工具集合未变。这时 `declareToolChanges` 返回包含 U 的输入。`currentContext.messages` 从 `[S, U]` 起步，`newMessages` 从 `[U]` 起步。前者提供下一次请求所需的历史，后者用于汇总这一次 run 的新增内容。若需要插入工具声明，中间还会新增系统消息。

Pi 随后发出 `agent_start` 和第一轮的 `turn_start`，为初始消息发出消息事件。`runLoop` 接收当前上下文和新增列表，开始驱动模型与工具。以下推演沿用这个已有 S 的场景。[初始事件及返回值](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L126)

## 在纸上走完一次成功的运行

记 A₁ 为模型的工具请求，R 为文件结果，A₂ 为模型的最终文字。假定工具正常返回、没有新输入、没有改变停止决策的钩子。下表是控制流推演，省略流式增量和系统提示的具体文字。

| 运行走到哪一步 | 当前上下文 `messages` | 此时为什么向前走 |
| --- | --- | --- |
| 用户提交 U | S，U | 外层循环开始时将 `hasMoreToolCalls` 设为 `true`，由此进入第一次请求 |
| 模型完成第一轮响应 | S，U，A₁ | A₁ 的内容有 `toolCall`，其 ID 是 `read-1`。按此块查找和执行工具 |
| `read` 返回 R | S，U，A₁，R | 普通读取没有要求批次终止，`hasMoreToolCalls = true`，内层循环再次成立 |
| 第二轮模型给出 A₂ | S，U，A₁，R，A₂ | A₂ 只含文字。本轮把 `hasMoreToolCalls` 置回 `false` |
| 检查队列与结束决策 | 同上 | 没有 steering、follow-up 或额外继续请求，跳出外层循环，发出 `agent_end` |

运行返回的新增消息是 `[U, A₁, R, A₂]`。当第一轮把 `hasMoreToolCalls` 设为 `true` 时，当前批次的 `read` **已经执行完**。这个值表示还要带着结果向模型再请求一次。决定下一轮的赋值正是下面几行。

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L276)

```ts
const executedToolBatch =
	message.stopReason === "length"
		? await failToolCallsFromTruncatedMessage(toolCalls, emit)
		: await executeToolCalls(currentContext, message, config, signal, emit);
toolResults.push(...executedToolBatch.messages);
hasMoreToolCalls = !executedToolBatch.terminate;

for (const result of toolResults) {
	currentContext.messages.push(result);
	newMessages.push(result);
}
```

`!` 取反。批次返回 `terminate: false`，取反得到 `true`。R 同时进入 `currentContext.messages` 与 `newMessages`，所以下次请求能看见它，运行结束时调用者也能拿到它。模型至此才首次得到文件原文。[工具批次与状态更新](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L267)

## 一批两个工具，听谁的停止信号

一个模型响应可以提出两个调用。工具或钩子可以在各自的最终结果中设置 `terminate`。批次怎样合并这两个意见，取决于一个很小的函数。

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L700)

```ts
function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
```

`every` 检查集合中每一项。额外检查 `length > 0` 是因为 JavaScript 对空数组调用 `every` 会返回 `true`。被检查的是每个已经完成准备、执行或拦截处理的最终结果，后置钩子也可能更改它。下表只看“工具结果本身是否自然触发下一轮”，其余决策暂时固定为空。

| 最终结果 A | 最终结果 B | 批次 `terminate` | 因这批结果再次请求模型 |
| --- | --- | --- | --- |
| `true` | `true` | `true` | 否 |
| `true` | `false` | `false` | 是 |
| `true` | 未提供该字段 | `false` | 是 |

上游的混合批次测试用同一个 `echo` 工具执行两次。参数 `value` 第一次为 `"first"`，第二次为 `"second"`，工具返回 `terminate: params.value === "first"`。模拟模型第一次发出两个调用，下一次只回答 `"done"`。实际断言是模型流函数被调用两次，消息角色依次为 `system → user → assistant → toolResult → toolResult → assistant`。这里的系统消息来自测试中首次声明工具，与上一节已有 S 的起点不同。[混合批次测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1899)

[运行批次停止实验](../examples/read-loop/batch.mjs)

## 决策次序：工具、钩子和来自用户的新输入

同样是“还有一件事要做”，有三个不同来源。`hasMoreToolCalls` 表示工具结果自然引出的下一轮。`pendingMessages` 保存准备注入的消息。`explicitContinuation` 表示 `finishTurn` 明确要求再跑一轮。理解优先级要看检查位置。

1. **先结束异常响应。** 若 assistant 消息的 `stopReason` 是 `error` 或 `aborted`，Pi 仍调用 `finishTurn` 通知上层，发出 `turn_end`、`agent_end` 并返回。该分支不执行工具，也不采用该钩子的返回决策。
2. **正常分支先处理完整批次。** 然后把消息、工具结果和当前上下文传给 `finishTurn`，发出 `turn_end`。钩子若返回 `{ action: "end" }`，立即结束，后续队列检查也被跳过。
3. **先满足自然发生的继续。** 否则记录是否明确要求 `continue`，并读取 steering 队列。工具结果或 steering 已足以开始下一轮时，清除额外继续标记。
4. **内层工作耗尽，再取 follow-up。** 有消息就带着它回到外层顶部。若仍无消息，但 `explicitContinuation` 为真，则消耗这个标记，以原有上下文再请求一次。三种来源均为空才结束。[完整分支顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L249)

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L295)

```ts
const decision = await config.finishTurn?.(lastCompletedTurn, signal);
await emit({ type: "turn_end", message, toolResults });

if (decision?.action === "end") {
	await emit({ type: "agent_end", messages: newMessages });
	return;
}

explicitContinuation = decision?.action === "continue";
pendingMessages = (await config.getSteeringMessages?.()) || [];
if (hasMoreToolCalls || pendingMessages.length > 0) {
	explicitContinuation = false;
}
```

这段代码也解释了两个具体行为。一种是第一次工具调用后，同时有工具结果和 `continue`。它们会合为同一个下一轮。另一种是第一次回答只含文字，`finishTurn` 第一次返回 `continue`、第二次返回 `undefined`。此时会额外进行恰好一次请求。上游测试让模型按调用次数生成 `response 1`、`response 2`，最后分别检查模型、钩子的调用次数均为 2。[仅使用上下文的额外轮次](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1273)

### steering 与 follow-up 分别何时进入

假设用户在文件读取过程中补充“只说明用途”，这条 steering（运行中追加的引导消息）先入队。低层循环在整批工具处理和 `finishTurn` 之后读取队列。接下来模型看到 R 和新的用户消息，能够据此调整回答。已经启动的文件读取按自身的取消规则工作。如果使用 follow-up（当前工作告一段落后的追加任务）提交“再写一段安装说明”，内层先带 R 请求原任务的回答。待内层准备退出时，外层才取出这条消息组织下一轮。[两类队列的取出位置](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L303)

还有一个时机差异。后续轮开始前，`prepareNextTurn` 可能进行耗时的上下文准备。若之前没有取到 steering，准备结束后会再取一次，以便这期间输入的消息赶上当前轮。若之前已取到，就不多取一次，保留“一次取一条”的语义。`prepareRequest` 则在待加入消息已写入之后、流请求之前调整 context 或模型，完成它不会再次轮询 steering。[下一轮准备](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L192) · [时序测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1458)

### 逐条投递与整批投递，少一次请求从哪里省出来

现在把时间精确到代码可观察的位置。脚本模型始终只回答“收到。”，每次都正常结束；在**第一轮的 `turn_end` 监听器**中依次排入 S₁「只读 README」、S₂「保留标题」和 F「再写摘要」。前两条调 `agent.steer`，最后一条调 `agent.followUp`。由于循环先等待事件监听器完成，再轮询 steering 队列，这个插入点使三条输入的到达时间完全确定。不需要靠延时猜“用户是不是刚好在工具结束前按了回车”。[事件与继续判定的位置](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L295)

队列本身只有一个消息数组。`enqueue` 把元素加到末尾，`peek` 按模式选择一组将要投递的元素。模式为 `all` 时选择全部元素的浅拷贝，在 `one-at-a-time` 模式下只选择第一个元素。`drain` 用选中元素的个数切掉数组开头的已交付部分。这三个操作把“已排队”“已选为下一轮输入”“已进入模型请求”区分开。界面要展示待办内容时可以预览，而不会无意中消耗下一条消息。[队列实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L149)

源码摘录：[packages/agent/src/agent.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L165)

```ts
peek(): AgentMessage[] {
	if (this.mode === "all") return this.messages.slice();
	const first = this.messages[0];
	return first ? [first] : [];
}

drain(): AgentMessage[] {
	const drained = this.peek();
	this.messages = this.messages.slice(drained.length);
	return drained;
}
```

从仓库根目录进入示例并使用已有依赖运行下列命令。程序实测同一组输入在两种模式下发给模型的用户消息序列。它使用 Pi 的真实 `Agent` 和脚本模型，打印时只提取每次请求里角色为 user 的消息，表格用简称缩短文字。[完整脚本](../examples/read-loop/boundaries.mjs) · [安装方法](../examples/read-loop/README.md)

```bash
cd examples/read-loop
node boundaries.mjs queue
```

| 时间点 | 逐条取 steering | 一次取全 steering |
| --- | --- | --- |
| 第一次请求 | 仅 U「介绍项目」 | 仅 U |
| 第一轮结束后 | 取出 S₁，S₂ 仍在 steering 队列，F 在 follow-up 队列 | 同时取出 S₁、S₂，F 仍在 follow-up 队列 |
| 第二次请求 | U、S₁ | U、S₁、S₂ |
| 第三次请求 | U、S₁、S₂ | U、S₁、S₂、F |
| 第四次请求 | U、S₁、S₂、F | 已经结束 |

逐条模式的第二次请求还能看见 U，是因为取出 S₁ 只会从**队列**中删除 S₁。将它追加到上下文后，之前的 U 并未被删除。F 虽然在第一轮末尾就已排队，但只要整批工具或 steering 还会自然引出下一轮，follow-up 就继续等待。一次取全之所以少一次请求，是因为一个请求可以同时携带多条新消息。它仍保留两条独立的用户消息，模型只是把二者放在同一次响应里处理。这意味着一次取全时，S₁ 与 S₂ 之间不会产生一个可供后者参考的中间回答。例如如果第二条是“按你刚才给出的项目名改标题”，它的意思便会随两条消息是否分开传入而改变。

若把插入点后移至 `prepareRequest` 内部，一个相同的排队调用也会产生不同结果。此时本轮已经把先前选好的 `pendingMessages` 写入上下文，之后就要发送请求，新加入队的消息只能等下一次读取。`prepareNextTurn` 的耗时准备则处于另一个时机，源码在准备前并未选中消息时允许补取。这个区别决定了显示“已收到”的消息何时真正进入模型视野。要验证一条用户更改有没有赶上当前轮，可以记录实际送到流函数的 `context.messages`；单独观察队列曾经非空无法得出答案。[准备期间的输入测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1580) · [请求准备后的队列测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1458)

### 为什么已有 assistant 结尾的历史不能直接照跑

上面的推演通过 `prompt` 新建一次运行。恢复已有会话时，`Agent.continue()` 先查看最后一条历史。如果最后一条是用户消息，例如保存了 U 便关闭程序，模型还有一个明确待回答的问题。如果尾部已经是工具结果 R，可以把它交给模型完成尚未生成的回答。若尾部却是模型的最终文字 A₂，直接重发同一份历史，模型缺少一个明确的新输入。在没有排队消息时，该方法会拒绝从这个尾部继续。[继续入口和尾部检查](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L391)

有待处理输入时，结论不同。假设尾部是 A₂，队列有 S₁、S₂，采用逐条模式。`continue()` 先取出 S₁ 当作新 prompt，又将 `skipInitialSteeringPoll` 传给运行配置。原因在于普通新 run 会在启动时主动检查 steering，如果此处再次检查，刚取完 S₁ 就会顺带取出 S₂，两条消息会意外进入同一次请求。这个一次性的跳过标记只作用于开始处；下一轮仍可正常取 S₂。上游测试从 assistant 尾部放入两条 steering，逐条模式检查第一次请求只含第一条，全部模式则检查第一次就同时含有两条。代码并没有为“恢复”另写一套循环，差别在于如何为同一个入口提供正确的初始条件。[启动配置的单次跳过](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L504) · [两种模式的恢复测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent.test.ts#L824)

## 出错时要看哪一个信号

| 已知信号 | 执行器走的分支 | 对后续模型请求的影响 |
| --- | --- | --- |
| 整个 assistant 响应 `error` 或 `aborted` | 结束通知与硬退出 | 当前 run 到此为止 |
| `length` 且响应里带工具块 | 给这条消息的所有调用生成错误结果，跳过执行 | 默认继续，让模型有机会重发完整调用 |
| 工具运行失败，如文件不存在 | 将异常转成与原调用 ID 对应的错误工具结果 | 普通批次仍可继续，模型能解释出错原因 |
| 正常文本响应，没有工具 | 无工具批次可执行 | 仍检查钩子、steering 和 follow-up |

上游测试让 `echo` 收到 `{ value: "hel" }`，它在类型上完全符合“字符串”的要求，但模型停止原因为 `length`。真实工具的调用记录仍是空数组，`tool_execution_end.isError` 为真。模拟模型被请求了两次。只校验参数类型会漏掉这种内容被截短却仍合法的情况。[截断响应测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L456)

## 消息结束、轮次结束、运行空闲

对于同一个 `read-1`，界面会看到多种“结束”。`tool_execution_end` 指一个工具调用得到最终结果，`message_end` 指一条完整消息已形成，`turn_end` 指这一轮模型响应及其工具处理已完成，`agent_end` 指本次循环不会再发事件。`processEvents` 根据事件更新对外可读的 `Agent.state`。

| 事件 | Agent 对自己状态所做的更新 |
| --- | --- |
| `message_start`、`message_update` | 替换 `streamingMessage`，界面可显示正在生成的内容 |
| `message_end` | 清空 `streamingMessage`，把完整消息追加到 `state.messages` |
| `tool_execution_start`、`tool_execution_end` | 为 `pendingToolCalls` 增加、移除对应 ID |
| `turn_end` | 若当前轮的 assistant 携带错误说明，记录 `errorMessage` |
| `agent_end` 之后 | 等待订阅者完成，`finishRun` 释放当前运行句柄，清理暂存状态并使 `waitForIdle()` 的等待者继续 |

为何 `finishTurn` 可以检查文件结果，而 UI 又还没收到 `turn_end`？一个测试订阅事件，同时让钩子记录自己的执行位置。钩子内确认最后一条上下文消息是 `toolResult`，最后三个记录恰好是 `message_end:toolResult → finishTurn → turn_end`。另一个测试让异步监听器阻塞在 `agent_end`，等它释放后，等待空闲的代码才继续。需要切换会话或发起下一次普通 `prompt` 时，这两个结束时刻有实际区别。[事件与钩子顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L1108) · [状态与订阅者](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L575) · [空闲等待测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent.test.ts#L374)

### 取消信号沿什么方向传播

`abort()` 调用当前运行的 `AbortController.abort()`，随后同一份 `signal` 会被模型流、工具和某些钩子观察到。它表示“请求停止”。在 JavaScript 里，已经交给文件系统的读取或已经开始的子进程不会仅仅因为布尔标志变化就自行撤回，具体实现要主动检查信号或订阅事件。本轮 `read` 在I/O前后检查状态；若其他工具忽略信号，它返回或退出前，宿主仍可能需要等待。对用户展示“已请求停止”与允许发出下一次普通 `prompt` 需要依据不同的状态。[运行句柄与取消](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L345) · [读取中的取消观察点](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L109)

设想订阅者收到最后一个 `agent_end` 后，还要异步刷新会话界面。`processEvents` 先更新状态，再逐一 `await listener(event, signal)`，所以这段刷新仍属于当前 run 等待的工作。`finishRun` 放在 `finally` 路径，收尾时清理挂起的工具集合、释放 active run，再让等待空闲的一方继续。若应用在 `agent_end` 监听器内部直接等待“自己所在的这次运行空闲”，就形成互相等待：监听器等运行收尾，运行收尾又在等监听器先返回。把后续任务交给外层在 `await agent.prompt(...)` 之后启动，等待方向才一致。[等待订阅者与清理](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L518)

配套示例使用空历史与一个可执行的 `read` 启动，工具声明使第一次请求从 `system → user` 开始。在示例目录运行 `node cli.mjs success`，实测第二次请求的角色顺序为 `system → user → assistant → toolResult`，进入 `read.execute` 一次。改用 `node cli.mjs length` 仍有两次模型请求，实际进入工具的次数变为 0。[运行与输出](../examples/read-loop/README.md)

> **先预测**　本批工具全部要求终止，但 follow-up 队列此时已有一条用户消息。还会再请求模型吗？
>
> **核对推导**　会。全批终止的是由工具结果驱动的继续条件；内层循环退出后，外层还能取到后续用户消息。观察下一次请求的末条消息，就能区分它是由工具触发，还是由排队的输入触发。

[继续阅读：从工具声明追到文件读取](04-tools-and-function-calling.md) · [课程路线](00-source-learning-path.md)
