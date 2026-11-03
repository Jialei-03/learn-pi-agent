# 课程插画需求（交给 Codex 用 Mox 插画 skill 生成）

角色设定以 [assets/MOX-IP.md](../MOX-IP.md)为唯一依据。生成后把 PNG 放到本目录、使用下面给定的文件名，重新运行 `npm run build`，网页里的占位卡片会自动换成图片，不需要改正文。

## 共同要求

- 横幅 3:2，PNG，宽度不小于 1600 px。
- 纯白背景、黑色手绘线条、大量留白；橙色只用于 Mox 头顶的灯、信号线和极少量强调。
- Mox 必须参与画面的核心动作，右肩模块和头顶橙灯要参与表达。
- 画面里的文字只用下面指定的英文标签，不要出现其他文字（中文说明放在网页的图注里）。
- 不是 PPT、不是界面截图、不是信息图。
- 生成后把最终提示词追加到本目录的 `prompts.json`（格式：`[{ "file": "...", "prompt": "..." }]`）。

每张图的提示词都以这段开头：

> Use the provided image only as the visual identity reference for Mox. Create a new educational illustration for a Chinese coding-agent engineering course. Mox is the sole protagonist: rounded white robot (80% white), black oval face with two white eyes, short black hands and feet, tiny orange lamp on its head, compact black module on its right shoulder with a tiny X. Pure WHITE background, expressive black hand-drawn ink outlines, generous negative space, tiny orange signal accents only. Calm, curious, adult editorial illustration; not childish, not a slide, not a screenshot, not a dense infographic. Mox performs the central action using its right shoulder module and head lamp. No ocean or underwater motifs. Wide composition 3:2. Use only the exact English labels specified.

---

## 1. `ch01-harness.png` —— 模型只会说话，程序在做事

- 位置：第 1 章“模型读不到你的文件”一节末尾。
- 要表达：模型不执行任何东西；它只递出一张写着请求的卡片，由程序去执行，再把结果卡片递回去。

> On the left, behind a small service window, a sealed black box labelled 'model' slides out a paper card labelled 'toolCall: read_file'. Mox, standing at a desk in the middle, takes the card with its shoulder arm, opens a file cabinet labelled 'your disk' on the right, pulls out a document, and pushes a new card labelled 'toolResult' back through the window. A dashed loop arrow connects window → Mox → cabinet → window. The black box has no hands and never touches the cabinet. Mox's head lamp glows steadily.

## 2. `ch02-adapters.png` —— 适配器：外面各不相同，里面只有一种格式

- 位置：第 2 章“为什么需要一个内部格式”。
- 要表达：两家服务商的消息形状完全不同，经过各自的转换器后变成同一种卡片，循环只接触统一的卡片。

> Two different pipes enter from the left: the top pipe labelled 'Anthropic' delivers chunky stacked blocks, the bottom pipe labelled 'OpenAI' delivers thin strips of paper. Each pipe ends in a small hand-cranked machine labelled 'adapter'. Out of both machines come identical neat cards labelled 'AssistantMessage', which Mox collects on a single tray and carries toward a round track on the right labelled 'loop'. Mox's shoulder module is plugged into the bottom machine, turning its crank.

## 3. `ch03-four-failures.png` —— 同一个循环的四种坏法

- 位置：第 3 章“让它坏四次”开头。
- 要表达：四个失败都发生在同一个简单循环上，读者能一眼看出每种坏法坏在哪一环。四个小场景必须共用同一个循环形状。

> One simple circular conveyor loop in the centre, operated by Mox. Four small vignettes sit at four points of the same loop. (1) Top-left: a torn paper card labelled 'length' is fed into a machine labelled 'write'; a half-written page drops out; Mox does not notice. (2) Top-right: a wrench labelled 'ENOENT' snaps and the conveyor belt breaks apart at that spot; cards spill; Mox's lamp blinks. (3) Bottom-left: Mox walking the loop like a treadmill, a tiny counter shows 'turn 8', no exit visible, lamp flickering tiredly. (4) Bottom-right: a small human hand outside a closed glass window holds a note labelled 'steer'; Mox inside faces the other way and cannot see it.

