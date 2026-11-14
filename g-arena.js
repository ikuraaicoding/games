/* ARENA — ガチャで育てて、トーナメントで戦う(ホストが審判)
 *
 * 流れ
 *  1. 育成タイム(1/3/5/10分・ロビーで選ぶ)。全員「攻3 防3 HP3」のキャラ1体からスタート
 *  2. 10秒ごと(ハードモードは5秒ごと)に「行動」が1回たまる(最大3回までストック。満タンのまま次がたまると、あふれて無駄になる)
 *     行動ごとに次の1つを選ぶ
 *       キャラガチャ: ステータス合計6〜21のランダムなキャラ。固有スキルつき
 *       装備ガチャ : 攻撃か防御が上がる武器。特殊効果を1つ持つ
 *       スキル強化 : 選んだキャラのスキルLv+1(最大Lv5)
 *     パーティは最大3体(5体バトルは5体。育成5分以上、ハードなら3分以上で選べる)。いっぱいのときは入れ替えるか捨てる(入れ替えても装備とスキルLvは引き継ぐ)
 *  3. 時間切れでランダムなトーナメント表を作り、1試合ずつ全員で観戦
 *     戦闘は自動のターン制。プレイヤーが操作できるのは「スキルを使うタイミング」だけ(各キャラ1試合1回)
 *
 * 公平さ: ガチャも戦闘もホストのスマホで計算する。相手のパーティは試合が始まるまで見えない。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};

const CFG = { TICK_MS: 10000, HARD_MS: 5000, CAP: 3, STEP_MS: 650, STEP5_MS: 480, VS_MS: 2800, END_MS: 2800, BR_MS: 4200, MAX_ROUNDS: 30, BUILD_MS: 0 };
const MINS = [1, 3, 5, 10];
// 5体バトルを選べるか(育成タイムが短いと5体そろわないので)
const can5 = (mins, hard) => mins >= 5 || (hard && mins >= 3);
const SK_MAX = 5;

// ---------------- データ ----------------
const NAMES = ['アッシュ', 'ベル', 'カイ', 'ドラコ', 'エマ', 'フィン', 'ギル', 'ハル', 'イオ', 'ジン', 'ケイ', 'ルナ', 'ミラ', 'ノア', 'オルガ', 'ペコ', 'ラン', 'セナ', 'トト', 'ユキ', 'ゼン', 'リク', 'ソラ', 'ニコ', 'ヴァン', 'ロゼ', 'シド', 'メル', 'タオ', 'レイ', 'グレン', 'モモ'];

// ---------------- バランス(数字はここだけで決める。説明文もここから作る) ----------------
// ステータスは1上がるごとに約1.12倍。攻+1=与ダメ1.12倍、防+1=被ダメ1/1.12、HP+1=最大HP1.12倍。
// どれに振っても価値は同じなので、特化キャラ(攻10など)も、役割がハマれば戦える。
const BAL = {
  base: 1.12, K: 10, hp0: 60, rnd: .18,
  fatFrom: 6, fatMul: 1.3,                       // 長期戦: 7ラウンド目から、与ダメが毎ラウンド1.3倍ずつ増える
  // スキル [Lv1の値, Lvごとの伸び]
  sk: { pow: [1.8, .55], swp: [.6, .18], snp: [1.4, .3], drain: [.5, .25], heal: [.12, .07], wall: [.35, .12], taunt: [.25, .12], ctr: [.9, .45] },
  drainMul: 1.5, tauntHits: 3,
  fx: { dbl: .6, first: .75, firstN: 2, vamp: .2, critP: .25, critM: 2, thorn: .22, pre: 1.25, evade: .2, regen: .04, pierce: .3, last: 1.5, undying: .15 },
  // ガチャ: キャラの合計値の出やすさ [確率, 下限, 上限] / 武器の強化値の出やすさ
  rar: [[.45, 6, 10], [.30, 11, 14], [.18, 15, 18], [.07, 19, 21]],
  wv: [.55, .32, .13], wAdd: [1, 2, 3]
};
// スキルの強さ(Lvで強くなる)
const SKV = {};
['pow', 'swp', 'snp', 'drain', 'heal', 'wall', 'taunt', 'ctr'].forEach(k => { SKV[k] = lv => BAL.sk[k][0] + BAL.sk[k][1] * (lv - 1); });
const pct = x => Math.round(x * 100);
const mul = x => (Math.round(x * 100) / 100).toString();
const SK = {
  pow:   { nm: '渾身',     d: lv => '次の攻撃が ' + mul(SKV.pow(lv)) + '倍' },
  swp:   { nm: '薙ぎ払い', d: lv => '次の攻撃が敵全員に(' + pct(SKV.swp(lv)) + '%)' },
  snp:   { nm: '狙撃',     d: lv => '次の攻撃で一番弱った敵を ' + mul(SKV.snp(lv)) + '倍で撃つ(挑発を無視)' },
  drain: { nm: '吸収',     d: lv => '次の攻撃が' + mul(BAL.drainMul) + '倍、与えたダメの' + pct(SKV.drain(lv)) + '%回復' },
  heal:  { nm: '治癒',     d: lv => 'すぐ: 一番弱った味方をHP' + pct(SKV.heal(lv)) + '%回復' },
  wall:  { nm: '鉄壁',     d: lv => 'すぐ: 味方全員、次の被ダメ −' + pct(SKV.wall(lv)) + '%' },
  taunt: { nm: '挑発',     d: lv => 'すぐ: 敵の攻撃を' + BAL.tauntHits + '回ぶん引き受ける(被ダメ −' + pct(SKV.taunt(lv)) + '%)' },
  ctr:   { nm: '反撃',     d: lv => 'すぐ: 次に攻撃されたら ' + pct(SKV.ctr(lv)) + '% でやり返す' }
};
const SK_KEYS = Object.keys(SK);
const SK_NOW = { heal: 1, wall: 1, taunt: 1, ctr: 1 };

// 武器の特殊効果(d: くわしい説明 / s: 試合中のカードに出す短い説明)
const F_ = BAL.fx;
const FX = {
  dbl:     { nm: '双撃', d: () => '2回攻撃(1回' + pct(F_.dbl) + '%)', s: () => '2回攻撃' },
  first:   { nm: '守護', d: () => '最初に受ける' + F_.firstN + '回のダメージ −' + pct(F_.first) + '%', s: () => '最初の' + F_.firstN + '回 −' + pct(F_.first) + '%' },
  vamp:    { nm: '吸血', d: () => '与えたダメージの' + pct(F_.vamp) + '%回復', s: () => '与ダメ' + pct(F_.vamp) + '%回復' },
  crit:    { nm: '会心', d: () => pct(F_.critP) + '%の確率でダメージ' + mul(F_.critM) + '倍', s: () => pct(F_.critP) + '%で' + mul(F_.critM) + '倍' },
  thorn:   { nm: '茨',   d: () => '受けたダメージの' + pct(F_.thorn) + '%を相手に返す', s: () => '被ダメ' + pct(F_.thorn) + '%返し' },
  pre:     { nm: '先制', d: () => '試合開始の瞬間に先制攻撃(' + mul(F_.pre) + '倍)', s: () => '開幕に先制' },
  evade:   { nm: '疾風', d: () => pct(F_.evade) + '%の確率で攻撃をかわす', s: () => pct(F_.evade) + '%で回避' },
  regen:   { nm: '再生', d: () => '自分の手番ごとにHP' + pct(F_.regen) + '%回復', s: () => '毎手番' + pct(F_.regen) + '%回復' },
  pierce:  { nm: '貫通', d: () => '相手の防御を' + pct(F_.pierce) + '%無視(硬い相手ほど効く)', s: () => '防御' + pct(F_.pierce) + '%無視' },
  last:    { nm: '背水', d: () => 'HP半分以下で与ダメージ' + mul(F_.last) + '倍', s: () => 'HP半分以下' + mul(F_.last) + '倍' },
  undying: { nm: '不死', d: () => '倒れる攻撃を1度だけ耐えて、HP' + pct(F_.undying) + '%で踏みとどまる', s: () => '1度だけ耐える' }
};
const FX_KEYS = Object.keys(FX);

const rarOf = tot => tot <= 10 ? 'N' : tot <= 14 ? 'R' : tot <= 18 ? 'SR' : 'SSR';
const wName = w => FX[w.fx].nm + 'の' + (w.t === 'a' ? '剣' : '盾');
const wStat = w => (w.t === 'a' ? '攻' : '防') + '+' + w.v;
const maxHp = h => Math.round(BAL.hp0 * Math.pow(BAL.base, h - 3));

// 受け取ったデータの形チェック(ホストから届くもの)
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
function okW(w){ return w === null || (w && (w.t === 'a' || w.t === 'd') && isInt(w.v, 1, 3) && FX[w.fx]); }
function okC(c){ return c && typeof c.nm === 'string' && c.nm.length <= 12 && isInt(c.a, 1, 10) && isInt(c.d, 1, 10) && isInt(c.h, 1, 10) && c.sk && SK[c.sk.t] && isInt(c.sk.lv, 1, SK_MAX) && (c.av === undefined || isInt(c.av, 0, 2147483647)) && okW(c.w === undefined ? null : c.w); }
const s60 = s => typeof s === 'string' ? s.slice(0, 60) : '';

window.NomiGames.arena = { id: 'arena', name: 'ARENA', _cfg: CFG, _bal: BAL, make(E){
  const $ = E.$;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  const ri = (lo, hi) => lo + Math.floor(rndF() * (hi - lo + 1));
  const pick = arr => arr[Math.floor(rndF() * arr.length)];
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const el = (tag, cls, txt) => { const d = document.createElement(tag); if(cls) d.className = cls; if(txt !== undefined) d.textContent = txt; return d; };

  // =====================================================================
  //  参加者側(表示)
  // =====================================================================
  let ph = 'wait', me = null, meSeq = -1, lastRv = 0, lastPendKey = '', nonce = 0, localEnd = 0, nextAt = 0, tickMs = CFG.TICK_MS, pSize = 3;
  let uiMode = '', clockT = 0, rev = false;
  let br = null, bt = null;           // トーナメント表 / いまの試合

  function view(v){ ['a-build', 'a-br', 'a-bt'].forEach(id => { $(id).style.display = id === v ? 'flex' : 'none'; }); VFX.show(v === 'a-bt' && !stopped, { amb: [0xff9f0a, 0xffd60a, 0xff6b3a] }); }
  // 戦闘の演出(arena-fx.js / PixiJS)。使えないスマホでは今までの演出だけになる
  const VFX = E.fx;
  const SIDEC = [0x64d2ff, 0xff9f0a];          // 上のチーム / 下のチーム
  function onBegin(){
    stopped = false; rev = false; ph = 'wait'; me = null; tickMs = CFG.TICK_MS; pSize = 3; meSeq = -1; lastRv = 0; lastPendKey = ''; uiMode = ''; br = null; bt = null;
    $('a-top').textContent = 'ARENA — 育成バトル';
    view('a-build'); $('a-party').textContent = ''; $('a-info').classList.remove('on'); $('a-panel').textContent = '';
    $('a-time').textContent = '--:--'; $('a-tk').textContent = '0';
    $('a-note').textContent = '準備中…';
    E.show('s-arena');
    VFX.load();
    clearInterval(clockT); clockT = setInterval(clock, 200);
  }
  function fmt(ms){ const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function clock(){
    if(stopped || ph !== 'build') return;
    const now = performance.now(), rem = localEnd - now;
    $('a-time').textContent = fmt(rem);
    $('a-time').classList.toggle('hot', rem < 15000);
    const bar = $('a-tbar').firstElementChild;
    // 満タンでもタイマーは止まらない(たまった分はあふれる)
    if(nextAt > 0 && me){ const left = Math.max(0, nextAt - now); bar.style.transform = 'scaleX(' + (1 - left / tickMs) + ')'; }
    else bar.style.transform = 'scaleX(0)';
    $('a-tbar').classList.toggle('over', !!(me && me.tk >= CFG.CAP && !me.pend));
  }

  // ---- 顔アイコン(avatar.js) ----
  const avOf = (c, size) => window.NomiAvatar ? window.NomiAvatar.make({ av: c.av || 0, a: c.a, d: c.d, h: c.h, sk: typeof c.sk === 'string' ? c.sk : c.sk.t }, size) : el('span');
  // ---- キャラカード(育成画面) ----
  function statRow(lab, base, add){
    const r = el('div', 'st');
    r.appendChild(el('span', 'k', lab));
    const pips = el('span', 'pips');
    for(let i = 0; i < 10; i++) pips.appendChild(el('i', i < base ? 'on' : ''));
    r.appendChild(pips);
    const v = el('span', 'v', String(base));
    if(add) v.appendChild(el('em', '', '+' + add));
    r.appendChild(v);
    return r;
  }
  function charCard(c, extra){
    const tot = c.a + c.d + c.h, rar = rarOf(tot);
    const d = el('div', 'ac r-' + rar + (extra ? ' ' + extra : ''));
    const h = el('div', 'ac-h');
    h.appendChild(avOf(c, 44));
    const nmb = el('div', 'ac-nm'); nmb.appendChild(el('span', 'rar', rar)); nmb.appendChild(el('b', '', c.nm)); h.appendChild(nmb);
    h.appendChild(el('span', 'tot', '合計 ' + tot));
    d.appendChild(h);
    const w = c.w || null;
    d.appendChild(statRow('攻', c.a, w && w.t === 'a' ? w.v : 0));
    d.appendChild(statRow('防', c.d, w && w.t === 'd' ? w.v : 0));
    d.appendChild(statRow('HP', c.h, 0));
    const k = el('div', 'ac-k'); k.appendChild(el('b', '', SK[c.sk.t].nm + ' Lv' + c.sk.lv)); k.appendChild(el('span', '', SK[c.sk.t].d(c.sk.lv))); d.appendChild(k);
    const wd = el('div', 'ac-w' + (w ? ' wr wr' + w.v : ''));
    if(w){ wd.appendChild(el('b', '', '★'.repeat(w.v) + ' ' + wName(w) + ' ' + wStat(w))); wd.appendChild(el('span', '', FX[w.fx].d())); }
    else wd.appendChild(el('span', '', '装備なし'));
    d.appendChild(wd);
    return d;
  }
  function wCard(w){
    const d = el('div', 'ac wc r-' + (w.v === 3 ? 'SSR' : w.v === 2 ? 'SR' : 'R') + ' reveal');
    const h = el('div', 'ac-h'); h.appendChild(el('span', 'rar', '★'.repeat(w.v))); h.appendChild(el('b', '', wName(w))); h.appendChild(el('span', 'tot', wStat(w)));
    d.appendChild(h);
    const wd = el('div', 'ac-w'); wd.appendChild(el('b', '', '特殊効果')); wd.appendChild(el('span', '', FX[w.fx].d())); d.appendChild(wd);
    return d;
  }

  function renderBuild(){
    if(!me) return;
    $('a-tk').textContent = String(me.tk);
    $('a-tk').parentElement.classList.toggle('full', me.tk >= CFG.CAP);
    $('a-lost').textContent = me.lost ? 'あふれた ' + me.lost + '回' : '';
    const party = $('a-party'); party.textContent = '';
    me.p.forEach((c, i) => party.appendChild(charCard(c, me.flash === i ? 'flash' : '')));
    for(let i = me.p.length; i < pSize; i++){ const e = el('div', 'ac empty', '空き枠 — キャラガチャで仲間が増える'); party.appendChild(e); }
    me.flash = -1;
    renderPanel();
  }
  function act(a, slot){
    if(ph !== 'build' || !me || me.tk <= 0 || me.pend) return;
    E.audio.init(); E.vibrate(20);
    const o = { t: 'act', a, n: ++nonce }; if(slot !== undefined) o.slot = slot;
    // ホスト自身は送った瞬間に返事(onMe)が届くので、状態は送る前に変えておく
    me.tk--; $('a-tk').textContent = String(me.tk);
    uiMode = 'busy'; renderPanel();
    E.send(o, true);
  }
  function decide(slot){
    if(ph !== 'build' || !me || !me.pend) return;
    E.vibrate(20);
    me.pend = null; uiMode = 'busy'; renderPanel();
    E.send({ t: 'dec', slot, n: ++nonce }, true);
  }
  // c を渡すと、左にそのキャラの顔を出す(だれを選んでいるか分かりやすく)
  function bigBtn(title, sub, on, fn, c){
    const b = el('button', 'abtn');
    let tx = b;
    if(c){
      b.classList.add('wf', 'r-' + rarOf(c.a + c.d + c.h));
      b.appendChild(avOf(c, 40));
      tx = el('span', 'abtn-t'); b.appendChild(tx);
    }
    tx.appendChild(el('b', '', title)); tx.appendChild(el('small', '', sub));
    b.disabled = !on; b.onclick = fn; return b;
  }
  function renderPanel(){
    const box = $('a-panel'); box.textContent = '';
    if(ph !== 'build' || !me){ return; }
    const note = $('a-note');
    if(me.pend){
      uiMode = '';
      const pd = me.pend;
      if(pd.k === 'ch'){
        note.classList.remove('over');
        note.textContent = 'パーティがいっぱい。だれと入れ替える?(装備とスキルLvは引き継ぐ)';
        box.appendChild(charCard(pd.c, 'reveal'));
        const g = el('div', 'agrid');
        const nt = pd.c.a + pd.c.d + pd.c.h;
        me.p.forEach((c, i) => g.appendChild(bigBtn(c.nm + ' と交代', '合計' + (c.a + c.d + c.h) + ' → ' + nt + (c.sk.lv > 1 ? ' / スキルLv' + c.sk.lv + 'を引き継ぐ' : ''), true, () => decide(i), c)));
        g.appendChild(bigBtn('捨てる', 'いまのパーティのまま', true, () => decide(-1)));
        box.appendChild(g);
      }else{
        note.classList.remove('over');
        note.textContent = 'だれに装備する?(前の装備は捨てる)';
        box.appendChild(wCard(pd.w));
        const g = el('div', 'agrid');
        me.p.forEach((c, i) => g.appendChild(bigBtn(c.nm + ' に装備', c.w ? '今: ' + '★'.repeat(c.w.v) + ' ' + wName(c.w) + ' ' + wStat(c.w) : '今: なし', true, () => decide(i), c)));
        g.appendChild(bigBtn('捨てる', '装備しない', true, () => decide(-1)));
        box.appendChild(g);
      }
      return;
    }
    if(uiMode === 'sk'){
      note.classList.remove('over');
      note.textContent = 'どのキャラのスキルを強化する?';
      const g = el('div', 'agrid');
      me.p.forEach((c, i) => { const lv = c.sk.lv, mx = lv >= SK_MAX; g.appendChild(bigBtn(c.nm + ' — ' + SK[c.sk.t].nm + ' Lv' + lv + (mx ? '(最大)' : ' → ' + (lv + 1)), mx ? 'これ以上は上がらない' : SK[c.sk.t].d(lv + 1), !mx && me.tk > 0, () => { uiMode = ''; act('sk', i); }, c)); });
      g.appendChild(bigBtn('やめる', '', true, () => { uiMode = ''; renderPanel(); }));
      box.appendChild(g);
      return;
    }
    const can = me.tk > 0 && uiMode !== 'busy';
    const lastSec = localEnd - performance.now() < 20000;
    note.textContent = me.tk >= CFG.CAP ? '満タン! 使わないと次の行動があふれて無駄になる' : me.tk > 0 ? (lastSec ? 'もうすぐ終了! 行動を使い切ろう' : '行動を選ぼう(' + Math.round(tickMs / 1000) + '秒ごとに1回たまる)') : '次の行動がたまるのを待とう…';
    note.classList.toggle('over', me.tk >= CFG.CAP);
    const skOk = me.p.some(c => c.sk.lv < SK_MAX);
    box.appendChild(bigBtn('キャラガチャ', 'ステ合計6〜21のキャラ。スキルつき', can, () => act('ch')));
    box.appendChild(bigBtn('装備ガチャ', '攻か防が上がる武器。特殊効果つき', can, () => act('wp')));
    box.appendChild(bigBtn('スキル強化', skOk ? 'えらんだキャラのスキルLv+1' : '全員Lv' + SK_MAX + '(最大)', can && skOk, () => { uiMode = 'sk'; renderPanel(); }));
  }
  function onMe(m){
    if(!Number.isInteger(m.s) || m.s <= meSeq) return;
    const ps = m.ps === 5 ? 5 : 3;
    if(!Array.isArray(m.p) || m.p.length < 1 || m.p.length > ps || !m.p.every(okC) || !isInt(m.tk, 0, 9)) return;
    meSeq = m.s; pSize = ps;
    if(m.ti === CFG.HARD_MS || m.ti === CFG.TICK_MS) tickMs = m.ti;
    if(m.rev && !rev){ rev = true; $('a-top').textContent = 'ARENA — 最下位決定戦(負け残り)'; }
    const pend = m.pend && ((m.pend.k === 'ch' && okC(m.pend.c)) || (m.pend.k === 'wp' && okW(m.pend.w) && m.pend.w)) ? m.pend : null;
    const prevLen = me ? me.p.length : 0;
    me = { p: m.p, tk: m.tk, pend, flash: -1, lost: isInt(m.lost, 0, 9999) ? m.lost : 0 };
    if(m.of === 1 && !m.end) overflow();
    if(Number.isFinite(m.rem)){ localEnd = performance.now() + m.rem; }
    nextAt = Number.isFinite(m.nx) && m.nx >= 0 ? performance.now() + m.nx : 0;
    if(m.end){ ph = 'ended'; $('a-note').textContent = '育成おわり! トーナメント表を作ってるよ…'; $('a-panel').textContent = ''; $('a-time').textContent = '0:00'; renderPartyOnly(); return; }
    ph = 'build';
    if(uiMode === 'busy') uiMode = '';
    // ガチャ演出
    const rv = m.rv;
    if(rv && isInt(rv.n, 1, 1e6) && rv.n > lastRv){
      lastRv = rv.n;
      if(rv.k === 'ch' && isInt(rv.i, 0, pSize - 1)){ me.flash = rv.i; fanfare(me.p[rv.i] ? rarOf(me.p[rv.i].a + me.p[rv.i].d + me.p[rv.i].h) : 'N'); }
      else if(rv.k === 'sk' && isInt(rv.i, 0, pSize - 1)){ me.flash = rv.i; E.audio.beep(880, .12, .2); E.vibrate(30); }
      else if(rv.k === 'eq' && isInt(rv.i, 0, pSize - 1)){ me.flash = rv.i; E.audio.beep(740, .12, .2); }
    }
    const pk = pend ? JSON.stringify(pend) : '';
    if(pend && pk !== lastPendKey){ fanfare(pend.k === 'ch' ? rarOf(pend.c.a + pend.c.d + pend.c.h) : (pend.w.v === 3 ? 'SSR' : pend.w.v === 2 ? 'SR' : 'R')); }
    lastPendKey = pk;
    if(prevLen && m.p.length > prevLen) E.vibrate([30, 40, 60]);
    renderBuild();
  }
  // 満タンのまま次の行動がたまった → あふれて無駄になった
  function overflow(){
    const box = $('a-tk').parentElement;
    box.classList.remove('spill'); void box.offsetWidth; box.classList.add('spill');
    E.audio.init(); E.audio.beep(220, .18, .22); later(() => E.audio.beep(160, .22, .22), 140);
    E.vibrate([60, 40, 60]);
  }
  function renderPartyOnly(){
    if(!me) return;
    const party = $('a-party'); party.textContent = '';
    me.p.forEach(c => party.appendChild(charCard(c)));
  }
  function fanfare(rar){
    E.audio.init();
    const tones = rar === 'SSR' ? [660, 880, 1100, 1320] : rar === 'SR' ? [660, 880, 1100] : rar === 'R' ? [660, 880] : [600];
    tones.forEach((f, i) => later(() => E.audio.beep(f, .12, .2), i * 110));
    E.vibrate(rar === 'SSR' ? [40, 40, 40, 40, 120] : rar === 'SR' ? [40, 40, 80] : 30);
  }

  // ---- トーナメント表 ----
  const nmOf = id => { if(br && br.nm){ const x = br.nm.find(p => p[0] === id); if(x) return x[1]; } return E.nameOf(id); };
  function rLabel(r, R, rv){ return r === R - 1 ? (rv ? '最下位決定戦' : '決勝') : r === R - 2 ? (rv ? '準・最下位決定戦' : '準決勝') : (r + 1) + '回戦'; }
  function onBr(m){
    if(!Array.isArray(m.rs) || !Array.isArray(m.nm)) return;
    if(m.rev) rev = true;
    br = { rs: m.rs, nm: m.nm.filter(p => Array.isArray(p) && Number.isInteger(p[0])).map(p => [p[0], s60(String(p[1]))]) };
    ph = 'br'; view('a-br');
    const box = $('a-br'); box.textContent = '';
    box.appendChild(el('div', 'br-h', (rev ? '負け残りトーナメント' : 'トーナメント表') + (m.first ? '' : '(途中経過)')));
    if(rev) box.appendChild(el('div', 'br-rule', '勝ったら抜け。負けたら次の試合へ。最後まで負け残った人が最下位'));
    const R = m.rs.length;
    m.rs.forEach((round, r) => {
      if(!Array.isArray(round)) return;
      const sec = el('div', 'br-r');
      sec.appendChild(el('div', 'eyebrow', rLabel(r, R, rev)));
      round.forEach((mt, j) => {
        if(!Array.isArray(mt)) return;
        const [a, b, w] = mt;
        const row = el('div', 'br-m' + (m.cur && m.cur[0] === r && m.cur[1] === j ? ' cur' : ''));
        const bye = a === -1 || b === -1;
        const side = id => { const s = el('span', id === null || id === undefined || id === -1 ? 'tbd' : (w !== null && w !== undefined && !bye ? (id === w ? (rev ? 'stay' : 'w') : (rev ? 'safe' : 'l')) : '')); s.textContent = id === -1 ? 'シード' : (id === null || id === undefined ? '?' : nmOf(id) + (id === E.myId ? '(あなた)' : '')); return s; };
        row.appendChild(side(a)); row.appendChild(el('i', '', 'vs')); row.appendChild(side(b));
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
    if(m.cur && Number.isInteger(m.cur[0])){
      const mt = m.rs[m.cur[0]] && m.rs[m.cur[0]][m.cur[1]];
      if(mt){ const nx = el('div', 'br-next', '次の試合: ' + nmOf(mt[0]) + ' vs ' + nmOf(mt[1])); box.appendChild(nx); if(mt[0] === E.myId || mt[1] === E.myId){ nx.classList.add('me'); E.vibrate([60, 60, 60]); } }
    }
  }

  // ---- 試合 ----
  const FL = { used: 1, armed: 2, wall: 4, taunt: 8, ctr: 16, first: 32, und: 64 };
  function okU(u){ return u && typeof u.nm === 'string' && isInt(u.A, 0, 20) && isInt(u.D, 0, 20) && isInt(u.mhp, 1, 999) && isInt(u.h, 1, 10) && isInt(u.a, 1, 10) && isInt(u.d, 1, 10) && isInt(u.av, 0, 2147483647) && SK[u.sk] && isInt(u.lv, 1, SK_MAX) && (u.fx === '' || (FX[u.fx] && (u.wt === 'a' || u.wt === 'd') && isInt(u.wv, 1, 3))) && typeof u.r === 'string'; }
  function onMs(m){
    if(!isInt(m.mi, 1, 1e6) || !m.a || !m.b || !Array.isArray(m.a.u) || !Array.isArray(m.b.u)) return;
    const N = m.a.u.length;
    if((N !== 3 && N !== 5) || m.b.u.length !== N) return;
    const us = m.a.u.concat(m.b.u);
    if(!us.every(u => u === null || okU(u))) return;
    const mySide = m.a.id === E.myId ? 0 : m.b.id === E.myId ? 1 : -1;
    bt = { mi: m.mi, k: -1, N, us, ids: [m.a.id, m.b.id], mySide, cards: [], done: false, log: [], top: mySide === 0 ? 1 : 0 };
    ph = 'bt'; view('a-bt'); $('a-info').classList.remove('on');
    $('a-bhead').textContent = '';
    $('a-bhead').appendChild(el('div', 'eyebrow', s60(m.lbl)));
    const vs = el('div', 'vs');
    vs.appendChild(el('b', '', nmOf(m.a.id))); vs.appendChild(el('i', '', 'VS')); vs.appendChild(el('b', '', nmOf(m.b.id)));
    $('a-bhead').appendChild(vs);
    // 自分が戦うときは自分のチームを下に
    const top = mySide === 0 ? 1 : 0, bot = 1 - top;
    buildTeam($('a-t0'), top); buildTeam($('a-t1'), bot);
    $('a-log').textContent = '';
    $('a-log').appendChild(el('div', 'big', 'まもなく開始…'));
    $('a-bhint').textContent = (mySide >= 0 ? 'ここぞというときにスキルを押せ!(各キャラ1試合1回)' : '観戦中') + '\nキャラをタップすると装備やスキルの詳細が見られる';
    E.vibrate(mySide >= 0 ? [80, 60, 80] : 30);
    E.audio.beep(520, .15, .2); later(() => E.audio.beep(780, .2, .2), 180);
    VFX.intro(nmOf(bt.ids[top]), nmOf(bt.ids[bot]));
  }
  function buildTeam(box, side){
    box.textContent = '';
    box.className = 'team' + (side === bt.mySide ? ' mine' : '');
    box.appendChild(el('div', 'tname', nmOf(bt.ids[side]) + (side === bt.mySide ? '(あなた)' : '')));
    const row = el('div', 'trow' + (bt.N === 5 ? ' n5' : ''));
    for(let i = 0; i < bt.N; i++){
      const ui = side * bt.N + i, u = bt.us[ui];
      if(!u){ continue; }
      const c = el('div', 'bu r-' + u.r);
      const n = el('div', 'bu-n'); n.appendChild(avOf(u, 30));
      const nn = el('div', 'bu-nn'); nn.appendChild(el('span', 'rar', u.r)); nn.appendChild(el('b', '', u.nm)); n.appendChild(nn); c.appendChild(n);
      const hp = el('div', 'hp'); const bar = el('i'); hp.appendChild(bar); c.appendChild(hp);
      const hpt = el('div', 'bu-hp', u.mhp + '/' + u.mhp); c.appendChild(hpt);
      c.appendChild(el('div', 'bu-s', '攻' + u.A + ' 防' + u.D));
      const wv = el('div', 'bu-w' + (u.fx ? ' wr wr' + u.wv : ' none'));
      if(u.fx){ wv.appendChild(el('b', '', FX[u.fx].nm + (u.wt === 'a' ? 'の剣 攻+' : 'の盾 防+') + u.wv)); wv.appendChild(el('span', '', '★'.repeat(u.wv) + ' ' + FX[u.fx].s())); }
      else wv.appendChild(el('span', '', '装備なし'));
      c.appendChild(wv);
      c.onclick = e => { if(e.target.closest('.bu-sk')) return; showInfo(u); };
      const st = el('div', 'bu-st'); c.appendChild(st);
      let btn;
      if(side === bt.mySide){
        btn = el('button', 'bu-sk');
        btn.appendChild(el('b', '', SK[u.sk].nm + ' Lv' + u.lv)); btn.appendChild(el('small', '', SK[u.sk].d(u.lv)));
        btn.onclick = () => useSkill(ui);
      }else{
        btn = el('div', 'bu-sk ro'); btn.appendChild(el('b', '', SK[u.sk].nm + ' Lv' + u.lv)); btn.appendChild(el('small', '', SK[u.sk].d(u.lv)));
      }
      c.appendChild(btn);
      row.appendChild(c);
      bt.cards[ui] = { c, bar, hpt, st, btn, hp: u.mhp, fl: 0, hk: -1 };
    }
    box.appendChild(row);
  }
  // キャラの詳細(試合中にタップで開く)
  function showInfo(u){
    const box = $('a-info'); box.textContent = '';
    const card = el('div', 'ac r-' + u.r);
    const h = el('div', 'ac-h'); h.appendChild(avOf(u, 56));
    const nmb = el('div', 'ac-nm'); nmb.appendChild(el('span', 'rar', u.r)); nmb.appendChild(el('b', '', u.nm)); h.appendChild(nmb);
    h.appendChild(el('span', 'tot', '最大HP ' + u.mhp)); card.appendChild(h);
    const bA = u.wt === 'a' ? u.wv : 0, bD = u.wt === 'd' ? u.wv : 0;
    card.appendChild(statRow('攻', u.A - bA, bA)); card.appendChild(statRow('防', u.D - bD, bD)); card.appendChild(statRow('HP', u.h, 0));
    const k = el('div', 'ac-k'); k.appendChild(el('b', '', SK[u.sk].nm + ' Lv' + u.lv)); k.appendChild(el('span', '', SK[u.sk].d(u.lv))); card.appendChild(k);
    const w = el('div', 'ac-w' + (u.fx ? ' wr wr' + u.wv : ''));
    if(u.fx){ w.appendChild(el('b', '', '★'.repeat(u.wv) + ' ' + FX[u.fx].nm + (u.wt === 'a' ? 'の剣 攻+' : 'の盾 防+') + u.wv)); w.appendChild(el('span', '', FX[u.fx].d())); }
    else w.appendChild(el('span', '', '装備なし'));
    card.appendChild(w);
    box.appendChild(card); box.appendChild(el('div', 'ainfo-x', 'タップで閉じる'));
    box.onclick = () => box.classList.remove('on');
    box.classList.add('on');
  }
  function useSkill(ui){
    if(!bt || bt.done || bt.mySide < 0) return;
    const cd = bt.cards[ui]; if(!cd || cd.hp <= 0 || (cd.fl & FL.used) || cd.btn.disabled) return;
    E.audio.init(); E.vibrate(40); E.audio.beep(990, .1, .25);
    cd.btn.disabled = true; cd.btn.classList.add('fired');
    E.send({ t: 'use', mi: bt.mi, u: ui }, true);
  }
  const sideCol = ui => SIDEC[Math.floor(ui / bt.N) === bt.top ? 0 : 1];
  // HP の表示(演出があるときは、攻撃が当たるタイミングまで待ってから減らす)
  function showHp(ui, hp, k){
    const cd = bt.cards[ui], u = bt.us[ui]; if(!cd || cd.hk > k) return;
    cd.hk = k;
    cd.bar.style.transform = 'scaleX(' + Math.max(0, hp / u.mhp) + ')';
    cd.bar.className = hp / u.mhp <= .3 ? 'low' : '';
    cd.hpt.textContent = Math.max(0, hp) + '/' + u.mhp;
    cd.c.classList.toggle('dead', hp <= 0);
  }
  function domFloat(cd, v, k){
    const fl = el('span', 'fl ' + (k === 'h' ? 'heal' : k === 'c' ? 'crit' : k === 'm' ? 'miss' : k === 's' ? 'sk' : 'dmg'));
    fl.textContent = k === 'h' ? '+' + v : k === 'm' ? 'MISS' : k === 's' ? 'SKILL' : '-' + v;
    cd.c.appendChild(fl); later(() => fl.remove(), 1000);
  }
  function bump(cd, cls){ cd.c.classList.remove(cls); void cd.c.offsetWidth; cd.c.classList.add(cls); }
  function onSt(m){
    if(!bt || m.mi !== bt.mi || !isInt(m.k, 0, 1e6) || m.k <= bt.k || !Array.isArray(m.u) || m.u.length !== bt.N * 2) return;
    bt.k = m.k;
    const B = bt, K = m.k, fx = VFX.ok(), hitAt = bt.us.map(() => 0), newHp = [];
    const lgs = Array.isArray(m.lg) ? m.lg.slice(0, 8).map(t => s60(String(t))) : [];
    m.u.forEach((x, ui) => {
      const cd = bt.cards[ui]; if(!cd || !Array.isArray(x)) return;
      const hp = Number.isInteger(x[0]) ? x[0] : cd.hp, fl = Number.isInteger(x[1]) ? x[1] : 0;
      newHp[ui] = { hp, was: cd.hp, und: (cd.fl & FL.und) && !(fl & FL.und) };
      cd.hp = hp; cd.fl = fl;
      cd.st.textContent = '';
      [['armed', '溜'], ['wall', '壁'], ['taunt', '挑'], ['ctr', '返'], ['first', '守'], ['und', '不']].forEach(([k, t]) => { if(fl & FL[k]) cd.st.appendChild(el('span', '', t)); });
      if(cd.btn.tagName === 'BUTTON') cd.btn.disabled = !!(fl & FL.used) || hp <= 0 || bt.done;
      if((fl & FL.used) && !cd.btn.classList.contains('done')){ cd.btn.classList.add('fired', 'done'); cd.btn.lastChild.textContent = '使用済み'; }
    });
    if(lgs.length){
      lgs.forEach(t => bt.log.unshift(t));
      bt.log = bt.log.slice(0, 4);
      const lg = $('a-log'); lg.textContent = '';
      bt.log.forEach((t, i) => lg.appendChild(el('div', i === 0 ? 'big' : '', t)));
    }
    if(K === 0 && lgs.includes('FIGHT!')) VFX.fight();
    if(lgs.some(t => t.indexOf('長期戦') >= 0)) VFX.fatigue();
    const list = Array.isArray(m.fx) ? m.fx.slice(0, 16).filter(f => Array.isArray(f) && isInt(f[0], 0, bt.N * 2 - 1) && bt.cards[f[0]]) : [];
    // 1ステップの中の攻撃を少しずつずらして、連続技に見せる
    const gap = list.length ? Math.min(130, 520 / list.length) : 0;
    list.forEach((f, i) => {
      const [ui, v, k] = f, src = isInt(f[3], 0, bt.N * 2 - 1) && bt.cards[f[3]] ? f[3] : -1, cd = bt.cards[ui], u = bt.us[ui];
      const val = Number.isInteger(v) ? v : 0;
      if(!fx){
        domFloat(cd, val, k);
        if(k === 'd' || k === 'c') bump(cd, 'hit');
        if(k === 's') bump(cd, 'glow');
        return;
      }
      const t0 = Math.round(i * gap);
      if(k === 'd' || k === 'c'){
        const crit = k === 'c', srcEl = src >= 0 && src !== ui ? bt.cards[src].c : null;
        const fly = srcEl ? (crit ? 210 : 160) : 0;
        hitAt[ui] = Math.max(hitAt[ui], t0 + fly);
        later(() => {
          if(bt !== B) return;
          VFX.attack(srcEl, cd.c, { crit, ratio: val / u.mhp, color: src >= 0 ? sideCol(src) : 0xffffff });
          later(() => {
            if(bt !== B) return;
            bump(cd, 'hit'); VFX.num(cd.c, '-' + val, crit ? 'crit' : 'dmg');
            if(crit){ E.audio.beep(220, .12, .3); E.vibrate(40); } else E.audio.beep(330 + Math.floor(rndF() * 60), .05, .12);
          }, fly);
        }, t0);
      }else if(k === 'h'){
        hitAt[ui] = Math.max(hitAt[ui], t0);
        later(() => { if(bt !== B) return; VFX.heal(cd.c); VFX.num(cd.c, '+' + val, 'heal'); }, t0);
      }else if(k === 'm'){
        later(() => { if(bt !== B) return; VFX.miss(cd.c); VFX.num(cd.c, 'MISS', 'miss'); }, t0 + 120);
      }else if(k === 's'){
        later(() => { if(bt !== B) return; bump(cd, 'glow'); VFX.skill(cd.c, '★ ' + SK[u.sk].nm, u.nm + ' のスキル!', u.sk); E.audio.beep(990, .1, .2); }, t0);
      }
    });
    if(!fx){
      if(list.some(f => f[2] === 'c')){ E.audio.beep(220, .12, .3); E.vibrate(40); }
      else if(list.some(f => f[2] === 'd')) E.audio.beep(330 + Math.floor(rndF() * 60), .05, .12);
    }
    newHp.forEach((h, ui) => {
      if(!h) return;
      const at = fx ? hitAt[ui] : 0;
      const apply = () => {
        if(bt !== B) return;
        showHp(ui, h.hp, K);
        if(fx && h.was > 0 && h.hp <= 0) VFX.ko(bt.cards[ui].c);
        if(fx && h.und && h.hp > 0) VFX.undying(bt.cards[ui].c);
      };
      if(at > 0) later(apply, at); else apply();
    });
  }
  function onMend(m){
    if(!bt || m.mi !== bt.mi || bt.done) return;
    bt.done = true; $('a-info').classList.remove('on');
    bt.cards.forEach(cd => { if(cd && cd.btn.tagName === 'BUTTON') cd.btn.disabled = true; });
    const won = m.w === E.myId, lost = bt.mySide >= 0 && !won;
    const lg = $('a-log'); lg.textContent = '';
    const loser = bt.ids[0] === m.w ? bt.ids[1] : bt.ids[0];
    lg.appendChild(el('div', 'big win', nmOf(m.w) + (rev ? ' の勝ち抜け!' : ' の勝ち!')));
    const ws = bt.ids.indexOf(m.w);
    if(ws >= 0) later(() => { if(bt && bt.done) VFX.win($(ws === bt.top ? 'a-t0' : 'a-t1'), rev ? '勝ち抜け!' : 'WIN!', SIDEC[ws === bt.top ? 0 : 1]); }, 250);
    if(rev) lg.appendChild(el('div', '', m.last ? nmOf(loser) + ' が最下位…' : nmOf(loser) + ' は負け残り。次の試合へ…'));
    if(s60(m.why)) lg.appendChild(el('div', '', s60(m.why)));
    if(won){ E.vibrate([60, 40, 60, 40, 160]); [660, 880, 1100, 1320].forEach((f, i) => later(() => E.audio.beep(f, .14, .22), i * 120)); }
    else if(lost){ E.vibrate([0, 300]); E.audio.beep(200, .4, .25); }
  }
  function onFin(m){
    if(!Array.isArray(m.rk)) return;
    ph = 'fin';
    const lines = m.rk.slice(0, 8).filter(x => Array.isArray(x) && Number.isInteger(x[0])).map((x, i) => ({ a: s60(String(x[1])) + '  ' + nmOf(x[0]), b: s60(String(x[2] || '')), cls: i === 0 ? (m.rev ? 'lose' : 'win') : '' }));
    const champ = m.rk[0] && m.rk[0][0];
    if(m.rev){
      E.showResult({
        title: 'ARENA', reason: '負け残りトーナメント',
        pen: champ === E.myId ? 'あなたが最下位…' : nmOf(champ) + ' が最下位!',
        lines, stats: s60(m.cp) ? '最下位のパーティ\n' + String(m.cp).slice(0, 300) : ''
      });
      E.audio.scare(); E.vibrate(champ === E.myId ? [0, 200, 80, 400] : [0, 120]);
      VFX.show(true); later(() => VFX.doom($('r-pen')), 200);
      return;
    }
    E.showResult({
      title: 'ARENA', reason: '育成バトル トーナメント',
      pen: champ === E.myId ? 'あなたの優勝!' : nmOf(champ) + ' の優勝!',
      lines, stats: s60(m.cp) ? '優勝パーティ\n' + String(m.cp).slice(0, 300) : ''
    });
    if(champ === E.myId){ E.vibrate([80, 60, 80, 60, 300]); }
    VFX.show(true); later(() => { const r = $('r-lines').firstElementChild; VFX.confetti(140); if(r) VFX.rowIn(r, 'win'); VFX.pop($('r-pen'), { color: 0xffd60a, power: 2.5, star: true }); }, 200);
  }

  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'me') onMe(m);
    else if(m.t === 'br') onBr(m);
    else if(m.t === 'ms') onMs(m);
    else if(m.t === 'st') onSt(m);
    else if(m.t === 'mend') onMend(m);
    else if(m.t === 'fin') onFin(m);
  }

  // =====================================================================
  //  ホスト(審判): 育成
  // =====================================================================
  const H = { rev: false, phase: 'idle', P: new Map(), names: [], endAt: 0, nextTick: 0, tickT: 0, endT: 0, seq: 0, rvn: 0, rs: null, B: null, stepT: 0, mi: 0, outR: new Map() };

  function rollChar(){
    let r = rndF(), tot = 6;
    for(const [p, lo, hi] of BAL.rar){ if(r < p){ tot = ri(lo, hi); break; } r -= p; tot = ri(lo, hi); }
    const s = [1, 1, 1], w = [rndF() + .25, rndF() + .25, rndF() + .25];
    for(let k = 3; k < tot; k++){
      const idx = [0, 1, 2].filter(i => s[i] < 10), sum = idx.reduce((a, i) => a + w[i], 0);
      let x = rndF() * sum, j = idx[idx.length - 1];
      for(const i of idx){ if((x -= w[i]) < 0){ j = i; break; } }
      s[j]++;
    }
    return { nm: pick(NAMES), a: s[0], d: s[1], h: s[2], sk: { t: pick(SK_KEYS), lv: 1 }, w: null, av: Math.floor(rndF() * 2147483647) };
  }
  function rollWeapon(){
    const r = rndF(), i = r < BAL.wv[0] ? 0 : r < BAL.wv[0] + BAL.wv[1] ? 1 : 2;
    return { t: rndF() < .5 ? 'a' : 'd', v: BAL.wAdd[i], fx: pick(FX_KEYS) };
  }
  function starter(){ return { nm: 'ルーキー', a: 3, d: 3, h: 3, sk: { t: 'pow', lv: 1 }, w: null, av: 0 }; }
  function readMins(){
    let v = 5;
    try{ const b = document.querySelector('#l-arena button[data-m].on'); if(b) v = parseInt(b.dataset.m, 10); }catch(e){}
    return MINS.includes(v) ? v : 5;
  }
  function readHard(){ try{ const b = document.querySelector('#l-arena button[data-h].on'); return !!(b && b.dataset.h === '1'); }catch(e){ return false; } }
  function readN(mins, hard){ try{ const b = document.querySelector('#l-arena button[data-n].on'); if(b && b.dataset.n === '5' && can5(mins, hard)) return 5; }catch(e){} return 3; }
  function readRev(){ try{ const b = document.querySelector('#l-arena button[data-v].on'); return !!(b && b.dataset.v === 'last'); }catch(e){ return false; } }
  function sendMe(id, extra){
    const p = H.P.get(id); if(!p) return;
    const now = performance.now();
    const o = { t: 'me', s: ++H.seq, ps: H.N, ti: H.TICK, p: p.party, tk: p.tk, lost: p.lost, pend: p.pend, rem: Math.max(0, Math.round(H.endAt - now)), nx: H.nextTick && H.nextTick < H.endAt ? Math.max(0, Math.round(H.nextTick - now)) : -1 };
    if(p.rv) o.rv = p.rv;
    if(H.rev) o.rev = 1;
    if(extra) Object.assign(o, extra);
    E.hostSend(id, o, true);
  }
  function hostStart(){
    stopHost();
    H.rev = readRev();
    H.phase = 'build'; H.P = new Map(); H.seq = 0; H.rvn = 0; H.rs = null; H.B = null; H.mi = 0; H.outR = new Map();
    H.names = E.players().map(p => [p.id, p.name]);
    const mins = readMins(), hard = readHard();
    H.TICK = hard ? CFG.HARD_MS : CFG.TICK_MS; H.N = readN(mins, hard);
    const buildMs = CFG.BUILD_MS || mins * 60000;
    const now = performance.now();
    H.endAt = now + buildMs; H.nextTick = now + H.TICK;
    E.players().forEach(p => H.P.set(p.id, { party: [starter()], tk: 1, lost: 0, pend: null, n: 0, rv: null }));
    H.P.forEach((_, id) => sendMe(id));
    H.tickT = setInterval(() => {
      if(H.phase !== 'build') return;
      H.nextTick = performance.now() + H.TICK;
      // 満タンなら、たまった分はあふれて無駄になる
      H.P.forEach((p, id) => { if(p.tk < CFG.CAP){ p.tk++; sendMe(id); } else { p.lost++; sendMe(id, { of: 1 }); } });
    }, H.TICK);
    H.endT = setTimeout(endBuild, buildMs);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string') return;
    if(m.t === 'use'){ onUse(id, m); return; }
    if(H.phase !== 'build') return;
    const p = H.P.get(id); if(!p) return;
    if(!Number.isInteger(m.n) || m.n <= p.n) return;
    p.n = m.n;
    if(m.t === 'act'){
      if(p.tk <= 0 || p.pend) { sendMe(id); return; }
      if(m.a === 'ch'){
        const c = rollChar();
        p.tk--;
        if(p.party.length < H.N){ p.party.push(c); p.rv = { n: ++H.rvn, k: 'ch', i: p.party.length - 1 }; }
        else p.pend = { k: 'ch', c };
      }else if(m.a === 'wp'){
        p.tk--; p.pend = { k: 'wp', w: rollWeapon() };
      }else if(m.a === 'sk'){
        const c = p.party[m.slot];
        if(!isInt(m.slot, 0, H.N - 1) || !c || c.sk.lv >= SK_MAX){ sendMe(id); return; }
        p.tk--; c.sk.lv++; p.rv = { n: ++H.rvn, k: 'sk', i: m.slot };
      }
      sendMe(id);
    }else if(m.t === 'dec'){
      if(!p.pend){ sendMe(id); return; }
      const pd = p.pend; p.pend = null;
      if(isInt(m.slot, 0, H.N - 1) && p.party[m.slot]){
        if(pd.k === 'ch'){ pd.c.w = p.party[m.slot].w; pd.c.sk.lv = p.party[m.slot].sk.lv; p.party[m.slot] = pd.c; p.rv = { n: ++H.rvn, k: 'ch', i: m.slot }; }
        else{ p.party[m.slot].w = pd.w; p.rv = { n: ++H.rvn, k: 'eq', i: m.slot }; }
      }
      sendMe(id);
    }
  }
  function hostOnLeave(id){
    if(H.phase === 'build') H.P.delete(id);
  }
  function endBuild(){
    if(H.phase !== 'build') return;
    H.phase = 'tour';
    clearInterval(H.tickT); clearTimeout(H.endT);
    H.P.forEach((p, id) => { p.pend = null; sendMe(id, { end: 1, rem: 0, nx: -1 }); });
    // トーナメント表(シードは1回戦だけ。シード同士はぶつからない)
    const ids = Array.from(H.P.keys());
    for(let i = ids.length - 1; i > 0; i--){ const j = Math.floor(rndF() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    let S = 1; while(S < ids.length) S *= 2;
    const nPairs = S / 2, byes = S - ids.length, pairs = [];
    let k = 0;
    for(let i = 0; i < nPairs; i++){ if(i >= nPairs - byes) pairs.push([ids[k++], -1]); else pairs.push([ids[k++], ids[k++]]); }
    for(let i = pairs.length - 1; i > 0; i--){ const j = Math.floor(rndF() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
    H.rs = [pairs.map(([a, b]) => [a, b, b === -1 ? a : null])];
    for(let n = nPairs / 2; n >= 1; n /= 2) H.rs.push(Array.from({ length: n }, () => [null, null, null]));
    propagate();
    later(() => { bcastBr(true); later(nextMatch, CFG.BR_MS + 1200); }, 1800);
  }
  function propagate(){
    for(let r = 1; r < H.rs.length; r++) H.rs[r].forEach((mt, j) => { mt[0] = H.rs[r - 1][2 * j][2]; mt[1] = H.rs[r - 1][2 * j + 1][2]; });
  }
  function findNext(){
    for(let r = 0; r < H.rs.length; r++) for(let j = 0; j < H.rs[r].length; j++){ const mt = H.rs[r][j]; if(mt[2] === null && mt[0] !== null && mt[1] !== null) return [r, j]; }
    return null;
  }
  function bcastBr(first){
    const o = { t: 'br', rs: H.rs, nm: H.names, cur: findNext() };
    if(H.rev) o.rev = 1;
    if(first) o.first = 1;
    E.hostBcast(o, true);
  }
  function nextMatch(){
    if(stopped || H.phase !== 'tour') return;
    const nx = findNext();
    if(!nx){ finish(); return; }
    startMatch(nx[0], nx[1]);
  }

  // =====================================================================
  //  ホスト: 戦闘
  // =====================================================================
  function mkUnit(c, side, i){
    const w = c.w || null;
    return { side, i, nm: c.nm, r: rarOf(c.a + c.d + c.h), A: c.a + (w && w.t === 'a' ? w.v : 0), D: c.d + (w && w.t === 'd' ? w.v : 0), mhp: maxHp(c.h), hp: maxHp(c.h),
      sk: c.sk.t, lv: c.sk.lv, fx: w ? w.fx : '', wt: w ? w.t : '', wv: w ? w.v : 0, h: c.h, a: c.a, d: c.d, av: c.av || 0, used: false, armed: '', wall: 0, taunt: 0, tauntN: 0, ctr: 0, first: w && w.fx === 'first' ? BAL.fx.firstN : 0, und: !!(w && w.fx === 'undying') };
  }
  const pubU = u => u ? { nm: u.nm, r: u.r, A: u.A, D: u.D, mhp: u.mhp, sk: u.sk, lv: u.lv, fx: u.fx, wt: u.wt, wv: u.wv, h: u.h, a: u.a, d: u.d, av: u.av } : null;
  function newBattle(idA, idB, rnd, n){
    const N = n || H.N || 3;
    const mk = (id, side) => { const p = H.P.get(id); const party = p ? p.party : [starter()]; return Array.from({ length: N }, (_, i) => party[i] ? mkUnit(party[i], side, i) : null); };
    return { N, ids: [idA, idB], u: mk(idA, 0).concat(mk(idB, 1)), round: 0, order: [], oi: 0, s0: rnd() < .5 ? 0 : 1, q: [], k: 0, preDone: false, done: false, w: -1, lastSide: 0, rnd };
  }
  // 戦闘ロジック(ホストのみ。テストからも使えるように B に乱数を持たせる)
  const alive = u => u && u.hp > 0;
  const idxOf = (B, u) => B.u.indexOf(u);
  const foes = (B, u) => B.u.filter(x => alive(x) && x.side !== u.side);
  const mates = (B, u) => B.u.filter(x => alive(x) && x.side === u.side);
  const fat = B => B.round > BAL.fatFrom ? Math.pow(BAL.fatMul, B.round - BAL.fatFrom) : 1;
  function target(B, a, mode){
    const es = foes(B, a); if(!es.length) return null;
    if(mode === 'snp') return es.reduce((m, x) => x.hp < m.hp ? x : m, es[0]);      // 狙撃は挑発を無視する
    const t = es.find(x => x.taunt > 0); if(t) return t;
    return es[Math.floor(B.rnd() * es.length)];
  }
  function heal(B, u, v, L, F){
    const h = Math.min(u.mhp - u.hp, Math.max(0, Math.round(v)));
    if(h > 0){ u.hp += h; F.push([idxOf(B, u), h, 'h']); }
    return h;
  }
  function hurt(B, u, dmg, L, F, kind, src){
    u.hp -= dmg; F.push([idxOf(B, u), dmg, kind || 'd', src === undefined ? -1 : src]);      // 4つめ = 攻撃した側(演出用)
    if(u.hp <= 0){
      if(u.und){ u.und = false; u.hp = Math.max(1, Math.round(u.mhp * BAL.fx.undying)); L.push(u.nm + ' は不死の力で踏みとどまった!'); }
      else{ u.hp = 0; u.armed = ''; u.taunt = 0; u.ctr = 0; L.push(u.nm + ' は倒れた'); }
    }
  }
  function hit(B, a, d, mult, L, F, opt){
    opt = opt || {};
    const f = BAL.fx;
    if(d.fx === 'evade' && B.rnd() < f.evade){ L.push(d.nm + ' がかわした!'); F.push([idxOf(B, d), 0, 'm', idxOf(B, a)]); return 0; }
    const D = a.fx === 'pierce' ? d.D * (1 - f.pierce) : d.D;
    let x = BAL.K * Math.pow(BAL.base, a.A - D) * mult * fat(B);
    if(a.fx === 'last' && a.hp * 2 <= a.mhp) x *= f.last;
    const crit = a.fx === 'crit' && B.rnd() < f.critP; if(crit) x *= f.critM;
    x *= 1 - BAL.rnd + B.rnd() * BAL.rnd * 2;
    const tags = [];
    if(d.first > 0){ x *= 1 - f.first; d.first--; tags.push('守護'); }
    if(d.wall){ x *= 1 - d.wall; d.wall = 0; tags.push('鉄壁'); }
    if(d.taunt){ x *= 1 - d.taunt; if(--d.tauntN <= 0) d.taunt = 0; }
    const dmg = Math.max(1, Math.round(x));
    L.push((opt.lab || a.nm) + ' → ' + d.nm + ' ' + dmg + (crit ? ' 会心!' : '') + (tags.length ? '(' + tags.join('・') + ')' : ''));
    hurt(B, d, dmg, L, F, crit ? 'c' : 'd', idxOf(B, a));
    if(alive(a)){
      if(a.fx === 'vamp') heal(B, a, dmg * f.vamp, L, F);
      if(opt.drain) heal(B, a, dmg * opt.drain, L, F);
    }
    if(!opt.noReact && alive(a)){
      if(d.fx === 'thorn'){ const t = Math.max(1, Math.round(dmg * f.thorn)); L.push(d.nm + ' の茨 → ' + a.nm + ' ' + t); hurt(B, a, t, L, F, 'd', idxOf(B, d)); }
      if(d.ctr && alive(d) && alive(a)){ const m = d.ctr; d.ctr = 0; hit(B, d, a, m, L, F, { noReact: true, lab: d.nm + ' の反撃' }); }
    }
    if(!alive(d)) d.ctr = 0;
    return dmg;
  }
  function activate(B, ui, L, F){
    const u = B.u[ui]; if(!alive(u)) return;
    const v = SKV[u.sk](u.lv);
    L.push('★ ' + u.nm + ' の' + SK[u.sk].nm + '!');
    F.push([ui, 0, 's']);
    if(!SK_NOW[u.sk]){ u.armed = u.sk; return; }
    if(u.sk === 'heal'){ const ms = mates(B, u); const t = ms.reduce((m, x) => x.hp / x.mhp < m.hp / m.mhp ? x : m, ms[0]); const h = heal(B, t, t.mhp * v, L, F); L.push(t.nm + ' のHPが ' + h + ' 回復'); }
    else if(u.sk === 'wall') mates(B, u).forEach(x => { x.wall = Math.max(x.wall, v); });
    else if(u.sk === 'taunt'){ u.taunt = v; u.tauntN = BAL.tauntHits; }
    else if(u.sk === 'ctr') u.ctr = v;
  }
  function unitAct(B, u, L, F){
    if(u.fx === 'regen') heal(B, u, u.mhp * BAL.fx.regen, L, F);
    const mode = u.armed; u.armed = '';
    const v = mode ? SKV[mode](u.lv) : 0;
    if(mode === 'swp'){ foes(B, u).forEach(e => { if(alive(u)) hit(B, u, e, v, L, F); }); return; }
    const m = mode === 'pow' ? v : mode === 'snp' ? v : mode === 'drain' ? BAL.drainMul : 1;
    const hits = u.fx === 'dbl' ? 2 : 1;
    for(let h = 0; h < hits; h++){
      if(!alive(u)) break;
      const t = target(B, u, h === 0 ? mode : ''); if(!t) break;
      hit(B, u, t, m * (hits === 2 ? BAL.fx.dbl : 1), L, F, { drain: mode === 'drain' ? v : 0 });
    }
  }
  function nextActor(B){
    for(let guard = 0; guard < 40; guard++){
      if(B.oi >= B.order.length){
        B.round++; B.oi = 0; B.order = [];
        const f = (B.round + B.s0) % 2;
        for(let i = 0; i < B.N; i++){ B.order.push(f * B.N + i, (1 - f) * B.N + i); }
        if(B.round === BAL.fatFrom + 1) B.fatNote = true;
      }
      const u = B.u[B.order[B.oi++]];
      if(alive(u)) return u;
    }
    return null;
  }
  function checkEnd(B){
    const a = B.u.slice(0, B.N).some(alive), b = B.u.slice(B.N).some(alive);
    if(a && b) return false;
    B.done = true;
    B.w = a ? 0 : b ? 1 : B.lastSide;
    return true;
  }
  function step(B){
    const L = [], F = [];
    while(B.q.length){ activate(B, B.q.shift(), L, F); }
    if(!B.preDone){
      B.preDone = true;
      B.u.forEach(u => { if(alive(u) && u.fx === 'pre' && !B.done){ const t = target(B, u, ''); if(t){ B.lastSide = u.side; hit(B, u, t, BAL.fx.pre, L, F, { lab: u.nm + ' の先制' }); checkEnd(B); } } });
      if(B.done) return { L, F };
    }
    if(checkEnd(B)) return { L, F };
    if(B.round > CFG.MAX_ROUNDS){
      const r = s => B.u.slice(s * B.N, s * B.N + B.N).filter(Boolean).reduce((t, u) => t + u.hp / u.mhp, 0);
      B.done = true; B.w = r(0) === r(1) ? (B.rnd() < .5 ? 0 : 1) : r(0) > r(1) ? 0 : 1; B.timeUp = true;
      return { L, F };
    }
    const u = nextActor(B);
    if(B.fatNote){ B.fatNote = false; L.push('— 長期戦! ここからダメージが増えていく —'); }
    if(u){ B.lastSide = u.side; unitAct(B, u, L, F); }
    checkEnd(B);
    return { L, F };
  }
  const flags = u => u ? (u.used ? 1 : 0) | (u.armed ? 2 : 0) | (u.wall ? 4 : 0) | (u.taunt ? 8 : 0) | (u.ctr ? 16 : 0) | (u.first ? 32 : 0) | (u.und ? 64 : 0) : 0;
  const snap = B => B.u.map(u => u ? [u.hp, flags(u)] : null);

  function startMatch(r, j){
    const mt = H.rs[r][j], R = H.rs.length;
    const B = newBattle(mt[0], mt[1], rndF);
    B.mi = ++H.mi; B.r = r; B.j = j; H.B = B;
    const lbl = (r === R - 1 ? (H.rev ? '最下位決定戦' : '決勝') : r === R - 2 ? (H.rev ? '準・最下位決定戦' : '準決勝') : (r + 1) + '回戦') + (H.rs[r].length > 1 ? '  第' + (j + 1) + '試合' : '');
    E.hostBcast({ t: 'ms', mi: B.mi, lbl, a: { id: mt[0], u: B.u.slice(0, B.N).map(pubU) }, b: { id: mt[1], u: B.u.slice(B.N).map(pubU) } }, true);
    later(() => {
      if(stopped || H.B !== B) return;
      E.hostBcast({ t: 'st', mi: B.mi, k: 0, u: snap(B), lg: ['FIGHT!'], fx: [] }, false);
      H.stepT = setInterval(() => doStep(B), B.N === 5 ? CFG.STEP5_MS : CFG.STEP_MS);      // 5体は手数が多いので少し速く
    }, CFG.VS_MS);
  }
  function doStep(B){
    if(stopped || H.B !== B){ clearInterval(H.stepT); return; }
    const { L, F } = step(B);
    E.hostBcast({ t: 'st', mi: B.mi, k: ++B.k, u: snap(B), lg: L.slice(0, 8), fx: F.slice(0, 16) }, false);
    if(!B.done) return;
    clearInterval(H.stepT);
    const mt = H.rs[B.r][B.j], w = B.ids[B.w], l = B.ids[1 - B.w];
    // 普通: 勝った人が次へ進む / 負け残り: 勝った人は抜けて、負けた人が次へ進む
    mt[2] = H.rev ? l : w; H.outR.set(H.rev ? w : l, B.r); propagate();
    const lastMatch = B.r === H.rs.length - 1;
    later(() => {
      if(stopped || H.B !== B) return;
      E.hostBcast({ t: 'mend', mi: B.mi, w, why: B.timeUp ? '時間切れ(残りHPの割合で判定)' : '', last: H.rev && lastMatch ? 1 : 0 }, true);
      later(() => { if(stopped) return; if(findNext()){ bcastBr(false); later(nextMatch, CFG.BR_MS); } else nextMatch(); }, CFG.END_MS);
    }, 500);
  }
  function onUse(id, m){
    const B = H.B;
    if(H.phase !== 'tour' || !B || B.done || m.mi !== B.mi || !isInt(m.u, 0, B.N * 2 - 1)) return;
    const side = B.ids.indexOf(id); if(side < 0 || Math.floor(m.u / B.N) !== side) return;
    const u = B.u[m.u]; if(!alive(u) || u.used) return;
    u.used = true; B.q.push(m.u);
  }
  function partyText(id){
    const p = H.P.get(id); if(!p) return '';
    return p.party.map(c => c.nm + ' 攻' + c.a + (c.w && c.w.t === 'a' ? '+' + c.w.v : '') + ' 防' + c.d + (c.w && c.w.t === 'd' ? '+' + c.w.v : '') + ' HP' + c.h + ' / ' + SK[c.sk.t].nm + 'Lv' + c.sk.lv + (c.w ? ' / ' + wName(c.w) : '')).join('\n');
  }
  function finish(){
    if(H.phase !== 'tour') return;
    H.phase = 'done';
    const R = H.rs.length, champ = H.rs[R - 1][0][2];
    if(H.rev){
      // 負け残り: 最下位から順に。抜けたのが遅い人ほど下の順位
      const n = H.outR.size + 1, rk = [[champ, n + '位', '最下位']];
      const outs = Array.from(H.outR.entries()).sort((a, b) => b[1] - a[1]);
      outs.forEach(([id, r]) => { const better = outs.filter(x => x[1] < r).length; rk.push([id, (better + 1) + '位', r === R - 1 ? '最下位決定戦で勝ち抜け' : (r + 1) + '回戦で勝ち抜け']); });
      E.hostBcast({ t: 'fin', rev: 1, rk, cp: partyText(champ) }, true);
      return;
    }
    const rk = [[champ, '1位', '優勝']];
    const others = Array.from(H.outR.entries()).sort((a, b) => b[1] - a[1]);
    others.forEach(([id, r]) => { rk.push([id, (H.rs[r].length + 1) + '位', r === R - 1 ? '決勝で敗退' : (r === R - 2 ? '準決勝' : (r + 1) + '回戦') + 'で敗退']); });
    E.hostBcast({ t: 'fin', rk, cp: partyText(champ) }, true);
  }

  function stopHost(){ clearInterval(H.tickT); clearTimeout(H.endT); clearInterval(H.stepT); }
  function stop(){
    stopped = true; stopHost(); clearInterval(clockT); $('a-info').classList.remove('on'); VFX.show(false);
    timers.forEach(t => clearTimeout(t));
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop, _t: { H, newBattle, step, rollChar, rollWeapon, starter } };
} };
})();
