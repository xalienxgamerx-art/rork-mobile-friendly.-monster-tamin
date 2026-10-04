export type Element = "neutral" | "fire" | "water" | "earth" | "air" | "nature" | "frost" | "shadow";
export type StatKey = "hp" | "atk" | "def" | "agi" | "wis";
export type Stats = Record<StatKey, number>;
export type GeneKey = "vigor" | "might" | "guard" | "swift" | "wit";
export type Genes = Record<GeneKey, number>;

export type BiomeId =
  | "deep" | "sea" | "lake" | "river" | "beach" | "meadow" | "forest" | "taiga" | "gloomwood"
  | "marsh" | "steppe" | "desert" | "tundra" | "snow" | "hills" | "mountain" | "peak";

export type FeatureId = "hamlet" | "ruin" | "shrine" | "lair";

export type ItemId =
  | "berries" | "nuts" | "roasted_nuts" | "fish" | "meat" | "herb" | "mushroom"
  | "cactus_fruit" | "honeycomb" | "ore" | "tonic";

export type PersonalityId = "brave" | "timid" | "curious" | "lazy" | "gluttonous" | "loyal" | "fierce" | "gentle";
export type MutationId =
  | "thick_hide" | "twin_hearted" | "luminous" | "quickened" | "iron_jaw"
  | "old_soul" | "frail" | "hollow_eyed" | "ember_veins" | "star_marked";
export type TraitId =
  | "warm_blooded" | "slick" | "thorny" | "mossy_shell" | "night_eyes" | "flutter"
  | "stoneskin" | "frost_coat" | "regal" | "photosynth" | "sunborn";
export type StatusId = "burning" | "soaked" | "poisoned" | "slowed" | "rooted" | "stunned" | "blinded" | "shelled" | "wary" | "veiled";
export type Terrain = "grass" | "tallgrass" | "flowers" | "water" | "mud" | "rock" | "tree" | "sand" | "snow" | "ash" | "gloom";
export type WeatherId = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog" | "sandstorm";
export type Disposition = "curious" | "skittish" | "aggressive" | "calm";
export type OriginId = "wanderer" | "herbalist" | "ranger" | "scholar";
export type FearKind = "water" | "fire" | "heat" | "cold" | "dark" | "light";
export type Diet = "herbivore" | "carnivore" | "omnivore" | "lithovore";
export type Activity = "diurnal" | "nocturnal" | "crepuscular";
export type Family = "Beast" | "Slime" | "Bird" | "Bug" | "Spirit" | "Dragon";
export type Rarity = "common" | "uncommon" | "rare" | "legendary";

export interface Monster {
  uid: string;
  speciesId: string;
  nickname: string | null;
  level: number;
  xp: number;
  hp: number;
  genes: Genes;
  mutations: MutationId[];
  personality: PersonalityId;
  skills: string[];
  satiety: number;
  bond: number;
  plus: number;
  origin: string;
  bornTick: number;
  parents: string[] | null;
  wins: number;
}

export interface WildCreature {
  id: string;
  speciesId: string;
  level: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hpFrac: number;
  satiety: number;
  disposition: Disposition;
  activity: string;
  personality: PersonalityId;
  geneSeed: number;
  calmUntil: number;
  alpha: boolean;
  affection: number;
  stalking: boolean;
}

export type LogKind = "info" | "event" | "combat" | "system" | "good" | "bad" | "weather";

export interface LogEntry {
  id: number;
  tick: number;
  text: string;
  kind: LogKind;
}

export interface Player {
  name: string;
  origin: OriginId;
  scarf: string;
  x: number;
  y: number;
  gold: number;
  homeX: number;
  homeY: number;
  homeName: string;
  fx: number;
  fy: number;
}

export interface GameStats {
  steps: number;
  battles: number;
  tamed: number;
  synthesized: number;
  foraged: number;
}

export interface BStatus {
  id: StatusId;
  turns: number;
}

export interface BUnit {
  id: string;
  side: "party" | "wild";
  mon: Monster;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  statuses: BStatus[];
  cooldowns: Record<string, number>;
  init: number;
  state: "active" | "down" | "fled" | "tamed";
  tameBonus: number;
  creatureId: string | null;
}

export interface BTile {
  t: Terrain;
  fire: number;
}

export type BLogKind = "hit" | "miss" | "info" | "good" | "bad" | "status" | "crit";

export interface BLog {
  id: number;
  text: string;
  kind: BLogKind;
  round: number;
}

export interface BFx {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  unitId: string | null;
}

export interface BattleSummary {
  result: "won" | "lost" | "fled";
  xp: Record<string, number>;
  lines: string[];
  gold: number;
  items: Partial<Record<ItemId, number>>;
  tamed: string[];
}

export interface BattlePlan {
  x: number;
  y: number;
  skill: string | null;
  tx: number;
  ty: number;
  flee: boolean;
}

export interface BattleState {
  seed: number;
  rng: number;
  worldX: number;
  worldY: number;
  biome: BiomeId;
  weather: WeatherId;
  night: boolean;
  regionName: string;
  origin: OriginId;
  cols: number;
  rows: number;
  tiles: BTile[];
  units: BUnit[];
  order: string[];
  turn: number;
  round: number;
  phase: "player" | "enemy" | "over";
  moved: boolean;
  acted: boolean;
  mode: "move" | "attack" | "skill" | "tame" | "item";
  skill: string | null;
  item: ItemId | null;
  plan: BattlePlan | null;
  log: BLog[];
  logSeq: number;
  fx: BFx[];
  fxSeq: number;
  auto: boolean;
  summary: BattleSummary | null;
  ambush: boolean;
  lairKey: string | null;
  focus: string | null;
}

export interface GameState {
  version: number;
  seedText: string;
  seed: number;
  tick: number;
  player: Player;
  party: Monster[];
  pen: Monster[];
  bag: Partial<Record<ItemId, number>>;
  creatures: Record<string, WildCreature>;
  loadedChunks: string[];
  removed: Record<string, number>;
  depleted: Record<string, number>;
  log: LogEntry[];
  logSeq: number;
  seen: Record<string, boolean>;
  tamed: Record<string, boolean>;
  regions: Record<string, string>;
  lastWeather: WeatherId;
  lastRegion: string;
  stats: GameStats;
  battle: BattleState | null;
  uidSeq: number;
}
