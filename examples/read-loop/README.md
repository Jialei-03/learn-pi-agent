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
