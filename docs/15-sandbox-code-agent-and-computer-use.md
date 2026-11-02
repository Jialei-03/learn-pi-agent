# 执行环境：工具的动作到底在哪里发生

假设一次测试输出了“开始检查”，然后以状态码 7 退出。界面可能已经显示了这行文字，模型又该从哪里知道命令失败了？顺着内置 `bash` 工具往下走，可以看到三种各自有寿命的数据：模型写出的参数、操作系统交还的字节流、Pi 最终提交的工具结果。

![Mox 解释本章的机制关系](../assets/sandbox-illustrations/03-cwd-is-not-sandbox.png)

## 1. 从参数对象到子进程

下面是一份教学输入，命令仅打印文字并返回非零状态。

```json
{"command":"printf 'checking'; exit 7","timeout":10}
```

模型提供的是字符串和秒数。`createBashTool(cwd)` 创建定义并用 `wrapToolDefinition` 把它接进 Agent。收到调用后，`execute` 选取会话的工作目录，准备命令和环境，如果设置了 `commandPrefix` 或 `spawnHook`，实际执行的值还会变。最终执行位置由 `operations` 决定。默认实现先检查工作目录存在、取消信号尚未触发，再启动所配置的 Shell。[工具装配和执行入口](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L242)

源码摘录：[packages/coding-agent/src/core/tools/bash.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L110)

```ts
const commandFromStdin = shellConfig.commandTransport === "stdin";
const child = spawn(shellConfig.shell, commandFromStdin ? shellConfig.args : [...shellConfig.args, command], {
	cwd,
	detached: process.platform !== "win32",
	env: env ?? getShellEnv(),
	stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
	windowsHide: true,
});
if (commandFromStdin) {
	child.stdin?.on("error", () => {});
	child.stdin?.end(command);
}
if (child.pid) trackDetachedChildPid(child.pid);
```

这里的 `stdio` 指定三个通道。标准输入有两种用法，取决于 Shell 接收命令的方式。标准输出与标准错误分别接入管道，然后都把数据块交给同一个 `onData`。默认呈现会将两种输出汇集在一起，单看一行字符已经不能判断它最初走的是哪个通道。Shell 按自身语法解释 `;` 和 `exit`，所以这一条工具调用可以包含多个动作。[流接入和取消处理](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L125)

## 2. 输出逐渐到达，结果在退出后形成

| 时刻 | 新获得的信息 | 由谁保存或消费 |
| --- | --- | --- |
| 开始执行 | 调用已开始，还没有输出 | 若提供 `onUpdate`，先发送空内容 |
| 收到字节 | 此例得到 `checking` | `OutputAccumulator.append` 累积输出，按节流规则向界面发快照 |
| Shell 结束 | 退出码为 7，管道可能还有数据 | `waitForChildProcess` 处理进程与管道的收尾 |
| 生成结果 | 文本、结构化输出、错误标记 | `finishOutput` 完成快照，工具据退出码构造返回值 |

更新是当前快照。将每个快照直接拼接成最终文本会重复之前收到的字符。实际的完成操作先关闭数据入口 `acceptingOutput`，停止计时器，发出待刷新的更新，再取最终快照并关闭临时文件。这个顺序给“最后一批数据”和“结算”画出明确边界。[累积、节流与完成快照](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L281)

源码摘录：[packages/coding-agent/src/core/tools/bash.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L399)

```ts
if (exitCode !== 0) {
	return {
		content: [{ type: "text", text: appendStatus(outputText, `Command exited with code ${exitCode}`) }],
		details,
		structuredContent,
		isError: true,
	};
}
return { content: [{ type: "text", text: outputText }], details, structuredContent };
```

沿上例推演，模型可见的 `content` 包含 `checking` 和 `Command exited with code 7`。调用方可以直接从 `structuredContent.exit_code` 读取 7，`isError` 为真。用时取决于实际运行。退出码 0 走代码块的最后一行。超时、取消则从异常分支带着已有输出离开，分别追加超时原因或 `Command aborted`。这解释了为什么业务层要检查状态字段，而不能只搜索输出中有没有“error”。[异常和结构化结果](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L360)

## 3. 为什么同一条命令会有三种长度

测试日志可能有几万行。Pi 会为模型展示末尾最多 2,000 行、50 KiB，先达到的限制生效。日志尾部通常包含报错位置和最终的测试统计。截断时文本还会写明保留了哪一部分以及完整输出的临时文件路径。程序化调用读取的 `structuredContent.output` 有自己独立的 1 MiB 上限。完整文件、程序化输出与模型摘要的体积因此可以不同。[截断常量](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/truncate.ts#L11) · [结构化输出上限](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L22)

例如运行产生 2,500 行很短的 ASCII 日志，且按字节未达到 50 KiB。模型看到的只是尾部和截断提示，程序化输出仍可能容纳全部字节。反过来，若只有一行极长的输出，限制先由字节数触发，提示可以描述最后一行保留了多少字节。行数本身无法预测结果。[截断说明的三个分支](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L337)

## 4. 一个曾经丢日志的时序

Shell 退出与最后一个写入者关闭管道可能相隔一段时间。举例说，一个命令派生了继承 stdout 的进程，父进程先退出，后者仍能写日志。一直等管道关闭可能卡住，在父进程退出时马上停止读取又可能丢数据。Pi 的等待逻辑在退出后观察管道活动，每次再收到数据就重置空闲计时器。[进程等待实现](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/utils/child-process.ts#L41)

回归测试使用虚拟时钟精确构造了这条时间线：

| 虚拟时刻 | 测试动作 | 可推断的状态 |
| --- | --- | --- |
| 0 ms | 写 `HEAD`，发出 `exit(0)` | 已知道退出码，等待仍在进行 |
| 50 至 300 ms | 每隔 50 ms 再写一个 `TICK` | 连续六次延长空闲等待 |
| 399 ms | 最后一次写入后 99 ms | 断言等待尚未结束 |
| 400 ms | 再推进 1 ms | 返回 0，输出同时包含 `HEAD` 和 `TICK6` |

“100 ms”在这里表示最近一次活动后的空闲窗口。如果从退出起固定等待 100 ms，第六个数据块会消失。这种测试同时检查返回时机和保留内容，能捕捉只比对退出码会遗漏的错误。[回归用例与断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/test/suite/regressions/5303-bash-output-truncation.test.ts#L39)

## 5. 工作目录、取消与执行环境

`cwd` 为相对路径提供起点。默认执行器以当前操作系统用户的权限运行，能够访问哪些绝对路径、网络和凭据由进程环境决定。`timeout` 会触发杀进程树，调用者发出取消信号也会走杀进程树的路径。已经写入的文件会保留，事务回滚需要应用自己实现。[默认执行器](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L96)

要把命令放到远端或容器里，应沿 `BashOperations.exec(command, cwd, { onData, signal, timeout, env })` 这个接口替换执行后端。适配器需要把远端输出送回 `onData`，将远端状态变成本地退出码，并把取消传到真正运行命令的一端。只替换 Bash 只会改变走该接口的动作，文件工具和扩展的执行位置还要分别检查。屏幕点击等 Computer Use 工具同样需要自己的执行器与权限边界。[可替换的操作接口](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/coding-agent/src/core/tools/bash.ts#L70) · [Pi 的隔离部署说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)

[继续阅读：Durable：提交、任务状态与崩溃后的继续执行](16-durable-execution-and-human-in-the-loop.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
