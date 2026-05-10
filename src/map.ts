// 楼层地图生成 v1
//
// 每关一张图，玩家从 start 走到 boss。中间层有分支选择。
// 节点类型从权重池随机抽，但保证：
//   - 每层至少 1 个 normal battle（保证战斗节奏）
//   - 第 3/6/9... 关末节点是 BOSS，否则是 ELITE
//   - 节点之间连接保证可达性

import type { FloorMap, FloorTheme, MapNode, MapNodeType } from "./types.ts";
import { makeEnemyGroupsForFloor } from "./enemies.ts";

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
  // 越靠近末端，elite 越多；商人/铁匠铺保持稀有
  const lastLayerBoost = layerIdx === totalMidLayers - 1 ? 1.5 : 1;
  return {
    battle: 50,
    elite:  Math.round(15 * lastLayerBoost),
    event:  20,
    forge:  floor >= 2 ? 8 : 0,    // 第 1 关无铁匠铺
    shop:   floor >= 2 ? 7 : 0,
  };
}

function pickNodeType(weights: NodeTypeWeights): MapNodeType {
  const total = weights.battle + weights.elite + weights.event + weights.forge + weights.shop;
  let r = Math.random() * total;
  if ((r -= weights.battle) < 0) return "battle";
  if ((r -= weights.elite) < 0)  return "elite";
  if ((r -= weights.event) < 0)  return "event";
  if ((r -= weights.forge) < 0)  return "forge";
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
  const isBossFloor = floor % 3 === 0;

  // 1. 创建所有节点
  const nodes: MapNode[] = [];
  const layerNodes: MapNode[][] = [];

  for (let layer = 0; layer < totalLayers; layer++) {
    const size = getLayerSize(layer, totalLayers);
    const layerArr: MapNode[] = [];
    for (let col = 0; col < size; col++) {
      let type: MapNodeType;
      if (layer === 0) type = "start";
      else if (layer === totalLayers - 1) type = isBossFloor ? "boss" : "elite";
      else type = pickNodeType(midLayerWeights(floor, layer - 1, midLayers));

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

// makeEnemyGroupsForFloor 生成的是 3 战的 groups。我们这里只需要单战。
// 简单做法：调用一次取第一组 / 第二组 / 第三组（非 boss/elite 取 normal pool）。
// 优雅做法：让 enemies.ts 提供 buildSingleEncounter(floor, type)。这里先用 hack。
function preRollPayload(node: MapNode, floor: number): void {
  if (node.type === "battle" || node.type === "elite" || node.type === "boss") {
    // 借用现有 makeEnemyGroupsForFloor，按 type 选 group
    // group[0]/[1] = normal; group[2] = elite/boss
    const groups = makeEnemyGroupsForFloor(floor);
    if (node.type === "boss" || node.type === "elite") {
      node.enemies = groups[2];
    } else {
      // 普通战：随机取 group 0 或 1
      node.enemies = groups[Math.floor(Math.random() * 2)];
    }
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
  shop:   { icon: "💎", label: "商店",     color: "#4db84d" },
};

