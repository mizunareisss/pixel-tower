// 楼层地图生成 v1
//
// 每关一张图，玩家从 start 走到 boss。中间层有分支选择。
// 节点类型从权重池随机抽，但保证：
//   - 每层至少 1 个 normal battle（保证战斗节奏）
//   - 第 3/6/9... 关末节点是 BOSS，否则是 ELITE
//   - 节点之间连接保证可达性

import type { FloorMap, FloorTheme, MapNode, MapNodeType } from "./types.ts";
import { buildSingleEncounter } from "./enemies.ts";

let _nodeIdCounter = 0;
function newNodeId(): string { return `n${++_nodeIdCounter}`; }

// ─────────────────────────────────────────────────────────
// 楼层主题
// ─────────────────────────────────────────────────────────

const THEMES: { range: [number, number]; theme: FloorTheme }[] = [
  { range: [1, 2], theme: {
    name: "荒野边缘",
    flavor: "塔影笼罩着第一片荒原，狼嚎在远处此起彼伏。",
    bgClass: "theme-plains",
    accentColor: "#d4a64a",
  }},
  { range: [3, 5], theme: {
    name: "哥布林洞窟",
    flavor: "潮湿的洞穴回响着尖锐的笑声，火光摇曳。",
    bgClass: "theme-cavern",
    accentColor: "#b87fd0",
  }},
  { range: [6, 8], theme: {
    name: "亡灵祭坛",
    flavor: "古老的咒语仍在回响，骨笛吟唱不息。",
    bgClass: "theme-altar",
    accentColor: "#5b9fd8",
  }},
  { range: [9, 99], theme: {
    name: "暗影禁地",
    flavor: "光明拒绝在这里停留，只剩低语。",
    bgClass: "theme-void",
    accentColor: "#ff5e5e",
  }},
];

export function getFloorTheme(floor: number): FloorTheme {
  for (const t of THEMES) {
    if (floor >= t.range[0] && floor <= t.range[1]) return t.theme;
  }
  return THEMES[THEMES.length - 1].theme;
}

// ─────────────────────────────────────────────────────────
// 节点类型权重（按层位置 + 楼层）
// ─────────────────────────────────────────────────────────

interface NodeTypeWeights {
  battle: number;
  elite: number;
  event: number;
  forge: number;
  shop: number;
}

function midLayerWeights(floor: number, layerIdx: number, totalMidLayers: number): NodeTypeWeights {
  // 越靠近末端，elite 越多；事件 / 商人 / 铁匠铺保持稀有
  const lastLayerBoost = layerIdx === totalMidLayers - 1 ? 1.5 : 1;
  // v0.8.2 修复：前两个中间层（layerIdx 0 / 1）禁 elite —— 防止新手玩家
  // 开局没装备没特性时被第一步 elite 当场打死（F1-F3 尤其敏感）
  const firstStepsNoElite = layerIdx <= 1 && floor <= 3;
  // 第 1 关：以战斗为主，几乎无事件
  if (floor === 1) {
    return {
      battle: 80,
      elite:  firstStepsNoElite ? 0 : Math.round(12 * lastLayerBoost),
      event:  4,
      forge:  0,
      shop:   0,
    };
  }
  return {
    battle: 60,
    elite:  firstStepsNoElite ? 0 : Math.round(14 * lastLayerBoost),
    event:  12,
    forge:  floor >= 2 ? 7 : 0,
    shop:   floor >= 2 ? 6 : 0,
  };
}

// 每张图各类型节点的硬上限（防止 5 个中间节点里 3 个是事件这种情况）
function maxCountsForFloor(floor: number): Record<MapNodeType, number> {
  return {
    start:  1,
    boss:   1,
    elite:  floor <= 2 ? 1 : 2,
    event:  floor === 1 ? 1 : 2,
    forge:  1,
    shop:   1,
    battle: 99,  // 兜底类型
  };
}

function pickNodeTypeWithCaps(
  weights: NodeTypeWeights,
  counts: Record<MapNodeType, number>,
  maxCounts: Record<MapNodeType, number>,
  layerEventTaken: boolean,
): MapNodeType {
  // 屏蔽达到上限的类型 + 同层已有事件时禁掉再事件
  const w: NodeTypeWeights = { ...weights };
  if (counts.battle >= maxCounts.battle) w.battle = 0;
  if (counts.elite  >= maxCounts.elite)  w.elite  = 0;
  if (counts.event  >= maxCounts.event || layerEventTaken) w.event = 0;
  if (counts.forge  >= maxCounts.forge)  w.forge  = 0;
  if (counts.shop   >= maxCounts.shop)   w.shop   = 0;
  const total = w.battle + w.elite + w.event + w.forge + w.shop;
  if (total <= 0) return "battle";
  let r = Math.random() * total;
  if ((r -= w.battle) < 0) return "battle";
  if ((r -= w.elite)  < 0) return "elite";
  if ((r -= w.event)  < 0) return "event";
  if ((r -= w.forge)  < 0) return "forge";
  return "shop";
}

