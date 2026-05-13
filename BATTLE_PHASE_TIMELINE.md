# 战斗阶段时间线 v0.8.2

> **目的**：把战斗中所有机制的触发 / 结算时间点排成清晰的时间轴，避免：
> - 新机制不知道塞哪个阶段 → 跟其他机制结算顺序冲突
> - 旧机制散在 4-5 个函数里 → audit 数值时找不全
> - 多 hit / 多动 AP / 状态衰减之间的微妙顺序错乱
>
> 跟 `MECHANICS_ZONE_REGISTRY.md` 配套：本文件管"**什么时候**触发"，注册表管"**伤害/减伤公式里归哪个区**"。

---

## 大流程

```
┌────────────────────────────┐
│  战斗开始（newBattle）      │  ← 一次性
└────────────┬───────────────┘
             ↓
┌────────────────────────────┐
│  ★ 玩家回合（第 1 回合）   │
│   阶段 P0 → P1 → P2 → P3   │
└────────────┬───────────────┘
             ↓ 玩家点"结束回合"
┌────────────────────────────┐
│  敌人回合                   │
│   阶段 E0 → E1 → E2 → E3   │
└────────────┬───────────────┘
             ↓
┌────────────────────────────┐
│  ★ 玩家回合（第 N+1 回合） │
│   循环至胜利或失败          │
└────────────┬───────────────┘
             ↓
┌────────────────────────────┐
│  战斗结束（checkBattleEnd） │
└────────────────────────────┘
```

---

## 阶段 B · 战斗开始（newBattle, 一次性）

```
B1. 牌库初始化
    ├─ player.statuses = []（全清）
    ├─ player.turnsElapsed = 0
    ├─ 上场残留 hand/discard/pendingDraws 全洗回 deck
    ├─ ★ 过滤掉所有 ephemeral 卡（复读机克隆）
    ├─ Epic 卡 usesRemaining 重置为 EPIC_USES_PER_BATTLE (3)
    └─ shuffle deck

B2. 附魔战斗起始 buff
    ├─ ec_runic → 挂 enc_runic_immune（每场首次受击免疫）
    └─ ec_runic Lv5 → 加挂 enc_dot_immune（DOT 全免）

B3. ★ 新附魔战斗起始 hook（v0.8.2 待加）
    ├─ ♦ 夜行 → 挂 night_walk (duration=N)
    ├─ 其他需要在 newBattle 时执行的附魔
    └─ NOTE: ♥ T1 猎食者的 huntStacks 是 player 字段，不在这里清空（跨战斗保留）

B4. BattleState 构造
    ├─ phase = "playerTurn"
    ├─ turn = 1
    ├─ targetIndex = 第一个 alive 敌人
    └─ attackedThisTurn = false
```

---

## 阶段 P · 玩家回合

### P0 · 回合开始（startNewPlayerTurn 顶部）

```
P0.1 战斗结束检查（checkBattleEnd）
     └─ 玩家死 / 全敌死 → 直接 return
P0.2 回合计数
     ├─ state.turn++
     ├─ state.player.turnsElapsed++
     └─ state.attackedThisTurn = false（重置上回合的标记）
P0.3 装备特殊计数（repeating_bow 连弩攻击 streak 检测）
P0.4 Log "── 回合 N（你的回合）──"
```

### P1 · 前置结算（按以下严格顺序，全部在 startNewPlayerTurn 内）

**P1.1 主动回血源（按特性 / 装备 / 专精）**

| 顺序 | 来源 | 数量 |
|---|---|---|
| 1 | ♥ T1 生机涌动 | +5 HP（active heart + tier≥1）|
| 2 | ec_resilient 附魔 | +N HP（idx 2，Lv1-5: 1/1/1/2/2）|
| 3 | life_pouch 装备 | +3% maxHP × stack |
| 4 | brew_regen status | +stacks HP（药剂） |
| 5 | ★ 新滋养型附魔 | （待新设计加） |

**P1.2 延迟结算（上回合累积的回血/护盾）**

