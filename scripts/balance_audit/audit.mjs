#!/usr/bin/env node
// ─── Balance Audit Pipeline ────────────────────────────────────────
// 用法：
//   node scripts/balance_audit/audit.mjs              → 4 流派 × 100 runs 矩阵
//   node scripts/balance_audit/audit.mjs --runs=500   → 跑更深
//   node scripts/balance_audit/audit.mjs --out=balance-audit/report.md
//
// 输出：build × floor 胜率热图 + 离群点 + 流派对比
// ─────────────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// ── 解析 CLI ──
const args = process.argv.slice(2);
let runs = 100;
let maxFloor = 12;
let outPath = null;
for (const a of args) {
  if (a.startsWith("--runs=")) runs = parseInt(a.split("=")[1]);
  else if (a.startsWith("--maxFloor=")) maxFloor = parseInt(a.split("=")[1]);
  else if (a.startsWith("--out=")) outPath = a.split("=")[1];
}

// ── 跑 1 流派 ──
function runSuite(lockSuit, runs, maxFloor) {
  const env = { ...process.env, SIM_LOCK_SUIT: lockSuit };
  const cmd = `npx tsx scripts/balance_audit/simulator.ts --runs=${runs} --maxFloor=${maxFloor} --out=/tmp/sim_${lockSuit}.json`;
  console.error(`▶ Running ${lockSuit} × ${runs}...`);
  const t0 = Date.now();
  execSync(cmd, { cwd: ROOT, env, stdio: ["ignore", "ignore", "inherit"] });
  const dt = Date.now() - t0;
  console.error(`  ${lockSuit}: ${(dt/1000).toFixed(1)}s`);
  // 读 json — simulator 输出的是 RunResult[]
  const arr = JSON.parse(execSync(`cat /tmp/sim_${lockSuit}.json`).toString());
  return { results: arr };
}

// ── 主流程 ──
const suits = ["spade", "diamond", "heart", "club"];
const suitNames = { spade: "♠ 黑桃 (莽夫)", diamond: "♦ 方块 (暗影)", heart: "♥ 红心 (生机)", club: "♣ 梅花 (法术)" };

console.error(`Balance Audit — ${runs} runs/suit × 4 suits = ${runs * 4} total games\n`);
const tStart = Date.now();
const data = {};
for (const s of suits) data[s] = runSuite(s, runs, maxFloor);
const totalSec = (Date.now() - tStart) / 1000;
console.error(`\nTotal: ${totalSec.toFixed(1)}s\n`);

// ── 生成 heatmap + 报告 ──
function pct(n, total) { return total ? (n / total * 100).toFixed(1) + "%" : "0%"; }
function avg(arr) { return arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(2) : "—"; }
function medianOf(arr) { if (!arr.length) return "—"; const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:((s[m-1]+s[m])/2).toFixed(1); }
function p25(arr) { if (!arr.length) return "—"; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length*0.25)]; }
function p75(arr) { if (!arr.length) return "—"; const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length*0.75)]; }

const lines = [];
lines.push("# Balance Audit Report — v0.8.1");
lines.push(`生成于 ${new Date().toISOString()}`);
lines.push(`样本：${runs} 局/流派 × 4 流派 = ${runs * 4} 总局数`);
lines.push(`总耗时：${totalSec.toFixed(1)}s`);
lines.push("");

// ── 1. 总览表 ──
lines.push("## 1. 总览：流派 × 通关情况");
lines.push("");
lines.push("| 流派 | 平均最高关 | 中位 | P25 | P75 | F1 死亡率 | F6+ 到达率 | F12 通关率 |");
lines.push("|---|---|---|---|---|---|---|---|");

for (const s of suits) {
  const d = data[s];
  const reached = d.results.map(r => r.reachedFloor);
  const f1Dead = d.results.filter(r => r.reachedFloor === 1 && r.cause === "hp_zero").length;
  const f6Plus = d.results.filter(r => r.reachedFloor >= 6).length;
  const f12Win = d.results.filter(r => r.cause === "max_floor_reached" && r.reachedFloor >= 12).length;
  lines.push(`| ${suitNames[s]} | **${avg(reached)}** | ${medianOf(reached)} | ${p25(reached)} | ${p75(reached)} | ${pct(f1Dead, runs)} | ${pct(f6Plus, runs)} | ${pct(f12Win, runs)} |`);
}
lines.push("");

// ── 2. 死亡关数分布（heatmap）──
lines.push("## 2. 死亡关数分布（heatmap）");
lines.push("");
lines.push("行 = 流派, 列 = 死亡时所在关。每格 = 该流派该关死亡的局数 / 总局数。");
lines.push("");
const cols = Array.from({length: maxFloor + 1}, (_, i) => i + 1);
let hdr = "| 流派 |";
for (const f of cols) hdr += ` F${f} |`;
hdr += " 通关 |";
lines.push(hdr);
let sep = "|---|";
for (const f of cols) sep += "---|";
sep += "---|";
lines.push(sep);