## 4. `ch03-guards.png` —— 五个检查点

- 位置：第 3 章“修好它：mox 的 runLoop”开头。
- 要表达：与上一张图**同一个循环形状**，加上五个编号检查点，读者可以直接对照“哪里坏、哪里补”。内层入口和外层入口的位置差别要看得出来。

> The same circular conveyor loop as the previous illustration, now with five small numbered checkpoints, evenly spaced, Mox calmly operating it with a steady lamp. (1) An exit door labelled 'error' where a cracked card leaves the loop. (2) A stamp station labelled 'length' where Mox's shoulder arm stamps torn cards and sends them back unopened instead of into the 'write' machine. (3) A tray under the tool machine catches a broken wrench and turns it into a neat card labelled 'isError' that continues on the belt. (4) A tall lever beside the loop labelled 'finishTurn', held by a human hand entering from outside the frame. (5) Two mail slots: a small one on the inner loop labelled 'steer', and another on a larger outer ring labelled 'followUp'; a note is sliding in through 'steer'.

## 5. `ch04-pipeline.png`

- 位置：第 4 章。
- 图注：一次工具调用经过的六道工序：找到工具、修正参数、校验、执行前钩子、执行、执行后钩子；并行执行，按原来的顺序交回

> A neat horizontal workshop conveyor with six small stations in a row, labelled 'find', 'coerce', 'validate', 'beforeToolCall', 'execute', 'afterToolCall'. Paper cards labelled 'toolCall' enter on the left. At 'validate' one malformed card is diverted onto a side tray labelled 'isError' instead of reaching 'execute'. The 'execute' station has three parallel lanes processing cards at once; after it, Mox's shoulder arm re-sorts the finished cards back into their original numbered order 1, 2, 3 before they leave on the right. Mox's head lamp glows steadily.

## 6. `ch05-edit.png`

- 位置：第 5 章。
- 图注：edit 工具：旧文本必须在文件里恰好出现一次，才会被替换

> A long scroll of code-like scribbles (no readable text) hangs on the wall. Mox holds up a transparent stencil labelled 'oldText' against the scroll; exactly one spot lines up and glows with a thin orange outline, while two near-miss spots are crossed out with faint grey marks. Mox's shoulder arm is about to press a new paper patch labelled 'newText' onto the matched spot. Calm, precise, like a careful restorer.

## 7. `ch06-cache.png`

- 位置：第 6 章。
- 图注：提示缓存按前缀匹配：只在末尾追加，前面不动，就能一直命中缓存

> A long freight train of stacked blocks extends from left to right; the first wagons are labelled 'system', 'tools', 'history'. A large rubber stamp mark labelled 'cached' covers all the early wagons. At the far right, Mox carefully couples one small new wagon labelled 'new' to the end of the train. Behind Mox, a ghosted alternative shows a hand trying to insert a block near the front, with that whole section of the train turning grey and the 'cached' stamp breaking. Mox's lamp glows on the new wagon.

## 8. `ch07-tree.png`

- 位置：第 7 章。
- 图注：会话是一棵只追加的树：回到过去的某个节点，从那里长出新的分支，旧的分支原样保留

> A path of paper cards laid like stepping stones on the ground, branching into two paths at one card. Mox has walked back to the fork and now steps onto the new branch, its head lamp marking the card it stands on, labelled 'leaf'. The old branch continues to the right, intact but slightly faded, nothing erased. A small flag at the fork is labelled 'branch'. Quiet, reflective mood.

## 9. `ch08-compaction.png`

- 位置：第 8 章。
- 图注：压缩：较早的消息折成一份摘要，最近的原样保留；工具调用和它的结果始终夹在一起，不会被切开

> A long desk covered with a row of cards. On the left, Mox folds many older cards into a single neat folded note labelled 'summary'. On the right, the most recent cards stay laid out as they are. In the middle, a pair of cards labelled 'toolCall' and 'toolResult' is held together by a large paper clip, and Mox's shoulder arm deliberately places the cut line just before this pair, never between them. Thin orange line marks the cut.

