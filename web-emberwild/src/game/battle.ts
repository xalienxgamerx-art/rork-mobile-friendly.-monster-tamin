import { BIOMES, ELEMENTS, ITEMS, PERSONALITIES, SKILLS, SPECIES, STATUSES, elementMult, type SkillDef } from "./data";
import { createMonster, displayName, grantXp, rollMutations, statOf } from "./monster";
import { Rng, clamp, hash2, hash3, hashString, rngNext } from "./rng";
import { addLog, compass, loadChunks, recruit } from "./sim";
import type {
  BLogKind, BStatus, BTile, BUnit, BattleState, BattleSummary, GameState, ItemId, Monster, StatusId, Terrain, WildCreature,
} from "./types";
import { getWorld, timeOf } from "./world";

export const B_COLS = 11;
export const B_ROWS = 9;

const FLAMMABLE: Partial<Record<Terrain, number>> = { grass: 0.16, tallgrass: 0.32, flowers: 0.22, tree: 0.12, gloom: 0.08 };
const BLOCKING: Terrain[] = ["tree", "rock"];

export const TERRAIN_INFO: Record<Terrain, { name: string; desc: string }> = {
  grass: { name: "Grass", desc: "Flammable." },
  tallgrass: { name: "Tall Grass", desc: "+2 DV to anything hiding in it. Very flammable." },
  flowers: { name: "Wildflowers", desc: "Flammable." },
  water: { name: "Water", desc: "Only swimmers and fliers can enter. Soaks. Douses fire." },
  mud: { name: "Mud", desc: "Costs 2 movement." },
  rock: { name: "Boulder", desc: "Blocks movement and line of sight." },
  tree: { name: "Tree", desc: "Blocks movement and line of sight. Burns slowly." },
  sand: { name: "Sand", desc: "Open ground." },
  snow: { name: "Snow", desc: "Costs 2 movement unless frost-coated." },
  ash: { name: "Ash", desc: "Burnt ground. Won't burn again." },
  gloom: { name: "Gloom", desc: "-2 to hit for anything not of shadow." },
};

/* ----------------------------------- RNG ------------------------------------ */

const rnd = (b: BattleState): number => {
  const [v, s] = rngNext(b.rng);
  b.rng = s;
  return v;
};
const rint = (b: BattleState, a: number, z: number): number => a + Math.floor(rnd(b) * (z - a + 1));
const dice = (b: BattleState, n: number, s: number): number => {
  let t = 0;
  for (let i = 0; i < n; i++) t += rint(b, 1, s);
  return t;
};

/* --------------------------------- Helpers ---------------------------------- */

export const unitName = (u: BUnit): string => (u.side === "wild" ? `the ${displayName(u.mon)}` : displayName(u.mon));
const capName = (u: BUnit): string => {
  const n = unitName(u);
  return n.charAt(0).toUpperCase() + n.slice(1);
};
export const tileAt = (b: BattleState, x: number, y: number): BTile | null =>
  x < 0 || y < 0 || x >= b.cols || y >= b.rows ? null : b.tiles[y * b.cols + x];
export const unitAt = (b: BattleState, x: number, y: number): BUnit | null =>
  b.units.find((u) => u.state === "active" && u.x === x && u.y === y) ?? null;
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
export const hasStatus = (u: BUnit, s: StatusId): boolean => u.statuses.some((x) => x.id === s);
export const currentUnit = (b: BattleState): BUnit | null => b.units.find((u) => u.id === b.order[b.turn]) ?? null;
const speciesOf = (u: BUnit) => SPECIES[u.mon.speciesId];
const hasTrait = (u: BUnit, t: string): boolean => (speciesOf(u).traits as string[]).includes(t);

function log(b: BattleState, text: string, kind: BLogKind = "info"): void {
  b.logSeq += 1;
  b.log.push({ id: b.logSeq, text, kind, round: b.round });
  if (b.log.length > 120) b.log.splice(0, b.log.length - 120);
}

function fx(b: BattleState, u: BUnit | null, x: number, y: number, text: string, color: string): void {
  b.fxSeq += 1;
  b.fx.push({ id: b.fxSeq, x, y, text, color, unitId: u?.id ?? null });
  if (b.fx.length > 16) b.fx.splice(0, b.fx.length - 16);
}

function addStatus(b: BattleState, u: BUnit, id: StatusId, turns: number): boolean {
  if (id === "burning" && (hasTrait(u, "sunborn") || hasStatus(u, "soaked"))) return false;
  if (id === "rooted" && hasTrait(u, "slick")) return false;
  if (id === "soaked") u.statuses = u.statuses.filter((s) => s.id !== "burning");
  const ex = u.statuses.find((s) => s.id === id);
  if (ex) ex.turns = Math.max(ex.turns, turns);
  else u.statuses.push({ id, turns });
  fx(b, u, u.x, u.y, STATUSES[id].name, STATUSES[id].color);
  return true;
}

export function statsFor(u: BUnit) {
  return { atk: statOf(u.mon, "atk"), def: statOf(u.mon, "def"), agi: statOf(u.mon, "agi"), wis: statOf(u.mon, "wis") };
}

export function dvOf(b: BattleState, u: BUnit): number {
  const s = statsFor(u);
  let dv = 6 + Math.floor(s.agi / 4);
  const t = tileAt(b, u.x, u.y);
  if (t?.t === "tallgrass") dv += 2;
  if (hasStatus(u, "wary")) dv += 3;
  if (hasStatus(u, "veiled")) dv += 4;
  if (hasStatus(u, "stunned") || hasStatus(u, "rooted")) dv -= 3;
  if (b.night && hasTrait(u, "night_eyes")) dv += 3;
  return dv;
}

export function avOf(u: BUnit): number {
  const s = statsFor(u);
  let av = Math.floor(s.def / 5);
  if (hasStatus(u, "shelled")) av += 4;
  if (hasTrait(u, "stoneskin")) av += 2;
  if (hasTrait(u, "slick")) av += 1;
  return av;
}

export function moveRange(u: BUnit): number {
  if (hasStatus(u, "rooted") || hasStatus(u, "stunned")) return 0;
  const agi = statOf(u.mon, "agi");
  return clamp(2 + Math.floor(agi / 9), 2, 5) - (hasStatus(u, "slowed") ? 1 : 0);
}

function canStand(b: BattleState, u: BUnit, x: number, y: number): boolean {
  const t = tileAt(b, x, y);
  if (!t) return false;
  if (BLOCKING.includes(t.t)) return false;
  if (t.t === "water") return speciesOf(u).swims || hasTrait(u, "flutter");
  return true;
}

