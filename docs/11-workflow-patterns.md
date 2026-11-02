# Workflow Patterns：把多个 Agent 节点连接起来

假设项目的 CLI 传入空文件名时会崩溃。要做四件事：找入口、检查已有测试、拟定修复计划、核验实际修改。知道它们之间的依赖，比先决定“用几个 Agent”更有用。Pi 的 Subagent 扩展示例提供一段真实的调度代码，正好可以用来推演哪些步骤能同时发生。

![Mox 解释本章的机制关系](../assets/workflow-pattern-illustrations/04-parallel-sectioning-and-voting.png)

## 1. 用数据依赖决定调度方式

| 节点 | 需要的输入 | 交给下游的产物 | 何时可启动 |
| --- | --- | --- | --- |
| 调查入口 | 故障描述、仓库 | 相关函数和文件位置 | 立即 |
| 调查测试 | 故障描述、仓库 | 覆盖范围、缺失用例 | 可与入口调查同时 |
| 规划修复 | 两份调查结果 | 修改范围、验证条件 | 两份证据都回来后 |
| 检查产物 | 实际修改和测试结果 | 通过或失败、具体原因 | 修改产生后 |

这是一个教学设计。第一对节点独立读取仓库，适合并行。若两者同时写同一个快照文件，设计就多了一个共享依赖，需要分开工作目录或改变顺序。所谓路由，则是在这些节点之间根据结果选路。例如入口未找到时返回调查节点，证据完备才进入规划。路由条件来自代码时，即使节点里运行了模型，下一站仍由宿主决定。

## 2. 串行链究竟传递什么

上游的 `scout-and-plan` 提示模板要求模型用 `subagent` 的 `chain` 参数，先派 scout 调查，再派 planner 生成计划。前者和后者是独立角色。以下是针对本章故障的**教学调用参数**，字段来自扩展示例。[上游提示模板](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/prompts/scout-and-plan.md) · [模式参数与执行入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L448)

```json
{
  "chain": [
    {"agent":"scout","task":"查找 CLI 接收空文件名时的入口和测试"},
    {"agent":"planner","task":"根据这些调查结果拟定修复计划：{previous}"}
  ]
}
```

`previousOutput` 从空字符串开始。每一步先将任务中的 `{previous}` 替换成前一步选出的文本，再等待 `runSingleAgent(...)`。如果成功，`getFinalOutput` 逆序扫描消息，找到含文本块的最近助手消息，从其中取第一个文本块。假设它返回 `entry.ts 的 parseName 接受了空字符串`，这段话便会出现在 planner 的任务参数中。planner 并未收到 scout 的完整上下文；它可以凭文件位置再查原文。[链式替换与失败返回](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L548) · [最终文本的选择规则](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L168)

如果 scout 的退出码非零，或停止原因是错误、中止，当前结果会被保存进 `details.results`，工具返回 `isError: true`，并在文字中指出停在哪一步。planner 不再启动。只有整个链成功才把最后一步文本放进父工具的 `content`。这使“第一步失败”和“规划结果为空”能在结果边界上区分开。

### 先判断参数表达的是一种模式，还是两种相互矛盾的意图

从注册工具的 `execute` 往下读，第一道决定并不是「启动哪些进程」。扩展根据三个独立条件计算 `modeCount`：非空的 `chain` 算一项，非空的 `tasks` 算一项，同时有 `agent` 与 `task` 再算一项。计数必须等于一。举例说，单个 `reader` 配一份调查任务，同时再传两项 `tasks`，人可能理解为「先自己调查再派两个帮手」，这个接口却没有这种模式，两个条件为真后直接返回参数无效的说明，详情中的结果数组为空。空数组则不构成并行模式。[入口判断](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts#L491)

这个约束让我们可以把「先并行调查、再依据两份结果拟定计划」精确翻译成两次调度。第一次调用传 `tasks`，等回来后在宿主中检查每个结果，把调查证据整理成下一份输入；第二次调用才传 planner 的名字和任务。单次 `chain` 的每个项只有一个角色和一段任务，并没有一个能够嵌入并行子图的字段。看懂这几行后，你就能判断一个流程图是真能编码成一次调用，还是需要自己补中间那段胶水代码。

### 两份很像的交接材料，下一位实际只看得到一份

假设 scout 返回的同一条助手消息有两个文本块：第一块是「入口：src/args.ts」，第二块是「已测空串崩溃，输入见 tests/args.ts」。父扩展的 `getFinalOutput` 从最近的助手消息里挑到第一个文本块就返回。链保存了完整的子任务结果，但写进下一项任务的 `previousOutput` 只有第一块。于是 planner 能知道文件名，却不会自动知道第二块的测试证据。一条信息可以确实存在于父工具的 `details.results`，却从来没有进入下一个模型请求。这和一份完整报告存放在磁盘、而邮件只转发了标题是同一个区别。

下面是这个结论所依赖的整个选择函数。注意外层循环倒着走，内层循环却正着走；碰到第一个文本块就 `return`，没有拼接其余文本。

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L168)

