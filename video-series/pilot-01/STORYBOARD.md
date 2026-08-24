---
format: 1080x1920
duration: 80s
message: "Agent 不是更聪明的一次回答，而是由宿主持续组织模型、状态和工具的一段运行"
arc: concept-explainer with process
audience: Agent 初学者
mode: autonomous
music: none
captions: estimated-until-user-recording
---

## Video direction

- Palette: `#F7F5F0` 纸张底、`#171717` 主信息、`#FF7A00` 唯一强调色；暖黑代码面只在说明程序边界时使用。
- Type: 中文标题使用 Noto Serif SC / 思源宋体回退，正文使用 Noto Sans SC / 微软雅黑回退，代码与编号使用 JetBrains Mono / Consolas 回退。
- Motion: 所有信息按口播短语逐项出现，使用 `power3` 长尾减速；动作用 SVG 自绘、逐项揭示、集群展开和关键词标记完成。
- Rhythm: Frame 2 与 Frame 5 留出稳定阅读时间；Frame 4 是全片动作密度最高的核心循环；Frame 8 收束并静止。
- Layout: 主要内容放在上方约 83% 的安全区，底部字幕区不放关键节点；Mox 只在需要“演示、执行、判断”时出现。
- Avoid: 不整页前置、不循环呼吸、不在后半段持续推镜、不使用蓝紫 AI 渐变、不让无关元素各自漂浮。

## Frame 1 — 一次回答还不够

- scene: “回答问题”与“完成任务”从同一个模型图标分叉，后者展开成查资料、用工具、保存进度三项动作。
- voiceover: "大模型很会回答问题。但查资料、用工具、保存进度，再继续判断——一次回答还不够。"
- duration: 8s
- poster: 6.5s
- transition_in: cut
- status: animated
- type: hook
- persuasion: Common-belief vs reality + rule of three
- beat: curiosity + recognition
- blueprint: compose
- focal: “回答”与“完成”两个动词的尺度反差
- roles: 模型圆点 = foreground subject · 三张动作卡 = supporting · 纸张网格 = background

narrativeRole: 从观众熟悉的模型问答切入，立刻建立“回答”和“完成”的差距。
keyMessage: 能生成答案，不等于能持续完成任务。

Scene 1 (0.0–2.0s): 顶部系列编号与“模型会回答”逐词出现（`dynamic-content-sequencing`）；Centered，标题占画面上半部。
Scene 2 (2.0–4.6s): “回答”固定在左，“完成”在右侧放大并被橙色手绘圈标记（`css-marker-patterns`）；上下错位的双焦点构图。
Scene 3 (4.6–8.0s): 查资料、用工具、存进度三张窄卡依次从“完成”下方展开（`center-outward-expansion`），Mox 从右下角探头；最后 1 秒静止阅读。

## Frame 2 — 一次模型调用

- scene: 一条从输入到模型再到输出的单向链，输出落下后出现“本次调用结束”。
- voiceover: "一次模型调用很简单：宿主准备输入，模型生成响应，宿主接收结果。响应回来，这次调用就结束了。"
- duration: 9s
- poster: 7.5s
- transition_in: crossfade
- status: animated
- type: product_intro
- persuasion: Progressive disclosure + causal chain
- beat: orientation
- blueprint: compose
- focal: 输入 → 模型 → 响应的单向箭头
- roles: 三个节点 = foreground subject · 步骤编号 = supporting · 细网格与页码 = background

narrativeRole: 给“模型调用”画出清晰边界，为后面的循环建立对照。
keyMessage: 模型调用是一问一答；宿主在调用前后负责准备和接收。

Scene 1 (0.0–2.4s): 输入卡从上方进入，编号 ① 与“准备输入”同步出现（`waterfall-entry`）；纵向全宽带。
Scene 2 (2.4–5.2s): 模型节点出现，连接线从输入向下自绘（`svg-path-draw`），编号 ② 落下；中心轴构图。
Scene 3 (5.2–7.6s): 响应卡出现，第二段连接线自绘，编号 ③ 落下；三节点占满上方 75%。
Scene 4 (7.6–9.0s): 底部橙色“本次调用结束”状态条横向填充（`stat-bars-and-fills`），其余内容完全静止。

## Frame 3 — Tool Call 只是请求

- scene: 模型写出 Tool Call，卡片先停在“请求”一侧；宿主接过卡片后，真实工具才亮起。
- voiceover: "模型写出 Tool Call，动作还没有发生。它只是在提出结构化请求；真正执行工具的，是模型外面的宿主程序。"
- duration: 9s
- poster: 7.4s
- transition_in: push-slide UP
- status: animated
- type: pain_point
- persuasion: Subtractive framing + before/after
- beat: surprise + clarity
- blueprint: compose
- focal: 从“请求”跨过宿主边界到“执行”的橙色交接
- roles: Tool Call 卡 = foreground subject · 宿主边界线 = supporting · 工具图标 = supporting · 暖黑代码面 = background anchor

