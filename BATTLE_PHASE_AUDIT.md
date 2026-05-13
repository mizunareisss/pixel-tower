# 战斗时间维度 Audit · v0.8.2

> 配套 `BATTLE_PHASE_TIMELINE.md`。本文档列出当前所有机制在时间维度上的**冲突 / 模糊 / 顺序错位**。
>
> Audit 范围：44 skills + 15 items + 37 equipment + 17 perks + 13 enchants（含 v0.8.2 新设计待加的）+ 4 specialty tiers + 所有 status。

---

## 总览

| 严重度 | 冲突类型 | 数量 | 状态 |
|---|---|---|---|
| 🔴 严重 | 实战会出 bug，必须修 | 3 | ✅ **已修（v0.8.2 Round 1）** |
| 🟠 潜在 | 数值/体感问题，建议修 | 5 | ⏳ 待修 |
| 🟡 模糊 | 设计选择需要拍板 | 4 | ⏳ 待拍板 |

**Round 1 修复（已 commit）**：
- ✅ #1 抽出 `triggerSelfDamageHooks` / `triggerEnemyKillHooks` 在 cards.ts（line ~120）
- ✅ #1 p_lifetap.onTurnStart 改用 helpers（自损 + 杀敌都走统一路径）
- ✅ #1 sk_blast.onPlay 改用 helpers
- ✅ #2 brew_regen 从 P1.5 挪到 P1.1（跟 ♥T1/ec_resilient/life_pouch 并列）
- ✅ #3 damagePlayer 内 perk callback 改回传 dmg（不传 base）— 完全格挡时反伤跟旧公式行为一致

**Round 2 待办（实装 v0.8.2 新附魔时一并做）**：
- 武器击杀回血（everlast_fang / blood_blade +20% maxHP）从 onAttack callback 移到 triggerEnemyKillHooks
- playAttack 内 damageEnemy 后调 triggerEnemyKillHooks（这样攻击击杀也走统一路径）
- battle.ts 内 awardFragments 内 onKill 调用换成 triggerEnemyKillHooks
- DOT 处理是否调 triggerSelfDamageHooks（取决于 ♠T1 战旗的设计）

---

## 🔴 严重冲突（必须修）

### #1 `p_lifetap` 绕过所有 hook

**症状**：
p_lifetap onTurnStart 直接操作 `player.vita -=` 和 `damageEnemy()`，**绕过 damagePlayer / calcAttackDamage**。

**结果**：
- **自损**不触发：p_blood_pact 蓄势 / 反伤甲 / scale_mail 反伤 / took_damage_turn 标记
- **未来 ♠ T1 血染战旗（损血→武器+1）也不触发** ← 设计直接废
- **未来 ♥ T2 灼血（损血→敌 burn）也不触发** ← 设计直接废
- **杀敌**不触发：武器击杀回血（everlast_fang / blood_blade +20% maxHP）
- **未来 ♥ T1 猎食者（敌死→huntStacks）也不触发** ← 设计直接废
- **未来 ♥ T3 血涂（敌死→+maxHP）也不触发** ← 设计直接废

**严重度**：🔴🔴🔴 — 这影响**多个待加新附魔**

**修复方案 (推荐 B)**：
- A. 短期：p_lifetap onTurnStart 内**手动调**所有相关 hook（脆弱）
- B. 长期：抽出**统一损血路径** `applySelfDamage(state, amount, source)` + **统一杀敌路径** `applyEnemyKill(state, target, source)`，让所有自损 / 杀敌都走这两个函数，再在函数内分发副作用

---

### #2 `brew_regen` 阶段错位

**症状**：
brew_regen 写在 P1.5 DOT 块**开头**（line 2294），而 ♥T1 / ec_resilient / life_pouch 在 P1.1。

**结果**：
- 数值上无影响（都在 DOT 之前）
- 但**主动回血源散在不同阶段** → audit 时找不全 → 加新回血放大器（如未来"滋养"型）容易漏

**严重度**：🔴 — 数值正常但**结构性 bug**

**修复**：把 brew_regen 块上移到 P1.1（跟 ♥T1 / ec_resilient / life_pouch 一起，作为第 4 个主动回血源）。

```ts
// 应该挪到 P1.1 阶段（在 fullplate_pending 之前）：
const brew = state.player.statuses.find(s => s.id === "brew_regen");
if (brew && state.player.vita < state.player.vitaMax) {
  const heal = brew.stacks;
  state.player.vita = Math.min(state.player.vitaMax, state.player.vita + heal);
  log(`药剂：+${heal} HP。`, "player");
}
```

