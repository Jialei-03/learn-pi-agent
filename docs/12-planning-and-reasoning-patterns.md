# Planning 与 Reasoning：从推理配置到可执行计划

同样是“先计划再动手”，有人调高模型的推理级别，有人写一段提示，还有人禁用写文件工具。三种做法改变的是三个不同的数据。跟随 Pi 的 Plan Mode 扩展示例，我们可以看到一份编号清单怎样从模型文本变成应用状态，以及“完成第 1 步”究竟证明了什么。

![Mox 解释本章的机制关系](../assets/planning-reasoning-illustrations/00-four-layers.png)

## 1. 区分请求参数和计划状态

`Agent.createLoopConfig` 会从当前状态读取 `model` 与 `thinkingLevel`。当级别为 `off`，传出的 `reasoning` 是 `undefined`，否则传入相应级别，由模型层处理具体请求。这个字段的寿命是一轮请求配置。一次响应可能包含 thinking 内容块，实际用量又由响应的 usage 记录。要制订应用能恢复的计划，还需要另一个位置保存步骤及完成情况。[循环配置](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L476)

Plan Mode 是一个需要加载的扩展示例。它维护 `planModeEnabled`、`executionMode`、`todoItems` 和进入规划之前的活动工具列表。整个模式由事件驱动，可以沿三次用户操作推演。[示例入口与状态定义](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L47)

## 2. 第一次输入 /plan

