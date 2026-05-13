# Suitspire / 塔牌 — 项目说明

这是个 TypeScript + Vite 的 roguelike 卡牌游戏（爬塔），4 花色专精构筑。线上：https://suitspire.netlify.app

## 目录结构

```
pixel-tower/
├── src/                    # 主游戏 TS 代码（这里改影响线上）
│   ├── main.ts             # UI 渲染入口
│   ├── battle.ts           # 战斗系统（伤害计算 / 摸牌 / 状态）
│   ├── cards.ts            # 所有卡定义 + 奖励抽卡
│   ├── game.ts             # 顶层游戏状态机
│   ├── enemies.ts          # 敌人生成
│   ├── bossAI.ts           # Boss AI 行为
│   ├── map.ts              # 楼层地图
│   ├── events.ts           # 楼层事件
│   ├── types.ts            # 类型 + 常量（STATUS_META / SUIT_TIER_DESCS）
│   └── style.css
├── prototypes/             # ★ 场景原型（Three.js + importmap + CDN）
│   ├── scene-f1-outside.html  # F1 塔外大地图（当前主交付）
│   ├── character-gallery.html # 角色定稿模型画廊
│   ├── main-scene.html        # 12 层塔楼概览（已废）
│   └── tower-scenes.html      # 早期塔楼实验
├── balance-csv/            # 数值表（XLSX + 自动导出 CSV）
├── SUITSPIRE_WORLD.md      # 世界圣经（视觉调子 / 4 段主题 / 5 种族 / 5 NPC）
├── DESIGN_NOTES.md         # 设计笔记
├── BALANCE_SHEET.md        # 数值汇总（balance-csv 自动生成）
└── index.html              # Vite 主入口
```

**核心规则**：`src/` 影响线上游戏，`prototypes/` 是独立 Three.js 实验，**不会被 Vite 构建打包**，dist/ 只含 `index.html` + 主游戏 bundle。原型只在本地跑，不上线。

## 分工

- **场景原型**（`prototypes/*.html`）：3D 美术 / 关卡视觉
- **主游戏**（`src/*.ts`）：玩法 / 战斗 / UI

两人若都改 `src/`，按模块切：UI/战斗逻辑 vs 内容/数据。

## 分支模型

- `main` — 稳定，对应 Netlify 部署
- `dev` — 日常开发，所有 commit 先进 dev
- `feature/xxx` — 大改用 feature 分支，做完合 dev
- `feature/debug-console` — **特殊**：调试控制台浮窗（🐞 chip / backtick 开关）。
  - 永远跟 dev 同步（dev 有更新就 rebase / merge 进来）
  - **永远不合进 dev / main**
  - 调试时手动 `git checkout feature/debug-console` 跑本地预览
  - 只有 dev 才能合进 main；这个分支是"私房工具"，永不上线

### 协作者工作流

```bash
git clone https://github.com/mizunareisss/pixel-tower.git
cd pixel-tower
npm install
git checkout dev
git pull

# 改之前
git checkout -b feature/scene-f2  # 取个描述性名字

# 改完
git add prototypes/scene-f2-inside.html
git commit -m "feat: F2 塔内场景 v1"
git push -u origin feature/scene-f2

# 在 GitHub 上开 PR → dev 分支
```

### 仓库所有者合 PR

```bash
git checkout dev && git pull
# 审 PR 后在 GitHub 点 merge 即可
# 或本地：
git merge feature/scene-f2 && git push origin dev
```

## 本地开发命令

```bash
npm install                  # 首次安装
npm run dev                  # 主游戏 + 原型都能访问
                             #   主游戏: http://localhost:5173/
                             #   原型:   http://localhost:5173/prototypes/scene-f1-outside.html
npm run build                # 产线构建（只打主游戏，不含 prototypes）
npx tsc --noEmit             # 类型检查
```

原型完全静态，**也可以**用任意 static server 跑（不需要 npm）：
```bash
python3 -m http.server 5180
# http://localhost:5180/prototypes/scene-f1-outside.html
```

## 部署（Netlify suitspire 站）

**正常情况**：push 到 `main` → GitHub → Netlify 自动构建部署。

**当前状态**：Netlify 账号 build credit 超额，自动部署会 fail。要发版走 **两步走 + 用户手动 publish**：

```bash
# Claude 做的：
npm run build
netlify deploy --dir=dist --no-build  # 上传 draft，输出里会给一个 deploy 链接
```

