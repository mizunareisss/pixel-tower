// 平衡数值导出脚本
// 用法：npx tsx scripts/dump-balance.ts
// 输出：BALANCE_SHEET.md（按花色分类的全卡 + 附魔 5 档 + 花色专精完整表）

import { CARD_DB } from "../src/cards.ts";
import {
  ENCHANT_LEVEL_PARAMS, ENCHANT_NAMES, ENCHANT_RECIPES, ENCHANTS,
  getEnchantDescAt, ENCHANT_MAX_LEVEL,
} from "../src/types.ts";
import type { CardDef, Suit, CardCategory } from "../src/types.ts";
import { writeFileSync } from "fs";

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

// ───────── 写出 ─────────
writeFileSync("BALANCE_SHEET.md", out.join("\n"));
console.log(`✓ BALANCE_SHEET.md (${out.length} lines)`);

// ─────────────── 工具 ───────────────
function cleanCell(s: string | undefined): string {
  if (!s) return "—";
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function jstr(arr: readonly number[]): string {
  return `[${arr.join(", ")}]`;
}
