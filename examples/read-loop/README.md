# 跟踪一次 read 工具调用

需要 Node.js 22.19 或更新版本。在仓库根目录执行以下命令。

```bash
cd examples/read-loop
npm ci
npm start -- success
npm start -- missing
npm start -- length
npm run session
```

三个情形使用 Pi 的 Agent Loop 和内置文件工具。模型使用 Pi 的 Faux Provider，第一次按脚本发出工具请求，第二次从真正返回的结果中取一句说明。可以修改 [示例 README](fixtures/README.md) 再运行。全部示例在本机完成，无需模型账户。

| 情形 | 模型请求次数 | 进入工具函数的次数 | 工具结果 |
| --- | --- | --- | --- |
| success | 2 | 1 | 返回文件内容 |
| missing | 2 | 1 | 文件不存在，返回错误 |
| length | 2 | 0 | 输出被截断，运行时为这次调用构造错误 |

用 `node cli.mjs success --json` 查看每轮请求、事件名、工具执行记录和最终消息。输出只选取便于比较的字段。代码分为[模型脚本和循环入口](run.mjs)、[读取磁盘的入口](cli.mjs)与[完整 SDK 会话](session.mjs)。

网站复用同一个循环和模型脚本，用[浏览器工具](browser.mjs)读取输入框中的虚拟文件。第三章的[工具批次实验](batch.mjs)用两个工具结果与一条可选的后续输入演示停止分支。第六章的[会话投影示例](projection.mjs)使用 Pi 的公开 API 记录切点和恢复后的消息。

## 按现象选一个实验

除另有说明外，以下命令都在本目录执行。模型回复使用脚本控制；每章说明哪些操作由 Pi 本身完成。

| 章节 | 运行 | 对照什么 |
| --- | --- | --- |
| 02–05 | `node boundaries.mjs stream`、`queue`、`bytes`、`context`（任选一个作为参数） | 两个工具参数交错、消息投递时机、整行字节预算和系统指令重放 |
| 06 | `node recompact.mjs` | 两次压缩、一次编辑，再切回旧叶子的可见消息 |
| 07 | [MCP 往返](../mcp-roundtrip/roundtrip.mjs)：在其目录运行 `npm ci && npm start` | 两个响应乱序与一条被取消的请求 |
| 08、09 | `node skills.mjs`、`node context-hooks.mjs` | 同名技能留下谁、旧扩展上下文何时失效 |
| 10 | `node workflow.mjs` | 真实写入模板、是否刷新和实际模型输入 |
| 11 | `node scheduler.mjs` | 五项任务、四个位置，比较开工次序与结果次序 |
| 12 | `node plan-items.mjs` | 跳号、短条目、重复完成标记会如何解析 |
| 13 | `node resume.mjs` | 关掉会话并改动文件；区分历史信息与重新读取 |
| 14 | `node subagent-pipes.mjs` | 真子进程分片输出、部分失败和取消 |
| 15 | [Shell 输出实验](../shell-output/observe.mjs) | 从课程根目录传入已准备好的上游源码目录，观察分块解码、快照与完整文件 |

第 16–18 章将可运行命令和定向测试名直接写在正文中，分别检查中断恢复、策略失效和评测比较。
