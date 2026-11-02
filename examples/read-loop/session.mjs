import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFauxCore } from '@earendil-works/pi-ai/providers/faux';
import { createAgentSession, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { question, scriptResponses } from './run.mjs';

const cwd = fileURLToPath(new URL('./fixtures/', import.meta.url));
const agentDir = await mkdtemp(join(tmpdir(), 'pi-reading-demo-'));
try {
  const model = createFauxCore({});
  scriptResponses(model, 'success');
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false,
  });
  const info = model.getModel();
  modelRuntime.registerProvider(info.provider, {
    api: info.api, baseUrl: info.baseUrl, apiKey: 'demo-only',
    models: [info], streamSimple: model.streamSimple,
  });
  const sessionManager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime, model: info, sessionManager, tools: ['read'],
  });
  try {
    const unsubscribe = session.subscribe(event => {
      if (event.type === 'message_end') console.log('消息完成  ' + event.message.role);
    });
    try {
      await session.prompt(question);
      const branch = sessionManager.getBranch().filter(entry => entry.type === 'message');
      console.log('会话记录  ' + branch.map(entry => entry.message.role).join(' → '));
      console.log('最终回答  ' + session.state.messages.at(-1).content[0].text);
    } finally { unsubscribe(); }
  } finally { session.dispose(); }
} finally { await rm(agentDir, { recursive: true, force: true }); }
