// 像素塔 v0.8 - Deck-builder 重构
// 卡牌系统：手牌 + 牌库 + 弃牌堆
// 常驻区：特性 + 武器（一款，可叠 4） + 防具（一款，可叠 4）

export type Suit = "spade" | "diamond" | "heart" | "club";
export const SUIT_SYMBOLS: Record<Suit, string> = {
  spade: "♠", diamond: "♦", heart: "♥", club: "♣",
};
export const SUITS: Suit[] = ["spade", "diamond", "heart", "club"];

export function isRedSuit(s: Suit): boolean {
  return s === "diamond" || s === "heart";
}

// 花色专精档位名 + 大招名（4 字短语）
export const SUIT_TIER_NAMES: Record<Suit, { tier1: string; tier2: string; tier3: string; ult: string }> = {
  spade:   { tier1: "锋锐怒涛", tier2: "破甲狂攻", tier3: "斩魂蓄势", ult: "狂战之击" },
  diamond: { tier1: "灵动闪步", tier2: "灵巧连击", tier3: "幻影成形", ult: "影舞步" },
  heart:   { tier1: "生机涌动", tier2: "绝境吸血", tier3: "生命之泉", ult: "生命洪流" },
  club:    { tier1: "魔法庇护", tier2: "护体真言", tier3: "禁咒蓄能", ult: "群体禁咒" },
};

// 各档与大招的具体效果描述（v3 强化版 — 花色构筑 fantasy 才能立稳）
export const SUIT_TIER_DESCS: Record<Suit, { tier1: string; tier2: string; tier3: string; ult: string }> = {
  spade: {
    tier1: "攻击 +10%；额外 5% 概率暴击 ×2；激活『锐利』keyword — 所有 ♠ 攻击 +1 pierce。",
    tier2: "破甲 +当前楼层数；真伤 +3。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "对当前目标造成其当前 HP 50% 的真实伤害（无视护甲）。",
  },
  diamond: {
    tier1: "闪避 +8%；受击反弹 +3 伤害；激活『迅捷』keyword — 所有 ♦ 攻击 25% 概率额外 +1 hit（与 T2 叠加）。",
    tier2: "攻击 40% 概率额外 +1 hit（叠加 ♦ 迅捷）。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "本回合敌人攻击全部闪避，下次攻击 hits ×3。",
  },
  heart: {
    tier1: "每回合开始 +2 HP；攻击吸血 8%；激活『贪婪』keyword — 所有 ♥ 攻击 + ♥ 装备 吸血 +5%。",
    tier2: "HP <50% 受击 -35%；HP <25% 攻击 +30%。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "HP 回满，永久 maxHP +5。",
  },
  club: {
    tier1: "受击 -2；激活『守序』keyword — 每出 1 张 ♣ 牌本回合 +1 临时护盾。",
    tier2: "受击再 -3（共 -5）。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "对全体敌人 +3 沉默 +3 易伤 +3 中毒。",
  },
};

// 花色主题色（统一从 types 出，main.ts 复用）
export const SUIT_THEMES: Record<Suit, { name: string; color: string }> = {
  spade:   { name: "黑桃", color: "#e6e6e6" },
  diamond: { name: "方块", color: "#ff8a8a" },
  heart:   { name: "红心", color: "#ff5e5e" },
  club:    { name: "梅花", color: "#aaffc3" },
};

// ── 全局常量 ──────────────────────────────────────────────
export const SLOT_CAP = 4;          // 武器/防具最多叠 4 张
export const HAND_LIMIT = 10;       // 手牌上限
export const STARTING_HAND = 6;     // 起手摸牌
export const DRAW_PER_TURN = 2;     // 每回合摸牌
export const STARTING_VITA = 40;
export const FIGHTS_PER_FLOOR = 3;

export const STARTER_PERK_COUNT = 3;
export const STARTER_PERK_POOL_SIZE = 9;
export const REWARD_CHOICE_COUNT = 3;

