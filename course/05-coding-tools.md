---
motto: 好的工具不在于功能多，而在于失败时把话说清楚。
learn:
  - Pi 默认只给模型四个工具，为什么够用，又放弃了什么；另外三个（grep、find、ls）怎样实现
  - read：长文件怎样分段，截断时怎样给出“可以照做”的提示
  - edit：为什么是精确文本替换，以及唯一性、重叠、模糊匹配、换行符这些细节
  - bash：超时、取消与进程树，输出截断，退出码
  - 实战：给 mox 写 read、write、edit、bash、grep、find、ls 七个工具，并让它第一次在真实项目里改代码
prereq: 第 3、4 章
time: 70 分钟
build: 实战：给 mox 写 read/write/edit/bash/grep/find/ls 七个工具（mox/src/tools.ts），跑通第一次改代码
---

前几章的工具都是玩具：读虚拟文件，往内存里写字符串。这一章读 Pi 真正的 coding 工具。它们要面对的是真实的文件系统和真实的模型：5000 行的日志、几乎抄对了的 `oldText`、跑了一半被超时杀掉的测试。每个工具的实现里，都有几处只有被真实用户用过才会写出来的代码。

读完之后，章末的实战会把同样的七个工具在 mox 里写一遍，让它修一个真正的 bug。

## Pi 默认的四个工具

Pi 默认只给模型四个工具：

| 工具 | 用途 |
| --- | --- |
| `read` | 读文件，支持分段 |
| `edit` | 用精确文本替换修改文件 |
| `write` | 新建或整体覆盖文件 |
| `bash` | 执行任意命令 |

Pi 其实还有 `grep`、`find`、`ls` 等工具，但默认不启用（可以用 `--tools` 打开）。搜索、列目录、跑测试、看 git 状态，全部交给 `bash`。

这是一个有意的取舍。少给工具的好处是：工具说明占的上下文更少；模型面对的选择更少，选错工具的机会也更少；模型本来就熟悉 shell 命令。代价是：`bash` 的输出没有结构，权限控制只能针对命令字符串（第 14 章会看到这有多难），而且 shell 语法本身就是一个注入面。

