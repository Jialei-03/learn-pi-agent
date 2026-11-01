# 执行环境：工具的动作到底在哪里发生

模型要求运行测试时，真正接触文件、进程和网络的是执行器。本章从 Bash 和文件工具进入，解释工作目录、策略、沙箱和 Computer Use 的不同边界。

![Mox 解释本章的机制关系](../assets/sandbox-illustrations/03-cwd-is-not-sandbox.png)

## 1. Shell 子进程怎样启动

[`tools/bash.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts) 的默认操作使用 Node 子进程启动 Shell，并传递工作目录和环境。输出、超时、取消和子进程生命周期要分别处理。

源码摘录：[packages/coding-agent/src/core/tools/bash.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts#L112)

```ts
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

Shell 命令字符串有自己的语法和副作用。参数通过工具 Schema 只说明它是一个字符串，不保证命令安全或符合任务目的。

## 2. `cwd` 的作用

`cwd` 决定相对路径解析和资源发现的起点，绝对路径仍可能指向其他目录。`path-utils.ts` 的解析逻辑能帮助理解这点。工作目录是定位方式，不是文件系统权限边界。

同样，Git worktree 方便隔离文件修改和分支状态，却不是系统调用沙箱。进程仍使用启动账号的权限。

## 3. 替换 Operations

Read、Bash 等工具提供可替换操作接口。把操作路由到远端执行器或隔离环境，可以复用上层工具契约，但必须检查所有动作是否都走了这条路径。

若只替换 Bash，而读写工具或扩展仍在宿主运行，边界就只覆盖一部分动作。用户 Shell、安装器、语言服务器和自定义工具也可能产生副作用。

## 4. 整体隔离与局部隔离

Pi 的 [`containerization.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md) 描述整进程容器化及通过工具操作进行路由等方式。整进程隔离能够覆盖更多执行入口；工具路由能保留宿主交互和认证，但其余宿主代码仍在边界之外。

挂载目录、网络、凭据和资源额度决定隔离环境实际能访问什么。给容器暴露所有宿主文件或高权限服务，会显著改变这条边界。

## 5. Tool Gate 与 Sandbox

工具钩子可以阻止已识别的请求，适合业务策略和人类批准。沙箱通过系统或虚拟化限制进程能影响的资源。前者依赖具体调用路径和动作识别，后者约束实际执行环境。

Pi 的安全文档明确要求把模型生成命令和项目内容当成不可信材料；默认运行使用启动账号权限，不会对每次工具调用都询问批准。

## 6. Computer Use 的动作循环

截图或可访问性状态提供观察，模型提出点击或输入，宿主实际操作，再重新观察。它与读文件工具循环相似，但 UI 状态会变化，坐标和元素句柄可能失效。

这属于另一种执行接口，不是本地 Pi CLI 自动拥有的所有能力。应用集成 Computer Use 时还需维护会话、输入范围、敏感操作和结果验证。

下一章研究程序崩溃后如何继续，尤其是外部动作已经发生而结果尚未保存时怎么办。

## 7. 输出截断与动作状态

Shell 可以持续产生大量输出。UI 的预览、模型收到的文本和磁盘保存的完整输出有各自限制，不能只凭预览最后一行判定命令执行结果。退出码、超时或取消标记同样需要保留。

文件工具也可能已经读取完整文件，再按行数或字节限制构造模型结果。输出长度限制保护 Context 和显示性能，不能代替文件访问控制。

一个可检查的执行记录至少包含命令或工具名、解析后的目标、工作目录、停止原因和结果来源。涉及敏感数据时还需控制记录内容，避免为了调试把所有输入和环境无差别保存。


[继续阅读：Durable：提交、任务状态与崩溃后的继续执行](16-durable-execution-and-human-in-the-loop.md)

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
