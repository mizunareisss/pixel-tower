/**
 * Headless simulator —— 用 AI policy 跑大量场次，收集数据测难度/build/物价等。
 * Usage:
 *   npx tsx src/simulator.ts [--runs=N] [--maxFloor=N] [--seed=N] [--out=path]
 *
 * 注意：模拟器是无界面的，玩家决策由 AI policy 模拟。
 */

import * as Game from "./game.ts";
import { CARD_DB, BASIC_WEAPONS, BASIC_ARMORS } from "./cards.ts";
import { generateFloorMap as _gfm, getReachableNodes, getNode } from "./map.ts";
import { GAMBLER_OPTIONS, SHRINE_OPTIONS, MERCHANT_PRICES, MERCHANT_SELL_PRICES } from "./events.ts";
import {
  ENCHANTS, ENCHANT_RECIPES, isRareRace, SUITS, RACES,
} from "./types.ts";
import type {
  GameState, Suit, EnemyRace, EnchantId, CardInstance, MapNode,
} from "./types.ts";
import { getSuitAffinity, suitTier, getActiveSpecialty } from "./battle.ts";

// silence map.ts unused warning
void _gfm;

// ── 配置 ─────────────────────────────────────────────────
interface SimOptions {
  runs: number;
  maxFloor: number;
  seed?: number;
  verbose: boolean;
  out?: string;
}

// ── 单局结果 ─────────────────────────────────────────────
interface RunResult {
  runId: number;
  reachedFloor: number;
  deathFloor: number;             // 实际死亡的关（与 reachedFloor 通常一致）
  battlesWon: number;
  cause: "hp_zero" | "stuck" | "max_floor_reached";
  finalHp: number;
  finalMaxHp: number;
  // 流派 build
  intendedBuild: Suit | null;     // AI 选择的"想要"流派
  finalMainSuit: Suit | null;     // 最终最强流派
  finalSuitAffinity: Record<Suit, number>;
  finalSuitTier: Record<Suit, 0|1|2|3>;
  activatedTierByFloor: { floor: number; tier: number }[];  // Tier 解锁路径
  ultsReleased: Record<Suit, number>;
  // 牌库/装备/特性
  perkCounts: Record<string, number>;
  weapons: string[];              // 最终装备的武器
  armors: string[];
  enchant: EnchantId | null;
  deckSize: number;
  cardCounts: Record<string, number>;  // 全牌库每张 def 数量
  // 使用率
  cardPlayedCounts: Record<string, number>;  // 每张卡出过的次数
  ultsTried: Record<Suit, number>;
  // 碎片 / 商店
  fragmentsEarned: Record<EnemyRace, number>;
  fragmentsFinal: Record<EnemyRace, number>;
  shopVisits: number;
  shopPurchases: number;
  shopPurchasedDefs: string[];    // 在商店买过的 defId
  shopSells: number;
  shopTrades: number;
  forgeVisits: number;
  forgeApplied: number;
  recolorUsed: number;
  // 事件
  eventCounts: Record<string, number>;
  // 状态触发（用于诊断机制是否正确触发）
  triggeredStatuses: Record<string, number>;
  // 错误日志（机制异常）
  errors: string[];
}

const emptySuitRec = (): Record<Suit, number> => ({ spade: 0, diamond: 0, heart: 0, club: 0 });
const emptyRaceRec = (): Record<EnemyRace, number> =>
  ({ beast: 0, humanoid: 0, undead: 0, giant: 0, dark: 0 });

// ── 简单 PRNG（占位；当前不替换 Math.random，仅留种子配置入口）───
function srand(_s: number) { /* placeholder for future deterministic seeding */ }

// ── AI policy ────────────────────────────────────────────
// 每局开始时 AI 决定一个"想要的流派"。后续选牌/选路线尽量靠拢这个流派。
function pickIntendedBuild(): Suit {
  // 均匀分布，但每局重新 roll 让 4 流派覆盖均匀
  return SUITS[Math.floor(Math.random() * SUITS.length)];
}

// 评估候选 perk 卡对 build 的契合度
function perkAlignment(defId: string, mainSuit: Suit): number {
  const def = CARD_DB[defId];
  if (!def) return 0;
  const s = def.defaultSuit;
  if (s === mainSuit) return 2;  // 完美对齐
  if (!s) return 1;               // 中性
  // 红黑对立算半反向
  const redMain = mainSuit === "heart" || mainSuit === "diamond";
  const redCard = s === "heart" || s === "diamond";
  return redMain === redCard ? 1 : 0.5;
}

