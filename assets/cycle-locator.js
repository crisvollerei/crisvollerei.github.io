import Core from './schedule-core.js?v=13e89d9a7889';

export function createCycleLocator({window,ui,schedule,applyAnchor}) {
  const { $, mk } = ui;
  const ranges = $('cycleLocatorRange'), days = $('cycleLocatorDay'), number = $('cycleTodayPosition');
  const pageSize = 32;
  let entries = [], pattern = null, shownPage = -1, position = -1;
  function option(text,value) { const node = mk('option',{text}); node.value = value; return node; }
  function showPage(page) {
    if (page !== shownPage) {
      const from = page * pageSize, options = [option('选择周期日','')];
      options[0].disabled = true;
      for (let i = from; i < Math.min(from + pageSize,entries.length); i++) options.push(option(`第 ${i + 1} 天 · ${entries[i]}`,i));
      days.replaceChildren(...options); shownPage = page;
    }
    ranges.value = String(page);
    days.value = position >= 0 && Math.floor(position / pageSize) === page ? String(position) : '';
  }
  ranges.addEventListener('change',() => showPage(Number(ranges.value)));
  function setPosition(index) {
    if (ui.activeDialog !== 'settingsModal' || !Number.isInteger(index) || index < 0 || index >= entries.length) return;
    // Use local calendar dates, not elapsed milliseconds or yesterday's active night shift.
    const anchor = schedule.formatDateISO(schedule.addDays(new window.Date(),-index));
    if (!Core.parseDate(anchor)) {
      showPage(shownPage); $('cycleLocatorStatus').textContent = '推算的起始日期不在 1900 至 2100 年内。'; return;
    }
    applyAnchor(anchor);
  }
  days.addEventListener('change',() => { if (days.value !== '') setPosition(Number(days.value)); });
  number.addEventListener('input',() => setPosition(number.valueAsNumber - 1));
  const displayNumber = () => { number.value = position < 0 ? '' : String(position + 1); };
  number.addEventListener('blur',displayNumber);
  function render(cycle,anchor,valid) {
    const key = valid ? cycle.join(' ') : '', changed = key !== pattern;
    entries = valid ? cycle : [];
    if (changed) {
      pattern = key; shownPage = -1;
      const pages = Math.ceil(entries.length / pageSize);
      ranges.replaceChildren(...(pages > 1 ? Array.from({length:pages},(_,p) => option(`第 ${p * pageSize + 1} 至 ${Math.min((p + 1) * pageSize,entries.length)} 天`,p)) : []));
    }
    $('cycleLocatorRangeField').hidden = entries.length <= pageSize;
    days.disabled = number.disabled = !valid;
    number.max = String(Math.max(1,entries.length));
    const today = new window.Date();
    position = valid && anchor ? Core.cycleIndex(today,anchor,entries) : -1;
    if (window.document.activeElement !== number) displayNumber();
    $('cycleTodayShift').textContent = position < 0 ? '' : `今天是「${entries[position]}」`;
    showPage(position < 0 ? 0 : Math.floor(position / pageSize));
    const status = !valid ? '需要有效的周期顺序。' : !anchor ? '尚未定位起始日期。' : `起始日期：${schedule.formatDateISO(anchor)}`;
    if ($('cycleLocatorStatus').textContent !== status) $('cycleLocatorStatus').textContent = status;
    const strip = $('cycleLocatorPreview'); strip.hidden = position < 0;
    strip.replaceChildren(...(position < 0 ? [] : ['昨天','今天','明天'].map((label,i) => {
      const date = schedule.addDays(today,i - 1), index = Core.cycleIndex(date,anchor,entries);
      const item = mk('li'); if (i === 1) item.setAttribute('aria-current','date');
      const time = mk('time',{text:`${label} ${date.getMonth()+1}/${date.getDate()}`}); time.dateTime = schedule.formatDateISO(date);
      item.append(time,mk('strong',{text:entries[index]}),mk('small',{text:`周期第 ${index + 1} 天`})); return item;
    })));
  }
  return {render};
}