---

### #3 新公式重构引入：完全格挡时反伤变非零

**症状（我引入的 regression）**：
重构 damagePlayer 时，p_thorns / thorn_armor / scale_mail 的 callback 接收的是 `base`（原始伤害），不再是减伤后的 `dmg`。

```ts
// 新 battle.ts 内：
if (eff?.onTakeDamage && !SKIP_PERK.has(inst.defId)) {
  // 用 base（未减伤前）传入，让副作用基于"原始伤害"计算
  eff.onTakeDamage(ctx, base, cnt);
}
```

**结果**：
- **完全格挡**（dmg 减到 0）时，p_thorns 反伤现在按 base 算：reflect = floor(base × 10%) → **非 0**
- 旧公式：按 final dmg=0 → reflect=0

**严重度**：🔴 — 行为变了，玩家可能没察觉到

**修复选项**：
- A. 改回用 final dmg（保持旧行为）— 但新公式架构走 base 是有意的（防反伤公式在阶段 5 后才能算最终 dmg）
- B. 接受新行为（玩家挡住攻击但反伤甲仍反弹）— **设计上更合理**
- C. 用 max(base × pct, dmg × pct) — 取大者

**推荐 B**：在 GAME_MECHANICS 文档明确"完全格挡时反伤按原始伤害算"。

---

## 🟠 潜在冲突（建议修）

### #4 `hits` 修饰公式的爆炸风险

**位置**：`battle.ts:947` `hits = (weaponHits + shadowBonus + diamondBonus) × tripleMult`

**风险**：当前已存在 hits 修饰源:
- weaponHits (dual_blades=2 / wind_blade=2)
- shadow_double (+1 from sk_shadow_strike / wind_blade 闪后 / 不朽战甲受击后)
- ♦ T1 灵敏 (25% +1)
- ♦ T2 灵巧 (30% +1)
- triple_strike (×3, ♦ T3 大招)

新待加的 hits 修饰源（v0.8.2 设计）：
- 夜行 (前 N 回合 +1)
- 无影连斩 (永久 +1，触发后)
- 阴影分身 (按钮，本回合 +2)

**最坏 case** (♦ build 满 buff + ♥血液回响 / ♠斩首暂略)：
- weaponHits 2 (wind_blade) + shadow_double 1 + 灵敏 1 + 灵巧 1 + 夜行 1 + 连斩 1 + 分身 2 = **9 base hits**
- × triple_strike 3 = **27 hits**

**严重度**：🟠 — 数值过爆但需要"满 buff 同时"才出现

**修复建议**：
- 加 hits cap（如 `hits = min(8, ...)`）
- 或把 triple_strike 从 ×3 改成 +N 加法（这样 hits = 加法和，没乘积）
- 推荐 cap 8

---

### #5 多个吸血源用不同 dmg 基数

**症状**：

| 吸血源 | 调用位置 | 用什么 dmg 算 |
|---|---|---|
| dagger / vampire_fang / blood_blade / everlast_fang | 武器 onAttack callback | **阶段 1-3 后的中间 dmg** |
| ec_lifesteal | 武器 onAttack callback | 中间 dmg |
| p_vampire | perk 副作用（callback） | 中间 dmg |
| ♥ T1 贪婪 keyword | calcAttackDamage 阶段 5 后 | **最终 dmg** |
| 未来 ♥ T1 猎食者 | 阶段 5 后 | 最终 dmg |

**实战影响**：dagger 35% 用中间 dmg，贪婪 10% 用最终 dmg。玩家攻击 100 → armor 减 30 → 实伤 70：
- dagger 吸血 = 35 (按中间 100 算)
- 贪婪 吸血 = 7 (按最终 70 算)

玩家**很难直观对比**两者强弱。

**严重度**：🟠 — 没 bug 但体感困惑

**修复建议**：所有吸血统一在 calcAttackDamage 末端（阶段 5 后副作用阶段）按**最终 dmg** 触发。意思是把 dagger / vampire_fang / blood_blade / everlast_fang / ec_lifesteal 的吸血逻辑从 callback 挪出来，统一到主流程。

---

### #6 受击副作用顺序依赖代码顺序

**位置**：`battle.ts:1346-1416` damagePlayer 内 base > 0 分支

```
顺序：knight_plate → combat_belt → soulreaver_plate → immortal_plate → full_plate → p_thorns → thorn_armor → scale_mail → counter_stance → blood_pact → undying_heart → Epic 用次 -1
```

