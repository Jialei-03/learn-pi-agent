import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { obj, str } from '@earendil-works/pi-schema';

export async function runBatch(mode) {
  if (!['mixed', 'all', 'followUp'].includes(mode)) throw new Error('Unknown batch scenario');
  const model = createFauxCore({});
  model.setResponses([
    fauxAssistantMessage(['A', 'B'].map(slot => fauxToolCall('lookup', { slot }, { id: slot })), { stopReason: 'toolUse' }),
    fauxAssistantMessage('第二轮已处理完毕。'),
  ]);
  const reports = [], requests = [], events = [];
  const lookup = {
    name: 'lookup', label: '查询', description: '返回指定项目的结果',
    parameters: obj({ slot: str() }),
    async execute(id, { slot }) {
      const terminate = slot === 'A' || mode !== 'mixed';
      reports.push({ id, terminate });
      return { content: [{ type: 'text', text: slot }], details: undefined, terminate };
    },
  };
  let followUp = mode === 'followUp';
  await runAgentLoop(
    [{ role: 'user', content: '查询 A 和 B', timestamp: 0 }],
    { messages: [], tools: [lookup] },
    {
      model: model.getModel(), convertToLlm: messages => messages,
      getFollowUpMessages() {
        if (!followUp) return [];
        followUp = false;
        return [{ role: 'user', content: '再说明一下 B', timestamp: 1 }];
      },
    },
    event => events.push(event.type), undefined,
    (info, context, options) => {
      requests.push(context.messages.map(m => m.role));
      return model.streamSimple(info, context, options);
    },
  );
  return { reports, requests, events };
}
