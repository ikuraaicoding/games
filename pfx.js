/* 演出レイヤー(PixiJS で、画面の上に透明な描画レイヤーを重ねる。全ゲーム共通)
 *
 *  - ゲームのルールや表示はこれまでどおり HTML。ここは「見た目の上乗せ」だけ
 *  - PixiJS はゲームを始めたときに読み込む(lib/ に同梱。外部から読み込まない)
 *  - 読み込めない・WebGL が使えないスマホでは何もしない(これまでの演出のまま遊べる)
 *  - タイミングが勝負のゲーム(DRAW の合図待ち、BLIND の長押し中)は、各ゲーム側で止める
 *
 *  共通: load() / ok() / show(on, { amb: [色...] | null })
 *        slam(文字, o) / pop(el, o) / rowIn(el, kind) / doom(el) / confetti(n) / streak(src, dst, color)
 *        hitEl(el, color, power) / shatter(el, color) / aura(el, on, color) / fireball(el)
 *  ARENA: intro / fight / attack / num / heal / miss / skill / ko / undying / win / fatigue
 */
(function(){
'use strict';
const FONT = "-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Segoe UI',sans-serif";
const MAX_PARTS = 700;
let P = null, app = null, state = 'idle', loading = null, visible = false;
let L = {}, tex = {}, pool = [], parts = [], tweens = [], cutQ = [], cutBusy = false;
let shakeAmp = 0, shakeX = 0, shakeY = 0, ambT = 0, ambCols = null, auras = [];
const reduce = (() => { try{ return matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){ return false; } })();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ease = {
  out: p => 1 - Math.pow(1 - p, 3),
  in: p => p * p * p,
  back: p => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
};

function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function load(){
  if(loading) return loading;
  state = 'loading';
  loading = (async () => {
    try{
      if(!window.PIXI || !window.PIXI.Application) await loadScript('lib/pixi.min.js');
      await loadScript('lib/pixi-unsafe-eval.min.js');
      P = window.PIXI;
      app = new P.Application();
      await app.init({ backgroundAlpha: 0, antialias: false, resolution: Math.min(2, window.devicePixelRatio || 1), autoDensity: true, preference: 'webgl', resizeTo: window, powerPreference: 'low-power', hello: false });
      const cv = app.canvas; cv.id = 'pfx'; cv.setAttribute('aria-hidden', 'true');
      (document.getElementById('app') || document.body).appendChild(cv);
      app.stage.eventMode = 'none';
      ['amb', 'back', 'fx', 'top', 'ui', 'flash'].forEach(k => { L[k] = new P.Container(); app.stage.addChild(L[k]); });
      makeTextures();
      L.flashG = new P.Graphics(); L.flash.addChild(L.flashG); L.flash.alpha = 0;
      app.ticker.add(t => update(Math.min(50, t.deltaMS)));
      app.ticker.stop();
      state = 'ready';
      if(visible) show(true);
    }catch(e){ state = 'fail'; try{ if(app) app.destroy(true); }catch(_){ } app = null; }
  })();
  return loading;
}
const ok = () => state === 'ready';

// ---------------- テクスチャ(ぜんぶコードで描く) ----------------
function gtex(draw){ const g = new P.Graphics(); draw(g); const t = app.renderer.generateTexture({ target: g, resolution: 2 }); g.destroy(); return t; }
function makeTextures(){
  tex.glow = gtex(g => { for(let r = 32; r > 0; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: .07 }); });
  tex.dot = gtex(g => { g.circle(0, 0, 4).fill(0xffffff); });
  tex.spark = gtex(g => { g.ellipse(0, 0, 18, 2.4).fill(0xffffff); });
  tex.star = gtex(g => { const p = []; for(let i = 0; i < 8; i++){ const r = i % 2 ? 4 : 14, a = i * Math.PI / 4; p.push(Math.cos(a) * r, Math.sin(a) * r); } g.poly(p).fill(0xffffff); });
  tex.ring = gtex(g => { g.circle(0, 0, 60).stroke({ width: 7, color: 0xffffff }); });
  tex.shard = gtex(g => { g.poly([0, -9, 6, 7, -5, 5]).fill(0xffffff); });
  tex.rect = gtex(g => { g.rect(-5, -3, 10, 6).fill(0xffffff); });
  tex.slash = gtex(g => { g.ellipse(0, 0, 80, 5).fill({ color: 0xffffff, alpha: .35 }); g.ellipse(0, 0, 74, 2.2).fill(0xffffff); });
  tex.ray = gtex(g => { g.poly([0, 0, 420, -34, 420, 34]).fill(0xffffff); });
  tex.plus = gtex(g => { g.rect(-2.5, -9, 5, 18).fill(0xffffff); g.rect(-9, -2.5, 18, 5).fill(0xffffff); });
}

// ---------------- パーティクル ----------------
function spr(t, layer, add){
  let s = pool.pop();
  if(!s){ s = new P.Sprite(t); s.anchor.set(.5); }
  else s.texture = t;
  s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1); s.tint = 0xffffff;
  s.blendMode = add === false ? 'normal' : 'add';
  (layer || L.fx).addChild(s);
  return s;
}
function free(s){ s.visible = false; if(s.parent) s.parent.removeChild(s); pool.push(s); }
// o: { t, x, y, vx, vy, life, s0, s1, a0, a1, tint, drag, g, rot, vr, align, layer, add, sy }
function part(o){
  if(parts.length >= MAX_PARTS) return null;
  const s = spr(o.t || tex.glow, o.layer, o.add);
  s.position.set(o.x, o.y); s.tint = o.tint === undefined ? 0xffffff : o.tint;
  const p = { s, vx: o.vx || 0, vy: o.vy || 0, t: 0, life: o.life || 500, s0: o.s0 === undefined ? 1 : o.s0, s1: o.s1 === undefined ? 0 : o.s1, a0: o.a0 === undefined ? 1 : o.a0, a1: o.a1 || 0,
    drag: o.drag || 0, g: o.g || 0, rot: o.rot || 0, vr: o.vr || 0, align: !!o.align, sy: o.sy || 1, flip: !!o.flip, delay: o.delay || 0 };
  if(p.delay) s.visible = false;
  parts.push(p); return p;
}
function burst(x, y, n, o){
  for(let i = 0; i < n; i++){
    const a = o.dir !== undefined ? o.dir + rnd(-o.spread, o.spread) : rnd(0, Math.PI * 2), v = rnd(o.v0, o.v1);
    part(Object.assign({}, o, { x: x + rnd(-(o.r || 0), o.r || 0), y: y + rnd(-(o.r || 0), o.r || 0), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(o.l0, o.l1), rot: o.align ? 0 : rnd(0, 6.3), vr: o.vr ? rnd(-o.vr, o.vr) : 0, tint: Array.isArray(o.tint) ? o.tint[i % o.tint.length] : o.tint }));
  }
}
function tween(dur, fn, done, delay){ tweens.push({ t: -(delay || 0), dur, fn, done }); }

