# Workflow 与 Agent：下一步由谁决定

在“读取 README 并解释项目”的例子里，模型决定是否要读文件。换一个任务：让 Pi 创建模板、重新加载项目、再实际调用模板。如果把这三步都写在一句提示里，模型可以自选路径。如果程序必须保证创建后真的重新加载，就要把其中一部分次序写进宿主代码。Pi 自己的文档评测正好这样做。

![Mox 解释本章的机制关系](../assets/workflow-agent-illustrations/05-routing-boundary.png)

## 1. 把两层循环画在一起

```text
调用方的三步流程                每次 prompt 内部
① prompt「创建模板」 ─────→   请求模型 → 工具调用 → 工具结果 → 请求模型
② reload             ─────→   宿主重新加载资源
③ prompt「/current-time」 →   展开模板 → 请求模型 → 得到回答
```

图中左侧的步骤次序来自评测用例。右侧第一个 `prompt` 的具体轨迹由模型响应、活动工具和运行时规则共同决定。这里画出了一条可能的工具调用路径，真实模型执行时可以调用多次工具。第二步则由程序直接调用 `session.reload()`，无须等待模型提出 reload 请求。[三步流程的定义](https://github.com/earendil-works/pi/blob/main/packages/evals/evals/prompt-templates.docs.eval.ts) · [流程执行器](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L370)

在这个设计里，“工作流”是应用对节点和顺序的选择，“Agent”负责节点内部需要观察环境和决定下一次动作的部分。决定由谁做，可以从代码中的循环、条件分支以及各次调用的参数直接看出来。

## 2. 一次 await 的两侧

评测宿主用 `promptAgent` 把 Session 包装成一个可嵌入工作流的步骤。先看完整的小函数，再推演其中两个例子。

源码摘录：[packages/evals/src/harness.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L238)

```ts
async function promptAgent(session: AgentSession, input: string, signal: AbortSignal | undefined): Promise<string> {
	signal?.throwIfAborted();
	const previousMessageCount = session.messages.length;
	await session.prompt(input);
	const assistant = session.messages
		.slice(previousMessageCount)
		.reverse()
		.find((message) => message.role === "assistant");
	if (!assistant) throw new Error("Agent run completed without an assistant message.");
	if (assistant.stopReason !== "stop" && assistant.stopReason !== "toolUse") {
		throw new Error(
			assistant.errorMessage ?? `Agent run ended with unexpected stop reason: ${assistant.stopReason}.`,
		);
	}
	const output = session.getLastAssistantText();
	if (!output && assistant.stopReason === "stop") throw new Error("Agent run produced no assistant text.");
	return output ?? "";
}
```

假设进入函数时 `session.messages.length` 为 5。调用期间新增了一条用户消息、一个请求工具的助手消息、一条工具结果和最后的助手答复。`slice(5)` 把这一段新产生的消息取出来，`reverse().find(...)` 从末尾找到最后一条助手消息。如果这一轮没有助手消息，函数会报错，避免将上一个节点的旧答复误认为本轮产物。

接下来是**该评测宿主自己的接纳规则**。`stop` 与 `toolUse` 在允许集合中，`error`、`aborted` 或其他原因会抛错。最后通过 `getLastAssistantText()` 提取文本。自然结束却没有文本会被拒绝，合法的 `toolUse` 则允许返回空字符串。这个函数没有验证模板文件位置。是否完成业务动作，还要交由用例读取产物。[提取助手文本的实际实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L4428)

| 教学输入状态 | 包装函数看到的值 | 调用方接下来会怎样 |
| --- | --- | --- |
| 本次没有产生助手消息，历史里有旧答复 | 本轮切片找不到 `assistant` | 抛出缺少助手消息错误 |
| 模型因长度上限结束，已有一段可读文本 | `stopReason = "length"` | 拒绝这次结果 |
| 自然结束且含有文本 | `stopReason = "stop"`、文本非空 | 将文本交还流程，业务判断另行进行 |

由此可以理解为什么 `await session.prompt(...)` 能作为“这一步完成等待”的边界。它返回 `Promise<void>`，程序要从事件、消息、工具记录或文件中取得自己需要的产物。

## 3. 为什么三步复用一份 Session

后两步必须能找到第一步创建的项目模板。评测为一次运行创建工作区、资源加载器和 SessionManager，并保存运行标识。后续循环在同一个 Session 上执行步骤。reload 后可以重新发现落盘资源，第三步的会话消息也留在同一份历史里。[会话装配和运行标识](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L337)

如果把这个流程拆成三个独立 Session，要额外传递工作目录、模板作用域与希望保留的上下文。反过来，即使每个节点都创建了新 Session，只要它们仍共享工作目录，第一步写的文件就可能被第二步看到。消息历史和文件系统是两条独立的数据通道。这个观察在下一章并行调度时还会用到。

### 把“创建成功”拆成三个能分别查证的事实

设想你收到一份故障报告：「Pi 回复已创建，输入命令却没有效果」。先不要换提示词。打开脚本里的两个路径：工作区是 `project/`，用户配置在另一个临时目录 `config/`。我们要的是**这个项目**的模板，因此预期产物是 `project/.pi/prompts/overview.md`。在项目根目录创建同名文件，或者把内容放在普通笔记目录，都满足「有一个文件」，却不满足这个功能的约定。发现规则属于资源加载器；文件系统不会因为扩展名是 Markdown 就把它注册为命令。

接下来再区分下面三个观察。文件读取得到的是字节，告诉你写入落到了哪里。资源加载器的 `getPrompts().prompts` 给出这份会话当前认识的模板名，告诉你它**现在能找到**什么。最后一次模型请求里的用户消息告诉你模板入口**实际上用了什么**。三个值分别由文件系统、资源加载器、请求处理产生。任选一个都不足以代替另外两个。尤其是模型回答「已创建」这句话——它属于第四种信息，只说明助手说了什么。

在我们的小程序里，模型的第一轮固定要求内置 `write` 写下「请核对 [$1] 的入口。」。写入后助手固定回答「已创建。」。这样设计的用意是把一个变量固定住：三个情形都会得到外观相同的成功答复。如果结果仍有差异，其原因就应当在助手答复以外寻找。下面会把第三次请求送进模型时的输入直接打出来；这比让模型复述「你刚才有没有看到模板」更容易验证。

### 对照实验：一次只移走一个条件

在课程仓库运行下面的小程序。只需在示例目录安装一次依赖。它为每一行单独创建临时项目，调用 Pi 的 SDK、内置写文件工具和资源发现逻辑；不会读取真实模型的密钥。[可运行的三组对照](../examples/read-loop/workflow.mjs) · [模板展开入口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/prompt-templates.ts)

```bash
cd examples/read-loop
npm ci
node workflow.mjs
```

| 改了哪个条件 | 预期位置有正确内容 | 写完立即可发现 | 发最后一条命令时可发现 | 送到模型的最后一条用户消息 |
| --- | --- | --- | --- | --- |
| 正确位置，随后 reload | 是 | 否 | 是 | 请核对 [cli] 的入口。 |
| 正确位置，省去 reload | 是 | 否 | 否 | /overview cli |
| 写进 notes/，随后 reload | 否 | 否 | 否 | /overview cli |

第一行最值得慢读。初始化 Session 时，加载器已经扫过当时的目录。后来 `write` 的职责只是创建文件，它没有承诺同步更新同一 Session 的资源列表。程序明确等待 `session.reload()`，加载器重新扫描；之后处理 `/overview cli` 时，才有一个同名模板可供匹配。参数 `cli` 替换模板中的 `$1`。我们在 Provider 边界看到的是展开后的普通用户消息，所以模型不需要知道斜杠命令的语法。

再横向比较最后两行。站在模型这一端观察，它们不可区分，输入都是字面上的斜杠命令。往回查一层，资源列表也同样没有这个名字。再往回查磁盘，才出现第一个不同的事实：第二行内容已经在预期位置，第三行并没有。于是修复也不同：第二行需要刷新已经装配好的资源，第三行要先修正写入位置。对着模型重复发送命令，对这两种原因都没有帮助。

这也解释了模拟的边界：真实模型是否总会主动挑对目录，这个实验没有测。这里测的是**一旦写入路径和刷新顺序确定，Pi 接下来究竟会怎么处理**。想评估模型选址是否可靠，才需要换成真实 Provider，保留这里的三个观察点，分别统计在哪个边界出了差错。

## 4. 业务流程如何处理失败、取消和发布

用发布说明作为第二个例子。下面是应用设计示例，控制流以可信产物作为判断依据。

| 阶段 | 宿主提供的输入 | 产物或进入下一步的依据 |
| --- | --- | --- |
| 收集改动 | 两个提交标识 | Git 返回的变更集合和退出状态 |
| 调用 Pi 起草 | 已确认的变更集合 | 当前运行结束、生成了候选说明 |
| 核对说明 | 候选内容、原始变更 | 引用的提交存在、没有遗漏要求中的变更 |
| 发布 | 已经批准的明确产物 | 发布服务返回的发布标识 |

如果调用者取消，评测宿主会把信号连到 `session.abort()`，在离开步骤循环时解除监听并等待已发起的取消完成。如果只是把调用方 Promise 丢弃，内层模型请求仍可能在继续。类似地，重新起草说明通常只产生一个新候选，再调用发布动作却可能新增一次发布，二者应使用不同的重试条件。[宿主的取消生命周期](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L360)

### 在宿主里找到那个真正推进流程的循环

打开[评测宿主的步骤执行器](https://github.com/earendil-works/pi/blob/main/packages/evals/src/harness.ts)，从处理传入步骤的循环读起。在 prompt 分支，它等 `promptAgent` 返回；在 reload 分支，它等 `session.reload()`。这两个等待看起来相近，实际等待的对象不同。前者内部可以有任意多轮模型与工具往返；后者由宿主直接调用资源管理代码，先让旧扩展运行器结束当前生命周期并失效，再重新加载设置和资源，按照当前工具选择重建运行时。两者之间没有「模型决定现在执行第二个节点」的消息。在调试器里，即使跳过查看全部模型文本，也可以沿控制流确定是哪行宿主代码把程序送到了第三步。[reload 的实现](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)

可以直接把下面的七行当作一张执行表来读。左手沿数组向前移动一步，右手记住 `response` 的当前值。遇到 reload，只重新加载并跳到下一次循环；它不会产生一条新的模型答复，也不会给 response 赋值。

源码摘录：[packages/evals/src/harness.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L374)

```ts
for (const step of steps) {
	if (step.type === "reload") {
		await session.reload();
		continue;
	}
	response = await promptAgent(session, step.content, signal);
}
```

代入本章的成功输入：第一项执行完，`response` 保存创建模板后的文本。第二项虽然改变了会话能发现的资源，`response` 原封不动。第三项执行完，它才被调用模板后的答复替换。所以如果调用者只取最终字符串，得到的只是最后一项回复，看不出过程中到底做了几件事。它既不包含每个节点的结果，也不能证明 reload 发生过。用例的输出提取器接收整个 session 和目录，正是为了能跨过这个窄窄的字符串接口检查实际产物。

再试着在纸上运行一个只有 reload 的步骤数组：循环可以走完，但一次 prompt 都没执行过，response 仍是 `undefined`。紧接循环的判断会以「至少需要一个 prompt」报错。这说明“没有回复”和“回复为空”在宿主设计里也不等价。对调试很有帮助：前者应检查流程是不是根本没运行需要模型的节点，后者才回到那次模型回复的结束原因和文本块。即使都没有向人显示可读内容，故障发生的函数也不同。

如果要给这个三步流程写一个最小检查，先锁定两项独立断言：在约定位置读到原样模板；模型边界上最后的用户消息等于展开后的文字。把两者都设为真，刚好分别排除图中的写错位置和漏掉刷新。再把实际观察值一并留下，失败时才分得清哪一步要修。这比检查助手最终回复里是否含有“创建成功”四个字更贴近产品真正承诺的行为。

还有一个容易误判的反事实：如果第一步写错目录但助手正常结束，步骤循环会不会自动跳过后两步？不会。这个宿主的正常回复检查没有「项目模板存在」这个条件，后面的节点照样可以运行。等到用例构造结构化结果时，才会检查模板作用域、实际路径、展开文本等。若这是产品功能而非评测，可以把“预期文件能否读到”改为 reload 前的业务分支；这是一种不同的应用设计，不能把它误读成现有 Pi 每次都会执行的保护。上面的第三行正说明了这个差别：**执行过一个节点，不等于已经验收它的产物。**

### 从产物反推要重跑哪一步

回到这份故障报告。如果预期文件内容正确，且初始化以来没有刷新过，重跑写文件就没有必要；直接刷新、检查资源、再调用即可。如果刷新后有同名模板却属于用户而非项目，还得比较模板来源和文件路径——在另一项目也能调用恰好可能意味着作用域写错。这就是上游为项目级和用户级各设一个评测用例、并一起检查另一位置没有副本的理由。否则「能展开」单项断言会让污染用户目录的实现也通过。

最后把这一思路带回发布例子。一次模型调用失败，重跑草稿最多多一个候选；发布请求已送达但响应丢失，此时本地看到的同样是“没有成功结果”，远端却可能已经发布。该查的是外部发布标识或同一请求的去重记录，而不是让模型换个措辞再发一次。Pi 能帮宿主等到会话结束、观察工具返回；什么结果足以进入下一节点，最终取决于应用能从哪个拥有事实的系统取证。

第 18 章会回到同一个模板流程，打开评分函数，观察它如何把“完成了三步”进一步检验为“在正确的位置创建并成功调用了模板”。

> **先预测**　模型收到的仍是 /overview cli。怎么区分“写错目录”和“写对了但没 reload”？
>
> **核对推导**　这两个失败在模型边界看起来一样。先读预期路径下的模板正文，再查当前 loader 的名字列表。文件正确但列表缺失，才符合漏刷新；文件不在那里，则先修正写入位置。

[继续阅读：Workflow Patterns：把多个 Agent 节点连接起来](11-workflow-patterns.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
