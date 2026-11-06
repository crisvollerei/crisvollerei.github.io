import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createApp } from '../assets/app.js';
import { createSchedule } from '../assets/schedule.js';
import Core from '../assets/schedule-core.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require('jsdom')); }
catch (_) { ({JSDOM} = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const dayAndRest = Core.normalizeConfig({anchor:'2026-11-06',cycle:['白班','休息'],shiftDefs:{
  '白班':{isWork:true,startTime:'08:00',endTime:'17:00',cssClass:'day'},
  '休息':{isWork:false,cssClass:'rest'}
}});
function scheduleFor(config) {
  return createSchedule({get:() => null,set:() => true,readJSON:key => key === 'qingzheng-config' ? config : null,markRecovered() {}});
}
function boot(t,{now = '2026-11-06T07:59:59',config = dayAndRest} = {}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, NativeDate = w.Date;
  let instant = new NativeDate(now).getTime();
  w.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
  w.localStorage.setItem('qingzheng-config',JSON.stringify(config));
  w.localStorage.setItem('qingzheng-theme','light');
  w.localStorage.setItem('qingzheng-theme-mode','manual');
  const app = createApp(w);
  return {app,w,d:w.document,setNow(value) { instant = new NativeDate(value).getTime(); }};
}

test('next work occurrences include today only until their actual start time',() => {
  const schedule = scheduleFor(dayAndRest);
  assert.equal(schedule.calculateNextShifts(new Date(2026,10,6,7,59,59))['白班'],0);
  assert.equal(schedule.calculateNextShifts(new Date(2026,10,6,8))['白班'],2);
  assert.equal(schedule.calculateNextShifts(new Date(2026,10,6,18))['白班'],2);
  assert.equal(schedule.calculateNextShifts(new Date(2026,10,7,7))['白班'],1);
  assert.equal(schedule.getNextWorkDelay(new Date(2026,10,6,7)),3600000);
});
test('all-rest and long cycles keep complete next-work results',() => {
  const rest = scheduleFor(Core.normalizeConfig({anchor:'2026-11-06',cycle:['休息'],shiftDefs:{}}));
  assert.deepEqual(Object.keys(rest.calculateNextShifts(new Date(2026,10,6))),[]);
  const long = scheduleFor(Core.normalizeConfig({anchor:'2026-11-06',cycle:[...Array(3659).fill('休息'),'白班'],shiftDefs:{}}));
  assert.equal(long.calculateNextShifts(new Date(2026,10,6,7))['白班'],3659);
});
test('upcoming work updates exactly at shift start without steady-second DOM writes',t => {
  const {app,d,w,setNow} = boot(t), list = d.querySelector('#nextShiftContainer');
  assert.match(list.textContent,/下次白班今天 08:00/);
  assert.equal(d.querySelector('#countdownToWork').textContent,'00:00:01');
  const observer = new w.MutationObserver(() => {});
  observer.observe(list,{subtree:true,childList:true,characterData:true,attributes:true});
  setNow('2026-11-06T08:00:00'); app.updateLiveClockAndCountdown();
  assert.match(list.textContent,/下次白班2 天后/);
  assert.equal(d.querySelector('#countdownToWork').textContent,'正在上班');
  assert.ok(observer.takeRecords().length > 0);
  const row = list.firstElementChild;
  setNow('2026-11-06T08:00:01'); app.updateLiveClockAndCountdown();
  setNow('2026-11-06T18:00:00'); app.updateLiveClockAndCountdown();
  assert.deepEqual(observer.takeRecords(),[]);
  assert.equal(list.firstElementChild,row);
  observer.disconnect();
});
test('shift-start refresh remains paused while an editable form is open and catches up on close',t => {
  const {app,d,w,setNow} = boot(t), main = d.querySelector('.main-container');
  app.settings.openSettings(); d.querySelector('#cyclePattern').value = '休息 白班';
  const observer = new w.MutationObserver(() => {});
  observer.observe(main,{subtree:true,childList:true,characterData:true,attributes:true});
  setNow('2026-11-06T08:00:00'); app.updateLiveClockAndCountdown();
  assert.match(d.querySelector('#nextShiftContainer').textContent,/今天 08:00/);
  assert.equal(d.querySelector('#cyclePattern').value,'休息 白班');
  assert.deepEqual(observer.takeRecords(),[]);
  observer.disconnect(); app.settings.closeSettings();
  assert.match(d.querySelector('#nextShiftContainer').textContent,/2 天后/);
  assert.equal(d.querySelector('#countdownToWork').textContent,'正在上班');
});
test('yesterday overnight work does not hide a later shift starting today',t => {
  const config = Core.normalizeConfig({anchor:'2026-11-05',cycle:['夜班','白班','休息'],shiftDefs:{
    '夜班':{isWork:true,startTime:'20:00',endTime:'08:00',crossDay:true,cssClass:'night'},
    '白班':{isWork:true,startTime:'09:00',endTime:'17:00',cssClass:'day'},
    '休息':{isWork:false,cssClass:'rest'}
  }});
  const {app,d,setNow} = boot(t,{now:'2026-11-06T07:00:00',config});
  assert.match(d.querySelector('#todayShiftTime').textContent,/昨日班次/);
  assert.match(d.querySelector('#nextShiftContainer').textContent,/下次白班今天 09:00/);
  assert.equal(d.querySelector('#countdownToWork').textContent,'正在上班');
  setNow('2026-11-06T08:00:00'); app.updateLiveClockAndCountdown();
  assert.equal(d.querySelector('#countdownToWork').textContent,'01:00:00');
  assert.match(d.querySelector('#nextShiftContainer').textContent,/下次白班今天 09:00/);
  setNow('2026-11-06T09:00:00'); app.updateLiveClockAndCountdown();
  assert.match(d.querySelector('#nextShiftContainer').textContent,/下次白班3 天后/);
});
test('an annual range change clamps an expired detail and keeps its navigation usable',t => {
  const {app,d,setNow} = boot(t,{now:'2026-12-31T23:59:59'});
  app.views.navigateMonth(2025,0); d.querySelector('#daysGrid [data-date="2025-01-01"]').click();
  setNow('2027-01-01T00:00:00'); app.updateLiveClockAndCountdown();
  assert.equal(d.querySelector('#monthTitle').textContent,'2026 年 1 月');
  assert.match(d.querySelector('#detailDate').textContent,/2026年1月1日/);
  assert.equal(d.querySelector('#daysGrid [aria-pressed="true"]').dataset.date,'2026-01-01');
  assert.equal(d.querySelector('#detailPrev').disabled,true);
  assert.equal(d.querySelector('#detailNext').disabled,false);
  assert.match(d.querySelector('#detailAnnouncement').textContent,/2026年1月1日/);
  d.querySelector('#detailNext').click(); assert.match(d.querySelector('#detailDate').textContent,/2026年1月2日/);
  d.querySelector('.detail-back').click();
  assert.equal(d.activeElement.dataset.date,'2026-01-01');
});
test('valid details are retained across New Year while their new lower boundary is enforced',t => {
  const {app,d,setNow} = boot(t,{now:'2026-12-31T23:59:59'});
  app.views.navigateMonth(2026,0); d.querySelector('#daysGrid [data-date="2026-01-01"]').click();
  assert.equal(d.querySelector('#detailPrev').disabled,false);
  setNow('2027-01-01T00:00:00'); app.updateLiveClockAndCountdown();
  assert.match(d.querySelector('#detailDate').textContent,/2026年1月1日/);
  assert.equal(d.querySelector('#detailPrev').disabled,true);
  d.querySelector('#detailNext').click(); assert.match(d.querySelector('#detailDate').textContent,/2026年1月2日/);
});
test('moving the device year backwards clamps details to the new upper boundary',t => {
  const {app,d,setNow} = boot(t,{now:'2027-01-01T00:00:00'});
  app.views.navigateMonth(2028,11); d.querySelector('#daysGrid [data-date="2028-12-31"]').click();
  setNow('2026-12-31T23:59:59'); app.updateLiveClockAndCountdown();
  assert.equal(d.querySelector('#monthTitle').textContent,'2027 年 12 月');
  assert.match(d.querySelector('#detailDate').textContent,/2027年12月31日/);
  assert.equal(d.querySelector('#detailPrev').disabled,false);
  assert.equal(d.querySelector('#detailNext').disabled,true);
  d.querySelector('#detailPrev').click(); assert.match(d.querySelector('#detailDate').textContent,/2027年12月30日/);
});