function stepCost(b: BattleState, u: BUnit, x: number, y: number): number {
  const t = tileAt(b, x, y);
  if (!t) return 99;
  if (hasTrait(u, "flutter")) return 1;
  if (t.t === "mud") return 2;
  if (t.t === "snow" && !hasTrait(u, "frost_coat")) return 2;
  if (t.t === "water") return speciesOf(u).swims ? 1 : 2;
  return 1;
}

/** Tiles reachable this turn with their movement cost. */
export function reachable(b: BattleState, u: BUnit): Map<number, number> {
  const out = new Map<number, number>();
  const range = b.moved && u.side === "party" ? 0 : moveRange(u);
  out.set(u.y * b.cols + u.x, 0);
  const q: [number, number, number][] = [[u.x, u.y, 0]];
  while (q.length) {
    const [x, y, c] = q.shift() as [number, number, number];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!canStand(b, u, nx, ny)) continue;
        const occ = unitAt(b, nx, ny);
        if (occ && occ !== u) continue;
        const nc = c + stepCost(b, u, nx, ny);
        if (nc > range) continue;
        const k = ny * b.cols + nx;
        if ((out.get(k) ?? 99) <= nc) continue;
        out.set(k, nc);
        q.push([nx, ny, nc]);
      }
    }
  }
  return out;
}

export function lineOfSight(b: BattleState, x0: number, y0: number, x1: number, y1: number): boolean {
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === x1 && y === y1) break;
    const t = tileAt(b, x, y);
    if (t && BLOCKING.includes(t.t)) return false;
  }
  return true;
}

export function skillReady(u: BUnit, id: string): boolean {
  return (u.cooldowns[id] ?? 0) <= 0;
}

/** Valid target tiles for a skill cast from (fx, fy). */
export function skillTargets(b: BattleState, u: BUnit, skillId: string, fx0 = u.x, fy0 = u.y): [number, number][] {
  const sk = SKILLS[skillId];
  const out: [number, number][] = [];
  if (sk.target === "self") return [[fx0, fy0]];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      const d = dist(fx0, fy0, x, y);
      if (d > sk.range || (sk.target !== "tile" && d === 0 && sk.target !== "ally")) continue;
      if (sk.range > 1 && !lineOfSight(b, fx0, fy0, x, y)) continue;
      const t = unitAt(b, x, y);
      if (sk.target === "enemy" && (!t || t.side === u.side)) continue;
      if (sk.target === "ally" && (!t || t.side !== u.side)) continue;
      if (sk.target === "tile" && d === 0) continue;
      out.push([x, y]);
    }
  }
  return out;
}

