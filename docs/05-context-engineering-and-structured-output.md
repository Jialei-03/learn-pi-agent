# 上下文装配：同一个项目，模型这一轮到底看到了什么

在 `/work/demo/service` 中让 Pi「读取 README，然后给我一句介绍」。终端里有命令输出，项目里有两份规则，工具还能返回结构化数据。模型收到的请求里，究竟有哪些？这一章跟着一次请求，把文件、运行消息和发给模型的数据分别展开。文中目录和输入值为教学示例。

![Mox 从会话档案中选取本轮上下文](../assets/mox-mechanisms/context.png)

## 1. 先分开三份数据

| 可以在哪里看到它 | 谁维护 | 在这个例子里装了什么 |
| --- | --- | --- |
| `Agent.state` | 低层 Agent | 消息、可执行的工具对象、选用的模型、流式运行状态等 |
| `AgentContext` | Agent Loop | 本次循环使用的消息和工具，包含宿主可以调用的 `execute` |
| 模型请求 | `pi-ai` 和具体 Provider 适配器 | 标准化后可发送的消息、指令、工具声明，以及模型的请求参数 |

一次工具调用会经过三份数据。宿主工具对象的 `execute` 引用本机文件系统；发给模型的声明提供名称、描述、参数 Schema。模型能根据声明提出 `read({path: "README.md"})`，随后循环在自己的工具集合里按名找到执行函数。读文件的结果又成为下一轮的消息。要定位输入问题，得先确定它发生在这条路径的哪一步。[Agent 的上下文与工具定义](https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts)

## 2. 两层目录里都有规则，Pi 选谁

假设开启了默认上下文文件发现，且目录的其他祖先没有规则文件。测试中的文件布局可以缩写成下面这样。

```text
agentDir/
  AGENTS.md              常规全局规则
  AGENTS.override.md     临时全局规则
/work/demo/
  AGENTS.md              用项目自己的术语
  service/               ← cwd
    AGENTS.md            常规服务规则
    AGENTS.override.md   先阅读 README
```

