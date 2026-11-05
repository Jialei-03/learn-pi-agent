---
motto: 好的工具不在于功能多，而在于失败时把话说清楚。
learn:
  - 说清楚 mox 的七个工具各自怎么实现，名字和参数为什么要和 Pi 保持一致
  - read：2000 行和 50KB 两道上限、“用 offset 接着读”的提示，以及“50KB”按字符还是按字节数的差别是怎么被发现并修好的
  - edit：edits[{oldText, newText}] 的精确替换、唯一性和重叠检查，哪些情形 mox 直接拒绝而 Pi 能救回来
  - bash：为什么必须用独立进程组杀掉整棵进程树（mox 最初的写法错在哪里），为什么非零退出码要当作错误，为什么输出保留结尾
  - grep、find、ls 为什么值得单独做成工具，以及 mox 的简化版和 Pi 的 rg/fd 版差在哪里
  - 在 Mox-agent 里跑通第一次改代码：离线脚本版，加一次 MiniMax-M3.1-Flash 的真实录制
prereq: 第 3、4 章
time: 70 分钟
build: 读懂 mox/src/tools.ts 的七个工具和 cli.ts 的组装，让 mox 修一个真实的 bug
---

前几章的工具都是玩具：读虚拟文件，往内存里写字符串。mox 的 `tools.ts` 是真的，150 来行里有七个能在你电脑上读文件、改文件、跑命令、搜代码的工具，名字和参数与 Pi 的内置工具完全一致。这一章逐个读它们，每个工具都先看 mox 的写法，再用实验把它推到边界，最后对照 Pi 在同一个位置多做了什么。读完就把所有零件装起来，让 mox 修一个真正的 bug。

有些边界会让人意外。这一章的 `bash` 实验会先复现 mox 最初的写法：超时设 1 秒，工具却过了 3 秒才返回，因为它只杀了 `bash` 进程，命令在后台启动的子进程还握着输出管道。这个问题是读 mox 第一版的时候被发现的，现在的 mox 已经改成了和 Pi 一样的做法。这类问题不会出现在教程里，只会出现在真正运行过的代码里。

## 七个工具，和 Pi 一样

mox 的工具集和 Pi 的内置工具一一对应：

| 工具 | 用途 | Pi 里默认启用？ |
| --- | --- | --- |
| `read` | 读文件，支持分段，截断时提示怎样接着读 | 是 |
| `edit` | 用精确文本替换修改文件，一次可以改多处 | 是 |
| `write` | 新建或整体覆盖文件 | 是 |
| `bash` | 执行任意命令 | 是 |
| `grep` | 按正则搜文件内容 | 否，用 `--tools` 打开 |
| `find` | 按 glob 找文件 | 否 |
| `ls` | 列目录 | 否 |

Pi 默认只启用前四个，搜索、列目录交给 `bash`。mox 没有 `--tools` 开关，七个全部给模型。这样做有一个很实际的理由：`grep`、`find`、`ls` 和 `read` 一样是**只读**的，`cli.ts` 的权限表里它们和 `read` 一起免确认（`const allowed = new Set(['read', 'grep', 'find', 'ls', 'task'])`）。如果搜索全走 `bash`，每次 `grep` 都要用户点一次“允许”，而一个只读的搜索工具可以安心地放行。

这是一个有意的取舍。工具少的好处是：工具说明占的上下文更少；模型面对的选择更少，选错工具的机会也更少；模型本来就熟悉 shell 命令。代价是：`bash` 的输出没有结构，权限控制只能针对命令字符串（第 14 章会看到这有多难），而且 shell 语法本身就是一个注入面。专门的搜索工具把一部分最常用的操作拿出来，换成结构清楚、可以免确认的形式。