// ── 卡牌分类 ──────────────────────────────────────────────
export type CardCategory =
  | "attack"      // 攻击牌（4 花色）
  | "skill"       // 技能牌（即时效果）
  | "item"        // 道具牌（即时效果）
  | "equipment"   // 装备牌（手牌出 → 进常驻武器/防具槽）
  | "perk";       // 特性（常驻被动）

export type EquipmentKind = "weapon" | "armor";
export type TargetMode = "single" | "all" | "self" | "none";

export type LogKind = "player" | "enemy" | "system" | "win" | "lose";

export interface LogEntry {
  msg: string;
  kind: LogKind;
}

export interface StatusEffect {
  id: string;
  name: string;
  duration: number;  // -1 = 永久（手动清除）
  stacks: number;
}

// ── 状态元数据（用于 UI 上色 + tooltip） ─────────────────
export type StatusKind = "buff" | "debuff" | "neutral";

export interface StatusMeta {
  name: string;
  desc: string;
  kind: StatusKind;
}

export const STATUS_META: Record<string, StatusMeta> = {
  // 玩家 buff
  battle_cry:     { name: "战吼", desc: "本回合所有攻击 +3 伤。", kind: "buff" },
  double_strike:  { name: "倍击", desc: "下一张攻击伤害 ×2。", kind: "buff" },
  evasive:        { name: "屏息", desc: "本回合受到伤害减半（与闪避概率是不同机制：屏息不会跳过伤害，而是减半）。", kind: "buff" },
  sharpened:      { name: "磨刀", desc: "下一张攻击伤害 ×1.5。", kind: "buff" },
  weapon_buff:    { name: "强化药", desc: "本场战斗武器伤害 +stacks。", kind: "buff" },
  shield_block:   { name: "护盾", desc: "吸收下次受到的 stacks 点伤害。", kind: "buff" },
  shadow_double:  { name: "影袭", desc: "下一张攻击连击 2 次。", kind: "buff" },
  heavy_strike:   { name: "猛击就绪", desc: "下一张攻击伤害 +10。", kind: "buff" },
  counter_stance: { name: "反击姿态", desc: "本回合受击反弹 50% 伤害给攻击者。", kind: "buff" },
  busi_triggered: { name: "已豁免", desc: "本场战斗已触发不死意志。", kind: "neutral" },

  // 玩家 debuff
  poison:     { name: "中毒", desc: "每回合开始受 stacks 点伤害，stacks 减 1。副作用：暴击率 -stacks × 3%（cap -30%）。", kind: "debuff" },
  weak:       { name: "虚弱", desc: "攻击造成的伤害 -stacks。", kind: "debuff" },
  vulnerable: { name: "易伤", desc: "受到的伤害 +50%。", kind: "debuff" },

  // 染色 buff（4 个花色独立 status，本回合攻击牌强制视为该花色）
  dyed_spade:   { name: "染色♠", desc: "本回合攻击牌视为黑桃。", kind: "buff" },
  dyed_diamond: { name: "染色♦", desc: "本回合攻击牌视为方块。", kind: "buff" },
  dyed_heart:   { name: "染色♥", desc: "本回合攻击牌视为红心。", kind: "buff" },
  dyed_club:    { name: "染色♣", desc: "本回合攻击牌视为梅花。", kind: "buff" },

  // 持咒 buff（整场战斗持续，攻击牌永久视为该花色）
  chanted_spade:   { name: "持咒♠", desc: "本场战斗内攻击牌视为黑桃。", kind: "buff" },
  chanted_diamond: { name: "持咒♦", desc: "本场战斗内攻击牌视为方块。", kind: "buff" },
  chanted_heart:   { name: "持咒♥", desc: "本场战斗内攻击牌视为红心。", kind: "buff" },
  chanted_club:    { name: "持咒♣", desc: "本场战斗内攻击牌视为梅花。", kind: "buff" },
  chanted_used:    { name: "本场已持咒", desc: "本场战斗内已经触发过持咒，所有持咒副本灰显不可用，下场战斗自动恢复。", kind: "neutral" },

  // 花色专精大招触发的临时 buff
  dodge_full_round: { name: "影舞步", desc: "本回合敌人攻击全部闪避。", kind: "buff" },
  triple_strike:    { name: "三连击", desc: "下次攻击 hits ×3。", kind: "buff" },

  // 敌人 debuff（玩家身上也可能有）
  burn:       { name: "燃烧", desc: "每回合 -stacks HP，持续 duration 回合（纯扣血）。", kind: "debuff" },
  rend:       { name: "撕裂", desc: "（已废弃）现在撕裂直接扣 armor。", kind: "debuff" },
  frozen:     { name: "冰冻", desc: "下回合行动伤害减半。", kind: "debuff" },
  silenced:   { name: "沉默", desc: "下回合无法 buff。", kind: "debuff" },
  bleed:      { name: "出血", desc: "每回合扣当前 HP × stacks × 5%。施加在玩家身上时副作用：闪避率 -stacks × 5%（cap -50%）。", kind: "debuff" },
  attuned:    { name: "已共鸣", desc: "花色被共鸣咒改变，剩余 duration 回合后回归原色。", kind: "neutral" },
  fear:       { name: "恐惧", desc: "本回合攻击伤害 -50%。", kind: "debuff" },

  // 新增技能/道具 buff
  blood_pact:    { name: "血契", desc: "本回合内所有攻击吸血 +20%。", kind: "buff" },
  arcane_burst:  { name: "奥术爆裂", desc: "本回合每张非攻击牌使下张攻击 +3。", kind: "buff" },
  brew_regen:    { name: "药剂", desc: "本场战斗内每回合开始 +stacks HP。", kind: "buff" },
  no_skill:      { name: "技能锁", desc: "本回合不能再出技能牌（速摸副作用）。", kind: "neutral" },
  pierce_bonus:  { name: "穿甲斩", desc: "下张攻击额外 +stacks pierce（用一次清除）。", kind: "buff" },
  pierce_perm:   { name: "穿甲油", desc: "本场战斗内武器永久 +stacks pierce。", kind: "buff" },

  // 持续/延时类玩家 buff
  frenzy:        { name: "激奋", desc: "每打出 1 张攻击牌后 stacks +1，下次攻击 +stacks × 5 伤。", kind: "buff" },
  charged:       { name: "蓄力", desc: "下次攻击伤害 ×3（用一次清除）。", kind: "buff" },
  no_attack:     { name: "蓄力中", desc: "本回合无法出攻击牌。", kind: "neutral" },
  combat_rhythm: { name: "战斗节奏", desc: "本回合内每打 1 张牌额外摸 1 张。", kind: "buff" },
  time_stop:     { name: "时停", desc: "敌人下一回合无法行动（DoT 仍结算）。", kind: "buff" },

  // 闪避 / 穿甲系统
  smoke_dodge:      { name: "烟雾", desc: "闪避概率 +stacks%，剩余 duration 回合。", kind: "buff" },
  guaranteed_dodge: { name: "风步", desc: "下一次受击必定闪避（一次性）。", kind: "buff" },
  pierce_next:      { name: "穿甲蓄势", desc: "下一次攻击无视目标全部护甲（一次性）。", kind: "buff" },
  phantom_charge:   { name: "幻影残像", desc: "下一次攻击伤害 ×2（一次性，由幻影附魔触发）。", kind: "buff" },
  echo:             { name: "复读", desc: "本场战斗：每出 1 张非攻击牌后复制一份回手牌。", kind: "buff" },

  // 附魔机制相关 status（v2 附魔系统）
  phalanx_dr:        { name: "重甲列阵", desc: "本回合每张攻击牌使受击 -1（cap -3，由附魔触发）。", kind: "buff" },
  swift_dodge_temp:  { name: "风行余势", desc: "本回合内闪避概率 +stacks%，由风行步附魔触发。", kind: "buff" },
  enc_runic_immune:  { name: "符文护盾", desc: "本场战斗第 1 次受击免疫（由符文护盾附魔提供）。", kind: "buff" },
  enc_dot_immune:    { name: "圣化", desc: "中毒 / 燃烧 / 出血对你无效（由符文护盾附魔提供）。", kind: "buff" },
  warblood_perm_atk: { name: "血誓积累", desc: "本场战斗：每损 10% maxHP，攻击 +1（cap +5，由战狂血誓附魔触发）。", kind: "buff" },
};

