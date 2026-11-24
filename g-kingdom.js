/* KINGDOM 国とり オンライン(ホストが審判)
 *
 * ルール
 *  1. 円い地図(人数×2の区画 × 外側・内側の2列 + まん中の王都)。外側の区画は、ひとつおきに各自の城、あいだは村
 *  2. 全員、城1つと部隊2つ(兵4ずつ)からスタート
 *  3. 毎ターン、部隊ごとに「となりへ動く」か「とどまる」をこっそり決める(30秒。ハードは20秒)。全員同時に動く
 *  4. 同じ場所に入るか、道ですれちがうと戦い。兵の多い方が勝ち、負けた側の兵の半分を捕虜として自分の部隊に入れる
 *  5. 部隊だけがいる場所は、その人の領地になる(去ったあとも、だれかが来るまで自分のもの)
 *     城には守備兵(7)と守り(+2)がいて、部隊がいなくても戦う(守備兵は部隊には加わらない)。王都には はじめ守備兵が5
 *  6. 毎ターンのはじめに、領地の数だけ兵が増えて、自分の部隊に分けて入る(城・王都は2、ほかは1)。部隊がなければ、城に新しい部隊
 *  7. 毎ターンの終わりに、持っている領地で点が入る(王都3・城2・ほか1)。決めたターン数で終わり、点の合計で順位
 *  8. 約束・同盟・うらぎりは自由(口で)
 *
 * シミュレーション(CPU の作戦4つ: 広げる・攻める・こもる・王都をねらう。8ターン):
 *   最初の形(地域ごとに兵を置く)は動きがなかった(城が落ちるのは1〜2%)→ 部隊を動かす形に
 *   空いた城にそのまま入れて、こもる作戦が強すぎた → 城の守備兵・捕虜・王都の点を調整
 *   いまは 4人で22〜29%(平均25%)・6人で14〜19%(平均17%)・8人で10〜15%(平均13%)。城を落とされる人は約4割、戦いは1ゲーム4〜14回
 *
 * 公平さ: 命令は全員がそろうまでホストだけが持つ(公開まで、だれにも見えない)。戦いの計算もホストだけ。
 *   命令は時間内に出せばよいので、押す速さや通信の遅れは関係ない。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const CFG = {
  THINK_MS: 30000, HARD_MS: 20000, FIRST_PLUS: 10000,   // 考える時間(1ターン目は少し長く)
  GRACE: 800, SHOW_MS: 4200, READY_MS: 1200,            // 通信の遅れのぶん / 結果を見せる時間 / 全員が決定してから動くまで
  START: 4, ARMIES: 2, GAR: 5, CG: 7, CASTLE_B: 2, PRI: .5,
  TURNS: [6, 8, 10]
};
const INC = { castle: 2, capital: 2, village: 1, field: 1 };    // 毎ターン増える兵
const VAL = { castle: 2, capital: 3, village: 1, field: 1 };    // 毎ターンの点
const KNM = { castle: '城', capital: '王都', village: '村', field: '野' };
const COL = ['#ff453a', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6fb1', '#e8e8ee'];

// 地図: 外側 0..S-1(偶数=城 / 奇数=村)・内側 S..2S-1(野)・王都 2S。S = 人数×2
function mkMap(N){
  const S = 2 * N, R = [];
  for(let i = 0; i < S; i++) R.push({ k: i % 2 === 0 ? 'castle' : 'village', s: i, ring: 0, adj: [] });
  for(let i = 0; i < S; i++) R.push({ k: 'field', s: i, ring: 1, adj: [] });
  R.push({ k: 'capital', s: -1, ring: 2, adj: [] });
  const link = (a, b) => { if(a === b || R[a].adj.includes(b)) return; R[a].adj.push(b); R[b].adj.push(a); };
  for(let i = 0; i < S; i++){ link(i, S + i); link(i, (i + 1) % S); link(S + i, S + (i + 1) % S); link(S + i, 2 * S); }
  return { S, R, CAP: 2 * S };
}

window.NomiGames.kingdom = { id: 'kingdom', name: 'KINGDOM', _map: mkMap, _cfg: CFG, make(E){
  const $ = E.$, PF = E.fx, NS = 'http://www.w3.org/2000/svg';
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };
  const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

  // =====================================================================
  //  参加者側(表示と命令)
  // =====================================================================
  let ph = 'wait', M = null, N = 0, ids = [], me = -1, k = 0, K = 8, own = [], ar = [], gar = 0, sc = [];
  let orders = new Map(), selA = -1, rd = false, nonce = 0, dl = 0, barMs = 1, barT = 0, readyIds = new Set(), rev = false;
  let svg = null, gR = null, gA = null, gT = null, gF = null, rot = 0;
  const regEl = [];
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); if(attrs) Object.keys(attrs).forEach(a => e.setAttribute(a, attrs[a])); return e; };
  const ang = s => rot + s * 2 * Math.PI / M.S;
  function center(i){
    const r = M.R[i]; if(r.ring === 2) return [0, 0];
    const a = ang(r.s), rr = r.ring === 0 ? 80 : 46;
    return [rr * Math.cos(a), rr * Math.sin(a)];
  }
  function wedge(r0, r1, a0, a1){
    const p = (r, a) => (r * Math.cos(a)).toFixed(2) + ' ' + (r * Math.sin(a)).toFixed(2);
    return 'M' + p(r1, a0) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + p(r1, a1) + ' L' + p(r0, a1) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + p(r0, a0) + ' Z';
  }
  function build(){
    const box = $('kg-map'); box.textContent = ''; regEl.length = 0;
    svg = el('svg', { viewBox: '-100 -100 200 200', class: 'kg-svg' });
    gR = el('g'); gA = el('g'); gT = el('g'); gF = el('g');
    const half = Math.PI / M.S;
    M.R.forEach((r, i) => {
      const d = r.ring === 2 ? 'M 0 -29 A 29 29 0 1 1 0 29 A 29 29 0 1 1 0 -29 Z' : r.ring === 0 ? wedge(62, 98, ang(r.s) - half, ang(r.s) + half) : wedge(30, 62, ang(r.s) - half, ang(r.s) + half);
      const p = el('path', { d, class: 'kgr k-' + r.k });
      p.addEventListener('click', () => tapRegion(i));
      gR.appendChild(p);
      const c = center(i), lb = el('text', { x: c[0].toFixed(1), y: (c[1] + (r.ring === 2 ? 15 : 13)).toFixed(1), class: 'kgl' });
      lb.textContent = r.k === 'field' ? '' : KNM[r.k];
      gR.appendChild(lb);
      regEl.push({ p, lb });
    });
    svg.appendChild(gR); svg.appendChild(gA); svg.appendChild(gT); svg.appendChild(gF);
    box.appendChild(svg);
  }
  function say(big, sub){ $('kg-big').textContent = big || ''; $('kg-sub').textContent = sub || ''; }
  function chips(){
    const box = $('kg-chips'); box.textContent = '';
    ids.forEach((id, p) => {
      const c = document.createElement('span'); c.className = 'chip kgc' + (ph === 'order' && readyIds.has(id) ? ' on' : '');
      const dot = document.createElement('i'); dot.style.background = COL[p % 8]; c.appendChild(dot);
      const t = document.createElement('span'); t.textContent = (ph === 'order' && readyIds.has(id) ? '✓ ' : '') + E.nameOf(id) + (id === E.myId ? '(あなた)' : '') + '  ' + (sc[p] || 0) + '点';
      c.appendChild(t); box.appendChild(c);
    });
  }
  function renderMap(){
    if(!svg) return;
    const can = new Set();
    if(selA >= 0){ const a = ar.find(x => x.id === selA); if(a){ can.add(a.at); M.R[a.at].adj.forEach(j => can.add(j)); } }
    M.R.forEach((r, i) => {
      const o = own[i], e = regEl[i];
      e.p.setAttribute('class', 'kgr k-' + r.k + (o === me && me >= 0 ? ' mine' : '') + (can.has(i) ? ' can' : ''));
      e.p.style.fill = o >= 0 ? COL[o % 8] : '';
      e.p.style.fillOpacity = o >= 0 ? (r.k === 'castle' && r.s === 2 * o ? '.5' : '.3') : '';
    });
    // 部隊
    gT.textContent = ''; gA.textContent = '';
    const byAt = new Map(); ar.forEach(a => { if(!byAt.has(a.at)) byAt.set(a.at, []); byAt.get(a.at).push(a); });
    byAt.forEach((list, at) => list.forEach((a, j) => gT.appendChild(token(a, tokPos(at, j, list.length)))));
    // 自分の命令(矢印)
    orders.forEach((to, aid) => {
      const a = ar.find(x => x.id === aid); if(!a || to === a.at) return;
      const [x0, y0] = center(a.at), [x1, y1] = center(to), dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const sx = x0 + ux * 11, sy = y0 + uy * 11, ex = x1 - ux * 6, ey = y1 - uy * 6;
      gA.appendChild(el('line', { x1: sx.toFixed(1), y1: sy.toFixed(1), x2: ex.toFixed(1), y2: ey.toFixed(1), class: 'kga' }));
      const px = -uy * 4, py = ux * 4;
      gA.appendChild(el('polygon', { points: [ex + ux * 5, ey + uy * 5, ex + px, ey + py, ex - px, ey - py].map(v => v.toFixed(1)).join(' '), class: 'kgh' }));
    });
  }
  function tokPos(at, j, n){
    const c = center(at); if(n <= 1) return c;
    const r = M.R[at], a = r.ring === 2 ? 0 : ang(r.s) + Math.PI / 2, off = (j - (n - 1) / 2) * 15;
    return [c[0] + Math.cos(a) * off, c[1] + Math.sin(a) * off];
  }
  function token(a, pos){
    const g = el('g', { class: 'kgt' + (a.p === me ? ' mine' : '') + (a.id === selA ? ' sel' : ''), transform: 'translate(' + pos[0].toFixed(1) + ' ' + pos[1].toFixed(1) + ')' });
    const c = el('circle', { r: 9 }); c.style.fill = COL[a.p % 8]; g.appendChild(c);
    const t = el('text', { y: '3.6' }); t.textContent = String(a.n); g.appendChild(t);
    return g;
  }
  function panel(){
    const box = $('kg-list'); box.textContent = '';
    const mine = ar.filter(a => a.p === me);
    if(me < 0){ $('kg-ok').disabled = true; return; }
    if(!mine.length){ const d = document.createElement('div'); d.className = 'kgo none'; d.textContent = '部隊がいない(城を持っていれば、次のターンに城で新しい部隊ができる)'; box.appendChild(d); }
    mine.forEach((a, i) => {
      const to = orders.has(a.id) ? orders.get(a.id) : a.at;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kgo' + (a.id === selA ? ' sel' : '');
      const n = document.createElement('b'); n.textContent = '部隊' + (i + 1) + '(兵' + a.n + ')';
      const s = document.createElement('span'); s.textContent = to === a.at ? KNM[M.R[a.at].k] + 'に とどまる' : KNM[M.R[to].k] + 'へ 動く';
      b.appendChild(n); b.appendChild(s);
      b.addEventListener('click', () => { if(ph !== 'order') return; selA = selA === a.id ? -1 : a.id; E.audio.init(); E.audio.beep(520, .04, .1); renderMap(); panel(); hint(); });
      box.appendChild(b);
    });
    $('kg-ok').disabled = ph !== 'order';
    $('kg-ok').textContent = rd ? '決定ずみ(変えるときは部隊をタップ)' : '決定!';
    $('kg-ok').classList.toggle('on', rd);
  }
  function hint(){
    let t = '';
    if(ph === 'order') t = selA >= 0 ? '光っている場所をタップ(今いる場所なら、とどまる)' : '地図の自分の部隊(または下の一覧)をタップして、動く先を決める';
    $('kg-hint').textContent = t;
  }
  function tapRegion(i){
    if(stopped || ph !== 'order' || me < 0) return;
    if(selA >= 0){
      const a = ar.find(x => x.id === selA);
      if(a && (i === a.at || M.R[a.at].adj.includes(i))){
        orders.set(a.id, i); selA = -1; rd = false; sendOrders();
        E.audio.init(); E.audio.beep(i === a.at ? 440 : 660, .06, .14); E.vibrate(15);
        renderMap(); panel(); hint(); return;
      }
    }
    // 自分の部隊がいる場所なら、その部隊を選ぶ(2つあれば交互に)
    const here = ar.filter(a => a.p === me && a.at === i);
    if(here.length){ const j = here.findIndex(a => a.id === selA); selA = here[(j + 1) % here.length].id; if(j === here.length - 1) selA = -1; E.audio.init(); E.audio.beep(520, .04, .1); }
    else selA = -1;
    renderMap(); panel(); hint();
  }
  function sendOrders(){
    const o = Array.from(orders.entries()).filter(([aid]) => ar.some(a => a.id === aid && a.p === me));
    E.send({ t: 'or', k, o, rd: rd ? 1 : 0, n: ++nonce }, true);
  }
  const onOk = () => { if(stopped || ph !== 'order') return; rd = !rd; selA = -1; sendOrders(); E.audio.init(); E.audio.beep(rd ? 880 : 440, .08, .16); E.vibrate(20); renderMap(); panel(); hint(); };
  $('kg-ok').addEventListener('click', onOk);
  function bar(ms){
    dl = performance.now() + ms; barMs = Math.max(1, ms);
    clearInterval(barT);
    const e = $('kg-bar').firstElementChild;
    const tick = () => {
      if(stopped){ clearInterval(barT); return; }
      const left = Math.max(0, dl - performance.now());
      e.style.transform = 'scaleX(' + Math.min(1, left / barMs).toFixed(3) + ')';
      if(ph === 'order') $('kg-big').textContent = 'のこり ' + Math.ceil(left / 1000) + ' 秒';
      if(left <= 0) clearInterval(barT);
    };
    tick(); barT = setInterval(tick, 200); timers.push(barT);
  }
  function onBegin(){
    stopped = false; ph = 'wait'; M = null; svg = null; ids = []; me = -1; k = 0; own = []; ar = []; sc = []; orders = new Map(); selA = -1; rd = false; readyIds = new Set();
    $('kg-top').textContent = 'KINGDOM — 国とり';
    $('kg-map').textContent = ''; $('kg-list').textContent = ''; $('kg-log').textContent = '';
    say('準備中…', ''); chips(); E.show('s-kingdom');
    PF.load(); PF.show(true, { amb: [0xf2c14e, 0xffe08a, 0xffffff] });
  }
  // ホストから届いた盤面を確かめる
  function okState(m){
    if(!isInt(m.N, 2, 8) || !Array.isArray(m.ids) || m.ids.length !== m.N || !m.ids.every(x => Number.isInteger(x))) return null;
    const mp = mkMap(m.N), C = mp.R.length;
    if(!Array.isArray(m.own) || m.own.length !== C || !m.own.every(o => isInt(o, -1, m.N - 1))) return null;
    if(!Array.isArray(m.ar) || m.ar.length > 4 * m.N) return null;
    const a = []; for(const x of m.ar){ if(!Array.isArray(x) || !isInt(x[0], 0, 1e6) || !isInt(x[1], 0, m.N - 1) || !isInt(x[2], 0, C - 1) || !isInt(x[3], 1, 9999)) return null; a.push({ id: x[0], p: x[1], at: x[2], n: x[3] }); }
    if(!Array.isArray(m.sc) || m.sc.length !== m.N || !m.sc.every(v => isInt(v, 0, 99999)) || !isInt(m.gar, 0, 99)) return null;
    return { mp, a };
  }
  function onState(m){
    if(!isInt(m.k, 1, 99) || !isInt(m.K, 1, 99) || m.k <= k || !Number.isFinite(m.ms)) return;
    const st = okState(m); if(!st) return;
    const first = !M || M.S !== st.mp.S;
    M = st.mp; N = m.N; ids = m.ids.slice(); me = ids.indexOf(E.myId); k = m.k; K = m.K; own = m.own.slice(); ar = st.a; gar = m.gar; sc = m.sc.slice(); rev = m.rev === 1;
    if(first){ rot = Math.PI / 2 - (me >= 0 ? 2 * me : 0) * 2 * Math.PI / M.S; build(); }
    ph = 'order'; orders = new Map(); selA = -1; rd = false; readyIds = new Set();
    $('kg-top').textContent = 'TURN ' + k + ' / ' + K + (rev ? '(最下位決定)' : '');
    $('kg-sub').textContent = me < 0 ? '観戦中' : '部隊の動く先を決めよう(命令は公開まで見えない)';
    $('kg-log').textContent = '';
    renderMap(); panel(); hint(); chips();
    bar(Math.max(1000, Math.min(CFG.THINK_MS + CFG.FIRST_PLUS, m.ms)));
    E.audio.beep(660, .08, .16); later(() => E.audio.beep(880, .1, .16), 90); E.vibrate([30, 40, 30]);
  }
  // ---- 結果: 動く → 戦い → 新しい地図 ----
  function onResult(m){
    if(m.k !== k || ph !== 'order') return;
    const st = okState(Object.assign({}, m, { N, ids, K })); if(!st) return;
    const mv = Array.isArray(m.mv) ? m.mv.filter(x => Array.isArray(x) && isInt(x[0], 0, 1e6) && isInt(x[1], 0, M.R.length - 1) && isInt(x[2], 0, M.R.length - 1)) : [];
    const bt = Array.isArray(m.bt) ? m.bt.filter(x => Array.isArray(x) && isInt(x[0], 0, M.R.length - 1) && Number.isInteger(x[1]) && Array.isArray(x[2])).slice(0, 40) : [];
    const cap = Array.isArray(m.cap) ? m.cap.filter(x => Array.isArray(x) && isInt(x[0], 0, M.R.length - 1) && isInt(x[1], -1, N - 1) && isInt(x[2], -1, N - 1)).slice(0, 16) : [];
    ph = 'show'; clearInterval(barT); $('kg-bar').firstElementChild.style.transform = 'scaleX(0)';
    orders = new Map(); selA = -1; panel(); hint();
    say('オープン!', '');
    E.audio.beep(392, .12, .2);
    // 1) 全員の部隊が動く(前の兵の数のまま)
    const before = ar.slice(), moves = new Map(mv.map(x => [x[0], x]));
    gA.textContent = '';
    gT.textContent = '';
    const toks = before.map(a => { const g = token(a, center(a.at)); gT.appendChild(g); return { a, g, x: moves.get(a.id) }; });
    const t0 = performance.now(), D = 900;
    const step = () => {
      if(stopped) return;
      const f = Math.min(1, (performance.now() - t0) / D), e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      toks.forEach(t => {
        const from = center(t.a.at), to = t.x ? center(t.x[2]) : from;
        t.g.setAttribute('transform', 'translate(' + (from[0] + (to[0] - from[0]) * e).toFixed(1) + ' ' + (from[1] + (to[1] - from[1]) * e).toFixed(1) + ')');
      });
      if(f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // 2) 戦い
    later(() => {
      if(!bt.length) return;
      bt.forEach(x => {
        const c = center(x[0]), t = el('text', { x: c[0].toFixed(1), y: (c[1] + 5).toFixed(1), class: 'kgx' }); t.textContent = '⚔'; gF.appendChild(t);
        later(() => t.remove(), 1400);
      });
      E.audio.boom(.35); E.vibrate([0, 80, 40, 80]);
      say('戦い!', bt.length + 'か所');
    }, D + 100);
    // 3) 新しい地図と、できごと
    later(() => {
      own = m.own.slice(); ar = st.a; gar = m.gar; sc = m.sc.slice();
      renderMap(); chips();
      const log = [];
      cap.forEach(x => {
        const r = M.R[x[0]];
        if(r.k === 'capital') log.push((x[2] >= 0 ? E.nameOf(ids[x[2]]) : 'だれか') + ' が王都を取った!');
        else if(r.k === 'castle' && x[1] >= 0) log.push(E.nameOf(ids[x[1]]) + ' の城が ' + (x[2] >= 0 ? E.nameOf(ids[x[2]]) : 'だれか') + ' に落とされた!');
      });
      bt.forEach(x => {
        if(M.R[x[0]].k === 'castle' && cap.some(c => c[0] === x[0])) return;
        const sides = x[2].filter(s => Array.isArray(s) && Number.isInteger(s[0])).map(s => s[0] === -9 ? '王都の守備兵' : s[0] >= 0 && s[0] < N ? E.nameOf(ids[s[0]]) : '?');
        const w = x[1] === -9 ? '王都の守備兵' : x[1] >= 0 && x[1] < N ? E.nameOf(ids[x[1]]) : '';
        log.push(KNM[M.R[x[0]].k] + 'で ' + sides.join(' vs ') + (w ? ' → ' + w + ' の勝ち' : ' → 相打ち'));
      });
      const lb = $('kg-log'); lb.textContent = '';
      log.slice(0, 6).forEach(t => { const d = document.createElement('div'); d.textContent = t; lb.appendChild(d); });
      const myCastle = cap.some(x => M.R[x[0]].k === 'castle' && x[1] === me && me >= 0), iTook = cap.some(x => x[2] === me && me >= 0);
      if(myCastle){ PF.slam('落城…', { color: 0xff453a, size: 56 }); E.audio.scare(); E.vibrate([0, 200, 80, 400]); }
      else if(iTook){ PF.slam(cap.some(x => x[2] === me && M.R[x[0]].k === 'capital') ? '王都を取った!' : '城を落とした!', { color: 0xf2c14e, size: 48 }); E.audio.beep(1175, .2, .25); E.vibrate([0, 60, 40, 120]); }
      say(m.over ? 'おわり!' : 'TURN ' + k + ' おわり', me >= 0 ? 'あなた ' + (sc[me] || 0) + '点 / 領地 ' + own.filter(o => o === me).length : '');
    }, D + 1100);
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'ks') onState(m);
    else if(m.t === 'kp' && m.k === k && Array.isArray(m.ids)){ readyIds = new Set(m.ids.filter(Number.isInteger).slice(0, 8)); chips(); }
    else if(m.t === 'kr') onResult(m);
    else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isInt(x[1], 0, 99999) && isInt(x[2], 0, 99)).slice(0, 8);
    if(!rows.length) return;
    ph = 'end'; clearInterval(barT);
    const rv = m.rev === 1, lines = []; let pl = 0;
    rows.forEach((x, i) => { if(i === 0 || x[1] !== rows[i - 1][1] || x[2] !== rows[i - 1][2]) pl = i + 1; lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: x[1] + '点  領地' + x[2], cls: '' }); });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = rv ? (l.pl === maxPl && maxPl > 1 ? 'lose' : '') : (l.pl === 1 ? 'win' : ''); });
    const tops = lines.filter(l => l.pl === 1), lasts = lines.filter(l => l.pl === maxPl && maxPl > 1);
    const iWin = tops.some(l => l.id === E.myId), iLast = lasts.some(l => l.id === E.myId);
    const pen = rv ? (!lasts.length ? '最下位なし' : iLast ? 'あなたが最下位…' : lasts.map(l => E.nameOf(l.id)).join('・') + ' が最下位!')
      : (tops.length > 1 ? '同率1位: ' + tops.map(l => E.nameOf(l.id)).join('・') : iWin ? 'あなたの天下!' : E.nameOf(tops[0].id) + ' の天下!');
    E.showResult({ title: 'KINGDOM', reason: '全' + K + 'ターン' + (rv ? ' — 最下位決定' : ''), pen, lines, stats: '点は毎ターン、持っている領地で入る(王都3・城2・ほか1)。\n同じ点なら、最後の領地が多い方が上。' });
    PF.show(true);
    if(rv){ E.audio.scare(); E.vibrate(iLast ? [0, 200, 80, 400] : [0, 120]); later(() => PF.doom($('r-pen')), 200); }
    else{ if(iWin) E.vibrate([80, 60, 80, 60, 300]); later(() => { const r = $('r-lines').firstElementChild; PF.confetti(140); if(r && tops.length === 1) PF.rowIn(r, 'win'); }, 200); }
  }

  // =====================================================================
  //  ホスト(審判)
  // =====================================================================
  const H = { deadline: 0, ph: 'idle', M: null, N: 0, ids: [], own: [], A: [], gar: 0, k: 0, K: 8, ms: CFG.THINK_MS, sc: [], ord: new Map(), aid: 0, t: 0, rev: false };
  const readOn = (key, ok, d) => { try{ const b = document.querySelector('#l-kingdom button[data-' + key + '].on'); const v = b ? b.dataset[key] : null; return ok(v) ? v : d; }catch(e){ return d; } };
  const presentSlots = () => { const h = new Set(E.players().map(p => p.id)); return H.ids.map((id, p) => h.has(id) ? p : -1).filter(p => p >= 0); };
  function hostStart(){
    H.K = +readOn('t', v => ['6', '8', '10'].includes(v), '8');
    H.ms = readOn('h', v => v === '0' || v === '1', '0') === '1' ? CFG.HARD_MS : CFG.THINK_MS;
    H.rev = readOn('v', v => v === 'top' || v === 'last', 'top') === 'last';
    H.ids = E.players().map(p => p.id).slice(0, 8); H.N = H.ids.length; H.M = mkMap(H.N);
    H.own = H.M.R.map(() => -1); H.A = []; H.aid = 0; H.gar = CFG.GAR; H.k = 0; H.sc = H.ids.map(() => 0);
    for(let p = 0; p < H.N; p++){ H.own[2 * p] = p; for(let j = 0; j < CFG.ARMIES; j++) H.A.push({ id: ++H.aid, p, at: 2 * p, n: CFG.START }); }
    beginTurn();
  }
  const pack = () => ({ N: H.N, ids: H.ids, own: H.own.slice(), ar: H.A.map(a => [a.id, a.p, a.at, a.n]), gar: H.gar, sc: H.sc.slice() });
  function beginTurn(){
    if(stopped) return;
    H.k++; H.ph = 'order'; H.ord = new Map();
    // 兵が増える: 領地のぶんを、自分の部隊に分けて入れる。部隊がなく、城を持っていれば、城に新しい部隊
    presentSlots().forEach(p => {
      const g = H.M.R.reduce((s, r, i) => s + (H.own[i] === p ? INC[r.k] : 0), 0), mine = H.A.filter(a => a.p === p);
      if(!g) return;
      if(!mine.length){
        const home = H.own[2 * p] === p ? 2 * p : H.M.R.findIndex((r, i) => r.k === 'castle' && H.own[i] === p);
        if(home >= 0) H.A.push({ id: ++H.aid, p, at: home, n: g });
        return;
      }
      mine.forEach((a, i) => { a.n += Math.floor(g / mine.length) + (i < g % mine.length ? 1 : 0); });
    });
    const ms = H.ms + (H.k === 1 ? CFG.FIRST_PLUS : 0);
    E.hostBcast(Object.assign({ t: 'ks', k: H.k, K: H.K, ms, rev: H.rev ? 1 : 0 }, pack()), true);
    H.deadline = performance.now() + ms + CFG.GRACE;
    clearTimeout(H.t); H.t = setTimeout(resolve, ms + CFG.GRACE);
  }
  // 部隊のない人は、決定ずみとあつかう
  const allReady = () => presentSlots().every(p => !H.A.some(a => a.p === p) || (H.ord.get(H.ids[p]) || {}).rd);
  function hostOnMsg(id, m){
    if(!m || m.t !== 'or' || H.ph !== 'order' || m.k !== H.k || !Array.isArray(m.o) || !Number.isInteger(m.n)) return;
    const p = H.ids.indexOf(id); if(p < 0) return;
    const was = H.ord.get(id); if(was && m.n <= was.n) return;
    const mv = new Map();
    m.o.slice(0, 8).forEach(x => {
      if(!Array.isArray(x) || !Number.isInteger(x[0]) || !Number.isInteger(x[1])) return;
      const a = H.A.find(y => y.id === x[0] && y.p === p);
      if(a && (x[1] === a.at || H.M.R[a.at].adj.includes(x[1]))) mv.set(a.id, x[1]);
    });
    H.ord.set(id, { mv, rd: m.rd === 1, n: m.n });
    E.hostBcast({ t: 'kp', k: H.k, ids: Array.from(H.ord.entries()).filter(([, o]) => o.rd).map(([i]) => i) }, false);
    clearTimeout(H.t);
    if(allReady()) H.t = setTimeout(resolve, CFG.READY_MS);
    else H.t = setTimeout(resolve, Math.max(0, H.deadline - performance.now()));
  }
  function hostOnLeave(id){
    const p = H.ids.indexOf(id); if(p < 0) return;
    H.A = H.A.filter(a => a.p !== p);
    H.own = H.own.map(o => o === p ? -1 : o);
    if(H.ph === 'order' && allReady()){ clearTimeout(H.t); H.t = setTimeout(resolve, CFG.READY_MS); }
  }
  function resolve(){
    if(H.ph !== 'order') return;
    H.ph = 'show'; clearTimeout(H.t);
    const R = H.M.R, CAP = H.M.CAP;
    const from = new Map(H.A.map(a => [a.id, a.at]));
    H.A.forEach(a => { const o = H.ord.get(H.ids[a.p]); a.to = o && o.mv.has(a.id) ? o.mv.get(a.id) : a.at; });
    const mv = H.A.map(a => [a.id, a.at, a.to]);
    const bt = [], cap = [];
    // すれちがい(A→B と B→A)は道の上で戦う
    for(let i = 0; i < H.A.length; i++) for(let j = i + 1; j < H.A.length; j++){
      const a = H.A[i], b = H.A[j]; if(a.p === b.p || a.n <= 0 || b.n <= 0) continue;
      if(a.to === from.get(b.id) && b.to === from.get(a.id) && a.to !== a.at){
        const m = Math.min(a.n, b.n), an = a.n, bn = b.n; a.n -= m; b.n -= m;
        bt.push([a.to, a.n > 0 ? a.p : b.n > 0 ? b.p : -1, [[a.p, an], [b.p, bn]]]);
      }
    }
    H.A.forEach(a => { if(a.n > 0) a.at = a.to; });
    // 同じ場所に入ったら戦う(城の持ち主には 守備兵 + 守り。王都は、だれも取っていなければ守備兵)
    const byAt = new Map(); H.A.forEach(a => { if(a.n <= 0) return; if(!byAt.has(a.at)) byAt.set(a.at, []); byAt.get(a.at).push(a); });
    byAt.forEach((list, at) => {
      const r = R[at], side = new Map();
      list.forEach(a => side.set(a.p, (side.get(a.p) || 0) + a.n));
      if(at === CAP && H.own[at] === -1 && H.gar > 0) side.set(-9, H.gar);
      const castleOwner = r.k === 'castle' && H.own[at] >= 0 ? H.own[at] : -1;
      if(castleOwner >= 0) side.set(castleOwner, (side.get(castleOwner) || 0) + CFG.CG);
      if(side.size < 2) return;
      const f = Array.from(side.entries()).map(([p, n]) => ({ p, n: n + (p === castleOwner ? CFG.CASTLE_B : 0) })).sort((x, y) => y.n - x.n);
      const w = f[0], lose = f[1].n;
      if(w.n === lose){ list.forEach(a => { a.n = 0; }); if(at === CAP) H.gar = 0; bt.push([at, -1, f.map(x => [x.p, x.n])]); return; }
      bt.push([at, w.p, f.map(x => [x.p, x.n])]);
      list.forEach(a => { if(a.p !== w.p) a.n = 0; });
      if(at === CAP && w.p === -9){ H.gar = Math.max(1, w.n - lose); return; }
      if(at === CAP) H.gar = 0;
      const mine = list.filter(a => a.p === w.p);
      if(!mine.length) return;                                         // 城の守備兵だけで守りきった
      // 城の守備兵と守りは先に戦う(部隊には加わらない)。勝つと、負けた側の兵の半分が捕虜として加わる
      const extra = w.p === castleOwner ? CFG.CG + CFG.CASTLE_B : 0, armyN = w.n - extra;
      const prisoners = Math.floor(f.slice(1).reduce((s, x) => s + (x.p === -9 ? 0 : x.n - (x.p === castleOwner ? CFG.CG + CFG.CASTLE_B : 0)), 0) * CFG.PRI);
      const left = Math.max(1, armyN - Math.max(0, lose - extra)) + prisoners, tot = mine.reduce((s, a) => s + a.n, 0);
      mine.forEach(a => { a.n = Math.max(1, Math.round(a.n * left / tot)); });
    });
    H.A = H.A.filter(a => a.n > 0);
    H.A.forEach(a => { delete a.to; });
    // 部隊が1人分だけいる場所は、その人の領地になる
    const occ = new Map(); H.A.forEach(a => { if(!occ.has(a.at)) occ.set(a.at, new Set()); occ.get(a.at).add(a.p); });
    occ.forEach((ps, at) => {
      if(ps.size !== 1) return;
      const p = Array.from(ps)[0];
      if(at === CAP && H.gar > 0) return;
      if(H.own[at] !== p){ if(R[at].k === 'castle' || R[at].k === 'capital') cap.push([at, H.own[at], p]); H.own[at] = p; }
    });
    // 点: 持っている領地で
    const here = new Set(presentSlots());
    R.forEach((r, i) => { const o = H.own[i]; if(o >= 0 && here.has(o)) H.sc[o] += VAL[r.k]; });
    const over = H.k >= H.K;
    E.hostBcast(Object.assign({ t: 'kr', k: H.k, mv, bt, cap, over: over ? 1 : 0 }, pack()), true);
    clearTimeout(H.t); H.t = setTimeout(over ? final : beginTurn, CFG.SHOW_MS);
  }
  function final(){
    if(H.ph === 'done') return;
    H.ph = 'done'; clearTimeout(H.t);
    const rows = presentSlots().map(p => [H.ids[p], H.sc[p], H.own.filter(o => o === p).length]).sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]));
    E.hostBcast({ t: 'res', rows, rev: H.rev ? 1 : 0 }, true);
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.t); PF.show(false);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    $('kg-ok').removeEventListener('click', onOk);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
