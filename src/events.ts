// 楼层间随机事件 v1
//
// 触发：每关末（reward_perk 后）70% 概率 roll 出一个事件
// 事件不会有跨关 debuff/减血（因为战斗间清空），用永久 HP 上限或下场战斗特效作为代价
//
// 5 个事件全部"风险型"（无保底、需玩家决策）：
//   🛒 流浪商人  — 5 张候选可购买（碎片付费）+ 3:1 兑换碎片
//   🎲 赌徒      — 三档（小注/中注/大注），不同代价对应不同回报概率
//   ⛲ 古老神龛  — 用 % HP 上限抵扣换 super_rare / epic 卡
//   🐦‍⬛ 诡异术士  — 三选一普通特性免费送
//   📦 神秘宝箱  — 大概率好货 + 5% epic + 20% 触发跨场战斗陷阱

import type { GameState, CardInstance, EnemyRace, CardRarity } from "./types.ts";
import { RACES, FRAGMENT_NAMES, FRAGMENT_ICONS } from "./types.ts";
import {
  CARD_DB,
  REWARD_CARD_POOL_BASE,
  REWARD_CARD_POOL_AOE,
  PERK_POOL,
  rarityWeights,
  rollRewardChoices,
  makeInstance,
} from "./cards.ts";

// ─────────────────────────────────────────────────────────
// 事件 ID
// ─────────────────────────────────────────────────────────

export type EventId = "merchant" | "gambler" | "shrine" | "wizard" | "chest";

export const EVENT_META: Record<EventId, { icon: string; name: string; desc: string }> = {
  merchant: { icon: "🛒", name: "流浪商人", desc: "一个穿着旧斗篷的商人正在摆摊，灵魂碎片是他认可的货币。" },
  gambler:  { icon: "🎲", name: "赌徒",     desc: "命运之轮在你面前转动。下注，看运气如何。" },
  shrine:   { icon: "⛲", name: "古老神龛", desc: "石龛上刻满血色符文。神祇要求献祭你的生命换取力量。" },
  wizard:   { icon: "🐦‍⬛", name: "诡异术士", desc: "一位戴着乌鸦面具的术士对你点头。她递出三张折叠的卷轴。" },
  chest:    { icon: "📦", name: "神秘宝箱", desc: "锁链已经锈蚀。打开会获得财宝，也可能触发古老的陷阱。" },
};

// 全部 5 个事件等概率（用户可以加权重，先简单等权）
const ALL_EVENTS: EventId[] = ["merchant", "gambler", "shrine", "wizard", "chest"];

// 触发概率
const EVENT_TRIGGER_RATE = 0.7;

// 每关末调用：返回事件 ID 或 null（未触发）
export function rollFloorEvent(): EventId | null {
  if (Math.random() >= EVENT_TRIGGER_RATE) return null;
  return ALL_EVENTS[Math.floor(Math.random() * ALL_EVENTS.length)];
}

// ─────────────────────────────────────────────────────────
// 商人 — 5 张候选库存生成
// ─────────────────────────────────────────────────────────

export const MERCHANT_PRICES: Record<CardRarity, number> = {
  common: 5,
  rare: 7,
  super_rare: 10,
  epic: 30,
};

export function generateMerchantStock(floor: number): CardInstance[] {
  // 5 张候选，按楼层稀有度权重无放回抽
  const pool = floor >= 3
    ? [...REWARD_CARD_POOL_BASE, ...REWARD_CARD_POOL_AOE]
    : REWARD_CARD_POOL_BASE;
  return rollRewardChoices(pool, 5, floor);
}

// 玩家购买（混搭支付）：spend = 5 种族任意搭配，总和必须等于价格
export function tryPurchaseMerchantCardMixed(
  state: GameState,
  card: CardInstance,
  spend: Partial<Record<EnemyRace, number>>,
): { ok: boolean; reason?: string } {
  const def = CARD_DB[card.defId];
  const price = MERCHANT_PRICES[(def.rarity ?? "common") as CardRarity];
  let total = 0;
  for (const r in spend) total += spend[r as EnemyRace] ?? 0;
  if (total !== price) {
    return { ok: false, reason: `需要总共 ${price} 个碎片（当前选 ${total}）` };
  }
  // 校验库存
  for (const r in spend) {
    const need = spend[r as EnemyRace] ?? 0;
    if ((state.player.fragments[r as EnemyRace] ?? 0) < need) {
      return { ok: false, reason: `${FRAGMENT_NAMES[r as EnemyRace]} 库存不足` };
    }
  }
  // 扣
  for (const r in spend) {
    const need = spend[r as EnemyRace] ?? 0;
    state.player.fragments[r as EnemyRace] -= need;
  }
  card.acquiredAtFloor = state.floor;
  state.player.deck.push(card);
  return { ok: true };
}

