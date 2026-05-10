import "./style.css";
import { getCardIcon } from "./icons.ts";
import {
  playSlashHit, playSkillBurst, playDebuffApply, playBuffApply,
  playHealSparkle, playAoeWave, playPlayerHit, playEquip, playDodgeMiss,
} from "./animations.ts";
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
  gameSuitPickCanceled,
  releaseSuitUltimate,
  setActiveSpecialty,
  epicReplacementChoose,
  epicReplacementSkip,
  applyForgeRecolor,
  skipFloorEvent,
  merchantBuyCardMixed,
  merchantTradeFragments,
  merchantLeave,
  gamblerBet,
  shrineSacrifice,
  wizardPick,
  chestOpen,
  discardHandCards,
  enterMapNode,
} from "./game.ts";
import { CARD_DB, STARTING_DECK_IDS } from "./cards.ts";
import { ABILITY_DESCS } from "./enemies.ts";
import { getCurrentDodgeChance, getSuitAffinity, suitTier, getActiveSpecialty, getDisplayedSpecialty, getTiedSpecialties } from "./battle.ts";
import {
  EVENT_META, MERCHANT_PRICES, GAMBLER_OPTIONS, SHRINE_OPTIONS, CHEST_TRAP_DESCS,
} from "./events.ts";
import type { EventId } from "./events.ts";
import { NODE_TYPE_META, getReachableNodes } from "./map.ts";
import { SUIT_SYMBOLS, SUITS, isRedSuit, FIGHTS_PER_FLOOR, STATUS_META, RACES, FRAGMENT_NAMES, FRAGMENT_ICONS,
  ENCHANTS, ENCHANT_NAMES, ENCHANT_DESCS, ENCHANT_RECIPES, RACE_NAMES, isRareRace,
  SUIT_TIER_NAMES, SUIT_TIER_DESCS, SUIT_THEMES } from "./types.ts";
