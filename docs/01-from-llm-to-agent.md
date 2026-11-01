# 从一次模型调用到 Agent：沿源码读懂一个工具循环

这一章围绕一个具体任务，追踪 Pi 怎样让模型和工具一起工作：

> 读取当前项目的 `README.md`，解释这个项目是做什么的。

读完这一章，你会看到用户输入如何变成消息，模型如何提出工具调用，Pi 怎样执行真正的文件读取，以及工具结果如何进入下一次模型请求。文中的代码片段直接来自 Pi 源码，部分片段为了聚焦只截取相关行；示例消息则是为了说明过程而写的，不是一次真实运行的日志。

![Mox 在模型与文件工具之间传递调用和结果](../assets/mox-mechanisms/loop.png)

## 1. 一次模型调用和一次 Agent 运行

一次普通模型调用可以概括为：程序准备输入，模型生成响应，程序接收响应。如果问题是“法国的首都是什么”，一次响应可能就够了。

但模型并不会因为你提到 `README.md`，就自动获得你电脑里的文件。程序需要给模型提供 `read` 这样的工具；模型提出工具调用后，程序再执行具体操作，并把结果交回模型。

```text
用户提出问题
    ↓
程序准备消息并请求模型
    ↓
模型返回：请求调用 read
    ↓
程序执行 read，得到文件内容
    ↓
程序把工具结果加入消息
    ↓
再次请求模型，生成回答
```

这里有三种不同的职责：

| 部分 | 实际负责什么 |
| --- | --- |
| 模型 | 根据当前输入生成文本或工具调用请求 |
| 工具 | 以代码实现读文件、运行命令等能力 |
| Agent 运行时 | 组织模型调用、工具执行、状态和事件，决定怎样推进运行 |

这一章会用 Pi 的具体代码验证这条路径。它不是说所有任务都一定需要调用工具：模型也可以直接返回文本。

## 2. 用户输入从哪里进入 Pi？

在交互模式中，用户提交文字后，[`interactive-mode.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts) 会调用 `this.session.prompt(text)`。`session` 是 Coding Agent 层的 `AgentSession`，它还负责会话、资源、扩展以及其他产品层工作。

随后，在 [`agent-session.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts) 中，普通的运行路径最终会调用 `this.agent.prompt(messages)`。这里的 `agent` 来自更底层的 `pi-agent-core`。

可以先把它们的关系写成：

```text
交互界面
  → AgentSession.prompt(...)
  → Agent.prompt(...)
  → Agent Loop
```

这条图省略了输入预处理、命令、扩展和队列等分支，展示的是普通交互输入的主线。两个 `prompt` 属于不同对象：前者是应用层会话入口，后者是底层 Agent 运行入口。

## 3. `Agent.prompt()` 怎样处理输入？

在 [`packages/agent/src/agent.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts) 中，`Agent.prompt()` 有接收字符串、消息或消息数组的接口。它首先检查是否已经有运行正在进行；随后调用 `normalizePromptInput()` 整理输入，再交给 `runPromptMessages()`。

当输入是字符串时，`normalizePromptInput()` 会把它包装成一条用户消息。其关键形状如下：

```ts
const content = [{ type: "text", text: input }];
return [{ role: "user", content, timestamp: Date.now() }];
```

这段摘录省略了图片处理和类型声明。包装后，程序不再只拿着一段裸字符串，而是有了一条带角色、内容和时间的消息。

接着 `runPromptMessages()` 调用 `runAgentLoop()`，传入新消息、当前上下文快照、循环配置、事件处理函数、取消信号和模型流函数。也就是说，`prompt()` 是入口，真正推进循环的是后面的运行时函数。

## 4. 消息、上下文和系统指令放在哪里？

在 [`packages/agent/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts) 中，Agent Loop 接收的 `AgentContext` 主要包含：

```ts
export interface AgentContext {
  messages: AgentMessage[];
  tools?: AgentTool<any>[];
}
```

`messages` 是运行记录；`tools` 是本次运行中可以执行的工具对象。`Agent` 创建上下文快照时，会从自己的状态复制这两个数组。

