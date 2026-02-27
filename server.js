const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SESSIONS_DIR = path.join(ROOT, 'data', 'sessions');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function readSession(id) {
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  const content = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeSession(session) {
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  await fsp.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
}

function buildCsv(headers, rows) {
  const escapeCell = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [];
  lines.push(headers.map(escapeCell).join(','));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','));
  }
  return `\uFEFF${lines.join('\n')}`;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'POST' && url.pathname === '/api/sessions') {
          const body = await parseBody(req);
          const headers = Array.isArray(body.headers) ? body.headers : [];
          const rows = Array.isArray(body.rows) ? body.rows : [];
          const fileName = String(body.fileName || 'uploaded-file');

          if (!headers.length || !rows.length) {
            return sendJson(res, 400, { error: 'headers 和 rows 不能为空' });
          }

          const id = randomUUID();
          const now = new Date().toISOString();
          const session = {
            id,
            fileName,
            headers,
            rows,
            reviews: {},
            createdAt: now,
            updatedAt: now,
          };

          await writeSession(session);
          return sendJson(res, 201, { id, totalRows: rows.length, createdAt: now });
        }

        const sessionMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)$/i);
        const exportMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)\/export$/i);

        if (sessionMatch && req.method === 'GET') {
          const sessionId = sessionMatch[1];
          try {
            const session = await readSession(sessionId);
            return sendJson(res, 200, session);
          } catch {
            return sendJson(res, 404, { error: '会话不存在' });
          }
        }

        if (sessionMatch && req.method === 'PATCH') {
          const sessionId = sessionMatch[1];
          const body = await parseBody(req);
          const rowIndex = Number(body.rowIndex);
          const status = String(body.status || '待处理');
          const note = String(body.note || '');

          if (!Number.isInteger(rowIndex) || rowIndex < 0) {
            return sendJson(res, 400, { error: 'rowIndex 非法' });
          }

          let session;
          try {
            session = await readSession(sessionId);
          } catch {
            return sendJson(res, 404, { error: '会话不存在' });
          }

          if (rowIndex >= session.rows.length) {
            return sendJson(res, 400, { error: 'rowIndex 超出范围' });
          }

          session.reviews[String(rowIndex)] = { status, note, updatedAt: new Date().toISOString() };
          session.updatedAt = new Date().toISOString();
          await writeSession(session);

          return sendJson(res, 200, { ok: true });
        }

        if (exportMatch && req.method === 'GET') {
          const sessionId = exportMatch[1];
          let session;
          try {
            session = await readSession(sessionId);
          } catch {
            return sendJson(res, 404, { error: '会话不存在' });
          }

          const exportHeaders = [...session.headers, '审核状态', '审核备注'];
          const exportRows = session.rows.map((row, idx) => {
            const review = session.reviews[String(idx)] || { status: '', note: '' };
            return [...row, review.status || '', review.note || ''];
          });

          const csv = buildCsv(exportHeaders, exportRows);
          const downloadName = `${path.parse(session.fileName).name || 'review'}-reviewed.csv`;

          res.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
          });
          return res.end(csv);
        }

        return sendJson(res, 404, { error: 'API 不存在' });
      }

      const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const safePath = path.normalize(requestedPath).replace(/^([.][.][/\\])+/, '');
      const filePath = path.join(PUBLIC_DIR, safePath);

      if (!filePath.startsWith(PUBLIC_DIR)) {
        return sendText(res, 403, 'Forbidden');
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return sendText(res, 404, 'Not Found');
      }

      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await fsp.readFile(filePath);
      return sendText(res, 200, content, mime);
    } catch (err) {
      console.error(err);
      return sendJson(res, 500, { error: '服务器内部错误', detail: err.message });
    }
  });
}

async function bootstrap() {
  await fsp.mkdir(SESSIONS_DIR, { recursive: true });
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Server started at http://localhost:${PORT}`);
  });
}

bootstrap();
