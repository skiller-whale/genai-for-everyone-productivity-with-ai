import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario } from '../shared/types';
import { SCENARIOS_DIR } from './config';

// A scenario is a folder under scenarios/:
//   scenario.json   title, blurb, icon, brief, starters, instructions
//   files/          copied into the scenario's workspace folder; anything in
//                   files/.claude/ (CLAUDE.md, skills) is picked up by Claude Code
// "hidden": true in scenario.json keeps a scenario out of the app.

export type ScenarioDefinition = Scenario & {
  /** Added to Claude's system prompt for this scenario. Never sent to the client. */
  instructions: string;
  filesDir: string;
};

export function loadScenarios(): ScenarioDefinition[] {
  return readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SCENARIOS_DIR, entry.name, 'scenario.json')))
    .map((entry) => ({ entry, json: JSON.parse(readFileSync(join(SCENARIOS_DIR, entry.name, 'scenario.json'), 'utf8')) }))
    .filter(({ json }) => !json.hidden)
    .map(({ entry, json }) => {
      const dir = join(SCENARIOS_DIR, entry.name);
      return {
        id: entry.name,
        title: json.title,
        blurb: json.blurb ?? '',
        icon: json.icon ?? '📁',
        brief: json.brief ?? '',
        starters: json.starters ?? [],
        instructions: json.instructions ?? '',
        order: json.order ?? 99,
        filesDir: join(dir, 'files'),
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    .map(({ order, ...scenario }) => scenario);
}

export function publicScenario({ instructions, filesDir, ...scenario }: ScenarioDefinition): Scenario {
  return scenario;
}