narrativeRole: 纠正“模型说要调用工具，所以工具已经运行”的常见误解。
keyMessage: 模型提出动作；宿主授权并执行动作。

Scene 1 (0.0–2.8s): 暖黑代码卡逐行打出 `toolCall: get_weather`（`discrete-text-sequence`）；卡片停在左上。
Scene 2 (2.8–5.4s): 一条竖向宿主边界自绘，橙色“请求”标签落在边界左侧；Tool Call 卡向边界移动后停住。
Scene 3 (5.4–7.5s): Mox 在边界右侧接过请求，右肩 X 模块闪一次；“校验 / 允许”两个词依次出现（`asr-keyword-glow`）。
Scene 4 (7.5–9.0s): 真实工具图标由灰变黑，橙色状态点亮；“执行”只在这一刻出现并保持。

## Frame 4 — Agent Loop

- scene: Context、模型、Tool Call、工具、Tool Result 构成一圈；每个节点只在口播点名时亮起，最终从循环旁边分出回答。
- voiceover: "Agent 的关键，是把单次调用变成循环：模型提出 Tool Call，Runtime 校验并执行工具，把 Tool Result 写回 Context，再让模型继续判断，直到得到最终回答。"
- duration: 14s
- poster: 12.1s
- transition_in: zoom-through
- status: animated
- type: feature_showcase
- persuasion: Causal chain + progressive disclosure
- beat: comprehension + aha
- blueprint: compose
- focal: 一圈逐段点亮的 Agent Loop
- roles: 五个循环节点 = foreground subject · Runtime 中心章 = supporting · 最终回答分支 = supporting · 纸张刻度 = background

narrativeRole: 展示 Agent 相对于一次调用新增的控制循环，也是整章最核心的机制图。
keyMessage: Tool Result 回到 Context，下一次模型调用才有继续判断的依据。

Scene 1 (0.0–2.5s): Context 与模型两个节点进入，第一段橙色路径自绘（`svg-path-draw`）；竖屏上半部形成大环。
Scene 2 (2.5–5.2s): Tool Call 卡在模型右侧弹出，中心 Runtime 章出现“校验”（`spring-pop-entrance`，无过冲）；路径走向工具。
Scene 3 (5.2–8.3s): 工具节点亮起，Mox 的肩部 X 模块标记一次执行；随后 Tool Result 卡从工具下方出现。
Scene 4 (8.3–11.4s): Tool Result 沿回程路径进入 Context，Context 中新增一行记录；闭环完成（`svg-path-draw`）。
Scene 5 (11.4–14.0s): 模型再次判断，从循环左侧分出“最终回答”卡；循环退为细线，答案成为主焦点并静止。

## Frame 5 — 四种运行数据

- scene: Message 是单张记录；多条 Message 被挑选为 Context；Context 连同控制数据组成 State；Session 在外层保存多轮 State 的历史路径。
- voiceover: "这里有四个不同对象：Message 是一条记录；Context 是本轮给模型的输入快照；State 是运行中的完整数据；Session 保存跨越多轮的历史。"
- duration: 13s
- poster: 11.2s
- transition_in: crossfade
- status: animated
- type: feature_showcase
- persuasion: Frame-then-fill + progressive disclosure
- beat: mastery
- blueprint: compose
- focal: 从 Message 逐层扩展到 Session 的嵌套关系
- roles: Message 卡片 = foreground subject · Context 夹板 = foreground subject · State 边框 = supporting · Session 时间轴 = supporting · 页纸纹理 = background

narrativeRole: 让学生第一次看清 Message、Context、State、Session 不是四个同义词，而是不同层级的数据对象。
keyMessage: Context 是本轮快照；State 与 Session 承担更大的运行和历史范围。

Scene 1 (0.0–2.5s): 单张 Message 卡进入并显示 `role + content`；左上角标记“一条记录”。
Scene 2 (2.5–5.5s): 另外三张 Message 依次出现，其中两张滑入橙色边框的 Context 夹板（`center-outward-expansion`）；“本轮输入快照”同步揭示。
Scene 3 (5.5–8.8s): State 大边框从 Context 外侧展开，旁边补入轮次、取消信号和工具状态三枚小标签（`anchored-layout-expand`）。
Scene 4 (8.8–11.4s): Session 时间轴在最外层向下延伸，出现 Turn 1、Turn 2、Turn 3 三个节点；当前 State 固定在 Turn 3。
Scene 5 (11.4–13.0s): 四个名称沿右侧纵向对齐，橙色箭头从小到大扫过一次，随后静止阅读。

