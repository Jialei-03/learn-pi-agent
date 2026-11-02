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

`loadContextFileFromDir` 在**同一个目录内**逐个尝试候选文件，顺序为 `AGENTS.override.md`、`AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD`。找到可读的普通文件就返回。`loadProjectContextFiles` 先放入全局结果，再从 cwd 向文件系统根目录查找。它用 `unshift` 把每个祖先结果插在队首，于是读取时从里向外，最终交给提示构建器的顺序却从外向里。[加载与去重](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/resource-loader.ts#L212)

| 结果中的位置 | 入选内容 | 原因 |
| --- | --- | --- |
| 1 | 临时全局规则 | 全局目录内，override 优先 |
| 2 | 用项目自己的术语 | `/work/demo` 是 cwd 的祖先 |
| 3 | 先阅读 README | service 目录内，override 优先 |

因此服务规则被选中时，父项目规则依然在输入里。上游测试在临时目录创建这五个文件，调用 `loader.reload()`，对返回的**有序数组**做相等断言。另有测试在 `noContextFiles: true` 时断言数组为空。两种输入恰好区分了「在一个目录里挑文件」与「收集多个目录」。[资源加载测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/resource-loader.test.ts#L524)

`renderProjectContext` 把每项的路径和正文一起保留下来。下面是该函数的完整实现。

源码摘录：[packages/coding-agent/src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L79)

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

### 一份文件入选以后，还要组装哪些材料

文件加载器只回答“找到了哪些说明”。提示构建器还得回答“这个 Agent 这次有哪些能力，这些说明摆在哪”。`buildSystemPromptSections` 先复制传入的数组和字典，再根据 `selectedTools` 与 `hiddenTools` 算出本次可在提示中直接列出的工具集合。默认提示里，只有具备工具简介的工具才会出现在工具文字列表；与工具有关的规则则从可声明的工具和额外贡献的规则中收集。因而提示里一行 `read` 的简介与可执行对象里的 `parameters` 各有来源，某个简介为空也不能直接证明底层没有该工具的实现。[参数归一化与工具筛选](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L60)

在木星笔记里，假设当前直接声明的工具只有 `read` 和 `bash`。当没有 `grep`、`find`、`ls` 时，构建器会加入一条使用 Shell 列目录或搜索的建议；如果改成直接提供 `grep`，触发这句建议的条件就变了。收集规则时，`addRule` 对每条文字先 `trim()`，用 Set 检查是否已见过，首次才加入输出数组。工具 A 和扩展 B 即使同时贡献同样一条规则，最后只占一条，且第一次出现的位置稳定。可是语义相似而措辞不同的两句话仍然各占一条，代码在这里比较的是规范化后的完整字符串。重复内容为何有时消失、有时还在，可以在这里核对。[规则构建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L88)

Skill 索引的出现还有一个前置条件。若选中的 `read` 或 `bash` 可以直接声明，索引会提示使用相应能力读取 Skill 文件；若读取能力只通过别的工具间接到达，索引仍可能出现，但不应要求模型调用一个看不见的直接工具。如果选择的工具里两种阅读能力都没有，构建器不会自动加入该索引。项目说明却可以照常加入，因为它已经被宿主加载成文字，不需要模型再去读对应文件。这说明“文件可以影响提示”至少有两种路径，分别消耗当轮输入容量和后续工具调用。[项目资料、技能与当前目录的装配](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L173)

最后，`preamble` 保留前导指令原文，其余有名字的段落包进各自的开始与结束标签，例如 `<project_context>`。使用自定义开场提示会改变默认前导部分的来源，后续的项目材料、附加说明、当前目录仍分别按条件装配。若调用方通过 `forceSystemPrompt` 提供完整提示，`buildSystemPromptState` 则返回仅含该段 `content` 的表示。测试分别对强制提示和章节化提示的返回对象断言相等。调试时如果预期某个扩展章节出现，先检查本次采用的是哪条构造路径，再检查章节名称或文件发现结果。[系统提示状态与测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/system-prompt-updates.test.ts#L112)

## 3. 为什么修改一段系统提示只产生一个补丁

默认装配把提示分成 `preamble`、`project_context`、`skills`、`cwd` 等有名字的章节。实际出现哪些章节取决于资源、工具和配置。`AgentSession` 准备下一次装配时先重放已有系统消息，取出当前有效的章节，再同这次构建出的章节做差。[提示构建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L128) · [Session 装配入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L1779)

源码摘录：[packages/coding-agent/src/core/system-prompt.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/system-prompt.ts#L216)

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

以扩展贡献的 `plan_mode` 章节为例。原值是 `<plan_mode>\nPlan only.\n</plan_mode>`。扩展将正文改成 `Implementation allowed.` 后，`patch` 只含新 `plan_mode`。保持原值则返回 `undefined`，不必追加章节变更。彻底移除这一节则返回 `{ plan_mode: null }`。这里的 `null` 是删除指令，要同「对象中没有这个键，表示没有变化」分开。上游测试逐项断言了这三种结果。[系统提示更新测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/system-prompt-updates.test.ts#L99)

装配器收到有效补丁后构造 `{role: "system", content: "", sections, timestamp}`。因此只打印 `content` 会看到空字符串，而实际系统提示可以很长。查看完整提示时应把章节变化按消息顺序应用，再读取渲染后的文本。

### 反向推演，从已经保存的消息得到此刻的提示

前面的差分从两份完整状态计算一条更新。恢复会话正好反过来，手中只有按时间排列的系统消息。`getCurrentSystemMessage` 扫描这段历史，把非空 `content` 累加起来，同时用 Map 保存每个命名章节的最新值。普通用户消息和工具结果不会参加这个 Map 的更新。工具集合按名字用另一张表重放，每条系统消息先执行 `toolsRemoved` 的删除，再执行 `toolsAdded` 的插入或替换。由这两张表最终构成当前可用的章节和声明。[系统与工具重放](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/transcript.ts#L55)

源码摘录：[packages/ai/src/utils/transcript.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/transcript.ts#L77)

```ts
for (const message of messages) {
	if (!isSystemMessage(message)) continue;
	timestamp ??= message.timestamp;
	const text = contentText(message.content);
	if (text.length > 0) content.push(text);
	for (const [name, value] of Object.entries(message.sections ?? {})) {
		if (value === null) sections.delete(name);
		else sections.set(name, value);
	}
}
```

课程示例用三个前缀记录这台小状态机的每一步。S₀ 的文字是“检索笔记”，章节为 `scope=仅项目`、`tone=简洁`，工具为 `read` 与 `bash`。U₁ 是普通用户问题。S₂ 把 `scope` 更新为“仅 README”，用 `null` 删除 `tone`，同时撤下 `bash`。在示例目录执行 `node boundaries.mjs context`，可以看到相同输入在每个前缀的实际重放结果。[可运行示例](../examples/read-loop/boundaries.mjs)

| 已读到的历史 | 此刻的章节 | 此刻的工具 |
| --- | --- | --- |
| S₀ | `scope=仅项目`，`tone=简洁` | `read, bash` |
| S₀、U₁ | 和上一步相同 | `read, bash` |
| S₀、U₁、S₂ | `scope=仅 README` | `read` |

如果把 S₂ 的 `{tone: null}` 换成“完全不提 tone”，Map 就会留下旧值“简洁”。这里要表达的是两种不同动作：撤回一条此前生效的规则，以及本次根本没有修改它。再做一个变化，把同名工具同时列在移除与新增列表里。先删除后新增，最终留下的是新定义。反过来先插入再删除，重放后反而丢失工具。这样，即使历史中的旧 `read` 与新 `read` 名字一致，只要参数或说明更新了，当前请求也有办法拿到新的声明。运行时还要根据实际工具表查找可执行对象，第 4 章的执行路径继续负责校验与调用。

向服务发送请求时，支持中途系统消息的适配器可以表达一次“更新了某节”的变化；要求单一前导系统消息的路径则先重放，把当前有效文字折成一个新的开头。前一种表示保留变更发生的位置，后一种保证当前输入带上最新有效规则。它们对应同一份内部历史，网络请求的形状却不必一样。因此检查“删除章节是否生效”时，应比较最终可见的提示和实际可调用工具，而不用要求各种服务都收到完全相同的一串消息。[展开与折叠](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/transcript.ts#L106) · [更新文本渲染](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/utils/text.ts#L28)

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

源码摘录：[packages/agent/src/agent-loop.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L398)

```ts
let messages = context.messages;
if (config.transformContext) {
	messages = await config.transformContext(messages, signal);
}

// Convert to LLM-compatible messages (AgentMessage[] → Message[])
const llmMessages = await config.convertToLlm(messages);

const llmContext = normalizeContext({ messages: llmMessages });
```

例如扩展若需要用 `customType === "catalog"` 筛选资料，就应在转换前做。转换成用户消息以后，原来的类型标记已经消失。输入仅含普通消息时，标准化也无需凭空添加系统文本。以 Anthropic 适配器为例，构建参数时它会拆出开头的系统消息、处理工具声明，另外转换对话记录。最终序列化还受具体服务的兼容能力影响。[应用消息的转换](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/messages.ts#L148) · [Anthropic 请求构建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/ai/src/api/anthropic-messages.ts#L1153)

## 5. 预算按什么数

假设窗口是 100,000 tokens，`reserveTokens` 设置成 10,000，启用了自动压缩。最近一条有效 assistant usage 报告 88,000，其后又出现一个只含 12,000 个 ASCII 字符的文本工具结果。依照 Pi 的文本估算 `ceil(字符数 / 4)`，尾部约为 3,000，总估算是 91,000。阈值是 90,000，这个输入满足压缩判断。如果尾部只有 8,000 个字符，总估算恰好是 90,000，严格大于条件不成立。这里的设置、文本长度和 usage 是为了推演选择的数值。[用量估算与阈值](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L196)

使用最近一次有效 usage 是因为模型服务已经处理过当时那份上下文。若后来发生了上下文编辑或压缩，旧 usage 描述的是另一份请求，Pi 会改按**当前投影**重估。`reserveTokens` 参与判断何时压缩，`keepRecentTokens` 参与选择哪段历史保留原文。第 6 章会用一个真实测试解释为什么保留下来的尾部可能超过这个目标。

### 旧账单何时还能用

既然已经有 usage，为什么有些时候还要估算？费用记录描述的是**当时的一次请求**。设分支上依次保存了很长的用户输入 U、一条简短回答 A，A 的 usage 报告总数 10,001。此时如果用户又添一小段新材料，已知前缀大致占了多少，只有尾部需要估算。可如果后来新增的动作恰好是删掉 U，一大部分旧费用所代表的上下文已经不在下一次输入里。此时盲目取“最近一次模型报过的总数”，会让一个已经变短的对话看起来仍然很满，甚至触发不必要的压缩。

`estimateProjectedContextTokens` 必须把“哪条可见消息有最近一次 usage”重新对应回“那条消息在原始分支里的记录位置”。原因在于，有些会话记录不会投影成模型消息，有些又可能贡献多条，所以投影数组的下标不能直接与日志中的下标相比。代码沿投影条目累加其贡献的消息数量，用这个区间找到 usage 对应的原记录 ID，再到原分支里确定它的顺序。只有这次 usage 比最近的 `context_edit` 或 `compaction` 还新，才沿用计量前缀。其余情况重放有效系统消息，再逐条估算当前非系统消息。[用原记录位置校正用量](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L227)

对应测试先写入重复两千次的长用户输入，构造一条总数为 10,001 的回答，然后追加一条编辑记录，把长输入从上下文投影里拿掉。结果的 `usageTokens` 归零，当前估算总量小于 100。继续把回答也从投影中移除，总量变为 0。另一个测试把新回答放在编辑之后，新的有效 usage 就能重新充当基线。判断依据是分支里发生事情的先后，不能只挑最大的数字，也不能比较两个数组里碰巧相等的位置。[前后两个顺序的对照测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/session-context-edit.test.ts#L195)

还有一个计量单位容易混淆。第 4 章限制的是工具输出的 UTF-8 字节数和行数，这里对普通文本采用 JavaScript 字符串长度再除以四并向上取整的近似值。相同的一段中文，在文件字节上限、这种字符估算和具体模型的 tokenizer 上可能是三个数。图片块还采用固定的字符成本估计。因此页面显示的剩余容量适合指导何时处理历史，不能反过来用作“服务必定接受本次请求”的精确证明。服务返回的实际 usage 与发生溢出的响应，是下次调整估算和策略的依据。[编码会话的消息估算规则](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L276)

## 6. 把回答交给代码消费

「请用 JSON 回答」可以影响模型生成的文字。应用如果要取出 `actionItems` 渲染列表，Pi 上游提供了一条更明确的实现路径。`structured-output.ts` 注册名为 `structured_output` 的工具，参数声明要求 `headline` 和 `summary` 都是字符串，`actionItems` 是字符串数组。模型要通过这个工具交付答案，提交的参数会先经过工具准备与校验。[完整扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/structured-output.ts)

源码摘录：[packages/coding-agent/examples/extensions/structured-output.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/structured-output.ts#L34)

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

> **先预测**　一轮里新增了一个工具。把每次声明过的工具简单求并集，就等于下一轮的活动工具了吗？
>
> **核对推导**　不等于。后续系统消息也能撤回声明。沿有效消息按次序应用新增和移除，得到的才是那个时点的集合；已经撤回的工具，不能凭一次历史声明重新出现在请求里。

[继续阅读：会话树、保留边界与压缩](06-session-memory-retrieval-and-compaction.md) · [返回课程路线](00-source-learning-path.md)
