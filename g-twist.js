/* TWIST ひっかけ早押し オンライン(ホストが審判)
 *
 * ルール
 *  1. 全員同時に、同じ12問を解く早押しレース
 *  2. 問題は「色」「向き」「数」の3種類。上に出る「お題」に答える(お題は問題ごとに変わる)
 *  3. まちがえると1秒タップできない(おてつき)。正解するまで次へ進めない
 *  4. 12問を終えるまでの時間が短い順。40秒で終わり(終わらなかった人は、正解の数 → 時間)
 *
 * 公平さ(通信の遅れが勝ち負けに入らないように)
 *  - 問題の並びは、ホストが配る「種」から全員が同じものを作る
 *  - スタートはホストの時計の時刻で配る。かかった時間は、各スマホの中で「自分のスタート」から測る
 *  - ホストは、答えが種から作った問題と合っているか、時間がありえるかを確かめる
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const NQ = 12;              // 問題の数
const LIM_MS = 40000;       // 制限時間
const LOCK_MS = 1000;       // おてつきで止まる時間
const LEAD_MS = 4200;       // 合図からスタートまで(カウントダウン)
const MIN_Q_MS = 150;       // 1問にかかる時間の下限(これより速いのはありえない)
const SLACK_MS = 4000;      // 自己申告の時間が、届いた時刻からの見こみよりこれ以上短ければ直す(送り直しの遅れは許す)

// 種から同じ問題を作るための乱数(全員のスマホで同じ並びになる)
function rng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 色は 赤・青・黄・白(緑は使わない: 見分けにくい人がいるので)
const COLS = [{ w: 'あか', c: '#ff453a' }, { w: 'あお', c: '#3d8bff' }, { w: 'きいろ', c: '#ffd60a' }, { w: 'しろ', c: '#f4f4f6' }];
const ARW = ['↑', '↓', '←', '→'];      // 0=上 1=下 2=左 3=右(矢印の向きも、矢印がある場所も、この番号)
const ASK = { iro: '色は?', moji: '文字は?', muki: '向きは?', basho: '場所は?', ikutsu: 'いくつ?', suuji: '数字は?' };
function gen(seed){
  const r = rng(seed), ri = n => Math.floor(r() * n);
  const shuf = a => { for(let i = a.length - 1; i > 0; i--){ const j = ri(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const corder = shuf([0, 1, 2, 3]);                     // 色のボタンの並び(ゲームの間ずっと同じ)
  const types = shuf(['col', 'col', 'col', 'col', 'dir', 'dir', 'dir', 'dir', 'num', 'num', 'num', 'num']);
  const qs = types.map(t => {
    if(t === 'col'){
      const w = ri(4); let ink = w; if(r() < .75){ do{ ink = ri(4); }while(ink === w); }
      const mode = r() < .5 ? 'iro' : 'moji';
      return { t, mode, w, ink, ans: corder.indexOf(mode === 'iro' ? ink : w) };
    }
    if(t === 'dir'){
      const d = ri(4); let p = d; if(r() < .75){ do{ p = ri(4); }while(p === d); }
      const mode = r() < .5 ? 'muki' : 'basho';
      return { t, mode, d, p, ans: mode === 'muki' ? d : p };
    }
    const d = 1 + ri(6); let c = d; if(r() < .8){ do{ c = 1 + ri(6); }while(c === d); }
    const mode = r() < .5 ? 'ikutsu' : 'suuji';
    const opts = [d]; if(c !== d) opts.push(c);
    while(opts.length < 4){ const v = 1 + ri(6); if(!opts.includes(v)) opts.push(v); }
    opts.sort((a, b) => a - b);
    return { t, mode, d, c, opts, ans: opts.indexOf(mode === 'ikutsu' ? c : d) };
  });
  return { corder, qs };
}

// 順位発表: 1位から順に。最後の2人は、ためてから同時に出す
function reveal(E, PF, later, o){
  const lines = o.lines, n = lines.length;
  if(n < 2){ E.showResult({ title: o.title, reason: o.reason, pen: o.pen, lines, stats: o.stats }); return; }
  E.showResult({ title: o.title, reason: o.reason, pen: '', lines: [], stats: '', hold: true });
  const box = E.$('r-lines'), penEl = E.$('r-pen');
  const add = l => {
    const d = document.createElement('div'); if(l.cls) d.className = l.cls;
    const a = document.createElement('span'), b = document.createElement('span'); a.textContent = l.a; b.textContent = l.b;
    d.appendChild(a); d.appendChild(b); d.classList.add('pop'); box.appendChild(d);
    later(() => PF.rowIn(d, l.cls === 'win' ? 'win' : l.cls === 'lose' ? 'lose' : ''), 60);
  };
  let i = 0;
  const next = () => {
    if(i < n - 2){ add(lines[i]); E.audio.beep(i === 0 ? 988 : 700 - Math.min(i, 5) * 40, .14, .22); E.vibrate(30); i++; later(next, 800); return; }
    penEl.textContent = '……';
    const DR = 2200, steps = Math.floor(DR / 130);
    for(let s = 0; s < steps; s++) later(() => { E.audio.beep(300 + s * 22, .09, .12); if(s % 4 === 0) E.vibrate(25); penEl.textContent = s % 8 < 4 ? '……' : '… … …'; }, s * 130);
    later(() => {
      add(lines[n - 2]); add(lines[n - 1]);
      penEl.textContent = o.pen; E.$('r-stats').textContent = o.stats || '';
      E.audio.scare(); E.vibrate(o.meLose ? [0, 200, 80, 400] : [0, 120]);
      if(o.meWin) PF.confetti(120);
      E.resultBtns(1200);
    }, DR);
  };
  later(next, 600);
}

window.NomiGames.twist = { id: 'twist', name: 'TWIST', _gen: gen, _cfg: { NQ, LIM_MS, LOCK_MS }, make(E){
  const $ = E.$, PF = E.fx;
  const rnd32 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };
  const fxOn = () => PF.show(true, { amb: [0xe36bff, 0xf0b0ff, 0xffffff] });

  // ---------------- 参加者側 ----------------
  let ph = 'wait', G = null, k = 0, t0 = 0, endLocal = 0, lockUntil = 0, miss = 0, myMs = -1;
  let prog = new Map();                    // ほかの人の進み具合(ホストから)
  const btns = [];

  function say(big, sub){ $('w-big').textContent = big || ''; $('w-sub').textContent = sub || ''; }
  function lanes(){
    const box = $('w-lanes'); box.textContent = '';
    E.players().forEach(p => {
      const kk = p.id === E.myId && ph !== 'wait' ? k : (prog.get(p.id) || 0);
      const row = document.createElement('div'); row.className = 'wl' + (p.id === E.myId ? ' me' : '') + (kk >= NQ ? ' fin' : '');
      const nm = document.createElement('span'); nm.textContent = p.name;
      const bar = document.createElement('i'); const f = document.createElement('b'); f.style.transform = 'scaleX(' + (kk / NQ).toFixed(3) + ')'; bar.appendChild(f);
      const v = document.createElement('em'); v.textContent = kk + '/' + NQ;
      row.appendChild(nm); row.appendChild(bar); row.appendChild(v); box.appendChild(row);
    });
  }
  function clearQ(){ $('w-ask').textContent = ''; $('w-ask').className = 'w-ask'; $('w-stim').textContent = ''; $('w-stim').className = 'w-stim'; $('w-btns').textContent = ''; btns.length = 0; }
  function onBegin(){
    stopped = false; ph = 'wait'; G = null; k = 0; miss = 0; myMs = -1; prog = new Map(); lockUntil = 0;
    $('w-top').textContent = 'TWIST — ひっかけ早押し';
    clearQ(); $('w-btns').className = 'w-btns'; lanes(); say('準備中…', ''); E.show('s-twist');
    PF.load(); fxOn();
  }
  function render(){
    const q = G.qs[k], ask = $('w-ask'), st = $('w-stim'), bx = $('w-btns');
    ask.textContent = ASK[q.mode]; ask.className = 'w-ask m-' + q.mode;
    void ask.offsetWidth; ask.classList.add('pop');
    st.textContent = ''; st.className = 'w-stim t-' + q.t;
    const s = document.createElement('span');
    if(q.t === 'col'){ s.className = 'w-word'; s.textContent = COLS[q.w].w; s.style.color = COLS[q.ink].c; }
    else if(q.t === 'dir'){ s.className = 'w-arw p' + q.p; s.textContent = ARW[q.d]; }
    else { s.className = 'w-num'; s.textContent = Array(q.c).fill(String(q.d)).join(' '); }
    st.appendChild(s);
    bx.textContent = ''; bx.className = 'w-btns t-' + q.t; btns.length = 0;
    const labels = q.t === 'col' ? G.corder.map(i => COLS[i].w) : q.t === 'dir' ? ARW.slice() : q.opts.map(String);
    labels.forEach((lb, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'wb' + (q.t === 'dir' ? ' d' + i : ''); b.textContent = lb;
      // 「触れた瞬間」で反応させる(click より早く、時間も正確)
      b.addEventListener('pointerdown', e => { e.preventDefault(); tap(i, e); });
      b.addEventListener('contextmenu', e => e.preventDefault());
      bx.appendChild(b); btns.push(b);
    });
    $('w-top').textContent = 'TWIST — ' + (k + 1) + ' / ' + NQ;
  }
  function tap(i, e){
    if(stopped || ph !== 'run') return;
    const now = performance.now(), ts = e && Number.isFinite(e.timeStamp) && Math.abs(e.timeStamp - now) < 5000 ? e.timeStamp : now;
    if(ts < lockUntil || ts >= endLocal) return;
    const q = G.qs[k];
    if(i === q.ans){
      const ms = Math.max(0, Math.round(ts - t0));
      E.send({ t: 'ok', k, c: i, ms }, true);
      E.audio.beep(700 + k * 30, .05, .14); E.vibrate(12);
      PF.pop(btns[i], { color: 0xe36bff, power: .6 });
      k++;
      if(k >= NQ){ finish(ms); return; }
      say('', ''); render(); lanes();
    }else{
      miss++; lockUntil = ts + LOCK_MS;
      E.send({ t: 'ng', k }, false);
      btns[i].classList.add('bad'); $('w-btns').classList.add('lock');
      const box = $('w-stage'); box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      E.audio.beep(180, .2, .2); E.vibrate([40, 30, 80]);
      say('おてつき!', '1秒まって');
      const kk = k;
      later(() => { if(ph === 'run' && k === kk){ $('w-btns').classList.remove('lock'); btns.forEach(b => b.classList.remove('bad')); say('', ''); } }, LOCK_MS);
    }
  }
  function finish(ms){
    ph = 'done'; myMs = ms; clearQ();
    $('w-ask').textContent = 'ゴール!'; $('w-ask').className = 'w-ask';
    say((ms / 1000).toFixed(2) + ' 秒', (miss ? 'おてつき ' + miss + '回 / ' : '') + 'みんなを待ってるよ…');
    PF.slam('FINISH!', { color: 0xe36bff, size: 52 });
    E.audio.beep(988, .15, .25); later(() => E.audio.beep(1319, .2, .25), 120); E.vibrate([30, 40, 80]);
    lanes();
  }
  function onGo(m){
    if(ph !== 'wait' || !Number.isInteger(m.seed) || m.seed < 0 || m.seed > 4294967295 || !Number.isFinite(m.at)) return;
    G = gen(m.seed); k = 0; miss = 0; myMs = -1;
    t0 = E.toLocal(m.at); endLocal = t0 + LIM_MS;
    ph = 'cd'; clearQ(); lanes();
    let last = -1;
    const tick = () => {
      if(stopped || ph !== 'cd') return;
      const left = t0 - performance.now();
      if(left <= 0){ start(); return; }
      const s = Math.ceil(left / 1000);
      if(s !== last){ last = s; say(String(s), 'お題をよく見て答えよう\nまちがえると1秒止まるよ'); E.audio.beep(520, .06, .14); }
      later(tick, Math.min(100, left));
    };
    tick();
  }
  function start(){
    ph = 'run'; say('', ''); render(); lanes();
    PF.show(true, { amb: null });            // 動くものを減らして、問題に集中できるように
    E.audio.beep(988, .1, .2); E.vibrate(40);
    const lim = () => {
      if(stopped || ph !== 'run') return;
      if(performance.now() >= endLocal){ ph = 'done'; clearQ(); say('時間切れ', k + ' / ' + NQ + ' 問'); E.audio.beep(220, .3, .2); return; }
      later(lim, 200);
    };
    lim();
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'go') onGo(m);
    else if(m.t === 'pg' && Array.isArray(m.p)){
      m.p.slice(0, 8).forEach(x => { if(Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[1] >= 0 && x[1] <= NQ) prog.set(x[0], x[1]); });
      lanes();
    }
    else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[1] >= 0 && x[1] <= NQ && Number.isFinite(x[2]) && x[2] >= 0 && x[2] <= LIM_MS + 60000 && Number.isInteger(x[3]) && x[3] >= 0 && x[3] <= 999).slice(0, 8);
    if(!rows.length) return;
    ph = 'res'; fxOn();
    const lines = []; let pl = 0;
    rows.forEach((x, i) => {
      if(i === 0 || x[1] !== rows[i - 1][1] || x[2] !== rows[i - 1][2]) pl = i + 1;
      lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: (x[1] >= NQ ? (x[2] / 1000).toFixed(2) + '秒' : x[1] + '/' + NQ + '問') + (x[3] ? '  ミス' + x[3] : ''), cls: '' });
    });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = l.pl === 1 ? 'win' : (l.pl === maxPl && maxPl > 1 ? 'lose' : ''); });
    const tops = lines.filter(l => l.pl === 1), lasts = lines.filter(l => l.pl === maxPl && maxPl > 1);
    const pen = !lasts.length ? '引き分け' : lasts.some(l => l.id === E.myId) ? 'あなたが最下位' : lasts.map(l => E.nameOf(l.id)).join('・') + ' が最下位';
    reveal(E, PF, later, {
      title: 'TWIST', reason: '12問を解くまでの時間(40秒まで)',
      lines, pen, meLose: lasts.some(l => l.id === E.myId), meWin: tops.some(l => l.id === E.myId),
      stats: '時間は、自分のスマホの中でスタートから測っているよ(通信の遅れは入らない)'
    });
  }

  // ---------------- ホスト(審判) ----------------
  const H = { ph: 'idle', seed: 0, G: null, at: 0, P: new Map(), endT: 0, pgT: 0 };
  function hostStart(){
    H.seed = rnd32(); H.G = gen(H.seed); H.at = performance.now() + LEAD_MS; H.ph = 'run';
    H.P = new Map(E.players().map(p => [p.id, { k: 0, ms: 0, miss: 0 }]));
    E.hostBcast({ t: 'go', seed: H.seed, at: H.at, n: NQ, lim: LIM_MS }, true);
    clearTimeout(H.endT); H.endT = setTimeout(finalize, LEAD_MS + LIM_MS + 1500);
  }
  const here = () => new Set(E.players().map(p => p.id));
  function allDone(){ const h = here(); return Array.from(H.P.entries()).every(([id, x]) => x.k >= NQ || !h.has(id)); }
  function markPg(){
    if(H.pgT) return;
    H.pgT = setTimeout(() => { H.pgT = 0; if(H.ph !== 'run') return; E.hostBcast({ t: 'pg', p: Array.from(H.P.entries()).map(([id, x]) => [id, x.k]) }, false); }, 250);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || H.ph !== 'run') return;
    const p = H.P.get(id); if(!p) return;
    if(m.t === 'ng'){ if(m.k === p.k && p.k < NQ && p.miss < 999) p.miss++; return; }
    if(m.t !== 'ok' || m.k !== p.k || p.k >= NQ) return;
    if(m.c !== H.G.qs[p.k].ans || !Number.isFinite(m.ms) || m.ms < p.ms + MIN_Q_MS || m.ms > LIM_MS + 500) return;
    let ms = Math.round(m.ms);
    if(id !== 0){
      // 届いた時刻から見て、ありえないほど速い申告は直す(送り直しで遅れたぶんは許す)
      const peer = E.players().find(x => x.id === id), rtt = peer && Number.isFinite(peer.rtt) ? peer.rtt : 0;
      const est = performance.now() - H.at - rtt / 2;
      if(ms < est - SLACK_MS) ms = Math.round(est - SLACK_MS);
    }
    p.k++; p.ms = ms;
    markPg();
    if(allDone()){ clearTimeout(H.endT); H.endT = setTimeout(finalize, 500); }
  }
  function hostOnLeave(id){
    H.P.delete(id);
    if(H.ph === 'run' && allDone()){ clearTimeout(H.endT); H.endT = setTimeout(finalize, 500); }
  }
  function finalize(){
    if(H.ph !== 'run') return;
    H.ph = 'done'; clearTimeout(H.endT); clearTimeout(H.pgT);
    const h = here();
    const rows = Array.from(H.P.entries()).filter(([id]) => h.has(id)).map(([id, x]) => [id, x.k, x.k > 0 ? x.ms : 0, x.miss]);
    rows.sort((a, b) => (b[1] - a[1]) || (a[2] - b[2]));          // 正解の数が多い順 → 時間が短い順
    E.hostBcast({ t: 'res', rows }, true);
    // MIX 用の順位: 同じ数・同じ時間は同じ順位
    if(E.rank){
      const gs = [];
      rows.forEach((x, i) => { if(i > 0 && x[1] === rows[i - 1][1] && x[2] === rows[i - 1][2]) gs[gs.length - 1].push(x[0]); else gs.push([x[0]]); });
      E.rank(gs);
    }
  }
  function stop(){
    stopped = true; clearTimeout(H.endT); clearTimeout(H.pgT); PF.show(false);
    timers.forEach(t => clearTimeout(t));
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
