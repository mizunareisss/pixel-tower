// 调试控制台浮窗
//
// 设计：
//   - 不入侵主 UI：自挂在 document.body，独立 z-index 层
//   - 玩家按 ` 键或点右上角 🐞 chip 开关
//   - 两个 tab：
//       1) State —— 实时 JSON dump（玩家摘要 + 完整状态），一键复制
//       2) Cheats —— 加牌 / 加特性 / 加装备 / HP / 碎片 / 专精 / 附魔 / 状态 / 敌人操作
//   - 所有 cheat 调用完后调 requestRender()，主 UI 自动跟着刷新
//
// 用法（main.ts）：
//   import { mountDebugConsole } from "./debugConsole.ts";
//   mountDebugConsole(() => state, () => render());

import type { GameState, Suit, EnchantId, EnemyRace } from "./types.ts";
import { ENCHANTS, ENCHANT_NAMES, SUIT_SYMBOLS, RACE_NAMES } from "./types.ts";
import { CARD_DB } from "./cards.ts";
import {
  cheatAddCardToHand,
  cheatAddCardToDeck,
  cheatAddCardToDiscard,
  cheatAddPerk,
  cheatAddEquipment,
  cheatSetHp,
  cheatSetMaxHp,
  cheatHealFull,
  cheatAddFragments,
  cheatAddSuitPlayed,
  cheatAddSuitConsumed,
  cheatResetSuitCounters,
  cheatSetEnchant,
  cheatAddPlayerStatus,
  cheatRemovePlayerStatus,
  cheatClearAllPlayerStatuses,
  cheatAddEnemyStatus,
  cheatKillEnemy,
  cheatHurtEnemy,
  cheatSetEnemyHp,
  cheatDrawN,
  cheatDiscardAllHand,
  cheatClearZone,
  dumpStateJson,
  dumpPlayerSummary,
  listAllCardIds,
  listAllPerkIds,
} from "./cheats.ts";

const SUITS: Suit[] = ["spade", "diamond", "heart", "club"];
const RACES: EnemyRace[] = ["beast", "humanoid", "undead", "giant", "dark"];
const COMMON_STATUSES = [
  "poison", "bleed", "weak", "vulnerable", "burn",
  "block", "shield_block", "fullplate_shield", "evasive",
  "sharpened", "battle_cry", "frenzy", "shadow_double",
  "counter_stance", "guaranteed_dodge", "dodge_full_round",
  "frozen", "fear", "silence", "stun",
];

type Tab = "state" | "cheats";

interface ConsoleHandle {
  toggle: () => void;
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  refresh: () => void;
}

let _handle: ConsoleHandle | null = null;

