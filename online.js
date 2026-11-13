/* ONLINE: 部屋(ロビー・QR・参加)と、ゲームの切り替え
 * 方針: 受け取ったデータは型を検証し、画面には textContent だけで出す(innerHTMLは使わない)
 */
(function(){
'use strict';
const $ = id => document.getElementById(id);
const R = window.NomiRoom;
const clean = R.clean;
// 制御文字は取り除くが、改行(\n)だけは残す(結果画面の複数行表示のため)
const clean2 = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f<>]/g, '').slice(0, n || 80);
function show(id){ document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function vis(id, on, disp){ const e = $(id); e.classList.remove('hide'); e.style.display = on ? (disp || 'block') : 'none'; }
function vibrate(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
function qrSize(){ return Math.min(window.innerWidth - 80, 300); }

// ---------- 設定(端末内) ----------
let myName = '';
try{ myName = clean(localStorage.getItem('nomi-name') || ''); }catch(e){}
$('name').value = myName;
let wantGame = (location.hash === '#tap') ? 'tap' : (location.hash === '#stop') ? 'stop' : (location.hash === '#ise') ? 'ise' : 'core';

// ---------- 音 ----------
let ac = null;
const audio = {
  init(){ if(!ac){ const AC = window.AudioContext || window.webkitAudioContext; if(AC) ac = new AC(); } if(ac && ac.state === 'suspended') ac.resume(); },
  heartbeat(vol){
    if(!ac) return; const t = ac.currentTime;
    [[58, 0, .22, .6], [46, .16, .2, .4]].forEach(([f, d, len, g]) => {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t + d);
      gn.gain.setValueAtTime(.0001, t + d); gn.gain.exponentialRampToValueAtTime(g * vol, t + d + .02); gn.gain.exponentialRampToValueAtTime(.0001, t + d + len);
      o.connect(gn); gn.connect(ac.destination); o.start(t + d); o.stop(t + d + len + .05);
    });
  },
  drone: null,
  startDrone(){
    if(!ac || this.drone) return; const t = ac.currentTime;
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); f.type = 'lowpass'; f.frequency.setValueAtTime(140, t);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .4);
    o.connect(f); f.connect(g); g.connect(ac.destination); o.start(t); this.drone = { o, f, g };
  },
  updateDrone(sec){ if(!this.drone) return; const t = ac.currentTime, s = Math.min(sec, 12); this.drone.o.frequency.setTargetAtTime(38 + s * 3.5, t, .1); this.drone.f.frequency.setTargetAtTime(140 + s * 40, t, .1); },
  stopDrone(){ if(!this.drone) return; const t = ac.currentTime, d = this.drone; this.drone = null; d.g.gain.cancelScheduledValues(t); d.g.gain.setTargetAtTime(.0001, t, .05); d.o.stop(t + .3); },
  boom(){
    if(!ac) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 1.2);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    n.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(60, t + 1);
    g.gain.setValueAtTime(1.5, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.2); n.connect(f); f.connect(g); g.connect(ac.destination); n.start(t);
    [420, 580, 890, 1250].forEach((fr, i) => {
      const o = ac.createOscillator(), gg = ac.createGain(); o.type = i % 2 ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(fr, t); o.frequency.exponentialRampToValueAtTime(fr * .2, t + .3);
      gg.gain.setValueAtTime(.25, t); gg.gain.exponentialRampToValueAtTime(.0001, t + .35); o.connect(gg); gg.connect(ac.destination); o.start(t); o.stop(t + .4);
    });
  },
  scare(){
    if(!ac) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 0.5);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const n = ac.createBufferSource(), ng = ac.createGain(); n.buffer = buf;
    ng.gain.setValueAtTime(1.4, t); ng.gain.exponentialRampToValueAtTime(.001, t + .5); n.connect(ng); ng.connect(ac.destination); n.start(t);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(60, t + .25);
    og.gain.setValueAtTime(.5, t); og.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t + .35);
  },
  beep(freq, len, vol){
    if(!ac) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(vol || .2, t); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + len + .02);
  }
};

// ---------- 画面を消さない ----------
let wake = null;
async function keepAwake(){ try{ if(navigator.wakeLock && !wake){ wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }catch(e){} }
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && role) keepAwake(); });

