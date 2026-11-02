# 工具调用：从一条 read 请求追到文件系统

第一轮模型返回 `{ "path": "README.md" }` 后，真正打开文件的是谁？这次沿 `read-1` 从声明、校验、执行走到结果消息。途中会看到同一个参数的三个形态，以及为什么“工具结束了”和“文件读取成功了”可以有不同答案。

![工具执行流水线中的准备、执行与结果](../assets/tool-calling-illustrations/03-execution-pipeline.png)

## 模型能描述一次读取，运行时能执行一次读取

`read` 的输入 Schema 写在编码工具包里。Schema 是对数据形状的描述，下面的 `Type.Object` 构造对象规则，`Type.Optional` 标记可省略的字段。`path` 必填，`offset` 和 `limit` 可选。描述里说明 `offset` 从 1 开始，真正的下标转换稍后在 `execute` 里发生。

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L13)

```ts
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

`createReadToolDefinition(cwd)` 把这份 Schema、说明文字和实际实现装成工具定义。`createReadTool(cwd)` 通过 `wrapToolDefinition` 将它接入底层 Agent 所需的接口。包装器转发参数，可以为编码工具额外提供扩展上下文，例如当前目录。模型拿到的工具声明只含识别和生成调用所需的信息；执行函数驻留在宿主里。[创建 read](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L85) · [工具包装器](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts#L28)

下面是底层工具完整的执行签名。`Promise<X>` 表示函数异步交付一个 X 类型的结果。

源码摘录：[packages/agent/src/types.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/types.ts#L495)

```ts
execute: (
	toolCallId: string,
	params: AgentToolParams<TParameters>,
	signal?: AbortSignal,
	onUpdate?: AgentToolUpdateCallback<TDetails>,
) => Promise<AgentToolResult<TDetails>>;
```

| 参数或返回值 | 在本次读取中的具体含义 |
| --- | --- |
| `toolCallId` | 模型给出的 `"read-1"`，用来关联执行事件与结果 |
| `params` | 经准备和 Schema 校验后的对象，例如 `{ path: "README.md" }` |
| `signal?` | 可选取消信号，从本次运行传来，工具按自己的实现响应它 |
| `onUpdate?` | 可选函数，工具能在最终返回前报告部分结果，如较长工作的中间输出 |
| `AgentToolResult<TDetails>` | 提供模型可见的 `content`，也可提供给界面或程序调用者使用的数据 |

`AgentToolParams<TParameters>` 中的尖括号表达类型之间的关系：具体工具换一份参数 Schema，其 `params` 的静态类型也可能改变。底层接受普通 JSON Schema、Pi 自己的构造器和可支持的 TypeBox Schema。内置 `read` 仍用 TypeBox 声明，编码工具包装器用 TypeBox 的 `Static` 保留其参数类型。运行时仍需校验模型发来的 JSON，因为模型输出没有经过本机 TypeScript 编译器。[底层类型](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/types.ts#L465) · [编码工具的类型桥接](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts#L6)

## 一次调用如何获得执行资格

模型的完整 assistant 消息包含一个 `type: "toolCall"` 的内容块。取其相关字段如下。

```json
{
  "type": "toolCall",
  "id": "read-1",
  "name": "read",
  "arguments": { "path": "README.md" }
}
```

`prepareToolCall` 首先在当前允许执行的工具数组里按 `name` 查找。找不到就立刻生成失败结果。找到后，依次经过这些步骤。

1. 若工具实现了 `prepareArguments`，先让它兼容旧的参数写法，得到用于校验的调用对象。
2. `validateToolArguments` 读取参数解析错误标记，随后复制参数，用工具 Schema 解析副本。解析成功返回 `result.value`，它可以含经过类型转换的值。失败时抛出的诊断带有字段路径和收到的参数。
3. 配置了 `beforeToolCall` 时，把原始调用和经过校验的 `args` 一同交给它。钩子返回 `{ block: true, reason: "…" }` 时直接生成失败结果。在若干检查点发现取消信号时也直接结束准备。
4. 通过后返回带 `kind: "prepared"` 的对象，其中装着查到的工具和最终参数。执行器据此调 `tool.execute`。[准备阶段](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L718) · [校验实现](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/validation.ts#L54)

源码摘录：[packages/ai/src/utils/validation.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/validation.ts#L58)

```ts
// A copy, so tools that modify their arguments never modify the tool call in the transcript.
const result = getValidator(tool.parameters).parse(structuredClone(toolCall.arguments));
if (result.ok) {
	return result.value;
}
```

`structuredClone` 复制的是实际 JSON 数据。举个例子，模型可能把 `offset` 写成字符串 `"41"`。当数值 Schema 将它转换成数字时，工具能拿到数值，原始 assistant 消息里仍保留模型发来的字符串。如果钩子还要改写 `args`，这里会直接影响工具收到的值。低层 Agent 在钩子之后直接传递该对象，不会再跑一次同样的校验。上游测试先按字符串 Schema 校验 `"hello"`，钩子把值改成数字 123，断言工具执行时收到了 `[123]`。原始调用、校验产物和最终执行参数值得分别观察。[参数变更测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/test/agent-loop.test.ts#L528)

## 真正读磁盘的几行代码

`read` 选择 `ctx?.cwd || cwd` 作为相对路径的基准。`resolveReadPathAsync` 将输入解析成要读取的路径。接着用 `ops.access` 检查可读性，再检测是否是支持的图片。`ops` 由创建工具时注入，默认实现绑定 Node 的文件系统。因而同样的接口也能配上远程读取后端。[路径及读取检查](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L121)

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L56)

```ts
const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

