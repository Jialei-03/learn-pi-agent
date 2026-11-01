# 执行环境：工具的动作到底在哪里发生：讲述索引

正文与源码以[本章课程](../../docs/15-sandbox-code-agent-and-computer-use.md)为准。以下是按正文顺序组织的讲述提纲，配图沿用正文引用的 Mox 资产。

1. Shell 子进程怎样启动
2. `cwd` 的作用
3. 替换 Operations
4. 整体隔离与局部隔离
5. Tool Gate 与 Sandbox
6. Computer Use 的动作循环
7. 输出截断与动作状态

录制时先展示具体问题，再沿源码摘录解释数据与调用关系；示意图说明关系，代码字段和异常分支以正文为准。