// ── 敌人种族 ──────────────────────────────────────────────
export type EnemyRace = "beast" | "humanoid" | "undead" | "giant" | "dark";

export const RACE_NAMES: Record<EnemyRace, string> = {
  beast: "兽",
  humanoid: "人型",
  undead: "不死",
  giant: "巨怪",
  dark: "暗影",
};

export const FRAGMENT_NAMES: Record<EnemyRace, string> = {
  beast: "兽魂",
  humanoid: "灵魂石",
  undead: "怨念",
  giant: "巨魂",
  dark: "暗影碎片",
};

export const FRAGMENT_ICONS: Record<EnemyRace, string> = {
  beast: "🐾",
  humanoid: "💎",
  undead: "👻",
  giant: "🗿",
  dark: "🌑",
};

export const RACES: EnemyRace[] = ["beast", "humanoid", "undead", "giant", "dark"];

// ── 附魔系统 v2（5 普通 + 8 复合 = 13 个）────────────────
// 设计宗旨：附魔是中后期"补全 / 特化 build"的层级，单件数值控制在 15-30%
// 普通附魔（人/兽/不死）单种族 ×3 → ~15% 增益
// 稀少附魔（巨怪/暗影）单种族 ×3 → ~25% 增益（强档）
// 复合附魔 = 2 种族×2 碎片；含稀少 = 中档；双稀少 = 究极
export type EnchantId =
  // 普通（5）：单种族 ×3
  | "e_brawler"      // 兽 ×3 — ♠ 特化
  | "e_strategist"   // 人型 ×3 — ♣ 特化
  | "e_reaper"       // 不死 ×3 — ♥ 特化
  | "e_titan"        // 巨怪 ×3 — ♠ 特化（强档）
  | "e_phantom"      // 暗影 ×3 — ♦ 特化（强档）
  // 复合（8）：2 种族 ×2+×2
  | "ec_warblood"    // 兽×2 + 巨怪×2 — ♠ 强化
  | "ec_phalanx"     // 兽×2 + 人型×2 — ♠ 互补
  | "ec_swift"       // 暗影×2 + 巨怪×2 — ♦ 强化（双稀少 / 究极）
  | "ec_focus"       // 不死×2 + 人型×2 — ♦ 互补
  | "ec_lifesteal"   // 不死×2 + 暗影×2 — ♥ 强化
  | "ec_resilient"   // 兽×2 + 不死×2 — ♥ 互补
  | "ec_arcane"      // 人型×2 + 暗影×2 — ♣ 强化
  | "ec_runic";      // 人型×2 + 巨怪×2 — ♣ 互补

