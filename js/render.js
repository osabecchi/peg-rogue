'use strict';
/* 潮珠 SHIODAMA — Canvas 2D の描画と演出。ゲームの状態は読むだけで変えない。 */
SD.Render = (function () {
  const D = SD.D, BAL = D.BAL;
  const RD = {};
  let cv, cx, dpr = 1, CW = 0, CH = 0, time = 0;
  const LW = 360, LH = 720, SY = 40, BY = 196, BAR = 666, FLOOR = 172;
  const view = RD.view = { s: 1, ox: 0, oy: 0, side: 0 };
  RD.L = { LW, LH, SY, BY, BAR, FLOOR };
  const P = [];        // 粒子
  const TX = [];       // 浮かぶ文字
  const RINGS = [];    // 波紋
  const pending = [];  // 遅れて出す演出
  const corpses = [];  // 倒れた敵の消える演出
  const shots = [];    // 自分から敵へ飛ぶ光
  const amb = [];      // まわりの泡
  RD.hitStop = 0;
  let shake = 0, flashA = 0, flashCol = '#fff', banner = null, tally = null, hitPop = 0, lastHits = 0;
  let hurtFlash = 0, bigT = 0, inkT = 0;
  const vis = {};      // 敵ごとの見た目の状態
  RD.hits = [];        // 画面上のボタンの当たり範囲(論理座標)

  function settings() { return (SD.G.save && SD.G.save.settings) || SD.defaultSettings(); }
  function q() { return settings().quality !== 'low'; }

  RD.init = function (canvas) {
    cv = canvas; cx = cv.getContext('2d');
    for (let i = 0; i < 40; i++) amb.push(newBubble(true));
    RD.resize();
  };
  RD.resize = function () {
    const lowQ = !q();
    dpr = Math.min(window.devicePixelRatio || 1, lowQ ? 1 : 2);
    CW = window.innerWidth; CH = window.innerHeight;
    cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
    cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
    // スマホの切り欠きや下のバーを避けて、遊ぶ列をその内側に収める
    const sp = document.getElementById('safe'), cs = sp ? getComputedStyle(sp) : null;
    const it = cs ? parseFloat(cs.paddingTop) || 0 : 0, ib = cs ? parseFloat(cs.paddingBottom) || 0 : 0;
    const AH = Math.max(200, CH - it - ib);
    let s = Math.min(CW / LW, AH / LH);
    const free = CW / s - LW;
    view.side = free >= 300 ? Math.min(220, free / 2 - 6) : 0;
    view.s = s; view.ox = (CW - LW * s) / 2; view.oy = it + (AH - LH * s) / 2;
  };
  RD.toLogical = function (x, y) { return { x: (x - view.ox) / view.s, y: (y - view.oy) / view.s }; };
  RD.toScreen = function (x, y) { return { x: x * view.s + view.ox, y: y * view.s + view.oy }; };

  /* ---------- 小さな道具 ---------- */
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function shade(hex, k, a) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return a == null ? 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')' : 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + a + ')';
  }
  RD.shade = shade; RD.rgba = rgba;
  function circle(x, y, r) { cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); }
  function ell(x, y, rx, ry, rot) { cx.beginPath(); cx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2); }
  const glowCache = {};
  function glowSprite(col) {
    if (glowCache[col]) return glowCache[col];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 0.9)); gr.addColorStop(0.35, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (glowCache[col] = c);
  }
  function glow(x, y, r, col, a) {
    cx.globalAlpha = a == null ? 1 : a;
    cx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
    cx.globalAlpha = 1;
  }
  function text(str, x, y, size, col, o) {
    o = o || {};
    cx.font = (o.weight || 700) + ' ' + size + 'px ' + (o.font || '"Zen Maru Gothic", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif');
    cx.textAlign = o.align || 'center'; cx.textBaseline = o.base || 'middle';
    if (o.stroke) { cx.lineWidth = o.stroke; cx.strokeStyle = o.sc || 'rgba(4,12,28,0.85)'; cx.lineJoin = 'round'; cx.strokeText(str, x, y); }
    cx.fillStyle = col; cx.fillText(str, x, y);
  }
  RD.NUM = '"Fredoka", "Zen Maru Gothic", sans-serif';

  /* ---------- 背景 ---------- */
  function newBubble(init) {
    return { x: Math.random() * (LW + 400) - 200, y: init ? Math.random() * LH : LH + 10, r: 1 + Math.random() * 3, v: 10 + Math.random() * 25, w: Math.random() * 6.28 };
  }
  function areaFor() {
    const R = SD.G.R;
    if (!R) return D.AREAS[0];
    return D.AREAS[Math.min(3, R.area)];
  }
  function drawBackground(dt, area, screenOnly) {
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = cx.createLinearGradient(0, 0, 0, CH);
    g.addColorStop(0, area.bgTop); g.addColorStop(1, area.bgBot);
    cx.fillStyle = g; cx.fillRect(0, 0, CW, CH);
    setCol();
    // 光の筋
    if (q() && area.light > 0.05) {
      cx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 80 + Math.sin(time * 0.3 + i * 1.7) * 30;
        const w = 26 + Math.sin(time * 0.5 + i) * 10;
        const gr = cx.createLinearGradient(0, -20, 0, LH * 0.8);
        gr.addColorStop(0, 'rgba(220,250,255,' + (0.11 * area.light) + ')'); gr.addColorStop(1, 'rgba(220,250,255,0)');
        cx.fillStyle = gr;
        cx.beginPath(); cx.moveTo(x - w * 0.4, -20); cx.lineTo(x + w * 0.4, -20); cx.lineTo(x + w * 2.4 - 60, LH * 0.8); cx.lineTo(x - w * 2 - 60, LH * 0.8); cx.closePath(); cx.fill();
      }
      cx.globalCompositeOperation = 'source-over';
    }
    // 泡
    cx.fillStyle = 'rgba(220,245,255,0.35)';
    for (const b of amb) {
      b.y -= b.v * dt; b.w += dt * 2; const x = b.x + Math.sin(b.w) * 4;
      if (b.y < -10) Object.assign(b, newBubble(false));
      circle(x, b.y, b.r); cx.fill();
    }
    if (area.light < 0.3) {
      // 深い海の発光プランクトン
      for (let i = 0; i < 18; i++) {
        const x = ((i * 97.3 + time * 6) % (LW + 300)) - 150, y = (i * 53.7 + Math.sin(time * 0.4 + i) * 20) % LH;
        glow(x, y, 6, i % 3 ? '#7ff0e0' : '#c9a6ff', 0.25 + 0.2 * Math.sin(time * 2 + i));
      }
    }
  }
  function setCol(ox, oy) {
    const sh = shake * (settings().shake == null ? 1 : settings().shake);
    const sx = sh ? (Math.random() - 0.5) * sh * 2 : 0, sy = sh ? (Math.random() - 0.5) * sh * 2 : 0;
    cx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (view.ox + sx * view.s + (ox || 0)), dpr * (view.oy + sy * view.s + (oy || 0)));
  }

  /* ---------- 生き物の絵 ---------- */
  // 足もと (x, y) を基準に、大きさ s(だいたい高さの半分)で描く
  const DRAW = {};
  function eye(x, y, r, look) {
    cx.fillStyle = '#fff'; circle(x, y, r); cx.fill();
    cx.fillStyle = '#0b1020'; circle(x + (look || 0) * r * 0.3, y, r * 0.55); cx.fill();
    cx.fillStyle = '#fff'; circle(x + r * 0.15, y - r * 0.25, r * 0.2); cx.fill();
  }
  function bodyGrad(x, y, r, col) {
    const g = cx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r * 1.2);
    g.addColorStop(0, shade(col, 0.35)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.45));
    return g;
  }
  DRAW.fish = function (x, y, s, d, t) {
    const by = y - s * 1.1, w = s * 1.25, h = s * 0.8;
    cx.fillStyle = shade(d.col, -0.3);
    cx.beginPath(); cx.moveTo(x + w * 0.7, by); cx.lineTo(x + w * 1.35, by - h * 0.8 + Math.sin(t * 8) * 3); cx.lineTo(x + w * 1.35, by + h * 0.8 - Math.sin(t * 8) * 3); cx.closePath(); cx.fill();
    if (d.fin) { cx.beginPath(); cx.moveTo(x, by - h * 0.4); cx.quadraticCurveTo(x + w * 0.6, by - h * 2.2, x + w * 0.9, by - h * 0.2); cx.fill(); }
    cx.fillStyle = bodyGrad(x, by, w, d.col); ell(x, by, w, h); cx.fill();
    cx.fillStyle = shade(d.col, -0.25); cx.beginPath(); cx.moveTo(x - w * 0.1, by - h * 0.9); cx.lineTo(x + w * 0.4, by - h * 1.5); cx.lineTo(x + w * 0.5, by - h * 0.7); cx.fill();
    if (d.teeth) {
      cx.fillStyle = '#1a0b10'; ell(x - w * 0.75, by + h * 0.15, w * 0.32, h * 0.38); cx.fill();
      cx.fillStyle = '#f4f1e8';
      for (let i = 0; i < 4; i++) { cx.beginPath(); cx.moveTo(x - w * 0.95 + i * w * 0.14, by - h * 0.15); cx.lineTo(x - w * 0.9 + i * w * 0.14, by + h * 0.25); cx.lineTo(x - w * 0.85 + i * w * 0.14, by - h * 0.15); cx.fill(); }
    }
    if (d.glow) glow(x - w * 1.0, by - h * 1.3, s * 0.7, '#7ff0e0', 0.8 + Math.sin(t * 5) * 0.2);
    eye(x - w * 0.5, by - h * 0.25, s * 0.22, -1);
  };
  DRAW.shrimp = function (x, y, s, d, t) {
    const by = y - s * 0.9;
    cx.strokeStyle = shade(d.col, -0.2); cx.lineWidth = s * 0.08;
    cx.beginPath(); cx.moveTo(x - s * 0.9, by - s * 0.3); cx.quadraticCurveTo(x - s * 2, by - s * 1.8, x - s * 1.6, by - s * 1.9 + Math.sin(t * 6) * 3); cx.stroke();
    cx.beginPath(); cx.moveTo(x - s * 0.9, by - s * 0.3); cx.quadraticCurveTo(x - s * 1.4, by - s * 2, x - s * 0.6, by - s * 2.1); cx.stroke();
    for (let i = 4; i >= 0; i--) {
      const a = i * 0.45, px = x - s * 0.6 + Math.cos(a) * s * 0.8 + s * 0.4, py = by - Math.sin(a) * s * 0.5 + i * s * 0.12;
      cx.fillStyle = bodyGrad(px, py, s * 0.5, d.col); ell(px, py, s * (0.5 - i * 0.05), s * (0.42 - i * 0.04)); cx.fill();
    }
    cx.fillStyle = shade(d.col, -0.2); cx.beginPath(); cx.moveTo(x + s * 0.9, by + s * 0.3); cx.lineTo(x + s * 1.4, by - s * 0.1); cx.lineTo(x + s * 1.4, by + s * 0.7); cx.fill();
    eye(x - s * 0.85, by - s * 0.35, s * 0.17, -1);
  };
  DRAW.hermit = function (x, y, s, d, t) {
    const by = y - s * 0.9;
    cx.fillStyle = bodyGrad(x + s * 0.3, by - s * 0.2, s, '#d9c7a8'); circle(x + s * 0.3, by - s * 0.2, s * 0.95); cx.fill();
    cx.strokeStyle = 'rgba(90,60,30,0.6)'; cx.lineWidth = s * 0.1;
    cx.beginPath(); for (let a = 0; a < 9; a += 0.2) { const r = s * 0.85 * (1 - a / 10); const px = x + s * 0.3 + Math.cos(a) * r, py = by - s * 0.2 + Math.sin(a) * r; a ? cx.lineTo(px, py) : cx.moveTo(px, py); } cx.stroke();
    cx.fillStyle = bodyGrad(x - s * 0.6, by + s * 0.3, s * 0.6, d.col); ell(x - s * 0.6, by + s * 0.35, s * 0.55, s * 0.4); cx.fill();
    cx.fillStyle = shade(d.col, -0.15); ell(x - s * 1.1, by + s * 0.55, s * 0.32, s * 0.24, 0.4); cx.fill();
    eye(x - s * 0.8, by - s * 0.15, s * 0.16, -1);
  };
  DRAW.puffer = function (x, y, s, d, t) {
    const r = s * (d.spiky ? 1.05 : 0.95) * (1 + Math.sin(t * 3) * 0.04), by = y - r - s * 0.1;
    cx.fillStyle = shade(d.col, -0.35);
    for (let i = 0; i < 18; i++) { const a = i / 18 * 6.283; cx.beginPath(); cx.moveTo(x + Math.cos(a - 0.12) * r, by + Math.sin(a - 0.12) * r); cx.lineTo(x + Math.cos(a) * r * 1.3, by + Math.sin(a) * r * 1.3); cx.lineTo(x + Math.cos(a + 0.12) * r, by + Math.sin(a + 0.12) * r); cx.fill(); }
    cx.fillStyle = bodyGrad(x, by, r, d.col); circle(x, by, r); cx.fill();
    cx.fillStyle = 'rgba(255,255,255,0.35)'; ell(x, by + r * 0.45, r * 0.65, r * 0.35); cx.fill();
    cx.fillStyle = shade(d.col, -0.2); cx.beginPath(); cx.moveTo(x + r * 0.9, by); cx.lineTo(x + r * 1.4, by - r * 0.35); cx.lineTo(x + r * 1.4, by + r * 0.35); cx.fill();
    eye(x - r * 0.4, by - r * 0.25, r * 0.22, -1);
    cx.fillStyle = '#3a1a10'; ell(x - r * 0.85, by + r * 0.15, r * 0.12, r * 0.08); cx.fill();
  };
  DRAW.crab = function (x, y, s, d, t) {
    const by = y - s * (d.long ? 1.4 : 0.85), w = s * 1.1;
    cx.strokeStyle = shade(d.col, -0.3); cx.lineWidth = s * 0.13; cx.lineCap = 'round';
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
      const lx = x + side * w * (0.3 + i * 0.25), k = d.long ? 1.6 : 0.9;
      cx.beginPath(); cx.moveTo(lx, by + s * 0.2); cx.lineTo(lx + side * s * 0.4 * k, by + s * 0.1 * k); cx.lineTo(lx + side * s * 0.55 * k, y); cx.stroke();
    }
    const claw = (side) => {
      const ax = x + side * w * 1.05, ay = by - s * 0.35 + Math.sin(t * 4 + side) * 2;
      cx.beginPath(); cx.moveTo(x + side * w * 0.6, by); cx.lineTo(ax, ay + s * 0.2); cx.stroke();
      cx.fillStyle = bodyGrad(ax, ay, s * 0.5, d.col);
      cx.beginPath(); cx.ellipse(ax, ay - s * 0.1, s * 0.42, s * 0.32, side * 0.5, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = shade(d.col, -0.4); cx.beginPath(); cx.moveTo(ax - side * s * 0.05, ay - s * 0.1); cx.lineTo(ax + side * s * 0.45, ay - s * 0.35); cx.lineTo(ax + side * s * 0.35, ay); cx.fill();
    };
    claw(-1); claw(1);
    cx.fillStyle = bodyGrad(x, by, w, d.col); ell(x, by, w, s * 0.62); cx.fill();
    cx.strokeStyle = shade(d.col, -0.3); cx.lineWidth = s * 0.07;
    cx.beginPath(); cx.moveTo(x - s * 0.25, by - s * 0.5); cx.lineTo(x - s * 0.3, by - s * 0.95); cx.moveTo(x + s * 0.25, by - s * 0.5); cx.lineTo(x + s * 0.3, by - s * 0.95); cx.stroke();
    eye(x - s * 0.3, by - s * 1.0, s * 0.16, -1); eye(x + s * 0.3, by - s * 1.0, s * 0.16, -1);
    if (d.crown) {
      cx.fillStyle = '#ffd25e';
      cx.beginPath(); cx.moveTo(x - s * 0.45, by - s * 0.45); cx.lineTo(x - s * 0.5, by - s * 0.85); cx.lineTo(x - s * 0.22, by - s * 0.62); cx.lineTo(x, by - s * 0.95); cx.lineTo(x + s * 0.22, by - s * 0.62); cx.lineTo(x + s * 0.5, by - s * 0.85); cx.lineTo(x + s * 0.45, by - s * 0.45); cx.fill();
    }
  };
  DRAW.slug = function (x, y, s, d, t) {
    const by = y - s * 0.45;
    cx.fillStyle = bodyGrad(x, by, s * 1.3, d.col);
    cx.beginPath(); cx.moveTo(x - s * 1.2, by + s * 0.3); cx.quadraticCurveTo(x - s * 1.3, by - s * 0.7, x - s * 0.4, by - s * 0.6); cx.quadraticCurveTo(x + s * 0.8, by - s * 0.8, x + s * 1.3, by + s * 0.3); cx.closePath(); cx.fill();
    for (let i = 0; i < 6; i++) {
      const px = x - s * 0.6 + i * s * 0.33, py = by - s * 0.6;
      cx.fillStyle = i % 2 ? '#ffb35c' : shade(d.col, 0.3);
      ell(px, py - s * 0.3 + Math.sin(t * 4 + i) * 2, s * 0.13, s * 0.32); cx.fill();
    }
    cx.strokeStyle = shade(d.col, -0.3); cx.lineWidth = s * 0.08;
    cx.beginPath(); cx.moveTo(x - s * 1, by - s * 0.3); cx.lineTo(x - s * 1.25, by - s * 0.85); cx.moveTo(x - s * 0.8, by - s * 0.4); cx.lineTo(x - s * 0.9, by - s * 0.95); cx.stroke();
  };
  DRAW.octo = function (x, y, s, d, t) {
    const by = y - s * 1.3;
    cx.strokeStyle = d.col; cx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const sx = x - s * 0.7 + i * s * 0.28; cx.lineWidth = s * 0.26;
      cx.beginPath(); cx.moveTo(sx, by + s * 0.3);
      cx.quadraticCurveTo(sx + Math.sin(t * 3 + i) * s * 0.5, by + s * 0.9, sx + (i - 2.5) * s * 0.3, y - s * 0.05); cx.stroke();
    }
    cx.fillStyle = bodyGrad(x, by - s * 0.2, s * 1.1, d.col); ell(x, by - s * 0.2, s * 0.95, s * 0.9); cx.fill();
    cx.fillStyle = rgba('#ffffff', 0.18); for (let i = 0; i < 4; i++) { circle(x - s * 0.3 + i * s * 0.25, by - s * 0.6 + (i % 2) * s * 0.2, s * 0.08); cx.fill(); }
    eye(x - s * 0.35, by + s * 0.05, s * 0.2, -1); eye(x + s * 0.2, by + s * 0.05, s * 0.2, -1);
  };
  DRAW.eel = function (x, y, s, d, t) {
    cx.strokeStyle = d.col; cx.lineCap = 'round'; cx.lineWidth = s * 0.55;
    cx.beginPath();
    for (let i = 0; i <= 14; i++) { const k = i / 14, px = x + s * 1.3 - k * s * 2.4, py = y - s * 0.4 - k * s * 1.4 + Math.sin(t * 3 + k * 5) * s * 0.2 * (1 - k); i ? cx.lineTo(px, py) : cx.moveTo(px, py); }
    cx.stroke();
    const hx = x - s * 1.1, hy = y - s * 1.8;
    cx.fillStyle = bodyGrad(hx, hy, s * 0.6, d.col); ell(hx, hy, s * 0.6, s * 0.45, -0.3); cx.fill();
    cx.fillStyle = '#2a1010'; cx.beginPath(); cx.moveTo(hx - s * 0.55, hy); cx.lineTo(hx - s * 0.05, hy + s * 0.15); cx.lineTo(hx - s * 0.5, hy + s * 0.35); cx.fill();
    eye(hx - s * 0.15, hy - s * 0.2, s * 0.14, -1);
    cx.fillStyle = 'rgba(0,0,0,0.2)'; for (let i = 0; i < 5; i++) { circle(x + s * 0.8 - i * s * 0.4, y - s * 0.6 - i * s * 0.25, s * 0.08); cx.fill(); }
  };
  DRAW.jelly = function (x, y, s, d, t) {
    const by = y - s * 1.9 + Math.sin(t * 2) * s * 0.15, a = d.ghost ? 0.45 : 0.85;
    cx.globalAlpha *= a;
    cx.strokeStyle = rgba(d.col, 0.7); cx.lineWidth = s * 0.07;
    for (let i = 0; i < 5; i++) {
      const sx = x - s * 0.6 + i * s * 0.3;
      cx.beginPath(); cx.moveTo(sx, by);
      for (let k = 1; k <= 6; k++) cx.lineTo(sx + Math.sin(t * 3 + k + i) * s * 0.15, by + k * s * 0.28);
      cx.stroke();
    }
    const g = cx.createRadialGradient(x, by - s * 0.4, s * 0.1, x, by - s * 0.2, s * 1.1);
    g.addColorStop(0, shade(d.col, 0.5)); g.addColorStop(1, rgba(d.col, 0.5));
    cx.fillStyle = g;
    cx.beginPath(); cx.moveTo(x - s * 0.95, by); cx.quadraticCurveTo(x - s, by - s * 1.3, x, by - s * 1.3); cx.quadraticCurveTo(x + s, by - s * 1.3, x + s * 0.95, by); cx.quadraticCurveTo(x, by - s * 0.25, x - s * 0.95, by); cx.fill();
    if (d.crest) { cx.fillStyle = rgba('#7fb0ff', 0.8); cx.beginPath(); cx.moveTo(x - s * 0.6, by - s * 1.1); cx.quadraticCurveTo(x, by - s * 2.1, x + s * 0.7, by - s * 1.0); cx.fill(); }
    cx.fillStyle = rgba('#ffffff', 0.5); ell(x - s * 0.3, by - s * 0.85, s * 0.2, s * 0.12, -0.4); cx.fill();
    cx.globalAlpha /= a;
    eye(x - s * 0.3, by - s * 0.45, s * 0.12, -1); eye(x + s * 0.25, by - s * 0.45, s * 0.12, -1);
  };
  DRAW.squid = function (x, y, s, d, t) {
    const by = y - s * 1.6;
    cx.strokeStyle = shade(d.col, -0.1); cx.lineCap = 'round';
    for (let i = 0; i < 6; i++) { cx.lineWidth = s * (i < 2 ? 0.12 : 0.18); cx.beginPath(); cx.moveTo(x - s * 0.4 + i * s * 0.16, by + s * 0.5); cx.quadraticCurveTo(x - s * 0.5 + i * s * 0.2 + Math.sin(t * 3 + i) * s * 0.4, by + s * 1.1, x - s * 0.7 + i * s * 0.28, y - (i < 2 ? s * 0.4 : 0)); cx.stroke(); }
    cx.fillStyle = bodyGrad(x, by - s * 0.3, s, d.col);
    cx.beginPath(); cx.moveTo(x - s * 0.55, by + s * 0.5); cx.quadraticCurveTo(x - s * 0.7, by - s * 1, x, by - s * 1.6); cx.quadraticCurveTo(x + s * 0.7, by - s * 1, x + s * 0.55, by + s * 0.5); cx.fill();
    cx.fillStyle = shade(d.col, -0.2); cx.beginPath(); cx.moveTo(x - s * 0.3, by - s * 1.2); cx.lineTo(x - s * 0.9, by - s * 1.5); cx.lineTo(x - s * 0.15, by - s * 1.55); cx.moveTo(x + s * 0.3, by - s * 1.2); cx.lineTo(x + s * 0.9, by - s * 1.5); cx.lineTo(x + s * 0.15, by - s * 1.55); cx.fill();
    if (d.boss) for (let i = 0; i < 6; i++) glow(x - s * 0.4 + i * s * 0.16, by - s * 0.6 + (i % 2) * s * 0.3, s * 0.2, '#ffd25e', 0.5);
    else for (let i = 0; i < 3; i++) glow(x - s * 0.25 + i * s * 0.25, by - s * 0.7, s * 0.25, '#9fdcff', 0.6 + 0.3 * Math.sin(t * 4 + i));
    eye(x - s * 0.25, by + s * 0.15, s * 0.16, -1); eye(x + s * 0.25, by + s * 0.15, s * 0.16, -1);
  };
  DRAW.seahorse = function (x, y, s, d, t) {
    const by = y - s * 1.5 + Math.sin(t * 2.5) * s * 0.1;
    cx.strokeStyle = d.col; cx.lineCap = 'round'; cx.lineWidth = s * 0.4;
    cx.beginPath(); cx.moveTo(x, by - s * 0.6); cx.quadraticCurveTo(x + s * 0.6, by, x + s * 0.1, by + s * 0.7); cx.quadraticCurveTo(x - s * 0.3, by + s * 1.2, x + s * 0.25, by + s * 1.3); cx.stroke();
    cx.fillStyle = bodyGrad(x, by - s * 0.7, s * 0.5, d.col); ell(x, by - s * 0.75, s * 0.42, s * 0.36); cx.fill();
    cx.strokeStyle = shade(d.col, -0.1); cx.lineWidth = s * 0.2; cx.beginPath(); cx.moveTo(x - s * 0.3, by - s * 0.7); cx.lineTo(x - s * 0.8, by - s * 0.55); cx.stroke();
    cx.fillStyle = shade(d.col, 0.3); cx.beginPath(); cx.moveTo(x + s * 0.3, by - s * 0.2); cx.lineTo(x + s * 0.7, by - s * 0.3 + Math.sin(t * 10) * 2); cx.lineTo(x + s * 0.4, by + s * 0.2); cx.fill();
    eye(x - s * 0.1, by - s * 0.82, s * 0.12, -1);
  };
  DRAW.ray = function (x, y, s, d, t) {
    const by = y - s * 0.9, f = Math.sin(t * 3) * s * 0.2;
    cx.strokeStyle = shade(d.col, -0.3); cx.lineWidth = s * 0.08; cx.beginPath(); cx.moveTo(x + s * 0.6, by); cx.quadraticCurveTo(x + s * 1.6, by - s * 0.2, x + s * 2, by - s * 0.4); cx.stroke();
    cx.fillStyle = bodyGrad(x, by, s * 1.3, d.col);
    cx.beginPath(); cx.moveTo(x - s * 1.1, by); cx.quadraticCurveTo(x - s * 0.2, by - s * 0.9 - f, x + s * 0.7, by); cx.quadraticCurveTo(x - s * 0.2, by + s * 0.6 + f, x - s * 1.1, by); cx.fill();
    if (d.saw) {
      cx.fillStyle = '#d8dee8'; cx.fillRect(x - s * 2.1, by - s * 0.08, s * 1.1, s * 0.16);
      for (let i = 0; i < 6; i++) { cx.beginPath(); cx.moveTo(x - s * 2.05 + i * s * 0.18, by - s * 0.08); cx.lineTo(x - s * 1.98 + i * s * 0.18, by - s * 0.22); cx.lineTo(x - s * 1.92 + i * s * 0.18, by - s * 0.08); cx.fill(); cx.beginPath(); cx.moveTo(x - s * 2.05 + i * s * 0.18, by + s * 0.08); cx.lineTo(x - s * 1.98 + i * s * 0.18, by + s * 0.22); cx.lineTo(x - s * 1.92 + i * s * 0.18, by + s * 0.08); cx.fill(); }
    }
    eye(x - s * 0.7, by - s * 0.2, s * 0.13, -1);
  };
  DRAW.barnacle = function (x, y, s, d, t) {
    for (let i = 0; i < 5; i++) {
      const px = x - s * 0.9 + i * s * 0.45, h = s * (0.8 + (i % 2) * 0.5), py = y;
      cx.fillStyle = bodyGrad(px, py - h * 0.5, h, d.col);
      cx.beginPath(); cx.moveTo(px - s * 0.3, py); cx.lineTo(px - s * 0.15, py - h); cx.lineTo(px + s * 0.15, py - h); cx.lineTo(px + s * 0.3, py); cx.fill();
      cx.strokeStyle = '#ffb35c'; cx.lineWidth = s * 0.05;
      for (let k = 0; k < 3; k++) { cx.beginPath(); cx.moveTo(px, py - h); cx.quadraticCurveTo(px + (k - 1) * s * 0.3, py - h - s * 0.4, px + (k - 1) * s * 0.4 + Math.sin(t * 5 + i + k) * 3, py - h - s * 0.3); cx.stroke(); }
    }
    eye(x - s * 0.2, y - s * 0.6, s * 0.14, -1); eye(x + s * 0.2, y - s * 0.6, s * 0.14, -1);
  };
  DRAW.orca = function (x, y, s, d, t) {
    const by = y - s * 1.0, w = s * 1.5, h = s * 0.7;
    cx.fillStyle = '#15181e'; cx.beginPath(); cx.moveTo(x + w * 0.8, by); cx.lineTo(x + w * 1.3, by - h * 0.9 + Math.sin(t * 5) * 3); cx.lineTo(x + w * 1.2, by + h * 0.6); cx.fill();
    cx.beginPath(); cx.moveTo(x, by - h * 0.8); cx.lineTo(x + w * 0.2, by - h * 2.2); cx.lineTo(x + w * 0.45, by - h * 0.7); cx.fill();
    cx.fillStyle = bodyGrad(x, by, w, '#22262e'); ell(x, by, w, h); cx.fill();
    cx.fillStyle = '#f2f4f6'; ell(x - w * 0.15, by + h * 0.35, w * 0.65, h * 0.4); cx.fill(); ell(x - w * 0.55, by - h * 0.25, w * 0.18, h * 0.2); cx.fill();
    eye(x - w * 0.7, by, s * 0.12, -1);
  };
  DRAW.isopod = function (x, y, s, d, t) {
    const by = y - s * 0.7, w = s * 1.25;
    cx.strokeStyle = shade(d.col, -0.4); cx.lineWidth = s * 0.08;
    for (let i = 0; i < 7; i++) { const lx = x - w * 0.8 + i * w * 0.27; cx.beginPath(); cx.moveTo(lx, by + s * 0.3); cx.lineTo(lx - s * 0.1, y + Math.sin(t * 10 + i) * 1.5); cx.stroke(); }
    cx.fillStyle = bodyGrad(x, by, w, d.col); ell(x, by, w, s * 0.65); cx.fill();
    cx.strokeStyle = shade(d.col, -0.3); cx.lineWidth = s * 0.06;
    for (let i = 1; i < 7; i++) { const lx = x - w + i * w * 0.29; cx.beginPath(); cx.moveTo(lx, by - s * 0.6); cx.quadraticCurveTo(lx + s * 0.08, by, lx, by + s * 0.55); cx.stroke(); }
    cx.fillStyle = '#1a1a22'; ell(x - w * 0.85, by - s * 0.05, s * 0.18, s * 0.22); cx.fill();
    glow(x - w * 0.85, by - s * 0.1, s * 0.25, '#ffcf5a', 0.4);
  };
  DRAW.angler = function (x, y, s, d, t) {
    const by = y - s * 1.0;
    cx.strokeStyle = shade(d.col, 0.2); cx.lineWidth = s * 0.07;
    const lx = x - s * 1.3 + Math.sin(t * 2) * s * 0.15, ly = by - s * 1.6;
    cx.beginPath(); cx.moveTo(x - s * 0.3, by - s * 0.8); cx.quadraticCurveTo(x - s * 0.6, by - s * 2, lx, ly); cx.stroke();
    glow(lx, ly, s * 0.9, '#bff7ff', 0.9);
    cx.fillStyle = '#e8ffff'; circle(lx, ly, s * 0.12); cx.fill();
    cx.fillStyle = bodyGrad(x, by, s * 1.1, d.col); circle(x, by, s * 0.95); cx.fill();
    cx.fillStyle = shade(d.col, -0.3); cx.beginPath(); cx.moveTo(x + s * 0.8, by); cx.lineTo(x + s * 1.4, by - s * 0.5); cx.lineTo(x + s * 1.4, by + s * 0.5); cx.fill();
    cx.fillStyle = '#0b0410'; ell(x - s * 0.55, by + s * 0.25, s * 0.42, s * 0.3); cx.fill();
    cx.fillStyle = '#e8e2d0'; for (let i = 0; i < 5; i++) { cx.beginPath(); cx.moveTo(x - s * 0.9 + i * s * 0.17, by + s * 0.05); cx.lineTo(x - s * 0.83 + i * s * 0.17, by + s * 0.3); cx.lineTo(x - s * 0.76 + i * s * 0.17, by + s * 0.05); cx.fill(); }
    eye(x - s * 0.3, by - s * 0.35, s * 0.13, -1);
  };
  DRAW.shark = function (x, y, s, d, t) {
    const by = y - s * 1.0, w = s * 1.6, h = s * 0.55;
    cx.fillStyle = shade(d.col, -0.2);
    cx.beginPath(); cx.moveTo(x + w * 0.8, by); cx.lineTo(x + w * 1.3, by - h * 1.6 + Math.sin(t * 6) * 3); cx.lineTo(x + w * 1.15, by + h * 1.1); cx.fill();
    cx.beginPath(); cx.moveTo(x - w * 0.1, by - h * 0.8); cx.lineTo(x + w * 0.15, by - h * 2.1); cx.lineTo(x + w * 0.4, by - h * 0.7); cx.fill();
    cx.fillStyle = bodyGrad(x, by, w, d.col);
    cx.beginPath(); cx.moveTo(x - w * 1.25, by - h * 0.2); cx.quadraticCurveTo(x - w * 0.4, by - h * 1.3, x + w * 0.9, by); cx.quadraticCurveTo(x - w * 0.4, by + h * 1.2, x - w * 1.0, by + h * 0.3); cx.fill();
    cx.fillStyle = '#4a1a20'; cx.beginPath(); cx.moveTo(x - w * 1.0, by + h * 0.25); cx.lineTo(x - w * 0.55, by + h * 0.5); cx.lineTo(x - w * 0.95, by + h * 0.75); cx.fill();
    cx.fillStyle = '#f4f1e8'; for (let i = 0; i < 4; i++) { cx.beginPath(); cx.moveTo(x - w * 0.98 + i * w * 0.1, by + h * 0.3); cx.lineTo(x - w * 0.94 + i * w * 0.1, by + h * 0.5); cx.lineTo(x - w * 0.9 + i * w * 0.1, by + h * 0.32); cx.fill(); }
    eye(x - w * 0.7, by - h * 0.25, s * 0.11, -1);
  };
  DRAW.school = function (x, y, s, d, t) {
    for (let i = 0; i < 7; i++) {
      const px = x - s * 0.8 + (i % 3) * s * 0.75 + Math.sin(t * 2 + i) * s * 0.2, py = y - s * 0.6 - Math.floor(i / 3) * s * 0.6 - (i % 2) * s * 0.25 + Math.cos(t * 2.4 + i) * s * 0.15;
      DRAW.fish(px, py + s * 0.35, s * 0.32, d, t + i);
    }
  };
  DRAW.vent = function (x, y, s, d, t) {
    cx.fillStyle = bodyGrad(x, y - s * 0.8, s * 1.2, '#4a3a3a');
    cx.beginPath(); cx.moveTo(x - s * 0.9, y); cx.lineTo(x - s * 0.45, y - s * 1.6); cx.lineTo(x + s * 0.45, y - s * 1.6); cx.lineTo(x + s * 0.9, y); cx.fill();
    for (let i = 0; i < 5; i++) {
      const k = ((t * 0.8 + i * 0.2) % 1), r = s * (0.3 + k * 0.6);
      cx.fillStyle = 'rgba(' + (255) + ',' + (120 - k * 80 | 0) + ',40,' + (0.6 * (1 - k)) + ')'; circle(x + Math.sin(i * 2 + t) * s * 0.2, y - s * 1.7 - k * s * 1.4, r); cx.fill();
    }
    glow(x, y - s * 1.6, s * 0.9, d.col, 0.7);
    cx.fillStyle = '#ffcf5a'; ell(x - s * 0.25, y - s * 0.9, s * 0.12, s * 0.16); cx.fill(); ell(x + s * 0.25, y - s * 0.9, s * 0.12, s * 0.16); cx.fill();
  };
  DRAW.oarfish = function (x, y, s, d, t) {
    cx.lineCap = 'round';
    cx.strokeStyle = '#ff5a6a'; cx.lineWidth = s * 0.5;
    const pts = [];
    for (let i = 0; i <= 18; i++) { const k = i / 18; pts.push([x - s * 1.4 + k * s * 3, y - s * 1.7 + Math.sin(t * 2.2 + k * 7) * s * 0.35 + k * s * 0.6]); }
    cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(p[0], p[1] - s * 0.25) : cx.moveTo(p[0], p[1] - s * 0.25)); cx.stroke();
    cx.strokeStyle = d.col; cx.lineWidth = s * 0.42;
    cx.beginPath(); pts.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])); cx.stroke();
    cx.fillStyle = '#ff5a6a'; for (let i = 0; i < 5; i++) { cx.beginPath(); cx.moveTo(x - s * 1.3, y - s * 1.9); cx.lineTo(x - s * 1.5 + i * s * 0.15, y - s * 2.8 - (i % 2) * s * 0.3); cx.lineTo(x - s * 1.2, y - s * 1.9); cx.fill(); }
    eye(x - s * 1.4, y - s * 1.7, s * 0.14, -1);
  };
  DRAW.tentacle = function (x, y, s, d, t) {
    cx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      cx.strokeStyle = k ? shade(d.col, 0.25) : d.col; cx.lineWidth = s * (0.55 - k * 0.3);
      cx.beginPath(); cx.moveTo(x, y);
      for (let i = 1; i <= 10; i++) { const f = i / 10; cx.lineTo(x + Math.sin(t * 2 + f * 4) * s * 0.6 * f, y - f * s * 2.4); }
      cx.stroke();
    }
    cx.fillStyle = '#ffd0d8'; for (let i = 1; i < 8; i++) { const f = i / 10; circle(x + Math.sin(t * 2 + f * 4) * s * 0.6 * f - s * 0.15, y - f * s * 2.4, s * 0.08); cx.fill(); }
  };
  DRAW.blob = function (x, y, s, d, t) {
    const by = y - s * 1.1;
    const g = cx.createRadialGradient(x - s * 0.3, by - s * 0.8, s * 0.2, x, by, s * 1.6);
    g.addColorStop(0, '#5a6a8a'); g.addColorStop(1, '#161c2c');
    cx.fillStyle = g;
    cx.beginPath(); cx.moveTo(x - s * 1.3, y); cx.quadraticCurveTo(x - s * 1.5, by - s * 1.6, x, by - s * 1.5 + Math.sin(t * 1.5) * s * 0.05); cx.quadraticCurveTo(x + s * 1.5, by - s * 1.6, x + s * 1.3, y);
    for (let i = 0; i < 6; i++) cx.quadraticCurveTo(x + s * 1.1 - i * s * 0.45, y + s * 0.2 * Math.sin(t * 3 + i), x + s * 0.9 - i * s * 0.45, y);
    cx.fill();
    glow(x - s * 0.45, by - s * 0.5, s * 0.5, '#fff6a8', 0.6); glow(x + s * 0.45, by - s * 0.5, s * 0.5, '#fff6a8', 0.6);
    cx.fillStyle = '#fffbe0'; ell(x - s * 0.45, by - s * 0.5, s * 0.2, s * 0.12); cx.fill(); ell(x + s * 0.45, by - s * 0.5, s * 0.2, s * 0.12); cx.fill();
    cx.fillStyle = '#0a0d16'; ell(x, by + s * 0.1, s * 0.4, s * 0.12 + Math.sin(t * 2) * s * 0.05); cx.fill();
  };
  DRAW.serpent = function (x, y, s, d, t) {
    cx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      cx.strokeStyle = k ? shade(d.col, 0.2) : shade(d.col, -0.3); cx.lineWidth = s * (0.75 - k * 0.35);
      cx.beginPath();
      for (let i = 0; i <= 24; i++) { const f = i / 24, px = x + s * 1.4 - f * s * 2.6, py = y - s * 0.3 - Math.abs(Math.sin(f * 7.5 + t * 1.2)) * s * 0.9 * (1 - f * 0.4) - f * s * 1.2; i ? cx.lineTo(px, py) : cx.moveTo(px, py); }
      cx.stroke();
    }
    const hx = x - s * 1.3, hy = y - s * 1.9 + Math.sin(t * 1.3) * s * 0.1;
    cx.fillStyle = bodyGrad(hx, hy, s * 0.7, d.col);
    cx.beginPath(); cx.moveTo(hx - s * 0.9, hy + s * 0.1); cx.lineTo(hx + s * 0.4, hy - s * 0.5); cx.lineTo(hx + s * 0.5, hy + s * 0.4); cx.closePath(); cx.fill();
    cx.fillStyle = '#e0f0e8'; cx.beginPath(); cx.moveTo(hx + s * 0.1, hy - s * 0.4); cx.lineTo(hx + s * 0.6, hy - s * 1.0); cx.lineTo(hx + s * 0.35, hy - s * 0.3); cx.fill();
    glow(hx - s * 0.1, hy - s * 0.1, s * 0.35, '#ff5a3c', 0.8);
    cx.fillStyle = '#ffeec0'; circle(hx - s * 0.1, hy - s * 0.1, s * 0.08); cx.fill();
  };
  DRAW.ship = function (x, y, s, d, t) {
    const by = y - s * 0.5 + Math.sin(t * 0.8) * s * 0.06, rot = Math.sin(t * 0.6) * 0.04;
    cx.save(); cx.translate(x, by); cx.rotate(rot);
    cx.fillStyle = '#3a3428';
    cx.beginPath(); cx.moveTo(-s * 1.5, -s * 0.5); cx.lineTo(s * 1.4, -s * 0.6); cx.lineTo(s * 1.1, s * 0.3); cx.lineTo(-s * 1.2, s * 0.3); cx.fill();
    cx.strokeStyle = '#2a241c'; cx.lineWidth = s * 0.12; cx.beginPath(); cx.moveTo(-s * 0.3, -s * 0.5); cx.lineTo(-s * 0.2, -s * 2.4); cx.moveTo(s * 0.7, -s * 0.55); cx.lineTo(s * 0.75, -s * 1.9); cx.stroke();
    cx.fillStyle = rgba('#b8c8b8', 0.55);
    cx.beginPath(); cx.moveTo(-s * 0.2, -s * 2.3); cx.quadraticCurveTo(s * 0.4 + Math.sin(t) * s * 0.1, -s * 1.7, -s * 0.15, -s * 0.8); cx.lineTo(-s * 0.9, -s * 1.0); cx.closePath(); cx.fill();
    cx.beginPath(); cx.moveTo(s * 0.75, -s * 1.85); cx.quadraticCurveTo(s * 1.25, -s * 1.4, s * 0.75, -s * 0.8); cx.lineTo(s * 0.2, -s * 1.0); cx.closePath(); cx.fill();
    for (let i = 0; i < 4; i++) glow(-s * 0.9 + i * s * 0.55, -s * 0.15, s * 0.25, '#9fffb0', 0.5 + 0.3 * Math.sin(t * 3 + i));
    cx.restore();
  };
  DRAW.eye = function (x, y, s, d, t) {
    const by = y - s * 1.4;
    cx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = Math.PI + (i / 7) * Math.PI;
      cx.strokeStyle = shade(d.col, -0.35); cx.lineWidth = s * 0.22;
      cx.beginPath(); cx.moveTo(x, by);
      cx.quadraticCurveTo(x + Math.cos(a) * s * 1.3 + Math.sin(t * 2 + i) * s * 0.2, by + Math.sin(a) * s * 1.3, x + Math.cos(a + Math.sin(t + i) * 0.2) * s * 1.9, by + Math.sin(a) * s * 1.6 + s * 0.6);
      cx.stroke();
    }
    glow(x, by, s * 1.8, d.col, 0.5 + 0.2 * Math.sin(t * 2));
    cx.fillStyle = bodyGrad(x, by, s * 1.1, d.col); circle(x, by, s * 1.05); cx.fill();
    const lid = 0.3 + 0.7 * Math.min(1, Math.abs(Math.sin(t * 0.7)) * 3);
    cx.fillStyle = '#fff4e8'; ell(x, by, s * 0.8, s * 0.55 * lid); cx.fill();
    const g = cx.createRadialGradient(x - s * 0.1, by, 0, x - s * 0.1, by, s * 0.45);
    g.addColorStop(0, '#ffef7a'); g.addColorStop(0.5, '#ff6a3c'); g.addColorStop(1, '#5a0a3a');
    cx.fillStyle = g; ell(x - s * 0.1, by, s * 0.42, s * 0.42 * lid); cx.fill();
    cx.fillStyle = '#05010a'; ell(x - s * 0.1, by, s * 0.09, s * 0.34 * lid); cx.fill();
  };

  function drawCreature(def, x, y, size, t, o) {
    o = o || {};
    const s = 16 * size;
    const fn = DRAW[def.shape] || DRAW.fish;
    cx.save();
    if (o.alpha != null) cx.globalAlpha = o.alpha;
    if (o.flip) { cx.translate(x, 0); cx.scale(-1, 1); cx.translate(-x, 0); }
    fn(x, y, s, def, t);
    cx.restore();
    if (o.flash > 0) glow(x, y - s, s * 2.2, '#ffffff', o.flash * 0.8);
  }
  RD.drawCreatureTo = function (canvas, def) {
    const c2 = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const old = cx; cx = c2;
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, w, h);
    const size = def.boss ? 1.6 : Math.min(1.5, (def.size || 1));
    const k = Math.min(w, h) / 80;
    c2.setTransform(k, 0, 0, k, 0, 0);
    drawCreature(def, 40 + (def.shape === 'shark' || def.shape === 'ray' ? 10 : 0), def.boss ? 74 : 70, size * (def.boss ? 0.95 : 1.1), 1.2, {});
    cx = old;
  };

  /* ---------- 潜り手(自分) ---------- */
  function drawPlayer(id, x, y, t, o) {
    const ch = D.char[id], c = ch.col, bob = Math.sin(t * 2) * 1.5;
    cx.save();
    if (o && o.hurt > 0) { cx.translate((Math.random() - 0.5) * 4 * o.hurt, 0); }
    if (id === 'mio') {
      cx.strokeStyle = c; cx.lineCap = 'round'; cx.lineWidth = 8;
      cx.beginPath(); cx.moveTo(x, y - 22 + bob); cx.quadraticCurveTo(x + 10, y - 6, x - 2, y - 2); cx.stroke();
      cx.fillStyle = shade(c, 0.2); cx.beginPath(); cx.moveTo(x - 2, y - 2); cx.lineTo(x - 14, y + 1); cx.lineTo(x - 10, y - 8); cx.fill();
      cx.fillStyle = '#ffd9c2'; ell(x - 1, y - 28 + bob, 5, 7); cx.fill();
      cx.fillStyle = '#ff9ec7'; ell(x - 1, y - 33 + bob, 5.5, 4); cx.fill();
      cx.strokeStyle = '#ff9ec7'; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(x - 4, y - 33 + bob); cx.quadraticCurveTo(x - 10, y - 22 + bob, x - 7, y - 14 + bob); cx.stroke();
      cx.fillStyle = '#ffd9c2'; circle(x + 2, y - 38 + bob, 5.5); cx.fill();
      cx.fillStyle = '#ff9ec7'; cx.beginPath(); cx.arc(x + 2, y - 39 + bob, 6, Math.PI, 0); cx.fill();
      eye(x + 4.5, y - 38 + bob, 1.6, 1);
    } else if (id === 'k7') {
      cx.fillStyle = bodyGrad(x, y - 18 + bob, 16, c); circle(x, y - 18 + bob, 14); cx.fill();
      cx.fillStyle = '#163048'; circle(x + 4, y - 20 + bob, 7); cx.fill();
      glow(x + 4, y - 20 + bob, 9, '#7ff0e0', 0.6 + 0.3 * Math.sin(t * 4));
      cx.fillStyle = '#bff7ff'; circle(x + 6, y - 22 + bob, 2); cx.fill();
      cx.strokeStyle = shade(c, -0.4); cx.lineWidth = 3; cx.beginPath(); cx.moveTo(x + 12, y - 12 + bob); cx.lineTo(x + 20, y - 8 + bob); cx.lineTo(x + 22, y - 14 + bob); cx.stroke();
      cx.fillStyle = shade(c, -0.4); cx.fillRect(x - 16, y - 4 + bob, 32, 4);
      for (let i = 0; i < 3; i++) { cx.fillStyle = 'rgba(220,245,255,0.5)'; circle(x - 18 - i * 4, y - 14 - i * 6 + ((t * 20 + i * 7) % 12), 1.5); cx.fill(); }
    } else {
      // 人の形(ナギ・ゲンゾウ)
      const suit = id === 'genzo' ? '#3a5a7a' : '#1f4f6a';
      cx.strokeStyle = suit; cx.lineCap = 'round'; cx.lineWidth = 5;
      cx.beginPath(); cx.moveTo(x - 2, y - 14 + bob); cx.lineTo(x - 5, y); cx.moveTo(x + 2, y - 14 + bob); cx.lineTo(x + 4, y); cx.stroke();
      cx.fillStyle = shade(c, -0.1); cx.beginPath(); cx.moveTo(x - 7, y + 1); cx.lineTo(x - 2, y - 1); cx.lineTo(x - 5, y + 3); cx.fill();
      cx.fillStyle = suit; ell(x, y - 21 + bob, 7, 10); cx.fill();
      cx.fillStyle = c; cx.fillRect(x - 7, y - 23 + bob, 14, 3);
      cx.strokeStyle = suit; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(x + 4, y - 26 + bob); cx.lineTo(x + 13, y - 20 + bob); cx.stroke();
      if (id === 'genzo') {
        cx.strokeStyle = '#a08566'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(x + 13, y - 34 + bob); cx.lineTo(x + 13, y - 2 + bob); cx.stroke();
        cx.fillStyle = '#d8dee8'; cx.beginPath(); cx.moveTo(x + 13, y - 38 + bob); cx.lineTo(x + 10, y - 32 + bob); cx.lineTo(x + 16, y - 32 + bob); cx.fill();
      }
      cx.fillStyle = '#ffd9c2'; circle(x + 1, y - 35 + bob, 6.5); cx.fill();
      if (id === 'genzo') {
        cx.fillStyle = '#e8e2d0'; ell(x + 2, y - 30 + bob, 5, 3); cx.fill();
        cx.fillStyle = '#d9b36b'; ell(x + 1, y - 40 + bob, 11, 3); cx.fill(); ell(x + 1, y - 42 + bob, 6, 4); cx.fill();
      } else {
        cx.fillStyle = '#1a1a2a'; cx.beginPath(); cx.arc(x + 1, y - 36 + bob, 7, Math.PI * 0.9, Math.PI * 2.05); cx.fill();
        cx.beginPath(); cx.moveTo(x - 5, y - 38 + bob); cx.quadraticCurveTo(x - 14, y - 36 + bob + Math.sin(t * 3) * 2, x - 12, y - 28 + bob); cx.lineWidth = 3; cx.strokeStyle = '#1a1a2a'; cx.stroke();
        cx.fillStyle = rgba('#bff7ff', 0.7); ell(x + 4, y - 35 + bob, 4.5, 3.5); cx.fill();
        cx.strokeStyle = '#ffcf5a'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(x - 2, y - 39 + bob); cx.lineTo(x - 3, y - 46 + bob); cx.stroke();
      }
    }
    cx.restore();
  }
  RD.drawPlayerTo = function (canvas, id) {
    const c2 = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    const old = cx; cx = c2;
    c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, w, h);
    const k = Math.min(w, h) / 60; c2.setTransform(k, 0, 0, k, 0, 0);
    drawPlayer(id, 30, 54, 0.5);
    cx = old;
  };

  /* ---------- ピン ---------- */
  function drawPeg(p, area, dt) {
    if (p.va == null) p.va = 1;
    if (p.state === 'gone') { p.va = Math.max(0, p.va - dt * 5); if (p.va <= 0) return; }
    else if (p.va < 1) p.va = Math.min(1, p.va + dt * 3);
    if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3);
    if (p.spawnT > 0) p.spawnT = Math.max(0, p.spawnT - dt * 2);
    const x = p.x, y = p.y + BY, k = p.va * (1 - (p.spawnT || 0) * 0.6), r = p.r * (0.6 + 0.4 * k) * (1 + p.flash * 0.25);
    const lit = p.state === 'lit';
    cx.globalAlpha = k;
    switch (p.type) {
      case 'rock': {
        cx.fillStyle = '#5a5a66';
        cx.beginPath(); for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + p.id, rr = r * (0.85 + ((p.id * 7 + i * 13) % 5) * 0.06); i ? cx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : cx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } cx.closePath(); cx.fill();
        cx.fillStyle = 'rgba(255,255,255,0.18)'; ell(x - r * 0.3, y - r * 0.35, r * 0.4, r * 0.22); cx.fill();
        break;
      }
      case 'barn': {
        cx.fillStyle = '#cfc3a6';
        cx.beginPath(); cx.moveTo(x - r, y + r * 0.8); cx.lineTo(x - r * 0.45, y - r); cx.lineTo(x + r * 0.45, y - r); cx.lineTo(x + r, y + r * 0.8); cx.closePath(); cx.fill();
        cx.fillStyle = '#6b5a40'; ell(x, y - r * 0.9, r * 0.4, r * 0.18); cx.fill();
        if (p.hp <= 1) { cx.strokeStyle = '#3a2a1a'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x - r * 0.3, y - r * 0.5); cx.lineTo(x + r * 0.1, y); cx.lineTo(x - r * 0.1, y + r * 0.5); cx.stroke(); }
        break;
      }
      case 'bumper': {
        const pulse = 1 + p.flash * 0.3 + Math.sin(time * 3 + p.id) * 0.04;
        cx.strokeStyle = '#ff7ab0'; cx.lineWidth = 2.5; cx.lineCap = 'round';
        for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283 + Math.sin(time * 2) * 0.1; cx.beginPath(); cx.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7); cx.lineTo(x + Math.cos(a) * r * 1.25 * pulse, y + Math.sin(a) * r * 1.25 * pulse); cx.stroke(); }
        cx.fillStyle = bodyGrad(x, y, r, '#ff5a8a'); circle(x, y, r * 0.8 * pulse); cx.fill();
        break;
      }
      case 'bomb': {
        const armed = p.hp <= 1;
        cx.strokeStyle = '#2a2a33'; cx.lineWidth = 2;
        for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45); cx.stroke(); }
        cx.fillStyle = bodyGrad(x, y, r, '#3a3a48'); circle(x, y, r * 1.05); cx.fill();
        const blink = armed ? 0.5 + 0.5 * Math.sin(time * 12) : 0.35;
        cx.fillStyle = armed ? '#ff4040' : '#ff9a5c'; circle(x, y, r * 0.38); cx.fill();
        glow(x, y, r * 2.2, '#ff5a3c', blink * 0.7);
        break;
      }
      default: {
        let col = area.peg, core = null;
        if (p.type === 'crit') col = '#ff7a3c';
        else if (p.type === 'heal') col = '#4fe08a';
        else if (p.type === 'refresh') col = '#5ee6f0';
        else if (p.type === 'gold') col = '#ffd25e';
        if (lit) glow(x, y, r * 3, col, 0.65);
        const g = cx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
        g.addColorStop(0, lit ? '#ffffff' : shade(col, 0.55)); g.addColorStop(0.55, lit ? shade(col, 0.4) : col); g.addColorStop(1, shade(col, -0.45));
        cx.fillStyle = g; circle(x, y, r); cx.fill();
        if (p.type === 'crit') { text('会', x, y + 0.5, r * 1.15, '#fff', { weight: 900 }); }
        else if (p.type === 'heal') { cx.fillStyle = '#fff'; cx.fillRect(x - r * 0.5, y - r * 0.15, r, r * 0.3); cx.fillRect(x - r * 0.15, y - r * 0.5, r * 0.3, r); }
        else if (p.type === 'refresh') { cx.strokeStyle = '#fff'; cx.lineWidth = 1.4; cx.beginPath(); cx.arc(x, y, r * 0.5, 0.3, 5.4); cx.stroke(); }
        else if (p.type === 'gold') { text('貝', x, y + 0.5, r * 1.05, '#7a4a00', { weight: 900 }); }
        if (p.type !== 'normal' && !lit && q()) glow(x, y, r * 2.4, col, 0.25 + 0.15 * Math.sin(time * 4 + p.id));
        if (p.flash > 0.5) { cx.strokeStyle = rgba('#ffffff', p.flash - 0.5); cx.lineWidth = 2; circle(x, y, r + (1 - p.flash) * 14); cx.stroke(); }
      }
    }
    cx.globalAlpha = 1;
  }

  /* ---------- 玉 ---------- */
  function drawBall(b, def) {
    const x = b.x, y = b.y + BY, r = b.r;
    if (!b._tr) b._tr = [];
    b._tr.push(x, y); if (b._tr.length > 24) b._tr.splice(0, 2);
    const col = def ? def.col : '#fff';
    if (q()) {
      for (let i = 0; i < b._tr.length - 2; i += 2) {
        const k = i / b._tr.length;
        cx.fillStyle = rgba(col, k * 0.35); circle(b._tr[i], b._tr[i + 1], r * (0.3 + k * 0.6)); cx.fill();
      }
    }
    glow(x, y, r * 3, col, 0.5);
    const g = cx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, shade(col, 0.3)); g.addColorStop(1, shade(col, -0.35));
    cx.fillStyle = g; circle(x, y, r); cx.fill();
    if (b.pierce > 0 || b.pierceT > 0) { cx.strokeStyle = rgba('#bff7ff', 0.8); cx.lineWidth = 1.5; circle(x, y, r + 2); cx.stroke(); }
  }
  function ballIcon(id, x, y, r, lv, dim) {
    const def = D.ball[id];
    cx.globalAlpha = dim ? 0.5 : 1;
    glow(x, y, r * 1.8, def.col, 0.35);
    const g = cx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, def.col); g.addColorStop(1, shade(def.col, -0.45));
    cx.fillStyle = g; circle(x, y, r); cx.fill();
    text(def.k, x, y + r * 0.04, r * 1.05, def.curse ? '#fff' : '#1a2238', { weight: 900 });
    if (lv > 1) {
      cx.fillStyle = '#ffd25e'; circle(x + r * 0.75, y - r * 0.75, r * 0.38); cx.fill();
      text(String(lv), x + r * 0.75, y - r * 0.73, r * 0.5, '#3a2400', { weight: 900, font: RD.NUM });
    }
    if (def.evo) { cx.strokeStyle = '#ffcf5a'; cx.lineWidth = 1.5; circle(x, y, r + 1.5); cx.stroke(); }
    cx.globalAlpha = 1;
  }

  /* ---------- 演出を受け取る ---------- */
  function addText(str, x, y, o) { TX.push(Object.assign({ str, x, y, t: 0, life: 1, vy: -30, size: 14, col: '#fff' }, o)); }
  function burst(x, y, col, n, spd, o) {
    if (!q()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = spd * (0.3 + Math.random() * 0.7);
      P.push(Object.assign({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, t: 0, r: 1.5 + Math.random() * 2, col, g: 0, bub: false }, o));
    }
  }
  function ring(x, y, col, r1, life) { RINGS.push({ x, y, col, r1, t: 0, life: life || 0.4 }); }
  function doShake(v) { shake = Math.max(shake, v); }
  function doFlash(col, a) { flashCol = col; flashA = Math.max(flashA, a * (settings().flash == null ? 1 : settings().flash)); }
  function enemyPos(uid) {
    const B = SD.G.B; if (!B) return { x: 250, y: 140 };
    const e = B.enemies.find(o => o.uid === uid);
    const v = vis[uid];
    if (v) return { x: v.x, y: FLOOR - (e && e.def.boss ? 50 : 24) };
    if (!e) return { x: 250, y: 140 };
    return { x: slotX(e), y: FLOOR - 24 };
  }
  function slotX(e) { return e.def.boss ? 292 : 96 + e.slot * 49; }
  RD.slotX = slotX;
  const A = (n, o) => SD.Audio.sfx(n, o);

  RD.handleFx = function (list) {
    for (const f of list) { if (f.delay > 0) pending.push({ t: f.delay, f }); else one(f); }
    list.length = 0;
  };
  function one(f) {
    const B = SD.G.B, area = areaFor();
    switch (f.type) {
      case 'peg': {
        const x = f.x, y = f.y + BY;
        const col = f.kind === 'crit' ? '#ff7a3c' : f.kind === 'heal' ? '#4fe08a' : f.kind === 'gold' ? '#ffd25e' : f.kind === 'refresh' ? '#5ee6f0' : area.peg;
        burst(x, y, col, f.kind === 'normal' ? 5 : 12, 70, { bub: f.kind === 'normal' });
        ring(x, y, col, 14);
        A('peg', { n: f.n, kind: f.kind });
        hitPop = 1;
        if (f.kind === 'crit') { addText('会心!', x, y - 12, { col: '#ffb35c', size: 15 }); RD.hitStop = Math.max(RD.hitStop, 0.05); doShake(2); A('crit'); }
        if (f.kind === 'heal') addText('+' + BAL.healPeg, x, y - 10, { col: '#6fffa0', size: 12 });
        if (f.kind === 'gold') addText('+' + BAL.goldPeg, x, y - 10, { col: '#ffd25e', size: 12 });
        if (f.kind === 'refresh') addText('盤面が戻る', x, y - 12, { col: '#9ff6ff', size: 12 });
        break;
      }
      case 'bomb': {
        const x = f.x, y = f.y + BY;
        burst(x, y, '#ffb35c', 30, 220); burst(x, y, '#ffffff', 10, 120);
        ring(x, y, '#ffcf5a', f.r, 0.45); ring(x, y, '#ff5a3c', f.r * 0.6, 0.3);
        doShake(7); RD.hitStop = Math.max(RD.hitStop, 0.09); doFlash('#ffb35c', 0.25);
        A('bomb');
        break;
      }
      case 'blast': { const x = f.x, y = f.y + BY; burst(x, y, '#ffb35c', 12, 140); ring(x, y, '#ffcf5a', f.r, 0.3); doShake(3); A('blast'); break; }
      case 'arm': addText('あと1回', f.x, f.y + BY - 14, { col: '#ff8a6a', size: 11 }); A('arm'); break;
      case 'wall': burst(f.x, f.y + BY, '#bfe8ff', 3, 50); A('wall'); break;
      case 'bump': burst(f.x, f.y + BY, '#ff7ab0', 8, 120); ring(f.x, f.y + BY, '#ff7ab0', 22); A('bump'); break;
      case 'rock': burst(f.x, f.y + BY, '#aaaab8', 4, 60); A('rock'); break;
      case 'crack': burst(f.x, f.y + BY, '#e8dcc0', 6, 60); A('crack'); break;
      case 'spike': { const B2 = B; P.push({ x: f.x0, y: f.y0 + BY, vx: (f.x - f.x0) * 8, vy: (f.y - f.y0) * 8, life: 0.12, t: 0, r: 2, col: '#e0d0ff', g: 0 }); break; }
      case 'split': burst(f.x, f.y + BY, '#ffffff', 5, 60); A('split'); break;
      case 'echo': addText('もう一度!', f.x, BY + 20, { col: '#9fdcff', size: 13 }); A('echo'); break;
      case 'wrap': burst(f.x, f.y + BY, '#e2f6ff', 6, 40); A('wrap'); break;
      case 'bucket': addText('網に入った! ×1.5', f.x, BY + BAL.boardH - 30, { col: '#ffd25e', size: 15, life: 1.3 }); burst(f.x, BY + BAL.boardH - 12, '#ffd25e', 20, 120); A('bucket'); break;
      case 'bounceUp': addText('跳ね板!', f.x, BY + BAL.boardH - 30, { col: '#9ff6ff', size: 13 }); A('bounceUp'); break;
      case 'refresh': if (!f.mid || true) { doFlash('#5ee6f0', 0.12); A('refresh'); } break;
      case 'launch': A('launch'); lastHits = 0; break;
      case 'shotEnd': {
        tally = { hits: f.hits, per: f.per, mult: f.mult, total: f.total, crit: f.crit, t: 0, bombs: f.bombs };
        const pl = { x: 40, y: FLOOR - 26 };
        const tgt = B && SD.G.front(B);
        if (tgt && f.total > 0) shots.push({ x0: pl.x, y0: pl.y, uid: tgt.uid, t: 0, life: 0.25 + Math.min(0.7, f.hits * 0.02), col: f.crit ? '#ffb35c' : '#bff7ff', big: f.total >= 80 });
        break;
      }
      case 'dmg': {
        const p = enemyPos(f.uid), v = vis[f.uid];
        if (v) { v.hit = 1; v.kx = f.main ? 8 : 4; }
        const big = f.v >= 60;
        addText(f.v > 0 ? String(f.v) : (f.blocked ? '防御' : '0'), p.x + (Math.random() - 0.5) * 14, p.y - 10, { col: f.src === 'poison' ? '#d68bff' : f.src === 'bomb' ? '#ffb35c' : f.crit ? '#ffcf5a' : '#ffffff', size: f.main ? (big ? 26 : 19) : 14, font: RD.NUM, vy: -50, life: 1.1, pop: 1 });
        if (f.blocked > 0) addText('盾 -' + f.blocked, p.x, p.y - 34, { col: '#9fc8ff', size: 11 });
        burst(p.x, p.y, f.src === 'poison' ? '#d68bff' : '#ffffff', f.main ? 14 : 5, f.main ? 160 : 80);
        if (f.main) { doShake(big ? 8 : 4); RD.hitStop = Math.max(RD.hitStop, big ? 0.12 : 0.05); A('hit', { big }); }
        else if (f.src !== 'poison') A('hit', {});
        if (f.src === 'poison') A('poison');
        break;
      }
      case 'bombWave': addText('機雷 ' + f.v, 200, FLOOR - 70, { col: '#ffb35c', size: 16 }); doShake(4); break;
      case 'relicFire': { const r = D.relic[f.id]; if (r) addText(r.name + '!', 220, FLOOR - 78, { col: '#c9f0ff', size: 13 }); break; }
      case 'status': {
        const p = enemyPos(f.uid);
        if (f.kind === 'poison') { addText('毒+' + f.v, p.x, p.y - 30, { col: '#d68bff', size: 12 }); A('poison'); }
        if (f.kind === 'freeze') { addText('凍結', p.x, p.y - 30, { col: '#bdf1ff', size: 13 }); burst(p.x, p.y, '#bdf1ff', 12, 80); A('freeze'); }
        break;
      }
      case 'hurt': {
        hurtFlash = 1;
        if (f.v > 0) { addText('-' + f.v, 40, FLOOR - 50, { col: '#ff6a7a', size: 20, font: RD.NUM, life: 1, pop: 1 }); doShake(f.v >= 12 ? 7 : 4); doFlash('#ff2a4a', Math.min(0.35, 0.08 + f.v * 0.012)); A('hurt'); }
        if (f.blocked > 0) { addText('盾 ' + f.blocked, 40, FLOOR - 72, { col: '#9fc8ff', size: 13 }); A('block'); }
        if (f.kind === 'poison') addText('毒', 40, FLOOR - 70, { col: '#d68bff', size: 12 });
        break;
      }
      case 'miss': addText('かわした!', 40, FLOOR - 60, { col: '#c9f0ff', size: 14 }); A('miss'); break;
      case 'heal': addText('+' + f.v, 40, FLOOR - 56, { col: '#6fffa0', size: 18, font: RD.NUM }); burst(40, FLOOR - 26, '#6fffa0', 10, 60); A('heal'); break;
      case 'shield': addText('盾+' + f.v, 40, FLOOR - 64, { col: '#9fc8ff', size: 14 }); A('shield'); break;
      case 'gold': addText('+' + f.v + '貝', 330, 22, { col: '#ffd25e', size: 13, vy: 20, life: 0.9 }); A('coin'); break;
      case 'revive': banner = { text: '浮き輪で復活!', sub: '', t: 0, col: '#ffd25e', life: 1.6 }; doFlash('#ffffff', 0.4); A('evolve'); break;
      case 'death': {
        const B2 = SD.G.B, e = B2 && B2.enemies.find(o => o.uid === f.uid);
        const v = vis[f.uid];
        if (e) corpses.push({ def: e.def, x: v ? v.x : slotX(e), t: 0, boss: !!f.boss });
        const p = enemyPos(f.uid);
        burst(p.x, p.y, '#ffffff', f.boss ? 60 : 18, f.boss ? 260 : 140, { bub: true });
        if (f.boss) { doShake(12); doFlash('#ffffff', 0.6); RD.hitStop = 0.25; A('roar'); }
        else A('death');
        delete vis[f.uid];
        break;
      }
      case 'summon': { const p = enemyPos(f.uid); burst(p.x, p.y, '#bfe8ff', 10, 60, { bub: true }); A('summon'); break; }
      case 'enemyHeal': { const p = enemyPos(f.uid); addText('+' + f.v, p.x, p.y - 26, { col: '#6fffa0', size: 13 }); A('heal'); break; }
      case 'enemyBlock': { const p = enemyPos(f.uid); addText('防御', p.x, p.y - 30, { col: '#9fc8ff', size: 12 }); A('block'); break; }
      case 'frozenSkip': { const p = enemyPos(f.uid); addText('動けない', p.x, p.y - 30, { col: '#bdf1ff', size: 12 }); break; }
      case 'explodeSelf': { const p = enemyPos(f.uid); burst(p.x, p.y, '#ffb35c', 26, 200); doShake(6); A('bomb'); break; }
      case 'barn': addText('フジツボが付いた', 180, BY + 30, { col: '#e8dcc0', size: 13 }); A('rocks'); break;
      case 'rocks': addText('岩が落ちてきた', 180, BY + 30, { col: '#c8c8d8', size: 13 }); doShake(4); A('rocks'); break;
      case 'curse': { const b = D.ball[f.id]; addText(b.name + 'を混ぜられた', 180, BY + 30, { col: '#c8b88a', size: 13 }); A('poison'); break; }
      case 'ink': inkT = 1; addText('墨で狙いが見えない!', 180, BY + 30, { col: '#c9a6ff', size: 13 }); A('ink'); break;
      case 'hide': { const p = enemyPos(f.uid); addText('隠れた', p.x, p.y - 30, { col: '#c8d8e8', size: 12 }); break; }
      case 'spikes': { const p = enemyPos(f.uid); addText('トゲ', p.x, p.y - 30, { col: '#ffcf5a', size: 12 }); break; }
      case 'spit': A('poison'); break;
      case 'playerPoison': addText('毒+' + f.v, 40, FLOOR - 66, { col: '#d68bff', size: 13 }); break;
      case 'leap': { const p = enemyPos(f.uid); burst(p.x, p.y + 10, '#e9d7a6', 10, 80); break; }
      case 'act': { const v = vis[f.uid]; if (v) v.lunge = 1; break; }
      case 'phase': if (f.msg) banner = { text: f.msg, sub: '', t: 0, col: '#ff9a8a', life: 1.6 }; doShake(8); A('phase'); break;
      case 'bossIntro': { const d = D.enemy[f.id]; banner = { text: d.name, sub: d.en, t: 0, col: '#ffcf5a', life: 2, boss: true }; A('roar'); break; }
      case 'battleStart': break;
      case 'turn': break;
      case 'win': banner = { text: f.kind === 'boss' || f.kind === 'final' ? '撃破!' : '勝利', sub: 'VICTORY', t: 0, col: '#9ff6ff', life: 1.1 }; A('win'); break;
      case 'lose': banner = { text: '力尽きた……', sub: '', t: 0, col: '#ff8a9a', life: 1.4 }; A('lose'); break;
      case 'bigShot': {
        bigT = 1;
        banner = { text: f.hits >= 25 ? '大量ヒット!' : '会心の一撃!', sub: f.hits + ' HIT  ' + f.dmg + ' DMG', t: 0, col: '#ffd25e', life: 1.3, big: true };
        doFlash('#ffffff', 0.35); doShake(10); A('bigShot');
        for (let i = 0; i < 40; i++) burst(Math.random() * LW, BY + Math.random() * 200, ['#ffd25e', '#9ff6ff', '#ff9ec7'][i % 3], 1, 80, { g: 60, life: 1.2 });
        break;
      }
      case 'evolve': { const b = D.ball[f.id]; banner = { text: '進化! ' + b.name, sub: 'EVOLUTION', t: 0, col: '#ffcf5a', life: 1.8 }; doFlash('#ffcf5a', 0.4); A('evolve'); break; }
      case 'upgrade': A('select'); break;
      case 'gain': A('select'); break;
      case 'buy': A('buy'); break;
      case 'swap': A('swap'); break;
      case 'ach': A('ach'); break;
      case 'area': break;
      default: break;
    }
  }

  /* ---------- 戦闘の画面 ---------- */
  function drawHud(R, B) {
    // 上の帯
    cx.fillStyle = 'rgba(4,16,34,0.55)'; cx.fillRect(0, 0, LW, SY);
    const maxHp = SD.G.maxHp(), hp = Math.max(0, R.hp);
    const bw = 132, bx = 10, by = 13;
    cx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(bx, by, bw, 14, 7); cx.fill();
    const k = SD.clamp(hp / maxHp, 0, 1);
    const g = cx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#ff5a7a'); g.addColorStop(1, '#ff9a8a');
    cx.fillStyle = g; roundRect(bx, by, Math.max(6, bw * k), 14, 7); cx.fill();
    if (hurtFlash > 0) { cx.fillStyle = rgba('#ffffff', hurtFlash * 0.5); roundRect(bx, by, bw * k, 14, 7); cx.fill(); }
    text(hp + ' / ' + maxHp, bx + bw / 2, by + 7.5, 10.5, '#fff', { font: RD.NUM, weight: 600, stroke: 2.5 });
    let ix = bx + bw + 8;
    if (B && B.block > 0) { shieldIcon(ix + 7, by + 7, 8); text(String(B.block), ix + 7, by + 7.5, 9, '#0a2040', { font: RD.NUM, weight: 700 }); ix += 20; }
    if (R.poison > 0) { cx.fillStyle = '#b06bff'; circle(ix + 7, by + 7, 7); cx.fill(); text(String(R.poison), ix + 7, by + 7.5, 9, '#fff', { font: RD.NUM }); ix += 18; }
    const area = D.AREAS[Math.min(3, R.area)];
    text(area.name + (R.loop ? ' +' + R.loop : ''), LW / 2 + 36, 13, 10.5, '#cfeffd', { weight: 700, stroke: 2.5 });
    text(R.map && R.pos.r >= 0 ? (R.pos.r + 1) + ' / ' + R.map.rows.length : '', LW / 2 + 36, 28, 9.5, '#9fc8e8', { font: RD.NUM, weight: 500 });
    // 貝貨
    cx.fillStyle = '#ffd25e'; circle(LW - 78, 20, 7); cx.fill(); text('貝', LW - 78, 20.5, 8, '#7a4a00', { weight: 900 });
    text(String(R.gold), LW - 66, 20.5, 13, '#ffe9a8', { font: RD.NUM, align: 'left', weight: 600, stroke: 2.5 });
    // 一時停止
    cx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(LW - 34, 6, 28, 28, 8); cx.fill();
    cx.fillStyle = '#e8f6ff'; cx.fillRect(LW - 26, 13, 4, 14); cx.fillRect(LW - 18, 13, 4, 14);
    RD.hits.push({ id: 'pause', x: LW - 40, y: 0, w: 40, h: 40 });
    // 遺物
    const rel = R.relics, n = rel.length, step = 21, max = Math.floor((LW - 16) / step);
    for (let i = 0; i < Math.min(n, max); i++) {
      const r = D.relic[rel[i]], x = 14 + i * step, y = SY + 13;
      relicIcon(r, x, y, 9);
    }
    if (n) RD.hits.push({ id: 'relics', x: 0, y: SY, w: Math.min(n, max) * step + 10, h: 26 });
  }
  function shieldIcon(x, y, r) {
    cx.fillStyle = '#9fc8ff';
    cx.beginPath(); cx.moveTo(x, y - r); cx.lineTo(x + r * 0.9, y - r * 0.6); cx.lineTo(x + r * 0.8, y + r * 0.3); cx.lineTo(x, y + r); cx.lineTo(x - r * 0.8, y + r * 0.3); cx.lineTo(x - r * 0.9, y - r * 0.6); cx.closePath(); cx.fill();
  }
  function relicIcon(r, x, y, rad) {
    const col = D.RAR.col[r.rar];
    cx.fillStyle = 'rgba(6,20,40,0.7)'; circle(x, y, rad); cx.fill();
    cx.strokeStyle = col; cx.lineWidth = 1.5; circle(x, y, rad); cx.stroke();
    text(r.k, x, y + 0.5, rad * 1.1, '#f0f8ff', { weight: 900 });
  }
  RD.relicIcon = relicIcon;
  function roundRect(x, y, w, h, r) {
    cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
  }

  function swordIcon(x, y, col) {
    cx.save(); cx.translate(x, y); cx.rotate(-0.785);
    cx.fillStyle = col; cx.fillRect(-1.3, -7, 2.6, 10); cx.beginPath(); cx.moveTo(-1.3, -7); cx.lineTo(0, -9.5); cx.lineTo(1.3, -7); cx.fill();
    cx.fillRect(-4, 3, 8, 1.8); cx.fillRect(-1, 4.5, 2, 3.5);
    cx.restore();
  }
  function arrowIcon(x, y, col, dbl) {
    cx.strokeStyle = col; cx.lineWidth = 2; cx.lineCap = 'round'; cx.lineJoin = 'round';
    for (let k = 0; k < (dbl ? 2 : 1); k++) { const ox = k * 5 - (dbl ? 2.5 : 0); cx.beginPath(); cx.moveTo(x + 3 + ox, y - 4); cx.lineTo(x - 2 + ox, y); cx.lineTo(x + 3 + ox, y + 4); cx.stroke(); }
  }
  // 予告アイコン: 絵文字は環境で見た目が変わるので、図形と漢字で描く
  const INTENT_K = { frozen: ['凍', '#bdf1ff'], explode: ['爆', '#ffb35c'], summon: ['呼', '#bfe8ff'], rocks: ['岩', '#c8c8d8'], barn: ['付', '#e8dcc0'],
    curse: ['呪', '#d8c88a'], poison: ['毒', '#e09bff'], ink: ['墨', '#c9a6ff'], hide: ['隠', '#c8d8e8'], spikes: ['棘', '#ffcf5a'] };
  function intentIcon(e, x, y) {
    const it = e.intent; if (!it) return;
    let label = '';
    if (it.dmg != null) label = it.dmg + (it.n > 1 ? '×' + it.n : '');
    else if (it.t === 'block' || it.t === 'heal' || it.t === 'poison') label = String(it.v);
    const w = label ? 20 + label.length * 6 : 18;
    const col = it.t === 'atk' ? '#ff8a8a' : it.t === 'atkp' ? '#e09bff' : it.t === 'drain' ? '#ff6a9a' : it.t === 'block' ? '#9fc8ff' : it.t === 'heal' ? '#6fffa0' : (INTENT_K[it.t] || [0, '#cfe8ff'])[1];
    cx.fillStyle = 'rgba(4,12,28,0.78)'; roundRect(x - w / 2, y - 9, w, 18, 9); cx.fill();
    cx.strokeStyle = rgba(col, 0.75); cx.lineWidth = 1; roundRect(x - w / 2, y - 9, w, 18, 9); cx.stroke();
    const ix = label ? x - w / 2 + 9 : x;
    if (it.t === 'atk' || it.t === 'atkp' || it.t === 'drain') swordIcon(ix, y + 0.5, col);
    else if (it.t === 'move') arrowIcon(ix, y, '#cfe8ff', false);
    else if (it.t === 'leap') arrowIcon(ix, y, '#ffcf5a', true);
    else if (it.t === 'block') shieldIcon(ix, y, 6);
    else if (it.t === 'heal') { cx.fillStyle = col; cx.fillRect(ix - 4, y - 1.2, 8, 2.4); cx.fillRect(ix - 1.2, y - 4, 2.4, 8); }
    else if (INTENT_K[it.t]) text(INTENT_K[it.t][0], ix, y + 0.5, 11, INTENT_K[it.t][1], { weight: 900 });
    if (label) text(label, x + 5, y + 0.5, 10.5, '#fff', { font: RD.NUM, weight: 600 });
    if (it.lunge) arrowIcon(x - w / 2 - 6, y, '#cfe8ff', false);
  }

  function drawStrip(R, B, dt) {
    const area = areaFor();
    // 砂地
    const sg = cx.createLinearGradient(0, FLOOR - 4, 0, BY);
    sg.addColorStop(0, area.sand); sg.addColorStop(1, shade(area.sand, -0.5));
    cx.fillStyle = sg;
    cx.beginPath(); cx.moveTo(0, FLOOR); for (let x = 0; x <= LW; x += 20) cx.lineTo(x, FLOOR - 2 + Math.sin(x * 0.05) * 2); cx.lineTo(LW, BY); cx.lineTo(0, BY); cx.closePath(); cx.fill();
    // 海藻
    cx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = 8 + i * 57 + (i % 2) * 12, h = 22 + (i * 13) % 20;
      cx.strokeStyle = i % 2 ? 'rgba(60,160,110,0.55)' : 'rgba(40,120,90,0.5)'; cx.lineWidth = 3;
      cx.beginPath(); cx.moveTo(x, FLOOR + 2);
      cx.quadraticCurveTo(x + Math.sin(time * 1.4 + i) * 6, FLOOR - h * 0.5, x + Math.sin(time * 1.2 + i) * 8, FLOOR - h); cx.stroke();
    }
    // 自分
    drawPlayer(R.charId, 40, FLOOR, time, { hurt: hurtFlash });
    if (B) {
      // 敵
      const list = B.enemies.filter(e => !e.dead).sort((a, b) => b.slot - a.slot);
      for (const e of list) {
        let v = vis[e.uid];
        const tx = slotX(e);
        if (!v) v = vis[e.uid] = { x: e.spawnT ? tx + 30 : tx + 60, hit: 0, kx: 0, lunge: 0, a: 0 };
        v.x += (tx - v.x) * Math.min(1, dt * 7);
        v.a = Math.min(1, v.a + dt * 3);
        v.hit = Math.max(0, v.hit - dt * 4); v.kx = Math.max(0, v.kx - dt * 40); v.lunge = Math.max(0, v.lunge - dt * 3);
        const x = v.x + v.kx - Math.sin(v.lunge * Math.PI) * 14;
        const size = e.def.size || 1;
        const alpha = (e.hidden ? 0.35 : 1) * v.a;
        if (e.freeze > 0) glow(x, FLOOR - 20, 30, '#bdf1ff', 0.5);
        drawCreature(e.def, x, FLOOR, size, time + e.uid, { alpha, flash: v.hit });
        // 体力
        const hw = e.def.boss ? 80 : 38, hx = x - hw / 2, hy = FLOOR + 5;
        cx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(hx, hy, hw, 6, 3); cx.fill();
        cx.fillStyle = e.poison > 0 ? '#c47bff' : '#ff6a6a'; roundRect(hx, hy, Math.max(3, hw * e.hp / e.maxHp), 6, 3); cx.fill();
        text(String(e.hp), x, hy + 13, 9, '#fff', { font: RD.NUM, weight: 600, stroke: 2.5 });
        let sx = hx - 2;
        if (e.block > 0) { shieldIcon(sx - 6, hy + 3, 6); text(String(e.block), sx - 6, hy + 3.5, 7.5, '#0a2040', { font: RD.NUM, weight: 700 }); }
        let stx = x - 14;
        const sy2 = hy + 13;
        if (e.poison > 0) { text('毒' + e.poison, x + hw / 2 + 2, sy2, 8.5, '#e0a6ff', { align: 'left', stroke: 2 }); }
        if (e.armor > 0) text('甲' + e.armor, hx - 2, sy2, 8.5, '#cfe0f0', { align: 'right', stroke: 2 });
        // 予告
        const iy = e.def.boss ? FLOOR - 16 * size * 2.9 - 12 : FLOOR - 16 * size * 2.3 - 10;
        intentIcon(e, x, Math.max(SY + 36, iy));
        RD.hits.push({ id: 'enemy', uid: e.uid, x: x - 24, y: Math.max(SY + 26, iy - 10), w: 48, h: FLOOR - iy + 20 });
      }
      // 倒れた敵
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i]; c.t += dt;
        const k = c.t / (c.boss ? 1.4 : 0.6);
        if (k >= 1) { corpses.splice(i, 1); continue; }
        drawCreature(c.def, c.x, FLOOR - k * 30, c.def.size || 1, time, { alpha: 1 - k, flash: 1 - k });
      }
      // 自分から敵への光
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]; s.t += dt;
        const p = enemyPos(s.uid);
        const k = Math.min(1, s.t / s.life);
        const x = SD.lerp(s.x0, p.x, SD.easeOut(k)), y = SD.lerp(s.y0, p.y, k) - Math.sin(k * Math.PI) * 30;
        glow(x, y, s.big ? 26 : 16, s.col, 1); cx.fillStyle = '#fff'; circle(x, y, s.big ? 5 : 3.5); cx.fill();
        if (k >= 1) shots.splice(i, 1);
      }
    }
    // 照明の陰
    const vg = cx.createLinearGradient(0, SY, 0, BY);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,10,30,0.25)');
    cx.fillStyle = vg; cx.fillRect(0, SY, LW, BY - SY);
  }

  function drawBoard(R, B, dt, aim) {
    const area = areaFor(), W = B.W;
    // 盤面の水
    const g = cx.createLinearGradient(0, BY, 0, BY + W.h);
    g.addColorStop(0, shade(area.bgBot, -0.2, 0.55));
    g.addColorStop(1, 'rgba(2,6,16,0.75)');
    cx.fillStyle = g; cx.fillRect(0, BY, LW, W.h);
    // ゆらぐ光
    if (q()) {
      cx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const x = (i * 71 + time * 9) % (LW + 80) - 40, y = BY + 60 + (i * 97) % (W.h - 80);
        glow(x, y + Math.sin(time + i) * 20, 70, '#4fd0e0', 0.05 * (0.3 + area.light));
      }
      cx.globalCompositeOperation = 'source-over';
    }
    // 縁
    cx.strokeStyle = rgba('#bfe8ff', 0.18); cx.lineWidth = 2; cx.strokeRect(1, BY + 1, LW - 2, W.h - 2);
    // 斜めの板
    for (const s of W.segs) { cx.strokeStyle = '#7a8a9a'; cx.lineWidth = 5; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(s.x1, s.y1 + BY); cx.lineTo(s.x2, s.y2 + BY); cx.stroke(); }
    // 発射台(貝)
    const lx = BAL.launchX, ly = BAL.launchY + BY;
    cx.fillStyle = '#e8d9c0'; cx.beginPath(); cx.moveTo(lx - 20, ly - 6); cx.quadraticCurveTo(lx, ly - 26, lx + 20, ly - 6); cx.closePath(); cx.fill();
    cx.strokeStyle = '#b89f80'; cx.lineWidth = 1; for (let i = -2; i <= 2; i++) { cx.beginPath(); cx.moveTo(lx, ly - 6); cx.lineTo(lx + i * 8, ly - 18 + Math.abs(i) * 3); cx.stroke(); }
    // 狙いの線
    if (aim && aim.pts && B.phase === 'aim') {
      cx.fillStyle = '#ffffff';
      const n = aim.pts.length;
      for (let i = 1; i < n; i += 2) { const p = aim.pts[i]; cx.globalAlpha = 0.85 * (1 - i / n) + 0.1; circle(p.x, p.y + BY, 1.8); cx.fill(); }
      cx.globalAlpha = 1;
      const end = aim.pts[n - 1];
      if (end && !aim.ink) { cx.strokeStyle = 'rgba(255,255,255,0.5)'; cx.lineWidth = 1; circle(end.x, end.y + BY, B.cur ? (D.ball[B.cur.id].p || {}).r || BAL.ballR : BAL.ballR); cx.stroke(); }
    }
    // 次に撃つ玉(発射台の上)
    if (B.phase === 'aim' && B.cur) { const d = D.ball[B.cur.id]; drawBall({ x: lx, y: BAL.launchY, r: (d.p && d.p.r) || BAL.ballR, _tr: [] }, d); }
    // ピン
    for (const p of W.pegs) drawPeg(p, area, dt);
    // 網
    if (W.bucket) {
      const bk = W.bucket, x = bk.x, y = bk.y + BY;
      cx.strokeStyle = '#d9c7a8'; cx.lineWidth = 2;
      cx.beginPath(); cx.moveTo(x - bk.w / 2, y - 4); cx.quadraticCurveTo(x, y + 12, x + bk.w / 2, y - 4); cx.stroke();
      for (let i = -2; i <= 2; i++) { cx.beginPath(); cx.moveTo(x + i * bk.w / 5, y - 3); cx.lineTo(x + i * bk.w / 8, y + 7); cx.stroke(); }
    }
    // 玉
    const def = B.shot ? B.shot.ball : null;
    for (const b of W.balls) drawBall(b, def);
    // 墨
    if (B.ink > 0 || inkT > 0) {
      inkT = Math.max(B.ink > 0 ? 0.6 : 0, inkT - dt);
      cx.fillStyle = 'rgba(20,10,35,' + (0.55 * Math.min(1, inkT + (B.ink > 0 ? 0.4 : 0))) + ')';
      for (let i = 0; i < 5; i++) { circle(60 + i * 60 + Math.sin(time + i) * 10, BY + 150 + (i % 2) * 120, 70); cx.fill(); }
    }
    // ヒット数
    if (B.phase === 'fly' && B.shot) {
      const S = B.shot;
      if (S.hits !== lastHits) { lastHits = S.hits; hitPop = 1; }
      hitPop = Math.max(0, hitPop - dt * 4);
      const sz = 22 + Math.min(18, S.hits * 0.5) + hitPop * 8;
      const col = S.crit ? '#ffb35c' : S.hits >= 25 ? '#ffd25e' : '#e8f8ff';
      if (S.hits > 0) {
        text(S.hits + '', LW - 40, BY + 34, sz, col, { font: RD.NUM, weight: 700, stroke: 4 });
        text('HIT', LW - 40, BY + 34 + sz * 0.55 + 4, 10, '#9fc8e8', { font: RD.NUM, weight: 600, stroke: 2.5 });
        if (S.crit) text('会心', LW - 40, BY + 12, 11, '#ffb35c', { weight: 900, stroke: 3 });
      }
    }
  }

  function drawBar(R, B) {
    const y = BAR;
    cx.fillStyle = 'rgba(4,16,34,0.7)'; cx.fillRect(0, y, LW, LH - y);
    cx.strokeStyle = 'rgba(191,232,255,0.15)'; cx.beginPath(); cx.moveTo(0, y); cx.lineTo(LW, y); cx.stroke();
    if (!B || !B.cur) return;
    const cur = B.cur, def = D.ball[cur.id], lv = Math.min(cur.lv, def.dmg.length);
    ballIcon(cur.id, 26, y + 27, 16, cur.lv);
    text(def.name, 50, y + 17, 12.5, '#f0f8ff', { align: 'left', weight: 700 });
    text('ダメージ ' + SD.G.ballVal(def, lv, 'dmg') + ' / 会心 ' + SD.G.ballVal(def, lv, 'crit'), 50, y + 35, 10, '#9fc8e8', { align: 'left', weight: 500 });
    RD.hits.push({ id: 'ballinfo', x: 0, y, w: 150, h: LH - y });
    // 次の玉
    const up = SD.G.upcoming(3);
    text('次', 160, y + 10, 9, '#7fa8c8', {});
    up.forEach((b, i) => ballIcon(b.id, 160 + i * 22, y + 32, 9, b.lv, i > 0));
    RD.hits.push({ id: 'deck', x: 148, y, w: 72, h: LH - y });
    // 交換
    const sw = B.swaps > 0 && B.phase === 'aim';
    cx.fillStyle = sw ? 'rgba(95,208,255,0.22)' : 'rgba(255,255,255,0.06)'; roundRect(232, y + 9, 58, 36, 9); cx.fill();
    text('交換', 261, y + 22, 11.5, sw ? '#e8f8ff' : '#6a8aa8', { weight: 700 });
    text('残り' + B.swaps, 261, y + 36, 9, sw ? '#9fc8e8' : '#5a7a98', {});
    RD.hits.push({ id: 'swap', x: 230, y, w: 62, h: LH - y });
    // 速さ
    const sp = settings().speed;
    cx.fillStyle = 'rgba(255,255,255,0.1)'; roundRect(298, y + 9, 54, 36, 9); cx.fill();
    text('×' + sp, 325, y + 22, 13, '#e8f8ff', { font: RD.NUM, weight: 600 });
    text('速さ', 325, y + 36, 9, '#9fc8e8', {});
    RD.hits.push({ id: 'speed', x: 294, y, w: 66, h: LH - y });
  }

  function drawSide(R, B) {
    if (view.side < 150) return;
    const w = view.side;
    // 左: 手持ちの玉
    let x = -w - 6, y = SY + 6;
    cx.fillStyle = 'rgba(4,16,34,0.55)'; roundRect(x, y, w, LH - y - 60, 12); cx.fill();
    text('手持ちの玉  ' + R.deck.length, x + 12, y + 18, 12, '#cfeffd', { align: 'left', weight: 700 });
    const deck = R.deck.slice().sort((a, b) => a.id < b.id ? -1 : 1);
    deck.slice(0, 22).forEach((b, i) => {
      const d = D.ball[b.id], yy = y + 44 + i * 26;
      ballIcon(b.id, x + 22, yy, 10, b.lv);
      text(d.name, x + 40, yy, 11, '#e8f8ff', { align: 'left', weight: 500 });
      const lv = Math.min(b.lv, d.dmg.length);
      text(SD.G.ballVal(d, lv, 'dmg') + '/' + SD.G.ballVal(d, lv, 'crit'), x + w - 10, yy, 10, '#9fc8e8', { align: 'right', font: RD.NUM });
    });
    // 右: 遺物
    x = LW + 6; y = SY + 6;
    cx.fillStyle = 'rgba(4,16,34,0.55)'; roundRect(x, y, w, LH - y - 60, 12); cx.fill();
    text('遺物  ' + R.relics.length, x + 12, y + 18, 12, '#cfeffd', { align: 'left', weight: 700 });
    R.relics.slice(0, 22).forEach((id, i) => {
      const r = D.relic[id], yy = y + 44 + i * 26;
      relicIcon(r, x + 20, yy, 10);
      text(r.name, x + 38, yy, 11, '#e8f8ff', { align: 'left', weight: 500 });
    });
  }

  /* ---------- 粒子と文字 ---------- */
  function drawParticles(dt) {
    cx.globalCompositeOperation = 'lighter';
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.t += dt;
      if (p.t >= p.life) { P.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 3; p.vy = p.vy * (1 - dt * 3) + (p.g || 0) * dt - (p.bub ? 40 * dt : 0);
      const k = 1 - p.t / p.life;
      if (p.bub) { cx.strokeStyle = rgba('#dff6ff', k * 0.8); cx.lineWidth = 1; circle(p.x, p.y, p.r * 1.2); cx.stroke(); }
      else { cx.fillStyle = rgba(p.col.length === 7 ? p.col : '#ffffff', k); circle(p.x, p.y, p.r * k + 0.4); cx.fill(); }
    }
    for (let i = RINGS.length - 1; i >= 0; i--) {
      const r = RINGS[i]; r.t += dt;
      if (r.t >= r.life) { RINGS.splice(i, 1); continue; }
      const k = r.t / r.life;
      cx.strokeStyle = rgba(r.col, (1 - k) * 0.8); cx.lineWidth = 2 * (1 - k) + 0.5; circle(r.x, r.y, 4 + r.r1 * SD.easeOut(k)); cx.stroke();
    }
    cx.globalCompositeOperation = 'source-over';
    for (let i = TX.length - 1; i >= 0; i--) {
      const t = TX[i]; t.t += dt;
      if (t.t >= t.life) { TX.splice(i, 1); continue; }
      t.y += t.vy * dt; t.vy *= 1 - dt * 2.5;
      const k = t.t / t.life, a = k > 0.7 ? (1 - k) / 0.3 : 1;
      const pop = t.pop ? 1 + Math.max(0, 0.6 - t.t * 4) : 1;
      cx.globalAlpha = a;
      text(t.str, t.x, t.y, t.size * pop, t.col, { font: t.font, weight: 800, stroke: Math.max(2.5, t.size * 0.22) });
      cx.globalAlpha = 1;
    }
  }

  function drawOverlays(dt, B) {
    // 1ショットの集計
    if (tally) {
      tally.t += dt;
      const life = 1.1;
      if (tally.t > life) tally = null;
      else {
        const k = Math.min(1, tally.t / 0.3), a = tally.t > life - 0.25 ? (life - tally.t) / 0.25 : 1;
        cx.globalAlpha = a;
        const y = BY + 20, w = 210;
        cx.fillStyle = 'rgba(4,14,30,0.78)'; roundRect(LW / 2 - w / 2, y - 16, w, 32, 16); cx.fill();
        cx.strokeStyle = tally.crit ? 'rgba(255,179,92,0.7)' : 'rgba(191,232,255,0.4)'; cx.lineWidth = 1.5; roundRect(LW / 2 - w / 2, y - 16, w, 32, 16); cx.stroke();
        const shown = Math.round(tally.total * SD.easeOut(k));
        if (tally.t < 0.3 && Math.floor(tally.t * 30) !== tally.step) { tally.step = Math.floor(tally.t * 30); SD.Audio.sfx('tally', { step: tally.step }); }
        const mult = tally.mult > 1.001 ? ' ×' + tally.mult.toFixed(2).replace(/0$/, '') : '';
        text(tally.hits + 'ヒット × ' + tally.per + mult, LW / 2 - 18, y, 12, tally.crit ? '#ffcf8a' : '#cfeffd', { weight: 700 });
        text(String(shown), LW / 2 + w / 2 - 26, y + 0.5, 18, tally.crit ? '#ffb35c' : '#ffffff', { font: RD.NUM, weight: 700 });
        cx.globalAlpha = 1;
      }
    }
    // 見出し
    if (banner) {
      banner.t += dt;
      const life = banner.life || 1.4;
      if (banner.t > life) banner = null;
      else {
        const k = banner.t, a = k < 0.15 ? k / 0.15 : k > life - 0.3 ? (life - k) / 0.3 : 1, sc = 1 + Math.max(0, 0.25 - k) * 2;
        cx.globalAlpha = a;
        const y = banner.boss ? FLOOR - 70 : BY + 150;
        cx.fillStyle = 'rgba(2,8,20,0.55)'; cx.fillRect(0, y - 30, LW, 60);
        text(banner.text, LW / 2, y - 4, (banner.big ? 30 : 26) * sc, banner.col, { weight: 900, stroke: 5 });
        if (banner.sub) text(banner.sub, LW / 2, y + 20, 11, '#cfeffd', { font: RD.NUM, weight: 600 });
        cx.globalAlpha = 1;
      }
    }
  }

  /* ---------- 1枚ぶん描く ---------- */
  RD.frame = function (dt, st) {
    time += dt;
    for (let i = pending.length - 1; i >= 0; i--) { pending[i].t -= dt; if (pending[i].t <= 0) { const f = pending[i].f; pending.splice(i, 1); one(f); } }
    shake = Math.max(0, shake - dt * 30);
    flashA = Math.max(0, flashA - dt * 2.2);
    hurtFlash = Math.max(0, hurtFlash - dt * 3);
    bigT = Math.max(0, bigT - dt);
    RD.hits.length = 0;
    const R = SD.G.R, B = SD.G.B;
    const area = st.screen === 'title' ? D.AREAS[0] : areaFor();
    drawBackground(dt, area);
    if (st.screen === 'title') { drawTitleScene(dt); }
    else if (B && R && (R.phase === 'battle' || st.screen === 'battle')) {
      setCol();
      drawSide(R, B);
      drawStrip(R, B, dt);
      drawBoard(R, B, dt, st.aim);
      drawHud(R, B);
      drawBar(R, B);
      drawParticles(dt);
      drawOverlays(dt, B);
    } else {
      setCol();
      drawParticles(dt);
    }
    if (flashA > 0.01) { cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = rgba(flashCol.length === 7 ? flashCol : '#ffffff', flashA); cx.fillRect(0, 0, CW, CH); }
  };
  RD.clearFx = function () { P.length = 0; TX.length = 0; RINGS.length = 0; pending.length = 0; corpses.length = 0; shots.length = 0; banner = null; tally = null; for (const k in vis) delete vis[k]; };
  RD.ballIconAt = ballIcon;

  /* ---------- タイトルの背景(玉がピンの間を落ち続ける) ---------- */
  let demo = null, demoT = 0;
  function drawTitleScene(dt) {
    if (!demo) {
      const layout = D.BOARDS.pyramid(new SD.Rng(7));
      demo = SD.Phys.makeWorld(layout, BAL.pegR);
      demo.pegs.forEach((p, i) => { if (i % 9 === 0) p.type = 'crit'; else if (i % 13 === 0) p.type = 'refresh'; });
    }
    demoT -= dt;
    if (demoT <= 0 && demo.balls.length < 4) {
      demoT = 0.9;
      const a = 0.6 + Math.random() * 1.9;
      SD.Phys.addBall(demo, { vx: Math.cos(a) * 380, vy: Math.sin(a) * 380 });
    }
    SD.Phys.step(demo, dt, { hit(b, p) { p.flash = 1; }, wall() { } });
    if (Math.random() < dt * 0.5) for (const p of demo.pegs) if (p.state !== 'alive') p.state = 'alive';
    setCol(0, 0);
    cx.save(); cx.translate(0, 230 - BY);
    const area = D.AREAS[0];
    cx.globalAlpha = 0.32;
    for (const p of demo.pegs) { const st = p.state; p.state = 'alive'; drawPeg(p, area, dt); p.state = st; }
    cx.globalAlpha = 1;
    for (const b of demo.balls) drawBall(b, D.ball.pearl);
    cx.restore();
  }

  return RD;
})();
