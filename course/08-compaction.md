---
motto: 压缩不是删除历史，而是给历史写一份交接文档——写得多好，取决于谁来读、读多少。
learn:
  - 什么时候该压缩：阈值、预留空间，以及撑爆之后的补救
  - 从哪里切：为什么绝不能把工具调用和它的结果切开，“切开一轮”时怎么办
  - 怎样让模型写出能接着干活的摘要：序列化、结构化格式、增量更新、文件清单
  - 压缩之后，会话文件里发生了什么，模型又看到了什么
  - 摘要的局限：它会丢信息，也会编造
  - 实战：给 mox 写 29 行的 compact.ts 加 8 行触发逻辑，并说清它比 Pi 省掉了什么
prereq: 第 6、7 章
time: 70 分钟
build: 实战：给 mox 写上下文压缩（mox/src/compact.ts 与 cli.ts 里的 maybeCompact）——估算、切点、摘要、触发
---

第 1 章算过，每次请求都要重发全部历史。一个持续几十轮的修 bug 任务，读过的文件、跑过的命令输出加起来，很快就会超出模型的上下文窗口。即使没有超出，越来越长的历史也意味着越来越贵、越来越慢，模型的注意力也越来越分散。

**压缩**（compaction）的做法是：把较早的历史交给模型写一份摘要，之后的请求用“摘要 + 最近的消息”代替完整历史。这一章研究 Pi 的每一个环节，章末在 mox 里写一个最小版本。

## 什么时候压缩

@figure assets/course/ch08-compaction.png 压缩：较早的消息折成一份摘要，最近的原样保留；工具调用和它的结果始终夹在一起，不会被切开

Pi 的触发条件只有一行：

@pi packages/coding-agent/src/core/compaction/compaction.ts#L267-L270

**上下文 > 窗口 − 预留**。预留空间默认是 16384 个 token，留给模型的回答，也留给压缩本身。为什么要留这么多？因为压缩要在“还没撑爆”的时候做：一旦请求真的超过了窗口，服务商会直接拒绝，而你需要一次额外的模型调用才能写出摘要。

上下文的大小用第 6 章的方法估算：最近一次回复的真实用量，加上之后新增消息的估算值。Pi 在三个时机检查：每轮工具执行完、下一次请求之前（第 3 章 `runLoop` 里的 `prepareNextTurn`）；用户发出新的提问之前；以及一次运行结束之后。

### 撑爆之后的补救

估算总有误差，真正撑爆时，服务商会返回一个“上下文太长”的错误（第 6 章讲过 Pi 怎样识别各家不同的措辞）。Pi 的补救是：去掉这条失败的回复，压缩，然后**重试一次**：

@pi packages/coding-agent/src/core/agent-session.ts#L3010-L3056

注释里有几个容易想不到的边界：如果用户刚刚从一个小窗口的模型切换到大窗口的模型，旧模型的溢出错误不应该触发压缩；压缩之前产生的旧回复，也不应该在压缩之后再触发一次。补救只尝试一次，再失败就把问题报告给用户：要么减少上下文，要么换一个窗口更大的模型。

## 从哪里切

压缩要决定一个“切点”：切点之前的交给模型总结，切点之后的原样保留。Pi 从最新的消息往回累加 token，攒够 `keepRecentTokens`（默认 20000）就停：

@pi packages/coding-agent/src/core/compaction/compaction.ts#findCutPoint collapse=true

::: steps findCutPoint 怎样从最新往回找到切点
--- `findCutPoint` 从**最新**的消息往回累加估算 token，攒够 `keepRecentTokens`（默认 20000）就停。先从最后一条 asst 开始数。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::dim --> M6["call"]:::dim --> M7["result"]:::dim --> M8["asst"]:::dim
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::dim --> M10["asst"]:::on
  end
  T1 --> T2 --> T3
--- 再往回：第 3 轮的 user、第 2 轮的 asst 也算进来，累计还没攒够。绿色是已经计入保留额度的消息。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::dim --> M6["call"]:::dim --> M7["result"]:::dim --> M8["asst"]:::on
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::done --> M10["asst"]:::done
  end
  T1 --> T2 --> T3
--- 加上第 2 轮的 `result`，累计终于 ≥ 额度，这就是“候选切点” `i`。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::dim --> M6["call"]:::dim --> M7["result"]:::on --> M8["asst"]:::done
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::done --> M10["asst"]:::done
  end
  T1 --> T2 --> T3
