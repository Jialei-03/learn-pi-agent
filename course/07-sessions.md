---
motto: 会话不是一条直线，而是一棵只会长、不会改的树；存储记录事实，发送的是投影。
learn:
  - 为什么会话要存成 JSONL 文件，以及“只追加”在这里意味着什么
  - 用 id 和 parentId 把对话组织成树：回退、分叉都不需要删除任何东西
  - 进程崩溃之后，半行记录、只有调用没有结果的历史怎样被安全地恢复
  - Pi 的会话管理器在一致性上做的那些细节
  - 实战：给 mox 写 43 行的 session.ts，并说清它比 Pi 省掉了什么
prereq: 第 3、6 章
time: 60 分钟
build: 实战：给 mox 写平铺的 JSONL 会话（mox/src/session.ts）——逐条追加、-c 恢复、补“中断”、容忍坏行
---

到第 6 章为止，对话历史只存在内存里，进程一退出就没了。真正的 Agent 要能做到：关掉终端明天接着干；发现走错了路，回到之前某一步换个方向；进程崩溃之后，不丢已经做完的工作。这一章读 Pi 的会话存储，章末在 mox 里写一个最小版本。

## 为什么是 JSONL

Pi 把每个会话存成一个 JSONL 文件：第一行是会话的元信息，之后每一行是一条记录（一条消息、一次模型切换、一次压缩……）。写入只有一种方式——在文件末尾追加一行。

@pi packages/coding-agent/src/core/session-manager.ts#L43-L67

为什么不用数据库，也不用一个大 JSON 文件？

- **追加是最安全的写入。** 往文件末尾写一行，最坏的情况是这一行只写了一半；前面的内容永远不会被破坏。而重写整个 JSON 文件时，进程在写到一半时崩溃，整个会话就没了。
- **它和第 6 章的原则一致。** 上下文只追加不修改，存储也只追加不修改。存下来的就是模型当时真实看到和说过的内容，可以完整地回放和审计。
- **人能直接读。** 用 `tail -f` 就能看着 Agent 工作，用 `grep` 就能搜索所有历史会话。

Claude Code 也是这样做的：它的文档说明，每条消息、每次工具调用和结果都写进 `~/.claude/projects/` 下的 JSONL 文件，以此支持恢复、分叉和回退。

先看 Pi 的会话在进程退出之后是不是真的还在。下面的实验用真实的 Pi 会话：第一个会话说一句话然后销毁；用同一个文件重新打开，再提一个问题。脚本模型自己不记任何东西，能在第二次请求里看到第一轮的内容，只能是因为历史是从文件里读回来的：

@lab node labs/ch07/resume.ts

文件头之后除了用户和助手的消息，还有模型切换、思考级别、系统提示这些记录——同一个文件里记的是“这个会话发生过的所有事”。

## 一棵树，而不是一条线

@figure assets/course/ch07-tree.png 会话是一棵只追加的树：回到过去的某个节点，从那里长出新的分支，旧的分支原样保留

假设对话进行到一半，你让 Agent “用 Python 重写”，看了一眼结果觉得不对，想回到之前，改成“给它加上类型”。最直接的做法是删掉后面的消息——但那样之前的尝试就永远丢了，万一后来发现 Python 那条路其实更好呢？

Pi 的做法是：**每条记录都有一个 `id` 和一个 `parentId`**。正常对话时，新记录的父节点是上一条记录，形成一条链。回到过去某一点时，只是把“叶子”指针移过去；之后追加的记录以那一点为父节点，自然就开出一个新分支。旧分支原封不动地留在文件里。

