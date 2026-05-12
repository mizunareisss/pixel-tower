// Boss / 精英招式池 + 流派使用矩阵导出
// 用法：npx tsx scripts/dump-boss-intents.ts
// 输出：
//   balance-csv/boss-intents.csv      — 全 intent + 5 流派各自的 role
//   balance-csv/boss-ap-plan.csv      — AP/回合 配置表
//   balance-csv/flow-rotation.csv     — 每流派 × race × AP 的连招模板

import { writeFileSync, mkdirSync } from "fs";

const BOM = "﻿";

interface IntentRow {
  race: string;
  name: string;
  type: "attack" | "buff" | "debuff";
  baseValue: number;
  hits?: number;
  debuffId?: string;
  debuffName?: string;
  debuffDuration?: number;
  status: "current" | "PROPOSED" | "F9 boss only" | "F12 boss only";
  effectDesc: string;
  notes?: string;
}

// ───────── 现有招式池（同步自 src/enemies.ts INTENT_POOLS）─────────
const CURRENT: IntentRow[] = [
  // beast 兽
  { race: "beast", name: "啃咬",   type: "attack", baseValue: 4,   status: "current", effectDesc: "单击 4 伤" },
  { race: "beast", name: "撕咬",   type: "attack", baseValue: 5,   status: "current", effectDesc: "单击 5 伤" },
  { race: "beast", name: "连咬",   type: "attack", baseValue: 2.5, hits: 2, status: "current", effectDesc: "2 段 ×2.5（共 5）" },
  { race: "beast", name: "突袭",   type: "attack", baseValue: 6,   status: "current", effectDesc: "单击 6 伤" },
  { race: "beast", name: "嚎叫",   type: "buff",   baseValue: 0,   status: "current", effectDesc: "下次攻击 +3" },
  { race: "beast", name: "獠牙伤", type: "debuff", baseValue: 2,   debuffId: "poison", debuffName: "中毒", status: "current", effectDesc: "+2 中毒（每回合扣 stack HP, 衰减 -1/回）" },

  // humanoid 人型
  { race: "humanoid", name: "挥砍", type: "attack", baseValue: 4,   status: "current", effectDesc: "单击 4 伤" },
  { race: "humanoid", name: "连斩", type: "attack", baseValue: 3, hits: 2, status: "current", effectDesc: "2 段 ×3" },
  { race: "humanoid", name: "突刺", type: "attack", baseValue: 5,   status: "current", effectDesc: "单击 5 伤" },
  { race: "humanoid", name: "重击", type: "attack", baseValue: 6,   status: "current", effectDesc: "单击 6 伤" },
  { race: "humanoid", name: "战吼", type: "buff",   baseValue: 0,   status: "current", effectDesc: "下次攻击 +3" },
  { race: "humanoid", name: "断筋", type: "debuff", baseValue: 3,   debuffId: "weak", debuffName: "虚弱", debuffDuration: 2, status: "current", effectDesc: "玩家虚弱 stack +3（攻击 -stack），2 回合" },
  { race: "humanoid", name: "破甲", type: "debuff", baseValue: 2,   debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2, status: "current", effectDesc: "玩家易伤 stack +2（受伤 ×1.5），2 回合" },

  // undead 不死
  { race: "undead", name: "骨锤",       type: "attack", baseValue: 5,   status: "current", effectDesc: "单击 5 伤" },
  { race: "undead", name: "骨爪",       type: "attack", baseValue: 3, hits: 2, status: "current", effectDesc: "2 段 ×3" },
  { race: "undead", name: "灵魂吸食",   type: "attack", baseValue: 6,   status: "current", effectDesc: "单击 6 伤" },
  { race: "undead", name: "凋零术",     type: "debuff", baseValue: 4,   debuffId: "poison", debuffName: "中毒", status: "current", effectDesc: "+4 中毒" },
  { race: "undead", name: "诅咒",       type: "debuff", baseValue: 2,   debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2, status: "current", effectDesc: "易伤 +2, 2 回合" },
  { race: "undead", name: "瘴气",       type: "debuff", baseValue: 3,   debuffId: "weak", debuffName: "虚弱", debuffDuration: 2, status: "current", effectDesc: "虚弱 +3, 2 回合" },

  // giant 巨怪
  { race: "giant", name: "巨拳",   type: "attack", baseValue: 7,   status: "current", effectDesc: "单击 7 伤" },
  { race: "giant", name: "双拳",   type: "attack", baseValue: 4, hits: 2, status: "current", effectDesc: "2 段 ×4" },
  { race: "giant", name: "跺地震", type: "attack", baseValue: 9,   status: "current", effectDesc: "单击 9 伤" },
  { race: "giant", name: "硬化",   type: "buff",   baseValue: 0,   status: "current", effectDesc: "armor +1（永久持续到死，叠加无 cap）" },
  { race: "giant", name: "砸碎",   type: "debuff", baseValue: 3,   debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 2, status: "current", effectDesc: "易伤 +3, 2 回合" },
  { race: "giant", name: "重击",   type: "attack", baseValue: 11,  status: "current", effectDesc: "单击 11 伤（最强单击）" },

  // dark 暗影
  { race: "dark", name: "暗影斩",     type: "attack", baseValue: 5,   status: "current", effectDesc: "单击 5 伤" },
  { race: "dark", name: "影矛连射",   type: "attack", baseValue: 3, hits: 2, status: "current", effectDesc: "2 段 ×3" },
  { race: "dark", name: "黑闪",       type: "attack", baseValue: 7,   status: "current", effectDesc: "单击 7 伤" },
  { race: "dark", name: "暗杀重击",   type: "attack", baseValue: 8,   status: "current", effectDesc: "单击 8 伤" },
  { race: "dark", name: "黑诅咒",     type: "debuff", baseValue: 3,   debuffId: "vulnerable", debuffName: "易伤", debuffDuration: 3, status: "current", effectDesc: "易伤 +3, 3 回合（最长）" },
  { race: "dark", name: "腐血",       type: "debuff", baseValue: 4,   debuffId: "poison", debuffName: "中毒", status: "current", effectDesc: "+4 中毒" },
  { race: "dark", name: "暗影遁",     type: "buff",   baseValue: 0,   status: "current", effectDesc: "下次攻击 +3" },
];