export function affectedTiles(b: BattleState, u: BUnit, skillId: string, tx: number, ty: number): [number, number][] {
  const sk = SKILLS[skillId];
  if (sk.radius <= 0) return [[tx, ty]];
  const cx = sk.target === "self" ? u.x : tx;
  const cy = sk.target === "self" ? u.y : ty;
  const out: [number, number][] = [];
  for (let y = cy - sk.radius; y <= cy + sk.radius; y++) {
    for (let x = cx - sk.radius; x <= cx + sk.radius; x++) {
      if (!tileAt(b, x, y)) continue;
      if (sk.target === "self" && x === cx && y === cy && !sk.heal) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/* -------------------------------- Battle setup ------------------------------ */

function buildTerrain(gs: GameState, wx: number, wy: number, seed: number): BTile[] {
  const world = getWorld(gs.seed);
  const tiles: BTile[] = [];
  for (let y = 0; y < B_ROWS; y++) {
    for (let x = 0; x < B_COLS; x++) {
      const sx = wx + Math.round((x - (B_COLS - 1) / 2) / 4);
      const sy = wy + Math.round((y - (B_ROWS - 1) / 2) / 4);
      const biome = world.tile(sx, sy).biome;
      const r = hash2(seed, x, y) / 4294967296;
      const r2 = hash2(seed ^ 0x55, x, y) / 4294967296;
      let t: Terrain = "grass";
      switch (biome) {
        case "forest": t = r < 0.13 ? "tree" : r < 0.3 ? "tallgrass" : r < 0.36 ? "flowers" : "grass"; break;
        case "taiga": t = r < 0.15 ? "tree" : r < 0.22 ? "rock" : r < 0.32 ? "snow" : "grass"; break;
        case "gloomwood": t = r < 0.14 ? "tree" : r < 0.55 ? "gloom" : r < 0.65 ? "tallgrass" : "grass"; break;
        case "meadow": t = r < 0.2 ? "flowers" : r < 0.38 ? "tallgrass" : r < 0.41 ? "rock" : "grass"; break;
        case "marsh": t = r < 0.18 ? "water" : r < 0.48 ? "mud" : r < 0.66 ? "tallgrass" : "grass"; break;
        case "river": t = Math.abs(y - (B_ROWS - 1) / 2 + Math.round(Math.sin(x * 0.7 + seed) * 1)) <= 1 && r2 > 0.18 ? "water" : r < 0.2 ? "tallgrass" : r < 0.3 ? "mud" : "grass"; break;
        case "beach": t = r < 0.08 ? "rock" : r < 0.14 ? "water" : "sand"; break;
        case "steppe": t = r < 0.3 ? "tallgrass" : r < 0.34 ? "rock" : "grass"; break;
        case "desert": t = r < 0.1 ? "rock" : "sand"; break;
        case "tundra": t = r < 0.3 ? "snow" : r < 0.38 ? "rock" : "grass"; break;
        case "snow": t = r < 0.1 ? "rock" : "snow"; break;
        case "hills": t = r < 0.12 ? "rock" : r < 0.3 ? "tallgrass" : r < 0.36 ? "flowers" : "grass"; break;
        case "mountain": t = r < 0.22 ? "rock" : r < 0.35 ? "snow" : "sand"; break;
        case "sea": case "lake": case "deep": t = "water"; break;
        default: t = "grass";
      }
      tiles.push({ t, fire: 0 });
    }
  }
  return tiles;
}

/** Builds the deterministic monster stats for a wild creature (used by battle and inspector). */
export function wildMonster(gs: GameState, c: WildCreature): Monster {
  const world = getWorld(gs.seed);
  const gloom = world.tile(c.homeX, c.homeY).biome === "gloomwood";
  const temp = { uidSeq: 0, tick: gs.tick } as GameState;
  const m = createMonster(temp, c.speciesId, c.level, {
    seed: c.geneSeed,
    personality: c.personality,
    mutations: rollMutations(new Rng(c.geneSeed ^ 0x77), gloom),
    origin: "Wild",
  });
  m.uid = `w_${c.id}`;
  m.hp = Math.max(1, Math.round(statOf(m, "hp") * c.hpFrac));
  m.satiety = c.satiety;
  if (c.alpha) m.plus = 3;
  return m;
}

function findFree(b: BattleState, u: BUnit, xs: number[], seedOff: number): [number, number] {
  const ys = Array.from({ length: b.rows }, (_, i) => i).sort((a, z) => Math.abs(a - 4) - Math.abs(z - 4) + (hash2(seedOff, a, z) % 3) - 1);
  for (const x of xs) for (const y of ys) if (canStand(b, u, x, y) && !unitAt(b, x, y)) return [x, y];
  for (let y = 0; y < b.rows; y++) for (let x = 0; x < b.cols; x++) if (canStand(b, u, x, y) && !unitAt(b, x, y)) return [x, y];
  return [0, 0];
}

/** Opens a tactical battle against a wild creature (and any nearby packmates). */
export function startBattle(gs: GameState, creatureId: string, ambush: boolean): void {
  const world = getWorld(gs.seed);
  const target = gs.creatures[creatureId];
  if (!target) return;
  const seed = hash3(gs.seed, gs.tick, target.x, target.y);
  const wx = target.x;
  const wy = target.y;
  const time = timeOf(gs.tick);
  const wthr = world.weather(gs.player.x, gs.player.y, gs.tick);
  const tile = world.tile(wx, wy);
  const b: BattleState = {
    seed, rng: seed, worldX: wx, worldY: wy, biome: tile.biome, weather: wthr.id, night: time.night,
    regionName: world.tileTitle(tile), origin: gs.player.origin,
    cols: B_COLS, rows: B_ROWS, tiles: buildTerrain(gs, wx, wy, seed), units: [], order: [], turn: 0, round: 1,
    phase: "player", moved: false, acted: false, mode: "move", skill: null, item: null, plan: null,
    log: [], logSeq: 0, fx: [], fxSeq: 0, auto: false, summary: null, ambush,
    lairKey: target.alpha ? creatureId : null, focus: null,
  };
  const foes: WildCreature[] = [target];
  for (const id in gs.creatures) {
    const c = gs.creatures[id];
    if (c === target || foes.length >= 3) continue;
    if (dist(c.x, c.y, target.x, target.y) > 3) continue;
    const pack = c.speciesId === target.speciesId || (c.disposition === "aggressive" && c.calmUntil <= gs.tick);
    if (pack && c.activity !== "Sleeping") foes.push(c);
  }
  const partyCols = ambush ? [3, 2, 4, 1] : [1, 2, 0];
  const wildCols = ambush ? [6, 7, 5, 8] : [B_COLS - 2, B_COLS - 3, B_COLS - 1];
  gs.party.forEach((m, i) => {
    const u: BUnit = { id: `p${i}`, side: "party", mon: { ...m, genes: { ...m.genes }, skills: [...m.skills], mutations: [...m.mutations] }, x: 0, y: 0, hp: m.hp, maxHp: statOf(m, "hp"), statuses: [], cooldowns: {}, init: 0, state: m.hp > 0 ? "active" : "down", tameBonus: 0, creatureId: null };
    if (u.state === "active") [u.x, u.y] = findFree(b, u, partyCols, seed + i);
    else [u.x, u.y] = [-1, -1];
    b.units.push(u);
  });
  foes.forEach((c, i) => {
    const mon = wildMonster(gs, c);
    const u: BUnit = { id: `w${i}`, side: "wild", mon, x: 0, y: 0, hp: mon.hp, maxHp: statOf(mon, "hp"), statuses: [], cooldowns: {}, init: 0, state: "active", tameBonus: Math.max(0, c.affection) / 250, creatureId: c.id };
    [u.x, u.y] = findFree(b, u, wildCols, seed + 99 + i);
    b.units.push(u);
    gs.seen[c.speciesId] = true;
  });
  const asleep = !ambush && target.activity === "Sleeping";
  for (const u of b.units) {
    u.init = statOf(u.mon, "agi") + dice(b, 1, 8) + (ambush && u.side === "wild" ? 6 : 0) + (asleep && u.side === "wild" ? -8 : 0) + (b.night && hasTrait(u, "night_eyes") ? 3 : 0);
  }
  b.order = b.units.filter((u) => u.state === "active").sort((a, z) => z.init - a.init).map((u) => u.id);
  gs.stats.battles += 1;
  const names = foes.map((c) => `${c.alpha ? "a great " : "a "}${SPECIES[c.speciesId].name} (Lv ${c.level})`);
  const where = `${b.regionName}${b.night ? ", at night" : ""}${b.weather !== "clear" && b.weather !== "cloudy" ? `, in the ${b.weather}` : ""}`;
  if (asleep) log(b, `You catch the ${SPECIES[target.speciesId].name} sleeping!`, "good");
  log(b, ambush ? `Ambush! ${names.join(" and ")} burst${foes.length > 1 ? "" : "s"} from cover. ${where}.` : `You engage ${names.join(" and ")}. ${where}.`, ambush ? "bad" : "info");
  addLog(gs, ambush ? `You are ambushed by ${names.join(" and ")}!` : `You challenge ${names.join(" and ")}.`, "combat");
  gs.battle = b;
  b.turn = -1;
  nextTurn(gs);
}

/* ------------------------------- Turn engine -------------------------------- */

export function checkEnd(gs: GameState): boolean {
  const b = gs.battle;
  if (!b || b.phase === "over") return true;
  const wildLeft = b.units.some((u) => u.side === "wild" && u.state === "active");
  const partyLeft = b.units.some((u) => u.side === "party" && u.state === "active");
  if (!wildLeft) {
    concludeBattle(gs, "won");
    return true;
  }
  if (!partyLeft) {
    concludeBattle(gs, "lost");
    return true;
  }
  return false;
}

function damage(b: BattleState, u: BUnit, amount: number, color = "#ff6b5a"): void {
  u.hp = Math.max(0, u.hp - amount);
  fx(b, u, u.x, u.y, `-${amount}`, color);
  if (u.hp <= 0) {
    u.state = "down";
    log(b, `${capName(u)} ${u.side === "wild" ? "collapses" : "faints"}!`, u.side === "wild" ? "good" : "bad");
  }
}

function heal(b: BattleState, u: BUnit, amount: number): number {
  const before = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + amount);
  const got = u.hp - before;
  if (got > 0) fx(b, u, u.x, u.y, `+${got}`, "#7be08a");
  return got;
}

function roundEffects(gs: GameState): void {
  const b = gs.battle as BattleState;
  const raining = b.weather === "rain" || b.weather === "storm" || b.weather === "snow";
  const ignite: number[] = [];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      const t = b.tiles[y * b.cols + x];
      if (t.fire <= 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
          const n = tileAt(b, x + dx, y + dy);
          if (!n || n.fire > 0) continue;
          const p = (FLAMMABLE[n.t] ?? 0) * (raining ? 0.25 : 1);
          if (p > 0 && rnd(b) < p) ignite.push((y + dy) * b.cols + x + dx);
        }
      }
      t.fire -= 1;
      if (raining && rnd(b) < 0.4) t.fire = 0;
      if (t.fire <= 0) {
        t.fire = 0;
        if (t.t !== "water" && t.t !== "rock" && t.t !== "sand" && t.t !== "snow") t.t = "ash";
      }
    }
  }
  let spread = 0;
  for (const k of ignite) {
    const t = b.tiles[k];
    if (t.fire > 0) continue;
    t.fire = t.t === "tree" ? 4 : 2;
    spread++;
  }
  if (spread > 2) log(b, "The fire spreads through the dry growth!", "bad");
  b.round += 1;
}

