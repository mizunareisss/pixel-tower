# 机制分区注册表 · v0.8.2

> 这是游戏所有机制的**分区索引**。设计新机制 / 修平衡 / 重做附魔时，**先查这个表**决定归到哪个区。
>
> 配套代码：`src/battle.ts` 的 `calcAttackDamage()` 和 `damagePlayer()` 已按本表实装。

---

## 为什么要有"分区"？

塔牌经过 v0.8 多次扩展后，伤害公式累积了 20+ 个修饰项（乘法、加法、阈值、副作用混在一起）。旧设计每个机制随手 `dmg *= X` 或 `dmg += N`，导致：

- 后期满 buff 5-6 个乘数串联 → 单击 700+ 数值爆炸
- 加新机制时不知道乘哪里，撞旧机制
- 平衡 audit 困难（看不出哪条贡献多少）

v0.8.2 重构后，每个机制**归类到一个特定的区**：

- **区内同质**：同一区只允许一种运算（加法 / 乘法 / 减法）
- **区间隔离**：先算完阶段 N，再进阶段 N+1，互不干扰
- **新机制有归属**：设计时强制问"我这是 +% 还是 ×？"，避免乱乘
- **顶层调参**：每个公式有 GLOBAL 系数（全局升 / 降伤直接改这个常量）

---

## 攻击伤害公式（玩家 → 敌人）— 6 区

```
最终伤害 = ⌊((阶段1 × 阶段2 × 阶段3) − 阶段4) × 阶段5 × 阶段6⌋
```

### 阶段 1 基础区（flat）

```
base = ((wDef.baseDmg + warBannerBonus) × stackMult + Σ 早期 flat) × floorScale + Σ 后期 flat
```

| 类别 | 进区的具体机制 | 注释 |
|---|---|---|
| 武器基础 | `wDef.baseDmg × stackMult [1.0, 1.4, 1.8, 2.2]` | 1-4 件叠加 |
| ★ v0.8.2 武器修正 | `+ player.warBannerBonus`（在 ×stackMult **内**）| ♠ T1 战旗，每损 N% maxHP +1，cap +M |
| 早期 flat | `battle_cry +3` | 战吼 status |
| 早期 flat | `weapon_buff +stacks` | 强化药 it_elixir |
| 早期 flat | `frenzy +stacks×2` | 激奋 sk_frenzy |
| 早期 flat | `heavy_strike +10` | 旧机制，已无来源 |
| 早期 flat | `war_bow +3 if 敌HP>50%` | 狙击（hardcode） |
| 早期 flat | `berserker_blade +4 if HP<50%` | 狂剑（hardcode） |
| 早期 flat | `blood_pact_charge +N` | p_blood_pact 蓄势消耗 |
| 楼层缩放 | `× weapons[0].scale` | 武器实例创建时楼层定，固定不变 |
| 后期 flat | `calc_charge × mul` | mul = arcane_scepter(+3) + e_strategist + ec_focus + arcane_burst(+3) 之和 |
| 后期 flat | `forbidden_scepter + clubAff × 0.5` | 禁忌权杖 cap +10 |
| 后期 flat | `knight_charge × bonusPer[stack]` | 骑士铠充能 [3,4,5,6] |
| 后期 flat | `warblood_perm_atk +stacks` | ec_warblood 永久积累（legacy） |

**加新机制到这里的规则**：固定 +N（无论敌人/状态怎么变，加的都是同一个数）。

### 阶段 2 加成区（+%，加法堆叠）

```
addMult = 1 + Σ p_i   （cap 建议 ≤ +250% = addMult 3.5）
```

