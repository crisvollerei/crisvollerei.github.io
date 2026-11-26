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

// The month picture always uses the light palette so it stays legible in chats and photo albums.
const IMAGE_COLORS = {day:['#3f6d8c','#eef4f8'],night:['#725a93','#f3eff9'],rest:['#367150','#edf5ec'],noon:['#886225','#f9f4e6'],morning:['#246f6b','#e9f5f2'],evening:['#955072','#faf0f4']};
const IMAGE_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
function fitText(context, text, width) {
  if (context.measureText(text).width <= width) return text;
  const chars = [...text];
  while (chars.length > 1 && context.measureText(`${chars.join('')}…`).width > width) chars.pop();
  return `${chars.join('')}…`;
}
function roundedRect(context, x, y, width, height, radius) {
  context.beginPath(); context.moveTo(x + radius,y);
  context.arcTo(x + width,y,x + width,y + height,radius); context.arcTo(x + width,y + height,x,y + height,radius);
  context.arcTo(x,y + height,x,y,radius); context.arcTo(x,y,x + width,y,radius); context.closePath();
}
// Draws one month as a picture people can long-press to save or forward, without handling any files.
export function drawMonthImage(canvas, {schedule, festivals, year, month, title, today}) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成图片，请改用「复制排班文字」。');
  const first = (new Date(year,month,1).getDay() + 6) % 7, total = new Date(year,month + 1,0).getDate();
  const rows = Math.ceil((first + total) / 7), width = 1080, side = 48, gap = 10, cell = (width - side * 2 - gap * 6) / 7, top = 300;
  canvas.width = width; canvas.height = top + rows * (cell + gap) - gap + 96;
  const font = (size, weight = 400) => `${weight} ${size}px ${IMAGE_FONT}`;
  context.fillStyle = '#fbfaf7'; context.fillRect(0,0,canvas.width,canvas.height);
  context.textBaseline = 'alphabetic'; context.textAlign = 'left';
  context.fillStyle = '#73748a'; context.font = font(26); context.fillText(fitText(context,title,width - side * 2),side,74);
  context.fillStyle = '#36374d'; context.font = font(54,600); context.fillText(`${year} 年 ${month + 1} 月`,side,146);
  const counts = schedule.calculateMonthlyStats(year,month);
  const work = Object.entries(counts).reduce((sum,[name,count]) => sum + (schedule.isWorkShift(name) ? count : 0),0);
  context.fillStyle = '#5d5e74'; context.font = font(25);
  context.fillText(`工作 ${work} 天 · 休息 ${total - work} 天 · 计划工时 ${schedule.calculateWorkHours(year,month)} 小时`,side,194);
  // The legend carries the shift hours, so the picture is complete on its own.
  let x = side;
  context.font = font(21);
  for (const name of schedule.getUniqueShiftsInCycle()) {
    const def = schedule.getShiftDef(name), [color] = IMAGE_COLORS[def.cssClass] || IMAGE_COLORS.day;
    const label = fitText(context,`${name}${def.isWork ? ` ${def.startTime}–${Core.isCrossDay(def) ? '次日' : ''}${def.endTime}` : ''}`,320);
    const itemWidth = 22 + context.measureText(label).width + 26;
    if (x + itemWidth > width - side) break;
    context.fillStyle = color; roundedRect(context,x,224,13,13,4); context.fill();
    context.fillStyle = '#5d5e74'; context.fillText(label,x + 22,237); x += itemWidth;
  }
  context.textAlign = 'center'; context.font = font(22);
  ['一','二','三','四','五','六','日'].forEach((label,index) => {
    context.fillStyle = index > 4 ? '#81709f' : '#73748a';
    context.fillText(`周${label}`,side + index * (cell + gap) + cell / 2,280);
  });
  for (let day = 1; day <= total; day++) {
    const date = new Date(year,month,day), slot = first + day - 1;
    const left = side + (slot % 7) * (cell + gap), y = top + Math.floor(slot / 7) * (cell + gap);
    const name = schedule.getShift(date), def = schedule.getShiftDef(name), [color,background] = IMAGE_COLORS[def.cssClass] || IMAGE_COLORS.day;
    context.fillStyle = background; roundedRect(context,left,y,cell,cell,14); context.fill();
    if (schedule.isSameDay(date,today)) { context.strokeStyle = '#81709f'; context.lineWidth = 4; roundedRect(context,left + 2,y + 2,cell - 4,cell - 4,13); context.stroke(); }
    context.textAlign = 'left'; context.fillStyle = '#36374d'; context.font = font(28,600); context.fillText(String(day),left + 14,y + 38);
    context.textAlign = 'center'; context.fillStyle = color; context.font = font(25,600);
    context.fillText(fitText(context,name,cell - 14),left + cell / 2,y + 82);
    const festival = festivals?.getHoliday(date), term = festivals?.getSolarTerm(date), lunar = schedule.getLunarDate(date);
    const note = festival || term || (lunar.day === 1 ? lunar.monthStr : lunar.dayStr);
    if (note) { context.fillStyle = festival ? '#a8693a' : '#8a8b9e'; context.font = font(18); context.fillText(fitText(context,note,cell - 12),left + cell / 2,y + cell - 16); }
  }
  context.textAlign = 'left'; context.fillStyle = '#9a9bad'; context.font = font(19);
  context.fillText(fitText(context,`${title} · 生成于 ${schedule.formatDate(today)} · 以实际排班为准`,width - side * 2),side,canvas.height - 38);
  return canvas;
}

