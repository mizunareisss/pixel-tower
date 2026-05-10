// 像素塔 v0.8 卡库（deck-builder 重构）
// - 8 攻击牌（4 花色 × 2）
// - 4 武器 / 4 防具（手牌中的装备牌，出牌后进常驻区）
// - 12 技能 / 6 道具
// - 9 特性

import type {
  CardDef,
  CardInstance,
  BattleContext,
  Suit,
  StatusEffect,
  EnemyState,
  LogKind,
  EnchantId,
  CardRarity,
  EquipEffect,
} from "./types.ts";
import { SUIT_SYMBOLS, SUITS, isRedSuit } from "./types.ts";

// ── 楼层倍率 ──────────────────────────────────────────────
export function floorScale(floor: number): number {
  return floor < 4 ? 1.0 : 1.0 + (floor - 3) * 0.25;
}

// ── 工具 ──────────────────────────────────────────────────
let _uidCounter = 0;
let _slotCounter = 0;
export function newSlotId(): string { return `slt_${++_slotCounter}`; }

function pickRandSuit(): Suit { return SUITS[Math.floor(Math.random() * SUITS.length)]; }

export function makeInstance(defId: string, suit?: Suit, floor = 0): CardInstance {
  const def = CARD_DB[defId];
  const s = suit ?? def?.defaultSuit ?? def?.attackSuit ?? def?.equipSuit ?? pickRandSuit();
  const uid = `${defId}_${++_uidCounter}`;
  return {
    defId,
    uid,
    scale: floorScale(floor),
    suit: s,
    slotId: newSlotId(),
  };
}

// ── 状态工具 ──────────────────────────────────────────────
function addStatus(target: { statuses: StatusEffect[] }, id: string, name: string, stacks: number, duration = -1) {
  const s = target.statuses.find(x => x.id === id);
  if (s) s.stacks += stacks;
  else target.statuses.push({ id, name, stacks, duration });
}


export function healVita(ctx: BattleContext, n: number) {
  const scaled = Math.round(n * (ctx.slotScale ?? 1));
  const before = ctx.player.vita;
  ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + scaled);
  const actual = ctx.player.vita - before;
  if (actual > 0) ctx.log(`回 ${actual} HP。`, "player");
}

// ── 通用：减敌人 HP + 击杀判定 ───────────────────────────
// 反伤、技能直伤、特性伤害都走这里，保证 alive=false 触发
export function damageEnemy(target: EnemyState, n: number, log: (m: string, k?: LogKind) => void, msg?: string) {
  if (!target.alive || n <= 0) return;
  target.hp = Math.max(0, target.hp - n);
  if (msg) log(msg, "player");
  if (target.hp <= 0) {
    // 特能：不朽 — HP 归 0 时复活到 50%（每只敌人整局 1 次）
    if (target.eliteAbility === "不朽" && !(target as any)._undyingUsed) {
      (target as any)._undyingUsed = true;
      target.hp = Math.round(target.maxHp * 0.5);
      log(`★ ${target.name} 不朽！复活到 ${target.hp} HP。`, "lose");
      return;
    }
    target.alive = false;
    log(`★ 击败 ${target.name}！`, "win");
  }
}

// ── 直接对敌方造成伤害（无视武器，用于技能/道具） ───
export function dealDirectDamage(ctx: BattleContext, target: EnemyState, n: number) {
  const dmg = Math.max(0, Math.round(n * (ctx.slotScale ?? 1)));
  damageEnemy(target, dmg, ctx.log, `对 ${target.name} 造成 ${dmg} 点伤害。`);
}

// ─────────────────────────────────────────────────────────
// 攻击牌（4 花色 × 2 张 = 8 张基础攻击）
// ─────────────────────────────────────────────────────────

function makeAttack(id: string, suit: Suit): CardDef {
  return {
    id,
    name: `攻击 ${SUIT_SYMBOLS[suit]}`,
    category: "attack",
    desc: `打出武器一击（${SUIT_SYMBOLS[suit]}）。`,
    attackSuit: suit,
  };
}

const ATTACK_SPADE = makeAttack("atk_spade", "spade");
const ATTACK_DIAMOND = makeAttack("atk_diamond", "diamond");
const ATTACK_HEART = makeAttack("atk_heart", "heart");
const ATTACK_CLUB = makeAttack("atk_club", "club");

// ─────────────────────────────────────────────────────────
// 武器（装备牌：出在手牌中，打出后进入常驻武器槽）
// 叠加 1/2/3/4 → 倍率 1.0 / 1.4 / 1.8 / 2.2
// ─────────────────────────────────────────────────────────

const SHORT_SWORD: CardDef = {
  id: "short_sword",
  name: "短剑",
  category: "equipment",
  desc: "装备：基础伤害 5。打出后装上武器槽（同款叠加 ×1.4/×1.8/×2.2）。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 5,
  equipEffects: [
    { desc: "基础伤害 5。", stat: "5 伤" },
    { desc: "叠加 ×1.4 → 7 基础伤。", stat: "7 伤" },
    { desc: "叠加 ×1.8 → 9 基础伤。", stat: "9 伤" },
    { desc: "叠加 ×2.2 → 11 基础伤。", stat: "11 伤" },
  ],
};

const LONG_SWORD: CardDef = {
  id: "long_sword",
  name: "长剑",
  category: "equipment",
  desc: "装备：基础伤害 7，破甲 3（无视敌人 3 点护甲）。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 7,
  pierce: 3,
  equipEffects: [
    { desc: "基础 7，破甲 3。", stat: "7 伤 破3" },
    { desc: "叠加 ×1.4，破甲 3。", stat: "9.8 伤 破3" },
    { desc: "叠加 ×1.8，破甲 3。", stat: "12.6 伤 破3" },
    { desc: "叠加 ×2.2，破甲 3。", stat: "15.4 伤 破3" },
  ],
};

const DAGGER: CardDef = {
  id: "dagger",
  name: "匕首",
  category: "equipment",
  desc: "装备：基础伤害 4，攻击吸血 25%。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 4,
  equipEffects: [
    { desc: "基础 4 + 吸血 25%。", stat: "4 伤 吸25%",
      onAttack: (ctx, d) => { const h = Math.floor(d * 0.25); if (h > 0) { ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + h); ctx.log(`匕首吸血 ${h}。`, "player"); } return d; } },
    { desc: "叠加 ×1.4 + 吸血 25%。", stat: "5.6 伤 吸25%",
      onAttack: (ctx, d) => { const h = Math.floor(d * 0.25); if (h > 0) { ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + h); ctx.log(`匕首吸血 ${h}。`, "player"); } return d; } },
    { desc: "叠加 ×1.8 + 吸血 25%。", stat: "7.2 伤 吸25%",
      onAttack: (ctx, d) => { const h = Math.floor(d * 0.25); if (h > 0) { ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + h); ctx.log(`匕首吸血 ${h}。`, "player"); } return d; } },
    { desc: "叠加 ×2.2 + 吸血 25%。", stat: "8.8 伤 吸25%",
      onAttack: (ctx, d) => { const h = Math.floor(d * 0.25); if (h > 0) { ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + h); ctx.log(`匕首吸血 ${h}。`, "player"); } return d; } },
  ],
};

const WAR_BOW: CardDef = {
  id: "war_bow",
  name: "战弓",
  category: "equipment",
  desc: "装备：基础伤害 6，狙击——攻击 HP > 50% 的敌人 +4 伤。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 6,
  equipEffects: [
    { desc: "基础 6 + HP>50% 狙击 +4。", stat: "6 伤 狙击+4",
      onAttack: (c, d) => c.target.hp > Math.floor(c.target.maxHp * 0.5) ? d + 4 : d },
    { desc: "叠加 ×1.4 + 狙击 +4。", stat: "8.4 伤 狙击+4",
      onAttack: (c, d) => c.target.hp > Math.floor(c.target.maxHp * 0.5) ? d + 4 : d },
    { desc: "叠加 ×1.8 + 狙击 +4。", stat: "10.8 伤 狙击+4",
      onAttack: (c, d) => c.target.hp > Math.floor(c.target.maxHp * 0.5) ? d + 4 : d },
    { desc: "叠加 ×2.2 + 狙击 +4。", stat: "13.2 伤 狙击+4",
      onAttack: (c, d) => c.target.hp > Math.floor(c.target.maxHp * 0.5) ? d + 4 : d },
  ],
};

// 新增武器（凑 8 件）

const TWIN_BLADES: CardDef = {
  id: "twin_blades",
  name: "双刀",
  category: "equipment",
  desc: "装备：基础伤害 4，每次出攻击牌真触发 2 次（武器钩子触发 2 次）。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 4,
  hits: 2,
  equipEffects: [
    { desc: "基础 4 × 2 次。", stat: "4×2 伤" },
    { desc: "叠加 ×1.4 × 2 次。", stat: "5.6×2 伤" },
    { desc: "叠加 ×1.8 × 2 次。", stat: "7.2×2 伤" },
    { desc: "叠加 ×2.2 × 2 次。", stat: "8.8×2 伤" },
  ],
};