| 来源 | 触发条件 | 数值 | 累积上限 |
|---|---|---|---|
| 花色相性 | 同花克制 | +20% | — |
| 花色相性 | 异色 | −20% | — |
| 玩家 vulnerable | 受击 | （这是受击侧的）| — |
| 玩家 weak | 攻击 | −30% | — |
| 敌人 vulnerable | — | +30% | — |
| ♠ T1 锋锐 | active spade + tier≥1 | +15% | — |
| ♥ T2 绝境 | active heart + tier≥2 + HP<25% | +30% | — |
| `p_bleed` | 每张 | +5% / 张 | 无 cap（5 张 = +25%） |
| `p_insight` | 同色不同花 | +8% / 张 | cap +25% |
| `p_executioner` | 敌 HP≤30% | +10% / 张 | cap +30% |
| `p_coldblood` | 无 debuff | +8% / 张 | 无显式 cap |
| `p_resonance` | 同花攻击 | +8% / 张 | 无显式 cap |
| `p_swift_strike` | 本场 turn=1 首攻 | +20% / 张 | 每场仅触发 1 次 |
| `e_brawler` | HP<50% | +Lv% | Lv5 +18% |
| `ec_warblood` | HP<50% | +Lv% | Lv5 +30% |
| `ec_arcane` | 有染/咒 buff + 本场首攻 | +Lv% | Lv5 +50% |
| ★ v0.8.2 ♦ T2 连环 | 玩家身上每"种" debuff（毒/血/弱/易/燃） | +Lv% / 种 | Lv3 +8%/种 |
| ★ v0.8.2 花色大师 | 异色乘数 = Lv%（90/100/120）| -10% / 0% / 替代 +20% | Lv3 给所有花色发同色 +20% |

**加新机制到这里的规则**：百分比加成（+N% / 张 / 满足条件）。**绝不要用 ×N**！

**已知 cap 上限设计**：单 perk stack ≤ +30%，总加成建议 ≤ +250%。

### 阶段 3 倍率区（×，独立乘）

```
mulMult = ∏ m_j   （cap 建议 ≤ ×4.0）
```

**严格限制数量**——只放"消耗品 / 一次性触发"类机制：

| 来源 | 倍率 | 类型 |
|---|---|---|
| `sharpened` | ×1.5 | 一次消耗（磨刀石）|
| `double_strike` | ×2 | 一次消耗（旧）|
| `charged` | ×2.5 | 一次消耗（旧蓄力）|
| `e_reaper_buff` | ×Lv (1.4-1.75) | 击杀后一次消耗（legacy） |
| `phantom_charge` | ×Lv (1.5-2.3) | 闪避后一次消耗（legacy） |
| ★ v0.8.2 ♥ T1 猎食者 | ×Lv (1.4 / 1.5 / 1.7) | 消耗 1 huntStack（跨战斗累积）|
| ★ v0.8.2 ♠ T3 斩首 | ×Lv (2.0 / 2.5 / 3.0) | 消耗 decap_charge（弃≥N张激活，强制 hits=1）|

**加新机制到这里的规则**：**只允许"一次性消耗"的×N**。持续 buff 必须进阶段 2。

### 阶段 3.5 阈值附魔（依赖中间 dmg = base × add × mul）

| 附魔 | 触发条件 | 效果 |
|---|---|---|
| `e_titan` | dmg ≥ 敌 maxHP × 8% | × (1 + Lv%) |
| `ec_focus` | dmg ≥ threshold(Lv) | + bonus(Lv) flat |

**说明**：这些必须在 base × add × mul 算完后才能判断阈值。归类上算"伪倍率区"。

### 阶段 4 防御区（减法）

```
dmg = max(0, dmg − max(0, enemyArmor − pierce))
```

| pierce 来源 | 贡献 |
|---|---|
| `wDef.pierce` | 武器基础 pierce（long_sword 3 等）|
| `p_armor_break` × stacks | +1 / 张 |
| `raider` | + ⌈敌armor × 50%⌉ |
| `excalibur` | + ⌈敌armor × 70%⌉ |
| `berserker_blade` + HP<50% | +2 |
| ♠ T2 active | +1 |
| ♠ T2 + ♠ 攻 | + max(1, ⌈floor/4⌉) |
| `pierce_perm` (穿甲油) | +stacks |
| `pierce_bonus` (穿甲斩) | +stacks（消耗）|

| bypassArmor 来源 | 效果 |
|---|---|
| `pierce_next` status | 本次完全无视 armor（消耗）|
| 附魔 `bypassArmor` callback | 附魔自定义条件 |

**加新机制到这里的规则**：要么贡献 pierce 数值，要么设 bypassArmor。

### 阶段 5 全局调参（顶层乘数）

```
dmg × GLOBAL_DMG_MULT   （默认 1.0）
```

**仅用作整体调参**。如果某次平衡 audit 发现伤害普遍高 20%，**只改这一个常量**为 0.83。

### 阶段 6 暴击（每 hit 独立 roll）

| 来源 | 暴击率 | 倍率 |
|---|---|---|
| `p_crit` × stacks | min(100, stacks × 8)% | ×2 |
| ♦ T1 灵敏 keyword | 10%（仅 ♦ 攻） | ×2（独立 roll，在 playAttack 里） |