function update(dt){
  const sec = dt / 1000;
  for(let i = parts.length - 1; i >= 0; i--){
    const p = parts[i], s = p.s;
    if(p.delay > 0){ p.delay -= dt; if(p.delay > 0) continue; s.visible = true; }
    p.t += dt;
    const k = p.t / p.life;
    if(k >= 1){ free(s); parts.splice(i, 1); continue; }
    if(p.drag){ const d = Math.pow(1 - p.drag, sec * 60); p.vx *= d; p.vy *= d; }
    p.vy += p.g * sec;
    s.x += p.vx * sec; s.y += p.vy * sec;
    if(p.align) s.rotation = Math.atan2(p.vy, p.vx);
    else s.rotation = p.rot += p.vr * sec;
    const sc = p.s0 + (p.s1 - p.s0) * k;
    if(p.align){ const sp = Math.hypot(p.vx, p.vy); s.scale.set(sc * clamp(sp / 400, .25, 1.6), sc); }
    else if(p.flip) s.scale.set(sc, sc * Math.cos(p.t / 90 + p.rot));
    else s.scale.set(sc, sc * p.sy);
    s.alpha = p.a0 + (p.a1 - p.a0) * k;
  }
  for(let i = tweens.length - 1; i >= 0; i--){
    const w = tweens[i]; w.t += dt;
    if(w.t < 0) continue;
    const p = clamp(w.t / w.dur, 0, 1);
    w.fn(p);
    if(p >= 1){ tweens.splice(i, 1); if(w.done) w.done(); }
  }
  // 画面のゆれ(#app ごと揺らすので、カードとエフェクトが一緒に動く)
  const appEl = document.getElementById('app');
  if(shakeAmp > .3){
    shakeX = rnd(-shakeAmp, shakeAmp); shakeY = rnd(-shakeAmp, shakeAmp) * .7;
    shakeAmp *= Math.pow(.86, dt / 16.7);
    if(appEl){ appEl.style.setProperty('--sx', shakeX.toFixed(1) + 'px'); appEl.style.setProperty('--sy', shakeY.toFixed(1) + 'px'); }
  }else if(shakeX || shakeY){
    shakeAmp = 0; shakeX = 0; shakeY = 0;
    if(appEl){ appEl.style.setProperty('--sx', '0px'); appEl.style.setProperty('--sy', '0px'); }
  }
  // 火の粉(ずっと漂う。ゲームごとの色)
  ambT -= dt;
  if(ambCols && ambT <= 0){
    ambT = 140;
    const W = app.screen.width, H = app.screen.height;
    part({ layer: L.amb, t: tex.glow, x: rnd(0, W), y: H + 10, vx: rnd(-14, 14), vy: rnd(-60, -25), life: rnd(5000, 9000), s0: rnd(.08, .2), s1: .02, a0: .55, a1: 0, tint: ambCols[Math.floor(rnd(0, ambCols.length))] });
  }
  // オーラ(要素のまわりから光が吸い込まれる。時間がたつほど強く)
  auras.forEach(a => {
    a.t += dt; a.acc += dt * (1 + Math.min(a.t / 1000, 8) * .6);
    const d = center(a.el); if(!d) return;
    while(a.acc > 60){
      a.acc -= 60;
      const ang = rnd(0, 6.3), r = Math.max(d.w, d.h) * rnd(.55, .9), k = Math.min(1, a.t / 6000);
      part({ t: tex.spark, x: d.x + Math.cos(ang) * r, y: d.y + Math.sin(ang) * r, vx: -Math.cos(ang) * r * 2.2, vy: -Math.sin(ang) * r * 2.2, align: true, life: 400, s0: .5 + k * .5, s1: .9 + k * .6, a0: .1, a1: .95, tint: Math.random() < .3 ? 0xffffff : a.col });
    }
  });
}
function shake(a){ if(!reduce) shakeAmp = Math.max(shakeAmp, a); }
function flash(color, a, ms){
  const W = app.screen.width, H = app.screen.height;
  L.flashG.clear().rect(0, 0, W, H).fill(color);
  tween(ms, p => { L.flash.alpha = a * (1 - p); });
}
function center(el){
  if(!el) return null;
  const r = el.getBoundingClientRect();
  if(!r.width && !r.height) return null;
  return { x: r.left + r.width / 2 - shakeX, y: r.top + r.height / 2 - shakeY, w: r.width, h: r.height };
}
function text(str, o){
  const t = new P.Text({ text: str, style: {
    fontFamily: FONT, fontSize: o.size || 28, fontWeight: '900', fill: o.fill === undefined ? 0xffffff : o.fill, letterSpacing: o.ls || 0,
    stroke: { color: o.stroke === undefined ? 0x000000 : o.stroke, width: o.sw === undefined ? 5 : o.sw, join: 'round' },
    dropShadow: o.shadow === false ? false : { color: o.glow === undefined ? 0x000000 : o.glow, blur: o.blur || 8, distance: 0, alpha: .9 }
  } });
  t.anchor.set(.5); t.resolution = Math.min(2, window.devicePixelRatio || 1);
  (o.layer || L.ui).addChild(t);
  return t;
}
function kill(t){ if(t && !t.destroyed){ if(t.parent) t.parent.removeChild(t); t.destroy(); } }