// ───────── 提议新增（补 undead 缺 buff、所有种族多 1 个 buff 类型 / 让多动连招有花样）─────────
const PROPOSED: IntentRow[] = [
  { race: "beast",    name: "血怒",       type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "本回合 boss armor +2", notes: "防御 buff，跟嚎叫攻 +3 互补" },
  { race: "humanoid", name: "结阵",       type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "全队（含自己）armor +2, 1 回合", notes: "群体防御 buff，多人战变厚" },
  { race: "undead",   name: "死灵之力",   type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "boss HP +5% maxHP", notes: "★ 关键 — undead 没有 buff，狂战/构筑/应变流派现在用不了" },
  { race: "undead",   name: "凋零附身",   type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "下次攻击命中 → 玩家身上 dot stack +1（全 dot 类共享）", notes: "高级备选 —会让 dot 流派更狠" },
  { race: "giant",    name: "狂奔",       type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "下张攻击 hits +1（多段化）", notes: "让 giant 重击变多段" },
  { race: "dark",     name: "血祭",       type: "buff", baseValue: 0, status: "PROPOSED", effectDesc: "自损 3% maxHP, 下张攻击 +30%", notes: "高风险高回报 buff" },
];

// ───────── Boss 专属标志性招式 ─────────
const BOSS_SPECIAL: IntentRow[] = [
  // F9 亡灵之主
  { race: "undead", name: "亡者复苏", type: "buff",   baseValue: 0, status: "F9 boss only", effectDesc: "F9 boss 回血 8% maxHP", notes: "PROPOSED — 给 F9 boss 标志性招式" },
  // F12 无相之主（终末注视已实装；终末降临 PROPOSED）
  { race: "dark",   name: "终末注视", type: "attack", baseValue: 11, status: "F12 boss only", effectDesc: "极重击（base 10 × 1.1）", notes: "已实装（buildFixedBoss F12 push）" },
  { race: "dark",   name: "终末降临", type: "buff",   baseValue: 0, status: "F12 boss only", effectDesc: "phase 3：所有玩家身上 debuff stack ×2", notes: "PROPOSED — phase 3 触发的标志性招式" },
];

// ───────── 流派 → 各 type 的使用 role ─────────
// role: opener / core / filler / finisher / safety / — (不用)
function flowRole(flow: string, intent: IntentRow): string {
  const t = intent.type;
  const v = intent.baseValue * (intent.hits ?? 1);
  switch (flow) {
    case "berserker":
      if (t === "buff")   return "opener (HP>70%)";
      if (t === "attack") return v >= 8 ? "finisher (HP<30% 取最强)" : "core";
      return "—";
    case "hunter":
      if (t === "debuff") return "opener (削)";
      if (t === "attack") return "follow-up";
      return "—";
    case "builder":
      if (t === "buff")   return "core (turn≤3 堆 buff)";
      if (t === "attack") return v >= 6 ? "burst (turn≥6 爆发)" : "filler";
      return "—";
    case "healer":
      if (t === "debuff") return "core (叠 dot)";
      if (t === "attack") return "补刀 (50%)";
      return "—";
    case "reactor":
      if (t === "buff")   return "safety (HP>60%)";
      if (t === "attack") return "core (HP<60%)";
      return "—";
  }
  return "—";
}

// ───────── 输出 CSV ─────────
mkdirSync("balance-csv", { recursive: true });

const all = [...CURRENT, ...PROPOSED, ...BOSS_SPECIAL];

