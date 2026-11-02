import { Agent } from '@earendil-works/pi-agent-core';
import { ToolCallArgumentsStream, getCurrentSystemMessage, getCurrentTools } from '@earendil-works/pi-ai';
import { createFauxCore, fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { truncateHead } from '@earendil-works/pi-coding-agent';

function streamArguments() {
  const read = new ToolCallArgumentsStream();
  const list = new ToolCallArgumentsStream();
  const chunks = [
    ['read-1', read, '{"path":"READ'],
    ['list-1', list, '{"limit":'],
    ['read-1', read, 'ME.md"}'],
    ['list-1', list, '2}'],
  ];
  for (const [id, parser, chunk] of chunks) {
    console.log(id, JSON.stringify(parser.append(chunk)));
  }
  console.log('完成', JSON.stringify(read.finish()), JSON.stringify(list.finish()));
}

async function queuedRequests() {
  for (const mode of ['one-at-a-time', 'all']) {
    const model = createFauxCore({});
    model.setResponses(Array.from({ length: 4 }, () => fauxAssistantMessage('收到。')));
    const agent = new Agent({
      initialState: { model: model.getModel() },
      steeringMode: mode,
      streamFn(modelInfo, context, options) {
        const userTexts = context.messages.filter(message => message.role === 'user').map(message =>
          typeof message.content === 'string' ? message.content :
            message.content.filter(block => block.type === 'text').map(block => block.text).join(''));
        console.log(mode, userTexts.join(' → '));
        return model.streamSimple(modelInfo, context, options);
      },
    });
    const user = content => ({ role: 'user', content, timestamp: Date.now() });
    let inserted = false;
    const unsubscribe = agent.subscribe(event => {
      if (event.type !== 'turn_end' || inserted) return;
      inserted = true;
      agent.steer(user('只读 README'));
      agent.steer(user('保留标题'));
      agent.followUp(user('再写摘要'));
    });
    try {
      await agent.prompt('介绍项目');
    } finally {
      unsubscribe();
    }
  }
}

function fileWindow() {
  const text = 'A\n中\nBC';
  for (const [maxLines, maxBytes] of [[3, 5], [3, 7], [3, 8], [2, 8]]) {
    const result = truncateHead(text, { maxLines, maxBytes });
    console.log(maxLines, maxBytes, JSON.stringify(result.content),
      result.outputBytes, result.truncatedBy);
  }
}

function replaySections() {
  const tool = name => ({ name, description: name, parameters: { type: 'object', properties: {} } });
  const messages = [
    { role: 'system', content: '检索笔记', sections: { scope: '仅项目', tone: '简洁' },
      toolsAdded: [tool('read'), tool('bash')], timestamp: 1 },
    { role: 'user', content: '介绍项目', timestamp: 2 },
    { role: 'system', content: '', sections: { scope: '仅 README', tone: null },
      toolsRemoved: [{ name: 'bash' }], timestamp: 3 },
  ];
  for (const length of [1, 2, 3]) {
    const prefix = messages.slice(0, length);
    const head = getCurrentSystemMessage(prefix);
    console.log(length, JSON.stringify(head.sections), getCurrentTools(prefix).map(t => t.name).join(','));
  }
}

const probes = { stream: streamArguments, queue: queuedRequests, bytes: fileWindow, context: replaySections };
const name = process.argv[2];
if (!Object.hasOwn(probes, name)) throw new Error('用法：node boundaries.mjs stream|queue|bytes|context');
await probes[name]();