export const ENCHANT_NAMES: Record<EnchantId, string> = {
  e_brawler:    "强袭",
  e_strategist: "算计",
  e_reaper:     "收割",
  e_titan:      "撼地",
  e_phantom:    "幻影",
  ec_warblood:  "战狂血誓",
  ec_phalanx:   "重甲列阵",
  ec_swift:     "风行步",
  ec_focus:     "凝神",
  ec_lifesteal: "血祭仪",
  ec_resilient: "守护契",
  ec_arcane:    "秘法回响",
  ec_runic:     "符文护盾",
};

export const ENCHANT_DESCS: Record<EnchantId, string> = {
  e_brawler:    "HP < 50% 时，攻击 +12%。",
  e_strategist: "每出 1 张非攻击牌，下张攻击 +2 伤（同回合累积，攻击后清零）。",
  e_reaper:     "击杀敌人后，下次攻击伤害 ×1.5（一次性）。",
  e_titan:      "单次伤害 ≥ 敌人最大 HP 8% 时，本次伤害额外 +25%。",
  e_phantom:    "完全闪避后下次攻击 ×2，攻击命中后给目标 +3 易伤层。",
  ec_warblood:  "HP < 50% 时攻击 +20%；本场战斗内每损 10% maxHP 永久攻击 +1（cap +5）。",
  ec_phalanx:   "本回合攻击牌每打 1 张受击 -1（cap -3）；本回合未受伤则下回合开局护盾 +5。",
  ec_swift:     "闪避概率额外 +10%；闪避后本回合内闪避再 +5%（cap +30%）；闪避后给当前目标 +1 易伤。",
  ec_focus:     "每张非攻击牌使下张攻击 +1 伤；攻击伤害 ≥ 12 时额外 +5。",
  ec_lifesteal: "攻击吸血额外 +8%；HP 满时攻击 +10%。",
  ec_resilient: "受击 -2；HP > 80% 时受击再 -2；每回合开始 +1 HP。",
  ec_arcane:    "每出 1 张非攻击牌额外摸 1 张（每回合 cap 3）；持咒/染色 buff 在场时首次攻击 +30%。",
  ec_runic:     "受击 -3；每场战斗第 1 次受击免疫；中毒/燃烧/出血对你无效。",
};

