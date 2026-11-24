/* HIDE かくれんぼ宝さがし オンライン(ホストが審判)
 *
 * ルール
 *  1. マス目(2〜3人は5×5、4人以上は6×6)に、全員が自分の宝をこっそり1つ埋める(同じマスでもいい)
 *  2. 1ターン目は「調べる」だけ: 選んだマスのまわり8マスに、ほかの人の宝がいくつあるかが自分だけに出る
 *  3. 2ターン目から: 毎ターン、掘るマスを1つ選ぶ。宝をとなりのマスへにげさせることもできる(1ゲーム3回まで)
 *  4. 全員同時に「にげる」→「掘る」。掘ったマスにだれかの宝があれば、その人はアウト
 *     掘った人には、まわり8マスの宝の数が出る(自分だけ)。掘った場所と、見つかった人は全員に見える
 *  5. アウトになった人は「鬼」として掘り続けられる(順位は変わらない)
 *  6. 最後まで残った人の勝ち。先にアウトになった人ほど下の順位(同じターンなら、見つけた数が多い方が上)
 *     10ターンで終わり(残った人は全員1位)
 *
 * シミュレーション: 最初の形は 6〜8人で7〜8割が時間切れ・「毎ターンにげる」が一番強かった
 *   → 調べるだけのターン・にげるのは3回まで・鬼 を足した。いまは平均5〜7ターンで決着、時間切れは5%以下。
 *   近くを掘られたときだけにげる人が一番強く、手がかりを読む人は でたらめに掘る人より勝ちやすい(4人: 34%対25%)
 *
 * 公平さ: 宝の場所はホストだけが持つ。手がかりは掘った本人にだけ送る
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const T = 10;               // 最大ターン
const FLEE = 3;             // にげられる回数
const HIDE_MS = 15000;      // 埋める時間
const SCAN_MS = 12000;      // 1ターン目(調べる)
const TURN_MS = 10000;      // 2ターン目から
const SHOW_MS = 3800;       // 結果を見せる時間
const GRACE = 800;          // 通信の遅れのぶん、ホストは少しだけ長く待つ
const sizeOf = n => n <= 3 ? 5 : 6;
function nbOf(c, S){
  const x = c % S, y = Math.floor(c / S), r = [];
  for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){ if(!dx && !dy) continue; const X = x + dx, Y = y + dy; if(X >= 0 && Y >= 0 && X < S && Y < S) r.push(Y * S + X); }
  return r;
}

window.NomiGames.hide = { id: 'hide', name: 'HIDE', _nb: nbOf, _cfg: { T, FLEE }, make(E){
  const $ = E.$, PF = E.fx;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const okIds = a => Array.isArray(a) ? a.filter(Number.isInteger).slice(0, 8) : [];
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', S = 5, k = 0, scan = false, ghost = false, myPos = -1, fl = FLEE, sel = -1, selF = -1, fmode = false, sent = false;
  let alive = [], outAt = new Map(), dug = new Set(), got = new Map(), rad = new Map(), dl = 0, barMs = 1, barT = 0;
  const cells = [];
  const isC = c => Number.isInteger(c) && c >= 0 && c < S * S;
  function say(big, sub){ $('h-big').textContent = big || ''; $('h-sub').textContent = sub || ''; }
  function chips(){
    const box = $('h-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span'), o = outAt.has(p.id);
      c.className = 'chip' + (o ? ' dead' : '');
      c.textContent = p.name + (p.id === E.myId ? '(あなた)' : '') + (o ? ' 鬼' : '');
      box.appendChild(c);
    });
  }
  function build(){
    const g = $('h-grid'); g.textContent = ''; cells.length = 0;
    g.style.gridTemplateColumns = 'repeat(' + S + ', 1fr)';
    for(let i = 0; i < S * S; i++){
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hc';
      b.addEventListener('click', () => tapCell(i));
      b.addEventListener('contextmenu', e => e.preventDefault());
      g.appendChild(b); cells.push(b);
    }
  }
  function render(){
    const near = fmode && myPos >= 0 ? new Set(nbOf(myPos, S)) : null;
    cells.forEach((b, i) => {
      const r = rad.get(i), g = got.get(i), mine = i === myPos;
      let cls = 'hc';
      if(dug.has(i)) cls += ' dug';
      if(g) cls += ' got';
      if(r) cls += ' rad' + (k - r.k >= 2 ? ' old' : '');
      if(mine) cls += ' mine';
      if(i === sel) cls += ' sel';
      if(i === selF) cls += ' fsel';
      if(near && near.has(i)) cls += ' can';
      b.className = cls;
      b.textContent = r ? String(r.n) : g ? '✕' : mine ? (ghost ? '✕' : '★') : '';
      if(r && mine){ const e = document.createElement('em'); e.textContent = '★'; b.appendChild(e); }
    });
    const act = ph === 'act' || ph === 'hide';
    $('h-ok').disabled = !act || sent || (ph === 'hide' ? sel < 0 : (sel < 0 && selF < 0));
    const canFlee = ph === 'act' && !scan && !ghost && !sent && fl > 0;
    $('h-flee').disabled = !canFlee;
    $('h-flee').classList.toggle('on', fmode);
    $('h-flee').textContent = ph === 'hide' ? 'にげる' : fmode ? 'にげる先をタップ' : 'にげる(のこり' + fl + '回)';
    $('h-hint').textContent = hint();
  }
  function hint(){
    if(ph === 'hide') return sent ? 'みんなを待ってるよ…' : sel < 0 ? '宝を埋めるマスをタップ' : 'ここに埋める?(決定をおす)';
    if(ph !== 'act') return '';
    if(sent) return 'みんなを待ってるよ…';
    if(fmode) return '★のとなりのマスをタップすると、そこへにげる';
    const a = sel >= 0 ? (scan ? '調べる場所を選んだ' : '掘る場所を選んだ') : (scan ? '調べるマスをタップ' : '掘るマスをタップ');
    return a + (selF >= 0 ? ' / にげる先を選んだ' : '');
  }
  function tapCell(i){
    if(stopped || sent) return;
    if(ph === 'hide'){ sel = i; E.audio.init(); E.audio.beep(520, .04, .1); render(); return; }
    if(ph !== 'act') return;
    if(fmode){
      if(nbOf(myPos, S).includes(i)){ selF = selF === i ? -1 : i; if(sel === selF) sel = -1; fmode = false; E.audio.beep(660, .05, .12); }
      else fmode = false;
      render(); return;
    }
    if(!ghost && (i === myPos || i === selF)) return;            // 自分の宝のマスは掘れない
    sel = sel === i ? -1 : i; E.audio.init(); E.audio.beep(440 + (i % S) * 30, .04, .1); E.vibrate(10);
    render();
  }
  function submit(){
    if(stopped || sent) return;
    if(ph === 'hide'){ if(sel < 0) return; sent = true; myPos = sel; E.send({ t: 'hd', c: sel }, true); sel = -1; E.audio.beep(660, .1, .2); render(); return; }
    if(ph !== 'act' || (sel < 0 && selF < 0)) return;
    sent = true; fmode = false;
    E.send({ t: 'ac', k, d: sel, m: selF }, true);
    E.audio.beep(660, .1, .2); E.vibrate(20);
    render();
  }
  const onOk = () => submit();
  const onFlee = () => { if($('h-flee').disabled) return; fmode = !fmode; render(); };
  $('h-ok').addEventListener('click', onOk);
  $('h-flee').addEventListener('click', onFlee);
  function bar(ms){
    dl = performance.now() + ms; barMs = Math.max(1, ms);
    clearInterval(barT);
    const el = $('h-bar').firstElementChild;
    const tick = () => {
      if(stopped){ clearInterval(barT); return; }
      const left = Math.max(0, dl - performance.now());
      el.style.transform = 'scaleX(' + Math.min(1, left / barMs).toFixed(3) + ')';
      if(left < 400 && !sent && (ph === 'act' || ph === 'hide') && (sel >= 0 || selF >= 0)) submit();   // 時間ぎれ直前に、選んでいた分は出す
      if(left <= 0) clearInterval(barT);
    };
    tick(); barT = setInterval(tick, 100); timers.push(barT);
  }
  function onBegin(){
    stopped = false; ph = 'wait'; k = 0; myPos = -1; fl = FLEE; sel = -1; selF = -1; fmode = false; sent = false; ghost = false;
    alive = []; outAt = new Map(); dug = new Set(); got = new Map(); rad = new Map();
    $('h-top').textContent = 'HIDE — かくれんぼ宝さがし';
    $('h-grid').textContent = ''; cells.length = 0;
    chips(); say('準備中…', ''); render(); E.show('s-hide');
    PF.load(); PF.show(true, { amb: [0x2ed3c6, 0x9df0e8, 0xffffff] });
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'hs' && (m.S === 5 || m.S === 6) && Number.isFinite(m.ms)){
      if(ph !== 'wait') return;
      S = m.S; ph = 'hide'; sent = false; sel = -1; build();
      $('h-top').textContent = 'HIDE — 宝を埋める';
      say('宝を埋めよう', 'どこに埋めたかは、だれにも見えない');
      render(); bar(Math.max(1000, Math.min(HIDE_MS, m.ms))); E.vibrate(40);
    }else if(m.t === 'tn' && Number.isInteger(m.k) && m.k >= 1 && m.k <= T && m.k > k && isC(m.pos) && Number.isInteger(m.fl) && m.fl >= 0 && m.fl <= FLEE && Number.isFinite(m.ms)){
      k = m.k; scan = m.scan === 1; ghost = m.gh === 1; myPos = m.pos; fl = m.fl;
      ph = 'act'; sent = false; sel = -1; selF = -1; fmode = false;
      if(!cells.length) build();
      $('h-top').textContent = 'TURN ' + k + ' / ' + T + (scan ? '  調べる' : '');
      if(ghost) say('鬼', '掘るマスを選ぼう(見つけても順位は変わらない)');
      else if(scan) say('調べる', 'マスを1つ選ぶと、まわり8マスの宝の数が分かる(自分だけ)');
      else say('掘る', '掘るマスを選ぼう。あぶなければ、にげる');
      render(); bar(Math.max(1000, Math.min(SCAN_MS, m.ms))); E.vibrate(30); E.audio.beep(520, .06, .12);
    }else if(m.t === 'mr' && m.k === k && Number.isInteger(m.d) && m.d >= -1 && m.d < S * S && Number.isInteger(m.n) && m.n >= -1 && m.n <= 8 && isC(m.pos) && Number.isInteger(m.fl)){
      myPos = m.pos; fl = Math.max(0, Math.min(FLEE, m.fl));
      if(m.d >= 0 && m.n >= 0) rad.set(m.d, { n: m.n, k });
      render();
    }else if(m.t === 'rs' && m.k === k && Array.isArray(m.digs) && Array.isArray(m.found) && Array.isArray(m.alive)){
      ph = 'show'; clearInterval(barT); $('h-bar').firstElementChild.style.transform = 'scaleX(0)';
      m.digs.slice(0, 16).forEach(c => { if(isC(c)) dug.add(c); });
      alive = okIds(m.alive);
      const fs = m.found.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isC(x[1]) && Array.isArray(x[2])).slice(0, 8);
      fs.forEach(x => { outAt.set(x[0], k); got.set(x[1], (got.get(x[1]) || []).concat([x[0]])); });
      chips(); render();
      if(scan){ say('調べた!', '数字は、そのマスのまわり8マスにある宝の数(自分だけに見える)'); E.audio.beep(660, .1, .18); return; }
      if(!fs.length){ say('だれも見つからなかった', ''); E.audio.beep(330, .12, .15); return; }
      const meFound = fs.some(x => x[0] === E.myId), iGot = fs.some(x => x[2].includes(E.myId));
      say(fs.map(x => E.nameOf(x[0])).join('・') + ' 発見!', fs.map(x => E.nameOf(x[0]) + ' ← ' + x[2].map(id => id === E.myId ? 'あなた' : E.nameOf(id)).join('・')).join('\n'));
      fs.forEach(x => { const c = cells[x[1]]; if(c) PF.shatter(c, 0xff453a); });
      E.audio.boom(.45);
      if(meFound){ ghost = true; E.vibrate([0, 150, 60, 250]); PF.slam('見つかった…', { color: 0xff453a, size: 48 }); }
      else if(iGot){ E.vibrate([0, 60, 40, 120]); PF.slam('発見!', { color: 0x2ed3c6, size: 56 }); }
      else E.vibrate(60);
    }else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[1] >= 0 && x[1] <= T && Number.isInteger(x[2]) && x[2] >= 0 && x[2] <= 99).slice(0, 8);
    if(!rows.length) return;
    ph = 'end'; clearInterval(barT); render();
    const lines = []; let pl = 0;
    rows.forEach((x, i) => {
      if(i === 0 || x[1] !== rows[i - 1][1] || (x[1] !== 0 && x[2] !== rows[i - 1][2])) pl = i + 1;   // 残った人は全員同じ順位
      lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: (x[1] === 0 ? '最後まで残った' : 'TURN ' + x[1] + ' で見つかった') + (x[2] ? '  発見' + x[2] : ''), cls: '' });
    });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = l.pl === 1 ? 'win' : (l.pl === maxPl && maxPl > 1 ? 'lose' : ''); });
    const tops = lines.filter(l => l.pl === 1), iWin = tops.some(l => l.id === E.myId);
    const pen = tops.length > 1 ? '同率1位: ' + tops.map(l => E.nameOf(l.id)).join('・') : iWin ? 'あなたの勝ち' : E.nameOf(tops[0].id) + ' の勝ち';
    later(() => { PF.confetti(iWin ? 140 : 70); const el = $('r-lines').firstElementChild; if(el && tops.length === 1) PF.rowIn(el, 'win'); }, 200);
    E.showResult({ title: 'HIDE', reason: (Number.isInteger(m.k) ? m.k : k) + 'ターンで決着(' + S + '×' + S + ')', pen, lines, stats: '手がかりの数字は、掘った本人にしか見えない。\nうそで人を動かすのも作戦。' });
    if(iWin) E.vibrate([80, 60, 80, 60, 200]);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { ph: 'idle', S: 5, k: 0, ids: [], pos: new Map(), fl: new Map(), out: new Map(), finds: new Map(), acts: new Map(), hid: new Set(), t: 0 };
  const present = () => { const h = new Set(E.players().map(p => p.id)); return H.ids.filter(id => h.has(id)); };
  const aliveIds = () => present().filter(id => !H.out.has(id));
  function hostStart(){
    H.ids = E.players().map(p => p.id); H.S = sizeOf(H.ids.length); H.k = 0; H.ph = 'hide';
    H.pos = new Map(); H.fl = new Map(); H.out = new Map(); H.finds = new Map(); H.acts = new Map(); H.hid = new Set();
    E.hostBcast({ t: 'hs', S: H.S, ms: HIDE_MS, T }, true);
    clearTimeout(H.t); H.t = setTimeout(endHide, HIDE_MS + GRACE);
  }
  function endHide(){
    if(H.ph !== 'hide') return;
    present().forEach(id => { if(!H.pos.has(id)) H.pos.set(id, Math.floor(rndF() * H.S * H.S)); H.fl.set(id, FLEE); });   // 埋めなかった人はランダム
    beginTurn();
  }
  function beginTurn(){
    if(stopped) return;
    H.k++; H.ph = 'act'; H.acts = new Map();
    const scan = H.k === 1, ms = scan ? SCAN_MS : TURN_MS;
    present().forEach(id => E.hostSend(id, { t: 'tn', k: H.k, T, ms, scan: scan ? 1 : 0, pos: H.pos.get(id), fl: H.fl.get(id), gh: H.out.has(id) ? 1 : 0 }, true));
    clearTimeout(H.t); H.t = setTimeout(resolve, ms + GRACE);
  }
  function allActed(){ return present().every(id => H.acts.has(id)); }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || !H.ids.includes(id)) return;
    const C = H.S * H.S;
    if(m.t === 'hd'){
      if(H.ph !== 'hide' || !Number.isInteger(m.c) || m.c < 0 || m.c >= C || H.hid.has(id)) return;
      H.pos.set(id, m.c); H.hid.add(id);
      if(present().every(x => H.hid.has(x))){ clearTimeout(H.t); H.t = setTimeout(endHide, 700); }
      return;
    }
    if(m.t !== 'ac' || H.ph !== 'act' || m.k !== H.k || H.acts.has(id)) return;
    let d = Number.isInteger(m.d) && m.d >= 0 && m.d < C ? m.d : -1, mv = Number.isInteger(m.m) && m.m >= 0 && m.m < C ? m.m : -1;
    if(H.out.has(id)) mv = -1;                                                  // 鬼は掘るだけ
    else{
      const p = H.pos.get(id);
      if(mv >= 0 && (H.k === 1 || (H.fl.get(id) || 0) <= 0 || !nbOf(p, H.S).includes(mv))) mv = -1;
      if(d === p || (mv >= 0 && d === mv)) d = -1;                              // 自分の宝のマスは掘れない
    }
    H.acts.set(id, { d, mv });
    if(allActed()){ clearTimeout(H.t); H.t = setTimeout(resolve, 600); }
  }
  function hostOnLeave(id){
    if(H.ph === 'hide' && present().every(x => H.hid.has(x))){ clearTimeout(H.t); H.t = setTimeout(endHide, 700); }
    if(H.ph === 'act' && allActed()){ clearTimeout(H.t); H.t = setTimeout(resolve, 600); }
  }
  function resolve(){
    if(H.ph !== 'act') return;
    H.ph = 'show'; clearTimeout(H.t);
    const here = present(), alive0 = here.filter(id => !H.out.has(id)), scan = H.k === 1;
    // にげる
    if(!scan) alive0.forEach(id => { const a = H.acts.get(id); if(a && a.mv >= 0 && H.fl.get(id) > 0){ H.pos.set(id, a.mv); H.fl.set(id, H.fl.get(id) - 1); } });
    // 掘る
    const found = [], digs = [];
    if(!scan){
      here.forEach(id => { const a = H.acts.get(id); if(a && a.d >= 0 && !digs.includes(a.d)) digs.push(a.d); });
      alive0.forEach(v => {
        const c = H.pos.get(v), by = here.filter(id => id !== v && H.acts.get(id) && H.acts.get(id).d === c);
        if(!by.length) return;
        by.forEach(b => H.finds.set(b, (H.finds.get(b) || 0) + 1));
        H.out.set(v, H.k); found.push([v, c, by]);
      });
    }
    const alive1 = alive0.filter(id => !H.out.has(id));
    // 手がかり(掘った本人だけ): まわり8マスにある、ほかの人の宝の数
    here.forEach(id => {
      const a = H.acts.get(id); let d = -1, n = -1;
      if(a && a.d >= 0){ d = a.d; const ns = nbOf(d, H.S); n = alive1.filter(o => o !== id && ns.includes(H.pos.get(o))).length; }
      E.hostSend(id, { t: 'mr', k: H.k, d, n, pos: H.pos.get(id), fl: H.fl.get(id) || 0 }, true);
    });
    const over = (!scan && alive1.length <= 1) || H.k >= T;
    E.hostBcast({ t: 'rs', k: H.k, digs, found, alive: alive1, over: over ? 1 : 0 }, true);
    clearTimeout(H.t); H.t = setTimeout(over ? final : beginTurn, SHOW_MS);
  }
  function final(){
    if(H.ph === 'done') return;
    H.ph = 'done'; clearTimeout(H.t);
    const key = id => H.out.has(id) ? H.out.get(id) : 99;
    const rows = present().map(id => [id, H.out.has(id) ? H.out.get(id) : 0, H.finds.get(id) || 0])
      .sort((a, b) => (key(b[0]) - key(a[0])) || (b[2] - a[2]));
    E.hostBcast({ t: 'res', k: H.k, rows }, true);
    // MIX 用の順位: 残った人(全員同じ) → あとで見つかった人。同じターンなら見つけた数が多い方が上
    if(E.rank){
      const gs = [];
      rows.forEach((x, i) => { if(i > 0 && x[1] === rows[i - 1][1] && (x[1] === 0 || x[2] === rows[i - 1][2])) gs[gs.length - 1].push(x[0]); else gs.push([x[0]]); });
      E.rank(gs);
    }
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.t); PF.show(false);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    $('h-ok').removeEventListener('click', onOk); $('h-flee').removeEventListener('click', onFlee);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
