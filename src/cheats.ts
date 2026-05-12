// 调试控制台用的"作弊"动作集合
//
// 设计：
//   - 所有动作都直接 mutate state（和 game.ts 风格一致）
//   - 返回 boolean 表示成功，写一条日志方便回溯
//   - 大部分动作不限制 phase（玩家手控 = 想干嘛干嘛），少数（如 cheat_kill_enemy）需要 battle 存在
//   - 战斗中 state.battle.player === state.player（同一引用），所以写 state.player 就够了

import type {
  GameState,
  Suit,
  EnchantId,
  EnemyRace,
  CardInstance,
  StatusEffect,
} from "./types.ts";
import { ENCHANTS, ENCHANT_NAMES } from "./types.ts";
import { CARD_DB, makeInstance, PERK_POOL } from "./cards.ts";

function dbgLog(state: GameState, msg: string): void {
  state.log.push({ msg: `🐞 ${msg}`, kind: "system" });
}

// ─── 牌库 / 手牌 / 弃牌 ─────────────────────────────────────

export function cheatAddCardToHand(
  state: GameState,
  defId: string,
  suit?: Suit,
): boolean {
  const def = CARD_DB[defId];
  if (!def) return false;
  const inst = makeInstance(defId, suit, state.floor);
  state.player.hand.push(inst);
  dbgLog(state, `+1 手牌：${def.name} (${defId})`);
  return true;
}

export function cheatAddCardToDeck(
  state: GameState,
  defId: string,
  suit?: Suit,
): boolean {
  const def = CARD_DB[defId];
  if (!def) return false;
  const inst = makeInstance(defId, suit, state.floor);
  state.player.deck.push(inst);
  dbgLog(state, `+1 牌库：${def.name} (${defId})`);
  return true;
}

export function cheatAddCardToDiscard(
  state: GameState,
  defId: string,
  suit?: Suit,
): boolean {
  const def = CARD_DB[defId];
  if (!def) return false;
  const inst = makeInstance(defId, suit, state.floor);
  state.player.discard.push(inst);
  dbgLog(state, `+1 弃牌：${def.name} (${defId})`);
  return true;
}

export function cheatRemoveCardByUid(state: GameState, uid: string): boolean {
  const zones: ("hand" | "deck" | "discard")[] = ["hand", "deck", "discard"];
  for (const z of zones) {
    const arr = state.player[z];
    const idx = arr.findIndex((c) => c.uid === uid);
    if (idx >= 0) {
      const [removed] = arr.splice(idx, 1);
      dbgLog(state, `-1 ${z}：${CARD_DB[removed.defId]?.name ?? removed.defId}`);
      return true;
    }
  }
  return false;
}

export function cheatClearZone(
  state: GameState,
  zone: "hand" | "deck" | "discard",
): boolean {
  const n = state.player[zone].length;
  state.player[zone] = [];
  dbgLog(state, `清空 ${zone}（移除 ${n} 张）`);
  return true;
}

// ─── 特性 ──────────────────────────────────────────────────

export function cheatAddPerk(state: GameState, defId: string): boolean {
  const def = CARD_DB[defId];
  if (!def || def.category !== "perk") return false;
  const inst = makeInstance(defId, undefined, state.floor);
  state.player.perks.push(inst);
  dbgLog(state, `+1 特性：${def.name} (${defId})`);
  return true;
}

export function cheatRemovePerk(state: GameState, uid: string): boolean {
  const idx = state.player.perks.findIndex((p) => p.uid === uid);
  if (idx < 0) return false;
  const [p] = state.player.perks.splice(idx, 1);
  dbgLog(state, `-1 特性：${CARD_DB[p.defId]?.name ?? p.defId}`);
  return true;
}

// ─── 装备 ──────────────────────────────────────────────────

export function cheatAddEquipment(state: GameState, defId: string): boolean {
  const def = CARD_DB[defId];
  if (!def || def.category !== "equipment") return false;
  const inst = makeInstance(defId, undefined, state.floor);
  if (def.equipKind === "weapon") {
    state.player.weapons.push(inst);
    dbgLog(state, `+1 武器：${def.name}`);
  } else if (def.equipKind === "armor") {
    state.player.armors.push(inst);
    dbgLog(state, `+1 防具：${def.name}`);
  } else {
    return false;
  }
  return true;
}

export function cheatRemoveEquipment(state: GameState, uid: string): boolean {
  for (const slot of ["weapons", "armors"] as const) {
    const arr = state.player[slot];
    const idx = arr.findIndex((c) => c.uid === uid);
    if (idx >= 0) {
      const [removed] = arr.splice(idx, 1);
      dbgLog(state, `-1 ${slot === "weapons" ? "武器" : "防具"}：${CARD_DB[removed.defId]?.name ?? removed.defId}`);
      return true;
    }
  }
  return false;
}

// ─── HP ─────────────────────────────────────────────────────

export function cheatSetHp(state: GameState, hp: number): boolean {
  state.player.vita = Math.max(0, Math.floor(hp));
  if (state.player.vita > state.player.vitaMax) state.player.vita = state.player.vitaMax;
  dbgLog(state, `HP → ${state.player.vita} / ${state.player.vitaMax}`);
  return true;
}