const WARHAMMER: CardDef = {
  id: "warhammer",
  name: "巨锤",
  category: "equipment",
  desc: "装备：基础伤害 8，**击晕**——单次伤害达到目标最大 HP 的 25% 时，按概率沉默 1 回合。已沉默时不刷新。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 8,
  equipEffects: (() => {
    const tryStun = (c: BattleContext, d: number, chance: number): number => {
      if (
        d >= c.target.maxHp * 0.25
        && Math.random() < chance
        && !c.target.statuses.find(s => s.id === "silenced")
      ) {
        c.target.statuses.push({ id: "silenced", name: "沉默", stacks: 1, duration: 1 });
        c.log(`巨锤击晕：${c.target.name} 沉默 1 回合。`, "player");
      }
      return d;
    };
    return [
      { desc: "基础 8，25% 上限击晕（30% 概率）。", stat: "8 伤 击晕30%",
        onAttack: (c, d) => tryStun(c, d, 0.30) },
      { desc: "叠加 ×1.4，击晕概率 40%。", stat: "11.2 伤 击晕40%",
        onAttack: (c, d) => tryStun(c, d, 0.40) },
      { desc: "叠加 ×1.8，击晕概率 50%。", stat: "14.4 伤 击晕50%",
        onAttack: (c, d) => tryStun(c, d, 0.50) },
      { desc: "叠加 ×2.2，击晕概率 60%。", stat: "17.6 伤 击晕60%",
        onAttack: (c, d) => tryStun(c, d, 0.60) },
    ] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

const BATTLE_STAFF: CardDef = {
  id: "battle_staff",
  name: "法杖",
  category: "equipment",
  desc: "装备：基础伤害 5，每次攻击给目标 +1 易伤（×1.5 受伤）持续 2 回合。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 5,
  equipEffects: [
    { desc: "基础 5 + 易伤 ×1.5。", stat: "5 伤 易伤×1.5" },
    { desc: "叠加 ×1.4 + 易伤。", stat: "7 伤 易伤×1.5" },
    { desc: "叠加 ×1.8 + 易伤。", stat: "9 伤 易伤×1.5" },
    { desc: "叠加 ×2.2 + 易伤。", stat: "11 伤 易伤×1.5" },
  ],
};

const CHAIN_WHIP: CardDef = {
  id: "chain_whip",
  name: "链刃",
  category: "equipment",
  desc: "装备：基础伤害 6，每次攻击对其他存活敌人溅射 2 伤（多敌人神器）。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 6,
  equipEffects: [
    { desc: "基础 6 + 溅射 2。", stat: "6 伤 溅2" },
    { desc: "叠加 ×1.4 + 溅射 2。", stat: "8.4 伤 溅2" },
    { desc: "叠加 ×1.8 + 溅射 2。", stat: "10.8 伤 溅2" },
    { desc: "叠加 ×2.2 + 溅射 2。", stat: "13.2 伤 溅2" },
  ],
};

// 狂剑：HP < 50% 时所有攻击 +4 伤（低血强化）
const BERSERKER_BLADE: CardDef = {
  id: "berserker_blade",
  name: "狂剑",
  category: "equipment",
  desc: "装备：基础伤害 6，HP < 50% 时所有攻击 +4 伤。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 6,
  equipEffects: [
    { desc: "基础 6，低血 +4。", stat: "6 伤（低血+4）",
      onAttack: (c, d) => c.player.vita < Math.floor(c.player.vitaMax * 0.5) ? d + 4 : d },
    { desc: "叠加 ×1.4，低血 +4。", stat: "8.4 伤（低血+4）",
      onAttack: (c, d) => c.player.vita < Math.floor(c.player.vitaMax * 0.5) ? d + 4 : d },
    { desc: "叠加 ×1.8，低血 +4。", stat: "10.8 伤（低血+4）",
      onAttack: (c, d) => c.player.vita < Math.floor(c.player.vitaMax * 0.5) ? d + 4 : d },
    { desc: "叠加 ×2.2，低血 +4。", stat: "13.2 伤（低血+4）",
      onAttack: (c, d) => c.player.vita < Math.floor(c.player.vitaMax * 0.5) ? d + 4 : d },
  ],
};

// 法师杖：每出 1 张非攻击牌，下张攻击 +3 伤（同回合累积，攻击后清零）
const WIZARD_STAFF: CardDef = {
  id: "wizard_staff",
  name: "法师杖",
  category: "equipment",
  desc: "装备：基础伤害 4，每出 1 张非攻击牌下次攻击 +3 伤（同回合累积，攻击后清零）。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 4,
  equipEffects: [
    { desc: "基础 4 + 法师杖加成。", stat: "4 伤 +3/非攻击" },
    { desc: "叠加 ×1.4 + 法师杖。", stat: "5.6 伤 +3/非攻击" },
    { desc: "叠加 ×1.8 + 法师杖。", stat: "7.2 伤 +3/非攻击" },
    { desc: "叠加 ×2.2 + 法师杖。", stat: "8.8 伤 +3/非攻击" },
  ],
};

// 连弩：每回合可出多张攻击牌；连续 2 回合出攻击后第 3 回合开始时自动弃置
const REPEATING_BOW: CardDef = {
  id: "repeating_bow",
  name: "连弩",
  category: "equipment",
  desc: "装备：基础伤害 4，每回合可出多张攻击牌。连续两回合都出了一张以上的攻击时，第三回合开始自动弃置。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 4,
  equipEffects: [
    { desc: "基础 4，可连续攻击。", stat: "4 伤 连击" },
    { desc: "叠加 ×1.4，可连续攻击。", stat: "5.6 伤 连击" },
    { desc: "叠加 ×1.8，可连续攻击。", stat: "7.2 伤 连击" },
    { desc: "叠加 ×2.2，可连续攻击。", stat: "8.8 伤 连击" },
  ],
};

// ─────────────────────────────────────────────────────────
// 防具（装备牌）
// ─────────────────────────────────────────────────────────

const ROUND_SHIELD: CardDef = {
  id: "round_shield",
  name: "圆盾",
  category: "equipment",
  desc: "装备：受击 -3。",
  equipKind: "armor",
  equipSuit: "diamond",
  baseReduce: 3,
  equipEffects: [
    { desc: "受击 -3。", stat: "-3 受击", onTakeDamage: (_c, d) => Math.max(0, d - 3) },
    { desc: "受击 ×1.4 → -4。", stat: "-4 受击", onTakeDamage: (_c, d) => Math.max(0, d - 4) },
    { desc: "受击 ×1.8 → -5。", stat: "-5 受击", onTakeDamage: (_c, d) => Math.max(0, d - 5) },
    { desc: "受击 ×2.2 → -7。", stat: "-7 受击", onTakeDamage: (_c, d) => Math.max(0, d - 7) },
  ],
};

const LEATHER_ARMOR: CardDef = {
  id: "leather_armor",
  name: "皮甲",
  category: "equipment",
  desc: "装备：受击 -1，每回合 +2 HP。",
  equipKind: "armor",
  equipSuit: "heart",
  baseReduce: 1,
  equipEffects: [
    { desc: "受击 -1，每回合 +2 HP。", stat: "-1 受击 +2HP/回",
      onTakeDamage: (_c, d) => Math.max(0, d - 1),
      onTurnStart: (c) => { c.player.vita = Math.min(c.player.vitaMax, c.player.vita + 2); c.log("皮甲：回 2 HP。", "player"); } },
    { desc: "叠加 ×1.4。", stat: "-1 受击 +3HP/回",
      onTakeDamage: (_c, d) => Math.max(0, d - 1),
      onTurnStart: (c) => { c.player.vita = Math.min(c.player.vitaMax, c.player.vita + 3); c.log("皮甲：回 3 HP。", "player"); } },
    { desc: "叠加 ×1.8。", stat: "-2 受击 +4HP/回",
      onTakeDamage: (_c, d) => Math.max(0, d - 2),
      onTurnStart: (c) => { c.player.vita = Math.min(c.player.vitaMax, c.player.vita + 4); c.log("皮甲：回 4 HP。", "player"); } },
    { desc: "叠加 ×2.2。", stat: "-2 受击 +5HP/回",
      onTakeDamage: (_c, d) => Math.max(0, d - 2),
      onTurnStart: (c) => { c.player.vita = Math.min(c.player.vitaMax, c.player.vita + 5); c.log("皮甲：回 5 HP。", "player"); } },
  ],
};

const SPIKE_ARMOR: CardDef = {
  id: "spike_armor",
  name: "反伤甲",
  category: "equipment",
  desc: "装备：受击反伤 3。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 0,
  equipEffects: [
    { desc: "反伤 3。", stat: "反伤 3", onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 3, c.log, `反伤甲 → ${t.name} -3。`); return d; } },
    { desc: "反伤 4。", stat: "反伤 4", onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 4, c.log, `反伤甲 → ${t.name} -4。`); return d; } },
    { desc: "反伤 5。", stat: "反伤 5", onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 5, c.log, `反伤甲 → ${t.name} -5。`); return d; } },
    { desc: "反伤 7。", stat: "反伤 7", onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 7, c.log, `反伤甲 → ${t.name} -7。`); return d; } },
  ],
};

