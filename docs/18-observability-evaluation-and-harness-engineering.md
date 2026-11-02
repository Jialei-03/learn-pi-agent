# Observability 与 Evaluation：怎样用证据改进 Pi

把模板文档提供给 Agent，真的能帮助它正确添加项目命令吗？这类问题需要两次相同任务之间的对照。Pi 自己的评测包恰好提供了一个可以沿源码跟到底的例子：让 Agent 创建 `/current-time` 模板，重新加载项目，然后实际调用它。

![Mox 同时检查最终产物和行动轨迹](../assets/mox-mechanisms/evals.png)

## 1. 先定义什么叫“做成了”

项目模板用例要求把固定的一句话写进当前项目的命令模板。宿主交给评测运行器的是三个依次执行的动作。这里将源码示意为中文，其顺序与上游用例一致。[模板行为用例](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/evals/prompt-templates.docs.eval.ts)

```text
prompt  请求创建项目模板 /current-time
reload  重新加载资源
prompt  发送 /current-time
```

第一步有可能只收到“已创建”的回复，文件却放错位置。第二步会让资源加载器重新发现模板，第三步让宿主真正走命令展开路径。评分代码从会话中读取新发现的模板和最后一条用户消息，然后严格比较结构化对象。对于项目范围，它要求匹配的模板恰有一个、作用域和路径正确、另一作用域没有同名文件、没有不期望的扩展或 Skill，且展开后的文本与指定语句一致。条件任何一项不符，都能给出一个可定位的失败原因。

