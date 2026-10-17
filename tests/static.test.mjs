import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
test('HTML uses external scripts and event listeners compatible with a strict CSP',() => {
  assert.doesNotMatch(html,/\son\w+\s*=/i);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(script[1],/src=/);assert.equal(script[2].trim(),'');
  }
  assert.match(html,/<script type="module" src="assets\/main\.js/);
  assert.match(html,/http-equiv="Content-Security-Policy"/);
  const headers=fs.readFileSync(path.join(root,'_headers'),'utf8');
  assert.match(headers,/script-src 'self'/);assert.doesNotMatch(headers,/unsafe-inline|unsafe-eval/);
  assert.match(headers,/frame-ancestors 'none'/);
});
test('all directly referenced assets exist and have content-derived cache versions',() => {
  for (const [,url] of html.matchAll(/(?:src|href|data-src)="(assets\/[^\"]+)"/g)) {
    assert.match(url,/\?v=[a-f0-9]{12}$/);
    assert.ok(fs.existsSync(path.join(root,url.split('?')[0])),url);
  }
});
test('small optimized images replace large originals while source artwork is preserved',() => {
  for (const [output,limit,original] of [['assets/avatar.webp',6000,'avatar.png'],['assets/chibi-day.webp',45000,'assets/chibi-day.png'],['assets/chibi-night.webp',25000,'assets/chibi-night.png']]) {
    assert.ok(fs.statSync(path.join(root,output)).size<limit,output);
    assert.ok(fs.existsSync(path.join(root,original)),original);
    assert.equal(html.includes(`src="${original}"`),false);
  }
  for (const tag of html.matchAll(/<img[^>]+data-image-theme[^>]*>/g)) assert.doesNotMatch(tag[0],/\ssrc=/);
});