export function cheatSetMaxHp(state: GameState, mhp: number): boolean {
  const v = Math.max(1, Math.floor(mhp));
  state.player.vitaMax = v;
  if (state.player.vita > v) state.player.vita = v;
  dbgLog(state, `maxHP → ${state.player.vitaMax}`);
  return true;
}

export function cheatHealFull(state: GameState): boolean {
  state.player.vita = state.player.vitaMax;
  dbgLog(state, `回满血 → ${state.player.vita}`);
  return true;
}

// ─── 灵魂碎片 ──────────────────────────────────────────────

export function cheatAddFragments(
  state: GameState,
  race: EnemyRace,
  n: number,
): boolean {
  state.player.fragments[race] = Math.max(0, (state.player.fragments[race] ?? 0) + Math.floor(n));
  dbgLog(state, `${race} 碎片 → ${state.player.fragments[race]}`);
  return true;
}

export function cheatSetFragments(
  state: GameState,
  race: EnemyRace,
  n: number,
): boolean {
  state.player.fragments[race] = Math.max(0, Math.floor(n));
  dbgLog(state, `${race} 碎片 设为 ${state.player.fragments[race]}`);
  return true;
}

// ─── 专精（花色亲和度） ────────────────────────────────────

export function cheatAddSuitPlayed(state: GameState, suit: Suit, n: number): boolean {
  if (!state.player.suitPlayedTotal) {
    state.player.suitPlayedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  }
  state.player.suitPlayedTotal[suit] = Math.max(
    0,
    (state.player.suitPlayedTotal[suit] ?? 0) + Math.floor(n),
  );
  dbgLog(state, `${suit} 已打牌 → ${state.player.suitPlayedTotal[suit]}`);
  return true;
}

export function cheatAddSuitConsumed(state: GameState, suit: Suit, n: number): boolean {
  if (!state.player.suitConsumedTotal) {
    state.player.suitConsumedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  }
  state.player.suitConsumedTotal[suit] = Math.max(
    0,
    (state.player.suitConsumedTotal[suit] ?? 0) + Math.floor(n),
  );
  dbgLog(state, `${suit} 大招消耗 → ${state.player.suitConsumedTotal[suit]}`);
  return true;
}

export function cheatResetSuitCounters(state: GameState): boolean {
  state.player.suitPlayedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  state.player.suitConsumedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  dbgLog(state, `专精计数器重置`);
  return true;
}

// ─── 附魔 ──────────────────────────────────────────────────

export function cheatSetEnchant(
  state: GameState,
  enchant: EnchantId | null,
  level: number = 1,
): boolean {
  if (enchant === null) {
    state.player.weaponEnchant = undefined;
    state.player.weaponEnchantLevel = undefined;
    dbgLog(state, `附魔已清除`);
    return true;
  }
  if (!ENCHANTS.includes(enchant)) return false;
  state.player.weaponEnchant = enchant;
  state.player.weaponEnchantLevel = Math.max(1, Math.min(5, Math.floor(level)));
  dbgLog(state, `附魔 → ${ENCHANT_NAMES[enchant]} Lv${state.player.weaponEnchantLevel}`);
  return true;
}

// ─── 状态效果 ──────────────────────────────────────────────

export function cheatAddPlayerStatus(
  state: GameState,
  statusId: string,
  stacks: number = 1,
  duration: number = -1,
  name?: string,
): boolean {
  const existing = state.player.statuses.find((s) => s.id === statusId);
  if (existing) {
    existing.stacks += Math.floor(stacks);
    existing.duration = duration;
    dbgLog(state, `状态 ${statusId} → ${existing.stacks} (dur ${duration})`);
    return true;
  }
  const status: StatusEffect = {
    id: statusId,
    name: name ?? statusId,
    stacks: Math.floor(stacks),
    duration,
  };
  state.player.statuses.push(status);
  dbgLog(state, `+状态 ${statusId} x${stacks} (dur ${duration})`);
  return true;
}

export function cheatRemovePlayerStatus(state: GameState, statusId: string): boolean {
  const before = state.player.statuses.length;
  state.player.statuses = state.player.statuses.filter((s) => s.id !== statusId);
  if (state.player.statuses.length === before) return false;
  dbgLog(state, `-状态 ${statusId}`);
  return true;
}

export function cheatClearAllPlayerStatuses(state: GameState): boolean {
  const n = state.player.statuses.length;
  state.player.statuses = [];
  dbgLog(state, `清空玩家所有状态（${n} 条）`);
  return true;
}

export function cheatAddEnemyStatus(
  state: GameState,
  enemyIdx: number,
  statusId: string,
  stacks: number = 1,
  duration: number = -1,
  name?: string,
): boolean {
  if (!state.battle) return false;
  const e = state.battle.enemies[enemyIdx];
  if (!e || (e.hp ?? 0) <= 0) return false;
  const existing = e.statuses.find((s) => s.id === statusId);
  if (existing) {
    existing.stacks += Math.floor(stacks);
    existing.duration = duration;
  } else {
    e.statuses.push({
      id: statusId,
      name: name ?? statusId,
      stacks: Math.floor(stacks),
      duration,
    });
  }
  dbgLog(state, `敌[${enemyIdx}] +状态 ${statusId} x${stacks}`);
  return true;
}