<figure class="diagram">
<svg viewBox="0 0 720 230" role="img" aria-label="会话树">
<defs><marker id="a7" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--faint)"/></marker></defs>
<g font-size="12.5" text-anchor="middle">
<rect x="20" y="88" width="92" height="40" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="66" y="113" fill="var(--ink)">U1 列文件</text>
<rect x="142" y="88" width="92" height="40" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="188" y="113" fill="var(--ink)">A1</text>
<rect x="290" y="28" width="150" height="40" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="365" y="53" fill="var(--faint)">U2 用 Python 重写</text>
<rect x="470" y="28" width="92" height="40" rx="8" fill="var(--bg)" stroke="var(--line-2)"/><text x="516" y="53" fill="var(--faint)">A2</text>
<rect x="290" y="148" width="150" height="40" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="365" y="173" fill="var(--ink)">U2' 给它加上类型</text>
<rect x="470" y="148" width="92" height="40" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/><text x="516" y="173" fill="var(--ink)">A2'</text>
</g>
<g stroke="var(--faint)" stroke-width="1.2" fill="none" marker-end="url(#a7)"><path d="M112 108H140"/><path d="M234 102C262 90 266 56 288 50"/><path d="M440 48H468"/><path d="M234 114C262 126 266 160 288 166"/><path d="M440 168H468"/></g>
<g font-size="11.5" fill="var(--muted)"><text x="580" y="53">旧分支：仍在文件里</text><text x="580" y="173" fill="var(--accent-ink)">← 叶子：当前分支</text><text x="140" y="80">分叉点：A1 有两个孩子</text></g>
<text x="20" y="216" font-size="11.5" fill="var(--faint)">发给模型的永远是“从根走到叶子”的那条路径：U1 → A1 → U2' → A2'</text>
</svg>
<figcaption>回退和分叉不删除任何记录，只移动叶子。</figcaption>
</figure>

Pi 里对应的代码非常短。追加一条消息时，父节点就是当前叶子：

@pi packages/coding-agent/src/core/session-manager.ts#appendMessage

分叉只是移动叶子：

@pi packages/coding-agent/src/core/session-manager.ts#L1590-L1595

而“当前分支”就是从叶子沿着 `parentId` 一路走回根，再反转：

@pi packages/coding-agent/src/core/session-manager.ts#buildSessionPath

::: steps 回退一步、开出新分支：会话树怎样长出来
--- 会话是一条链：每条记录的 `parentId` 指向上一条，叶子在 A2（橙色）。
flowchart LR
  U1["U1 列文件"]:::done --> A1["A1"]:::done
  A1 --> U2["U2 用 Python 重写"]:::done --> A2["A2"]:::on
  A1 --> U2p["U2' 给它加上类型"]:::dim --> A2p["A2'"]:::dim
--- 用户想回到“重写之前”。这一步**只是移动叶子指针**到 A1（`branch(id)`），没有删除任何记录；U2、A2 变灰，是因为它们不在当前路径上，仍然躺在文件里。
flowchart LR
  U1["U1 列文件"]:::done --> A1["A1"]:::on
  A1 --> U2["U2 用 Python 重写"]:::dim --> A2["A2"]:::dim
  A1 --> U2p["U2' 给它加上类型"]:::dim --> A2p["A2'"]:::dim
--- 用户发新消息：追加 U2'，它的 `parentId` 是**当前叶子** A1。A1 于是有了两个孩子，这里就是分叉点。
flowchart LR
  U1["U1 列文件"]:::done --> A1["A1"]:::done
  A1 --> U2["U2 用 Python 重写"]:::dim --> A2["A2"]:::dim
  A1 --> U2p["U2' 给它加上类型"]:::on --> A2p["A2'"]:::dim
--- 模型的回复 A2' 接在 U2' 后面，叶子移到 A2'。旧分支原样留着，随时可以再回去。
flowchart LR
  U1["U1 列文件"]:::done --> A1["A1"]:::done
  A1 --> U2["U2 用 Python 重写"]:::dim --> A2["A2"]:::dim
  A1 --> U2p["U2' 给它加上类型"]:::done --> A2p["A2'"]:::on
--- 发给模型的是**从叶子沿 `parentId` 走回根、再反转**得到的路径（`buildSessionPath`）：U1、A1、U2'、A2'。旧分支的 U2、A2 不会出现在请求里。
flowchart LR
  U1["U1 列文件"]:::on --> A1["A1"]:::on
  A1 --> U2["U2 用 Python 重写"]:::dim --> A2["A2"]:::dim
  A1 --> U2p["U2' 给它加上类型"]:::on --> A2p["A2'"]:::on
--- 重新打开文件：叶子指针不需要单独存。新分支的记录一定是最后追加的，文件里的**最后一条就是叶子**，当前分支自然是最后写入的那一支。
flowchart LR
  U1["U1 列文件"]:::done --> A1["A1"]:::done
  A1 --> U2["U2 用 Python 重写"]:::dim --> A2["A2"]:::dim
  A1 --> U2p["U2' 给它加上类型"]:::done --> A2p["A2'"]:::on
:::

