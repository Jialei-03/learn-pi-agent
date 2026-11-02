# 从一次模型调用到 Agent：跟踪一次文件读取

想象你刚打开一个陌生的仓库，输入「读一下 README，告诉我这个项目是做什么的」。文件在你的电脑上，模型只能接收请求里的消息。从这句话到最后的回答，中间需要有一个程序真正打开文件，还需要有一次新的模型请求，让模型读到文件内容。我们从这两次请求的差别进入 Pi。

## 1. 两次请求之间发生了什么

示例项目叫「木星笔记」。它的 README 有一个标题和一句用途说明。下面的实验可以改动这句话，观察它怎样从文件进入工具结果，再出现在最后一条消息里。图中的模型使用 Pi 的 Faux Provider，按预设规则产生回复。循环、参数校验、事件分发和结果回填由 Pi 执行。浏览器的 `read` 读取示例文本框，本地程序则调用 Pi 内置的文件工具。

[运行 README 实验](../examples/read-loop/README.md)

从成功情况开始。第一次请求里有用户的问题和工具声明，文件正文还没有进入消息。模型返回一个 `toolCall`，意思是「请调用这个工具」。此时能确定的是工具名、调用编号和参数。只有当运行时收到工具结果，文件正文才成为下一次模型请求的一部分。

![Mox 传递带有调用编号的工具请求，文件内容沿返回路径交给模型](../assets/mox-mechanisms/loop.png)

读图时沿着箭头走一圈。上半圈的载荷是动作请求，下半圈的载荷是执行结果。同一工具可以被请求两次，甚至同时被请求两次。Pi 用调用编号把每份结果关联回发起它的那一次调用。

### 把自己放在第一次请求的接收端

先做一个小小的预测。桌面上有两份项目，提问都叫「读 README，告诉我这个项目做什么」，两个模型请求里都带有同样的 read 声明。项目甲的 README 说「整理 Markdown 笔记」，项目乙的说「把照片按日期归档」。如果还没有读文件，模型能根据请求判断自己正在看甲还是乙吗？在这个例子里不能：问题里没有正文，工具声明中也没有正文。即使它碰巧答对，那也是猜中，不是读取过。

现在在网页实验中保留同一个问题，只把“示例 README”里的用途换成另一句，然后运行。先看第一轮：工具名、路径和调用编号依旧相同。再看下一次请求里最后一条消息，其文字才随文件改变。最后的回复也随之改变，因为演示模型的第二步从那里取出用途。这是我们给数据路径做的一个对照：只改变输入文件，不动问题和第一轮的模型脚本，**第一个随之改变的环节是工具读取的结果**。真正在两轮之间为模型带来新知识的，就是这条消息。

日常对话很容易掩盖这个差别。一个会讲解项目的助手可以在没有读文件时也写出流畅的说明；一个实际发起 read 的助手也可能因为路径错误没取得内容。要判断它做过什么，先找助手消息里的请求，再找编号相同的结果，最后看结果中的正文或错误。回答的语气、是否自称“我看过了”，都不能补上缺少的任一环。

## 2. 先认识负责这件事的对象

日常通过终端使用 Pi 时，输入控件把一行字交给 `AgentSession.prompt()`。Session 处理命令、资源、会话和运行中的输入，普通消息随后进入 `Agent.prompt()`。Agent 持有运行状态，并把本轮的消息、工具和配置交给循环。SDK 也能创建同一种 Session。这是两种使用入口共享核心行为的原因。[交互入口](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/interactive-mode.ts) · [SDK 装配](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts) · [Agent 入口](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts)

| 对象或函数 | 在读取 README 时做什么 | 这里保存的东西会保留多久 |
| --- | --- | --- |
| `AgentSession` | 组装工具，转交输入，订阅底层事件，协调会话记录 | 一次活动会话，可以接收多次用户输入 |
| `Agent` | 保存消息、模型、可执行工具和运行状态 | 当前 Agent 实例的生命周期 |
| `runAgentLoop` | 为这次运行准备上下文，推进模型和工具轮次，返回新增消息 | 一次运行，可以包含多轮模型请求 |
| `ModelRuntime` | 在正常 SDK 路径中调用所选模型的 Provider，处理认证和请求选项 | 可以被多个会话共享 |
| `SessionManager` | 把消息追加为带父记录标识的条目，恢复时选择活动分支 | 内存模式随实例结束，文件模式可跨进程恢复 |

