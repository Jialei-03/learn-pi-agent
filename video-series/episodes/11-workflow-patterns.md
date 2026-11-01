# Workflow Patterns：把多个 Agent 节点连接起来：讲述索引

正文与源码以[本章课程](../../docs/11-workflow-patterns.md)为准。以下是按正文顺序组织的讲述提纲，配图沿用正文引用的 Mox 资产。

1. 节点首先要有契约
2. 串行与路由
3. 并行的前提是没有写入冲突
4. Orchestrator–Workers
5. Evaluator–Optimizer
6. 运行证据
7. 并行工作者为何仍需要外层约束

录制时先展示具体问题，再沿源码摘录解释数据与调用关系；示意图说明关系，代码字段和异常分支以正文为准。
