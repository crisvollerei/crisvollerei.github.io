import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createApp} from '../assets/app.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) { ({JSDOM} = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function boot(t,{now = '2026-11-06T12:00:00',config} = {}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, NativeDate = w.Date;
  w.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new NativeDate(now).getTime(); }
  };
  if (config) w.localStorage.setItem('qingzheng-config',JSON.stringify(config));
  return {app:createApp(w),w,d:w.document,setNow(value) { now = value; }};
}
const rest = {emoji:'🌿',cssClass:'day',startTime:null,endTime:null,isWork:false};
const work = {emoji:'☀️',cssClass:'rest',startTime:'08:00',endTime:'16:00',isWork:true};

test('rest markers follow custom shift semantics rather than the shift name or color',t => {
  const {d} = boot(t,{config:{anchor:'2026-11-06',cycle:['夜间','休息'],shiftDefs:{夜间:rest,休息:work}}});
  for (const container of ['#daysGrid','#upcomingList']) {
    const restDot = d.querySelector(`${container} [data-date="2026-11-06"] .shift-dot`);
    const workDot = d.querySelector(`${container} [data-date="2026-11-07"] .shift-dot`);
    assert.ok(restDot.classList.contains('rest-mark'),`${container}: a blue non-working shift gets the rest marker`);
    assert.equal(workDot.classList.contains('rest-mark'),false,`${container}: a green working shift called 休息 remains a work marker`);
    assert.equal(restDot.getAttribute('aria-hidden'),'true');
    assert.equal(workDot.getAttribute('aria-hidden'),'true');
  }
  const legend = [...d.querySelectorAll('#legendContainer .legend-item')];
  assert.ok(legend.find(item => item.textContent === '夜间').querySelector('.legend-dot.rest-mark'));
  assert.equal(legend.find(item => item.textContent === '休息').querySelector('.rest-mark'),null);
  for (const dot of d.querySelectorAll('#legendContainer .legend-dot')) assert.equal(dot.getAttribute('aria-hidden'),'true');
});

test('overnight time tags preserve the previous-day shift across midnight and clear when it ends',t => {
  const config = {anchor:'2026-11-06',cycle:['值夜','休息'],shiftDefs:{
    值夜:{emoji:'🌙',cssClass:'night',startTime:'20:00',endTime:'08:00',isWork:true},休息:rest
  }};
  const {app,d,w,setNow} = boot(t,{now:'2026-11-06T23:59:59',config});
  const todayTime = d.getElementById('todayShiftTime');
  assert.equal(todayTime.textContent,'20:00 — 次日 08:00');
  assert.equal(todayTime.querySelector('.next-day-tag').textContent,'次日');
  setNow('2026-11-07T00:00:01'); app.updateLiveClockAndCountdown();
  assert.equal(todayTime.textContent,'昨日班次 · 20:00 — 次日 08:00');
  assert.equal(todayTime.querySelectorAll('.next-day-tag').length,1);
  app.views.showDetail(new w.Date(2026,10,6));
  assert.equal(d.getElementById('detailTime').textContent,'20:00 — 次日 08:00');
  assert.equal(d.querySelector('#detailTime .next-day-tag').textContent,'次日');
  app.views.moveDetail(1);
  assert.equal(d.querySelector('#detailTime .next-day-tag'),null,'The next calendar day remains a rest day even while yesterday’s shift is running');
  setNow('2026-11-07T08:00:00'); app.updateLiveClockAndCountdown();
  assert.equal(todayTime.querySelector('.next-day-tag'),null);
  assert.equal(todayTime.textContent,'不赶时间，好好休息');
});

test('time tags also recognize explicit next-day shifts without tagging ordinary daytime hours',t => {
  for (const crossDay of [false,true]) {
    const config = {anchor:'2026-11-06',cycle:['自定班'],shiftDefs:{自定班:{...work,crossDay}}};
    const {app,d,w} = boot(t,{now:'2026-11-06T23:00:00',config});
    app.views.showDetail(new w.Date(2026,10,6));
    for (const id of ['todayShiftTime','detailTime']) {
      const field = d.getElementById(id);
      assert.equal(field.textContent,crossDay ? '08:00 — 次日 16:00' : '08:00 — 16:00');
      assert.equal(field.querySelectorAll('.next-day-tag').length,crossDay ? 1 : 0);
    }
  }
});

test('current-month markers remain distinct from viewed months and follow the year rollover',t => {
  const {app,d,setNow} = boot(t,{now:'2026-12-31T12:00:00'});
  app.views.navigateMonth(2026,10);
  let yearMonths = [...d.querySelectorAll('.heatmap-month')];
  assert.equal(yearMonths[11].getAttribute('aria-current'),'date');
  assert.equal(yearMonths[11].getAttribute('aria-pressed'),'false');
  assert.equal(yearMonths[10].getAttribute('aria-pressed'),'true');
  app.views.openPicker();
  let months = [...d.querySelectorAll('.picker-month-btn')];
  assert.equal(months[11].getAttribute('aria-current'),'date');
  assert.equal(months[11].querySelector('.current-month-note').textContent,'本月');
  assert.equal(months[11].getAttribute('aria-pressed'),'false');
  assert.equal(months[10].getAttribute('aria-pressed'),'true');
  app.views.pickerNextYear();
  assert.equal(d.querySelector('#pickerMonths [aria-current]'),null);
  assert.equal(d.querySelector('#pickerMonths .current-month-note'),null);
  app.views.closePicker();
  setNow('2027-01-01T00:00:01'); app.updateLiveClockAndCountdown();
  assert.equal(d.querySelector('.heatmap-month[aria-current]'),null,'The displayed 2026 overview no longer contains the current month');
  app.views.navigateMonth(2027,2);
  yearMonths = [...d.querySelectorAll('.heatmap-month')];
  assert.equal(yearMonths[0].getAttribute('aria-current'),'date');
  assert.equal(yearMonths[2].getAttribute('aria-pressed'),'true');
  app.views.openPicker();
  months = [...d.querySelectorAll('.picker-month-btn')];
  assert.equal(months[0].getAttribute('aria-current'),'date');
  assert.equal(months[0].querySelector('.current-month-note').textContent,'本月');
  assert.equal(months[2].getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('#pickerMonths [aria-current]').length,1);
});