--- 但 `result` **不是合法切点**：`cutPoints` 里排除了所有工具结果。`cutPoints.find(c => c >= i)` 向后顺延到第一条合法消息，也就是它后面的 asst。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::dim --> M6["call"]:::dim --> M7["result"]:::dim --> M8["asst"]:::on
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::done --> M10["asst"]:::done
  end
  T1 --> T2 --> T3
--- 切点定在这条 asst：它和后面的 M9、M10 原样保留；M1～M7 交给模型总结（灰色）。保留部分里没有任何一条是“没有调用的结果”。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::dim --> M6["call"]:::dim --> M7["result"]:::dim --> M8["asst"]:::done
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::done --> M10["asst"]:::done
  end
  T1 --> T2 --> T3
--- 切点不是 user 消息，说明第 2 轮被切成了两半（split turn）：这一轮从 M5 开始，M5～M7 是被切开那一轮的前半段（橙色）。Pi 为它单独写一份摘要，再和历史的摘要合并。
flowchart TB
  subgraph T1["第 1 轮"]
    direction LR
    M1["user"]:::dim --> M2["call"]:::dim --> M3["result"]:::dim --> M4["asst"]:::dim
  end
  subgraph T2["第 2 轮"]
    direction LR
    M5["user"]:::on --> M6["call"]:::on --> M7["result"]:::on --> M8["asst"]:::done
  end
  subgraph T3["第 3 轮"]
    direction LR
    M9["user"]:::done --> M10["asst"]:::done
  end
  T1 --> T2 --> T3
:::

关键规则在合法切点的定义里：

@pi packages/coding-agent/src/core/compaction/compaction.ts#isCutPointMessage

**工具结果永远不能作为切点。** 如果切在工具结果上，保留部分的第一条消息就是一个“没有调用的结果”——第 2 章说过，服务商要求每个工具结果都对应前面的一个工具调用，这样的请求会被直接拒绝。切在 assistant 消息上是允许的：它的工具结果紧跟其后，会一起被保留。

### 切开一轮

“一轮”指从一条用户消息开始，到下一条用户消息之前的所有内容。理想情况是切在用户消息上，整轮整轮地保留。但如果最近一轮本身就很大（比如读了一个大文件），攒够额度时可能停在这一轮的中间，切点只能落在一条 assistant 消息上。这叫 **split turn**。

这个实验构造了一段 5 轮的对话，用不同的保留额度，交给 Pi 真实的 `findCutPoint`：

@lab node labs/ch08/pi-cut-point.ts

情形一是理想情况：额度恰好在一轮的开头用完。情形二和三更常见：切点落在一轮的中间，那一轮的前半段（用户的问题、模型的工具调用、工具结果）会被总结，后半段被保留。

被切开的那一轮有个麻烦：保留部分里只有模型的回答，没有用户的问题——模型会不知道自己在回答什么。Pi 的处理是**写两份摘要**：一份总结更早的历史，一份专门总结“这一轮到目前为止发生了什么”，再合并起来。

