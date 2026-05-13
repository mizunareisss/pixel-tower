# prototypes/ — Three.js 场景原型协作指南

> 看完这份再开干。顶层还有一份 `../CLAUDE.md` 讲项目总览（分支模型 / 部署 / src/ 结构），那份是"项目级"，这份是"场景级"。

## 这是什么 / 不是什么

- ✅ 是：独立的 Three.js + importmap + CDN 单文件 HTML 实验，用来做关卡视觉、模型雕琢、场景调色
- ❌ 不是：游戏本体的一部分。`prototypes/` **不会被 Vite 打包**，`npm run build` 只输出 `dist/index.html` + 主游戏 bundle，原型永远不上线
- ✅ 跑法 1：`npm run dev` → `http://localhost:5173/prototypes/scene-f1-outside.html`
- ✅ 跑法 2（不依赖 npm）：`python3 -m http.server 5180` → `http://localhost:5180/prototypes/...`

## 现有原型 / 状态

| 文件 | 角色 | 说明 |
|---|---|---|
| `scene-f1-outside.html` | **主交付** ⭐ | F1 塔外大地图，节点系统 + 等距摄像机 shot 切换。**新原型抄它的架子** |
| `character-gallery.html` | **主交付** ⭐ | 12 种角色/敌人定稿模型画廊。建模参考 |
| `tower-scenes.html` | 实验 | 早期三场景切换（塔外/塔中/塔顶）。视觉调研用，未定稿 |
| `main-scene.html` | **已废** ❌ | 早期 12 层塔楼概览。架构已被 scene-f1 替代，不再维护 |

新增原型命名：`scene-f<n>-<位置>.html`（例：`scene-f2-inside.html`、`scene-f6-roof.html`）。

## 视觉决策（已定稿，不要改）

这些是项目主调，新原型也照搬：

- **视角**：等距正交相机，shot-based 慢摇切镜（不要换透视）
- **`d` 值**：桌面 `12`，竖屏 `aspect < 1` 时 `9`
- **雾**：`color #3a2838`，`near 18 / far 60`
- **环境底色**：`#1f1828`（暗紫）
- **暖色光源**：`#fff0d8`（主光）/ `#ffd8b0` (hemisphere sky)
- **金 / 符文**：`#fbbf24`（金）/ `#c868ff`（紫符文）
- **Toon gradient（5 段）**：`['#1a161e', '#4a444e', '#988090', '#d8c8a0', '#f8e8b0']`
- **Bloom**：threshold `0.5`，strength `0.55`，radius `0.6`（character-gallery 用 0.5/0.5/0.7，按场景微调）

主调色板和 12 关每关的氛围色看 `../SUITSPIRE_WORLD.md`（世界圣经）。

## 节点地图配色（地图节点专用）

| 节点 | 颜色 |
|---|---|
| 起点 start | `#4dd870` 绿 |
| 战斗 battle | `#e63329` 红 |
| 精英 elite | `#ff8c28` 橙 |
| Boss | `#ffd460` 浅金 |
| 路径连线 | `#80c8ff` 青 |

## Three.js 设置约定

抄 `scene-f1-outside.html` 的开头就行，核心约定：

```html
<script type="importmap">
{
  "imports": {
    "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
    "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
  }
}
</script>
```

**版本锁死 `0.160.0`**。要升版本先在主游戏侧同步检查兼容。

### Renderer

```js
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
```

### 灯光（4 灯方案）

```js
ambient:     0xc8b8a8  intensity 0.75  // 暖米色基底
hemisphere:  sky 0xffd8b0 / ground 0x3a2438  intensity 0.7
directional: 0xfff0d8  intensity 1.6  // 主"太阳"，开 shadow
fill:        0xb89890  intensity 0.45  // 侧补光
```

阴影相机范围：`left/right ±32, top 28, bottom -32, far 110`。

### 材质

- 角色 / 物件：`MeshToonMaterial` + 5-step gradient map（canvas → CanvasTexture，filter `NearestFilter` 保硬边）
- 发光物（火、眼、符文）：`MeshBasicMaterial` 不受光，让 bloom 直接吃到
- 透明大面 mesh：`transparent: true` + `depthWrite: false` + 设 `renderOrder` 控制叠放顺序

### 动画 loop

```js
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();      // ★ 每帧只调一次
  const t = clock.elapsedTime;      // ★ 直接读属性，不要再调 getElapsedTime()
  for (const fn of updaters) fn(t, dt);
  composer.render();
}
```

## 命名约定

- 章节注释：`// ============ Section Name ============` 主章节，`// —— 小标题 ——` 逻辑块
- 资产构建函数：`make*` 复杂物件（`makeTorch`、`makeBanner`、`makeAdventurer`），`build*` 场景组装（`build`、`buildTowerWall`）
- 基础几何 helper：`block()` / `cyl()` / `sph()` / `toon()`（颜色 helper）
- 文件布局顺序（抄 scene-f1）：imports → consts → helpers → make 函数 → builders → build() → animate()

## 已踩过的坑

1. **Z-fighting**（贴表面的金边、装饰、地纹叠在一起闪）
   - 解决：贴表面的元素抬高 ≥ `0.03` 单位
   - 透明大面：`depthWrite: false` + `renderOrder` 控制顺序
   - scene-f1 里所有藤蔓 / 云 / 半透饰物都这么处理的，可以抄

2. **Clock.getDelta + getElapsedTime() 同帧调**
   - 错：`const dt = clock.getDelta(); const t = clock.getElapsedTime();` ← 两个都用，dt 会乱
   - 对：`const dt = clock.getDelta(); const t = clock.elapsedTime;` ← getDelta 调一次，再读属性
   - 原理：两个方法都会更新内部 oldTime，相互抢导致 dt 失常

3. **Bloom 参数是手调的**
   - threshold 过高 → glow 消失；过低 → 一切都在发光
   - 建议范围：threshold `0.4–0.7`、strength `0.5–0.8`、radius `0.5–0.8`
   - 每个场景单独调，浏览器里实时改最快

4. **RNG 复现**
   - 用 `mulberry32(seed)` 拿到种子化的 `rng()` → `[0, 1)`
   - `rand(min, max) = min + rng() * (max - min)`
   - scene-f1 节点布局就这套，方便复现 layout

## 协作工作流

```bash
git checkout dev && git pull
git checkout -b feature/scene-f2-inside  # 描述性分支名
# 改 prototypes/scene-f2-inside.html ...
git add prototypes/scene-f2-inside.html
git commit -m "feat: F2 塔内场景 v1"
git push -u origin feature/scene-f2-inside
# GitHub 上开 PR → dev
```

主游戏 (`src/*.ts`) 和 prototypes (`prototypes/*.html`) 完全解耦，朋友改 prototype **不影响**线上游戏，主游戏开发也不会动你的原型。两边可以并行无冲突。

## 你大概不需要碰但好奇可以看

- `../SUITSPIRE_WORLD.md` — 世界圣经，12 关每关的氛围 / 颜色 / 种族对应
- `../DESIGN_NOTES.md` — 玩法设计
- `../src/style.css` — 主游戏 UI 配色，跟原型调子保持一致

## 提交规范

跟主仓库一致：`feat:` / `fix:` / `chore:` / `docs:` 前缀，中文 commit body 即可。
