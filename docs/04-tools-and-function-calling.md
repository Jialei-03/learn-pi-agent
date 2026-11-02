# 工具调用：从一条 read 请求追到文件系统

第一轮模型返回 `{ "path": "README.md" }` 后，真正打开文件的是谁？这次沿 `read-1` 从声明、校验、执行走到结果消息。途中会看到同一个参数的三个形态，以及为什么“工具结束了”和“文件读取成功了”可以有不同答案。

![工具执行流水线中的准备、执行与结果](../assets/tool-calling-illustrations/03-execution-pipeline.png)

## 模型能描述一次读取，运行时能执行一次读取

`read` 的输入 Schema 写在编码工具包里。Schema 是对数据形状的描述，下面的 `Type.Object` 构造对象规则，`Type.Optional` 标记可省略的字段。`path` 必填，`offset` 和 `limit` 可选。描述里说明 `offset` 从 1 开始，真正的下标转换稍后在 `execute` 里发生。

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L13)

```ts
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

`createReadToolDefinition(cwd)` 把这份 Schema、说明文字和实际实现装成工具定义。`createReadTool(cwd)` 通过 `wrapToolDefinition` 将它接入底层 Agent 所需的接口。包装器转发参数，可以为编码工具额外提供扩展上下文，例如当前目录。模型拿到的工具声明只含识别和生成调用所需的信息；执行函数驻留在宿主里。[创建 read](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L85) · [工具包装器](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts#L28)

下面是底层工具完整的执行签名。`Promise<X>` 表示函数异步交付一个 X 类型的结果。

源码摘录：[packages/agent/src/types.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/types.ts#L495)

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

`AgentToolParams<TParameters>` 中的尖括号表达类型之间的关系：具体工具换一份参数 Schema，其 `params` 的静态类型也可能改变。底层接受普通 JSON Schema、Pi 自己的构造器和可支持的 TypeBox Schema。内置 `read` 仍用 TypeBox 声明，编码工具包装器用 TypeBox 的 `Static` 保留其参数类型。运行时仍需校验模型发来的 JSON，因为模型输出没有经过本机 TypeScript 编译器。[底层类型](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/types.ts#L465) · [编码工具的类型桥接](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts#L6)

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
4. 通过后返回带 `kind: "prepared"` 的对象，其中装着查到的工具和最终参数。执行器据此调 `tool.execute`。[准备阶段](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L718) · [校验实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/validation.ts#L54)

源码摘录：[packages/ai/src/utils/validation.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/validation.ts#L58)

```ts
// A copy, so tools that modify their arguments never modify the tool call in the transcript.
const result = getValidator(tool.parameters).parse(structuredClone(toolCall.arguments));
if (result.ok) {
	return result.value;
}
```

`structuredClone` 复制的是实际 JSON 数据。举个例子，模型可能把 `offset` 写成字符串 `"41"`。当数值 Schema 将它转换成数字时，工具能拿到数值，原始 assistant 消息里仍保留模型发来的字符串。如果钩子还要改写 `args`，这里会直接影响工具收到的值。低层 Agent 在钩子之后直接传递该对象，不会再跑一次同样的校验。上游测试先按字符串 Schema 校验 `"hello"`，钩子把值改成数字 123，断言工具执行时收到了 `[123]`。原始调用、校验产物和最终执行参数值得分别观察。[参数变更测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L528)

## 真正读磁盘的几行代码

`read` 选择 `ctx?.cwd || cwd` 作为相对路径的基准。`resolveReadPathAsync` 将输入解析成要读取的路径。接着用 `ops.access` 检查可读性，再检测是否是支持的图片。`ops` 由创建工具时注入，默认实现绑定 Node 的文件系统。因而同样的接口也能配上远程读取后端。[路径及读取检查](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L121)

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L56)

```ts
const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

对于普通文本文件，下面的读取将字节解码为 UTF-8，按换行切分，再把从 1 起算的 `offset` 换成数组下标。若起点越界，抛出含总行数的错误。

