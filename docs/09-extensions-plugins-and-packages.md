# Extensions 与 Packages：把一个 TypeScript 函数接进循环

假设课程想给 Pi 增加一个工具 `first_match`。输入是几行文字和一个查找词，输出是第一次出现该词的行号。我们还想在查找词为空时阻止执行。这个例子只在内存里查字符串，因而可以直接看到注册、拦截、执行和结果返回各在什么时候发生。

![Mox 区分扩展注册的能力和工具执行路径](../assets/mox-mechanisms/extensions.png)

## 1. 一个可加载的完整扩展

将下面的教学扩展保存为 `first-match.ts`，在已安装 Pi 的环境中可用 `pi -e ./first-match.ts` 加载。扩展入口是默认导出的函数。`pi` 是 Pi 注入的 API，`Type.Object` 声明模型调用这个工具时所需的数据形状。

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function firstMatch(pi: ExtensionAPI) {
  pi.registerTool({
    name: "first_match",
    label: "查找首个匹配行",
    description: "在给定文本中查找包含指定字符串的第一行，从 1 开始计数。",
    parameters: Type.Object({
      text: Type.String(),
      needle: Type.String(),
    }),
    async execute(_toolCallId, { text, needle }) {
      const lines = text.split(/\r?\n/);
      const index = lines.findIndex((line) => line.includes(needle));
      const lineNumber = index < 0 ? null : index + 1;
      return {
        content: [{ type: "text", text: lineNumber === null ? "未找到" : "第 " + lineNumber + " 行" }],
        details: { lineNumber },
      };
    },
  });

  pi.on("tool_call", (event) => {
    if (event.toolName === "first_match" && event.input.needle === "") {
      return { block: true, reason: "查找词不能为空" };
    }
  });
}
```

这段代码中有三个函数在**不同时间**运行。加载模块时，Pi 调用 `firstMatch` 来登记能力。模型提出调用时，Pi 给 `tool_call` 处理器一次检查机会。通过检查后，才调用 `execute`。在入口运行时创建出来的后两个函数可以保留在内存中，供之后多次调用。[上游扩展入口约定与加载方式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) · [动态工具示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/dynamic-tools.ts)

## 2. registerTool 把什么放在什么地方

每个加载的扩展拥有自己的 `tools` Map。`registerTool` 做的第一项检查是 `parameters` 必须为对象，然后按工具名存放定义与来源。这里检查的是**工具声明是否可注册**；模型过后传入的 `needle` 是否为字符串，要到每次调用准备参数时才检查。

源码摘录：[packages/coding-agent/src/core/extensions/loader.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/loader.ts#L293)

```ts
registerTool(tool: ToolDefinition): void {
	assertActive();
	if (typeof tool.parameters !== "object" || tool.parameters === null || Array.isArray(tool.parameters)) {
		throw new Error(
			`Tool "${tool.name}" registered by extension "${extension.path}" must define an object parameter schema.`,
		);
	}
	extension.tools.set(tool.name, {
		definition: tool,
		sourceInfo: extension.sourceInfo,
	});
	runtime.refreshTools();
},
```

`runtime.refreshTools()` 让已绑定的运行时刷新工具集合；在初次加载期间完成注册后，Session 装配也会收集这些定义。`getAllRegisteredTools` 从各扩展收集工具，`AgentSession` 保存定义和来源，根据激活与暴露设置决定哪些声明能给模型使用，另外构造真正可执行的 `AgentTool`。因此注册表中有一个名字、这个名字在本轮请求中可见、这一次调用实际开始执行，是可以分别检查的三个状态。[收集注册工具](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/runner.ts#L637) · [Session 建立工具注册表](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/agent-session.ts#L3582)

包装器补上每次调用的上下文。核心 Agent 只传入本次的 ID、参数、取消信号和进度回调；应用层工具还可以通过额外的 `ctx` 访问这次调用的环境。`wrapRegisteredTool` 把 `runner.createToolContext` 作为工厂传给通用包装函数，实际执行时才用这次的 ID 和信号创建它。

源码摘录：[packages/coding-agent/src/core/extensions/wrapper.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/wrapper.ts#L17)

```ts
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	return wrapToolDefinition(registeredTool.definition, (toolCallId, signal) =>
		runner.createToolContext(toolCallId, signal),
	);
}
```

## 3. 跟着 call_42 走完成功路径

模型提出下面这个教学调用。JSON 中的 `\n` 表示参数文本里有一个真实换行。

```json
{
  "type": "toolCall",
  "id": "call_42",
  "name": "first_match",
  "arguments": { "text": "first line\nPi runs here", "needle": "Pi" }
}
```

| 时刻 | 代码做的事 | 该例的具体值 |
| --- | --- | --- |
| 准备 | 核心循环按名找工具、按 `parameters` 验证参数 | `text` 和 `needle` 都是字符串 |
| 执行前 | `AgentSession._beforeToolCall` 把工具名、ID 和参数作为 `event.input` 交给扩展 | `event.input.needle === "Pi"`，不触发阻止 |
| 执行 | `findIndex` 找到首个包含查找词的行 | 零起始下标 1，展示行号 2 |
| 执行后 | 结果供 `tool_result` 处理器检查和修改 | `content` 含 `第 2 行`，`details.lineNumber` 是数字 2 |
| 回到循环 | 根据最终结果创建与原调用配对的工具消息 | `toolCallId === "call_42"`，下一轮模型可读结果文本 |

改成 `needle: "missing"` 时执行函数正常完成，得到「未找到」与 `lineNumber: null`。若改成 `needle: ""`，空串依旧满足 `Type.String()`，但没有实际查找意义。执行前钩子返回 `block: true`，核心循环将它转成带原因的错误结果，根本不会执行 `findIndex`。这一对输入把「声明的类型」与「本业务接受的值」区分开来。[Session 安装的执行前后钩子](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/agent-session.ts#L668) · [准备调用与阻止分支](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent-loop.ts#L718)

上面的扩展经过实际加载核验。把本章代码原样交给 Pi 的 `discoverAndLoadExtensions`，能取到注册的 `first_match` 和 `tool_call` 处理器。将表中的参数传给这两个函数，得到的匹配行号为 2，未匹配时为 `null`，空串得到含原因的 `block` 对象。这次核验直接调用已加载的函数，结果可独立于模型是否选择这个工具而重现。

## 4. 两个扩展都订阅同一个事件时

`emitToolCall` 先取得本次事件的处理器快照，然后按顺序等待每个处理器。`await` 意味着第二个处理器开始前，第一个已经交回结果。遇到 `block` 会在循环内部立即返回。

源码摘录：[packages/coding-agent/src/core/extensions/runner.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/runner.ts#L1253)

```ts
for (const { handlers } of snapshotEventHandlers(this.extensions, "tool_call")) {
	for (const handler of handlers) {
		const handlerResult = await handler(event, ctx);

		if (handlerResult) {
			result = handlerResult as ToolCallEventResult;
			if (result.block) {
				return result;
			}
		}
	}
}

