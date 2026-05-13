# 附魔系统重设计 v0.8.2 — 设计稿（已实装）

> **状态**：**已实装** — 14 个附魔（流派 12 + 大师 2）全部 hook 接通 + UI 切换完成
> **依赖**：v0.8.2 公式重构（`feature/formula-refactor` 分支）+ 机制分区注册表（`MECHANICS_ZONE_REGISTRY.md`）
> **目标**：替换旧 13 附魔，新 14 附魔 + 新卖卡机制 + 新配方梯度
> **创建于**：当前 session 设计讨论（多轮迭代后定稿）
> **实装 commits**：commit A 骨架 → B+E hooks+数值 → C UI 切换 → D 卖卡机制 → F 文档同步
>
> 注：本文档保留作为设计史 + 决策记录；当前 14 附魔的**实装区位 / 触发流程**索引以
> `MECHANICS_ZONE_REGISTRY.md` § "v0.8.2 新 14 附魔分区总览" 为准。

---

## 1. 设计准则（5 条铁律）

| # | 准则 | 验证标准 |
|---|---|---|
| 1 | **视角转换** | 不是 +N% / +pierce / +吸血 这种数值垒砌；要"把现有系统反过来用 / 跨系统转换 / 把规则当资源" |
| 2 | **Visible 代价/进度** | 玩家能数（stack 数 / 回合数 / 击杀数 / debuff 层 / 自易伤 layer） |
| 3 | **与现有系统协同，不破坏规则** | 不"必中"、不"跳过敌方回合"、不"无视一切的真伤"；强力效果必有代价 |
| 4 | **简单一句话能说清** | 玩家一秒能 get 机制 |
| 5 | **每流派 3 附魔 + 配方阶梯** | T1 单普通 / T2 双普通 / T3 双普通+稀有 |

---

## 2. 配方梯度（最终）

| 档 | 配方 | 总碎片 | 期望上手关 |
|---|---|---|---|
| T1 入门 | 单普通 ×3 | 3 | F2-F3（1 次 shop 卖 3 张即够） |
| T2 中阶 | 双普通 ×2 各 | 4 | F3-F4 |
| T3 高阶 | 双普通 ×2 各 + 稀有 ×1 | 5 | F5-F7（4 普通可卖卡 + 1 稀有需主动 farm 1 个 elite/boss） |

**流派 → 主普通 / 副稀有**：
| 流派 | 主普通 | 副普通 | 副稀有 |
|---|---|---|---|
| ♠ 莽夫 | 兽 | 人 | 巨 |
| ♦ 暗影 | 人 | 死 | 暗 |
| ♥ 红心 | 死 | 兽 | 暗 |
| ♣ 法术 | 人 | 兽 | 巨 |

---

## 3. 卖卡机制改动（events.ts 改）

| 旧 | 新 |
|---|---|
| 每次 shop 访问最多卖 2 张 | **3 张** |
| 任选 5 种族碎片 | **只能选 3 种普通碎片**（兽 / 人 / 死） |

→ **稀有碎片（巨 / 暗）必须从 elite / boss 主动掉落**。普通碎片靠卖卡通货膨胀，稀有碎片靠玩家主动挑战。

---

## 4. 已定稿的 11 个附魔

### ♠ 黑桃 · 莽夫流（3/3 已定）

#### ♠ T1「血染战旗」 (兽 ×3)
**机制**：玩家每损失 N% maxHP（自损或受击），**当前装备武器的 baseDmg 永久 +1**（本场战斗，cap +M）

| Lv | 损血门槛 | cap |
|---|---|---|
| 1 | 10% maxHP | +3 |
| 2 | 8% maxHP | +5 |
| 3 | 6% maxHP | +7 |

**乘区归属**：阶段 1 基础区（武器 baseDmg 修正）
**实装提示**：用 `player.warBannerBonus` 字段累积，calcAttackDamage 内 `base = (wDef.baseDmg + warBannerBonus) × stackMult + ...`
**新维度**：用 HP 喂养武器 baseDmg

---

#### ♠ T2「无影连斩」 (兽 ×2 + 人 ×2)
**机制**：本场战斗内**连续命中 N 次攻击**后（被打断 = 出技能/道具/未命中），**永久解锁 hits+1**（本场战斗，每场仅 1 次）

| Lv | 触发连击数 |
|---|---|
| 1 | 5 |
| 2 | 3 |
| 3 | 2 |

**乘区归属**：攻击次数维度（不在伤害公式）— playAttack 循环里 hits +1
**实装提示**：用 `state.battle.player.combo`（计数器） + 触发后挂 `combo_unlock` status
**新维度**：连击解锁永久 hits 升级（vs 夜行的窗口期）

---

