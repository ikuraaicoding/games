(function(){
'use strict';
document.addEventListener('gesturestart', e => e.preventDefault());
if('serviceWorker' in navigator){
  // 新しい版が届いたら、すぐ読み込み直して最新にする
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(had) location.reload(); });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
}
})();
