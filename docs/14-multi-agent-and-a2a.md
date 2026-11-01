# Multi-Agent：多个独立循环怎样协作

本章从“一个 Agent 调查、另一个 Agent 修改”开始。多个模型调用并不天然构成多 Agent；关键是是否具有独立上下文、循环、状态和生命周期，以及任务与结果怎样跨越这些边界。

![Mox 解释本章的机制关系](../assets/multi-agent-illustrations/01-control-patterns.png)

## 1. 四种控制关系

Manager–Worker 描述管理者拆分与汇总；Agents-as-Tools 表示父 Agent 通过工具等待子任务；Handoff 转交活动工作；Delegation 则更一般地描述委托。它们可能组合，不能当成完全互斥的产品标签。

Pi 的工具执行机制允许在工具内部组织子 Agent，但具体隔离和调度由实现选择。了解一种扩展示例，也不能推断所有产品都采用相同机制。

## 2. Subagent 示例怎样启动进程

[`examples/extensions/subagent/index.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts) 通过独立 Pi 子进程运行任务，使用 JSON 输出收集事件和结果。

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/index.ts#L298)

```ts
const args: string[] = ["--mode", "json", "-p", "--no-session"];
const inheritsDispatchConfig = !agent.model;
const model = agent.model ?? dispatchDefaults.model;
if (model) args.push("--model", model);
if (inheritsDispatchConfig && dispatchDefaults.thinkingLevel) {
	args.push("--thinking", dispatchDefaults.thinkingLevel);
}
if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

let tmpPromptDir: string | null = null;
let tmpPromptPath: string | null = null;

```

父进程调用工具，工具启动子进程，子进程拥有独立模型循环；父进程解析其输出，再生成父工具结果。这是一条真正的控制与数据流，而不是简单给同一个模型换一个称呼。

## 3. 上下文隔离与契约

Agent 定义的加载在同目录 `agents.ts`。父任务需要传递目标、输入材料、允许范围和结果要求；子任务只看到被传入和自行取得的上下文。

结果最好包含结论、证据、产物位置和失败状态。让子 Agent 复制整个聊天记录既浪费输入，也容易把无关指令和假设带过去。返回一句“完成”则难以验证发生了什么。

## 4. single、parallel 与 chain

示例分别组织单任务、并行任务和串行链。并行结果需要明确回收、合并与取消；串行则要限制上一节点输出进入下一节点的方式。不同进程仍可能共享 `cwd`，因此文件冲突不会因为上下文独立而消失。

进程退出码、JSON 事件、文本和实际产物可能传达不同信息。父工具应保留错误和截断信息，而不是把所有退出都包装成成功的说明。

## 5. Durable 的任务和子会话

`pi-durable` 还提供自己的任务所有权和子任务机制，涉及持久化、恢复与取消。它与 CLI Subagent 扩展是不同实现路径。把其中一个的行为推广到另一个，会误判恢复保证和生命周期。

## 6. A2A 放在什么边界

A2A 用于跨系统 Agent 协作；MCP 用于外部能力接入。协议适配需要任务标识、认证、状态、产物和取消映射，不能仅把一个本地 Session 的方法换成 HTTP 地址就视为完整协议实现。

本章的源码事实来自 Pi 的 Subagent 示例与 Durable 任务路径；对 A2A 的讨论是架构比较，不声称 Pi 因此自动提供完整 A2A Server。

下一章进入执行环境，理解上下文独立与操作系统隔离的区别。

## 7. 父子之间真正传递的数据

Subagent 的进程输出会被解析为消息，assistant 的用量被计入结果；父工具随后对外返回可消费的信息。这使父 Agent 能将子任务视为一次工具调用，但父运行的 Context 并不会自动获得子进程全部内存。

取消也需要传播：父运行停止时，子进程或远端任务必须有明确的停止策略；等待者停止读取 stdout 不等于子进程已经退出。持久任务还要考虑子任务的所有权和重启后的归属。

多个 Agent 协作能减少单个上下文负担，也增加通信、延迟和错误传播成本。只有任务可拆、契约清楚、验证能独立完成时，这些额外边界才更容易带来收益。


[继续阅读：执行环境：工具的动作到底在哪里发生](15-sandbox-code-agent-and-computer-use.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