// 兑换碎片：3 个 source → 1 个 target
export function tradeFragments(
  state: GameState,
  fromRace: EnemyRace,
  toRace: EnemyRace,
): { ok: boolean; reason?: string } {
  if (fromRace === toRace) return { ok: false, reason: "不能换自己" };
  const have = state.player.fragments[fromRace] ?? 0;
  if (have < 3) return { ok: false, reason: `${FRAGMENT_NAMES[fromRace]} 不足 3 个` };
  state.player.fragments[fromRace] = have - 3;
  state.player.fragments[toRace] = (state.player.fragments[toRace] ?? 0) + 1;
  return { ok: true };
}

// ─────────────────────────────────────────────────────────
// 赌徒 — 三档玩法
// ─────────────────────────────────────────────────────────

export interface GamblerOption {
  id: "small" | "medium" | "large";
  label: string;
  costDesc: string;
  rewardDesc: string;
  available: (state: GameState) => boolean;
  apply: (state: GameState) => string;  // 返回结果文字
}

export const GAMBLER_OPTIONS: GamblerOption[] = [
  {
    id: "small",
    label: "小注",
    costDesc: "随机弃 1 张牌库的牌",
    rewardDesc: "80% 抽 1 张 common · 20% 啥也没有",
    available: (s) => s.player.deck.length >= 1,
    apply: (s) => {
      const idx = Math.floor(Math.random() * s.player.deck.length);
      const removed = s.player.deck.splice(idx, 1)[0];
      const removedName = CARD_DB[removed.defId]?.name ?? "?";
      if (Math.random() < 0.8) {
        const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === "common");
        const newId = pool[Math.floor(Math.random() * pool.length)];
        const inst = makeInstance(newId, undefined, s.floor);
        s.player.deck.push(inst);
        return `弃掉 ${removedName}，抽到 ${CARD_DB[newId].name}（common）。`;
      }
      return `弃掉 ${removedName}，抽到... 啥也没有。`;
    },
  },
  {
    id: "medium",
    label: "中注",
    costDesc: "随机弃 2 张牌库的牌",
    rewardDesc: "50% rare · 30% common · 20% 啥也没有",
    available: (s) => s.player.deck.length >= 2,
    apply: (s) => {
      const removed: string[] = [];
      for (let k = 0; k < 2; k++) {
        if (s.player.deck.length === 0) break;
        const idx = Math.floor(Math.random() * s.player.deck.length);
        const r = s.player.deck.splice(idx, 1)[0];
        removed.push(CARD_DB[r.defId]?.name ?? "?");
      }
      const r = Math.random();
      if (r < 0.5) {
        const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === "rare");
        const newId = pool[Math.floor(Math.random() * pool.length)];
        const inst = makeInstance(newId, undefined, s.floor);
        s.player.deck.push(inst);
        return `弃掉 [${removed.join("、")}]，抽到 ${CARD_DB[newId].name}（rare）。`;
      }
      if (r < 0.8) {
        const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === "common");
        const newId = pool[Math.floor(Math.random() * pool.length)];
        const inst = makeInstance(newId, undefined, s.floor);
        s.player.deck.push(inst);
        return `弃掉 [${removed.join("、")}]，抽到 ${CARD_DB[newId].name}（common）。`;
      }
      return `弃掉 [${removed.join("、")}]，啥也没有。`;
    },
  },
  {
    id: "large",
    label: "大注",
    costDesc: "永久 -10% HP 上限",
    rewardDesc: "30% epic · 30% super_rare · 40% common",
    available: (s) => s.player.vitaMax >= 20,  // 至少 20 上限才能扣
    apply: (s) => {
      const lost = Math.max(2, Math.round(s.player.vitaMax * 0.10));
      s.player.vitaMax -= lost;
      s.player.vita = Math.min(s.player.vita, s.player.vitaMax);
      const r = Math.random();
      let pickedRarity: CardRarity = "common";
      if (r < 0.3) pickedRarity = "epic";
      else if (r < 0.6) pickedRarity = "super_rare";
      // floor-aware pool（epic 会回退到 super_rare 如果池里没的话，理论 always 有）
      const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === pickedRarity);
      const newId = pool[Math.floor(Math.random() * pool.length)];
      const inst = makeInstance(newId, undefined, s.floor);
      s.player.deck.push(inst);
      return `献祭 ${lost} HP 上限，抽到 ${CARD_DB[newId].name}（${pickedRarity}）。`;
    },
  },
];

