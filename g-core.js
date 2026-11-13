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
  let localHolding = false, downAt = 0, pn = 0, kaT = null, beatT = null, holdSince = 0, shakeT = null, pickBarT = null, stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  // ---- 元のCOREのドッキリ演出(持ち主の端末の中だけで起きる。通信には影響しない) ----
  const crackSvg = $('c-crack'), fxCv = $('fx'), fxCtx = fxCv.getContext('2d'), scan = $('scanlines');
  let cracks = [], fakeT = null, scareT = null, debris = [], debrisRaf = 0;
  const rr = (a, b) => a + Math.random() * (b - a);
  function genCracks(){
    crackSvg.textContent = ''; cracks = [];
    const count = 7 + Math.floor(Math.random() * 3), cx = 110, cy = 110, base = Math.random() * 360;
    for(let i = 0; i < count; i++){
      const ang = (base + (360 / count) * i + rr(-16, 16)) * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx;
      const segs = 3 + Math.floor(Math.random() * 3);
      let rad = rr(12, 26), x = cx + dx * rad, y = cy + dy * rad, d = 'M' + x.toFixed(1) + ',' + y.toFixed(1);
      for(let s = 0; s < segs; s++){ rad += rr(14, 26); const perp = rr(-13, 13); x = cx + dx * rad + px * perp; y = cy + dy * rad + py * perp; d += ' L' + x.toFixed(1) + ',' + y.toFixed(1); }
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); crackSvg.appendChild(path);
      cracks.push({ el: path, max: rr(2.0, 3.5) });
    }
  }
  function setCrack(ratio){
    ratio = Math.max(0, Math.min(1, ratio)); core.style.setProperty('--crack-ratio', ratio.toFixed(3));
    cracks.forEach(c => { c.el.style.opacity = ratio; c.el.style.strokeWidth = (c.max * ratio).toFixed(2); });
  }
  // ニセのヒビ割れ(限界とは無関係。押し始めの0.5〜0.7秒後に1回だけ光らせて脅かす)
  function cancelFake(){ if(fakeT){ clearTimeout(fakeT); fakeT = null; } }
  function scheduleFake(){
    cancelFake();
    fakeT = setTimeout(() => {
      fakeT = null;
      if(!localHolding || stopped) return;
      const level = 0.35 + Math.random() * 0.65, dur = 120 + Math.random() * 260;
      cracks.forEach(c => { if(Math.random() < 0.6){ c.el.style.opacity = level; c.el.style.strokeWidth = (c.max * level).toFixed(2); } });
      E.vibrate(20); core.dataset.fake = String((+core.dataset.fake || 0) + 1);
      later(() => { if(localHolding) setCrack(0); }, dur);
    }, 500 + Math.random() * 200);
  }
  // ドッキリ罠: 押し始めの1秒以内に、思わず離させる(約35%・種類もタイミングもランダム。限界時間とは無関係)
  function cancelScare(){ if(scareT){ clearTimeout(scareT); scareT = null; } }
  function scheduleScare(){ cancelScare(); if(Math.random() >= 0.35) return; scareT = setTimeout(doScare, 200 + Math.random() * 650); }
  function shakePulse(a){ shake(a); later(() => shake(0), 90); }
  function doScare(){
    scareT = null;
    if(!localHolding || stopped) return;
    core.dataset.scare = String((+core.dataset.scare || 0) + 1);
    const kind = Math.floor(Math.random() * 3);
    E.audio.scare(); E.vibrate([80, 30, 120]); shakePulse(34);
    if(kind === 0){ const s = $('strobe'); s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); }
    else if(kind === 1){
      setCrack(1); const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
      later(() => { if(localHolding) setCrack(0); }, 350);
    }else{
      core.style.transition = 'transform .06s ease-out'; core.style.transform = 'scale(1.18)';
      later(() => { core.style.transition = 'transform .25s ease-in'; core.style.transform = 'scale(1)'; }, 120);
      shakePulse(48);
    }
  }
  // 爆発の破片
  function resizeFx(){ const dpr = window.devicePixelRatio || 1; fxCv.width = Math.floor(window.innerWidth * dpr); fxCv.height = Math.floor(window.innerHeight * dpr); fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  function spawnDebris(){
    const r = wrap.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for(let i = 0; i < 90; i++){
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 14;
      debris.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, size: 2 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .5, life: 1, hue: Math.random() < .6 ? 12 + Math.random() * 30 : 0, dark: Math.random() < .4 });
    }
    if(!debrisRaf) debrisRaf = requestAnimationFrame(stepDebris);
  }
  function stepDebris(){
    fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    debris.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vx *= .975; p.vy = p.vy * .975 + .35; p.rot += p.vr; p.life -= .012;
      if(p.life <= 0) return;
      fxCtx.save(); fxCtx.translate(p.x, p.y); fxCtx.rotate(p.rot); fxCtx.globalAlpha = Math.max(0, p.life);
      fxCtx.fillStyle = p.dark ? '#1a1a1a' : 'hsl(' + p.hue + ',100%,55%)'; fxCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .6); fxCtx.restore();
    });
    debris = debris.filter(p => p.life > 0);
    if(debris.length) debrisRaf = requestAnimationFrame(stepDebris);
    else{ debrisRaf = 0; fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }
  function clearDebris(){ debris = []; if(debrisRaf){ cancelAnimationFrame(debrisRaf); debrisRaf = 0; } fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight); }

  function render(){
    const mine = G.holder === E.myId, hn = E.nameOf(G.holder);
    core.classList.toggle('mine', mine);
    core.classList.toggle('watch', !mine && G.ph === 'hold');
    core.classList.toggle('holding', mine && localHolding);
    $('c-top').textContent = mine ? 'あなたがコアを持っている' : hn + ' がコアを持っている';
    let hint = '';
    if(G.ph === 'idle') hint = mine ? 'コアに触れ、1.5秒以上 長押し\n離したら、次の者へ渡せ' : hn + ' が触れるのを待っている…';
    if(G.ph === 'hold') hint = mine ? (localHolding ? '長押し中……' : '離した! 判定中…') : hn + ' が長押し中…';
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
    resetLocalFx(); genCracks(); setCrack(0); resizeFx(); scan.style.display = 'block'; E.show('s-core'); render();
  }
  function resetLocalFx(keepDebris){
    clearInterval(shakeT); $('app').style.setProperty('--sx', '0px'); $('app').style.setProperty('--sy', '0px');
    core.classList.remove('burst'); $('blackout').classList.remove('on'); vignette.style.opacity = 0;
    wrap.querySelectorAll('.ring').forEach(r => r.remove());
    core.style.transition = ''; core.style.transform = ''; setCrack(0);
    if(keepDebris !== true) clearDebris();
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'st'){
      if(!['idle', 'hold', 'choose'].includes(m.ph) || !Number.isInteger(m.holder)) return;
      const prev = G.ph;
      G = { ph: m.ph, holder: m.holder, turn: Number.isInteger(m.turn) ? m.turn : 0, elig: Array.isArray(m.elig) ? m.elig.filter(Number.isInteger) : [] };
      if(m.ph === 'hold'){ if(prev !== 'hold' && !(m.holder === E.myId && !localHolding)) startBeat(); }
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
    cancelFake(); cancelScare(); setCrack(0); core.style.transition = ''; core.style.transform = '';
    if(send){
      // 押していた時間は自分のスマホで測って送る(通信の遅れで長くならないように)
      E.send({ t: 'release', n: pn, held: Math.round(performance.now() - downAt) }, true);
      stopBeat(); $('c-hint').textContent = '離した! 判定中…';
    }
  }
  const onDown = e => {
    e.preventDefault();
    if(stopped || G.holder !== E.myId || G.ph !== 'idle' || localHolding) return;
    localHolding = true; downAt = performance.now(); pn++; E.audio.init(); E.audio.startDrone(); core.classList.add('holding'); holdSince = performance.now();
    E.send({ t: 'press', n: pn }, true);
    scheduleScare(); scheduleFake();
    clearInterval(kaT); kaT = setInterval(() => E.send({ t: 'ka', n: pn }, false), 400);
  };
  const rel = e => { if(e && e.cancelable) e.preventDefault(); endLocalHold(true); };
  const noCtx = e => e.preventDefault();
  core.addEventListener('pointerdown', onDown, { passive: false });
  core.addEventListener('pointerup', rel, { passive: false });
  core.addEventListener('pointercancel', rel, { passive: false });
  core.addEventListener('pointerleave', rel, { passive: false });
  core.addEventListener('contextmenu', noCtx);

  // 結果の秒数: 「生き残った分」と「最後の長押し」を分けて、爆発までの本当の合計も出す
  function statsText(m){
    const turns = Number.isFinite(m.turns) ? m.turns : 0;
    const surv = Number.isFinite(m.sec) ? m.sec : 0, last = Number.isFinite(m.last) ? m.last : 0;
    const head = m.reason === 'early'
      ? 'ここまでの合計 ' + surv.toFixed(2) + ' 秒 ／ 最後の長押し ' + last.toFixed(2) + ' 秒(1.5秒未満)'
      : '爆発までの合計 ' + (surv + last).toFixed(2) + ' 秒\n(生き残り ' + surv.toFixed(2) + ' ＋ 最後の長押し ' + last.toFixed(2) + ')';
    return head + '\n' + turns + ' TURN 生還';
  }

  // ---- 爆発演出 ----
  function shake(a){ $('app').style.setProperty('--sx', ((Math.random() - .5) * a).toFixed(1) + 'px'); $('app').style.setProperty('--sy', ((Math.random() - .5) * a).toFixed(1) + 'px'); }
  function explode(m){
    E.audio.init(); E.audio.boom(); E.vibrate([0, 120, 50, 120, 80, 300, 100, 500, 150, 600]);
    core.classList.add('burst'); setCrack(1); spawnDebris();
    let k = 0; clearInterval(shakeT);
    shakeT = setInterval(() => { k++; shake(Math.max(3, 40 * (1 - k / 24))); if(k >= 24){ clearInterval(shakeT); shake(0); } }, 25);
    [0, 70, 140, 220].forEach(d => later(() => { const r = document.createElement('div'); r.className = 'ring'; wrap.appendChild(r); requestAnimationFrame(() => r.classList.add('go')); later(() => r.remove(), 700); }, d));
    ['strobe', 'flash'].forEach(id => { const el = $(id); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); });
    later(() => $('blackout').classList.add('on'), 280);
    later(() => {
      const me = m.loser === E.myId, ln = clean2(m.name, 8) || E.nameOf(m.loser);
      E.showResult({
        title: 'CORE CRACKED',
        reason: m.reason === 'early' ? '1.5秒に満たず、指が離れた' : 'コアが限界を超えて、弾けた',
        pen: me ? 'あなたが爆発させた' : ln + ' が爆発させた',
        lines: [],
        stats: statsText(m)
      });
      resetLocalFx(true); $('flash').classList.remove('on'); $('strobe').classList.remove('on');
    }, 1100);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'idle', sub: 'idle', holder: 0, last: -1, threshold: 0, total: 0, holdStart: 0, lastKa: 0, over: 0, turn: 0, tick: null, choose: null };
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
    H.sub = 'hold'; H.holdStart = performance.now(); H.lastKa = H.holdStart; H.over = 0;
    clearInterval(H.tick); H.tick = setInterval(hostTick, 25);
    E.hostBcast(stMsg('hold'), true);
  }
  // 持ち主との通信の往復時間(わからなければ 400ms とみなす)
  function peerRtt(){ const p = E.players().find(x => x.id === H.holder); return p && Number.isFinite(p.rtt) && p.rtt > 0 ? Math.min(p.rtt, 2000) : 400; }
  function hostTick(){
    const now = performance.now(), el = (now - H.holdStart) / 1000;
    if(H.total + el >= H.threshold){
      if(H.holder === 0){ boom(H.holder, 'limit', el); return; }
      // 参加者は「離した」が通信で遅れているだけかもしれない。少しだけ待ってから爆発させる
      if(!H.over) H.over = now;
      if(now - H.over > Math.min(1200, peerRtt() / 2 + 400)){ boom(H.holder, 'limit', (H.over - H.holdStart) / 1000); return; }
    }
    if(H.holder !== 0 && now - H.lastKa > 1600) finishHold((H.lastKa - H.holdStart) / 1000, 1.3);   // 合図が途絶えた = もう離している
  }
  // 「離した」が届いたとき。参加者は自分のスマホで測った時間を使う(通信の揺れの分だけは信じる)
  function onRelease(m){
    const arr = (performance.now() - H.holdStart) / 1000;
    if(H.holder === 0){ finishHold(arr, 1.5); return; }
    const slack = peerRtt() / 1000 + 0.5;
    const el = Number.isFinite(m.held) && m.held >= 0 ? Math.max(arr - slack, Math.min(arr + slack, m.held / 1000)) : arr;
    finishHold(el, 1.5);
  }
  function finishHold(el, minHold){
    stopTick(); H.over = 0;
    if(H.total + el >= H.threshold){ boom(H.holder, 'limit', el); return; }
    if(el < minHold){ boom(H.holder, 'early', el); return; }
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
  function boom(loser, reason, lastSec){
    if(H.phase !== 'play') return;
    H.phase = 'result'; stopTick(); clearTimeout(H.choose);
    E.hostBcast({ t: 'boom', loser, name: E.nameOf(loser), reason, turns: H.turn, sec: Math.round(H.total * 100) / 100, last: Math.round((lastSec || 0) * 100) / 100 }, true);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || H.phase !== 'play' || H.holder !== id) return;
    if(m.t === 'press'){ if(H.sub === 'idle') startHold(); else if(H.sub === 'hold') H.lastKa = performance.now(); }
    else if(m.t === 'ka'){ if(H.sub === 'hold') H.lastKa = performance.now(); else if(H.sub === 'idle') startHold(); }   // pressが落ちても、kaで開始できる
    else if(m.t === 'release'){ if(H.sub === 'hold') onRelease(m); }
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
    timers.forEach(clearTimeout); cancelScare(); cancelFake(); resetLocalFx(); scan.style.display = 'none'; $('picker').classList.remove('on');
    $('flash').classList.remove('on'); $('strobe').classList.remove('on');
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
