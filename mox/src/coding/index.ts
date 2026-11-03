// mox 的四个 coding 工具，和 Pi 默认启用的工具一致：read、bash、edit、write。
import type { AgentTool } from '../tools.ts';
import { createBashTool } from './bash.ts';
import { createEditTool } from './edit.ts';
import { createReadTool } from './read.ts';
import { createWriteTool } from './write.ts';

export function createCodingTools(cwd: string): AgentTool[] {
  return [createReadTool(cwd), createBashTool(cwd), createEditTool(cwd), createWriteTool(cwd)];
}
export { createBashTool, createEditTool, createReadTool, createWriteTool };
