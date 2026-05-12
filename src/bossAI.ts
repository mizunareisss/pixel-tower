// Boss AI 行为流派系统
//
// 设计原则：
//   - 行为是隐式的（无视觉提示），玩家通过观察推断 boss 性格
//   - 玩家有多种合理应对方案（不剥夺手牌 / 操作 / build 选择）
//   - 难度来自"读不懂"而非"无解"
//
// 实施：每个 AI 实现 selectNextIntent(enemy, state) → 返回招式 index
// battle.ts enemyTurn 检测 enemy.ai → 调用对应 AI 决策（旧的 intentIndex 循环作为 fallback）

import type { BattleState, EnemyState, BossAIId } from "./types.ts";

interface AIContext {
  enemy: EnemyState;
  state: BattleState;
  hpPct: number;          // boss 当前 HP%
  playerHpPct: number;    // 玩家当前 HP%
  turn: number;
  // 多动：本回合已经选过的 intent indices，避免一个回合内重复出同一招
  usedThisTurn: number[];
}

// 模块级变量：多动时本回合已选过的 intent indices（avoidRepeat 用）
// selectAIIntent 在每次决策前 set 一次，避免改所有 callsite
let _currentUsedThisTurn: number[] = [];

// 工具：从招式池里按 type 过滤
function pickByType(enemy: EnemyState, types: ("attack" | "buff" | "debuff")[]): number[] {
  return enemy.intents
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => types.includes(it.type))
    .map(({ idx }) => idx);
}

// 工具：从 indices 里随机取一个
function pickRandom(indices: number[]): number {
  if (indices.length === 0) return 0;
  return indices[Math.floor(Math.random() * indices.length)];
}

// 工具：从 indices 里取数值最高的（仅对 attack 类型有意义）
function pickHighestValue(enemy: EnemyState, indices: number[]): number {
  if (indices.length === 0) return 0;
  let bestIdx = indices[0];
  let bestVal = enemy.intents[bestIdx].value * (enemy.intents[bestIdx].hits ?? 1);
  for (const idx of indices) {
    const v = enemy.intents[idx].value * (enemy.intents[idx].hits ?? 1);
    if (v > bestVal) { bestVal = v; bestIdx = idx; }
  }
  return bestIdx;
}

// 工具：避免立即重复同一招（更自然）
//   多动时也排除本回合已选过的 indices（从 _currentUsedThisTurn 读，由 selectAIIntent 设置）
function avoidRepeat(indices: number[], lastIdx: number): number[] {
  if (indices.length === 1) return indices;
  const exclude = new Set([lastIdx, ..._currentUsedThisTurn]);
  const filtered = indices.filter(i => !exclude.has(i));
  return filtered.length > 0 ? filtered : indices.filter(i => i !== lastIdx);  // 保底
}

// 工具：boss 检测玩家上一回合是否上 buff（看 player.statuses 里 duration > 0 的 buff）
function countPlayerBuffs(ctx: AIContext): number {
  // 玩家 buff 类 status（duration > 0 表示本回合或下回合内的临时 buff）
  const BUFF_IDS = new Set([
    "battle_cry", "double_strike", "evasive", "sharpened", "shield_block",
    "shadow_double", "heavy_strike", "counter_stance", "smoke_dodge",
    "guaranteed_dodge", "pierce_next", "phantom_charge", "frenzy",
    "charged", "combat_rhythm", "blood_pact", "arcane_burst",
  ]);
  return ctx.state.player.statuses.filter(s => BUFF_IDS.has(s.id)).length;
}

// ─────────────────────────────────────────────────────────
// 5 基础 AI
// ─────────────────────────────────────────────────────────

