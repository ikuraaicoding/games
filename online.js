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
function show(id){ document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if(window.__chatVis) window.__chatVis(id); }
function vis(id, on, disp){ const e = $(id); e.classList.remove('hide'); e.style.display = on ? (disp || 'block') : 'none'; }
function vibrate(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
function qrSize(){ return Math.min(window.innerWidth - 80, 300); }

// ---------- 設定(端末内) ----------
let myName = '';
try{ myName = clean(localStorage.getItem('nomi-name') || ''); }catch(e){}
$('name').value = myName;
let wantGame = ({ '#tap': 'tap', '#stop': 'stop', '#ise': 'ise', '#arena': 'arena' })[location.hash] || 'core';

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
  boom(v){
    const k = v === undefined ? 1 : v;
    if(!ac || k <= 0) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 1.2);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    n.buffer = buf; f.type = 'lowpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(60, t + 1);
    g.gain.setValueAtTime(1.5 * k, t); g.gain.exponentialRampToValueAtTime(.001, t + 1.2); n.connect(f); f.connect(g); g.connect(ac.destination); n.start(t);
    [420, 580, 890, 1250].forEach((fr, i) => {
      const o = ac.createOscillator(), gg = ac.createGain(); o.type = i % 2 ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(fr, t); o.frequency.exponentialRampToValueAtTime(fr * .2, t + .3);
      gg.gain.setValueAtTime(.25 * k, t); gg.gain.exponentialRampToValueAtTime(.0001, t + .35); o.connect(gg); gg.connect(ac.destination); o.start(t); o.stop(t + .4);
    });
  },
  scare(v){
    const k = v === undefined ? 1 : v;
    if(!ac || k <= 0) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 0.5);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const n = ac.createBufferSource(), ng = ac.createGain(); n.buffer = buf;
    ng.gain.setValueAtTime(1.4 * k, t); ng.gain.exponentialRampToValueAtTime(.001, t + .5); n.connect(ng); ng.connect(ac.destination); n.start(t);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(60, t + .25);
    og.gain.setValueAtTime(.5 * k, t); og.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t + .35);
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
let curId = null, game = null, lastGame = null, userLocked = false, solo = false;
const nameOf = id => { const p = roster.find(r => r.id === id); return p ? p.name : '?'; };

function showBanner(t){ const b = $('banner'); b.textContent = t; b.classList.add('on'); }
function hideBanner(){ $('banner').classList.remove('on'); }
let bannerT = null;
function flashBanner(t, ms){ showBanner(t); clearTimeout(bannerT); bannerT = setTimeout(hideBanner, ms || 4000); }
function onNet(s){
  $('netdot').textContent = '接続 ' + s.up + '/' + s.total;
  if(s.up === 0) showBanner('通信がつながっていません…再接続中'); else if($('banner').textContent.indexOf('通信がつながって') === 0) hideBanner();
}

