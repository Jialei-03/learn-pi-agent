# Observability 与 Evaluation：怎样用证据改进 Pi：讲述索引

正文与源码以[本章课程](../../docs/18-observability-evaluation-and-harness-engineering.md)为准。以下是按正文顺序组织的讲述提纲，配图沿用正文引用的 Mox 资产。

1. 不同证据回答不同问题
2. Agent 与 Session 事件
3. 从任务到 Grader
4. Pi 的文档效果比较
5. 隔离和信息泄漏
6. 单元测试与真实模型评测
7. 把整套 Pi 放回一张图
8. 一项 Harness 修改怎样进入比较

录制时先展示具体问题，再沿源码摘录解释数据与调用关系；示意图说明关系，代码字段和异常分支以正文为准。
