import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Backpack, BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, Flame, Home, Hourglass, LogOut, PawPrint,
  Search, Sparkles, Sprout, Tent, Volume2, VolumeX, X,
} from "lucide-react";
import { startBattle } from "@/game/battle";
import { BIOMES } from "@/game/data";
import { displayName, statOf } from "@/game/monster";
import { forageHere, movePlayer, searchRuin, waitTurn, type ActionResult } from "@/game/sim";
import { act, playMusic, saveNow, setScreen, toggleMute, useGame } from "@/game/store";
import type { GameState, LogKind } from "@/game/types";
import { SEASONS, findPath, getWorld, seasonIndex, timeOf } from "@/game/world";
import { cn } from "@/lib/utils";
import { BestiarySheet } from "./Bestiary";
import { CreatureCard, TileCard, WEATHER_ICON, WEATHER_NAME, useSelectedCreature } from "./Inspector";
import { BagSheet, CampSheet, HamletSheet, OfferSheet, PartySheet, ShrineSheet } from "./Sheets";
import { WorldMap } from "./WorldMap";
import { Bar, Portrait, hpColor } from "./ui";

const LOG_COLOR: Record<LogKind, string> = {
  info: "text-parchment/80", event: "text-[#9fd3e6]", combat: "text-[#ffb347]", system: "text-gold", good: "text-[#7be08a]", bad: "text-[#ff8a7a]", weather: "text-[#c9b7e6]",
};

type SheetId = "party" | "bag" | "bestiary" | "camp" | "hamlet" | "shrine" | "offer" | null;

