# Multi-Agent：多个独立循环怎样协作

在第 11 章，scout 先调查，planner 再根据调查结果制订计划。现在把其中一次委托放大。父 Agent 调用了一次工具，子 Agent 却可能经历好几轮工具调用。两个循环之间究竟共享了哪些数据？Pi 的 Subagent 扩展示例给出了从工具参数一直到操作系统进程的实现。

![Mox 解释本章的机制关系](../assets/multi-agent-illustrations/01-control-patterns.png)

## 1. 一个名字怎样选中执行配置

假设父模型发出以下调用。这里的参数是教学示例。默认的 `agentScope` 为 `user`，所以例子假定用户已经装好了 `scout` 定义以及该扩展。[扩展示例与安装方式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/README.md)

```json
{"agent":"scout","task":"定位处理空文件名的 CLI 代码，返回文件和函数名"}
```

扩展首先统计 single、parallel、chain 有几种模式被选中，只接受一种。然后根据作用域发现 Agent 定义。Markdown 文件的头部给出名字、描述、允许工具及可选模型，正文成为系统提示补充。找不到名字时会产生失败结果，附上可选的名字，不会启动子进程。[配置发现与结构](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/agents.ts) · [参数判定](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L481)

模型回退有一个小细节。定义里显式配置了模型，就用它。没有配置则继承父会话的模型，只有这种继承情形才会一并传父级 thinking 设置。这样子角色选择了不同模型时，不会自动收到另一个模型的推理设置。[启动参数构造](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L298)

### 同名 scout 要看作用域

角色文件先变成 `AgentConfig`：正文进入 `systemPrompt`，frontmatter 提供名字、描述及可选的工具、模型，旁边还有揭示来源的 `source` 和 `filePath`。`discoverAgents` 从工作目录向上寻找最近一个项目角色目录，另外读取用户角色目录。对于 `user` 作用域只采用用户记录；`project` 只采用项目记录；`both` 则先把用户角色放入按名索引，再用项目角色执行 `Map.set`。因此若两边都定义 `scout`，在 `both` 情形中，项目的同名定义会覆盖用户定义。这与第 8 章 Skill 在同名时保留首个胜者的实现不同，单从名字无法推出优先规则。[角色来源合并](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/agents.ts#L116)

假设用户角色使用简短的只读提示，项目同名角色额外配置了某个模型。父侧只把 `agentScope` 从 `user` 改成 `both`，工具名字和 task 看起来完全一样，最终的角色正文、模型参数和信任检查却都可能改变。判断子进程实际获得了哪套指令，要回到 `currentResult.agentSource` 和获选角色的 `filePath`。只查看父模型发出的一条工具调用，无法区分两个同名角色。

## 2. 跨进程的输入是什么

`runSingleAgent` 使用 `--mode json -p --no-session` 作为基本参数，按需追加模型、推理级别及工具名称。如果角色有系统提示正文，父侧把它写入临时文件，以 `--append-system-prompt` 指向该文件。最后一个参数是以 `Task: ` 开头的任务字符串。下面是简化后的参数形状，省略了模型和工具的具体值。

```text
参数数组
  --mode  json  -p  --no-session
  --tools  <角色允许的工具列表>
  --append-system-prompt  <临时文件路径>
  Task: 定位处理空文件名的 CLI 代码，返回文件和函数名
```

`spawn` 以 `shell: false` 启动 Pi，将任务作为一个参数传递。标准输入设为忽略，stdout、stderr 各接一条管道。工作目录默认使用父侧目录，也可以单独传入。子进程没有继承父 Session 的消息数组，但它仍可能读到同一目录里的文件和在该进程环境下可用的资源。`--no-session` 控制此次会话的持久化，也是另一个独立维度。[进程启动与输入通道](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L330)

### 父进程运行什么，子进程便从哪里起步

`getPiInvocation` 会检查运行时和当前入口脚本。如果 Pi 是由普通 Node 脚本启动，它可以通过 `process.execPath` 再运行同一脚本，额外带上 JSON 模式和此次任务；某些打包情形则直接运行程序，或回退到可用的 `pi` 命令。它并没有把父 Agent 的 JavaScript 对象序列化给子进程。子侧从入口重新解析参数，创建自己的运行对象。相同 cwd 只让相对路径指向同一个地方，并不会让两个对象的消息数组共享内存。[选择子程序入口](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L247)

这也说明该例中的权限边界。`shell:false` 表示 task 作为独立参数被交给启动程序，其中的空格和 shell 元字符不由父侧 shell 再解释；`--no-session` 表示子任务运行时选择了相应会话模式；角色的 `tools` 限定可用工具。它们分别管参数传递、会话保存与能力暴露。比如子任务一旦拥有可以修改共享目录的工具，它写入的文件依然可能被父任务见到。要让 planner 利用 scout 的结果，可以通过交接文本传文件位置，或显式约定共享文件和格式；仅靠「启动的是同一份程序」无法传递那段上下文。

## 3. 为什么要留一个未处理的缓冲区

JSON 模式的输出以换行分隔记录。操作系统交来的一个数据块可能只含半行，也可能有多行。父侧用这个处理器把数据块拼回记录。

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L388)

