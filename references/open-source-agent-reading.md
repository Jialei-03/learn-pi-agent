# 高星 Agent 开源资料：从哪一段代码读起

如果你想知道一个 Coding Agent 到底怎样工作，我建议先读一节能放进脑子里的教学实现，再找一个成熟项目，拿相同的输入比较它们的行为。以下五个项目分别回答不同的问题。星数来自 2026-11-02 查询的 GitHub 仓库数据，是整个项目的关注度；选入哪一节，依据是能否找到具体输入、实现或检验结果。

| 项目 | GitHub Stars（约） | 类型 | 建议直接打开 |
| --- | --- | --- | --- |
| [Learn Claude Code](https://github.com/shareAI-lab/learn-claude-code) | 79.8k | 有中文的自建 Harness 教程 | [第 8 课：上下文压缩](https://github.com/shareAI-lab/learn-claude-code/blob/main/s08_context_compact/README.zh.md) |
| [Aider](https://github.com/Aider-AI/aider) | 49.9k | 实际编码工具，适合源码对读 | [SEARCH/REPLACE 的匹配实现](https://github.com/Aider-AI/aider/blob/main/aider/coders/editblock_coder.py#L134-L183) |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 44.3k | 图执行框架，适合读恢复测试 | [一个并行节点失败后从哪里继续](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_pregel.py#L891-L988) |
| [Hello-Agents](https://github.com/datawhalechina/hello-agents) | 85.8k | 中文系统教材，附实验代码 | [第 12 章：智能体性能评估](https://github.com/datawhalechina/hello-agents/blob/main/docs/chapter12/%E7%AC%AC%E5%8D%81%E4%BA%8C%E7%AB%A0%20%E6%99%BA%E8%83%BD%E4%BD%93%E6%80%A7%E8%83%BD%E8%AF%84%E4%BC%B0.md) |
| [Hugging Face Agents Course](https://github.com/huggingface/agents-course) | 34.3k | 有实际任务和交付格式的课程 | [最终项目：拿 GAIA 题目测自己的 Agent](https://github.com/huggingface/agents-course/blob/main/units/en/unit4/hands-on.mdx) |

## 先读 Learn Claude Code：上下文超预算时，先丢什么

从第 8 课的 Python 文件里找 `ContextCompactor.prepare()`。假设工具刚返回一大段日志。先跟踪这段输出是否能被缩短并从别处找回，再跟踪整份历史是否仍超预算。换成几十个很短的往返回合，总量也可能超限，两种输入却不必经由同一分支。读源码时，把每次调用后留在 messages 的内容写在旁边，比背“上下文压缩”这个名词有效。[中文课文](https://github.com/shareAI-lab/learn-claude-code/blob/main/s08_context_compact/README.zh.md) · [prepare 的执行次序](https://github.com/shareAI-lab/learn-claude-code/blob/main/s08_context_compact/code.py#L518-L545)

这是作者自行实现的教学 Harness。对读 Pi 时可以问一个更窄的问题：摘要产生以后，原先那条工具结果还能从哪里找到？在 Pi 的会话树里，读取日志与构建下一次模型输入是两个操作；一份摘要出现在投影中，不代表旧条目已经从日志里删除。用同一条记录分别观察这两层，就能比较两个系统究竟保存了什么。[Pi 的会话投影实验](../docs/06-session-memory-retrieval-and-compaction.md)

## 再读 Aider：同一个替换请求，两个工具会改到同一处吗

在 Aider 的 `perfect_replace` 中，外层循环从上到下滑过文件的行数组。找到第一段逐行相等的内容，就拼接前缀、替换文本和后缀并返回。拿一个生产配置和开发配置各有一行 `limit=10` 的文件，只给整行作为搜索条件。单看这个精确匹配函数，先出现的生产配置会被替换。这个结论针对该函数及该编辑格式；Aider 还有其他编辑格式，读取本段不能概括所有路径。[选择匹配区间](https://github.com/Aider-AI/aider/blob/main/aider/coders/editblock_coder.py#L134-L183) · [上游编辑块测试](https://github.com/Aider-AI/aider/blob/main/tests/basic/test_editblock.py)

把同一个文件交给 Pi，结果是工具报告有两处匹配，磁盘写入次数为零。将开发配置的上一行也放入 oldText，才会改到预期位置。课程第四章给出这组输入和可运行程序，并进一步检查两个修改区间重叠、字符归一化后出现重复、写入后收到取消这几种情况。研究一个真实编码工具，从这里进入比先罗列它支持多少模型更贴近使用者会碰到的故障。[Pi 编辑工具源码实验](../docs/04-tools-and-function-calling.md#写入实验一次-edit-为什么会被拒绝)

## 读 LangGraph 的失败测试：恢复时哪段工作会重复

先打开 `test_pending_writes_resume`，看两个节点各有一个调用计数器。一个返回更新，另一个抛异常并触发配置好的重试。首次调用失败时，两个计数分别是 1 和 2。保持错误再从相同线程继续，测试断言它们变成 1 和 4。若简单地把整张图重跑，这两个数字都应增加。沿断言往前追 checkpoint 和 pending writes，就能找到“成功节点的结果被留下”具体对应哪一层数据。[测试与断言](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_pregel.py#L891-L988) · [持久化说明](https://docs.langchain.com/oss/python/langgraph/persistence)

对读 Pi 的 Durable 章，要重新确定恢复的对象。图框架能记住某个节点的状态更新，不代表支付服务一定能辨认一次重复请求。把故障点放在“外部动作已经完成、本地结果还没写入”之间，看看任务能凭什么身份查询上一次操作。比较系统时，先写出哪一边拥有事实，再讨论是否安全重跑。[Pi 的任务恢复](../docs/16-durable-execution-and-human-in-the-loop.md)

## 读 Hello-Agents 与 Hugging Face：一条轨迹凭什么得分

Hello-Agents 第 12 章将工具调用评测与完整任务评测分开。它的 BFCL 示例可限制为五个样本，并逐条输出问题、预测值、期望值和是否成功。遇到“模型会选工具，但工具参数经常错”的问题，先看一对预测和期望，把错误定位到工具名、参数名或参数值，比只看总体准确率更直接。[中文评估章](https://github.com/datawhalechina/hello-agents/tree/main/docs/chapter12) · [带逐样本输出的 BFCL 程序](https://github.com/datawhalechina/hello-agents/blob/main/code/chapter12/03_bfcl_custom_evaluation.py)

Hugging Face 的最终项目把目标换成完整任务：课程选取 20 道 GAIA 验证集的一级问题，部分任务需要取附件，提交时将任务编号与最终答案配对。它适合检验“能否独立完成题目”。如果程序提交错答案，仅看得分并不能区分它读错了附件、推理出错，还是提交格式不符。回到 Pi 的轨迹与工具事件，才能找出第一个偏离预期的步骤。[最终项目的输入与交付格式](https://github.com/huggingface/agents-course/blob/main/units/en/unit4/hands-on.mdx) · [Pi 的可观测性与评测](../docs/18-observability-evaluation-and-harness-engineering.md)

## 现有 Pi 课程还缺什么

目前能沿一次确定的请求追到工具和会话，刚补上的文件编辑实验也能检验写入条件。要把这些机制用来开发自己的编码 Agent，还缺三类完整练习：让读者亲手补上一个源码决策并跑回归测试，让同一长任务在固定预算下对比两种上下文策略，以及把真实模型在多道仓库修复题上的补丁、测试结果和费用逐项配对。上面的五份资料分别能提供实现、故障用例和评测方法。这三类练习仍是课程的缺口。
