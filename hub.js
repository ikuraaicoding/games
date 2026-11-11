(function(){
'use strict';
document.addEventListener('gesturestart', e => e.preventDefault());
if('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
})();
