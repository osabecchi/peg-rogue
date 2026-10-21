'use strict';
/* 潮珠 SHIODAMA — 共通の道具(乱数・数学・セーブ) */
const SD = window.SD = window.SD || {};

SD.SAVE_KEY = 'peg-rogue-save-v1';
SD.headless = false; // テスト用ボット: 演出を省いて即時に処理する
SD.GX = {};          // data.js の効果から呼ぶ操作(中身は game.js で入れる)

/* ---------- 数学 ---------- */
SD.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
SD.lerp = (a, b, t) => a + (b - a) * t;
SD.easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);
SD.easeOutBack = t => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
SD.fmt = n => Math.round(n).toLocaleString('ja-JP');
SD.fmtTime = s => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };

/* ---------- シード付き乱数 ---------- */
SD.hash = function () {
  const s = Array.prototype.join.call(arguments, '|');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
};

SD.Rng = function (seed) { this.s = (seed >>> 0) || 1; };
SD.Rng.prototype = {
  next() {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
  range(a, b) { return a + (b - a) * this.next(); },
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); },
  chance(p) { return this.next() < p; },
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  },
  weighted(list, wf) {
    let tot = 0; for (const it of list) tot += Math.max(0, wf(it));
    if (tot <= 0) return list[0];
    let r = this.next() * tot;
    for (const it of list) { r -= Math.max(0, wf(it)); if (r < 0) return it; }
    return list[list.length - 1];
  },
  clone() { return new SD.Rng(this.s); },
};

SD.todayKey = function (d) {
  d = d || new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};

/* ---------- セーブ ---------- */
SD.defaultSettings = () => ({
  master: 0.8, bgm: 0.55, sfx: 0.8, quality: 'high', shake: 1, flash: 1, speed: 1, aimMode: 'direct', guide: true,
});

SD.defaultSave = () => ({
  v: 1,
  pearls: 0, pearlsTotal: 0,
  upgrades: {},
  unlocked: { chars: { nagi: true }, items: {} },
  maxDiff: 0,           // 選べる水圧の上限
  clears: {},           // キャラごとのクリアした最高水圧
  ach: {},
  seen: { balls: {}, relics: {}, enemies: {} },
  evolved: {},
  daily: {},            // 日付 → ベストスコア
  endlessBest: 0,
  tutorial: { aim: false, battle: false, map: false },
  stats: {
    runs: 0, wins: 0, deaths: 0, shots: 0, pegs: 0, damage: 0, kills: 0, bombs: 0, crits: 0, refresh: 0,
    poisonKills: 0, gold: 0, playTime: 0, bestShot: 0, bestHits: 0, bestFloor: 0, bestScore: 0, evolves: 0,
    bossKills: 0, elitesKilled: 0, charWins: {}, dailyPlays: 0, flawlessBoss: 0,
    battlesWon: 0, areaBoss0: 0, areaBoss1: 0, areaBoss2: 0, bestRelics: 0, bestGold: 0, bestDiffWin: -1,
    endlessLoopBoss: 0, multiKill: 0, bestEndless: 0,
  },
  settings: SD.defaultSettings(),
  run: null,
});

function sdMerge(base, add) {
  if (!add || typeof add !== 'object' || Array.isArray(add)) return add === undefined ? base : add;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k of Object.keys(add)) {
    const b = base ? base[k] : undefined;
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && add[k] && typeof add[k] === 'object' && !Array.isArray(add[k]))
      ? sdMerge(b, add[k]) : add[k];
  }
  return out;
}

SD.storageOk = true;
SD.loadSave = function () {
  let data = null;
  try {
    const raw = window.localStorage.getItem(SD.SAVE_KEY);
    if (raw) data = JSON.parse(raw);
  } catch (e) { SD.storageOk = false; }
  return sdMerge(SD.defaultSave(), data || {});
};
SD.writeSave = function (save) {
  try { window.localStorage.setItem(SD.SAVE_KEY, JSON.stringify(save)); SD.storageOk = true; return true; }
  catch (e) { SD.storageOk = false; return false; }
};