export function createShare({window, ui, schedule, views, personalization, festivals}) {
  const { document, Date } = window;
  const { $, toast } = ui;
  let copyRevision = 0, printTheme = null, image = null;
  const touchDevice = () => !!window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches;
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
    if (!options) { $('exportSummary').textContent = '选择开始日期后，这里会显示将要导出的内容。'; return; }
    const {work,rest,last} = summarizeExport(schedule,options.start,options.days,options.includeRest);
    $('exportSummary').textContent = `${schedule.formatDate(options.start)} 至 ${schedule.formatDate(last)} · 工作 ${work} 天 · 休息 ${rest} 天`;
    $('exportImageButton').textContent = `生成 ${options.start.getMonth() + 1} 月排班图`;
  }
  function resetText() {
    copyRevision++;
    $('exportTextOutput').value = ''; $('exportTextBox').hidden = true; $('exportTextStatus').textContent = '';
  }
  function resetImage() {
    image = null; $('exportImageBox').hidden = true; $('exportImage').removeAttribute('src'); $('exportImageHint').textContent = '';
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
    resetText(); resetImage(); showError(); $('exportStatus').textContent = '';
    renderSummary();
    ui.openDialog('exportModal');
  }
  function closeExport() { resetText(); resetImage(); showError(); ui.closeDialog('exportModal'); }
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
    try { await window.navigator.share({title:`${title()} · 排班`,text}); }
    catch (error) { if (error?.name !== 'AbortError' && ui.activeDialog === 'exportModal') await copyScheduleText(); }
  }
  function imageFile() {
    const [meta,data] = image.dataURL.split(','), bytes = Uint8Array.from(window.atob(data),char => char.charCodeAt(0));
    return new window.File([bytes],image.name,{type:meta.slice(5,meta.indexOf(';'))});
  }
  function createMonthImage() {
    if (ui.activeDialog !== 'exportModal') return;
    const options = readOptions();
    if (!options) return;
    showError();
    const year = options.start.getFullYear(), month = options.start.getMonth();
    try {
      const canvas = drawMonthImage(document.createElement('canvas'),{schedule,festivals,year,month,title:title(),today:new Date()});
      image = {dataURL:canvas.toDataURL('image/png'),name:`${title()}-${year}年${month + 1}月排班.png`};
    } catch (error) { resetImage(); showError(error?.message || '当前浏览器无法生成图片，请改用「复制排班文字」。'); return; }
    $('exportImage').src = image.dataURL;
    $('exportImage').alt = `${year}年${month + 1}月排班图`;
    $('exportImageBox').hidden = false;
    let shareFiles = false;
    try { shareFiles = canShare() && !!window.navigator.canShare?.({files:[imageFile()]}); } catch (_) {}
    $('exportImageShare').hidden = !shareFiles;
    $('exportImageHint').textContent = touchDevice() ? '长按图片，即可保存到相册或直接转发。' : '可以右键图片复制或另存，也可以点「下载图片」。';
    $('exportImage').scrollIntoView?.({block:'nearest'});
  }
  async function shareMonthImage() {
    if (ui.activeDialog !== 'exportModal' || !image) return;
    try { await window.navigator.share({files:[imageFile()],title:`${title()} · 排班图`}); }
    catch (error) { if (error?.name !== 'AbortError' && ui.activeDialog === 'exportModal') $('exportImageHint').textContent = '暂时无法打开系统分享，请长按图片保存或转发。'; }
  }
  function downloadMonthImage() {
    if (ui.activeDialog !== 'exportModal' || !image) return;
    try {
      const link = document.createElement('a'); link.href = image.dataURL; link.download = image.name;
      document.body.append(link); link.click(); link.remove();
    } catch (_) { $('exportImageHint').textContent = '当前浏览器无法下载，请右键或长按图片保存。'; }
  }
  function printCalendar() {
    if (ui.activeDialog === 'exportModal') closeExport();
    window.setTimeout(() => { try { window.print?.(); } catch (_) { toast('当前浏览器不支持打印，请使用系统浏览器打开'); } },80);
  }
  // Printing always uses the light palette so paper output stays legible and saves ink.
  window.addEventListener('beforeprint',() => {
    if (printTheme !== null) return;
    printTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
  });
  window.addEventListener('afterprint',() => {
    if (printTheme === null) return;
    document.documentElement.dataset.theme = printTheme; printTheme = null;
  });
  for (const id of ['exportStart','exportDays','exportIncludeRest','exportAlarm']) {
    $(id).addEventListener('input',() => { showError(); resetText(); if (id === 'exportStart') resetImage(); renderSummary(); });
    $(id).addEventListener('change',() => { renderSummary(); });
  }
  ui.onDismiss('exportModal',closeExport);
  return {openExport,closeExport,downloadCalendar,copyScheduleText,shareScheduleText,selectExportText,createMonthImage,shareMonthImage,downloadMonthImage,printCalendar,renderSummary};
}