// ---------- QR 表示・読み取り ----------
function drawQR(text, canvas, cssSize){
  const qr = window.qrcode(0, 'L'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), quiet = 4, dpr = window.devicePixelRatio || 1;
  const px = Math.max(2, Math.floor(cssSize * dpr / (n + quiet * 2))), size = px * (n + quiet * 2);
  canvas.width = size; canvas.height = size; canvas.style.width = (size / dpr) + 'px'; canvas.style.height = (size / dpr) + 'px';
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
  for(let r = 0; r < n; r++) for(let c = 0; c < n; c++) if(qr.isDark(r, c)) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
}
let scanner = null;
function stopScan(){ if(scanner){ scanner.stop(); scanner = null; } }
function startScan(videoEl, onText, onError){
  let stream = null, stopped = false, timer = null;
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  function stop(){ stopped = true; clearTimeout(timer); if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; } videoEl.srcObject = null; }
  function tick(){
    if(stopped) return;
    if(videoEl.readyState >= 2 && videoEl.videoWidth){
      const w = videoEl.videoWidth, h = videoEl.videoHeight, sc = Math.min(1, 900 / Math.max(w, h));
      canvas.width = Math.round(w * sc); canvas.height = Math.round(h * sc);
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if(code && code.data && code.data.indexOf('NR1~') === 0){ stop(); onText(code.data); return; }
    }
    timer = setTimeout(tick, 120);
  }
  (async () => {
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if(stopped){ stream.getTracks().forEach(t => t.stop()); return; }
      videoEl.srcObject = stream; videoEl.setAttribute('playsinline', 'true'); await videoEl.play(); tick();
    }catch(e){ stop(); onError(e); }
  })();
  return { stop };
}
function camMsg(e){
  const n = e && e.name;
  if(n === 'NotAllowedError' || n === 'SecurityError') return 'カメラの許可が必要だよ。ブラウザの設定で許可するか、「文字で参加」を使ってね。';
  if(n === 'NotFoundError') return 'カメラが見つからないよ。「文字で参加」を使ってね。';
  return 'カメラを開けなかった: ' + (e && e.message ? e.message : e);
}

// =====================================================================
//  状態
// =====================================================================
let role = null, room = null, guest = null, myId = -1;
let roster = [];                    // [{id,name,rtt}]
let curId = null, game = null, lastGame = null, userLocked = false;
const nameOf = id => { const p = roster.find(r => r.id === id); return p ? p.name : '?'; };

function showBanner(t){ const b = $('banner'); b.textContent = t; b.classList.add('on'); }
function hideBanner(){ $('banner').classList.remove('on'); }
let bannerT = null;
function flashBanner(t, ms){ showBanner(t); clearTimeout(bannerT); bannerT = setTimeout(hideBanner, ms || 4000); }
function onNet(s){
  $('netdot').textContent = '中継 ' + s.up + '/' + s.total;
  if(s.up === 0) showBanner('中継サーバーにつながっていません…再接続中'); else if($('banner').textContent.indexOf('中継サーバー') === 0) hideBanner();
}

// ゲームに渡す道具
const E = {
  $, audio, vibrate, show, nameOf,
  get isHost(){ return role === 'host'; },
  get myId(){ return myId; },
  players: () => roster.slice(),
  send(obj, rel){ obj.g = curId; if(role === 'host'){ if(game && game.hostOnMsg) game.hostOnMsg(0, obj); } else if(guest) guest.send(obj, !!rel); },
  hostSend(id, obj, rel){ obj.g = curId; if(id === 0){ if(game && game.onMsg) game.onMsg(obj); } else if(room) room.sendTo(id, obj, !!rel); },
  hostBcast(obj, rel){ obj.g = curId; if(room) room.bcast(obj, !!rel); if(game && game.onMsg) game.onMsg(obj); },
  toLocal: t => role === 'host' ? t : (guest ? guest.hostToLocal(t) : t),
  clockReady: () => role === 'host' || !!(guest && guest.clock.n >= 4 && isFinite(guest.clock.rtt)),
  showResult(o){
    $('r-title').textContent = clean2(o.title, 40);
    $('r-reason').textContent = clean2(o.reason, 120);
    $('r-pen').textContent = clean2(o.pen, 160);
    const box = $('r-lines'); box.textContent = '';
    (Array.isArray(o.lines) ? o.lines.slice(0, 10) : []).forEach(l => {
      const d = document.createElement('div'); if(l.cls === 'win' || l.cls === 'lose') d.className = l.cls;
      const a = document.createElement('span'); a.textContent = clean2(l.a, 30); const b = document.createElement('span'); b.textContent = clean2(l.b, 30);
      d.appendChild(a); d.appendChild(b); box.appendChild(d);
    });
    $('r-stats').textContent = clean2(o.stats, 400);
    const host = role === 'host';
    vis('r-again', host); vis('r-lobby', host);
    show('s-result');
  }
};

