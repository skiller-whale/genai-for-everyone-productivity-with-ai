import { spawn, spawnSync } from 'node:child_process';
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { SANDBOX_CONTAINER, SANDBOX_WORKSPACE, WORKSPACE_DIR } from './config';

// Claude Code runs inside the resident sandbox container, not beside the
// server. The Agent SDK lets us choose how its process is started, so we start
// it with `docker exec`: its Bash, Read, Write and Edit then all act on the
// container, and the SDK still talks to it over stdin/stdout as usual.

const HOST_ONLY = new Set(['PATH', 'HOME', 'PWD', 'USER', 'SHELL', 'TMPDIR', 'OLDPWD', 'LOGNAME']);

/** The same folder as the sandbox sees it. */
export function toSandboxPath(path: string): string {
  return path.startsWith(WORKSPACE_DIR) ? SANDBOX_WORKSPACE + path.slice(WORKSPACE_DIR.length) : path;
}

export function spawnInSandbox(options: SpawnOptions): SpawnedProcess {
  const names = Object.keys(options.env).filter((name) => options.env[name] !== undefined && !HOST_ONLY.has(name));
  const args = [
    'exec',
    '-i',
    '-w',
    toSandboxPath(options.cwd ?? WORKSPACE_DIR),
    // `-e NAME` takes the value from docker's own environment, so tokens never appear in a process list.
    ...names.flatMap((name) => ['-e', name]),
    SANDBOX_CONTAINER,
    'claude',
    ...options.args,
  ];
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST;
  for (const name of names) env[name] = options.env[name]!;
  const child = spawn('docker', args, { env, stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal });
  child.stderr.on('data', (chunk) => process.stderr.write(`[sandbox] ${chunk}`));
  return child as unknown as SpawnedProcess;
}

/** Fail early, with a useful message, if the sandbox isn't up. */
export function checkSandbox(): string | null {
  const result = spawnSync('docker', ['exec', SANDBOX_CONTAINER, 'claude', '--version'], { encoding: 'utf8' });
  if (result.status === 0) return null;
  return `The sandbox container "${SANDBOX_CONTAINER}" isn't answering (${(result.stderr || result.error?.message || '').trim()}). Start it with: docker compose up -d sandbox`;
}
