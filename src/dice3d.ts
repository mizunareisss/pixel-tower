// 3D 骰子渲染（Three.js）
// 用于战斗开始的"骰子先手"动画
//
// 设计：
//   - 独立 WebGLRenderer，挂到 caller 提供的 container
//   - 6 个面用 CanvasTexture 程序生成（1-6 点）
//   - 翻滚动画：ease-out cubic 衰减，最终 snap 到指定面朝上
//   - 完成后自动清理 renderer（避免 WebGL context 泄漏）

import * as THREE from "three";

// 给 BoxGeometry 6 个面生成贴图（标准骰子布局：1↔6 对面，2↔5 对面，3↔4 对面）
function makeFaceTexture(num: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // 渐变背景（仿真象牙骰子）
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "#fafafa");
  grad.addColorStop(1, "#d4d4d4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // 边框（金色）
  ctx.strokeStyle = "#d4940a";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  // 点子（按真实骰子布局）
  ctx.fillStyle = "#1a1a1a";
  const r = 11;
  const c = size / 2; // 中心
  const e = size * 0.30; // 边缘偏移
  const positions: Record<number, [number, number][]> = {
    1: [[c, c]],
    2: [[c - e, c - e], [c + e, c + e]],
    3: [[c - e, c - e], [c, c], [c + e, c + e]],
    4: [[c - e, c - e], [c + e, c - e], [c - e, c + e], [c + e, c + e]],
    5: [[c - e, c - e], [c + e, c - e], [c, c], [c - e, c + e], [c + e, c + e]],
    6: [[c - e, c - e * 0.8], [c + e, c - e * 0.8],
        [c - e, c],             [c + e, c],
        [c - e, c + e * 0.8], [c + e, c + e * 0.8]],
  };
  for (const [x, y] of positions[num]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // 内阴影模拟点子凹陷
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 根据期望的最终面（1-6），返回让 BoxGeometry 该面 normal 旋转到世界 +Y 所需的 Euler XYZ 旋转
// BoxGeometry 默认 material 顺序：[+X, -X, +Y, -Y, +Z, -Z]
// 贴图分配：[1, 6, 2, 5, 3, 4]（1↔6, 2↔5, 3↔4 对面，标准骰子布局）
//
// Three.js Euler 'XYZ' 顺序意味着 M = R_x · R_y · R_z（应用到向量：M·v）
// 验算（v = face normal）：
//   face-1 +X (1,0,0):  R_z(+π/2)·(1,0,0)=(cos π/2, sin π/2, 0)=(0,1,0) ✓
//   face-6 -X (-1,0,0): R_z(-π/2)·(-1,0,0)=(0,1,0) ✓
//   face-2 +Y (0,1,0):  identity ✓
//   face-5 -Y (0,-1,0): R_x(π)·(0,-1,0)=(0, cos π·(-1)-sin π·0, sin π·(-1)+cos π·0)=(0,1,0) ✓
//   face-3 +Z (0,0,1):  R_x(-π/2)·(0,0,1)=(0, -sin(-π/2)·1, cos(-π/2)·1)=(0,1,0) ✓
//                                          这里 R_x(a)·(0,0,1)=(0,-sin a,cos a)
//   face-4 -Z (0,0,-1): R_x(+π/2)·(0,0,-1)=(0, sin(π/2)·1, -cos(π/2)·1)=(0,1,0) ✓
function getFinalRotation(num: number): { x: number; y: number; z: number } {
  const P = Math.PI / 2;
  switch (num) {
    case 1: return { x: 0,       y: 0, z: +P };
    case 6: return { x: 0,       y: 0, z: -P };
    case 2: return { x: 0,       y: 0, z:  0 };
    case 5: return { x: Math.PI, y: 0, z:  0 };
    case 3: return { x: -P,      y: 0, z:  0 };
    case 4: return { x: +P,      y: 0, z:  0 };
    default: return { x: 0, y: 0, z: 0 };
  }
}

export function rollDice3D(opts: {
  container: HTMLElement;
  finalRoll: number;        // 1-6
  duration?: number;        // 翻滚总时长 ms，默认 800
  size?: number;            // 渲染尺寸 px，默认 160
  onComplete?: () => void;  // 翻滚完成回调
}): { dispose: () => void } {
  const { container, finalRoll, duration = 800, size = 160, onComplete } = opts;

  // Scene / Camera / Renderer
  // 相机俯视（从右上方往下看），让最终"朝上的面"清楚露在顶部，同时露出 前/右 两面 → 3 面立体感
  // 之前正对着看 (0,0,5.5) → 顶面几乎是一条边、看不见，玩家实际读到的是前面那一面，所以"读数对不上"
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(1.8, 2.5, 4.3);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // 骰子立方体
  // BoxGeometry material 顺序：[+X, -X, +Y, -Y, +Z, -Z]
  // 按真实骰子对面规则映射：[1, 6, 2, 5, 3, 4]
  const materials = [1, 6, 2, 5, 3, 4].map(n =>
    new THREE.MeshStandardMaterial({
      map: makeFaceTexture(n),
      roughness: 0.4,
      metalness: 0.05,
    })
  );
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const dice = new THREE.Mesh(geometry, materials);
  // 初始姿态默认：face-2 (+Y) 朝上、face-1 (+X) 朝右、face-3 (+Z) 朝前
  // 相机俯视提供透视感，骰子自身不需要 tilt
  scene.add(dice);

  // 光照
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const point = new THREE.PointLight(0xffffff, 1.0, 20);
  point.position.set(3, 4, 5);
  scene.add(point);
  const fill = new THREE.PointLight(0xffeecc, 0.35, 20);
  fill.position.set(-4, -2, 3);
  scene.add(fill);

  // 翻滚动画参数
  const startTime = performance.now();
  const finalRot = getFinalRotation(finalRoll);
  // 终态：整圈数 + finalRot；整圈 2π 在 Euler XYZ 下等价于 identity，所以 t=1 时姿态正好是纯 finalRot
  // 翻滚圈数：X 轴 3 圈、Y 轴 4 圈、Z 轴只走最终的 0 或 ±π/2 / π（避免最后两面互相切换太频繁）
  const totalRotX = Math.PI * 2 * 3 + finalRot.x;
  const totalRotY = Math.PI * 2 * 4 + finalRot.y;
  const totalRotZ = finalRot.z;

  let frameId = 0;
  let done = false;

  function animate() {
    if (done) return;
    const t = Math.min(1, (performance.now() - startTime) / duration);
    // ease-out cubic (开始快、结尾慢，模拟"丢出去后逐渐停下")
    const ease = 1 - Math.pow(1 - t, 3);
    dice.rotation.x = totalRotX * ease;
    dice.rotation.y = totalRotY * ease;
    dice.rotation.z = totalRotZ * ease;
    renderer.render(scene, camera);
    if (t >= 1) {
      done = true;
      onComplete?.();
      return;
    }
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);

  return {
    dispose: () => {
      done = true;
      cancelAnimationFrame(frameId);
      // 清理 Three.js 资源避免 WebGL context 泄漏
      geometry.dispose();
      materials.forEach(m => {
        m.map?.dispose();
        m.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
  };
}