**风险**：未来加新受击副作用（如新♣ T1 / 待定）需要在这一长串里插入，没有"事件总线"机制。

**严重度**：🟠 — 不会立刻出 bug 但维护性差

**修复建议**：抽象一个 `onPlayerHit` 事件分发器，新机制注册就行。但重构成本中等。

---

### #7 `time_stop` 跳过敌人行动但 DOT 仍跑

**位置**：`battle.ts:2039-2040` + 2042-2068

```ts
const skipActions = !!state.player.statuses.find(s => s.id === "time_stop");
if (skipActions) log("时停：敌人无法行动！", "player");

for (const enemy of state.enemies) {
  if (!enemy.alive) continue;
  // DOT 结算（time_stop 也走）
  ...
  if (!enemy.alive) continue;
  if (skipActions) continue;  // 时停跳过 intent
  ...
}
```

**design intent**：time_stop 下敌人**不出招但 DOT 仍跑**（OK）。

**bug 检查**：
- 玩家挂 time_stop → 敌人被 DOT 击杀？✓ damageEnemy 内 alive=false，下次循环 continue
- 玩家挂 time_stop → 敌人本回合 status duration 仍衰减？✓ E2.3 仍跑

✓ 实际上**没 bug**，但 design 上要明确："time_stop 跳过敌方 intent 但不停止 DOT 和 status 衰减"。建议在 GAME_MECHANICS 文档说清楚。

---

### #8 反应装甲 (♣T2) 触发依赖"最后一层 shield 被破"

**位置**：`battle.ts:1314-1322`

```ts
if (shield && dmg > 0) {
  const absorbed = Math.min(shield.stacks, dmg);
  shield.stacks -= absorbed;
  if (shield.stacks <= 0) {
    state.player.statuses = state.player.statuses.filter(s => s.id !== "shield_block");
    // ♣ T2 反应装甲：最后一层失效时 25% 给攻击者 +1 易伤（3 回合）
    if (active === "club" && tier >= 2 && attackerEnemy?.alive && Math.random() < 0.25) {
      ...
    }
  }
}
```

**冲突**：依赖 `shield.stacks <= 0`。如果玩家护盾 3 层，被打 10 dmg → stacks=0 → 触发反应装甲 ✓
如果玩家护盾 10 层，被打 3 dmg → stacks=7 → 不触发 ✓

但 fullplate_shield 优先消耗（不是 shield_block），所以**反应装甲只针对 shield_block 来源**。这是 design intent ✓。

✓ 没冲突，但**新设计加入新护盾源**（如未来某个附魔加 shield_block）时要注意这个触发条件。

---

## 🟡 设计模糊（待拍板）

### #A `♣T1 镇守 shield_block 衰减`**误伤非 ♣ 来源**

**位置**：`battle.ts:2242-2253`

```ts
if (active === "club" && tier >= 1) {
  const sh = state.player.statuses.find(s => s.id === "shield_block");
  if (sh && sh.duration === -1) {
    sh.stacks -= 1;  // 不区分 source
```

**模糊点**：玩家用 ♣ build + `sk_aegis`（铁壁）给护盾，护盾会被 ♣ T1 衰减 -1。这是 feature 还是 bug？

**选项**：
- A. 接受现状（"♣ T1 镇守激活时所有 shield_block 都衰减"）
- B. 加 source 字段区分（重构 status）

**推荐 A** — 在 GAME_MECHANICS 文档明确说"♣ 流派的 shield_block 是消耗型，激活 T1 时所有来源每回合 -1"。

---

### #B `weak` / `vulnerable` 的 stacks 语义

**STATUS_META 定义**：stacks 只决定 duration，效果固定（×0.7 / ×1.3）。

**实装**：addStatus("weak", 2) 是 stacks=2 累加还是 duration=2 累加？

让我确认：让我直接查 addStatus 代码。

待 audit。如果实装跟文档对不上，需要修。

---

### #C 跨战斗保留字段清单

**当前明确**：
- ✅ 跨战斗保留：suitPlayedTotal / suitConsumedTotal / fragments / vita / vitaMax / weaponEnchant / revivesUsed / weapons / armors / perks
- ❌ 不保留：statuses (全清) / hand / discard / Epic uses (重置)

**新机制待定**：
- ♥ T1 猎食者 huntStacks → **跨战斗保留** ✓ (设计已定)
- ♠ T1 血染战旗 warBannerBonus → **不跨战斗**（本场内累积）

