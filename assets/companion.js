
export function createCompanion({window, ui, schedule}) {
  let companionTheme = '';
  let companionMessageId = 'status';
  let companionQuip = '';
  let companionTurn = 0;
  let companionFactIndex = 0;
  let companionQuipBag = [];
  let lastCompanionKey = '';
  const COMPANION_QUIPS = {
    light: [
      '今日份的魔法：把待办做少一点，把快乐留多一点。',
      '排班可以循环，今天的小开心不许重复。',
      '我负责发呆，你负责偶尔伸个懒腰。',
      '生活不是进度条，不必每一格都填满。',
      '认真工作，也要认真挑选下班后的第一口好吃的。',
      '戳我不会缩短工时，但可以短暂打断一下无聊。'
    ],
    dark: [
      '大肥鱼正在待机。脑袋空空，也是一种节能模式。',
      '今天的烦恼先靠岸，明天再决定要不要打捞。',
      '摸鱼雷达启动……先确认一下，水喝了吗？',
      '海浪都知道一来一回，你也记得忙一会儿、歇一会儿。',
      '如果事情做不完，就先把肩膀放松一点。',
      '收到一次戳戳，返还一小口快乐。'
    ]
  };
  const { document, Date } = window;
  const { $, mk, animateElement, reveal } = ui;
  const { getShiftDef, getShift, addDays, getEffectiveShiftInfo, getNextWorkDelay, getDaysToRest } = schedule;
  function formatCompanionDuration(ms) {
    if (ms < 60000) return '不到1分钟';
    const minutes = Math.floor(ms / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
    return `${days ? `${days}天` : ''}${hours % 24 ? `${hours % 24}小时` : ''}${minutes % 60 ? `${minutes % 60}分钟` : ''}`;
  }
  function companionFacts(now, info, next) {
    const night = companionTheme === 'dark';
    const working = info.start && now >= info.start && now < info.end;
    const facts = [working
      ? {id:'status',before:night ? '再过 ' : '离下班还有 ',time:formatCompanionDuration(info.end - now),after:night ? ' 就下班，收好今天的辛苦。' : '，把这一班慢慢走完。'}
      : next !== null
        ? {id:'status',before:'距离下次上班还有 ',time:formatCompanionDuration(next),after:night ? '，先让脑袋靠个岸。' : '，这会儿的时间留一点给自己。'}
        : {id:'status',before:night ? '这轮排班没有工作班，安心漂浮，不用等开工。' : '这轮排班没有工作班，可以安心安排自己的小日子。'}];
    const tomorrow = addDays(now,1), name = getShift(tomorrow), def = getShiftDef(name);
    facts.push(def.isWork
      ? {id:'tomorrow',before:`明天是「${name}」，`,time:def.startTime,after:night ? ' 开工。出发前，记得带上好心情。' : ' 上班，出门前不妨留一点余量。'}
      : {id:'tomorrow',before:`明天是「${name}」。${night ? '可以提前想想，快乐往哪儿漂。' : '给期待中的小事留个位置吧。'}`});
    const rest = getDaysToRest(now);
    if (rest === 0) facts.push(working
      ? {id:'rest',before:'今天的休息，要等这班结束。还有 ',time:formatCompanionDuration(info.end - now),after:'，再坚持一小段。'}
      : {id:'rest',before:night ? '今天的排班是休息。不必赶浪，慢慢漂就好。' : '今天的排班是休息。给自己放个小小的空白吧。'});
    else if (rest > 0) facts.push({id:'rest',before:'下个休息日在 ',time:`${rest}天后`,after:night ? '，快乐已经在向你游过来。' : '，先给那天留一点期待。'});
    return facts;
  }
  function updateCompanion(now = new Date(), info = getEffectiveShiftInfo(now), next = getNextWorkDelay(now)) {
    const facts = companionFacts(now,info,next);
    const message = companionMessageId === 'quip' ? {before:companionQuip} : facts.find(fact => fact.id === companionMessageId) || facts[0];
    const key = JSON.stringify(message);
    if (key === lastCompanionKey) return;
    lastCompanionKey = key;
    const parts = [document.createTextNode(message.before)];
    if (message.time) {
      const time = mk('strong',{cls:`companion-time${message.time.length > 10 ? ' is-long' : ''}`});
      for (const unit of message.time.match(/不到1分钟|\d+天后|\d+天|\d+小时|\d+分钟|\d{2}:\d{2}/g) || [message.time]) {
        time.append(mk('span',{cls:'companion-time-unit',text:unit}));
      }
      parts.push(time);
    }
    if (message.after) parts.push(document.createTextNode(message.after));
    $('companionMessage').replaceChildren(...parts);
    $('companion').dataset.message = companionMessageId;
  }
  function syncCompanionTheme(theme) {
    if (companionTheme === theme) return;
    companionTheme = theme;
    for (const image of document.querySelectorAll(`[data-image-theme="${theme}"]`)) {
      if (!image.hasAttribute('src')) image.src = image.dataset.src;
    }
    companionMessageId = 'status'; companionTurn = 0; companionFactIndex = 0; companionQuipBag = [];
    const name = theme === 'dark' ? '大肥鱼' : '大肥龙';
    $('companionName').textContent = name;
    $('companionAnnouncement').textContent = '';
    $('companionDay').hidden = theme !== 'light';
    $('companionNight').hidden = theme !== 'dark';
    $('companionCharacter').setAttribute('aria-label',`戳戳${name}，换一句话`);
    updateCompanion();
  }
  function setCompanionCollapsed(collapsed) {
    $('companion').classList.toggle('is-collapsed',collapsed);
    $('companionBubble').hidden = collapsed;
    $('companionToggle').setAttribute('aria-expanded',String(!collapsed));
    $('companionToggle').setAttribute('aria-label',collapsed ? '展开碎碎念' : '收起碎碎念');
    $('companionToggle').replaceChildren(document.createTextNode(collapsed ? '聊两句 ' : '收起 '),mk('span',{text:collapsed ? '⌄' : '⌃'}));
    $('companionToggle').lastElementChild.setAttribute('aria-hidden','true');
  }
  function refreshCompanion() {
    setCompanionCollapsed(false);
    companionTurn++;
    if (companionTurn % 2) {
      if (!companionQuipBag.length) {
        companionQuipBag = [...COMPANION_QUIPS[companionTheme]];
        for (let i = companionQuipBag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [companionQuipBag[i],companionQuipBag[j]] = [companionQuipBag[j],companionQuipBag[i]];
        }
        if (companionQuipBag[0] === companionQuip) companionQuipBag.push(companionQuipBag.shift());
      }
      companionMessageId = 'quip'; companionQuip = companionQuipBag.shift();
    } else {
      const now = new Date(), facts = companionFacts(now,getEffectiveShiftInfo(now),getNextWorkDelay(now));
      companionFactIndex = (companionFactIndex + 1) % facts.length;
      companionMessageId = facts[companionFactIndex].id;
    }
    updateCompanion();
    // Only intentional refreshes announce copy; live time changes stay quiet.
    $('companionAnnouncement').textContent = `${$('companionName').textContent}说：${$('companionMessage').textContent}`;
    animateElement($('companionCharacter'),[
      {transform:'translateY(0) scale(1) rotate(0)'},
      {transform:'translateY(3px) scale(.91,1.04) rotate(-5deg)',offset:.24},
      {transform:'translateY(-8px) scale(1.04,.97) rotate(5deg)',offset:.55},
      {transform:'translateY(0) scale(1) rotate(0)'}
    ],{duration:440});
    for (const spark of document.querySelectorAll('.companion-spark')) animateElement(spark,[
      {opacity:0,transform:'translateY(6px) scale(.5)'},
      {opacity:1,transform:'translateY(-4px) scale(1.15)',offset:.4},
      {opacity:0,transform:'translateY(-20px) scale(.8)'}
    ],{duration:520});
    reveal($('companionMessage'));
  }
  $('companionCharacter').addEventListener('click',refreshCompanion);
  $('companionToggle').addEventListener('click',() => setCompanionCollapsed(!$('companionBubble').hidden));
  return { updateCompanion, syncCompanionTheme, companionFacts };
}
