import { rngNext } from "./rng";
import type { BiomeId, FeatureId, Terrain } from "./types";

/** Procedural 16×16 pixel-art textures for biomes, features and battle terrain. */
const PX = 16;
const cache = new Map<string, HTMLCanvasElement>();

type Ctx = CanvasRenderingContext2D;
type R = () => number;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.min(255, Math.max(0, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const px = (ctx: Ctx, x: number, y: number, col: string): void => {
  if (x < 0 || y < 0 || x >= PX || y >= PX) return;
  ctx.fillStyle = col;
  ctx.fillRect(x, y, 1, 1);
};

function make(key: string, seed: number, paint: (ctx: Ctx, r: R) => void): HTMLCanvasElement {
  const c = cache.get(key);
  if (c) return c;
  const cv = document.createElement("canvas");
  cv.width = PX;
  cv.height = PX;
  const ctx = cv.getContext("2d") as Ctx;
  let s = seed;
  const r: R = () => {
    const [v, n] = rngNext(s);
    s = n;
    return v;
  };
  paint(ctx, r);
  cache.set(key, cv);
  return cv;
}

function base(ctx: Ctx, r: R, col: string, spread = 0.07): void {
  const a = shade(col, 1 - spread);
  const b = shade(col, 1 + spread * 0.8);
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, PX, PX);
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const v = r();
      if (v < 0.16) px(ctx, x, y, a);
      else if (v > 0.88) px(ctx, x, y, b);
    }
  }
}

function tufts(ctx: Ctx, r: R, col: string, n: number, tall = false): void {
  const d = shade(col, 0.72);
  const l = shade(col, 1.18);
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor(r() * 14);
    const y = 2 + Math.floor(r() * 13);
    px(ctx, x, y, d);
    px(ctx, x - 1, y - 1, d);
    px(ctx, x + 1, y - 1, d);
    if (tall) {
      px(ctx, x, y - 1, l);
      px(ctx, x - 1, y - 2, l);
      px(ctx, x + 1, y - 2, d);
    }
  }
}

function flowers(ctx: Ctx, r: R, n: number): void {
  const cols = ["#f2c14e", "#e05a8a", "#fff4dc", "#9fd3e6"];
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor(r() * 14);
    const y = 1 + Math.floor(r() * 14);
    px(ctx, x, y, cols[Math.floor(r() * cols.length)]);
  }
}

function oak(ctx: Ctx, r: R, cx: number, cy: number, leaf: string): void {
  const trunk = "#5a3b22";
  for (let y = cy + 3; y <= cy + 6; y++) {
    px(ctx, cx, y, trunk);
    px(ctx, cx + 1, y, shade(trunk, 0.8));
  }
  const rad = 4.6 + r() * 0.6;
  for (let y = -5; y <= 4; y++) {
    for (let x = -5; x <= 5; x++) {
      const d = Math.hypot(x, y * 1.08);
      if (d > rad + (r() - 0.5) * 0.8) continue;
      const lit = x + y < -2 ? 1.25 : x + y > 3 ? 0.72 : 1;
      px(ctx, cx + x, cy + y, shade(leaf, lit * (r() < 0.15 ? 0.88 : 1)));
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    px(ctx, Math.round(cx + Math.cos(a) * (rad + 0.4)), Math.round(cy + Math.sin(a) * (rad + 0.4)), "#1d2e1a");
  }
  ctx.fillStyle = "rgba(10,20,10,0.25)";
  ctx.fillRect(cx - 3, cy + 6, 7, 1);
}

function pine(ctx: Ctx, r: R, cx: number, top: number, leaf: string, snowy = false): void {
  const trunk = "#4a3020";
  px(ctx, cx, top + 11, trunk);
  px(ctx, cx, top + 12, trunk);
  for (let y = 0; y < 11; y++) {
    const w = Math.floor((y % 4) + y / 3);
    for (let x = -w; x <= w; x++) {
      const lit = x < 0 ? 1.18 : x > 0 ? 0.78 : 1;
      px(ctx, cx + x, top + y, shade(leaf, lit));
    }
    if (snowy && y % 4 === 0 && y > 0) {
      for (let x = -w; x <= 0; x++) px(ctx, cx + x, top + y, "#eef4f6");
    }
  }
  if (snowy) px(ctx, cx, top, "#ffffff");
  void r;
}

function deadTree(ctx: Ctx, r: R, cx: number): void {
  const c = "#1f1629";
  for (let y = 4; y < 15; y++) px(ctx, cx + (y < 8 ? Math.round(Math.sin(y) * 0.8) : 0), y, c);
  for (let i = 0; i < 4; i++) {
    const y = 4 + i * 2;
    const dir = i % 2 ? 1 : -1;
    for (let k = 1; k < 4; k++) px(ctx, cx + dir * k, y - Math.floor(k / 2), c);
  }
  if (r() < 0.8) {
    px(ctx, cx + 3, 13, "#c58cf0");
    px(ctx, cx + 3, 12, "#e2c2ff");
    px(ctx, cx - 4, 14, "#c58cf0");
  }
}

function waves(ctx: Ctx, r: R, col: string, n: number): void {
  const l = shade(col, 1.3);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(r() * 13);
    const y = 1 + Math.floor(r() * 14);
    px(ctx, x, y, l);
    px(ctx, x + 1, y - 1, l);
    px(ctx, x + 2, y, l);
  }
}

