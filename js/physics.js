'use strict';
/* 潮珠 SHIODAMA — 自作の物理(玉とピンの衝突・反射・重力)。描画やゲームの決まりは持たない。 */
SD.Phys = (function () {
  const BAL = SD.D.BAL;
  const SUB = 1 / 240;

  function makeWorld(layout, pegR) {
    const W = { w: BAL.boardW, h: BAL.boardH, pegs: [], segs: [], balls: [], t: 0, nextId: 1, bucket: null };
    for (const p of layout.pegs) addPeg(W, p.x, p.y, 'normal', pegR, p.mv);
    for (const b of layout.bumpers || []) { const p = addPeg(W, b.x, b.y, 'bumper', b.r); p.fixed = true; }
    for (const s of layout.segs || []) W.segs.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3] });
    return W;
  }

  function addPeg(W, x, y, type, r, mv) {
    const p = { id: W.nextId++, x, y, x0: x, y0: y, r: r || BAL.pegR, type, state: 'alive', hp: 0, mv: mv || null, flash: 0 };
    W.pegs.push(p);
    return p;
  }

  function pegAt(p, t, out) {
    if (!p.mv) { out.x = p.x0; out.y = p.y0; out.vx = 0; out.vy = 0; return out; }
    const a = p.mv.w * t + p.mv.ph;
    out.x = p.x0 + p.mv.ax * Math.sin(a); out.y = p.y0;
    out.vx = p.mv.ax * p.mv.w * Math.cos(a); out.vy = 0;
    return out;
  }

  function addBall(W, o) {
    const b = Object.assign({
      x: BAL.launchX, y: BAL.launchY, vx: 0, vy: 0, r: BAL.ballR, g: 1, e: 1, crush: false,
      pierce: 0, pierceT: 0, wrap: 0, magnet: 0, echo: 0, bottom: 0, val: 1, child: false,
      life: 0, stuckT: 0, sx: 0, sy: 0, lastPeg: 0, lastPegT: -1, dead: false, crushing: false, trail: [],
    }, o);
    b.sx = b.x; b.sy = b.y;
    W.balls.push(b);
    return b;
  }

  function cloneWorld(W) {
    const C = { w: W.w, h: W.h, t: W.t, nextId: W.nextId, segs: W.segs, balls: [], bucket: W.bucket ? Object.assign({}, W.bucket) : null };
    C.pegs = W.pegs.map(p => Object.assign({}, p));
    return C;
  }

  const tmp = { x: 0, y: 0, vx: 0, vy: 0 };

  // 1つの玉を dt だけ進める。H は当たりを受け取るゲーム側の関数群(予測線のときは null)
  function moveBall(W, b, dt, t, H) {
    const speed0 = Math.hypot(b.vx, b.vy);
    if (b.magnet > 0) {
      let best = null, bd = 80 * 80;
      for (const p of W.pegs) {
        if (p.state !== 'alive' || p.type === 'rock' || p.type === 'bumper') continue;
        const dx = p.x - b.x, dy = p.y - b.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) {
        const d = Math.sqrt(bd) || 1;
        b.vx += (best.x - b.x) / d * 420 * b.magnet * dt;
        b.vy += (best.y - b.y) / d * 420 * b.magnet * dt;
      }
    }
    b.vy += BAL.gravity * b.g * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > BAL.maxSpd) { b.vx *= BAL.maxSpd / sp; b.vy *= BAL.maxSpd / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.pierceT > 0) b.pierceT -= dt;

    // 左右の壁と天井
    if (b.x < b.r) {
      if (b.wrap > 0) { b.wrap--; b.x = W.w - b.r - 1; if (H && H.wrap) H.wrap(b); }
      else { b.x = b.r; b.vx = Math.abs(b.vx) * BAL.wallE; if (H) H.wall(b); }
    } else if (b.x > W.w - b.r) {
      if (b.wrap > 0) { b.wrap--; b.x = b.r + 1; if (H && H.wrap) H.wrap(b); }
      else { b.x = W.w - b.r; b.vx = -Math.abs(b.vx) * BAL.wallE; if (H) H.wall(b); }
    }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * BAL.wallE; }

    // 斜めの板
    for (const s of W.segs) {
      const ex = s.x2 - s.x1, ey = s.y2 - s.y1, L2 = ex * ex + ey * ey;
      let u = ((b.x - s.x1) * ex + (b.y - s.y1) * ey) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cx = s.x1 + ex * u, cy = s.y1 + ey * u, dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
      if (d2 < b.r * b.r && d2 > 1e-6) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        b.x = cx + nx * b.r; b.y = cy + ny * b.r;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + BAL.wallE) * vn * nx; b.vy -= (1 + BAL.wallE) * vn * ny; }
      }
    }

    // ピン
    b.crushing = false;
    for (const p of W.pegs) {
      if (p.state === 'gone') continue;
      const q = pegAt(p, t, tmp);
      const dx = b.x - q.x, dy = b.y - q.y, rr = b.r + p.r, d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
      const fresh = !(b.lastPeg === p.id && t - b.lastPegT < 0.12);
      if (p.type === 'bumper') {
        b.x = q.x + nx * rr; b.y = q.y + ny * rr;
        const vn = (b.vx - q.vx) * nx + (b.vy - q.vy) * ny;
        if (vn < 0) { b.vx -= (1 + BAL.bumperE) * vn * nx; b.vy -= (1 + BAL.bumperE) * vn * ny; }
        if (fresh) { b.lastPeg = p.id; b.lastPegT = t; p.flash = 1; if (H && H.bump) H.bump(b, p); }
        continue;
      }
      const hard = p.type === 'rock' || p.type === 'barn';
      const pass = !hard && (b.pierceT > 0 || b.pierce > 0 || (b.crush && speed0 > 190));
      if (pass) {
        if (fresh && p.state === 'alive') {
          b.lastPeg = p.id; b.lastPegT = t;
          if (b.pierceT <= 0 && b.pierce > 0) b.pierce--;
          if (b.crush && b.pierceT <= 0 && b.pierce <= 0) { b.crushing = true; b.vx *= 0.9; b.vy *= 0.9; }
          if (H) H.hit(b, p); else p.state = 'lit';
          if (b.crushing && p.state === 'lit') p.state = 'gone';
        }
        continue;
      }
      b.x = q.x + nx * rr; b.y = q.y + ny * rr;
      const rvx = b.vx - q.vx, rvy = b.vy - q.vy, vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const e = BAL.pegE * b.e;
        const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
        const nvn = -vn * e, nvt = vt * (1 - BAL.friction);
        b.vx = nx * nvn + tx * nvt + q.vx; b.vy = ny * nvn + ty * nvt + q.vy;
      }
      if (fresh) { b.lastPeg = p.id; b.lastPegT = t; if (H) H.hit(b, p); else if (p.state === 'alive' && p.type !== 'rock') p.state = 'lit'; }
    }

    // 網(遺物)
    const bk = W.bucket;
    if (bk && b.vy > 0 && b.y > bk.y - 4 && b.y < bk.y + 10 && Math.abs(b.x - bk.x) < bk.w / 2 - 2) {
      if (H && H.bucket) H.bucket(b);
      b.dead = true;
      return;
    }

    // 底
    if (b.y > W.h + b.r) {
      if (b.bottom > 0) {
        b.bottom--; b.y = W.h - b.r; b.vy = -Math.max(520, Math.abs(b.vy) * 0.95);
        if (H && H.bottom) H.bottom(b);
      } else if (H && H.exit && H.exit(b)) {
        // 上から戻ってくる(イルカ玉など)
      } else b.dead = true;
    }

    // 引っかかり対策: 動かないままなら周りの点灯ピンを消して少し押す
    b.life += dt;
    if (Math.hypot(b.x - b.sx, b.y - b.sy) > 18) { b.sx = b.x; b.sy = b.y; b.stuckT = 0; }
    else {
      b.stuckT += dt;
      if (b.stuckT > BAL.stuckTime) {
        b.stuckT = 0;
        for (const p of W.pegs) {
          if (p.state === 'gone' || p.type === 'bumper') continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + p.r + 10) {
            if (p.state === 'lit' || p.type === 'rock' || p.type === 'barn') p.state = 'gone';
          }
        }
        b.vx += (b.x < W.w / 2 ? 60 : -60); b.vy -= 40;
      }
    }
    if (b.life > BAL.maxBallLife) b.dead = true;
  }

  function updatePegs(W) {
    for (const p of W.pegs) if (p.mv) { const q = pegAt(p, W.t, tmp); p.x = q.x; p.y = q.y; }
  }

  function step(W, dt, H) {
    let left = dt;
    while (left > 1e-9) {
      const h = left > SUB ? SUB : left;
      left -= h;
      W.t += h;
      updatePegs(W);
      for (const b of W.balls) if (!b.dead) moveBall(W, b, h, W.t, H);
      if (W.bucket) {
        const bk = W.bucket;
        bk.x += bk.dir * bk.spd * h;
        if (bk.x < bk.w / 2 + 4) { bk.x = bk.w / 2 + 4; bk.dir = 1; }
        if (bk.x > W.w - bk.w / 2 - 4) { bk.x = W.w - bk.w / 2 - 4; bk.dir = -1; }
      }
      if (W.balls.some(b => b.dead)) W.balls = W.balls.filter(b => !b.dead);
    }
  }

  // 予測線: 盤面は変えずに、玉がどう飛ぶかの点を返す
  function preview(W, props, contacts, maxLen) {
    const pegs = W.pegs.map(p => Object.assign({}, p));
    const V = { w: W.w, h: W.h, pegs, segs: W.segs, balls: [], bucket: null };
    const b = addBall(V, props);
    b.magnet = 0; // 予測線では吸い寄せを無視する(重くなるため)
    const pts = [{ x: b.x, y: b.y }];
    let hits = 0, len = 0, t = W.t, lx = b.x, ly = b.y;
    const H = {
      hit(ball, p) { if (p.state === 'alive') p.state = 'lit'; hits++; },
      wall() {}, bump() { hits++; },
    };
    for (let i = 0; i < 2400 && !b.dead; i++) {
      t += SUB;
      moveBall(V, b, SUB, t, H);
      len += Math.hypot(b.x - lx, b.y - ly); lx = b.x; ly = b.y;
      if (i % 3 === 0) pts.push({ x: b.x, y: b.y });
      if (hits >= contacts || len > maxLen) break;
    }
    pts.push({ x: b.x, y: b.y });
    return pts;
  }

  return { makeWorld, addPeg, addBall, cloneWorld, step, preview, pegAt };
})();
