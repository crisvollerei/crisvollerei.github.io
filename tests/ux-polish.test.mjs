import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createApp } from '../assets/app.js';
import { foldICSLine, escapeICSText } from '../assets/share.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

function boot(t,{now = '2026-10-16T12:00:00',storage = {}} = {}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, NativeDate = w.Date, instant = new NativeDate(now).getTime();
  w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
  for (const [key,value] of Object.entries(storage)) w.localStorage.setItem(key,value);
  return {app:createApp(w),w,d:w.document};
}
const readBlob = (w,blob) => new Promise(resolve => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });

test('export page opens from quick tools and the footer, then returns focus',t => {
  const {app,d} = boot(t);
  d.getElementById('quickToolsToggle').click();
  const quick = d.querySelector('[data-quick-action="openExport"]'); quick.click();
  assert.equal(app.ui.activeDialog,'exportModal');
  assert.equal(d.getElementById('exportStart').value,'2026-10-16');
  assert.match(d.getElementById('exportSummary').textContent,/工作 \d+ 天 · 休息 \d+ 天/);
  app.share.closeExport();
  assert.equal(d.activeElement,d.getElementById('quickToolsToggle'));
  const footer = d.querySelector('.footer [data-action="openExport"]'); footer.focus(); footer.click();
  assert.equal(app.ui.activeDialog,'exportModal');
  d.querySelector('#exportModal .btn-group [data-action="closeExport"]').click();
  assert.equal(app.ui.activeDialog,null); assert.equal(d.activeElement,footer);
});

test('calendar export writes valid timed and all-day events without touching saved data',async t => {
  const {app,w,d} = boot(t);
  const before = {...w.localStorage}; let blob, name;
  w.URL.createObjectURL = value => { blob = value; return 'blob:calendar'; };
  w.HTMLAnchorElement.prototype.click = function() { name = this.download; };
  app.share.openExport();
  d.getElementById('exportDays').value = '30';
  d.getElementById('exportIncludeRest').checked = true;
  d.getElementById('exportAlarm').value = '30';
  app.share.downloadCalendar();
  const ics = await readBlob(w,blob);
  assert.match(name,/2026-10-16\.ics$/);
  assert.match(ics,/^BEGIN:VCALENDAR\r\n/); assert.match(ics,/END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length,30,'Every day is exported when rest days are included');
  assert.match(ics,/DTSTART;VALUE=DATE:/); assert.match(ics,/TRIGGER:-PT30M/);
  assert.equal(new Set(ics.match(/UID:[^\r]+/g)).size,30,'Each date has a stable unique identifier');
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75,line);
  assert.match(d.getElementById('exportStatus').textContent,/\.ics/);
  assert.deepEqual({...w.localStorage},before);
  w.URL.createObjectURL = () => { throw new Error('Unsupported'); };
  app.share.downloadCalendar(); assert.equal(d.getElementById('exportError').hidden,false);
});

test('overnight shifts end on the next day and text sharing lists every day',async t => {
  const {app,w,d} = boot(t,{now:'2026-04-19T10:00:00'});
  let copied;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text => { copied = text; }}});
  app.share.openExport(); d.getElementById('exportDays').value = '30';
  let blob; w.URL.createObjectURL = value => { blob = value; return 'blob:x'; };
  w.HTMLAnchorElement.prototype.click = () => {};
  app.share.downloadCalendar();
  const ics = (await readBlob(w,blob)).replace(/\r\n /g,'');
  assert.match(ics,/DTSTART:20260419T200000\r\nDTEND:20260420T080000\r\nSUMMARY:夜班/);
  await app.share.copyScheduleText();
  const lines = copied.split('\n');
  assert.equal(lines.length,31); assert.match(lines[0],/2026年4月19日 至 2026年5月18日/);
  assert.match(lines[1],/^04\/19 周日 {2}夜班 {2}20:00–次日 08:00$/);
  assert.match(d.getElementById('exportTextStatus').textContent,/已复制 30 天/);
  app.share.closeExport(); assert.equal(d.getElementById('exportTextOutput').value,'');
});

