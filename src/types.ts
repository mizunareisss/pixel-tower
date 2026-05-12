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

// 花色专精档位名 + 大招名（XLSX 新版）
export const SUIT_TIER_NAMES: Record<Suit, { tier1: string; tier2: string; tier3: string; ult: string }> = {
  spade:   { tier1: "锋锐怒涛", tier2: "破甲黑刃", tier3: "斩魂蓄势", ult: "狂战之击" },
  diamond: { tier1: "疾风闪步", tier2: "灵巧连击", tier3: "幻影成形", ult: "影子杀手" },
  heart:   { tier1: "生机涌动", tier2: "绝境攻防", tier3: "生命之泉", ult: "生命洪流" },
  club:    { tier1: "魔法庇护", tier2: "反应装甲", tier3: "禁咒蓄能", ult: "群体禁咒" },
};

// 各档与大招的具体效果描述（XLSX 新版 — 技能/道具已无花色，keyword 全部改为攻击命中触发）
export const SUIT_TIER_DESCS: Record<Suit, { tier1: string; tier2: string; tier3: string; ult: string }> = {
  spade: {
    tier1: "攻击 ×1.15；激活『锐利』keyword — ♠ 攻击命中 45% 概率施加 1 层出血。",
    tier2: "所有攻击 pierce +1；♠ 攻击额外 +⌈楼层/4⌉ pierce（最少 +1）。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "对当前目标造成其当前 HP 50% 的真实伤害（无视护甲）。",
  },
  diamond: {
    tier1: "闪避 +8%；激活『灵敏』keyword — ♦ 攻击命中 25% 概率额外 +1 hit + 10% 概率暴击 ×2。",
    tier2: "攻击 30% 概率额外 +1 hit（与 T1 灵敏独立 roll，可叠加）。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "本回合 100% 闪避，下次攻击额外三连击（与连击叠加）。",
  },
  heart: {
    tier1: "每回合开始 +5 HP；激活『贪婪』keyword — ♥ 攻击命中 +10% 吸血。",
    tier2: "HP <50% 受击 ×0.7；HP <25% 攻击 +30%。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "HP 补满，永久 maxHP +5。",
  },
  club: {
    tier1: "受击 -3；激活『镇守』keyword — ♣ 攻击命中 +1 临时护盾，每回合 -1 自动衰减。",
    tier2: "反应装甲：最后一层临时护盾被打破时 25% 概率给攻击者 +1 易伤（3 回合）。",
    tier3: "可释放大招（消耗 8 亲和）。",
    ult: "全体敌人 +沉默 3 回 / +3 易伤 3 回 / +3 中毒。",
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
  // ── 玩家 buff ──────────────────────────────────────────────
  battle_cry:     { name: "战吼", desc: "本回合所有攻击 +3 伤。\n来源：技能 sk_battle_cry「战吼」。", kind: "buff" },
  evasive:        { name: "屏息", desc: "本回合受到伤害 ×0.7（-30%）；与闪避概率独立。\n来源：技能 sk_evasive「屏息」。", kind: "buff" },
  sharpened:      { name: "磨刀", desc: "下一张攻击伤害 ×1.5。\n来源：道具 it_whetstone「磨刀石」。", kind: "buff" },
  weapon_buff:    { name: "强化药", desc: "本场战斗武器伤害 +stacks。\n来源：道具 it_elixir「强化药」。", kind: "buff" },
  shield_block:   { name: "护盾", desc: "吸收下次受到的 stacks 点伤害。\n来源：技能 sk_aegis「铁壁」/ ♣ T1「镇守」keyword（♣ 攻击命中触发，每回合 -1 衰减）/ ♣ T2「反应装甲」/ 装备「木盾杖」「重铠」反震 / 附魔「重甲列阵」未受伤奖励 / ♦ 大招「影子杀手」三连之后。", kind: "buff" },
  shadow_double:  { name: "影袭", desc: "下一张攻击 +1 hit（连击 2 次）。\n来源：技能 sk_shadow_strike「影袭」/ 装备「风刃」闪避后 / 装备「不朽战甲」受击后。", kind: "buff" },
  counter_stance: { name: "反击姿态", desc: "本回合受击反弹 50% 伤害给攻击者。\n来源：技能 sk_counter_stance「反击姿态」。", kind: "buff" },
  busi_triggered: { name: "已豁免", desc: "本场战斗已触发不死意志（复活机制只触发 1 次的标记）。\n来源：装备「不灭之心」(undying_heart) 触发后挂上。", kind: "neutral" },
  double_strike:  { name: "倍击（已废弃）", desc: "（旧版状态，当前无任何卡牌产生）。", kind: "neutral" },
  heavy_strike:   { name: "猛击就绪（已废弃）", desc: "（旧版状态，当前无任何卡牌产生）。", kind: "neutral" },
  charged:        { name: "蓄力（已废弃）", desc: "（旧版状态，sk_charge v5 删除后无来源）。", kind: "neutral" },

  // ── 玩家 debuff ────────────────────────────────────────────
  poison:     { name: "中毒", desc: "每回合扣 maxHP × 1% × stacks，每回合 stacks -1。副作用：暴击率 -stacks × 5%（cap -50%）。\n来源：敌人 debuff intent / 技能毒刃 / 毒血 / 道具箭毒蛙 / 诅咒漩涡 等。", kind: "debuff" },
  weak:       { name: "虚弱", desc: "攻击伤害 ×0.7（-30% 固定，stacks 只决定 duration）。\n来源：敌人 debuff intent / 技能虚弱箭 / 群体虚弱 / 恐惧术。", kind: "debuff" },
  vulnerable: { name: "易伤", desc: "受到伤害 ×1.3（+30% 固定，stacks 只决定 duration）。\n来源：敌人 debuff intent / 技能双重打击 / 恐惧术 / 诅咒漩涡 / ♣ T2「反应装甲」/ ♣ 大招群体禁咒。", kind: "debuff" },
  burn:       { name: "燃烧", desc: "每回合扣 maxHP × 2% × stacks，持续 duration 回合（无副作用）。\n来源：技能 sk_fire_wall「火墙」。", kind: "debuff" },
  bleed:      { name: "出血", desc: "每回合扣当前 HP × 5% × stacks。施加在玩家身上时副作用：闪避率 -stacks × 5%（cap -50%）。\n来源：技能流血咒 / 利刃 / 神锋无影 / 道具抗凝血 / ♠ T1「锐利」keyword（♠ 攻击 45% 概率）。", kind: "debuff" },
  rend:       { name: "撕裂（已废弃）", desc: "（旧版状态，现在撕裂技能直接扣 armor，不再走 status）。", kind: "debuff" },
  frozen:     { name: "冰冻", desc: "下回合攻击伤害 ×0.8（-20%）+ 多动时仅 1 动。\n来源：技能 sk_freeze「冰冻」/ 群体诅咒。", kind: "debuff" },
  silenced:   { name: "沉默", desc: "下回合 buff intent 跳过（攻击 / debuff 仍出）。\n来源：技能 sk_silence「沉默」/ ♣ 大招群体禁咒。", kind: "debuff" },
  attuned:    { name: "已共鸣", desc: "花色被共鸣咒改变，剩余 duration 回合后回归原色。\n来源：技能 sk_attune「共鸣咒」。", kind: "neutral" },
  fear:       { name: "恐惧", desc: "本回合攻击伤害 ×0.5（-50%）+ 多动时仅 1 动。\n来源：技能 sk_fear「恐惧术」（同时附加易伤）。", kind: "debuff" },

  // ── 染色 buff（4 个花色独立 status）────────────────────────
  dyed_spade:   { name: "染色♠", desc: "本回合攻击牌视为黑桃。\n来源：技能 sk_dye「染色术」。", kind: "buff" },
  dyed_diamond: { name: "染色♦", desc: "本回合攻击牌视为方块。\n来源：技能 sk_dye「染色术」。", kind: "buff" },
  dyed_heart:   { name: "染色♥", desc: "本回合攻击牌视为红心。\n来源：技能 sk_dye「染色术」。", kind: "buff" },
  dyed_club:    { name: "染色♣", desc: "本回合攻击牌视为梅花。\n来源：技能 sk_dye「染色术」。", kind: "buff" },

  // ── 持咒 buff（整场战斗持续）────────────────────────────────
  chanted_spade:   { name: "持咒♠", desc: "本场战斗内攻击牌视为黑桃。\n来源：技能 sk_chant「持咒」。", kind: "buff" },
  chanted_diamond: { name: "持咒♦", desc: "本场战斗内攻击牌视为方块。\n来源：技能 sk_chant「持咒」。", kind: "buff" },
  chanted_heart:   { name: "持咒♥", desc: "本场战斗内攻击牌视为红心。\n来源：技能 sk_chant「持咒」。", kind: "buff" },
  chanted_club:    { name: "持咒♣", desc: "本场战斗内攻击牌视为梅花。\n来源：技能 sk_chant「持咒」。", kind: "buff" },
  chanted_used:    { name: "本场已持咒", desc: "本场战斗内已经触发过持咒（标记，副本灰显，下场恢复）。\n来源：技能 sk_chant「持咒」触发后挂上。", kind: "neutral" },

  // ── ♦ T3 大招效果 ─────────────────────────────────────────
  dodge_full_round: { name: "影子杀手·闪避", desc: "本回合敌人攻击全部闪避。\n来源：♦ 方块 T3 大招「影子杀手」。", kind: "buff" },
  triple_strike:    { name: "影子杀手·三连", desc: "下次攻击 hits ×3。\n来源：♦ 方块 T3 大招「影子杀手」。", kind: "buff" },

  // ── 技能 / 道具 buff ───────────────────────────────────────
  blood_pact:    { name: "血契", desc: "本回合内所有攻击吸血 +20%。\n来源：技能 sk_blood_pact「血契」。", kind: "buff" },
  arcane_burst:  { name: "奥术爆裂", desc: "本回合每张非攻击牌使下张攻击 +3。\n来源：技能 sk_arcane_burst「奥术爆裂」。", kind: "buff" },
  brew_regen:    { name: "药剂", desc: "本场战斗内每回合开始 +stacks HP。\n来源：道具 it_brew「药剂」。", kind: "buff" },
  no_skill:      { name: "技能锁", desc: "本回合不能再出技能牌。\n来源：道具 it_quick_draw「速摸」副作用。", kind: "neutral" },
  no_attack:     { name: "蓄力中", desc: "本回合（或两回合）无法出攻击牌。\n来源：技能 sk_drain_strike「汲血斩」后摇 2 回合 / 旧 sk_charge（已删）。", kind: "neutral" },
  pierce_bonus:  { name: "穿甲斩", desc: "下张攻击额外 +stacks pierce（用一次清除）。\n来源：技能 sk_pierce_strike「穿甲斩」。", kind: "buff" },
  pierce_perm:   { name: "穿甲油", desc: "持续 duration 回合内武器 +stacks pierce。\n来源：道具 it_pierce_oil「穿甲油」（3 回合 +3 pierce）。", kind: "buff" },
  frenzy:        { name: "激奋", desc: "每打出 1 张攻击牌后 stacks +1，下次攻击 +stacks × 2 伤；3 回合后失效。\n来源：技能 sk_frenzy「激奋」。", kind: "buff" },
  combat_rhythm: { name: "战斗节奏", desc: "本回合内每打 1 张牌额外摸 1 张。\n来源：技能 sk_rhythm「战斗节奏」。", kind: "buff" },
  time_stop:     { name: "时停", desc: "敌人下一回合无法行动（DoT 仍结算）。\n来源：技能 sk_time_stop「时停」。", kind: "buff" },

  // ── 闪避 / 穿甲系统 ───────────────────────────────────────
  smoke_dodge:      { name: "烟雾", desc: "闪避概率 +stacks%，剩余 duration 回合。\n来源：道具 it_smoke「烟雾弹」/ 技能 sk_evasion_burst「灵巧爆发」（复用此 status）。", kind: "buff" },
  guaranteed_dodge: { name: "风步", desc: "下一次受击必定闪避（一次性）。\n来源：技能 sk_step「风步」。", kind: "buff" },
  pierce_next:      { name: "穿甲蓄势", desc: "下一次攻击无视目标全部护甲（一次性）。\n来源：技能 sk_pierce_shot「穿甲射」。", kind: "buff" },
  phantom_charge:   { name: "幻影残像", desc: "下一次攻击伤害 ×N + 给目标 +M 易伤（按附魔 Lv），一次性。\n来源：附魔 e_phantom「幻影」闪避后触发。", kind: "buff" },
  echo:             { name: "复读", desc: "本回合内每出 1 张非攻击牌后复制一份回手牌；回合结束失效。\n来源：道具 it_echo「复读机」。", kind: "buff" },

  // ── 附魔触发的 status ─────────────────────────────────────
  phalanx_dr:        { name: "重甲列阵", desc: "本回合每张攻击牌使受击 -stacks（cap 按 Lv）。\n来源：附魔 ec_phalanx「重甲列阵」。", kind: "buff" },
  fullplate_pending: { name: "反震蓄势", desc: "敌人回合内每受一击累积 +N（N 按重铠 stack）；下回合开始时全部释放为 shield_block 持续护盾。\n来源：装备 full_plate「重铠」受击触发。", kind: "buff" },
  swift_dodge_temp:  { name: "风行余势", desc: "本回合内闪避概率 +stacks%（cap 按 Lv）。\n来源：附魔 ec_swift「风行步」闪避后触发。", kind: "buff" },
  enc_runic_immune:  { name: "符文护盾", desc: "本场战斗第 1 次受击免疫（Lv1-2 -50%，Lv3+ 完全免疫）。\n来源：附魔 ec_runic「符文护盾」（newBattle 时挂上）。", kind: "buff" },
  enc_dot_immune:    { name: "圣化", desc: "中毒 / 燃烧 / 出血对你无效。\n来源：附魔 ec_runic「符文护盾」（newBattle 时挂上）。", kind: "buff" },
  warblood_perm_atk: { name: "血誓积累 / 斩魂蓄势", desc: "永久攻击 +stacks（cap 按附魔 Lv 或装备 stack）。\n来源：附魔 ec_warblood「战狂血誓」每损 10% maxHP 触发 / 装备 soulreaver_plate「斩魂铠」受击触发。", kind: "buff" },

  // ── 装备触发的 status ─────────────────────────────────────
  knight_charge:     { name: "骑士充能", desc: "下次攻击 +N 直伤（N 由骑士铠 stack 决定，cap 3）。\n来源：装备 knight_plate「骑士铠」受击触发。", kind: "buff" },
  took_damage_turn:  { name: "本回合受伤", desc: "（内部 marker）本回合受到过伤害，用于 ec_phalanx 末段判断。玩家无需关注。", kind: "neutral" },
  calc_charge:       { name: "法术蓄能", desc: "本回合已出非攻击牌数。下次攻击 +stacks × N（N 由触发源决定）。\n来源：装备 wizard_staff「法师杖」（+3）/ 附魔 e_strategist「算计」+ ec_focus「凝神」/ 技能 sk_arcane_burst「奥术爆裂」。", kind: "buff" },

  // ── 特性 / 附魔触发的 charge buff ──
  blood_pact_charge:   { name: "血誓蓄势", desc: "下次攻击 +stacks 直伤（一次性，攻击后清零）。\n来源：特性 p_blood_pact「血誓」（受伤的 5% 转化，cap +6 / 张）。", kind: "buff" },
  e_reaper_buff:       { name: "收割之刃", desc: "下次攻击 ×N（N 按附魔 Lv：1.20 / 1.40 / 1.65 等），一次性。\n来源：附魔 e_reaper「收割」击杀敌人后触发。", kind: "buff" },
  arcane_draws:        { name: "秘法摸牌计数", desc: "（内部）本回合已通过秘法回响摸的额外牌数，cap 3 张/回合。\n来源：附魔 ec_arcane「秘法回响」每出非攻击牌触发。", kind: "neutral" },
  arcane_first_used:   { name: "秘法已触发", desc: "（内部）本场战斗秘法回响「首攻 +N%」已用过的标记。\n来源：附魔 ec_arcane「秘法回响」触发后挂上。", kind: "neutral" },
  swift_first_used:    { name: "疾风已触发", desc: "（内部）本场战斗第 1 回合首攻已被加成过的标记。\n来源：特性 p_swift_strike「疾风斩」触发后挂上。", kind: "neutral" },

  // ── 玩家「下次攻击命中附加 debuff」标记 ────────────────────
  next_atk_apply_poison: { name: "箭毒预备", desc: "下次攻击命中时给目标 +stacks 中毒。\n来源：道具 it_poison_dart「箭毒蛙」。", kind: "buff" },
  next_atk_apply_bleed:  { name: "抗凝血预备", desc: "下次攻击命中时给目标 +stacks 出血（持续 2 回合）。\n来源：道具 it_anticoag「抗凝血」。", kind: "buff" },
  // ── 吸血盾 / 反伤甲 ──
  draining_charge:   { name: "吸血盾蓄势", desc: "已累积 stacks 点延迟回血，下回合开始时全部回给玩家。\n来源：装备「吸血盾」受击触发。", kind: "buff" },
  thorn_chain:       { name: "反伤连击", desc: "本回合已累计受击 stacks 次（用于反伤甲计算每 hit +10% 反伤）。每回合开始清零。\n来源：装备「反伤甲」受击触发。", kind: "neutral" },
  // ── 敌人 buff intent 触发的 status（v6 buff dispatch 系统）──
  temp_armor:        { name: "临时护甲", desc: "本回合敌人护甲临时 +stacks。\n来源：敌人 buff intent self_armor（兽 血怒 / 巨怪 硬化）或 team_armor（人型 结阵）。", kind: "buff" },
  enemy_atk_buff:    { name: "强化", desc: "下次攻击 +stacks 伤害（一次性）。\n来源：敌人 buff intent next_attack_3（兽 嚎叫 / 人型 战吼 / 暗影 暗影遁）。", kind: "buff" },
  enemy_next_hits:   { name: "多段蓄势", desc: "下次攻击 +stacks hits。\n来源：敌人 buff intent next_hits（巨怪 狂奔）。", kind: "buff" },
  enemy_sacrifice:   { name: "血祭蓄势", desc: "下次攻击 +stacks% 伤害（已扣 3% maxHP）。\n来源：敌人 buff intent self_sacrifice（暗影 血祭）。", kind: "buff" },
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

// 附魔 5 档逐步升级 — 同一附魔每次铁匠铺重附消耗等额配方 + Lv +1，至 Lv5 满级
export const ENCHANT_MAX_LEVEL = 5;

// 各档参数表。index = level - 1。每个附魔的参数槽数量不同，按各自语义读取。
// 注：所有 ENCHANT_EFFECTS / battle.ts 内的硬编码数值都应该读这个表。
//
// 设计约束（按用户要求）：
//   - Lv1 ≈ 旧固定值的 0.85-0.95×（起点不弱）
//   - Lv3 ≈ 旧固定值
//   - Lv5 ≤ 旧固定值的 1.5×（硬上限，不能更高）
export const ENCHANT_LEVEL_PARAMS: Record<EnchantId, readonly number[][]> = {
  // 普通（单种族 ×3）
  e_brawler:    [[10], [12], [14], [16], [18]],                        // [HP<50% 攻击 +N%]（旧 12 → Lv5 18 = 1.50×）
  e_strategist: [[2],  [2],  [2],  [3],  [3]],                          // [每非攻击牌下张 +N]（旧 2 → Lv5 3 = 1.50×）
  e_reaper:     [[140],[150],[160],[165],[175]],                        // [击杀后下次 ×(N/100)]（旧 150 → Lv5 175 ≈ bonus +50%→+75% = 1.50×）
  e_titan:      [[22], [25], [28], [32], [37]],                         // [≥8% maxHP +N%]（旧 25 → Lv5 37 = 1.48×）
  e_phantom:    [[170,2],[180,3],[200,3],[220,4],[250,4]],               // [闪避后 ×(N/100), 易伤 +M]（旧 200/3 → Lv5 250 = bonus 1.50× / vuln 4 = 1.33×）
  // 复合（×2+×2）
  ec_warblood:  [[18,1,4],[20,1,5],[22,1,5],[26,1,6],[30,2,7]],          // [HP<50% +N%, perStep, cap]（旧 20/-/5 → Lv5 30/2/7 = 1.50× / cap 1.40×）
  ec_phalanx:   [[1,3,4],[1,3,5],[1,4,5],[1,4,6],[1,4,7]],               // [每张 -N, cap -M, 下回合护盾 K]（旧 1/-3/5 → Lv5 1/-4/7 = 1.33× / 1.40×）
  ec_swift:     [[9,4,22,1],[10,5,25,1],[11,5,28,1],[13,6,33,1],[15,7,40,1]], // [闪避 +N%, 闪后 +M%, cap K%, 易伤 L]（旧 10/5/30/1 → Lv5 15/7/40/1 = 1.50/1.40/1.33×）
  ec_focus:     [[1,12,4],[1,12,5],[1,12,5],[1,12,6],[1,12,7]],          // [perCard +N, ≥M dmg +K]（旧 1/12/5 → Lv5 1/12/7 = bonus 1.40×）
  ec_lifesteal: [[7,8],[8,10],[9,11],[11,13],[12,15]],                    // [+N% lifesteal, 满血 +M%]（旧 8/10 → Lv5 12/15 = 1.50/1.50×）
  ec_resilient: [[2,2,1],[2,2,1],[2,2,1],[3,2,1],[3,3,2]],               // [受击 -N, HP>80% 再 -M, 每回合 +K HP]（旧 2/2/1 → Lv5 3/3/2 = 1.50/1.50/2×）
  ec_arcane:    [[25],[28],[30],[38],[45]],                              // [染/咒首攻 +N%]（旧 30 → Lv5 45 = 1.50×）
  ec_runic:     [[2,100],[3,100],[3,100],[4,100],[4,100]],               // [受击 -N, 首次受击 -M%（100% = 完全免疫）]（旧 3/100 → Lv5 4/100 = 1.33×）
} as const;

// 工具：读当前 player 的附魔档位（默认 1，clamp 到 [1, 5]）
export function getEnchantLevel(player: PlayerState): number {
  return Math.max(1, Math.min(ENCHANT_MAX_LEVEL, player.weaponEnchantLevel ?? 1));
}

// 工具：读当前附魔指定参数槽的值
export function getEnchantParam(player: PlayerState, idx: number = 0): number {
  const id = player.weaponEnchant;
  if (!id) return 0;
  const lv = getEnchantLevel(player);
  return ENCHANT_LEVEL_PARAMS[id]?.[lv - 1]?.[idx] ?? 0;
}

// 工具：按 level 生成附魔描述（替代固定的 ENCHANT_DESCS，level-aware）
export function getEnchantDescAt(id: EnchantId, level: number): string {
  const lv = Math.max(1, Math.min(ENCHANT_MAX_LEVEL, level));
  const p = ENCHANT_LEVEL_PARAMS[id][lv - 1];
  switch (id) {
    case "e_brawler":    return `HP < 50% 时，攻击 +${p[0]}%。`;
    case "e_strategist": return `每出 1 张非攻击牌，下张攻击 +${p[0]} 伤（同回合累积，攻击后清零）。`;
    case "e_reaper":     return `击杀敌人后，下次攻击 ×${(p[0] / 100).toFixed(2)}（一次性）。`;
    case "e_titan":      return `单次伤害 ≥ 敌人最大 HP 8% 时，本次伤害额外 +${p[0]}%。`;
    case "e_phantom":    return `完全闪避后下次攻击 ×${(p[0] / 100).toFixed(1)}，攻击命中后给目标 +${p[1]} 易伤层。`;
    case "ec_warblood":  return `HP < 50% 时攻击 +${p[0]}%；本场每损 10% maxHP 永久攻击 +${p[1]}（cap +${p[2]}）。`;
    case "ec_phalanx":   return `本回合攻击牌每打 1 张受击 -${p[0]}（cap -${p[1]}）；本回合未受伤则下回合开局护盾 +${p[2]}。`;
    case "ec_swift":     return `闪避概率 +${p[0]}%；闪避后本回合内闪避再 +${p[1]}%（cap +${p[2]}%）；闪避后给目标 +${p[3]} 易伤。`;
    case "ec_focus":     return `每张非攻击牌使下张攻击 +${p[0]} 伤；攻击伤害 ≥ ${p[1]} 时额外 +${p[2]}。`;
    case "ec_lifesteal": return `攻击吸血额外 +${p[0]}%；HP 满时攻击 +${p[1]}%。`;
    case "ec_resilient": return `受击 -${p[0]}；HP > 80% 时受击再 -${p[1]}；每回合开始 +${p[2]} HP。`;
    case "ec_arcane":    return `每出 1 张非攻击牌额外摸 1（每回合 cap 3）；持咒/染色 buff 在场时首次攻击 +${p[0]}%。`;
    case "ec_runic":     return `受击 -${p[0]}；每场首次受击 ${p[1] >= 100 ? "完全免疫" : "-" + p[1] + "%"}；中毒/燃烧/出血对你无效。`;
  }
}

// 稀少种族集合（用于 UI 标记 + 配方校验）
export const RARE_RACES: EnemyRace[] = ["giant", "dark"];
export function isRareRace(race: EnemyRace): boolean {
  return race === "giant" || race === "dark";
}

// 卡牌稀有度 5 档：common 起始牌库专属，rare+ / rare / SR / epic 进奖励池
// common 普通 / rare 稀有 / rare_plus 稀有+（≈ 旧版"带钩子的 common"）/ super_rare 超稀有 / epic 史诗
export type CardRarity = "common" | "rare" | "rare_plus" | "super_rare" | "epic";

// 每档稀有度的中文显示名
export const RARITY_NAMES: Record<CardRarity, string> = {
  common: "普通",
  rare: "稀有",
  rare_plus: "稀有+",
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
  weaponEnchantLevel?: number;  // 1-5，铁匠铺多次附同样的会升 Lv（消耗等额配方）；换不同附魔重置为 1

  // 整局 1 次的复活机制（不灭之心）已使用次数；不在 statuses 里因为状态会战斗间清空
  revivesUsed?: number;

  // 跨场战斗的持续效果（神秘宝箱陷阱设置；newBattle 消费一次后清除）
  nextBattlePenalty?: "miss_one" | "miss_two" | "enemy_first";

  // 花色专精：累积打过的同花色攻击牌总数（跨战斗保留；染色/持咒后按视为色累积；cap 30/色）
  suitPlayedTotal?: Record<Suit, number>;

  // 花色专精：累计被大招消耗掉的亲和度（跨战斗持久化；不重置；
  //   配合 getSuitAffinity 在末端扣减，让消耗成为"整局进度"的代价）
  suitConsumedTotal?: Record<Suit, number>;

  // 装备保底：连续未在 reward_card 拿到装备的场次，达 3 次下场必出装备
  battlesSinceEquipReward?: number;


  // EPIC 临时装备机制：装备 EPIC 武器/防具时把当前装备暂存到 backup，
  // EPIC 用尽（3 次）后自动恢复 backup。比"替换 modal"更灵活，玩家不丢原装备
  tempWeaponBackup?: CardInstance[];
  tempArmorBackup?: CardInstance[];

  // 强制弃牌机制：drawCards / 复读机克隆若导致手牌 > HAND_LIMIT，超出部分进 pendingDraws
  // UI 弹出强制弃牌 modal：玩家从 hand 选 K 张弃掉，K = pendingDraws.length
  // 选完后 pendingDraws → hand，被弃的牌 → discard
  pendingDraws?: CardInstance[];
}

// ── 敌人 ──────────────────────────────────────────────────
// Buff intent 类型 ID（buff intent 的 effect 分发用）
//   next_attack_3      - 下次攻击 +3（旧默认行为）
//   self_armor         - 本回合自身 armor +value
//   team_armor         - 全队本回合 armor +value
//   self_heal_pct      - boss 回血 maxHP × value%
//   next_hits          - 下张攻击 +value hits
//   self_sacrifice     - 自损 3% maxHP，下张攻击 +value%
//   double_debuffs     - F12 限定：玩家身上所有 debuff stack ×2
export type BuffIntentId =
  | "next_attack_3" | "self_armor" | "team_armor"
  | "self_heal_pct" | "next_hits" | "self_sacrifice"
  | "double_debuffs";

export interface EnemyIntent {
  type: "attack" | "buff" | "debuff";
  value: number;
  hits?: number;
  desc: string;
  // debuff 专用：给玩家上的状态
  debuffId?: string;          // "poison" | "weak" | "vulnerable"
  debuffName?: string;
  debuffDuration?: number;    // -1 表示由 stacks 自衰减（如中毒），>0 表示固定回合
  // buff 专用：buffId 决定 enemyTurn 里如何执行；buffValue 是参数
  buffId?: BuffIntentId;
  buffValue?: number;
}

// Boss AI 流派 ID（5 基础 + 5 复合 + 1 演化）
// 隐式行为，无视觉提示；玩家只能通过观察 boss 招式偏好推断
export type BossAIId =
  // 基础（5）
  | "berserker"        // 狂战士：HP 越低越猛
  | "hunter"           // 猎手：看玩家 HP 切策略
  | "builder"          // 构筑者：前堆 buff 后爆发
  | "healer"           // 医者：慢性 dot 耗死
  | "reactor"          // 报复者：隐式 react
  // 复合（5）
  | "dual_berserk"     // 双面狂战 = 狂战 + 构筑
  | "cold_hunter"      // 冷血猎手 = 猎手 + 医者
  | "fake_builder"     // 假动作构筑 = 构筑 + 报复（30% 假动作）
  | "unstoppable_healer" // 不朽医者 = 医者 + 狂战
  | "necro_hunter"     // 死灵猎手 = 报复 + 猎手 + 医者（三流派）
  // F12 专属
  | "evolving";        // 演化型 = 3 阶段切复合流派

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
  // 暴击 / 闪避（buildRandomEnemy 时按 tier × floor 计算，存基础值；
  //   实战通过 getEnemyCritChance / getEnemyDodgeChance 减去 poison / bleed penalty）
  critChance?: number;     // 基础暴击率（百分点），精英 cap 15 / boss cap 25
  dodgeChance?: number;    // 基础闪避率（百分点），精英 cap 9 / boss cap 15
  // 多动 AP：每回合执行的 intent 次数（按 tier × floor 决定）
  //   普通 / 精英 F1-5: 1；精英 F6-10: 2；精英 F11+: 3
  //   Boss F3/F6: 2；F9: 3；F12: 4；F15+: 3
  //   frozen / fear 状态下本回合限 1 动
  actionsPerTurn?: number;
  // 共鸣咒：保存原始花色，4 回合后回归
  originalSuit?: Suit;
  // Boss AI 行为流派（精英 + boss 装备），普通敌人不带；详见 bossAI.ts
  ai?: BossAIId;
  // AI 内部状态机（如演化型当前 phase、累积怒火 stack 等），对玩家不可见
  aiState?: {
    phase?: number;          // 当前阶段（演化型用）
    lastPlayerDmg?: number;  // 上回合玩家输出（报复者用）
    lastPlayerBuffs?: number; // 上回合玩家上的 buff 数（报复者用）
    turnCount?: number;      // 战斗回合计数（构筑者用，前 N 回合堆 buff）
    flavorShownPhases?: number[]; // 已显示过 flavor log 的 phase（避免重复）
  };
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
  pendingBlockFx?: number;      // 待播放的完全格挡动效次数（盾牌闪光）

  // 战斗开始时的骰子先手机制：roll 1d6，单数玩家先手 / 双数敌人先手
  // diceRoll 由 game.ts startNodeBattle 设置；main.ts 渲染时显示骰子动画
  diceRoll?: number;            // 1-6 骰子点数
  enemyFirst?: boolean;         // true = 敌人先手（diceRoll 为偶数）
  diceAnimationShown?: boolean; // main.ts 标记是否已播过骰子动画（避免重复）

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