function startOfTurn(gs: GameState, u: BUnit): boolean {
  const b = gs.battle as BattleState;
  const t = tileAt(b, u.x, u.y);
  if (t && t.fire > 0) {
    if (addStatus(b, u, "burning", 2) && !hasStatus(u, "burning")) log(b, `${capName(u)} is standing in flames!`, "bad");
  }
  if (t?.t === "water" && !hasStatus(u, "soaked")) addStatus(b, u, "soaked", 2);
  for (const s of [...u.statuses]) {
    if (s.id === "burning") {
      const d = dice(b, 1, 4) + 1;
      log(b, `${capName(u)} burns for ${d}.`, "status");
      damage(b, u, d, "#e8742a");
    } else if (s.id === "poisoned") {
      const d = dice(b, 1, 3);
      log(b, `Poison courses through ${unitName(u)}. (${d})`, "status");
      damage(b, u, d, "#8bc34a");
    }
    if (u.state !== "active") return false;
  }
  if (hasTrait(u, "photosynth") && !b.night && b.weather !== "storm") heal(b, u, 2);
  if (hasTrait(u, "mossy_shell") && (b.weather === "rain" || t?.t === "grass" || t?.t === "tallgrass")) heal(b, u, 1);
  for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
  const stunned = hasStatus(u, "stunned");
  u.statuses = u.statuses.map((s) => ({ ...s, turns: s.turns - 1 } as BStatus)).filter((s) => s.turns > 0);
  if (stunned) {
    log(b, `${capName(u)} is stunned and loses its turn.`, "status");
    return false;
  }
  return true;
}

/** Advances to the next active unit, processing status ticks and round changes. */
export function nextTurn(gs: GameState): void {
  const b = gs.battle;
  if (!b) return;
  for (let guard = 0; guard < 40; guard++) {
    if (checkEnd(gs)) return;
    b.turn += 1;
    if (b.turn >= b.order.length) {
      b.turn = 0;
      roundEffects(gs);
      if (checkEnd(gs)) return;
    }
    const u = currentUnit(b);
    if (!u || u.state !== "active") continue;
    b.moved = false;
    b.acted = false;
    b.mode = "move";
    b.skill = null;
    b.item = null;
    b.plan = null;
    b.focus = u.id;
    const canAct = startOfTurn(gs, u);
    if (checkEnd(gs)) return;
    if (!canAct || u.state !== "active") continue;
    b.phase = u.side === "party" && !b.auto ? "player" : "enemy";
    return;
  }
}

/* --------------------------------- Actions ---------------------------------- */

interface HitResult {
  hit: boolean;
  crit: boolean;
  roll: number;
  bonus: number;
  dv: number;
}

/** To-hit bonus, target DV and resulting hit chance for a skill (pure, no RNG). */
export function hitInfo(b: BattleState, a: BUnit, d: BUnit, skillId: string): { bonus: number; dv: number; chance: number } {
  const sk = SKILLS[skillId];
  const bonus = hitBonus(b, a, d, sk);
  const dv = dvOf(b, d);
  let n = 1;
  for (let r = 2; r <= 19; r++) if (r + bonus >= dv) n++;
  return { bonus, dv, chance: n / 20 };
}

function hitBonus(b: BattleState, a: BUnit, d: BUnit, sk: SkillDef): number {
  let bonus = sk.acc + Math.floor(statOf(a.mon, "agi") / 5);
  if (hasStatus(a, "blinded")) bonus -= 5;
  if (b.night && hasTrait(a, "night_eyes")) bonus += 3;
  const tt = tileAt(b, a.x, a.y);
  if (tt?.t === "gloom" && sk.element !== "shadow") bonus -= 2;
  if (b.units.some((o) => o.side === a.side && o !== a && o.state === "active" && hasTrait(o, "regal") && dist(o.x, o.y, a.x, a.y) <= 1)) bonus += 1;
  if (b.weather === "fog" && dist(a.x, a.y, d.x, d.y) > 1) bonus -= 2;
  return bonus;
}

function rollHit(b: BattleState, a: BUnit, d: BUnit, sk: SkillDef): HitResult {
  const roll = rint(b, 1, 20);
  const bonus = hitBonus(b, a, d, sk);
  const dv = dvOf(b, d);
  const crit = roll === 20;
  const hit = crit || (roll !== 1 && roll + bonus >= dv);
  return { hit, crit, roll, bonus, dv };
}

function elementalMult(b: BattleState, a: BUnit, d: BUnit, sk: SkillDef): number {
  let m = elementMult(sk.element, speciesOf(d).element);
  if (sk.element !== "neutral" && sk.element === speciesOf(a).element) m *= 1.2;
  if (sk.element === "fire" && hasTrait(a, "sunborn")) m *= 1.25;
  if (sk.element === "fire" && hasStatus(d, "soaked")) m *= 0.5;
  if (sk.element === "frost" && hasStatus(d, "soaked")) m *= 1.5;
  if (sk.element === "frost" && hasTrait(d, "frost_coat")) m *= 0.5;
  if ((b.weather === "rain" || b.weather === "storm") && sk.element === "fire") m *= 0.75;
  if ((b.weather === "rain" || b.weather === "storm") && sk.element === "water") m *= 1.15;
  if (b.weather === "snow" && sk.element === "frost") m *= 1.15;
  return m;
}