function rock(ctx: Ctx, cx: number, cy: number, col: string, size = 3): void {
  for (let y = -size; y <= size - 1; y++) {
    for (let x = -size - 1; x <= size + 1; x++) {
      if (Math.hypot(x / 1.3, y) > size) continue;
      const lit = y < -1 ? 1.25 : y > 0 ? 0.75 : 1;
      px(ctx, cx + x, cy + y, shade(col, x < 0 ? lit * 1.05 : lit * 0.92));
    }
  }
  for (let x = -size - 1; x <= size + 1; x++) px(ctx, cx + x, cy + size, "rgba(0,0,0,0.25)");
}

function mountain(ctx: Ctx, col: string, cap: string | null, h = 12): void {
  const top = PX - h - 2;
  for (let y = 0; y < h; y++) {
    const w = Math.floor((y + 1) * 0.72);
    for (let x = -w; x <= w; x++) {
      const c = x < 0 ? shade(col, 1.15) : shade(col, 0.78);
      px(ctx, 8 + x, top + y, cap && y < h * 0.36 ? (x < 0 ? cap : shade(cap, 0.85)) : c);
    }
  }
  px(ctx, 8, top - 1, cap ?? shade(col, 1.2));
}

const BIOME_PAINT: Record<BiomeId, (ctx: Ctx, r: R, v: number) => void> = {
  deep: (ctx, r) => {
    base(ctx, r, "#1d3a63", 0.05);
    waves(ctx, r, "#1d3a63", 2);
  },
  sea: (ctx, r) => {
    base(ctx, r, "#2f6aa0", 0.05);
    waves(ctx, r, "#2f6aa0", 3);
  },
  lake: (ctx, r) => {
    base(ctx, r, "#3a7fb5", 0.04);
    waves(ctx, r, "#3a7fb5", 2);
  },
  river: (ctx, r) => {
    base(ctx, r, "#4c93c9", 0.05);
    waves(ctx, r, "#4c93c9", 4);
    if (r() < 0.5) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#e8f6ff");
  },
  beach: (ctx, r) => {
    base(ctx, r, "#e3cf8f", 0.06);
    if (r() < 0.5) px(ctx, Math.floor(r() * 14) + 1, Math.floor(r() * 14) + 1, "#f6ece0");
    if (r() < 0.3) px(ctx, Math.floor(r() * 14) + 1, Math.floor(r() * 14) + 1, "#c97b5a");
  },
  meadow: (ctx, r, v) => {
    base(ctx, r, "#7fb34a");
    tufts(ctx, r, "#7fb34a", 5);
    if (v < 2) flowers(ctx, r, 3 + v * 2);
  },
  forest: (ctx, r, v) => {
    base(ctx, r, "#4f8a3c");
    tufts(ctx, r, "#4f8a3c", 3);
    oak(ctx, r, 7 + (v % 2), 6, v === 3 ? "#3f7d2e" : "#2f6b2e");
  },
  taiga: (ctx, r, v) => {
    base(ctx, r, "#3f6b4a");
    if (v % 2) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#dfe8e4");
    pine(ctx, r, 7 + (v % 3), 2, "#24503a", v === 0);
  },
  gloomwood: (ctx, r) => {
    base(ctx, r, "#3b2f4f", 0.09);
    for (let i = 0; i < 3; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#5d4a7a");
    deadTree(ctx, r, 6 + Math.floor(r() * 4));
  },
  marsh: (ctx, r) => {
    base(ctx, r, "#5d7a4a", 0.08);
    const x = 2 + Math.floor(r() * 9);
    const y = 4 + Math.floor(r() * 8);
    for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 2; dy++) px(ctx, x + dx, y + dy, "#3a6b6a");
    px(ctx, x + 1, y, "#6aa0a0");
    for (let i = 0; i < 3; i++) {
      const rx = Math.floor(r() * 15);
      const ry = 6 + Math.floor(r() * 8);
      px(ctx, rx, ry, "#8a9a4a");
      px(ctx, rx, ry - 1, "#8a9a4a");
      px(ctx, rx, ry - 2, "#7a4a2a");
    }
  },
  steppe: (ctx, r) => {
    base(ctx, r, "#b7a95a");
    tufts(ctx, r, "#b7a95a", 6, true);
  },
  desert: (ctx, r, v) => {
    base(ctx, r, "#d9b46a", 0.05);
    const d = shade("#d9b46a", 0.86);
    for (let i = 0; i < 2; i++) {
      const y = 3 + Math.floor(r() * 10);
      const x0 = Math.floor(r() * 6);
      for (let x = x0; x < x0 + 7; x++) px(ctx, x, y + Math.round(Math.sin(x * 0.8) * 0.6), d);
    }
    if (v === 0) {
      const c = "#4f8a3c";
      for (let y = 5; y < 14; y++) px(ctx, 8, y, c);
      for (let y = 7; y < 10; y++) px(ctx, 6, y, c);
      px(ctx, 7, 10, c);
      for (let y = 6; y < 9; y++) px(ctx, 10, y, c);
      px(ctx, 9, 9, c);
      px(ctx, 8, 4, "#e05a8a");
    }
  },
  tundra: (ctx, r) => {
    base(ctx, r, "#9fae9a", 0.08);
    for (let i = 0; i < 5; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#6f8a6a");
    if (r() < 0.6) rock(ctx, 4 + Math.floor(r() * 8), 9 + Math.floor(r() * 4), "#8d8d8d", 1);
  },
  snow: (ctx, r) => {
    base(ctx, r, "#e7eef2", 0.04);
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * 14);
      const y = Math.floor(r() * 16);
      px(ctx, x, y, "#c7d6e2");
      px(ctx, x + 1, y, "#c7d6e2");
    }
  },
  hills: (ctx, r) => {
    base(ctx, r, "#8f9b55");
    const cx = 5 + Math.floor(r() * 6);
    for (let x = -6; x <= 6; x++) {
      const h = Math.round(Math.sqrt(36 - x * x) * 0.6);
      for (let y = 0; y < h; y++) px(ctx, cx + x, 12 - y, shade("#8f9b55", y === h - 1 ? 1.25 : x > 2 ? 0.85 : 1.05));
    }
    tufts(ctx, r, "#8f9b55", 2);
  },
  mountain: (ctx, r, v) => {
    base(ctx, r, "#857a6e", 0.08);
    mountain(ctx, "#8c8079", v === 0 ? "#f0f0f0" : null, 12 + (v % 2));
  },
  peak: (ctx, r) => {
    base(ctx, r, "#a8a29c", 0.06);
    mountain(ctx, "#9a938c", "#f6f8fa", 14);
  },
};

