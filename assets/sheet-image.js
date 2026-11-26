const sans = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
const serif = 'Georgia,"Songti SC","SimSun",serif';
const weekdays = ['周一','周二','周三','周四','周五','周六','周日'];
const font = (size,weight = 400,family = sans) => `${weight} ${size}px ${family}`;

function wrapText(ctx,text,width) {
  const lines = []; let line = '';
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ''; }
    line += char;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawSheetImage(canvas,model,style,colors,art,signature = '') {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片，可复制整月排班或打印 PDF。');
  const box = (x,y,w,h,color) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h); };
  function text(label,x,y,color,type,align = 'left',maxWidth) {
    ctx.fillStyle = color; ctx.font = type; ctx.textAlign = align;
    if (maxWidth) ctx.fillText(label,x,y,maxWidth); else ctx.fillText(label,x,y);
  }
  const pen = {ctx,box,text};
  if (style === 'plain') drawPlain(canvas,model,colors,signature,pen);
  else drawCards(canvas,model,style,colors,art,signature,pen);
  return canvas;
}

function drawPlain(canvas,model,colors,signature,{ctx,box,text}) {
  const width = 1120, side = 42, inner = width - side * 2, col = inner / 7;
  const head = 144, tableTop = head + 98, rowH = 113, gridEnd = tableTop + model.weeks * rowH;
  const ink = colors('--sheet-ink'), muted = colors('--sheet-muted'), accent = colors('--sheet-accent'), rule = colors('--sheet-rule');
  // Calculate the legend height first. Never truncate the last shift or ellipsize a long name.
  const gap = 26, legendColumns = 2, itemW = (inner - gap) / legendColumns;
  ctx.font = font(21,600);
  const legend = model.shifts.map(s => ({s,lines:wrapText(ctx,`${s.code ? s.code+'  ' : ''}${s.name}`,itemW - 26)}));
  let cursor = gridEnd + 68;
  for (let i = 0; i < legend.length; i += legendColumns) {
    const group = legend.slice(i,i + legendColumns);
    for (const entry of group) entry.y = cursor;
    cursor += Math.max(...group.map(entry => entry.lines.length)) * 27 + 39;
  }
  canvas.width = width; canvas.height = cursor + (signature ? 89 : 55);
  box(0,0,width,canvas.height,colors('--sheet-bg')); box(0,0,width,head,colors('--sheet-head'));
  const headingInk = colors('--sheet-head-ink');
  text(model.dateline,side,44,headingInk,font(21,600,serif));
  text(`${model.year} 年 ${model.month + 1} 月`,side,95,headingInk,font(54,600));
  text('排班表',side,head - 15,headingInk,font(21,500));
  box(0,head,width,2,accent);
  text(model.summary,side,head + 40,ink,font(24,500));
  box(side,tableTop - 41,inner,41,colors('--sheet-bar'));
  weekdays.forEach((label,i) => text(label,side + col * (i + .5),tableTop - 13,colors('--sheet-bar-ink'),font(21,600),'center'));
  for (let r = 0; r < model.weeks; r++) {
    for (let c = 0; c < 7; c++) {
      const x = side + c * col, y = tableTop + r * rowH, d = model.days[r * 7 + c - model.offset];
      if (!d) { box(x,y,col,rowH,colors('--sheet-empty')); continue; }
      if (d.today) { ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.strokeRect(x + 3,y + 3,col - 6,rowH - 6); }
      text(String(d.day),x + 11,y + 33,ink,font(31,600,serif));
      if (d.shift.cross) text('跨日',x + col - 11,y + 30,muted,font(17),'right');
      text(d.shift.code ?? d.shift.name,x + 12,y + 68,ink,font(24,600),'left',col - 30);
      if (d.note) text(d.note,x + 12,y + 96,muted,font(18),'left',col - 22);
    }
  }
  for (let i = 0; i <= model.weeks; i++) box(side,tableTop + i * rowH,inner,1,rule);
  for (let i = 0; i <= 7; i++) box(side + i * col,tableTop,1,model.weeks * rowH,rule);
  text('班次与时间',side,gridEnd + 40,muted,font(18,600));
  for (const [i,{s,lines,y}] of legend.entries()) {
    const x = side + (i % legendColumns) * (itemW + gap);
    box(x,y - 15,5,18,ink);
    lines.forEach((line,j) => text(line,x + 15,y + j * 27,ink,font(21,600)));
    text(s.time,x + 15,y + lines.length * 27,muted,font(20));
  }
  box(side,cursor,inner,1,rule);
  text(`按班次开始日期 · ${model.days.length} 天`,side,cursor + 32,muted,font(17));
  text(`生成于 ${model.generated}`,width - side,cursor + 32,muted,font(17),'right');
  if (signature) text(signature,side,cursor + 66,ink,font(22,600),'left',inner);
}

