// 敌人生成 v0.10 · 完全随机
// makeEnemyGroupsForFloor(floor) 返回 EnemyState[][]：每个内层数组是一场战斗
//
// 设计：
//   - 敌人名字按种族 × 档位（normal/elite/boss）从名字池随机抽
//   - HP/伤害/护甲由楼层 + 档位 + 多人战分摊公式决定
//   - 招式从该种族的招式池随机抽 N 条，按楼层缩放数值
//   - 关卡组合用"位置规则"：第 1-2 关全普通；第 3+ 关末场必是精英或 Boss

import type { EnemyState, EnemyIntent, Suit, EnemyRace } from "./types.ts";
import { SUITS } from "./types.ts";

let _enemyUidCounter = 0;
function newEnemyId(name: string): string {
  return `e_${name}_${++_enemyUidCounter}`;
}

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─────────────────────────────────────────────────────────
// 名字池（按种族 × 档位）
// ─────────────────────────────────────────────────────────

const ENEMY_NAMES: Record<EnemyRace, { normal: string[]; elite: string[]; boss: string[] }> = {
  beast: {
    normal: ["地鼠", "野狼", "毒蛇", "蝙蝠", "野猪", "黑豹", "狂狼", "野熊", "巨鼠", "豺狗"],
    elite:  ["魔狼·首领", "巨爪熊王", "雷霆狼", "毒蛇王", "黑龙鳄", "霜熊", "影豹"],
    boss:   ["原初之兽", "九尾狐妖", "雷神之爪", "兽王"],
  },
  humanoid: {
    normal: ["哥布林", "强盗", "盗贼", "野蛮人", "异端兵", "佣兵", "刺客", "流浪者", "猎人", "异端徒"],
    elite:  ["盗贼头目", "佣兵队长", "黑暗骑士", "异端祭司", "野蛮酋长", "杀手"],
    boss:   ["哥布林王", "异端大主教", "黑暗骑士团长", "战团之王"],
  },
  undead: {
    normal: ["骷髅兵", "丧尸", "食尸鬼", "白骨", "墓守", "腐尸", "亡灵小兵", "幽魂", "干尸"],
    elite:  ["亡灵巫师", "骨王", "墓主", "黑暗法师", "鬼魅猎手", "亡魂祭司"],
    boss:   ["巫妖", "亡灵之主", "骨之王座", "死灵法师"],
  },
  giant: {
    normal: ["小巨人", "巨魔", "山地野人", "石头怪", "沼泽巨魔", "霜地野人"],
    elite:  ["石巨人", "战争巨人", "冰霜巨人", "石神巨人", "山岭哨兵"],
    boss:   ["山岳之主", "时间巨灵", "原始巨人", "霜山巨王"],
  },
  dark: {
    normal: ["影爪", "夜魔", "深渊兽", "暗影爪牙", "黑暗使者", "影魂"],
    elite:  ["暗影刺客", "暗影王子", "夜魔领主", "深渊使者", "影舞者"],
    boss:   ["黑龙", "深渊领主", "暗影之主", "无相之主"],
  },
};

// 精英 / Boss 特能 — 每种族 1 种，机制实装于 battle.ts
// 名字 + 描述都明确，不再是纯 flavor
export const ABILITY_BY_RACE: Record<EnemyRace, string> = {
  beast:    "嗜血",
  humanoid: "战吼",
  undead:   "不朽",
  giant:    "重甲护体",
  dark:     "致命一击",
};

export const ABILITY_DESCS: Record<string, string> = {
  "嗜血":     "自身 HP 低于 50% 时，所有攻击伤害 +30%。",
  "战吼":     "战斗开始时永久 +5 攻击值。",
  "不朽":     "HP 归 0 时复活到 50% HP，整局每只敌人仅 1 次。",
  "重甲护体": "护甲额外 +3（受击时多减 3 伤害，可被破甲穿透）。",
  "致命一击": "每次攻击 30% 概率暴击，造成 1.5× 伤害。",
};

// ─────────────────────────────────────────────────────────
// 招式池（按种族；baseValue 是楼层 1 标准，按楼层缩放）
// ─────────────────────────────────────────────────────────

interface IntentTemplate {
  type: "attack" | "buff" | "debuff";
  baseValue: number;          // 楼层 1 基线
  hits?: number;
  desc: string;
  debuffId?: string;
  debuffName?: string;
  debuffDuration?: number;
}