export function GameScreen() {
  const { gs, v, muted } = useGame();
  const state = gs as GameState;
  const [sel, setSel] = useState<{ x: number; y: number } | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [path, setPath] = useState<[number, number][] | null>(null);
  const [logOpen, setLogOpen] = useState<boolean>(false);
  const travelRef = useRef<number | null>(null);
  const world = getWorld(state.seed);

  const stopTravel = useCallback((): void => {
    if (travelRef.current !== null) window.clearInterval(travelRef.current);
    travelRef.current = null;
    setPath(null);
  }, []);

  const handleResult = useCallback((r: ActionResult | undefined): boolean => {
    if (r?.battleWith) {
      stopTravel();
      act((g) => startBattle(g, r.battleWith as string, r.ambush));
      playMusic("battle");
      return true;
    }
    if (r?.bumped) {
      const c = state.creatures[r.bumped];
      if (c) setSel({ x: c.x, y: c.y });
    }
    return false;
  }, [state, stopTravel]);

  const step = useCallback((dx: number, dy: number): void => {
    stopTravel();
    const r = act((g) => movePlayer(g, dx, dy));
    handleResult(r);
  }, [handleResult, stopTravel]);

  const travelTo = useCallback((tx: number, ty: number): void => {
    stopTravel();
    const p = findPath(world, state.player.x, state.player.y, tx, ty);
    if (!p || !p.length) {
      act((g) => { g.logSeq += 1; g.log.push({ id: g.logSeq, tick: g.tick, text: "You can't find a way there.", kind: "info" }); });
      return;
    }
    const queue = [...p];
    setPath(queue);
    const startStalkers = Object.values(state.creatures).filter((c) => c.stalking).length;
    travelRef.current = window.setInterval(() => {
      const next = queue.shift();
      if (!next) return stopTravel();
      const g = state;
      const dx = next[0] - g.player.x;
      const dy = next[1] - g.player.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return stopTravel();
      const r = act((gg) => movePlayer(gg, dx, dy));
      if (handleResult(r) || !r?.ok) return stopTravel();
      setPath([...queue]);
      const stalkers = Object.values(g.creatures).filter((c) => c.stalking).length;
      if (stalkers > startStalkers || world.tile(g.player.x, g.player.y).feature) stopTravel();
    }, 120);
  }, [handleResult, state, stopTravel, world]);

  useEffect(() => () => stopTravel(), [stopTravel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (sheet || state.battle) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const map: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
        y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1], q: [-1, -1], e: [1, -1], z: [-1, 1], c: [1, 1],
      };
      const m = map[e.key];
      if (m) {
        e.preventDefault();
        step(m[0], m[1]);
      } else if (e.key === "." || e.key === " ") {
        e.preventDefault();
        handleResult(act((g) => waitTurn(g, 1)));
      } else if (e.key === "g" || e.key === "f") handleResult(act((g) => forageHere(g)));
      else if (e.key === "p") setSheet("party");
      else if (e.key === "i") setSheet("bag");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, state, step, handleResult]);

  const onTap = useCallback((x: number, y: number): void => {
    const px = state.player.x;
    const py = state.player.y;
    if (x === px && y === py) {
      setSel({ x, y });
      return;
    }
    const adj = Math.abs(x - px) <= 1 && Math.abs(y - py) <= 1;
    if (sel && sel.x === x && sel.y === y) {
      if (adj) step(x - px, y - py);
      else travelTo(x, y);
      return;
    }
    setSel({ x, y });
  }, [sel, state, step, travelTo]);

  const time = timeOf(state.tick);
  const weather = world.weather(state.player.x, state.player.y, state.tick);
  const WIcon = WEATHER_ICON[weather.id];
  const here = world.tile(state.player.x, state.player.y);
  const feature = here.feature;
  const selCreature = useSelectedCreature(state, sel);
  const inspectAt = sel ?? { x: state.player.x, y: state.player.y };
  const canForage = BIOMES[here.biome].forage.length > 0;
  const recentLog = useMemo(() => state.log.slice(-60), [state.log, v]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.logSeq, logOpen]);

  const openOffer = (id: string): void => {
    setOfferId(id);
    setSheet("offer");
  };
  const fight = (id: string): void => {
    const c = state.creatures[id];
    if (!c || !state.party.some((m) => m.hp > 0)) return;
    handleResult({ ok: true, battleWith: id, ambush: false });
  };

  const inspector = (
    <div className="space-y-3">
      {selCreature ? (
        <CreatureCard
          gs={state}
          c={selCreature}
          onFight={() => fight(selCreature.id)}
          onFeed={() => openOffer(selCreature.id)}
          onApproach={() => travelTo(selCreature.x, selCreature.y)}
        />
      ) : null}
      <TileCard gs={state} x={inspectAt.x} y={inspectAt.y} />
      {sel && !(sel.x === state.player.x && sel.y === state.player.y) && !selCreature && BIOMES[world.tile(sel.x, sel.y).biome].passable ? (
        <button className="btn-game btn-night h-11 w-full text-sm" onClick={() => travelTo(sel.x, sel.y)}>
          <Compass className="h-4 w-4" /> Travel here
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-night">
      {/* Top bar */}
      <header className="z-20 flex items-center gap-2 border-b-2 border-frame/70 bg-night-2 px-2 py-1.5 sm:px-3 safe-top">
        <button onClick={() => { saveNow(); playMusic(null); setScreen("title"); }} className="wordmark hidden px-1 text-2xl sm:block" aria-label="Back to title">EMBERWILD</button>
        <Flame className="h-6 w-6 text-ember sm:hidden" fill="#f2c14e" />
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto sm:ml-3 sm:gap-1">
          <TopTab icon={PawPrint} label="Monsters" onClick={() => setSheet("party")} />
          <TopTab icon={Backpack} label="Bag" onClick={() => setSheet("bag")} />
          <TopTab icon={BookOpen} label="Bestiary" onClick={() => setSheet("bestiary")} />
          <TopTab icon={Tent} label="Camp" onClick={() => setSheet("camp")} />
        </nav>
        <div className="flex items-center gap-2 pl-1">
          <WIcon className={cn("h-6 w-6", weather.id === "clear" ? "text-gold" : "text-parchment/80")} />
          <div className="text-right leading-tight">
            <div className="font-pixel text-[14px] text-parchment">Day {time.day}</div>
            <div className="font-mono text-[10.5px] text-parchment/60">{time.phase} · {time.label}</div>
          </div>
          <button onClick={toggleMute} className="hidden h-10 w-10 place-items-center rounded-md text-parchment/70 hover:bg-white/5 sm:grid" aria-label="Toggle music">
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button onClick={() => { saveNow(); playMusic(null); setScreen("title"); }} className="grid h-10 w-10 place-items-center rounded-md text-parchment/70 hover:bg-white/5" aria-label="Save and quit">
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <WorldMap gs={state} v={v} selected={sel} path={path} onTap={onTap} />

            {/* Party strip */}
            <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1.5">
              {state.party.map((m) => {
                const max = statOf(m, "hp");
                return (
                  <button key={m.uid} onClick={() => setSheet("party")} className="pointer-events-auto flex items-center gap-1.5 rounded-md border-2 border-frame/80 bg-night/85 p-1 pr-2 backdrop-blur-sm">
                    <Portrait speciesId={m.speciesId} size={34} />
                    <div className="w-[78px] text-left">
                      <div className="flex justify-between font-pixel text-[11px] leading-none text-parchment">
                        <span className="truncate">{displayName(m)}</span>
                        <span className="text-parchment/50">{m.level}</span>
                      </div>
                      <Bar value={m.hp} max={max} color={hpColor(m.hp / max)} className="mt-1 h-1.5" />
                      <Bar value={m.satiety} max={100} color="linear-gradient(180deg,#f2c14e,#c98a2b)" className="mt-0.5 h-1" />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Compass / coordinates */}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border-2 border-frame/80 bg-night/85 px-2 py-1 font-mono text-[11px] text-parchment/80 backdrop-blur-sm">
              <div className="font-pixel text-[12px] text-gold">{world.regionName(state.player.x, state.player.y)}</div>
              {state.player.x}, {state.player.y} · {SEASONS[seasonIndex(state.tick)]} · {weather.temp}°C · {WEATHER_NAME[weather.id]}
              <div className="text-parchment/60">{state.player.gold}g</div>
            </div>

            {/* D-pad */}
            <DPad onStep={step} onWait={() => handleResult(act((g) => waitTurn(g, 1)))} />

            {path ? (
              <button onClick={stopTravel} className="btn-game btn-night absolute left-1/2 top-2 h-10 -translate-x-1/2 text-sm">
                <X className="h-4 w-4" /> Stop travelling
              </button>
            ) : null}
          </div>

          {/* Action bar */}
          <div className="z-10 flex gap-1.5 overflow-x-auto border-t-2 border-frame/70 bg-night-2 px-2 py-1.5">
            {feature?.kind === "hamlet" ? <ActBtn icon={Home} label={`Enter ${feature.name}`} primary onClick={() => setSheet("hamlet")} /> : null}
            {feature?.kind === "shrine" ? <ActBtn icon={Sparkles} label="Shrine" primary onClick={() => setSheet("shrine")} /> : null}
            {feature?.kind === "ruin" ? <ActBtn icon={Search} label="Search Ruins" primary onClick={() => handleResult(act((g) => searchRuin(g)))} /> : null}
            <ActBtn icon={Sprout} label="Forage" disabled={!canForage} onClick={() => handleResult(act((g) => forageHere(g)))} />
            <ActBtn icon={Hourglass} label="Wait 1h" onClick={() => handleResult(act((g) => waitTurn(g, 12)))} />
            <ActBtn icon={Tent} label="Camp" onClick={() => setSheet("camp")} />
            <ActBtn icon={Compass} label="Inspect" className="lg:hidden" onClick={() => setSel(sel ?? { x: state.player.x, y: state.player.y })} />
          </div>

          {/* Log */}
          <div className="z-10 border-t-2 border-frame/70 bg-night">
            <button onClick={() => setLogOpen((o) => !o)} className="flex h-7 w-full items-center justify-between px-3 font-pixel text-[12px] text-gold/80 sm:hidden">
              Log {logOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
            <div ref={logRef} className={cn("log-scroll overflow-y-auto px-3 pb-2 font-mono text-[12px] leading-[1.5] sm:h-[132px] sm:pt-2 sm:text-[12.5px]", logOpen ? "h-[38vh]" : "h-[64px]")}>
              {recentLog.map((l) => {
                const t = timeOf(l.tick);
                return (
                  <div key={l.id} className={LOG_COLOR[l.kind]}>
                    <span className="mr-2 text-parchment/30">[{t.label}]</span>
                    {l.text}
                  </div>
                );
              })}
            </div>
          </div>
        </main>

        {/* Desktop inspector */}
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l-2 border-frame/70 bg-night-2 p-3 lg:block">{inspector}</aside>
      </div>

      {/* Mobile inspector sheet */}
      {sel ? (
        <div className="fixed inset-x-0 bottom-0 z-30 max-h-[70dvh] overflow-y-auto rounded-t-xl border-t-2 border-frame bg-night-2 p-3 shadow-[0_-10px_30px_rgba(0,0,0,.5)] animate-in slide-in-from-bottom-8 duration-200 lg:hidden safe-bottom">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-pixel text-gold">Inspect</span>
            <button onClick={() => setSel(null)} className="grid h-10 w-10 place-items-center rounded-md text-parchment/80" aria-label="Close inspector"><X className="h-5 w-5" /></button>
          </div>
          {inspector}
          <p className="mt-2 text-center text-[11px] text-parchment/50">Tip: tap a selected tile again to travel there.</p>
        </div>
      ) : null}

      <PartySheet gs={state} open={sheet === "party"} onClose={() => setSheet(null)} atHamlet={feature?.kind === "hamlet"} />
      <BagSheet gs={state} open={sheet === "bag"} onClose={() => setSheet(null)} />
      <BestiarySheet open={sheet === "bestiary"} onClose={() => setSheet(null)} />
      <CampSheet gs={state} open={sheet === "camp"} onClose={() => setSheet(null)} onBattle={(id) => handleResult({ ok: true, battleWith: id, ambush: true })} />
      {feature?.kind === "hamlet" ? <HamletSheet gs={state} open={sheet === "hamlet"} onClose={() => setSheet(null)} name={feature.name} onParty={() => setSheet("party")} /> : null}
      {feature?.kind === "shrine" ? <ShrineSheet gs={state} open={sheet === "shrine"} onClose={() => setSheet(null)} name={feature.name} /> : null}
      <OfferSheet gs={state} open={sheet === "offer"} onClose={() => setSheet(null)} creatureId={offerId} onBattle={(id) => handleResult({ ok: true, battleWith: id, ambush: true })} />
    </div>
  );
}

function TopTab({ icon: Icon, label, onClick }: { icon: typeof Home; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-pixel text-[14px] text-parchment/85 hover:bg-white/5 hover:text-parchment sm:px-3">
      <Icon className="h-5 w-5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function ActBtn({ icon: Icon, label, onClick, disabled, primary, className }: { icon: typeof Home; label: string; onClick: () => void; disabled?: boolean; primary?: boolean; className?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn("btn-game h-11 shrink-0 px-3 text-[13px]", primary ? "btn-ember" : "btn-night", className)}>
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function DPad({ onStep, onWait }: { onStep: (dx: number, dy: number) => void; onWait: () => void }) {
  const cell = "grid h-12 w-12 place-items-center rounded-md border-2 border-frame/80 bg-night/80 text-parchment backdrop-blur-sm active:scale-90 active:bg-ember/40 transition-transform";
  const diag = "grid h-12 w-12 place-items-center rounded-md text-parchment/50 active:scale-90 active:bg-ember/30 transition-transform";
  return (
    <div className="absolute bottom-2 right-2 grid grid-cols-3 gap-1 opacity-95 lg:opacity-80" aria-label="Movement pad">
      <button className={diag} onClick={() => onStep(-1, -1)} aria-label="North-west">↖</button>
      <button className={cell} onClick={() => onStep(0, -1)} aria-label="North"><ChevronUp className="h-6 w-6" /></button>
      <button className={diag} onClick={() => onStep(1, -1)} aria-label="North-east">↗</button>
      <button className={cell} onClick={() => onStep(-1, 0)} aria-label="West"><ChevronLeft className="h-6 w-6" /></button>
      <button className={cn(cell, "font-pixel text-xs")} onClick={onWait} aria-label="Wait a turn">wait</button>
      <button className={cell} onClick={() => onStep(1, 0)} aria-label="East"><ChevronRight className="h-6 w-6" /></button>
      <button className={diag} onClick={() => onStep(-1, 1)} aria-label="South-west">↙</button>
      <button className={cell} onClick={() => onStep(0, 1)} aria-label="South"><ChevronDown className="h-6 w-6" /></button>
      <button className={diag} onClick={() => onStep(1, 1)} aria-label="South-east">↘</button>
    </div>
  );
}
