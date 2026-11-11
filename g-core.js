/* CORE オンライン(ホストが審判)
 * - 爆発の限界時間はホストの中だけ。通信には載せない
 * - 参加者は長押し中、400msごとに「まだ押してる」合図(ka)を送る。途絶えたらホストが離したものとして扱う
 *   (中継サーバーでメッセージが落ちても、切れても、ゲームが固まらない)
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
window.NomiGames.core = { id: 'core', name: 'CORE', make(E){
  const $ = E.$, core = $('c-core'), vignette = $('vignette'), wrap = $('c-wrap');
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const rndI = n => Math.floor(rndF() * n);
  const clean2 = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').slice(0, n || 20);

  // ---------------- 参加者側(ホスト自身もここを通る) ----------------
  let G = { ph: 'idle', holder: -1, turn: 0, elig: [] };
  let localHolding = false, pn = 0, kaT = null, beatT = null, holdSince = 0, shakeT = null, pickBarT = null, stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  function render(){
    const mine = G.holder === E.myId, hn = E.nameOf(G.holder);
    core.classList.toggle('mine', mine);
    core.classList.toggle('watch', !mine && G.ph === 'hold');
    core.classList.toggle('holding', mine && localHolding);
    $('c-top').textContent = mine ? 'あなたがコアを持っている' : hn + ' がコアを持っている';
    let hint = '';
    if(G.ph === 'idle') hint = mine ? 'コアに触れ、1秒以上 長押し\n離したら、次の者へ渡せ' : hn + ' が触れるのを待っている…';
    if(G.ph === 'hold') hint = mine ? '長押し中……' : hn + ' が長押し中…';
    if(G.ph === 'choose') hint = mine ? '' : hn + ' が渡す相手を選んでいる…';
    $('c-hint').textContent = hint;
    $('c-turn').textContent = 'TURN ' + G.turn;
    $('picker').classList.toggle('on', mine && G.ph === 'choose');
  }
  function startBeat(){
    stopBeat(); holdSince = performance.now();
    const loop = () => {
      const held = (performance.now() - holdSince) / 1000, mine = G.holder === E.myId;
      E.audio.heartbeat(mine ? .6 : .28);
      core.animate([{ transform: 'scale(1)' }, { transform: 'scale(' + (1 + Math.min(.05, .02 + held * .004)) + ')' }, { transform: 'scale(1)' }], { duration: 300 });
      E.vibrate(mine ? 35 : 20);
      if(mine) E.audio.updateDrone(held);
      vignette.style.opacity = mine ? Math.min(1, held / 9).toFixed(3) : 0;
      beatT = setTimeout(loop, Math.max(330, 620 - held * 32));
    };
    loop();
  }
  function stopBeat(){ clearTimeout(beatT); beatT = null; vignette.style.opacity = 0; E.audio.stopDrone(); }
  function openPicker(elig){
    const list = $('pk-list'); list.textContent = '';
    $('pk-sub').textContent = '押したら、その人にコアが渡る(9秒でランダム)';
    elig.forEach(id => {
      const b = document.createElement('button'); b.textContent = E.nameOf(id);
      b.addEventListener('click', () => { $('picker').classList.remove('on'); E.send({ t: 'pass', to: id }, true); }, { once: true });
      list.appendChild(b);
    });
    const bar = $('pk-bar'); bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
    void bar.offsetWidth; bar.style.transition = 'transform 9.5s linear'; bar.style.transform = 'scaleX(0)';
  }

  function onBegin(){
    G = { ph: 'idle', holder: -1, turn: 0, elig: [] }; localHolding = false; stopped = false;
    resetLocalFx(); E.show('s-core'); render();
  }
  function resetLocalFx(){
    clearInterval(shakeT); $('app').style.setProperty('--sx', '0px'); $('app').style.setProperty('--sy', '0px');
    core.classList.remove('burst'); $('blackout').classList.remove('on'); vignette.style.opacity = 0;
    wrap.querySelectorAll('.ring').forEach(r => r.remove());
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'st'){
      if(!['idle', 'hold', 'choose'].includes(m.ph) || !Number.isInteger(m.holder)) return;
      const prev = G.ph;
      G = { ph: m.ph, holder: m.holder, turn: Number.isInteger(m.turn) ? m.turn : 0, elig: Array.isArray(m.elig) ? m.elig.filter(Number.isInteger) : [] };
      if(m.ph === 'hold'){ if(prev !== 'hold') startBeat(); }
      else { stopBeat(); if(m.holder !== E.myId) endLocalHold(false); }
      if(m.ph === 'choose' && m.holder === E.myId){ openPicker(G.elig); E.vibrate([60, 40, 60]); }
      if(m.ph === 'idle' && m.holder === E.myId) E.vibrate([80, 40, 80]);
      render();
    }else if(m.t === 'boom'){
      if(!Number.isInteger(m.loser)) return;
      G.ph = 'result'; stopBeat(); endLocalHold(false); $('picker').classList.remove('on');
      explode(m);
    }
  }

  // ---- 自分の長押し ----
  function endLocalHold(send){
    if(!localHolding) return;
    localHolding = false; clearInterval(kaT); kaT = null; core.classList.remove('holding'); E.audio.stopDrone();
    if(send) E.send({ t: 'release', n: pn }, true);
  }
  const onDown = e => {
    e.preventDefault();
    if(stopped || G.holder !== E.myId || G.ph !== 'idle' || localHolding) return;
    localHolding = true; pn++; E.audio.init(); E.audio.startDrone(); core.classList.add('holding'); holdSince = performance.now();
    E.send({ t: 'press', n: pn }, true);
    clearInterval(kaT); kaT = setInterval(() => E.send({ t: 'ka', n: pn }, false), 400);
  };
  const rel = e => { if(e && e.cancelable) e.preventDefault(); endLocalHold(true); };
  const noCtx = e => e.preventDefault();
  core.addEventListener('pointerdown', onDown, { passive: false });
  core.addEventListener('pointerup', rel, { passive: false });
  core.addEventListener('pointercancel', rel, { passive: false });
  core.addEventListener('pointerleave', rel, { passive: false });
  core.addEventListener('contextmenu', noCtx);

  // ---- 爆発演出 ----
  function shake(a){ $('app').style.setProperty('--sx', ((Math.random() - .5) * a).toFixed(1) + 'px'); $('app').style.setProperty('--sy', ((Math.random() - .5) * a).toFixed(1) + 'px'); }
  function explode(m){
    E.audio.init(); E.audio.boom(); E.vibrate([0, 120, 50, 120, 80, 300, 100, 500, 150, 600]);
    core.classList.add('burst');
    let k = 0; clearInterval(shakeT);
    shakeT = setInterval(() => { k++; shake(Math.max(3, 40 * (1 - k / 24))); if(k >= 24){ clearInterval(shakeT); shake(0); } }, 25);
    [0, 70, 140, 220].forEach(d => later(() => { const r = document.createElement('div'); r.className = 'ring'; wrap.appendChild(r); requestAnimationFrame(() => r.classList.add('go')); later(() => r.remove(), 700); }, d));
    ['strobe', 'flash'].forEach(id => { const el = $(id); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); });
    later(() => $('blackout').classList.add('on'), 280);
    later(() => {
      const me = m.loser === E.myId, ln = clean2(m.name, 8) || E.nameOf(m.loser);
      E.showResult({
        title: 'CORE CRACKED',
        reason: m.reason === 'early' ? '1秒に満たず、指が離れた' : 'コアが限界を超えて、弾けた',
        pen: (me ? '💀 あなたが爆発させた!\n' : '💀 ' + ln + ' が爆発させた!\n') + E.penalty(2),
        lines: [],
        stats: (Number.isFinite(m.turns) ? m.turns : 0) + ' TURN 生還 ／ 累計 ' + (Number.isFinite(m.sec) ? m.sec.toFixed(2) : '0.00') + ' SEC'
      });
      resetLocalFx(); $('flash').classList.remove('on'); $('strobe').classList.remove('on');
    }, 1100);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'idle', sub: 'idle', holder: 0, last: -1, threshold: 0, total: 0, holdStart: 0, lastKa: 0, turn: 0, tick: null, choose: null };
  const ids = () => E.players().map(p => p.id);
  function eligible(){
    let a = ids().filter(id => id !== H.holder && id !== H.last);
    if(!a.length) a = ids().filter(id => id !== H.holder);
    return a;
  }
  const stMsg = ph => ({ t: 'st', ph, holder: H.holder, turn: H.turn, elig: ph === 'choose' ? eligible() : [] });
  function hostStart(){
    H.phase = 'play'; H.sub = 'idle'; H.last = -1; H.turn = 0; H.total = 0;
    H.threshold = 7 + rndF() * 23;                  // 秘密。ホストの中だけにあり、通信には載せない
    const a = ids(); H.holder = a[rndI(a.length)];
    E.hostBcast(stMsg('idle'), true);
  }
  function stopTick(){ clearInterval(H.tick); H.tick = null; }
  function startHold(){
    H.sub = 'hold'; H.holdStart = performance.now(); H.lastKa = H.holdStart;
    clearInterval(H.tick); H.tick = setInterval(hostTick, 25);
    E.hostBcast(stMsg('hold'), true);
  }
  function hostTick(){
    const now = performance.now();
    if(H.total + (now - H.holdStart) / 1000 >= H.threshold){ boom(H.holder, 'limit'); return; }
    if(H.holder !== 0 && now - H.lastKa > 1600) doRelease(H.lastKa);   // 合図が途絶えた = もう離している
  }
  function doRelease(endT){
    stopTick();
    const el = ((endT || performance.now()) - H.holdStart) / 1000;
    const minHold = H.holder === 0 ? 1.0 : 0.8;      // 参加者は通信の遅れの揺れがあるので少し余裕をもたせる
    if(el < minHold){ boom(H.holder, 'early'); return; }
    H.total += el; H.turn++; H.sub = 'choose';
    E.hostBcast(stMsg('choose'), true);
    clearTimeout(H.choose);
    H.choose = setTimeout(() => { const e = eligible(); if(e.length) doPass(e[rndI(e.length)]); }, 9500);
  }
  function doPass(to){
    if(H.phase !== 'play' || H.sub !== 'choose' || !eligible().includes(to)) return;
    clearTimeout(H.choose);
    H.last = H.holder; H.holder = to; H.sub = 'idle';
    E.hostBcast(stMsg('idle'), true);
  }
  function boom(loser, reason){
    if(H.phase !== 'play') return;
    H.phase = 'result'; stopTick(); clearTimeout(H.choose);
    E.hostBcast({ t: 'boom', loser, name: E.nameOf(loser), reason, turns: H.turn, sec: Math.round(H.total * 100) / 100 }, true);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || H.phase !== 'play' || H.holder !== id) return;
    if(m.t === 'press'){ if(H.sub === 'idle') startHold(); else if(H.sub === 'hold') H.lastKa = performance.now(); }
    else if(m.t === 'ka'){ if(H.sub === 'hold') H.lastKa = performance.now(); else if(H.sub === 'idle') startHold(); }   // pressが落ちても、kaで開始できる
    else if(m.t === 'release'){ if(H.sub === 'hold') doRelease(performance.now()); }
    else if(m.t === 'pass'){ if(H.sub === 'choose' && Number.isInteger(m.to)) doPass(m.to); }
  }
  function hostOnLeave(id){
    if(H.phase !== 'play' || H.holder !== id) return;
    if(H.sub === 'hold'){ stopTick(); H.total += (H.lastKa - H.holdStart) / 1000; }
    clearTimeout(H.choose);
    const e = ids().filter(x => x !== id);
    if(e.length < 1) return;
    H.last = -1; H.holder = e[rndI(e.length)]; H.sub = 'idle';
    E.hostBcast(stMsg('idle'), true);
  }

  function stop(){
    stopped = true; stopBeat(); endLocalHold(false); clearInterval(shakeT); stopTick(); clearTimeout(H.choose);
    core.removeEventListener('pointerdown', onDown); core.removeEventListener('pointerup', rel);
    core.removeEventListener('pointercancel', rel); core.removeEventListener('pointerleave', rel); core.removeEventListener('contextmenu', noCtx);
    timers.forEach(clearTimeout); resetLocalFx(); $('picker').classList.remove('on');
    $('flash').classList.remove('on'); $('strobe').classList.remove('on');
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