| 削减 | 数值 |
|---|---|
| 玩家中毒 stack | −min(50, stacks × 5) 百分点 |

---

## Hits 分区（v0.8.2 Round 2-C）

```
hits = min(HITS_CAP, (基础 + Σ 加成) × ∏ 倍率)
HITS_CAP = 8
```

**为什么独立成区**：旧公式 `(weaponHits + bonuses) * tripleMult` 没上限，叠满 buff 后 5×3=15 hits，单回合伤害不可控。Round 2 把 hits 拎出来做分区，硬封顶 8。

### 阶段 A 基础区（flat）

| 来源 | 数值 | 注释 |
|---|---|---|
| `wDef.hits` | 默认 1 / dual_blades 2 / wind_blade 2 | 武器定义 |

### 阶段 B 加成区（+N，加法）

| 来源 | 触发条件 | 数值 |
|---|---|---|
| `shadow_double` status | 影袭蓄势 / 不朽战甲 | +1（消耗）|
| ♦ T2 灵巧连击 | active diamond + tier≥2 | +1（30% roll）|
| ♦ T1 灵敏 keyword | active diamond + tier≥1 + ♦ 攻 | +1（25% roll）|
| ★ v0.8.2 ♦ T1 夜行 | status `night_walk` 在场 | +1（开局 N 回合）|
| ★ v0.8.2 ♦ T3 阴影分身 | status `shadow_clone_active` 在场 | +2（弃≥3 张激活，持续 1/2/3 回合）|
| ★ v0.8.2 ♠ T2 无影连斩 | status `combo_unlock` 在场 | +1（连续命中 N 次解锁，本场永久）|

### 阶段 C 倍率区（×，独立乘）

| 来源 | 数值 | 注释 |
|---|---|---|
| `triple_strike` (♦ 大招 影子杀手) | ×3 | 一次性消耗 |

**加新机制到倍率区的规则**：极度克制 — 这一区现在只有 1 个来源，新增需严肃评估 cap 风险。

### 阶段 D 上限（含 ♠ T3 强制覆盖）

`hits = min(8, decap ? 1 : (A + B) × C)`

- 普通流程：`hits = min(8, (A + B) × C)`
- ♠ T3 斩首激活时：`hits = 1`（即使有 hits+X buff，也强制为 1；倍率在阶段 3 区独立消耗）

最坏极限（无斩首）：基础 2 + 加成 6（夜行+分身+连斩+灵敏+灵巧+影袭）= 8 → 触底 hits cap。三连击 ×3 → cap 至 8。

---

## 受击伤害公式（敌人 → 玩家）— 5 区

```
最终受击 = ⌊((base × 阶段1 − 阶段2) × 阶段3 − 阶段4) × 阶段5⌋
```

### 闪避路径（优先级 0-3，任一触发即免疫 return）

| 优先级 | 来源 | 状态 |
|---|---|---|
| 0 | `dodge_full_round` | ♦ T3 大招本回合 |
| 1 | `guaranteed_dodge` | `sk_step` 风步（消耗）|
| 2 | `dodgeChance` roll | 由 `getCurrentDodgeChance()` 汇总（见下）|
| 3 | `enc_runic_immune` 首次受击 | Lv1-2: 50% / Lv3+: 100% |

#### 闪避率汇总（cap 75%）

| 来源 | 贡献 |
|---|---|
| `mind_armor` ×stacks | +10% / 件（最多 4 件 = 40%） |
| `p_dodge` ×stacks | min(50, stacks × 5)% |
| `smoke_dodge` status | +stacks% |
| `ec_swift` 附魔 | +Lv% (9/10/11/13/15) |
| `swift_dodge_temp` status | +stacks% |
| ♦ T1 active | +8% |
| 玩家 bleed stack | −min(50, stacks × 5) 百分点 |
| **总 cap** | **75%** |

### 阶段 1 易伤区

| 来源 | 触发 | 倍率 |
|---|---|---|
| `vulnerable` status | 玩家身上有 | × 1.3 |

### 阶段 2 固定减伤（Σ -N，加法堆叠）

