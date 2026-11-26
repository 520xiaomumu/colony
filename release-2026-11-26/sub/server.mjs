import fs from 'node:fs';
import path from 'node:path';
import { GATEWAY_VERSION, ROOT_DIR, startGateway } from './gateway.mjs';

const PID_FILE = path.join(ROOT_DIR, 'server.pid');
function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const port = Number(parseArg('--port', process.env.COLONY_SUB_PORT || '4135')) || 4135;

const gw = await startGateway({ port, embedded: false });
try { fs.writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch {}
console.log(`[colony-gateway] v${GATEWAY_VERSION} standalone on http://${gw.status.host}:${gw.status.port}`);

const shutdown = async () => {
  try {
    if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
  await gw.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