```ts
function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}
```

有了这两层方向，就能处理一个更容易弄错的输入：第一条助手消息有说明 A，第二条只有工具调用，最后一条是工具结果。函数会跳过最后的非助手消息，再跳过没有文本的第二条，最后返回 A。它找的是“最近一个含文本块的助手消息里遇到的第一个文本块”，并不保证那段文字是对子任务整体的最终结论。如果所有消息里都没有这样的块，才返回空字符串。调试 planner 收到的是早先一段过程说明时，这个例子能帮你定位是取值规则生效，而不是消息时间顺序被打乱。

进一步，把 planner 的任务从「依据 {previous} 规划修复」改成「规划修复」，其他输入不动。前一步仍然执行，结果仍然记录；但替换表达式没有匹配位置，任务正文保持原样。串行保证的是开工次序，不是隐式共享整段消息。反过来，若任务里出现两次占位符，代码用的是全局替换，两处都会参与。调试“规划者似乎忘了调查结论”时，可以先看下一项实际收到的 task，再决定是结果提取丢了信息，还是提示模板根本没把它放进去。

这里还有一个设计选择：要对哪类信息要求无损？自然语言摘要可以短，但对一次修复，分支名、失败用例和可复验的命令最好作为明确字段或文件引用随任务传下去。否则即使每一步都以零退出，最终的方案也可能建立在「猜出来的测试状态」上。字段和文件交接是可以加在应用层的做法；示例源码原生传下去的仍是前文看到的文本。

## 3. 并行怎样限制数量并维持顺序

示例接受最多 8 个并行任务，同时运行的 worker 最多 4 个。这里的 worker 是一个不断取任务的异步函数，领取一个任务才启动相应子进程。

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L217)

```ts
async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}
```

假设传入五个任务 A、B、C、D、E。前四个 worker 在第一次 `await` 前分别取得索引 0、1、2、3。若 B 最先完成，它把结果写到 `results[1]`，随后领取索引 4，开始 E。这时 A 不必结束。假设结束次序恰好是 B、D、E、C、A，最终数组依然是 A、B、C、D、E，因为每个结果写回自己领取的索引。这里的索引分配发生在同一个 JS 执行环境中，取号与递增之间没有异步等待。

`Promise.all(workers)` 等所有 worker 的循环结束。正常返回的子任务结果中可以有失败项，汇总时逐项套用 `isFailedResult`，生成例如 `Parallel: 4/5 succeeded` 的文字及每项的状态，详细记录保留在 `details`。这一汇总返回没有把任一普通子任务失败都升级为整个工具的 `isError`。调用端要据自己的业务定义判断“允许部分成功”还是“必须全部成功”。如果子进程调度本身抛异常，Promise 的拒绝又是另一条路径。[并行汇总与输出上限](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L643)

### 实际启动五个子进程，看哪一个必须等待

这次不需要模型服务。下面的实验加载 Pi 安装包附带的 subagent 扩展，调用它注册的工具，子进程使用脚本代替真实模型输出。调度、限制并发、接收结果和归位仍由原扩展负责。[运行调度实验](../examples/read-loop/scheduler.mjs)

```bash
cd examples/read-loop
npm ci
node scheduler.mjs
```

如何避免测成「这台电脑上刚巧是这个顺序」？给 A、C、D 一条明确条件：看到 E 已开始的标记才允许结束。B 要等 A、C、D 都已开始，然后立即交卷。E 一旦获得位置就留下开始标记。假如调度器一定等整批四项全部结束才接第五项，这组输入就会卡住，并因实验设的等待上限报错。真正运行时，B 一结束，相应 worker 就会领取 E，释放了另外三项等待的条件。

一次执行可看到以下记录，`+` 表示子进程进入任务，`-` 表示任务即将结束。第一组四个符号的次序受操作系统调度影响，每次不必相同；程序断言的是一定成立的关系，而非某次偶然的确切排列。

