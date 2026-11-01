# Agent Loop：状态、事件、队列与停止条件

本章解释一次运行为什么继续、怎样被打断，以及模型停止生成之后还需要完成哪些工作。`Agent` 持有运行状态，`agent-loop.ts` 推进模型与工具循环。

![Mox 操作模型和工具之间的循环](../assets/mox-mechanisms/loop.png)

## 1. 从入口进入运行

`Agent.prompt()` 整理输入，并阻止同一 Agent 同时处理两个普通 prompt。运行中的新输入通过 steering 或 follow-up 队列接入。

源码摘录：[packages/agent/src/agent.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts#L381)

```ts
async prompt(input: string, images?: ImageContent[]): Promise<void>;
async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
	if (this.activeRun) {
		throw new Error(
			"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
		);
	}
	const messages = this.normalizePromptInput(input, images);
	await this.runPromptMessages(messages);
```

`runPromptMessages()` 将当前消息和工具快照传给 `runAgentLoop()`，事件回调交给 `processEvents()`。生命周期代码同时负责取消信号和运行结束清理。

## 2. 两组消息的不同用途

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L119)

```ts
const initialMessages = declareToolChanges(context, prompts);
const newMessages: AgentMessage[] = [...initialMessages];
const currentContext: AgentContext = {
	...context,
	messages: [...context.messages, ...initialMessages],
};

```

`currentContext.messages` 是循环当前使用的上下文；`newMessages` 记录这次运行新产生的消息。返回新增消息不等于返回全部历史。`declareToolChanges()` 还会让工具变化进入消息记录，使模型声明与执行侧工具保持关联。

## 3. 一次 turn 的执行顺序

循环处理准备和排队消息，运行 `prepareRequest`，请求模型、处理工具结果，再运行 `finishTurn` 并发出 `turn_end`。后续响应前还可能经过 `prepareNextTurn`。

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L295)

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
}
```

`finishTurn` 的 `continue` 可以由自然产生的工具结果或排队输入满足；没有自然请求时，才安排一次仅使用现有上下文的请求。无条件返回继续会制造无限运行。

## 4. 两层循环与两种队列

内层处理工具和 steering；外层在 Agent 本来要停止时检查 follow-up。Steering 在后续检查点进入当前工作，follow-up 等当前工作自然停止后接续。它们不是对已经发生的外部动作做回滚。

上下文准备可能耗时，期间到达的 steering 需要在合适位置重新读取。`prepareRequest` 不负责额外轮询队列；钩子名字相似并不意味着调用时机相同。

## 5. 结束原因共同决定控制流

| 情况 | 程序行为 |
| --- | --- |
| 模型错误或中止 | 结束当前运行路径 |
| 输出被截断且带工具请求 | 为调用生成失败结果，避免执行截断参数 |
| 工具批次要求终止 | 批次规则参与继续判断 |
| `finishTurn` 返回 `end` | 退出，不再选择下一轮 |
| 工具结果或队列输入 | 可能产生下一次模型请求 |

无工具时通常可以结束，但显式继续和队列仍可能改变结果；批次里也不是任意一个 `terminate` 都会无条件结束整个批次。

## 6. 事件如何更新公开状态

源码摘录：[packages/agent/src/agent.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts#L575)

```ts
private async processEvents(event: AgentEvent): Promise<void> {
	switch (event.type) {
		case "message_start":
			this._state.streamingMessage = event.message;
			break;

		case "message_update":
			this._state.streamingMessage = event.message;
			break;

		case "message_end":
			this._state.streamingMessage = undefined;
			this._state.messages.push(event.message);
			break;

		case "tool_execution_start": {
			const pendingToolCalls = new Set(this._state.pendingToolCalls);
			pendingToolCalls.add(event.toolCallId);
```

开始和增量事件更新正在生成的消息，`message_end` 追加完整消息；工具事件维护待调用集合。订阅者会被等待，因此 `agent_end` 后还需要等监听器和清理完成，Agent 才真正空闲。

## 7. 测试中的时序证据

`agent-loop.test.ts` 覆盖 `finishTurn` 在工具结果后、`turn_end` 前的时序，也覆盖仅追加一次上下文请求、工具顺序与 steering 到达边界。分析状态机时可以把断言中的事件列表与本章控制顺序逐项对应。

下一章进入工具执行流水线。

## 8. 用一次读取走通事件时间线

正常的读取任务可以产生如下事件主干，省略部分增量：

```text
agent_start → turn_start
  user message_start / message_end
  assistant message_start / message_update / message_end
  tool_execution_start → tool_execution_end
  toolResult message_start / message_end
turn_end
turn_start
  assistant message_start / message_update / message_end
turn_end → agent_end
```

第一次 assistant 消息提出工具调用，第二次才根据结果回答；因此一个用户输入能产生多个 turn。事件中的消息是运行时报告的数据，界面不能因为先看到 assistant 文本就假定整段工作完成。

`hasMoreToolCalls` 决定自然的工具后续，`pendingMessages` 表示已选取的插入输入，`explicitContinuation` 表示显式继续是否还未被自然请求满足。这三个变量承担不同控制职责。将它们合并成一个 `while(true)` 加“没有工具就 break”，会丢失队列和钩子的语义。


[继续阅读：Tools：从工具声明到真实副作用](04-tools-and-function-calling.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
