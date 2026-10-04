import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Footprints, Hand, Hourglass, PackageOpen, Sparkles, Swords, Wind, X, Shield, Crown } from "lucide-react";
import { MONSTER_ART } from "@/game/assets";
import {
  ITEM_RANGE, TAME_RANGE, TERRAIN_INFO, affectedTiles, aiAct, aiPlan, attemptTame, avOf, currentUnit, dist, dvOf, endPlayerTurn,
  finishBattle, hitInfo, moveRange, moveUnit, reachable, skillReady, skillTargets, tameOdds, tileAt, tryFlee, unitAt, unitName, useBattleItem, useSkill,
} from "@/game/battle";
import { ELEMENTS, ITEMS, PERSONALITIES, SKILLS, SPECIES, STATUSES } from "@/game/data";
import { displayName } from "@/game/monster";
import { act, playMusic } from "@/game/store";
import { terrainTex } from "@/game/tiles";
import type { BLogKind, BUnit, BattleState, GameState, ItemId, Terrain } from "@/game/types";
import { cn } from "@/lib/utils";
import { WEATHER_ICON, WEATHER_NAME } from "./Inspector";
import { Bar, ElementBadge, Portrait, Tag, hpColor } from "./ui";

const texUrls = new Map<string, string>();
function terrainUrl(t: Terrain, v: number): string {
  const k = `${t}:${v}`;
  let u = texUrls.get(k);
  if (!u) {
    u = terrainTex(t, v).toDataURL();
    texUrls.set(k, u);
  }
  return u;
}

const LOG_COLOR: Record<BLogKind, string> = {
  hit: "text-parchment", miss: "text-parchment/55", info: "text-parchment/75", good: "text-[#7be08a]", bad: "text-[#ff8a7a]", status: "text-[#f2c14e]", crit: "text-[#ffb347]",
};

function basicSkill(u: BUnit): string | null {
  const ready = u.mon.skills.filter((s) => SKILLS[s] && skillReady(u, s) && SKILLS[s].target === "enemy" && SKILLS[s].dice[0] > 0);
  return ready.find((s) => SKILLS[s].cooldown === 0) ?? ready[0] ?? null;
}

type Pending = { x: number; y: number } | null;

