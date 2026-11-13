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

// id: このCPUの番号 / send(obj): ホストへ送る
function make(id, send){
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
              const free = m.p.findIndex(c => !c.w);
              if(free >= 0) slot = free;
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
        us.forEach((u, i) => { if(u) later(() => send({ t: 'use', mi: m.mi, u: side * 3 + i }), ri(3000, 22000)); });
      }
    }
  };

  const G = { tap, stop, ise, core, arena };
  return {
    recv(o){
      if(!o || typeof o.t !== 'string') return;
      if(o.t === 'begin' && G[o.g]){ clear(); S = {}; gid = o.g; G[gid].begin(); return; }
      if(o.t === 'lobby' || o.t === 'closed'){ clear(); gid = null; return; }
      if(gid && o.g === gid) G[gid].msg(o);
    },
    stop(){ clear(); gid = null; }
  };
}
window.NomiBots = { make };
})();