#### ♠ T3「斩首」 (兽 ×2 + 人 ×2 + 巨 ×1)
**机制**：本场战斗**可激活 N 次**「斩首」：下次攻击**强制 hits=1**（即使有 hits+X buff），但伤害 **×M**

| Lv | 每场激活 | ×M |
|---|---|---|
| 1 | 1 | ×3.0 |
| 2 | 2 | ×4.0 |
| 3 | 2 | ×5.0 |

**乘区归属**：阶段 3 倍率区（一次性 ×M 消耗）+ playAttack 内 hits=1 强制
**实装提示**：主动按钮，挂 `decap_charge` status (stacks=1)，calcAttack 阶段 3 检查 → mulMult ×= M + 消耗，playAttack 内若有 status 则 hits=1
**新维度**：主动放弃 hits 换单击爆发
**数值待调**：Lv3 ×5.0 配合所有 buff 可能爆 1000+ 单击，需要看 audit 是否要 cap 倍率

---

### ♦ 方块 · 暗影流（3/3 保留 v0 设计）

#### ♦ T1「夜行」 (人 ×3)
**机制**：每场战斗起始进入「夜行」状态：前 N 回合所有攻击 hits +1

| Lv | 持续回合 |
|---|---|
| 1 | 3 |
| 2 | 4 |
| 3 | 5 |

**乘区归属**：攻击次数维度
**实装提示**：newBattle 时挂 `night_walk` status (duration=N)，playAttack 内若 status 存在则 hits+1
**新维度**：时间窗口

---

#### ♦ T2「连环」 (人 ×2 + 死 ×2)
**机制**：玩家身上每 1 层 debuff（毒/血/弱/易/燃），所有攻击 +N%

| Lv | 每层 +% |
|---|---|
| 1 | +5% |
| 2 | +8% |
| 3 | +12% |

**乘区归属**：阶段 2 加成区
**实装提示**：calcAttackDamage 阶段 2 内 hardcode `if enchant === "连环" → addMult += N% × countPlayerDebuffs()`
**新维度**：debuff 反转为资源

---

#### ♦ T3「阴影分身」 (人 ×2 + 死 ×2 + 暗 ×1)
**机制**：本场战斗可激活 N 次「分身」：本回合 hits +2 + 自易伤 M 层（持续 1 回合）

| Lv | 易伤 +M 层 | 每场激活 |
|---|---|---|
| 1 | +3 | 1 |
| 2 | +2 | 2 |
| 3 | +2 | 3 |

**乘区归属**：攻击次数维度（hits+2） + 阶段 1 易伤区（vulnerable stacks）
**实装提示**：主动按钮，挂 `shadow_clone_active` (duration 1) + addStatus(player, "vulnerable", M)
**新维度**：风险换强力按钮 + 复用 vulnerable status

---

### ♥ 红心 · 生机流（3/3 已定）

#### ♥ T1「猎食者之心」 (死 ×3)
**机制**：
- 🅐 攻击牌**命中时吸血 N%**（每次攻击 +floor(dmg × N%) HP）
- 🅑 **击杀敌人后挂"猎杀" stack**，下次攻击 ×M 倍消耗（**stack 可累积，可跨战斗**）

| Lv | 吸血 % | ×M 倍率 | stack cap |
|---|---|---|---|
| 1 | 8% | ×1.4 | 2 |
| 2 | 10% | ×1.5 | 3 |
| 3 | 12% | ×1.7 | 3 |

**乘区归属**：
- 🅐 吸血 → 攻击副作用（不在 6 区公式，阶段 5 后副作用阶段）
- 🅑 ×M → 阶段 3 倍率区（一次性消耗）

**跨战斗实装**：用 `player.huntStacks: number` 字段（**不进 statuses** — newBattle 不清除）

```ts
// types.ts PlayerState 新加：
interface PlayerState {
  huntStacks?: number;  // ♥ T1 跨战斗保留的"猎杀" stack 数
}

// damageEnemy 击杀触发：
if (target.hp <= 0 && player.weaponEnchant === "ench_hunter_heart") {
  player.huntStacks = Math.min(cap, (player.huntStacks ?? 0) + 1);
}

// calcAttackDamage 阶段 3 倍率区：
if (player.weaponEnchant === "ench_hunter_heart" && (player.huntStacks ?? 0) > 0) {
  mulMult *= getEnchantParam(player, 1) / 100;
  player.huntStacks--;
}

// 阶段 5 后副作用（吸血）：
if (player.weaponEnchant === "ench_hunter_heart" && dmg > 0) {
  const heal = floor(dmg * getEnchantParam(player, 0) / 100);
  player.vita = min(player.vitaMax, player.vita + heal);
}
```

