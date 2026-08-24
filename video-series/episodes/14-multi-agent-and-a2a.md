# Learn Pi Agent 14｜什么时候才真的需要 Multi-Agent

- 对应课程：第 14 章
- 核心问题：多个模型调用什么时候构成多个 Agent，A2A 又解决什么？
- 核心结论：独立 Agent 应有自己的 Loop、Context、状态和生命周期；Multi-Agent 需要明确控制关系和跨 Context 契约，A2A 再标准化跨系统协作。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 一个 Mox 分成多个协作者 | ① |
| 06–15s | `02-what-is-an-agent.png` | Loop、Context、State、Lifecycle 四项点亮 | ② |
| 15–24s | `03-control-patterns.png` | Manager、Tool、Handoff、Delegation 对照 | ③ |
| 24–33s | `04-context-contract.png` | Task Contract 穿过 Context 边界 | ④ |
| 33–42s | `05-parallel-cost.png` | 并行时间缩短、Token 成本上升 | ⑤ |
| 42–51s | `06-pi-subagent.png` | 主 Agent 通过 Tool 启动独立 Pi 进程 | ⑥ |
| 51–60s | `07-pi-modes.png` | single、parallel、chain 三种模式 | ⑦ |
| 60–69s | `08-boundaries.png` | 信任、取消、预算、汇总边界出现 | ⑧ |
| 69–78s | `09-a2a-flow.png` | Agent Card 到 Message、Task、Artifact | ⑨ |
| 78–87s | `10-task-lifecycle.png` | A2A Task 状态机推进 | ⑩ |

## 连续口播稿

① 让三个模型同时回答，不一定叫 Multi-Agent。先看每个单元有没有独立运行边界。

② 独立 Agent 至少有自己的 Loop、Context、状态和生命周期；一次模型调用更像普通节点。

③ Manager–Worker、Agents-as-Tools、Handoff 和 Delegation，描述谁保留控制以及任务是否转移。

④ 跨 Agent 应用 Task Contract 传递目标、约束、允许能力、完成标准和结果格式，而不是倾倒完整 Context。

⑤ 并行 Worker 缩短关键路径，也增加 Token、重复搜索和合并冲突；子任务独立时才值得 fan-out。

⑥ Pi 核心不内置 Subagent；官方示例用 `subagent` Tool 启动独立 Pi 子进程，在扩展层实现。

⑦ 示例支持 single、parallel 和 chain；三种模式的失败与 Context 传递方式不同。

⑧ 生产系统还要定义信任、工具权限、并发、取消、预算和结果聚合。

⑨ A2A 面向跨系统协作：用 Agent Card 发现能力，用 Message、Task、Part 和 Artifact 交换工作。

⑩ A2A 管 Agent 任务协作，MCP 主要连接工具与资源。下一章，看 Agent 动作该被关在哪里。

## 事实锚点

- 多个 LLM 调用不自动构成 Multi-Agent。
- Handoff 通常意味着任务控制权转移；Agents-as-Tools 则由调用者保留主控制。
- MCP 标准化能力接入，A2A 标准化 Agent 间任务协作，二者不互相替代。
