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
import { ENCHANT_RECIPES, ENCHANT_NAMES, SUIT_SYMBOLS } from "./types.ts";
import {
  STARTING_VITA,
  STARTING_HAND,
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
  applyNextBattlePenalty,
  suitTier,
  consumeSuitAffinity,
  getTiedSpecialties,
} from "./battle.ts";
// makeEnemyGroupsForFloor 现在被 map.ts 调用
import {
  generateMerchantStock,
  tryPurchaseMerchantCardMixed,
  tradeFragmentsMixed,
  trySellCard,
  GAMBLER_OPTIONS,
  SHRINE_OPTIONS,
  generateWizardChoices,
  applyWizardPick,
  openChest,
  EVENT_META,
} from "./events.ts";
import type { EventId } from "./events.ts";
import type { CardInstance, EnemyRace, MapNode } from "./types.ts";
import { generateFloorMap, getReachableNodes, getNode } from "./map.ts";

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
    suitPlayedTotal: { spade: 0, diamond: 0, heart: 0, club: 0 },
    suitConsumedTotal: { spade: 0, diamond: 0, heart: 0, club: 0 },
    ultsThisBattle: { spade: false, diamond: false, heart: false, club: false },
    battlesSinceEquipReward: 0,
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
  state.battleGroups = [];
  state.battleIndex = 0;
  // 生成楼层地图，进入 floor_map 阶段
  state.floorMap = generateFloorMap(state.floor);
  state.phase = "floor_map";
  pushLog(state, `──── 第 ${state.floor} 关 · ${state.floorMap.theme.name} ────`, "system");
}

// 玩家在地图上选了一个节点
export function enterMapNode(state: GameState, nodeId: string): boolean {
  if (state.phase !== "floor_map" || !state.floorMap) return false;
  const reachable = getReachableNodes(state.floorMap);
  if (!reachable.find(n => n.id === nodeId)) return false;  // 不可达
  const node = getNode(state.floorMap, nodeId);
  if (!node) return false;
  // 推进玩家位置（节点完成由内容消费后标记，不在进入时）
  state.floorMap.currentNodeId = nodeId;
  // 根据节点类型进入对应阶段
  if (node.type === "battle" || node.type === "elite" || node.type === "boss") {
    startNodeBattle(state, node);
  } else if (node.type === "event") {
    startNodeEvent(state, node);
  } else if (node.type === "forge") {
    startNodeForge(state);
  } else if (node.type === "shop") {
    startNodeShop(state);
  }
  return true;
}

function startNodeBattle(state: GameState, node: MapNode) {
  if (!node.enemies || node.enemies.length === 0) return;
  state.battle = newBattle(state.player, node.enemies, state.floor);
  state.phase = "battle";
  state.choices = [];

  // Roll 骰子先手：1-6 点；单数玩家先手（默认），双数敌人先手
  const diceRoll = Math.floor(Math.random() * 6) + 1;
  state.battle.diceRoll = diceRoll;
  state.battle.enemyFirst = (diceRoll % 2 === 0);
  state.battle.diceAnimationShown = false;

  const tierLabel = node.type === "boss" ? "BOSS" : node.type === "elite" ? "精英战" : "战斗";
  pushLog(state, `── ${tierLabel} ──`, "system");
  for (const e of node.enemies) pushLog(state, `${e.name}（HP ${e.hp}）出现！`, "enemy");
  pushLog(state, `🎲 骰子 ${diceRoll} → ${state.battle.enemyFirst ? "敌人先手" : "你先手"}。`, "system");

  // 起手摸 6
  drawCards(state.player, STARTING_HAND, logFn(state));
  // 应用跨场战斗惩罚（神秘宝箱陷阱）
  applyNextBattlePenalty(state.battle, logFn(state));
  pushLog(state, `回合 1（${state.battle.enemyFirst ? "敌人的回合" : "你的回合"}）`, "system");
}

