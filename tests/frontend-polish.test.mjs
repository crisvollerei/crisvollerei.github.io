import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createApp} from '../assets/app.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) { ({JSDOM} = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function boot(t,{now='2026-11-06T12:00:00',config} = {}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, NativeDate = w.Date;
  w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new NativeDate(now).getTime(); } };
  if (config) w.localStorage.setItem('qingzheng-config',JSON.stringify(config));
  return {app:createApp(w),w,d:w.document};
}
function escape(w,target) { target.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); }

test('legend matches shift names rather than colors without hiding dates or changing totals or storage',t => {
  const names = ['甲班','乙"班'], config = {anchor:'2026-11-01',cycle:names,shiftDefs:{}};
  const {d,w} = boot(t,{config}), grid = d.getElementById('daysGrid');
  const all = d.querySelector('#legendContainer button:not([data-calendar-shift])');
  const filter = [...d.querySelectorAll('#legendContainer [data-calendar-shift]')].find(el => el.dataset.calendarShift === names[1]);
  const totals = d.getElementById('workBalance').getAttribute('aria-label');
  const cells = [...grid.querySelectorAll('button')];
  assert.equal(all.getAttribute('aria-pressed'),'true');
  filter.click();
  assert.equal(filter.getAttribute('aria-pressed'),'true');
  assert.equal(d.getElementById('shiftFocusStatus').textContent,'11月有 15 天「乙"班」');
  assert.equal(grid.querySelectorAll('.shift-match').length,15);
  for (const cell of cells) {
    assert.ok(cell.isConnected && !cell.hidden && !cell.disabled);
    assert.equal(cell.classList.contains('shift-match'),cell.dataset.calendarShift === names[1]);
  }
  cells[0].click(); assert.equal(cells[0].getAttribute('aria-pressed'),'true');
  assert.equal(cells[0].classList.contains('shift-match'),false);
  assert.equal(d.getElementById('workBalance').getAttribute('aria-label'),totals);
  filter.click(); assert.equal(all.getAttribute('aria-pressed'),'true');
  filter.click(); all.click(); assert.equal(grid.querySelectorAll('.shift-match').length,0);
  assert.equal(w.localStorage.getItem('qingzheng-config'),JSON.stringify(config));
});

test('highlight survives month navigation, reports zero matches, and clears when the shift no longer exists',t => {
  const {app,d,w} = boot(t,{config:{anchor:'2026-11-01',cycle:['值班',...Array(60).fill('休息')],shiftDefs:{}}});
  const filter = d.querySelector('#legendContainer [data-calendar-shift="值班"]');
  filter.focus(); filter.click();
  assert.equal(d.querySelectorAll('.day-cell.shift-match').length,1);
  filter.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(d.getElementById('shiftFocusStatus').textContent,'12月没有「值班」');
  assert.equal(d.activeElement,filter); assert.equal(filter.getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('#daysGrid button').length,31);
  app.schedule.commitConfig({anchor:'2026-12-01',cycle:['休息'],shiftDefs:{}},{persist:false}); app.views.render();
  assert.equal(d.querySelector('#legendContainer [data-calendar-shift="值班"]'),null);
  assert.equal(d.querySelector('#legendContainer button').getAttribute('aria-pressed'),'true');
  assert.equal(d.getElementById('shiftFocusStatus').textContent,'');
});

test('month shortcuts keep the focused day or the end of a shorter month; Today and Escape round-trip',t => {
  const {app,w,d} = boot(t); const key = key => d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  app.views.navigateMonth(2027,0); d.querySelector('#daysGrid [data-date="2027-01-31"]').focus();
  key('ArrowRight'); assert.equal(d.activeElement.dataset.date,'2027-02-28');
  assert.equal(d.querySelector('#daysGrid .selected'),null);
  key('ArrowLeft'); assert.equal(d.activeElement.dataset.date,'2027-01-28');
  key('t'); assert.equal(d.activeElement.id,'detailHeading');
  key('Escape'); assert.equal(d.activeElement.dataset.date,'2026-11-06');
  const today = d.getElementById('backToToday'); today.focus(); today.click();
  key('Escape'); assert.equal(d.activeElement,today);
});