::: compare Claude Code 的选择
Claude Code 走的是另一条路。它的官方文档把内置工具分成文件操作、搜索、执行、网络、代码智能几类，搜索有专门的工具，而不是全部交给 shell。专门的工具输出更规整、更好做权限规则（比如只允许读某个目录），代价是工具说明更长、模型要在更多工具之间做选择。两种设计都合理，面试时能讲清楚这个权衡就够了。（[How Claude Code works · Tools](https://code.claude.com/docs/en/how-claude-code-works)）
:::

::: compare Claude Code 的选择
Claude Code 走的是另一条路。它的官方文档把内置工具分成文件操作、搜索、执行、网络、代码智能几类，搜索有专门的工具，而不是全部交给 shell。专门的工具输出更规整、更好做权限规则（比如只允许读某个目录），代价是工具说明更长、模型要在更多工具之间做选择。两种设计都合理，面试时能讲清楚这个权衡就够了。（[How Claude Code works · Tools](https://code.claude.com/docs/en/how-claude-code-works)）
:::


## read：长文件怎么读

读文件的难点不在读，而在**读太多**。一个 5000 行的日志文件塞进上下文，不仅浪费钱，还会把真正重要的内容挤出模型的注意力。Pi 的 `read` 有两个上限，先到先算：2000 行或 50KB。

截断时，它不只是“切掉”，而是告诉模型**下一步可以怎么做**：

@pi packages/coding-agent/src/core/tools/read.ts#L175-L198

注意这几条提示的写法：“显示了第 1-2000 行，共 5000 行，用 `offset=2001` 继续”。模型不需要推理，照着做就行。还有一种极端情况：一行就超过了 50KB（比如压缩过的 JS 文件），这时 Pi 直接建议模型改用 `bash` 的 `sed` 和 `head -c`。

这个实验让 Pi 的 `read` 和 `bash` 面对四种过长的输出：

@lab node labs/ch05/pi-truncate.ts

- **5000 行的日志**：2000 行先到，末尾是 `Use offset=2001 to continue`，用 `offset=1990` 再读，提示变成 `offset=3990`，一段一段往下翻。
- **每行 1000 个字符的宽文件**：50KB 先到，只留下 51 个**完整的行**，不会把第 52 行切成半截。
- **每行 1000 个汉字的文件**：同样的 50KB，只留下 17 行。上限数的是**字节**，一个汉字三个字节，所以中文文件能读到的行数是英文的三分之一。数字符会让中文文件多读三倍。
- **`bash` 输出 20000 行**：和 `read` 的**方向相反**，保留结尾而不是开头，因为命令的报错信息、测试的失败摘要几乎总在最后几行。完整输出另存进临时文件，路径写在提示里，需要时可以用 `read` 或 `grep` 去查。

### 读文件时的取消

第 3 章说过，取消是协作式的：工具必须自己在可能阻塞的地方检查信号。`read` 是一个很好的范例。它开始前先看一眼 `signal.aborted`；然后注册 `abort` 监听，一触发就立即让整个调用失败；之后每一个 `await`（解析路径、检查文件是否可读、检测图片类型、读内容）回来时，都先检查 `aborted` 标记，已经取消就不再往下做：

@pi packages/coding-agent/src/core/tools/read.ts#L110-L128 hl=110,119,124,127

这样即使一次读文件卡在慢速的网络磁盘上，用户按下 Esc 之后工具也会立刻返回“已取消”，而不是等磁盘回应。

### 模型写路径的各种习惯

路径解析看起来平淡无奇，但 Pi 在这里处理了不少真实世界的怪事：

@pi packages/coding-agent/src/core/tools/path-utils.ts#L40-L84

`stripAtPrefix`：模型常把对话里的 `@src/cli.ts`（很多界面用 @ 引用文件）原样当成路径。`tryMacOSScreenshotPath`：macOS 截图文件名里 AM/PM 前面是一个窄的不换行空格，用户在对话里复制粘贴时它变成了普通空格，文件就“找不到”了。`tryNFDVariant`：macOS 的文件系统用另一种 Unicode 规范形式（NFD）保存带重音或部分组合字符的文件名，和模型输出的形式（NFC）字节不同。这类代码不会出现在任何教程里，只会出现在被真实用户用过的产品里。

## write：整个覆盖

`write` 是最短的工具：创建父目录，整个覆盖文件。它对已有文件不会提醒：覆盖一个没读过的文件，工具照写不误。Pi 的 `write` 把整个写入包在 `withFileMutationQueue` 里（第 4 章），和 `edit` 共用同一个按文件路径分组的队列，所以同一批里对同一个文件的两次写入不会交错。

## edit：为什么是“精确文本替换”

@figure assets/course/ch05-edit.png edit 工具：旧文本必须在文件里恰好出现一次，才会被替换

让模型修改文件，有好几种设计：

| 方式 | 做法 | 问题 |
| --- | --- | --- |
| 整体重写 | 模型输出完整的新文件 | 改一行也要输出整个文件，又慢又贵；长文件容易漏掉内容 |
| 按行号修改 | “把第 42-45 行替换成……” | 模型数行号很不可靠；改完一处，后面的行号全变了 |
| diff / patch | 模型输出统一 diff 格式 | 格式严格，模型经常写错上下文行或行号头 |
| **搜索替换** | “把这段原文替换成那段新文” | 原文必须能唯一定位 |

搜索替换胜出的原因是：**模型最擅长的就是复制它刚读过的文字**。它不需要数行号，不需要遵守复杂的格式，只要把要改的那几行原样抄下来、写出新版本。唯一的风险是原文在文件里出现多次，所以必须检查唯一性。

::: compare 其他 Agent 的选择
Anthropic 为 Claude 提供的文本编辑工具也采用这种方式（`str_replace`：`old_str` 必须在文件中唯一匹配）。OpenAI 的 Codex CLI 则选择了一种自定义的补丁格式（`apply_patch`），它比统一 diff 宽松，用上下文行而不是行号定位。不同的选择背后，是对“自家模型最擅长输出什么”的判断。
:::

Pi 的 `edit` 一次可以做多处修改，参数说明把规则写得非常具体：

@pi packages/coding-agent/src/core/tools/edit.ts#L20-L48

“每段都对照**原文件**匹配，而不是逐段累积”“不要包含大段未改动的内容”“离得近的修改请合并”——这些都是从模型的实际错误里总结出来的约束。

### 匹配的规则

Pi 匹配修改内容的核心函数：

@pi packages/coding-agent/src/core/tools/edit-diff.ts#applyEditsToNormalizedContent collapse=true

它依次检查：`oldText` 不能为空；先精确匹配，找不到再模糊匹配；必须唯一；多段修改不能重叠；修改后内容必须有变化。最后从后往前应用替换，这样前面的修改不会改变后面修改的位置。

**模糊匹配**处理的是“模型抄得几乎对”的情况：

@pi packages/coding-agent/src/core/tools/edit-diff.ts#normalizeForFuzzyMatch

文件里是弯引号 `“`，模型写成直引号 `"`；文件行尾有多余的空格，模型没抄；不同的破折号和特殊空格。这些差异肉眼几乎看不出来，模型也很难避免。归一化之后再匹配，就能命中。

但模糊匹配带来一个新问题：如果直接把归一化后的整个文件写回磁盘，文件里**其他地方**的弯引号也会被改成直引号——用户只让你改一行，你却改了一百行。Pi 的做法是只把“修改涉及的那几行”写回，其余行保留原始字节：::: steps 一次 edit 怎样把直引号匹配到弯引号
--- 文件里是 `title = “Mox”` 和 `note = ‘保留’`（弯引号），模型给的 `oldText` 是 `title = "Mox"`（直引号）。第一关：每段 `oldText` 都不能为空。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::on --> V2["② 精确<br/>匹配"]:::dim --> V3["③ 归一化<br/>后匹配"]:::dim --> V4["④ 唯一"]:::dim
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::dim --> V6["⑥ 覆盖<br/>涉及的行"]:::dim --> V7["⑦ 内容<br/>有变化"]:::dim --> W["写回磁盘"]:::dim
  end
  P1 --> P2
--- 第二关：`fuzzyFindText` 里的 `indexOf` 精确匹配失败，字节不一样。`applyEditsToNormalizedContent` 不是报错：只要有一段 edit 用了模糊匹配（`usedFuzzyMatch`），整体改用**归一化后的文本**去匹配。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::done --> V2["② 精确<br/>匹配"]:::on --> V3["③ 归一化<br/>后匹配"]:::dim --> V4["④ 唯一"]:::dim
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::dim --> V6["⑥ 覆盖<br/>涉及的行"]:::dim --> V7["⑦ 内容<br/>有变化"]:::dim --> W["写回磁盘"]:::dim
  end
  P1 --> P2
--- 第三关：弯引号归一化成直引号后，`indexOf` 命中第 1 行，记下位置和长度。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::done --> V2["② 精确<br/>匹配"]:::done --> V3["③ 归一化<br/>后匹配"]:::on --> V4["④ 唯一"]:::dim
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::dim --> V6["⑥ 覆盖<br/>涉及的行"]:::dim --> V7["⑦ 内容<br/>有变化"]:::dim --> W["写回磁盘"]:::dim
  end
  P1 --> P2
--- 第四、五关：归一化文本里 `oldText` 恰好出现一次，才算唯一；多段修改按位置排序后，前一段的结尾不能越过后一段的开头。这里只有一段，都通过。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::done --> V2["② 精确<br/>匹配"]:::done --> V3["③ 归一化<br/>后匹配"]:::done --> V4["④ 唯一"]:::on
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::on --> V6["⑥ 覆盖<br/>涉及的行"]:::dim --> V7["⑦ 内容<br/>有变化"]:::dim --> W["写回磁盘"]:::dim
  end
  P1 --> P2
--- 第六关：`applyReplacementsPreservingUnchangedLines` 按行覆盖回原文：只替换命中的第 1 行，第 2 行的 `‘保留’` 仍是原始字节，不会被顺手改成直引号。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::done --> V2["② 精确<br/>匹配"]:::done --> V3["③ 归一化<br/>后匹配"]:::done --> V4["④ 唯一"]:::done
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::done --> V6["⑥ 覆盖<br/>涉及的行"]:::on --> V7["⑦ 内容<br/>有变化"]:::dim --> W["写回磁盘"]:::dim
  end
  P1 --> P2
--- 最后一关：替换后的内容和原文相同就抛错，否则写回磁盘（BOM 和 Windows 换行在这之后还原）。
flowchart TB
  subgraph P1["找到位置"]
    direction LR
    V1["① oldText<br/>非空"]:::done --> V2["② 精确<br/>匹配"]:::done --> V3["③ 归一化<br/>后匹配"]:::done --> V4["④ 唯一"]:::done
  end
  subgraph P2["应用并写回"]
    direction LR
    V5["⑤ 不重叠"]:::done --> V6["⑥ 覆盖<br/>涉及的行"]:::done --> V7["⑦ 内容<br/>有变化"]:::on --> W["写回磁盘"]:::on
  end
  P1 --> P2
:::

这个实验用九种情形试 Pi 真实的 `edit`，打印结果和磁盘上的字节：

@lab node labs/ch05/pi-edit.ts

前两种是基本功：精确匹配成功；两处修改都对照原文件匹配，所以先后顺序无关紧要。接下来是唯一性、重叠、找不到、没有变化这四道关，每一道都有一句写给模型的话。

第三种情形值得细看：模型用直引号写了 `title`，文件里是弯引号，匹配成功；而文件里另一行的 `‘保留’` 仍然是弯引号，没有被顺手改掉。行尾多了空格同样被救回来。倒数第二种情形中，Windows 换行和文件开头看不见的 BOM 都原样保留了：Pi 在匹配前把它们去掉，写回时再还原，因为模型永远不会在 `oldText` 里写出 `\r` 或 BOM。

### 写文件时的取消

`edit` 的执行部分有一段很容易被忽略的注释：

@pi packages/coding-agent/src/core/tools/edit.ts#L156-L170

第 3 章讲过，取消是通过监听信号实现的。但这里**刻意不**在监听器里立刻放弃，而是在每一步文件操作之后检查 `signal.aborted`。原因是：如果在监听器里立刻抛错，第 4 章的文件修改队列会被释放，下一个修改同一文件的工具就会开始执行，而上一个写入可能还没真正完成——两个写入交错，文件就坏了。**取消要快，但不能快到破坏一致性。**

## bash：最有用，也最危险

`bash` 让模型能做几乎任何事：跑测试、装依赖、看 git 历史。它的实现要解决三个问题。

**第一，超时和取消时要杀掉整个进程树。** Pi 用 `detached` 启动子进程，让它成为一个新进程组的组长，取消时杀掉整个组。这个实验让命令在后台再启动一个 `sleep`（模拟 `npm test` 拉起的测试进程），自己也睡 3 秒，分别在超时 1 秒、0.5 秒后取消两种情形下，1.5 秒时数一数还剩几个 `sleep`：

@lab node labs/ch05/pi-bash.ts | md

两种情形都是 0 个子进程、按时返回，抛出的错误分别是超时和取消。

::: steps 超时之后怎样杀掉整个进程树
--- `spawn` 时带上 `detached: true`，让 bash 成为一个**新进程组的组长**。命令里在后台又启动了一个 `sleep`，它和 bash 在同一个进程组里。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant T as bash 工具
  participant B as bash 进程<br/>（新进程组组长）
  participant C as 后台 sleep
  rect rgb(255, 230, 213)
    T->>B: spawn(detached)
    B->>C: 后台启动 sleep
  end
--- 超时计时器到点：置 `timedOut = true`，调用 `onAbort`，也就是 `killTree(child.pid)`。用户按 Esc 取消时走的是同一个函数。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant T as bash 工具
  participant B as bash 进程<br/>（新进程组组长）
  participant C as 后台 sleep
  T->>B: spawn(detached)
  B->>C: 后台启动 sleep
  rect rgb(255, 230, 213)
    Note over T: 计时器到点<br/>timedOut = true
  end
--- `process.kill(-pid, "SIGKILL")`：pid 前面的负号指向**整个进程组**，bash 和它启动的 sleep 一起被杀。朴素实现只杀 bash，sleep 就成了孤儿。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant T as bash 工具
  participant B as bash 进程<br/>（新进程组组长）
  participant C as 后台 sleep
  T->>B: spawn(detached)
  B->>C: 后台启动 sleep
  Note over T: 计时器到点<br/>timedOut = true
  rect rgb(255, 230, 213)
    T-)B: kill(-pid)
    T-)C: 同一信号送达整个组
  end