| 顺序 | 机制 | 触发条件 |
|---|---|---|
| 1 | draining_charge → 回血 | 吸血盾装备上回合 stack |
| 2 | fullplate_pending → fullplate_shield | 重铠上回合受击的反震蓄势 |

**P1.3 上回合 status 清理**

| 顺序 | 操作 |
|---|---|
| 1 | thorn_chain 清零（反伤甲连击计数）|
| 2 | ♣ T1 镇守 shield_block 衰减 -1（仅 active club + tier≥1）|

**P1.4 装备 / 附魔 / 特性 onTurnStart 钩子**

| 顺序 | 来源 |
|---|---|
| 1 | heavy_armor 30% 概率去 1 debuff |
| 2 | ec_warblood 累积永久攻击 stacks |
| 3 | 防具 onTurnStart 回调 |
| 4 | 特性 onTurnStart 回调（p_regen / p_lifetap / p_overload _drawN 累积）|

**P1.5 DOT 结算（玩家身上中毒 / 燃烧 / 出血）**

⚠️ **顺序固定**：中毒（含 stacks-1）→ 燃烧 → 出血
- 中毒每回合扣 maxHP × 1% × stacks，**stacks -1**（消耗）
- 燃烧每回合扣 maxHP × 2% × stacks（无衰减，靠 duration 衰减）
- 出血每回合扣 当前 HP × 5% × stacks（无衰减）

**P1.6 HP=0 死亡检查**

DOT 可能直接打死玩家 → `state.phase = "lost"; return`

**P1.7 摸牌**

```
drawCards(DRAW_PER_TURN + extraDraw)
extraDraw = ctx._drawN 累计（p_overload 等触发）
```

### P2 · 玩家行动循环（出牌阶段）

**玩家点选卡牌 → playCard(state, uid, log) → 分发到 3 类**

#### P2.A 攻击牌（playAttack）

```
P2.A1 攻击次数限制
      └─ state.attackedThisTurn === true 且无 multi-attack buff → 拒绝
P2.A2 hits 循环开始
      └─ hits = baseHits + bonuses（夜行 / 阴影分身 / shadow_double / triple_strike / 灵敏 roll / 灵巧 roll / 锐利 keyword 等）
P2.A3 每个 hit 独立流程：
      ├─ a. dodge roll（敌人闪避）— bleed 削减
      ├─ b. crit roll（敌人暴击）— poison 削减
      ├─ c. calcAttackDamage（6 区分层公式）
      │   ├─ 阶段 1a 早期 flat（battle_cry, weapon_buff, frenzy, war_bow flat, berserker_blade flat, blood_pact_charge）
      │   ├─ 阶段 1b 楼层 scale
      │   ├─ 阶段 1c 后期 flat（calc_charge, 禁忌权杖, knight_charge, warblood_perm_atk）
      │   ├─ 阶段 2 加成区 +%（花色相性 / ♠T1 / ♥T2 / vuln / weak / 各 perk / e_brawler / ec_warblood / ec_arcane / 新 连环）
      │   ├─ 阶段 3 倍率区 ×（sharpened / charged / e_reaper / e_phantom / 新 血溅 / 新 猎食者 / 新 斩首）
      │   ├─ 阶段 3.5 阈值附魔（e_titan / ec_focus）
      │   ├─ 副作用阶段（吸血 callback / p_vampire / p_crit roll）
      │   ├─ 阶段 4 防御区（armor vs pierce）
      │   ├─ 阶段 5 全局 GLOBAL_DMG_MULT
      │   └─ ♥ T1 贪婪 keyword 吸血（基于最终 dmg）
      ├─ d. damageEnemy 实际扣 HP
      ├─ e. 攻击命中副作用：
      │   ├─ 上 debuff（battle_staff +易伤 / giant_hammer 沉默 chance / ♠T1 锐利 +出血）
      │   ├─ ♣T1 镇守 keyword（♣ 攻 +1 shield_block）
      │   ├─ next_atk_apply_poison / next_atk_apply_bleed（消耗）
      │   └─ ♣ T1 镇守 keyword（♣ 攻命中 +1 临时护盾）
      ├─ f. 击杀检测（damageEnemy 内）
      │   ├─ 不朽光环复活检测
      │   ├─ 死亡时挂 _fragmentAwarded 标记（待 awardFragments 处理）
      │   ├─ 触发吸血型武器击杀回血（everlast_fang / blood_blade +20% maxHP）
      │   ├─ e_reaper 击杀挂 e_reaper_buff
      │   ├─ ★ 新 ♥ T1 猎食者击杀 +huntStacks
      │   └─ ★ 新 ♥ T3 血涂击杀 +maxHP
      └─ g. 多目标溅射（chain_blade）— 不走 calcAttackDamage，直接 damageEnemy

P2.A4 hits 循环结束后
      ├─ frenzy stacks +1（激奋累积）
      ├─ ★ 新 ♠ T2 无影连斩：connectedHits++; 若达 N 触发"永久 hits+1"标记
      └─ state.attackedThisTurn = true
P2.A5 武器附魔 onAttack 副作用（如未在 calcAttack 内消耗）
P2.A6 史诗武器 usesRemaining-1，若耗尽 → exhaustEpicEquipment（拔下）
```