<figure class="diagram">
<svg viewBox="0 0 720 210" role="img" aria-label="压缩前后">
<g font-size="12" text-anchor="middle">
<text x="20" y="22" text-anchor="start" font-size="12" font-weight="700" fill="var(--muted)">会话文件（只追加）</text>
<g fill="var(--bg-soft)"><rect x="20" y="32" width="54" height="34" rx="6"/><rect x="78" y="32" width="54" height="34" rx="6"/><rect x="136" y="32" width="54" height="34" rx="6"/><rect x="194" y="32" width="54" height="34" rx="6"/></g>
<g fill="var(--bg)" stroke="var(--line-2)"><rect x="252" y="32" width="54" height="34" rx="6"/><rect x="310" y="32" width="54" height="34" rx="6"/><rect x="368" y="32" width="54" height="34" rx="6"/><rect x="426" y="32" width="54" height="34" rx="6"/><rect x="484" y="32" width="54" height="34" rx="6"/></g>
<rect x="542" y="32" width="80" height="34" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/>
<g fill="var(--faint)"><text x="47" y="54">user</text><text x="105" y="54">call</text><text x="163" y="54">result</text><text x="221" y="54">user</text></g>
<g fill="var(--ink)"><text x="279" y="54">call</text><text x="337" y="54">result</text><text x="395" y="54">asst</text><text x="453" y="54">user</text><text x="511" y="54">asst</text></g>
<text x="582" y="54" fill="var(--accent-ink)">compaction</text>
<path d="M252 74V88" stroke="var(--accent)" stroke-width="1.5"/><text x="252" y="102" text-anchor="start" fill="var(--accent-ink)">firstKeptId：切在带工具调用的 assistant 上，它的结果随后保留</text>
<text x="20" y="140" text-anchor="start" font-size="12" font-weight="700" fill="var(--muted)">模型看到的上下文</text>
<rect x="20" y="150" width="70" height="34" rx="6" fill="var(--ink)"/><text x="55" y="172" fill="var(--bg)">system</text>
<rect x="96" y="150" width="190" height="34" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="191" y="172" fill="var(--accent-ink)">摘要（代替前 4 条记录）</text>
<g fill="var(--bg)" stroke="var(--line-2)"><rect x="292" y="150" width="54" height="34" rx="6"/><rect x="350" y="150" width="54" height="34" rx="6"/><rect x="408" y="150" width="54" height="34" rx="6"/><rect x="466" y="150" width="54" height="34" rx="6"/><rect x="524" y="150" width="54" height="34" rx="6"/></g>
<g fill="var(--ink)"><text x="319" y="172">call</text><text x="377" y="172">result</text><text x="435" y="172">asst</text><text x="493" y="172">user</text><text x="551" y="172">asst</text></g>
<text x="588" y="172" text-anchor="start" fill="var(--muted)">← 原样保留</text>
</g>
</svg>
<figcaption>压缩只在文件末尾追加一条记录；原始消息仍在文件里，只是不再发给模型。</figcaption>
</figure>

## 怎样让模型写出能接着干活的摘要

### 先把对话变成文本

摘要请求有一个容易踩的坑：如果把历史消息原样作为对话发给模型，再在最后加一句“请总结”，模型很可能会**接着对话往下说**——回答最后一个问题，甚至试图调用工具。Pi 的做法是先把整段对话序列化成一段纯文本：

@pi packages/coding-agent/src/core/compaction/utils.ts#serializeConversation

注释里说明了几个取舍：工具结果截断到 2000 个字符（写摘要不需要完整的文件内容）；思考内容不放进去（它可能比要总结的上下文还长）。系统提示也明确禁止“继续对话”：

@pi packages/coding-agent/src/core/compaction/utils.ts#L161-L163

### 结构化的格式

摘要的读者不是人，而是“接手工作的另一个模型”。Pi 给它规定了固定的结构：

@pi packages/coding-agent/src/core/compaction/compaction.ts#L507-L538

目标、约束与偏好、进展（已完成 / 进行中 / 受阻）、关键决定、下一步、关键上下文。最后一句尤其重要：**准确保留文件路径、函数名和错误信息**。“修了一个搜索的 bug”对接手者毫无用处，`src/search.ts` 里的 `toLowerCase` 和那条失败测试的原文才有用。

### 增量更新，而不是重写

第二次压缩时，上一份摘要已经存在。Pi 不会把“上一份摘要 + 新消息”当成全新的内容重新总结，而是把旧摘要放进 `<previous-summary>` 标签，要求模型**合并**：保留已有信息，把完成的事项从“进行中”移到“已完成”，更新“下一步”。这样信息不会在一次次压缩中逐渐丢失。

### 文件清单

无论摘要写得多好，有一类事实绝不能丢：**改过哪些文件**。Pi 不依赖模型去记，而是直接从工具调用里提取出读过和改过的文件，附在摘要末尾，并且跨多次压缩累积：

@pi packages/coding-agent/src/core/compaction/utils.ts#L30-L72

这是一个值得记住的模式：**能从结构化数据里得到的事实，就不要交给模型去总结。**

下面的实验用 Pi 真实的 `prepareCompaction` 和 `compact` 做一次完整的压缩，摘要模型用 faux 脚本代替，重点观察请求的形状和文件清单：

@lab node labs/ch08/pi-compact.ts

Pi 发了两次摘要请求，因为切点落在了一轮的中间；文件清单是程序从工具调用里提取、附在摘要末尾的，和摘要模型写什么无关。

### 真实模型写出的摘要

