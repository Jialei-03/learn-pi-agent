# MCP：把远端工具接回本地 Agent Loop

假设团队有一个工具，可以按 ISBN 查询书名。服务端称它为 `lookup`，Pi 中却出现了 `mcp__library__lookup`。模型发起调用后，到底是谁在等待远端响应？书名又是怎样回到模型的？我们跟踪一次查询，握手、命名和转换都沿 Pi 的实现讲解。书库名称、ISBN 和报文编号采用教学数据。

![Mox 展示宿主、客户端与服务器之间的分工](../assets/mcp-illustrations/01-host-client-server.png)

## 1. 建立一条可以收发消息的连接

Coding Agent 的内置 MCP 扩展管理配置、连接和本地工具；`packages/mcp` 提供客户端。以一个已由运行环境允许加载的项目配置为例，`.pi/mcp.json` 中可声明以下服务。这里假设 `scripts/library.mjs` 是项目已经实现的 MCP 服务器，示例用于解释配置字段。

```json
{
  "mcpServers": {
    "library": {
      "command": "node",
      "args": ["scripts/library.mjs"],
      "exposure": "direct"
    }
  }
}
```

`library` 是 Pi 用于区分服务器的名字；`command` 和 `args` 描述 stdio 子进程的启动方式；`direct` 选择直接向模型暴露工具。Streamable HTTP 则把消息送到服务地址，仍复用同一客户端的请求配对逻辑。只有受信项目的本地配置才应按项目配置路径参与装配。具体配置来源与 exposure 选项见 [Pi 的 MCP 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)。

`McpClient.connect` 先把状态从 `idle` 改为 `connecting`，并绑定收到消息、错误、关闭三类处理器，再启动 transport。握手过程可以画成下面的顺序。

```text
Pi 客户端                                 library 服务器
initialize          ───────────────────→  读取客户端信息与能力
                    ←───────────────────  返回协商版本、serverInfo、capabilities
notifications/initialized ─────────────→  客户端确认完成（通知无需应答）
tools/list          ───────────────────→  查询可用工具
                    ←───────────────────  返回 lookup 的描述、inputSchema 等
```