import type { EnemyRace, Suit, EnchantId } from "./types.ts";
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
    body: "攻击牌与敌人花色相同 → 伤害 +20%；同色（同为红色或黑色）→ 无加成；不同色 → 伤害 -20%。",
  },
  {
    title: "③ 装备系统",
    body: "装备牌打出后进入常驻武器/防具槽，同款最多叠 4 张，倍率逐渐提升。武器决定攻击力，防具每回合减伤。",
  },
  {
    title: "④ 牌库与战利品",
    body: "每场战斗起手摸 6 张牌。胜利可选 1 张新牌加入牌库；通关再选 1 个特性。",
  },
  {
    title: "⑤ 花色专精",
    body: "♠ 堆伤 / ♦ 闪避 / ♥ 续航 / ♣ 减伤——4 花色各有路线。装备、特性、染色 / 持咒 / 染坊和打出的攻击牌都会累积亲和度，达 5 / 10 / 15 解锁三档被动 + 大招。同一时间只激活一条最高花色。点 HP 条下方的花色芯片查看 4 花色对比面板。",
  },
  {
    title: "⑥ 特性 · 碎片 · 附魔",
    body: "特性是常驻被动，每关末获得 1 张。击败不同种族敌人掉灵魂碎片，去铁匠铺给武器附魔——单种族 ×3 或两种族 ×2+×2，搭配出 13 种附魔。",
  },
  {
    title: "⑦ 大地图 · 选择路线",
    body: "每关一张分支地图，节点上的种族 emoji 提示战斗会掉哪种碎片——根据你想做的附魔 / build 主动选路线。事件、铁匠铺、商店都是节点。",
  },
  {
    title: "⑧ 爬塔节奏",
    body: "每关 3 场战斗，最后一场是精英或 Boss。通关后 HP 补满进下一关。第 3/6/9 关是 Boss 关。",
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
  else if (state.phase === "floor_event") renderFloorEvent();
  else if (state.phase === "floor_map") renderFloorMap();
  else if (state.phase === "game_over") renderGameOver();

  renderHand();
  renderPermanent();
  renderStatsPanel();
  renderFragments();
  renderNotifBar();

  // 事件结果对话框（如果有 pending result，弹出，玩家点确认后清掉）
  if (state.eventResult && !document.getElementById("event-result-overlay")) {
    showEventResultModal();
  }

  // 史诗装备耗尽 → 替换装备 modal（战斗结束/选完后自动清理残留）
  if (state.battle?.pendingEpicReplacement) {
    if (!document.getElementById("epic-replace-overlay")) showEpicReplacementModal();
  } else {
    document.getElementById("epic-replace-overlay")?.remove();
  }

  // Player took damage → vita float + 受击动效
  if (_prevVita >= 0 && snapVita < _prevVita) {
    showFloatDamagePlayer(_prevVita - snapVita);
    const playerArea = document.querySelector("#player-card") as HTMLElement | null;
    if (playerArea) playPlayerHit(playerArea);
  }

  // 闪避动效信号（battle.ts 设置 pendingDodgeFx，这里消费）
  if (state.battle?.pendingDodgeFx && state.battle.pendingDodgeFx > 0) {
    const playerArea = document.querySelector("#player-card") as HTMLElement | null;
    if (playerArea) playDodgeMiss(playerArea);
    state.battle.pendingDodgeFx = 0;
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
      const sym = def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
      title = `⚔ ${def.name} ${sym} ×${cnt}`;
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
      const sym = def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
      title = `🛡 ${def.name} ${sym} ×${cnt}`;
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
// 上手引导
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

// 碎片详情弹窗：列出所有用到该种族的附魔（v2 配方系统）
function showFragmentInfo(race: EnemyRace) {
  if (document.getElementById("frag-info-overlay")) return;
  const have = state.player.fragments[race] ?? 0;
  // 找出所有配方含该种族的附魔
  const usedIn = ENCHANTS.filter(eid => (ENCHANT_RECIPES[eid].cost[race] ?? 0) > 0);
  const enchantList = usedIn.map(eid => {
    const r = ENCHANT_RECIPES[eid];
    const allCost = Object.entries(r.cost).map(([rc, n]) => `${FRAGMENT_ICONS[rc as EnemyRace]}×${n}`).join(" + ");
    return `<li><b>${ENCHANT_NAMES[eid]}</b> · 需 ${allCost}<br><span class="frag-info-enchant-desc">${escapeHTML(ENCHANT_DESCS[eid])}</span></li>`;
  }).join("");
  const rareTag = isRareRace(race) ? '<span class="frag-info-rare">★ 稀少种族</span>' : "";

  const overlay = document.createElement("div");
  overlay.id = "status-info-overlay"; // 复用 status modal 的样式
  overlay.innerHTML = `
    <div id="status-info-modal" class="k-neutral">
      <div class="status-info-header">
        <h3>${FRAGMENT_ICONS[race]} ${FRAGMENT_NAMES[race]}${rareTag}<span class="status-info-kind k-neutral">灵魂碎片</span></h3>
        <button id="status-info-close">✕</button>
      </div>
      <div class="status-info-body">
        <p class="status-info-desc">击败「${RACE_NAMES[race]}」种族的敌人时掉落 1 个。</p>
        ${usedIn.length > 0 ? `<p class="status-info-desc">用于 <b>${usedIn.length}</b> 个附魔：</p>
        <ul class="frag-info-enchant-list">${enchantList}</ul>` : ""}
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
    battle_victory: "★ 战斗胜利",
    suit_pick: "选择花色",
    reward_card: "战利品 · 选 1 张牌",
    reward_perk: "通关 · 选 1 张特性",
    discard: "整理卡组",
    forge: "⚒ 铁匠铺",
    floor_event: "✨ 楼层事件",
    floor_map: state.floorMap ? `第 ${state.floor} 关 · ${state.floorMap.theme.name}` : "塔层地图",
    game_over: "✗ 失败",
    victory: "★ 通关胜利",
  } as Record<string, string>)[p] || p;
}

// ─────────────────────────────────────────────────────────
// 起手特性
// ─────────────────────────────────────────────────────────

function renderStarterPerks() {
  // 标题已在顶部 phase-bar 显示"起手选特性（剩 N）"，stage 内不重复
  stageEl.innerHTML = `
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
  const dodgePct = getCurrentDodgeChance(state.player);
  const dodgeChip = dodgePct > 0
    ? `<span class="pcard-dodge-chip" title="完全闪避概率：每次受击有 ${dodgePct}% 概率跳过整次伤害">🎯 闪避 ${dodgePct}%</span>`
    : "";
  // 单芯片：仅显示当前最高亲和度的花色（点击展开 4 花色面板）
  const affinityChip = renderSuitAffinityChip();
  stageEl.innerHTML = `
    <div id="enemies-row"></div>
    <div id="player-card">
      <div class="pcard-hp-row">
        <span class="pcard-hp-val">HP ${state.player.vita}/${state.player.vitaMax}</span>
        <div class="pcard-hp-bar"><div class="pcard-hp-fill" style="width:${hpPct}%"></div></div>
        ${dodgeChip}
      </div>
      <div class="pcard-equip-row" id="pcard-equip"></div>
      <div class="pcard-statuses" id="pcard-statuses"></div>
      <div class="pcard-suit-row" id="pcard-suit-row">${affinityChip}</div>
    </div>
  `;

  // 单芯片点击 → 打开花色专精面板
  stageEl.querySelectorAll<HTMLElement>("[data-aff-chip]").forEach(chip => {
    chip.addEventListener("click", () => showSuitSpecialtyPanel());
  });

  const row = $("enemies-row");
  for (let i = 0; i < battle.enemies.length; i++) {
    row.appendChild(renderEnemy(battle.enemies[i], i));
  }

  // 大招按钮绑定 + 二次确认
  stageEl.querySelectorAll<HTMLButtonElement>(".suit-ult-btn").forEach(btn => {
    const suit = btn.dataset.suit as Suit;
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const theme = SUIT_THEMES[suit];
      const names = SUIT_TIER_NAMES[suit];
      const descs = SUIT_TIER_DESCS[suit];
      showConfirm({
        title: `${SUIT_SYMBOLS[suit]} ${theme.name} · ${names.ult}`,
        body: `${descs.ult}<br><br>消耗 <b>10 点</b>该花色亲和度。`,
        confirmLabel: "释放！",
        onConfirm: () => {
          if (releaseSuitUltimate(state, suit)) render();
        },
      });
    });
  });

  // Player card — equip row
  const equipRow = $("pcard-equip");
  const wep = state.player.weapons[0];
  const wepSuit = wep ? SUIT_SYMBOLS[CARD_DB[wep.defId].equipSuit!] ?? "" : "";
  const wepLabel = wep
    ? `⚔ ${CARD_DB[wep.defId].name}×${state.player.weapons.length} ${wepSuit}${state.player.weaponEnchant ? " ⚒" + ENCHANT_NAMES[state.player.weaponEnchant] : ""}`
    : "⚔ 徒手";
  const arm = state.player.armors[0];
  const armSuit = arm ? SUIT_SYMBOLS[CARD_DB[arm.defId].equipSuit!] ?? "" : "";
  const armLabel = arm ? `🛡 ${CARD_DB[arm.defId].name}×${state.player.armors.length} ${armSuit}` : "🛡 无防具";
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

// 花色专精芯片 v2：只显示当前最高亲和度的花色（单芯片 + 进度填充 + 大招按钮）
// 进度填充规则：
//   - aff < 5  → 填充 0%，灰显（未点亮）
//   - 5 ≤ aff < 10 → 点亮但只显示档位名（Tier 1）
//   - 10 ≤ aff < 15 → 进度条 50%，档位名（Tier 2）
//   - aff ≥ 15 → 进度条 100%，档位名（Tier 3）+ 大招按钮
// 点击芯片 → 打开"花色专精面板"（4 个花色横向对比 + 切换按钮）
function renderSuitAffinityChip(): string {
  if (!state.battle) return "";
  const suit = getDisplayedSpecialty(state.battle);
  const aff = getSuitAffinity(state.battle, suit);
  const tier = suitTier(state.battle, suit);
  const isActive = getActiveSpecialty(state.battle) === suit;
  const sym = SUIT_SYMBOLS[suit];
  const theme = SUIT_THEMES[suit];
  const names = SUIT_TIER_NAMES[suit];
  const isRed = suit === "heart" || suit === "diamond";
  // 填充百分比：T1=lit-no-fill, T2=50%, T3=100%
  let fillPct = 0;
  let tierLabel = "未点亮";
  if (tier >= 3) { fillPct = 100; tierLabel = names.tier3; }
  else if (tier >= 2) { fillPct = 50; tierLabel = names.tier2; }
  else if (tier >= 1) { fillPct = 0; tierLabel = names.tier1; }
  // tier >= 1 但 fill 0% 用 class "lit"（亮但未填）
  const litClass = tier >= 1 ? " lit" : "";
  const tier3Class = tier >= 3 ? " tier-3" : "";
  const inactiveClass = !isActive && tier >= 1 ? " is-tied-inactive" : "";

  // 大招按钮（T3 时显示）
  const ultBtn = (tier >= 3 && isActive)
    ? `<button class="suit-ult-btn" data-suit="${suit}" title="释放 ${theme.name} 大招（消耗 10 亲和）">⚡ ${names.ult}</button>`
    : "";

  // 并列指示器（如果有多个花色并列最高，显示"⇄"提示玩家可切换）
  const tied = getTiedSpecialties(state.battle);
  const tiedHint = tied.length > 1 ? `<span class="saff-tied-hint">⇄ 并列 ${tied.length}</span>` : "";

  return `
    <div class="suit-aff-chip-v2${isRed ? " red" : ""}${litClass}${tier3Class}${inactiveClass}"
         data-aff-chip="1" data-suit="${suit}"
         title="${theme.name}：亲和度 ${aff.toFixed(1)} / Tier ${tier}（点击查看 4 花色面板）">
      <div class="saff-fill" style="width:${fillPct}%"></div>
      <div class="saff-content">
        <span class="saff-sym">${sym}</span>
        <span class="saff-name">${tierLabel}</span>
        <span class="saff-val">${aff.toFixed(1)}</span>
        ${tiedHint}
      </div>
    </div>
    ${ultBtn}
  `;
}

// 花色专精详情面板（4 花色横向对比）
function showSuitSpecialtyPanel(): void {
  if (!state.battle) return;
  document.getElementById("suit-panel-overlay")?.remove();
  const battle = state.battle;
  const active = getActiveSpecialty(battle);
  const tied = getTiedSpecialties(battle);

  const cards = SUITS.map(suit => {
    const aff = getSuitAffinity(battle, suit);
    const tier = suitTier(battle, suit);
    const sym = SUIT_SYMBOLS[suit];
    const theme = SUIT_THEMES[suit];
    const names = SUIT_TIER_NAMES[suit];
    const descs = SUIT_TIER_DESCS[suit];
    const isRed = suit === "heart" || suit === "diamond";
    const isActive = active === suit;
    const isTiedTop = tied.includes(suit);
    const canSwitch = isTiedTop && !isActive;
    // 进度条（垂直）：100% = aff 15（T3 满档）
    const fillPct = Math.min(100, Math.round((aff / 15) * 100));
    // 各档名 + 锁定/已达
    const t1Done = tier >= 1, t2Done = tier >= 2, t3Done = tier >= 3;
    const switchBtn = canSwitch
      ? `<button class="ssp-switch-btn" data-switch-suit="${suit}">切换激活</button>`
      : isActive
        ? `<div class="ssp-active-badge">★ 激活中</div>`
        : "";
    return `
      <div class="ssp-card${isRed ? " red" : ""}${isActive ? " active" : ""}">
        <div class="ssp-head">
          <span class="ssp-sym">${sym}</span>
          <span class="ssp-name">${theme.name}</span>
        </div>
        <div class="ssp-bar-wrap">
          <div class="ssp-bar-bg">
            <div class="ssp-bar-fill" style="height:${fillPct}%"></div>
            <div class="ssp-tier-mark t1" style="bottom:33.3%"></div>
            <div class="ssp-tier-mark t2" style="bottom:66.6%"></div>
          </div>
          <div class="ssp-aff-num">${aff.toFixed(1)}</div>
        </div>
        <div class="ssp-tiers">
          <div class="ssp-tier-row${t1Done ? " done" : ""}">
            <span class="ssp-tier-label">T1 · ${names.tier1}</span>
            <div class="ssp-tier-desc">${descs.tier1}</div>
          </div>
          <div class="ssp-tier-row${t2Done ? " done" : ""}">
            <span class="ssp-tier-label">T2 · ${names.tier2}</span>
            <div class="ssp-tier-desc">${descs.tier2}</div>
          </div>
          <div class="ssp-tier-row${t3Done ? " done" : ""}">
            <span class="ssp-tier-label">T3 · ${names.tier3}</span>
            <div class="ssp-tier-desc">${descs.tier3}</div>
          </div>
          <div class="ssp-tier-row ult${t3Done ? " done" : ""}">
            <span class="ssp-tier-label">⚡ ${names.ult}</span>
            <div class="ssp-tier-desc">${descs.ult}</div>
          </div>
        </div>
        ${switchBtn}
      </div>
    `;
  }).join("");

  const overlay = document.createElement("div");
  overlay.id = "suit-panel-overlay";
  overlay.innerHTML = `
    <div id="suit-panel-modal">
      <div class="ssp-header">
        <span class="panel-label">花色专精</span>
        <button class="ssp-close" aria-label="关闭">✕</button>
      </div>
      <div class="ssp-tip">
        ${tied.length > 1
          ? `当前有 <b>${tied.length}</b> 个花色亲和度并列最高，可点「切换激活」选择其一。`
          : "亲和度最高的花色为激活专精。多个花色并列最高时可在此手动切换。"}
      </div>
      <div class="ssp-grid">${cards}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".ssp-close")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll<HTMLButtonElement>("[data-switch-suit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const suit = btn.dataset.switchSuit as Suit;
      if (setActiveSpecialty(state, suit)) {
        overlay.remove();
        render();
      }
    });
  });
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
    ? `<div class="enemy-tier-badge boss">👑 BOSS</div>`
    : tier === "elite"
      ? `<div class="enemy-tier-badge elite">✦ 精英</div>`
      : "";
  // ⓘ 详情按钮（仅精英 / boss 才有）
  const infoBtn = tier !== "normal" ? `<button class="enemy-info-btn" data-info-idx="${idx}" aria-label="查看机制">i</button>` : "";
  wrap.innerHTML = `
    ${tierBadge}
    ${infoBtn}
    <div class="enemy-emoji">${emoji}</div>
    <div class="enemy-name">${escapeHTML(e.name)}${weaponBadge}${armorBadge}</div>
    <div class="enemy-race-row">${raceTag}${e.eliteAbility ? `<span class="enemy-ability-tag">★ ${escapeHTML(e.eliteAbility)}</span>` : ""}</div>
    <div class="enemy-hp-text">HP ${e.hp} / ${e.maxHp}</div>
    ${renderEnemyHpSegments(e.hp, e.maxHp)}
    <div class="enemy-status">${statusTags}</div>
    ${isTarget ? '<div class="target-badge">▼ 目标</div>' : ""}
  `;
  // info 按钮要拦截冒泡（不要触发"选目标"），并打开机制详情弹窗
  const ib = wrap.querySelector(".enemy-info-btn") as HTMLButtonElement | null;
  if (ib) {
    ib.addEventListener("click", ev => {
      ev.stopPropagation();
      showEnemyDetail(e);
    });
  }
  return wrap;
}

// 敌人机制详情弹窗（精英 / Boss 专属）
function showEnemyDetail(e: EnemyState): void {
  document.getElementById("enemy-detail-overlay")?.remove();
  const tier = e.tier ?? "normal";
  const emoji = ENEMY_EMOJI[e.name] ?? "👾";
  const tierLabel = tier === "boss" ? "👑 BOSS" : tier === "elite" ? "✦ 精英" : "普通";
  const intentItems = e.intents.map(it => {
    const valStr = it.type === "attack"
      ? `⚔ ${it.value}${it.hits && it.hits > 1 ? ` × ${it.hits}` : ""}`
      : it.type === "debuff"
        ? `${it.debuffName ?? "debuff"} ${it.value > 0 ? `(${it.value})` : ""}${it.debuffDuration ? ` ${it.debuffDuration}回` : ""}`
        : it.type === "buff"
          ? "buff"
          : "";
    return `<li><span class="ed-intent-name">${escapeHTML(it.desc)}</span><span class="ed-intent-val">${escapeHTML(valStr)}</span></li>`;
  }).join("");
  const overlay = document.createElement("div");
  overlay.id = "enemy-detail-overlay";
  overlay.innerHTML = `
    <div id="enemy-detail-modal" class="tier-${tier}">
      <button class="ed-close" aria-label="关闭">✕</button>
      <div class="ed-header">
        <div class="ed-emoji">${emoji}</div>
        <div class="ed-name-block">
          <div class="ed-tier">${tierLabel}</div>
          <div class="ed-name">${escapeHTML(e.name)}</div>
          <div class="ed-meta">
            ${FRAGMENT_ICONS[e.race]} ${RACE_NAMES[e.race]}
            ${(e.armor ?? 0) > 0 ? ` · 🛡${e.armor}` : ""}
            ${e.weaponMult && e.weaponMult > 1 ? ` · ⚔×${e.weaponMult.toFixed(1)}` : ""}
          </div>
        </div>
      </div>
      ${e.eliteAbility ? `
        <div class="ed-ability">
          <div class="ed-ability-name">★ ${escapeHTML(e.eliteAbility)}</div>
          ${ABILITY_DESCS[e.eliteAbility] ? `<div class="ed-ability-desc">${escapeHTML(ABILITY_DESCS[e.eliteAbility])}</div>` : ""}
        </div>
      ` : ""}
      <div class="ed-hp">HP <b>${e.hp}</b> / ${e.maxHp}</div>
      <div class="ed-section-title">招式${tier === "boss" ? "（随机抽取）" : ""}</div>
      <ul class="ed-intent-list">${intentItems}</ul>
      <p class="ed-hint">击败可获得 ${FRAGMENT_ICONS[e.race]} <b>${FRAGMENT_NAMES[e.race]}</b> ×1${tier === "boss" ? " · 战利品保底 1 张史诗" : ""}</p>
    </div>
  `;
  const close = () => overlay.remove();
  overlay.querySelector(".ed-close")!.addEventListener("click", close);
  overlay.addEventListener("click", ev => { if (ev.target === overlay) close(); });
  document.body.appendChild(overlay);
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
    <p class="hint">${title}</p>
    <div id="suit-pick-grid"></div>
    <button class="skip-btn" id="suit-pick-cancel-btn">取消（卡片照样消耗）</button>
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
  $("suit-pick-cancel-btn").addEventListener("click", () => {
    showConfirm({
      title: "取消花色选择",
      body: "卡片已经打出，<b>无论选不选花色都会消耗</b>。<br>确认放弃这次效果吗？",
      confirmLabel: "放弃",
      onConfirm: () => {
        gameSuitPickCanceled(state);
        render();
      },
    });
  });
}

function renderBattleVictory() {
  stageEl.innerHTML = `
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
    <p class="hint">选中的牌会进入你的牌库（不是手牌）。</p>
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
    <p class="hint">HP 已补满。也可选生命上限替代特性。</p>
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
    <p class="hint">点击卡片选中可弃置（牌库 / 装备 / 特性）。<span style="color:var(--green)">绿色边框</span> = 本关新获得。</p>
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
  const rarity = def.rarity ?? "common";
  el.className = `discard-card cat-${def.category} rarity-${rarity}${isNew ? " new-card" : ""}`;
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
  const recolorUsed = state.forgeRecolorUsed === true;
  const totalFragments = Object.values(state.player.fragments).reduce((a, b) => a + b, 0);
  const recolorBtn = recolorUsed
    ? `<button class="forge-recolor-btn" disabled>本次已用过染色</button>`
    : totalFragments < 3
      ? `<button class="forge-recolor-btn" disabled>碎片不足（需 3 任意）</button>`
      : `<button class="forge-recolor-btn">染色 1 张攻击牌（消耗 3 任意碎片）</button>`;
  stageEl.innerHTML = `
    <p class="hint">用灵魂碎片为武器附魔。普通附魔（单种族 ×3）/ 复合附魔（2 种族 ×2+×2）。换附魔会覆盖旧的。</p>
    <div id="forge-current">当前武器：<b>${escapeHTML(curWeapon)}</b>　|　当前附魔：<b>${cur ? escapeHTML(ENCHANT_NAMES[cur]) : "（无）"}</b></div>
    <div id="forge-recolor-section">
      <div class="forge-recolor-title">🎨 染坊（每次铁匠铺仅可使用 1 次）</div>
      <div class="forge-recolor-desc">用任意 3 个灵魂碎片，把牌库里的 1 张攻击牌永久变成你选的花色。</div>
      ${recolorBtn}
    </div>
    <div id="forge-section-single">
      <div class="forge-section-title">🔹 普通附魔（单种族 ×3 碎片）</div>
      <div class="forge-grid" id="forge-list-single"></div>
    </div>
    <div id="forge-section-composite">
      <div class="forge-section-title">🔸 复合附魔（2 种族 ×2 + ×2 碎片）<span class="forge-section-sub">含巨怪/暗影 = 强档；双稀少 = 究极</span></div>
      <div class="forge-grid" id="forge-list-composite"></div>
    </div>
    <button id="forge-skip-btn" class="big-btn">跳过铁匠铺</button>
  `;
  // 染色按钮绑定
  const rb = stageEl.querySelector(".forge-recolor-btn") as HTMLButtonElement | null;
  if (rb && !recolorUsed && totalFragments >= 3) {
    rb.addEventListener("click", () => showForgeRecolorWizard());
  }
  const listSingle = $("forge-list-single");
  const listComposite = $("forge-list-composite");
  for (const eid of ENCHANTS) {
    const recipe = ENCHANT_RECIPES[eid];
    // 校验是否所有材料够
    const costEntries = Object.entries(recipe.cost) as [import("./types.ts").EnemyRace, number][];
    const enough = costEntries.every(([r, n]) => (state.player.fragments[r] ?? 0) >= (n ?? 0));
    const isCurrent = cur === eid;
    const branchSym = SUIT_SYMBOLS[recipe.branch];
    const branchTheme = SUIT_THEMES[recipe.branch];
    const variantBadge = recipe.variant === "specialize"
      ? `<span class="forge-tag forge-tag-spec">特化</span>`
      : `<span class="forge-tag forge-tag-comp">互补</span>`;
    const tierBadge = recipe.doubleRare
      ? `<span class="forge-tag forge-tag-ultimate">究极</span>`
      : recipe.hasRare
        ? `<span class="forge-tag forge-tag-rare">强档</span>`
        : `<span class="forge-tag forge-tag-base">普通</span>`;
    const costHtml = costEntries.map(([r, n]) => {
      const have = state.player.fragments[r] ?? 0;
      const ok = have >= n;
      const rare = isRareRace(r);
      return `<span class="forge-cost-pill${ok ? " ok" : " miss"}${rare ? " rare" : ""}">${FRAGMENT_ICONS[r]} ${FRAGMENT_NAMES[r]} ${have}/${n}</span>`;
    }).join("");

    const card = document.createElement("div");
    card.className = `forge-card v2${enough ? " ok" : " disabled"}${isCurrent ? " current" : ""}${recipe.doubleRare ? " ultimate" : recipe.hasRare ? " rare" : ""}`;
    card.innerHTML = `
      <div class="forge-card-head">
        <span class="forge-branch" style="color:${branchTheme.color}">${branchSym} ${branchTheme.name}</span>
        ${variantBadge}${tierBadge}
      </div>
      <div class="forge-name">${escapeHTML(ENCHANT_NAMES[eid])}${isCurrent ? "（已装备）" : ""}</div>
      <div class="forge-desc">${escapeHTML(ENCHANT_DESCS[eid])}</div>
      <div class="forge-cost-row">${costHtml}</div>
      <button class="forge-btn" ${enough ? "" : "disabled"}>${enough ? (isCurrent ? "重新附魔" : "应用") : "碎片不足"}</button>
    `;
    if (enough) {
      card.querySelector("button")!.addEventListener("click", () => {
        applyEnchant(state, eid);
        render();
      });
    }
    if (recipe.kind === "single") listSingle.appendChild(card);
    else listComposite.appendChild(card);
  }
  $("forge-skip-btn").addEventListener("click", () => { skipForge(state); render(); });
}

// 染色向导：选攻击牌 → 选目标花色 → 自动从最高库存种族扣 3 碎片
function showForgeRecolorWizard(): void {
  const attackCards = state.player.deck.filter(c => CARD_DB[c.defId]?.category === "attack");
  if (attackCards.length === 0) {
    showConfirm({ title: "无攻击牌", body: "牌库里没有攻击牌可染色。", confirmLabel: "知道了", onConfirm: () => {} });
    return;
  }
  // 第 1 步：选攻击牌
  document.getElementById("recolor-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "recolor-overlay";
  overlay.className = "ic-overlay";
  overlay.innerHTML = `
    <div class="ic-modal" style="max-width: 480px">
      <div class="ic-title">🎨 选要染色的攻击牌</div>
      <div class="recolor-cards-grid"></div>
      <div class="ic-actions"><button class="ic-cancel">取消</button></div>
    </div>
  `;
  const grid = overlay.querySelector(".recolor-cards-grid")!;
  // 按 (defId, attackSuitOverride/原色) 分组
  const seen = new Set<string>();
  for (const card of attackCards) {
    const def = CARD_DB[card.defId];
    const curSuit = card.attackSuitOverride ?? def.attackSuit ?? "spade";
    const key = `${def.id}-${curSuit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sym = SUIT_SYMBOLS[curSuit as Suit];
    const isRed = curSuit === "heart" || curSuit === "diamond";
    const item = document.createElement("div");
    item.className = "recolor-card-item";
    item.innerHTML = `
      <div class="recolor-card-name">${escapeHTML(def.name)}</div>
      <div class="recolor-card-suit${isRed ? " red" : ""}">${sym}</div>
    `;
    item.addEventListener("click", () => {
      overlay.remove();
      pickRecolorTargetSuit(card.uid, curSuit as Suit);
    });
    grid.appendChild(item);
  }
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function pickRecolorTargetSuit(cardUid: string, currentSuit: Suit): void {
  document.getElementById("recolor-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "recolor-overlay";
  overlay.className = "ic-overlay";
  const card = state.player.deck.find(c => c.uid === cardUid);
  const def = card ? CARD_DB[card.defId] : null;
  overlay.innerHTML = `
    <div class="ic-modal" style="max-width: 360px">
      <div class="ic-title">选目标花色</div>
      <div class="ic-body">将 <b>${escapeHTML(def?.name ?? "")}</b>（${SUIT_SYMBOLS[currentSuit]}）变成什么花色？</div>
      <div class="suit-pick-wide-grid"></div>
      <div class="ic-actions"><button class="ic-cancel">取消</button></div>
    </div>
  `;
  const grid = overlay.querySelector(".suit-pick-wide-grid")!;
  for (const suit of SUITS) {
    if (suit === currentSuit) continue;
    const sym = SUIT_SYMBOLS[suit as Suit];
    const isRed = suit === "heart" || suit === "diamond";
    const btn = document.createElement("button");
    btn.className = `suit-pick-btn${isRed ? " red" : ""}`;
    btn.textContent = sym;
    btn.addEventListener("click", () => {
      overlay.remove();
      // 自动从库存最多的种族扣 3 个
      const races: import("./types.ts").EnemyRace[] = ["beast", "humanoid", "undead", "giant", "dark"];
      const sorted = [...races].sort((a, b) => (state.player.fragments[b] ?? 0) - (state.player.fragments[a] ?? 0));
      const paySpend: Partial<Record<import("./types.ts").EnemyRace, number>> = {};
      let need = 3;
      for (const r of sorted) {
        if (need <= 0) break;
        const have = state.player.fragments[r] ?? 0;
        const take = Math.min(have, need);
        if (take > 0) {
          paySpend[r] = take;
          need -= take;
        }
      }
      if (need > 0) return;
      if (applyForgeRecolor(state, cardUid, suit as Suit, paySpend)) render();
    });
    grid.appendChild(btn);
  }
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────
// 楼层事件渲染（5 个事件 + 跳过）
// ─────────────────────────────────────────────────────────

function renderFloorEvent() {
  const eid = state.activeEventId as EventId | undefined;
  if (!eid) return;
  const meta = EVENT_META[eid];
  stageEl.innerHTML = `
    <div class="event-card">
      <div class="event-header">
        <span class="event-icon">${meta.icon}</span>
        <span class="event-name">${escapeHTML(meta.name)}</span>
      </div>
      <p class="event-desc">${escapeHTML(meta.desc)}</p>
      <div class="event-options" id="event-options"></div>
      <button class="skip-btn" id="event-skip-btn">跳过本次事件</button>
    </div>
  `;
  const optionsEl = $("event-options");
  if (eid === "merchant") renderMerchant(optionsEl);
  else if (eid === "gambler") renderGambler(optionsEl);
  else if (eid === "shrine") renderShrine(optionsEl);
  else if (eid === "wizard") renderWizard(optionsEl);
  else if (eid === "chest") renderChest(optionsEl);

  $("event-skip-btn").addEventListener("click", () => {
    skipFloorEvent(state);
    render();
  });
}

// 商人 — 5 张候选购买 + 兑换碎片入口
function renderMerchant(parent: HTMLElement) {
  const stock = state.merchantStock ?? [];
  if (stock.length === 0) {
    parent.innerHTML = '<p class="hint">商人清空了货架。</p>';
  } else {
    const grid = document.createElement("div");
    grid.className = "merchant-grid";
    for (const inst of stock) {
      const def = CARD_DB[inst.defId];
      const rarity = def.rarity ?? "common";
      const price = MERCHANT_PRICES[rarity];
      const cardEl = document.createElement("div");
      cardEl.className = `merchant-card rarity-${rarity}`;
      cardEl.innerHTML = `
        <div class="merchant-card-name">${escapeHTML(def.name)}</div>
        <div class="merchant-card-rarity">${rarityLabel(rarity)}</div>
        <div class="merchant-card-desc">${escapeHTML(def.desc)}</div>
        <div class="merchant-card-price">💰 ${price} 碎片（可混搭花色）</div>
        <button class="merchant-buy-btn">购买</button>
      `;
      cardEl.querySelector(".merchant-buy-btn")!.addEventListener("click", () => {
        showMixedPaymentModal(price, def.name, spend => {
          if (merchantBuyCardMixed(state, inst.uid, spend)) render();
        });
      });
      grid.appendChild(cardEl);
    }
    parent.appendChild(grid);
  }
  // 操作：兑换碎片 + 离开
  const actions = document.createElement("div");
  actions.className = "merchant-actions";
  actions.innerHTML = `
    <button class="merchant-trade-btn">⇄ 兑换碎片（3:1）</button>
    <button class="merchant-leave-btn">离开</button>
  `;
  actions.querySelector(".merchant-trade-btn")!.addEventListener("click", () => showFragmentTradeModal());
  actions.querySelector(".merchant-leave-btn")!.addEventListener("click", () => {
    merchantLeave(state);
    render();
  });
  parent.appendChild(actions);
}

// 选种族弹窗
function showRacePicker(title: string, onPick: (race: import("./types.ts").EnemyRace) => void) {
  document.getElementById("race-picker-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "race-picker-overlay";
  overlay.className = "ic-overlay";
  overlay.innerHTML = `
    <div class="ic-modal">
      <div class="ic-title">${escapeHTML(title)}</div>
      <div class="race-picker-grid"></div>
      <div class="ic-actions"><button class="ic-cancel">取消</button></div>
    </div>
  `;
  const grid = overlay.querySelector(".race-picker-grid")!;
  for (const r of RACES) {
    const have = state.player.fragments[r] ?? 0;
    const btn = document.createElement("button");
    btn.className = "race-pick-btn";
    btn.innerHTML = `${FRAGMENT_ICONS[r]} ${FRAGMENT_NAMES[r]}<br><span class="race-pick-count">×${have}</span>`;
    btn.addEventListener("click", () => { overlay.remove(); onPick(r); });
    grid.appendChild(btn);
  }
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// 兑换碎片弹窗（选源 → 选目标）
function showFragmentTradeModal() {
  showRacePicker("选要花掉的碎片（消耗 3）", from => {
    showRacePicker(`换什么？（${FRAGMENT_ICONS[from]} 3 → ? 1）`, to => {
      if (merchantTradeFragments(state, from, to)) render();
    });
  });
}

// 混搭支付 modal：5 种族 ± 按钮 + 实时校验总额 = 价格
function showMixedPaymentModal(
  price: number,
  cardName: string,
  onConfirm: (spend: Partial<Record<EnemyRace, number>>) => void,
) {
  document.getElementById("mixed-pay-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "mixed-pay-overlay";
  overlay.className = "ic-overlay";
  const spend: Partial<Record<EnemyRace, number>> = {};
  for (const r of RACES) spend[r] = 0;

  const renderRows = (): string => {
    return RACES.map(r => {
      const have = state.player.fragments[r] ?? 0;
      const cur = spend[r] ?? 0;
      const rare = isRareRace(r);
      return `
        <div class="mxpay-row${rare ? " rare" : ""}">
          <span class="mxpay-icon">${FRAGMENT_ICONS[r]}</span>
          <span class="mxpay-name">${FRAGMENT_NAMES[r]}</span>
          <span class="mxpay-have">库存 ${have}</span>
          <button class="mxpay-minus" data-race="${r}" ${cur <= 0 ? "disabled" : ""}>−</button>
          <span class="mxpay-cur">${cur}</span>
          <button class="mxpay-plus" data-race="${r}" ${cur >= have ? "disabled" : ""}>+</button>
        </div>
      `;
    }).join("");
  };

  const update = () => {
    overlay.querySelector(".mxpay-rows")!.innerHTML = renderRows();
    const total = RACES.reduce((s, r) => s + (spend[r] ?? 0), 0);
    overlay.querySelector(".mxpay-total")!.innerHTML =
      `已选 <b class="${total === price ? "mxpay-ok" : "mxpay-mismatch"}">${total}</b> / ${price}`;
    const confirmBtn = overlay.querySelector(".ic-confirm") as HTMLButtonElement;
    confirmBtn.disabled = total !== price;
    bindRowButtons();
  };

  const bindRowButtons = () => {
    overlay.querySelectorAll<HTMLButtonElement>(".mxpay-plus").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = btn.dataset.race as EnemyRace;
        spend[r] = (spend[r] ?? 0) + 1;
        update();
      });
    });
    overlay.querySelectorAll<HTMLButtonElement>(".mxpay-minus").forEach(btn => {
      btn.addEventListener("click", () => {
        const r = btn.dataset.race as EnemyRace;
        spend[r] = Math.max(0, (spend[r] ?? 0) - 1);
        update();
      });
    });
  };

  overlay.innerHTML = `
    <div class="ic-modal mxpay-modal">
      <div class="ic-title">💰 购买 ${escapeHTML(cardName)}</div>
      <div class="mxpay-tip">总价 <b>${price}</b> 碎片，5 种族任意混搭。</div>
      <div class="mxpay-rows">${renderRows()}</div>
      <div class="mxpay-total">已选 <b>0</b> / ${price}</div>
      <div class="ic-actions">
        <button class="ic-cancel">取消</button>
        <button class="ic-confirm" disabled>确认支付</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  bindRowButtons();
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => overlay.remove());
  overlay.querySelector(".ic-confirm")!.addEventListener("click", () => {
    overlay.remove();
    onConfirm(spend);
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

function renderGambler(parent: HTMLElement) {
  for (let i = 0; i < GAMBLER_OPTIONS.length; i++) {
    const opt = GAMBLER_OPTIONS[i];
    const enabled = opt.available(state);
    const btn = document.createElement("button");
    btn.className = `event-option-btn${!enabled ? " disabled" : ""}`;
    btn.disabled = !enabled;
    btn.innerHTML = `
      <div class="event-option-label">${escapeHTML(opt.label)}</div>
      <div class="event-option-cost">代价：${escapeHTML(opt.costDesc)}</div>
      <div class="event-option-reward">回报：${escapeHTML(opt.rewardDesc)}</div>
    `;
    btn.addEventListener("click", () => { gamblerBet(state, i); render(); });
    parent.appendChild(btn);
  }
}

function renderShrine(parent: HTMLElement) {
  for (let i = 0; i < SHRINE_OPTIONS.length; i++) {
    const opt = SHRINE_OPTIONS[i];
    const btn = document.createElement("button");
    btn.className = "event-option-btn";
    btn.innerHTML = `
      <div class="event-option-label">${escapeHTML(opt.label)}</div>
    `;
    btn.addEventListener("click", () => { shrineSacrifice(state, i); render(); });
    parent.appendChild(btn);
  }
}

function renderWizard(parent: HTMLElement) {
  const grid = document.createElement("div");
  grid.className = "choice-grid cols-3";
  for (const inst of state.choices) {
    grid.appendChild(renderChoiceCardEl(inst, () => { wizardPick(state, inst.uid); render(); }));
  }
  parent.appendChild(grid);
}

function renderChest(parent: HTMLElement) {
  const trapsList = (Object.values(CHEST_TRAP_DESCS) as string[]).map(d => `<li>${escapeHTML(d)}</li>`).join("");
  parent.innerHTML = `
    <p class="event-rules-info">
      可能结果：<br>
      · 50% 抽 1 张 rare 卡<br>
      · 25% 抽 1 张 super_rare 卡<br>
      · 5% 抽 1 张 epic 卡<br>
      · 20% 触发陷阱（影响下一场战斗，三种之一）：
      <ul>${trapsList}</ul>
    </p>
    <button class="event-option-btn open-chest-btn">
      <div class="event-option-label">开 ！</div>
    </button>
  `;
  parent.querySelector(".open-chest-btn")!.addEventListener("click", () => {
    chestOpen(state);
    render();
  });
}

// ─────────────────────────────────────────────────────────
// 楼层地图渲染（SVG 边 + HTML 节点）
// ─────────────────────────────────────────────────────────

function renderFloorMap() {
  const map = state.floorMap;
  if (!map) return;
  const reachable = getReachableNodes(map);
  const reachableIds = new Set(reachable.map(n => n.id));

  // 容器宽高（用 viewBox 系统：1000 × 700，CSS 缩放）
  const W = 1000;
  const H = 700;

  // 生成 SVG 边
  const edgesSvg = map.nodes.flatMap(node => {
    return node.next.map(targetId => {
      const target = map.nodes.find(n => n.id === targetId);
      if (!target) return "";
      const x1 = node.x * W;
      const y1 = node.y * H;
      const x2 = target.x * W;
      const y2 = target.y * H;
      // 状态：completed (双方都完成) / available (从 current 出发到 reachable) / locked
      const fromCurrent = node.id === map.currentNodeId;
      const isAvailable = fromCurrent && reachableIds.has(targetId);
      const isCompleted = node.completed && target.completed;
      const cls = isCompleted ? "edge-completed" : isAvailable ? "edge-available" : "edge-locked";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="map-edge ${cls}" />`;
    }).join("");
  }).join("");

  // 生成节点 div（可点击）；战斗节点显示种族 emoji，事件节点显示具体事件 icon
  const nodesHtml = map.nodes.map(node => {
    const meta = NODE_TYPE_META[node.type];
    const isCurrent = node.id === map.currentNodeId;
    const isReachable = reachableIds.has(node.id);
    const isCompleted = node.completed;
    let cls = `map-node node-${node.type}`;
    if (isCurrent) cls += " is-current";
    if (isReachable) cls += " is-reachable";
    if (isCompleted) cls += " is-completed";

    // 战斗 / 精英 / Boss：列出该 group 涉及的所有种族（去重排序）
    let racesBadge = "";
    let titleExtra = "";
    if (node.enemies && node.enemies.length > 0) {
      const races = Array.from(new Set(node.enemies.map(e => e.race)));
      const fragIcons = races.map(r => FRAGMENT_ICONS[r]).join("");
      const raceNames = races.map(r => `${RACE_NAMES[r]}（掉 ${FRAGMENT_NAMES[r]}）`).join(" / ");
      racesBadge = `<span class="map-node-races">${fragIcons}</span>`;
      titleExtra = ` · ${raceNames}`;
    }

    // 事件节点：根据 eventId 显示具体 icon + label，避免"骰子点开是商店"的不一致
    let displayIcon = meta.icon;
    let displayLabel = meta.label;
    if (node.type === "event" && node.eventId) {
      const eventMeta = EVENT_META[node.eventId as EventId];
      if (eventMeta) {
        displayIcon = eventMeta.icon;
        displayLabel = eventMeta.name;
      }
    }

    const title = displayLabel + (isCurrent ? "（当前）" : isReachable ? "（可前往）" : "") + titleExtra;
    return `
      <div class="${cls}"
           data-node-id="${node.id}"
           style="left:${node.x * 100}%;top:${node.y * 100}%;border-color:${meta.color};color:${meta.color}"
           title="${title}">
        <span class="map-node-icon">${displayIcon}</span>
        ${racesBadge}
      </div>
    `;
  }).join("");

  stageEl.innerHTML = `
    <div class="floor-map-container ${map.theme.bgClass}">
      <div class="floor-map-header">
        <div class="floor-map-title">
          <span class="floor-map-floor">第 ${map.floor} 关</span>
          <span class="floor-map-name">${escapeHTML(map.theme.name)}</span>
        </div>
        <div class="floor-map-flavor">"${escapeHTML(map.theme.flavor)}"</div>
        <button id="map-loadout-btn" class="map-loadout-btn" title="查看当前装备 / 特性 / 附魔">📋 当前配置</button>
      </div>
      <div class="floor-map-canvas">
        <svg class="floor-map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          ${edgesSvg}
        </svg>
        <div class="floor-map-nodes">
          ${nodesHtml}
        </div>
      </div>
      <div class="floor-map-legend">
        ${(["battle", "elite", "boss", "event", "forge", "shop"] as const).map(t => {
          const m = NODE_TYPE_META[t];
          return `<span class="map-legend-chip"><span style="color:${m.color}">${m.icon}</span> ${m.label}</span>`;
        }).join("")}
      </div>
    </div>
  `;

  // 绑定节点 click（仅可达节点）
  const nodeEls = stageEl.querySelectorAll<HTMLDivElement>(".map-node");
  nodeEls.forEach(el => {
    const nodeId = el.dataset.nodeId!;
    if (reachableIds.has(nodeId)) {
      el.addEventListener("click", () => {
        if (enterMapNode(state, nodeId)) render();
      });
    }
  });

  // 当前配置按钮
  document.getElementById("map-loadout-btn")?.addEventListener("click", showLoadoutModal);
}

// 当前配置 modal：装备 / 附魔 / 特性 / 花色专精概览
function showLoadoutModal(): void {
  document.getElementById("loadout-overlay")?.remove();
  const player = state.player;

  // 武器
  const wep = player.weapons[0];
  const wepBlock = wep ? (() => {
    const def = CARD_DB[wep.defId];
    const cnt = player.weapons.length;
    const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
    const sym = def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
    return `
      <div class="loadout-row">
        <div class="loadout-label">⚔ 武器</div>
        <div class="loadout-content">
          <div class="loadout-name">${escapeHTML(def.name)} ${sym} ×${cnt}</div>
          <div class="loadout-desc">${escapeHTML(eff?.stat ?? eff?.desc ?? def.desc)}</div>
        </div>
      </div>
    `;
  })() : `<div class="loadout-row"><div class="loadout-label">⚔ 武器</div><div class="loadout-content loadout-empty">徒手（基础攻击）</div></div>`;

  // 防具
  const arm = player.armors[0];
  const armBlock = arm ? (() => {
    const def = CARD_DB[arm.defId];
    const cnt = player.armors.length;
    const eff = def.equipEffects?.[Math.min(cnt, 4) - 1];
    const sym = def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
    return `
      <div class="loadout-row">
        <div class="loadout-label">🛡 防具</div>
        <div class="loadout-content">
          <div class="loadout-name">${escapeHTML(def.name)} ${sym} ×${cnt}</div>
          <div class="loadout-desc">${escapeHTML(eff?.stat ?? eff?.desc ?? def.desc)}</div>
        </div>
      </div>
    `;
  })() : `<div class="loadout-row"><div class="loadout-label">🛡 防具</div><div class="loadout-content loadout-empty">无</div></div>`;

  // 武器附魔
  const enc = player.weaponEnchant;
  const encBlock = enc ? `
    <div class="loadout-row">
      <div class="loadout-label">⚒ 附魔</div>
      <div class="loadout-content">
        <div class="loadout-name">${escapeHTML(ENCHANT_NAMES[enc])}</div>
        <div class="loadout-desc">${escapeHTML(ENCHANT_DESCS[enc])}</div>
      </div>
    </div>
  ` : `<div class="loadout-row"><div class="loadout-label">⚒ 附魔</div><div class="loadout-content loadout-empty">无</div></div>`;

  // 特性（聚合）
  const perkGroups = new Map<string, number>();
  for (const p of player.perks) perkGroups.set(p.defId, (perkGroups.get(p.defId) ?? 0) + 1);
  const perkBlock = perkGroups.size === 0
    ? `<div class="loadout-row"><div class="loadout-label">✦ 特性</div><div class="loadout-content loadout-empty">无</div></div>`
    : `<div class="loadout-row">
        <div class="loadout-label">✦ 特性 (${player.perks.length})</div>
        <div class="loadout-content">
          ${Array.from(perkGroups.entries()).map(([id, cnt]) => {
            const def = CARD_DB[id];
            const eff = def.perkEffect;
            const summary = eff?.summary?.(cnt) ?? eff?.unitDesc ?? def.desc;
            return `<div class="loadout-perk-line"><b>${escapeHTML(def.name)} ×${cnt}</b> · <span class="loadout-perk-sum">${escapeHTML(summary)}</span></div>`;
          }).join("")}
        </div>
      </div>`;

  // 花色亲和度（4 花色简表，含全部三个永久来源）
  const suitBlock = `
    <div class="loadout-row">
      <div class="loadout-label">🎴 花色亲和</div>
      <div class="loadout-content loadout-suits">
        ${SUITS.map(suit => {
          // 计算与 battle.ts/getSuitAffinity 一致的亲和度（地图阶段也准确显示）
          let aff = 0;
          for (const w of player.weapons) if (CARD_DB[w.defId]?.equipSuit === suit) aff += 1.5;
          for (const a of player.armors) if (CARD_DB[a.defId]?.equipSuit === suit) aff += 1.5;
          for (const p of player.perks) if (CARD_DB[p.defId]?.defaultSuit === suit) aff += 1;
          const played = Math.min(30, player.suitPlayedTotal?.[suit] ?? 0);
          aff += played * 0.2;
          aff = Math.max(0, Math.min(20, aff));
          const isRed = suit === "heart" || suit === "diamond";
          const tier = aff >= 15 ? 3 : aff >= 10 ? 2 : aff >= 5 ? 1 : 0;
          const tierLabel = tier > 0 ? `T${tier}` : "—";
          return `<span class="loadout-suit-pill${isRed ? " red" : ""}${tier > 0 ? " lit" : ""}" title="装备 +1.5/件 · 特性 +1/张 · 出牌累积 ${played}/30">${SUIT_SYMBOLS[suit]} ${aff.toFixed(1)} <em>${tierLabel}</em></span>`;
        }).join("")}
      </div>
    </div>
    <div class="loadout-suit-note">装备 +1.5/件，特性 +1/张，同色攻击 +0.2/张（cap 30）。Tier 1 / 2 / 3 = 5 / 10 / 15。</div>
  `;

  // 牌库统计（按类别 + 稀有度简表）
  const deckTotal = player.deck.length + player.hand.length + player.discard.length;
  const allCards = [...player.deck, ...player.hand, ...player.discard];
  const byCat = { attack: 0, skill: 0, item: 0, equipment: 0 };
  const byRarity = { common: 0, rare: 0, super_rare: 0, epic: 0 };
  for (const c of allCards) {
    const def = CARD_DB[c.defId];
    if (!def) continue;
    if (def.category in byCat) (byCat as any)[def.category] += 1;
    const r = (def.rarity ?? "common") as keyof typeof byRarity;
    byRarity[r] += 1;
  }
  const deckBlock = `
    <div class="loadout-row">
      <div class="loadout-label">📚 牌库 (${deckTotal})</div>
      <div class="loadout-content loadout-deck-stats">
        <span>攻击 ${byCat.attack}</span>
        <span>技能 ${byCat.skill}</span>
        <span>道具 ${byCat.item}</span>
        <span>装备 ${byCat.equipment}</span>
        <span class="loadout-rarity-sep">|</span>
        <span class="rarity-rare">稀有 ${byRarity.rare}</span>
        <span class="rarity-super_rare">超稀 ${byRarity.super_rare}</span>
        <span class="rarity-epic">史诗 ${byRarity.epic}</span>
      </div>
    </div>
  `;

  // 灵魂碎片
  const fragTotal = RACES.reduce((s, r) => s + (player.fragments[r] ?? 0), 0);
  const fragBlock = `
    <div class="loadout-row">
      <div class="loadout-label">💠 灵魂碎片 (${fragTotal})</div>
      <div class="loadout-content loadout-frags">
        ${RACES.map(r => {
          const have = player.fragments[r] ?? 0;
          const rare = isRareRace(r);
          const dim = have === 0 ? " loadout-frag-zero" : "";
          return `<span class="loadout-frag-pill${rare ? " rare" : ""}${dim}" title="${RACE_NAMES[r]}（${rare ? "稀少种族" : "普通种族"}）">${FRAGMENT_ICONS[r]} ${FRAGMENT_NAMES[r]} <b>${have}</b></span>`;
        }).join("")}
      </div>
    </div>
  `;

  const overlay = document.createElement("div");
  overlay.id = "loadout-overlay";
  overlay.className = "ic-overlay";
  overlay.innerHTML = `
    <div class="ic-modal loadout-modal">
      <div class="ic-title">📋 当前配置</div>
      <div class="loadout-grid">
        ${wepBlock}
        ${armBlock}
        ${encBlock}
        ${perkBlock}
        ${suitBlock}
        ${fragBlock}
        ${deckBlock}
      </div>
      <div class="ic-actions"><button class="ic-confirm">关闭</button></div>
    </div>
  `;
  overlay.querySelector(".ic-confirm")!.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function renderGameOver() {
  stageEl.innerHTML = `
    <p class="hint">你倒在了第 ${state.floor} 关。</p>
    <button id="new-run-btn" class="big-btn">开启新一局</button>
  `;
  $("new-run-btn").addEventListener("click", () => { state = newGame(); render(); });
}

// ─────────────────────────────────────────────────────────
// 手牌区
// ─────────────────────────────────────────────────────────

function renderHand() {
  const activePanel = document.getElementById("active-panel");
  const endTurnBtn = document.getElementById("end-turn-btn") as HTMLButtonElement | null;
  const discardBtn = document.getElementById("discard-hand-btn") as HTMLButtonElement | null;
  // 非战斗阶段：整个手牌面板隐藏（手牌、结束回合、装备 toggle 都不显示）
  if (state.phase !== "battle") {
    if (activePanel) activePanel.style.display = "none";
    if (endTurnBtn) endTurnBtn.style.display = "none";
    if (discardBtn) discardBtn.style.display = "none";
    return;
  }
  if (activePanel) activePanel.style.display = "";
  handEl.innerHTML = "";
  if (endTurnBtn) {
    endTurnBtn.style.display = "";
    endTurnBtn.disabled = false;  // 总是可用；handleEndTurn 内部用 _isProcessingTurn 防双击
    endTurnBtn.onclick = handleEndTurn;
  }
  if (discardBtn) {
    discardBtn.style.display = "";
    discardBtn.disabled = false;  // 总是可用；空手时弹窗会显示空状态
    discardBtn.onclick = showHandDiscardModal;
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

// 弃手牌弹窗：可勾选多张，确认后一并弃到弃牌堆
function showHandDiscardModal() {
  document.getElementById("hand-discard-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "hand-discard-overlay";
  overlay.className = "ic-overlay";
  overlay.innerHTML = `
    <div class="ic-modal hd-modal">
      <div class="ic-title">主动弃手牌</div>
      <p class="ic-body">点击卡片切换"弃"标记。确认后选中的卡都会进弃牌堆，不消耗本回合。</p>
      <div class="hd-grid"></div>
      <div class="ic-actions">
        <button class="ic-cancel">取消</button>
        <button class="ic-confirm" disabled>确认弃 0 张</button>
      </div>
    </div>
  `;
  const grid = overlay.querySelector(".hd-grid")!;
  const confirmBtn = overlay.querySelector(".ic-confirm") as HTMLButtonElement;
  const selected = new Set<string>();
  if (state.player.hand.length === 0) {
    grid.innerHTML = '<p class="empty" style="color:var(--gray);font-size:11px;text-align:center;padding:20px">手牌已空，无可弃</p>';
  }
  for (const inst of state.player.hand) {
    const def = CARD_DB[inst.defId];
    const rarity = def.rarity ?? "common";
    const item = document.createElement("div");
    item.className = `hd-card cat-${def.category} rarity-${rarity}`;
    item.innerHTML = `
      <div class="hd-card-name">${escapeHTML(def.name)}</div>
      <div class="hd-card-cat">${categoryLabel(def.category)}</div>
    `;
    item.addEventListener("click", () => {
      if (selected.has(inst.uid)) selected.delete(inst.uid);
      else selected.add(inst.uid);
      item.classList.toggle("selected", selected.has(inst.uid));
      confirmBtn.disabled = selected.size === 0;
      confirmBtn.textContent = `确认弃 ${selected.size} 张`;
    });
    grid.appendChild(item);
  }
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => overlay.remove());
  confirmBtn.addEventListener("click", () => {
    if (selected.size === 0) return;
    discardHandCards(state, [...selected]);
    overlay.remove();
    render();
  });
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function renderHandCard(inst: CardInstance): HTMLElement {
  const def = CARD_DB[inst.defId];
  const el = document.createElement("div");
  const hasRepeatingBow = state.battle?.player.weapons[0]?.defId === "repeating_bow";
  const attackUsed = def.category === "attack" && !!state.battle?.attackedThisTurn && !hasRepeatingBow;
  const rarity = def.rarity ?? "common";
  const isEpic = rarity === "epic";
  const epicSpent = isEpic && (inst.usesRemaining ?? 0) <= 0;
  // 持咒本场已用 → 同名副本灰显
  const chantSpent = inst.defId === "sk_chant"
    && !!state.battle?.player.statuses.find(s => s.id === "chanted_used");
  el.className = `card hand-card cat-${def.category} rarity-${rarity}${attackUsed ? " disabled" : ""}${epicSpent ? " epic-spent" : ""}${chantSpent ? " chant-spent" : ""}`;
  const suitSym = def.attackSuit ? SUIT_SYMBOLS[def.attackSuit]
    : def.equipSuit ? SUIT_SYMBOLS[def.equipSuit] : "";
  if (suitSym) el.setAttribute("data-suit", suitSym);

  let suitTag = "";
  if (def.category === "attack") {
    const sym = SUIT_SYMBOLS[def.attackSuit!];
    const isRed = isRedSuit(def.attackSuit!);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${sym}</span>`;
  } else if (def.category === "equipment") {
    const sym = SUIT_SYMBOLS[def.equipSuit!];
    const isRed = isRedSuit(def.equipSuit!);
    // 装备卡只在右上角显示一次花色，不再 SVG 图标下面重复
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${sym}</span>`;
  }

  const catTag = `<span class="cat-tag">${categoryLabel(def.category)}</span>`;
  const usedTag = attackUsed ? `<span class="used-tag">本回合已攻击</span>` : "";
  const epicUsesTag = isEpic
    ? `<span class="epic-uses-tag${epicSpent ? " spent" : ""}" title="史诗卡每场限 3 次，用尽后回到牌库">★ ${inst.usesRemaining ?? 0}/3</span>`
    : "";

  el.innerHTML = `
    ${suitTag}
    ${epicUsesTag}
    <div class="card-icon">${getCardIcon(def.id, def.category)}</div>
    <div class="card-name">${escapeHTML(def.name)}</div>
    <div class="card-desc">${escapeHTML(def.desc)}</div>
    ${usedTag}
    ${catTag}
  `;
  el.addEventListener("click", () => {
    // 装备牌：换装确认（游戏内弹窗）
    if (def.category === "equipment") {
      if (def.equipKind === "weapon" && state.player.weapons.length > 0 && state.player.weapons[0].defId !== def.id) {
        const cur = CARD_DB[state.player.weapons[0].defId].name;
        const cnt = state.player.weapons.length;
        showConfirm({
          title: "替换武器",
          body: `当前：<b>${escapeHTML(cur)}</b> ×${cnt}<br>装备 <b>${escapeHTML(def.name)}</b> 会弃掉全部 ${escapeHTML(cur)}。`,
          confirmLabel: "替换",
          onConfirm: () => {
            gameDiscardWeapons(state);
            playEquipCard(def, inst);
          },
        });
        return;
      }
      if (def.equipKind === "armor" && state.player.armors.length > 0 && state.player.armors[0].defId !== def.id) {
        const cur = CARD_DB[state.player.armors[0].defId].name;
        const cnt = state.player.armors.length;
        showConfirm({
          title: "替换防具",
          body: `当前：<b>${escapeHTML(cur)}</b> ×${cnt}<br>装备 <b>${escapeHTML(def.name)}</b> 会弃掉全部 ${escapeHTML(cur)}。`,
          confirmLabel: "替换",
          onConfirm: () => {
            gameDiscardArmors(state);
            playEquipCard(def, inst);
          },
        });
        return;
      }
    }
    playEquipCard(def, inst);
  });
  return el;
}

// 出装备/打牌的统一入口，封装出牌动效触发
function playEquipCard(def: import("./types.ts").CardDef, inst: CardInstance): void {
  const targetIdx = state.battle?.targetIndex ?? 0;
  if (gamePlayCard(state, inst.uid)) {
    render();
    triggerCardAnimation(def, targetIdx);
  }
}

// 游戏内确认弹窗（替代 native confirm）
interface ConfirmOpts {
  title: string;
  body: string;        // 允许 innerHTML（调用方已 escapeHTML）
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}
function showConfirm(opts: ConfirmOpts): void {
  document.getElementById("ingame-confirm-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "ingame-confirm-overlay";
  overlay.innerHTML = `
    <div id="ingame-confirm-modal">
      <div class="ic-title">${escapeHTML(opts.title)}</div>
      <div class="ic-body">${opts.body}</div>
      <div class="ic-actions">
        <button class="ic-cancel">${escapeHTML(opts.cancelLabel ?? "取消")}</button>
        <button class="ic-confirm">${escapeHTML(opts.confirmLabel)}</button>
      </div>
    </div>
  `;
  const close = () => overlay.remove();
  overlay.querySelector(".ic-cancel")!.addEventListener("click", () => { close(); opts.onCancel?.(); });
  overlay.querySelector(".ic-confirm")!.addEventListener("click", () => { close(); opts.onConfirm(); });
  overlay.addEventListener("click", e => { if (e.target === overlay) { close(); opts.onCancel?.(); } });
  document.body.appendChild(overlay);
}

// 事件结果对话框（事件影响牌组后展示，带卡牌预览，玩家点确认才回地图）
function showEventResultModal(): void {
  const er = state.eventResult;
  if (!er) return;
  const overlay = document.createElement("div");
  overlay.id = "event-result-overlay";
  overlay.className = "ic-overlay";
  let cardHtml = "";
  if (er.cardId) {
    const def = CARD_DB[er.cardId];
    if (def) {
      const rarity = def.rarity ?? "common";
      cardHtml = `
        <div class="er-card-preview cat-${def.category} rarity-${rarity}">
          <div class="er-card-action">${er.cardChange === "gained" ? "+ 加入牌库" : "- 失去"}</div>
          <div class="er-card-name">${escapeHTML(def.name)}</div>
          <div class="er-card-cat">${categoryLabel(def.category)} · ${rarityLabel(rarity)}</div>
          <div class="er-card-desc">${escapeHTML(def.desc)}</div>
        </div>
      `;
    }
  }
  overlay.innerHTML = `
    <div class="ic-modal er-modal er-${er.kind}">
      <div class="ic-title">${escapeHTML(er.title)}</div>
      <div class="er-message">${escapeHTML(er.message)}</div>
      ${cardHtml}
      <div class="ic-actions">
        <button class="ic-confirm">确认</button>
      </div>
    </div>
  `;
  overlay.querySelector(".ic-confirm")!.addEventListener("click", () => {
    state.eventResult = undefined;
    overlay.remove();
    render();
  });
  document.body.appendChild(overlay);
}

// 史诗装备耗尽 → 替换装备 modal（从牌库随机给 3 张同槽非史诗候选）
function showEpicReplacementModal(): void {
  const pe = state.battle?.pendingEpicReplacement;
  if (!pe) return;
  const slotLabel = pe.slot === "weapon" ? "武器" : "防具";
  const candidateInsts = pe.candidates
    .map(uid => state.player.deck.find(c => c.uid === uid))
    .filter((c): c is CardInstance => !!c);

  const cardHtml = candidateInsts.length > 0
    ? candidateInsts.map(inst => {
        const def = CARD_DB[inst.defId];
        const rarity = def.rarity ?? "common";
        const eq = def.equipKind === "weapon"
          ? `⚔ 基础伤害 ${def.baseDmg ?? "—"}${def.hits && def.hits > 1 ? ` × ${def.hits}` : ""}${def.pierce ? ` · 破甲 ${def.pierce}` : ""}`
          : `🛡 基础减伤 ${def.baseReduce ?? "—"}`;
        return `
          <button class="epic-rep-card cat-${def.category} rarity-${rarity}" data-pick-uid="${inst.uid}">
            <div class="erp-name">${escapeHTML(def.name)}</div>
            <div class="erp-meta">${rarityLabel(rarity)} · ${escapeHTML(eq)}</div>
            <div class="erp-desc">${escapeHTML(def.desc)}</div>
          </button>
        `;
      }).join("")
    : `<div class="erp-empty">牌库里没有可用的非史诗${slotLabel}，槽位将空缺。</div>`;

  const overlay = document.createElement("div");
  overlay.id = "epic-replace-overlay";
  overlay.className = "ic-overlay";
  overlay.innerHTML = `
    <div class="ic-modal epic-rep-modal">
      <div class="ic-title">★ 史诗${slotLabel}已耗尽</div>
      <div class="epic-rep-tip">本场使用次数耗尽，从牌库选 1 件替换：</div>
      <div class="epic-rep-grid">${cardHtml}</div>
      <div class="ic-actions">
        <button class="ic-skip">${candidateInsts.length === 0 ? "确认" : "跳过（空槽位）"}</button>
      </div>
    </div>
  `;
  overlay.querySelectorAll<HTMLButtonElement>("[data-pick-uid]").forEach(btn => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.pickUid!;
      if (epicReplacementChoose(state, uid)) {
        overlay.remove();
        render();
      }
    });
  });
  overlay.querySelector(".ic-skip")!.addEventListener("click", () => {
    epicReplacementSkip(state);
    overlay.remove();
    render();
  });
  document.body.appendChild(overlay);
}

// 出牌动效路由：根据卡的 category/target/id 决定播什么动效
function triggerCardAnimation(def: import("./types.ts").CardDef, targetIdx: number): void {
  // 用 setTimeout 而非 rAF — 后者在隐藏标签页里不触发
  setTimeout(() => {
    const targetEl = document.querySelector(`.enemy-card[data-idx="${targetIdx}"]`) as HTMLElement | null;
    const enemiesRow = document.querySelector("#enemies-row") as HTMLElement | null;
    const playerArea = document.querySelector("#player-card") as HTMLElement | null;

    if (def.category === "attack") {
      if (targetEl) playSlashHit(targetEl);
    } else if (def.category === "skill") {
      if (def.target === "all") {
        if (enemiesRow) playAoeWave(enemiesRow, "purple");
      } else if (def.target === "single") {
        if (targetEl) playSkillBurst(targetEl, "purple");
        // 附加：如果 desc 暗示是 debuff（中毒/虚弱/易伤/沉默/冰冻/诅咒）也撒黑暗粒子
        if (targetEl && /中毒|虚弱|易伤|沉默|冰冻|诅咒|腐烂|枯萎/.test(def.desc)) {
          playDebuffApply(targetEl);
        }
      } else {
        // self-buff
        if (playerArea) playBuffApply(playerArea);
      }
    } else if (def.category === "item") {
      if (def.id === "it_heal") {
        if (playerArea) playHealSparkle(playerArea);
      } else if (def.id === "it_bomb") {
        if (enemiesRow) playAoeWave(enemiesRow, "red");
      } else if (def.id === "it_purify") {
        if (playerArea) playHealSparkle(playerArea);
      } else {
        if (playerArea) playBuffApply(playerArea);
      }
    } else if (def.category === "equipment") {
      // 装备进槽：黄色光环（在常驻区上）
      if (playerArea) playEquip(playerArea);
    }
  }, 0);
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
  if (def.attackSuit) {
    const isRed = isRedSuit(def.attackSuit);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.attackSuit]}</span>`;
  } else if (def.equipSuit) {
    const isRed = isRedSuit(def.equipSuit);
    suitTag = `<span class="card-suit-corner${isRed ? " red" : ""}">${SUIT_SYMBOLS[def.equipSuit]}</span>`;
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
    descText = summary;  // 直接用 summary，不加"选后总效果："前缀
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
    showConfirm({
      title: "重新开始",
      body: "当前进度会丢失，确定？",
      confirmLabel: "重开",
      onConfirm: () => {
        state = newGame();
        _logRenderedLen = 0; _prevVita = -1; _prevEnemyHps = []; _prevTurn = -1; _isProcessingTurn = false;
        render();
      },
    });
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
        ${renderCodexTabs()}
      </div>
      <div id="codex-content"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderTab(cat: string) {
    const content = document.getElementById("codex-content");
    if (!content) return;
    if (cat === "enchant") {
      // 按 4 花色分组（每组内：初级 → 复合）
      const branchOrder: Suit[] = ["spade", "diamond", "heart", "club"];
      const branchEnchants = new Map<Suit, EnchantId[]>();
      for (const s of branchOrder) branchEnchants.set(s, []);
      for (const eid of ENCHANTS) branchEnchants.get(ENCHANT_RECIPES[eid].branch)!.push(eid);
      // 每组内按 kind 排序：single → composite，再按 hasRare 升序（普通 → 强档 → 究极）
      for (const list of branchEnchants.values()) {
        list.sort((a, b) => {
          const ra = ENCHANT_RECIPES[a], rb = ENCHANT_RECIPES[b];
          if (ra.kind !== rb.kind) return ra.kind === "single" ? -1 : 1;
          return Number(ra.hasRare) - Number(rb.hasRare);
        });
      }

      const renderEnchantCard = (eid: EnchantId): string => {
        const r = ENCHANT_RECIPES[eid];
        const tier = r.doubleRare ? "究极" : r.hasRare ? "强档" : "普通";
        const variant = r.variant === "specialize" ? "特化" : "互补";
        const kindLabel = r.kind === "single" ? "初级" : "复合";
        const costStr = Object.entries(r.cost)
          .map(([rc, n]) => `${FRAGMENT_ICONS[rc as EnemyRace]}${FRAGMENT_NAMES[rc as EnemyRace]} ×${n}`)
          .join(" + ");
        const tierClass = r.doubleRare ? " codex-enchant-ultimate" : r.hasRare ? " codex-enchant-rare" : "";
        return `
          <div class="codex-card codex-enchant${tierClass}">
            <div class="codex-card-head">
              <span class="codex-card-name">${ENCHANT_NAMES[eid]}</span>
              <span class="codex-cat">${kindLabel} · ${variant}${tier === "普通" ? "" : ` · ${tier}`}</span>
            </div>
            <div class="codex-card-desc">${escapeHTML(ENCHANT_DESCS[eid])}</div>
            <div class="codex-card-cost">配方：${costStr}</div>
          </div>
        `;
      };

      content.innerHTML = branchOrder.map(suit => {
        const list = branchEnchants.get(suit)!;
        const theme = SUIT_THEMES[suit];
        const sym = SUIT_SYMBOLS[suit];
        return `
          <div class="codex-enchant-branch">
            <div class="codex-enchant-branch-head" style="color:${theme.color}">
              <span class="codex-enchant-branch-sym">${sym}</span>
              <span class="codex-enchant-branch-name">${theme.name}</span>
              <span class="codex-enchant-branch-count">（${list.length}）</span>
            </div>
            <div class="codex-enchant-branch-list">
              ${list.map(renderEnchantCard).join("")}
            </div>
          </div>
        `;
      }).join("");
      return;
    }
    const defs = Object.values(CARD_DB).filter(d => filterByCodexTab(d, cat));
    // 按稀有度排序：epic → super_rare → rare → common（让 epic/SR 排在最前一目了然）
    const rarityOrder: Record<string, number> = { epic: 0, super_rare: 1, rare: 2, common: 3 };
    defs.sort((a, b) => {
      const ra = rarityOrder[a.rarity ?? "common"];
      const rb = rarityOrder[b.rarity ?? "common"];
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "zh");
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

// 群攻技能的固定 id 集合（影响 codex 分类 + 数字统计）
const _AOE_SKILL_IDS = new Set([
  "sk_chain_bolt", "sk_fire_wall", "sk_shockwave", "sk_group_curse",
  "sk_sonic", "sk_mass_weak", "sk_lightning", "sk_curse_vortex",
  "sk_chroma_wave", "sk_wrath",
]);

// 图鉴 tab 过滤逻辑
function filterByCodexTab(d: import("./types.ts").CardDef, cat: string): boolean {
  if (cat === "weapon")       return d.category === "equipment" && d.equipKind === "weapon";
  if (cat === "armor")        return d.category === "equipment" && d.equipKind === "armor";
  if (cat === "skill_single") return d.category === "skill" && !_AOE_SKILL_IDS.has(d.id);
  if (cat === "skill_aoe")    return d.category === "skill" && _AOE_SKILL_IDS.has(d.id);
  if (cat === "item")         return d.category === "item";
  if (cat === "perk")         return d.category === "perk";
  if (cat === "attack")       return d.category === "attack";
  return false;
}

// 动态生成 tab 列表（数字根据 CARD_DB 实时计算）
function renderCodexTabs(): string {
  const all = Object.values(CARD_DB);
  const counts = {
    weapon:       all.filter(d => filterByCodexTab(d, "weapon")).length,
    armor:        all.filter(d => filterByCodexTab(d, "armor")).length,
    skill_single: all.filter(d => filterByCodexTab(d, "skill_single")).length,
    skill_aoe:    all.filter(d => filterByCodexTab(d, "skill_aoe")).length,
    item:         all.filter(d => filterByCodexTab(d, "item")).length,
    perk:         all.filter(d => filterByCodexTab(d, "perk")).length,
    enchant:      ENCHANTS.length,
    attack:       all.filter(d => filterByCodexTab(d, "attack")).length,
  };
  return [
    `<button class="codex-tab active" data-cat="weapon">武器（${counts.weapon}）</button>`,
    `<button class="codex-tab" data-cat="armor">防具（${counts.armor}）</button>`,
    `<button class="codex-tab" data-cat="skill_single">单体技能（${counts.skill_single}）</button>`,
    `<button class="codex-tab" data-cat="skill_aoe">群攻（${counts.skill_aoe}）</button>`,
    `<button class="codex-tab" data-cat="item">道具（${counts.item}）</button>`,
    `<button class="codex-tab" data-cat="perk">特性（${counts.perk}）</button>`,
    `<button class="codex-tab" data-cat="enchant">武器附魔（${counts.enchant}）</button>`,
    `<button class="codex-tab" data-cat="attack">攻击牌（${counts.attack}）</button>`,
  ].join("");
}

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
  // 隐藏 workbench panel — 只是为了兼容 index.html 里 display:none 的元素，无实际功能
});

render();

// Auto-show onboarding on first visit
if (!localStorage.getItem(ONBOARDING_KEY)) {
  showOnboarding(0);
}
