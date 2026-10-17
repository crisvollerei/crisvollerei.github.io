import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4175);
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml' };
const headers = Object.fromEntries((await fs.readFile(path.join(root,'_headers'),'utf8')).split('\n')
  .filter(line => /^\s+[^:]+:/.test(line)).map(line => {
    const colon = line.indexOf(':'); return [line.slice(0,colon).trim(),line.slice(colon+1).trim()];
  }));
http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!(relative === 'index.html' || relative === 'avatar.png' || /^assets\/[\w.-]+$/.test(relative))) { res.writeHead(404);res.end('Not found');return; }
    const file = await fs.readFile(path.join(root,relative));
    res.writeHead(200,{...headers,'Content-Type':mime[path.extname(relative)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(file);
  } catch (_) { res.writeHead(404);res.end('Not found'); }
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