export function biomeTex(biome: BiomeId, variant: number): HTMLCanvasElement {
  return make(`b:${biome}:${variant}`, 1000 + variant * 97 + biome.length * 13 + biome.charCodeAt(0), (ctx, r) => BIOME_PAINT[biome](ctx, r, variant));
}

export function featureTex(kind: FeatureId): HTMLCanvasElement {
  return make(`f:${kind}`, 42, (ctx, r) => {
    if (kind === "hamlet") {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(2, 14, 12, 1);
      for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) px(ctx, x, y, x > 10 ? "#d8c49a" : "#f0e0b8");
      for (let y = 0; y < 6; y++) {
        for (let x = -y - 1; x <= y + 1; x++) px(ctx, 8 + x, 2 + y, x > 0 ? "#8f2c38" : "#b23a48");
      }
      for (let x = 1; x < 15; x++) px(ctx, x, 8, "#6b2530");
      px(ctx, 11, 1, "#5a4a44");
      px(ctx, 11, 2, "#5a4a44");
      px(ctx, 12, 0, "#cfcfcf");
      for (let y = 10; y < 14; y++) {
        px(ctx, 7, y, "#6b4a2b");
        px(ctx, 8, y, "#6b4a2b");
      }
      px(ctx, 4, 10, "#f2c14e");
      px(ctx, 5, 10, "#f2c14e");
      px(ctx, 11, 10, "#f2c14e");
    } else if (kind === "ruin") {
      const c = "#a39d92";
      for (let y = 4; y < 14; y++) {
        px(ctx, 3, y, c);
        px(ctx, 4, y, shade(c, 0.8));
      }
      for (let y = 7; y < 14; y++) {
        px(ctx, 11, y, c);
        px(ctx, 12, y, shade(c, 0.8));
      }
      for (let x = 3; x < 9; x++) px(ctx, x, 4 - (x > 5 ? 1 : 0), c);
      rock(ctx, 8, 13, "#8a857c", 1);
      for (let i = 0; i < 4; i++) px(ctx, Math.floor(r() * 16), 8 + Math.floor(r() * 7), "#4f8a3c");
    } else if (kind === "shrine") {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        px(ctx, Math.round(8 + Math.cos(a) * 6), Math.round(9 + Math.sin(a) * 5), "#7be08a");
      }
      for (let y = 8; y < 13; y++) for (let x = 5; x < 11; x++) px(ctx, x, y, x < 8 ? "#b5afa5" : "#8d877d");
      for (let x = 4; x < 12; x++) px(ctx, x, 8, "#d8d2c8");
      px(ctx, 7, 6, "#7be08a");
      px(ctx, 8, 5, "#c8ffd0");
      px(ctx, 8, 6, "#7be08a");
      px(ctx, 9, 6, "#7be08a");
      for (let y = 9; y < 14; y++) {
        px(ctx, 4 + (y % 2), y, "#6b4a2b");
        px(ctx, 11 - (y % 2), y, "#6b4a2b");
      }
    } else {
      for (let y = 0; y < 8; y++) {
        for (let x = -7; x <= 7; x++) {
          const d = Math.hypot(x, (7 - y) * 1.1);
          if (d < 7.5) px(ctx, 8 + x, 6 + y, d < 5 ? "#1a1420" : shade("#7a6f66", x < 0 ? 1.1 : 0.85));
        }
      }
      px(ctx, 4, 14, "#f6ece0");
      px(ctx, 5, 14, "#f6ece0");
      px(ctx, 12, 13, "#f6ece0");
      px(ctx, 6, 10, "#e8742a");
      px(ctx, 10, 10, "#e8742a");
    }
  });
}

