import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { newGame, serializeState, type GameState } from '../engine/state.ts';

const PORT = 3000;
const ROOT = process.cwd();
const STATE_PATH = join(ROOT, 'state.json');

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/main.js': 'main.js',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

async function ensureStateFile(): Promise<void> {
  if (!existsSync(STATE_PATH)) {
    await writeFile(STATE_PATH, serializeState(newGame()));
  }
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

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

async function handleGetState(res: ServerResponse): Promise<void> {
  const raw = await readFile(STATE_PATH, 'utf-8');
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
  await writeFile(STATE_PATH, serialized);
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES['.json'] });
  res.end(serialized);
}

async function handleStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relativePath = STATIC_FILES[pathname];
  if (!relativePath) {
    sendText(res, 404, 'Not found');
    return;
  }

  try {
    const content = await readFile(join(ROOT, relativePath));
    const contentType = CONTENT_TYPES[extname(relativePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

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

await ensureStateFile();
server.listen(PORT, () => {
  console.log(`Caro server listening on http://localhost:${PORT}`);
});
