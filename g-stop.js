/* ピッタリ止めろ オンライン(ホストが審判)
 *
 * ルール
 *  1. ホストが目標秒数(10〜20秒)を決めて、全員に配る
 *  2. 各自、ボタンを長押ししてスタート。最初の3秒だけタイマーが見えて、そのあと隠れる
 *  3. 目標だと思った瞬間に指を離す。離した瞬間にタイマーが止まって、自分の秒数が出る
 *     ほかの人がいつ離したかは、発表まで分からない
 *  4. 全員が離したら、目標とのズレが小さい順に発表。最下位の発表の前に「ため」を入れる
 *
 * 公平さ: 秒数は各スマホの中(指を置いた瞬間→離した瞬間)で測る。通信の遅れは勝負に関係しない。
 */
(function(){
'use strict';
window.NomiGames = window.NomiGames || {};
const HIDE_AFTER_MS = 3000;     // この時間がたつとタイマーが隠れる
const OVER_MS = 10000;          // 目標をこれだけ過ぎたら自動で止める(押しっぱなし対策)
const START_GRACE_MS = 30000;   // 押し始めるまでの待ち時間(これを過ぎたら未参加として最下位あつかい)

window.NomiGames.stop = { id: 'stop', name: 'ピッタリ止めろ', make(E){
  const $ = E.$, pad = $('p-pad');
  const rndF = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; };
  let stopped = false;
  const timers = [];
  const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

  // ---------------- 参加者側 ----------------
  let ph = 'wait', T = 0, t0 = 0, raf = 0, myMs = null;

  function setPad(cls, big, small){
    pad.className = 'pad ' + (cls || '');
    $('p-big').textContent = big || ''; $('p-small').textContent = small || '';
  }
  function setTarget(){ $('p-target').textContent = T ? '目標 ' + T + '.00 秒' : ''; }
  function chips(){
    const box = $('p-chips'); box.textContent = '';
    E.players().forEach(p => {
      const me = p.id === E.myId && myMs !== null;      // ほかの人が離したかどうかは見せない(自分の分だけ)
      const c = document.createElement('span'); c.className = 'chip' + (me ? ' on' : '');
      c.textContent = (me ? '✓ ' : '') + p.name; box.appendChild(c);
    });
  }
  function onBegin(){
    stopped = false; ph = 'wait'; T = 0; t0 = 0; myMs = null;
    $('p-top').textContent = 'BLIND — 見えないタイマー'; setTarget(); chips();
    setPad('', '準備中…', ''); E.show('s-stop');
  }
  const nowTs = e => {
    const n = performance.now(), ts = e && Number.isFinite(e.timeStamp) ? e.timeStamp : n;
    return Math.abs(ts - n) < 5000 ? ts : n;          // 古い形式のタイムスタンプは使わない
  };
  function onMsg(m){
    if(stopped || !m || typeof m.t !== 'string') return;
    if(m.t === 'go' && Number.isInteger(m.T) && m.T >= 10 && m.T <= 60){
      T = m.T; ph = 'ready'; myMs = null; setTarget(); chips();
      setPad('', '長押しで スタート', '目標の秒数ぴったりで指を離せ!\n最初の3秒だけ時間が見えて、あとは隠れるよ');
      E.vibrate(40);
    }else if(m.t === 'res'){ showRes(m); }
  }

  function tick(){
    if(stopped || ph !== 'hold') return;
    const el = performance.now() - t0;
    if(el >= T * 1000 + OVER_MS){ release(null); return; }
    if(el < HIDE_AFTER_MS) $('p-big').textContent = (el / 1000).toFixed(2);
    else if($('p-big').textContent !== '？？？'){ $('p-big').textContent = '？？？'; $('p-small').textContent = '感覚で!\n目標だと思ったら離せ'; E.vibrate(60); }
    raf = requestAnimationFrame(tick);
  }
  function release(e){
    cancelAnimationFrame(raf);
    const ms = Math.max(0, Math.round((e ? nowTs(e) - t0 : performance.now() - t0) * 10) / 10);
    ph = 'done'; myMs = ms; chips();
    E.send({ t: 'rt', ms }, true);
    const d = ms / 1000 - T;
    setPad('down', (ms / 1000).toFixed(2) + ' 秒', '目標 ' + T + '.00 秒 との差 ' + (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2) + '\nみんなを待ってるよ…');
    E.vibrate([40, 30, 80]); E.audio.init(); E.audio.beep(660, .15, .22);
  }

  pad.style.touchAction = 'none';
  const onDown = e => {
    e.preventDefault();
    if(stopped || ph !== 'ready') return;
    ph = 'hold'; t0 = nowTs(e); E.audio.init(); E.vibrate(30);
    setPad('hold', '0.00', '離すな…ぴったりで離せ');
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
  };
  const onUp = e => {
    if(e && e.cancelable) e.preventDefault();
    if(stopped || ph !== 'hold') return;
    release(e);
  };
  pad.addEventListener('pointerdown', onDown, { passive: false });
  pad.addEventListener('pointerup', onUp, { passive: false });
  pad.addEventListener('pointercancel', onUp, { passive: false });
  pad.addEventListener('contextmenu', e => e.preventDefault());

  // ---- 結果発表: ズレの小さい順に1位から。最下位の前に「ため」 ----
  function showRes(m){
    if(!Array.isArray(m.rows) || !Number.isInteger(m.T)) return;
    ph = 'res'; cancelAnimationFrame(raf);
    const tgt = m.T * 1000;
    const rows = m.rows.filter(x => x && Number.isInteger(x.id) && ['ok', 'none'].includes(x.st)).slice(0, 8);
    const ok = rows.filter(x => x.st === 'ok' && Number.isFinite(x.ms)).map(x => ({ id: x.id, ms: x.ms, gap: Math.abs(x.ms - tgt) })).sort((a, b) => a.gap - b.gap);
    const none = rows.filter(x => x.st !== 'ok' || !Number.isFinite(x.ms)).map(x => ({ id: x.id, none: true }));
    const rank = ok.concat(none), n = rank.length;
    if(!n) return;
    const wrap = () => { const b = $('r-again'), c = $('r-lobby'); return [b, c]; };

    E.showResult({ title: 'BLIND', reason: '目標 ' + m.T + '.00 秒 に どれだけ近いか', pen: '', lines: [], stats: '' });
    wrap().forEach(b => { b.style.display = 'none'; });          // 発表がおわるまで、ボタンは隠す
    const box = $('r-lines'), pen = $('r-pen');
    const lastId = rank[n - 1].id;

    function addRow(i){
      const x = rank[i], last = i === n - 1;
      const d = document.createElement('div');
      if(last) d.className = 'lose'; else if(i === 0) d.className = 'win';
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = (i + 1) + '位  ' + E.nameOf(x.id);
      if(x.none) b.textContent = '押さなかった';
      else{ const df = (x.ms - tgt) / 1000; b.textContent = (x.ms / 1000).toFixed(2) + '秒 (' + (df >= 0 ? '+' : '−') + Math.abs(df).toFixed(2) + ')'; }
      d.appendChild(a); d.appendChild(b); d.classList.add('pop'); box.appendChild(d);
      return x;
    }
    function finish(){
      pen.textContent = lastId === E.myId ? 'あなたが最下位' : E.nameOf(lastId) + ' が最下位';
      E.audio.scare(); E.vibrate(lastId === E.myId ? [0, 200, 80, 400] : [0, 120]);
      later(() => { if(E.isHost){ wrap().forEach(b => { b.style.display = 'block'; }); } }, 900);
    }
    // ため: 下2位の発表の前に、ドラムロールのようにじらす
    function drumroll(ms, cb){
      pen.textContent = '……';
      const steps = Math.floor(ms / 130);
      for(let k = 0; k < steps; k++) later(() => { E.audio.beep(300 + k * 22, .09, .12); if(k % 4 === 0) E.vibrate(25); pen.textContent = k % 8 < 4 ? '……' : '… … …'; }, k * 130);
      later(cb, ms);
    }
    const GAP = 1100;
    let i = 0;
    function next(){
      if(stopped) return;
      if(i >= n){ finish(); return; }
      const reveal = () => {
        if(stopped) return;
        addRow(i);
        E.audio.beep(i === 0 ? 988 : 700 - Math.min(i, 5) * 40, .14, .22); E.vibrate(30);
        pen.textContent = '';
        i++;
        // 下2位を出したあとも、ひと呼吸おいてから最下位へ
        later(next, i === n - 1 ? 600 : GAP);
      };
      if(n >= 2 && i === n - 2){ drumroll(2800, reveal); }
      else if(i === n - 1){ drumroll(1800, () => { reveal(); }); }
      else reveal();
    }
    later(next, 900);
  }

  // ---------------- ホスト(審判) ----------------
  const H = { phase: 'wait', T: 0, reports: new Map(), fin: null };
  const players = () => E.players();
  function hostStart(){
    H.phase = 'run'; H.reports = new Map();
    H.T = 10 + Math.floor(rndF() * 11);                 // 10〜20秒
    E.hostBcast({ t: 'go', T: H.T }, true);
    clearTimeout(H.fin); H.fin = setTimeout(finalize, START_GRACE_MS + H.T * 1000 + OVER_MS);
  }
  function allIn(){ return players().every(p => H.reports.has(p.id)); }
  function hostOnMsg(id, m){
    if(!m || typeof m.t !== 'string' || H.phase !== 'run') return;
    if(m.t === 'rt' && !H.reports.has(id) && Number.isFinite(m.ms) && m.ms >= 0 && m.ms <= H.T * 1000 + OVER_MS + 2000){
      H.reports.set(id, { ms: m.ms });           // 誰が離したかは発表まで配らない
      if(allIn()){ clearTimeout(H.fin); H.fin = setTimeout(finalize, 600); }
    }
  }
  function hostOnLeave(id){
    H.reports.delete(id);
    if(H.phase === 'run' && players().length >= 2 && allIn()){ clearTimeout(H.fin); H.fin = setTimeout(finalize, 600); }
  }
  function finalize(){
    if(H.phase !== 'run') return;
    H.phase = 'done'; clearTimeout(H.fin);
    const rows = players().map(p => { const r = H.reports.get(p.id); return r ? { id: p.id, st: 'ok', ms: r.ms } : { id: p.id, st: 'none' }; });
    E.hostBcast({ t: 'res', T: H.T, rows }, true);
  }
  function stop(){
    stopped = true; cancelAnimationFrame(raf); clearTimeout(H.fin);
    timers.forEach(t => clearTimeout(t));
    pad.removeEventListener('pointerdown', onDown); pad.removeEventListener('pointerup', onUp); pad.removeEventListener('pointercancel', onUp);
    ['r-again', 'r-lobby'].forEach(id => { const b = $(id); if(b) b.style.display = ''; });
  }
  return { onBegin, onMsg, hostStart, hostOnMsg, hostOnLeave, stop };
} };
})();