```ts
proc.stdout.on("data", (data) => {
	buffer += data.toString();
	const lines = buffer.split("\n");
	buffer = lines.pop() || "";
	for (const line of lines) processLine(line);
});
```

以只含 ASCII 字符的两个**示意字节块**推演算法，A 为 `{"type":"message_`，B 为 `end"}\n{"type":"other"}\n`，其中 `\n` 表示一个实际换行。收到 A，分割后没有完整行，所有字符留在 `buffer`。收到 B，连接后有两条完整记录，依次调用 `processLine`，尾部留下空串。遇到不合法 JSON 时，解析函数捕获错误并跳过该行。进程关闭时还会尝试解析最后一段非空缓冲，即使它没有末尾换行。[逐行解析与退出收尾](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L350)

这是这个扩展示例的解码实现。它对每个 Buffer 单独调用 `toString()`；如果一个 UTF-8 多字节字符恰好跨过字节块，单纯拼字符串可能损坏字符。若用相同协议实现自己的接收器，应在字节层保留未完成的字符或使用流式解码器。换行分帧解决的是“记录不完整”，字符解码另有边界。

### 把一次真实子进程放到显微镜下

课程示例直接加载 Pi 发布包附带的 `subagent` 扩展，交给它一个临时项目里的 `scout` 角色。它实际调用 `spawn` 创建子进程。只有子侧模型被一个确定的 JSON 输出程序替代，因此同一命令可在离线环境反复验证。子侧第一次写入只送达一条事件的一部分，第二次写入剩余字符。正常退出案例故意不给最后的换行；另两次则安排进程失败与运行中取消。操作系统仍可以合并写入，父侧必须对任何分片方式给出相同结果。[子进程实验](../examples/read-loop/subagent-pipes.mjs)

```bash
cd examples/read-loop
npm ci
node subagent-pipes.mjs
```

```text
成功  父模型收到 src/args.ts:parseName ；详情保留 2 个文本块
并行  输入顺序的退出码 [2, 0]； Parallel: 1/2 succeeded
取消  父进程在收到第一条更新时发出取消，工具以 Subagent was aborted 结束
```

这里第一行特别容易误读。子程序发来的 `message_end` 里有两个文本块，第一块为 `src/args.ts:parseName`，第二块为 `Second text block`。缓冲器把最后的不完整片段在关闭时补交给 `processLine` 后，两个块都在父侧 `details.results[0].messages` 中。可是 `getFinalOutput` 是从消息列表尾部往前寻找 assistant，再在该消息的内容块中从头找第一个文本块。它没有把同一消息中的所有文本拼起来。于是父模型只收到源文件位置，界面或程序查看详情仍能取到第二块。若最新 assistant 只有工具调用而没有文本，查找还会继续向前，到前面某条含文本的 assistant 为止。[最终文本选择](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L168)

## 4. 子结果怎样变回父工具结果

收到 `message_end` 时，处理器把消息放入 `currentResult.messages`。如果是助手消息，还会累计轮数、输入输出 Token、缓存和费用，并记录最近的停止原因、错误文字。stderr 单独累积。父侧 `onUpdate` 可以展示进展，而提交给父模型的文本则要等这项工作结束后从消息里选取。[子消息与用量累积](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L360)

源码摘录：[packages/coding-agent/examples/extensions/subagent/index.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L180)

```ts
function isFailedResult(result: SingleResult): boolean {
	return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
	}
	return getFinalOutput(result.messages) || "(no output)";
}
```

| 执行情况 | 单子任务的判定 | 父侧会取什么文字 |
| --- | --- | --- |
| 退出码 0，最后助手完成并有文本 | 成功 | 最近含文本的助手消息中的第一个文本块 |
| 进程正常退出，但助手 `stopReason = "error"` | 失败 | 优先取 `errorMessage`，然后是 stderr，再回退到助手文本 |
| 子程序未能正常启动 | `error` 事件将退出码设为 1 | 错误信息或备用文本 |
| 父运行取消，处理器已发停止信号 | 记录 `wasAborted`，等待结束后抛出中止异常 | 进入调用者的取消或错误路径 |

模型看到的 `content` 和界面可使用的 `details.results` 目的不同。单任务成功只送出选中的最终文本。并行模式还会对每个任务的可见输出分别限长，完整结果仍保留于详情。链式模式选择最后一个成功步骤的文本向父侧返回，早期步骤留在详情里。[三种结果的返回分支](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L581)

### 一个 worker 池怎样保证顺序

