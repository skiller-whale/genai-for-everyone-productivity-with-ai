import { chownSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { FileEntry } from '../shared/types';
import { SANDBOX_UID, WORKSPACE_DIR } from './config';
import type { ScenarioDefinition } from './scenarios';

// Each scenario gets a folder in the shared workspace, seeded from its files/.
// The server and the sandbox both mount the workspace, so the server reads
// and writes the same files Claude works on.

export const scenarioDir = (id: string) => join(WORKSPACE_DIR, id);
/** The server's own state (chat logs) lives beside the scenario folders, not in them. */
export const stateDir = () => join(WORKSPACE_DIR, '.cowork');

const HIDDEN = new Set(['node_modules', '__pycache__']);

/** Resolve a path the client or Claude gave us, refusing anything outside the scenario folder. */
export function safePath(id: string, path: string): string | null {
  const root = scenarioDir(id);
  const full = resolve(root, path.replace(/^\/+/, ''));
  return full === root || full.startsWith(root + sep) ? full : null;
}

export function ensureSeeded(scenario: ScenarioDefinition): void {
  if (!existsSync(scenarioDir(scenario.id))) seed(scenario);
}

export function seed(scenario: ScenarioDefinition): void {
  const dir = scenarioDir(scenario.id);
  rmSync(dir, { recursive: true, force: true });
  if (existsSync(scenario.filesDir)) cpSync(scenario.filesDir, dir, { recursive: true });
  else mkdirSync(dir, { recursive: true });
  unpack(dir);
  giveToSandbox(dir);
}

/** Big data files are kept gzipped in the repo; the person and Claude see them unpacked. */
function unpack(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) unpack(full);
    else if (entry.name.endsWith('.gz')) {
      writeFileSync(full.slice(0, -3), gunzipSync(readFileSync(full)));
      rmSync(full);
    }
  }
}

export function listFiles(id: string): FileEntry[] {
  const root = scenarioDir(id);
  const out: FileEntry[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (HIDDEN.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = statSync(full);
        out.push({ path: relative(root, full), size: stat.size, modified: stat.mtimeMs });
      }
      if (out.length > 500) return;
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** When the server runs as root (in its container), hand what it writes to the sandbox user. */
export function giveToSandbox(path: string): void {
  if (process.getuid?.() !== 0) return;
  const chown = (p: string) => {
    chownSync(p, SANDBOX_UID, SANDBOX_UID);
    if (statSync(p).isDirectory()) for (const child of readdirSync(p)) chown(join(p, child));
  };
  chown(path);
}

export function prepareWorkspace(): void {
  mkdirSync(stateDir(), { recursive: true });
  if (process.getuid?.() === 0) chownSync(WORKSPACE_DIR, SANDBOX_UID, SANDBOX_UID);
}