下面是用 Pi 真实的 `prepareCompaction` + `compact`、真实模型（MiniMax-M3.1-Flash）做的一次压缩，录制方法见 `labs/ch08/record.ts`。对话有三轮：先看项目结构；再修搜索的大小写问题，测试还剩一个关于土耳其语字符的失败用例；最后用户选了 `localeCompare` 方案，并要求以后改完都跑 lint。保留额度很小，所以切点落在了第二轮里：

@lab node labs/ch08/pi-replay.ts

这份输出有几处值得看：

- **两份摘要合在一起了。** 第一份是第一轮（看项目结构）的结构化摘要：目标、约束、进展、关键决定、下一步、关键上下文，正是 Pi 规定的格式。`---` 之后的 `Turn Context (split turn)` 是被切开那一轮的前半段，有“原始请求”和“目前的进展”。
- **文件清单是程序附上的。** `<modified-files>` 里的 `src/search.ts` 来自工具调用，不是模型写的。
- **历史摘要里有过期的“进行中”。** 第一份摘要只看到第一轮，它把“继续检查 README、src 和 test”写成进行中的事项——而这件事在后面的对话里早就换了方向。摘要是写给接手者的，但写它的人只看到被分配的那一段。保留的最近几条消息和第二份摘要在后面纠正了方向，所以不致命；但如果下一次压缩把它们也摘要掉，这条过期的“进行中”会被当成事实继续传下去。这是增量合并（`<previous-summary>`）要认真对待的原因。

## 压缩之后，模型看到什么

压缩记录写进会话后，构建上下文时会用“摘要 + 从 `firstKeptEntryId` 开始的消息 + 压缩之后的消息”代替完整路径：

@pi packages/coding-agent/src/core/session-manager.ts#buildContextEntries

::: steps 压缩记录怎样改变发给模型的上下文
--- 压缩之前，发给模型的就是整条路径。文件里是 M1～M10；下面一行是压缩之后才会出现的上下文，现在还是灰色。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::done --> C["compaction<br/>摘要 + firstKeptId"]:::dim --> N1["新消息 N1"]:::dim
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::dim --> SUM["摘要<br/>（user 消息）"]:::dim --> X1["M8–M10"]:::dim --> X2["N1"]:::dim
  end
  FILE --> CTX
--- 摘要生成成功后，**只追加一条 `compaction` 记录**：里面有摘要正文和 `firstKeptId`（M8 的 id）。M1～M10 一条都没少。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::done --> C["compaction<br/>摘要 + firstKeptId"]:::on --> N1["新消息 N1"]:::dim
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::dim --> SUM["摘要<br/>（user 消息）"]:::dim --> X1["M8–M10"]:::dim --> X2["N1"]:::dim
  end
  FILE --> CTX
--- 压缩之后用户又发来新消息 N1，同样追加在 compaction 记录后面。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::done --> C["compaction<br/>摘要 + firstKeptId"]:::done --> N1["新消息 N1"]:::on
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::dim --> SUM["摘要<br/>（user 消息）"]:::dim --> X1["M8–M10"]:::dim --> X2["N1"]:::dim
  end
  FILE --> CTX
--- 构建上下文时先在路径上找**最后一条** `compaction`：它的摘要变成一条 user 消息，放在开头，前面加说明“之前的对话已被压缩”。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::done --> C["compaction<br/>摘要 + firstKeptId"]:::on --> N1["新消息 N1"]:::done
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::done --> SUM["摘要<br/>（user 消息）"]:::on --> X1["M8–M10"]:::dim --> X2["N1"]:::dim
  end
  FILE --> CTX
--- 接着是从 `firstKeptId` 开始、到 compaction 之前的消息，也就是 M8～M10，原样保留。M1～M7 不再发送，但仍在文件里。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::on --> C["compaction<br/>摘要 + firstKeptId"]:::done --> N1["新消息 N1"]:::done
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::done --> SUM["摘要<br/>（user 消息）"]:::done --> X1["M8–M10"]:::on --> X2["N1"]:::dim
  end
  FILE --> CTX
--- 最后接上 compaction 之后的 N1。这个前缀和压缩前完全不同，**提示缓存全部失效**，这是压缩不可避免的代价。
flowchart TB
  subgraph FILE["会话文件（只追加）"]
    direction LR
    Fold["M1–M7<br/>已被总结"]:::done --> K["M8–M10<br/>保留"]:::done --> C["compaction<br/>摘要 + firstKeptId"]:::done --> N1["新消息 N1"]:::on
  end
  subgraph CTX["发给模型的上下文"]
    direction LR
    SYS["system"]:::done --> SUM["摘要<br/>（user 消息）"]:::done --> X1["M8–M10"]:::done --> X2["N1"]:::on
  end
  FILE --> CTX
