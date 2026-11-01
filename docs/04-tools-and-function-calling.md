# Tools：从工具声明到真实副作用

本章沿 `read` 请求的执行过程，解释工具查找、参数校验、钩子、执行、进度、失败与结果。模型生成请求之后，实际动作仍需要经过这条宿主代码路径。

![Mox 解释本章的机制关系](../assets/mox-mechanisms/loop.png)

## 1. 工具的两面

模型需要工具名、说明和参数 Schema；宿主还需要 `execute`、取消信号及进度更新。`AgentTool` 在声明上增加执行能力。

源码摘录：[packages/agent/src/types.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts#L466)

```ts
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
	/** Human-readable label for UI display. */
	label: string;
	/**
	 * Optional compatibility shim for raw tool-call arguments before schema validation.
	 * Must return an object that matches `TParameters`.
	 */
	prepareArguments?: (args: unknown) => Static<TParameters>;
	/**
	 * JSON Schema of `structuredContent` in successful results. Tools that declare it should always
	 * set `structuredContent`.
	 */
	outputSchema?: TSchema;
	/**
	 * Execute the tool call. Throw on failure, or return a result with `isError: true`; do not only
	 * describe the failure in `content`.
	 */
	execute: (
```

Schema 能检查结构和类型，不能判断一条结构合法的命令是否符合用户目的。动作策略与执行环境要在其他边界落实。

## 2. `read` 如何读取文件

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts#L14)

```ts
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

`createReadToolDefinition()` 产生工具定义；`createReadTool()` 再包装成 Agent 可用对象。`execute()` 解析路径、检查可读性、区分图片与文本，并处理行偏移、输出行数与字节截断。

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts#L57)

```ts
const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

`ReadOperations` 可由宿主替换，用同一个工具接口连接其他执行环境。只设置工作目录不会自动得到这种隔离。

## 3. 准备和校验在执行之前

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L736)

```ts
const preparedToolCall = prepareToolCallArguments(tool, toolCall);
const validatedArgs = validateToolArguments(tool, preparedToolCall);
if (config.beforeToolCall) {
	const beforeResult = await config.beforeToolCall(
		{
			assistantMessage,
			toolCall,
			args: validatedArgs,
			context: currentContext,
		},
		signal,
	);
```

`prepareToolCall()` 先查找工具，再准备并校验参数，随后执行配置的 `beforeToolCall`。不存在的工具、参数错误或被阻止的请求会形成失败结果。

钩子能修改参数，而修改后不会自动再次做 Schema 校验。测试 `should execute mutated beforeToolCall args without revalidation` 明确覆盖此行为；扩展作者要保证修改后的参数有效。

## 4. 执行、更新与结果

`executePreparedToolCall()` 调用工具函数，接收部分进度，等待已接受的更新并记录耗时。异常会变成失败结果；工具也能在结果中显式报告失败。调用完成后到达的更新会被忽略。

`afterToolCall` 可以影响最终结果，却无法撤销已发生的文件写入或网络请求。最终消息与外部动作是需要分别核对的两类事实。

## 5. 并行执行与持久化顺序

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L526)

```ts
	const hasSequentialToolCall = toolCalls.some(
		(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
	);
	if (config.toolExecution === "sequential" || hasSequentialToolCall) {
		return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

```

全局配置或批次内工具要求可强制顺序执行，否则走并行路径。并行时结束事件按完成时机到达，工具结果仍按请求源顺序组织。关联依靠 `toolCallId`，不依赖哪个工具先返回。

## 6. Code Mode 与嵌套工具

[`extensions/codemode/tool.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/extensions/codemode/tool.ts) 和 AgentSession 的嵌套调用路径展示另一种组织方式：模型提出脚本请求，脚本里的工具调用由宿主调度。工具搜索则帮助发现能力。

它们改变能力的呈现和组合方式，但仍需要输入校验、工具选择、取消与输出限制。嵌套调用记录有自己的作用范围，不能当成向模型开放任意宿主对象。

## 7. 怎样验证行为

参数准备、参数变更、截断请求、并行结束顺序、强制顺序工具和终止批次都有独立测试。这些测试使“调用失败”能进一步定位到准备、执行或结果阶段。下一章研究工具结果如何进入模型 Context。

## 8. 一次失败到底发生在哪一层

以 `read` 请求为例，可以区分这些结果：

| 故障 | 发生位置 | 是否已读取文件 |
| --- | --- | --- |
| 工具名不存在 | `prepareToolCall` 查找 | 没有 |
| `path` 参数不合法 | Schema 校验 | 没有 |
| 策略钩子阻止 | 执行前 | 没有 |
| 文件不存在或不可读 | `read.execute` 的路径及访问处理 | 未成功读取 |
| 结果太长 | 输出处理与截断 | 可能已读取完整内容，模型只收到部分 |
| 结果后处理异常 | 执行后的钩子或结果路径 | 动作可能已经发生 |

尤其要区分最后两种。模型收到短文本，不代表文件只读取了那么多字节；工具显示失败，也不保证外部世界没有变化。对写操作和网络请求，这个区别更关键。


[继续阅读：Context Engineering：每次请求到底给模型什么](05-context-engineering-and-structured-output.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
