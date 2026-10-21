'use strict';
/* 潮珠 SHIODAMA — 画面のメニュー(DOM)。ゲームの状態を見て、必要なときだけ描き直す。 */
SD.UI = (function () {
  const D = SD.D, G = SD.G;
  const UI = { screen: 'title', overlay: [], charSel: 'nagi', diffSel: 0, modeSel: 'normal', tab: {}, tip: null };
  let root, lastKey = '', toastBox;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const A = n => SD.Audio.sfx(n);

  UI.init = function () {
    root = document.getElementById('ui');
    toastBox = document.getElementById('toasts');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
  };

  /* ---------- 部品 ---------- */
  function ballChip(id, lv, size) {
    const d = D.ball[id];
    return `<span class="ball${d.evo ? ' evo' : ''}${d.curse ? ' curse' : ''}" style="--c:${d.col};--s:${size || 34}px">${esc(d.k)}${lv > 1 ? `<i>${lv}</i>` : ''}</span>`;
  }
  function relicChip(id, size) {
    const r = D.relic[id];
    return `<span class="relic" style="--c:${D.RAR.col[r.rar]};--s:${size || 34}px">${esc(r.k)}</span>`;
  }
  UI.ballChip = ballChip; UI.relicChip = relicChip;
  function rar(r) { return `<span class="rar" style="--c:${D.RAR.col[r]}">${D.RAR.name[r]}</span>`; }
  function ballStats(d, lv) {
    const L = Math.min(lv, d.dmg.length);
    return `<span class="stat">ダメージ <b>${G.ballVal(d, L, 'dmg')}</b> ・ 会心 <b>${G.ballVal(d, L, 'crit')}</b></span>`;
  }
  function ballCard(o, i, section, extra) {
    const d = D.ball[o.id];
    let tag = '', lv = 1;
    if (o.kind === 'evo') { tag = '<em class="tg evo">進化</em>'; }
    else if (o.up) { tag = `<em class="tg up">強化 Lv${o.lv - 1}→${o.lv}</em>`; lv = o.lv; }
    else tag = '<em class="tg new">新しい玉</em>';
    const evoFrom = o.kind === 'evo' ? `<span class="small">${esc(D.ball[d.from].name)} Lv3 + ${esc(D.relic[d.relic].name)}</span>` : '';
    return `<button class="card" data-act="${section}" data-arg="${i}">
      <div class="ch">${ballChip(o.id, lv, 40)}<div><div class="nm">${esc(d.name)} ${rar(d.rar)}</div>${tag}</div></div>
      ${ballStats(d, lv)}<p>${esc(G.ballDesc(d, lv))}</p>${evoFrom}${extra || ''}</button>`;
  }
  function relicCard(id, i, section, extra) {
    const r = D.relic[id];
    const evo = r.evoFor ? `<span class="small">進化のカギ: ${esc(D.ball[r.evoFor].name)}</span>` : '';
    return `<button class="card" data-act="${section}" data-arg="${i}">
      <div class="ch">${relicChip(id, 40)}<div><div class="nm">${esc(r.name)} ${rar(r.rar)}</div></div></div>
      <p>${esc(r.desc)}</p>${evo}${extra || ''}</button>`;
  }
  function hpLine() {
    const R = G.R;
    return `<div class="hpline"><span class="hp">体力 <b>${Math.max(0, R.hp)}</b>/${G.maxHp()}</span><span class="gold">貝貨 <b>${R.gold}</b></span><span class="rr">リロール ${R.rerolls} ・ 除外 ${R.banishes}</span></div>`;
  }
  function backBtn(label) { return `<button class="btn ghost" data-act="back">${label || 'もどる'}</button>`; }
  function pearls() { return `<span class="pearl">${G.save.pearls}</span>`; }

  /* ---------- 画面の組み立て ---------- */
  function viewKey() {
    const R = G.R;
    if (UI.overlay.length) {
      const o = UI.overlay[UI.overlay.length - 1];
      return 'ov:' + o.name + ':' + JSON.stringify(UI.tab) + ':' + (o.arg || '') + ':' + G.save.pearls + ':' + JSON.stringify(G.save.settings) + (R ? R.deck.length + R.relics.length : '');
    }
    if (UI.screen !== 'game' || !R) return 'scr:' + UI.screen + ':' + UI.charSel + UI.diffSel + UI.modeSel + ':' + G.save.pearls + ':' + !!G.save.run;
    if (R.pick) return 'pick:' + JSON.stringify(R.pick) + R.deck.map(b => b.id + b.lv).join();
    switch (R.phase) {
      case 'map': return 'map:' + R.area + ':' + R.pos.r + ':' + R.pos.i + ':' + R.hp + ':' + R.gold + ':' + R.loop;
      case 'battle': return 'battle:' + (UI.tip ? JSON.stringify(UI.tip) : '') + ':' + guideKey();
      case 'reward': return 'reward:' + JSON.stringify(R.reward) + R.rerolls + R.banishes + R.gold;
      case 'shop': return 'shop:' + JSON.stringify(R.shop) + R.gold + R.hp + R.deck.length;
      case 'event': return 'event:' + JSON.stringify(R.event) + R.gold + R.hp;
      case 'rest': return 'rest:' + R.restDone + R.hp;
      case 'result': return 'result:' + JSON.stringify(R.result);
    }
    return 'none';
  }
  UI.sync = function (force) {
    const k = viewKey();
    if (!force && k === lastKey) return;
    lastKey = k;
    render();
  };
  UI.refresh = () => UI.sync(true);

  function render() {
    const R = G.R;
    let html = '', cls = '';
    if (UI.overlay.length) {
      const o = UI.overlay[UI.overlay.length - 1];
      html = (OV[o.name] || (() => ''))(o.arg); cls = 'ov ' + o.name;
    } else if (UI.screen !== 'game' || !R) {
      html = (SCR[UI.screen] || SCR.title)(); cls = UI.screen;
    } else if (R.pick) { html = SCR.pick(); cls = 'pick'; }
    else {
      const f = PH[R.phase];
      html = f ? f() : ''; cls = 'ph-' + R.phase;
    }
    root.innerHTML = html ? `<div class="scr ${cls}">${html}</div>` : '';
    root.classList.toggle('passive', !html || (R && R.phase === 'battle' && !UI.overlay.length && !R.pick && UI.screen === 'game'));
    const sc = root.querySelector('[data-scroll-to]');
    if (sc) sc.scrollIntoView({ block: 'center' });
    for (const c of root.querySelectorAll('canvas[data-creature]')) SD.Render.drawCreatureTo(c, D.enemy[c.dataset.creature]);
    for (const c of root.querySelectorAll('canvas[data-player]')) SD.Render.drawPlayerTo(c, c.dataset.player);
    const f = root.querySelector('[autofocus], .btn.primary, .card, .btn');
    if (f && document.activeElement && !root.contains(document.activeElement) && !UI.noFocus) { try { f.focus({ preventScroll: true }); } catch (e) { } }
  }

  /* ---------- メインの画面 ---------- */
  const SCR = {};
  SCR.title = function () {
    const sv = G.save, has = !!sv.run;
    const day = SD.todayKey(), best = sv.daily[day];
    return `<div class="logo"><div class="pearlbig"></div><h1>潮珠</h1><div class="en">SHIODAMA</div><p>深海ペグ・ローグライト</p></div>
    <div class="menu">
      ${has ? `<button class="btn primary" data-act="resume">つづきから<small>CONTINUE</small></button>` : ''}
      <button class="btn ${has ? '' : 'primary'}" data-act="go" data-arg="charselect">潜る<small>NEW DIVE</small></button>
      <button class="btn" data-act="daily">今日の潮(デイリー)<small>${best ? 'ベスト ' + best : 'DAILY'}</small></button>
      <div class="row3">
        <button class="btn sm" data-act="ov" data-arg="workshop">工房</button>
        <button class="btn sm" data-act="ov" data-arg="codex">図鑑</button>
        <button class="btn sm" data-act="ov" data-arg="ach">実績</button>
        <button class="btn sm" data-act="ov" data-arg="stats">記録</button>
        <button class="btn sm" data-act="ov" data-arg="settings">設定</button>
      </div>
    </div>
    <div class="foot">${pearls()}<span>${SD.storageOk ? '' : '保存できない環境です(遊ぶことはできます)'}</span></div>`;
  };
  SCR.charselect = function () {
    const sv = G.save;
    const cards = D.CHARS.map(c => {
      const ok = G.charUnlocked(c.id), sel = UI.charSel === c.id;
      const clear = sv.clears[c.id];
      return `<button class="charc${sel ? ' sel' : ''}${ok ? '' : ' locked'}" data-act="char" data-arg="${c.id}" style="--c:${c.col}">
        <canvas width="120" height="120" data-player="${c.id}"></canvas>
        <div class="nm">${esc(c.name)}<small>${esc(c.title)}</small></div>
        <div class="small">${ok ? '体力 ' + c.hp + (clear != null ? ' ・ 水圧' + clear + 'クリア' : '') : '工房で解放(真珠 ' + c.cost + ')'}</div></button>`;
    }).join('');
    const ch = D.char[UI.charSel];
    const deck = ch.deck.map(id => ballChip(id, 1, 26)).join('');
    const endlessOk = sv.stats.wins > 0;
    const maxD = sv.maxDiff;
    UI.diffSel = Math.min(UI.diffSel, maxD);
    const dl = D.DIFFS.filter(d => d.lv <= UI.diffSel).map(d => `<li>${d.lv}. ${esc(d.desc)}</li>`).join('');
    return `<div class="panel wide">
      <h2>潜り手をえらぶ<small>DIVER</small></h2>
      <div class="chars">${cards}</div>
      <div class="chardesc"><p>${esc(ch.desc)}</p><div class="deckrow">最初の玉 ${deck}</div></div>
      <div class="opts">
        <div class="seg"><span>モード</span>
          <button class="${UI.modeSel === 'normal' ? 'on' : ''}" data-act="mode" data-arg="normal">通常</button>
          <button class="${UI.modeSel === 'endless' ? 'on' : ''}" data-act="mode" data-arg="endless" ${endlessOk ? '' : 'disabled title="一度クリアすると解放"'}>エンドレス${endlessOk ? '' : '(クリアで解放)'}</button>
        </div>
        <div class="seg"><span>水圧</span>
          <button data-act="diff" data-arg="-1" ${UI.diffSel <= 0 ? 'disabled' : ''}>−</button>
          <b class="dnum">${UI.diffSel}</b>
          <button data-act="diff" data-arg="1" ${UI.diffSel >= maxD ? 'disabled' : ''}>+</button>
          <span class="small">${maxD < 20 ? 'クリアで次の水圧が解放' : '最大'}</span>
        </div>
        ${UI.diffSel > 0 ? `<ul class="dlist">${dl}</ul>` : '<p class="small">水圧0: 基本の難しさ</p>'}
      </div>
      <div class="btnrow">${backBtn()}<button class="btn primary" data-act="start" ${G.charUnlocked(UI.charSel) ? '' : 'disabled'}>潜る</button></div>
    </div>`;
  };
  SCR.pick = function () {
    const R = G.R, pk = R.pick;
    const title = pk.type === 'upgrade' ? '強化する玉をえらぶ' : pk.type === 'remove' ? '手放す玉をえらぶ' : '複製する玉をえらぶ';
    const list = R.deck.map(b => {
      const d = D.ball[b.id];
      const ok = pk.type === 'upgrade' ? G.canUpgrade(b) : pk.type === 'remove' ? R.deck.length > 2 : !d.curse;
      const nx = pk.type === 'upgrade' && ok ? `<span class="small">→ Lv${b.lv + 1}: ${G.ballVal(d, b.lv + 1, 'dmg')}/${G.ballVal(d, b.lv + 1, 'crit')}</span>` : '';
      return `<button class="lrow" data-act="pickball" data-arg="${b.uid}" ${ok ? '' : 'disabled'}>${ballChip(b.id, b.lv, 32)}<div><div class="nm">${esc(d.name)} <small>Lv${b.lv}</small></div>${ballStats(d, b.lv)}${nx}</div></button>`;
    }).join('');
    return `<div class="panel"><h2>${title}</h2>${pk.cost ? `<p class="small">貝貨 ${pk.cost}</p>` : ''}<div class="list">${list}</div>
      <div class="btnrow">${pk.from === 'event' || pk.from === 'shop' || pk.from === 'rest' ? `<button class="btn ghost" data-act="cancelpick">やめる</button>` : ''}</div></div>`;
  };

  /* ---------- プレイ中の場面 ---------- */
  const PH = {};
  PH.map = function () {
    const R = G.R, rows = R.map.rows, av = G.available();
    const area = D.AREAS[Math.min(3, R.area)];
    const RH = 74, H = rows.length * RH + 40;
    let lines = '', nodes = '';
    rows.forEach((row, r) => row.forEach((n, i) => {
      const x = n.x * 100, y = r * RH + 34;
      for (const j of n.next) { const m = rows[r + 1] && rows[r + 1][j]; if (!m) continue; const done = R.visited.includes(R.area + ':' + r + ':' + i) && R.visited.includes(R.area + ':' + (r + 1) + ':' + j); lines += `<line x1="${x}%" y1="${y}" x2="${m.x * 100}%" y2="${(r + 1) * RH + 34}" class="${done ? 'done' : ''}"/>`; }
      const nd = D.NODE[n.type], vis = R.visited.includes(R.area + ':' + r + ':' + i);
      const can = r === R.pos.r + 1 && av.includes(i);
      const here = r === R.pos.r && i === R.pos.i;
      const label = n.type === 'boss' ? esc(D.enemy[R.map.boss].name) : n.type === 'final' ? '深淵の主' : nd.name;
      nodes += `<button class="node t-${n.type}${can ? ' can' : ''}${vis ? ' vis' : ''}${here ? ' here' : ''}" style="left:${x}%;top:${y}px;--c:${nd.col}" ${can ? `data-act="node" data-arg="${i}"` : 'tabindex="-1" disabled'} ${can && !UI._scrolled ? 'data-scroll-to' : ''} aria-label="${label}"><b>${nd.k}</b><span>${label}</span></button>`;
    }));
    const first = !G.save.tutorial.map;
    return `<div class="maphead">${hpLine()}<div class="area"><b>${esc(area.name)}</b><small>${area.en}${R.loop ? ' ・ ' + (R.loop + 1) + '周目' : ''}</small></div></div>
      <div class="mapwrap"><div class="map" style="height:${H}px"><svg width="100%" height="${H}">${lines}</svg>${nodes}</div></div>
      ${first ? `<div class="hint">光っているマスをえらんで進もう。下へ潜るほど、ボスに近づく。</div>` : ''}
      <div class="mapfoot"><button class="btn sm" data-act="ov" data-arg="deck">手持ちの玉 ${R.deck.length}</button><button class="btn sm" data-act="ov" data-arg="relics">遺物 ${R.relics.length}</button><button class="btn sm" data-act="ov" data-arg="pause">メニュー</button></div>`;
  };
  PH.battle = function () {
    let html = '';
    const g = guideKey();
    if (g) html += GUIDES[g]();
    if (UI.tip) html += UI.tip.html;
    return html;
  };
  PH.reward = function () {
    const R = G.R, rw = R.reward;
    const title = rw.kind === 'chest' ? '宝箱' : rw.kind === 'boss' ? 'ボス撃破!' : rw.kind === 'elite' ? '強敵を倒した' : '勝利';
    let html = `<div class="panel"><h2>${title}<small>${rw.gold ? '貝貨 +' + rw.gold : 'REWARD'}</small></h2>${hpLine()}`;
    const banBtn = (sec, i) => R.banishes > 0 ? `<span class="ban" data-act="ban-${sec}" data-arg="${i}" role="button" aria-label="除外">除外</span>` : '';
    if (rw.relics && !rw.relicDone) {
      html += `<h3>遺物をひとつえらぶ</h3><div class="cards">${rw.relics.map((o, i) => relicCard(o.id, i, 'pickrelic', banBtn('relic', i))).join('')}</div>
        <div class="btnrow small"><button class="btn sm" data-act="reroll" data-arg="relic" ${R.rerolls > 0 ? '' : 'disabled'}>リロール(${R.rerolls})</button><button class="btn sm ghost" data-act="skip" data-arg="relic">いらない(貝貨+15)</button></div>`;
    }
    if (rw.balls && !rw.ballDone) {
      html += `<h3>玉をひとつえらぶ</h3><div class="cards">${rw.balls.map((o, i) => ballCard(o, i, 'pickball-r', o.kind === 'evo' ? '' : banBtn('ball', i))).join('')}</div>
        <div class="btnrow small"><button class="btn sm" data-act="reroll" data-arg="ball" ${R.rerolls > 0 ? '' : 'disabled'}>リロール(${R.rerolls})</button><button class="btn sm ghost" data-act="skip" data-arg="ball">いらない(貝貨+8)</button></div>`;
    }
    if (rw.ballDone && rw.relicDone) html += `<div class="btnrow"><button class="btn primary" data-act="rewarddone" autofocus>${rw.loopNext ? 'さらに深く(' + (R.loop + 1) + '周目)' : '先へ進む'}</button></div>`;
    else html += `<p class="small center">「除外」をえらぶと、その候補はこのプレイで二度と出なくなる</p>`;
    return html + '</div>';
  };
  PH.shop = function () {
    const R = G.R, sh = R.shop;
    const item = (it, i, sec) => {
      const can = !it.sold && R.gold >= it.cost;
      const price = it.sold ? '<em class="tg">売り切れ</em>' : `<em class="price${can ? '' : ' no'}">貝貨 ${it.cost}</em>`;
      return sec === 'shopball' ? ballCard({ kind: 'ball', id: it.id, up: false, lv: 1 }, i, it.sold ? 'noop' : sec, price) : relicCard(it.id, i, it.sold ? 'noop' : sec, price);
    };
    const hc = G.healCost(), uc = G.upgradeCost(), rc = G.removeCost();
    return `<div class="panel"><h2>海底の店<small>SHOP</small></h2>${hpLine()}
      <h3>遺物</h3><div class="cards">${sh.relics.map((it, i) => item(it, i, 'shoprelic')).join('') || '<p class="small">品切れ</p>'}</div>
      <h3>玉</h3><div class="cards">${sh.balls.map((it, i) => item(it, i, 'shopball')).join('')}</div>
      <h3>サービス</h3><div class="svc">
        <button class="btn" data-act="svc" data-arg="upgrade" ${R.gold >= uc && R.deck.some(G.canUpgrade) ? '' : 'disabled'}>玉を強化<small>貝貨 ${uc}</small></button>
        <button class="btn" data-act="svc" data-arg="remove" ${R.gold >= rc && R.deck.length > 2 ? '' : 'disabled'}>玉を手放す<small>貝貨 ${rc}</small></button>
        <button class="btn" data-act="svc" data-arg="heal" ${R.gold >= hc && R.hp < G.maxHp() ? '' : 'disabled'}>体力+${D.SHOP.heal.amt}<small>貝貨 ${hc}</small></button>
      </div>
      <div class="btnrow"><button class="btn primary" data-act="leave">店を出る</button></div></div>`;
  };
  PH.event = function () {
    const R = G.R, E = R.event, ev = D.EVENTS.find(e => e.id === E.id);
    let body;
    if (E.result) body = `<p class="evtext">${esc(E.result)}</p><div class="btnrow"><button class="btn primary" data-act="leave" autofocus>先へ進む</button></div>`;
    else body = `<p class="evtext">${esc(ev.text)}</p><div class="choices">${ev.choices.map((c, i) => {
      const ok = !c.cond || c.cond(R);
      return `<button class="btn choice" data-act="evc" data-arg="${i}" ${ok ? '' : 'disabled'}>${esc(c.label)}${c.desc ? `<small>${esc(c.desc)}</small>` : ''}</button>`;
    }).join('')}</div>`;
    return `<div class="panel"><h2>${esc(ev.name)}<small>EVENT</small></h2>${hpLine()}${body}</div>`;
  };
  PH.rest = function () {
    const R = G.R, heal = Math.round(G.maxHp() * D.REST.healPct);
    if (R.restDone) return `<div class="panel"><h2>潮だまり<small>REST</small></h2>${hpLine()}<p class="evtext">ひと息ついた。</p><div class="btnrow"><button class="btn primary" data-act="leave" autofocus>先へ進む</button></div></div>`;
    return `<div class="panel"><h2>潮だまり<small>REST</small></h2>${hpLine()}<p class="evtext">波の穏やかな岩場で、少し休めそうだ。</p>
      <div class="choices"><button class="btn choice" data-act="rest" data-arg="heal">休む<small>体力 +${heal}</small></button>
      <button class="btn choice" data-act="rest" data-arg="upgrade" ${R.deck.some(G.canUpgrade) ? '' : 'disabled'}>玉を磨く<small>玉を1つ強化</small></button></div></div>`;
  };
  PH.result = function () {
    const R = G.R, res = R.result;
    const src = R.st.src, tot = Object.values(src).reduce((a, b) => a + b, 0) || 1;
    const rows = Object.keys(src).sort((a, b) => src[b] - src[a]).slice(0, 12).map(k => {
      const v = src[k], pct = Math.round(v / tot * 100);
      let icon = '', name = '';
      if (k.startsWith('ball:')) { const id = k.slice(5), d = D.ball[id]; icon = ballChip(id, 1, 22); const u = R.st.use[id]; name = d.name + (u ? `<small>${u.shots}発 ・ ${u.hits}ヒット</small>` : ''); }
      else if (k.startsWith('relic:')) { const id = k.slice(6); icon = relicChip(id, 22); name = D.relic[id].name; }
      else if (k === 'bomb') { icon = '<span class="dot" style="--c:#ff8a5c">爆</span>'; name = '機雷ピン<small>' + R.st.bombs + '回爆発</small>'; }
      else if (k === 'poison') { icon = '<span class="dot" style="--c:#d68bff">毒</span>'; name = '毒'; }
      else { icon = '<span class="dot">・</span>'; name = k; }
      return `<div class="brow">${icon}<div class="bn">${name}</div><div class="bar"><i style="width:${pct}%"></i></div><b>${SD.fmt(v)}</b><span>${pct}%</span></div>`;
    }).join('');
    const trig = Object.keys(R.st.tags).filter(k => D.relic[k] && R.relics.includes(k) && !src['relic:' + k]).map(k => `<span class="trig">${relicChip(k, 20)}${esc(D.relic[k].name)} ×${R.st.tags[k]}</span>`).join('');
    const area = D.AREAS[Math.min(3, R.area)];
    return `<div class="panel wide"><h2>${res.win ? '深淵を制した!' : res.abandoned ? '浮上した' : '力尽きた……'}<small>${res.win ? 'CLEAR' : 'RESULT'}</small></h2>
      <div class="resgrid">
        <div><small>到達</small><b>${esc(area.name)}</b></div><div><small>進んだマス</small><b>${R.floors}</b></div>
        <div><small>倒した敵</small><b>${R.kills}</b></div><div><small>時間</small><b>${SD.fmtTime(R.time)}</b></div>
        <div><small>最大ダメージ</small><b>${SD.fmt(R.st.bestShot)}</b></div><div><small>最大ヒット</small><b>${R.st.bestHits}</b></div>
        <div><small>スコア</small><b>${SD.fmt(res.score)}</b></div><div><small>獲得した真珠</small><b class="pearlc">+${res.pearls}</b></div>
      </div>
      ${R.mode === 'daily' ? `<p class="center">${res.newDaily ? '今日のベストを更新!' : '今日のベスト ' + G.save.daily[R.day]}</p>` : ''}
      ${res.win && R.mode !== 'daily' && R.diff + 1 === G.save.maxDiff ? `<p class="center hl">水圧 ${G.save.maxDiff} が解放された!</p>` : ''}
      <h3>活躍の内訳(与えたダメージ)</h3><div class="breakdown">${rows || '<p class="small">記録なし</p>'}</div>
      ${trig ? `<h3>はたらいた遺物</h3><div class="trigs">${trig}</div>` : ''}
      <div class="finaldeck">${R.deck.map(b => ballChip(b.id, b.lv, 24)).join('')}</div>
      <div class="btnrow"><button class="btn" data-act="totitle">タイトルへ</button><button class="btn primary" data-act="again">もう一度潜る</button></div></div>`;
  };

  /* ---------- はじめての操作ガイド ---------- */
  function guideKey() {
    const sv = G.save, B = G.B, R = G.R;
    if (!sv.settings.guide || !B || !R || R.phase !== 'battle') return '';
    if (!sv.tutorial.aim && B.phase === 'aim' && B.shots === 0) return 'aim';
    if (!sv.tutorial.battle && B.phase === 'aim' && B.shots >= 1) return 'battle';
    return '';
  }
  const GUIDES = {
    aim() {
      const touch = SD.Input && SD.Input.touch;
      return `<div class="guide g-aim"><b>${touch ? 'ドラッグで狙って、指を離すと発射' : 'マウスで狙って、クリックで発射'}</b>
        <span>当てたピンの数 × 玉のダメージ が攻撃になる。<br>オレンジの「会」= 会心ピン、黒い機雷は2回当てると爆発。</span>
        <small>${touch ? '上の戦闘の帯まで指を戻して離すと取り消し' : 'キー: ← → で狙い、スペースで発射'}</small></div>`;
    },
    battle() {
      return `<div class="guide g-battle"><b>敵の頭上のマークは、次の行動の予告</b>
        <span>剣と数字は攻撃。← は前進。近づかれる前に倒そう。<br>水色の「戻しピン」に当てると、消えたピンがすべて戻る。</span>
        <small>下の「交換」で次の玉と入れ替えられる ・ 飛んでいる間は押し続けると早送り</small></div>`;
    },
  };

  /* ---------- 重ねて出す画面 ---------- */
  const OV = {};
  OV.pause = function () {
    const R = G.R;
    return `<div class="panel"><h2>メニュー<small>PAUSE</small></h2>
      <div class="menu">
        <button class="btn primary" data-act="back" autofocus>再開</button>
        ${R ? `<button class="btn" data-act="ov" data-arg="deck">手持ちの玉</button><button class="btn" data-act="ov" data-arg="relics">遺物</button>` : ''}
        <button class="btn" data-act="ov" data-arg="settings">設定</button>
        <button class="btn" data-act="ov" data-arg="codex">図鑑</button>
        ${R && R.phase !== 'result' ? `<button class="btn" data-act="suspend">中断してタイトルへ<small>マップから再開できる</small></button><button class="btn danger" data-act="abandon">あきらめる</button>` : ''}
      </div></div>`;
  };
  OV.confirmAbandon = function () {
    return `<div class="panel"><h2>あきらめる?</h2><p>このプレイは終わりになる。獲得した真珠はもらえる。</p>
      <div class="btnrow">${backBtn('やめる')}<button class="btn danger" data-act="abandon2">あきらめる</button></div></div>`;
  };
  OV.deck = function () {
    const R = G.R;
    const list = R.deck.slice().sort((a, b) => a.id < b.id ? -1 : 1).map(b => {
      const d = D.ball[b.id];
      return `<div class="lrow static">${ballChip(b.id, b.lv, 32)}<div><div class="nm">${esc(d.name)} <small>Lv${b.lv} ${rar(d.rar)}</small></div>${ballStats(d, b.lv)}<p>${esc(G.ballDesc(d, b.lv))}</p></div></div>`;
    }).join('');
    const evo = G.evoReady();
    return `<div class="panel"><h2>手持ちの玉<small>${R.deck.length} BALLS</small></h2>${evo.length ? `<p class="hl small">進化できる玉がある! 次の報酬で選べる</p>` : ''}<div class="list">${list}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.relics = function () {
    const R = G.R;
    const list = R.relics.map(id => { const r = D.relic[id]; return `<div class="lrow static">${relicChip(id, 32)}<div><div class="nm">${esc(r.name)} ${rar(r.rar)}</div><p>${esc(r.desc)}</p></div></div>`; }).join('');
    return `<div class="panel"><h2>遺物<small>${R.relics.length} RELICS</small></h2><div class="list">${list || '<p class="small">まだ持っていない</p>'}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.settings = function () {
    const s = G.save.settings;
    const sl = (k, label) => `<label class="slider"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${s[k]}" data-set="${k}"><b>${Math.round(s[k] * 100)}</b></label>`;
    const seg = (k, label, opts) => `<div class="seg"><span>${label}</span>${opts.map(o => `<button class="${s[k] === o[0] ? 'on' : ''}" data-act="set" data-arg="${k}:${o[0]}">${o[1]}</button>`).join('')}</div>`;
    return `<div class="panel"><h2>設定<small>SETTINGS</small></h2>
      ${sl('master', '全体の音量')}${sl('bgm', 'BGM')}${sl('sfx', '効果音')}
      ${seg('quality', '画質', [['high', '高い'], ['low', '軽い']])}
      ${seg('shake', '画面の揺れ', [[1, '標準'], [0.5, '弱く'], [0, 'なし']])}
      ${seg('flash', 'フラッシュ', [[1, '標準'], [0.4, '弱く'], [0, 'なし']])}
      ${seg('speed', '玉の速さ', [[1, '×1'], [1.5, '×1.5'], [2, '×2']])}
      ${seg('aimMode', 'タッチの狙い方', [['direct', '指の方向'], ['drag', '横にずらす']])}
      ${seg('guide', '操作ガイド', [[true, '表示'], [false, '非表示']])}
      <p class="small">「横にずらす」は、指を左右に動かした分だけ狙いが回る(細かく狙える)。</p>
      <div class="btnrow">${backBtn('閉じる')}<button class="btn danger sm" data-act="ov" data-arg="reset">データ消去</button></div></div>`;
  };
  OV.reset = function () {
    return `<div class="panel"><h2>データを消す?</h2><p>真珠・工房・実績・記録がすべて消えて、最初からになる。元には戻せない。</p>
      <div class="btnrow">${backBtn('やめる')}<button class="btn danger" data-act="reset2">消す</button></div></div>`;
  };
  OV.workshop = function () {
    const sv = G.save, tab = UI.tab.ws || 'up';
    let body = '';
    if (tab === 'up') body = D.UPGRADES.map(u => {
      const lv = sv.upgrades[u.id] || 0, max = u.costs.length, cost = u.costs[lv];
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="lrow static"><div class="grow"><div class="nm">${esc(u.name)}</div><p>${esc(u.desc)}</p><div class="pips">${pips}</div></div>
        ${lv >= max ? '<em class="tg">最大</em>' : `<button class="btn sm" data-act="buyup" data-arg="${u.id}" ${sv.pearls >= cost ? '' : 'disabled'}>真珠 ${cost}</button>`}</div>`;
    }).join('');
    else if (tab === 'char') body = D.CHARS.map(c => {
      const ok = sv.unlocked.chars[c.id];
      return `<div class="lrow static"><canvas width="80" height="80" data-player="${c.id}" class="thumb"></canvas><div class="grow"><div class="nm">${esc(c.name)} <small>${esc(c.title)}</small></div><p>${esc(c.desc)}</p></div>
        ${ok ? '<em class="tg">解放ずみ</em>' : `<button class="btn sm" data-act="buychar" data-arg="${c.id}" ${sv.pearls >= c.cost ? '' : 'disabled'}>真珠 ${c.cost}</button>`}</div>`;
    }).join('');
    else {
      const items = D.BALLS.filter(b => b.lock).map(b => ({ kind: 'ball', def: b })).concat(D.RELICS.filter(r => r.lock).map(r => ({ kind: 'relic', def: r })));
      body = items.map(it => {
        const d = it.def, ok = sv.unlocked.items[d.id];
        const chip = it.kind === 'ball' ? ballChip(d.id, 1, 32) : relicChip(d.id, 32);
        return `<div class="lrow static">${chip}<div class="grow"><div class="nm">${esc(d.name)} ${rar(d.rar)}</div><p>${esc(it.kind === 'ball' ? G.ballDesc(d, 1) : d.desc)}</p></div>
          ${ok ? '<em class="tg">解放ずみ</em>' : `<button class="btn sm" data-act="buyitem" data-arg="${it.kind}:${d.id}" ${sv.pearls >= d.lock ? '' : 'disabled'}>真珠 ${d.lock}</button>`}</div>`;
      }).join('');
    }
    return `<div class="panel"><h2>工房<small>WORKSHOP</small></h2><div class="foot top">${pearls()}<span class="small">プレイのたびに真珠がたまる</span></div>
      <div class="tabs"><button class="${tab === 'up' ? 'on' : ''}" data-act="tab" data-arg="ws:up">永久強化</button><button class="${tab === 'char' ? 'on' : ''}" data-act="tab" data-arg="ws:char">潜り手</button><button class="${tab === 'item' ? 'on' : ''}" data-act="tab" data-arg="ws:item">新しい装備</button></div>
      <div class="list">${body}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.codex = function () {
    const sv = G.save, tab = UI.tab.cx || 'ball';
    let body = '';
    if (tab === 'ball') {
      body = D.BALLS.filter(b => !b.evo).map(b => {
        const seen = sv.seen.balls[b.id] || b.curse;
        if (!seen) return `<div class="lrow static unk"><span class="ball unk" style="--s:32px">?</span><div><div class="nm">???</div><p>${b.lock && !sv.unlocked.items[b.id] ? '工房で解放すると出るようになる' : 'まだ見つけていない'}</p></div></div>`;
        return `<div class="lrow static">${ballChip(b.id, 1, 32)}<div><div class="nm">${esc(b.name)} ${b.curse ? '<small>呪い</small>' : rar(b.rar)}</div>
          <span class="stat">Lv1〜3 ダメージ ${b.dmg.join('/')} ・ 会心 ${b.crit.join('/')}</span><p>${esc(G.ballDesc(b, 1))}</p></div></div>`;
      }).join('');
    } else if (tab === 'evo') {
      body = D.EVOS.map(e => {
        const got = sv.evolved[e.id];
        return `<div class="lrow static">${got ? ballChip(e.id, 1, 32) : '<span class="ball unk" style="--s:32px">?</span>'}<div><div class="nm">${got ? esc(e.name) : '???'}</div>
          <p>${esc(D.ball[e.from].name)} を Lv3 にして「${esc(D.relic[e.relic].name)}」を持つと、報酬に進化が出る。</p>${got ? `<p>${esc(e.desc)}</p>` : ''}</div></div>`;
      }).join('');
    } else if (tab === 'relic') {
      body = D.RELICS.map(r => {
        const seen = sv.seen.relics[r.id];
        if (!seen) return `<div class="lrow static unk"><span class="relic unk" style="--s:32px">?</span><div><div class="nm">???</div><p>${r.lock && !sv.unlocked.items[r.id] ? '工房で解放すると出るようになる' : 'まだ見つけていない'}</p></div></div>`;
        return `<div class="lrow static">${relicChip(r.id, 32)}<div><div class="nm">${esc(r.name)} ${rar(r.rar)}</div><p>${esc(r.desc)}</p></div></div>`;
      }).join('');
    } else {
      const list = D.ENEMIES.concat(D.BOSSES);
      body = list.map(e => {
        const seen = sv.seen.enemies[e.id];
        if (!seen) return `<div class="lrow static unk"><span class="thumb unk">?</span><div><div class="nm">???</div></div></div>`;
        return `<div class="lrow static"><canvas width="72" height="72" class="thumb" data-creature="${e.id}"></canvas><div><div class="nm">${esc(e.name)} ${e.boss ? '<small>ボス</small>' : e.elite ? '<small>強敵</small>' : ''}</div>
          <p>体力 ${e.hp}${e.armor ? ' ・ 甲羅 ' + e.armor : ''}${e.desc ? ' ・ ' + esc(e.desc) : ''}</p></div></div>`;
      }).join('');
    }
    const cnt = (o, f) => Object.keys(o).filter(f || (() => true)).length;
    return `<div class="panel"><h2>図鑑<small>CODEX</small></h2>
      <div class="tabs"><button class="${tab === 'ball' ? 'on' : ''}" data-act="tab" data-arg="cx:ball">玉 ${cnt(sv.seen.balls, k => !D.ball[k].evo)}/${D.BALLS.filter(b => !b.evo).length}</button><button class="${tab === 'evo' ? 'on' : ''}" data-act="tab" data-arg="cx:evo">進化 ${cnt(sv.evolved)}/${D.EVOS.length}</button><button class="${tab === 'relic' ? 'on' : ''}" data-act="tab" data-arg="cx:relic">遺物 ${cnt(sv.seen.relics)}/${D.RELICS.length}</button><button class="${tab === 'enemy' ? 'on' : ''}" data-act="tab" data-arg="cx:enemy">海の生き物</button></div>
      <div class="list">${body}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.ach = function () {
    const sv = G.save, n = Object.keys(sv.ach).length;
    const list = D.ACH.map(a => `<div class="lrow static${sv.ach[a.id] ? ' got' : ''}"><span class="medal">${sv.ach[a.id] ? '★' : '☆'}</span><div class="grow"><div class="nm">${esc(a.name)}</div><p>${esc(a.desc)}</p></div><em class="tg">真珠 ${a.pearls}</em></div>`).join('');
    return `<div class="panel"><h2>実績<small>${n} / ${D.ACH.length}</small></h2><div class="list">${list}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.stats = function () {
    const sv = G.save, st = sv.stats;
    const rows = [
      ['潜った回数', st.runs], ['クリア', st.wins], ['いちばん深く(マス)', st.bestFloor], ['ベストスコア', SD.fmt(st.bestScore)],
      ['1ショットの最大ダメージ', SD.fmt(st.bestShot)], ['1ショットの最大ヒット', st.bestHits], ['クリアした最高水圧', st.bestDiffWin < 0 ? '—' : st.bestDiffWin],
      ['エンドレスの最高(マス)', sv.endlessBest], ['累計ショット', SD.fmt(st.shots)], ['累計ヒット', SD.fmt(st.pegs)], ['累計ダメージ', SD.fmt(st.damage)],
      ['倒した敵', SD.fmt(st.kills)], ['倒したボス', st.bossKills], ['機雷の爆発', st.bombs], ['会心ショット', st.crits], ['盤面が戻った回数', st.refresh],
      ['集めた貝貨', SD.fmt(st.gold)], ['集めた真珠(累計)', SD.fmt(sv.pearlsTotal)], ['遊んだ時間', SD.fmtTime(st.playTime)], ['デイリーに挑んだ回数', st.dailyPlays],
    ];
    const cw = D.CHARS.map(c => `<span>${esc(c.name)} ${st.charWins[c.id] || 0}勝</span>`).join('');
    return `<div class="panel"><h2>記録<small>RECORDS</small></h2><div class="stats">${rows.map(r => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>
      <div class="cwins">${cw}</div><div class="btnrow">${backBtn('閉じる')}</div></div>`;
  };
  OV.info = function (arg) { return `<div class="panel">${arg}<div class="btnrow">${backBtn('閉じる')}</div></div>`; };

  /* ---------- 操作 ---------- */
  function push(name, arg) { UI.overlay.push({ name, arg }); UI.refresh(); }
  UI.push = push;
  UI.pop = function () { UI.overlay.pop(); UI.refresh(); };
  const ACT = {
    back() { A('back'); UI.pop(); },
    ov(arg) { push(arg); },
    go(arg) { UI.screen = arg; UI.refresh(); },
    tab(arg) { const [k, v] = arg.split(':'); UI.tab[k] = v; UI.refresh(); },
    resume() { if (G.resumeRun()) { UI.screen = 'game'; SD.Main.onRunStart(); UI.refresh(); } },
    daily() { SD.Main.startRun({ mode: 'daily' }); },
    char(arg) { UI.charSel = arg; UI.refresh(); },
    mode(arg) { UI.modeSel = arg; UI.refresh(); },
    diff(arg) { UI.diffSel = SD.clamp(UI.diffSel + (+arg), 0, G.save.maxDiff); UI.refresh(); },
    start() { if (!G.charUnlocked(UI.charSel)) return; SD.Main.startRun({ charId: UI.charSel, diff: UI.diffSel, mode: UI.modeSel }); },
    node(arg) { UI._scrolled = false; if (!G.save.tutorial.map) { G.save.tutorial.map = true; G.persist(); } A('select'); G.chooseNode(+arg); SD.Main.onPhase(); UI.refresh(); },
    'pickrelic'(arg) { G.rewardPick('relic', +arg); UI.refresh(); },
    'pickball-r'(arg) { G.rewardPick('ball', +arg); UI.refresh(); },
    'ban-ball'(arg) { if (G.rewardBanish('ball', +arg)) A('back'); UI.refresh(); },
    'ban-relic'(arg) { if (G.rewardBanish('relic', +arg)) A('back'); UI.refresh(); },
    reroll(arg) { if (G.rewardReroll(arg)) A('swap'); UI.refresh(); },
    skip(arg) { G.rewardSkip(arg); UI.refresh(); },
    rewarddone() { A('select'); G.rewardFinish(); SD.Main.onPhase(); UI.refresh(); },
    shopball(arg) { G.shopBuy('ball', +arg); UI.refresh(); },
    shoprelic(arg) { G.shopBuy('relic', +arg); UI.refresh(); },
    svc(arg) { G.shopService(arg); UI.refresh(); },
    noop() { },
    leave() { A('select'); G.continueMap(); SD.Main.onPhase(); UI.refresh(); },
    evc(arg) { G.eventChoose(+arg); UI.refresh(); },
    rest(arg) { G.restChoose(arg); UI.refresh(); },
    pickball(arg) { G.pickBall(+arg); UI.refresh(); },
    cancelpick() { G.cancelPick(); UI.refresh(); },
    suspend() { G.suspendRun(); G.R = null; G.B = null; UI.overlay = []; UI.screen = 'title'; SD.Main.onTitle(); UI.refresh(); },
    abandon() { push('confirmAbandon'); },
    abandon2() { UI.overlay = []; G.abandonRun(); SD.Main.onPhase(); UI.refresh(); },
    totitle() { G.R = null; G.B = null; UI.screen = 'title'; SD.Main.onTitle(); UI.refresh(); },
    again() { const R = G.R; const o = R ? { charId: R.mode === 'daily' ? UI.charSel : R.charId, diff: R.mode === 'daily' ? UI.diffSel : R.diff, mode: R.mode === 'daily' ? 'normal' : R.mode } : {}; G.R = null; UI.screen = 'charselect'; if (o.charId) { UI.charSel = o.charId; UI.diffSel = Math.min(o.diff, G.save.maxDiff); UI.modeSel = o.mode; } SD.Main.onTitle(); UI.refresh(); },
    set(arg) {
      const [k, v] = arg.split(':');
      const s = G.save.settings;
      s[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
      G.persist(); SD.Main.applySettings(); UI.refresh();
    },
    reset2() { try { localStorage.removeItem(SD.SAVE_KEY); } catch (e) { } G.init(); G.R = null; G.B = null; UI.overlay = []; UI.screen = 'title'; SD.Main.applySettings(); SD.Main.onTitle(); UI.refresh(); },
    buyup(arg) { if (G.buyUpgrade(arg)) A('buy'); UI.refresh(); },
    buychar(arg) { if (G.buyChar(arg)) A('buy'); UI.refresh(); },
    buyitem(arg) { const [k, id] = arg.split(':'); if (G.buyItem(k, id)) A('buy'); UI.refresh(); },
    guide(arg) { G.save.tutorial[arg] = true; G.persist(); UI.refresh(); },
    tipclose() { UI.tip = null; UI.refresh(); },
  };
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !root.contains(el)) return;
    e.stopPropagation();
    const name = el.dataset.act, arg = el.dataset.arg;
    if (name !== 'back' && name !== 'noop') A('click');
    SD.Audio.unlock();
    if (ACT[name]) ACT[name](arg, el);
  }
  function onInput(e) {
    const el = e.target;
    if (!el.dataset.set) return;
    G.save.settings[el.dataset.set] = +el.value;
    const b = el.parentNode.querySelector('b'); if (b) b.textContent = Math.round(el.value * 100);
    SD.Main.applySettings();
    G.persist();
  }

  /* ---------- 戦闘中の説明(敵や玉をタップしたとき) ---------- */
  function describeIntent(e) {
    const it = e.intent; if (!it) return '';
    const n = it.n > 1 ? ' ×' + it.n : '';
    switch (it.t) {
      case 'move': return '前進する';
      case 'leap': return '一気に' + (it.n + 1) + 'マス詰めてくる';
      case 'frozen': return '凍っていて動けない';
      case 'atk': return (it.lunge ? '近づいて' : '') + it.dmg + 'ダメージの攻撃' + n;
      case 'atkp': return (it.lunge ? '近づいて' : '') + it.dmg + 'ダメージ+毒' + it.p;
      case 'explode': return (it.lunge ? '近づいて' : '') + '自爆して' + it.dmg + 'ダメージ';
      case 'drain': return it.dmg + 'ダメージを与えて、その分回復';
      case 'block': return '防御 +' + it.v;
      case 'heal': return '仲間を' + it.v + '回復';
      case 'summon': return D.enemy[it.id].name + 'を呼ぶ';
      case 'rocks': return '盤面に岩を' + it.n + '個置く';
      case 'barn': return 'ピン' + it.n + '個にフジツボを付ける';
      case 'curse': return D.ball[it.id].name + 'を玉に混ぜる';
      case 'poison': return '毒' + it.v + 'を吐く';
      case 'ink': return '墨で狙いの線を隠す';
      case 'hide': return '隠れて狙えなくなる';
      case 'spikes': return 'トゲを出す(攻撃すると' + it.v + 'ダメージ返し)';
    }
    return '';
  }
  UI.showEnemy = function (uid) {
    const B = G.B; const e = B && B.enemies.find(o => o.uid === uid);
    if (!e) return;
    const st = [];
    if (e.block) st.push('防御 ' + e.block);
    if (e.armor) st.push('甲羅 ' + e.armor + '(受けるダメージ-' + e.armor + ')');
    if (e.poison) st.push('毒 ' + e.poison);
    if (e.freeze) st.push('凍結');
    if (e.hidden) st.push('隠れている');
    UI.tip = { uid, html: `<div class="tip" data-act="tipclose"><canvas width="64" height="64" data-creature="${e.def.id}"></canvas><div><b>${esc(e.def.name)}</b> <small>体力 ${e.hp}/${e.maxHp}</small><p>次: ${esc(describeIntent(e))}</p>${e.def.desc ? `<p class="small">${esc(e.def.desc)}</p>` : ''}${st.length ? `<p class="small">${st.join(' ・ ')}</p>` : ''}</div></div>` };
    UI.refresh();
  };
  UI.showBall = function () {
    const B = G.B; if (!B || !B.cur) return;
    const d = D.ball[B.cur.id], lv = B.cur.lv;
    UI.tip = { html: `<div class="tip" data-act="tipclose">${ballChip(d.id, lv, 40)}<div><b>${esc(d.name)}</b> <small>Lv${lv}</small><p>${ballStats(d, lv)}</p><p class="small">${esc(G.ballDesc(d, lv))}</p></div></div>` };
    UI.refresh();
  };

  /* ---------- 通知 ---------- */
  UI.toast = function (html) {
    const el = document.createElement('div');
    el.className = 'toast'; el.innerHTML = html;
    toastBox.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  };
  UI.drainToasts = function () {
    while (G.toasts.length) {
      const t = G.toasts.shift();
      if (t.kind === 'ach') { const a = D.ACH.find(x => x.id === t.id); UI.toast(`<b>実績: ${esc(a.name)}</b><span>${esc(a.desc)} ・ 真珠 +${a.pearls}</span>`); }
    }
  };

  return UI;
})();