--- `close` 事件触发：清掉计时器，截断输出（保留结尾，必要时存临时文件），因为 `timedOut` 为真，用“命令超时”拒绝，结果作为错误交回模型。
%%{init: {"sequence":{"width":110,"actorMargin":10,"messageFontSize":14,"noteFontSize":13,"actorFontSize":13,"mirrorActors":false,"boxMargin":6,"messageMargin":28,"noteMargin":6}}}%%
sequenceDiagram
  participant T as bash 工具
  participant B as bash 进程<br/>（新进程组组长）
  participant C as 后台 sleep
  T->>B: spawn(detached)
  B->>C: 后台启动 sleep
  Note over T: 计时器到点<br/>timedOut = true
  T-)B: kill(-pid)
  T-)C: 同一信号送达整个组
  rect rgb(255, 230, 213)
    B-->>T: close
    Note over T: reject：命令超时
  end
:::


只杀 `bash` 本身，它启动的进程就会变成孤儿。在真实场景里，这可能是一个占着端口的开发服务器，或者一个还在写文件的测试进程。更糟的是，孤儿还握着命令的输出管道，如果工具在等管道关闭，它会被一直拖住。实战环节会复现这个问题。

**第二，输出要截断，但不能丢。** 前面已经看到，保留结尾，完整输出存进临时文件。