test('invalid export dates are reported on the field and calendar text is escaped and folded safely',t => {
  const {app,d} = boot(t);
  app.share.openExport(); d.getElementById('exportStart').value = '';
  app.share.downloadCalendar();
  assert.equal(d.getElementById('exportError').hidden,false);
  assert.equal(d.activeElement,d.getElementById('exportStart'));
  assert.equal(escapeICSText('a,b;c\\d\ne'),'a\\,b\\;c\\\\d\\ne');
  const folded = foldICSLine(`SUMMARY:${'排班'.repeat(40)}`);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(folded.replace(/\r\n /g,''),`SUMMARY:${'排班'.repeat(40)}`);
});

test('printing temporarily uses the light theme and restores the visitor theme',t => {
  const {w,d} = boot(t,{storage:{'qingzheng-theme':'dark','qingzheng-theme-mode':'manual'}});
  assert.equal(d.documentElement.dataset.theme,'dark');
  w.dispatchEvent(new w.Event('beforeprint')); assert.equal(d.documentElement.dataset.theme,'light');
  w.dispatchEvent(new w.Event('afterprint')); assert.equal(d.documentElement.dataset.theme,'dark');
});

test('"today is day N" fills the anchor date in the draft only',t => {
  const {app,w,d} = boot(t);
  const before = app.schedule.captureCurrentConfig();
  app.settings.openSettings();
  const position = d.getElementById('cycleTodayPosition');
  const expected = app.schedule.getCycleIndex(new w.Date()) + 1;
  assert.equal(position.value,String(expected));
  assert.equal(position.max,'8');
  assert.match(d.getElementById('cycleTodayShift').textContent,new RegExp(app.schedule.getShift(new w.Date())));
  position.focus(); position.value = '3'; position.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.getElementById('anchorDate').value,'2026-10-14');
  assert.match(d.querySelector('#cyclePreviewDays li').textContent,/10\/14/);
  position.value = '99'; position.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(d.getElementById('anchorDate').value,'2026-10-14','Out-of-range positions are ignored');
  position.blur(); assert.equal(position.value,'3');
  assert.deepEqual(app.schedule.captureCurrentConfig(),before,'Nothing changes before saving');
  app.settings.saveSettings();
  assert.equal(app.schedule.captureCurrentConfig().anchor,'2026-10-14');
  assert.equal(app.schedule.getCycleIndex(new w.Date()),2);
});

test('a collapsed companion stays collapsed after reload until it is reopened',t => {
  const first = boot(t);
  first.d.getElementById('companionToggle').click();
  assert.equal(first.w.localStorage.getItem('qingzheng-companion'),'collapsed');
  const second = boot(t,{storage:{'qingzheng-companion':'collapsed'}});
  assert.equal(second.d.getElementById('companionBubble').hidden,true);
  assert.equal(second.d.getElementById('companionToggle').getAttribute('aria-expanded'),'false');
  second.d.getElementById('companionCharacter').click();
  assert.equal(second.d.getElementById('companionBubble').hidden,false);
  assert.equal(second.w.localStorage.getItem('qingzheng-companion'),'open');
});

test('long notices stay visible longer than short ones',t => {
  const {app,w} = boot(t), delays = [];
  w.setTimeout = (callback,delay) => { delays.push(delay); return 1; };
  app.ui.toast('好'); app.ui.toast('已在本次打开中导入，但浏览器未能完整保存，请复制或下载备份另存，避免关闭页面后丢失');
  assert.equal(delays[0],3200); assert.ok(delays[1] > 3200 && delays[1] <= 7000);
});

