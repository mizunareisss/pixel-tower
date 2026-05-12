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
import { SUIT_SYMBOLS, SUITS, isRedSuit, getEnchantParam } from "./types.ts";

// ── 楼层倍率 ──────────────────────────────────────────────
export function floorScale(floor: number): number {
  return floor < 4 ? 1.0 : 1.0 + (floor - 3) * 0.25;
}

// ── 工具 ──────────────────────────────────────────────────
let _uidCounter = 0;
let _slotCounter = 0;
export function newSlotId(): string { return `slt_${++_slotCounter}`; }

function pickRandSuit(): Suit { return SUITS[Math.floor(Math.random() * SUITS.length)]; }

// 史诗卡每场战斗的使用次数（newBattle 时重置；用尽后回到牌库需要重新抽起）
export const EPIC_USES_PER_BATTLE = 3;

export function makeInstance(defId: string, suit?: Suit, floor = 0): CardInstance {
  const def = CARD_DB[defId];
  const s = suit ?? def?.defaultSuit ?? def?.attackSuit ?? def?.equipSuit ?? pickRandSuit();
  const uid = `${defId}_${++_uidCounter}`;
  const inst: CardInstance = {
    defId,
    uid,
    scale: floorScale(floor),
    suit: s,
    slotId: newSlotId(),
  };
  if (def?.rarity === "epic") inst.usesRemaining = EPIC_USES_PER_BATTLE;
  return inst;
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
  desc: "装备：基础伤害 7，破甲 5（无视敌人 5 点护甲）。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 7,
  pierce: 5,
  equipEffects: [
    { desc: "基础 7，破甲 5。", stat: "7 伤 破5" },
    { desc: "叠加 ×1.4，破甲 5。", stat: "9.8 伤 破5" },
    { desc: "叠加 ×1.8，破甲 5。", stat: "12.6 伤 破5" },
    { desc: "叠加 ×2.2，破甲 5。", stat: "15.4 伤 破5" },
  ],
};