**第三，非零退出码就是失败。** 命令“执行成功”和命令“成功了”是两回事。`npm test` 正常结束但有测试失败时，退出码非零，结果应该标记为错误（上面实验的最后一行）：

@pi packages/coding-agent/src/core/tools/bash.ts#L383-L407

注意这里的返回值同时带有 `content`（给模型的文字）和 `structuredContent`（给程序的结构化数据：完整输出、是否截断、退出码、耗时）。第 4 章说过，给模型的要精炼，给程序的要完整。

::: warn 工作目录不是沙箱
`bash` 在项目目录里启动，但它能访问当前用户能访问的一切。`cd ~ && rm -rf .`、读取 `~/.ssh`、把代码发到外网，工具本身没有任何限制。路径解析也一样：`read` 接受绝对路径，`/etc/passwd` 照样能读。第 14 章的权限规则和第 15 章的沙箱会处理这个问题。在那之前，不要在重要的目录里用真实模型运行 coding agent。
:::

## grep、find、ls：Pi 默认不启用的三个

Pi 还有 `grep`、`find`、`ls` 三个工具，默认不启用（可以用 `--tools` 打开）。它们的实现不自己搜，而是调用成熟的外部程序：`grep` 用 ripgrep（`rg`），`find` 用 `fd`：