// Phones: no file handling is needed to send, save or back up a schedule.
function fakeCanvas(w) {
  const calls = [];
  const context = new Proxy({},{get(target,key) {
    if (key === 'measureText') return text => ({width:[...String(text)].length * 20});
    if (key in target) return target[key];
    return (...args) => { calls.push([key,...args]); };
  },set(target,key,value) { target[key] = value; return true; }});
  w.HTMLCanvasElement.prototype.getContext = () => context;
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  return calls;
}
test('the share sheet sends schedule text when available and falls back to copying',async t => {
  const {app,w,d} = boot(t);
  assert.equal(d.getElementById('exportShareText').hidden,true,'Without Web Share only copying is offered');
  let shared, copied;
  Object.defineProperty(w.navigator,'share',{value:async data => { shared = data; },configurable:true});
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text => { copied = text; }},configurable:true});
  app.share.openExport();
  assert.equal(d.getElementById('exportShareText').hidden,false);
  assert.ok(d.getElementById('exportCopyText').classList.contains('button-secondary'));
  await app.share.shareScheduleText();
  assert.match(shared.text,/^清蒸排班 · 2026年10月16日 至 2027年1月13日\n10\/16 周五/);
  assert.equal(copied,undefined);
  Object.defineProperty(w.navigator,'share',{value:async () => { throw Object.assign(new Error('x'),{name:'AbortError'}); },configurable:true});
  await app.share.shareScheduleText(); assert.equal(copied,undefined,'Cancelling the share sheet does nothing');
  Object.defineProperty(w.navigator,'share',{value:async () => { throw new Error('Blocked'); },configurable:true});
  await app.share.shareScheduleText(); assert.equal(copied,shared.text,'A blocked share sheet copies the same text instead');
});
test('the month picture is generated locally and can be long-pressed, shared or downloaded',async t => {
  const {app,w,d} = boot(t,{now:'2026-11-10T12:00:00'});
  const calls = fakeCanvas(w);
  app.share.openExport();
  assert.equal(d.getElementById('exportImageButton').textContent,'生成 11 月排班图');
  app.share.createMonthImage();
  assert.equal(d.getElementById('exportImageBox').hidden,false);
  assert.match(d.getElementById('exportImage').src,/^data:image\/png;base64,/);
  assert.equal(d.getElementById('exportImage').alt,'2026年11月排班图');
  const texts = calls.filter(([name]) => name === 'fillText').map(([,text]) => text);
  assert.ok(texts.includes('2026 年 11 月'));
  assert.ok(texts.some(text => /^工作 \d+ 天 · 休息 \d+ 天/.test(text)));
  assert.ok(texts.includes('30'),'Every day of the month is drawn');
  assert.equal(d.getElementById('exportImageShare').hidden,true,'Image sharing is only offered when files can be shared');
  let link; w.HTMLAnchorElement.prototype.click = function() { link = this; };
  app.share.downloadMonthImage(); assert.match(link.download,/2026年11月排班\.png$/);
  d.getElementById('exportStart').value = '2026-12-01'; d.getElementById('exportStart').dispatchEvent(new w.Event('input'));
  assert.equal(d.getElementById('exportImageBox').hidden,true,'Changing the month discards the old picture');
  let sharedFiles;
  Object.defineProperty(w.navigator,'share',{value:async data => { sharedFiles = data.files; },configurable:true});
  Object.defineProperty(w.navigator,'canShare',{value:data => !!data.files,configurable:true});
  app.share.createMonthImage();
  assert.equal(d.getElementById('exportImageShare').hidden,false);
  await app.share.shareMonthImage();
  assert.equal(sharedFiles[0].type,'image/png'); assert.match(sharedFiles[0].name,/2026年12月排班\.png$/);
  w.HTMLCanvasElement.prototype.getContext = () => null;
  app.share.createMonthImage();
  assert.equal(d.getElementById('exportImageBox').hidden,true);
  assert.match(d.getElementById('exportError').textContent,/复制排班文字/);
});
test('backup text can go straight to notes through the share sheet without any file',async t => {
  const {app,w,d} = boot(t);
  app.dataTools.openDataTools(); assert.equal(d.getElementById('shareBackupButton').hidden,true);
  app.dataTools.closeDataTools();
  let shared;
  Object.defineProperty(w.navigator,'share',{value:async data => { shared = data; },configurable:true});
  const before = {...w.localStorage};
  app.dataTools.openDataTools(); assert.equal(d.getElementById('shareBackupButton').hidden,false);
  await app.dataTools.shareBackupText();
  assert.match(shared.text,/^QZB1\./);
  assert.match(d.getElementById('backupStatus').textContent,/完整保存/);
  assert.deepEqual({...w.localStorage},before);
});
test('downloads and printing are marked as computer-only actions',() => {
  const css = fs.readFileSync(new URL('../assets/experience.css',import.meta.url),'utf8');
  assert.match(css,/@media \(hover: none\) and \(pointer: coarse\) \{\s*\.desktop-only \{ display: none !important; \}/);
  assert.match(html,/class="data-section desktop-only"[^>]*aria-labelledby="exportPrintTitle"/);
  assert.match(html,/class="button button-secondary desktop-only"[^>]*data-action="downloadMonthImage"/);
});