const overnight = {anchor:'2026-12-30',cycle:['夜值','歇班','长班'],shiftDefs:{
  夜值:{isWork:true,startTime:'21:30',endTime:'06:15'},歇班:{isWork:false},
  长班:{isWork:true,startTime:'09:00',endTime:'17:00',crossDay:true}
}};
const yearEnd = {now:'2026-12-31T02:00:00',config:overnight};
test('weekly rows display times without hover, keep holidays and navigate across years',t => {
  const {d} = boot(t,yearEnd), rows = [...d.querySelectorAll('#upcomingList button')];
  assert.match(d.getElementById('todayShift').textContent,/夜值/);
  assert.equal(rows[0].querySelector('.upcoming-time').textContent,'当日无新班次');
  assert.equal(rows[1].querySelector('.upcoming-time').textContent,'09:00 — 次日 17:00');
  assert.match(rows[1].getAttribute('aria-label'),/次日 17:00/);
  assert.match(rows[1].querySelector('.upcoming-festival').textContent,/元旦/);
  assert.equal(rows[2].querySelector('.upcoming-time').textContent,'21:30 — 次日 06:15');
  rows[1].click(); assert.equal(d.querySelector('#daysGrid .selected').dataset.date,'2027-01-01');
  d.querySelector('.detail-back').click(); assert.equal(d.activeElement.dataset.date,'2027-01-01');
});

test('copied notes use the selected day or seven actual calendar days, not the browsed month or active filter',async t => {
  const {app,d,w} = boot(t,yearEnd); const writes = [];
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async text => { writes.push(text); }}});
  app.views.navigateMonth(2026,4); d.querySelector('#legendContainer [data-calendar-shift="夜值"]').click();
  d.getElementById('copyWeekAgenda').click(); await Promise.resolve();
  const lines = writes[0].split('\n'); assert.equal(lines.length,7);
  assert.deepEqual(lines.slice(0,3),['2026-12-31 周四 · 歇班 · 当日无新班次','2027-01-01 周五 · 长班 · 09:00 — 次日 17:00','2027-01-02 周六 · 夜值 · 21:30 — 次日 06:15']);
  assert.equal(lines[6],'2027-01-06 周三 · 歇班 · 当日无新班次');
  assert.equal(d.getElementById('toast').textContent,'已复制七天排班');
  d.querySelector('#upcomingList [data-date="2027-01-01"]').click(); d.getElementById('detailNext').click();
  d.getElementById('copyDayAgenda').click(); await Promise.resolve();
  assert.equal(writes[1],lines[2]); assert.equal(app.ui.activeDialog,null);
  assert.equal(w.localStorage.getItem('qingzheng-config'),JSON.stringify(overnight));
});

test('denied or unavailable clipboard leaves fully selectable text and restores the copy button on close',async t => {
  for (const denied of [false,true]) {
    const {app,d,w} = boot(t,yearEnd);
    if (denied) Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async () => { throw Error('denied'); }}});
    const button = d.getElementById('copyWeekAgenda'); button.click(); await Promise.resolve();
    const text = d.getElementById('agendaCopyText');
    assert.equal(app.ui.activeDialog,'agendaCopyModal'); assert.equal(app.liveTimer,null);
    assert.equal(d.activeElement,text); assert.equal(text.readOnly,true);
    assert.equal(text.value.split('\n').length,7); assert.equal(text.selectionStart,0); assert.equal(text.selectionEnd,text.value.length);
    text.setSelectionRange(0,0); d.getElementById('agendaCopySelect').click(); assert.equal(text.selectionEnd,text.value.length);
    if (denied) escape(w,text); else d.getElementById('agendaCopyClose').click();
    assert.equal(d.activeElement,button); assert.equal(text.value,''); assert.notEqual(app.liveTimer,null);
  }
});

