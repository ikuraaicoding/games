/* ARENA のスキルと武器の特殊効果のアイコン(コードで描く SVG。外部の画像は使わない)
 *  スキル: 角丸の四角 / 武器の効果: 丸。色は系統(攻撃=赤・防御=青灰・HP=緑)
 *  NomiIcons.skill(key, size) / NomiIcons.fx(key, size)
 */
(function(){
'use strict';
const NS = 'http://www.w3.org/2000/svg';
const COL = { a: '#e5483e', d: '#6f7f93', h: '#2fb457' };
// 線: s(d) / 塗り: f(d) / 丸: c(cx, cy, r, fill)
const s = d => ['path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }];
const f = d => ['path', { d, fill: '#fff' }];
const c = (cx, cy, r, fill) => ['circle', { cx, cy, r, fill: fill ? '#fff' : 'none', stroke: fill ? 'none' : '#fff', 'stroke-width': 2 }];
const SK = {
  // 攻撃
  pow:   { c: 'a', g: [f('M12 3l2.3 5.4 5.7.6-4.3 3.9 1.3 5.7L12 15.6 7 18.6l1.3-5.7L4 9l5.7-.6z')] },                       // 渾身: 星
  swp:   { c: 'a', g: [s('M4 15a9 9 0 0 1 16 0'), s('M16.5 11.5L20 15l-4.6 1.2')] },                                     // 薙ぎ払い: 弧
  snp:   { c: 'a', g: [c(12, 12, 6), s('M12 3v4M12 17v4M3 12h4M17 12h4'), c(12, 12, 1.6, true)] },                        // 狙撃: 照準
  rush:  { c: 'a', g: [s('M5 18l5-12M10 18l5-12M15 18l5-12')] },                                                        // 連撃: 3本のすじ
  // 防御
  wall:  { c: 'd', g: [s('M4 6h16v12H4z'), s('M4 12h16M10 6v6M14 12v6')] },                                              // 鉄壁: レンガ
  taunt: { c: 'd', g: [f('M10.5 4h3l-.6 10h-1.8z'), c(12, 18, 1.7, true)] },                                             // 挑発: !
  ctr:   { c: 'd', g: [s('M9 6L5 10l4 4'), s('M5 10h9a5 5 0 0 1 0 10h-3')] },                                            // 反撃: 返し矢印
  fort:  { c: 'd', g: [f('M3 19l6.5-11 4 6.2 2.2-3.2L21 19z')] },                                                        // 不動: 山
  // HP
  heal:  { c: 'h', g: [f('M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z')] },                                                         // 治癒: 十字
  drain: { c: 'h', g: [f('M12 3c3.2 4.6 6 7.8 6 11a6 6 0 0 1-12 0c0-3.2 2.8-6.4 6-11z')] },                             // 吸収: しずく
  rain:  { c: 'h', g: [s('M7 13a4 4 0 0 1 .5-8 5 5 0 0 1 9.3 1.2A3.4 3.4 0 0 1 17 13z'), s('M8 16l-1 3M12 16l-1 3M16 16l-1 3')] }, // 癒しの雨: 雲と雨
  rev:   { c: 'h', g: [['ellipse', { cx: 12, cy: 5, rx: 5, ry: 1.8, fill: 'none', stroke: '#fff', 'stroke-width': 1.8 }], s('M12 20v-10M8 13.5L12 9.5l4 4')] } // 蘇生: 天使の輪と上向き矢印
};
const FX = {
  // 剣
  dbl:     { t: 'a', g: [s('M4.5 4.5l10.5 10.5M19.5 4.5L9 15'), s('M12.5 17.5l5-5M6.5 12.5l5 5'), s('M16.5 16.5l3 3M7.5 16.5l-3 3')] }, // 双撃: 交差した2本の剣
  crit:    { t: 'a', g: [f('M13.5 2L5 13.5h5.5L9 22l9.5-12.5H13z')] },                                                  // 会心: イナズマ
  pre:     { t: 'a', g: [f('M4 6l7.5 6L4 18z'), f('M12 6l7.5 6L12 18z')] },                                             // 先制: 早送り
  pierce:  { t: 'a', g: [s('M3 12h16M15 8l4 4-4 4'), s('M10 5v14')] },                                                  // 貫通: 壁をつらぬく矢
  last:    { t: 'a', g: [f('M12 2.5c1 3.5 5.5 5.6 5.5 11a5.5 5.5 0 0 1-11 0c0-2.6 1.4-4.4 2.6-5.6.2 2 1 3 2 3.4-.4-3.3.1-6.2.9-8.8z')] }, // 背水: 炎
  exe:     { t: 'a', g: [f('M12 3a7 7 0 0 0-7 7c0 2.4 1.1 4.3 3 5.4V19h8v-3.6c1.9-1.1 3-3 3-5.4a7 7 0 0 0-7-7z'), c(9.3, 10.5, 1.7, false), c(14.7, 10.5, 1.7, false), s('M10.5 19v2M13.5 19v2')] }, // 処刑: どくろ
  rage:    { t: 'a', g: [s('M9.5 4v3A2.5 2.5 0 0 1 7 9.5H4M14.5 4v3A2.5 2.5 0 0 0 17 9.5h3M9.5 20v-3A2.5 2.5 0 0 0 7 14.5H4M14.5 20v-3a2.5 2.5 0 0 1 2.5-2.5h3')] }, // 闘志: 怒りマーク
  // 盾
  first:   { t: 'd', g: [s('M12 3l7 3v5c0 4.6-3 8-7 10-4-2-7-5.4-7-10V6z'), s('M8.5 12l2.5 2.5 4.5-5')] },             // 守護: 盾とチェック
  thorn:   { t: 'd', g: [s('M3 16l3-6 3 6 3-6 3 6 3-6 3 6'), s('M3 19h18')] },                                          // 茨: とげ
  evade:   { t: 'd', g: [s('M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7')] },                                   // 疾風: 風
  cap:     { t: 'd', g: [s('M6 11h12v9H6z'), s('M8.5 11V8a3.5 3.5 0 0 1 7 0v3'), c(12, 15.5, 1.4, true)] },             // 堅牢: 錠前
  aegis:   { t: 'd', g: [s('M3 13a9 9 0 0 1 18 0'), c(7.5, 17.5, 1.8, true), c(12, 17.5, 1.8, true), c(16.5, 17.5, 1.8, true)] }, // 加護: みんなを守るドーム
  // 護符
  vamp:    { t: 'h', g: [s('M4 7c3 2 13 2 16 0'), f('M7.5 8.5l2 7 2-7zM12.5 8.5l2 7 2-7z')] },                         // 吸血: キバ
  regen:   { t: 'h', g: [s('M19 12a7 7 0 1 1-2-4.9'), s('M19 4v4h-4'), s('M12 9v6M9 12h6')] },                          // 再生: まわる矢印と十字
  undying: { t: 'h', g: [s('M7 8.5a3.5 3.5 0 1 0 0 7c2.3 0 3.5-1.8 5-3.5s2.7-3.5 5-3.5a3.5 3.5 0 1 1 0 7c-2.3 0-3.5-1.8-5-3.5S9.3 8.5 7 8.5z')] }, // 不死: ∞
  bless:   { t: 'h', g: [f('M12 2.5c.8 4.9 2.6 6.7 7.5 7.5-4.9.8-6.7 2.6-7.5 7.5-.8-4.9-2.6-6.7-7.5-7.5 4.9-.8 6.7-2.6 7.5-7.5z'), f('M19 15c.3 1.8 1 2.5 2.8 2.8-1.8.3-2.5 1-2.8 2.8-.3-1.8-1-2.5-2.8-2.8 1.8-.3 2.5-1 2.8-2.8z')] } // 祝福: きらめき
};
function draw(def, cat, round, size){
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'gi'); svg.setAttribute('aria-hidden', 'true');
  if(size){ svg.setAttribute('width', size); svg.setAttribute('height', size); }
  const bg = document.createElementNS(NS, round ? 'circle' : 'rect');
  if(round){ bg.setAttribute('cx', 12); bg.setAttribute('cy', 12); bg.setAttribute('r', 12); }
  else{ bg.setAttribute('width', 24); bg.setAttribute('height', 24); bg.setAttribute('rx', 6); }
  bg.setAttribute('fill', COL[cat] || '#666'); svg.appendChild(bg);
  // 絵は少し小さくして、ふちに余白をつくる
  const g = document.createElementNS(NS, 'g'); g.setAttribute('transform', 'translate(12 12) scale(.72) translate(-12 -12)');
  (def ? def.g : []).forEach(([tag, at]) => { const e = document.createElementNS(NS, tag); for(const k in at){ e.setAttribute(k, at[k]); } g.appendChild(e); });
  // 塗りの記号の中の「穴」(どくろの目)は背景色で塗る
  g.querySelectorAll('circle[fill="none"]').forEach(e => { if(def === FX.exe){ e.setAttribute('fill', COL.a); e.setAttribute('stroke', 'none'); } });
  svg.appendChild(g);
  return svg;
}
window.NomiIcons = {
  skill: (k, size) => { const d = SK[k]; return draw(d, d ? d.c : '', false, size); },
  fx: (k, size) => { const d = FX[k]; return draw(d, d ? d.t : '', true, size); },
  _keys: { sk: Object.keys(SK), fx: Object.keys(FX) }
};
})();