| 来源 | 触发 | 数值 |
|---|---|---|
| `ec_resilient` 附魔 | 总是 | −Lv (1/1/1/2/2) |
| `ec_resilient` HP>80% 额外 | — | −Lv (1/1/2/2/2) |
| `ec_runic` 附魔 | 总是 | −Lv (1/2/3/3/4) |
| `phalanx_dr` status | ec_phalanx 触发 | −stacks |
| ♣ T1 魔法庇护 | active club + tier≥1 | −3 |
| 防具 `onTakeDamage` flat 返回 | 探测 callback 减少量 | 见 cards.ts 各防具 |

#### 防具 flat 数值（从 callback 探测得到）

| 防具 | 1 件 | 2 件 | 3 件 | 4 件 |
|---|---|---|---|---|
| black_shield | -3 | -4 | -5 | -7 |
| round_shield | -3 | -4 | -5 | -7 |
| leather_armor | -1 | -1 | -2 | -2 |
| cloak | -1 | -1 | -2 | -2 |
| mage_robe | -1 | -1 | -2 | -2 |
| mind_armor | -1 | -1 | -1 | -1 |
| heavy_armor | -4 | -5 | -7 | -9 |
| full_plate (重铠) | -5 | -7 | -9 | -12 + 反震 |
| scale_mail | -2 | -3 | -4 | -5 + 反伤 |
| crown_of_vitality | -2 | -3 | -4 | -5 |
| draining_shield | -2 | (按 stack) | | |
| life_pouch | -1 | (按 stack) | | |
| phantom_cloak | -2 | | | |
| undying_heart | -2 | | | |
| immortal_plate | -4 (固定) | | | |

### 阶段 3 减伤倍率（∏ ×<1，乘法堆叠）

| 来源 | 触发 | 倍率 |
|---|---|---|
| ♥ T2 绝境 | active heart + tier≥2 + HP<50% | × 0.7 |
| `evasive` status | 屏息（sk_evasive） | × 0.7 |
| `p_tough` × stacks | — | × (1 − min(0.30, 0.03 × stacks)) |
| `p_iron_will` × stacks | HP ≤ 30% | × (1 − 0.08 × stacks) |
| `crown_of_vitality` | HP < 30% | × 0.5（v0.8.2 拆分自旧 callback）|

**加新机制到这里的规则**：百分比减伤（× X，X < 1）。

### 阶段 4 护盾吸收

```
absorbed = min(shield.stacks, dmg)
```

**优先级**：
1. `fullplate_shield`（重铠护盾，独立 1 层）
2. `shield_block`（镇守 / sk_aegis / 木盾杖 / e_phantom_charge 等共享 status）

特殊触发：
- ♣ T2 反应装甲：`shield_block` 最后一层失效时 25% 给攻击者 +1 易伤（3 回合）

### 阶段 5 全局调参

```
dmg × GLOBAL_DEF_MULT   （默认 1.0）
```

**仅用作整体调参**。"想让玩家变更耐打 15%" → `GLOBAL_DEF_MULT = 0.85`。

### 完全格挡判定

```
if (base > 0 && final == 0) → BLOCK 动画 + pendingBlockFx++
```

---

## 受击后副作用（不影响本次受击量，但触发于受击事件）

这些不在公式内，但 `damagePlayer` 在受击后会触发：

| 来源 | 副作用 |
|---|---|
| `combat_belt` | 给 `battle_cry` +2（下次攻击 +2）|
| `knight_plate` | 给 `knight_charge` +1 stack（cap 3）|
| `soulreaver_plate` | 给 `warblood_perm_atk` +1（cap 10）|
| `immortal_plate` | 给 `shadow_double` +1（下次攻击 +1 hit）|
| `full_plate` (重铠) | 给 `fullplate_pending` +1（下回合释放为 fullplate_shield）|
| `p_thorns` | 反伤给攻击者（= 受击伤害 × 10% × stacks，cap 80%）|
| `thorn_armor` | 反伤给攻击者（固定数）|
| `scale_mail` | 反伤给攻击者（按 stack）|
| `p_blood_pact` | 攒 `blood_pact_charge`（受击 5% 转 flat，cap +6/张）|
| `counter_stance` | 反击姿态：反弹 50% 给攻击者 |
| `undying_heart` | HP=0 时复活到 50%（整局 1 次）|

---

## 攻击后副作用（不修改本次伤害值，但触发于攻击事件）

