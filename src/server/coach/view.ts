import type { LearnerView } from '../../shared/types';

// What the learner has on screen, as their page last published it: the
// scenario and the panel tab. Held in memory only; the learner's page
// republishes it whenever it loads.

type Listener = (view: LearnerView) => void;

let view: LearnerView = { scenario: null, tab: null };
const listeners = new Set<Listener>();

export const getView = (): LearnerView => view;

export function setView(next: LearnerView): void {
  view = { scenario: next.scenario ?? null, tab: next.tab ?? null };
  for (const listener of listeners) listener(view);
}

/** Call `listener` on every change; returns the unsubscribe function. */
export function onViewChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
