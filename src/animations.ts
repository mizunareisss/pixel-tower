// 战斗动效库 v0.10
// 所有动效都创建临时 DOM 节点，CSS 驱动动画，自动清理。
// 保持 200-400ms 节奏，pointer-events: none 不阻塞游戏逻辑。

function spawn(parent: HTMLElement, className: string, lifeMs: number, setup?: (el: HTMLDivElement) => void): void {
  const el = document.createElement("div");
  el.className = className;
  if (setup) setup(el);
  parent.appendChild(el);
  setTimeout(() => el.remove(), lifeMs);
}

// ── 攻击：斩击线扫过 + 目标摇晃 ──────────────────────────
export function playSlashHit(targetEl: HTMLElement): void {
  spawn(targetEl, "fx fx-slash", 350);
  targetEl.classList.add("fx-shake");
  setTimeout(() => targetEl.classList.remove("fx-shake"), 250);
}

// ── 单体技能：圆环爆裂 ──────────────────────────────────
export function playSkillBurst(targetEl: HTMLElement, color: "purple" | "green" | "red" | "yellow" = "purple"): void {
  spawn(targetEl, `fx fx-burst fx-${color}`, 350);
}

// ── debuff 触发：黑暗粒子向下 ──────────────────────────
export function playDebuffApply(targetEl: HTMLElement): void {
  for (let i = 0; i < 5; i++) {
    spawn(targetEl, "fx fx-dark-particle", 600 + i * 30, el => {
      el.style.left = `${20 + Math.random() * 60}%`;
      el.style.animationDelay = `${i * 30}ms`;
    });
  }
}

// ── buff 触发：绿色粒子向上 ──────────────────────────
export function playBuffApply(targetEl: HTMLElement): void {
  for (let i = 0; i < 6; i++) {
    spawn(targetEl, "fx fx-buff-particle", 700 + i * 40, el => {
      el.style.left = `${10 + Math.random() * 80}%`;
      el.style.animationDelay = `${i * 40}ms`;
    });
  }
}

// ── 回血：绿色十字闪 ──────────────────────────────────
export function playHealSparkle(targetEl: HTMLElement): void {
  for (let i = 0; i < 8; i++) {
    spawn(targetEl, "fx fx-heal-particle", 800 + i * 30, el => {
      el.style.left = `${10 + Math.random() * 80}%`;
      el.style.animationDelay = `${i * 30}ms`;
    });
  }
}

// ── 群攻：横扫波 ──────────────────────────────────────
export function playAoeWave(rowEl: HTMLElement, color: "purple" | "red" | "yellow" = "purple"): void {
  spawn(rowEl, `fx fx-aoe-wave fx-${color}`, 600);
}

// ── 玩家受击：红闪 + 摇晃 ────────────────────────────
export function playPlayerHit(playerArea: HTMLElement): void {
  spawn(playerArea, "fx fx-hit-flash", 350);
  playerArea.classList.add("fx-shake");
  setTimeout(() => playerArea.classList.remove("fx-shake"), 250);
}

// ── 闪避：MISS 文字 + 蓝光闪 ────────────────────────
export function playDodgeMiss(targetEl: HTMLElement): void {
  spawn(targetEl, "fx fx-miss-text", 700, el => { el.textContent = "MISS"; });
}

// ── 装备进槽：黄色光环 ────────────────────────────────
export function playEquip(targetEl: HTMLElement): void {
  spawn(targetEl, "fx fx-burst fx-yellow", 400);
}