function strike(gs: GameState, a: BUnit, d: BUnit, skillId: string, aoe: boolean): void {
  const b = gs.battle as BattleState;
  const sk = SKILLS[skillId];
  const h = rollHit(b, a, d, sk);
  const hitText = `[${h.roll}${h.bonus >= 0 ? "+" : ""}${h.bonus} vs DV ${h.dv}]`;
  if (!h.hit) {
    log(b, `${capName(a)} ${sk.verb} ${unitName(d)} but misses. ${hitText}`, "miss");
    fx(b, d, d.x, d.y, "miss", "#c9b99a");
    return;
  }
  let total = 0;
  let pens = 0;
  if (sk.dice[0] > 0) {
    let pv = Math.floor(statOf(a.mon, "atk") / 4) + sk.pen + (h.crit ? 2 : 0);
    const av = avOf(d);
    const mult = elementalMult(b, a, d, sk) * (aoe ? 0.85 : 1);
    for (let set = 0; set < 4; set++) {
      let got = 0;
      for (let i = 0; i < 3; i++) if (rint(b, 1, 10) - 2 + pv > av) got++;
      if (got === 0) break;
      pens += 1;
      const raw = (h.crit && pens === 1 ? sk.dice[0] * sk.dice[1] : dice(b, sk.dice[0], sk.dice[1])) + Math.floor(statOf(a.mon, "atk") / 8);
      total += Math.max(1, Math.round(raw * mult));
      if (got < 3) break;
      pv -= 3;
    }
    const em = elementMult(sk.element, speciesOf(d).element);
    const effTxt = em > 1 ? " It's super effective!" : em < 1 ? " It's resisted." : "";
    if (pens === 0) {
      log(b, `${capName(a)} ${sk.verb} ${unitName(d)}, but fails to penetrate its armor. ${hitText} [AV ${av}]`, "miss");
      fx(b, d, d.x, d.y, "0", "#c9b99a");
    } else {
      log(b, `${h.crit ? "Critical! " : ""}${capName(a)} ${sk.verb} ${unitName(d)}${pens > 1 ? ` (x${pens})` : ""} for ${total}.${effTxt} ${hitText}`, h.crit ? "crit" : "hit");
      damage(b, d, total);
      if (sk.drain) {
        const got = heal(b, a, Math.ceil(total / 2));
        if (got) log(b, `${capName(a)} drinks in ${got} HP.`, "good");
      }
      if (sk.range <= 1 && hasTrait(d, "thorny") && !aoe) {
        const t = dice(b, 1, 3);
        log(b, `${capName(a)} is pricked by thorns. (${t})`, "status");
        damage(b, a, t);
      }
    }
  } else log(b, `${capName(a)} ${sk.verb} ${unitName(d)}. ${hitText}`, "info");
  if (sk.status && d.state === "active") {
    const [st, chance, turns] = sk.status;
    const p = clamp(chance * (1 + (statOf(a.mon, "wis") - statOf(d.mon, "wis")) / 40), 0.05, 0.95);
    if (rnd(b) < p && addStatus(b, d, st, turns)) log(b, `${capName(d)} is ${STATUSES[st].name.toLowerCase()}!`, "status");
  }
}

function ignite(b: BattleState, tiles: [number, number][]): void {
  const raining = b.weather === "rain" || b.weather === "storm";
  let lit = 0;
  for (const [x, y] of tiles) {
    const t = tileAt(b, x, y);
    if (!t || !FLAMMABLE[t.t] || t.fire > 0) continue;
    if (raining && rnd(b) > 0.3) continue;
    t.fire = t.t === "tree" ? 4 : 3;
    lit++;
  }
  if (lit) log(b, lit > 1 ? "The undergrowth catches fire!" : "The grass catches fire.", "status");
}

function douse(b: BattleState, tiles: [number, number][]): void {
  let n = 0;
  for (const [x, y] of tiles) {
    const t = tileAt(b, x, y);
    if (t && t.fire > 0) {
      t.fire = 0;
      n++;
    }
  }
  if (n) log(b, "The flames hiss out.", "info");
}

/** Executes a skill from the unit's current position. */
export function useSkill(gs: GameState, u: BUnit, skillId: string, tx: number, ty: number): void {
  const b = gs.battle as BattleState;
  const sk = SKILLS[skillId];
  u.cooldowns[skillId] = sk.cooldown + 1;
  b.acted = true;
  if (sk.dash) {
    let best: [number, number] | null = null;
    let bd = 99;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if ((!dx && !dy) || !canStand(b, u, nx, ny)) continue;
        const o = unitAt(b, nx, ny);
        if (o && o !== u) continue;
        const d = dist(u.x, u.y, nx, ny);
        if (d < bd) {
          bd = d;
          best = [nx, ny];
        }
      }
    }
    if (best) {
      const path: [number, number][] = [];
      let cx = u.x;
      let cy = u.y;
      while (cx !== best[0] || cy !== best[1]) {
        cx += Math.sign(best[0] - cx);
        cy += Math.sign(best[1] - cy);
        path.push([cx, cy]);
      }
      u.x = best[0];
      u.y = best[1];
      if (sk.ignite) ignite(b, path);
    }
  }
  const tiles = affectedTiles(b, u, skillId, tx, ty);
  if (sk.target === "self" && sk.selfStatus) {
    addStatus(b, u, sk.selfStatus[0], sk.selfStatus[1]);
  }
  if (sk.heal) {
    const amt = sk.heal + Math.floor(statOf(u.mon, "wis") / 2);
    const targets = sk.radius > 0
      ? b.units.filter((o) => o.side === u.side && o.state === "active" && tiles.some(([x, y]) => x === o.x && y === o.y))
      : [unitAt(b, tx, ty) ?? u];
    if (sk.target === "self" && sk.radius > 0 && !targets.includes(u)) targets.push(u);
    const lines: string[] = [];
    for (const t of targets) {
      const got = heal(b, t, amt);
      if (got) lines.push(`${unitName(t)} +${got}`);
      if (skillId === "mend" || skillId === "bloom") t.statuses = t.statuses.filter((s) => s.id !== "poisoned" && s.id !== "burning");
    }
    log(b, `${capName(u)} ${sk.verb} ${sk.radius > 0 ? "its allies" : unitName(targets[0])}. ${lines.join(", ") || "No effect."}`, "good");
    if (sk.selfStatus && sk.target !== "self") addStatus(b, u, sk.selfStatus[0], sk.selfStatus[1]);
    return;
  }
  if (sk.target === "self" && sk.radius === 0) {
    log(b, `${capName(u)} ${sk.verb}.`, "info");
    return;
  }
  const victims = b.units.filter((o) => o.state === "active" && o.side !== u.side && tiles.some(([x, y]) => x === o.x && y === o.y));
  if (sk.radius > 0 && victims.length === 0) log(b, `${capName(u)} ${sk.verb} empty ground.`, "info");
  for (const v of victims) strike(gs, u, v, skillId, sk.radius > 0);
  if (sk.ignite) ignite(b, sk.radius > 0 ? tiles : [[tx, ty]]);
  if (sk.element === "water" || sk.element === "frost" || skillId === "cyclone") douse(b, tiles);
  if (skillId === "overgrowth") {
    for (const [x, y] of tiles) {
      const t = tileAt(b, x, y);
      if (t && (t.t === "grass" || t.t === "ash" || t.t === "sand")) t.t = "tallgrass";
    }
  }
}

