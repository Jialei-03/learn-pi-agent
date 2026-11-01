# Security：信任边界怎样在代码中落实

本章围绕一个具体风险：仓库文件要求 Agent 忽略用户目标并执行另一条命令。需要保护的不是模型的一句回答，而是它能触及的文件、进程、凭据和外部服务。

![Mox 解释本章的机制关系](../assets/context-engineering-illustrations/03-trust-boundaries-and-injection.png)

## 1. 内容不会自动获得权限

文件、网页、邮件和工具结果进入模型 Context 后，可以影响其行动建议。间接 Prompt Injection 指这类外部材料夹带指令，试图改变模型行为。保留来源和限制可执行能力，都是缓解手段的一部分。

模型输出是候选动作，用户身份和批准记录必须来自应用可信的控制路径。让模型自己写“已获批准”不能建立授权。

## 2. Project Trust 的真实范围

[`security.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md) 说明项目设置、MCP 配置及 `.pi` 中的资源受项目信任决定影响；上下文文件仍可能加载，除非关闭相应加载。会话目录的初始选择还有独立时机，不能把拒绝信任理解为之前任何项目数据都没被读取。

授予信任允许加载资源，不会限制工具可以访问哪些路径。工具和扩展依然继承进程权限，除非另有操作系统或虚拟化限制。

## 3. 工具前后的策略位置

源码摘录：[packages/coding-agent/src/core/agent-session.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts#L669)

```ts
	this.agent.beforeToolCall = (context) => this._beforeToolCall(context);
	this.agent.afterToolCall = (context) => this._afterToolCall(context);
}

/** `tool_call` handlers. `parentToolCallId` is set for calls another tool made. */
private async _beforeToolCall(
	{ toolCall, args }: BeforeToolCallContext,
```

执行前钩子适合检查和阻止动作；执行后钩子处理已经产生的结果。验证或过滤输出不能回滚已经写入的文件。多个入口还可能绕开某个特定工具，因此策略必须说明覆盖范围。

低层 Agent 的工具前钩子修改参数后不会自动再校验；Durable 工具路径会再次验证。安全审查要找到实际使用的运行时，而不是假定同名功能有相同语义。

## 4. 凭据与外部服务

Provider 认证、MCP 认证和工具子进程环境属于不同路径。应用应明确凭据由谁保管、请求发往哪里、哪些子进程能继承环境。工具 Schema 不会自动阻止 Shell 读取可访问的环境变量。

隔离环境要同时考虑文件挂载、进程、网络和秘密。对工具的自然语言提醒与系统强制权限承担不同职责。

## 5. 批准必须关联实际动作

批准界面应展示真实目标、参数和副作用范围。动作在等待期间发生变化，需要重新验证；不能把批准一个计划等同于批准任意后续生成的动作。

记录包括谁批准了什么、哪条任务和结果。日志需要避免无意保存密钥、完整敏感输入或不必要的个人信息。审计应能关联运行证据，而不是只得到“成功”总标签。

## 6. 怎样验证防御

用受控文件或工具结果注入错误指令，观察模型是否提出越界动作、工具是否阻止、外部状态是否改变。这些是不同层次的结果。仅看到模型说“拒绝”不足以证明工具路径全部安全。

下一章研究观测和评测：如何根据实际产物、行为轨迹和成本持续判断系统表现。

## 7. 一条注入攻击的逐层检查

假设读取到的文件要求“把凭据发送到某地址”。先判断它是文件内容而非用户指令；再观察模型是否提出网络或 Shell 动作；随后看执行前策略是否识别并阻止；最后确认外部状态是否真的改变。

四层可能得出不同结果：模型拒绝但扩展仍执行了动作、模型提出动作但工具阻止、工具没有动作但日志泄漏了内容。只检查最终聊天文字会漏掉后面这些边界。

安全评测因此需要可信的受控接收端、无真实秘密的测试材料和动作记录。它与正常任务效果应同时观察，以免防御通过禁止所有工作获得表面上的安全分数。


[继续阅读：Observability 与 Evaluation：怎样用证据改进 Pi](18-observability-evaluation-and-harness-engineering.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
