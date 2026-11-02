import { runAgentLoop } from '@earendil-works/pi-agent-core';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';

export const scenarios = ['success', 'missing', 'length'];
export const question = '读取 README.md，告诉我这个项目是做什么的。';

// This model has two scripted turns. The second reads the actual tool result.
export function scriptResponses(model, scenario) {
  const path = scenario === 'missing' ? 'absent.md' : 'README.md';
  model.setResponses([
    fauxAssistantMessage(fauxToolCall('read', { path }, { id: 'read-1' }), {
      stopReason: scenario === 'length' ? 'length' : 'toolUse',
    }),
    context => {
      const result = context.messages.findLast(message => message.role === 'toolResult');
      if (!result) throw new Error('Expected a tool result before the second request');
      if (result.isError) return fauxAssistantMessage('读取未完成。工具返回了错误。');
      const text = result.content.find(block => block.type === 'text')?.text ?? '';
      const line = text.split('\n').find(line => line.trim() && !line.startsWith('#'));
      return fauxAssistantMessage(line ? '项目说明：' + line : '文件中没有说明段落。');
    },
  ]);
}

// Keep display snapshots independent of later mutations to Pi's stream messages.
function messageView(message) {
  const fields = ['role', 'content', 'toolsAdded', 'toolCallId', 'toolName', 'isError', 'stopReason'];
  return structuredClone(Object.fromEntries(fields.filter(k => k in message).map(k => [k, message[k]])));
}

export async function runExample(readTool, scenario = 'success') {
  if (!scenarios.includes(scenario)) throw new Error('Unknown scenario: ' + scenario);
  const model = createFauxCore({ tokenSize: { min: 8, max: 8 } });
  scriptResponses(model, scenario);
  const requests = [], events = [], executions = [];
  const tool = {
    ...readTool,
    execute(id, args, signal, onUpdate) {
      executions.push({ id, args: structuredClone(args) });
      return readTool.execute(id, args, signal, onUpdate);
    },
  };
  const messages = await runAgentLoop(
    [{ role: 'user', content: question, timestamp: 0 }],
    { messages: [], tools: [tool] },
    { model: model.getModel(), convertToLlm: messages => messages },
    event => events.push(event.type),
    undefined,
    (modelInfo, context, options) => {
      requests.push(context.messages.map(messageView));
      return model.streamSimple(modelInfo, context, options);
    },
  );
  return { requests, events, executions, messages: messages.map(messageView) };
}
