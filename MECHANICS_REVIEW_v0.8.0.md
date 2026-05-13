# 塔牌 · Suitspire v0.8.0 机制文档检查报告

**检查对象**：[GAME_MECHANICS_v0.8.0.md](./GAME_MECHANICS_v0.8.0.md)
**对照代码**：`src/types.ts` / `src/battle.ts` / `src/cards.ts` / `src/enemies.ts` / `src/bossAI.ts`
**报告日期**：2026-05-13
**检查方式**：逐节读文档 + 读代码核对公式 + Node.js 数值模拟（脚本：`/tmp/suitspire_sim.mjs`）

---

## 概要

文档整体结构清晰、公式逻辑也基本能跟代码对得上，但存在以下问题：

- **第 14 节「完整特性清单」与 [cards.ts](src/cards.ts) 实际定义有 6 张机制不同 + 4 张默认花色错位** —— 直接影响玩家 build 决策，必须优先修复。
- **附魔有两套不同步的描述数据源**（`ENCHANT_DESCS` 旧固定值 vs `ENCHANT_LEVEL_PARAMS` 5 档表），存在 UI / tooltip 拉错描述的风险。
- **暴击实现两套并存**，触发位置不同，目前不出 bug 但是耦合脆弱。
- **F12 终末降临 `double_debuffs` 不是"一次性"**，会被反复抽到，可能多次翻倍玩家身上的 debuff。
- **闪避来源数量超过 cap 75% 后多源沉没**，ec_swift Lv5 / 风行余势在 cap build 下全废。
- 模拟显示 F12 boss 是 build 门槛极陡的关卡，**莽夫流（♠ 纯输出）几乎单走不了 F12**。

---

## 一、严重：第 14 节「完整特性清单」与代码不符

文档 §14（17 张 perk）有 6 张机制描述错误、4 张默认花色错位。代码定义见 [cards.ts:1612-1879](src/cards.ts:1612)。

### 1.1 机制描述错位

| ID | 文档说 | 代码实际 | 偏差程度 |
|---|---|---|---|
| `p_regen` | 每回合 +1 HP / 张 | 每回合 +3% maxHP / 张（min 1） | 公式不同：40 HP 时碰巧 ≈ 1，80 HP 时 = 2.4 |
| `p_tough` | 受击 -10% / 张 | 受击 -3% / 张（cap 30%） | 数值变成 1/3 + 多了 cap |
| `p_thorns` | 反伤 **2 / 张**（定值） | 反伤 = **受到伤害的 10% / 张**（cap 80%） | 完全不同的机制类别 |
| `p_lifetap` | **击杀回 5 HP / 张** | 每回合自损 2% maxHP，伤敌 = maxHP × 5% × stacks | 完全不同的机制类别 |
| `p_overload` | 每回合**首张非攻击牌** +1 摸 / 张 | 每回合开始固定额外摸 stacks 张（cap 4） | 触发条件 + 计数法都不同 |
| `p_coldblood` | 造成出血时出血层数 +1 / 张 | **无 debuff 时攻击 +8% / 张** | 完全不同的机制类别 |

### 1.2 默认花色错位

`defaultSuit` 影响花色亲和度归属（每张 +0.8 aff），错了会导致玩家以为某个 perk 给某流派加 aff，实际加给了另一个流派：

| ID | 文档 | 代码实际 |
|---|---|---|
| `p_lifetap` | ♥ | **♣** |
| `p_overload` | ♣ | **♦** |
| `p_resonance` | ♣ | **♥** |
| `p_coldblood` | ♦ | **♣** |

### 1.3 处理建议

按 [cards.ts:1612-1879](src/cards.ts:1612) 实际定义重写 §14 表格。需要决定的是"以代码为准更新文档"还是"以文档为准修代码"——目前看代码里的机制是经过 v0.7/v0.8 多次 rebalance 的结果，文档大概率是没跟着改。

---

## 二、严重：附魔有两套不同步的描述数据源

