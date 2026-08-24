# Learn Pi Agent 06｜Session、Memory 和 RAG 到底有什么区别

- 对应课程：第 6 章
- 核心问题：长任务中的历史、状态、记忆和检索应该分别放在哪里？
- 核心结论：Session 组织交互历史，State 表示当前运行数据，Memory 保存可跨时使用的信息，Retrieval 负责取回，Compaction 缩短历史；它们都不自动等于可恢复执行。
- 无声分镜基准：82 秒；真人录音后按自然语速重定时

## 分镜

| 时间 | 对应小红书卡片 | 动画重点 | 口播 |
| --- | --- | --- | --- |
| 00–06s | `01-cover.png` | 六个概念从混乱标签变成分区 | ① |
| 06–15s | `02-six-concepts.png` | Context、State、Session 等逐个定位 | ② |
| 15–24s | `03-jsonl-session-tree.png` | JSONL 节点长成消息树 | ③ |
| 24–34s | `04-tree-fork-clone.png` | 分支、fork、clone 三种路径分开 | ④ |
| 34–44s | `05-session-to-context.png` | 历史经过投影进入本轮 Context | ⑤ |
| 44–54s | `06-compaction.png` | 长历史压缩为摘要和保留区 | ⑥ |
| 54–64s | `07-memory-and-rag.png` | 写入、索引、检索、注入形成闭环 | ⑦ |
| 64–73s | `08-durable-execution.png` | Session 保存与程序恢复边界分开 | ⑧ |
| 73–82s | `09-summary.png` | 六个概念回到各自位置 | ⑨ |

## 连续口播稿

① Context、Session、Memory、RAG、Compaction、Checkpoint 经常混在一起，其实它们回答不同问题。

② Context 是本轮输入；State 是当前数据；Session 组织交互；Memory 保存可复用信息；Retrieval 负责找回；Checkpoint 面向恢复。

③ Pi Session 可用 JSONL 保存消息和分支。它记录发生过什么，不表示所有历史都要进入下一轮 Context。

④ 消息树允许回到旧节点、创建分支或克隆会话；分支历史不等于另一个独立 Agent。

⑤ 每次调用前，Harness 从 Session 和 State 选择必要内容，生成可以随轮次变化的 Context 投影。

⑥ 历史超预算时，Compaction 压缩较远内容，同时保留近期消息、未完成任务和关键约束。

⑦ Memory 与 RAG 还要选择信息、建立索引、按需检索，再把带来源的结果注入 Context。

⑧ 保存 Session 不等于 Durable Execution。安全续跑还要保存程序位置、待执行动作和副作用信息。

⑨ 本轮输入叫 Context，跨轮组织叫 Session，长期复用叫 Memory，按需查找叫 Retrieval。下一章进入 MCP。

## 事实锚点

- Session 历史可以用于构造 Context，但二者不是同一个对象。
- RAG 是取回并注入相关信息的机制，不自动等于长期个性化 Memory。
- 消息持久化不足以恢复一个带外部副作用的运行。