test('a late clipboard denial cannot open a fallback over another day or a newer copy',async t => {
  const {app,d,w} = boot(t,yearEnd), pending = [];
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:() => new Promise((resolve,reject) => pending.push({resolve,reject}))}});
  d.querySelector('#upcomingList button').click(); const button = d.getElementById('copyDayAgenda');
  button.click(); app.views.moveDetail(1); pending[0].reject(); await Promise.resolve();
  assert.equal(app.ui.activeDialog,null);
  button.click(); button.click(); pending[2].resolve(); await Promise.resolve();
  pending[1].reject(); await Promise.resolve(); assert.equal(app.ui.activeDialog,null);
  assert.equal(d.getElementById('toast').textContent,'已复制当天排班');
});

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

function pick(w,field,value,event = 'change') {
  field.value = String(value); field.dispatchEvent(new w.Event(event,{bubbles:true}));
}

test('cycle locator distinguishes repeated shifts and only persists the selected position on Save',t => {
  const config = {anchor:'2026-12-31',cycle:['夜值','休息','夜值','白班'],shiftDefs:{夜值:{isWork:true,startTime:'21:30',endTime:'06:15'}}};
  const {app,w,d} = boot(t,{config,now:'2027-01-01T02:00:00'}), $ = id => d.getElementById(id);
  assert.match($('todayShift').textContent,/夜值/,'Yesterday’s night shift is still running');
  app.settings.openSettings();
  const day = $('cycleLocatorDay'), strip = $('cycleLocatorPreview');
  assert.equal(day.selectedOptions[0].text,'第 2 天 · 休息');
  assert.deepEqual([...strip.querySelectorAll('time')].map(el => el.dateTime),['2026-12-31','2027-01-01','2027-01-02']);
  assert.deepEqual([...day.options].filter(o => o.text.endsWith('夜值')).map(o => o.text),['第 1 天 · 夜值','第 3 天 · 夜值']);
  const live = app.schedule.captureCurrentConfig(), stored = w.localStorage.getItem('qingzheng-config');
  pick(w,day,2);
  assert.equal($('anchorDate').value,'2026-12-30');
  assert.deepEqual([...strip.querySelectorAll('strong')].map(el => el.textContent),['休息','夜值','白班']);
  assert.deepEqual(app.schedule.captureCurrentConfig(),live);
  escape(w,day); assert.equal(w.localStorage.getItem('qingzheng-config'),stored);
  app.settings.openSettings(); assert.equal(day.value,'1');
  pick(w,day,2); d.querySelector('[data-action="saveSettings"]').click();
  assert.equal(app.ui.activeDialog,null);
  assert.equal(app.schedule.captureCurrentConfig().anchor,'2026-12-30');
  assert.equal(JSON.parse(w.localStorage.getItem('qingzheng-config')).anchor,'2026-12-30');
  assert.deepEqual(app.schedule.captureCurrentConfig().cycle,config.cycle);
});

test('long cycles page through every position without changing the draft just by browsing ranges',t => {
  const config = {anchor:'2028-03-01',cycle:Array(65).fill('同班'),shiftDefs:{}};
  const {app,w,d} = boot(t,{config,now:'2028-03-01T00:15:00'}), $ = id => d.getElementById(id);
  app.settings.openSettings(); const range = $('cycleLocatorRange'), day = $('cycleLocatorDay');
  assert.equal($('cycleLocatorRangeField').hidden,false); assert.equal(range.options.length,3);
  pick(w,range,1); assert.equal(day.value,''); assert.equal(day.options.length,33);
  assert.equal($('anchorDate').value,config.anchor);
  pick(w,day,32); assert.equal($('anchorDate').value,'2028-01-29');
  pick(w,range,2); assert.equal(day.options.length,2); pick(w,day,64);
  assert.equal($('anchorDate').value,'2027-12-28');
  assert.equal($('cycleLocatorPreview').lastElementChild.querySelector('small').textContent,'周期第 1 天');
  pick(w,$('anchorDate'),'2028-02-29','input');
  assert.equal(range.value,'0'); assert.equal(day.value,'1');
  assert.equal(app.schedule.captureCurrentConfig().anchor,config.anchor);
});