对于普通文本文件，下面的读取将字节解码为 UTF-8，按换行切分，再把从 1 起算的 `offset` 换成数组下标。若起点越界，抛出含总行数的错误。

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L154)

```ts
const buffer = await ops.readFile(absolutePath);
const textContent = buffer.toString("utf-8");
const allLines = textContent.split("\n");
const totalFileLines = allLines.length;
// Apply offset if specified. Convert from 1-indexed input to 0-indexed array access.
const startLine = offset ? Math.max(0, offset - 1) : 0;
const startLineDisplay = startLine + 1;
// Check if offset is out of bounds.
if (startLine >= allLines.length) {
	throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
}
```

没有显式 `offset` 和 `limit`，且文件够小时，结果的文本等于文件原文。用另一组数字走一遍分页，可以看清每行边界是怎么来的。假设文件正好有 100 行，行间用换行连接，结尾没有额外换行符。调用 `read({ path: "notes.txt", offset: 41, limit: 20 })` 后：

| 中间值 | 算法或结果 |
| --- | --- |
| `startLine` | `41 - 1 = 40`，数组索引 40 对应人读的第 41 行 |
| `endLine` | `min(40 + 20, 100) = 60` |
| `allLines.slice(40, 60)` | 左闭右开，含索引 40 至 59，即文件第 41 至 60 行 |
| 剩余与下一次起点 | `100 - (40 + 20) = 40` 行，下一次 `offset = 61` |

