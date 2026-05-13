# 塔牌 · Suitspire — 完整游戏机制文档

**版本**：v0.8.1
**对应代码**：`src/types.ts` 中 `APP_VERSION = "0.8.1"`
**最后更新**：2026-05-13

> 本文档是 v0.8.1 版本所有游戏机制 / 系统 / 公式 / 数值的权威参考。
> 卡牌 / 附魔的详细数值表见 [`BALANCE_SHEET.md`](./BALANCE_SHEET.md)（由 `scripts/dump-balance.ts` 自动生成）。
> 每次发新版本时同步：①bump `APP_VERSION` ②重命名本文件为 `GAME_MECHANICS_v<新版本>.md` ③更新内容反映改动。

---

## 目录

1. [游戏概览](#1-游戏概览)
2. [战斗系统](#2-战斗系统)
3. [攻击伤害公式](#3-攻击伤害公式玩家--敌人)
4. [受击减伤公式](#4-受击减伤公式敌人--玩家)
5. [暴击 / 闪避系统](#5-暴击--闪避系统)
6. [状态效果全目录](#6-状态效果全目录)
7. [摸牌 / 弃牌系统](#7-摸牌--弃牌系统)
8. [花色专精系统](#8-花色专精系统)
9. [楼层 / 关卡 / 地图](#9-楼层--关卡--地图)
10. [灵魂碎片与附魔](#10-灵魂碎片与附魔)
11. [Boss AI 流派](#11-boss-ai-流派)
12. [装备 / 护盾机制](#12-装备--护盾机制)
13. [完整卡牌索引](#13-完整卡牌索引)
14. [完整特性清单](#14-完整特性清单)
15. [核心常量速查](#15-核心常量速查)
16. [版本变更日志](#16-版本变更日志)

---

## 1. 游戏概览

**塔牌 · Suitspire** 是一款 4 花色专精构筑 roguelike 爬塔牌组构筑游戏。

### 1.1 总体循环

```
新游戏 → 9 选 3 起手特性 → F1 floor_map → 节点选择
   ↓
战斗（playerTurn ↔ enemyTurn）→ 胜利
   ↓
reward_card（3 选 1 入库）→ 精英 SR 弹窗（若有）
   ↓
回 floor_map（下一节点）→ ...
   ↓
关末（节点完成所有）→ reward_perk（3 选 1 特性 / 或选 +HP）
   ↓
discard（整理）→ 下一关 F<n+1>
   ↓
F12 通关 → victory
```

### 1.2 4 个花色专精流派

| 花色 | 流派 | 主题 |
|---|---|---|
| ♠ 黑桃 | **莽夫流** | 高伤 / 破甲 / 出血 |
| ♦ 方块 | **暗影流** | 闪避 / 多段连击 / 易伤 |
| ♥ 红心 | **生机流** | 吸血 / 回血 / 低血加成 |
| ♣ 梅花 | **法术流** | 护盾 / 控制 / debuff |

每场战斗激活当前亲和度最高的花色作为"主专精"，解锁对应的 T1/T2/T3 效果。

### 1.3 全局节奏

- **每关**（floor）：3 场战斗 + 1-2 个事件 + 1 个铁匠铺 + 1 个 Boss + 通关后 reward_perk
- **整局**：12 关，每关末通关送 1 个特性（reward_perk）
- **起手**：1 短剑 + 16 张基础牌库 + 9 选 3 起手特性 + 40 HP

---

## 2. 战斗系统

### 2.1 状态机

```ts
type BattlePhase = "playerTurn" | "enemyTurn" | "won" | "lost"
```

**playerTurn** → 玩家出牌（攻击牌每回合 1 张；技能/道具无限制）→ 点"结束回合"
→ **enemyTurn**（敌人按 intent 顺序出招 + AP 多动）→ status 衰减
→ 回到 **playerTurn** + 摸 `DRAW_PER_TURN=2` 张

### 2.2 出牌规则

- **攻击牌**：每回合限 1 张（消耗"攻击次数"）
- **技能 / 道具 / 染色等**：无次数限制，但可能有自身 CD / 单次性 status
- **装备牌**：打出后进常驻槽（武器 / 防具各 1 件，同款叠加 cap 4）
- **Epic 卡**：每场战斗使用 `EPIC_USES_PER_BATTLE=3` 次，超出后本场不能再用

### 2.3 选目标

- `target: "single"` — 需指定一个敌人（默认当前 targetIndex）
- `target: "all"` — 群伤 / 群 buff，自动作用于所有活着的敌人
- `target: "self"` — 仅玩家
- `target: "none"` — 无目标（事件触发用）

---

## 3. 攻击伤害公式（玩家 → 敌人）

主函数：`battle.ts:375 calcAttackDamage()`，按下表顺序乘除：

| 步 | 操作 | 公式 / 值 | 代码位置 |
|---|---|---|---|
| 1 | 基础武器伤害 × 叠加倍率 | `wDef.baseDmg × stackMult` (1/2/3/4 件 ×1.0/1.4/1.8/2.2) | `battle.ts:389` |
| 2 | 花色相性 | 同花 ×1.2 / 同色 ×1.0 / 异色 ×0.8 | `battle.ts:399` |
| 3 | 武器 onAttack 钩子 | 装备特殊效果（狂剑低血 +4、狙击 +3 等） | `battle.ts:404` |
| 4 | 战吼 / 强化药 / 磨刀 / 倍击 / 激奋 / 蓄力 | 各种 status 累积 | `battle.ts:409-443` |
| 5 | 玩家虚弱 | `dmg *= 0.7` | `battle.ts:444` |
| 6 | 特性 onDealDamage | `p_bleed +5%`, `p_insight +8%`, `p_executioner` 等 | `battle.ts:450` |
| 7 | 防具 postAttack | 重甲类后处理 | `battle.ts:461` |
| 8 | 敌人易伤 | `dmg *= 1.3`（叠加固定 +30%） | `battle.ts:468` |
| 9 | 楼层 scale | `dmg *= weapons[0].scale`（楼层缩放） | `battle.ts:474` |
| 10 | calc_charge 累积 | 法师杖 / 算计 / 凝神：每张非攻击牌 +N | `battle.ts:477` |
| 11 | ♣ 禁忌权杖 | `dmg += floor(clubAff × 0.5)`，cap +10 | `battle.ts:495` |
| 12 | 附魔 onAttack | 各附魔触发（强袭 / 收割 / 撼地 etc.） | `battle.ts:506` |
| 13 | ♠ T1 锋锐 | `dmg *= 1.15` | `battle.ts:518` |
| 14 | ♥ T2 绝境 | `HP < 25% → dmg *= 1.30` | `battle.ts:523` |
| 15 | **暴击判定**（多重 roll） | 每次 hit 独立判：crit perk / ♦ T1 灵敏 / 敌人 crit | `battle.ts:540+` |
| 16 | pierce 汇总 vs 敌人 armor | 多源 pierce 减去敌人 armor | `battle.ts:562-611` |

### 3.1 武器叠加倍率（cap 4 件）

| 件数 | 倍率 |
|---|---|
| 1 | ×1.0 |
| 2 | ×1.4 |
| 3 | ×1.8 |
| 4 | ×2.2 |

### 3.2 花色相性表

| 攻击 vs 敌人 | 倍率 |
|---|---|
| 完全同花（♠ vs ♠） | **×1.2** |
| 同色不同花（♠↔♣ 或 ♦↔♥） | ×1.0 |
| 异色（黑↔红） | **×0.8** |

### 3.3 Pierce 汇总源

`battle.ts:568-611` 多源累加后再与敌人 armor 比较：

- 基础武器 pierce（如长剑 3、王者之剑 dynamic 70% armor）
- 破军武器：pierce = ⌈目标当前 armor × 50%⌉
- p_armor_break 特性：每张 +1
- 狂剑（低血时） +2
- ♠ T2 +1，♠ 攻额外 +⌈floor/4⌉
- 穿甲油 +2（持续 3 回合）
- 穿甲射 next +9
- 穿甲斩 next +stacks

---

## 4. 受击减伤公式（敌人 → 玩家）

主函数：`battle.ts:1165 damagePlayer()`。

### 4.1 闪避优先级（任一触发即免疫）

1. **`dodge_full_round`** — 本回合 100% 闪避（♦ T3 大招）
2. **`guaranteed_dodge`** — 一次性必定闪避（sk_step 风步）
3. **`dodgeChance` roll** — 概率闪避（roll < 闪避率%）
4. **`enc_runic_immune`** — 本场首次受击免疫（符文护盾，Lv1-2 减 50%，Lv3+ 完全）

### 4.2 减伤栈（顺序严格，每步独立计算）

| 步 | 操作 | 公式 | 代码位置 |
|---|---|---|---|
| 1 | 玩家易伤 | `dmg *= 1.3` | `battle.ts:1215` |
| 2 | 守护契附魔 | `dmg -= Lv(idx0)` + HP>80% 额外 -Lv(idx1) | `battle.ts:1222` |
| 3 | 符文护盾附魔 | `dmg -= [1/2/3/3/4][Lv-1]` | `battle.ts:1233` |
| 4 | 重甲列阵 | `dmg -= phalanx_dr.stacks` | `battle.ts:1237` |
| 5 | ♥ T2 低血 | `HP < 50% → dmg *= 0.7` | `battle.ts:1243` |
| 6 | ♣ T1 魔法庇护 | `dmg -= 3` | `battle.ts:1249` |
| 7 | 防具 onTakeDamage | 各装备减伤 hook（黑盾 -3、不朽 -4 等） | `battle.ts:1256` |
| 8 | 特性 onTakeDamage | `p_tough -10%`, `p_iron_will -8%` (low HP) 等 | `battle.ts:1268` |
| 9 | 屏息 | `dmg *= 0.7` | `battle.ts:1283` |
| 10 | floor + 防御取整 | `Math.floor(dmg)` | `battle.ts:1289` |
| 11 | **fullplate_shield** | 独立 1 层重铠护盾吸收 | `battle.ts:1293` |
| 12 | **shield_block** | 临时护盾吸收（镇守 / sk_aegis 等） | `battle.ts:1305` |
| 13 | 完全格挡判定 | `base > 0 && dmg == 0 → BLOCK 动画` | `battle.ts:1327` |

### 4.3 视觉判定

- **MISS（蓝色）**：闪避路径触发（4 条任一）
- **BLOCK（金色）**：完全格挡（dmg 减到 0 才触发；shield 吸完不算）

---

## 5. 暴击 / 闪避系统

### 5.1 玩家暴击（per-hit roll，无总暴击率概念）

| 来源 | 公式 | cap |
|---|---|---|
| p_crit 特性 | `min(100, stacks × 8)%` | 100% |
| ♦ T1 灵敏 keyword | `10%` per ♦ 攻 hit | 独立 roll |
| **中毒削减** | `-stacks × 5%` | cap -50 百分点 |

### 5.2 玩家闪避率（getCurrentDodgeChance, cap 75%）

| 来源 | 公式 |
|---|---|
| 意念甲装备 | `stacks × 10%` |
| p_dodge 特性 | `min(50, stacks × 5)%` |
| 烟雾弹 status | `smoke_dodge.stacks%` |
| 风行步附魔 | Lv 决定 |
| 风行余势 status | `swift_dodge_temp.stacks%` |
| ♦ T1 疾风 | `+8%` |
| 出血削减 | `-stacks × 5%`，cap -50 百分点 |
| **总上限** | **75%** |

### 5.3 敌人暴击 / 闪避

```
crit  = max(0, enemy.critChance - (poison ? stacks × 5 : 0))    // cap penalty -50
dodge = max(0, enemy.dodgeChance - (bleed ? stacks × 5 : 0))    // cap penalty -50
```

基础 critChance / dodgeChance 在 `buildRandomEnemy` 按 tier × floor 计算：

| Tier | crit cap | dodge cap |
|---|---|---|
| normal | 0 | 0 |
| elite | 15% | 9% |
| boss | 25% | 15% |

---

## 6. 状态效果全目录

按 kind 分类，所有都来自 `types.ts:110 STATUS_META`。

### 6.1 玩家 Buff（持续/一次性增益）

| ID | 名称 | 效果 | 来源 |
|---|---|---|---|
| `battle_cry` | 战吼 | 本回合所有攻击 +3 伤 | sk_battle_cry |
| `evasive` | 屏息 | 本回合受到伤害 ×0.7 | sk_evasive |
| `sharpened` | 磨刀 | 下张攻击 ×1.5 | it_whetstone |
| `weapon_buff` | 强化药 | 本场武器 +stacks | it_elixir |
| `shield_block` | 护盾 | 吸收 stacks 点伤害 | sk_aegis / ♣ T1 / ♣ T2 / 多装备 / 影子杀手 |
| `shadow_double` | 影袭 | 下张攻击 +1 hit | sk_shadow_strike / 风刃 / 不朽战甲 |
| `counter_stance` | 反击姿态 | 本回合反弹 50% 伤害 | sk_counter_stance |
| `blood_pact` | 血契 | 本回合所有攻击吸血 +20% | sk_blood_pact |
| `arcane_burst` | 奥术爆裂 | 本回合每张非攻击牌使下张 +3 | sk_arcane_burst |
| `brew_regen` | 药剂 | 本场每回合 +stacks HP | it_brew |
| `pierce_bonus` | 穿甲斩 | 下张攻击 +stacks pierce | sk_pierce_strike |
| `pierce_perm` | 穿甲油 | duration 回合 +stacks pierce | it_pierce_oil |
| `frenzy` | 激奋 | 攻击牌 +1 stack，下次攻 +stacks × 2 | sk_frenzy |
| `combat_rhythm` | 战斗节奏 | 本回合每打 1 张 +1 摸 | sk_rhythm |
| `time_stop` | 时停 | 敌下回合无法行动 | sk_time_stop |
| `smoke_dodge` | 烟雾 | 闪避 +stacks%, duration 回合 | it_smoke / sk_evasion_burst |
| `guaranteed_dodge` | 风步 | 下次受击必定闪避 | sk_step |
| `pierce_next` | 穿甲蓄势 | 下次攻击无视全部 armor | sk_pierce_shot |
| `phantom_charge` | 幻影残像 | 下张 ×N + 给目标易伤 | 幻影附魔 |
| `echo` | 复读 | 本回合非攻击牌复制回手 | it_echo（克隆是 ephemeral） |
| `dodge_full_round` | 影子杀手·闪避 | 本回合全闪避 | ♦ T3 大招 |
| `triple_strike` | 影子杀手·三连 | 下次攻击 hits ×3 | ♦ T3 大招 |
| `phalanx_dr` | 重甲列阵 | 本回合受击 -stacks | ec_phalanx |
| `fullplate_pending` | 反震蓄势 | 每回合首击形成 1 层；下回合释放 | 重铠装备 |
| `fullplate_shield` | 重铠护盾 | 1 层独立护盾，不衰减不增长 | 重铠 pending 释放 |
| `swift_dodge_temp` | 风行余势 | 本回合闪避 +stacks% | ec_swift |
| `enc_runic_immune` | 符文护盾 | 本场首次受击免疫（Lv 决定） | ec_runic |
| `enc_dot_immune` | 圣化 | DOT 完全免疫 | ec_runic Lv5 |
| `warblood_perm_atk` | 血誓积累 / 斩魂蓄势 | 永久攻击 +stacks | ec_warblood / soulreaver_plate |
| `draining_charge` | 吸血盾蓄势 | 下回合开始 +stacks HP | 吸血盾装备 |
| `knight_charge` | 骑士充能 | 下次攻击 +N 直伤 | 骑士铠 |
| `calc_charge` | 法术蓄能 | 下次攻击 +stacks × N | 法师杖 / 算计 / 凝神 / 奥术爆裂 |
| `blood_pact_charge` | 血誓蓄势 | 下次攻击 +stacks（cap +6） | p_blood_pact |

### 6.2 染色 / 持咒（花色操作）

| ID | 名称 | 效果 |
|---|---|---|
| `dyed_<suit>` | 染色 | 本回合攻击牌视为该色（sk_dye） |
| `chanted_<suit>` | 持咒 | 本场战斗内攻击牌视为该色（sk_chant） |
| `attuned` | 已共鸣 | 花色被共鸣咒改变，duration 回合后回归（sk_attune） |

### 6.3 玩家 Debuff

| ID | 名称 | 效果 |
|---|---|---|
| `poison` | 中毒 | maxHP × 1% × stacks / 回合；暴击 -5%/层 cap -50 |
| `weak` | 虚弱 | 攻击伤害 ×0.7 |
| `vulnerable` | 易伤 | 受到伤害 ×1.3 |
| `burn` | 燃烧 | maxHP × 2% × stacks / 回合 |
| `bleed` | 出血 | HP × 5% × stacks / 回合；闪避 -5%/层 cap -50 |
| `frozen` | 冰冻 | 下回合攻击 ×0.8 + 多动仅 1 动 |
| `silenced` | 沉默 | 下回合 buff intent 跳过 |
| `fear` | 恐惧 | 本回合攻击 ×0.5 + 多动仅 1 动 |

### 6.4 敌人 Buff Intent 触发的 status

| ID | 效果 |
|---|---|
| `temp_armor` | 本回合敌人 armor +stacks |
| `enemy_atk_buff` | 下次攻击 +stacks 伤害 |
| `enemy_next_hits` | 下次攻击 +stacks hits |
| `enemy_sacrifice` | 下次攻击 +stacks%（已扣 3% maxHP 代价） |

---

## 7. 摸牌 / 弃牌系统

### 7.1 牌库管理

```
deck (洗好的牌库) → 摸到 hand → 出牌 → discard
                       ↑________ deck 空时洗 discard 进 deck _______↓
```

### 7.2 关键常量

| 常量 | 值 | 含义 |
|---|---|---|
| `STARTING_HAND` | 6 | 战斗开始摸 6 张 |
| `DRAW_PER_TURN` | 2 | 每回合开始摸 2 张 |
| `HAND_LIMIT` | 10 | 手牌上限，超出走强制弃牌 |

### 7.3 强制弃牌（pendingDraws）

- 摸牌时 `hand.length >= HAND_LIMIT` → 超出部分进 `player.pendingDraws`
- UI 弹"强制弃牌" modal，玩家选 K 张弃（K = pendingDraws.length）
- 选完后：pendingDraws → hand，被弃的牌 → discard

### 7.4 Ephemeral 卡（复读机克隆）

- `it_echo` 触发后，本回合每打 1 张非攻击牌 → 复制一份回手
- 复制品打 `ephemeral: true` 标记
- 回合结束（或战斗结束）时 ephemeral 牌**不进 discard / deck**，直接消失
- 战斗开始 `newBattle` 时过滤 ephemeral，避免污染牌库

---

## 8. 花色专精系统

### 8.1 亲和度公式（`getSuitAffinity`）

```
aff(suit) = Σ(装备同色 × 1.3, Epic 除外)
          + Σ(特性同色 × 0.8)
          + min(SUIT_PLAYED_CAP=100, 已出同色攻击) × 0.3
          - suitConsumedTotal[suit]    ← 大招消耗（跨战持久化）

→ clamp(0, 30)
```

**注意**：
- Epic 装备**不算亲和度**（避免装上不同色 Epic 抢走专精）
- 已出同色攻击牌**跨战斗持久化**（`player.suitPlayedTotal`）
- 大招消耗**跨战斗持久化**（`player.suitConsumedTotal`），整局代价
- 总 cap 30（v0.8.0 上调，留出大招消耗 8 后的再充能空间）

### 8.2 Tier 阈值

| Tier | 亲和度 |
|---|---|
| T1 | ≥ 5 |
| T2 | ≥ 10 |
| T3 | ≥ 15（可释放大招） |

### 8.3 主专精（active specialty）选择规则

1. 取亲和度最高的花色
2. 多花色并列 → 按 `activeSpecialtyOverride`（玩家手选） / 否则按"先到达"近似（同花出牌累积最多）

### 8.4 T1 / T2 / T3 效果（每花色 4 大招）

#### ♠ 黑桃（莽夫流）

| 档 | 名称 | 效果 |
|---|---|---|
| T1 | 锋锐怒涛 | 攻击 ×1.15；激活『锐利』keyword — ♠ 攻击命中 45% 概率 +1 出血 |
| T2 | 破甲黑刃 | 所有攻击 pierce +1；♠ 攻击额外 +⌈floor/4⌉ pierce |
| T3 | 斩魂蓄势 | 可释放大招 |
| **大招** | 狂战之击 | 当前目标 50% 真实伤害（无视护甲） |

#### ♦ 方块（暗影流）

| 档 | 名称 | 效果 |
|---|---|---|
| T1 | 疾风闪步 | 闪避 +8%；激活『灵敏』keyword — ♦ 攻击 25% 额外 +1 hit + 10% 暴击 ×2 |
| T2 | 灵巧连击 | 攻击 30% 概率额外 +1 hit（独立 roll，可叠加 T1） |
| T3 | 幻影成形 | 可释放大招 |
| **大招** | 影子杀手 | 本回合 100% 闪避 + 下次攻击三连击 |

#### ♥ 红心（生机流）

| 档 | 名称 | 效果 |
|---|---|---|
| T1 | 生机涌动 | 每回合开始 +5 HP；激活『贪婪』keyword — ♥ 攻击 +10% 吸血 |
| T2 | 绝境攻防 | HP <50% 受击 ×0.7；HP <25% 攻击 +30% |
| T3 | 生命之泉 | 可释放大招 |
| **大招** | 生命洪流 | HP 补满，永久 maxHP +5 |

#### ♣ 梅花（法术流）

| 档 | 名称 | 效果 |
|---|---|---|
| T1 | 魔法庇护 | 受击 -3；激活『镇守』keyword — ♣ 攻击 +1 临时护盾，每回合 -1 衰减 |
| T2 | 反应装甲 | 最后一层护盾被破时 25% 给攻击者 +1 易伤（3 回合） |
| T3 | 禁咒蓄能 | 可释放大招 |
| **大招** | 群体禁咒 | 全敌 +沉默 3 回 / +易伤 3 层 3 回 / +中毒 3 层 |

### 8.5 大招代价

- 每场每色限 1 次
- 释放消耗 **8 持久化亲和**（`player.suitConsumedTotal[suit] += 8`）
- 跨战斗保留，整局都是代价

---

## 9. 楼层 / 关卡 / 地图

### 9.1 12 关结构

- F1-F3：序章（弱小敌人 / 简单 build 选择）
- F4-F6：中段（精英开始密集 / Epic 装备出现概率上升）
- F7-F9：高强度（连续精英 / 双 boss tier）
- F10-F12：终局（boss AI 复合 + 演化 / F12 双 debuff 极限）

### 9.2 地图节点类型

```ts
type MapNodeType = "start" | "battle" | "elite" | "boss" | "event" | "forge" | "shop"
```

| 节点 | emoji | 含义 |
|---|---|---|
| start | 🌟 | 起点 |
| battle | ⚔️ | 普通战斗 |
| elite | 💀 | 精英战斗（必掉 SR） |
| boss | 👑 | 关末 boss |
| event | ❓ | 楼层事件（神秘宝箱 / 神秘流浪者 / 神坛 / 赌徒等） |
| forge | 🔨 | 铁匠铺（用碎片附魔 / 染色） |
| shop | 🛒 | 商店（碎片换牌 / 卖牌） |

### 9.3 楼层 scale（伤害缩放）

每张 CardInstance 创建时记录创建时楼层 `inst.scale = floorScale(floor)`，影响：
- 武器攻击伤害（最终乘）
- DoT 数值（中毒 / 燃烧 / 出血）通过 maxHP 自动 scale

---

## 10. 灵魂碎片与附魔

### 10.1 5 种族碎片

| 种族 | 碎片名 | icon |
|---|---|---|
| beast 兽 | 兽魂 | 🐾 |
| humanoid 人型 | 灵魂石 | 💎 |
| undead 不死 | 怨念 | 👻 |
| giant 巨怪 | 巨魂 | 🗿 |
| dark 暗影 | 暗影碎片 | 🌑 |

普通敌人击杀 1 个碎片；精英 +SR 掉落（玩家可选接受/弃掉，见 modal）。
**giant / dark 是稀少种族**（碎片更难凑），对应附魔档位更高。

### 10.2 13 种附魔（5 普通 + 8 复合）

| ID | 名 | 配方 | 分支 |
|---|---|---|---|
| `e_brawler` | 强袭 | 兽 ×3 | ♠ |
| `e_strategist` | 算计 | 人 ×3 | ♣ |
| `e_reaper` | 收割 | 不死 ×3 | ♥ |
| `e_titan` | 撼地 | 巨 ×3（强档） | ♠ |
| `e_phantom` | 幻影 | 暗 ×3（强档） | ♦ |
| `ec_warblood` | 战狂血誓 | 兽 ×2 + 巨 ×2 | ♠ |
| `ec_phalanx` | 重甲列阵 | 兽 ×2 + 人 ×2 | ♠ |
| `ec_swift` | 风行步 | 暗 ×2 + 巨 ×2（究极） | ♦ |
| `ec_focus` | 凝神 | 不死 ×2 + 人 ×2 | ♦ |
| `ec_lifesteal` | 血祭仪 | 不死 ×2 + 暗 ×2 | ♥ |
| `ec_resilient` | 守护契 | 兽 ×2 + 不死 ×2 | ♥ |
| `ec_arcane` | 秘法回响 | 人 ×2 + 暗 ×2 | ♣ |
| `ec_runic` | 符文护盾 | 人 ×2 + 巨 ×2 | ♣ |

每种附魔 5 级（Lv1-Lv5），同附魔重附升 Lv，最高 5；换不同附魔重置 Lv1。
详细数值见 [`BALANCE_SHEET.md` § 附魔 · 5 档完整数值表](./BALANCE_SHEET.md#附魔--5-档完整数值表)。

---

## 11. Boss AI 流派

`types.ts:574 BossAIId`，共 11 种（5 基础 + 5 复合 + 1 演化）：

| ID | 名称 | 行为 |
|---|---|---|
| `berserker` | 狂战士 | HP 越低越猛 |
| `hunter` | 猎手 | 看玩家 HP 切策略 |
| `builder` | 构筑者 | 前堆 buff 后爆发 |
| `healer` | 医者 | 慢性 DoT 耗死玩家 |
| `reactor` | 报复者 | 隐式 react（玩家高输出/堆 buff 触发） |
| `dual_berserk` | 双面狂战 | 狂战 + 构筑 |
| `cold_hunter` | 冷血猎手 | 猎手 + 医者 |
| `fake_builder` | 假动作构筑 | 构筑 + 报复（30% 假动作） |
| `unstoppable_healer` | 不朽医者 | 医者 + 狂战 |
| `necro_hunter` | 死灵猎手 | 报复 + 猎手 + 医者（三流派） |
| `evolving` | 演化型 | F12 限定，3 阶段切复合流派 |

### 11.1 多动 AP

| Tier / Floor | AP（actions per turn） |
|---|---|
| 普通敌人 | 1 |
| 精英 F1-5 | 1 |
| 精英 F6-10 | 2 |
| 精英 F11+ | 3 |
| Boss F3/F6 | 2 |
| Boss F9 | 3 |
| Boss F12 | 4 |
| Boss F15+ | 3 |
| frozen / fear | 当回合限 1 动（无视 AP） |

### 11.2 F12 限定

`buffId: "double_debuffs"` — 玩家身上所有 debuff stack ×2（一次性）

---

## 12. 装备 / 护盾机制

### 12.1 双护盾模型

```
        重铠 → fullplate_pending → fullplate_shield (永远 1 层，不衰减)
                                                        ↓
                                              受击优先消耗这层
                                                        ↓
        其他来源 → shield_block (可叠加，♣ T1 时每回合 -1 衰减)
```

| 护盾 status | 上限 | 衰减 | 来源 |
|---|---|---|---|
| `fullplate_shield` | **1 层** | 不衰减不增长 | 重铠装备（受击 → pending → 下回合开局释放） |
| `shield_block` | 无上限 | 仅 ♣ T1 激活时每回合 -1 | sk_aegis / 镇守 keyword / 各种装备 / 影子杀手等 |

### 12.2 重铠（full_plate）流程

```
回合 N 受击 → 第 1 击触发 → 挂 1 层 fullplate_pending（首击限制）
                         ↓
                  后续受击不再加层（每回合首击限定）
                         ↓
回合 N+1 开局 → pending 释放 → 加 1 层 fullplate_shield
                         ↓
              如果 N 回合的 fullplate_shield 还在（未消耗）→ pending 丢弃，维持 1 层上限
```

**注**：pending 释放只看 pending 是否存在，**不再检查当前 armors[0] 是不是 full_plate**（避免 Epic 占位 / 换装备时卡死）。

### 12.3 Epic 装备临时槽

装备 Epic 时把当前装备塞进 `tempWeaponBackup` / `tempArmorBackup`，Epic 用尽 (3 次) 后自动恢复 backup。**比"替换 modal"更柔性，玩家不丢原装备**。

---

## 13. 完整卡牌索引

按 category 统计 v0.8.0 总数：

| 类别 | 数量 |
|---|---|
| attack 攻击牌（4 花色 1 张模板） | 1 |
| equipment 装备 | 40（≈ 11 武 + 10 防 / suit） |
| skill 技能 | 44 |
| item 道具 | 15 |
| perk 特性 | 17 |
| **合计** | **117 张卡定义** |

**完整数据表见 [`BALANCE_SHEET.md`](./BALANCE_SHEET.md)**：
- § ♠ 黑桃流 17 张
- § ♦ 方块流 15 张
- § ♥ 红心流 15 张
- § ♣ 梅花流 14 张
- § 无花色通用 59 张（44 技能 + 15 道具）
- § 附魔 5 档完整数值表

### 13.1 稀有度与花色对应

| 稀有度 | 出现层 | 数量级 |
|---|---|---|
| common | F1+ | 装备 4 / 技能 ~16 / 道具 ~5 |
| rare | F1+ | 装备 ~10 / 技能 ~14 / 道具 ~5 |
| rare_plus | F3+ | 装备 ~6 / 技能 ~6 / 道具 ~3 |
| super_rare | F5+ | 装备 ~6 / 技能 ~6 |
| epic | F7+ (Boss/Elite 限定) | ~6 张特殊 |

### 13.2 Epic 卡的限制

- 每场战斗使用 `EPIC_USES_PER_BATTLE = 3` 次
- 不计入花色亲和度（避免抢专精）
- 装备时进 tempArmorBackup / tempWeaponBackup，用完恢复原装备

---

## 14. 完整特性清单

17 个 perk，全部出现在 `PERK_POOL`（`cards.ts:2158`）：

| ID | 名称 | 单张效果 | 默认花色 |
|---|---|---|---|
| `p_bleed` | 流血 | 武器伤害 +5% / 张 | ♠ |
| `p_iron_will` | 钢铁意志 | HP ≤ 30% 时受击 -8% / 张 | ♠ |
| `p_executioner` | 处刑 | HP ≤ 30% 敌人攻击 +10% / 张（cap 30%） | ♠ |
| `p_insight` | 力量 | 同色不同花 +8% / 张（cap 25%） | ♠ |
| `p_armor_break` | 破甲 | pierce +1 / 张 | ♠ |
| `p_dodge` | 闪避 | 闪避率 +5% / 张（cap 50%） | ♦ |
| `p_crit` | 暴击 | 暴击率 +8% / 张（cap 100%） | ♦ |
| `p_swift_strike` | 疾风斩 | 本场首攻 +20% / 张 | ♦ |
| `p_coldblood` | 冷血 | 出血层数 +1 / 张（造成出血时） | ♦ |
| `p_vampire` | 吸血 | 攻击吸血 5% / 张 | ♥ |
| `p_regen` | 再生 | 每回合 +1 HP / 张 | ♥ |
| `p_lifetap` | 生命汲取 | 击杀回 5 HP / 张 | ♥ |
| `p_blood_pact` | 血誓 | 受伤 5% 转下张攻击 +伤（cap +6） | ♥ |
| `p_tough` | 强壮 | 受击 -10% / 张（floor 取整） | ♣ |
| `p_thorns` | 荆棘 | 反伤 2 / 张（受击给攻击者） | ♣ |
| `p_overload` | 过载 | 每回合首张非攻击牌 +1 摸 / 张 | ♣ |
| `p_resonance` | 同花共鸣 | 同色攻击连击 +1 伤 / 张 | ♣ |

详见 `cards.ts` 各 perk 定义的 `onAttack` / `onTakeDamage` / `perkEffect` 字段。

### 14.1 起手 perk 池

`newGame` 时从 PERK_POOL 抽 9 张让玩家 3 选 1 × 3 次（共选 3 个起手 perk）。

### 14.2 关末 reward_perk

每关末从 reward_perk pool 抽 3 张让玩家 1 选 1（可弃 → 改取 +HP）。

---

## 15. 核心常量速查

`types.ts` + `battle.ts` + `cards.ts` 汇总：

| 常量 | 值 | 含义 |
|---|---|---|
| `APP_VERSION` | `"0.8.0"` | 应用版本 |
| `STARTING_VITA` | 40 | 起手 HP |
| `STARTING_HAND` | 6 | 战斗开始摸牌 |
| `DRAW_PER_TURN` | 2 | 每回合摸 |
| `HAND_LIMIT` | 10 | 手牌上限 |
| `SLOT_CAP` | 4 | 武器/防具叠加上限 |
| `FIGHTS_PER_FLOOR` | 3 | 每关战斗数 |
| `STARTER_PERK_COUNT` | 3 | 起手特性数 |
| `STARTER_PERK_POOL_SIZE` | 9 | 起手特性 pool |
| `REWARD_CHOICE_COUNT` | 3 | 奖励 3 选 1 |
| `EPIC_USES_PER_BATTLE` | 3 | Epic 卡每场使用次数 |
| `SUIT_PLAYED_CAP` | 100 | 同色攻击牌累积上限 / 色 |
| 玩家闪避 cap | 75% | getCurrentDodgeChance |
| 玩家暴击 cap | 100% | p_crit stacks × 8% |
| 敌人 crit/dodge 削减 cap | -50 百分点 | 中毒/出血 |
| 中毒 DoT | maxHP × 1% × stacks / 回合 | 玩家受 status |
| 燃烧 DoT | maxHP × 2% × stacks / 回合 | 玩家受 status |
| 出血 DoT | HP × 5% × stacks / 回合 | 玩家受 status |
| 楼层数 | 12 | F1-F12 |
| 亲和度总 cap | 30 | getSuitAffinity clamp |
| Tier 阈值 | 5 / 10 / 15 | T1/T2/T3 |
| 大招消耗 | 8 亲和 | suitConsumedTotal 持久化 |

---

## 16. 版本变更日志

### v0.8.1（2026-05-13）audit bug fix

基于 [`MECHANICS_REVIEW_v0.8.0.md`](./MECHANICS_REVIEW_v0.8.0.md) 的 review 修两个真实代码 bug：

- **F12 终末降临 `double_debuffs` 加一次性标记**：之前 `executeBuffIntent` 没有 used 标记，
  F12 boss AP=4 + evolving AI 能反复抽到这招 → 玩家 debuff 被翻倍 2-3 次 → 最坏 40 HP/回合 团灭。
  现在 `enemy.aiState.terminalUsed` 首次触发置 true，后续直接跳过。
- **删除 `ENCHANT_DESCS` 死代码**：types.ts:273 旧固定描述，UI 实际全用 `getEnchantDescAt`（level-aware）。
  保留两份描述容易让 reviewer 误以为 UI 拉错描述，干脆删干净，让 `getEnchantDescAt` 成为唯一描述源。

**已知但本版未改**（design decision，等定方向）：

- §14 perk 文档 6 张机制描述 + 4 张 defaultSuit 仍与代码不一致（见 review §1）。
- 闪避来源超 cap 75% 后沉没（见 review §5）。
- ♣ T1 -3 在乘除链末端，F12 高伤场景效用低（见 review §6）。
- 暴击两套触发位置（p_crit vs ♦ T1 灵敏），目前数学等价但耦合脆弱（见 review §3）。

### v0.8.0（2026-05-13）首版机制文档

**重大调整**：
- 亲和度 cap：20 → **30**（留出大招消耗 8 后的再充能空间）
- 同色攻击 cap：30 → **100**（避免后期专精计数器锁死）
- Epic 装备**不再算亲和度**（避免抢走流派）
- 重铠：每回合**仅首击**形成 1 层蓄势；fullplate_shield 独立 1 层上限不衰减不增长
- 重铠 pending 释放不再依赖当前防具（修换装卡死）
- 复读机克隆 ephemeral：回合末消散，不进牌库 / 弃牌堆，跨战不污染
- 爆裂术：只扣 5% maxHP 的当前 HP，不再降 maxHP
- 符文护盾 DOT 免疫：上调到 **Lv5** 才解锁（v0.7 全 Lv 太强）
- 精英 SR 掉落 → 改 **modal 玩家选**（接受 / 弃掉）
- 商店地图节点 emoji 统一 🛒
- BLOCK 动画改金色（区分 MISS 蓝色）
- 受击减伤链补完整 log（♣T1 / 防具 / 特性 三段单独可见）

**新功能**：
- 调试控制台浮窗（`feature/debug-console` 分支，🐞 chip / backtick 开关，仅本地用）
- 汉堡菜单顶部版本号显示

---

## 维护规则

**每次发新版本**：

1. 在 `src/types.ts` 中 bump `APP_VERSION = "X.Y.Z"`
2. 在 `package.json` 中同步 bump `version`
3. `git mv GAME_MECHANICS_v<旧>.md GAME_MECHANICS_v<新>.md`
4. 在新文件顶部更新版本号 + "最后更新" 日期
5. 在 §16 版本变更日志加新条目（简短列改动）
6. 如果改了数值 → 重跑 `npx tsx scripts/dump-balance.ts` 重新生成 `BALANCE_SHEET.md`
7. commit：`docs: bump v<X.Y.Z> 机制文档`
8. 走正常 dev → main 流程

**修小 bug / 数值调整**：bump patch（0.8.0 → 0.8.1）
**新机制 / 新流派 / 重大重构**：bump minor（0.8.0 → 0.9.0）
**完整正式版**：bump major（0.x → 1.0.0）
