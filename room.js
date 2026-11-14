/* NomiRoom: 暗号化つきの部屋(ホスト1 + 参加者n)
 *
 * 仕組み
 *  - ホストは部屋ごとに使い捨ての ECDH 鍵(P-256)を作り、公開鍵と部屋IDを「参加QR」にする
 *  - 参加者も使い捨ての鍵を作り、ホストの公開鍵(QRから)と ECDH → HKDF → AES-GCM の「二人専用の鍵」を作る
 *      → ホストだけが、その参加者の鍵を作れる(参加者同士ではなりすませない・盗み見できない)
 *  - 中継(公開MQTT)には暗号文しか流れない。2つの中継を同時に使い、先に届いた方を採用する
 *  - 同じメッセージが2経路で届く・再送されることを前提に、連番(スライディングウィンドウ)で重複・リプレイを捨てる
 *
 * 離れた場所・スマホの電波でも落ちにくくするために
 *  - 大事なメッセージ(reliable)は、相手から「受け取った(ak)」が来るまで送り直す(切れている間も、つながり直したら届く)
 *  - LINE を開くなどでアプリが止まっても、すぐには外さない(DROP_MS まで待つ)
 *  - ホスト自身のアプリが止まっていた間は、だれからも届かなくて当然なので、戻ったときに外さない
 *  - 外れた人がもどってきたら、同じ番号・名前のまま部屋にもどす(GONE_MS 以内)
 *  - アプリにもどったとき・電波がもどったときは、すぐに中継のつながりを確かめ直す
 */
