/* TRACE なぞり耐久 オンライン(ホストが審判)
 *
 * ルール
 *  1. 合図のあと、くねくね動く輪を指で追いかける。指を離さず、輪からはみ出さない
 *  2. 輪はだんだん速く、小さくなり、カーブもきつくなる
 *  3. 輪から出て0.1秒たつか、指を離して0.15秒たつとアウト(スタート直後の1秒だけは、指を置く時間)
 *  4. 最後まで残った人の勝ち。先にアウトになった人ほど下の順位(60秒耐えたら、残った人は全員1位)
 *
 * 公平さ(通信の遅れが勝ち負けに入らないように)
 *  - 輪の道すじは、ホストが配る「種」から全員が同じものを作る
 *  - スタートはホストの時計の時刻。アウトの判定と、耐えた時間は、各スマホの中で測る
 *  - 画面の大きさがちがっても、道すじ・輪の大きさ・速さは、画面に対して同じ割合
 *
 * 数字(指の動きのモデルでのシミュレーション。360pxの画面で): 速さ 120px/秒 + 1秒ごとに 8px/秒 ずつ速く、
 *   輪の半径 50px → 28px。苦手な人 約10秒・ふつう 約19秒・得意な人 約47秒でアウト(実機で調整する)
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const LEAD_MS = 4500;       // 合図からスタートまで
const CAP_MS = 60000;       // ここまで耐えたら勝ち(残った人は全員1位)
const OUT_MS = 100;         // 輪から出て、これだけたつとアウト
const LIFT_MS = 150;        // 指を離して、これだけたつとアウト
const START_GRACE = 1000;   // スタート直後に指を置くための時間
const END_WAIT = 900;       // 残りが1人になってから、ほぼ同時のアウトを待つ時間
// 画面の一辺を 1 とした数字(360px の画面なら ×360)
const K = { v0: 120 / 360, a: 8 / 360, r0: 50 / 360, rmin: 28 / 360, rb: .8 / 360 };
const ACC = '#8ce65a';

function rng(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// 道すじ: 通る点を順に決めて(あとほど間隔がせまい = 急なカーブ)、なめらかにつなぐ
function mkPath(seed){
  const r = rng(seed), M = 50 / 360, cl = v => Math.max(M, Math.min(1 - M, v));
  const pts = []; let x = .5, y = .5, ang = r() * Math.PI * 2;
  for(let i = 0; i < 520; i++){
    const sp = Math.max(60 / 360, 170 / 360 - i * 1.2 / 360);
    ang += (r() - .5) * 2.2;
    let nx = x + Math.cos(ang) * sp, ny = y + Math.sin(ang) * sp;
    if(nx < M || nx > 1 - M || ny < M || ny > 1 - M){ ang = Math.atan2(.5 - y, .5 - x) + (r() - .5); nx = x + Math.cos(ang) * sp; ny = y + Math.sin(ang) * sp; }
    x = cl(nx); y = cl(ny); pts.push([x, y]);
  }
  const X = [.5], Y = [.5];
  const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3); };
  for(let i = 1; i < pts.length - 2; i++) for(let s = 0; s < 16; s++){
    const t = s / 16;
    X.push(cr(pts[i - 1][0], pts[i][0], pts[i + 1][0], pts[i + 2][0], t));
    Y.push(cr(pts[i - 1][1], pts[i][1], pts[i + 1][1], pts[i + 2][1], t));
  }
  const L = new Float64Array(X.length);
  for(let i = 1; i < X.length; i++) L[i] = L[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]);
  return { X, Y, L };
}
function at(P, s){
  const L = P.L; if(s <= 0) return [P.X[0], P.Y[0]];
  let lo = 0, hi = L.length - 1; if(s >= L[hi]) return [P.X[hi], P.Y[hi]];
  while(hi - lo > 1){ const m = (lo + hi) >> 1; if(L[m] <= s) lo = m; else hi = m; }
  const f = (s - L[lo]) / Math.max(1e-9, L[hi] - L[lo]);
  return [P.X[lo] + (P.X[hi] - P.X[lo]) * f, P.Y[lo] + (P.Y[hi] - P.Y[lo]) * f];
}
const distAt = t => K.v0 * t + K.a * t * t / 2;          // t秒で進む道のり
const radAt = t => Math.max(K.rmin, K.r0 - K.rb * t);    // t秒のときの輪の半径

window.NomiGames.trace = { id: 'trace', name: 'TRACE', _cfg: { CAP_MS }, _path: mkPath, _at: at, _dist: distAt, _rad: radAt, make(E){
  const $ = E.$, PF = E.fx, cv = $('tr-cv'), g = cv.getContext('2d');
  const rnd32 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };
  const fxOn = () => PF.show(true, { amb: [0x8ce65a, 0xc6f5a8, 0xffffff] });

  // ---------------- 参加者側 ----------------
  let ph = 'wait', P = null, t0 = 0, raf = 0, A = 300, DPR = 1;
  let touch = false, pid = -1, fx = .5, fy = .5, outSince = 0, liftSince = 0, myMs = -1, lastT = -1;
  let outs = new Map();                    // アウトになった人 → 耐えた時間
  function say(big, sub){ $('tr-big').textContent = big || ''; $('tr-sub').textContent = sub || ''; }
  function chips(){
    const box = $('tr-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span'), o = outs.has(p.id) || (p.id === E.myId && myMs >= 0);
      c.className = 'chip' + (o ? ' dead' : ph === 'run' ? ' on' : '');
      c.textContent = p.name + (p.id === E.myId ? '(あなた)' : '');
      box.appendChild(c);
    });
  }
  function fit(){
    const r = $('tr-wrap').getBoundingClientRect();
    A = Math.max(160, Math.floor(Math.min(r.width, r.height || r.width)));
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(A * DPR); cv.height = Math.round(A * DPR); cv.style.width = A + 'px'; cv.style.height = A + 'px';
  }
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height)]; };
  const onDown = e => {
    e.preventDefault();
    if(touch && pid !== e.pointerId) return;              // 2本目の指は使わない
    pid = e.pointerId; touch = true; const p = pos(e); fx = p[0]; fy = p[1];
    try{ cv.setPointerCapture(pid); }catch(_){}
    E.audio.init();
  };
  const onMove = e => { if(e.pointerId !== pid) return; e.preventDefault(); const p = pos(e); fx = p[0]; fy = p[1]; };
  const onUp = e => { if(e.pointerId !== pid) return; touch = false; pid = -1; };
  cv.style.touchAction = 'none';
  cv.addEventListener('pointerdown', onDown, { passive: false });
  cv.addEventListener('pointermove', onMove, { passive: false });
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  function onBegin(){
    stopped = false; ph = 'wait'; P = null; myMs = -1; outs = new Map(); outSince = 0; liftSince = 0; touch = false; pid = -1;
    $('tr-top').textContent = 'TRACE — なぞり耐久';
    say('準備中…', ''); E.show('s-trace'); chips();
    fit(); window.addEventListener('resize', fit);
    PF.load(); fxOn();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function out(when, why){
    if(ph !== 'run') return;
    ph = 'out'; myMs = Math.max(0, Math.min(CAP_MS, Math.round(when - t0)));
    E.send({ t: 'out', ms: myMs }, true);
    say('アウト!', why + '  ' + (myMs / 1000).toFixed(2) + ' 秒耐えた\nみんなを待ってるよ…');
    E.audio.boom(.4); E.vibrate([0, 150, 60, 250]);
    fxOn(); PF.shatter(cv, 0xff453a);
    chips();
  }
  function frame(){
    if(stopped) return;
    raf = requestAnimationFrame(frame);
    const now = performance.now(), el = now - t0, t = Math.max(0, el / 1000);
    let cx = .5, cy = .5, r = K.r0;
    const moving = P && (ph === 'run' || ph === 'out' || ph === 'safe') && el > 0;
    if(moving){ const p = at(P, distAt(Math.min(t, CAP_MS / 1000))); cx = p[0]; cy = p[1]; r = radAt(Math.min(t, CAP_MS / 1000)); }
    const inside = touch && Math.hypot(fx - cx, fy - cy) <= r;
    if(ph === 'cd' && el >= 0){ ph = 'run'; say('', ''); PF.show(false); E.audio.beep(988, .1, .2); E.vibrate(40); chips(); }
    if(ph === 'run'){
      if(el >= CAP_MS){ ph = 'safe'; myMs = CAP_MS; say('60秒 耐えた!', 'すごい! みんなを待ってるよ…'); fxOn(); PF.slam('クリア!', { color: 0x8ce65a, size: 56 }); E.audio.beep(1175, .2, .25); }
      else{
        if(!touch){ if(!liftSince) liftSince = now; if(now - liftSince > (el < START_GRACE ? START_GRACE : LIFT_MS)) out(liftSince, '指が離れた'); }
        else liftSince = 0;
        if(ph === 'run' && touch && !inside){ if(!outSince) outSince = now; if(now - outSince > OUT_MS) out(outSince, '輪から出た'); }
        else outSince = 0;
        const s = Math.floor(t);
        if(ph === 'run' && s !== lastT){ lastT = s; $('tr-top').textContent = 'TRACE — ' + s + ' 秒'; }
      }
    }
    draw(cx, cy, r, inside, t, moving);
  }
  function draw(cx, cy, r, inside, t, moving){
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, A, A);
    // この先の道(約1秒ぶん)
    if(moving && t * 1000 < CAP_MS){
      const s0 = distAt(t), v = K.v0 + K.a * t;
      g.beginPath();
      for(let i = 0; i <= 24; i++){ const p = at(P, s0 + v * 1.1 * i / 24); if(i) g.lineTo(p[0] * A, p[1] * A); else g.moveTo(p[0] * A, p[1] * A); }
      g.strokeStyle = 'rgba(140,230,90,.22)'; g.lineWidth = Math.max(4, r * A * .5); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
    }
    // 輪
    const col = ph === 'out' ? '#ff453a' : ph === 'run' && !inside ? '#ff9f0a' : ACC;
    g.beginPath(); g.arc(cx * A, cy * A, r * A, 0, Math.PI * 2);
    g.fillStyle = ph === 'run' && inside ? 'rgba(140,230,90,.18)' : 'rgba(140,230,90,.08)'; g.fill();
    g.lineWidth = 4; g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;
    // 指
    if(touch){ g.beginPath(); g.arc(fx * A, fy * A, 7, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
  }
  function onGo(m){
    if(ph !== 'wait' || !Number.isInteger(m.seed) || m.seed < 0 || m.seed > 4294967295 || !Number.isFinite(m.at)) return;
    P = mkPath(m.seed); t0 = E.toLocal(m.at); ph = 'cd';
    let last = -1;
    const tick = () => {
      if(stopped || ph !== 'cd') return;
      const left = t0 - performance.now(); if(left <= 0) return;
      const s = Math.ceil(left / 1000);
      if(s !== last){ last = s; say(String(s), touch ? '指はそのまま。動き出したら追いかけて!' : '輪の中に指を置いて待とう'); E.audio.beep(520, .06, .14); }
      later(tick, Math.min(100, left));
    };
    tick();
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'go') onGo(m);
    else if(m.t === 'al' && Array.isArray(m.outs)){
      m.outs.slice(0, 8).forEach(x => {
        if(!Array.isArray(x) || !Number.isInteger(x[0]) || !Number.isFinite(x[1]) || outs.has(x[0])) return;
        outs.set(x[0], x[1]);
        if(x[0] !== E.myId && (ph === 'run' || ph === 'out' || ph === 'safe')){ E.audio.beep(330, .08, .1); if(ph !== 'run') flash(E.nameOf(x[0]) + ' アウト'); }
      });
      chips();
    }
    else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  // 遊んでいる最中は文字を大きく出さない(集中できるように)。アウトのあとだけ出す
  function flash(t){ $('tr-sub').textContent = t; }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && Number.isFinite(x[1]) && x[1] >= -1 && x[1] <= CAP_MS).slice(0, 8);
    if(!rows.length) return;
    if(ph === 'run'){ ph = 'safe'; }            // 最後まで残った
    later(() => { cancelAnimationFrame(raf); raf = 0; }, 600);
    fxOn();
    const lines = []; let pl = 0;
    rows.forEach((x, i) => {
      if(i === 0 || x[1] !== rows[i - 1][1]) pl = i + 1;
      lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: x[1] < 0 ? '最後まで残った' : (x[1] / 1000).toFixed(2) + '秒', cls: '' });
    });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = l.pl === 1 ? 'win' : (l.pl === maxPl && maxPl > 1 ? 'lose' : ''); });
    const tops = lines.filter(l => l.pl === 1);
    const pen = tops.length > 1 ? '同率1位: ' + tops.map(l => E.nameOf(l.id)).join('・') : tops.some(l => l.id === E.myId) ? 'あなたの勝ち' : E.nameOf(tops[0].id) + ' の勝ち';
    later(() => reveal(lines, pen, tops.some(l => l.id === E.myId)), 900);
  }
  // 順位発表: 下の順位から出して、最後に1位
  function reveal(lines, pen, iWin){
    E.showResult({ title: 'TRACE', reason: '輪から出ずに、どれだけ耐えたか', pen: '', lines: [], stats: '', hold: true });
    const box = $('r-lines'), penEl = $('r-pen'), n = lines.length, shown = [];
    const put = () => {
      box.textContent = '';
      lines.forEach((l, i) => {
        if(!shown[i]) return;
        const d = document.createElement('div'); if(l.cls) d.className = l.cls;
        const a = document.createElement('span'), b = document.createElement('span'); a.textContent = l.a; b.textContent = l.b;
        d.appendChild(a); d.appendChild(b); box.appendChild(d);
        if(shown[i] === 2){ d.classList.add('pop'); shown[i] = 1; later(() => PF.rowIn(d, l.cls === 'win' ? 'win' : l.cls === 'lose' ? 'lose' : ''), 60); }
      });
    };
    let i = n - 1;
    const next = () => {
      if(i > 0){ shown[i] = 2; put(); E.audio.beep(500 + (n - i) * 40, .12, .2); E.vibrate(25); i--; later(next, 700); return; }
      penEl.textContent = '……';
      const DR = 1600, steps = Math.floor(DR / 130);
      for(let s = 0; s < steps; s++) later(() => { E.audio.beep(300 + s * 25, .09, .12); penEl.textContent = s % 8 < 4 ? '……' : '… … …'; }, s * 130);
      later(() => {
        shown[0] = 2; put(); penEl.textContent = pen;
        E.$('r-stats').textContent = '耐えた時間は、自分のスマホの中で測っているよ(通信の遅れは入らない)';
        E.audio.beep(988, .2, .25); later(() => E.audio.beep(1319, .25, .25), 140);
        PF.confetti(iWin ? 150 : 80); if(iWin) E.vibrate([80, 60, 80, 60, 200]);
        E.resultBtns(1200);
      }, DR);
    };
    later(next, 500);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { ph: 'idle', seed: 0, at: 0, ids: [], out: new Map(), endT: 0, capT: 0 };
  function hostStart(){
    H.seed = rnd32(); H.at = performance.now() + LEAD_MS; H.ph = 'run'; H.out = new Map(); H.ids = E.players().map(p => p.id);
    E.hostBcast({ t: 'go', seed: H.seed, at: H.at }, true);
    clearTimeout(H.capT); H.capT = setTimeout(finalize, LEAD_MS + CAP_MS + 1500);
  }
  function aliveIds(){ const h = new Set(E.players().map(p => p.id)); return H.ids.filter(id => h.has(id) && !H.out.has(id)); }
  function checkEnd(){ if(H.ph === 'run' && aliveIds().length <= 1 && !H.endT) H.endT = setTimeout(finalize, END_WAIT); }
  function hostOnMsg(id, m){
    if(!m || m.t !== 'out' || H.ph !== 'run' || H.out.has(id) || !H.ids.includes(id)) return;
    if(!Number.isFinite(m.ms) || m.ms < 0 || m.ms > CAP_MS + 1000) return;
    H.out.set(id, Math.min(CAP_MS, Math.round(m.ms)));
    E.hostBcast({ t: 'al', outs: Array.from(H.out.entries()) }, true);
    checkEnd();
  }
  function hostOnLeave(){ checkEnd(); }
  function finalize(){
    if(H.ph !== 'run') return;
    H.ph = 'done'; clearTimeout(H.capT); clearTimeout(H.endT);
    const h = new Set(E.players().map(p => p.id)), ids = H.ids.filter(id => h.has(id));
    const surv = ids.filter(id => !H.out.has(id)), gone = ids.filter(id => H.out.has(id)).sort((a, b) => H.out.get(b) - H.out.get(a));
    const rows = surv.map(id => [id, -1]).concat(gone.map(id => [id, H.out.get(id)]));
    E.hostBcast({ t: 'res', rows }, true);
    // MIX 用の順位: 残った人が同じ1位。あとは耐えた時間が長い順(同じ時間は同じ順位)
    if(E.rank){
      const gs = []; if(surv.length) gs.push(surv.slice());
      gone.forEach((id, i) => { if(i > 0 && H.out.get(id) === H.out.get(gone[i - 1])) gs[gs.length - 1].push(id); else gs.push([id]); });
      E.rank(gs);
    }
  }
  function stop(){
    stopped = true; clearTimeout(H.capT); clearTimeout(H.endT); cancelAnimationFrame(raf); PF.show(false);
    timers.forEach(t => clearTimeout(t));
    window.removeEventListener('resize', fit);
    cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove);
    cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