@pi packages/coding-agent/src/core/tools/grep.ts#L160-L170

`rg` 默认遵守 `.gitignore`，所以构建产物和依赖目录不会淹没搜索结果；`--hidden` 让点开头的文件也能搜到；`--json` 让 Pi 能可靠地解析每一处匹配。两个程序如果机器上没有，Pi 会自己下载：

@pi packages/coding-agent/src/utils/tools-manager.ts#ensureTool

代价是依赖外部程序和一次联网下载，换来的是速度和 `.gitignore` 的正确处理。三个工具都有 `limit`（`grep` 默认 100 处匹配，`find` 默认 1000 个，`ls` 默认 500 项），超出时在结果末尾说明。把它们做成专门的工具，还有一个权限上的好处：它们是只读的，权限系统（第 14 章）可以放心地免确认，而 `bash` 里的 `grep` 命令每次都要问。

## 实战：给 mox 加上七个 coding 工具

**目标**：在 `mox/src/tools.ts` 里写出和 Pi 同名、同参数的七个工具，然后让 mox 用它们修一个真实的 bug。mox 只做最小可用版：搜索用 Node 自带的 `fs.globSync` 和正则，不依赖 `rg`、`fd`；`edit` 只做精确匹配，不做模糊匹配；`bash` 不把完整输出另存文件。

### 第一步：公共零件，clip 和路径

七个工具共用几个小东西：一个按行数和字节数截断输出的 `clip`，几个拼 JSON Schema 的小函数，一个把路径解析到工作目录的 `at`。

@code mox/src/tools.ts#L7-L16 hl=12,13

对应 Pi 的 `truncateHead` 和 `truncateTail`。`clip` 先按行数截（第 11 行），再按**字节**截（第 12、13 行：转成 `Buffer`，超出就切，再去掉被切成半个字的 `\uFFFD`），`keep` 决定留开头还是留结尾：`read` 留开头，`bash` 留结尾。

@code mox/src/tools.ts#L26-L28

`at()` 用 `resolve(cwd, path)`，绝对路径原样放行，`path` 缺省是 `'.'`。每个工具都是第 4 章的 `Tool`：`{ name, description, parameters, run }`。

### 第二步：read，截断时说“接着读”

@code mox/src/tools.ts#L29-L44 hl=34,35,36,38,39,42

第 34、35 行读整个文件按行切，`offset` 超出就报错；第 36 行取一段并套上 2000 行上限；第 37 到 39 行数一数从 `offset` 起，累加每行的字节数（`Buffer.byteLength`），最多放下几行（至少一行）；第 42 行在后面还有内容时追加 Pi 同款的提示。返回原文，**不带行号**，和 Pi 一样：`edit` 靠 `oldText` 匹配，不需要行号。

### 第三步：write 和 edit

@code mox/src/tools.ts#L45-L54

