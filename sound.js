/* 音が鳴らなくなるのを防ぐ(ゲームの画面で共通)
 *  - iPhone(iOS 17以降): マナーモード(消音スイッチ)でも鳴らす
 *  - LINE などに切り替えたり電話が来たりして音が止まったら、次のタップで再開する
 *  - 古い iPhone: タップの中で無音を1回鳴らすと、それ以降の音が出るようになる
 */
(function(){
  'use strict';
  try{ if(navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; }catch(e){}
  const list = [];
  const primed = new WeakSet();
  function wake(ctx){
    if(!ctx || ctx.state === 'closed') return;
    if(ctx.state !== 'running'){ try{ const p = ctx.resume(); if(p && p.catch) p.catch(() => {}); }catch(e){} }
    if(!primed.has(ctx)){
      try{ const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); primed.add(ctx); }catch(e){}
    }
  }
  function track(ctx){ if(ctx && list.indexOf(ctx) < 0) list.push(ctx); wake(ctx); return ctx; }
  const all = () => list.forEach(wake);
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(t => window.addEventListener(t, all, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') all(); });
  window.addEventListener('pageshow', all);
  window.NomiSound = { track, wake };
})();