function startNodeEvent(state: GameState, node: MapNode) {
  const eventId = node.eventId ?? "wizard";
  state.activeEventId = eventId;
  state.phase = "floor_event";
  if (eventId === "merchant") {
    state.merchantStock = generateMerchantStock(state.floor);
    state.merchantSellsThisVisit = 0;
  }
  if (eventId === "wizard") {
    state.choices = generateWizardChoices(state.floor);
  }
  const meta = EVENT_META[eventId as EventId];
  pushLog(state, `${meta.icon} 楼层事件：${meta.name}。`, "system");
}

function startNodeForge(state: GameState) {
  state.phase = "forge";
  state.forgeRecolorUsed = false;  // 每次进入铁匠铺重置染色服务
  // 25% 概率出现「5 折特惠」事件：本次访问所有附魔碎片消耗减半（向上取整）
  state.forgeDiscountThisVisit = Math.random() < 0.25;
  if (state.forgeDiscountThisVisit) {
    pushLog(state, `⚒ 铁匠铺·5 折特惠！本次附魔配方碎片消耗减半（向上取整）。`, "win");
  } else {
    pushLog(state, `⚒ 铁匠铺：使用灵魂碎片为武器附魔，或跳过。`, "system");
  }
}

function startNodeShop(state: GameState) {
  // shop = 永远是商人事件
  state.activeEventId = "merchant";
  state.phase = "floor_event";
  state.merchantStock = generateMerchantStock(state.floor);
  state.merchantSellsThisVisit = 0;
  pushLog(state, `🛒 商店：流浪商人在等你。`, "system");
}

