# Durable：提交、任务状态与崩溃后的继续执行

设想一个工具把款项提交给外部服务，然后进程在写入成功记录之前重启。会话里缺少结果，此时重新调用一次，会不会造成两次转账？Pi 仓库用一个金额为 7、回执为 70 的模拟服务，把这个问题写成了可重复的恢复测试。我们先从这个例子理解“继续”究竟从哪里开始。

![Mox 核对已提交记录与可能发生的外部动作](../assets/mox-mechanisms/durable.png)

## 1. 一条消息和一项可恢复的工作

前面看到的 `SessionManager` 管理消息树。`pi-durable` 则提供另一条运行路径。打开 `Harness` 时，应用把存储、注册的任务和运行配置交给它。一个 `Conversation` 接纳输入，创建可追踪的 `Submission`，具体执行单元称为 `Task`。任务状态里可以保存 `checkpoint`，其中的 `phase` 指向下次进入哪个处理函数。[Harness 的打开路径](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/harness.ts) · [提交接口](https://github.com/earendil-works/pi/blob/main/packages/durable/src/harness/submissions.ts)

源码摘录：[packages/durable/src/harness/submissions.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/src/harness/submissions.ts#L65)

```ts
async submit(conversationId: ConversationId, draft: SubmissionDraft, context: Context): Promise<Submission> {
	const { id } = await this.#traced(conversationId, draft, context, (span) =>
		this.#session.commitWith(
			(tx) => admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes(), span),
			withTelemetry(span, context),
		),
	);
	return new SubmissionHandle(id, this);
}
```

返回的句柄保存提交标识。`wait(context)` 允许调用者等到提交结束，`abort(context)` 则显式请求中止。一次等待被取消和被跟踪的工作被取消属于两个操作。要在重启后继续，后端必须能跨进程保留事务提交的数据，恢复时仍需可解析原任务的注册定义。[等待与中止](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/src/harness/submissions.ts#L133)

## 2. 跟踪一笔模拟转账

上游测试定义了一个只有 `prepare` 和 `apply` 两个阶段的任务。为了看清边界，下面只列出测试涉及的存储事实。`id` 表示同一项任务的标识。[任务定义与模拟服务](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/test/harness-tasks-recovery.test.ts#L50)

| 步骤 | 任务存储中的事实 | 外部模拟服务的事实 |
| --- | --- | --- |
| 受理 | 输入金额为 7，初始阶段为 `prepare` | 尚未被调用 |
| 准备完毕 | memo 记住 7，检查点记为 `{phase:"apply", key:"transfer-<id>"}` | 尚未被调用 |
| 第一次 apply | 检查点仍是 `apply` | 服务收到键，保存 `7 × 10 = 70`，调用次数 1 |
| 结果提交前关闭，重新打开 SQLite | 调度器把原来运行中的任务协调为 `pending`，保留键与 memo | 服务仍持有已有回执 |
| 恢复并完成 | `resume()` 再次进入 `apply`，提交完成结果 `{receipt:70}` | 同一键收到第二次调用，返回已有回执 |

为什么调用两次只产生一个有效结果？模拟服务的 `Map` 以传入的键查重，首次写入时计算回执，后续请求直接读取。要是每次尝试都生成新键，服务就会将第二次调用视为另一笔转账。键在执行之前写进检查点，因此重启不会改变它。

上游测试先等到服务收到第一次调用，再关闭并重开同一 SQLite 数据库。第二次 `resume()` 后，它同时断言任务结果为 70、调用次数为 2、服务端已应用的键只有 1 个。再次重开后，已完成的任务记录仍然相同。这里的服务是测试替身，保证来自服务端的查重逻辑和本地持久检查点的配合。[恢复测试与三个断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/test/harness-tasks-recovery.test.ts#L113)

## 3. 普通工具调用如何决定能不能再跑

用户自定义的转账任务明确实现了恢复逻辑。内置 `pi.tool` 任务面对的是大量语义各异的工具。它先解析和校验参数，依次运行 `beforeTool` 钩子。钩子可以阻止调用，也能返回替换后的参数。通过钩子后再校验一次，将参数整理为可持久化的 JSON，然后保存执行意图。[准备与二次校验](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/src/harness/tool.ts#L156)

源码摘录：[packages/durable/src/harness/tool.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/src/harness/tool.ts#L195)

```ts
await runtime.commit(() => {
	const intent = { phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" } as const;
	return { status: "running", checkpoint: intent };
}, context);
await run(runtime, task.input, call, tool, final, context);
```

这五行决定了故障边界。`await runtime.commit(...)` 完成后，才调用 `run(...)`。意图表明“这次动作已准备好执行，参数是这些”，具体的外部动作仍可能处在尚未发出、进行中、已完成三个时刻中的任何一个。没有声明重放策略的工具会把 `unsafe` 保存到意图中。

恢复时先读取检查点，再查看当前环境里还能否解析同名工具，同时受到重复中断次数等守卫限制。走到重放判断时，需要保存的策略和当前工具的策略同时为 `safe`。条件成立会清空上次显示的部分进度，用保存的参数再次执行。条件不成立则生成“中断且可能已部分执行”的结果。[恢复分支与中断结果](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/src/harness/tool.ts#L200)

| 第一次保存 | 重新打开时 | 普通恢复分支 |
| --- | --- | --- |
| `safe` | `safe` | 允许重跑 |
| `safe` | `unsafe` | 当前定义已收紧，报告中断 |
| `unsafe` | `safe` | 旧动作当时未声明可重放，报告中断 |
| `unsafe` | `unsafe` | 报告中断 |

前三行直接对应上游参数化测试。每组都先让工具进入执行，再关闭 Harness、更换注册策略并重开。允许重跑时断言总执行次数为 2，否则为 1，并检查工具结果的 `isError`。第四行可以由同一个布尔条件推导，也有默认不安全工具的独立用例。[策略变化的测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/test/harness-tools-recovery.test.ts#L200) · [保留部分输出的测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/test/harness-tools-recovery.test.ts#L109)

## 4. “提交结束”和“每个工具都成功”有何差别

在不安全工具的用例中，模拟模型先请求 `work`，收到中断的工具结果后，还有一条已安排的结束响应。最终 `Submission.status` 为 `done`，同一次记录中的工具结果却是 `isError: true`，并保留了第一次执行的部分文本。提交结束说明外层交互走到了结尾，业务是否完成要读具体结果。这和第 10 章固定阶段的成功判据是同一个问题，只是这里的证据能跨重启保存。[用例中的提交状态与工具结果](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/durable/test/harness-tools-recovery.test.ts#L120)

## 5. 人工确认适合保存在哪一侧

假设业务还要求人确认这笔转账。下面是基于上述边界的应用设计，数字、动作名和状态字段由应用定义。可以在调用外部服务之前保存 `{actionId, amount:7, status:"waiting"}`。界面针对这个 `actionId` 展示金额并写回决定。恢复时如果仍在等待，就重新展示同一请求。如果动作已获批且金额未变，就从保存的动作生成稳定键并执行。如果金额改了，原确认记录不能证明新的动作已获批。

这样拆分后，每一份证据都能找到所有者。用户的决定保存在应用的动作记录里，任务的继续位置在检查点里，动作是否已生效则由外部服务的查询或幂等协议回答。临时存在内存里的弹窗回调不会随进程重启自动恢复。

[继续阅读：Security：信任边界怎样在代码中落实](17-security-guardrails-and-governance.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