## 10. `ch09-extensions.png`

- 位置：第 9 章。
- 图注：扩展挂在 Agent 生命周期的各个事件上：通知、改写、或者像闸门一样拦下

> A large circular track (the agent loop) with small numbered sockets around it, labelled 'input', 'before_agent_start', 'tool_call', 'tool_result', 'agent_end'. Small plug-in modules of different shapes are plugged into several sockets; one at 'tool_call' is a little gate barrier that is lowered, stopping a card. Mox stands at the centre plugging its own shoulder module into an empty socket, head lamp glowing.

## 11. `ch12-mcp.png`

- 位置：第 12 章。
- 图注：MCP：一个工具写一次，所有 Agent 都能接上

> Mox holds a large universal adapter plug labelled 'MCP' attached by a cable to its shoulder module. Fanning out to the right, three separate boxes, each with an identical socket, labelled 'GitHub', 'database', 'issues'. Thin cables connect the adapter to the sockets with small JSON-like brace symbols { } travelling along them. On the left, a small stack of tool cards labelled 'mcp__issues__search' flows into Mox's tray.

## 12. `ch14-permissions.png`

- 位置：第 14 章。
- 图注：权限：先查 deny，再查 ask，最后才是 allow；规则拦的是常见的写法，不是边界

> A small checkpoint booth with three lamps in a row labelled 'deny', 'ask', 'allow' (only 'ask' is lit, in orange). A card labelled 'Bash(npm install)' sits on the counter. Mox, inside the booth, consults a thick rule book while its shoulder arm holds a stamp. Outside the booth, a human figure is shown only as a hand about to press a button labelled 'yes'. In the background, a sneaky card labelled 'python -c' slips around the side of the booth, unnoticed, hinting that rules are not walls.

## 13. `ch15-sandbox.png`

- 位置：第 15 章。
- 图注：沙箱：命令在玻璃房里运行；只有一扇小窗通向代理，代理只放行白名单里的域名

> Mox works inside a clear glass room labelled 'sandbox', running a small machine that prints paper. The room has a single small mail window labelled 'proxy'; through it, an envelope addressed 'registry.npmjs.org' passes out, while another envelope addressed 'evil.example' is stamped and returned. Outside the glass, a key ring labelled '.ssh' hangs on a hook, clearly unreachable. A folder labelled '.git/hooks' just inside the glass has a small lock on it. Mox's lamp glows calmly.

## 14. `ch17-subagents.png`

- 位置：第 17 章。
- 图注：子 Agent：带着一张任务单进去，在里面翻遍资料，只带一张结论出来

> A large maze made of tall stacks of paper files. Mox stands at the entrance handing a small card labelled 'task' to a smaller Mox-like scout robot (same design, slightly smaller, its own tiny lamp). Inside the maze the scout is shown deep among opened files. At the exit, the scout hands back a single small note labelled 'summary' to Mox, while all the piles of opened papers remain inside the maze. Mox's tray stays nearly empty and clean.

## 15. `ch18-goal.png`

- 位置：第 18 章。
- 图注：目标循环：模型说“完成了”不算，门上的检查通过才算；原地打转或轮数用完就停

> A circular running track with a gate across it labelled 'node test.js'. The gate has a small light that shows a red cross; Mox, carrying a sign labelled 'done!', is turned back by the closed gate and continues another lap. A scoreboard beside the track reads 'round 2/5'. On a second, happier glimpse at the edge of the frame, the gate light shows a check mark and the gate is open. Mox's lamp glows orange, determined.

## 16. `ch20-evals.png`

- 位置：第 20 章。
- 图注：评测：同样的任务跑很多遍，两个版本成对比较，用区间而不是一个数说话

> A tidy laboratory bench. Mox runs rows of identical small test tubes, each with a tiny check or cross token. Two trays labelled 'A' and 'B' collect the tokens. A balance scale in the middle weighs the two trays, with a small bracket above each tray indicating a range rather than a single mark. Mox's shoulder arm records tally marks on a clipboard. Calm, scientific mood.