// 节点完成后回到地图
// 注：returnToMap 逻辑已合并进 onBattleWon / goAfterCardReward / goAfterFloorEvent

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
  } else if (action === "chant") {
    // 持咒：整场战斗持续，每场限 1 次
    const id = `chanted_${suit}`;
    const name = `持咒${SUIT_SYMBOLS[suit]}`;
    const p = state.battle.player;
    // 如果已有不同花色的持咒，先清掉（避免多重）
    p.statuses = p.statuses.filter(s => !s.id.startsWith("chanted_"));
    p.statuses.push({ id, name, stacks: 1, duration: -1 });
    // 标记本场已持咒：drawCards 跳过同名副本 + playCard 拒绝再触发
    p.statuses.push({ id: "chanted_used", name: "本场已持咒", stacks: 1, duration: -1 });
    log(`持咒：整场战斗攻击视为 ${SUIT_SYMBOLS[suit]}（本场仅此一次）。`, "player");
  } else if (action === "resonance") {
    const target = state.battle.enemies[state.battle.targetIndex]
      ?? state.battle.enemies.find(e => e.alive);
    if (target) {
      // 第一次共鸣：记原色；后续 reapply：刷新持续时间
      if (target.originalSuit === undefined) target.originalSuit = target.suit;
      target.suit = suit;
      // 加 status，duration 4，stacks 编码花色 index 用于 UI 显示
      const suitIdx = ["spade", "diamond", "heart", "club"].indexOf(suit) + 1;  // 1-4
      const ex = target.statuses.find(s => s.id === "attuned");
      if (ex) { ex.duration = 4; ex.stacks = suitIdx; }
      else target.statuses.push({ id: "attuned", name: "已共鸣", stacks: suitIdx, duration: 4 });
      log(`共鸣咒：${target.name} 花色变为 ${SUIT_SYMBOLS[suit]}（4 回合后回归）。`, "player");
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

// 取消手选花色：卡片照样消耗，无效果回到战斗
export function gameSuitPickCanceled(state: GameState) {
  if (state.phase !== "suit_pick" || !state.battle) return;
  state.battle.pendingSuitPick = undefined;
  pushLog(state, "取消花色选择，卡片浪费。", "system");
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

// 骰子先手敌人 — 战斗开始骰子翻出双数时调用：敌人先打一击，但不推进 turn 计数
// 实现：直接走 enemyTurn 但不增 turn / 不进 endPlayerTurn 的"摸牌" 流程
export function gameEnemyFirstStrike(state: GameState) {
  if (state.phase !== "battle" || !state.battle) return;
  if (!state.battle.enemyFirst) return;  // 仅 enemyFirst 时触发
  const log = logFn(state);
  // 直接调 endPlayerTurn 走完整流程（含 enemy turn + 推进到下一玩家回合）
  // turn 会变 2，但 log 里清楚是"敌人先手已结算"
  endPlayerTurn(state.battle, log);
  // 防止 enemyFirst 重复触发
  state.battle.enemyFirst = false;
  if (state.battle.phase === "lost") {
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
  // 关卡末节点（boss 或非 boss 关末的 elite）= 关卡完成
  if (state.floorMap) {
    const cur = getNode(state.floorMap, state.floorMap.currentNodeId);
    const isLastNode = cur?.id === state.floorMap.bossNodeId;
    if (isLastNode) {
      const isBoss = cur?.type === "boss";
      pushLog(state, isBoss ? `第 ${state.floor} 关 BOSS 击败！` : `第 ${state.floor} 关末关击败！`, "win");
      state.pendingFloorClear = true;
    }
  }
  // 直接进入选牌界面（取消"领取战利品"中转按钮）
  enterRewardCard(state);
}

// 内部：roll 奖励候选 + 进 reward_card 阶段
function enterRewardCard(state: GameState) {
  state.phase = "reward_card";
  const pool = state.floor >= 3
    ? [...REWARD_CARD_POOL_BASE, ...REWARD_CARD_POOL_AOE]
    : REWARD_CARD_POOL_BASE;
  // 玩家牌库已有的 defId → 数量（含装备/特性，用于平滑去重 + 流派偏好计算）
  const owned = new Map<string, number>();
  const accumulate = (id: string) => owned.set(id, (owned.get(id) ?? 0) + 1);
  for (const c of state.player.deck) accumulate(c.defId);
  for (const c of state.player.hand) accumulate(c.defId);
  for (const c of state.player.discard) accumulate(c.defId);
  for (const c of state.player.weapons) accumulate(c.defId);
  for (const c of state.player.armors) accumulate(c.defId);
  for (const c of state.player.perks) accumulate(c.defId);
  // 装备保底：连续 3 场无装备奖励 → 下场强制
  const forceEquip = (state.player.battlesSinceEquipReward ?? 0) >= 3;
  state.choices = rollRewardChoices(pool, REWARD_CHOICE_COUNT, state.floor, owned, forceEquip);

  // Boss 战胜利 epic 保底：仅第 6 关及以后的 Boss 触发
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

  pushLog(state, `战利品：从 ${REWARD_CHOICE_COUNT} 张牌中选 1 张加入牌库。`, "system");
}

// 兼容旧入口（保留 export 防 main.ts 直接调用，但 onBattleWon 已不再走它）
export function continueFromVictory(state: GameState) {
  if (state.phase === "battle_victory") enterRewardCard(state);
}

export function pickRewardCard(state: GameState, uid: string) {
  if (state.phase !== "reward_card") return;
  const idx = state.choices.findIndex(c => c.uid === uid);
  if (idx < 0) return;
  const picked = state.choices[idx];
  picked.acquiredAtFloor = state.floor;
  state.player.deck.push(picked);
  pushLog(state, `获得：${CARD_DB[picked.defId].name}（已进入牌库）。`, "player");
  // 装备保底计数：拿到装备 → 重置；否则 +1
  if (CARD_DB[picked.defId]?.category === "equipment") {
    state.player.battlesSinceEquipReward = 0;
  } else {
    state.player.battlesSinceEquipReward = (state.player.battlesSinceEquipReward ?? 0) + 1;
  }
  goAfterCardReward(state);
}

export function skipRewardCard(state: GameState) {
  if (state.phase !== "reward_card") return;
  pushLog(state, "跳过本轮战利品。");
  state.player.battlesSinceEquipReward = (state.player.battlesSinceEquipReward ?? 0) + 1;
  goAfterCardReward(state);
}

function goAfterCardReward(state: GameState) {
  if (state.pendingFloorClear) {
    state.vitaUpAmount = calcVitaUpAmount(state.floor);
    state.phase = "reward_perk";
    state.choices = rollChoices(PERK_POOL, REWARD_CHOICE_COUNT, state.floor);
    pushLog(state, `特性升级：从 3 张特性里选 1 张。`, "system");
  } else {
    // 普通战 / 精英战奖励完 → 标记当前节点完成 → 回地图
    state.choices = [];
    if (state.floorMap) {
      const cur = getNode(state.floorMap, state.floorMap.currentNodeId);
      if (cur) cur.completed = true;
    }
    state.phase = "floor_map";
  }
}

function calcVitaUpAmount(floor: number): number {
  return Math.min(8 + floor * 3, 24);  // v5：30 → 24，让 F12 玩家 maxHP 稳定在 140 内，强迫真正的"濒死 build"体验
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
  // 直接进入下一关的地图（铁匠铺/事件都已经是 map 节点了）
  startNextFloor(state);
}

// 事件结束后回地图选下一节点（map 节点流程）
function goAfterFloorEvent(state: GameState) {
  state.activeEventId = undefined;
  state.merchantStock = undefined;
  state.choices = [];
  // 标记当前 map 节点完成
  if (state.floorMap) {
    const cur = getNode(state.floorMap, state.floorMap.currentNodeId);
    if (cur) cur.completed = true;
  }
  state.phase = "floor_map";
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
// 配方系统 v2：单种族 (×3) 或 复合 (×2 + ×2)
// ─────────────────────────────────────────────────────────
export function applyEnchant(state: GameState, enchantId: EnchantId): boolean {
  if (state.phase !== "forge") return false;
  const recipe = ENCHANT_RECIPES[enchantId];
  if (!recipe) return false;
  // 5 档升级 / 替换判定
  // - 当前已装这个附魔且 Lv < 5：升级（消耗等额配方），Lv+1
  // - 当前已装这个附魔且 Lv = 5：拒绝（满级）
  // - 其它：替换（Lv 重置为 1）
  const isSameEnchant = state.player.weaponEnchant === enchantId;
  const curLevel = state.player.weaponEnchantLevel ?? 1;
  if (isSameEnchant && curLevel >= 5) {
    pushLog(state, `${ENCHANT_NAMES[enchantId]} 已满级（Lv 5），无法继续升级。`, "system");
    return false;
  }

  // 5 折特惠：所有配方碎片消耗减半（向上取整）
  const discount = state.forgeDiscountThisVisit === true;
  const actualCost: Partial<Record<EnemyRace, number>> = {};
  for (const r in recipe.cost) {
    const orig = recipe.cost[r as EnemyRace] ?? 0;
    actualCost[r as EnemyRace] = discount ? Math.ceil(orig / 2) : orig;
  }
  // 校验所有配方所需碎片库存
  for (const r in actualCost) {
    const need = actualCost[r as EnemyRace] ?? 0;
    if ((state.player.fragments[r as EnemyRace] ?? 0) < need) {
      const races = Object.entries(actualCost)
        .map(([rc, n]) => `${rc} × ${n}`).join(" + ");
      pushLog(state, `${ENCHANT_NAMES[enchantId]} 需要 ${races}，库存不足。`, "system");
      return false;
    }
  }
  // 扣碎片
  for (const r in actualCost) {
    const need = actualCost[r as EnemyRace] ?? 0;
    state.player.fragments[r as EnemyRace] -= need;
  }

  // 更新附魔 + Lv
  if (isSameEnchant) {
    state.player.weaponEnchantLevel = Math.min(5, curLevel + 1);
  } else {
    state.player.weaponEnchant = enchantId;
    state.player.weaponEnchantLevel = 1;
  }
  const newLv = state.player.weaponEnchantLevel;
  const costStr = Object.entries(actualCost).map(([r, n]) => `${n} ${r}`).join(" + ");
  const verb = isSameEnchant ? `升级到 Lv ${newLv}` : `Lv 1`;
  pushLog(state, `武器附魔：${ENCHANT_NAMES[enchantId]} ${verb}（消耗 ${costStr}${discount ? " · 5 折" : ""}）。`, "win");

  // 铁匠铺是 map 节点，完成后回地图
  if (state.floorMap) {
    const cur = getNode(state.floorMap, state.floorMap.currentNodeId);
    if (cur) cur.completed = true;
  }
  state.phase = "floor_map";
  return true;
}

export function skipForge(state: GameState) {
  if (state.phase !== "forge") return;
  pushLog(state, "跳过铁匠铺。");
  if (state.floorMap) {
    const cur = getNode(state.floorMap, state.floorMap.currentNodeId);
    if (cur) cur.completed = true;
  }
  state.phase = "floor_map";
}

// ─────────────────────────────────────────────────────────
// 楼层事件 · 公共 API
// ─────────────────────────────────────────────────────────

export function skipFloorEvent(state: GameState) {
  if (state.phase !== "floor_event") return;
  pushLog(state, "跳过本次事件。", "system");
  goAfterFloorEvent(state);
}

// 商人购买（混搭支付：5 种族任意搭配，总和 = 价格）
export function merchantBuyCardMixed(
  state: GameState,
  cardUid: string,
  spend: Partial<Record<EnemyRace, number>>,
): boolean {
  if (state.phase !== "floor_event" || state.activeEventId !== "merchant") return false;
  const card = state.merchantStock?.find(c => c.uid === cardUid);
  if (!card) return false;
  const result = tryPurchaseMerchantCardMixed(state, card, spend);
  if (!result.ok) {
    pushLog(state, `购买失败：${result.reason}`, "system");
    return false;
  }
  state.merchantStock = state.merchantStock!.filter(c => c.uid !== cardUid);
  const summary = Object.entries(spend).filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${r} ×${n}`).join(" + ");
  pushLog(state, `购入 ${CARD_DB[card.defId].name}（${summary}）。`, "player");
  return true;
}

// 商人换碎片
export function merchantTradeFragmentsMixed(
  state: GameState,
  fromSpend: Partial<Record<EnemyRace, number>>,
  toGain: Partial<Record<EnemyRace, number>>,
): boolean {
  if (state.phase !== "floor_event" || state.activeEventId !== "merchant") return false;
  const result = tradeFragmentsMixed(state, fromSpend, toGain);
  if (!result.ok) {
    pushLog(state, `兑换失败：${result.reason}`, "system");
    return false;
  }
  const fromSum = Object.entries(fromSpend).filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${r}×${n}`).join("+");
  const toSum = Object.entries(toGain).filter(([, n]) => (n ?? 0) > 0)
    .map(([r, n]) => `${r}×${n}`).join("+");
  pushLog(state, `兑换：${fromSum} → ${toSum}`, "player");
  return true;
}

// 商人卖卡
export const MERCHANT_SELLS_PER_VISIT = 2;
export function merchantSellCard(state: GameState, cardUid: string, gainRace: EnemyRace): boolean {
  if (state.phase !== "floor_event" || state.activeEventId !== "merchant") return false;
  const sold = state.merchantSellsThisVisit ?? 0;
  if (sold >= MERCHANT_SELLS_PER_VISIT) {
    pushLog(state, `本次拜访已卖 ${MERCHANT_SELLS_PER_VISIT} 张，无法继续。`, "system");
    return false;
  }
  const result = trySellCard(state, cardUid, gainRace);
  if (!result.ok) {
    pushLog(state, `卖卡失败：${result.reason}`, "system");
    return false;
  }
  state.merchantSellsThisVisit = sold + 1;
  pushLog(state, `卖出卡牌 → ${gainRace} 碎片 +${result.gained}（${state.merchantSellsThisVisit}/${MERCHANT_SELLS_PER_VISIT}）`, "player");
  return true;
}

// 商人完成（玩家点"离开"）
export function merchantLeave(state: GameState) {
  if (state.phase !== "floor_event" || state.activeEventId !== "merchant") return;
  goAfterFloorEvent(state);
}

// 赌徒
export function gamblerBet(state: GameState, optionIdx: number) {
  if (state.phase !== "floor_event" || state.activeEventId !== "gambler") return;
  const opt = GAMBLER_OPTIONS[optionIdx];
  if (!opt || !opt.available(state)) return;
  const deckBefore = state.player.deck.length;
  const result = opt.apply(state);
  const gainedCard = state.player.deck.length > deckBefore ? state.player.deck[state.player.deck.length - 1] : undefined;
  pushLog(state, `🎲 ${opt.label}：${result}`, "player");
  state.eventResult = {
    title: `🎲 ${opt.label}`,
    message: result,
    cardId: gainedCard?.defId,
    cardChange: gainedCard ? "gained" : undefined,
    kind: gainedCard ? "win" : "lose",
  };
  goAfterFloorEvent(state);
}

// 神龛
export function shrineSacrifice(state: GameState, optionIdx: number) {
  if (state.phase !== "floor_event" || state.activeEventId !== "shrine") return;
  const opt = SHRINE_OPTIONS[optionIdx];
  if (!opt) return;
  const deckBefore = state.player.deck.length;
  const result = opt.apply(state);
  const gainedCard = state.player.deck.length > deckBefore ? state.player.deck[state.player.deck.length - 1] : undefined;
  pushLog(state, `⛲ ${result}`, "player");
  state.eventResult = {
    title: "⛲ 古老神龛",
    message: result,
    cardId: gainedCard?.defId,
    cardChange: gainedCard ? "gained" : undefined,
    kind: "win",
  };
  goAfterFloorEvent(state);
}

// 诡异术士
export function wizardPick(state: GameState, perkUid: string) {
  if (state.phase !== "floor_event" || state.activeEventId !== "wizard") return;
  const perk = state.choices.find(c => c.uid === perkUid);
  if (!perk) return;
  applyWizardPick(state, perk);
  pushLog(state, `🐦‍⬛ 获得特性：${CARD_DB[perk.defId].name}（免费赠送）。`, "player");
  state.eventResult = {
    title: "🐦‍⬛ 诡异术士",
    message: `获得特性：${CARD_DB[perk.defId].name}`,
    cardId: perk.defId,
    cardChange: "gained",
    kind: "win",
  };
  goAfterFloorEvent(state);
}

// 神秘宝箱
export function chestOpen(state: GameState) {
  if (state.phase !== "floor_event" || state.activeEventId !== "chest") return;
  const deckBefore = state.player.deck.length;
  const result = openChest(state);
  const gainedCard = state.player.deck.length > deckBefore ? state.player.deck[state.player.deck.length - 1] : undefined;
  pushLog(state, `📦 ${result.message}`, result.type === "trap" ? "lose" : "win");
  state.eventResult = {
    title: "📦 神秘宝箱",
    message: result.message,
    cardId: gainedCard?.defId,
    cardChange: gainedCard ? "gained" : undefined,
    kind: result.type === "trap" ? "lose" : "win",
  };
  goAfterFloorEvent(state);
}

// ─────────────────────────────────────────────────────────
// 战斗中：玩家主动弃手牌
// ─────────────────────────────────────────────────────────

export function discardHandCards(state: GameState, uids: string[]): boolean {
  if (state.phase !== "battle" || !state.battle) return false;
  if (uids.length === 0) return false;
  const set = new Set(uids);
  const before = state.player.hand.length;
  const discarded: CardInstance[] = [];
  state.player.hand = state.player.hand.filter(c => {
    if (set.has(c.uid)) {
      discarded.push(c);
      return false;
    }
    return true;
  });
  if (discarded.length === 0) return false;
  state.player.discard.push(...discarded);
  const names = discarded.map(c => CARD_DB[c.defId].name).join("、");
  pushLog(state, `主动弃手牌 ${discarded.length} 张：${names}。`, "player");
  return before > state.player.hand.length;
}

// ─────────────────────────────────────────────────────────
// 花色专精 · Tier 3 大招（消耗 8 亲和度，持久化扣减；本场每色限 1 次）
// ─────────────────────────────────────────────────────────

export function releaseSuitUltimate(state: GameState, suit: Suit): boolean {
  if (state.phase !== "battle" || !state.battle) return false;
  const tier = suitTier(state.battle, suit);
  if (tier < 3) return false;
  const log = logFn(state);
  const player = state.battle.player;
  const enemies = state.battle.enemies;

  // 本场限 1 次：4 花色独立，每场战斗 newBattle 重置 ultsThisBattle
  // （配合 suitConsumedTotal 持久化消耗，让每次大招都吃永久亲和度成本）
  if (!state.player.ultsThisBattle) {
    state.player.ultsThisBattle = { spade: false, diamond: false, heart: false, club: false };
  }
  if (state.player.ultsThisBattle[suit]) {
    log(`大招：本场每花色限 1 次，${suit} 已用过。`, "system");
    return false;
  }

  if (suit === "spade") {
    // 狂战之击：当前目标 50% 真实伤害（无视护甲）
    const target = enemies[state.battle.targetIndex] ?? enemies.find(e => e.alive);
    if (target) {
      const dmg = Math.max(1, Math.floor(target.hp * 0.5));
      target.hp = Math.max(0, target.hp - dmg);
      log(`★♠ 狂战之击！${target.name} -${dmg}（真实伤害，无视护甲）。`, "win");
      if (target.hp <= 0) { target.alive = false; log(`★ 击败 ${target.name}！`, "win"); }
    }
  } else if (suit === "diamond") {
    // 影舞步：本回合敌人攻击全闪避 + 下次攻击三连击 + 敌人下回合停顿（不行动）
    player.statuses.push({ id: "dodge_full_round", name: "影舞步·闪避", stacks: 99, duration: 1 });
    player.statuses.push({ id: "triple_strike",   name: "影舞步·三连", stacks: 1,  duration: -1 });
    player.statuses.push({ id: "time_stop",       name: "时停",       stacks: 1,  duration: 1 });
    log(`★♦ 影舞步！本回合 100% 闪避，下次攻击三连击，敌人下回合停顿。`, "win");
  } else if (suit === "heart") {
    // 生命洪流：HP +50% maxHP + maxHP +3
    const heal = Math.ceil(player.vitaMax * 0.5);
    const before = player.vita;
    player.vitaMax += 3;
    player.vita = Math.min(player.vitaMax, player.vita + heal);
    log(`★♥ 生命洪流！HP ${before} → ${player.vita}（+${heal}），maxHP +3。`, "win");
  } else if (suit === "club") {
    // 群体禁咒：全敌 +3 沉默 / +3 易伤 / +3 中毒
    for (const e of enemies) {
      if (!e.alive) continue;
      const exists = (id: string) => e.statuses.find(s => s.id === id);
      const sil = exists("silenced");
      if (sil) sil.duration = Math.max(sil.duration, 3);
      else e.statuses.push({ id: "silenced", name: "沉默", stacks: 1, duration: 3 });
      const vul = exists("vulnerable");
      if (vul) { vul.stacks += 1; vul.duration = Math.max(vul.duration, 3); }
      else e.statuses.push({ id: "vulnerable", name: "易伤", stacks: 1, duration: 3 });
      const psn = exists("poison");
      if (psn) psn.stacks += 3;
      else e.statuses.push({ id: "poison", name: "中毒", stacks: 3, duration: -1 });
    }
    log(`★♣ 群体禁咒！全体敌人 +沉默 +易伤 +中毒。`, "win");
  }

  // 本场释放标记 → 同 suit 在本场不能再放
  state.player.ultsThisBattle![suit] = true;

  // 大招消耗 8 亲和度（持久化到 suitConsumedTotal，跨战不归零，让大招真正吃 build 成本）
  consumeSuitAffinity(state.battle, suit, 8);
  log(`大招 ${suit}：消耗 8 亲和（永久），下场战斗恢复使用次数。`, "system");
  return true;
}

// ─────────────────────────────────────────────────────────
// 史诗装备耗尽 · 替换流程
// 玩家从 modal 选 1 张候选装备（来自牌库），自动装备
// ─────────────────────────────────────────────────────────

export function epicReplacementChoose(state: GameState, cardUid: string): boolean {
  if (!state.battle?.pendingEpicReplacement) return false;
  const { slot, candidates } = state.battle.pendingEpicReplacement;
  if (!candidates.includes(cardUid)) return false;
  const idx = state.player.deck.findIndex(c => c.uid === cardUid);
  if (idx < 0) return false;
  const picked = state.player.deck.splice(idx, 1)[0];
  // 验证类型匹配
  const def = CARD_DB[picked.defId];
  if (!def || def.category !== "equipment" || def.equipKind !== slot) {
    state.player.deck.push(picked);  // 回滚
    return false;
  }
  // 自动装备
  if (slot === "weapon") {
    state.battle.player.weapons.push(picked);
  } else {
    state.battle.player.armors.push(picked);
  }
  pushLog(state, `★ 替换装备：${def.name} 已自动装备。`, "player");
  state.battle.pendingEpicReplacement = undefined;
  return true;
}

// 玩家也可以"取消"——此时空槽，等待自然出装备牌
export function epicReplacementSkip(state: GameState) {
  if (!state.battle?.pendingEpicReplacement) return;
  const { slot } = state.battle.pendingEpicReplacement;
  pushLog(state, `跳过替换：${slot === "weapon" ? "武器" : "防具"} 槽位空缺。`, "system");
  state.battle.pendingEpicReplacement = undefined;
}

// ─────────────────────────────────────────────────────────
// 花色专精 · 手动切换激活花色（仅在多花色并列最高时生效）
// ─────────────────────────────────────────────────────────

export function setActiveSpecialty(state: GameState, suit: Suit): boolean {
  if (state.phase !== "battle" || !state.battle) return false;
  const tied = getTiedSpecialties(state.battle);
  if (!tied.includes(suit)) return false;  // 只能切换到当前并列最高的花色
  state.battle.activeSpecialtyOverride = suit;
  pushLog(state, `切换激活专精：${SUIT_SYMBOLS[suit]}。`, "player");
  return true;
}

// ─────────────────────────────────────────────────────────
// 铁匠铺 · 染色服务（机制 C：3 任意碎片 → 1 张攻击牌永久变色）
// 每次铁匠铺访问只能用 1 次
// ─────────────────────────────────────────────────────────

export function applyForgeRecolor(
  state: GameState,
  cardUid: string,
  targetSuit: Suit,
  paySpend: Partial<Record<EnemyRace, number>>,
): boolean {
  if (state.phase !== "forge") return false;
  if (state.forgeRecolorUsed) return false;
  // 验证支付总额 = 3
  let total = 0;
  for (const r in paySpend) total += paySpend[r as EnemyRace] ?? 0;
  if (total !== 3) return false;
  // 验证库存足够
  for (const r in paySpend) {
    const need = paySpend[r as EnemyRace] ?? 0;
    if ((state.player.fragments[r as EnemyRace] ?? 0) < need) return false;
  }
  // 找到攻击牌
  const card = state.player.deck.find(c => c.uid === cardUid)
    ?? state.player.hand.find(c => c.uid === cardUid)
    ?? state.player.discard.find(c => c.uid === cardUid);
  if (!card) return false;
  const def = CARD_DB[card.defId];
  if (def.category !== "attack") return false;
  // 扣碎片
  for (const r in paySpend) {
    const cost = paySpend[r as EnemyRace] ?? 0;
    state.player.fragments[r as EnemyRace] -= cost;
  }
  // 染色（修改 card 实例的 attackSuit；CardInstance 不能改 def，但 instance 上可加 override 字段）
  card.attackSuitOverride = targetSuit;
  state.forgeRecolorUsed = true;
  pushLog(state, `染坊：将「${def.name}」永久变为 ${SUIT_SYMBOLS[targetSuit]}。`, "win");
  return true;
}
