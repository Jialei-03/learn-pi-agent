# Learn Pi Agent 11｜六种 Workflow Pattern，一张图讲清

- 对应课程：第 11 章
- 核心问题：面对不同任务结构，怎样选择合适的 Workflow Pattern？
- 核心结论：先定义 Node、Contract、State、Transition 和 Gate，再按依赖、并发、反馈和停止方式选择 Chaining、Routing、Parallel、Orchestrator-Workers、Evaluator-Optimizer 或 Loop。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 六种图形快速排开 | ① |
| 06–15s | `02-six-patterns.png` | 六种 Pattern 定位到不同问题 | ② |
| 15–24s | `03-node-contract.png` | 输入、输出、状态、Gate 装配节点 | ③ |
| 24–33s | `04-prompt-chaining.png` | 结果沿单链传递 | ④ |
| 33–42s | `05-routing.png` | 输入被分到不同专用路径 | ⑤ |
| 42–51s | `06-parallelization.png` | Sectioning 与 Voting 分屏 | ⑥ |
| 51–60s | `07-orchestrator-workers.png` | 动态拆分后 fan-out/fan-in | ⑦ |
| 60–69s | `08-evaluator-optimizer.png` | 生成—评价—改进形成闭环 | ⑧ |
| 69–78s | `09-loop-and-composition.png` | 多 Pattern 组合并标出硬上限 | ⑨ |
| 78–87s | `10-choose-and-summary.png` | 依据任务结构选择 | ⑩ |

## 连续口播稿

① Workflow Pattern 不是六个流行词，而是不同的依赖和控制结构。先看任务，再选图形。

② 常见六种是 Chaining、Routing、Parallel、Orchestrator-Workers、Evaluator-Optimizer 和 Loop。

③ 先定义共同骨架：Node 的输入输出、State、Transition，以及负责校验、批准或终止的 Gate。

④ Chaining 适合明确依赖，例如先提取事实再写摘要；每段都应有结构化契约。

⑤ Routing 把不同输入交给不同路径。模型路由更灵活，但必须有默认分支和运行时校验。

⑥ Parallel Sectioning 拆分独立子任务；Voting 重复求解同一问题再聚合。前者分工，后者冗余。

⑦ Orchestrator 动态拆任务，再 fan-out 和 fan-in；要限制 Worker、Context、预算和取消传播。

⑧ Evaluator-Optimizer 反复生成、评价和改进；评价标准最好绑定测试或外部证据。

⑨ Loop 必须有轮次、预算、进展检测和退出条件；实际系统常组合多种 Pattern。

⑩ 选择时看依赖、并行性、动态拆分和可验证反馈。下一章，看 Reasoning 与 Planning 怎样配合。

## 事实锚点

- Sectioning 与 Voting 都用并行，但前者拆任务、后者重复求解同一任务。
- Evaluator 只有在评价标准可靠时才有价值。
- 所有循环都需要硬上限和可观察的停止条件。