const HEAVY_ARMOR: CardDef = {
  id: "heavy_armor",
  name: "重甲",
  category: "equipment",
  desc: "装备：受击 -4，但出攻击伤害 -1（笨重）。",
  equipKind: "armor",
  equipSuit: "club",
  baseReduce: 4,
  equipEffects: [
    { desc: "受击 -4，攻击 -1。", stat: "-4 受击 攻-1",
      onTakeDamage: (_c, d) => Math.max(0, d - 4),
      postAttack: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -5，攻击 -1。", stat: "-5 受击 攻-1",
      onTakeDamage: (_c, d) => Math.max(0, d - 5),
      postAttack: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -7，攻击 -1。", stat: "-7 受击 攻-1",
      onTakeDamage: (_c, d) => Math.max(0, d - 7),
      postAttack: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -9，攻击 -1。", stat: "-9 受击 攻-1",
      onTakeDamage: (_c, d) => Math.max(0, d - 9),
      postAttack: (_c, d) => Math.max(0, d - 1) },
  ],
};

// 新增防具（凑 8 件）

const MAGE_ROBE: CardDef = {
  id: "mage_robe",
  name: "法袍",
  category: "equipment",
  desc: "装备：受击 -1。出技能/道具时额外摸 1 张牌（持续过牌）。",
  equipKind: "armor",
  equipSuit: "diamond",
  baseReduce: 1,
  equipEffects: [
    { desc: "受击 -1 + 技能/道具摸 1 张。", stat: "-1 受击 +1摸/技", onTakeDamage: (_c, d) => Math.max(0, d - 1) },
    { desc: "叠加 ×1.4。", stat: "-1 受击 +1摸/技", onTakeDamage: (_c, d) => Math.max(0, d - 1) },
    { desc: "叠加 ×1.8。", stat: "-2 受击 +1摸/技", onTakeDamage: (_c, d) => Math.max(0, d - 2) },
    { desc: "叠加 ×2.2。", stat: "-2 受击 +1摸/技", onTakeDamage: (_c, d) => Math.max(0, d - 2) },
  ],
};

const CLOAK: CardDef = {
  id: "cloak",
  name: "斗篷",
  category: "equipment",
  desc: "装备：受击 -1。每回合开始消除自身 1 个负面状态。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 1,
  equipEffects: [
    { desc: "-1 受击 + 自动驱毒。", stat: "-1 受击 自动驱毒",
      onTakeDamage: (_c, d) => Math.max(0, d - 1),
      onTurnStart: (c) => removeOneDebuff(c) },
    { desc: "叠加。", stat: "-1 受击 自动驱毒",
      onTakeDamage: (_c, d) => Math.max(0, d - 1),
      onTurnStart: (c) => removeOneDebuff(c) },
    { desc: "叠加。", stat: "-2 受击 自动驱毒",
      onTakeDamage: (_c, d) => Math.max(0, d - 2),
      onTurnStart: (c) => removeOneDebuff(c) },
    { desc: "叠加。", stat: "-3 受击 自动驱毒",
      onTakeDamage: (_c, d) => Math.max(0, d - 3),
      onTurnStart: (c) => removeOneDebuff(c) },
  ],
};

const FULL_PLATE: CardDef = {
  id: "full_plate",
  name: "重铠",
  category: "equipment",
  desc: "装备：受击 -5，但出攻击伤害 -2（笨重）。比重甲更极端。",
  equipKind: "armor",
  equipSuit: "club",
  baseReduce: 5,
  equipEffects: [
    { desc: "-5 受击，攻击 -2。", stat: "-5 受击 攻-2",
      onTakeDamage: (_c, d) => Math.max(0, d - 5),
      postAttack: (_c, d) => Math.max(0, d - 2) },
    { desc: "-7 受击，攻击 -2。", stat: "-7 受击 攻-2",
      onTakeDamage: (_c, d) => Math.max(0, d - 7),
      postAttack: (_c, d) => Math.max(0, d - 2) },
    { desc: "-9 受击，攻击 -2。", stat: "-9 受击 攻-2",
      onTakeDamage: (_c, d) => Math.max(0, d - 9),
      postAttack: (_c, d) => Math.max(0, d - 2) },
    { desc: "-12 受击，攻击 -2。", stat: "-12 受击 攻-2",
      onTakeDamage: (_c, d) => Math.max(0, d - 12),
      postAttack: (_c, d) => Math.max(0, d - 2) },
  ],
};

const SCALE_MAIL: CardDef = {
  id: "scale_mail",
  name: "鳞甲",
  category: "equipment",
  desc: "装备：受击 -2，反伤 2。减伤+反伤双修，介于盾与反伤甲之间。",
  equipKind: "armor",
  equipSuit: "heart",
  baseReduce: 2,
  equipEffects: [
    { desc: "-2 受击 + 反伤 2。", stat: "-2 受击 反伤2",
      onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 2, c.log, `鳞甲反伤 ${t.name} -2。`); return Math.max(0, d - 2); } },
    { desc: "-3 受击 + 反伤 3。", stat: "-3 受击 反伤3",
      onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 3, c.log, `鳞甲反伤 ${t.name} -3。`); return Math.max(0, d - 3); } },
    { desc: "-4 受击 + 反伤 4。", stat: "-4 受击 反伤4",
      onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 4, c.log, `鳞甲反伤 ${t.name} -4。`); return Math.max(0, d - 4); } },
    { desc: "-5 受击 + 反伤 5。", stat: "-5 受击 反伤5",
      onTakeDamage: (c, d) => { const t = c.enemies.find(e => e.alive); if (t) damageEnemy(t, 5, c.log, `鳞甲反伤 ${t.name} -5。`); return Math.max(0, d - 5); } },
  ],
};

// 意念甲：固定概率闪避，叠加后提升（×1:10%, ×2:20%, ×3:30%, ×4:40%）
const MIND_ARMOR: CardDef = {
  id: "mind_armor",
  name: "意念甲",
  category: "equipment",
  desc: "装备：10% 概率完全闪避攻击。叠加后提升（20% / 30% / 40%）。",
  equipKind: "armor",
  equipSuit: "diamond",
  baseReduce: 0,
  equipEffects: [
    { desc: "10% 闪避（完全无视伤害）。", stat: "10% 闪避",
      onTakeDamage: (c, d) => { if (Math.random() < 0.10) { c.log("意念甲：完全闪避！", "player"); return 0; } return d; } },
    { desc: "20% 闪避。", stat: "20% 闪避",
      onTakeDamage: (c, d) => { if (Math.random() < 0.20) { c.log("意念甲：完全闪避！", "player"); return 0; } return d; } },
    { desc: "30% 闪避。", stat: "30% 闪避",
      onTakeDamage: (c, d) => { if (Math.random() < 0.30) { c.log("意念甲：完全闪避！", "player"); return 0; } return d; } },
    { desc: "40% 闪避。", stat: "40% 闪避",
      onTakeDamage: (c, d) => { if (Math.random() < 0.40) { c.log("意念甲：完全闪避！", "player"); return 0; } return d; } },
  ],
};