export function terrainTex(t: Terrain, variant: number): HTMLCanvasElement {
  return make(`t:${t}:${variant}`, 500 + variant * 31 + t.charCodeAt(0) * 7 + t.length, (ctx, r) => {
    switch (t) {
      case "grass":
        base(ctx, r, "#6f9f45");
        tufts(ctx, r, "#6f9f45", 4);
        break;
      case "tallgrass":
        base(ctx, r, "#5f9a3f");
        tufts(ctx, r, "#5f9a3f", 11, true);
        break;
      case "flowers":
        base(ctx, r, "#76a84a");
        tufts(ctx, r, "#76a84a", 3);
        flowers(ctx, r, 8);
        break;
      case "water":
        BIOME_PAINT.river(ctx, r, variant);
        break;
      case "mud":
        base(ctx, r, "#6b5233", 0.1);
        for (let i = 0; i < 3; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#4a6a6a");
        break;
      case "rock":
        base(ctx, r, "#6f9045");
        rock(ctx, 8, 9, "#8d877d", 5);
        break;
      case "tree":
        base(ctx, r, "#5a8a3c");
        oak(ctx, r, 8, 6, "#2f6b2e");
        break;
      case "sand":
        BIOME_PAINT.desert(ctx, r, 1);
        break;
      case "snow":
        BIOME_PAINT.snow(ctx, r, variant);
        break;
      case "ash":
        base(ctx, r, "#3d3633", 0.12);
        for (let i = 0; i < 3; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.4 ? "#e8742a" : "#6a625c");
        break;
      case "gloom":
        base(ctx, r, "#3b2f4f", 0.12);
        for (let i = 0; i < 5; i++) px(ctx, Math.floor(r() * 16), Math.floor(r() * 16), "#6a5590");
        break;
    }
  });
}