```text
子进程实际记录：+B +C +D +A -B +E -E -D -A -C
同时处理任务的峰值：4；结果数组：A B C D E
```

沿着这行自己算一次：每个加号将未结束任务数加一，每个减号减一。遇到第四个加号时有四项在执行；B 结束后降回三，E 开始又达到四。这个值来自子进程实际写下的记录。另一个数八则是一次请求允许带的任务数上限：传入九项在分配 worker 前就会被拒绝；传入八项时却不是同时启动八个。容量限制控制一次接多少工作，并发限制控制一瞬间消耗多少资源。这两个数往往需要分别调整。

### 为什么界面显示的 running 不能当计时器

读 `allResults` 的初始化：调度前已经为每个输入分配占位对象，退出码先写成 `-1`。进度回调用是否等于这个值计算 running 与 done，而领号真正发生在另一个函数里。未领到位置的 E 也有占位对象；反过来，子任务的一次中间输出还会用它的当前结果对象替掉占位值。这个中间值不能充当操作系统所报告的活跃进程数。界面需要有按输入位置稳定的行，所以先占位很合理；若要测并发和耗时，应在启动和退出边界采样。上面的实验选择在子进程内部留下痕迹，就是为了把这两个观察面分开。

最后汇总时还会为父模型剪裁每项的文字。源码按 UTF-8 的**字节数**检查单项上限，超出就裁剪并附上省略了多少字节的提示；完整结果仍在工具详情。相同字符数的中文与英文输出，未必在同一处截断。因此面向下游的调查材料适合先写结论、证据位置和失败原因，再附长日志。如果日志特别长，下一位要能凭一个文件位置或标识重新找回原始内容，不能假设摘要就是完整记录。[进度占位与最终归并](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts#L614) · [字节裁剪](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts#L191)

## 4. 评审循环需要一项能终止循环的判断

上游还有 `implement-and-review` 模板，指定 worker 修改、reviewer 评审、worker 应用反馈三个步骤。第三次调用由模板预先指定，次数有限。应用也可以把评审改为条件循环。以下是这两种方案在同一个故障上的区别。[三个固定步骤](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/prompts/implement-and-review.md)

| 本轮结果 | 固定链 | 教学设计中的条件循环 |
| --- | --- | --- |
| 审阅没有发现问题 | 仍有模板指定的后续步骤 | 若真实回归测试已通过，可返回候选 |
| 发现缺少空字符串检查 | 最后一个 worker 接收评审文字 | 把失败断言和 diff 作为下一轮输入 |
| 连续多轮没有改善 | 固定步骤到头即结束 | 达到预算后保留最佳已验证候选，停止自动修改 |

### 失败是否应该挡住下游，取决于失败的那一项在证明什么

假如入口调查成功，测试调查失败。「两项有一项成功」正确描述了进程结果，却回答不了能否交给 planner。如果规划目标只是列出可能相关的代码，可以把测试证据记为未知，带着该限制继续；如果目标是证明修改不会破坏兼容性，少了测试调查就不应发通过信号。这里的关键是给每份结果一个明确用途，而非只拿成功个数投票。尤其不能把没有运行的测试记为通过。

可执行的判定可以很小：宿主在合并前逐项检查退出码以及 `error`、`aborted` 两种停止原因，只有必要调查都成功才构造 planner 的任务；其余情形把失败角色与原始错误返回给调用者。再看 `getResultOutput`，失败时优先采用错误消息，再取标准错误，然后才回退到最后的助手文字。这个顺序保留了「子进程为什么没做完」的重要线索。第十四章的真实子进程实验就有一个任务在标准错误写下原因，以非零码退出；将两章放在一起，就能从工具汇总一路追到产生这条错误的进程。

对这个故障，最有价值的交接材料包括具体函数、用例输入、期望行为和实际测试状态。模型可以根据这些材料改进代码，判定“空字符串是否仍然崩溃”的证据则来自运行。第 14 章会打开单个 worker 的子进程边界，看参数如何送达、状态又怎样回到这个调度器。

> **先预测**　A 至 D 占满四个位置。B 结束，A 尚未结束；第五项 E 是否必须等 A？
>
> **核对推导**　不用。B 对应的 worker 写回自己的结果后就能领取索引 4 并启动 E。最终数组仍按各项最初领取的索引排列，所以运行顺序和结果顺序可以不同。

[继续阅读：Planning 与 Reasoning：从推理配置到可执行计划](12-planning-and-reasoning-patterns.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