## Frame 6 — 谁决定停止

- scene: 模型给出 stopReason；Runtime 把它与内容、错误、取消、超时和轮次上限一起放进停止判断器。
- voiceover: "模型只能返回 stop reason。整段运行是否继续，由 Runtime 结合响应内容、错误、取消、超时和轮次上限来决定。"
- duration: 10s
- poster: 8.3s
- transition_in: push-slide UP
- status: animated
- type: benefit_highlight
- persuasion: Comparison of two responsibilities + causal chain
- beat: clarity + confidence
- blueprint: compose
- focal: “模型信号”进入“Runtime 决策”的漏斗
- roles: stopReason 芯片 = foreground subject · 五个宿主条件 = supporting · 继续/停止分支 = foreground subject · 判断器 = background anchor

narrativeRole: 精确区分模型的停止信号与宿主对整段 Agent 运行的最终控制。
keyMessage: 模型提供信号，Runtime 决定运行边界。

Scene 1 (0.0–2.4s): 模型节点吐出 `stopReason` 芯片，橙色小注标记“信号”；左上区域留白明确。
Scene 2 (2.4–6.2s): 内容、错误、取消、超时、轮次上限五张小卡按口播依次进入 Runtime 判断器（`grid-card-assemble` 思路，以逐项揭示实现）。
Scene 3 (6.2–8.4s): 判断器分成“继续下一轮”和“停止本次运行”两条粗路径，橙色信号沿两条路径分别试走一次。
Scene 4 (8.4–10.0s): “模型给信号 / Runtime 作决定”上下对照锁定，后一行获得唯一橙色标记并静止。

## Frame 7 — Harness 装配完整系统

- scene: Runtime 在中心，模型连接、Tools、Session、执行环境和界面依次围拢，最后外框标注 Harness。
- voiceover: "Harness 再把模型连接、Runtime、工具、Session、执行环境和界面装配到一起。我们看到的 Agent 产品，通常是这套完整系统。"
- duration: 10s
- poster: 8.4s
- transition_in: blur-crossfade
- status: animated
- type: benefit_highlight
- persuasion: Concretization + layer reveal
- beat: integration + foresight
- blueprint: compose
- focal: 围绕 Runtime 组装的 Harness 系统盒
- roles: Runtime 中心卡 = foreground subject · 五个模块 = supporting · Harness 外框 = foreground subject · Mox = supporting guide

narrativeRole: 把 Runtime 放回完整产品环境，建立后续模型 API、Tools、Session、MCP、Skills 和 Extensions 的位置感。
keyMessage: Agent 产品不只有循环；Harness 负责把运行所需的部件装配成系统。

Scene 1 (0.0–2.0s): Runtime 中心卡和 Mox 出现；顶部写“运行核心”。
Scene 2 (2.0–6.4s): 模型连接、Tools、Session、执行环境、界面五个模块按口播从四周接入（`center-outward-expansion` 反向应用为 inward assembly），连接线逐条自绘。
Scene 3 (6.4–8.2s): 一圈 Harness 外框从左上角开始绘制并闭合（`svg-path-draw`），模块名称保持可读。
Scene 4 (8.2–10.0s): 外框上方出现“完整 Agent 系统”，Mox 顶灯亮一次；画面稳定收束。

## Frame 8 — 记住这条主线

- scene: “一次调用 → Agent Loop → Harness”三段主线压缩成一条竖向路径，Mox 在终点举起下一章卡片。
- voiceover: "所以，Agent 不是更聪明的一次回答，而是一段被程序持续推动的运行。下一章，我们看不同模型 API 怎样表达同一条消息链。"
- duration: 7s
- poster: 5.7s
- transition_in: crossfade
- status: animated
- type: branding
- persuasion: Distillation + callback
- beat: satisfaction + anticipation
- blueprint: compose
- focal: “一次调用 → 运行循环 → 完整系统”的三段主线
- roles: 三段路径 = foreground subject · 结论 = foreground subject · 下一章卡片 = supporting · Mox = supporting guide

narrativeRole: 用一句可以复述的结论收束第一章，并自然引出第二章。
keyMessage: Agent 的核心差异是持续运行与系统控制，而不只是模型能力。

Scene 1 (0.0–2.3s): 一次调用、Agent Loop、Harness 三个词沿竖向路径逐项落下，连接线同步自绘。
Scene 2 (2.3–4.8s): 三项缩成一枚“持续运行”章，结论逐词出现（`dynamic-content-sequencing`）；保持全片最大字号。
Scene 3 (4.8–7.0s): Mox 从右下角探头并举起“02 模型 API 与消息协议”小卡；其余元素静止，橙色页码点亮。
