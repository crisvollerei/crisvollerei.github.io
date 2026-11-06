import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createApp} from '../assets/app.js';
import Core from '../assets/schedule-core.js';
import {createBackup,createBackupText,parseBackup,parseBackupText,MAX_BACKUP_BYTES} from '../assets/backup-format.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({JSDOM} = require('jsdom')); } catch (_) { ({JSDOM} = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const restConfig = () => Core.normalizeConfig({anchor:'2026-11-06',cycle:['休息'],shiftDefs:{}});
function boot(t,{shared = new Map(),locks} = {}) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const state = {readFailed:false,writeFailed:false}, w = dom.window;
  Object.defineProperty(w,'localStorage',{value:{
    getItem(key) { if (key === 'qingzheng-presets' && state.readFailed) throw new Error('Read denied'); return shared.get(key) ?? null; },
    setItem(key,value) { if (key === 'qingzheng-presets' && state.writeFailed) throw new Error('Quota'); shared.set(key,String(value)); }
  }});
  if (locks) Object.defineProperty(w.navigator,'locks',{value:locks});
  return {app:createApp(w),w,d:w.document,state,shared};
}
function save(x,name) {
  x.app.settings.saveAsPreset(); x.d.querySelector('#presetName').value = name;
  return x.app.settings.submitPreset();
}
const stored = x => JSON.parse(x.shared.get('qingzheng-presets') || '[]');
const names = x => stored(x).map(preset => preset.name);
function deletePreset(x,id) { x.app.settings.deletePreset(id); x.d.querySelector('#confirmAccept').click(); }
function queuedLocks() {
  const queue = [];
  return {queue,request(_name,work) { return new Promise((resolve,reject) => queue.push(() => { try { resolve(work()); } catch (error) { reject(error); } })); }};
}

