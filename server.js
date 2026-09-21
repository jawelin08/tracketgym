import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.join(__dirname, 'frontend');
const frontendDistDir = path.join(frontendDir, 'dist');
const indexFile = path.join(frontendDistDir, 'index.html');
const port = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_PORT || 3001);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
const inferredOrigin = railwayDomain ? `https://${railwayDomain}` : `http://localhost:${port}`;
const apiOrigin = process.env.ORIGIN || inferredOrigin;
const rpId = process.env.RP_ID || railwayDomain || 'localhost';
const mediaFallbackImgBase = process.env.MEDIA_FALLBACK_IMG_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/';
const mediaFallbackGifBase = process.env.MEDIA_FALLBACK_GIF_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false,
    ...opts,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`);
  }
}

function ensureFrontendBuild() {
  if (fs.existsSync(indexFile)) return;

  ensureDir(path.join(__dirname, 'data'));
  run('npm', ['--prefix', 'frontend', 'install', '--include=dev']);
  run('npm', ['--prefix', 'frontend', 'run', 'build']);
}

function ensureApiDeps() {
  const marker = path.join(__dirname, 'api', 'node_modules', '@simplewebauthn', 'server');
  if (fs.existsSync(marker)) return;
  run('npm', ['--prefix', 'api', 'install', '--omit=dev', '--omit=optional']);
}

function startApiProcess() {
  const env = {
    ...process.env,
    PORT: String(apiPort),
    DATA_DIR: dataDir,
    ORIGIN: apiOrigin,
    RP_ID: rpId,
  };

  const child = spawn(process.execPath, ['api/server.js'], {
    cwd: __dirname,
    env,
    stdio: 'inherit',
  });

  child.on('exit', code => {
    console.error(`API exited with code ${code}`);
    process.exit(code || 1);
  });

  return child;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };
  return map[ext] || 'application/octet-stream';
}

function mediaFallbackUrl(safePath) {
  if (safePath.startsWith('img/')) {
    return new URL(safePath.slice(4), mediaFallbackImgBase).toString();
  }
  if (safePath.startsWith('gif/')) {
    return new URL(safePath.slice(4), mediaFallbackGifBase).toString();
  }
  return null;
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const safePath = path.normalize(pathname).replace(/^\/+/, '');
  const filePath = path.join(frontendDistDir, safePath);

  if (!filePath.startsWith(frontendDistDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      const source = fs.createReadStream(filePath);
      res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
      source.pipe(res);
      return;
    }

    const fallbackMedia = mediaFallbackUrl(safePath);
    if (fallbackMedia) {
      res.writeHead(302, { Location: fallbackMedia });
      res.end();
      return;
    }

    if (/\.[a-z0-9]+$/i.test(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const fallback = fs.createReadStream(indexFile);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fallback.pipe(res);
  });
}

async function proxyApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const targetUrl = `http://127.0.0.1:${apiPort}${url.pathname}${url.search}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${apiPort}`,
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readRequestBody(req),
    });

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = Buffer.from(await response.arrayBuffer());
    res.end(body);
  } catch (error) {
    console.error('API proxy failed:', error);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'bad gateway',
      detail: 'API backend unreachable from web process',
      hint: 'Set ORIGIN/RP_ID (or RAILWAY_PUBLIC_DOMAIN) and verify backend startup logs'
    }));
  }
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const apiHealth = async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
};

const start = async () => {
  ensureDir(dataDir);
  ensureApiDeps();
  ensureFrontendBuild();
  startApiProcess();

  await new Promise(resolve => setTimeout(resolve, 1500));
  const alive = await apiHealth();
  if (!alive) {
    console.warn(`API not ready on :${apiPort} yet; waiting for first requests`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await proxyApi(req, res);
      return;
    }
    serveStatic(req, res);
  });

  server.listen(port, () => {
    console.log(`single-service app listening on :${port}`);
    console.log(`frontend: ${frontendDistDir}`);
    console.log(`api: http://127.0.0.1:${apiPort}`);
  });
};

start().catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});
