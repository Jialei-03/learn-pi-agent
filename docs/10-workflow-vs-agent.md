# Workflow 与 Agent：下一步由谁决定

发布说明任务常有收集提交、分析变更、撰写和检查几个阶段。它们可以由代码预设，也可以在模型得到中间结果后动态决定。本章把控制权放回 Pi SDK 的调用边界。

![Mox 解释本章的机制关系](../assets/workflow-agent-illustrations/05-routing-boundary.png)

## 1. 控制流与生成内容

Workflow（工作流）的步骤和转移由应用代码定义；Agent 则在宿主规则内依据模型响应选择动作。工作流可以调用一个 Agent 完成开放式调查，因此二者经常组合。

固定流程也可以包含模型调用，其生成文本仍有随机性。“控制结构确定”不等于“输出逐字相同”。同样，Agent 的工具和停止条件由程序限制，并不拥有无限自由。

## 2. 一次 `session.prompt()` 是什么边界

官方 SDK 最小示例创建 Session、订阅事件、等待 `prompt` 并清理资源：

源码摘录：[packages/coding-agent/examples/sdk/01-minimal.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/01-minimal.ts#L10)

```ts
const { session } = await createAgentSession();

try {
	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt("What files are in the current directory?");
	session.state.messages.forEach((msg) => {
		console.log(msg);
	});
	console.log();
} finally {
	session.dispose();
}
```

这一次 prompt 内部可以有多轮模型和工具交互。应用外层的一步，不等于内部只有一次模型调用。

## 3. 怎样放进业务流程

下面是教学伪代码，表示应用自己的编排，不是 Pi 内置 API：

```text
收集已确认的提交记录
  → 调用 Pi 分析代码与测试
  → 应用检查是否存在完整的分析结果
  → 调用 Pi 起草发布说明
  → 人工或程序批准
  → 应用执行发布
```

在每次进入下一步前，需要一个明确的输入输出契约。模型说“完成了”不是发布成功证据；测试输出、产物、错误和中止状态也要进入判断。

## 4. Run 与 Session

Session 跨多次交互保留会话记录；一次 Run 表示从输入到这次运行停止的过程。多个节点共享一个 Session 会带来上下文连续性，也可能混入无关状态。独立节点可以使用独立 Session，并通过显式结果传递必要信息。

独立 Session 不自动隔离磁盘：如果两个节点都指向同一工作目录，仍然可能并发修改同一文件。对象隔离和执行环境隔离是两个维度。

## 5. 失败、取消与批准

等待模型返回的应用代码应将用户取消传给 `session.abort()`，并在生命周期结束时 `dispose()`。需要人工批准的动作应该停在具体执行前，保存要执行的实际动作，批准后重新验证上下文。

工作流外层拥有业务事务和副作用控制；Pi 可以负责调查、编辑和工具操作，但产品仍须决定什么时候认为业务阶段成功。

## 6. 从这里看下一章

当每个节点的职责、输入输出和取消边界清楚以后，才适合讨论串行、路由、并行和评审循环。下一章用这些共同契约分析组合方式。

## 7. “等待结束”之后要检查什么

`await session.prompt(...)` 表示宿主这次调用已经结束等待，而业务仍应检查最终消息与产物。错误、中止或输出截断不能仅凭最后一段文本中出现“完成”就转成成功。

例如代码修复节点的契约可以包含修改文件、测试命令、退出状态和生成的报告。外层代码从可信执行结果构造这些字段，再决定是否进入发布阶段。模型可以帮助解释失败，却不应通过改写总结把失败测试变成成功记录。

这也影响重试：重新请求调查节点通常可接受，重新执行发布节点则可能重复产生副作用。控制流的“再走一遍”需要与动作的幂等性同时设计。


[继续阅读：Workflow Patterns：把多个 Agent 节点连接起来](11-workflow-patterns.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
