# Observability 与 Evaluation：怎样用证据改进 Pi

把模板文档提供给 Agent，真的能帮助它正确添加项目命令吗？这类问题需要两次相同任务之间的对照。Pi 自己的评测包恰好提供了一个可以沿源码跟到底的例子：让 Agent 创建 `/current-time` 模板，重新加载项目，然后实际调用它。

![Mox 同时检查最终产物和行动轨迹](../assets/mox-mechanisms/evals.png)

## 1. 先定义什么叫“做成了”

项目模板用例要求把固定的一句话写进当前项目的命令模板。宿主交给评测运行器的是三个依次执行的动作。这里将源码示意为中文，其顺序与上游用例一致。[模板行为用例](https://github.com/earendil-works/pi/blob/main/packages/evals/evals/prompt-templates.docs.eval.ts)

```text
prompt  请求创建项目模板 /current-time
reload  重新加载资源
prompt  发送 /current-time
```

第一步有可能只收到“已创建”的回复，文件却放错位置。第二步会让资源加载器重新发现模板，第三步让宿主真正走命令展开路径。评分代码从会话中读取新发现的模板和最后一条用户消息，然后严格比较结构化对象。对于项目范围，它要求匹配的模板恰有一个、作用域和路径正确、另一作用域没有同名文件、没有不期望的扩展或 Skill，且展开后的文本与指定语句一致。条件任何一项不符，都能给出一个可定位的失败原因。

举例说，如果 Agent 把文件写到用户目录，调用 `/current-time` 仍可能得到正确的文本，评分对象里的 `atExpectedPath`、作用域或 `otherScopeTemplateExists` 却会暴露错误。只读聊天记录看不出这类偏差。[输出提取和严格评分](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/evals/prompt-templates.docs.eval.ts#L27)

## 2. 如何把一个用例变成可配对的任务

`parseDiscoveredCases` 把测试名称拆成 `evalSet` 和 `caseId`，重复标识会抛错。`createTaskPlan` 接收用例、模型标识和每组重复数，再给任务填入文档条件 `variant` 和 `runNumber`。例如只有一个用例、一个模型、重复两轮，就会得到 4 个任务。[用例标识和重复检查](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/src/plan.ts#L21)

源码摘录：[packages/evals/src/plan.ts](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/src/plan.ts#L50)

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

奇偶轮次对调顺序，使同一组不总是先运行。比较时应配对 ① 和 ②、③ 和 ④。在同一案例上改了模型、改了重复编号，或只重复失败的一边，都改变了比较对象。这个次序有一个不调用模型的测试，它断言任务数为 4，并逐项检查条件和轮次。[任务生成测试](https://github.com/earendil-works/pi/blob/main/packages/evals/test/plan.test.ts)

## 3. 从四条观测算出比较结果

下表取自上游**报告单元测试的输入**，用于演示汇总计算。这些数值不是模板评测实跑出的成绩。用例名为 `tool access / create`，模型标识为 `fixture/model`。[比较测试的数据与断言](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/test/comparison.test.ts#L60)

| 重复编号 | 条件 | 得分 | Token 数 | 工具次数 | 用时 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 无文档 | 0 | 100 | 3 | 1,000 ms |
| 1 | 有文档 | 1 | 120 | 2 | 800 ms |
| 2 | 无文档 | 1 | 200 | 2 | 1,000 ms |
| 2 | 有文档 | 1 | 180 | 2 | 1,000 ms |

报告把得分至少为 1 的运行计为通过。两对都完整，无文档为 1/2，有文档为 2/2，相差 **50 个百分点**。平均 Token 数却完全相同，均为 150。配对的工具调用次数差为 −0.5，平均时长差为 −100 ms。同一个例子可以同时解释正确率、成本与速度，各自的分母和单位不能互换。两次重复足以验证汇总公式，判断真实产品效果还需要代表性的任务和样本。[通过率和配对指标实现](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/src/report.ts#L372)

## 4. 缺掉一次运行，报告怎样处理

把上一组输入换成三条观测：第 1 对中有文档运行出错，第 2 对中有文档观测缺失。无文档组仍有两条有效记录。若只挑自己喜欢的结果，得出的数字没有可比较的对象。

`resolvePair` 按案例集合、案例、模型和重复编号归组，要求每个条件正好有一份预期、一条实际观测，并且这条观测能计分。出错、重复或缺失都会生成受阻原因。此例的报告给出 `totalPairs = 2`、`eligiblePairs = 0`、`blockedPairs = 2`、`lift = null`。只要集合中仍有受阻配对，报告就暂缓发布总体通过率和提升值。失败运行已经花掉的资源仍然是真实成本，可取得的用量会出现在运行总量里。[配对判定](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/src/report.ts#L250) · [缺失、错误和重复的测试](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/test/comparison.test.ts#L88)

区别 `0` 和 `null` 也很实际。缺少 Token 计量意味着不知道成本，已计量且为零则表示此次消耗是零。测试分别检查 `availableRuns` 和 `total`，避免缺失指标被填成零后拉低平均值。

## 5. 从失败的评分往回找到实现

假设模板文件存在，但 `expandedToTimeRequest` 为假。可以按下面的次序缩小范围，每一步用不同的数据回答一个问题。

| 观察什么 | 可以区分的情况 |
| --- | --- |
| 目标目录和模板文件内容 | 模型没有产出文件，还是写错目录、写错文本 |
| 重新加载后的 `prompts` 和 `diagnostics` | 文件存在，是否被发现并解析为唯一同名资源 |
| 调用后保留的用户消息 | 模板是否展开，展开结果是否按原样进入会话 |
| 模型和工具事件、时间与用量 | 为了达到同一产物，经历了几轮请求、工具和重试 |

同一份终端输出未必拥有上述全部证据。Agent 的事件反映运行过程中发生的事情，Session 可保存可恢复的路径，评测程序读取产物和会话构造评分对象。需要分析耗时的因果关系时可以使用 Trace 和 Span，Pi 还提供独立的遥测契约。发出事件、写入会话和评分是三个不同的读写点。[遥测包](https://github.com/earendil-works/pi/blob/main/packages/telemetry/README.md) · [模板展开机制](08-skills-and-prompt-templates.md)

## 6. 怎样保证比的是文档条件

在 Docker 运行路径中，程序为运行准备产物目录，用只读根文件系统、单独的可写临时目录和选择的条件镜像来启动容器。挂载给运行器的认证文件和网络需求仍须按实际运行环境处理。隔离的目的之一，是防止被评 Agent 在不应有文档的那一组直接读到评测材料。[Docker 参数的构建](https://github.com/earendil-works/pi/blob/3e0eec29f50e7861e9db91f2d12723267411b4f3/packages/evals/src/docker.ts#L93) · [评测协议与环境](https://github.com/earendil-works/pi/blob/main/packages/evals/README.md)

从这里回看第一章的 README 任务，已经可以逐层定位结果：文件由哪个工具读出，哪条消息送回了模型，哪些事实进入会话，界面订阅到了哪些事件，以及最终的解释是否忠于实际文件。更换模型、修改提示、重排工具或更新扩展后，同一条证据链也能判断变化发生在哪一层。

[返回课程路线](00-source-learning-path.md) · [查看源码地图](../references/source-map.md)