`write` 先建父目录再覆盖。`edit` 的参数是 `path` 加 `edits` 数组：

@code mox/src/tools.ts#L55-L79 hl=64,65,66,67,71,72,76

第 64 到 68 行，对每一处修改数 `oldText` 在**原文件**里出现几次，不是恰好一次就抛错，错误信息写成可以照做的指令（“请带上更多上下文让它唯一”“先 read 再改”）；第 69 行按位置排序，第 71、72 行从前往后拼接并检查重叠；第 76 行写回。因为结果是按位置切片拼接出来的，`newText` 里的 `$&` 不会被当成替换模式。对应 Pi 的 `applyEditsToNormalizedContent`，少了模糊匹配和换行符处理。

### 第四步：bash，独立进程组

@code mox/src/tools.ts#L80-L105 hl=87,89,90,92,96,97,100,101,102

- **独立进程组**（第 87 行）：`detached: true`。**杀整个组**（第 89 行）：`process.kill(-child.pid, 'SIGKILL')`，超时（第 90 行的计时器）和取消（第 92 行的监听）都走它。
- **等 `exit`，不等 `close`**（第 96、97 行）：`close` 要等输出管道关闭，命令放到后台的进程会一直握着管道；所以等 `exit`，再等 50 毫秒让最后一批输出到达。
- **非零退出码是错误**（第 100 到 102 行）：只有正常退出才 `done`，否则 `fail`，输出和 `[退出码 N]` 或 `[超时 N 秒，已终止]` 一起放进异常，`execute` 把它变成“错误：……”。输出过长保留**结尾**。

这些写法是被一个具体的问题逼出来的。mox 最初的 `bash` 更简单：`spawn('bash', ['-c', command], { cwd, signal, timeout })`，超时和取消交给 `spawn` 自带的选项，等 `close` 事件。实验把它原样重写了一份当“朴素实现”，和现在的 mox、Pi 放在一起：

@lab node labs/ch05/bash.ts | md

朴素实现超时 1 秒，1.5 秒时还有 2 个 `sleep` 活着，工具**约 3 秒才返回**：`timeout` 选项只向 `bash` 发 `SIGTERM`，两个 `sleep` 成了孤儿，握着管道，`close` 迟迟不来。取消时倒是立刻返回，但返回时子进程还在。它还把 `exit 3` 当成正常结果，界面上是绿色的 ✓。现在的 mox 和 Pi 一样：一个子进程都不剩，按时返回，超时、取消、非零退出码都是错误。

### 第五步：grep、find、ls

@code mox/src/tools.ts#L17-L20 hl=19

`globSync` 在 `root` 下按 glob 找文件，`exclude` 回调跳过 `.git` 和 `node_modules`，再过滤出普通文件并排序。`grep` 用它列出要搜的文件，逐个读入，跳过含 `\0` 的二进制文件，逐行用正则匹配，输出“路径:行号: 内容”；`find` 直接返回文件列表；`ls` 用 `readdirSync` 列一层，目录名后面加 `/`。三个工具都有 `limit`，超出时在末尾说明。

@lab node labs/ch05/search.ts

注意 `build/` 被 `.gitignore` 排除了，`grep 'TODO'` 还是搜到了它：mox 只硬编码跳过两个目录，不读 `.gitignore`。这是它和 Pi 的 `rg`/`fd` 最大的差别。

### 装起来：mox 第一次改代码

`mox/src/cli.ts` 里有一块把循环、工具和事件接到一起的代码：

@code mox/src/cli.ts#L108-L132 hl=109,129,130

第 108 到 117 行是传给 `runLoop` 的选项：模型、系统提示、工具、取消信号、权限钩子（第 4 章），以及后面章节才用到的接口。第 129 行就是 `runLoop` 的那一次调用，其余的都围绕它。**mox 的命令行本身就是这一个调用加上一圈外围。** 权限在 `beforeTool` 里：只读的 `read`、`grep`、`find`、`ls` 直接放行，其他工具默认要用户确认，`--yolo` 才跳过。

先用脚本模型跑一遍。模型的每一次回复是写死的，其余全是真的：mox 的 `runLoop`、七个工具和临时目录里一个有 bug 的小项目。`calc.js` 里的 `add` 写成了减法，`sub` 的函数体和它一模一样：

@lab node labs/ch05/fix-bug.ts

第一次 `edit` 被唯一性检查拦下：`return a - b;` 在 `add` 和 `sub` 里各出现一次，工具说“请带上更多上下文让它唯一”，脚本里的模型照做，第二次成功。测试失败时退出码非零，所以第一条是 ✗，这是预期的失败。