[types.ts:273-287](src/types.ts:273) 的 `ENCHANT_DESCS` 是旧版固定值（`e_brawler` 写 "+12%"、`e_titan` 写 "+25%" 等），但实际生效的是 [types.ts:333-349](src/types.ts:333) 的 `ENCHANT_LEVEL_PARAMS` 5 档表（`e_brawler` Lv1-5 = 10/12/14/16/18）。

`getEnchantDescAt()` 已经按 Lv 正确出描述，但凡 UI / tooltip / 其他模块还在引用 `ENCHANT_DESCS` 就拉到错的描述。

文档 §10 的「13 种附魔」表抄的是哪一份要明确（目前看像是 `ENCHANT_DESCS`）。

### 处理建议

- 删除 `ENCHANT_DESCS`，让 `getEnchantDescAt(id, level)` 成为唯一描述源。
- 全局搜索 `ENCHANT_DESCS` 的引用，逐一改成 `getEnchantDescAt`。
- 文档 §10 改用 "Lv1: X / Lv5: Y" 的两端范围描述。

---

## 三、中等：暴击有两套并存系统，触发位置不同

文档 §5.1 把 `p_crit` 和 `♦ T1 灵敏` 列在一张表里，描述成"per-hit roll"。但实际两者触发位置不同：

| 暴击源 | 触发位置 | 乘的是什么 dmg |
|---|---|---|
| `p_crit` 特性 | calcAttackDamage 步骤 6（特性 onDealDamage 内，见 [cards.ts:1657-1664](src/cards.ts:1657)） | 半成品：武器 + 花色 + 战吼 + 磨刀 之后，敌人易伤 / 楼层 / ♠T1 / ♥T2 / pierce **之前** |
| ♦ T1 灵敏 keyword | calcAttackDamage 退出后（playAttack hits 循环 [battle.ts:716-719](src/battle.ts:716)） | 成品：步骤 1–14 + pierce 全过完，敌人 armor 也算过了 |

### 当前状态

数学上 `d × 2 × 1.3 × 1.15` 与 `d × 1.3 × 1.15 × 2` 结果相同（乘法可交换），所以**目前没有数值 bug**。模拟验证：

```
p_crit 单独 ×2:         71
p_crit + ♦T1 灵敏 ×2:  143
```

71 × 2 = 142 ≈ 143（差 1 是 floor 舍入），符合纯乘法预期。

### 隐患

如果以后加任何"加法 +N 暴击伤"或"暴击触发 onCrit 钩子"的特性，两个位置的差异会立刻暴露。比如：

- `p_crit` 后想 +5 直伤：这 5 伤还会被后续易伤 ×1.3 / 楼层 scale 放大
- `♦ T1 灵敏` 后 +5 直伤：这 5 伤直接出，不受 buff 影响

### 处理建议

- 统一两处到 perks 后、♠T1 之前的位置（推荐）。
- 或在文档明确分开两个步骤（步骤 6.5「p_crit 暴击 roll」，步骤 15.5「♦T1 灵敏 暴击 roll」）。

---

## 四、中等：F12 终末降临 `double_debuffs` 不是"一次性"

文档 §11.2 说：`buffId: "double_debuffs"` — 玩家身上所有 debuff stack ×2（一次性）

实际代码：

- [enemies.ts:508-512](src/enemies.ts:508) 把 `double_debuffs` push 进 F12 boss 的 intents 池
- [battle.ts:1650-1666](src/battle.ts:1650) 的 `executeBuffIntent` 直接 `s.stacks *= 2`，**没有"已触发"标记**
- F12 boss AP = 4 + evolving AI 每次抽招都可能抽到这一招

### 后果模拟

玩家身上 3 中毒 + 2 出血：

- 翻 1 次：6 中毒 + 4 出血 → 10 HP/回合
- 翻 2 次：12 中毒 + 8 出血 → 20 HP/回合
- 翻 3 次：24 中毒 + 16 出血 → 40 HP/回合（接近团灭）

### 处理建议

二选一：

1. 在 `enemy.aiState` 加 `terminalUsed: boolean`，`executeBuffIntent` 的 `double_debuffs` 分支首次执行后置 true，之后被跳过。
2. 把这招从 intents 池里抽出来，改成 evolving AI 的 phase 3 入场强制一次性招式（在 `bossAI.ts:aiEvolving` 内做）。