// 工具：清除一个 debuff（用于斗篷）
function removeOneDebuff(c: BattleContext) {
  const debuffIds = ["poison", "weak", "vulnerable", "silenced"];
  for (const id of debuffIds) {
    const idx = c.player.statuses.findIndex(s => s.id === id);
    if (idx >= 0) {
      c.player.statuses.splice(idx, 1);
      c.log(`斗篷：清除「${id}」。`, "player");
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────
// 技能牌（12 张）
// ─────────────────────────────────────────────────────────

const SK_POISON_BLADE: CardDef = {
  id: "sk_poison_blade", name: "毒刃", category: "skill", target: "single",
  desc: "目标 +3 层中毒：每回合扣等同层数的 HP，每回合自动 -1 层。",
  onPlay: (c) => { addStatus(c.target, "poison", "中毒", 3); c.log(`${c.target.name} 中毒 +3。`, "player"); },
};

const SK_BATTLE_CRY: CardDef = {
  id: "sk_battle_cry", name: "战吼", category: "skill", target: "self",
  desc: "本回合所有攻击 +3 伤。",
  onPlay: (c) => { addStatus(c.player, "battle_cry", "战吼", 1, 1); c.log("战吼！本回合攻击 +3。", "player"); },
};

const SK_FRENZY: CardDef = {
  id: "sk_frenzy", name: "激奋", category: "skill", target: "self",
  desc: "激活激奋：每打出一张攻击牌后层数 +1，下次攻击额外 +5 × 层数伤害（整场战斗持续）。",
  onPlay: (c) => {
    if (!c.player.statuses.find(s => s.id === "frenzy")) {
      addStatus(c.player, "frenzy", "激奋", 1, -1);
      c.log("激奋激活！下张攻击 +5。", "player");
    } else {
      c.log("激奋已激活，重复使用无效。", "system");
    }
  },
};

const SK_EVASIVE: CardDef = {
  id: "sk_evasive", name: "闪避姿态", category: "skill", target: "self",
  desc: "本回合受到的伤害 -50%。",
  onPlay: (c) => { addStatus(c.player, "evasive", "闪避", 1, 1); c.log("闪避姿态。", "player"); },
};

const SK_SILENCE: CardDef = {
  id: "sk_silence", name: "沉默", category: "skill", target: "single",
  desc: "目标下回合的增益类行动被跳过。",
  onPlay: (c) => { addStatus(c.target, "silenced", "沉默", 1, 1); c.log(`${c.target.name} 被沉默。`, "player"); },
};

const SK_FREEZE: CardDef = {
  id: "sk_freeze", name: "冰冻", category: "skill", target: "single",
  desc: "目标下回合伤害 -50%。",
  onPlay: (c) => { addStatus(c.target, "frozen", "冰冻", 1, 1); c.log(`${c.target.name} 被冰冻。`, "player"); },
};

const SK_REND: CardDef = {
  id: "sk_rend", name: "撕裂", category: "skill", target: "single",
  desc: "永久降低目标 2 点护甲。",
  onPlay: (c) => { addStatus(c.target, "rend", "撕裂", 2, -1); c.log(`${c.target.name} 防御 -2。`, "player"); },
};

const SK_FOCUS: CardDef = {
  id: "sk_focus", name: "聚气", category: "skill", target: "self",
  desc: "立刻摸 2 张牌。",
  onPlay: (c) => { (c as any)._drawN = ((c as any)._drawN ?? 0) + 2; c.log("聚气：摸 2 张。", "player"); },
};

// 新增单体技能（凑 16 张单体）

const SK_AEGIS: CardDef = {
  id: "sk_aegis", name: "铁壁", category: "skill", target: "self",
  desc: "本回合获得 8 点护盾（吸收下次受到的伤害）。",
  onPlay: (c) => { addStatus(c.player, "shield_block", "护盾", 8); c.log("铁壁：+8 护盾。", "player"); },
};

const SK_CHARGE: CardDef = {
  id: "sk_charge", name: "蓄力", category: "skill", target: "self",
  desc: "本回合无法出攻击牌，但下回合下次攻击伤害 ×3（用一次清除）。",
  onPlay: (c) => {
    addStatus(c.player, "no_attack", "蓄力中", 1, 1);
    addStatus(c.player, "charged", "已蓄力", 1, -1);
    c.log("蓄力中，本回合无法攻击。", "player");
  },
};

const SK_WEAKENING_BOLT: CardDef = {
  id: "sk_weakening_bolt", name: "虚弱箭", category: "skill", target: "single",
  desc: "目标虚弱（攻击 -3）持续 2 回合。",
  onPlay: (c) => { addStatus(c.target, "weak", "虚弱", 3, 2); c.log(`${c.target.name} 虚弱 -3。`, "player"); },
};

const SK_SHADOW_STRIKE: CardDef = {
  id: "sk_shadow_strike", name: "影袭", category: "skill", target: "self",
  desc: "下一张攻击连击 2 次。",
  onPlay: (c) => { addStatus(c.player, "shadow_double", "影袭", 1, -1); c.log("影袭就绪。", "player"); },
};

const SK_QUICK_DRAW: CardDef = {
  id: "sk_quick_draw", name: "快摸", category: "skill", target: "self",
  desc: "立刻摸 4 张牌。",
  onPlay: (c) => { (c as any)._drawN = ((c as any)._drawN ?? 0) + 4; c.log("快摸：摸 4 张。", "player"); },
};

const SK_COUNTER_STANCE: CardDef = {
  id: "sk_counter_stance", name: "反击姿态", category: "skill", target: "self",
  desc: "本回合受击时反弹 50% 伤害给攻击者。",
  onPlay: (c) => { addStatus(c.player, "counter_stance", "反击姿态", 1, 1); c.log("反击姿态。", "player"); },
};

const SK_BLAST: CardDef = {
  id: "sk_blast", name: "爆裂术", category: "skill", target: "single",
  desc: "自损 10% 生命上限，对目标造成其当前 HP 30% 的直接伤害。",
  onPlay: (c) => {
    const selfDmg = Math.max(1, Math.round(c.player.vitaMax * 0.10));
    c.player.vita = Math.max(0, c.player.vita - selfDmg);
    c.log(`爆裂术：自损 ${selfDmg} HP（10% 上限）。`, "player");
    const enemyDmg = Math.max(1, Math.round(c.target.hp * 0.30));
    dealDirectDamage(c, c.target, enemyDmg);
  },
};

const SK_DBL_PUMMEL: CardDef = {
  id: "sk_dbl_pummel", name: "双重打击", category: "skill", target: "single",
  desc: "对目标造成 4 直伤，并使其易伤 3 回合（受伤 +50%）。",
  onPlay: (c) => {
    dealDirectDamage(c, c.target, 4);
    addStatus(c.target, "vulnerable", "易伤", 1, 3);
    c.log(`${c.target.name} 易伤。`, "player");
  },
};

// ─────────────────────────────────────────────────────────
// 花色操作技能（围绕花色克制构筑）
// ─────────────────────────────────────────────────────────

// 染色术：本回合所有攻击牌花色视为玩家手选花色
const SK_DYE: CardDef = {
  id: "sk_dye", name: "染色术", category: "skill", target: "self",
  desc: "本回合内所有攻击牌的花色视为你选定的花色（让花色相性更可控）。",
  onPlay: (c) => {
    (c as any)._suitPick = "dye";
    c.log("染色术：请选择本回合攻击牌花色。", "player");
  },
};

// 共鸣咒：目标敌人花色变成玩家手选花色（永久，直到被再次改色）
const SK_ATTUNE: CardDef = {
  id: "sk_attune", name: "共鸣咒", category: "skill", target: "single",
  desc: "目标敌人花色永久变为你选定的花色（让同花克制更可控）。",
  onPlay: (c) => {
    (c as any)._suitPick = "resonance";
    c.log(`共鸣咒：请选择 ${c.target.name} 变为的花色。`, "player");
  },
};

// 变色：随机改目标敌人花色（保证 ≠ 当前）
const SK_RECOLOR: CardDef = {
  id: "sk_recolor", name: "变色", category: "skill", target: "single",
  desc: "随机改变目标敌人花色（保证 ≠ 当前）。运气向。",
  onPlay: (c) => {
    const others = SUITS.filter(s => s !== c.target.suit);
    const newSuit = others[Math.floor(Math.random() * others.length)];
    c.target.suit = newSuit;
    c.log(`变色：${c.target.name} 花色随机变为 ${SUIT_SYMBOLS[newSuit]}。`, "player");
  },
};

// ─────────────────────────────────────────────────────────
// 持续/延时技能（让玩家有更多 over-time build 路线）
// ─────────────────────────────────────────────────────────

// 流血咒：目标每回合扣当前 HP × stacks × 5%（指数衰减），持续 5 回合
const SK_CURSE_BLOOD: CardDef = {
  id: "sk_curse_blood", name: "流血咒", category: "skill", target: "single",
  desc: "目标每回合开始扣当前 HP 的 5%（叠加），持续 5 回合。",
  onPlay: (c) => {
    addStatus(c.target, "bleed", "出血", 1, 5);
    c.log(`${c.target.name} 出血。`, "player");
  },
};

// 战斗节奏：本回合内每打 1 张牌额外摸 1 张
const SK_RHYTHM: CardDef = {
  id: "sk_rhythm", name: "战斗节奏", category: "skill", target: "self",
  desc: "本回合内每打出 1 张牌额外摸 1 张（含技能/道具/装备）。",
  onPlay: (c) => {
    addStatus(c.player, "combat_rhythm", "战斗节奏", 1, 1);
    c.log("战斗节奏激活。", "player");
  },
};

// 时停：敌人下一整个回合无法行动（DoT 仍结算）
const SK_TIME_STOP: CardDef = {
  id: "sk_time_stop", name: "时停", category: "skill", target: "self",
  desc: "敌人下一回合无法行动（中毒/燃烧/出血等持续效果仍结算）。",
  onPlay: (c) => {
    addStatus(c.player, "time_stop", "时停", 1, 1);
    c.log("时停激活！敌人下回合无法行动。", "player");
  },
};

// 群体技能（第 3 关后加入牌池）
const SK_CHAIN_BOLT: CardDef = {
  id: "sk_chain_bolt", name: "链电", category: "skill", target: "all",
  desc: "对所有敌人造成 4 点伤害。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) dealDirectDamage(c, e, 4); },
};

const SK_FIRE_WALL: CardDef = {
  id: "sk_fire_wall", name: "火墙", category: "skill", target: "all",
  desc: "所有敌人 +3 燃烧（每回合 -3，持续 3 回合）。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) addStatus(e, "burn", "燃烧", 3, 3); c.log("火墙：全体燃烧 +3。", "player"); },
};

const SK_SHOCKWAVE: CardDef = {
  id: "sk_shockwave", name: "震荡波", category: "skill", target: "all",
  desc: "对所有敌人造成 6 点伤害。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) dealDirectDamage(c, e, 6); },
};

const SK_GROUP_CURSE: CardDef = {
  id: "sk_group_curse", name: "群体诅咒", category: "skill", target: "all",
  desc: "所有敌人下次伤害减半。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) addStatus(e, "frozen", "冰冻", 1, 1); c.log("全体被诅咒。", "player"); },
};

// 新增群攻技能（凑 8 张群攻）

const SK_SONIC: CardDef = {
  id: "sk_sonic", name: "音波", category: "skill", target: "all",
  desc: "对所有敌人造成 7 点伤害。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) dealDirectDamage(c, e, 7); },
};

const SK_MASS_WEAK: CardDef = {
  id: "sk_mass_weak", name: "群体虚弱", category: "skill", target: "all",
  desc: "所有敌人虚弱（攻击 -3）持续 2 回合。",
  onPlay: (c) => {
    for (const e of c.enemies) if (e.alive) addStatus(e, "weak", "虚弱", 3, 2);
    c.log("全体虚弱。", "player");
  },
};

const SK_LIGHTNING: CardDef = {
  id: "sk_lightning", name: "闪电链", category: "skill", target: "all",
  desc: "随机对存活敌人造成 4 次 3 点伤害（每轮不重复，存活数 < 4 时下一轮重洗）。",
  onPlay: (c) => {
    let pool: any[] = [];
    for (let i = 0; i < 4; i++) {
      if (pool.length === 0) {
        pool = c.enemies.filter(e => e.alive);
        // shuffle
        for (let j = pool.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [pool[j], pool[k]] = [pool[k], pool[j]];
        }
      }
      if (pool.length === 0) break;
      const t = pool.shift()!;
      if (t.alive) dealDirectDamage(c, t, 3);
    }
  },
};

const SK_CURSE_VORTEX: CardDef = {
  id: "sk_curse_vortex", name: "诅咒漩涡", category: "skill", target: "all",
  desc: "所有敌人 +2 中毒。",
  onPlay: (c) => {
    for (const e of c.enemies) if (e.alive) addStatus(e, "poison", "中毒", 2);
    c.log("全体中毒 +2。", "player");
  },
};

// 混色波：群体随机改色（多敌人战的洗牌神器）
const SK_CHROMA_WAVE: CardDef = {
  id: "sk_chroma_wave", name: "混色波", category: "skill", target: "all",
  desc: "所有存活敌人花色随机重置（不会保持原花色）。",
  onPlay: (c) => {
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const others = SUITS.filter(s => s !== e.suit);
      e.suit = others[Math.floor(Math.random() * others.length)];
    }
    c.log("混色波：全体花色随机重置。", "player");
  },
};

// ─────────────────────────────────────────────────────────
// 道具牌（6 张）
// ─────────────────────────────────────────────────────────

const IT_HEAL_POTION: CardDef = {
  id: "it_heal", name: "回血药水", category: "item", target: "self",
  desc: "回复最大 HP 的 20%（最少 12 点）。",
  onPlay: (c) => { healVita(c, Math.max(12, Math.floor(c.player.vitaMax * 0.20))); },
};

const IT_PURIFY: CardDef = {
  id: "it_purify", name: "驱毒剂", category: "item", target: "self",
  desc: "清除自身所有负面状态。",
  onPlay: (c) => {
    const before = c.player.statuses.length;
    c.player.statuses = c.player.statuses.filter(s => ["battle_cry", "double_strike", "evasive", "shield_block", "reflect", "busi_triggered", "weapon_buff"].includes(s.id));
    if (c.player.statuses.length < before) c.log("驱毒剂：清除负面。", "player");
  },
};

const IT_WHETSTONE: CardDef = {
  id: "it_whetstone", name: "磨刀石", category: "item", target: "self",
  desc: "下一张攻击伤害 ×1.5。",
  onPlay: (c) => { addStatus(c.player, "sharpened", "磨刀", 1, -1); c.log("磨刀石：下张攻击 ×1.5。", "player"); },
};

const IT_REGROUP: CardDef = {
  id: "it_regroup", name: "重整", category: "item", target: "self",
  desc: "弃掉所有手牌，重摸 5 张。",
  onPlay: (c) => { (c as any)._regroup = 5; c.log("重整：重摸 5 张。", "player"); },
};

const IT_BOMB: CardDef = {
  id: "it_bomb", name: "炸弹", category: "item", target: "single",
  desc: "对目标造成 15 点直接伤害。",
  onPlay: (c) => dealDirectDamage(c, c.target, 15),
};

const IT_ELIXIR: CardDef = {
  id: "it_elixir", name: "强化药", category: "item", target: "self",
  desc: "本场战斗武器 +2 伤。",
  onPlay: (c) => { addStatus(c.player, "weapon_buff", "强化药", 2, -1); c.log("强化药：武器 +2 伤。", "player"); },
};

// ─────────────────────────────────────────────────────────
// EPIC 卡（5 张 · 极难抽到，但一抽到就改变跑酷走向）
// ─────────────────────────────────────────────────────────

// Epic 武器 1：王者之剑 — 顶级输出，无视护甲，全攻击 +30%
const EXCALIBUR: CardDef = {
  id: "excalibur", name: "王者之剑", category: "equipment",
  desc: "基础 10，无视全部护甲，攻击 +30%。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 10,
  pierce: 99,
  equipEffects: [
    { desc: "基础 10，无视护甲，攻击 +30%。", stat: "10 伤 破甲 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×1.4。", stat: "14 伤 破甲 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×1.8。", stat: "18 伤 破甲 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×2.2。", stat: "22 伤 破甲 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
  ],
};

// Epic 武器 2：天命之刃 — 把濒死敌人秒杀的门槛抬到 30%
const DIVINE_BLADE: CardDef = {
  id: "divine_blade", name: "天命之刃", category: "equipment",
  desc: "基础 8，敌人 HP ≤ 30% 时直接斩杀。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 8,
  equipEffects: [
    { desc: "基础 8，HP ≤ 30% 斩杀。", stat: "8 伤 30%斩",
      onAttack: (c, d) => {
        if (c.target.alive && c.target.hp - d <= c.target.maxHp * 0.30 && c.target.hp - d > 0) {
          c.log(`★ 天命斩杀 ${c.target.name}！`, "win");
          return c.target.hp;
        }
        return d;
      } },
    { desc: "叠加 ×1.4。", stat: "11.2 伤 30%斩",
      onAttack: (c, d) => {
        if (c.target.alive && c.target.hp - d <= c.target.maxHp * 0.30 && c.target.hp - d > 0) {
          c.log(`★ 天命斩杀 ${c.target.name}！`, "win"); return c.target.hp;
        }
        return d;
      } },
    { desc: "叠加 ×1.8，斩杀阈值 35%。", stat: "14.4 伤 35%斩",
      onAttack: (c, d) => {
        if (c.target.alive && c.target.hp - d <= c.target.maxHp * 0.35 && c.target.hp - d > 0) {
          c.log(`★ 天命斩杀 ${c.target.name}！`, "win"); return c.target.hp;
        }
        return d;
      } },
    { desc: "叠加 ×2.2，斩杀阈值 40%。", stat: "17.6 伤 40%斩",
      onAttack: (c, d) => {
        if (c.target.alive && c.target.hp - d <= c.target.maxHp * 0.40 && c.target.hp - d > 0) {
          c.log(`★ 天命斩杀 ${c.target.name}！`, "win"); return c.target.hp;
        }
        return d;
      } },
  ],
};

// Epic 防具：不灭之心 — 整局只能复活 1 次（无论叠多少层都是 1 次）
const UNDYING_HEART: CardDef = {
  id: "undying_heart", name: "不灭之心", category: "equipment",
  desc: "受击 -2。HP 归 0 时复活到 50%（整局 1 次）。",
  equipKind: "armor",
  equipSuit: "heart",
  baseReduce: 2,
  equipEffects: [
    { desc: "受击 -2，整局 1 次复活到 50% HP。", stat: "-2 受击 复活50%",
      onTakeDamage: (_c, d) => Math.max(0, d - 2) },
    { desc: "叠加：复活到 65% HP。", stat: "-2 受击 复活65%",
      onTakeDamage: (_c, d) => Math.max(0, d - 2) },
    { desc: "叠加：复活到 80% HP。", stat: "-2 受击 复活80%",
      onTakeDamage: (_c, d) => Math.max(0, d - 2) },
    { desc: "叠加：复活到 100% HP。", stat: "-2 受击 复活100%",
      onTakeDamage: (_c, d) => Math.max(0, d - 2) },
  ],
};

// Epic 群攻技能：众神之怒 — 全敌当前 HP 50% 直伤
const SK_WRATH: CardDef = {
  id: "sk_wrath", name: "众神之怒", category: "skill", target: "all",
  desc: "所有存活敌人受到当前 HP 50% 直伤。",
  onPlay: (c) => {
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dmg = Math.max(1, Math.round(e.hp * 0.5));
      dealDirectDamage(c, e, dmg);
    }
    c.log("众神之怒：天空裂开，神罚降临。", "player");
  },
};

// Epic 道具：复读机 — 本场战斗每出 1 张非攻击牌复制 1 份到手牌
const IT_ECHO: CardDef = {
  id: "it_echo", name: "复读机", category: "item", target: "self",
  desc: "每出 1 张非攻击牌，复制一份回手牌。",
  onPlay: (c) => {
    addStatus(c.player, "echo", "复读", 1, -1);
    c.log("复读机：时间在打嗝。", "player");
  },
};

// ─────────────────────────────────────────────────────────
// 特性（9 种，沿用旧的）
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// 特性（13 张 · 单一 perkEffect · 按叠加张数线性缩放 · 无叠加上限）
// ─────────────────────────────────────────────────────────

const PERK_BLEED: CardDef = {
  id: "p_bleed", name: "流血", category: "perk",
  desc: "每张：武器伤害 +5%（叠加无上限）。",
  defaultSuit: "spade",
  perkEffect: {
    unitDesc: "武器伤害 +5%（每张）",
    summary: (s) => `武器 +${s * 5}%`,
    onDealDamage: (_c, d, s) => d * (1 + 0.05 * s),
  },
};

const PERK_DODGE: CardDef = {
  id: "p_dodge", name: "闪避", category: "perk",
  desc: "每张：受击 -3%、完全闪避概率 +3%（全闪上限 50%）。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "受击 -3% + 全闪 +3%（每张，全闪 cap 50%）",
    summary: (s) => `受击 -${s * 3}% + 全闪 ${Math.min(50, s * 3)}%`,
    onTakeDamage: (c, d, s) => {
      const dodgeChance = Math.min(0.5, s * 0.03);
      if (Math.random() < dodgeChance) { c.log("完全闪避！", "player"); return 0; }
      return Math.max(0, d * (1 - 0.03 * s));
    },
  },
};

const PERK_REGEN: CardDef = {
  id: "p_regen", name: "再生", category: "perk",
  desc: "每张：每回合回最大 HP × 3%（向下取整，最少 1）。",
  defaultSuit: "heart",
  perkEffect: {
    unitDesc: "每回合 +3% 最大 HP（每张）",
    summary: (s) => `+${s * 3}% 最大 HP / 回`,
    onTurnStart: (c, s) => {
      const heal = Math.max(1, Math.floor(c.player.vitaMax * 0.03 * s));
      const before = c.player.vita;
      c.player.vita = Math.min(c.player.vitaMax, c.player.vita + heal);
      if (c.player.vita > before) c.log(`再生：回 ${c.player.vita - before} HP。`, "player");
    },
  },
};

const PERK_CRIT: CardDef = {
  id: "p_crit", name: "暴击", category: "perk",
  desc: "每张：暴击率 +5%（暴击伤害 ×2，可叠到 100%）。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "暴击率 +5%（每张，×2 暴击伤）",
    summary: (s) => `${Math.min(100, s * 5)}% 暴击 ×2`,
    onDealDamage: (c, d, s) => {
      const chance = Math.min(1, s * 0.05);
      if (Math.random() < chance) { c.log("暴击！×2", "player"); return d * 2; }
      return d;
    },
  },
};

