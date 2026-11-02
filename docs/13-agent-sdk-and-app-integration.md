# SDK 与应用集成：从启动装配到资源释放

第一章直接调用 `runAgentLoop()`，输入、可用工具和事件记录器都在一处。现在把同一份 README 放进一个完整的 Coding Agent 会话。它会创建模型运行时，挑选活动工具，把消息记入会话树，同时把实时事件送给调用方。

![Mox 展示应用和 Pi SDK 的分工](../assets/agent-sdk-illustrations/03-create-session-assembly.png)

## 1. 创建一份可重复的 SDK 会话

课程程序使用 Pi 的 Faux Provider 演示两轮消息，在临时配置目录中运行，只开放 `read` 工具。上层应用走正式 SDK 入口，读取的是磁盘上的示例文件。仓库根目录下运行下列命令。[完整程序](../examples/read-loop/session.mjs)

```bash
cd examples/read-loop
npm ci
npm run session
```

```text
消息完成  system
消息完成  user
消息完成  assistant
消息完成  toolResult
消息完成  assistant
会话记录  system → user → assistant → toolResult → assistant
最终回答  项目说明：一个将 Markdown 笔记整理成索引的命令行工具。
```

前五行来自运行期间的 `message_end` 事件。倒数第二行是在 `await session.prompt(question)` 返回后，沿 SessionManager 的活动分支读取消息条目所得。这里同一条 assistant 回复可以在时间上被观察为事件，也可以在运行结束后作为一条会话消息被读取。两种接口承担不同职责。

## 2. 一个工厂装配哪些对象

SDK 的入口先确定 cwd，随后选择模型运行时、设置、会话管理器和资源加载器。如果没有传入 loader，工厂会创建默认 loader 并等待 `reload()`。这种等待有可见后果，注册到会话中的工具、技能和扩展要在资源发现后才能确定。[createAgentSession](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts)

本例的装配部分如下。模型脚本已经注册到 `modelRuntime`，`cwd` 指向仓库中的 fixtures，`agentDir` 指向新建的临时目录。

```js
const sessionManager = SessionManager.inMemory(cwd);
const { session } = await createAgentSession({
  cwd, agentDir, modelRuntime, model: info, sessionManager, tools: ['read'],
});
```

这里的 `tools: ['read']` 是给产品层的工具选择配置。它接收工具名称。第一章传给底层循环的 `tools: [tool]` 则已经是带 `execute()` 的对象。比较这两个参数能看出 SDK 完成了一段装配工作。CLI 经过自己的参数解析和服务准备，也会进入会话装配，然后才由交互、JSON 或 RPC 界面消费事件。[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts) · [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/main.ts)

| 装配步骤 | 读到什么 | 交给下一步什么 |
| --- | --- | --- |
| 会话恢复 | SessionManager 的活动分支 | `existingSession.messages`、已有模型及思考配置 |
| 创建 Agent | 消息、所选模型、消息转换函数、模型流函数 | 可以接收 prompt 的运行对象 |
| 创建 AgentSession | Agent、工具选择、Settings、资源、会话管理器 | 一个产品会话，能处理输入、工具钩子、事件与会话写入 |
| 应用订阅 | Session 产生的事件 | 可以独立维护的输出界面 |

SDK 构造 Agent 时传入 `tools: []` 和恢复好的消息。后续产品会话根据配置建立可用工具。因此在构造函数内部打断点看到空工具列表，和在 `prompt` 时看到 `read`，是同一装配过程的两个时刻。

## 3. 为什么替换模型还能测到真实的 Session

`ModelRuntime` 根据模型标识组织 Provider 调用。在正常模型路径里，Agent 配置的流函数整理请求选项，并返回 `modelRuntime.streamSimple(model, context, requestOptions)`。这次实验给 ModelRuntime 注册了一个本地 Provider；它接收同样的 Context 并产生同样类型的流事件。工具依然从 AgentSession 的工具集合中查找。[模型运行时](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-runtime.ts) · [课程模型脚本](../examples/read-loop/run.mjs)

第一次回复明确要求调用 `read`，第二次回复读取上一条工具结果。如果工具没进到循环或结果没有写回，脚本会发现第二次请求里缺少 `toolResult`。这样既能稳定重现 SDK 链路，又能指出这个实验的证据范围。换成真实 Provider 后的选工具能力、网络和费用，需要用相应服务另行观察。

## 4. 事件、状态和磁盘记录各自回答什么

```js
const unsubscribe = session.subscribe(event => {
  if (event.type === 'message_end') console.log('消息完成  ' + event.message.role);
});
try {
  await session.prompt(question);
  const branch = sessionManager.getBranch().filter(entry => entry.type === 'message');
  console.log(branch.map(entry => entry.message.role));
} finally {
  unsubscribe();
}
```

`subscribe()` 将回调加入监听列表，并返回一个专门移除该回调的函数。流式界面通常从 `message_update` 中选取 `text_delta` 渲染局部文本，`message_end` 再确认完整消息。若把每个 delta 都追加成历史消息，恢复时就会把一条回复重复许多次。[订阅实现](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts) · [上游最小 SDK 程序](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/01-minimal.ts)

`session.state.messages` 是活动 Agent 当前持有的消息。SessionManager 的记录则带有条目种类、父节点和标识，里面还可以有模型切换或压缩记录。示例用 `filter` 只留下 message 类型，恰好得到与这一轮消息一致的角色顺序。改用文件型 SessionManager 时，条目可写入会话文件。恢复时沿选中分支进行投影，详见[第六章](06-session-memory-retrieval-and-compaction.md)。

## 5. 在正确的时刻释放什么

界面临时折叠只需要解除自己的订阅。用户点击“停止”时应调用 `await session.abort()`。它向低层 Agent 发出中断请求，处理重试、压缩等相关工作，并等待会话空闲。已经由工具完成的写文件操作仍然存在。关闭整个会话时调用 `session.dispose()`，释放会话所管理的连接和监听。示例将它放在外层 `finally`，初始化和关闭临时目录再放到更外层。[AgentSession 生命周期](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts)

再看一个容易在应用中出现的错误。前端点击“新会话”后，运行时将活动 Session 从 A 替换成 B，原来的回调仍然订阅着 A。即使 B 正在流式输出，它也收不到。上游的 Session Runtime 示例在替换后用新的 Session 重新绑定订阅，并清理旧回调。这样 UI 显示的对象与应用提交输入的对象重新一致。[会话替换示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/13-session-runtime.ts)

[继续阅读：多个独立循环怎样协作](14-multi-agent-and-a2a.md) · [源码地图](../references/source-map.md)
