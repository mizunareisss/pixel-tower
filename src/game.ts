// 游戏主状态机 v0.8 (deck-builder)
//
// 流程：
//   newGame()
//     → starter_perk_picks（9 选 3 特性）
//     → battle (起始送 1 短剑 + 16 张基础牌库)
//     → reward_card（每场战斗胜后选 1 张牌进牌库）
//     → reward_perk（每关末选 1 张特性）
//     → discard（整理）
//     → 下一关...

import type {
  GameState,
  PlayerState,
  LogKind,
  EnchantId,
  Suit,
} from "./types.ts";
import { ENCHANT_RACE, ENCHANT_COST, ENCHANT_NAMES, SUIT_SYMBOLS } from "./types.ts";
import {
  STARTING_VITA,
  STARTING_HAND,
  FIGHTS_PER_FLOOR,
  STARTER_PERK_COUNT,
  STARTER_PERK_POOL_SIZE,
  REWARD_CHOICE_COUNT,
} from "./types.ts";
import {
  CARD_DB,
  PERK_POOL,
  STARTING_DECK_IDS,
  REWARD_CARD_POOL_BASE,
  REWARD_CARD_POOL_AOE,
  rollChoices,
  rollRewardChoices,
  makeInstance,
} from "./cards.ts";
import {
  newBattle,
  playCard,
  endPlayerTurn,
  selectTarget,
  drawCards,
  discardWeapons,
  discardArmors,
} from "./battle.ts";
import { makeEnemyGroupsForFloor } from "./enemies.ts";

// ─────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────

function pushLog(state: GameState, msg: string, kind: LogKind = "system") {
  state.log.push({ msg, kind });
}

function logFn(state: GameState) {
  return (msg: string, kind: LogKind = "system") => state.log.push({ msg, kind });
}

// ─────────────────────────────────────────────────────────
// 新建游戏
// ─────────────────────────────────────────────────────────

export function newGame(): GameState {
  const player: PlayerState = {
    vita: STARTING_VITA,
    vitaMax: STARTING_VITA,
    perks: [],
    weapons: [],
    armors: [],
    hand: [],
    deck: [],
    discard: [],
    statuses: [],
    turnsElapsed: 0,
    fragments: { beast: 0, humanoid: 0, undead: 0, giant: 0, dark: 0 },
    revivesUsed: 0,
  };
  // 起始装备：1 把短剑放在常驻区
  player.weapons.push(makeInstance("short_sword", undefined, 0));
  // 起始牌库
  for (const id of STARTING_DECK_IDS) {
    player.deck.push(makeInstance(id, undefined, 0));
  }

  const state: GameState = {
    phase: "starter_perk_picks",
    floor: 0,
    battleIndex: 0,
    battleGroups: [],
    player,
    battle: null,
    choices: rollChoices(PERK_POOL, STARTER_PERK_POOL_SIZE),
    picksRemaining: STARTER_PERK_COUNT,
    pendingFloorClear: false,
    log: [],
  };
  pushLog(state, "★ 新的爬塔之旅开始 ★", "win");
  pushLog(state, `起始：短剑 ×1 + 16 张牌库。`, "system");
  pushLog(state, `从 9 张特性里选 ${STARTER_PERK_COUNT} 个起始特性。`, "system");
  return state;
}

// ─────────────────────────────────────────────────────────
// 起手特性选择
// ─────────────────────────────────────────────────────────

export function pickStarterPerk(state: GameState, uid: string) {
  if (state.phase !== "starter_perk_picks") return;
  const idx = state.choices.findIndex(c => c.uid === uid);
  if (idx < 0) return;
  const inst = state.choices[idx];
  state.choices.splice(idx, 1);
  state.player.perks.push(inst);
  state.picksRemaining -= 1;
  pushLog(state, `选择特性：${CARD_DB[inst.defId].name}。`, "player");

  if (state.picksRemaining === 0) {
    startNextFloor(state);
  }
}

// ─────────────────────────────────────────────────────────
// 关卡推进
// ─────────────────────────────────────────────────────────

function startNextFloor(state: GameState) {
  state.floor += 1;
  state.battleGroups = makeEnemyGroupsForFloor(state.floor);
  state.battleIndex = 0;
  pushLog(state, `──── 第 ${state.floor} 关开始 ────`, "system");
  startCurrentBattle(state);
}

function startCurrentBattle(state: GameState) {
  const enemies = state.battleGroups[state.battleIndex];
  if (!enemies) return;
  state.battle = newBattle(state.player, enemies, state.floor);
  state.phase = "battle";
  state.choices = [];
  pushLog(state, `── 战斗 ${state.battleIndex + 1}/${FIGHTS_PER_FLOOR} ──`, "system");
  for (const e of enemies) pushLog(state, `${e.name}（HP ${e.hp}）出现！`, "enemy");

  // 起手摸 6
  drawCards(state.player, STARTING_HAND, logFn(state));
  pushLog(state, `回合 1（你的回合）`, "system");
}

// ─────────────────────────────────────────────────────────
// 战斗：出牌 / 选目标 / 结束回合
// ─────────────────────────────────────────────────────────

