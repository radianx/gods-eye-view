import { getHudCaption } from '../../../src/tools/queries/brief.js';
import { toFunctionTools } from '../../../src/tools/functions.js';
import { GEV_REALTIME_TOOLS, offeredTools } from '../openai/tools.js';

// The console can explicitly request an area caption. Voice retains its own
// surface policy and prompt budget; both transports execute the same catalog.
export const GEV_AGENT_TOOLS = [
  ...GEV_REALTIME_TOOLS,
  ...toFunctionTools([getHudCaption]),
];

export function agentTools(options) {
  return offeredTools(GEV_AGENT_TOOLS, options);
}