// 附魔配方
export interface EnchantRecipe {
  kind: "single" | "composite";
  cost: Partial<Record<EnemyRace, number>>;
  branch: Suit;                              // 流派归属（UI 分组用）
  variant: "specialize" | "complement";      // 强化 / 互补
  hasRare: boolean;                          // 含稀少种族（巨怪/暗影）→ 强档
  doubleRare?: boolean;                      // 双稀少（究极）
}

export const ENCHANT_RECIPES: Record<EnchantId, EnchantRecipe> = {
  // 普通附魔（5）
  e_brawler:    { kind: "single",    cost: { beast:    3 }, branch: "spade",   variant: "specialize", hasRare: false },
  e_strategist: { kind: "single",    cost: { humanoid: 3 }, branch: "club",    variant: "specialize", hasRare: false },
  e_reaper:     { kind: "single",    cost: { undead:   3 }, branch: "heart",   variant: "specialize", hasRare: false },
  e_titan:      { kind: "single",    cost: { giant:    3 }, branch: "spade",   variant: "specialize", hasRare: true  },
  e_phantom:    { kind: "single",    cost: { dark:     3 }, branch: "diamond", variant: "specialize", hasRare: true  },
  // 复合附魔（8）
  ec_warblood:  { kind: "composite", cost: { beast:    2, giant: 2    }, branch: "spade",   variant: "specialize", hasRare: true  },
  ec_phalanx:   { kind: "composite", cost: { beast:    2, humanoid: 2 }, branch: "spade",   variant: "complement", hasRare: false },
  ec_swift:     { kind: "composite", cost: { dark:     2, giant: 2    }, branch: "diamond", variant: "specialize", hasRare: true,  doubleRare: true },
  ec_focus:     { kind: "composite", cost: { undead:   2, humanoid: 2 }, branch: "diamond", variant: "complement", hasRare: false },
  ec_lifesteal: { kind: "composite", cost: { undead:   2, dark: 2     }, branch: "heart",   variant: "specialize", hasRare: true  },
  ec_resilient: { kind: "composite", cost: { beast:    2, undead: 2   }, branch: "heart",   variant: "complement", hasRare: false },
  ec_arcane:    { kind: "composite", cost: { humanoid: 2, dark: 2     }, branch: "club",    variant: "specialize", hasRare: true  },
  ec_runic:     { kind: "composite", cost: { humanoid: 2, giant: 2    }, branch: "club",    variant: "complement", hasRare: true  },
};