系统指令仍然存在，但不能把它想成这里另有一个 `AgentContext.systemPrompt` 字段。[`agent.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts) 的 `createMutableAgentState()` 会根据初始系统提示和工具声明创建系统消息；当消息列表尚未以系统消息开头时，它会把这条消息放在前面。[`pi-ai/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) 进一步定义了 `SystemMessage`。

要区分两种东西：

- **发给模型的工具声明**：告诉模型工具叫什么、接收什么参数。
- **运行时的工具对象**：包含实际的 `execute()`，由 Pi 程序执行。

两者相关，但模型看到一份声明并不意味着它能直接执行你的电脑操作。

## 5. `runAgentLoop()` 怎样开始一次运行？

[`agent-loop.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts) 中的 `runAgentLoop()` 会处理本次输入，并构造当前上下文。核心代码是：

```ts
const initialMessages = declareToolChanges(context, prompts);
const newMessages: AgentMessage[] = [...initialMessages];
const currentContext: AgentContext = {
  ...context,
  messages: [...context.messages, ...initialMessages],
};
```

这几行有两个容易混淆的数组：

- `currentContext.messages`：已有消息加上本次输入，作为本次运行推进时的上下文。
- `newMessages`：记录本次运行中新加入或产生的消息，最后由 `runAgentLoop()` 返回。

之后 Pi 发出 `agent_start`、`turn_start` 等事件，并调用 `runLoop()`。事件是运行时向外报告发生了什么的方式；真正如何展示，由订阅事件的上层决定。

## 6. 第一轮：模型怎样请求工具？

在 `runLoop()` 中，Pi 调用 `streamAssistantResponse()` 获取模型的响应：

```ts
const message = await streamAssistantResponse(
  currentContext, config, signal, emit, streamFunction,
);
```

在这个函数内部，Pi 可以先调用 `transformContext()`，再用 `convertToLlm()` 将 Agent 消息转换为模型层消息；之后通过 `normalizeContext()` 准备请求上下文，并调用 `streamFunction`。模型输出以流式事件的形式到达，Pi 根据事件更新消息并对外发送变化。

假设模型决定读取文件，它可能返回这样的内容块：

```json
{
  "type": "toolCall",
  "id": "call_1",
  "name": "read",
  "arguments": { "path": "README.md" }
}
```

这是教学示例，省略了外层 assistant 消息和其他字段。`id` 用于关联对应的工具结果；`name` 和 `arguments` 指明模型想调用哪个工具、传入什么参数。

Pi 随后在 `runLoop()` 中提取工具请求：

```ts
const toolCalls = message.content.filter((c) => c.type === "toolCall");
```

一条 assistant 消息可以含有多个内容块，因此程序检查的是内容中的工具调用，而不是假设整条消息只有一个文本字段。[`pi-ai/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) 中的 `ToolCall` 和 `AssistantMessage` 给出了它们的数据结构。

## 7. Pi 怎样真正执行 `read`？

当响应包含工具调用时，`runLoop()` 通常会调用 `executeToolCalls()`。如果模型输出因为长度限制而截断，参数可能不完整，Pi 会生成失败结果，而不是执行这批可能不完整的调用。

在工具执行路径中，`prepareToolCall()` 先根据名称查找工具，准备并校验参数，并在配置了 `beforeToolCall` 时运行该钩子。工具不存在、参数不合格或调用被阻止，都不会正常进入工具的执行函数。

接下来，[`executePreparedToolCall()`](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts) 真正调用工具对象的 `execute()`：

```ts
const result = await prepared.tool.execute(
  prepared.toolCall.id,
  prepared.args as never,
  signal,
  /* 进度更新回调 */
);
```

这里为了阅读省略了回调的具体实现。参数分别让工具知道调用标识、经过准备的参数、取消信号和进度更新方式。`executeToolCalls()` 会根据配置及工具要求选择顺序或并行路径；后续章节再展开这些调度细节。

