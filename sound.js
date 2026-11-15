/* 音の出口(AudioContext)を1つだけ持って、音が鳴らなくなるのを防ぐ(ホームとゲームの画面で共通)
 *  - iPhone(iOS 17以降): マナーモード(消音スイッチ)でも鳴らす
 *  - 画面から抜けたら(ほかのアプリ・ホームにもどる・別の画面へ移る)、音の出口を閉じる。
 *    もどってきて最初にタップしたときに、新しく作り直す。
 *    (iPhone では、抜けたあとも同じものを使い続けると「動いているのに無音」になったり、
 *     前の画面の分が残って数の上限に引っかかったりして、音が出なくなることがある)
 *  - 古い iPhone: タップの中で無音を1回鳴らすと、それ以降の音が出るようになる
 *
 *  使い方: タップの中で NomiSound.open()(なければ作る)/ 音を出すときは NomiSound.get()(なければ null)
 */
(function(){
  'use strict';
  try{ if(navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; }catch(e){}
  const AC = window.AudioContext || window.webkitAudioContext;
  let cur = null, want = false, primed = false;
  function wake(tap){
    if(!cur || cur.state === 'closed') return;
    if(cur.state !== 'running'){ try{ const p = cur.resume(); if(p && p.catch) p.catch(() => {}); }catch(e){} }
    if(tap && !primed){
      try{ const b = cur.createBuffer(1, 1, 22050), s = cur.createBufferSource(); s.buffer = b; s.connect(cur.destination); s.start(0); primed = true; }catch(e){}
    }
  }
  // tap: タップの中から呼んだか(タップの外では、作り直しと再開だけ試す)
  function open(tap){
    want = true;
    if(!AC) return null;
    if(!cur || cur.state === 'closed'){ try{ cur = new AC(); primed = false; }catch(e){ cur = null; } }
    wake(tap !== false);
    return cur;
  }
  const get = () => cur && cur.state !== 'closed' ? cur : null;
  function drop(){
    if(!cur) return;
    const c = cur; cur = null; primed = false;
    try{ const p = c.close(); if(p && p.catch) p.catch(() => {}); }catch(e){}
  }
  // タップのたびに: 一度でも音を使った画面なら、閉じていれば作り直し、止まっていれば再開する
  const onTap = () => { if(want) open(); };
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(t => window.addEventListener(t, onTap, { capture: true, passive: true }));
  // もどってきたら、タップを待たずに作り直してみる(Android などはこれで鳴る。iPhone は次のタップで鳴りはじめる)
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') drop(); else if(want) open(false); });
  window.addEventListener('pagehide', drop);
  window.addEventListener('pageshow', e => { if(e.persisted && want) open(false); });
  window.NomiSound = { open, get };
})();