export const ENCHANTS: EnchantId[] = [
  "e_brawler", "e_strategist", "e_reaper", "e_titan", "e_phantom",
  "ec_warblood", "ec_phalanx", "ec_swift", "ec_focus",
  "ec_lifesteal", "ec_resilient", "ec_arcane", "ec_runic",
];

// 稀少种族集合（用于 UI 标记 + 配方校验）
export const RARE_RACES: EnemyRace[] = ["giant", "dark"];
export function isRareRace(race: EnemyRace): boolean {
  return race === "giant" || race === "dark";
}

// 卡牌稀有度 4 档：抽卡先 roll 稀有度，再从该档卡池里抽具体卡
// common 普通 / rare 稀有 / super_rare 超稀有 / epic 史诗
export type CardRarity = "common" | "rare" | "super_rare" | "epic";

// 每档稀有度的中文显示名 + 颜色 token
export const RARITY_NAMES: Record<CardRarity, string> = {
  common: "普通",
  rare: "稀有",
  super_rare: "超稀有",
  epic: "史诗",
};

// ── 战斗上下文 ────────────────────────────────────────────
export interface BattleContext {
  player: PlayerState;
  enemies: EnemyState[];
  target: EnemyState;        // 当前选中的目标敌人
  turn: number;
  log: (msg: string, kind?: LogKind) => void;
  attackSuit?: Suit;         // 当前打出的攻击牌花色（用于伤害公式）
  slotScale: number;         // 武器叠加倍率（计算时设置）
  floor: number;             // 当前楼层，用于技能/道具数值缩放
}

// ── 装备效果 / 特性效果（4 级叠加） ─────────────────────
export interface EquipEffect {
  desc: string;
  stat?: string;
  // 武器：每次攻击触发的额外效果（穿甲、吸血等）
  onAttack?: (ctx: BattleContext, dmg: number) => number;
  // 防具：受击触发
  onTakeDamage?: (ctx: BattleContext, dmg: number) => number;
  // 通用：每回合开始
  onTurnStart?: (ctx: BattleContext) => void;
  // 武器：影响出牌后的处理（笨重武器扣伤等）
  postAttack?: (ctx: BattleContext, dmg: number) => number;
}

// 特性 PerkEffect：单一效果定义，按当前叠加张数（stacks）线性缩放，无叠加上限
export interface PerkEffect {
  unitDesc: string;                                      // 每张单位效果（图鉴）
  summary?: (stacks: number) => string;                  // 当前总效果摘要（数据面板）
  onTurnStart?: (ctx: BattleContext, stacks: number) => void;
  onDealDamage?: (ctx: BattleContext, dmg: number, stacks: number) => number;
  onTakeDamage?: (ctx: BattleContext, dmg: number, stacks: number) => number;
}

// ── 卡牌定义（统一接口，靠 category 区分必填字段） ──
export interface CardDef {
  id: string;
  name: string;
  category: CardCategory;
  desc: string;
  rarity?: CardRarity;

  // attack 字段
  attackSuit?: Suit;
  attackValue?: number;          // 留口子（未来扩展点数/组合）

  // equipment 字段
  equipKind?: EquipmentKind;
  equipSuit?: Suit;              // 用作"同款"识别（同 equipSuit + 同 id 才能叠）
  baseDmg?: number;              // 武器基础伤害
  baseReduce?: number;           // 防具基础减伤
  hits?: number;                 // 武器：每次出攻击牌触发的 hit 数（默认 1）
  pierce?: number;               // 武器：破甲数值，无视敌人 N 点 armor
  equipEffects?: [EquipEffect, EquipEffect, EquipEffect, EquipEffect];

  // skill / item 字段
  target?: TargetMode;
  onPlay?: (ctx: BattleContext) => void;

  // perk 字段（单一效果，按 stacks 线性缩放，无叠加上限）
  perkEffect?: PerkEffect;
  defaultSuit?: Suit;            // 特性默认花色（用于叠加分组）
}