export function moveUnit(gs: GameState, u: BUnit, x: number, y: number): boolean {
  const b = gs.battle as BattleState;
  const r = reachable(b, u);
  if (!r.has(y * b.cols + x)) return false;
  u.x = x;
  u.y = y;
  b.moved = true;
  const t = tileAt(b, x, y);
  if (t?.t === "water") addStatus(b, u, "soaked", 2);
  return true;
}

export interface TameOdds {
  chance: number;
  label: string;
  factors: [string, number][];
}

export function tameOdds(gs: GameState, tamer: BUnit, target: BUnit): TameOdds {
  const sp = speciesOf(target);
  const factors: [string, number][] = [["Base", sp.tameBase]];
  const hpFrac = target.hp / target.maxHp;
  factors.push(["Wounds", (1 - hpFrac) * 0.45]);
  if (target.tameBonus) factors.push(["Fed / affection", target.tameBonus]);
  const pt = PERSONALITIES[target.mon.personality].tame;
  if (pt) factors.push([`${PERSONALITIES[target.mon.personality].name}`, pt]);
  if (gs.player.origin === "ranger") factors.push(["Ranger", 0.1]);
  factors.push(["Tamer bond", tamer.mon.bond / 1000]);
  const lvl = target.mon.level - tamer.mon.level;
  if (lvl > 0) factors.push(["Level gap", -lvl * 0.03]);
  if (target.mon.plus >= 3) factors.push(["Lair alpha", -0.15]);
  if (hasStatus(target, "stunned") || hasStatus(target, "rooted")) factors.push(["Helpless", 0.08]);
  let c = factors.reduce((a, [, v]) => a + v, 0);
  if (sp.rarity === "rare" || sp.rarity === "legendary") c *= 0.6;
  const fearful = gs.party.length > 0 && SPECIES[tamer.mon.speciesId].element === "fire" && sp.fears === "fire";
  if (fearful) {
    c *= 0.8;
    factors.push(["Fears your fire", -0.05]);
  }
  const chance = clamp(c, 0.02, 0.92);
  const label = chance > 0.6 ? "Likely" : chance > 0.35 ? "Possible" : chance > 0.15 ? "Unlikely" : "Very unlikely";
  return { chance, label, factors };
}

export const TAME_RANGE = 2;
export const ITEM_RANGE = 3;

export function attemptTame(gs: GameState, u: BUnit, target: BUnit): void {
  const b = gs.battle as BattleState;
  b.acted = true;
  const odds = tameOdds(gs, u, target);
  const r = rnd(b);
  const sp = speciesOf(target);
  if (r < odds.chance) {
    target.state = "tamed";
    log(b, `${capName(u)} approaches ${unitName(target)} slowly... It lowers its head. ${sp.name} was tamed! [${Math.round(r * 100)} < ${Math.round(odds.chance * 100)}]`, "good");
    fx(b, target, target.x, target.y, "Tamed!", "#f2c14e");
  } else {
    target.tameBonus += 0.05;
    const flavor = ["It snaps at the air and backs off.", "It isn't ready to trust you.", "It hesitates, then shakes its head.", "It watches you, a little less suspicious."];
    log(b, `${capName(u)} tries to win over ${unitName(target)}. ${flavor[rint(b, 0, flavor.length - 1)]} [${Math.round(r * 100)} vs ${Math.round(odds.chance * 100)}]`, "miss");
    fx(b, target, target.x, target.y, "Refused", "#c9b99a");
  }
}

export function useBattleItem(gs: GameState, u: BUnit, item: ItemId, target: BUnit): void {
  const b = gs.battle as BattleState;
  const it = ITEMS[item];
  if ((gs.bag[item] ?? 0) <= 0) return;
  gs.bag[item] = (gs.bag[item] ?? 0) - 1;
  b.acted = true;
  if (target.side === "wild") {
    const sp = speciesOf(target);
    const liked = sp.likes === item;
    const ok = it.diets.includes(sp.diet);
    if (liked) {
      target.tameBonus += 0.2;
      log(b, `${capName(u)} tosses ${it.name} to ${unitName(target)}. It wolfs it down. It loves these! (Tame +20%)`, "good");
    } else if (ok) {
      target.tameBonus += 0.08;
      log(b, `${capName(u)} tosses ${it.name} to ${unitName(target)}. It eats warily. (Tame +8%)`, "good");
    } else log(b, `${capName(u)} tosses ${it.name} to ${unitName(target)}. It ignores it.`, "miss");
    if (ok) heal(b, target, Math.floor(it.heal / 2));
    return;
  }
  const got = heal(b, target, it.heal);
  target.statuses = target.statuses.filter((s) => !it.cures.includes(s.id));
  log(b, `${capName(u)} uses ${it.name} on ${unitName(target)}${got ? ` (+${got} HP)` : ""}.`, "good");
}

export function tryFlee(gs: GameState, u: BUnit): void {
  const b = gs.battle as BattleState;
  b.acted = true;
  const wildAgi = Math.max(...b.units.filter((w) => w.side === "wild" && w.state === "active").map((w) => statOf(w.mon, "agi")));
  const p = clamp(0.45 + (statOf(u.mon, "agi") - wildAgi) / 30 + (b.ambush ? -0.15 : 0) + (b.round > 1 ? 0.1 : 0), 0.15, 0.9);
  if (rnd(b) < p) {
    log(b, "You call your monsters back and slip away!", "info");
    concludeBattle(gs, "fled");
  } else log(b, `You try to retreat, but ${b.ambush ? "the ambushers" : "your foes"} cut you off! [${Math.round(p * 100)}%]`, "bad");
}

/* ------------------------------------ AI ------------------------------------- */

interface Plan {
  x: number;
  y: number;
  skill: string | null;
  tx: number;
  ty: number;
  score: number;
}

function avgDice(sk: SkillDef): number {
  return sk.dice[0] * (sk.dice[1] + 1) / 2;
}