// 1) boss-intents.csv — 主表
{
  const head = [
    "race", "name", "type", "base_value", "hits",
    "debuff_id", "debuff_name", "debuff_duration",
    "status", "effect_desc",
    "berserker_role", "hunter_role", "builder_role", "healer_role", "reactor_role",
    "notes",
  ];
  const lines = [csvRow(head)];
  for (const r of all) {
    lines.push(csvRow([
      r.race, r.name, r.type, r.baseValue, r.hits ?? "",
      r.debuffId ?? "", r.debuffName ?? "", r.debuffDuration ?? "",
      r.status, r.effectDesc,
      flowRole("berserker", r),
      flowRole("hunter", r),
      flowRole("builder", r),
      flowRole("healer", r),
      flowRole("reactor", r),
      r.notes ?? "",
    ]));
  }
  writeFileSync("balance-csv/boss-intents.csv", BOM + lines.join("\n") + "\n");
  console.log(`✓ boss-intents.csv  (${all.length} rows: ${CURRENT.length} current + ${PROPOSED.length} proposed + ${BOSS_SPECIAL.length} boss-special)`);
}

// 2) boss-ap-plan.csv — AP 配置
{
  const head = ["tier", "floor_range", "ap_per_turn", "notes"];
  const rows = [
    ["普通敌人", "all", 1, "保持不变"],
    ["精英", "F1-5", 1, "热身期"],
    ["精英", "F6-10", 2, "中期施压"],
    ["精英", "F11+", 3, "后期 3 动（用户决定）"],
    ["普通 Boss", "F3", 2, "首个 boss，2 动入门"],
    ["普通 Boss", "F6", 2, ""],
    ["固定 Boss", "F9 亡灵之主", 3, ""],
    ["固定 Boss", "F12 无相之主", 4, "★ 终末，4 动（最高）"],
    ["普通 Boss", "F15+", 3, "后期通用 boss"],
  ];
  const lines = [csvRow(head), ...rows.map(r => csvRow(r))];
  writeFileSync("balance-csv/boss-ap-plan.csv", BOM + lines.join("\n") + "\n");
  console.log(`✓ boss-ap-plan.csv  (${rows.length} rows)`);
}

// 3) flow-rotation.csv — 每流派 × race × AP 的连招模板（5 流派 × 5 race × 3 AP 档 = 75 行）
{
  const flows = ["berserker", "hunter", "builder", "healer", "reactor"];
  const races = ["beast", "humanoid", "undead", "giant", "dark"];
  const rotations: Record<string, Record<number, string>> = {
    berserker: {
      2: "HP>70%: [buff, attack] / HP 30-70%: [attack, attack] / HP<30%: [highest, attack]",
      3: "HP>70%: [buff, attack, attack] / HP 30-70%: [attack, attack, attack] / HP<30%: [highest, highest, attack]",
      4: "HP>70%: [buff, attack, attack, buff] / HP<30%: [highest, highest, attack, attack]",
    },
    hunter: {
      2: "playerHP>50%: [debuff, attack] / playerHP 30-50%: [attack, attack] / <30%: [highest, attack]",
      3: "playerHP>50%: [debuff, attack, attack] / <30%: [debuff, highest, attack]",
      4: "[debuff, debuff, attack, highest]",
    },
    builder: {
      2: "turn≤3: [buff, buff] / turn 4-5: [buff, attack] / turn≥6: [attack, attack]",
      3: "turn≤3: [buff, buff, attack] / turn≥6: [attack, attack, attack]",
      4: "turn≤3: [buff, buff, buff, attack] / turn≥6: [attack, attack, attack, attack]",
    },
    healer: {
      2: "playerDot<3: [debuff, debuff] / dot 充足: [debuff, attack]",
      3: "playerDot<3: [debuff, debuff, attack] / 充足: [debuff, attack, attack]",
      4: "[debuff, debuff, debuff, attack]",
    },
    reactor: {
      2: "HP>60%: [attack, buff] / HP≤60%: [attack, attack]",
      3: "HP>60%: [attack, buff, attack] / HP≤60%: [attack, attack, attack]",
      4: "[attack, attack, buff, attack]",
    },
  };

  // race + flow 的适配度（哪些种族能完整跑这个流派）
  // 注：如果接受 PROPOSED 新增 buff，所有 race × flow 都能完整跑
  function compatibility(flow: string, race: string): string {
    if (race === "undead" && (flow === "berserker" || flow === "builder" || flow === "reactor")) {
      return "⚠ 缺 buff（需 PROPOSED 死灵之力）";
    }
    return "✓ 完整可用";
  }

  const head = ["flow", "race", "ap", "rotation_pattern", "compatibility", "notes"];
  const lines = [csvRow(head)];
  for (const flow of flows) {
    for (const race of races) {
      for (const ap of [2, 3, 4]) {
        lines.push(csvRow([
          flow, race, ap,
          rotations[flow][ap],
          compatibility(flow, race),
          "",
        ]));
      }
    }
  }
  writeFileSync("balance-csv/flow-rotation.csv", BOM + lines.join("\n") + "\n");
  console.log(`✓ flow-rotation.csv  (${lines.length - 1} rows)`);
}

console.log("\n→ 文件位置：balance-csv/boss-intents.csv（主表）、boss-ap-plan.csv、flow-rotation.csv");

// ─── 工具 ───
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