进入规划时，扩展保存当时的活动工具名，再调用 `setActiveTools` 更新可用集合。测试的初始集合是 `read, bash, edit, write, echo_tool`。进入规划后变为 `read, bash, echo_tool, grep, find, ls, questionnaire`。再输一次 `/plan`，原来的五项按原顺序恢复。保留 `echo_tool` 说明自定义工具不会因为进入这个模式一律消失。[工具变换的测试输入与断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/plan-mode-extension.test.ts#L106)

源码摘录：[packages/coding-agent/examples/extensions/plan-mode/index.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L104)

```ts
function enablePlanModeTools(): void {
	if (toolsBeforePlanMode === undefined) {
		toolsBeforePlanMode = pi.getActiveTools();
	}
	pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
}

function restoreNormalModeTools(): void {
	pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
	toolsBeforePlanMode = undefined;
}
```

这个实现先保存实际配置，因此离开时能还原用户原有的自定义集合。`toolsBeforePlanMode` 为 `undefined` 时才记录快照，可避免再次启用时把已经过滤的列表覆盖到原始快照上。

规划阶段仍有 `bash`，于是示例还监听 `tool_call`。若处于规划且调用名为 `bash`，它将 `event.input.command` 送入 `isSafeCommand`。该函数要求命中允许模式，并且不命中危险模式。测试里 `git status` 允许，`git commit` 和 `echo hello > file.txt` 被挡下。在这个具体扩展中，工具名可见、某次命令获准和文件系统权限是三个层次。前面保留的自定义工具也需要按它自身的能力判断。[钩子检查](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L164) · [命令过滤与用例](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/plan-mode-utils.test.ts#L11)

### 进入规划改变了三处状态，发生在三个不同时刻

用同一条请求来推演：「调查 CLI 为什么会接受空文件名，先别修改」。第一处变化发生在你输入 `/plan` 时。命令 handler 改的是扩展闭包里的布尔值、待办列表和活动工具名。它不需要这时就请求模型。布尔值让后续事件的处理器知道现在是哪种模式，工具名决定会话接下来向模型声明哪些能力。换言之，即使模型一句话还没说，宿主准备执行的规则也已经变了。

第二处变化发生在用户提交调查要求之后、这次 Agent 开始之前。扩展处理 `before_agent_start`，检查发起消息的种类是 user，然后返回含 `[PLAN MODE ACTIVE]` 的自定义消息。消息标记 `display: false`，不作为普通聊天气泡展示，却会影响模型看到的上下文。若后台通知发起的是 custom 类型，这里直接返回，不再附上一份相同指令。只检查屏幕上有无「请先规划」这句话，无法判断本次请求是不是带了规划信息。[注入规划上下文的位置](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts#L198)

第三处变化要等工具真的被请求才会发生。例如模型提出执行 `git status`，此时 `tool_call` 处理器才检查命令字符串。调高推理配置不能替代这三步中的任何一步：它不能改扩展里的标志，不能让工具从列表中消失，也不能在宿主上拒绝某条不允许的命令。看一个 Agent 产品有没有实现规划模式，比起找设置名称，更可靠的是沿这三个时点寻找谁写状态、谁读状态，以及谁能制止动作。

还有一个反向过程。选择开始执行后，现在需要它改代码，旧的「只读调查」指令可能仍在会话历史里。`context` 处理器在不处于规划模式时会过滤 `customType === "plan-mode-context"` 的消息，也会过滤符合旧标记的用户消息。这里返回的是准备本次上下文的消息列表，并没有从历史文件里删除这些记录。于是打开会话看得见昨天的计划，而当前模型请求不再继续受那段旧指令约束，这两件事可以同时成立。[清除过期规划上下文](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts#L176)

## 3. 一段助手文本怎样变成两项任务

`before_agent_start` 给用户轮次加上规划指令，要求在 `Plan:` 标题下输出编号步骤。假设助手返回如下文本。数据用于演示解析过程。

```text
Plan:
1. Inspect the argument parser
2. Add an empty-name regression test
```

当 `agent_end` 到达且当前是有界面的规划模式，扩展找到最后的助手消息并提取文本。`extractTodoItems` 先寻找标题，然后扫描编号行，过滤太短或形状不符合的项目，用加入列表的顺序重新编号，设为未完成。清理步骤文字时还会去掉开头的 Add 等动词并将首字母大写，所以第二项的展示文字以 An 开头。以上文本因此形成下面的数据。[解析函数](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/utils.ts#L129)

```json
[
  {"step":1,"text":"Inspect the argument parser","completed":false},
  {"step":2,"text":"An empty-name regression test","completed":false}
]
```

如果助手只是介绍了一段代码，没有标题和有效步骤，提取结果为空。在没有既有待办项的情形下，扩展直接返回。测试特意检查此时既没有弹出选择框，也没有发起后续消息。这个分支避免把普通解释误读成需要批准的计划。[无计划的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/plan-mode-extension.test.ts#L130)

### 真实解析实验：第十七项为什么会变成第二项

运行下面的程序。它从 Pi 包内加载规划扩展自己的解析工具，没有重写正则，也不会执行示例里的 shell 命令。[完整实验](../examples/read-loop/plan-items.mjs)

```bash
cd examples/read-loop
npm ci
node plan-items.mjs
```

用这份输入开始。特意跳号并插入一个很短的条目，是为了区分「抄回模型写的编号」和「给解析成功的条目重新编号」两种实现。

```text
Plan:
8. Read the parser source
9. OK
17) Verify the regression test
```

先定位标题。函数认的是英文 `Plan:`，还容许大小写和特定 Markdown 加粗形式；如果你只把标题换成中文「计划：」，输入在人看来同样清楚，返回数组却为空。接下来，从标题后截取剩余文本，按编号开头的行匹配；句点和右括号都被接受。第二行确实有编号，但描述 `OK` 太短，后面的长度判断把它跳过；这说明“能被正则匹配”和“最终成为一项”仍是两件事。

接着清理文字。第一项移去开头的 `Read the`，第二个保留下来的条目移去 `Verify the`，再把首字母转为大写。写入数组时，编号取「已接受项的数量加一」，所以两个对象的编号是 1 和 2，显示文字是 `Parser source`、`Regression test`。原来的 8 与 17 不再是追踪完成状态的键。假如后面的助手消息照着原文标记 `[DONE:17]`，列表不会勾选第二项。扩展会把实际解析后的编号重新交给执行者，正是为了让后续消息引用这些键。

这个解析器还没有「遇到下一节标题就停止」的规则。它从计划标题后一直扫描到文本末尾，后续附录中的编号行只要满足条件也可能入选；而很长的描述在清理时会被截短，没法当作完整的验收标准。因此窗口里的一行短标签适合让人看清正在做哪项；保留原始助手消息、测试步骤和长说明仍然有用。要支持程序严格执行依赖图，则应另外定义依赖字段和验证规则，不能从这些短标签里凭空恢复。

## 4. 选择执行后是谁启动下一轮

| 用户选择或事件 | 内部变化 | 可观察的结果 |
| --- | --- | --- |
| 留在规划模式 | 保持规划状态和受限工具 | 用户可以继续调查 |
| 要求细化，输入非空意见 | 将意见作为 `followUp` 用户消息入队 | 下一轮能看到补充要求 |
| 选择执行 | 关闭规划，打开执行状态，恢复原工具并持久化 | 一条 `plan-mode-execute` 自定义消息以 `triggerTurn: true` 加入后续轮次 |
| 后续 `turn_end` 出现 `[DONE:1]` | 按编号将第一项的 `completed` 置为 true | 界面更新并保存 |
| `agent_end` 时所有项均已完成 | 发送完成提示，清空列表，退出执行状态 | 下次恢复不再显示这份已清空的计划 |

这里的 `followUp` 是第 3 章外层队列的实际用途。测试模拟“执行计划”的选择，检查原工具集合已还原，并断言后续自定义消息带有触发新轮次的标记。细化分支则保留用户身份，将实际意见作为用户消息交给下一轮。[状态转换和后续消息](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L254) · [执行和细化的断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/plan-mode-extension.test.ts#L140)

### 两个结束事件，为什么不能只留一个

`turn_end` 在一次模型回复及这一回合相应工具处理结束后出现；`agent_end` 则是整次运行结束。一次输入可能引发多次请求，若只监听后者，就容易错过中途助手已经报告的步骤。规划示例在执行模式下用 `turn_end` 读取本回合助手的文本块，更新当前清单并持久化，再在 `agent_end` 检查是不是所有条目都已完成。前者记局部变化，后者决定整份计划是继续等待还是收尾。中间工具返回的文本即使包含同样的标记，也不是这个处理器要匹配的助手消息。

选择执行时，扩展还发了两条不同的后续消息。第一条带有整理好的「Plan Steps」清单，适合人回看。第二条把剩余步骤、首项和标记约定整理成执行输入，除了指定 follow-up，还明确设置 `triggerTurn: true`。如果只形成了一条可显示的清单，界面看起来已经准备好了，并不能据此推出新的模型请求一定会启动。反过来，在没有交互界面的宿主里，示例的规划分支遇到 `!ctx.hasUI` 会提前返回。这时就算模型生成了规范的编号计划，也不能指望自动弹出的确认框替 SDK 调用者做选项决策。

## 5. 标记为什么可能领先于实际结果

`markCompletedSteps` 的输入只有文本和待办项。它从文本提取 `[DONE:n]`，再寻找编号匹配的条目。假设模型在没跑测试时写下 `[DONE:2]`，这段函数仍能把对应条目标成已完成。换成“成功通过回归测试”这样的业务条件，应让程序读取真实测试退出状态，把模型自报与产物证据分开。[标记匹配逻辑](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/utils.ts#L152)

扩展用 `pi.appendEntry("plan-mode", ...)` 存下两个模式标记、待办列表和旧工具集合。重新打开会话，`session_start` 从记录恢复这些值。由此可以分别找到四个问题的答案：调高推理级别要看请求配置，约束动作要找工具与钩子，恢复计划要读保存的扩展状态，判断工作是否完成则要看实际产物。[状态的保存](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L116) · [恢复逻辑](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/index.ts#L344)

### 重复报告、过期报告和真正完成各是什么

继续看实验的第二段。面对两个有效待办，把文本 `[DONE:2] [DONE:2] [DONE:99]` 传入真实 `markCompletedSteps`。程序输出「识别标记：3；完成的项：2」，这里的“2”是第二项的**编号**，勾选的总数只有一。函数先从字符串提取三个数字，再逐项查找对象；重复赋值不会再多一个已完成项，不存在的第九十九项没有对象可改。它的返回值却是识别出的标记数。因此一个使用者若把返回值累加到完成计数，就会凭空得到三步进展。要显示进度，应当从清单中数 `completed` 为真的项。

从函数的入参也可以看出它有什么能力：一个字符串、一个可修改的数组，没有会话管理器、工具执行器，也没有测试报告。循环里的 `find` 只决定哪一个对象会被写入；最后的 `return` 数的是另一个集合。这里无需推测模型的意图，只把输入代入代码，就能把界面上的数字算出来。

源码摘录：[packages/coding-agent/examples/extensions/plan-mode/utils.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/plan-mode/utils.ts#L161)

```ts
export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}
```

这个例子也是一种读源码的方法。先问函数有没有机会知道某件事，再讨论它会不会做判断。一个连进程状态都没有拿到的函数，不可能替人验证进程退出码；一个只接收当轮文本的解析器，也不可能自动理解所有历史计划。这样读，才不会把产品界面的直观印象当作实现已提供的保证。

现在假设上周也做过另一份两项计划，旧助手回复里同样有 `[DONE:2]`。刚恢复今天的新计划，为什么不会随便把上周的“2”算给今天？看 `session_start` 的恢复路径：先从自定义记录中取最近的规划状态，取回清单、模式和旧工具集合；若正处于执行，它还从后向前找最近一条 `plan-mode-execute`，只重新扫描这条标记**之后**的助手消息。这个位置给同样的数字划出了有效时间范围。若没有找到标记，索引的初始值使扫描从开头开始。恢复行为依赖什么记录还存在，是可以从这里直接说明的。[状态恢复与重扫边界](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts#L344)

这也指出了示例的能力边界。完成勾选证明助手按约定发出了标签、扩展认出了编号；恢复勾选证明这个状态可以从会话记录重建。两件事加起来也没有读过一次测试退出码。若某个步骤是「空文件名返回友好错误」，可靠的验收材料应是一条真实命令、返回码和对应输出。到这里再看那枚绿色勾，就知道它到底依据哪份证据、还欠哪份证据。

> **先预测**　只有两项待办，助手报告 [DONE:2] [DONE:2] [DONE:99]。究竟完成了几项？
>
> **核对推导**　列表中只有第二项被标成完成，合计一项。函数识别到了三个标记，重复赋值不会变成第二份完成记录，查不到的第 99 项不会被创建。这些标记本身也没有验证测试是否通过。

[继续阅读：SDK 与应用集成：从启动装配到资源释放](13-agent-sdk-and-app-integration.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