// ─────────────────────────────────────────────────────────
// 神龛 — % HP 上限换卡
// ─────────────────────────────────────────────────────────

export interface ShrineOption {
  hpPct: number;          // 献祭 HP 上限百分比
  rarity: CardRarity;     // 抽到的稀有度
  label: string;
  apply: (state: GameState) => string;
}

export const SHRINE_OPTIONS: ShrineOption[] = [
  {
    hpPct: 15,
    rarity: "super_rare",
    label: "献祭 15% HP 上限 → 1 张 super_rare 牌",
    apply: (s) => {
      const lost = Math.max(3, Math.round(s.player.vitaMax * 0.15));
      s.player.vitaMax -= lost;
      s.player.vita = Math.min(s.player.vita, s.player.vitaMax);
      const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === "super_rare");
      const newId = pool[Math.floor(Math.random() * pool.length)];
      const inst = makeInstance(newId, undefined, s.floor);
      s.player.deck.push(inst);
      return `献祭 ${lost} HP 上限，得到 ${CARD_DB[newId].name}（super_rare）。`;
    },
  },
  {
    hpPct: 25,
    rarity: "epic",
    label: "献祭 25% HP 上限 → 1 张 epic 牌",
    apply: (s) => {
      const lost = Math.max(5, Math.round(s.player.vitaMax * 0.25));
      s.player.vitaMax -= lost;
      s.player.vita = Math.min(s.player.vita, s.player.vitaMax);
      const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === "epic");
      const newId = pool[Math.floor(Math.random() * pool.length)];
      const inst = makeInstance(newId, undefined, s.floor);
      s.player.deck.push(inst);
      return `献祭 ${lost} HP 上限，得到 ${CARD_DB[newId].name}（epic）。`;
    },
  },
];

// ─────────────────────────────────────────────────────────
// 诡异术士 — 三选一普通特性免费
// ─────────────────────────────────────────────────────────

export function generateWizardChoices(floor: number): CardInstance[] {
  // 简单：从 PERK_POOL 不放回抽 3 张
  const shuffled = [...PERK_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3).map(id => makeInstance(id, undefined, floor));
}

export function applyWizardPick(state: GameState, perkInst: CardInstance) {
  perkInst.acquiredAtFloor = state.floor;
  state.player.perks.push(perkInst);
}

// ─────────────────────────────────────────────────────────
// 神秘宝箱 — 概率开盒
// 开盒结果：50% rare / 25% super_rare / 5% epic / 20% 触发跨场战斗陷阱
// ─────────────────────────────────────────────────────────

export type ChestTrap = "miss_one" | "miss_two" | "enemy_first";
export const CHEST_TRAP_DESCS: Record<ChestTrap, string> = {
  miss_one:    "下一场战斗起手少摸 1 张牌",
  miss_two:    "下一场战斗起手少摸 2 张牌",
  enemy_first: "下一场战斗敌人先手（你被打 1 次）",
};

export interface ChestResult {
  type: "card" | "trap";
  rarityOrTrap: CardRarity | ChestTrap;
  message: string;
}

export function openChest(state: GameState): ChestResult {
  const r = Math.random();
  if (r < 0.50) {
    return openChestCard(state, "rare", "rare 卡");
  }
  if (r < 0.75) {
    return openChestCard(state, "super_rare", "super_rare 卡");
  }
  if (r < 0.80) {
    return openChestCard(state, "epic", "epic 卡");
  }
  // 20% 触发陷阱
  const traps: ChestTrap[] = ["miss_one", "miss_two", "enemy_first"];
  const trap = traps[Math.floor(Math.random() * traps.length)];
  state.player.nextBattlePenalty = trap;
  return {
    type: "trap",
    rarityOrTrap: trap,
    message: `陷阱！${CHEST_TRAP_DESCS[trap]}。`,
  };
}

function openChestCard(state: GameState, r: CardRarity, label: string): ChestResult {
  const pool = REWARD_CARD_POOL_BASE.filter(id => (CARD_DB[id]?.rarity ?? "common") === r);
  const newId = pool[Math.floor(Math.random() * pool.length)];
  const inst = makeInstance(newId, undefined, state.floor);
  state.player.deck.push(inst);
  return {
    type: "card",
    rarityOrTrap: r,
    message: `开到 ${CARD_DB[newId].name}（${label}）。`,
  };
}

// ─────────────────────────────────────────────────────────
// 帮助：访问内部以便 main.ts 渲染时使用
// ─────────────────────────────────────────────────────────

export { rarityWeights, RACES, FRAGMENT_NAMES, FRAGMENT_ICONS };