export function BattleScreen({ gs, v }: { gs: GameState; v: number }) {
  const b = gs.battle as BattleState;
  const cur = currentUnit(b);
  const playerTurn = b.phase === "player" && !!cur && cur.side === "party" && !b.acted;
  const [pending, setPending] = useState<Pending>(null);
  const [hover, setHover] = useState<Pending>(null);
  const [menu, setMenu] = useState<"skill" | "item" | null>(null);
  const [tab, setTab] = useState<"log" | "order" | "target">("log");
  const turnKey = `${b.round}:${b.turn}:${b.phase}`;

  useEffect(() => {
    setPending(null);
    setMenu(null);
  }, [turnKey]);

  useEffect(() => {
    if (b.phase !== "enemy") return;
    let t2: number | undefined;
    const t1 = window.setTimeout(() => {
      act((g) => aiPlan(g));
      t2 = window.setTimeout(() => act((g) => aiAct(g)), 430);
    }, 300);
    return () => {
      window.clearTimeout(t1);
      if (t2) window.clearTimeout(t2);
    };
  }, [turnKey, b.phase]);

  const endSoon = (): void => {
    window.setTimeout(() => act((g) => {
      if (g.battle && g.battle.phase !== "over") endPlayerTurn(g);
    }), 480);
  };

  const reach = useMemo(() => (playerTurn && cur && b.mode === "move" ? reachable(b, cur) : new Map<number, number>()), [playerTurn, cur, b, b.mode, v]);

  const skillId = b.mode === "attack" || b.mode === "skill" ? b.skill : null;
  const targets = useMemo(() => {
    const s = new Set<number>();
    if (!playerTurn || !cur) return s;
    if (skillId) for (const [x, y] of skillTargets(b, cur, skillId)) s.add(y * b.cols + x);
    else if (b.mode === "tame") {
      for (const u of b.units) if (u.state === "active" && u.side === "wild" && dist(u.x, u.y, cur.x, cur.y) <= TAME_RANGE) s.add(u.y * b.cols + u.x);
    } else if (b.mode === "item" && b.item) {
      for (const u of b.units) if (u.state === "active" && dist(u.x, u.y, cur.x, cur.y) <= ITEM_RANGE) s.add(u.y * b.cols + u.x);
    } else if (b.mode === "move") {
      const bs = basicSkill(cur);
      if (bs) for (const [x, y] of skillTargets(b, cur, bs)) if (SKILLS[bs].range <= 1 || dist(x, y, cur.x, cur.y) <= 1) s.add(y * b.cols + x);
    }
    return s;
  }, [playerTurn, cur, skillId, b, b.mode, b.item, v]);

  const preview = useMemo(() => {
    const s = new Set<number>();
    const p = pending ?? hover;
    if (!p || !cur || !skillId || !targets.has(p.y * b.cols + p.x)) return s;
    if (SKILLS[skillId].radius > 0) for (const [x, y] of affectedTiles(b, cur, skillId, p.x, p.y)) s.add(y * b.cols + x);
    return s;
  }, [pending, hover, cur, skillId, targets, b]);

  const onTile = (x: number, y: number): void => {
    if (!cur) return;
    const k = y * b.cols + x;
    const occ = unitAt(b, x, y);
    if (!playerTurn) {
      if (occ) act((g) => { if (g.battle) g.battle.focus = occ.id; });
      return;
    }
    if (skillId && targets.has(k)) {
      const sk = SKILLS[skillId];
      if (sk.radius > 0 && (!pending || pending.x !== x || pending.y !== y)) {
        setPending({ x, y });
        if (occ) act((g) => { if (g.battle) g.battle.focus = occ.id; });
        return;
      }
      act((g) => useSkill(g, currentUnit(g.battle as BattleState) as BUnit, skillId, x, y));
      endSoon();
      return;
    }
    if (b.mode === "tame" && targets.has(k) && occ) {
      act((g) => attemptTame(g, currentUnit(g.battle as BattleState) as BUnit, occ));
      endSoon();
      return;
    }
    if (b.mode === "item" && b.item && targets.has(k) && occ) {
      const item = b.item;
      act((g) => useBattleItem(g, currentUnit(g.battle as BattleState) as BUnit, item, occ));
      endSoon();
      return;
    }
    if (b.mode === "move") {
      if (occ && targets.has(k)) {
        const bs = basicSkill(cur);
        if (bs) {
          act((g) => useSkill(g, currentUnit(g.battle as BattleState) as BUnit, bs, x, y));
          endSoon();
          return;
        }
      }
      if (!occ && reach.has(k) && !b.moved) {
        act((g) => moveUnit(g, currentUnit(g.battle as BattleState) as BUnit, x, y));
        return;
      }
    }
    if (occ) act((g) => { if (g.battle) g.battle.focus = occ.id; });
  };

  const setMode = (mode: BattleState["mode"], skill: string | null = null, item: ItemId | null = null): void => {
    setPending(null);
    setMenu(null);
    if (skill && cur && SKILLS[skill].target === "self") {
      act((g) => useSkill(g, currentUnit(g.battle as BattleState) as BUnit, skill, cur.x, cur.y));
      endSoon();
      return;
    }
    act((g) => {
      const bb = g.battle as BattleState;
      bb.mode = bb.mode === mode && bb.skill === skill && mode !== "move" && !item ? "move" : mode;
      bb.skill = skill;
      bb.item = item;
    });
  };

  const toggleAuto = (): void => {
    act((g) => {
      const bb = g.battle as BattleState;
      bb.auto = !bb.auto;
      if (bb.auto && bb.phase === "player" && !bb.acted) bb.phase = "enemy";
    });
  };

  const focusUnit = b.units.find((u) => u.id === b.focus) ?? cur;
  const WIcon = WEATHER_ICON[b.weather];
  const basic = cur ? basicSkill(cur) : null;
  const bagItems = (Object.keys(gs.bag) as ItemId[]).filter((k) => (gs.bag[k] ?? 0) > 0);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-night lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b-2 border-frame/60 bg-night-2 px-3 py-2 safe-top">
          <div className="min-w-0">
            <div className="truncate font-pixel text-[15px] text-gold">{b.regionName}</div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-parchment/60">
              <WIcon className="h-3.5 w-3.5" /> {WEATHER_NAME[b.weather]} · {b.night ? "Night" : "Day"} · Round {b.round}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggleAuto} className={cn("btn-game h-10 px-3 text-sm", b.auto ? "btn-teal" : "btn-night")} disabled={b.phase === "over"}>
              <Bot className="h-4 w-4" /> Auto
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#1a1530] p-1.5 sm:p-3">
          <BattleGrid b={b} v={v} reach={reach} targets={targets} preview={preview} pending={pending} cur={cur} playerTurn={playerTurn} onTile={onTile} onHover={setHover} />
          {b.phase === "enemy" && cur ? (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md border-2 border-frame bg-night/90 px-3 py-1 font-pixel text-sm text-parchment shadow-lg">
              {cur.side === "wild" ? `${displayName(cur.mon)}'s turn` : `${displayName(cur.mon)} (auto)`}
            </div>
          ) : null}
        </div>

        <div className="relative border-t-2 border-frame/60 bg-night-2 px-2 pb-2 pt-2 sm:px-3">
          {playerTurn && cur ? (
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] text-parchment/70">
              <span className="font-pixel text-[13px] text-gold">{displayName(cur.mon)}: your turn</span>
              <span className="font-mono">
                {b.mode === "move" ? (b.moved ? "Moved · act or wait" : `Move ${moveRange(cur)} · tap gold tiles`) : b.mode === "tame" ? "Tap a wild monster" : b.mode === "item" ? `Use ${b.item ? ITEMS[b.item].name : ""}: tap a monster` : skillId ? `${SKILLS[skillId].name}: ${SKILLS[skillId].radius ? "tap twice to confirm" : "tap a target"}` : ""}
              </span>
            </div>
          ) : null}

          {menu === "skill" && cur ? (
            <div className="absolute inset-x-2 bottom-full z-20 mb-2 grid max-h-[50vh] gap-1.5 overflow-y-auto rounded-md border-2 border-frame bg-night-2 p-2 shadow-2xl sm:inset-x-3 sm:grid-cols-2">
              {cur.mon.skills.map((s) => {
                const sk = SKILLS[s];
                if (!sk) return null;
                const cd = cur.cooldowns[s] ?? 0;
                return (
                  <button key={s} disabled={cd > 0} onClick={() => setMode("skill", s)} className="flex items-center gap-2 rounded-md border-2 border-frame/50 bg-night-3/60 p-2 text-left hover:border-gold disabled:opacity-40">
                    <span className="h-8 w-1.5 rounded-full" style={{ background: ELEMENTS[sk.element].color }} />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between font-pixel text-[14px] text-parchment">{sk.name}<span className="font-mono text-[10px] text-parchment/60">{sk.dice[0] ? `${sk.dice[0]}d${sk.dice[1]}` : sk.heal ? `+${sk.heal}` : ""} R{sk.range}{sk.radius ? ` AoE${sk.radius}` : ""}</span></span>
                      <span className="block truncate text-[11px] text-parchment/60">{cd > 0 ? `Recharging: ${cd} turn${cd > 1 ? "s" : ""}` : sk.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {menu === "item" ? (
            <div className="absolute inset-x-2 bottom-full z-20 mb-2 grid max-h-[50vh] grid-cols-2 gap-1.5 overflow-y-auto rounded-md border-2 border-frame bg-night-2 p-2 shadow-2xl sm:inset-x-3 sm:grid-cols-3">
              {bagItems.length === 0 ? <div className="col-span-full p-3 text-center text-sm text-parchment/60">Your bag is empty.</div> : null}
              {bagItems.map((id) => (
                <button key={id} onClick={() => setMode("item", null, id)} className="flex items-center gap-2 rounded-md border-2 border-frame/50 bg-night-3/60 p-2 text-left hover:border-gold">
                  <span className="grid h-8 w-8 place-items-center rounded bg-night font-pixel text-lg" style={{ color: ITEMS[id].color }}>{ITEMS[id].glyph}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-bold text-parchment">{ITEMS[id].name}</span>
                    <span className="font-mono text-[10px] text-parchment/60">×{gs.bag[id]} · heal {ITEMS[id].heal}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
            <ActionBtn icon={Swords} label="Attack" primary active={b.mode === "attack"} disabled={!playerTurn || !basic} onClick={() => basic && setMode("attack", basic)} />
            <ActionBtn icon={Sparkles} label="Skill" active={b.mode === "skill" || menu === "skill"} disabled={!playerTurn} onClick={() => setMenu(menu === "skill" ? null : "skill")} />
            <ActionBtn icon={Hand} label="Tame" active={b.mode === "tame"} disabled={!playerTurn} onClick={() => setMode("tame")} />
            <ActionBtn icon={PackageOpen} label="Item" active={b.mode === "item" || menu === "item"} disabled={!playerTurn} onClick={() => setMenu(menu === "item" ? null : "item")} />
            <ActionBtn icon={Hourglass} label="Wait" disabled={!playerTurn} onClick={() => act((g) => { if (g.battle) { g.battle.acted = true; } endPlayerTurn(g); })} />
            <ActionBtn icon={Wind} label="Flee" disabled={!playerTurn} onClick={() => { act((g) => tryFlee(g, currentUnit(g.battle as BattleState) as BUnit)); endSoon(); }} />
          </div>
          {b.mode !== "move" && playerTurn ? (
            <button className="mt-1.5 flex w-full items-center justify-center gap-1 py-1 text-[12px] text-parchment/60 hover:text-parchment" onClick={() => setMode("move")}>
              <X className="h-3 w-3" /> Cancel · back to moving
            </button>
          ) : null}
        </div>

        <div className="border-t-2 border-frame/60 bg-night lg:hidden">
          <div className="flex border-b border-frame/40">
            {(["log", "order", "target"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cn("h-9 flex-1 font-pixel text-[13px] capitalize", tab === t ? "border-b-2 border-ember text-gold" : "text-parchment/60")}>
                {t === "log" ? "Combat Log" : t === "order" ? "Initiative" : "Inspect"}
              </button>
            ))}
          </div>
          <div className="h-[22vh] overflow-y-auto">
            {tab === "log" ? <CombatLog b={b} /> : tab === "order" ? <div className="p-2"><Initiative b={b} /></div> : focusUnit ? <div className="p-2"><UnitInspector gs={gs} b={b} u={focusUnit} cur={cur} skillId={skillId ?? basic} /></div> : null}
          </div>
        </div>
        <div className="hidden h-44 border-t-2 border-frame/60 bg-night lg:block">
          <div className="flex h-8 items-center border-b border-frame/40 px-3 font-pixel text-sm text-gold">Combat Log</div>
          <div className="h-36 overflow-y-auto"><CombatLog b={b} /></div>
        </div>
      </div>

      <aside className="hidden w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l-2 border-frame/60 bg-night-2 p-3 lg:flex">
        <div className="panel-parchment corners p-2">
          <div className="mb-1.5 px-1 font-serif text-[16px] font-extrabold">Initiative Order</div>
          <Initiative b={b} />
        </div>
        {focusUnit ? (
          <div className="panel-parchment corners p-3">
            <UnitInspector gs={gs} b={b} u={focusUnit} cur={cur} skillId={skillId ?? basic} light />
          </div>
        ) : null}
        {hover && tileAt(b, hover.x, hover.y) ? (
          <div className="rounded-md border border-frame/50 bg-night-3/50 p-2 text-[12px] text-parchment/80">
            <b className="font-pixel text-gold">{TERRAIN_INFO[(tileAt(b, hover.x, hover.y) as { t: Terrain }).t].name}</b> · {TERRAIN_INFO[(tileAt(b, hover.x, hover.y) as { t: Terrain }).t].desc}
            {(tileAt(b, hover.x, hover.y)?.fire ?? 0) > 0 ? <span className="text-ember"> On fire!</span> : null}
          </div>
        ) : null}
      </aside>

      {b.phase === "over" && b.summary ? <Summary gs={gs} b={b} /> : null}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick, disabled, active, primary }: { icon: typeof Swords; label: string; onClick: () => void; disabled?: boolean; active?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn("btn-game h-14 flex-col gap-0.5 px-1 text-[12px] sm:h-12 sm:flex-row sm:text-sm", primary ? "btn-ember" : "btn-parch", active && "btn-active")}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

const BattleGrid = memo(function BattleGrid({
  b, v, reach, targets, preview, pending, cur, playerTurn, onTile, onHover,
}: {
  b: BattleState;
  v: number;
  reach: Map<number, number>;
  targets: Set<number>;
  preview: Set<number>;
  pending: Pending;
  cur: BUnit | null;
  playerTurn: boolean;
  onTile: (x: number, y: number) => void;
  onHover: (p: Pending) => void;
}) {
  void v;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 12, h: el.clientHeight - 12 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ts = Math.max(24, Math.floor(Math.min(box.w / b.cols, box.h / b.rows)));
  const W = ts * b.cols;
  const H = ts * b.rows;

  return (
    <div
      ref={wrapRef}
      className="relative rounded-md border-2 border-frame shadow-[0_0_0_2px_#0e0a1c,0_10px_40px_rgba(0,0,0,.6)]"
      style={{ width: W, height: H }}
      onPointerLeave={() => onHover(null)}
    >
      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${b.cols}, ${ts}px)`, gridTemplateRows: `repeat(${b.rows}, ${ts}px)` }}>
        {b.tiles.map((t, i) => {
          const x = i % b.cols;
          const y = Math.floor(i / b.cols);
          const isReach = reach.has(i) && !(cur && cur.x === x && cur.y === y) && !b.moved;
          const isTarget = targets.has(i);
          const isPrev = preview.has(i);
          const isPending = pending && pending.x === x && pending.y === y;
          return (
            <button
              key={i}
              onClick={() => onTile(x, y)}
              onPointerEnter={() => onHover({ x, y })}
              className="relative overflow-hidden"
              style={{ backgroundImage: `url(${terrainUrl(t.t, (x * 7 + y * 13) % 3)})`, backgroundSize: "cover", imageRendering: "pixelated" }}
              aria-label={`Tile ${x},${y}`}
            >
              {b.night ? <span className="absolute inset-0 bg-[#0e0a26]/35" /> : null}
              {isReach && playerTurn ? <span className="absolute inset-[2px] rounded-[2px] bg-gold/35 ring-1 ring-inset ring-gold/70" /> : null}
              {isTarget && playerTurn ? <span className={cn("absolute inset-[2px] rounded-[2px] ring-2 ring-inset", b.mode === "item" || b.mode === "tame" ? "bg-teal/30 ring-teal" : "bg-crimson/30 ring-[#ff6b5a]")} /> : null}
              {isPrev ? <span className="absolute inset-0 bg-ember/45" /> : null}
              {isPending ? <span className="anim-pulse-ring absolute inset-1 rounded-sm ring-2 ring-gold" /> : null}
              {t.fire > 0 ? (
                <span className="anim-flicker absolute inset-0 bg-[radial-gradient(circle_at_50%_75%,rgba(255,214,90,.95),rgba(232,96,30,.7)_40%,rgba(178,58,30,.15)_70%,transparent_80%)]" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="pointer-events-none absolute inset-0">
        {b.units.filter((u) => u.state === "active").map((u) => {
          const sp = SPECIES[u.mon.speciesId];
          const isCur = cur?.id === u.id;
          const size = ts * (0.8 + sp.size * 0.08);
          return (
            <div
              key={u.id}
              className="absolute transition-[left,top] duration-300 ease-out"
              style={{ left: u.x * ts, top: u.y * ts, width: ts, height: ts }}
            >
              <span className="absolute bottom-[6%] left-1/2 h-[14%] w-[60%] -translate-x-1/2 rounded-[50%] bg-black/35" />
              {isCur ? <span className="absolute inset-[1px] rounded-[3px] border-2 border-[#fff4dc] shadow-[0_0_12px_rgba(255,244,220,.6)]" /> : null}
              {isCur ? <span className="absolute -top-[22%] left-1/2 -translate-x-1/2 font-pixel text-[14px] leading-none text-[#fff4dc] anim-bob">▼</span> : null}
              <img
                src={MONSTER_ART[u.mon.speciesId]}
                alt=""
                className={cn("pixel absolute left-1/2 -translate-x-1/2 object-contain", isCur && "anim-bob")}
                style={{ width: size, height: size, bottom: ts * 0.12, transform: `translateX(-50%) scaleX(${u.side === "wild" ? -1 : 1})` }}
                draggable={false}
              />
              {u.side === "wild" && u.mon.plus >= 3 ? <Crown className="absolute left-0.5 top-0.5 h-3 w-3 text-gold" /> : null}
              <div className="absolute inset-x-[12%] bottom-[2px]">
                <div className="h-[5px] overflow-hidden rounded-sm bg-[#0e0a1c] ring-1 ring-black">
                  <div className="h-full transition-[width] duration-500" style={{ width: `${(u.hp / u.maxHp) * 100}%`, background: u.side === "party" ? "#5fd36a" : "#e8483a" }} />
                </div>
              </div>
              {u.statuses.length ? (
                <div className="absolute right-0.5 top-0.5 flex flex-col gap-[2px]">
                  {u.statuses.slice(0, 3).map((s) => <span key={s.id} className="h-[6px] w-[6px] rounded-full ring-1 ring-black" style={{ background: STATUSES[s.id].color }} />)}
                </div>
              ) : null}
            </div>
          );
        })}
        {b.fx.map((f) => (
          <span
            key={f.id}
            className="anim-float-up absolute whitespace-nowrap font-pixel text-[15px] font-bold"
            style={{ left: (f.x + 0.5) * ts, top: f.y * ts, color: f.color, textShadow: "0 2px 0 #0e0a1c, 0 0 4px #0e0a1c" }}
          >
            {f.text}
          </span>
        ))}
      </div>
    </div>
  );
});

function CombatLog({ b }: { b: BattleState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [b.logSeq]);
  return (
    <div ref={ref} className="h-full space-y-0.5 overflow-y-auto px-3 py-2 font-mono text-[12.5px] leading-snug">
      {b.log.map((l) => (
        <div key={l.id} className={LOG_COLOR[l.kind]}>
          <span className="mr-2 text-parchment/30">[R{l.round}]</span>
          {l.text}
        </div>
      ))}
    </div>
  );
}

function Initiative({ b }: { b: BattleState }) {
  return (
    <div className="space-y-1">
      {b.order.map((id, i) => {
        const u = b.units.find((x) => x.id === id);
        if (!u || u.state !== "active") return null;
        const isCur = i === b.turn;
        return (
          <button
            key={id}
            onClick={() => act((g) => { if (g.battle) g.battle.focus = id; })}
            className={cn("flex w-full items-center gap-2 rounded border-2 p-1 text-left", isCur ? "border-ember bg-ember/20" : "border-frame/30 bg-night-3/70")}
          >
            <span className="w-3 font-mono text-[10px] text-parchment/50">{isCur ? "▶" : ""}</span>
            <Portrait speciesId={u.mon.speciesId} size={34} />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate font-pixel text-[13px]", u.side === "party" ? "text-parchment" : "text-[#ffb4a8]")}>
                {displayName(u.mon)}{isCur && u.side === "party" ? <span className="text-gold"> · your turn</span> : ""}
              </span>
              <Bar value={u.hp} max={u.maxHp} color={u.side === "party" ? "linear-gradient(180deg,#7be08a,#3d9a4f)" : "linear-gradient(180deg,#ff6b5a,#b23a48)"} className="mt-0.5 h-1.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UnitInspector({ gs, b, u, cur, skillId, light }: { gs: GameState; b: BattleState; u: BUnit; cur: BUnit | null; skillId: string | null; light?: boolean }) {
  const sp = SPECIES[u.mon.speciesId];
  const enemyOfCur = cur && cur.side === "party" && u.side === "wild";
  const hit = enemyOfCur && skillId && SKILLS[skillId]?.dice[0] ? hitInfo(b, cur, u, skillId) : null;
  const odds = enemyOfCur ? tameOdds(gs, cur, u) : null;
  const t = tileAt(b, u.x, u.y);
  return (
    <div className={light ? "text-ink" : "text-parchment"}>
      <div className="mb-1.5 font-serif text-[16px] font-extrabold">{u.side === "wild" ? "Target" : "Ally"}: {displayName(u.mon)} <span className="font-pixel text-sm font-normal opacity-70">Lv {u.mon.level}</span></div>
      <div className="flex gap-2.5">
        <Portrait speciesId={u.mon.speciesId} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between font-mono text-[12px]"><span>HP</span><span className="font-bold">{u.hp}/{u.maxHp}</span></div>
          <Bar value={u.hp} max={u.maxHp} color={hpColor(u.hp / u.maxHp)} className="mt-0.5" />
          <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[12px]">
            <span className="flex items-center gap-1"><Shield className="h-3 w-3" />AV {avOf(u)}</span>
            <span>DV {dvOf(b, u)}</span>
            <span className="flex items-center gap-1"><Footprints className="h-3 w-3" />{moveRange(u)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            <ElementBadge element={sp.element} />
            <Tag color="#7a6a4a">{PERSONALITIES[u.mon.personality].name}</Tag>
          </div>
        </div>
      </div>
      {u.statuses.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {u.statuses.map((s) => <Tag key={s.id} color={STATUSES[s.id].color}>{STATUSES[s.id].name} {s.turns}</Tag>)}
        </div>
      ) : null}
      <p className="mt-2 text-[12px] leading-snug opacity-75">{sp.desc}</p>
      {t ? <div className="mt-1 text-[11px] opacity-65">Standing on {TERRAIN_INFO[t.t].name.toLowerCase()}{t.fire ? " (burning!)" : ""}. {TERRAIN_INFO[t.t].desc}</div> : null}
      {hit && skillId ? (
        <div className="mt-2 rounded border border-current/20 bg-black/5 p-1.5 font-mono text-[12px]">
          {SKILLS[skillId].name}: <b>{Math.round(hit.chance * 100)}%</b> to hit <span className="opacity-60">(1d20{hit.bonus >= 0 ? "+" : ""}{hit.bonus} vs DV {hit.dv})</span>
        </div>
      ) : null}
      {odds ? (
        <div className="mt-2 rounded border border-current/20 bg-black/5 p-1.5 text-[12px]">
          <div className="font-mono">Tame: <b>{gs.player.origin === "scholar" ? `${Math.round(odds.chance * 100)}%` : odds.label}</b></div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[10.5px] opacity-70">
            {odds.factors.map(([k, val]) => <span key={k}>{k} {val >= 0 ? "+" : ""}{Math.round(val * 100)}</span>)}
          </div>
          {u.side === "wild" ? <div className="mt-0.5 text-[11px] opacity-70">Wound it, feed it {gs.seen[u.mon.speciesId] ? ITEMS[sp.likes].name.toLowerCase() : "its favourite food"}, or stun it to improve your odds. Range {TAME_RANGE}.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function Summary({ gs, b }: { gs: GameState; b: BattleState }) {
  const s = b.summary;
  if (!s) return null;
  const title = s.result === "won" ? "Victory!" : s.result === "fled" ? "Escaped" : "Defeated...";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0b0817]/70 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="panel-parchment corners w-full max-w-md p-5 animate-in zoom-in-95 fade-in duration-300 sm:rounded-md">
        <div className={cn("text-center font-pixel text-4xl", s.result === "won" ? "text-[#b8560f]" : s.result === "lost" ? "text-crimson" : "text-ink")}>{title}</div>
        <div className="mt-1 text-center text-sm opacity-75">{s.lines.join(" ")}</div>
        {s.tamed.length ? (
          <div className="mt-3 rounded-md border-2 border-gold bg-gold/20 p-2 text-center font-pixel">
            {s.tamed.join(", ")} joined you!
          </div>
        ) : null}
        <div className="mt-3 space-y-1.5">
          {b.units.filter((u) => u.side === "party").map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <Portrait speciesId={u.mon.speciesId} size={36} />
              <span className="flex-1 font-bold">{displayName(u.mon)}</span>
              <span className="font-mono text-sm">{u.state === "down" ? "fainted" : s.xp[u.mon.uid] ? `+${s.xp[u.mon.uid]} XP` : "-"}</span>
            </div>
          ))}
        </div>
        {s.gold || Object.keys(s.items).length ? (
          <div className="mt-3 text-center font-mono text-sm">
            {s.gold ? `+${s.gold} gold ` : ""}
            {Object.entries(s.items).map(([k, n]) => `· ${n}× ${ITEMS[k as ItemId].name} `)}
          </div>
        ) : null}
        {s.result === "lost" ? <p className="mt-3 text-center text-[13px] italic opacity-75">You'll wake in {gs.player.homeName}. Some of your gold will be gone.</p> : null}
        <button
          className="btn-game btn-ember mt-4 h-12 w-full text-lg"
          onClick={() => {
            act((g) => finishBattle(g));
            playMusic("wilds");
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export { unitName };