function planFor(gs: GameState, u: BUnit): Plan {
  const b = gs.battle as BattleState;
  const reach = reachable(b, u);
  const foes = b.units.filter((o) => o.state === "active" && o.side !== u.side);
  const allies = b.units.filter((o) => o.state === "active" && o.side === u.side);
  const hpFrac = u.hp / u.maxHp;
  const timid = u.side === "wild" && (u.mon.personality === "timid" || u.mon.personality === "gentle") && hpFrac < 0.3;
  let best: Plan = { x: u.x, y: u.y, skill: null, tx: u.x, ty: u.y, score: -1 };
  if (timid) {
    let far: Plan = best;
    let fd = -1;
    for (const k of reach.keys()) {
      const x = k % b.cols;
      const y = Math.floor(k / b.cols);
      const d = Math.min(...foes.map((f) => dist(f.x, f.y, x, y)));
      const edge = x === 0 || y === 0 || x === b.cols - 1 || y === b.rows - 1 ? 2 : 0;
      if (d + edge > fd) {
        fd = d + edge;
        far = { x, y, skill: "__flee", tx: x, ty: y, score: 99 };
      }
    }
    return far;
  }
  const ready = u.mon.skills.filter((s) => SKILLS[s] && skillReady(u, s));
  for (const [k, cost] of reach) {
    const px = k % b.cols;
    const py = Math.floor(k / b.cols);
    const t = tileAt(b, px, py);
    const tilePenalty = (t && t.fire > 0 ? 6 : 0) + cost * 0.05;
    for (const sid of ready) {
      const sk = SKILLS[sid];
      if (sk.heal) {
        const hurt = allies.filter((a) => a.hp / a.maxHp < 0.5);
        if (!hurt.length) continue;
        if (sk.radius > 0) {
          const n = allies.filter((a) => dist(a.x, a.y, px, py) <= sk.radius && a.hp < a.maxHp).length;
          const sc = n * 6 - tilePenalty;
          if (sc > best.score) best = { x: px, y: py, skill: sid, tx: px, ty: py, score: sc };
        } else {
          for (const a of hurt) {
            if (sk.target === "self" && a !== u) continue;
            if (sk.target === "ally" && dist(px, py, a.x, a.y) > sk.range) continue;
            const sc = 9 + (1 - a.hp / a.maxHp) * 8 - tilePenalty;
            if (sc > best.score) best = { x: px, y: py, skill: sid, tx: a.x, ty: a.y, score: sc };
          }
        }
        continue;
      }
      if (sk.target === "self" && sk.radius === 0) {
        const threatened = foes.some((f) => dist(f.x, f.y, px, py) <= 1);
        const sc = threatened && hpFrac < 0.6 ? 5 - tilePenalty : -1;
        if (sc > best.score) best = { x: px, y: py, skill: sid, tx: px, ty: py, score: sc };
        continue;
      }
      if (sk.target === "self") {
        const hit = foes.filter((f) => dist(f.x, f.y, px, py) <= sk.radius);
        const sc = hit.reduce((a, f) => a + (avgDice(sk) + 2) * elementMult(sk.element, speciesOf(f).element), 0) * 0.9 + (sk.status ? hit.length * 2 : 0) - tilePenalty;
        if (hit.length && sc > best.score) best = { x: px, y: py, skill: sid, tx: px, ty: py, score: sc };
        continue;
      }
      if (sk.target === "tile") {
        for (const f of foes) {
          if (dist(px, py, f.x, f.y) > sk.range || !lineOfSight(b, px, py, f.x, f.y)) continue;
          const hit = foes.filter((o) => dist(o.x, o.y, f.x, f.y) <= sk.radius);
          const friendly = 0;
          const sc = hit.reduce((a, o) => a + (avgDice(sk) + 2) * elementMult(sk.element, speciesOf(o).element), 0) * 0.85 + (sk.status ? hit.length * 2 : 0) - friendly - tilePenalty;
          if (sc > best.score) best = { x: px, y: py, skill: sid, tx: f.x, ty: f.y, score: sc };
        }
        continue;
      }
      for (const f of foes) {
        const d = dist(px, py, f.x, f.y);
        if (d > sk.range || d === 0) continue;
        if (sk.range > 1 && !lineOfSight(b, px, py, f.x, f.y)) continue;
        const dmg = (avgDice(sk) + statOf(u.mon, "atk") / 8) * elementMult(sk.element, speciesOf(f).element);
        const kill = dmg >= f.hp ? 8 : 0;
        const statusVal = sk.status && !hasStatus(f, sk.status[0]) ? 3 * sk.status[1] * 2 : 0;
        const sc = dmg + kill + statusVal + (1 - f.hp / f.maxHp) * 3 - tilePenalty - (sk.cooldown > 0 && dmg < 1 && !statusVal ? 5 : 0);
        if (sc > best.score) best = { x: px, y: py, skill: sid, tx: f.x, ty: f.y, score: sc };
      }
    }
  }
  if (best.skill) return best;
  let mv: Plan = { x: u.x, y: u.y, skill: null, tx: u.x, ty: u.y, score: 0 };
  let md = 99;
  for (const [k] of reach) {
    const x = k % b.cols;
    const y = Math.floor(k / b.cols);
    const t = tileAt(b, x, y);
    const d = Math.min(...foes.map((f) => dist(f.x, f.y, x, y))) + (t && t.fire > 0 ? 5 : 0);
    if (d < md) {
      md = d;
      mv = { x, y, skill: null, tx: x, ty: y, score: 0 };
    }
  }
  return mv;
}

/** Plans the current AI unit's move (stage 1). Returns false if nothing to do. */
export function aiPlan(gs: GameState): void {
  const b = gs.battle;
  if (!b) return;
  const u = currentUnit(b);
  if (!u || u.state !== "active") return;
  const p = planFor(gs, u);
  b.plan = { x: p.x, y: p.y, skill: p.skill, tx: p.tx, ty: p.ty, flee: p.skill === "__flee" };
  if (p.x !== u.x || p.y !== u.y) {
    const tl = tileAt(b, p.x, p.y);
    u.x = p.x;
    u.y = p.y;
    b.moved = true;
    if (tl?.t === "water") addStatus(b, u, "soaked", 2);
  }
}

/** Executes the planned AI action (stage 2) and ends the turn. */
export function aiAct(gs: GameState): void {
  const b = gs.battle;
  if (!b) return;
  const u = currentUnit(b);
  const plan = b.plan;
  if (u && u.state === "active" && plan) {
    if (plan.flee) {
      const edge = u.x === 0 || u.y === 0 || u.x === b.cols - 1 || u.y === b.rows - 1;
      if (edge && rnd(b) < 0.6) {
        u.state = "fled";
        log(b, `${capName(u)} turns tail and flees into the wild!`, "info");
      } else log(b, `${capName(u)} scrambles away, looking for an escape.`, "info");
    } else if (plan.skill && SKILLS[plan.skill]) {
      useSkill(gs, u, plan.skill, plan.tx, plan.ty);
    } else if (u.side === "wild" && b.round === 1 && u.mon.personality === "lazy" && rnd(b) < 0.3) {
      log(b, `${capName(u)} yawns.`, "info");
    } else {
      log(b, `${capName(u)} ${b.moved ? "advances" : "holds its ground"}.`, "info");
    }
  }
  b.plan = null;
  nextTurn(gs);
}