// 狂战士：HP 越低越猛
// > 70%: 混合行为（随机）
// 30-70%: 偏好攻击（70% attack / 30% other）
// < 30%: 只出最高数值的攻击
function aiBerserker(ctx: AIContext): number {
  const { enemy, hpPct } = ctx;
  const attacks = pickByType(enemy, ["attack"]);
  const all = enemy.intents.map((_, i) => i);

  if (hpPct > 0.7) {
    // 混合，随机
    return pickRandom(avoidRepeat(all, enemy.intentIndex));
  }
  if (hpPct > 0.3) {
    // 偏好攻击 70%
    if (Math.random() < 0.7 && attacks.length > 0) {
      return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
    }
    return pickRandom(avoidRepeat(all, enemy.intentIndex));
  }
  // 残血：最强攻击
  if (attacks.length > 0) return pickHighestValue(enemy, attacks);
  return pickRandom(all);
}

// 猎手：看玩家 HP 切策略
// 玩家 HP > 50%: 偏好 debuff
// 玩家 HP 30-50%: 偏好 attack
// 玩家 HP < 30%: 最高数值 attack
function aiHunter(ctx: AIContext): number {
  const { enemy, playerHpPct } = ctx;
  const attacks = pickByType(enemy, ["attack"]);
  const debuffs = pickByType(enemy, ["debuff"]);
  const all = enemy.intents.map((_, i) => i);

  if (playerHpPct > 0.5) {
    // 偏好 debuff 削弱
    if (Math.random() < 0.65 && debuffs.length > 0) {
      return pickRandom(avoidRepeat(debuffs, enemy.intentIndex));
    }
    return pickRandom(avoidRepeat(all, enemy.intentIndex));
  }
  if (playerHpPct > 0.3) {
    // 偏好 attack 撕开
    if (Math.random() < 0.75 && attacks.length > 0) {
      return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
    }
    return pickRandom(avoidRepeat(all, enemy.intentIndex));
  }
  // 残血玩家：最高 attack 秒杀
  if (attacks.length > 0) return pickHighestValue(enemy, attacks);
  return pickRandom(all);
}

// 构筑者：前 3 回合堆 buff，第 4 回合开始爆发
function aiBuilder(ctx: AIContext): number {
  const { enemy, turn } = ctx;
  const buffs = pickByType(enemy, ["buff"]);
  const attacks = pickByType(enemy, ["attack"]);
  const all = enemy.intents.map((_, i) => i);

  // 战斗早期触发"爆发"：boss 被打太狠就提前进攻
  const earlyTriggered = enemy.hp < enemy.maxHp * 0.7;

  if (turn <= 3 && !earlyTriggered) {
    // 前 3 回合优先 buff
    if (Math.random() < 0.7 && buffs.length > 0) {
      return pickRandom(avoidRepeat(buffs, enemy.intentIndex));
    }
    return pickRandom(avoidRepeat(all, enemy.intentIndex));
  }
  // 爆发期：优先 attack
  if (attacks.length > 0) {
    return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
  }
  return pickRandom(avoidRepeat(all, enemy.intentIndex));
}

// 医者：持续 dot
function aiHealer(ctx: AIContext): number {
  const { enemy, state } = ctx;
  const debuffs = pickByType(enemy, ["debuff"]);
  const attacks = pickByType(enemy, ["attack"]);
  const all = enemy.intents.map((_, i) => i);

  // 检测玩家身上 dot 数量
  const dotIds = new Set(["poison", "burn", "bleed", "weak", "vulnerable"]);
  const playerDots = state.player.statuses.filter(s => dotIds.has(s.id));

  // 如果玩家没有 dot，强制上 dot
  if (playerDots.length === 0 && debuffs.length > 0) {
    return pickRandom(debuffs);
  }
  // 玩家 dot 充足 → 偶尔补 attack（50% 攻击 / 50% 续 dot）
  if (Math.random() < 0.5 && attacks.length > 0) {
    return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
  }
  if (debuffs.length > 0) {
    return pickRandom(avoidRepeat(debuffs, enemy.intentIndex));
  }
  return pickRandom(all);
}

