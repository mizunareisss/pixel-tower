import "./style.css";
import { getCardIcon } from "./icons.ts";
import {
  newGame,
  pickStarterPerk,
  gamePlayCard,
  gameSelectTarget,
  gameEndTurn,
  gameDiscardWeapons,
  gameDiscardArmors,
  pickRewardCard,
  skipRewardCard,
  pickRewardPerk,
  pickVitaUp,
  skipRewardPerk,
  continueFromVictory,
  discardAndAdvance,
  applyEnchant,
  skipForge,
  gameSuitPicked,
} from "./game.ts";
import { CARD_DB, STARTING_DECK_IDS } from "./cards.ts";
import { SUIT_SYMBOLS, SUITS, isRedSuit, FIGHTS_PER_FLOOR, STATUS_META, RACES, FRAGMENT_NAMES, FRAGMENT_ICONS,
  ENCHANTS, ENCHANT_NAMES, ENCHANT_DESCS, ENCHANT_RACE, ENCHANT_COST, RACE_NAMES } from "./types.ts";
import type { EnemyRace, EnchantId, Suit } from "./types.ts";
import type { GameState, CardInstance, EnemyState, StatusEffect } from "./types.ts";

const ENEMY_EMOJI: Record<string, string> = {
  "地鼠": "🐭", "哥布林": "👺", "强盗": "🔪", "野狼": "🐺",
  "科博德": "🦎", "骷髅兵": "💀", "哥布林兵": "👹", "兽人首领": "🐗",
  "鼠群成员": "🐀", "食尸鬼": "🧟", "巨魔": "🧌", "黑暗骑士": "⚔️",
};

let state: GameState = newGame();
let _discardUids: Set<string> = new Set();
let _logRenderedLen = 0;
let _prevVita = -1;
let _prevEnemyHps: number[] = [];
let _prevTurn = -1;
let _isProcessingTurn = false;

// Touch detection: add .is-touch to body on first touchstart
if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add("is-touch");
} else {
  window.addEventListener("touchstart", () => {
    document.body.classList.add("is-touch");
  }, { once: true, passive: true });
}