| 来源 | 触发条件 | 副作用 |
|---|---|---|
| 武器吸血 (dagger / vampire_fang / blood_blade / everlast_fang) | 攻击命中 | 按 d × % 回血 |
| `ec_lifesteal` | 攻击命中 | 吸血 + 满血额外 +N% 攻 |
| `p_vampire` | 攻击命中 | 回 d × 5% × stacks |
| ♥ T1 贪婪 keyword | ♥ 攻命中 | 回 d × 10% |
| `e_reaper` | 击杀敌人 | 挂 `e_reaper_buff`（下次攻击 ×N，进阶段 3）|
| `e_phantom` | 闪避后 | 挂 `phantom_charge`（下次攻击 ×N，进阶段 3）|
| `everlast_fang` | 击杀敌人 | 额外 +20% maxHP 回血 |
| `blood_blade` | 击杀敌人 | 额外 +20% maxHP 回血 |
| `lifebloom_staff` | 出技能/道具 | 回 maxHP × 2-5% |
| 攻击命中 +debuff | 各 | 见下表 |

### 攻击命中给敌人加 debuff

| 来源 | 触发条件 | 加什么 |
|---|---|---|
| `battle_staff` | 每次攻击 | +2 易伤 / 2 回合 |
| `giant_hammer` | 单击 ≥ 敌 maxHP × 25% | 50% 概率沉默 1 回合 |
| `sk_poison_blade` | 出牌 | 给目标 +2 中毒 |
| `sk_curse_blood` | 出牌 | 给目标 +X 出血 |
| `sk_blade_slash` | 出牌 | 给目标 +1 出血 |
| ♠ T1 锐利 keyword | ♠ 攻命中 | 45% 概率 +1 出血 |
| ♣ T1 镇守 keyword | ♣ 攻命中 | 给玩家 +1 临时护盾（shield_block）|
| `next_atk_apply_poison` (箭毒蛙) | 下击 | 给目标 +X 中毒 |
| `next_atk_apply_bleed` (抗凝血) | 下击 | 给目标 +X 出血（2 回合）|

### 闪避后副作用 (onDodgeTriggered)

| 来源 | 副作用 |
|---|---|
| `wind_blade` | 给 `shadow_double` +1（下次 +1 hit）|
| `phantom_cloak` | +1 摸 |
| `ec_swift` 附魔 | 给敌易伤 + 自己 `swift_dodge_temp` +N% |
| `e_phantom` 附魔 | 挂 `phantom_charge`（下次攻击 ×N）|

---

## 回合开始副作用（startNewPlayerTurn 内）

| 来源 | 效果 |
|---|---|
| `life_pouch` 装备 | +3% maxHP × stacks |
| `p_regen` | +3% maxHP × stacks |
| `draining_shield` | 上回合 `draining_charge` stacks 全部回血 |
| `p_overload` | +stacks 摸（cap 4）|
| `p_lifetap` | 自损 2% maxHP + 伤敌 5% × stacks maxHP |
| `heavy_armor` | 30% 概率随机去 1 debuff |
| `ec_phalanx` 未受伤 | 下回合开局护盾 +K |
| ♥ T1 生机 | +5 HP |
| `brew_regen` | +stacks HP |
| `fullplate_pending` → `fullplate_shield` | 释放重铠护盾 |
| DOT 衰减 | poison/bleed 扣血 + stacks-1，burn 扣血 |

---

## 平行伤害系统（不走 6 区公式）

`dealDirectDamage()` → `damageEnemy()` 直接扣 HP，**完全跳过 armor / vulnerable / 易伤 / 虚弱 / pierce / 任何 buff**。

### 走平行系统的伤害源

| 来源 | 伤害公式 |
|---|---|
| `sk_blast` (爆裂术) | 敌当前 HP × 20% 直伤 |
| `sk_dbl_pummel` (双重打击) | (4 + floor) 直伤 + 易伤 |
| `sk_chain_bolt` (链电) | 各敌 maxHP × 4% |
| `sk_lightning` (闪电链) | （群伤）|
| `sk_chroma_wave` (混色波) | （群伤）|
| `sk_phantom_edge` (神锋无影) | （群伤）|
| `sk_wrath` (众神之怒) | （群伤）|
| `sk_shockwave` (震荡波) | （群伤）|
| `sk_drain_strike` (汲血斩) | （单体）|
| `sk_blade_slash` (利刃) | （单体）|
| `it_bomb` (炸弹) | (5 + floor) 直伤 |
| `p_thorns` 反伤 | 受击伤的 10% × stacks |
| `thorn_armor` / `scale_mail` 反伤 | 固定数 |
| `sk_counter_stance` 反击 | 受伤 × 50% |
| `p_lifetap` 伤敌 | 玩家 maxHP × 5% × stacks |
| `chain_blade` 溅射 | 固定 3-6 给其他敌人 |
| Boss `double_debuffs` | 玩家身上 DOT stacks ×2（间接）|

