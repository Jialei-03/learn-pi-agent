# Learn Pi Agent 12｜模型“会思考”，不等于系统“有计划”

- 对应课程：第 12 章
- 核心问题：Reasoning、Planning、Reflection 和 Plan Mode 分别解决什么？
- 核心结论：模型内部推理、Provider 返回的 thinking、可执行计划和 Harness 控制流是不同层；可靠规划需要显式状态、验证、反馈和执行边界。
- 无声分镜基准：87 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 思考气泡与计划清单分离 | ① |
| 06–15s | `02-four-layers.png` | 推理、说明、计划、控制流四层展开 | ② |
| 15–24s | `03-pi-reasoning.png` | `thinkingLevel`、content、event 分层 | ③ |
| 24–33s | `04-react-loop.png` | 行动与观察交替推进 | ④ |
| 33–42s | `05-plan-and-execute.png` | Planner 与 Executor 分工 | ⑤ |
| 42–51s | `06-plan-validation.png` | 计划经过依赖、权限、完成标准检查 | ⑥ |
| 51–60s | `07-reflection-family.png` | Critic、Self-Refine、Reflexion 区分 | ⑦ |
| 60–69s | `08-self-consistency.png` | 多条采样路径汇总 | ⑧ |
| 69–78s | `09-tree-of-thoughts.png` | 候选树扩展、评分、剪枝 | ⑨ |
| 78–87s | `10-plan-mode-summary.png` | 只读计划、批准、执行三段式 | ⑩ |

## 连续口播稿

① 模型列出一二三步，就有 Planning 系统了吗？不一定。写出计划，不等于运行时保存并执行它。

② 至少分四层：内部推理、可见说明、可校验的计划数据，以及 Harness 的真实控制流。

③ Pi 的 `thinkingLevel` 是配置，`ThinkingContent` 是内容类型，thinking event 是增量事件；都不自动成为计划状态。

④ ReAct-like Loop 在行动和观察间决策：选 Tool，看到真实结果，再决定下一步。

⑤ Plan-and-Execute 先生成显式计划，再逐步执行；计划应有 ID、依赖、完成标准和状态。

⑥ 执行前检查完整性、权限和依赖；不能只凭模型一句“完成了”就标记成功。

⑦ Critic 负责评价，Self-Refine 在当前任务内改写，Reflexion 把反馈留给后续尝试；都需要真实证据。

⑧ Self-Consistency 采样多条路径再聚合，能降低偶然错误，但多数票仍可能一起犯错。

⑨ Tree of Thoughts 显式扩展、评分和剪枝候选；成本来自搜索宽度和评价质量。

⑩ Plan Mode 限制只读能力，生成并校验计划，批准后再执行具体动作。下一章进入 Agent SDK。

## 事实锚点

- Provider 返回的 thinking 内容不是可直接视作完整、忠实的内部因果解释。
- 可执行计划需要机器可读状态和外部完成判断。
- 批准一份计划不自动批准以后所有具体工具参数。