// =====================================================================
//  ロビー表示
// =====================================================================
function renderLobby(){
  const list = $('l-list'); list.textContent = '';
  roster.forEach(p => {
    const row = document.createElement('div'); row.className = 'prow';
    const a = document.createElement('span'); a.textContent = p.name;
    const right = document.createElement('span');
    const tag = document.createElement('small'); tag.textContent = p.id === 0 ? 'ホスト' : (p.id === myId ? 'あなた' : ''); right.appendChild(tag);
    if(role === 'host' && p.id !== 0){
      const k = document.createElement('button'); k.className = 'kick'; k.textContent = '✕ 外す'; k.style.marginLeft = '8px';
      k.addEventListener('click', () => { room.kick(p.id); }); right.appendChild(k);
    }
    row.appendChild(a); row.appendChild(right); list.appendChild(row);
  });
  const host = role === 'host';
  vis('l-qrbox', host && !userLocked, 'flex');
  vis('l-hostctl', host, 'flex');
  $('l-title').textContent = host ? 'ロビー(ホスト)' : 'ロビー';
  $('l-lock').textContent = userLocked ? '受付を再開' : '受付を締める';
  $('l-start').disabled = !(host && roster.length >= 2);
  $('l-help').textContent = host
    ? (roster.length < 2 ? 'QRを読んでもらってね(あと' + (2 - roster.length) + '人以上)。全員同じQRでOK!' : roster.length + '人いるよ。ゲームを選んで開始! 全員そろったら「受付を締める」を押すと安心だよ。')
    : 'ホストがゲームを始めるのを待っているよ…';
  document.querySelectorAll('#l-seg button').forEach(b => b.classList.toggle('on', b.dataset.g === wantGame));
}

// =====================================================================
//  ホスト
// =====================================================================
async function hostCreate(){
  role = 'host'; myId = 0; curId = null; game = null; userLocked = false;
  roster = [{ id: 0, name: myName, rtt: 0 }];
  try{
    room = await R.host({
      onNet,
      onJoin: p => { pushRoster(); flashBanner(p.name + ' が参加したよ', 2500); vibrate(60); },
      onLeave: (p, why) => {
        roster = roster.filter(r => r.id !== p.id);
        if(game && game.hostOnLeave) game.hostOnLeave(p.id);
        pushRoster();
        if(why !== 'kicked') flashBanner(p.name + ' が抜けたよ', 3000);
        if(curId && roster.length < 2) toLobby('人数が足りなくなったので、ロビーにもどるよ');
      },
      onMsg: (id, o) => { if(o && o.g && o.g === curId && game && game.hostOnMsg) game.hostOnMsg(id, o); }
    });
  }catch(e){ role = null; flashBanner('部屋を作れなかった: ' + e.message, 5000); return; }
  drawQR(room.qr, $('l-qr'), qrSize()); $('l-code').value = room.qr;
  keepAwake(); renderLobby(); show('s-lobby');
  setInterval(() => { if(role === 'host' && room) refreshRtt(); }, 3000);
}
function refreshRtt(){
  let ch = false;
  roster.forEach(r => { const p = room.peers.get(r.id); if(p && p.rtt !== r.rtt){ r.rtt = p.rtt; ch = true; } });
  if(ch) room.bcast({ t: 'roster', players: roster }, false);
}
function pushRoster(){
  roster = [{ id: 0, name: myName, rtt: 0 }].concat(Array.from(room.peers.values()).map(p => ({ id: p.id, name: p.name, rtt: p.rtt })));
  room.bcast({ t: 'roster', players: roster }, true);
  if($('s-lobby').classList.contains('active')) renderLobby();
}
function startGame(gid){
  if(role !== 'host' || roster.length < 2 || !window.NomiGames[gid]) return;
  if(game && game.stop) game.stop();
  room.setLocked(true);
  curId = gid; lastGame = gid; document.body.dataset.game = gid; game = window.NomiGames[gid].make(E);
  room.bcast({ t: 'begin', g: gid }, true);
  audio.init(); keepAwake();
  game.onBegin(); game.hostStart();
}
function toLobby(why){
  if(game && game.stop) game.stop();
  game = null; curId = null; resetFx();
  if(role === 'host'){ room.setLocked(userLocked); room.bcast({ t: 'lobby', why: why || '' }, true); }
  $('picker').classList.remove('on');
  renderLobby(); show('s-lobby');
  if(why) flashBanner(why, 4000);
}
function resetFx(){
  ['flash', 'strobe', 'blackout'].forEach(id => $(id).classList.remove('on', 'flashing'));
  $('vignette').style.opacity = 0;
  $('app').style.setProperty('--sx', '0px'); $('app').style.setProperty('--sy', '0px');
}