举例说，如果 Agent 把文件写到用户目录，调用 `/current-time` 仍可能得到正确的文本，评分对象里的 `atExpectedPath`、作用域或 `otherScopeTemplateExists` 却会暴露错误。只读聊天记录看不出这类偏差。[输出提取和严格评分](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/evals/prompt-templates.docs.eval.ts#L27)

### 看评分器实际收到什么

以项目模板为例，评分函数从三个地方取数。工作目录决定预期的项目文件位置，用户资源目录决定另一份不该存在的路径。已重载的资源列表说明运行时到底发现了哪些模板。最后的用户消息记录模板真正展开成什么内容。助手回答“当前时间是几时”并没有参与下列两个关键布尔值的计算。它可以答得流畅，模板仍有可能只安装在错误的范围。[评分输入的提取](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/evals/prompt-templates.docs.eval.ts#L26)

设计一个只错一个字段的例子。用户要求项目模板，Agent 正确写入项目路径，也额外在用户目录留下同名文件。假设资源加载器在这个环境最终只呈现一个匹配项，且命令实际展开正常。评分器仍会从另一条路径读到 `otherScopeTemplateExists = true`，与期望的 `false` 不符。如果实际资源列表里有两个匹配项，则另外还会得到 `template = null`，因为提取函数只接受唯一匹配。这样两条失败路径有不同证据，可以判断“多写了一份”和“命名发现出现歧义”分别发生在哪里。

再沿另一条失败路径。文件已经在正确目录、能被发现，但命令展开后的文字多了一句解释。代码取会话中最近一条用户消息，取其文本并裁去两端空白，然后与固定的模板正文比较；真正多出来的一句会令 `expandedToTimeRequest` 为假。对这个任务，产物的位置、内容、作用域和实际启用效果是四个独立条件。改进提示或加载算法时，保留这些字段比只存一个总分更能指导下一次定位。[严格匹配的预期对象](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/evals/prompt-templates.docs.eval.ts#L41)

## 2. 如何把一个用例变成可配对的任务

`parseDiscoveredCases` 把测试名称拆成 `evalSet` 和 `caseId`，重复标识会抛错。`createTaskPlan` 接收用例、模型标识和每组重复数，再给任务填入文档条件 `variant` 和 `runNumber`。例如只有一个用例、一个模型、重复两轮，就会得到 4 个任务。[用例标识和重复检查](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/plan.ts#L21)

源码摘录：[packages/evals/src/plan.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/plan.ts#L50)

```ts
const tasks: EvalTask[] = [];
for (const evalCase of cases) {
	for (let runNumber = 1; runNumber <= runsPerVariant; runNumber += 1) {
		const variants: DocumentationVariant[] =
			runNumber % 2 === 1 ? ["without_docs", "with_docs"] : ["with_docs", "without_docs"];
		for (const variant of variants) tasks.push({ ...evalCase, variant, model, runNumber });
	}
}
return tasks;
```

| 运行顺序 | 重复编号 | 文档条件 |
| --- | --- | --- |
| ① | 1 | 无文档 `without_docs` |
| ② | 1 | 有文档 `with_docs` |
| ③ | 2 | 有文档 `with_docs` |
| ④ | 2 | 无文档 `without_docs` |

奇偶轮次对调顺序，使同一组不总是先运行。比较时应配对 ① 和 ②、③ 和 ④。在同一案例上改了模型、改了重复编号，或只重复失败的一边，都改变了比较对象。这个次序有一个不调用模型的测试，它断言任务数为 4，并逐项检查条件和轮次。[任务生成测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/plan.test.ts)

### 一次运行怎样变成一条有效观测

从一次执行到一份报告，中间还要把 Vitest 测试状态、Harness 的实际运行记录以及评审分数归一化。`readTaskObservation` 同时读取原始测试报告和评测工作区的视图，按用例全名选出对应的断言。找不到唯一断言、工作区与原始报告状态不一致、或者没有运行记录，都无法直接把这一项当成可信成绩。对于跳过和待执行状态，函数会保留它们各自的结果类别。[报告读取与状态分类](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L136)

还有一个不显眼的身份核对。任务计划可能要求用模型 A，实际运行记录却写模型 B。即使这次得分很高，它也无法与模型 A 的对照项配成同一组。因此报告会比较运行记录的提供方和模型标识与计划中的标识，不匹配时产生错误观测。这样“用错模型”会暴露为实验配置问题，而不会悄悄变成“给文档之后表现提高”。同理，没有计量的 Token 不能随手补零，负数或非有限的用时也不能进入均值。[实际模型和指标的检查](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L161)

上游的测试构造了一份完整的评测报告。把这份报告的主要值按读取阶段排开，可以看出几个相似的“成功”到底落在哪里。下面是报告读取测试的样本，与后面比较算法的两对观测是不同的受控数据。[报告读取测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/report.test.ts#L120)

| 原始记录 | 输出观测 | 可以继续做的计算 |
| --- | --- | --- |
| Completed，评分为 0.5，模型符合要求，记了 15 Token、一次工具和 1,234 ms | `outcome: "scored", score: 0.5` 并带计量 | 可参与配对；按后面的满分阈值，这次不算通过 |
| 同样的计量，但测试状态为失败 | `outcome: "errored"` 并保留已取得的计量 | 对照比较受阻，实际消耗仍可汇总 |
| 测试显示通过，却没有 Harness 运行记录 | `outcome: "errored"` | 缺少可归属给这次计划的真实运行 |
| 流程完成，得分为零 | `outcome: "scored", score: 0` | 零是有效分数，可以与另一边比较 |
| 流程完成，没有评审分数 | `outcome: "unscored"` | 记录缺失，不应算作一次得零分的通过率样本 |

这一层还会将存在的会话快照保存到产物目录。文件名对应的目录键由用例集合、案例标识、条件、模型和轮次生成。因而从某次失败观测可以回到同一轮的原始会话。反过来，如果报告里确有评分但缺少会话附件，读取器仍可以保留有效分数，只是事后复盘材料更少。有测试分别验证了“没有运行记录”和“有运行记录但没有附件”，两种证据缺失对计分的影响不同。[持久化会话附件](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L122) · [缺失快照的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/report.test.ts#L207)

## 3. 从四条观测算出比较结果

下表取自上游**报告单元测试的输入**，用于演示汇总计算。这些数值不是模板评测实跑出的成绩。用例名为 `tool access / create`，模型标识为 `fixture/model`。[比较测试的数据与断言](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/comparison.test.ts#L60)

| 重复编号 | 条件 | 得分 | Token 数 | 工具次数 | 用时 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 无文档 | 0 | 100 | 3 | 1,000 ms |
| 1 | 有文档 | 1 | 120 | 2 | 800 ms |
| 2 | 无文档 | 1 | 200 | 2 | 1,000 ms |
| 2 | 有文档 | 1 | 180 | 2 | 1,000 ms |

报告把得分至少为 1 的运行计为通过。两对都完整，无文档为 1/2，有文档为 2/2，相差 **50 个百分点**。平均 Token 数却完全相同，均为 150。配对的工具调用次数差为 −0.5，平均时长差为 −100 ms。同一个例子可以同时解释正确率、成本与速度，各自的分母和单位不能互换。两次重复足以验证汇总公式，判断真实产品效果还需要代表性的任务和样本。[通过率和配对指标实现](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L372)

## 4. 缺掉一次运行，报告怎样处理

把上一组输入换成三条观测：第 1 对中有文档运行出错，第 2 对中有文档观测缺失。无文档组仍有两条有效记录。若只挑自己喜欢的结果，得出的数字没有可比较的对象。

`resolvePair` 按案例集合、案例、模型和重复编号归组，要求每个条件正好有一份预期、一条实际观测，并且这条观测能计分。出错、重复或缺失都会生成受阻原因。此例的报告给出 `totalPairs = 2`、`eligiblePairs = 0`、`blockedPairs = 2`、`lift = null`。只要集合中仍有受阻配对，报告就暂缓发布总体通过率和提升值。失败运行已经花掉的资源仍然是真实成本，可取得的用量会出现在运行总量里。[配对判定](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L250) · [缺失、错误和重复的测试](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/comparison.test.ts#L88)

区别 `0` 和 `null` 也很实际。缺少 Token 计量意味着不知道成本，已计量且为零则表示此次消耗是零。测试分别检查 `availableRuns` 和 `total`，避免缺失指标被填成零后拉低平均值。

### 缺失、重复和部分计量如何进入分母

第一次看汇总器，很容易把“读取了多少条记录”理解为“有多少对案例”。实际实现先把预期任务和实际观测加入同一个分组表。配对键中有用例集合、案例标识、模型和轮次，刻意不含文档条件。条件保存在组里的两个槽位。这样一个键最多形成一对实验，而不会因一侧写了两份报告，便把另一个条件复制两份。若把条件误加到键里，两边永远不能相遇；若删掉轮次，则不同轮次可能交叉配对。[分组表如何建立](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L208)

源码摘录：[packages/evals/src/report.ts](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L251)

```ts
const reasons: string[] = [];
for (const variant of VARIANTS) {
	const expected = group.expected.get(variant) ?? 0;
	const observed = group.observations.get(variant) ?? [];
	if (expected !== 1) reasons.push(`${variant}: design expected 1 run, found ${expected}`);
	if (observed.length !== expected) {
		reasons.push(
			`${variant}: expected ${expected} observation${expected === 1 ? "" : "s"}, found ${observed.length}`,
		);
	}
	if (expected === 1 && observed.length === 1 && observed[0].outcome !== "scored") {
		reasons.push(`${variant}: ${observed[0].outcome}`);
	}
}
```

这段循环有三种检查。先看实验设计是否各安排一次，再比较实际观测数与预期数，然后检查唯一观测是否可评分。以同一组无文档观测输入两遍为例，系统会记录“预期一条、发现两条”，无需在两个可能冲突的结果间擅选其一。若期望计划本身就含重复任务，也会被第一项检查发现。两份坏数据数量恰好相等，并不能让一个有缺陷的设计变成有效对照。

通过率与效率指标还有不同的发布规则。只要集合内有受阻配对，总体通过率和提升值就不发布；对已有完整可评分的配对，仍可逐项计算可得的效率数据。例如有两组完整分数，但第二组有文档一侧缺少实际用时，Token 计量两边都完整，则用时均值仅使用第一对，Token 均值可以使用两对。输出中每项自己的 `eligiblePairs` 能告诉读者真实分母。第三类是运行总量，按文档条件把实际观测里所有可取得的数值求和，包括有计量但评分失败的运行。于是“计划里有四次”“成功构成两对”“某指标只有一对”完全可能同时成立。[配对指标与运行总量](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L281)

对于四条正常观测，还可以从个体结果看出总体成绩掩盖的现象。无文档组对同一个案例一轮得零、一轮满分，结果不稳定。带文档组两轮都满分，在这份样本内已经触顶。汇总器有专门的标记描述同一案例在同一条件下出现不同通过结果，以及某侧通过率已达到一。这些标记指出下一次最值得增加样本的地方，并不替读者作因果断言。同样的零均值成本差，也可能是一轮多用、另一轮少用互相抵消。[报告标记的计算](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/report.ts#L337)

## 5. 从失败的评分往回找到实现

假设模板文件存在，但 `expandedToTimeRequest` 为假。可以按下面的次序缩小范围，每一步用不同的数据回答一个问题。

| 观察什么 | 可以区分的情况 |
| --- | --- |
| 目标目录和模板文件内容 | 模型没有产出文件，还是写错目录、写错文本 |
| 重新加载后的 `prompts` 和 `diagnostics` | 文件存在，是否被发现并解析为唯一同名资源 |
| 调用后保留的用户消息 | 模板是否展开，展开结果是否按原样进入会话 |
| 模型和工具事件、时间与用量 | 为了达到同一产物，经历了几轮请求、工具和重试 |

同一份终端输出未必拥有上述全部证据。Agent 的事件反映运行过程中发生的事情，Session 可保存可恢复的路径，评测程序读取产物和会话构造评分对象。需要分析耗时的因果关系时可以使用 Trace 和 Span，Pi 还提供独立的遥测契约。发出事件、写入会话和评分是三个不同的读写点。[遥测包](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/telemetry/README.md) · [模板展开机制](08-skills-and-prompt-templates.md)

### 怎样从用例结果走回一条工具调用

从课程第一章的消息结构出发，取一个标识为 `read_1` 的读文件调用。评测里的 `toTranscriptEvents` 遍历 Session 消息，遇到助手消息，会先提取可见文本，再把其中每个工具调用块变成带 `id`、名称和参数的事件。遇到对应的 `toolResult` 消息，则用 `toolCallId`、工具名和内容生成结果事件，若有错误标记还附上错误说明。这个过程是事后投影，因此从最终会话构造的事件列表不具备每个流式片段到达的精确时间。[从消息到评测轨迹](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L190)

假设父模型在同一轮发出了两个同名读取请求，先要求读 A 后要求读 B，而 B 的磁盘读取更快。按名字关联会混淆两条动作，按完成先后关联也会配错。将助手块的 `id` 与工具结果中的 `toolCallId` 相连，才能把失败的路径归给正确输入。再拿到源 Session 中的工作目录和所选工具，就能区分“模型读错文件”“工具读失败”“读取成功，助手最后解释错误”。这三种情形都能导致最终答案错误，需要修正的层次却分别在选择、执行和答案生成处。

Harness 在运行诊断里还保存实际系统提示的哈希、模型身份、会话计量与工具次数；若能取得模型价格信息，才会给出估算费用。清理前还会读取 Session 文件作为附件。若运行随后失败，且已得到部分诊断，宿主会把部分轨迹和费用随错误保留。现实中一次失败可能已经调用了许多次工具，报告中出现“未计分但消耗了 Token”正是这个数据流的自然结果。[诊断、附件与部分失败](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/harness.ts#L388)

## 6. 怎样保证比的是文档条件

在 Docker 运行路径中，程序为运行准备产物目录，用只读根文件系统、单独的可写临时目录和选择的条件镜像来启动容器。挂载给运行器的认证文件和网络需求仍须按实际运行环境处理。隔离的目的之一，是防止被评 Agent 在不应有文档的那一组直接读到评测材料。[Docker 参数的构建](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/src/docker.ts#L93) · [评测协议与环境](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/README.md)

从这里回看第一章的 README 任务，已经可以逐层定位结果：文件由哪个工具读出，哪条消息送回了模型，哪些事实进入会话，界面订阅到了哪些事件，以及最终的解释是否忠于实际文件。更换模型、修改提示、重排工具或更新扩展后，同一条证据链也能判断变化发生在哪一层。

文档条件本身也有可验证的输入。测试构建一份真正的默认系统提示，将文档段移除，然后检查其它段落仍然存在，文档入口已经消失。若以“无文档”身份送入仍含文档段的提示，`verifySystemPrompt` 会抛错。若默认提示的格式发生变化、找不到应有的边界，移除函数也会失败。如此一来，提示结构升级造成的实验配置错误会在产生得分之前暴露，而不是等看到两组分数一模一样才开始猜原因。[条件改写与实际提示的验证](https://github.com/earendil-works/pi/blob/9823079ad98d39f3587286c8d9f29556dfb3687b/packages/evals/test/harness.test.ts#L72)

下面的命令在已安装依赖的 Pi 源码中运行四份本地测试，覆盖任务展开、评分读取、配对统计与条件控制。可以从报告中直接对照四条观测的均值、重复和缺失样本对应的原因，以及错误运行保留的用量。它们验证的是统计逻辑和执行契约。真的想知道文档对某个模型帮助多大，还需要让该模型在受控环境完成相同任务，产生新的观测。

```bash
cd packages/evals
node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts test/plan.test.ts test/report.test.ts test/comparison.test.ts test/harness.test.ts
```

> **先预测**　同一用例的对照组在重复编号 1 有结果，实验组只在编号 2 有结果。能否配成一对算提升？
>
> **核对推导**　不能。案例相同还不够，重复编号等配对条件也要一致。缺项应保留为缺失；把两次不同重复硬配或把未测记成零，都会改变你声称比较的对象。

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