const PERK_TOUGH: CardDef = {
  id: "p_tough", name: "强壮", category: "perk",
  desc: "每张：受击 -3%（叠加无上限）。",
  defaultSuit: "club",
  perkEffect: {
    unitDesc: "受击伤害 -3%（每张）",
    summary: (s) => `受击 -${s * 3}%`,
    onTakeDamage: (_c, d, s) => Math.max(0, d * (1 - 0.03 * s)),
  },
};

const PERK_VAMPIRE: CardDef = {
  id: "p_vampire", name: "吸血", category: "perk",
  desc: "每张：造伤回血 5%（向下取整）。",
  defaultSuit: "heart",
  perkEffect: {
    unitDesc: "造伤的 5% 回血（每张）",
    summary: (s) => `造伤回血 ${s * 5}%`,
    onDealDamage: (c, d, s) => {
      if (d > 0) {
        const heal = Math.floor(d * 0.05 * s);
        if (heal > 0) {
          c.player.vita = Math.min(c.player.vitaMax, c.player.vita + heal);
          c.log(`吸血：回 ${heal} HP。`, "player");
        }
      }
      return d;
    },
  },
};

const PERK_THORNS: CardDef = {
  id: "p_thorns", name: "荆棘", category: "perk",
  desc: "每张：反伤 = 受到伤害的 10%（上限 80%）。",
  defaultSuit: "club",
  perkEffect: {
    unitDesc: "反伤 = 受到伤害的 10%（每张，cap 80%）",
    summary: (s) => `反伤 ${Math.min(80, s * 10)}% 受到伤害`,
    onTakeDamage: (c, d, s) => {
      const pct = Math.min(0.80, 0.10 * s);
      const reflect = Math.floor(d * pct);
      const t = c.enemies.find(e => e.alive);
      if (t && reflect > 0) damageEnemy(t, reflect, c.log, `荆棘：${t.name} -${reflect}。`);
      return d;
    },
  },
};

