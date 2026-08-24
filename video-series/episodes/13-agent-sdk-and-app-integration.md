# Learn Pi Agent 13｜Agent SDK 怎样装进真实产品

- 对应课程：第 13 章
- 核心问题：从模型 API 到 Agent SDK，再到 CLI，应用分别获得了什么？
- 核心结论：Agent SDK 封装循环、事件和会话，但产品仍要负责用户隔离、认证、生命周期、界面状态和治理；Pi 的三个包正好对应不同接入层。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 模型能力被装进 Web 应用外壳 | ① |
| 06–15s | `02-four-levels.png` | API、Runtime、SDK、CLI 四层展开 | ② |
| 15–24s | `03-pi-stack.png` | `pi-ai`、core、coding-agent 叠成栈 | ③ |
| 24–33s | `04-session-assembly.png` | Session 装入模型、工具、资源和管理器 | ④ |
| 33–42s | `05-pi-sdk-code.png` | 最小接入代码按执行顺序高亮 | ⑤ |
| 42–51s | `06-streaming-ui.png` | 事件流映射为界面状态 | ⑥ |
| 51–60s | `07-lifecycles.png` | Message、Turn、Run、Session 时间线 | ⑦ |
| 60–69s | `08-abort-dispose.png` | 取消运行与销毁会话分叉 | ⑧ |
| 69–78s | `09-provider-boundary.png` | 密钥留在服务端适配层 | ⑨ |
| 78–87s | `10-sdk-map-summary.png` | SDK 能力与产品责任对照 | ⑩ |

## 连续口播稿

① Agent 在命令行能运行，不表示接进 Web 产品只要复制几行代码。先要选对接入层。

② 模型 API 只管调用；Runtime 提供循环；Agent SDK 再提供 Session、事件和装配；CLI 已是完整产品。

③ Pi 中，`pi-ai` 处理 Provider，`pi-agent-core` 处理 Loop，`pi-coding-agent` 负责 Session、工具和产品能力。

④ `createAgentSession()` 装配模型、Tool、ResourceLoader 和各种 Manager；默认值也代表真实行为。

⑤ 最小流程是创建 Session、订阅事件、发送 `prompt()`、等待完成、提取最终消息，再释放资源。

⑥ Streaming 是同一条 Loop 的观察方式。界面用稳定 ID 合并 delta、工具进度和最终消息。

⑦ Message、Turn、Run、Session 生命周期不同：Session 包含多个 Run，Run 又可包含多个 Turn。

⑧ `abort()` 停当前运行；`dispose()` 释放整个 Session。网络断开也不等于后台任务已取消。

⑨ Provider 密钥留在服务端；适配层统一接口，也要保留错误、用量和能力差异。

⑩ SDK 帮你运行，不替你完成用户隔离、权限、存储和审计。下一章进入 Multi-Agent。

## 事实锚点

- Pi 的 `prompt()` 驱动 Session 运行，不应假设它直接返回最终答案字符串。
- Streaming event、持久 Message 和 UI View State 是三个不同对象。
- Tool allowlist 选择暴露哪些能力，不等于操作系统 Sandbox。
