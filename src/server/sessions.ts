import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Artifact, ChatEvent, ScenarioState, StreamMessage, Todo } from '../shared/types';
import { claudeEnv } from './config';
import { systemPrompt } from './prompt';
import { spawnInSandbox, toSandboxPath } from './sandbox';
import { publicScenario, type ScenarioDefinition } from './scenarios';
import { ensureSeeded, listFiles, safePath, scenarioDir, seed, stateDir } from './workspace';

// One conversation per scenario. A turn runs Claude Code (inside the sandbox)
// through the Agent SDK and turns what it says and does into ChatEvents, which
// go to every open browser tab and into a log that survives restarts.

/** Claude Code's own tools that Claude gets. No sub-agents, no web search. */
const BUILT_IN_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'WebFetch', 'Skill'];

type Saved = { sessionId?: string; events: ChatEvent[]; artifacts: Artifact[] };

class ScenarioSession {
  events: ChatEvent[] = [];
  artifacts: Artifact[] = [];
  sessionId?: string;
  running = false;
  private abort?: AbortController;
  private listeners = new Set<(message: StreamMessage) => void>();
  private mtimes = new Map<string, number>();

  constructor(readonly scenario: ScenarioDefinition) {
    ensureSeeded(scenario);
    const file = this.stateFile();
    if (existsSync(file)) {
      const saved: Saved = JSON.parse(readFileSync(file, 'utf8'));
      Object.assign(this, saved);
    }
    for (const artifact of this.artifacts) this.mtimes.set(artifact.path, this.mtime(artifact.path));
  }

  state(): ScenarioState {
    return {
      scenario: publicScenario(this.scenario),
      events: compact(this.events),
      artifacts: this.artifacts,
      files: listFiles(this.scenario.id),
      running: this.running,
    };
  }

