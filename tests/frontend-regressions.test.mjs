import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createApp } from '../assets/app.js';

const require = createRequire(import.meta.url);
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (_) { ({ JSDOM } = require('../.qa/node_modules/jsdom')); }
const html = fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

function boot(t) {
  const dom = new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => dom.window.close());
  const w = dom.window, app = createApp(w);
  return {app,w,d:w.document};
}
function escape(w,target,options = {}) {
  const event = new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...options});
  target.dispatchEvent(event);
  return event;
}

test('IME Escape preserves each input-page draft for composition state, key flags and legacy key codes',t => {
  for (const kind of ['settings','preset','personalization','backup']) for (const guard of ['state','flag','legacy']) {
    const {app,w,d} = boot(t);
    const [dialog,input,open] = kind === 'settings'
      ? ['settingsModal','cyclePattern',app.settings.openSettings]
      : kind === 'preset' ? ['presetModal','presetName',app.settings.saveAsPreset]
      : kind === 'personalization' ? ['personalizationModal','personalizationTitle',app.personalization.openPersonalization]
      : ['dataModal','backupTextInput',app.dataTools.openDataTools];
    open(); const field = d.getElementById(input); field.value = '尚未保存的内容'; field.focus();
    if (guard === 'state') field.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));
    const event = escape(w,field,guard === 'flag' ? {isComposing:true} : guard === 'legacy' ? {keyCode:229} : {});
    assert.equal(app.ui.activeDialog,dialog,`${kind}/${guard}`);
    assert.equal(field.value,'尚未保存的内容');
    assert.equal(d.activeElement,field);
    assert.equal(app.liveTimer,null,'Composition must keep the static input page paused');
    assert.equal(event.defaultPrevented,false,'The input method keeps its native Escape behavior');
    if (guard === 'state') field.dispatchEvent(new w.CompositionEvent('compositionend',{bubbles:true}));
    assert.equal(escape(w,field).defaultPrevented,true);
    assert.equal(app.ui.activeDialog,null,'A later Escape still closes normally after composition');
    assert.notEqual(app.liveTimer,null);
  }
});

test('moving focus away from composition clears its Escape guard',t => {
  const {app,w,d} = boot(t);
  app.settings.openSettings(); const field = d.getElementById('shiftName'); field.focus();
  field.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));
  const close = d.querySelector('#settingsModal [data-action="closeSettings"]'); close.focus();
  escape(w,close);
  assert.equal(app.ui.activeDialog,null);
});

test('closing or nesting a dialog cannot leave a composition guard attached to the next page',t => {
  const {app,w,d} = boot(t);
  app.settings.openSettings(); const field = d.getElementById('shiftName'); field.focus();
  field.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));
  app.settings.closeSettings(); app.settings.saveAsPreset(); escape(w,d.activeElement);
  assert.equal(app.ui.activeDialog,null);
  app.settings.openSettings(); field.focus();
  field.dispatchEvent(new w.CompositionEvent('compositionstart',{bubbles:true}));
  app.settings.restoreDefaultSettings();
  assert.equal(app.ui.activeDialog,'confirmModal');
  escape(w,d.activeElement); assert.equal(app.ui.activeDialog,'settingsModal');
  escape(w,d.activeElement); assert.equal(app.ui.activeDialog,null);
});

function variables(source,selector) {
  return Object.fromEntries([...source.match(selector)[1].matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})\s*;/gi)].map(([,name,value]) => [name,value]));
}
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(value => Number.parseInt(value,16)/255)
    .map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
function contrast(a,b) {
  const left = luminance(a), right = luminance(b);
  return (Math.max(left,right)+.05)/(Math.min(left,right)+.05);
}
test('all six daylight shift labels retain readable small-text contrast on their cells and shared light surfaces',() => {
  const styles = fs.readFileSync(new URL('../assets/styles.css',import.meta.url),'utf8');
  const themes = fs.readFileSync(new URL('../assets/themes.css',import.meta.url),'utf8');
  const values = {...variables(styles,/:root\s*\{([^}]+)\}/),...variables(themes,/:root\s*\{([^}]+)\}/)};
  for (const shift of ['day','night','rest','noon','morning','evening']) {
    for (const background of [`--cell-${shift}-bg`,'--today-bg','--accent-soft','--bg-card']) {
      const ratio = contrast(values[`--${shift}-color`],values[background]);
      assert.ok(ratio >= 4.5,`${shift} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
});