const DAGGER: CardDef = {
  id: "dagger",
  name: "匕首",
  category: "equipment",
  desc: "装备：基础伤害 5，攻击吸血 35%。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 5,
  equipEffects: (() => {
    const mk = (vampPct: number) => ({
      desc: `基础 5×N + 吸血 ${Math.round(vampPct * 100)}%。`,
      stat: `吸${Math.round(vampPct * 100)}%`,
      onAttack: (ctx: BattleContext, d: number) => {
        const h = Math.floor(d * vampPct);
        if (h > 0) {
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + h);
          ctx.log(`匕首吸血 ${h}。`, "player");
        }
        return d;
      },
    });
    return [mk(0.35), mk(0.35), mk(0.35), mk(0.35)] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

// ♥ 偏攻击吸血武器：高基础伤 + 击杀大量回血 + 残血加成
const BLOOD_BLADE: CardDef = {
  id: "blood_blade",
  name: "血裂刃",
  category: "equipment",
  desc: "装备：基础伤害 7，吸血 30%。击杀目标时额外回 20% 最大 HP。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 7,
  equipEffects: (() => {
    const mk = (vampPct: number, killPct: number) => ({
      desc: `基础 7×N + 吸血 ${Math.round(vampPct * 100)}% + 击杀回 ${Math.round(killPct * 100)}% maxHP。`,
      stat: `吸${Math.round(vampPct * 100)}% 击杀+${Math.round(killPct * 100)}%`,
      onAttack: (ctx: BattleContext, d: number) => {
        const heal = Math.floor(d * vampPct);
        if (heal > 0) {
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + heal);
          ctx.log(`血裂刃吸血 ${heal}。`, "player");
        }
        // 击杀检测：本击若致死，额外回 X% maxHP
        if (ctx.target.alive && ctx.target.hp - d <= 0) {
          const bonus = Math.floor(ctx.player.vitaMax * killPct);
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + bonus);
          ctx.log(`血裂刃击杀回血 ${bonus}。`, "player");
        }
        return d;
      },
    });
    return [mk(0.30, 0.15), mk(0.35, 0.18), mk(0.40, 0.22), mk(0.50, 0.28)] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

const WAR_BOW: CardDef = {
  id: "war_bow",
  name: "战弓",
  category: "equipment",
  desc: "装备：基础伤害 6，狙击——攻击 HP > 50% 的敌人 +4 伤。",
  equipKind: "weapon",
  equipSuit: "spade",
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

// ─────────────────────────────────────────────────────────
// 流派资源补全 v2（9 张新武器/防具）：补 ♦/♥/♣ common/epic + ♠ 防具
// 设计目标：每花色至少 common + rare + super_rare 各 1 张
// ─────────────────────────────────────────────────────────

// ── 武器：♦ common 飞镖（v5 base 4 → 5，配合 ♦ T2 破甲修复后才有竞争力）──
const FLYING_DARTS: CardDef = {
  id: "flying_darts",
  name: "飞镖",
  category: "equipment",
  desc: "装备：基础伤害 5，hits=2（双击入门款）。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 5,
  hits: 2,
  equipEffects: [
    { desc: "基础 5 × 2 次。", stat: "5×2 伤" },
    { desc: "叠加 ×1.4 × 2 次。", stat: "7×2 伤" },
    { desc: "叠加 ×1.8 × 2 次。", stat: "9×2 伤" },
    { desc: "叠加 ×2.2 × 2 次。", stat: "11×2 伤" },
  ],
};

// ── 武器：♣ common 木盾杖（v5：护盾按 (2+楼层/3) 缩放，让 F6+ 仍有价值）──
const SHIELD_STAFF: CardDef = {
  id: "shield_staff",
  name: "木盾杖",
  category: "equipment",
  desc: "装备：基础伤害 5，每次攻击后 +(2 + 楼层/3) 本回合临时护盾（×stack）。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 5,
  // 实际护盾值在 battle.ts 里读取 stack + floor 计算
  equipEffects: [
    { desc: "基础 5 + 攻击后楼层缩放护盾。", stat: "5 伤 护盾(2+f/3)" },
    { desc: "叠加 ×1.4。", stat: "7 伤 护盾×1" },
    { desc: "叠加 ×1.8。", stat: "9 伤 护盾×2" },
    { desc: "叠加 ×2.2。", stat: "11 伤 护盾×2" },
  ],
};

// ── 武器：♦ epic 风刃 ──
const WIND_BLADE: CardDef = {
  id: "wind_blade",
  name: "风刃",
  category: "equipment",
  desc: "装备：基础 8，hits=2；闪避触发后下张攻击 +1 hit。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 8,
  hits: 2,
  equipEffects: [
    { desc: "基础 8 × 2 + 闪避后 +1 hit。", stat: "8×2 伤" },
    { desc: "叠加 ×1.4 × 2 + 闪避后 +1 hit。", stat: "11.2×2 伤" },
    { desc: "叠加 ×1.8 × 2 + 闪避后 +1 hit。", stat: "14.4×2 伤" },
    { desc: "叠加 ×2.2 × 2 + 闪避后 +1 hit。", stat: "17.6×2 伤" },
  ],
};

// ── 武器：♥ epic 永生之牙 ──
const EVERLAST_FANG: CardDef = {
  id: "everlast_fang",
  name: "永生之牙",
  category: "equipment",
  desc: "装备：基础 8，吸血 60%；击杀目标回 30% maxHP。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 8,
  equipEffects: (() => {
    const mk = (killPct: number) => ({
      desc: `基础 8×N + 吸血 60% + 击杀回 ${Math.round(killPct * 100)}% maxHP。`,
      stat: `吸 60% 击杀+${Math.round(killPct * 100)}%`,
      onAttack: (ctx: BattleContext, d: number) => {
        const heal = Math.floor(d * 0.60);
        if (heal > 0) {
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + heal);
          ctx.log(`永生之牙吸血 ${heal}。`, "player");
        }
        if (ctx.target.alive && ctx.target.hp - d <= 0) {
          const bonus = Math.floor(ctx.player.vitaMax * killPct);
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + bonus);
          ctx.log(`永生之牙击杀回血 ${bonus}。`, "player");
        }
        return d;
      },
    });
    return [mk(0.30), mk(0.35), mk(0.40), mk(0.50)] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

// ── 武器：♣ epic 禁忌权杖 — 每张已出 ♣ 牌让攻击 +N 直伤（nerf：5→3 at 4 stack） ──
const FORBIDDEN_SCEPTER: CardDef = {
  id: "forbidden_scepter",
  name: "禁忌权杖",
  category: "equipment",
  desc: "装备：基础 7。攻击数值 += 本回合已出 ♣ 牌数 × N（N 随 stack 升级）。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 7,
  equipEffects: (() => {
    const mk = (perClubBuff: number, baseStr: string) => ({
      desc: `基础 ${baseStr} + 每张已出 ♣ 牌 +${perClubBuff}/张直伤。`,
      stat: `${baseStr} 伤 +${perClubBuff}/♣牌`,
    });
    return [
      mk(1, "7"),
      mk(2, "9.8"),
      mk(2, "12.6"),
      mk(3, "15.4"),
    ] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

// ── 防具：♠ common 战甲带 ──
const COMBAT_BELT: CardDef = {
  id: "combat_belt",
  name: "战甲带",
  category: "equipment",
  desc: "装备：减 1，每次受击让本回合下次攻击 +2 攻击。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 1,
  equipEffects: [
    { desc: "减 1 + 受击后下次攻击 +2。", stat: "-1 受击+2 攻" },
    { desc: "减 1 + 受击后下次攻击 +3。", stat: "-1 受击+3 攻" },
    { desc: "减 2 + 受击后下次攻击 +4。", stat: "-2 受击+4 攻" },
    { desc: "减 2 + 受击后下次攻击 +5。", stat: "-2 受击+5 攻" },
  ],
};

// ── 防具：♠ super_rare 斩魂铠 ──
const SOULREAVER_PLATE: CardDef = {
  id: "soulreaver_plate",
  name: "斩魂铠",
  category: "equipment",
  desc: "装备：减 3，本场每受击让攻击 +1 永久（cap 10 次受击 → +10 攻）。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 3,
  equipEffects: [
    { desc: "减 3 + 受击 +1 永久攻。", stat: "-3 永久+1/受击" },
    { desc: "减 4 + 受击 +1 永久攻。", stat: "-4 永久+1/受击" },
    { desc: "减 5 + 受击 +2 永久攻。", stat: "-5 永久+2/受击" },
    { desc: "减 6 + 受击 +2 永久攻。", stat: "-6 永久+2/受击" },
  ],
};

// ── 防具：♠ epic 不朽战甲 ──
const IMMORTAL_PLATE: CardDef = {
  id: "immortal_plate",
  name: "不朽战甲",
  category: "equipment",
  desc: "装备：减 3，受击后下张攻击 hits +1。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 3,
  equipEffects: [
    { desc: "减 3 + 受击后 +1 hit。", stat: "-3 +1 hit/受击" },
    { desc: "减 4 + 受击后 +1 hit。", stat: "-4 +1 hit/受击" },
    { desc: "减 5 + 受击后 +1 hit。", stat: "-5 +1 hit/受击" },
    { desc: "减 6 + 受击后 +1 hit。", stat: "-6 +1 hit/受击" },
  ],
};

// ── 防具：♥ super_rare 生命囊 ──
const LIFE_POUCH: CardDef = {
  id: "life_pouch",
  name: "生命囊",
  category: "equipment",
  desc: "装备：减 1，每回合开始 +3 HP（与 leather_armor 叠加）。",
  equipKind: "armor",
  equipSuit: "heart",
  baseReduce: 1,
  equipEffects: [
    { desc: "减 1 + 每回合 +3 HP。", stat: "-1 +3 HP/回" },
    { desc: "减 1 + 每回合 +4 HP。", stat: "-1 +4 HP/回" },
    { desc: "减 2 + 每回合 +5 HP。", stat: "-2 +5 HP/回" },
    { desc: "减 2 + 每回合 +6 HP。", stat: "-2 +6 HP/回" },
  ],
};

// ── 防具：♦ epic 幻影披风 ──
const PHANTOM_CLOAK: CardDef = {
  id: "phantom_cloak",
  name: "幻影披风",
  category: "equipment",
  desc: "装备：减 1，闪避触发后摸 1 张。",
  equipKind: "armor",
  equipSuit: "diamond",
  baseReduce: 1,
  equipEffects: [
    { desc: "减 1 + 闪避后摸 1 张。", stat: "-1 闪避→摸 1" },
    { desc: "减 2 + 闪避后摸 1 张。", stat: "-2 闪避→摸 1" },
    { desc: "减 2 + 闪避后摸 2 张。", stat: "-2 闪避→摸 2" },
    { desc: "减 3 + 闪避后摸 2 张。", stat: "-3 闪避→摸 2" },
  ],
};

// ─────────────────────────────────────────────────────────
// 流派资源补全 v1（4 张前已加）：♥ 武器 ×2 / ♠ 防具 ×1 / 无花色桥接武器 ×1（已删）
// ─────────────────────────────────────────────────────────

// ♥ 武器：吸血獠牙（rare）— 高吸血 + 当目标 HP 低时伤害放大
const VAMPIRE_FANG: CardDef = {
  id: "vampire_fang",
  name: "吸血獠牙",
  category: "equipment",
  desc: "装备：基础伤害 6，吸血 40%；目标 HP < 50% 时伤害 +5。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 6,
  equipEffects: (() => {
    const mk = (vampPct: number, lowHpBonus: number) => ({
      desc: `基础 6×N + 吸血 ${Math.round(vampPct * 100)}% + HP<50% 时 +${lowHpBonus} 伤。`,
      stat: `吸${Math.round(vampPct * 100)}% HP<50%+${lowHpBonus}`,
      onAttack: (ctx: BattleContext, d: number) => {
        // HP <50% bonus 先加
        let finalD = d;
        if (ctx.target.hp < ctx.target.maxHp * 0.5) finalD += lowHpBonus;
        // 吸血
        const heal = Math.floor(finalD * vampPct);
        if (heal > 0) {
          ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + heal);
          ctx.log(`吸血獠牙吸血 ${heal}。`, "player");
        }
        return finalD;
      },
    });
    return [mk(0.40, 5), mk(0.45, 7), mk(0.50, 9), mk(0.55, 12)] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

// ♥ 武器：生机长杖（super_rare）— v5：回血改 maxHP% 缩放（2%/3%/4%/5%），名字"生机"保留生机能力
const LIFEBLOOM_STAFF: CardDef = {
  id: "lifebloom_staff",
  name: "生机长杖",
  category: "equipment",
  desc: "装备：基础伤害 5；每出 1 张技能/道具回 maxHP × 2-5%（按 stack 升级）。",
  equipKind: "weapon",
  equipSuit: "heart",
  baseDmg: 5,
  equipEffects: [
    { desc: "基础 5 + 技能/道具回 2% maxHP/张。", stat: "5 伤 回 2%/技能" },
    { desc: "叠加 ×1.4 + 回 3% maxHP/张。", stat: "7 伤 回 3%/技能" },
    { desc: "叠加 ×1.8 + 回 4% maxHP/张。", stat: "9 伤 回 4%/技能" },
    { desc: "叠加 ×2.2 + 回 5% maxHP/张。", stat: "11 伤 回 5%/技能" },
  ],
};

// ♠ 防具：骑士铠（rare）— 受击 -2 + 受击后下次攻击 +X 直伤（攻击型防具，弥补 ♠ 0 防具）
const KNIGHT_PLATE: CardDef = {
  id: "knight_plate",
  name: "骑士铠",
  category: "equipment",
  desc: "装备：减 2，受击时下次攻击 +3 直伤（最多叠 5 stack）。",
  equipKind: "armor",
  equipSuit: "spade",
  baseReduce: 2,
  equipEffects: [
    { desc: "减 2 + 受击充能 +3 伤（cap 5 stack）。", stat: "-2 充能+3" },
    { desc: "减 2 + 受击充能 +4 伤。", stat: "-2 充能+4" },
    { desc: "减 3 + 受击充能 +5 伤。", stat: "-3 充能+5" },
    { desc: "减 4 + 受击充能 +6 伤。", stat: "-4 充能+6" },
  ],
};

// 新增武器（凑 8 件）

const TWIN_BLADES: CardDef = {
  id: "twin_blades",
  name: "双刀",
  category: "equipment",
  desc: "装备：基础伤害 4，每次出攻击牌真触发 2 次（武器钩子触发 2 次）。",
  equipKind: "weapon",
  equipSuit: "diamond",
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
    // nerf：击晕率 30/40/50/60% → 25/35/40/45%（4 stack 不再实质控锁 boss）
    return [
      { desc: "基础 8，25% 上限击晕（25% 概率）。", stat: "8 伤 击晕25%",
        onAttack: (c, d) => tryStun(c, d, 0.25) },
      { desc: "叠加 ×1.4，击晕概率 35%。", stat: "11.2 伤 击晕35%",
        onAttack: (c, d) => tryStun(c, d, 0.35) },
      { desc: "叠加 ×1.8,击晕概率 40%。", stat: "14.4 伤 击晕40%",
        onAttack: (c, d) => tryStun(c, d, 0.40) },
      { desc: "叠加 ×2.2，击晕概率 45%。", stat: "17.6 伤 击晕45%",
        onAttack: (c, d) => tryStun(c, d, 0.45) },
    ] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

const BATTLE_STAFF: CardDef = {
  id: "battle_staff",
  name: "法杖",
  category: "equipment",
  desc: "装备：基础伤害 5，每次攻击给目标 +2 易伤（×1.5 受伤）持续 2 回合。",
  equipKind: "weapon",
  equipSuit: "club",
  baseDmg: 5,
  equipEffects: [
    { desc: "基础 5 + 易伤 +2。", stat: "5 伤 易伤+2" },
    { desc: "叠加 ×1.4 + 易伤 +2。", stat: "7 伤 易伤+2" },
    { desc: "叠加 ×1.8 + 易伤 +2。", stat: "9 伤 易伤+2" },
    { desc: "叠加 ×2.2 + 易伤 +2。", stat: "11 伤 易伤+2" },
  ],
};

const CHAIN_WHIP: CardDef = {
  id: "chain_whip",
  name: "链刃",
  category: "equipment",
  desc: "装备：基础伤害 6，每次攻击对其他存活敌人溅射 3 伤（多敌人神器）。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 6,
  equipEffects: [
    { desc: "基础 6 + 溅射 3。", stat: "6 伤 溅3" },
    { desc: "叠加 ×1.4 + 溅射 4。", stat: "8.4 伤 溅4" },
    { desc: "叠加 ×1.8 + 溅射 5。", stat: "10.8 伤 溅5" },
    { desc: "叠加 ×2.2 + 溅射 6。", stat: "13.2 伤 溅6" },
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
  desc: "装备：基础伤害 3，每回合可出多张攻击牌（nerf：原 4 降为 3，叠满 6.6 伤）。连续两回合都出了一张以上的攻击时，第三回合开始自动弃置。",
  equipKind: "weapon",
  equipSuit: "diamond",
  baseDmg: 3,
  equipEffects: [
    { desc: "基础 3，可连续攻击。", stat: "3 伤 连击" },
    { desc: "叠加 ×1.4，可连续攻击。", stat: "4.2 伤 连击" },
    { desc: "叠加 ×1.8，可连续攻击。", stat: "5.4 伤 连击" },
    { desc: "叠加 ×2.2，可连续攻击。", stat: "6.6 伤 连击" },
  ],
};

// 破军：动态破甲武器，pierce 跟随目标 armor 自适应（在 calcAttackDamage 特判）
const RAIDER: CardDef = {
  id: "raider",
  name: "破军",
  category: "equipment",
  desc: "装备：基础伤害 5，破甲数等于目标当前护甲的 50%（自适应）。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 5,
  pierce: 0,  // 实际 pierce 在 battle.ts/calcAttackDamage 里基于 target.armor 动态计算
  equipEffects: [
    { desc: "基础 5，破甲 50% 目标护甲。", stat: "5 伤 破50%" },
    { desc: "叠加 ×1.4，破甲 50%。",       stat: "7 伤 破50%" },
    { desc: "叠加 ×1.8，破甲 60%。",       stat: "9 伤 破60%" },
    { desc: "叠加 ×2.2，破甲 70%。",       stat: "11 伤 破70%" },
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
  equipSuit: "club",
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

// ♥ 偏生存防具：低血量受击大幅减半 + 战斗结束自动回血
const CROWN_OF_VITALITY: CardDef = {
  id: "crown_of_vitality",
  name: "生命之冠",
  category: "equipment",
  desc: "装备：受击 -1。HP < 30% 时受击额外减半。",
  equipKind: "armor",
  equipSuit: "heart",
  baseReduce: 1,
  equipEffects: (() => {
    const mk = (reduce: number, hpThreshold: number, halfMult: number) => ({
      desc: `受击 -${reduce}。HP < ${Math.round(hpThreshold * 100)}% 时受击额外 ×${halfMult}。`,
      stat: `-${reduce} 受击 危机×${halfMult}`,
      onTakeDamage: (c: BattleContext, d: number) => {
        let nd = Math.max(0, d - reduce);
        if (c.player.vita < c.player.vitaMax * hpThreshold) {
          nd = Math.floor(nd * halfMult);
          c.log(`生命之冠·危机：受击 ×${halfMult}（${d}→${nd}）。`, "player");
        }
        return nd;
      },
    });
    return [
      mk(1, 0.30, 0.6),
      mk(1, 0.35, 0.55),
      mk(2, 0.40, 0.50),
      mk(2, 0.50, 0.40),
    ] as [EquipEffect, EquipEffect, EquipEffect, EquipEffect];
  })(),
};

const SPIKE_ARMOR: CardDef = {
  id: "spike_armor",
  name: "反伤甲",
  category: "equipment",
  desc: "装备：受击反伤 3。",
  equipKind: "armor",
  equipSuit: "diamond",
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
  desc: "装备：受击 -4 / -5 / -7 / -9（叠加）。v5 去掉攻击 -1 副作用。",
  equipKind: "armor",
  equipSuit: "club",
  baseReduce: 4,
  equipEffects: [
    { desc: "受击 -4。", stat: "-4 受击",
      onTakeDamage: (_c, d) => Math.max(0, d - 4) },
    { desc: "受击 -5。", stat: "-5 受击",
      onTakeDamage: (_c, d) => Math.max(0, d - 5) },
    { desc: "受击 -7。", stat: "-7 受击",
      onTakeDamage: (_c, d) => Math.max(0, d - 7) },
    { desc: "受击 -9。", stat: "-9 受击",
      onTakeDamage: (_c, d) => Math.max(0, d - 9) },
  ],
};

// 新增防具（凑 8 件）

const MAGE_ROBE: CardDef = {
  id: "mage_robe",
  name: "法袍",
  category: "equipment",
  desc: "装备：受击 -1。出技能/道具时额外摸 1 张牌（持续过牌）。",
  equipKind: "armor",
  equipSuit: "club",
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
  equipSuit: "diamond",
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

// 重铠（rare）— v5 差异化：受击 + 反向"充能护盾"（受击后下回合开始 +N 临时护盾，攻防联动）
const FULL_PLATE: CardDef = {
  id: "full_plate",
  name: "重铠",
  category: "equipment",
  desc: "装备：受击 -5 / -7 / -9 / -12（叠加）。每次受击后累积反震护盾，下回合开始时释放为临时护盾。",
  equipKind: "armor",
  equipSuit: "club",
  baseReduce: 5,
  equipEffects: [
    { desc: "-5 受击 + 反震 +2 护盾 / 受击。", stat: "-5 受击 反震+2",
      onTakeDamage: (c, d) => {
        const ex = c.player.statuses.find(s => s.id === "shield_block");
        if (ex) ex.stacks += 2; else c.player.statuses.push({ id: "shield_block", name: "护盾", stacks: 2, duration: 1 });
        return Math.max(0, d - 5);
      } },
    { desc: "-7 受击 + 反震 +3 护盾 / 受击。", stat: "-7 受击 反震+3",
      onTakeDamage: (c, d) => {
        const ex = c.player.statuses.find(s => s.id === "shield_block");
        if (ex) ex.stacks += 3; else c.player.statuses.push({ id: "shield_block", name: "护盾", stacks: 3, duration: 1 });
        return Math.max(0, d - 7);
      } },
    { desc: "-9 受击 + 反震 +4 护盾 / 受击。", stat: "-9 受击 反震+4",
      onTakeDamage: (c, d) => {
        const ex = c.player.statuses.find(s => s.id === "shield_block");
        if (ex) ex.stacks += 4; else c.player.statuses.push({ id: "shield_block", name: "护盾", stacks: 4, duration: 1 });
        return Math.max(0, d - 9);
      } },
    { desc: "-12 受击 + 反震 +5 护盾 / 受击。", stat: "-12 受击 反震+5",
      onTakeDamage: (c, d) => {
        const ex = c.player.statuses.find(s => s.id === "shield_block");
        if (ex) ex.stacks += 5; else c.player.statuses.push({ id: "shield_block", name: "护盾", stacks: 5, duration: 1 });
        return Math.max(0, d - 12);
      } },
  ],
};

const SCALE_MAIL: CardDef = {
  id: "scale_mail",
  name: "鳞甲",
  category: "equipment",
  desc: "装备：受击 -2，反伤 2。减伤+反伤双修，介于盾与反伤甲之间。",
  equipKind: "armor",
  equipSuit: "diamond",
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

// 意念甲：闪避概率，叠加后提升（×1:10%, ×2:20%, ×3:30%, ×4:40%）
// 注：实际 dodge roll 走 battle.ts 统一的 getCurrentDodgeChance + damagePlayer hook，
// 这里 onTakeDamage 只做基础 -1 受击。叠加层数由 getCurrentDodgeChance 读取。
const MIND_ARMOR: CardDef = {
  id: "mind_armor",
  name: "意念甲",
  category: "equipment",
  desc: "防具：受击 -1。叠加增加完全闪避概率（10/20/30/40%）。",
  equipKind: "armor",
  equipSuit: "diamond",
  baseReduce: 1,
  equipEffects: [
    { desc: "受击 -1，闪避 +10%。", stat: "-1 受击 闪10%",
      onTakeDamage: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -1，闪避 +20%。", stat: "-1 受击 闪20%",
      onTakeDamage: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -1，闪避 +30%。", stat: "-1 受击 闪30%",
      onTakeDamage: (_c, d) => Math.max(0, d - 1) },
    { desc: "受击 -1，闪避 +40%。", stat: "-1 受击 闪40%",
      onTakeDamage: (_c, d) => Math.max(0, d - 1) },
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
  desc: "目标 +6 层中毒：每回合扣等同层数 HP（合计 21 伤害），每回合自动 -1 层。可叠加施放。",
  onPlay: (c) => { addStatus(c.target, "poison", "中毒", 6); c.log(`${c.target.name} 中毒 +6。`, "player"); },
};

const SK_BATTLE_CRY: CardDef = {
  id: "sk_battle_cry", name: "战吼", category: "skill", target: "self",
  desc: "本回合所有攻击 +3 伤。",
  onPlay: (c) => { addStatus(c.player, "battle_cry", "战吼", 1, 1); c.log("战吼！本回合攻击 +3。", "player"); },
};

const SK_FRENZY: CardDef = {
  id: "sk_frenzy", name: "激奋", category: "skill", target: "self",
  desc: "激活激奋：4 回合内每打出一张攻击牌后层数 +1，下次攻击额外 +2 × 层数伤害。",
  onPlay: (c) => {
    if (!c.player.statuses.find(s => s.id === "frenzy")) {
      addStatus(c.player, "frenzy", "激奋", 1, 4);  // duration 4 回合
      c.log("激奋激活！下张攻击 +2（持续 4 回合）。", "player");
    } else {
      c.log("激奋已激活，重复使用无效。", "system");
    }
  },
};

const SK_EVASIVE: CardDef = {
  id: "sk_evasive", name: "屏息", category: "skill", target: "self",
  desc: "本回合受到的伤害 -50%（与闪避概率不同：屏息减半，闪避跳过整次）。",
  onPlay: (c) => { addStatus(c.player, "evasive", "屏息", 1, 1); c.log("屏息：本回合伤害减半。", "player"); },
};

const SK_SILENCE: CardDef = {
  id: "sk_silence", name: "沉默", category: "skill", target: "single",
  desc: "目标下回合的 buff / 技能类招式被跳过（保留攻击）。",
  onPlay: (c) => { addStatus(c.target, "silenced", "沉默", 1, 1); c.log(`${c.target.name} 被沉默（buff/技能招式跳过）。`, "player"); },
};

const SK_FREEZE: CardDef = {
  id: "sk_freeze", name: "冰冻", category: "skill", target: "single",
  desc: "目标接下来 2 回合伤害 -50%。",
  onPlay: (c) => { addStatus(c.target, "frozen", "冰冻", 1, 2); c.log(`${c.target.name} 被冰冻 2 回合。`, "player"); },
};

const SK_REND: CardDef = {
  id: "sk_rend", name: "撕裂", category: "skill", target: "single",
  desc: "永久降低目标 2 点护甲（直接扣层数，扣到 0 为止）。",
  onPlay: (c) => {
    const before = c.target.armor ?? 0;
    const after = Math.max(0, before - 2);
    c.target.armor = after > 0 ? after : undefined;
    if (before > 0) c.log(`${c.target.name} 护甲 ${before} → ${after}（撕裂 -${before - after}）。`, "player");
    else c.log(`${c.target.name} 已无护甲，撕裂无效。`, "system");
  },
};

const SK_FOCUS: CardDef = {
  id: "sk_focus", name: "聚气", category: "skill", target: "self",
  desc: "立刻摸 2 张牌。",
  onPlay: (c) => { (c as any)._drawN = ((c as any)._drawN ?? 0) + 2; c.log("聚气：摸 2 张。", "player"); },
};

// 新增单体技能（凑 16 张单体）

const SK_AEGIS: CardDef = {
  id: "sk_aegis", name: "铁壁", category: "skill", target: "self",
  desc: "本回合获得护盾 (8 + 楼层) 吸收下次受到的伤害。",
  onPlay: (c) => {
    const shield = 8 + c.floor;
    addStatus(c.player, "shield_block", "护盾", shield);
    c.log(`铁壁：+${shield} 护盾。`, "player");
  },
};

// sk_charge 蓄力 — v5 直接删除（×2.5 + 2 回合 cost 在 1 攻/回规则下数学负值）

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
  desc: "自损 5% 生命上限，对目标造成其当前 HP 20% 的直接伤害。",
  onPlay: (c) => {
    const selfDmg = Math.max(1, Math.round(c.player.vitaMax * 0.05));
    c.player.vita = Math.max(0, c.player.vita - selfDmg);
    c.log(`爆裂术：自损 ${selfDmg} HP（5% 上限）。`, "player");
    const enemyDmg = Math.max(1, Math.round(c.target.hp * 0.20));  // v5 nerf：30% → 20%
    dealDirectDamage(c, c.target, enemyDmg);
  },
};

const SK_DBL_PUMMEL: CardDef = {
  id: "sk_dbl_pummel", name: "双重打击", category: "skill", target: "single",
  desc: "对目标造成 (4 + 楼层) 直伤，并使其易伤 2 回合（受伤 +50%）。",
  onPlay: (c) => {
    const dmg = 4 + c.floor;
    dealDirectDamage(c, c.target, dmg);
    addStatus(c.target, "vulnerable", "易伤", 1, 2);
    c.log(`${c.target.name} 易伤 2 回合 · 伤 ${dmg}。`, "player");
  },
};

// ─────────────────────────────────────────────────────────
// 花色操作技能（围绕花色克制构筑）
// ─────────────────────────────────────────────────────────

// 染色术：本回合所有攻击牌花色视为玩家手选花色
const SK_DYE: CardDef = {
  id: "sk_dye", name: "染色术", category: "skill", target: "self",
  desc: "本回合内所有攻击牌的花色视为你选定的花色。",
  onPlay: (c) => {
    (c as any)._suitPick = "dye";
    c.log("染色术：请选择本回合攻击牌花色。", "player");
  },
};

// 持咒：整场战斗内所有攻击牌视为指定花色（持续整场，染色术升级版）
const SK_CHANT: CardDef = {
  id: "sk_chant", name: "持咒", category: "skill", target: "self",
  desc: "本场战斗内所有攻击牌的花色永久视为你选定的花色（直到战斗结束）。",
  onPlay: (c) => {
    (c as any)._suitPick = "chant";
    c.log("持咒：请选择本场战斗攻击牌花色。", "player");
  },
};

// 共鸣咒：目标敌人花色变为玩家选定的花色，持续 4 回合后回归原色
const SK_ATTUNE: CardDef = {
  id: "sk_attune", name: "共鸣咒", category: "skill", target: "single",
  desc: "目标敌人花色变为你选定的花色，持续 4 回合后回归原色。",
  onPlay: (c) => {
    (c as any)._suitPick = "resonance";
    c.log(`共鸣咒：请选择 ${c.target.name} 变为的花色。`, "player");
  },
};

// 变色：目标花色变为玩家当前激活花色（不随机！可控的花色对位工具）
const SK_RECOLOR: CardDef = {
  id: "sk_recolor", name: "变色", category: "skill", target: "single",
  desc: "目标花色变为你当前激活的花色（用来对位 ♦ 闪避反弹 / ♥ 吸血克制等机制）。",
  onPlay: (c) => {
    // 玩家激活的花色（getActiveSpecialty 不在 ctx 里，用 attackSuit 或默认 spade）
    // 简化：取 player.statuses 里 active suit 或 fallback to first weapon equipSuit
    const wDef = c.player.weapons[0] ? CARD_DB[c.player.weapons[0].defId] : null;
    const newSuit = c.attackSuit ?? wDef?.equipSuit ?? "spade";
    c.target.suit = newSuit as Suit;
    c.log(`变色：${c.target.name} 花色变为 ${SUIT_SYMBOLS[newSuit as Suit]}（玩家激活色）。`, "player");
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
  desc: "对所有敌人造成各自 HP 上限 4% 的直伤（向上取整，下限 1）。",
  onPlay: (c) => {
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dmg = Math.max(1, Math.ceil(e.maxHp * 0.04));
      dealDirectDamage(c, e, dmg);
    }
  },
};

const SK_FIRE_WALL: CardDef = {
  id: "sk_fire_wall", name: "火墙", category: "skill", target: "all",
  desc: "所有敌人 +3 燃烧（每回合 -3，持续 3 回合）。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) addStatus(e, "burn", "燃烧", 3, 3); c.log("火墙：全体燃烧 +3。", "player"); },
};

const SK_SHOCKWAVE: CardDef = {
  id: "sk_shockwave", name: "震荡波", category: "skill", target: "all",
  desc: "对所有敌人造成 (5 + 楼层) 点伤害。",
  onPlay: (c) => {
    const dmg = 5 + c.floor;
    for (const e of c.enemies) if (e.alive) dealDirectDamage(c, e, dmg);
  },
};

const SK_GROUP_CURSE: CardDef = {
  id: "sk_group_curse", name: "群体诅咒", category: "skill", target: "all",
  desc: "所有敌人下次伤害减半。",
  onPlay: (c) => { for (const e of c.enemies) if (e.alive) addStatus(e, "frozen", "冰冻", 1, 1); c.log("全体被诅咒。", "player"); },
};

// 新增群攻技能（凑 8 张群攻）

const SK_SONIC: CardDef = {
  id: "sk_sonic", name: "音波", category: "skill", target: "all",
  desc: "对所有敌人造成 (6 + 楼层) 点伤害。",
  onPlay: (c) => {
    const dmg = 6 + c.floor;
    for (const e of c.enemies) if (e.alive) dealDirectDamage(c, e, dmg);
  },
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
  desc: "所有敌人 +(2 + 楼层/3) 中毒 + 易伤 2 回合。",
  onPlay: (c) => {
    const poisonStack = 2 + Math.floor(c.floor / 3);
    for (const e of c.enemies) if (e.alive) {
      addStatus(e, "poison", "中毒", poisonStack);
      addStatus(e, "vulnerable", "易伤", 1, 2);
    }
    c.log(`全体中毒 +${poisonStack} + 易伤 2 回合。`, "player");
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
  desc: "清除自身所有负面状态 + 摸 1 张牌。",
  onPlay: (c) => {
    const before = c.player.statuses.length;
    c.player.statuses = c.player.statuses.filter(s => ["battle_cry", "double_strike", "evasive", "shield_block", "reflect", "busi_triggered", "weapon_buff"].includes(s.id));
    if (c.player.statuses.length < before) c.log("驱毒剂：清除负面。", "player");
    // 没中毒也有价值：摸 1 张
    (c as any)._drawN = ((c as any)._drawN ?? 0) + 1;
    c.log("驱毒剂：摸 1 张。", "player");
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
  desc: "对目标造成 (5 + 楼层) 点直接伤害。",
  onPlay: (c) => dealDirectDamage(c, c.target, 5 + c.floor),
};

const IT_ELIXIR: CardDef = {
  id: "it_elixir", name: "强化药", category: "item", target: "self",
  desc: "本场战斗武器 +2 伤。",
  onPlay: (c) => { addStatus(c.player, "weapon_buff", "强化药", 2, -1); c.log("强化药：武器 +2 伤。", "player"); },
};

// 烟雾弹：临时闪避 buff
const IT_SMOKE: CardDef = {
  id: "it_smoke", name: "烟雾弹", category: "item", target: "self",
  desc: "5 回合内闪避概率 +30%。",
  onPlay: (c) => {
    addStatus(c.player, "smoke_dodge", "烟雾", 30, 5);
    c.log("烟雾弹：闪避 +30%（5 回合）。", "player");
  },
};

// 风步：下次受击必闪避（一次性）
const SK_STEP: CardDef = {
  id: "sk_step", name: "风步", category: "skill", target: "self",
  desc: "下一次受到伤害时必定闪避（一次性）。",
  onPlay: (c) => {
    addStatus(c.player, "guaranteed_dodge", "风步", 1, -1);
    c.log("风步：下次受击必闪避。", "player");
  },
};

// 穿甲射：下一次攻击无视全部护甲
const SK_PIERCE_SHOT: CardDef = {
  id: "sk_pierce_shot", name: "穿甲射", category: "skill", target: "self",
  desc: "下一次攻击牌无视目标全部护甲（一次性）。",
  onPlay: (c) => {
    addStatus(c.player, "pierce_next", "穿甲蓄势", 1, -1);
    c.log("穿甲射：下一击无视护甲。", "player");
  },
};

// ─────────────────────────────────────────────────────────
// 新增卡：填充 ♥ 吸血 / ♣ 魔法 / pierce / dodge / 控制 类
// ─────────────────────────────────────────────────────────

// ♥ 血契：消耗 5 HP → 本回合所有攻击吸血 +20%
const SK_BLOOD_PACT: CardDef = {
  id: "sk_blood_pact", name: "血契", category: "skill", target: "self",
  desc: "消耗 5 HP，本回合内所有攻击吸血 +20%。",
  attackSuit: undefined, defaultSuit: "heart",
  onPlay: (c) => {
    const cost = Math.min(5, c.player.vita - 1);
    if (cost <= 0) { c.log("血契：HP 不足。", "system"); return; }
    c.player.vita -= cost;
    addStatus(c.player, "blood_pact", "血契", 20, 1);
    c.log(`血契：自损 ${cost} HP，本回合吸血 +20%。`, "player");
  },
};

// ♥ 汲血斩（super_rare）：单体造目标当前 HP 35% 真伤 + 100% 转化为玩家 HP；下回合不能出攻击牌
const SK_DRAIN_STRIKE: CardDef = {
  id: "sk_drain_strike", name: "汲血斩", category: "skill", target: "single",
  desc: "对目标造成其当前 HP 25% 的真实伤害（无视护甲），伤害全部转为你的 HP；下两回合无法出攻击牌。",
  defaultSuit: "heart",
  onPlay: (c) => {
    // nerf：35% → 25% 真伤；下回合不能攻击 → 下两回合（cost ↑↑）
    const dmg = Math.max(1, Math.floor(c.target.hp * 0.25));
    c.target.hp = Math.max(0, c.target.hp - dmg);
    c.log(`汲血斩：${c.target.name} -${dmg}（真伤）。`, "player");
    if (c.target.hp <= 0) { c.target.alive = false; c.log(`★ 击败 ${c.target.name}！`, "win"); }
    const before = c.player.vita;
    c.player.vita = Math.min(c.player.vitaMax, c.player.vita + dmg);
    if (c.player.vita > before) c.log(`汲血：回 ${c.player.vita - before} HP。`, "player");
    addStatus(c.player, "no_attack", "蓄力中", 1, 2);
  },
};

// ♣ 奥术爆裂：本回合每出 1 张非攻击牌，下张攻击 +3（独立于法师杖/算计）
const SK_ARCANE_BURST: CardDef = {
  id: "sk_arcane_burst", name: "奥术爆裂", category: "skill", target: "self",
  desc: "本回合内每打出 1 张非攻击牌，下张攻击额外 +3 伤害。",
  defaultSuit: "club",
  onPlay: (c) => {
    addStatus(c.player, "arcane_burst", "奥术爆裂", 1, 1);
    c.log("奥术爆裂：本回合非攻击牌加成。", "player");
  },
};

// ♣ 心刃：单体造伤 = 本回合已出非攻击牌数 ×4
const SK_MIND_BLADE: CardDef = {
  id: "sk_mind_blade", name: "心刃", category: "skill", target: "single",
  desc: "对目标造成本回合已出非攻击牌数 ×4 的直接伤害（最少 1）。",
  defaultSuit: "club",
  onPlay: (c) => {
    const charge = c.player.statuses.find(s => s.id === "calc_charge");
    const stacks = charge?.stacks ?? 0;
    const dmg = Math.max(1, stacks * 4);
    dealDirectDamage(c, c.target, dmg);
  },
};

// 道具：速摸 — 消耗本回合不能再出技能 → 立刻摸 3 张
const IT_QUICK_DRAW: CardDef = {
  id: "it_quick_draw", name: "速摸", category: "item", target: "self",
  desc: "立刻摸 3 张牌；本回合内不能再出技能牌。",
  onPlay: (c) => {
    (c as any)._drawN = ((c as any)._drawN ?? 0) + 3;
    addStatus(c.player, "no_skill", "技能锁", 1, 1);
    c.log("速摸：摸 3 张，本回合不能再出技能。", "player");
  },
};

// 道具：药剂 — 本场战斗内每回合开始 +2 HP
const IT_BREW: CardDef = {
  id: "it_brew", name: "药剂", category: "item", target: "self",
  desc: "本场战斗内每回合开始时回复 2 HP。",
  onPlay: (c) => {
    addStatus(c.player, "brew_regen", "药剂", 2, -1);
    c.log("药剂：每回合开始 +2 HP。", "player");
  },
};

// ♠ 穿甲斩：本回合下张攻击 +3 pierce
const SK_PIERCE_STRIKE: CardDef = {
  id: "sk_pierce_strike", name: "穿甲斩", category: "skill", target: "self",
  desc: "本回合下张攻击额外 +(3 + 楼层/3) pierce（楼层缩放）。",
  defaultSuit: "spade",
  onPlay: (c) => {
    const bonus = 3 + Math.floor(c.floor / 3);
    addStatus(c.player, "pierce_bonus", "穿甲斩", bonus, 1);
    c.log(`穿甲斩就绪 +${bonus} pierce。`, "player");
  },
};

// ♦ 灵巧爆发：本回合闪避 +20%
const SK_EVASION_BURST: CardDef = {
  id: "sk_evasion_burst", name: "灵巧爆发", category: "skill", target: "self",
  desc: "本回合闪避概率 +20%。",
  defaultSuit: "diamond",
  onPlay: (c) => {
    addStatus(c.player, "smoke_dodge", "烟雾", 20, 1);  // 复用烟雾闪避 status
    c.log("灵巧爆发：闪避 +20%。", "player");
  },
};

// ♣ 恐惧术：目标下回合攻击伤害 -50%
const SK_FEAR: CardDef = {
  id: "sk_fear", name: "恐惧术", category: "skill", target: "single",
  desc: "目标恐惧（下回合攻击伤害 -50%），持续 1 回合。",
  defaultSuit: "club",
  onPlay: (c) => {
    addStatus(c.target, "fear", "恐惧", 1, 1);
    c.log(`${c.target.name} 陷入恐惧。`, "player");
  },
};

// ♥ AOE 吸血潮 (SR)：对全体造各自 maxHP 5% 直伤 + 全部转化为玩家 HP
const SK_DRAIN_WAVE: CardDef = {
  id: "sk_drain_wave", name: "吸血潮", category: "skill", target: "all",
  desc: "对全体敌人造 5% 各自 HP 上限 的直伤（向上取整），伤害总和转为你的 HP。",
  defaultSuit: "heart",
  onPlay: (c) => {
    let totalHeal = 0;
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dmg = Math.min(Math.max(1, Math.ceil(e.maxHp * 0.05)), e.hp);
      e.hp = Math.max(0, e.hp - dmg);
      totalHeal += dmg;
      c.log(`吸血潮：${e.name} -${dmg}。`, "player");
      if (e.hp <= 0) { e.alive = false; c.log(`★ 击败 ${e.name}！`, "win"); }
    }
    if (totalHeal > 0) {
      const before = c.player.vita;
      c.player.vita = Math.min(c.player.vitaMax, c.player.vita + totalHeal);
      if (c.player.vita > before) c.log(`吸血潮：回 ${c.player.vita - before} HP。`, "player");
    }
  },
};

// 道具：穿甲油 — 本场战斗武器永久 +2 pierce
const IT_PIERCE_OIL: CardDef = {
  id: "it_pierce_oil", name: "穿甲油", category: "item", target: "self",
  desc: "本场战斗内武器永久 +2 pierce。",
  onPlay: (c) => {
    addStatus(c.player, "pierce_perm", "穿甲油", 2, -1);
    c.log("穿甲油：武器 +2 pierce。", "player");
  },
};

// 特性：破甲专家 — 每张 +1 pierce（与洞察叠加）
const PERK_ARMOR_BREAK: CardDef = {
  id: "p_armor_break", name: "破甲专家", category: "perk",
  desc: "每张：所有攻击 +1 pierce。",
  defaultSuit: "spade",
  perkEffect: {
    unitDesc: "破甲 +1（每张，pierce 总线）",
    summary: (s) => `破甲 +${s}`,
    // pierce 在 battle.ts/calcAttackDamage 里统一汇总
  },
};

// ─────────────────────────────────────────────────────────
// EPIC 卡（5 张 · 极难抽到，但一抽到就改变跑酷走向）
// ─────────────────────────────────────────────────────────

// Epic 武器 1：王者之剑 — 顶级输出，无视护甲，全攻击 +30%
const EXCALIBUR: CardDef = {
  id: "excalibur", name: "王者之剑", category: "equipment",
  desc: "基础 10，破甲 = ⌈目标护甲 × 70%⌉（自适应），攻击 +30%。",
  equipKind: "weapon",
  equipSuit: "spade",
  baseDmg: 10,
  // v5 nerf：原 pierce 99（永远无视所有 armor）→ 改为动态 70% armor（boss armor 还剩 30%）
  // 实际 pierce 在 battle.ts calcAttackDamage 里特判（同 raider 模式）
  pierce: 0,
  equipEffects: [
    { desc: "基础 10，破甲 70% armor，攻击 +30%。", stat: "10 伤 破70% 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×1.4。", stat: "14 伤 破70% 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×1.8。", stat: "18 伤 破70% 攻+30%",
      onAttack: (_c, d) => Math.round(d * 1.30) },
    { desc: "叠加 ×2.2。", stat: "22 伤 破70% 攻+30%",
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

// Epic 群攻技能：众神之怒 — 全敌当前 HP 30% 直伤（nerf：50% → 30%，避免小怪秒杀 / boss 半血）
const SK_WRATH: CardDef = {
  id: "sk_wrath", name: "众神之怒", category: "skill", target: "all",
  desc: "所有存活敌人受到当前 HP 30% 直伤。",
  onPlay: (c) => {
    for (const e of c.enemies) {
      if (!e.alive) continue;
      const dmg = Math.max(1, Math.round(e.hp * 0.3));
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
  desc: "每张：完全闪避概率 +3%（叠加上限 50%）。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "闪避 +3%（每张，cap 50%）",
    summary: (s) => `闪避 +${Math.min(50, s * 3)}%`,
    // 闪避 roll 走 battle.ts 统一处理（getCurrentDodgeChance 读取 perk 层数）
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
  desc: "每张：暴击率 +5%（暴击伤害 ×2，可叠到 100%）。中毒会削减暴击率。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "暴击率 +5%（每张，×2 暴击伤；中毒削减）",
    summary: (s) => `${Math.min(100, s * 5)}% 暴击 ×2`,
    onDealDamage: (c, d, s) => {
      // 中毒削减：每 stack -3 百分点（cap -30）
      const poison = c.player.statuses.find(st => st.id === "poison");
      const penalty = poison ? Math.min(0.30, poison.stacks * 0.03) : 0;
      const chance = Math.max(0, Math.min(1, s * 0.05) - penalty);
      if (chance > 0 && Math.random() < chance) { c.log("暴击！×2", "player"); return d * 2; }
      return d;
    },
  },
};

const PERK_TOUGH: CardDef = {
  id: "p_tough", name: "强壮", category: "perk",
  desc: "每张：受击 -3%（叠加 cap 30%）。",
  defaultSuit: "club",
  perkEffect: {
    unitDesc: "受击伤害 -3%（每张，cap 30%）",
    summary: (s) => `受击 -${Math.min(30, s * 3)}%`,
    onTakeDamage: (_c, d, s) => Math.max(0, d * (1 - Math.min(0.30, 0.03 * s))),
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

// 疾风斩 ♦：本场战斗第 1 回合首次攻击 +10%（每张）
const PERK_SWIFT_STRIKE: CardDef = {
  id: "p_swift_strike", name: "疾风斩", category: "perk",
  desc: "每张：本场战斗第 1 回合首次攻击 +10%。",
  defaultSuit: "diamond",
  perkEffect: {
    unitDesc: "本场战斗第 1 回合首次攻击 +10%（每张）",
    summary: (s) => `第 1 回合首攻 +${s * 10}%`,
    onDealDamage: (c, d, s) => {
      // 第 1 回合 + 还没出过攻击牌的"本回合首次攻击"
      const used = c.player.statuses.find(st => st.id === "swift_first_used");
      if (c.turn === 1 && !used) {
        c.player.statuses.push({ id: "swift_first_used", name: "疾风触发", stacks: 1, duration: -1 });
        c.log(`疾风斩：第 1 回合首攻 +${s * 10}%。`, "player");
        return d * (1 + 0.10 * s);
      }
      return d;
    },
  },
};

// 血誓 ♥：受到伤害的 5% 转化为下次攻击 +X 伤（cap +6）
const PERK_BLOOD_PACT: CardDef = {
  id: "p_blood_pact", name: "血誓", category: "perk",
  desc: "每张：受到伤害的 5% 转化为下次攻击 +X 伤（cap +6 / 张）。",
  defaultSuit: "heart",
  perkEffect: {
    unitDesc: "受到伤害的 5% 转化为下次攻击 +X 伤（cap +6 / 张）",
    summary: (s) => `受击转化 ${s * 5}% → 攻击（cap +${s * 6}）`,
    onTakeDamage: (c, d, s) => {
      const add = Math.min(s * 6, Math.max(0, Math.floor(d * 0.05 * s)));
      if (add > 0) {
        const exists = c.player.statuses.find(st => st.id === "blood_pact_charge");
        if (exists) exists.stacks = Math.min(s * 6, exists.stacks + add);
        else c.player.statuses.push({ id: "blood_pact_charge", name: "血誓蓄势", stacks: add, duration: -1 });
        c.log(`血誓：吸收 ${add} 伤 → 下次攻击 +${add}。`, "player");
      }
      return d;
    },
    onDealDamage: (c, d, _s) => {
      const charge = c.player.statuses.find(st => st.id === "blood_pact_charge");
      if (charge && charge.stacks > 0) {
        const bonus = charge.stacks;
        c.player.statuses = c.player.statuses.filter(st => st.id !== "blood_pact_charge");
        c.log(`血誓蓄势：本次攻击 +${bonus}。`, "player");
        return d + bonus;
      }
      return d;
    },
  },
};

// 洞察：每张 pierce +1（与武器/附魔的 pierce 累加）
const PERK_INSIGHT: CardDef = {
  id: "p_insight", name: "洞察", category: "perk",
  desc: "每张：所有攻击破甲 +1（与武器/附魔/穿甲射叠加）。",
  defaultSuit: "spade",
  perkEffect: {
    unitDesc: "破甲 +1（每张）",
    summary: (s) => `破甲 +${s}`,
    // pierce 加成走 battle.ts/calcAttackDamage 统一汇总
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
  raider: RAIDER,
  blood_blade: BLOOD_BLADE,
  // 流派资源补全 v1（4 张）：♥ 武器 ×2 / ♠ 防具 ×1
  vampire_fang: VAMPIRE_FANG,
  lifebloom_staff: LIFEBLOOM_STAFF,
  knight_plate: KNIGHT_PLATE,
  // 流派资源补全 v2（9 张）：补齐 ♦/♣ common + 各花色 epic + ♠ 防具完整线
  flying_darts: FLYING_DARTS,
  shield_staff: SHIELD_STAFF,
  wind_blade: WIND_BLADE,
  everlast_fang: EVERLAST_FANG,
  forbidden_scepter: FORBIDDEN_SCEPTER,
  combat_belt: COMBAT_BELT,
  soulreaver_plate: SOULREAVER_PLATE,
  immortal_plate: IMMORTAL_PLATE,
  life_pouch: LIFE_POUCH,
  phantom_cloak: PHANTOM_CLOAK,
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
  crown_of_vitality: CROWN_OF_VITALITY,
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
  sk_weakening_bolt: SK_WEAKENING_BOLT,
  sk_shadow_strike: SK_SHADOW_STRIKE,
  sk_quick_draw: SK_QUICK_DRAW,
  sk_counter_stance: SK_COUNTER_STANCE,
  sk_blast: SK_BLAST,
  sk_dbl_pummel: SK_DBL_PUMMEL,
  // 花色操作（单体）
  sk_dye: SK_DYE,
  sk_chant: SK_CHANT,
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
  it_smoke: IT_SMOKE,
  sk_step: SK_STEP,
  sk_pierce_shot: SK_PIERCE_SHOT,
  // 新增 12 张
  sk_blood_pact: SK_BLOOD_PACT,
  sk_drain_strike: SK_DRAIN_STRIKE,
  sk_arcane_burst: SK_ARCANE_BURST,
  sk_mind_blade: SK_MIND_BLADE,
  it_quick_draw: IT_QUICK_DRAW,
  it_brew: IT_BREW,
  sk_pierce_strike: SK_PIERCE_STRIKE,
  sk_evasion_burst: SK_EVASION_BURST,
  sk_fear: SK_FEAR,
  sk_drain_wave: SK_DRAIN_WAVE,
  it_pierce_oil: IT_PIERCE_OIL,
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
  p_insight: PERK_INSIGHT,
  p_swift_strike: PERK_SWIFT_STRIKE,
  p_blood_pact: PERK_BLOOD_PACT,
  p_armor_break: PERK_ARMOR_BREAK,
};

// ─────────────────────────────────────────────────────────
// 稀有度集中表 · 给 CARD_DB 里的每张卡打 rarity
// 没标的默认 common（如 atk_*, short_sword, 起始牌组里的基础卡）
// ─────────────────────────────────────────────────────────
const _RARITY: Record<string, "rare" | "super_rare" | "epic"> = {
  // ── Rare（稳定的 build 件 / 解 buff / 群攻基础）──────────
  twin_blades: "rare", warhammer: "rare", battle_staff: "rare", chain_whip: "rare",
  raider: "rare", blood_blade: "rare",
  // 流派补全 v1：vampire_fang/knight_plate rare；lifebloom_staff super_rare
  vampire_fang: "rare", knight_plate: "rare", lifebloom_staff: "super_rare",
  // 流派补全 v2：花色×稀有度 补齐
  flying_darts: "rare", shield_staff: "rare",  // ♦/♣ common 武器位（设 rare 让池子均衡）
  wind_blade: "epic", everlast_fang: "epic", forbidden_scepter: "epic",  // ♦/♥/♣ epic 武器
  combat_belt: "rare", soulreaver_plate: "super_rare", immortal_plate: "epic",  // ♠ 防具完整线
  life_pouch: "super_rare", phantom_cloak: "epic",  // ♥ super_rare / ♦ epic 防具
  spike_armor: "rare", scale_mail: "rare", full_plate: "rare",
  crown_of_vitality: "rare",
  sk_blast: "rare", sk_shadow_strike: "rare", sk_dye: "rare", sk_attune: "rare", sk_chant: "super_rare",
  sk_pierce_shot: "rare", sk_frenzy: "super_rare",
  it_regroup: "rare", it_elixir: "rare", it_smoke: "rare",
  sk_chain_bolt: "rare", sk_fire_wall: "rare", sk_shockwave: "rare",
  sk_group_curse: "rare", sk_sonic: "rare", sk_mass_weak: "rare", sk_lightning: "rare",
  // 新增 11 张 rare/SR + 1 perk（PERK_POOL 也加）
  sk_blood_pact: "rare", sk_arcane_burst: "rare", sk_mind_blade: "rare",
  it_quick_draw: "rare", it_brew: "rare",
  sk_pierce_strike: "rare", sk_evasion_burst: "rare",
  sk_fear: "rare", sk_drain_wave: "super_rare",
  it_pierce_oil: "rare",
  // ── Super Rare（强力 build 核心 / 大招）─────────────────
  berserker_blade: "super_rare", wizard_staff: "super_rare", repeating_bow: "super_rare",
  mage_robe: "super_rare", mind_armor: "super_rare",
  sk_curse_blood: "super_rare", sk_rhythm: "super_rare", sk_time_stop: "super_rare",
  sk_curse_vortex: "super_rare", sk_chroma_wave: "super_rare",
  sk_step: "super_rare",
  sk_drain_strike: "super_rare",
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
  "blood_blade",
];
export const BUILD_ARMORS = [
  "spike_armor", "scale_mail", "full_plate", "mage_robe", "mind_armor",
  "crown_of_vitality",
];

export const STARTING_DECK_IDS: string[] = [
  // 21 攻击牌（♠ 多 1 张，对应起始短剑同花色）
  "atk_spade", "atk_spade", "atk_spade", "atk_spade", "atk_spade", "atk_spade",
  "atk_diamond", "atk_diamond", "atk_diamond", "atk_diamond", "atk_diamond",
  "atk_heart", "atk_heart", "atk_heart", "atk_heart", "atk_heart",
  "atk_club", "atk_club", "atk_club", "atk_club", "atk_club",
  // 6 技能（含 1 张染色术：保底前期能调整花色，避免因敌人花色克制走死）
  // 注：激奋已挪到奖励池（super_rare，不再起手就送）
  "sk_poison_blade", "sk_battle_cry", "sk_focus", "sk_evasive", "sk_rend",
  "sk_dye",
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
  // build 武器（9 = 原 7 + 破军 + 血裂刃）
  "twin_blades", "warhammer", "battle_staff", "chain_whip",
  "berserker_blade", "wizard_staff", "repeating_bow", "raider",
  "blood_blade",
  // build 防具（6）
  "spike_armor", "scale_mail", "full_plate", "mage_robe", "mind_armor",
  "crown_of_vitality",
  // 单体技能（24 = 22 + 风步 + 穿甲射）
  "sk_poison_blade", "sk_battle_cry", "sk_evasive", "sk_frenzy",
  "sk_silence", "sk_freeze", "sk_rend", "sk_focus",
  "sk_aegis", "sk_weakening_bolt", "sk_shadow_strike",  // sk_charge v5 删除
  "sk_quick_draw", "sk_counter_stance", "sk_blast", "sk_dbl_pummel",
  "sk_dye", "sk_attune", "sk_recolor", "sk_chant",
  "sk_curse_blood", "sk_rhythm", "sk_time_stop",
  "sk_step", "sk_pierce_shot",
  // 新增 9 张单体（含 SR 汲血斩）+ 3 张道具
  "sk_blood_pact", "sk_drain_strike", "sk_arcane_burst", "sk_mind_blade",
  "sk_pierce_strike", "sk_evasion_burst", "sk_fear",
  // 道具（10 = 原 7 + 速摸 + 药剂 + 穿甲油）
  "it_heal", "it_purify", "it_whetstone", "it_regroup", "it_bomb", "it_elixir", "it_smoke",
  "it_quick_draw", "it_brew", "it_pierce_oil",
  // 流派资源补全 v1（3 张）
  "vampire_fang",       // ♥ rare 武器
  "lifebloom_staff",    // ♥ super_rare 武器
  "knight_plate",       // ♠ rare 防具
  // 流派资源补全 v2（10 张）：花色×稀有度 补齐
  "flying_darts",       // ♦ rare 武器
  "shield_staff",       // ♣ rare 武器
  "combat_belt",        // ♠ rare 防具
  "soulreaver_plate",   // ♠ super_rare 防具
  "life_pouch",         // ♥ super_rare 防具
  // 攻击牌（atk_X）已移出奖励池 — 玩家从奖励里抽到攻击牌体验崩，攻击牌只在起始牌库
  // Epic（极稀有，需要 tier roll 命中才会出现）
  "excalibur", "divine_blade", "undying_heart", "sk_wrath", "it_echo",
  // 流派资源补全 v2 epic（5 张）：让 ♦/♥/♣ 也有 epic 武器，♠/♦ 有 epic 防具
  "wind_blade",        // ♦ epic 武器
  "everlast_fang",     // ♥ epic 武器
  "forbidden_scepter", // ♣ epic 武器
  "immortal_plate",    // ♠ epic 防具
  "phantom_cloak",     // ♦ epic 防具
];

// 第 3 关后追加的群攻技能（10 = 9 + 吸血潮）
export const REWARD_CARD_POOL_AOE = [
  "sk_chain_bolt", "sk_fire_wall", "sk_shockwave", "sk_group_curse",
  "sk_sonic", "sk_mass_weak", "sk_lightning", "sk_curse_vortex",
  "sk_chroma_wave",
  "sk_drain_wave",
];

// 注：奖励池抽卡已改为稀有度档驱动（rollRewardChoices/pickRarity），权重表已废弃。
// 第 1-2 关 it_purify 出现频率自动通过"稀有度均匀抽"控制（common 池里 1/22）。

export const PERK_POOL = [
  "p_bleed", "p_dodge", "p_regen", "p_crit", "p_tough",
  "p_vampire", "p_thorns", "p_iron_will", "p_lifetap",
  "p_overload", "p_executioner", "p_resonance", "p_coldblood", "p_insight",
  "p_swift_strike", "p_blood_pact", "p_armor_break",
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
// 楼层敏感：早期不出 Epic，中后期慢慢解锁
export function rarityWeights(floor: number): Record<CardRarity, number> {
  if (floor <= 2) return { common: 65, rare: 30, super_rare: 5,  epic: 0 };
  if (floor <= 5) return { common: 56, rare: 30, super_rare: 13, epic: 1 };
  if (floor <= 8) return { common: 51, rare: 30, super_rare: 17, epic: 2 };
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

// 花色操作牌（已拥有时仍允许出现，但权重通过 ownedFactor 自然衰减）
const SUIT_OPERATION_CARDS = new Set(["sk_dye", "sk_attune", "sk_chant", "sk_recolor"]);

// 关键 build 件（pierce / dodge）：早期 friendly，floor 越大加成越弱（衔接动态曲线）
const BUILD_KEY_CARDS = new Set([
  "sk_pierce_shot", "sk_pierce_strike", "p_insight", "p_armor_break", "it_pierce_oil",
  "sk_step", "sk_evasion_burst", "p_dodge", "mind_armor",
]);

// 流派对齐：return "with" / "neutral" / "against"
// 判定依据：cardSuit（attackSuit / equipSuit / defaultSuit）vs 玩家主流派
function cardAlignment(cardId: string, mainSuit: Suit | null): "with" | "neutral" | "against" {
  if (!mainSuit) return "neutral";
  const def = CARD_DB[cardId];
  if (!def) return "neutral";
  const cardSuit = def.attackSuit ?? def.equipSuit ?? def.defaultSuit;
  if (!cardSuit) return "neutral";
  if (cardSuit === mainSuit) return "with";
  // 反向：仅"色相反"算反向（红 vs 黑），让大部分 ♦/♥ 之间或 ♠/♣ 之间不算冲突
  const isRedMain = mainSuit === "heart" || mainSuit === "diamond";
  const isRedCard = cardSuit === "heart" || cardSuit === "diamond";
  if (isRedMain !== isRedCard) return "against";
  return "neutral";
}

// 已拥有衰减（平滑曲线）：非装备 N=0→1.0, 1→0.85, 2→0.65, 3→0.45, 4+→0.30
//                     装备   N=0→1.0, 1→1.0,  2→0.85, 3→0.70, 4+→0.50
function ownedFactor(cardId: string, ownedCount: number): number {
  const def = CARD_DB[cardId];
  const isEquip = def?.category === "equipment";
  const n = Math.min(4, ownedCount);
  if (isEquip) return [1.0, 1.0, 0.85, 0.70, 0.50][n];
  return [1.0, 0.85, 0.65, 0.45, 0.30][n];
}

// 牌库大小因子：膨胀越大 → 略压新卡（鼓励玩家精炼 build）
function sizeFactor(deckSize: number): number {
  if (deckSize > 50) return 0.85;
  if (deckSize > 40) return 0.95;
  return 1.0;
}

// 关键 build 件加权（随 floor 由强到弱）
function buildItemBoost(cardId: string, floor: number): number {
  if (!BUILD_KEY_CARDS.has(cardId)) return 1.0;
  if (floor <= 2) return 1.5;
  if (floor <= 5) return 1.3;
  return 1.1;
}

// 流派偏好加权（随 floor 由弱到强再到弱）
function alignmentMult(align: "with" | "neutral" | "against", floor: number): number {
  if (floor <= 2) return 1.0;  // 早期不引导
  if (floor <= 5) {
    if (align === "with") return 1.6;
    if (align === "against") return 0.5;
    return 1.0;
  }
  // floor 6+：温和
  if (align === "with") return 1.3;
  if (align === "against") return 0.8;
  return 1.0;
}

// 计算玩家"主流派"：取已拥有的同花色装备 + 同花色特性最多的那个
function getMainSuit(ownedCounts: Map<string, number>): Suit | null {
  const score: Record<Suit, number> = { spade: 0, diamond: 0, heart: 0, club: 0 };
  for (const [id, cnt] of ownedCounts) {
    const def = CARD_DB[id];
    if (!def || !cnt) continue;
    const s = def.equipSuit ?? def.defaultSuit;
    if (def.category === "equipment" && s) score[s] += cnt * 1.5;
    else if (def.category === "perk" && s) score[s] += cnt * 1.0;
  }
  const max = Math.max(...Object.values(score));
  if (max < 1.0) return null;  // 玩家还没明显倾向
  // 找出最高的
  for (const s of ["spade", "diamond", "heart", "club"] as Suit[]) {
    if (score[s] === max) return s;
  }
  return null;
}

// 单卡权重合成（用于在候选池里加权采样）
function computeCardWeight(
  cardId: string,
  ownedCounts: Map<string, number>,
  deckSize: number,
  floor: number,
  mainSuit: Suit | null,
): number {
  let w = 1.0;
  // 1. 装备类基础加权 ×1.5（仍然偏向装备出现）
  if (CARD_DB[cardId]?.category === "equipment") w *= 1.5;
  // 2. 已拥有衰减
  w *= ownedFactor(cardId, ownedCounts.get(cardId) ?? 0);
  // 3. 牌库大小压制
  w *= sizeFactor(deckSize);
  // 4. 关键 build 件加权（pierce/dodge）
  w *= buildItemBoost(cardId, floor);
  // 5. 流派偏好
  w *= alignmentMult(cardAlignment(cardId, mainSuit), floor);
  return Math.max(0.01, w);  // 别归 0，保留极小概率
}

function pickWeightedFromCandidatesV2(
  candidates: string[],
  ownedCounts: Map<string, number>,
  deckSize: number,
  floor: number,
  mainSuit: Suit | null,
): string {
  const items = candidates.map(id => ({
    id,
    w: computeCardWeight(id, ownedCounts, deckSize, floor, mainSuit),
  }));
  const total = items.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const it of items) {
    if ((r -= it.w) < 0) return it.id;
  }
  return items[items.length - 1].id;
}

/**
 * 关卡奖励抽卡：先 roll 每张候选的稀有度档，再从该档卡池里抽（无放回）
 * 多重权重：
 *   ownedFactor（已拥有数量衰减）× sizeFactor（牌库膨胀压制）×
 *   装备类 ×1.5 × buildItemBoost（关键 build 件随 floor 弱化）×
 *   alignmentMult（流派对齐随 floor 强化再弱化）
 * 一次奖励里同 defId 不会重复（used set）。装备保底 forceEquipment。
 */
export function rollRewardChoices(
  pool: string[],
  n: number,
  floor = 0,
  ownedCounts?: Map<string, number>,
  forceEquipment = false,
): CardInstance[] {
  const owned = ownedCounts ?? new Map();
  const deckSize = Array.from(owned.values()).reduce((s, x) => s + x, 0);
  const mainSuit = getMainSuit(owned);

  const byRarity: Record<CardRarity, string[]> = { common: [], rare: [], super_rare: [], epic: [] };
  for (const id of pool) {
    const r = (CARD_DB[id]?.rarity ?? "common") as CardRarity;
    byRarity[r].push(id);
  }
  const result: CardInstance[] = [];
  const used = new Set<string>();

  // 装备保底：第一张候选强制是装备
  if (forceEquipment) {
    const allEquip = pool.filter(id => CARD_DB[id]?.category === "equipment");
    if (allEquip.length > 0) {
      const pickedId = pickWeightedFromCandidatesV2(allEquip, owned, deckSize, floor, mainSuit);
      used.add(pickedId);
      result.push(makeInstance(pickedId, undefined, floor));
    }
  }

  // 优先抽，最多回退 1 档
  for (let i = result.length; i < n; i++) {
    let tier: CardRarity = pickRarity(floor);
    let candidates: string[];
    const order: CardRarity[] = ["epic", "super_rare", "rare", "common"];
    const startIdx = order.indexOf(tier);
    let pickedId: string | undefined;
    for (let j = startIdx; j < order.length && !pickedId; j++) {
      tier = order[j];
      candidates = byRarity[tier].filter(id => !used.has(id));
      if (candidates.length > 0) {
        pickedId = pickWeightedFromCandidatesV2(candidates, owned, deckSize, floor, mainSuit);
      }
    }
    if (pickedId) {
      used.add(pickedId);
      result.push(makeInstance(pickedId, undefined, floor));
    }
  }
  return result;
}

// 兼容旧引用（一些地方仍把 SUIT_OPERATION_CARDS 当判断）
export { SUIT_OPERATION_CARDS };

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
  // ── 普通附魔（5）─────────────────────────────────────────
  // 强袭（兽 ×3，♠ 特化）：HP < 50% 攻击 +N%（Lv1-5: 10/13/16/20/25）
  e_brawler: {
    id: "e_brawler",
    onAttack: (ctx, d) => {
      if (ctx.player.vita < ctx.player.vitaMax * 0.50) {
        const pct = getEnchantParam(ctx.player, 0);
        ctx.log(`强袭：绝境攻击 +${pct}%。`, "player");
        return d * (1 + pct / 100);
      }
      return d;
    },
  },
  // 算计（人型 ×3，♣ 特化）：每出 1 张非攻击牌，下张攻击 +2 伤
  // 标记型：calc_charge 由 battle.ts 统一累积；calcAttackDamage 检 weaponEnchant 决定每 stack 加成
  e_strategist: { id: "e_strategist" },
  // 收割（不死 ×3，♥ 特化）：击杀后下次攻击 ×(N/100)（Lv1-5: 1.20/1.30/1.40/1.50/1.65）
  e_reaper: {
    id: "e_reaper",
    onKill: (ctx, target) => {
      const exists = ctx.player.statuses.find(s => s.id === "e_reaper_buff");
      if (!exists) ctx.player.statuses.push({ id: "e_reaper_buff", name: "收割之刃", stacks: 1, duration: -1 });
      const mult = getEnchantParam(ctx.player, 0) / 100;
      ctx.log(`收割：击杀 ${target.name}，下次攻击 ×${mult.toFixed(2)}。`, "player");
    },
    onAttack: (ctx, d) => {
      const charge = ctx.player.statuses.find(s => s.id === "e_reaper_buff");
      if (charge) {
        ctx.player.statuses = ctx.player.statuses.filter(s => s.id !== "e_reaper_buff");
        const mult = getEnchantParam(ctx.player, 0) / 100;
        ctx.log(`收割之刃：本次攻击 ×${mult.toFixed(2)}。`, "player");
        return d * mult;
      }
      return d;
    },
  },
  // 撼地（巨怪 ×3，♠ 特化强档）：单击 ≥ 8% maxHP 时 +N%（Lv1-5: 15/18/22/26/32）
  e_titan: {
    id: "e_titan",
    onAttack: (ctx, d) => {
      if (d >= ctx.target.maxHp * 0.08) {
        const pct = getEnchantParam(ctx.player, 0);
        ctx.log(`撼地 +${pct}%！（${Math.floor(d)} ≥ ${Math.floor(ctx.target.maxHp * 0.08)}）`, "player");
        return d * (1 + pct / 100);
      }
      return d;
    },
  },
  // 幻影（暗影 ×3，♦ 特化强档）：闪避后 ×(N/100) + 易伤 +M（Lv1-5: ×1.5/+2, ×1.7/+2, ×2.0/+3, ×2.3/+3, ×2.6/+4）
  e_phantom: {
    id: "e_phantom",
    onAttack: (ctx, d) => {
      const charge = ctx.player.statuses.find(s => s.id === "phantom_charge");
      if (charge) {
        ctx.player.statuses = ctx.player.statuses.filter(s => s.id !== "phantom_charge");
        const mult = getEnchantParam(ctx.player, 0) / 100;
        const vulnStacks = getEnchantParam(ctx.player, 1);
        const v = ctx.target.statuses.find(s => s.id === "vulnerable");
        if (v) { v.stacks += vulnStacks; v.duration = Math.max(v.duration, 2); }
        else ctx.target.statuses.push({ id: "vulnerable", name: "易伤", stacks: vulnStacks, duration: 2 });
        ctx.log(`幻影残像：本次攻击 ×${mult.toFixed(1)} + 目标 +${vulnStacks} 易伤。`, "player");
        return d * mult;
      }
      return d;
    },
  },

  // ── 复合附魔（8）─────────────────────────────────────────
  // 战狂血誓（兽×2 + 巨怪×2，♠ 强化中档）
  // HP<50% 攻击 +N%；每损 10% maxHP 永久 +M atk（cap +K）
  // Lv1-5: (15,1,3) / (17,1,3) / (20,1,4) / (23,1,5) / (28,2,5)
  ec_warblood: {
    id: "ec_warblood",
    onAttack: (ctx, d) => {
      let bonus = 0;
      const perm = ctx.player.statuses.find(s => s.id === "warblood_perm_atk");
      if (perm) bonus += perm.stacks;
      const lowHp = ctx.player.vita < ctx.player.vitaMax * 0.50;
      const pct = getEnchantParam(ctx.player, 0);
      let res = d + bonus;
      if (lowHp) res *= (1 + pct / 100);
      if (bonus > 0 || lowHp) {
        ctx.log(`战狂血誓：${bonus > 0 ? `+${bonus} ` : ""}${lowHp ? `× ${(1 + pct / 100).toFixed(2)}（绝境）` : ""}。`, "player");
      }
      return res;
    },
  },
  // 重甲列阵（兽×2 + 人型×2，♠ 互补）
  // 攻击牌每打 1 张本回合受击 -1（cap -3）；本回合未受伤则下回合开局护盾 +5
  // 实装在 battle.ts：playAttack 里累积 phalanx_dr.stacks；damagePlayer 减伤；endPlayerTurn 检测 took_damage
  ec_phalanx: { id: "ec_phalanx" },
  // 风行步（暗影×2 + 巨怪×2，♦ 强化双稀少 / 究极）
  // 闪避 +10%；闪避后本回合再 +5%（cap +30%）；闪避后给目标 +1 易伤
  // 闪避 +10% 在 battle.ts/getCurrentDodgeChance；其余在 damagePlayer 触发
  ec_swift: { id: "ec_swift" },
  // 凝神（不死×2 + 人型×2，♦ 互补）
  // 每非攻击牌 +N 伤；伤害 ≥ M 时额外 +K
  // Lv1-5: (1,10,3) / (1,11,4) / (1,12,5) / (2,13,6) / (2,15,8)
  // 注：calc_charge 在 battle.ts 累积，每 stack 加成读 Lv 表 idx 0；这里只处理"≥M 时额外 +K"段
  ec_focus: {
    id: "ec_focus",
    onAttack: (ctx, d) => {
      const threshold = getEnchantParam(ctx.player, 1);
      const bonus = getEnchantParam(ctx.player, 2);
      if (d >= threshold) {
        ctx.log(`凝神：伤害 ≥ ${threshold}，+${bonus}。`, "player");
        return d + bonus;
      }
      return d;
    },
  },
  // 血祭仪（不死×2 + 暗影×2，♥ 强化中档）
  // 攻击吸血 +N%；满血 +M%（Lv1-5: 5/6, 6/8, 8/10, 10/13, 12/16）
  ec_lifesteal: {
    id: "ec_lifesteal",
    onAttack: (ctx, d) => {
      const lifesteal = getEnchantParam(ctx.player, 0) / 100;
      const fullHpBonus = getEnchantParam(ctx.player, 1) / 100;
      const heal = Math.max(0, Math.floor(d * lifesteal));
      if (heal > 0) {
        ctx.player.vita = Math.min(ctx.player.vitaMax, ctx.player.vita + heal);
        ctx.log(`血祭仪：吸血 ${heal}。`, "player");
      }
      if (ctx.player.vita >= ctx.player.vitaMax) {
        ctx.log(`血祭仪：HP 满，攻击 +${Math.round(fullHpBonus * 100)}%。`, "player");
        return d * (1 + fullHpBonus);
      }
      return d;
    },
  },
  // 守护契（兽×2 + 不死×2，♥ 互补）
  // 受击 -2；HP > 80% 受击再 -2；每回合 +1 HP
  // 实装：damagePlayer 检 weaponEnchant；endPlayerTurn 加血
  ec_resilient: { id: "ec_resilient" },
  // 秘法回响（人型×2 + 暗影×2，♣ 强化中档）
  // 每非攻击牌 +1 摸（cap 3）；染/咒在场首攻 +N%（Lv1-5: 20/25/30/38/45）
  ec_arcane: {
    id: "ec_arcane",
    onAttack: (ctx, d) => {
      const used = ctx.player.statuses.find(s => s.id === "arcane_first_used");
      if (used) return d;
      const hasChantOrDye = ctx.player.statuses.some(s =>
        s.id.startsWith("chanted_") || s.id.startsWith("dyed_"));
      if (hasChantOrDye) {
        const pct = getEnchantParam(ctx.player, 0);
        ctx.player.statuses.push({ id: "arcane_first_used", name: "秘法已触发", stacks: 1, duration: -1 });
        ctx.log(`秘法回响：染/咒在场，本场首攻 +${pct}%。`, "player");
        return d * (1 + pct / 100);
      }
      return d;
    },
  },
  // 符文护盾（人型×2 + 巨怪×2，♣ 互补中档）
  // 受击 -3；每场首次受击免疫；中毒/燃烧/出血对你无效
  // 实装：damagePlayer 减伤 + 免疫；newBattle 时给玩家 enc_runic_immune + enc_dot_immune
  ec_runic: { id: "ec_runic" },
};