const ONBOARDING_KEY = "pxtower_onboarding_done";
const ONBOARDING_STEPS = [
  {
    title: "① 出牌攻击",
    body: "每回合从手牌打出 1 张攻击牌（♠♦♥♣），配合武器造成伤害。技能牌和道具牌随时可用，回合内可打多张。",
  },
  {
    title: "② 花色相性",
    body: "攻击牌与敌人花色相同 → 伤害 +20%；同色（同为红色或黑色）→ 无加成；不同色 → 伤害 -20%。选对花色事半功倍。",
  },
  {
    title: "③ 装备系统",
    body: "装备牌打出后进入常驻武器/防具槽，同款最多叠 4 张，倍率逐渐提升。武器决定攻击力，防具每回合减伤。",
  },
  {
    title: "④ 牌库与抽卡",
    body: "起始牌库 40 张：21 攻击 + 6 技能 + 6 道具 + 7 基础装备（武器 3 件覆盖 ♦♥♣，防具 4 件四花色齐全）。基础装备只有纯属性，方便前期快速凑同色。每场战斗起手摸 6 张，期望见到 1 张装备。",
  },
  {
    title: "⑤ 战斗奖励池",
    body: "每场战斗胜利从 3 张候选里选 1 张加入牌库。奖励池里有「Build 装备（12 件，带钩子的 buff/特殊机制）+ 技能 + 道具 + 第 3 关解锁的群攻」。Build 武器/防具改变核心打法，也只能从奖励里抽到。回血药水高权重，驱毒剂第 3 关起才推荐。",
  },
  {
    title: "⑥ 特性与碎片",
    body: "特性提供强力被动效果。击败不同种族敌人掉落灵魂碎片，在铁匠铺（每 2 关）用碎片为武器附魔，获得特殊能力。",
  },
  {
    title: "⑦ 爬塔节奏",
    body: "每关 3 场战斗，全部胜利后选 1 张牌进牌库 + 选 1 个特性，HP 补满进下一关。爬得越高，敌人越强，奖励也越丰厚。",
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const $ = (id: string) => document.getElementById(id)!;
const stageEl = $("stage");
const handEl = $("active");          // 复用 #active 为手牌区
const permaEl = $("perks");          // 复用 #perks 为常驻区（武器/防具/特性）
const vitaEl = $("vita-display");
const floorEl = $("floor-display");
const phaseEl = $("phase-display");

function render() {
  const snapVita = state.player.vita;
  const snapEnemyHps = state.battle ? state.battle.enemies.map(e => e.alive ? e.hp : -1) : [];
  const snapTurn = state.battle?.turn ?? -1;

  const inBattle = state.phase === "battle";
  vitaEl.innerHTML = `HP ${state.player.vita} / ${state.player.vitaMax}`;
  vitaEl.style.display = inBattle ? "none" : "";
  floorEl.textContent = `层 ${state.floor === 0 ? "—" : state.floor}`;
  phaseEl.textContent = phaseLabel(state.phase);

  const logBtnEl = document.getElementById("log-btn") as HTMLButtonElement | null;
  if (logBtnEl) {
    logBtnEl.style.display = inBattle ? "" : "none";
    logBtnEl.onclick = openLogOverlay;
  }

  stageEl.innerHTML = "";
  if (state.phase === "starter_perk_picks") renderStarterPerks();
  else if (state.phase === "battle") renderBattle();
  else if (state.phase === "suit_pick") renderSuitPick();
  else if (state.phase === "battle_victory") renderBattleVictory();
  else if (state.phase === "reward_card") renderRewardCard();
  else if (state.phase === "reward_perk") renderRewardPerk();
  else if (state.phase === "discard") renderDiscard();
  else if (state.phase === "forge") renderForge();
  else if (state.phase === "game_over") renderGameOver();

  renderHand();
  renderPermanent();
  renderStatsPanel();
  renderFragments();
  renderNotifBar();

  // Player took damage → vita float
  if (_prevVita >= 0 && snapVita < _prevVita) {
    showFloatDamagePlayer(_prevVita - snapVita);
  }

  // Enemy HP changes → enemy float
  if (snapEnemyHps.length === _prevEnemyHps.length) {
    for (let i = 0; i < snapEnemyHps.length; i++) {
      const prev = _prevEnemyHps[i];
      if (prev > 0 && snapEnemyHps[i] >= 0 && snapEnemyHps[i] < prev) {
        showFloatDamage(i, prev - snapEnemyHps[i]);
      }
    }
  }

  // New battle start → flash (per-turn flash handled by handleEndTurn)
  if (snapTurn === 1 && _prevTurn !== 1) {
    showPhaseFlash("战斗开始");
  }

  _prevVita = snapVita;
  _prevEnemyHps = snapEnemyHps;
  _prevTurn = snapTurn;
}

// ─────────────────────────────────────────────────────────
// 玩家状态芯片点击详情
// ─────────────────────────────────────────────────────────

function showChipDetail(type: "weapon" | "armor" | "perk") {
  if (document.getElementById("status-info-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "status-info-overlay";

  let title = "";
  let content = "";

  if (type === "weapon") {
    const wep = state.player.weapons[0];
    if (!wep) {
      title = "⚔ 武器：徒手";
      content = `<p class="status-info-desc">未装备武器，使用基础攻击。</p>`;
    } else {
      const def = CARD_DB[wep.defId];
      const cnt = state.player.weapons.length;
      const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
      const enchant = state.player.weaponEnchant;
      title = `⚔ ${def.name} ×${cnt}`;
      content = `
        <p class="status-info-desc">${escapeHTML(def.desc)}</p>
        <div class="status-info-stats"><span><b>当前效果：</b>${escapeHTML(eff?.stat ?? eff?.desc ?? "")}</span></div>
        ${enchant ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #333">
          <p class="status-info-desc" style="color:var(--yellow);font-weight:900">⚒ 附魔：${escapeHTML(ENCHANT_NAMES[enchant])}</p>
          <p class="status-info-desc" style="font-size:11px;color:var(--gray)">${escapeHTML(ENCHANT_DESCS[enchant])}</p>
        </div>` : ""}
      `;
    }
  } else if (type === "armor") {
    const arm = state.player.armors[0];
    if (!arm) {
      title = "🛡 防具：无";
      content = `<p class="status-info-desc">未装备防具，无法减伤。</p>`;
    } else {
      const def = CARD_DB[arm.defId];
      const cnt = state.player.armors.length;
      const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
      title = `🛡 ${def.name} ×${cnt}`;
      content = `
        <p class="status-info-desc">${escapeHTML(def.desc)}</p>
        <div class="status-info-stats"><span><b>当前效果：</b>${escapeHTML(eff?.stat ?? eff?.desc ?? "")}</span></div>
      `;
    }
  } else {
    const perkGroups = new Map<string, number>();
    for (const p of state.player.perks) perkGroups.set(p.defId, (perkGroups.get(p.defId) ?? 0) + 1);
    title = `✦ 特性（${state.player.perks.length}）`;
    if (perkGroups.size === 0) {
      content = `<p class="status-info-desc">尚无特性。</p>`;
    } else {
      content = Array.from(perkGroups.entries()).map(([id, cnt]) => {
        const def = CARD_DB[id];
        const eff = def.perkEffect;
        const summary = eff?.summary?.(cnt) ?? eff?.unitDesc ?? def.desc;
        return `<div style="margin-bottom:10px">
          <p class="status-info-desc" style="font-weight:900;margin-bottom:2px">${escapeHTML(def.name)} ×${cnt}</p>
          <p class="status-info-desc" style="font-size:11px;color:var(--gray)">${escapeHTML(summary)}</p>
        </div>`;
      }).join("");
    }
  }

  overlay.innerHTML = `
    <div id="status-info-modal" class="k-neutral">
      <div class="status-info-header">
        <h3>${escapeHTML(title)}</h3>
        <button id="status-info-close">✕</button>
      </div>
      <div class="status-info-body">${content}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("status-info-close")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

// ─────────────────────────────────────────────────────────
// 上手引导（5 步）
// ─────────────────────────────────────────────────────────

function showOnboarding(step = 0) {
  document.getElementById("onboarding-overlay")?.remove();
  const s = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const overlay = document.createElement("div");
  overlay.id = "onboarding-overlay";
  overlay.innerHTML = `
    <div id="onboarding-modal">
      <div class="onboarding-progress">${
        ONBOARDING_STEPS.map((_, i) => `<span class="ob-dot${i <= step ? " done" : ""}"></span>`).join("")
      }</div>
      <div class="onboarding-title">${escapeHTML(s.title)}</div>
      <div class="onboarding-text">${escapeHTML(s.body)}</div>
      <div class="onboarding-footer">
        ${step > 0 ? `<button id="ob-prev-btn" class="skip-btn">上一步</button>` : `<button id="ob-skip-btn" class="skip-btn">跳过</button>`}
        <span class="ob-page">${step + 1} / ${ONBOARDING_STEPS.length}</span>
        ${isLast ? `<button id="ob-done-btn">完成</button>` : `<button id="ob-next-btn">下一步</button>`}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => {
    if (e.target === overlay) {
      overlay.remove();
      localStorage.setItem(ONBOARDING_KEY, "1");
    }
  });
  document.getElementById("ob-prev-btn")?.addEventListener("click", () => showOnboarding(step - 1));
  document.getElementById("ob-next-btn")?.addEventListener("click", () => showOnboarding(step + 1));
  document.getElementById("ob-skip-btn")?.addEventListener("click", () => {
    overlay.remove();
    localStorage.setItem(ONBOARDING_KEY, "1");
  });
  document.getElementById("ob-done-btn")?.addEventListener("click", () => {
    overlay.remove();
    localStorage.setItem(ONBOARDING_KEY, "1");
  });
}

// 渲染玩家灵魂碎片库存（在 header 状态栏）
function renderFragments() {
  let bar = document.getElementById("fragments-bar");
  if (!bar) {
    const wrap = document.getElementById("fragments-wrap");
    if (!wrap) return;
    bar = document.createElement("span");
    bar.id = "fragments-bar";
    bar.title = "击败对应种族敌人掉落，铁匠铺用于武器附魔";
    wrap.appendChild(bar);
    // 一次性 click delegation：点碎片图标 → 弹说明
    bar.addEventListener("click", (e) => {
      const fragEl = (e.target as HTMLElement).closest(".frag") as HTMLElement | null;
      if (!fragEl) return;
      const race = fragEl.getAttribute("data-race") as EnemyRace | null;
      if (race) showFragmentInfo(race);
    });
  }
  const f = state.player.fragments ?? { beast: 0, humanoid: 0, undead: 0, giant: 0, dark: 0 };
  bar.innerHTML = RACES.map(r => {
    const n = f[r] ?? 0;
    if (n === 0) return "";
    return `<span class="frag active" data-race="${r}" title="${FRAGMENT_NAMES[r]}：${n}（点击查看详情）">${FRAGMENT_ICONS[r]}${n}</span>`;
  }).join("");
}

// 碎片详情弹窗
function showFragmentInfo(race: EnemyRace) {
  if (document.getElementById("frag-info-overlay")) return;
  const have = state.player.fragments[race] ?? 0;
  let enchantId: EnchantId | null = null;
  for (const eid of ENCHANTS) if (ENCHANT_RACE[eid] === race) { enchantId = eid; break; }
  const overlay = document.createElement("div");
  overlay.id = "status-info-overlay"; // 复用 status modal 的样式
  overlay.innerHTML = `
    <div id="status-info-modal" class="k-neutral">
      <div class="status-info-header">
        <h3>${FRAGMENT_ICONS[race]} ${FRAGMENT_NAMES[race]}<span class="status-info-kind k-neutral">灵魂碎片</span></h3>
        <button id="status-info-close">✕</button>
      </div>
      <div class="status-info-body">
        <p class="status-info-desc">击败「${RACE_NAMES[race]}」种族的敌人时掉落 1 个。</p>
        ${enchantId ? `<p class="status-info-desc">在铁匠铺消耗 <b>${ENCHANT_COST}</b> 个，可为武器附魔为「<b>${ENCHANT_NAMES[enchantId]}</b>」：</p>
        <p class="status-info-desc"><i>${escapeHTML(ENCHANT_DESCS[enchantId])}</i></p>` : ""}
        <div class="status-info-stats">
          <span><b>当前库存：</b>${have} 个</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  $("status-info-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

function phaseLabel(p: GameState["phase"]) {
  return ({
    starter_perk_picks: `起手选特性（剩 ${state.picksRemaining}）`,
    battle: state.battle ? `第 ${state.floor} 关 · ${state.battleIndex + 1}/${FIGHTS_PER_FLOOR} · 回合 ${state.battle.turn}` : "战斗中",
    battle_victory: "战斗胜利",
    reward_card: "战利品 · 选 1 张牌",
    reward_perk: "通关 · 选 1 张特性",
    discard: "整理卡组",
    forge: "⚒ 铁匠铺",
    game_over: "失败",
    victory: "胜利",
  } as Record<string, string>)[p] || p;
}

// ─────────────────────────────────────────────────────────
// 起手特性
// ─────────────────────────────────────────────────────────

function renderStarterPerks() {
  stageEl.innerHTML = `
    <h2>起始特性：选 ${state.picksRemaining} 个</h2>
    <p class="hint">特性是常驻被动；同款叠加效果增强。</p>
  `;
  const grid = document.createElement("div");
  grid.className = "choice-grid cols-3";
  for (const inst of state.choices) {
    grid.appendChild(renderChoiceCardEl(inst, () => { pickStarterPerk(state, inst.uid); render(); }));
  }
  stageEl.appendChild(grid);
}

// ─────────────────────────────────────────────────────────
// 战斗
// ─────────────────────────────────────────────────────────

function renderBattle() {
  if (!state.battle) return;
  const battle = state.battle;

  const hpPct = Math.round(state.player.vita / state.player.vitaMax * 100);
  stageEl.innerHTML = `
    <div id="enemies-row"></div>
    <div id="player-card">
      <div class="pcard-hp-row">
        <span class="pcard-hp-val">HP ${state.player.vita}/${state.player.vitaMax}</span>
        <div class="pcard-hp-bar"><div class="pcard-hp-fill" style="width:${hpPct}%"></div></div>
      </div>
      <div class="pcard-equip-row" id="pcard-equip"></div>
      <div class="pcard-statuses" id="pcard-statuses"></div>
    </div>
  `;

  const row = $("enemies-row");
  for (let i = 0; i < battle.enemies.length; i++) {
    row.appendChild(renderEnemy(battle.enemies[i], i));
  }

  // Player card — equip row
  const equipRow = $("pcard-equip");
  const wep = state.player.weapons[0];
  const wepSuit = wep ? SUIT_SYMBOLS[CARD_DB[wep.defId].equipSuit!] ?? "" : "";
  const wepLabel = wep
    ? `⚔ ${CARD_DB[wep.defId].name}×${state.player.weapons.length} ${wepSuit}${state.player.weaponEnchant ? " ⚒" + ENCHANT_NAMES[state.player.weaponEnchant] : ""}`
    : "⚔ 徒手";
  const arm = state.player.armors[0];
  const armLabel = arm ? `🛡 ${CARD_DB[arm.defId].name}×${state.player.armors.length}` : "🛡 无防具";
  const perkGroups = new Map<string, number>();
  for (const p of state.player.perks) perkGroups.set(p.defId, (perkGroups.get(p.defId) ?? 0) + 1);
  const perkLabel = Array.from(perkGroups.entries()).map(([id, n]) => `${CARD_DB[id].name}×${n}`).join(" · ");
  equipRow.innerHTML =
    `<span class="bstat-chip" data-chip-type="weapon">${escapeHTML(wepLabel)}</span>` +
    `<span class="bstat-chip" data-chip-type="armor">${escapeHTML(armLabel)}</span>` +
    (perkLabel ? `<span class="bstat-chip" data-chip-type="perk">✦ ${escapeHTML(perkLabel)}</span>` : "");

  // Chip click handlers
  equipRow.querySelectorAll<HTMLElement>("[data-chip-type]").forEach(chip => {
    chip.addEventListener("click", () => {
      const type = chip.getAttribute("data-chip-type") as "weapon" | "armor" | "perk";
      showChipDetail(type);
    });
  });

  // Player card — status row
  const ps = $("pcard-statuses");
  if (state.player.statuses.length === 0) {
    ps.innerHTML = '<span class="status-empty">—</span>';
  } else {
    ps.innerHTML = state.player.statuses.map(s => renderStatusTag(s)).join("");
  }

}

async function handleEndTurn() {
  if (_isProcessingTurn) return;
  _isProcessingTurn = true;
  handEl.classList.add("is-processing");

  // Enemy turn banner (600 ms) — clearly signals NPC phase
  const banner = document.createElement("div");
  banner.className = "enemy-turn-banner";
  banner.innerHTML = `<div class="etb-inner"><span class="etb-title">敌人回合</span><span class="etb-sub">行动中…</span></div>`;
  document.body.appendChild(banner);
  await sleep(600);
  banner.remove();

  // Apply actions; render triggers damage float animations
  gameEndTurn(state);
  render();

  // Hold 900 ms so damage floats complete before "你的回合" flash
  await sleep(900);

  handEl.classList.remove("is-processing");
  if (state.phase === "battle") {
    showPhaseFlash("你的回合", "turn-player");
  }
  _isProcessingTurn = false;
}

function openLogOverlay() {
  if (document.getElementById("log-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "log-overlay";
  const entries = state.log.map(e =>
    `<div class="log-entry nk-${e.kind}">${escapeHTML(e.msg)}</div>`
  ).join("");
  overlay.innerHTML = `
    <div id="log-modal">
      <div class="log-modal-header">
        <span class="panel-label">战斗日志</span>
        <button id="log-close">✕</button>
      </div>
      <div id="log-content">${entries || '<p class="empty">暂无记录</p>'}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const content = document.getElementById("log-content")!;
  content.scrollTop = content.scrollHeight;
  document.getElementById("log-close")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function renderEnemy(e: EnemyState, idx: number): HTMLElement {
  const battle = state.battle!;
  const isTarget = battle.targetIndex === idx && e.alive;
  const isRed = isRedSuit(e.suit);
  const wrap = document.createElement("div");
  const tier = e.tier ?? "normal";
  wrap.className = `enemy-card tier-${tier}${isTarget ? " selected" : ""}${!e.alive ? " dead" : ""}`;
  wrap.setAttribute("data-idx", String(idx));
  if (e.alive) {
    wrap.addEventListener("click", () => { gameSelectTarget(state, idx); render(); });
  }

  const statusTags = e.statuses.map(s => renderStatusTag(s)).join("");
  const weaponBadge = (e.weaponMult ?? 1) > 1 ? `<span class="enemy-equip-badge" title="持有武器（攻击倍率 ×${e.weaponMult!.toFixed(1)}）">⚔×${e.weaponMult!.toFixed(1)}</span>` : "";
  const armorBadge = (e.armor ?? 0) > 0 ? `<span class="enemy-equip-badge armor" title="护甲 ${e.armor}（每次受攻击减伤 ${e.armor}）">🛡${e.armor}</span>` : "";

  const emoji = ENEMY_EMOJI[e.name] ?? "👾";
  wrap.setAttribute("data-suit-symbol", SUIT_SYMBOLS[e.suit]);
  if (isRed) wrap.setAttribute("data-suit-red", "1");
  const raceTag = `<span class="enemy-race-tag" title="${RACE_NAMES[e.race]} · 击败掉 ${FRAGMENT_NAMES[e.race]} 1 枚">${FRAGMENT_ICONS[e.race]} ${RACE_NAMES[e.race]}</span>`;
  // 精英 / Boss 标识
  const tierBadge = tier === "boss"
    ? `<div class="enemy-tier-badge boss" title="${e.eliteAbility ?? "BOSS"}">👑 BOSS</div>`
    : tier === "elite"
      ? `<div class="enemy-tier-badge elite" title="${e.eliteAbility ?? "精英"}">✦ 精英</div>`
      : "";
  wrap.innerHTML = `
    ${tierBadge}
    <div class="enemy-emoji">${emoji}</div>
    <div class="enemy-name">${escapeHTML(e.name)}${weaponBadge}${armorBadge}</div>
    <div class="enemy-race-row">${raceTag}${e.eliteAbility ? `<span class="enemy-ability-tag" title="${e.eliteAbility}">★ ${escapeHTML(e.eliteAbility)}</span>` : ""}</div>
    <div class="enemy-hp-text">HP ${e.hp} / ${e.maxHp}</div>
    ${renderEnemyHpSegments(e.hp, e.maxHp)}
    <div class="enemy-status">${statusTags}</div>
    ${isTarget ? '<div class="target-badge">▼ 目标</div>' : ""}
  `;
  return wrap;
}

// 状态标签（含分色 + tooltip + 点击详情）
function renderStatusTag(s: StatusEffect): string {
  const meta = STATUS_META[s.id];
  const kind = meta?.kind ?? "neutral";
  const name = meta?.name ?? s.name;
  const stacksTxt = s.stacks > 1 ? `×${s.stacks}` : "";
  const durTxt = s.duration > 0 ? ` ${s.duration}回` : "";
  const tooltip = meta?.desc ?? s.name;
  return `<span class="status-tag k-${kind}" data-status-id="${escapeHTML(s.id)}" data-status-stacks="${s.stacks}" data-status-duration="${s.duration}" title="${escapeHTML(tooltip)}（点击查看详情）">${escapeHTML(name)}${stacksTxt}${durTxt}</span>`;
}

// 状态详情弹窗
function showStatusInfo(id: string, stacks: number, duration: number) {
  if (document.getElementById("status-info-overlay")) return;
  const meta = STATUS_META[id];
  if (!meta) return;
  const overlay = document.createElement("div");
  overlay.id = "status-info-overlay";
  const durationText =
    duration === -1 ? "永久（手动消耗或战斗结束清除）" :
    duration > 0   ? `${duration} 回合后到期` :
                     "立即结算";
  overlay.innerHTML = `
    <div id="status-info-modal" class="k-${meta.kind}">
      <div class="status-info-header">
        <h3>${escapeHTML(meta.name)}<span class="status-info-kind k-${meta.kind}">${meta.kind === "buff" ? "增益" : meta.kind === "debuff" ? "负面" : "中性"}</span></h3>
        <button id="status-info-close">✕</button>
      </div>
      <div class="status-info-body">
        <p class="status-info-desc">${escapeHTML(meta.desc)}</p>
        <div class="status-info-stats">
          <span><b>当前层数：</b>×${stacks}</span>
          <span><b>持续：</b>${durationText}</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  $("status-info-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// 全局 click delegation：点击任意状态标签 → 弹详情
document.addEventListener("click", (e) => {
  const tag = (e.target as HTMLElement).closest(".status-tag") as HTMLElement | null;
  if (!tag) return;
  const id = tag.getAttribute("data-status-id");
  if (!id) return;
  const stacks = parseInt(tag.getAttribute("data-status-stacks") || "1");
  const duration = parseInt(tag.getAttribute("data-status-duration") || "0");
  showStatusInfo(id, stacks, duration);
});

function renderEnemyHpSegments(hp: number, maxHp: number): string {
  const SEGS = 10;
  let html = '<div class="enemy-vita-segs">';
  for (let i = 0; i < SEGS; i++) {
    const filled = hp / maxHp > i / SEGS;
    html += `<span class="hp-seg${filled ? "" : " empty"}"></span>`;
  }
  html += "</div>";
  return html;
}

// ─────────────────────────────────────────────────────────
// 动效：通知条 / 浮动伤害 / 阶段闪字
// ─────────────────────────────────────────────────────────

function showBattleToast(msg: string, kind: string = "system") {
  const overlay = document.getElementById("float-overlay");
  if (!overlay) return;
  overlay.querySelectorAll(".battle-toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = `battle-toast nk-${kind}`;
  el.textContent = msg;
  overlay.appendChild(el);
  // Remove when fade-out animation ends
  el.addEventListener("animationend", (ev) => {
    if ((ev as AnimationEvent).animationName === "toast-out") el.remove();
  });
}

function renderNotifBar() {
  const newEntries = state.log.slice(_logRenderedLen);
  _logRenderedLen = state.log.length;
  if (newEntries.length === 0) return;
  const significant = newEntries.filter(e => e.kind !== "system");
  const entry = significant.length > 0
    ? significant[significant.length - 1]
    : newEntries[newEntries.length - 1];
  showBattleToast(entry.msg, entry.kind);
}

function showFloatDamage(enemyIdx: number, delta: number) {
  const overlay = document.getElementById("float-overlay");
  const card = document.querySelector(`.enemy-card[data-idx="${enemyIdx}"]`) as HTMLElement | null;
  if (!overlay || !card) return;
  const rect = card.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "float-damage";
  el.textContent = `-${delta}`;
  el.style.left = `${rect.left + rect.width / 2 - 14}px`;
  el.style.top = `${rect.top + rect.height * 0.2}px`;
  overlay.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function showFloatDamagePlayer(delta: number) {
  const overlay = document.getElementById("float-overlay");
  const vEl = document.getElementById("vita-display");
  if (!overlay || !vEl) return;
  // Pulse the vita display
  vEl.classList.remove("damaged");
  void vEl.offsetWidth;
  vEl.classList.add("damaged");
  setTimeout(() => vEl.classList.remove("damaged"), 500);
  // Float number
  const rect = vEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "float-damage";
  el.textContent = `-${delta}`;
  el.style.left = `${rect.left + rect.width / 2 - 14}px`;
  el.style.top = `${rect.bottom + 4}px`;
  overlay.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function showPhaseFlash(text: string, extraClass?: string) {
  const overlay = document.getElementById("float-overlay");
  if (!overlay) return;
  const el = document.createElement("div");
  el.className = `phase-flash${extraClass ? " " + extraClass : ""}`;
  el.textContent = text;
  overlay.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function renderSuitPick() {
  const action = state.battle?.pendingSuitPick;
  const isResonance = action === "resonance";
  const target = isResonance
    ? (state.battle?.enemies[state.battle.targetIndex] ?? state.battle?.enemies.find(e => e.alive))
    : null;
  const title = isResonance
    ? `共鸣咒：选择 ${escapeHTML(target?.name ?? "目标")} 变为的花色`
    : "染色术：选择本回合攻击牌花色";

  stageEl.innerHTML = `
    <h2>${title}</h2>
    <div id="suit-pick-grid"></div>
  `;
  const grid = $("suit-pick-grid");
  for (const suit of SUITS) {
    const sym = SUIT_SYMBOLS[suit as Suit];
    const isRed = suit === "heart" || suit === "diamond";
    const btn = document.createElement("button");
    btn.className = `suit-pick-btn${isRed ? " red" : ""}`;
    btn.textContent = sym;
    btn.addEventListener("click", () => { gameSuitPicked(state, suit as Suit); render(); });
    grid.appendChild(btn);
  }
}

function renderBattleVictory() {
  stageEl.innerHTML = `
    <h2 class="win">★ 胜利！</h2>
    <p class="hint">敌人已被击败。点击下方按钮领取战利品。</p>
    <button id="claim-reward-btn" class="big-btn">领取奖励</button>
  `;
  $("claim-reward-btn").addEventListener("click", () => { continueFromVictory(state); render(); });
}

// ─────────────────────────────────────────────────────────
// 奖励
// ─────────────────────────────────────────────────────────

function renderRewardCard() {
  stageEl.innerHTML = `
    <h2>战利品：选 1 张牌</h2>
    <p class="hint">选中后这张牌会进入你的牌库（不是手牌）。</p>
  `;
  const grid = document.createElement("div");
  grid.className = "choice-grid cols-3";
  for (const inst of state.choices) {
    grid.appendChild(renderChoiceCardEl(inst, () => { pickRewardCard(state, inst.uid); render(); }));
  }
  stageEl.appendChild(grid);
  const skip = document.createElement("button");
  skip.className = "skip-btn";
  skip.textContent = "跳过";
  skip.addEventListener("click", () => { skipRewardCard(state); render(); });
  stageEl.appendChild(skip);
}

function renderRewardPerk() {
  stageEl.innerHTML = `
    <h2>特性升级：选 1 张特性</h2>
    <p class="hint">通关奖励。HP 已补满。</p>
  `;
  const grid = document.createElement("div");
  grid.className = "choice-grid cols-3";
  for (const inst of state.choices) {
    grid.appendChild(renderChoiceCardEl(inst, () => { pickRewardPerk(state, inst.uid); render(); }));
  }
  // HP 上限选项
  const amt = state.vitaUpAmount ?? 10;
  const vitaUp = document.createElement("div");
  vitaUp.className = "card perk choice vita-up-choice";
  vitaUp.innerHTML = `
    <div class="card-name">⊕ 生命上限 +${amt}</div>
    <div class="card-desc">永久增加 ${amt} 点生命上限。</div>
  `;
  vitaUp.addEventListener("click", () => { pickVitaUp(state); render(); });
  grid.appendChild(vitaUp);
  stageEl.appendChild(grid);

  const skip = document.createElement("button");
  skip.className = "skip-btn";
  skip.textContent = "跳过";
  skip.addEventListener("click", () => { skipRewardPerk(state); render(); });
  stageEl.appendChild(skip);
}

// ─────────────────────────────────────────────────────────
// 整理（弃卡）
// ─────────────────────────────────────────────────────────

function renderDiscard() {
  _discardUids.clear();
  stageEl.innerHTML = `
    <h2>整理卡组（全部牌库 / 装备 / 特性）</h2>
    <p class="hint">点击卡片选中可弃置。<span style="color:var(--green)">绿色边框</span> = 本关新获得；其他 = 起始或之前关卡获得。点「确认」进入下一关。</p>
    <div id="discard-selection-label">已选：<span id="discard-count">0</span> 张</div>
    <div id="discard-cards-wrap"></div>
    <div id="discard-actions">
      <button id="discard-confirm-btn" class="big-btn">确认，进入下一关</button>
    </div>
  `;
  const wrap = $("discard-cards-wrap");
  const sections: Array<{ label: string; cards: CardInstance[] }> = [
    { label: "牌库", cards: state.player.deck },
    { label: "武器", cards: state.player.weapons },
    { label: "防具", cards: state.player.armors },
    { label: "特性", cards: state.player.perks },
  ];
  for (const sec of sections) {
    if (sec.cards.length === 0) continue;
    const heading = document.createElement("div");
    heading.className = "discard-section-label";
    heading.textContent = sec.label;
    wrap.appendChild(heading);
    const row = document.createElement("div");
    row.className = "discard-row";
    for (const inst of sec.cards) {
      const cardEl = renderDiscardCardEl(inst);
      row.appendChild(cardEl);
    }
    wrap.appendChild(row);
  }
  $("discard-confirm-btn").addEventListener("click", () => {
    discardAndAdvance(state, [..._discardUids]);
    _discardUids.clear();
    render();
  });
}

function renderDiscardCardEl(inst: CardInstance): HTMLElement {
  const def = CARD_DB[inst.defId];
  const el = document.createElement("div");
  const isNew = inst.acquiredAtFloor === state.floor;
  el.className = `discard-card cat-${def.category}${isNew ? " new-card" : ""}`;
  el.innerHTML = `
    ${isNew ? '<span class="new-badge">本关新获得</span>' : ''}
    <div class="card-icon card-icon-sm">${getCardIcon(def.id, def.category)}</div>
    <div class="card-name">${escapeHTML(def.name)}</div>
    <div class="card-desc">${escapeHTML(def.desc)}</div>
  `;
  el.addEventListener("click", () => {
    if (_discardUids.has(inst.uid)) _discardUids.delete(inst.uid);
    else _discardUids.add(inst.uid);
    $("discard-count").textContent = String(_discardUids.size);
    el.classList.toggle("selected-discard", _discardUids.has(inst.uid));
  });
  return el;
}

function renderForge() {
  const cur = state.player.weaponEnchant;
  const curWeapon = state.player.weapons[0] ? CARD_DB[state.player.weapons[0].defId].name : "（无武器）";
  stageEl.innerHTML = `
    <h2>⚒ 铁匠铺</h2>
    <p class="hint">使用灵魂碎片为武器附魔（消耗 ${ENCHANT_COST} 同种族碎片）。换附魔会覆盖旧的。</p>
    <div id="forge-current">当前武器：<b>${escapeHTML(curWeapon)}</b>　|　当前附魔：<b>${cur ? escapeHTML(ENCHANT_NAMES[cur]) : "（无）"}</b></div>
    <div id="forge-list"></div>
    <button id="forge-skip-btn" class="big-btn">跳过铁匠铺</button>
  `;
  const list = $("forge-list");
  for (const eid of ENCHANTS) {
    const race = ENCHANT_RACE[eid];
    const have = state.player.fragments[race] ?? 0;
    const enough = have >= ENCHANT_COST;
    const isCurrent = cur === eid;
    const card = document.createElement("div");
    card.className = `forge-card${enough ? " ok" : " disabled"}${isCurrent ? " current" : ""}`;
    card.innerHTML = `
      <div class="forge-name">${escapeHTML(ENCHANT_NAMES[eid])}${isCurrent ? "（已装备）" : ""}</div>
      <div class="forge-desc">${escapeHTML(ENCHANT_DESCS[eid])}</div>
      <div class="forge-cost">需要：${FRAGMENT_ICONS[race]}${FRAGMENT_NAMES[race]} × ${ENCHANT_COST}　|　库存：${have}</div>
      <button class="forge-btn" ${enough ? "" : "disabled"}>${enough ? (isCurrent ? "重新附魔" : "应用") : "碎片不足"}</button>
    `;
    if (enough) {
      card.querySelector("button")!.addEventListener("click", () => {
        applyEnchant(state, eid);
        render();
      });
    }
    list.appendChild(card);
  }
  $("forge-skip-btn").addEventListener("click", () => { skipForge(state); render(); });
}

function renderGameOver() {
  stageEl.innerHTML = `
    <h2 class="lose">✗ 失败</h2>
    <p class="hint">你倒在了第 ${state.floor} 关。</p>
    <button id="new-run-btn" class="big-btn">开启新一局</button>
  `;
  $("new-run-btn").addEventListener("click", () => { state = newGame(); render(); });
}

// ─────────────────────────────────────────────────────────
// 手牌区
// ─────────────────────────────────────────────────────────

function renderHand() {
  handEl.innerHTML = "";
  const endTurnBtn = document.getElementById("end-turn-btn") as HTMLButtonElement | null;
  if (state.phase !== "battle") {
    handEl.innerHTML = '<p class="empty">非战斗中</p>';
    $("active-count").textContent = `${state.player.hand.length} 张`;
    if (endTurnBtn) endTurnBtn.style.display = "none";
    return;
  }
  if (endTurnBtn) {
    endTurnBtn.style.display = "";
    endTurnBtn.disabled = _isProcessingTurn;
    endTurnBtn.onclick = handleEndTurn;
  }
  if (state.player.hand.length === 0) {
    handEl.innerHTML = '<p class="empty">手牌为空</p>';
  } else {
    for (const inst of state.player.hand) {
      handEl.appendChild(renderHandCard(inst));
    }
  }
  $("active-count").textContent = `${state.player.hand.length}/10 张`;
}

function renderHandCard(inst: CardInstance): HTMLElement {
  const def = CARD_DB[inst.defId];
  const el = document.createElement("div");
  const hasRepeatingBow = state.battle?.player.weapons[0]?.defId === "repeating_bow";
  const attackUsed = def.category === "attack" && !!state.battle?.attackedThisTurn && !hasRepeatingBow;
  el.className = `card hand-card cat-${def.category}${attackUsed ? " disabled" : ""}`;
  const suitSym = def.attackSuit ? SUIT_SYMBOLS[def.attackSuit]
    : def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
  if (suitSym) el.setAttribute("data-suit", suitSym);

  let suitTag = "";
  let suitLarge = "";
  if (def.category === "attack") {
    const sym = SUIT_SYMBOLS[def.attackSuit!];
    const isRed = isRedSuit(def.attackSuit!);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${sym}</span>`;
  } else if (def.category === "equipment") {
    const sym = SUIT_SYMBOLS[def.equipSuit!];
    const isRed = isRedSuit(def.equipSuit!);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${sym}</span>`;
    suitLarge = `<span class="card-suit-large${isRed ? " red" : ""}">${sym}</span>`;
  }

  const catTag = `<span class="cat-tag">${categoryLabel(def.category)}</span>`;
  const usedTag = attackUsed ? `<span class="used-tag">本回合已攻击</span>` : "";

  el.innerHTML = `
    ${suitTag}
    <div class="card-icon">${getCardIcon(def.id, def.category)}</div>
    ${suitLarge}
    <div class="card-name">${escapeHTML(def.name)}</div>
    <div class="card-desc">${escapeHTML(def.desc)}</div>
    ${usedTag}
    ${catTag}
  `;
  el.addEventListener("click", () => {
    // 装备牌：换装确认
    if (def.category === "equipment") {
      if (def.equipKind === "weapon" && state.player.weapons.length > 0 && state.player.weapons[0].defId !== def.id) {
        const cur = CARD_DB[state.player.weapons[0].defId].name;
        const cnt = state.player.weapons.length;
        if (!confirm(`当前武器：${cur} ×${cnt}。装备「${def.name}」会弃掉全部 ${cur}，确认替换？`)) return;
        gameDiscardWeapons(state);
      }
      if (def.equipKind === "armor" && state.player.armors.length > 0 && state.player.armors[0].defId !== def.id) {
        const cur = CARD_DB[state.player.armors[0].defId].name;
        const cnt = state.player.armors.length;
        if (!confirm(`当前防具：${cur} ×${cnt}。装备「${def.name}」会弃掉全部 ${cur}，确认替换？`)) return;
        gameDiscardArmors(state);
      }
    }
    if (gamePlayCard(state, inst.uid)) render();
  });
  return el;
}

function categoryLabel(c: string): string {
  return ({ attack: "攻击", skill: "技能", item: "道具", equipment: "装备", perk: "特性" } as any)[c] || c;
}

// ─────────────────────────────────────────────────────────
// 常驻区
// ─────────────────────────────────────────────────────────

function renderPermanent() {
  permaEl.innerHTML = "";

  const sections: Array<{ label: string; cards: CardInstance[]; clearAction?: () => void }> = [
    { label: "武器", cards: state.player.weapons, clearAction: state.phase === "battle" ? () => { gameDiscardWeapons(state); render(); } : undefined },
    { label: "防具", cards: state.player.armors, clearAction: state.phase === "battle" ? () => { gameDiscardArmors(state); render(); } : undefined },
    { label: "特性", cards: state.player.perks },
  ];

  for (const sec of sections) {
    const block = document.createElement("div");
    block.className = "perma-block";
    const head = document.createElement("div");
    head.className = "perma-head";
    head.innerHTML = `<span>${sec.label}</span>`;
    if (sec.clearAction && sec.cards.length > 0) {
      const btn = document.createElement("button");
      btn.className = "small-btn";
      btn.textContent = "全部弃";
      btn.addEventListener("click", sec.clearAction);
      head.appendChild(btn);
    }
    block.appendChild(head);
    if (sec.cards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-inline";
      empty.textContent = "—";
      block.appendChild(empty);
    } else {
      // 武器/防具同款叠加，显示 1 张 + ×N
      if (sec.label === "武器" || sec.label === "防具") {
        const head0 = sec.cards[0];
        const def = CARD_DB[head0.defId];
        const cnt = sec.cards.length;
        const mini = document.createElement("div");
        mini.className = "perma-card";
        const sym = def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
        // 武器附魔徽章
        const enchant = (sec.label === "武器" && state.player.weaponEnchant) ? state.player.weaponEnchant : null;
        const enchantBadge = enchant ? `<span class="perma-enchant" title="附魔：${ENCHANT_NAMES[enchant]}">⚒ ${ENCHANT_NAMES[enchant]}</span>` : "";
        mini.innerHTML = `
          <div class="perma-name">${escapeHTML(def.name)} <span class="perma-stack">×${cnt}</span> ${enchantBadge}</div>
          <div class="perma-desc">${escapeHTML(def.equipEffects?.[Math.min(cnt, 4) - 1].stat ?? def.desc)}</div>
          <div class="perma-suit">${sym}</div>
        `;
        block.appendChild(mini);
      } else {
        // perks：按 defId 聚合，显示当前叠加张数 + 总效果摘要
        const groups = new Map<string, CardInstance[]>();
        for (const c of sec.cards) {
          const arr = groups.get(c.defId) ?? [];
          arr.push(c);
          groups.set(c.defId, arr);
        }
        for (const [defId, arr] of groups) {
          const def = CARD_DB[defId];
          const cnt = arr.length;
          const eff = def.perkEffect;
          const summary = eff?.summary?.(cnt) ?? eff?.unitDesc ?? def.desc;
          const mini = document.createElement("div");
          mini.className = "perma-card";
          mini.innerHTML = `
            <div class="perma-name">${escapeHTML(def.name)} <span class="perma-stack">×${cnt}</span></div>
            <div class="perma-desc">${escapeHTML(summary)}</div>
          `;
          block.appendChild(mini);
        }
      }
    }
    permaEl.appendChild(block);
  }
  $("perks-count").textContent = `${state.player.weapons.length + state.player.armors.length + state.player.perks.length} 件`;

  // Fragments section (show only when any > 0)
  const frags = state.player.fragments;
  const hasFrags = RACES.some(r => (frags[r] ?? 0) > 0);
  if (hasFrags) {
    const fragDiv = document.createElement("div");
    fragDiv.id = "perma-frags";
    fragDiv.innerHTML = `
      <div class="perma-frags-label">灵魂碎片</div>
      <div class="perma-frags-row">${
        RACES.filter(r => (frags[r] ?? 0) > 0)
          .map(r => `<span class="perma-frag-item" data-race="${r}" title="${FRAGMENT_NAMES[r]}：${frags[r]}个（点击查看）">${FRAGMENT_ICONS[r]}${frags[r]}</span>`)
          .join("")
      }</div>
    `;
    fragDiv.querySelectorAll<HTMLElement>(".perma-frag-item").forEach(el => {
      el.addEventListener("click", () => showFragmentInfo(el.getAttribute("data-race") as EnemyRace));
    });
    permaEl.appendChild(fragDiv);
  }
}

// ─────────────────────────────────────────────────────────
// 选择卡（候选）渲染
// ─────────────────────────────────────────────────────────

function renderChoiceCardEl(inst: CardInstance, onClick: () => void): HTMLElement {
  const def = CARD_DB[inst.defId];
  const el = document.createElement("div");
  const rarity = def.rarity ?? "common";
  el.className = `card choice cat-${def.category} rarity-${rarity}`;
  const choiceSuitSym = def.attackSuit ? SUIT_SYMBOLS[def.attackSuit]
    : def.equipSuit ? SUIT_SYMBOLS[def.equipSuit]
    : def.defaultSuit ? SUIT_SYMBOLS[def.defaultSuit] : "";
  if (choiceSuitSym) el.setAttribute("data-suit", choiceSuitSym);
  let suitTag = "";
  let choiceSuitLarge = "";
  if (def.attackSuit) {
    const isRed = isRedSuit(def.attackSuit);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.attackSuit]}</span>`;
  } else if (def.equipSuit) {
    const isRed = isRedSuit(def.equipSuit);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.equipSuit]}</span>`;
    choiceSuitLarge = `<span class="card-suit-large${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.equipSuit]}</span>`;
  } else if (def.defaultSuit) {
    const isRed = isRedSuit(def.defaultSuit);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.defaultSuit]}</span>`;
  }

  // 显示"选了这张之后"的具体效果（按叠加层级）
  let descText = def.desc;
  let stackTag = "";
  if (def.category === "perk" && def.perkEffect) {
    const cur = state.player.perks.filter(p => p.defId === inst.defId).length;
    const next = cur + 1;
    const summary = def.perkEffect.summary?.(next) ?? def.perkEffect.unitDesc;
    descText = `选后总效果：${summary}`;
    if (cur > 0) stackTag = `<span class="stack-future">已有 ×${cur} → ×${next}</span>`;
    else stackTag = `<span class="stack-future">×1</span>`;
  } else if (def.category === "equipment" && def.equipEffects) {
    let cur = 0;
    if (def.equipKind === "weapon") cur = state.player.weapons.filter(w => w.defId === inst.defId).length;
    else if (def.equipKind === "armor") cur = state.player.armors.filter(a => a.defId === inst.defId).length;
    const next = Math.min(cur + 1, 4);
    descText = def.equipEffects[next - 1].desc;
    if (cur > 0) stackTag = `<span class="stack-future">已有 ×${cur} → ×${next}</span>`;
  }

  // 稀有度徽章（只对 rare+ 显示，common 不打扰视觉）
  const rarityBadge = rarity !== "common"
    ? `<span class="rarity-badge rarity-badge-${rarity}">${rarityLabel(rarity)}</span>`
    : "";

  el.innerHTML = `
    ${suitTag}
    ${rarityBadge}
    <div class="card-icon">${getCardIcon(def.id, def.category)}</div>
    ${choiceSuitLarge}
    <div class="card-name">${escapeHTML(def.name)}</div>
    <div class="card-desc">${escapeHTML(descText)}</div>
    ${stackTag}
    <span class="cat-tag">${categoryLabel(def.category)}</span>
  `;
  el.addEventListener("click", onClick);
  return el;
}

function rarityLabel(r: string): string {
  return ({ common: "普通", rare: "稀有", super_rare: "超稀有", epic: "史诗" } as Record<string,string>)[r] ?? r;
}

// ─────────────────────────────────────────────────────────
// 数据面板
// ─────────────────────────────────────────────────────────

function renderStatsPanel() {
  const statsEl = $("stats");
  if (!statsEl) return;
  const lines: string[] = [];

  // 武器
  if (state.player.weapons.length > 0) {
    const w = state.player.weapons[0];
    const def = CARD_DB[w.defId];
    const cnt = state.player.weapons.length;
    const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
    lines.push(`<div class="stats-row"><span>⚔ ${def.name} ×${cnt} → ${escapeHTML(eff?.stat ?? "")}</span></div>`);
  }
  // 防具
  if (state.player.armors.length > 0) {
    const a = state.player.armors[0];
    const def = CARD_DB[a.defId];
    const cnt = state.player.armors.length;
    const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
    lines.push(`<div class="stats-row"><span>🛡 ${def.name} ×${cnt} → ${escapeHTML(eff?.stat ?? "")}</span></div>`);
  }
  // 特性
  const perkGroups = new Map<string, number>();
  for (const p of state.player.perks) perkGroups.set(p.defId, (perkGroups.get(p.defId) ?? 0) + 1);
  for (const [defId, cnt] of perkGroups) {
    const def = CARD_DB[defId];
    const eff = def.perkEffect;
    const summary = eff?.summary?.(cnt) ?? eff?.unitDesc ?? "";
    lines.push(`<div class="stats-row"><span>✦ ${def.name} ×${cnt} → ${escapeHTML(summary)}</span></div>`);
  }

  statsEl.innerHTML = lines.length > 0 ? lines.join("") : '<p class="empty">暂无装备</p>';
}

// ─────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────

function escapeHTML(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

// ─────────────────────────────────────────────────────────
// 重置 / 工作台
// ─────────────────────────────────────────────────────────

// Keep hidden restart-btn listener for legacy compat
$("restart-btn").addEventListener("click", () => {
  state = newGame();
  _logRenderedLen = 0; _prevVita = -1; _prevEnemyHps = []; _prevTurn = -1; _isProcessingTurn = false;
  render();
});

document.getElementById("perma-toggle-btn")?.addEventListener("click", () => {
  const panel = document.getElementById("perks-panel");
  const btn = document.getElementById("perma-toggle-btn");
  if (!panel || !btn) return;
  panel.classList.toggle("open");
  btn.textContent = panel.classList.contains("open") ? "装备▴" : "装备▾";
});

// ─── Hamburger menu ───────────────────────────────────────

function openHamburger() {
  if (document.getElementById("hamburger-menu")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "hamburger-backdrop";
  backdrop.addEventListener("click", closeHamburger);
  document.body.appendChild(backdrop);

  const menu = document.createElement("div");
  menu.id = "hamburger-menu";

  const guideItem = document.createElement("button");
  guideItem.className = "hmenu-item";
  guideItem.innerHTML = "❓&nbsp; 新手引导";
  guideItem.addEventListener("click", () => { closeHamburger(); showOnboarding(0); });

  const codexItem = document.createElement("button");
  codexItem.className = "hmenu-item";
  codexItem.innerHTML = "📖&nbsp; 卡牌图鉴";
  codexItem.addEventListener("click", () => { closeHamburger(); openCodex(); });

  const restartItem = document.createElement("button");
  restartItem.className = "hmenu-item danger";
  restartItem.innerHTML = "↺&nbsp; 重新开始";
  restartItem.addEventListener("click", () => {
    closeHamburger();
    if (confirm("确定要重新开始？当前进度会丢失。")) {
      state = newGame();
      _logRenderedLen = 0; _prevVita = -1; _prevEnemyHps = []; _prevTurn = -1; _isProcessingTurn = false;
      render();
    }
  });

  menu.appendChild(guideItem);
  menu.appendChild(codexItem);
  menu.appendChild(restartItem);
  document.body.appendChild(menu);
}

function closeHamburger() {
  document.getElementById("hamburger-menu")?.remove();
  document.getElementById("hamburger-backdrop")?.remove();
}

document.getElementById("hamburger-btn")?.addEventListener("click", () => {
  if (document.getElementById("hamburger-menu")) closeHamburger();
  else openHamburger();
});

function openCodex() {
  if (document.getElementById("codex-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "codex-overlay";
  overlay.innerHTML = `
    <div id="codex-modal">
      <div id="codex-header">
        <h2>📖 卡牌图鉴</h2>
        <button id="codex-close">✕</button>
      </div>
      <div id="codex-tabs">
        <button class="codex-tab active" data-cat="weapon">武器（10）</button>
        <button class="codex-tab" data-cat="armor">防具（8）</button>
        <button class="codex-tab" data-cat="skill_single">单体技能（22）</button>
        <button class="codex-tab" data-cat="skill_aoe">群攻 · 3关解锁（9）</button>
        <button class="codex-tab" data-cat="item">道具（6）</button>
        <button class="codex-tab" data-cat="perk">特性（13）</button>
        <button class="codex-tab" data-cat="enchant">武器附魔（5）</button>
        <button class="codex-tab" data-cat="attack">攻击牌</button>
      </div>
      <div id="codex-content"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderTab(cat: string) {
    const content = document.getElementById("codex-content");
    if (!content) return;
    const aoeIds = new Set(["sk_chain_bolt", "sk_fire_wall", "sk_shockwave", "sk_group_curse",
                             "sk_sonic", "sk_mass_weak", "sk_lightning", "sk_curse_vortex",
                             "sk_chroma_wave"]);
    if (cat === "enchant") {
      // 渲染 5 种附魔
      content.innerHTML = ENCHANTS.map(eid => {
        const race = ENCHANT_RACE[eid];
        return `
          <div class="codex-card">
            <div class="codex-card-head">
              <span class="codex-card-name">${ENCHANT_NAMES[eid]}</span>
              <span class="codex-cat">附魔 · ${FRAGMENT_ICONS[race]}${FRAGMENT_NAMES[race]} ×${ENCHANT_COST}</span>
            </div>
            <div class="codex-card-desc">${escapeHTML(ENCHANT_DESCS[eid])}</div>
          </div>
        `;
      }).join("");
      return;
    }
    const defs = Object.values(CARD_DB).filter(d => {
      if (cat === "weapon") return d.category === "equipment" && d.equipKind === "weapon";
      if (cat === "armor") return d.category === "equipment" && d.equipKind === "armor";
      if (cat === "skill_single") return d.category === "skill" && !aoeIds.has(d.id);
      if (cat === "skill_aoe") return d.category === "skill" && aoeIds.has(d.id);
      if (cat === "item") return d.category === "item";
      if (cat === "perk") return d.category === "perk";
      if (cat === "attack") return d.category === "attack";
      return false;
    });
    content.innerHTML = defs.map(renderCodexCard).join("") || '<p class="empty">无</p>';
  }

  renderTab("weapon");

  overlay.querySelectorAll<HTMLButtonElement>(".codex-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".codex-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderTab(btn.dataset.cat || "weapon");
    });
  });

  $("codex-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// short_sword 在 newGame() 里直接加入 weapons，不在 STARTING_DECK_IDS 内
const _startingDeckSet = new Set([...STARTING_DECK_IDS, "short_sword"]);

function renderCodexCard(d: import("./types.ts").CardDef): string {
  let suit = "";
  if (d.attackSuit) suit = SUIT_SYMBOLS[d.attackSuit];
  else if (d.equipSuit) suit = SUIT_SYMBOLS[d.equipSuit];
  else if (d.defaultSuit) suit = SUIT_SYMBOLS[d.defaultSuit];

  let stacks = "";
  if (d.equipEffects) {
    stacks = '<div class="codex-stacks">叠加效果：<br>' + d.equipEffects.map((e, i) => `<div>×${i + 1}：${escapeHTML(e.stat ?? e.desc)}</div>`).join("") + "</div>";
  } else if (d.perkEffect) {
    const eff = d.perkEffect;
    const examples = [1, 3, 5, 10].map(s => `<div>×${s}：${escapeHTML(eff.summary?.(s) ?? eff.unitDesc)}</div>`).join("");
    stacks = `<div class="codex-stacks">单位效果（每张）：${escapeHTML(eff.unitDesc)}<br>样例：${examples}</div>`;
  }

  const catBadge = `<span class="codex-cat">${categoryLabel(d.category)}${d.equipKind ? "·" + (d.equipKind === "weapon" ? "武器" : "防具") : ""}</span>`;
  const isStarter = _startingDeckSet.has(d.id);
  const originBadge = isStarter
    ? `<span class="codex-origin starter">基础牌组</span>`
    : `<span class="codex-origin reward">仅奖励获得</span>`;
  const rarity = d.rarity ?? "common";
  const tierBadge = `<span class="codex-origin rarity-${rarity}">${rarityLabel(rarity)}</span>`;

  return `
    <div class="codex-card">
      <div class="codex-card-head">
        <span class="codex-card-name">${escapeHTML(d.name)}</span>
        <span class="codex-card-suit">${suit}</span>
        ${catBadge}
      </div>
      <div class="codex-card-desc">${escapeHTML(d.desc)}</div>
      ${originBadge}${tierBadge}
      ${stacks}
    </div>
  `;
}

$("wb-apply").addEventListener("click", () => {
  const hint = $("wb-hint");
  hint.textContent = "稀有度系统已暂停（v0.8 重构期）。";
  hint.style.color = "#a89880";
});

render();

// Auto-show onboarding on first visit
if (!localStorage.getItem(ONBOARDING_KEY)) {
  showOnboarding(0);
}
