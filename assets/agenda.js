export function agendaTime(schedule, name) {
  return schedule.isWorkShift(name) ? schedule.shiftTimeText(name) : '当日无新班次';
}

export function bindAgendaCopy({window,ui,schedule,getSelectedDate,getMonthStart}) {
  const {document,Date} = window;
  const { $, openDialog, closeDialog, toast } = ui;
  const output = $('agendaCopyText');
  let request = 0;

  function note(start,count) {
    if (!start) return '';
    return Array.from({length:count},(_,i) => {
      const date = schedule.addDays(start,i), name = schedule.getShift(date);
      return `${schedule.formatDateISO(date)} ${schedule.getWeekdayCn(date)} · ${name} · ${agendaTime(schedule,name)}`;
    }).join('\n');
  }
  function selectText() { output.focus(); output.select(); output.setSelectionRange(0,output.value.length); }
  function close() { closeDialog('agendaCopyModal'); output.value = ''; }
  ui.onDismiss('agendaCopyModal',close);
  $('agendaCopySelect').addEventListener('click',selectText);
  $('agendaCopyClose').addEventListener('click',close);

  function bind(id,label,getText,owner = null,useShare = false) {
    const button = $(id);
    button.addEventListener('click',async () => {
      if (ui.activeDialog !== owner) return;
      const text = getText();
      if (!text) return;
      const ticket = ++request;
      button.focus({preventScroll:true});
      // A delayed permission prompt must not open a sheet over a different task or day.
      const current = () => ticket === request && ui.activeDialog === owner && !document.hidden && document.activeElement === button && text === getText();
      if (useShare && typeof window.navigator.share === 'function') {
        try { await window.navigator.share({title:label,text}); return; }
        catch (error) { if (error?.name === 'AbortError' || !current()) return; }
      }
      try {
        await window.navigator.clipboard.writeText(text);
      } catch (_) {
        if (!current()) return;
        $('agendaCopyTitle').textContent = label;
        output.rows = text.includes('\n') ? 9 : 3;
        output.value = text;
        openDialog('agendaCopyModal',{nested:!!owner}); selectText();
        return;
      }
      if (current()) toast(`已复制${label}`);
    });
  }
  bind('copyWeekAgenda','七天排班',() => getSelectedDate() ? '' : note(new Date(),7));
  bind('copyDayAgenda','当天排班',() => note(getSelectedDate(),1));
  const monthText = () => {
    const start = getMonthStart();
    return note(start,new Date(start.getFullYear(),start.getMonth() + 1,0).getDate());
  };
  bind('copyMonthAgenda','整月排班',monthText,'monthSheetModal');
  bind('shareMonthAgenda','整月排班',monthText,'monthSheetModal',true);
}