// ─────────────────────────────────────────────────────────
// 地图生成
// ─────────────────────────────────────────────────────────

// 楼层结构：1 个 start + N 个中间层 + 1 个末节点（boss / elite）
// 中间层数：基础值 + 随机 ±1 让每张图都不一样
function getMidLayerCount(floor: number): number {
  let base: number;
  if (floor <= 2) base = 2;
  else if (floor <= 5) base = 3;
  else if (floor <= 8) base = 4;
  else base = 5;
  // ±1 随机变化（保证至少 2 中间层）
  const variance = Math.floor(Math.random() * 3) - 1;  // -1 / 0 / +1
  return Math.max(2, base + variance);
}

// 每层节点数：start/last = 1；中间层 1-3 随机加权（权重偏向 2-3，偶尔 1 制造瓶颈）
function getLayerSize(layer: number, totalLayers: number): number {
  if (layer === 0) return 1;
  if (layer === totalLayers - 1) return 1;
  // 权重：1 节点 15% / 2 节点 50% / 3 节点 35%
  const r = Math.random();
  if (r < 0.15) return 1;
  if (r < 0.65) return 2;
  return 3;
}

export function generateFloorMap(floor: number): FloorMap {
  const theme = getFloorTheme(floor);
  const midLayers = getMidLayerCount(floor);
  const totalLayers = midLayers + 2;  // start + mid + last
  // F6 起每关末节点都是 Boss（之前每 3 关一个 boss，节奏太散）
  // F1-5 关末仍是精英（热身期）
  const isBossFloor = floor >= 6;

  // 1. 创建所有节点
  const nodes: MapNode[] = [];
  const layerNodes: MapNode[][] = [];

  // 节点类型计数 + 上限
  const counts: Record<MapNodeType, number> = { start: 0, battle: 0, elite: 0, boss: 0, event: 0, forge: 0, shop: 0 };
  const maxCounts = maxCountsForFloor(floor);

  for (let layer = 0; layer < totalLayers; layer++) {
    const size = getLayerSize(layer, totalLayers);
    const layerArr: MapNode[] = [];
    let layerEventTaken = false;  // 同层最多 1 个事件
    for (let col = 0; col < size; col++) {
      let type: MapNodeType;
      if (layer === 0) type = "start";
      else if (layer === totalLayers - 1) type = isBossFloor ? "boss" : "elite";
      else {
        type = pickNodeTypeWithCaps(
          midLayerWeights(floor, layer - 1, midLayers),
          counts,
          maxCounts,
          layerEventTaken,
        );
      }
      counts[type]++;
      if (type === "event") layerEventTaken = true;

      const node: MapNode = {
        id: newNodeId(),
        type,
        layer,
        col,
        next: [],
        x: 0,
        y: 0,
        completed: false,
      };
      // 预 roll payload
      preRollPayload(node, floor);
      layerArr.push(node);
      nodes.push(node);
    }
    layerNodes.push(layerArr);
  }

  // 1.5. 保证每关至少有 1 个铁匠铺（floor >= 2）
  // 之前 forge 权重 7 → 经常一整关都不出，玩家 build 节奏被打乱
  // 改为：若本次生成完后 counts.forge === 0，挑一个 battle 节点改成 forge
  if (floor >= 2 && counts.forge === 0) {
    // 候选：所有中间层的 battle 节点（不动 start / boss / elite）
    const battleCands: MapNode[] = [];
    for (let layer = 1; layer < totalLayers - 1; layer++) {
      for (const n of layerNodes[layer]) {
        if (n.type === "battle") battleCands.push(n);
      }
    }
    if (battleCands.length > 0) {
      const pick = battleCands[Math.floor(Math.random() * battleCands.length)];
      pick.type = "forge";
      counts.battle = Math.max(0, counts.battle - 1);
      counts.forge++;
      // 清掉旧的 battle payload（preRollPayload 不会冲突，因为 forge 不需要 payload）
      pick.enemies = undefined;
      pick.eventId = undefined;
    }
  }

  // 2. 计算坐标（normalized 0-1）
  for (let layer = 0; layer < totalLayers; layer++) {
    const layerArr = layerNodes[layer];
    const yPct = layer / Math.max(1, totalLayers - 1);
    // y 从 1（底部 start）到 0（顶部 boss）
    const y = 1 - yPct;
    for (let col = 0; col < layerArr.length; col++) {
      const xPct = layerArr.length === 1
        ? 0.5
        : 0.20 + (col / (layerArr.length - 1)) * 0.60;  // 0.20-0.80 范围内分布
      layerArr[col].x = xPct;
      layerArr[col].y = y;
    }
  }

  // 3. 连边：每个节点连接到下一层 1-2 个节点
  for (let layer = 0; layer < totalLayers - 1; layer++) {
    const cur = layerNodes[layer];
    const nxt = layerNodes[layer + 1];

    // 简单策略：每个 cur 节点至少连 1 个最近的 nxt 节点
    // + 保证每个 nxt 节点至少有 1 个 incoming 边
    const nxtIncoming = new Map<string, number>();
    for (const n of nxt) nxtIncoming.set(n.id, 0);

    for (const c of cur) {
      // 找最近的 nxt 节点（按 col 距离）
      const sorted = [...nxt].sort((a, b) => Math.abs(a.col - c.col) - Math.abs(b.col - c.col));
      const primary = sorted[0];
      c.next.push(primary.id);
      nxtIncoming.set(primary.id, (nxtIncoming.get(primary.id) ?? 0) + 1);
      // 50% 概率再连第二近的（如果有）
      if (sorted.length > 1 && Math.random() < 0.5) {
        const secondary = sorted[1];
        if (!c.next.includes(secondary.id)) {
          c.next.push(secondary.id);
          nxtIncoming.set(secondary.id, (nxtIncoming.get(secondary.id) ?? 0) + 1);
        }
      }
    }

    // 确保每个 nxt 至少有 1 个 incoming
    for (const n of nxt) {
      if ((nxtIncoming.get(n.id) ?? 0) === 0) {
        // 找最近的 cur 节点连过来
        const closest = [...cur].sort((a, b) => Math.abs(a.col - n.col) - Math.abs(b.col - n.col))[0];
        closest.next.push(n.id);
      }
    }
  }

  return {
    floor,
    theme,
    nodes,
    startNodeId: layerNodes[0][0].id,
    bossNodeId: layerNodes[totalLayers - 1][0].id,
    currentNodeId: layerNodes[0][0].id,
  };
}