for (const s of suits) {
  const dist = new Array(maxFloor + 1).fill(0);
  let won = 0;
  for (const r of data[s].results) {
    if (r.cause === "max_floor_reached" && r.reachedFloor >= maxFloor) won++;
    else dist[r.reachedFloor] = (dist[r.reachedFloor] ?? 0) + 1;
  }
  let row = `| ${suitNames[s]} |`;
  for (const f of cols) {
    const v = dist[f] ?? 0;
    const p = v / runs;
    let marker = "·";
    if (p > 0.30) marker = "███";
    else if (p > 0.15) marker = "██";
    else if (p > 0.05) marker = "█";
    else if (p > 0) marker = "▌";
    row += ` ${v ? `${v} ${marker}` : "·"} |`;
  }
  row += ` ${won ? `**${won} 🏆**` : "·"} |`;
  lines.push(row);
}
lines.push("");

// ── 3. 异常诊断 ──
lines.push("## 3. 异常诊断（每流派）");
lines.push("");
for (const s of suits) {
  const errs = data[s].results.flatMap(r => r.errors ?? []);
  const counts = {};
  for (const e of errs) {
    const key = e.replace(/run \d+/, "run X").replace(/F\d+/, "F<n>");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) { lines.push(`- ${suitNames[s]}：无异常 ✓`); continue; }
  lines.push(`- ${suitNames[s]}：`);
  for (const [k, c] of sorted.slice(0, 5)) lines.push(`  - ${c}× \`${k}\``);
}
lines.push("");

// ── 4. 关键 build 统计 ──
lines.push("## 4. 关键武器 / 防具 / 附魔 / 特性 触达率");
lines.push("");
for (const s of suits) {
  lines.push(`### ${suitNames[s]}`);
  const d = data[s];
  // 武器持有
  const weaponCounts = {};
  for (const r of d.results) for (const w of (r.weapons ?? [])) weaponCounts[w] = (weaponCounts[w] ?? 0) + 1;
  // 附魔
  const encCounts = {};
  for (const r of d.results) if (r.enchant) encCounts[r.enchant] = (encCounts[r.enchant] ?? 0) + 1;
  // 大招触发
  const ultCount = d.results.reduce((a, r) => a + Object.values(r.ultsReleased ?? {}).reduce((x, y) => x + y, 0), 0);
  const shopBuys = d.results.reduce((a, r) => a + (r.shopPurchases ?? 0), 0);
  const forgeApplied = d.results.reduce((a, r) => a + (r.forgeApplied ?? 0), 0);
  lines.push(`  - 大招触发: ${ultCount} 次（${(ultCount/runs).toFixed(2)} 次/局）`);
  lines.push(`  - 商店购买: ${shopBuys} 次`);
  lines.push(`  - 铁匠铺成功: ${forgeApplied} 次`);
  const topEnc = Object.entries(encCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  lines.push(`  - 最常附魔: ${topEnc.map(([k, v]) => `${k}×${v}`).join(", ") || "无"}`);
}
lines.push("");

// ── 5. 趋势对比 ──
lines.push("## 5. 离群点 / 失衡迹象");
lines.push("");
const avgs = suits.map(s => ({ s, v: data[s].results.reduce((a, r) => a + r.reachedFloor, 0) / runs }));
avgs.sort((a, b) => b.v - a.v);
const max = avgs[0], min = avgs[avgs.length - 1];
const gap = max.v - min.v;
lines.push(`- **流派强度差距**: 最强 ${suitNames[max.s]} 平均 F${max.v.toFixed(2)} vs 最弱 ${suitNames[min.s]} 平均 F${min.v.toFixed(2)} (差 ${gap.toFixed(2)} 关)`);
if (gap > 2) lines.push(`  - ⚠️ 差距 > 2 关，**流派严重失衡**`);
else if (gap > 1) lines.push(`  - ⚠️ 差距 > 1 关，需要进一步审视`);
else lines.push(`  - ✓ 差距 < 1 关，平衡尚可`);
lines.push("");

const f12wins = suits.map(s => ({ s, c: data[s].results.filter(r => r.cause === "max_floor_reached" && r.reachedFloor >= 12).length }));
const totalWins = f12wins.reduce((a, b) => a + b.c, 0);
lines.push(`- **F12 通关总次数**: ${totalWins} / ${runs * 4} (${pct(totalWins, runs * 4)})`);
if (totalWins === 0) lines.push(`  - ⚠️ 0 通关 — 当前 AI 策略下游戏没有 finite 通关率`);
else if (totalWins < runs * 4 * 0.05) lines.push(`  - ⚠️ 通关率 < 5%，可能 boss 数值过高 或 AI 策略不够强`);

const totalUlt = suits.reduce((a, s) => a + data[s].results.reduce((x, r) => x + Object.values(r.ultsReleased ?? {}).reduce((y, z) => y + z, 0), 0), 0);
const ultPerGame = totalUlt / (runs * 4);
lines.push(`- **大招总触发频次**: ${totalUlt} 次（平均 ${ultPerGame.toFixed(2)} 次/局）`);
if (ultPerGame < 0.2) lines.push(`  - ⚠️ 大招触发率极低 — 流派 T3 条件可能太严`);

lines.push("");
lines.push("## 6. 原始数据");
lines.push("");
lines.push("详细 JSON 数据已写入 `/tmp/sim_<suit>.json`，可用 `jq` 进一步查询。");

// ── 输出 ──
const report = lines.join("\n");
console.log(report);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);
  console.error(`\n✓ Report written to ${outPath}`);
}