以 [`read.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts) 为例：

1. `readSchema` 声明 `path` 以及可选的 `offset`、`limit`。
2. `createReadToolDefinition()` 创建名为 `read` 的工具定义。
3. 它的 `execute()` 解析路径、检查可读性，然后通过 `ops.readFile()` 读取内容。
4. 默认 `ops` 中的 `readFile` 调用 Node.js 的 `fsReadFile()`；也可以由宿主替换操作实现。

这就是“模型请求读取”和“程序读取文件”之间的代码边界。实际读取不仅支持文本，也包含图片、取消和输出截断等处理。

## 8. 工具结果怎样回到模型？

Pi 把执行结果包装为 `ToolResultMessage`。下方是一个简化示意：

```json
{
  "role": "toolResult",
  "toolCallId": "call_1",
  "toolName": "read",
  "content": [{ "type": "text", "text": "# 项目介绍\n..." }],
  "isError": false
}
```

`toolCallId` 对应前面的 `call_1`，使结果能够与请求匹配。真实类型还包含时间戳等字段；具体定义见 [`pi-ai/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) 的 `ToolResultMessage`。

`runLoop()` 将工具结果加入当前上下文：

```ts
for (const result of toolResults) {
  currentContext.messages.push(result);
  newMessages.push(result);
}
```

当工具批次没有要求终止，且没有其他停止条件时，循环会继续，模型可以在下一轮收到工具结果并生成回答。错误或中止会结束当前运行；队列消息、`finishTurn` 和工具终止信号也会影响后续控制，所以“有工具就一定再次请求模型”并不是无条件的规则。

## 9. 运行事件与会话保存

Agent Loop 运行时会发出消息和工具执行事件。`Agent` 的 `processEvents()` 根据事件更新自己的运行状态，并将事件交给订阅者。

Coding Agent 的 [`agent-session.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts) 订阅底层 Agent 事件；在相应的 `message_end` 路径中，它把可持久化消息交给 `SessionManager.appendMessage()`。会话树和恢复上下文的具体逻辑位于 [`session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)。

因此，**当前运行中的消息**、**模型本轮收到的输入**和**持久保存的会话记录**彼此相关，却不是同一个对象。会话与恢复机制将在第 6 章继续展开。

## 10. 测试怎样验证这条路径？

Pi 的 [`agent-loop.test.ts`](https://github.com/earendil-works/pi/blob/main/packages/agent/test/agent-loop.test.ts) 包含一个 `should handle tool calls and results` 测试：测试注册 `echo` 工具，使用模拟的流函数先返回一次工具调用、再返回最终文本，并检查工具执行、工具事件和结果。

这个测试直接验证了运行时如何处理一条模拟的工具调用；它不证明某个真实模型服务一定会选择调用工具，也不等于在用户的文件系统上执行了 `read`。此外，测试文件里还有对截断参数、工具并行和终止条件的覆盖，可以与实现一起阅读。

## 11. 把路径放回整个项目

`coding-agent` 是 CLI 与会话装配层，`agent` 是状态和工具循环，`ai` 连接模型，`tui` 负责终端显示。MCP、Code Mode 与执行环境有各自的接入代码；`durable` 则提供以存储提交和恢复任务为中心的另一条运行路径。它们有关联，但不能假设所有目录都在一次本地 CLI 请求的必经链上。完整包地图见[源码地图](../references/source-map.md)。

## 本章小结

一次包含工具调用的运行由多层协作完成：

```text
InteractiveMode / AgentSession
  → Agent.prompt()：整理输入并启动运行
  → runAgentLoop()：建立当前上下文和新消息记录
  → runLoop()：请求模型，识别工具调用
  → executeToolCalls()：准备、校验并调度工具
  → read.execute()：实际读取文件
  → ToolResultMessage：回写上下文
  → 模型生成后续响应
```

其中，模型生成的是请求；工具的执行属于 Pi 运行时。消息、工具参数、结果和事件都有具体的数据结构和代码位置，而不是抽象的“思考—行动”口号。

下一章将进入模型 API 与消息协议，解释不同 Provider 如何表达消息、工具请求和流式响应。

[继续阅读第 2 章：模型 API 与消息协议](02-model-api-and-message-protocols.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