// =====================================================================
//  参加者
// =====================================================================
function scanView(v){ vis('sc-cam', v === 'cam', 'flex'); vis('sc-wait', v === 'wait'); }
function guestBegin(){
  role = null; $('sc-err').textContent = ''; $('sc-paste').value = '';
  show('s-scan'); scanView('cam'); stopScan();
  scanner = startScan($('sc-video'), joinWith, e => { $('sc-err').textContent = camMsg(e); });
}
async function joinWith(text){
  stopScan(); scanView('wait'); $('sc-err').textContent = '';
  try{
    guest = await R.join(text, {
      name: myName, onNet,
      onWelcome: id => { role = 'guest'; myId = id; roster = []; keepAwake(); audio.init(); renderLobby(); show('s-lobby'); },
      onMsg: guestMsg,
      onStall: () => showBanner('ホストの応答がありません(ホストのスマホが止まってるかも)'),
      onEnd: why => {
        const wasIn = role === 'guest';
        guestCleanup();
        const msg = why === 'kicked' ? 'ホストに外されたよ' : why === 'closed' ? 'ホストが部屋を閉じたよ' : 'ホストにつながらなかった(QRを読み直してね)';
        if(wasIn){ show('s-menu'); flashBanner(msg, 5000); } else { $('sc-err').textContent = msg; guestBegin(); $('sc-err').textContent = msg; }
      }
    });
  }catch(e){ $('sc-err').textContent = e.message; scanView('cam'); stopScan(); scanner = startScan($('sc-video'), joinWith, er => { $('sc-err').textContent = camMsg(er); }); }
}
function guestCleanup(){
  if(game && game.stop) game.stop();
  game = null; curId = null; guest = null; role = null; resetFx(); $('picker').classList.remove('on'); hideBanner();
}
function guestMsg(o){
  if(!o || typeof o.t !== 'string') return;
  if(o.t === 'roster' && Array.isArray(o.players)){
    roster = o.players.filter(p => p && Number.isInteger(p.id)).slice(0, 8).map(p => ({ id: p.id, name: clean(p.name) || '?', rtt: Number.isFinite(p.rtt) ? p.rtt : 0 }));
    if($('s-lobby').classList.contains('active')) renderLobby();
  }else if(o.t === 'begin' && typeof o.g === 'string' && window.NomiGames[o.g]){
    if(game && game.stop) game.stop();
    curId = o.g; document.body.dataset.game = o.g; game = window.NomiGames[o.g].make(E); audio.init(); keepAwake(); hideBanner(); game.onBegin();
  }else if(o.t === 'lobby'){
    if(game && game.stop) game.stop();
    game = null; curId = null; resetFx(); $('picker').classList.remove('on'); renderLobby(); show('s-lobby');
    if(o.why) flashBanner(clean2(o.why, 60), 4000);
  }else if(o.g && o.g === curId && game && game.onMsg){
    game.onMsg(o);
  }
}

// =====================================================================
//  ボタン
// =====================================================================
function saveName(){ myName = clean($('name').value) || 'ゲスト'; $('name').value = myName; try{ localStorage.setItem('nomi-name', myName); }catch(e){} }
function setWant(g){ wantGame = g; if(!curId) document.body.dataset.game = g; document.querySelectorAll('#seg-game button, #l-seg button').forEach(b => b.classList.toggle('on', b.dataset.g === g)); }
document.querySelectorAll('#seg-game button').forEach(b => b.addEventListener('click', () => setWant(b.dataset.g)));
document.querySelectorAll('#l-seg button').forEach(b => b.addEventListener('click', () => setWant(b.dataset.g)));
setWant(wantGame);

$('b-host').addEventListener('click', () => { saveName(); audio.init(); hostCreate(); });
$('b-join').addEventListener('click', () => { saveName(); audio.init(); guestBegin(); });
$('sc-back').addEventListener('click', () => { stopScan(); show('s-menu'); });
$('sc-go').addEventListener('click', () => { const t = $('sc-paste').value.trim(); if(t) joinWith(t); });
$('l-quit').addEventListener('click', quitAll);
$('r-quit').addEventListener('click', quitAll);
$('l-start').addEventListener('click', () => startGame(wantGame));
$('l-lock').addEventListener('click', () => { userLocked = !userLocked; if(room) room.setLocked(userLocked); renderLobby(); });
$('r-again').addEventListener('click', () => { if(role === 'host') startGame(lastGame || wantGame); });
$('r-lobby').addEventListener('click', () => { if(role === 'host') toLobby(''); });
function quitAll(){
  stopScan();
  if(game && game.stop) game.stop();
  if(role === 'host' && room){ room.close(); } else if(guest){ guest.close(); }
  room = null; guest = null; game = null; curId = null; role = null; roster = []; resetFx();
  $('picker').classList.remove('on'); hideBanner(); show('s-menu');
}
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('pagehide', stopScan);
})();
