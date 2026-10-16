import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioState } from '../../shared/types';
import { getView } from './view';

// Writes the coach sync file. In the hosted environment COACH_SYNC_DIR is a
// volume shared with the learnersync container, which watches only this one
// file and posts each new version to Train, where it appears in the coach's
// "Recently edited files". Unset (local development), nothing is written.

export const COACH_FILE = 'COWORK.md';

/** A snapshot every few seconds, not one per streamed word. */
const WRITE_DELAY_MS = 3000;

/** The coach's link to the read-only view. The hosted environment's port
 * proxy serves exposed port N of the VM whose editor is at <id>.<domain>
 * at <id>-port-N.<domain>. */
export function watchUrl(env: Record<string, string | undefined> = process.env): string {
  const port = env.COWORK_PUBLIC_PORT || '1001';
  const host = env.SW_HOSTNAME;
  if (!host || !host.includes('.')) return `http://localhost:${port}/watch`;
  const [id, ...domain] = host.split('.');
  return `https://${id}-port-${port}.${domain.join('.')}/watch`;
}

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text).replace(/\s+/g, ' ');

export function coachSummary(states: ScenarioState[], now = new Date()): string {
  const view = getView();
  const lines = [
    '# Cowork: following this learner',
    '',
    `Open the learner's workspace, read-only: ${watchUrl()}`,
    '',
    `It follows whatever they have on screen. This file updated ${now.toISOString().slice(11, 19)} UTC.`,
    '',
    `Now looking at: ${states.find((s) => s.scenario.id === view.scenario)?.scenario.title ?? 'nothing yet'}${view.tab ? `, with ${view.tab} open` : ''}`,
  ];
  for (const state of states) {
    const prompts = state.events.filter((e) => e.type === 'user');
    lines.push('', `## ${state.scenario.title}`, '');
    if (!prompts.length) {
      lines.push('Not started.');
      continue;
    }
    lines.push(`${prompts.length} message${prompts.length === 1 ? '' : 's'}${state.running ? ', Claude is working now' : ''}.`);
    const errors = state.events.filter((e) => e.type === 'error').length;
    if (errors) lines.push(`${errors} error${errors === 1 ? '' : 's'} in the chat.`);
    lines.push('', 'Latest messages:', '');
    for (const p of prompts.slice(-3)) lines.push(`- ${p.from === 'artifact' ? '(from an artifact) ' : ''}${clip(p.text)}`);
    if (state.artifacts.length) {
      lines.push('', 'Artifacts:', '');
      for (const a of state.artifacts) lines.push(`- ${a.title} (${a.path})`);
    }
  }
  return lines.join('\n') + '\n';
}

let timer: ReturnType<typeof setTimeout> | undefined;
let lastWritten: string | undefined;

/** Write the file a few seconds from now, folding in any further changes. */
export function scheduleCoachFile(states: () => ScenarioState[]): void {
  if (!process.env.COACH_SYNC_DIR || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    writeCoachFile(states());
  }, WRITE_DELAY_MS);
}

export function writeCoachFile(states: ScenarioState[], dir: string | undefined = process.env.COACH_SYNC_DIR): void {
  if (!dir) return;
  try {
    const contents = coachSummary(states);
    // Skip a write when only the time would change, so the coach's file list isn't bumped by nothing.
    const withoutTime = contents.replace(/updated \d\d:\d\d:\d\d UTC/, '');
    if (withoutTime === lastWritten) return;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Write then rename, so the sync never reads a half-written file. The
    // temporary name has no .md extension, so the sync ignores it.
    const tmp = join(dir, `.${COACH_FILE}.tmp`);
    writeFileSync(tmp, contents);
    renameSync(tmp, join(dir, COACH_FILE));
    lastWritten = withoutTime;
  } catch (err) {
    console.error('Could not write the coach sync file:', err);
  }
}
