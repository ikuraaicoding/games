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
function show(id){ if(id === 's-menu'){ const f = document.getElementById('cf'); if(f) f.classList.remove('on'); } const was = document.querySelector('.screen.active'); if(!was || was.id !== id){ const c = document.getElementById('a-cat'); if(c) c.classList.remove('on'); document.body.classList.remove('catopen'); } document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); if(window.__chatVis) window.__chatVis(id); }
function vis(id, on, disp){ const e = $(id); e.classList.remove('hide'); e.style.display = on ? (disp || 'block') : 'none'; }
function vibrate(p){ try{ if(navigator.vibrate) navigator.vibrate(p); }catch(e){} }
function qrSize(){ return Math.min(window.innerWidth - 80, 300); }

// ---------- 設定(端末内) ----------
let myName = '';
try{ myName = clean(localStorage.getItem('nomi-name') || ''); }catch(e){}
$('name').value = myName;
let wantGame = ({ '#tap': 'tap', '#stop': 'stop', '#ise': 'ise', '#flip': 'flip', '#uniq': 'uniq', '#face': 'face', '#twist': 'twist', '#trace': 'trace', '#arena': 'arena', '#race': 'race', '#mix': 'mix' })[location.hash] || 'core';

// ---------- 音 ----------
// 音の出口は sound.js がまとめて持つ(画面から抜けると作り直されるので、使うたびに取り直す)
let ac = null;
let sndAt = -1e9;                 // 最後に音を出そうとした時刻(ボタンの音が二重にならないように使う)
const live = () => { sndAt = performance.now(); if(window.NomiSound) ac = window.NomiSound.get(); return ac; };
const audio = {
  init(){ if(window.NomiSound){ ac = window.NomiSound.open(); return; } if(!ac){ const AC = window.AudioContext || window.webkitAudioContext; if(AC) ac = new AC(); } if(ac && ac.state !== 'running') ac.resume(); },
  heartbeat(vol){
    if(!live()) return; const t = ac.currentTime;
    [[58, 0, .22, .6], [46, .16, .2, .4]].forEach(([f, d, len, g]) => {
      const o = ac.createOscillator(), gn = ac.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f, t + d);
      gn.gain.setValueAtTime(.0001, t + d); gn.gain.exponentialRampToValueAtTime(g * vol, t + d + .02); gn.gain.exponentialRampToValueAtTime(.0001, t + d + len);
      o.connect(gn); gn.connect(ac.destination); o.start(t + d); o.stop(t + d + len + .05);
    });
  },
  drone: null,
  startDrone(){
    if(this.drone && this.drone.ac !== live()) this.drone = null;      // 作り直されていたら、前のは閉じて鳴っていない
    if(!live() || this.drone) return; const t = ac.currentTime;
    const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); f.type = 'lowpass'; f.frequency.setValueAtTime(140, t);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.16, t + .4);
    o.connect(f); f.connect(g); g.connect(ac.destination); o.start(t); this.drone = { ac, o, f, g };
  },
  updateDrone(sec){ if(!this.drone || this.drone.ac.state === 'closed') return; const t = this.drone.ac.currentTime, s = Math.min(sec, 12); this.drone.o.frequency.setTargetAtTime(38 + s * 3.5, t, .1); this.drone.f.frequency.setTargetAtTime(140 + s * 40, t, .1); },
  stopDrone(){ if(!this.drone) return; const d = this.drone; this.drone = null; if(d.ac.state === 'closed') return; const t = d.ac.currentTime; d.g.gain.cancelScheduledValues(t); d.g.gain.setTargetAtTime(.0001, t, .05); d.o.stop(t + .3); },
  boom(v){
    const k = v === undefined ? 1 : v;
    if(!live() || k <= 0) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 1.2);
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
    if(!live() || k <= 0) return; const t = ac.currentTime, len = Math.floor(ac.sampleRate * 0.5);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for(let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const n = ac.createBufferSource(), ng = ac.createGain(); n.buffer = buf;
    ng.gain.setValueAtTime(1.4 * k, t); ng.gain.exponentialRampToValueAtTime(.001, t + .5); n.connect(ng); ng.connect(ac.destination); n.start(t);
    const o = ac.createOscillator(), og = ac.createGain(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(60, t + .25);
    og.gain.setValueAtTime(.5 * k, t); og.gain.exponentialRampToValueAtTime(.001, t + .3); o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t + .35);
  },
  beep(freq, len, vol){
    if(!live()) return; const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
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
let roster = [];                    // [{id,name,rtt,aw}]  aw = しばらく通信が届いていない
const bench = new Set();            // ゲームの途中で通信がもどってきた人(そのゲームには参加せず、次のゲームから)
let curId = null, game = null, lastGame = null, userLocked = false, solo = false;
// ゲームの番号(ホストがゲームを始めるたびに1つ増える)。参加者は、始まりの合図より先に届いたゲームの知らせを、合図が来るまでとっておく
//  (一人ずつに送る知らせは、全員あての合図より先に着くことがある。捨てると、相手の画面が「準備中」のまま止まる)
let gameNo = 0, curGn = 0;
const early = [];                   // [{ o, at }] 始まりの合図より先に届いた知らせ
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
  players: () => roster.filter(p => !bench.has(p.id)),
  send(obj, rel){ obj.g = curId; obj.gn = role === 'host' ? gameNo : curGn; if(role === 'host'){ if(game && game.hostOnMsg) game.hostOnMsg(0, obj); } else if(guest) guest.send(obj, !!rel); },
  hostSend(id, obj, rel){ obj.g = curId; obj.gn = gameNo; if(id === 0){ if(game && game.onMsg) game.onMsg(obj); } else if(room) room.sendTo(id, obj, !!rel); },
  hostBcast(obj, rel){ obj.g = curId; obj.gn = gameNo; if(room) room.bcast(obj, !!rel); if(game && game.onMsg) game.onMsg(obj); },
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
    $('r-extra').textContent = '';
    const host = role === 'host';
    vis('r-again', host); vis('r-lobby', host);
    $('r-again').textContent = !mix ? 'もう一回' : mix.n === 1 ? 'もう一回抽選' : mix.k >= mix.n ? '最終結果へ' : '途中経過へ';
    $('r-lobby').textContent = mix && mix.n > 1 ? 'ロビーにもどる(連戦をやめる)' : 'ロビーにもどる(ゲームを選ぶ)';
    // ボタンは結果を出してから少し待って出す。hold のときは、ゲームが発表を終えてから resultBtns() で出す
    lateBtns(R_BTNS, o.hold ? -1 : LATE_MS);
    show('s-result');
  },
  resultBtns(ms){ lateBtns(R_BTNS, Number.isFinite(ms) ? ms : LATE_MS); },
  // ホスト: ゲームの順位を知らせる(MIX の点数に使う)。groups = 上の順位から [[id, ...], [id], ...](同じ組は同じ順位)
  // 負けた人だけが決まるゲームは [[ほかの人…], [負けた人…]](2つめの 'lose' は目印。点数は同じ計算)
  rank(groups){ mixRank(groups); }
};