// ── 卡牌实例 ──────────────────────────────────────────────
export interface CardInstance {
  defId: string;
  uid: string;
  scale: number;
  rarity?: CardRarity;
  // perk 用：花色（多张同 defId 通过花色区分槽位）
  suit?: Suit;
  slotId?: string;
  acquiredAtFloor?: number;     // 获得时所在的关卡（起始牌库 = 0；用于整理 UI 标记本关新增）
  // 铁匠铺染色覆盖：永久把攻击牌花色改成此值（攻击牌专用）
  attackSuitOverride?: Suit;
  // 史诗卡使用次数限制（每场战斗 3 次；用尽后回到牌库，需要重新抽起）
  usesRemaining?: number;
}

// ── 玩家状态 ──────────────────────────────────────────────
export interface PlayerState {
  vita: number;
  vitaMax: number;

  // 常驻区
  perks: CardInstance[];         // 特性
  weapons: CardInstance[];       // 武器（同 id 叠加）
  armors: CardInstance[];        // 防具（同 id 叠加）

  // 战斗循环
  hand: CardInstance[];
  deck: CardInstance[];
  discard: CardInstance[];

  statuses: StatusEffect[];
  turnsElapsed: number;

  // 灵魂碎片（击杀对应种族敌人掉落，用于铁匠铺附魔）
  fragments: Record<EnemyRace, number>;

  // 武器槽附魔（绑定武器槽，换武器时保留）
  weaponEnchant?: EnchantId;

  // 整局 1 次的复活机制（不灭之心）已使用次数；不在 statuses 里因为状态会战斗间清空
  revivesUsed?: number;

  // 跨场战斗的持续效果（神秘宝箱陷阱设置；newBattle 消费一次后清除）
  nextBattlePenalty?: "miss_one" | "miss_two" | "enemy_first";

  // 花色专精：累积打过的同花色攻击牌总数（跨战斗保留；染色/持咒后按视为色累积；cap 30/色）
  suitPlayedTotal?: Record<Suit, number>;

  // 装备保底：连续未在 reward_card 拿到装备的场次，达 3 次下场必出装备
  battlesSinceEquipReward?: number;

  // 花色专精大招的整局使用次数（跨战斗保留；目前仅 ♥ 生命洪流限 3 次）
  ultsUsed?: Record<Suit, number>;
}

// ── 敌人 ──────────────────────────────────────────────────
export interface EnemyIntent {
  type: "attack" | "buff" | "debuff";
  value: number;
  hits?: number;
  desc: string;
  // debuff 专用：给玩家上的状态
  debuffId?: string;          // "poison" | "weak" | "vulnerable"
  debuffName?: string;
  debuffDuration?: number;    // -1 表示由 stacks 自衰减（如中毒），>0 表示固定回合
}

export interface EnemyState {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  suit: Suit;
  race: EnemyRace;          // 种族（决定击杀掉落的灵魂碎片）
  intents: EnemyIntent[];
  intentIndex: number;
  statuses: StatusEffect[];
  alive: boolean;
  armor?: number;          // 减伤（被破甲穿透）
  weaponMult?: number;     // 武器倍率（第 4 关起显示）
  tier?: "normal" | "elite" | "boss";  // 战斗强度档：精英/Boss 在 UI 上特殊呈现
  eliteAbility?: string;    // 精英特能名称（显示用）
  // 共鸣咒：保存原始花色，4 回合后回归
  originalSuit?: Suit;
}

// ── 战斗状态 ──────────────────────────────────────────────
export type BattlePhase = "playerTurn" | "enemyTurn" | "won" | "lost";

export interface BattleState {
  phase: BattlePhase;
  turn: number;
  player: PlayerState;
  enemies: EnemyState[];
  targetIndex: number;          // 当前选中的敌人 index（攻击/技能默认目标）
  attackedThisTurn: boolean;    // 本回合是否已经打出攻击牌（每回合最多 1 张，连弩除外）
  bowAttackStreak: number;      // 连弩连续出攻击牌的回合数（满 2 后下回合弃置）
  pendingSuitPick?: string;     // 等待玩家手选花色的动作 ("dye" | "resonance")
  floor: number;                // 当前楼层（calcAttackDamage 里的 sharp 附魔需要）
  pendingDodgeFx?: number;      // 待播放的闪避动效次数（main.ts 渲染时消费）

