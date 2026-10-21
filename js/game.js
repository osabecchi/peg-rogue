'use strict';
/* 潮珠 SHIODAMA — ゲームの決まり(プレイ・地図・戦闘・報酬・店・できごと・周回の成長)。
   画面には触らない。演出は G.fx に積み、描画側が拾う。SD.headless なら待ち時間なしで進む。 */
SD.G = (function () {
  const D = SD.D, BAL = D.BAL, GX = SD.GX, Phys = SD.Phys;
  const G = { save: null, R: null, B: null, fx: [], toasts: [] };
  const OFFENSIVE = { atk: 1, atkp: 1, explode: 1, drain: 1 };
  const MAX_SLOT = 5;

  G.fxDelay = 0; // 連続攻撃などで演出をずらすとき
  function fx(type, data) { if (!SD.headless) G.fx.push(Object.assign({ type, delay: G.fxDelay }, data || {})); }
  function sfx(S, type, data) { if (!S.sim) fx(type, data); }

  /* ================= セーブと周回の成長 ================= */
  G.init = function () { G.save = SD.loadSave(); return G.save; };
  G.persist = function () { if (G.save) SD.writeSave(G.save); };
  G.unlocked = function (item) { return !item.lock || !!G.save.unlocked.items[item.id]; };
  G.charUnlocked = function (id) { return !!G.save.unlocked.chars[id]; };

  function metaMods() {
    const m = {};
    for (const u of D.UPGRADES) {
      const lv = G.save.upgrades[u.id] || 0;
      if (lv) for (const k in u.mod) m[k] = (m[k] || 0) + u.mod[k] * lv;
    }
    return m;
  }
  G.metaMods = metaMods;

  function diffMods(lv) {
    const m = {};
    for (const d of D.DIFFS) if (d.lv <= lv) for (const k in d.mods) m[k] = (m[k] || 0) + d.mods[k];
    return m;
  }
  G.diffMods = diffMods;

  let modsCache = null, modsKey = '';
  G.mods = function () {
    const R = G.R;
    if (!R) return {};
    const key = R.charId + '|' + R.relics.join(',') + '|' + R.diff;
    if (modsCache && key === modsKey) return modsCache;
    const m = {}, addAll = src => { if (src) for (const k in src) m[k] = (m[k] || 0) + src[k]; };
    addAll(D.char[R.charId].mods);
    addAll(R.meta);
    for (const id of R.relics) addAll(D.relic[id].mods);
    const dm = R.dm;
    for (const k of ['critPegs', 'healPegs', 'maxHp']) if (dm[k]) m[k] = (m[k] || 0) + dm[k];
    modsCache = m; modsKey = key;
    return m;
  };
  G.maxHp = function () { const R = G.R; return Math.max(10, D.char[R.charId].hp + (G.mods().maxHp || 0) + R.maxHpBonus); };

  /* ================= プレイの開始 ================= */
  G.newRun = function (opt) {
    const daily = opt.mode === 'daily';
    const dayKey = SD.todayKey();
    const seed = daily ? SD.hash('daily', dayKey) : (opt.seed != null ? opt.seed : (Math.random() * 4294967296) >>> 0);
    let charId = opt.charId, diff = opt.diff || 0;
    if (daily) {
      const r = new SD.Rng(SD.hash(seed, 'daily-setup'));
      charId = r.pick(D.CHARS).id; diff = 3;
    }
    const ch = D.char[charId];
    const R = {
      v: 1, seed, mode: opt.mode || 'normal', day: daily ? dayKey : null, charId, diff, dm: diffMods(diff), meta: metaMods(),
      area: 0, loop: 0, map: null, pos: { r: -1, i: 0 }, visited: [],
      hp: 0, maxHpBonus: 0, gold: 0, poison: 0, deck: [], relics: [], nextUid: 1,
      rerolls: 0, banishes: 0, banned: [], removes: 0, upgradesBought: 0, reviveUsed: false,
      floors: 0, kills: 0, elites: 0, bosses: 0, time: 0,
      phase: 'map', reward: null, shop: null, event: null, pick: null, result: null,
      st: { src: {}, use: {}, tags: {}, bestShot: 0, bestHits: 0, shots: 0, crits: 0, pegs: 0, taken: 0, healed: 0, goldEarned: 0, bombs: 0, refresh: 0 },
    };
    G.R = R; G.B = null; modsCache = null;
    const m = G.mods();
    R.hp = G.maxHp();
    R.gold = R.dm.noStartGold ? 0 : BAL.startGold + (m.startGold || 0);
    R.rerolls = BAL.rerolls + (m.rerolls || 0);
    R.banishes = BAL.banish + (m.banish || 0);
    for (const id of ch.deck) G.addBall(id, 1, true);
    if (R.dm.startCurse) G.addBall('rust', 1, true);
    R.map = genMap(R);
    const st = G.save.stats;
    st.runs++;
    if (daily) st.dailyPlays++;
    G.save.run = null;
    G.suspendRun();
    checkAch();
    return R;
  };

  G.resumeRun = function () {
    const raw = G.save.run;
    if (!raw) return null;
    try {
      const R = JSON.parse(JSON.stringify(raw));
      G.R = R; G.B = null; modsCache = null;
      R.dm = diffMods(R.diff);
      R.phase = 'map'; R.reward = null; R.shop = null; R.event = null; R.pick = null;
      return R;
    } catch (e) { G.save.run = null; return null; }
  };
  G.suspendRun = function () {
    const R = G.R;
    if (!R || R.phase === 'result') return;
    const copy = Object.assign({}, R);
    delete copy.dm;
    G.save.run = JSON.parse(JSON.stringify(copy));
    G.persist();
  };
  G.abandonRun = function () { if (G.R) endRun(false, true); };

  /* ================= 玉と遺物 ================= */
  G.addBall = function (id, lv, quiet) {
    const R = G.R;
    const inst = { id, lv: lv || 1, uid: R.nextUid++ };
    R.deck.push(inst);
    if (!D.ball[id].curse) G.save.seen.balls[id] = 1;
    if (!quiet) fx('gain', { kind: 'ball', id });
    return inst;
  };
  G.addRelic = function (id) {
    const R = G.R;
    if (R.relics.includes(id)) return;
    R.relics.push(id); modsCache = null;
    const def = D.relic[id];
    if (def.on && def.on.acquire) def.on.acquire(R);
    R.hp = Math.min(R.hp, G.maxHp());
    G.save.seen.relics[id] = 1;
    const st = G.save.stats;
    st.bestRelics = Math.max(st.bestRelics, R.relics.length);
    fx('gain', { kind: 'relic', id });
    checkAch();
  };
  function relicHook(name, a, b, c) {
    const R = G.R;
    for (const id of R.relics) {
      const on = D.relic[id].on;
      if (on && on[name]) on[name](a, b, c);
    }
  }
  function ballX(def, lv) { return def.x ? def.x[Math.min(lv, def.x.length) - 1] : 0; }
  G.ballX = ballX;
  G.ballVal = function (def, lv, key) { const a = def[key]; return a[Math.min(lv, a.length) - 1]; };
  G.ballDesc = function (def, lv) { return def.desc.replace(/\{x\}/g, () => String(ballX(def, lv))); };
  G.evoReady = function () {
    const R = G.R, out = [];
    for (const e of D.EVOS) {
      if (!R.relics.includes(e.relic)) continue;
      const inst = R.deck.find(b => b.id === e.from && b.lv >= 3);
      if (inst) out.push({ evo: e, inst });
    }
    return out;
  };

  /* ================= 地図 ================= */
  function genMap(R) {
    const rng = new SD.Rng(SD.hash(R.seed, 'map', R.loop, R.area));
    const area = D.AREAS[R.area];
    if (R.area === 3) {
      return { boss: 'abyss', rows: [[{ r: 0, i: 0, x: 0.5, type: 'rest', next: [0] }], [{ r: 1, i: 0, x: 0.5, type: 'final', next: [] }]] };
    }
    const ROWS = D.MAP.rows, COLS = D.MAP.cols;
    const grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(null));
    const edges = new Set();
    const starts = rng.shuffle([0, 1, 2, 3]).slice(0, D.MAP.paths);
    for (const s of starts) {
      let c = s;
      for (let r = 0; r < ROWS; r++) {
        grid[r][c] = grid[r][c] || { c };
        if (r < ROWS - 1) {
          let nc = SD.clamp(c + rng.int(-1, 1), 0, COLS - 1);
          // 線が交差しないように、隣の列への斜めの線が逆向きに重なるときはまっすぐにする
          if (nc !== c && edges.has((r) + ':' + nc + '>' + c)) nc = c;
          edges.add(r + ':' + c + '>' + nc);
          c = nc;
        }
      }
    }
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) if (grid[r][c]) row.push({ r, c, x: (c + 0.5) / COLS + rng.range(-0.05, 0.05), next: [] });
      rows.push(row);
    }
    for (const e of edges) {
      const [rs, rest] = e.split(':'); const [a, b] = rest.split('>').map(Number); const r = +rs;
      const from = rows[r].find(n => n.c === a), to = rows[r + 1].findIndex(n => n.c === b);
      if (from && to >= 0 && !from.next.includes(to)) from.next.push(to);
    }
    // 種類を決める
    const w = Object.assign({}, D.MAP.weights);
    w.elite += R.dm.eliteW || 0;
    for (let r = 0; r < ROWS; r++) {
      rows[r].forEach((n, i) => {
        n.r = r; n.i = i;
        if (r === 0) n.type = 'fight';
        else if (r === ROWS - 1) n.type = rng.chance(0.68) ? 'rest' : 'shop';
        else {
          const types = Object.keys(w).filter(t => !(r < 2 && (t === 'elite' || t === 'shop')));
          n.type = rng.weighted(types, t => w[t]);
        }
      });
    }
    // 中ほどの段に宝箱を1つは置く
    const mid = rows[Math.floor(ROWS / 2)];
    if (!mid.some(n => n.type === 'chest')) rng.pick(mid).type = 'chest';
    // 強敵が2段続かないように
    for (let r = 1; r < ROWS; r++) for (const n of rows[r]) {
      if (n.type !== 'elite') continue;
      const prev = rows[r - 1].filter(p => p.next.includes(n.i));
      if (prev.some(p => p.type === 'elite')) n.type = 'fight';
    }
    rows[ROWS - 1].forEach(n => { n.next = [0]; });
    const boss = rng.pick(area.bosses);
    rows.push([{ r: ROWS, i: 0, x: 0.5, type: 'boss', next: [] }]);
    return { boss, rows };
  }
  G.available = function () {
    const R = G.R, rows = R.map.rows;
    if (R.pos.r < 0) return rows[0].map((n, i) => i);
    const cur = rows[R.pos.r][R.pos.i];
    return cur ? cur.next.slice() : [];
  };
  function nodeRng(tag, extra) {
    const R = G.R;
    return new SD.Rng(SD.hash(R.seed, R.loop, R.area, R.pos.r, R.pos.i, tag, extra || 0));
  }
  G.nodeRng = nodeRng;

  G.chooseNode = function (i) {
    const R = G.R;
    if (R.phase !== 'map' || !G.available().includes(i)) return false;
    R.pos = { r: R.pos.r + 1, i };
    const node = R.map.rows[R.pos.r][i];
    R.visited.push(R.area + ':' + node.r + ':' + i);
    R.node = node.type;
    switch (node.type) {
      case 'fight': case 'elite': case 'boss': case 'final': startBattle(node.type); break;
      case 'event': startEvent(); break;
      case 'shop': startShop(); break;
      case 'chest': startChest(); break;
      case 'rest': R.phase = 'rest'; R.restDone = false; break;
    }
    return true;
  };

  G.continueMap = function () {
    const R = G.R;
    R.reward = null; R.shop = null; R.event = null; R.pick = null; G.B = null;
    if (R.hp <= 0) return;
    R.floors++;
    const lastRow = R.map.rows.length - 1;
    if (R.pos.r >= lastRow) {
      // 海域の終わり
      if (R.area === 3) {
        // 深淵の主を倒した(エンドレスはここに来ない)
        return;
      }
      R.area++;
      R.pos = { r: -1, i: 0 };
      R.map = genMap(R);
      fx('area', { area: R.area });
    }
    R.phase = 'map';
    G.suspendRun();
  };

  /* ================= 戦闘 ================= */
  function areaDef() { return D.AREAS[G.R.area]; }

  function scaleHp(def) {
    const R = G.R, dm = R.dm;
    let m = 1 + (dm.enemyHp || 0);
    if (def.elite) m += dm.eliteHp || 0;
    if (def.boss) m += dm.bossHp || 0;
    if (def.final && dm.trueFinal) m += 0.15;
    m *= 1 + D.ENDLESS.hp * R.loop;
    return Math.round(def.hp * m);
  }
  G.atkVal = function (e, v) {
    const R = G.R, dm = R.dm;
    const add = (dm.enemyAtk || 0) + (e.def.final && dm.trueFinal ? 2 : 0) + (e.enraged || 0);
    return Math.max(1, Math.round((v + add) * (1 + D.ENDLESS.atk * R.loop)));
  };

  let eUid = 1;
  function mkEnemy(def, slot) {
    const hp = scaleHp(def);
    return { uid: eUid++, def, hp, maxHp: hp, slot, block: 0, armor: def.armor || 0, poison: 0, freeze: 0, hidden: false, spikes: 0,
      actIdx: 0, phase: 0, intent: null, dead: false, flash: 0, rx: null, enraged: 0 };
  }

  function encounter(kind, rng) {
    const R = G.R, area = areaDef(), enc = D.ENC[Math.min(R.area, 2)];
    const out = [];
    if (kind === 'boss' || kind === 'final') { out.push(D.enemy[R.map.boss]); return out; }
    let budget = enc.base + enc.step * Math.max(0, R.pos.r);
    if (kind === 'elite') { out.push(D.enemy[rng.pick(area.elites)]); budget *= 0.35; }
    let total = 0;
    for (let guard = 0; guard < 20 && total < budget && out.length < enc.maxN; guard++) {
      const left = budget - total;
      const pool = area.enemies.map(id => D.enemy[id]);
      const def = rng.weighted(pool, d => d.hp <= left + 8 ? 3 : 0.4);
      if (out.length > 0 && def.hp > left + 14) break;
      out.push(def); total += def.hp;
    }
    return out;
  }

  function placeEnemies(B, defs, rng) {
    const boss = defs[0] && defs[0].boss;
    if (boss) { B.enemies.push(mkEnemy(defs[0], 4)); return; }
    let slot = rng.int(1, 2);
    for (const def of defs) {
      if (slot <= MAX_SLOT) { B.enemies.push(mkEnemy(def, slot)); slot++; }
      else B.queue.push(def);
    }
  }

  function startBattle(kind) {
    const R = G.R, m = G.mods(), rng = nodeRng('battle');
    const area = areaDef();
    const boardName = rng.pick(area.boards);
    const layout = D.BOARDS[boardName](new SD.Rng(rng.int(1, 1e9)));
    const pegR = BAL.pegR * (1 + (m.pegScale || 0));
    const W = Phys.makeWorld(layout, pegR);
    if (m.bucket) W.bucket = { x: W.w / 2, y: W.h - 12, w: 58, dir: 1, spd: 70 };
    const B = G.B = {
      kind, rng, W, boardName, enemies: [], queue: [], shots: 0, turn: 1, block: m.startShield || 0,
      swaps: BAL.swaps + (m.swaps || 0), draw: [], cur: null, curses: [], phase: 'aim', seq: [], seqT: 0,
      shot: null, hurtLast: false, hurtNow: false, taken: 0, gear: 0, ink: 0, goldPool: 0, killsThisShot: 0,
      result: null, flyT: 0, startHp: R.hp, intro: 1.2,
    };
    // 動かない特別なピン(機雷)
    const bombs = BAL.bombPegs + (m.bombPegs || 0);
    const normals = W.pegs.filter(p => p.type === 'normal');
    rng.shuffle(normals);
    for (let i = 0; i < bombs && i < normals.length; i++) { normals[i].type = 'bomb'; normals[i].hp = BAL.bombHp; normals[i].perm = true; }
    reassignSpecials(B, rng);
    placeEnemies(B, encounter(kind, rng), rng);
    for (const e of B.enemies) G.save.seen.enemies[e.def.id] = 1;
    R.phase = 'battle';
    relicHook('battleStart', B, R);
    B.draw = rng.shuffle(R.deck.slice());
    drawNext(B);
    computeIntents(B);
    if (kind === 'boss' || kind === 'final') fx('bossIntro', { id: B.enemies[0].def.id });
    fx('battleStart', { kind });
    return B;
  }
  G.startBattle = startBattle;

  function specialCounts(B) {
    const m = G.mods();
    return {
      crit: Math.max(0, BAL.critPegs + (m.critPegs || 0) + (B.pendingCrit || 0)),
      refresh: Math.max(0, BAL.refreshPegs + (m.refreshPegs || 0)),
      heal: Math.max(0, BAL.healPegs + (m.healPegs || 0)),
      gold: Math.max(0, BAL.goldPegs + (m.goldPegs || 0)),
    };
  }
  const DYNAMIC = { crit: 1, refresh: 1, heal: 1, gold: 1 };
  function reassignSpecials(B, rng) {
    const W = B.W, n = specialCounts(B);
    for (const p of W.pegs) if (DYNAMIC[p.type]) p.type = 'normal';
    const pool = rng.shuffle(W.pegs.filter(p => p.state === 'alive' && p.type === 'normal'));
    let k = 0;
    for (const t of ['crit', 'refresh', 'heal', 'gold']) for (let i = 0; i < n[t] && k < pool.length; i++) pool[k++].type = t;
  }

  function drawNext(B) {
    const R = G.R;
    if (!B.draw.length) B.draw = B.rng.shuffle(R.deck.concat(B.curses));
    B.cur = B.draw.shift();
  }
  G.swap = function () {
    const B = G.B;
    if (!B || B.phase !== 'aim' || B.swaps <= 0) return false;
    if (!B.draw.length) B.draw = B.rng.shuffle(G.R.deck.concat(B.curses).filter(b => b !== B.cur));
    if (!B.draw.length) return false;
    B.swaps--;
    B.draw.push(B.cur);
    B.cur = B.draw.shift();
    fx('swap');
    return true;
  };
  G.upcoming = function (n) { const B = G.B; return B ? B.draw.slice(0, n) : []; };

  /* ---------- 敵の行動予告 ---------- */
  function curAct(e) {
    if (e.def.boss) { const acts = e.def.phases[e.phase].acts; return acts[e.actIdx % acts.length]; }
    const acts = e.def.acts; return acts[e.actIdx % acts.length];
  }
  function inRange(e) { return e.def.boss || e.slot <= e.def.range; }
  // 1回の移動で射程に入れるか(入れるなら、近づいてそのまま攻撃する)
  function reachSlot(B, e) {
    let s = e.slot;
    for (let i = 0; i < (e.def.spd || 0); i++) {
      const t = s - 1;
      if (t < 0 || living(B).some(o => o !== e && !o.def.boss && o.slot === t)) break;
      s = t;
    }
    return s;
  }
  function computeIntent(e) {
    if (e.dead) return null;
    if (e.freeze > 0) return { t: 'frozen' };
    const a = curAct(e);
    if (a.t === 'leap') return { t: 'leap', n: a.n };
    let lunge = false;
    if (OFFENSIVE[a.t] && !inRange(e)) {
      if (G.B && reachSlot(G.B, e) <= e.def.range) lunge = true;
      else return { t: 'move' };
    }
    const it = Object.assign({}, a);
    if (lunge) it.lunge = true;
    if (a.v != null && (OFFENSIVE[a.t])) it.dmg = G.atkVal(e, a.v);
    if (!inRange(e) && !e.def.boss && e.def.spd > 0) it.alsoMove = true;
    return it;
  }
  function computeIntents(B) { for (const e of B.enemies) e.intent = computeIntent(e); }
  G.computeIntents = computeIntents;

  /* ---------- 狙い ---------- */
  function living(B) { return B.enemies.filter(e => !e.dead && e.hp > 0); }
  function targetable(B) {
    const l = living(B);
    const v = l.filter(e => !e.hidden);
    return v.length ? v : l;
  }
  function front(B) { const t = targetable(B); let best = null; for (const e of t) if (!best || e.slot < best.slot || (e.slot === best.slot && e.def.boss)) best = e; return best; }
  function back(B) { const t = targetable(B); let best = null; for (const e of t) if (!best || e.slot > best.slot) best = e; return best; }
  G.front = front;

  /* ---------- 1ショット ---------- */
  function makeShot(B, inst, sim) {
    const def = D.ball[inst.id];
    const lv = Math.min(inst.lv, def.dmg.length);
    const S = {
      sim, B: sim ? Object.assign({}, B) : B, R: G.R, W: null, rng: sim ? B.rng.clone() : B.rng, mods: G.mods(),
      inst, ball: def, lv, x: ballX(def, lv),
      hits: 0, hv: 0, crit: false, critPegs: 0, walls: 0, bombs: 0, bombDmg: 0, heal: 0, gold: 0, shield: 0, refresh: false,
      poison: 0, poisonAll: 0, freeze: 0, lifesteal: 0, target: 'front', chain: 0, chainFrac: 0, bucket: false, selfDmg: 0,
      moon: 0, bombOneHit: false, ballsMade: 0, n: {}, adds: {}, muls: [], extras: [], tags: {}, refreshes: 0, blasts: 0,
      targetEnemy: null, flyT: 0,
    };
    S.add = (id, v) => { S.adds[id] = (S.adds[id] || 0) + v; };
    S.mul = (id, m) => { S.muls.push({ id, m }); };
    S.extraAll = (id, v) => { S.extras.push({ id, v }); };
    S.tag = id => { S.tags[id] = (S.tags[id] || 0) + 1; };
    return S;
  }

  function ballHook(S, name, a, b) {
    const on = S.ball.on;
    if (!on || !on[name]) return;
    if (name === 'launch') on.launch(S, a, S.x);
    else if (name === 'hit') on.hit(S, a, b, S.x);
    else if (name === 'wall') on.wall(S, a, S.x);
    else if (name === 'end') on.end(S, S.x);
  }

  function hooksFor(S) {
    const m = S.mods;
    return {
      hit(b, p) { pegHit(S, b, p); },
      wall(b) {
        S.walls++;
        if (m.wallDmg) S.add('springshell', m.wallDmg);
        if (m.wallHit) { S.hits++; S.hv += b.val; S.tag('sidewall'); }
        ballHook(S, 'wall', b);
        sfx(S, 'wall', { x: b.x, y: b.y });
      },
      bump(b, p) { sfx(S, 'bump', { x: p.x, y: p.y }); },
      bottom(b) { S.tag('springboard'); sfx(S, 'bounceUp', { x: b.x }); },
      wrap(b) { sfx(S, 'wrap', { x: b.x, y: b.y }); },
      bucket(b) { if (!S.bucket) { S.bucket = true; sfx(S, 'bucket', { x: b.x }); } },
      exit(b) {
        if (b.echo > 0) {
          b.echo--; b.x = SD.clamp(b.x, 40, S.W.w - 40); b.y = -b.r; b.vy = 60; b.vx *= 0.5; b.life = 0;
          sfx(S, 'echo', { x: b.x }); return true;
        }
        return false;
      },
    };
  }

  function pegHit(S, b, p) {
    p.flash = 1;
    const m = S.mods;
    if (p.type === 'rock') {
      if (m.rockHit && !p.counted) { p.counted = true; S.hits++; S.hv += 1; S.tag('scraper'); }
      sfx(S, 'rock', { x: p.x, y: p.y });
      return;
    }
    if (p.type === 'barn') {
      p.hp--;
      if (m.rockHit && !p.counted) { p.counted = true; S.hits++; S.hv += 1; S.tag('scraper'); }
      if (p.hp > 0) { sfx(S, 'crack', { x: p.x, y: p.y }); return; }
      p.type = 'normal';
    }
    if (p.state !== 'alive') return;
    if (p.type === 'bomb') {
      p.hp--;
      if (p.hp <= 0 || S.bombOneHit || m.bombOneHit) explode(S, p);
      else sfx(S, 'arm', { x: p.x, y: p.y });
      return;
    }
    light(S, b, p, false);
  }

  function light(S, b, p, indirect) {
    if (p.state !== 'alive') return;
    p.state = 'lit'; p.flash = 1; p.byLight = indirect;
    S.hits++; S.hv += b ? b.val : 1;
    switch (p.type) {
      case 'crit': S.crit = true; S.critPegs++; break;
      case 'heal': S.heal += BAL.healPeg; break;
      case 'gold': S.gold += BAL.goldPeg; break;
      case 'refresh':
        S.refresh = true;
        if (S.moon > 0) { S.moon--; S.tag('moon'); refreshAll(S, true); }
        break;
    }
    sfx(S, 'peg', { x: p.x, y: p.y, kind: p.type, n: S.hits });
    if (b) ballHook(S, 'hit', p, b);
    else if (S.ball.on && S.ball.on.hit) ballHook(S, 'hit', p, { val: 1, child: true, x: p.x, y: p.y, vx: 0, vy: 0, r: 7, g: 1, e: 1, didSplit: true });
    relicHook('hit', S, p, b);
  }

  function explode(S, p) {
    p.state = 'gone';
    S.bombs++; S.hits++; S.hv += 1;
    S.bombDmg += BAL.bombDmg * (1 + (S.mods.bombMult || 0));
    const rad = BAL.bombRadius * (1 + (S.mods.bombRadius || 0));
    sfx(S, 'bomb', { x: p.x, y: p.y, r: rad });
    for (const q of S.W.pegs) {
      if (q.state === 'gone' || q === p) continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) > rad + q.r) continue;
      if (q.type === 'bomb') { if (q.state === 'alive') explode(S, q); }
      else if (q.type === 'rock' || q.type === 'barn') { q.state = 'gone'; }
      else if (q.type !== 'bumper') light(S, null, q, true);
    }
  }

  function refreshAll(S, mid) {
    const W = S.W;
    for (const p of W.pegs) {
      if (p.type === 'rock' || p.type === 'bumper') continue;
      if (p.state !== 'alive') { p.state = 'alive'; p.byLight = false; }
      if (p.type === 'bomb') p.hp = BAL.bombHp;
    }
    // 消えた機雷を戻すとき、一時的な機雷は普通のピンに戻す
    for (const p of W.pegs) if (p.type === 'bomb' && !p.perm) p.type = 'normal';
    reassignSpecials(S.B, S.rng);
    S.refreshes++;
    relicHook('refresh', S);
    sfx(S, 'refresh', { mid: !!mid });
  }

  /* ---------- 効果から呼ぶ操作 ---------- */
  GX.spawn = function (S, parent, rot, extra) {
    extra = extra || {};
    if (S.W.balls.length >= 24) return null;
    let vx, vy, x = parent.x;
    if (extra.mirror) { vx = -parent.vx; vy = parent.vy; x = S.W.w - parent.x; }
    else {
      const c = Math.cos(rot), s = Math.sin(rot);
      vx = (parent.vx * c - parent.vy * s) * 0.96; vy = (parent.vx * s + parent.vy * c) * 0.96;
    }
    const b = Phys.addBall(S.W, {
      x, y: parent.y, vx, vy, r: parent.r, g: parent.g, e: parent.e, crush: parent.crush, magnet: parent.magnet,
      val: extra.val != null ? extra.val : parent.val, child: !!extra.child, wrap: parent.wrap, pierce: parent.pierce || 0,
      pierceT: parent.pierceT || 0, didSplit: !!extra.child, lastPeg: parent.lastPeg, lastPegT: parent.lastPegT,
    });
    S.ballsMade++;
    sfx(S, 'split', { x: b.x, y: b.y });
    return b;
  };
  function alivePegs(S, ok) { return S.W.pegs.filter(p => p.state === 'alive' && ok(p)); }
  GX.addPegs = function (S, type, n) {
    const pool = S.rng.shuffle(alivePegs(S, p => p.type === 'normal'));
    for (let i = 0; i < n && i < pool.length; i++) { pool[i].type = type; if (type === 'bomb') pool[i].hp = BAL.bombHp; pool[i].flash = 1; }
  };
  function nearest(S, x, y, rad, ok) {
    let best = null, bd = rad;
    for (const p of S.W.pegs) {
      if (p.state !== 'alive' || !ok(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > 0.5 && d < bd) { bd = d; best = p; }
    }
    return best;
  }
  GX.convertNear = function (S, x, y, type) {
    const p = nearest(S, x, y, 90, q => q.type === 'normal');
    if (!p) return false;
    p.type = type; if (type === 'bomb') p.hp = BAL.bombHp; p.flash = 1;
    return true;
  };
  GX.lightNearest = function (S, x, y, rad) {
    const p = nearest(S, x, y, rad, q => q.type !== 'rock' && q.type !== 'bumper' && q.type !== 'bomb' && q.type !== 'barn');
    if (!p) return false;
    sfx(S, 'spike', { x0: x, y0: y, x: p.x, y: p.y });
    light(S, null, p, true);
    return true;
  };
  GX.blast = function (S, x, y, rad) {
    if (S.blasts >= 8) return;
    S.blasts++;
    sfx(S, 'blast', { x, y, r: rad });
    for (const q of S.W.pegs) {
      if (q.state !== 'alive' || Math.hypot(q.x - x, q.y - y) > rad) continue;
      if (q.type === 'bomb') { q.hp--; if (q.hp <= 0) explode(S, q); }
      else if (q.type !== 'rock' && q.type !== 'bumper' && q.type !== 'barn') light(S, null, q, true);
    }
  };
  GX.refreshAll = function (S) { refreshAll(S, true); };
  GX.front = front;

  /* ---------- 発射 ---------- */
  G.launchVel = function (inst, angle) {
    const def = D.ball[inst.id], p = def.p || {}, m = G.mods();
    const spd = BAL.launchSpd * (1 + (m.launchSpd || 0)) * (p.spd || 1);
    return { vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd };
  };
  G.ballProps = function (inst, angle) {
    const def = D.ball[inst.id], p = def.p || {}, m = G.mods();
    const v = G.launchVel(inst, angle);
    return { x: BAL.launchX, y: BAL.launchY, vx: v.vx, vy: v.vy, r: p.r || BAL.ballR, g: (p.g || 1) * (1 + (m.gravity || 0)),
      e: p.e || 1, crush: !!p.crush, magnet: m.magnet || 0, bottom: m.bottomBounce || 0 };
  };
  G.clampAngle = a => SD.clamp(a, 0.1, Math.PI - 0.1);

  function launch(B, S, angle) {
    const props = G.ballProps(S.inst, angle);
    const b = Phys.addBall(S.W, props);
    S.ballsMade = 1;
    relicHook('shotStart', S);
    ballHook(S, 'launch', b);
    relicHook('launch', S, b);
    return b;
  }

  G.fire = function (angle) {
    const B = G.B, R = G.R;
    if (!B || B.phase !== 'aim') return false;
    angle = G.clampAngle(angle);
    B.shots++;
    const S = makeShot(B, B.cur, false);
    S.W = B.W;
    S.H = hooksFor(S);
    B.shot = S;
    launch(B, S, angle);
    B.phase = 'fly'; B.flyT = 0;
    R.st.shots++; G.save.stats.shots++;
    const u = R.st.use[S.ball.id] || (R.st.use[S.ball.id] = { shots: 0, hits: 0, dmg: 0 });
    u.shots++;
    fx('launch', { angle, id: S.ball.id });
    return true;
  };

  // 物理を進める(戦闘中の毎フレーム)
  G.updateFlight = function (dt) {
    const B = G.B;
    if (!B || B.phase !== 'fly') return;
    const S = B.shot;
    Phys.step(B.W, dt, S.H);
    B.flyT += dt; S.flyT += dt;
    if (!B.W.balls.length || B.flyT > 40) { B.W.balls.length = 0; endShot(B, S); }
  };
  G.finishFlight = function () {
    const B = G.B;
    let guard = 0;
    while (B && B.phase === 'fly' && guard++ < 20000) G.updateFlight(1 / 60);
  };

  // ボット用: 盤面を写して、その角度で撃ったら何が起きるかを確かめる
  G.simulate = function (angle) {
    const B = G.B;
    const S = makeShot(B, B.cur, true);
    S.W = Phys.cloneWorld(B.W);
    S.B.W = S.W;
    S.H = hooksFor(S);
    S.B.shots = B.shots + 1;
    launch(S.B, S, G.clampAngle(angle));
    let t = 0;
    while (S.W.balls.length && t < 40) { Phys.step(S.W, 1 / 30, S.H); t += 1 / 30; }
    S.flyT = t;
    const plan = planDamage(B, S);
    return { S, plan, t };
  };

  /* ---------- ダメージの計算 ---------- */
  function perHit(S) {
    const m = S.mods, def = S.ball, ch = D.char[G.R.charId];
    let v = S.crit ? G.ballVal(def, S.lv, 'crit') : G.ballVal(def, S.lv, 'dmg');
    if (!def.curse) {
      v += m.dmg || 0;
      if (S.crit) v += m.critDmg || 0;
      if (ch.heavyDmg && def.tags.includes('heavy')) v += ch.heavyDmg;
    }
    return v;
  }

  function planDamage(B, S) {
    // 狙いを決める
    ballHook(S, 'end');
    S.targetEnemy = S.target === 'back' ? back(B) : front(B);
    relicHook('shotEnd', S);
    if (S.bucket) S.mul('oldnet', 1.5);
    const per = perHit(S);
    const baseHits = S.hv * per;
    let addTot = 0; for (const k in S.adds) addTot += S.adds[k];
    const base = baseHits + addTot;
    let mult = 1; for (const x of S.muls) mult *= x.m;
    const total = Math.round(base * mult);
    const tg = targetable(B);
    const hits = [];
    if (S.target === 'all') for (const e of tg) hits.push({ e, v: total, main: true });
    else if (S.targetEnemy) {
      hits.push({ e: S.targetEnemy, v: total, main: true });
      const others = tg.filter(e => e !== S.targetEnemy);
      const n = Math.min(S.chain, others.length);
      const picked = [];
      if (n > 0) {
        const pool = others.slice().sort((a, b) => a.slot - b.slot);
        for (let i = 0; i < n; i++) picked.push(pool[i]);
        for (const e of picked) hits.push({ e, v: Math.round(total * S.chainFrac), main: false });
      }
      if (S.crit && S.mods.critSplash) for (const e of others) if (!picked.includes(e)) hits.push({ e, v: Math.round(total * S.mods.critSplash), main: false, splash: true });
    }
    let est = 0, kills = 0;
    const hpLeft = new Map();
    for (const e of living(B)) hpLeft.set(e, e.hp + e.block);
    const hitDmg = h => Math.max(0, h.v - (h.e.armor || 0));
    let over = 0;
    for (const h of hits) { const v = hitDmg(h); est += Math.min(v, hpLeft.get(h.e)); if (h.main && S.target !== 'all') over += Math.max(0, v - hpLeft.get(h.e)); hpLeft.set(h.e, hpLeft.get(h.e) - v); }
    if (over > 0) {
      over *= 1 + (S.mods.overflow || 0);
      const rest = living(B).filter(e => hpLeft.get(e) > 0).sort((a, b) => a.slot - b.slot);
      for (const e of rest) { if (over <= 0) break; const v = Math.max(0, over - (e.armor || 0)); const d = Math.min(v, hpLeft.get(e)); est += d; hpLeft.set(e, hpLeft.get(e) - d); over = v - d; }
    }
    const bomb = Math.round(S.bombDmg);
    let extraAll = 0; for (const x of S.extras) extraAll += x.v;
    for (const e of living(B)) {
      const left = hpLeft.get(e), v = bomb + extraAll;
      est += Math.min(Math.max(0, left), v); hpLeft.set(e, left - v);
      if (hpLeft.get(e) <= 0) kills++;
    }
    return { per, base, baseHits, addTot, mult, total, hits, bomb, extraAll, est, kills };
  }
  G.planDamage = planDamage;

  /* ---------- ショットの結果を反映する ---------- */
  function queue(B, d, fn) { B.seq.push({ d: SD.headless ? 0 : d, fn }); }
  G.queue = queue;

  function srcAdd(key, v) { const R = G.R; if (v > 0) R.st.src[key] = (R.st.src[key] || 0) + v; }

  function attributeShot(S, plan, dealt) {
    // 与えたダメージを、玉と遺物で分け合う(おおよその内訳)
    if (dealt <= 0) return;
    const shares = {};
    let tot = 0;
    for (const x of S.muls) { if (x.m > 1) { const s = 1 - 1 / x.m; shares[x.id] = (shares[x.id] || 0) + s; tot += s; } }
    const k = tot > 0.85 ? 0.85 / tot : 1;
    let left = dealt;
    for (const id in shares) { const v = dealt * shares[id] * k; left -= v; srcAdd(id === 'ball' ? 'ball:' + S.ball.id : 'relic:' + id, v); }
    if (plan.base > 0) {
      for (const id in S.adds) { const v = left * (S.adds[id] / plan.base); srcAdd(id === 'ball' ? 'ball:' + S.ball.id : 'relic:' + id, v); }
      srcAdd('ball:' + S.ball.id, left * (plan.baseHits / plan.base));
    }
  }

  function endShot(B, S) {
    const R = G.R, m = S.mods;
    B.phase = 'resolve';
    const plan = planDamage(B, S);
    S.plan = plan;
    R.st.pegs += S.hits; G.save.stats.pegs += S.hits;
    const u = R.st.use[S.ball.id]; if (u) u.hits += S.hits;
    if (S.crit) { R.st.crits++; G.save.stats.crits++; }
    R.st.bombs += S.bombs; G.save.stats.bombs += S.bombs;
    for (const t in S.tags) R.st.tags[t] = (R.st.tags[t] || 0) + S.tags[t];
    for (const x of S.muls) if (x.m > 1) R.st.tags[x.id] = (R.st.tags[x.id] || 0) + 1;
    for (const id in S.adds) R.st.tags[id] = (R.st.tags[id] || 0) + 1;
    B.ink = Math.max(0, B.ink - 1);
    B.killsThisShot = 0;
    fx('shotEnd', { hits: S.hits, crit: S.crit, total: plan.total, per: plan.per, mult: plan.mult, bombs: S.bombs });

    // 1. 攻撃
    queue(B, 0.25, () => {
      let dealtMain = 0, overflow = 0, overDealt = 0;
      for (const h of plan.hits) {
        if (h.e.dead) continue;
        const r = dealDamage(B, h.e, h.v, 'shot', { main: h.main, crit: S.crit });
        dealtMain += r.dealt;
        if (h.main && S.target !== 'all') overflow += r.over;
      }
      // 倒して余ったダメージは次の敵へ(何体でも続く)
      for (let k = 0; k < 6 && overflow > 0; k++) {
        const nx = front(B);
        if (!nx) break;
        const v = Math.round(overflow * (1 + (m.overflow || 0)));
        if (m.overflow) { srcAdd('relic:overflow', v - overflow); R.st.tags.overflow = (R.st.tags.overflow || 0) + 1; }
        const r = dealDamage(B, nx, v, 'shot', { overflow: true });
        overDealt += r.dealt; overflow = r.over;
        srcAdd('ball:' + S.ball.id, r.dealt);
      }
      attributeShot(S, plan, dealtMain);
      const shotTotal = dealtMain + overDealt;
      // 毒・凍結
      const tgt = S.target === 'all' ? living(B) : [plan.hits.length ? plan.hits[0].e : null].filter(Boolean);
      if (S.poison > 0) {
        const pv = S.poison + (m.poisonAdd || 0);
        for (const e of tgt) if (!e.dead) { e.poison += pv; fx('status', { uid: e.uid, kind: 'poison', v: pv }); }
      }
      if (S.poisonAll > 0) for (const e of living(B)) { e.poison += S.poisonAll + (m.poisonAdd || 0); fx('status', { uid: e.uid, kind: 'poison', v: S.poisonAll }); }
      if (S.freeze) for (const e of tgt) if (!e.dead) { e.freeze = Math.max(e.freeze, S.freeze); e.intent = computeIntent(e); fx('status', { uid: e.uid, kind: 'freeze' }); }
      if (S.lifesteal > 0 && shotTotal > 0) healPlayer(Math.round(shotTotal * S.lifesteal), 'ball:' + S.ball.id);
      B.lastShotDmg = shotTotal;
      S.dealt = shotTotal;
    });
    // 2. 機雷と全体ダメージ
    if (plan.bomb > 0) queue(B, 0.22, () => {
      fx('bombWave', { v: plan.bomb });
      for (const e of living(B)) { const r = dealDamage(B, e, plan.bomb, 'bomb', { noArmor: true }); srcAdd('bomb', r.dealt); S.dealt += r.dealt; }
    });
    for (const x of S.extras) queue(B, 0.18, () => {
      fx('relicFire', { id: x.id });
      for (const e of living(B)) { const r = dealDamage(B, e, x.v, 'relic', { noArmor: true }); srcAdd('relic:' + x.id, r.dealt); S.dealt += r.dealt; }
    });
    // 3. 回復・盾・貝貨・呪い
    queue(B, 0.05, () => {
      if (S.heal > 0) healPlayer(S.heal, S.ball.tags.includes('heal') ? 'ball:' + S.ball.id : 'peg');
      if (S.shield > 0) { B.block += S.shield; fx('shield', { v: S.shield }); }
      if (S.gold > 0) addGold(S.gold);
      if (S.selfDmg > 0) hurtPlayer(B, S.selfDmg, null, true);
      const st = G.save.stats;
      const dealt = Math.round(S.dealt || 0);
      R.st.bestShot = Math.max(R.st.bestShot, dealt); st.bestShot = Math.max(st.bestShot, dealt);
      R.st.bestHits = Math.max(R.st.bestHits, S.hits); st.bestHits = Math.max(st.bestHits, S.hits);
      st.damage += dealt;
      if (B.killsThisShot >= 3) st.multiKill = Math.max(st.multiKill, B.killsThisShot);
      if (S.hits >= 25 || dealt >= 150) fx('bigShot', { hits: S.hits, dmg: dealt });
      checkAch();
    });
    // 4. 盤面の片づけ
    queue(B, 0.1, () => cleanupBoard(B, S));
    // 5. 勝敗か敵の番
    queue(B, 0.15, () => afterPlayer(B));
  }

  function cleanupBoard(B, S) {
    const W = B.W;
    for (const p of W.pegs) if (p.state === 'lit') p.state = 'gone';
    const alive = W.pegs.filter(p => p.state === 'alive' && p.type !== 'rock' && p.type !== 'bumper').length;
    const total = W.pegs.filter(p => p.type !== 'rock' && p.type !== 'bumper').length;
    const S2 = { W, B, rng: B.rng, mods: G.mods(), sim: false, gold: 0, refreshes: 0,
      extraAll: (id, v) => { for (const e of living(B)) { const r = dealDamage(B, e, v, 'relic', { noArmor: true }); srcAdd('relic:' + id, r.dealt); } },
      tag: id => { G.R.st.tags[id] = (G.R.st.tags[id] || 0) + 1; }, add() {}, mul() {} };
    if (S.refresh || alive < total * BAL.autoRefreshLeft) {
      refreshAll(S2, false);
      G.R.st.refresh++; G.save.stats.refresh++;
      if (S2.gold) addGold(S2.gold);
    } else reassignSpecials(B, B.rng);
    B.pendingCrit = 0;
    processDeaths(B);
  }

  function dealDamage(B, e, amt, src, o) {
    o = o || {};
    if (e.dead || amt <= 0) return { dealt: 0, over: 0 };
    if (e.hp <= 0) return { dealt: 0, over: Math.round(amt) };
    let a = Math.round(amt);
    if (!o.noArmor && e.armor) a = Math.max(0, a - e.armor);
    let blocked = 0;
    if (e.block > 0) { blocked = Math.min(e.block, a); e.block -= blocked; a -= blocked; }
    const before = e.hp;
    e.hp -= a;
    const dealt = Math.min(a, before);
    const over = Math.max(0, a - before);
    e.flash = 1;
    G.R.st.dmgTotal = (G.R.st.dmgTotal || 0) + dealt;
    fx('dmg', { uid: e.uid, v: a, blocked, src, crit: !!o.crit, main: !!o.main });
    if (src === 'shot' && e.spikes > 0 && a > 0 && o.main) { G.fxDelay = 0.15; hurtPlayer(B, e.spikes, null, false, 'spikes'); G.fxDelay = 0; }
    if (e.def.boss && e.hp > 0) checkPhase(B, e);
    if (e.hp <= 0) { e.killedBy = src; if (src === 'shot' || src === 'bomb' || src === 'relic') B.killsThisShot++; }
    return { dealt, over };
  }

  function checkPhase(B, e) {
    const ph = e.def.phases;
    while (e.phase + 1 < ph.length && e.hp / e.maxHp <= ph[e.phase + 1].at) {
      e.phase++; e.actIdx = 0;
      const p = ph[e.phase];
      fx('phase', { uid: e.uid, msg: p.msg });
      if (p.moving) {
        for (const q of B.W.pegs) {
          if (q.mv || q.type === 'bumper' || !B.rng.chance(0.45)) continue;
          q.mv = { ax: B.rng.range(14, 26), w: B.rng.range(0.6, 1.1) * (B.rng.chance(0.5) ? 1 : -1), ph: B.rng.range(0, 6.28) };
          q.x0 = q.x - q.mv.ax * Math.sin(q.mv.w * B.W.t + q.mv.ph);
        }
      }
      e.intent = computeIntent(e);
    }
  }

  function processDeaths(B) {
    const R = G.R, m = G.mods();
    for (const e of B.enemies.slice()) {
      if (e.dead || e.hp > 0) continue;
      e.dead = true; e.hp = 0;
      fx('death', { uid: e.uid, boss: !!e.def.boss });
      if (e.killedBy === 'self') continue; // 自爆は倒したことにしない
      R.kills++; G.save.stats.kills++;
      B.goldPool += e.def.gold || 0;
      if (e.killedBy === 'poison') G.save.stats.poisonKills++;
      if (e.def.elite) { R.elites++; G.save.stats.elitesKilled++; }
      relicHook('kill', B, e, R);
      if (m.killGold) { addGold(m.killGold); R.st.tags.remora = (R.st.tags.remora || 0) + 1; }
      if (m.killHeal) healPlayer(m.killHeal, 'relic:starfish');
      if (e.def.onDeath && !e.noSplit) summon(B, e.def.onDeath.id, e.def.onDeath.n, e.slot);
      if (e.def.boss) for (const o of living(B)) { o.hp = 0; o.dead = true; o.noSplit = true; fx('death', { uid: o.uid }); }
    }
  }

  function summon(B, id, n, near) {
    const def = D.enemy[id];
    for (let k = 0; k < n; k++) {
      if (living(B).length >= 7) return;
      const taken = new Set(living(B).filter(e => !e.def.boss).map(e => e.slot));
      let best = -1;
      const order = [near, near - 1, near + 1, near - 2, near + 2, 1, 2, 3, 0, 4, 5];
      for (const s of order) if (s >= 0 && s <= MAX_SLOT && !taken.has(s) && !(living(B).some(e => e.def.boss) && s >= 4)) { best = s; break; }
      if (best < 0) return;
      const e = mkEnemy(def, best);
      e.intent = computeIntent(e);
      e.spawnT = 1;
      B.enemies.push(e);
      G.save.seen.enemies[id] = 1;
      fx('summon', { uid: e.uid });
    }
  }

  function addGold(v) { const R = G.R; v = Math.round(v); if (v <= 0) return; R.gold += v; R.st.goldEarned += v; G.save.stats.gold += v; G.save.stats.bestGold = Math.max(G.save.stats.bestGold, R.gold); fx('gold', { v }); }
  G.addGold = addGold;
  function healPlayer(v, src) {
    const R = G.R, m = G.mods();
    v = Math.round(v * (1 + (m.healMult || 0)));
    const room = G.maxHp() - R.hp;
    const h = Math.max(0, Math.min(room, v));
    if (h <= 0) return 0;
    R.hp += h; R.st.healed += h;
    fx('heal', { v: h, src });
    return h;
  }
  G.healPlayer = healPlayer;

  function hurtPlayer(B, amt, e, pierce, kind) {
    const R = G.R, m = G.mods();
    if (amt <= 0 || R.hp <= 0) return 0;
    if (!pierce && e && m.dodge && B.rng.chance(m.dodge)) { fx('miss', {}); R.st.tags.inksac = (R.st.tags.inksac || 0) + 1; return 0; }
    let a = amt;
    if (!pierce) a = Math.max(1, a - (m.armor || 0));
    let blocked = 0;
    if (!pierce && B.block > 0) { blocked = Math.min(B.block, a); B.block -= blocked; a -= blocked; }
    R.hp -= a;
    if (a > 0) { B.taken += a; R.st.taken += a; B.hurtNow = true; }
    fx('hurt', { v: a, blocked, kind: kind || (e ? 'atk' : 'self') });
    if (e && m.thorns && !e.dead) {
      const r = dealDamage(B, e, m.thorns, 'thorns', { noArmor: true });
      srcAdd('relic:urchinarmor', r.dealt);
    }
    if (R.hp <= 0) {
      if (m.revive && !R.reviveUsed) {
        R.reviveUsed = true; R.hp = Math.round(G.maxHp() * 0.3);
        R.st.tags.lifering = 1;
        fx('revive', {});
      } else {
        R.hp = 0;
      }
    }
    return a;
  }

  function afterPlayer(B) {
    const R = G.R;
    processDeaths(B);
    if (R.hp <= 0) { loseBattle(B); return; }
    if (!living(B).length && !B.queue.length) { winBattle(B); return; }
    // 敵の番
    B.phase = 'enemy';
    B.hurtNow = false;
    const list = living(B).slice().sort((a, b) => a.slot - b.slot);
    // 毒
    let anyPoison = false;
    for (const e of list) if (e.poison > 0) anyPoison = true;
    if (anyPoison) queue(B, 0.2, () => {
      const nodecay = G.mods().poisonNoDecay;
      for (const e of living(B)) {
        if (e.poison <= 0) continue;
        const r = dealDamage(B, e, e.poison, 'poison', { noArmor: true });
        srcAdd('poison', r.dealt);
        if (!nodecay) e.poison = Math.max(0, e.poison - BAL.poisonDecay);
      }
      processDeaths(B);
    });
    for (const e of list) queue(B, 0.32, () => { if (!e.dead && R.hp > 0) enemyAct(B, e); processDeaths(B); });
    queue(B, 0.15, () => {
      // 後ろから来る敵
      const taken = new Set(living(B).map(e => e.slot));
      while (B.queue.length && !taken.has(MAX_SLOT)) { const e = mkEnemy(B.queue.shift(), MAX_SLOT); B.enemies.push(e); taken.add(MAX_SLOT); fx('summon', { uid: e.uid }); G.save.seen.enemies[e.def.id] = 1; }
      if (R.hp <= 0) { loseBattle(B); return; }
      if (!living(B).length && !B.queue.length) { winBattle(B); return; }
      startPlayerTurn(B);
    });
  }

  function startPlayerTurn(B) {
    const R = G.R;
    B.turn++;
    B.hurtLast = B.hurtNow;
    B.enemies = B.enemies.filter(e => !e.dead);
    if (R.poison > 0) {
      hurtPlayer(B, R.poison, null, true, 'poison');
      R.poison = Math.max(0, R.poison - 1);
      if (R.hp <= 0) { loseBattle(B); return; }
    }
    relicHook('turnStart', B, R);
    drawNext(B);
    computeIntents(B);
    B.phase = 'aim';
    B.shot = null;
    fx('turn', {});
  }

  function moveEnemy(B, e, steps) {
    for (let i = 0; i < steps; i++) {
      const t = e.slot - 1;
      if (t < 0) break;
      if (living(B).some(o => o !== e && !o.def.boss && o.slot === t)) break;
      e.slot = t;
    }
    fx('move', { uid: e.uid });
  }

  function enemyAct(B, e) {
    const R = G.R;
    if (e.freeze > 0) { e.freeze--; fx('frozenSkip', { uid: e.uid }); return; }
    e.hidden = false; e.spikes = 0;
    const a = curAct(e);
    const boss = !!e.def.boss;
    if (!boss && a.t === 'leap') { moveEnemy(B, e, (e.def.spd || 1) + a.n); e.actIdx++; fx('leap', { uid: e.uid }); return; }
    if (!boss && OFFENSIVE[a.t] && !inRange(e)) {
      moveEnemy(B, e, e.def.spd);
      if (!inRange(e)) return;
      G.fxDelay = 0.18; // 近づいてそのまま攻撃
    }
    const alsoMove = !boss && !inRange(e) && e.def.spd > 0;
    e.actIdx++;
    fx('act', { uid: e.uid, t: a.t });
    switch (a.t) {
      case 'atk': {
        const n = a.n || 1, v = G.atkVal(e, a.v);
        for (let i = 0; i < n && R.hp > 0; i++) { G.fxDelay = i * 0.16; hurtPlayer(B, v, e); }
        G.fxDelay = 0;
        break;
      }
      case 'atkp': {
        hurtPlayer(B, G.atkVal(e, a.v), e);
        addPlayerPoison(a.p);
        break;
      }
      case 'explode': { hurtPlayer(B, G.atkVal(e, a.v), null); e.hp = 0; e.killedBy = 'self'; e.noGold = true; fx('explodeSelf', { uid: e.uid }); break; }
      case 'drain': { const d = hurtPlayer(B, G.atkVal(e, a.v), e); if (d > 0) { e.hp = Math.min(e.maxHp, e.hp + d); fx('enemyHeal', { uid: e.uid, v: d }); } break; }
      case 'block': e.block += Math.round(a.v * (1 + D.ENDLESS.hp * R.loop * 0.5)); fx('enemyBlock', { uid: e.uid }); break;
      case 'heal': {
        let best = null;
        for (const o of living(B)) if (o.hp < o.maxHp && (!best || o.hp / o.maxHp < best.hp / best.maxHp)) best = o;
        if (best) { const v = Math.min(best.maxHp - best.hp, a.v); best.hp += v; fx('enemyHeal', { uid: best.uid, v }); }
        break;
      }
      case 'summon': summon(B, a.id, a.n, e.def.boss ? 2 : e.slot); break;
      case 'rocks': addRocks(B, a.n); break;
      case 'barn': {
        const pool = B.rng.shuffle(B.W.pegs.filter(p => p.state === 'alive' && p.type === 'normal'));
        for (let i = 0; i < a.n && i < pool.length; i++) { pool[i].type = 'barn'; pool[i].hp = 2; pool[i].flash = 1; }
        fx('barn', { uid: e.uid });
        break;
      }
      case 'curse': for (let i = 0; i < a.n; i++) { const c = { id: a.id, lv: 1, uid: R.nextUid++, temp: true }; B.curses.push(c); B.draw.splice(B.rng.int(0, B.draw.length), 0, c); } fx('curse', { uid: e.uid, id: a.id, n: a.n }); break;
      case 'poison': addPlayerPoison(a.v); fx('spit', { uid: e.uid }); break;
      case 'ink': B.ink = 2; fx('ink', { uid: e.uid }); break;
      case 'hide': e.hidden = true; fx('hide', { uid: e.uid }); break;
      case 'spikes': e.spikes = a.v; fx('spikes', { uid: e.uid }); break;
    }
    G.fxDelay = 0;
    if (alsoMove) moveEnemy(B, e, e.def.spd);
  }

  function addPlayerPoison(v) {
    const R = G.R, m = G.mods();
    const p = Math.max(1, Math.ceil(v * (1 - (m.poisonResist || 0))));
    R.poison += p;
    fx('playerPoison', { v: p });
  }

  function addRocks(B, n) {
    const W = B.W;
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 40; tries++) {
        const x = B.rng.range(30, W.w - 30), y = B.rng.range(110, W.h - 50);
        if (W.pegs.every(p => p.state === 'gone' || Math.hypot(p.x - x, p.y - y) > p.r + 16)) {
          const p = Phys.addPeg(W, x, y, 'rock', 8.5); p.flash = 1; p.spawnT = 1;
          break;
        }
      }
    }
    fx('rocks', { n });
  }

  /* ---------- 勝ち負け ---------- */
  function winBattle(B) {
    const R = G.R, m = G.mods(), st = G.save.stats;
    if (B.phase === 'won') return;
    B.phase = 'won';
    st.battlesWon++;
    const goldMult = (1 + (R.dm.goldMult || 0)) * (1 + D.ENDLESS.gold * R.loop);
    const gold = Math.round(B.goldPool * goldMult) + (m.winGold || 0);
    R.poison = 0;
    const heal = (m.winHeal || 0);
    B.result = { gold, heal: 0, taken: B.taken };
    addGold(gold);
    if (heal) B.result.heal = healPlayer(heal, 'relic:seaweed');
    if (B.kind === 'boss' || B.kind === 'final') {
      R.bosses++; st.bossKills++;
      if (B.taken === 0) st.flawlessBoss++;
      if (B.kind === 'boss') st['areaBoss' + R.area] = (st['areaBoss' + R.area] || 0) + 1;
      if (R.loop >= 1) st.endlessLoopBoss++;
      if (!R.dm.noBossHeal) B.result.heal += healPlayer(Math.round(G.maxHp() * D.BOSS_HEAL), 'boss');
    }
    relicHook('win', R, B);
    fx('win', { kind: B.kind });
    checkAch();
    queue(B, 1.1, () => {
      if (B.kind === 'final') {
        if (R.mode === 'endless') {
          R.loop++;
          st.bestEndless = Math.max(st.bestEndless, R.loop);
          R.reward = genReward('boss');
          R.reward.loopNext = true;
          R.phase = 'reward';
        } else endRun(true);
        return;
      }
      R.reward = genReward(B.kind);
      R.phase = 'reward';
    });
  }

  function loseBattle(B) {
    if (B.phase === 'lost') return;
    B.phase = 'lost';
    fx('lose', {});
    queue(B, 1.3, () => endRun(false));
  }

  G.update = function (dt) {
    const B = G.B;
    if (!B) return;
    if (B.phase === 'fly') G.updateFlight(dt);
    if (B.seq.length) {
      if (SD.headless) { let guard = 0; while (B.seq.length && guard++ < 5000) B.seq.shift().fn(); }
      else {
        B.seqT += dt;
        while (B.seq.length && B.seqT >= B.seq[0].d) { B.seqT -= B.seq[0].d; B.seq.shift().fn(); }
        if (!B.seq.length) B.seqT = 0;
      }
    }
  };
  G.flush = function () { const B = G.B; let guard = 0; while (B && B.seq.length && guard++ < 5000) B.seq.shift().fn(); };

  /* ================= 報酬 ================= */
  function rarShift(kind) { return kind === 'boss' ? D.RAR.bossShift : kind === 'elite' ? D.RAR.eliteShift : 0; }
  function rarW(base, rar, shift) { return base[rar] * (1 + shift * rar * 0.6); }

  function ballPool(R, rng, n, shift, exclude, allowOwned) {
    const owned = {};
    for (const b of R.deck) if (!D.ball[b.id].curse) owned[b.id] = Math.max(owned[b.id] || 0, b.lv);
    const pool = D.BALLS.filter(b => !b.curse && !b.evo && G.unlocked(b) && !R.banned.includes(b.id) && !exclude.includes(b.id)
      && !(owned[b.id] >= 3 && allowOwned));
    const out = [];
    const used = new Set();
    for (let k = 0; k < n && pool.length; k++) {
      const cand = pool.filter(b => !used.has(b.id));
      if (!cand.length) break;
      const def = rng.weighted(cand, b => rarW(D.RAR.ballW, b.rar, shift) * (owned[b.id] && allowOwned ? 1.3 : 1));
      used.add(def.id);
      const up = allowOwned && owned[def.id] > 0 && owned[def.id] < 3;
      out.push({ kind: 'ball', id: def.id, up, lv: up ? owned[def.id] + 1 : 1 });
    }
    return out;
  }
  function relicPool(R, rng, n, shift, exclude, minRar) {
    const pool = D.RELICS.filter(r => !R.relics.includes(r.id) && G.unlocked(r) && !R.banned.includes(r.id) && !exclude.includes(r.id) && r.rar >= (minRar || 0));
    const out = [], used = new Set();
    const haveBall = new Set(R.deck.map(b => b.id));
    for (let k = 0; k < n; k++) {
      const cand = pool.filter(r => !used.has(r.id));
      if (!cand.length) break;
      const def = rng.weighted(cand, r => rarW(D.RAR.relicW, r.rar, shift) * (r.evoFor && haveBall.has(r.evoFor) ? 2.5 : 1));
      used.add(def.id);
      out.push({ kind: 'relic', id: def.id });
    }
    return out;
  }

  function genReward(kind) {
    const R = G.R, m = G.mods();
    const rw = { kind, rolls: 0, balls: null, relics: null, ballDone: true, relicDone: true, gold: G.B && G.B.result ? G.B.result.gold : 0 };
    if (kind === 'fight' || kind === 'elite' || kind === 'boss' || kind === 'final') {
      rw.ballN = Math.max(1, 3 + (R.dm.ballChoice || 0));
      rw.balls = rollBalls(rw, 0);
      rw.ballDone = false;
    }
    if (kind === 'elite' || kind === 'boss' || kind === 'chest') {
      rw.relicN = 3 + (kind === 'chest' ? (m.chestChoice || 0) : 0);
      rw.relics = rollRelics(rw, 0);
      rw.relicDone = !rw.relics.length;
    }
    return rw;
  }
  function rollBalls(rw, roll) {
    const R = G.R, rng = nodeRng('rb', roll);
    const list = ballPool(R, rng, rw.ballN, rarShift(rw.kind), [], true);
    const evo = G.evoReady();
    if (evo.length) { const e = evo[roll % evo.length]; list[0] = { kind: 'evo', id: e.evo.id, from: e.inst.uid }; }
    return list;
  }
  function rollRelics(rw, roll) {
    const R = G.R, rng = nodeRng('rr', roll);
    return relicPool(R, rng, rw.relicN, rw.kind === 'chest' ? 0.5 : rarShift(rw.kind), [], rw.kind === 'boss' ? 1 : 0);
  }

  G.rewardPick = function (section, i) {
    const R = G.R, rw = R.reward;
    if (!rw) return false;
    if (section === 'ball' && !rw.ballDone) {
      const o = rw.balls[i]; if (!o) return false;
      takeBallOption(o);
      rw.ballDone = true;
    } else if (section === 'relic' && !rw.relicDone) {
      const o = rw.relics[i]; if (!o) return false;
      G.addRelic(o.id);
      rw.relicDone = true;
      // 遺物を取って進化できるようになったら、玉の選択肢に進化を出し直す
      if (!rw.ballDone && G.evoReady().length && !rw.balls.some(b => b.kind === 'evo')) rw.balls = rollBalls(rw, rw.rolls);
    } else return false;
    return true;
  };
  function takeBallOption(o) {
    const R = G.R;
    if (o.kind === 'evo') {
      const inst = R.deck.find(b => b.uid === o.from) || R.deck.find(b => b.id === D.ball[o.id].from && b.lv >= 3);
      if (inst) { inst.id = o.id; inst.lv = 1; }
      G.save.seen.balls[o.id] = 1;
      G.save.evolved[o.id] = 1; G.save.stats.evolves++;
      fx('evolve', { id: o.id });
      checkAch();
      return;
    }
    if (o.up) {
      const inst = R.deck.filter(b => b.id === o.id && b.lv < 3).sort((a, b) => b.lv - a.lv)[0];
      if (inst) { inst.lv++; fx('upgrade', { id: o.id, lv: inst.lv }); return; }
    }
    G.addBall(o.id, 1);
  }
  G.rewardSkip = function (section) {
    const rw = G.R.reward;
    if (!rw) return;
    if (section === 'ball' && !rw.ballDone) { rw.ballDone = true; addGold(8); }
    if (section === 'relic' && !rw.relicDone) { rw.relicDone = true; addGold(15); }
  };
  G.rewardReroll = function (section) {
    const R = G.R, rw = R.reward;
    if (!rw || R.rerolls <= 0) return false;
    if (section === 'ball' && !rw.ballDone) { R.rerolls--; rw.rolls++; rw.balls = rollBalls(rw, rw.rolls + 100); return true; }
    if (section === 'relic' && !rw.relicDone) { R.rerolls--; rw.rolls++; rw.relics = rollRelics(rw, rw.rolls + 100); return true; }
    return false;
  };
  G.rewardBanish = function (section, i) {
    const R = G.R, rw = R.reward;
    if (!rw || R.banishes <= 0) return false;
    const list = section === 'ball' ? rw.balls : rw.relics;
    const o = list && list[i];
    if (!o || o.kind === 'evo') return false;
    R.banishes--;
    R.banned.push(o.id);
    rw.rolls++;
    const rng = nodeRng('bn', rw.rolls);
    const ex = list.map(x => x.id);
    const rep = section === 'ball' ? ballPool(R, rng, 1, rarShift(rw.kind), ex, true)[0] : relicPool(R, rng, 1, rarShift(rw.kind), ex, 0)[0];
    if (rep) list[i] = rep; else list.splice(i, 1);
    return true;
  };
  G.rewardFinish = function () {
    const R = G.R, rw = R.reward;
    if (rw && rw.loopNext) {
      // エンドレス: 最初の海域にもどって、さらに深く
      R.area = 0; R.pos = { r: -1, i: 0 }; R.map = genMap(R); R.reward = null; G.B = null; R.floors++;
      R.phase = 'map'; fx('area', { area: 0, loop: R.loop }); G.suspendRun();
      return;
    }
    G.continueMap();
  };

  /* ================= 宝箱・休憩 ================= */
  function startChest() {
    const R = G.R, m = G.mods();
    R.reward = genReward('chest');
    if (m.chestGold) addGold(m.chestGold);
    R.reward.gold = m.chestGold || 0;
    R.phase = 'reward';
  }
  G.restChoose = function (what) {
    const R = G.R;
    if (R.phase !== 'rest' || R.restDone) return;
    if (what === 'heal') { healPlayer(Math.round(G.maxHp() * D.REST.healPct), 'rest'); R.restDone = true; }
    else if (what === 'upgrade') { R.pick = { type: 'upgrade', from: 'rest' }; }
  };

  /* ================= 店 ================= */
  function price(base) {
    const R = G.R, m = G.mods();
    return Math.max(1, Math.round(base * (1 + (R.dm.shopCost || 0)) * (1 - Math.min(0.6, m.shopDisc || 0))));
  }
  G.price = price;
  function startShop() {
    const R = G.R, rng = nodeRng('shop');
    const balls = ballPool(R, rng, D.SHOP.balls, 0.4, [], false).map(o => ({ kind: 'ball', id: o.id, cost: price(D.SHOP.ball[D.ball[o.id].rar]), sold: false }));
    const relics = relicPool(R, rng, D.SHOP.relics, 0.4, [], 0).map(o => ({ kind: 'relic', id: o.id, cost: price(D.SHOP.relic[D.relic[o.id].rar]), sold: false }));
    R.shop = { balls, relics, healUsed: 0 };
    R.phase = 'shop';
  }
  G.upgradeCost = function () { const m = G.mods(); return Math.round(price(D.SHOP.upgrade.base + D.SHOP.upgrade.step * G.R.upgradesBought) * (1 - (m.upgradeDisc || 0))); };
  G.removeCost = function () { return price(D.SHOP.remove.base + D.SHOP.remove.step * G.R.removes); };
  G.healCost = function () { return price(D.SHOP.heal.cost); };
  G.shopBuy = function (section, i) {
    const R = G.R, sh = R.shop;
    if (!sh) return false;
    const it = (section === 'ball' ? sh.balls : sh.relics)[i];
    if (!it || it.sold || R.gold < it.cost) return false;
    R.gold -= it.cost; it.sold = true;
    if (it.kind === 'ball') G.addBall(it.id, 1); else G.addRelic(it.id);
    fx('buy', {});
    return true;
  };
  G.shopService = function (what) {
    const R = G.R, sh = R.shop;
    if (!sh) return false;
    if (what === 'heal') {
      const c = G.healCost();
      if (R.gold < c || R.hp >= G.maxHp()) return false;
      R.gold -= c; sh.healUsed++; healPlayer(D.SHOP.heal.amt, 'shop'); fx('buy', {}); return true;
    }
    if (what === 'upgrade') { if (R.gold < G.upgradeCost() || !R.deck.some(b => canUpgrade(b))) return false; R.pick = { type: 'upgrade', from: 'shop', cost: G.upgradeCost() }; return true; }
    if (what === 'remove') { if (R.gold < G.removeCost() || R.deck.length <= 2) return false; R.pick = { type: 'remove', from: 'shop', cost: G.removeCost() }; return true; }
    return false;
  };
  function canUpgrade(b) { const d = D.ball[b.id]; return !d.curse && !d.evo && b.lv < 3; }
  G.canUpgrade = canUpgrade;

  /* ================= 手持ちの玉を選ぶ(強化・削除・複製) ================= */
  G.pickBall = function (uid) {
    const R = G.R, pk = R.pick;
    if (!pk) return false;
    const inst = R.deck.find(b => b.uid === uid);
    if (!inst) return false;
    if (pk.type === 'upgrade') { if (!canUpgrade(inst)) return false; inst.lv++; fx('upgrade', { id: inst.id, lv: inst.lv }); }
    else if (pk.type === 'remove') { if (R.deck.length <= 2) return false; R.deck.splice(R.deck.indexOf(inst), 1); fx('remove', { id: inst.id }); }
    else if (pk.type === 'copy') { if (D.ball[inst.id].curse) return false; G.addBall(inst.id, inst.lv); }
    if (pk.cost) R.gold -= pk.cost;
    if (pk.from === 'shop') { if (pk.type === 'upgrade') R.upgradesBought++; else if (pk.type === 'remove') R.removes++; }
    if (pk.from === 'rest') R.restDone = true;
    if (pk.from === 'event' && R.event) R.event.done = true;
    R.pick = null;
    return true;
  };
  G.cancelPick = function () {
    const R = G.R, pk = R.pick;
    if (!pk) return;
    if (pk.from === 'event' && R.event) { R.event.done = true; if (pk.refund) R.gold += pk.refund; }
    R.pick = null;
  };

  /* ================= できごと ================= */
  function startEvent() {
    const R = G.R, rng = nodeRng('event');
    const pool = D.EVENTS.filter(e => !(R.seenEvents || []).includes(e.id));
    const ev = rng.pick(pool.length ? pool : D.EVENTS);
    R.seenEvents = (R.seenEvents || []).concat(ev.id);
    R.event = { id: ev.id, result: null, done: false };
    R.phase = 'event';
  }
  G.eventChoose = function (i) {
    const R = G.R, E = R.event;
    if (!E || E.result) return false;
    const ev = D.EVENTS.find(e => e.id === E.id), ch = ev.choices[i];
    if (!ch || (ch.cond && !ch.cond(R))) return false;
    const goldBefore = R.gold;
    const res = ch.run(R, nodeRng('evrun', i));
    if (typeof res === 'string') { E.result = res; E.done = true; }
    else {
      E.result = res.text;
      if (res.pick) {
        const ok = R.deck.some(b => res.pick === 'upgrade' ? canUpgrade(b) : res.pick === 'remove' ? R.deck.length > 2 : !D.ball[b.id].curse);
        if (ok) R.pick = { type: res.pick, from: 'event', refund: Math.max(0, goldBefore - R.gold) };
        else { E.result += '(選べる玉がなかった)'; if (goldBefore > R.gold) R.gold = goldBefore; E.done = true; }
      } else E.done = true;
    }
    fx('event', {});
    return true;
  };
  // data.js のできごとから使う操作
  GX.heal = (R, n) => healPlayer(n, 'event');
  GX.hurt = (R, n) => { R.hp = Math.max(1, R.hp - n); R.st.taken += n; fx('hurt', { v: n, kind: 'event' }); };
  GX.gold = (R, n) => addGold(n);
  GX.giveBall = (R, id) => G.addBall(id, 1);
  GX.giveRelic = (R, id) => G.addRelic(id);
  GX.randBall = (R, rng, minRar) => {
    const pool = D.BALLS.filter(b => !b.curse && !b.evo && G.unlocked(b) && b.rar >= minRar);
    if (!pool.length) return null;
    const d = rng.weighted(pool, b => D.RAR.ballW[b.rar]);
    G.addBall(d.id, 1);
    return d;
  };
  GX.randRelic = (R, rng, minRar) => {
    let pool = D.RELICS.filter(r => !R.relics.includes(r.id) && G.unlocked(r) && r.rar >= minRar);
    if (!pool.length) pool = D.RELICS.filter(r => !R.relics.includes(r.id) && G.unlocked(r));
    if (!pool.length) return null;
    const d = rng.weighted(pool, r => D.RAR.relicW[r.rar]);
    G.addRelic(d.id);
    return d;
  };
  GX.loseRandomRelic = (R, rng) => {
    if (!R.relics.length) return null;
    const id = rng.pick(R.relics);
    R.relics.splice(R.relics.indexOf(id), 1); modsCache = null;
    R.hp = Math.min(R.hp, G.maxHp());
    return D.relic[id];
  };

  /* ================= プレイの終わり ================= */
  function score(R, win) { return R.floors * 100 + R.kills * 5 + R.bosses * 300 + (win ? 2000 : 0) + R.loop * 1500; }
  function endRun(win, abandoned) {
    const R = G.R, sv = G.save, st = sv.stats, m = G.mods();
    if (R.phase === 'result') return;
    R.phase = 'result';
    if (win) R.floors++;
    const base = R.floors * D.PEARL.floor + R.elites * D.PEARL.elite + R.bosses * D.PEARL.boss + (win ? D.PEARL.win : 0);
    let mult = (1 + D.PEARL.diffMult * R.diff) * (1 + (m.pearlMult || 0));
    if (R.mode === 'daily') mult *= D.PEARL.dailyMult;
    const pearls = Math.round(base * mult);
    sv.pearls += pearls; sv.pearlsTotal += pearls;
    if (win) {
      st.wins++;
      st.charWins[R.charId] = (st.charWins[R.charId] || 0) + 1;
      st.bestDiffWin = Math.max(st.bestDiffWin, R.diff);
      sv.clears[R.charId] = Math.max(sv.clears[R.charId] == null ? -1 : sv.clears[R.charId], R.diff);
      if (R.mode !== 'daily' && R.diff >= sv.maxDiff && sv.maxDiff < 20) sv.maxDiff = R.diff + 1;
    } else st.deaths++;
    st.bestFloor = Math.max(st.bestFloor, R.floors);
    st.playTime += R.time;
    const sc = score(R, win);
    st.bestScore = Math.max(st.bestScore, sc);
    let newDaily = false;
    if (R.mode === 'daily') { if (!sv.daily[R.day] || sc > sv.daily[R.day]) { sv.daily[R.day] = sc; newDaily = true; } }
    if (R.mode === 'endless') sv.endlessBest = Math.max(sv.endlessBest, R.floors);
    sv.run = null;
    R.result = { win, abandoned: !!abandoned, pearls, score: sc, newDaily, floors: R.floors, time: R.time };
    checkAch();
    G.persist();
    fx('result', { win });
  }
  G.endRun = endRun;
  G.score = score;

  /* ================= 実績 ================= */
  function checkAch() {
    const sv = G.save;
    if (!sv) return;
    for (const a of D.ACH) {
      if (sv.ach[a.id]) continue;
      let ok = false;
      try { ok = a.test(sv.stats, sv); } catch (e) { ok = false; }
      if (ok) {
        sv.ach[a.id] = Date.now();
        sv.pearls += a.pearls; sv.pearlsTotal += a.pearls;
        G.toasts.push({ kind: 'ach', id: a.id });
        fx('ach', { id: a.id });
      }
    }
  }
  G.checkAch = checkAch;

  /* ================= 工房 ================= */
  G.buyUpgrade = function (id) {
    const sv = G.save, u = D.UPGRADES.find(x => x.id === id);
    const lv = sv.upgrades[id] || 0;
    if (!u || lv >= u.costs.length || sv.pearls < u.costs[lv]) return false;
    sv.pearls -= u.costs[lv]; sv.upgrades[id] = lv + 1; G.persist(); checkAch(); return true;
  };
  G.buyChar = function (id) {
    const sv = G.save, c = D.char[id];
    if (!c || sv.unlocked.chars[id] || sv.pearls < c.cost) return false;
    sv.pearls -= c.cost; sv.unlocked.chars[id] = true; G.persist(); return true;
  };
  G.buyItem = function (kind, id) {
    const sv = G.save, def = kind === 'ball' ? D.ball[id] : D.relic[id];
    if (!def || !def.lock || sv.unlocked.items[id] || sv.pearls < def.lock) return false;
    sv.pearls -= def.lock; sv.unlocked.items[id] = true; G.persist(); return true;
  };

  return G;
})();