::: compare Claude Code 的选择
Claude Code 走的是另一条路。它的官方文档把内置工具分成文件操作、搜索、执行、网络、代码智能几类，搜索有专门的工具，而不是全部交给 shell。专门的工具输出更规整、更好做权限规则（比如只允许读某个目录），代价是工具说明更长、模型要在更多工具之间做选择。两种设计都合理，面试时能讲清楚这个权衡就够了。（[How Claude Code works · Tools](https://code.claude.com/docs/en/how-claude-code-works)）
:::


七个工具都在 `codingTools(cwd)` 一个函数里，每个是一个 `{ name, description, parameters, run }` 对象（第 4 章的 `Tool`）。路径一律经过 `at()` 解析成相对工作目录的绝对路径：

@code mox/src/tools.ts#L26-L28

`resolve` 对绝对路径原样放行，所以 `read` 读 `/etc/passwd` 照样能读；`path` 没传时默认是 `'.'`，也就是工作目录本身（第 4 章实验里的 `EISDIR` 就是这么来的）。

## read：两道上限，和一句“接着读”

读文件的难点不在读，而在**读太多**。一个 5000 行的日志文件塞进上下文，不仅浪费钱，还会把真正重要的内容挤出模型的注意力。mox 的 `read` 这样写：

@code mox/src/tools.ts#L29-L44 hl=34,35,36,38,39,42

- **第 34、35 行**：读整个文件，按 `\n` 切成行；`offset` 超过文件长度就直接报错，错误信息里带着总行数。
- **第 36 行**：`slice` 取一段，`limit` 没传就取到末尾，再 `slice(0, MAX_LINES)` 套上 2000 行的上限。
- **第 37 到 39 行**：50KB 的上限。数一数从 `offset` 开始，累加每行的**字节数**（`Buffer.byteLength`），最多能放下几行（至少一行），超过就停。
- **第 42 行**：如果后面还有内容，在末尾加一句 `[显示了第 a–b 行，共 N 行；用 offset=b+1 接着读]`。

返回的是**原文，不带行号**。模型想改文件，靠 `edit` 的 `oldText` 精确匹配，不需要行号；要引用位置，用 `grep` 的“路径:行号”。省掉每行的行号前缀，也省了 token。

这两道上限先到的算数。这个实验把 mox 的 `read` 和 Pi 的 `read` 放在同样的文件上，最后一组是 `bash`：

@lab node labs/ch05/truncate.ts

前三组（5000 行的日志、每行 1000 字符的宽文件）两边几乎一模一样，连提示都一样：**截断时告诉模型下一步怎么做**。模型不需要推理，照着 `offset=2001` 去读就行。这是 Pi 的做法，mox 现在抄了过来：

@pi packages/coding-agent/src/core/tools/read.ts#L175-L198

第四组是每行 1000 个汉字的文件，它背后有一段修复的故事。mox 最初的实现用 `string.length` 数“50KB”：数的是**字符**，Pi 数的是**字节**。英文和代码里一个字符一个字节，没有差别；一个汉字是三个字节，所以同一个文件，早先的 mox 会读出 51 行、约 153000 字节，Pi 读出 17 行、51130 字节，上限松了三倍。这个差异是跑这个实验时发现的，现在 `read` 和 `clip` 都改成了按字节算：第 38 行用 `Buffer.byteLength` 累加每一行，第 12、13 行把输出转成 `Buffer`，超出就按字节切，再把可能被切成半个字的 `\uFFFD` 去掉。修复后的 mox 读出 17 行、51125 字节，和 Pi 只差几个字节（提示文字不同）。实验里同时跑了“旧写法”的模拟（按字符数累加），留下修复前的数字作对照。

最后一组是 `bash` 输出 20000 行：两边都**保留结尾**，因为命令的报错和测试的失败摘要几乎总在最后几行。区别是 Pi 把完整输出另存进临时文件，并把路径告诉模型，需要时可以用 `read` 或 `grep` 去查；mox 只说“前面省略了 N 个字符”，省略的部分就找不回来了。

::: insight 截断时要告诉模型下一步怎么做
被截断的输出，模型自己不知道。好的工具在截断处给出一句能直接照做的话：显示了哪一段、一共多少、用什么参数继续、完整输出在哪里。mox 的 `read` 做到了前两点；`bash` 的截断提示只说了省略多少，没说去哪里找回，这是它比 Pi 少的一点。
:::

### 模型写路径的各种习惯

路径解析看起来平淡无奇，但 Pi 在这里处理了不少真实世界的怪事：

@pi packages/coding-agent/src/core/tools/path-utils.ts#L40-L84

`stripAtPrefix`：模型常把对话里的 `@src/cli.ts`（很多界面用 @ 引用文件）原样当成路径。`tryMacOSScreenshotPath`：macOS 截图文件名里 AM/PM 前面是一个窄的不换行空格，用户在对话里复制粘贴时它变成了普通空格，文件就“找不到”了。`tryNFDVariant`：macOS 的文件系统用另一种 Unicode 规范形式（NFD）保存带重音或部分组合字符的文件名，和模型输出的形式（NFC）字节不同。这类代码不会出现在任何教程里，只会出现在被真实用户用过的产品里。mox 一概没有，路径对不上就是一个 `ENOENT`，错误文字会交回模型自己处理。

### 读文件时的取消

第 3 章说过，取消是协作式的：工具必须自己在可能阻塞的地方检查信号。mox 的 `read` 用的是同步的 `readFileSync`，读文件是一口气做完的，没有“中途取消”这回事（本地磁盘上这不是问题）。Pi 的 `read` 是异步的，每一个 `await` 回来时都检查取消标记：

@pi packages/coding-agent/src/core/tools/read.ts#L110-L128 hl=110,119,124,127

这样即使一次读文件卡在慢速的网络磁盘上，用户按下 Esc 之后工具也会立刻返回“已取消”，而不是等磁盘回应。

## write：整个覆盖

`write` 是七个工具里最短的之一：

@code mox/src/tools.ts#L45-L54

`mkdirSync(..., { recursive: true })` 先把父目录建好，再 `writeFileSync` 整个覆盖。它对已有文件**不会提醒**：模型调用 `write` 覆盖一个没读过的文件，工具照写不误，旧内容就没了。系统提示里那句“改文件前先读；小改动用 edit，新文件用 write”（第 6 章）是靠模型自觉守住的约定，不是工具强制的。

Pi 的 `write` 做同样的事，但整个写入包在 `withFileMutationQueue` 里（第 4 章），和 `edit` 共用同一个按文件路径分组的队列。

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

### mox 的 edit：二十行，三种结果

@code mox/src/tools.ts#L55-L79 hl=64,65,66,67,71,72,76

参数是 `path` 加一个 `edits` 数组，每项是 `{ oldText, newText }`，和 Pi 的 `edit` 一模一样。`run` 的第 62 行还兼容顶层直接写 `oldText` 和 `newText`（模型有时会这样写，Pi 也兼容）。整个流程：

- **第 64 到 68 行**：对每一处修改，数 `oldText` 在**原文件**里出现几次（第 65 行），不是恰好一次就抛错；恰好一次就记下它的起止位置。
- **第 69 行**：按位置排序。所有位置都是对着原文件找的，不是逐段累积，所以几处修改的先后顺序无关紧要。
- **第 71 到 75 行**：从前往后拼接结果。如果后一处的起点在前一处的终点之前（第 72 行），说明两处重叠了，抛错。
- **第 76 行**：写回磁盘，返回“已修改 path（N 处）”。

两种错误信息都写成了**可以照做的指令**：“oldText 出现了 N 次，请带上更多上下文让它唯一”“oldText 在文件里找不到，先 read 再改”，后面还附上这段 `oldText` 的前 80 个字符，方便模型对上是哪一处。第 4 章说过，异常信息会被 `execute` 变成“错误：……”交回模型，所以它就是下一轮的提示。因为结果是按位置切片拼接出来的，`newText` 里的 `$&`、`$1` 不会被当成正则替换模式，原样写入。

### 把它推到边界

这个实验用十一种情形，把同样的修改请求交给 mox 和 Pi 真实的 `edit`，比较磁盘上的字节：

@lab node labs/ch05/edit.ts

前面几种情形两边一致：精确匹配成功；两处修改都对照原文件匹配，顺序不影响结果；`oldText` 出现两次、找不到、两处重叠，都拒绝。**唯一性检查是搜索替换的底线**，没有它，“把 `return a - b;` 改成 `return a + b;`”会悄悄改到文件里第一个匹配的位置，不一定是模型想改的那个。

接下来三种情形是 mox 和 Pi 分叉的地方，它们有同一个原因：**模型抄得几乎对，差几个看不见的字符**。

- 行尾多了空格：文件里 `{` 后面有三个空格，模型没抄；
- 弯引号和直引号：文件里是 `“Mox”`，模型写成了 `"Mox"`；
- Windows 换行：文件用 `\r\n`，模型写的多行 `oldText` 里是 `\n`。

mox 对三种都回答“oldText 在文件里找不到”，模型要重新 `read`，再抄一遍。多一次往返，但不会改错。Pi 把它们救了回来。倒数第三行里还能看到一个对比：同样的 Windows 文件，**单行**的 `oldText` 在 mox 里也能成功，换行符和文件开头看不见的 BOM 都原样保留了，因为只有匹配到的那一段被切掉重拼。

最后一行：`oldText` 和 `newText` 一样时，mox 照写不误（“已修改 1 处”），Pi 认为这次修改没有意义，直接报错，提醒模型“可能是特殊字符的问题”。

### Pi 怎么做：模糊匹配

Pi 匹配修改内容的核心函数：

@pi packages/coding-agent/src/core/tools/edit-diff.ts#applyEditsToNormalizedContent collapse=true

它依次检查：`oldText` 不能为空；先精确匹配，找不到再模糊匹配；必须唯一；多段修改不能重叠；修改后内容必须有变化。最后从后往前应用替换，这样前面的修改不会改变后面修改的位置。模糊匹配靠归一化：

@pi packages/coding-agent/src/core/tools/edit-diff.ts#normalizeForFuzzyMatch

弯引号变直引号、行尾空格去掉、各种破折号变连字符、特殊空格变普通空格。这些差异肉眼几乎看不出来，模型也很难避免。归一化之后再匹配，就能命中。

但模糊匹配带来一个新问题：如果直接把归一化后的整个文件写回磁盘，文件里**其他地方**的弯引号也会被改成直引号。用户只让你改一行，你却改了一百行。Pi 的做法是只把“修改涉及的那几行”写回，其余行保留原始字节：

::: steps 一次 edit 怎样把直引号匹配到弯引号
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


Pi 的 `edit` 一次可以做多处修改，参数说明把规则写得非常具体：

@pi packages/coding-agent/src/core/tools/edit.ts#L20-L48

“每段都对照**原文件**匹配，而不是逐段累积”“不要包含大段未改动的内容”“离得近的修改请合并”：这些都是从模型的实际错误里总结出来的约束。

### 写文件时的取消

Pi 的 `edit` 执行部分有一段很容易被忽略的注释：

@pi packages/coding-agent/src/core/tools/edit.ts#L156-L170

第 3 章讲过，取消是通过监听信号实现的。但这里**刻意不**在监听器里立刻放弃，而是在每一步文件操作之后检查 `signal.aborted`。原因是：如果在监听器里立刻抛错，第 4 章的文件修改队列会被释放，下一个修改同一文件的工具就会开始执行，而上一个写入可能还没真正完成，两个写入交错，文件就坏了。**取消要快，但不能快到破坏一致性。**

mox 没有这个问题，原因很简单：`edit` 的 `run` 是同步函数，从读文件到写回在同一个事件循环 tick 里做完，中间没有 `await`，任何别的代码都插不进来。它也不需要文件修改队列，哪怕你按第 4 章的办法让工具并行执行，同一个文件上的两个 `edit` 也不会丢更新（本章末尾的预测题会验证这一点）。

## bash：最有用，也最危险

`bash` 让模型能做几乎任何事：跑测试、装依赖、看 git 历史。mox 的实现：

@code mox/src/tools.ts#L80-L105 hl=87,89,90,92,96,97,100,101,102

这 25 行里有五件事，每一件都对应一个踩过的坑：

- **独立的进程组**（第 87 行）：`detached: true` 让 `bash` 成为一个新进程组的组长。命令里启动的所有子进程都在这个组里。
- **杀整个组**（第 89 行）：`process.kill(-child.pid, 'SIGKILL')`，pid 前面的负号指向**整个进程组**。超时（第 90 行的计时器）和取消（第 92 行的 `abort` 监听）走的都是这个 `kill`，并且记下原因 `stopped`。
- **默认不限时**（第 83、90 行）：`timeout` 没传就不设计时器。模型想限制才会传。
- **等 `exit`，不等 `close`**（第 96、97 行）：`exit` 在 `bash` 自己结束时触发，`close` 要等输出管道关闭。如果命令把一个进程放到后台（比如 `npm start &`），那个进程会一直握着管道，`close` 永远不来。所以 mox 等 `exit`，再等 50 毫秒让最后一批输出到达，然后收工。
- **非零退出码是错误**（第 100 到 102 行）：正常退出（`code === 0` 且没有被主动终止）才 `done`，否则 `fail`，把输出和 `[退出码 N]` 或 `[超时 N 秒，已终止]` 一起放进异常。第 4 章说过，异常会被 `execute` 变成“错误：……”，界面上显示 ✗，模型也能一眼看出这次失败了。输出过长时，`clip` 保留**结尾**。

### 为什么要这么写：复现 mox 最初的版本

这些写法是被一个具体的问题逼出来的。mox 最初的 `bash` 更简单：

```ts
const child = spawn('bash', ['-c', command], { cwd, signal, timeout: timeout * 1000 });
child.on('close', (code, killedBy) => done(clip(`${output}\n[${code === null ? `被 ${killedBy} 终止` : `退出码 ${code}`}]`)));
```

超时和取消交给 `spawn` 自带的 `timeout`、`signal` 选项，等 `close` 事件，退出码写进文字里。读起来没有毛病。这个实验让命令在后台再启动一个 `sleep`（模拟 `npm test` 拉起的测试进程），自己也 `sleep` 3 秒，分别在超时 1 秒、0.5 秒后取消两种情形下，看工具多久返回、命令的 `sleep` 进程还剩几个。三个实现是：上面那个朴素版本（实验里原样重写了一份）、现在的 mox、Pi：

@lab node labs/ch05/bash.ts | md

朴素版本这两行的数字值得细看：

- **超时**：1.5 秒时还有 2 个 `sleep` 活着，工具**用了约 3 秒才返回**，而 `timeout` 设的是 1 秒。`spawn` 的 `timeout` 选项只向 `bash` 这一个进程发 `SIGTERM`。`bash` 死了，它启动的两个 `sleep` 变成孤儿进程，继续握着标准输出的管道。`close` 事件要等管道上所有写端都关闭才触发，于是工具一直等到 `sleep` 自己睡醒。如果后台是一个开发服务器，这一等就是永远。
- **取消**：0.5 秒时工具立刻返回了，因为 `error` 事件不等管道。但返回的时候，2 个 `sleep` 还活着，没有人再管它们。

现在的 mox 和 Pi 的数字完全一样：1.5 秒时一个子进程也不剩，工具按时返回，超时和取消都是错误。这一行最后三条是同一个命令 `echo 失败了 >&2; exit 3` 的结果：朴素版本把它当作正常结果（界面上绿色的 ✓，模型要自己读那行 `[退出码 3]` 才知道失败），mox 和 Pi 都把它标成错误。

朴素的做法只杀 `bash` 本身，它启动的进程就成了孤儿。在真实场景里，这可能是一个占着端口的开发服务器，或者一个还在写文件的测试进程。Pi 的办法和 mox 一样：

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



两者的不同在细节。Pi 的 `bash` 把完整输出保存在临时文件里，所以输出再长也能找回；它的结果同时带 `content`（给模型的文字）和 `structuredContent`（给程序的结构化数据：完整输出、是否截断、退出码、耗时），第 4 章说过，给模型的要精炼，给程序的要完整。非零退出码的处理，两边是同一个判断：

::: tabs
@@ Pi
@pi packages/coding-agent/src/core/tools/bash.ts#L383-L407
@@ mox
@code mox/src/tools.ts#L100-L102
先看有没有被主动终止，再看退出码；非零就是错误。mox 用抛异常表达，Pi 用 `isError: true`。
:::

::: warn 工作目录不是沙箱
`bash` 在项目目录里启动，但它能访问当前用户能访问的一切。`cd ~ && rm -rf .`、读取 `~/.ssh`、把代码发到外网，工具本身没有任何限制。路径解析也一样：`read` 接受绝对路径，`/etc/passwd` 照样能读。第 14 章的权限规则和第 15 章的沙箱会处理这个问题。在那之前，不要在重要的目录里用真实模型运行 mox；它的 `edit`、`write`、`bash` 默认会向你确认，`--yolo` 才会跳过。
:::

## grep、find、ls：搜索也值得做成工具

这三个工具的实现都很短，核心是 Node 自带的 `fs.globSync` 和正则。先看它们共用的 `files` 函数：

@code mox/src/tools.ts#L17-L20 hl=19

`globSync` 在 `root` 下按 glob 找文件，`exclude` 回调跳过名字是 `.git` 或 `node_modules` 的目录，再过滤出普通文件并排序。`grep` 用它列出要搜的文件，逐个读入，跳过含 `\0` 的二进制文件，逐行用正则匹配，输出“路径:行号: 内容”（`context` 参数大于 0 时，前后的行用 `-` 而不是 `:` 标记）；`find` 直接返回这个文件列表；`ls` 用 `readdirSync` 列一层，目录名后面加 `/`。三个工具都有 `limit`，超出时在末尾说明“只显示前 N 个”。

这个实验在一个临时项目里跑它们：项目里有源码、被 `.gitignore` 排除的构建产物 `build/`、`node_modules` 和 `.git`：

@lab node labs/ch05/search.ts

从输出可以读出三件事：`ls` 什么都列，包括 `.git/` 和 `node_modules/`；`find '*.js'` 和 `grep 'TODO'` 都跳过了 `node_modules` 和 `.git`，但**没有跳过 `build/`**，尽管它写在 `.gitignore` 里；超过 `limit` 时，结果末尾会说明“已达到 1 处的上限”。

最后一点就是 mox 和 Pi 的区别。Pi 的 `grep` 和 `find` 调用 `rg`（ripgrep）和 `fd`，它们天生遵守 `.gitignore`、速度快、能处理巨大的仓库；代价是依赖外部程序，Pi 会在找不到时下载它们：

@pi packages/coding-agent/src/core/tools/grep.ts#grepToolSystemPromptContribution

它的提示片段里直接写着“respects .gitignore”。mox 零依赖，所以用 `globSync` 加硬编码的两个目录，在小项目里够用，在有大量构建产物的项目里会搜出很多噪音。想让它遵守 `.gitignore`，要么自己解析 `.gitignore`，要么在 `bash` 里调 `rg`。

## 装起来：mox 第一次改代码

零件都读过了，现在看它们怎么装在一起。`mox/src/cli.ts` 里有一块把循环、工具和事件接到一起的代码：

@code mox/src/cli.ts#L108-L132 hl=109,129,130

第 108 到 117 行是传给 `runLoop` 的选项：模型、系统提示、工具、取消信号、权限钩子（第 4 章），以及两处我们后面章节才用到的接口（`steer` 插话、`compact` 压缩）。第 129 行就是 `runLoop` 的那一次调用，其余的都围绕它：把用户输入追加进会话、把事件打印出来、`agent_end` 让扩展有机会续跑。**mox 的命令行本身就是这一个调用加上一圈外围。**

权限在第 4 章的 `beforeTool` 里：只读的 `read`、`grep`、`find`、`ls` 直接放行，其他工具默认要用户确认（输入序号选择允许、本次会话都允许或拒绝），`--yolo` 才跳过。下面两个实验都用 `--yolo` 的方式，所以不会停下来问。

### 先用脚本模型跑一遍

真实模型每次的表现都不同。要把整条链路看清楚，先用脚本模型代替它：模型的每一次回复是写死的，其余全是真的，包括 mox 的 `runLoop`、七个编程工具和临时目录里一个有 bug 的小项目。项目只有两个文件：`calc.js` 里的 `add` 写成了减法，`sub` 的函数体和它一模一样；`test.js` 是三条断言。

@lab node labs/ch05/fix-bug.ts

读这份记录，注意几处：

- **先验证再动手**：第一步不是改，是 `node test.js` 看失败。测试失败时退出码非零，所以这一条是 ✗，错误结果里带着 `AssertionError: add(2, 3) 应该是 5`。这是预期的失败，对模型来说就是它想要的信息。
- **第一次 `edit` 被唯一性检查拦下**：`return a - b;` 在 `add` 和 `sub` 里各出现一次，工具说“oldText 出现了 2 次，请带上更多上下文让它唯一”。脚本里的模型照做，把 `function add(a, b) {` 也带上，第二次成功。如果没有这一道检查，第一次调用会悄悄改掉文件里第一个匹配到的位置。
- **`sub` 没有被误改**：实验的断言要求 `sub` 的函数体仍然是 `a - b`。
- **一共 6 次请求**，其中 5 次是“工具调用 + 结果”，最后一次是文字回答。

### 再看一次真实的运行

下面是真实模型做同样事情的记录。模型是 MiniMax-M3.1-Flash，通过 OpenAI 兼容接口调用，用的是 mox 的命令行（`mox -p "运行 node test.js，修好失败的测试" --yolo`）。录制下来的是模型每一次回复；回放时由脚本模型把它们原样吐出来，工具则在一份全新的项目副本上重新执行：

@lab node labs/ch05/replay.ts

这段记录里有几处值得注意：

- **一条回复里有多个工具调用**：第 1 次请求里模型同时要 `ls` 和 `read test.js`，第 2 次同时读了两个文件。第 4 章说过，mox 对这些调用是**一个接一个**执行的；Pi 则会并行。
- **先看、再测、再改、再验证**：`ls` 和 `read` 了解项目，`node test.js` 复现失败，读了 `calc.js` 才发 `edit`，`oldText` 里带上了函数头，一次就唯一；改完再跑一次测试。这是系统提示里要求的工作方式。
- **失败的测试是一条 ✗**：模型第一次跑 `node test.js`，退出码是 1，结果标成错误，它没有慌，直接读出断言信息，下一步就去改。
- **最后的回答**：说明了问题、修改和验证结果。

要自己运行，先装好 mox（它零依赖，要求 Node 22.18 或更新），设置三个环境变量，在示例项目的副本里执行：

```bash
cd mox && npm link          # 之后任何目录都能用 mox 命令；也可以直接 node mox/src/cli.ts
export MOX_BASE_URL=https://api.minimaxi.com/v1
export MOX_API_KEY=你的Key
export MOX_MODEL=MiniMax-M3.1-Flash

cp -R labs/fixtures/calc-bug /tmp/calc-bug && cd /tmp/calc-bug
mox -p "运行 node test.js，修好失败的测试"    # 去掉 --yolo：每次 edit 和 bash 都会问你
```

::: insight 到这里，mox 已经是一个真正的 coding agent
它有流式输出、能处理截断和失败的循环、带钩子的工具流水线、和 Pi 一样的七个工具。剩下的章节要解决的，是让它在更长、更复杂、更危险的任务里依然可靠：上下文会不会爆、会话能不能恢复、权限怎么控制、多个 Agent 怎么协作。
:::

## 你来改

::: predict 把 bash 里的 detached 去掉
`mox/src/tools.ts` 第 87 行去掉 `detached: true`，保留第 89 行的 `process.kill(-child.pid!, 'SIGKILL')`，再让模型跑 `sleep 3.7 & sleep 3.7; wait`，`timeout` 设为 1 秒。工具多久返回？返回的文字是什么？
???
工具要等约 3.7 秒才返回，返回的文字却是“[超时 1 秒，已终止]”。原因：不加 `detached`，`bash` 和 mox 自己在同一个进程组里，`-child.pid` 指向的进程组不存在，`process.kill` 抛出 `ESRCH`，被第 89 行的 `try/catch` 吞掉，什么都没杀。`stopped` 已经被设成了“超时”，所以文字说的是超时，实际却是命令自己跑完才结束。这是一类很隐蔽的错误：错误处理把真实的失败吞掉，还给出一条好看的消息。（这个结论是在 `tools.ts` 的一份拷贝上只改这一处、实际运行得到的。想自己试，复制一份到实验目录里改，不要直接改 `mox/`。）
:::

::: predict 同一个文件上的两个 edit 并行执行
把第 4 章的 `runLoopParallel` 用在 mox 的工具上，模型一条回复里发了两个 `edit`：一个把 `a = 1` 改成 `a = 10`，另一个把 `b = 2` 改成 `b = 20`，都在 `f.txt`。两个修改都会保留吗？
???
会都保留，`f.txt` 变成 `a = 10\nb = 20`。因为 mox 的 `edit` 是同步函数：`readFileSync` 到 `writeFileSync` 之间没有 `await`，`Promise.all` 里的两个 `run` 是一个接一个、各自完整地跑完的，不会交错。如果把 `edit` 改成异步（`await readFile`、`await writeFile`），两个调用就会各自读到旧内容，后写的覆盖先写的，丢掉一个修改。Pi 的 `edit` 是异步的，所以才需要 `withFileMutationQueue`。同步函数天然串行，是 mox 的一个隐含好处，同时也意味着它读写大文件时会阻塞整个进程。
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

工具不是越多越好：每个工具的说明都占上下文；选择越多，模型选错的概率越高。但专门的工具也有好处：输出结构化、权限可以细粒度控制（mox 把 `grep`、`find`、`ls` 和 `read` 一样免确认，而 `bash` 里的 `grep` 要问）、避免 shell 注入。Pi 默认只给四个，mox 给七个，Claude Code 提供了专门的搜索工具，是不同的取舍。好的回答要说出取舍，而不是给一个“标准清单”。
:::

::: interview 文件编辑工具为什么普遍采用“搜索替换”，而不是行号或整文件重写？
- 整文件重写：改一行也要输出全文，慢、贵，长文件容易漏内容。
- 行号：模型数行号不可靠，而且一处修改会让后面的行号全部失效。
- diff：格式严格，模型经常写错。
- 搜索替换：模型最擅长原样复制它刚读过的文字，只需要保证原文唯一。

实现要点：唯一性检查（找不到、多次都报错，错误信息写成可以照做的指令）、一次调用可以改多处且都对照原文件匹配、不能重叠、结果按位置切片拼接（避免 `$&` 被当成替换模式）、模糊匹配（弯引号、行尾空白）但只写回改动的行、保留原文件的换行符和 BOM、修改后内容必须有变化。mox 做了前面几条，后面几条是 Pi 在真实使用里补出来的。
:::

::: interview 执行 shell 命令的工具要注意哪些问题？
- **超时与取消**：杀掉整个进程树，而不是只杀 shell。只杀 shell 的后果是子进程变成孤儿，还握着输出管道，`close` 事件迟迟不来，工具被拖住甚至永远挂起（mox 最初用 `spawn` 的 `timeout` 选项就是这样）。做法：`detached` 开一个新进程组，对 `-pid` 发信号；等进程的 `exit` 而不是 `close`。
- **输出**：截断并告诉模型怎么继续；保留结尾（报错在最后）；Pi 还把完整输出存文件。
- **结果**：非零退出码要标记为失败；同时保留结构化信息（退出码、耗时、是否截断）给程序使用。
- **安全**：工作目录不是沙箱，命令能访问当前用户能访问的一切，需要权限规则和系统级隔离。
:::

::: interview 工具输出太长时怎么处理？
设行数和字节数两个上限，先到先算。根据内容选择保留方向：文件保留开头，命令输出保留结尾。截断时给出可执行的提示（下一段用什么参数读、完整输出在哪个文件），让模型能自己继续，而不是丢失信息。

细节：“字节”和“字符”不是一回事，中文一个字三个字节，用字符数近似会让上限松三倍（mox 早先的做法，实验里能看到）；切字节时还要去掉被切断的半个字。更进一步：大输出放在给程序的结构化数据里，只把摘要发给模型；工具结果太多时，由上下文压缩处理（第 8 章）。
:::

::: interview 编辑文件时，取消操作需要注意什么？
取消要及时，但不能破坏一致性。如果在取消信号的回调里立刻放弃，可能出现：文件修改的锁被释放，下一个修改同一文件的操作开始执行，而上一次写入其实还在进行，两次写入交错导致文件损坏。

更稳妥的做法是在每一步文件操作完成之后检查取消标记，让正在进行的操作完整结束再退出。mox 的 `edit` 回避了这个问题：它是同步函数，读和写之间不会被别的代码插入。
:::