装配顺序很有用。`createAgentSession()` 先取得模型运行时、资源加载器和 SessionManager，调用 `buildSessionContext()` 恢复已有消息，然后构造 Agent，最后把它们一起交给 AgentSession。于是“恢复昨天的对话”可以从会话记录重新生成消息数组，而“继续当前对话”通常已经有一个活着的 Agent。第十三章会实际创建这一整套对象。[完整 SDK 示例](../examples/read-loop/session.mjs)

网页实验把范围缩小到 `runAgentLoop`，直接传入一个工具和一个模型流函数。因此能独立看到循环的输入输出。页面没有创建磁盘会话。后面每次谈“状态”，都需要指出是哪一个对象的状态。

## 3. 把一句话送进循环

普通字符串可以由 Agent 包装成用户消息。我们的演示直接交给低层入口一条 `role: "user"` 的消息。此处选择文本形式的 `content`，时间固定为零，让两次实验易于对照。调用位置如下，摘自课程程序。[run.mjs](../examples/read-loop/run.mjs)

```js
const messages = await runAgentLoop(
  [{ role: 'user', content: question, timestamp: 0 }],
  { messages: [], tools: [tool] },
  { model: model.getModel(), convertToLlm: messages => messages },
  event => events.push(event.type),
  undefined,
  (modelInfo, context, options) => {
    requests.push(context.messages.map(messageView));
    return model.streamSimple(modelInfo, context, options);
  },
);
```

第二个参数的 `messages` 为空表示没有旧对话。`tools` 里是带可执行函数的对象。第三个参数中的转换函数在这个极小例子中直接返回消息，因为示例只产生模型层认识的角色。完整 Coding Agent 还要处理自己的消息类型。第四个参数记录事件，第五个位置可以传入取消信号，最后一个函数是观察请求边界的窗口。每调用它一次，示例就保存一份请求快照。

进入 `runAgentLoop()` 后，`declareToolChanges(context, prompts)` 会比较当前工具声明与已有声明，把必要的声明变化放入系统消息。正因为我们从空历史提供了 `read`，第一次请求出现的是 `system → user`。系统消息中可以包含工具声明，即便它的文本内容为空。读取对象时只看 `content` 会遗漏这份能力声明。[循环初始化与工具声明](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)

循环还区分两个数组。`currentContext.messages` 包括旧消息与本次新增消息，用于准备请求。`newMessages` 收集这次运行新产生的记录，用于返回给调用者。若此前已有十条历史，下一次请求可能用到那十条历史，调用结束时返回的新增列表却不会因此多十条。

### 同一个 read，模型和运行时各自拿到什么

可以把一次调用看成两张纸。第一张是目录：有一个工具名叫 read，可接收路径，按约定读取文件。目录可以发给远端，也可以存进历史。第二张是宿主的实际能力：某个 JavaScript 对象的 `execute` 会根据路径访问文件。函数连着本地环境，不能把它塞进模型的 JSON 参数里传到远端执行。两张纸用同一个工具名接起来，调用发生时才会从目录上的名字走到本地对象。

