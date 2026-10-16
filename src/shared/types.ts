// Shapes shared by the server and the client.

export type ScenarioSummary = {
  id: string;
  title: string;
  /** One line for the sidebar. */
  blurb: string;
  icon: string;
};

export type Scenario = ScenarioSummary & {
  /** Shown above an empty chat: who you are and what you're doing. */
  brief: string;
  /** Clickable first messages. */
  starters: string[];
};

export type Artifact = {
  /** Path relative to the scenario folder; also its identity. */
  path: string;
  title: string;
  /** Bumped whenever the file changes, so the panel reloads it. */
  version: number;
};

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string };

export type FileEntry = { path: string; size: number; modified: number };

/** One entry in a scenario's chat log. Text arrives as text_start + text_delta. */
export type ChatEvent =
  | { type: 'user'; id: string; text: string; from?: 'artifact' }
  | { type: 'text_start'; id: string }
  | { type: 'text_delta'; id: string; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; output: string; isError: boolean }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'todos'; todos: Todo[] }
  | { type: 'turn_end'; durationMs: number; costUsd?: number }
  | { type: 'error'; message: string };

/** What the stream sends: chat events plus state changes the log doesn't keep. */
export type StreamMessage =
  | { kind: 'event'; event: ChatEvent }
  | { kind: 'running'; running: boolean }
  | { kind: 'files'; files: FileEntry[] }
  | { kind: 'reset' };

export type ScenarioState = {
  scenario: Scenario;
  events: ChatEvent[];
  artifacts: Artifact[];
  files: FileEntry[];
  running: boolean;
};

/** What the learner has on screen, mirrored to the coach's /watch page. */
export type LearnerView = {
  scenario: string | null;
  /** The path of the panel tab they have open, or null if the panel is closed. */
  tab: string | null;
};
