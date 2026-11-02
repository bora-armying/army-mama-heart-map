// Runs the site on this computer for practice. Saved counts go to .local-counts.json
// (not tracked by git), so nothing here can change the live site.
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_COUNTS = join(ROOT, '.local-counts.json');
const PORT = Number(process.env.PORT) || 3000;

if (process.argv[2] === '--reset') {
  rmSync(LOCAL_COUNTS, { force: true });
  console.log('Practice numbers cleared.');
  process.exit(0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

function currentCounts() {
  return readFileSync(existsSync(LOCAL_COUNTS) ? LOCAL_COUNTS : join(ROOT, 'data/counts.json'));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

// Answers the same requests GitHub does when the update page saves.
function localApi(req, res) {
  if (req.method === 'GET') {
    return send(res, 200, JSON.stringify({ sha: 'local', content: currentCounts().toString('base64') }));
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const { content } = JSON.parse(body);
    writeFileSync(LOCAL_COUNTS, Buffer.from(content, 'base64'));
    send(res, 200, '{}');
  });
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/local-api/data/counts.json') return localApi(req, res);
  if (pathname === '/data/counts.json') return send(res, 200, currentCounts());

  const file = normalize(join(ROOT, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));
  const hidden = file.slice(ROOT.length).split(sep).some((part) => part.startsWith('.'));
  if (!file.startsWith(ROOT + sep) || hidden || !existsSync(file) || !extname(file)) {
    return send(res, 404, 'Not found', 'text/plain');
  }
  send(res, 200, readFileSync(file), TYPES[extname(file)] || 'application/octet-stream');
});

server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is already in use. Try: PORT=3001 npm start`);
  process.exit(1);
});

// Only this computer can reach it.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Map:         http://localhost:${PORT}/`);
  console.log(`Update page: http://localhost:${PORT}/admin.html`);
  console.log('Press Ctrl+C to stop.');
});
