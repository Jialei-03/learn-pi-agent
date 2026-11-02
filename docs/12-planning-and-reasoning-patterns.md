# Planning 与 Reasoning：从推理配置到可执行计划

同样是“先计划再动手”，有人调高模型的推理级别，有人写一段提示，还有人禁用写文件工具。三种做法改变的是三个不同的数据。跟随 Pi 的 Plan Mode 扩展示例，我们可以看到一份编号清单怎样从模型文本变成应用状态，以及“完成第 1 步”究竟证明了什么。

![Mox 解释本章的机制关系](../assets/planning-reasoning-illustrations/00-four-layers.png)

## 1. 区分请求参数和计划状态

`Agent.createLoopConfig` 会从当前状态读取 `model` 与 `thinkingLevel`。当级别为 `off`，传出的 `reasoning` 是 `undefined`，否则传入相应级别，由模型层处理具体请求。这个字段的寿命是一轮请求配置。一次响应可能包含 thinking 内容块，实际用量又由响应的 usage 记录。要制订应用能恢复的计划，还需要另一个位置保存步骤及完成情况。[循环配置](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/agent/src/agent.ts#L476)

Plan Mode 是一个需要加载的扩展示例。它维护 `planModeEnabled`、`executionMode`、`todoItems` 和进入规划之前的活动工具列表。整个模式由事件驱动，可以沿三次用户操作推演。[示例入口与状态定义](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L47)

## 2. 第一次输入 /plan

进入规划时，扩展保存当时的活动工具名，再调用 `setActiveTools` 更新可用集合。测试的初始集合是 `read, bash, edit, write, echo_tool`。进入规划后变为 `read, bash, echo_tool, grep, find, ls, questionnaire`。再输一次 `/plan`，原来的五项按原顺序恢复。保留 `echo_tool` 说明自定义工具不会因为进入这个模式一律消失。[工具变换的测试输入与断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/plan-mode-extension.test.ts#L106)

源码摘录：[packages/coding-agent/examples/extensions/plan-mode/index.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L104)

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

规划阶段仍有 `bash`，于是示例还监听 `tool_call`。若处于规划且调用名为 `bash`，它将 `event.input.command` 送入 `isSafeCommand`。该函数要求命中允许模式，并且不命中危险模式。测试里 `git status` 允许，`git commit` 和 `echo hello > file.txt` 被挡下。在这个具体扩展中，工具名可见、某次命令获准和文件系统权限是三个层次。前面保留的自定义工具也需要按它自身的能力判断。[钩子检查](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L164) · [命令过滤与用例](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/plan-mode-utils.test.ts#L11)

## 3. 一段助手文本怎样变成两项任务

`before_agent_start` 给用户轮次加上规划指令，要求在 `Plan:` 标题下输出编号步骤。假设助手返回如下文本。数据用于演示解析过程。

```text
Plan:
1. Inspect the argument parser
2. Add an empty-name regression test
```

当 `agent_end` 到达且当前是有界面的规划模式，扩展找到最后的助手消息并提取文本。`extractTodoItems` 先寻找标题，然后扫描编号行，过滤太短或形状不符合的项目，用加入列表的顺序重新编号，设为未完成。清理步骤文字时还会去掉开头的 Add 等动词并将首字母大写，所以第二项的展示文字以 An 开头。以上文本因此形成下面的数据。[解析函数](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/utils.ts#L129)

```json
[
  {"step":1,"text":"Inspect the argument parser","completed":false},
  {"step":2,"text":"An empty-name regression test","completed":false}
]
```

如果助手只是介绍了一段代码，没有标题和有效步骤，提取结果为空。在没有既有待办项的情形下，扩展直接返回。测试特意检查此时既没有弹出选择框，也没有发起后续消息。这个分支避免把普通解释误读成需要批准的计划。[无计划的测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/plan-mode-extension.test.ts#L130)

## 4. 选择执行后是谁启动下一轮

| 用户选择或事件 | 内部变化 | 可观察的结果 |
| --- | --- | --- |
| 留在规划模式 | 保持规划状态和受限工具 | 用户可以继续调查 |
| 要求细化，输入非空意见 | 将意见作为 `followUp` 用户消息入队 | 下一轮能看到补充要求 |
| 选择执行 | 关闭规划，打开执行状态，恢复原工具并持久化 | 一条 `plan-mode-execute` 自定义消息以 `triggerTurn: true` 加入后续轮次 |
| 后续 `turn_end` 出现 `[DONE:1]` | 按编号将第一项的 `completed` 置为 true | 界面更新并保存 |
| `agent_end` 时所有项均已完成 | 发送完成提示，清空列表，退出执行状态 | 下次恢复不再显示这份已清空的计划 |

这里的 `followUp` 是第 3 章外层队列的实际用途。测试模拟“执行计划”的选择，检查原工具集合已还原，并断言后续自定义消息带有触发新轮次的标记。细化分支则保留用户身份，将实际意见作为用户消息交给下一轮。[状态转换和后续消息](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L254) · [执行和细化的断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/plan-mode-extension.test.ts#L140)

## 5. 标记为什么可能领先于实际结果

`markCompletedSteps` 的输入只有文本和待办项。它从文本提取 `[DONE:n]`，再寻找编号匹配的条目。假设模型在没跑测试时写下 `[DONE:2]`，这段函数仍能把对应条目标成已完成。换成“成功通过回归测试”这样的业务条件，应让程序读取真实测试退出状态，把模型自报与产物证据分开。[标记匹配逻辑](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/utils.ts#L152)

扩展用 `pi.appendEntry("plan-mode", ...)` 存下两个模式标记、待办列表和旧工具集合。重新打开会话，`session_start` 从记录恢复这些值。由此可以分别找到四个问题的答案：调高推理级别要看请求配置，约束动作要找工具与钩子，恢复计划要读保存的扩展状态，判断工作是否完成则要看实际产物。[状态的保存](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L116) · [恢复逻辑](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/examples/extensions/plan-mode/index.ts#L344)

[继续阅读：SDK 与应用集成：从启动装配到资源释放](13-agent-sdk-and-app-integration.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
