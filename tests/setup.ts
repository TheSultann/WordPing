import 'dotenv/config';
import nodeProcess from 'node:process';
import processShim from 'process';

process.env.PRISMA_CLIENT_ENGINE_TYPE = 'library';

if (typeof (globalThis as any).process?.once !== 'function') {
  (globalThis as any).process = nodeProcess;
}

const shim = processShim as unknown as NodeJS.Process & Record<string, any>;
if (typeof shim.once !== 'function') {
  shim.once = nodeProcess.once.bind(nodeProcess);
  shim.on = nodeProcess.on.bind(nodeProcess);
  shim.off = (nodeProcess as any).off?.bind(nodeProcess) ?? nodeProcess.removeListener.bind(nodeProcess);
  shim.listenerCount = nodeProcess.listenerCount.bind(nodeProcess);
  shim.exit = nodeProcess.exit.bind(nodeProcess);
}