const PERK_IRON_WILL: CardDef = {
  id: "p_iron_will", name: "钢铁意志", category: "perk",
  desc: "每张：HP ≤ 30% 时受击 -5%。",
  defaultSuit: "spade",
  perkEffect: {
    unitDesc: "HP ≤ 30% 时受击 -5%（每张）",
    summary: (s) => `濒死(≤30%) 受击 -${s * 5}%`,
    onTakeDamage: (c, d, s) => {
      if (c.player.vita <= Math.floor(c.player.vitaMax * 0.3)) {
        return Math.max(0, d * (1 - 0.05 * s));
      }
      return d;
    },
  },
};

const PERK_LIFETAP: CardDef = {
  id: "p_lifetap", name: "生命汲取", category: "perk",
  desc: "每张：每回合自损 3% 最大 HP，伤敌 = 玩家最大 HP × 5%（皆最少 1）。",
  defaultSuit: "club",
  perkEffect: {
    unitDesc: "每回合 -3% 最大 HP，伤敌 = 最大 HP × 5%（每张）",
    summary: (s) => `-${s * 3}% HP / 回 → 伤敌 ${s * 5}% HP`,
    onTurnStart: (c, s) => {
      const cost = Math.max(1, Math.floor(c.player.vitaMax * 0.03 * s));
      c.player.vita = Math.max(0, c.player.vita - cost);
      const t = c.enemies.find(e => e.alive);
      const dmg = Math.max(1, Math.floor(c.player.vitaMax * 0.05 * s));
      if (t) damageEnemy(t, dmg, c.log, `生命汲取：失 ${cost} HP，${t.name} -${dmg}。`);
    },
  },
};

const PERK_OVERLOAD: CardDef = {
  id: "p_overload", name: "过载", category: "perk",
  desc: "每张：每回合额外摸 1 张牌（上限每回合 4 张）。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "每回合额外摸 1 张（每张，cap 4）",
    summary: (s) => `+${Math.min(4, s)} 张 / 回`,
    onTurnStart: (c, s) => { (c as any)._drawN = ((c as any)._drawN ?? 0) + Math.min(4, s); },
  },
};

const PERK_EXECUTIONER: CardDef = {
  id: "p_executioner", name: "处刑", category: "perk",
  desc: "每张：对 HP ≤ 30% 敌人攻击 +10%。",
  defaultSuit: "spade",
  perkEffect: {
    unitDesc: "HP ≤ 30% 敌人攻击 +10%（每张）",
    summary: (s) => `处刑(≤30%) +${s * 10}%`,
    onDealDamage: (c, d, s) => {
      if (c.target.hp <= Math.floor(c.target.maxHp * 0.3)) return d * (1 + 0.10 * s);
      return d;
    },
  },
};

const PERK_RESONANCE: CardDef = {
  id: "p_resonance", name: "同花共鸣", category: "perk",
  desc: "每张：同花攻击（攻击牌花色 == 敌人花色）伤害 +5%。",
  defaultSuit: "heart",
  perkEffect: {
    unitDesc: "同花攻击 +5%（每张）",
    summary: (s) => `同花 +${s * 5}%`,
    onDealDamage: (c, d, s) => {
      if (c.attackSuit && c.attackSuit === c.target.suit) return d * (1 + 0.05 * s);
      return d;
    },
  },
};

const PERK_COLDBLOOD: CardDef = {
  id: "p_coldblood", name: "冷血", category: "perk",
  desc: "每张：无负面状态时攻击 +3%。",
  defaultSuit: "club",
  perkEffect: {
    unitDesc: "无 debuff 时攻击 +3%（每张）",
    summary: (s) => `无 debuff +${s * 3}%`,
    onDealDamage: (c, d, s) => {
      if (!playerHasDebuff(c)) return d * (1 + 0.03 * s);
      return d;
    },
  },
};