#### P2.B 技能牌（playSkillOrItem，分支 skill）

```
P2.B1 拒绝条件检查
      └─ 玩家有 no_skill / no_attack status → 拒绝
P2.B2 onPlay 钩子触发（cards.ts 各技能的 onPlay）
P2.B3 ★ 出牌副作用（v0.8.2 加）
      ├─ mage_robe +1 摸（出技能/道具时）
      ├─ lifebloom_staff 回血
      ├─ arcane_burst → calc_charge +1
      ├─ p_overload（onTurnStart 已处理）
      ├─ ★ 新 ♣ T1（待设计 — 可能是非攻牌触发）
      └─ ★ 新 ♥ T1 猎食者吸血/计数？（待定）
P2.B4 dye / chant / attune（如触发花色选择 → 进 suit_pick phase）
P2.B5 卡进 discard
```

#### P2.C 道具牌（playSkillOrItem，分支 item）

```
跟 P2.B 几乎相同流程，但：
├─ 不受 no_skill status 限制
├─ 触发 mage_robe / lifebloom_staff 等"出非攻牌"副作用
└─ 不计入 P2.B 的 no_skill 限制
```

#### P2.D 装备牌（playEquipment）

```
P2.D1 检查武器/防具槽
      └─ 同款 cap 4 件 / 不同款 → 替换 / Epic 替换走 backup
P2.D2 加入 weapons[] 或 armors[]
P2.D3 卡进 discard（装备牌出完不在手牌里，是 instance 进装备槽）
```

### P3 · 玩家点"结束回合" → 进入敌人回合

```
P3.1 玩家点 button
P3.2 entryPlayerTurn() 触发
P3.3 调 enemyTurn() / enemyTurnSteps()（generator 版本，UI 动画用）
```

---

## 阶段 E · 敌人回合

### E0 · 敌人回合开始（enemyTurnSteps 顶部）

```
E0.1 Log "── 敌人回合 ──"
E0.2 ★ ephemeral 卡清理（cleanupEphemeralCards）
     └─ 复读机克隆等从 hand/discard/pendingDraws 全清，不进牌库
E0.3 time_stop 检查
     └─ 玩家身上有 time_stop → 敌人无法行动（仅 DOT 仍走）
```

### E1 · 敌人各自结算（按 enemy 顺序，逐个执行）

**每个 enemy 一个 loop iteration**：

