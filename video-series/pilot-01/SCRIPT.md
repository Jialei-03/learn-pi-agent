# SCRIPT — Learn Pi Agent 01

**Voice:** 用户后期录音
**Voice settings:** 待录音后按真实语速重新同步
**Voice direction:** 像老师面对初学者讲清一张运行图；自然、准确、不过度营销。概念之间留短停顿，英文术语首次出现时略放慢。

---

## Line 1 — 一次回答还不够 (Frame 1)

**Time:** 0.0 – 8.0s
**Delivery:** 先认可大模型，再在“还不够”处轻微转折。

    大模型很会回答问题。但查资料、用工具、保存进度，再继续判断——一次回答还不够。

## Line 2 — 一次模型调用 (Frame 2)

**Time:** 8.0 – 17.0s
**Delivery:** 三个步骤读得清楚、均匀。

    一次模型调用很简单：宿主准备输入，模型生成响应，宿主接收结果。响应回来，这次调用就结束了。

## Line 3 — Tool Call 只是请求 (Frame 3)

**Time:** 17.0 – 26.0s
**Delivery:** 强调“还没有发生”和“宿主程序”。

    模型写出 Tool Call，动作还没有发生。它只是在提出结构化请求；真正执行工具的，是模型外面的宿主程序。

## Line 4 — Agent Loop (Frame 4)

**Time:** 26.0 – 40.0s
**Delivery:** 按 Tool Call、Runtime、Tool Result、Context 四个节点逐步推进。

    Agent 的关键，是把单次调用变成循环：模型提出 Tool Call，Runtime 校验并执行工具，把 Tool Result 写回 Context，再让模型继续判断，直到得到最终回答。

## Line 5 — 四种运行数据 (Frame 5)

**Time:** 40.0 – 53.0s
**Delivery:** 每个术语后留短停顿，让画面完成一层扩展。

    这里有四个不同对象：Message 是一条记录；Context 是本轮给模型的输入快照；State 是运行中的完整数据；Session 保存跨越多轮的历史。

## Line 6 — 谁决定停止 (Frame 6)

**Time:** 53.0 – 63.0s
**Delivery:** “模型只能返回”与“Runtime 决定”形成责任对照。

    模型只能返回 stop reason。整段运行是否继续，由 Runtime 结合响应内容、错误、取消、超时和轮次上限来决定。

## Line 7 — Harness (Frame 7)

**Time:** 63.0 – 73.0s
**Delivery:** 模块名清楚，结尾回到完整系统。

    Harness 再把模型连接、Runtime、工具、Session、执行环境和界面装配到一起。我们看到的 Agent 产品，通常是这套完整系统。

## Line 8 — 记住主线 (Frame 8)

**Time:** 73.0 – 80.0s
**Delivery:** 结论落稳，下一章语气轻轻抬起。

    所以，Agent 不是更聪明的一次回答，而是一段被程序持续推动的运行。下一章，我们看不同模型 API 怎样表达同一条消息链。