再看一次真实的运行。模型是 MiniMax-M3.1-Flash，用 mox 的命令行（`mox -p "运行 node test.js，修好失败的测试" --yolo`）。录制下来的是模型每一次回复；回放时由脚本模型吐出，工具在一份全新的项目副本上重新执行：

@lab node labs/ch05/replay.ts

模型在一条回复里同时要了 `ls` 和 `read`，mox 对这些调用是一个接一个执行的（第 4 章）；它先看、再测、再改、再验证，失败的测试是一条 ✗，它直接读出断言信息，下一步就去改。

要自己运行，先装好 mox（零依赖，要求 Node 22.18 或更新），设置三个环境变量，在示例项目的副本里执行：

```bash
cd mox && npm link          # 之后任何目录都能用 mox 命令；也可以直接 node mox/src/cli.ts
export MOX_BASE_URL=https://api.minimaxi.com/v1
export MOX_API_KEY=你的Key
export MOX_MODEL=MiniMax-M3.1-Flash

cp -R labs/fixtures/calc-bug /tmp/calc-bug && cd /tmp/calc-bug
mox -p "运行 node test.js，修好失败的测试"    # 去掉 --yolo：每次 edit 和 bash 都会问你
```

### 验证

`labs/ch05/practice.ts` 在临时目录里逐个调用七个工具，检查边界行为：

@lab node labs/ch05/practice.ts | md

默认检验参考实现。想检验你自己写的，设置 `MOX_DIR`：

```bash
MOX_DIR=~/my-mox node labs/ch05/practice.ts
```

### 和 Pi 比，mox 省掉了什么

最直观的是 `edit`。这个实验把同样的修改交给 mox 和 Pi：

@lab node labs/ch05/edit.ts

前面几种情形两边一致：精确匹配、多处修改、`oldText` 出现两次、找不到、两处重叠，都按同一套规则处理。分叉的是“模型抄得几乎对，差几个看不见的字符”：行尾多了空格、弯引号对直引号、Windows 换行下的多行 `oldText`。mox 对它们都回答“找不到”，模型要重新 `read`，再抄一遍，多一次往返，但不会改错；Pi 把它们救了回来。

| | mox | Pi |
| --- | --- | --- |
| `edit` 的匹配 | 精确 | 精确 + 模糊（弯引号、行尾空白、特殊空格），保留换行符和 BOM |
| `bash` 的完整输出 | 超长时只说“省略了多少” | 另存临时文件，路径写进提示 |
| `grep` / `find` | `globSync` + 正则，不读 `.gitignore` | `rg` / `fd`，遵守 `.gitignore` |
| 路径 | `resolve`，缺省 `.` | `@` 前缀、macOS 截图名、NFD 变体 |
| 取消 | `read` 是同步的，没有取消点 | 每个 `await` 后检查 |
| 写同一文件 | 同步函数天然串行 | `withFileMutationQueue` |

“50KB”也值得一提：mox 最初数的是字符，同一个每行 1000 汉字的文件，会读出 51 行、约 15 万字节，Pi 只读 17 行、5 万字节。这个差异是跑实验时发现的，现在 `clip` 和 `read` 都按字节算：

@lab node labs/ch05/truncate.ts | md

### 你来改

::: predict 把 bash 里的 detached 去掉
`mox/src/tools.ts` 第 87 行去掉 `detached: true`，保留第 89 行的 `process.kill(-child.pid!, 'SIGKILL')`，再让模型跑 `sleep 3.7 & sleep 3.7; wait`，`timeout` 设为 1 秒。工具多久返回？返回的文字是什么？
???
工具要等约 3.7 秒才返回，返回的文字却是“[超时 1 秒，已终止]”。原因：不加 `detached`，`bash` 和 mox 自己在同一个进程组里，`-child.pid` 指向的进程组不存在，`process.kill` 抛出 `ESRCH`，被第 89 行的 `try/catch` 吞掉，什么都没杀。`stopped` 已经被设成了“超时”，所以文字说的是超时，实际却是命令自己跑完才结束。这是一类很隐蔽的错误：错误处理把真实的失败吞掉，还给出一条好看的消息。（这个结论是在 `tools.ts` 的一份拷贝上只改这一处、实际运行得到的。想自己试，复制一份到实验目录里改，不要直接改参考实现。）
:::