```
E1.A 敌人 DOT 结算（中毒 / 燃烧 / 出血 给敌人）
     ├─ 中毒：扣 maxHp × 1% × stacks, stacks-1
     ├─ 燃烧：扣 maxHp × 2% × stacks
     └─ 出血：扣 hp × 5% × stacks
     若 didDot → yield（动画拆分）

E1.B 敌人死亡检查（DOT 可能击杀）
     ├─ 击杀 → 跳过本回合 intent
     └─ 触发击杀 hooks（同 P2.A3.f 击杀检测）

E1.C 跳过条件检查
     ├─ time_stop 玩家有 → skipActions
     ├─ frozen / fear → maxActions=1
     └─ 否则按 enemy.actionsPerTurn

E1.D AP 多动循环（actionNum 1 ~ maxActions）
     ├─ a. chooseEnemyIntentIdx（AI 选当前 intent）
     │   ├─ Boss AI 钩子（berserker / hunter / 等）
     │   ├─ Boss 随机 intent（非 boss 顺序循环）
     │   └─ redirectIfSaturated（避免叠满 debuff 浪费 intent）
     ├─ b. executeIntent（generator，支持多 hit yield）
     │   ├─ "attack" 类：
     │   │   ├─ 触发 enemy crit roll → ×2 if crit
     │   │   ├─ hits 循环（每 hit 调 damagePlayer）
     │   │   ├─ damagePlayer 内的 5 区分层：
     │   │   │   ├─ 闪避路径 0-3
     │   │   │   ├─ 阶段 1 易伤区
     │   │   │   ├─ 阶段 2 固定减伤
     │   │   │   ├─ 阶段 3 减伤倍率
     │   │   │   ├─ 阶段 4 护盾吸收
     │   │   │   └─ 阶段 5 全局 GLOBAL_DEF_MULT
     │   │   └─ 完全格挡判定
     │   ├─ "buff" 类：
     │   │   └─ executeBuffIntent dispatch（self_armor / team_armor / next_attack_3 / next_hits / self_sacrifice / self_heal_pct / double_debuffs ）
     │   └─ "debuff" 类：
     │       └─ 给玩家上 debuff（含饱和检查 redirectIfSaturated）
     ├─ c. 受击副作用（damagePlayer 内 if base > 0 分支）
     │   ├─ knight_plate / combat_belt / soulreaver_plate / immortal_plate / full_plate（受击钩子）
     │   ├─ p_thorns / thorn_armor / scale_mail 反伤（给攻击者扣血）
     │   ├─ counter_stance 反击（反弹 50%）
     │   ├─ p_blood_pact 蓄势累积
     │   ├─ ★ 新 ♣ T1 咒咎/待定（受击给敌易伤）
     │   └─ Epic 防具 usesRemaining-1，若耗尽 → exhaustEpicEquipment
     ├─ d. 闪避后副作用（onDodgeTriggered，仅在闪避命中时）
     │   ├─ wind_blade（shadow_double +1 hit）
     │   ├─ phantom_cloak（+1 摸）
     │   ├─ ec_swift（+swift_dodge_temp、给敌易伤）
     │   └─ e_phantom（phantom_charge）
     ├─ e. 不灭之心复活（damagePlayer 内 if dmg>0 分支）
     │   └─ HP=0 时复活到 50% maxHP（每局 1 次）
     └─ f. yield（UI 拆分动画）
```

### E2 · 敌人回合结束副作用

```
E2.1 ec_phalanx 未受伤检查
     └─ 本回合无 took_damage_turn → 下回合开局 shield_block +K
E2.2 清掉 took_damage_turn marker
E2.3 状态衰减（敌方）
     └─ duration > 0 → duration -1; duration == 0 → 移除
        ├─ attuned 衰减时恢复 originalSuit
        └─ 其他 debuff（poison/burn/bleed stacks 已在 E1.A 处理过）
E2.4 状态衰减（玩家方）
     └─ duration > 0 → duration -1; duration == 0 → 移除
```

### E3 · 回到玩家回合开始

```
E3.1 startNewPlayerTurn(state, log) ← 回到 P0
```

---

## 阶段 BE · 战斗结束

