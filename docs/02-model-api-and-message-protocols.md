# 消息协议：模型怎样拿到 README 的内容

模型第一次收到“读取 README”时，文件内容尚未进入请求。第二次请求里出现了文件原文，模型才有材料回答。从第一次到第二次，要区分 Agent 保存的消息、模型层接收的消息列表，以及最终发给具体服务的 HTTP 请求体。这一章跟踪同一个调用标识 `read-1` 穿过这三层。

![Mox 将流式片段组装为消息](../assets/mox-mechanisms/stream.png)

## 第一次请求里有什么

假设项目的 README 介绍一个叫“木星笔记”的工具。本章的 JSON 是从源码规则推导出的教学示意，选取与解释有关的字段。先看用户输入进入 Agent 后的形状。

```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "读取 README.md，告诉我这个项目是做什么的。" }]
}
```

`role` 指消息的作者，`content` 可以包含多个块。用户既可以提交文字也可以提交图片，所以 Pi 用 `type` 标明每个块的形状。TypeScript 把这类“读一个标签就能确定后续字段”的类型写成联合类型。`role === "assistant"` 才能读取模型的 `stopReason`，`role === "toolResult"` 则可以读取 `toolCallId`。运行时的工具对象另放在 `AgentContext.tools` 中，`read.execute` 是宿主进程里的函数。[消息类型](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/types.ts#L561)

模型得知工具名字和参数格式的依据是一条系统消息。`declareToolChanges()` 取出历史系统消息已经声明的工具，再把当前可执行工具转换成声明，计算增删差异。首次提供 `read` 时，声明会进入 `toolsAdded`。稍后移除它时，历史里还可以看到旧调用，当前有效工具集合却已发生变化。[声明变更](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L342) · [只提取声明字段](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/transcript.ts#L123)

| 数据所在位置 | 这次出现的内容 | 消费它的代码 |
| --- | --- | --- |
| Agent 的工具数组 | 名为 `read` 的对象，带 `parameters` 和可执行函数 | `prepareToolCall` 查找它，执行器调用 `execute` |
| 系统消息 | `toolsAdded` 中的 `read` 声明，含名称、描述、参数 Schema | Provider 适配器转换工具定义 |
| 用户消息 | 问题文字，包含字符串 `README.md` | 模型据此决定要调用哪个工具 |

因此“允许读取哪些路径”还要由宿主的实际执行环境或策略实施。把路径写进用户问题，仅仅提供了一个名字。

## 从 Agent 的上下文进入模型层

在一次模型调用即将发出时，`streamAssistantResponse()` 先调用可选的 `transformContext` 选择本次要给模型的材料，再让 `convertToLlm` 把应用专用消息转成模型层识别的 `Message[]`。随后才创建标准化的请求上下文。

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L398)

```ts
let messages = context.messages;
if (config.transformContext) {
	messages = await config.transformContext(messages, signal);
}

// Convert to LLM-compatible messages (AgentMessage[] → Message[])
const llmMessages = await config.convertToLlm(messages);

const llmContext = normalizeContext({ messages: llmMessages });
```

这里的 `await` 表示要等上一步完成。假设历史里有四条旧消息，本次再追加一个问题，一个仅保留最后两条的 `transformContext` 会让转换器只看到“上一条回答、本次问题”。上游测试正是用四条旧消息和一个新问题构造该顺序，两个阶段分别记录数组，最后都得到长度 2。另一个测试捕获送入模型流函数的对象，检查它只有 `messages` 这个键，并检查首条系统消息就是调用者传入的对象。[转换顺序测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/test/agent-loop.test.ts#L253) · [请求形状测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/test/agent-loop.test.ts#L160)

`pi-ai` 的简便调用也能传顶层 `systemPrompt` 和 `tools`。下面是两条入口汇合的函数。传了快捷字段时，`createInitialSystemMessage` 将它们折成一条系统消息。Agent 这条链路传的是已含声明的 `messages`，因此直接沿用消息数组。`as TranscriptContext` 是 TypeScript 的类型断言，真正改变数据形状的是前面构造对象的代码。

源码摘录：[packages/ai/src/utils/transcript.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/transcript.ts#L30)

```ts
export function normalizeContext(context: Context): TranscriptContext {
	const initialMessage = createInitialSystemMessage(context.systemPrompt, context.tools);
	const messages = initialMessage ? [initialMessage, ...context.messages] : context.messages;
	return { messages } as TranscriptContext;
}
```

## 同一份调用怎样写进 Anthropic 请求

适配器接收标准化消息，`buildParams()` 取出首条系统指令，再转换对话、工具定义和请求选项。以普通 API Key、文本输入、固定工具集合为例，首个请求体的相关字段如下。示意简写了系统提示、工具说明及 Schema，省略具体模型名、Token 上限等字段。

```json
{
  "system": [{ "type": "text", "text": "你可以读取项目文件。" }],
  "tools": [{
    "name": "read",
    "description": "读取文件",
    "input_schema": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    }
  }],
  "messages": [{
    "role": "user",
    "content": [{ "type": "text", "text": "读取 README.md，告诉我这个项目是做什么的。" }]
  }],
  "stream": true
}
```

上一步的 `TranscriptContext` 只有 `messages` 一个字段，HTTP 请求却有 `system`、`tools`、`messages`。中间是 `buildParams` 做了拆分。这解释了为什么检查网络请求时，要把观测点放在适配器后面。对于工具动态变更、缓存、OAuth 或特殊模型，适配器还会按相应条件调整请求。[构造请求](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1153) · [工具序列化](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1663)

## 一串参数字符怎样变成调用对象

第一次回答可能只包含一个工具请求。底层流按事件到达，一段参数字符串可能横跨多个事件。下表把同一个工具块的几个时刻展开。片段划分为教学示意，服务可以在别的位置分块。

| 时刻 | 服务给适配器的数据 | Pi 在这一刻做的事 |
| --- | --- | --- |
| 打开内容块 | `tool_use`，ID 为 `read-1`，名字为 `read` | 在输出消息里创建 `toolCall`，用服务的块索引找到它的参数解析器 |
| 第一段字符 | `{"path":"READ` | 将字符交给 `append`，向订阅者发出 `toolcall_delta`，其中携带当前部分消息 |
| 第二段字符 | `ME.md"}` | 同一个解析器继续接收。拼接后的原文成为 `{"path":"README.md"}` |
| 关闭内容块 | `content_block_stop` | 调 `finish()` 解析完整原文，把最终参数或错误写回这个块，然后发出 `toolcall_end` |
| 模型结束响应 | `stop_reason = tool_use` | 映射成 `stopReason = "toolUse"`，最终的 assistant 消息交给循环 |

`ToolCallArgumentsStream` 一方面保留收到的原文，另一方面维护增量解析器给界面显示当前值。最终解析会检查顶层对象形状。假如收到完整的 `[]`，这个值虽然是合法 JSON，却不满足工具参数须为对象的要求，结果会携带空参数和 `argumentsError`。后续工具校验会读取这个错误。即使参数看起来完整，若整个响应因长度上限结束，循环还会走另一条保护分支，见下一章。[流事件处理](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L756) · [增量解析器](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/streaming-json.ts#L452) · [完整参数检查](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/utils/json-parse.ts#L106)

上游怎样确认渐进显示没有弄丢字符？一个测试构造含长正文的 `write` 调用，将参数文本每 24 个字符分一段，检查每个可显示的正文都是最终正文的前缀，长度只能增加或持平。最后它检查整条调用的参数等于最初构造的对象。只断言最后成功会漏掉中途显示回退，只断言界面有文字又会漏掉末尾缺失。[分片输入与断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/test/streaming-tool-arguments.test.ts#L340)

## 第二次请求如何把文件交回模型

文件读取完成后，Pi 有了一条 `role: "toolResult"` 的消息。它带有 `toolCallId: "read-1"` 和一个文本块。将它放进下一次请求时，Anthropic 适配器先构造如下内容块。

源码摘录：[packages/ai/src/api/anthropic-messages.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1334)

```ts
function convertToolResult(msg: ToolResultMessage, content = msg.content): ContentBlockParam {
	return {
		type: "tool_result",
		tool_use_id: msg.toolCallId,
		content: convertContentBlocks(content),
		is_error: msg.isError,
	};
}
```

`convertContentBlocks` 遇到纯文本结果时用换行连接文本块，返回字符串。外层 `convertMessages` 收集相邻的工具结果，把它们装进一条 `user` 角色的消息。于是第二次请求的 `messages` 在原有用户问题后新增两项。以下仅展示这两项，`\n` 表示文件中的换行。

```json
[
  {
    "role": "assistant",
    "content": [{
      "type": "tool_use", "id": "read-1", "name": "read",
      "input": { "path": "README.md" }
    }]
  },
  {
    "role": "user",
    "content": [{
      "type": "tool_result", "tool_use_id": "read-1", "is_error": false,
      "content": "# 木星笔记\n\n一个将 Markdown 笔记整理成索引的命令行工具。\n"
    }]
  }
]
```

网络请求中的第二个 `user` 由适配器生成。`type: "tool_result"` 和 `tool_use_id` 告诉服务，这是对上一条具体调用的答复。假如一次请求里同时读两个文件，两条调用都叫 `read`，这时仍能通过各自的 ID 配对。适配器还会安排中途系统更新的位置，以满足工具请求与结果的相邻关系。[结果内容编码](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L154) · [工具结果分组与消息顺序](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1348)

第二次响应若正常生成解释，`end_turn` 映射为 `stop`。决定这两次请求属于同一次运行的是 Agent Loop。[停止原因映射](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1669)

课程的配套示例用脚本模型接收统一消息，同一输入可以反复重放。运行 `node cli.mjs success --json` 时，`requests[0]` 和 `requests[1]` 保存两次送给模型的消息投影。上文的 Anthropic 请求体是把这些语义映射到另一种协议的示意。[本地运行方法](../examples/read-loop/README.md) · [收集请求的代码](../examples/read-loop/run.mjs)

[继续阅读：一次运行为什么有两轮模型调用](03-agent-loop-state-machine-and-stopping.md) · [课程路线](00-source-learning-path.md)
