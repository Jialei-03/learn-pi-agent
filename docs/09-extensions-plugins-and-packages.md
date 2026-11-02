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

源码摘录：[packages/coding-agent/src/core/extensions/loader.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/loader.ts#L293)

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

`runtime.refreshTools()` 让已绑定的运行时刷新工具集合；在初次加载期间完成注册后，Session 装配也会收集这些定义。`getAllRegisteredTools` 从各扩展收集工具，`AgentSession` 保存定义和来源，根据激活与暴露设置决定哪些声明能给模型使用，另外构造真正可执行的 `AgentTool`。因此注册表中有一个名字、这个名字在本轮请求中可见、这一次调用实际开始执行，是可以分别检查的三个状态。[收集注册工具](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L637) · [Session 建立工具注册表](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L3582)

包装器补上每次调用的上下文。核心 Agent 只传入本次的 ID、参数、取消信号和进度回调；应用层工具还可以通过额外的 `ctx` 访问这次调用的环境。`wrapRegisteredTool` 把 `runner.createToolContext` 作为工厂传给通用包装函数，实际执行时才用这次的 ID 和信号创建它。

源码摘录：[packages/coding-agent/src/core/extensions/wrapper.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/wrapper.ts#L17)

```ts
export function wrapRegisteredTool(registeredTool: RegisteredTool, runner: ExtensionRunner): AgentTool {
	return wrapToolDefinition(registeredTool.definition, (toolCallId, signal) =>
		runner.createToolContext(toolCallId, signal),
	);
}
```

### 定义、执行包装和事件拦截各自存什么

`first_match` 的定义可以在加载完成后反复复用。名称、说明、Schema、`execute` 实现与它一起保存在注册表中。假设模型连续两次提出同名调用，调用 ID 分别是 `call_42`、`call_43`。两次都命中同一份定义，包装器却在各自执行之时调用上下文工厂，传入各自的 ID 和取消信号。调用级信息如果直接挂在共享定义对象上，第二次调用会覆盖第一次；通过工厂得到的上下文则与本次作用域绑定。工具要报告中间结果时也应使用这次 `execute` 收到的 `onUpdate`。

这里还有两种经常被混在一起的适配。包装器让工具实现可以接到额外的扩展上下文；拦截器由 `AgentSession` 单独装在低层 Agent 的 `beforeToolCall` 与 `afterToolCall` 上。结果是一个扩展只注册 `tool_call` 事件也能检查内置 `write` 的调用，无需重写内置工具的执行函数。反之，把一个工具包装成可执行对象并不会自动给每次调用增添策略，它仍会经过当前 Session 已安装的钩子。两条路径在同一次调用上相遇，职责和注册时间各不相同。[工具执行的适配](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/tools/tool-definition-wrapper.ts#L27) · [Session 钩子绑定](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L668)

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

改成 `needle: "missing"` 时执行函数正常完成，得到「未找到」与 `lineNumber: null`。若改成 `needle: ""`，空串依旧满足 `Type.String()`，但没有实际查找意义。执行前钩子返回 `block: true`，核心循环将它转成带原因的错误结果，根本不会执行 `findIndex`。这一对输入把「声明的类型」与「本业务接受的值」区分开来。[Session 安装的执行前后钩子](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L668) · [准备调用与阻止分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L718)

上面的扩展经过实际加载核验。把本章代码原样交给 Pi 的 `discoverAndLoadExtensions`，能取到注册的 `first_match` 和 `tool_call` 处理器。将表中的参数传给这两个函数，得到的匹配行号为 2，未匹配时为 `null`，空串得到含原因的 `block` 对象。这次核验直接调用已加载的函数，结果可独立于模型是否选择这个工具而重现。

## 4. 两个扩展都订阅同一个事件时

`emitToolCall` 先取得本次事件的处理器快照，然后按顺序等待每个处理器。`await` 意味着第二个处理器开始前，第一个已经交回结果。遇到 `block` 会在循环内部立即返回。

源码摘录：[packages/coding-agent/src/core/extensions/runner.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1253)

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

比如 `tool_result` 的处理器可以依次替换 `content`、`details`、`structuredContent`、`isError` 等字段，后者看到前者修改后的值。若 A 换了返回给模型的 `content` 却没提供新的 `structuredContent`，runner 会清除旧结构化内容，避免两份结果相互矛盾。B 可以提供新的结构化内容。返回值过滤发生在工具执行之后，先前的外部副作用已发生。[结果逐项合并规则](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1190)

### 事件处理器刚才卸载了自己，会怎样

`snapshotEventHandlers` 在一次分发开始时对每个扩展的处理器数组做浅复制。假设 A、B、C 都监听 `tool_call`。A 在运行时取消了 B 的订阅；这一轮快照里已经有 B 的函数引用，若 A 没有短路，循环仍可以走到 B。下一笔调用重新取快照，B 才从列表里消失。相反，A 在处理第一笔时新增的 D 不会插队到这次分发的中途。浅复制刻画的是这次会执行哪些处理器，传给它们的事件对象则仍可能在不同处理器之间传递变化。[快照实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L276) · [取消订阅](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/loader.ts#L285)

再看 A 抛错的情况。`emitToolCall` 直接等待检查处理器，抛错会传回 `AgentSession._beforeToolCall` 和核心 `prepareToolCall`；后者捕获异常，形成一次立即失败的工具结果，底层 `execute` 没有开始。相比之下，`emitToolResult` 在逐个处理器周围捕获异常，调用扩展错误报告后继续处理后续结果处理器。原因可以从决定的位置看出：检查阶段还决定要不要产生动作；处理结果阶段已经拿到工具输出，还有别的处理器要组合或展示它。在两者的回调中都写 `throw new Error(...)`，实际能观察到的运行结果并不一样。[准备阶段的异常返回](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L718) · [结果处理器错误与合并](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1190)

把合并具体化。设一项别的工具最初返回 `content: "内部标签=17"`、`structuredContent: {tag:17}`，这里把文本块简写成字符串。A 为了展示改成「已找到一个标签」，未提供新的结构化对象。B 在同一事件中接到的是改变后的文字，原 `structuredContent` 已被移除，而独立的 `details` 并未因此自动清空。若 B 后续填入 `structuredContent: {found:true}`，最终供程序读取的便是这一份。只修改一个表示层就设想所有通道都同步脱敏或同步更新，会导致调用者和界面消费不一致的事实。

## 5. 扩展怎样只改变下一次请求

若目标是让模型这一轮少看一段材料，`context` 钩子位于下次请求发出前。假设活动消息是 `[S, U1, A1, U2]`，其中 `S` 是带工具声明的系统消息，其他三项分别是用户、助手、用户。可以分三次观察数据。

1. `emitContext` 先 `structuredClone(messages)`，在请求用的副本上工作。普通 `context` 处理器得到 `[U1,A1,U2]`。
2. 假设本次只保留 `U2`。处理器返回 `{messages:[U2]}`，runner 通过 `restoreSystemMessages` 合回系统消息。仅有首条 `S` 的本例现在是 `[S,U2]`。
3. `context_with_system` 处理器获得包含系统消息的完整数组，它返回的列表按原样继续。若它丢掉原有首条系统消息，runner 会报告提示与初始工具声明被移除，但仍尊重返回结果。之后才进入 `convertToLlm` 和 Provider 适配。

所以用同一段观察代码接两个事件，打印出来的首项可能完全不同。第 6 章的 `context_edit` 是持久的会话 Entry，重新打开仍能重放；这里的转换操作这次请求的副本，单独返回一个列表不会自动追加一条持久化编辑。[上下文的两阶段转换](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1300)

### 为什么保留一条用户消息时，系统消息的位置会改变

上面的例子只有首条系统消息。将它扩展为 `[S0,U1,S1,U2]`，其中 S0 声明 `policy: old`，S1 后来将同一章节改为 `new`。普通 `context` 处理器仍只收到 `[U1,U2]`，但 runner 在调用前保存了可见项的浅快照。比较是否相同时，`sameMessages` 检查长度和每个位置的**对象引用**。如果处理器返回 `[...event.messages]`，即使数组是新建的，内容和次序完全一致，`restoreSystemMessages` 会沿用当前序列，让 S1 留在原来的历史位置。

把处理器改成 `event.messages.slice(-1)`，只留下 U2，情况就不同了。如果仍按旧位置把 S1 塞回去，前面对话已经缩短，那个位置可能根本不存在。runner 改从原序列重放出有效系统状态，合成为一个头部，再拼接返回的消息，所以结果变成 `[S*,U2]`，其中 S* 的 `policy` 是 new。这解决了「删掉早期对话时首轮工具声明也一起失踪」的问题。之后若注册了 `context_with_system` 处理器，它接到的就是这个重建好的整体，并有能力再改变它。[比较与系统状态恢复](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L280)

课程中的实验通过真实资源加载器注册一个内联扩展，使用同一组输入分别运行上述两条处理路径，最后让旧 runner 失效。它直接调用事件分发，因而可以隔离观察请求转换，无需借助模型决定该生成什么。[上下文钩子实验](../examples/read-loop/context-hooks.mjs)

```bash
cd examples/read-loop
npm ci
node context-hooks.mjs
```

```text
复制列表保留原顺序  system → user → system → user
只保留最后用户消息  system → user，policy=new
原始输入仍有 4 条
runner 失效后，旧 ctx.getContextUsage() 抛出 stale 错误
```

这个输出也给出了一个定位法：若下一次模型请求少了旧轮次，而 Session 历史中仍保留它们，就检查 `context` 及 `context_with_system` 的结果；若切换叶子或重新打开后重建的投影本身已经不同，再检查持久条目和上下文编辑。两种情况下看见的模型文字都可能相同，区别在于数据改变发生在请求副本还是会话存档上。

## 6. 重载、冲突与状态归属

扩展可以临时用 `pi -e` 加载，也可以置于项目 `.pi/extensions/` 或用户扩展目录供自动发现。`/reload` 涉及运行时更换：旧 runner 收到带 `reason:"reload"` 的 `session_shutdown`，随后会失效。写在入口闭包里的 `let count = 0` 在新实例中重新初始化。若计数要跟随本次会话恢复，可以用 `pi.appendEntry` 记录自定义 Entry，再根据当前分支重建。普通自定义 Entry 供扩展使用，不会自动成为模型消息。[重载流程](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L3744) · [扩展状态和会话](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

还有一个常见定位问题：两个扩展都注册 `shared` 时，工具描述来自哪一个？上游测试在同一临时扩展目录写入 `a-first.ts` 和 `b-second.ts`，两者名称相同而描述分别为 `first` 和 `second`。它调用实际的 `discoverAndLoadExtensions` 创建 runner，然后断言收集结果只有一项，描述是 `first`。这验证了**跨扩展收集时先出现者保留**。同一个扩展内部则调用自己 Map 的 `set`，行为边界不同。[同名工具的加载测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/extensions-runner.test.ts#L428)

Package 可以把扩展、Skill、模板和主题作为一组资源分发。归属同一个包不会改变运行时入口：Skill 仍沿索引或显式命令加载，工具仍通过注册、查找、执行，模板仍在发送前展开。排查「安装了却没生效」时，先看资源属于哪一种，再追它对应的加载记录或运行事件。[Pi Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)

### 在 reload 前后追踪同一个工具名

假设用户刚关闭了工具 `write`，正在使用扩展注册的 `first_match`，此时修改扩展源码并运行 `/reload`。`AgentSession.reload` 先保存旧 runner 的标志值，通知旧扩展 `session_shutdown`，随后让旧 runner／runtime 失效；接着重读设置与资源、比较新增的默认工具、把当前活动的名字暂存起来，最后重建 runner 和工具集合。之所以保留名字，是因为有些扩展会在会话启动后才动态注册工具，例如 MCP 还得等待握手和发现。只复用旧函数会执行过期实现，只看刚重建时的工具表又可能误丢仍在启动的工具。[重载和活动集合的重建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L3741)

工具名仍然可以叫 `first_match`，入口函数和闭包却已经是重新加载的一份。之前某个异步回调捕获的 `ctx` 仍是旧对象，JavaScript 引用不会自动改指向新 Session。实验最后一行展示的是 `invalidate` 对这一类调用的保护；真实重载还会进行上述设置和资源更新。对于扩展自己创建的计时器、文件观察器和长连接，应在旧实例的关闭事件中按需要停止它们，否则外部工作可以继续运行，却无法再通过旧上下文操作当前会话。需要跨重载的业务数据应明确从持久记录或外部存储重建，短寿命的回调和信号则保留在原来的调用里。[旧上下文失效](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L729)

> **先预测**　扩展重载后，活动工具仍叫 first_match。旧计时器捕获的 ctx 能自动连到新工具吗？
>
> **核对推导**　不能。名字是新注册时可以复用的标识，ctx 却仍属于旧运行器；重载会让旧上下文失效。跨重载的数据要明确保存，计时器等资源也需要在旧实例退出时收尾。

[继续阅读：Workflow 与 Agent 的控制方式](10-workflow-vs-agent.md) · [返回课程路线](00-source-learning-path.md)