`loadContextFileFromDir` 在**同一个目录内**逐个尝试候选文件，顺序为 `AGENTS.override.md`、`AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD`。找到可读的普通文件就返回。`loadProjectContextFiles` 先放入全局结果，再从 cwd 向文件系统根目录查找。它用 `unshift` 把每个祖先结果插在队首，于是读取时从里向外，最终交给提示构建器的顺序却从外向里。[加载与去重](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/resource-loader.ts#L212)

| 结果中的位置 | 入选内容 | 原因 |
| --- | --- | --- |
| 1 | 临时全局规则 | 全局目录内，override 优先 |
| 2 | 用项目自己的术语 | `/work/demo` 是 cwd 的祖先 |
| 3 | 先阅读 README | service 目录内，override 优先 |

因此服务规则被选中时，父项目规则依然在输入里。上游测试在临时目录创建这五个文件，调用 `loader.reload()`，对返回的**有序数组**做相等断言。另有测试在 `noContextFiles: true` 时断言数组为空。两种输入恰好区分了「在一个目录里挑文件」与「收集多个目录」。[资源加载测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/resource-loader.test.ts#L524)

`renderProjectContext` 把每项的路径和正文一起保留下来。下面是该函数的完整实现。

源码摘录：[packages/coding-agent/src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/system-prompt.ts#L79)

```ts
function renderProjectContext(contextFiles: Array<{ path: string; content: string }>): string {
	return [
		"Project-specific instructions and guidelines:",
		...contextFiles.map(
			({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
		),
	].join("\n\n");
}
```

结果装入 `project_context` 章节。例如第三项会生成 `<project_instructions path="/work/demo/service/AGENTS.override.md">`、一行规则和结束标签。路径让文字的来源可追溯。文件中写的要求最终作为文本进入请求，实际能执行的动作仍取决于运行时有哪些工具、是否允许该次调用。

## 3. 为什么修改一段系统提示只产生一个补丁

默认装配把提示分成 `preamble`、`project_context`、`skills`、`cwd` 等有名字的章节。实际出现哪些章节取决于资源、工具和配置。`AgentSession` 准备下一次装配时先重放已有系统消息，取出当前有效的章节，再同这次构建出的章节做差。[提示构建](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/system-prompt.ts#L128) · [Session 装配入口](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/agent-session.ts#L1779)

源码摘录：[packages/coding-agent/src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/system-prompt.ts#L216)

```ts
export function diffSystemPromptSections(
	previous: Record<string, string | null>,
	current: SystemPromptSections,
): Record<string, string | null> | undefined {
	const patch: Record<string, string | null> = {};
	for (const [name, text] of Object.entries(current)) {
		if (previous[name] !== text) patch[name] = text;
	}
	for (const name of Object.keys(previous)) {
		if (current[name] === undefined) patch[name] = null;
	}
	return Object.keys(patch).length > 0 ? patch : undefined;
}
```

以扩展贡献的 `plan_mode` 章节为例。原值是 `<plan_mode>\nPlan only.\n</plan_mode>`。扩展将正文改成 `Implementation allowed.` 后，`patch` 只含新 `plan_mode`。保持原值则返回 `undefined`，不必追加章节变更。彻底移除这一节则返回 `{ plan_mode: null }`。这里的 `null` 是删除指令，要同「对象中没有这个键，表示没有变化」分开。上游测试逐项断言了这三种结果。[系统提示更新测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/system-prompt-updates.test.ts#L99)

装配器收到有效补丁后构造 `{role: "system", content: "", sections, timestamp}`。因此只打印 `content` 会看到空字符串，而实际系统提示可以很长。查看完整提示时应把章节变化按消息顺序应用，再读取渲染后的文本。

## 4. 同一条材料在请求边界怎样变化

假设一个扩展向会话加入了来源为 `catalog` 的资料，同时用户刚运行了一次以 `!!` 为前缀、排除在模型上下文之外的命令。这份表省略时间戳，保留影响转换的字段。

| 运行时记录 | `convertToLlm` 的结果 |
| --- | --- |
| `system`，带项目章节和工具声明 | 保留系统消息，交给适配器处理 |
| `bashExecution`，`excludeFromContext: true` | 过滤掉，输出数组没有这一项 |
| `custom`，`customType: "catalog"`，`content: "目录已更新"` | `{role: "user", content: [{type: "text", text: "目录已更新"}], timestamp}` |
| `user`，要求读取 README | 保留用户消息 |
| `toolResult`，包含 `read` 返回的文本 | 保留工具结果与关联 ID |

顺序直接决定上层扩展能看到什么。在 `streamAssistantResponse` 中，`transformContext` 接收 Agent 消息，`convertToLlm` 将结果映射成模型层消息。下面是二者在同一函数中的连接点。

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

例如扩展若需要用 `customType === "catalog"` 筛选资料，就应在转换前做。转换成用户消息以后，原来的类型标记已经消失。输入仅含普通消息时，标准化也无需凭空添加系统文本。以 Anthropic 适配器为例，构建参数时它会拆出开头的系统消息、处理工具声明，另外转换对话记录。最终序列化还受具体服务的兼容能力影响。[应用消息的转换](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/messages.ts#L148) · [Anthropic 请求构建](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/ai/src/api/anthropic-messages.ts#L1153)

## 5. 预算按什么数

假设窗口是 100,000 tokens，`reserveTokens` 设置成 10,000，启用了自动压缩。最近一条有效 assistant usage 报告 88,000，其后又出现一个只含 12,000 个 ASCII 字符的文本工具结果。依照 Pi 的文本估算 `ceil(字符数 / 4)`，尾部约为 3,000，总估算是 91,000。阈值是 90,000，这个输入满足压缩判断。如果尾部只有 8,000 个字符，总估算恰好是 90,000，严格大于条件不成立。这里的设置、文本长度和 usage 是为了推演选择的数值。[用量估算与阈值](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/compaction/compaction.ts#L196)

使用最近一次有效 usage 是因为模型服务已经处理过当时那份上下文。若后来发生了上下文编辑或压缩，旧 usage 描述的是另一份请求，Pi 会改按**当前投影**重估。`reserveTokens` 参与判断何时压缩，`keepRecentTokens` 参与选择哪段历史保留原文。第 6 章会用一个真实测试解释为什么保留下来的尾部可能超过这个目标。

## 6. 把回答交给代码消费

「请用 JSON 回答」可以影响模型生成的文字。应用如果要取出 `actionItems` 渲染列表，Pi 上游提供了一条更明确的实现路径。`structured-output.ts` 注册名为 `structured_output` 的工具，参数声明要求 `headline` 和 `summary` 都是字符串，`actionItems` 是字符串数组。模型要通过这个工具交付答案，提交的参数会先经过工具准备与校验。[完整扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts)

源码摘录：[packages/coding-agent/examples/extensions/structured-output.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/structured-output.ts#L34)

```ts
async execute(_toolCallId, params) {
	return {
		content: [{ type: "text", text: `Saved structured output: ${params.headline}` }],
		details: {
			headline: params.headline,
			summary: params.summary,
			actionItems: params.actionItems,
		} satisfies StructuredOutputDetails,
		terminate: true,
	};
},
```

给定 `{headline: "Pi 教程", summary: "讲解工具循环", actionItems: ["读源码"]}`，模型可见的工具内容只有 `Saved structured output: Pi 教程`。UI 从 `details.actionItems` 取得数组渲染条目。`satisfies` 是 TypeScript 编译期的类型检查，输入的运行时检查来自前面的参数 Schema。把 `actionItems` 改成数字而不是数组，不能按这份 Schema 直接进入执行函数。反过来，即使值全都符合类型，介绍是否准确也还要回到 README 核实。

这个例子还返回 `terminate: true`。当它是本批唯一工具且没有额外控制要求时，循环可以以这个工具结果结束。这样应用取得的结构、用户看见的排版、以及模型是否还要生成一段文字，分别在不同的代码位置决定。

[继续阅读：会话树、保留边界与压缩](06-session-memory-retrieval-and-compaction.md) · [返回课程路线](00-source-learning-path.md)
