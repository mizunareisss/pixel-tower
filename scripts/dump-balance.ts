// 平衡数值导出脚本
// 用法：npx tsx scripts/dump-balance.ts
// 输出：
//   BALANCE_SHEET.md（按花色分类的全卡 + 附魔 5 档 + 花色专精完整表）
//   balance-csv/*.csv（同样数据的 CSV，便于导 Google Sheets / Numbers / Excel）

import { CARD_DB } from "../src/cards.ts";
import {
  ENCHANT_LEVEL_PARAMS, ENCHANT_NAMES, ENCHANT_RECIPES, ENCHANTS,
  getEnchantDescAt, ENCHANT_MAX_LEVEL,
} from "../src/types.ts";
import type { CardDef, Suit, CardCategory } from "../src/types.ts";
import { writeFileSync, mkdirSync } from "fs";

const SUIT_LABEL: Record<string, string> = {
  spade:   "♠ 黑桃 / 莽夫流（攻击）",
  diamond: "♦ 方块 / 暗影流（闪避 / 多段）",
  heart:   "♥ 红心 / 生机流（吸血 / 续航）",
  club:    "♣ 梅花 / 法术流（护盾 / 控制）",
  none:    "无花色 / 通用",
};
const SUIT_ORDER: (Suit | "none")[] = ["spade", "diamond", "heart", "club", "none"];

const CAT_LABEL: Record<CardCategory, string> = {
  attack:    "攻击牌",
  skill:     "技能牌",
  item:      "道具牌",
  equipment: "装备",
  perk:      "特性",
};
const CAT_ORDER: CardCategory[] = ["attack", "skill", "item", "equipment", "perk"];

function suitOfCard(d: CardDef): Suit | "none" {
  return (d.attackSuit ?? d.equipSuit ?? d.defaultSuit ?? "none") as Suit | "none";
}

// ───────── 收集 + 按花色 / 类别 分组 ─────────
const grouped: Record<string, Record<CardCategory, [string, CardDef][]>> = {};
for (const suit of SUIT_ORDER) {
  grouped[suit] = { attack: [], skill: [], item: [], equipment: [], perk: [] };
}
for (const [id, def] of Object.entries(CARD_DB)) {
  const suit = suitOfCard(def);
  grouped[suit][def.category].push([id, def]);
}

const out: string[] = [];
out.push("# 塔牌 · Suitspire 全平衡数值表");
out.push("");
out.push(`生成于 ${new Date().toISOString().split("T")[0]}（dev branch）`);
out.push("");
out.push("> 本文档由 `scripts/dump-balance.ts` 从源码自动生成。修改任何卡牌/附魔后重跑脚本可同步。");
out.push("");
out.push("---");

// ───────── 按花色 ─────────
for (const suit of SUIT_ORDER) {
  const cats = grouped[suit];
  const total = CAT_ORDER.reduce((sum, c) => sum + cats[c].length, 0);
  if (total === 0) continue;
  out.push("");
  out.push(`## ${SUIT_LABEL[suit]}（共 ${total} 张）`);

  for (const cat of CAT_ORDER) {
    const items = cats[cat];
    if (items.length === 0) continue;
    out.push("");
    out.push(`### ${CAT_LABEL[cat]}（${items.length}）`);
    out.push("");

    if (cat === "equipment") {
      out.push("| ID | 名称 | 槽 | 稀有度 | 基础值 | 描述 | 1 件 | 2 件 | 3 件 | 4 件 |");
      out.push("|---|---|---|---|---|---|---|---|---|---|");
      for (const [id, d] of items) {
        const baseLine = d.equipKind === "weapon"
          ? `dmg ${d.baseDmg ?? "-"} / hits ${d.hits ?? 1} / pierce ${d.pierce ?? 0}`
          : `reduce ${d.baseReduce ?? "-"}`;
        const eff = d.equipEffects ?? [];
        const cells = [0, 1, 2, 3].map(i => {
          const e = eff[i];
          if (!e) return "—";
          return (e.stat ?? e.desc ?? "—").replace(/\|/g, "\\|");
        });
        out.push(`| \`${id}\` | ${d.name} | ${d.equipKind} | ${d.rarity ?? "-"} | ${baseLine} | ${cleanCell(d.desc)} | ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} |`);
      }
    } else if (cat === "perk") {
      out.push("| ID | 名称 | 单张效果 | 默认花色 |");
      out.push("|---|---|---|---|");
      for (const [id, d] of items) {
        const unit = d.perkEffect?.unitDesc ?? d.desc;
        out.push(`| \`${id}\` | ${d.name} | ${cleanCell(unit)} | ${d.defaultSuit ?? "-"} |`);
      }
    } else if (cat === "attack") {
      out.push("| ID | 名称 | 稀有度 | 描述 |");
      out.push("|---|---|---|---|");
      for (const [id, d] of items) {
        out.push(`| \`${id}\` | ${d.name} | ${d.rarity ?? "-"} | ${cleanCell(d.desc)} |`);
      }
    } else {
      // skill / item
      out.push("| ID | 名称 | 稀有度 | 目标 | 描述 |");
      out.push("|---|---|---|---|---|");
      for (const [id, d] of items) {
        out.push(`| \`${id}\` | ${d.name} | ${d.rarity ?? "-"} | ${d.target ?? "-"} | ${cleanCell(d.desc)} |`);
      }
    }
  }
}