这个实验用真实的 Pi 会话构造上图。先看文件里每条记录的 `id` 和 `parentId`，再看叶子移动前后模型分别看到什么：

@lab node labs/ch07/tree.ts

两个分支共用 U1、A1 两条记录，A1 有两个孩子。**重新打开文件后，当前分支是最后写入的那一支。** 叶子指针本身不需要单独保存——文件里最后一条记录就是叶子，因为新分支的记录一定是最后追加的：

@pi packages/coding-agent/src/core/session-manager.ts#L1104-L1114

### 树带来的能力

有了树，几个看起来不同的功能变成了同一个操作：

| 功能 | 在树上的操作 |
| --- | --- |
| 继续上次的会话 | 打开文件，叶子是最后一条 |
| 回到之前某一步重来 | 移动叶子，之后的追加自动成为新分支 |
| 编辑之前的某条用户消息 | 移动到它的父节点，再追加修改后的消息 |
| 把某个分支拆成独立会话 | 复制根到叶子的路径到新文件，记下来源（Pi 的 `/fork`、`/clone`） |
| 给某条记录打书签 | 追加一条 `label` 记录 |

Pi 甚至用同样的思路处理“修改历史”：如果需要改变之前某条消息在上下文里的样子（比如把一段巨大的工具输出替换成摘要），它不会改那一行，而是追加一条 `context_edit` 记录，构建上下文时再把修改应用上去：

@pi packages/coding-agent/src/core/session-manager.ts#L173-L180

“修改”本身也是一条追加的记录。文件里的每一行写下之后就再也不会变。

::: note 离开分支时的摘要
在 `/tree` 里从一个分支跳到另一个分支时，Pi 可以先让模型给离开的那个分支写一份摘要，附在新分支上。这样新分支不必包含旧分支的全部内容，又能知道“之前尝试过 Python 重写，结果是……”。这和第 8 章的压缩是同一套机制。
:::

## 一致性：内存和文件必须说同一件事

会话存储最容易出 bug 的地方，是内存里的状态和文件里的内容对不上。Pi 在两个地方特别小心。

**文件要等到有真正的对话才创建，写盘失败时内存要回滚：**

@pi packages/coding-agent/src/core/session-manager.ts#L1160-L1207

注释说得很清楚：一条没写进文件的记录，不能成为后续记录的父节点，否则文件里会出现指向不存在的父节点的记录，整棵树就断了。

关于第一点：打开 Pi 又直接关掉，不应该留下一个空会话文件；但用户已经发出的问题，即使第一轮回答还没完成，也要落盘（注释里引用了一个 issue 编号，这是从真实 bug 里学到的）。第一次写入用 `wx` 模式打开文件：文件已存在就失败，绝不覆盖另一个会话。

## 崩溃之后

进程可能在任何时刻被杀掉：用户关了终端、系统内存不足、Agent 自己执行了一条把父进程也带走的命令。重新打开会话时，会遇到三种“不完整”。

**最后一行只写了一半。** Pi 解析文件时逐行处理，无法解析的行直接跳过：

@pi packages/coding-agent/src/core/session-manager.ts#parseSessionEntries

**工具调用已经存下，工具结果还没有。** 这是最危险的一种：模型的回复（包含工具调用）在 `message_end` 时就写进了文件，而工具还没执行完进程就没了。恢复之后，历史里有一个没有结果的工具调用——第 2 章说过，服务商要求每个工具调用都有对应的结果，原样发送会被直接拒绝。

**一条失败或被取消的回复。** 它的内容可能只有一半，比如一段没说完的话，或者一个参数不完整的工具调用。

Pi 没有修改会话文件来“修复”这些问题，而是在**发送前**对历史做一次投影：跳过失败和被取消的回复，给没有结果的工具调用补一条“没有提供结果”的错误结果：

@pi packages/ai/src/api/transform-messages.ts#L179-L257 collapse=true

这个函数还处理了另一个跨服务商的问题，写在它开头的注释里：OpenAI 某些接口生成的工具调用 ID 长达四百多个字符、带特殊符号，而 Anthropic 要求 ID 只能是字母数字、下划线和连字符、最长 64 个字符。在一个会话里切换模型时，旧消息的 ID 也要转换：

@pi packages/ai/src/api/transform-messages.ts#L85-L94