---

## 五、中等：闪避来源数量超 cap 75% 后多源沉没

模拟数据（脚本 `/tmp/suitspire_sim.mjs`）：

```
意念甲 ×4 + ♦T1                              = 48%
意念甲 ×4 + p_dodge ×10 + ♦T1                = 75% (cap)
+ ec_swift Lv5 (+15%)                         = 75% (浪费 15 点)
+ swift 余势 +7% (闪后)                        = 75% (再浪费 7 点)
+ 烟雾弹                                       = 75% (继续浪费)
```

闪避 build 玩家能在 F6-F8 就轻松 cap，之后所有闪避来源（包括 ec_swift Lv5 / 风行余势 / 烟雾弹 / 风步等）都是沉没成本。

### 处理建议（三选一）

1. **抬高 cap**：75% → 90%，给 ec_swift 留出 Lv5 空间。
2. **超 cap 折算**：超出的闪避率转换为"受击伤害 -X%"。例如 cap 75% 后每多 5% 闪避 → -2% 受击。
3. **砍来源数量**：移除 ec_swift 的常驻 +10%（或者改为"未达 cap 时 +10%，达 cap 时 +N 减伤"）。

另一面：**敌人闪避 cap 偏低**。F12 boss `dodgeChance` cap = 15%，玩家每场基本不用担心 miss。如果设计上希望 boss 也有"难命中"感，可以让特定 boss AI（如猎手）抬高 dodge cap 到 25%。

---

## 六、低等：减伤栈中 ♣ T1 -3 在大量乘除之后

文档 §4.2 描述的栈顺序：

```
易伤 ×1.3 → 守护契 -N → 符文护盾 -N → 重甲列阵 -N → ♥T2 ×0.7 → ♣T1 -3 → 防具 → 特性 → 屏息 ×0.7
```

### 现象

`♣ T1 -3` 是定值减法，所有乘除减法都做完之后才减 3：

- 低伤场景（敌人 5 伤）：被压到 0 或 1。
- 高伤场景（F12 boss 4 × 25 = 100 伤一回合）：每次减 3，4 次减 12 ≈ 7% 减伤。

### 评价

这不是 bug，但跟"♣ 是控制 / debuff 流派"的设计主题不太合 — ♣ build 玩家进 F12 时 T1 -3 是杯水车薪，需要 T2 反应装甲 + 大招 + sk_aegis 才能扛住。

### 处理建议

- 文档 §8.4 ♣ 流派下加一句"♣ 主输出是控制，请用沉默 / 易伤 / 中毒消耗 boss 而非硬扛"。
- 或者把 ♣ T1 从 -3 改为 -10%（百分比减伤），高伤场景更值钱。

---

## 七、低等：其他文档不准确

| 位置 | 文档 | 代码实际 | 备注 |
|---|---|---|---|
| §3.3 ♠ T2 pierce 公式 | `+⌈floor/4⌉` | `max(1, ceil(floor/4))`（[battle.ts:589](src/battle.ts:589)） | F1 时一致，但应明示"最少 +1" |
| §11.1 多动 AP | "Boss F15+ \| 3" | 游戏只有 12 关 | 无意义条目，删除 |
| §13 卡牌索引 "skill 技能 \| 44" | 44 张 | 需按 [cards.ts](src/cards.ts) 实际清单核对 | 建议跑 `scripts/dump-balance.ts` 重新生成 |
| §6.3 中毒副作用 | "暴击 -5%/层 cap -50" | [cards.ts:1660](src/cards.ts:1660) `Math.min(50, stacks * 5)` ✓ | 一致，但语义是"百分点削减" |
| §7.4 ephemeral 卡 cleanup | "回合结束或战斗结束时不进 discard / deck" | [battle.ts:1677](src/battle.ts:1677) `cleanupEphemeralCards` | 没仔细对所有路径，建议加 unit test |

---

## 八、数值合理性模拟结论

### 8.1 Boss HP 曲线

```
F6  普通 boss HP                : 116
F9  fixed 不朽君王 HP            : 269
F12 fixed 无相之主 HP            : 578
```

### 8.2 F12 boss 输出