```
BE1 checkBattleEnd 检测
    ├─ awardFragments（每个未掉过碎片的死敌：玩家 +1 碎片）
    │   └─ ★ 附魔 onKill 钩子触发
    │   └─ 精英 SR 掉落 → player.pendingEliteDropsBuffer
    ├─ if player.vita <= 0 → state.phase = "lost"
    └─ if all enemies dead → state.phase = "won"

BE2 战斗胜利后续（在 game.ts onBattleWon 内）
    ├─ player.pendingEliteDropsBuffer → state.pendingEliteDrops（待 modal 处理）
    ├─ ★ 战斗结束保留的 status / 字段：
    │   ├─ ✅ player.huntStacks（♥ T1 猎食者跨战斗保留）
    │   ├─ ✅ player.suitPlayedTotal / suitConsumedTotal（专精跨战）
    │   ├─ ✅ player.fragments（碎片跨战）
    │   ├─ ✅ player.weaponEnchant + weaponEnchantLevel
    │   ├─ ✅ player.revivesUsed（不灭之心已用次数）
    │   └─ ❌ 大多数 status 会被 newBattle 清空
    └─ phase 转入 reward_card / floor_map / elite_drop_choice 等
```

---

## 关键设计原则

### 1. **触发优先级**：副作用永远在主结算之后

例：
- 攻击命中触发 → `dmg 计算 → damageEnemy 扣 HP → 击杀检测 → 击杀副作用`
- 受击 → `dodge → 减伤栈 → 护盾 → 扣 HP → 受击副作用 → 反伤`
- 不会出现"副作用先于主结算"导致的乱序

### 2. **DOT 永远先于行动**

- 玩家 DOT 在 P1.5（回合开始）
- 敌人 DOT 在 E1.A（敌人行动前）
- 保证 DOT 不会"被 buff 抢救" — 玩家 DOT 是结果，行动还没开始

### 3. **状态衰减永远在回合切换处**

- 敌方 status duration -1 在 E2.3（敌人回合结束）
- 玩家 status duration -1 在 E2.4（敌人回合结束）
- 不在玩家回合内衰减 → 玩家出牌当回合 buff 不会"半路失效"

### 4. **结算原子性**

- 一次完整的"攻击" = 完整走完 P2.A3 a~g 后才能进下一 hit / 下一张牌
- 不会出现"hit 1 还没结束 hit 2 就开始"

### 5. **跨战斗保留 = PlayerState 字段，不是 status**

- newBattle 时 `player.statuses = []` 全清
- 跨战斗保留的东西必须挂在 player 直接字段：huntStacks / suitPlayedTotal / fragments / revivesUsed 等

---

## 设计新机制时的"挂哪个阶段"决策树

```
新机制触发条件是？

├─ 战斗开始那一刻
│   → 挂 B3 战斗起始 hook（参考 ec_runic / 夜行）
│
├─ 玩家回合开始（不论敌方做了什么）
│   ├─ 主动回血 / +资源    → P1.1
│   ├─ 上回合累积释放      → P1.2
│   ├─ 触发 onTurnStart 钩子 → P1.4
│   └─ DOT 处理            → P1.5（不要碰这块顺序，已固定）
│
├─ 玩家出牌时
│   ├─ 攻击牌相关         → P2.A 各子步骤
│   ├─ 技能 / 道具相关    → P2.B / P2.C
│   ├─ 装备相关          → P2.D
│   └─ 攻击命中 / 击杀触发 → P2.A3 e/f
│
├─ 敌人行动时
│   ├─ 敌人 DOT 结算       → E1.A
│   ├─ 敌人选 intent       → E1.D.a
│   ├─ executeIntent      → E1.D.b
│   ├─ 受击之后（不影响本次受击量）→ E1.D.c
│   ├─ 闪避之后（onDodgeTriggered）→ E1.D.d
│   └─ 不灭之心复活        → E1.D.e
│
├─ 敌人回合结束后
│   ├─ "本回合未受伤" 类条件 → E2.1
│   └─ 状态 duration 衰减   → E2.3 / E2.4
│
└─ 战斗结束
    ├─ 击杀回奖励            → BE1（awardFragments / onKill）
    └─ 跨战斗保留某资源       → BE2 + PlayerState 字段
```

---

## 实装位置索引（代码层）

