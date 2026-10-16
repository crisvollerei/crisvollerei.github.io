const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('../.qa/node_modules/jsdom')); }
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
function boot(t,{storage={},blocked=false,now='2026-10-16T12:00:00'}={}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());
  const w = dom.window, NativeDate = w.Date;
  let instant = new NativeDate(now).getTime();
  w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
  w.confirm = () => true; w.prompt = () => null;
  for (const [key,value] of Object.entries(storage)) w.localStorage.setItem(key,value);
  if (blocked) Object.defineProperty(w,'localStorage',{get(){throw new Error('Storage is disabled');}});
  const context = dom.getInternalVMContext();
  for (const filename of ['schedule-core.js','calendar-data.js','app.js']) vm.runInContext(fs.readFileSync(path.join(root,'assets',filename),'utf8'),context,{filename});
  return {w,d:w.document,read:expression=>vm.runInContext(expression,context),setNow:value=>{instant=new NativeDate(value).getTime();}};
}
test('default initialization renders a full month and twelve accessible month buttons',t => {
  const {d} = boot(t);
  assert.equal(d.querySelectorAll('#daysGrid button').length,31);
  assert.equal(d.querySelectorAll('#heatmapGrid button').length,12);
  assert.equal(d.querySelectorAll('#statsContainer .stat-card').length,3);
  assert.equal(d.querySelector('#workHours').textContent,'192');
  assert.equal(d.querySelector('#storageNotice').hidden,true);
});
test('broken JSON, empty cycles and blocked storage all retain a usable calendar',t => {
  for (const options of [{storage:{'qingzheng-cycle':'not JSON'}},{storage:{'qingzheng-cycle':'[]','qingzheng-anchor':'2026-02-31'}},{blocked:true}]) {
    const {d} = boot(t,options);
    assert.equal(d.querySelectorAll('#daysGrid button').length,31);
    assert.equal(d.querySelector('#storageNotice').hidden,false);
  }
});
test('legacy settings and presets migrate without an active preset overwriting current settings',t => {
  const preset = {id:'old',name:'旧方案',anchor:'2026-04-18',cycle:['白班'],shiftDefs:{}};
  const {read,d} = boot(t,{storage:{'qingzheng-cycle':'["休息"]','qingzheng-presets':JSON.stringify([preset]),'qingzheng-active-preset':'old'}});
  assert.equal(read('CYCLE[0]'),'休息');
  assert.equal(d.querySelector('#todayShift').textContent.includes('休息'),true);
});
test('settings cancellation discards additions, removals and in-form edits',t => {
  const {w,read,d} = boot(t); const before = read('JSON.stringify(captureCurrentConfig())');
  w.openSettings();
  d.querySelector('[data-shift="白班"] [data-field="startTime"]').value='07:30';
  w.prompt=()=> '新班'; w.addShiftDef();
  assert.equal(d.querySelector('[data-shift="白班"] [data-field="startTime"]').value,'07:30');
  w.removeShiftDef('夜班'); w.closeSettings();
  assert.equal(read('JSON.stringify(captureCurrentConfig())'),before);
  w.openSettings(); assert.equal(d.querySelector('[data-shift="白班"] [data-field="startTime"]').value,'08:00');
  assert.equal(d.querySelector('[data-shift="新班"]'),null);
});
test('settings validate work times and save all fields in one canonical record',t => {
  const {w,d,read} = boot(t); w.openSettings();
  const input = d.querySelector('[data-shift="白班"] [data-field="startTime"]');
  input.value=''; w.saveSettings(); assert.equal(d.querySelector('#settingsModal').hidden,false);
  assert.equal(d.querySelector('#settingsError').hidden,false);
  input.value='07:30'; w.saveSettings(); assert.equal(d.querySelector('#settingsModal').hidden,true);
  const saved = JSON.parse(w.localStorage.getItem('qingzheng-config'));
  assert.equal(saved.shiftDefs['白班'].startTime,'07:30');
  assert.equal(read('SHIFT_DEFS["白班"].startTime'),'07:30');
  const reloaded = boot(t,{storage:{'qingzheng-config':JSON.stringify(saved)}});
  assert.equal(reloaded.read('SHIFT_DEFS["白班"].startTime'),'07:30');
});
test('saving new names first presents their generated shift times for review',t => {
  const {w,d,read}=boot(t); w.openSettings(); d.querySelector('#cyclePattern').value='新班 休息';
  w.saveSettings(); assert.equal(d.querySelector('#settingsModal').hidden,false);
  assert.ok(d.querySelector('[data-shift="新班"]'));
  assert.equal(read('CYCLE.length'),8);
  w.saveSettings(); assert.equal(read('CYCLE.join(" ")'),'新班 休息');
});
test('custom names are text across the settings, today, statistics and detail views',t => {
  const name = '<img/src=x/onerror=alert(1)>';
  const {w,d,read}=boot(t,{storage:{'qingzheng-cycle':JSON.stringify([name,'constructor','__proto__'])}});
  w.openSettings();
  assert.ok(d.querySelector('#shiftDefsEditor').textContent.includes(name));
  assert.equal(d.querySelectorAll('img').length,1);
  w.closeSettings(); w.showDetail(new w.Date());
  assert.equal(d.querySelectorAll('img').length,1);
  assert.equal(Object.values(read('calculateMonthlyStats(2026,9)')).reduce((a,b)=>a+b,0),31);
});
test('long cycles search the complete cycle and no-rest cycles display a useful message',t => {
  const {w,read,d} = boot(t);
  w.eval(`CYCLE = [...Array(40).fill('白班'),'休息']; ANCHOR_DATE = new Date(2026,9,16);`);
  assert.equal(read('getDaysToWeekend(new Date(2026,9,16))'),40);
  w.eval(`CYCLE = [...Array(40).fill('休息'),'白班'];`);
  assert.ok(read('getNextWorkCountdown(new Date(2026,9,16))') > 39*86400000);
  assert.equal(read('calculateNextShifts(new Date(2026,9,16))["白班"]'),40);
  w.eval(`CYCLE = ['白班'];`); w.render(); w.showDetail(new w.Date());
  assert.equal(d.querySelector('#restCountdown').textContent,'周期内无休息日');
  assert.ok(d.querySelector('#detailExtra').textContent.includes('整个周期'));
  assert.equal(d.querySelector('#detailExtra').textContent.includes('-1'),false);
});
test('overnight card keeps the previous shift date and cycle position until its exact end',t => {
  const {read,w,d}=boot(t,{now:'2026-04-20T07:59:59'});
  const current = read('getEffectiveShiftInfo()');
  assert.equal(current.shift,'夜班'); assert.equal(current.date.getDate(),19);
  assert.equal(d.querySelector('#todayCycle').textContent,'2');
  assert.ok(d.querySelector('#todayShiftTime').textContent.includes('昨日班次'));
  assert.equal(d.querySelector('#restCountdown').textContent,'本班结束后');
  assert.equal(read('getEffectiveShiftInfo(new Date(2026,3,20,8,0)).shift'),'休息');
  assert.equal(w.formatCountdown(40*86400000),'40天 00:00:00');
});
test('navigation bounds apply to direct calls, keyboard navigation and picker years',t => {
  const {w,d,read}=boot(t);
  w.navigateMonth(2025,0); w.prevMonth(); assert.equal(read('viewYear'),2025); assert.equal(read('viewMonth'),0);
  w.navigateMonth(2027,11); w.nextMonth(); assert.equal(read('viewYear'),2027); assert.equal(read('viewMonth'),11);
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})); assert.equal(read('viewYear'),2027);
  w.openPicker(); w.pickerNextYear(); assert.equal(read('pickerYear'),2027);
  const before=read('viewMonth'); d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); assert.equal(read('viewMonth'),before);
});
test('dialogs trap focus, restore their opener and close with Escape',t => {
  const {w,d}=boot(t); const opener=d.querySelector('[aria-label="打开排班设置"]'); opener.focus(); w.openSettings();
  assert.equal(d.querySelector('.main-container').inert,true);
  const save=d.querySelector('.btn-group .button-primary'); save.focus();
  save.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
  assert.equal(d.activeElement.getAttribute('aria-label'),'关闭排班设置');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(d.querySelector('#settingsModal').hidden,true); assert.equal(d.activeElement,opener);
});
test('preset add/apply/delete preserves live settings and restores the saved configuration',t => {
  const {w,d,read}=boot(t); w.prompt=()=> '测试方案'; w.saveAsPreset();
  assert.equal(d.querySelectorAll('.preset-group').length,1);
  assert.equal(d.querySelectorAll('.preset-btn button').length,0);
  const id=read('PRESETS[0].id'), before=read('JSON.stringify(captureCurrentConfig())');
  w.openSettings(); d.querySelector('#cyclePattern').value='休息'; w.saveSettings();
  w.applyPreset(id); assert.equal(read('JSON.stringify(captureCurrentConfig())'),before);
  w.deletePreset(id); assert.equal(read('CYCLE.length'),8); assert.equal(d.querySelectorAll('.preset-group').length,0);
});
test('all shift types are included in monthly statistics, including the fourth and later shifts',t => {
  const {w,d}=boot(t,{storage:{'qingzheng-cycle':'["白班","夜班","中班","休息"]'}});
  assert.equal(d.querySelectorAll('#statsContainer .stat-card').length,4);
  d.querySelector('#themeToggle').click(); assert.equal(d.documentElement.dataset.theme,'dark');
  assert.equal(w.localStorage.getItem('qingzheng-theme'),'dark');
});
test('solar terms use the corrected annual table and never fall back to 2026 for unknown years',t => {
  const {read}=boot(t);
  assert.equal(read('getSolarTerm(new Date(2026,2,5))'),'惊蛰');
  assert.equal(read('getSolarTerm(new Date(2026,2,6))'),null);
  assert.equal(read('getSolarTerm(new Date(2026,9,23))'),'霜降');
  assert.equal(read('getSolarTerm(new Date(2040,9,23))'),null);
});
test('midnight and the end of an overnight shift update the date, cycle and visible calendar',t => {
  const {w,d,setNow}=boot(t,{now:'2026-04-19T23:59:59'});
  assert.equal(d.querySelector('#todayCycle').textContent,'2');
  setNow('2026-04-20T00:00:00'); w.updateLiveClockAndCountdown();
  assert.ok(d.querySelector('#todayDate').textContent.includes('4月20日'));
  assert.equal(d.querySelector('.day-cell.today').dataset.date,'2026-04-20');
  assert.equal(d.querySelector('#todayCycle').textContent,'2');
  setNow('2026-04-20T08:00:00'); w.updateLiveClockAndCountdown();
  assert.equal(d.querySelector('#todayCycle').textContent,'3');
  assert.ok(d.querySelector('#todayShift').textContent.includes('休息'));
});
test('a write failure keeps session changes usable and displays the persistence limitation',t => {
  const {w,d,read}=boot(t,{blocked:true});
  w.openSettings(); d.querySelector('#cyclePattern').value='休息'; w.saveSettings();
  assert.equal(read('CYCLE.length'),1);
  assert.equal(d.querySelector('#settingsModal').hidden,true);
  assert.equal(d.querySelector('#storageNotice').hidden,false);
  assert.ok(d.querySelector('#todayShift').textContent.includes('休息'));
});
test('removing an unused default definition survives saving and reload',t => {
  const {w}=boot(t); w.openSettings(); w.removeShiftDef('中班'); w.saveSettings();
  const saved=w.localStorage.getItem('qingzheng-config');
  const restored=boot(t,{storage:{'qingzheng-config':saved}});
  assert.equal(restored.read('Object.hasOwn(SHIFT_DEFS,"中班")'),false);
});