// ─────────────────────────────────────────────────────────
// 节点 payload 预生成
// ─────────────────────────────────────────────────────────

// 节点 payload：按节点类型预生成对应战斗 / 事件
// 修复：旧版用 makeEnemyGroupsForFloor 的 groups[2] 当 elite 战斗，但 F6+ 楼层 groups[2] 已经是 boss 了，
// 导致 elite 节点也刷出 boss。改用 buildSingleEncounter(floor, tier) 严格按节点类型取敌人。
function preRollPayload(node: MapNode, floor: number): void {
  if (node.type === "boss") {
    node.enemies = buildSingleEncounter(floor, "boss");
  } else if (node.type === "elite") {
    node.enemies = buildSingleEncounter(floor, "elite");
  } else if (node.type === "battle") {
    node.enemies = buildSingleEncounter(floor, "normal");
  } else if (node.type === "event") {
    // 事件 id：复用 rollFloorEvent 的池（强制触发）
    node.eventId = rollEventForNode();
  }
  // forge / shop 不需要预 roll
}

// 事件节点：从 5 个事件里均匀挑 1 个
function rollEventForNode(): string {
  const ids = ["merchant", "gambler", "shrine", "wizard", "chest"];
  return ids[Math.floor(Math.random() * ids.length)];
}

// ─────────────────────────────────────────────────────────
// 地图查询 / 状态
// ─────────────────────────────────────────────────────────

export function getReachableNodes(map: FloorMap): MapNode[] {
  const cur = map.nodes.find(n => n.id === map.currentNodeId);
  if (!cur) return [];
  return cur.next.map(id => map.nodes.find(n => n.id === id)!).filter(Boolean);
}

export function getNode(map: FloorMap, id: string): MapNode | undefined {
  return map.nodes.find(n => n.id === id);
}

// 节点类型显示元数据
export const NODE_TYPE_META: Record<MapNodeType, { icon: string; label: string; color: string }> = {
  start:  { icon: "🚩", label: "起点",     color: "#888" },
  battle: { icon: "⚔",  label: "普通战",   color: "#e63329" },
  elite:  { icon: "✦",  label: "精英战",   color: "#ff8c28" },
  boss:   { icon: "👑", label: "BOSS",     color: "#ffd460" },
  event:  { icon: "🎲", label: "随机事件", color: "#9b59b6" },
  forge:  { icon: "⚒",  label: "铁匠铺",   color: "#f5c518" },
  shop:   { icon: "🛒", label: "商店",     color: "#4db84d" },
};