// ---------------- 表示の切り替え ----------------
function clearAll(){
  parts.forEach(p => free(p.s)); parts = []; tweens = []; cutQ = []; cutBusy = false; auras = [];
  [L.amb, L.back, L.fx, L.top, L.ui].forEach(c => { if(c) c.removeChildren().forEach(ch => {
    if(ch instanceof P.Sprite){ ch.visible = false; if(pool.indexOf(ch) < 0) pool.push(ch); }
    else ch.destroy({ children: true });
  }); });
  if(L.flash) L.flash.alpha = 0;
  shakeAmp = 0; shakeX = shakeY = 0;
  const appEl = document.getElementById('app');
  if(appEl){ appEl.style.setProperty('--sx', '0px'); appEl.style.setProperty('--sy', '0px'); }
}
function show(on, o){
  visible = !!on;
  if(o && 'amb' in o) ambCols = o.amb;
  if(!ok()) return;
  app.canvas.style.display = on ? 'block' : 'none';
  if(on){ app.resize(); app.ticker.start(); }
  else{ app.ticker.stop(); clearAll(); }
}

// ---------------- 演出 ----------------
function intro(nmL, nmR){
  if(!ok() || !visible) return;
  const W = app.screen.width, H = app.screen.height, cy = H * .42;
  const band = new P.Graphics().rect(-W, -92, W * 3, 184).fill({ color: 0x000000, alpha: .72 }).rect(-W, -92, W * 3, 3).fill(0xff453a).rect(-W, 89, W * 3, 3).fill(0xff453a);
  band.position.set(W / 2, cy); band.rotation = -.06; band.scale.y = 0; L.top.addChild(band);
  tween(220, p => { band.scale.y = ease.out(p); });
  const a = text(nmL, { size: 30, fill: 0x64d2ff, glow: 0x64d2ff, blur: 14, layer: L.top });
  const b = text(nmR, { size: 30, fill: 0xff9f0a, glow: 0xff9f0a, blur: 14, layer: L.top });
  a.position.set(-W, cy - 58); b.position.set(W * 2, cy + 58);
  [a, b].forEach(t => { if(t.width > W * .9) t.scale.set(W * .9 / t.width); });
  tween(380, p => { a.x = -W + (W * .5 + W) * ease.back(p); }, null, 120);
  tween(380, p => { b.x = W * 2 - (W * 2 - W * .5) * ease.back(p); }, null, 120);
  const vs = text('VS', { size: 64, fill: 0xffffff, stroke: 0xff453a, sw: 8, glow: 0xff453a, blur: 20, layer: L.top });
  vs.position.set(W / 2, cy); vs.alpha = 0;
  tween(260, p => { vs.alpha = 1; vs.scale.set(3.2 - 2.2 * ease.out(p)); }, () => {
    flash(0xffffff, .55, 260); shake(10);
    part({ layer: L.top, t: tex.ring, x: W / 2, y: cy, s0: .2, s1: 2.6, a0: 1, a1: 0, life: 420, tint: 0xff453a });
    burst(W / 2, cy, 36, { layer: L.top, t: tex.spark, v0: 300, v1: 900, l0: 250, l1: 600, s0: 1, s1: .2, drag: .08, align: true, tint: [0xffffff, 0xff453a, 0xffd60a] });
  }, 520);
  tween(400, p => { const al = 1 - p; [a, b, vs, band].forEach(o => { o.alpha = al; }); }, () => { [a, b, vs].forEach(kill); band.destroy(); }, 2050);
}
function fight(){
  if(!ok() || !visible) return;
  const W = app.screen.width, H = app.screen.height, cy = H * .42;
  const t = text('FIGHT!', { size: 72, fill: 0xffd60a, stroke: 0x7a2a00, sw: 10, glow: 0xff6b00, blur: 26, ls: 4, layer: L.top });
  t.position.set(W / 2, cy);
  flash(0xffffff, .6, 300); shake(14);
  tween(320, p => { t.scale.set(2.6 - 1.6 * ease.back(p)); });
  tween(300, p => { t.alpha = 1 - p; t.scale.set(1 + p * .4); }, () => kill(t), 650);
  [0, 120].forEach(d => part({ layer: L.top, t: tex.ring, x: W / 2, y: cy, s0: .3, s1: 3.4, a0: 1, a1: 0, life: 520, tint: 0xffd60a, delay: d }));
  burst(W / 2, cy, 60, { layer: L.top, t: tex.spark, v0: 400, v1: 1200, l0: 300, l1: 700, s0: 1.2, s1: .2, drag: .06, align: true, tint: [0xffffff, 0xffd60a, 0xff9f0a] });
}
// 攻撃: src から dst へ光が飛んで着弾。着弾までの ms を返す
function attack(srcEl, dstEl, o){
  if(!ok() || !visible) return 0;
  o = o || {};
  const d = center(dstEl); if(!d) return 0;
  const s = center(srcEl), col = o.color || 0xffffff;
  const go = () => impact(d, o);
  if(!s){ go(); return 0; }
  const T = o.crit ? 210 : 160;
  const head = part({ t: tex.glow, x: s.x, y: s.y, s0: o.crit ? 1.3 : .9, s1: o.crit ? 1.3 : .9, life: T, tint: col });
  const head2 = part({ t: tex.dot, x: s.x, y: s.y, s0: 1.6, s1: 1.6, life: T, tint: 0xffffff });
  tween(T, p => {
    const k = ease.in(p), x = s.x + (d.x - s.x) * k, y = s.y + (d.y - s.y) * k;
    if(head) head.s.position.set(x, y);
    if(head2) head2.s.position.set(x, y);
    part({ t: tex.glow, x: x + rnd(-4, 4), y: y + rnd(-4, 4), s0: .55, s1: .05, a0: .8, life: 220, tint: col });
  }, go);
  return T;
}
function impact(d, o){
  const ratio = clamp(o.ratio || 0, 0, 1), crit = !!o.crit, col = o.color || 0xffffff;
  const n = Math.round(10 + ratio * 34 + (crit ? 26 : 0));
  burst(d.x, d.y, n, { t: tex.spark, v0: 220, v1: 620 + ratio * 500 + (crit ? 400 : 0), l0: 220, l1: 520, s0: 1, s1: .1, drag: .07, align: true, tint: [0xffffff, col, crit ? 0xffd60a : col] });
  part({ t: tex.glow, x: d.x, y: d.y, s0: 1.2 + ratio * 1.5 + (crit ? 1.2 : 0), s1: .2, a0: 1, life: 200, tint: crit ? 0xffd60a : 0xffffff });
  part({ t: tex.ring, x: d.x, y: d.y, s0: .15, s1: .7 + ratio * 1.1 + (crit ? .8 : 0), a0: .9, life: 330, tint: crit ? 0xffd60a : col });
  // 斬撃のすじ
  const ang = rnd(-1.1, -.4) + (Math.random() < .5 ? 0 : Math.PI / 2);
  const sl = spr(tex.slash, L.fx); sl.position.set(d.x, d.y); sl.rotation = ang; sl.tint = crit ? 0xffd60a : 0xffffff;
  const big = (crit ? 1.5 : 1) * (.7 + ratio * .8) * Math.min(1.4, d.w / 120);
  tween(240, p => { sl.scale.set(big * ease.out(Math.min(1, p * 2.5)), 1 - p * .6); sl.alpha = 1 - ease.in(p); }, () => free(sl));
  if(crit){
    flash(0xffffff, .45, 180);
    burst(d.x, d.y, 8, { t: tex.star, v0: 160, v1: 420, l0: 400, l1: 700, s0: 1.4, s1: .2, drag: .05, vr: 9, tint: 0xffd60a });
    const c = text('CRITICAL!', { size: 22, fill: 0xffd60a, stroke: 0x5a2500, sw: 6, glow: 0xff9f0a, blur: 14 });
    c.position.set(d.x, d.y - d.h * .42);
    tween(220, p => { c.scale.set(2 - ease.back(p)); });
    tween(300, p => { c.alpha = 1 - p; c.y -= .5; }, () => kill(c), 520);
  }
  shake((crit ? 12 : 3) + ratio * 12);
}
function num(el, str, kind){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  const K = {
    dmg: { size: 26, fill: 0xffffff, stroke: 0x000000, glow: 0x000000 },
    crit: { size: 38, fill: 0xffd60a, stroke: 0x4a1800, glow: 0xff6b00 },
    heal: { size: 26, fill: 0x30d158, stroke: 0x003311, glow: 0x30d158 },
    miss: { size: 18, fill: 0xb0b0b8, stroke: 0x000000, glow: 0x000000 }
  }[kind] || { size: 22, fill: 0xffffff };
  const t = text(str, Object.assign({ sw: 6, blur: 10 }, K));
  const x0 = d.x + rnd(-d.w * .18, d.w * .18), y0 = d.y - d.h * .1;
  t.position.set(x0, y0);
  tween(260, p => { t.scale.set(.3 + ease.back(p) * .9); });
  tween(900, p => { t.y = y0 - 46 * ease.out(p); t.alpha = p < .65 ? 1 : 1 - (p - .65) / .35; }, () => kill(t));
}
function heal(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  for(let i = 0; i < 16; i++) part({ t: i % 3 ? tex.glow : tex.plus, x: d.x + rnd(-d.w * .4, d.w * .4), y: d.y + rnd(0, d.h * .45), vx: rnd(-10, 10), vy: rnd(-120, -60), life: rnd(600, 1000), s0: i % 3 ? rnd(.25, .45) : rnd(.6, 1), s1: .05, a0: 1, tint: i % 2 ? 0x30d158 : 0xa8ffcb, delay: rnd(0, 250) });
  part({ t: tex.glow, x: d.x, y: d.y, s0: 1.5, s1: 3, a0: .45, life: 500, tint: 0x30d158 });
}
function miss(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  for(let i = 0; i < 4; i++) part({ t: tex.spark, x: d.x - d.w * .6, y: d.y + rnd(-d.h * .3, d.h * .3), vx: rnd(900, 1300), vy: 0, align: true, life: 260, s0: 1.4, s1: .6, a0: .7, tint: 0xcfe6ff, delay: i * 40 });
}
const SKC = { pow: 0xff453a, swp: 0xff9f0a, snp: 0x64d2ff, rush: 0xffd60a, drain: 0xbf5af2, heal: 0x30d158, rain: 0x64d2ff, rev: 0xfff4c2, wall: 0x8e9aa6, taunt: 0xffd60a, ctr: 0xff375f, fort: 0xa1a1aa };
function skill(el, title, sub, sk){
  if(!ok() || !visible) return;
  const col = SKC[sk] || 0xff9f0a;
  const d = center(el);
  if(d){
    part({ t: tex.ring, x: d.x, y: d.y, s0: .2, s1: 1.8, a0: 1, life: 450, tint: col });
    for(let i = 0; i < 26; i++){ const a = rnd(0, 6.3), r = rnd(d.w * .3, d.w * .6); part({ t: tex.glow, x: d.x + Math.cos(a) * r, y: d.y + Math.sin(a) * r * .8, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60 - 40, life: rnd(400, 800), s0: rnd(.25, .5), s1: .02, tint: col, delay: rnd(0, 200) }); }
  }
  if(cutQ.length >= 2) return;            // 同時にたくさん使われたら帯は省略
  cutQ.push({ title, sub, col });
  if(!cutBusy) nextCut();
}
function nextCut(){
  const c = cutQ.shift(); if(!c){ cutBusy = false; return; }
  cutBusy = true;
  const W = app.screen.width, H = app.screen.height, cy = H * .3;
  const g = new P.Container(); g.position.set(0, cy); g.rotation = -.05; L.top.addChild(g);
  const band = new P.Graphics().rect(-40, -44, W + 80, 88).fill({ color: c.col, alpha: .88 }).rect(-40, -44, W + 80, 5).fill(0xffffff).rect(-40, 39, W + 80, 5).fill(0xffffff);
  g.addChild(band);
  const lines = [];
  for(let i = 0; i < 7; i++){ const l = spr(tex.spark, g); l.position.set(rnd(0, W), rnd(-36, 36)); l.scale.set(rnd(1.5, 3), .6); l.alpha = .5; lines.push(l); }
  const t1 = text(c.title, { size: 34, fill: 0xffffff, stroke: 0x000000, sw: 6, glow: 0x000000, blur: 10, layer: g }); t1.position.set(W / 2, -6);
  const t2 = text(c.sub, { size: 13, fill: 0xffffff, stroke: 0x000000, sw: 4, shadow: false, layer: g }); t2.position.set(W / 2, 26);
  g.x = -W;
  tween(160, p => { g.x = -W + W * ease.out(p); });
  tween(640, p => { lines.forEach(l => { l.x += 22; if(l.x > W + 60) l.x = -60; }); t1.x = W / 2 + 10 - 20 * p; });
  tween(170, p => { g.x = W * ease.in(p); g.alpha = 1 - p * .5; }, () => { lines.forEach(free); g.destroy({ children: true }); nextCut(); }, 560);
}
function ko(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  flash(0xff3b30, .3, 280); shake(16);
  burst(d.x, d.y, 46, { t: tex.glow, v0: 120, v1: 520, l0: 400, l1: 900, s0: .7, s1: .05, drag: .06, tint: [0xff9f0a, 0xff453a, 0xffd60a] });
  burst(d.x, d.y, 18, { t: tex.shard, v0: 200, v1: 520, l0: 600, l1: 1100, s0: 1.2, s1: .6, g: 900, vr: 12, tint: 0xd0d0d8, add: false });
  burst(d.x, d.y, 10, { t: tex.glow, v0: 30, v1: 90, l0: 700, l1: 1200, s0: 1.2, s1: 2.6, a0: .5, tint: 0x222228, add: false });
  part({ t: tex.ring, x: d.x, y: d.y, s0: .2, s1: 2.4, life: 480, tint: 0xff453a });
  const t = text('K.O.', { size: 40, fill: 0xff453a, stroke: 0xffffff, sw: 5, glow: 0xff0000, blur: 16 });
  t.position.set(d.x, d.y);
  tween(260, p => { t.scale.set(2.4 - 1.4 * ease.back(p)); t.rotation = -.12 * p; });
  tween(380, p => { t.alpha = 1 - p; }, () => kill(t), 760);
}
function undying(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  const pil = spr(tex.glow, L.fx); pil.position.set(d.x, d.y); pil.tint = 0xffd60a;
  tween(800, p => { pil.scale.set(1.4 * (1 - p * .5), 5 * ease.out(Math.min(1, p * 3))); pil.alpha = 1 - p; }, () => free(pil));
  for(let i = 0; i < 24; i++) part({ t: tex.glow, x: d.x + rnd(-d.w * .35, d.w * .35), y: d.y + d.h * .4, vy: rnd(-260, -120), life: rnd(500, 900), s0: rnd(.3, .5), s1: .05, tint: 0xffd60a, delay: rnd(0, 300) });
  const t = text('不死!', { size: 26, fill: 0xffd60a, stroke: 0x4a2a00, sw: 6, glow: 0xffaa00, blur: 14 });
  t.position.set(d.x, d.y - d.h * .3);
  tween(240, p => { t.scale.set(1.8 - .8 * ease.back(p)); });
  tween(300, p => { t.alpha = 1 - p; }, () => kill(t), 800);
}
function win(el, str, color){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  const W = app.screen.width, col = color || 0xffd60a;
  // 後光
  const rays = new P.Container(); rays.position.set(d.x, d.y); L.back.addChild(rays);
  for(let i = 0; i < 12; i++){ const r = spr(tex.ray, rays); r.anchor.set(0, .5); r.rotation = i * Math.PI / 6; r.tint = col; r.alpha = .12; }
  tween(2600, p => { rays.rotation = p * 1.2; rays.alpha = p < .15 ? p / .15 : p > .8 ? (1 - p) / .2 : 1; }, () => { rays.children.slice().forEach(free); rays.destroy(); });
  // 紙吹雪
  const cols = [0xff453a, 0xffd60a, 0x30d158, 0x64d2ff, 0xbf5af2, 0xff9f0a, 0xffffff];
  for(let i = 0; i < 110; i++) part({ t: tex.rect, x: rnd(0, W), y: rnd(-80, -10), vx: rnd(-50, 50), vy: rnd(80, 260), g: 90, drag: .01, life: rnd(1800, 2800), s0: rnd(.8, 1.3), s1: .9, a0: 1, a1: .6, vr: rnd(-6, 6), rot: rnd(0, 6), flip: true, tint: cols[i % cols.length], add: false, layer: L.top, delay: rnd(0, 500) });
  burst(d.x, d.y, 40, { t: tex.star, v0: 200, v1: 600, l0: 500, l1: 1000, s0: 1.2, s1: .1, drag: .05, vr: 8, tint: [col, 0xffffff] });
  flash(col, .35, 400); shake(8);
  const t = text(str, { size: 46, fill: col, stroke: 0x000000, sw: 8, glow: col, blur: 22, layer: L.top });
  t.position.set(d.x, d.y);
  tween(380, p => { t.scale.set(2.4 - 1.4 * ease.back(p)); });
  tween(500, p => { t.alpha = 1 - p; }, () => kill(t), 2100);
}
function fatigue(){
  if(!ok() || !visible) return;
  const W = app.screen.width, H = app.screen.height;
  flash(0xff3b30, .28, 600);
  const t = text('長期戦!', { size: 30, fill: 0xff453a, stroke: 0x000000, sw: 6, glow: 0xff0000, blur: 16, layer: L.top });
  t.position.set(W / 2, H * .45);
  tween(260, p => { t.scale.set(2 - ease.back(p)); });
  tween(400, p => { t.alpha = 1 - p; }, () => kill(t), 900);
}