// ─── 敌人操作 ──────────────────────────────────────────────

export function cheatKillEnemy(state: GameState, enemyIdx: number): boolean {
  if (!state.battle) return false;
  const e = state.battle.enemies[enemyIdx];
  if (!e) return false;
  e.hp = 0;
  dbgLog(state, `敌[${enemyIdx}] ${e.name} 处决`);
  return true;
}

export function cheatHurtEnemy(state: GameState, enemyIdx: number, dmg: number): boolean {
  if (!state.battle) return false;
  const e = state.battle.enemies[enemyIdx];
  if (!e) return false;
  e.hp = Math.max(0, (e.hp ?? 0) - Math.floor(dmg));
  dbgLog(state, `敌[${enemyIdx}] -${dmg} HP → ${e.hp}`);
  return true;
}

export function cheatSetEnemyHp(state: GameState, enemyIdx: number, hp: number): boolean {
  if (!state.battle) return false;
  const e = state.battle.enemies[enemyIdx];
  if (!e) return false;
  e.hp = Math.max(0, Math.min(e.maxHp ?? 9999, Math.floor(hp)));
  dbgLog(state, `敌[${enemyIdx}] HP → ${e.hp}`);
  return true;
}

// ─── 抽牌 / 弃牌（战斗内） ─────────────────────────────────

export function cheatDrawN(state: GameState, n: number): boolean {
  if (!state.battle) return false;
  // 复用 battle.ts 的 drawCards 会触发 HAND_LIMIT 强制弃牌逻辑；这里简单粗暴直接搬
  const k = Math.min(n, state.player.deck.length);
  const drawn = state.player.deck.splice(state.player.deck.length - k, k);
  state.player.hand.push(...drawn);
  dbgLog(state, `抽 ${k} 张牌（无 HAND_LIMIT 限制）`);
  return true;
}

export function cheatDiscardAllHand(state: GameState): boolean {
  const n = state.player.hand.length;
  state.player.discard.push(...state.player.hand);
  state.player.hand = [];
  dbgLog(state, `弃光手牌（${n} 张）`);
  return true;
}

// ─── 全数据导出 ────────────────────────────────────────────

/**
 * 把整个 GameState 序列化为 JSON 字符串。
 * 处理循环引用（state.battle.player === state.player）。
 */
export function dumpStateJson(state: GameState): string {
  const seen = new WeakSet();
  return JSON.stringify(
    state,
    (_key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[circular]";
        seen.add(value);
      }
      if (typeof value === "function") return "[fn]";
      return value;
    },
    2,
  );
}

/**
 * 简化版玩家数据导出（去掉 deck 里巨大的 CardInstance 列表，只保留 defId+suit 简写）。
 */
export function dumpPlayerSummary(state: GameState): string {
  const p = state.player;
  const briefCard = (c: CardInstance) => `${c.defId}${c.suit ? `[${c.suit[0]}]` : ""}`;
  const summary = {
    floor: state.floor,
    phase: state.phase,
    vita: `${p.vita}/${p.vitaMax}`,
    hand: p.hand.map(briefCard),
    deck: p.deck.map(briefCard),
    discard: p.discard.map(briefCard),
    weapons: p.weapons.map(briefCard),
    armors: p.armors.map(briefCard),
    perks: p.perks.map(briefCard),
    statuses: p.statuses.map((s) => `${s.id}x${s.stacks}(d${s.duration})`),
    fragments: p.fragments,
    suitPlayed: p.suitPlayedTotal,
    suitConsumed: p.suitConsumedTotal,
    enchant: p.weaponEnchant
      ? `${p.weaponEnchant} Lv${p.weaponEnchantLevel ?? 1}`
      : null,
    battle: state.battle
      ? {
          turn: state.battle.turn,
          phase: state.battle.phase,
          enemies: state.battle.enemies.map((e) => ({
            name: e.name,
            hp: `${e.hp}/${e.maxHp}`,
            statuses: e.statuses.map((s) => `${s.id}x${s.stacks}(d${s.duration})`),
            intent: e.intents?.[e.intentIndex]?.desc ?? null,
          })),
        }
      : null,
  };
  return JSON.stringify(summary, null, 2);
}

// ─── 元信息（给 UI dropdown 用） ───────────────────────────

export function listAllCardIds(): { id: string; name: string; category: string; rarity: string }[] {
  return Object.entries(CARD_DB).map(([id, def]) => ({
    id,
    name: def.name,
    category: def.category,
    rarity: def.rarity ?? "common",
  }));
}

export function listAllPerkIds(): { id: string; name: string }[] {
  const ids = new Set<string>(PERK_POOL);
  // 也带上所有 category=perk 的（包括池外特性）
  for (const [id, def] of Object.entries(CARD_DB)) {
    if (def.category === "perk") ids.add(id);
  }
  return [...ids].map((id) => ({ id, name: CARD_DB[id]?.name ?? id }));
}