export function gamePlayCard(state: GameState, cardUid: string): boolean {
  if (state.phase !== "battle" || !state.battle) return false;
  const ok = playCard(state.battle, cardUid, logFn(state));
  if (!ok) return false;

  // 花色手选暂停：等玩家选完花色再继续
  if (state.battle.pendingSuitPick) {
    state.phase = "suit_pick";
    return true;
  }

  if (state.battle.phase === "won") onBattleWon(state);
  else if (state.battle.phase === "lost") {
    state.phase = "game_over";
    pushLog(state, `第 ${state.floor} 关倒下。`, "lose");
  }
  return true;
}

export function gameSuitPicked(state: GameState, suit: Suit) {
  if (state.phase !== "suit_pick" || !state.battle) return;
  const action = state.battle.pendingSuitPick;
  const log = logFn(state);

  if (action === "dye") {
    const id = `dyed_${suit}`;
    const name = `染色${SUIT_SYMBOLS[suit]}`;
    const p = state.battle.player;
    const existing = p.statuses.find(s => s.id === id);
    if (existing) existing.stacks += 1;
    else p.statuses.push({ id, name, stacks: 1, duration: 1 });
    log(`染色术：本回合攻击视为 ${SUIT_SYMBOLS[suit]}。`, "player");
  } else if (action === "resonance") {
    const target = state.battle.enemies[state.battle.targetIndex]
      ?? state.battle.enemies.find(e => e.alive);
    if (target) {
      target.suit = suit;
      log(`共鸣咒：${target.name} 花色变为 ${SUIT_SYMBOLS[suit]}。`, "player");
    }
  }

  state.battle.pendingSuitPick = undefined;
  state.phase = "battle";

  if (state.battle.phase === "won") onBattleWon(state);
  else if (state.battle.phase === "lost") {
    state.phase = "game_over";
    pushLog(state, `第 ${state.floor} 关倒下。`, "lose");
  }
}

export function gameSelectTarget(state: GameState, idx: number) {
  if (state.phase !== "battle" || !state.battle) return;
  selectTarget(state.battle, idx);
}

export function gameEndTurn(state: GameState) {
  if (state.phase !== "battle" || !state.battle) return;
  endPlayerTurn(state.battle, logFn(state));
  if (state.battle.phase === "won") onBattleWon(state);
  else if (state.battle.phase === "lost") {
    state.phase = "game_over";
    pushLog(state, `第 ${state.floor} 关倒下。`, "lose");
  }
}

// ─────────────────────────────────────────────────────────
// 装备替换：玩家主动弃当前武器/防具，让出位置
// ─────────────────────────────────────────────────────────
export function gameDiscardWeapons(state: GameState) {
  if (state.phase !== "battle" || !state.battle) return;
  discardWeapons(state.battle, logFn(state));
}
export function gameDiscardArmors(state: GameState) {
  if (state.phase !== "battle" || !state.battle) return;
  discardArmors(state.battle, logFn(state));
}

// ─────────────────────────────────────────────────────────
// 战斗胜利
// ─────────────────────────────────────────────────────────

function onBattleWon(state: GameState) {
  state.battle = null;
  const isLast = state.battleIndex >= FIGHTS_PER_FLOOR - 1;
  if (isLast) {
    pushLog(state, `第 ${state.floor} 关全部通过！`, "win");
    state.pendingFloorClear = true;
  } else {
    state.battleIndex += 1;
  }
  state.phase = "battle_victory";
  pushLog(state, "点击「领取奖励」继续。", "system");
}

export function continueFromVictory(state: GameState) {
  if (state.phase !== "battle_victory") return;
  state.phase = "reward_card";
  // 第 3 关后开放群攻技能池
  const pool = state.floor >= 3
    ? [...REWARD_CARD_POOL_BASE, ...REWARD_CARD_POOL_AOE]
    : REWARD_CARD_POOL_BASE;
  state.choices = rollRewardChoices(pool, REWARD_CHOICE_COUNT, state.floor);

  // Boss 战胜利 epic 保底：仅第 6 关及以后的 Boss 触发（前 3 关 Boss 按正常概率走）
  // 判定刚结束的战斗是否为本关末场（pendingFloorClear 为 true 时表示）
  if (state.pendingFloorClear && state.floor >= 6) {
    const lastEnemies = state.battleGroups[state.battleGroups.length - 1];
    const wasBoss = lastEnemies?.some(e => e.tier === "boss");
    const hasEpic = state.choices.some(c => CARD_DB[c.defId].rarity === "epic");
    if (wasBoss && !hasEpic) {
      const epicPool = pool.filter(id => CARD_DB[id]?.rarity === "epic" && !state.choices.some(c => c.defId === id));
      if (epicPool.length > 0) {
        const pickedId = epicPool[Math.floor(Math.random() * epicPool.length)];
        state.choices[0] = makeInstance(pickedId, undefined, state.floor);
        pushLog(state, `★ Boss 战利品：保底抽到史诗卡。`, "win");
      }
    }
  }

  pushLog(state, `战利品：从 3 张牌中选 1 张加入牌库。`, "system");
}

