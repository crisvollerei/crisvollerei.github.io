import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createApp} from '../assets/app.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) { ({JSDOM} = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function boot(t) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, NativeDate = w.Date;
  w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-11-06T12:00:00'])); } static now() { return new NativeDate('2026-11-06T12:00:00').getTime(); } };
  return {app:createApp(w),w,d:w.document};
}
function escape(w,target) { target.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); }

test('quick tools open both existing dialogs and return keyboard focus to the visible toggle',t => {
  const {app,d} = boot(t), toggle = d.getElementById('quickToolsToggle');
  for (const [action,dialog,close] of [
    ['openPersonalization','personalizationModal',app.personalization.closePersonalization],
    ['openDataTools','dataModal',app.dataTools.closeDataTools]
  ]) {
    toggle.click(); const button = d.querySelector(`[data-quick-action="${action}"]`); button.focus(); button.click();
    assert.equal(app.ui.activeDialog,dialog); assert.equal(d.getElementById('quickToolsPanel').hidden,true);
    assert.equal(app.liveTimer,null); close(); assert.equal(d.activeElement,toggle);
  }
  assert.equal(d.querySelectorAll('[data-action="openDataTools"]').length,1,'The original footer entry remains usable');
});
test('Escape dismisses quick tools before touching an inspected date',t => {
  const {app,d,w} = boot(t);
  d.querySelector('#daysGrid [data-date="2026-11-06"]').click();
  const toggle = d.getElementById('quickToolsToggle'); toggle.click();
  const shortcut = d.querySelector('[data-quick-action]'); shortcut.focus(); escape(w,shortcut);
  assert.equal(d.getElementById('quickToolsPanel').hidden,true); assert.equal(d.activeElement,toggle);
  assert.equal(d.getElementById('detailPanel').classList.contains('show'),true);
  escape(w,toggle); assert.equal(d.getElementById('detailPanel').classList.contains('show'),false);
  assert.notEqual(app.liveTimer,null);
});
test('date navigation previews agree with the actual destination and respect year boundaries',t => {
  const {app,d} = boot(t);
  d.querySelector('#daysGrid [data-date="2026-11-06"]').click();
  assert.equal(d.getElementById('detailRelative').textContent,'今天的安排');
  assert.match(d.getElementById('detailNextPreview').textContent,/11\/7/);
  const expected = app.schedule.getShift(new Date(2026,10,7));
  assert.ok(d.getElementById('detailNextPreview').textContent.endsWith(expected));
  d.getElementById('detailNext').click(); assert.equal(d.getElementById('detailRelative').textContent,'明天的安排');
  app.views.navigateMonth(2025,0); d.querySelector('#daysGrid [data-date="2025-01-01"]').click();
  assert.equal(d.getElementById('detailPrev').disabled,true);
  assert.equal(d.getElementById('detailPrevPreview').textContent,'已到最早日期');
  assert.match(d.getElementById('detailRelative').textContent,/天前的安排$/);
});
test('settings validation focuses and describes the exact invalid field without applying the draft',t => {
  const {app,d,w} = boot(t), before = app.schedule.captureCurrentConfig();
  app.settings.openSettings();
  for (const [field,value] of [[d.getElementById('anchorDate'),''],[d.getElementById('cyclePattern'),''],[d.querySelector('[data-shift="白班"] [data-field="endTime"]'),'']]) {
    const original = field.value; field.value = value; app.settings.saveSettings();
    assert.equal(d.activeElement,field); assert.equal(field.getAttribute('aria-invalid'),'true');
    assert.ok(field.getAttribute('aria-describedby').includes('settingsFieldError'));
    assert.ok(d.getElementById('settingsFieldError').textContent);
    assert.deepEqual(app.schedule.captureCurrentConfig(),before); assert.equal(app.liveTimer,null);
    field.value = original; field.dispatchEvent(new w.Event('input',{bubbles:true}));
    assert.equal(field.hasAttribute('aria-invalid'),false); assert.equal(d.getElementById('settingsFieldError'),null);
  }
});
