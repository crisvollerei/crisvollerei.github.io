import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { buildOffline } from '../scripts/build-offline.mjs';

const html = buildOffline();
test('standalone HTML embeds every startup resource without external module requests',() => {
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc=/);
  assert.doesNotMatch(html,/<link rel="stylesheet"/);
  assert.doesNotMatch(html,/(?:src|data-src|href)="assets\//);
  assert.match(html,/<style>[\s\S]+<\/style>/);
  assert.match(html,/data:image\/webp;base64,/);
  assert.match(html,/<a class="brand" href="#calendarSection"/);
  assert.doesNotMatch(html,/<script type="(?:module|importmap)"/);
  const bundled = [...html.matchAll(/__modules\["qingzheng\/([\w.-]+)"\] = \(\(\) =>/g)].map(match => match[1]).sort();
  const modules = fs.readdirSync(new URL('../assets/',import.meta.url)).filter(name => name.endsWith('.js') && name !== 'theme-init.js').sort();
  assert.deepEqual(bundled,modules);
  const bundle=html.match(/<script>\(\(\) => \{\n'use strict';([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(bundle,/^\s*(?:import|export)\b/m);
  assert.ok(html.indexOf(bundle)>html.indexOf('id="daysGrid"'));
});
test('standalone CSP permits only its exact inline scripts and stylesheet, without unsafe exceptions',() => {
  const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.doesNotMatch(policy,/unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(policy,/script-src[^;]*data:/);
  assert.match(policy,/connect-src 'none'/);
  for (const [,source] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const hash=createHash('sha256').update(source).digest('base64');
    assert.ok(policy.includes(`'sha256-${hash}'`));
  }
  const style=html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`));
});