:::

摘要以一条用户消息的形式出现在开头，前面加上说明：

@pi packages/coding-agent/src/core/messages.ts#L11-L17

注意，这和第 6 章说的“只追加”并不矛盾：压缩记录本身是追加的，原始历史还在文件里，可以回放、审计，甚至在 `/tree` 里回到压缩之前的分支。被改变的只是“发给模型的投影”。当然，压缩之后的第一次请求，前缀和之前完全不同，提示缓存会全部失效——这是压缩不可避免的代价，也是不应该频繁压缩的原因之一。

::: insight 压缩是有损的
压缩用信息换空间，它一定会丢东西，偶尔还会编造。缓解的办法：把关键事实放在不依赖摘要的地方（文件清单这样从结构化数据提取的信息、`AGENTS.md` 里的长期约定、第 10 章的长期记忆）；让用户可以指定压缩的侧重点（Pi 的 `/compact 重点保留 API 的改动`）；不要压缩得太频繁；以及把子任务放进独立的上下文（第 17 章的子 Agent），从根本上减少主对话需要承载的内容。Claude Code 的文档给出了类似的建议：把需要长期遵守的规则写进 `CLAUDE.md`，而不是依赖对话历史。
:::

## 实战：给 mox 加上压缩

**目标。** 让 mox 在上下文快满时自动压缩，也能手动 `/compact`。mox 只做最小可用版：`mox/src/compact.ts` 29 行，加上 `cli.ts` 里 8 行决定什么时候调用它。**切点只落在用户消息前，摘要只写一份，没有文件清单，没有增量合并，撑爆了也不补救。**

### 第一步：估算

触发要比较“上下文有多大”，Pi 用服务商返回的真实用量加上新增消息的估算。mox 简单得多：每一项都估算。把值序列化成 JSON，ASCII 字符约 4 个一个 token，非 ASCII（中文）每个约 0.7 个：

@code mox/src/compact.ts#estimateTokens

最朴素的公式“字符数 ÷ 4”对中文是灾难。用真实的 MiniMax 接口量同样长度的三段文字，对比两种公式：

@lab node labs/ch08/replay.ts tokens | md

朴素公式在中文上只有真实值的 0.46，mox 的把它拉到了 1.29 倍：**宁可估高**。估高的代价是压缩来得早一点，估低的代价是请求在压缩有机会发生之前就被服务商拒绝。

### 第二步：切点

和 Pi 一样从最后一条往回扫，攒够 `keepTokens` 就停；区别是 mox 只认**用户消息**。工具调用和它的结果必须成对出现，用户消息是唯一一定安全的边界——一条用户消息之前，上一轮的所有调用都已经有了结果。

@code mox/src/compact.ts#L15-L20 hl=16,17,18,19

`cut` 起初是 `messages.length`，意思是“全部摘要”；每遇到一条额度之内的用户消息就把 `cut` 记在它身上，扫描停下来时，`cut` 就是额度之内最靠前的那条用户消息。条件 `i > 0` 意味着**永远不看 `messages[0]`**。

### 第三步：转写、摘要、替换

和 Pi 一样，把要摘要的消息转写成纯文本，放进**一条**用户消息发给模型（防止它接着对话往下说）；摘要写成一条用户消息，替换掉被摘要的部分：

@code mox/src/compact.ts#L21-L28 hl=22,23,25,26,27,28

每条消息只取前 2000 个字符（第 23 行）；`PROMPT` 是一句话，不像 Pi 那样规定格式；`keep` 是保留下来的条数，第 7 章的 `compact` 记录要用它。

### 第四步：什么时候调用

`runLoop` 在**每次请求之前**调用 `options.compact`（第 3 章的循环里有这一行）。命令行把它接到 `maybeCompact`：

@code mox/src/cli.ts#L99-L106 hl=101,102,104

第 101 行比较的是**历史、系统提示、工具定义**三样的估算（每次请求都带着它们）与窗口的 80%；`/compact` 命令用 `force` 跳过阈值。保留额度是窗口的 20%。压缩成功后写进会话文件（第 104 行，第 7 章的 `compacted`）。

