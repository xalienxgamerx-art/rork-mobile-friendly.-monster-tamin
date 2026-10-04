import { memo, useEffect, useRef, useState } from "react";
import { ART, MONSTER_ART } from "@/game/assets";
import { BIOMES, SPECIES } from "@/game/data";
import { hash2 } from "@/game/rng";
import { canSee, sightRadius } from "@/game/sim";
import { biomeTex, featureTex } from "@/game/tiles";
import type { GameState } from "@/game/types";
import { getWorld, timeOf } from "@/game/world";

const imgCache = new Map<string, HTMLImageElement>();
const imgListeners = new Set<() => void>();

function getImg(url: string): HTMLImageElement | null {
  let im = imgCache.get(url);
  if (!im) {
    im = new Image();
    im.src = url;
    im.onload = () => imgListeners.forEach((l) => l());
    imgCache.set(url, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

export interface MapProps {
  gs: GameState;
  v: number;
  selected: { x: number; y: number } | null;
  path: [number, number][] | null;
  onTap: (x: number, y: number) => void;
}

/** Canvas renderer for the overworld around the player. */
export const WorldMap = memo(function WorldMap({ gs, v, selected, path, onTap }: MapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [imgTick, setImgTick] = useState<number>(0);
  const tsRef = useRef<number>(32);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const l = (): void => setImgTick((n) => n + 1);
    imgListeners.add(l);
    return () => {
      ro.disconnect();
      imgListeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !size.w || !size.h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.floor(size.w * dpr);
    cv.height = Math.floor(size.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const ts = size.w < 640 ? 34 : 36;
    tsRef.current = ts;
    const world = getWorld(gs.seed);
    const px = gs.player.x;
    const py = gs.player.y;
    const halfW = Math.ceil(size.w / 2 / ts) + 1;
    const halfH = Math.ceil(size.h / 2 / ts) + 1;
    const sx = (x: number): number => Math.round(size.w / 2 + (x - px - 0.5) * ts);
    const sy = (y: number): number => Math.round(size.h / 2 + (y - py - 0.5) * ts);

    ctx.fillStyle = "#1d3a63";
    ctx.fillRect(0, 0, size.w, size.h);

    for (let y = py - halfH; y <= py + halfH; y++) {
      for (let x = px - halfW; x <= px + halfW; x++) {
        const t = world.tile(x, y);
        const variant = hash2(gs.seed, x, y) % 4;
        const X = sx(x);
        const Y = sy(y);
        ctx.drawImage(biomeTex(t.biome, variant), X, Y, ts, ts);
        if (BIOMES[t.biome].passable && t.biome !== "river") {
          const nb = world.tile(x - 1, y - 1).elev;
          const d = Math.max(-1, Math.min(1, (t.elev - nb) * 55));
          if (d > 0.05) {
            ctx.fillStyle = `rgba(255,240,200,${d * 0.13})`;
            ctx.fillRect(X, Y, ts, ts);
          } else if (d < -0.05) {
            ctx.fillStyle = `rgba(20,10,40,${-d * 0.2})`;
            ctx.fillRect(X, Y, ts, ts);
          }
        }
        if (t.feature) ctx.drawImage(featureTex(t.feature.kind), X, Y, ts, ts);
      }
    }

    if (path && path.length) {
      ctx.fillStyle = "rgba(242,193,78,0.85)";
      for (const [x, y] of path) {
        ctx.fillRect(sx(x) + ts / 2 - 2, sy(y) + ts / 2 - 2, 4, 4);
      }
    }

    const shadow = (X: number, Y: number, w: number): void => {
      ctx.fillStyle = "rgba(10,8,20,0.35)";
      ctx.beginPath();
      ctx.ellipse(X + ts / 2, Y + ts * 0.88, w, ts * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const lead = gs.party.find((m) => m.hp > 0);
    if (lead && (gs.player.fx !== px || gs.player.fy !== py) && Math.abs(gs.player.fx - px) <= 1 && Math.abs(gs.player.fy - py) <= 1) {
      const im = getImg(MONSTER_ART[lead.speciesId]);
      const X = sx(gs.player.fx);
      const Y = sy(gs.player.fy);
      shadow(X, Y, ts * 0.3);
      if (im) ctx.drawImage(im, X + ts * 0.12, Y + ts * 0.1, ts * 0.76, ts * 0.76);
    }

    const time = timeOf(gs.tick);
    for (const id in gs.creatures) {
      const c = gs.creatures[id];
      if (Math.abs(c.x - px) > halfW || Math.abs(c.y - py) > halfH) continue;
      if (!canSee(gs, c.x, c.y)) continue;
      const im = getImg(MONSTER_ART[c.speciesId]);
      const X = sx(c.x);
      const Y = sy(c.y);
      const scale = (c.alpha ? 1.05 : 0.82) * (0.85 + SPECIES[c.speciesId].size * 0.07);
      const w = ts * scale;
      shadow(X, Y, w * 0.38);
      if (c.stalking) {
        ctx.strokeStyle = "rgba(255,90,80,0.9)";
        ctx.lineWidth = 2;
        ctx.strokeRect(X + 1, Y + 1, ts - 2, ts - 2);
      }
      if (im) {
        ctx.globalAlpha = c.activity === "Sleeping" ? 0.8 : 1;
        ctx.drawImage(im, X + (ts - w) / 2, Y + ts - w - ts * 0.06, w, w);
        ctx.globalAlpha = 1;
      }
      ctx.font = `bold ${Math.round(ts * 0.36)}px "Pixelify Sans", monospace`;
      ctx.textAlign = "center";
      if (c.activity === "Sleeping") {
        ctx.fillStyle = "#e7eef2";
        ctx.fillText("z", X + ts * 0.86, Y + ts * 0.3);
      } else if (c.stalking) {
        ctx.fillStyle = "#ff5a50";
        ctx.fillText("!", X + ts * 0.86, Y + ts * 0.32);
      }
      if (c.alpha) {
        ctx.fillStyle = "#f2c14e";
        ctx.fillText("♛", X + ts * 0.18, Y + ts * 0.32);
      }
    }

    {
      const X = sx(px);
      const Y = sy(py);
      shadow(X, Y, ts * 0.32);
      const im = getImg(ART.tamer);
      if (im) ctx.drawImage(im, X - ts * 0.08, Y - ts * 0.3, ts * 1.16, ts * 1.16);
      ctx.fillStyle = gs.player.scarf;
      ctx.fillRect(X + ts * 0.36, Y - ts * 0.34, ts * 0.28, ts * 0.08);
    }

    if (selected) {
      const X = sx(selected.x);
      const Y = sy(selected.y);
      const L = Math.round(ts * 0.32);
      ctx.strokeStyle = "#fff4dc";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const [cx, cy, dx, dy] of [[X, Y, 1, 1], [X + ts, Y, -1, 1], [X, Y + ts, 1, -1], [X + ts, Y + ts, -1, -1]]) {
        ctx.moveTo(cx + dx * L, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy + dy * L);
      }
      ctx.stroke();
    }

    const darkness = 1 - time.daylight;
    const sight = sightRadius(gs);
    if (darkness > 0.04 || sight < 6) {
      if (!darkRef.current) darkRef.current = document.createElement("canvas");
      const dk = darkRef.current;
      dk.width = size.w;
      dk.height = size.h;
      const d = dk.getContext("2d");
      if (d) {
        const a = Math.min(0.78, darkness * 0.72 + (sight < 6 ? 0.18 : 0));
        d.fillStyle = `rgba(14,10,38,${a})`;
        d.fillRect(0, 0, size.w, size.h);
        d.globalCompositeOperation = "destination-out";
        const cx = size.w / 2;
        const cy = size.h / 2;
        const g = d.createRadialGradient(cx, cy, ts * 0.8, cx, cy, ts * (sight + 0.6));
        g.addColorStop(0, "rgba(0,0,0,0.92)");
        g.addColorStop(0.7, "rgba(0,0,0,0.6)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        d.fillStyle = g;
        d.fillRect(0, 0, size.w, size.h);
        d.globalCompositeOperation = "source-over";
        ctx.drawImage(dk, 0, 0);
        if (time.phase === "Night" || time.phase === "Dusk") {
          const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * 2.4);
          warm.addColorStop(0, "rgba(255,160,70,0.16)");
          warm.addColorStop(1, "rgba(255,160,70,0)");
          ctx.fillStyle = warm;
          ctx.fillRect(0, 0, size.w, size.h);
        }
      }
    }
    if (time.phase === "Dusk" || time.phase === "Dawn") {
      ctx.fillStyle = time.phase === "Dusk" ? "rgba(232,116,42,0.10)" : "rgba(255,200,170,0.08)";
      ctx.fillRect(0, 0, size.w, size.h);
    }
  }, [gs, v, selected, path, size, imgTick]);

  const handlePointer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ts = tsRef.current;
    const x = Math.floor((e.clientX - rect.left - size.w / 2) / ts + 0.5) + gs.player.x;
    const y = Math.floor((e.clientY - rect.top - size.h / 2) / ts + 0.5) + gs.player.y;
    onTap(x, y);
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="pixel block h-full w-full cursor-pointer touch-none" style={{ width: size.w, height: size.h }} onPointerUp={handlePointer} />
    </div>
  );
});
