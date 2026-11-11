(function(){
'use strict';
let S = { noalc: false };
try{ const j = JSON.parse(localStorage.getItem('nomi-settings') || 'null'); if(j) S.noalc = !!j.noalc; }catch(e){}
function render(){ document.querySelectorAll('#seg-alc button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === S.noalc)); }
document.getElementById('seg-alc').addEventListener('click', e => {
  const b = e.target.closest('button'); if(!b) return;
  S.noalc = b.dataset.v === '1';
  try{ localStorage.setItem('nomi-settings', JSON.stringify({ noalc: S.noalc })); }catch(err){}
  render();
});
render();
document.addEventListener('gesturestart', e => e.preventDefault());
if('serviceWorker' in navigator){
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
})();