客户端会校验初始化响应和协议版本，再向服务器发送初始化完成通知，最后才进入 `connected`。如果服务只声明资源能力，产品层不会发送 `tools/list`。如果工具列表有 `nextCursor`，`listTools` 会通过分页逻辑继续获取。成功建立传输、握手完成、发现工具，分别对应不同的状态。[客户端握手与发现](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/mcp/src/client.ts#L204) · [产品层连接流程](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/runtime.ts#L379)

## 2. 一项远端能力，为什么需要本地工具定义

设服务器声明 `name: "lookup"`，参数是要求 `isbn` 字符串的对象。若另一个服务也有 `lookup`，模型需要能选对其中一个。`createMcpToolName` 将服务器名和工具名拼成 `mcp__library__lookup`，清洗不适合标识符的字符。若清洗后碰撞或名称过长，它会使用基于原始两个名字的哈希后缀。把 `a-b` 和 `a_b` 都清洗成 `a_b`，正是需要冲突处理的例子。[命名规则](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/tools.ts#L79)

`registerTools` 遍历发现结果，为每项创建本地 `ToolDefinition`，设置 `parameters`、本地名、展示标签、可见方式和 `execute`，再调用 `pi.registerTool`。`execute` 的闭包仍保存远端原名 `tool.name`。于是模型面对带命名空间的声明，服务器依然可以只认识 `lookup`。[注册与可用性检查](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/index.ts#L387)

| 一次查询中出现的三个标识 | 示例 | 用来关联什么 |
| --- | --- | --- |
| 模型提出的工具调用 ID | `call_17` | assistant 中的调用与后来的 toolResult |
| MCP 请求 ID | `8` | 发到 transport 上的 JSON-RPC 请求与响应 |
| 远端工具名 | `lookup` | 服务端要执行的函数或业务处理器 |

`call_17` 和 `8` 可以完全不同。前者属于模型会话，后者由客户端分配，同一服务器上同时在途的两个请求也能各自收到对应结果。

## 3. 模型提出查询以后，代码怎样推进

教学调用是 `mcp__library__lookup({isbn: "A-17"})`。第 4 章讲过的循环会先找到本地工具并准备参数。然后才进入 MCP 工具定义的执行函数。

源码摘录：[packages/coding-agent/src/extensions/mcp/tools.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/tools.ts#L337)

```ts
async execute(_toolCallId, params, signal, onUpdate) {
	const client = await options.getClient();
	const result = await client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, {
		signal,
		timeoutMs: options.timeoutMs,
		onProgress: (progress) => {
			const total = progress.total === undefined ? "" : `/${progress.total}`;
			const text = progress.message ?? `Progress ${progress.progress}${total}`;
			onUpdate?.({ content: [{ type: "text", text }], details: { server, tool: tool.name } });
		},
	});
	return convertMcpResult(server, tool.name, result, { readableResources: options.readableResources?.() });
},
```

第一步重新解析当前客户端：一个工具可能在「参数准备结束」和「轮到执行」之间被禁用，或在重新连接后被服务器移除。此时 `getClient` 会拒绝调用。第二步 `callTool` 把**原名**和参数传给协议层，连同取消信号、超时和进度回调。第三步才转换最终结果。如果远端报告中间进度，这些进度触发本次工具执行的 `onUpdate`，最终 Promise 仍在等待服务端应答。

协议层的最小报文关系可简化为下面两行。具体运行可能还会生成用于报告进度的元数据。

```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"lookup","arguments":{"isbn":"A-17"}}}
{"jsonrpc":"2.0","id":8,"result":{"content":[{"type":"text","text":"《树的遍历》"}],"structuredContent":{"title":"树的遍历"}}}
```

`requestInternal` 创建 Promise，把 `resolve`、`reject`、取消信号和超时记录放进 `pending` Map，键是请求 ID。收到响应时 `handleResponse` 用同一 ID 取出条目，清理计时器和监听器，再根据响应含 `result` 或 `error` 决定兑现或拒绝该 Promise。晚到的响应若找不到条目，会作为未知请求响应报告。[请求登记](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/mcp/src/client.ts#L396) · [响应配对](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/mcp/src/client.ts#L481)

## 4. 书名为什么同时出现在两个地方

服务端可以同时返回给人或模型看的内容块以及给程序用的数据。Pi 的 `convertMcpResult` 将远端结果分成不同去向。

源码摘录：[packages/coding-agent/src/extensions/mcp/tools.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/tools.ts#L273)

```ts
	const converted: (TextContent | ImageContent)[] =
		result.content.length > 0 ? await toModelContent(server, result.content, options) : toLlmContent(result);
	if (result.isError && textOf(converted) === "") {
		converted.push({ type: "text", text: `MCP tool ${server}/${tool} returned an error` });
	}
	const { content, fullOutputPath } = await limitMcpContent(converted, options.saveOutput);
	const { _meta: _ignored, ...scriptResult } = result;
	return {
		content,
		details: { server, tool, ...(fullOutputPath ? { fullOutputPath } : {}) },
		structuredContent: scriptResult as unknown as JsonValue,
		...(result.isError ? { isError: true } : {}),
	};
}
```

以上面的书库结果为例：

| Pi 工具结果字段 | 本例中的值或意义 | 消费方 |
| --- | --- | --- |
| `content` | 一段文本 `《树的遍历》` | 回填循环供模型阅读 |
| `details` | `{server:"library", tool:"lookup"}` | 本地展示或诊断 |
| `structuredContent` | 整份远端结果，保留 `content` 和内部的 `structuredContent.title`，去掉远端 `_meta` | 程序化调用者 |
| `isError` | 远端报告工具业务错误时为真 | 循环可据此构造错误结果 |

这里容易少读一层：对程序调用者而言，书名字段在外层 `structuredContent` 所保存的 MCP 结果的 **`structuredContent.title`** 中。对模型而言，下一轮可以直接读取工具消息中的文本块。

当输出很长时，`limitMcpContent` 会在组合文本超过 20 KiB 后截掉中段，尝试把全文保存至临时文件，模型文本里提供取回路径。图像块在截断文本后保留；脚本用的结果仍保留完整数据。上游测试构造 3,000 行文本和一个图像块，用内存函数替代实际临时文件写入，再分别检查模型可见内容、保存的全文和程序化结果。[截断实现](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/extensions/mcp/tools.ts#L180) · [长输出测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/mcp-extension.test.ts#L420)

## 5. 失败、取消与列表变化发生在哪里

| 现象 | 代码已经知道什么 | 控制流如何结束 |
| --- | --- | --- |
| 成功收到 `result`，其中 `isError:true` | 服务端完成了协议应答，并报告业务失败 | 保留结构化结果，让模型获得错误内容 |
| 收到 JSON-RPC `error` | 对应请求在协议层失败 | `handleResponse` 拒绝等待中的 Promise |
| `tools/call` 超时或被取消 | 本地停止等待 | 清理 pending，拒绝 Promise，并尝试发送该请求的取消通知 |
| 传输关闭 | 连接不能继续接收应答 | 标记 closed，拒绝所有还在等待的请求 |
| 服务器发出 `notifications/tools/list_changed` | 先前工具清单可能失效 | 重新 list，确认还是当前连接，再刷新注册状态 |

尤其要区分「本地停止等」与「远端动作已经撤销」。如果远端已经执行了写操作，响应却在回程中丢失，两端可见的事实并不对称。Pi 的 MCP 测试专门检查短暂 HTTP 失败后的行为：可重试资源读取，工具调用不会据此自动重发。资源使用独立的列表、模板、读取操作，例如通过服务器名和 URI 读取资源；它和调用远端工具有不同的运行语义。[取消与连接关闭](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/mcp/src/client.ts#L555) · [重试边界测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/mcp-extension.test.ts#L700) · [资源工具](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/extensions/mcp/resources.ts)

[继续阅读：Skill 和模板如何进入请求](08-skills-and-prompt-templates.md) · [返回课程路线](00-source-learning-path.md)