(function(){
'use strict';
const TE = new TextEncoder(), TD = new TextDecoder(), subtle = crypto.subtle;
const PREFIX = 'nomipk1/';
const MAX_ENV = 6000;
const MAX_PLAYERS = 8;
const DROP_MS = 40000;          // これだけ何も届かなければ、抜けたことにする
const GONE_MS = 10 * 60000;     // 抜けた人が、同じ番号でもどってこられる時間
const RESEND_MS = 1200, RESEND_MAX = 40;

// 大事なメッセージの送り直し(ak が来るまで)
class Rel{
  constructor(){ this.m = new Map(); }
  add(q, pub){ this.m.set(q, { pub, at: Date.now(), n: 0 }); }
  ack(q){ this.m.delete(q); }
  tick(){
    const now = Date.now();
    this.m.forEach((x, q) => { if(now - x.at < RESEND_MS) return; if(++x.n > RESEND_MAX){ this.m.delete(q); return; } x.at = now; x.pub(); });
  }
  clear(){ this.m.clear(); }
}

function b64u(bytes){ let s = ''; for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(str){ const b = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const o = new Uint8Array(b.length); for(let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
function rnd(n){ return crypto.getRandomValues(new Uint8Array(n)); }
function clean(n){ return String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f-\u009f<>&"'`|~]/g, '').trim().slice(0, 8); }
const RE_ROOM = /^[A-Za-z0-9_-]{22}$/, RE_B64 = /^[A-Za-z0-9_-]+$/;

async function genPair(){
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { priv: kp.privateKey, pub: new Uint8Array(await subtle.exportKey('raw', kp.publicKey)) };
}
async function pairKey(priv, pubRaw, roomId){
  const pub = await subtle.importKey('raw', pubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unb64u(roomId), info: TE.encode('nomi-pack v1 pair') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, obj, aad){
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: TE.encode(aad) }, key, TE.encode(JSON.stringify(obj))));
  return b64u(iv) + '|' + b64u(ct);
}
async function unseal(key, ivS, ctS, aad){
  try{
    if(!RE_B64.test(ivS) || !RE_B64.test(ctS)) return null;
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(ivS), additionalData: TE.encode(aad) }, key, unb64u(ctS));
    const o = JSON.parse(TD.decode(pt));
    return (o && typeof o === 'object') ? o : null;
  }catch(e){ return null; }
}
async function gidOf(pubRaw){
  const h = new Uint8Array(await subtle.digest('SHA-256', pubRaw));
  return Array.from(h.slice(0, 8)).map(x => x.toString(16).padStart(2, '0')).join('');
}
function validPub(raw){ return raw.length === 65 && raw[0] === 4; }

// 連番ウィンドウ: 同じ番号は2度受け取らない(重複・リプレイ対策)。順番が前後しても受け取る
class Win{
  constructor(){ this.max = 0; this.seen = new Set(); }
  accept(q){
    if(!Number.isInteger(q) || q < 1) return false;
    if(q <= this.max - 256 || this.seen.has(q)) return false;
    this.seen.add(q); if(q > this.max) this.max = q;
    if(this.seen.size > 600) for(const s of Array.from(this.seen)) if(s <= this.max - 256) this.seen.delete(s);
    return true;
  }
}

// 複数の中継に同時につなぐ(切れたら自動で再接続)
class Net{
  constructor(urls, h){
    this.h = h; this.topics = []; this.dead = false;
    this.cl = urls.map(u => ({ url: u, mq: null, delay: 1000, timer: 0 }));
    this.cl.forEach(c => this.start(c));
    // アプリにもどった・電波がもどった → すぐに確かめ直す
    this.wake = () => { if(document.visibilityState !== 'hidden') this.nudge(); };
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('online', this.wake);
  }
  start(c){
    if(this.dead) return;
    clearTimeout(c.timer);
    const mq = new NomiMQTT.MQ(c.url, {
      onOpen: () => { c.delay = 1000; this.report(); if(this.h.onOpen) this.h.onOpen(); },
      onMessage: (tp, pl) => { if(pl.length <= MAX_ENV) this.h.onMessage(tp, TD.decode(pl)); },
      onClose: () => { this.report(); if(!this.dead && c.mq === mq){ c.delay = Math.min(c.delay * 1.7, 10000); clearTimeout(c.timer); c.timer = setTimeout(() => this.start(c), c.delay); } }
    });
    c.mq = mq;
    this.topics.forEach(t => mq.subscribe(t));
    mq.open();
  }
  subscribe(t){ this.topics.push(t); this.cl.forEach(c => { if(c.mq) c.mq.subscribe(t); }); }
  publish(t, text){ let n = 0; this.cl.forEach(c => { if(c.mq && c.mq.publish(t, text)) n++; }); return n; }
  up(){ return this.cl.filter(c => c.mq && c.mq.ok).length; }
  report(){ if(this.h.onStatus) this.h.onStatus({ up: this.up(), total: this.cl.length }); }
  // つながっていないものはすぐつなぎ直す。つながっているつもりのものは、返事が来るか確かめる
  nudge(){
    if(this.dead) return;
    const t = Date.now();
    this.cl.forEach(c => {
      if(!c.mq || !c.mq.ok){ try{ c.mq && c.mq.close(); }catch(e){} c.delay = 1000; this.start(c); return; }
      const mq = c.mq; mq.pingNow();
      setTimeout(() => { if(!this.dead && c.mq === mq && mq.ok && mq.lastRx < t) mq.drop(); }, 4000);
    });
  }
  close(){
    this.dead = true;
    document.removeEventListener('visibilitychange', this.wake); window.removeEventListener('online', this.wake);
    this.cl.forEach(c => { clearTimeout(c.timer); try{ c.mq && c.mq.close(); }catch(e){} });
  }
}

// ======================================================================
//  ホスト
// ======================================================================
async function host(h){
  h = h || {};
  const kp = await genPair();
  const roomId = b64u(rnd(16));
  const base = PREFIX + roomId, inbox = base + '/h';
  const R = { qr: 'NR1~' + roomId + '~' + b64u(kp.pub), peers: new Map(), locked: false, clock: { offset: 0, rtt: 0, n: 1 }, closed: false };
  const byGid = new Map(), pending = new Set(), banned = new Set(), gone = new Map();
  let nextId = 1, joinTimes = [];
  const net = new Net(NomiMQTT.BROKERS, { onMessage, onStatus: s => { if(h.onNet) h.onNet(s); } });
  net.subscribe(inbox);

  async function onMessage(topic, text){
    if(R.closed || topic !== inbox) return;
    const p = text.split('|');
    if(p.length !== 4) return;
    if(p[0] === 'J') return handleJoin(p[1], p[2], p[3]);
    if(p[0] === 'M'){
      let peer = byGid.get(p[1]);
      const back = !peer && gone.get(p[1]);
      if(back) peer = back.peer;
      if(!peer) return;
      const obj = await unseal(peer.key, p[2], p[3], 'g2h|' + roomId + '|' + peer.gid);
      if(!obj) return;
      if(back && !restore(peer)) return;
      if(!R.peers.has(peer.id)) return;
      peer.seen = Date.now();
      if(obj.r && Number.isInteger(obj.q)) sendTo(peer, { t: 'ak', a: obj.q }, false);      // 重複でも返す(前の ak が届かなかったかもしれない)
      if(!peer.win.accept(obj.q)) return;
      handle(peer, obj);
    }
  }
  async function handleJoin(gpubS, iv, ct){
    if(!RE_B64.test(gpubS) || gpubS.length > 120) return;
    const now = Date.now();
    joinTimes = joinTimes.filter(t => now - t < 10000);
    if(joinTimes.length >= 30) return;                    // 入室リクエストの連打対策
    joinTimes.push(now);
    let raw; try{ raw = unb64u(gpubS); }catch(e){ return; }
    if(!validPub(raw)) return;
    const gid = await gidOf(raw);
    if(banned.has(gid)) return;
    const gb = gone.get(gid);
    if(gb){
      const o = await unseal(gb.peer.key, iv, ct, 'g2h|' + roomId + '|' + gid);
      if(o && o.t === 'join' && restore(gb.peer)){ gb.peer.win.accept(o.q); sendTo(gb.peer, { t: 'welcome', id: gb.peer.id }, true); }
      return;
    }
    const ex = byGid.get(gid);
    if(ex){
      const o = await unseal(ex.key, iv, ct, 'g2h|' + roomId + '|' + gid);
      if(o && o.t === 'join' && ex.win.accept(o.q)) sendTo(ex, { t: 'welcome', id: ex.id }, true);
      return;
    }
    if(R.locked || R.peers.size >= MAX_PLAYERS - 1 || pending.has(gid)) return;
    pending.add(gid);
    try{
      const key = await pairKey(kp.priv, raw, roomId);
      const o = await unseal(key, iv, ct, 'g2h|' + roomId + '|' + gid);
      if(!o || o.t !== 'join') return;
      if(R.locked || R.peers.size >= MAX_PLAYERS - 1) return;
      const id = nextId++;
      const peer = { id, gid, key, win: new Win(), out: 0, name: clean(o.name) || ('ゲスト' + id), seen: Date.now(), rtt: 0, rel: new Rel() };
      peer.win.accept(o.q);
      byGid.set(gid, peer); R.peers.set(id, peer);
      sendTo(peer, { t: 'welcome', id }, true);
      if(h.onJoin) h.onJoin(peer);
    }finally{ pending.delete(gid); }
  }
  function handle(peer, o){
    switch(o.t){
      case 'hb': if(Number.isFinite(o.rtt)) peer.rtt = Math.max(0, Math.min(5000, o.rtt)); break;
      case 'ping': if(Number.isFinite(o.c)) sendTo(peer, { t: 'pong', c: o.c, h: performance.now() }, false); break;
      case 'ak': if(Number.isInteger(o.a)) peer.rel.ack(o.a); break;
      case 'bye': drop(peer, 'bye'); break;
      default: if(h.onMsg) h.onMsg(peer.id, o);
    }
  }
  async function sendTo(peer, obj, reliable){
    if(R.closed || !peer) return;
    const q = ++peer.out;
    const env = 'M|-|' + await seal(peer.key, Object.assign(reliable ? { q, r: 1 } : { q }, obj), 'h2g|' + roomId + '|' + peer.gid);
    const topic = base + '/g/' + peer.gid;
    net.publish(topic, env);
    if(reliable){
      setTimeout(() => { if(!R.closed) net.publish(topic, env); }, 300);
      peer.rel.add(q, () => { if(!R.closed && R.peers.has(peer.id)) net.publish(topic, env); });
    }
  }
  function drop(peer, why){
    if(!R.peers.has(peer.id)) return;
    R.peers.delete(peer.id);
    byGid.delete(peer.gid);
    peer.rel.clear();
    // 電波で切れただけなら、もどってこられるようにしておく(外された・自分で抜けた人はだめ)
    if(why === 'timeout') gone.set(peer.gid, { peer, at: Date.now() });
    if(h.onLeave) h.onLeave(peer, why);
  }
  // 抜けた人がもどってきた: 同じ番号・名前で部屋にもどす
  function restore(peer){
    const g = gone.get(peer.gid);
    if(!g || R.closed || banned.has(peer.gid) || R.peers.size >= MAX_PLAYERS - 1) return false;
    gone.delete(peer.gid);
    peer.seen = Date.now(); peer.rel.clear();
    byGid.set(peer.gid, peer); R.peers.set(peer.id, peer);
    if(h.onJoin) h.onJoin(peer, true);
    return true;
  }
  const hbT = setInterval(() => { R.bcast({ t: 'hb' }, false); }, 2000);
  const relT = setInterval(() => { R.peers.forEach(p => p.rel.tick()); }, 400);
  let lastDog = Date.now();
  const dogT = setInterval(() => {
    const now = Date.now();
    // ホストのアプリが止まっていた(タイマーが動いていなかった)なら、その間はだれからも届かなくて当然 → 数え直す
    if(now - lastDog > 6000) R.peers.forEach(p => { p.seen = now; });
    lastDog = now;
    Array.from(R.peers.values()).forEach(p => { if(now - p.seen > DROP_MS) drop(p, 'timeout'); });
    gone.forEach((g, gid) => { if(now - g.at > GONE_MS) gone.delete(gid); });
  }, 2000);
  R.away = id => { const p = R.peers.get(id); return !!(p && Date.now() - p.seen > 8000); };

  R.sendTo = (id, obj, reliable) => sendTo(R.peers.get(id), obj, !!reliable);
  R.bcast = (obj, reliable) => { R.peers.forEach(p => sendTo(p, obj, !!reliable)); };
  R.kick = (id) => { const p = R.peers.get(id); if(!p) return; banned.add(p.gid); sendTo(p, { t: 'kicked' }, true); setTimeout(() => drop(p, 'kicked'), 50); };
  R.setLocked = (v) => { R.locked = !!v; };
  R.close = () => {
    if(R.closed) return;
    R.bcast({ t: 'closed' }, true);
    setTimeout(() => { R.closed = true; clearInterval(hbT); clearInterval(dogT); clearInterval(relT); net.close(); }, 700);
  };
  return R;
}

// ======================================================================
//  参加者
// ======================================================================
async function join(qrText, h){
  h = h || {};
  const p = String(qrText || '').trim().split('~');
  if(p.length !== 3 || p[0] !== 'NR1' || !RE_ROOM.test(p[1]) || !RE_B64.test(p[2]) || p[2].length > 120) throw new Error('このアプリの参加QRじゃないよ');
  const roomId = p[1];
  const hostPub = unb64u(p[2]);
  if(!validPub(hostPub)) throw new Error('QRの中身が不正だよ');
  const kp = await genPair();
  const gid = await gidOf(kp.pub);
  const key = await pairKey(kp.priv, hostPub, roomId);
  const base = PREFIX + roomId, hostBox = base + '/h', myBox = base + '/g/' + gid;
  const G = { id: -1, welcomed: false, closed: false, lastHb: Date.now(), clock: { offset: 0, rtt: Infinity, n: 0 } };
  const win = new Win(), rel = new Rel(); let out = 0, stalled = false;
  const net = new Net(NomiMQTT.BROKERS, { onMessage, onStatus: s => { if(h.onNet) h.onNet(s); }, onOpen: () => { if(G.welcomed) hb(); } });
  net.subscribe(myBox);

  async function onMessage(topic, text){
    if(G.closed || topic !== myBox) return;
    const q = text.split('|');
    if(q.length !== 4 || q[0] !== 'M') return;
    const o = await unseal(key, q[2], q[3], 'h2g|' + roomId + '|' + gid);
    if(!o) return;
    if(o.r && Number.isInteger(o.q)) sendRaw('M', { t: 'ak', a: o.q }, false);      // 重複でも返す
    if(!win.accept(o.q)) return;
    G.lastHb = Date.now();
    if(stalled){ stalled = false; if(h.onResume) h.onResume(); }
    switch(o.t){
      case 'welcome':
        if(!G.welcomed && Number.isInteger(o.id)){ G.welcomed = true; G.id = o.id; startSync(); if(h.onWelcome) h.onWelcome(o.id); }
        break;
      case 'hb': break;
      case 'ak': if(Number.isInteger(o.a)) rel.ack(o.a); break;
      case 'pong': onPong(o); break;
      case 'kicked': case 'closed': end(o.t); break;
      default: if(G.welcomed && h.onMsg) h.onMsg(o);
    }
  }
  async function sendRaw(kind, obj, reliable){
    if(G.closed) return;
    const qn = ++out;
    const body = await seal(key, Object.assign(reliable ? { q: qn, r: 1 } : { q: qn }, obj), 'g2h|' + roomId + '|' + gid);
    const env = kind === 'J' ? 'J|' + b64u(kp.pub) + '|' + body : 'M|' + gid + '|' + body;
    net.publish(hostBox, env);
    if(reliable){
      setTimeout(() => { if(!G.closed) net.publish(hostBox, env); }, 300);
      rel.add(qn, () => { if(!G.closed) net.publish(hostBox, env); });
    }
  }
  G.send = (obj, reliable) => sendRaw('M', obj, !!reliable);

  // 入室リクエストは、返事(welcome)が来るまで繰り返す
  let tries = 0;
  const joinT = setInterval(() => {
    if(G.welcomed || G.closed){ clearInterval(joinT); return; }
    if(++tries > 30){ clearInterval(joinT); end('timeout'); return; }
    sendRaw('J', { t: 'join', name: clean(h.name) || 'ゲスト' }, false);
  }, 1500);
  sendRaw('J', { t: 'join', name: clean(h.name) || 'ゲスト' }, false);

  // 時計合わせ(ホストの performance.now() との差を測る。往復が一番短かったものを採用)
  function onPong(o){
    if(!Number.isFinite(o.c) || !Number.isFinite(o.h)) return;
    const now = performance.now(), rtt = now - o.c;
    if(rtt < 0 || rtt > 5000) return;
    G.clock.n++;
    if(rtt < G.clock.rtt){ G.clock.rtt = rtt; G.clock.offset = o.h - (o.c + now) / 2; }
  }
  function ping(){ if(!G.closed) sendRaw('M', { t: 'ping', c: performance.now() }, false); }
  let syncT = null;
  function startSync(){
    let k = 0;
    const burst = setInterval(() => { ping(); if(++k >= 10) clearInterval(burst); }, 250);
    syncT = setInterval(() => { for(let i = 0; i < 3; i++) setTimeout(ping, i * 250); }, 8000);
  }
  G.hostToLocal = t => t - G.clock.offset;
  const hb = () => { if(G.welcomed && !G.closed) sendRaw('M', { t: 'hb', rtt: Number.isFinite(G.clock.rtt) ? Math.round(G.clock.rtt) : 0 }, false); };
  const hbT = setInterval(hb, 3000);
  const relT = setInterval(() => rel.tick(), 400);
  let lastDog = Date.now();
  const dogT = setInterval(() => {
    const now = Date.now();
    if(now - lastDog > 5000) G.lastHb = now;           // 自分のアプリが止まっていた → 数え直す
    lastDog = now;
    if(G.welcomed && now - G.lastHb > 7000){ stalled = true; if(h.onStall) h.onStall(now - G.lastHb); }
  }, 1500);
  // アプリにもどったら、すぐホストに「いるよ」と伝える
  const onVis = () => { if(document.visibilityState !== 'hidden') hb(); };
  document.addEventListener('visibilitychange', onVis);

  function end(why){
    if(G.closed) return;
    G.closed = true; clearInterval(joinT); clearInterval(hbT); clearInterval(dogT); clearInterval(syncT); clearInterval(relT);
    document.removeEventListener('visibilitychange', onVis);
    net.close();
    if(h.onEnd) h.onEnd(why);
  }
  G.close = () => {
    if(G.closed) return;
    sendRaw('M', { t: 'bye' }, true);
    setTimeout(() => { G.closed = true; clearInterval(joinT); clearInterval(hbT); clearInterval(dogT); clearInterval(syncT); clearInterval(relT); document.removeEventListener('visibilitychange', onVis); net.close(); }, 700);
  };
  return G;
}

window.NomiRoom = { host, join, clean, MAX_PLAYERS, _i: { Win, Rel, pairKey, seal, unseal, genPair, gidOf, b64u, unb64u, Net } };
})();