源码摘录：[packages/coding-agent/src/core/tools/read.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L154)

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

工具将选择出的文本交给 `truncateHead`，再按结果决定提示语。在这个短行例子里，用户的 `limit` 先让读取停下，返回文本末尾带 `[40 more lines in file. Use offset=61 to continue.]`。即使没有指定 `limit`，默认保护也限制输出为最多 2000 行、50 × 1024 字节，两者以先到者为准。一行独自超过字节上限时，会返回说明及建议的后续命令。图片则走二进制读取和图像处理分支，可产生图片块。这里限制的是交付给模型的输出。文本路径先 `readFile` 整个文件再切片，大文件磁盘读入量仍受文件本身影响。[行与字节限制](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/truncate.ts#L11) · [读取与截断](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L165) · [分页测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/tools.test.ts#L158)

### 双重截断预算怎样精确计算

上一段的 `limit` 是调用者指定的行数。另一个独立决策发生在 `truncateHead` 里：即使行数允许，也必须让整段文本符合字节上限。有些程序会直接 `text.slice(0, maxBytes)`，但 JS 字符串下标以 UTF-16 码元计，写入文件或发送网络时常用 UTF-8 字节，同一个字符在两者里的长度可能不同。截断到任意字符位置还会把一行代码拆成两半，使后续“从第几行继续”变得不明确。Pi 的头部截断器因此逐个接纳**完整行**，并给换行分隔符也预留一个字节。[截断器实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/truncate.ts#L78)

源码摘录：[packages/coding-agent/src/core/tools/truncate.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/truncate.ts#L126)

```ts
for (let i = 0; i < lines.length && i < maxLines; i++) {
	const line = lines[i];
	const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0); // +1 for newline

	if (outputBytesCount + lineBytes > maxBytes) {
		truncatedBy = "bytes";
		break;
	}

	outputLinesArr.push(line);
	outputBytesCount += lineBytes;
}
```

把上限缩小，计算就能在纸上完成。用三行 `A`、`中`、`BC` 作为输入，各行 UTF-8 的正文长度是 1、3、2 字节。两处换行各占 1 字节，所以整个输入有 8 字节，JavaScript 的 `text.length` 则是 6。现在把字节限额设为 7、行数上限设为 3。第一行进入后用掉 1；第二行连同前面的换行再花 4，累计 5；最后一行还要 3，放入会到 8。虽然还剩 2 字节，收纳整行的条件已经不成立，只能保留前两行。把字节限额改成 8，整份输入恰好装下。这个例子只有一个汉字，已经足以区分“最多多少个字符”和“最多多少个字节”。

在示例目录执行 `node boundaries.mjs bytes`，脚本直接调用 Pi 导出的 `truncateHead`，实测为下表四组结果。表里 `\n` 表示真实换行。[可运行示例](../examples/read-loop/boundaries.mjs)

| 行数上限 | 字节上限 | 交付的文本 | 输出字节 | `truncatedBy` |
| --- | --- | --- | --- | --- |
| 3 | 5 | `A\n中` | 5 | `bytes` |
| 3 | 7 | `A\n中` | 5 | `bytes` |
| 3 | 8 | `A\n中\nBC` | 8 | `null` |
| 2 | 8 | `A\n中` | 5 | `lines` |

两次返回同样的前两行，原因却可能不同。外层 `read` 根据 `truncatedBy` 决定是否在提示里指出字节限制，用 `outputLines` 计算下一次 `offset`。例如从第 41 行起，只要交付了两行，不论是第一列的行限制还是第二列的字节限制，下一次都应从第 43 行读。预算和续读位置分别使用字节与行两个单位，不能拿 `outputBytes` 去给 `offset` 加五。

还有一个需要单独处理的边界。把文件改成单行很长的压缩 JSON，让**第一行**就比字节限额大。此时连第一行都无法完整交付，`outputLines` 为零。如果照搬“下一页从起点加已输出行数开始”，起点不会前进，模型反复读取仍只会得到同一个空片段。因此截断器额外返回 `firstLineExceedsLimit`，外层 `read` 为该情形生成独立说明，让模型知道必须改用局部读取的策略。提示中即使出现 Shell 命令文字，也只是给下一轮的建议；是否生成请求和执行命令，仍要再经过模型、工具表和执行策略。[首行超限分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L176)

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
- **给程序调用者。** `structuredContent` 是符合该工具输出 Schema 的机器可读结果。`read` 在纯文本场景下直接提供字符串，使调用代码可取得文本，不必从展示块中寻找它。构建 `ToolResultMessage` 时没有把这个字段复制给模型。[read 结果组装](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/read.ts#L203) · [结果契约](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/types.ts#L424)

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L940)

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

`executePreparedToolCall` 调用 `execute` 并等待返回。在执行期间，`onUpdate` 可以产生 `tool_execution_update` 事件，运行时收集并等待这些通知。工具 Promise 结束后通过 `acceptingUpdates` 关闭这次调用的更新入口。接着 `finalizeExecutedToolCall` 让后置钩子检查或替换结果。若后置钩子改了 `content` 却未同步提供 `structuredContent`，旧的结构化结果会被清除，避免两个表示互相矛盾。[执行与后处理](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L831)

### 后置钩子替换内容时，哪份结果仍然有效

以一个生成项目说明的工具为例，假定它原本返回模型可见正文“仓库标识为 A”，并把 `{id:"A"}` 放在 `structuredContent` 里。现在上层要向用户只显示“标识已隐藏”。如果只替换正文，同时让调用程序读到旧的结构化值，就会有两份互不同步的信息。`finalizeExecutedToolCall` 为此分别处理“改正文”“改程序值”“改展示细节”，然后才创建最终消息。看起来像普通的对象合并，这里其实表达了字段之间的依赖关系。

| 后置钩子提供的改动 | 进入后续程序的 `structuredContent` | 原因 |
| --- | --- | --- |
| 只替换 `content` | 清除 | 新正文未提供与它匹配的结构化结果 |
| 只替换 `structuredContent` | 使用新值 | 程序消费的部分已被明确更新 |
| 同时替换这两项 | 使用新值 | 钩子明确给出两种表示 |
| 只改 `details` | 继承旧值 | 展示元数据的变化无需使原程序值失效 |

上游测试用同一调用跑四次，每次钩子只返回表中一种改动，断言得到的结构化结果数组依次是 `undefined`、替换值、同时提供的新值、原值。这个机制只根据受支持的返回字段做合并，并不检查正文与结构化数据在业务意义上是否一致。若钩子明确提供一对矛盾的值，两者仍可各自传给相应消费者。设计自己的工具时，先决定谁消费哪种表示，再确定修改行为在哪一层统一实施。[钩子合并代码](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L891) · [四种更新的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L2214)

## 文件不存在时，错误由谁接住

`read.execute` 直接读一个不存在的文件，会拒绝它的 Promise。上游工具测试专门用临时目录里的 `nonexistent.txt` 验证错误含 `ENOENT` 或 `not found`。但在模型调用中，还有一层 `executePreparedToolCall`：它捕获异常，将错误信息包装成文本结果并设 `isError: true`。随后以同一个 `read-1` 生成工具结果消息，下一轮模型就有机会向用户说明为何没读到文件。[不存在文件的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/tools.test.ts#L95) · [运行时捕获异常](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L854)

| 观测到的结果 | 是否进入工具的 `execute` | 如何定位 |
| --- | --- | --- |
| 找不到名为 `read` 的工具 | 否 | 核对本次实际工具集合和模型调用名称 |
| 缺少必填的 `path`，或最终参数有解析错误 | 否 | 查看原始 `arguments`、Schema 校验或解析诊断 |
| `beforeToolCall` 拒绝读取 | 否 | 查看钩子返回的原因 |
| `ENOENT` 或读取权限错误 | 是 | 查看实际路径、宿主目录和 `ops.access` 或读取错误 |
| 正常文本或截断提示 | 是 | 区分文件结束、用户 `limit`、默认输出限制 |

执行器在准备前就会发 `tool_execution_start`。因此单看“工具开始”事件无法判定文件系统已被访问。查看错误阶段与是否有执行耗时，可以进一步区分是哪一步没通过。

## 两个工具并行时，结果会按什么顺序出现

假设一次响应请求读取 A、B，B 先读完。默认并行路径仍会依请求顺序逐个准备参数和运行前置钩子。准备好后将可执行动作作为函数保存，统一启动并等待 `Promise.all`。每个动作完成时先发自己的 `tool_execution_end`，所以界面可能先显示 B 完成。`Promise.all` 返回数组的位置对应原输入，接下来循环再按 A、B 的顺序生成消息并加入上下文。[并行执行与有序写回](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L596)

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L656)

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

源码摘录：[packages/agent/test/agent-loop.test.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L756)

```ts
expect(parallelObserved).toBe(true);
expect(toolExecutionEndIds).toEqual(["tool-2", "tool-1"]);
expect(toolResultIds).toEqual(["tool-1", "tool-2"]);
expect(turnToolResultIds).toEqual(["tool-1", "tool-2"]);
```

若配置指定 `toolExecution: "sequential"`，或这一批中任何已注册工具声明 `executionMode: "sequential"`，整个批次改走顺序路径。第一个工具的准备、执行、结果通知完成后才开始下一个。这条分支关系到有副作用的工作，例如第二个动作需要读取第一个动作刚写出的文件。[批次模式选择](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L518) · [可控等待与断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L668)

这条并行路径还有一个时序区别。在准备阶段就失败的 B 可以立刻发出 `tool_execution_end`，同时在结果列表里占一个位置。准备成功的 A 则先以待执行函数的形式保存。等整批准备完，才启动所有可执行项。因而 B 的结束事件甚至可能早于 A 的函数体启动。`tool_execution_start` 到 `tool_execution_end` 之间包含等待、校验和钩子，不能把这段墙钟时间直接解释成操作系统实际读文件的时间。执行器单独用 `performance.now()` 在调用 `execute` 前后计量，正是为了让两个问题有各自的观察点。[并行准备阶段](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L596) · [执行耗时测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L402)

### 程序内部再调用工具

程序化工具（如 Code Mode）可以在宿主代码中调用其他工具。低层 `runToolCall` 复用查找、准备、校验、前置钩子、执行与后置钩子。这个入口返回 `AgentToolCallOutcome`，自身不向对话追加消息，也不自动发顶层模型工具事件。因此一个父调用可以在程序内部处理多个子结果，再决定交回模型的内容。要观察内部动作，应查看具体调用者如何接入进度和结果，而仅靠计数 assistant 消息里的工具块会少算。[嵌套调用入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L817)

在课程的本地示例中，`node cli.mjs missing` 让脚本模型请求不存在的 `absent.md`。实测 `read.execute` 进入 1 次，随后 `read-1` 收到 `isError=true`。与上一章截断场景的 0 次对照，两条同为错误的工具结果就能定位到不同的失败阶段。[运行方法](../examples/read-loop/README.md) · [磁盘读取入口](../examples/read-loop/cli.mjs)

> **先预测**　给 read 指定 limit=1，是不是意味着 Pi 在磁盘上只读一行？
>
> **核对推导**　普通文本路径先读文件、解码、按行切分，再对返回给模型的内容应用行数和字节限制。结果只含一行不能证明磁盘只读了一行；要验证磁盘读取量，应观察文件操作那一层。

[继续阅读：上下文工程与结构化输出](05-context-engineering-and-structured-output.md) · [课程路线](00-source-learning-path.md)
