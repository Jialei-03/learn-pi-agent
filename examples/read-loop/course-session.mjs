import { join } from 'node:path';
import { createFauxCore } from '@earendil-works/pi-ai/providers/faux';
import { ModelRuntime, SettingsManager, createAgentSession } from '@earendil-works/pi-coding-agent';

// Only the model is scripted; the loader, tools and session manager belong to Pi.
export async function openDemo({ cwd, agentDir, sessionManager, tools, responses }) {
  const faux = createFauxCore({});
  faux.setResponses(responses);
  const model = faux.getModel();
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false,
  });
  modelRuntime.registerProvider(model.provider, {
    api: model.api, baseUrl: model.baseUrl, apiKey: 'demo-only', models: [model], streamSimple: faux.streamSimple,
  });
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  return (await createAgentSession({ cwd, agentDir, model, modelRuntime, sessionManager, tools, settingsManager })).session;
}