::: predict 同一个文件上的两个 edit 并行执行
把第 4 章的 `runLoopParallel` 用在 mox 的工具上，模型一条回复里发了两个 `edit`：一个把 `a = 1` 改成 `a = 10`，另一个把 `b = 2` 改成 `b = 20`，都在 `f.txt`。两个修改都会保留吗？
???
会都保留，`f.txt` 变成 `a = 10\nb = 20`。因为 mox 的 `edit` 是同步函数：`readFileSync` 到 `writeFileSync` 之间没有 `await`，`Promise.all` 里的两个 `run` 是一个接一个、各自完整地跑完的，不会交错。如果把 `edit` 改成异步（`await readFile`、`await writeFile`），两个调用就会各自读到旧内容，后写的覆盖先写的，丢掉一个修改。Pi 的 `edit` 是异步的，所以才需要 `withFileMutationQueue`。
:::

::: predict 让 grep 遵守 .gitignore
在 `labs/ch05/search.ts` 的临时项目里，`build/app.js` 被 `.gitignore` 排除了，但 `grep 'TODO'` 还是搜到了它。想让 mox 的 `files` 函数也跳过 `.gitignore` 里列出的目录，最小的改法是什么？它会漏掉什么？
???
最小的改法：读工作目录根部的 `.gitignore`，把每一行（去掉空行和注释）当作要排除的名字，加进 `exclude` 回调。它能处理 `build/`、`dist/` 这类直白的目录名，但会漏掉 `.gitignore` 的大部分语法：`!` 取反、`*.log` 这类 glob、只匹配根目录的 `/build`、子目录里自己的 `.gitignore`。完整支持意味着要实现 gitignore 的规则，这正是 Pi 选择调用 `rg` 和 `fd`、让它们去处理的原因：把一整套已经有人维护好的规则交给外部程序，换来的是一个运行时依赖。
:::

## 面试题

先自己回答，再展开对照要点。

::: interview 一个 coding agent 需要哪些基础工具？工具越多越好吗？
最小集合是读文件、改文件、写文件、执行命令。搜索、列目录、跑测试都可以通过命令完成。

工具不是越多越好：每个工具的说明都占上下文；选择越多，模型选错的概率越高。但专门的工具也有好处：输出结构化、权限可以细粒度控制、避免 shell 注入。Pi 默认只给四个，Claude Code 提供了专门的搜索工具，两者是不同的取舍。好的回答要说出取舍，而不是给一个“标准清单”。
:::

::: interview 文件编辑工具为什么普遍采用“搜索替换”，而不是行号或整文件重写？
- 整文件重写：改一行也要输出全文，慢、贵，长文件容易漏内容。
- 行号：模型数行号不可靠，而且一处修改会让后面的行号全部失效。
- diff：格式严格，模型经常写错。
- 搜索替换：模型最擅长原样复制它刚读过的文字，只需要保证原文唯一。

实现要点：唯一性检查、多段修改对照原文件且不能重叠、从后往前应用、模糊匹配（弯引号、行尾空白）但只写回改动的行、保留原文件的换行符和 BOM、修改后内容必须有变化。
:::

::: interview 执行 shell 命令的工具要注意哪些问题？
- **超时与取消**：杀掉整个进程树，而不是只杀 shell，否则子进程会变成孤儿继续运行。
- **输出**：截断时保留结尾（报错在最后），完整输出存文件并告诉模型路径；执行中可以节流推送部分输出给界面。
- **结果**：非零退出码标记为失败；同时保留结构化信息（退出码、耗时、是否截断）给程序使用。
- **安全**：工作目录不是沙箱，命令能访问当前用户能访问的一切，需要权限规则和系统级隔离。
:::

::: interview 工具输出太长时怎么处理？
设行数和字节数两个上限，先到先算，只保留完整的行。根据内容选择保留方向：文件保留开头，命令输出保留结尾。截断时给出可执行的提示（下一段用什么参数读、完整输出在哪个文件），让模型能自己继续，而不是丢失信息。

更进一步：大输出放在给程序的结构化数据里，只把摘要发给模型；工具结果太多时，由上下文压缩处理（第 8 章）。
:::

::: interview 编辑文件时，取消操作需要注意什么？
取消要及时，但不能破坏一致性。如果在取消信号的回调里立刻放弃，可能出现：文件修改的锁被释放，下一个修改同一文件的操作开始执行，而上一次写入其实还在进行，两次写入交错导致文件损坏。

更稳妥的做法是在每一步文件操作完成之后检查取消标记，让正在进行的操作完整结束再退出。
:::
