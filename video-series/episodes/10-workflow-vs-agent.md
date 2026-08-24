# Learn Pi Agent 10｜Workflow 和 Agent，关键只看一件事

- 对应课程：第 10 章
- 核心问题：一段多步骤 AI 程序究竟是 Workflow，还是 Agent？
- 核心结论：最有用的判断标准是“下一步由谁决定”：代码预先定义控制流的是 Workflow，模型根据运行结果动态选行动的是 Agent，两者可以嵌套。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 两条路径在岔路口出现 | ① |
| 06–15s | `02-core-boundary.png` | “谁决定下一步”成为中心问题 | ② |
| 15–24s | `03-determinism.png` | 固定控制结构与随机文本分离 | ③ |
| 24–33s | `04-two-loops.png` | Workflow Loop 与 Agent Loop 对照 | ④ |
| 33–42s | `05-control-spectrum.png` | 控制权从代码滑向模型 | ⑤ |
| 42–51s | `06-orchestrator.png` | 编排器调度多个节点 | ⑥ |
| 51–60s | `07-routing.png` | 规则路由与模型路由对照 | ⑦ |
| 60–69s | `08-pi-agent-node.png` | Pi Session 被包装成一个节点 | ⑧ |
| 69–78s | `09-hybrid-release.png` | 固定发布流程包住动态 Agent | ⑨ |
| 78–87s | `10-choose-and-summary.png` | 可预测性与适应性天平落稳 | ⑩ |

## 连续口播稿

① 多模型、多步骤，就叫 Agent Workflow 吗？最稳定的判断是：下一步到底由谁决定。

② 代码预先定义节点与跳转，是 Workflow；模型根据观察动态选择行动，是 Agent。

③ 确定性编排只表示控制结构固定，不表示模型文本、网络结果和并发顺序完全确定。

④ Workflow Loop 按显式状态跳转；Agent Loop 让模型提出下一步 Tool Call。两者控制权不同。

⑤ 实际系统是一条控制光谱：固定链路、规则路由、模型路由、受限 Agent，再到开放 Agent。

⑥ Orchestrator 调度节点、传递状态、处理失败和聚合结果，也可以调用一个完整 Agent。

⑦ 规则路由可预测；模型路由更灵活，却需要兜底、Schema 和置信边界。

⑧ Pi 的 `AgentSession` 可包装成 Workflow Node：输入任务，等待完成，再返回结构化结果。

⑨ 可靠发布常是混合结构：外层固定检查、审批和部署，内层 Agent 动态分析和修复。

⑩ 高风险重复任务让代码控制；开放探索给模型更多选择。下一章，拆解六种 Workflow Pattern。

## 事实锚点

- 多步骤不自动等于 Agent；关键是行动选择权落在哪里。
- 固定 Workflow 仍可包含非确定性的模型节点。
- 把 Agent 放入 Workflow 时，要定义输入、输出、取消和失败契约。