**设计取向**：这些**故意**绕过减伤系统，作为"无法被防御抗住的特殊伤害源"存在。如果未来想让某条直伤进公式（如让易伤对炸弹生效），需要专门改 `dealDirectDamage`。

---

## 其他非伤害公式机制（不属任何区）

### 攻击次数维度（hits +1）

| 来源 | 效果 |
|---|---|
| `dual_blades` | baseDmg=3, hits=2 |
| `wind_blade` | baseDmg=4, hits=2 |
| `shadow_double` status | 下次攻击 +1 hit |
| `triple_strike` status | 下次攻击 hits ×3（♦ T3 大招）|
| ♦ T1 灵敏 keyword | 25% 概率 ♦ 攻 +1 hit |
| ♦ T2 灵巧连击 | 30% 概率额外 +1 hit |
| `immortal_plate` 受击后 | 给 `shadow_double` |
| `repeating_bow` | 每回合可出多张攻击牌（多次 calcAttack） |

→ 这些走 `playAttack` 的 hits 循环，每个 hit 独立调 `calcAttackDamage`。攻击次数维度跟伤害公式正交。

### 染色 / 持咒（覆盖攻击花色）

| 来源 | 效果 |
|---|---|
| `dyed_X` status | 本回合攻击牌视为 X 色 |
| `chanted_X` status | 本场战斗内攻击牌视为 X 色 |
| `attuned` status | 共鸣咒：敌人花色被改 |

→ 在 `calcAttackDamage` 顶部判断 `getDyedSuit(player)` 覆盖 `attackSuit`，影响阶段 2 花色相性 / perk 同花条件 / ♠♥♣♦ 关键字。

### 摸牌 / 弃牌经济

| 来源 | 效果 |
|---|---|
| `STARTING_HAND = 6` | 战斗开始摸 |
| `DRAW_PER_TURN = 2` | 每回合摸 |
| `HAND_LIMIT = 10` | 手牌上限 |
| `sk_focus` 聚气 | +1 摸 |
| `sk_quick_draw` 快摸 | +N 摸 |
| `sk_rhythm` 战斗节奏 | 本回合每打 1 张 +1 摸 |
| `ec_arcane` 附魔 | 非攻牌下回合开局 +1 摸（cap 3）|
| `p_overload` | 每回合开始 +1 摸 / 张（cap 4）|
| `mage_robe` 装备 | 出技能/道具时 +1 摸 |
| `phantom_cloak` 闪避后 | +1 摸 |
| `arcane_burst` status | 本回合每非攻牌下击 +calc_charge |
| `echo` status (复读机) | 本回合非攻牌复制回手（ephemeral）|

### 状态衰减规则（startNewPlayerTurn 内）

| status | 衰减规则 |
|---|---|
| `poison` | duration>0 -1；每回合扣 maxHP × 1% × stacks；衰减 stacks-- |
| `burn` | duration>0 -1；每回合扣 maxHP × 2% × stacks；无 stacks 衰减 |
| `bleed` | duration>0 -1；每回合扣 HP × 5% × stacks；无 stacks 衰减 |
| `shield_block` | ♣ T1 active 时每回合 -1 stack；其他来源 keep |
| `fullplate_pending` | 转 `fullplate_shield`（1 层独立护盾，下回合开始）|
| `fullplate_shield` | 不衰减（不增不减，吸收完即移除）|
| ephemeral 卡（复读机克隆）| 战斗结束时被 `newBattle` 过滤 |

---

## 设计新机制时的决策流程

