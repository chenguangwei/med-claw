#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 2026);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, '..');

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function canListen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

async function waitForFree(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canListen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function getListeningPids() {
  if (process.platform === 'win32') return [];

  const output = run('lsof', [
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-Fp',
  ]);

  return output
    .split('\n')
    .filter((line) => line.startsWith('p'))
    .map((line) => Number(line.slice(1)))
    .filter(Number.isFinite);
}

function getPidCwd(pid) {
  const output = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const cwdLine = output.split('\n').find((line) => line.startsWith('n'));
  return cwdLine ? path.resolve(cwdLine.slice(1)) : '';
}

function getPidCommand(pid) {
  return run('ps', ['-p', String(pid), '-o', 'command=']).trim();
}

function isProjectApiProcess(pid) {
  const cwd = getPidCwd(pid);
  const command = getPidCommand(pid);
  if (cwd !== apiRoot) return false;

  return (
    /(node|uniins-claw-api)/.test(command) &&
    /(src\/index\.ts|src\\index\.ts|uniins-claw-api)/.test(command)
  );
}

async function main() {
  if (await canListen()) return;

  if (process.platform === 'win32') {
    console.error(
      `[dev] Port ${port} is already in use. Stop the process using it, then rerun pnpm dev:app.`
    );
    console.error(`[dev] Windows helper: netstat -ano | findstr :${port}`);
    process.exit(1);
  }

  const pids = getListeningPids();
  const projectApiPids = pids.filter(isProjectApiProcess);

  if (projectApiPids.length > 0) {
    console.log(
      `[dev] Port ${port} is used by stale API process(es): ${projectApiPids.join(
        ', '
      )}. Stopping them...`
    );

    for (const pid of projectApiPids) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process already exited.
      }
    }

    if (await waitForFree(2500)) return;

    for (const pid of projectApiPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already exited.
      }
    }

    if (await waitForFree(1500)) return;
  }

  const details = pids
    .map((pid) => {
      const command = getPidCommand(pid) || 'unknown command';
      const cwd = getPidCwd(pid) || 'unknown cwd';
      return `  PID ${pid}: ${command}\n    cwd: ${cwd}`;
    })
    .join('\n');

  console.error(`[dev] Port ${port} is already in use by another process.`);
  if (details) console.error(details);
  console.error(`[dev] Stop that process, then rerun pnpm dev:app.`);
  process.exit(1);
}

main().catch((error) => {
  console.error('[dev] Failed to check dev API port:', error);
  process.exit(1);
});