具体看 `declareToolChanges` 的比较。它从已有消息里还原已声明的工具，又对当前的可执行对象调用 `toToolDeclaration` 取得可发送的描述，两边比较后得到新增和删除集合。如果待发消息没有系统消息、同时又有变化，就创建一条内容为空但带有工具变动的系统消息，插到首条非系统消息之前。若没有变化，直接返回原来的待发消息。于是从空上下文第一次提供 read，会看到系统声明；以后每轮仍能用这个工具，并不意味着每轮都得再造一条同样的系统消息。[比较工具及插入消息的位置](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts#L342)

沿着这段代码再想一个调试场景：历史有一条曾经成功的 read，是否就证明**此刻**运行时还能读？不能。历史记录只能说明过去声明过或执行过这项能力。本次运行拿到的活动工具可能因配置或模式切换而改变。真正决定一次新请求能不能执行的，是当前工具集合能否找到这个名字，以及随后的校验与调用前处理是否放行。这个区别也是后面学规划模式、权限和恢复会话时都要用到的基础。

## 4. 第一轮回复只包含动作请求

下面保留成功实验中第一条 assistant 消息的关键字段。

```json
{
  "role": "assistant",
  "stopReason": "toolUse",
  "content": [
    {
      "type": "toolCall",
      "id": "read-1",
      "name": "read",
      "arguments": { "path": "README.md" }
    }
  ]
}
```

`content` 是数组，因为模型回复可以同时带文本与多个工具请求。`runLoop()` 从中选出 `type === "toolCall"` 的块。它先看流结束的原因，再决定是否执行这些请求。即便参数看起来是完好的 JSON，当整条回复因输出长度上限而结束时，Pi 也会把这一批请求记为失败，避免执行可能不完整的动作。[工具分派分支](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts)

成功路径接着按 `name` 在当前可执行工具中查找 `read`，准备和校验参数，经过已配置的调用前钩子，然后执行工具。网页工具到内存里找文件，本地 `createReadTool(directory)` 则把相对路径解析到目录，检查可读性，读取字节，把文本解码为 UTF-8，再按行数和字节数限制选择可返回的内容。运行时给模型的工具声明只包含描述和参数等数据，真正能够接触文件系统的是上述执行代码。[内置 read](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts)

## 5. 工具结果怎样成为第二轮输入

工具返回面向模型的 `content`，运行时把它包装成有角色的消息。下面是本地成功路径选取的字段。

```json
{
  "role": "toolResult",
  "toolCallId": "read-1",
  "toolName": "read",
  "isError": false,
  "content": [
    { "type": "text", "text": "# 木星笔记\n\n一个将 Markdown 笔记整理成索引的命令行工具。\n" }
  ]
}
```

`toolCallId` 与上一轮的 `id` 相等。循环把结果依次加入当前上下文和本次新增消息，再开始下一轮。此时模型收到的角色是 `system → user → assistant → toolResult`。其中的 assistant 消息保留了当初的请求，最后一条消息提供请求所得到的结果。

演示模型在第二次调用时取最后一条工具结果，从正文中找第一条非空、非标题的段落，形成回复。这个选择规则是课程编写的脚本，便于验证数据究竟有没有传过去。真实模型会根据提示和内容生成回答。循环接下来检查这条回复是否又请求工具，检查回合决策和待处理输入，在本例中发出 `turn_end` 与 `agent_end`。至此一次用户输入产生了两轮模型回复。[模型脚本](../examples/read-loop/run.mjs) · [继续与停止](03-agent-loop-state-machine-and-stopping.md)

### 表面只有一行输出，内部有几种不同的“完成”

看着终端逐字出现「项目说明……」时，界面收到的可能是局部内容。Pi 的 Agent 给它专门留了一个位置：`streamingMessage`。打开 `processEvents`，在 `message_start` 和 `message_update` 两个分支中找到对它的赋值；再看 `message_end`：先清空局部消息，然后把定稿的消息加入 `state.messages`。这意味着哪怕一句回复在屏幕上更新了十次，历史也不应因此多出十条助手回复。要做聊天气泡，增量适合更新同一个正在生成的气泡，定稿才适合追加到完整记录里。

源码摘录：[packages/agent/src/agent.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/agent/src/agent.ts#L585)

```ts
case "message_end":
	this._state.streamingMessage = undefined;
	this._state.messages.push(event.message);
	break;
```

工具有它自己的一对事件。开始时 Agent 把调用编号加入待处理集合，结束时移除。这个集合适合回答“哪个调用还挂在界面上”，并不储存文件正文。正文在有角色的工具结果消息中；最终项目说明在后面的助手消息中。把三者按用途分开，你就能说明为什么一个界面可以先显示「正在读取」，随后显示文件片段，再把最终回答逐段打印出来，而不必把这些瞬间混成一条历史消息。[事件怎样更新 Agent 状态](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent.ts#L575)

| 暂停在这个瞬间 | 现在可以下什么结论 | 还缺什么证据 |
| --- | --- | --- |
| 收到带 `read-1` 的助手消息 | 模型提出了对 README 的读取请求 | 尚未知道宿主是否会执行，更不知道读到了什么 |
| 收到同编号的成功工具结果 | 宿主获得了这份内容，循环有了新材料 | 还不能说模型已经看到或正确解释它 |
| 在第二次请求快照中看到结果 | 新材料已经送到模型调用边界 | 是否用对材料要检查最终回答 |
| 在末条助手消息看到项目用途 | 本实验的模型脚本选出了相应段落 | 不能由此推断真实模型每次都肯调用 read |

如果打断点只选一个地方，选传给 `runAgentLoop` 的最后一个函数。它在模型刚要接收请求的边界运行，两次暂停之间的消息差就是这堂课要找的变化。若还想确认正文究竟是谁得到的，把第二个断点放在本地工具的 `execute`。前一个断点检查模型看到了什么，后一个检查宿主真的做了什么；同一个工具名把它们关联起来，却无法用其中一个断点取代另一个。

## 6. 同样是读取失败，应该去哪里查

| 受控情形 | 首轮结束原因 | 进入工具函数 | 第二轮看到的结果 |
| --- | --- | --- | --- |
| 正常读取 | `toolUse` | 1 次 | `isError=false`，附带 README 正文 |
| 请求不存在的文件 | `toolUse` | 1 次 | `isError=true`，附带工具错误 |
| 模型输出被截断 | `length` | 0 次 | `isError=true`，附带运行时构造的失败说明 |

第二、三行最后都可能显示「读取未完成」，排查入口却不同。第二行要检查工作目录、路径和工具执行异常。第三行应查看第一轮 assistant 的结束原因，磁盘上的文件即使完全正常也不会被读到。仅统计 `tool_execution_start` 也不足以证明工具函数被执行。演示把计数放在实际的 `execute()` 入口，才能分辨这两条路径。

## 7. 在本机运行相同的循环

在课程仓库中使用 Node.js 22.19 或更新版本运行以下命令。示例项目目录包含它自己的 README，第一次运行后能直接看到两次请求的差别。[示例目录](../examples/read-loop/README.md)

```bash
cd examples/read-loop
npm ci
npm start -- success
```

```text
请求 1  system → user
请求 2  system → user → assistant → toolResult
read.execute 进入次数  1
工具结果  read-1  isError=false
项目说明：一个将 Markdown 笔记整理成索引的命令行工具。
```

`npm start -- missing` 把路径换成不存在的文件，`npm start -- length` 改变第一轮结束原因。要读实际消息可运行 `node cli.mjs success --json`。接下来的三章依次拆开这次运行的三条边界，先看模型协议，再看循环决定，最后进到工具实现。

### 不靠背词复述这次运行

关掉源码标签页，把一句「Agent 读了文件」展开成三句话：谁发出了什么请求？谁取得了当时并不在请求中的新信息？谁在什么时刻才获得回答所需的材料？在这个实验中，对应的是带编号的 assistant 工具块、执行 read 后的 toolResult、包含这两者的第二次模型调用。三个主语和次序都能从刚才的输出逐项指出，这就比背诵“感知、决策、行动”多了一层可核验的理解。

也可以反向检验：若两轮快照中的消息完全相同，却宣称模型已依据刚读到的内容作答，先找是否把结果漏加到上下文；若根本没有第二轮，但工具确实有输出，先查是什么条件结束了循环；若连工具都没进入，回到第一轮的结束原因和参数去查。下一章从其中相对独立的一段开始：模型服务发来的原始流，怎样变成这里所说的那条 assistant 消息。

> **先预测**　只把 README 的用途改成另一句。两次模型请求中，哪一次的输入会先变？
>
> **核对推导**　第二次。第一轮的问题、read 声明、调用名与路径保持不变。新正文先出现在宿主生成的 toolResult 里；把它加入下一次请求，模型才有机会看到变化。

[继续阅读：消息怎样穿过 Provider](02-model-api-and-message-protocols.md) · [源码地图](../references/source-map.md)
