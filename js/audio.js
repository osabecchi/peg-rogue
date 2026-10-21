'use strict';
/* 潮珠 SHIODAMA — 効果音とBGMを WebAudio でその場で合成する */
SD.Audio = (function () {
  let ctx = null, master, musicBus, sfxBus, echoIn, comp, noiseBuf;
  const vol = { master: 0.8, bgm: 0.55, sfx: 0.8 };
  let lastPegT = 0, pegVoices = 0;

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    // 水の中らしい残響(ローパスを通したフィードバックディレイ)
    echoIn = ctx.createGain(); echoIn.gain.value = 0.35;
    const d = ctx.createDelay(1); d.delayTime.value = 0.19;
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    echoIn.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(master);
    const len = ctx.sampleRate * 1.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    applyVol();
    return true;
  }
  function unlock() { if (!init()) return; if (ctx.state === 'suspended') ctx.resume(); }
  function applyVol() {
    if (!ctx) return;
    master.gain.value = vol.master;
    musicBus.gain.value = vol.bgm * 0.5;
    sfxBus.gain.value = vol.sfx * 0.9;
  }
  function setVolumes(s) { vol.master = s.master; vol.bgm = s.bgm; vol.sfx = s.sfx; applyVol(); }

  function tone(f, t, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.slide || dur));
    if (o.detune) osc.detune.value = o.detune;
    const a = o.a || 0.005, peak = o.gain == null ? 0.3 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = g;
    if (o.filter) { const fl = ctx.createBiquadFilter(); fl.type = o.filter; fl.frequency.value = o.ff || 1200; fl.Q.value = o.q || 1; g.connect(fl); node = fl; }
    osc.connect(g);
    node.connect(o.dest || sfxBus);
    if (o.echo) node.connect(echoIn);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f || 1200, t); f.Q.value = o.q || 0.7;
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain == null ? 0.3 : o.gain, t + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    if (o.echo) g.connect(echoIn);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ピンに当たるたびに音程が上がる(長調の五音音階)
  const PENT = [0, 2, 4, 7, 9];
  function pegFreq(n) {
    const i = Math.min(n, 20);
    return 392 * Math.pow(2, (12 * Math.floor(i / 5) + PENT[i % 5]) / 12);
  }

  const S = {
    peg(o) {
      const t = ctx.currentTime;
      if (t - lastPegT < 0.018) { pegVoices++; if (pegVoices > 3) return; } else pegVoices = 0;
      lastPegT = t;
      const n = o.n || 1, f = pegFreq(n - 1);
      const top = n > 20;
      tone(f, t, 0.22, { type: 'triangle', gain: 0.22, echo: true });
      tone(f * 2, t, 0.12, { gain: 0.08 });
      if (top) tone(f * 1.5 * (1 + (n % 3) * 0.12), t + 0.01, 0.15, { gain: 0.06, echo: true });
      if (o.kind === 'crit') { tone(f * 3, t, 0.5, { gain: 0.12, echo: true }); tone(f * 4, t + 0.05, 0.4, { gain: 0.08, echo: true }); }
      else if (o.kind === 'heal') tone(f * 1.25, t + 0.03, 0.3, { gain: 0.1, echo: true });
      else if (o.kind === 'gold') { tone(1568, t, 0.08, { type: 'square', gain: 0.05 }); tone(2093, t + 0.05, 0.12, { type: 'square', gain: 0.05 }); }
      else if (o.kind === 'refresh') { for (let i = 0; i < 4; i++) tone(f * (1 + i * 0.25), t + i * 0.04, 0.2, { gain: 0.08, echo: true }); }
    },
    wall() { const t = ctx.currentTime; noise(t, 0.08, { f: 500, gain: 0.08 }); },
    bump() { const t = ctx.currentTime; tone(220, t, 0.25, { to: 660, slide: 0.12, gain: 0.18, type: 'sine' }); },
    rock() { const t = ctx.currentTime; noise(t, 0.07, { f: 900, gain: 0.12, type: 'bandpass', q: 2 }); tone(140, t, 0.08, { gain: 0.12 }); },
    crack() { const t = ctx.currentTime; noise(t, 0.05, { f: 3000, gain: 0.1, type: 'highpass' }); },
    arm() { const t = ctx.currentTime; tone(880, t, 0.06, { type: 'square', gain: 0.06 }); tone(660, t + 0.07, 0.06, { type: 'square', gain: 0.05 }); },
    bomb() {
      const t = ctx.currentTime;
      noise(t, 0.6, { f: 1800, to: 120, gain: 0.5, echo: true });
      tone(120, t, 0.5, { to: 35, gain: 0.5, type: 'sine' });
    },
    blast() { const t = ctx.currentTime; noise(t, 0.25, { f: 2500, to: 300, gain: 0.22 }); },
    launch() {
      const t = ctx.currentTime;
      noise(t, 0.25, { f: 600, to: 2400, gain: 0.12, type: 'bandpass', q: 1.5 });
      tone(180, t, 0.16, { to: 420, gain: 0.2 });
    },
    split() { const t = ctx.currentTime; tone(700, t, 0.08, { to: 1100, gain: 0.1 }); },
    echo() { const t = ctx.currentTime; tone(520, t, 0.3, { to: 1040, gain: 0.12, echo: true }); },
    wrap() { const t = ctx.currentTime; tone(1200, t, 0.18, { to: 600, gain: 0.08, echo: true }); },
    bucket() { const t = ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.05, 0.3, { type: 'triangle', gain: 0.14, echo: true })); },
    bounceUp() { const t = ctx.currentTime; tone(200, t, 0.3, { to: 900, gain: 0.2 }); },
    refresh() { const t = ctx.currentTime; [0, 4, 7, 12, 16].forEach((s, i) => tone(523 * Math.pow(2, s / 12), t + i * 0.05, 0.35, { type: 'triangle', gain: 0.12, echo: true })); },
    tally(o) { const t = ctx.currentTime; tone(pegFreq(Math.min(18, (o.step || 0) + 6)), t, 0.1, { type: 'square', gain: 0.05, filter: 'lowpass', ff: 3000 }); },
    hit(o) {
      const t = ctx.currentTime, big = o && o.big;
      noise(t, big ? 0.35 : 0.18, { f: big ? 3000 : 2000, to: 200, gain: big ? 0.4 : 0.25 });
      tone(big ? 90 : 140, t, big ? 0.35 : 0.18, { to: 45, gain: big ? 0.45 : 0.3 });
    },
    crit() { const t = ctx.currentTime; [1319, 1760, 2637].forEach((f, i) => tone(f, t + i * 0.03, 0.5, { gain: 0.09, echo: true })); },
    bigShot() {
      const t = ctx.currentTime;
      [0, 4, 7, 11, 14].forEach((s, i) => tone(392 * Math.pow(2, s / 12), t + i * 0.06, 0.9, { type: 'triangle', gain: 0.13, echo: true }));
      noise(t, 0.8, { f: 6000, gain: 0.08, type: 'highpass' });
    },
    hurt() { const t = ctx.currentTime; tone(160, t, 0.25, { to: 60, type: 'sawtooth', gain: 0.18, filter: 'lowpass', ff: 700 }); noise(t, 0.15, { f: 900, gain: 0.2 }); },
    block() { const t = ctx.currentTime; tone(900, t, 0.12, { type: 'square', gain: 0.06, filter: 'bandpass', ff: 1500 }); noise(t, 0.08, { f: 4000, gain: 0.08, type: 'highpass' }); },
    heal() { const t = ctx.currentTime; [659, 784, 988].forEach((f, i) => tone(f, t + i * 0.07, 0.4, { gain: 0.1, echo: true })); },
    shield() { const t = ctx.currentTime; tone(660, t, 0.3, { type: 'triangle', gain: 0.1, to: 990 }); },
    coin() { const t = ctx.currentTime; tone(1568, t, 0.07, { type: 'square', gain: 0.05 }); tone(2093, t + 0.06, 0.18, { type: 'square', gain: 0.05 }); },
    click() { const t = ctx.currentTime; tone(880, t, 0.05, { gain: 0.08, type: 'triangle' }); },
    select() { const t = ctx.currentTime; tone(660, t, 0.08, { gain: 0.1, type: 'triangle' }); tone(990, t + 0.05, 0.12, { gain: 0.1, type: 'triangle' }); },
    back() { const t = ctx.currentTime; tone(660, t, 0.07, { gain: 0.08, type: 'triangle' }); tone(440, t + 0.05, 0.1, { gain: 0.08, type: 'triangle' }); },
    buy() { S.coin(); const t = ctx.currentTime; tone(523, t + 0.1, 0.2, { type: 'triangle', gain: 0.1 }); },
    poison() { const t = ctx.currentTime; tone(300, t, 0.3, { to: 180, type: 'sawtooth', gain: 0.06, filter: 'lowpass', ff: 900 }); },
    freeze() { const t = ctx.currentTime; [2093, 2637, 3136].forEach((f, i) => tone(f, t + i * 0.04, 0.3, { gain: 0.05, echo: true })); },
    summon() { const t = ctx.currentTime; tone(200, t, 0.3, { to: 500, gain: 0.1, echo: true }); },
    ink() { const t = ctx.currentTime; noise(t, 0.5, { f: 400, gain: 0.2, to: 150 }); },
    rocks() { const t = ctx.currentTime; for (let i = 0; i < 3; i++) { noise(t + i * 0.07, 0.1, { f: 700, gain: 0.15 }); tone(90, t + i * 0.07, 0.1, { gain: 0.15 }); } },
    death() { const t = ctx.currentTime; tone(400, t, 0.3, { to: 120, gain: 0.12, echo: true }); noise(t, 0.2, { f: 1500, gain: 0.12 }); },
    roar() { const t = ctx.currentTime; tone(70, t, 1.2, { type: 'sawtooth', gain: 0.25, filter: 'lowpass', ff: 300, to: 45 }); noise(t, 1, { f: 300, gain: 0.25 }); },
    phase() { S.roar(); },
    win() { const t = ctx.currentTime; [0, 4, 7, 12].forEach((s, i) => tone(523 * Math.pow(2, s / 12), t + i * 0.1, 0.5, { type: 'triangle', gain: 0.14, echo: true })); },
    lose() { const t = ctx.currentTime; [7, 3, 0, -5].forEach((s, i) => tone(392 * Math.pow(2, s / 12), t + i * 0.18, 0.6, { type: 'triangle', gain: 0.12, echo: true })); },
    evolve() { const t = ctx.currentTime; for (let i = 0; i < 10; i++) tone(392 * Math.pow(2, (i * 2) / 12), t + i * 0.05, 0.6, { type: 'triangle', gain: 0.1, echo: true }); },
    ach() { const t = ctx.currentTime; [1047, 1319, 1568].forEach((f, i) => tone(f, t + i * 0.08, 0.5, { gain: 0.08, echo: true })); },
    swap() { const t = ctx.currentTime; tone(500, t, 0.08, { to: 800, gain: 0.08 }); },
    miss() { const t = ctx.currentTime; noise(t, 0.2, { f: 2000, gain: 0.1, type: 'bandpass', to: 500 }); },
  };
  function sfx(name, o) {
    if (!ctx || vol.sfx <= 0 || !S[name]) return;
    try { S[name](o || {}); } catch (e) { /* 音が出せなくても遊べる */ }
  }

  /* ---------- BGM ---------- */
  // ch: 1小節ごとの和音(根音からの半音)。root は MIDI 番号
  const TRACKS = {
    title: { bpm: 70, root: 50, prog: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 7]], arp: 'slow', drums: 0, cut: 900, bubbles: 1 },
    reef: { bpm: 96, root: 60, prog: [[0, 4, 7, 12], [-3, 0, 4, 9], [-7, -3, 0, 5], [-5, -1, 2, 7]], arp: 'run', drums: 1, cut: 1500, bubbles: 1 },
    twilight: { bpm: 84, root: 57, prog: [[0, 3, 7, 10], [-4, 0, 3, 8], [-9, -5, -2, 3], [-2, 2, 5, 10]], arp: 'run', drums: 1, cut: 1100, bubbles: 0.6 },
    abyss: { bpm: 70, root: 50, prog: [[0, 3, 7, 10], [-4, -1, 3, 8], [-7, -4, 0, 5], [-5, -1, 2, 7]], arp: 'slow', drums: 1, cut: 700, bubbles: 0.3 },
    deep: { bpm: 64, root: 48, prog: [[0, 3, 7, 10], [1, 5, 8, 12], [-2, 2, 5, 9], [-5, -1, 2, 7]], arp: 'slow', drums: 0, cut: 600, bubbles: 0.2 },
    boss: { bpm: 132, root: 52, prog: [[0, 3, 7, 12], [-4, 0, 3, 8], [-2, 2, 5, 10], [-5, -1, 2, 7]], arp: 'fast', drums: 2, cut: 1800, bubbles: 0 },
    final: { bpm: 120, root: 48, prog: [[0, 3, 7, 12], [-4, 0, 3, 8], [-2, 2, 5, 10], [-1, 2, 5, 11]], arp: 'fast', drums: 2, cut: 1600, bubbles: 0 },
    shop: { bpm: 104, root: 62, prog: [[0, 4, 7, 9], [-3, 0, 4, 7], [2, 5, 9, 12], [-5, -1, 2, 5]], arp: 'run', drums: 1, cut: 2000, bubbles: 0.5 },
  };
  let cur = null, curName = '', step = 0, nextT = 0, timer = null, musicGain = null;
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  function music(name) {
    if (!ctx || name === curName) return;
    curName = name;
    const old = musicGain;
    if (old) { old.gain.setTargetAtTime(0, ctx.currentTime, 0.4); setTimeout(() => { try { old.disconnect(); } catch (e) { } }, 2000); }
    cur = TRACKS[name] || null;
    if (!cur) { musicGain = null; return; }
    musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(musicBus);
    musicGain.gain.setTargetAtTime(1, ctx.currentTime, 0.6);
    step = 0; nextT = ctx.currentTime + 0.1;
    if (!timer) timer = setInterval(schedule, 30);
  }
  function schedule() {
    if (!ctx || !cur || !musicGain) return;
    const sp = 60 / cur.bpm / 4;
    while (nextT < ctx.currentTime + 0.15) { playStep(step, nextT, sp); step++; nextT += sp; }
  }
  function playStep(s, t, sp) {
    const T = cur, bar = Math.floor(s / 16) % T.prog.length, st = s % 16, ch = T.prog[bar], dst = musicGain;
    if (st === 0) {
      // 和音(パッド)
      for (const n of ch) {
        tone(midi(T.root + n), t, sp * 16 + 0.3, { type: 'sawtooth', gain: 0.022, a: 0.5, filter: 'lowpass', ff: T.cut, dest: dst, detune: -6 });
        tone(midi(T.root + n), t, sp * 16 + 0.3, { type: 'sawtooth', gain: 0.022, a: 0.5, filter: 'lowpass', ff: T.cut, dest: dst, detune: 7 });
      }
    }
    // ベース
    const bassPat = T.drums >= 2 ? [0, 3, 6, 8, 10, 14] : [0, 8, 11];
    if (bassPat.includes(st)) tone(midi(T.root - 12 + ch[0]), t, sp * 2.5, { type: 'triangle', gain: 0.16, dest: dst });
    // アルペジオ
    const arpEvery = T.arp === 'fast' ? 1 : T.arp === 'run' ? 2 : 4;
    if (st % arpEvery === 0) {
      const idx = (s / arpEvery) % 8, seq = [0, 1, 2, 3, 2, 1, 3, 2];
      const n = ch[seq[Math.floor(idx)] % ch.length] + 12;
      tone(midi(T.root + n), t, sp * 3, { type: 'triangle', gain: T.arp === 'fast' ? 0.045 : 0.06, dest: dst, echo: true });
    }
    // 打楽器
    if (T.drums >= 1 && (st === 0 || (T.drums >= 2 && st === 8))) tone(110, t, 0.2, { to: 40, gain: 0.3, dest: dst });
    if (T.drums >= 2 && (st === 4 || st === 12)) noise(t, 0.12, { f: 1800, gain: 0.12, type: 'bandpass', dest: dst });
    if (T.drums >= 1 && st % 2 === 0) noise(t, 0.04, { f: 7000, gain: T.drums >= 2 ? 0.05 : 0.025, type: 'highpass', dest: dst });
    // 泡の音
    if (T.bubbles && Math.random() < 0.04 * T.bubbles) tone(1200 + Math.random() * 1600, t, 0.08, { to: 2400 + Math.random() * 1200, gain: 0.02, dest: dst, echo: true });
  }

  return { init, unlock, setVolumes, sfx, music, get ctx() { return ctx; } };
})();