// ───────── 附魔 5 档完整数值 ─────────
out.push("");
out.push("---");
out.push("");
out.push("## 附魔 · 5 档完整数值表");
out.push("");
out.push("配方说明：单种族 ×3 / 复合 = 2 种族 ×2 + ×2；含稀少种族（巨怪/暗影）= 强档；双稀少 = 究极。");
out.push("");
out.push("**升级规则**：同一附魔重附 → Lv +1（消耗等额配方）；换不同附魔 → Lv 重置 1；Lv 5 满级拒绝。");
out.push("");

// 附魔也按花色分组
const enchantsBySuit: Record<Suit, string[]> = { spade: [], diamond: [], heart: [], club: [] };
for (const eid of ENCHANTS) {
  enchantsBySuit[ENCHANT_RECIPES[eid].branch].push(eid);
}
for (const suit of ["spade", "diamond", "heart", "club"] as Suit[]) {
  if (enchantsBySuit[suit].length === 0) continue;
  out.push(`### ${SUIT_LABEL[suit]} 附魔（${enchantsBySuit[suit].length}）`);
  out.push("");
  out.push("| ID | 名称 | 配方 | 类型 | 档位 | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const eid of enchantsBySuit[suit]) {
    const id = eid as keyof typeof ENCHANT_NAMES;
    const recipe = ENCHANT_RECIPES[id];
    const costStr = Object.entries(recipe.cost).map(([r, n]) => `${r}×${n}`).join("+");
    const tierLabel = recipe.doubleRare ? "究极" : recipe.hasRare ? "强档" : "普通";
    const variantLabel = recipe.variant === "specialize" ? "特化" : "互补";
    out.push(`| \`${eid}\` | ${ENCHANT_NAMES[id]} | ${costStr} | ${variantLabel}·${tierLabel} | 参数 | ${jstr(ENCHANT_LEVEL_PARAMS[id][0])} | ${jstr(ENCHANT_LEVEL_PARAMS[id][1])} | ${jstr(ENCHANT_LEVEL_PARAMS[id][2])} | ${jstr(ENCHANT_LEVEL_PARAMS[id][3])} | ${jstr(ENCHANT_LEVEL_PARAMS[id][4])} |`);
  }
  out.push("");
  out.push(`**${SUIT_LABEL[suit]} 各档完整描述**：`);
  out.push("");
  for (const eid of enchantsBySuit[suit]) {
    const id = eid as keyof typeof ENCHANT_NAMES;
    out.push(`- **${ENCHANT_NAMES[id]} \`${eid}\`**`);
    for (let lv = 1; lv <= ENCHANT_MAX_LEVEL; lv++) {
      out.push(`  - Lv${lv}: ${getEnchantDescAt(id, lv)}`);
    }
  }
  out.push("");
}