  subscribe(listener: (message: StreamMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(text: string, from?: 'artifact'): boolean {
    if (this.running) return false;
    void this.runTurn(text, from);
    return true;
  }

  stop(): void {
    this.abort?.abort();
  }

  reset(): void {
    this.stop();
    seed(this.scenario);
    this.events = [];
    this.artifacts = [];
    this.sessionId = undefined;
    this.mtimes.clear();
    this.save();
    this.broadcast({ kind: 'reset' });
  }

  filesChanged(): void {
    this.broadcast({ kind: 'files', files: listFiles(this.scenario.id) });
  }

  private async runTurn(text: string, from?: 'artifact'): Promise<void> {
    this.running = true;
    this.broadcast({ kind: 'running', running: true });
    this.emit({ type: 'user', id: crypto.randomUUID(), text, from });
    this.abort = new AbortController();
    try {
      try {
        await this.query(text);
      } catch (err) {
        // The sandbox may have been recreated, taking Claude Code's saved sessions with it.
        if (!this.sessionId || !/no conversation found/i.test(String(err))) throw err;
        this.sessionId = undefined;
        await this.query(text);
      }
    } catch (err) {
      console.error(String(err));
      if (this.abort.signal.aborted) this.emit({ type: 'error', message: 'Stopped.' });
      // The SDK also throws after an error result, which the chat already shows.
      else if (this.events.at(-1)?.type !== 'turn_end') this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
      this.abort = undefined;
      this.save();
      this.broadcast({ kind: 'running', running: false });
      this.filesChanged();
    }
  }

  private async query(prompt: string): Promise<void> {
    const cwd = scenarioDir(this.scenario.id);
    const streamed = new Set<string>(); // message ids whose text came through as deltas
    const blockIds = new Map<number, string>(); // content block index → text event id
    let messageId = '';

    for await (const message of query({
      prompt,
      options: {
        cwd,
        systemPrompt: systemPrompt(this.scenario, toSandboxPath(cwd)),
        tools: BUILT_IN_TOOLS,
        allowedTools: [...BUILT_IN_TOOLS, 'mcp__cowork__show_artifact'],
        mcpServers: { cowork: this.artifactServer() },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Only the scenario's own .claude/ folder (CLAUDE.md, skills), never the user's.
        settingSources: ['project'],
        includePartialMessages: true,
        resume: this.sessionId,
        abortController: this.abort,
        env: claudeEnv(),
        pathToClaudeCodeExecutable: 'claude',
        spawnClaudeCodeProcess: spawnInSandbox,
      },
    }) as AsyncIterable<SDKMessage>) {
      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') this.sessionId = message.session_id;
          break;

        case 'stream_event': {
          const event = message.event;
          if (event.type === 'message_start') {
            messageId = event.message.id;
            blockIds.clear();
          } else if (event.type === 'content_block_start' && event.content_block.type === 'text') {
            const id = `${messageId}:${event.index}`;
            blockIds.set(event.index, id);
            streamed.add(messageId);
            this.emit({ type: 'text_start', id });
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const id = blockIds.get(event.index);
            if (id) this.emit({ type: 'text_delta', id, delta: event.delta.text });
          }
          break;
        }

        case 'assistant':
          message.message.content.forEach((block, index) => {
            if (block.type === 'text' && !streamed.has(message.message.id) && block.text.trim()) {
              const id = `${message.message.id}:${index}`;
              this.emit({ type: 'text_start', id });
              this.emit({ type: 'text_delta', id, delta: block.text });
            } else if (block.type === 'tool_use') {
              const input = block.input as Record<string, unknown>;
              this.emit({ type: 'tool_use', id: block.id, name: block.name, input });
              if (block.name === 'TodoWrite' && Array.isArray(input.todos)) this.emit({ type: 'todos', todos: input.todos as Todo[] });
            }
          });
          break;

        case 'user': {
          const content = message.message.content;
          if (typeof content === 'string') break;
          for (const block of content) {
            if (block.type !== 'tool_result') continue;
            this.emit({
              type: 'tool_result',
              id: block.tool_use_id,
              output: truncate(resultText(block.content)),
              isError: Boolean(block.is_error),
            });
          }
          this.refreshArtifacts();
          this.filesChanged();
          break;
        }

        case 'result':
          if (message.subtype !== 'success') {
            const errors = 'errors' in message ? (message.errors as string[]).join('\n') : '';
            this.emit({ type: 'error', message: errors || `Claude stopped (${message.subtype}).` });
          } else if (message.is_error && !this.events.some((e) => e.type === 'text_delta' && e.delta === message.result)) {
            this.emit({ type: 'error', message: message.result });
          }
          this.emit({ type: 'turn_end', durationMs: message.duration_ms, costUsd: message.total_cost_usd });
          break;
      }
    }
  }

  /** The one tool we add to Claude Code's own: put a file in the right-hand panel. */
  private artifactServer() {
    return createSdkMcpServer({
      name: 'cowork',
      version: '1.0.0',
      tools: [
        tool(
          'show_artifact',
          'Show a file from the working folder in the panel on the right of the person\'s screen: an HTML page (report, dashboard, tool, form), or a .md, .csv, .svg or image file. Write the file first. Call again after changing it to reload the panel.',
          {
            path: z.string().describe('Path to the file, relative to the working folder, e.g. "report.html".'),
            title: z.string().describe('A short title for the panel tab, e.g. "Spending by category".'),
          },
          async ({ path, title }) => {
            const full = safePath(this.scenario.id, path.replace(/^\/workspace\/[^/]+\//, ''));
            if (!full || !existsSync(full)) {
              return { content: [{ type: 'text', text: `No file at ${path} in the working folder. Write it first.` }], isError: true };
            }
            const relative = full.slice(scenarioDir(this.scenario.id).length + 1);
            this.upsertArtifact(relative, title);
            return { content: [{ type: 'text', text: `Showing "${title}" (${relative}) in the panel.` }] };
          },
        ),
      ],
    });
  }

  private upsertArtifact(path: string, title: string): void {
    const existing = this.artifacts.find((a) => a.path === path);
    const artifact: Artifact = existing ? { ...existing, title, version: existing.version + 1 } : { path, title, version: 1 };
    this.artifacts = existing ? this.artifacts.map((a) => (a.path === path ? artifact : a)) : [...this.artifacts, artifact];
    this.mtimes.set(path, this.mtime(path));
    this.emit({ type: 'artifact', artifact });
  }

  /** Claude often edits an artifact without showing it again; reload it anyway. */
  private refreshArtifacts(): void {
    for (const artifact of this.artifacts) {
      const mtime = this.mtime(artifact.path);
      if (mtime !== this.mtimes.get(artifact.path)) this.upsertArtifact(artifact.path, artifact.title);
    }
  }

  private mtime(path: string): number {
    const full = safePath(this.scenario.id, path);
    return full && existsSync(full) ? statSync(full).mtimeMs : 0;
  }

  private emit(event: ChatEvent): void {
    this.events.push(event);
    this.broadcast({ kind: 'event', event });
  }

  private broadcast(message: StreamMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  private stateFile(): string {
    return join(stateDir(), `${this.scenario.id}.json`);
  }

  private save(): void {
    const saved: Saved = { sessionId: this.sessionId, events: compact(this.events), artifacts: this.artifacts };
    this.events = saved.events;
    writeFileSync(this.stateFile(), JSON.stringify(saved));
  }
}

/** Merge each text block's deltas into one, so logs stay small. */
function compact(events: ChatEvent[]): ChatEvent[] {
  const out: ChatEvent[] = [];
  const texts = new Map<string, { type: 'text_delta'; id: string; delta: string }>();
  for (const event of events) {
    if (event.type !== 'text_delta') out.push(event);
    else if (texts.has(event.id)) texts.get(event.id)!.delta += event.delta;
    else {
      const merged = { ...event };
      texts.set(event.id, merged);
      out.push(merged);
    }
  }
  return out;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part?.type === 'text' ? part.text : part?.type === 'image' ? '[image]' : '')).join('\n');
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text;
}

const sessions = new Map<string, ScenarioSession>();

export function sessionFor(scenario: ScenarioDefinition): ScenarioSession {
  let session = sessions.get(scenario.id);
  if (!session) sessions.set(scenario.id, (session = new ScenarioSession(scenario)));
  return session;
}
