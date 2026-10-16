import { marked } from 'marked';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { api, fileUrl } from './api';

// The right-hand panel: one tab per artifact Claude has shown, plus any file
// opened from the sidebar. HTML runs in a sandboxed frame with an opaque
// origin; it reaches the app only through window.cowork (artifact-bridge.js),
// whose calls arrive here as postMessages.

export type PanelTab = { path: string; title: string; version: number; artifact: boolean };

export function Panel({
  scenarioId,
  tabs,
  active,
  onSelect,
  onClose,
  onHide,
  onResizeStart,
  onResizeReset,
}: {
  scenarioId: string;
  tabs: PanelTab[];
  active: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onHide: () => void;
  onResizeStart: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
}) {
  const tab = tabs.find((t) => t.path === active) ?? tabs.at(-1)!;
  const [reloads, setReloads] = useState(0);

  return (
    <section className="panel">
      <div
        className="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the panel"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
      />
      <div className="panel-tabs">
        <div className="tab-strip">
          {tabs.map((t) => (
            <div key={t.path} className={`tab ${t.path === tab.path ? 'on' : ''}`}>
              <button className="tab-name" onClick={() => onSelect(t.path)} title={t.path}>
                {t.artifact ? '▣ ' : ''}
                {t.title}
              </button>
              <button className="tab-x" onClick={() => onClose(t.path)} aria-label={`Close ${t.title}`}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="panel-actions">
          <button onClick={() => setReloads((n) => n + 1)} title="Reload">
            ↻
          </button>
          <a href={`${fileUrl(scenarioId, tab.path)}${isHtml(tab.path) ? '?artifact' : ''}`} target="_blank" rel="noreferrer" title="Open in a new tab">
            ↗
          </a>
          <button onClick={onHide} title="Hide the panel">
            ⇥
          </button>
        </div>
      </div>
      <div className="panel-body">
        <Viewer key={`${tab.path}:${tab.version}:${reloads}`} scenarioId={scenarioId} tab={tab} />
      </div>
    </section>
  );
}

function Viewer({ scenarioId, tab }: { scenarioId: string; tab: PanelTab }) {
  const url = fileUrl(scenarioId, tab.path);
  const ext = tab.path.split('.').pop()!.toLowerCase();
  if (isHtml(tab.path)) return <ArtifactFrame scenarioId={scenarioId} path={tab.path} src={`${url}?artifact&v=${tab.version}`} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <div className="image-view"><img src={`${url}?v=${tab.version}`} alt={tab.title} /></div>;
  if (['xlsx', 'xls', 'docx', 'pptx', 'pdf', 'zip'].includes(ext)) return <Download url={url} name={tab.path} />;
  return <TextView url={url} ext={ext} />;
}

function ArtifactFrame({ scenarioId, path, src }: { scenarioId: string; path: string; src: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const { cowork: method, id, arg } = event.data ?? {};
      if (!method) return;
      const reply = (value: unknown, error?: string) =>
        (event.source as Window).postMessage({ coworkReply: id, value, error }, '*');
      try {
        if (method === 'load') reply(await api.loadArtifactData(scenarioId, path));
        else if (method === 'save') reply(await api.saveArtifactData(scenarioId, path, arg).then(() => true));
        else if (method === 'send') reply(await api.send(scenarioId, arg, 'artifact').then(() => true));
        else reply(null, `Unknown call ${method}`);
      } catch (err) {
        reply(null, err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [scenarioId, path]);

  return (
    <iframe
      ref={frame}
      src={src}
      title={path}
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
    />
  );
}

/** Big files are previewed from their first couple of megabytes. */
const PREVIEW_BYTES = 2_000_000;

function TextView({ url, ext }: { url: string; ext: string }) {
  const [file, setFile] = useState<{ text: string; partial: boolean } | null>(null);
  useEffect(() => {
    fetch(`${url}?head=${PREVIEW_BYTES}`)
      .then(async (r) => ({ text: await r.text(), partial: r.headers.get('X-Cowork-Preview') === 'partial' }))
      .then(setFile, (err) => setFile({ text: String(err), partial: false }));
  }, [url]);
  if (file === null) return <div className="faint pad">Loading…</div>;
  const { text, partial } = file;
  if (ext === 'md') return <div className="md-view" dangerouslySetInnerHTML={{ __html: marked.parse(text, { async: false }) as string }} />;
  if (ext === 'csv' || ext === 'tsv') return <CsvView text={text} separator={ext === 'tsv' ? '\t' : ','} partial={partial} />;
  return <pre className="text-view">{text}{partial && '\n…'}</pre>;
}

function CsvView({ text, separator, partial }: { text: string; separator: string; partial: boolean }) {
  const rows = parseCsv(text, separator);
  const [head, ...body] = rows;
  if (!head) return <div className="faint pad">Empty file</div>;
  return (
    <div className="csv-view">
      <table>
        <thead>
          <tr>{head.map((cell, i) => <th key={i}>{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.slice(0, 1000).map((row, r) => (
            <tr key={r}>{head.map((_, c) => <td key={c}>{row[c]}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {partial ? (
        <div className="faint pad">Showing the first {Math.min(body.length, 1000).toLocaleString()} rows of a large file</div>
      ) : (
        body.length > 1000 && <div className="faint pad">Showing 1,000 of {body.length.toLocaleString()} rows</div>
      )}
    </div>
  );
}

function Download({ url, name }: { url: string; name: string }) {
  return (
    <div className="download pad">
      <p>This kind of file can't be shown here.</p>
      <a className="button" href={url} download={name.split('/').pop()}>
        Download {name.split('/').pop()}
      </a>
    </div>
  );
}

const isHtml = (path: string) => /\.html?$/i.test(path);

function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === separator) row.push(cell), (cell = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows;
}
