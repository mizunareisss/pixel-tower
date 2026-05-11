// SVG icon library for pixel-tower cards
// 36×36 viewBox, stroke-based line-art, currentColor

function ic(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
function icf(body: string): string {
  // variant allowing inline fill="currentColor" overrides inside body
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// ─────────────────────────────────────────────────────────
// 武器
// ─────────────────────────────────────────────────────────

const short_sword = ic(`
  <line x1="8" y1="28" x2="26" y2="10"/>
  <line x1="12" y1="20" x2="6" y2="26"/>
  <line x1="20" y1="12" x2="26" y2="6"/>
  <line x1="14" y1="18" x2="18" y2="22"/>
  <circle cx="6" cy="30" r="2" fill="currentColor" stroke="none"/>
`);

const long_sword = ic(`
  <line x1="6" y1="30" x2="28" y2="8"/>
  <line x1="10" y1="22" x2="4" y2="28"/>
  <line x1="22" y1="10" x2="28" y2="4"/>
  <line x1="14" y1="18" x2="20" y2="24"/>
  <circle cx="4" cy="32" r="2.5" fill="currentColor" stroke="none"/>
`);

const dagger = icf(`
  <path d="M18 4 L22 20 L18 28 L14 20 Z" stroke-width="1.8"/>
  <line x1="12" y1="18" x2="24" y2="18"/>
  <circle cx="18" cy="30" r="2.5" fill="currentColor" stroke="none"/>
`);

const war_bow = icf(`
  <path d="M10 6 Q6 18 10 30" stroke-width="2.5"/>
  <line x1="10" y1="6" x2="10" y2="30"/>
  <line x1="10" y1="18" x2="24" y2="18"/>
  <polygon points="24,18 20,15 20,21" fill="currentColor" stroke="none"/>
`);

const twin_blades = ic(`
  <line x1="8" y1="28" x2="20" y2="16"/>
  <line x1="16" y1="28" x2="28" y2="16"/>
  <line x1="12" y1="20" x2="6" y2="26"/>
  <line x1="24" y1="20" x2="30" y2="26"/>
  <circle cx="6" cy="30" r="2" fill="currentColor" stroke="none"/>
  <circle cx="30" cy="30" r="2" fill="currentColor" stroke="none"/>
`);

const warhammer = icf(`
  <rect x="12" y="5" width="12" height="11" rx="2"/>
  <line x1="18" y1="16" x2="18" y2="31"/>
  <line x1="14" y1="31" x2="22" y2="31"/>
  <line x1="18" y1="10" x2="18" y2="10"/>
`);

const battle_staff = icf(`
  <line x1="18" y1="13" x2="18" y2="32"/>
  <line x1="13" y1="32" x2="23" y2="32"/>
  <circle cx="18" cy="9" r="5" stroke-width="2"/>
  <circle cx="18" cy="9" r="2" fill="currentColor" stroke="none"/>
`);

const chain_whip = icf(`
  <path d="M8 8 C14 10 12 20 18 22 C24 24 24 28 28 28" stroke-width="2.2"/>
  <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>
  <circle cx="28" cy="28" r="3" fill="currentColor" stroke="none"/>
  <circle cx="14" cy="14" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="22" cy="24" r="1.5" fill="currentColor" stroke="none"/>
`);

const berserker_blade = ic(`
  <polyline points="10,32 12,24 8,18 14,16 10,10 16,12 18,6 22,12 28,8 24,16 30,18 24,22 26,28 20,26 18,32"/>
`);

const wizard_staff = icf(`
  <line x1="18" y1="16" x2="18" y2="32"/>
  <line x1="12" y1="32" x2="24" y2="32"/>
  <circle cx="18" cy="10" r="7" stroke-width="2"/>
  <circle cx="18" cy="10" r="3" fill="currentColor" stroke="none"/>
  <line x1="11" y1="5" x2="9" y2="3"/>
  <line x1="25" y1="5" x2="27" y2="3"/>
`);

const repeating_bow = icf(`
  <rect x="5" y="14" width="26" height="8" rx="3"/>
  <line x1="18" y1="5" x2="18" y2="14"/>
  <line x1="14" y1="7" x2="14" y2="14"/>
  <line x1="22" y1="7" x2="22" y2="14"/>
  <line x1="5" y1="18" x2="28" y2="18"/>
  <polygon points="31,18 26,15 26,21" fill="currentColor" stroke="none"/>
`);

// EPIC 武器（先前没有 icon，会回退到通用 equipment 盾牌 → 视觉错位）

// 王者之剑：双锋长剑 + 顶部三尖王冠 + 剑柄宝石
const excalibur = icf(`
  <line x1="18" y1="6" x2="18" y2="28" stroke-width="2.4"/>
  <polyline points="14,9 18,5 22,9" stroke-width="1.6"/>
  <line x1="12" y1="26" x2="24" y2="26" stroke-width="2"/>
  <line x1="14" y1="29" x2="22" y2="29" stroke-width="1.6"/>
  <circle cx="18" cy="32" r="2" fill="currentColor" stroke="none"/>
  <polyline points="10,11 13,8 13,14" stroke-width="1.4"/>
  <polyline points="26,11 23,8 23,14" stroke-width="1.4"/>
  <polyline points="15,7 18,4 21,7" stroke-width="1.4"/>
  <circle cx="18" cy="14" r="1.4" fill="currentColor" stroke="none"/>
`);

// 天命之刃：稍弯的太刀 + 顶部星芒（天命）
const divine_blade = icf(`
  <path d="M9 30 Q14 22 22 12 Q26 8 28 6" stroke-width="2.4"/>
  <line x1="12" y1="22" x2="6" y2="28" stroke-width="1.8"/>
  <circle cx="6" cy="30" r="2" fill="currentColor" stroke="none"/>
  <polyline points="22,4 24,7 27,5 25,8 28,10 25,11 27,14 24,12 23,15 22,12 19,13 21,10 19,7 22,8 Z" stroke-width="1.3"/>
`);

// 血裂刃：直剑 + 剑身血滴
const blood_blade = icf(`
  <line x1="8" y1="28" x2="26" y2="10" stroke-width="2.2"/>
  <line x1="12" y1="20" x2="6" y2="26"/>
  <line x1="20" y1="12" x2="26" y2="6"/>
  <circle cx="6" cy="30" r="2" fill="currentColor" stroke="none"/>
  <circle cx="16" cy="20" r="1.6" fill="currentColor" stroke="none"/>
  <circle cx="20" cy="16" r="1.2" fill="currentColor" stroke="none"/>
  <circle cx="13" cy="24" r="1" fill="currentColor" stroke="none"/>
`);

// ── 流派资源补全 v2（9 张）icons ──

// 飞镖 (♦ common 武器)：4 把小飞刀分散
const flying_darts = icf(`
  <line x1="5" y1="5" x2="14" y2="14" stroke-width="1.8"/>
  <line x1="31" y1="5" x2="22" y2="14" stroke-width="1.8"/>
  <line x1="5" y1="31" x2="14" y2="22" stroke-width="1.8"/>
  <line x1="31" y1="31" x2="22" y2="22" stroke-width="1.8"/>
  <polygon points="14,14 12,12 12,16" fill="currentColor" stroke="none"/>
  <polygon points="22,14 24,12 24,16" fill="currentColor" stroke="none"/>
  <polygon points="14,22 12,20 12,24" fill="currentColor" stroke="none"/>
  <polygon points="22,22 24,20 24,24" fill="currentColor" stroke="none"/>
`);

// 木盾杖 (♣ common 武器)：杖 + 顶部小盾
const shield_staff = icf(`
  <line x1="18" y1="14" x2="18" y2="32"/>
  <line x1="13" y1="32" x2="23" y2="32"/>
  <path d="M11 6 L25 6 L23 14 Q18 18 13 14 Z" stroke-width="1.8"/>
  <line x1="18" y1="9" x2="18" y2="13" stroke-width="1.4"/>
`);

// 风刃 (♦ epic 武器)：弯曲风形剑刃
const wind_blade = icf(`
  <path d="M6 28 Q14 10 30 6" stroke-width="2.4"/>
  <path d="M6 32 Q12 18 24 12" stroke-width="1.8" opacity="0.7"/>
  <polyline points="22,11 26,8 24,14" stroke-width="1.4"/>
  <circle cx="6" cy="30" r="2" fill="currentColor" stroke="none"/>
`);

// 永生之牙 (♥ epic 武器)：双弯獠牙 + 心形装饰
const everlast_fang = icf(`
  <path d="M12 6 Q10 18 14 28 Q16 22 16 14 Z" stroke-width="2"/>
  <path d="M24 6 Q26 18 22 28 Q20 22 20 14 Z" stroke-width="2"/>
  <path d="M18 16 Q14 12 16 8 Q18 12 18 14 Q18 12 20 8 Q22 12 18 16 Z" fill="currentColor" stroke="none"/>
`);

// 禁忌权杖 (♣ epic 武器)：法杖 + 顶端禁忌符号
const forbidden_scepter = icf(`
  <line x1="18" y1="16" x2="18" y2="32" stroke-width="2.4"/>
  <line x1="12" y1="32" x2="24" y2="32"/>
  <path d="M12 12 L24 12 L21 4 L15 4 Z" stroke-width="2"/>
  <line x1="13" y1="8" x2="23" y2="8"/>
  <circle cx="18" cy="10" r="1.6" fill="currentColor" stroke="none"/>
`);

// 战甲带 (♠ common 防具)：带状腰甲 + 中央纹饰
const combat_belt = icf(`
  <rect x="5" y="13" width="26" height="10" rx="2" stroke-width="2"/>
  <line x1="5" y1="18" x2="31" y2="18"/>
  <rect x="14" y="10" width="8" height="16" rx="1" stroke-width="1.6"/>
  <line x1="18" y1="13" x2="18" y2="23"/>
`);

// 斩魂铠 (♠ super_rare 防具)：板甲 + 镰刀形纹
const soulreaver_plate = icf(`
  <path d="M10 8 L26 8 L24 28 Q18 32 12 28 Z" stroke-width="2.2"/>
  <path d="M14 12 Q18 16 22 12" stroke-width="1.6"/>
  <path d="M14 16 Q18 22 22 16" stroke-width="1.4"/>
  <line x1="18" y1="20" x2="18" y2="24"/>
  <circle cx="18" cy="24" r="1.6" fill="currentColor" stroke="none"/>
`);

// 不朽战甲 (♠ epic 防具)：环形铠 + 顶部星芒
const immortal_plate = icf(`
  <path d="M9 8 L27 8 L25 28 Q18 32 11 28 Z" stroke-width="2.4"/>
  <polyline points="14,4 18,8 22,4" stroke-width="1.4"/>
  <line x1="18" y1="6" x2="18" y2="2" stroke-width="1.4"/>
  <line x1="14" y1="14" x2="22" y2="14"/>
  <line x1="14" y1="18" x2="22" y2="18"/>
  <line x1="14" y1="22" x2="22" y2="22"/>
`);

// 生命囊 (♥ super_rare 防具)：药囊形 + 心形点缀
const life_pouch = icf(`
  <path d="M9 12 L27 12 L29 30 Q18 34 7 30 Z" stroke-width="2"/>
  <line x1="13" y1="12" x2="13" y2="6" stroke-width="1.4"/>
  <line x1="23" y1="12" x2="23" y2="6" stroke-width="1.4"/>
  <line x1="13" y1="6" x2="23" y2="6"/>
  <path d="M18 22 Q15 18 13 20 Q15 24 18 26 Q21 24 23 20 Q21 18 18 22 Z" fill="currentColor" stroke="none"/>
`);

// 幻影披风 (♦ epic 防具)：飘动披风轮廓
const phantom_cloak = icf(`
  <path d="M10 6 Q6 16 8 30 Q14 24 18 30 Q22 24 28 30 Q30 16 26 6 Q22 10 18 8 Q14 10 10 6 Z" stroke-width="2"/>
  <path d="M14 10 Q12 16 14 24" stroke-width="1.4" opacity="0.7"/>
  <path d="M22 10 Q24 16 22 24" stroke-width="1.4" opacity="0.7"/>
`);

// 破军：粗大弯刀 + 锯齿口
const raider = icf(`
  <path d="M8 30 Q18 24 28 8" stroke-width="2.6"/>
  <polyline points="26,10 24,12 25,14 23,15 24,17 22,18 23,20" stroke-width="1.3"/>
  <line x1="12" y1="26" x2="7" y2="31"/>
  <circle cx="7" cy="32" r="2" fill="currentColor" stroke="none"/>
`);

// 流派资源补全：4 张新卡 icon
// 吸血獠牙 (♥ rare)：弯曲尖牙 + 血滴
const vampire_fang = icf(`
  <path d="M14 6 Q14 20 18 28 Q22 20 22 6 Z" stroke-width="2"/>
  <line x1="10" y1="6" x2="26" y2="6" stroke-width="2"/>
  <circle cx="18" cy="32" r="2" fill="currentColor" stroke="none"/>
  <circle cx="15" cy="31" r="1" fill="currentColor" stroke="none"/>
  <circle cx="21" cy="31" r="1" fill="currentColor" stroke="none"/>
`);

// 生机长杖 (♥ super_rare)：长杖 + 顶部叶芽 / 心形
const lifebloom_staff = icf(`
  <line x1="18" y1="14" x2="18" y2="32" stroke-width="2.2"/>
  <line x1="12" y1="32" x2="24" y2="32"/>
  <path d="M18 14 Q12 9 15 5 Q18 8 18 12" stroke-width="1.6"/>
  <path d="M18 14 Q24 9 21 5 Q18 8 18 12" stroke-width="1.6"/>
  <circle cx="18" cy="9" r="2.5" fill="currentColor" stroke="none"/>
`);

// 骑士铠 (♠ rare)：胸甲 + 十字星
const knight_plate = icf(`
  <path d="M10 8 L26 8 L24 28 Q18 32 12 28 Z" stroke-width="2.2"/>
  <line x1="18" y1="12" x2="18" y2="24" stroke-width="1.6"/>
  <line x1="13" y1="18" x2="23" y2="18" stroke-width="1.6"/>
  <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none"/>
`);

// ─────────────────────────────────────────────────────────
// 防具
// ─────────────────────────────────────────────────────────

const round_shield = ic(`
  <circle cx="18" cy="18" r="12" stroke-width="2.5"/>
  <line x1="18" y1="6" x2="18" y2="30"/>
  <line x1="6" y1="18" x2="30" y2="18"/>
  <circle cx="18" cy="18" r="3"/>
`);

const leather_armor = ic(`
  <path d="M10 30 L10 16 Q10 7 18 5 Q26 7 26 16 L26 30 Z" stroke-width="2"/>
  <path d="M10 16 Q14 21 18 21 Q22 21 26 16"/>
  <line x1="18" y1="5" x2="18" y2="21"/>
`);

const spike_armor = icf(`
  <path d="M10 30 L10 16 Q10 7 18 5 Q26 7 26 16 L26 30 Z" stroke-width="2"/>
  <line x1="13" y1="8" x2="11" y2="2"/>
  <line x1="18" y1="5" x2="18" y2="0"/>
  <line x1="23" y1="8" x2="25" y2="2"/>
  <circle cx="11" cy="2" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="18" cy="0" r="1.5" fill="currentColor" stroke="none"/>
  <circle cx="25" cy="2" r="1.5" fill="currentColor" stroke="none"/>
`);

const heavy_armor = ic(`
  <path d="M8 30 L8 14 L12 8 L18 6 L24 8 L28 14 L28 30 Z" stroke-width="2.2"/>
  <line x1="8" y1="18" x2="28" y2="18"/>
  <line x1="8" y1="24" x2="28" y2="24"/>
  <path d="M12 8 Q18 12 24 8"/>
`);

const mage_robe = icf(`
  <path d="M12 4 Q18 9 24 4 L28 32 L8 32 Z" stroke-width="2"/>
  <path d="M12 4 L8 12"/>
  <path d="M24 4 L28 12"/>
  <circle cx="18" cy="14" r="4" stroke-width="1.8"/>
  <circle cx="18" cy="14" r="1.5" fill="currentColor" stroke="none"/>
`);

const cloak = ic(`
  <path d="M10 4 Q18 8 26 4 L30 32 Q18 26 6 32 Z" stroke-width="2"/>
  <line x1="10" y1="4" x2="26" y2="4"/>
  <line x1="18" y1="8" x2="18" y2="26"/>
`);

const full_plate = ic(`
  <path d="M10 30 L10 16 L14 8 L22 8 L26 16 L26 30 Z" stroke-width="2"/>
  <path d="M14 8 Q18 4 22 8"/>
  <rect x="13" y="16" width="10" height="7" rx="1"/>
  <line x1="10" y1="24" x2="26" y2="24"/>
`);

const scale_mail = ic(`
  <ellipse cx="13" cy="12" rx="5" ry="4"/>
  <ellipse cx="23" cy="12" rx="5" ry="4"/>
  <ellipse cx="18" cy="20" rx="5" ry="4"/>
  <ellipse cx="11" cy="27" rx="4.5" ry="3.5"/>
  <ellipse cx="25" cy="27" rx="4.5" ry="3.5"/>
`);

const mind_armor = icf(`
  <path d="M4 18 Q18 4 32 18 Q18 32 4 18 Z" stroke-width="2"/>
  <circle cx="18" cy="18" r="5"/>
  <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none"/>
  <line x1="18" y1="6" x2="18" y2="4"/>
  <line x1="25" y1="9" x2="27" y2="7"/>
`);

// 不灭之心（EPIC ♥ armor）：心形 + 内部跳动光点
const undying_heart = icf(`
  <path d="M18 32 C8 24 4 18 6 12 C8 6 14 6 18 12 C22 6 28 6 30 12 C32 18 28 24 18 32 Z" stroke-width="2"/>
  <circle cx="18" cy="18" r="3" fill="currentColor" stroke="none"/>
  <path d="M14 16 Q18 14 22 16" stroke-width="1.4"/>
`);

// ─────────────────────────────────────────────────────────
// 技能 — 单体 / 自身
// ─────────────────────────────────────────────────────────

const sk_poison_blade = icf(`
  <line x1="10" y1="26" x2="26" y2="10" stroke-width="2.2"/>
  <line x1="14" y1="20" x2="8" y2="26"/>
  <line x1="22" y1="12" x2="28" y2="6"/>
  <circle cx="10" cy="28" r="3" fill="currentColor" stroke="none" opacity="0.75"/>
  <circle cx="22" cy="26" r="2" fill="currentColor" stroke="none" opacity="0.6"/>
`);

const sk_battle_cry = ic(`
  <path d="M6 24 Q6 10 18 8 Q30 10 30 18"/>
  <path d="M30 18 Q32 26 24 28"/>
  <line x1="6" y1="24" x2="2" y2="22"/>
  <line x1="6" y1="20" x2="2" y2="18"/>
  <line x1="6" y1="28" x2="2" y2="30"/>
`);

const sk_frenzy = icf(`
  <polygon points="18,4 22,15 30,15 23,21 26,32 18,26 10,32 13,21 6,15 14,15" stroke-width="1.6" fill="currentColor" fill-opacity="0.3"/>
  <line x1="18" y1="4" x2="18" y2="8" stroke-width="2.5"/>
  <line x1="26" y1="7" x2="24" y2="10" stroke-width="2.5"/>
  <line x1="10" y1="7" x2="12" y2="10" stroke-width="2.5"/>
`);

const sk_evasive = icf(`
  <path d="M6 24 Q14 12 26 18" stroke-width="2.2"/>
  <polygon points="26,18 20,14 21,22" fill="currentColor" stroke="none"/>
  <circle cx="6" cy="24" r="3" fill="none"/>
`);

const sk_silence = ic(`
  <path d="M14 10 L14 26 Q14 30 18 30 Q22 30 22 26 L22 10 L14 10 Z"/>
  <path d="M12 26 Q12 32 18 32 Q24 32 24 26"/>
  <line x1="10" y1="18" x2="8" y2="18"/>
  <line x1="28" y1="18" x2="26" y2="18"/>
  <line x1="26" y1="10" x2="30" y2="6"/>
  <line x1="30" y1="6" x2="28" y2="10"/>
`);

const sk_freeze = icf(`
  <line x1="18" y1="4" x2="18" y2="32"/>
  <line x1="4" y1="18" x2="32" y2="18"/>
  <line x1="8" y1="8" x2="28" y2="28"/>
  <line x1="28" y1="8" x2="8" y2="28"/>
  <circle cx="18" cy="18" r="4" fill="currentColor" fill-opacity="0.5"/>
  <circle cx="18" cy="4" r="2" fill="currentColor" stroke="none"/>
  <circle cx="18" cy="32" r="2" fill="currentColor" stroke="none"/>
  <circle cx="4" cy="18" r="2" fill="currentColor" stroke="none"/>
  <circle cx="32" cy="18" r="2" fill="currentColor" stroke="none"/>
`);

const sk_rend = ic(`
  <path d="M10 10 L16 18 L10 26"/>
  <path d="M20 10 L26 18 L20 26"/>
  <line x1="13" y1="14" x2="23" y2="22"/>
  <line x1="13" y1="22" x2="23" y2="14"/>
`);

const sk_focus = icf(`
  <circle cx="18" cy="18" r="3" fill="currentColor" stroke="none"/>
  <circle cx="18" cy="18" r="7"/>
  <circle cx="18" cy="18" r="12" stroke-opacity="0.45"/>
  <line x1="18" y1="4" x2="18" y2="10"/>
  <line x1="32" y1="18" x2="26" y2="18"/>
`);

const sk_aegis = icf(`
  <path d="M8 8 L18 4 L28 8 L28 20 Q28 30 18 34 Q8 30 8 20 Z" stroke-width="2.2"/>
  <path d="M13 17 L17 21 L25 13" stroke-width="2.5"/>
`);

const sk_charge = icf(`
  <polygon points="8,18 20,8 20,14 28,14 28,22 20,22 20,28" fill="currentColor" fill-opacity="0.75"/>
`);

const sk_weakening_bolt = icf(`
  <line x1="4" y1="18" x2="24" y2="18" stroke-width="2.2"/>
  <polygon points="24,18 19,14 19,22" fill="currentColor" stroke="none"/>
  <line x1="26" y1="14" x2="30" y2="18"/>
  <line x1="26" y1="22" x2="30" y2="18"/>
  <circle cx="30" cy="18" r="3" fill="currentColor" fill-opacity="0.5"/>
  <line x1="8" y1="14" x2="10" y2="12"/>
  <line x1="8" y1="22" x2="10" y2="24"/>
`);

const sk_shadow_strike = icf(`
  <path d="M4 32 L20 6 L22 14 L30 10 L18 32 L16 24 Z" fill="currentColor" fill-opacity="0.65" stroke-width="1.5"/>
`);

const sk_quick_draw = icf(`
  <ellipse cx="16" cy="18" rx="8" ry="6"/>
  <line x1="24" y1="18" x2="30" y2="18"/>
  <polygon points="30,18 26,15 26,21" fill="currentColor" stroke="none"/>
  <line x1="8" y1="12" x2="4" y2="8"/>
  <line x1="8" y1="24" x2="4" y2="28"/>
`);

const sk_counter_stance = ic(`
  <path d="M26 8 L30 18 L26 28"/>
  <line x1="6" y1="18" x2="26" y2="18"/>
  <path d="M10 12 L6 18 L10 24"/>
`);

const sk_blast = icf(`
  <circle cx="18" cy="18" r="5" fill="currentColor" fill-opacity="0.6"/>
  <line x1="18" y1="4" x2="18" y2="11"/>
  <line x1="18" y1="25" x2="18" y2="32"/>
  <line x1="4" y1="18" x2="11" y2="18"/>
  <line x1="25" y1="18" x2="32" y2="18"/>
  <line x1="9" y1="9" x2="13" y2="13"/>
  <line x1="27" y1="9" x2="23" y2="13"/>
  <line x1="9" y1="27" x2="13" y2="23"/>
  <line x1="27" y1="27" x2="23" y2="23"/>
`);

const sk_dbl_pummel = ic(`
  <circle cx="12" cy="18" r="6"/>
  <circle cx="24" cy="18" r="6"/>
  <line x1="6" y1="10" x2="10" y2="14"/>
  <line x1="30" y1="10" x2="26" y2="14"/>
`);

const sk_dye = icf(`
  <path d="M12 4 Q12 16 8 24 Q12 32 18 32 Q24 32 28 24 Q24 16 24 4"/>
  <line x1="12" y1="4" x2="24" y2="4"/>
  <line x1="18" y1="4" x2="18" y2="16"/>
  <circle cx="18" cy="20" r="3" fill="currentColor" fill-opacity="0.5"/>
`);

const sk_attune = icf(`
  <circle cx="18" cy="18" r="11"/>
  <circle cx="18" cy="18" r="5"/>
  <circle cx="18" cy="18" r="2" fill="currentColor" stroke="none"/>
  <line x1="18" y1="4" x2="18" y2="7"/>
  <line x1="29" y1="8" x2="27" y2="10"/>
  <line x1="32" y1="18" x2="29" y2="18"/>
`);

// ─────────────────────────────────────────────────────────
// 技能 — 群体 AOE
// ─────────────────────────────────────────────────────────

const sk_chain_bolt = icf(`
  <polyline points="12,6 15,16 10,16 18,30 15,20 22,20 14,4" stroke-width="2.5"/>
  <circle cx="26" cy="20" r="4"/>
  <line x1="21" y1="18" x2="23" y2="18"/>
`);

const sk_fire_wall = icf(`
  <path d="M5 32 Q5 24 9 20 Q7 26 11 23 Q9 17 15 13 Q13 21 17 19 Q15 13 21 9 Q19 17 23 15 Q21 9 27 7 Q25 17 29 19 Q31 32 5 32 Z" fill="currentColor" fill-opacity="0.55" stroke-width="1.5"/>
`);

const sk_shockwave = icf(`
  <circle cx="18" cy="18" r="4" fill="currentColor" fill-opacity="0.7"/>
  <circle cx="18" cy="18" r="9" stroke-opacity="0.7"/>
  <circle cx="18" cy="18" r="14" stroke-opacity="0.35"/>
`);

const sk_group_curse = icf(`
  <circle cx="18" cy="14" r="8"/>
  <path d="M12 10 Q18 6 24 10 Q18 18 12 10 Z" fill="currentColor" fill-opacity="0.55"/>
  <circle cx="10" cy="27" r="3"/>
  <circle cx="18" cy="29" r="3"/>
  <circle cx="26" cy="27" r="3"/>
`);

const sk_sonic = ic(`
  <path d="M6 11 Q2 18 6 25"/>
  <path d="M10 8 Q4 18 10 28"/>
  <line x1="14" y1="5" x2="14" y2="31"/>
  <path d="M18 8 Q24 18 18 28"/>
  <path d="M22 11 Q28 18 22 25"/>
  <path d="M26 14 Q30 18 26 22"/>
`);

const sk_mass_weak = ic(`
  <circle cx="9" cy="18" r="5"/>
  <circle cx="18" cy="18" r="5"/>
  <circle cx="27" cy="18" r="5"/>
  <line x1="9" y1="13" x2="9" y2="23"/>
  <line x1="18" y1="13" x2="18" y2="23"/>
  <line x1="27" y1="13" x2="27" y2="23"/>
`);

const sk_lightning = ic(`
  <polyline points="24,4 15,18 22,18 12,32" stroke-width="2.8"/>
`);

const sk_curse_vortex = icf(`
  <path d="M18 6 Q28 6 30 18 Q30 30 18 30 Q8 30 6 22 Q4 14 12 10"/>
  <polygon points="12,10 8,6 16,8" fill="currentColor" stroke="none"/>
  <circle cx="18" cy="18" r="4" fill="currentColor" fill-opacity="0.5"/>
`);

const sk_chroma_wave = ic(`
  <path d="M4 14 Q10 6 18 14 Q26 22 32 14"/>
  <path d="M4 18 Q10 10 18 18 Q26 26 32 18"/>
  <path d="M4 22 Q10 14 18 22 Q26 30 32 22"/>
`);

// 众神之怒（EPIC skill）：天空裂开 + 闪电劈下
const sk_wrath = icf(`
  <path d="M4 8 L10 12 L8 18 L14 20 L11 26 L16 28 L13 33" stroke-width="2.4"/>
  <polyline points="22,4 26,12 22,12 28,22 23,22 30,32" stroke-width="2.2"/>
  <line x1="6" y1="4" x2="14" y2="4" stroke-width="1.4"/>
  <line x1="22" y1="6" x2="32" y2="6" stroke-width="1.4"/>
`);

// ─────────────────────────────────────────────────────────
// 道具
// ─────────────────────────────────────────────────────────

const it_heal = icf(`
  <path d="M14 4 L14 10 Q8 14 8 23 Q8 32 18 32 Q28 32 28 23 Q28 14 22 10 L22 4 Z" stroke-width="2"/>
  <line x1="14" y1="4" x2="22" y2="4"/>
  <line x1="18" y1="17" x2="18" y2="27"/>
  <line x1="14" y1="22" x2="22" y2="22"/>
`);

const it_purify = icf(`
  <path d="M14 4 L14 10 Q8 14 8 23 Q8 32 18 32 Q28 32 28 23 Q28 14 22 10 L22 4 Z" stroke-width="2"/>
  <line x1="14" y1="4" x2="22" y2="4"/>
  <path d="M12 22 L16 26 L25 16" stroke-width="2.5"/>
`);

const it_whetstone = ic(`
  <rect x="7" y="14" width="22" height="10" rx="3"/>
  <line x1="10" y1="24" x2="26" y2="14" stroke-width="2.5"/>
  <path d="M7 14 Q18 10 29 14"/>
`);

const it_regroup = icf(`
  <path d="M18 8 Q28 8 28 18 Q28 26 20 28" stroke-width="2.2"/>
  <path d="M18 28 Q8 28 8 18 Q8 10 16 8" stroke-width="2.2"/>
  <polygon points="18,4 14,10 22,10" fill="currentColor" stroke="none"/>
  <polygon points="18,32 22,26 14,26" fill="currentColor" stroke="none"/>
`);

const it_bomb = icf(`
  <circle cx="16" cy="23" r="10"/>
  <line x1="23" y1="14" x2="28" y2="9"/>
  <path d="M26 10 Q30 6 28 8" stroke-width="2.5"/>
  <circle cx="16" cy="23" r="4" fill="currentColor" fill-opacity="0.45" stroke="none"/>
`);

const it_elixir = icf(`
  <path d="M14 4 L14 10 Q8 14 8 23 Q8 32 18 32 Q28 32 28 23 Q28 14 22 10 L22 4 Z" stroke-width="2"/>
  <line x1="14" y1="4" x2="22" y2="4"/>
  <circle cx="18" cy="22" r="5" fill="currentColor" fill-opacity="0.4"/>
  <line x1="18" y1="10" x2="18" y2="15"/>
`);

// 复读机（EPIC item）：两个重叠的回环箭头
const it_echo = icf(`
  <path d="M8 14 Q8 6 18 6 Q28 6 28 14" stroke-width="2"/>
  <polyline points="28,14 28,9 33,12" stroke-width="1.6"/>
  <path d="M28 22 Q28 30 18 30 Q8 30 8 22" stroke-width="2"/>
  <polyline points="8,22 8,27 3,24" stroke-width="1.6"/>
`);

// ─────────────────────────────────────────────────────────
// 特性
// ─────────────────────────────────────────────────────────

const p_bleed = icf(`
  <path d="M18 4 Q23 10 23 18 Q23 26 18 30 Q13 26 13 18 Q13 10 18 4 Z" fill="currentColor" fill-opacity="0.6"/>
  <path d="M18 30 Q20 32 18 34 Q16 32 18 30 Z" fill="currentColor" stroke="none"/>
`);

const p_dodge = icf(`
  <path d="M6 26 Q14 12 24 18" stroke-width="2.2"/>
  <polygon points="24,18 19,14 20,22" fill="currentColor" stroke="none"/>
  <circle cx="6" cy="26" r="3.5" fill="none"/>
  <line x1="28" y1="10" x2="32" y2="10"/>
  <line x1="28" y1="14" x2="32" y2="10"/>
  <line x1="28" y1="6" x2="32" y2="10"/>
`);

const p_regen = icf(`
  <path d="M18 10 Q27 10 28 18 Q28 27 19 28" stroke-width="2.2"/>
  <path d="M19 28 Q9 29 8 20 Q7 11 16 10" stroke-width="2.2"/>
  <polygon points="16,6 12,12 20,12" fill="currentColor" stroke="none"/>
  <circle cx="18" cy="18" r="4" fill="currentColor" fill-opacity="0.5"/>
`);

const p_crit = icf(`
  <polygon points="18,4 20,14 30,14 22,20 25,30 18,24 11,30 14,20 6,14 16,14" fill="currentColor" fill-opacity="0.6" stroke-width="1.8"/>
`);

const p_tough = ic(`
  <path d="M8 28 L8 14 Q8 6 18 6 Q28 6 28 14 L28 28"/>
  <line x1="4" y1="28" x2="32" y2="28"/>
  <path d="M12 14 Q12 10 18 10 Q24 10 24 14"/>
  <line x1="18" y1="10" x2="18" y2="28"/>
`);

const p_vampire = icf(`
  <path d="M18 30 Q8 22 8 16 Q8 8 18 6 Q28 8 28 16 Q28 22 18 30 Z"/>
  <path d="M14 16 Q16 12 18 14"/>
  <path d="M22 16 Q20 12 18 14"/>
  <line x1="18" y1="14" x2="18" y2="22"/>
`);

const p_thorns = ic(`
  <line x1="18" y1="32" x2="18" y2="6"/>
  <line x1="18" y1="12" x2="12" y2="6"/>
  <line x1="18" y1="12" x2="24" y2="6"/>
  <line x1="18" y1="18" x2="10" y2="12"/>
  <line x1="18" y1="18" x2="26" y2="12"/>
  <line x1="18" y1="24" x2="12" y2="18"/>
  <line x1="18" y1="24" x2="24" y2="18"/>
`);

const p_iron_will = icf(`
  <path d="M8 8 L18 4 L28 8 L28 22 Q28 30 18 34 Q8 30 8 22 Z" stroke-width="2.2"/>
  <path d="M18 12 Q22 16 18 24 Q14 16 18 12 Z" fill="currentColor" fill-opacity="0.7"/>
`);

const p_lifetap = icf(`
  <path d="M18 26 Q8 20 8 14 Q8 8 13 8 Q16 8 18 12 Q20 8 23 8 Q28 8 28 14 Q28 20 18 26 Z"/>
  <line x1="18" y1="26" x2="18" y2="34"/>
  <polygon points="18,34 15,30 21,30" fill="currentColor" stroke="none"/>
`);

const p_overload = icf(`
  <polyline points="23,4 15,18 21,18 13,32" stroke-width="3"/>
  <circle cx="23" cy="4" r="2.5" fill="currentColor" stroke="none"/>
  <circle cx="13" cy="32" r="2.5" fill="currentColor" stroke="none"/>
`);

const p_executioner = icf(`
  <rect x="14" y="4" width="8" height="20" rx="1.5"/>
  <path d="M10 24 Q14 20 18 24 Q22 20 26 24 L24 32 L12 32 Z" fill="currentColor" fill-opacity="0.6"/>
  <line x1="10" y1="8" x2="14" y2="8"/>
  <line x1="10" y1="4" x2="10" y2="12"/>
`);

const p_resonance = ic(`
  <circle cx="18" cy="18" r="11"/>
  <circle cx="18" cy="18" r="5"/>
  <path d="M14 14 Q14 22 18 22"/>
  <path d="M18 22 Q22 22 22 14"/>
  <line x1="22" y1="14" x2="26" y2="14"/>
  <line x1="26" y1="14" x2="26" y2="22"/>
`);

const p_coldblood = icf(`
  <path d="M18 4 L20 13 L28 9 L23 17 L31 20 L22 21 L24 30 L18 25 L12 30 L14 21 L5 20 L13 17 L8 9 L16 13 Z" stroke-width="1.8" fill="currentColor" fill-opacity="0.35"/>
`);

// ─────────────────────────────────────────────────────────
// 分类 fallback
// ─────────────────────────────────────────────────────────

const CAT_ICONS: Record<string, string> = {
  // 传统刀剑：直刃 + 护手 + 剑柄
  attack: icf(`
    <line x1="18" y1="2" x2="18" y2="26" stroke-width="3"/>
    <rect x="10" y="22" width="16" height="3" rx="1.5" fill="currentColor" stroke="none"/>
    <line x1="18" y1="26" x2="18" y2="34" stroke-width="2.5"/>
    <ellipse cx="18" cy="34" rx="3.5" ry="2.5" fill="currentColor" stroke="none"/>
    <polygon points="18,2 21,10 18,8 15,10" fill="currentColor" stroke="none"/>
  `),
  skill: icf(`
    <polygon points="18,4 20,13 29,13 22,19 25,28 18,23 11,28 14,19 7,13 16,13" fill="currentColor" fill-opacity="0.5" stroke-width="1.8"/>
  `),
  item: ic(`
    <path d="M14 4 L14 10 Q8 14 8 23 Q8 32 18 32 Q28 32 28 23 Q28 14 22 10 L22 4 Z" stroke-width="2"/>
    <line x1="14" y1="4" x2="22" y2="4"/>
  `),
  equipment: ic(`
    <path d="M8 8 L18 4 L28 8 L28 22 Q28 32 18 34 Q8 32 8 22 Z" stroke-width="2.2"/>
  `),
  perk: icf(`
    <polygon points="18,4 21,14 31,14 23,20 26,30 18,25 10,30 13,20 5,14 15,14" fill="currentColor" fill-opacity="0.5" stroke-width="1.8"/>
  `),
};

// ─────────────────────────────────────────────────────────
// 主映射表
// ─────────────────────────────────────────────────────────

const CARD_ICONS: Record<string, string> = {
  // 武器
  short_sword, long_sword, dagger, war_bow, twin_blades, warhammer,
  battle_staff, chain_whip, berserker_blade, wizard_staff, repeating_bow,
  // 新加武器 + EPIC 武器（之前漏 → 回退到通用 equipment 盾牌图标）
  raider, blood_blade, excalibur, divine_blade,
  // 流派资源补全 4 张
  vampire_fang, lifebloom_staff, knight_plate,
  // 流派资源补全 v2 (10 张)
  flying_darts, shield_staff, wind_blade, everlast_fang, forbidden_scepter,
  combat_belt, soulreaver_plate, immortal_plate, life_pouch, phantom_cloak,
  // 防具
  round_shield, leather_armor, spike_armor, heavy_armor, mage_robe,
  cloak, full_plate, scale_mail, mind_armor,
  // EPIC 防具
  undying_heart,
  // 技能
  sk_poison_blade, sk_battle_cry, sk_frenzy, sk_evasive, sk_silence,
  sk_freeze, sk_rend, sk_focus, sk_aegis, sk_charge, sk_weakening_bolt,
  sk_shadow_strike, sk_quick_draw, sk_counter_stance, sk_blast,
  sk_dbl_pummel, sk_dye, sk_attune,
  sk_chain_bolt, sk_fire_wall, sk_shockwave, sk_group_curse, sk_sonic,
  sk_mass_weak, sk_lightning, sk_curse_vortex, sk_chroma_wave,
  // EPIC 技能
  sk_wrath,
  // 道具
  it_heal, it_purify, it_whetstone, it_regroup, it_bomb, it_elixir,
  // EPIC 道具
  it_echo,
  // 特性
  p_bleed, p_dodge, p_regen, p_crit, p_tough, p_vampire, p_thorns,
  p_iron_will, p_lifetap, p_overload, p_executioner, p_resonance, p_coldblood,
};

export function getCardIcon(defId: string, category: string): string {
  return CARD_ICONS[defId] ?? CAT_ICONS[category] ?? CAT_ICONS["skill"];
}
