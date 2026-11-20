/* FLIP 数字めくり オンライン(ホストが審判)
 *
 * ルール
 *  1. 1〜30 の数字が書かれたカードが30枚、ばらばらに並ぶ
 *  2. 最初の10秒だけ全部が表向き。そのあと裏返る
 *  3. 1 から順番にめくる。めくる人は1枚ごとにランダムに指名(みんなの回数がかたよらないように)
 *  4. 指名された人は10秒以内に、次の数字のカードをめくる。まちがえる・時間切れでアウト
 *     まちがえたカードは全員に見せてから裏にもどす。次の人は同じ数字から
 *  5. 最後の1人になったら勝ち。30枚めくれたら、残っている人は全員1位
 *
 * 公平さ: カードの並びは、最初の10秒だけ配る。参加者は裏返したら並びを捨てる
 * (めくれたカードの数字だけを持つ)。だれがどれをめくったかの判定はホストだけがする。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const N = 30;               // カードの枚数
const SHOW_MS = 10000;      // 最初に見せる時間
const TURN_MS = 10000;      // 1回の持ち時間
const GRACE = 800;          // 通信の遅れのぶん、ホストは少しだけ長く待つ
const OK_PAUSE = 900;       // 正解のあと、次の指名まで
const BAD_SHOW = 1800;      // まちがえたカードを見せる時間
const BAD_PAUSE = 2400;     // まちがえたあと、次の指名まで
const END_PAUSE = 1600;     // 決着してから結果画面まで

window.NomiGames.flip = { id: 'flip', name: 'FLIP', make(E){
  const $ = E.$, PF = E.fx;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const isIdx = i => Number.isInteger(i) && i >= 0 && i < N;
  const isNum = v => Number.isInteger(v) && v >= 1 && v <= N;
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(() => { if(!stopped) fn(); }, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', k = 0, cur = -1, need = 1, alive = [], outs = [], sent = false, dl = 0, barMs = 1, barT = 0;
  const face = new Array(N).fill(0);       // めくれて表のままのカード(数字)。0 = 裏
  const cards = [];                        // カードのボタン

  function say(big, sub){ $('f-big').textContent = big || ''; $('f-sub').textContent = sub || ''; }
  function chips(){
    const box = $('f-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span');
      const dead = ph !== 'wait' && ph !== 'show' && !alive.includes(p.id);
      c.className = 'chip' + (dead ? ' dead' : (p.id === cur && ph === 'turn' ? ' on' : ''));
      c.textContent = p.name + (p.id === E.myId ? '(あなた)' : '');
      box.appendChild(c);
    });
  }
  function build(){
    const g = $('f-grid'); g.textContent = ''; cards.length = 0;
    for(let i = 0; i < N; i++){
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fc';
      b.addEventListener('click', () => pick(i));
      b.addEventListener('contextmenu', e => e.preventDefault());
      g.appendChild(b); cards.push(b);
    }
  }
  // カードを表(v)/ 裏(0)にする。cls: 'done' 正解ずみ / 'bad' まちがい / '' 見せるだけ
  function setCard(i, v, cls){
    const b = cards[i]; if(!b) return;
    b.textContent = v ? String(v) : '';
    b.className = 'fc' + (v ? ' face' : '') + (cls ? ' ' + cls : '');
    void b.offsetWidth; b.classList.add('flip');
  }
  function bar(ms){
    dl = performance.now() + ms; barMs = ms;
    clearInterval(barT);
    const el = $('f-bar').firstElementChild;
    const tick = () => {
      if(stopped){ clearInterval(barT); return; }
      const left = Math.max(0, dl - performance.now());
      el.style.transform = 'scaleX(' + Math.min(1, left / barMs).toFixed(3) + ')';
      if(ph === 'turn' && cur === E.myId && !sent){
        const s = Math.ceil(left / 1000);
        $('f-sub').textContent = 'のこり ' + s + ' 秒';
      }
      if(left <= 0) clearInterval(barT);
    };
    tick(); barT = setInterval(tick, 100);
  }
  function myTurn(on){ $('f-grid').classList.toggle('my', !!on); }

  function onBegin(){
    stopped = false; ph = 'wait'; k = 0; cur = -1; need = 1; alive = []; outs = []; sent = false; face.fill(0);
    $('f-top').textContent = 'FLIP — 数字めくり';
    build(); chips(); myTurn(false); say('準備中…', ''); bar(1); E.show('s-flip');
    PF.load(); PF.show(true, { amb: [0x64d2ff, 0xb3ecff, 0xffffff] });
  }

  function pick(i){
    if(ph !== 'turn' || cur !== E.myId || sent || face[i]) return;
    sent = true; E.send({ t: 'pick', k, i }, true);
    cards[i].classList.add('sel'); myTurn(false);
    E.audio.beep(660, .06, .15); E.vibrate(15);
  }

  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'show' && Array.isArray(m.cards) && m.cards.length === N && Number.isFinite(m.ms)){
      const vs = m.cards.map(Number);
      if(!vs.every(isNum) || new Set(vs).size !== N) return;
      ph = 'show'; alive = Array.isArray(m.ids) ? m.ids.filter(Number.isInteger).slice(0, 8) : [];
      vs.forEach((v, i) => setCard(i, v, ''));
      $('f-top').textContent = 'FLIP — 場所を覚えて!';
      say('覚えて!', '1 から 30 まで、どこにある?'); chips();
      const ms = Math.max(1000, Math.min(SHOW_MS, m.ms));
      bar(ms);
      E.audio.beep(880, .1, .2); E.vibrate(40);
      PF.slam('覚えて!', { color: 0x64d2ff, size: 56 });
      // 時間になったら裏返す(並びはここで手ばなす)
      later(() => { if(ph === 'show') hideAll(); }, ms);
    }else if(m.t === 'turn' && Number.isInteger(m.k) && Number.isInteger(m.id) && isNum(m.need) && Array.isArray(m.up) && Array.isArray(m.alive)){
      if(m.k <= k) return;
      if(ph === 'show') hideAll();
      const up = m.up.filter(isIdx).slice(0, N);
      if(up.length !== m.need - 1) return;
      k = m.k; cur = m.id; need = m.need; sent = false; ph = 'turn';
      alive = m.alive.filter(Number.isInteger).slice(0, 8);
      // めくれているカードをそろえる(up[j] の数字は j+1)
      const want = new Array(N).fill(0); up.forEach((i, j) => { want[i] = j + 1; });
      for(let i = 0; i < N; i++) if(want[i] !== face[i] || (!want[i] && cards[i].className !== 'fc')){ face[i] = want[i]; cards[i].textContent = want[i] ? String(want[i]) : ''; cards[i].className = 'fc' + (want[i] ? ' face done' : ''); }
      const nm = cur === E.myId ? 'あなた' : E.nameOf(cur);
      $('f-top').textContent = 'つぎは ' + need + '  ／  のこり ' + alive.length + '人';
      const ms = Number.isFinite(m.ms) ? Math.max(1000, Math.min(TURN_MS, m.ms)) : TURN_MS;
      if(cur === E.myId){
        say('あなたの番!\n' + need + ' をめくって', ''); myTurn(true);
        E.audio.beep(988, .12, .25); E.vibrate([0, 60, 40, 60]);
      }else{
        say(nm + ' の番', need + ' はどこ?'); myTurn(false);
        E.audio.beep(520, .06, .12);
      }
      if(m.first) PF.slam(nm + ' から!', { color: 0x64d2ff, size: 48 });
      chips(); bar(ms);
    }else if(m.t === 'flip' && Number.isInteger(m.k) && m.k === k && Number.isInteger(m.id) && (m.i === -1 || isIdx(m.i))){
      if(ph !== 'turn') return;
      ph = 'flip'; myTurn(false); clearInterval(barT);
      const nm = m.id === E.myId ? 'あなた' : E.nameOf(m.id);
      if(m.ok === true && isIdx(m.i) && isNum(m.v)){
        face[m.i] = m.v; setCard(m.i, m.v, 'done');
        say('せいかい!', m.v >= N ? '30枚ぜんぶめくれた!' : '');
        E.audio.beep(784 + Math.min(m.v, 30) * 12, .1, .22); E.vibrate(30);
        PF.pop(cards[m.i], { color: 0x64d2ff, power: .9, star: m.v >= N });
        return;
      }
      alive = alive.filter(id => id !== m.id); outs.push(m.id); chips();
      if(isIdx(m.i) && isNum(m.v)){
        setCard(m.i, m.v, 'bad');
        say(nm + ' アウト!', 'そのカードは ' + m.v + '(' + need + ' じゃなかった)');
        const i = m.i; later(() => { if(!face[i]){ cards[i].textContent = ''; cards[i].className = 'fc'; void cards[i].offsetWidth; cards[i].classList.add('flip'); } }, BAD_SHOW);
        PF.shatter(cards[m.i], 0xff453a);
      }else{
        say(nm + ' アウト!', m.why === 'left' ? '抜けたよ' : '時間切れ');
      }
      E.audio.boom(.5);
      if(m.id === E.myId){ E.vibrate([0, 150, 60, 250]); PF.slam('アウト…', { color: 0xff453a, size: 56 }); }
      else E.vibrate(60);
    }else if(m.t === 'end' && Array.isArray(m.surv) && Array.isArray(m.outs)){
      ph = 'end'; myTurn(false); clearInterval(barT);
      showFinal(m);
    }
  }
  function hideAll(){
    for(let i = 0; i < N; i++){ face[i] = 0; cards[i].textContent = ''; cards[i].className = 'fc'; void cards[i].offsetWidth; cards[i].classList.add('flip'); }
    say('裏返った!', ''); E.audio.beep(440, .12, .2);
  }

  function showFinal(m){
    const surv = m.surv.filter(Number.isInteger).slice(0, 8);
    const out = m.outs.filter(x => x && Number.isInteger(x.id) && isNum(x.at)).slice(0, 8);
    const reached = isNum(m.reached) || m.reached === 0 ? m.reached : 0;
    const lines = [];
    surv.forEach(id => lines.push({ a: '1位  ' + E.nameOf(id), b: '生き残り', cls: 'win' }));
    out.slice().reverse().forEach((x, j) => {
      const pl = surv.length + j + 1;
      lines.push({ a: pl + '位  ' + E.nameOf(x.id), b: x.at + ' で' + (x.why === 'time' ? '時間切れ' : x.why === 'left' ? '退出' : 'アウト'), cls: j === out.length - 1 ? 'lose' : '' });
    });
    const iWin = surv.includes(E.myId);
    const pen = !surv.length ? '勝った人なし' : surv.length > 1 ? '同率1位: ' + surv.map(id => E.nameOf(id)).join('・') : (iWin ? 'あなたの勝ち' : E.nameOf(surv[0]) + ' の勝ち');
    later(() => { PF.confetti(120); const r = $('r-lines').firstElementChild; if(r && surv.length === 1) PF.rowIn(r, 'win'); }, 200);
    E.showResult({
      title: 'FLIP',
      reason: reached >= N ? '30枚ぜんぶめくれた!' : reached + ' までめくれた',
      pen, lines,
      stats: '最初の10秒で、どれだけ場所を覚えられるかが勝負。\nほかの人のまちがいもヒントになるよ。'
    });
  }

  // ---------------- ホスト(審判) ----------------
  const H = { ph: 'wait', cards: [], up: [], need: 1, alive: [], outs: [], turns: new Map(), k: 0, cur: -1, last: -1, t: 0 };
  const present = () => E.players().map(p => p.id);
  function hostStart(){
    const ids = present();
    const c = []; for(let v = 1; v <= N; v++) c.push(v);
    for(let i = c.length - 1; i > 0; i--){ const j = Math.floor(rndF() * (i + 1)); const t = c[i]; c[i] = c[j]; c[j] = t; }
    H.cards = c; H.up = []; H.need = 1; H.alive = ids.slice(); H.outs = []; H.turns = new Map(ids.map(id => [id, 0])); H.k = 0; H.cur = -1; H.last = -1;
    H.ph = 'show';
    E.hostBcast({ t: 'show', cards: c, ms: SHOW_MS, ids }, true);
    clearTimeout(H.t); H.t = setTimeout(() => nextTurn(true), SHOW_MS);
  }
  // 次の人: めくった回数がいちばん少ない人の中からランダム(できれば、さっきの人以外)
  function chooseNext(){
    const min = Math.min(...H.alive.map(id => H.turns.get(id) || 0));
    let c = H.alive.filter(id => (H.turns.get(id) || 0) === min);
    if(c.length > 1) c = c.filter(id => id !== H.last);
    return c[Math.floor(rndF() * c.length)];
  }
  function nextTurn(first){
    if(stopped || H.ph === 'done') return;
    const here = present(); H.alive = H.alive.filter(id => here.includes(id));
    if(H.alive.length <= 1 || H.need > N){ finish(); return; }
    H.k++; H.cur = chooseNext(); H.last = H.cur; H.turns.set(H.cur, (H.turns.get(H.cur) || 0) + 1);
    H.ph = 'turn';
    E.hostBcast({ t: 'turn', k: H.k, id: H.cur, need: H.need, ms: TURN_MS, up: H.up.slice(), alive: H.alive.slice(), first: !!first }, true);
    clearTimeout(H.t); H.t = setTimeout(() => miss(-1, 'time'), TURN_MS + GRACE);
  }
  function hostOnMsg(id, m){
    if(!m || m.t !== 'pick' || H.ph !== 'turn') return;
    if(m.k !== H.k || id !== H.cur || !isIdx(m.i) || H.up.includes(m.i)) return;
    clearTimeout(H.t);
    const v = H.cards[m.i];
    if(v === H.need){
      H.up.push(m.i); H.need++; H.ph = 'wait';
      E.hostBcast({ t: 'flip', k: H.k, id, i: m.i, v, ok: true }, true);
      H.t = setTimeout(() => H.need > N ? finish() : nextTurn(false), H.need > N ? END_PAUSE : OK_PAUSE);
    }else miss(m.i, 'bad');
  }
  // アウト(i = まちがえたカード。-1 は時間切れ・退出)
  function miss(i, why){
    if(H.ph !== 'turn') return;
    clearTimeout(H.t);
    const id = H.cur; H.ph = 'wait';
    H.alive = H.alive.filter(x => x !== id); H.outs.push({ id, at: H.need, why });
    const o = { t: 'flip', k: H.k, id, i, ok: false, why };
    if(i >= 0) o.v = H.cards[i];
    E.hostBcast(o, true);
    H.t = setTimeout(() => H.alive.length <= 1 ? finish() : nextTurn(false), H.alive.length <= 1 ? END_PAUSE : BAD_PAUSE);
  }
  function hostOnLeave(id){
    if(H.ph === 'done' || !H.alive.includes(id)) return;
    if(H.ph === 'turn' && H.cur === id){ miss(-1, 'left'); return; }
    H.alive = H.alive.filter(x => x !== id); H.outs.push({ id, at: H.need, why: 'left' });
    if(H.alive.length <= 1 && H.ph !== 'show'){ clearTimeout(H.t); H.t = setTimeout(finish, 300); }
  }
  function finish(){
    if(H.ph === 'done') return;
    H.ph = 'done'; clearTimeout(H.t);
    const surv = H.alive.slice();
    E.hostBcast({ t: 'end', surv, outs: H.outs.map(x => ({ id: x.id, at: x.at, why: x.why })), reached: H.need - 1 }, true);
    // MIX 用の順位: 生き残りが同じ1位。あとはアウトになったのが遅い順
    if(E.rank) E.rank([surv].concat(H.outs.slice().reverse().map(x => [x.id])));
  }
  function stop(){
    stopped = true; clearInterval(barT); clearTimeout(H.t); PF.show(false);
    timers.forEach(t => clearTimeout(t));
    myTurn(false);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