// ───────── 花色专精 ─────────
out.push("---");
out.push("");
out.push("## 花色专精 · 完整效果");
out.push("");
out.push(`### 亲和度公式
- **装备同色**：每件 +1.3（武器 / 防具都算）
- **特性同色**：每张 +0.8
- **出牌同色**：每张 +0.3（cap 30/色，跨战持久化）
- **大招消耗**：\`player.suitConsumedTotal[suit]\` 跨战持久（每次大招 -8 永久亲和）

**Tier 阈值**：T1 ≥ 5  ·  T2 ≥ 10  ·  T3 ≥ 15
**亲和总封顶**：20/色

### 大招（每场每色限 1 次，消耗 8 持久化亲和）
| 花色 | 大招名 | 效果 |
|---|---|---|
| ♠ | 狂战之击 | 当前目标 50% 真实伤害（无视护甲）|
| ♦ | 影舞步 | 本回合 100% 闪避 + 下次攻击三连击 + 敌人下回合停顿 |
| ♥ | 生命洪流 | HP +50% maxHP + maxHP +3（永久 maxHP 加成）|
| ♣ | 群体禁咒 | 全敌 +沉默 3 回 + 易伤 3 层 3 回 + 中毒 3 层 |

### ♠ 黑桃 · 莽夫流
- **T1**（aff ≥ 5）：攻击 ×1.10；暴击率 5%（受中毒削减 -3%/层 cap -30）
- **T1 Keyword 锐利**：active T1+ 且本攻击花色为 ♠ → 额外 +1 pierce
- **T2**（aff ≥ 10）：pierce += ceil(楼层 / 3)
- **T3**（aff ≥ 15）：可释放大招"狂战之击"

### ♥ 红心 · 生机流
- **T1 生机**（aff ≥ 5 + active）：每回合开始 +2 HP
- **T1 吸血**（aff ≥ 5）：所有攻击吸血 8%
- **T1 Keyword 贪婪**：active T1+ 且 ♥ 攻击 → 额外吸血 +5%
- **T2**（aff ≥ 10）：HP < 25% 攻击 +30%；HP < 50% 受击 ×0.7（伤害 -30%）
- **T3**（aff ≥ 15）：可释放大招"生命洪流"

### ♦ 方块 · 暗影流
- **T1**（aff ≥ 5）：受击反弹 3（攻击者扣 3 HP）；闪避概率 +5%
- **T2**（aff ≥ 10）：pierce += 3（v5 新增：修 ♦ 流被 armor 卡死的问题）
- **T3**（aff ≥ 15）：可释放大招"影舞步"

### ♣ 梅花 · 法术流
- **T1**（aff ≥ 5）：受击 -2
- **T1 Keyword 守序**：active T1+ 且本牌花色为 ♣ → 本回合 +1 临时护盾
- **T2**（aff ≥ 10）：受击再 -3（与 T1 叠加共 -5）
- **T3**（aff ≥ 15）：可释放大招"群体禁咒"
`);

// ───────── 写出 markdown ─────────
writeFileSync("BALANCE_SHEET.md", out.join("\n"));
console.log(`✓ BALANCE_SHEET.md (${out.length} lines)`);

// ───────── CSV 导出（按类别每文件一份，便于 Sheets / Numbers / Excel）─────────
mkdirSync("balance-csv", { recursive: true });

// UTF-8 BOM — 加在 CSV 文件开头让 Excel / Numbers 自动按 UTF-8 解析中文（否则按 GBK 乱码）
const BOM = "﻿";
function writeCsv(path: string, lines: string[]): void {
  writeFileSync(path, BOM + lines.join("\n") + "\n");
}

// 1) attacks.csv / skills.csv / items.csv — 共用列
{
  const cats: Record<string, [string, CardDef][]> = { attack: [], skill: [], item: [] };
  for (const [id, d] of Object.entries(CARD_DB)) {
    if (cats[d.category]) cats[d.category].push([id, d]);
  }
  for (const [cat, rows] of Object.entries(cats)) {
    const fname = `balance-csv/${cat}s.csv`;
    const lines: string[] = [csvRow(["id", "name", "suit", "rarity", "target", "desc"])];
    for (const [id, d] of rows) {
      lines.push(csvRow([
        id, d.name,
        d.attackSuit ?? d.defaultSuit ?? "",
        d.rarity ?? "",
        d.target ?? "",
        d.desc,
      ]));
    }
    writeCsv(fname, lines);
    console.log(`✓ ${fname} (${rows.length} rows)`);
  }
}