::: steps transformMessages 怎样给没有结果的调用补一条
--- 崩溃发生在工具执行完之前：文件里有一条带 `bash` 调用的 assistant 消息，却没有对应的结果；后来用户又发了一条消息。投影还是空的。
flowchart TB
  subgraph F["磁盘上的会话（保持不变）"]
    direction LR
    S1["user U1"]:::dim --> S2["assistant<br/>调用 bash"]:::dim --> S3["user U2"]:::dim
  end
  subgraph P["发给模型的投影"]
    direction LR
    P1["user U1"]:::dim --> P2["assistant<br/>调用 bash"]:::dim --> PR["toolResult<br/>没有结果"]:::dim --> P3["user U2"]:::dim
  end
  F --> P
--- `transformMessages` 从头遍历。第一条是 user，没有待处理的调用，原样放进投影。
flowchart TB
  subgraph F["磁盘上的会话（保持不变）"]
    direction LR
    S1["user U1"]:::done --> S2["assistant<br/>调用 bash"]:::dim --> S3["user U2"]:::dim
  end
  subgraph P["发给模型的投影"]
    direction LR
    P1["user U1"]:::on --> P2["assistant<br/>调用 bash"]:::dim --> PR["toolResult<br/>没有结果"]:::dim --> P3["user U2"]:::dim
  end
  F --> P
--- 第二条是 assistant：它的 `stopReason` 是 `toolUse`，不是 `error` 或 `aborted`，所以保留，并把里面的 `bash` 调用记进待处理的集合。
flowchart TB
  subgraph F["磁盘上的会话（保持不变）"]
    direction LR
    S1["user U1"]:::done --> S2["assistant<br/>调用 bash"]:::done --> S3["user U2"]:::dim
  end
  subgraph P["发给模型的投影"]
    direction LR
    P1["user U1"]:::done --> P2["assistant<br/>调用 bash"]:::on --> PR["toolResult<br/>没有结果"]:::dim --> P3["user U2"]:::dim
  end
  F --> P
--- 第三条是新的 user 消息，它打断了工具流程。先检查待处理的调用：`bash` 没有对应的结果，于是**补一条错误结果**，内容是“没有结果”。
flowchart TB
  subgraph F["磁盘上的会话（保持不变）"]
    direction LR
    S1["user U1"]:::done --> S2["assistant<br/>调用 bash"]:::done --> S3["user U2"]:::on
  end
  subgraph P["发给模型的投影"]
    direction LR
    P1["user U1"]:::done --> P2["assistant<br/>调用 bash"]:::done --> PR["toolResult<br/>没有结果"]:::on --> P3["user U2"]:::dim
  end
  F --> P
--- 然后这条 user 消息才放进投影。服务商要求的“每个工具调用后面都有结果”满足了，而磁盘上的会话文件一个字节都没改：存储的是事实，发送的是投影。
flowchart TB
  subgraph F["磁盘上的会话（保持不变）"]
    direction LR
    S1["user U1"]:::done --> S2["assistant<br/>调用 bash"]:::done --> S3["user U2"]:::done
  end
  subgraph P["发给模型的投影"]
    direction LR
    P1["user U1"]:::done --> P2["assistant<br/>调用 bash"]:::done --> PR["toolResult<br/>没有结果"]:::done --> P3["user U2"]:::on
  end
  F --> P
:::

对比实验覆盖了这三种情况，用的是 Pi 真实的 `SessionManager` 和 `transformMessages`：

@lab node labs/ch07/crash.ts

::: insight 存储的是事实，发送的是投影
会话文件记录的是“实际发生了什么”，包括失败、取消和中断。发给模型的是对这些事实的一个投影：跳过不该重放的，补上协议要求的，转换格式上的差异。把两者分开，存储就永远不需要被“修复”，而投影的规则可以随着服务商的要求变化而调整。第 6 章的 `transformContext`、第 8 章的压缩，都是在这个投影层上工作。
:::

## 实战：给 mox 加上会话

**目标。** 让 mox 关掉终端也不丢对话：每产生一条消息就追加到磁盘，`mox -c` 接着上次的会话，进程在工具执行到一半被杀掉也能恢复。mox 只做最小可用版——**一条线，没有 id 和父节点，没有分支**——43 行，写在 `mox/src/session.ts`。它是第 8 章压缩记录的存放处，也是第 18 章崩溃恢复的基础。

### 第一步：找到文件，决定怎么写