// 报复者：根据玩家上回合行为 react
// 检测玩家上回合输出、buff 数、闪避状态
function aiReactor(ctx: AIContext): number {
  const { enemy, state } = ctx;
  const attacks = pickByType(enemy, ["attack"]);
  const buffs = pickByType(enemy, ["buff"]);
  const debuffs = pickByType(enemy, ["debuff"]);
  const all = enemy.intents.map((_, i) => i);

  const playerBuffs = countPlayerBuffs(ctx);
  const lastDmg = enemy.aiState?.lastPlayerDmg ?? 0;
  const isPlayerHighDodge = state.player.armors[0]?.defId === "mind_armor"
    || state.player.perks.filter(p => p.defId === "p_dodge").length >= 2;

  // 玩家高输出 → boss 上 armor（buff 自己），下回合慢下来
  if (lastDmg > enemy.maxHp * 0.15 && buffs.length > 0) {
    return pickRandom(buffs);
  }
  // 玩家上 buff 多 → boss 用 debuff 削
  if (playerBuffs >= 2 && debuffs.length > 0) {
    return pickRandom(debuffs);
  }
  // 玩家闪避 build → boss 选 hits 多的攻击
  if (isPlayerHighDodge && attacks.length > 0) {
    const multiHits = attacks.filter(i => (enemy.intents[i].hits ?? 1) > 1);
    if (multiHits.length > 0) return pickRandom(multiHits);
  }
  // 默认偏好 attack
  if (attacks.length > 0) {
    return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
  }
  return pickRandom(avoidRepeat(all, enemy.intentIndex));
}

// ─────────────────────────────────────────────────────────
// 5 复合 AI
// ─────────────────────────────────────────────────────────

// 双面狂战：HP > 60% 像构筑者；HP < 60% 像狂战士
function aiDualBerserk(ctx: AIContext): number {
  if (ctx.hpPct > 0.6) return aiBuilder(ctx);
  return aiBerserker(ctx);
}

// 冷血猎手：玩家 HP > 50% 像医者；玩家 HP < 50% 像猎手
function aiColdHunter(ctx: AIContext): number {
  if (ctx.playerHpPct > 0.5) return aiHealer(ctx);
  return aiHunter(ctx);
}

// 假动作构筑：构筑 + 报复 + 30% 假动作
// 30% 概率随机出招（"假"，让玩家不能 100% 预测）
function aiFakeBuilder(ctx: AIContext): number {
  // 30% 假动作概率
  if (Math.random() < 0.30) {
    const all = ctx.enemy.intents.map((_, i) => i);
    return pickRandom(avoidRepeat(all, ctx.enemy.intentIndex));
  }
  // 70% 时间：前 3 回合 builder，之后 reactor
  if (ctx.turn <= 3) return aiBuilder(ctx);
  return aiReactor(ctx);
}

// 不朽医者：医者 + 狂战，HP 越低 dot 越浓
function aiUnstoppableHealer(ctx: AIContext): number {
  const { enemy, state, hpPct } = ctx;
  const debuffs = pickByType(enemy, ["debuff"]);
  const attacks = pickByType(enemy, ["attack"]);

  // dot 频率按 HP 调整
  const dotIds = new Set(["poison", "burn", "bleed"]);
  const playerDotStacks = state.player.statuses
    .filter(s => dotIds.has(s.id))
    .reduce((sum, s) => sum + s.stacks, 0);

  // HP > 70%: 每 3 回合上 1 次 dot；HP 40-70%: 每 2 回合；HP < 40%: 每回合
  const dotPriority = hpPct < 0.4 ? 0.9 : hpPct < 0.7 ? 0.65 : 0.4;

  // 玩家 dot 不够浓 → 优先上 dot
  if (playerDotStacks < 3 && Math.random() < dotPriority && debuffs.length > 0) {
    return pickRandom(debuffs);
  }
  // 否则攻击补刀
  if (attacks.length > 0) {
    return pickRandom(avoidRepeat(attacks, enemy.intentIndex));
  }
  return pickRandom(enemy.intents.map((_, i) => i));
}

