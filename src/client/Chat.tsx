import { marked, Renderer } from 'marked';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Artifact, ChatEvent, ScenarioState, Todo } from '../shared/types';
import { api, WATCH } from './api';
import { toolDetail, toolLabel } from './labels';

// The middle column: the conversation, Claude's plan while it works, and the
// box to type in. Tool calls are folded into a short list of steps.

type Step = { id: string; name: string; input: Record<string, unknown>; result?: { output: string; isError: boolean } };
type Item =
  | { kind: 'user'; key: string; text: string; from?: 'artifact' }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'steps'; key: string; steps: Step[] }
  | { kind: 'artifact'; key: string; artifact: Artifact }
  | { kind: 'error'; key: string; message: string };

// Claude's markdown, without letting raw HTML through.
const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
const markdown = (text: string) => marked.parse(text, { renderer, async: false }) as string;

export function Chat({
  state,
  onOpenArtifact,
  panelHidden,
  onShowPanel,
}: {
  state: ScenarioState;
  onOpenArtifact: (artifact: Artifact) => void;
  panelHidden: boolean;
  onShowPanel: () => void;
}) {
  const { scenario, events, running } = state;
  const items = useMemo(() => toItems(events), [events]);
  const todos = useMemo(() => latestTodos(events), [events]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  const send = async (text: string) => {
    if (!text.trim() || running) return;
    setSendError(null);
    try {
      await api.send(scenario.id, text);
      setDraft('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
  };

  // Two clicks to start over, so a stray one doesn't wipe the work.
  const [confirming, setConfirming] = useState(false);
  const reset = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    await api.reset(scenario.id);
  };

  return (
    <div className="chat">
      <header className="chat-head">
        <div>
          <h1>
            {scenario.icon} {scenario.title}
          </h1>
        </div>
        <div className="head-actions">
          {panelHidden && (
            <button className="ghost" onClick={onShowPanel}>
              Show artifacts
            </button>
          )}
          {!WATCH && (
            <button className={`ghost ${confirming ? 'danger' : ''}`} onClick={reset} disabled={running}>
              {confirming ? 'Clear chat and files?' : 'Start over'}
            </button>
          )}
        </div>
      </header>

      <div
        className="log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="log-inner">
          {!items.length && (
            <div className="empty">
              <div className="brief" dangerouslySetInnerHTML={{ __html: markdown(scenario.brief) }} />
              {scenario.starters.length > 0 && (
                <div className="starters">
                  {scenario.starters.map((s) => (
                    <button key={s} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {items.map((item) => (
            <ItemView key={item.key} item={item} onOpenArtifact={onOpenArtifact} />
          ))}
          {running && <Working events={events} />}
        </div>
      </div>

      {todos && (running || todos.some((t) => t.status !== 'completed')) && <Plan todos={todos} />}

      {!WATCH && <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        {sendError && <div className="send-error">{sendError}</div>}
        <textarea
          value={draft}
          placeholder={running ? 'Claude is working…' : 'Ask Claude to do something with these files'}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <div className="composer-actions">
          {running ? (
            <button type="button" className="stop" onClick={() => api.stop(scenario.id)}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()}>
              Send
            </button>
          )}
        </div>
      </form>}
    </div>
  );
}

function ItemView({ item, onOpenArtifact }: { item: Item; onOpenArtifact: (a: Artifact) => void }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className={`msg user ${item.from === 'artifact' ? 'from-artifact' : ''}`}>
          {item.from === 'artifact' && <div className="via">from an artifact</div>}
          {item.text}
        </div>
      );
    case 'text':
      return <div className="msg claude" dangerouslySetInnerHTML={{ __html: markdown(item.text) }} />;
    case 'steps':
      return <Steps steps={item.steps} />;
    case 'artifact':
      return (
        <button className="artifact-card" onClick={() => onOpenArtifact(item.artifact)}>
          <span className="art-icon">▣</span>
          <span>
            <span className="art-title">{item.artifact.title}</span>
            <span className="art-path">{item.artifact.path}</span>
          </span>
          <span className="art-open">Open</span>
        </button>
      );
    case 'error':
      return <div className="msg error">{item.message}</div>;
  }
}

function Steps({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="steps">
      {steps.map((step) => {
        const { icon, text } = toolLabel(step.name, step.input);
        const failed = step.result?.isError;
        return (
          <li key={step.id} className={`${failed ? 'failed' : ''} ${step.result ? '' : 'pending'}`}>
            <button className="step" onClick={() => setOpen(open === step.id ? null : step.id)}>
              <span className="step-icon">{icon}</span>
              <span className="step-text">{text}</span>
              {failed && <span className="step-flag">didn't work</span>}
            </button>
            {open === step.id && (
              <div className="step-detail">
                <pre>{toolDetail(step.name, step.input)}</pre>
                {step.result && <pre className="out">{step.result.output || '(no output)'}</pre>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Plan({ todos }: { todos: Todo[] }) {
  return (
    <div className="plan">
      <div className="plan-head">Plan</div>
      <ul>
        {todos.map((t, i) => (
          <li key={i} className={t.status}>
            <span className="box">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : ''}</span>
            {t.status === 'in_progress' ? t.activeForm || t.content : t.content}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Working({ events }: { events: ChatEvent[] }) {
  const last = events.at(-1);
  const label = last?.type === 'tool_use' ? toolLabel(last.name, last.input).text : 'Thinking';
  return (
    <div className="working">
      <span className="dots">
        <i />
        <i />
        <i />
      </span>
      {label}
    </div>
  );
}

function toItems(events: ChatEvent[]): Item[] {
  const items: Item[] = [];
  const steps = new Map<string, Step>();
  const texts = new Map<string, { kind: 'text'; key: string; text: string }>();
  let shownSinceUser = new Map<string, { kind: 'artifact'; key: string; artifact: Artifact }>();

  events.forEach((event, i) => {
    const last = items.at(-1);
    switch (event.type) {
      case 'user':
        items.push({ kind: 'user', key: event.id, text: event.text, from: event.from });
        shownSinceUser = new Map();
        break;
      case 'text_start': {
        const item = { kind: 'text' as const, key: event.id, text: '' };
        texts.set(event.id, item);
        items.push(item);
        break;
      }
      case 'text_delta': {
        const item = texts.get(event.id);
        if (item) item.text += event.delta;
        else {
          const created = { kind: 'text' as const, key: event.id, text: event.delta };
          texts.set(event.id, created);
          items.push(created);
        }
        break;
      }
      case 'tool_use': {
        if (event.name === 'TodoWrite') break; // shown as the plan instead
        const step: Step = { id: event.id, name: event.name, input: event.input };
        steps.set(event.id, step);
        if (last?.kind === 'steps') last.steps.push(step);
        else items.push({ kind: 'steps', key: `steps-${event.id}`, steps: [step] });
        break;
      }
      case 'tool_result': {
        const step = steps.get(event.id);
        if (step) step.result = { output: event.output, isError: event.isError };
        break;
      }
      case 'artifact': {
        const seen = shownSinceUser.get(event.artifact.path);
        if (seen) seen.artifact = event.artifact;
        else {
          const item = { kind: 'artifact' as const, key: `art-${i}`, artifact: event.artifact };
          shownSinceUser.set(event.artifact.path, item);
          items.push(item);
        }
        break;
      }
      case 'error':
        items.push({ kind: 'error', key: `err-${i}`, message: event.message });
        break;
    }
  });
  return items.filter((item) => item.kind !== 'text' || item.text.trim());
}

function latestTodos(events: ChatEvent[]): Todo[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'user') return null;
    if (e.type === 'todos') return e.todos;
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
