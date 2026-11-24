/* KINGDOM 国づくり オンライン(ホストが審判)
 *
 * ルール
 *  1. 円い地図(人数×2の区画 × 3列 + まん中の王宮の地)。土地は 食・木・石 の3種類で、それぞれに数字(1〜6)がある
 *     2区画×3列の6マスのならび(数字1〜6・資源は2つずつ)を全員ぶんくり返すので、だれのまわりも同じ条件
 *  2. 全員、村2つと 食2・木2・石1 からスタート
 *  3. 毎ターン、サイコロを2つ振る。出た目と同じ数字の土地から、村なら1つ・町なら2つ資源が出る(ぞろ目は2倍)
 *     さらに毎ターン、城から資源が1つ入る(ランダム)
 *  4. 全員がこっそり計画を立てて(30秒。ハードは20秒)、同時に公開する
 *       村: 自分の土地のとなりの空き地に建てる(食1・木2)… 1点
 *       町: 自分の村を町にする(食1・石2)… さらに1点、資源が2倍出る
 *       王宮: まん中に1つだけ。自分の土地のとなりなら建てられる(食2・木2・石3)… 4点
 *       封鎖: ほかの人の土地を1つ(1ターンに1回まで)。次の2回、その土地で目が出たら、資源は自分に入る(木1・石1)
 *       交換: 同じ資源3つを、好きな資源1つに
 *  5. 同じ空き地に同時に村(や王宮)を建てようとしたら、どちらも建たない。使った資源は半分もどる
 *  6. 決めたターン数で終わり。点の多い順に順位(同じ点なら、残りの資源が多い方が上)
 *
 * シミュレーション(CPU の作戦: 村を広げる・町にする・じゃま・バランス。全員が王宮を狙う。12ターン):
 *   最初の形は「王宮を取ると毎ターン資源が増える」で、王宮ねらいが強すぎた(4人で71%)・じゃまは0%
 *   → 王宮は点だけ・封鎖は横取りに・町を安く。いまは 4人で 35% / 13% / 23% / 28%
 *
 * 公平さ: サイコロはホストが振る。計画は全員そろうまでホストだけが持ち、同時に行う。押す速さや通信の遅れは関係ない
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const CFG = {
  THINK_MS: 30000, HARD_MS: 20000, FIRST_PLUS: 10000, GRACE: 800, SHOW_MS: 4500, READY_MS: 1200,
  START: [2, 2, 1], BASE: 1, BLK_N: 2, TURNS: ['9', '12', '15']
};
const RES = ['食', '木', '石'], RCOL = ['#ffd60a', '#30d158', '#a9b0bd'];
const COST = { v: [1, 2, 0], t: [1, 0, 2], p: [2, 2, 3], b: [0, 1, 1] };
const PTS = { v: 1, t: 1, p: 4 };
const ANM = { v: '村', t: '町', p: '王宮', b: '封鎖' };
const COL = ['#ff453a', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6fb1', '#e8e8ee'];

// 地図: マス番号 = 列×S + 区画(列0=外側)。王宮の地 = 3S。pat: 6マスぶんの [数字, 資源]
function mkMap(N, pat){
  const S = 2 * N, C = [];
  for(let ring = 0; ring < 3; ring++) for(let s = 0; s < S; s++){ const j = (s % 2) * 3 + ring; C.push({ ring, s, n: pat[j][0], r: pat[j][1], adj: [] }); }
  C.push({ ring: 3, s: -1, n: 0, r: -1, adj: [] });
  const id = (ring, s) => ring * S + ((s + S) % S);
  const link = (a, b) => { if(a !== b && !C[a].adj.includes(b)){ C[a].adj.push(b); C[b].adj.push(a); } };
  for(let s = 0; s < S; s++){ for(let ring = 0; ring < 3; ring++){ link(id(ring, s), id(ring, s + 1)); if(ring < 2) link(id(ring, s), id(ring + 1, s)); } link(id(2, s), 3 * S); }
  return { S, C, CAP: 3 * S };
}
const okPat = pat => Array.isArray(pat) && pat.length === 6 && pat.every(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 1 && x[0] <= 6 && Number.isInteger(x[1]) && x[1] >= 0 && x[1] <= 2);
const canPay = (r, c) => r.every((v, i) => v >= c[i]);
const pay = (r, c) => c.forEach((v, i) => { r[i] -= v; });
// 計画を、ターンのはじめの状態から順に試す(ホストも参加者も同じ計算)。st: { own, lv, blk, pal }。返り値: 行える行動と、残りの資源
function tryPlan(M, st, p, res0, acts){
  const r = res0.slice(), ok = [], mine = new Set(); let blkUsed = false;
  st.own.forEach((o, i) => { if(o === p) mine.add(i); });
  const nearMine = i => M.C[i].adj.some(j => mine.has(j));
  const used = new Set();
  for(const a of acts){
    if(!Array.isArray(a) || typeof a[0] !== 'string') continue;
    if(a[0] === 'x'){ const g = a[1], w = a[2]; if(!Number.isInteger(g) || !Number.isInteger(w) || g < 0 || g > 2 || w < 0 || w > 2 || g === w || r[g] < 3) continue; r[g] -= 3; r[w] += 1; ok.push(['x', g, w]); continue; }
    const i = a[1]; if(!Number.isInteger(i) || i < 0 || i >= M.C.length || used.has(a[0] + i)) continue;
    const c = M.C[i], k = a[0];
    if(k === 'v'){ if(i === M.CAP || st.own[i] >= 0 || !nearMine(i) || !canPay(r, COST.v)) continue; }
    else if(k === 't'){ if(st.own[i] !== p || st.lv[i] !== 1 || i === M.CAP || !canPay(r, COST.t)) continue; }
    else if(k === 'p'){ if(i !== M.CAP || st.pal >= 0 || st.own[i] >= 0 || !nearMine(i) || !canPay(r, COST.p)) continue; }
    else if(k === 'b'){ if(blkUsed || i === M.CAP || st.own[i] < 0 || st.own[i] === p || st.blk[i] > 0 || !canPay(r, COST.b)) continue; blkUsed = true; }
    else continue;
    if(c === undefined) continue;
    pay(r, COST[k]); used.add(k + i); ok.push([k, i]);
  }
  return { ok, r };
}

window.NomiGames.kingdom = { id: 'kingdom', name: 'KINGDOM', _map: mkMap, _try: tryPlan, _cost: COST, _cfg: CFG, make(E){
  const $ = E.$, PF = E.fx, NS = 'http://www.w3.org/2000/svg';
  const rnd32 = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; };
  const rndI = n => Math.floor(rnd32() / 4294967296 * n);
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };
  const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

  // =====================================================================
  //  参加者側(表示と計画)
  // =====================================================================
  let ph = 'wait', M = null, N = 0, ids = [], me = -1, k = 0, K = 12, rev = false;
  let st = null, res = [], pts = [], dice = [0, 0], gain = [];
  let plan = [], sel = -1, rd = false, nonce = 0, dl = 0, barMs = 1, barT = 0, readyIds = new Set(), xg = -1;
  let svg = null, gC = null, gB = null, gP = null, gF = null, rot = 0;
  const cellEl = [];
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); if(attrs) Object.keys(attrs).forEach(a => e.setAttribute(a, attrs[a])); return e; };
  const RAD = [[72, 98], [48, 72], [26, 48]], MID = [85, 60, 37];
  const ang = s => rot + s * 2 * Math.PI / M.S;
  const center = i => { const c = M.C[i]; if(c.ring === 3) return [0, 0]; const a = ang(c.s); return [MID[c.ring] * Math.cos(a), MID[c.ring] * Math.sin(a)]; };
  function wedge(r0, r1, a0, a1){
    const p = (r, a) => (r * Math.cos(a)).toFixed(2) + ' ' + (r * Math.sin(a)).toFixed(2);
    return 'M' + p(r1, a0) + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + p(r1, a1) + ' L' + p(r0, a1) + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + p(r0, a0) + ' Z';
  }
  function build(){
    const box = $('kg-map'); box.textContent = ''; cellEl.length = 0;
    svg = el('svg', { viewBox: '-100 -100 200 200', class: 'kg-svg' });
    gC = el('g'); gB = el('g'); gP = el('g'); gF = el('g');
    const half = Math.PI / M.S;
    M.C.forEach((c, i) => {
      const d = c.ring === 3 ? 'M 0 -25 A 25 25 0 1 1 0 25 A 25 25 0 1 1 0 -25 Z' : wedge(RAD[c.ring][0], RAD[c.ring][1], ang(c.s) - half, ang(c.s) + half);
      const p = el('path', { d, class: 'kgr' + (c.ring === 3 ? ' k-cap' : '') });
      if(c.r >= 0){ p.style.fill = RCOL[c.r]; p.style.fillOpacity = '.13'; }
      p.addEventListener('click', () => tapCell(i));
      gC.appendChild(p);
      const [x, y] = center(i), t = el('text', { x: x.toFixed(1), y: (y + (c.ring === 3 ? -10 : 2.5)).toFixed(1), class: 'kgn' });
      t.textContent = c.ring === 3 ? '王宮' : String(c.n); if(c.r >= 0) t.style.fill = RCOL[c.r];
      gC.appendChild(t);
      cellEl.push(p);
    });
    svg.appendChild(gC); svg.appendChild(gB); svg.appendChild(gP); svg.appendChild(gF);
    box.appendChild(svg);
  }
  function say(big, sub){ $('kg-big').textContent = big || ''; $('kg-sub').textContent = sub || ''; }
  function chips(){
    const box = $('kg-chips'); box.textContent = '';
    ids.forEach((id, p) => {
      const c = document.createElement('span'); c.className = 'chip kgc' + (ph === 'plan' && readyIds.has(id) ? ' on' : '');
      const dot = document.createElement('i'); dot.style.background = COL[p % 8]; c.appendChild(dot);
      const t = document.createElement('span'); t.textContent = (ph === 'plan' && readyIds.has(id) ? '✓ ' : '') + E.nameOf(id) + (id === E.myId ? '(あなた)' : '') + '  ' + (pts[p] || 0) + '点';
      c.appendChild(t); box.appendChild(c);
    });
  }
  // 建物・封鎖・計画の表示
  function renderMap(){
    if(!svg || !st) return;
    gB.textContent = ''; gP.textContent = '';
    const pv = me >= 0 ? tryPlan(M, st, me, res[me] || [0, 0, 0], plan) : { ok: [] };
    M.C.forEach((c, i) => {
      cellEl[i].setAttribute('class', 'kgr' + (c.ring === 3 ? ' k-cap' : '') + (i === sel ? ' sel' : '') + (st.own[i] === me && me >= 0 ? ' mine' : ''));
      const o = st.own[i], [x, y] = center(i);
      if(o >= 0){
        const g = el('g', { transform: 'translate(' + x.toFixed(1) + ' ' + (y + (c.ring === 3 ? 4 : 9)).toFixed(1) + ')', class: 'kgb' });
        if(c.ring === 3){ const crown = el('path', { d: 'M-9 4 L-9 -4 L-4.5 0 L0 -7 L4.5 0 L9 -4 L9 4 Z' }); crown.style.fill = COL[o % 8]; g.appendChild(crown); }
        else if(st.lv[i] >= 2){ const b = el('rect', { x: -6, y: -6, width: 12, height: 12, rx: 2 }); b.style.fill = COL[o % 8]; g.appendChild(b); const t = el('rect', { x: -2.5, y: -10, width: 5, height: 5 }); t.style.fill = COL[o % 8]; g.appendChild(t); }
        else { const b = el('path', { d: 'M-5 5 L-5 -1 L0 -6 L5 -1 L5 5 Z' }); b.style.fill = COL[o % 8]; g.appendChild(b); }
        gB.appendChild(g);
      }
      if(st.blk[i] > 0){ const t = el('text', { x: (x + 8).toFixed(1), y: (y - 4).toFixed(1), class: 'kgk' }); t.textContent = '✕' + st.blk[i]; t.style.fill = COL[st.by[i] % 8]; gB.appendChild(t); }
    });
    // 自分の計画(半透明)
    pv.ok.forEach(a => {
      if(a[0] === 'x') return;
      const [x, y] = center(a[1]), t = el('text', { x: x.toFixed(1), y: (y + (a[0] === 'p' ? 8 : 12)).toFixed(1), class: 'kgq' });
      t.textContent = '+' + ANM[a[0]]; gP.appendChild(t);
    });
  }
  function resLine(){
    const box = $('kg-res'); box.textContent = '';
    if(me < 0 || !res[me]){ return; }
    const pv = tryPlan(M, st, me, res[me], plan);
    RES.forEach((nm, i) => {
      const d = document.createElement('span'); d.className = 'kgres';
      const dot = document.createElement('i'); dot.style.background = RCOL[i]; d.appendChild(dot);
      const t = document.createElement('b'); t.textContent = nm + ' ' + pv.r[i]; d.appendChild(t);
      const g = gain[me] && gain[me][i] ? gain[me][i] : 0;
      if(g && ph === 'plan'){ const e = document.createElement('em'); e.textContent = '+' + g; d.appendChild(e); }
      box.appendChild(d);
    });
  }
  // 選んだマスでできること
  function actions(){
    const box = $('kg-acts'); box.textContent = '';
    if(ph !== 'plan' || me < 0) return;
    const add = (label, cost, fn, on) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'kgab';
      const t = document.createElement('b'); t.textContent = label; b.appendChild(t);
      const s = document.createElement('small'); s.textContent = cost.map((v, i) => v ? RES[i] + v : '').filter(Boolean).join(' '); b.appendChild(s);
      b.disabled = !on; b.addEventListener('click', fn); box.appendChild(b);
    };
    const pv = tryPlan(M, st, me, res[me], plan), left = pv.r;
    if(sel >= 0){
      const c = M.C[sel], o = st.own[sel];
      const test = a => tryPlan(M, st, me, res[me], plan.concat([a])).ok.length > pv.ok.length;
      if(sel === M.CAP){ if(st.pal < 0) add('王宮を建てる(4点)', COST.p, () => addAct(['p', sel]), test(['p', sel])); }
      else if(o < 0) add('村を建てる(1点)', COST.v, () => addAct(['v', sel]), test(['v', sel]));
      else if(o === me && st.lv[sel] === 1) add('町にする(+1点・資源2倍)', COST.t, () => addAct(['t', sel]), test(['t', sel]));
      else if(o !== me) add('封鎖(次の2回を横取り)', COST.b, () => addAct(['b', sel]), test(['b', sel]));
      if(!box.children.length){ const d = document.createElement('div'); d.className = 'kgnote'; d.textContent = c.ring === 3 ? 'もう王宮がある' : 'ここでは何もできない'; box.appendChild(d); }
    }
    // 交換(同じ資源3つ → 好きな資源1つ)
    const xr = document.createElement('div'); xr.className = 'kgx3';
    const lb = document.createElement('span'); lb.textContent = xg < 0 ? '交換: 3つ出す' : RES[xg] + '3つ →'; xr.appendChild(lb);
    RES.forEach((nm, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = nm;
      if(xg < 0) b.disabled = left[i] < 3; else b.disabled = i === xg;
      b.addEventListener('click', () => { if(xg < 0){ xg = i; actions(); } else { addAct(['x', xg, i]); xg = -1; } });
      xr.appendChild(b);
    });
    if(xg >= 0){ const c = document.createElement('button'); c.type = 'button'; c.textContent = 'やめる'; c.className = 'no'; c.addEventListener('click', () => { xg = -1; actions(); }); xr.appendChild(c); }
    box.appendChild(xr);
    // 計画の一覧(タップで取り消し)
    if(plan.length){
      const pl = document.createElement('div'); pl.className = 'kgpl';
      pv.ok.forEach((a, j) => {
        const b = document.createElement('button'); b.type = 'button';
        b.textContent = (a[0] === 'x' ? RES[a[1]] + '3→' + RES[a[2]] + '1' : ANM[a[0]] + (a[0] === 'b' ? '(' + E.nameOf(ids[st.own[a[1]]]) + ')' : '')) + ' ✕';
        b.addEventListener('click', () => { plan.splice(plan.findIndex(x => x[0] === a[0] && x[1] === a[1] && x[2] === a[2]), 1); changed(); });
        pl.appendChild(b);
      });
      box.appendChild(pl);
    }
  }
  function addAct(a){ if(ph !== 'plan') return; plan.push(a); sel = -1; E.audio.init(); E.audio.beep(660, .06, .14); E.vibrate(15); changed(); }
  function changed(){
    plan = tryPlan(M, st, me, res[me], plan).ok;        // 行えないものは外す
    rd = false; sendPlan(); renderMap(); resLine(); actions(); panel();
  }
  function tapCell(i){
    if(stopped || ph !== 'plan' || me < 0) return;
    sel = sel === i ? -1 : i; xg = -1;
    E.audio.init(); E.audio.beep(520, .04, .1);
    renderMap(); actions();
  }
  function panel(){
    $('kg-ok').disabled = ph !== 'plan' || me < 0;
    $('kg-ok').textContent = rd ? '決定ずみ(変えると取り消し)' : '決定!';
    $('kg-ok').classList.toggle('on', rd);
    $('kg-hint').textContent = ph === 'plan' ? '地図のマスをタップして、建てる・封鎖する。計画は公開まで見えない' : '';
  }
  function sendPlan(){ E.send({ t: 'pl', k, a: plan.slice(0, 40), rd: rd ? 1 : 0, n: ++nonce }, true); }
  const onOk = () => { if(stopped || ph !== 'plan') return; rd = !rd; sel = -1; sendPlan(); E.audio.init(); E.audio.beep(rd ? 880 : 440, .08, .16); E.vibrate(20); renderMap(); actions(); panel(); };
  $('kg-ok').addEventListener('click', onOk);
  function bar(ms){
    dl = performance.now() + ms; barMs = Math.max(1, ms);
    clearInterval(barT);
    const e = $('kg-bar').firstElementChild;
    const tick = () => {
      if(stopped){ clearInterval(barT); return; }
      const left = Math.max(0, dl - performance.now());
      e.style.transform = 'scaleX(' + Math.min(1, left / barMs).toFixed(3) + ')';
      if(ph === 'plan') $('kg-big').textContent = 'のこり ' + Math.ceil(left / 1000) + ' 秒';
      if(left <= 0) clearInterval(barT);
    };
    tick(); barT = setInterval(tick, 200); timers.push(barT);
  }
  function showDice(){
    const box = $('kg-dice'); box.textContent = '';
    dice.forEach(v => { const d = document.createElement('b'); d.textContent = String(v); box.appendChild(d); });
  }
  function onBegin(){
    stopped = false; ph = 'wait'; M = null; svg = null; ids = []; me = -1; k = 0; st = null; res = []; pts = []; plan = []; sel = -1; rd = false; readyIds = new Set(); xg = -1;
    $('kg-top').textContent = 'KINGDOM — 国づくり';
    ['kg-map', 'kg-acts', 'kg-log', 'kg-res', 'kg-dice'].forEach(id => { $(id).textContent = ''; });
    say('準備中…', ''); chips(); panel(); E.show('s-kingdom');
    PF.load(); PF.show(true, { amb: [0xf2c14e, 0xffe08a, 0xffffff] });
  }
  // 届いた盤面を確かめる
  function okBoard(m, n, C){
    const arr = (a, lo, hi) => Array.isArray(a) && a.length === C && a.every(v => isInt(v, lo, hi));
    if(!arr(m.own, -1, n - 1) || !arr(m.lv, 0, 2) || !arr(m.blk, 0, 9) || !arr(m.by, -1, n - 1) || !isInt(m.pal, -1, n - 1)) return null;
    const okR = a => Array.isArray(a) && a.length === n && a.every(x => Array.isArray(x) && x.length === 3 && x.every(v => isInt(v, 0, 999)));
    if(!okR(m.res) || !Array.isArray(m.pts) || m.pts.length !== n || !m.pts.every(v => isInt(v, 0, 999))) return null;
    return { own: m.own.slice(), lv: m.lv.slice(), blk: m.blk.slice(), by: m.by.slice(), pal: m.pal };
  }
  function onState(m){
    if(!isInt(m.k, 1, 99) || !isInt(m.K, 1, 99) || m.k <= k || !Number.isFinite(m.ms) || !isInt(m.N, 2, 8) || !Array.isArray(m.ids) || m.ids.length !== m.N || !m.ids.every(Number.isInteger) || !okPat(m.pat)) return;
    if(!Array.isArray(m.dice) || m.dice.length !== 2 || !m.dice.every(v => isInt(v, 1, 6))) return;
    const mp = mkMap(m.N, m.pat), b = okBoard(m, m.N, mp.C.length); if(!b) return;
    const first = !M;
    M = mp; N = m.N; ids = m.ids.slice(); me = ids.indexOf(E.myId); k = m.k; K = m.K; rev = m.rev === 1;
    st = b; res = m.res.map(x => x.slice()); pts = m.pts.slice(); dice = m.dice.slice();
    gain = Array.isArray(m.gain) && m.gain.length === N ? m.gain.map(x => Array.isArray(x) && x.length === 3 && x.every(v => isInt(v, 0, 99)) ? x : [0, 0, 0]) : ids.map(() => [0, 0, 0]);
    if(first){ rot = Math.PI / 2 - (me >= 0 ? 2 * me : 0) * 2 * Math.PI / M.S; build(); }
    ph = 'plan'; plan = []; sel = -1; rd = false; xg = -1; readyIds = new Set();
    $('kg-top').textContent = 'TURN ' + k + ' / ' + K + (rev ? '(最下位決定)' : '');
    showDice();
    const g = me >= 0 ? gain[me] : null, gt = g ? g.map((v, i) => v ? RES[i] + '+' + v : '').filter(Boolean).join(' ') : '';
    $('kg-sub').textContent = me < 0 ? '観戦中' : 'サイコロ ' + dice.join('・') + (gt ? '  → ' + gt : '  → 今回は資源なし');
    $('kg-log').textContent = '';
    renderMap(); resLine(); actions(); panel(); chips();
    bar(Math.max(1000, Math.min(CFG.THINK_MS + CFG.FIRST_PLUS, m.ms)));
    PF.pop($('kg-dice'), { color: 0xf2c14e, power: 1.2 });
    E.audio.beep(660, .08, .16); later(() => E.audio.beep(880, .1, .16), 90); E.vibrate([30, 40, 30]);
  }
  function onResult(m){
    if(m.k !== k || ph !== 'plan' || !M) return;
    const b = okBoard(m, N, M.C.length); if(!b) return;
    const done = Array.isArray(m.done) ? m.done.filter(x => Array.isArray(x) && isInt(x[0], 0, N - 1) && typeof x[1] === 'string' && ANM[x[1]] && isInt(x[2], 0, M.C.length - 1) && (x[3] === 0 || x[3] === 1)).slice(0, 80) : [];
    ph = 'show'; clearInterval(barT); $('kg-bar').firstElementChild.style.transform = 'scaleX(0)';
    plan = []; sel = -1; xg = -1;
    st = b; res = m.res.map(x => x.slice()); pts = m.pts.slice();
    renderMap(); resLine(); actions(); panel(); chips();
    // できごと
    const log = [], who = p => p === me ? 'あなた' : E.nameOf(ids[p]);
    done.forEach(x => {
      const [x0, y0] = center(x[2]);
      if(x[3] === 1){
        const t = el('text', { x: x0.toFixed(1), y: (y0 - 6).toFixed(1), class: 'kgfx' }); t.textContent = x[1] === 'b' ? '✕' : '★'; t.style.fill = COL[x[0] % 8]; gF.appendChild(t); later(() => t.remove(), 1600);
        if(x[1] === 'p') log.push(who(x[0]) + ' が王宮を建てた!');
        else if(x[1] === 'b') log.push(who(x[0]) + ' が ' + who(m.own[x[2]]) + ' の土地を封鎖');
      }else if(x[1] === 'v' || x[1] === 'p') log.push(who(x[0]) + ' の' + ANM[x[1]] + 'は、かぶって建たなかった');
    });
    const cnt = ids.map(() => ({ v: 0, t: 0 }));
    done.forEach(x => { if(x[3] === 1 && (x[1] === 'v' || x[1] === 't')) cnt[x[0]][x[1]]++; });
    cnt.forEach((c, p) => { if(c.v || c.t) log.push(who(p) + ': ' + [c.v ? '村+' + c.v : '', c.t ? '町+' + c.t : ''].filter(Boolean).join(' ')); });
    const lb = $('kg-log'); lb.textContent = '';
    log.slice(0, 8).forEach(t => { const d = document.createElement('div'); d.textContent = t; lb.appendChild(d); });
    const myPal = done.some(x => x[0] === me && x[1] === 'p' && x[3] === 1), hitMe = done.some(x => x[1] === 'b' && x[3] === 1 && m.own[x[2]] === me);
    if(myPal){ PF.slam('王宮!', { color: 0xf2c14e, size: 60 }); PF.confetti(80); E.audio.beep(1175, .2, .25); E.vibrate([0, 60, 40, 120]); }
    else if(hitMe){ E.audio.beep(220, .2, .2); E.vibrate([0, 120, 60, 120]); }
    else E.audio.beep(784, .1, .16);
    say(m.over ? 'おわり!' : 'TURN ' + k + ' おわり', me >= 0 ? 'あなた ' + (pts[me] || 0) + '点' : '');
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'ks') onState(m);
    else if(m.t === 'kp' && m.k === k && Array.isArray(m.ids)){ readyIds = new Set(m.ids.filter(Number.isInteger).slice(0, 8)); chips(); }
    else if(m.t === 'kr') onResult(m);
    else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isInt(x[1], 0, 999) && isInt(x[2], 0, 9999)).slice(0, 8);
    if(!rows.length) return;
    ph = 'end'; clearInterval(barT);
    const rv = m.rev === 1, lines = []; let pl = 0;
    rows.forEach((x, i) => { if(i === 0 || x[1] !== rows[i - 1][1] || x[2] !== rows[i - 1][2]) pl = i + 1; lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: x[1] + '点' + (isInt(x[3], 0, 99) ? '  村' + x[3] : '') + (isInt(x[4], 0, 99) ? '・町' + x[4] : '') + (x[5] === 1 ? '・王宮' : ''), cls: '' }); });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = rv ? (l.pl === maxPl && maxPl > 1 ? 'lose' : '') : (l.pl === 1 ? 'win' : ''); });
    const tops = lines.filter(l => l.pl === 1), lasts = lines.filter(l => l.pl === maxPl && maxPl > 1);
    const iWin = tops.some(l => l.id === E.myId), iLast = lasts.some(l => l.id === E.myId);
    const pen = rv ? (!lasts.length ? '最下位なし' : iLast ? 'あなたが最下位…' : lasts.map(l => E.nameOf(l.id)).join('・') + ' が最下位!')
      : (tops.length > 1 ? '同率1位: ' + tops.map(l => E.nameOf(l.id)).join('・') : iWin ? 'あなたの国が一番!' : E.nameOf(tops[0].id) + ' の国が一番!');
    E.showResult({ title: 'KINGDOM', reason: '全' + K + 'ターン' + (rv ? ' — 最下位決定' : ''), pen, lines, stats: '村1点・町2点・王宮4点。\n同じ点なら、残りの資源が多い方が上。' });
    PF.show(true);
    if(rv){ E.audio.scare(); E.vibrate(iLast ? [0, 200, 80, 400] : [0, 120]); later(() => PF.doom($('r-pen')), 200); }
    else{ if(iWin) E.vibrate([80, 60, 80, 60, 300]); later(() => { const r = $('r-lines').firstElementChild; PF.confetti(140); if(r && tops.length === 1) PF.rowIn(r, 'win'); }, 200); }
  }

  // =====================================================================
  //  ホスト(審判)
  // =====================================================================
  const H = { ph: 'idle', M: null, N: 0, ids: [], pat: null, own: [], lv: [], blk: [], by: [], pal: -1, res: [], pts: [], gain: [], k: 0, K: 12, ms: CFG.THINK_MS, plan: new Map(), t: 0, deadline: 0, rev: false };
  const readOn = (key, ok, d) => { try{ const b = document.querySelector('#l-kingdom button[data-' + key + '].on'); const v = b ? b.dataset[key] : null; return ok(v) ? v : d; }catch(e){ return d; } };
  const presentSlots = () => { const h = new Set(E.players().map(p => p.id)); return H.ids.map((id, p) => h.has(id) ? p : -1).filter(p => p >= 0); };
  const board = () => ({ own: H.own.slice(), lv: H.lv.slice(), blk: H.blk.slice(), by: H.by.slice(), pal: H.pal, res: H.res.map(r => r.slice()), pts: H.pts.slice() });
  function hostStart(){
    H.K = +readOn('t', v => CFG.TURNS.includes(v), '12');
    H.ms = readOn('h', v => v === '0' || v === '1', '0') === '1' ? CFG.HARD_MS : CFG.THINK_MS;
    H.rev = readOn('v', v => v === 'top' || v === 'last', 'top') === 'last';
    H.ids = E.players().map(p => p.id).slice(0, 8); H.N = H.ids.length;
    // 6マスのならび: 数字1〜6を1つずつ、資源は2つずつ
    const nums = [1, 2, 3, 4, 5, 6], rs = [0, 0, 1, 1, 2, 2];
    for(const a of [nums, rs]) for(let i = a.length - 1; i > 0; i--){ const j = rndI(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    H.pat = nums.map((n, i) => [n, rs[i]]);
    H.M = mkMap(H.N, H.pat);
    const C = H.M.C.length;
    H.own = new Array(C).fill(-1); H.lv = new Array(C).fill(0); H.blk = new Array(C).fill(0); H.by = new Array(C).fill(-1); H.pal = -1;
    for(let p = 0; p < H.N; p++){ [2 * p, H.M.S + 2 * p].forEach(i => { H.own[i] = p; H.lv[i] = 1; }); }
    H.res = H.ids.map(() => CFG.START.slice()); H.pts = H.ids.map(() => 2); H.k = 0;
    beginTurn();
  }
  function beginTurn(){
    if(stopped) return;
    H.k++; H.ph = 'plan'; H.plan = new Map();
    const d = [1 + rndI(6), 1 + rndI(6)];
    H.gain = H.ids.map(() => [0, 0, 0]);
    const here = new Set(presentSlots());
    H.M.C.forEach((c, i) => {
      const o = H.own[i]; if(o < 0 || c.ring === 3) return;
      const n = d.filter(x => x === c.n).length; if(!n) return;
      const amt = n * H.lv[i];
      if(H.blk[i] > 0){ H.blk[i]--; const b = H.by[i]; if(H.blk[i] === 0) H.by[i] = -1; if(b >= 0 && here.has(b)){ H.res[b][c.r] += amt; H.gain[b][c.r] += amt; } return; }
      if(here.has(o)){ H.res[o][c.r] += amt; H.gain[o][c.r] += amt; }
    });
    here.forEach(p => { const r = rndI(3); H.res[p][r] += CFG.BASE; H.gain[p][r] += CFG.BASE; });
    H.res = H.res.map(r => r.map(v => Math.min(999, v)));
    const ms = H.ms + (H.k === 1 ? CFG.FIRST_PLUS : 0);
    E.hostBcast(Object.assign({ t: 'ks', k: H.k, K: H.K, ms, rev: H.rev ? 1 : 0, N: H.N, ids: H.ids, pat: H.pat, dice: d, gain: H.gain }, board()), true);
    H.deadline = performance.now() + ms + CFG.GRACE;
    clearTimeout(H.t); H.t = setTimeout(resolve, ms + CFG.GRACE);
  }
  const allReady = () => presentSlots().every(p => (H.plan.get(H.ids[p]) || {}).rd);
  function hostOnMsg(id, m){
    if(!m || m.t !== 'pl' || H.ph !== 'plan' || m.k !== H.k || !Array.isArray(m.a) || !Number.isInteger(m.n)) return;
    const p = H.ids.indexOf(id); if(p < 0) return;
    const was = H.plan.get(id); if(was && m.n <= was.n) return;
    H.plan.set(id, { a: m.a.slice(0, 40), rd: m.rd === 1, n: m.n });
    E.hostBcast({ t: 'kp', k: H.k, ids: Array.from(H.plan.entries()).filter(([, o]) => o.rd).map(([i]) => i) }, false);
    clearTimeout(H.t);
    H.t = setTimeout(resolve, allReady() ? CFG.READY_MS : Math.max(0, H.deadline - performance.now()));
  }
  function hostOnLeave(id){
    const p = H.ids.indexOf(id); if(p < 0) return;
    if(H.ph === 'plan' && presentSlots().length && allReady()){ clearTimeout(H.t); H.t = setTimeout(resolve, CFG.READY_MS); }
  }
  function resolve(){
    if(H.ph !== 'plan') return;
    H.ph = 'show'; clearTimeout(H.t);
    const st0 = { own: H.own.slice(), lv: H.lv.slice(), blk: H.blk.slice(), pal: H.pal };
    const plans = new Map();
    presentSlots().forEach(p => { const o = H.plan.get(H.ids[p]); const r = tryPlan(H.M, st0, p, H.res[p], o ? o.a : []); plans.set(p, r); });
    // 同じ空き地への村・王宮は、どれも建たない(使った資源は半分もどる)
    const want = new Map();
    plans.forEach((r, p) => r.ok.forEach(a => { if(a[0] === 'v' || a[0] === 'p'){ if(!want.has(a[1])) want.set(a[1], []); want.get(a[1]).push(p); } }));
    const done = [];
    plans.forEach((r, p) => {
      H.res[p] = r.r;
      r.ok.forEach(a => {
        const kd = a[0], i = a[1];
        if(kd === 'x') return;
        if(kd === 'v' || kd === 'p'){
          if(want.get(i).length > 1){ COST[kd].forEach((v, j) => { H.res[p][j] += Math.floor(v / 2); }); done.push([p, kd, i, 0]); return; }
          H.own[i] = p; H.lv[i] = 1; H.pts[p] += PTS[kd]; if(kd === 'p') H.pal = p;
        }else if(kd === 't'){ H.lv[i] = 2; H.pts[p] += PTS.t; }
        else if(kd === 'b'){ H.blk[i] = CFG.BLK_N; H.by[i] = p; }
        done.push([p, kd, i, 1]);
      });
    });
    const over = H.k >= H.K;
    E.hostBcast(Object.assign({ t: 'kr', k: H.k, done, over: over ? 1 : 0 }, board()), true);
    clearTimeout(H.t); H.t = setTimeout(over ? final : beginTurn, CFG.SHOW_MS);
  }
  function final(){
    if(H.ph === 'done') return;
    H.ph = 'done'; clearTimeout(H.t);
    const sum = p => H.res[p].reduce((a, b) => a + b, 0);
    const rows = presentSlots().map(p => [H.ids[p], H.pts[p], sum(p), H.own.filter((o, i) => o === p && H.lv[i] === 1 && i !== H.M.CAP).length, H.own.filter((o, i) => o === p && H.lv[i] === 2).length, H.pal === p ? 1 : 0])
      .sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]));
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
