# Durable：提交、任务状态与崩溃后的继续执行

设想一个工具把款项提交给外部服务，然后进程在写入成功记录之前重启。会话里缺少结果，此时重新调用一次，会不会造成两次转账？Pi 仓库用一个金额为 7、回执为 70 的模拟服务，把这个问题写成了可重复的恢复测试。我们先从这个例子理解“继续”究竟从哪里开始。

![Mox 核对已提交记录与可能发生的外部动作](../assets/mox-mechanisms/durable.png)

## 1. 一条消息和一项可恢复的工作

前面看到的 `SessionManager` 管理消息树。`pi-durable` 则提供另一条运行路径。打开 `Harness` 时，应用把存储、注册的任务和运行配置交给它。一个 `Conversation` 接纳输入，创建可追踪的 `Submission`，具体执行单元称为 `Task`。任务状态里可以保存 `checkpoint`，其中的 `phase` 指向下次进入哪个处理函数。[Harness 的打开路径](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/harness.ts) · [提交接口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts)

源码摘录：[packages/durable/src/harness/submissions.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L65)

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

返回的句柄保存提交标识。`wait(context)` 允许调用者等到提交结束，`abort(context)` 则显式请求中止。一次等待被取消和被跟踪的工作被取消属于两个操作。要在重启后继续，后端必须能跨进程保留事务提交的数据，恢复时仍需可解析原任务的注册定义。[等待与中止](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L133)

### 受理输入时有三个不同的身份

把输入暂时简化成 `{type:"input", content:"查询账单", requestId:"req-7"}`。请求标识来自调用方，用于在同一会话识别重试。受理之后返回的提交标识属于 Harness，供调用方查询状态。会话条目标识则指向对话历史上的位置。三者都可能出现在日志里，但含义不能互换。设想第一次网络响应在返回句柄前丢失，客户端手里只有请求标识，既不知道提交标识，也不知道历史条目标识。程序正是通过前者重新找到原来的提交。[请求标识的查询](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L231)

`admitSubmission` 在事务内按会话和请求标识查旧记录。同一键若已被另外一种提交类型占用，会抛出错误。同类型已存在时则返回原来的标识和受理状态。这段分支根据类型判断，未把两次输入的文字逐字比较。若调用方把两个不同意图错误地赋予同一个请求标识，就可能取回前一个意图。因此键应在**用户发起一次业务动作时**创建，保存后用于所有重试，而不应只用今天的日期或输入文字的长度代替。

当会话空闲、没有积压、收到普通输入时，程序在同一个事务里完成下面四个动作。读完代码再回看上面的名字，`entry.id` 是消息的位置，`id` 是此次提交的标识，`startRun` 将两者分别接到运行的输入列表和起始位置上。

源码摘录：[packages/durable/src/harness/submissions.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L312)

```ts
const entry = await appendInput(tx, conversationId, draft.content, draft.entry, now);
const input = { ...fields, type: "input", status: "placed", entry: entry.id } as const;
const { id } = await tx.createSubmission(input);
await startRun(tx, conversationId, live, { inputs: [id], first: entry.id });
return { id, status: "placed" };
```

如果它们是四个独立的存储操作，可能出现“消息已有位置，却永远没有任务消费它”，也可能出现“任务已经启动，却查不到哪项提交请求它”。当前代码让同一个 `tx` 接住这些变化，一起提交或一起失效。对于正在运行的会话，普通输入可以进入收件箱，此时创建状态为 `queued` 的提交，再将关联同一标识的内容放进队列。明确传入忙时拒绝的输入则抛 `ConversationBusy`。拿到句柄说明系统接纳了输入，是否已经交给执行取决于它走的是排队还是放置分支。[排队与忙时拒绝](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L258)

## 2. 跟踪一笔模拟转账

