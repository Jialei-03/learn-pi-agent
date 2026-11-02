# Session 与 Compaction：亲手推演一次会话压缩

Pi 读出一个很大的文件，文件内容刚进入工具结果，窗口已经快满了。如果按长度截掉前面几条消息，保留下来的第一条可能是「这里是结果」，却找不到「谁请求了它」。Pi 怎样选切点，又怎样让下一轮模型接着工作？我们用上游回归测试中的五条消息推演。测试的输入、预期切点和摘要材料都可在源码中核对。为便于跟踪，下文为记录另取短 ID，摘要文字采用教学示例。[大工具结果的回归测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/compaction.test.ts#L378)

![Mox 从会话中的旧消息选择摘要范围和保留的尾部](../assets/session-memory-illustrations/04-compaction-cut-and-rebuild.png)

## 1. 文件里有整棵树，运行时先选一条路

磁盘会话使用 JSONL，一行记录一个 JSON 对象。文件有会话头，后续 Entry 包含自己的 `id`、`parentId`、时间、类型和相应的数据。下面是两条教学记录的**字段投影**，仅展示解释分支需要的字段。真实消息还会记录时间等元数据。

```json
{"type":"message","id":"a","parentId":null,"message":{"role":"user","content":"old history"}}
{"type":"message","id":"b","parentId":"a","message":{"role":"assistant","content":[{"type":"text","text":"old answer"}]}}
```

追加消息时，新 Entry 的父节点就是当前叶子。`_appendEntry` 把它添加到列表和 `byId` 索引，把叶子改成它的 ID，然后根据持久化配置写入文件。写入抛错时，函数撤销刚才的内存修改，让后续记录不会指向一个写入失败的父节点。开启文件持久化时，首次遇到用户或 assistant 对话会把此前积累的记录一并写出，后续通常逐行追加。[追加与落盘](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L1167)

如果 `b` 之后有两次尝试，记录可能是这样。

```text
a ─ b ─ c ─ d ─ e       读取 big.txt 的路径
      └ f                从 b 改为询问另一个文件
```

选叶子 `e` 时，`buildSessionPath` 从 `e` 逐次查 `parentId`，依次得到 `e,d,c,b,a`，再反转得到 `a,b,c,d,e`。选 `f` 时结果是 `a,b,f`。即使 `f` 是磁盘中最后追加的一行，它也不会进入以 `e` 为叶子的投影。若只看文件最后几行，可能刚好看错了分支。[路径选择与模型设置](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L390)

### 从一串磁盘记录读取四份不同的信息

刚才选出的是路径，还没选出模型消息。`buildSessionProjection` 同时构造两种视图。`entries` 中每项仍携带原始 `sourceEntry` 和由它产生的 `messages` 数组，`messages` 则是把这些数组摊平成一条消息流。要回答「模型能读什么」，用后者。要回答「这段内容能追溯到文件里的哪一行」，前者才保留足够信息。这里绝不能假定数组下标始终相等。一个普通自定义状态条目能产生零条消息，一条带系统检查点的压缩记录却可以产生系统消息和摘要两条。

模型选择与思考级别还有另一条路径。投影先扫描当前叶子的完整祖先链来恢复设置，随后才按压缩边界选消息。设用户选中模型 M，然后在长对话里压缩，写有模型选择的那条旧记录可能不在保留区里，恢复的模型仍可以是 M。相反，改走一个在选择 M 之前就分出的分支，后面发生在另一个分支的设置变化就不在这条祖先链上。若同时调试「怎么用了这个模型」与「为什么没看到这句话」，应分别打印沿途模型变更与投影后的消息。[设置恢复与投影过程](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L418)

## 2. 压缩有两个独立的决定

第一个决定是**什么时候压**。`shouldCompact` 用上下文估算量和模型窗口做比较。依照下面的源码，若窗口为 100,000、预留 10,000，90,000 还没过线，90,001 才过线。显式手动压缩可以直接进入准备流程。

源码摘录：[packages/coding-agent/src/core/compaction/compaction.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L267)

```ts
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}
```

第二个决定是**压缩后保留哪段原文**。`prepareCompaction` 先按活动路径生成投影，把记录同模型可见消息关联起来，再让 `findProjectedCutPoint` 按 `keepRecentTokens` 寻找边界。因此改变预留量会影响触发时机；改变保留目标会影响切分位置。下面只推演第二个决定，沿用测试给定的 1,000 tokens。

## 3. 五条记录，边界在哪里

| ID | 父节点 | 消息与核心字段 | 可能作为保留区开头 |
| --- | --- | --- | --- |
| a | 无 | user，`old history` | 可以 |
| b | a | assistant，`old answer` | 可以 |
| c | b | user，`read the large file` | 可以，也是新 turn 的开始 |
| d | c | assistant，`read({path:"big.txt"})`，调用 ID 是 `call-1` | 可以 |
| e | d | toolResult，`toolCallId:"call-1"`，正文是 8,000 个 `x` | 不可以 |

一个 **turn** 在这个切分算法里可以包含「用户输入 → assistant 请求工具 → 工具结果 → assistant 回应」。Entry ID `d` 用来沿会话树走，`call-1` 用来配对调用和结果，两个标识解决不同问题。

1. 扫描候选。`isCutPointMessage` 接受 user、assistant 等角色，排除 toolResult。因此候选位置是 `[a, b, c, d]`。
2. 从尾部往前累加估算。`e` 的文本粗估 `ceil(8000 / 4) = 2000` tokens，单独这一条就已达到 1,000 的目标。
3. 在 `e` 或之后寻找合法切点，找不到时取候选表最后一个，也就是 `d`。因此保留 `d,e`。尾部会超过 1,000，但调用和结果能一起重放。
4. 检查 `d` 的角色。assistant 可以作为切点，却不能独立算一个用户 turn 的开始。算法向前追到 `c`，因此 `isSplitTurn = true`，`turnStartIndex = 2`。

这解释了为何「保留最近 1,000」不能翻译成「恰好留下最后 1,000 个 token」。选择单位是消息及其关系，切点本身是会话 Entry 的位置。实际实现还处理不可见编辑、元数据和以前的压缩记录，本例恰好没有这些分支。[候选规则](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L351) · [投影上的切点算法](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L789)

### 把「大文件」换成一个小文件

仍用相同的五条记录，把 e 的内容缩短为四个字母，再按同一个保留目标重算。e 的估算量变为一个 token，再加上很短的工具名、参数、用户和助手文本，整段仍小于一千。算法从末尾一直走到开头都没有跨过预算，初始切点停在最早的合法位置 a。切点前没有完整历史，也没有被拆开的前缀，准备函数检查两个待摘要数组都为空，会返回 `undefined`。因此**请求压缩**与**已经生成新的检查点**之间，有一次「是否有材料可折叠」的决策。反复点击压缩不能靠次数制造有意义的摘要。

再换一个条件：历史中有一轮完整的问答足以被切走，而第一个保留下的 Entry 恰好是一条用户输入。这次切点就是新一轮的开始，`isSplitTurn` 为假。前面的问答只要进入历史摘要，保留区已经有原始请求，完全不用再为它生成当前 turn 的前缀说明。普通整轮切分和前面保住 d、e 的分轮切分，差别正是下一段原文能否自带发起任务的上下文。[准备阶段的空材料与分轮判断](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L859)

## 4. 一个切点分出三份材料

确定 `d` 后，函数先把它的源记录 ID 放进 `firstKeptEntryId`。注意 `slice(start, end)` **含起点、不含终点**，所以同一个下标可以同时充当前一段的终点和后一段的起点。

源码摘录：[packages/coding-agent/src/core/compaction/compaction.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L887)

```ts
const firstKeptEntry = projectedEntries[cutPoint.firstKeptEntryIndex]?.sourceEntry;
if (!firstKeptEntry?.id) return undefined;
const firstKeptEntryId = firstKeptEntry.id;
const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

const messagesToSummarize = projectedEntries
	.slice(boundaryStart, historyEnd)
	.flatMap(getMessagesFromProjectedEntryForCompaction);
const turnPrefixMessages = cutPoint.isSplitTurn
	? projectedEntries
			.slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
			.flatMap(getMessagesFromProjectedEntryForCompaction)
	: [];

if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;
```

在本例中，`boundaryStart=0`，`historyEnd=turnStartIndex=2`，`firstKeptEntryIndex=3`。于是结果如下。

| 范围 | 记录 | 如何使用 |
| --- | --- | --- |
| `[0, 2)` | a、b | `messagesToSummarize`，总结已完成的历史 |
| `[2, 3)` | c | `turnPrefixMessages`，交代这个尚在进行的 turn 的原始请求 |
| `[3, 5)` | d、e | 保留原始调用和工具结果，以后仍可按 `call-1` 配对 |

上游回归测试同时调用切点函数和 `prepareCompaction`。第一组断言检查索引和分轮状态；第二组直接检查三项数据。即使一个实现碰巧返回 `d`，若把 `c` 混入历史摘要，第二组断言仍会失败。

源码摘录：[packages/coding-agent/test/compaction.test.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/compaction.test.ts#L404)

```ts
const preparation = prepareCompaction(entries, {
	...DEFAULT_COMPACTION_SETTINGS,
	keepRecentTokens: 1000,
});
expect(preparation?.firstKeptEntryId).toBe(toolCall.id);
expect(preparation?.messagesToSummarize).toEqual([oldUser.message, oldAssistant.message]);
expect(preparation?.turnPrefixMessages).toEqual([currentUser.message]);
```

在默认 `compact` 路径中，普通整轮切分只需要历史摘要；这个分轮案例有两个部分。`generateSummaryWithUsage` 总结已完成的历史，`generateTurnPrefixSummary` 专门总结当前 turn 较早的部分，最后合并成一个 `summary`。若已存在上一轮摘要，准备阶段还会取出 `previousSummary`；系统提示有专门的检查点，生成对话摘要时会滤掉系统消息。实现还从被选材料中提取读写过的文件并整理进结果。[摘要合并与文件记录](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L952)

## 5. 写入后，下次恢复实际会读到什么

[逐步查看会话投影](../examples/read-loop/projection.mjs)

假设两段摘要合起来表达「此前完成了旧任务；本轮用户要求读取大文件」。实际文字由摘要模型生成。`appendCompaction` 在 `e` 后面追加一条记录，我们称为 `x`。

```json
{
  "type": "compaction",
  "id": "x",
  "parentId": "e",
  "firstKeptEntryId": "d",
  "summary": "此前完成了旧任务；本轮用户要求读取大文件。"
}
```

这份教学投影省略时间、`tokensBefore`、usage、文件详情等字段。如果活动投影中有系统消息，`appendCompaction` 还会把当时的有效系统状态一同保存为 `systemMessage`。这样即使旧系统消息落入摘要范围，也能恢复指令与工具声明。[压缩 Entry 的构造](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L1271)

现在重新打开并选择 `x`。原始路径仍是 `[a,b,c,d,e,x]`。`buildContextEntries` 找到路径上最新的压缩记录，先放 `x`，再从 `firstKeptEntryId` 起收集压缩前的保留记录，最后接上压缩后新增的记录。在这个例子里得到 `[x,d,e]`。如果又追加一条 `y`，则变成 `[x,d,e,y]`。保留范围中的旧系统消息由检查点代表，避免重复重放。[保留区重建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L468)

`buildSessionProjection` 再把 Entry 投影为消息。`x` 贡献系统检查点（如有）和一条 `compactionSummary`；`d` 贡献 assistant 工具请求；`e` 贡献工具结果。上一章的 `convertToLlm` 会把 `compactionSummary` 转成带 `<summary>` 标记的用户角色文本。所以下一次送去适配的顺序是：

```text
系统检查点（若保存）
    ↓
user       <summary>合并后的摘要</summary>，前面带有压缩说明
    ↓
assistant  toolCall id=call-1，read({path:"big.txt"})
    ↓
toolResult toolCallId=call-1，正文仍是原文
```

压缩把旧材料从活动请求中折叠起来，原始 JSONL 里仍然能找到 `a,b,c`。另一个机制 `context_edit` 则能对特定 `targetId` 替换或省略内容。投影先收集当前范围里对同一 ID 的最后一次编辑，再应用到该条记录；`replacement: null` 使这条记录贡献零条消息。这就是磁盘占用、界面历史和模型输入会有不同长度的具体原因。[投影与编辑](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/session-manager.ts#L520)

### 再压一次，上一份摘要放在哪里

设第一次压缩把「确认要支持空文件」写进摘要 S1，保留了后续调查。又过几轮，调查已经完成，新的保留边界移动到了修复步骤。若第二次把全量原文重新发给摘要模型，旧材料会反复消耗窗口；若只总结本轮调查，原始目标又会丢失。`prepareCompaction` 从当前投影里定位**最近且实际产生了消息的压缩条目**，取出它的 `summary` 作为 `previousSummary`。本次扫描从它后面开始。第一次保留的调查记录如果现在落在新边界之前，就进入本次的待摘要材料；已经折叠进 S1 的原始条目不需要再走一遍。

默认生成器还有一个与普通对话不同的调用方式。它先把需总结的消息变成可供模型阅读的文本，把旧摘要（如果存在）和新材料组织成独立的摘要请求，选择「更新已有摘要」或「首次生成摘要」的提示。这样模型面对的问题是如何更新工作记录，而不是继续执行材料中较早的一句用户命令。历史中的工具调用、结果、错误由序列化过程提供证据，旧摘要给出此前选取的目标与决定。如果 S1 漏掉某个事实，而新的待摘要材料也未提及，该事实就不会凭空从已经折叠的原文里再次出现。[摘要输入的构造](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/compaction/compaction.ts#L696)

写下新检查点 S2 后，活动路径可能仍经过 S1 所在的旧记录。举例说，若第二次仍从 b 起保留，按磁盘顺序看会遇到 b、S1、补充材料、S2。重建时 S2 被放到投影首位；扫描保留区时经过的 S1 虽有原始 Entry，但投影消息数为零。否则模型先读完 S2，又读到较旧的 S1，既浪费窗口，也可能把新决定误解成尚未发生。测试专门让第二次压缩保留一个在旧检查点之前的条目，断言消息里只有第二份摘要。[重复压缩的投影测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/session-context-edit.test.ts#L161)

### 故意改一条旧消息，再恢复一次

课程的离线程序使用真实 `SessionManager`，用固定文本代替摘要模型的回答。这样每次运行都能看到完全一样的检查点选择。先在课程仓库根目录运行以下命令。[示例源文件](../examples/read-loop/recompact.mjs)

```bash
cd examples/read-loop
npm ci
node recompact.mjs
```

```text
第一次压缩  摘要一 → 保留项
追加编辑后  摘要一 → 保留项（修订）
第二次压缩  摘要二 → 保留项（修订） → 后来补充
保留零条  交接摘要
切回旧叶子  旧材料
```

第二行发生在已有检查点之后：程序没有覆写「保留项」的磁盘记录，而是追加一条针对它的编辑。投影先收集 `targetId` 到最后一次编辑的映射，再决定目标记录贡献什么内容。第三行说明这项修订可以跨过新的压缩条目继续作用，只要相应记录仍在本次保留范围内。第四行给 `appendCompaction` 的保留起点是 `null`，管理器用新检查点自己的 ID 作为界标，在它之前找不到一个要保留的尾段。第五行又把叶子选回最早的用户记录，后来产生的编辑和检查点都变成了另一条路径上的事情。程序同时断言这些值，换一个叶子就能看到同一套底层记录生成另一种视图。

这也影响 token 估算。如果历史 assistant 消息曾报告 10,001 个 tokens，其中大头是后来被省略的用户输入，那么这条 usage 仍是过去那次调用的正确账单，却已经不适合预测当前请求大小。估算器会检查产生 usage 的源记录是否晚于最近一次编辑或压缩；若它更早，就对当前投影重新估算。上游测试省略一个很大的用户输入，断言新的 `usageTokens` 变成零且估算量低于一百；随后产生新的有效 assistant usage 时，又可以继续使用新账单加尾部估算。记账与预算使用同一个数据源，回答的时间点却不一样。[估算的时序回归测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/test/session-context-edit.test.ts#L190)

## 6. 摘要生成到一半就截断了

设摘要模型已经返回 `partial summar`，同时 `stopReason` 为 `length`。若把这段文本当成完整检查点，下一次恢复会静默丢失摘要的后半段。Pi 的回归测试令模拟模型返回这个组合，断言 `session.compact()` 抛出含有 `generation hit the token cap` 的错误，并且存储中的 `compaction` Entry 数量依然是零。[截断摘要的回归测试](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/test/suite/regressions/7048-compaction-truncated-summary.test.ts)

成功的手动路径先得到完整结果，再检查取消信号，然后才调用 `appendCompaction`、刷新活动上下文。因而排查某次恢复时，可以看见两类不同证据。已有 `x` 时，检查它指向的保留 ID 和当前叶子；没有 `x` 时，追查生成、取消或写入错误。会话恢复重建的是已有消息及模型设置。一个中断的外部命令是否已经改变文件，还需查该命令自身的状态。[手动压缩的提交顺序](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/coding-agent/src/core/agent-session.ts#L2913)

> **先预测**　第一次压缩后又编辑了一条保留的消息，接着再压一次。下一轮必须同时收到两份摘要吗？
>
> **核对推导**　不必。在本章用例中，当前分支采用最近一次压缩的摘要和保留区间，编辑覆盖仍作用于留下的那条消息。旧摘要作为日志条目仍可存在，不等于本轮投影一定把它也交给模型。

[继续阅读：MCP 的远程工具如何接回循环](07-mcp-protocol-and-pi-integration.md) · [返回课程路线](00-source-learning-path.md)
