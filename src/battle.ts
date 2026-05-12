// 战斗系统 v0.8 (deck-builder)
// - 摸牌 / 出牌 / 弃牌
// - 攻击伤害公式：武器基础 × 叠加倍率 × 花色相性 × 临时buff × 特性钩子 × 楼层倍率
// - 多敌人支持（targetIndex 选择目标）

import type {
  BattleState,
  BattleContext,
  PlayerState,
  EnemyState,
  EnemyIntent,
  CardInstance,
  CardDef,
  LogKind,
  Suit,
} from "./types.ts";
import { HAND_LIMIT, DRAW_PER_TURN, SUIT_SYMBOLS, SUITS, getEnchantParam } from "./types.ts";
import { CARD_DB, suitMultiplier, damageEnemy, ENCHANT_EFFECTS, EPIC_USES_PER_BATTLE, REWARD_CARD_POOL_BASE, REWARD_CARD_POOL_AOE, makeInstance } from "./cards.ts";
import { selectAIIntent } from "./bossAI.ts";

// 检查玩家是否有染色/持咒 buff，返回强制使用的花色
// 优先级：持咒（整场） > 染色（本回合）
function getDyedSuit(player: PlayerState): Suit | null {
  for (const suit of SUITS) {
    if (player.statuses.some(s => s.id === `chanted_${suit}`)) return suit;
  }
  for (const suit of SUITS) {
    if (player.statuses.some(s => s.id === `dyed_${suit}`)) return suit;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 花色专精 · 亲和度系统
// ─────────────────────────────────────────────────────────

// 同花色攻击累积上限（cap，按花色独立计）
export const SUIT_PLAYED_CAP = 30;

// 每个花色 3 类来源累计（持久化跨战斗）
//  - 装备同花色：每件 +1.5（武器/防具叠加各算）
//  - 特性同花色：每张 +1
//  - 出过的同花色攻击牌（含染色/持咒后视为色）：每张 +0.2，cap 30
// 染色/持咒不再直接 +X 亲和（避免战斗内"暴涨 → 战斗后塌陷"的体验割裂）；
// 它们的"协助专精"作用通过 trackSuitPlayed 已经按视为色累积进 player.suitPlayedTotal
export function getSuitAffinity(state: BattleState, suit: Suit): number {
  let aff = 0;
  // 装备同花色：每件 +1.3
  for (const w of state.player.weapons) {
    if (CARD_DB[w.defId]?.equipSuit === suit) aff += 1.3;
  }
  for (const a of state.player.armors) {
    if (CARD_DB[a.defId]?.equipSuit === suit) aff += 1.3;
  }
  // 特性同花色：每张 +0.8
  for (const p of state.player.perks) {
    if (CARD_DB[p.defId]?.defaultSuit === suit) aff += 0.8;
  }
  // 出过的同花色攻击牌：每张 +0.3（持久化到 player.suitPlayedTotal，cap 30）
  const played = state.player.suitPlayedTotal?.[suit] ?? 0;
  aff += Math.min(SUIT_PLAYED_CAP, played) * 0.3;
  // 大招消耗：跨战斗持久化（读 player.suitConsumedTotal，不再用 status）
  const consumed = state.player.suitConsumedTotal?.[suit] ?? 0;
  aff -= consumed;
  return Math.max(0, Math.min(20, aff));
}

// 当前花色档位：0 / 1（≥5）/ 2（≥10）/ 3（≥15，可释放大招）
export function suitTier(state: BattleState, suit: Suit): 0 | 1 | 2 | 3 {
  const aff = getSuitAffinity(state, suit);
  if (aff >= 15) return 3;
  if (aff >= 10) return 2;
  if (aff >= 5) return 1;
  return 0;
}

// 当前激活的"花色专精"（用于显示主芯片 + 决定 Tier 1/2/3 效果归属）
// 规则：
//   1. 取亲和度最高的花色（< 5 时返回 null，因为没达到 Tier 1）
//   2. 多个花色并列最高时：
//      - 若 activeSpecialtyOverride 在并列集合中，使用 override
//      - 否则按"先到达"近似（同花色出牌累积最多者优先）+ 默认 SUITS 顺序兜底
export function getActiveSpecialty(state: BattleState): Suit | null {
  const entries = SUITS.map(s => ({
    s,
    a: getSuitAffinity(state, s),
    p: state.player.suitPlayedTotal?.[s] ?? 0,
  }));
  const maxAff = Math.max(...entries.map(e => e.a));
  if (maxAff < 5) return null;
  const tied = entries.filter(e => e.a === maxAff);
  if (tied.length === 1) return tied[0].s;
  if (state.activeSpecialtyOverride && tied.some(t => t.s === state.activeSpecialtyOverride)) {
    return state.activeSpecialtyOverride;
  }
  tied.sort((x, y) => y.p - x.p || SUITS.indexOf(x.s) - SUITS.indexOf(y.s));
  return tied[0].s;
}

// UI 主芯片显示的花色：即使没达到 Tier 1，也展示当前最高亲和度的花色（用于进度条引导）
export function getDisplayedSpecialty(state: BattleState): Suit {
  const active = getActiveSpecialty(state);
  if (active) return active;
  const entries = SUITS.map(s => ({
    s,
    a: getSuitAffinity(state, s),
    p: state.player.suitPlayedTotal?.[s] ?? 0,
  }));
  entries.sort((x, y) => y.a - x.a || y.p - x.p || SUITS.indexOf(x.s) - SUITS.indexOf(y.s));
  return entries[0].s;
}

// 检查某花色是否当前并列最高（用于"是否需要弹切换面板"的判定）
export function getTiedSpecialties(state: BattleState): Suit[] {
  const entries = SUITS.map(s => ({ s, a: getSuitAffinity(state, s) }));
  const maxAff = Math.max(...entries.map(e => e.a));
  if (maxAff < 5) return [];
  return entries.filter(e => e.a === maxAff).map(e => e.s);
}

// Tier 3 大招消耗：持久化到 player.suitConsumedTotal（跨战斗保留）
// 之前用 status 实现 → status 在 newBattle 全清，导致消耗形同虚设、跨战亲和度反弹
export function consumeSuitAffinity(state: BattleState, suit: Suit, amount: number): void {
  if (!state.player.suitConsumedTotal) {
    state.player.suitConsumedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  }
  state.player.suitConsumedTotal[suit] = (state.player.suitConsumedTotal[suit] ?? 0) + amount;
}

// ─────────────────────────────────────────────────────────
// 史诗卡使用次数：每场 3 次；用尽后回到牌库（非 discard）
// 装备类用尽后还要触发替换流程（pendingEpicReplacement）
// ─────────────────────────────────────────────────────────
function isEpicCard(card: CardInstance): boolean {
  return CARD_DB[card.defId]?.rarity === "epic";
}

// 选 3 张牌库里的非史诗装备（同槽位 weapon / armor）作为替换候选
function pickEpicReplacementCandidates(state: BattleState, slot: "weapon" | "armor"): string[] {
  const wantKind = slot;
  const pool = state.player.deck.filter(c => {
    const d = CARD_DB[c.defId];
    return d && d.category === "equipment" && d.equipKind === wantKind && d.rarity !== "epic";
  });
  // 随机洗 + 取前 3
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 3).map(c => c.uid);
}

// 史诗卡出过一次后的归位：用尽则回牌库，否则进弃牌堆
function dispatchPlayedCardEpicAware(state: BattleState, card: CardInstance, log: (m: string, k?: LogKind) => void): void {
  if (!isEpicCard(card)) {
    state.player.discard.push(card);
    return;
  }
  card.usesRemaining = Math.max(0, (card.usesRemaining ?? EPIC_USES_PER_BATTLE) - 1);
  if (card.usesRemaining <= 0) {
    state.player.deck.push(card);
    shuffleArr(state.player.deck);
    log(`${CARD_DB[card.defId].name} 本场已耗尽，回到牌库。`, "system");
  } else {
    state.player.discard.push(card);
  }
}

// 史诗装备耗尽：从 weapons/armors 拔出，放回牌库；新机制 — 自动恢复 backup（如果有）
function exhaustEpicEquipment(state: BattleState, slot: "weapon" | "armor", log: (m: string, k?: LogKind) => void): void {
  const arr = slot === "weapon" ? state.player.weapons : state.player.armors;
  if (arr.length === 0) return;
  const removed = arr.splice(0, arr.length);
  for (const c of removed) {
    c.usesRemaining = 0;
    state.player.deck.push(c);
  }
  shuffleArr(state.player.deck);
  const name = removed[0] ? CARD_DB[removed[0].defId].name : "史诗装备";

  // 新机制：恢复 backup（如果有），不弹替换 modal
  const backupKey = slot === "weapon" ? "tempWeaponBackup" : "tempArmorBackup";
  const backup = state.player[backupKey];
  if (backup && backup.length > 0) {
    if (slot === "weapon") state.player.weapons = backup;
    else state.player.armors = backup;
    state.player[backupKey] = undefined;
    const backupName = CARD_DB[backup[0].defId].name;
    log(`★ ${name} 已耗尽（回卡池）→ 自动恢复 ${backupName} ×${backup.length}。`, "win");
  } else {
    // 没 backup（玩家裸装时装的 EPIC）— 旧逻辑回退到替换 modal
    log(`★ ${name} 本场使用次数已耗尽，已返回牌库（请选 1 件替换装备）。`, "lose");
    state.pendingEpicReplacement = {
      slot,
      candidates: pickEpicReplacementCandidates(state, slot),
    };
  }
}

// 出过同花色攻击牌时累积（在 playAttack 调用）
// 持久化到 player.suitPlayedTotal，cap 30/色（见 SUIT_PLAYED_CAP）
function trackSuitPlayed(state: BattleState, suit: Suit): void {
  if (!state.player.suitPlayedTotal) {
    state.player.suitPlayedTotal = { spade: 0, diamond: 0, heart: 0, club: 0 };
  }
  const cur = state.player.suitPlayedTotal[suit] ?? 0;
  state.player.suitPlayedTotal[suit] = Math.min(SUIT_PLAYED_CAP, cur + 1);
}

// ─────────────────────────────────────────────────────────
// 牌库 / 弃牌堆 / 摸牌
// ─────────────────────────────────────────────────────────

export function shuffleArr<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function drawCards(player: PlayerState, n: number, log: (m: string, k?: LogKind) => void): number {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) break;
      player.deck = [...player.discard];
      player.discard = [];
      shuffleArr(player.deck);
      log("弃牌堆洗回牌库。", "system");
    }
    // 持咒本场已用过 → 摸到的同名副本自动跳过（弃到弃牌堆继续摸下一张，本次不计 drawn）
    const top = player.deck[player.deck.length - 1];
    if (top?.defId === "sk_chant" && player.statuses.find(s => s.id === "chanted_used")) {
      const c = player.deck.pop()!;
      player.discard.push(c);
      i--;  // 不算这次摸牌，再摸一次
      continue;
    }
    // 本场耗尽的史诗卡（含被替换下来的史诗装备 usesRemaining=0）：抽到自动跳过 → 抽下一张
    if (top && CARD_DB[top.defId]?.rarity === "epic" && (top.usesRemaining ?? 0) <= 0) {
      const c = player.deck.pop()!;
      player.discard.push(c);
      i--;
      continue;
    }
    // 手牌已满 → 摸出的牌进 pendingDraws，触发 UI 强制弃牌 modal
    if (player.hand.length >= HAND_LIMIT) {
      const c = player.deck.pop()!;
      if (!player.pendingDraws) player.pendingDraws = [];
      player.pendingDraws.push(c);
      log(`手牌已满，${CARD_DB[c.defId].name} 待手动弃牌后入手。`, "system");
      continue;
    }
    player.hand.push(player.deck.pop()!);
    drawn++;
  }
  return drawn;
}

// ─────────────────────────────────────────────────────────
// 新建战斗
// ─────────────────────────────────────────────────────────

