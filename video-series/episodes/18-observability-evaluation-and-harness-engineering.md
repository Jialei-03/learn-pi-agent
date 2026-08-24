# Learn Pi Agent 18｜怎样知道 Agent 真的变好了

- 对应课程：第 18 章
- 核心问题：没有报错、最终答案看起来不错，是否足以证明 Agent 可靠？
- 核心结论：需要用 Event、Metric、Trace 和 Eval 同时观察结果、轨迹、成本和风险，再用 Baseline/Candidate 实验和发布 Gate 推动 Harness 持续改进。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | “成功？”被拆成四个问题 | ① |
| 06–15s | `02-four-kinds-of-evidence.png` | Event、Log、Metric、Trace 归位 | ② |
| 15–24s | `03-trace-and-trajectory.png` | Span Tree 与行动序列并排 | ③ |
| 24–33s | `04-quality-scorecard.png` | 质量、可靠性、延迟、成本、安全分栏 | ④ |
| 33–42s | `05-pi-event-layers.png` | Core Event、Session Event、Hook 分层 | ⑤ |
| 42–51s | `06-pi-telemetry-contract.png` | Telemetry Context 与 Schema 连接 | ⑥ |
| 51–60s | `07-eval-anatomy.png` | Task、Trial、Outcome、Grader、Suite 装配 | ⑦ |
| 60–69s | `08-grader-layers.png` | Code、Human、LLM 三类评分组合 | ⑧ |
| 69–78s | `09-pi-comparative-eval.png` | Baseline 与 Candidate 成对比较 | ⑨ |
| 78–87s | `10-harness-engineering.png` | 观测—归因—改进—回归—发布闭环 | ⑩ |

## 连续口播稿

① Agent 没有 Error、答案也像对的，就能发布吗？不能，它可能走了危险路径，或只是偶然成功。

② Event 记录发生了什么，Log 保存细节，Metric 聚合趋势，Trace 连接一次运行中的调用关系。

③ Trace 用 Span Tree 描述系统操作；Trajectory 关注消息、工具和状态序列。两者相关但不同。

④ 不要用一个总分代表质量；分别看成功率、稳定性、延迟、Token、成本和安全，并保留分母与版本。

⑤ Pi 的 `AgentEvent` 描述循环，`AgentSessionEvent` 描述产品生命周期；Extension Hook 还能改变行为。

⑥ `pi-telemetry` 提供 Context 和 Schema 统一词汇，但 Schema 不是自动采集器，也不等于完整 Trace。

⑦ Eval 包含 Task、Trial、Outcome、Grader 和 Suite：先定义成功，再运行真实 Agent 并保存证据。

⑧ Code Grader 查确定性条件，Human 判断复杂质量，LLM Judge 扩展语义评价；三者组合更可靠。

⑨ Pi Evals 在隔离 Session 中运行任务，保存 Artifact，并让 Baseline 与 Candidate 成对比较。

⑩ Harness Engineering 是观测、归因、改进、回归和发布的闭环。十八章最终汇成一句：Agent 质量来自整个运行系统。

## 事实锚点

- 最终结果评分与执行轨迹评分应分开保存。
- 一次成功不能说明稳定性；评测应包含多次 Trial 和真实分布。
- Telemetry Schema 统一字段语义，不自动产生完整 Instrumentation。
