# Security：信任边界怎样在代码中落实

团队打开一个刚下载的仓库。里面既有解释项目结构的 README，也有一个 `.pi/extensions` 目录。前者可能影响模型下一步生成什么，后者一旦被加载，能够在 Pi 进程中运行代码。对这两个入口，Pi 提供了不同的控制位置。

![Mox 解释本章的机制关系](../assets/context-engineering-illustrations/03-trust-boundaries-and-injection.png)

## 1. 先决定可以加载哪些项目资源

考虑这个教学用目录。项目还没有获得信任，用户目录里也没有为它保存过决定。

```text
demo/
├── AGENTS.md
├── README.md
└── .pi/
    ├── mcp.json
    └── extensions/read-policy.ts
```

启动时，CLI 会检查是否存在受保护的资源，例如项目 MCP 配置、扩展、Skill、提示模板和项目设置。对于这个有受保护资源的例子，决策顺序是命令行覆盖值、可参与决策的扩展、已保存的路径决定、全局默认策略。命中某一项便返回。用户或命令行提供的扩展可以参加早期信任判断，等待加载的项目扩展不能自行宣布自己受信任。[信任判断实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/project-trust.ts#L47) · [资源范围和决定顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/docs/security.md)

| 本次条件 | 结果 | 针对这个目录会发生什么 |
| --- | --- | --- |
| 传入 `--no-approve` | 用这一次的拒绝决定 | 跳过项目 MCP、项目扩展等受保护资源 |
| 没有覆盖、扩展没有决定，父目录保存了允许 | 继承最近适用的决定 | 允许加载相应项目资源 |
| 没有覆盖或保存记录，默认 `ask`，以 JSON 模式运行 | 没有内置交互确认界面，返回 false | 跳过受保护资源 |

这个判断决定的是**发现和加载**。项目的 `AGENTS.md` 等上下文文件在默认设置下仍可加载，用户也可显式关闭上下文加载。项目 `sessionDir` 在选择会话目录时还有更早的一次读取。理解这些入口，才能知道一次“拒绝信任”的具体效果。[启动时机与上下文文件](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/docs/security.md)

### 一个决定怎样从启动参数流进资源加载器

“等待信任决定”本身有个先后问题。为了让用户自己安装的扩展参与判断，宿主必须先加载一部分代码；为了保护用户，又不能先执行正要审查的项目代码。入口程序把这件事拆成两段。第一次遇见有受保护资源的目录，若没有命令行覆盖值和本次运行缓存，它先用 `projectTrusted = false` 建立该目录的 `SettingsManager`，然后把一个尚待调用的 `resolveProjectTrust` 函数交给服务装配。此时判断方式已经写好，最终决定还没有产生。[CLI 组装决定回调](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/main.ts#L752)

稍后的资源加载阶段才调用这个函数。先取得信任判断之前允许参与的扩展，将它们交给决策回调，把返回值写回 `settingsManager`，再按新的信任状态重载设置、解析包和可用资源。下列调用顺序很关键。如果先让项目扩展完成加载，再根据用户的选择把它从界面列表里删掉，扩展初始化时执行的代码已经运行，无法靠隐藏列表项收回。

源码摘录：[packages/coding-agent/src/core/resource-loader.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/resource-loader.ts#L548)

```ts
let preTrustExtensions: LoadExtensionsResult | undefined;
if (options?.resolveProjectTrust) {
	preTrustExtensions = await this.loadProjectTrustExtensions();
	const projectTrusted = await options.resolveProjectTrust({ extensionsResult: preTrustExtensions });
	this.settingsManager.setProjectTrusted(projectTrusted);
}

// reload() preserves SettingsManager.projectTrusted and reloads settings for that trust state.
await this.settingsManager.reload();
const resolvedPaths = await this.packageManager.resolve();
```

这个布尔值怎样产生实际效果？设置管理器读取项目级设置时会查询它，未获信任的项目设置得到空配置；用户级设置有自己的读取范围。主程序还向资源加载器传其他开关，例如是否允许上下文文件。它们在不同位置判断，因此“没有加载这个项目的扩展”和“完全没有把这个目录里的文字送给模型”是两个要分别验证的结论。把控制落到具体对象和读取方法上，比在所有功能上笼统地贴一个“安全模式”的名字准确。[设置的按范围读取](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/settings-manager.ts#L366)

### 受保护资源和已保存的决定都要沿路径查找吗

两类查找的算法并不相同。检查资源时，程序在当前目录的 `.pi` 下查看有意义的文件或子目录。之后才单独向父目录逐级检查项目 `.agents/skills`，并排除识别为用户级的那个技能目录。按这个规则，一个空的 `.pi` 目录本身不会触发项目资源信任流程。如果测试只创建空目录便期望弹窗，就在验证一条实现并未采用的规则。[资源检查的实际遍历](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/trust-manager.ts#L193) · [空目录和受保护资源的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/trust-manager.test.ts#L39)

查决定时，程序先规范化当前工作目录，再逐级向父目录找持久决定。假设 `/work` 的决定是允许，`/work/demo` 是拒绝，从 `/work/demo/src` 开始向上走，先遇到 demo 的拒绝就返回，根本不会用到 work 的允许。删除较近的一条决定后，父目录的允许又成为首个匹配。如果一路找不到才返回 `null`。这里的三态很要紧，`false` 代表已有明确拒绝，`null` 才意味着应该继续寻找其他决策来源。因此代码显式检查值是否为布尔真或布尔假，不能用简单的真值条件把拒绝当成缺失。[最近路径决定](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/trust-manager.ts#L50)

## 2. 沿一次写入请求找到阻止它的位置

现在单独考虑用户从可信来源安装的 `protected-paths` 示例扩展。设 README 的文字影响了模型，模型生成对 `.env` 的写入请求。这里使用虚构内容，只观察宿主如何处理候选动作。

```json
{"id":"call_7","name":"write","arguments":{"path":".env","content":"EXAMPLE=demo"}}
```

1. Agent 根据工具定义准备并验证参数。这个对象可能完全符合结构要求。
2. `AgentSession._beforeToolCall` 取当前扩展运行器，把 `toolName`、`toolCallId` 和 `input` 放进 `tool_call` 事件。嵌套调用还可以带上父调用标识。
3. 示例扩展只处理 `write` 和 `edit`。它对输入路径做子串检查，命中 `.env` 后返回 `block: true`。
4. Agent 接到阻止决定，在准备阶段形成错误结果，跳过该调用的 `execute`。后续模型可以收到失败原因。若在 `tool_result` 阶段才修改文字，实际写入已发生。

[Session 组装钩子事件](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L674) · [工具准备与阻止分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts)

源码摘录：[packages/coding-agent/examples/extensions/protected-paths.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/protected-paths.ts#L10)

```ts
export default function (pi: ExtensionAPI) {
	const protectedPaths = [".env", ".git/", "node_modules/"];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const path = event.input.path as string;
		const isProtected = protectedPaths.some((p) => path.includes(p));

		if (isProtected) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
			}
			return { block: true, reason: `Path "${path}" is protected` };
		}

		return undefined;
	});
}
```

同一段代码还可以推导出两个容易遗漏的边界。路径 `notes.env.example` 也含有 `.env`，因而同样被挡住。另一个叫 `save_report` 的工具即使接受相同路径，也会在函数开头直接返回 `undefined`。这段扩展实现的是针对特定工具名和字符串的策略。要从操作系统层面保护文件，需查看实际的挂载、账号、进程权限与网络范围。[隔离环境的覆盖范围](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/docs/security.md)

### 相同的参数，在哪一层仍然可能改变

把刚才的 `call_7` 展开成一个更细的调用栈。低层 `prepareToolCall` 先按工具名搜索活动集合。找不到工具时，立即返回带错误标记的结果，策略钩子和执行器都没有机会运行。找到工具后，才进行参数 preparation 与 Schema 校验。传给前置钩子的 `args` 是这次校验处理过的对象，而 `toolCall` 仍指向模型生成的调用。审计时记录模型原始输入可以解释模型想干什么，记录执行器收到的参数才能解释实际准备执行什么。[准备调用的三条返回路径](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent-loop.ts#L718)

会话侧的包装器在每次调用时读取当前 `_extensionRunner`，所以重新加载扩展时能替换其处理器，无须给 Agent 重新布线。运行器先快照目前注册的处理器，再逐个等待；只要某个返回值带 `block: true`，就立即返回该决定。若有三个扩展，第一项只观察，第二项阻止，第三项便看不到后续的同一次前置事件。假如审计程序挂在第三项，然后据“没有收到事件”认定“模型从未提出这次动作”，它的推断就错了。运行器的遍历顺序会直接影响观察证据的完整性。[会话的接线位置](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L669) · [处理器的等待与短路](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L1249)

上游有个反直觉但很说明问题的测试。模型请求一个 `echo` 工具，原始参数是字符串 `"hello"`。工具的 Schema 也确实要求字符串。低层前置钩子在收到对象以后将其 `value` 改成数字 `123`，返回 `undefined`。这条控制流复用已校验参数对象，未再跑一次 Schema 校验，测试最终断言真正进入 `execute` 的值为 `[123]`。这表明“入口处验证通过”只说明当时对象的状态。第 16 章里 Durable 的工具任务在钩子之后还会再校验一次，调试参数时要先分清走的运行路径。[参数变化的完整测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/test/agent-loop.test.ts#L528) · [Durable 的第二次校验](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/tool.ts#L156)

从策略作者的角度，这还有一个次序问题。假设一项应用政策审阅的是准备时的目标路径，另一个后置的前置钩子又有能力改动同一个参数。此前保存的说明仍指向原路径。若产品要求确认绑定到真正执行的动作，就应把动作目标的最终确定、与批准记录的对照和执行尽量放在同一个受控边界内；如果中间允许再改，改动后要重新判断。这个是应用需要建立的契约，示例中的字符串拦截器没有承诺提供这样的整体事务。

## 3. 模型调用 Bash 和用户命令走哪个入口

还有一条容易漏掉的路径。模型生成的 `bash` 工具请求走 `tool_call`，交互用户输入的 Shell 命令和相应 RPC 请求则有 `user_bash` 事件。分析策略时，应把“谁提供这个动作”和“哪个执行器会接到它”连起来。来自仓库文件的文字本身不能变成用户对某个动作的同意。

上游 RPC 回归测试发送固定输入 `{"id":"bash-request","type":"bash","command":"pwd"}`，用替身记录 `session.executeBash` 真正被调用多少次，再比较扩展的三种返回方式。[测试输入与断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/suite/regressions/9068-user-bash-fail-closed.test.ts#L144)

| `user_bash` 处理器的行为 | RPC 答复 | 本地执行次数 |
| --- | --- | --- |
| 抛出 `Routing failed` | 返回失败并上报扩展错误 | 0 |
| 错误地返回空对象 `{}` | 判定为无效处理结果 | 0 |
| 返回 `undefined` | 正常交给本地执行 | 1 |

这组断言区分“扩展主动让默认实现继续”和“扩展失败”两种情况。倘若路由到隔离环境的扩展报错后悄悄回退到本机，调用者可能只看到命令成功，却在错误的环境中执行了它。

### 为什么空对象会挡住本地执行，undefined 却不会

用户直接运行 Shell 的钩子面向的是另外一种返回协议。`undefined` 表示当前处理器不接手，事件运行器继续找后面的处理器。符合要求的 `{operations}` 指定执行后端，`{result}` 则表示处理器已经给出结果。这两种都能使宿主明确接下来的责任归属。空对象既没给出后端，也没交回结果，程序将其视为错配；同时塞进两者也会造成含义冲突。运行器检查返回对象，遇到不合法结果会发出扩展错误并抛错。外层 RPC 可以把失败和原请求标识关联，停止本地执行。[返回值的形状验证](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/extensions/runner.ts#L142) · [RPC 接收入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L562)

沿三种有效结果推演一个无害命令 `pwd`。当所有处理器都交回 `undefined`，交互入口可以走默认会话执行器，从本地环境得到路径。若一项返回指定远端执行的 `operations`，工具结果中的当前目录应该来自远端。若它返回已经构造好的 `result`，该响应来自扩展，不能仅凭文本像路径就声称本机实际启动过 Shell。由此可见，分析一条动作轨迹时应同时保存动作来源、选中的后端以及执行证据。尤其是仅改了模型侧工具集或仅装了 `tool_call` 策略时，不能将这条直接用户命令路径自动纳入保护范围。[交互入口的路由](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L7095)

## 4. 同一个动作应从哪几层取证

以保护 `.env` 的教学案例为例，检查模型消息可知道它有没有提出写入。检查带 `call_7` 的工具结果能知道扩展是否拒绝。检查目标文件的前后内容才能验证文件是否改变。如果还担心外发，则应在受控接收端或网络层观察效果。每项证据对应不同问题，单看最终回答无法区分“没有提出动作”和“动作被拦截”。

需要人工确认时，官方 `permission-gate` 示例在 `tool_call` 中把待执行命令交给选择框，无 UI 时会阻止命中特定危险模式的命令。它保护的是这些模式和这个入口。需要跨重启保留批准，或在多个入口之间共用身份和授权的产品，可以把第 16 章的持久动作记录接在这一层。[Permission Gate 的实际分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/permission-gate.ts)

### 把一个安全结论写成可检验的范围

对初始那个仓库，可以建立三个各自可验证的小结论。其一，启动时没有加载项目扩展，要查资源列表和信任判断，单看对话窗口不够。其二，某个由模型提出的 `write` 被阻止，要能通过调用标识串起请求、策略决定和失败的工具结果。其三，受保护文件在操作之后依然完整，要从文件系统独立读回或比对摘要。即使前两项都成立，执行着同等权限的其他扩展也可能通过别的路径改变文件。若目标是限制整个进程能够读写的资源，控制点应该移到操作系统账户、文件挂载或隔离环境。若只将内置工具重定向到容器，仍在宿主运行的扩展要单独纳入分析。[Pi 对部署边界的说明](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/docs/security.md)

在已安装依赖的 Pi 源码中，下面两组命令分别复查目录边界与执行边界。第一组测试在临时目录里设置父子决定，并模拟 RPC 处理器出错，断言真实执行替身的调用次数为零。第二组交给底层 Agent 一个模拟模型流，观察参数在钩子之后的确进入了工具。复查这种安全主张时，断言“某个调用次数为零”比只断言“显示了拒绝文案”多排除一种可能，即界面报错但实际执行器仍被调用。

```bash
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js run test/trust-manager.test.ts test/suite/regressions/9068-user-bash-fail-closed.test.ts
cd ../agent
node ../../node_modules/vitest/dist/cli.js run test/agent-loop.test.ts -t 'should execute mutated beforeToolCall args without revalidation'
```

> **先预测**　用户通过 RPC 发出 pwd。扩展返回空对象，能否把它当作没处理，继续走本地 Shell？
>
> **核对推导**　不能。在本章的 user_bash 路径，未接管时返回 undefined；声称接管却没有提供合法结果或后端的空对象属于无效响应。回归测试检查这种情形下本地 executeBash 没有被调用。

[继续阅读：Observability 与 Evaluation：怎样用证据改进 Pi](18-observability-evaluation-and-harness-engineering.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
