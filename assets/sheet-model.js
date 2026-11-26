// One calendar for the paper and the picture; only their layout differs.
export function buildSheetMonth({schedule,festivals,first,today}) {
  const year = first.getFullYear(), month = first.getMonth();
  const length = new first.constructor(year,month + 1,0).getDate();
  const offset = (first.getDay() + 6) % 7, shifts = new Map();
  let work = 0;
  const days = Array.from({length},(_,index) => {
    const date = schedule.addDays(first,index), name = schedule.getShift(date);
    if (!shifts.has(name)) {
      const def = schedule.getShiftDef(name), cross = schedule.isCrossDayShift(name);
      const cardTime = def.isWork ? `${def.startTime}–${cross ? '次日' : ''}${def.endTime}` : (/^休息(日)?$/.test(name) ? '' : '休息日');
      shifts.set(name,{name,code:null,tone:def.cssClass,work:def.isWork,cross,cardTime,time:def.isWork ? schedule.shiftTimeText(name) : '休息日'});
    }
    const shift = shifts.get(name), holiday = festivals.getHoliday(date), term = festivals.getSolarTerm(date), lunar = schedule.getLunarDate(date);
    if (shift.work) work++;
    return {day:index + 1,iso:schedule.formatDateISO(date),shift,today:schedule.isSameDay(date,today),holiday:!!holiday,note:holiday || term || (lunar.day === 1 ? lunar.monthStr : lunar.dayStr) || ''};
  });
  const reserved = new Set([...shifts.keys()].map(name => name.toUpperCase()));
  // Keep the legend in cycle order, even when the first of the month is a rest day.
  const ordered = schedule.getUniqueShiftsInCycle().filter(name => shifts.has(name)).map(name => shifts.get(name));
  let serial = 0;
  for (const shift of ordered) if ([...shift.name].length > 5) {
    do { shift.code = `S${String(++serial).padStart(2,'0')}`; } while (reserved.has(shift.code));
  }
  const generated = schedule.formatDateISO(today);
  return {year,month,offset,days,weeks:Math.ceil((offset + length) / 7),shifts:ordered,
    title:`${year} 年 ${month + 1} 月排班表`, dateline:`${year} / ${first.toLocaleString('en',{month:'long'}).toUpperCase()}`,
    summary:`工作 ${work} 天 · 休息 ${length - work} 天 · 计划工时 ${schedule.calculateWorkHours(year,month)} 小时`,generated,
    footer:`按班次开始日期 · 生成于 ${generated} · 以实际排班为准`};
}
