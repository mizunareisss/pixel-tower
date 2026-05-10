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
  poison:     { name: "中毒", desc: "每回合开始受 stacks 伤害，stacks 减 1。", kind: "debuff" },
  weak:       { name: "虚弱", desc: "攻击造成的伤害 -stacks。", kind: "debuff" },
  vulnerable: { name: "易伤", desc: "受到的伤害 +50%。", kind: "debuff" },

  // 染色 buff（4 个花色独立 status，本回合攻击牌强制视为该花色）
  dyed_spade:   { name: "染色♠", desc: "本回合攻击牌视为黑桃。", kind: "buff" },
  dyed_diamond: { name: "染色♦", desc: "本回合攻击牌视为方块。", kind: "buff" },
  dyed_heart:   { name: "染色♥", desc: "本回合攻击牌视为红心。", kind: "buff" },
  dyed_club:    { name: "染色♣", desc: "本回合攻击牌视为梅花。", kind: "buff" },

  // 敌人 debuff
  burn:       { name: "燃烧", desc: "每回合 -stacks HP，持续 duration 回合。", kind: "debuff" },
  rend:       { name: "撕裂", desc: "受到的伤害永久 +stacks。", kind: "debuff" },
  frozen:     { name: "冰冻", desc: "下回合行动伤害减半。", kind: "debuff" },
  silenced:   { name: "沉默", desc: "下回合无法 buff。", kind: "debuff" },
  bleed:      { name: "出血", desc: "每回合扣当前 HP × stacks × 5%。", kind: "debuff" },

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

// ── 附魔系统 ──────────────────────────────────────────────
export type EnchantId = "frenzy_e" | "calculated" | "assassinate" | "crushing" | "soul_drain" | "phantom" | "sharp";

export const ENCHANT_NAMES: Record<EnchantId, string> = {
  frenzy_e: "怒涌",
  calculated: "预谋",
  assassinate: "夺命",
  crushing: "碾压",
  soul_drain: "吸魂",
  phantom: "幻影",
  sharp: "锐利",
};

export const ENCHANT_DESCS: Record<EnchantId, string> = {
  frenzy_e: "HP 越低伤害越高：每损 10% HP，攻击 +5%（损 50% = +25%）。",
  calculated: "每出 1 张非攻击牌，下张攻击 +3 伤（同回合累积，攻击后清零）。",
  assassinate: "攻击有 武器叠加×15% 几率（最高 30%）即死目标，无视护甲。",
  crushing: "单次伤害 ≥ 敌人最大 HP 的 10% 时，本次伤害额外 +30%。",
  soul_drain: "击杀敌人时回复最大 HP 的 10%（最少 5 点），并永久 +3 最大 HP。",
  phantom: "完全闪避后，下一次攻击伤害 ×2。",
  sharp: "所有攻击额外 +pierce 等于当前楼层数（动态成长）。",
};

// 附魔来源种族
export const ENCHANT_RACE: Record<EnchantId, EnemyRace> = {
  frenzy_e: "beast",
  calculated: "humanoid",
  assassinate: "undead",
  crushing: "giant",
  soul_drain: "dark",
  phantom: "dark",
  sharp: "humanoid",
};

export const ENCHANT_COST = 3;  // 每个附魔消耗 3 同种族碎片
export const ENCHANTS: EnchantId[] = ["frenzy_e", "calculated", "assassinate", "crushing", "soul_drain", "phantom", "sharp"];

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

  // 事件结果对话框（事件完成后展示，玩家点确认才回地图）
  eventResult?: {
    title: string;
    message: string;
    cardId?: string;        // 加入/失去的卡 id
    cardChange?: "gained" | "lost";
    kind: "win" | "lose" | "neutral";
  };
}