```
F12 boss 单 hit (暗杀重击)       : 25
F12 boss AP = 4 一回合理论最大伤害: ~130（4 × 暗杀重击 + 蓄势 + 终末注视）
```

### 8.3 玩家最强 ♠ 输出 build 单击伤害

```
4 件 long_sword (7 伤, ♠) + 6 p_bleed + ♠T1 + 敌人易伤:
  分布: min 35 / median 35 / p99 71 / max 71（暴击翻倍）
```

### 8.4 莽夫流单走 F12 的难度

- 击杀 F12 boss 578 HP / 玩家单击中位 35 → **需要 ~17 回合**
- 玩家 60 HP / boss 每回合 100+ 伤 → **撑不过 1 回合**（除非堆护盾 / 闪避）

**结论**：F12 boss 是 build 门槛极陡的关卡，**莽夫流（♠ 纯输出）几乎无法单走**。玩家必须用以下一种 build：

- ♦ 闪避 build（cap 75% miss 率扛血）
- ♣ 护盾 / 控制 build（沉默 + 易伤 + 反伤甲扛血）
- 多 build 混搭（攻击 ♠ + 防御 ♣ / ♦）

文档 §1.2 把 4 流派写得"平等"是有误导的。建议在 §8 或 §11 加一句"F9+ boss 几乎不能单纯堆 ♠ 输出过关，需混搭防御元素"。

---

## 九、亲和度系统数值验证

模拟（脚本输出）：

```
起手 4 攻击牌（无装备/特性）:                 aff = 1.2
装 long_sword ×4 + black_shield ×4 + 攻击 30: aff = 19.4
+ p_bleed ×3:                                  aff = 21.8
全堆 + 攻击 100 cap:                            aff = 30 (cap)
满档 - 大招消耗 8:                              aff = 30 (cap 内还有空间)
满档 - 消耗 16 (放 2 次大招):                   aff = 28.4
满档 - 消耗 24 (放 3 次大招):                   aff = 20.4
```

- 设计意图：满 build 可以放 3 次大招（24 aff），最后一次后才掉到 T2 阈值（≥10）以下。✓ 合理。
- 但**早期玩家很难到 T3（≥15）**：起手 aff = 1.2，需要装备 + 出牌 + 特性堆到至少 7-8 关才稳定 T3。这跟文档 §1.3 "起手 9 选 3 特性"形成预期落差 — 玩家以为 perk 能立刻给到 aff，实际起手 3 张 perk 只有 +2.4 aff。

文档可以在 §8.1 加一行 **"起手亲和度典型范围：1-3，正常 build 在 F4-F6 才能稳定到 T1（≥5）"**。

---

## 十、优先级建议

按建议优先级排序：

1. **【高】§14 特性清单全部按 [cards.ts](src/cards.ts) 重抄一遍**。最容易误导玩家做 build。
2. **【高】删除 `ENCHANT_DESCS`**：让 `getEnchantDescAt` 唯一。避免再分歧。
3. **【中】修 `double_debuffs` 一次性标记**。F12 玩家被随机翻倍 N 次的体验很糟糕。
4. **【中】决定闪避超 cap 的处理方式**：抬 cap / 折算减伤 / 砍来源数量，三选一。
5. **【低】统一两个暴击的乘法位置**（防御性重构，目前没 bug 但耦合脆弱）。
6. **【低】修 §7 其他细节**：F15+ AP 行删除、♠T2 pierce 公式补 `max(1, ...)` 注解等。

---

## 附录：检查方法

- 通读文档全文 16 节。
- 读关键代码：[types.ts](src/types.ts) (751 行)、[battle.ts](src/battle.ts) (2076 行 部分)、[cards.ts](src/cards.ts) (2476 行 部分)、[enemies.ts](src/enemies.ts) (560 行)、[bossAI.ts](src/bossAI.ts) (359 行)。
- Node.js 数值模拟脚本：`/tmp/suitspire_sim.mjs`，跑了 10 万次单击伤害采样 + 关键场景的死算。

如需更细的模拟（例如完整模拟器跑 N 局通关率），需要把 `battle.ts` 抽出来做成可独立运行的模块。
