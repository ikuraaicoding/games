/* CORE オンライン: ホスト(審判)+ 参加者。通信は net.js(WebRTC + QR手動つなぎ)
 * 方針: 受け取ったデータは必ず型を検証し、画面には textContent だけで出す(innerHTMLは使わない)
 */
(function(){
'use strict';
const N = window.NomiNet;
const $ = id => document.getElementById(id);
const MAX_PLAYERS = 8;
const MAX_MSG = 2048;

// ---------- ユーティリティ ----------
function rndInt(n){ const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function rndFloat(){ const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
function clean(n){ return String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f-\u009f<>&"'`]/g, '').trim().slice(0, 8); }
function show(id){ document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
function vis(id, on, disp){ const e = $(id); e.classList.remove('hide'); e.style.display = on ? (disp || 'block') : 'none'; }
function vibrate(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
function qrSize(){ return Math.min(window.innerWidth - 60, 360); }
function camMsg(e){
  const n = e && e.name;
  if(n === 'NotAllowedError' || n === 'SecurityError') return 'カメラの許可が必要だよ。ブラウザの設定でカメラを許可してね(「文字でやり取り」でも続けられるよ)。';
  if(n === 'NotFoundError') return 'カメラが見つからないよ。「文字でやり取り」を使ってね。';
  return 'カメラを開けなかった: ' + (e && e.message ? e.message : e);
}
function waitOpen(ch, ms){
  return new Promise((res, rej) => {
    if(ch.readyState === 'open') return res();
    const t = setTimeout(() => rej(new Error('時間切れ(つながらなかった)')), ms);
    ch.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    ch.addEventListener('close', () => { clearTimeout(t); rej(new Error('切断された')); }, { once: true });
  });
}
function timeout(ms, msg){ return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)); }

// ---------- 設定(端末内) ----------
let noalc = false;
try{ const st = JSON.parse(localStorage.getItem('nomi-settings') || 'null'); noalc = !!(st && st.noalc); }catch(e){}
let myName = '';
try{ myName = clean(localStorage.getItem('nomi-name') || ''); }catch(e){}
$('name').value = myName;
const penaltyText = () => noalc ? '2点ペナルティ' : '2口飲む';

// ---------- 音 ----------
let ac = null;
function initAudio(){
  if(!ac){ const AC = window.AudioContext || window.webkitAudioContext; if(AC) ac = new AC(); }
  if(!ac) return;
  if(window.NomiSound) window.NomiSound.track(ac); else if(ac.state !== 'running') ac.resume();
}
function heartbeat(vol){
  if(!ac) return;
  const t = ac.currentTime;
  [[58, 0, .22, .6], [46, .16, .2, .4]].forEach(([f, d, len, g]) => {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, t + d);
    gn.gain.setValueAtTime(.0001, t + d);
    gn.gain.exponentialRampToValueAtTime(g * vol, t + d + .02);
    gn.gain.exponentialRampToValueAtTime(.0001, t + d + len);
    o.connect(gn); gn.connect(ac.destination); o.start(t + d); o.stop(t + d + len + .05);
  });
}
let drone = null;
function startDrone(){
  if(!ac || drone) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t);
  f.type = 'lowpass'; f.frequency.setValueAtTime(140, t);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .4);
  o.connect(f); f.connect(g); g.connect(ac.destination); o.start(t);
  drone = { o, f, g };
}
function updateDrone(sec){
  if(!drone) return;
  const t = ac.currentTime, s = Math.min(sec, 12);
  drone.o.frequency.setTargetAtTime(38 + s * 3.5, t, .1);
  drone.f.frequency.setTargetAtTime(140 + s * 40, t, .1);
}
function stopDrone(){
  if(!drone) return;
  const t = ac.currentTime, d = drone; drone = null;
  d.g.gain.cancelScheduledValues(t); d.g.gain.setTargetAtTime(.0001, t, .05); d.o.stop(t + .3);
}
function boomSound(){
  if(!ac) return;
  const t = ac.currentTime, len = Math.floor(ac.sampleRate * 1.2);
  const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  n.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(60, t + 1);
  g.gain.setValueAtTime(1.5, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.2);
  n.connect(f); f.connect(g); g.connect(ac.destination); n.start(t);
  [420, 580, 890, 1250].forEach((fr, i) => {
    const o = ac.createOscillator(), gg = ac.createGain();
    o.type = i % 2 ? 'square' : 'sawtooth'; o.frequency.setValueAtTime(fr, t); o.frequency.exponentialRampToValueAtTime(fr * .2, t + .3);
    gg.gain.setValueAtTime(.25, t); gg.gain.exponentialRampToValueAtTime(.0001, t + .35);
    o.connect(gg); gg.connect(ac.destination); o.start(t); o.stop(t + .4);
  });
}

// ---------- 画面を消さない ----------
let wake = null;
async function keepAwake(){
  try{ if(navigator.wakeLock && !wake){ wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }catch(e){}
}
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && role) keepAwake(); });