然后 **把 deploy 详情链接发给用户**，让用户**亲自**点一次 `Publish deploy` 按钮就上线：

```
https://app.netlify.com/projects/suitspire/deploys/<deploy_id>
```

⚠ **必须加 `--no-build`**。不加的话 Netlify 会在远端 build 容器里再 build 一次，经常在 "CDN diffing files..." 卡 3+ 分钟最后报 `Error: Error while running build`。本地已经 `npm run build` 过了，远端没必要重 build，直接传 `dist/` 就行。

⚠ **不要**用 `netlify api restoreSiteDeploy` 自己 promote。亲测会卡死整个 CLI 进程，还把 Netlify API 打成 429 rate limit。用户点一下 = 1 秒搞定，Claude 别自己折腾。

CLI 首次跑前要 `netlify link --id 35081b0a-9da8-4bde-8a10-36593411da69`（一次性，已经做过）。

prototypes 不会被 build，朋友改 prototype **不影响**线上游戏。

## 版本号 / 机制文档维护

游戏版本号是单一来源：**`src/types.ts` 的 `APP_VERSION`**。
汉堡菜单顶部显示这个版本号，方便 dev/main 不同版本互相区分。

**每次发新版本（包括小修小补）**：

1. bump `APP_VERSION = "X.Y.Z"`（`src/types.ts`）
2. 同步 bump `package.json` 的 `version`
3. `git mv GAME_MECHANICS_v<旧>.md GAME_MECHANICS_v<新>.md`
4. 新文件顶部更新版本号 + "最后更新" 日期
5. 在文档 § 版本变更日志 加新条目（简短列本次改动）
6. 如果数值变了 → 重跑 `npx tsx scripts/dump-balance.ts` 重新生成 `BALANCE_SHEET.md`
7. commit：`docs: bump v<X.Y.Z> 机制文档`
8. 走正常 dev → main → netlify 流程

**版本号语义**：

- **patch**（0.8.0 → 0.8.1）：bug fix / 小数值调整 / 单卡 rebalance
- **minor**（0.8.0 → 0.9.0）：新机制 / 新流派 / 大规模 rebalance / 重要新功能
- **major**（0.x → 1.0.0）：完整正式版

**当前主要文档**：

| 文档 | 内容 | 维护方式 |
|---|---|---|
| `GAME_MECHANICS_v<X.Y.Z>.md` | 完整游戏机制 / 系统 / 公式 / 状态目录 | 每版手动更新 |
| `BALANCE_SHEET.md` | 所有卡牌 / 附魔 5 档数值 | `scripts/dump-balance.ts` 自动生成 |
| `SUITSPIRE_WORLD.md` | 世界观 / 12 关氛围 / 5 种族 | 偶尔手动改 |
| `DESIGN_NOTES.md` | 历史设计笔记 | 偶尔手动改 |

## 视觉决策（已定稿，原型不要改）

- 视角：等距正交相机 + shot-based 慢摇
- 渲染：Three.js + MeshToonMaterial + 5 段 gradientMap + UnrealBloomPass
- 调色：暗紫底 `#1f1828` + 火光暖橙 + 紫色符文 `#c868ff`
- 节点系统：每节点定义 `next[]`，玩家点底栏按钮逐个走过
- 雾：fog near 18 / far 60
- 移动端竖屏：相机 `d = aspect < 1 ? 9 : 12`

## 已踩过的坑

- **Z fighting**：贴表面的金边/装饰物抬高 ≥0.03；透明大面积 mesh 加 `depthWrite: false` + `renderOrder`
- **Three.js Clock**：`getDelta()` 每帧只调一次；取累计时间用 `clock.elapsedTime` 属性（不是 `getElapsedTime()` 方法），两者抢内部 oldTime 会让 dt 错乱
- **Netlify deploy --prod**：账号 credit 超额时直接 prod deploy 会 403，必须 draft + restoreSiteDeploy 两步走

## 必读文档

新接手先读：
1. **`GAME_MECHANICS_v<最新>.md`** — 完整游戏机制 + 公式 + 状态目录（**首要**）
2. **`BALANCE_SHEET.md`** — 全卡牌 / 附魔 5 档数值（自动生成，权威数据源）
3. **`SUITSPIRE_WORLD.md`** — 世界观 / 视觉调子 / 12 关氛围
4. **`DESIGN_NOTES.md`** — 玩法 / 系统设计历史笔记
5. **`prototypes/scene-f1-outside.html`** — F1 已完成参考实现（场景侧）
