/* CPUプレイヤー(ひとりで試す用)
 *
 * 本物の参加者と同じメッセージをホストとやり取りするだけの、スマホの中の「にせ参加者」。
 * 通信はしない。ホストから届いた内容を見て、人間っぽい間をあけて返事をする。
 */
(function(){
'use strict';
const rnd = Math.random;
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const gauss = () => { let u = 0, v = 0; while(!u) u = rnd(); while(!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// id: このCPUの番号 / send(obj): ホストへ送る / chat(obj): チャットを送る
function make(id, send, chat){
  let gid = null, timers = [], ivs = [];
  const later = (fn, ms) => { const t = setTimeout(fn, Math.max(0, ms)); timers.push(t); return t; };
  const every = (fn, ms) => { const t = setInterval(fn, ms); ivs.push(t); return t; };
  function clear(){ timers.forEach(clearTimeout); ivs.forEach(clearInterval); timers = []; ivs = []; }
  let S = {};                                   // ゲームごとの状態

  // ---------------- DRAW ----------------
  const tap = {
    begin(){ later(() => send({ t: 'down' }), ri(400, 1800)); },
    msg(m){
      if(m.t === 'go' && Number.isInteger(m.r)){
        const wait = m.at - performance.now();
        if(rnd() < .04) later(() => send({ t: 'foul', r: m.r }), wait * rnd());          // たまにフライング
        else{ const ms = 190 + Math.abs(gauss()) * 90 + rnd() * 60; later(() => send({ t: 'rt', r: m.r, ms: Math.round(ms * 10) / 10 }), wait + ms); }
      }else if(m.t === 'tie' && Array.isArray(m.ids) && m.ids.includes(id)){
        later(() => send({ t: 'down' }), 2400 + ri(200, 1200));
      }
    }
  };

  // ---------------- BLIND ----------------
  const stop = {
    begin(){},
    msg(m){
      if(m.t === 'go' && Number.isInteger(m.T)){
        const ms = Math.max(1000, m.T * 1000 + gauss() * 1300);
        later(() => send({ t: 'rt', ms: Math.round(ms * 10) / 10 }), ri(800, 3500) + ms);
      }
    }
  };

  // ---------------- THUMBS ----------------
  const ise = {
    begin(){},
    msg(m){
      if(m.t === 'rnd' && Number.isInteger(m.r) && Array.isArray(m.alive) && m.alive.includes(id)){
        const n = m.alive.length, p = ri(0, 2);
        let others = 0; for(let i = 1; i < n; i++) others += ri(0, 2);          // ほかの人を当てずっぽうで読む
        const gs = Math.max(0, Math.min(2 * n, p + others));
        later(() => send({ t: 'pk', r: m.r, p, gs }), ri(1500, 7000));
      }
    }
  };

  // ---------------- CORE ----------------
  const core = {
    begin(){ S.core = { holding: false, ka: 0, hold: 0 }; },
    msg(m){
      const c = S.core;
      if(m.t === 'st'){
        if(m.holder !== id){ c.holding = false; clearInterval(c.ka); clearTimeout(c.hold); return; }
        if(m.ph === 'idle' && !c.holding){
          later(() => {
            if(c.holding) return;
            c.holding = true; const t0 = performance.now(), n = ri(1, 1e6);
            send({ t: 'press', n });
            c.ka = every(() => send({ t: 'ka', n }), 400);
            // 人間のスマホと同じように、ドッキリ(約35%)とフェイクのヒビを起こす
            if(rnd() < .35) later(() => { if(c.holding) send({ t: 'sfx', s: ri(0, 2) }); }, 200 + rnd() * 650);
            later(() => { if(c.holding) send({ t: 'sfx', f: Math.round((.35 + rnd() * .65) * 100) / 100, d: ri(120, 380) }); }, 500 + rnd() * 200);
            c.hold = later(() => { clearInterval(c.ka); c.holding = false; send({ t: 'release', n, held: Math.round(performance.now() - t0) }); }, 1700 + rnd() * 3800);
          }, ri(700, 2200));
        }else if(m.ph === 'choose' && Array.isArray(m.elig) && m.elig.length){
          later(() => send({ t: 'pass', to: m.elig[ri(0, m.elig.length - 1)] }), ri(800, 2400));
        }
      }else if(m.t === 'boom'){ clearInterval(c.ka); clearTimeout(c.hold); c.holding = false; }
    }
  };

  // ---------------- ARENA ----------------
  const score = c => c.a + c.d + c.h;
  const arena = {
    begin(){ S.ar = { n: 0, t: 0, mi: 0 }; },
    msg(m){
      const a = S.ar;
      if(m.t === 'me' && Array.isArray(m.p)){
        clearTimeout(a.t);
        if(m.end) return;
        a.t = later(() => {
          if(m.pend){
            let slot = -1;
            if(m.pend.k === 'ch'){
              let wi = 0; m.p.forEach((c, i) => { if(score(c) < score(m.p[wi])) wi = i; });
              if(score(m.pend.c) > score(m.p[wi])) slot = wi;
            }else if(m.pend.w){
              // 武器と同じ系統(一番高いステ)のキャラに付けたい
              const top = c => { const mx = Math.max(c.a, c.d, c.h); return c.a === mx ? 'a' : c.d === mx ? 'd' : 'h'; };
              const fit = m.p.findIndex(c => !c.w && top(c) === m.pend.w.t), free = m.p.findIndex(c => !c.w);
              if(fit >= 0) slot = fit;
              else if(free >= 0) slot = free;
              else{ let li = 0; m.p.forEach((c, i) => { if(c.w.v < m.p[li].w.v) li = i; }); if(m.p[li].w.v < m.pend.w.v) slot = li; }
            }
            send({ t: 'dec', slot, n: ++a.n });
          }else if(m.tk > 0){
            const r = rnd(), can = m.p.map((c, i) => c.sk.lv < 5 ? i : -1).filter(i => i >= 0);
            if(r < .45) send({ t: 'act', a: 'ch', n: ++a.n });
            else if(r < .78 || !can.length) send({ t: 'act', a: 'wp', n: ++a.n });
            else send({ t: 'act', a: 'sk', slot: can[ri(0, can.length - 1)], n: ++a.n });
          }
        }, ri(700, 3000));
      }else if(m.t === 'ms' && m.a && m.b && Number.isInteger(m.mi)){
        const side = m.a.id === id ? 0 : m.b.id === id ? 1 : -1;
        if(side < 0) return;
        const us = side === 0 ? m.a.u : m.b.u;
        us.forEach((u, i) => { if(u) later(() => send({ t: 'use', mi: m.mi, u: side * us.length + i }), ri(3000, 22000)); });
      }
    }
  };

  // ---------------- RACE ----------------
  const RS = () => window.NomiGames && window.NomiGames.race ? window.NomiGames.race._sim : null;
  const psum = p => p.m + p.b.reduce((t, x) => t + x, 0);
  const race = {
    begin(){ S.rc = { n: 0, t: 0, r: -1, me: -1, R: null, wait: false }; },
    msg(m){
      const a = S.rc, SIM = RS(); if(!SIM) return;
      if(m.t === 'me' && m.car && Array.isArray(m.car.p)){
        clearTimeout(a.t);
        if(m.end) return;
        a.t = later(() => {
          if(m.pend){
            // 合計が上がるパーツなら付け替える(同じなら、特性つきを選ぶ)
            const cur = m.car.p[m.pend.s], d = psum(m.pend) - psum(cur);
            send({ t: 'dec', ok: d > 0 || (d === 0 && m.pend.tr && !cur.tr) ? 1 : 0, n: ++a.n });
          }else if(m.tk > 0){
            const r = rnd(), can = m.car.tu.map((lv, i) => lv < 3 ? i : -1).filter(i => i >= 0), sc = Array.isArray(m.sc) ? m.sc.length : 0;
            if(r < .12 && sc < (m.R || 1)) send({ t: 'act', a: 'sc', n: ++a.n });
            else if(r < .45 && can.length) send({ t: 'act', a: 'tu', slot: can[ri(0, can.length - 1)], n: ++a.n });
            else send({ t: 'act', a: 'pt', n: ++a.n });
          }
        }, ri(700, 3000));
      }else if(m.t === 'pit' && m.c && Array.isArray(m.c.s)){
        // コーナーが多いコースならコーナー寄り、直線が長いなら最高速寄り
        const inf = SIM.courseInfo(m.c), fc = inf.len.c / inf.L, fs = inf.len.s / inf.L;
        let v = fc > .22 ? 2 : fs > .55 ? 1 : 0;
        if(rnd() < .15) v = ri(0, 2);
        if(v) later(() => send({ t: 'set', r: m.r, v, n: ++a.n }), ri(1500, 7000));
      }else if(m.t === 'rgo' && Array.isArray(m.cars) && m.c){
        a.r = m.r; a.me = m.cars.findIndex(x => x && x.id === id); a.R = SIM.newRace(m.c, []); a.wait = false;
      }else if(m.t === 'rs' && a.R && m.r === a.r && a.me >= 0 && Array.isArray(m.c) && m.c[a.me]){
        // 直線でニトロを使う(少し迷う間をあける)
        const x = m.c[a.me], d = x[0] / 10, fl = x[2], nl = (fl >> 3) & 3;
        if(a.wait || nl <= 0 || (fl & 3)) return;
        const i = SIM.segIdx(a.R, d); if(i < 0) return;
        const seg = a.R.c.s[i], left = a.R.st[i] + seg[1] - d;
        if(seg[0] === 's' && left > 150 && d > 60 && rnd() < .45){
          a.wait = true;
          later(() => { send({ t: 'nit', r: a.r, n: ++a.n }); later(() => { a.wait = false; }, 1500); }, ri(150, 900));
        }
      }
    }
  };

  const G = { tap, stop, ise, core, arena, race };
  // チャット: 人(CPU以外)がスタンプや一言を送ったら、たまにスタンプで返す(連投はしない)
  const REPLY = ['😂', '😭', '😱', '🔥', '👏', '🙏', '😎', '🤯'];
  let lastChat = 0;
  function onChat(o){
    if(!chat || o.id === id || o.id !== 0) return;
    if(rnd() > .35 || performance.now() - lastChat < 6000) return;
    lastChat = performance.now();
    setTimeout(() => chat({ t: 'chat', k: 's', v: REPLY[ri(0, REPLY.length - 1)] }), ri(700, 2600));
  }
  return {
    recv(o){
      if(!o || typeof o.t !== 'string') return;
      if(o.t === 'chat'){ onChat(o); return; }
      if(o.t === 'begin' && G[o.g]){ clear(); S = {}; gid = o.g; G[gid].begin(); return; }
      if(o.t === 'lobby' || o.t === 'closed'){ clear(); gid = null; return; }
      if(gid && o.g === gid) G[gid].msg(o);
    },
    stop(){ clear(); gid = null; }
  };
}
window.NomiBots = { make };
})();
