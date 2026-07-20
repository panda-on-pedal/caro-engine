import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { newGame, serializeState, type GameState } from '../engine/state.ts';
import { isValidGameResult, type GameResult } from '../shared/results.ts';

export const DEFAULT_PORT = 2026;

export interface ServerOptions {
  /** Directory that contains index.html, main.js, engineWorker.js. */
  assetRoot: string;
  /** Directory for state.json and results.json. */
  dataDir: string;
  port?: number;
}

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/main.js': 'main.js',
  '/engineWorker.js': 'engineWorker.js',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function isValidGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(state.board) &&
    Array.isArray(state.moveHistory) &&
    (state.nextPlayer === 1 || state.nextPlayer === 2) &&
    (state.winner === null || state.winner === 1 || state.winner === 2 || state.winner === 'draw')
  );
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Starts the Caro HTTP server. Resolves once listening. */
export async function startServer(options: ServerOptions): Promise<Server> {
  const port = options.port ?? DEFAULT_PORT;
  const assetRoot = options.assetRoot;
  const statePath = join(options.dataDir, 'state.json');
  const resultsPath = join(options.dataDir, 'results.json');

  await mkdir(options.dataDir, { recursive: true });

  if (!existsSync(statePath)) {
    await writeFile(statePath, serializeState(newGame()));
  }
  if (!existsSync(resultsPath)) {
    await writeFile(resultsPath, '[]');
  }

  /** Serializes concurrent appends from multiple boards posting results at
   * once: each call chains onto the previous append instead of racing a
   * read-modify-write against it. */
  let resultsWriteChain: Promise<unknown> = Promise.resolve();

  async function appendResult(result: GameResult): Promise<void> {
    const raw = await readFile(resultsPath, 'utf-8');
    const records = JSON.parse(raw) as GameResult[];
    records.push(result);
    await writeFile(resultsPath, JSON.stringify(records, null, 2));
  }

  async function handleGetState(res: ServerResponse): Promise<void> {
    const raw = await readFile(statePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] });
    res.end(raw);
  }

  async function handlePutState(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readRequestBody(req);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendText(res, 400, 'Invalid JSON');
      return;
    }

    if (!isValidGameState(parsed)) {
      sendText(res, 400, 'Invalid game state');
      return;
    }

    const serialized = serializeState(parsed);
    await writeFile(statePath, serialized);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] });
    res.end(serialized);
  }

  async function handleGetResults(res: ServerResponse): Promise<void> {
    const raw = await readFile(resultsPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] });
    res.end(raw);
  }

  async function handlePostResults(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readRequestBody(req);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      sendText(res, 400, 'Invalid JSON');
      return;
    }

    if (!isValidGameResult(parsed)) {
      sendText(res, 400, 'Invalid game result');
      return;
    }

    const result = parsed;
    // Chain onto the previous append regardless of whether it failed, so one
    // bad append can't permanently wedge every later POST behind a rejection.
    const appendPromise = resultsWriteChain.catch(() => undefined).then(() => appendResult(result));
    resultsWriteChain = appendPromise;
    await appendPromise;

    res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] });
    res.end(JSON.stringify(result));
  }

  async function handleDeleteResults(res: ServerResponse): Promise<void> {
    const clearPromise = resultsWriteChain.catch(() => undefined).then(async () => {
      await writeFile(resultsPath, '[]');
    });
    resultsWriteChain = clearPromise;
    await clearPromise;
    res.writeHead(204);
    res.end();
  }

  async function handleStatic(pathname: string, res: ServerResponse): Promise<void> {
    const relativePath = STATIC_FILES[pathname];
    if (!relativePath) {
      sendText(res, 404, 'Not found');
      return;
    }

    try {
      const content = await readFile(join(assetRoot, relativePath));
      const contentType = CONTENT_TYPES[extname(relativePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      sendText(res, 404, 'Not found');
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        await handleGetState(res);
        return;
      }
      if (req.method === 'PUT') {
        await handlePutState(req, res);
        return;
      }
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, PUT' });
      res.end('Method Not Allowed');
      return;
    }

    if (url.pathname === '/api/results') {
      if (req.method === 'GET') {
        await handleGetResults(res);
        return;
      }
      if (req.method === 'POST') {
        await handlePostResults(req, res);
        return;
      }
      if (req.method === 'DELETE') {
        await handleDeleteResults(res);
        return;
      }
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, POST, DELETE' });
      res.end('Method Not Allowed');
      return;
    }

    await handleStatic(url.pathname, res);
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      console.error(error);
      if (!res.headersSent) {
        sendText(res, 500, 'Internal Server Error');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}