test('invalid or empty cycles disable calibration, but an empty anchor can be repaired',t => {
  const {app,w,d} = boot(t,{now:'2028-03-01T12:00:00'}), $ = id => d.getElementById(id);
  app.settings.openSettings(); const day = $('cycleLocatorDay'), anchor = $('anchorDate');
  for (const pattern of ['', '班'.repeat(41),Array(3661).fill('班').join(' ')]) {
    pick(w,$('cyclePattern'),pattern,'input');
    assert.equal(day.disabled,true); assert.equal($('cycleLocatorPreview').hidden,true);
    assert.equal($('cycleLocatorRangeField').hidden,true);
  }
  pick(w,anchor,'','input'); pick(w,$('cyclePattern'),'白班 休息','input');
  assert.equal(day.disabled,false); assert.equal(day.value,''); assert.equal($('cycleLocatorPreview').hidden,true);
  pick(w,day,1); assert.equal(anchor.value,'2028-02-29');
  assert.equal($('cycleLocatorPreview').hidden,false);
  pick(w,day,0); assert.equal(anchor.value,'2028-03-01');
});

test('calibration rejects an anchor outside the supported calendar without changing the current position',t => {
  const config = {anchor:'1900-01-01',cycle:['甲','乙'],shiftDefs:{}};
  const {app,w,d} = boot(t,{config,now:'1900-01-01T00:20:00'});
  app.settings.openSettings(); const day = d.getElementById('cycleLocatorDay');
  pick(w,day,1); assert.equal(day.value,'0');
  assert.equal(d.getElementById('anchorDate').value,'1900-01-01');
  assert.match(d.getElementById('cycleLocatorStatus').textContent,/1900.*2100/);
});

test('leap-month sheet and copy use the viewed month, not today, selected date or shift highlight',async t => {
  const config = {anchor:'2028-02-01',cycle:['夜值','歇班','长班'],shiftDefs:overnight.shiftDefs};
  const {app,w,d} = boot(t,{config,now:'2027-12-30T02:00:00'}), $ = id => d.getElementById(id);
  let text; Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async value => { text = value; }}});
  app.views.navigateMonth(2028,1); d.querySelector('#legendContainer [data-calendar-shift="歇班"]').click();
  d.querySelector('#daysGrid [data-date="2028-02-13"]').click(); $('openMonthSheet').click();
  assert.equal($('monthSheetTitle').textContent,'2028 年 2 月排班表');
  const rows = $('monthSheetRows'), times = [...rows.querySelectorAll('time')];
  assert.equal(rows.children.length,5); assert.equal(rows.firstElementChild.cells[0].textContent,'');
  assert.equal(times.length,29); assert.equal(times[0].dateTime,'2028-02-01'); assert.equal(times.at(-1).dateTime,'2028-02-29');
  assert.equal(times[0].nextElementSibling.textContent,'夜值'); assert.equal(times[0].parentElement.querySelector('small').textContent,'跨日');
  assert.equal(times[1].parentElement.querySelector('small'),null);
  assert.match($('monthSheetLegend').textContent,/夜值21:30–次日06:15/);
  $('copyMonthAgenda').click(); await Promise.resolve(); const lines = text.split('\n');
  assert.equal(lines.length,29); assert.equal(lines[0],'2028-02-01 周二 · 夜值 · 21:30 — 次日 06:15');
  assert.equal(lines.at(-1),'2028-02-29 周二 · 歇班 · 当日无新班次');
  assert.equal(app.ui.activeDialog,'monthSheetModal'); assert.equal($('toast').textContent,'已复制整月排班');
  $('closeMonthSheet').click(); assert.equal(d.querySelector('#daysGrid .selected').dataset.date,'2028-02-13');
});