const INTENT_POOLS: Record<EnemyRace, IntentTemplate[]> = {
  beast: [
    { type: "attack", baseValue: 4, desc: "啃咬" },
    { type: "attack", baseValue: 5, desc: "撕咬" },
    { type: "attack", baseValue: 2.5, hits: 2, desc: "连咬" },
    { type: "attack", baseValue: 6, desc: "突袭" },
    { type: "buff",   baseValue: 0, desc: "嚎叫（+2 攻）" },
    { type: "debuff", baseValue: 2, desc: "獠牙伤", debuffId: "poison", debuffName: "中毒" },
  ],
  humanoid: [
    { type: "attack", baseValue: 4, desc: "挥砍" },
    { type: "attack", baseValue: 3, hits: 2, desc: "连斩" },
    { type: "attack", baseValue: 5, desc: "突刺" },
    { type: "attack", baseValue: 6, desc: "重击" },
    { type: "buff",   baseValue: 0, desc: "战吼" },
    { type: "debuff", baseValue: 3, desc: "断筋", debuffId: "weak", debuffName: "虚弱", debuffDuration: 2 },
    { type: "debuff", baseValue: 2, desc: "破甲", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
  ],
  undead: [
    { type: "attack", baseValue: 5, desc: "骨锤" },
    { type: "attack", baseValue: 3, hits: 2, desc: "骨爪" },
    { type: "attack", baseValue: 6, desc: "灵魂吸食" },
    { type: "debuff", baseValue: 4, desc: "凋零术", debuffId: "poison", debuffName: "中毒" },
    { type: "debuff", baseValue: 2, desc: "诅咒", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
    { type: "debuff", baseValue: 3, desc: "瘴气", debuffId: "weak", debuffName: "虚弱", debuffDuration: 2 },
  ],
  giant: [
    { type: "attack", baseValue: 7, desc: "巨拳" },
    { type: "attack", baseValue: 4, hits: 2, desc: "双拳" },
    { type: "attack", baseValue: 9, desc: "跺地震" },
    { type: "buff",   baseValue: 0, desc: "硬化（armor +1）" },
    { type: "debuff", baseValue: 3, desc: "砸碎", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
    { type: "attack", baseValue: 11, desc: "重击" },
  ],
  dark: [
    { type: "attack", baseValue: 5, desc: "暗影斩" },
    { type: "attack", baseValue: 3, hits: 2, desc: "影矛连射" },
    { type: "attack", baseValue: 7, desc: "黑闪" },
    { type: "attack", baseValue: 8, desc: "暗杀重击" },
    { type: "debuff", baseValue: 3, desc: "黑诅咒", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3 },
    { type: "debuff", baseValue: 4, desc: "腐血", debuffId: "poison", debuffName: "中毒" },
    { type: "buff",   baseValue: 0, desc: "暗影遁" },
  ],
};

// 种族属性偏向
const RACE_HP_MULT: Record<EnemyRace, number> = {
  beast: 0.85, humanoid: 1.0, undead: 1.05, giant: 1.4, dark: 1.15,
};
const RACE_SUIT_PREF: Record<EnemyRace, Suit> = {
  beast: "club", humanoid: "spade", undead: "spade", giant: "club", dark: "diamond",
};

// 楼层 → 可用种族（按战斗档位独立解锁）
// 设计：
//   - 普通战：稀少种族（巨怪/暗影）第 3 关起就能遇到，玩家想刷碎片可主动选
//   - 精英战：稀少种族晚 2 关解锁，避免低层精英 HP 暴涨
//   - Boss 战：稀少种族再晚 1 关，避免 floor 3 boss 被抽到 giant ×3.2 HP 这种
function getRaceWhitelist(floor: number, tier: "normal" | "elite" | "boss" = "normal"): EnemyRace[] {
  if (floor <= 2) return ["beast", "humanoid"];
  if (tier === "boss") {
    if (floor <= 5) return ["beast", "humanoid", "undead"];
    if (floor <= 7) return ["beast", "humanoid", "undead", "giant"];
    return ["beast", "humanoid", "undead", "giant", "dark"];
  }
  if (tier === "elite") {
    if (floor <= 4) return ["beast", "humanoid", "undead"];
    if (floor <= 6) return ["beast", "humanoid", "undead", "giant"];
    return ["beast", "humanoid", "undead", "giant", "dark"];
  }
  // normal：第 3 关起就有概率全 5 种族出现（让玩家能在普通战刷稀少碎片）
  return ["beast", "humanoid", "undead", "giant", "dark"];
}

// 在普通战里压低稀少种族出现率（避免第 3 关满地巨怪/暗影），
// 精英 / Boss 不压制（这俩档次本来就稀少 = 玩家想刷稀少碎片就主动选精英）
function getRaceWeightForTier(race: EnemyRace, tier: "normal" | "elite" | "boss"): number {
  if (tier === "normal") {
    // 普通战：兽 / 人型 / 不死 = 1.0，巨怪 / 暗影 = 0.35
    return (race === "giant" || race === "dark") ? 0.35 : 1.0;
  }
  // 精英 / Boss：等权重
  return 1.0;
}

function pickRaceWeighted(whitelist: EnemyRace[], tier: "normal" | "elite" | "boss"): EnemyRace {
  const weights = whitelist.map(r => getRaceWeightForTier(r, tier));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < whitelist.length; i++) {
    if ((r -= weights[i]) < 0) return whitelist[i];
  }
  return whitelist[whitelist.length - 1];
}

// ─────────────────────────────────────────────────────────
// 数值公式
// ─────────────────────────────────────────────────────────

// 楼层 1 标准 HP；每关 +25%
function baseHpForFloor(floor: number): number {
  return 22 * Math.pow(1.25, floor - 1);
}
// 攻击数值随楼层 +18% 每关
function scaleAttack(baseValue: number, floor: number, tier: "normal" | "elite" | "boss"): number {
  let v = baseValue * (1 + (floor - 1) * 0.18);
  if (tier === "elite") v *= 1.20;
  if (tier === "boss")  v *= 1.45;
  return Math.max(1, Math.round(v));
}
// 楼层防具：第 5 关起 +1，每关 +1
function armorForFloor(floor: number, tier: "normal" | "elite" | "boss", race: EnemyRace): number {
  let armor = 0;
  if (floor >= 5) armor += floor - 4;
  if (race === "giant") armor += 1;
  if (race === "undead") armor += 1;
  if (tier === "elite") armor += 1;
  if (tier === "boss")  armor += 2;
  return armor;
}
// 武器倍率（第 4 关起敌人"装备武器"）
function weaponMultForFloor(floor: number): number | undefined {
  if (floor < 4) return undefined;
  return 1.0 + (floor - 4) * 0.10 + (floor >= 6 ? 0.20 : 0);
}

// ─────────────────────────────────────────────────────────
// 招式生成：从池里抽 N 条，按楼层缩放
// ─────────────────────────────────────────────────────────

function generateIntents(race: EnemyRace, floor: number, tier: "normal" | "elite" | "boss"): EnemyIntent[] {
  const pool = INTENT_POOLS[race];
  const count = tier === "boss" ? Math.min(6, 4 + Math.floor(floor / 4))
              : tier === "elite" ? 4
              : Math.min(3, 2 + Math.floor(floor / 3));

  // 抽 count 条，强制至少 60% 是攻击类
  const attacks = pool.filter(i => i.type === "attack");
  const others  = pool.filter(i => i.type !== "attack");
  const minAttacks = Math.max(1, Math.ceil(count * 0.6));
  const picked: IntentTemplate[] = [];
  const aShuf = [...attacks].sort(() => Math.random() - 0.5);
  for (let i = 0; i < minAttacks && i < aShuf.length; i++) picked.push(aShuf[i]);
  const remaining = count - picked.length;
  const oShuf = [...others, ...aShuf.slice(minAttacks)].sort(() => Math.random() - 0.5);
  for (let i = 0; i < remaining && i < oShuf.length; i++) picked.push(oShuf[i]);

  // 洗牌（避免攻击都堆在前面）
  picked.sort(() => Math.random() - 0.5);

  return picked.map(t => ({
    type: t.type,
    value: t.type === "attack" || t.type === "debuff"
      ? scaleAttack(t.baseValue, floor, tier)
      : 0,
    hits: t.hits,
    desc: t.desc,
    debuffId: t.debuffId,
    debuffName: t.debuffName,
    debuffDuration: t.debuffDuration,
  }));
}

// ─────────────────────────────────────────────────────────
// 单个敌人生成
// ─────────────────────────────────────────────────────────

interface BuildOpts {
  floor: number;
  tier: "normal" | "elite" | "boss";
  race?: EnemyRace;        // 不传则随机
  groupSize?: number;      // 多人战每个 HP 减少
  hpMultOverride?: number; // 特殊调整（如 boss 不被多人战分摊）
}

function buildRandomEnemy(opts: BuildOpts): EnemyState {
  const whitelist = getRaceWhitelist(opts.floor, opts.tier);
  const race = opts.race ?? pickRaceWeighted(whitelist, opts.tier);
  const tier = opts.tier;

  // 名字
  const namePool = ENEMY_NAMES[race][tier];
  const name = rand(namePool);

  // HP
  let hp = baseHpForFloor(opts.floor) * RACE_HP_MULT[race];
  if (tier === "elite") hp *= 1.6;
  if (tier === "boss")  hp *= 3.2;
  if (opts.groupSize && opts.groupSize > 1) {
    hp = hp / (1 + (opts.groupSize - 1) * 0.5);
  }
  if (opts.hpMultOverride) hp *= opts.hpMultOverride;
  hp = Math.max(8, Math.round(hp));

  // 花色：30% 跟随种族倾向，70% 随机
  const suit: Suit = Math.random() < 0.3
    ? RACE_SUIT_PREF[race]
    : rand(SUITS);

  // 招式
  const intents = generateIntents(race, opts.floor, tier);

  // 武器/护甲
  const wm = weaponMultForFloor(opts.floor);
  if (wm) {
    // 把攻击招式的 value 再乘 weaponMult
    for (const i of intents) {
      if (i.type === "attack") i.value = Math.max(1, Math.round(i.value * wm));
    }
  }
  // 多怪战每个怪攻击 -X%（避免 2-3 个全威力怪一起打玩家爆死）
  if (opts.groupSize && opts.groupSize > 1) {
    const attackMult = 1 / (1 + (opts.groupSize - 1) * 0.45);
    // 2 怪：每个 ~69% 攻击；3 怪：每个 ~53%
    for (const i of intents) {
      if (i.type === "attack" || i.type === "debuff") {
        i.value = Math.max(1, Math.round(i.value * attackMult));
      }
    }
  }
  let armor = armorForFloor(opts.floor, tier, race);

  // 特能（每种族固定 1 种，机制实装：嗜血/战吼/不朽/重甲护体/致命一击）
  const eliteAbility = tier !== "normal" ? ABILITY_BY_RACE[race] : undefined;

  // 实装：战吼 — 战斗开始即所有攻击招式 +5（永久 buff）
  if (eliteAbility === "战吼") {
    for (const i of intents) {
      if (i.type === "attack") i.value += 5;
    }
  }
  // 实装：重甲护体 — 额外 +3 armor
  if (eliteAbility === "重甲护体") {
    armor += 3;
  }

  // Boss 招式从随机位置开始（不再固定 0）
  const intentIndex = tier === "boss"
    ? Math.floor(Math.random() * intents.length)
    : 0;

  return {
    id: newEnemyId(name),
    name,
    hp,
    maxHp: hp,
    suit,
    race,
    intents,
    intentIndex,
    statuses: [],
    alive: true,
    armor: armor > 0 ? armor : undefined,
    weaponMult: wm,
    tier,
    eliteAbility,
  };
}

// ─────────────────────────────────────────────────────────
// 关卡组合：3 场战斗
// 第 1-2 关：3 普通（关 1 单体，关 2 单体）
// 第 3 关起：2 普通 + 1 精英；每 3 关末场是 Boss（3、6、9...）
// 中间偶尔来一场多人小怪战（30% 概率，第 2 关起）
// ─────────────────────────────────────────────────────────

export function makeEnemyGroupsForFloor(floor: number): EnemyState[][] {
  const isBossFloor = floor % 3 === 0;
  const groups: EnemyState[][] = [];

  // 第 1 场：普通（偶尔多人小怪）
  if (floor >= 2 && Math.random() < 0.3) {
    // 多人小怪战：2-3 个低 HP 普通
    const size = Math.random() < 0.5 ? 2 : 3;
    const arr: EnemyState[] = [];
    for (let i = 0; i < size; i++) {
      arr.push(buildRandomEnemy({ floor, tier: "normal", groupSize: size }));
    }
    groups.push(arr);
  } else {
    groups.push([buildRandomEnemy({ floor, tier: "normal" })]);
  }

  // 第 2 场：普通（or 多人）
  if (floor >= 3 && Math.random() < 0.25) {
    const size = 2;
    groups.push([
      buildRandomEnemy({ floor, tier: "normal", groupSize: size }),
      buildRandomEnemy({ floor, tier: "normal", groupSize: size }),
    ]);
  } else {
    groups.push([buildRandomEnemy({ floor, tier: "normal" })]);
  }

  // 第 3 场：关 1-2 普通；关 3+ 精英；每 3 关末场是 Boss
  if (floor <= 2) {
    groups.push([buildRandomEnemy({ floor, tier: "normal" })]);
  } else if (isBossFloor) {
    groups.push([buildRandomEnemy({ floor, tier: "boss" })]);
  } else {
    groups.push([buildRandomEnemy({ floor, tier: "elite" })]);
  }

  return groups;
}