// =====================================================================
//  共通の状態
// =====================================================================
let role = null;          // 'host' | 'guest'
let myId = -1;
let roster = [];          // [{id,name}]
let G = { ph: 'lobby', holder: -1, elig: [], turn: 0 };
let guestCh = null, guestPc = null;
let lastHb = 0, hbWatch = null, hbSend = null;
const nameOf = id => { const p = roster.find(r => r.id === id); return p ? p.name : '?'; };

// =====================================================================
//  ホスト(審判)
// =====================================================================
const H = { players: new Map(), nextId: 1, phase: 'lobby', sub: 'idle', holder: 0, last: -1, threshold: 0, total: 0, holdStart: 0, turn: 0, tick: null, choose: null, hb: null, dog: null };

function hostSendTo(p, obj){
  if(p.ch && p.ch.readyState === 'open'){ try{ p.ch.send(JSON.stringify(obj)); }catch(e){} }
}
function bcast(obj){
  H.players.forEach(p => { if(p.id !== 0) hostSendTo(p, obj); });
  onMsg(obj);                        // ホスト自身の画面も同じ経路で更新
}
function alivePlayers(){ return Array.from(H.players.values()).filter(p => !p.gone); }
function rosterMsg(){ return { t: 'roster', players: alivePlayers().map(p => ({ id: p.id, name: p.name })) }; }
function bcastRoster(){ bcast(rosterMsg()); }
function eligible(){
  let ids = alivePlayers().map(p => p.id).filter(id => id !== H.holder && id !== H.last);
  if(!ids.length) ids = alivePlayers().map(p => p.id).filter(id => id !== H.holder);
  return ids;
}
function stMsg(ph){ return { t: 'st', ph, holder: H.holder, turn: H.turn, elig: ph === 'choose' ? eligible() : [] }; }

