/* FACE おでこカード オンライン(ホストが審判)
 *
 * ルール
 *  1. 1〜13の数字が1人1枚配られる(全員ちがう数字)。自分の画面には、ほかの全員の数字が見える。自分の数字だけ見えない
 *  2. 20秒で「勝負」か「降りる」をこっそり選ぶ(時間までは変えられる)。口で何を言ってもいい(うそも作戦)
 *  3. 勝負した人どうしで1人ずつ比べる。自分より小さい人1人につき +2点、大きい人1人につき −2点。降りた人は点が動かない
 *  4. 全5回。はじめは20点。点の多い順に順位
 *
 * シミュレーション(見えている数字から判断する人 / いつも勝負 / でたらめ / いつも降りる):
 *   最初の「勝った1人が全部もらう」形は、いつも勝負する人が勝ちすぎた(5人で53〜62%)→ 1対1で比べる形に
 *   いまは、どの人数でも判断する人が一番勝ちやすい(5人: 28% / 11% / 10% / 0%)
 *
 * 公平さ: 数字はホストだけが持ち、ひとりひとりには「自分以外の数字」だけを送る。選んだ内容は全員そろうまで配らない
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const R = 5;                // 回数
const TOP = 13;             // 数字は 1〜TOP
const START = 20;           // はじめの点
const BET = 2;              // 1対1で比べたときに動く点
const PICK_MS = 20000;      // 考える時間
const QUIET_MS = 4000;      // 全員が決めたあと、これだけ変更がなければ早めに公開
const SHOW_MS = 6500;       // 公開してから次の回まで
const GRACE = 800;          // 通信の遅れのぶん、ホストは少しだけ長く待つ

// 見えている数字(自分以外)から、自分がほかの1人に勝つ割合の見こみ(CPU用)
function share(see){
  const seen = new Set(see); let n = 0, s = 0;
  for(let v = 1; v <= TOP; v++){ if(seen.has(v)) continue; n++; s += see.filter(o => o < v).length / Math.max(1, see.length); }
  return n ? s / n : .5;
}

window.NomiGames.face = { id: 'face', name: 'FACE', _share: share, _cfg: { R, TOP, PICK_MS }, make(E){
  const $ = E.$, PF = E.fx;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const isV = v => Number.isInteger(v) && v >= 1 && v <= TOP;
  const isP = v => Number.isInteger(v) && v >= -999 && v <= 999;
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', r = 0, see = new Map(), pts = new Map(), decided = new Set(), sel = -1, nonce = 0, dl = 0, barMs = 1, barT = 0, rv = null;
  function say(big, sub){ $('fa-big').textContent = big || ''; $('fa-sub').textContent = sub || ''; }
  function chips(){
    const box = $('fa-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span');
      c.className = 'chip' + (ph === 'pick' && decided.has(p.id) ? ' on' : '');
      c.textContent = (ph === 'pick' && decided.has(p.id) ? '✓ ' : '') + p.name + (pts.has(p.id) ? '  ' + pts.get(p.id) + '点' : '');
      box.appendChild(c);
    });
  }
  function cards(){
    const box = $('fa-cards'); box.textContent = '';
    E.players().forEach(p => {
      if(p.id === E.myId || !see.has(p.id)) return;
      const c = document.createElement('div'); c.className = 'fcd';
      const nm = document.createElement('span'); nm.textContent = p.name;
      const v = document.createElement('b'); v.textContent = String(see.get(p.id));
      const st = document.createElement('small');
      const x = rv && rv.get(p.id);
      if(x){
        c.classList.add(x.s ? 'in' : 'out'); if(x.d > 0) c.classList.add('up'); else if(x.d < 0) c.classList.add('dn');
        st.textContent = x.s ? (x.d > 0 ? '+' + x.d : x.d < 0 ? '−' + (-x.d) : '±0') : '降りた';
      }else st.textContent = ph === 'pick' ? (decided.has(p.id) ? '決めた' : '考え中…') : '';
      c.appendChild(nm); c.appendChild(v); c.appendChild(st); box.appendChild(c);
    });
  }
  function myCard(v){
    const box = $('fa-me'), b = $('fa-mev');
    box.classList.toggle('open', v !== undefined);
    b.textContent = v !== undefined ? String(v) : '?';
  }
  function btnState(){
    const can = ph === 'pick';
    $('fa-act').classList.toggle('locked', !can);
    $('fa-go').classList.toggle('on', can && sel === 1);
    $('fa-fold').classList.toggle('on', can && sel === 0);
    $('fa-hint').textContent = !can ? '' : sel < 0 ? '決めないと「降りる」になるよ' : (sel ? '勝負' : '降りる') + 'にした(時間までは変えられる)';
  }
  function bar(ms){
    dl = performance.now() + ms; barMs = Math.max(1, ms);
    clearInterval(barT);
    const el = $('fa-bar').firstElementChild;
    const tick = () => {
      if(stopped){ clearInterval(barT); return; }
      const left = Math.max(0, dl - performance.now());
      el.style.transform = 'scaleX(' + Math.min(1, left / barMs).toFixed(3) + ')';
      if(ph === 'pick') $('fa-big').textContent = 'のこり ' + Math.ceil(left / 1000) + ' 秒';
      if(left <= 0) clearInterval(barT);
    };
    tick(); barT = setInterval(tick, 200); timers.push(barT);
  }
  function pick(s){
    if(stopped || ph !== 'pick') return;
    sel = s; E.send({ t: 'ch', r, s, n: ++nonce }, true);
    E.audio.init(); E.audio.beep(s ? 660 : 440, .06, .14); E.vibrate(15);
    btnState();
  }
  const onGo = () => pick(1), onFold = () => pick(0);
  $('fa-go').addEventListener('click', onGo);
  $('fa-fold').addEventListener('click', onFold);

  function onBegin(){
    stopped = false; ph = 'wait'; r = 0; see = new Map(); pts = new Map(); decided = new Set(); sel = -1; rv = null;
    $('fa-top').textContent = 'FACE — おでこカード';
    myCard(); cards(); chips(); btnState(); say('準備中…', ''); E.show('s-face');
    $('fa-bar').firstElementChild.style.transform = 'scaleX(0)';
    PF.load(); PF.show(true, { amb: [0xff7a59, 0xffb39e, 0xffffff] });
  }
  function onDeal(m){
    if(!Number.isInteger(m.r) || m.r < 1 || m.r > R || m.r <= r || !Array.isArray(m.see) || !Array.isArray(m.pts) || !Number.isFinite(m.ms)) return;
    const s = new Map(); m.see.slice(0, 8).forEach(x => { if(Array.isArray(x) && Number.isInteger(x[0]) && x[0] !== E.myId && isV(x[1])) s.set(x[0], x[1]); });
    r = m.r; see = s; rv = null; decided = new Set(); sel = -1; ph = 'pick';
    m.pts.slice(0, 8).forEach(x => { if(Array.isArray(x) && Number.isInteger(x[0]) && isP(x[1])) pts.set(x[0], x[1]); });
    $('fa-top').textContent = 'ROUND ' + r + ' / ' + R;
    $('fa-sub').textContent = '自分の数字は見えない。勝負する? 降りる?';
    myCard(); cards(); chips(); btnState();
    bar(Math.max(1000, Math.min(PICK_MS, m.ms)));
    E.audio.beep(784, .1, .2); E.vibrate(40);
    PF.pop($('fa-me'), { color: 0xff7a59, power: 1 });
  }
  function onReveal(m){
    if(m.r !== r || ph !== 'pick' || !Array.isArray(m.rows)) return;
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isV(x[1]) && (x[2] === 0 || x[2] === 1) && isP(x[3]) && isP(x[4])).slice(0, 8);
    ph = 'show'; clearInterval(barT); $('fa-bar').firstElementChild.style.transform = 'scaleX(0)';
    rv = new Map(); rows.forEach(x => { rv.set(x[0], { v: x[1], s: x[2], d: x[3] }); pts.set(x[0], x[4]); if(x[0] !== E.myId) see.set(x[0], x[1]); });
    btnState();
    const me = rv.get(E.myId);
    say('オープン!', '');
    E.audio.beep(392, .12, .22); E.vibrate(20);
    later(() => {
      if(me){ myCard(me.v); PF.pop($('fa-me'), { color: me.d > 0 ? 0xffd60a : me.d < 0 ? 0xff453a : 0xff7a59, power: 1.6, star: me.d > 0 }); }
      cards(); chips();
      const ins = rows.filter(x => x[2] === 1).length;
      if(!me) say('', '');
      else if(!me.s) say('あなたは降りた(' + me.v + ')', ins >= 2 ? '勝負した人どうしで点が動いたよ' : '勝負した人が少なくて、点は動かなかった');
      else say(me.d > 0 ? '+' + me.d + ' 点!' : me.d < 0 ? '−' + (-me.d) + ' 点…' : '±0', 'あなたの数字は ' + me.v);
      if(me && me.s && me.d > 0){ PF.slam('+' + me.d, { color: 0xffd60a, size: 64 }); E.audio.beep(1175, .2, .3); E.vibrate([0, 60, 40, 120]); }
      else if(me && me.s && me.d < 0){ E.audio.beep(220, .25, .25); E.vibrate([0, 150, 60, 250]); PF.shatter($('fa-me'), 0xff453a); }
      else E.audio.beep(660, .1, .18);
    }, 700);
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'deal') onDeal(m);
    else if(m.t === 'pg' && m.r === r && Array.isArray(m.ids) && ph === 'pick'){ decided = new Set(m.ids.filter(Number.isInteger).slice(0, 8)); chips(); cards(); }
    else if(m.t === 'rv') onReveal(m);
    else if(m.t === 'res' && Array.isArray(m.rows)) showRes(m);
  }
  function showRes(m){
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isP(x[1])).slice(0, 8);
    if(!rows.length) return;
    ph = 'end'; clearInterval(barT); btnState();
    const lines = []; let pl = 0;
    rows.forEach((x, i) => { if(i === 0 || x[1] !== rows[i - 1][1]) pl = i + 1; lines.push({ pl, id: x[0], a: pl + '位  ' + E.nameOf(x[0]), b: x[1] + '点', cls: '' }); });
    const maxPl = lines[lines.length - 1].pl;
    lines.forEach(l => { l.cls = l.pl === 1 ? 'win' : (l.pl === maxPl && maxPl > 1 ? 'lose' : ''); });
    const tops = lines.filter(l => l.pl === 1), iWin = tops.some(l => l.id === E.myId);
    const pen = tops.length > 1 ? '同率1位: ' + tops.map(l => E.nameOf(l.id)).join('・') : iWin ? 'あなたの勝ち' : E.nameOf(tops[0].id) + ' の勝ち';
    later(() => { PF.confetti(iWin ? 140 : 70); const el = $('r-lines').firstElementChild; if(el && tops.length === 1) PF.rowIn(el, 'win'); }, 200);
    E.showResult({ title: 'FACE', reason: '全' + R + '回(はじめ ' + START + '点)', pen, lines, stats: '勝負した人どうしで1人ずつ比べて、大きい方が ' + BET + '点もらう。\n自分の数字を知っているのは、ほかの人だけ。' });
    if(iWin) E.vibrate([80, 60, 80, 60, 200]);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { ph: 'idle', r: 0, ids: [], pts: new Map(), card: new Map(), dec: new Map(), fin: 0, q: 0, nxt: 0 };
  const present = () => { const h = new Set(E.players().map(p => p.id)); return H.ids.filter(id => h.has(id)); };
  function hostStart(){
    H.ids = E.players().map(p => p.id); H.pts = new Map(H.ids.map(id => [id, START])); H.r = 0;
    nextRound();
  }
  function nextRound(){
    if(stopped) return;
    const ids = present();
    if(ids.length < 2){ final(); return; }
    H.r++; H.ph = 'pick'; H.dec = new Map();
    const deck = []; for(let v = 1; v <= TOP; v++) deck.push(v);
    for(let i = deck.length - 1; i > 0; i--){ const j = Math.floor(rndF() * (i + 1)); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    H.card = new Map(ids.map((id, i) => [id, deck[i]]));
    const p = ids.map(id => [id, H.pts.get(id)]);
    ids.forEach(id => E.hostSend(id, { t: 'deal', r: H.r, R, ms: PICK_MS, see: ids.filter(x => x !== id).map(x => [x, H.card.get(x)]), pts: p }, true));
    clearTimeout(H.q); clearTimeout(H.fin); H.fin = setTimeout(resolve, PICK_MS + GRACE);
  }
  function allDecided(){ return present().every(id => !H.card.has(id) || H.dec.has(id)); }
  function hostOnMsg(id, m){
    if(!m || m.t !== 'ch' || H.ph !== 'pick' || m.r !== H.r || !H.card.has(id)) return;
    if((m.s !== 0 && m.s !== 1) || !Number.isInteger(m.n)) return;
    const was = H.dec.get(id); if(was && m.n <= was.n) return;
    H.dec.set(id, { s: m.s, n: m.n });
    E.hostBcast({ t: 'pg', r: H.r, ids: Array.from(H.dec.keys()) }, false);
    clearTimeout(H.q);
    if(allDecided()) H.q = setTimeout(resolve, QUIET_MS);
  }
  function hostOnLeave(id){
    H.card.delete(id); H.dec.delete(id);
    if(H.ph === 'pick' && allDecided()){ clearTimeout(H.q); H.q = setTimeout(resolve, QUIET_MS); }
  }
  function resolve(){
    if(H.ph !== 'pick') return;
    H.ph = 'show'; clearTimeout(H.fin); clearTimeout(H.q);
    const ids = present().filter(id => H.card.has(id));
    const st = new Map(ids.map(id => [id, H.dec.has(id) ? H.dec.get(id).s : 0]));     // 決めなかった人は降りる
    const d = new Map(ids.map(id => [id, 0])), ins = ids.filter(id => st.get(id) === 1);
    for(let a = 0; a < ins.length; a++) for(let b = a + 1; b < ins.length; b++){
      const x = ins[a], y = ins[b], w = H.card.get(x) > H.card.get(y) ? x : y, l = w === x ? y : x;
      d.set(w, d.get(w) + BET); d.set(l, d.get(l) - BET);
    }
    ids.forEach(id => H.pts.set(id, H.pts.get(id) + d.get(id)));
    const last = H.r >= R;
    E.hostBcast({ t: 'rv', r: H.r, last: last ? 1 : 0, rows: ids.map(id => [id, H.card.get(id), st.get(id), d.get(id), H.pts.get(id)]) }, true);
    clearTimeout(H.nxt); H.nxt = setTimeout(() => { if(last) final(); else nextRound(); }, SHOW_MS);
  }
  function final(){
    if(H.ph === 'done') return;
    H.ph = 'done'; clearTimeout(H.fin); clearTimeout(H.q); clearTimeout(H.nxt);
    const rows = present().map(id => [id, H.pts.get(id)]).sort((a, b) => b[1] - a[1]);
    E.hostBcast({ t: 'res', rows }, true);
    // MIX 用の順位: 点の多い順(同点は同じ順位)
    if(E.rank){
      const gs = [];
      rows.forEach((x, i) => { if(i > 0 && x[1] === rows[i - 1][1]) gs[gs.length - 1].push(x[0]); else gs.push([x[0]]); });
      E.rank(gs);
    }
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.fin); clearTimeout(H.q); clearTimeout(H.nxt); PF.show(false);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    $('fa-go').removeEventListener('click', onGo); $('fa-fold').removeEventListener('click', onFold);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
