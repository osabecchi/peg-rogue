'use strict';
/* 潮珠 SHIODAMA — ゲームの数値とコンテンツはすべてここ。調整はこのファイルだけで済むようにしてある。
   効果の関数で使う S は「1ショットの記録」、B は戦闘、R は1回のプレイ。操作は SD.GX(game.js)。 */
(function () {
  const GX = SD.GX;
  const D = SD.D = {};

  /* ---------- 基本の数値 ---------- */
  D.BAL = {
    boardW: 360, boardH: 470, launchX: 180, launchY: 26,
    gravity: 680, launchSpd: 580, timeScale: 1.3, maxSpd: 1100, ballR: 7, pegR: 6.5,
    pegE: 0.72, wallE: 0.82, bumperE: 1.25, friction: 0.02,
    critPegs: 2, refreshPegs: 1, bombPegs: 2, healPegs: 1, goldPegs: 0,
    bombHp: 2, bombDmg: 12, bombRadius: 52, healPeg: 2, goldPeg: 1,
    swaps: 1, rerolls: 1, banish: 1, startGold: 30,
    autoRefreshLeft: 0.18,       // 残りピンがこの割合を下回ったら盤面を戻す
    stuckTime: 1.1, maxBallLife: 22,
    poisonDecay: 1,
  };

  D.RAR = {
    name: ['並', '良', '稀', '極'],
    en: ['COMMON', 'UNCOMMON', 'RARE', 'LEGEND'],
    col: ['#cfd8dc', '#6fe0b8', '#7cc4ff', '#ffcf5a'],
    ballW: [60, 30, 9, 2.2],
    relicW: [55, 32, 11, 2.5],
    eliteShift: 1.6, bossShift: 3,   // 強敵・ボスの報酬はレア度が上がりやすい
  };

  D.SHOP = {
    ball: [32, 52, 82, 125], relic: [85, 115, 155, 210],
    heal: { amt: 20, cost: 25 }, upgrade: { base: 45, step: 20 }, remove: { base: 40, step: 20 },
    balls: 3, relics: 2,
  };

  D.MAP = { rows: 6, cols: 4, paths: 3, weights: { fight: 46, event: 21, elite: 12, shop: 9, chest: 9 } };
  D.NODE = {
    fight: { name: '戦闘', k: '戦', col: '#7cc4ff' },
    elite: { name: '強敵', k: '強', col: '#ff7a6b' },
    event: { name: 'できごと', k: '?', col: '#c9a6ff' },
    shop: { name: '店', k: '店', col: '#ffcf5a' },
    chest: { name: '宝箱', k: '宝', col: '#6fe0b8' },
    rest: { name: '潮だまり', k: '休', col: '#9be7c4' },
    boss: { name: 'ボス', k: '主', col: '#ff4f6d' },
    final: { name: '深淵', k: '淵', col: '#e05cff' },
  };

  D.ENC = [
    { base: 32, step: 9, maxN: 4 },
    { base: 72, step: 12, maxN: 5 },
    { base: 124, step: 16, maxN: 5 },
  ];
  D.PEARL = { floor: 1, elite: 4, boss: 12, win: 40, diffMult: 0.1, dailyMult: 1.2 };
  D.ENDLESS = { hp: 0.6, atk: 0.3, gold: 0.2 };
  D.REST = { healPct: 0.4 };
  D.BOSS_HEAL = 0.3; // ボスを倒したときの回復(最大体力に対する割合)

  /* ---------- ピン ---------- */
  D.PEGS = {
    normal: { name: '珊瑚ピン', desc: '当てると1ヒット。' },
    crit: { name: '会心ピン', desc: 'このショットのダメージが会心の値になる。' },
    bomb: { name: '機雷ピン', desc: '2回当てると爆発し、すべての敵にダメージ。周りのピンも点灯する。' },
    heal: { name: '回復ピン', desc: '当てると体力が回復する。' },
    refresh: { name: '戻しピン', desc: 'ショットのあと、消えたピンがすべて戻る。' },
    gold: { name: '貝貨ピン', desc: '当てると貝貨が手に入る。' },
    rock: { name: '岩', desc: '敵が置いた岩。当ててもヒットにならない。' },
    barn: { name: 'フジツボ', desc: '敵が付けたフジツボ。2回当てないと点灯しない。' },
    bumper: { name: 'イソギンチャク', desc: '強くはじき返す。ヒットにはならない。' },
  };

  /* ---------- 玉 ---------- */
  // dmg / crit / x はレベル1〜3の値。desc の {x} はその値に置き換わる。
  // p: 物理の性質 (r 半径, g 重力倍率, e 反発倍率, spd 速度倍率, crush なぎ倒し)
  D.BALLS = [
    { id: 'pebble', name: '小石玉', k: '石', col: '#cbbfa8', rar: 0, tags: [], dmg: [2, 3, 4], crit: [4, 6, 8], desc: 'くせのない基本の玉。' },
    { id: 'pearl', name: '真珠玉', k: '珠', col: '#f6f1e7', rar: 1, tags: [], dmg: [3, 4, 5], crit: [6, 8, 10], desc: 'よく磨かれた、まっすぐ強い玉。' },
    { id: 'split', name: '分裂玉', k: '分', col: '#9be7c4', rar: 0, tags: ['multi'], dmg: [1, 2, 2], crit: [3, 4, 5], x: [1, 2, 3],
      desc: '最初にピンに当たると、新しく{x}個の玉に分かれる。',
      on: { hit(S, peg, b, x) { if (!b.child && !b.didSplit) { b.didSplit = true; for (let i = 0; i < x; i++) GX.spawn(S, b, (i - (x - 1) / 2) * 0.8 + 0.4, { child: true }); } } } },
    { id: 'harpoon', name: '銛玉', k: '銛', col: '#b0c4d4', rar: 1, tags: ['pierce'], dmg: [2, 3, 4], crit: [4, 6, 8], x: [5, 7, 10],
      desc: '最初の{x}個のピンを跳ね返らずに貫く。',
      on: { launch(S, b, x) { b.pierce = x + S.mods.pierce; } } },
    { id: 'anchor', name: '錨玉', k: '錨', col: '#8d9aa6', rar: 0, tags: ['heavy'], dmg: [4, 5, 7], crit: [7, 9, 12], p: { r: 9, g: 1.5, e: 0.55, crush: true },
      desc: '重い。勢いがあるうちはピンをなぎ倒して進む。' },
    { id: 'jelly', name: '毒クラゲ玉', k: '毒', col: '#d68bff', rar: 0, tags: ['poison'], dmg: [1, 1, 2], crit: [2, 3, 4], x: [3, 2, 1],
      desc: 'ピン{x}個ごとに、狙った敵に毒1。毒は敵の番ごとにダメージを与える。',
      on: { end(S, x) { S.poison += Math.floor(S.hits / x); } } },
    { id: 'bouncy', name: '跳ね玉', k: '跳', col: '#ff9ec7', rar: 0, tags: ['bounce'], dmg: [2, 2, 3], crit: [3, 4, 5], x: [2, 3, 4], p: { e: 1.12 },
      desc: 'よく跳ねる。壁で跳ねるたびダメージ+{x}。',
      on: { wall(S, b, x) { S.add('ball', x); } } },
    { id: 'mine', name: '機雷玉', k: '機', col: '#ff8a5c', rar: 1, tags: ['bomb'], dmg: [1, 2, 3], crit: [3, 4, 5], x: [1, 2, 3],
      desc: '撃つとき機雷ピンを{x}個増やす。このショットでは機雷が1回で爆発する。',
      on: { launch(S, b, x) { GX.addPegs(S, 'bomb', x); S.bombOneHit = true; } } },
    { id: 'shark', name: '鮫歯玉', k: '牙', col: '#e8eef2', rar: 1, tags: ['crit'], dmg: [2, 2, 3], crit: [7, 10, 14], desc: '会心のダメージがとても大きい。' },
    { id: 'goldball', name: '黄金玉', k: '金', col: '#ffd25e', rar: 1, tags: ['gold'], dmg: [1, 2, 2], crit: [2, 3, 4], x: [4, 3, 2],
      desc: 'ピン{x}個ごとに貝貨+1。',
      on: { end(S, x) { S.gold += Math.floor(S.hits / x); } } },
    { id: 'coral', name: '珊瑚玉', k: '珊', col: '#ff8f8f', rar: 0, tags: ['heal'], dmg: [2, 2, 3], crit: [3, 4, 5], x: [6, 5, 4],
      desc: 'ピン{x}個ごとに体力+1。',
      on: { end(S, x) { S.heal += Math.floor(S.hits / x); } } },
    { id: 'ice', name: '氷玉', k: '氷', col: '#bdf1ff', rar: 1, tags: ['ice'], dmg: [2, 3, 3], crit: [4, 5, 7], x: [12, 10, 8],
      desc: '{x}ヒット以上で、狙った敵を凍らせる(1回休み)。',
      on: { end(S, x) { if (S.hits >= x) S.freeze = 1; } } },
    { id: 'eel', name: '電気ウナギ玉', k: '電', col: '#fff27a', rar: 1, tags: ['aoe'], dmg: [1, 2, 2], crit: [2, 3, 4], x: [1, 2, 3],
      desc: '狙った敵のほか、{x}体の敵に半分のダメージが連鎖する。',
      on: { end(S, x) { S.chain = Math.max(S.chain, x); S.chainFrac = Math.max(S.chainFrac, 0.5); } } },
    { id: 'wave', name: '大波玉', k: '波', col: '#5fd0ff', rar: 2, tags: ['aoe'], dmg: [2, 2, 3], crit: [3, 4, 5], lock: 60,
      desc: 'すべての敵に同じダメージ。',
      on: { end(S) { S.target = 'all'; } } },
    { id: 'archer', name: 'テッポウウオ玉', k: '撃', col: '#a3e37a', rar: 0, tags: [], dmg: [3, 3, 4], crit: [4, 5, 7],
      desc: 'いちばん後ろの敵を狙う。',
      on: { end(S) { if (S.target === 'front') S.target = 'back'; } } },
    { id: 'ghost', name: 'クリオネ玉', k: '霊', col: '#e2f6ff', rar: 1, tags: [], dmg: [2, 3, 3], crit: [4, 5, 6], x: [2, 3, 4],
      desc: '左右の壁をすり抜けて反対側から出る({x}回まで)。',
      on: { launch(S, b, x) { b.wrap = x; } } },
    { id: 'magnet', name: '磁石玉', k: '磁', col: '#ff6b6b', rar: 1, tags: [], dmg: [2, 2, 3], crit: [4, 5, 6],
      desc: '近くのピンに引き寄せられる。',
      on: { launch(S, b) { b.magnet += 1; } } },
    { id: 'sunfish', name: 'マンボウ玉', k: '巨', col: '#c7d6e6', rar: 1, tags: [], dmg: [2, 2, 3], crit: [3, 4, 5], p: { r: 13 },
      desc: '大きくて、たくさんのピンに当たる。' },
    { id: 'fry', name: '稚魚玉', k: '稚', col: '#ffe0a3', rar: 0, tags: [], dmg: [3, 4, 5], crit: [5, 6, 8], p: { r: 4.5, spd: 1.15 },
      desc: '小さくて速い。すき間をすり抜ける。' },
    { id: 'sardine', name: 'イワシ玉', k: '群', col: '#b9d3ea', rar: 1, tags: ['multi'], dmg: [1, 1, 2], crit: [2, 3, 3], x: [3, 4, 5], p: { r: 5 },
      desc: '{x}個の小さな玉を同時に撃つ。',
      on: { launch(S, b, x) { for (let i = 1; i < x; i++) GX.spawn(S, b, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.13, { child: true }); } } },
    { id: 'dolphin', name: 'イルカ玉', k: '還', col: '#8fd3ff', rar: 1, tags: [], dmg: [2, 3, 3], crit: [4, 5, 6], x: [1, 1, 2],
      desc: '底に落ちると、上からもう一度落ちてくる({x}回)。',
      on: { launch(S, b, x) { b.echo = x; } } },
    { id: 'tide', name: '潮玉', k: '潮', col: '#5ee6d0', rar: 2, tags: ['refresh'], dmg: [2, 3, 4], crit: [4, 5, 7], lock: 50,
      desc: '撃つ前に、消えたピンをすべて戻す。',
      on: { launch(S) { GX.refreshAll(S); } } },
    { id: 'starsand', name: '星砂玉', k: '星', col: '#ffe9a8', rar: 1, tags: ['crit'], dmg: [2, 2, 3], crit: [4, 5, 6], x: [6, 5, 4], lock: 40,
      desc: 'ピン{x}個ごとに、盤面に会心ピンが1つ増える。',
      on: { hit(S, peg, b, x) { if (S.hits % x === 0) GX.addPegs(S, 'crit', 1); } } },
    { id: 'octopus', name: 'タコ墨玉', k: '墨', col: '#7a6f9b', rar: 1, tags: ['bomb'], dmg: [2, 2, 3], crit: [4, 5, 6], x: [2, 3, 4], lock: 40,
      desc: 'ピンに当たると、近くのピンを機雷ピンに変える({x}個まで)。',
      on: { hit(S, peg, b, x) { if ((S.n.oct || 0) < x) { if (GX.convertNear(S, peg.x, peg.y, 'bomb')) S.n.oct = (S.n.oct || 0) + 1; } } } },
    { id: 'lamprey', name: 'ヤツメ玉', k: '吸', col: '#c45a7a', rar: 2, tags: ['heal'], dmg: [2, 3, 3], crit: [4, 5, 6], x: [15, 20, 25], lock: 60,
      desc: '与えたダメージの{x}%だけ体力が回復する。',
      on: { end(S, x) { S.lifesteal += x / 100; } } },
    { id: 'turtle', name: '甲羅玉', k: '甲', col: '#8fbf7a', rar: 0, tags: ['shield'], dmg: [1, 2, 2], crit: [3, 3, 4], x: [4, 3, 2],
      desc: 'ピン{x}個ごとに盾+1。盾は受けるダメージを防ぐ。',
      on: { end(S, x) { S.shield += Math.floor(S.hits / x); } } },
    { id: 'serpent', name: 'ウミヘビ玉', k: '蛇', col: '#6fbf9f', rar: 2, tags: [], dmg: [1, 1, 2], crit: [2, 2, 3], x: [0.2, 0.3, 0.4], lock: 50,
      desc: 'ヒットするたび、1ヒットのダメージが+{x}ずつ増えていく。',
      on: { end(S, x) { S.add('ball', x * S.hits * (S.hits - 1) / 2); } } },
    { id: 'fugu', name: '爆裂フグ玉', k: '爆', col: '#ffb35c', rar: 1, tags: ['bomb'], dmg: [2, 2, 3], crit: [3, 4, 5], x: [12, 16, 20],
      desc: 'ピンに当たると{x}%の確率で小さく爆発し、周りのピンを点灯させる。',
      on: { hit(S, peg, b, x) { if (S.rng.chance(x / 100)) GX.blast(S, peg.x, peg.y, 40); } } },
    { id: 'crab', name: 'カニ玉', k: '蟹', col: '#ff7b5c', rar: 0, tags: ['multi'], dmg: [2, 2, 3], crit: [3, 4, 5], x: [1, 2, 3],
      desc: '壁に当たると分裂する({x}回まで)。',
      on: { wall(S, b, x) { if (!b.child && (b.splits || 0) < x) { b.splits = (b.splits || 0) + 1; GX.spawn(S, b, 0.35, { child: true }); } } } },
    { id: 'bubble', name: '泡玉', k: '泡', col: '#d6f5ff', rar: 0, tags: [], dmg: [1, 2, 2], crit: [3, 3, 4], p: { g: 0.55 },
      desc: 'ふわふわとゆっくり落ちる。' },
    { id: 'urchin', name: 'ウニ玉', k: '棘', col: '#5c4a6b', rar: 2, tags: [], dmg: [2, 3, 4], crit: [4, 5, 6], x: [4, 8, 12], lock: 50,
      desc: 'ピンに当たるたび、近くのピン1個にトゲが刺さって点灯する({x}回まで)。',
      on: { hit(S, peg, b, x) { if ((S.n.spk || 0) < x && !peg.byLight) { if (GX.lightNearest(S, peg.x, peg.y, 70)) S.n.spk = (S.n.spk || 0) + 1; } } } },
    { id: 'ryugu', name: '竜宮玉', k: '竜', col: '#ffcf5a', rar: 3, tags: ['gold', 'crit'], dmg: [4, 5, 6], crit: [8, 10, 12], x: [8, 6, 5], lock: 120,
      desc: 'ピン{x}個ごとに貝貨+1と会心ピン1つ。',
      on: { hit(S, peg, b, x) { if (S.hits % x === 0) { S.gold += 1; GX.addPegs(S, 'crit', 1); } } } },
    { id: 'moon', name: '月光玉', k: '月', col: '#f2f0ff', rar: 3, tags: ['refresh'], dmg: [3, 4, 5], crit: [6, 8, 10], lock: 120,
      desc: '戻しピンに当たると、その場で盤面が戻る(1ショット3回まで)。戻ったピンはもう一度数えられる。',
      on: { launch(S) { S.moon = 3; } } },
    { id: 'whale', name: 'クジラ玉', k: '鯨', col: '#7f9fc4', rar: 3, tags: ['heavy'], dmg: [3, 4, 5], crit: [6, 7, 9], p: { r: 16, g: 1.3, e: 0.5, crush: true }, lock: 110,
      desc: 'とても大きく重い。ピンをなぎ倒して進む。' },
    // 呪い(敵に混ぜられる)
    { id: 'sludge', name: 'ヘドロ玉', k: '泥', col: '#6b6a4a', rar: 0, curse: true, tags: ['curse'], dmg: [0], crit: [1], desc: '呪い。ほとんどダメージがない。' },
    { id: 'rust', name: '錆び玉', k: '錆', col: '#9a5a3a', rar: 0, curse: true, tags: ['curse'], dmg: [1], crit: [1], desc: '呪い。撃つと体力-2。',
      on: { launch(S) { S.selfDmg += 2; } } },
    // 進化(玉のレベル3 + 対応する遺物で、報酬に「進化」が出る)
    { id: 'swarm', name: '大群玉', k: '群', col: '#c9f0dc', rar: 3, evo: true, tags: ['multi'], dmg: [3], crit: [6], from: 'split', relic: 'scales',
      desc: 'ピン4個ごとに分裂し続ける(最大12個)。',
      on: { hit(S, peg, b) { if (S.hits % 4 === 0 && S.W.balls.length < 12) GX.spawn(S, b, S.rng.range(-0.6, 0.6), { child: true }); } } },
    { id: 'whaleharpoon', name: '鯨銛', k: '鯨', col: '#d6e4ee', rar: 3, evo: true, tags: ['pierce'], dmg: [5], crit: [10], from: 'harpoon', relic: 'whalebone',
      desc: '撃ってから2秒間は、すべてのピンを貫く。',
      on: { launch(S, b) { b.pierceT = 2; } } },
    { id: 'queenjelly', name: '猛毒女王', k: '妃', col: '#e9a6ff', rar: 3, evo: true, tags: ['poison'], dmg: [2], crit: [4], from: 'jelly', relic: 'venomgland',
      desc: 'ピン1個ごとに、すべての敵に毒1。',
      on: { end(S) { S.poisonAll += S.hits; } } },
    { id: 'wreck', name: '沈没船', k: '船', col: '#a08566', rar: 3, evo: true, tags: ['heavy'], dmg: [8], crit: [14], p: { r: 14, g: 1.5, e: 0.45, crush: true }, from: 'anchor', relic: 'chain',
      desc: 'すべてをなぎ倒す。なぎ倒したピンは2ヒット。',
      on: { hit(S, peg, b) { if (b.crushing) S.hv += 1; } } },
    { id: 'raijin', name: '雷神鰻', k: '雷', col: '#fff6a8', rar: 3, evo: true, tags: ['aoe'], dmg: [3], crit: [6], from: 'eel', relic: 'electro',
      desc: 'すべての敵に同じダメージ。会心ならさらに×1.5。',
      on: { end(S) { S.target = 'all'; if (S.crit) S.mul('ball', 1.5); } } },
    { id: 'infinite', name: '無限跳ね', k: '無', col: '#ffc2dd', rar: 3, evo: true, tags: ['bounce'], dmg: [3], crit: [5], p: { e: 1.15 }, from: 'bouncy', relic: 'springshell',
      desc: '壁で跳ねるたびダメージ+4。底に落ちても2回跳ね戻る。',
      on: { launch(S, b) { b.bottom += 2; }, wall(S) { S.add('ball', 4); } } },
    { id: 'megalodon', name: 'メガロドン', k: '巨', col: '#f4f7f9', rar: 3, evo: true, tags: ['crit'], dmg: [3], crit: [18], from: 'shark', relic: 'bloodscent',
      desc: 'いつでも会心。',
      on: { launch(S) { S.crit = true; } } },
  ];

  /* ---------- 遺物 ---------- */
  // mods: 持っているだけで足し合わされる数値。on: 決まったタイミングで動く効果。
  D.RELICS = [
    { id: 'sharpshell', name: '鋭い貝殻', k: '鋭', rar: 2, desc: 'すべての玉のダメージ+1。', mods: { dmg: 1 } },
    { id: 'sharkskin', name: '鮫肌', k: '肌', rar: 0, desc: '会心ダメージ+2。', mods: { critDmg: 2 } },
    { id: 'lighthouse', name: '灯台の欠片', k: '灯', rar: 0, desc: '会心ピンが1つ増える。', mods: { critPegs: 1 } },
    { id: 'tidestone', name: '潮だまりの石', k: '癒', rar: 0, desc: '回復ピンが1つ増える。', mods: { healPegs: 1 } },
    { id: 'minefactory', name: '機雷工場', k: '工', rar: 1, desc: '機雷ピンが2つ増える。', mods: { bombPegs: 2 } },
    { id: 'powderkeg', name: '火薬樽', k: '樽', rar: 1, desc: '機雷の爆発ダメージ+50%。', mods: { bombMult: 0.5 } },
    { id: 'doublebottom', name: '二重底', k: '底', rar: 1, desc: '戻しピンが1つ増える。', mods: { refreshPegs: 1 } },
    { id: 'compass', name: '羅針盤', k: '針', rar: 0, desc: '狙いの予測線が長くなる。', mods: { aimLen: 1 } },
    { id: 'scales', name: '群れの鱗', k: '鱗', rar: 1, evoFor: 'split', desc: '分裂・複数発射の玉は1ヒットのダメージ+1。',
      on: { shotEnd(S) { if (S.ball.tags.includes('multi')) S.add('scales', S.hv); } } },
    { id: 'whalebone', name: '鯨の骨', k: '骨', rar: 1, evoFor: 'harpoon', desc: '貫く玉の貫通回数+4。', mods: { pierce: 4 } },
    { id: 'venomgland', name: '毒腺', k: '腺', rar: 1, evoFor: 'jelly', desc: '毒を与えるとき、毒+2。', mods: { poisonAdd: 2 } },
    { id: 'chain', name: '沈没船の鎖', k: '鎖', rar: 1, evoFor: 'anchor', desc: '重い玉は1ヒットのダメージ+2。',
      on: { shotEnd(S) { if (S.ball.tags.includes('heavy')) S.add('chain', 2 * S.hv); } } },
    { id: 'electro', name: '発電器官', k: '発', rar: 1, evoFor: 'eel', desc: '複数の敵を攻撃する玉は1ヒットのダメージ+1。',
      on: { shotEnd(S) { if (S.ball.tags.includes('aoe')) S.add('electro', S.hv); } } },
    { id: 'springshell', name: 'ばね貝', k: 'ば', rar: 1, evoFor: 'bouncy', desc: '壁で跳ねるたびダメージ+2。', mods: { wallDmg: 2 } },
    { id: 'bloodscent', name: '血の匂い', k: '血', rar: 1, evoFor: 'shark', desc: '体力が半分以下の敵を狙うと必ず会心。',
      on: { shotEnd(S) { const t = S.targetEnemy; if (t && t.hp <= t.maxHp / 2 && !S.crit) { S.crit = true; S.tag('bloodscent'); } } } },
    { id: 'hundred', name: '百発百中', k: '百', rar: 2, lock: 60, desc: '1ショットで20ヒット以上ならダメージ×1.5。',
      on: { shotEnd(S) { if (S.hits >= 20) S.mul('hundred', 1.5); } } },
    { id: 'drum', name: '連打の太鼓', k: '鼓', rar: 1, desc: '10ヒットごとにダメージ+10%。',
      on: { shotEnd(S) { const n = Math.floor(S.hits / 10); if (n) S.mul('drum', 1 + 0.1 * n); } } },
    { id: 'firststrike', name: '先制の銛', k: '先', rar: 0, desc: '各戦闘の最初のショットはダメージ×2。',
      on: { shotEnd(S) { if (S.B.shots === 1) S.mul('firststrike', 2); } } },
    { id: 'goldbar', name: '金の延べ棒', k: '延', rar: 0, desc: '戦闘に勝つと貝貨+8。', mods: { winGold: 8 } },
    { id: 'pot', name: 'ウツボの壺', k: '壺', rar: 1, desc: '持っている貝貨10枚ごとにダメージ+2%(最大+40%)。',
      on: { shotEnd(S) { const m = Math.min(0.4, Math.floor(S.R.gold / 10) * 0.02); if (m > 0) S.mul('pot', 1 + m); } } },
    { id: 'lifering', name: '救命浮き輪', k: '輪', rar: 2, lock: 90, desc: '1度だけ、倒れても体力30%で復活する。', mods: { revive: 1 } },
    { id: 'thickshell', name: '厚い殻', k: '殻', rar: 0, desc: '最大体力+15。', mods: { maxHp: 15 }, on: { acquire(R) { R.hp += 15; } } },
    { id: 'coralcrown', name: '珊瑚の冠', k: '冠', rar: 0, desc: '戦闘開始時に盾+6。', mods: { startShield: 6 } },
    { id: 'seaweed', name: '海藻サラダ', k: '藻', rar: 0, desc: '戦闘に勝つと体力+4。', mods: { winHeal: 4 } },
    { id: 'tidescroll', name: '潮見の巻物', k: '巻', rar: 1, desc: '戦闘開始時、すべての敵を1回凍らせる。',
      on: { battleStart(B) { for (const e of B.enemies) e.freeze = Math.max(e.freeze, 1); } } },
    { id: 'inksac', name: '墨袋', k: '墨', rar: 1, desc: '敵の攻撃が20%の確率で外れる。', mods: { dodge: 0.2 } },
    { id: 'urchinarmor', name: 'ウニの鎧', k: '棘', rar: 0, desc: '攻撃を受けると、その敵に4ダメージ。', mods: { thorns: 4 } },
    { id: 'necklace', name: '真珠の首飾り', k: '飾', rar: 1, desc: '回復量+50%。', mods: { healMult: 0.5 } },
    { id: 'whirlpool', name: '渦潮', k: '渦', rar: 1, desc: '盤面が戻るたび、すべての敵に6ダメージ。',
      on: { refresh(S) { S.extraAll('whirlpool', 6); } } },
    { id: 'lantern', name: '提灯', k: '提', rar: 0, desc: '会心ピンに当たると貝貨+1。',
      on: { hit(S, peg) { if (peg.type === 'crit') S.gold += 1; } } },
    { id: 'treasuremap', name: '宝の地図', k: '図', rar: 0, desc: '宝箱の遺物の選択肢+1、宝箱で貝貨+20。', mods: { chestChoice: 1, chestGold: 20 } },
    { id: 'bell', name: '商人の鈴', k: '鈴', rar: 0, desc: '店の値段が20%安くなる。', mods: { shopDisc: 0.2 } },
    { id: 'conch', name: '法螺貝', k: '螺', rar: 0, desc: '報酬のリロール+2。', on: { acquire(R) { R.rerolls += 2; } } },
    { id: 'hourglass', name: '砂時計', k: '砂', rar: 0, desc: '報酬の除外+2。', on: { acquire(R) { R.banishes += 2; } } },
    { id: 'noctiluca', name: '夜光虫', k: '夜', rar: 1, desc: '機雷ピンが1回当たるだけで爆発する。', mods: { bombOneHit: 1 } },
    { id: 'sympathetic', name: '誘爆の火', k: '誘', rar: 1, desc: '機雷の爆発範囲+50%。', mods: { bombRadius: 0.5 } },
    { id: 'current', name: '速い潮流', k: '流', rar: 0, desc: '玉の発射速度+20%。', mods: { launchSpd: 0.2 } },
    { id: 'springboard', name: '底の跳ね板', k: '板', rar: 2, lock: 70, desc: '1ショットに1度、底に落ちる玉を跳ね上げる。', mods: { bottomBounce: 1 } },
    { id: 'sidewall', name: '横の跳ね板', k: '壁', rar: 0, desc: '左右の壁で跳ねると1ヒットとして数える。', mods: { wallHit: 1 } },
    { id: 'oldnet', name: '古い網', k: '網', rar: 1, desc: '底を動く網に玉が入るとダメージ×1.5。', mods: { bucket: 1 } },
    { id: 'magnetbell', name: '磁石の鈴', k: '磁', rar: 1, desc: 'すべての玉が近くのピンに少し引き寄せられる。', mods: { magnet: 0.5 } },
    { id: 'poisonthorn', name: '毒の棘', k: '毒', rar: 0, desc: '毒を受けている敵へのダメージ+25%。',
      on: { shotEnd(S) { const t = S.targetEnemy; if (t && t.poison > 0) S.mul('poisonthorn', 1.25); } } },
    { id: 'frostbubble', name: '凍える泡', k: '凍', rar: 0, desc: '凍っている敵へのダメージ+50%。',
      on: { shotEnd(S) { const t = S.targetEnemy; if (t && t.freeze > 0) S.mul('frostbubble', 1.5); } } },
    { id: 'thundercloud', name: '雷雲', k: '雲', rar: 1, desc: '3ショットごとに、すべての敵に8ダメージ。',
      on: { shotEnd(S) { if (S.B.shots % 3 === 0) S.extraAll('thundercloud', 8); } } },
    { id: 'dragonscale', name: '逆鱗', k: '逆', rar: 1, desc: '体力が半分以下のときダメージ+30%。',
      on: { shotEnd(S) { if (S.R.hp <= SD.G.maxHp() / 2) S.mul('dragonscale', 1.3); } } },
    { id: 'ebbflow', name: '満ち引きの月', k: '満', rar: 1, desc: '2ショットに1回、ダメージ+40%。',
      on: { shotEnd(S) { if (S.B.shots % 2 === 0) S.mul('ebbflow', 1.4); } } },
    { id: 'seahorse', name: 'タツノオトシゴ', k: '馬', rar: 0, desc: '玉を撃つたびに盾+1。',
      on: { shotStart(S) { S.shield += 1; } } },
    { id: 'shellshield', name: '貝の盾', k: '盾', rar: 1, desc: '盾がある間、ダメージ+20%。',
      on: { shotEnd(S) { if (S.B.block > 0) S.mul('shellshield', 1.2); } } },
    { id: 'deepeye', name: '深海の目', k: '眼', rar: 1, desc: '強敵とボスへのダメージ+25%。',
      on: { shotEnd(S) { const t = S.targetEnemy; if (t && (t.def.elite || t.def.boss)) S.mul('deepeye', 1.25); } } },
    { id: 'crownjelly', name: '王冠クラゲ', k: '王', rar: 2, lock: 80, desc: '敵の毒が減らなくなる。', mods: { poisonNoDecay: 1 } },
    { id: 'smith', name: '鍛冶ヤドカリ', k: '鍛', rar: 0, desc: '店での玉の強化が半額になる。', mods: { upgradeDisc: 0.5 } },
    { id: 'twinpearl', name: '双子の真珠', k: '双', rar: 2, lock: 80, desc: '各戦闘の最初のショットは玉が2個出る。',
      on: { launch(S, b) { if (S.B.shots === 1) { GX.spawn(S, b, 0.18, {}); S.tag('twinpearl'); } } } },
    { id: 'floatshell', name: '浮き貝', k: '浮', rar: 0, desc: '玉が15%ゆっくり落ちる。', mods: { gravity: -0.15 } },
    { id: 'lens', name: '拡大鏡', k: '鏡', rar: 1, desc: 'ピンが20%大きくなる。', mods: { pegScale: 0.2 } },
    { id: 'remora', name: 'コバンザメ', k: '小', rar: 0, desc: '敵を倒すたびに貝貨+2。', mods: { killGold: 2 } },
    { id: 'overflow', name: 'あふれる波', k: '溢', rar: 1, lock: 50, desc: '敵を倒して次の敵に通るダメージが1.5倍になる。', mods: { overflow: 0.5 } },
    { id: 'rage', name: '怒りの印', k: '怒', rar: 0, desc: 'ダメージを受けた次のショットはダメージ+40%。',
      on: { shotEnd(S) { if (S.B.hurtLast) S.mul('rage', 1.4); } } },
    { id: 'gear', name: '古代の歯車', k: '歯', rar: 1, desc: '盤面が戻るたび、この戦闘のダメージ+10%。',
      on: { refresh(S) { S.B.gear = (S.B.gear || 0) + 1; }, shotEnd(S) { if (S.B.gear) S.mul('gear', 1 + 0.1 * S.B.gear); } } },
    { id: 'abysslight', name: '深海魚の灯', k: '光', rar: 2, lock: 70, desc: '会心のとき、ほかの敵にも半分のダメージ。', mods: { critSplash: 0.5 } },
    { id: 'flag', name: '潮風の旗', k: '旗', rar: 1, desc: '各戦闘の最初のショットは会心で始まる。',
      on: { shotStart(S) { if (S.B.shots === 1 && !S.crit) { S.crit = true; S.tag('flag'); } } } },
    { id: 'hardscale', name: '硬い鱗', k: '硬', rar: 1, desc: '受けるダメージ-1。', mods: { armor: 1 } },
    { id: 'goldpeg', name: '黄金のピン', k: '貨', rar: 0, desc: '貝貨ピンが3つ増える。', mods: { goldPegs: 3 } },
    { id: 'starfish', name: 'ヒトデ', k: '星', rar: 1, desc: '敵を倒すと体力+2。', mods: { killHeal: 2 } },
    { id: 'pearlbag', name: '真珠袋', k: '袋', rar: 2, desc: 'このプレイで得る真珠+25%。', mods: { pearlMult: 0.25 } },
    { id: 'trident', name: '三叉の銛', k: '叉', rar: 3, lock: 120, desc: '狙った敵のほか、2体の敵にも同じダメージ。',
      on: { shotEnd(S) { S.chain = Math.max(S.chain, 2); S.chainFrac = 1; S.tag('trident'); } } },
    { id: 'ryujin', name: '竜神の珠', k: '神', rar: 3, lock: 120, desc: 'ダメージ×1.3。最大体力+10。', mods: { maxHp: 10 },
      on: { acquire(R) { R.hp += 10; }, shotEnd(S) { S.mul('ryujin', 1.3); } } },
    { id: 'kraken', name: 'クラーケンの吸盤', k: '盤', rar: 3, lock: 110, desc: '1ショットで出た玉1個ごとにダメージ+12%。',
      on: { shotEnd(S) { S.mul('kraken', 1 + 0.12 * S.ballsMade); } } },
    { id: 'orrery', name: '潮の羅針儀', k: '儀', rar: 3, lock: 130, desc: '1ショットで30ヒットを超えた分は2ヒットとして数える。',
      on: { hit(S) { if (S.hits > 30) { S.hv += 1; S.tag('orrery'); } } } },
    { id: 'mirror', name: '鏡の殻', k: '映', rar: 2, lock: 90, desc: '撃った玉の鏡写しがもう1つ出る(ヒットは半分の値)。',
      on: { launch(S, b) { GX.spawn(S, b, 0, { mirror: true, val: 0.5, child: true }); S.tag('mirror'); } } },
    { id: 'tidemark', name: '潮目', k: '目', rar: 0, desc: '戦闘中の玉の交換+2回。', mods: { swaps: 2 } },
    { id: 'sharptooth', name: '研いだ牙', k: '研', rar: 1, desc: '会心のときダメージ×1.25。',
      on: { shotEnd(S) { if (S.crit) S.mul('sharptooth', 1.25); } } },
    { id: 'scraper', name: 'フジツボ削り', k: '削', rar: 0, desc: '岩とフジツボに当てても1ヒットになる。', mods: { rockHit: 1 } },
    { id: 'antidote', name: '毒消し海藻', k: '消', rar: 0, desc: '自分が受ける毒が半分になる。', mods: { poisonResist: 0.5 } },
    { id: 'bait', name: '疑似餌', k: '餌', rar: 0, desc: '戦闘開始時、いちばん前の敵に毒5。',
      on: { battleStart(B) { const e = SD.GX.front(B); if (e) e.poison += 5; } } },
    { id: 'glitter', name: 'キラキラの鱗', k: '煌', rar: 0, desc: '盤面が戻るたびに貝貨+3。',
      on: { refresh(S) { S.gold += 3; } } },
    { id: 'bubblewrap', name: '泡の鎧', k: '鎧', rar: 1, desc: '自分の番のはじめに盾+2。',
      on: { turnStart(B) { B.block += 2; } } },
    { id: 'pressure', name: '水圧計', k: '圧', rar: 1, desc: '狙った敵がすぐ隣にいるとダメージ+35%。',
      on: { shotEnd(S) { const t = S.targetEnemy; if (t && t.slot === 0 && !t.def.boss) S.mul('pressure', 1.35); } } },
    { id: 'akoya', name: 'あこや貝', k: '阿', rar: 1, desc: 'ボスを倒すと最大体力+6。', on: { win(R, B) { if (B.kind === 'boss' || B.kind === 'final') { R.maxHpBonus += 6; R.hp += 6; } } } },
    { id: 'chum', name: '撒き餌', k: '撒', rar: 1, desc: '敵を倒すと、盤面に会心ピンが1つ増える。',
      on: { kill(B) { B.pendingCrit = (B.pendingCrit || 0) + 1; } } },
    { id: 'deepcharge', name: '深海の圧', k: '深', rar: 1, desc: '1ショットのヒットが10未満ならダメージ×1.6。',
      on: { shotEnd(S) { if (S.hits > 0 && S.hits < 10) S.mul('deepcharge', 1.6); } } },
  ];

  /* ---------- 潜り手(キャラクター) ---------- */
  D.CHARS = [
    { id: 'nagi', name: 'ナギ', title: '海女', col: '#5fd0ff', hp: 100, deck: ['pebble', 'pebble', 'pebble', 'pearl'],
      mods: { startShield: 5, aimLen: 0.5 }, cost: 0,
      desc: 'バランス型。戦闘開始時に盾+5、狙いの予測線が少し長い。' },
    { id: 'genzo', name: 'ゲンゾウ', title: '老漁師', col: '#ffb35c', hp: 105, deck: ['anchor', 'anchor', 'pebble', 'pebble'],
      mods: { bombPegs: 1 }, heavyDmg: 1, cost: 120,
      desc: '重い錨玉で盤面をなぎ倒す。重い玉のダメージ+1、機雷ピン+1。' },
    { id: 'mio', name: 'ミオ', title: '人魚', col: '#d68bff', hp: 90, deck: ['jelly', 'split', 'pebble', 'pebble'],
      mods: { poisonAdd: 1, healPegs: 1 }, cost: 200,
      desc: '毒と分裂で数を稼ぐ。毒を与えるとき+1、回復ピン+1。体力はやや低め。' },
    { id: 'k7', name: 'K-7', title: '潜水機', col: '#fff27a', hp: 90, deck: ['eel', 'bouncy', 'pebble', 'pebble'],
      mods: { critPegs: 1, critDmg: 1 }, cost: 300,
      desc: '会心特化の機械。会心ピン+1、会心ダメージ+1。' },
  ];

  /* ---------- 工房(周回をまたぐ永久強化) ---------- */
  D.UPGRADES = [
    { id: 'hp', name: '丈夫な潜水服', desc: '最大体力+6', costs: [30, 50, 80, 120, 170], mod: { maxHp: 6 } },
    { id: 'gold', name: '貝貨の袋', desc: '開始時の貝貨+20', costs: [40, 80, 140], mod: { startGold: 20 } },
    { id: 'reroll', name: '占い貝', desc: '報酬のリロール+1', costs: [50, 100, 160], mod: { rerolls: 1 } },
    { id: 'banish', name: '封印の札', desc: '報酬の除外+1', costs: [50, 100, 160], mod: { banish: 1 } },
    { id: 'aim', name: '望遠鏡', desc: '予測線が長くなる', costs: [60, 140], mod: { aimLen: 0.5 } },
    { id: 'heal', name: '回復薬の調合', desc: '戦闘に勝つと体力+2', costs: [60, 110, 180], mod: { winHeal: 2 } },
    { id: 'crit', name: '星読みの技', desc: '会心ピン+1', costs: [250], mod: { critPegs: 1 } },
    { id: 'shop', name: '顔なじみ', desc: '店の値段-5%', costs: [80, 160], mod: { shopDisc: 0.05 } },
    { id: 'pearl', name: '真珠の目利き', desc: '得る真珠+10%', costs: [100, 200, 320], mod: { pearlMult: 0.1 } },
    { id: 'swap', name: '早撃ちの練習', desc: '玉の交換+1', costs: [60, 130], mod: { swaps: 1 } },
    { id: 'chest', name: '鍵開けの道具', desc: '宝箱の選択肢+1', costs: [200], mod: { chestChoice: 1 } },
  ];

  /* ---------- 水圧(難易度) ---------- */
  // 水圧Nでは1〜Nがすべて重なる。mods は足し合わされる。
  D.DIFFS = [
    { lv: 1, desc: '敵の体力+10%', mods: { enemyHp: 0.1 } },
    { lv: 2, desc: '強敵がよく出る', mods: { eliteW: 8 } },
    { lv: 3, desc: '店の値段+15%', mods: { shopCost: 0.15 } },
    { lv: 4, desc: '敵の攻撃+1', mods: { enemyAtk: 1 } },
    { lv: 5, desc: '最初から錆び玉を持っている', mods: { startCurse: 1 } },
    { lv: 6, desc: 'ボスの体力+15%', mods: { bossHp: 0.15 } },
    { lv: 7, desc: '戦闘で得る貝貨-20%', mods: { goldMult: -0.2 } },
    { lv: 8, desc: '会心ピン-1', mods: { critPegs: -1 } },
    { lv: 9, desc: '敵の体力+10%', mods: { enemyHp: 0.1 } },
    { lv: 10, desc: '強敵の体力+20%', mods: { eliteHp: 0.2 } },
    { lv: 11, desc: '最大体力-10', mods: { maxHp: -10 } },
    { lv: 12, desc: '回復ピン-1', mods: { healPegs: -1 } },
    { lv: 13, desc: '敵の攻撃+1', mods: { enemyAtk: 1 } },
    { lv: 14, desc: 'ボスを倒したときの回復なし', mods: { noBossHeal: 1 } },
    { lv: 15, desc: '敵の体力+10%', mods: { enemyHp: 0.1 } },
    { lv: 16, desc: '報酬の玉の選択肢-1', mods: { ballChoice: -1 } },
    { lv: 17, desc: 'ボスの体力+15%', mods: { bossHp: 0.15 } },
    { lv: 18, desc: '開始時の貝貨なし', mods: { noStartGold: 1 } },
    { lv: 19, desc: '敵の攻撃+1', mods: { enemyAtk: 1 } },
    { lv: 20, desc: '最終ボスが真の姿になる', mods: { trueFinal: 1 } },
  ];

  /* ---------- 海域 ---------- */
  D.AREAS = [
    { id: 'reef', name: '珊瑚礁の浅瀬', en: 'CORAL SHALLOWS', bgTop: '#2ec4d6', bgBot: '#0b5c8a', sand: '#e9d7a6', peg: '#ff9a8a', light: 0.9,
      enemies: ['shrimp', 'hermit', 'puffer', 'crab', 'slug', 'flyfish'], elites: ['octo', 'moray'], bosses: ['kingcrab', 'hedgehog'],
      boards: ['grid', 'pyramid', 'arcs', 'clusters', 'diamonds', 'waves'] },
    { id: 'twilight', name: '薄明の海', en: 'TWILIGHT ZONE', bgTop: '#1d5f9e', bgBot: '#0a1f4a', sand: '#7f8fa8', peg: '#9fb7ff', light: 0.5,
      enemies: ['jelly', 'squid', 'seahorse', 'manowar', 'sawfish', 'barnmaster'], elites: ['orca', 'isopod'], bosses: ['umibozu', 'kraken'],
      boards: ['grid', 'arcs', 'clusters', 'rings', 'funnel', 'spiral', 'diamonds'] },
    { id: 'abyss', name: '深海の谷', en: 'THE ABYSS', bgTop: '#101d4a', bgBot: '#04050f', sand: '#3a3550', peg: '#7ff0e0', light: 0.18,
      enemies: ['angler', 'goblin', 'fangtooth', 'school', 'vent', 'ghostjelly', 'dragonfish'], elites: ['oarfish', 'spidercrab'], bosses: ['leviathan', 'ghostship'],
      boards: ['rings', 'funnel', 'spiral', 'moving', 'bumpers', 'clusters', 'waves'] },
    { id: 'deep', name: '深淵の底', en: 'HADAL DEPTHS', bgTop: '#1a0b33', bgBot: '#020108', sand: '#2a1a3d', peg: '#e9a6ff', light: 0.08,
      enemies: [], elites: [], bosses: ['abyss'], boards: ['moving'] },
  ];

  /* ---------- 敵 ---------- */
  // acts は順番に繰り返す行動。攻撃系(atk, atkp, explode, drain)は射程に入るまで前進する。
  // 射程 range: 0 は目の前だけ。spd: 1ターンに進むマス数。
  D.ENEMIES = [
    // 浅瀬
    { id: 'shrimp', name: '小エビ', hp: 10, range: 0, spd: 1, gold: 3, shape: 'shrimp', col: '#ff9a7a', size: 0.8, acts: [{ t: 'atk', v: 3 }] },
    { id: 'hermit', name: 'ヤドカリ', hp: 18, range: 0, spd: 1, gold: 4, armor: 2, shape: 'hermit', col: '#e8a86b', size: 0.9, acts: [{ t: 'atk', v: 4 }],
      desc: '殻で受けるダメージ-2。' },
    { id: 'puffer', name: 'フグ', hp: 14, range: 0, spd: 1, gold: 4, shape: 'puffer', col: '#f6d36b', size: 0.85, acts: [{ t: 'explode', v: 9 }],
      desc: '目の前まで来ると自爆する。' },
    { id: 'crab', name: 'イシガニ', hp: 22, range: 0, spd: 1, gold: 5, shape: 'crab', col: '#ff6b5c', size: 1, acts: [{ t: 'atk', v: 5 }, { t: 'block', v: 6 }] },
    { id: 'slug', name: 'ウミウシ', hp: 13, range: 3, spd: 1, gold: 4, shape: 'slug', col: '#b48bff', size: 0.8, acts: [{ t: 'poison', v: 2 }, { t: 'atk', v: 2 }],
      desc: '離れたところから毒を吐く。' },
    { id: 'flyfish', name: 'トビウオ', hp: 9, range: 0, spd: 2, gold: 3, shape: 'fish', col: '#8fd3ff', size: 0.8, fin: true, acts: [{ t: 'atk', v: 3 }], desc: '速い。' },
    { id: 'octo', name: '大ダコ', hp: 75, range: 1, spd: 1, gold: 18, elite: true, shape: 'octo', col: '#e0607e', size: 1.35,
      acts: [{ t: 'atk', v: 6 }, { t: 'ink' }, { t: 'atk', v: 4, n: 2 }], desc: '墨で盤面を隠す。' },
    { id: 'moray', name: 'ウツボ', hp: 62, range: 0, spd: 1, gold: 18, elite: true, shape: 'eel', col: '#a6a24a', size: 1.3,
      acts: [{ t: 'hide' }, { t: 'atk', v: 11 }], desc: '岩陰に隠れ、狙えなくなる。' },
    // 薄明
    { id: 'jelly', name: 'ミズクラゲ', hp: 22, range: 0, spd: 1, gold: 5, shape: 'jelly', col: '#9fd8ff', size: 0.95, acts: [{ t: 'atkp', v: 3, p: 2 }] },
    { id: 'squid', name: 'ホタルイカ', hp: 24, range: 3, spd: 1, gold: 5, shape: 'squid', col: '#7fb0ff', size: 0.95, acts: [{ t: 'atk', v: 4 }, { t: 'ink' }] },
    { id: 'seahorse', name: 'タツノオトシゴ兵', hp: 20, range: 2, spd: 1, gold: 5, shape: 'seahorse', col: '#ffc46b', size: 0.95,
      acts: [{ t: 'heal', v: 7 }, { t: 'atk', v: 3 }], desc: '仲間を回復する。' },
    { id: 'manowar', name: 'カツオノエボシ', hp: 20, range: 0, spd: 1, gold: 5, shape: 'jelly', col: '#c79bff', size: 0.9, crest: true,
      acts: [{ t: 'atkp', v: 3, p: 2 }], onDeath: { id: 'jellyling', n: 2 }, desc: '倒すと2体に分かれる。' },
    { id: 'sawfish', name: 'ノコギリエイ', hp: 32, range: 0, spd: 2, gold: 6, shape: 'ray', col: '#9aa8b8', size: 1.1, saw: true, acts: [{ t: 'atk', v: 8 }] },
    { id: 'barnmaster', name: 'フジツボ使い', hp: 26, range: 4, spd: 1, gold: 6, shape: 'barnacle', col: '#c9c0a8', size: 0.95,
      acts: [{ t: 'barn', n: 3 }, { t: 'atk', v: 3 }], desc: '盤面にフジツボを付ける。' },
    { id: 'orca', name: 'シャチ', hp: 110, range: 0, spd: 2, gold: 22, elite: true, shape: 'orca', col: '#20242c', size: 1.45,
      acts: [{ t: 'atk', v: 11 }, { t: 'atk', v: 6, n: 2 }] },
    { id: 'isopod', name: 'ダイオウグソクムシ', hp: 110, range: 0, spd: 1, gold: 22, elite: true, armor: 3, shape: 'isopod', col: '#c7b9a6', size: 1.4,
      acts: [{ t: 'atk', v: 9 }, { t: 'block', v: 12 }], desc: '硬い殻で受けるダメージ-3。' },
    // 深海
    { id: 'angler', name: 'チョウチンアンコウ', hp: 40, range: 4, spd: 1, gold: 7, shape: 'angler', col: '#5a4a6b', size: 1.05,
      acts: [{ t: 'atk', v: 6 }, { t: 'curse', id: 'sludge', n: 1 }], desc: '光で誘い、ヘドロ玉を混ぜる。' },
    { id: 'goblin', name: 'ミツクリザメ', hp: 50, range: 0, spd: 1, gold: 8, shape: 'shark', col: '#e8b0b8', size: 1.2,
      acts: [{ t: 'leap', n: 2 }, { t: 'atk', v: 13 }], desc: '一気に間合いを詰める。' },
    { id: 'fangtooth', name: 'オニキンメ', hp: 34, range: 0, spd: 2, gold: 7, shape: 'fish', col: '#6b3a4a', size: 0.95, teeth: true, acts: [{ t: 'atk', v: 7 }] },
    { id: 'school', name: '深海魚の群れ', hp: 38, range: 3, spd: 1, gold: 7, shape: 'school', col: '#8fa0c8', size: 1.1,
      acts: [{ t: 'summon', id: 'fryling', n: 1 }, { t: 'atk', v: 4 }], desc: '稚魚を呼ぶ。' },
    { id: 'vent', name: '熱水噴出孔の精', hp: 44, range: 3, spd: 1, gold: 7, shape: 'vent', col: '#ff7a3a', size: 1.05,
      acts: [{ t: 'rocks', n: 3 }, { t: 'atk', v: 6 }], desc: '盤面に岩を置く。' },
    { id: 'ghostjelly', name: 'ユウレイクラゲ', hp: 30, range: 0, spd: 1, gold: 7, shape: 'jelly', col: '#e9f0ff', size: 1, ghost: true,
      acts: [{ t: 'hide' }, { t: 'atkp', v: 6, p: 3 }], desc: '透明になって狙えなくなる。' },
    { id: 'dragonfish', name: 'ホウライエソ', hp: 42, range: 2, spd: 1, gold: 7, shape: 'fish', col: '#2a3a5a', size: 1.05, teeth: true, glow: true,
      acts: [{ t: 'drain', v: 7 }], desc: '攻撃した分だけ回復する。' },
    { id: 'oarfish', name: 'リュウグウノツカイ', hp: 220, range: 3, spd: 1, gold: 28, elite: true, shape: 'oarfish', col: '#d8e0ea', size: 1.5,
      acts: [{ t: 'atk', v: 10 }, { t: 'curse', id: 'rust', n: 1 }, { t: 'atk', v: 7, n: 2 }] },
    { id: 'spidercrab', name: 'タカアシガニ', hp: 240, range: 0, spd: 1, gold: 28, elite: true, armor: 5, shape: 'crab', col: '#e07a4a', size: 1.55, long: true,
      acts: [{ t: 'block', v: 20 }, { t: 'atk', v: 16 }], desc: '硬い殻で受けるダメージ-5。' },
    // 呼ばれる手下
    { id: 'fryling', name: '稚魚', hp: 6, range: 0, spd: 2, gold: 1, minion: true, shape: 'fish', col: '#c8d8f0', size: 0.55, acts: [{ t: 'atk', v: 2 }] },
    { id: 'jellyling', name: '小クラゲ', hp: 8, range: 0, spd: 1, gold: 1, minion: true, shape: 'jelly', col: '#d8b8ff', size: 0.6, acts: [{ t: 'atkp', v: 2, p: 1 }] },
    { id: 'tentacle', name: '触手', hp: 22, range: 1, spd: 0, gold: 2, minion: true, shape: 'tentacle', col: '#c0506a', size: 1, acts: [{ t: 'atk', v: 5 }] },
  ];

  /* ---------- ボス ---------- */
  // phases: 体力の割合が at 以下になると acts が切り替わる。
  D.BOSSES = [
    { id: 'kingcrab', name: '大王ガニ', en: 'KING CRAB', hp: 200, gold: 50, shape: 'crab', col: '#ff5a3c', size: 2.1, crown: true,
      phases: [
        { at: 1, acts: [{ t: 'atk', v: 9 }, { t: 'block', v: 14 }, { t: 'rocks', n: 4 }, { t: 'atk', v: 5, n: 2 }] },
        { at: 0.5, msg: 'ハサミが赤く燃えている!', acts: [{ t: 'atk', v: 12 }, { t: 'rocks', n: 5 }, { t: 'atk', v: 6, n: 2 }, { t: 'block', v: 14 }] },
      ] },
    { id: 'hedgehog', name: '大ハリセンボン', en: 'GREAT PORCUPINE', hp: 185, gold: 50, shape: 'puffer', col: '#f0c060', size: 2.1, spiky: true,
      phases: [
        { at: 1, acts: [{ t: 'spikes', v: 4 }, { t: 'atk', v: 8 }, { t: 'poison', v: 3 }, { t: 'atk', v: 5, n: 2 }] },
        { at: 0.5, msg: '大きくふくらんだ!', acts: [{ t: 'spikes', v: 6 }, { t: 'atk', v: 10 }, { t: 'poison', v: 4 }, { t: 'atk', v: 4, n: 3 }] },
      ] },
    { id: 'umibozu', name: '海坊主', en: 'UMIBOZU', hp: 280, gold: 70, shape: 'blob', col: '#3a4a6a', size: 2.3,
      phases: [
        { at: 1, acts: [{ t: 'ink' }, { t: 'summon', id: 'jellyling', n: 1 }, { t: 'atk', v: 11 }, { t: 'curse', id: 'sludge', n: 1 }] },
        { at: 0.5, msg: '海が荒れはじめた!', acts: [{ t: 'atk', v: 7, n: 2 }, { t: 'summon', id: 'jellyling', n: 1 }, { t: 'ink' }, { t: 'atk', v: 14 }] },
      ] },
    { id: 'kraken', name: '大王イカ', en: 'GIANT SQUID', hp: 270, gold: 70, shape: 'squid', col: '#d0506a', size: 2.3,
      phases: [
        { at: 1, acts: [{ t: 'summon', id: 'tentacle', n: 1 }, { t: 'atk', v: 7, n: 2 }, { t: 'ink' }, { t: 'atk', v: 13 }] },
        { at: 0.5, msg: '触手がうごめく!', acts: [{ t: 'summon', id: 'tentacle', n: 1 }, { t: 'atk', v: 8, n: 2 }, { t: 'atk', v: 15 }, { t: 'ink' }] },
      ] },
    { id: 'leviathan', name: '深海竜リヴァイア', en: 'LEVIATHAN', hp: 400, gold: 90, shape: 'serpent', col: '#3aa0a0', size: 2.4,
      phases: [
        { at: 1, acts: [{ t: 'atk', v: 15 }, { t: 'rocks', n: 4 }, { t: 'block', v: 20 }, { t: 'atk', v: 6, n: 3 }] },
        { at: 0.5, msg: '逆鱗に触れた!', acts: [{ t: 'atk', v: 19 }, { t: 'atk', v: 7, n: 3 }, { t: 'rocks', n: 5 }, { t: 'drain', v: 14 }] },
      ] },
    { id: 'ghostship', name: '幽霊船', en: 'GHOST SHIP', hp: 380, gold: 90, shape: 'ship', col: '#7a8a7a', size: 2.4,
      phases: [
        { at: 1, acts: [{ t: 'curse', id: 'rust', n: 2 }, { t: 'summon', id: 'fryling', n: 2 }, { t: 'atk', v: 14 }, { t: 'drain', v: 11 }] },
        { at: 0.5, msg: '亡霊たちが目を覚ました!', acts: [{ t: 'summon', id: 'fryling', n: 2 }, { t: 'atk', v: 10, n: 2 }, { t: 'curse', id: 'sludge', n: 2 }, { t: 'drain', v: 15 }] },
      ] },
    { id: 'abyss', name: '深淵の主', en: 'THE ABYSSAL ONE', hp: 640, gold: 0, shape: 'eye', col: '#b04cff', size: 2.6, final: true,
      phases: [
        { at: 1, acts: [{ t: 'atk', v: 10 }, { t: 'rocks', n: 4 }, { t: 'summon', id: 'jellyling', n: 1 }, { t: 'block', v: 24 }] },
        { at: 0.6, msg: '深淵が目を見開いた!', moving: true, acts: [{ t: 'atk', v: 6, n: 3 }, { t: 'curse', id: 'sludge', n: 2 }, { t: 'ink' }, { t: 'atk', v: 16 }] },
        { at: 0.25, msg: '海の底が崩れていく!', acts: [{ t: 'atk', v: 7, n: 3 }, { t: 'rocks', n: 5 }, { t: 'drain', v: 14 }, { t: 'atk', v: 19 }] },
      ] },
  ];

  /* ---------- できごと ---------- */
  // run(R, rng) は結果の文を返す。pick を返すと手持ちの玉を選ぶ画面になる。
  D.EVENTS = [
    { id: 'wreck', name: '沈没船', text: '朽ちた沈没船の船倉に、古い宝箱が沈んでいる。',
      choices: [
        { label: '宝箱を開ける', desc: '遺物を得る。罠があるかもしれない', run(R, rng) { GX.randRelic(R, rng, 0); if (rng.chance(0.5)) { GX.hurt(R, 10); return '遺物を手に入れた。だが罠の機雷が爆発した!(体力-10)'; } return '遺物を手に入れた!'; } },
        { label: '立ち去る', desc: '', run() { return '静かにその場を離れた。'; } },
      ] },
    { id: 'mermaid', name: '人魚の歌', text: '岩の上で人魚が歌っている。「貝貨30枚で、あなたの玉を磨いてあげる」',
      choices: [
        { label: '玉を磨いてもらう', desc: '貝貨30 → 玉を1つ強化', cond: R => R.gold >= 30, run(R) { R.gold -= 30; return { text: 'どの玉を磨いてもらおう?', pick: 'upgrade' }; } },
        { label: '歌を聴いて休む', desc: '体力を最大の15%回復', run(R) { GX.heal(R, Math.round(SD.G.maxHp() * 0.15)); return '心地よい歌声に疲れが取れた。'; } },
        { label: '立ち去る', desc: '', run() { return '人魚は少し寂しそうに手を振った。'; } },
      ] },
    { id: 'current', name: '渦巻く海流', text: '強い海流が渦を巻いている。巻き込まれたら、何かを失いそうだ。',
      choices: [
        { label: '身をまかせる', desc: '玉を1つ手放す', run() { return { text: 'どの玉を海流に流す?', pick: 'remove' }; } },
        { label: '逆らって泳ぐ', desc: '体力-6、貝貨+40', run(R) { GX.hurt(R, 6); GX.gold(R, 40); return '流れの底で貝貨を拾った!'; } },
      ] },
    { id: 'hotspring', name: '海底温泉', text: '海底から温かい湯が湧き出している。',
      choices: [
        { label: 'ゆっくり浸かる', desc: '体力を最大の35%回復', run(R) { GX.heal(R, Math.round(SD.G.maxHp() * 0.35)); return '体の芯まで温まった。'; } },
        { label: '湯で玉を磨く', desc: '玉を1つ強化', run() { return { text: 'どの玉を磨く?', pick: 'upgrade' }; } },
      ] },
    { id: 'clam', name: '怪しい大貝', text: '人の背丈ほどもある大貝が、口を少し開けている。',
      choices: [
        { label: '手を入れる', desc: '半々で貝貨+70 か 体力-15', run(R, rng) { if (rng.chance(0.5)) { GX.gold(R, 70); return '中には貝貨がぎっしり!'; } GX.hurt(R, 15); return '貝が閉じた!(体力-15)'; } },
        { label: 'こじ開ける', desc: '体力-5 → 良い玉を1つ', run(R, rng) { GX.hurt(R, 5); const b = GX.randBall(R, rng, 1); return b ? b.name + 'を見つけた!' : '中は空っぽだった。'; } },
        { label: '放っておく', desc: '', run() { return '大貝はゆっくりと口を閉じた。'; } },
      ] },
    { id: 'shrine', name: '海の祠', text: '海藻に覆われた小さな祠がある。何かを捧げれば応えてくれそうだ。',
      choices: [
        { label: '血を捧げる', desc: '最大体力-8 → 良い遺物', run(R, rng) { R.maxHpBonus -= 8; R.hp = Math.min(R.hp, SD.G.maxHp()); GX.randRelic(R, rng, 1); return '祠が光り、遺物が現れた。'; } },
        { label: '貝貨を供える', desc: '貝貨40 → リロール+1、除外+1、体力+10', cond: R => R.gold >= 40, run(R) { R.gold -= 40; R.rerolls++; R.banishes++; GX.heal(R, 10); return '不思議な力が湧いてきた。'; } },
        { label: '立ち去る', desc: '', run() { return '一礼して先へ進んだ。'; } },
      ] },
    { id: 'bottle', name: '漂流瓶', text: '手紙の入った瓶が漂ってきた。',
      choices: [
        { label: '瓶を割る', desc: '良い玉を1つ', run(R, rng) { const b = GX.randBall(R, rng, 1); return b ? '中から' + b.name + 'が出てきた!' : '瓶は空だった。'; } },
        { label: '手紙を読む', desc: '貝貨+25', run(R) { GX.gold(R, 25); return '宝のありかが書いてあった。(貝貨+25)'; } },
      ] },
    { id: 'messenger', name: '竜宮の使い', text: '竜宮城の使いが現れた。「あなたの宝と、竜宮の宝を交換しませんか」',
      choices: [
        { label: '遺物を差し出す', desc: '遺物を1つ失い、稀以上の遺物を得る', cond: R => R.relics.length > 0, run(R, rng) { const lost = GX.loseRandomRelic(R, rng); GX.randRelic(R, rng, 2); return (lost ? lost.name + 'を渡し、' : '') + '竜宮の宝を受け取った!'; } },
        { label: '話だけ聞く', desc: 'リロール+1', run(R) { R.rerolls++; return '竜宮の話は面白かった。(リロール+1)'; } },
      ] },
    { id: 'hook', name: '光る釣り針', text: '上から金色に光る釣り針が垂れ下がっている。',
      choices: [
        { label: 'つかむ', desc: '体力-12 → 稀以上の玉', run(R, rng) { GX.hurt(R, 12); const b = GX.randBall(R, rng, 2); return '針が刺さった!だが' + (b ? b.name : '何か') + 'を手に入れた。'; } },
        { label: '見なかったことにする', desc: '', run() { return '釣られるところだった。'; } },
      ] },
    { id: 'turtle', name: '海亀の背中', text: '大きな海亀が「乗っていくかい」と声をかけてきた。',
      choices: [
        { label: '乗せてもらう', desc: '最大体力+8', run(R) { R.maxHpBonus += 8; GX.heal(R, 8); return '海亀の背中でぐっすり休んだ。(最大体力+8)'; } },
        { label: '甲羅を磨いてあげる', desc: '玉を1つ強化', run() { return { text: 'お礼に、どの玉を強化してもらう?', pick: 'upgrade' }; } },
      ] },
    { id: 'gambler', name: '賭け好きのタコ', text: '8本の腕で貝殻を操るタコが「どの貝に玉が入ってるか当ててみな」と笑う。',
      choices: [
        { label: '賭ける', desc: '貝貨20 → 40%で貝貨+70', cond: R => R.gold >= 20, run(R, rng) { R.gold -= 20; if (rng.chance(0.4)) { GX.gold(R, 70); return '当たり!(貝貨+70)'; } return 'はずれ……。タコが大笑いしている。'; } },
        { label: '腕相撲を挑む', desc: '体力-8、貝貨+45', run(R) { GX.hurt(R, 8); GX.gold(R, 45); return '8本の腕に勝った!(貝貨+45)'; } },
        { label: '断る', desc: '', run() { return '「つまらないねえ」'; } },
      ] },
    { id: 'machine', name: '古代の装置', text: '海底に沈んだ古代の装置が、まだかすかに動いている。',
      choices: [
        { label: '玉を入れてみる', desc: '玉を1つ複製する', run() { return { text: 'どの玉を複製する?', pick: 'copy' }; } },
        { label: '分解する', desc: '貝貨+35', run(R) { GX.gold(R, 35); return '部品を売れそうだ。(貝貨+35)'; } },
      ] },
    { id: 'ghostcrew', name: '幽霊船員', text: '半分透けた船員が、宝の袋を差し出してくる。「持っていけ……そのかわり……」',
      choices: [
        { label: '受け取る', desc: '貝貨+100、錆び玉を1つ得る', run(R) { GX.gold(R, 100); GX.giveBall(R, 'rust'); return '重い袋と、錆びた玉を押しつけられた。'; } },
        { label: '断る', desc: '', run() { return '船員は霧のように消えた。'; } },
      ] },
    { id: 'garden', name: '珊瑚の庭', text: '色とりどりの珊瑚が咲く静かな庭に出た。',
      choices: [
        { label: '珊瑚のかけらを拾う', desc: '体力+12、貝貨+15', run(R) { GX.heal(R, 12); GX.gold(R, 15); return '美しいかけらを手に入れた。'; } },
        { label: '珊瑚玉を探す', desc: '珊瑚玉を1つ得る', run(R) { GX.giveBall(R, 'coral'); return '珊瑚玉を見つけた!'; } },
      ] },
  ];

  /* ---------- 実績 ---------- */
  // test(st, sv) は累計の統計とセーブを見て判定する
  D.ACH = [
    { id: 'first', name: '初陣', desc: '戦闘に初めて勝つ', pearls: 10, test: st => st.battlesWon >= 1 },
    { id: 'boss1', name: '珊瑚礁の主', desc: '浅瀬のボスを倒す', pearls: 20, test: st => st.areaBoss0 >= 1 },
    { id: 'boss2', name: '薄明を越えて', desc: '薄明の海のボスを倒す', pearls: 30, test: st => st.areaBoss1 >= 1 },
    { id: 'boss3', name: '深海の覇者', desc: '深海の谷のボスを倒す', pearls: 40, test: st => st.areaBoss2 >= 1 },
    { id: 'clear', name: '深淵の底へ', desc: '深淵の主を倒してクリアする', pearls: 80, test: st => st.wins >= 1 },
    { id: 'hits50', name: '五十連', desc: '1ショットで50ヒット', pearls: 30, test: st => st.bestHits >= 50 },
    { id: 'hits100', name: '百花繚乱', desc: '1ショットで100ヒット', pearls: 60, test: st => st.bestHits >= 100 },
    { id: 'dmg200', name: '大物狩り', desc: '1ショットで200ダメージ', pearls: 20, test: st => st.bestShot >= 200 },
    { id: 'dmg1000', name: '海割り', desc: '1ショットで1000ダメージ', pearls: 60, test: st => st.bestShot >= 1000 },
    { id: 'poison', name: '毒の海', desc: '毒で敵を累計10体倒す', pearls: 25, test: st => st.poisonKills >= 10 },
    { id: 'bombs', name: '機雷原', desc: '機雷ピンを累計50回爆発させる', pearls: 25, test: st => st.bombs >= 50 },
    { id: 'evolve', name: '進化', desc: '玉を進化させる', pearls: 30, test: st => st.evolves >= 1 },
    { id: 'evolveall', name: '進化の系譜', desc: '7種類すべての進化を見る', pearls: 100, test: (st, sv) => Object.keys(sv.evolved).length >= 7 },
    { id: 'relics10', name: '収集家', desc: '1回のプレイで遺物を10個持つ', pearls: 30, test: st => st.bestRelics >= 10 },
    { id: 'gold300', name: '黄金郷', desc: '貝貨を300枚持つ', pearls: 25, test: st => st.bestGold >= 300 },
    { id: 'allchars', name: '四人の潜り手', desc: '全員でクリアする', pearls: 100, test: st => Object.keys(st.charWins).length >= 4 },
    { id: 'diff5', name: '水圧5', desc: '水圧5以上でクリアする', pearls: 50, test: st => st.bestDiffWin >= 5 },
    { id: 'diff10', name: '水圧10', desc: '水圧10以上でクリアする', pearls: 80, test: st => st.bestDiffWin >= 10 },
    { id: 'diff20', name: '水圧20', desc: '水圧20でクリアする', pearls: 150, test: st => st.bestDiffWin >= 20 },
    { id: 'endless', name: '果てなき深海', desc: 'エンドレスで2周目のボスを倒す', pearls: 60, test: st => st.endlessLoopBoss >= 1 },
    { id: 'daily', name: '今日の潮', desc: 'デイリーチャレンジを遊ぶ', pearls: 15, test: st => st.dailyPlays >= 1 },
    { id: 'flawless', name: '無傷の勝利', desc: 'ボスを無傷で倒す', pearls: 40, test: st => st.flawlessBoss >= 1 },
    { id: 'oneshot', name: '一網打尽', desc: '3体以上の敵を1ショットでまとめて倒す', pearls: 30, test: st => st.multiKill >= 3 },
    { id: 'shots', name: '千の珠', desc: '累計1000ショット', pearls: 40, test: st => st.shots >= 1000 },
    { id: 'crits', name: '会心の嵐', desc: '会心ショットを累計100回', pearls: 20, test: st => st.crits >= 100 },
    { id: 'rich', name: '真珠長者', desc: '真珠を累計1000個集める', pearls: 50, test: (st, sv) => sv.pearlsTotal >= 1000 },
  ];

  /* ---------- 盤面の形 ---------- */
  // 盤面は幅360×高さ470。上の(180,26)から撃つ。返すのは {pegs:[{x,y,mv?}], segs:[[x1,y1,x2,y2]], bumpers:[{x,y,r}]}
  const W = 360, Y0 = 92, Y1 = 432, XL = 22, XR = 338;
  const inside = p => p.x >= XL && p.x <= XR && p.y >= Y0 && p.y <= Y1;
  function thin(rng, pegs, keep) { return pegs.filter(() => rng.next() < keep); }
  D.BOARDS = {
    grid(rng) {
      const pegs = [], sx = rng.int(38, 44), sy = rng.int(36, 42);
      let row = 0;
      for (let y = Y0 + 6; y <= Y1; y += sy, row++) {
        const off = row % 2 ? sx / 2 : 0;
        for (let x = XL + 8 + off; x <= XR; x += sx) pegs.push({ x, y });
      }
      return { pegs: thin(rng, pegs, 0.9) };
    },
    pyramid(rng) {
      const pegs = [], sp = 36, rows = 9;
      for (let r = 0; r < rows; r++) {
        const n = r + 2, y = Y0 + 14 + r * 37;
        for (let i = 0; i < n; i++) pegs.push({ x: W / 2 + (i - (n - 1) / 2) * sp, y });
      }
      for (let y = Y0 + 40; y < Y1; y += 74) { pegs.push({ x: XL + 10, y }); pegs.push({ x: XR - 10, y }); }
      return { pegs: pegs.filter(inside) };
    },
    arcs(rng) {
      const pegs = [], n = 5;
      for (let a = 0; a < n; a++) {
        const cy = Y0 + 20 + a * 70, depth = rng.range(18, 34) * (a % 2 ? -1 : 1);
        for (let i = 0; i < 9; i++) {
          const t = i / 8, x = XL + 20 + t * (XR - XL - 40);
          pegs.push({ x, y: cy + Math.sin(t * Math.PI) * depth });
        }
      }
      for (let i = 0; i < 8; i++) pegs.push({ x: rng.range(XL + 20, XR - 20), y: rng.range(Y0 + 30, Y1 - 20) });
      return { pegs: separate(pegs.filter(inside), 24) };
    },
    clusters(rng) {
      const pegs = [], centers = [];
      for (let tries = 0; centers.length < 7 && tries < 200; tries++) {
        const c = { x: rng.range(XL + 34, XR - 34), y: rng.range(Y0 + 30, Y1 - 30) };
        if (centers.every(o => Math.hypot(o.x - c.x, o.y - c.y) > 92)) centers.push(c);
      }
      for (const c of centers) {
        pegs.push({ x: c.x, y: c.y });
        const rot = rng.range(0, Math.PI);
        for (let i = 0; i < 6; i++) pegs.push({ x: c.x + Math.cos(rot + i * Math.PI / 3) * 23, y: c.y + Math.sin(rot + i * Math.PI / 3) * 23 });
      }
      for (let i = 0; i < 14; i++) pegs.push({ x: rng.range(XL + 10, XR - 10), y: rng.range(Y0, Y1) });
      return { pegs: separate(pegs.filter(inside), 21) };
    },
    diamonds(rng) {
      const pegs = [], s = rng.int(30, 34);
      for (let y = Y0 + 10, r = 0; y <= Y1; y += s * 0.86, r++) {
        for (let x = XL + 12 + (r % 2) * s / 2; x <= XR; x += s) {
          const dx = Math.abs(((x - XL) % (s * 4)) - s * 2), dy = Math.abs(((y - Y0) % (s * 3.4)) - s * 1.7);
          if (dx / (s * 2) + dy / (s * 1.7) < 1.05) pegs.push({ x, y });
        }
      }
      return { pegs: thin(rng, pegs, 0.95) };
    },
    waves(rng) {
      const pegs = [], ph = rng.range(0, 6.28);
      for (let r = 0; r < 8; r++) {
        const y0 = Y0 + 12 + r * 43;
        for (let i = 0; i < 9; i++) {
          const x = XL + 14 + i * 37;
          pegs.push({ x, y: y0 + Math.sin(ph + i * 0.8 + r) * 13 });
        }
      }
      return { pegs: thin(rng, pegs.filter(inside), 0.92) };
    },
    rings(rng) {
      const pegs = [], rings = [{ x: 96, y: 170 }, { x: 264, y: 170 }, { x: 180, y: 300 }, { x: 90, y: 395 }, { x: 270, y: 395 }];
      for (const c of rings) {
        const R = rng.range(36, 46), n = 10;
        for (let i = 0; i < n; i++) pegs.push({ x: c.x + Math.cos(i / n * 6.283) * R, y: c.y + Math.sin(i / n * 6.283) * R });
        pegs.push({ x: c.x, y: c.y });
      }
      for (let i = 0; i < 6; i++) pegs.push({ x: rng.range(XL + 10, XR - 10), y: rng.range(Y0, Y1) });
      return { pegs: separate(pegs.filter(inside), 21) };
    },
    funnel(rng) {
      const pegs = [];
      for (let y = Y0 + 8, r = 0; y < Y1; y += 38, r++) {
        const half = 150 - r * 9;
        for (let x = W / 2 - half; x <= W / 2 + half; x += 36) pegs.push({ x: x + (r % 2) * 18, y });
      }
      const segs = [[XL - 10, 250, 88, 300], [XR + 10, 250, 272, 300]];
      return { pegs: separate(pegs.filter(p => inside(p) && !(p.y > 236 && p.y < 316 && (p.x < 100 || p.x > 260))), 22), segs };
    },
    spiral(rng) {
      const pegs = [], cx = W / 2, cy = 262, turns = 3.2, dir = rng.chance(0.5) ? 1 : -1;
      for (let t = 0.5; t < turns * 6.283; t += 0.36) {
        const r = 8 + t * 8.2;
        pegs.push({ x: cx + Math.cos(t * dir) * r, y: cy + Math.sin(t * dir) * r * 0.98 });
      }
      for (let i = 0; i < 10; i++) pegs.push({ x: rng.range(XL + 10, XR - 10), y: rng.range(Y0, Y1) });
      return { pegs: separate(pegs.filter(inside), 21) };
    },
    moving(rng) {
      const pegs = [];
      for (let r = 0; r < 9; r++) {
        const y = Y0 + 8 + r * 40, moves = r % 2 === 1, amp = moves ? rng.range(18, 30) : 0, w = rng.range(0.7, 1.2) * (r % 4 === 1 ? 1 : -1);
        for (let x = XL + 14 + (r % 2) * 20; x <= XR - 6; x += 40) pegs.push(moves ? { x, y, mv: { ax: amp, w, ph: 0 } } : { x, y });
      }
      return { pegs: thin(rng, pegs, 0.9) };
    },
    bumpers(rng) {
      const g = D.BOARDS.grid(rng);
      const bumpers = [{ x: 90, y: 250, r: 15 }, { x: 270, y: 250, r: 15 }, { x: 180, y: 370, r: 16 }];
      g.pegs = g.pegs.filter(p => bumpers.every(b => Math.hypot(p.x - b.x, p.y - b.y) > b.r + 22));
      g.bumpers = bumpers;
      return g;
    },
  };
  function separate(pegs, min) {
    const out = [];
    for (const p of pegs) if (out.every(o => Math.hypot(o.x - p.x, o.y - p.y) >= min)) out.push(p);
    return out;
  }

  /* ---------- 引きやすくするための索引 ---------- */
  D.ball = {}; for (const b of D.BALLS) D.ball[b.id] = b;
  D.relic = {}; for (const r of D.RELICS) D.relic[r.id] = r;
  D.enemy = {}; for (const e of D.ENEMIES) D.enemy[e.id] = e;
  for (const b of D.BOSSES) { b.boss = true; D.enemy[b.id] = b; }
  D.char = {}; for (const c of D.CHARS) D.char[c.id] = c;
  D.EVOS = D.BALLS.filter(b => b.evo);
})();
