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
  d.querySelector('.locator-direct').open = true;
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
  const calls = fakeCanvas(w), $ = id => d.getElementById(id);
  w.HTMLImageElement.prototype.decode = async () => {};
  const generate = async () => { $('createSheetImage').click(); await Promise.resolve(); };
  app.share.openExport();
  assert.equal($('exportImageButton').textContent,'预览 11 月排班图');
  $('exportImageButton').click(); await generate();
  assert.equal(app.ui.activeDialog,'monthImageModal');
  assert.match($('exportImage').src,/^data:image\/png;base64,/);
  assert.equal($('exportImage').alt,'2026 年 11 月排班表（经典卡片）');
  const texts = calls.filter(([name]) => name === 'fillText').map(([,text]) => text);
  assert.ok(texts.includes('2026 年 11 月'));
  assert.ok(texts.some(text => /^工作 \d+ 天 · 休息 \d+ 天/.test(text)));
  assert.ok(texts.includes('30'),'Every day of the month is drawn');
  assert.equal(d.getElementById('exportImageShare').hidden,true,'Image sharing is only offered when files can be shared');
  let link; w.HTMLAnchorElement.prototype.click = function() { link = this; };
  $('downloadMonthImage').click(); assert.match(link.download,/2026年11月排班-经典卡片\.png$/);
  $('backToSheet').click(); $('closeMonthSheet').click();
  assert.equal(d.activeElement,$('exportImageButton'));
  $('exportStart').value = '2026-12-01'; $('exportStart').dispatchEvent(new w.Event('input'));
  assert.equal($('exportImage').hasAttribute('src'),false,'The previous picture is discarded');
  let sharedFiles;
  Object.defineProperty(w.navigator,'share',{value:async data => { sharedFiles = data.files; },configurable:true});
  Object.defineProperty(w.navigator,'canShare',{value:data => !!data.files,configurable:true});
  $('exportImageButton').click(); await generate();
  assert.equal(d.getElementById('exportImageShare').hidden,false);
  $('exportImageShare').click(); await Promise.resolve();
  assert.equal(sharedFiles[0].type,'image/png'); assert.match(sharedFiles[0].name,/2026年12月排班-经典卡片\.png$/);
  $('backToSheet').click();
  w.HTMLCanvasElement.prototype.getContext = () => null;
  await generate();
  assert.equal(app.ui.activeDialog,'monthSheetModal');
  assert.match($('monthPrintStatus').textContent,/复制整月排班/);
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
test('touch devices get native long-press saving; file downloads and print remain usable fallbacks',async t => {
  const {w,d} = boot(t), $ = id => d.getElementById(id);
  fakeCanvas(w); w.matchMedia = () => ({matches:true});
  w.HTMLImageElement.prototype.decode = async () => {};
  $('openMonthSheet').click(); assert.equal($('printMonthSheet').hidden,false);
  $('createSheetImage').click(); await Promise.resolve();
  assert.match($('exportImageHint').textContent,/长按/); assert.equal($('downloadMonthImage').hidden,false);
  const css = fs.readFileSync(new URL('../assets/month-sheet.css',import.meta.url),'utf8');
  assert.match(css,/\.sheet-image-scroll img[^}]+-webkit-touch-callout: default/);
});

test('paper selection remembers its own preference without changing the days, copy or theme',async t => {
  const key = 'qingzheng-month-sheet-style', {app,w,d} = boot(t,{storage:{[key]:'unknown','qingzheng-theme':'dark'}});
  const $ = id => d.getElementById(id), rows = $('monthSheetRows'); let text;
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value => { text = value; }}});
  app.views.navigateMonth(2026,2); $('openMonthSheet').click();
  const buttons = [...$('monthSheetStyles').querySelectorAll('[role="radio"]')], paper = $('monthSheetPaper');
  assert.deepEqual(buttons.map(b => b.dataset.paper),['classic','coast','bloom','orbit','plain']);
  assert.equal(paper.dataset.paper,'classic'); assert.equal(w.localStorage.getItem(key),'unknown');
  const original = {...w.localStorage}, markup = rows.innerHTML;
  $('copyMonthAgenda').click(); await Promise.resolve(); const expected = text;
  for (const [from,keyName,to] of [[0,'ArrowRight',1],[1,'ArrowDown',2],[2,'ArrowRight',3],[3,'End',4],[4,'ArrowRight',0],[0,'ArrowLeft',4],[4,'Home',0],[0,'End',4]]) {
    buttons[from].dispatchEvent(new w.KeyboardEvent('keydown',{key:keyName,bubbles:true,cancelable:true}));
    assert.equal(d.activeElement,buttons[to]); assert.equal(paper.dataset.paper,buttons[to].dataset.paper);
    assert.deepEqual(buttons.map(b => b.tabIndex),buttons.map((_,i) => i === to ? 0 : -1));
    assert.equal($('monthSheetStyles').querySelectorAll('[aria-checked="true"]').length,1);
    assert.equal(rows.innerHTML,markup); assert.equal(app.views.viewMonth,2);
    $('copyMonthAgenda').click(); await Promise.resolve(); assert.equal(text,expected);
  }
  assert.deepEqual({...w.localStorage},{...original,[key]:'plain'});
  const next = boot(t,{storage:{...w.localStorage}});
  assert.equal(next.d.getElementById('monthSheetPaper').dataset.paper,'plain');
  next.w.dispatchEvent(new next.w.Event('beforeprint'));
  assert.equal(next.d.getElementById('monthSheetRows').querySelectorAll('time').length,31);
});