// ---------- 結果画面のボタンは、少し待ってから出す ----------
// ゲームの終わりに画面を連打していて、出てきたボタンをまちがえて押さないように
const R_BTNS = ['r-again', 'r-lobby', 'r-quit'], M_BTNS = ['m-next', 'm-lobby', 'm-quit'], LATE_MS = 1200;
let lateSeq = 0;
function lateBtns(ids, ms){
  const my = ++lateSeq;
  ids.forEach(id => { const b = $(id); b.classList.remove('appear'); b.classList.add('late'); });
  if(ms < 0) return;
  setTimeout(() => {
    if(my !== lateSeq) return;
    ids.forEach(id => { const b = $(id); b.classList.remove('late'); b.classList.add('appear'); });
    setTimeout(() => { if(my === lateSeq) ids.forEach(id => $(id).classList.remove('appear')); }, 450);
  }, ms);
}

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
  { g: 'uniq', nm: 'UNIQUE', sub: '数字かぶり', ic: 'i-uniq', r: [
    '全員が 1〜人数 の数字カードを1枚ずつ持つ(4人なら 1・2・3・4)',
    '毎ターン、10秒以内にカードを1枚えらんで、全員いっせいに出す',
    'ほかの人とかぶっていない数字のうち、いちばん大きい数字を出した人が勝ち抜け',
    '出したカードは、このゲームではもう使えない',
    '全員かぶって、だれも抜けられなかったら、カードを手札にもどしてやり直し',
    '10秒以内にえらばなかった人は、手札でいちばん小さいカードが自動で出る',
    '抜けた順に順位がつく。最後に残った人がビリ'] },
  { g: 'arena', nm: 'ARENA', sub: '育成バトル', ic: 'i-arena', r: [
    '育成タイム(1〜10分)の間にパーティを強くする。最初は全員「攻3 防3 HP3」のキャラ1体',
    '10秒ごとに行動が1回たまる(ハードモードは5秒ごと。最大3回。満タンのままだと、あふれて無駄になる)',
    '行動ごとに「キャラガチャ」「装備ガチャ」「スキル強化」から1つ選ぶ。パーティは最大3体(5体バトルなら5体)',
    'キャラは一番高いステに合ったスキルを持つ(攻→攻撃スキル、防→防御スキル、HP→回復・粘りスキル)',
    '武器は 剣(攻+)・盾(防+)・護符(HP+)。上がるステと同じ系統の特殊効果がつく',
    '5体バトルは、育成タイム5分以上(ハードなら3分以上)のときにホストが選べる',
    '時間切れで、ランダムなトーナメント。戦闘は自動',
    '試合中にできるのは、各キャラのスキルを使うタイミングを選ぶことだけ(1試合1回)',
    'ホストの設定で「優勝を決める」か「最下位を決める(負け残り)」かが変わる'] },
  { g: 'race', nm: 'RACE', sub: '育成レース', ic: 'i-race', r: [
    '最初に車の種類を選ぶ。バランス型(最高速3・加速3・コーナー3)/ 最高速型(5・2・2)/ 加速型(2・5・2)/ コーナー型(2・2・5)。レースでの見た目も変わる',
    'つぎに、ランダムな4つのスキルから1つ選ぶ(レース中に自動で発動)',
    'ガレージタイム(1〜5分)の間に車をきたえる。体力100からスタート',
    '10秒ごとに行動が1回たまる(ハードモードは5秒ごと)。ためておけるのは1回だけで、使わないまま次がたまると、あふれて無駄になる',
    '行動は「エンジン強化(最高速)」「ターボ強化(加速)」「タイヤ強化(コーナー)」「休む」の4つ',
    '強化は成功で+2、失敗で−1。体力を20〜30使う。体力が60を切るとゲージが黄色になり、失敗することがある',
    '休むと体力が30〜50回復する',
    '使う体力・回復する体力は、行動のたびに変わる(ボタンに出る)',
    'ときどき強化のどれか1つが「好調」になる。好調の強化は成功で+4',
    'コースはレースの直前に発表(運)。スキル選びのときに天気予報(雨の確率)が出る。予報ははずれることもある。レースは全員同時。操作はニトロを押すタイミングだけ(1レース1回)',
    'ゴール順にポイント(10・7・5・4・3・2・1・0)。1戦か3戦の合計で順位が決まる',
    'ホストの設定で「優勝を決める」か「最下位を決める」かが変わる'] },
  { g: 'flip', nm: 'FLIP', sub: '数字めくり', ic: 'i-flip', r: [
    '1〜30の数字が書かれたカードが30枚、ばらばらに並ぶ',
    '最初の30秒だけ、全部のカードが表向き。どこに何があるか覚えよう',
    '裏返ったら、1から順番にめくっていく。めくる人は1枚ごとにランダムに指名される(みんなの回数はかたよらない)',
    '指名された人は10秒以内に、次の数字のカードをめくる',
    'まちがえたら、その場でアウト。まちがえたカードはみんなに見せてから裏にもどる。次の人は同じ数字から',
    '時間切れもアウト',
    '最後の1人になったら、その人の勝ち。30枚ぜんぶめくれたら、残っている人は全員1位',
    '先にアウトになった人ほど、下の順位'] },
  { g: 'face', nm: 'FACE', sub: 'おでこカード', ic: 'i-face', r: [
    '1〜13の数字が1人1枚配られる(全員ちがう数字)',
    '自分の画面には、ほかの全員の数字が見える。自分の数字だけ見えない',
    '20秒で「勝負」か「降りる」をこっそり選ぶ(時間までは変えられる。決めないと降りる)',
    '勝負した人どうしで1人ずつ比べる。自分より小さい人1人につき+2点、大きい人1人につき−2点。降りた人は点が動かない',
    '口で何を言ってもいい(うそも作戦)。ただし、自分の画面を人に見せるのは禁止',
    '全5回。はじめは20点。点の多い順に順位'] },
  { g: 'twist', nm: 'TWIST', sub: 'ひっかけ早押し', ic: 'i-twist', r: [
    '全員同時に、同じ12問を解く早押しレース',
    '問題は「色」「向き」「数」の3種類。上に出る お題 に答える',
    '色: お題が「色は?」なら字の色、「文字は?」なら書いてある言葉 / 向き: 「向きは?」なら矢印の向き、「場所は?」なら矢印がある場所 / 数: 「いくつ?」なら並んでいる数、「数字は?」ならその数字',
    'お題は問題ごとに変わる(ここがひっかけ)',
    'まちがえると1秒タップできない(おてつき)。正解するまで次へ進めない',
    '12問を終えるまでの時間が短い順。40秒で終わり(終わらなかった人は、正解の数で順位)',
    '時間は自分のスマホの中で測るので、通信の遅れは関係ない'] },
  { g: 'trace', nm: 'TRACE', sub: 'なぞり耐久', ic: 'i-trace', r: [
    'スタートまでに、画面の輪の中に指を置く',
    '輪がくねくね動く。指を離さず、輪からはみ出さないように追いかける',
    '輪はだんだん速く、小さくなり、カーブもきつくなる',
    '輪から出て0.1秒たつか、指を離すとアウト',
    '最後まで残った人の勝ち。先にアウトになった人ほど下の順位(60秒耐えたら、残った人は全員1位)',
    '輪の動きは全員同じ。アウトの判定は自分のスマホの中なので、通信の遅れは関係ない'] },
  { g: 'mix', nm: 'MIX', sub: 'ミニゲーム連戦', ic: 'i-mix', r: [
    'ミニゲームの中から、遊ぶゲームをランダムに抽選する',
    '1戦(抽選だけ)/ 3戦 / 5戦 / 7戦 から選べる',
    '同じゲームは続けて出ない(全部のゲームが1回ずつ出たら、また最初から抽選)',
    '毎回の順位でポイント。N人なら 1位はN−1点、1つ下がるごとに1点へって、最下位は0点',
    '同じ順位の人が何人かいたら、その人たちがしめる順位の点の平均(切り捨て)。ただし最下位の人たちは0点',
    '例: DRAW・CORE は負けた人が0点、ほかの人は全員「人数÷2(切り捨て)」点(4人なら2点、6人なら3点)',
    '合計ポイントで最終順位が決まる(同点は同じ順位)'] }
];
// ミニゲーム(MIX の抽選に入る)。ミニゲームを足すときは、ここと RULES に入れて、ホスト側で結果が出たときに E.rank() を呼ぶ
const MINI = ['tap', 'stop', 'ise', 'core', 'flip', 'uniq', 'face', 'twist', 'trace'];
let hostWant = '';                 // 参加者側: ホストがいま選んでいるゲーム
let rulesTouched = false;          // 参加者が自分でルールを開いたか(開いたら、勝手に開き直さない)
function buildRules(){
  const box = $('l-rlist'); box.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (id, cls) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); const u = document.createElementNS(NS, 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s; };
  const isMini = g => MINI.includes(g) || g === 'mix';
  const list = RULES.filter(x => !isMini(x.g)).concat(RULES.filter(x => isMini(x.g)));
  list.forEach(x => {
    if(x.g === MINI[0]){ const h = document.createElement('div'); h.className = 'rl-h'; h.textContent = 'MINI GAMES'; const sm = document.createElement('small'); sm.textContent = 'ミニゲーム'; h.appendChild(sm); box.appendChild(h); }
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
    if(x.g === 'arena' || x.g === 'race'){
      const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'cat-open'; cb.textContent = x.g === 'arena' ? 'スキルと武器の一覧を見る' : 'ステータスとスキルの一覧を見る';
      cb.addEventListener('click', () => window.NomiGames[x.g].showCatalog()); d.appendChild(cb);
    }
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
    const tag = document.createElement('small'); tag.textContent = (p.aw ? '通信待ち… ' : '') + (p.id === 0 ? (solo ? 'あなた' : 'ホスト') : (p.id === myId ? 'あなた' : (solo ? 'CPU' : ''))); right.appendChild(tag);
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
  roster = roster.filter(r => r.id !== p.id); bench.delete(p.id);
  if(game && game.hostOnLeave) game.hostOnLeave(p.id);
  pushRoster();
  if(why !== 'kicked') flashBanner(p.name + ' が抜けたよ', 3000);
  if((curId || mix) && roster.length < 2) toLobby('人数が足りなくなったので、ロビーにもどるよ');
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
      onJoin: (p, back) => {
        // 通信が切れて外れていた人がもどってきた。ゲームの途中なら、そのゲームには入れず次から
        if(back && curId){ bench.add(p.id); room.sendTo(p.id, { t: 'lobby', why: '通信が切れていた間にゲームが進んだので、次のゲームから参加してね' }, true); }
        pushRoster(); flashBanner(p.name + (back ? ' がもどってきたよ' : ' が参加したよ'), 2500); vibrate(60);
      },
      onLeave: hostLeave,
      onMsg: (id, o) => { if(o && o.t === 'chat'){ hostChat(id, o); return; } if(o && o.g && o.g === curId && (!isGn(o.gn) || o.gn === gameNo) && game && game.hostOnMsg) game.hostOnMsg(id, o); }   // 前のゲームの操作は使わない
    });
  }catch(e){ role = null; flashBanner('部屋を作れなかった: ' + e.message, 5000); return; }
  drawQR(room.qr, $('l-qr'), qrSize()); $('l-code').value = room.qr;
  keepAwake(); renderLobby(); show('s-lobby');
  setInterval(() => { if(role === 'host' && room) refreshRtt(); }, 3000);
}
function refreshRtt(){
  let ch = false;
  roster.forEach(r => {
    const p = room.peers.get(r.id); if(!p) return;
    if(p.rtt !== r.rtt){ r.rtt = p.rtt; ch = true; }
    const aw = room.away && room.away(r.id) ? 1 : 0; if(aw !== (r.aw || 0)){ r.aw = aw; ch = true; if($('s-lobby').classList.contains('active')) renderLobby(); }
  });
  if(ch) room.bcast({ t: 'roster', players: roster }, false);
}
function pushRoster(){
  roster = [{ id: 0, name: myName, rtt: 0 }].concat(Array.from(room.peers.values()).map(p => ({ id: p.id, name: p.name, rtt: p.rtt, aw: room.away && room.away(p.id) ? 1 : 0 })));
  room.bcast({ t: 'roster', players: roster, want: wantGame }, true);
  if($('s-lobby').classList.contains('active')) renderLobby();
}
function startGame(gid){
  if(gid === 'mix'){ mixStart(); return; }
  if(role !== 'host' || roster.length < 2 || !window.NomiGames[gid]) return;
  if(game && game.stop) game.stop();
  room.setLocked(true); bench.clear();
  curId = gid; lastGame = gid; document.body.dataset.game = gid; gameNo++; game = window.NomiGames[gid].make(E);
  room.bcast({ t: 'begin', g: gid, gn: gameNo }, true);
  audio.init(); keepAwake();
  game.onBegin(); game.hostStart();
}
function toLobby(why){
  if(game && game.stop) game.stop();
  game = null; curId = null; mixEnd(); resetFx();
  if(role === 'host'){ room.setLocked(userLocked); room.bcast({ t: 'lobby', why: why || '' }, true); if(bench.size){ bench.clear(); pushRoster(); } }
  $('picker').classList.remove('on');
  renderLobby(); show('s-lobby');
  if(why) flashBanner(why, 4000);
}
// =====================================================================
//  MIX: ミニゲームを抽選して連戦する(合計ポイントで勝負)
//   - ホストが抽選と点数の計算をして、結果だけを全員に配る
// =====================================================================
let mix = null;                     // ホスト: { n, k, bag, last, gid, add, pts, names, hist } / 参加者: { n, k }
let mixT = null, drawSeq = 0;
const DRAW_MS = 2600, DRAW_HOLD = 1400;   // ルーレットの長さ / 止まってからゲームが始まるまで
const ruleOf = g => RULES.find(x => x.g === g) || { nm: '?', sub: '', ic: 'i-mix' };
function mixN(){ const b = document.querySelector('#l-mix button.on'); const n = b ? +b.dataset.k : 3; return [1, 3, 5, 7].includes(n) ? n : 3; }
function mixEnd(){ mix = null; clearTimeout(mixT); drawSeq++; FXN.show(false); }
function mixStart(){
  if(role !== 'host' || roster.length < 2) return;
  mixEnd();
  mix = { n: mixN(), k: 0, bag: [], last: '', gid: '', add: null, pts: new Map(), names: new Map(), hist: [] };
  room.setLocked(true);
  mixDraw();
}
// 抽選: 全部のゲームが1回ずつ出るまでは、同じゲームは出ない。続けて同じゲームにもならない
function mixPick(){
  if(!mix.bag.length){
    const b = MINI.slice();
    for(let i = b.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; }
    if(b.length > 1 && b[0] === mix.last){ const j = 1 + Math.floor(Math.random() * (b.length - 1)); const t = b[0]; b[0] = b[j]; b[j] = t; }
    mix.bag = b;
  }
  return mix.bag.shift();
}
function mixDraw(){
  if(role !== 'host' || !mix || roster.length < 2) return;
  if(game && game.stop) game.stop();
  game = null; curId = null; FXN.show(false);
  const g = mixPick(); mix.last = g; mix.gid = g; mix.k++; mix.add = null;
  roster.forEach(r => { mix.names.set(r.id, r.name); if(!mix.pts.has(r.id)) mix.pts.set(r.id, 0); });
  room.bcast({ t: 'mix', st: 'draw', k: mix.k, n: mix.n, g }, true);
  showDraw(mix.k, mix.n, g);
  const k = mix.k;
  clearTimeout(mixT); mixT = setTimeout(() => { if(role === 'host' && mix && mix.k === k && !curId) startGame(g); }, DRAW_MS + DRAW_HOLD);
}
// ゲームから届いた順位を点数にする(N人なら 1位 N−1点 … 最下位 0点)
// 同じ組の人は、その組がしめる順位の点の平均(切り捨て)。最下位の組は0点。組が1つだけなら決着なしで全員0点
//  → 負けた人だけ決まるゲームは、ほかの人が N÷2(切り捨て)点になる
function mixRank(groups){
  if(role !== 'host' || !mix || curId !== mix.gid || !Array.isArray(groups)) return;
  const seen = new Set();
  const gs = groups.map(g => (Array.isArray(g) ? g : []).filter(id => Number.isInteger(id) && !seen.has(id) && !!seen.add(id))).filter(g => g.length);
  const n = seen.size, add = new Map();
  let ahead = 0;
  gs.forEach((g, i) => {
    const p = gs.length < 2 || i === gs.length - 1 ? 0 : Math.floor(n - 1 - ahead - (g.length - 1) / 2);
    g.forEach(id => add.set(id, p)); ahead += g.length;
  });
  mix.add = add;
}
// 合計の一覧(同点は同じ順位)
function mixRows(){
  const rows = Array.from(mix.pts.keys()).map(id => ({ id, nm: mix.names.get(id) || nameOf(id), add: mix.add && mix.add.has(id) ? mix.add.get(id) : 0, tot: mix.pts.get(id) || 0 }));
  rows.sort((a, b) => b.tot - a.tot || a.id - b.id);
  rows.forEach((r, i) => { r.pl = i > 0 && rows[i - 1].tot === r.tot ? rows[i - 1].pl : i + 1; });
  return rows;
}
function mixBoard(){
  if(role !== 'host' || !mix || !mix.gid) return;
  if(game && game.stop) game.stop();
  game = null; curId = null;
  if(mix.add) mix.add.forEach((p, id) => { mix.pts.set(id, (mix.pts.get(id) || 0) + p); });
  mix.hist.push(mix.gid); mix.gid = '';
  const fin = mix.k >= mix.n, rows = mixRows().slice(0, 16);
  const o = { t: 'mix', st: 'board', k: mix.k, n: mix.n, fin, hist: mix.hist.slice(), rows };
  room.bcast(o, true);
  showBoard(o);
}
function mixScreen(){ document.body.dataset.game = 'mix'; $('picker').classList.remove('on'); resetFx(); show('s-mix'); }
function mixButtons(mode){
  const host = role === 'host';
  vis('m-next', host && mode !== 'draw'); vis('m-lobby', host && mode !== 'draw'); vis('m-quit', mode !== 'draw');
}
function showDraw(k, n, g){
  const my = ++drawSeq;
  mixScreen(); mixButtons('draw');
  $('m-eye').textContent = 'MIX';
  $('m-title').textContent = n === 1 ? '抽選' : '第' + k + '戦 / ' + n + '戦';
  $('m-sub').textContent = 'ゲームを抽選中…';
  ['m-lines', 'm-pen', 'm-hist', 'm-wait'].forEach(id => { $(id).textContent = ''; });
  const box = $('m-draw'); box.style.display = '';
  const put = (x, cls) => {
    const r = ruleOf(x); box.className = 'mdraw g-' + x + (cls ? ' ' + cls : '');
    $('m-use').setAttribute('href', '#' + r.ic);
    $('m-nm').textContent = r.nm; $('m-ds').textContent = cls === 'land' ? r.sub : '';
  };
  // だんだん遅くなるルーレット。最後に g で止まる
  const steps = []; let t = 0, d = 60;
  while(t + d < DRAW_MS){ t += d; steps.push(t); d *= 1.14; }
  const gi = MINI.indexOf(g), start = ((gi - steps.length) % MINI.length + MINI.length) % MINI.length;
  put(MINI[start], '');
  steps.forEach((at, i) => setTimeout(() => {
    if(my !== drawSeq) return;
    if(i === steps.length - 1){
      put(g, 'land'); $('m-sub').textContent = ruleOf(g).nm + ' に決定!';
      document.body.dataset.game = g; uiSE('go'); vibrate(40);
    }else{ put(MINI[(start + i + 1) % MINI.length], i % 2 ? 'tick' : ''); audio.beep(520 + i * 18, .03, .08); }
  }, at));
}
function showBoard(o){
  drawSeq++;
  mixScreen(); mixButtons(o.fin ? 'fin' : 'board');
  lateBtns(M_BTNS, LATE_MS + Math.min(o.rows.length, 16) * 70);
  $('m-draw').style.display = 'none';
  $('m-eye').textContent = 'MIX  第' + o.k + '戦 / ' + o.n + '戦';
  $('m-title').textContent = o.fin ? '最終結果' : '途中経過';
  const last = o.hist.length ? ruleOf(o.hist[o.hist.length - 1]) : null;
  $('m-sub').textContent = (last ? last.nm + ' のポイントを足したよ' : '') + (o.fin ? '' : '(あと ' + (o.n - o.k) + '戦)');
  const lines = $('m-lines'); lines.textContent = '';
  const maxPl = o.rows.reduce((m, r) => Math.max(m, r.pl), 0);
  o.rows.forEach((r, i) => {
    const d = document.createElement('div');
    if(r.pl === 1) d.className = 'win'; else if(o.fin && r.pl === maxPl) d.className = 'lose';
    const a = document.createElement('span'); a.textContent = r.pl + '位  ' + r.nm + (r.id === myId ? '(あなた)' : '');
    const b = document.createElement('span'); b.textContent = '+' + r.add + '  →  ' + r.tot + '点';
    d.appendChild(a); d.appendChild(b); d.classList.add('pop'); d.style.animationDelay = (i * 70) + 'ms'; lines.appendChild(d);
  });
  const top = o.rows.filter(r => r.pl === 1).map(r => r.nm);
  $('m-pen').textContent = o.fin && top.length ? (top.length > 1 ? '同率1位: ' + top.join('・') : top[0] + ' の優勝!') : '';
  $('m-hist').textContent = o.hist.map((g, i) => (i + 1) + '. ' + ruleOf(g).nm).join('   ');
  $('m-next').textContent = o.fin ? 'もう一度連戦' : '次のゲームを抽選';
  $('m-wait').textContent = role === 'host' ? '' : 'ホストが次へ進むのを待っているよ…';
  if(o.fin){ uiSE('go'); FXN.load(); FXN.show(true, { amb: [0xff6fb5, 0xffa8d4, 0xffffff] }); setTimeout(() => { if(mix) FXN.confetti(140); }, 250); vibrate([0, 80, 60, 160]); }
  else audio.beep(880, .06, .12);
}
// 参加者: ホストから届いた MIX の知らせを確かめてから表示する
function guestMix(o){
  if(!Number.isInteger(o.k) || ![1, 3, 5, 7].includes(o.n) || o.k < 1 || o.k > o.n) return;
  if(o.st === 'draw' && MINI.includes(o.g)){
    if(game && game.stop) game.stop();
    game = null; curId = null; mix = { n: o.n, k: o.k }; FXN.show(false);
    showDraw(o.k, o.n, o.g);
  }else if(o.st === 'board' && Array.isArray(o.rows) && Array.isArray(o.hist)){
    const hist = o.hist.filter(g => MINI.includes(g)).slice(0, 7);
    const rows = o.rows.filter(r => r && Number.isInteger(r.id) && Number.isInteger(r.add) && r.add >= 0 && r.add <= 15 && Number.isInteger(r.tot) && r.tot >= 0 && r.tot <= 200 && Number.isInteger(r.pl) && r.pl >= 1 && r.pl <= 16)
      .slice(0, 16).map(r => ({ id: r.id, nm: clean(r.nm) || '?', add: r.add, tot: r.tot, pl: r.pl }));
    if(game && game.stop) game.stop();
    game = null; curId = null; mix = { n: o.n, k: o.k };
    showBoard({ k: o.k, n: o.n, fin: o.fin === true, hist, rows });
  }
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
      onStall: () => showBanner('ホストの応答がありません(ホストのスマホが止まってるかも)…待っています'),
      onResume: () => { if($('banner').textContent.indexOf('ホストの応答がありません') === 0) flashBanner('ホストとつながり直したよ', 2000); },
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
  game = null; curId = null; guest = null; role = null; curGn = 0; early.length = 0; mixEnd(); resetFx(); $('picker').classList.remove('on'); hideBanner(); chatReset(); closeQuit();
  disarmBack();
}
const EARLY_MS = 20000, EARLY_MAX = 40;
const isGn = v => Number.isInteger(v) && v >= 1 && v <= 1e9;
function guestMsg(o){
  if(!o || typeof o.t !== 'string') return;
  if(o.t === 'roster' && Array.isArray(o.players)){
    roster = o.players.filter(p => p && Number.isInteger(p.id)).slice(0, 8).map(p => ({ id: p.id, name: clean(p.name) || '?', rtt: Number.isFinite(p.rtt) ? p.rtt : 0, aw: p.aw === 1 ? 1 : 0 }));
    if(RULES.some(x => x.g === o.want)) hostWant = o.want;
    if($('s-lobby').classList.contains('active')) renderLobby();
  }else if(o.t === 'begin' && typeof o.g === 'string' && window.NomiGames[o.g]){
    const gn = isGn(o.gn) ? o.gn : 0;
    if(gn && gn < curGn) return;                                   // 古い合図
    if(game && game.stop) game.stop();
    if(gn) curGn = gn;
    curId = o.g; document.body.dataset.game = o.g; game = window.NomiGames[o.g].make(E); audio.init(); keepAwake(); hideBanner(); game.onBegin();
    // 合図より先に届いていた、このゲームの知らせを順に渡す
    const now = Date.now(), keep = early.splice(0).filter(x => now - x.at < EARLY_MS && x.o.gn >= curGn);
    keep.forEach(x => { if(x.o.gn > curGn) early.push(x); else if(x.o.g === curId && game && game.onMsg) game.onMsg(x.o); });
  }else if(o.t === 'mix'){
    guestMix(o);
  }else if(o.t === 'chat'){
    onChat(o);
  }else if(o.t === 'want'){
    if(RULES.some(x => x.g === o.want)){ hostWant = o.want; if($('s-lobby').classList.contains('active')) renderRules(); }
  }else if(o.t === 'lobby'){
    if(game && game.stop) game.stop();
    game = null; curId = null; mixEnd(); resetFx(); $('picker').classList.remove('on'); renderLobby(); show('s-lobby');
    if(o.why) flashBanner(clean2(o.why, 60), 4000);
  }else if(typeof o.g === 'string'){
    if(isGn(o.gn)){
      if(o.gn < curGn) return;                                     // 前のゲームの知らせ
      if(o.gn > curGn){                                            // まだ始まりの合図が届いていないゲームの知らせ → とっておく
        early.push({ o, at: Date.now() });
        if(early.length > EARLY_MAX) early.shift();
        return;
      }
    }
    if(o.g === curId && game && game.onMsg) game.onMsg(o);
  }
}