export function mountDebugConsole(
  getState: () => GameState,
  requestRender: () => void,
): ConsoleHandle {
  if (_handle) return _handle;

  // ─── 顶层容器 ───────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "dbg-console-root";
  root.className = "dbg-hidden";

  // 触发器（右上角小图标）
  const toggleBtn = document.createElement("button");
  toggleBtn.id = "dbg-toggle-btn";
  toggleBtn.title = "调试控制台 (` 键开关)";
  toggleBtn.textContent = "🐞";
  toggleBtn.onclick = () => handle.toggle();
  document.body.appendChild(toggleBtn);

  // 面板
  const panel = document.createElement("div");
  panel.className = "dbg-panel";
  root.appendChild(panel);
  document.body.appendChild(root);

  // 头部（拖拽手柄）
  const header = document.createElement("div");
  header.className = "dbg-header";
  header.innerHTML = `
    <span class="dbg-title">🐞 调试控制台</span>
    <span class="dbg-spacer"></span>
    <button class="dbg-btn dbg-tab-btn" data-tab="state">State</button>
    <button class="dbg-btn dbg-tab-btn" data-tab="cheats">Cheats</button>
    <button class="dbg-btn dbg-close-btn" title="关闭">✕</button>
  `;
  panel.appendChild(header);
  makeDraggable(panel, header);

  // 内容容器
  const body = document.createElement("div");
  body.className = "dbg-body";
  panel.appendChild(body);

  // 两个 tab 的 DOM
  const stateView = buildStateView(getState);
  const cheatsView = buildCheatsView(getState, () => {
    requestRender();
    handle.refresh();
  });
  body.appendChild(stateView.el);
  body.appendChild(cheatsView.el);

  // tab 切换
  let currentTab: Tab = "state";
  const setTab = (t: Tab) => {
    currentTab = t;
    stateView.el.style.display = t === "state" ? "" : "none";
    cheatsView.el.style.display = t === "cheats" ? "" : "none";
    header.querySelectorAll(".dbg-tab-btn").forEach((b) => {
      b.classList.toggle("dbg-tab-active", (b as HTMLElement).dataset.tab === t);
    });
    if (t === "state") stateView.refresh();
  };
  header.querySelectorAll<HTMLButtonElement>(".dbg-tab-btn").forEach((b) => {
    b.onclick = () => setTab((b.dataset.tab as Tab) ?? "state");
  });
  header.querySelector<HTMLButtonElement>(".dbg-close-btn")!.onclick = () => handle.hide();

  setTab("state");

  // 句柄
  const handle: ConsoleHandle = {
    toggle: () => {
      if (root.classList.contains("dbg-hidden")) handle.show();
      else handle.hide();
    },
    show: () => {
      root.classList.remove("dbg-hidden");
      toggleBtn.classList.add("dbg-active");
      handle.refresh();
    },
    hide: () => {
      root.classList.add("dbg-hidden");
      toggleBtn.classList.remove("dbg-active");
    },
    isVisible: () => !root.classList.contains("dbg-hidden"),
    refresh: () => {
      if (currentTab === "state") stateView.refresh();
      cheatsView.refresh();
    },
  };
  _handle = handle;

  // 全局热键 `（backtick）
  window.addEventListener("keydown", (e) => {
    // 在输入框内时不触发
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT")) return;
    if (e.key === "`") {
      e.preventDefault();
      handle.toggle();
    }
  });

  // 暴露到 window 方便从 DevTools 调用
  (window as any).__dbg__ = {
    state: () => getState(),
    show: () => handle.show(),
    hide: () => handle.hide(),
    refresh: () => handle.refresh(),
  };

  return handle;
}

/** 主 UI 每次 render 后调用，让控制台跟着刷 */
export function notifyDebugConsoleRender(): void {
  _handle?.refresh();
}

// ─────────────────────────────────────────────────────────────
// State view（实时数据 dump）
// ─────────────────────────────────────────────────────────────

function buildStateView(getState: () => GameState): {
  el: HTMLElement;
  refresh: () => void;
} {
  const el = document.createElement("div");
  el.className = "dbg-tab-state";
  el.innerHTML = `
    <div class="dbg-row">
      <button class="dbg-btn dbg-mode-btn dbg-mode-active" data-mode="summary">玩家摘要</button>
      <button class="dbg-btn dbg-mode-btn" data-mode="full">完整 State</button>
      <button class="dbg-btn dbg-mode-btn" data-mode="log">战斗日志</button>
      <span class="dbg-spacer"></span>
      <button class="dbg-btn dbg-copy-btn">📋 复制</button>
      <label class="dbg-tinybox"><input type="checkbox" class="dbg-auto-check" checked> 自动刷新</label>
    </div>
    <textarea class="dbg-dump" readonly spellcheck="false"></textarea>
  `;
  const ta = el.querySelector<HTMLTextAreaElement>(".dbg-dump")!;
  const copyBtn = el.querySelector<HTMLButtonElement>(".dbg-copy-btn")!;
  const autoCheck = el.querySelector<HTMLInputElement>(".dbg-auto-check")!;
  let mode: "summary" | "full" | "log" = "summary";

  const refresh = () => {
    if (!autoCheck.checked) return;
    const state = getState();
    if (mode === "summary") ta.value = dumpPlayerSummary(state);
    else if (mode === "full") ta.value = dumpStateJson(state);
    else ta.value = state.log.map((e) => `[${e.kind}] ${e.msg}`).join("\n");
  };

  el.querySelectorAll<HTMLButtonElement>(".dbg-mode-btn").forEach((b) => {
    b.onclick = () => {
      mode = (b.dataset.mode as typeof mode) ?? "summary";
      el.querySelectorAll(".dbg-mode-btn").forEach((x) => x.classList.remove("dbg-mode-active"));
      b.classList.add("dbg-mode-active");
      refresh();
    };
  });

  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
      copyBtn.textContent = "✓ 已复制";
      setTimeout(() => (copyBtn.textContent = "📋 复制"), 1200);
    } catch {
      ta.select();
      copyBtn.textContent = "选中了，⌘C";
      setTimeout(() => (copyBtn.textContent = "📋 复制"), 1500);
    }
  };

  return { el, refresh };
}