test('a range month is scoped to its preview; nested copy, print and return preserve the parent form',async t => {
  const {app,w,d} = boot(t), $ = id => d.getElementById(id);
  app.views.navigateMonth(2026,2); app.share.openExport();
  $('exportStart').value = '2028-02-29'; $('exportDays').value = '60'; $('exportAlarm').value = '15'; $('exportIncludeRest').checked = true;
  $('exportStart').dispatchEvent(new w.Event('input')); $('exportImageButton').click();
  assert.equal($('monthSheetTitle').textContent,'2028 年 2 月排班表'); assert.equal($('monthSheetRows').querySelectorAll('time').length,29);
  assert.equal($('monthSheetModal').classList.contains('input-view'),false);
  $('copyMonthAgenda').click(); await Promise.resolve();
  const copied = $('agendaCopyText').value.split('\n'); assert.match(copied[0],/^2028-02-01/); assert.match(copied.at(-1),/^2028-02-29/);
  $('agendaCopyClose').click();
  w.dispatchEvent(new w.Event('beforeprint')); assert.equal(d.title,'2028 年 2 月排班表'); w.dispatchEvent(new w.Event('afterprint'));
  $('closeMonthSheet').click(); assert.equal(app.ui.activeDialog,'exportModal'); assert.equal(d.activeElement,$('exportImageButton'));
  assert.deepEqual([$('exportStart').value,$('exportDays').value,$('exportAlarm').value,$('exportIncludeRest').checked],['2028-02-29','60','15',true]);
  w.dispatchEvent(new w.Event('beforeprint')); assert.equal(d.title,'2026 年 3 月排班表'); w.dispatchEvent(new w.Event('afterprint'));
  app.share.closeExport(); $('openMonthSheet').click(); assert.equal($('monthSheetTitle').textContent,'2026 年 3 月排班表');
});

test('late artwork is discarded and a personal image signature is opt-in and never printed',async t => {
  const title = '仅用于图片的私人署名';
  const {d,w,app} = boot(t,{storage:{'qingzheng-month-sheet-style':'coast','qingzheng-personalization':JSON.stringify({version:1,title,avatar:null})}});
  const $ = id => d.getElementById(id), calls = fakeCanvas(w), art = d.querySelector('img[data-art="coast"]');
  let resolve; art.decode = () => new Promise(done => { resolve = done; });
  $('openMonthSheet').click(); $('createSheetImage').click(); $('closeMonthSheet').click(); $('openMonthSheet').click();
  resolve(); await Promise.resolve(); assert.equal(app.ui.activeDialog,'monthSheetModal'); assert.deepEqual(calls,[]);
  $('createSheetImage').click(); d.querySelector('button[data-paper="classic"]').click(); resolve(); await Promise.resolve();
  assert.equal(app.ui.activeDialog,'monthSheetModal'); assert.equal($('createSheetImage').hasAttribute('aria-busy'),false);
  $('createSheetImage').click(); assert.ok(!calls.some(([op,t]) => op === 'fillText' && t === title));
  $('backToSheet').click(); $('sheetImageSignature').click(); $('createSheetImage').click();
  assert.ok(calls.some(([op,t]) => op === 'fillText' && t === title));
  w.dispatchEvent(new w.Event('beforeprint')); assert.ok(!d.title.includes(title)); assert.ok(!$('monthSheetPaper').textContent.includes(title));
  w.dispatchEvent(new w.Event('afterprint')); assert.equal(d.title,title);
  $('backToSheet').click(); $('closeMonthSheet').click(); $('openMonthSheet').click(); assert.equal($('sheetImageSignature').getAttribute('aria-checked'),'false');
});

test('PNG draws the complete legend, including colliding short codes, duplicate colors and overnight hours',t => {
  const names = ['S01','夜间联合值守甲','夜间联合值守乙',...Array.from({length:9},(_,i)=>`轮值岗${i}`)];
  const config = {anchor:'2026-03-01',cycle:names,shiftDefs:Object.fromEntries(names.map(name=>[name,{isWork:true,startTime:'21:00',endTime:'05:15',cssClass:'night'}]))};
  const {app,w,d} = boot(t,{storage:{'qingzheng-config':JSON.stringify(config)}}), calls = fakeCanvas(w);
  app.views.navigateMonth(2026,2); d.getElementById('openMonthSheet').click();
  d.querySelector('button[data-paper="plain"]').click(); d.getElementById('createSheetImage').click();
  const texts = calls.filter(([op]) => op === 'fillText').map(([,text]) => text);
  for (const name of names) assert.ok(texts.some(t => t.endsWith(name)),name);
  assert.ok(texts.includes('S02') && texts.includes('S03')); assert.equal(texts.filter(t=>t === '21:00 — 次日 05:15').length,names.length);
  assert.ok(texts.includes('跨日') && texts.includes('31')); assert.equal(app.ui.activeDialog,'monthImageModal');
});