test('stale tabs merge newly saved presets, including when both naming dialogs were already open',t => {
  const shared = new Map(), a = boot(t,{shared}), b = boot(t,{shared});
  b.app.settings.saveAsPreset(); b.d.querySelector('#presetName').value = '方案 B';
  save(a,'方案 A'); b.app.settings.submitPreset();
  assert.deepEqual(names(b),['方案 A','方案 B']);
  const reloaded = boot(t,{shared}); assert.equal(reloaded.app.settings.presets.length,2);
});
test('Web Locks serialize simultaneous saves and recheck duplicate names inside the lock',async t => {
  const locks = queuedLocks(), shared = new Map(), a = boot(t,{shared,locks}), b = boot(t,{shared,locks});
  const first = save(a,'同名'), second = save(b,'同名');
  locks.queue.shift()(); await first; locks.queue.shift()(); await second;
  assert.deepEqual(names(a),['同名']);
  assert.equal(b.app.ui.activeDialog,'presetModal'); assert.match(b.d.querySelector('#presetError').textContent,/同名/);
  assert.equal(b.d.querySelector('#presetSubmit').disabled,false);
});
test('closing and reopening while waiting for a lock discards only the obsolete submission',async t => {
  const locks = queuedLocks(), x = boot(t,{locks});
  const old = save(x,'旧草稿'); x.app.settings.closePresetDialog(); const latest = save(x,'新草稿');
  locks.queue.shift()(); await old;
  assert.deepEqual(names(x),[]); assert.equal(x.d.querySelector('#presetSubmit').disabled,true);
  locks.queue.shift()(); await latest; assert.deepEqual(names(x),['新草稿']);
});
test('editing a name while its save is queued cancels the obsolete name',async t => {
  const locks = queuedLocks(), x = boot(t,{locks});
  const obsolete = save(x,'原名称');
  x.d.querySelector('#presetName').value = '新名称'; x.d.querySelector('#presetName').dispatchEvent(new x.w.Event('input',{bubbles:true}));
  locks.queue.shift()(); await obsolete; assert.deepEqual(names(x),[]);
  const latest = x.app.settings.submitPreset(); locks.queue.shift()(); await latest;
  assert.deepEqual(names(x),['新名称']);
});
test('a stale tab cannot resurrect externally deleted presets when it saves or imports',t => {
  const shared = new Map(), a = boot(t,{shared}); save(a,'待删除');
  const b = boot(t,{shared}), id = a.app.settings.presets[0].id;
  deletePreset(a,id); save(b,'新方案'); assert.deepEqual(names(b),['新方案']);
  b.app.settings.restoreBackup({config:restConfig(),presets:[]}); assert.equal(names(b).includes('待删除'),false);
});
test('a queued deletion preserves a different tab newly saved preset',async t => {
  const shared = new Map(), a = boot(t,{shared}); save(a,'旧方案');
  const locks = queuedLocks(), b = boot(t,{shared,locks}); deletePreset(b,a.app.settings.presets[0].id);
  save(a,'保留方案'); locks.queue.shift()(); await Promise.resolve();
  assert.deepEqual(names(b),['保留方案']);
});
test('failed local saves are retained without resurrecting removed records or duplicating names',t => {
  const shared = new Map(), a = boot(t,{shared}); save(a,'旧方案'); const id = a.app.settings.presets[0].id;
  const b = boot(t,{shared});
  a.state.writeFailed = true; save(a,'临时方案'); a.state.writeFailed = false;
  deletePreset(b,id); save(b,'临时方案'); save(a,'新方案');
  assert.deepEqual(names(a),['临时方案','新方案'],'Identical unsaved and persisted copies merge');
  a.state.writeFailed = true; a.app.settings.commitConfig(restConfig()); save(a,'冲突方案'); a.state.writeFailed = false;
  save(b,'冲突方案'); save(a,'最终方案');
  assert.equal(new Set(names(a)).size,names(a).length);
  assert.ok(names(a).includes('冲突方案')); assert.ok(names(a).includes('冲突方案（1）'));
});
test('read failure never replaces existing presets even if writes would succeed',t => {
  const x = boot(t); save(x,'已有方案'); const original = x.shared.get('qingzheng-presets');
  x.state.readFailed = true; save(x,'会话方案');
  assert.equal(x.shared.get('qingzheng-presets'),original);
  assert.ok(x.app.settings.presets.some(preset => preset.name === '会话方案'));
  assert.match(x.d.querySelector('#toast').textContent,/本次/);
});
test('restricted Web Locks fall back to local operations without retrying a failed mutation',async t => {
  const x = boot(t,{locks:{request() { return Promise.reject(Object.assign(new Error('Unavailable'),{name:'SecurityError'})); }}});
  await save(x,'本地方案'); assert.deepEqual(names(x),['本地方案']);
  const y = boot(t,{locks:{request(_name,work) { return Promise.resolve().then(work); }}});
  y.state.writeFailed = true; await save(y,'未写入');
  assert.equal(y.app.settings.presets.length,1); assert.deepEqual(names(y),[]);
});
test('storage changes do not repaint the hidden calendar during an input draft',t => {
  const shared = new Map(), a = boot(t,{shared}), b = boot(t,{shared});
  b.app.settings.openSettings(); b.d.querySelector('#cyclePattern').value = '夜班 休息';
  const observer = new b.w.MutationObserver(() => {});
  observer.observe(b.d.querySelector('.main-container'),{childList:true,subtree:true,attributes:true,characterData:true});
  save(a,'外部方案'); b.w.dispatchEvent(new b.w.StorageEvent('storage',{key:'qingzheng-presets'}));
  assert.equal(observer.takeRecords().length,0); assert.equal(b.d.querySelector('#cyclePattern').value,'夜班 休息');
  observer.disconnect(); b.app.settings.closeSettings();
  assert.deepEqual([...b.d.querySelectorAll('.preset-btn')].map(button => button.textContent),['外部方案']);
});
test('backup exports refresh another tab presets without writing to storage',async t => {
  const shared = new Map(), a = boot(t,{shared}), b = boot(t,{shared}); save(a,'另页方案');
  const before = shared.get('qingzheng-presets'); b.app.dataTools.openDataTools(); await b.app.dataTools.copyBackupText();
  assert.deepEqual(parseBackupText(b.d.querySelector('#backupTextOutput').value).presets.map(preset => preset.name),['另页方案']);
  assert.equal(shared.get('qingzheng-presets'),before);
});
test('import deduplication distinguishes manually numbered names and survives backup round trips',t => {
  const x = boot(t); x.app.settings.commitConfig(restConfig()); save(x,'日常（1）');
  const backup = createBackup(restConfig(),[{...restConfig(),name:'日常'}],'now');
  x.app.settings.restoreBackup(parseBackup(JSON.stringify(backup)));
  assert.deepEqual(names(x),['日常（1）','日常']);
  const y = boot(t); save(y,'日常'); y.app.settings.restoreBackup(parseBackup(JSON.stringify(backup)));
  assert.deepEqual(names(y),['日常','日常（1）']);
  const roundTrip = parseBackupText(createBackupText(createBackup(y.app.schedule.captureCurrentConfig(),y.app.settings.presets,'now')));
  const z = boot(t); z.app.settings.restoreBackup(roundTrip); z.app.settings.restoreBackup(parseBackup(JSON.stringify(backup)));
  assert.equal(names(z).filter(name => name.startsWith('日常')).length,2);
  const reloaded = boot(t,{shared:z.shared}); reloaded.app.settings.restoreBackup(parseBackup(JSON.stringify(backup)));
  assert.equal(names(reloaded).filter(name => name.startsWith('日常')).length,2);
});
test('import work grows with the number of presets instead of every pair of presets',t => {
  const x = boot(t), config = restConfig(), count = 1000;
  const backup = {config,presets:Array.from({length:count},(_,index) => ({...config,name:`方案 ${index}`}))};
  const stringify = JSON.stringify; let fingerprints = 0;
  JSON.stringify = function(value,...args) {
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && Array.isArray(value[1])) fingerprints++;
    return stringify.call(this,value,...args);
  };
  try { x.app.settings.restoreBackup(backup); } finally { JSON.stringify = stringify; }
  assert.ok(fingerprints < count*8,`Too many configuration comparisons: ${fingerprints}`);
  assert.equal(x.app.settings.presets.length,count+1);
});
test('closing or editing a backup while its restore is queued never applies stale data',async t => {
  for (const action of ['close','edit']) {
    const locks = queuedLocks(), x = boot(t,{locks}), original = x.app.schedule.captureCurrentConfig();
    x.app.dataTools.openDataTools(); x.d.querySelector('#backupTextInput').value = createBackupText(createBackup(restConfig(),[],'now',{title:'导入标题'}));
    x.app.dataTools.previewBackupText(); x.app.dataTools.importBackup(); x.d.querySelector('#confirmAccept').click();
    assert.equal(x.d.querySelector('#importBackup').disabled,true);
    if (action === 'close') x.app.dataTools.closeDataTools();
    else { x.d.querySelector('#backupTextInput').value = ''; x.d.querySelector('#backupTextInput').dispatchEvent(new x.w.Event('input',{bubbles:true})); }
    locks.queue.shift()(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(x.app.schedule.captureCurrentConfig(),original); assert.equal(x.app.personalization.title,'清蒸排班');
    assert.deepEqual(names(x),[]); assert.equal(x.d.querySelector('#importBackup').disabled,false);
  }
});
test('queued restore applies its title only after the locked schedule operation finishes',async t => {
  const locks = queuedLocks(), x = boot(t,{locks});
  x.app.dataTools.openDataTools(); x.d.querySelector('#backupTextInput').value = createBackupText(createBackup(restConfig(),[],'now',{title:'导入标题'}));
  x.app.dataTools.previewBackupText(); x.app.dataTools.importBackup(); x.d.querySelector('#confirmAccept').click();
  assert.equal(x.app.personalization.title,'清蒸排班'); locks.queue.shift()(); await Promise.resolve(); await Promise.resolve();
  assert.equal(x.app.personalization.title,'导入标题'); assert.equal(x.app.ui.activeDialog,null);
  assert.deepEqual([...x.app.schedule.cycle],['休息']);
});
test('file download falls back to compact JSON and remains importable for long-cycle collections',async t => {
  const config = Core.normalizeConfig({anchor:'2026-11-06',cycle:Array(3660).fill('休息'),shiftDefs:{}});
  const presets = Array.from({length:40},(_,index) => ({...config,id:`p${index}`,name:`方案${index}`}));
  const x = boot(t,{shared:new Map([['qingzheng-config',JSON.stringify(config)],['qingzheng-presets',JSON.stringify(presets)]])});
  let blob; x.w.URL.createObjectURL = value => { blob = value; return 'blob:backup'; };
  x.w.HTMLAnchorElement.prototype.click = () => {}; x.app.dataTools.openDataTools(); x.app.dataTools.exportBackup();
  assert.ok(blob && blob.size <= MAX_BACKUP_BYTES);
  const json = await new Promise(resolve => { const reader = new x.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.equal(parseBackup(json).presets.length,40); assert.equal(x.d.querySelector('#backupError').hidden,true);
});