上游测试定义了一个只有 `prepare` 和 `apply` 两个阶段的任务。为了看清边界，下面只列出测试涉及的存储事实。`id` 表示同一项任务的标识。[任务定义与模拟服务](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tasks-recovery.test.ts#L50)

| 步骤 | 任务存储中的事实 | 外部模拟服务的事实 |
| --- | --- | --- |
| 受理 | 输入金额为 7，初始阶段为 `prepare` | 尚未被调用 |
| 准备完毕 | memo 记住 7，检查点记为 `{phase:"apply", key:"transfer-<id>"}` | 尚未被调用 |
| 第一次 apply | 检查点仍是 `apply` | 服务收到键，保存 `7 × 10 = 70`，调用次数 1 |
| 结果提交前关闭，重新打开 SQLite | 调度器把原来运行中的任务协调为 `pending`，保留键与 memo | 服务仍持有已有回执 |
| 恢复并完成 | `resume()` 再次进入 `apply`，提交完成结果 `{receipt:70}` | 同一键收到第二次调用，返回已有回执 |

为什么调用两次只产生一个有效结果？模拟服务的 `Map` 以传入的键查重，首次写入时计算回执，后续请求直接读取。要是每次尝试都生成新键，服务就会将第二次调用视为另一笔转账。键在执行之前写进检查点，因此重启不会改变它。

上游测试先等到服务收到第一次调用，再关闭并重开同一 SQLite 数据库。第二次 `resume()` 后，它同时断言任务结果为 70、调用次数为 2、服务端已应用的键只有 1 个。再次重开后，已完成的任务记录仍然相同。这里的服务是测试替身，保证来自服务端的查重逻辑和本地持久检查点的配合。[恢复测试与三个断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tasks-recovery.test.ts#L113)

### 移动一次中断位置，会改变哪条责任边界

上面的服务有两个状态容器。本地 SQLite 记录下一次进入哪个阶段，服务替身的映射记录哪些业务键已经应用。它们没有共同事务。把故障沿时间轴移动一小步，恢复后可以确定的事实就会不同。

| 保存或执行到哪一步 | 恢复时可以可靠推出什么 | 应由谁完成接续 |
| --- | --- | --- |
| 准备阶段还没有提交执行键 | 没有可恢复的已提交执行意图 | 任务重新完成准备 |
| 执行键已保存，尚未调用服务 | 本地允许按这个键尝试动作 | 执行阶段提交同一键 |
| 外部服务接受请求，进程尚未看到响应 | 业务动作可能已生效，本地没有回执 | 服务按键识别重复请求，或提供状态查询 |
| 进程看到了响应，保存回执前中断 | 本地仍然没有已提交的成功回执 | 继续使用同一键取回结果 |
| 回执与终态已提交 | 已有可等待的最终结果 | 新调用者读取终态 |

从本机数据库看，表格的第二、三、四行可以拥有相同的检查点。靠增加日志文字无法消除这种不确定性，因为日志本身也有“写之前”和“写之后”的窗口。如果工具没有可查询的远端标识，同时也不接受幂等键，恢复器只能诚实记录动作可能已经发生。这个结论不是存储层缺少某个布尔值，而是两个系统分别提交造成的。测试使用内存中的模拟服务跨两次打开 Harness 保留键记录；真实外部服务想提供同样语义，自己的键记录也要能跨请求保留。

## 3. 普通工具调用如何决定能不能再跑

用户自定义的转账任务明确实现了恢复逻辑。内置 `pi.tool` 任务面对的是大量语义各异的工具。它先解析和校验参数，依次运行 `beforeTool` 钩子。钩子可以阻止调用，也能返回替换后的参数。通过钩子后再校验一次，将参数整理为可持久化的 JSON，然后保存执行意图。[准备与二次校验](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/tool.ts#L156)

源码摘录：[packages/durable/src/harness/tool.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/tool.ts#L195)

```ts
await runtime.commit(() => {
	const intent = { phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" } as const;
	return { status: "running", checkpoint: intent };
}, context);
await run(runtime, task.input, call, tool, final, context);
```

这五行决定了故障边界。`await runtime.commit(...)` 完成后，才调用 `run(...)`。意图表明“这次动作已准备好执行，参数是这些”，具体的外部动作仍可能处在尚未发出、进行中、已完成三个时刻中的任何一个。没有声明重放策略的工具会把 `unsafe` 保存到意图中。

恢复时先读取检查点，再查看当前环境里还能否解析同名工具，同时受到重复中断次数等守卫限制。走到重放判断时，需要保存的策略和当前工具的策略同时为 `safe`。条件成立会清空上次显示的部分进度，用保存的参数再次执行。条件不成立则生成“中断且可能已部分执行”的结果。[恢复分支与中断结果](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/tool.ts#L200)

| 第一次保存 | 重新打开时 | 普通恢复分支 |
| --- | --- | --- |
| `safe` | `safe` | 允许重跑 |
| `safe` | `unsafe` | 当前定义已收紧，报告中断 |
| `unsafe` | `safe` | 旧动作当时未声明可重放，报告中断 |
| `unsafe` | `unsafe` | 报告中断 |

前三行直接对应上游参数化测试。每组都先让工具进入执行，再关闭 Harness、更换注册策略并重开。允许重跑时断言总执行次数为 2，否则为 1，并检查工具结果的 `isError`。第四行可以由同一个布尔条件推导，也有默认不安全工具的独立用例。[策略变化的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tools-recovery.test.ts#L200) · [保留部分输出的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tools-recovery.test.ts#L109)

### 再次询问、再次执行、重复生效是三件事

有一个特别能检验理解的实验。上游在 `beforeTool` 或真正的 `execute` 里分别递增计数器。钩子第一次执行时，把字符串 `attempt 1` 写入以任务为作用域的 memo，然后一直等到测试关闭会话。此时钩子还没正常返回，工具执行意图也没有保存。重新打开后，调度器只能再次进入准备阶段，钩子再次被调用。第二次调用用同一 memo 键提交 `attempt 2`，实际读到的仍然是第一次已经保存的值。[钩子中断的测试设计](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tools-recovery.test.ts#L277)

观察它的三个断言：钩子一共被调用两次，真正的工具只运行一次，两次观察到的决定都是 `attempt 1`。与金额例子对照，金额例子的重复发生在执行意图保存之后，所以它的服务调用次数是二。这两个实验使用了相似的“关闭、打开”操作，结果却不同，原因就在关闭点究竟位于哪个 await 的两侧。测试钩子用 memo 举例说明已经提交的决定可以保留；它没有实现用户身份、审阅界面或通用审批系统。

保存执行意图后还有一条更细的区分。工具进度所在的展示槽可以先显示“正在执行”和部分文本。用于恢复决策的依据是持久的意图以及任务检查点。可重放工具开始新的尝试时，会清理前次进度，再用存档参数执行。否则界面可能把第一次尝试的前半段拼到第二次的结果上，让一个动作看起来做了两次。对不可安全重放的工具，系统会保留能确认的部分输出和中断说明。观察 UI 文本最多能知道看到哪一步，不能据此推出最后一次存储提交的内容。[清除进度再运行](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/tool.ts#L202)

## 4. “提交结束”和“每个工具都成功”有何差别

在不安全工具的用例中，模拟模型先请求 `work`，收到中断的工具结果后，还有一条已安排的结束响应。最终 `Submission.status` 为 `done`，同一次记录中的工具结果却是 `isError: true`，并保留了第一次执行的部分文本。提交结束说明外层交互走到了结尾，业务是否完成要读具体结果。这和第 10 章固定阶段的成功判据是同一个问题，只是这里的证据能跨重启保存。[用例中的提交状态与工具结果](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-tools-recovery.test.ts#L120)

### 为什么等待要把“检查”和“登记”放在一起

考虑以下交错。调用者读取提交记录，看到它尚未完成。执行器恰好在这次读取和调用者登记监听之间提交了结果。若调用者此时才去等未来的完成通知，唯一一次通知已经过去，界面就会一直转圈。`Submissions.wait` 让读取和登记进入同一条会话执行序列。如果当前记录已到终态，直接返回已完成的 Promise，否则登记对应标识的等待者。假使会话恰在读取时开始关闭，也会先检查关闭状态再决定能否登记。[等待与登记](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L133)

提交发布时，观察器只唤醒与相应标识和已结算提交变化匹配的等待者。上游测试给持久层加了延迟，在 `observeCommits` 里记录每个完成标识，等待返回后断言观察器已经看到那次变更。这也说明“正在执行”“本地已有进度”和“可向等待者宣布完成”是不同事件。若用户在排队时要求撤回，`abort(id)` 会在事务里结算该项为未回答并删掉收件箱条目。如果输入已放进运行，则返回 `already_placed`。调用者据此知道该向运行层处理后续控制，不能把一次撤回请求直接显示为“动作已经撤销”。[结算时的观察顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-submissions.test.ts#L284) · [排队输入撤回](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/src/harness/submissions.ts#L147)

## 5. 人工确认适合保存在哪一侧

假设业务还要求人确认这笔转账。下面是基于上述边界的应用设计，数字、动作名和状态字段由应用定义。可以在调用外部服务之前保存 `{actionId, amount:7, status:"waiting"}`。界面针对这个 `actionId` 展示金额并写回决定。恢复时如果仍在等待，就重新展示同一请求。如果动作已获批且金额未变，就从保存的动作生成稳定键并执行。如果金额改了，原确认记录不能证明新的动作已获批。

这样拆分后，每一份证据都能找到所有者。用户的决定保存在应用的动作记录里，任务的继续位置在检查点里，动作是否已生效则由外部服务的查询或幂等协议回答。临时存在内存里的弹窗回调不会随进程重启自动恢复。

### 保存已知事实，也保存暂时不知道的事情

在上述人工确认设计中，最容易放错边界的是把“用户看见了弹窗”当成“用户同意了动作”。比较两次意外关闭：第一次发生在展示弹窗后、用户还没点击，此时重开仍应等待。第二次发生在用户已经确认且决定已持久保存后、执行器还没发出请求，此时应依据已保存的决定和原参数继续。只有把等待、决定、执行意图和外部回执分别记录，才能在恢复时区分这两次关闭。

再看一次相反方向的错误。假设本地磁盘在提交下一条记录时失败，但工具已经运行过。继续在内存里推进流程，然后告诉用户“已保存，可以关机”，会让显示与可恢复事实分离。上游的存储故障测试令下一次提交抛出指定的错误，直接提交者收到该错误，等待任务与等待空闲的调用者收到携带同一原因的会话失败，订阅者也看见失败关闭。这个传播规则让同一会话中的观察者知道存储已不再可信，外部服务是否生效仍要另行查询。[存储故障断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/durable/test/harness-storage-failure.test.ts#L85)

在已安装依赖的 Pi 仓库中可以单独运行这三组故障实验。第一组断言回执、调用次数和实际应用次数；第二组把中断位置移动到钩子中；第三组验证同一请求标识可以在数据库重开后重新取得原提交。它们都使用受控替身和本地存储。

```bash
cd packages/durable
node ../../node_modules/vitest/dist/cli.js run test/harness-tasks-recovery.test.ts -t 'resumes an intent/effect/outcome task'
node ../../node_modules/vitest/dist/cli.js run test/harness-tools-recovery.test.ts -t 'reruns beforeTool when interrupted before intent'
node ../../node_modules/vitest/dist/cli.js run test/harness-submissions.test.ts -t 'reacquires a submission after reopen'
```

> **先预测**　工具对外部系统的动作可能已经生效，本地却还没有保存结果。重开日志，能直接宣布没执行并重试吗？
>
> **核对推导**　不能。从本地缺少结果，只能推出尚未记录结果，不能推出外部动作未发生。要用操作标识查询外部事实，或使用该系统认可的幂等机制，再决定如何恢复。

[继续阅读：Security：信任边界怎样在代码中落实](17-security-guardrails-and-governance.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