test('classic cards leave out-of-month slots blank and use the same today, notes and summary as the paper',t => {
  const {w,d} = boot(t,{now:'2026-11-26T10:00:00'}), calls = fakeCanvas(w), $ = id => d.getElementById(id);
  $('openMonthSheet').click();
  const rows = $('monthSheetRows'), paper = $('monthSheetPaper'), legend = $('monthSheetLegend');
  assert.equal(paper.dataset.paper,'classic'); assert.equal(legend.nextElementSibling,rows.closest('table'));
  assert.equal(rows.querySelectorAll('td:empty').length,12); assert.equal(rows.querySelectorAll('td[data-tone]').length,30);
  assert.equal(rows.querySelector('td[data-today] time[aria-current="date"]').dateTime,'2026-11-26');
  assert.equal(rows.querySelector('time[datetime="2026-11-07"]').parentNode.querySelector('.sheet-note').textContent,'立冬');
  assert.deepEqual([...legend.querySelectorAll('strong')].map(el=>el.textContent),['白班','夜班','休息']);
  assert.equal($('sheetWorkRest').textContent,'工作 14 天 · 休息 16 天 · 计划工时 168 小时');
  $('createSheetImage').click();
  const texts = calls.filter(([op])=>op === 'fillText').map(([,label])=>label);
  for (const value of ['立冬','跨日',$('sheetWorkRest').textContent,$('sheetFooter').textContent]) assert.ok(texts.includes(value),value);
  assert.equal(calls.filter(([op])=>op === 'fill').length,30+legend.children.length,'Only real dates and legend keys receive a fill');
  assert.equal(calls.filter(([op])=>op === 'stroke').length,1,'Only today has a border');
  assert.ok(!calls.some(([op])=>op === 'drawImage'),'Classic needs no illustration');
});

test('card legend flows above the weekdays without clipping a long name, losing a range, or colliding with a real code',t => {
  const long = '夜'.repeat(40), names = ['S01',long,'夜间联合值守乙',...Array.from({length:9},(_,i)=>`轮值岗${i}`)];
  const config = {anchor:'2026-03-01',cycle:names,shiftDefs:Object.fromEntries(names.map(name=>[name,{isWork:true,startTime:'22:00',endTime:'05:00',cssClass:'night'}]))};
  const {app,w,d} = boot(t,{now:'2026-11-26T12:00:00',storage:{'qingzheng-config':JSON.stringify(config)}}), calls = fakeCanvas(w);
  app.views.navigateMonth(2026,2); d.getElementById('openMonthSheet').click(); d.getElementById('createSheetImage').click();
  const drawn = calls.filter(([op])=>op === 'fillText'), weekdayY = drawn.find(([,label])=>label === '周一')[3];
  const legend = drawn.filter(([,label,,y])=> y > drawn.find(([,t])=>t.startsWith('工作 '))[3] && y < weekdayY);
  const lines = legend.map(([,label])=>label).join('\n');
  for (const name of names) assert.ok(lines.includes(name),name);
  assert.ok(lines.includes(`S02 ${long}`) && lines.includes('S03 夜间联合值守乙'));
  assert.equal(lines.split('22:00–次日05:00').length-1,names.length);
  assert.ok(new Set(legend.map(([, , ,y])=>y)).size>1,'Extra rows are measured, not dropped');
  assert.ok(legend.every(([,label,x])=>x + [...label].length * 20 <= 1080-48));
  assert.equal(calls.some(([op])=>op === 'stroke'),false,'No today border in a different month');
});

test('month text sharing cancels silently and falls back to selectable text on permission failure',async t => {
  const {app,w,d} = boot(t), $ = id => d.getElementById(id); let text;
  Object.defineProperty(w.navigator,'share',{configurable:true,value:async data => { text = data.text; throw Object.assign(Error(),{name:'AbortError'}); }});
  app.views.navigateMonth(2026,3); $('openMonthSheet').click(); assert.equal($('shareMonthAgenda').hidden,false);
  $('shareMonthAgenda').click(); await Promise.resolve(); assert.equal(text.split('\n').length,30); assert.equal(app.ui.activeDialog,'monthSheetModal');
  Object.defineProperty(w.navigator,'share',{value:async () => { throw Error('Permission refused'); }});
  $('shareMonthAgenda').click(); await Promise.resolve(); assert.equal(app.ui.activeDialog,'agendaCopyModal');
  assert.equal($('agendaCopyText').value,text); $('agendaCopyClose').click(); assert.equal(d.activeElement,$('shareMonthAgenda'));
});