```
新机制是否修改伤害？
├── 是
│   ├── 修改玩家造成的伤害？
│   │   ├── +N 固定（不随状态变）         → 阶段 1（基础区）
│   │   ├── +N%（按比例 / 满足条件）       → 阶段 2（加成区）
│   │   ├── ×N（一次性消耗 / 一次性触发）   → 阶段 3（倍率区）
│   │   ├── ×N（依赖中间 dmg 判断阈值）    → 阶段 3.5
│   │   ├── 改 pierce / 改 armor          → 阶段 4
│   │   └── 暴击 / per-hit roll           → 阶段 6
│   │
│   └── 修改玩家受到的伤害？
│       ├── 全免疫 / 闪避 / 减 %（首次受击专属）→ 闪避路径
│       ├── 受伤 +30%（易伤）                  → 阶段 1
│       ├── -N 固定                            → 阶段 2
│       ├── ×N（N<1，按比例 / 满足条件）        → 阶段 3
│       ├── 护盾吸收                           → 阶段 4
│       └── 整体调参                           → 阶段 5
│
└── 否（机制不直接改伤害）
    ├── 攻击命中触发（+debuff / 吸血 / 上 status）→ 攻击后副作用
    ├── 击杀触发（回血 / 挂 buff）             → 攻击后副作用
    ├── 闪避触发                              → onDodgeTriggered
    ├── 受击触发（不影响本次受击量）             → 受击后副作用
    ├── 回合开始触发                          → startNewPlayerTurn
    ├── 摸牌 / 出牌 / 弃牌                     → 出牌系统
    ├── 改攻击次数 / hits                      → playAttack 循环
    ├── 改攻击花色（染色 / 持咒）                → 染色系统
    └── 直接扣 HP（无视一切）                   → 平行系统 dealDirectDamage
```

---

## 已知边界 case 备忘

1. **`crown_of_vitality` 拆分**（v0.8.2 已修）：原 callback 内混合 flat -reduce + ×0.5 mul。现 callback 只做 flat（进阶段 2），×0.5 在 `damagePlayer` 阶段 3 hardcode。
2. **calc_charge 累积加成**：`e_strategist` / `ec_focus` / `arcane_scepter` / `arcane_burst` 共用同一 status，每个非攻牌 +1 stack，攻击时合并计算并消耗。归后期 flat。
3. **e_titan / ec_focus 阈值判断**：必须在 base × add × mul 算完之后才能判断 `dmg ≥ threshold`，所以单列阶段 3.5。
4. **武器吸血 callback**：dagger / vampire_fang / blood_blade / everlast_fang 的 `onAttack` 调用时机在阶段 3 之后（即基于已应用加成/倍率的 dmg）。如果想让吸血基于"最终 dmg"，需要把 callback 调用挪到阶段 4 之后。
5. **`pierce_next` (穿甲射) 一次性 bypass**：触发后 bypassArmor=true，跳过阶段 4。注意要 consume。
6. **♥ T1 贪婪 keyword**：在阶段 5 之后用 final dmg 算回血。比放 callback 早期算更合理（玩家伤越高回越多）。

---

## 配套代码索引

- 公式实装：`src/battle.ts`
  - `calcAttackDamage()` 攻击 6 区
  - `damagePlayer()` 受击 5 区
  - `getCurrentDodgeChance()` 闪避汇总
  - `GLOBAL_DMG_MULT` / `GLOBAL_DEF_MULT` 全局阀
- 机制定义：`src/cards.ts`
  - `perkEffect` / `equipEffect` / `ENCHANT_EFFECTS`
  - 顶部注释列了"修改 callback 时的归区规则"
- 跳过 callback 的列表：`src/battle.ts`
  - `SKIP_WEAPON_CALLBACK = ["war_bow", "berserker_blade"]`
  - `SKIP_ENCHANT_CALLBACK = ["e_brawler", "e_titan", "e_reaper", "e_phantom", "ec_warblood", "ec_arcane", "ec_focus"]`
  - `SKIP_PERK = ["p_tough", "p_iron_will"]`

---

## 改本表的规则

每次：
- 新增 perk / 装备 / 附魔 / 技能
- 改 perk / 装备 / 附魔的 callback 机制
- 调 perk / 装备的数值参数

**必须**回来同步更新本表的对应行。否则未来 audit 时找不到机制归属，会重新落入混乱。

---

## v0.8.2 新 14 附魔分区总览