**Stack 累积模式**：每击杀 +1 stack (cap N)，每次攻击消耗 1 stack（多击杀积累，多攻击逐次消耗）
**新维度**：基础吸血 + 击杀单次爆发 + 跨战斗保留 buff

---

#### ♥ T2「饕餮」 (死 ×2 + 兽 ×2)
**机制**：玩家吸血时，超过 maxHP 的**溢出部分**转化为**临时护盾**（shield_block status）

| Lv | 转化率 | 护盾 cap |
|---|---|---|
| 1 | 1 : 1 | 8 |
| 2 | 1 : 1.5 | 12 |
| 3 | 1 : 2.0 | 18 |

**乘区归属**：攻击副作用（在 T1 吸血计算后判溢出） + 阶段 4 护盾吸收（shield_block 复用）
**实装提示**：吸血时检测 `if (heal + player.vita > player.vitaMax) overflow = ...; addStatus(player, "shield_block", overflow × ratio)`
**与 T1 协同**：T1 给吸血 → 满血时 T2 把溢出转护盾
**新维度**：跨系统资源转换（♥ 吸血 → ♣ 护盾）

---

#### ♥ T3「血涂」 (死 ×2 + 兽 ×2 + 暗 ×1)
**机制**：玩家击杀敌人时，**该敌人 maxHP × N%** 永久 +为玩家 maxHP（本场战斗）

| Lv | 击杀转化率 |
|---|---|
| 1 | +15% |
| 2 | +25% |
| 3 | +35% |

**乘区归属**：击杀副作用（damageEnemy 钩子）
**实装提示**：damageEnemy 触发死亡时检查附魔 → player.vitaMax += floor(target.maxHp × N%)，可选 player.vita += 同量（满血效果）或不回血只 +maxHP
**与 T1 协同**：T1 击杀给短期 buff，T3 击杀长期 +maxHP
**新维度**：杀敌积累 maxHP 永久资源

---

### ♣ 梅花 · 法术流（1/3 已定，2 待思考）

#### ♣ T2「转嫁」 (人 ×2 + 兽 ×2)
**机制**：每回合开始，玩家身上**随机 1 个 debuff**（同 stacks）**直接转移给当前选中的敌人**

| Lv | 每回合转移 |
|---|---|
| 1 | 1 个 |
| 2 | 1 个 + 转移后 stacks +1 |
| 3 | 2 个 |

**乘区归属**：回合开始副作用 + debuff 系统操控
**实装提示**：startNewPlayerTurn 内，找 player.statuses 中 debuff 类（poison/bleed/weak/vulnerable/burn/silenced/frozen/fear），随机选 N 个 → 从玩家移除 → addStatus(target, ...)
**新维度**：debuff 转移（玩家 → 敌方）
**与 ♦ 连环对偶**：连环把自身 debuff 变成攻力 buff；转嫁把自身 debuff 直接打回去

---

#### ♣ T1 — 待用户思考
**约束条件**：
- 配方：人 ×3
- 视角必须新颖（不是 +易伤 / +护盾 / +摸 牌 类传统机制）
- 简单一句话能说清
- 与 ♣ 主题（法术 / 控制 / debuff / 护盾）协同

**已被否定的方向**：
- 咒蚀（非攻牌→敌易伤累积）— 太无聊
- 咒言（技能牌→敌攻 -%）— 太无聊
- 咒符弹（自动生成卡牌）— UI 复杂
- 咒咎（受击→敌易伤）— 可能仍偏无聊
- 咒变（攻击 N% 给易伤）— 跟 ♠T1 锐利对偶但太模板化
- 心眼（看敌方 intent）— UI 复杂收益小

#### ♣ T3 — 待用户思考
**约束条件**：
- 配方：人 ×2 + 兽 ×2 + 巨 ×1
- 通常按钮型（跟 ♠斩首 / ♦阴影分身 / ♥血魂回环风格统一）
- 视角必须新颖
- 不破坏规则（不"跳过敌方"/"必中"/"无视减伤"）

**已被否定的方向**：
- 时间停滞（跳过敌方 + 手上限+5）— 破坏平衡 + UI 烦
- 读秒（必中无视闪避）— 破坏平衡
- 禁言（敌方 buff/debuff intent 失效）— 超模
- 时间倒流（撤销受击）— 可能略超模？

---

## 5. 数值待调（11 个已定附魔）

所有已定附魔的数值都是**临时占位**，待全 12 附魔定稿后**统一调**（用户已说过）。

**调参注意点**：
- 整体公式已是 v0.8.2 分层乘区，**加成区天花板 +250%**
- 倍率区已较节制（sharpened ×1.5 + 血溅 ×M + 猎食者 ×N + 斩首 ×M）
- 全局阀 GLOBAL_DMG_MULT / GLOBAL_DEF_MULT 默认 1.0
- 跨战斗保留的 ×N 累积（猎食者 huntStacks）特别需要 audit