// 2) equipment.csv — 装备含 4 stack 各档
{
  const rows: [string, CardDef][] = [];
  for (const [id, d] of Object.entries(CARD_DB)) {
    if (d.category === "equipment") rows.push([id, d]);
  }
  const lines: string[] = [csvRow([
    "id", "name", "slot", "suit", "rarity",
    "baseDmg", "hits", "pierce", "baseReduce",
    "desc",
    "stack1_stat", "stack1_desc",
    "stack2_stat", "stack2_desc",
    "stack3_stat", "stack3_desc",
    "stack4_stat", "stack4_desc",
  ])];
  for (const [id, d] of rows) {
    const eff = d.equipEffects ?? [];
    lines.push(csvRow([
      id, d.name, d.equipKind ?? "", d.equipSuit ?? "", d.rarity ?? "",
      d.baseDmg ?? "", d.hits ?? "", d.pierce ?? "", d.baseReduce ?? "",
      d.desc,
      eff[0]?.stat ?? "", eff[0]?.desc ?? "",
      eff[1]?.stat ?? "", eff[1]?.desc ?? "",
      eff[2]?.stat ?? "", eff[2]?.desc ?? "",
      eff[3]?.stat ?? "", eff[3]?.desc ?? "",
    ]));
  }
  writeCsv("balance-csv/equipment.csv", lines);
  console.log(`✓ balance-csv/equipment.csv (${rows.length} rows)`);
}

// 3) perks.csv — 特性
{
  const rows: [string, CardDef][] = [];
  for (const [id, d] of Object.entries(CARD_DB)) {
    if (d.category === "perk") rows.push([id, d]);
  }
  const lines: string[] = [csvRow(["id", "name", "default_suit", "rarity", "unit_desc", "full_desc"])];
  for (const [id, d] of rows) {
    lines.push(csvRow([
      id, d.name, d.defaultSuit ?? "", d.rarity ?? "",
      d.perkEffect?.unitDesc ?? "",
      d.desc,
    ]));
  }
  writeCsv("balance-csv/perks.csv", lines);
  console.log(`✓ balance-csv/perks.csv (${rows.length} rows)`);
}

// 4) enchants.csv — 13 附魔，每行 1 个，5 档参数 + 描述全部展开为列
{
  const lines: string[] = [csvRow([
    "id", "name", "branch", "kind", "variant", "tier",
    "recipe_cost",
    "lv1_params", "lv1_desc",
    "lv2_params", "lv2_desc",
    "lv3_params", "lv3_desc",
    "lv4_params", "lv4_desc",
    "lv5_params", "lv5_desc",
  ])];
  for (const eid of ENCHANTS) {
    const id = eid as keyof typeof ENCHANT_NAMES;
    const recipe = ENCHANT_RECIPES[id];
    const cost = Object.entries(recipe.cost).map(([r, n]) => `${r}×${n}`).join("+");
    const tierLabel = recipe.doubleRare ? "究极" : recipe.hasRare ? "强档" : "普通";
    const params = ENCHANT_LEVEL_PARAMS[id];
    lines.push(csvRow([
      eid, ENCHANT_NAMES[id], recipe.branch, recipe.kind, recipe.variant, tierLabel,
      cost,
      params[0].join("/"), getEnchantDescAt(id, 1),
      params[1].join("/"), getEnchantDescAt(id, 2),
      params[2].join("/"), getEnchantDescAt(id, 3),
      params[3].join("/"), getEnchantDescAt(id, 4),
      params[4].join("/"), getEnchantDescAt(id, 5),
    ]));
  }
  writeCsv("balance-csv/enchants.csv", lines);
  console.log(`✓ balance-csv/enchants.csv (${ENCHANTS.length} rows)`);
}