| 附魔 | 流派 | 配方 | 实装区位 | 触发器 |
|---|---|---|---|---|
| ench_war_banner ♠T1 战旗 | ♠ | 兽×3 | 阶段 1 基础区（baseDmg + warBannerBonus）| triggerSelfDamageHooks 累损血 |
| ench_endless_combo ♠T2 连斩 | ♠ | 兽×2+人×2 | Hits 加成区（status: combo_unlock）| 命中 N 次解锁，每场 1 次 |
| ench_decap ♠T3 斩首 | ♠ | 兽×2+人×2+巨×1 | 阶段 3 倍率区 + Hits 强制=1 | 弃≥N 张激活 |
| ench_night_walk ♦T1 夜行 | ♦ | 人×3 | Hits 加成区（status: night_walk）| newBattle 挂 status duration=N |
| ench_chain ♦T2 连环 | ♦ | 人×2+死×2 | 阶段 2 加成区 | 玩家身上每"种" debuff +Lv% |
| ench_shadow_clone ♦T3 阴影分身 | ♦ | 人×2+死×2+暗×1 | Hits 加成区（status: shadow_clone_active）+ 阶段 1 易伤（自挂）| 弃≥3 张激活，持续 1/2/3 回合 |
| ench_hunter_heart ♥T1 猎食者 | ♥ | 死×3 | 阶段 3 倍率区 + 阶段 5 后吸血副作用 | 击杀 +1 huntStack（跨战斗），每命中按 N% 吸血 |
| ench_glutton ♥T2 饕餮 | ♥ | 死×2+兽×2 | 吸血副作用（applyLifesteal helper）| 溢出 maxHP 转护盾（5/3/2 HP : 1 护盾） |
| ench_blood_anoint ♥T3 血涂 | ♥ | 死×2+兽×2+暗×1 | triggerEnemyKillHooks（damageEnemy 内）| 击杀 +N% × target.maxHp 给 player.vitaMax（本场） |
| ench_curse_ring ♣T1 咒环 | ♣ | 人×3 | playSkillOrItem 末 + discardHandCards 内 | 出技能 / 主动弃攻击牌 roll N% 摸 1 |
| ench_curse_shift ♣T2 转嫁 | ♣ | 人×2+兽×2 | playSkillOrItem 末 | 出技能命中（非 self）N% 转 player debuff 给敌 |
| ench_purge_vortex ♣T3 净化漩涡 | ♣ | 人×2+兽×2+巨×1 | discardHandCards 内 | 单次弃 ≥4 张：+护盾 + 本回合新 DOT 免疫 |
| ench_element_master 元素大师 | master | 巨×3+暗×3 | DOT 应用 / tick 入口检查 | Lv1/2/3 → 免疫 中毒 / +燃 / +血 |
| ench_suit_master 花色大师 | master | 巨×3+暗×3 | 阶段 2 花色相性乘数改写 | Lv1/2/3 → 异色 -10% / 0% / 替代 +20% |

### v0.8.2 PlayerState 新字段
| 字段 | 范围 | 用途 |
|---|---|---|
| `huntStacks` | 跨战斗保留 | ♥T1 猎食者 |
| `warBannerBonus` | 单场（newBattle 重置）| ♠T1 战旗累加 |
| `warBannerLossAcc` | 单场 | ♠T1 战旗累积已损血用于触发 |
| `combo` | 单场 | ♠T2 连斩计数 |
| `comboUnlocked` | 单场 | ♠T2 是否已解锁 |
| `bloodAnointBonus` | 单场（newBattle 时 vitaMax 减回去）| ♥T3 血涂本场累积 |

### 跨系统事件总线（v0.8.2 Round 2）
| 入口函数 | 在哪触发 | 监听者 |
|---|---|---|
| `triggerSelfDamageHooks(c, amount)` | dealSelfDamage / damagePlayer / DOT tick | took_damage_turn / p_blood_pact / **♠T1 战旗** |
| `triggerEnemyKillHooks(c, target)` | damageEnemy 内 alive 翻转 + awardFragments 兜底 | 武器击杀回血 / 附魔 onKill / **♥T1 +stack** / **♥T3 +maxHP** |
| `applyLifesteal(c, amount, source)` | 所有吸血点（武器 / ♥T1 / 血契等）| HP 加 + **♥T2 饕餮溢出转护盾** |
| `isDotImmuneByElementMaster(player, dot)` | DOT 应用 + tick 入口 | **元素大师** |
| `isNewDotImmuneByPurgeVortex(player)` | DOT 应用入口 | **♣T3 净化漩涡** 本回合新增 DOT |
| `discardHandCards(state, uids)` hook | game.ts 主动弃牌 | **♣T1 咒环 / ♣T3 漩涡 / ♠T3 斩首 / ♦T3 分身** 激活