export function newBattle(player: PlayerState, enemies: EnemyState[], floor: number = 1): BattleState {
  player.statuses = [];
  player.turnsElapsed = 0;
  // 把上一场残留的手牌/弃牌/未消化的强制弃牌候选全部塞回牌库，重新洗
  player.deck = [...player.deck, ...player.hand, ...player.discard, ...(player.pendingDraws ?? [])];
  player.hand = [];
  player.discard = [];
  player.pendingDraws = [];
  // 重置史诗卡的本场使用次数（含牌库 + 当前装备）
  for (const c of player.deck) {
    if (CARD_DB[c.defId]?.rarity === "epic") c.usesRemaining = EPIC_USES_PER_BATTLE;
  }
  for (const c of player.weapons) {
    if (CARD_DB[c.defId]?.rarity === "epic") c.usesRemaining = EPIC_USES_PER_BATTLE;
  }
  for (const c of player.armors) {
    if (CARD_DB[c.defId]?.rarity === "epic") c.usesRemaining = EPIC_USES_PER_BATTLE;
  }
  shuffleArr(player.deck);

  // 附魔战斗起始 buff
  if (player.weaponEnchant === "ec_runic") {
    // 符文护盾：每场首次受击免疫 + dot 免疫
    player.statuses.push({ id: "enc_runic_immune", name: "符文护盾", stacks: 1, duration: -1 });
    player.statuses.push({ id: "enc_dot_immune",   name: "圣化",     stacks: 1, duration: -1 });
  }

  return {
    phase: "playerTurn",
    turn: 1,
    player,
    enemies,
    targetIndex: enemies.findIndex(e => e.alive),
    attackedThisTurn: false,
    bowAttackStreak: 0,
    floor,
  };
}

// 应用跨场战斗惩罚（神秘宝箱陷阱）：在 startCurrentBattle 摸完 6 张后调用
export function applyNextBattlePenalty(state: BattleState, log: (m: string, k?: LogKind) => void): void {
  const penalty = state.player.nextBattlePenalty;
  if (!penalty) return;
  if (penalty === "miss_one") {
    // 起手随机弃 1 张
    if (state.player.hand.length > 0) {
      const idx = Math.floor(Math.random() * state.player.hand.length);
      const removed = state.player.hand.splice(idx, 1)[0];
      state.player.discard.push(removed);
      log("陷阱：起手少 1 张牌（已随机弃）。", "lose");
    }
  } else if (penalty === "miss_two") {
    for (let i = 0; i < 2; i++) {
      if (state.player.hand.length === 0) break;
      const idx = Math.floor(Math.random() * state.player.hand.length);
      const removed = state.player.hand.splice(idx, 1)[0];
      state.player.discard.push(removed);
    }
    log("陷阱：起手少 2 张牌。", "lose");
  } else if (penalty === "enemy_first") {
    // 第一回合敌人先打一次（用第一只活敌的第一招攻击的 value）
    const enemy = state.enemies.find(e => e.alive);
    if (enemy) {
      const firstAttack = enemy.intents.find(i => i.type === "attack");
      const dmg = firstAttack?.value ?? 5;
      log(`陷阱：${enemy.name} 抢先打了你！`, "lose");
      damagePlayer(state, dmg, log, enemy);
    }
  }
  state.player.nextBattlePenalty = undefined;
}

// ─────────────────────────────────────────────────────────
// 战斗上下文
// ─────────────────────────────────────────────────────────

function getCtx(state: BattleState, log: (m: string, k?: LogKind) => void, attackSuit?: Suit): BattleContext {
  return {
    player: state.player,
    enemies: state.enemies,
    target: state.enemies[state.targetIndex] ?? state.enemies[0],
    turn: state.turn,
    log,
    attackSuit,
    slotScale: 1.0,
    floor: state.floor,
  };
}