export function endPlayerTurn(gs: GameState): void {
  nextTurn(gs);
}

/* --------------------------------- Conclude --------------------------------- */

const DROPS: Record<string, [ItemId, number]> = { Beast: ["meat", 0.5], Bug: ["ore", 0.3], Spirit: ["honeycomb", 0.3], Slime: ["herb", 0.35], Bird: ["meat", 0.3], Dragon: ["ore", 0.8] };

function concludeBattle(gs: GameState, result: "won" | "lost" | "fled"): void {
  const b = gs.battle as BattleState;
  b.phase = "over";
  const summary: BattleSummary = { result, xp: {}, lines: [], gold: 0, items: {}, tamed: [] };
  const beaten = b.units.filter((u) => u.side === "wild" && (u.state === "down" || u.state === "tamed"));
  let xpPool = 0;
  for (const u of beaten) {
    xpPool += Math.round(speciesOf(u).xp * (0.6 + u.mon.level * 0.5));
    if (u.state === "down") {
      summary.gold += rint(b, 1, 3) * u.mon.level;
      const drop = DROPS[speciesOf(u).family];
      if (drop && rnd(b) < drop[1]) summary.items[drop[0]] = (summary.items[drop[0]] ?? 0) + 1;
    }
  }
  if (gs.player.origin === "scholar") xpPool = Math.round(xpPool * 1.2);
  const fighters = b.units.filter((u) => u.side === "party" && u.state === "active");
  const share = fighters.length ? Math.ceil(xpPool / Math.max(1, fighters.length * 0.75)) : 0;
  if (result === "won") summary.lines.push(beaten.length ? `Victory in the ${b.regionName}.` : "The wild creatures scattered.");
  if (result === "fled") summary.lines.push("You escaped.");
  if (result === "lost") summary.lines.push("Your monsters have all fallen...");
  for (const u of b.units.filter((x) => x.side === "party")) {
    if (result !== "lost" && u.state === "active" && share > 0) {
      summary.xp[u.mon.uid] = share;
    }
  }
  b.summary = summary;
  log(b, result === "won" ? "The battle is over." : result === "fled" ? "You got away." : "Everything goes dark.", result === "won" ? "good" : "bad");
}

/** Applies a concluded battle back onto the world and closes it. */
export function finishBattle(gs: GameState): void {
  const b = gs.battle;
  if (!b || !b.summary) return;
  const s = b.summary;
  const world = getWorld(gs.seed);
  for (const u of b.units) {
    if (u.side === "party") {
      const m = gs.party.find((p) => p.uid === u.mon.uid);
      if (!m) continue;
      m.hp = u.state === "down" ? 0 : u.hp;
      const xp = s.xp[m.uid] ?? 0;
      if (xp) {
        const lines = grantXp(m, xp);
        for (const l of lines) addLog(gs, l, "good");
      }
      if (s.result === "won" && u.state === "active") {
        m.bond = Math.min(100, m.bond + 2);
        m.wins += 1;
      }
      m.satiety = Math.max(0, m.satiety - 4);
      continue;
    }
    const c = u.creatureId ? gs.creatures[u.creatureId] : null;
    if (u.state === "tamed") {
      const mon: Monster = { ...u.mon, uid: "", origin: `Tamed in the ${world.regionName(b.worldX, b.worldY)} lands`, bond: 25, bornTick: gs.tick, nickname: null };
      gs.uidSeq += 1;
      mon.uid = `m${gs.uidSeq.toString(36)}`;
      mon.hp = Math.max(1, u.hp);
      mon.plus = 0;
      const where = recruit(gs, mon);
      gs.tamed[mon.speciesId] = true;
      gs.stats.tamed += 1;
      s.tamed.push(displayName(mon));
      addLog(gs, `${SPECIES[mon.speciesId].name} was tamed! ${where}`, "good");
      if (u.creatureId) {
        gs.removed[u.creatureId] = gs.tick;
        delete gs.creatures[u.creatureId];
      }
    } else if (u.state === "down") {
      if (u.creatureId) {
        gs.removed[u.creatureId] = gs.tick;
        delete gs.creatures[u.creatureId];
      }
    } else if (c) {
      c.hpFrac = Math.max(0.05, u.hp / u.maxHp);
      c.calmUntil = gs.tick + 24;
      c.stalking = false;
      if (u.state === "fled") {
        c.disposition = "skittish";
        const ang = hash2(b.seed, 1, 1) % 8;
        const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        for (let i = 4; i > 0; i--) {
          const nx = c.x + dirs[ang][0] * i;
          const ny = c.y + dirs[ang][1] * i;
          if (world.passable(nx, ny) && !(nx === gs.player.x && ny === gs.player.y)) {
            c.x = nx;
            c.y = ny;
            break;
          }
        }
      }
    }
  }
  gs.player.gold += s.gold;
  for (const [k, n] of Object.entries(s.items) as [ItemId, number][]) gs.bag[k] = (gs.bag[k] ?? 0) + n;
  if (s.result === "won") {
    addLog(gs, `You won the battle${s.gold ? ` and found ${s.gold} gold` : ""}.`, "good");
    if (b.lairKey) addLog(gs, "The lair falls quiet. Its alpha won't trouble travellers for a while.", "event");
  } else if (s.result === "fled") {
    addLog(gs, "You retreat, heart pounding. Your foes lose interest for now.", "info");
  } else {
    const lost = Math.floor(gs.player.gold / 2);
    gs.player.gold -= lost;
    gs.player.x = gs.player.homeX;
    gs.player.y = gs.player.homeY;
    gs.tick += 96;
    for (const m of gs.party) m.hp = Math.max(1, Math.round(statOf(m, "hp") * 0.3));
    addLog(gs, `You wake in ${gs.player.homeName}, bandaged. A farmer found you in the ${b.regionName}. ${lost ? `Your purse is ${lost} gold lighter.` : ""}`, "bad");
    loadChunks(gs);
  }
  gs.battle = null;
}

export function describeUnitPos(gs: GameState, u: BUnit): string {
  return compass(u.x - gs.player.x, u.y - gs.player.y);
}

export function elementColor(u: BUnit): string {
  return ELEMENTS[speciesOf(u).element].color;
}

export { BIOMES, hashString };
