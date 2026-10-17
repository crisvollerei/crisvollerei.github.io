import Core from './schedule-core.js?v=fc384b3c941b';
import { CSS_PRESETS, STYLE_NAMES, PRESET_ICONS, DEFAULT_SHIFT_DEFS } from './config.js?v=9715089d804c';
import { syncAndroidBridge } from './integrations.js?v=924ca4c1da81';
export function createSettings({window, ui, schedule, views, storage}) {
  const { document, Date } = window;
  const { $, mk, toast, openDialog, closeDialog } = ui;
  const { set: storageSet, readJSON } = storage;
  const { captureCurrentConfig } = schedule;
  let PRESETS = [], activePresetId = null, draftDefs = null;
  function configKey(config) { return JSON.stringify([config.anchor,config.cycle,Object.entries(config.shiftDefs).sort(([a],[b])=>a.localeCompare(b))]); }
  function commitConfig(config) {
    if (!Core.normalizeConfig(config)) return false;
    const persisted = schedule.commitConfig(config);
    syncActivePreset(); views.closeDetail(); views.render();
    syncAndroidBridge(window,schedule.captureCurrentConfig(),toast);
    return persisted;
  }
  function loadPresets() {
    const saved = readJSON('qingzheng-presets');
    if (saved !== null && !Array.isArray(saved)) storage.markRecovered();
    const seen = new Set();
    PRESETS = (Array.isArray(saved) ? saved : []).flatMap(preset => {
      const config = Core.normalizeConfig(preset);
      if (!config || typeof preset.id !== 'string' || typeof preset.name !== 'string' || !preset.name.trim() || seen.has(preset.id)) { storage.markRecovered(); return []; }
      seen.add(preset.id);
      return [{...config,id:preset.id,name:preset.name,createdAt:preset.createdAt}];
    });
    syncActivePreset();
  }
  function savePresets() { return storageSet('qingzheng-presets',JSON.stringify(PRESETS)); }
  function syncActivePreset() {
    const current = configKey(captureCurrentConfig());
    activePresetId = PRESETS.find(preset => configKey(preset) === current)?.id || null;
    renderPresetBar();
  }
  function saveAsPreset() {
    if (ui.activeDialog === 'presetModal') return;
    $('presetName').value = '';
    presetNameError('');
    openDialog('presetModal');
  }
  function presetNameError(message) {
    $('presetError').textContent = message; $('presetError').hidden = !message;
    $('presetName').setAttribute('aria-invalid',String(!!message));
  }
  function closePresetDialog() {
    closeDialog('presetModal');
    $('presetName').value = ''; presetNameError('');
  }
  function submitPreset() {
    if (ui.activeDialog !== 'presetModal') return;
    const name = $('presetName').value.trim();
    let error = '';
    if (!name) error = '请填写方案名称。';
    else if (name.length > 40) error = '方案名称最多 40 个字符。';
    else if (PRESETS.some(preset => preset.name === name)) error = '已有同名方案，请换一个名字。';
    if (error) { presetNameError(error); $('presetName').focus({preventScroll:true}); return; }
    const preset = {...captureCurrentConfig(),id:`preset_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,name,createdAt:new Date().toISOString()};
    PRESETS.push(preset); activePresetId = preset.id;
    const saved = savePresets(); renderPresetBar();
    closePresetDialog();
    toast(saved ? '当前排班已保存为方案' : '方案仅在本次打开期间有效');
  }
  $('presetForm').addEventListener('submit',event => { event.preventDefault(); submitPreset(); });
  $('presetName').addEventListener('input',() => presetNameError(''));
  $('presetName').addEventListener('keydown',event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  function applyPreset(id) {
    const preset = PRESETS.find(value => value.id === id);
    if (!preset) return;
    const saved = commitConfig(preset); closeSettings();
    toast(saved ? `已切换到「${preset.name}」` : '方案已应用，本次修改暂时无法保存');
  }
  function deletePreset(id) {
    const preset = PRESETS.find(value => value.id === id);
    if (!preset) return;
    ui.confirmAction(`删除方案「${preset.name}」？当前排班不会改变。`,() => {
      PRESETS = PRESETS.filter(value => value.id !== id);
      if (activePresetId === id) activePresetId = null;
      const saved = savePresets(); renderPresetBar(); toast(saved ? '方案已删除，当前排班保留' : '本次已移除方案，关闭后可能恢复');
      document.querySelector('[data-action="saveAsPreset"]').focus({preventScroll:true});
    });
  }
  function renderPresetBar() {
    const items = [];
    if (!activePresetId) items.push(mk('span',{cls:'preset-label',text:PRESETS.length ? '自定义排班' : '当前排班'}));
    for (const preset of PRESETS) {
      const group = mk('div',{cls:`preset-group${preset.id === activePresetId ? ' active' : ''}`});
      const apply = mk('button',{cls:'preset-btn',text:preset.name,onclick:()=>applyPreset(preset.id)});
      apply.title = `应用方案「${preset.name}」`; apply.setAttribute('aria-pressed',String(preset.id === activePresetId));
      const remove = mk('button',{cls:'preset-delete',text:'×',onclick:()=>deletePreset(preset.id)});
      remove.setAttribute('aria-label',`删除方案「${preset.name}」`);
      group.append(apply,remove); items.push(group);
    }
    $('presetBar').replaceChildren(...items);
  }

  // Settings are a separate draft. Add/remove/re-render never mutate the live schedule.
  function settingsError(message) { $('settingsError').textContent = message; $('settingsError').hidden = !message; }
  function openSettings() {
    if (ui.activeDialog === 'settingsModal') return;
    draftDefs = Core.normalizeDefs(schedule.shiftDefs);
    $('anchorDate').value = captureCurrentConfig().anchor; $('cyclePattern').value = schedule.cycle.join(' ');
    $('shiftName').value = '';
    settingsError(''); renderShiftDefsEditor(); openDialog('settingsModal');
  }
  function closeSettings() { draftDefs = null; closeDialog('settingsModal'); }
  function readDraftRows() {
    const defs = Object.create(null);
    for (const row of $('shiftDefsEditor').querySelectorAll('.shift-def-row')) {
      const name = row.dataset.shift, style = row.querySelector('select').value;
      const work = row.querySelector('[data-field="isWork"]').checked;
      const oldDef = draftDefs && Core.own(draftDefs,name) ? draftDefs[name] : null;
      defs[name] = { emoji:oldDef?.cssClass === style ? oldDef.emoji : PRESET_ICONS[style],cssClass:style,isWork:work,startTime:work ? row.querySelector('[data-field="startTime"]').value : null,endTime:work ? row.querySelector('[data-field="endTime"]').value : null,crossDay:work && row.querySelector('[data-field="crossDay"]').checked };
    }
    return defs;
  }
  function labeledInput(label, type, name, field, value) {
    const wrapper = mk('label',{text:label}), input = mk('input');
    input.type = type; input.dataset.field = field; input.setAttribute('aria-label',`${name} ${label}`);
    if (type === 'checkbox') input.checked = !!value; else input.value = value || '';
    wrapper.append(input); return [wrapper,input];
  }
  function renderShiftDefsEditor() {
    const rows = [];
    for (const [name,def] of Object.entries(draftDefs || {})) {
      const row = mk('div',{cls:'shift-def-row'}); row.dataset.shift = name;
      const select = mk('select'); select.setAttribute('aria-label',`${name} 颜色样式`);
      for (const style of CSS_PRESETS) { const option = mk('option',{text:`${PRESET_ICONS[style]} ${STYLE_NAMES[style]}`}); option.value = style; select.append(option); } select.value = def.cssClass;
      const remove = mk('button',{cls:'shift-def-delete',text:'×',onclick:()=>removeShiftDef(name)}); remove.setAttribute('aria-label',`删除班次「${name}」`);
      row.append(mk('span',{cls:'shift-def-name',text:`${def.emoji} ${name}`}),select,remove);
      const controls = mk('div',{cls:'shift-def-controls'});
      const [startLabel,start] = labeledInput('上班','time',name,'startTime',def.startTime);
      const [endLabel,end] = labeledInput('下班','time',name,'endTime',def.endTime);
      const [workLabel,work] = labeledInput('工作班次','checkbox',name,'isWork',def.isWork);
      const [crossLabel,cross] = labeledInput('跨日','checkbox',name,'crossDay',def.crossDay);
      start.disabled = end.disabled = cross.disabled = !def.isWork;
      work.addEventListener('change',() => { start.disabled = end.disabled = cross.disabled = !work.checked; if (work.checked) { start.value ||= '09:00'; end.value ||= '17:00'; } });
      controls.append(startLabel,endLabel,workLabel,crossLabel); row.append(controls); rows.push(row);
    }
    $('shiftDefsEditor').replaceChildren(...rows);
  }
  function addShiftDef() {
    if (!draftDefs) return;
    const input = $('shiftName'), name = input.value.trim();
    if (!Core.validName(name)) { settingsError('班次名称不能包含空格，且长度应为 1–40 个字符。'); input.focus({preventScroll:true}); return; }
    draftDefs = readDraftRows();
    if (Core.own(draftDefs,name)) { settingsError('这个班次已存在。'); input.focus({preventScroll:true}); return; }
    draftDefs[name] = Core.defaultDef(name); settingsError(''); renderShiftDefsEditor();
    input.value = ''; input.focus({preventScroll:true});
  }
  $('shiftName').addEventListener('keydown',event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.isComposing && event.keyCode !== 229) addShiftDef();
  });
  function removeShiftDef(name) {
    if (!draftDefs || !Core.own(draftDefs,name)) return;
    ui.confirmAction(`移除班次「${name}」及周期中的对应项？保存设置后生效。`,() => {
      if (!draftDefs) return;
      draftDefs = readDraftRows(); delete draftDefs[name];
      $('cyclePattern').value = $('cyclePattern').value.split(/\s+/).filter(value=>value && value !== name).join(' ');
      renderShiftDefsEditor();
    });
  }
  function saveSettings() {
    if (!draftDefs) return;
    const anchor = $('anchorDate').value, cycle = $('cyclePattern').value.trim().split(/\s+/).filter(Boolean);
    if (!Core.parseDate(anchor)) { settingsError('请选择有效的周期起始日期（1900–2100 年）。'); return; }
    if (!Core.validCycle(cycle)) { settingsError('周期不能为空；最多 3660 天，每个班次名称最多 40 个字符且不含空格。'); return; }
    const defs = readDraftRows();
    for (const [name,def] of Object.entries(defs)) if (def.isWork && (!Core.validTime(def.startTime) || !Core.validTime(def.endTime))) { settingsError(`请填写「${name}」的完整上下班时间。`); return; }
    const missing = [];
    for (const name of cycle) if (!Core.own(defs,name)) { defs[name] = Core.own(DEFAULT_SHIFT_DEFS,name) ? DEFAULT_SHIFT_DEFS[name] : Core.defaultDef(name); missing.push(name); }
    if (missing.length) {
      draftDefs = Core.normalizeDefs(defs); renderShiftDefsEditor(); settingsError(`已为新班次「${[...new Set(missing)].join('、')}」补充时间定义，请确认后再次保存。`); return;
    }
    const persisted = commitConfig({anchor,cycle,shiftDefs:defs}); closeSettings();
    toast(persisted ? '排班设置已保存' : '排班已更新，但浏览器暂时无法保存');
  }
  return { configKey, commitConfig, loadPresets, savePresets, syncActivePreset, saveAsPreset, presetNameError, closePresetDialog, submitPreset, applyPreset, deletePreset, renderPresetBar, settingsError, openSettings, closeSettings, readDraftRows, labeledInput, renderShiftDefsEditor, addShiftDef, removeShiftDef, saveSettings, get presets() { return PRESETS; }, get draftDefs() { return draftDefs; } };
}