// Measure the whole legend before sizing the canvas. Wrap between shifts first;
// even a full-width name can wrap inside its item without splitting the time range.
function cardLegend(ctx,shifts,width) {
  ctx.font = font(21);
  let x = 0, y = 0, rowHeight = 0;
  const items = shifts.map(shift => {
    const lines = wrapText(ctx,(shift.code ? shift.code + ' ' : '') + shift.name,width - 22);
    if (shift.cardTime) {
      const last = lines.length - 1, withTime = `${lines[last]} ${shift.cardTime}`;
      if (ctx.measureText(withTime).width <= width - 22) lines[last] = withTime;
      else lines.push(shift.cardTime);
    }
    const itemWidth = 22 + Math.max(...lines.map(line => ctx.measureText(line).width));
    if (x && x + itemWidth > width) { x = 0; y += rowHeight + 6; rowHeight = 0; }
    const item = {shift,lines,x,y};
    x += itemWidth + 26; rowHeight = Math.max(rowHeight,lines.length * 28);
    return item;
  });
  return {items,height:y + rowHeight};
}

function roundedPath(ctx,x,y,w,h,r) {
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function drawCards(canvas,model,style,colors,art,signature,{ctx,box,text}) {
  const width = 1080, side = 48, gap = 10, inner = width - 2 * side, cell = (inner - 6 * gap) / 7;
  const legend = cardLegend(ctx,model.shifts,inner), legendY = 237;
  const top = legendY + legend.height + 35, end = top + model.weeks * (cell + gap) - gap;
  canvas.width = width; canvas.height = end + 96 + (signature ? 36 : 0);
  const ink = colors('--sheet-ink'), muted = colors('--sheet-muted'), note = colors('--sheet-note'), accent = colors('--sheet-accent');
  const month = `${model.year} 年 ${model.month + 1} 月`;
  box(0,0,width,canvas.height,colors('--sheet-bg'));
  if (style === 'classic') {
    text('清蒸排班',side,74,note,font(26));
    text(month,side,146,ink,font(54,600));
  } else {
    const head = 153, headInk = colors('--sheet-head-ink');
    box(0,0,width,head,colors('--sheet-head'));
    if (style === 'orbit') {
      ctx.fillStyle = '#f1e9d4'; ctx.beginPath(); ctx.moveTo(width-369,0); ctx.lineTo(width-306,0);
      ctx.lineTo(width-403,head); ctx.lineTo(width-466,head); ctx.closePath(); ctx.fill();
    }
    if (art) ctx.drawImage(art,width-426,head-151,426,151);
    box(0,head,width,style === 'orbit' ? 4 : 2,accent);
    if (style === 'bloom') box(side,21,58,2,accent);
    text(model.dateline,side,55,headInk,font(21,600,style === 'orbit' ? 'Consolas,monospace' : serif));
    text(month,side,119,headInk,font(52,600,style === 'bloom' ? serif : sans));
  }
  text(model.summary,side,194,muted,font(25));
  for (const {shift,lines,x,y} of legend.items) {
    ctx.fillStyle = colors(`--tone-${shift.tone}`); roundedPath(ctx,side+x,legendY+y-13,13,13,4); ctx.fill();
    lines.forEach((line,i) => text(line,side+x+22,legendY+y+i*28,muted,font(21)));
  }
  weekdays.forEach((day,c) => text(day,side+c*(cell+gap)+cell/2,top-20,c > 4 ? colors('--sheet-weekend') : note,font(22),'center'));
  const dayFont = style === 'bloom' ? `italic ${font(29,600,serif)}` : font(28,600,style === 'orbit' ? 'Consolas,monospace' : sans);
  model.days.forEach((d,i) => {
    const slot = i + model.offset, x = side + (slot % 7) * (cell+gap), y = top + Math.floor(slot / 7) * (cell+gap);
    const {shift} = d;
    ctx.fillStyle = colors(`--wash-${shift.tone}`); roundedPath(ctx,x,y,cell,cell,14); ctx.fill();
    if (d.today) { ctx.strokeStyle = accent; ctx.lineWidth = 4; roundedPath(ctx,x+2,y+2,cell-4,cell-4,12); ctx.stroke(); }
    text(String(d.day),x+14,y+38,ink,dayFont);
    if (shift.cross) text('跨日',x+cell-12,y+31,note,font(15),'right');
    text(shift.code ?? shift.name,x+cell/2,y+82,colors(`--tone-${shift.tone}`),font(25,600),'center',cell-14);
    if (d.note) text(d.note,x+cell/2,y+cell-16,d.holiday ? colors('--sheet-holiday') : note,font(18),'center',cell-12);
  });
  text(model.footer,side,end+58,note,font(19));
  if (signature) text(signature,side,end+94,ink,font(22,600),'left',inner);
}

export function bindSheetImage({window,ui,paper,getModel,getSignature}) {
  const { $,openDialog,closeDialog } = ui, {document,navigator} = window;
  const output = $('exportImage'), hint = $('exportImageHint'), button = $('createSheetImage');
  let revision = 0, image = null, busy = false;
  function invalidate() { revision++; busy = false; button.removeAttribute('aria-busy'); }
  function close() {
    image = null; output.removeAttribute('src'); hint.textContent = ''; closeDialog('monthImageModal');
  }
  function asFile(url,name) {
    const bytes = Uint8Array.from(window.atob(url.split(',')[1]),c => c.charCodeAt(0));
    return new window.File([bytes],name,{type:'image/png'});
  }
  async function generate() {
    if (ui.activeDialog !== 'monthSheetModal' || busy) return;
    const ticket = ++revision, style = paper.dataset.paper, model = getModel();
    const current = () => revision === ticket && ui.activeDialog === 'monthSheetModal';
    busy = true; button.setAttribute('aria-busy','true'); button.focus({preventScroll:true});
    $('monthPrintStatus').textContent = '';
    try {
      const art = paper.querySelector(`img[data-art="${style}"]`);
      if (art?.decode) await art.decode();
      if (!current()) return;
      const computed = window.getComputedStyle(paper);
      const canvas = drawSheetImage(document.createElement('canvas'),model,style,name => computed.getPropertyValue(name).trim(),art,getSignature());
      const url = canvas.toDataURL('image/png');
      if (!url.startsWith('data:image/png;base64,')) throw new Error();
      const label = $('monthSheetStyles').querySelector('[aria-checked="true"]').textContent.trim();
      const name = `${model.year}年${model.month + 1}月排班-${label}.png`;
      let file = null;
      try {
        if (typeof navigator.share === 'function' && navigator.canShare) {
          const candidate = asFile(url,name); if (navigator.canShare({files:[candidate]})) file = candidate;
        }
      } catch (_) { /* Native sharing is optional; the PNG is still available. */ }
      image = {url,name,file}; output.src = url; output.alt = `${model.title}（${label}）`;
      $('exportImageTitleText').textContent = `${model.month + 1} 月排班图 · ${label}`;
      $('exportImageShare').hidden = !file;
      $('downloadMonthImage').classList.toggle('button-primary',!file);
      $('downloadMonthImage').classList.toggle('button-secondary',!!file);
      hint.textContent = window.matchMedia?.('(pointer: coarse)').matches ? '可长按图片保存到相册或转发。' : 'PNG 图片可直接下载，或右键复制。';
      openDialog('monthImageModal',{nested:true}); output.parentElement.scrollTop = 0;
    } catch (_) { if (current()) $('monthPrintStatus').textContent = '当前浏览器无法生成图片，可复制整月排班或打印 PDF。'; }
    finally { if (ticket === revision) { busy = false; button.removeAttribute('aria-busy'); } }
  }
  button.addEventListener('click',generate);
  ui.onDismiss('monthImageModal',close);
  $('closeSheetImage').addEventListener('click',close); $('backToSheet').addEventListener('click',close);
  $('exportImageShare').addEventListener('click',async () => {
    const currentImage = image;
    if (ui.activeDialog !== 'monthImageModal' || !currentImage?.file) return;
    try { await navigator.share({files:[currentImage.file],title:output.alt}); }
    catch (error) { if (error?.name !== 'AbortError' && image === currentImage) hint.textContent = '暂时无法打开系统分享，请长按图片或下载 PNG。'; }
  });
  $('downloadMonthImage').addEventListener('click',() => {
    if (ui.activeDialog !== 'monthImageModal' || !image) return;
    const link = document.createElement('a'); link.href = image.url; link.download = image.name;
    try { document.body.append(link); link.click(); }
    catch (_) { hint.textContent = '当前浏览器无法下载，请右键或长按图片保存。'; }
    finally { link.remove(); }
  });
  return {invalidate};
}
