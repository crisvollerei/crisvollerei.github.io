import { buildSheetMonth } from './sheet-model.js?v=93ae5d2227c5';
import { bindSheetImage } from './sheet-image.js?v=6a66eae15140';

export function bindMonthSheet({window,ui,schedule,festivals,storage,getMonthStart,getImageTitle}) {
  const { $, mk, openDialog, closeDialog } = ui;
  const { document } = window, paper = $('monthSheetPaper');
  const legend = $('monthSheetLegend'), calendar = paper.querySelector('table');
  const swatches = [...$('monthSheetStyles').querySelectorAll('button[data-paper]')];
  const styleKey = 'qingzheng-month-sheet-style';
  let startOverride = null, renderedKey, model, printState = null;
  const getStart = () => startOverride ?? getMonthStart();
  const signature = $('sheetImageSignature');
  const pictures = bindSheetImage({window,ui,paper,getModel:() => render(),getSignature:() => signature.getAttribute('aria-checked') === 'true' ? getImageTitle() : ''});
  signature.addEventListener('click',() => {
    if (ui.activeDialog !== 'monthSheetModal') return;
    pictures.invalidate();
    signature.setAttribute('aria-checked',String(signature.getAttribute('aria-checked') !== 'true'));
  });
  function selectPaper(button,save = false) {
    pictures.invalidate();
    const style = button.dataset.paper, cards = style !== 'plain';
    paper.dataset.paper = style;
    paper.classList.toggle('sheet-cards',cards);
    paper.classList.toggle('sheet-illustrated',cards && style !== 'classic');
    if ((cards ? calendar.previousElementSibling : calendar.nextElementSibling) !== legend) {
      if (cards) calendar.before(legend); else calendar.after(legend);
      if (model) renderLegend();
    }
    for (const item of swatches) {
      item.setAttribute('aria-checked',String(item === button));
      item.tabIndex = item === button ? 0 : -1;
    }
    if (save) storage.set(styleKey,button.dataset.paper);
  }
  function renderLegend() {
    const cards = paper.classList.contains('sheet-cards');
    legend.replaceChildren(...model.shifts.map(shift => {
      const item = mk('li'), time = cards ? shift.cardTime : shift.time;
      item.dataset.tone = shift.tone;
      if (shift.code) item.append(mk('b',{cls:'sheet-code',text:shift.code}));
      item.append(mk('strong',{text:shift.name}));
      if (time) item.append(mk('span',{text:time}));
      return item;
    }));
  }
  const saved = storage.get(styleKey);
  selectPaper(swatches.find(button => button.dataset.paper === saved) || swatches[0]);
  for (const [index,button] of swatches.entries()) {
    button.addEventListener('click',() => {
      if (ui.activeDialog === 'monthSheetModal' && button.dataset.paper !== paper.dataset.paper) {
        selectPaper(button,true); $('monthPrintStatus').textContent = '';
      }
    });
    button.addEventListener('keydown',event => {
      if (ui.activeDialog !== 'monthSheetModal' || event.altKey || event.ctrlKey || event.metaKey) return;
      const count = swatches.length;
      const next = {ArrowLeft:(index+count-1)%count,ArrowRight:(index+1)%count,ArrowUp:(index+count-1)%count,ArrowDown:(index+1)%count,Home:0,End:count-1}[event.key];
      if (!Number.isInteger(next)) return;
      event.preventDefault(); swatches[next].focus(); swatches[next].click();
    });
  }
  function render() {
    const first = getStart(), today = new window.Date();
    const key = `${first.getFullYear()}/${first.getMonth()}/${schedule.revision}/${schedule.formatDateISO(today)}`;
    if (renderedKey === key) return model;
    model = buildSheetMonth({schedule,festivals,first,today});
    const rows = [];
    for (let week = 0; week < model.weeks; week++) {
      const row = mk('tr');
      for (let column = 0; column < 7; column++) {
        const cell = mk('td'), day = model.days[week * 7 + column - model.offset];
        if (day) {
          const {shift} = day, time = mk('time',{text:day.day});
          cell.dataset.tone = shift.tone; time.dateTime = day.iso;
          if (day.today) { cell.dataset.today = ''; time.setAttribute('aria-current','date'); }
          cell.append(time,mk('strong',{text:shift.code ?? shift.name}));
          if (shift.cross) cell.append(mk('small',{text:'跨日'}));
          if (day.note) cell.append(mk('span',{cls:day.holiday ? 'sheet-note holiday-note' : 'sheet-note',text:day.note}));
          cell.title = [shift.name,shift.time,day.note].filter(Boolean).join(' · ');
          if (shift.code) cell.setAttribute('aria-label',`${day.day} 日 · ${cell.title}`);
        }
        row.append(cell);
      }
      rows.push(row);
    }
    $('sheetYear').textContent = `${model.year} 年 `;
    $('sheetMonth').textContent = `${model.month + 1} 月`;
    $('sheetDateline').textContent = model.dateline;
    $('monthSheetLength').textContent = `共 ${model.days.length} 天 · 按班次开始日期`;
    $('sheetWorkRest').textContent = model.summary;
    $('sheetFooter').textContent = model.footer;
    $('monthSheetRows').replaceChildren(...rows);
    renderLegend();
    renderedKey = key; return model;
  }
  function open(date,{nested = false} = {}) {
    if (ui.activeDialog && !(nested && ui.activeDialog === 'exportModal')) return;
    startOverride = date ? new window.Date(date.getFullYear(),date.getMonth(),1) : null;
    render(); $('monthPrintStatus').textContent = '';
    signature.setAttribute('aria-checked','false');
    $('shareMonthAgenda').hidden = typeof window.navigator.share !== 'function';
    openDialog('monthSheetModal',{nested}); paper.scrollTop = 0;
  }
  function close() { pictures.invalidate(); startOverride = null; closeDialog('monthSheetModal'); }
  ui.onDismiss('monthSheetModal',close);
  $('openMonthSheet').addEventListener('click',event => {
    if (ui.activeDialog) return;
    event.currentTarget.focus({preventScroll:true}); open();
  });
  $('closeMonthSheet').addEventListener('click',close);
  $('printMonthSheet').addEventListener('click',() => {
    if (ui.activeDialog !== 'monthSheetModal') return;
    try { render(); window.print(); }
    catch (_) { $('monthPrintStatus').textContent = '当前浏览器无法打开打印窗口，可生成图片或复制整月排班。'; }
  });
  // Ctrl+P must work even with a draft open. Restore the visitor's tab title and theme afterwards.
  window.addEventListener('beforeprint',() => {
    render();
    printState ??= {title:document.title,theme:document.documentElement.dataset.theme};
    document.title = model.title; document.documentElement.dataset.theme = 'light';
  });
  window.addEventListener('afterprint',() => {
    if (!printState) return;
    document.title = printState.title; document.documentElement.dataset.theme = printState.theme; printState = null;
  });
  return {open,getStart};
}