---

## 6. 实装清单（待 ♣ 定稿后开始）

### 文件改动

| 文件 | 改动 |
|---|---|
| `src/types.ts` | EnchantId 12 个新值 + ENCHANT_NAMES + ENCHANT_RECIPES + ENCHANT_LEVEL_PARAMS（3 级表）<br>PlayerState 加跨战斗字段：`huntStacks?`、`warBannerBonus?`、可能其他 |
| `src/cards.ts` | 删除旧 ENCHANT_EFFECTS 13 项，新加 12 项（多数为空 + 注释，因走独立 hook 不再走 callback）<br>顶部注释列表更新 |
| `src/battle.ts` | calcAttackDamage 内各附魔的硬编码 hook（阶段 1 / 2 / 3 / 副作用）<br>damageEnemy 内击杀触发 hook<br>damagePlayer 内受击触发 hook<br>startNewPlayerTurn 内回合开始 hook<br>playAttack 内连击 / hits 计数 hook<br>新增 `activateEnchant()` 函数（主动按钮型） |
| `src/game.ts` | 新增 `activateEnchant()` action dispatcher |
| `src/main.ts` | UI 加"附魔激活按钮"（4 个主动按钮型附魔：斩首 / 阴影分身 / 血魂回环 / ♣T3 待定）|
| `src/events.ts` | merchantSellCard 改：3 张/visit + 限定 race 为 ["beast", "humanoid", "undead"] |
| `MECHANICS_ZONE_REGISTRY.md` | 同步更新附魔归类 |

### 待办（按优先级）

1. ♣ T1 / T3 设计（用户思考中）
2. 全 12 附魔数值统一调（用户决定）
3. 实装到 `feature/formula-refactor`（或新开 `feature/enchant-redesign`）
4. balance audit 验证（用之前的 pipeline 跑数据）

---

## 7. 关键问题清单（让你以后接着拍）

### ♥ T1 猎食者之心
1. Stack 累积 cap：2/3/3（推荐）vs 单 stack 不累积 vs 不限 cap
2. 跨战斗实装用 `player.huntStacks` 字段 OK 吗？（不进 status 否则被 newBattle 清空）
3. 吸血 % 升级方式：固定 8% 只升 ×N（推荐）vs 8/10/12 都升

### ♥ T3 血涂
1. +maxHP 同时是否回血到满 maxHP？还是只增加上限不补血？
2. 击杀转化率 15/25/35 是否太高？F12 boss maxHP 578 × 35% = +202 maxHP（巨大）

### ♠ T3 斩首
1. Lv3 ×5.0 倍率是否要 cap（如倍率区 cap ×4.0）？

### ♣ T1 / T3
1. 用户待思考方向

### 整体
1. 全部 12 附魔数值待统一调（用户已强调）
2. UI 工作量：4 个主动按钮（斩首 / 阴影分身 / 血魂回环 / ♣T3）

---

## 8. 12 个独立战术维度（11 已定）

| 附魔 | 新维度 |
|---|---|
| 血染战旗 | 武器 baseDmg 用 HP 喂养 |
| 无影连斩 | 连击解锁→永久 hits 升级 |
| 斩首 | 主动放弃 hits 换单击爆发 |
| 夜行 | 时间窗口 hits+1 |
| 连环 | 自身 debuff → +% 资源转化 |
| 阴影分身 | 按钮 hits+2 + 自易伤 |
| 猎食者之心 | 吸血 + 击杀短期 buff（跨战斗保留 stack） |
| 饕餮 | 吸血溢出→护盾（跨系统转换） |
| 血涂 | 击杀 → +maxHP 永久 |
| ♣ T1 | TBD |
| 转嫁 | 自身 debuff → 转移给敌方 |
| ♣ T3 | TBD |

---

## 附录：废弃的旧 13 附魔（仅作参考，将被全部替换）

旧 EnchantId（v0.7-v0.8.1）：
- e_brawler / e_strategist / e_reaper / e_titan / e_phantom（5 个 single）
- ec_warblood / ec_phalanx / ec_swift / ec_focus / ec_lifesteal / ec_resilient / ec_arcane / ec_runic（8 个 composite）

被替换的原因：
- 8/13 是"已有系统数值放大器"（HP<50% +%、受击 -N、闪避 +%、击杀 ×N、calc_charge 等），跟专精 / 特性 / 装备 重叠严重
- ec_focus 跟 e_strategist 用同一 calc_charge 机制，重复
- crown_of_vitality 旧 callback 混合 flat + mul（已修，但未替换）

新 12 附魔：每个独立战术维度，无重复。
