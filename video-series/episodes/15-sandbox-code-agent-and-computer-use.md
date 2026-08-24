# Learn Pi Agent 15｜Agent 会写代码，还必须学会“关进笼子”

- 对应课程：第 15 章
- 核心问题：Code Agent 和 Computer Use 为什么不能只依靠确认弹窗？
- 核心结论：能力接口、Policy、Approval、工作目录和 Sandbox 解决不同问题；安全执行需要隔离文件、进程、网络、Secret 和资源预算，并保留验证反馈。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 代码工具被放入隔离边界 | ① |
| 06–15s | `02-four-executors.png` | File、Shell、Browser、Computer 四类接口 | ② |
| 15–24s | `03-action-layers.png` | 模型、Loop、Policy、Executor、Sandbox 分层 | ③ |
| 24–33s | `04-cwd-and-sandbox.png` | cwd 边界与系统隔离边界分开 | ④ |
| 33–42s | `05-pi-default.png` | Pi Tool 到本机子进程的真实路径 | ⑤ |
| 42–51s | `06-gate-vs-sandbox.png` | “是否允许”与“最多影响什么”对照 | ⑥ |
| 51–60s | `07-isolation-patterns.png` | 全 Agent 隔离与 Tool 路由隔离 | ⑦ |
| 60–69s | `08-secrets-network.png` | Secret broker 与网络 allowlist | ⑧ |
| 69–78s | `09-computer-use.png` | 截图—动作—新截图循环 | ⑨ |
| 78–87s | `10-safe-blueprint.png` | 六层安全执行蓝图闭合 | ⑩ |

## 连续口播稿

① Code Agent 会真实行动，所以错误可能变成被删的文件、泄露的密钥或错误发布。

② 四类接口是文件 Tool、Shell、Browser Automation 和 Computer Use；能力越通用，越难验证。

③ 模型提请求，Loop 组织步骤，Policy 决定能否做，Executor 执行，Sandbox 限制影响，验证器检查结果。

④ Working Directory 只决定路径起点；Allowlist、Worktree 和 Sandbox 分别控制能力、变更与系统隔离。

⑤ Pi 默认 Tool 会访问真实文件并启动 Bash 子进程；Pi 本身不自动提供完整 OS Sandbox。

⑥ Gate 回答“允不允许”，Sandbox 回答“最多能伤到哪里”。两者都需要。

⑦ 可以隔离整个 Pi，也可只把 Tool Operation 路由到隔离执行器；两种方式边界不同。

⑧ Secret 不进 Context，由执行环境短暂注入；网络默认拒绝，并限制 CPU、内存、磁盘和时间。

⑨ Computer Use 是截图、选动作、执行、再截图的闭环；每步都要验证界面状态。

⑩ 可靠蓝图是最小工具、Policy、隔离、Secret Broker、网络控制和验证。下一章进入 Durable Execution。

## 事实锚点

- `cwd`、Worktree 和 Sandbox 是不同边界。
- Approval 不能替代隔离；Sandbox 也不能替代动作级授权。
- Pi 的默认工具执行行为要按真实源码和部署环境理解，不能假设已在容器内。
