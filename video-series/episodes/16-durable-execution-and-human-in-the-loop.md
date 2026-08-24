# Learn Pi Agent 16｜任务中断以后，怎样从正确的位置继续

- 对应课程：第 16 章
- 核心问题：一个后台 Agent 怎样跨进程、跨重启、跨人工等待继续运行？
- 核心结论：Durable Execution 要持久化状态与程序位置，并为外部副作用设计幂等、查询和补偿；Human-in-the-loop 是可恢复状态机的一段控制流。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 运行在中断点暂停后恢复 | ① |
| 06–15s | `02-background-vs-durable.png` | 后台进程与持久化运行对照 | ② |
| 15–24s | `03-four-persistence-levels.png` | 历史、快照、操作状态、事件逐层增强 | ③ |
| 24–33s | `04-state-machine-checkpoint.png` | 状态与 program counter 一起写入 | ④ |
| 33–42s | `05-retry-resume-replay-restart.png` | 四个动作走向不同起点 | ⑤ |
| 42–51s | `06-effect-sandwich.png` | 意图—外部动作—结算夹层 | ⑥ |
| 51–60s | `07-idempotency-compensation.png` | 幂等键、查询、补偿三条路径 | ⑦ |
| 60–69s | `08-human-in-the-loop.png` | waiting→decision→revalidate→execute | ⑧ |
| 69–78s | `09-pi-three-layers.png` | Session、Harness scaffold、目标规范分层 | ⑨ |
| 78–87s | `10-durable-blueprint.png` | Worker、Store、Queue、Approval、Telemetry 装配 | ⑩ |

## 连续口播稿

① Agent 在后台跑了十分钟，重启后能继续吗？不能的话，它只是 Background，不是 Durable。

② Background 不占当前请求；Durable 在进程消失后仍知道做过什么、从哪继续、什么不能重复。

③ 消息历史保存对话，快照保存数据，操作状态再保存程序位置，事件历史用事件重建状态。

④ Durable Run 是持久化状态机；Checkpoint 要保存状态、程序位置、待执行动作、预算和版本。

⑤ Retry 重做步骤，Resume 从检查点继续，Replay 重演历史，Restart 从新运行开始。

⑥ 外部副作用最危险：先写意图，再执行，最后写结果；进程可能在动作完成、结果落盘前崩溃。

⑦ 不要轻易承诺 exactly once；更可靠的是幂等键、状态查询、去重和补偿。

⑧ Human-in-the-loop 也是状态机：保存具体动作，等待决定，重新验证，再执行或结束。

⑨ Pi 的 Session 可恢复消息，Harness 还有 API 骨架，文档描述更完整目标；三层不能混为现状。

⑩ 后台系统还需要 Queue、Lease、Heartbeat、Store、取消和 Telemetry。下一章进入安全边界。

## 事实锚点

- Background execution 不自动提供跨进程恢复。
- 没有 Tool Result 不能证明外部动作没有发生。
- 人工批准后若参数、主体或环境变化，恢复前仍要重新验证。
