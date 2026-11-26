import Core from './schedule-core.js?v=13e89d9a7889';

// Calendar export and plain-text sharing. Everything is generated locally.
export const EXPORT_RANGES = [30,60,90,180,365];
export const EXPORT_ALARMS = [0,15,30,60,120];
const pad = value => String(value).padStart(2,'0');
const compactDate = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
const localStamp = date => `${compactDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
const utcStamp = date => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const WEEKDAYS = ['周日','周一','周二','周三','周四','周五','周六'];

export function escapeICSText(value) {
  return String(value).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
}
// RFC 5545 limits content lines to 75 octets; never split a UTF-8 character.
export function foldICSLine(line) {
  const parts = [];
  let current = '', bytes = 0;
  for (const char of line) {
    const code = char.codePointAt(0), size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    const limit = parts.length ? 74 : 75;
    if (bytes + size > limit) { parts.push(current); current = ''; bytes = 0; }
    current += char; bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
function exportDays(schedule, start, days) {
  return Array.from({length:days},(_,index) => {
    const date = schedule.addDays(start,index), name = schedule.getShift(date);
    return {date,name,def:schedule.getShiftDef(name),times:schedule.getShiftTimes(date),position:schedule.getCycleIndex(date) + 1};
  });
}
export function summarizeExport(schedule, start, days, includeRest) {
  const list = exportDays(schedule,start,days);
  const work = list.filter(day => day.times).length;
  return {work,rest:list.length - work,events:includeRest ? list.length : work,first:list[0]?.date,last:list.at(-1)?.date};
}
export function buildICS({schedule, start, days, includeRest = false, alarm = 0, now = new Date(), title = '清蒸排班'}) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Qingzheng//Shift Calendar//ZH','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(title)}`];
  const stamp = utcStamp(now), length = schedule.cycle.length;
  for (const {date,name,def,times,position} of exportDays(schedule,start,days)) {
    if (!times && !includeRest) continue;
    // One stable identifier per civil date lets calendar apps update a re-exported day.
    lines.push('BEGIN:VEVENT',`UID:qingzheng-${compactDate(date)}@crisvollerei.github.io`,`DTSTAMP:${stamp}`);
    if (times) {
      lines.push(`DTSTART:${localStamp(times.start)}`,`DTEND:${localStamp(times.end)}`,`SUMMARY:${escapeICSText(name)}`,
        `DESCRIPTION:${escapeICSText(`${def.startTime}–${Core.isCrossDay(def) ? '次日 ' : ''}${def.endTime} · 周期第 ${position} / ${length} 天 · 来自${title}`)}`,
        'TRANSP:OPAQUE');
      if (alarm > 0) lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escapeICSText(`${name} 即将开始`)}`,`TRIGGER:-PT${alarm}M`,'END:VALARM');
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(date)}`,`DTEND;VALUE=DATE:${compactDate(schedule.addDays(date,1))}`,
        `SUMMARY:${escapeICSText(name)}`,`DESCRIPTION:${escapeICSText(`周期第 ${position} / ${length} 天 · 来自${title}`)}`,'TRANSP:TRANSPARENT');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldICSLine).join('\r\n') + '\r\n';
}
export function buildScheduleText({schedule, start, days, title = '清蒸排班'}) {
  const list = exportDays(schedule,start,days), last = list.at(-1).date;
  const span = date => `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  const rows = list.map(({date,name,def}) => {
    const time = def.isWork ? `  ${def.startTime}–${Core.isCrossDay(def) ? '次日 ' : ''}${def.endTime}` : '';
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${WEEKDAYS[date.getDay()]}  ${name}${time}`;
  });
  return [`${title} · ${span(list[0].date)} 至 ${span(last)}`,...rows].join('\n');
}