父模型也可以一次提交多个调查任务。实现把一次请求的任务数限制为八个，最多同时推进四个。`mapWithConcurrencyLimit` 先按输入的长度分配结果数组，再启动固定数量的异步 worker。每个 worker 取 `current = nextIndex++`，随后 `await` 对应的任务；当那个任务结束，它将结果写到 `results[current]`，再取下一项。取号的自增在同一段同步 JavaScript 中，第一次 `await` 之前就已经拿走了自己的下标。并发工作可以交错等待子进程，不需要四个消费者反复猜最后一个空槽在哪。[并发限制与回填下标](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L217)

设有五项任务 A、B、C、D、E，开始时四个 worker 分别拿到 A 到 D。C 最先结束，拿到 E；即便 E 赶在 A 之前也结束，结果仍写到下标 4。父侧最后 `Promise.all(workers)` 等所有 worker 循环完成，再按输入顺序整理输出。每一项是否成功取决于自己的退出码和停止原因，进度更新到达的顺序则由各子进程决定。课程程序里第一项写故障信息到 stderr 并以 2 退出，第二项正常退出。父工具给出「1/2 成功」并保留两个结果槽；并行模式的汇总本身没有据此设置 `isError:true`。如果把外层工具结果的成功与否直接当成两项任务全成功，就会漏掉那次失败。[并行结果汇总](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L643)

若把同样两件事改用 `chain`，语义又变了。实现每次先把本步 task 中的 `{previous}` 替换为上一步选出的最终文本，再启动下一步。上步的工具日志、第二个文本块或整个会话树都不会隐含在这个占位符里。某步失败时，函数当场返回已经完成的结果并标为错误，后续步骤不启动。因此当 planner 依赖 scout 给出的准确位置，应让前一项的交接文字本身包含文件与函数；当两项调查独立时，输入顺序的结果数组和各项状态更有意义。[链式文本交接与失败返回](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L548)

## 5. 取消和信任有什么进程级含义

父运行的 `AbortSignal` 会触发 `proc.kill("SIGTERM")`，代码在 5 秒后根据 `proc.killed` 决定是否再发 `SIGKILL`。这个标志代表发过终止信号，不能单独证明整个子进程树已退出。示例在 `finally` 中清理角色提示的临时文件。需要可靠中止进程树的服务，还应核对进程和后代的实际生命周期。第 15 章内置 Shell 使用了自己的进程树处理。[子进程取消与清理](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L399)

项目里的角色定义可以改变模型要执行的任务。示例默认只发现用户侧角色。如果允许项目角色、启用运行前确认、有 UI 且项目未受信任，扩展将检查被请求的角色是否真的来自项目，再决定是否弹出确认。回归测试让同一个虚拟模型请求项目角色，对已信任项目断言确认次数是 0，对未信任的交互项目则断言会询问，拒绝时工具文字包含取消原因。[确认条件](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/examples/extensions/subagent/index.ts#L519) · [两种信任情形的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/suite/regressions/8261-subagent-project-trust.test.ts#L69)

### 看见一条更新之后能否宣布成功

程序第三行的触发条件是父侧 `onUpdate` 已收到一条消息。这个条件比「等五十毫秒再猜子程序是否起来了」可靠，也能演示控制通道和数据通道的差别。子侧先写完整一行，父侧解析并报告部分结果；此时子程序还在等待。父侧才令 `AbortController` 发出信号。扩展将 `wasAborted` 设为真并向子进程发终止信号。等进程事件让等待中的 Promise 结束，函数写入退出码，检查 `wasAborted`，抛出 `Subagent was aborted`。所以父侧完全可能同时掌握「确实出现过有用输出」和「这次任务被取消」两条事实，前者不能代替后者。

再对照一次**未取消**的执行。子程序可以往 stderr 写一条诊断后正常退出，若助手也没有报告错误，单项结果仍按成功路径选择助手文本；子程序退出码非零时，才会沿失败路径按错误文字、stderr、助手文本的顺序取解释。若任务宣称「已经修好测试」，无论这句话来自成功路径的最后文字还是失败路径的回退文字，它本身都只是子程序返回的材料。可以先检查退出状态来分清控制流是否完成，再看是否携带测试结果、文件位置等足以支持业务结论的数据。这是把多个循环连起来以后，父 Agent 需要多做的一层判断。

## 6. 把本地委托放回系统地图

本例属于“Agent 作为工具”。父模型生成动作，扩展负责运行独立的子循环，再把结果交回原父模型。传给下一步的材料来自显式任务字符串、角色配置和共享文件。跨服务的 A2A 协作还需另外定义任务标识、身份、状态、产物和取消如何跨网络传递。Pi 的 Durable 子任务又有自己的存储与恢复语义。它们可以解决相似业务问题，生命周期则分别由子进程、网络协议和持久任务系统承担。

> **先预测**　子任务已经传回一条看起来成功的助手消息，此时能否给父任务标上成功？
>
> **核对推导**　不能只凭中间更新。父进程还需要等子进程结束，检查退出码以及 error、aborted 等停止原因。单条消息能证明传输有进展，不足以证明整个子任务成功退出。

[继续阅读：执行环境：工具的动作到底在哪里发生](15-sandbox-code-agent-and-computer-use.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