### 验证

`labs/ch08/practice.ts` 检验 `compact.ts`（估算、切点、转写、就地替换、边界）和命令行的触发（窗口调到 4000）：

@lab node labs/ch08/practice.ts | md

```bash
MOX_DIR=~/my-mox node labs/ch08/practice.ts
```

### 真实模型写出的 mox 摘要

用 mox 的 `compact()` 和同一个模型对一段修 bug 对话做一次真实压缩（录制方法见 `labs/ch08/record.ts mox`，回放时 `compact()` 照常运行，它构造的请求必须和录制时逐字一致）：

@lab node labs/ch08/replay.ts | md

摘要里关键事实都在：路径、改成了什么、失败测试和期望值。用户最后的两个决定不在摘要里——它们在被保留的最后两条消息中，原样发给模型。

### 和 Pi 比，mox 省掉了什么

同一段 5 轮对话、三种情形，交给 mox 真实的 `compact()` 和 Pi 真实的 `findCutPoint`（两边估算方式不同，同一种情形用的额度数字不同）：

@lab node labs/ch08/cut-point.ts | md

第三行是 mox 最大的取舍：最近一轮的工具输出很大，单独就超了额度，Pi 仍然保留最后一条回答并为前半段单独写摘要；mox 一条也不留，**连用户最后那个问题都进了摘要**。真实的命令行里也是这样——一个大任务只有一条用户消息，切点无处可落：

@lab node labs/ch08/trigger.ts | md

压缩之后，发给模型的只剩一条用户消息，就是摘要；之后任务的上下文完全取决于那一份摘要。其他省掉的东西：

| | mox | Pi |
| --- | --- | --- |
| 切点 | 只在用户消息前 | 也可以在 assistant 上，切开的一轮单独写摘要 |
| 摘要请求 | 一句话指令，每条消息截 2000 字 | 结构化格式、系统提示禁止继续对话 |
| 第二次压缩 | 旧摘要只是 `messages[0]`，同样被截到 2000 字 | `<previous-summary>` 合并 |
| 文件清单 | 无 | 程序从工具调用提取 |
| 触发 | 全部用估算，80% | 真实用量 + 估算，窗口减预留 |
| 撑爆 | 请求被拒，这次运行失败 | 识别溢出错误，压缩后重试一次 |

### 你来改

::: predict 放开切点：任何消息都能当切点
把 `compact.ts` 第 18 行的 `if (messages[i].role === 'user')` 去掉条件，每一步都 `cut = i`。对 5 轮对话（每轮 800 字符的工具输出），额度设为 500 tokens，切点会落在哪里？发给模型的历史有什么问题？
???
切点落在第 15 条消息（下标 14），是一条 **tool 结果**。保留部分以 `{role: "tool", tool_call_id: ...}` 开头，而发出这个调用的 assistant 消息已经被摘要掉了。服务商要求每个 `tool` 消息都对应前面某条 assistant 消息里的 `tool_calls`，这样的请求会被拒绝。这就是 Pi 为什么要在 `isCutPointMessage` 里单独排除工具结果；mox 选了更省事的约束——只认 user。
:::

::: predict 只聊了一轮就 /compact
刚打开 mox，问了一个需要读三个文件的问题，模型回答完。这时输入 `/compact`。`messages` 里还剩什么？
???
只剩一条摘要。整段历史只有一条用户消息，在 `messages[0]`，而扫描的条件是 `i > 0`，永远不会检查它；其余消息都不是用户消息，`cut` 保持 `messages.length`，全部进摘要。（`practice.ts` 里“只有一轮”那一行验证的就是它。）
:::

::: predict 第一份摘要有 2500 字，第二次压缩时模型能看到多少
第一次压缩产生了一份约 2500 字的摘要（60 条已完成的事项）。随着任务继续，第二次压缩又触发了。摘要模型的请求里，旧摘要还剩多少？
???
前 2000 个字符。第 23 行对每条消息一视同仁地 `slice(0, 2000)`，旧摘要也不例外，最后的一部分——在“已完成”清单里通常是最近发生的事——不会进入第二份摘要。运行 `node labs/ch08/repeat.ts` 可以数出具体丢了几条。压缩是有损的，而重复压缩让损失**叠加**。
:::

