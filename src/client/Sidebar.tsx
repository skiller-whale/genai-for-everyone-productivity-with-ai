import { useState } from 'react';
import type { FileEntry, ScenarioSummary } from '../shared/types';

// A top-level folder with more files than this shows as one row that opens on click.
const COLLAPSE_OVER = 10;

export function Sidebar({
  scenarios,
  currentId,
  files,
  onOpenFile,
}: {
  scenarios: ScenarioSummary[];
  currentId: string;
  files: FileEntry[];
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const counts = new Map<string, number>();
  for (const f of files) {
    const top = topFolder(f.path);
    if (top) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const toggle = (dir: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      return next;
    });

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">◆</span> Cowork
      </div>

      <div className="side-heading">Scenarios</div>
      <nav className="scenarios">
        {scenarios.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={s.id === currentId ? 'on' : ''}>
            <span className="icon">{s.icon}</span>
            <span>
              <span className="title">{s.title}</span>
              <span className="blurb">{s.blurb}</span>
            </span>
          </a>
        ))}
      </nav>

      <div className="side-heading files-heading">Files</div>
      <ul className="files">
        {files.map((f, i) => {
          const top = topFolder(f.path);
          const collapsible = top !== null && (counts.get(top) ?? 0) > COLLAPSE_OVER;
          const firstInFolder = collapsible && topFolder(files[i - 1]?.path ?? '') !== top;
          const folderRow = firstInFolder && (
            <li key={`${top}/`}>
              <button className="folder" onClick={() => toggle(top!)} aria-expanded={open.has(top!)}>
                <span className="caret">{open.has(top!) ? '▾' : '▸'}</span>
                {top}/ <span className="dir">· {counts.get(top!)} files</span>
              </button>
            </li>
          );
          if (collapsible && !open.has(top!)) return folderRow || null;
          const slash = f.path.lastIndexOf('/');
          return [
            folderRow,
            <li key={f.path}>
              <button onClick={() => onOpenFile(f.path)} title={`${f.path} · ${size(f.size)}`}>
                {slash > 0 && <span className="dir">{f.path.slice(0, slash + 1)}</span>}
                {f.path.slice(slash + 1)}
              </button>
            </li>,
          ];
        })}
        {!files.length && <li className="faint">No files yet</li>}
      </ul>
    </aside>
  );
}

function topFolder(path: string): string | null {
  const slash = path.indexOf('/');
  return slash > 0 ? path.slice(0, slash) : null;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
