'use strict';
/* 潮珠 SHIODAMA — 起動・毎フレームの処理・入力(マウス/タッチ/キーボード/ゲームパッド) */
SD.Main = (function () {
  const G = SD.G, RD = SD.Render, UI = SD.UI, AU = SD.Audio, D = SD.D, BAL = D.BAL;
  const M = {};
  const IN = SD.Input = { touch: false, aiming: false, angle: Math.PI / 2, pid: null, ff: false, keyFF: false, startX: 0, startA: 0, moved: false };
  let last = performance.now(), lastPhase = '', aimCache = { key: '', pts: null, ink: false }, quality = '';
  const keys = {};
  const cv = document.getElementById('cv');

  /* ---------- 場面の切り替え ---------- */
  function areaTrack(R) { return ['reef', 'twilight', 'abyss', 'deep'][Math.min(3, R.area)]; }
  function musicFor() {
    const R = G.R;
    if (UI.screen !== 'game' || !R) return 'title';
    if (R.phase === 'battle' && G.B) return G.B.kind === 'final' ? 'final' : G.B.kind === 'boss' ? 'boss' : areaTrack(R);
    if (R.phase === 'shop') return 'shop';
    if (R.phase === 'result') return 'title';
    return areaTrack(R);
  }
  M.onPhase = function () { AU.music(musicFor()); };
  M.onTitle = function () { RD.clearFx(); AU.music('title'); };
  M.onRunStart = function () { RD.clearFx(); M.onPhase(); };
  M.startRun = function (opt) {
    AU.unlock();
    G.newRun(opt);
    UI.screen = 'game'; UI.overlay = []; UI.tip = null;
    M.onRunStart(); UI.refresh();
  };
  M.applySettings = function () {
    const s = G.save.settings;
    AU.setVolumes(s);
    if (s.quality !== quality) { quality = s.quality; RD.resize(); }
  };

  /* ---------- 狙い ---------- */
  function launcherScreen() { return { x: BAL.launchX, y: BAL.launchY + RD.L.BY }; }
  function angleTo(lx, ly) {
    const L = launcherScreen();
    let a = Math.atan2(ly - L.y, lx - L.x);
    if (a < 0) a = lx < L.x ? Math.PI - 0.1 : 0.1; // 発射台より上を指したら真横
    return G.clampAngle(a);
  }
  function aimPoints() {
    const B = G.B;
    if (!B || B.phase !== 'aim' || !B.cur) return null;
    const m = G.mods(), aimLen = m.aimLen || 0;
    const key = IN.angle.toFixed(4) + '|' + B.shots + '|' + B.turn + '|' + B.cur.uid + '|' + B.ink + '|' + (B.W.pegs.length);
    if (key !== aimCache.key || B.W.pegs.some(p => p.mv)) {
      const props = G.ballProps(B.cur, IN.angle);
      if (B.ink > 0) {
        const pts = [];
        for (let i = 0; i < 8; i++) pts.push({ x: props.x + props.vx * i * 0.012, y: props.y + props.vy * i * 0.012 });
        aimCache = { key, pts, ink: true };
      } else {
        aimCache = { key, pts: SD.Phys.preview(B.W, props, 1 + Math.round(aimLen), 190 + aimLen * 150), ink: false };
      }
    }
    return aimCache;
  }
  function fire() {
    const B = G.B;
    if (!B || B.phase !== 'aim' || UI.overlay.length) return;
    if (G.fire(IN.angle)) {
      const tu = G.save.tutorial;
      if (!tu.aim) tu.aim = true;
      else if (!tu.battle && B.shots >= 2) tu.battle = true;
      UI.tip = null;
    }
  }

  /* ---------- 毎フレーム ---------- */
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    try { step(dt); } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }
  function step(dt) {
    pollPad(dt);
    const R = G.R, B = G.B, s = G.save.settings;
    const paused = UI.overlay.length > 0 || UI.screen !== 'game';
    if (R && !paused && R.phase !== 'result') R.time += dt;
    // キーで狙う
    if (B && B.phase === 'aim' && !paused) {
      const k = (keys.ArrowLeft || keys.KeyA ? 1 : 0) - (keys.ArrowRight || keys.KeyD ? 1 : 0) + padAim;
      if (k) IN.angle = G.clampAngle(IN.angle + k * dt * (keys.ShiftLeft || keys.ShiftRight ? 0.25 : 1.1));
    }
    let gdt = dt;
    if (RD.hitStop > 0) { RD.hitStop -= dt; gdt = 0; }
    if (B && !paused) {
      if (B.phase === 'fly') {
        const ff = IN.ff || IN.keyFF || padFF;
        G.updateFlight(gdt * s.speed * BAL.timeScale * (ff ? 2.6 : 1));
      }
      if (B.phase !== 'fly') G.update(gdt * (s.speed > 1 ? 1.25 : 1));
    }
    if (B && !paused && B.phase === 'aim' && B.intro > 0) B.intro -= dt;
    RD.handleFx(G.fx);
    UI.drainToasts();
    const ph = R ? R.phase + (G.B ? G.B.kind : '') : 'none';
    if (ph !== lastPhase) { lastPhase = ph; M.onPhase(); if (R && R.phase === 'battle') { UI.tip = null; } G.persist(); }
    UI.sync();
    RD.frame(paused && UI.overlay.length ? 0 : dt, { screen: UI.screen === 'game' ? 'game' : 'title', aim: B && B.phase === 'aim' && !paused ? aimPoints() : null });
  }

  /* ---------- 画面上のボタン(キャンバスに描いたもの) ---------- */
  function hitTest(x, y) {
    for (let i = RD.hits.length - 1; i >= 0; i--) { const h = RD.hits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; }
    return null;
  }
  function pressHud(h) {
    const B = G.B;
    switch (h.id) {
      case 'pause': UI.push('pause'); AU.sfx('click'); return true;
      case 'relics': UI.push('relics'); AU.sfx('click'); return true;
      case 'deck': UI.push('deck'); AU.sfx('click'); return true;
      case 'swap': if (G.swap()) aimCache.key = ''; return true;
      case 'speed': { const s = G.save.settings; s.speed = s.speed >= 2 ? 1 : s.speed === 1 ? 1.5 : 2; G.persist(); AU.sfx('click'); return true; }
      case 'ballinfo': UI.showBall(); AU.sfx('click'); return true;
      case 'enemy': if (B && B.phase !== 'fly') { UI.showEnemy(h.uid); AU.sfx('click'); return true; } return false;
    }
    return false;
  }

  /* ---------- ポインター ---------- */
  function inBattle() { return UI.screen === 'game' && G.R && G.R.phase === 'battle' && G.B && !UI.overlay.length && !G.R.pick; }
  cv.addEventListener('pointerdown', e => {
    AU.unlock();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') IN.touch = true; else IN.touch = false;
    if (!inBattle()) return;
    e.preventDefault();
    const p = RD.toLogical(e.clientX, e.clientY), B = G.B;
    const hadTip = !!UI.tip;
    if (hadTip) { UI.tip = null; UI.refresh(); }
    const h = hitTest(p.x, p.y);
    if (h && (h.id !== 'enemy' || B.phase !== 'aim' || p.y < RD.L.BY)) { if (pressHud(h)) return; }
    if (B.phase === 'fly') { IN.ff = true; IN.pid = e.pointerId; return; }
    if (hadTip) return; // 説明を閉じるだけのタップでは撃たない
    if (B.phase !== 'aim' || p.y < RD.L.SY + 26) return;
    IN.aiming = true; IN.pid = e.pointerId; IN.moved = false;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    if (IN.touch && G.save.settings.aimMode === 'drag') { IN.startX = p.x; IN.startA = IN.angle; }
    else if (p.y >= RD.L.BY - 10) IN.angle = angleTo(p.x, p.y);
  });
  cv.addEventListener('pointermove', e => {
    if (!inBattle()) return;
    const p = RD.toLogical(e.clientX, e.clientY), B = G.B;
    if (B.phase !== 'aim') return;
    if (IN.aiming && e.pointerId === IN.pid) {
      IN.moved = true;
      if (IN.touch && G.save.settings.aimMode === 'drag') IN.angle = G.clampAngle(IN.startA - (p.x - IN.startX) * 0.006);
      else if (p.y >= RD.L.BY - 10) IN.angle = angleTo(p.x, p.y);
    } else if (e.pointerType === 'mouse' && p.y >= RD.L.BY - 10) IN.angle = angleTo(p.x, p.y);
  });
  const endPtr = e => {
    if (e.pointerId !== IN.pid) return;
    IN.ff = false;
    if (!IN.aiming) { IN.pid = null; return; }
    IN.aiming = false; IN.pid = null;
    if (!inBattle() || e.type === 'pointercancel') return;
    const p = RD.toLogical(e.clientX, e.clientY);
    // 上の戦闘の帯まで戻して離したら取り消し
    if (p.y < RD.L.BY - 16) return;
    fire();
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  /* ---------- キーボード ---------- */
  window.addEventListener('keydown', e => {
    AU.unlock();
    keys[e.code] = true;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.code === 'Escape') {
      if (UI.overlay.length) { UI.pop(); AU.sfx('back'); }
      else if (UI.tip) { UI.tip = null; UI.refresh(); }
      else if (UI.screen === 'game' && G.R && G.R.phase !== 'result') UI.push('pause');
      else if (UI.screen !== 'title' && UI.screen !== 'game') { UI.screen = 'title'; UI.refresh(); }
      e.preventDefault(); return;
    }
    if (inBattle()) {
      const B = G.B;
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { if (B.phase === 'aim') fire(); else IN.keyFF = true; e.preventDefault(); }
      else if (e.code === 'KeyS' || e.code === 'KeyQ') { if (G.swap()) aimCache.key = ''; }
      else if (e.code === 'KeyF') pressHud({ id: 'speed' });
      else if (e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (e.code.startsWith('Arrow')) { moveFocus(e.code); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Space' || e.code === 'Enter') IN.keyFF = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; IN.ff = false; IN.keyFF = false; });

  // 矢印キーとゲームパッドで、いちばん近いボタンにフォーカスを移す
  function moveFocus(code) {
    const els = Array.from(document.querySelectorAll('#ui button:not([disabled]), #ui [data-act][role="button"], #ui input'))
      .filter(el => el.offsetParent !== null);
    if (!els.length) return;
    const cur = document.activeElement;
    if (!els.includes(cur)) { els[0].focus(); return; }
    const r0 = cur.getBoundingClientRect(), c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[code];
    let best = null, bs = Infinity;
    for (const el of els) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - c0.x, dy = r.top + r.height / 2 - c0.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const side = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const sc = along + side * 2.5;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---------- ゲームパッド ---------- */
  let padAim = 0, padFF = false, padPrev = {}, padRepeat = 0;
  function pollPad(dt) {
    padAim = 0; padFF = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find(p => p && p.connected);
    if (!gp) return;
    const btn = i => gp.buttons[i] && gp.buttons[i].pressed;
    const pressed = i => btn(i) && !padPrev[i];
    const ax = Math.abs(gp.axes[0] || 0) > 0.2 ? gp.axes[0] : 0;
    if (inBattle()) {
      padAim = -ax - (btn(15) ? 1 : 0) + (btn(14) ? 1 : 0);
      const B = G.B;
      if (pressed(0)) { if (B.phase === 'aim') fire(); }
      if (btn(0) && B.phase === 'fly') padFF = true;
      if (pressed(2)) { if (G.swap()) aimCache.key = ''; }
      if (pressed(3)) pressHud({ id: 'speed' });
      if (pressed(9)) UI.push('pause');
    } else {
      padRepeat -= dt;
      const dirs = [[12, 'ArrowUp'], [13, 'ArrowDown'], [14, 'ArrowLeft'], [15, 'ArrowRight']];
      for (const [i, code] of dirs) if (btn(i) && (pressed(i) || padRepeat <= 0)) { moveFocus(code); padRepeat = pressed(i) ? 0.35 : 0.12; }
      if (pressed(0) && document.activeElement && document.activeElement.click) document.activeElement.click();
      if (pressed(1) || pressed(9)) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    }
    padPrev = {}; gp.buttons.forEach((b, i) => { padPrev[i] = b.pressed; });
  }

  /* ---------- そのほか ---------- */
  window.addEventListener('resize', () => RD.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      G.persist();
      if (inBattle()) UI.push('pause');
    }
  });
  window.addEventListener('pagehide', () => G.persist());

  // テスト用に外から触れる口
  M.tick = function (dt) { step(dt); };
  M.IN = IN;

  function boot() {
    G.init();
    RD.init(cv);
    UI.init();
    quality = G.save.settings.quality;
    M.applySettings();
    UI.screen = 'title';
    UI.refresh();
    requestAnimationFrame(loop);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !/claude|localhost|127\.0\.0\.1/.test(location.hostname)) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }
  setTimeout(boot, 0);
  return M;
})();