// 评估候选装备/技能/道具对 build 的契合度
function cardAlignment(defId: string, mainSuit: Suit): number {
  const def = CARD_DB[defId];
  if (!def) return 0;
  // 装备：同花色 = 高分
  if (def.category === "equipment" && def.equipSuit) {
    return def.equipSuit === mainSuit ? 2.5 : 1;
  }
  // 攻击牌
  if (def.category === "attack" && def.attackSuit) {
    return def.attackSuit === mainSuit ? 2 : 1;
  }
  // 花色操作牌：高价值（任何 build 都需要）
  if (["sk_dye", "sk_attune", "sk_chant", "sk_recolor"].includes(defId)) return 1.8;
  // 史诗装备/卡：高价值
  if (def.rarity === "epic") return 2;
  // 通用 buff / 道具
  if (def.category === "skill" || def.category === "item") return 1.0;
  return 1.0;
}

// AI 选起手特性
function aiPickStarterPerks(state: GameState, intendedSuit: Suit, result: RunResult) {
  let safety = 0;
  while (state.phase === "starter_perk_picks" && state.choices.length > 0 && safety++ < 20) {
    let best: CardInstance | null = null;
    let bestScore = -1;
    for (const c of state.choices) {
      const score = perkAlignment(c.defId, intendedSuit) + Math.random() * 0.3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break;
    Game.pickStarterPerk(state, best.uid);
    result.perkCounts[best.defId] = (result.perkCounts[best.defId] ?? 0) + 1;
  }
}

// AI 选地图节点（按当前需求：HP 低 → 优先非战斗节点 / 否则按当前 build 缺啥）
function aiPickMapNode(state: GameState, _intendedSuit: Suit): string | null {
  if (!state.floorMap) return null;
  const reachable = getReachableNodes(state.floorMap);
  if (reachable.length === 0) return null;
  // 终局节点（boss/elite 末场）必须走
  const isLast = reachable.some(n => n.id === state.floorMap!.bossNodeId);
  if (isLast) {
    const last = reachable.find(n => n.id === state.floorMap!.bossNodeId);
    if (last) return last.id;
  }
  // 评分：根据当前需求
  const hpRatio = state.player.vita / state.player.vitaMax;
  const scores: { node: MapNode; score: number }[] = reachable.map(n => {
    let s = Math.random() * 0.5;
    if (n.type === "forge") s += 1.8;  // 铁匠铺总是高优先（加附魔）
    else if (n.type === "shop") s += 1.5;
    else if (n.type === "event") s += 1.2;
    else if (n.type === "elite") s += hpRatio > 0.6 ? 1.5 : 0.3;  // 状态好就挑战
    else if (n.type === "battle") s += 1.0;
    else if (n.type === "boss") s += 1.5;
    return { node: n, score: s };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores[0].node.id;
}

// AI 在战斗内出牌：每回合的决策循环
function aiPlayBattle(state: GameState, intendedSuit: Suit, result: RunResult): boolean {
  // 用 battle.turn（持久跨调用）作为防卡死边界，避免 outer 重新调用时 inner counter 重置
  const TURN_CAP = 100;
  let inner = 0;
  while (state.phase === "battle" && state.battle && inner++ < TURN_CAP) {
    if (state.battle.turn >= TURN_CAP) break;  // 全场超过 100 回合直接退出
    if (state.battle.phase !== "playerTurn") break;
    if (!state.battle.enemies.some(e => e.alive)) break;

    // 选目标：优先 HP 低的
    const alive = state.battle.enemies.map((e, i) => ({ e, i })).filter(x => x.e.alive);
    if (alive.length === 0) break;
    alive.sort((a, b) => a.e.hp - b.e.hp);
    Game.gameSelectTarget(state, alive[0].i);

    // 决策：可出的牌排序
    const hand = state.battle.player.hand;
    if (hand.length === 0) {
      Game.gameEndTurn(state);
      continue;
    }

    // 分类
    const attackCards = hand.filter(c => CARD_DB[c.defId]?.category === "attack");
    const itemCards = hand.filter(c => CARD_DB[c.defId]?.category === "item");
    const skillCards = hand.filter(c => CARD_DB[c.defId]?.category === "skill");
    const equipCards = hand.filter(c => CARD_DB[c.defId]?.category === "equipment");

    // 1) 先装备（如果有同款 or 槽位空）
    let playedThisTurn = false;
    for (const c of equipCards) {
      const def = CARD_DB[c.defId];
      const isWeapon = def.equipKind === "weapon";
      const cur = isWeapon ? state.battle.player.weapons : state.battle.player.armors;
      const sameKind = cur.length > 0 && cur[0].defId === c.defId;
      const empty = cur.length === 0;
      const sameSuit = def.equipSuit === intendedSuit;
      // 同款叠加或空槽 → 总装；不同款只有在同 build 花色时才换
      if (sameKind || empty || sameSuit) {
        // 如果是换装：先 discard
        if (cur.length > 0 && cur[0].defId !== c.defId) {
          if (isWeapon) Game.gameDiscardWeapons(state);
          else Game.gameDiscardArmors(state);
        }
        if (Game.gamePlayCard(state, c.uid)) {
          playedThisTurn = true;
          result.cardPlayedCounts[c.defId] = (result.cardPlayedCounts[c.defId] ?? 0) + 1;
          break;
        }
      }
    }

    // 2) HP 危险且有回血/护盾道具 → 出
    const hpRatio = state.battle.player.vita / state.battle.player.vitaMax;
    if (!playedThisTurn && hpRatio < 0.4) {
      const healCard = itemCards.find(c => ["it_heal", "it_elixir", "it_brew"].includes(c.defId));
      const shieldCard = skillCards.find(c => ["sk_aegis", "sk_counter_stance", "sk_evasive"].includes(c.defId));
      const pick = healCard ?? shieldCard;
      if (pick && Game.gamePlayCard(state, pick.uid)) {
        playedThisTurn = true;
        result.cardPlayedCounts[pick.defId] = (result.cardPlayedCounts[pick.defId] ?? 0) + 1;
      }
    }

    // 3) 大招优先（如果当前激活专精 T3 可释放）
    if (!playedThisTurn) {
      const active = getActiveSpecialty(state.battle);
      if (active && suitTier(state.battle, active) >= 3) {
        const ok = Game.releaseSuitUltimate(state, active);
        if (ok) {
          result.ultsReleased[active] = (result.ultsReleased[active] ?? 0) + 1;
          result.ultsTried[active] = (result.ultsTried[active] ?? 0) + 1;
          playedThisTurn = true;
        }
      }
    }

    // 4) buff 技能（蓄力/磨刀/激奋等）— 出过的攻击牌前用
    if (!playedThisTurn) {
      const buffOrder = ["sk_charge", "it_whetstone", "sk_battle_cry", "sk_frenzy", "sk_focus", "sk_shadow_strike", "sk_rhythm", "sk_pierce_strike", "sk_arcane_burst"];
      for (const id of buffOrder) {
        const card = skillCards.find(c => c.defId === id) ?? itemCards.find(c => c.defId === id);
        if (card && Game.gamePlayCard(state, card.uid)) {
          playedThisTurn = true;
          result.cardPlayedCounts[card.defId] = (result.cardPlayedCounts[card.defId] ?? 0) + 1;
          break;
        }
      }
    }

    // 5) 攻击牌（优先攻击 intendedSuit 同色 → 否则任意）
    if (!playedThisTurn && !state.battle.attackedThisTurn) {
      const sameColorAtk = attackCards.find(c => CARD_DB[c.defId].attackSuit === intendedSuit);
      const anyAtk = sameColorAtk ?? attackCards[0];
      if (anyAtk && Game.gamePlayCard(state, anyAtk.uid)) {
        playedThisTurn = true;
        result.cardPlayedCounts[anyAtk.defId] = (result.cardPlayedCounts[anyAtk.defId] ?? 0) + 1;
        // 出花色选择（如果触发）
        if (state.phase === "suit_pick" && state.battle?.pendingSuitPick) {
          Game.gameSuitPicked(state, intendedSuit);
        }
      }
    }

    // 6) 花色操作（dye/chant/attune）
    if (!playedThisTurn) {
      const opOrder = ["sk_chant", "sk_dye", "sk_attune"];
      for (const id of opOrder) {
        const card = skillCards.find(c => c.defId === id);
        if (card && Game.gamePlayCard(state, card.uid)) {
          playedThisTurn = true;
          result.cardPlayedCounts[card.defId] = (result.cardPlayedCounts[card.defId] ?? 0) + 1;
          // 出花色选择
          if (state.phase === "suit_pick" && state.battle?.pendingSuitPick) {
            Game.gameSuitPicked(state, intendedSuit);
          }
          break;
        }
      }
    }

    // 7) 任意可出的（debuff、其他技能）
    if (!playedThisTurn) {
      for (const c of [...skillCards, ...itemCards]) {
        if (Game.gamePlayCard(state, c.uid)) {
          playedThisTurn = true;
          result.cardPlayedCounts[c.defId] = (result.cardPlayedCounts[c.defId] ?? 0) + 1;
          // 处理花色选择
          if (state.phase === "suit_pick" && state.battle?.pendingSuitPick) {
            Game.gameSuitPicked(state, intendedSuit);
          }
          break;
        }
      }
    }

    // 没出任何牌 → 结束回合
    if (!playedThisTurn) {
      Game.gameEndTurn(state);
    }

    // 处理 Epic 替换 modal
    if (state.battle?.pendingEpicReplacement) {
      const { candidates } = state.battle.pendingEpicReplacement;
      if (candidates.length > 0) {
        Game.epicReplacementChoose(state, candidates[0]);
      } else {
        Game.epicReplacementSkip(state);
      }
    }
  }
  return true;
}

// AI 选战利品 (reward_card)
function aiPickRewardCard(state: GameState, intendedSuit: Suit, result: RunResult) {
  if (state.choices.length === 0) {
    Game.skipRewardCard(state);
    return;
  }
  // 选契合度最高的
  let best: CardInstance | null = null;
  let bestScore = -1;
  for (const c of state.choices) {
    const score = cardAlignment(c.defId, intendedSuit) + Math.random() * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best && bestScore > 0.9) {
    Game.pickRewardCard(state, best.uid);
    result.cardCounts[best.defId] = (result.cardCounts[best.defId] ?? 0) + 1;
  } else {
    Game.skipRewardCard(state);
  }
}

// AI 选通关 perk
function aiPickRewardPerk(state: GameState, intendedSuit: Suit, result: RunResult) {
  if (state.choices.length === 0) {
    // 优先 vita up
    Game.pickVitaUp(state);
    return;
  }
  // HP <70% 优先 vita up
  if (state.player.vita / state.player.vitaMax < 0.7 && Math.random() < 0.5) {
    Game.pickVitaUp(state);
    return;
  }
  let best: CardInstance | null = null;
  let bestScore = -1;
  for (const c of state.choices) {
    const score = perkAlignment(c.defId, intendedSuit) + Math.random() * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best) {
    Game.pickRewardPerk(state, best.uid);
    result.perkCounts[best.defId] = (result.perkCounts[best.defId] ?? 0) + 1;
  } else {
    Game.pickVitaUp(state);
  }
}

// AI 铁匠铺：评估并尝试附魔
function aiForge(state: GameState, intendedSuit: Suit, result: RunResult) {
  result.forgeVisits++;
  // 找契合 intendedSuit 的附魔
  const candidates = ENCHANTS.filter(eid => {
    const r = ENCHANT_RECIPES[eid];
    if (r.branch !== intendedSuit) return false;
    // 检查碎片够不够
    for (const race in r.cost) {
      const need = r.cost[race as EnemyRace] ?? 0;
      if ((state.player.fragments[race as EnemyRace] ?? 0) < need) return false;
    }
    return true;
  });
  // 优先复合 > 强档单 > 普通单
  candidates.sort((a, b) => {
    const ra = ENCHANT_RECIPES[a], rb = ENCHANT_RECIPES[b];
    const sa = (ra.kind === "composite" ? 2 : 0) + (ra.doubleRare ? 2 : ra.hasRare ? 1 : 0);
    const sb = (rb.kind === "composite" ? 2 : 0) + (rb.doubleRare ? 2 : rb.hasRare ? 1 : 0);
    return sb - sa;
  });
  if (candidates.length > 0) {
    if (Game.applyEnchant(state, candidates[0])) {
      result.forgeApplied++;
      return;
    }
  }
  // 没合适的就 skip
  Game.skipForge(state);
}

// AI 商店行为
function aiShop(state: GameState, intendedSuit: Suit, result: RunResult) {
  result.shopVisits++;
  // 简化：尝试买 1-2 张契合的卡
  let purchases = 0;
  while (state.merchantStock && state.merchantStock.length > 0 && purchases < 2) {
    const stock = state.merchantStock;
    let best: CardInstance | null = null;
    let bestScore = -1;
    for (const c of stock) {
      const score = cardAlignment(c.defId, intendedSuit);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || bestScore < 1.5) break;  // 不够好就不买
    const def = CARD_DB[best.defId];
    const price = MERCHANT_PRICES[def.rarity ?? "common"];
    const totalFrags = RACES.reduce((s, r) => s + (state.player.fragments[r] ?? 0), 0);
    if (totalFrags < price) break;
    // 混搭支付：先从最多的扣
    const spend: Partial<Record<EnemyRace, number>> = {};
    let need = price;
    const sortedRaces = [...RACES].sort((a, b) =>
      (state.player.fragments[b] ?? 0) - (state.player.fragments[a] ?? 0));
    for (const r of sortedRaces) {
      const have = state.player.fragments[r] ?? 0;
      const use = Math.min(have, need);
      if (use > 0) { spend[r] = use; need -= use; }
      if (need === 0) break;
    }
    if (need > 0) break;
    if (Game.merchantBuyCardMixed(state, best.uid, spend)) {
      result.shopPurchases++;
      purchases++;
      result.cardCounts[best.defId] = (result.cardCounts[best.defId] ?? 0) + 1;
      result.shopPurchasedDefs.push(best.defId);
    } else break;
  }
  Game.merchantLeave(state);
}

// AI 事件（其它事件）
function aiEvent(state: GameState, _intendedSuit: Suit, result: RunResult) {
  const eid = state.activeEventId;
  if (!eid) return;
  result.eventCounts[eid] = (result.eventCounts[eid] ?? 0) + 1;
  if (eid === "merchant") {
    aiShop(state, _intendedSuit, result);
    return;
  }
  if (eid === "gambler") {
    // 选小注最稳
    const opt = GAMBLER_OPTIONS[0];
    if (opt.available(state)) Game.gamblerBet(state, 0);
    else Game.skipFloorEvent(state);
    return;
  }
  if (eid === "shrine") {
    // HP 上限不能太低；随机选
    const idx = state.player.vita / state.player.vitaMax > 0.8 ? 0 : 0;
    void idx; void SHRINE_OPTIONS;
    Game.shrineSacrifice(state, 0);
    return;
  }
  if (eid === "wizard") {
    if (state.choices.length > 0) {
      Game.wizardPick(state, state.choices[0].uid);
    } else {
      Game.skipFloorEvent(state);
    }
    return;
  }
  if (eid === "chest") {
    // 50% 开 / 50% 跳
    if (Math.random() < 0.7) Game.chestOpen(state);
    else Game.skipFloorEvent(state);
    return;
  }
  Game.skipFloorEvent(state);
}

// ── 单局执行 ──────────────────────────────────────────────
function runOnce(runId: number, opts: SimOptions): RunResult {
  const result: RunResult = {
    runId,
    reachedFloor: 0,
    deathFloor: 0,
    battlesWon: 0,
    cause: "stuck",
    finalHp: 0,
    finalMaxHp: 40,
    intendedBuild: null,
    finalMainSuit: null,
    finalSuitAffinity: emptySuitRec(),
    finalSuitTier: { spade: 0, diamond: 0, heart: 0, club: 0 },
    activatedTierByFloor: [],
    ultsReleased: emptySuitRec(),
    ultsTried: emptySuitRec(),
    perkCounts: {},
    weapons: [],
    armors: [],
    enchant: null,
    deckSize: 0,
    cardCounts: {},
    cardPlayedCounts: {},
    fragmentsEarned: emptyRaceRec(),
    fragmentsFinal: emptyRaceRec(),
    shopVisits: 0,
    shopPurchases: 0,
    shopPurchasedDefs: [],
    shopSells: 0,
    shopTrades: 0,
    forgeVisits: 0,
    forgeApplied: 0,
    recolorUsed: 0,
    eventCounts: {},
    triggeredStatuses: {},
    errors: [],
  };

  const state = Game.newGame();
  const intendedSuit = pickIntendedBuild();
  result.intendedBuild = intendedSuit;

  // 记录起始牌库
  for (const c of state.player.deck) {
    result.cardCounts[c.defId] = (result.cardCounts[c.defId] ?? 0) + 1;
  }
  // 基础装备：BASIC_WEAPONS / BASIC_ARMORS 已经在 STARTING_DECK_IDS 里
  void BASIC_WEAPONS; void BASIC_ARMORS;

  let safetyOuter = 0;
  const MAX_OUTER_LOOPS = 2000;
  let lastPhase = "";
  let samePhaseCount = 0;
  let done = false;

  while (safetyOuter++ < MAX_OUTER_LOOPS && !done) {
    // 早期已死亡 / 达到上限 → 退出
    if (state.player.vita <= 0) {
      result.cause = "hp_zero";
      break;
    }
    if (state.floor > opts.maxFloor) {
      result.cause = "max_floor_reached";
      break;
    }
    // 防卡死：phase 连续 N 次没变就 break
    if (state.phase === lastPhase) samePhaseCount++;
    else { samePhaseCount = 0; lastPhase = state.phase; }
    if (samePhaseCount > 30) {
      result.errors.push(`stuck in phase '${state.phase}' for ${samePhaseCount} loops at floor ${state.floor}`);
      result.cause = "stuck";
      break;
    }
    if (opts.verbose && samePhaseCount === 0) {
      console.error(`  [run ${runId}] F${state.floor} phase=${state.phase}`);
    }
    // 检测死亡
    if (state.player.vita <= 0) {
      result.cause = "hp_zero";
      break;
    }
    // 检测达到 maxFloor
    if (state.floor > opts.maxFloor) {
      result.cause = "max_floor_reached";
      break;
    }

    try {
      switch (state.phase) {
        case "starter_perk_picks":
          aiPickStarterPerks(state, intendedSuit, result);
          break;
        case "floor_map": {
          for (const r of RACES) result.fragmentsEarned[r] = (state.player.fragments[r] ?? 0);
          const nodeId = aiPickMapNode(state, intendedSuit);
          if (!nodeId) {
            result.errors.push(`floor_map: no reachable node at floor ${state.floor}`);
            result.cause = "stuck";
            done = true;
            break;
          }
          result.reachedFloor = Math.max(result.reachedFloor, state.floor);
          const ok = Game.enterMapNode(state, nodeId);
          if (!ok) {
            result.errors.push(`enterMapNode failed for ${nodeId}`);
            result.cause = "stuck";
            done = true;
          }
          break;
        }
        case "battle":
          aiPlayBattle(state, intendedSuit, result);
          if (state.battle?.phase === "won") result.battlesWon++;
          // 战斗回合超 50 还没结束 → 玩家 build 不行，强制判负
          if (state.phase === "battle" && state.battle && state.battle.turn >= 50) {
            result.errors.push(`force-quit stalled battle at turn ${state.battle.turn} F${state.floor}`);
            state.player.vita = 0;
            state.phase = "game_over";
            result.cause = "hp_zero";
            done = true;
          }
          break;
        case "suit_pick":
          Game.gameSuitPicked(state, intendedSuit);
          break;
        case "battle_victory":
          Game.continueFromVictory(state);
          break;
        case "reward_card":
          aiPickRewardCard(state, intendedSuit, result);
          break;
        case "reward_perk":
          aiPickRewardPerk(state, intendedSuit, result);
          break;
        case "forge":
          aiForge(state, intendedSuit, result);
          break;
        case "floor_event":
          aiEvent(state, intendedSuit, result);
          break;
        case "discard":
          Game.discardAndAdvance(state, []);
          break;
        case "game_over":
          result.cause = "hp_zero";
          done = true;
          break;
        case "victory":
          result.cause = "max_floor_reached";
          done = true;
          break;
        default:
          result.errors.push(`unknown phase: ${state.phase}`);
          result.cause = "stuck";
          done = true;
      }
    } catch (e: any) {
      result.errors.push(`exception at phase ${state.phase}: ${e?.message ?? e}`);
      result.cause = "stuck";
      done = true;
      break;
    }

    // 检测达到上限
    if (state.player.vita <= 0) {
      result.cause = "hp_zero";
      done = true;
    }
    if (state.floor > opts.maxFloor) {
      result.cause = "max_floor_reached";
      done = true;
    }
  }

  // 收尾统计
  result.finalHp = state.player.vita;
  result.finalMaxHp = state.player.vitaMax;
  result.deathFloor = result.cause === "max_floor_reached" ? opts.maxFloor : state.floor;
  result.weapons = state.player.weapons.map(w => w.defId);
  result.armors = state.player.armors.map(a => a.defId);
  result.enchant = state.player.weaponEnchant ?? null;
  for (const r of RACES) result.fragmentsFinal[r] = state.player.fragments[r] ?? 0;

  // 牌库统计（合并所有区域）
  const allCards = [
    ...state.player.deck, ...state.player.hand, ...state.player.discard,
    ...state.player.weapons, ...state.player.armors, ...state.player.perks,
  ];
  result.deckSize = allCards.length;

  // 最终 build 状态（用 battle state 如有；否则手算）
  if (state.battle) {
    for (const s of SUITS) {
      result.finalSuitAffinity[s] = getSuitAffinity(state.battle, s);
      result.finalSuitTier[s] = suitTier(state.battle, s);
    }
  } else {
    // 没有 battle 时手算亲和度（仅装备+特性+suitPlayedTotal）
    for (const s of SUITS) {
      let aff = 0;
      for (const w of state.player.weapons) if (CARD_DB[w.defId]?.equipSuit === s) aff += 1.5;
      for (const a of state.player.armors) if (CARD_DB[a.defId]?.equipSuit === s) aff += 1.5;
      for (const p of state.player.perks) if (CARD_DB[p.defId]?.defaultSuit === s) aff += 1;
      const played = Math.min(30, state.player.suitPlayedTotal?.[s] ?? 0);
      aff += played * 0.2;
      result.finalSuitAffinity[s] = Math.min(20, aff);
      result.finalSuitTier[s] = (aff >= 15 ? 3 : aff >= 10 ? 2 : aff >= 5 ? 1 : 0) as 0|1|2|3;
    }
  }
  // 最终主流派 = 亲和度最高的
  let maxAff = 0;
  let mainS: Suit | null = null;
  for (const s of SUITS) {
    if (result.finalSuitAffinity[s] > maxAff) {
      maxAff = result.finalSuitAffinity[s];
      mainS = s;
    }
  }
  result.finalMainSuit = mainS;

  return result;
}

// ── 批次执行 + 报告 ───────────────────────────────────────
function aggregateReport(results: RunResult[]): string {
  const n = results.length;
  if (n === 0) return "(no runs)";
  const lines: string[] = [];

  // 1) 整体存活率
  const reached = results.map(r => r.reachedFloor);
  const hpZero = results.filter(r => r.cause === "hp_zero").length;
  const maxOk = results.filter(r => r.cause === "max_floor_reached").length;
  const stuck = results.filter(r => r.cause === "stuck").length;
  reached.sort((a, b) => a - b);
  const median = reached[Math.floor(n / 2)];
  const mean = reached.reduce((a, b) => a + b, 0) / n;
  const p25 = reached[Math.floor(n * 0.25)];
  const p75 = reached[Math.floor(n * 0.75)];
  lines.push(`═══ 整体难度 ═══`);
  lines.push(`runs: ${n}`);
  lines.push(`平均关数: ${mean.toFixed(2)}, 中位: ${median}, P25: ${p25}, P75: ${p75}, max: ${reached[n-1]}`);
  lines.push(`死亡（HP=0）: ${hpZero} (${(100*hpZero/n).toFixed(0)}%)`);
  lines.push(`通顶（${results[0].reachedFloor > 0 ? "max_floor" : "?"}）: ${maxOk} (${(100*maxOk/n).toFixed(0)}%)`);
  lines.push(`卡死: ${stuck}`);
  lines.push("");

  // 2) 流派成型率/强度
  lines.push(`═══ 流派分析 ═══`);
  for (const s of SUITS) {
    const runs = results.filter(r => r.intendedBuild === s);
    if (runs.length === 0) continue;
    const avgFloor = runs.reduce((a, r) => a + r.reachedFloor, 0) / runs.length;
    const t1Runs = runs.filter(r => r.finalSuitTier[s] >= 1).length;
    const t2Runs = runs.filter(r => r.finalSuitTier[s] >= 2).length;
    const t3Runs = runs.filter(r => r.finalSuitTier[s] >= 3).length;
    const ults = runs.reduce((a, r) => a + r.ultsReleased[s], 0);
    const avgAff = runs.reduce((a, r) => a + r.finalSuitAffinity[s], 0) / runs.length;
    lines.push(`${s}: ${runs.length} runs, 平均关 ${avgFloor.toFixed(1)}, 最终亲和 ${avgAff.toFixed(1)}`);
    lines.push(`  T1+: ${t1Runs}/${runs.length} (${(100*t1Runs/runs.length).toFixed(0)}%), T2+: ${t2Runs} (${(100*t2Runs/runs.length).toFixed(0)}%), T3: ${t3Runs} (${(100*t3Runs/runs.length).toFixed(0)}%), 大招总: ${ults}`);
  }
  lines.push("");

  // 3) 卡牌使用率
  lines.push(`═══ 卡牌使用率（出过的次数总和 / runs）═══`);
  const allPlayed: Record<string, number> = {};
  for (const r of results) {
    for (const [id, cnt] of Object.entries(r.cardPlayedCounts)) {
      allPlayed[id] = (allPlayed[id] ?? 0) + cnt;
    }
  }
  const sortedPlayed = Object.entries(allPlayed).sort((a, b) => b[1] - a[1]);
  lines.push("Top 20:");
  for (const [id, cnt] of sortedPlayed.slice(0, 20)) {
    const def = CARD_DB[id];
    lines.push(`  ${id.padEnd(22)} ${def?.name ?? "?"} — ${cnt} 次 (avg ${(cnt/n).toFixed(2)}/run)`);
  }
  lines.push("");

  // 4) 永远没用的卡（在牌库出现但从没被打出的）
  const allCards: Record<string, number> = {};
  for (const r of results) {
    for (const [id, cnt] of Object.entries(r.cardCounts)) {
      allCards[id] = (allCards[id] ?? 0) + cnt;
    }
  }
  const neverPlayed: string[] = [];
  for (const id of Object.keys(allCards)) {
    if (!allPlayed[id] || allPlayed[id] === 0) neverPlayed.push(id);
  }
  if (neverPlayed.length > 0) {
    lines.push(`从没被打出的卡（出现在牌库但 0 次出牌）:`);
    for (const id of neverPlayed) {
      const def = CARD_DB[id];
      lines.push(`  ${id.padEnd(22)} ${def?.name ?? "?"} (在 ${allCards[id]} 张牌库出现过)`);
    }
    lines.push("");
  }

  // 5) 装备 / 附魔分布
  lines.push(`═══ 武器持有 ═══`);
  const wepCounts: Record<string, number> = {};
  for (const r of results) for (const w of r.weapons) wepCounts[w] = (wepCounts[w] ?? 0) + 1;
  for (const [id, cnt] of Object.entries(wepCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(22)} ${CARD_DB[id]?.name ?? "?"} — ${cnt} runs`);
  }
  lines.push("");

  lines.push(`═══ 防具持有 ═══`);
  const armCounts: Record<string, number> = {};
  for (const r of results) for (const a of r.armors) armCounts[a] = (armCounts[a] ?? 0) + 1;
  for (const [id, cnt] of Object.entries(armCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(22)} ${CARD_DB[id]?.name ?? "?"} — ${cnt} runs`);
  }
  lines.push("");

  lines.push(`═══ 附魔分布 ═══`);
  const encCounts: Record<string, number> = {};
  for (const r of results) if (r.enchant) encCounts[r.enchant] = (encCounts[r.enchant] ?? 0) + 1;
  const totalForges = results.reduce((a, r) => a + r.forgeApplied, 0);
  const totalForgeVisits = results.reduce((a, r) => a + r.forgeVisits, 0);
  lines.push(`铁匠铺访问 ${totalForgeVisits} 次，成功附魔 ${totalForges} 次（${(100*totalForges/Math.max(1,totalForgeVisits)).toFixed(0)}% 转化率）`);
  for (const [id, cnt] of Object.entries(encCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(20)} — ${cnt} runs (${(100*cnt/n).toFixed(0)}%)`);
  }
  lines.push("");

  // 6) 商店行为
  lines.push(`═══ 商店行为 ═══`);
  const totShopVisits = results.reduce((a, r) => a + r.shopVisits, 0);
  const totBuys = results.reduce((a, r) => a + r.shopPurchases, 0);
  lines.push(`商店访问: ${totShopVisits}, 购买: ${totBuys} (${(totBuys/Math.max(1,totShopVisits)).toFixed(2)} 张/访问)`);
  // 购买分布
  const buyCounts: Record<string, number> = {};
  for (const r of results) for (const d of r.shopPurchasedDefs) buyCounts[d] = (buyCounts[d] ?? 0) + 1;
  if (Object.keys(buyCounts).length > 0) {
    lines.push("商店购买 Top:");
    const sortedBuys = Object.entries(buyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [id, cnt] of sortedBuys) {
      const def = CARD_DB[id];
      lines.push(`  ${id.padEnd(22)} ${def?.name ?? "?"} — ${cnt} 次`);
    }
  }
  lines.push("");

  // 7) 事件分布
  lines.push(`═══ 事件分布 ═══`);
  const evCounts: Record<string, number> = {};
  for (const r of results) for (const [id, c] of Object.entries(r.eventCounts)) {
    evCounts[id] = (evCounts[id] ?? 0) + c;
  }
  for (const [id, c] of Object.entries(evCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id.padEnd(15)} — ${c}`);
  }
  lines.push("");

  // 8) 错误诊断
  const errorRuns = results.filter(r => r.errors.length > 0);
  if (errorRuns.length > 0) {
    lines.push(`═══ 异常诊断 ═══`);
    lines.push(`${errorRuns.length} runs 有错误。前 10 条：`);
    let shown = 0;
    for (const r of errorRuns) {
      for (const e of r.errors) {
        lines.push(`  [run ${r.runId} reached F${r.reachedFloor}] ${e}`);
        if (++shown >= 10) break;
      }
      if (shown >= 10) break;
    }
    lines.push("");
  }

  // 9) 关数分布直方图
  lines.push(`═══ 关数直方图（死亡 / 通顶时所在关）═══`);
  const histo: Record<number, number> = {};
  for (const r of results) histo[r.reachedFloor] = (histo[r.reachedFloor] ?? 0) + 1;
  for (const f of Object.keys(histo).map(Number).sort((a, b) => a - b)) {
    const cnt = histo[f];
    const bar = "█".repeat(Math.round(cnt * 40 / n));
    lines.push(`  F${String(f).padStart(2)}: ${String(cnt).padStart(4)} ${bar}`);
  }
  lines.push("");

  // 10) 流派 × 关数 — 不同 build 死亡分布
  lines.push(`═══ 流派 × 死亡关 ═══`);
  for (const s of SUITS) {
    const runs = results.filter(r => r.intendedBuild === s);
    if (runs.length === 0) continue;
    const sHisto: Record<number, number> = {};
    for (const r of runs) sHisto[r.reachedFloor] = (sHisto[r.reachedFloor] ?? 0) + 1;
    lines.push(`${s} (${runs.length} runs):`);
    for (const f of Object.keys(sHisto).map(Number).sort((a, b) => a - b)) {
      const cnt = sHisto[f];
      const bar = "█".repeat(Math.round(cnt * 25 / runs.length));
      lines.push(`  F${String(f).padStart(2)}: ${String(cnt).padStart(3)} ${bar}`);
    }
  }

  return lines.join("\n");
}

// ── main ─────────────────────────────────────────────────
function parseArgs(): SimOptions {
  const args = process.argv.slice(2);
  const opts: SimOptions = { runs: 100, maxFloor: 12, verbose: false };
  for (const a of args) {
    if (a.startsWith("--runs=")) opts.runs = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--maxFloor=")) opts.maxFloor = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--seed=")) opts.seed = parseInt(a.split("=")[1], 10);
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a.startsWith("--out=")) opts.out = a.split("=")[1];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (opts.seed !== undefined) srand(opts.seed);

  console.log(`Starting simulation: ${opts.runs} runs, maxFloor=${opts.maxFloor}`);
  const t0 = Date.now();
  const results: RunResult[] = [];
  for (let i = 0; i < opts.runs; i++) {
    const r = runOnce(i + 1, opts);
    results.push(r);
    if ((i + 1) % 25 === 0 || i + 1 === opts.runs) {
      console.error(`  ...${i + 1}/${opts.runs} done`);
    }
  }
  const t1 = Date.now();
  console.error(`\nDone in ${((t1 - t0) / 1000).toFixed(1)}s`);

  const report = aggregateReport(results);
  console.log("\n" + report);

  if (opts.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(opts.out, JSON.stringify(results, null, 2));
    console.error(`\nRaw results written to ${opts.out}`);
  }
}

main();
