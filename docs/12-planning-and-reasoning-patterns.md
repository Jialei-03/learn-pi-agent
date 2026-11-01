# Planning 与 Reasoning：从推理配置到可执行计划

本章区分模型推理、可见说明、行动计划和产品中的 Plan Mode。它们都与“思考”有关，但在代码里有不同的数据和控制位置。

![Mox 解释本章的机制关系](../assets/planning-reasoning-illustrations/00-four-layers.png)

## 1. 推理强度是请求配置

Agent 的 `thinkingLevel` 会进入循环配置，并由模型层根据 Provider 能力转换为请求参数：

源码摘录：[packages/agent/src/agent.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts#L476)

```ts
private createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
	let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
	return {
		model: this._state.model,
		reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
		sessionId: this.sessionId,
		onPayload: this.onPayload,
		onResponse: this.onResponse,
		onProviderStreamEvent: this.onProviderStreamEvent,
		transport: this.transport,
		thinkingBudgets: this.thinkingBudgets,
		maxRetryDelayMs: this.maxRetryDelayMs,
```

Provider 返回的 thinking 内容是另一类响应内容块；用量统计又是另一类数据。请求较高推理强度，不代表应用获得完整的内部推理过程，也不能保证所有任务质量提升。

## 2. 计划要包含可检查的信息

自然语言说“先分析再修改”可以帮助沟通；要驱动应用，还需要步骤、依赖、状态、验证证据和执行边界。计划可能因新结果而变化，因此应记录变化而不是假设第一次计划永久正确。

模型可以提出计划，宿主仍负责决定工具、执行权限、取消和完成条件。仅在系统提示写“现在只读”不能替代工具或执行环境的约束。

## 3. Pi 的 Plan Mode 扩展示例

[`examples/extensions/plan-mode/index.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts) 展示模式切换：保存并更改活动工具，在工具调用阶段检查动作，并在运行准备时贡献计划上下文。

源码摘录：[packages/coding-agent/examples/extensions/plan-mode/index.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts#L108)

```ts
	pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
}

function restoreNormalModeTools(): void {
	pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
	toolsBeforePlanMode = undefined;
}

```

这是一种可选扩展的实际实现。它能展示工具集、钩子和 UI 状态怎样共同工作；命令字符串判断仍不具备操作系统沙箱的强制隔离能力。

## 4. ReAct、反思与搜索的边界

ReAct 将推理与外部观察交替组织，是理解工具循环的重要背景。Pi 的工具循环可以用相近的观察—行动结构解释，但不能据此断言每个实现细节直接来自论文。

Self-Refine 一类方法通过反馈再改写；候选采样与树搜索则需要保存多个候选、评估与选择。只有再调用一次模型，不足以证明完整实现了这些算法。

## 5. 停止条件是计划执行的一部分

循环需要预算、最大次数、取消和验证标准。计划中写了测试，不代表测试已经执行；代码改完后应关联实际命令与结果。评审模型的文字结论也需要与执行证据对照。

## 6. 代码阅读顺序

先看 Agent 中请求配置的传递，再看所选 Provider 的参数映射；之后读 Plan Mode 扩展的工具切换、事件处理和状态恢复。这样能把模型能力、提示方法和产品控制分别定位。

下一章把这些机制放进 SDK，追踪一个应用如何创建、使用和销毁 Session。

## 7. 从模式切换追踪到执行检查

Plan Mode 示例并非只加一句提示。它先改变活动工具集，然后在 `tool_call` 阶段检查相关动作，并在 `before_agent_start` 提供模式上下文。工具可见性、实际动作拦截和模型提示在不同位置发挥作用。

这三个位置也有不同局限：活动工具集影响模型请求能力，工具拦截依赖实际调用路径，提示只能引导模型行为。完整沙箱仍在它们之外。

因此评估计划机制应分别观察：模型是否产生可用计划、工具能否绕过模式限制、状态能否恢复，以及执行结果是否符合计划。四个问题不能用“模型给出了一张步骤列表”一起回答。


[继续阅读：SDK 与应用集成：从启动装配到资源释放](13-agent-sdk-and-app-integration.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
