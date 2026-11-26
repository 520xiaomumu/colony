import cursor from './cursor.mjs';
import grokBuild from './grok-build.mjs';
import antigravity from './antigravity.mjs';
import chatgpt from './chatgpt.mjs';
import claude from './claude.mjs';

// Plug new drivers here in order (e.g. claude)
export const DRIVERS = [
  cursor,
  grokBuild,
  antigravity,
  chatgpt,
  claude,
];

export const DRIVER_MAP = new Map(DRIVERS.map((d) => [d.id, d]));