会话文件放在 `~/.mox/sessions/<工作目录>/` 下，目录名是把路径里的 `/` 换成 `-`；文件名是创建时的时间，字符串排序就是时间排序，所以 `-c`（继续最近一次）只要排个序取最后一个。**目录先建好，文件不创建**——等第一条消息写入时才会出现，和 Pi 一样不留空会话。整个文件里唯一写盘的地方是 `write`，同步追加一行：

@code mox/src/session.ts#L14-L19 hl=15,17,18,19

### 第二步：回放，容忍坏行

恢复就是把文件从头读一遍，一行一条记录。普通消息直接 `push`，压缩记录（第 8 章）要特殊处理：摘要替换掉除最近 `keep` 条以外的全部消息。读之前先看文件有没有以换行结尾——半行后面不补换行，下一条记录就会粘上去，变成一整行坏数据，连新消息一起丢掉。

::: tabs
@@ mox
@code mox/src/session.ts#L20-L28 hl=21,22,25,26
先读整个文件，缺换行就补；坏行 `continue` 跳过；`compact` 记录用 `splice` 还原。
@@ Pi
@pi packages/coding-agent/src/core/session-manager.ts#parseSessionEntries
同样逐行解析，坏行跳过。Pi 还要处理版本迁移和文件头。
:::

### 第三步：Session 对象

返回的 `Session` 只有四样东西：文件路径、消息数组、`save`、`compacted`。**回放得到的 `messages` 数组，就是第 3 章 `runLoop` 要原地追加的那个数组**，命令行直接拿它当会话历史。

@code mox/src/session.ts#L29-L34 hl=31,32

### 第四步：补“中断”

会话可能停在工具执行到一半的时候：assistant 消息在工具执行之前就落盘了，工具还没有结果进程就没了。恢复时检查**最后一条 assistant 消息**——更早的 assistant 之后，循环一定是把结果交回去了才请求的下一轮，缺口只可能出现在末尾。它每个不在 `answered` 里的调用，补一条“中断”结果，**同时追加到内存和文件里**，这样下一次恢复不会重复补：

@code mox/src/session.ts#L36-L45 hl=37,38,39,40,42,43

对照刚才读过的 Pi：Pi 不改文件，在发送前投影（`transformMessages`）；mox 把补丁当作一件新发生的事——“恢复时发现这个调用被中断了”——写进文件。九行代码，请求路径上没有任何额外处理，代价是这条规则一旦写进文件就永远在那里。

### 第五步：接进命令行

`session` 什么时候存，是命令行的事。用户消息由 `run` 自己存（循环只在**自己** `push` 消息时才发 `message` 事件，用户的第一句话是循环开始前放进数组的）；循环产生的每条消息——assistant 回复、工具结果、插话——都经过 `onEvent` 存下来：

@code mox/src/cli.ts#L108-L132 hl=113,127,128,129

### 验证

`labs/ch07/practice.ts` 检验这一章写出来的 `session.ts`：延迟创建、逐条追加、`-c` 恢复同一个文件、压缩记录回放、补“中断”不重复、末尾有半行时恢复且新消息不丢。默认检验参考实现，设置 `MOX_DIR` 就检验你自己的：

@lab node labs/ch07/practice.ts | md

```bash
MOX_DIR=~/my-mox node labs/ch07/practice.ts
```

### 真的杀一次

测试里的“中断”是造出来的。下面是真的：第一次运行，模型一次要求两个命令，先 `echo`，再 `sleep 30`；等 mox 打印出 `sleep 30` 开始执行，实验对整个进程组发 `kill -9`。然后 `mox -c` 恢复，看第一次请求发给模型的是什么：

@lab node labs/ch07/kill.ts

磁盘上的会话停在三行，第二个调用没有结果。恢复时补上的一行告诉模型真相——**不知道那条命令有没有做完**，让它自己检查，而不是假装成功或失败。再次 `-c` 时请求里仍然只有一条“中断”：补上的那一行已经写进文件。

::: steps 一次崩溃和恢复，mox 的会话怎样变化
--- 模型回复了两个工具调用。assistant 消息在工具执行之前就落盘了。
flowchart LR
  U["user<br/>依次运行"]:::done --> A["assistant<br/>echo + sleep"]:::done --> T1["tool<br/>echo 的结果"]:::dim --> T2["tool<br/>sleep 的结果"]:::dim