// ゲームに渡す道具
// 演出レイヤー(pfx.js)。読み込めない・使えないときは、何もしない(各関数の中で確かめている)
const FXN = window.NomiFX || new Proxy({}, { get: () => () => 0 });
const E = {
  $, audio, vibrate, show, nameOf, fx: FXN,
  quiet: on => setQuiet(on),
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
// ---------- ゲームの一覧とルール(ロビーで、だれでも読める) ----------
const RULES = [
  { g: 'tap', nm: 'DRAW', sub: '早撃ち', ic: 'i-draw', r: [
    '全員が画面に指を置いて、そのまま待つ',
    'しばらくすると画面が緑になる。その瞬間に指を離す',
    'いちばん離すのが遅かった人の負け',
    '緑になる前に離すと、フライングで負け',
    'ほぼ同時(0.01秒以内)の人がいたら、その人たちだけで再戦',
    '反応の速さは自分のスマホの中で測るので、通信の遅れは関係ない'] },
  { g: 'stop', nm: 'BLIND', sub: '見えないタイマー', ic: 'i-blind', r: [
    '目標の秒数(10〜20秒)が出る',
    '画面を長押しするとタイマースタート。最初の3秒だけ時間が見えて、あとは隠れる',
    '目標ぴったりだと思ったら指を離す',
    '目標にいちばん近い人が1位、いちばん遠い人が最下位',
    'ほかの人がいつ離したかは、発表まで分からない'] },
  { g: 'ise', nm: 'THUMBS', sub: 'いっせーのーせ', ic: 'i-thumbs', r: [
    '毎ラウンド、こっそり「自分が立てる親指の数(0〜2本)」と「全員の合計の予想」を決める',
    '「いっせーのーせ!」で全員の親指が公開されて、合計が決まる',
    '予想がズレた人は、ズレた数だけライフが減る',
    'ピッタリ当てた人はノーダメージ。かわりに、ほかの全員にダメージ(人数が多いほど大きい)',
    'ライフが0になったら脱落。最後まで残った人の勝ち',
    'はじめのライフは 4 + 人数×2'] },
  { g: 'core', nm: 'CORE', sub: '爆弾リレー', ic: 'i-core', r: [
    'コアを持っている人は、1.5秒以上 長押ししてから離し、次の人に渡す',
    '1.5秒より早く離すと、その場で爆発して負け',
    'コアには、だれにも分からない限界(みんなが長押しした時間の合計)がある。限界を超えたときに持っていた人の負け',
    '自分に渡してきた人には、すぐには返せない',
    '長押し中にドッキリが起きることがある。驚いて離さないように!'] },
  { g: 'arena', nm: 'ARENA', sub: '育成バトル', ic: 'i-arena', r: [
    '育成タイム(3〜10分)の間にパーティを強くする。最初は全員「攻3 防3 HP3」のキャラ1体',
    '10秒ごとに行動が1回たまる(最大3回。満タンのままだと、あふれて無駄になる)',
    '行動ごとに「キャラガチャ」「装備ガチャ」「スキル強化」から1つ選ぶ。パーティは最大3体',
    '時間切れで、ランダムなトーナメント。戦闘は自動',
    '試合中にできるのは、各キャラのスキルを使うタイミングを選ぶことだけ(1試合1回)',
    'ホストの設定で「優勝を決める」か「最下位を決める(負け残り)」かが変わる'] }
];
let hostWant = '';                 // 参加者側: ホストがいま選んでいるゲーム
let rulesTouched = false;          // 参加者が自分でルールを開いたか(開いたら、勝手に開き直さない)
function buildRules(){
  const box = $('l-rlist'); box.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (id, cls) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
  RULES.forEach(x => {
    const d = document.createElement('details'); d.className = 'rcard g-' + x.g; d.dataset.g = x.g;
    const sm = document.createElement('summary');
    const tile = document.createElement('span'); tile.className = 'tile'; tile.appendChild(icon(x.ic)); sm.appendChild(tile);
    const rn = document.createElement('span'); rn.className = 'rn';
    const b = document.createElement('b'); b.textContent = x.nm; const s = document.createElement('small'); s.textContent = x.sub;
    rn.appendChild(b); rn.appendChild(s); sm.appendChild(rn);
    const pk = document.createElement('span'); pk.className = 'pick hide'; pk.textContent = 'ホストが選択中'; sm.appendChild(pk);
    sm.appendChild(icon('i-chev', 'chev'));
    sm.addEventListener('click', () => { rulesTouched = true; });
    d.appendChild(sm);
    const ol = document.createElement('ol');
    x.r.forEach(t => { const li = document.createElement('li'); li.textContent = t; ol.appendChild(li); });
    d.appendChild(ol);
    box.appendChild(d);
  });
}
function renderRules(){
  const host = role === 'host', cur = host ? '' : hostWant;
  document.querySelectorAll('#l-rlist details.rcard').forEach(d => {
    const on = !!cur && d.dataset.g === cur;
    d.classList.toggle('now', on);
    d.querySelector('.pick').classList.toggle('hide', !on);
    if(on && !rulesTouched) d.open = true;
    else if(!rulesTouched && !host) d.open = false;
  });
}
// ホスト: いま選んでいるゲームを参加者に知らせる(ロビーで、ルールに「選択中」を出すため)
function bcastWant(){ if(role === 'host' && room && !solo && !curId) room.bcast({ t: 'want', want: wantGame }, false); }
buildRules();

function renderLobby(){
  const list = $('l-list'); list.textContent = '';
  roster.forEach(p => {
    const row = document.createElement('div'); row.className = 'prow';
    const a = document.createElement('span'); a.textContent = p.name;
    const right = document.createElement('span');
    const tag = document.createElement('small'); tag.textContent = p.id === 0 ? (solo ? 'あなた' : 'ホスト') : (p.id === myId ? 'あなた' : (solo ? 'CPU' : '')); right.appendChild(tag);
    if(role === 'host' && p.id !== 0){
      const k = document.createElement('button'); k.className = 'kick'; k.textContent = solo ? '✕ 減らす' : '✕ 外す'; k.style.marginLeft = '8px';
      k.addEventListener('click', () => { room.kick(p.id); }); right.appendChild(k);
    }
    row.appendChild(a); row.appendChild(right); list.appendChild(row);
  });
  const host = role === 'host';
  vis('l-qrbox', host && !userLocked && !solo, 'flex');
  vis('l-hostctl', host, 'flex');
  vis('l-lock', !solo); vis('l-addbot', solo && roster.length < 8);
  document.body.classList.toggle('solo', solo);
  if(!solo && document.querySelector('#l-arena button.on[data-m="1"]')) document.querySelector('#l-arena button[data-m="3"]').click();
  $('l-title').textContent = solo ? 'CPU戦' : host ? 'ロビー(ホスト)' : 'ロビー';
  $('l-lock').textContent = userLocked ? '受付を再開' : '受付を締める';
  $('l-start').disabled = !(host && roster.length >= 2);
  $('l-help').textContent = solo ? 'スマホの中だけで動くお試しモード(通信なし)。CPUの人数を決めて、ゲームを選んで開始!' : host
    ? (roster.length < 2 ? 'QRを読んでもらってね(あと' + (2 - roster.length) + '人以上)。全員同じQRでOK!' : roster.length + '人いるよ。ゲームを選んで開始! 全員そろったら「受付を締める」を押すと安心だよ。')
    : 'ホストがゲームを始めるのを待っているよ…\n待っている間に、下でルールを読んでおこう';
  document.querySelectorAll('#l-seg button').forEach(b => b.classList.toggle('on', b.dataset.g === wantGame));
  vis('l-rules', true); renderRules();
}

// =====================================================================
//  チャット・スタンプ(部屋の中なら、ロビーでもゲーム中でも使える)
//   - 参加者 → ホスト → 全員 の順に届く。ホストが送り主を決めるので、なりすましできない
//   - 連投の制限: 送る側(4回まで連続OK、2.5秒ごとに1回分回復)と、ホスト側(5回・2秒ごと)の二重
//   - スタンプと定型文は決まったものだけ。ひとことは40文字まで。画面には textContent だけで出す
// =====================================================================
const STAMPS = ['😂', '😭', '😱', '😡', '🔥', '👏', '🙏', '💀', '❤️', '🤯', '😎', '🫠'];
const PHRASES = ['ナイス!', 'やばい!', 'ずるい!', 'おしい!', 'まだまだ!', 'GG', 'たすけて', 'うそでしょ'];
const CHAT_LEN = 40, LOG_MAX = 60, RX_MAX = 8;
let chatLog = [], chatOpen = false, unread = 0, quiet = false, chatSeq = 0, chatSeen = new Set();
const myBucket = { tk: 4, at: 0 };
const hostBuckets = new Map();
function takeToken(b, cap, refillMs){
  const now = performance.now();
  b.tk = Math.min(cap, b.tk + (b.at ? (now - b.at) / refillMs : cap)); b.at = now;
  if(b.tk < 1) return false;
  b.tk -= 1; return true;
}
const inRoom = () => role === 'host' || role === 'guest';
function chatOk(k, v){
  if(k === 's') return STAMPS.includes(v);
  if(k === 'p') return PHRASES.includes(v);
  if(k === 'm') return typeof v === 'string' && clean2(v, CHAT_LEN).replace(/\s/g, '').length > 0;
  return false;
}
function chatSend(k, v){
  if(!inRoom()) return;
  if(k === 'm') v = clean2(String(v).replace(/\n/g, ' '), CHAT_LEN).trim();
  if(!chatOk(k, v)) return;
  if(!takeToken(myBucket, 4, 2500)){ chatHint('連投しすぎ! ちょっと待ってね'); return; }
  chatHint('');
  const o = { t: 'chat', k, v };
  if(role === 'host') hostChat(0, o); else if(guest) guest.send(o, true);
}
// ホスト: 届いたチャットを確かめて、全員に配る
function hostChat(id, o){
  if(role !== 'host' || !o || !chatOk(o.k, o.v)) return;
  let b = hostBuckets.get(id); if(!b){ b = { tk: 5, at: 0 }; hostBuckets.set(id, b); }
  if(id !== 0 && !takeToken(b, 5, 2000)) return;                  // 連投は捨てる
  const m = { t: 'chat', id, k: o.k, v: o.k === 'm' ? clean2(o.v, CHAT_LEN) : o.v, n: ++chatSeq };
  if(room) room.bcast(m, true);
  onChat(m);
}
function onChat(m){
  if(!m || !Number.isInteger(m.id) || !Number.isInteger(m.n) || !chatOk(m.k, m.v)) return;
  if(chatSeen.has(m.n)) return;                                  // 2回届いた分は無視
  chatSeen.add(m.n); if(chatSeen.size > 300) chatSeen = new Set(Array.from(chatSeen).slice(-150));
  const v = m.k === 'm' ? clean2(m.v, CHAT_LEN) : m.v, me = m.id === myId, name = nameOf(m.id);
  chatLog.push({ id: m.id, name, k: m.k, v, me }); if(chatLog.length > LOG_MAX) chatLog.shift();
  if(chatOpen) renderChatLog();
  if(!quiet && (m.k === 's' || m.k === 'p')) floatReact(name, m.k, v);
  if(!quiet && m.k === 'm' && !chatOpen && !me) toast(name, v);
  if(!chatOpen && !me && (m.k === 'm' || quiet)){ unread++; renderBadge(); }
}
function chatHint(t){ $('chat-hint').textContent = t || ''; }
function renderBadge(){ const b = $('chat-badge'); b.textContent = unread > 9 ? '9+' : String(unread); b.classList.toggle('hide', unread <= 0); }
function renderChatLog(){
  const box = $('chat-log'); box.textContent = '';
  if(!chatLog.length){ const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'まだメッセージはないよ'; box.appendChild(e); return; }
  chatLog.forEach(x => {
    const d = document.createElement('div'); d.className = 'cm' + (x.me ? ' me' : '');
    const b = document.createElement('b'); b.textContent = x.me ? 'あなた' : x.name; d.appendChild(b);
    const s = document.createElement('span'); s.textContent = x.v; if(x.k === 's') s.className = 'em'; d.appendChild(s);
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}
function toast(name, text){
  const box = $('toasts');
  while(box.children.length >= 3) box.firstElementChild.remove();
  const t = document.createElement('div'); t.className = 'toast';
  const b = document.createElement('b'); b.textContent = name; const s = document.createElement('span'); s.textContent = text;
  t.appendChild(b); t.appendChild(s); box.appendChild(t);
  vibrate(15);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3200);
}
function floatReact(name, k, v){
  const box = $('rx');
  while(box.children.length >= RX_MAX) box.firstElementChild.remove();
  const d = document.createElement('div'); d.className = 'rx';
  const e = document.createElement('span'); e.className = k === 's' ? 'e' : 'p'; e.textContent = v; d.appendChild(e);
  const n = document.createElement('span'); n.className = 'n'; n.textContent = name; d.appendChild(n);
  d.style.left = (8 + Math.random() * 64) + '%';
  box.appendChild(d);
  setTimeout(() => d.remove(), 2700);
}
function openChat(on){
  chatOpen = !!on && inRoom() && !quiet;
  ['chat-sheet', 'chat-bg'].forEach(id => $(id).classList.toggle('hide', !chatOpen));
  if(chatOpen){ unread = 0; renderBadge(); renderChatLog(); chatHint(''); }
  else $('chat-text').blur();
}
// ゲームが「いまは静かにして」と言っているあいだ(DRAW の合図待ちなど)は、スタンプやバナーを出さない
function setQuiet(on){ quiet = !!on; if(quiet) openChat(false); $('chat-btn').style.opacity = quiet ? '.25' : ''; }
function chatReset(){ chatLog = []; chatSeen = new Set(); unread = 0; chatSeq = 0; hostBuckets.clear(); quiet = false; openChat(false); renderBadge(); $('toasts').textContent = ''; $('rx').textContent = ''; $('chat-btn').style.opacity = ''; }
window.__chatVis = id => { $('chat-btn').classList.toggle('hide', !inRoom() || id === 's-menu' || id === 's-scan'); if(id === 's-menu' || id === 's-scan') openChat(false); };
(function(){
  const sb = $('chat-stamps'), pb = $('chat-phr');
  STAMPS.forEach(s => { const b = document.createElement('button'); b.textContent = s; b.addEventListener('click', () => chatSend('s', s)); sb.appendChild(b); });
  PHRASES.forEach(s => { const b = document.createElement('button'); b.textContent = s; b.addEventListener('click', () => chatSend('p', s)); pb.appendChild(b); });
  const sendText = () => { const i = $('chat-text'); if(!i.value.trim()) return; chatSend('m', i.value); i.value = ''; };
  $('chat-send').addEventListener('click', sendText);
  $('chat-text').addEventListener('keydown', e => { if(e.key === 'Enter' && !e.isComposing){ e.preventDefault(); sendText(); } });
  $('chat-btn').addEventListener('click', () => openChat(!chatOpen));
  $('chat-bg').addEventListener('click', () => openChat(false));
  $('chat-x').addEventListener('click', () => openChat(false));
})();

// =====================================================================
//  ホスト
// =====================================================================
function hostLeave(p, why){
  roster = roster.filter(r => r.id !== p.id);
  if(game && game.hostOnLeave) game.hostOnLeave(p.id);
  pushRoster();
  if(why !== 'kicked') flashBanner(p.name + ' が抜けたよ', 3000);
  if(curId && roster.length < 2) toLobby('人数が足りなくなったので、ロビーにもどるよ');
}
// ---------- ひとりで試す(CPU戦): 通信の代わりに、スマホの中のCPUとやり取りする ----------
function soloRoom(){
  const S = { peers: new Map(), locked: true, qr: '', solo: true, next: 1 };
  const deliver = (p, obj) => { const o = JSON.parse(JSON.stringify(obj)); setTimeout(() => { if(S.peers.get(p.id) === p) p.bot.recv(o); }, p.lat); };
  S.sendTo = (id, obj) => { const p = S.peers.get(id); if(p) deliver(p, obj); };
  S.bcast = obj => { S.peers.forEach(p => deliver(p, obj)); };
  S.add = () => {
    if(S.peers.size >= 7) return;
    let id = 1; while(S.peers.has(id)) id++;
    const p = { id, name: 'CPU' + id, lat: 25 + Math.floor(Math.random() * 40), rtt: 0 };
    p.rtt = p.lat * 2;
    p.bot = window.NomiBots.make(id, obj => {
      const o = JSON.parse(JSON.stringify(obj)); o.g = curId;
      setTimeout(() => { if(S.peers.get(id) !== p || role !== 'host') return; if(o && o.g && o.g === curId && game && game.hostOnMsg) game.hostOnMsg(id, o); }, p.lat);
    }, obj => {
      const o = JSON.parse(JSON.stringify(obj));
      setTimeout(() => { if(S.peers.get(id) !== p || role !== 'host') return; hostChat(id, o); }, p.lat);
    });
    S.peers.set(id, p);
  };
  S.kick = id => { const p = S.peers.get(id); if(!p) return; S.peers.delete(id); p.bot.stop(); hostLeave(p, 'kicked'); };
  S.setLocked = () => {};
  S.close = () => { S.peers.forEach(p => p.bot.stop()); S.peers.clear(); };
  return S;
}
function soloCreate(){
  chatReset();
  role = 'host'; myId = 0; curId = null; game = null; userLocked = true; solo = true;
  room = soloRoom();
  for(let i = 0; i < 3; i++) room.add();
  roster = [{ id: 0, name: myName, rtt: 0 }];
  keepAwake(); pushRoster(); renderLobby(); show('s-lobby');
}
async function hostCreate(){
  chatReset();
  role = 'host'; myId = 0; curId = null; game = null; userLocked = false; solo = false;
  roster = [{ id: 0, name: myName, rtt: 0 }];
  try{
    room = await R.host({
      onNet,
      onJoin: p => { pushRoster(); flashBanner(p.name + ' が参加したよ', 2500); vibrate(60); },
      onLeave: hostLeave,
      onMsg: (id, o) => { if(o && o.t === 'chat'){ hostChat(id, o); return; } if(o && o.g && o.g === curId && game && game.hostOnMsg) game.hostOnMsg(id, o); }
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
  room.bcast({ t: 'roster', players: roster, want: wantGame }, true);
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
  game = null; curId = null; guest = null; role = null; resetFx(); $('picker').classList.remove('on'); hideBanner(); chatReset();
}
function guestMsg(o){
  if(!o || typeof o.t !== 'string') return;
  if(o.t === 'roster' && Array.isArray(o.players)){
    roster = o.players.filter(p => p && Number.isInteger(p.id)).slice(0, 8).map(p => ({ id: p.id, name: clean(p.name) || '?', rtt: Number.isFinite(p.rtt) ? p.rtt : 0 }));
    if(RULES.some(x => x.g === o.want)) hostWant = o.want;
    if($('s-lobby').classList.contains('active')) renderLobby();
  }else if(o.t === 'begin' && typeof o.g === 'string' && window.NomiGames[o.g]){
    if(game && game.stop) game.stop();
    curId = o.g; document.body.dataset.game = o.g; game = window.NomiGames[o.g].make(E); audio.init(); keepAwake(); hideBanner(); game.onBegin();
  }else if(o.t === 'chat'){
    onChat(o);
  }else if(o.t === 'want'){
    if(RULES.some(x => x.g === o.want)){ hostWant = o.want; if($('s-lobby').classList.contains('active')) renderRules(); }
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
function setWant(g){ wantGame = g; if(!curId) document.body.dataset.game = g; document.querySelectorAll('#seg-game button, #l-seg button').forEach(b => b.classList.toggle('on', b.dataset.g === g)); $('l-arena').classList.toggle('hide', g !== 'arena'); $('l-core').classList.toggle('hide', g !== 'core'); bcastWant(); }
// ARENA の育成タイム
(function(){
  let m = '5'; try{ m = localStorage.getItem('arena-min') || '5'; }catch(e){}
  const bs = document.querySelectorAll('#l-arena button[data-m]');
  const set = v => { bs.forEach(b => b.classList.toggle('on', b.dataset.m === v)); try{ localStorage.setItem('arena-min', v); }catch(e){} };
  if(!Array.from(bs).some(b => b.dataset.m === m)) m = '5';
  set(m); bs.forEach(b => b.addEventListener('click', () => set(b.dataset.m)));
  // 決めるのは: 優勝 / 最下位(負け残りトーナメント)
  let v = 'top'; try{ v = localStorage.getItem('arena-mode') || 'top'; }catch(e){}
  const vs = document.querySelectorAll('#l-arena button[data-v]');
  const setV = x => { vs.forEach(b => b.classList.toggle('on', b.dataset.v === x)); try{ localStorage.setItem('arena-mode', x); }catch(e){} };
  setV(v === 'last' ? 'last' : 'top'); vs.forEach(b => b.addEventListener('click', () => setV(b.dataset.v)));
})();
// CORE: 見ている人(コアを持っていない人)の音
(function(){
  let w = 'normal'; try{ w = localStorage.getItem('core-watch') || 'normal'; }catch(e){}
  const bs = document.querySelectorAll('#l-core button[data-w]');
  const set = x => { bs.forEach(b => b.classList.toggle('on', b.dataset.w === x)); try{ localStorage.setItem('core-watch', x); }catch(e){} };
  set(['normal', 'low', 'off'].includes(w) ? w : 'normal'); bs.forEach(b => b.addEventListener('click', () => set(b.dataset.w)));
})();
document.querySelectorAll('#seg-game button').forEach(b => b.addEventListener('click', () => setWant(b.dataset.g)));
document.querySelectorAll('#l-seg button').forEach(b => b.addEventListener('click', () => setWant(b.dataset.g)));
setWant(wantGame);

$('b-host').addEventListener('click', () => { saveName(); audio.init(); hostCreate(); });
$('b-join').addEventListener('click', () => { saveName(); audio.init(); guestBegin(); });
$('b-solo').addEventListener('click', () => { saveName(); audio.init(); soloCreate(); });
$('l-addbot').addEventListener('click', () => { if(solo && room){ room.add(); pushRoster(); } });
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
  room = null; guest = null; game = null; curId = null; role = null; roster = []; solo = false; resetFx(); chatReset();
  document.body.classList.remove('solo');
  $('picker').classList.remove('on'); hideBanner(); show('s-menu');
  if(newVer) location.reload();
}
// 新しい版が届いたら読み込み直す(部屋に入っている間は待って、抜けたときに)
let newVer = false;
if('serviceWorker' in navigator){
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(!had) return;
    if(!room && !guest) location.reload(); else newVer = true;
  });
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
}
document.addEventListener('gesturestart', e => e.preventDefault());
window.addEventListener('pagehide', stopScan);
})();
