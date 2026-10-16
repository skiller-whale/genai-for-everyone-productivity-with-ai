import type { LearnerView, ScenarioState, ScenarioSummary } from '../shared/types';

/** The coach's read-only view of the learner's workspace. */
export const WATCH = location.pathname.startsWith('/watch');

// Thin wrappers over the server's API.

async function ok(res: Response): Promise<Response> {
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res;
}

// Nothing on /watch may change the learner's work: every call that would refuses.
const readOnly = () => Promise.reject(new Error('This is a read-only view.'));

const post = (url: string, body?: unknown): Promise<Response> =>
  WATCH ? readOnly() : fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(ok);

export const api = {
  scenarios: (): Promise<ScenarioSummary[]> => fetch('/api/scenarios').then(ok).then((r) => r.json()),
  state: (id: string): Promise<ScenarioState> => fetch(`/api/s/${id}`).then(ok).then((r) => r.json()),
  send: (id: string, text: string, from?: 'artifact') => post(`/api/s/${id}/messages`, { text, from }),
  stop: (id: string) => post(`/api/s/${id}/stop`),
  reset: (id: string) => post(`/api/s/${id}/reset`),
  loadArtifactData: (id: string, path: string) =>
    fetch(`/api/s/${id}/artifact-data?path=${encodeURIComponent(path)}`).then(ok).then((r) => r.json()),
  saveArtifactData: (id: string, path: string, data: unknown) =>
    WATCH ? readOnly() : fetch(`/api/s/${id}/artifact-data?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? null),
    }).then(ok),
  publishView: (view: LearnerView) =>
    WATCH ? readOnly() : fetch('/api/view', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(view) }),
};

export const fileUrl = (id: string, path: string) => `/w/${id}/${path.split('/').map(encodeURIComponent).join('/')}`;