function hostInit(){
  role = 'host'; myId = 0;
  H.players.clear(); H.nextId = 1; H.phase = 'lobby';
  H.players.set(0, { id: 0, name: myName, ch: null, pc: null, gone: false, seen: Date.now() });
  roster = [{ id: 0, name: myName }];
  clearInterval(H.hb); H.hb = setInterval(() => bcast({ t: 'hb' }), 2000);
  clearInterval(H.dog); H.dog = setInterval(hostWatchdog, 2000);
  keepAwake();
  renderLobby(); show('s-lobby');
}
function hostWatchdog(){
  const now = Date.now();
  H.players.forEach(p => { if(p.id !== 0 && !p.gone && now - p.seen > 20000) dropPlayer(p.id); });
}
function registerPeer(h){
  const id = H.nextId++;
  const p = { id, name: 'ゲスト' + id, ch: h.channel, pc: h.pc, gone: false, seen: Date.now() };
  H.players.set(id, p);
  h.channel.onmessage = e => {
    p.seen = Date.now();
    if(typeof e.data !== 'string' || e.data.length > MAX_MSG) return;
    let m; try{ m = JSON.parse(e.data); }catch(err){ return; }
    hostHandle(id, m);
  };
  h.channel.onclose = () => dropPlayer(id);
  h.pc.onconnectionstatechange = () => { if(h.pc.connectionState === 'failed' || h.pc.connectionState === 'closed') dropPlayer(id); };
  hostSendTo(p, { t: 'welcome', id });
  bcastRoster();
}
function dropPlayer(id){
  const p = H.players.get(id);
  if(!p || p.gone) return;
  p.gone = true;
  try{ p.ch && p.ch.close(); p.pc && p.pc.close(); }catch(e){}
  if(H.phase === 'play'){
    if(H.holder === id){
      if(H.sub === 'hold'){ stopTick(); H.total += (performance.now() - H.holdStart) / 1000; }
      clearTimeout(H.choose);
    }
    if(alivePlayers().length < 2){ hostEnd('ほかの人がいなくなったので終了'); return; }
    bcastRoster();
    if(H.holder === id){ const e = eligible(); doPass(e[rndInt(e.length)], true); }
  }else{
    H.players.delete(id);
    bcastRoster();
  }
}
function hostHandle(id, m){
  if(!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  const p = H.players.get(id); if(!p || p.gone) return;
  switch(m.t){
    case 'hello':
      if(H.phase === 'play') return;
      p.name = clean(m.name) || ('ゲスト' + id);
      if(alivePlayers().some(q => q.id !== id && q.name === p.name)) p.name = (p.name.slice(0, 6) + id);
      bcastRoster(); break;
    case 'press':
      if(H.phase === 'play' && H.sub === 'idle' && H.holder === id){
        H.sub = 'hold'; H.holdStart = performance.now();
        clearInterval(H.tick); H.tick = setInterval(hostTick, 25);
        bcast(stMsg('hold'));
      } break;
    case 'release':
      if(H.phase === 'play' && H.sub === 'hold' && H.holder === id) hostRelease(); break;
    case 'pass':
      if(H.phase === 'play' && H.sub === 'choose' && H.holder === id && Number.isInteger(m.to)) doPass(m.to, false); break;
  }
}
function stopTick(){ clearInterval(H.tick); H.tick = null; }
function hostTick(){
  if(H.total + (performance.now() - H.holdStart) / 1000 >= H.threshold) hostBoom(H.holder, 'limit');
}
function hostRelease(){
  stopTick();
  const el = (performance.now() - H.holdStart) / 1000;
  // 参加者は通信の遅れ(往復の揺れ)があるので、1.00秒の判定に少しだけ余裕をもたせる
  const minHold = H.holder === 0 ? 1.0 : 0.9;
  if(el < minHold){ hostBoom(H.holder, 'early'); return; }
  H.total += el; H.turn++; H.sub = 'choose';
  bcast(stMsg('choose'));
  clearTimeout(H.choose);
  H.choose = setTimeout(() => { const e = eligible(); doPass(e[rndInt(e.length)], true); }, 9500);
}
function doPass(to, auto){
  if(H.phase !== 'play') return;
  if(!eligible().includes(to)) return;
  clearTimeout(H.choose);
  H.last = H.holder; H.holder = to; H.sub = 'idle';
  bcast(stMsg('idle'));
}
function hostBoom(loser, reason){
  if(H.phase !== 'play') return;
  H.phase = 'result'; stopTick(); clearTimeout(H.choose);
  bcast({ t: 'boom', loser, reason, turns: H.turn, sec: Math.round(H.total * 100) / 100 });
}
function hostStartGame(){
  if(alivePlayers().length < 2) return;
  H.phase = 'play'; H.sub = 'idle'; H.last = -1; H.turn = 0; H.total = 0;
  H.threshold = 7 + rndFloat() * 23;         // 秘密。ホストの中だけにあり、通信には載せない
  const al = alivePlayers(); H.holder = al[rndInt(al.length)].id;
  bcast({ t: 'start' });
  bcast(stMsg('idle'));
}
function hostEnd(reason){
  H.phase = 'lobby'; stopTick(); clearTimeout(H.choose);
  bcast({ t: 'end', reason });
}
function hostShutdown(){
  clearInterval(H.hb); clearInterval(H.dog); stopTick(); clearTimeout(H.choose);
  H.players.forEach(p => { hostSendTo(p, { t: 'end', reason: 'ホストが部屋を閉じました', closed: true }); try{ p.ch && p.ch.close(); p.pc && p.pc.close(); }catch(e){} });
  H.players.clear(); role = null;
}

// =====================================================================
//  ホスト: 参加者追加(QR)
// =====================================================================
let pending = null, scanner = null;
function stopScan(){ if(scanner){ scanner.stop(); scanner = null; } }
function closePending(){ stopScan(); if(pending){ try{ pending.pc.close(); }catch(e){} pending = null; } }
function pairView(v){
  vis('p-prep', v === 'prep'); vis('p-show', v === 'show', 'flex'); vis('p-scan', v === 'scan', 'flex'); vis('p-conn', v === 'conn');
}
async function hostPrepare(keepErr){
  if(alivePlayers().length >= MAX_PLAYERS){ return; }
  closePending(); if(keepErr !== true) $('p-err').textContent = ''; show('s-pair'); pairView('prep');
  try{
    pending = await N.hostCreateOffer($('stun').checked);
    N.drawQR(pending.blob, $('p-qr'), qrSize());
    $('p-code').value = pending.blob; $('p-paste').value = '';
    pairView('show');
  }catch(e){ $('p-err').textContent = 'QRの作成に失敗した: ' + e.message; }
}
function hostScan(){
  pairView('scan'); $('p-err').textContent = '';
  scanner = N.startScan($('p-video'), text => hostGotAnswer(text), e => { $('p-err').textContent = camMsg(e); pairView('show'); });
}
async function hostGotAnswer(text){
  stopScan(); pairView('conn'); $('p-err').textContent = '';
  const h = pending;
  try{
    await N.hostAcceptAnswer(h, text);
    await waitOpen(h.channel, 20000);
    pending = null;
    registerPeer(h);
    renderLobby(); show('s-lobby');
  }catch(e){
    $('p-err').textContent = 'つながらなかった: ' + e.message + '(Wi-Fiの設定でスマホ同士の通信が禁止されているかも。もう一度試してね)';
    closePending(); pairView('prep');
    setTimeout(() => hostPrepare(true), 400);
  }
}
$('p-next').addEventListener('click', hostScan);
$('p-paste-go').addEventListener('click', () => { const t = $('p-paste').value.trim(); if(t) hostGotAnswer(t); });
$('p-back').addEventListener('click', () => { closePending(); renderLobby(); show('s-lobby'); });
$('l-add').addEventListener('click', hostPrepare);

// =====================================================================
//  参加者(ゲスト)
// =====================================================================
function joinView(v){
  vis('j-scan', v === 'scan', 'flex'); vis('j-making', v === 'making'); vis('j-show', v === 'show', 'flex');
}
let gpending = null;
function guestJoin(){
  role = 'guest'; myId = -1; $('j-err').textContent = '';
  show('s-join'); joinView('scan'); $('j-paste').value = '';
  stopScan();
  scanner = N.startScan($('j-video'), text => guestGotOffer(text), e => { $('j-err').textContent = camMsg(e); });
}
async function guestGotOffer(text){
  stopScan(); joinView('making'); $('j-err').textContent = '';
  try{
    const g = await N.guestAcceptOffer(text, $('stun').checked);
    gpending = g;
    N.drawQR(g.blob, $('j-qr'), qrSize()); $('j-code').value = g.blob;
    joinView('show');
    const ch = await Promise.race([g.channel, timeout(90000, 'ホストが読み取らなかった(時間切れ)')]);
    await waitOpen(ch, 30000);
    guestConnected(g, ch);
  }catch(e){
    $('j-err').textContent = 'つながらなかった: ' + e.message;
    if(gpending){ try{ gpending.pc.close(); }catch(err){} gpending = null; }
    joinView('scan');
    stopScan();
    scanner = N.startScan($('j-video'), t => guestGotOffer(t), er => { $('j-err').textContent = camMsg(er); });
  }
}
function guestConnected(g, ch){
  guestCh = ch; guestPc = g.pc; gpending = null;
  lastHb = Date.now();
  ch.onmessage = e => {
    if(typeof e.data !== 'string' || e.data.length > MAX_MSG) return;
    let m; try{ m = JSON.parse(e.data); }catch(err){ return; }
    onMsg(m);
  };
  ch.onclose = () => { if(role === 'guest') showBanner('ホストとの接続が切れました。もどってつなぎ直してね。'); };
  guestSend({ t: 'hello', name: myName });
  clearInterval(hbSend); hbSend = setInterval(() => guestSend({ t: 'hb' }), 3000);
  clearInterval(hbWatch);
  hbWatch = setInterval(() => {
    if(role !== 'guest') return;
    if(Date.now() - lastHb > 7000) showBanner('ホストの応答がありません(ホストのスマホが止まってるかも)');
    else hideBanner();
  }, 1000);
  keepAwake();
  renderLobby(); show('s-lobby');
}
function guestSend(obj){ if(guestCh && guestCh.readyState === 'open'){ try{ guestCh.send(JSON.stringify(obj)); }catch(e){} } }
function guestLeave(){
  clearInterval(hbSend); clearInterval(hbWatch);
  try{ guestCh && guestCh.close(); guestPc && guestPc.close(); }catch(e){}
  guestCh = null; guestPc = null; role = null; hideBanner();
}
$('j-paste-go').addEventListener('click', () => { const t = $('j-paste').value.trim(); if(t) guestGotOffer(t); });
$('j-back').addEventListener('click', () => { stopScan(); if(gpending){ try{ gpending.pc.close(); }catch(e){} gpending = null; } role = null; show('s-menu'); });

// =====================================================================
//  表示側(ホスト・ゲスト共通)
// =====================================================================
function showBanner(t){ const b = $('banner'); b.textContent = t; b.classList.add('on'); }
function hideBanner(){ $('banner').classList.remove('on'); }

function renderLobby(){
  const list = $('l-list'); list.textContent = '';
  roster.forEach(p => {
    const row = document.createElement('div'); row.className = 'prow';
    const a = document.createElement('span'); a.textContent = p.name;
    const b = document.createElement('small'); b.textContent = p.id === 0 ? 'ホスト' : (p.id === myId ? 'あなた' : '');
    row.appendChild(a); row.appendChild(b); list.appendChild(row);
  });
  const isHost = role === 'host';
  $('l-add').style.display = isHost && roster.length < MAX_PLAYERS ? '' : 'none';
  $('l-start').style.display = isHost ? '' : 'none';
  $('l-start').disabled = !(isHost && roster.length >= 2);
  $('l-help').textContent = isHost
    ? (roster.length < 2 ? '「参加者を追加」で、1人ずつQRでつないでね(あと' + (2 - roster.length) + '人以上)。' : roster.length + '人つながってるよ。まだ追加もできるし、始めてもOK!')
    : 'ホストがゲームを始めるのを待っているよ…';
}

// ---- ゲーム画面 ----
const core = $('core'), vignette = $('vignette');
let beatT = null, holdSince = 0, localHolding = false, shakeT = null, pickT = null;

function renderGame(){
  const mine = G.holder === myId;
  const hn = nameOf(G.holder);
  core.classList.toggle('mine', mine);
  core.classList.toggle('watch', !mine && G.ph === 'hold');
  core.classList.toggle('holding', mine && localHolding);
  $('g-top').textContent = mine ? 'あなたがコアを持っている' : hn + ' がコアを持っている';
  let hint = '';
  if(G.ph === 'idle') hint = mine ? 'コアに触れ、1秒以上 長押し\n離したら、次の者へ渡せ' : hn + ' が触れるのを待っている…';
  if(G.ph === 'hold') hint = mine ? '長押し中……' : hn + ' が長押し中…';
  if(G.ph === 'choose') hint = mine ? '' : hn + ' が渡す相手を選んでいる…';
  $('g-hint').textContent = hint; $('g-hint').style.whiteSpace = 'pre-line';
  $('g-turn').textContent = 'TURN ' + G.turn;
  $('picker').classList.toggle('on', mine && G.ph === 'choose');
}
function startBeat(){
  stopBeat(); holdSince = performance.now();
  const loop = () => {
    const held = (performance.now() - holdSince) / 1000;
    const mine = G.holder === myId;
    heartbeat(mine ? .6 : .28);
    core.animate([{ transform: 'scale(1)' }, { transform: 'scale(' + (1 + Math.min(.05, .02 + held * .004)) + ')' }, { transform: 'scale(1)' }], { duration: 300 });
    vibrate(mine ? 35 : 20);
    if(mine) updateDrone(held);
    vignette.style.opacity = mine ? Math.min(1, held / 9).toFixed(3) : 0;
    beatT = setTimeout(loop, Math.max(330, 620 - held * 32));
  };
  loop();
}
function stopBeat(){ clearTimeout(beatT); beatT = null; vignette.style.opacity = 0; stopDrone(); }

function openPicker(elig){
  const list = $('pk-list'); list.textContent = '';
  $('pk-sub').textContent = '押したら、その人にコアが渡る(9秒でランダム)';
  elig.forEach(id => {
    const b = document.createElement('button'); b.textContent = nameOf(id);
    b.addEventListener('click', () => { sendPass(id); }, { once: true });
    list.appendChild(b);
  });
  const bar = $('pk-bar'); bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)';
  void bar.offsetWidth; bar.style.transition = 'transform 9.5s linear'; bar.style.transform = 'scaleX(0)';
}
function sendPass(to){
  $('picker').classList.remove('on');
  if(role === 'host') hostHandle(0, { t: 'pass', to }); else guestSend({ t: 'pass', to });
}