function ensureValidTarget(state: BattleState): EnemyState | null {
  if (state.enemies[state.targetIndex]?.alive) return state.enemies[state.targetIndex];
  for (let i = 0; i < state.enemies.length; i++) {
    if (state.enemies[i].alive) {
      state.targetIndex = i;
      return state.enemies[i];
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// 攻击伤害公式
// ─────────────────────────────────────────────────────────

function calcAttackDamage(state: BattleState, attackSuit: Suit, log: (m: string, k?: LogKind) => void): number {
  const player = state.player;
  const ctx = getCtx(state, log, attackSuit);

  if (player.weapons.length === 0) {
    log("无武器，徒手攻击。", "system");
    return 1;
  }

  const wDef = CARD_DB[player.weapons[0].defId];
  const stackCount = player.weapons.length;
  const stackMult = [1.0, 1.4, 1.8, 2.2][Math.min(stackCount, 4) - 1];
  ctx.slotScale = stackMult;

  let dmg = (wDef.baseDmg ?? 0) * stackMult;

  // 染色 buff 覆盖：如果玩家有 dyed_X 状态，攻击牌花色被改为 X
  const dyed = getDyedSuit(player);
  const actualAttackSuit = dyed ?? attackSuit;
  if (dyed) log(`染色：本张攻击视为 ${SUIT_SYMBOLS[dyed]}。`, "player");
  // 同步更新 ctx 上的 attackSuit，让特性（同花共鸣等）也基于染色后的花色判断
  ctx.attackSuit = actualAttackSuit;

  // 花色相性 vs 敌人
  const mult = suitMultiplier(actualAttackSuit, ctx.target.suit);
  if (mult > 1.0) log(`花色克制 ×${mult}。`, "player");
  else if (mult < 1.0) log(`异色 ×${mult}。`, "system");
  dmg *= mult;

  // 武器 onAttack（最高叠加层级触发）
  const wEff = wDef.equipEffects![Math.min(stackCount, 4) - 1];
  if (wEff.onAttack) dmg = wEff.onAttack(ctx, dmg);

  // 临时 buff
  if (player.statuses.find(s => s.id === "battle_cry")) dmg += 3;
  const wb = player.statuses.find(s => s.id === "weapon_buff");
  if (wb) dmg += wb.stacks;
  const sharp = player.statuses.find(s => s.id === "sharpened");
  if (sharp) {
    dmg = dmg * 1.5;
    log("磨刀石 ×1.5。", "player");
    player.statuses = player.statuses.filter(s => s.id !== "sharpened");
  }
  const heavyStrike = player.statuses.find(s => s.id === "heavy_strike");
  if (heavyStrike) {
    dmg += 10;
    log("猛击 +10！", "player");
    player.statuses = player.statuses.filter(s => s.id !== "heavy_strike");
  }
  const dbl = player.statuses.find(s => s.id === "double_strike");
  if (dbl) {
    dmg = dmg * 2;
    log("倍击 ×2！", "player");
    player.statuses = player.statuses.filter(s => s.id !== "double_strike");
  }
  // 激奋：每次攻击 +stacks×5；攻击末尾 stacks +1（在 playAttack 末尾处理）
  const frenzy = player.statuses.find(s => s.id === "frenzy");
  if (frenzy) {
    const bonus = frenzy.stacks * 2;
    dmg += bonus;
    log(`激奋 +${bonus}（×${frenzy.stacks}）。`, "player");
  }
  // 蓄力：×2.5，用一次清除（nerf：×3 → ×2.5）
  const charged = player.statuses.find(s => s.id === "charged");
  if (charged) {
    dmg = dmg * 2.5;
    log("蓄力 ×2.5！", "player");
    player.statuses = player.statuses.filter(s => s.id !== "charged");
  }
  // 玩家被虚弱：攻击 ×0.7（-30%，固定，stacks 只决定 duration）
  if (player.statuses.find(s => s.id === "weak")) {
    dmg = Math.floor(dmg * 0.7);
    log(`虚弱 -30%。`, "enemy");
  }

  // 特性 onDealDamage（单一 effect，按 stacks 缩放）
  const seen = new Set<string>();
  for (const inst of player.perks) {
    if (seen.has(inst.defId)) continue;
    seen.add(inst.defId);
    const pDef = CARD_DB[inst.defId];
    const cnt = player.perks.filter(p => p.defId === inst.defId).length;
    const eff = pDef.perkEffect;
    if (eff?.onDealDamage) dmg = eff.onDealDamage(ctx, dmg, cnt);
  }

  // 重甲笨重 postAttack
  if (player.armors.length > 0) {
    const aDef = CARD_DB[player.armors[0].defId];
    const aEff = aDef.equipEffects![Math.min(player.armors.length, 4) - 1];
    if (aEff.postAttack) dmg = aEff.postAttack(ctx, dmg);
  }

  // 敌人易伤：受击 ×1.3（-30%→+30% 受伤，stacks 只决定 duration）
  if (ctx.target.statuses.find(s => s.id === "vulnerable")) {
    dmg = dmg * 1.3;
    log(`${ctx.target.name} 易伤 ×1.3。`, "player");
  }

  // 楼层倍率（武器 instance）
  dmg *= player.weapons[0].scale ?? 1.0;

  // 法师杖（武器特性）+ 算计/凝神 附魔 + 奥术爆裂 的"非攻击牌累积器"统一计算
  const charge = player.statuses.find(s => s.id === "calc_charge");
  if (charge && charge.stacks > 0) {
    let mul = 0;
    if (player.weapons[0]?.defId === "arcane_scepter") mul += 3;
    // e_strategist / ec_focus：每非攻击牌 +N 伤，N 由 Lv 决定
    if (player.weaponEnchant === "e_strategist") mul += getEnchantParam(player, 0);
    if (player.weaponEnchant === "ec_focus")     mul += getEnchantParam(player, 0);
    // 奥术爆裂：本回合每张非攻击牌 +3
    if (player.statuses.find(s => s.id === "arcane_burst")) mul += 3;
    if (mul > 0) {
      const bonus = charge.stacks * mul;
      dmg += bonus;
      log(`累积加成 +${bonus}（${charge.stacks} 张 × ${mul}）。`, "player");
    }
    player.statuses = player.statuses.filter(s => s.id !== "calc_charge");
  }

  // 禁忌权杖（♣ epic 武器）：攻击数值 += ♣ 亲和度 × 0.5（向下取整，cap +10）
  // 设计要点：亲和度 cap 20 → bonus cap 10；玩家若用 ♣ 大招消耗 8 亲和会自损本武器伤害
  if (player.weapons[0]?.defId === "forbidden_scepter") {
    const clubAff = getSuitAffinity(state, "club");
    const bonus = Math.floor(clubAff * 0.5);
    if (bonus > 0) {
      dmg += bonus;
      log(`♣ 禁忌权杖 +${bonus}（♣ 亲和 ${clubAff.toFixed(1)} × 0.5）。`, "player");
    }
  }

  // 武器附魔 onAttack（其他附魔效果）
  let bypassArmor = false;
  if (player.weaponEnchant) {
    const enchant = ENCHANT_EFFECTS[player.weaponEnchant];
    if (enchant?.onAttack) dmg = enchant.onAttack(ctx, dmg);
    if (enchant?.bypassArmor?.(ctx, dmg)) bypassArmor = true;
  }

  // ★ 花色专精（XLSX 新版）：仅"激活的那一个"花色生效（多并列时由 activeSpecialtyOverride / 玩家选择决定）
  const activeSuit = getActiveSpecialty(state);
  const activeTier = activeSuit ? suitTier(state, activeSuit) : 0;

  // ♠ T1 锋锐怒涛：攻击 ×1.15（去掉旧版 5% 暴击）
  if (activeSuit === "spade" && activeTier >= 1) {
    dmg *= 1.15;
  }

  // ♥ T2 绝境攻击：HP <25% 攻击 +30%
  if (activeSuit === "heart" && activeTier >= 2 && player.vita < player.vitaMax * 0.25) {
    dmg *= 1.30;
    log("♥ 红心专精·绝境攻击：×1.3", "player");
  }

  // === 花色 keyword（T1 激活时跟随主流派；旧版 ♥ 全局 8% 吸血 已移除 — 专精专注花色） ===
  // ♠ 锐利：在 playAttack hits 循环里实现（45% 概率施加 1 层出血）
  // ♦ 灵敏：在 playAttack hits 循环里实现（25% +1 hit + 10% 暴击）
  // ♣ 镇守：在 playAttack hits 循环里实现（命中 +1 临时护盾）
  // ♥ 贪婪：♥ 攻击命中时 +10% 吸血
  if (activeSuit === "heart" && activeTier >= 1 && ctx.attackSuit === "heart") {
    const greedHeal = Math.max(0, Math.floor(dmg * 0.10));
    if (greedHeal > 0) {
      player.vita = Math.min(player.vitaMax, player.vita + greedHeal);
      log(`♥ 贪婪 keyword：吸血 ${greedHeal}。`, "player");
    }
  }

  // ★ 穿甲射状态：本次攻击无视全部 armor（一次性）
  const pierceNext = player.statuses.find(s => s.id === "pierce_next");
  if (pierceNext) {
    bypassArmor = true;
    player.statuses = player.statuses.filter(s => s.id !== "pierce_next");
    log("穿甲蓄势触发：本次攻击无视护甲。", "player");
  }

  // 骑士铠充能：受击 stack 起来，下次攻击 +X 直伤（按 stack 加成）
  const knightCharge = player.statuses.find(s => s.id === "knight_charge");
  if (knightCharge && player.armors[0]?.defId === "knight_plate") {
    const stackArm = Math.min(player.armors.length, 4);
    const bonusByStack = [3, 4, 5, 6];
    const bonusPer = bonusByStack[stackArm - 1] ?? 3;
    const total = bonusPer * knightCharge.stacks;
    dmg += total;
    player.statuses = player.statuses.filter(s => s.id !== "knight_charge");
    log(`骑士铠充能爆发 +${total} 直伤（${knightCharge.stacks} stack × ${bonusPer}）。`, "player");
  }

  // 敌人 armor 减伤（受 pierce 影响；夺命斩杀绕过；穿甲射绕过）
  if (!bypassArmor) {
    // 临时护甲（敌人 buff intent 触发：self_armor / team_armor）叠加到基础 armor 上
    const tempArmor = ctx.target.statuses.find(s => s.id === "temp_armor");
    const enemyArmor = (ctx.target.armor ?? 0) + (tempArmor?.stacks ?? 0);
    if (enemyArmor > 0) {
      // pierce 来源汇总：武器 + 破甲特性 + 破军 + ♠ Tier 2 + 穿甲斩 + 穿甲油
      // 注：p_insight 已改名"力量"并改为伤害%加成（onDealDamage 内处理），不再走 pierce 路径
      let pierce = wDef.pierce ?? 0;
      const armorBreakStacks = player.perks.filter(p => p.defId === "p_armor_break").length;
      pierce += armorBreakStacks;
      if (wDef.id === "raider") {
        // XLSX v6：固定 50% armor 破甲（向上取整），不再 stack 缩放
        pierce += Math.ceil(enemyArmor * 0.50);
      }
      // 狂剑 berserker_blade：HP < 50% 时额外 +2 pierce
      if (wDef.id === "berserker_blade" && player.vita < player.vitaMax * 0.5) {
        pierce += 2;
      }
      // 王者之剑（excalibur, ♠ epic）：v5 nerf，动态破甲 70% armor（同 raider 模式但固定 70%）
      if (wDef.id === "excalibur") {
        pierce += Math.ceil(enemyArmor * 0.7);
      }
      // ♠ T2 破甲黑刃：所有攻击 +1 pierce；♠ 攻击牌额外 +⌈floor/4⌉ pierce
      if (activeSuit === "spade" && activeTier >= 2) {
        pierce += 1;
        if (ctx.attackSuit === "spade") {
          pierce += Math.max(1, Math.ceil(state.floor / 4));
        }
      }
      // 穿甲油（本场战斗内永久 +2）
      const pierceOil = player.statuses.find(s => s.id === "pierce_perm");
      if (pierceOil) pierce += pierceOil.stacks;
      // 穿甲斩（本回合 +N，用一次清除）
      const pierceBonus = player.statuses.find(s => s.id === "pierce_bonus");
      if (pierceBonus) {
        pierce += pierceBonus.stacks;
        player.statuses = player.statuses.filter(s => s.id !== "pierce_bonus");
      }
      const effective = Math.max(0, enemyArmor - pierce);
      const actualPierce = Math.min(pierce, enemyArmor);
      if (actualPierce > 0) {
        log(`破甲 ${actualPierce}：${ctx.target.name} 实际减伤 ${effective}。`, "player");
      } else if (effective > 0) {
        log(`${ctx.target.name} 护甲减伤 ${effective}。`, "enemy");
      }
      dmg = Math.max(0, dmg - effective);
    }
  }

  return Math.max(0, Math.floor(dmg));
}

// ─────────────────────────────────────────────────────────
// 出牌：攻击 / 技能 / 道具 / 装备
// ─────────────────────────────────────────────────────────

export function playCard(state: BattleState, cardUid: string, log: (m: string, k?: LogKind) => void): boolean {
  if (state.phase !== "playerTurn") return false;
  const card = state.player.hand.find(c => c.uid === cardUid);
  if (!card) return false;
  const def = CARD_DB[card.defId];

  // 史诗卡使用次数耗尽 → 不能打出（提示玩家）
  if (isEpicCard(card) && (card.usesRemaining ?? 0) <= 0) {
    log(`${def.name} 本场已耗尽（史诗每场限 ${EPIC_USES_PER_BATTLE} 次），下场再来。`, "system");
    return false;
  }
  // 持咒本场限 1 次
  if (card.defId === "sk_chant" && state.player.statuses.find(s => s.id === "chanted_used")) {
    log(`${def.name} 本场已经触发过，不能再用。`, "system");
    return false;
  }
  // 速摸触发的"本回合技能锁"
  if (def.category === "skill" && state.player.statuses.find(s => s.id === "no_skill")) {
    log(`本回合已使用速摸，不能再出技能。`, "system");
    return false;
  }

  if (def.category === "attack") return playAttack(state, card, def, log);
  if (def.category === "skill" || def.category === "item") return playSkillOrItem(state, card, def, log);
  if (def.category === "equipment") return playEquipment(state, card, def, log);
  return false;
}

function playAttack(state: BattleState, card: CardInstance, def: CardDef, log: (m: string, k?: LogKind) => void): boolean {
  const hasRepeatingBow = state.player.weapons[0]?.defId === "repeating_bow";
  if (state.attackedThisTurn && !hasRepeatingBow) {
    log("本回合已经攻击过，下回合再来。", "system");
    return false;
  }
  if (state.player.statuses.find(s => s.id === "no_attack")) {
    log("蓄力中，本回合无法攻击。", "system");
    return false;
  }
  const target = ensureValidTarget(state);
  if (!target) return false;

  state.attackedThisTurn = true;

  // 花色追踪：本攻击牌的实际花色
  // 优先级：持咒/染色 > attackSuitOverride（铁匠铺染色） > def.attackSuit
  const baseSuit = card.attackSuitOverride ?? def.attackSuit!;
  const dyedActual = getDyedSuit(state.player) ?? baseSuit;
  trackSuitPlayed(state, dyedActual);

  // 注：禁忌权杖旧版本回合 ♣ 计数已废弃（改为读 ♣ 亲和度，见 calcAttackDamage）

  // 武器 hits（双刀 hits=2）+ 影袭额外 +1 hit
  const weaponDef = state.player.weapons[0] ? CARD_DB[state.player.weapons[0].defId] : null;
  const weaponHits = weaponDef?.hits ?? 1;
  const shadow = state.player.statuses.find(s => s.id === "shadow_double");
  const shadowBonus = shadow ? 1 : 0;
  if (shadow) {
    log("影袭：本次攻击 +1 hit。", "player");
    state.player.statuses = state.player.statuses.filter(s => s.id !== "shadow_double");
  }
  // ♦ T2 灵巧连击：30% 概率额外 +1 hit（与 T1 keyword 叠加，两个独立 roll）
  // ♦ T1 keyword 灵敏：♦ 攻击 25% 额外 +1 hit（独立 roll，可与 T2 叠）
  let diamondBonus = 0;
  const dSuitActive = getActiveSpecialty(state);
  const dTier = dSuitActive === "diamond" ? suitTier(state, "diamond") : 0;
  if (dSuitActive === "diamond" && dTier >= 2 && Math.random() < 0.30) {
    diamondBonus += 1;
    log("♦ 灵巧连击：+1 hit（T2 30%）。", "player");
  }
  if (dSuitActive === "diamond" && dTier >= 1 && baseSuit === "diamond" && Math.random() < 0.25) {
    diamondBonus += 1;
    log("♦ 灵敏 keyword：+1 hit（25%）。", "player");
  }
  // ♦ 大招 影子杀手：本次攻击 hits ×3（一次性）
  let tripleMult = 1;
  const triple = state.player.statuses.find(s => s.id === "triple_strike");
  if (triple) {
    tripleMult = 3;
    state.player.statuses = state.player.statuses.filter(s => s.id !== "triple_strike");
    log("♦ 影子杀手：本次攻击三连击！", "player");
  }
  const hits = (weaponHits + shadowBonus + diamondBonus) * tripleMult;
  if (weaponHits > 1) log(`${weaponDef?.name} hits ×${weaponHits}。`, "player");

  const weaponId = state.player.weapons[0]?.defId;
  for (let i = 0; i < hits; i++) {
    if (!target.alive) break;
    // 敌人闪避（per-hit）：精英 cap 9% / boss cap 15%；出血 -5%/层 cap -50%
    // 闪避不消耗玩家 buff（calcAttackDamage 不调用，sharpened / charge 留给下一 hit）
    const enemyDodge = getEnemyDodgeChance(target);
    if (enemyDodge > 0 && Math.random() * 100 < enemyDodge) {
      log(`✗ ${target.name} 闪避（${enemyDodge}%）！`, "enemy");
      continue;
    }
    let dmg = calcAttackDamage(state, baseSuit, log);
    // ♦ 灵敏 keyword：♦ 攻击 10% 概率暴击 ×2（独立 per-hit roll）
    const dSuitNow = getActiveSpecialty(state);
    if (dSuitNow === "diamond" && suitTier(state, "diamond") >= 1 && baseSuit === "diamond" && Math.random() < 0.10) {
      dmg *= 2;
      log(`♦ 灵敏 keyword：暴击 ×2（10%）！`, "player");
    }
    dmg = Math.floor(dmg);
    log(`▶ 攻击 ${SUIT_SYMBOLS[def.attackSuit!]} → ${target.name} -${dmg}。`, "player");
    damageEnemy(target, dmg, log);

    // ♠ 锐利 keyword：♠ 攻击命中 45% 概率施加 1 层出血（2 回合）
    const sSuitNow = getActiveSpecialty(state);
    if (sSuitNow === "spade" && suitTier(state, "spade") >= 1 && baseSuit === "spade" && target.alive && Math.random() < 0.45) {
      const ex = target.statuses.find(s => s.id === "bleed");
      if (ex) { ex.stacks += 1; ex.duration = Math.max(ex.duration, 2); }
      else target.statuses.push({ id: "bleed", name: "出血", stacks: 1, duration: 2 });
      log(`♠ 锐利 keyword：${target.name} +1 出血（45%）。`, "player");
    }

    // ♣ 镇守 keyword：♣ 攻击命中 → +1 临时护盾（持续 -1，每回合自动衰减）
    const cSuitNow = getActiveSpecialty(state);
    if (cSuitNow === "club" && suitTier(state, "club") >= 1 && baseSuit === "club") {
      const sh = state.player.statuses.find(s => s.id === "shield_block");
      if (sh) sh.stacks += 1;
      else state.player.statuses.push({ id: "shield_block", name: "护盾", stacks: 1, duration: -1 });
      log(`♣ 镇守 keyword：+1 临时护盾。`, "player");
    }

    // 箭毒蛙 / 抗凝血：第一次命中时附加 debuff，然后消耗 marker
    const poisonMark = state.player.statuses.find(s => s.id === "next_atk_apply_poison");
    if (poisonMark) {
      const stk = poisonMark.stacks;
      const ex = target.statuses.find(s => s.id === "poison");
      if (ex) ex.stacks += stk;
      else target.statuses.push({ id: "poison", name: "中毒", stacks: stk, duration: -1 });
      state.player.statuses = state.player.statuses.filter(s => s.id !== "next_atk_apply_poison");
      log(`🐸 箭毒蛙触发：${target.name} +${stk} 中毒。`, "player");
    }
    const bleedMark = state.player.statuses.find(s => s.id === "next_atk_apply_bleed");
    if (bleedMark) {
      const stk = bleedMark.stacks;
      const ex = target.statuses.find(s => s.id === "bleed");
      if (ex) { ex.stacks += stk; ex.duration = Math.max(ex.duration, 2); }
      else target.statuses.push({ id: "bleed", name: "出血", stacks: stk, duration: 2 });
      state.player.statuses = state.player.statuses.filter(s => s.id !== "next_atk_apply_bleed");
      log(`💧 抗凝血触发：${target.name} +${stk} 出血（2 回合）。`, "player");
    }

    // 血契 buff：本回合内攻击吸血额外 +20%（独立于 p_vampire）
    if (dmg > 0 && state.player.statuses.find(s => s.id === "blood_pact")) {
      const heal = Math.max(1, Math.floor(dmg * 0.20));
      const before = state.player.vita;
      state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
      if (state.player.vita > before) log(`血契：回 ${state.player.vita - before} HP。`, "player");
    }

    // 法杖：每次攻击给目标 +1 易伤（×1.5 受伤）持续 2 回合
    if (weaponId === "battle_staff" && target.alive) {
      const v = target.statuses.find(s => s.id === "vulnerable");
      if (v) v.duration = Math.max(v.duration, 2);
      else target.statuses.push({ id: "vulnerable", name: "易伤", stacks: 1, duration: 2 });
      log(`法杖：${target.name} +易伤（×1.5）。`, "player");
    }

    // 木盾杖（♣ common）：XLSX v6 简化为纯基础 5 伤，去掉护盾累积机制

    // 链刃：对其他存活敌人溅射，叠加值按 stack 升级 3/4/5/6
    if (weaponId === "chain_blade") {
      const splashByStack = [3, 4, 5, 6];
      const splash = splashByStack[Math.min(state.player.weapons.length, 4) - 1] ?? 3;
      for (const e of state.enemies) {
        if (!e.alive || e === target) continue;
        damageEnemy(e, splash, log, `链刃溅射：${e.name} -${splash}。`);
      }
    }
  }

  // 重甲列阵附魔：每攻击牌 -N 减伤累积，cap -M（Lv1-5: [-1,-2,3]/[-1,-3,4]/[-1,-3,5]/[-2,-4,6]/[-2,-5,7]）
  if (state.player.weaponEnchant === "ec_phalanx") {
    const perCard = getEnchantParam(state.player, 0);
    const cap = getEnchantParam(state.player, 1);
    const ex = state.player.statuses.find(s => s.id === "phalanx_dr");
    if (ex) {
      if (ex.stacks < cap) { ex.stacks = Math.min(cap, ex.stacks + perCard); ex.duration = 1; }
    } else {
      state.player.statuses.push({ id: "phalanx_dr", name: "重甲列阵", stacks: Math.min(cap, perCard), duration: 1 });
    }
  }

  // 卡进弃牌堆（史诗卡用尽时改为回到牌库）
  state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
  dispatchPlayedCardEpicAware(state, card, log);

  // 史诗武器：每次出攻击牌也消耗 1 次（用尽则拔下回牌库 + 触发替换）
  const equippedWeapon = state.player.weapons[0];
  if (equippedWeapon && isEpicCard(equippedWeapon)) {
    equippedWeapon.usesRemaining = Math.max(0, (equippedWeapon.usesRemaining ?? EPIC_USES_PER_BATTLE) - 1);
    if (equippedWeapon.usesRemaining <= 0) {
      exhaustEpicEquipment(state, "weapon", log);
    }
  }

  // 激奋：本张攻击结束后 stacks +1，下次更狠
  const frenzyStatus = state.player.statuses.find(s => s.id === "frenzy");
  if (frenzyStatus) frenzyStatus.stacks += 1;

  // 战斗节奏：每出 1 张牌摸 1 张（攻击牌也算）
  if (state.player.statuses.find(s => s.id === "combat_rhythm")) {
    drawCards(state.player, 1, log);
    log("战斗节奏：摸 1 张。", "player");
  }

  checkBattleEnd(state, log);
  return true;
}

function playSkillOrItem(state: BattleState, card: CardInstance, def: CardDef, log: (m: string, k?: LogKind) => void): boolean {
  if (def.target === "single" && !ensureValidTarget(state)) return false;
  const ctx = getCtx(state, log);
  // 群攻技能随武器叠加等比提升伤害
  // 注：此处只用武器叠加 stack 维度（×1.0/1.4/1.8/2.2），不再复合武器实例的 floorScale；
  // 否则 F8+ 拿到的 stack 4 武器会让 AOE 技能伤害爆炸（实测 F10 stack4 武器 ×4.95 倍）
  if (def.target === "all" && state.player.weapons.length > 0) {
    const sc = state.player.weapons.length;
    ctx.slotScale = [1.0, 1.4, 1.8, 2.2][Math.min(sc, 4) - 1];
  }

  // 注：旧版「♣ 守序」keyword 触发器（出 ♣ skill/item 时 +1 护盾）已移除。
  // 新版「♣ 镇守」改为 ♣ 攻击命中触发，实装在 playAttack hits 循环里。
  // 技能/道具已无花色，此路径不再有用。

  // 禁忌权杖（♣ epic 武器）：旧版从 ♣ skill/item 出牌处计数已移除（技能/道具已无花色）。
  // 现仅在 playAttack 内通过 dyedActual === "club" 计数（line 664）+ 出 ♣ 装备时计数（line 958）。

  if (def.onPlay) def.onPlay(ctx);

  // 花色手选（染色术 / 共鸣咒）——暂停到玩家选完花色再继续
  const suitPick = (ctx as any)._suitPick as string | undefined;
  if (suitPick) {
    state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
    dispatchPlayedCardEpicAware(state, card, log);
    accumulateCalcCharge(state, log);
    if (state.player.armors[0]?.defId === "mage_robe") {
      drawCards(state.player, 1, log);
      log("法袍：摸 1 张。", "player");
    }
    if (state.player.statuses.find(s => s.id === "combat_rhythm")) {
      drawCards(state.player, 1, log);
      log("战斗节奏：摸 1 张。", "player");
    }
    state.pendingSuitPick = suitPick;
    return true;
  }

  // 重整：弃所有手牌（不含当前），重摸 N
  const regroupN = (ctx as any)._regroup;
  if (regroupN) {
    // 暂时把当前卡从手牌取出，弃其他，再补摸
    state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
    state.player.discard.push(...state.player.hand);
    state.player.hand = [];
    dispatchPlayedCardEpicAware(state, card, log);
    drawCards(state.player, regroupN, log);
    checkBattleEnd(state, log);
    return true;
  }

  // 关键顺序：先把本张卡从手牌移除 → 进弃牌堆 → 再处理摸牌效果
  // 否则手牌满 10 时聚气类技能的摸牌会判定为溢出 → 进强制弃牌 modal，玩家被迫弃一张换不到位
  state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
  dispatchPlayedCardEpicAware(state, card, log);

  // 处理特殊指令（聚气摸 N / 快摸 摸 N 等）
  const drawN = (ctx as any)._drawN;
  if (drawN) drawCards(state.player, drawN, log);

  // 法袍：出技能/道具时摸 1 张
  if (state.player.armors[0]?.defId === "mage_robe") {
    drawCards(state.player, 1, log);
    log("法袍：摸 1 张。", "player");
  }

  // 生机长杖：出技能/道具时回 maxHP × 2-5%（按 stack 1-4 升级）— v5 改 % 缩放保持后期价值
  if (state.player.weapons[0]?.defId === "lifebloom_staff") {
    const stack = Math.min(state.player.weapons.length, 4);
    const pctByStack = [0.02, 0.03, 0.04, 0.05][stack - 1] ?? 0.02;
    const heal = Math.max(1, Math.ceil(state.player.vitaMax * pctByStack));
    const before = state.player.vita;
    state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
    if (state.player.vita > before) log(`生机长杖：回 ${state.player.vita - before} HP（${(pctByStack*100).toFixed(0)}% maxHP）。`, "player");
  }

  // 战斗节奏：本回合内每出 1 张牌额外摸 1 张
  if (state.player.statuses.find(s => s.id === "combat_rhythm")) {
    drawCards(state.player, 1, log);
    log("战斗节奏：摸 1 张。", "player");
  }

  // 复读机：本场战斗每出非攻击牌后，复制 1 份到手牌（不复制复读机自己，避免无限链）
  if (state.player.statuses.find(s => s.id === "echo") && card.defId !== "it_echo") {
    const clone = { ...card, uid: `${card.uid}_echo_${Math.random().toString(36).slice(2, 6)}` };
    if (state.player.hand.length < HAND_LIMIT) {
      state.player.hand.push(clone);
      log(`复读机：复制了一份 ${CARD_DB[card.defId].name} 回手牌。`, "player");
    } else {
      if (!state.player.pendingDraws) state.player.pendingDraws = [];
      state.player.pendingDraws.push(clone);
      log(`复读机：${CARD_DB[card.defId].name} 待手动弃牌后入手。`, "player");
    }
  }

  // 法师杖 / 算计 / 凝神 附魔：每出非攻击牌累积加成
  accumulateCalcCharge(state, log);

  // 秘法回响附魔：每出 1 张非攻击牌额外摸 1 张（每回合 cap 3）
  if (state.player.weaponEnchant === "ec_arcane") {
    const ex = state.player.statuses.find(s => s.id === "arcane_draws");
    const drawn = ex ? ex.stacks : 0;
    if (drawn < 3) {
      drawCards(state.player, 1, log);
      log("秘法回响：摸 1 张。", "player");
      if (ex) ex.stacks += 1;
      else state.player.statuses.push({ id: "arcane_draws", name: "秘法摸牌", stacks: 1, duration: 1 });
    }
  }

  checkBattleEnd(state, log);
  return true;
}

// 累积"非攻击牌已出张数"——多个消费者读取：
//   - 法师杖（arcane_scepter）/ 算计附魔（e_strategist）/ 凝神附魔（ec_focus）：下次攻击 +N/stack
//   - 奥术爆裂 status：下次攻击 +3/stack
//   - 心刃技能：直接读 stacks ×4 当作直伤
// 修复：旧版有装备 gate 导致没装这些装备的玩家心刃永远 0 stack → 1 伤。改为始终累积，由消费者决定要不要用。
function accumulateCalcCharge(state: BattleState, _log: (m: string, k?: LogKind) => void) {
  const existing = state.player.statuses.find(s => s.id === "calc_charge");
  if (existing) existing.stacks += 1;
  else state.player.statuses.push({ id: "calc_charge", name: "累积加成", stacks: 1, duration: -1 });
}

function playEquipment(state: BattleState, card: CardInstance, def: CardDef, log: (m: string, k?: LogKind) => void): boolean {
  const player = state.player;
  // 注：禁忌权杖旧版 ♣ 装备计数已废弃（改为读 ♣ 亲和度，见 calcAttackDamage）
  const isEpic = def.rarity === "epic";

  if (def.equipKind === "weapon") {
    // EPIC 临时装备机制：覆写当前武器，原武器进 tempWeaponBackup
    // 3 次后 exhaustEpicEquipment 自动恢复 backup，原武器保留
    if (isEpic) {
      // 已有 EPIC 武器装着？同款则叠加（罕见），不同款则报错（不允许同时挂 2 个 EPIC）
      if (player.weapons.length > 0 && CARD_DB[player.weapons[0].defId]?.rarity === "epic" && player.weapons[0].defId !== def.id) {
        log(`已有 EPIC 武器在场，需用尽后才能换。`, "system");
        return false;
      }
      // 第一次装 EPIC：把当前非 EPIC 武器移到 backup
      if (player.weapons.length > 0 && CARD_DB[player.weapons[0].defId]?.rarity !== "epic") {
        player.tempWeaponBackup = [...player.weapons];
        player.weapons = [];
        log(`★ EPIC 临时覆写：${CARD_DB[player.tempWeaponBackup[0].defId].name} ×${player.tempWeaponBackup.length} 暂存，EPIC 用尽后自动恢复。`, "system");
      }
      // 装上 EPIC（如果已经是同款 EPIC 则叠加）
      if (player.weapons.length >= 4) { log(`武器已叠满 4 张。`, "system"); return false; }
      player.weapons.push(card);
      player.hand = player.hand.filter(c => c.uid !== card.uid);
      log(`装备 ${def.name} ×${player.weapons.length}（EPIC：3 次后自动回卡池）。`, "player");
      accumulateCalcCharge(state, log);
      return true;
    }
    // 非 EPIC 武器（原逻辑）
    if (player.weapons.length > 0 && player.weapons[0].defId !== def.id) {
      log(`需要先弃当前武器才能装备 ${def.name}。`, "system");
      return false;
    }
    if (player.weapons.length >= 4) { log(`武器已叠满 4 张。`, "system"); return false; }
    player.weapons.push(card);
    player.hand = player.hand.filter(c => c.uid !== card.uid);
    log(`装备 ${def.name} ×${player.weapons.length}。`, "player");
    accumulateCalcCharge(state, log);
    return true;
  }

  if (def.equipKind === "armor") {
    if (isEpic) {
      if (player.armors.length > 0 && CARD_DB[player.armors[0].defId]?.rarity === "epic" && player.armors[0].defId !== def.id) {
        log(`已有 EPIC 防具在场，需用尽后才能换。`, "system");
        return false;
      }
      if (player.armors.length > 0 && CARD_DB[player.armors[0].defId]?.rarity !== "epic") {
        player.tempArmorBackup = [...player.armors];
        player.armors = [];
        log(`★ EPIC 临时覆写：${CARD_DB[player.tempArmorBackup[0].defId].name} ×${player.tempArmorBackup.length} 暂存，EPIC 用尽后自动恢复。`, "system");
      }
      if (player.armors.length >= 4) { log(`防具已叠满 4 张。`, "system"); return false; }
      player.armors.push(card);
      player.hand = player.hand.filter(c => c.uid !== card.uid);
      log(`装备 ${def.name} ×${player.armors.length}（EPIC：3 次后自动回卡池）。`, "player");
      accumulateCalcCharge(state, log);
      return true;
    }
    if (player.armors.length > 0 && player.armors[0].defId !== def.id) {
      log(`需要先弃当前防具才能装备 ${def.name}。`, "system");
      return false;
    }
    if (player.armors.length >= 4) { log(`防具已叠满 4 张。`, "system"); return false; }
    player.armors.push(card);
    player.hand = player.hand.filter(c => c.uid !== card.uid);
    log(`装备 ${def.name} ×${player.armors.length}。`, "player");
    accumulateCalcCharge(state, log);
    return true;
  }
  return false;
}

// 强制弃当前武器/防具（让玩家换装备）
// 短剑特殊：起始过渡品，弃后永久销毁不进弃牌堆
export function discardWeapons(state: BattleState, log: (m: string, k?: LogKind) => void) {
  let destroyed = 0;
  let discarded = 0;
  for (const w of state.player.weapons) {
    if (w.defId === "short_sword") {
      destroyed++;
    } else {
      state.player.discard.push(w);
      discarded++;
    }
  }
  state.player.weapons = [];
  if (destroyed > 0) log(`销毁 ${destroyed} 张短剑（起始过渡品，不回牌库）。`, "system");
  if (discarded > 0) log(`${discarded} 张武器进入弃牌堆。`, "system");
}
export function discardArmors(state: BattleState, log: (m: string, k?: LogKind) => void) {
  state.player.discard.push(...state.player.armors);
  state.player.armors = [];
  log("弃掉所有当前防具。", "system");
}

// ─────────────────────────────────────────────────────────
// 玩家受击
// ─────────────────────────────────────────────────────────

// 当前总闪避概率（百分比）— 全部来源汇总，cap 75%
// 之前漏算 ec_swift / swift_dodge_temp / ♦T1 / bleed 扣减 → UI 显示与实际不一致
// 来源（与 damagePlayer line 930-938 实际 roll 同步）：
//   意念甲叠加 + p_dodge 特性 + 烟雾弹 + ec_swift 附魔 +10% + 风行余势 stacks
//   + ♦ T1 active 时 +5% - 出血每层 -5% → cap 75%
export function getCurrentDodgeChance(player: PlayerState, state?: BattleState): number {
  let chance = 0;
  // 意念甲：每层 +10%（×1=10, ×2=20, ×3=30, ×4=40）
  if (player.armors[0]?.defId === "mind_armor") {
    const stacks = Math.min(player.armors.length, 4);
    chance += stacks * 10;
  }
  // p_dodge 特性：每张 +3%，cap 50%
  const dodgePerks = player.perks.filter(p => p.defId === "p_dodge").length;
  chance += Math.min(50, dodgePerks * 5);
  // 烟雾弹临时 buff（多回合）
  const smoke = player.statuses.find(s => s.id === "smoke_dodge");
  if (smoke) chance += smoke.stacks;
  // 风行步附魔：常驻 +N%（Lv1-5: 8/10/12/14/16，idx 0）
  if (player.weaponEnchant === "ec_swift") chance += getEnchantParam(player, 0);
  // 风行余势：闪避触发后本回合临时叠加
  const swiftTemp = player.statuses.find(s => s.id === "swift_dodge_temp");
  if (swiftTemp) chance += swiftTemp.stacks;
  // ♦ T1 疾风闪步：当前激活方块专精 ≥ T1 时 +8%
  if (state && getActiveSpecialty(state) === "diamond" && suitTier(state, "diamond") >= 1) {
    chance += 8;
  }
  // 出血扣减：每层 -5%，cap -50
  const bleedPenalty = getBleedDodgePenalty(player);
  chance = Math.max(0, chance - bleedPenalty);
  return Math.min(75, chance);
}

// ─────────────────────────────────────────────────────────
// DOT 副作用：中毒削暴击 / 出血削闪避（百分点）
// ─────────────────────────────────────────────────────────
// 玩家中毒：暴击率 -stacks × 5%（cap -50 百分点）— 调整：3% → 5% / 30 → 50（双向通用）
export function getPoisonCritPenalty(player: PlayerState): number {
  const p = player.statuses.find(s => s.id === "poison");
  return p ? Math.min(50, p.stacks * 5) : 0;
}
// 玩家出血：闪避率 -stacks × 5%（cap -50 百分点）
export function getBleedDodgePenalty(player: PlayerState): number {
  const b = player.statuses.find(s => s.id === "bleed");
  return b ? Math.min(50, b.stacks * 5) : 0;
}

// 敌人当前暴击率（百分点）：基础 - 中毒 5%/层（cap -50）
export function getEnemyCritChance(enemy: EnemyState): number {
  const base = enemy.critChance ?? 0;
  if (base <= 0) return 0;
  const p = enemy.statuses.find(s => s.id === "poison");
  const penalty = p ? Math.min(50, p.stacks * 5) : 0;
  return Math.max(0, base - penalty);
}
// 敌人当前闪避率（百分点）：基础 - 出血 5%/层（cap -50）
export function getEnemyDodgeChance(enemy: EnemyState): number {
  const base = enemy.dodgeChance ?? 0;
  if (base <= 0) return 0;
  const b = enemy.statuses.find(s => s.id === "bleed");
  const penalty = b ? Math.min(50, b.stacks * 5) : 0;
  return Math.max(0, base - penalty);
}

// 完全闪避后的统一处理：附魔触发 + 风行步连锁
function onDodgeTriggered(state: BattleState, attackerEnemy?: EnemyState, log?: (m: string, k?: LogKind) => void): void {
  const e = state.player.weaponEnchant;
  // 旧 phantom 已删除；现在是 e_phantom（暗影 ×3）触发幻影残像
  if (e === "e_phantom") {
    state.player.statuses.push({ id: "phantom_charge", name: "幻影残像", stacks: 1, duration: -1 });
  }

  // 风刃（♦ epic 武器）：闪避后下张攻击 +1 hit（复用 shadow_double 机制）
  if (state.player.weapons[0]?.defId === "wind_blade") {
    state.player.statuses.push({ id: "shadow_double", name: "风刃·+1 hit", stacks: 1, duration: -1 });
    log?.("♦ 风刃：闪避后下张攻击 +1 hit。", "player");
  }

  // 幻影披风（♦ epic 防具）：闪避后摸 1-2 张
  if (state.player.armors[0]?.defId === "phantom_cloak" && log) {
    const stack = Math.min(state.player.armors.length, 4);
    const drawN = stack >= 3 ? 2 : 1;
    drawCards(state.player, drawN, log);
    log(`♦ 幻影披风：闪避后摸 ${drawN} 张。`, "player");
  }
  // 风行步：闪避后本回合内闪避 +M%（cap K%）；M = idx 1，K = idx 2
  if (e === "ec_swift") {
    const incPct = getEnchantParam(state.player, 1);
    const capPct = getEnchantParam(state.player, 2);
    const ex = state.player.statuses.find(s => s.id === "swift_dodge_temp");
    if (ex) {
      ex.stacks = Math.min(capPct, ex.stacks + incPct);
      ex.duration = Math.max(ex.duration, 1);
    } else {
      state.player.statuses.push({ id: "swift_dodge_temp", name: "风行余势", stacks: Math.min(capPct, incPct), duration: 1 });
    }
    // 闪避后给当前目标 +N 易伤（N = idx 3）
    const target = attackerEnemy?.alive
      ? attackerEnemy
      : state.enemies[state.targetIndex] ?? state.enemies.find(en => en.alive);
    if (target) {
      const vulnInc = getEnchantParam(state.player, 3);
      const v = target.statuses.find(s => s.id === "vulnerable");
      if (v) { v.stacks += vulnInc; v.duration = Math.max(v.duration, 2); }
      else target.statuses.push({ id: "vulnerable", name: "易伤", stacks: vulnInc, duration: 2 });
    }
  }
}

function damagePlayer(state: BattleState, base: number, log: (m: string, k?: LogKind) => void, attackerEnemy?: EnemyState) {
  // ★ 闪避优先级 0：影子杀手（本回合 100% 闪避）
  if (state.player.statuses.find(s => s.id === "dodge_full_round")) {
    log("★♦ 影子杀手：本回合闪避！", "player");
    state.pendingDodgeFx = (state.pendingDodgeFx ?? 0) + 1;
    return;
  }
  // ★ 闪避优先级 1：风步（必定闪避，一次性）
  const guarantee = state.player.statuses.find(s => s.id === "guaranteed_dodge");
  if (guarantee) {
    state.player.statuses = state.player.statuses.filter(s => s.id !== "guaranteed_dodge");
    log("★ 风步：必定闪避！", "player");
    onDodgeTriggered(state, undefined, log);
    state.pendingDodgeFx = (state.pendingDodgeFx ?? 0) + 1;
    return;
  }
  // ★ 闪避优先级 2：闪避概率 roll（来源已全部统一进 getCurrentDodgeChance）
  const dodgeChance = getCurrentDodgeChance(state.player, state);
  // activeSuitD 在后面 ♥ / ♣ / ♦ 受击/反伤逻辑里继续用，保留一份
  const activeSuitD = getActiveSpecialty(state);
  if (dodgeChance > 0 && Math.random() * 100 < dodgeChance) {
    log(`★ 闪避！（${dodgeChance}%）`, "player");
    onDodgeTriggered(state, attackerEnemy, log);
    state.pendingDodgeFx = (state.pendingDodgeFx ?? 0) + 1;
    return;
  }

  // ★ 符文护盾：每场首次受击 -M%（Lv1-2: 50%, Lv3+: 100% 完全免疫）
  const runicImmune = state.player.statuses.find(s => s.id === "enc_runic_immune");
  if (runicImmune && state.player.weaponEnchant === "ec_runic") {
    state.player.statuses = state.player.statuses.filter(s => s.id !== "enc_runic_immune");
    const reductionPct = getEnchantParam(state.player, 1);
    if (reductionPct >= 100) {
      log("★ 符文护盾：本场首次受击完全免疫！", "player");
      state.pendingDodgeFx = (state.pendingDodgeFx ?? 0) + 1;
      return;
    } else {
      // 部分免疫：base 直接按比例砍
      base = Math.max(0, Math.floor(base * (1 - reductionPct / 100)));
      log(`★ 符文护盾：本场首次受击 -${reductionPct}%（${base} 伤穿透）。`, "player");
    }
  }

  let dmg = base;
  const ctx = getCtx(state, log);

  // 易伤：受到伤害 ×1.3（系统级削弱：原 ×1.5）
  if (state.player.statuses.find(s => s.id === "vulnerable")) {
    dmg = Math.floor(dmg * 1.3);
    log("易伤：伤害 ×1.3。", "enemy");
  }

  // 附魔减伤：守护契 / 重甲列阵 / 符文护盾
  const enc = state.player.weaponEnchant;
  // 守护契：受击 -N（idx 0）+ HP > 80% 再 -M（idx 1）
  // Lv1-5: [-1, -1] / [-2, -1] / [-2, -2] / [-3, -3] / [-4, -4]
  if (enc === "ec_resilient") {
    const base = getEnchantParam(state.player, 0);
    const hiHpBonus = getEnchantParam(state.player, 1);
    dmg = Math.max(0, dmg - base);
    if (state.player.vita > state.player.vitaMax * 0.80) {
      dmg = Math.max(0, dmg - hiHpBonus);
    }
  }
  // 符文护盾：受击 -N（idx 0；Lv1-5: 1/2/3/3/4）
  if (enc === "ec_runic") {
    dmg = Math.max(0, dmg - getEnchantParam(state.player, 0));
  }
  const phalanxDr = state.player.statuses.find(s => s.id === "phalanx_dr");
  if (phalanxDr && enc === "ec_phalanx") {
    dmg = Math.max(0, dmg - phalanxDr.stacks);
  }

  // ★ 花色专精：受击类减伤 / 反伤，按"激活的那一个"花色生效
  // ♥ Tier 2：HP <50% 受击 -30%
  if (activeSuitD === "heart" && suitTier(state, "heart") >= 2 && state.player.vita < state.player.vitaMax * 0.5) {
    const before = dmg;
    dmg = Math.floor(dmg * 0.7);
    log(`♥ 红心专精·生存：受击 ${before}→${dmg}。`, "player");
  }
  // ♣ T1 魔法庇护：受击 -3（T2 已改为反应装甲，不再叠 -3）
  if (activeSuitD === "club" && suitTier(state, "club") >= 1) {
    dmg = Math.max(0, dmg - 3);
  }

  // 防具 onTakeDamage
  if (state.player.armors.length > 0) {
    const aDef = CARD_DB[state.player.armors[0].defId];
    const aEff = aDef.equipEffects![Math.min(state.player.armors.length, 4) - 1];
    if (aEff.onTakeDamage) dmg = aEff.onTakeDamage(ctx, dmg);
  }

  // 特性 onTakeDamage（单一 effect，按 stacks 缩放）
  const seen = new Set<string>();
  for (const inst of state.player.perks) {
    if (seen.has(inst.defId)) continue;
    seen.add(inst.defId);
    const pDef = CARD_DB[inst.defId];
    const cnt = state.player.perks.filter(p => p.defId === inst.defId).length;
    const eff = pDef.perkEffect;
    if (eff?.onTakeDamage) dmg = eff.onTakeDamage(ctx, dmg, cnt);
  }

  // 闪避姿态：伤害 ×0.7（原 ×0.5 = 减半 → 现 -30%）
  if (state.player.statuses.find(s => s.id === "evasive")) {
    dmg = Math.floor(dmg * 0.7);
    log("闪避姿态：伤害 -30%。", "player");
  }

  // 护盾吸收
  const shield = state.player.statuses.find(s => s.id === "shield_block");
  if (shield && dmg > 0) {
    const absorbed = Math.min(shield.stacks, dmg);
    dmg -= absorbed;
    shield.stacks -= absorbed;
    log(`护盾吸收 ${absorbed}。`, "player");
    if (shield.stacks <= 0) {
      state.player.statuses = state.player.statuses.filter(s => s.id !== "shield_block");
      // ♣ T2 反应装甲：最后一层临时护盾失效时 25% 概率给攻击者 +1 易伤（3 回合）
      if (getActiveSpecialty(state) === "club" && suitTier(state, "club") >= 2
          && attackerEnemy && attackerEnemy.alive && Math.random() < 0.25) {
        const v = attackerEnemy.statuses.find(s => s.id === "vulnerable");
        if (v) { v.stacks += 1; v.duration = Math.max(v.duration, 3); }
        else attackerEnemy.statuses.push({ id: "vulnerable", name: "易伤", stacks: 1, duration: 3 });
        log(`♣ 反应装甲：${attackerEnemy.name} +1 易伤（25%）。`, "player");
      }
    }
  }

  dmg = Math.max(0, Math.floor(dmg));
  if (dmg > 0) {
    state.player.vita -= dmg;
    log(`你受到 ${dmg} 点伤害。`, "enemy");

    // 标记本回合受伤（用于 ec_phalanx 末端判断"未受伤则下回合 +5 护盾"）
    // 用 duration=-1，由 endPlayerTurn 在敌人回合结束后手动检查并清理
    if (!state.player.statuses.find(s => s.id === "took_damage_turn")) {
      state.player.statuses.push({ id: "took_damage_turn", name: "本回合受伤", stacks: 1, duration: -1 });
    }

    // 骑士铠（♠ rare 防具）：受击后下次攻击充能 +X 直伤（v5 cap 5 → 3，防止 5 击换 +30 burst）
    if (state.player.armors[0]?.defId === "knight_plate") {
      const stack = Math.min(state.player.armors.length, 4);
      const bonusByStack = [3, 4, 5, 6];
      const bonus = bonusByStack[stack - 1] ?? 3;
      const existing = state.player.statuses.find(s => s.id === "knight_charge");
      if (existing) {
        existing.stacks = Math.min(3, existing.stacks + 1);  // cap 3
      } else {
        state.player.statuses.push({ id: "knight_charge", name: `骑士充能 +${bonus}`, stacks: 1, duration: -1 });
      }
      log(`骑士铠充能：下次攻击 +${bonus} 直伤（×${existing?.stacks ?? 1}，cap 3）。`, "player");
    }

    // 战甲带（♠ rare 防具）：XLSX v6 固定 +2 攻击（去掉 stack 缩放）
    if (state.player.armors[0]?.defId === "combat_belt") {
      const existing = state.player.statuses.find(s => s.id === "battle_cry");
      if (existing) existing.stacks += 2;
      else state.player.statuses.push({ id: "battle_cry", name: "战甲带激怒", stacks: 2, duration: 1 });
      log(`♠ 战甲带：下次攻击 +2。`, "player");
    }

    // 斩魂铠（♠ super_rare 防具）：XLSX v6 固定 +1 永久攻 / 受击（cap 10）
    if (state.player.armors[0]?.defId === "soulreaver_plate") {
      const existing = state.player.statuses.find(s => s.id === "warblood_perm_atk");
      if (existing) {
        if (existing.stacks < 10) existing.stacks = Math.min(10, existing.stacks + 1);
      } else {
        state.player.statuses.push({ id: "warblood_perm_atk", name: "斩魂蓄势", stacks: 1, duration: -1 });
      }
      log(`♠ 斩魂铠：永久攻击 +1（累计 ${(existing?.stacks ?? 0) + 1}）。`, "player");
    }

    // 不朽战甲（♠ epic 防具）：受击后下张攻击 +1 hit（复用 shadow_double）
    if (state.player.armors[0]?.defId === "immortal_plate") {
      state.player.statuses.push({ id: "shadow_double", name: "不朽战甲·+1 hit", stacks: 1, duration: -1 });
      log("♠ 不朽战甲：下张攻击 +1 hit。", "player");
    }

    // 注：旧版 ♦ T1 受击反弹 +3 已移除（XLSX 新版 ♦ T1 只有 8% 闪避，无反伤）

    // 不灭之心：HP 归 0 时复活到 50%，整局仅 1 次（XLSX v6：固定 50%，stack 不增加复活效率）
    if (state.player.vita <= 0
        && state.player.armors[0]?.defId === "undying_heart"
        && (state.player.revivesUsed ?? 0) < 1) {
      state.player.vita = Math.round(state.player.vitaMax * 0.50);
      state.player.revivesUsed = (state.player.revivesUsed ?? 0) + 1;
      log(`★ 不灭之心：整局唯一一次复活，恢复到 ${state.player.vita} HP（50%）。`, "win");
    }

    // 反击姿态：反弹 50%
    if (state.player.statuses.find(s => s.id === "counter_stance") && attackerEnemy?.alive) {
      const reflect = Math.floor(dmg * 0.5);
      if (reflect > 0) {
        damageEnemy(attackerEnemy, reflect, log, `反击姿态：${attackerEnemy.name} -${reflect}。`);
      }
    }

    // 史诗防具：每次实际受击消耗 1 次（用尽则脱下回牌库 + 触发替换）
    const equippedArmor = state.player.armors[0];
    if (equippedArmor && isEpicCard(equippedArmor) && state.player.vita > 0) {
      equippedArmor.usesRemaining = Math.max(0, (equippedArmor.usesRemaining ?? EPIC_USES_PER_BATTLE) - 1);
      if (equippedArmor.usesRemaining <= 0) {
        exhaustEpicEquipment(state, "armor", log);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// 敌人回合
// ─────────────────────────────────────────────────────────

// 选择 enemy 本回合下一个 intent 的 index
// - 装备 AI 的精英/boss：调用 bossAI selectAIIntent（带 avoidIndices）
// - 普通 boss：随机不重复
// - 其他：顺序循环
// 注：所有路径都过一次 debuff 饱和检查 — 如果选中的 intent 是已饱和的 debuff（玩家堆了 20+ 中毒还要叠中毒之类），
// 改选同 enemy 其他可用 intent，避免 AI 看起来"愣头愣脑"地叠废 debuff
function chooseEnemyIntentIdx(enemy: EnemyState, state: BattleState, usedThisTurn: number[]): number {
  const rawIdx = chooseRawIntentIdx(enemy, state, usedThisTurn);
  return redirectIfSaturated(enemy, state, rawIdx, usedThisTurn);
}

function chooseRawIntentIdx(enemy: EnemyState, state: BattleState, usedThisTurn: number[]): number {
  if (enemy.ai) {
    const aiIdx = selectAIIntent(enemy, state, usedThisTurn);
    if (aiIdx >= 0 && aiIdx < enemy.intents.length) return aiIdx;
  }
  if (enemy.tier === "boss" && enemy.intents.length > 1) {
    let next: number;
    let safety = 8;
    do {
      next = Math.floor(Math.random() * enemy.intents.length);
      safety--;
    } while ((next === enemy.intentIndex || usedThisTurn.includes(next)) && safety > 0);
    return next;
  }
  // 顺序循环（普通敌人 / 精英无 AI）
  return (enemy.intentIndex + 1) % enemy.intents.length;
}

// 玩家身上某个 debuff 是否已堆到 "再叠也基本浪费" 的程度
//   DoT 类（poison / burn / bleed）：达到固定阈值则浪费 — 每回合伤害已经够高
//   纯标记类（weak / vulnerable / silenced / frozen / fear）：stacks 只控 duration，再叠几乎没增益
export function isDebuffSaturated(state: BattleState, debuffId: string): boolean {
  const status = state.player.statuses.find(s => s.id === debuffId);
  if (!status) return false;
  // 阈值表 — 超过即视为"再叠没意义"
  const thresholds: Record<string, number> = {
    poison: 10,      // 10 × 1% maxHP = 每回合 10% maxHP，再叠看起来很蠢
    burn: 10,        // 10 × 2% maxHP = 每回合 20% maxHP
    bleed: 5,        // 5 × 5% 当前HP = 每回合 25% 当前HP（+ 闪避罚 25%）
    weak: 3,         // stacks 只控 duration，3 层足够续命
    vulnerable: 3,
    silenced: 1,     // 标记类：有一层就够
    frozen: 1,
    fear: 1,
  };
  return status.stacks >= (thresholds[debuffId] ?? 10);
}

// 如果 rawIdx 是个饱和 debuff intent，改选同 enemy 其他可用 intent
function redirectIfSaturated(enemy: EnemyState, state: BattleState, rawIdx: number, usedThisTurn: number[]): number {
  if (rawIdx < 0 || rawIdx >= enemy.intents.length) return rawIdx;
  const intent = enemy.intents[rawIdx];
  if (intent.type !== "debuff" || !intent.debuffId) return rawIdx;
  if (!isDebuffSaturated(state, intent.debuffId)) return rawIdx;

  // 在剩余 intent 里找个不饱和的（优先 attack/buff，其次未饱和的 debuff）
  const candidates: number[] = [];
  for (let i = 0; i < enemy.intents.length; i++) {
    if (i === rawIdx || usedThisTurn.includes(i)) continue;
    const it = enemy.intents[i];
    if (it.type !== "debuff" || !it.debuffId || !isDebuffSaturated(state, it.debuffId)) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return rawIdx;  // 全饱和就只能原样叠（保底，不死循环）
  // 优先 attack > buff > 其他
  const attacks = candidates.filter(i => enemy.intents[i].type === "attack");
  if (attacks.length > 0) return attacks[Math.floor(Math.random() * attacks.length)];
  const buffs = candidates.filter(i => enemy.intents[i].type === "buff");
  if (buffs.length > 0) return buffs[Math.floor(Math.random() * buffs.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 执行单个 intent（attack / buff / debuff）— 含多动 log 前缀
// 生成器：每个"逻辑子步"yield 一次，让 UI 在多段攻击间能逐 hit 渲染 + 播放 hit 动画。
// 调用方：enemyTurnSteps 用 yield* 转发；sync runner 用 for 循环耗尽。
function* executeIntent(
  state: BattleState,
  enemy: EnemyState,
  intent: EnemyIntent,
  log: (m: string, k?: LogKind) => void,
  prefix: string,
): Generator<void, void, void> {
  // 沉默时 buff intent 跳过（攻击 / debuff 仍可出）
  if (intent.type === "buff" && enemy.statuses.find(s => s.id === "silenced")) {
    log(`${prefix}${enemy.name} 被沉默，跳过 buff。`, "player");
    return;
  }

  if (intent.type === "attack") {
    let value = intent.value;
    if (enemy.statuses.find(s => s.id === "frozen")) {
      value = Math.floor(value * 0.8);
    }
    if (enemy.statuses.find(s => s.id === "fear")) {
      value = Math.floor(value * 0.5);
    }
    if (enemy.statuses.find(s => s.id === "weak")) {
      value = Math.floor(value * 0.7);
    }
    // 嗜血（HP <50% +30%）
    if (enemy.eliteAbility === "嗜血" && enemy.hp < enemy.maxHp * 0.5) {
      value = Math.round(value * 1.3);
    }
    // buff intent 蓄势：next attack +N
    const atkBuff = enemy.statuses.find(s => s.id === "enemy_atk_buff");
    if (atkBuff) {
      value += atkBuff.stacks;
      enemy.statuses = enemy.statuses.filter(s => s.id !== "enemy_atk_buff");
    }
    // 血祭蓄势：next attack +N%
    const sacBuff = enemy.statuses.find(s => s.id === "enemy_sacrifice");
    if (sacBuff) {
      value = Math.round(value * (1 + sacBuff.stacks / 100));
      enemy.statuses = enemy.statuses.filter(s => s.id !== "enemy_sacrifice");
    }
    // 暴击率：基础 + 致命一击 +30%，cap 50
    const baseCrit = getEnemyCritChance(enemy);
    const fatalBonus = enemy.eliteAbility === "致命一击" ? 30 : 0;
    const critChance = Math.min(50, baseCrit + fatalBonus);
    // hits：intent.hits + buff intent 多段蓄势
    let hits = intent.hits ?? 1;
    const hitsBuff = enemy.statuses.find(s => s.id === "enemy_next_hits");
    if (hitsBuff) {
      hits += hitsBuff.stacks;
      enemy.statuses = enemy.statuses.filter(s => s.id !== "enemy_next_hits");
    }
    log(`${prefix}${enemy.name} ${intent.desc}（${hits > 1 ? `${hits}×` : ""}${value}）。`, "enemy");
    for (let i = 0; i < hits; i++) {
      let hitValue = value;
      if (critChance > 0 && Math.random() * 100 < critChance) {
        const orig = hitValue;
        hitValue = Math.round(hitValue * 1.5);
        log(`★ ${enemy.name} 暴击！${orig} → ${hitValue}（${critChance}%）`, "enemy");
      }
      damagePlayer(state, hitValue, log, enemy);
      // 每 hit 之间 yield —— UI 逐击渲染 / 播 hit 动画 / 飘伤害数字；第一击不 yield（与外层 yield 合并）
      if (i < hits - 1) yield;
      if (state.player.vita <= 0) break;
    }
  } else if (intent.type === "buff") {
    executeBuffIntent(state, enemy, intent, log, prefix);
  } else if (intent.type === "debuff") {
    const id = intent.debuffId ?? "weak";
    const name = intent.debuffName ?? "状态";
    const stacks = intent.value;
    const duration = intent.debuffDuration ?? -1;
    const isDot = id === "poison" || id === "burn" || id === "bleed";
    if (isDot && state.player.statuses.find(s => s.id === "enc_dot_immune")) {
      log(`${prefix}${enemy.name} 试图施加「${name}」，被符文护盾化解。`, "player");
      return;
    }
    const existing = state.player.statuses.find(s => s.id === id);
    if (existing) {
      existing.stacks += stacks;
      if (duration > 0) existing.duration = Math.max(existing.duration, duration);
    } else {
      state.player.statuses.push({ id, name, stacks, duration });
    }
    log(`${prefix}${enemy.name} 施加「${name}」+${stacks}${duration > 0 ? ` (${duration} 回合)` : ""}。`, "enemy");
  }
}

// 执行 buff intent — 按 buffId 分发不同效果
function executeBuffIntent(
  state: BattleState,
  enemy: EnemyState,
  intent: EnemyIntent,
  log: (m: string, k?: LogKind) => void,
  prefix: string,
): void {
  const id = intent.buffId ?? "next_attack_3";
  const value = intent.buffValue ?? 3;
  switch (id) {
    case "next_attack_3": {
      // 下次攻击 +value（status，consumed on next attack）
      const ex = enemy.statuses.find(s => s.id === "enemy_atk_buff");
      if (ex) ex.stacks += value;
      else enemy.statuses.push({ id: "enemy_atk_buff", name: "强化", stacks: value, duration: -1 });
      log(`${prefix}${enemy.name} ${intent.desc}：下次攻击 +${value}。`, "enemy");
      break;
    }
    case "self_armor": {
      // 本回合自身 +armor（duration 2 让它能保护下个玩家回合）
      const ex = enemy.statuses.find(s => s.id === "temp_armor");
      if (ex) { ex.stacks += value; ex.duration = Math.max(ex.duration, 2); }
      else enemy.statuses.push({ id: "temp_armor", name: "临时护甲", stacks: value, duration: 2 });
      log(`${prefix}${enemy.name} ${intent.desc}：临时护甲 +${value}。`, "enemy");
      break;
    }
    case "team_armor": {
      let count = 0;
      for (const e of state.enemies) {
        if (!e.alive) continue;
        const ex = e.statuses.find(s => s.id === "temp_armor");
        if (ex) { ex.stacks += value; ex.duration = Math.max(ex.duration, 2); }
        else e.statuses.push({ id: "temp_armor", name: "临时护甲", stacks: value, duration: 2 });
        count++;
      }
      log(`${prefix}${enemy.name} ${intent.desc}：${count} 个敌人 +${value} 临时护甲。`, "enemy");
      break;
    }
    case "self_heal_pct": {
      const heal = Math.max(1, Math.ceil(enemy.maxHp * value / 100));
      const before = enemy.hp;
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
      const actual = enemy.hp - before;
      log(`${prefix}${enemy.name} ${intent.desc}：回 ${actual} HP（${value}% maxHP）。`, "enemy");
      break;
    }
    case "next_hits": {
      const ex = enemy.statuses.find(s => s.id === "enemy_next_hits");
      if (ex) ex.stacks += value;
      else enemy.statuses.push({ id: "enemy_next_hits", name: "多段蓄势", stacks: value, duration: -1 });
      log(`${prefix}${enemy.name} ${intent.desc}：下张攻击 +${value} hits。`, "enemy");
      break;
    }
    case "self_sacrifice": {
      const cost = Math.max(1, Math.ceil(enemy.maxHp * 0.03));
      enemy.hp = Math.max(1, enemy.hp - cost);
      const ex = enemy.statuses.find(s => s.id === "enemy_sacrifice");
      if (ex) ex.stacks = Math.max(ex.stacks, value);
      else enemy.statuses.push({ id: "enemy_sacrifice", name: "血祭蓄势", stacks: value, duration: -1 });
      log(`${prefix}${enemy.name} ${intent.desc}：自损 ${cost} HP，下张攻击 +${value}%。`, "enemy");
      break;
    }
    case "double_debuffs": {
      // F12 限定：玩家身上所有 debuff stacks ×2
      const debuffIds = new Set(["poison", "burn", "bleed", "weak", "vulnerable"]);
      let doubled = 0;
      for (const s of state.player.statuses) {
        if (debuffIds.has(s.id)) {
          s.stacks *= 2;
          doubled++;
        }
      }
      if (doubled > 0) {
        log(`★ ${prefix}${enemy.name} 终末降临！${doubled} 个 debuff stack 翻倍！`, "enemy");
      } else {
        log(`${prefix}${enemy.name} 终末降临，但你身上没有 debuff，效果落空。`, "system");
      }
      break;
    }
  }
}

// 敌人回合（生成器版本）— 每次 yield 表示一个"逻辑步"
// 步划分：
//   1. 每个敌人 DoT 结算后 yield 一次（让玩家看到 DoT 伤害）
//   2. 每次 executeIntent 后 yield 一次（看清多动每一击）
// UI 调用 endPlayerTurnAnimated 在每个 yield 之间 render + sleep；
// 简单 sync 调用走 enemyTurn() 一次跑完（用于 simulator 等无 UI 场景）
function* enemyTurnSteps(state: BattleState, log: (m: string, k?: LogKind) => void): Generator<void, void, void> {
  log("── 敌人回合 ──", "enemy");
  const skipActions = !!state.player.statuses.find(s => s.id === "time_stop");
  if (skipActions) log("时停：敌人无法行动！", "player");

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    // DoT 结算（time_stop 也走）
    let didDot = false;
    const poison = enemy.statuses.find(s => s.id === "poison");
    if (poison && poison.stacks > 0) {
      const dmg = Math.max(1, Math.ceil(enemy.maxHp * 0.01 * poison.stacks));
      damageEnemy(enemy, dmg, log, `${enemy.name} 中毒 -${dmg}（${poison.stacks}× 1% maxHP）。`);
      poison.stacks--;
      if (poison.stacks <= 0) enemy.statuses = enemy.statuses.filter(s => s.id !== "poison");
      didDot = true;
    }
    const burn = enemy.statuses.find(s => s.id === "burn");
    if (burn && burn.stacks > 0 && burn.duration > 0) {
      const dmg = Math.max(1, Math.ceil(enemy.maxHp * 0.02 * burn.stacks));
      damageEnemy(enemy, dmg, log, `${enemy.name} 燃烧 -${dmg}（${burn.stacks}× 2% maxHP）。`);
      didDot = true;
    }
    const bleed = enemy.statuses.find(s => s.id === "bleed");
    if (bleed && bleed.stacks > 0 && bleed.duration > 0 && enemy.alive) {
      const dmg = Math.max(1, Math.floor(enemy.hp * 0.05 * bleed.stacks));
      damageEnemy(enemy, dmg, log, `${enemy.name} 出血 -${dmg}。`);
      didDot = true;
    }
    // 有 DoT 才插一个 step（让玩家先看到 DoT 伤害再看招式）
    if (didDot) yield;

    if (!enemy.alive) continue;
    if (skipActions) continue;

    let maxActions = enemy.actionsPerTurn ?? 1;
    if (enemy.statuses.find(s => s.id === "frozen") || enemy.statuses.find(s => s.id === "fear")) {
      maxActions = Math.min(1, maxActions);
    }

    const usedIndices: number[] = [];
    for (let actionNum = 1; actionNum <= maxActions; actionNum++) {
      if (!enemy.alive) break;

      const intentIdx = chooseEnemyIntentIdx(enemy, state, usedIndices);
      usedIndices.push(intentIdx);
      enemy.intentIndex = intentIdx;
      const intent = enemy.intents[intentIdx];
      const seen = (enemy as any)._seenIntents as number[] ?? [];
      if (!seen.includes(intentIdx)) {
        seen.push(intentIdx);
        (enemy as any)._seenIntents = seen;
      }

      const prefix = maxActions > 1 ? `[${actionNum}/${maxActions}] ` : "";
      yield* executeIntent(state, enemy, intent, log, prefix);

      yield;  // ★ 每次行动结束后 yield —— intent 内部的多段攻击会在更早处 yield 拆分
      if (state.player.vita <= 0) break;
    }
  }

  // ec_phalanx：本回合未受伤 → 下回合开局护盾 +K
  if (state.player.weaponEnchant === "ec_phalanx" && !state.player.statuses.find(s => s.id === "took_damage_turn")) {
    const shieldGain = getEnchantParam(state.player, 2);
    const sh = state.player.statuses.find(s => s.id === "shield_block");
    if (sh) sh.stacks += shieldGain;
    else state.player.statuses.push({ id: "shield_block", name: "护盾", stacks: shieldGain, duration: -1 });
    log(`重甲列阵：本回合未受伤，下回合开局护盾 +${shieldGain}。`, "player");
  }
  state.player.statuses = state.player.statuses.filter(s => s.id !== "took_damage_turn");

  // 状态衰减
  for (const enemy of state.enemies) {
    enemy.statuses = enemy.statuses
      .map(s => s.duration > 0 ? { ...s, duration: s.duration - 1 } : s)
      .filter(s => {
        if (s.id === "attuned" && s.duration === 0 && enemy.originalSuit !== undefined) {
          enemy.suit = enemy.originalSuit;
          enemy.originalSuit = undefined;
          log(`${enemy.name} 共鸣消散，花色恢复为 ${SUIT_SYMBOLS[enemy.suit]}。`, "system");
        }
        return s.duration !== 0;
      });
  }
  state.player.statuses = state.player.statuses
    .map(s => s.duration > 0 ? { ...s, duration: s.duration - 1 } : s)
    .filter(s => s.duration !== 0);
}

// 同步运行 enemyTurnSteps（一次性跑完所有 yield）— 用于无 UI 场景（simulator 等）
function enemyTurn(state: BattleState, log: (m: string, k?: LogKind) => void) {
  const gen = enemyTurnSteps(state, log);
  while (!gen.next().done) {}
}

// ─────────────────────────────────────────────────────────
// 结束玩家回合
// ─────────────────────────────────────────────────────────

export function endPlayerTurn(state: BattleState, log: (m: string, k?: LogKind) => void) {
  if (state.phase !== "playerTurn") return;
  enemyTurn(state, log);
  startNewPlayerTurn(state, log);
}

// UI 动画版本：每个敌人 step 后调 onStep（render + sleep），让玩家看清多动每一击
export async function endPlayerTurnAnimated(
  state: BattleState,
  log: (m: string, k?: LogKind) => void,
  onStep: () => Promise<void>,
): Promise<void> {
  if (state.phase !== "playerTurn") return;
  const gen = enemyTurnSteps(state, log);
  let res = gen.next();
  while (!res.done) {
    await onStep();
    res = gen.next();
  }
  startNewPlayerTurn(state, log);
}

// 敌人回合结束 → 玩家新回合开始的所有副作用（共享给 sync + async 两种调用）
function startNewPlayerTurn(state: BattleState, log: (m: string, k?: LogKind) => void): void {
  if (checkBattleEnd(state, log)) return;

  // 新回合
  state.turn++;
  state.player.turnsElapsed++;

  // 连弩连击追踪：本回合出了攻击则 streak+1，否则归零；达到 2 后本回合开始前弃置
  if (state.player.weapons[0]?.defId === "repeating_bow") {
    if (state.attackedThisTurn) {
      state.bowAttackStreak = (state.bowAttackStreak ?? 0) + 1;
    } else {
      state.bowAttackStreak = 0;
    }
    if ((state.bowAttackStreak ?? 0) >= 2) {
      const discarded = state.player.weapons.splice(0);
      state.player.discard.push(...discarded);
      state.bowAttackStreak = 0;
      log("连弩：连续 2 回合攻击，已自动弃置！", "system");
    }
  } else {
    state.bowAttackStreak = 0;
  }

  state.attackedThisTurn = false;
  log(`── 回合 ${state.turn}（你的回合）──`, "system");

  // ♥ T1 生机涌动：每回合开始 +5 HP
  if (getActiveSpecialty(state) === "heart" && suitTier(state, "heart") >= 1
      && state.player.vita < state.player.vitaMax) {
    const heal = Math.min(5, state.player.vitaMax - state.player.vita);
    state.player.vita += heal;
    log(`♥ 生机涌动：+${heal} HP。`, "player");
  }

  // 守护契附魔：每回合开始 +N HP（N = idx 2；Lv1-5: 1/1/1/2/2）
  if (state.player.weaponEnchant === "ec_resilient" && state.player.vita < state.player.vitaMax) {
    const heal = getEnchantParam(state.player, 2);
    state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
    log(`守护契：+${heal} HP。`, "player");
  }

  // 生命囊（♥ super_rare 防具）：每回合 +3% maxHP × stack（XLSX v6 改 % maxHP）
  if (state.player.armors[0]?.defId === "life_pouch" && state.player.vita < state.player.vitaMax) {
    const stack = Math.min(state.player.armors.length, 4);
    const heal = Math.max(1, Math.ceil(state.player.vitaMax * 0.03 * stack));
    const before = state.player.vita;
    state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
    if (state.player.vita > before) log(`♥ 生命囊：+${state.player.vita - before} HP（${stack * 3}% maxHP）。`, "player");
  }

  // 吸血盾（♥ rare+ 防具）：上回合累积的 draining_charge 在本回合开始全部回血
  const drainCharge = state.player.statuses.find(s => s.id === "draining_charge");
  if (drainCharge && drainCharge.stacks > 0 && state.player.vita < state.player.vitaMax) {
    const heal = drainCharge.stacks;
    const before = state.player.vita;
    state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
    if (state.player.vita > before) log(`吸血盾：延迟回血 +${state.player.vita - before} HP。`, "player");
    state.player.statuses = state.player.statuses.filter(s => s.id !== "draining_charge");
  }

  // 反伤甲：清掉 thorn_chain 连击计数（每回合从 1 开始算）
  state.player.statuses = state.player.statuses.filter(s => s.id !== "thorn_chain");

  // ♣ 镇守 keyword 衰减：每回合 -1 层 shield_block（仅在 ♣ T1+ 激活时；duration:-1 的持续护盾）
  if (getActiveSpecialty(state) === "club" && suitTier(state, "club") >= 1) {
    const sh = state.player.statuses.find(s => s.id === "shield_block");
    if (sh && sh.duration === -1) {
      sh.stacks -= 1;
      if (sh.stacks <= 0) {
        state.player.statuses = state.player.statuses.filter(s => s.id !== "shield_block");
        log(`♣ 镇守：护盾衰减至 0，移除。`, "system");
      } else {
        log(`♣ 镇守：护盾衰减 -1（剩 ${sh.stacks}）。`, "system");
      }
    }
  }

  // 重甲（♣ rare 防具）：每回合 30% 概率随机去 1 debuff
  if (state.player.armors[0]?.defId === "heavy_armor" && Math.random() < 0.30) {
    const debuffIds = ["poison", "burn", "bleed", "weak", "vulnerable", "silenced", "fear", "frozen"];
    for (const id of debuffIds) {
      const idx = state.player.statuses.findIndex(s => s.id === id);
      if (idx >= 0) {
        const removed = state.player.statuses[idx];
        state.player.statuses.splice(idx, 1);
        log(`重甲：清除「${removed.name}」（30% 触发）。`, "player");
        break;
      }
    }
  }

  // 战狂血誓：每损 10% maxHP +M 永久攻击（cap +K）
  // Lv1-5: M = 1/1/1/1/2, K = 3/3/4/5/5（idx 1 = M, idx 2 = K）
  if (state.player.weaponEnchant === "ec_warblood") {
    const perStep = getEnchantParam(state.player, 1);
    const cap = getEnchantParam(state.player, 2);
    const lossPct = 1 - (state.player.vita / Math.max(1, state.player.vitaMax));
    const targetStacks = Math.min(cap, Math.floor(lossPct * 10) * perStep);
    const ex = state.player.statuses.find(s => s.id === "warblood_perm_atk");
    if (targetStacks > 0) {
      if (ex) {
        if (ex.stacks < targetStacks) {
          const gained = targetStacks - ex.stacks;
          ex.stacks = targetStacks;
          log(`战狂血誓：永久攻击 +${gained}（共 +${targetStacks}）。`, "player");
        }
      } else {
        state.player.statuses.push({ id: "warblood_perm_atk", name: "血誓积累", stacks: targetStacks, duration: -1 });
        log(`战狂血誓：永久攻击 +${targetStacks}。`, "player");
      }
    }
  }

  // 玩家 DOT 结算（中毒 / 燃烧 / 出血 — 每回合开始受伤）
  // 中毒：扣 stacks，stacks-1；副作用：玩家暴击率 -stacks × 3%（cap -30%）
  // 药剂回血（本场战斗每回合开始 +2 HP，duration -1 永久）
  const brew = state.player.statuses.find(s => s.id === "brew_regen");
  if (brew && state.player.vita < state.player.vitaMax) {
    const heal = brew.stacks;
    state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
    log(`药剂：+${heal} HP。`, "player");
  }

  // 玩家中毒：每回合扣 maxVita × 1% × stacks
  const playerPoison = state.player.statuses.find(s => s.id === "poison");
  if (playerPoison && playerPoison.stacks > 0) {
    const dmg = Math.max(1, Math.ceil(state.player.vitaMax * 0.01 * playerPoison.stacks));
    state.player.vita = Math.max(0, state.player.vita - dmg);
    log(`你中毒 -${dmg} HP（${playerPoison.stacks}× 1% maxHP；暴击 -${Math.min(50, playerPoison.stacks * 5)}%）。`, "enemy");
    playerPoison.stacks--;
    if (playerPoison.stacks <= 0) state.player.statuses = state.player.statuses.filter(s => s.id !== "poison");
  }
  // 玩家燃烧：每回合扣 maxVita × 2% × stacks
  const playerBurn = state.player.statuses.find(s => s.id === "burn");
  if (playerBurn && playerBurn.stacks > 0 && playerBurn.duration !== 0) {
    const dmg = Math.max(1, Math.ceil(state.player.vitaMax * 0.02 * playerBurn.stacks));
    state.player.vita = Math.max(0, state.player.vita - dmg);
    log(`你燃烧 -${dmg} HP（${playerBurn.stacks}× 2% maxHP）。`, "enemy");
  }
  // 出血：扣 当前HP × 5% × stacks，duration-1；副作用：玩家闪避率 -stacks × 5%
  const playerBleed = state.player.statuses.find(s => s.id === "bleed");
  if (playerBleed && playerBleed.stacks > 0 && playerBleed.duration !== 0) {
    const dmg = Math.max(1, Math.floor(state.player.vita * 0.05 * playerBleed.stacks));
    state.player.vita = Math.max(0, state.player.vita - dmg);
    log(`你出血 -${dmg} HP（闪避 -${Math.min(50, playerBleed.stacks * 5)}%）。`, "enemy");
  }
  if (state.player.vita <= 0) { state.phase = "lost"; log("✗ HP 耗尽。", "lose"); return; }

  // onTurnStart：防具 + 特性。共享 ctx 用于收集 _drawN
  const turnStartCtx = getCtx(state, log);
  if (state.player.armors.length > 0) {
    const aDef = CARD_DB[state.player.armors[0].defId];
    const aEff = aDef.equipEffects![Math.min(state.player.armors.length, 4) - 1];
    if (aEff.onTurnStart) aEff.onTurnStart(turnStartCtx);
  }
  const seen = new Set<string>();
  for (const inst of state.player.perks) {
    if (seen.has(inst.defId)) continue;
    seen.add(inst.defId);
    const pDef = CARD_DB[inst.defId];
    const cnt = state.player.perks.filter(p => p.defId === inst.defId).length;
    const eff = pDef.perkEffect;
    if (eff?.onTurnStart) eff.onTurnStart(turnStartCtx, cnt);
  }

  // 过载特性等通过 ctx._drawN 累加额外摸牌数
  const extraDraw = (turnStartCtx as any)._drawN ?? 0;
  drawCards(state.player, DRAW_PER_TURN + extraDraw, log);
  if (extraDraw > 0) log(`过载：额外摸 ${extraDraw} 张。`, "player");
  checkBattleEnd(state, log);
}

// 精英怪击杀掉落 SR 卡池：从奖励池里筛 rarity === "super_rare"
function getEliteSRDropPool(floor: number): string[] {
  const aoeUnlocked = floor >= 3;
  const base = aoeUnlocked
    ? [...REWARD_CARD_POOL_BASE, ...REWARD_CARD_POOL_AOE]
    : REWARD_CARD_POOL_BASE;
  return base.filter(id => CARD_DB[id]?.rarity === "super_rare");
}

// 扫描所有死亡但未掉过碎片的敌人，给玩家加对应种族碎片 + 触发附魔 onKill
// 精英怪额外掉落 1 张随机 SR 卡（进牌库 + 洗牌）
function awardFragments(state: BattleState, log: (m: string, k?: LogKind) => void) {
  for (const e of state.enemies) {
    if (!e.alive && !(e as any)._fragmentAwarded) {
      (e as any)._fragmentAwarded = true;
      const race = e.race;
      if (race && state.player.fragments) {
        state.player.fragments[race] = (state.player.fragments[race] ?? 0) + 1;
        log(`掉落：${race} 灵魂碎片 +1。`, "win");
      }
      // 附魔 onKill 触发
      if (state.player.weaponEnchant) {
        const enchant = ENCHANT_EFFECTS[state.player.weaponEnchant];
        if (enchant?.onKill) {
          const ctx = getCtx(state, log);
          enchant.onKill(ctx, e);
        }
      }
      // 精英额外掉落：随机一张 SR 卡，进入牌库（不含 Boss，Boss 走 epic 保底）
      if (e.tier === "elite") {
        const srPool = getEliteSRDropPool(state.floor);
        if (srPool.length > 0) {
          const pickedId = srPool[Math.floor(Math.random() * srPool.length)];
          const inst = makeInstance(pickedId, undefined, state.floor);
          state.player.deck.push(inst);
          shuffleArr(state.player.deck);
          const name = CARD_DB[pickedId]?.name ?? pickedId;
          log(`★ 精英掉落：${name}（SR）进入牌库。`, "win");
        }
      }
    }
  }
}

function checkBattleEnd(state: BattleState, log: (m: string, k?: LogKind) => void): boolean {
  awardFragments(state, log);
  if (state.player.vita <= 0) {
    state.phase = "lost";
    log("✗ HP 耗尽，战斗失败。", "lose");
    return true;
  }
  if (state.enemies.every(e => !e.alive)) {
    state.phase = "won";
    log("★ 战斗胜利！", "win");
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────
// 选目标
// ─────────────────────────────────────────────────────────
export function selectTarget(state: BattleState, idx: number) {
  if (state.enemies[idx]?.alive) state.targetIndex = idx;
}