--- 工具按顺序执行。`echo` 很快结束，它的结果也落盘了。
flowchart LR
  U["user<br/>依次运行"]:::done --> A["assistant<br/>echo + sleep"]:::done --> T1["tool<br/>echo 的结果"]:::done --> T2["tool<br/>sleep 的结果"]:::dim
--- `sleep 30` 开始执行，进程在这时被 kill -9。磁盘上只有前三条。
flowchart LR
  U["user<br/>依次运行"]:::done --> A["assistant<br/>echo + sleep"]:::done --> T1["tool<br/>echo 的结果"]:::done --> T2["tool<br/>sleep 的结果<br/>（永远不会有）"]:::on
--- `mox -c`：`openSession` 回放出三条，发现最后一条 assistant 有两个调用，只有一个在 `answered` 里。
flowchart LR
  U["user<br/>依次运行"]:::done --> A["assistant<br/>echo + sleep"]:::on --> T1["tool<br/>echo 的结果"]:::done --> T2["tool<br/>sleep 的结果<br/>（永远不会有）"]:::dim
--- 给缺的那个补一条“中断”，写进内存和文件。接下来用户的新消息接在后面，请求合法。
flowchart LR
  U["user<br/>依次运行"]:::done --> A["assistant<br/>echo + sleep"]:::done --> T1["tool<br/>echo 的结果"]:::done --> T2["tool<br/>中断：结果未知"]:::on --> U2["user<br/>刚才断了，继续"]:::dim
:::

### 半行从哪里来

kill -9 会不会把一行写到一半？下面的实验先试着造一个：让一个进程不停地追加 2KB 的记录，在随机时刻 `kill -9`，重复 8 次。然后手工造一个半行，看 mox 和 Pi 怎么读，以及恢复之后接着聊，新消息会不会丢：

@lab node labs/ch07/torn.ts

一条记录就是一次 `appendFileSync`——一次写系统调用，进程被信号杀死时，内核要么已经把这次写完，要么还没开始，所以**进程崩溃不会产生半行**。半行来自进程之外：断电、磁盘写满、写在网络盘上。mox 读到它不会失败（`try` 加 `continue`，和 Pi 一样只丢那一行），也不会让新消息和它粘在一起（读之前先补换行）。这两处都是写这一章的实验时发现问题之后补上的：容忍坏数据要在读和写两头都做。

### 和 Pi 比，mox 省掉了什么

| | mox | Pi |
| --- | --- | --- |
| 记录 | `message`、`compact` | message、compaction、label、模型切换等 |
| 结构 | 一条线，没有 id | 树：`id` + `parentId` |
| 恢复 | 回放全部行，按 `keep` 处理压缩 | 找到叶子，沿路径构建上下文 |
| 分支 | 没有 | `branch`、`/tree`、`/fork` |
| 中断的工具调用 | 打开时补一条写进文件 | 发送前投影，文件不动 |
| 写盘失败 | `appendFileSync` 抛出，运行失败 | 内存回滚，记录不成为后续的父节点 |

没有树，“回到之前某一步重来”就做不到：内存里把数组截短，文件里被截掉的消息还在，下一次 `-c` 它们又回来了（`labs/ch07/flat.ts`）。mox 选择让这件事不存在，因为教学和日常使用里，“继续上次的会话”远比“在同一次会话里来回跳分支”常见。

### 你来改

::: predict 回退之后恢复
把内存里的数组截回 A1 再继续聊，文件会怎样？`mox -c` 恢复出来的是几条？
???
六条：`U1 → A1 → U2 → A2 → U2' → A2'`。文件只追加，被截掉的 U2、A2 还在；回放不知道曾经“回退”过。运行 `node labs/ch07/flat.ts` 可以看到。模型会看到一个用户先说“用 Python 重写”、做了一半、又改口的历史，自相矛盾。
:::

::: predict 删掉补换行的那一行
把 `session.ts` 第 22 行（`if (saved && !saved.endsWith('\n')) appendFileSync(file, '\n');`）删掉，再运行 `node labs/ch07/torn.ts`。最后一次“再恢复一次”会读回几条消息？
???
2 条：「再试一次」和半行粘成了一行，两者一起被第 25 行的 `try` 跳过，新消息丢了。实验里最后的断言会失败，这就是它守住的东西。
:::

