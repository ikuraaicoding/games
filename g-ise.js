/* いっせーのーせ オンライン(ホストが審判)
 *
 * ルール(「いっせーのーせ」のノリで、ライフを削り合う)
 *  1. 全員がこっそり「親指を何本立てるか(0〜2)」と「みんなの合計は何本か」を決める
 *  2. 「いっせーのーせ!」で全員分を同時にオープン。合計が決まる
 *  3. 予想がズレた人は、ズレた分だけライフが減る
 *  4. ピッタリ当てた人は、ズレなし。かわりに「自分以外の全員」にダメージを与える
 *  5. ライフが0になったら脱落。最後の1人が勝ち
 *
 * ライフ・ダメージの決め方(シミュレーションで決めた)
 *   ライフ = 4 + 人数×2(2人=8 / 4人=12 / 8人=20)
 *   ピッタリのダメージ = 3人以下は1、4〜6人は2、7人以上は3(人数が多いほど強い)
 *   → だいたい4〜6ラウンド(2〜3分)で決着する
 *
 * 公平さ: ほかの人の「立てる数」「予想」はホストだけが持ち、オープンまで通信に載せない。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const PICK_MS = 20000;      // 1ラウンドの考える時間
const MAX_ROUNDS = 20;      // これを過ぎたら、ライフが多い人の勝ち

// 結果発表の長さ(ホストも参加者も同じ式で数える)
const revealMs = (n, anyExact) => 4800 + 450 * n + (anyExact ? 1500 : 0) + 500 + 2800;

window.NomiGames.ise = { id: 'ise', name: 'いっせーのーせ', make(E){
  const $ = E.$;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', round = 0, alive = [], lives = new Map(), submitted = [], ex = 1, L = 0;
  let selP = null, selG = null, sent = false, dl = 0, barT = 0, nAlive = 0;

  function chips(){
    const box = $('i-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span');
      const lf = lives.get(p.id), dead = lf !== undefined && (lf <= 0 || !alive.includes(p.id));
      c.className = 'chip' + (dead ? ' dead' : (ph === 'pick' && submitted.includes(p.id) ? ' on' : ''));
      c.textContent = dead ? p.name : (ph === 'pick' && submitted.includes(p.id) ? '✓ ' : '') + p.name + (lf !== undefined ? '  ♥' + lf : '');
      c.dataset.id = p.id; box.appendChild(c);
    });
  }
  function view(which){
    $('i-pick').style.display = which === 'pick' ? 'flex' : 'none';
    $('i-view').style.display = which === 'pick' ? 'none' : 'flex';
    $('i-bar').style.display = which === 'pick' ? 'block' : 'none';
  }
  function say(big, sub){ $('i-big').textContent = big || ''; $('i-sub').textContent = sub || ''; }
  function onBegin(){
    stopped = false; ph = 'wait'; round = 0; alive = []; lives = new Map(); submitted = []; selP = selG = null; sent = false;
    $('i-top').textContent = 'THUMBS — いっせーのーせ'; $('i-rows').textContent = '';
    chips(); view('view'); say('準備中…', ''); E.show('s-ise');
  }

  function mkBtns(box, count, cls, onPick, label){
    box.textContent = '';
    for(let v = 0; v <= count; v++){
      const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label ? label(v) : String(v); b.dataset.v = v;
      b.addEventListener('click', () => { if(ph !== 'pick' || sent) return; onPick(v); E.audio.init(); E.vibrate(15); });
      box.appendChild(b);
    }
  }
  // 左右の手。タップするたびに、その手の親指が上がる(👍)/下がる(✊)
  function mkHands(){
    const box = $('i-p'); box.textContent = '';
    const up = [false, false]; selP = 0;
    ['左手', '右手'].forEach((lbl, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hand2' + (i === 0 ? ' left' : '');
      const em = document.createElement('span'); em.className = 'em'; em.textContent = '✊';
      const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = lbl + '(タップで親指を立てる)';
      b.appendChild(em); b.appendChild(cap);
      // click ではなく「触れた瞬間」で反応させる(2本指で同時に押しても、指が少しずれても、両方とも効く)
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        if(ph !== 'pick' || sent) return;
        up[i] = !up[i]; selP = up.filter(Boolean).length;
        em.textContent = up[i] ? '👍' : '✊'; b.classList.toggle('up', up[i]);
        cap.textContent = lbl + (up[i] ? '(親指アップ!)' : '(タップで親指を立てる)');
        b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        E.audio.init(); E.audio.beep(up[i] ? 660 : 440, .06, .15); E.vibrate(15);
        refreshSel();
      });
      b.addEventListener('contextmenu', e => e.preventDefault());
      box.appendChild(b);
    });
  }
  function refreshSel(){

    document.querySelectorAll('#i-g button').forEach(b => b.classList.toggle('sel', Number(b.dataset.v) === selG));
    $('i-ok').disabled = sent || selP === null || selG === null;
    if(!sent) $('i-ghint').textContent = '今の自分: 親指 ' + selP + '本(これも合計に入るよ)';
  }
  function submit(){
    if(sent || selP === null || selG === null || ph !== 'pick') return;
    sent = true; E.send({ t: 'pk', r: round, p: selP, gs: selG }, true);      // 'g' は通信部品がゲームIDに使うので使わない
    $('i-ok').textContent = '決定ずみ!'; $('i-ok').disabled = true; E.vibrate(30); E.audio.beep(660, .1, .2); refreshSel();
    $('i-ghint').textContent = 'みんなを待ってるよ…'; $('i-pick').classList.add('locked');
  }
  $('i-ok').onclick = submit;

  function startPick(m){
    ph = 'pick'; submitted = []; selP = selG = null; sent = false;
    $('i-top').textContent = 'ROUND ' + round + '  ／  生き残り ' + nAlive + '人';
    $('i-rows').textContent = ''; $('i-pick').classList.remove('locked'); $('i-ghint').textContent = '';
    chips();
    if(!alive.includes(E.myId)){ view('view'); $('i-bar').style.display = 'block'; say('脱落 — 観戦中', 'みんなが考えてるよ'); }
    else{
      view('pick'); $('i-ok').textContent = '決定!';
      mkHands();
      mkBtns($('i-g'), 2 * nAlive, 'nb sm', v => { selG = v; refreshSel(); });
      refreshSel();
    }
    dl = performance.now() + (Number.isFinite(m.ms) ? m.ms : PICK_MS);
    clearInterval(barT);
    barT = setInterval(() => {
      if(stopped || ph !== 'pick'){ clearInterval(barT); return; }
      const left = dl - performance.now();
      $('i-bar').firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / (m.ms || PICK_MS))).toFixed(3) + ')';
      if(left < 400 && !sent && selP !== null && selG !== null) submit();     // 時間ぎれ直前に、決めていた分は出す
    }, 100);
    timers.push(barT);
    E.vibrate(40);
  }

  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'rnd' && Number.isInteger(m.r) && Array.isArray(m.alive) && Array.isArray(m.lives)){
      round = m.r; alive = m.alive.filter(Number.isInteger).slice(0, 8); nAlive = alive.length;
      ex = Number.isInteger(m.ex) ? m.ex : 1; L = Number.isInteger(m.L) ? m.L : 0;
      lives = new Map(); m.lives.forEach(x => { if(x && Number.isInteger(x.id) && Number.isFinite(x.l)) lives.set(x.id, x.l); });
      startPick(m);
    }else if(m.t === 'prog' && Array.isArray(m.ids) && m.r === round){ submitted = m.ids.filter(Number.isInteger); chips(); }
    else if(m.t === 'res'){ showRes(m); }
  }

  // ---- 結果発表 ----
  function showRes(m){
    if(m.early && Array.isArray(m.rank)){ ph = 'reveal'; clearInterval(barT); showFinal(m); return; }    // 途中で人が抜けて決着
    if(!Array.isArray(m.rows) || !Number.isFinite(m.tot) || !Number.isFinite(m.wait)) return;
    ph = 'reveal'; clearInterval(barT);
    const rows = m.rows.filter(x => x && Number.isInteger(x.id) && Number.isInteger(x.p) && Number.isInteger(x.g) && Number.isFinite(x.d) && Number.isFinite(x.dmg) && Number.isFinite(x.life)).slice(0, 8);
    const n = rows.length; if(!n) return;
    const exact = rows.filter(x => x.d === 0), anyExact = exact.length > 0;
    const order = rows.filter(x => x.d !== 0).concat(exact);        // ピッタリの人は最後に発表(盛り上がる)
    const box = $('i-rows'); box.textContent = ''; view('view'); $('i-bar').style.display = 'none';
    const els = new Map();
    const thumbs = p => p === 0 ? '✊✊' : p === 1 ? '👍✊' : '👍👍';
    let t = 100;
    const at = (ms, fn) => later(() => { if(!stopped) fn(); }, ms);

    at(t, () => { say('いっ…', ''); E.audio.beep(330, .12, .22); E.vibrate(20); });
    at(t + 600, () => { say('せーの…', ''); E.audio.beep(392, .12, .22); E.vibrate(20); });
    at(t + 1200, () => { say('…', ''); E.audio.beep(440, .12, .22); E.vibrate(20); });
    at(t + 1800, () => {
      say('せ!!', ''); E.audio.beep(988, .25, .3); E.vibrate([0, 80]);
      rows.forEach(x => {
        const d = document.createElement('div'); d.classList.add('pop');
        const a = document.createElement('span'), b = document.createElement('span');
        a.textContent = E.nameOf(x.id) + '  ' + thumbs(x.p); b.textContent = '';
        if(x.id === E.myId) d.classList.add('me');
        d.appendChild(a); d.appendChild(b); box.appendChild(d); els.set(x.id, { d, a, b });
      });
    });
    at(t + 3300, () => { say('合計 ' + m.tot + ' 本!', ''); E.audio.beep(784, .2, .28); E.vibrate(60); });
    let u = t + 4500;
    order.forEach(x => {
      const myT = u; u += 450;
      at(myT, () => {
        const e = els.get(x.id); if(!e) return;
        e.b.textContent = '予想 ' + x.g + (x.d === 0 ? '  ピッタリ!' : '  ズレ ' + x.d);
        if(x.d === 0){ e.d.classList.add('win'); E.audio.beep(1175, .2, .3); E.vibrate([0, 60, 40, 60]); } else E.audio.beep(520 - Math.min(x.d, 6) * 30, .08, .18);
      });
    });
    if(anyExact){
      at(u + 200, () => {
        const names = exact.map(x => E.nameOf(x.id)).join('・');
        say(names + ' ピッタリ!', 'ほかの全員に −' + (Number.isFinite(m.ex) ? m.ex : ex) + (exact.length > 1 ? '(人数ぶん重なる)' : ''));
        E.audio.beep(1397, .3, .3); E.vibrate([0, 120, 50, 200]);
      });
      u += 1500;
    }
    at(u + 500, () => {
      const dead = Array.isArray(m.dead) ? m.dead.filter(Number.isInteger) : [];
      rows.forEach(x => {
        const e = els.get(x.id); if(!e) return;
        lives.set(x.id, x.life);
        const own = x.d === 0 ? 0 : x.d, hit = x.dmg - own;           // 自分のズレ + ピッタリの人からの被弾
        e.b.textContent = (x.dmg > 0 ? '−' + x.dmg : '±0') + (own > 0 && hit > 0 ? '(ズレ' + own + '+被弾' + hit + ')' : hit > 0 ? '(被弾)' : '') + ' → ' + (x.life > 0 ? '♥' + x.life : '脱落');
        e.d.classList.remove('win'); if(x.dmg > 0) e.d.classList.add('hurt'); if(x.life <= 0) e.d.classList.add('lose');
      });
      alive = alive.filter(id => !dead.includes(id));
      say(m.over ? '決着!' : '', dead.length ? dead.map(id => E.nameOf(id)).join('・') + ' が脱落' : '');
      chips(); E.audio.boom && E.audio.boom();
      const me = rows.find(x => x.id === E.myId);
      if(me && me.dmg > 0) E.vibrate([0, 150, 60, 250]);
    });
    if(m.over && Array.isArray(m.rank)){
      at(m.wait, () => showFinal(m));
    }
  }
  function showFinal(m){
    const rank = m.rank.filter(x => x && Number.isInteger(x.id) && Number.isFinite(x.life) && Number.isFinite(x.out)).slice(0, 8);
    if(!rank.length) return;
    const top = rank.filter(x => x.life === rank[0].life && x.out === rank[0].out);
    const lines = rank.map((x, i) => ({
      a: (i + 1) + '位  ' + E.nameOf(x.id),
      b: x.out === 0 ? '♥' + x.life + ' 生き残り' : (x.out >= 1 ? 'ROUND ' + x.out + ' で脱落' : ''),
      cls: top.some(y => y.id === x.id) ? 'win' : (i === rank.length - 1 ? 'lose' : '')
    }));
    const iWin = top.some(x => x.id === E.myId);
    const pen = top.length > 1 ? '引き分け: ' + top.map(x => E.nameOf(x.id)).join('・')
      : (iWin ? 'あなたの勝ち' : E.nameOf(top[0].id) + ' の勝ち');
    E.showResult({
      title: 'THUMBS',
      reason: (Number.isInteger(m.r) ? m.r : round) + 'ラウンドで決着(はじめのライフ ' + L + ')',
      pen, lines,
      stats: 'ピッタリ当てると、ほかの全員に −' + ex + ' ダメージ。\nズレた分だけ自分のライフが減るよ。'
    });
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'wait', round: 0, alive: [], life: new Map(), out: new Map(), picks: new Map(), L: 0, ex: 1, fin: null, nxt: null };
  const hostPlayers = () => E.players();
  function hostStart(){
    const ids = hostPlayers().map(p => p.id), N = ids.length;
    H.L = 4 + 2 * N; H.ex = N >= 7 ? 3 : N >= 4 ? 2 : 1;
    H.alive = ids.slice(); H.life = new Map(ids.map(id => [id, H.L])); H.out = new Map(); H.round = 0;
    startRound();
  }
  function startRound(){
    H.alive = H.alive.filter(id => hostPlayers().some(p => p.id === id));
    if(H.alive.length < 2){ endGame(); return; }
    H.round++; H.picks = new Map(); H.phase = 'pick';
    E.hostBcast({ t: 'rnd', r: H.round, alive: H.alive, lives: H.alive.map(id => ({ id, l: H.life.get(id) })).concat(Array.from(H.out.keys()).map(id => ({ id, l: Math.min(0, H.life.get(id)) }))), L: H.L, ex: H.ex, ms: PICK_MS }, true);
    clearTimeout(H.fin); H.fin = setTimeout(resolve, PICK_MS + 1500);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || H.phase !== 'pick' || m.t !== 'pk') return;
    const n = H.alive.length;
    if(m.r !== H.round || !H.alive.includes(id) || H.picks.has(id)) return;
    if(!Number.isInteger(m.p) || m.p < 0 || m.p > 2 || !Number.isInteger(m.gs) || m.gs < 0 || m.gs > 2 * n) return;
    H.picks.set(id, { p: m.p, g: m.gs });
    E.hostBcast({ t: 'prog', r: H.round, ids: Array.from(H.picks.keys()) }, false);
    if(H.alive.every(x => H.picks.has(x))){ clearTimeout(H.fin); resolve(); }
  }
  function hostOnLeave(id){
    if(!H.alive.includes(id)) return;
    H.alive = H.alive.filter(x => x !== id); H.picks.delete(id);
    H.life.set(id, 0); H.out.set(id, H.round);
    if(H.phase === 'pick'){
      if(H.alive.length < 2){ clearTimeout(H.fin); endGame(); return; }
      if(H.alive.every(x => H.picks.has(x))){ clearTimeout(H.fin); resolve(); }
    }
  }
  function resolve(){
    if(H.phase !== 'pick') return;
    H.phase = 'reveal'; clearTimeout(H.fin);
    const n = H.alive.length;
    H.alive.forEach(id => {                                         // 時間ぎれの人は、おまかせ(ランダム + ふつうの予想)
      if(!H.picks.has(id)){ const p = Math.floor(rndF() * 3); H.picks.set(id, { p, g: Math.min(2 * n, p + n - 1) }); }
    });
    const tot = H.alive.reduce((s, id) => s + H.picks.get(id).p, 0);
    const exacts = H.alive.filter(id => Math.abs(H.picks.get(id).g - tot) === 0);
    const rows = H.alive.map(id => {
      const pk = H.picks.get(id), d = Math.abs(pk.g - tot), isEx = d === 0;
      const dmg = (isEx ? 0 : d) + H.ex * (exacts.length - (isEx ? 1 : 0));
      const life = H.life.get(id) - dmg; H.life.set(id, life);
      return { id, p: pk.p, g: pk.g, d, dmg, life };
    });
    const dead = rows.filter(x => x.life <= 0).map(x => x.id);
    dead.forEach(id => H.out.set(id, H.round));
    H.alive = H.alive.filter(id => !dead.includes(id));
    const over = H.alive.length <= 1 || H.round >= MAX_ROUNDS;
    const wait = revealMs(rows.length, exacts.length > 0);
    const res = { t: 'res', r: H.round, rows, tot, ex: H.ex, dead, over, wait };
    if(over) res.rank = ranking();
    E.hostBcast(res, true);
    if(!over){ clearTimeout(H.nxt); H.nxt = setTimeout(startRound, wait + 600); } else H.phase = 'done';
  }
  function ranking(){
    const all = Array.from(H.life.keys()).map(id => ({ id, life: H.life.get(id), out: H.out.has(id) ? H.out.get(id) : 0 }));
    // 生き残り(out=0)が先。つぎに、あとに脱落した順。同じラウンドならライフが多い順
    return all.sort((a, b) => (a.out === 0) !== (b.out === 0) ? (a.out === 0 ? -1 : 1) : (a.out === 0 ? b.life - a.life : (b.out - a.out) || (b.life - a.life)));
  }
  function endGame(){
    // 途中で人が抜けて、決着したとき
    H.phase = 'done'; clearTimeout(H.fin); clearTimeout(H.nxt);
    E.hostBcast({ t: 'res', r: H.round, rows: [], tot: 0, ex: H.ex, dead: [], over: true, wait: 0, rank: ranking(), early: true }, true);
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.fin); clearTimeout(H.nxt);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    $('i-ok').onclick = null;
    ['r-again', 'r-lobby'].forEach(id => { const b = $(id); if(b) b.style.display = ''; });
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