return result;
```

设快照顺序为 A 检查空串、B 记录被允许的查找。输入 `"Pi"` 时 A 返回 `undefined`，然后 B 被调用；输入 `""` 时 A 已经阻止，B 收不到这次事件。如果 B 要记录**所有尝试**，放在 A 后面就会漏。这里读取的是这个事件的处理顺序，各类事件的合并规则并不完全相同。

比如 `tool_result` 的处理器可以依次替换 `content`、`details`、`structuredContent`、`isError` 等字段，后者看到前者修改后的值。若 A 换了返回给模型的 `content` 却没提供新的 `structuredContent`，runner 会清除旧结构化内容，避免两份结果相互矛盾。B 可以提供新的结构化内容。返回值过滤发生在工具执行之后，先前的外部副作用已发生。[结果逐项合并规则](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/runner.ts#L1190)

## 5. 扩展怎样只改变下一次请求

若目标是让模型这一轮少看一段材料，`context` 钩子位于下次请求发出前。假设活动消息是 `[S, U1, A1, U2]`，其中 `S` 是带工具声明的系统消息，其他三项分别是用户、助手、用户。可以分三次观察数据。

1. `emitContext` 先 `structuredClone(messages)`，在请求用的副本上工作。普通 `context` 处理器得到 `[U1,A1,U2]`。
2. 假设本次只保留 `U2`。处理器返回 `{messages:[U2]}`，runner 通过 `restoreSystemMessages` 合回系统消息。仅有首条 `S` 的本例现在是 `[S,U2]`。
3. `context_with_system` 处理器获得包含系统消息的完整数组，它返回的列表按原样继续。若它丢掉原有首条系统消息，runner 会报告提示与初始工具声明被移除，但仍尊重返回结果。之后才进入 `convertToLlm` 和 Provider 适配。

所以用同一段观察代码接两个事件，打印出来的首项可能完全不同。第 6 章的 `context_edit` 是持久的会话 Entry，重新打开仍能重放；这里的转换操作这次请求的副本，单独返回一个列表不会自动追加一条持久化编辑。[上下文的两阶段转换](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/extensions/runner.ts#L1300)

## 6. 重载、冲突与状态归属

扩展可以临时用 `pi -e` 加载，也可以置于项目 `.pi/extensions/` 或用户扩展目录供自动发现。`/reload` 涉及运行时更换：旧 runner 收到带 `reason:"reload"` 的 `session_shutdown`，随后会失效。写在入口闭包里的 `let count = 0` 在新实例中重新初始化。若计数要跟随本次会话恢复，可以用 `pi.appendEntry` 记录自定义 Entry，再根据当前分支重建。普通自定义 Entry 供扩展使用，不会自动成为模型消息。[重载流程](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/agent-session.ts#L3744) · [扩展状态和会话](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

还有一个常见定位问题：两个扩展都注册 `shared` 时，工具描述来自哪一个？上游测试在同一临时扩展目录写入 `a-first.ts` 和 `b-second.ts`，两者名称相同而描述分别为 `first` 和 `second`。它调用实际的 `discoverAndLoadExtensions` 创建 runner，然后断言收集结果只有一项，描述是 `first`。这验证了**跨扩展收集时先出现者保留**。同一个扩展内部则调用自己 Map 的 `set`，行为边界不同。[同名工具的加载测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/extensions-runner.test.ts#L428)

Package 可以把扩展、Skill、模板和主题作为一组资源分发。归属同一个包不会改变运行时入口：Skill 仍沿索引或显式命令加载，工具仍通过注册、查找、执行，模板仍在发送前展开。排查「安装了却没生效」时，先看资源属于哪一种，再追它对应的加载记录或运行事件。[Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

[继续阅读：Workflow 与 Agent 的控制方式](10-workflow-vs-agent.md) · [返回课程路线](00-source-learning-path.md)
