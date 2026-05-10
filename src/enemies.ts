// 敌人定义 v0.9
// makeEnemyGroupsForFloor(floor) 返回 EnemyState[][]：
//   每个内层数组是"一场战斗"的敌人组合（1 关 3 场战斗）

import type { EnemyState, EnemyIntent, Suit, EnemyRace } from "./types.ts";
import { SUITS } from "./types.ts";

let _enemyUidCounter = 0;
function newEnemyId(name: string): string {
  return `e_${name}_${++_enemyUidCounter}`;
}

function randomSuit(): Suit {
  return SUITS[Math.floor(Math.random() * SUITS.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface EnemyTemplate {
  name: string;
  hp: number;
  intents: EnemyIntent[];
  suit?: Suit;
  race: EnemyRace;
  armor?: number;
  tier?: "normal" | "elite" | "boss";
  eliteAbility?: string;     // 精英特能简述（显示用）
}

// ── 关 1 敌人（HP +30%） ─────────────────────────────────

const T_RAT: EnemyTemplate = {
  name: "地鼠",
  hp: 16,
  suit: "club",
  race: "beast",
  intents: [
    { type: "attack", value: 3, desc: "啃咬 ⚔️ 3" },
    { type: "attack", value: 2, hits: 2, desc: "连咬 ⚔️ 2×2" },
  ],
};

const T_GOBLIN: EnemyTemplate = {
  name: "哥布林",
  hp: 21,
  suit: "spade",
  race: "humanoid",
  intents: [
    { type: "attack", value: 4, desc: "挥砍 ⚔️ 4" },
    { type: "attack", value: 3, desc: "乱打 ⚔️ 3" },
    { type: "buff", value: 0, desc: "怒吼 (下次 +3)" },
  ],
};

const T_BANDIT: EnemyTemplate = {
  name: "强盗",
  hp: 26,
  suit: "diamond",
  race: "humanoid",
  intents: [
    { type: "attack", value: 5, desc: "盗刃 ⚔️ 5" },
    { type: "attack", value: 3, hits: 2, desc: "连刺 ⚔️ 3×2" },
  ],
};

// ── 关 2 敌人（HP +30%）────────────────────────────────

const T_WOLF: EnemyTemplate = {
  name: "野狼",
  hp: 26,
  suit: "heart",
  race: "beast",
  intents: [
    { type: "attack", value: 4, desc: "撕咬" },
    { type: "attack", value: 3, hits: 2, desc: "连咬" },
    { type: "debuff", value: 2, desc: "嚎叫", debuffId: "weak", debuffName: "虚弱", debuffDuration: 2 },
  ],
};

const T_KOBOLD: EnemyTemplate = {
  name: "科博德",
  hp: 34,
  suit: "club",
  race: "humanoid",
  intents: [
    { type: "attack", value: 5, desc: "刺击" },
    { type: "attack", value: 3, hits: 2, desc: "双刺" },
    { type: "debuff", value: 3, desc: "毒针", debuffId: "poison", debuffName: "中毒" },
    { type: "buff", value: 0, desc: "怒吼" },
  ],
};

const T_SKELETON: EnemyTemplate = {
  name: "骷髅兵",
  hp: 42,
  suit: "spade",
  race: "undead",
  intents: [
    { type: "attack", value: 6, desc: "骨锤" },
    { type: "attack", value: 4, hits: 2, desc: "骨爪" },
    { type: "debuff", value: 1, desc: "诅咒", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
  ],
};

// ── 关 3：群战 / boss（HP +30%） ───────────────────────

const T_GOBLIN_GRUNT: EnemyTemplate = {
  name: "哥布林兵",
  hp: 18,
  suit: "spade",
  race: "humanoid",
  intents: [
    { type: "attack", value: 2, desc: "戳刺 ⚔️ 2" },
    { type: "attack", value: 3, desc: "猛挥 ⚔️ 3" },
  ],
};

// 兽人首领已被 BOSS_GOBLIN_KING 替代，保留备用

const T_RAT_SWARM: EnemyTemplate = {
  name: "鼠群成员",
  hp: 16,
  suit: "club",
  race: "beast",
  intents: [
    { type: "attack", value: 2, desc: "啃咬 ⚔️ 2" },
    { type: "attack", value: 1, hits: 2, desc: "连咬 ⚔️ 1×2" },
  ],
};

// ── 关 4+ 敌人（HP +30%） ────────────────────────────

const T_GHOUL: EnemyTemplate = {
  name: "食尸鬼",
  hp: 65,
  suit: "heart",
  race: "undead",
  armor: 1,
  intents: [
    { type: "attack", value: 7, desc: "撕咬" },
    { type: "attack", value: 5, hits: 2, desc: "狂啃" },
    { type: "debuff", value: 4, desc: "腐蚀", debuffId: "poison", debuffName: "中毒" },
    { type: "debuff", value: 2, desc: "凝视", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
  ],
};

const T_TROLL: EnemyTemplate = {
  name: "巨魔",
  hp: 91,
  suit: "spade",
  race: "giant",
  armor: 2,
  intents: [
    { type: "attack", value: 9, desc: "重拳" },
    { type: "buff", value: 0, desc: "咆哮" },
    { type: "attack", value: 6, hits: 2, desc: "连击" },
    { type: "debuff", value: 3, desc: "震慑", debuffId: "weak", debuffName: "虚弱", debuffDuration: 2 },
  ],
};

const T_DARK_KNIGHT: EnemyTemplate = {
  name: "黑暗骑士",
  hp: 111,
  suit: "diamond",
  race: "dark",
  armor: 3,
  intents: [
    { type: "attack", value: 10, desc: "黑剑" },
    { type: "attack", value: 6, hits: 2, desc: "双斩" },
    { type: "buff", value: 0, desc: "黑怒" },
    { type: "debuff", value: 3, desc: "黑诅咒", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3 },
    { type: "debuff", value: 5, desc: "腐血", debuffId: "poison", debuffName: "中毒" },
  ],
};

// ─────────────────────────────────────────────────────────
// 精英敌人（HP +50%、1 个特能、攻击值 ×1.2）
// ─────────────────────────────────────────────────────────

const T_ELITE_DIRE_WOLF: EnemyTemplate = {
  name: "魔狼·首领",
  hp: 60,
  suit: "club",
  race: "beast",
  tier: "elite",
  eliteAbility: "嗜血",
  intents: [
    { type: "attack", value: 8, desc: "魔噬" },
    { type: "attack", value: 5, hits: 2, desc: "撕咬连击" },
    { type: "buff", value: 0, desc: "嗜血咆哮 (+3 攻)" },
  ],
};

const T_ELITE_NECROMANCER: EnemyTemplate = {
  name: "亡灵巫师",
  hp: 70,
  suit: "spade",
  race: "undead",
  tier: "elite",
  eliteAbility: "黑魔法环",
  armor: 1,
  intents: [
    { type: "debuff", value: 4, desc: "凋零术", debuffId: "poison", debuffName: "中毒" },
    { type: "attack", value: 9, desc: "黑闪" },
    { type: "debuff", value: 2, desc: "死亡凝视", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3 },
    { type: "attack", value: 6, hits: 2, desc: "亡爪" },
  ],
};

const T_ELITE_GOLEM: EnemyTemplate = {
  name: "石巨人",
  hp: 95,
  suit: "club",
  race: "giant",
  tier: "elite",
  eliteAbility: "重甲护体",
  armor: 4,
  intents: [
    { type: "attack", value: 11, desc: "巨拳" },
    { type: "attack", value: 7, hits: 2, desc: "双拳" },
    { type: "buff", value: 0, desc: "硬化（armor +2）" },
  ],
};

const T_ELITE_SHADOW: EnemyTemplate = {
  name: "暗影刺客",
  hp: 65,
  suit: "spade",
  race: "dark",
  tier: "elite",
  eliteAbility: "突袭",
  intents: [
    { type: "attack", value: 7, hits: 2, desc: "双刃突袭" },
    { type: "buff", value: 0, desc: "影遁" },
    { type: "attack", value: 14, desc: "暗杀重击" },
    { type: "debuff", value: 2, desc: "毒刃", debuffId: "poison", debuffName: "中毒" },
  ],
};

// ─────────────────────────────────────────────────────────
// Boss（每 3 关一个，第 3/6/9 关末场）
// ─────────────────────────────────────────────────────────

const BOSS_GOBLIN_KING: EnemyTemplate = {
  name: "哥布林王",
  hp: 130,
  suit: "club",
  race: "humanoid",
  tier: "boss",
  eliteAbility: "Boss · 3 阶段",
  armor: 2,
  intents: [
    { type: "attack", value: 9, desc: "王者一击" },
    { type: "attack", value: 5, hits: 2, desc: "连斩" },
    { type: "buff", value: 0, desc: "号令援军" },
    { type: "debuff", value: 4, desc: "击碎", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2 },
    { type: "attack", value: 13, desc: "怒吼斩击" },
  ],
};

const BOSS_LICH: EnemyTemplate = {
  name: "巫妖",
  hp: 200,
  suit: "spade",
  race: "undead",
  tier: "boss",
  eliteAbility: "Boss · 群体诅咒",
  armor: 3,
  intents: [
    { type: "debuff", value: 6, desc: "腐烂诅咒", debuffId: "poison", debuffName: "中毒" },
    { type: "attack", value: 12, desc: "灵魂火焰" },
    { type: "debuff", value: 3, desc: "灵魂枯萎", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3 },
    { type: "attack", value: 8, hits: 2, desc: "亡爪连击" },
    { type: "buff", value: 0, desc: "亡灵之力" },
    { type: "attack", value: 18, desc: "终焉爆裂" },
  ],
};

const BOSS_DRAGON: EnemyTemplate = {
  name: "黑龙",
  hp: 280,
  suit: "diamond",
  race: "dark",
  tier: "boss",
  eliteAbility: "Boss · 龙息",
  armor: 5,
  intents: [
    { type: "attack", value: 16, desc: "黑龙息" },
    { type: "attack", value: 10, hits: 2, desc: "双爪" },
    { type: "debuff", value: 5, desc: "灼烧", debuffId: "poison", debuffName: "中毒" },
    { type: "buff", value: 0, desc: "龙之怒" },
    { type: "attack", value: 24, desc: "毁灭龙息" },
    { type: "debuff", value: 4, desc: "龙瞳", debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3 },
  ],
};

// ─────────────────────────────────────────────────────────
// 构建
// ─────────────────────────────────────────────────────────

function buildEnemy(
  tpl: EnemyTemplate,
  scale = 1.0,
  weaponMult = 1.0,
  extraArmor = 0,
): EnemyState {
  const hp = Math.round(tpl.hp * scale);
  return {
    id: newEnemyId(tpl.name),
    name: tpl.name,
    hp,
    maxHp: hp,
    suit: tpl.suit ?? randomSuit(),
    race: tpl.race,
    intents: tpl.intents.map(i => ({
      ...i,
      value: Math.round(i.value * (i.type === "attack" ? scale * weaponMult : scale)),
    })),
    intentIndex: 0,
    statuses: [],
    alive: true,
    armor: (tpl.armor ?? 0) + extraArmor,
    weaponMult: weaponMult > 1.0 ? weaponMult : undefined,
    tier: tpl.tier ?? "normal",
    eliteAbility: tpl.eliteAbility,
  };
}

// 一关 = 3 场战斗
// 节奏：1-2 关全普通；3 关 BOSS 替代收尾；4-5 关末场是精英；6 关再 BOSS；7+ 关精英为主，每 3 关末场必是 BOSS
export function makeEnemyGroupsForFloor(floor: number): EnemyState[][] {
  if (floor === 1) {
    return shuffle([T_RAT, T_GOBLIN, T_BANDIT]).map(t => [buildEnemy(t)]);
  }
  if (floor === 2) {
    return shuffle([T_WOLF, T_KOBOLD, T_SKELETON]).map(t => [buildEnemy(t)]);
  }
  if (floor === 3) {
    // 第 3 关：2 普通 + 1 BOSS（哥布林王）— T_ORC_BOSS 退役为精英级展示
    return [
      [buildEnemy(T_GOBLIN_GRUNT), buildEnemy(T_GOBLIN_GRUNT)],
      [buildEnemy(T_RAT_SWARM), buildEnemy(T_RAT_SWARM), buildEnemy(T_RAT_SWARM)],
      [buildEnemy(BOSS_GOBLIN_KING)],
    ];
  }
  if (floor === 4) {
    // 第 4 关：2 普通 + 1 精英末场
    return [
      [buildEnemy(T_GHOUL, 1.0, 1.3)],
      [buildEnemy(T_TROLL, 1.0, 1.3)],
      [buildEnemy(pickElite(), 1.0, 1.3)],
    ];
  }
  if (floor === 5) {
    // 第 5 关：2 普通 + 1 精英
    const scale = 1.25, wm = 1.4;
    return [
      [buildEnemy(T_DARK_KNIGHT, scale, wm, 1)],
      [buildEnemy(T_GHOUL, scale, wm, 1)],
      [buildEnemy(pickElite(), scale, wm, 1)],
    ];
  }
  if (floor === 6) {
    // 第 6 关：1 普通 + 1 精英 + BOSS（巫妖）
    const scale = 1.5, wm = 1.5;
    return [
      [buildEnemy(T_TROLL, scale, wm, 2)],
      [buildEnemy(pickElite(), scale, wm, 2)],
      [buildEnemy(BOSS_LICH, 1.0, 1.0, 0)],
    ];
  }

  // 第 7+ 关
  const scale = 1 + 0.25 * (floor - 4);
  const weaponMult = 1.3 + 0.1 * (floor - 5);
  const extraArmor = floor - 4;
  const isBossFloor = floor % 3 === 0;  // 9/12/15... 是 BOSS 收尾
  return [
    [buildEnemy(T_DARK_KNIGHT, scale, weaponMult, extraArmor)],
    [buildEnemy(pickElite(), scale, weaponMult, extraArmor)],
    isBossFloor
      ? [buildEnemy(pickBoss(floor), 1.0 + (floor - 9) * 0.15, 1.0, 0)]
      : [buildEnemy(pickElite(), scale * 1.2, weaponMult * 1.1, extraArmor + 1)],
  ];
}

const ELITE_POOL = [T_ELITE_DIRE_WOLF, T_ELITE_NECROMANCER, T_ELITE_GOLEM, T_ELITE_SHADOW];
const BOSS_POOL = [BOSS_GOBLIN_KING, BOSS_LICH, BOSS_DRAGON];

function pickElite(): EnemyTemplate {
  return ELITE_POOL[Math.floor(Math.random() * ELITE_POOL.length)];
}
function pickBoss(floor: number): EnemyTemplate {
  // 楼层越高轮换出更强的 boss
  const idx = Math.min(BOSS_POOL.length - 1, Math.floor((floor - 6) / 3));
  return BOSS_POOL[idx];
}