| 阶段 | 函数 | 文件 |
|---|---|---|
| B 战斗开始 | `newBattle()` | `src/battle.ts` |
| P0-P1 玩家回合开始 | `startNewPlayerTurn()` | `src/battle.ts` |
| P2.A 攻击 | `playAttack()` | `src/battle.ts` |
| P2.A3.c 伤害计算 | `calcAttackDamage()` | `src/battle.ts` |
| P2.B/C 技能道具 | `playSkillOrItem()` | `src/battle.ts` |
| P2.D 装备 | `playEquipment()` | `src/battle.ts` |
| P3 结束回合 | `endPlayerTurn()` | `src/battle.ts` |
| E 敌人回合 | `enemyTurnSteps()` (generator) | `src/battle.ts` |
| E1.D.b intent 执行 | `executeIntent()` | `src/battle.ts` |
| E1.D 攻击受击 | `damagePlayer()` | `src/battle.ts` |
| E1.D.f damageEnemy | `damageEnemy()` | `src/cards.ts` |
| BE 战斗结束 | `checkBattleEnd()` / `awardFragments()` | `src/battle.ts` |
| 战斗后路由 | `onBattleWon()` | `src/game.ts` |

---

## 常见冲突场景的解决方案

### 场景 1：多个回合开始回血源相加

✅ 已按 P1.1 顺序固定：♥T1 → ec_resilient → life_pouch → brew_regen → 新滋养型
**冲突预防**：所有回血都走 `state.player.vita += X; vita = min(maxHp, vita)` 模式

### 场景 2：DOT 在 P0 还是 P1 触发？

✅ 在 P1.5（前置结算后期，摸牌之前）
**理由**：让 P1.4 的 onTurnStart 钩子（如 p_lifetap 给敌人伤害）先触发，让 DOT 不会"被回血源抢救"

### 场景 3：fullplate_pending 在玩家回合开始触发，还是上回合结束？

✅ 在 P1.2（玩家回合开始前置结算）
**理由**：玩家受击时挂 pending（E1.D.c），玩家回合开始时释放为 shield。设计上让"反震护盾"在玩家可见时机出现。

### 场景 4：连击计数（无影连斩 connectedHits）的清零时机？

✅ 在 P2.A3.e 命中成功 → connectedHits++（待加）
✅ 在 P2.B/C/D 出非攻牌 / 攻击未命中 → connectedHits = 0
**理由**：连击数是"攻击节奏"维度，跟"回合数"无关

### 场景 5：跨战斗 stack（如 huntStacks）保留？

✅ 用 `player.huntStacks: number` 字段（不在 statuses 里）
**理由**：newBattle 时 `player.statuses = []` 会清空 status，必须挂 player 直接字段

### 场景 6：完全格挡触发动画 + 不计入 took_damage_turn

✅ 在 P2.A3 / E1.D 的 damagePlayer 内：if (base > 0 && finalDmg == 0) → BLOCK 动画 + pendingBlockFx++
✅ 但 `took_damage_turn` 仅在 dmg > 0 时挂（完全格挡不算"受伤"）
**理由**：玩家被打到 0 伤 = 受击但不掉血，反伤甲连击不应计数

---

## 待定 / 新机制待挂时机

| 待定机制 | 建议时机 |
|---|---|
| ♣ T1 / T3（用户思考中） | 取决于设计 — 触发条件决定挂哪阶段 |
| 主动按钮型附魔（斩首 / 阴影分身 / 血魂回环 / ♣T3） | 玩家点按钮 → 中间触发，类似 P2.B 但不消耗手牌 |
| 卖卡 3 张 + 普通碎片限制 | 在 events.ts merchantSellCard，跟战斗无关 |
| 时间倒流（如果 ♣ T3 用） | 受击时记录历史，按钮触发时回滚最近 N 次 |

---

## 维护规则

每次：
- 加新装备 / 特性 / 附魔 / 技能 / 道具
- 改触发时机或顺序
- 发现某个阶段顺序错乱导致的 bug

**必须**回来更新本表的对应阶段 / 决策树 / 实装位置索引。
