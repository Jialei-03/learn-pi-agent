# Learn Pi Agent 05｜真正影响 Agent 的，不只是一条 Prompt

- 对应课程：第 5 章
- 核心问题：为什么同一个模型接入不同 Harness，会表现得像不同的 Agent？
- 核心结论：模型每轮看到的是由指令、历史、工具、检索结果和运行状态组成的 Context 快照；Context Engineering 决定如何选择、组织、隔离和压缩这些信息。
- 无声分镜基准：82 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 单条 Prompt 扩展成多层 Context | ① |
| 06–15s | `02-context-snapshot.png` | 多个来源汇成本轮快照 | ② |
| 15–24s | `03-prompt-vs-context.png` | Prompt 与 Context 边界对照 | ③ |
| 24–34s | `04-pi-context-assembly.png` | Pi 的上下文来源依次装配 | ④ |
| 34–44s | `05-dynamic-context.png` | 每轮 Context 随状态改变 | ⑤ |
| 44–54s | `06-trust-and-injection.png` | 可信指令和不可信内容分区 | ⑥ |
| 54–64s | `07-token-budget.png` | Token 预算在不同区域重新分配 | ⑦ |
| 64–73s | `08-structured-output.png` | Schema 约束输出形状 | ⑧ |
| 73–82s | `09-provider-and-pi.png` | Provider 限制与 Pi 转换层对接 | ⑨ |

## 连续口播稿

① 很多人优化 Agent 时只改 Prompt，但模型真正接收的是一整个 Context。

② Context 是本轮输入快照：指令、历史、工具、结果、检索内容和当前任务状态都可能在里面。

③ Prompt 是一段指令；Context Engineering 决定哪些信息进入、如何排序、占多少预算，以及怎样标记来源。

④ 在 Pi 中，系统提示、项目指令、Skill、会话消息、工具和 Extension 会在不同边界进入输入。

⑤ Context 不是 Session 的完整副本。每轮都可重新投影：去掉噪声，加入新结果，保留必要证据。

⑥ 网页、仓库和 Tool Result 可能包含恶意指令。运行层必须保留来源，并限制不可信内容能影响的动作。

⑦ Context Window 是硬预算。优先保留目标、约束、未完成动作和证据，再检索或压缩较远历史。

⑧ Structured Output 用 Schema 约束输出形状，方便解析；它不证明内容真实，也不构成授权。

⑨ Provider 能力不同，Pi 的适配层负责转换。下一章，我们继续看长期历史和记忆放在哪里。

## 事实锚点

- Context 是一次调用的输入快照，Session 是跨多轮交互的组织边界。
- Structured Output 约束语法或结构，不验证事实正确性。
- 不可信内容进入 Context 后，不能自动获得与系统指令相同的权限。
