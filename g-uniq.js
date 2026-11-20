/* 数字かぶり オンライン(ホストが審判)
 *
 * ルール
 *  1. 全員が 1〜人数 の数字カードを1枚ずつ持つ
 *  2. 毎ターン、10秒以内に1枚えらんで、全員いっせいに出す
 *  3. ほかの人とかぶっていない数字のうち、いちばん大きい数字を出した人が勝ち抜け
 *  4. 出したカードは、このゲームではもう使えない
 *  5. 全員かぶって、だれも抜けられなかったら、カードを手札にもどしてやり直し
 *  6. 10秒以内にえらばなかった人は、そのターンは出さない(カードも減らない)
 *  7. 抜けた順に順位がつく。最後に残った人がビリ
 *
 * シミュレーション(ランダムに出す人どうし): 2人=約2ターン、4人=約4〜5ターン、8人=約7〜8ターン
 *   → 1ゲーム だいたい30秒〜2分
 *
 * 公平さ: だれが何をえらんだかはホストだけが持ち、公開まで通信に載せない。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const PICK_MS = 10000;      // 1ターンの考える時間
const MAX_TURNS = 40;       // 念のための上限(全員がずっと出さないとき)。これを過ぎたら、残りの人は同じ順位
const SHOW_MS = 4200;       // 公開の演出の長さ(ホストも参加者も同じ)

window.NomiGames.uniq = { id: 'uniq', name: '数字かぶり', make(E){
  const $ = E.$, PF = E.fx;
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const okIds = a => Array.isArray(a) ? a.filter(Number.isInteger).slice(0, 8) : [];

  // ---------------- 参加者側 ----------------
  let ph = 'wait', turn = 0, alive = [], outs = [], hands = new Map(), submitted = [], N = 0;
  let sel = null, sent = false, dl = 0, barT = 0;

  function chips(){
    const box = $('u-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span'), oi = outs.indexOf(p.id);
      const done = ph === 'pick' && submitted.includes(p.id);
      c.className = 'chip' + (oi >= 0 ? ' gone' : done ? ' on' : '');
      c.textContent = oi >= 0 ? (oi + 1) + '位 ' + p.name : (done ? '✓ ' : '') + p.name;
      box.appendChild(c);
    });
  }
  function say(big, sub){ $('u-big').textContent = big || ''; $('u-sub').textContent = sub || ''; }
  function onBegin(){
    stopped = false; ph = 'wait'; turn = 0; alive = []; outs = []; hands = new Map(); submitted = []; sel = null; sent = false;
    $('u-top').textContent = 'UNIQUE — 数字かぶり'; $('u-rows').textContent = ''; $('u-hand').textContent = '';
    $('u-pick').style.display = 'none'; $('u-bar').style.visibility = 'hidden';
    chips(); say('準備中…', ''); E.show('s-uniq');
    PF.load(); PF.show(true, { amb: [0xc6f432, 0xe2fa94, 0xffffff] });
  }

  // 残っている人の手札の一覧(出したカードは全員に見えているので、残りもわかる)
  function handRows(){
    const box = $('u-rows'); box.textContent = '';
    alive.forEach(id => {
      const d = document.createElement('div'); if(id === E.myId) d.classList.add('me');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = E.nameOf(id) + (ph === 'pick' && submitted.includes(id) ? '  ✓' : '');
      b.className = 'cs'; b.textContent = (hands.get(id) || []).join(' ');
      d.appendChild(a); d.appendChild(b); box.appendChild(d);
    });
  }
  function mkHand(){
    const box = $('u-hand'); box.textContent = '';
    const mine = hands.get(E.myId) || [];
    for(let v = 1; v <= N; v++){
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ucard'; b.textContent = String(v);
      if(!mine.includes(v)){ b.disabled = true; b.classList.add('used'); }
      else b.addEventListener('click', () => {
        if(ph !== 'pick' || sent) return;
        sel = v; E.audio.init(); E.audio.beep(440 + v * 40, .05, .14); E.vibrate(15); refresh();
      });
      b.dataset.v = v; box.appendChild(b);
    }
  }
  function refresh(){
    document.querySelectorAll('#u-hand .ucard').forEach(b => b.classList.toggle('sel', Number(b.dataset.v) === sel));
    $('u-ok').disabled = sent || sel === null;
    if(!sent) $('u-hint').textContent = sel === null ? 'カードをタップしてえらぶ' : sel + ' を出す?(10秒たつと、えらんでいるカードが出るよ)';
  }
  function submit(){
    if(sent || sel === null || ph !== 'pick') return;
    sent = true; E.send({ t: 'pk', r: turn, v: sel }, true);
    $('u-ok').textContent = '決定ずみ!'; $('u-ok').disabled = true; $('u-pick').classList.add('locked');
    $('u-hint').textContent = 'みんなを待ってるよ…'; E.vibrate(30); E.audio.beep(660, .1, .2); refresh();
  }
  $('u-ok').onclick = submit;

  function startPick(m){
    ph = 'pick'; submitted = []; sel = null; sent = false;
    $('u-top').textContent = 'TURN ' + turn + '  ／  残り ' + alive.length + '人';
    $('u-pick').classList.remove('locked'); $('u-bar').style.visibility = 'visible';
    chips(); handRows();
    if(!alive.includes(E.myId)){
      $('u-pick').style.display = 'none';
      const oi = outs.indexOf(E.myId);
      say(oi >= 0 ? (oi + 1) + '位で抜けた!' : '観戦中', 'みんながえらんでるよ');
    }else{
      $('u-pick').style.display = 'flex'; $('u-ok').textContent = '決定!';
      say('', 'かぶらない いちばん大きい数字で 抜けろ!');
      mkHand(); refresh();
    }
    const ms = Number.isFinite(m.ms) && m.ms > 0 && m.ms <= 60000 ? m.ms : PICK_MS;
    dl = performance.now() + ms;
    clearInterval(barT);
    barT = setInterval(() => {
      if(stopped || ph !== 'pick'){ clearInterval(barT); return; }
      const left = dl - performance.now();
      $('u-bar').firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / ms)).toFixed(3) + ')';
      if(left < 400 && !sent && sel !== null) submit();          // 時間ぎれ直前に、えらんでいたカードは出す
    }, 100);
    timers.push(barT);
    E.vibrate(40);
  }

  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'trn' && Number.isInteger(m.r) && Number.isInteger(m.n) && m.n >= 2 && m.n <= 8 && Array.isArray(m.hs)){
      turn = m.r; N = m.n; alive = okIds(m.alive); outs = okIds(m.out);
      hands = new Map();
      m.hs.slice(0, 8).forEach(x => { if(x && Number.isInteger(x.id) && Array.isArray(x.h)) hands.set(x.id, x.h.filter(v => Number.isInteger(v) && v >= 1 && v <= N).slice(0, 8)); });
      startPick(m);
    }else if(m.t === 'prog' && m.r === turn){ submitted = okIds(m.ids); chips(); handRows(); }
    else if(m.t === 'res' && Number.isInteger(m.r)){ showRes(m); }
  }

  // ---- 公開 ----
  function showRes(m){
    if(m.early){ ph = 'end'; clearInterval(barT); showFinal(m); return; }       // 途中で人が抜けて決着
    if(!Array.isArray(m.rows) || !Number.isInteger(m.win)) return;
    ph = 'reveal'; clearInterval(barT); chips();
    const rows = m.rows.filter(x => x && Number.isInteger(x.id) && Number.isInteger(x.v) && x.v >= 0 && x.v <= 8).slice(0, 8);
    const cnt = new Map(); rows.forEach(x => { if(x.v > 0) cnt.set(x.v, (cnt.get(x.v) || 0) + 1); });
    $('u-pick').style.display = 'none'; $('u-bar').style.visibility = 'hidden';
    const box = $('u-rows'); box.textContent = '';
    const els = new Map();
    const at = (ms, fn) => later(() => { if(!stopped) fn(); }, ms);
    say('せーの…', ''); E.audio.beep(392, .12, .22); E.vibrate(20);
    // 大きい数字の順にならべる(出さなかった人は最後)
    rows.slice().sort((a, b) => b.v - a.v).forEach(x => {
      const d = document.createElement('div'); if(x.id === E.myId) d.classList.add('me');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = E.nameOf(x.id); b.className = 'cv'; b.textContent = '?';
      d.appendChild(a); d.appendChild(b); box.appendChild(d); els.set(x.id, { d, b });
    });
    at(900, () => {
      say('オープン!', ''); E.audio.beep(988, .22, .28); E.vibrate([0, 60]);
      PF.slam('OPEN!', { color: 0xc6f432, size: 64 });
      rows.forEach((x, i) => {
        const e = els.get(x.id); if(!e) return;
        e.b.textContent = x.v > 0 ? String(x.v) : '出さなかった';
        e.d.classList.add('pop');
        if(x.v === 0) e.d.classList.add('none');
        else if(cnt.get(x.v) > 1) e.d.classList.add('dup');
        later(() => PF.pop(e.d, { color: 0xc6f432, power: .7 }), 60 + i * 50);
      });
    });
    at(2100, () => {
      const dups = Array.from(cnt.keys()).filter(v => cnt.get(v) > 1).sort((a, b) => b - a);
      if(m.win >= 0){
        const e = els.get(m.win), place = Number.isInteger(m.pl) ? m.pl : outs.length + 1;
        if(e){ e.d.classList.add('win'); PF.rowIn(e.d, 'win'); }
        say((m.win === E.myId ? 'あなた' : E.nameOf(m.win)) + ' 抜け!  ' + place + '位', dups.length ? dups.join('・') + ' はかぶり' : '');
        E.audio.beep(1175, .2, .3); E.vibrate(m.win === E.myId ? [0, 80, 40, 160] : [0, 60]);
        PF.slam(place + '位!', { color: 0xffd60a, size: 56, y: .3 });
      }else{
        say('全員かぶり!', 'カードを手札にもどして、やり直し');
        E.audio.beep(260, .3, .25); E.vibrate([0, 150]);
        PF.slam('やり直し', { color: 0xff453a, size: 52, y: .3 });
      }
    });
    if(m.over) at(SHOW_MS, () => { ph = 'end'; showFinal(m); });
  }
  function showFinal(m){
    const order = okIds(m.out), rest = okIds(m.rest);
    if(!order.length && !rest.length) return;
    const lines = order.map((id, i) => ({ a: (i + 1) + '位  ' + E.nameOf(id), b: 'TURN ' + (Array.isArray(m.at) && Number.isInteger(m.at[i]) ? m.at[i] : '?') + ' で抜け', cls: i === 0 ? 'win' : '' }));
    rest.forEach(id => lines.push({ a: (order.length + 1) + '位  ' + E.nameOf(id), b: rest.length > 1 ? '決着つかず' : 'ビリ', cls: 'lose' }));
    const last = rest.length === 1 ? rest[0] : -1;
    const pen = last < 0 ? '最後まで決まらなかった' : last === E.myId ? 'あなたがビリ' : E.nameOf(last) + ' がビリ';
    later(() => { PF.confetti(100); const r = $('r-lines').firstElementChild; if(r && order.length) PF.rowIn(r, 'win'); }, 200);
    E.showResult({
      title: 'UNIQUE',
      reason: (Number.isInteger(m.r) ? m.r : turn) + 'ターンで決着(カード 1〜' + N + ')',
      pen, lines,
      stats: 'ほかの人とかぶらない、いちばん大きい数字を出した人が抜ける。\n出したカードは、もう使えない。'
    });
    if(last === E.myId){ E.audio.scare(); E.vibrate([0, 200, 80, 400]); }
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'wait', turn: 0, n: 0, alive: [], hands: new Map(), out: [], at: [], picks: new Map(), fin: null, nxt: null };
  const present = () => E.players().map(p => p.id);
  function hostStart(){
    const ids = present();
    H.n = ids.length; H.alive = ids.slice(); H.out = []; H.at = []; H.turn = 0;
    H.hands = new Map(ids.map(id => [id, Array.from({ length: H.n }, (_, i) => i + 1)]));
    startTurn();
  }
  function startTurn(){
    const here = present();
    H.alive = H.alive.filter(id => here.includes(id));
    if(H.alive.length < 2){ endGame(); return; }
    H.turn++; H.picks = new Map(); H.phase = 'pick';
    E.hostBcast({ t: 'trn', r: H.turn, n: H.n, alive: H.alive, out: H.out, hs: H.alive.map(id => ({ id, h: H.hands.get(id) })), ms: PICK_MS }, true);
    clearTimeout(H.fin); H.fin = setTimeout(resolve, PICK_MS + 1000);       // 通信の遅れのぶん、少しだけ待つ
  }
  function hostOnMsg(id, m){
    if(!m || m.t !== 'pk' || H.phase !== 'pick') return;
    if(m.r !== H.turn || !H.alive.includes(id) || H.picks.has(id)) return;
    if(!Number.isInteger(m.v) || !(H.hands.get(id) || []).includes(m.v)) return;
    H.picks.set(id, m.v);
    E.hostBcast({ t: 'prog', r: H.turn, ids: Array.from(H.picks.keys()) }, false);
    if(H.alive.every(x => H.picks.has(x))){ clearTimeout(H.fin); resolve(); }
  }
  function hostOnLeave(id){
    if(!H.alive.includes(id)) return;
    H.alive = H.alive.filter(x => x !== id); H.picks.delete(id);
    if(H.phase === 'pick'){
      if(H.alive.length < 2){ clearTimeout(H.fin); endGame(); return; }
      if(H.alive.every(x => H.picks.has(x))){ clearTimeout(H.fin); resolve(); }
    }
  }
  // かぶっていない数字のうち、いちばん大きい数字を出した人(いなければ -1)
  function winnerOf(picks){
    const cnt = new Map(); picks.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1));
    let best = 0, who = -1;
    picks.forEach((v, id) => { if(cnt.get(v) === 1 && v > best){ best = v; who = id; } });
    return who;
  }
  function resolve(){
    if(H.phase !== 'pick') return;
    H.phase = 'reveal'; clearTimeout(H.fin);
    const rows = H.alive.map(id => ({ id, v: H.picks.has(id) ? H.picks.get(id) : 0 }));
    const win = winnerOf(H.picks);
    let pl = 0;
    if(win >= 0){
      // 抜けた人が出たターンだけ、出したカードを使ったことにする(全員かぶりなら手札にもどす)
      H.picks.forEach((v, id) => H.hands.set(id, H.hands.get(id).filter(c => c !== v)));
      H.out.push(win); H.at.push(H.turn); pl = H.out.length;
      H.alive = H.alive.filter(id => id !== win);
    }
    const over = H.alive.length <= 1 || H.turn >= MAX_TURNS;
    const res = { t: 'res', r: H.turn, rows, win, pl, over };
    if(over){ Object.assign(res, final()); H.phase = 'done'; }
    E.hostBcast(res, true);
    if(over) report();
    else{ clearTimeout(H.nxt); H.nxt = setTimeout(startTurn, SHOW_MS + 600); }
  }
  function final(){ const here = present(); return { out: H.out.filter(id => here.includes(id)), at: H.at.filter((_, i) => here.includes(H.out[i])), rest: H.alive.filter(id => here.includes(id)) }; }
  // MIX 用の順位: 抜けた順。残った人がビリ(上限まで決まらなかったときは、残りの人が同じ順位)
  function report(){
    if(!E.rank) return;
    const f = final(), gs = f.out.map(id => [id]);
    if(f.rest.length) gs.push(f.rest);
    E.rank(gs);
  }
  function endGame(){
    // 途中で人が抜けて、決着したとき
    H.phase = 'done'; clearTimeout(H.fin); clearTimeout(H.nxt);
    E.hostBcast(Object.assign({ t: 'res', r: H.turn, early: true }, final()), true);
    report();
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.fin); clearTimeout(H.nxt); PF.show(false);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    $('u-ok').onclick = null;
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