// =====================================================================
//  ボタン
// =====================================================================
function saveName(){ myName = clean($('name').value) || 'ゲスト'; $('name').value = myName; try{ localStorage.setItem('nomi-name', myName); }catch(e){} }
function setWant(g){ wantGame = g; if(!curId) document.body.dataset.game = g; document.querySelectorAll('#seg-game button, #l-seg button').forEach(b => b.classList.toggle('on', b.dataset.g === g)); $('l-arena').classList.toggle('hide', g !== 'arena'); $('l-race').classList.toggle('hide', g !== 'race'); $('l-core').classList.toggle('hide', g !== 'core'); $('l-mix').classList.toggle('hide', g !== 'mix'); bcastWant(); }
// ARENA の育成タイム
(function(){
  const get = (k, d) => { try{ return localStorage.getItem(k) || d; }catch(e){ return d; } };
  const put = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
  const bs = document.querySelectorAll('#l-arena button[data-m]');
  const hs = document.querySelectorAll('#l-arena button[data-h]');
  const ns = document.querySelectorAll('#l-arena button[data-n]');
  const on = (list, key) => { const b = Array.from(list).find(x => x.classList.contains('on')); return b ? b.dataset[key] : ''; };
  // 5体バトルは 5分以上(ハードなら3分以上)のときだけ選べる
  const sync = () => {
    const m = +on(bs, 'm'), hard = on(hs, 'h') === '1', ok = m >= 5 || (hard && m >= 3);
    const b5 = document.querySelector('#l-arena button[data-n="5"]'); b5.disabled = !ok;
    if(!ok && on(ns, 'n') === '5') ns.forEach(b => b.classList.toggle('on', b.dataset.n === '3'));
    $('l-a5').textContent = ok ? '' : '5体バトルは 5分以上(ハードなら3分以上)で選べる';
  };
  const set = (list, key, v, store) => { list.forEach(b => b.classList.toggle('on', b.dataset[key] === v)); put(store, v); sync(); };
  let m = get('arena-min', '5'); if(!Array.from(bs).some(b => b.dataset.m === m)) m = '5';
  bs.forEach(b => b.classList.toggle('on', b.dataset.m === m));
  const h = get('arena-hard', '0') === '1' ? '1' : '0'; hs.forEach(b => b.classList.toggle('on', b.dataset.h === h));
  const n = get('arena-n', '3') === '5' ? '5' : '3'; ns.forEach(b => b.classList.toggle('on', b.dataset.n === n));
  sync();
  bs.forEach(b => b.addEventListener('click', () => set(bs, 'm', b.dataset.m, 'arena-min')));
  hs.forEach(b => b.addEventListener('click', () => set(hs, 'h', b.dataset.h, 'arena-hard')));
  ns.forEach(b => b.addEventListener('click', () => { if(!b.disabled) set(ns, 'n', b.dataset.n, 'arena-n'); }));
  // 決めるのは: 優勝 / 最下位(負け残りトーナメント)
  let v = 'top'; try{ v = localStorage.getItem('arena-mode') || 'top'; }catch(e){}
  const vs = document.querySelectorAll('#l-arena button[data-v]');
  const setV = x => { vs.forEach(b => b.classList.toggle('on', b.dataset.v === x)); try{ localStorage.setItem('arena-mode', x); }catch(e){} };
  setV(v === 'last' ? 'last' : 'top'); vs.forEach(b => b.addEventListener('click', () => setV(b.dataset.v)));
})();
// RACE: ガレージタイム / ゲージ / レース数 / 決めるのは
(function(){
  const one = (key, store, ok, d) => {
    const bs = document.querySelectorAll('#l-race button[data-' + key + ']');
    let v = d; try{ v = localStorage.getItem(store) || d; }catch(e){}
    if(!ok.includes(v)) v = d;
    const set = x => { bs.forEach(b => b.classList.toggle('on', b.dataset[key] === x)); try{ localStorage.setItem(store, x); }catch(e){} };
    set(v); bs.forEach(b => b.addEventListener('click', () => set(b.dataset[key])));
  };
  one('m', 'race-min', ['1', '3', '5'], '3');
  one('r', 'race-n', ['1', '3'], '3');
  one('h', 'race-hard', ['0', '1'], '0');
  one('v', 'race-mode', ['top', 'last'], 'top');
})();
// MIX: 戦数
(function(){
  let v = '3'; try{ v = localStorage.getItem('mix-n') || '3'; }catch(e){}
  const bs = document.querySelectorAll('#l-mix button[data-k]');
  const set = x => { bs.forEach(b => b.classList.toggle('on', b.dataset.k === x)); try{ localStorage.setItem('mix-n', x); }catch(e){} };
  set(['1', '3', '5', '7'].includes(v) ? v : '3'); bs.forEach(b => b.addEventListener('click', () => set(b.dataset.k)));
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

// ---------- ボタンの音(すべての画面のボタン) ----------
// ボタン自身がもう音を出していたら(ニトロ・スキルなど)、二重にならないように鳴らさない
function uiSE(kind){
  audio.init();
  if(kind === 'go'){ audio.beep(660, .07, .14); setTimeout(() => audio.beep(990, .1, .14), 60); }
  else if(kind === 'back'){ audio.beep(660, .06, .12); setTimeout(() => audio.beep(440, .1, .12), 60); }
  else audio.beep(880, .04, .1);
}
let downAt = -1e9;
document.addEventListener('pointerdown', () => { downAt = performance.now(); }, true);
// ボタンの処理が終わったあと(document まで上がってきたとき)に鳴らす
document.addEventListener('click', e => {
  const b = e.target.closest('button, a.ib, .ac.slim');
  if(!b) return;
  const now = performance.now(), from = now - downAt < 1500 ? downAt : now - 50;
  if(sndAt >= from - 5) return;
  const kind = b.closest('.gsel') || b.matches('.btn.main, #b-join, #b-solo') ? 'go' : b.matches('a.ib, #sc-back, #l-quit, #r-quit, #chat-x, .cat-x, #cf-no, #cf-yes') ? 'back' : 'tap';
  uiSE(kind);
  // ホームへもどるリンク: 音が途切れないよう、少し待ってから移る
  if(b.tagName === 'A' && b.href && !e.defaultPrevented && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)){ e.preventDefault(); const to = b.href; setTimeout(() => { location.href = to; }, 170); }
});
$('b-host').addEventListener('click', () => { saveName(); audio.init(); hostCreate(); });
$('b-join').addEventListener('click', () => { saveName(); audio.init(); guestBegin(); });
$('b-solo').addEventListener('click', () => { saveName(); audio.init(); soloCreate(); });
$('l-addbot').addEventListener('click', () => { if(solo && room){ room.add(); pushRoster(); } });
$('sc-back').addEventListener('click', () => { stopScan(); show('s-menu'); });
$('sc-go').addEventListener('click', () => { const t = $('sc-paste').value.trim(); if(t) joinWith(t); });
$('l-quit').addEventListener('click', askQuit);
$('r-quit').addEventListener('click', askQuit);
// ---------- 確認のポップアップ(退出・連戦をやめる など) ----------
let cfDo = null, cfT = 0;
function askConfirm(t, m, yes, fn){
  $('cf-t').textContent = t; $('cf-m').textContent = m; $('cf-yes').textContent = yes;
  cfDo = fn; $('cf').classList.add('on');
  // 連打で、そのまま「はい」まで押してしまわないように、少しのあいだ押せなくする
  const y = $('cf-yes'), my = ++cfT; y.disabled = true;
  setTimeout(() => { if(my === cfT) y.disabled = false; }, 600);
}
function askQuit(){
  const host = role === 'host';
  askConfirm(solo ? 'CPU戦をやめますか?' : host ? '部屋を閉じて退出しますか?' : '部屋から退出しますか?',
    solo ? 'メニューにもどります。' : host ? 'ホストが抜けると、部屋がなくなって、みんなのゲームも終わります。' : 'もう一度入るには、ホストのQRを読み直してください。',
    solo ? 'やめる' : '退出する', quitAll);
}
// ホスト: MIX の連戦の途中でロビーにもどるときは確認する
function askLobby(){
  if(role !== 'host') return;
  if(!mix || mix.n <= 1 || (mix.k >= mix.n && !mix.gid)){ toLobby(''); return; }
  askConfirm('連戦をやめますか?', 'ロビーにもどると、ここまでのポイントは消えて、みんなの連戦も終わります。', 'やめる', () => { if(role === 'host') toLobby(''); });
}
const closeQuit = () => { cfDo = null; $('cf').classList.remove('on'); };
$('cf-no').addEventListener('click', closeQuit);
$('cf-yes').addEventListener('click', () => { const f = cfDo; closeQuit(); if(f) f(); });
$('cf').addEventListener('click', e => { if(e.target === $('cf')) closeQuit(); });
$('a-catbtn').addEventListener('click', () => window.NomiGames.arena.showCatalog());
$('l-start').addEventListener('click', () => startGame(wantGame));
$('l-lock').addEventListener('click', () => { userLocked = !userLocked; if(room) room.setLocked(userLocked); renderLobby(); });
$('r-again').addEventListener('click', () => {
  if(role !== 'host') return;
  if(mix){ if(mix.n === 1) mixStart(); else mixBoard(); }
  else startGame(lastGame || wantGame);
});
$('m-next').addEventListener('click', () => { if(role !== 'host' || !mix) return; if(mix.k >= mix.n) mixStart(); else mixDraw(); });
$('m-lobby').addEventListener('click', askLobby);
$('m-quit').addEventListener('click', askQuit);
$('r-lobby').addEventListener('click', askLobby);
function quitAll(){
  stopScan();
  if(game && game.stop) game.stop();
  if(role === 'host' && room){ room.close(); } else if(guest){ guest.close(); }
  room = null; guest = null; game = null; curId = null; role = null; roster = []; solo = false; mixEnd(); resetFx(); chatReset();
  document.body.classList.remove('solo');
  $('picker').classList.remove('on'); closeQuit(); hideBanner(); show('s-menu');
  if(newVer){ location.reload(); return; }
  disarmBack();
}
// ---------- スマホの「戻る」で、いきなり部屋から抜けないようにする ----------
// 部屋にいる間は、履歴を1つ足しておく。「戻る」が押されたら、抜けずに確認を出す
let backArmed = false;
function armBack(){ if(backArmed || !(room || guest)) return; try{ history.pushState({ nr: 1 }, ''); backArmed = true; }catch(e){} }
function disarmBack(){ if(!backArmed) return; backArmed = false; try{ history.back(); }catch(e){} }
document.addEventListener('pointerdown', armBack, true);
window.addEventListener('popstate', () => {
  if(!backArmed) return;
  backArmed = false;
  if(!(room || guest)) return;
  armBack();
  if($('cf').classList.contains('on')) closeQuit(); else askQuit();
});
// 部屋にいる間に、ページを閉じる・読み込み直すときも確認する(ブラウザの確認が出る)
window.addEventListener('beforeunload', e => { if(room || guest){ e.preventDefault(); e.returnValue = ''; } });
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
