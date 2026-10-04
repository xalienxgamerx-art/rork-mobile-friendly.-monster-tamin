import { memo, useEffect, useRef } from "react";
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Droplets, Footprints, Leaf, Mountain, Sun, Thermometer, Wind, Crown, Swords, Utensils, Navigation } from "lucide-react";
import { wildMonster } from "@/game/battle";
import { BIOMES, ITEMS, PERSONALITIES, SPECIES, STAT_LABEL, TRAITS } from "@/game/data";
import { GENE_FOR, geneGrade, statsOf } from "@/game/monster";
import { hash2 } from "@/game/rng";
import { compass, creatureAt, dangerLevel, canSee } from "@/game/sim";
import { biomeTex, featureTex } from "@/game/tiles";
import type { GameState, StatKey, WeatherId, WildCreature } from "@/game/types";
import { getWorld } from "@/game/world";
import { cn } from "@/lib/utils";
import { Bar, ElementBadge, Portrait, Tag, hpColor } from "./ui";

export const WEATHER_ICON: Record<WeatherId, typeof Sun> = {
  clear: Sun, cloudy: Cloud, rain: CloudRain, storm: CloudLightning, snow: CloudSnow, fog: CloudFog, sandstorm: Wind,
};
export const WEATHER_NAME: Record<WeatherId, string> = {
  clear: "Clear", cloudy: "Overcast", rain: "Rain", storm: "Thunderstorm", snow: "Snowfall", fog: "Fog", sandstorm: "Sandstorm",
};

const FEATURE_DESC: Record<string, string> = {
  hamlet: "A small hamlet. Inn, trader, and friendly faces.",
  ruin: "Old stones from an older people. Something may be buried here.",
  shrine: "A shrine of twisted roots. Two monsters may be joined here.",
  lair: "A lair. Its alpha guards it fiercely.",
};

const TileThumb = memo(function TileThumb({ gs, x, y }: { gs: GameState; x: number; y: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const world = getWorld(gs.seed);
    const ts = 32;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const t = world.tile(x + dx, y + dy);
        const X = (dx + 3) * ts;
        const Y = (dy + 1) * ts;
        ctx.drawImage(biomeTex(t.biome, hash2(gs.seed, x + dx, y + dy) % 4), X, Y, ts, ts);
        if (t.feature) ctx.drawImage(featureTex(t.feature.kind), X, Y, ts, ts);
      }
    }
    ctx.strokeStyle = "#fff4dc";
    ctx.lineWidth = 2;
    ctx.strokeRect(3 * ts + 1, ts + 1, ts - 2, ts - 2);
  }, [gs, x, y]);
  return <canvas ref={ref} width={224} height={96} className="pixel h-auto w-full rounded border-2 border-frame/70" />;
});

function Row({ icon: Icon, children }: { icon: typeof Sun; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[13px] leading-snug">
      <Icon className="mt-[2px] h-3.5 w-3.5 shrink-0 opacity-70" />
      <span>{children}</span>
    </div>
  );
}

export function TileCard({ gs, x, y }: { gs: GameState; x: number; y: number }) {
  const world = getWorld(gs.seed);
  const t = world.tile(x, y);
  const b = BIOMES[t.biome];
  const w = world.weather(x, y, gs.tick);
  const WIcon = WEATHER_ICON[w.id];
  const forage = b.passable ? world.forage(x, y, gs.tick, gs.depleted) : null;
  const danger = b.passable ? dangerLevel(world, x, y, t.biome, 1) : 0;
  const here = x === gs.player.x && y === gs.player.y;
  return (
    <div className="panel-parchment corners p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="truncate font-serif text-[17px] font-extrabold">{world.tileTitle(t)}</div>
        <div className="shrink-0 font-mono text-[11px] opacity-70">({x}, {y})</div>
      </div>
      <TileThumb gs={gs} x={x} y={y} />
      <div className="mt-2 space-y-1">
        <Row icon={Leaf}><b>{b.name}</b>{t.river && t.biome !== "river" ? " · River" : ""} · {b.vegetation}</Row>
        <Row icon={Mountain}>Elevation {t.height > 0 ? `${t.height} m` : `${-t.height} m deep`} · {world.regionName(x, y)} lands</Row>
        <Row icon={Thermometer}>Temp {w.temp}°C · <Droplets className="inline h-3 w-3" /> Humidity {w.humidity}%</Row>
        <Row icon={WIcon}>{WEATHER_NAME[w.id]} · Wind {Math.round(w.wind * 40)} km/h</Row>
        {b.passable ? <Row icon={Footprints}>Movement cost {b.cost} · Danger Lv ~{danger}</Row> : <Row icon={Footprints}>Impassable</Row>}
        {b.passable && b.forage.length ? (
          <Row icon={Utensils}>{forage ? <>Forage: <b style={{ color: "#5a6b1a" }}>{ITEMS[forage].name}</b></> : gs.depleted[`${x},${y}`] !== undefined ? "Picked clean recently" : "Nothing to forage right now"}</Row>
        ) : null}
      </div>
      <p className="mt-1.5 text-[12px] italic opacity-70">{t.feature ? FEATURE_DESC[t.feature.kind] : b.blurb}{here ? " You are here." : ""}</p>
    </div>
  );
}

