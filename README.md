# Cowork workspace

A browser workspace modelled on agents like Claude Cowork, for the Skiller
Whale session Creating Productivity Workflows. It runs in the session's hosted
environment. Pick a scenario on the left; chat with Claude in the middle;
Claude works on the scenario's files on a computer of its own and shows what
it makes (reports, dashboards, small tools) in the panel on the right.

## How it fits together

- **sandbox** container: the resident computer. Claude Code 2.1.296, Python
  with pandas/openpyxl/matplotlib/python-docx/pypdf, jq, ripgrep, pdftotext.
  It runs `sleep infinity` as the unprivileged `node` user.
- **app** container: a Bun server and a React page. Each chat turn runs Claude
  Code through the Agent SDK, but the SDK's `spawnClaudeCodeProcess` hook
  starts it with `docker exec` in the sandbox (`src/server/sandbox.ts`), so
  Claude's Bash/Read/Write/Edit act on the sandbox, never on the app.
- Both mount `./workspace-data` at `/workspace`. Each scenario gets
  `/workspace/<scenario>`, seeded from `scenarios/<id>/files/`. The app serves
  those files at `/w/<scenario>/…`, which is how the panel shows them.
- **Artifacts**: one extra tool, `show_artifact(path, title)`, from an
  in-process MCP server (`src/server/sessions.ts`). HTML artifacts run in a
  sandboxed iframe (opaque origin) and get `window.cowork`
  (`src/artifact-bridge.js`): `load()`, `save(data)` (written to
  `artifact-data/<file>.json`, where Claude can read it) and `send(text)`
  (posts a chat message). Editing a shown file reloads it in the panel.
- Claude Code loads each scenario's own `.claude/` folder (CLAUDE.md, skills)
  and nothing from anyone's user settings. Its sessions live in the sandbox,
  so a conversation resumes across app restarts.

## Run it locally

```sh
cp .env.example .env     # add CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY
docker compose up -d --build --wait
open http://localhost:1001   # or COWORK_PORT in .env
```

`docker compose logs -f app` shows Claude Code's stderr. "Start over" in a
scenario clears its chat and puts its files back.

## In the hosted environment

The module's `exercise_config.yaml` exports the Bedrock settings
(`CLAUDE_CODE_USE_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_MODEL`)
and runs `docker compose --profile hosted up --build --wait`. Claude Code
reaches the model through the Skiller Whale Bedrock proxy, with
`SW_ATTENDANCE_ID` as the access key. Learners open <http://localhost:1001>.

## Following a learner (for coaches)

The coach gets one synced file, `COWORK.md`, in their "Recently edited files".
It starts with a link to the learner's workspace at `/watch`: a live,
read-only view that follows the scenario and the panel tab the learner has
open. Under the link is a short summary of each scenario: how many messages,
the latest few, and the artifacts made.

The learner's page publishes what it shows to `PUT /api/view`; `/watch`
follows it from `GET /api/view/events`. Nothing on `/watch` can send, stop,
reset or save. The `sync` service (learnersync) runs only with
`--profile hosted`.

## Scenarios

`scenarios/<id>/scenario.json` (title, icon, blurb, brief, starters, and
`instructions` for Claude's system prompt) plus `files/`. `"hidden": true`
keeps one out of the app. Learners can't add files of their own. Files in
`files/` ending `.gz` are unpacked when the workspace is seeded, so big data
stays small in git. The file panel previews only the first 2 MB of a big
text or CSV file.

- **British birds**: 1.46 million bird records for 2000, 2010 and 2020 from
  the British Trust for Ornithology via the NBN Atlas (Open Government
  Licence), and 364 photos from Wikimedia Commons, each with its licence and
  credit line in `images.csv` (CC BY, CC BY-SA, CC0 or public domain).
- **Coaching attendance**: generated data. Nine months of session invites
  and attendance for about 300 learners in 28 weekly groups at six made-up
  client companies.