  // 花色专精：玩家手动指定的激活花色（仅在多花色亲和度并列时有效）
  activeSpecialtyOverride?: Suit;

  // Epic 装备耗尽时的替换流程（main.ts 渲染时消费）
  pendingEpicReplacement?: {
    slot: "weapon" | "armor";
    candidates: string[];   // 牌库中可选的非 Epic 装备 uid 列表（最多 3 个）
  };
}

// ── 游戏阶段 ──────────────────────────────────────────────
export type GamePhase =
  | "starter_perk_picks"
  | "floor_map"           // 楼层全貌 / 路径选择
  | "battle"
  | "suit_pick"           // 手选花色（染色术 / 共鸣咒）
  | "battle_victory"
  | "reward_card"          // 战利品（1 张卡进牌库）
  | "reward_perk"          // 通关额外特性
  | "floor_event"          // 触发某事件（从 map node 进入）
  | "discard"
  | "forge"                // 铁匠铺（map node）
  | "game_over"
  | "victory";

// ── 楼层地图（Slay the Spire 式分支节点图） ───────────────
export type MapNodeType = "start" | "battle" | "elite" | "boss" | "event" | "forge" | "shop";

export interface MapNode {
  id: string;
  type: MapNodeType;
  layer: number;             // 层（深度，0 = start）
  col: number;               // 该层第几个节点（用于布局）
  next: string[];            // 通向的下一层节点 id
  // 渲染坐标（map.ts 计算后填充）
  x: number;                 // 0-1 normalized
  y: number;                 // 0-1 normalized
  completed: boolean;
  // 类型相关 payload（生成时预 roll，进入时使用）
  enemies?: EnemyState[];    // battle/elite/boss
  eventId?: string;          // event 节点
}

export interface FloorTheme {
  name: string;              // 关卡名
  flavor: string;            // 一句话氛围
  bgClass: string;           // CSS 类名（决定背景渐变）
  accentColor: string;       // 主调色（hex）
}

export interface FloorMap {
  floor: number;
  theme: FloorTheme;
  nodes: MapNode[];
  startNodeId: string;
  bossNodeId: string;
  currentNodeId: string;     // 玩家当前所在节点（初始 = start）
}

export interface GameState {
  phase: GamePhase;
  floor: number;
  battleIndex: number;            // 本关第几场战斗
  battleGroups: EnemyState[][];   // 本关的所有战斗
  player: PlayerState;
  battle: BattleState | null;
  choices: CardInstance[];
  picksRemaining: number;
  pendingFloorClear: boolean;
  log: LogEntry[];
  vitaUpAmount?: number;

  // 楼层事件（floor_event 阶段时由 events.ts 设置）
  activeEventId?: string;
  // 商人事件的子界面状态（由 main.ts 渲染时使用）
  merchantStock?: CardInstance[];

  // 楼层地图（floor_map 阶段时由 map.ts 设置）
  floorMap?: FloorMap;

  // 铁匠铺访问内是否已用过染色服务（每次访问只允许 1 次）
  forgeRecolorUsed?: boolean;

  // 铁匠铺本次访问的「5 折特惠」（25% 概率出现；附魔配方碎片消耗减半，向上取整）
  forgeDiscountThisVisit?: boolean;

  // 商店本次访问已卖的卡数（每次访问最多卖 2 张）
  merchantSellsThisVisit?: number;

  // 事件结果对话框（事件完成后展示，玩家点确认才回地图）
  eventResult?: {
    title: string;
    message: string;
    cardId?: string;        // 加入/失去的卡 id
    cardChange?: "gained" | "lost";
    kind: "win" | "lose" | "neutral";
  };
}