const DISP_COLOR: Record<string, string> = { curious: "#2a8a7a", skittish: "#8a6a2a", aggressive: "#b23a48", calm: "#3f7fd0" };

export function CreatureCard({
  gs, c, onFight, onFeed, onApproach,
}: {
  gs: GameState;
  c: WildCreature;
  onFight: () => void;
  onFeed: () => void;
  onApproach: () => void;
}) {
  const sp = SPECIES[c.speciesId];
  const mon = wildMonster(gs, c);
  const st = statsOf(mon);
  const hp = Math.round(st.hp * c.hpFrac);
  const scholar = gs.player.origin === "scholar";
  const d = Math.max(Math.abs(c.x - gs.player.x), Math.abs(c.y - gs.player.y));
  const calm = c.calmUntil > gs.tick;
  const disp = calm ? "calm" : c.disposition;
  const hostile = c.stalking || (c.disposition === "aggressive" && !calm);
  return (
    <div className="panel-parchment corners p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate font-serif text-[17px] font-extrabold">
          {c.alpha ? <Crown className="h-4 w-4 text-[#b8860b]" /> : null}
          {c.alpha ? "Great " : "Wild "}{sp.name} <span className="font-pixel text-sm font-normal opacity-80">Lv {c.level}</span>
        </div>
      </div>
      <div className="flex gap-3">
        <Portrait speciesId={c.speciesId} size={84} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-14 font-mono">HP {hp}/{st.hp}</span>
            <Bar value={hp} max={st.hp} color={hpColor(c.hpFrac)} className="flex-1" />
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-14 font-mono">Hunger {Math.round(100 - c.satiety)}%</span>
            <Bar value={100 - c.satiety} max={100} color="linear-gradient(180deg,#f2c14e,#c98a2b)" className="flex-1" />
          </div>
          <div className="text-[13px] font-bold" style={{ color: DISP_COLOR[disp] }}>
            Disposition: <span className="capitalize">{disp}</span>
          </div>
          <div className="text-[12px] opacity-80">{c.activity} · {d <= 1 ? "adjacent" : `${d} tiles ${compass(c.x - gs.player.x, c.y - gs.player.y).replace("to the ", "")}`}</div>
        </div>
      </div>
      <p className="mt-2 text-[13px] leading-snug opacity-80">{sp.desc}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        <ElementBadge element={sp.element} />
        <Tag color="#6b5a7a">{sp.family}</Tag>
        <Tag color="#7a6a4a">{PERSONALITIES[c.personality].name}</Tag>
        {sp.traits.map((t) => <Tag key={t} color="#4a6a5a">{TRAITS[t].name}</Tag>)}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1 text-center">
        {(Object.keys(st) as StatKey[]).map((k) => (
          <div key={k} className="rounded bg-black/5 py-0.5">
            <div className="font-mono text-[10px] opacity-60">{STAT_LABEL[k]}</div>
            <div className="font-pixel text-[15px] leading-tight">{st[k]}</div>
            <div className="font-mono text-[9px] opacity-60">{scholar ? geneGrade(mon.genes[GENE_FOR[k]]) : "?"}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[12px] opacity-75">
        Diet <span className="capitalize">{sp.diet}</span> · Likes {gs.seen[c.speciesId] || scholar ? ITEMS[sp.likes].name : "???"}
        {c.affection > 0 ? ` · Affection ${c.affection}/100` : ""}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        {d <= 1 ? (
          <>
            <button className="btn-game btn-parch h-11 text-sm" onClick={onFeed}><Utensils className="h-4 w-4" /> Offer Food</button>
            <button className={cn("btn-game h-11 text-sm", hostile ? "btn-ember" : "btn-night")} onClick={onFight}><Swords className="h-4 w-4" /> {hostile ? "Fight" : "Challenge"}</button>
          </>
        ) : (
          <button className="btn-game btn-night col-span-2 h-11 text-sm" onClick={onApproach}><Navigation className="h-4 w-4" /> Approach</button>
        )}
      </div>
    </div>
  );
}

export function useSelectedCreature(gs: GameState, sel: { x: number; y: number } | null): WildCreature | null {
  if (!sel) return null;
  const c = creatureAt(gs, sel.x, sel.y);
  return c && canSee(gs, c.x, c.y) ? c : null;
}