test('native print without opening a preview builds six weeks and a complete, unambiguous legend',t => {
  const names = ['夜间联合值守甲','夜间联合值守乙','休息','S01'];
  const config = {anchor:'2026-03-01',cycle:names,shiftDefs:{}};
  const {app,w,d} = boot(t,{config}), $ = id => d.getElementById(id);
  d.title = '个人网页标题'; app.views.navigateMonth(2026,2); app.settings.openSettings();
  pick(w,$('cyclePattern'),'未保存草稿','input');
  w.dispatchEvent(new w.Event('beforeprint')); w.dispatchEvent(new w.Event('beforeprint'));
  assert.equal(d.title,'2026 年 3 月排班表'); assert.equal($('monthSheetModal').hidden,true);
  const rows = $('monthSheetRows'); assert.equal(rows.children.length,6);
  assert.equal(rows.firstElementChild.cells[6].querySelector('time').dateTime,'2026-03-01');
  assert.equal(rows.lastElementChild.cells[1].querySelector('time').dateTime,'2026-03-31');
  assert.deepEqual([...rows.querySelectorAll('strong')].slice(0,4).map(n => n.textContent),['S02','S03','休息','S01']);
  assert.deepEqual([...$('monthSheetLegend').children].map(li => [li.querySelector('b')?.textContent,li.querySelector('strong').textContent]),[['S02',names[0]],['S03',names[1]],[undefined,'休息'],[undefined,'S01']]);
  assert.match(rows.firstElementChild.cells[6].getAttribute('aria-label'),/夜间联合值守甲/);
  assert.doesNotMatch($('monthSheetModal').textContent,/未保存草稿|个人网页标题/);
  w.dispatchEvent(new w.Event('afterprint')); assert.equal(d.title,'个人网页标题');
  assert.equal(app.ui.activeDialog,'settingsModal'); assert.equal($('cyclePattern').value,'未保存草稿');
  app.settings.closeSettings(); app.settings.commitConfig({anchor:config.anchor,cycle:['新班'],shiftDefs:{}});
  $('openMonthSheet').click(); assert.equal(rows.querySelector('strong').textContent,'新班');
});

test('monthly manual-copy fallback dismisses one level at a time and restores focus and live updates',async t => {
  const {app,w,d} = boot(t), $ = id => d.getElementById(id);
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async () => { throw Error('denied'); }}});
  app.views.navigateMonth(2026,3); $('openMonthSheet').click(); $('copyMonthAgenda').click(); await Promise.resolve();
  const text = $('agendaCopyText'); assert.equal(app.ui.activeDialog,'agendaCopyModal');
  assert.equal(d.activeElement,text); assert.equal(text.value.split('\n').length,30);
  assert.equal(text.selectionStart,0); assert.equal(text.selectionEnd,text.value.length);
  escape(w,text); assert.equal($('monthSheetModal').hidden,false); assert.equal(d.activeElement,$('copyMonthAgenda'));
  assert.equal(text.value,''); assert.equal(app.liveTimer,null);
  escape(w,d.activeElement); assert.equal(d.activeElement,$('openMonthSheet')); assert.notEqual(app.liveTimer,null);
});

test('print button uses native printing and keeps the preview usable if printing is unavailable',t => {
  const {app,w,d} = boot(t), $ = id => d.getElementById(id);
  let calls = 0; w.print = () => { calls++; };
  $('printMonthSheet').click(); assert.equal(calls,0);
  $('openMonthSheet').click(); $('printMonthSheet').click(); assert.equal(calls,1);
  w.print = undefined; $('printMonthSheet').click(); assert.match($('monthPrintStatus').textContent,/复制整月/);
  assert.equal(app.ui.activeDialog,'monthSheetModal'); $('closeMonthSheet').click(); $('openMonthSheet').click();
  assert.equal($('monthPrintStatus').textContent,'');
});
