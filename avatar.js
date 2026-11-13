/* キャラの顔アイコン(パーツを組み合わせてSVGで描く。画像ファイルは使わない)
 *
 *  NomiAvatar.make({ av, a, d, h, sk, r }, size) → <svg>
 *   av : キャラごとの番号(顔・髪型・色が決まる。同じ番号なら誰のスマホでも同じ顔)
 *   a/d/h : 素のステータス → 背景の色(攻=赤 / 防=青 / HP=緑 / バランス=紫)
 *   sk : スキル → 小物(渾身=ハチマキ / 薙ぎ払い=ツノ / 狙撃=片メガネ / 吸収=キバ /
 *                       治癒=天使の輪 / 鉄壁=カブト / 挑発=王冠 / 反撃=仮面)
 *   r  : レア度 → 枠の色(CSS の --rc)
 */
(function(){
'use strict';
const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

// 番号から毎回同じ乱数列を作る
function rng(seed){
  let t = (seed >>> 0) || 0x9e3779b9;
  return () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const THEME = {
  atk: ['#ff7a59', '#5c1408', '#e8553a'],
  def: ['#5aa8ff', '#0f2a55', '#3a7fd6'],
  hp:  ['#4fdc8f', '#0c4026', '#2fae6a'],
  bal: ['#b892ff', '#2e1b5e', '#8a63e0']
};
const SKIN = ['#ffdcbf', '#f6c79a', '#e6ad7a', '#c98a5a', '#8f5a3a', '#ffe3ec', '#cfe6ff', '#d9f2c9'];
const SKIN_W = [18, 18, 14, 12, 10, 10, 9, 9];
const HAIR = ['#2a2a2e', '#5b3a26', '#d9a441', '#ececf0', '#c9372c', '#2f7fd8', '#8e4fd0', '#159a7f', '#ff7eb6', '#f08a24'];

function themeOf(a, d, h){
  const mx = Math.max(a, d, h), mn = Math.min(a, d, h);
  if(mx - mn <= 1) return 'bal';
  return a === mx ? 'atk' : d === mx ? 'def' : 'hp';
}
function wpick(r, ws){ const t = ws.reduce((x, y) => x + y, 0); let v = r() * t; for(let i = 0; i < ws.length; i++){ if((v -= ws[i]) < 0) return i; } return ws.length - 1; }

function make(c, size){
  const r = rng(c.av || 0);
  const th = THEME[themeOf(c.a, c.d, c.h)];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'face');
  if(size){ svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const S = (tag, at, par) => { const e = document.createElementNS(NS, tag); for(const k in at) e.setAttribute(k, at[k]); (par || svg).appendChild(e); return e; };
  const id = 'avg' + (++uid);

  // 背景
  const defs = S('defs', {});
  const lg = S('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  S('stop', { offset: '0', 'stop-color': th[0] }, lg); S('stop', { offset: '1', 'stop-color': th[1] }, lg);
  S('rect', { x: 0, y: 0, width: 64, height: 64, rx: 14, fill: 'url(#' + id + ')' });

  const skin = SKIN[wpick(r, SKIN_W)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const hairStyle = Math.floor(r() * 7);
  const eyes = Math.floor(r() * 5), mouth = Math.floor(r() * 5), blush = r() < .5;
  const rx = 14.5 + r() * 2.5, ry = 15.5 + r() * 2.5;
  const ink = '#1d1a22', sk = c.sk;

  // 後ろ髪
  if(hairStyle === 2 && sk !== 'wall') S('path', { d: 'M13 31 Q13 11 32 11 Q51 11 51 31 L52 50 Q46 46 45 36 L19 36 Q18 46 12 50 Z', fill: hair });
  if(hairStyle === 5 && sk !== 'wall') S('circle', { cx: 49, cy: 23, r: 6.5, fill: hair });
  if(hairStyle === 6 && sk !== 'wall'){ S('circle', { cx: 19, cy: 15, r: 6, fill: hair }); S('circle', { cx: 45, cy: 15, r: 6, fill: hair }); }
  // 体と首
  S('path', { d: 'M8 66 Q10 49 32 48 Q54 49 56 66 Z', fill: th[2] });
  S('path', { d: 'M24 50 Q32 56 40 50', fill: 'none', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1.6 });
  S('rect', { x: 28, y: 42, width: 8, height: 8, rx: 3, fill: skin });
  // 顔
  S('ellipse', { cx: 32, cy: 31, rx, ry, fill: skin });
  // 前髪
  if(sk !== 'wall'){
    const fr = [
      'M15 30 Q16 12 32 12 Q48 12 49 30 Q44 21 32 21 Q20 21 15 30 Z',
      'M14 30 L16 17 L21 22 L24 10 L29 19 L33 8 L37 19 L42 11 L45 22 L50 17 L50 30 Q45 21 32 21 Q19 21 14 30 Z',
      'M16 28 Q18 13 32 13 Q46 13 48 28 Q40 19 32 23 Q24 19 16 28 Z',
      'M15 31 Q14 12 33 11 Q50 12 49 27 Q40 16 28 21 Q20 24 15 31 Z',
      'M18 23 Q21 14 32 14 Q43 14 46 23 Q40 18 32 18 Q24 18 18 23 Z',
      'M15 30 Q16 12 32 12 Q48 12 49 30 Q46 20 36 19 Q26 19 15 30 Z',
      'M16 29 Q17 13 32 13 Q47 13 48 29 Q42 22 32 22 Q22 22 16 29 Z'
    ][hairStyle];
    S('path', { d: fr, fill: hair });
  }
  // 仮面(反撃)は目の下に敷く
  if(sk === 'ctr') S('path', { d: 'M17 29 Q24 26 32 29 Q40 26 47 29 L46 36 Q39 39 32 35 Q25 39 18 36 Z', fill: '#2a2233' });
  // 目
  const eyeCol = sk === 'ctr' ? '#ffe9a8' : ink;
  [26, 38].forEach((x, i) => {
    const m = i === 0 ? 1 : -1;
    if(eyes === 0) S('circle', { cx: x, cy: 33, r: 2.2, fill: eyeCol });
    else if(eyes === 1) S('path', { d: 'M' + (x - 2.6) + ' 34 Q' + x + ' 30.6 ' + (x + 2.6) + ' 34', fill: 'none', stroke: eyeCol, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
    else if(eyes === 2){ S('ellipse', { cx: x, cy: 33, rx: 2.5, ry: 3.2, fill: eyeCol }); S('circle', { cx: x + .8, cy: 31.9, r: .95, fill: '#fff' }); }
    else if(eyes === 3){ S('path', { d: 'M' + (x - 3 * m) + ' 31.8 L' + (x + 3 * m) + ' 33.4 L' + (x - 3 * m) + ' 34.8 Z', fill: eyeCol }); S('path', { d: 'M' + (x - 3.4 * m) + ' 29 L' + (x + 2.6 * m) + ' 30.4', stroke: hair, 'stroke-width': 1.6, 'stroke-linecap': 'round' }); }
    else S('path', { d: 'M' + (x - 2.6) + ' 33.6 H' + (x + 2.6), stroke: eyeCol, 'stroke-width': 1.8, 'stroke-linecap': 'round' });
  });
  // ほっぺ
  if(blush){ S('ellipse', { cx: 21.5, cy: 38.5, rx: 2.8, ry: 1.6, fill: '#ff6b8a', opacity: .35 }); S('ellipse', { cx: 42.5, cy: 38.5, rx: 2.8, ry: 1.6, fill: '#ff6b8a', opacity: .35 }); }
  // 口
  const mo = [
    ['path', { d: 'M28.5 40.5 Q32 44 35.5 40.5', fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }],
    ['path', { d: 'M29.5 41.5 H34.5', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }],
    ['ellipse', { cx: 32, cy: 41.5, rx: 2.4, ry: 2, fill: '#7a2b35' }],
    ['path', { d: 'M29 41 Q33 43 36 39.5', fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }],
    ['path', { d: 'M28.5 40.5 Q30.2 42.8 32 40.5 Q33.8 42.8 35.5 40.5', fill: 'none', stroke: ink, 'stroke-width': 1.5, 'stroke-linecap': 'round' }]
  ][mouth];
  S(mo[0], mo[1]);

  // スキルの小物
  if(sk === 'pow'){        // ハチマキ
    S('path', { d: 'M15.5 23.5 Q32 19 48.5 23.5 L48.5 27.5 Q32 23 15.5 27.5 Z', fill: '#e8403a' });
    S('path', { d: 'M48 25 L56 21 L54 26 L57 30 L48 27 Z', fill: '#e8403a' });
    S('circle', { cx: 32, cy: 23.6, r: 2, fill: '#fff' });
  }else if(sk === 'swp'){  // ツノ
    S('path', { d: 'M19 19 Q12 10 14 3 Q19 10 24 15 Z', fill: '#f2e6c9', stroke: '#b9a77c', 'stroke-width': .8 });
    S('path', { d: 'M45 19 Q52 10 50 3 Q45 10 40 15 Z', fill: '#f2e6c9', stroke: '#b9a77c', 'stroke-width': .8 });
  }else if(sk === 'snp'){  // 片メガネ
    S('circle', { cx: 38, cy: 33, r: 4.6, fill: 'rgba(160,220,255,.25)', stroke: '#ffd34d', 'stroke-width': 1.5 });
    S('path', { d: 'M42.4 34.5 Q46 40 45 48', fill: 'none', stroke: '#ffd34d', 'stroke-width': .9 });
  }else if(sk === 'drain'){ // キバ
    S('path', { d: 'M29.6 41.4 L30.7 44.6 L31.6 41.6 Z M32.4 41.6 L33.3 44.6 L34.4 41.4 Z', fill: '#fff' });
    S('path', { d: 'M18 50 L26 58 L32 50 L38 58 L46 50', fill: 'none', stroke: '#8b1d2c', 'stroke-width': 2.4, 'stroke-linejoin': 'round' });
  }else if(sk === 'heal'){ // 天使の輪
    S('ellipse', { cx: 32, cy: 8.5, rx: 11, ry: 3.2, fill: 'none', stroke: '#ffe066', 'stroke-width': 2.2 });
  }else if(sk === 'wall'){ // カブト
    S('path', { d: 'M14 31 Q13 10 32 10 Q51 10 50 31 L46 31 Q45 18 32 18 Q19 18 18 31 Z', fill: '#9aa3ad' });
    S('path', { d: 'M18 31 Q19 18 32 18 Q45 18 46 31', fill: 'none', stroke: '#5d6670', 'stroke-width': 1.4 });
    S('path', { d: 'M30 10 L32 4 L34 10 Z', fill: '#d9443b' });
    S('rect', { x: 30.5, y: 18, width: 3, height: 9, rx: 1, fill: '#7d8791' });
  }else if(sk === 'taunt'){ // 王冠
    S('path', { d: 'M20 15 L22 4 L27 10 L32 2 L37 10 L42 4 L44 15 Z', fill: '#ffcc33', stroke: '#b8860b', 'stroke-width': .8, 'stroke-linejoin': 'round' });
    S('circle', { cx: 32, cy: 11, r: 1.6, fill: '#e8403a' });
  }
  return svg;
}
window.NomiAvatar = { make, themeOf };
})();
