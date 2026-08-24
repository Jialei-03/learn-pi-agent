# Learn Pi Agent 07｜MCP 解决的不是“智能”，而是连接问题

- 对应课程：第 7 章
- 核心问题：MCP 在 Agent 系统里究竟位于哪一层？
- 核心结论：MCP 标准化 Host 与外部 Server 之间的能力发现和调用；它不是 Agent Loop，也不替 Harness 决定下一步。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 多个外部系统接入同一接口 | ① |
| 06–15s | `02-what-mcp-solves.png` | N×M 连接收敛为统一协议 | ② |
| 15–24s | `03-host-client-server.png` | Host、Client、Server 三层展开 | ③ |
| 24–33s | `04-modern-mcp.png` | 请求、响应和通知按协议流动 | ④ |
| 33–42s | `05-transports.png` | stdio 与 Streamable HTTP 分路 | ⑤ |
| 42–51s | `06-three-primitives.png` | Tools、Resources、Prompts 各自归位 | ⑥ |
| 51–60s | `07-mrtr.png` | 一次请求展开多次往返 | ⑦ |
| 60–69s | `08-mcp-to-pi.png` | MCP Client 经 Extension 接到 Pi Tool | ⑧ |
| 69–78s | `09-security.png` | 信任、授权、确认三道边界 | ⑨ |
| 78–87s | `10-summary.png` | “协议 ≠ 编排”落为结论 | ⑩ |

## 连续口播稿

① Agent 连接文件、数据库和企业服务时，最先爆炸的往往不是模型能力，而是每个系统都要单独适配。

② MCP 标准化连接：Host 不必为每个 Server 发明发现、调用和结果格式，Server 也能被不同 Host 复用。

③ Host 承载应用和 Agent；Client 是 Host 内的通信端；Server 暴露外部能力。

④ MCP 用 JSON-RPC 语义组织请求、响应、错误和通知，但不决定模型何时调用哪个能力。

⑤ 本地常用 stdio，由 Host 管理子进程；远程使用 Streamable HTTP。传输变化不改变能力语义。

⑥ Server 可暴露 Tools、Resources 和 Prompts：动作、可读内容与提示模板。三者不会自动都变成模型工具。

⑦ 一次 MCP 交互也可能多轮往返。Host 必须保持边界，不能把每个请求都直接交给模型或用户。

⑧ Pi 没把 MCP 写死在 Loop 里；可以用 Extension 创建 Client，再把能力适配为 Pi Tool 或资源。

⑨ 标准协议不等于可信执行。身份、授权、参数确认、最小权限和来源仍由 Host 负责。

⑩ MCP 标准化外部能力怎样连接，Harness 决定能力怎样进入任务。下一章，看 Skill 怎样教 Agent 做事。

## 事实锚点

- MCP Host、Client、Server 是通信角色，不等于 Manager Agent、Worker Agent。
- Resources 和 Prompts 是独立 primitive，不应未经设计就全部转成 Tool。
- MCP 提供互操作协议，不自动提供授权、Sandbox、工作流或任务成功判断。