// ---------------- 共通の演出(ほかのゲーム用) ----------------
// 画面のまん中に大きな文字をたたきつける
function slam(str, o){
  if(!ok() || !visible) return;
  o = o || {};
  const W = app.screen.width, H = app.screen.height, col = o.color === undefined ? 0xffd60a : o.color;
  const y = o.el ? (center(o.el) || { y: H * .4 }).y : H * (o.y || .4);
  const t = text(str, { size: o.size || 56, fill: o.fill === undefined ? 0xffffff : o.fill, stroke: col, sw: 8, glow: col, blur: 22, layer: L.top });
  if(t.width > W * .92) t.scale.set(W * .92 / t.width);
  const s1 = t.scale.x;
  t.position.set(W / 2, y);
  if(o.flash !== false) flash(col, o.flash || .35, 260);
  shake(o.shake === undefined ? 8 : o.shake);
  tween(280, p => { t.scale.set(s1 * (2.4 - 1.4 * ease.back(p))); });
  part({ layer: L.top, t: tex.ring, x: W / 2, y, s0: .2, s1: 3, a0: 1, life: 480, tint: col });
  burst(W / 2, y, o.n || 40, { layer: L.top, t: tex.spark, v0: 350, v1: 1000, l0: 260, l1: 620, s0: 1.1, s1: .2, drag: .07, align: true, tint: [0xffffff, col] });
  tween(320, p => { t.alpha = 1 - p; t.scale.set(s1 * (1 + p * .3)); }, () => kill(t), o.hold || 700);
}
// 要素のところでキラッと
function pop(el, o){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  o = o || {};
  const col = o.color === undefined ? 0xffffff : o.color, pw = o.power || 1;
  part({ t: tex.glow, x: d.x, y: d.y, s0: 1 + pw, s1: .2, a0: .8, life: 260, tint: col });
  part({ t: tex.ring, x: d.x, y: d.y, s0: .15, s1: Math.min(3, d.w / 90) * (.6 + pw * .3), a0: .8, life: 380, tint: col });
  burst(d.x, d.y, Math.round(12 * pw), { t: o.star ? tex.star : tex.spark, v0: 150, v1: 380 + pw * 200, l0: 300, l1: 600, s0: o.star ? 1 : .9, s1: .1, drag: .06, align: !o.star, vr: o.star ? 8 : 0, r: Math.min(d.w * .35, 80), tint: [0xffffff, col] });
}
// 結果の行が出たとき。kind: 'win' / 'lose' / ''
function rowIn(el, kind){
  if(!ok() || !visible) return;
  if(kind === 'win'){ pop(el, { color: 0xffd60a, power: 2, star: true }); shake(4); }
  else if(kind === 'lose') doom(el);
  else pop(el, { color: 0xffffff, power: .7 });
}
// 負けの演出(赤い爆発とヒビ)
function doom(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  flash(0xff1a1a, .4, 420); shake(18);
  burst(d.x, d.y, 50, { t: tex.glow, v0: 120, v1: 620, l0: 400, l1: 1000, s0: .8, s1: .05, drag: .05, r: d.w * .3, tint: [0xff453a, 0xff9f0a, 0x8b0000] });
  burst(d.x, d.y, 22, { t: tex.shard, v0: 220, v1: 640, l0: 700, l1: 1300, s0: 1.4, s1: .6, g: 1000, vr: 12, r: d.w * .3, tint: [0xff453a, 0xd0d0d8], add: false });
  [0, 110].forEach(dl => part({ t: tex.ring, x: d.x, y: d.y, s0: .2, s1: Math.max(2, d.w / 60), life: 520, tint: 0xff453a, delay: dl }));
}
// 紙吹雪
function confetti(n){
  if(!ok() || !visible) return;
  const W = app.screen.width, cols = [0xff453a, 0xffd60a, 0x30d158, 0x64d2ff, 0xbf5af2, 0xff9f0a, 0xffffff];
  for(let i = 0; i < (n || 120); i++) part({ t: tex.rect, x: rnd(0, W), y: rnd(-90, -10), vx: rnd(-50, 50), vy: rnd(80, 260), g: 90, drag: .01, life: rnd(2000, 3200), s0: rnd(.8, 1.3), s1: .9, a0: 1, a1: .6, vr: rnd(-6, 6), rot: rnd(0, 6), flip: true, tint: cols[i % cols.length], add: false, layer: L.top, delay: rnd(0, 700) });
}
// src から dst へ光が飛ぶ(当たると小さく弾ける)
function streak(srcEl, dstEl, color){
  if(!ok() || !visible) return 0;
  const s = center(srcEl), d = center(dstEl); if(!s || !d) return 0;
  const col = color === undefined ? 0xffffff : color, T = 260;
  const head = part({ t: tex.glow, x: s.x, y: s.y, s0: .9, s1: .9, life: T, tint: col });
  tween(T, p => {
    const k = ease.in(p), x = s.x + (d.x - s.x) * k, y = s.y + (d.y - s.y) * k - Math.sin(p * Math.PI) * 40;
    if(head) head.s.position.set(x, y);
    part({ t: tex.glow, x, y, s0: .5, s1: .05, a0: .8, life: 260, tint: col });
  }, () => hitEl(dstEl, col, .5));
  return T;
}
function hitEl(el, color, power){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  impact(d, { ratio: power === undefined ? .4 : power, color: color === undefined ? 0xff453a : color });
}
// 砕ける(脱落など)
function shatter(el, color){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  const col = color === undefined ? 0xff453a : color;
  burst(d.x, d.y, 28, { t: tex.shard, v0: 160, v1: 520, l0: 700, l1: 1200, s0: 1.3, s1: .5, g: 900, vr: 12, r: d.w * .35, tint: [col, 0xffffff], add: false });
  part({ t: tex.ring, x: d.x, y: d.y, s0: .2, s1: 1.8, life: 420, tint: col });
  shake(9);
}
// 要素にオーラをつける / 消す
function aura(el, on, color){
  if(!ok()) return;
  auras = auras.filter(a => a.el !== el);
  if(on) auras.push({ el, t: 0, acc: 0, col: color === undefined ? 0xff453a : color });
}
// 大爆発(CORE)
function fireball(el){
  if(!ok() || !visible) return;
  const d = center(el); if(!d) return;
  auras = [];
  part({ t: tex.glow, x: d.x, y: d.y, s0: 2, s1: 9, a0: 1, life: 520, tint: 0xffb340 });
  part({ t: tex.glow, x: d.x, y: d.y, s0: 1.5, s1: 6, a0: 1, life: 380, tint: 0xffffff });
  [0, 80, 170].forEach(dl => part({ t: tex.ring, x: d.x, y: d.y, s0: .3, s1: 6, a0: 1, life: 600, tint: dl ? 0xff453a : 0xffd60a, delay: dl }));
  burst(d.x, d.y, 90, { t: tex.spark, v0: 500, v1: 1600, l0: 300, l1: 800, s0: 1.6, s1: .2, drag: .04, align: true, tint: [0xffffff, 0xffd60a, 0xff9f0a, 0xff453a] });
  burst(d.x, d.y, 60, { t: tex.glow, v0: 150, v1: 700, l0: 600, l1: 1300, s0: 1, s1: .1, drag: .05, tint: [0xff9f0a, 0xff453a, 0xffd60a] });
  burst(d.x, d.y, 30, { t: tex.shard, v0: 300, v1: 900, l0: 800, l1: 1500, s0: 1.6, s1: .6, g: 1100, vr: 14, tint: [0xffd2c2, 0xff453a], add: false });
}

// 確認用: いま画面に残っているものの数
function _stat(){
  if(!ok()) return null;
  const cnt = c => c.children.length;
  const tx = app.renderer.texture && app.renderer.texture.managedTextures ? app.renderer.texture.managedTextures.length : -1;
  return { parts: parts.length, tweens: tweens.length, pool: pool.length, layers: ['amb', 'back', 'fx', 'top', 'ui'].map(k => cnt(L[k])).join(','), managedTextures: tx };
}
window.NomiFX = { _stat, load, ok, show, intro, fight, attack, num, heal, miss, skill, ko, undying, win, fatigue, slam, pop, rowIn, doom, confetti, streak, hitEl, shatter, aura, fireball };
window.NomiArenaFX = window.NomiFX;
})();