**建议**：在 PlayerState 上加 `// 跨战斗` / `// 本场战斗` 注释，避免混淆。

---

### #D shield_block 来源不区分

跟 #A 类似，多个来源（♣镇守 / sk_aegis / 木盾杖 / e_phantom / ec_phalanx 未受伤奖励 / fullplate 反震 等）都用同一 status id。

冲突 case：玩家有 8 stack shield_block，可能 5 是 ♣镇守 + 3 是 sk_aegis。反应装甲触发时不区分。

**修复成本**：高（要重构 status 加 source 字段）。
**修复必要性**：低（玩家不会刻意混搭）。

---

## 时间线阶段的"机制密度"统计

```
B 战斗开始：       3 个机制 (ec_runic 初始化 / ephemeral 清理 / Epic uses 重置)
P0 玩家回合开始：  4 个 (turn++ / repeating_bow streak / log)
P1.1 主动回血：    4 个 (♥T1 / ec_resilient / life_pouch / brew_regen) ⚠️ brew 错位
P1.2 延迟结算：    2 个 (draining_charge / fullplate_pending)
P1.3 status 清理： 2 个 (thorn_chain 清零 / ♣T1 shield 衰减)
P1.4 onTurnStart：~10 个 (heavy_armor / ec_warblood / 防具回调 / perk 回调含 p_regen/p_lifetap/p_overload)
P1.5 DOT 结算：    3 个 (poison/burn/bleed)
P1.6 HP 检查：     1 个
P1.7 摸牌：        1 个
P2.A 攻击：        50+ 钩子 (calcAttackDamage 6 区 + 副作用 + 击杀)
P2.B/C 技能道具：  4 个 (onPlay / 出牌副作用)
P2.D 装备：        1 个
E0 敌人回合开始：  2 个 (ephemeral 清理 / time_stop 检查)
E1.A 敌人 DOT：    3 个
E1.D intent 执行：~20 个 (含闪避路径 / 减伤栈 / 护盾吸收 / 受击副作用)
E2 回合结束：      3 个 (ec_phalanx / 状态衰减)
BE 战斗结束：      3 个 (awardFragments / onKill / 精英 SR drop)
```

**最密集的阶段**：P2.A 攻击（50+ 钩子）和 E1.D 受击（20+ 钩子）。

---

## 修复优先级建议

| Phase | 任务 | 优先级 |
|---|---|---|
| 1 | ✅ 修 #2 brew_regen 错位（5 分钟）| 🔴 高 |
| 2 | 决定 #3 反伤新行为是接受还是改回（5 分钟拍板）| 🔴 高 |
| 3 | ✅ 抽出 `applySelfDamage` / `applyEnemyKill` 统一路径（修 #1）（1 小时）| 🔴 高 — 影响 v0.8.2 多个新附魔 |
| 4 | 加 hits cap 8（修 #4）（10 分钟）| 🟠 中 |
| 5 | 统一吸血到末端最终 dmg（修 #5）（30 分钟）| 🟠 中 |
| 6 | audit addStatus 行为（验证 #B）（10 分钟）| 🟡 低 |
| 7 | 文档补充 #A / #C / #D 说明（20 分钟）| 🟡 低 |

**建议立刻做 1-3**（影响 v0.8.2 新附魔的根本性问题），4-7 在实装新附魔时一并改。

---

## 不影响时间线但顺便发现的小问题

1. **`state.attackedThisTurn` 命名**：用于"本回合是否已打过攻击牌"判断。但 `repeating_bow` 也用它做 streak 统计，**双重用途**。建议拆成 `attackedThisTurn` 和 `bowAttackStreak`（已部分拆，但 line 2168-2185 还有耦合）。

2. **`state.battle.player` === `state.player`**：state.battle 的 player 字段是同一引用，但有些代码用 `state.battle.player.X` 有些用 `state.player.X`。建议统一。

3. **`_seenIntents` / `_undyingUsed` / `_fragmentAwarded` / `_drawN` 等 underscore 字段**：用 `(enemy as any)._foo` 写法，类型不安全。建议加入 EnemyState/BattleContext 类型。

---

## 维护规则

每次：
- 修一个冲突 → 更新对应章节状态
- 加新机制 → 走 `BATTLE_PHASE_TIMELINE.md` 决策树 → 选好阶段 → 在本表对应阶段补一行
- 发现新冲突 → 加到对应严重度章节

**目标**：保持所有 ⚠️ 标记的数量随 release 递减。