export function pickRewardCard(state: GameState, uid: string) {
  if (state.phase !== "reward_card") return;
  const idx = state.choices.findIndex(c => c.uid === uid);
  if (idx < 0) return;
  const picked = state.choices[idx];
  picked.acquiredAtFloor = state.floor;
  state.player.deck.push(picked);
  pushLog(state, `获得：${CARD_DB[picked.defId].name}（已进入牌库）。`, "player");
  goAfterCardReward(state);
}

export function skipRewardCard(state: GameState) {
  if (state.phase !== "reward_card") return;
  pushLog(state, "跳过本轮战利品。");
  goAfterCardReward(state);
}

function goAfterCardReward(state: GameState) {
  if (state.pendingFloorClear) {
    state.vitaUpAmount = calcVitaUpAmount(state.floor);
    state.phase = "reward_perk";
    state.choices = rollChoices(PERK_POOL, REWARD_CHOICE_COUNT, state.floor);
    pushLog(state, `特性升级：从 3 张特性里选 1 张。`, "system");
  } else {
    startCurrentBattle(state);
  }
}

function calcVitaUpAmount(floor: number): number {
  return Math.min(8 + floor * 3, 24);
}

// ─────────────────────────────────────────────────────────
// 通关特性奖励
// ─────────────────────────────────────────────────────────

export function pickRewardPerk(state: GameState, uid: string) {
  if (state.phase !== "reward_perk") return;
  const idx = state.choices.findIndex(c => c.uid === uid);
  if (idx < 0) return;
  const picked = state.choices[idx];
  picked.acquiredAtFloor = state.floor;
  state.player.perks.push(picked);
  pushLog(state, `获得特性：${CARD_DB[picked.defId].name}。`, "player");
  afterPerkReward(state);
}

export function pickVitaUp(state: GameState) {
  if (state.phase !== "reward_perk") return;
  const amt = state.vitaUpAmount ?? 10;
  state.player.vitaMax += amt;
  state.vitaUpAmount = undefined;
  pushLog(state, `生命上限 +${amt}。`, "win");
  afterPerkReward(state);
}

export function skipRewardPerk(state: GameState) {
  if (state.phase !== "reward_perk") return;
  state.vitaUpAmount = undefined;
  pushLog(state, "跳过特性奖励。");
  afterPerkReward(state);
}

function afterPerkReward(state: GameState) {
  state.pendingFloorClear = false;
  state.player.vita = state.player.vitaMax;
  pushLog(state, "完成一关，HP 补满。", "win");
  state.choices = [];
  // 每 2 关后进铁匠铺（即将进入 3 / 5 / 7...）
  if (state.floor > 0 && state.floor % 2 === 0) {
    state.phase = "forge";
    pushLog(state, `⚒ 铁匠铺：使用灵魂碎片为武器附魔，或跳过。`, "system");
  } else {
    startNextFloor(state);
  }
}

// ─────────────────────────────────────────────────────────
// 整理：弃牌库中的卡 / 弃特性 / 弃装备
// ─────────────────────────────────────────────────────────

export function discardAndAdvance(state: GameState, uids: string[]) {
  if (state.phase !== "discard") return;
  if (uids.length > 0) {
    const set = new Set(uids);
    state.player.deck = state.player.deck.filter(c => !set.has(c.uid));
    state.player.perks = state.player.perks.filter(c => !set.has(c.uid));
    state.player.weapons = state.player.weapons.filter(c => !set.has(c.uid));
    state.player.armors = state.player.armors.filter(c => !set.has(c.uid));
    pushLog(state, `弃置 ${uids.length} 张卡。`, "system");
  }
  // 每 2 关后进铁匠铺（即将进入 3 / 5 / 7...）
  if (state.floor > 0 && state.floor % 2 === 0) {
    state.phase = "forge";
    pushLog(state, `⚒ 铁匠铺：使用灵魂碎片为武器附魔，或跳过。`, "system");
    return;
  }
  startNextFloor(state);
}

// ─────────────────────────────────────────────────────────
// 铁匠铺：应用附魔 / 跳过
// ─────────────────────────────────────────────────────────
export function applyEnchant(state: GameState, enchantId: EnchantId): boolean {
  if (state.phase !== "forge") return false;
  const race = ENCHANT_RACE[enchantId];
  if ((state.player.fragments[race] ?? 0) < ENCHANT_COST) {
    pushLog(state, `${ENCHANT_NAMES[enchantId]} 需要 ${race} 碎片 ×${ENCHANT_COST}，库存不足。`, "system");
    return false;
  }
  state.player.fragments[race] -= ENCHANT_COST;
  state.player.weaponEnchant = enchantId;
  pushLog(state, `武器附魔：${ENCHANT_NAMES[enchantId]}（消耗 ${ENCHANT_COST} ${race} 碎片）。`, "win");
  startNextFloor(state);
  return true;
}

export function skipForge(state: GameState) {
  if (state.phase !== "forge") return;
  pushLog(state, "跳过铁匠铺。");
  startNextFloor(state);
}
