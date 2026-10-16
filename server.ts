import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import index from './src/client/index.html';
import type { LearnerView, StreamMessage } from './src/shared/types';
import { scheduleCoachFile, writeCoachFile } from './src/server/coach/syncFile';
import { getView, onViewChange, setView } from './src/server/coach/view';
import { PORT } from './src/server/config';
import { checkSandbox } from './src/server/sandbox';
import { loadScenarios, publicScenario } from './src/server/scenarios';
import { sessionFor } from './src/server/sessions';
import { giveToSandbox, prepareWorkspace, safePath } from './src/server/workspace';

// One Bun server: the page, a small JSON API per scenario, a server-sent
// event stream of each scenario's chat, and the scenario's files (which is
// how artifacts are served to the panel's sandboxed frames).

prepareWorkspace();
const scenarios = loadScenarios();
const byId = new Map(scenarios.map((s) => [s.id, s]));
const bridge = readFileSync(join(import.meta.dir, 'src/artifact-bridge.js'), 'utf8');

// The coach's summary file follows every scenario's chat and the learner's view.
const allStates = () => scenarios.map((s) => sessionFor(s).state());
for (const scenario of scenarios) sessionFor(scenario).subscribe(() => scheduleCoachFile(allStates));
onViewChange(() => scheduleCoachFile(allStates));
writeCoachFile(allStates());

const sandboxProblem = checkSandbox();
if (sandboxProblem) console.warn(sandboxProblem);

function withSession<T>(req: { params: { id: string } }, fn: (session: ReturnType<typeof sessionFor>) => T): T | Response {
  const scenario = byId.get(req.params.id);
  return scenario ? fn(sessionFor(scenario)) : new Response('No such scenario', { status: 404 });
}

/** A server-sent event stream: `start` gets a send function and returns its cleanup. */
function eventStream(req: Request, start: (send: (data: unknown) => void) => () => void): Response {
  let stop = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      stop = start((data) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)));
      ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 20000);
      req.signal.addEventListener('abort', () => {
        stop();
        clearInterval(ping);
      });
    },
    cancel() {
      stop();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
}

/** Artifact frames have an opaque origin, so their fetches to us are cross-origin. */
const CORS = { 'Access-Control-Allow-Origin': '*' };

function artifactDataFile(id: string, path: string): string | null {
  return safePath(id, join('artifact-data', `${basename(path)}.json`));
}

Bun.serve({
  port: PORT,
  development: process.env.NODE_ENV !== 'production',
  idleTimeout: 0,
  routes: {
    '/': index,
    // The coach's read-only view of the learner's workspace.
    '/watch': index,

    // The learner's page publishes what it has on screen; the coach's /watch page follows it.
    '/api/view': {
      GET: () => Response.json(getView()),
      PUT: async (req) => (setView((await req.json()) as LearnerView), new Response(null, { status: 204 })),
    },
    '/api/view/events': (req) =>
      eventStream(req, (send) => {
        send(getView());
        return onViewChange(send);
      }),

    '/api/scenarios': () => Response.json(scenarios.map(publicScenario)),

    '/api/s/:id': (req) => withSession(req, (s) => Response.json(s.state())),

    '/api/s/:id/stream': (req) =>
      withSession(req, (session) => {
        let unsubscribe = () => {};
        let ping: ReturnType<typeof setInterval>;
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const send = (message: StreamMessage) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
            unsubscribe = session.subscribe(send);
            ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 20000);
            req.signal.addEventListener('abort', () => {
              unsubscribe();
              clearInterval(ping);
            });
          },
          cancel() {
            unsubscribe();
            clearInterval(ping);
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
      }),

    '/api/s/:id/messages': {
      POST: async (req) => {
        const { text, from } = (await req.json()) as { text?: string; from?: 'artifact' };
        if (!text?.trim()) return new Response('Empty message', { status: 400 });
        return withSession(req, (s) =>
          s.send(text.trim(), from) ? new Response(null, { status: 202 }) : new Response('Claude is still working', { status: 409 }),
        );
      },
    },

    '/api/s/:id/stop': { POST: (req) => withSession(req, (s) => (s.stop(), new Response(null, { status: 204 }))) },

    '/api/s/:id/reset': { POST: (req) => withSession(req, (s) => (s.reset(), new Response(null, { status: 204 }))) },

    // What an artifact saved with cowork.save(), kept beside the scenario's files so Claude can read it.
    '/api/s/:id/artifact-data': {
      GET: (req) => {
        const file = artifactDataFile(req.params.id, new URL(req.url).searchParams.get('path') ?? '');
        if (!file) return new Response('Bad path', { status: 400 });
        return existsSync(file) ? new Response(Bun.file(file), { headers: { 'Content-Type': 'application/json' } }) : Response.json(null);
      },
      PUT: async (req) => {
        const file = artifactDataFile(req.params.id, new URL(req.url).searchParams.get('path') ?? '');
        if (!file) return new Response('Bad path', { status: 400 });
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(await req.json(), null, 2));
        giveToSandbox(dirname(file));
        return withSession(req, (s) => (s.filesChanged(), new Response(null, { status: 204 })));
      },
    },

    '/w/:id/*': async (req) => {
      const url = new URL(req.url);
      const path = decodeURIComponent(url.pathname.slice(`/w/${req.params.id}/`.length));
      const full = byId.has(req.params.id) ? safePath(req.params.id, path) : null;
      if (!full || !existsSync(full) || !statSync(full).isFile()) return new Response('Not found', { status: 404, headers: CORS });
      const headers = { ...CORS, 'Cache-Control': 'no-store' };
      if (url.searchParams.has('artifact') && /\.html?$/i.test(full)) {
        // Every HTML artifact gets window.cowork before its own scripts run.
        const html = readFileSync(full, 'utf8');
        const tag = `<script>${bridge}</script>`;
        const injected = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
        return new Response(injected, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
      }
      const head = Number(url.searchParams.get('head'));
      if (head > 0 && statSync(full).size > head) {
        // A preview of a big file: the first `head` bytes, cut at the last full line.
        const bytes = await Bun.file(full).slice(0, head).bytes();
        const end = bytes.lastIndexOf(10) + 1 || bytes.length;
        return new Response(bytes.subarray(0, end), { headers: { ...headers, 'X-Cowork-Preview': 'partial' } });
      }
      return new Response(Bun.file(full), { headers });
    },
  },
});

console.log(`Cowork on http://localhost:${PORT}`);
