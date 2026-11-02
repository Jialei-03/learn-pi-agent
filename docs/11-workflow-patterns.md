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

上游的 `scout-and-plan` 提示模板要求模型用 `subagent` 的 `chain` 参数，先派 scout 调查，再派 planner 生成计划。前者和后者是独立角色。以下是针对本章故障的**教学调用参数**，字段来自扩展示例。[上游提示模板](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/prompts/scout-and-plan.md) · [模式参数与执行入口](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/subagent/index.ts#L448)

```json
{
  "chain": [
    {"agent":"scout","task":"查找 CLI 接收空文件名时的入口和测试"},
    {"agent":"planner","task":"根据这些调查结果拟定修复计划：{previous}"}
  ]
}
```

`previousOutput` 从空字符串开始。每一步先将任务中的 `{previous}` 替换成前一步选出的文本，再等待 `runSingleAgent(...)`。如果成功，`getFinalOutput` 逆序扫描消息，找到含文本块的最近助手消息，从其中取第一个文本块。假设它返回 `entry.ts 的 parseName 接受了空字符串`，这段话便会出现在 planner 的任务参数中。planner 并未收到 scout 的完整上下文；它可以凭文件位置再查原文。[链式替换与失败返回](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/subagent/index.ts#L548) · [最终文本的选择规则](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/subagent/index.ts#L168)

如果 scout 的退出码非零，或停止原因是错误、中止，当前结果会被保存进 `details.results`，工具返回 `isError: true`，并在文字中指出停在哪一步。planner 不再启动。只有整个链成功才把最后一步文本放进父工具的 `content`。这使“第一步失败”和“规划结果为空”能在结果边界上区分开。

## 3. 并行怎样限制数量并维持顺序

示例接受最多 8 个并行任务，同时运行的 worker 最多 4 个。这里的 worker 是一个不断取任务的异步函数，领取一个任务才启动相应子进程。

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/subagent/index.ts#L217)

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

`Promise.all(workers)` 等所有 worker 的循环结束。正常返回的子任务结果中可以有失败项，汇总时逐项套用 `isFailedResult`，生成例如 `Parallel: 4/5 succeeded` 的文字及每项的状态，详细记录保留在 `details`。这一汇总返回没有把任一普通子任务失败都升级为整个工具的 `isError`。调用端要据自己的业务定义判断“允许部分成功”还是“必须全部成功”。如果子进程调度本身抛异常，Promise 的拒绝又是另一条路径。[并行汇总与输出上限](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/subagent/index.ts#L643)

## 4. 评审循环需要一项能终止循环的判断

上游还有 `implement-and-review` 模板，指定 worker 修改、reviewer 评审、worker 应用反馈三个步骤。第三次调用由模板预先指定，次数有限。应用也可以把评审改为条件循环。以下是这两种方案在同一个故障上的区别。[三个固定步骤](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/prompts/implement-and-review.md)

| 本轮结果 | 固定链 | 教学设计中的条件循环 |
| --- | --- | --- |
| 审阅没有发现问题 | 仍有模板指定的后续步骤 | 若真实回归测试已通过，可返回候选 |
| 发现缺少空字符串检查 | 最后一个 worker 接收评审文字 | 把失败断言和 diff 作为下一轮输入 |
| 连续多轮没有改善 | 固定步骤到头即结束 | 达到预算后保留最佳已验证候选，停止自动修改 |

对这个故障，最有价值的交接材料包括具体函数、用例输入、期望行为和实际测试状态。模型可以根据这些材料改进代码，判定“空字符串是否仍然崩溃”的证据则来自运行。第 14 章会打开单个 worker 的子进程边界，看参数如何送达、状态又怎样回到这个调度器。

[继续阅读：Planning 与 Reasoning：从推理配置到可执行计划](12-planning-and-reasoning-patterns.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