function playerHasDebuff(c: BattleContext): boolean {
  const debuffIds = ["poison", "weak", "vulnerable", "silenced"];
  return c.player.statuses.some(s => debuffIds.includes(s.id));
}

// ─────────────────────────────────────────────────────────
// 卡库
// ─────────────────────────────────────────────────────────

export const CARD_DB: Record<string, CardDef> = {
  // 攻击
  atk_spade: ATTACK_SPADE,
  atk_diamond: ATTACK_DIAMOND,
  atk_heart: ATTACK_HEART,
  atk_club: ATTACK_CLUB,
  // 武器（8）
  short_sword: SHORT_SWORD,
  long_sword: LONG_SWORD,
  dagger: DAGGER,
  war_bow: WAR_BOW,
  twin_blades: TWIN_BLADES,
  warhammer: WARHAMMER,
  battle_staff: BATTLE_STAFF,
  chain_whip: CHAIN_WHIP,
  berserker_blade: BERSERKER_BLADE,
  wizard_staff: WIZARD_STAFF,
  repeating_bow: REPEATING_BOW,
  // 防具（9）
  round_shield: ROUND_SHIELD,
  leather_armor: LEATHER_ARMOR,
  spike_armor: SPIKE_ARMOR,
  heavy_armor: HEAVY_ARMOR,
  mage_robe: MAGE_ROBE,
  cloak: CLOAK,
  full_plate: FULL_PLATE,
  scale_mail: SCALE_MAIL,
  mind_armor: MIND_ARMOR,
  // 技能（16 单体 + 8 群攻 = 24）
  sk_poison_blade: SK_POISON_BLADE,
  sk_battle_cry: SK_BATTLE_CRY,
  sk_frenzy: SK_FRENZY,
  sk_evasive: SK_EVASIVE,
  sk_silence: SK_SILENCE,
  sk_freeze: SK_FREEZE,
  sk_rend: SK_REND,
  sk_focus: SK_FOCUS,
  sk_aegis: SK_AEGIS,
  sk_charge: SK_CHARGE,
  sk_weakening_bolt: SK_WEAKENING_BOLT,
  sk_shadow_strike: SK_SHADOW_STRIKE,
  sk_quick_draw: SK_QUICK_DRAW,
  sk_counter_stance: SK_COUNTER_STANCE,
  sk_blast: SK_BLAST,
  sk_dbl_pummel: SK_DBL_PUMMEL,
  // 花色操作（单体）
  sk_dye: SK_DYE,
  sk_attune: SK_ATTUNE,
  sk_recolor: SK_RECOLOR,
  // 持续/延时（单体）
  sk_curse_blood: SK_CURSE_BLOOD,
  sk_rhythm: SK_RHYTHM,
  sk_time_stop: SK_TIME_STOP,
  // 群攻
  sk_chain_bolt: SK_CHAIN_BOLT,
  sk_fire_wall: SK_FIRE_WALL,
  sk_shockwave: SK_SHOCKWAVE,
  sk_group_curse: SK_GROUP_CURSE,
  sk_sonic: SK_SONIC,
  sk_mass_weak: SK_MASS_WEAK,
  sk_lightning: SK_LIGHTNING,
  sk_curse_vortex: SK_CURSE_VORTEX,
  sk_chroma_wave: SK_CHROMA_WAVE,
  // 道具
  it_heal: IT_HEAL_POTION,
  it_purify: IT_PURIFY,
  it_whetstone: IT_WHETSTONE,
  it_regroup: IT_REGROUP,
  it_bomb: IT_BOMB,
  it_elixir: IT_ELIXIR,
  it_echo: IT_ECHO,
  // Epic 卡（5 张）
  excalibur: EXCALIBUR,
  divine_blade: DIVINE_BLADE,
  undying_heart: UNDYING_HEART,
  sk_wrath: SK_WRATH,
  // 特性（13 张）
  p_bleed: PERK_BLEED,
  p_dodge: PERK_DODGE,
  p_regen: PERK_REGEN,
  p_crit: PERK_CRIT,
  p_tough: PERK_TOUGH,
  p_vampire: PERK_VAMPIRE,
  p_thorns: PERK_THORNS,
  p_iron_will: PERK_IRON_WILL,
  p_lifetap: PERK_LIFETAP,
  p_overload: PERK_OVERLOAD,
  p_executioner: PERK_EXECUTIONER,
  p_resonance: PERK_RESONANCE,
  p_coldblood: PERK_COLDBLOOD,
};

// ─────────────────────────────────────────────────────────
// 稀有度集中表 · 给 CARD_DB 里的每张卡打 rarity
// 没标的默认 common（如 atk_*, short_sword, 起始牌组里的基础卡）
// ─────────────────────────────────────────────────────────
const _RARITY: Record<string, "rare" | "super_rare" | "epic"> = {
  // ── Rare（稳定的 build 件 / 解 buff / 群攻基础）──────────
  twin_blades: "rare", warhammer: "rare", battle_staff: "rare", chain_whip: "rare",
  spike_armor: "rare", scale_mail: "rare", full_plate: "rare",
  sk_blast: "rare", sk_shadow_strike: "rare", sk_dye: "rare", sk_attune: "rare",
  it_regroup: "rare", it_elixir: "rare",
  sk_chain_bolt: "rare", sk_fire_wall: "rare", sk_shockwave: "rare",
  sk_group_curse: "rare", sk_sonic: "rare", sk_mass_weak: "rare", sk_lightning: "rare",
  // ── Super Rare（强力 build 核心 / 大招）─────────────────
  berserker_blade: "super_rare", wizard_staff: "super_rare", repeating_bow: "super_rare",
  mage_robe: "super_rare", mind_armor: "super_rare",
  sk_curse_blood: "super_rare", sk_rhythm: "super_rare", sk_time_stop: "super_rare",
  sk_curse_vortex: "super_rare", sk_chroma_wave: "super_rare",
  // ── Epic（极稀有，一卡逆转乾坤）────────────────────────
  excalibur: "epic", divine_blade: "epic", undying_heart: "epic",
  sk_wrath: "epic", it_echo: "epic",
};
for (const [id, def] of Object.entries(CARD_DB)) {
  def.rarity = _RARITY[id] ?? "common";
}

// 起始牌库（33 张）：21 攻击（6♠+5♦+5♥+5♣） + 6 技能 + 6 道具
// 攻击牌减少 1/4 让玩家有更多空间出技能/道具
// ── 装备分级 ─────────────────────────────────────────────
// 基础装备：纯属性，无 build 钩子；进基础牌组各 ×1（每场起手期望 ≈ 1.05 张装备 / 17.5%）
// 武器 3 件覆盖 ♦♥♣（♠ 由起始短剑覆盖）
export const BASIC_WEAPONS = [
  "long_sword",   // ♣ 基础伤 7 + 破甲 3
  "dagger",       // ♥ 基础伤 4 + 吸血 25%
  "war_bow",      // ♦ 基础伤 6 + 狙击
];
// 防具 4 件覆盖 ♠♦♥♣，每花色 1 件
export const BASIC_ARMORS = [
  "cloak",         // ♠ -1 受击 + 自动驱毒
  "round_shield",  // ♦ -3 受击
  "leather_armor", // ♥ -1 受击 + 2HP/回
  "heavy_armor",   // ♣ -4 受击 攻-1
];

// build 装备：所有带钩子/build 倾向的装备，全走奖励池
export const BUILD_WEAPONS = [
  "twin_blades", "warhammer", "battle_staff", "chain_whip",
  "berserker_blade", "wizard_staff", "repeating_bow",
];
export const BUILD_ARMORS = [
  "spike_armor", "scale_mail", "full_plate", "mage_robe", "mind_armor",
];

export const STARTING_DECK_IDS: string[] = [
  // 21 攻击牌（♠ 多 1 张，对应起始短剑同花色）
  "atk_spade", "atk_spade", "atk_spade", "atk_spade", "atk_spade", "atk_spade",
  "atk_diamond", "atk_diamond", "atk_diamond", "atk_diamond", "atk_diamond",
  "atk_heart", "atk_heart", "atk_heart", "atk_heart", "atk_heart",
  "atk_club", "atk_club", "atk_club", "atk_club", "atk_club",
  // 6 技能
  "sk_poison_blade", "sk_battle_cry", "sk_focus", "sk_evasive", "sk_frenzy", "sk_rend",
  // 6 道具（回血 ×2，驱毒 ×0，其余各 1）
  "it_heal", "it_heal", "it_whetstone", "it_regroup", "it_bomb", "it_elixir",
  // 7 件基础装备（无 build 钩子，每件 ×1，让前期能快速凑同色装备）
  ...BASIC_WEAPONS,
  ...BASIC_ARMORS,
];

