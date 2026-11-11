/* 全員タップ対決 オンライン(ホストが審判)
 *
 * 公平にするための設計(通信の遅れが勝ち負けに影響しないように)
 *  1. 合図の時刻はホストが先に決めて「○○ms後」ではなく「ホスト時計の絶対時刻」で配る
 *     → 各スマホは、時計合わせ(room.js)で自分の時計に直し、同じ瞬間に画面を緑にする
 *  2. 反応時間は各スマホの中で測る(合図の表示フレーム → 指を離したイベント時刻)。通信時間は含まれない
 *  3. 100ms未満は人間には無理なのでフライング扱い
 *  4. 最後の2人(以上)の差が TIE_MS 以内なら「同着」として全員アウト(誤差で不公平に負けさせない)
 *  5. 自己申告のズルは、ホストがメッセージの到着時刻と通信時間から検算し、矛盾が大きければ補正する
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const TIE_MS = 30, MIN_HUMAN_MS = 100, CHEAT_SLACK_MS = 250;

window.NomiGames.tap = { id: 'tap', name: 'タップ対決', make(E){
  const $ = E.$, pad = $('t-pad');
  const clean2 = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').slice(0, n || 30);
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', down = false, r = 0, localGo = 0, shownAt = null, ready = [], raf = 0, fb = 0, myMs = null;

  function setPad(cls, big, small){
    pad.className = cls || '';
    $('t-big').textContent = big || ''; $('t-small').textContent = small || '';
  }
  function chips(){
    const box = $('t-chips'); box.textContent = '';
    E.players().forEach(p => {
      const c = document.createElement('span'); c.className = 'chip' + (ready.includes(p.id) ? ' on' : '');
      c.textContent = (ready.includes(p.id) ? '✓ ' : '') + p.name; box.appendChild(c);
    });
  }
  function idleText(){
    if(!E.clockReady()){ setPad('', '時計合わせ中…', 'ちょっと待ってね(数秒)'); return; }
    if(down) setPad('down', '👆 OK!', '離さないで…\n他の人を待ってるよ');
    else setPad('', '指を置いて\nそのまま待て', 'みんなが置くと始まるよ(2人以上)\n合図(緑)が出たら、すぐ離す!');
  }
  function onBegin(){
    stopped = false; ph = 'wait'; down = false; r = 0; ready = []; shownAt = null; myMs = null;
    $('t-top').textContent = '⚡ 全員タップ対決'; chips(); idleText(); E.show('s-tap');
    const chk = setInterval(() => { if(stopped){ clearInterval(chk); return; } if(ph === 'wait' && !down) idleText(); }, 700);
    timers.push(chk);
  }
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'ready' && Array.isArray(m.ids)){ ready = m.ids.filter(Number.isInteger); chips(); }
    else if(m.t === 'go' && Number.isFinite(m.at) && Number.isInteger(m.r)){
      if(ph !== 'wait') return;
      ph = 'arm'; r = m.r; shownAt = null; myMs = null;
      localGo = E.toLocal(m.at);
      if(!down){ E.send({ t: 'foul', r }, true); setPad('bad', 'あれ?', '指が離れてたよ…'); ph = 'sent'; return; }
      setPad('arm', '離すな…', '緑になったら すぐ離せ!\n早く離すとフライングで負け');
      E.vibrate(40);
      cancelAnimationFrame(raf); clearTimeout(fb);
      // 基本は描画フレームに合わせて合図を出す(画面に出る瞬間に近い時刻を測れる)。
      // 描画が止まる端末(省電力など)向けに、タイマーでも必ず合図を出す保険をかける
      const fire = ts => {
        if(stopped || ph !== 'arm') return;
        cancelAnimationFrame(raf); clearTimeout(fb);
        shownAt = Math.max(ts, localGo); ph = 'go';
        setPad('go', '今だ!! 離せ!!', ''); E.vibrate(150); E.audio.init(); E.audio.beep(880, .12, .25);
      };
      const frame = ts => {
        if(stopped || ph !== 'arm') return;
        if(performance.now() >= localGo) fire(ts || performance.now()); else raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      fb = setTimeout(() => fire(performance.now()), Math.max(0, localGo - performance.now()) + 80);
      timers.push(fb);
    }else if(m.t === 'res'){ showRes(m); }
  }

  pad.style.touchAction = 'none';
  const onDown = e => {
    e.preventDefault();
    if(stopped || ph !== 'wait' || down) return;
    if(!E.clockReady()){ idleText(); return; }
    down = true; E.audio.init(); E.send({ t: 'down' }, true); idleText(); E.vibrate(30);
  };
  const onUp = e => {
    if(e && e.cancelable) e.preventDefault();
    if(stopped || !down) return;
    down = false;
    if(ph === 'wait'){ E.send({ t: 'up' }, true); idleText(); }
    else if(ph === 'arm'){ ph = 'sent'; E.send({ t: 'foul', r }, true); setPad('bad', 'フライング!', '早すぎた…'); E.vibrate([100, 50, 200]); }
    else if(ph === 'go'){
      const ms = (e && Number.isFinite(e.timeStamp) ? e.timeStamp : performance.now()) - shownAt;
      ph = 'sent';
      if(ms < MIN_HUMAN_MS){ E.send({ t: 'foul', r }, true); setPad('bad', 'フライング!', '反応が速すぎる(' + Math.round(ms) + 'ms)\nは人間には無理だよ'); }
      else { myMs = Math.round(ms * 10) / 10; E.send({ t: 'rt', r, ms: myMs }, true); setPad('down', myMs.toFixed(0) + ' ms', '結果を待ってるよ…'); }
    }
  };
  pad.addEventListener('pointerdown', onDown, { passive: false });
  pad.addEventListener('pointerup', onUp, { passive: false });
  pad.addEventListener('pointercancel', onUp, { passive: false });
  pad.addEventListener('contextmenu', e => e.preventDefault());

  function showRes(m){
    if(!Array.isArray(m.rows) || !Array.isArray(m.losers)) return;
    ph = 'done'; cancelAnimationFrame(raf);
    const rows = m.rows.filter(x => x && Number.isInteger(x.id) && ['ok', 'foul', 'none'].includes(x.st)).slice(0, 8);
    const losers = m.losers.filter(Number.isInteger);
    const ok = rows.filter(x => x.st === 'ok' && Number.isFinite(x.ms)).sort((a, b) => a.ms - b.ms);
    const bad = rows.filter(x => x.st !== 'ok' || !Number.isFinite(x.ms));
    const lines = [];
    ok.forEach((x, i) => lines.push({ a: (i === 0 ? '👑 ' : '') + E.nameOf(x.id) + (x.adj ? '(補正)' : ''), b: x.ms.toFixed(0) + ' ms', cls: losers.includes(x.id) ? 'lose' : (i === 0 ? 'win' : '') }));
    bad.forEach(x => lines.push({ a: E.nameOf(x.id), b: x.st === 'foul' ? 'フライング' : '反応なし', cls: 'lose' }));
    const me = losers.includes(E.myId);
    const names = losers.map(id => E.nameOf(id)).join('・');
    const reason = m.reason === 'foul' ? 'フライングした人が負け' : (m.tie ? '最後の人たちの差が' + TIE_MS + 'ms以内 → 誤差かもしれないので、同着で全員アウト' : '一番遅かった人が負け');
    const warn = rows.filter(x => Number.isFinite(x.rtt) && x.rtt > 1200).map(x => E.nameOf(x.id)).join('・');
    const rtts = rows.filter(x => x.id !== 0 && Number.isFinite(x.rtt) && x.rtt > 0).map(x => E.nameOf(x.id) + ' ' + Math.round(x.rtt) + 'ms').join(' / ');
    later(() => {
      E.showResult({
        title: '⚡ 結果',
        reason,
        pen: (me ? '💀 あなたの負け!\n' : '💀 ' + names + ' の負け!\n') + E.penalty(2),
        lines,
        stats: '反応時間は「合図が出た瞬間」からスマホの中で測っているよ(通信の遅れは入らない)\n' +
               (rtts ? '通信(往復): ' + rtts + '\n' : '') + (warn ? '⚠ ' + warn + ' は通信が遅めだから、時計のズレで数十msの誤差が出るかも' : '')
      });
    }, 700);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'wait', down: new Set(), r: 0, at: 0, reports: new Map(), rdy: null, fin: null };
  const players = () => E.players();
  function snap(){ E.hostBcast({ t: 'ready', ids: Array.from(H.down) }, false); }
  function hostStart(){ H.phase = 'wait'; H.down.clear(); H.reports = new Map(); snap(); }
  function checkReady(){
    clearTimeout(H.rdy);
    const ps = players();
    if(H.phase === 'wait' && ps.length >= 2 && ps.every(p => H.down.has(p.id))) H.rdy = setTimeout(arm, 1200);
  }
  function arm(){
    if(H.phase !== 'wait') return;
    const ps = players();
    if(ps.length < 2 || !ps.every(p => H.down.has(p.id))) return;
    H.phase = 'armed'; H.r++; H.reports = new Map();
    H.at = performance.now() + 2800 + rndF() * 4200;
    E.hostBcast({ t: 'go', r: H.r, at: H.at }, true);
    clearTimeout(H.fin); H.fin = setTimeout(finalize, (H.at - performance.now()) + 5500);
  }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string') return;
    if(H.phase === 'wait'){
      if(m.t === 'down'){ H.down.add(id); snap(); checkReady(); }
      else if(m.t === 'up'){ H.down.delete(id); snap(); checkReady(); }
    }else if(H.phase === 'armed' && m.r === H.r && !H.reports.has(id)){
      if(m.t === 'foul'){
        H.reports.set(id, { st: 'foul' });
        clearTimeout(H.fin); H.fin = setTimeout(finalize, 500);      // 同時のフライングをまとめて拾う
      }else if(m.t === 'rt' && Number.isFinite(m.ms) && m.ms >= 0 && m.ms < 20000){
        let ms = m.ms, adj = false;
        if(id !== 0){
          const peer = players().find(p => p.id === id), rtt = peer && Number.isFinite(peer.rtt) ? peer.rtt : 0;
          const est = performance.now() - H.at - rtt / 2;         // 到着時刻から逆算した「本当の反応時間」の目安
          if(ms < est - CHEAT_SLACK_MS){ ms = Math.round(est * 10) / 10; adj = true; }
        }
        H.reports.set(id, { st: 'ok', ms, adj });
        if(players().every(p => H.reports.has(p.id))){ clearTimeout(H.fin); H.fin = setTimeout(finalize, 50); }
      }
    }
  }
  function hostOnLeave(id){
    H.down.delete(id);
    if(H.phase === 'wait'){ snap(); checkReady(); }
    else if(H.phase === 'armed' && players().every(p => H.reports.has(p.id))){ clearTimeout(H.fin); H.fin = setTimeout(finalize, 50); }
  }
  function finalize(){
    if(H.phase !== 'armed') return;
    H.phase = 'done'; clearTimeout(H.fin);
    const rows = players().map(p => {
      const rep = H.reports.get(p.id);
      return { id: p.id, st: rep ? rep.st : 'none', ms: rep && rep.ms, adj: !!(rep && rep.adj), rtt: p.rtt || 0 };
    });
    let losers = [], tie = false, reason = 'slow';
    const fouls = rows.filter(x => x.st === 'foul');
    if(fouls.length){ losers = fouls.map(x => x.id); reason = 'foul'; }
    else{
      const none = rows.filter(x => x.st === 'none');
      if(none.length) losers = none.map(x => x.id);
      else{
        const worst = Math.max.apply(null, rows.map(x => x.ms));
        const ls = rows.filter(x => x.ms >= worst - TIE_MS);
        losers = ls.map(x => x.id); tie = ls.length > 1;
      }
    }
    E.hostBcast({ t: 'res', rows, losers, tie, reason }, true);
  }
  function stop(){
    stopped = true; cancelAnimationFrame(raf); clearTimeout(H.rdy); clearTimeout(H.fin);
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    pad.removeEventListener('pointerdown', onDown); pad.removeEventListener('pointerup', onUp); pad.removeEventListener('pointercancel', onUp);
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