**练习：分叉。** 在 mox 里加上“从第 n 条消息处分叉”：不动 mox，只用它公开的 `openSession` 新开一个文件，把前 n 条复制进去。参考实现：

@code labs/ch07/fork.ts#forkSession

想一想：文件名只精确到毫秒，同一毫秒开两次会怎样？`-c` 恢复的是哪个文件？要让 `/fork 2` 这样的命令起作用，命令行需要给扩展多暴露什么？

**练习：只容忍最后一行。** 第 25 行的 `continue` 不管坏行在哪里都跳过。文件中间的某一行被人手工改坏，也会被悄悄跳过——如果它恰好是某条 assistant 的 `tool_calls`，后面的 `tool` 消息就成了没有调用的孤儿，下一次请求会被服务商拒绝（第 2 章）。把它改成：只有**最后一行**解析失败才跳过，中间的坏行抛出错误。Pi 跳过坏行之后，发送前还会再做一次投影，所以能承受这类孤儿；mox 没有这一层，应该严格到什么程度？

**练习：id。** 给每条记录加一个 `id`（比如行号），给 `compact` 记录用 `fromId` 代替 `keep`。恢复逻辑要怎么改？“在文件中间插入记录会让压缩错位”的问题还存在吗？

## 面试题

先自己回答，再展开对照要点。

::: interview Agent 的对话历史应该怎样持久化？为什么常用 JSONL？
每条消息一形成就追加写入，用 JSONL（每行一条 JSON 记录）。追加写入最安全：崩溃时最多损坏最后一行，前面的内容不受影响；读取时跳过无法解析的行即可。它还天然契合“历史只追加不修改”的原则，记录的就是模型真实看到和说过的内容，便于审计和回放，人也可以直接用命令行工具查看。

细节：内存状态和文件必须一致，写盘失败要回滚内存；没有实际对话时不创建文件；首次创建时不覆盖已有文件。
:::

::: interview 如何支持“回到之前某一步重新来过”而不丢失原来的尝试？
把会话组织成树：每条记录有 id 和 parentId，维护一个叶子指针。回退就是移动叶子，之后的新记录以那一点为父节点，自然形成新分支，旧分支保留在文件里。发给模型的是从根到叶子的路径。重新打开时，最后一条记录就是叶子，不需要额外保存指针。

编辑历史消息、拆分会话、书签都可以用同样的方式实现；需要“修改”某条记录对上下文的贡献时，追加一条编辑记录，在构建上下文时应用。平铺文件做不到：内存里截短，文件里被截掉的消息恢复时又回来，只能复制前 n 条到新文件。
:::

::: interview Agent 进程崩溃后恢复会话，可能遇到哪些问题？怎么处理？
- 最后一行只写了一半（断电、磁盘满；进程被杀不会产生）：解析时跳过；写入前先确认文件以换行结尾，否则新记录会粘在半行后面一起丢掉。
- 有工具调用但没有结果：服务商会拒绝请求，补一条错误结果（“运行中断，没有结果”）。Pi 在发送前投影，mox 在打开会话时补并写进文件。
- 失败或被取消的回复只有一半内容：发送前跳过，不重放。
- 已经执行的工具副作用（比如改了一半的文件）无法从会话里恢复，需要配合检查点（第 16 章）。

原则是不让坏数据拖垮整个会话，并且在发给模型之前保证历史合法。
:::

::: interview 会话存储里，“存储的内容”和“发给模型的内容”为什么要区分？
存储记录事实，包括失败、取消、被替换的内容和分支；发送的是投影：只取当前分支，应用压缩摘要和上下文编辑，跳过不该重放的回复，补齐协议要求的工具结果，转换不同服务商的 ID 格式。

区分之后，存储永远只追加、不需要修复，可以完整审计；投影规则可以随服务商要求和产品策略独立演进。
:::

::: interview 压缩过的会话怎样存储和恢复？
压缩不改原来的记录，只在末尾追加一条记录：摘要加上“保留哪些”。Pi 的 compaction 记录用 `firstKeptEntryId` 指向第一条保留的消息，不依赖计数；mox 的 `compact` 记录用 `keep`（保留最近几条），恢复时回放：遇到它就把前面的消息替换成摘要、只留最近 keep 条。原始历史仍然完整，可以审计；代价是 `keep` 依赖“回放到这里时内存和压缩时一致”，文件只能追加，不能在中间插入或删除。
:::