function onMsg(m){
  if(!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  switch(m.t){
    case 'welcome':
      if(Number.isInteger(m.id)) myId = m.id; break;
    case 'roster':
      if(!Array.isArray(m.players)) return;
      roster = m.players.filter(p => p && Number.isInteger(p.id)).slice(0, MAX_PLAYERS).map(p => ({ id: p.id, name: clean(p.name) || '?' }));
      if($('s-lobby').classList.contains('active')) renderLobby();
      break;
    case 'hb': lastHb = Date.now(); break;
    case 'start':
      G = { ph: 'idle', holder: -1, elig: [], turn: 0 };
      localHolding = false; resetFx(); show('s-game'); initAudio(); keepAwake(); break;
    case 'st': {
      if(!['idle', 'hold', 'choose'].includes(m.ph) || !Number.isInteger(m.holder)) return;
      const prev = G.ph;
      G = { ph: m.ph, holder: m.holder, turn: Number.isInteger(m.turn) ? m.turn : 0, elig: Array.isArray(m.elig) ? m.elig.filter(Number.isInteger) : [] };
      if(m.ph === 'hold'){ if(prev !== 'hold') startBeat(); }
      else { stopBeat(); if(m.holder !== myId) localHolding = false; }
      if(m.ph === 'choose' && m.holder === myId){ openPicker(G.elig); vibrate([60, 40, 60]); }
      if(m.ph === 'idle' && m.holder === myId){ vibrate([80, 40, 80]); }
      renderGame();
      break; }
    case 'boom':
      if(!Number.isInteger(m.loser)) return;
      G.ph = 'result'; stopBeat(); localHolding = false; $('picker').classList.remove('on');
      explode(m);
      break;
    case 'end':
      stopBeat(); $('picker').classList.remove('on');
      if(m.closed){ guestLeave(); showBanner(clean2(m.reason)); show('s-menu'); setTimeout(hideBanner, 4000); }
      else { G.ph = 'lobby'; renderLobby(); show('s-lobby'); showBanner(clean2(m.reason)); setTimeout(hideBanner, 4000); }
      break;
  }
}
function clean2(s){ return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').slice(0, 60); }

// ---- 長押し(自分がコアを持っているとき) ----
core.addEventListener('pointerdown', e => {
  e.preventDefault();
  if(G.holder !== myId || G.ph !== 'idle' || localHolding) return;
  localHolding = true; initAudio(); startDrone(); core.classList.add('holding');
  holdSince = performance.now();
  if(role === 'host') hostHandle(0, { t: 'press' }); else guestSend({ t: 'press' });
}, { passive: false });
function localRelease(e){
  if(e && e.cancelable) e.preventDefault();
  if(!localHolding) return;
  localHolding = false; core.classList.remove('holding'); stopDrone();
  if(role === 'host') hostHandle(0, { t: 'release' }); else guestSend({ t: 'release' });
}
core.addEventListener('pointerup', localRelease, { passive: false });
core.addEventListener('pointercancel', localRelease, { passive: false });
core.addEventListener('pointerleave', localRelease, { passive: false });
core.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

// ---- 爆発 ----
function shake(amp){
  const app = $('app');
  app.style.setProperty('--sx', ((Math.random() - .5) * amp).toFixed(1) + 'px');
  app.style.setProperty('--sy', ((Math.random() - .5) * amp).toFixed(1) + 'px');
}
function resetFx(){
  clearInterval(shakeT); shake(0);
  $('app').style.setProperty('--sx', '0px'); $('app').style.setProperty('--sy', '0px');
  core.classList.remove('burst'); $('blackout').classList.remove('on');
  document.querySelectorAll('.ring').forEach(r => r.remove());
  vignette.style.opacity = 0;
}
function explode(m){
  initAudio(); boomSound(); vibrate([0, 120, 50, 120, 80, 300, 100, 500, 150, 600]);
  core.classList.add('burst');
  let k = 0; clearInterval(shakeT);
  shakeT = setInterval(() => { k++; shake(Math.max(3, 40 * (1 - k / 24))); if(k >= 24){ clearInterval(shakeT); shake(0); } }, 25);
  [0, 70, 140, 220].forEach(d => setTimeout(() => {
    const r = document.createElement('div'); r.className = 'ring'; $('cwrap').appendChild(r);
    requestAnimationFrame(() => r.classList.add('go')); setTimeout(() => r.remove(), 700);
  }, d));
  ['strobe', 'flash'].forEach(id => { const e = $(id); e.classList.remove('on'); void e.offsetWidth; e.classList.add('on'); });
  setTimeout(() => $('blackout').classList.add('on'), 280);
  setTimeout(() => {
    const me = m.loser === myId, ln = nameOf(m.loser);
    $('r-reason').textContent = m.reason === 'early' ? '1.00秒に満たず、指が離れた' : 'コアが限界を超えて、弾けた';
    $('r-pen').textContent = me ? '💀 あなたが爆発させた!\n' + penaltyText() : '💀 ' + ln + ' が爆発させた!\n' + penaltyText();
    $('r-pen').style.whiteSpace = 'pre-line';
    $('r-stats').textContent = (Number.isFinite(m.turns) ? m.turns : 0) + ' TURN 生還 ／ 累計 ' + (Number.isFinite(m.sec) ? m.sec.toFixed(2) : '0.00') + ' SEC';
    const host = role === 'host';
    $('r-again').textContent = host ? 'もう一回' : 'ホストが次を始めるのを待つ…';
    $('r-again').disabled = !host;
    show('s-result');
    $('blackout').classList.remove('on'); core.classList.remove('burst');
    $('flash').classList.remove('on'); $('strobe').classList.remove('on');
  }, 1100);
}
$('r-again').addEventListener('click', () => { if(role === 'host') hostStartGame(); });
$('r-quit').addEventListener('click', quitAll);

// =====================================================================
//  メニュー
// =====================================================================
function saveName(){
  myName = clean($('name').value) || 'ゲスト';
  $('name').value = myName;
  try{ localStorage.setItem('nomi-name', myName); }catch(e){}
}
function quitAll(){
  stopBeat(); stopScan(); closePending(); resetFx();
  if(role === 'host') hostShutdown(); else guestLeave();
  role = null; hideBanner(); $('picker').classList.remove('on'); show('s-menu');
}
$('b-host').addEventListener('click', () => { saveName(); initAudio(); hostInit(); });
$('b-join').addEventListener('click', () => { saveName(); initAudio(); guestJoin(); });
$('l-quit').addEventListener('click', quitAll);
$('l-start').addEventListener('click', () => { if(role === 'host') hostStartGame(); });

// 画面を閉じたら、カメラとつなぎを必ず片づける
window.addEventListener('pagehide', () => { stopScan(); closePending(); });
})();