// 关卡奖励池（牌库新卡，短剑不在内——仅作起始过渡）
// 战斗胜利奖励池（含基础装备 + build 装备 + Epic 卡）
export const REWARD_CARD_POOL_BASE = [
  // 基础装备（common 档，可用来叠加副本到 ×2/×3/×4）
  "long_sword", "dagger", "war_bow",
  "round_shield", "leather_armor", "heavy_armor", "cloak",
  // build 武器（7）
  "twin_blades", "warhammer", "battle_staff", "chain_whip",
  "berserker_blade", "wizard_staff", "repeating_bow",
  // build 防具（5）
  "spike_armor", "scale_mail", "full_plate", "mage_robe", "mind_armor",
  // 单体技能（22 = 16 + 3 花色 + 3 持续/延时）
  "sk_poison_blade", "sk_battle_cry", "sk_frenzy", "sk_evasive",
  "sk_silence", "sk_freeze", "sk_rend", "sk_focus",
  "sk_aegis", "sk_charge", "sk_weakening_bolt", "sk_shadow_strike",
  "sk_quick_draw", "sk_counter_stance", "sk_blast", "sk_dbl_pummel",
  "sk_dye", "sk_attune", "sk_recolor",
  "sk_curse_blood", "sk_rhythm", "sk_time_stop",
  // 道具
  "it_heal", "it_purify", "it_whetstone", "it_regroup", "it_bomb", "it_elixir",
  // 攻击牌补强
  "atk_spade", "atk_diamond", "atk_heart", "atk_club",
  // Epic（极稀有，需要 tier roll 命中才会出现）
  "excalibur", "divine_blade", "undying_heart", "sk_wrath", "it_echo",
];

// 第 3 关后追加的群攻技能（9 = 8 + 1 花色）
export const REWARD_CARD_POOL_AOE = [
  "sk_chain_bolt", "sk_fire_wall", "sk_shockwave", "sk_group_curse",
  "sk_sonic", "sk_mass_weak", "sk_lightning", "sk_curse_vortex",
  "sk_chroma_wave",
];

// 注：奖励池抽卡已改为稀有度档驱动（rollRewardChoices/pickRarity），权重表已废弃。
// 第 1-2 关 it_purify 出现频率自动通过"稀有度均匀抽"控制（common 池里 1/22）。

export const PERK_POOL = [
  "p_bleed", "p_dodge", "p_regen", "p_crit", "p_tough",
  "p_vampire", "p_thorns", "p_iron_will", "p_lifetap",
  "p_overload", "p_executioner", "p_resonance", "p_coldblood",
];

// 加权采样
export function weightedSample(pool: string[], n: number, weights?: Record<string, number>): string[] {
  const items = pool.map(id => ({ id, w: weights?.[id] ?? 1 }));
  const result: string[] = [];
  while (result.length < n && items.length > 0) {
    const total = items.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    let i = 0;
    for (; i < items.length - 1; i++) { r -= items[i].w; if (r <= 0) break; }
    result.push(items[i].id);
    items.splice(i, 1);
  }
  return result;
}

export function rollChoices(pool: string[], n: number, floor = 0, weights?: Record<string, number>): CardInstance[] {
  const sampled = weightedSample(pool, Math.min(n, pool.length), weights);
  return sampled.map(id => makeInstance(id, undefined, floor));
}

// ── 稀有度抽卡：先 roll 稀有度档，再从该档卡池里 uniform 抽 ──
// 楼层敏感：早期不出 Epic
export function rarityWeights(floor: number): Record<CardRarity, number> {
  if (floor <= 2) return { common: 65, rare: 30, super_rare: 5, epic: 0 };
  if (floor <= 4) return { common: 55, rare: 30, super_rare: 13, epic: 2 };
  return            { common: 50, rare: 30, super_rare: 17, epic: 3 };
}

function pickRarity(floor: number): CardRarity {
  const w = rarityWeights(floor);
  const total = w.common + w.rare + w.super_rare + w.epic;
  let r = Math.random() * total;
  if ((r -= w.epic) < 0) return "epic";
  if ((r -= w.super_rare) < 0) return "super_rare";
  if ((r -= w.rare) < 0) return "rare";
  return "common";
}

/**
 * 关卡奖励抽卡：先 roll 每张候选的稀有度档，再从该档卡池里抽（无放回）
 * 同次奖励里同张卡不会重复
 */
export function rollRewardChoices(pool: string[], n: number, floor = 0): CardInstance[] {
  const byRarity: Record<CardRarity, string[]> = { common: [], rare: [], super_rare: [], epic: [] };
  for (const id of pool) {
    const r = (CARD_DB[id]?.rarity ?? "common") as CardRarity;
    byRarity[r].push(id);
  }
  const result: CardInstance[] = [];
  const used = new Set<string>();
  // 优先抽，最多回退 1 档
  for (let i = 0; i < n; i++) {
    let tier: CardRarity = pickRarity(floor);
    let candidates: string[];
    // 回退查找：当前档无可抽 → 依次降级
    const order: CardRarity[] = ["epic", "super_rare", "rare", "common"];
    const startIdx = order.indexOf(tier);
    let pickedId: string | undefined;
    for (let j = startIdx; j < order.length && !pickedId; j++) {
      tier = order[j];
      candidates = byRarity[tier].filter(id => !used.has(id));
      if (candidates.length > 0) {
        pickedId = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    if (pickedId) {
      used.add(pickedId);
      result.push(makeInstance(pickedId, undefined, floor));
    }
  }
  return result;
}

export function getStackEffect(defId: string, count: number) {
  const def = CARD_DB[defId];
  if (!def) throw new Error(`unknown card: ${defId}`);
  const idx = Math.min(Math.max(count, 1), 4) - 1;
  return { def, stackIdx: idx + 1 };
}

// ── 花色相性（攻击牌 vs 敌人） ────────────────────────────
export function suitMultiplier(attackSuit: Suit, enemySuit: Suit): number {
  if (attackSuit === enemySuit) return 1.2;        // 同花
  if (isRedSuit(attackSuit) === isRedSuit(enemySuit)) return 1.0;  // 同色
  return 0.8;                                       // 异色
}

// ─────────────────────────────────────────────────────────
// 附魔效果定义（5 种，铁匠铺用碎片附魔到武器槽）
// ─────────────────────────────────────────────────────────

export interface EnchantEffect {
  id: EnchantId;
  // 攻击伤害修正（在 calcAttackDamage 末尾、armor 减伤之前调用）
  onAttack?: (ctx: BattleContext, dmg: number) => number;
  // 击杀回调（敌人 alive 变 false 后调用一次）
  onKill?: (ctx: BattleContext, target: EnemyState) => void;
  // 是否绕过敌人 armor / 减伤（如夺命斩杀）
  bypassArmor?: (ctx: BattleContext, dmg: number) => boolean;
}

export const ENCHANT_EFFECTS: Record<EnchantId, EnchantEffect> = {
  // 怒涌：HP 越低伤害越高（每损 10% HP 攻击 +5%）
  frenzy_e: {
    id: "frenzy_e",
    onAttack: (ctx, d) => {
      const lossPct = 1 - (ctx.player.vita / Math.max(1, ctx.player.vitaMax));
      const bonus = Math.floor(lossPct * 10) * 0.05;  // 每 10% 损 = +5%
      if (bonus > 0) {
        ctx.log(`怒涌：HP 损失 ${Math.floor(lossPct * 100)}% → 攻击 +${(bonus * 100).toFixed(0)}%。`, "player");
        return d * (1 + bonus);
      }
      return d;
    },
  },
  // 预谋：calc_charge 由 battle.ts 统一处理（法师杖 + 预谋叠加，每张非攻击牌 +3）
  calculated: {
    id: "calculated",
    // 标记型：实际 onAttack 加成在 battle.ts 的 calcAttackDamage 里统一处理
  },
  // 夺命：每叠加 1 层武器 +15% 即死概率，上限 30%
  assassinate: {
    id: "assassinate",
    onAttack: (ctx, d) => {
      const chance = Math.min(0.30, ctx.player.weapons.length * 0.15);
      if (chance > 0 && Math.random() < chance) {
        ctx.log(`夺命触发（${Math.round(chance * 100)}%）：${ctx.target.name} 即死！`, "player");
        return 999999;
      }
      return d;
    },
    bypassArmor: (_ctx, d) => d >= 999999,
  },
  // 碾压：单击 ≥ 敌人最大 HP 10% 时 +30%
  crushing: {
    id: "crushing",
    onAttack: (ctx, d) => {
      if (d >= ctx.target.maxHp * 0.10) {
        ctx.log(`碾压 +30%！（${Math.floor(d)} ≥ ${Math.floor(ctx.target.maxHp * 0.10)}）`, "player");
        return d * 1.30;
      }
      return d;
    },
  },
  // 吸魂：击杀回复最大 HP 10%（最少 5 点），永久 +3 vitaMax
  soul_drain: {
    id: "soul_drain",
    onKill: (ctx, target) => {
      const heal = Math.max(5, Math.floor(ctx.player.vitaMax * 0.10));
      ctx.player.vitaMax += 3;
      const before = ctx.player.vita;
      ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + heal);
      ctx.log(`吸魂：击杀 ${target.name}，+${ctx.player.vita - before} HP，最大 HP +3。`, "player");
    },
  },
};