// ─────────────────────────────────────────────────────────────
// Cheats view
// ─────────────────────────────────────────────────────────────

function buildCheatsView(
  getState: () => GameState,
  onChange: () => void,
): { el: HTMLElement; refresh: () => void } {
  const el = document.createElement("div");
  el.className = "dbg-tab-cheats";
  el.style.display = "none";

  // 缓存元数据
  const allCards = listAllCardIds().sort((a, b) =>
    a.category.localeCompare(b.category) || a.id.localeCompare(b.id),
  );
  const allPerks = listAllPerkIds().sort((a, b) => a.id.localeCompare(b.id));
  const equipCards = allCards.filter((c) => c.category === "equipment");

  el.innerHTML = `
    <div class="dbg-section">
      <div class="dbg-section-title">📥 加牌（到手牌 / 牌库 / 弃牌堆）</div>
      <div class="dbg-row">
        <input class="dbg-card-search" placeholder="搜索：defId / 名称 / 类别" list="dbg-card-list" />
        <datalist id="dbg-card-list"></datalist>
        <select class="dbg-card-suit">
          <option value="">默认</option>
          <option value="spade">♠</option>
          <option value="diamond">♦</option>
          <option value="heart">♥</option>
          <option value="club">♣</option>
        </select>
        <button class="dbg-btn" data-act="add-hand">→ 手牌</button>
        <button class="dbg-btn" data-act="add-deck">→ 牌库</button>
        <button class="dbg-btn" data-act="add-discard">→ 弃牌</button>
      </div>
      <div class="dbg-hint">支持 defId / 中文名。例：sk_drain_strike、汲血斩、it_heal、p_vampire</div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">🛡️ 装备 / 特性</div>
      <div class="dbg-row">
        <select class="dbg-equip-pick"><option value="">— 选装备 —</option></select>
        <button class="dbg-btn" data-act="add-equip">+ 装备</button>
      </div>
      <div class="dbg-row">
        <select class="dbg-perk-pick"><option value="">— 选特性 —</option></select>
        <button class="dbg-btn" data-act="add-perk">+ 特性</button>
      </div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">❤️ HP</div>
      <div class="dbg-row">
        <span class="dbg-mini-label">当前 HP</span>
        <input type="number" class="dbg-hp-input" style="width:64px" />
        <button class="dbg-btn" data-act="set-hp">设</button>
        <span class="dbg-mini-label">最大 HP</span>
        <input type="number" class="dbg-mhp-input" style="width:64px" />
        <button class="dbg-btn" data-act="set-mhp">设</button>
        <button class="dbg-btn" data-act="heal-full">回满</button>
      </div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">💎 灵魂碎片</div>
      <div class="dbg-row dbg-frag-row"></div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">♠♦♥♣ 专精（亲和度）</div>
      <div class="dbg-row dbg-suit-row"></div>
      <div class="dbg-row">
        <button class="dbg-btn" data-act="reset-suit">重置全部专精计数</button>
        <span class="dbg-hint">说明：直接改 suitPlayedTotal（玩过的同色攻击牌总数）。cap 由战斗代码控制。</span>
      </div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">✨ 附魔</div>
      <div class="dbg-row">
        <select class="dbg-enchant-pick">
          <option value="">— 无 —</option>
        </select>
        <span class="dbg-mini-label">Lv</span>
        <input type="number" class="dbg-enchant-lv" value="1" min="1" max="5" style="width:48px" />
        <button class="dbg-btn" data-act="set-enchant">应用</button>
      </div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">🌀 状态效果（玩家）</div>
      <div class="dbg-row">
        <input class="dbg-status-id" placeholder="status id（如 poison）" list="dbg-status-list" style="width:160px" />
        <datalist id="dbg-status-list"></datalist>
        <span class="dbg-mini-label">x</span>
        <input type="number" class="dbg-status-stacks" value="1" style="width:48px" />
        <span class="dbg-mini-label">dur</span>
        <input type="number" class="dbg-status-dur" value="-1" style="width:48px" title="-1 = 永久 / 自衰减" />
        <button class="dbg-btn" data-act="add-status">+ 添加</button>
        <button class="dbg-btn" data-act="rm-status">− 移除</button>
        <button class="dbg-btn" data-act="clear-status">清空全部</button>
      </div>
    </div>

    <div class="dbg-section dbg-enemy-section">
      <div class="dbg-section-title">👹 敌人（需在战斗中）</div>
      <div class="dbg-enemy-list">（不在战斗中）</div>
    </div>

    <div class="dbg-section">
      <div class="dbg-section-title">🃏 抽牌 / 弃牌堆</div>
      <div class="dbg-row">
        <span class="dbg-mini-label">抽 N 张</span>
        <input type="number" class="dbg-draw-n" value="1" style="width:48px" />
        <button class="dbg-btn" data-act="draw-n">抽</button>
        <button class="dbg-btn" data-act="discard-hand">弃光手牌</button>
        <button class="dbg-btn" data-act="clear-hand">清空 hand</button>
        <button class="dbg-btn" data-act="clear-deck">清空 deck</button>
        <button class="dbg-btn" data-act="clear-discard">清空 discard</button>
      </div>
    </div>
  `;

  // datalist 填充：cards（hand-able）
  const cardList = el.querySelector("#dbg-card-list") as HTMLDataListElement;
  for (const c of allCards) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.label = `${c.name}（${c.category}/${c.rarity}）`;
    cardList.appendChild(opt);
  }

  // 装备 / 特性 select 填充
  const equipPick = el.querySelector(".dbg-equip-pick") as HTMLSelectElement;
  for (const c of equipCards) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name}（${c.rarity}）`;
    equipPick.appendChild(opt);
  }
  const perkPick = el.querySelector(".dbg-perk-pick") as HTMLSelectElement;
  for (const c of allPerks) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    perkPick.appendChild(opt);
  }

  // 附魔 select 填充
  const enchantPick = el.querySelector(".dbg-enchant-pick") as HTMLSelectElement;
  for (const e of ENCHANTS) {
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = ENCHANT_NAMES[e];
    enchantPick.appendChild(opt);
  }

  // status datalist
  const statusList = el.querySelector("#dbg-status-list") as HTMLDataListElement;
  for (const s of COMMON_STATUSES) {
    const opt = document.createElement("option");
    opt.value = s;
    statusList.appendChild(opt);
  }

  // 碎片 row（5 个种族）
  const fragRow = el.querySelector(".dbg-frag-row")!;
  for (const race of RACES) {
    const wrap = document.createElement("span");
    wrap.className = "dbg-frag-cell";
    wrap.innerHTML = `
      <span class="dbg-mini-label">${RACE_NAMES[race]}</span>
      <input type="number" class="dbg-frag-input" data-race="${race}" value="1" style="width:48px" />
      <button class="dbg-btn dbg-frag-btn" data-race="${race}">+</button>
    `;
    fragRow.appendChild(wrap);
  }

  // 专精 row（4 花色）
  const suitRow = el.querySelector(".dbg-suit-row")!;
  for (const suit of SUITS) {
    const wrap = document.createElement("span");
    wrap.className = "dbg-suit-cell";
    wrap.innerHTML = `
      <span class="dbg-mini-label">${SUIT_SYMBOLS[suit]}</span>
      <input type="number" class="dbg-suit-input" data-suit="${suit}" value="5" style="width:48px" />
      <button class="dbg-btn dbg-suit-btn" data-suit="${suit}" data-kind="played">+打过</button>
      <button class="dbg-btn dbg-suit-btn" data-suit="${suit}" data-kind="consumed" title="增加大招消耗（降低专精）">-消耗</button>
    `;
    suitRow.appendChild(wrap);
  }

  // 事件绑定
  el.querySelector<HTMLButtonElement>('[data-act="add-hand"]')!.onclick = () => {
    const id = resolveCardId(el);
    const suit = (el.querySelector<HTMLSelectElement>(".dbg-card-suit")!.value || undefined) as Suit | undefined;
    if (id) {
      cheatAddCardToHand(getState(), id, suit);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="add-deck"]')!.onclick = () => {
    const id = resolveCardId(el);
    const suit = (el.querySelector<HTMLSelectElement>(".dbg-card-suit")!.value || undefined) as Suit | undefined;
    if (id) {
      cheatAddCardToDeck(getState(), id, suit);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="add-discard"]')!.onclick = () => {
    const id = resolveCardId(el);
    const suit = (el.querySelector<HTMLSelectElement>(".dbg-card-suit")!.value || undefined) as Suit | undefined;
    if (id) {
      cheatAddCardToDiscard(getState(), id, suit);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="add-equip"]')!.onclick = () => {
    const id = equipPick.value;
    if (id) {
      cheatAddEquipment(getState(), id);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="add-perk"]')!.onclick = () => {
    const id = perkPick.value;
    if (id) {
      cheatAddPerk(getState(), id);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="set-hp"]')!.onclick = () => {
    const v = parseInt(el.querySelector<HTMLInputElement>(".dbg-hp-input")!.value);
    if (!isNaN(v)) {
      cheatSetHp(getState(), v);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="set-mhp"]')!.onclick = () => {
    const v = parseInt(el.querySelector<HTMLInputElement>(".dbg-mhp-input")!.value);
    if (!isNaN(v)) {
      cheatSetMaxHp(getState(), v);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="heal-full"]')!.onclick = () => {
    cheatHealFull(getState());
    onChange();
  };
  el.querySelectorAll<HTMLButtonElement>(".dbg-frag-btn").forEach((b) => {
    b.onclick = () => {
      const race = b.dataset.race as EnemyRace;
      const input = el.querySelector<HTMLInputElement>(`.dbg-frag-input[data-race="${race}"]`)!;
      const v = parseInt(input.value);
      if (!isNaN(v)) {
        cheatAddFragments(getState(), race, v);
        onChange();
      }
    };
  });
  el.querySelectorAll<HTMLButtonElement>(".dbg-suit-btn").forEach((b) => {
    b.onclick = () => {
      const suit = b.dataset.suit as Suit;
      const kind = b.dataset.kind;
      const input = el.querySelector<HTMLInputElement>(`.dbg-suit-input[data-suit="${suit}"]`)!;
      const v = parseInt(input.value);
      if (!isNaN(v)) {
        if (kind === "played") cheatAddSuitPlayed(getState(), suit, v);
        else cheatAddSuitConsumed(getState(), suit, v);
        onChange();
      }
    };
  });
  el.querySelector<HTMLButtonElement>('[data-act="reset-suit"]')!.onclick = () => {
    cheatResetSuitCounters(getState());
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="set-enchant"]')!.onclick = () => {
    const id = enchantPick.value as EnchantId | "";
    const lv = parseInt(el.querySelector<HTMLInputElement>(".dbg-enchant-lv")!.value);
    cheatSetEnchant(getState(), id === "" ? null : id, isNaN(lv) ? 1 : lv);
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="add-status"]')!.onclick = () => {
    const id = el.querySelector<HTMLInputElement>(".dbg-status-id")!.value.trim();
    const stacks = parseInt(el.querySelector<HTMLInputElement>(".dbg-status-stacks")!.value);
    const dur = parseInt(el.querySelector<HTMLInputElement>(".dbg-status-dur")!.value);
    if (!id) return;
    cheatAddPlayerStatus(getState(), id, isNaN(stacks) ? 1 : stacks, isNaN(dur) ? -1 : dur);
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="rm-status"]')!.onclick = () => {
    const id = el.querySelector<HTMLInputElement>(".dbg-status-id")!.value.trim();
    if (!id) return;
    cheatRemovePlayerStatus(getState(), id);
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="clear-status"]')!.onclick = () => {
    cheatClearAllPlayerStatuses(getState());
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="draw-n"]')!.onclick = () => {
    const n = parseInt(el.querySelector<HTMLInputElement>(".dbg-draw-n")!.value);
    if (!isNaN(n)) {
      cheatDrawN(getState(), n);
      onChange();
    }
  };
  el.querySelector<HTMLButtonElement>('[data-act="discard-hand"]')!.onclick = () => {
    cheatDiscardAllHand(getState());
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="clear-hand"]')!.onclick = () => {
    cheatClearZone(getState(), "hand");
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="clear-deck"]')!.onclick = () => {
    cheatClearZone(getState(), "deck");
    onChange();
  };
  el.querySelector<HTMLButtonElement>('[data-act="clear-discard"]')!.onclick = () => {
    cheatClearZone(getState(), "discard");
    onChange();
  };

  // 敌人 panel：每次 refresh 重新画
  const enemyList = el.querySelector(".dbg-enemy-list") as HTMLElement;
  const refreshEnemyPanel = () => {
    const state = getState();
    enemyList.innerHTML = "";
    if (!state.battle || !state.battle.enemies.length) {
      enemyList.innerHTML = `<span class="dbg-hint">（不在战斗中）</span>`;
      return;
    }
    state.battle.enemies.forEach((e, idx) => {
      const row = document.createElement("div");
      row.className = "dbg-enemy-row";
      const dead = (e.hp ?? 0) <= 0 || !e.alive;
      row.innerHTML = `
        <span class="dbg-mini-label">[${idx}] ${e.name}${dead ? " 💀" : ""}</span>
        <span>HP ${e.hp}/${e.maxHp}</span>
        <input type="number" class="dbg-enemy-hp" value="${e.hp}" style="width:60px" />
        <button class="dbg-btn" data-do="set-hp">设</button>
        <input type="number" class="dbg-enemy-dmg" value="10" style="width:48px" />
        <button class="dbg-btn" data-do="hurt">-HP</button>
        <button class="dbg-btn" data-do="kill" title="设 HP 为 0">💀 处决</button>
        <input class="dbg-enemy-status" placeholder="状态 id（如 poison）" style="width:140px" />
        <input type="number" class="dbg-enemy-status-stacks" value="3" style="width:48px" />
        <button class="dbg-btn" data-do="add-status">+ 状态</button>
      `;
      row.querySelector<HTMLButtonElement>('[data-do="set-hp"]')!.onclick = () => {
        const v = parseInt(row.querySelector<HTMLInputElement>(".dbg-enemy-hp")!.value);
        if (!isNaN(v)) {
          cheatSetEnemyHp(state, idx, v);
          onChange();
        }
      };
      row.querySelector<HTMLButtonElement>('[data-do="hurt"]')!.onclick = () => {
        const v = parseInt(row.querySelector<HTMLInputElement>(".dbg-enemy-dmg")!.value);
        if (!isNaN(v)) {
          cheatHurtEnemy(state, idx, v);
          onChange();
        }
      };
      row.querySelector<HTMLButtonElement>('[data-do="kill"]')!.onclick = () => {
        cheatKillEnemy(state, idx);
        onChange();
      };
      row.querySelector<HTMLButtonElement>('[data-do="add-status"]')!.onclick = () => {
        const sid = row.querySelector<HTMLInputElement>(".dbg-enemy-status")!.value.trim();
        const st = parseInt(row.querySelector<HTMLInputElement>(".dbg-enemy-status-stacks")!.value);
        if (sid) {
          cheatAddEnemyStatus(state, idx, sid, isNaN(st) ? 1 : st, -1);
          onChange();
        }
      };
      enemyList.appendChild(row);
    });
  };

  const refresh = () => {
    refreshEnemyPanel();
  };

  return { el, refresh };
}

/**
 * 把搜索框的输入解析成有效 defId：
 *   - 优先精确 defId 匹配
 *   - 否则按 name 模糊匹配（中文名）
 */
function resolveCardId(scope: HTMLElement): string | null {
  const raw = scope.querySelector<HTMLInputElement>(".dbg-card-search")!.value.trim();
  if (!raw) return null;
  if (CARD_DB[raw]) return raw;
  for (const [id, def] of Object.entries(CARD_DB)) {
    if (def.name === raw) return id;
  }
  // 模糊：包含
  for (const [id, def] of Object.entries(CARD_DB)) {
    if (def.name.includes(raw) || id.includes(raw)) return id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 拖拽
// ─────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let startX = 0,
    startY = 0,
    origX = 0,
    origY = 0,
    dragging = false;
  const onDown = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.classList.contains("dbg-btn") || tgt.closest(".dbg-btn")) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    e.preventDefault();
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = `${Math.max(8, origX + dx)}px`;
    panel.style.top = `${Math.max(8, origY + dy)}px`;
  };
  const onUp = () => {
    dragging = false;
  };
  handle.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
