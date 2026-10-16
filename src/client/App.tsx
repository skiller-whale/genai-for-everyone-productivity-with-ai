import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Artifact, LearnerView, ScenarioState, ScenarioSummary, StreamMessage } from '../shared/types';
import { api, WATCH } from './api';
import { Chat } from './Chat';
import { Panel, type PanelTab } from './Panel';
import { Sidebar } from './Sidebar';

// Three columns: scenarios and files on the left, the chat in the middle,
// artifacts on the right. The current scenario lives in the URL hash.
// On /watch (the coach's view) it instead follows what the learner has on
// screen, and nothing can be changed.

const currentHash = () => decodeURIComponent(location.hash.slice(1));

export function App() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [id, setId] = useState(WATCH ? '' : currentHash());
  const [learnerView, setLearnerView] = useState<LearnerView | null>(null);
  const [state, setState] = useState<ScenarioState | null>(null);
  const [tabs, setTabs] = useState<PanelTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(savedPanelWidth);
  const [resizing, setResizing] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // Drag the panel's left edge to resize it; double-click to go back to the default.
  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setResizing(true);
    let width = panelWidth;
    const move = (ev: PointerEvent) => {
      width = clampPanelWidth(window.innerWidth - ev.clientX);
      setPanelWidth(width);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      setResizing(false);
      rememberPanelWidth(width);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  const resetWidth = () => {
    const width = defaultPanelWidth();
    setPanelWidth(width);
    rememberPanelWidth(null);
  };

  useEffect(() => {
    api.scenarios().then((list) => {
      setScenarios(list);
      if (!WATCH && !currentHash() && list[0]) location.hash = list[0].id;
    }, (err) => setError(String(err)));
    if (WATCH) {
      const source = new EventSource('/api/view/events');
      source.onmessage = (e) => {
        const view: LearnerView = JSON.parse(e.data);
        setLearnerView(view);
        if (view.scenario) setId(view.scenario);
      };
      return () => source.close();
    }
    const onHash = () => setId(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openArtifact = useCallback((artifact: Artifact) => {
    setTabs((list) => upsertTab(list, { path: artifact.path, title: artifact.title, version: artifact.version, artifact: true }));
    setActive(artifact.path);
    setPanelOpen(true);
  }, []);

  const load = useCallback(async (scenarioId: string) => {
    const next = await api.state(scenarioId);
    loadedFor.current = scenarioId;
    setState(next);
    const artifactTabs = next.artifacts.map((a) => ({ path: a.path, title: a.title, version: a.version, artifact: true }));
    setTabs(artifactTabs);
    const last = artifactTabs.at(-1);
    setActive(last?.path ?? null);
    setPanelOpen(Boolean(last));
  }, []);

  // Load the scenario, then follow its stream for as long as it's selected.
  useEffect(() => {
    if (!id) return;
    setState(null);
    load(id).catch((err) => setError(String(err)));
    const source = new EventSource(`/api/s/${id}/stream`);
    source.onmessage = (e) => {
      const message: StreamMessage = JSON.parse(e.data);
      if (message.kind === 'reset') {
        load(id);
        return;
      }
      setState((s) => (s && loadedFor.current === id ? apply(s, message) : s));
      if (message.kind === 'event' && message.event.type === 'artifact') openArtifact(message.event.artifact);
    };
    return () => source.close();
  }, [id, load, openArtifact]);

  const openFile = (path: string) => {
    const artifact = state?.artifacts.find((a) => a.path === path);
    if (artifact) return openArtifact(artifact);
    setTabs((list) => upsertTab(list, { path, title: path.split('/').pop()!, version: Date.now(), artifact: false }));
    setActive(path);
    setPanelOpen(true);
  };

  // The learner's page tells the server what it shows, for the coach.
  const shownTab = panelOpen && tabs.length ? active : null;
  useEffect(() => {
    if (!WATCH && id) api.publishView({ scenario: id, tab: shownTab }).catch(() => {});
  }, [id, shownTab]);

  // The coach's page opens the same tab as the learner, once the scenario has loaded.
  useEffect(() => {
    if (!WATCH || !learnerView || !state || state.scenario.id !== learnerView.scenario) return;
    if (learnerView.tab) openFile(learnerView.tab);
    else setPanelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerView, state?.scenario.id, state?.artifacts.length]);

  const closeTab = (path: string) => {
    const rest = tabs.filter((t) => t.path !== path);
    setTabs(rest);
    if (active === path) setActive(rest.at(-1)?.path ?? null);
    if (!rest.length) setPanelOpen(false);
  };

  return (
    <div
      className={`app ${panelOpen && tabs.length ? 'with-panel' : ''} ${resizing ? 'resizing' : ''}`}
      style={{ '--panel-width': `${clampPanelWidth(panelWidth)}px` } as CSSProperties}
    >
      <Sidebar
        scenarios={scenarios}
        currentId={id}
        files={state?.files ?? []}
        onOpenFile={openFile}
      />
      <main className="centre">
        {WATCH && <div className="banner watch">Coach view: following the learner's screen. Read-only.</div>}
        {error && <div className="banner">{error}</div>}
        {state ? (
          <Chat
            key={state.scenario.id}
            state={state}
            onOpenArtifact={openArtifact}
            panelHidden={!panelOpen && tabs.length > 0}
            onShowPanel={() => setPanelOpen(true)}
          />
        ) : (
          <div className="loading">{WATCH && !id ? 'Waiting for the learner to open the workspace…' : 'Loading…'}</div>
        )}
      </main>
      {panelOpen && tabs.length > 0 && state && (
        <Panel
          scenarioId={state.scenario.id}
          tabs={tabs}
          active={active}
          onSelect={setActive}
          onClose={closeTab}
          onHide={() => setPanelOpen(false)}
          onResizeStart={startResize}
          onResizeReset={resetWidth}
        />
      )}
    </div>
  );
}

const SIDEBAR = 260;
const MIN_CHAT = 340;
const MIN_PANEL = 320;
const WIDTH_KEY = 'cowork.panelWidth';

const defaultPanelWidth = () => Math.round((window.innerWidth - SIDEBAR) * 0.53);

function clampPanelWidth(width: number): number {
  return Math.max(MIN_PANEL, Math.min(width, window.innerWidth - SIDEBAR - MIN_CHAT));
}

function savedPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (saved > 0) return saved;
  } catch {}
  return defaultPanelWidth();
}

function rememberPanelWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch {}
}

function upsertTab(list: PanelTab[], tab: PanelTab): PanelTab[] {
  return list.some((t) => t.path === tab.path) ? list.map((t) => (t.path === tab.path ? tab : t)) : [...list, tab];
}

function apply(state: ScenarioState, message: StreamMessage): ScenarioState {
  switch (message.kind) {
    case 'running':
      return { ...state, running: message.running };
    case 'files':
      return { ...state, files: message.files };
    case 'event': {
      const event = message.event;
      const artifacts =
        event.type === 'artifact'
          ? state.artifacts.some((a) => a.path === event.artifact.path)
            ? state.artifacts.map((a) => (a.path === event.artifact.path ? event.artifact : a))
            : [...state.artifacts, event.artifact]
          : state.artifacts;
      return { ...state, events: [...state.events, event], artifacts };
    }
    default:
      return state;
  }
}
