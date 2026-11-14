/* RACE — パーツガチャで車を改造して、全員同時にレース(ホストが審判)
 *
 * 流れ
 *  1. ガレージタイム(1/3/5分・ロビーで選ぶ)。全員同じ「ノーマル」の車からスタート
 *     10秒ごとに「行動」が1回たまる(最大3回。満タンのまま次がたまると、あふれて無駄になる)
 *       パーツガチャ: エンジン・ターボ・タイヤ・ニトロのどれかのパーツ。付け替えるか捨てるかを選ぶ
 *       チューン    : 選んだ部位を Lv+1(最大Lv3)。部位につくので、パーツを付け替えても残る
 *       偵察        : まだ公開されていないレースのコースの特徴を、自分だけこっそり見る
 *  2. グランプリ(1戦 または 3戦)。各レースの前に約12秒のピット(コース公開・セッティング選び)
 *     レースは全員同時。操作はニトロを使うタイミングだけ(1レース1回。ダブルニトロなら2回)
 *     ゴール順にポイント。全レースの合計で順位
 *
 * 公平さ: ガチャもレースの計算もホストのスマホで行う。各スマホは届いた位置を補って描くだけ。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};

const FONT = "-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Segoe UI',sans-serif";
const CFG = { TICK_MS: 10000, CAP: 3, PIT_MS: 12000, CD_MS: 4200, DT: 100, SNAP_N: 4, RES_MS: 7500, AFTER_MS: 12000, MAX_RACE_S: 100, GARAGE_MS: 0, RAIN: -1 };   // GARAGE_MS / RAIN はテスト用(0なら設定どおり / -1なら天気はランダム)
const MINS = [1, 3, 5];
const TUNE_MAX = 3;
const PTS = [10, 7, 5, 4, 3, 2, 1, 0];

// ---------------- データ ----------------
// ステータス: 0=最高速 1=加速 2=コーナー 3=ニトロ / 部位: 0=エンジン 1=ターボ 2=タイヤ 3=ニトロタンク(部位 i の主なステータスは i)
const ST = ['最高速', '加速', 'コーナー', 'ニトロ'];
const ST_S = ['速', '加', '曲', 'N'];
const SLOT = ['エンジン', 'ターボ', 'タイヤ', 'ニトロ'];
const RAR = ['N', 'R', 'SR', 'SSR'];
const PNAME = [
  ['ブレイズ', 'ストーム', 'サンダー', 'ファルコン', 'タイタン', 'ノヴァ', 'バイパー', 'イーグル'],
  ['ツイン', 'ハリケーン', 'サイクロン', 'ジェット', 'ブースト', 'ウィンド', 'ロケット', 'スパーク'],
  ['グリップ', 'スリック', 'クロー', 'トレッド', 'ホールド', 'エッジ', 'ラバー', 'スネーク'],
  ['フレア', 'インフェルノ', 'ブルーフレイム', 'メテオ', 'プラズマ', 'コメット', 'ボルケーノ', 'パルス']
];
const PKIND = ['V6', 'ターボ', 'タイヤ', 'タンク'];

// ---------------- バランス(数字はここだけで決める。説明文もここから作る) ----------------
const PH = {
  base: 2,                                   // 車のステータスの土台(パーツやチューンがなくてもこれだけある)
  v0: 158, vk: 6.5,                          // 最高速(km/h) = v0 + vk × 最高速
  c0: 103, ck: 3.4, cs: [1.22, 1.0, .83],    // コーナーの上限 = (c0 + ck × コーナー) × きつさ(ゆるい/ふつう/きつい)
  rainC: .87,                                // 雨: コーナーの上限 ×0.87
  a0: 0, ak: 3.8, aFall: .8,                 // 加速(km/h/秒) = (a0 + ak × 加速) × (1 − aFall × 速度/最高速)
  aMin: 2,
  hillV: .82, hillA: .55,                    // 上り坂: 上限 ×0.82、加速 ×0.55
  dirtV: .78, dirtA: .75,                    // ダート: 上限 ×0.78、加速 ×0.75
  brake: 170,                                // ブレーキ(km/h/秒)。コーナーの手前から自動で減速する
  n0: 22, nk: 13,                            // ニトロ: 上限 +(n0 + nk × ニトロ) km/h
  na0: 36, nak: 3,                           //         加速 +(na0 + nak × ニトロ)。速いときほどよく効く
  nt0: 1.2, ntk: .38,                        //         効く時間(秒) = nt0 + ntk × ニトロ
  nCorner: .05,                              // コーナーではニトロの効き ×0.05(使う場所が大事)
  nLow: .05,                                 // 遅いとき(スタート直後など)はニトロの加速がほとんど効かない
  form: .015,                                // レースごとの調子(最高速・加速 ±1.5%)
  soft: 12, softK: .5,                       // ステータスは12を超えると、伸びが半分になる(1つに振りすぎない)
  // 特性
  slip: 18, slipGap: 45,                     // スリップストリーム: 前の車の45m以内で 最高速 +18km/h
  lastP: .3, lastV: .22,                     // ラストスパート: 最後の30%で 最高速 +22%
  hillT: [.95, .85],                         // ヒルクライム: 上り坂の上限 ×0.95、加速 ×0.85
  rocketT: 3.5, rocketA: 1.45,               // ロケットスタート: スタートから3.5秒 加速 ×1.45
  chaseV: .14,                               // 追い込み: 後ろ半分にいるとき 最高速 +14%
  drift: .045,                               // ドリフト: コーナーの上限 +4.5%
  dirtT: [.93, .9],                          // オフロード: ダートの上限 ×0.93、加速 ×0.9
  longN: 1.35,                               // ロングニトロ: 効く時間 ×1.35
  dblN: .65,                                 // ダブルニトロ: 2回使える(1回の時間は ×0.65)
  // ガチャ: レア度の出やすさ / 主なステータスの値 / ほかのステータスへのおまけ / 特性がつく確率
  rar: [.45, .32, .17, .06],
  main: [[2, 3], [4, 5], [6, 7], [8, 9]],
  sub: [0, .3, 1, 2],
  trait: [0, .2, .6, 1],
  // SR未満が1回続くごとに、SR・SSR の出やすさを +5%(元の確率に対して)。最大 1.5倍(ARENA と同じ)
  luckUp: .05, luckMax: .5,
  // セッティング [最高速, 加速, コーナー, ニトロ] の増減
  set: [[0, 0, 0, 0], [3, 0, -3, 0], [-2, 0, 3, 0]]
};
const SET_NM = ['バランス', '最高速寄り', 'コーナー寄り'];
const pc = x => Math.round(x * 100);
const r1 = x => (Math.round(x * 10) / 10).toString();
// 特性(s: つく部位)
const TR = {
  slip:   { s: 0, nm: 'スリップストリーム', d: () => '前の車の' + PH.slipGap + 'm以内にいると 最高速+' + PH.slip + 'km/h' },
  last:   { s: 0, nm: 'ラストスパート',     d: () => '最後の' + pc(PH.lastP) + '%で 最高速+' + r1(PH.lastV * 100) + '%' },
  hill:   { s: 0, nm: 'ヒルクライム',       d: () => '上り坂で速度が落ちにくい(上限×' + PH.hillT[0] + ')' },
  rocket: { s: 1, nm: 'ロケットスタート',   d: () => 'スタートから' + PH.rocketT + '秒 加速×' + PH.rocketA },
  chase:  { s: 1, nm: '追い込み',           d: () => '後ろ半分にいるとき 最高速+' + r1(PH.chaseV * 100) + '%' },
  rain:   { s: 2, nm: 'レインマスター',     d: () => '雨でもコーナーのグリップが落ちない' },
  drift:  { s: 2, nm: 'ドリフト',           d: () => 'コーナーが ' + r1(PH.drift * 100) + '%速い' },
  dirt:   { s: 2, nm: 'オフロード',         d: () => 'ダートで減速しにくい(上限×' + PH.dirtT[0] + ')' },
  dbl:    { s: 3, nm: 'ダブルニトロ',       d: () => 'ニトロを2回使える(1回の時間は' + pc(PH.dblN) + '%)' },
  long:   { s: 3, nm: 'ロングニトロ',       d: () => 'ニトロの効く時間 ×' + PH.longN }
};
const TR_KEYS = Object.keys(TR);
const TR_OF = [[], [], [], []]; TR_KEYS.forEach(k => TR_OF[TR[k].s].push(k));

// コース: 区間 [種類, 長さ(m), x]。種類 s=直線 c=コーナー h=上り坂 d=ダート。x はコーナーの向きときつさ(−3〜3、0以外)
const SEG_NM = { s: '直線', c: 'コーナー', h: '上り坂', d: 'ダート' };
const THEMES = [
  { nm: '高速コース', w: { s: 6, c: 2, h: 1, d: 1 }, sh: [1, 2] },
  { nm: 'テクニカル', w: { s: 2, c: 7, h: 1, d: 1 }, sh: [2, 3] },
  { nm: '山岳コース', w: { s: 2, c: 3, h: 4, d: 1 }, sh: [1, 3] },
  { nm: 'ラリー',     w: { s: 2, c: 3, h: 1, d: 4 }, sh: [1, 3] },
  { nm: 'ミックス',   w: { s: 3, c: 3, h: 2, d: 2 }, sh: [1, 3] }
];
const PLACE_A = ['サンセット', 'ミッドナイト', 'レッド', 'ブルー', 'グリーン', 'ゴールド', 'シルバー', 'スカイ'];
const PLACE_B = ['湾岸', '峠', 'サーキット', '市街地', 'キャニオン', '高原', 'ベイ', 'フォレスト'];
const RAIN_P = .3, LEN_MIN = 2000, LEN_MAX = 2500;

function genCourse(rnd){
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = a => a[Math.floor(rnd() * a.length)];
  const th = Math.floor(rnd() * THEMES.length), W = THEMES[th].w, SH = THEMES[th].sh;
  const n = ri(8, 12), segs = [['s', ri(220, 320), 0]];
  const sum = W.s + W.c + W.h + W.d;
  while(segs.length < n - 1){
    let x = rnd() * sum, t = 'd';
    for(const k of ['s', 'c', 'h', 'd']){ if((x -= W[k]) < 0){ t = k; break; } }
    const prev = segs[segs.length - 1];
    if(t === 's' && prev[0] === 's') continue;                      // 直線は続けない
    if(t !== 'c' && t === prev[0]) continue;                        // 坂・ダートも続けない(コーナーは続いてもいい = S字)
    if(t === 'c'){ const sh = ri(SH[0], SH[1]); segs.push(['c', ri(80, 120) + (3 - sh) * 25, (rnd() < .5 ? -1 : 1) * sh]); }
    else if(t === 's') segs.push(['s', ri(170, 360), 0]);
    else segs.push([t, ri(150, 250), 0]);
  }
  segs.push(['s', ri(200, 300), 0]);
  const tot = segs.reduce((a, s) => a + s[1], 0);
  const goal = ri(LEN_MIN, LEN_MAX), k = goal / tot;
  segs.forEach(s => { s[1] = Math.max(60, Math.round(s[1] * k / 10) * 10); });
  const w = rnd() < RAIN_P ? 1 : 0;
  return { nm: pick(PLACE_A) + pick(PLACE_B), th, w: CFG.RAIN === 0 || CFG.RAIN === 1 ? CFG.RAIN : w, s: segs };
}
const courseLen = c => c.s.reduce((a, s) => a + s[1], 0);
// コースの特徴(偵察・ピットで見せる)
function courseInfo(c){
  const cnt = { s: 0, c: 0, h: 0, d: 0 }, len = { s: 0, c: 0, h: 0, d: 0 };
  c.s.forEach(s => { cnt[s[0]]++; len[s[0]] += s[1]; });
  const L = courseLen(c), tags = [];
  if(len.s / L > .5) tags.push('直線が長い');
  if(cnt.c >= 4) tags.push('コーナーが多い');
  if(c.s.some(s => s[0] === 'c' && Math.abs(s[2]) === 3)) tags.push('きついコーナーあり');
  if(cnt.h >= 2) tags.push('上り坂が多い');
  if(cnt.d >= 2) tags.push('ダートが多い');
  return { cnt, len, L, tags, rain: !!c.w };
}

// ---------------- 車 ----------------
// パーツ: { s: 部位, r: レア度0〜3, m: 主な値, b: [おまけ×4], tr: 特性 or '', nm }
function starterPart(s){ return { s, r: 0, m: 1, b: [0, 0, 0, 0], tr: '', nm: 'ノーマル' }; }
function starterCar(){ return { p: [0, 1, 2, 3].map(starterPart), tu: [0, 0, 0, 0] }; }
function rollPart(rnd, miss){
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const up = 1 + Math.min(PH.luckMax, PH.luckUp * (miss || 0));
  const w = PH.rar.map((p, i) => i >= 2 ? p * up : p), sum = w.reduce((a, x) => a + x, 0);
  let x = rnd() * sum, r = 3;
  for(let i = 0; i < 4; i++){ if((x -= w[i]) < 0){ r = i; break; } }
  const s = Math.floor(rnd() * 4), b = [0, 0, 0, 0];
  const nSub = PH.sub[r] >= 1 ? PH.sub[r] : (rnd() < PH.sub[r] ? 1 : 0);
  for(let i = 0; i < nSub; i++){ let k = Math.floor(rnd() * 3); if(k >= s) k++; b[k]++; }
  const tr = rnd() < PH.trait[r] ? TR_OF[s][Math.floor(rnd() * TR_OF[s].length)] : '';
  return { s, r, m: ri(PH.main[r][0], PH.main[r][1]), b, tr, nm: PNAME[s][Math.floor(rnd() * PNAME[s].length)] + ' ' + PKIND[s] };
}
const partSum = p => p.m + p.b.reduce((a, x) => a + x, 0);
// 車のステータス(set: セッティング)
function carStats(car, set){
  const st = [PH.base, PH.base, PH.base, PH.base];
  car.p.forEach(p => { st[p.s] += p.m; p.b.forEach((v, k) => { st[k] += v; }); });
  car.tu.forEach((lv, k) => { st[k] += lv; });
  const d = PH.set[set || 0] || PH.set[0];
  return st.map((v, k) => Math.max(1, v + d[k]));
}
const carTraits = car => car.p.map(p => p.tr).filter(Boolean);

// ---------------- レースの計算(ホストだけ。node のテストからも使う) ----------------
const eff = x => x <= PH.soft ? x : PH.soft + (x - PH.soft) * PH.softK;
function mkRacer(id, st0, trs, form){
  const tr = {}; trs.forEach(k => { tr[k] = 1; });
  const f = 1 + (form || 0), st = st0.map(eff);
  return { id, st, tr, vmax: (PH.v0 + PH.vk * st[0]) * f, acc: (PH.a0 + PH.ak * st[1]) * f, cc: PH.c0 + PH.ck * st[2],
    nb: PH.n0 + PH.nk * st[3], na: PH.na0 + PH.nak * st[3], nd: (PH.nt0 + PH.ntk * st[3]) * (tr.long ? PH.longN : 1) * (tr.dbl ? PH.dblN : 1),
    nl: tr.dbl ? 2 : 1, nt: 0, d: 0, v: 0, fin: -1, out: false, slip: false, lower: false, pos: 0 };
}
function newRace(course, racers){
  const st = []; let a = 0;
  course.s.forEach(s => { st.push(a); a += s[1]; });
  return { c: course, st, L: a, rain: !!course.w, r: racers, t: 0, k: 0, order: [], done: false };
}
function segIdx(R, d){
  if(d >= R.L) return -1;
  let i = 0; while(i + 1 < R.st.length && R.st[i + 1] <= d) i++;
  return i;
}
// 区間の上限速度(ニトロなし)
function capOf(R, r, seg){
  let vmax = r.vmax;
  let mul = 1;
  if(r.tr.last && r.d > R.L * (1 - PH.lastP)) mul += PH.lastV;
  if(r.tr.chase && r.lower) mul += PH.chaseV;
  vmax = vmax * mul + (r.slip ? PH.slip : 0);
  if(!seg) return Math.min(vmax, 90);                                      // ゴールのあと: ゆっくり
  const t = seg[0];
  if(t === 'c'){
    let c = r.cc * PH.cs[Math.abs(seg[2]) - 1];
    if(R.rain && !r.tr.rain) c *= PH.rainC;
    if(r.tr.drift) c *= 1 + PH.drift;
    return Math.min(c, vmax);
  }
  if(t === 'h') return vmax * (r.tr.hill ? PH.hillT[0] : PH.hillV);
  if(t === 'd') return vmax * (r.tr.dirt ? PH.dirtT[0] : PH.dirtV);
  return vmax;
}
function accOf(R, r, seg){
  let a = r.acc * Math.max(.15, 1 - PH.aFall * r.v / r.vmax);
  if(seg && seg[0] === 'h') a *= r.tr.hill ? PH.hillT[1] : PH.hillA;
  if(seg && seg[0] === 'd') a *= r.tr.dirt ? PH.dirtT[1] : PH.dirtA;
  if(r.tr.rocket && R.t < PH.rocketT) a *= PH.rocketA;
  return Math.max(PH.aMin, a);
}
function useNitro(R, r){
  if(R.done || r.out || r.fin >= 0 || r.nl <= 0 || r.nt > 0) return false;
  r.nl--; r.nt = r.nd; return true;
}
function stepRace(R, dt){
  if(R.done) return;
  const live = R.r.filter(r => !r.out);
  // 順位(前の手順の位置で): ゴールした人はゴール順、それ以外は距離
  const ord = live.slice().sort((a, b) => (a.fin >= 0 && b.fin >= 0) ? a.fin - b.fin : a.fin >= 0 ? -1 : b.fin >= 0 ? 1 : b.d - a.d);
  ord.forEach((r, i) => { r.pos = i; r.lower = live.length >= 2 && i >= Math.ceil(live.length / 2); });
  live.forEach(r => {
    r.slip = false;
    if(r.tr.slip && r.fin < 0) r.slip = live.some(o => o !== r && o.d > r.d && o.d - r.d <= PH.slipGap);
  });
  const bms = PH.brake / 3.6;
  live.forEach(r => {
    const i = segIdx(R, r.d), seg = i >= 0 ? R.c.s[i] : null;
    let cap = capOf(R, r, seg), acc = accOf(R, r, seg);
    const nOn = r.nt > 0;
    if(nOn){
      const k = seg && seg[0] === 'c' ? PH.nCorner : 1;
      // ニトロの加速は、速いときほどよく効く(止まりかけでは弱い)
      cap += r.nb * k; acc += r.na * k * Math.min(1.1, Math.max(PH.nLow, r.v / r.vmax));
      r.nt = Math.max(0, r.nt - dt);
    }
    // 次の区間の上限まで、手前から減速しておく
    if(i >= 0){
      const nx = i + 1 < R.c.s.length ? R.c.s[i + 1] : null;
      const capN = capOf(R, r, nx) + (nOn && nx && nx[0] !== 'c' ? r.nb : 0);
      const dist = R.st[i] + seg[1] - r.d;
      const vA = 3.6 * Math.sqrt(Math.pow(capN / 3.6, 2) + 2 * bms * Math.max(0, dist));
      if(vA < cap) cap = vA;
    }
    if(r.v < cap) r.v = Math.min(cap, r.v + acc * dt);
    else r.v = Math.max(cap, r.v - PH.brake * dt);
    const d0 = r.d;
    r.d += r.v / 3.6 * dt;
    if(r.fin < 0 && r.d >= R.L){ r.fin = R.t + dt * (R.L - d0) / Math.max(1e-6, r.d - d0); R.order.push(r.id); }
  });
  R.t += dt; R.k++;
  const lead = live.filter(r => r.fin >= 0).reduce((m, r) => Math.min(m, r.fin), Infinity);
  if(!live.length || live.every(r => r.fin >= 0) || R.t > CFG.MAX_RACE_S || (lead < Infinity && R.t > lead + CFG.AFTER_MS / 1000)) R.done = true;
}
// 最終的な着順(ゴールした人 → 走った距離の順)。抜けた人は入れない
function finalOrder(R){
  return R.r.filter(r => !r.out).sort((a, b) => (a.fin >= 0 && b.fin >= 0) ? a.fin - b.fin : a.fin >= 0 ? -1 : b.fin >= 0 ? 1 : b.d - a.d);
}
const SIM = { PH, CFG, genCourse, courseLen, courseInfo, starterCar, rollPart, carStats, carTraits, partSum, mkRacer, newRace, segIdx, capOf, stepRace, useNitro, finalOrder, TR, TR_OF };

// 受け取ったデータの形チェック(ホストから届くもの)
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const s40 = s => typeof s === 'string' ? s.slice(0, 40) : '';
function okPart(p, s){ return !!p && isInt(p.s, 0, 3) && (s === undefined || p.s === s) && isInt(p.r, 0, 3) && isInt(p.m, 1, 12) && Array.isArray(p.b) && p.b.length === 4 && p.b.every(x => isInt(x, 0, 4)) && (p.tr === '' || (TR[p.tr] && TR[p.tr].s === p.s)) && typeof p.nm === 'string' && p.nm.length <= 20; }
function okCar(c){ return !!c && Array.isArray(c.p) && c.p.length === 4 && c.p.every((p, i) => okPart(p, i)) && Array.isArray(c.tu) && c.tu.length === 4 && c.tu.every(x => isInt(x, 0, TUNE_MAX)); }
function okCourse(c){
  return !!c && typeof c.nm === 'string' && c.nm.length <= 20 && isInt(c.th, 0, THEMES.length - 1) && (c.w === 0 || c.w === 1) && Array.isArray(c.s) && c.s.length >= 3 && c.s.length <= 14 &&
    c.s.every(s => Array.isArray(s) && SEG_NM[s[0]] && isInt(s[1], 20, 2000) && isInt(s[2], -3, 3) && (s[0] === 'c' ? s[2] !== 0 : s[2] === 0));
}
const okSt = st => Array.isArray(st) && st.length === 4 && st.every(x => isInt(x, 1, 40));

// ---------------- 見た目の部品 ----------------
const elx = (tag, cls, txt) => { const d = document.createElement(tag); if(cls) d.className = cls; if(txt !== undefined) d.textContent = txt; return d; };
const SEG_COL = { s: '#8e8e98', c: '#ff9f0a', h: '#30d158', d: '#a0703c' };
// コースの帯(区間の長さの割合で色分け)
function stripEl(c){
  const d = elx('div', 'rg-strip');
  c.s.forEach(s => { const i = elx('i', 't-' + s[0]); i.style.flexGrow = String(s[1]); if(s[0] === 'c') i.textContent = s[2] < 0 ? '↰' : '↱'; d.appendChild(i); });
  return d;
}
function courseCard(c, title){
  const inf = courseInfo(c), box = elx('div', 'rg-crs' + (c.w ? ' rain' : ''));
  const h = elx('div', 'rg-crs-h');
  h.appendChild(elx('b', '', (title ? title + ' ' : '') + c.nm));
  h.appendChild(elx('span', 'rg-w' + (c.w ? ' rain' : ''), c.w ? '雨' : '晴れ'));
  box.appendChild(h);
  box.appendChild(stripEl(c));
  const cnt = ['s', 'c', 'h', 'd'].filter(k => inf.cnt[k]).map(k => SEG_NM[k] + inf.cnt[k]).join(' ・ ');
  box.appendChild(elx('div', 'rg-crs-i', THEMES[c.th].nm + ' / ' + (Math.round(inf.L / 10) * 10).toLocaleString() + 'm / ' + cnt));
  box.appendChild(elx('div', 'rg-crs-i', 'コーナーの割合 ' + Math.round(inf.len.c / inf.L * 100) + '%' + (inf.tags.length ? ' — ' + inf.tags.join('・') : '')));
  return box;
}
// ---------------- パーツと特性の一覧 ----------------
function showCatalog(){
  const box = document.getElementById('a-cat'); if(!box) return;
  box.textContent = '';
  const head = elx('div', 'cat-h');
  head.appendChild(elx('b', '', 'パーツと特性の一覧'));
  const x = elx('button', 'cat-x', '閉じる'); x.onclick = () => { box.classList.remove('on'); document.body.classList.remove('catopen'); }; head.appendChild(x);
  box.appendChild(head);
  const body = elx('div', 'cat-b');
  const sec = (t, note) => { body.appendChild(elx('div', 'eyebrow', t)); if(note) body.appendChild(elx('p', 'cat-note', note)); };
  sec('ステータス', '車のステータスは4つ。それぞれ土台' + PH.base + ' + パーツ + チューン。' + PH.soft + 'を超えると伸びがゆるやかになる(1つに振りすぎない方が強い)');
  const st = elx('div', 'cat-sec');
  [['最高速', '直線・坂・ダートでの速さの上限'], ['加速', 'コーナーのあとやスタートの立ち上がり'], ['コーナー', 'コーナーでの速さの上限(きついコーナーほど大事)'], ['ニトロ', 'ニトロの強さと効く時間']].forEach(([a, b]) => { const r = elx('div', 'cat-row'); r.appendChild(elx('b', '', a)); r.appendChild(elx('span', '', b)); st.appendChild(r); });
  body.appendChild(st);
  sec('パーツガチャ', 'エンジン(最高速)・ターボ(加速)・タイヤ(コーナー)・ニトロタンク(ニトロ)のどれかが出る(同じ確率)。' +
    RAR.map((r, i) => r + ' ' + pc(PH.rar[i]) + '%(+' + PH.main[i][0] + '〜' + PH.main[i][1] + ')').join(' / ') + '。数字は目安');
  body.appendChild(elx('p', 'cat-note', 'R はたまに、SR はおまけで、ほかのステータスも上がる。特性は R ' + pc(PH.trait[1]) + '% / SR ' + pc(PH.trait[2]) + '% / SSR 必ず。チューン(部位ごとに最大Lv' + TUNE_MAX + ')は部位につくので、パーツを付け替えても残る'));
  sec('特性');
  [0, 1, 2, 3].forEach(s => {
    const b = elx('div', 'cat-sec');
    const t = elx('div', 'cat-st'); t.appendChild(elx('i', 'rg-slot s' + s, SLOT[s])); t.appendChild(elx('span', '', '主に ' + ST[s] + ' が上がる')); b.appendChild(t);
    TR_OF[s].forEach(k => { const r = elx('div', 'cat-row'); r.appendChild(elx('b', '', TR[k].nm)); r.appendChild(elx('span', '', TR[k].d())); b.appendChild(r); });
    body.appendChild(b);
  });
  sec('セッティング(各レースの前のピットで選ぶ)');
  const sb = elx('div', 'cat-sec');
  PH.set.forEach((d, i) => { const r = elx('div', 'cat-row'); r.appendChild(elx('b', '', SET_NM[i])); r.appendChild(elx('span', '', i === 0 ? 'そのまま' : d.map((v, k) => v ? ST[k] + (v > 0 ? '+' : '') + v : '').filter(Boolean).join(' '))); sb.appendChild(r); });
  body.appendChild(sb);
  sec('コース', '区間を' + 8 + '〜' + 12 + '個つないだもの。天気は晴れか雨(雨: コーナーの上限 ×' + PH.rainC + ')');
  const cb = elx('div', 'cat-sec');
  [['直線', '最高速が出る。ニトロの使いどころ'], ['コーナー', 'コーナーの値で上限が決まる。手前で自動で減速する。ニトロはほとんど効かない'], ['上り坂', '上限 ×' + PH.hillV + '・加速 ×' + PH.hillA], ['ダート', '上限 ×' + PH.dirtV + '・加速 ×' + PH.dirtA]].forEach(([a, b]) => { const r = elx('div', 'cat-row'); r.appendChild(elx('b', '', a)); r.appendChild(elx('span', '', b)); cb.appendChild(r); });
  body.appendChild(cb);
  box.appendChild(body);
  box.classList.add('on'); document.body.classList.add('catopen');
  body.scrollTop = 0;
}

const CAR_COL = ['#ff453a', '#ffd60a', '#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6fb1', '#e8e8ee'];

window.NomiGames.race = { id: 'race', name: 'RACE', _cfg: CFG, _sim: SIM, showCatalog, make(E){
  const $ = E.$, PF = E.fx;
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const el = elx;

  // =====================================================================
  //  参加者側(表示)
  // =====================================================================
  let ph = 'wait', me = null, meSeq = -1, lastRv = 0, lastPendKey = '', nonce = 0, localEnd = 0, nextAt = 0, uiMode = '', clockT = 0, rev = false, nR = 1;
  let pit = null, rc = null, raf = 0, lastPts = null;

  function view(v){
    ['rc-gar', 'rc-pit', 'rc-run', 'rc-res'].forEach(id => { $(id).style.display = id === v ? 'flex' : 'none'; });
    $('rc-top').style.display = v === 'rc-run' ? 'none' : '';
    $('s-race').scrollTop = 0;
    PF.show(!stopped && v !== 'rc-gar', { amb: v === 'rc-run' ? null : [0x4fa3ff, 0x9ad0ff, 0xffffff] });
  }
  function onBegin(){
    stopped = false; ph = 'wait'; me = null; meSeq = -1; lastRv = 0; lastPendKey = ''; uiMode = ''; pit = null; rc = null; rev = false; nR = 1; lastPts = null;
    $('rc-top').textContent = 'RACE — 改造レース';
    view('rc-gar'); $('rc-panel').textContent = ''; $('rc-car').textContent = ''; $('rc-scout').textContent = '';
    $('rc-time').textContent = '--:--'; $('rc-tk').textContent = '0'; $('rc-note').textContent = '準備中…';
    E.show('s-race');
    PF.load();
    clearInterval(clockT); clockT = setInterval(clock, 200);
    window.addEventListener('resize', fit);
  }
  function fmt(ms){ const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function clock(){
    if(stopped) return;
    const now = performance.now();
    if(ph === 'gar'){
      const rem = localEnd - now;
      $('rc-time').textContent = fmt(rem); $('rc-time').classList.toggle('hot', rem < 15000);
      const bar = $('rc-tbar').firstElementChild;
      if(nextAt > 0 && me){ const left = Math.max(0, nextAt - now); bar.style.transform = 'scaleX(' + (1 - left / CFG.TICK_MS) + ')'; } else bar.style.transform = 'scaleX(0)';
      $('rc-tbar').classList.toggle('over', !!(me && me.tk >= CFG.CAP && !me.pend));
    }else if(ph === 'pit' && pit){
      const rem = pit.end - now;
      $('rc-pt').textContent = Math.max(0, Math.ceil(rem / 1000)) + '秒';
      $('rc-pbar').firstElementChild.style.transform = 'scaleX(' + Math.max(0, rem / CFG.PIT_MS) + ')';
    }
  }

  // ---- 車のカード ----
  function statBars(st, cmp){
    const d = el('div', 'rg-stats');
    st.forEach((v, k) => {
      const r = el('div', 'rg-st');
      r.appendChild(el('span', 'k', ST[k]));
      const bar = el('span', 'bar'); const f = el('i'); f.style.width = Math.min(100, v / 20 * 100) + '%'; bar.appendChild(f);
      if(cmp && cmp[k] !== v){ const g = el('i', cmp[k] > v ? 'up' : 'dn'); const a = Math.min(v, cmp[k]), b = Math.max(v, cmp[k]); g.style.left = Math.min(100, a / 20 * 100) + '%'; g.style.width = Math.min(100, (b - a) / 20 * 100) + '%'; bar.appendChild(g); }
      r.appendChild(bar);
      const val = el('span', 'v', String(v));
      if(cmp && cmp[k] !== v) val.appendChild(el('em', cmp[k] > v ? 'up' : 'dn', '→' + cmp[k]));
      r.appendChild(val);
      d.appendChild(r);
    });
    return d;
  }
  const subTxt = p => p.b.map((v, k) => v ? ST[k] + '+' + v : '').filter(Boolean).join(' ');
  function partRow(p, lv, flash){
    const r = el('div', 'rg-part r' + p.r + (flash ? ' flash' : ''));
    const h = el('div', 'rg-ph');
    h.appendChild(el('i', 'rg-slot s' + p.s, SLOT[p.s]));
    h.appendChild(el('span', 'rg-rar r' + p.r, p.nm === 'ノーマル' ? '—' : RAR[p.r]));
    h.appendChild(el('b', '', p.nm));
    const tu = el('span', 'rg-tu'); for(let i = 0; i < TUNE_MAX; i++) tu.appendChild(el('i', i < lv ? 'on' : '')); h.appendChild(tu);
    r.appendChild(h);
    const s = el('div', 'rg-pd');
    s.appendChild(el('span', '', ST[p.s] + '+' + p.m + (lv ? '(チューン+' + lv + ')' : '') + (subTxt(p) ? ' / ' + subTxt(p) : '')));
    if(p.tr) s.appendChild(el('span', 'rg-tr', '★ ' + TR[p.tr].nm + ' — ' + TR[p.tr].d()));
    r.appendChild(s);
    return r;
  }
  function carCard(car, flash){
    const d = el('div', 'rg-car');
    d.appendChild(statBars(carStats(car, 0)));
    car.p.forEach((p, i) => d.appendChild(partRow(p, car.tu[i], flash === i)));
    return d;
  }
  function newPartCard(p){
    const d = el('div', 'rg-new r' + p.r + ' reveal');
    const h = el('div', 'rg-nh');
    h.appendChild(el('span', 'rg-rar r' + p.r, RAR[p.r])); h.appendChild(el('i', 'rg-slot s' + p.s, SLOT[p.s])); h.appendChild(el('b', '', p.nm));
    d.appendChild(h);
    d.appendChild(el('div', 'rg-pd', ST[p.s] + '+' + p.m + (subTxt(p) ? ' / ' + subTxt(p) : '')));
    if(p.tr) d.appendChild(el('div', 'rg-tr big', '★ ' + TR[p.tr].nm + ' — ' + TR[p.tr].d()));
    return d;
  }
  function bigBtn(title, sub, on, fn){
    const b = el('button', 'abtn');
    b.appendChild(el('b', '', title)); if(sub) b.appendChild(el('small', '', sub));
    b.disabled = !on; b.onclick = fn; return b;
  }
  function act(a, slot){
    if(ph !== 'gar' || !me || me.tk <= 0 || me.pend) return;
    E.audio.init(); E.vibrate(20);
    const o = { t: 'act', a, n: ++nonce }; if(slot !== undefined) o.slot = slot;
    me.tk--; $('rc-tk').textContent = String(me.tk);
    uiMode = 'busy'; renderPanel();
    E.send(o, true);
  }
  function decide(ok){
    if(ph !== 'gar' || !me || !me.pend) return;
    E.vibrate(20);
    me.pend = null; uiMode = 'busy'; renderPanel();
    E.send({ t: 'dec', ok: ok ? 1 : 0, n: ++nonce }, true);
  }
  function renderGar(){
    if(!me) return;
    $('rc-tk').textContent = String(me.tk);
    $('rc-tk').parentElement.classList.toggle('full', me.tk >= CFG.CAP);
    $('rc-lost').textContent = me.lost ? 'あふれた ' + me.lost + '回' : '';
    const box = $('rc-car'); box.textContent = '';
    box.appendChild(carCard(me.car, me.flash));
    me.flash = -1;
    renderScout();
    renderPanel();
  }
  function renderScout(){
    const box = $('rc-scout'); box.textContent = '';
    if(!me || !me.sc.length) return;
    box.appendChild(el('div', 'ilab', '偵察メモ(自分だけに見えている)'));
    me.sc.forEach(([r, c]) => box.appendChild(courseCard(c, '第' + (r + 1) + '戦')));
  }
  function renderPanel(){
    const box = $('rc-panel'); box.textContent = '';
    if(ph !== 'gar' || !me) return;
    const note = $('rc-note');
    note.classList.remove('over');
    if(me.pend){
      uiMode = '';
      const p = me.pend, cur = me.car.p[p.s];
      note.textContent = SLOT[p.s] + 'が出た! 付け替える?(チューンLvはそのまま)';
      box.appendChild(newPartCard(p));
      const now = el('div', 'rg-cur'); now.appendChild(el('small', '', '今のパーツ')); now.appendChild(el('span', '', (cur.nm === 'ノーマル' ? '' : RAR[cur.r] + ' ') + cur.nm + ' — ' + ST[cur.s] + '+' + cur.m + (subTxt(cur) ? ' / ' + subTxt(cur) : '') + (cur.tr ? ' / ★' + TR[cur.tr].nm : ''))); box.appendChild(now);
      const after = { p: me.car.p.slice(), tu: me.car.tu }; after.p[p.s] = p;
      box.appendChild(statBars(carStats(me.car, 0), carStats(after, 0)));
      const g = el('div', 'agrid two');
      const diff = partSum(p) - partSum(cur);
      g.appendChild(bigBtn('付け替える', 'ステ合計 ' + (diff >= 0 ? '+' : '') + diff + (p.tr ? ' / 特性つき' : ''), true, () => decide(true)));
      g.appendChild(bigBtn('捨てる', '今のパーツのまま', true, () => decide(false)));
      box.appendChild(g);
      return;
    }
    if(uiMode === 'tu'){
      note.textContent = 'どの部位をチューンする?(1Lvごとに主なステータス+1)';
      const g = el('div', 'agrid');
      [0, 1, 2, 3].forEach(s => { const lv = me.car.tu[s], mx = lv >= TUNE_MAX; g.appendChild(bigBtn(SLOT[s] + ' Lv' + lv + (mx ? '(最大)' : ' → ' + (lv + 1)), mx ? 'これ以上は上がらない' : ST[s] + ' +1', !mx && me.tk > 0, () => { uiMode = ''; act('tu', s); })); });
      g.appendChild(bigBtn('やめる', '', true, () => { uiMode = ''; renderPanel(); }));
      box.appendChild(g);
      return;
    }
    const can = me.tk > 0 && uiMode !== 'busy';
    const lastSec = localEnd - performance.now() < 20000;
    note.textContent = me.tk >= CFG.CAP ? '満タン! 使わないと次の行動があふれて無駄になる' : me.tk > 0 ? (lastSec ? 'もうすぐ終了! 行動を使い切ろう' : '行動を選ぼう(10秒ごとに1回たまる)') : '次の行動がたまるのを待とう…';
    note.classList.toggle('over', me.tk >= CFG.CAP);
    const tuOk = me.car.tu.some(x => x < TUNE_MAX), scLeft = nR - me.sc.length;
    box.appendChild(bigBtn('パーツガチャ', 'エンジン・ターボ・タイヤ・ニトロのどれか。N/R/SR/SSR', can, () => act('pt')));
    box.appendChild(bigBtn('チューン', tuOk ? '選んだ部位を Lv+1(付け替えても残る)' : '全部Lv' + TUNE_MAX + '(最大)', can && tuOk, () => { uiMode = 'tu'; renderPanel(); }));
    box.appendChild(bigBtn('偵察', scLeft > 0 ? '第' + (me.sc.length + 1) + '戦のコースを、自分だけこっそり見る' : '全部のコースを偵察ずみ', can && scLeft > 0, () => act('sc')));
  }
  function onMe(m){
    if(!Number.isInteger(m.s) || m.s <= meSeq) return;
    if(!okCar(m.car) || !isInt(m.tk, 0, 9)) return;
    meSeq = m.s;
    if(isInt(m.R, 1, 3)) nR = m.R;
    if(m.rev && !rev){ rev = true; }
    const pend = m.pend && okPart(m.pend) ? m.pend : null;
    const sc = Array.isArray(m.sc) ? m.sc.filter(x => Array.isArray(x) && isInt(x[0], 0, 2) && okCourse(x[1])).slice(0, 3) : [];
    me = { car: m.car, tk: m.tk, pend, flash: -1, lost: isInt(m.lost, 0, 9999) ? m.lost : 0, sc };
    if(m.of === 1 && !m.end) overflow();
    if(Number.isFinite(m.rem)) localEnd = performance.now() + m.rem;
    nextAt = Number.isFinite(m.nx) && m.nx >= 0 ? performance.now() + m.nx : 0;
    if(m.end){ ph = 'gend'; $('rc-note').textContent = 'ガレージおわり! まもなくピットへ…'; $('rc-panel').textContent = ''; $('rc-time').textContent = '0:00'; const b = $('rc-car'); b.textContent = ''; b.appendChild(carCard(me.car)); renderScout(); return; }
    ph = 'gar';
    if(uiMode === 'busy') uiMode = '';
    const rv = m.rv;
    if(rv && isInt(rv.n, 1, 1e6) && rv.n > lastRv){
      lastRv = rv.n;
      if(isInt(rv.i, 0, 3)) me.flash = rv.i;
      if(rv.k === 'tu'){ E.audio.beep(880, .12, .2); E.vibrate(30); }
      else if(rv.k === 'eq'){ E.audio.beep(740, .12, .2); }
      else if(rv.k === 'sc'){ E.audio.beep(520, .1, .18); later(() => E.audio.beep(700, .12, .18), 120); }
    }
    const pk = pend ? JSON.stringify(pend) : '';
    if(pend && pk !== lastPendKey) fanfare(pend.r);
    lastPendKey = pk;
    renderGar();
  }
  function overflow(){
    const box = $('rc-tk').parentElement;
    box.classList.remove('spill'); void box.offsetWidth; box.classList.add('spill');
    E.audio.init(); E.audio.beep(220, .18, .22); later(() => E.audio.beep(160, .22, .22), 140);
    E.vibrate([60, 40, 60]);
  }
  function fanfare(r){
    E.audio.init();
    const tones = r === 3 ? [660, 880, 1100, 1320] : r === 2 ? [660, 880, 1100] : r === 1 ? [660, 880] : [600];
    tones.forEach((f, i) => later(() => E.audio.beep(f, .12, .2), i * 110));
    E.vibrate(r === 3 ? [40, 40, 40, 40, 120] : r === 2 ? [40, 40, 80] : 30);
  }

  // ---- ピット ----
  function onPit(m){
    if(!isInt(m.r, 0, 2) || !isInt(m.R, 1, 3) || !okCourse(m.c) || !Number.isFinite(m.rem)) return;
    if(pit && pit.r === m.r) return;
    nR = m.R; rev = rev || !!m.rev;
    pit = { r: m.r, c: m.c, end: performance.now() + m.rem, set: 0 };
    ph = 'pit'; view('rc-pit'); E.vibrate([40, 40, 40]);
    $('rc-top').textContent = 'RACE — 第' + (m.r + 1) + '戦 / 全' + nR + '戦' + (rev ? '(最下位決定)' : '');
    renderPit();
    PF.slam('第' + (m.r + 1) + '戦', { color: 0x4fa3ff, size: 52 });
    E.audio.beep(520, .12, .2); later(() => E.audio.beep(780, .16, .2), 160);
  }
  function setPick(v){
    if(!pit || ph !== 'pit' || pit.set === v) return;
    pit.set = v; E.vibrate(20); E.audio.init(); E.audio.beep(660, .06, .15);
    E.send({ t: 'set', r: pit.r, v, n: ++nonce }, true);
    renderPit();
  }
  function renderPit(){
    const box = $('rc-pbody'); box.textContent = '';
    box.appendChild(el('div', 'ilab', 'コース(全員に公開)'));
    box.appendChild(courseCard(pit.c));
    box.appendChild(el('div', 'ilab', 'セッティング'));
    const g = el('div', 'rg-sets');
    PH.set.forEach((d, i) => {
      const b = el('button', 'rg-set' + (pit.set === i ? ' on' : ''));
      b.appendChild(el('b', '', SET_NM[i]));
      b.appendChild(el('small', '', i === 0 ? 'そのまま' : d.map((v, k) => v ? ST_S[k] + (v > 0 ? '+' : '') + v : '').filter(Boolean).join(' ')));
      b.onclick = () => setPick(i);
      g.appendChild(b);
    });
    box.appendChild(g);
    box.appendChild(el('div', 'rg-hint', 'コーナーが多いなら「コーナー寄り」、直線が長いなら「最高速寄り」が速い'));
    if(me){ box.appendChild(el('div', 'ilab', 'このセッティングでのマイカー')); box.appendChild(statBars(carStats(me.car, 0), carStats(me.car, pit.set))); }
    if(lastPts){ box.appendChild(el('div', 'ilab', 'いまのポイント')); box.appendChild(standEl(lastPts)); }
  }
  function standEl(rows){
    const d = el('div', 'rg-stand');
    rows.forEach((x, i) => { const r = el('div', x[0] === E.myId ? 'me' : ''); r.appendChild(el('span', '', (i + 1) + '. ' + E.nameOf(x[0]))); r.appendChild(el('b', '', x[1] + 'pt')); d.appendChild(r); });
    return d;
  }

  // ---- レース ----
  const cv = $('rc-cv'), g2 = cv.getContext('2d');
  let W = 0, Hh = 0, DPR = 1;
  function fit(){
    const r = $('rc-run').getBoundingClientRect();
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); Hh = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * DPR); cv.height = Math.round(Hh * DPR);
    cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  }
  function onGo(m){
    if(!isInt(m.r, 0, 2) || !okCourse(m.c) || !Number.isFinite(m.at) || !Array.isArray(m.cars) || m.cars.length < 1 || m.cars.length > 8) return;
    const cars = m.cars.filter(x => x && Number.isInteger(x.id) && okSt(x.st) && isInt(x.nl, 0, 2) && Number.isFinite(x.nd) && x.nd > 0 && x.nd < 20);
    if(cars.length !== m.cars.length) return;
    if(rc && rc.r === m.r) return;
    const R = newRace(m.c, []);
    const mine = cars.findIndex(x => x.id === E.myId);
    rc = { amp: 40, r: m.r, R, L: R.L, go: E.toLocal(m.at), cars: cars.map((x, i) => ({ id: x.id, nm: E.nameOf(x.id), col: CAR_COL[i % 8], st: x.st, nl: x.nl, nd: x.nd, d0: 0, v0: 0, t0: 0, err: 0, eAt: 0, rd: 0, v: 0, fl: 0, fin: false })),
      mine, k: -1, cam: 0, camV: 0, cd: -1, done: false, myFin: false, order: [], nitUntil: 0, nitAt: 0, nl: mine >= 0 ? cars[mine].nl : 0, drops: [], lastT: performance.now(), shake: 0 };
    for(let i = 0; i < 70; i++) rc.drops.push({ x: Math.random(), y: Math.random(), s: .6 + Math.random() * .8 });
    ph = 'run'; view('rc-run'); fit();
    $('rc-res').textContent = '';
    renderProg(); updNit();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    E.vibrate(30);
  }
  function onSnap(m){
    if(!rc || m.r !== rc.r || !isInt(m.k, 0, 1e6) || m.k <= rc.k || !Array.isArray(m.c) || m.c.length !== rc.cars.length || !Number.isFinite(m.at)) return;
    rc.k = m.k;
    const now = performance.now(), tl = E.toLocal(m.at);
    m.c.forEach((x, i) => {
      if(!Array.isArray(x) || !Number.isFinite(x[0]) || !Number.isFinite(x[1]) || !Number.isInteger(x[2])) return;
      const c = rc.cars[i], before = predD(c, now);
      c.d0 = x[0] / 10; c.v0 = x[1]; c.t0 = tl; c.fl = x[2];
      const after = predD(c, now);
      c.err = after - (c.eAt ? before - c.err * Math.exp(-(now - c.eAt) / 260) : before);
      if(Math.abs(c.err) > 80) c.err = 0;                         // 大きくずれたら、すぐ合わせる
      c.eAt = now;
      if((c.fl & 2) && !c.fin){ c.fin = true; if(i === rc.mine) myFinish(); }
    });
    if(Array.isArray(m.f)) rc.order = m.f.filter(Number.isInteger).slice(0, 8);
    // ニトロの残り回数はホストに合わせる(押した直後は、自分の画面の表示を優先)
    if(rc.mine >= 0 && now - rc.nitAt > 1500){ rc.nl = (rc.cars[rc.mine].fl >> 3) & 3; updNit(); }
  }
  const predD = (c, now) => c.d0 + c.v0 / 3.6 * Math.min(.7, Math.max(0, (now - c.t0) / 1000));
  const rdOf = (c, now) => predD(c, now) - (c.eAt ? c.err * Math.exp(-(now - c.eAt) / 260) : 0);
  function myFinish(){
    rc.myFin = true;
    const pos = rc.order.indexOf(E.myId);
    const p = pos >= 0 ? pos + 1 : 0;
    PF.slam('FINISH!' + (p ? '  ' + p + '位' : ''), { color: p === 1 ? 0xffd60a : 0x4fa3ff, size: 46 });
    if(p && p <= 3){ PF.confetti(p === 1 ? 140 : 70); [660, 880, 1100, 1320].slice(0, 5 - p).forEach((f, i) => later(() => E.audio.beep(f, .14, .22), i * 120)); E.vibrate([60, 40, 60, 40, 160]); }
    else { E.audio.beep(520, .2, .2); E.vibrate(80); }
    updNit();
  }
  function pressNitro(e){
    if(e && e.cancelable) e.preventDefault();
    if(!rc || rc.mine < 0 || rc.myFin || rc.done) return;
    const now = performance.now();
    if(now < rc.go || rc.nl <= 0 || now < rc.nitUntil) return;
    rc.nl--; rc.nitAt = now; rc.nitUntil = now + rc.cars[rc.mine].nd * 1000;
    E.audio.init(); E.vibrate(60); E.audio.boom(.18); E.audio.beep(180, .35, .18);
    E.send({ t: 'nit', r: rc.r, n: ++nonce }, true);
    PF.pop($('rc-nit'), { color: 0x4fa3ff, power: 2 });
    rc.shake = 1;
    updNit();
  }
  function updNit(){
    const b = $('rc-nit'); if(!rc) return;
    const now = performance.now(), on = now < rc.nitUntil;
    b.classList.toggle('on', on);
    b.disabled = rc.mine < 0 || rc.myFin || rc.done || now < rc.go || (rc.nl <= 0 && !on);
    $('rc-nl').textContent = rc.mine < 0 ? '観戦中' : on ? 'ニトロ中!' : rc.nl > 0 ? '残り ' + rc.nl + '回' : '使い切った';
  }
  function renderProg(){
    const box = $('rc-prog'); box.textContent = '';
    box.appendChild(stripEl(rc.R.c));
    const dots = el('div', 'rg-dots');
    rc.cars.forEach((c, i) => { const d = el('i', i === rc.mine ? 'me' : ''); d.style.background = c.col; c.dot = d; dots.appendChild(d); });
    box.appendChild(dots);
  }
  // 道の中心のずれ(px)。コーナーは左右に曲げて見せる
  function bend(d){
    const R = rc.R, i = segIdx(R, d); if(i < 0 || d < 0) return 0;
    const s = R.c.s[i]; if(s[0] !== 'c') return 0;
    const t = (d - R.st[i]) / s[1];
    return Math.sign(s[2]) * Math.min(W * (.04 + .04 * Math.abs(s[2])), rc.amp) * Math.sin(Math.PI * t);
  }
  function segType(d){ if(!rc || d < 0 || d >= rc.L) return 's'; const i = segIdx(rc.R, d); return i < 0 ? 's' : rc.R.c.s[i][0]; }
  function frame(){
    if(stopped || !rc){ return; }
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(.05, (now - rc.lastT) / 1000); rc.lastT = now;
    rc.cars.forEach(c => { c.rd = Math.max(0, rdOf(c, now)); });
    // 自分の車を追う(ゴールしたら、まだ走っている先頭の車)。観戦中は先頭
    let tgt = rc.mine >= 0 ? rc.cars[rc.mine] : null;
    if(!tgt || (rc.myFin && now - rc.finAt > 2500)){ const run = rc.cars.filter(c => !c.fin && !(c.fl & 4)); tgt = run.length ? run.reduce((a, b) => b.rd > a.rd ? b : a, run[0]) : (tgt || rc.cars[0]); }
    if(rc.myFin && !rc.finAt) rc.finAt = now;
    rc.cam += (tgt.rd - rc.cam) * Math.min(1, dt * 8);
    draw(now, tgt, dt);
    hud(now);
  }
  function hud(now){
    // カウントダウン
    const left = rc.go - now;
    const cd = left > 0 ? Math.ceil(left / 1000) : 0;
    if(cd !== rc.cd){
      rc.cd = cd;
      const box = $('rc-cd');
      if(cd >= 1 && cd <= 3){ box.textContent = String(cd); box.className = PF.ok() ? '' : 'on'; PF.slam(String(cd), { color: 0x4fa3ff, size: 96, n: 18 }); E.audio.beep(440, .14, .25); E.vibrate(40); }
      else if(cd === 0 && left > -1500){ box.textContent = 'GO!'; box.className = PF.ok() ? '' : 'on go'; PF.slam('GO!', { color: 0x30d158, size: 110 }); E.audio.beep(880, .3, .28); E.vibrate(120); later(() => { if(rc && rc.cd === 0) $('rc-cd').className = ''; }, 900); updNit(); }
      else box.className = cd > 3 ? 'on wait' : '';
      if(cd > 3) box.textContent = 'まもなくスタート';
    }
    // 順位
    const live = rc.cars.filter(c => !(c.fl & 4));
    const ord = live.slice().sort((a, b) => { const ia = rc.order.indexOf(a.id), ib = rc.order.indexOf(b.id); if(ia >= 0 && ib >= 0) return ia - ib; if(ia >= 0) return -1; if(ib >= 0) return 1; return b.rd - a.rd; });
    const me = rc.mine >= 0 ? rc.cars[rc.mine] : null;
    if(me){
      const p = ord.indexOf(me) + 1;
      const pk = p + '/' + live.length;
      if(rc.posK !== pk){ rc.posK = pk; $('rc-pos').textContent = ''; $('rc-pos').appendChild(document.createTextNode(String(p))); $('rc-pos').appendChild(el('small', '', '位 / ' + live.length)); }
      const v = Math.max(0, Math.round(me.v0));
      $('rc-spd').firstChild.nodeValue = String(me.fin ? 0 : v);
      $('rc-spd').classList.toggle('nit', !!(me.fl & 1) || now < rc.nitUntil);
      // 次の区間
      let t = '';
      if(me.fin) t = 'ゴール!';
      else{
        const R = rc.R, i = segIdx(R, me.rd);
        if(i >= 0){
          const s = R.c.s[i], left = Math.max(0, Math.round(R.st[i] + s[1] - me.rd));
          const nx = R.c.s[i + 1];
          const nm = x => x[0] === 'c' ? (x[2] < 0 ? '左' : '右') + 'コーナー' + (Math.abs(x[2]) === 3 ? '(きつい)' : Math.abs(x[2]) === 1 ? '(ゆるい)' : '') : SEG_NM[x[0]];
          if(s[0] === 'c') t = nm(s) + ' 中…';
          else t = SEG_NM[s[0]] + ' あと' + left + 'm';
          if(nx) t += '  →  次: ' + nm(nx) + ' ' + left + 'm先';
          else t += '  →  ゴール';
        }
      }
      if(rc.nextK !== t){ rc.nextK = t; $('rc-next').textContent = t; }
    }else{ $('rc-pos').textContent = '観戦'; $('rc-spd').firstChild.nodeValue = String(Math.round(ord[0] ? ord[0].v0 : 0)); $('rc-next').textContent = ord[0] ? '先頭: ' + ord[0].nm : ''; }
    rc.cars.forEach(c => { if(c.dot) c.dot.style.left = Math.min(100, c.rd / rc.L * 100) + '%'; });
    if(now >= rc.nitUntil && $('rc-nit').classList.contains('on')) updNit();
  }
  function draw(now, tgt, dt){
    const c = g2, R = rc.R, rain = !!R.c.w;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    const K = Hh / 230, carY = Hh * .7;
    let sx = 0, sy = 0;
    const meC = rc.mine >= 0 ? rc.cars[rc.mine] : null, nitOn = meC && ((meC.fl & 1) || now < rc.nitUntil) && !meC.fin;
    if(rc.shake > 0){ rc.shake = Math.max(0, rc.shake - dt * 2); sx = (Math.random() - .5) * 8 * rc.shake; sy = (Math.random() - .5) * 8 * rc.shake; }
    if(nitOn){ sx += (Math.random() - .5) * 2; sy += (Math.random() - .5) * 2; }
    c.save(); c.translate(sx, sy);
    c.fillStyle = rain ? '#0b1219' : '#0d130f'; c.fillRect(-10, -10, W + 20, Hh + 20);
    const n = rc.cars.length, lanes = Math.max(3, n);
    const laneW = Math.min(48, Math.max(28, W * .76 / lanes)), RW = laneW * lanes;
    rc.amp = Math.max(24, (W - RW) / 2 + 18);
    const yOf = d => carY - (d - rc.cam) * K;
    const STEP = 6;
    // 道の外(ダートは茶色っぽく)
    for(let y = Hh + STEP; y > -STEP; y -= STEP){ if(segType(rc.cam + (carY - y) / K) === 'd'){ c.fillStyle = rain ? '#1d1912' : '#241b10'; c.fillRect(0, y - STEP, W, STEP + .7); } }
    // 道
    for(let y = Hh + STEP; y > -STEP; y -= STEP){
      const d1 = rc.cam + (carY - y) / K, d2 = rc.cam + (carY - (y - STEP)) / K;
      const x1 = W / 2 + bend(d1), x2 = W / 2 + bend(d2), t = segType(d1);
      c.fillStyle = t === 'd' ? (rain ? '#5a4632' : '#6e4d2c') : t === 'h' ? (rain ? '#283a35' : '#2f3d31') : (rain ? '#262c36' : '#2b2c32');
      c.beginPath(); c.moveTo(x1 - RW / 2, y + .7); c.lineTo(x1 + RW / 2, y + .7); c.lineTo(x2 + RW / 2, y - STEP); c.lineTo(x2 - RW / 2, y - STEP); c.closePath(); c.fill();
      // 縁石(コーナーは赤白)・白線
      const red = t === 'c' && Math.floor(d1 / 4) % 2 === 0;
      c.fillStyle = t === 'c' ? (red ? '#ff453a' : '#f4f4f6') : 'rgba(255,255,255,.55)';
      const ew = t === 'c' ? 5 : 2;
      c.fillRect(x1 - RW / 2 - ew, y - STEP, ew, STEP + .5); c.fillRect(x1 + RW / 2, y - STEP, ew, STEP + .5);
      // 車線の点線
      if(Math.floor(d1 / 6) % 2 === 0 && t !== 'd'){ c.fillStyle = 'rgba(255,255,255,.16)'; for(let i = 1; i < lanes; i++) c.fillRect(x1 - RW / 2 + i * laneW - 1, y - STEP, 2, STEP + .5); }
    }
    // 上り坂の矢印
    c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = 3; c.lineCap = 'round';
    const dTop = rc.cam + carY / K, dBot = rc.cam - (Hh - carY) / K;
    for(let d = Math.ceil(dBot / 22) * 22; d < dTop; d += 22){
      if(segType(d) !== 'h') continue;
      const y = yOf(d), x = W / 2 + bend(d);
      c.beginPath(); c.moveTo(x - 16, y + 9); c.lineTo(x, y - 5); c.lineTo(x + 16, y + 9); c.stroke();
    }
    // スタートとゴールの線(チェッカー)
    [0, rc.L].forEach((d, j) => {
      const y = yOf(d); if(y < -20 || y > Hh + 20) return;
      const x = W / 2 + bend(d), sq = 7, nq = Math.ceil(RW / sq);
      for(let r = 0; r < 2; r++) for(let i = 0; i < nq; i++){ c.fillStyle = (i + r) % 2 ? '#f4f4f6' : '#111'; c.fillRect(x - RW / 2 + i * sq, y - sq * (r + 1) + sq, sq, sq); }
      if(j === 1){ c.fillStyle = 'rgba(255,255,255,.85)'; c.font = '800 12px ' + FONT; c.textAlign = 'center'; c.fillText('FINISH', x, y - 22); }
    });
    // 車
    const order = rc.cars.map((x, i) => i).sort((a, b) => rc.cars[a].rd - rc.cars[b].rd);
    order.forEach(i => {
      const car = rc.cars[i]; if(car.fl & 4) return;
      const y = yOf(car.rd); if(y < -40 || y > Hh + 40) return;
      const x = W / 2 + bend(car.rd) + (i - (n - 1) / 2) * laneW;
      const ang = Math.atan2(bend(car.rd + 2) - bend(car.rd - 2), 4 * K);
      const w = laneW * .56, h = w * 1.75, mine = i === rc.mine;
      const on = (car.fl & 1) || (mine && now < rc.nitUntil && !car.fin);
      c.save(); c.translate(x, y); c.rotate(ang);
      if(on){
        const fl = h * (.55 + Math.random() * .35);
        const gr = c.createLinearGradient(0, h / 2, 0, h / 2 + fl);
        gr.addColorStop(0, 'rgba(160,220,255,.95)'); gr.addColorStop(.4, 'rgba(79,163,255,.8)'); gr.addColorStop(1, 'rgba(79,163,255,0)');
        c.fillStyle = gr; c.beginPath(); c.moveTo(-w * .32, h / 2 - 2); c.lineTo(w * .32, h / 2 - 2); c.lineTo(0, h / 2 + fl); c.closePath(); c.fill();
      }
      c.shadowColor = mine ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'; c.shadowBlur = mine ? 12 : 6;
      c.fillStyle = car.col; rrect(c, -w / 2, -h / 2, w, h, w * .28); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(0,0,0,.55)'; rrect(c, -w * .34, -h * .2, w * .68, h * .26, 3); c.fill();
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(-w * .08, -h * .46, w * .16, h * .22);
      if(mine){ c.strokeStyle = '#fff'; c.lineWidth = 2; rrect(c, -w / 2, -h / 2, w, h, w * .28); c.stroke(); }
      c.restore();
      c.fillStyle = mine ? '#fff' : 'rgba(255,255,255,.7)'; c.font = (mine ? '800 11px ' : '700 9px ') + FONT; c.textAlign = 'center';
      c.fillText(mine ? 'YOU' : car.nm.slice(0, 6), x, y + h / 2 + 12);
    });
    // スピード線(ニトロ中や速いとき)
    const spd = meC ? meC.v0 : 0;
    if(nitOn || spd > 250){
      c.strokeStyle = nitOn ? 'rgba(160,215,255,.5)' : 'rgba(255,255,255,.18)'; c.lineWidth = 2;
      for(let i = 0; i < (nitOn ? 14 : 6); i++){ const x = Math.random() < .5 ? Math.random() * W * .18 : W - Math.random() * W * .18, y = Math.random() * Hh; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 30 + Math.random() * 60); c.stroke(); }
    }
    // 雨
    if(rain){
      c.fillStyle = 'rgba(60,110,180,.12)'; c.fillRect(-10, -10, W + 20, Hh + 20);
      c.strokeStyle = 'rgba(180,210,255,.45)'; c.lineWidth = 1.2;
      const fall = (spd / 3.6 * K * .25 + 500) * dt;
      rc.drops.forEach(p => { p.y += fall * p.s / Hh; if(p.y > 1) { p.y -= 1; p.x = Math.random(); } const x = p.x * W, y = p.y * Hh; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y + 12 * p.s); c.stroke(); });
    }
    c.restore();
  }
  function rrect(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---- レースの結果 ----
  function onRend(m){
    if(!rc || m.r !== rc.r || !Array.isArray(m.rows) || !Array.isArray(m.tot)) return;
    rc.done = true; updNit();
    const rows = m.rows.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isInt(x[1], 1, 8) && Number.isInteger(x[2]) && isInt(x[3], 0, 10)).slice(0, 8);
    lastPts = m.tot.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isInt(x[1], 0, 999)).slice(0, 8);
    later(() => {
      if(stopped) return;
      ph = 'res'; cancelAnimationFrame(raf); view('rc-res');
      $('rc-top').textContent = 'RACE — 第' + (m.r + 1) + '戦 結果';
      const box = $('rc-res'); box.textContent = '';
      box.appendChild(el('div', 'br-h', '第' + (m.r + 1) + '戦 ' + s40(rc.R.c.nm)));
      const t = el('div', 'rg-rtab');
      rows.forEach(x => {
        const r = el('div', (x[0] === E.myId ? 'me ' : '') + (x[1] === 1 ? 'win' : ''));
        r.appendChild(el('span', 'p', x[1] + '位'));
        r.appendChild(el('span', 'n', E.nameOf(x[0])));
        r.appendChild(el('span', 't', x[2] >= 0 ? (x[2] / 100).toFixed(2) + '秒' : '—'));
        r.appendChild(el('b', '', '+' + x[3]));
        t.appendChild(r);
        later(() => PF.rowIn(r, x[1] === 1 ? 'win' : ''), 200 + x[1] * 120);
      });
      box.appendChild(t);
      box.appendChild(el('div', 'ilab', m.next ? '合計ポイント' : '最終ポイント'));
      box.appendChild(standEl(lastPts));
      box.appendChild(el('div', 'rg-hint', m.next ? 'まもなく 第' + (m.r + 2) + '戦のピットへ…' : 'まもなく最終結果…'));
      const mine = rows.find(x => x[0] === E.myId);
      if(mine && mine[1] === 1){ PF.confetti(90); }
    }, 1800);
  }
  function onFin(m){
    if(!Array.isArray(m.rk)) return;
    ph = 'fin'; cancelAnimationFrame(raf);
    const rk = m.rk.filter(x => Array.isArray(x) && Number.isInteger(x[0]) && isInt(x[1], 0, 999)).slice(0, 8);
    const n = rk.length;
    const lines = rk.map((x, i) => ({ a: (i + 1) + '位  ' + E.nameOf(x[0]), b: x[1] + 'pt' + (s40(x[2]) ? '  ' + s40(x[2]) : ''), cls: m.rev ? (i === n - 1 ? 'lose' : '') : (i === 0 ? 'win' : '') }));
    const top = rk[0] ? rk[0][0] : -1, last = rk[n - 1] ? rk[n - 1][0] : -1;
    const stats = typeof m.cp === 'string' ? m.cp.slice(0, 300) : '';
    if(m.rev){
      E.showResult({ title: 'RACE', reason: 'グランプリ 全' + nR + '戦 — 最下位決定', pen: last === E.myId ? 'あなたが最下位…' : E.nameOf(last) + ' が最下位!', lines, stats });
      E.audio.scare(); E.vibrate(last === E.myId ? [0, 200, 80, 400] : [0, 120]);
      PF.show(true); later(() => PF.doom($('r-pen')), 200);
      return;
    }
    E.showResult({ title: 'RACE', reason: 'グランプリ 全' + nR + '戦', pen: top === E.myId ? 'あなたの優勝!' : E.nameOf(top) + ' の優勝!', lines, stats });
    if(top === E.myId) E.vibrate([80, 60, 80, 60, 300]);
    PF.show(true); later(() => { const r = $('r-lines').firstElementChild; PF.confetti(140); if(r) PF.rowIn(r, 'win'); PF.pop($('r-pen'), { color: 0xffd60a, power: 2.5, star: true }); }, 200);
  }

  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'me') onMe(m);
    else if(m.t === 'pit') onPit(m);
    else if(m.t === 'rgo') onGo(m);
    else if(m.t === 'rs') onSnap(m);
    else if(m.t === 'rend') onRend(m);
    else if(m.t === 'fin') onFin(m);
  }
  const nb = $('rc-nit');
  nb.addEventListener('pointerdown', pressNitro, { passive: false });
  nb.addEventListener('contextmenu', e => e.preventDefault());
  const catBtn = () => showCatalog();
  $('rc-catbtn').addEventListener('click', catBtn);

  // =====================================================================
  //  ホスト(審判)
  // =====================================================================
  const H = { phase: 'idle', P: new Map(), names: [], crs: [], R: 1, ri: -1, rev: false, endAt: 0, nextTick: 0, tickT: 0, endT: 0, seq: 0, rvn: 0, RS: null, goAt: 0, simT: 0, pitT: 0 };
  const readOn = (sel, key, ok, d) => { try{ const b = document.querySelector('#l-race button[data-' + key + '].on'); const v = b ? parseInt(b.dataset[key], 10) : d; return ok(v) ? v : d; }catch(e){ return d; } };
  function sendMe(id, extra){
    const p = H.P.get(id); if(!p) return;
    const now = performance.now();
    const o = { t: 'me', s: ++H.seq, R: H.R, car: p.car, tk: p.tk, lost: p.lost, pend: p.pend, sc: p.sc.map(r => [r, H.crs[r]]), rem: Math.max(0, Math.round(H.endAt - now)), nx: H.nextTick && H.nextTick < H.endAt ? Math.max(0, Math.round(H.nextTick - now)) : -1 };
    if(p.rv) o.rv = p.rv;
    if(H.rev) o.rev = 1;
    if(extra) Object.assign(o, extra);
    E.hostSend(id, o, true);
  }
  function hostStart(){
    stopHost();
    const mins = readOn('', 'm', v => MINS.includes(v), 3);
    H.R = readOn('', 'r', v => v === 1 || v === 3, 3);
    try{ const b = document.querySelector('#l-race button[data-v].on'); H.rev = !!(b && b.dataset.v === 'last'); }catch(e){ H.rev = false; }
    H.phase = 'gar'; H.P = new Map(); H.seq = 0; H.rvn = 0; H.RS = null; H.ri = -1;
    H.names = E.players().map(p => [p.id, p.name]);
    H.crs = Array.from({ length: H.R }, () => genCourse(rndF));
    const ms = CFG.GARAGE_MS || mins * 60000, now = performance.now();
    H.endAt = now + ms; H.nextTick = now + CFG.TICK_MS;
    E.players().forEach(p => H.P.set(p.id, { car: starterCar(), tk: 1, lost: 0, pend: null, n: 0, nn: 0, rv: null, miss: 0, sc: [], pts: 0, res: [], set: [] }));
    H.P.forEach((_, id) => sendMe(id));
    H.tickT = setInterval(() => {
      if(H.phase !== 'gar') return;
      H.nextTick = performance.now() + CFG.TICK_MS;
      H.P.forEach((p, id) => { if(p.tk < CFG.CAP){ p.tk++; sendMe(id); } else { p.lost++; sendMe(id, { of: 1 }); } });
    }, CFG.TICK_MS);
    H.endT = setTimeout(endGarage, ms);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string') return;
    const p = H.P.get(id); if(!p) return;
    if(m.t === 'nit'){ onNit(id, p, m); return; }
    if(m.t === 'set'){
      if(H.phase === 'pit' && m.r === H.ri && isInt(m.v, 0, PH.set.length - 1) && Number.isInteger(m.n) && m.n > p.n){ p.n = m.n; p.set[H.ri] = m.v; }
      return;
    }
    if(H.phase !== 'gar') return;
    if(!Number.isInteger(m.n) || m.n <= p.n) return;
    p.n = m.n;
    if(m.t === 'act'){
      if(p.tk <= 0 || p.pend){ sendMe(id); return; }
      if(m.a === 'pt'){
        const part = rollPart(rndF, p.miss);
        p.miss = part.r >= 2 ? 0 : p.miss + 1;
        p.tk--; p.pend = part;
      }else if(m.a === 'tu'){
        if(!isInt(m.slot, 0, 3) || p.car.tu[m.slot] >= TUNE_MAX){ sendMe(id); return; }
        p.tk--; p.car.tu[m.slot]++; p.rv = { n: ++H.rvn, k: 'tu', i: m.slot };
      }else if(m.a === 'sc'){
        const r = H.crs.findIndex((_, i) => !p.sc.includes(i));
        if(r < 0){ sendMe(id); return; }
        p.tk--; p.sc.push(r); p.rv = { n: ++H.rvn, k: 'sc' };
      }
      sendMe(id);
    }else if(m.t === 'dec'){
      if(!p.pend){ sendMe(id); return; }
      const part = p.pend; p.pend = null;
      if(m.ok === 1){ p.car.p[part.s] = part; p.rv = { n: ++H.rvn, k: 'eq', i: part.s }; }
      sendMe(id);
    }
  }
  function hostOnLeave(id){
    H.P.delete(id);
    if(H.RS){ const r = H.RS.r.find(x => x.id === id); if(r) r.out = true; }
  }
  function endGarage(){
    if(H.phase !== 'gar') return;
    H.phase = 'gp';
    clearInterval(H.tickT); clearTimeout(H.endT);
    H.P.forEach((p, id) => { p.pend = null; sendMe(id, { end: 1, rem: 0, nx: -1 }); });
    later(() => startPit(0), 2200);
  }
  function startPit(ri){
    if(stopped) return;
    H.phase = 'pit'; H.ri = ri;
    E.hostBcast({ t: 'pit', r: ri, R: H.R, c: H.crs[ri], rem: CFG.PIT_MS, rev: H.rev ? 1 : 0 }, true);
    H.pitT = later(startRace, CFG.PIT_MS);
  }
  function startRace(){
    if(stopped || H.phase !== 'pit') return;
    const ids = Array.from(H.P.keys()).filter(id => E.players().some(p => p.id === id)).slice(0, 8);
    const racers = ids.map(id => { const p = H.P.get(id), set = p.set[H.ri] || 0; return mkRacer(id, carStats(p.car, set), carTraits(p.car), (rndF() * 2 - 1) * PH.form); });
    H.RS = newRace(H.crs[H.ri], racers);
    H.phase = 'race';
    H.goAt = performance.now() + CFG.CD_MS;
    E.hostBcast({ t: 'rgo', r: H.ri, at: H.goAt, c: H.crs[H.ri], cars: racers.map(x => ({ id: x.id, st: x.st.map(v => Math.round(v)), nl: x.nl, nd: Math.round(x.nd * 100) / 100 })) }, true);
    clearInterval(H.simT);
    H.simT = setInterval(simTick, 50);
  }
  const flagsOf = r => (r.nt > 0 ? 1 : 0) | (r.fin >= 0 ? 2 : 0) | (r.out ? 4 : 0) | (Math.max(0, Math.min(3, r.nl)) << 3);
  function snapR(){
    const RS = H.RS;
    E.hostBcast({ t: 'rs', r: H.ri, k: RS.k, at: H.goAt + RS.t * 1000, c: RS.r.map(x => [Math.round(x.d * 10), Math.round(x.v), flagsOf(x)]), f: RS.order.slice() }, false);
  }
  function simTick(){
    const RS = H.RS; if(stopped || !RS || H.phase !== 'race'){ clearInterval(H.simT); return; }
    const want = Math.floor((performance.now() - H.goAt) / CFG.DT);
    if(want < 0){ return; }
    let n = 0;
    while(RS.k < want && !RS.done && n < 25){ stepRace(RS, CFG.DT / 1000); n++; if(RS.k % CFG.SNAP_N === 0) snapR(); }
    if(RS.done) endRace();
  }
  function onNit(id, p, m){
    if(H.phase !== 'race' || !H.RS || m.r !== H.ri || !Number.isInteger(m.n) || m.n <= p.nn) return;
    p.nn = m.n;
    if(performance.now() < H.goAt) return;
    const r = H.RS.r.find(x => x.id === id); if(r) useNitro(H.RS, r);
  }
  function endRace(){
    if(H.phase !== 'race') return;
    clearInterval(H.simT);
    const RS = H.RS; snapR();
    H.phase = 'res';
    const ord = finalOrder(RS).filter(r => H.P.has(r.id));
    const rows = ord.map((r, i) => { const p = H.P.get(r.id), pts = PTS[i] || 0; p.pts += pts; p.res[H.ri] = i + 1; return [r.id, i + 1, r.fin >= 0 ? Math.round(r.fin * 100) : -1, pts]; });
    const next = H.ri + 1 < H.R;
    E.hostBcast({ t: 'rend', r: H.ri, rows, tot: standings().map(x => [x[0], x[1]]), next: next ? 1 : 0 }, true);
    later(() => { if(stopped) return; if(next) startPit(H.ri + 1); else finish(); }, CFG.RES_MS);
  }
  // 合計ポイント順(同点なら、最後のレースで上だった人が上)
  function standings(){
    return Array.from(H.P.entries()).map(([id, p]) => [id, p.pts, p.res.slice()]).sort((a, b) => {
      if(b[1] !== a[1]) return b[1] - a[1];
      for(let i = H.R - 1; i >= 0; i--){ const x = a[2][i] || 9, y = b[2][i] || 9; if(x !== y) return x - y; }
      return 0;
    });
  }
  function carText(id){
    const p = H.P.get(id); if(!p) return '';
    const st = carStats(p.car, 0);
    return ST.map((n, k) => n + st[k]).join(' ') + '\n' + p.car.p.map((x, i) => SLOT[i] + ': ' + (x.nm === 'ノーマル' ? 'ノーマル' : RAR[x.r] + ' ' + x.nm) + (p.car.tu[i] ? ' Lv' + p.car.tu[i] : '') + (x.tr ? ' ★' + TR[x.tr].nm : '')).join('\n');
  }
  function finish(){
    if(H.phase !== 'res') return;
    H.phase = 'done';
    const st = standings();
    const rk = st.map(x => [x[0], x[1], x[2].filter(Boolean).map(v => v + '位').join('・')]);
    const key = H.rev ? st[st.length - 1] : st[0];
    E.hostBcast({ t: 'fin', rk, rev: H.rev ? 1 : 0, cp: key ? (H.rev ? '最下位のマシン\n' : '優勝マシン\n') + carText(key[0]) : '' }, true);
  }
  function stopHost(){ clearInterval(H.tickT); clearTimeout(H.endT); clearInterval(H.simT); clearTimeout(H.pitT); }
  function stop(){
    stopped = true; stopHost(); clearInterval(clockT); cancelAnimationFrame(raf); PF.show(false);
    timers.forEach(t => clearTimeout(t));
    window.removeEventListener('resize', fit);
    nb.removeEventListener('pointerdown', pressNitro);
    $('rc-catbtn').removeEventListener('click', catBtn);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop, _t: { H } };
} };
})();