**练习一：文件清单。** Pi 在摘要末尾附上读过和改过的文件，程序从工具调用里提取。mox 不用改，包装一下 `compact()`——它就地修改 `messages`，返回的 `summary` 就是 `messages[0]` 同一个对象，所以追加内容会同时作用于内存和写进会话的记录。参考实现：

@code labs/ch08/file-list.ts#compactWithFiles

@lab node labs/ch08/file-list.ts

**练习二：增量摘要。** 在 `PROMPT` 后面区分第一次压缩和以后的压缩：如果 `messages[0]` 已经是摘要，把它从转写中拿出来，单独放进 `<previous-summary>` 标签，要求模型合并。运行 `node labs/ch08/repeat.ts`，旧摘要的 60 条事项还能被看到几条？

**练习三：保住用户的原话。** 第三种情形里 mox 把整个任务摘要掉了，用户最后的提问也在其中。试试在 `compact()` 之外补一个办法：压缩之后如果保留的部分是空的，把压缩前最后一条用户消息再原样追加到 `messages` 末尾。这个改动要不要写进会话文件？（想想恢复时会发生什么。）

## 面试题

先自己回答，再展开对照要点。

::: interview 上下文快满了怎么办？说说压缩的完整流程。
1. **触发**：估算的上下文超过“窗口 − 预留”时触发；预留空间留给回答和压缩本身。请求真的撑爆时，识别溢出错误，去掉失败的回复，压缩后重试一次。
2. **切点**：从最新往回累加，攒够要保留的额度；只能切在用户或助手消息上，不能切在工具结果上；切开一轮时单独总结这一轮的前半段。
3. **摘要**：把要总结的历史序列化成纯文本（防止模型继续对话），工具输出截断；用固定的结构化格式；已有摘要时增量合并；从工具调用里提取文件清单附在末尾。
4. **落盘**：在会话里追加一条压缩记录（摘要 + 第一条保留消息的 id），原始历史不删除。
5. **投影**：之后的请求用“摘要 + 保留的消息”代替完整历史。
:::

::: interview 压缩时为什么不能把工具调用和工具结果切开？
服务商要求每个工具结果都对应前面某条 assistant 消息里的工具调用（通过 id 关联）。如果切点落在工具结果上，保留部分会以一条“孤立的结果”开头，请求会被拒绝。反过来，切在带工具调用的 assistant 消息上是安全的，因为它的结果紧跟其后，会被一起保留。mox 更保守，只切在 user 消息前，一轮永远不会被切开，代价是粒度粗：最近一轮自己就超额时，一条原文也留不下。
:::

::: interview 怎样让模型写出高质量的压缩摘要？
- 先把对话序列化成文本，系统提示明确“不要继续对话，只输出摘要”；
- 规定结构：目标、约束与偏好、进展、关键决定、下一步、关键上下文；要求原样保留路径、函数名、错误信息；
- 增量更新：把上一份摘要作为单独的输入，要求合并而不是重写——否则旧摘要会和普通消息一起被截断，信息逐轮流失；
- 能从结构化数据得到的事实（改过的文件）由程序提取，不依赖模型；
- 允许用户指定侧重点；摘要被截断或失败时不写入。
:::

::: interview 估算 token 数用“字符数 ÷ 4”有什么问题？怎么改进？
对英文和代码大致可用，对中文严重偏低：实测同样长度的文本，估算只有真实 token 数的 0.46 倍。后果是触发阈值（比如窗口的 80%）实际上变成了 150% 以上，请求在压缩之前就被服务商拒绝。

改进：非 ASCII 字符单独按更高的权重算（mox 用 0.7，实测中文偏高 29%，落在安全一侧）；阈值要把系统提示和工具定义一起算上；优先使用服务商上一次回复返回的真实用量，只对新增的消息估算（Pi 的做法）；预留足够的余量；撑爆之后能识别溢出错误并补救。
:::

::: interview 压缩有什么风险？如何缓解？
有损：细节会丢失（转写截断、重复压缩叠加损失、摘要里的“进行中”可能已经过期），模型还可能编造用户没提过的约束；压缩后的第一次请求提示缓存全部失效；整段任务只有一条用户消息时（mox）原话也会进摘要。

缓解：长期规则写进项目说明文件或长期记忆；关键事实由程序提取；用户可以指定侧重点；保留足够多的近期消息；减少压缩频率；用子 Agent 隔离探索性工作，减少主上下文的负担。原始历史保留在会话文件里，必要时可以回到压缩之前。
:::
