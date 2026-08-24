# Learn Pi Agent 03｜Agent Loop 到底什么时候继续，什么时候停止

- 对应课程：第 3 章
- 核心问题：Pi 怎样把一次次模型响应变成可观察、可取消、可停止的运行？
- 核心结论：Agent Loop 是由 Context、配置、消息写回、工具批次和停止规则共同驱动的状态机；模型信号只是其中一个输入。
- 无声分镜基准：82 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 循环箭头与停止标记同时出现 | ① |
| 06–15s | `02-run-turn-message.png` | Run、Turn、Message 逐层展开 | ② |
| 15–24s | `03-context-and-config.png` | Context 与 Config 从两侧进入循环 | ③ |
| 24–34s | `04-two-message-arrays.png` | 同一消息同时流向两份集合 | ④ |
| 34–44s | `05-partial-to-final.png` | delta 拼成最终消息 | ⑤ |
| 44–54s | `06-two-loops-and-queues.png` | 内外两层循环与队列切换 | ⑥ |
| 54–64s | `07-loop-state-machine.png` | 状态节点按条件点亮 | ⑦ |
| 64–73s | `08-stop-reason-vs-run-control.png` | 模型信号和 Runtime 决策分屏 | ⑧ |
| 73–82s | `09-complete-control-chain.png` | 完整控制链从输入走到结束 | ⑨ |

## 连续口播稿

① Agent Loop 看起来只是一个 `while`。真正困难的是更新哪份状态、工具后怎样继续，以及谁决定停止。

② Message 是一条记录；Turn 包含一次模型响应和工具阶段；Run 则跨越多个 Turn，直到本次任务结束。

③ Pi 的循环接收 `AgentContext` 和配置：前者保存当前消息，后者提供模型、工具、信号与执行钩子。

④ Context 让下一轮立刻看到最新历史；`newMessages` 只记录本次 Run 的增量，便于返回、渲染和持久化。

⑤ 流式 delta 用于实时界面，完成后才形成稳定的 Assistant Message 并进入上下文。

⑥ 内层循环处理模型和工具；外层在 Turn 边界消费 steering 或 follow-up，避免破坏正在执行的工具批次。

⑦ 整体是一台状态机：准备、生成、执行、写回、再循环，每次转移都有明确条件。

⑧ `toolUse` 只停止模型生成并请求工具；`error` 和 `aborted` 结束当前 Run；Runtime 还能按工具或宿主策略停止。

⑨ 所以模型给出停止信号，Runtime 才做运行决定。下一章，我们拆开工具执行这条最重要的边界。

## 事实锚点

- `newMessages` 是本次运行的增量；`currentContext.messages` 是下一次模型调用所需的当前视图。
- `toolUse` 停止本次模型生成，但通常要求 Agent Loop 继续执行工具。
- 事件流用于观察运行过程，不是另一份应被当作会话真相的消息历史。