工具将选择出的文本交给 `truncateHead`，再按结果决定提示语。在这个短行例子里，用户的 `limit` 先让读取停下，返回文本末尾带 `[40 more lines in file. Use offset=61 to continue.]`。即使没有指定 `limit`，默认保护也限制输出为最多 2000 行、50 × 1024 字节，两者以先到者为准。一行独自超过字节上限时，会返回说明及建议的后续命令。图片则走二进制读取和图像处理分支，可产生图片块。这里限制的是交付给模型的输出。文本路径先 `readFile` 整个文件再切片，大文件磁盘读入量仍受文件本身影响。[行与字节限制](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/truncate.ts#L11) · [读取与截断](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L165) · [分页测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/tools.test.ts#L158)

## 同一份读取结果有三个去向

回到木星笔记的 README，文件很短。下列对象是这个分支返回值的字段示意。正常读取的 `details` 在 JavaScript 里是 `undefined`，序列化成 JSON 时该键会省略。

```ts
{
  content: [{ type: "text", text: "# 木星笔记\n\n一个将 Markdown 笔记整理成索引的命令行工具。\n" }],
  details: undefined,
  structuredContent: "# 木星笔记\n\n一个将 Markdown 笔记整理成索引的命令行工具。\n"
}
```

- **给模型。** `content` 是内容块数组。`createToolResultMessage` 把它与调用 ID、工具名、错误标记、时间戳等组成 `role: "toolResult"` 的消息。模型适配器会从中取出协议所需的字段。
- **给界面或日志。** `details` 可以承载截断信息等展示资料。执行耗时 `durationMs` 由运行时计量，真正执行过才有执行耗时。准备阶段就被拦截时该字段可缺省。
- **给程序调用者。** `structuredContent` 是符合该工具输出 Schema 的机器可读结果。`read` 在纯文本场景下直接提供字符串，使调用代码可取得文本，不必从展示块中寻找它。构建 `ToolResultMessage` 时没有把这个字段复制给模型。[read 结果组装](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/read.ts#L203) · [结果契约](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/types.ts#L424)

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L940)

```ts
function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		// Untyped tools (JS extensions) can return results without content; normalize
		// so the null never enters session history or provider payloads.
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		isError: finalized.isError,
		...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
		timestamp: Date.now(),
	};
}
```

`executePreparedToolCall` 调用 `execute` 并等待返回。在执行期间，`onUpdate` 可以产生 `tool_execution_update` 事件，运行时收集并等待这些通知。工具 Promise 结束后通过 `acceptingUpdates` 关闭这次调用的更新入口。接着 `finalizeExecutedToolCall` 让后置钩子检查或替换结果。若后置钩子改了 `content` 却未同步提供 `structuredContent`，旧的结构化结果会被清除，避免两个表示互相矛盾。[执行与后处理](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L831)

## 文件不存在时，错误由谁接住

`read.execute` 直接读一个不存在的文件，会拒绝它的 Promise。上游工具测试专门用临时目录里的 `nonexistent.txt` 验证错误含 `ENOENT` 或 `not found`。但在模型调用中，还有一层 `executePreparedToolCall`：它捕获异常，将错误信息包装成文本结果并设 `isError: true`。随后以同一个 `read-1` 生成工具结果消息，下一轮模型就有机会向用户说明为何没读到文件。[不存在文件的测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/tools.test.ts#L95) · [运行时捕获异常](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L854)

| 观测到的结果 | 是否进入工具的 `execute` | 如何定位 |
| --- | --- | --- |
| 找不到名为 `read` 的工具 | 否 | 核对本次实际工具集合和模型调用名称 |
| 缺少必填的 `path`，或最终参数有解析错误 | 否 | 查看原始 `arguments`、Schema 校验或解析诊断 |
| `beforeToolCall` 拒绝读取 | 否 | 查看钩子返回的原因 |
| `ENOENT` 或读取权限错误 | 是 | 查看实际路径、宿主目录和 `ops.access` 或读取错误 |
| 正常文本或截断提示 | 是 | 区分文件结束、用户 `limit`、默认输出限制 |

执行器在准备前就会发 `tool_execution_start`。因此单看“工具开始”事件无法判定文件系统已被访问。查看错误阶段与是否有执行耗时，可以进一步区分是哪一步没通过。

## 两个工具并行时，结果会按什么顺序出现

假设一次响应请求读取 A、B，B 先读完。默认并行路径仍会依请求顺序逐个准备参数和运行前置钩子。准备好后将可执行动作作为函数保存，统一启动并等待 `Promise.all`。每个动作完成时先发自己的 `tool_execution_end`，所以界面可能先显示 B 完成。`Promise.all` 返回数组的位置对应原输入，接下来循环再按 A、B 的顺序生成消息并加入上下文。[并行执行与有序写回](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L596)

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L656)

```ts
const orderedFinalizedCalls = await Promise.all(
	finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
);
const messages: ToolResultMessage[] = [];
for (const finalized of orderedFinalizedCalls) {
	const toolResultMessage = createToolResultMessage(finalized);
	await emitToolResultMessage(toolResultMessage, emit);
	messages.push(toolResultMessage);
}
```

上游的并行测试用一个由外部解除的 Promise 暂停 `tool-1`，让 `tool-2` 先完成。它分别收集完成事件、工具消息和轮次中的工具结果，得到三组次序。

源码摘录：[packages/agent/test/agent-loop.test.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/test/agent-loop.test.ts#L756)

```ts
expect(parallelObserved).toBe(true);
expect(toolExecutionEndIds).toEqual(["tool-2", "tool-1"]);
expect(toolResultIds).toEqual(["tool-1", "tool-2"]);
expect(turnToolResultIds).toEqual(["tool-1", "tool-2"]);
```

若配置指定 `toolExecution: "sequential"`，或这一批中任何已注册工具声明 `executionMode: "sequential"`，整个批次改走顺序路径。第一个工具的准备、执行、结果通知完成后才开始下一个。这条分支关系到有副作用的工作，例如第二个动作需要读取第一个动作刚写出的文件。[批次模式选择](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L518) · [可控等待与断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/test/agent-loop.test.ts#L668)

### 程序内部再调用工具

程序化工具（如 Code Mode）可以在宿主代码中调用其他工具。低层 `runToolCall` 复用查找、准备、校验、前置钩子、执行与后置钩子。这个入口返回 `AgentToolCallOutcome`，自身不向对话追加消息，也不自动发顶层模型工具事件。因此一个父调用可以在程序内部处理多个子结果，再决定交回模型的内容。要观察内部动作，应查看具体调用者如何接入进度和结果，而仅靠计数 assistant 消息里的工具块会少算。[嵌套调用入口](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L817)

在课程的本地示例中，`node cli.mjs missing` 让脚本模型请求不存在的 `absent.md`。实测 `read.execute` 进入 1 次，随后 `read-1` 收到 `isError=true`。与上一章截断场景的 0 次对照，两条同为错误的工具结果就能定位到不同的失败阶段。[运行方法](../examples/read-loop/README.md) · [磁盘读取入口](../examples/read-loop/cli.mjs)

[继续阅读：上下文工程与结构化输出](05-context-engineering-and-structured-output.md) · [课程路线](00-source-learning-path.md)