// 5) specialty.csv — 4 花色专精 T1/T2/T3 + 大招 + 亲和度公式
{
  const lines: string[] = [csvRow([
    "suit", "tier", "effect_kind", "effect", "param"
  ])];
  // 花色专精详表（按 battle.ts 实装）
  const data: Array<[string, string, string, string, string]> = [
    // 公式行
    ["公式", "—", "装备同色加成", "每件 +1.3", "1.3"],
    ["公式", "—", "特性同色加成", "每张 +0.8", "0.8"],
    ["公式", "—", "出牌同色加成", "每张 +0.3（cap 30）", "0.3"],
    ["公式", "—", "大招亲和消耗", "每次 -8（持久跨战）", "8"],
    ["公式", "—", "T1 阈值", "亲和 ≥ 5", "5"],
    ["公式", "—", "T2 阈值", "亲和 ≥ 10", "10"],
    ["公式", "—", "T3 阈值", "亲和 ≥ 15", "15"],
    ["公式", "—", "亲和封顶", "20 / 色", "20"],
    ["公式", "—", "大招本场限次", "每色 1 次", "1"],
    // ♠
    ["♠ 黑桃", "T1", "攻击倍率", "×1.10", "1.10"],
    ["♠ 黑桃", "T1", "暴击率", "5%（中毒 -3%/层 cap -30%）", "5"],
    ["♠ 黑桃", "T1", "Keyword 锐利", "♠ 攻击 +1 pierce", "1"],
    ["♠ 黑桃", "T2", "破甲加成", "pierce += ceil(楼层/3)", "—"],
    ["♠ 黑桃", "T3 大招", "狂战之击", "当前目标 50% 真实伤害（无视护甲）", "50"],
    // ♦
    ["♦ 方块", "T1", "受击反弹", "3 HP", "3"],
    ["♦ 方块", "T1", "闪避加成", "+5% 闪避", "5"],
    ["♦ 方块", "T2", "破甲加成", "pierce += 3（v5 新增）", "3"],
    ["♦ 方块", "T3 大招", "影舞步", "本回合 100% 闪避 + 三连击 + 敌人停顿", "—"],
    // ♥
    ["♥ 红心", "T1", "吸血", "所有攻击 8% lifesteal", "8"],
    ["♥ 红心", "T1", "生机", "每回合开始 +2 HP", "2"],
    ["♥ 红心", "T1", "Keyword 贪婪", "♥ 攻击额外 +5% 吸血", "5"],
    ["♥ 红心", "T2", "绝境攻击", "HP < 25% 时攻击 +30%", "30"],
    ["♥ 红心", "T2", "绝境减伤", "HP < 50% 时受击 ×0.7", "30"],
    ["♥ 红心", "T3 大招", "生命洪流", "HP +50% maxHP + maxHP +3 永久", "50"],
    // ♣
    ["♣ 梅花", "T1", "受击减伤", "-2", "2"],
    ["♣ 梅花", "T1", "Keyword 守序", "♣ 出牌 +1 临时护盾", "1"],
    ["♣ 梅花", "T2", "受击再减", "-3（共 -5）", "3"],
    ["♣ 梅花", "T3 大招", "群体禁咒", "全敌 沉默 3 回 + 易伤 3 层 3 回 + 中毒 3", "—"],
  ];
  for (const row of data) lines.push(csvRow(row));
  writeCsv("balance-csv/specialty.csv", lines);
  console.log(`✓ balance-csv/specialty.csv (${data.length} rows)`);
}

console.log("\n→ Markdown: BALANCE_SHEET.md");
console.log("→ CSV: balance-csv/*.csv（6 个文件，可分别导 Sheets / Numbers / Excel）");

// ─────────────── 工具 ───────────────
function cleanCell(s: string | undefined): string {
  if (!s) return "—";
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function jstr(arr: readonly number[]): string {
  return `[${arr.join(", ")}]`;
}

// CSV 单元格：RFC 4180 — 含 , " 或 换行 时用双引号包裹，内部 " 转 ""
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}