export function createShare({window, ui, schedule, views, personalization}) {
  const { document, Date } = window;
  const { $ } = ui;
  let copyRevision = 0;
  const canShare = () => typeof window.navigator.share === 'function';
  function title() { return personalization?.title || '清蒸排班'; }
  function showError(message = '', field = null) {
    $('exportError').textContent = message; $('exportError').hidden = !message;
    for (const input of [$('exportStart'),$('exportDays')]) input.removeAttribute('aria-invalid');
    if (message && field) { field.setAttribute('aria-invalid','true'); field.focus(); }
  }
  function readOptions({focus = true} = {}) {
    const start = Core.parseDate($('exportStart').value), days = Number($('exportDays').value);
    if (!start) { if (focus) showError('请选择有效的开始日期（1900–2100 年）。',$('exportStart')); return null; }
    if (!EXPORT_RANGES.includes(days)) { if (focus) showError('请选择导出的天数。',$('exportDays')); return null; }
    const alarm = Number($('exportAlarm').value);
    return {start,days,includeRest:$('exportIncludeRest').checked,alarm:EXPORT_ALARMS.includes(alarm) ? alarm : 0};
  }
  function renderSummary() {
    const options = readOptions({focus:false});
    $('exportMonthLabel').textContent = options ? `预览 ${options.start.getMonth() + 1} 月排班图` : '预览月历';
    if (!options) { $('exportSummary').textContent = '请选择有效的日期和范围。'; return; }
    const {work,rest,last} = summarizeExport(schedule,options.start,options.days,options.includeRest);
    $('exportSummary').textContent = `${schedule.formatDate(options.start)} 至 ${schedule.formatDate(last)} · 工作 ${work} 天 · 休息 ${rest} 天`;
  }
  function resetText() {
    copyRevision++;
    $('exportTextOutput').value = ''; $('exportTextBox').hidden = true; $('exportTextStatus').textContent = '';
  }
  function openExport() {
    if (ui.activeDialog === 'exportModal') return;
    // Start from the inspected month when browsing ahead, otherwise from today.
    const today = new Date(), viewed = new Date(views.viewYear,views.viewMonth,1);
    const start = viewed > today ? viewed : today;
    $('exportStart').value = schedule.formatDateISO(start);
    if (!EXPORT_RANGES.includes(Number($('exportDays').value))) $('exportDays').value = '90';
    // The system share sheet reaches chats and notes directly; copying stays as the universal fallback.
    $('exportShareText').hidden = !canShare();
    $('exportCopyText').className = `button ${canShare() ? 'button-secondary' : 'button-primary'}`;
    resetText(); showError(); $('exportStatus').textContent = '';
    renderSummary();
    ui.openDialog('exportModal');
  }
  function closeExport() { resetText(); showError(); ui.closeDialog('exportModal'); }
  function downloadCalendar() {
    if (ui.activeDialog !== 'exportModal') return;
    const options = readOptions();
    if (!options) return;
    showError();
    const text = buildICS({schedule,...options,now:new Date(),title:title()});
    try {
      const blob = new window.Blob([text],{type:'text/calendar;charset=utf-8'});
      const url = window.URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `${title()}-日历-${schedule.formatDateISO(options.start)}.ics`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url),30000);
      $('exportStatus').textContent = '已生成日历文件（.ics）。打开下载的文件，即可导入系统日历。';
    } catch (_) { showError('当前浏览器无法下载文件，请改用「复制排班文字」或「生成月历图片」。'); }
  }
  function selectExportText() {
    const output = $('exportTextOutput');
    if (ui.activeDialog !== 'exportModal' || !output.value) return;
    output.focus(); output.select(); output.setSelectionRange(0,output.value.length); output.scrollTop = 0;
    $('exportTextStatus').textContent = '已全选，请长按文本或使用系统菜单复制。';
  }
  async function copyScheduleText() {
    if (ui.activeDialog !== 'exportModal') return;
    const options = readOptions();
    if (!options) return;
    showError();
    const revision = ++copyRevision, text = buildScheduleText({schedule,...options,title:title()});
    $('exportTextOutput').value = text; $('exportTextBox').hidden = false;
    $('exportTextStatus').textContent = '正在尝试复制…';
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText(text);
      if (revision !== copyRevision || ui.activeDialog !== 'exportModal') return;
      $('exportTextStatus').textContent = `已复制 ${options.days} 天的安排，可以直接粘贴到聊天或备忘录。`;
    } catch (_) {
      if (revision !== copyRevision || ui.activeDialog !== 'exportModal') return;
      selectExportText();
      $('exportTextStatus').textContent = '浏览器未允许自动复制，已全选下方文本，请长按或使用系统菜单复制。';
    }
  }
  async function shareScheduleText() {
    if (ui.activeDialog !== 'exportModal' || !canShare()) return;
    const options = readOptions();
    if (!options) return;
    showError();
    const text = buildScheduleText({schedule,...options,title:title()});
    const revision = ++copyRevision;
    try { await window.navigator.share({title:`${title()} · 排班`,text}); }
    catch (error) { if (error?.name !== 'AbortError' && revision === copyRevision && ui.activeDialog === 'exportModal') await copyScheduleText(); }
  }
  function previewExportMonth() {
    if (ui.activeDialog !== 'exportModal') return;
    const options = readOptions();
    if (!options) return;
    showError(); $('exportImageButton').focus({preventScroll:true});
    views.monthSheet.open(options.start,{nested:true});
  }
  for (const id of ['exportStart','exportDays','exportIncludeRest','exportAlarm']) {
    const update = () => { showError(); resetText(); renderSummary(); };
    $(id).addEventListener('input',update);
    $(id).addEventListener('change',update);
  }
  ui.onDismiss('exportModal',closeExport);
  return {openExport,closeExport,downloadCalendar,copyScheduleText,shareScheduleText,selectExportText,previewExportMonth,renderSummary};
}
