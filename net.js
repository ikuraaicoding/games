/* NomiNet: サーバーなしのスマホ同士通信(WebRTC + QR手動つなぎ)
 * - 通信相手との接続情報(SDP)を、短い文字列にしてQRで交換する
 * - 受け取った文字列は「項目ごとに厳しく検証」してからSDPを作り直す(SDPインジェクション対策)
 * - 外部サーバーは STUN(任意・Google公開サーバー)だけ。オフにもできる
 */
(function(){
'use strict';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const VERSION = 'NM1';

// ---------- base64url ----------
function bytesToB64u(bytes){
  let s = ''; for(let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBytes(str){
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for(let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function hexColonToBytes(h){
  const parts = h.split(':');
  if(parts.length !== 32) throw new Error('fingerprint');
  return Uint8Array.from(parts.map(x => parseInt(x, 16)));
}
function bytesToHexColon(b){
  return Array.from(b).map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(':');
}

// ---------- 検証用の正規表現(これに合わない文字列は全部拒否) ----------
const RE = {
  ufrag: /^[A-Za-z0-9+\/]{4,64}$/,
  pwd:   /^[A-Za-z0-9+\/]{22,256}$/,
  fp:    /^[A-Za-z0-9_-]{43}$/,
  found: /^[A-Za-z0-9]{1,24}$/,
  num:   /^[0-9]{1,10}$/,
  port:  /^[0-9]{1,5}$/,
  host:  /^[A-Za-z0-9:.\-]{1,80}$/,
  typ:   /^(host|srflx|prflx|relay)$/
};

// ---------- SDP → 短い文字列 ----------
function parseSdp(sdp){
  const get = (re) => { const m = sdp.match(re); return m ? m[1].trim() : null; };
  const ufrag = get(/^a=ice-ufrag:(.+)$/m);
  const pwd = get(/^a=ice-pwd:(.+)$/m);
  const fp = get(/^a=fingerprint:sha-256 (.+)$/m);
  if(!ufrag || !pwd || !fp) throw new Error('SDPが読めない(sha-256のみ対応)');
  const cands = [];
  const lines = sdp.split(/\r?\n/);
  for(const ln of lines){
    if(ln.indexOf('a=candidate:') !== 0) continue;
    const t = ln.slice(2).split(' ');          // candidate:xxx 1 udp prio ip port typ TYPE [raddr R rport P ...]
    if(t.length < 8 || t[2].toLowerCase() !== 'udp' || t[1] !== '1' || t[6] !== 'typ') continue;
    const c = [t[0].replace('candidate:', ''), t[3], t[4], t[5], t[7]];
    const ri = t.indexOf('raddr'), pi = t.indexOf('rport');
    if(ri > 0 && pi > 0){ c.push(t[ri + 1], t[pi + 1]); }
    cands.push(c.join('|'));
  }
  return { ufrag, pwd, fp: bytesToB64u(hexColonToBytes(fp)), cands };
}
function encodeBlob(kind, p){
  return [VERSION + kind, p.ufrag, p.pwd, p.fp, p.cands.join(';')].join('~');
}
function decodeBlob(text, kind){
  if(typeof text !== 'string' || text.length > 4000) throw new Error('長すぎる');
  const parts = text.trim().split('~');
  if(parts.length !== 5 || parts[0] !== VERSION + kind) throw new Error('このアプリのQRじゃない / 種類が違う');
  const [, ufrag, pwd, fp, candStr] = parts;
  if(!RE.ufrag.test(ufrag) || !RE.pwd.test(pwd) || !RE.fp.test(fp)) throw new Error('QRの中身が不正');
  const cands = [];
  const items = candStr === '' ? [] : candStr.split(';');
  if(items.length > 12) throw new Error('候補が多すぎる');
  for(const it of items){
    const f = it.split('|');
    if(f.length !== 5 && f.length !== 7) throw new Error('候補が不正');
    if(!RE.found.test(f[0]) || !RE.num.test(f[1]) || !RE.host.test(f[2]) || !RE.port.test(f[3]) || !RE.typ.test(f[4])) throw new Error('候補が不正');
    if(f.length === 7 && (!RE.host.test(f[5]) || !RE.port.test(f[6]))) throw new Error('候補が不正');
    cands.push(f);
  }
  const fpBytes = b64uToBytes(fp);
  if(fpBytes.length !== 32) throw new Error('fingerprint不正');
  return { ufrag, pwd, fpHex: bytesToHexColon(fpBytes), cands };
}
function buildSdp(kind, p){
  const setup = kind === 'o' ? 'actpass' : 'active';
  const L = [
    'v=0',
    'o=- ' + Date.now() + ' 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:' + p.ufrag,
    'a=ice-pwd:' + p.pwd,
    'a=fingerprint:sha-256 ' + p.fpHex,
    'a=setup:' + setup,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144'
  ];
  for(const f of p.cands){
    let s = 'a=candidate:' + f[0] + ' 1 udp ' + f[1] + ' ' + f[2] + ' ' + f[3] + ' typ ' + f[4];
    if(f.length === 7) s += ' raddr ' + f[5] + ' rport ' + f[6];
    L.push(s + ' generation 0');
  }
  L.push('a=end-of-candidates');
  return L.join('\r\n') + '\r\n';
}

// ---------- 接続 ----------
function newPeer(useStun){
  return new RTCPeerConnection({ iceServers: useStun ? STUN : [] });
}
function gather(pc, ms){
  return new Promise(resolve => {
    if(pc.iceGatheringState === 'complete') return resolve();
    let t = null;
    const done = () => { pc.removeEventListener('icegatheringstatechange', on); clearTimeout(t); resolve(); };
    const on = () => { if(pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', on);
    t = setTimeout(done, ms || 4000);
  });
}
async function hostCreateOffer(useStun){
  const pc = newPeer(useStun);
  const channel = pc.createDataChannel('nomi', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gather(pc);
  return { pc, channel, blob: encodeBlob('o', parseSdp(pc.localDescription.sdp)) };
}
async function hostAcceptAnswer(h, blob){
  const p = decodeBlob(blob, 'a');
  await h.pc.setRemoteDescription({ type: 'answer', sdp: buildSdp('a', p) });
}
async function guestAcceptOffer(blob, useStun){
  const p = decodeBlob(blob, 'o');
  const pc = newPeer(useStun);
  const channel = new Promise(res => { pc.ondatachannel = e => res(e.channel); });
  await pc.setRemoteDescription({ type: 'offer', sdp: buildSdp('o', p) });
  await pc.setLocalDescription(await pc.createAnswer());
  await gather(pc);
  return { pc, channel, blob: encodeBlob('a', parseSdp(pc.localDescription.sdp)) };
}

// ---------- QR 表示 ----------
function drawQR(text, canvas, cssSize){
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const dpr = window.devicePixelRatio || 1;
  const px = Math.max(2, Math.floor(cssSize * dpr / (n + quiet * 2)));
  const size = px * (n + quiet * 2);
  canvas.width = size; canvas.height = size;
  canvas.style.width = (size / dpr) + 'px'; canvas.style.height = (size / dpr) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for(let r = 0; r < n; r++) for(let c = 0; c < n; c++){
    if(qr.isDark(r, c)) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
  }
  return { modules: n, bytes: text.length };
}

// ---------- QR 読み取り(カメラ映像は端末の外に出ない・読み取り後は必ず停止) ----------
function startScan(videoEl, onText, onError){
  let stream = null, stopped = false, timer = null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  function stop(){
    stopped = true; clearTimeout(timer);
    if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
    videoEl.srcObject = null;
  }
  function tick(){
    if(stopped) return;
    if(videoEl.readyState >= 2 && videoEl.videoWidth){
      const w = videoEl.videoWidth, h = videoEl.videoHeight;
      const scale = Math.min(1, 900 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if(code && code.data){ stop(); onText(code.data); return; }
    }
    timer = setTimeout(tick, 120);
  }
  (async () => {
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if(stopped){ stream.getTracks().forEach(t => t.stop()); return; }
      videoEl.srcObject = stream;
      videoEl.setAttribute('playsinline', 'true');
      await videoEl.play();
      tick();
    }catch(e){ stop(); onError(e); }
  })();
  return { stop };
}

window.NomiNet = {
  hostCreateOffer, hostAcceptAnswer, guestAcceptOffer,
  drawQR, startScan,
  _internal: { parseSdp, encodeBlob, decodeBlob, buildSdp }
};
})();
