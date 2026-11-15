(function(){
'use strict';
document.addEventListener('gesturestart', e => e.preventDefault());
if('serviceWorker' in navigator){
  // 新しい版が届いたら、すぐ読み込み直して最新にする
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(had) location.reload(); });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
}

// ---------- ゲームを選んだときの音 ----------
let ac = null;
function initAudio(){
  if(!ac){ const AC = window.AudioContext || window.webkitAudioContext; if(AC){ try{ ac = new AC(); }catch(e){} } }
  if(!ac) return;
  if(window.NomiSound) window.NomiSound.track(ac); else if(ac.state !== 'running') ac.resume();
}
function beep(freq, at, len, vol){
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = 'square'; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + len);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + len + .02);
}
function selectSE(){
  initAudio(); if(!ac) return;
  try{ beep(660, 0, .07, .18); beep(990, .06, .1, .18); }catch(e){}
}
// 音が鳴り終わるまで少し待ってから画面を移る(すぐ移ると音が途切れる)
let going = false;
document.addEventListener('click', e => {
  const a = e.target.closest('a.gcard, a.mcard');
  if(!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  if(going) return; going = true;
  selectSE();
  if(navigator.vibrate) try{ navigator.vibrate(15); }catch(err){}
  setTimeout(() => { location.href = a.href; }, 170);
});
// 戻るボタンで戻ってきたとき(ページがそのまま残っている場合)にも、また選べるようにする
window.addEventListener('pageshow', () => { going = false; });
})();
