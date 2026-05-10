// 战斗系统 v0.8 (deck-builder)
// - 摸牌 / 出牌 / 弃牌
// - 攻击伤害公式：武器基础 × 叠加倍率 × 花色相性 × 临时buff × 特性钩子 × 楼层倍率
// - 多敌人支持（targetIndex 选择目标）

import type {
  BattleState,
  BattleContext,
  PlayerState,
  EnemyState,
  CardInstance,
  CardDef,
  LogKind,
  Suit,
} from "./types.ts";
import { HAND_LIMIT, DRAW_PER_TURN, SUIT_SYMBOLS, SUITS } from "./types.ts";
import { CARD_DB, suitMultiplier, damageEnemy, ENCHANT_EFFECTS } from "./cards.ts";

// 检查玩家是否有染色 buff，返回强制使用的花色（覆盖攻击牌原本花色）
function getDyedSuit(player: PlayerState): Suit | null {
  for (const suit of SUITS) {
    if (player.statuses.some(s => s.id === `dyed_${suit}`)) return suit;
  }
  return null;
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
    if (player.hand.length >= HAND_LIMIT) {
      const c = player.deck.pop()!;
      player.discard.push(c);
      log(`手牌已满，${CARD_DB[c.defId].name} 进入弃牌堆。`, "system");
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

export function newBattle(player: PlayerState, enemies: EnemyState[]): BattleState {
  player.statuses = [];
  player.turnsElapsed = 0;
  // 把上一场残留的手牌/弃牌全部塞回牌库，重新洗
  player.deck = [...player.deck, ...player.hand, ...player.discard];
  player.hand = [];
  player.discard = [];
  shuffleArr(player.deck);
  return {
    phase: "playerTurn",
    turn: 1,
    player,
    enemies,
    targetIndex: enemies.findIndex(e => e.alive),
    attackedThisTurn: false,
    bowAttackStreak: 0,
  };
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
    const bonus = frenzy.stacks * 5;
    dmg += bonus;
    log(`激奋 +${bonus}（×${frenzy.stacks}）。`, "player");
  }
  // 蓄力：×3，用一次清除
  const charged = player.statuses.find(s => s.id === "charged");
  if (charged) {
    dmg = dmg * 3;
    log("蓄力 ×3！", "player");
    player.statuses = player.statuses.filter(s => s.id !== "charged");
  }
  // 玩家被虚弱：攻击伤害减少 stacks
  const weak = player.statuses.find(s => s.id === "weak");
  if (weak) {
    dmg = Math.max(0, dmg - weak.stacks);
    log(`虚弱 -${weak.stacks}。`, "enemy");
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

  // rend：永久增加目标受到的伤害
  const rend = ctx.target.statuses.find(s => s.id === "rend");
  if (rend) dmg += rend.stacks;

  // 敌人易伤：受击 ×1.5
  if (ctx.target.statuses.find(s => s.id === "vulnerable")) {
    dmg = dmg * 1.5;
    log(`${ctx.target.name} 易伤 ×1.5。`, "player");
  }

  // 楼层倍率（武器 instance）
  dmg *= player.weapons[0].scale ?? 1.0;

  // 法师杖（武器特性）+ 预谋附魔（calc_charge 累积器）统一计算
  // 每出 1 张非攻击牌累积 1 stack，攻击时按 stacks × multiplier 加伤
  const charge = player.statuses.find(s => s.id === "calc_charge");
  if (charge && charge.stacks > 0) {
    let mul = 0;
    if (player.weapons[0]?.defId === "wizard_staff") mul += 3;
    if (player.weaponEnchant === "calculated") mul += 3;
    if (mul > 0) {
      const bonus = charge.stacks * mul;
      dmg += bonus;
      log(`预谋累积 +${bonus}（${charge.stacks} 张非攻击牌 × ${mul}）。`, "player");
    }
    player.statuses = player.statuses.filter(s => s.id !== "calc_charge");
  }

  // 武器附魔 onAttack（其他附魔效果）
  let bypassArmor = false;
  if (player.weaponEnchant) {
    const enchant = ENCHANT_EFFECTS[player.weaponEnchant];
    if (enchant?.onAttack) dmg = enchant.onAttack(ctx, dmg);
    if (enchant?.bypassArmor?.(ctx, dmg)) bypassArmor = true;
  }

  // 敌人 armor 减伤（受 pierce 影响；夺命斩杀绕过）
  if (!bypassArmor) {
    const enemyArmor = ctx.target.armor ?? 0;
    if (enemyArmor > 0) {
      const pierce = wDef.pierce ?? 0;
      const effective = Math.max(0, enemyArmor - pierce);
      if (pierce > 0 && enemyArmor > 0) {
        log(`长剑破甲 ${Math.min(pierce, enemyArmor)}：${ctx.target.name} 实际减伤 ${effective}。`, "player");
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

  // 武器 hits（双刀 hits=2）+ 影袭额外 +1 hit
  const weaponDef = state.player.weapons[0] ? CARD_DB[state.player.weapons[0].defId] : null;
  const weaponHits = weaponDef?.hits ?? 1;
  const shadow = state.player.statuses.find(s => s.id === "shadow_double");
  const shadowBonus = shadow ? 1 : 0;
  if (shadow) {
    log("影袭：本次攻击 +1 hit。", "player");
    state.player.statuses = state.player.statuses.filter(s => s.id !== "shadow_double");
  }
  const hits = weaponHits + shadowBonus;
  if (weaponHits > 1) log(`${weaponDef?.name} hits ×${weaponHits}。`, "player");

  const weaponId = state.player.weapons[0]?.defId;
  for (let i = 0; i < hits; i++) {
    if (!target.alive) break;
    const dmg = calcAttackDamage(state, def.attackSuit!, log);
    log(`▶ 攻击 ${SUIT_SYMBOLS[def.attackSuit!]} → ${target.name} -${dmg}。`, "player");
    target.hp = Math.max(0, target.hp - dmg);
    if (target.hp <= 0) {
      target.alive = false;
      log(`★ 击败 ${target.name}！`, "win");
    }

    // 法杖：每次攻击给目标 +1 易伤（×1.5 受伤）持续 2 回合
    if (weaponId === "battle_staff" && target.alive) {
      const v = target.statuses.find(s => s.id === "vulnerable");
      if (v) v.duration = Math.max(v.duration, 2);
      else target.statuses.push({ id: "vulnerable", name: "易伤", stacks: 1, duration: 2 });
      log(`法杖：${target.name} +易伤（×1.5）。`, "player");
    }

    // 链刃：对其他存活敌人溅射 2 伤
    if (weaponId === "chain_whip") {
      for (const e of state.enemies) {
        if (!e.alive || e === target) continue;
        e.hp = Math.max(0, e.hp - 2);
        log(`链刃溅射：${e.name} -2。`, "player");
        if (e.hp <= 0) { e.alive = false; log(`★ 击败 ${e.name}！`, "win"); }
      }
    }
  }

  // 卡进弃牌堆
  state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
  state.player.discard.push(card);

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
  if (def.target === "all" && state.player.weapons.length > 0) {
    const sc = state.player.weapons.length;
    ctx.slotScale = [1.0, 1.4, 1.8, 2.2][Math.min(sc, 4) - 1] * (state.player.weapons[0].scale ?? 1.0);
  }
  if (def.onPlay) def.onPlay(ctx);

  // 花色手选（染色术 / 共鸣咒）——暂停到玩家选完花色再继续
  const suitPick = (ctx as any)._suitPick as string | undefined;
  if (suitPick) {
    state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
    state.player.discard.push(card);
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

  // 处理特殊指令（聚气摸 N）
  const drawN = (ctx as any)._drawN;
  if (drawN) drawCards(state.player, drawN, log);

  // 重整：弃所有手牌（不含当前），重摸 N
  const regroupN = (ctx as any)._regroup;
  if (regroupN) {
    // 暂时把当前卡从手牌取出，弃其他，再补摸
    state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
    state.player.discard.push(...state.player.hand);
    state.player.hand = [];
    state.player.discard.push(card);
    drawCards(state.player, regroupN, log);
    checkBattleEnd(state, log);
    return true;
  }

  state.player.hand = state.player.hand.filter(c => c.uid !== card.uid);
  state.player.discard.push(card);

  // 法袍：出技能/道具时摸 1 张
  if (state.player.armors[0]?.defId === "mage_robe") {
    drawCards(state.player, 1, log);
    log("法袍：摸 1 张。", "player");
  }

  // 战斗节奏：本回合内每出 1 张牌额外摸 1 张
  if (state.player.statuses.find(s => s.id === "combat_rhythm")) {
    drawCards(state.player, 1, log);
    log("战斗节奏：摸 1 张。", "player");
  }

  // 复读机：本场战斗每出非攻击牌后，复制 1 份到手牌（不复制复读机自己，避免无限链）
  if (state.player.statuses.find(s => s.id === "echo") && card.defId !== "it_echo") {
    if (state.player.hand.length < 10) {
      const clone = { ...card, uid: `${card.uid}_echo_${Math.random().toString(36).slice(2, 6)}` };
      state.player.hand.push(clone);
      log(`复读机：复制了一份 ${CARD_DB[card.defId].name} 回手牌。`, "player");
    }
  }

  // 法师杖 / 预谋附魔：每出非攻击牌累积 +3 伤
  accumulateCalcCharge(state, log);

  checkBattleEnd(state, log);
  return true;
}

// 累积"非攻击牌已出张数"——为法师杖（武器特性）和预谋附魔提供 buff stacks
function accumulateCalcCharge(state: BattleState, _log: (m: string, k?: LogKind) => void) {
  const hasWizardStaff = state.player.weapons[0]?.defId === "wizard_staff";
  const hasCalculated = state.player.weaponEnchant === "calculated";
  if (!hasWizardStaff && !hasCalculated) return;
  const existing = state.player.statuses.find(s => s.id === "calc_charge");
  if (existing) existing.stacks += 1;
  else state.player.statuses.push({ id: "calc_charge", name: "预谋累积", stacks: 1, duration: -1 });
}

function playEquipment(state: BattleState, card: CardInstance, def: CardDef, log: (m: string, k?: LogKind) => void): boolean {
  const player = state.player;
  if (def.equipKind === "weapon") {
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

function damagePlayer(state: BattleState, base: number, log: (m: string, k?: LogKind) => void, attackerEnemy?: EnemyState) {
  let dmg = base;
  const ctx = getCtx(state, log);

  // 易伤：受到伤害 ×1.5
  if (state.player.statuses.find(s => s.id === "vulnerable")) {
    dmg = Math.floor(dmg * 1.5);
    log("易伤：伤害 ×1.5。", "enemy");
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

  // 闪避姿态
  if (state.player.statuses.find(s => s.id === "evasive")) {
    dmg = Math.floor(dmg * 0.5);
    log("闪避姿态：伤害减半。", "player");
  }

  // 护盾吸收
  const shield = state.player.statuses.find(s => s.id === "shield_block");
  if (shield && dmg > 0) {
    const absorbed = Math.min(shield.stacks, dmg);
    dmg -= absorbed;
    shield.stacks -= absorbed;
    log(`护盾吸收 ${absorbed}。`, "player");
    if (shield.stacks <= 0) state.player.statuses = state.player.statuses.filter(s => s.id !== "shield_block");
  }

  dmg = Math.max(0, Math.floor(dmg));
  if (dmg > 0) {
    state.player.vita -= dmg;
    log(`你受到 ${dmg} 点伤害。`, "enemy");

    // 不灭之心：HP 即将归 0 时复活，整局仅 1 次（用 player.revivesUsed 持久化）
    // 叠加层数决定复活后的 HP 比例：×1=50%, ×2=65%, ×3=80%, ×4=100%
    if (state.player.vita <= 0
        && state.player.armors[0]?.defId === "undying_heart"
        && (state.player.revivesUsed ?? 0) < 1) {
      const stacks = Math.min(state.player.armors.length, 4);
      const ratio = [0.50, 0.65, 0.80, 1.00][stacks - 1];
      state.player.vita = Math.round(state.player.vitaMax * ratio);
      state.player.revivesUsed = (state.player.revivesUsed ?? 0) + 1;
      log(`★ 不灭之心：整局唯一一次复活，恢复到 ${state.player.vita} HP（${Math.round(ratio * 100)}%）。`, "win");
    }

    // 反击姿态：反弹 50%
    if (state.player.statuses.find(s => s.id === "counter_stance") && attackerEnemy?.alive) {
      const reflect = Math.floor(dmg * 0.5);
      if (reflect > 0) {
        attackerEnemy.hp = Math.max(0, attackerEnemy.hp - reflect);
        log(`反击姿态：${attackerEnemy.name} -${reflect}。`, "player");
        if (attackerEnemy.hp <= 0) { attackerEnemy.alive = false; log(`★ 击败 ${attackerEnemy.name}！`, "win"); }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────
// 敌人回合
// ─────────────────────────────────────────────────────────

function enemyTurn(state: BattleState, log: (m: string, k?: LogKind) => void) {
  log("── 敌人回合 ──", "enemy");
  const skipActions = !!state.player.statuses.find(s => s.id === "time_stop");
  if (skipActions) log("时停：敌人无法行动！", "player");

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    // DoT 结算（time_stop 也走，因为是定时伤害）
    // 敌方中毒
    const poison = enemy.statuses.find(s => s.id === "poison");
    if (poison && poison.stacks > 0) {
      const dmg = poison.stacks;
      damageEnemy(enemy, dmg, log, `${enemy.name} 中毒 -${dmg}。`);
      poison.stacks--;
      if (poison.stacks <= 0) enemy.statuses = enemy.statuses.filter(s => s.id !== "poison");
    }
    // 敌方燃烧
    const burn = enemy.statuses.find(s => s.id === "burn");
    if (burn && burn.stacks > 0 && burn.duration > 0) {
      damageEnemy(enemy, burn.stacks, log, `${enemy.name} 燃烧 -${burn.stacks}。`);
    }
    // 敌方出血（按当前 HP 百分比）
    const bleed = enemy.statuses.find(s => s.id === "bleed");
    if (bleed && bleed.stacks > 0 && bleed.duration > 0 && enemy.alive) {
      const dmg = Math.max(1, Math.floor(enemy.hp * 0.05 * bleed.stacks));
      damageEnemy(enemy, dmg, log, `${enemy.name} 出血 -${dmg}。`);
    }

    if (!enemy.alive) continue;

    // intent 行动（time_stop 跳过）
    if (skipActions) continue;

    const intent = enemy.intents[enemy.intentIndex];
    // Boss 招式：随机抽下一招（避免立即重复）；其他档：顺序循环
    if (enemy.tier === "boss" && enemy.intents.length > 1) {
      let next: number;
      do {
        next = Math.floor(Math.random() * enemy.intents.length);
      } while (next === enemy.intentIndex);
      enemy.intentIndex = next;
    } else {
      enemy.intentIndex = (enemy.intentIndex + 1) % enemy.intents.length;
    }

    if (intent.type === "buff" && enemy.statuses.find(s => s.id === "silenced")) {
      log(`${enemy.name} 被沉默，跳过。`, "player");
      continue;
    }

    if (intent.type === "attack") {
      let value = intent.value;
      if (enemy.statuses.find(s => s.id === "frozen")) {
        value = Math.floor(value * 0.5);
        log(`${enemy.name} 被冰冻，伤害减半。`, "player");
      }
      // 敌人虚弱：攻击 -stacks
      const eWeak = enemy.statuses.find(s => s.id === "weak");
      if (eWeak) {
        value = Math.max(0, value - eWeak.stacks);
        log(`${enemy.name} 虚弱 -${eWeak.stacks}。`, "player");
      }
      // 特能修饰：嗜血（HP <50% 攻击 +30%）
      if (enemy.eliteAbility === "嗜血" && enemy.hp < enemy.maxHp * 0.5) {
        const orig = value;
        value = Math.round(value * 1.3);
        log(`${enemy.name} 嗜血发动：${orig} → ${value}。`, "enemy");
      }
      // 特能修饰：致命一击（30% 暴击 ×1.5）
      if (enemy.eliteAbility === "致命一击" && Math.random() < 0.3) {
        const orig = value;
        value = Math.round(value * 1.5);
        log(`${enemy.name} 致命一击！${orig} → ${value}。`, "enemy");
      }
      const hits = intent.hits ?? 1;
      for (let i = 0; i < hits; i++) {
        damagePlayer(state, value, log, enemy);
        if (state.player.vita <= 0) break;
      }
    } else if (intent.type === "buff") {
      const next = enemy.intents[enemy.intentIndex];
      next.value += 3;
      next.desc = next.desc + "(强化)";
      log(`${enemy.name} 咆哮：下次攻击 +3。`, "enemy");
    } else if (intent.type === "debuff") {
      // 给玩家上 debuff
      const id = intent.debuffId ?? "weak";
      const name = intent.debuffName ?? "状态";
      const stacks = intent.value;
      const duration = intent.debuffDuration ?? -1;
      const existing = state.player.statuses.find(s => s.id === id);
      if (existing) {
        existing.stacks += stacks;
        if (duration > 0) existing.duration = Math.max(existing.duration, duration);
      } else {
        state.player.statuses.push({ id, name, stacks, duration });
      }
      log(`${enemy.name} 施加「${name}」+${stacks}${duration > 0 ? ` (${duration} 回合)` : ""}。`, "enemy");
    }

    if (state.player.vita <= 0) break;
  }

  // 状态衰减
  for (const enemy of state.enemies) {
    enemy.statuses = enemy.statuses
      .map(s => s.duration > 0 ? { ...s, duration: s.duration - 1 } : s)
      .filter(s => s.duration !== 0);
  }
  state.player.statuses = state.player.statuses
    .map(s => s.duration > 0 ? { ...s, duration: s.duration - 1 } : s)
    .filter(s => s.duration !== 0);
}

// ─────────────────────────────────────────────────────────
// 结束玩家回合
// ─────────────────────────────────────────────────────────

export function endPlayerTurn(state: BattleState, log: (m: string, k?: LogKind) => void) {
  if (state.phase !== "playerTurn") return;

  enemyTurn(state, log);
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

  // 玩家中毒结算（每回合开始受 stacks 伤，stacks - 1）
  const playerPoison = state.player.statuses.find(s => s.id === "poison");
  if (playerPoison && playerPoison.stacks > 0) {
    state.player.vita = Math.max(0, state.player.vita - playerPoison.stacks);
    log(`你中毒 -${playerPoison.stacks} HP。`, "enemy");
    playerPoison.stacks--;
    if (playerPoison.stacks <= 0) state.player.statuses = state.player.statuses.filter(s => s.id !== "poison");
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

// 扫描所有死亡但未掉过碎片的敌人，给玩家加对应种族碎片 + 触发附魔 onKill
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