// 死灵猎手：三流派叠加（猎手底色 + 报复修正 + 医者持续 dot）
function aiNecroHunter(ctx: AIContext): number {
  // 25% 概率走 reactor 反向
  if (Math.random() < 0.25) {
    return aiReactor(ctx);
  }
  // 25% 概率走 healer 续 dot
  if (Math.random() < 0.33) {
    return aiHealer(ctx);
  }
  // 默认猎手
  return aiHunter(ctx);
}

// ─────────────────────────────────────────────────────────
// F12 专属：演化型（3 阶段切换复合流派）
// 阶段切换时触发 flavor log（main.ts 渲染时检查 aiState.flavorShownPhases）
// ─────────────────────────────────────────────────────────

function aiEvolving(ctx: AIContext): number {
  const { enemy, hpPct } = ctx;
  // 当前 phase
  let phase = 1;
  if (hpPct <= 0.33) phase = 3;
  else if (hpPct <= 0.66) phase = 2;

  // 更新内部 phase 状态（用于 main.ts flavor log）
  if (!enemy.aiState) enemy.aiState = {};
  enemy.aiState.phase = phase;

  // 每个阶段用不同复合流派
  if (phase === 1) return aiDualBerserk(ctx);
  if (phase === 2) return aiFakeBuilder(ctx);
  return aiNecroHunter(ctx);
}

// ─────────────────────────────────────────────────────────
// 入口表
// ─────────────────────────────────────────────────────────

export const BOSS_AI: Record<BossAIId, (ctx: AIContext) => number> = {
  berserker: aiBerserker,
  hunter: aiHunter,
  builder: aiBuilder,
  healer: aiHealer,
  reactor: aiReactor,
  dual_berserk: aiDualBerserk,
  cold_hunter: aiColdHunter,
  fake_builder: aiFakeBuilder,
  unstoppable_healer: aiUnstoppableHealer,
  necro_hunter: aiNecroHunter,
  evolving: aiEvolving,
};

// 入口：battle.ts enemyTurn 时调用
// 返回招式 index；如果 enemy.ai 未设置或无效，返回 -1（由调用方 fallback 到旧逻辑）
// usedThisTurn: 多动时本回合已经选过的 intent index 列表（避免立即重复同一招）
export function selectAIIntent(enemy: EnemyState, state: BattleState, usedThisTurn: number[] = []): number {
  if (!enemy.ai) return -1;
  const fn = BOSS_AI[enemy.ai];
  if (!fn) return -1;
  const hpPct = enemy.hp / enemy.maxHp;
  const playerHpPct = state.player.vita / state.player.vitaMax;
  // 用 enemy.aiState.turnCount 记录回合数（仅每回合首次决策时 +1）
  if (!enemy.aiState) enemy.aiState = {};
  if (usedThisTurn.length === 0) {
    enemy.aiState.turnCount = (enemy.aiState.turnCount ?? 0) + 1;
  }
  const turn = enemy.aiState.turnCount ?? 1;
  // 设置模块级变量供 avoidRepeat 读
  _currentUsedThisTurn = usedThisTurn;
  const result = fn({ enemy, state, hpPct, playerHpPct, turn, usedThisTurn });
  _currentUsedThisTurn = [];
  return result;
}

// F12 flavor log — main.ts 在 renderEnemy 时检测 aiState.phase 变化触发
// 返回当前应该显示的 flavor log（如果 phase 切换且未显示过），否则 null
export function getF12FlavorLog(enemy: EnemyState): string | null {
  if (enemy.ai !== "evolving" || !enemy.aiState) return null;
  const phase = enemy.aiState.phase ?? 1;
  if (!enemy.aiState.flavorShownPhases) enemy.aiState.flavorShownPhases = [];
  if (enemy.aiState.flavorShownPhases.includes(phase)) return null;
  enemy.aiState.flavorShownPhases.push(phase);

  if (phase === 1) return "无相之主在黑雾中显出轮廓...";
  if (phase === 2) return "无相之主露出了眼睛。";
  if (phase === 3) return "无相之主开始消散，但攻击更准了。";
  return null;
}
