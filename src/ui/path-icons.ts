/** The Study paths' rank icons: 11 × 11 pixel art in a black outline, each
 * painted in its path's colours (`PathHue`), the evolution's crown in gold.
 * Rows read `o` outline, `d` dark, `m` mid, `l` light, `w` highlight, `.`
 * clear. */
export type PathIcon =
  | "flame" | "tongue" | "inferno" | "snowflake" | "shard" | "iceBlock" | "bolt" | "fork" | "thunderhead"
  | "mail" | "heart" | "cross" | "boot" | "dagger" | "skull" | "crown"
  | "arrow" | "fireArrow" | "volley" | "eye" | "crosshair" | "gear" | "grape" | "cannonball" | "blast" | "bow" | "leaf"
  | "spyglass" | "beacon" | "crate" | "fireball" | "embers" | "stake" | "spring"
  | "bone" | "scales" | "tombstone" | "hand"
  | "meteor" | "stars" | "crater"
  | "shards" | "whirl" | "frostShield"
  | "hammer" | "helm" | "oath"
  | "hood" | "vial" | "drop"
  | "cloud" | "wing" | "halo";

export type PathHue = "ember" | "frost" | "storm" | "steel" | "shadow" | "verdant" | "grave";

export const ICON_SIZE = 11;

const ICONS: Record<PathIcon, string[]> = {
  flame: [
    "....o......", "...oo..o...", "...odo.oo..", "..odmdoodo.", "..odmmddmo.", ".odmmlmmdo.",
    ".odmllmmdo.", ".odmlwlmdo.", ".odmlwlmdo.", "..odmmmdo..", "...ooooo...",
  ],
  tongue: [
    "...........", ".......oo..", "......odmo.", "oo...odmlo.", "odoooodmlmo", "odmmmmmllwo",
    "odmllllwlmo", "odoooodmlmo", "oo...odmlo.", "......odmo.", ".......oo..",
  ],
  inferno: [
    "o....o....o", "oo..oo...oo", "odo.odo.odo", "omo.omdoomo", "omdoomldomo", "odmmmllmmdo",
    "odmlmllmldo", "odmllwllmdo", "odmllwllmdo", ".odmmmmmdo.", "..ooooooo..",
  ],
  snowflake: [
    ".....o.....", "..o.olo.o..", "...olwlo...", "..o.olo.o..", ".oo..l..oo.", "olwllwllwlo",
    ".oo..l..oo.", "..o.olo.o..", "...olwlo...", "..o.olo.o..", ".....o.....",
  ],
  shard: [
    ".....o.....", "....olo....", "...olwmo...", "...olwmo...", "..olwlmdo..", "..olwlmdo..",
    ".olwllmmdo.", ".olllmmmdo.", "..olmmmdo..", "...olmdo...", "....ooo....",
  ],
  iceBlock: [
    "...........", ".ooooooooo.", ".owwllllmo.", ".owllllmmo.", ".ollodollmo", ".ollddolmmo",
    ".ollodolmdo", ".olllllmmdo", ".olmmmmmddo", ".ommmmddddo", ".ooooooooo.",
  ],
  bolt: [
    "......ooo..", ".....omlo..", "....omlo...", "...omlo....", "..omllooo..", ".oooolwlo..",
    "....omlo...", "...omlo....", "..omlo.....", ".omo.......", ".oo........",
  ],
  fork: [
    "....ooo....", "...omlo....", "..omlo.....", ".omlooo....", ".oolwlo....", "...omo.o...",
    "..omo.omo..", ".omo...omo.", ".oo.....omo", "........oo.", "...........",
  ],
  thunderhead: [
    "...oooo....", "..ollllooo.", ".ollwllllo.", "olllllllmmo", "ommmmmmmmdo", ".oooowwooo.",
    "....owwo...", "...owwooo..", "...oowwo...", ".....owo...", ".....oo....",
  ],
  mail: [
    ".ooooooooo.", ".owlllmmdo.", ".olllllmdo.", ".ollwllmdo.", ".olllllmdo.", ".olllmmmdo.",
    "..ollmmdo..", "..olmmmdo..", "...olmdo...", "....odo....", ".....o.....",
  ],
  heart: [
    "...........", "..oo...oo..", ".owlo.olmo.", "owllooolmdo", "olllllllmdo", "olllllmmmdo",
    ".ollllmmdo.", "..olmmmdo..", "...olmdo...", "....odo....", ".....o.....",
  ],
  cross: [
    ".ooooooooo.", ".owlldlmmo.", ".ollldlmdo.", ".odddddddo.", ".ollldlmdo.", ".ollldmmdo.",
    "..olldmdo..", "..olmdmdo..", "...oldmo...", "....odo....", ".....o.....",
  ],
  boot: [
    "...ooooo...", "o..owllmo..", "ol.olllmo..", "oloolllmo..", ".olollmmo..", "..oollmmo..",
    "...ollmmooo", "...olllmmlo", "...ollllmdo", "...oddddddo", "...oooooooo",
  ],
  dagger: [
    ".........oo", "........owo", ".......owlo", "......owlo.", ".....owlo..", "..o.owlo...",
    "..oowlo....", "...odo.....", "..odoo.....", ".odo.o.....", "ooo........",
  ],
  skull: [
    "..ooooooo..", ".owllllmmo.", "owlllllllmo", "ollllllllmo", "ollooloolmo", "ollooloolmo",
    "olllllllmmo", ".ollmolmmo.", "..olllmmo..", "..olomomo..", "..ooooooo..",
  ],
  crown: [
    "...........", "o....o....o", "oo..olo..oo", "olo.olo.olo", "ollooloollo", "olllllllllo",
    "olldlldllmo", "olllllllmmo", "ommmmmmmmdo", "ooooooooooo", "...........",
  ],
  arrow: [
    "......ooooo", "......owllo", ".......olmo", "......odomo", ".....odo.oo", "....odo....",
    "...odo.....", "o.odo......", "oodo.......", "ommo.......", "ooo........",
  ],
  fireArrow: [
    "......ooooo", "......owllo", ".......olmo", "......odomo", ".....odo.oo", "....odo....",
    "...odo.....", "olodo......", "wldo.......", "lwlo.......", ".ll........",
  ],
  volley: [
    "...........", ".o...o...o.", "olo.olo.olo", "owo.owo.owo", ".d...d...d.", ".d...d...d.",
    ".d...d...d.", ".d...d...d.", "odo.odo.odo", "o.o.o.o.o.o", "...........",
  ],
  eye: [
    "...........", "...........", "...ooooo...", ".oollllloo.", "olllooolllo", "olloddwollo",
    "olllooolllo", ".oollllloo.", "...ooooo...", "...........", "...........",
  ],
  crosshair: [
    "...ooooo...", "..olllllo..", ".ol..w..lo.", "ol...w...lo", "ol...w...lo", "olwwwdwwwlo",
    "ol...w...lo", "ol...w...lo", ".ol..w..lo.", "..olllllo..", "...ooooo...",
  ],
  gear: [
    "....ooo....", ".oo.olo.oo.", ".olooloolo.", "..olllllo..", "oooldddlooo", "ollldodlllo",
    "oooldddlooo", "..olllllo..", ".olooloolo.", ".oo.olo.oo.", "....ooo....",
  ],
  grape: [
    "...........", ".ooo...ooo.", "owlmo.owlmo", "olmdo.olmdo", ".ooo...ooo.", "....ooo....",
    "...owlmo...", "...olmdo...", "....ooo....", "...........", "...........",
  ],
  cannonball: [
    "...ooooo...", ".oowllllmo.", ".owllllmmo.", "owlllllmmdo", "olllllmmmdo", "ollllmmmddo",
    "olllmmmmddo", ".olmmmmddo.", ".ommmddddo.", "..oodddoo..", "...ooooo...",
  ],
  blast: [
    ".....o.....", "o...olo...o", ".o.ollmo.o.", "..olllllo..", "ooolwwwlooo", "ollwwwwwllo",
    "ooolwwwlooo", "..olllmlo..", ".o.ollmo.o.", "o...omo...o", ".....o.....",
  ],
  bow: [
    "...oo......", "...w.oo....", "...w..olo..", "...w...olo.", "...w....olo", "ooommmmmolo",
    "...w....olo", "...w...olo.", "...w..olo..", "...w.oo....", "...oo......",
  ],
  leaf: [
    "......oooo.", "....oolllo.", "...ollwlmo.", "..ollwlmmo.", ".ollwlmmdo.", ".olwlmmdo..",
    ".owlmmdo...", ".olmdoo....", ".ooo.......", "od.........", "o..........",
  ],
  spyglass: [
    "........ooo", ".......owlo", "......owlmo", ".....owlmo.", "....oolmo..", "...odomo...",
    "..odmoo....", ".odmo......", "odmo.......", "odo........", "oo.........",
  ],
  beacon: [
    ".....o.....", "....olo....", "...olwlo...", "...olwlo...", "..ooooooo..", "..odmmmdo..",
    "...odmdo...", "....odo....", "....odo....", "....odo....", "...ooooo...",
  ],
  stake: [
    ".....o.....", "....owo....", "....olo....", "...olwmo...", "...olmdo...", "...olmdo...",
    "...olmdo...", "...omddo...", ".ooooooooo.", ".odmmmmmdo.", ".ooooooooo.",
  ],
  spring: [
    ".....o.....", "....olo....", "....omo....", "..ooooooo..", "..odmmmlo..", "...ooooo...",
    "..olmmmdo..", "...ooooo...", "..odmmmlo..", "..ooooooo..", "...........",
  ],
  crate: [
    "ooooooooooo", "odddddddddo", "odolllllodo", "odlollloldo", "odllololldo", "odlllollldo",
    "odllololldo", "odlollloldo", "odolllllodo", "odddddddddo", "ooooooooooo",
  ],
  fireball: [
    "...........", ".....oooo..", "....owwllo.", "...owllllmo", "...olllmmmo", "..oollmmmdo",
    ".oddommmdo.", "omdo.oddo..", "odo..ooo...", "oo.........", "...........",
  ],
  bone: [
    "...........", ".oo........", "owlo.......", "olwlo......", ".oolwo.....", "...olwo....",
    "....olwo...", ".....olwoo.", "......olmlo", ".......omlo", "........oo.",
  ],
  scales: [
    ".....o.....", "ooooolooooo", ".o...l...o.", "o.o..l..o.o", "olwo.l.olwo", "ommo.l.ommo",
    ".oo..l..oo.", ".....l.....", "....olo....", "...olmmo...", "..ooooooo..",
  ],
  tombstone: [
    "...ooooo...", "..owllllo..", ".owllllmmo.", ".ollldlmmo.", ".olldddmmo.", ".ollldlmmo.",
    ".ollldlmdo.", ".olllllmdo.", ".ommmmmddo.", "ooooooooooo", "odmmmmmmddo",
  ],
  hand: [
    "...o.o.o...", "..olololo..", "..olololo..", "..olllllo.o", "..olllllolo", "..ollllllo.",
    "...ollllo..", "...ollmmo..", "...olmmdo..", "ooooddddooo", "odmdmdmdmdo",
  ],
  meteor: [
    ".........oo", ".......oolo", ".....oolmo.", "....odmmo..", "..oooomo...", ".odmmlmo...",
    "odmllwlmo..", "odmlwwlmo..", "odmmllmdo..", ".oddmmdo...", "..ooooo....",
  ],
  stars: [
    "m....m.....", ".m....m....", "..olo..m...", ".olwlo.olo.", "..olo.olwlo", "...o...olo.",
    "m.......o..", ".m.........", "..olo......", ".olwlo.....", "..olo......",
  ],
  crater: [
    "...l...l...", ".l..w.w..l.", "...l.w.l...", "....lwl....", "...........", "oo.......oo",
    "odoo...oodo", "odmdooodmdo", "odmllwllmdo", ".odmmmmmdo.", "..ooooooo..",
  ],
  shards: [
    "o....o....o", "olo.olo.olo", ".omoomlomo.", "..olwwlmo..", "ooomwwlmooo", "olllwwwllmo",
    "ooomllmmooo", "..omlmmdo..", ".omoomdomo.", "odo.odo.odo", "o....o....o",
  ],
  whirl: [
    "...ooooo...", "..ollllmo..", ".ol.....mo.", "ol..ooo..mo", "ol.olllo.do", "ol.ol.wo.do",
    "ol..o.lo.do", ".o....mo.do", "..oooomo.o.", ".olllmdo.o.", "..ooooo....",
  ],
  frostShield: [
    "ooooooooooo", "owwllllllmo", "owllwlwllmo", "olllowollmo", "olwowwwowmo", "olllowollmo",
    ".olllwlldo.", ".ollllmmdo.", "..olmmmdo..", "...olmdo...", "....ooo....",
  ],
  hammer: [
    ".ooooooooo.", ".owllllmmo.", ".olllllmdo.", ".ommmmmddo.", ".oooommooo.", "....omdo...",
    "....omdo...", "....omdo...", "....omdo...", "...ommddo..", "...oooooo..",
  ],
  helm: [
    "...ooooo...", "..owllllo..", ".owlllllmo.", ".olllllmmo.", ".ooooooooo.", ".ollmlmmdo.",
    ".ollmlmmdo.", ".ollmlmmdo.", ".ommmlmmdo.", "..ommmmdo..", "...ooooo...",
  ],
  oath: [
    ".....o.....", "....owo....", "....owo....", "....olo....", "....olo....", "....olo....",
    "..ooooooo..", "..ommmmdo..", "..ooodooo..", "....odo....", "....ooo....",
  ],
  embers: [
    "...........", "..o.....o..", ".olo...owo.", "..o.....o..", "....o......", "...owo..o..",
    "....o..olo.", ".o......o..", "olo..o.....", ".o..olo....", ".....o.....",
  ],
  hood: [
    "...ooooo...", "..ommmmmo..", ".omlllmmdo.", ".olmooomdo.", "olmo...odmo", "olmowowodmo",
    "olmo...odmo", "ollmo.odmmo", "olmmmmmmmdo", ".olmmmmmdo.", "..ooooooo..",
  ],
  vial: [
    "....ooo....", "....olo....", "....olo....", "...ooooo...", "..olllmdo..", ".olwlmmmdo.",
    "olwlmmmmmdo", "ollmmmmmmdo", "olmmmmmmddo", ".odmmmmddo.", "..ooooooo..",
  ],
  drop: [
    ".....o.....", ".....o.....", "....olo....", "....olo....", "...olmmo...", "..olwmmmo..",
    ".olwlmmmdo.", ".ollmmmmdo.", ".olmmmmddo.", "..odmmddo..", "...ooooo...",
  ],
  cloud: [
    "...........", "....ooo....", "...owwlo...", ".ooowllmoo.", "owwolllmmlo", "owllllmmmdo",
    "olllmmmmmdo", "ommmmmmmddo", ".odddddddo.", "..ooooooo..", "...........",
  ],
  wing: [
    "o..........", "ooo........", "owlooo.....", "owllllooo..", ".owlllllloo", ".owllmmmmlo",
    "..owmmmmddo", "..owmmdddo.", "...omddoo..", "....ooo....", "...........",
  ],
  halo: [
    "...........", "...........", "...ooooo...", ".oowwlllmoo", "owoo...oomo", "olo.....odo",
    "omoo...oodo", ".oommmddoo.", "...ooooo...", "...........", "...........",
  ],
};

const OUTLINE = "#140c08";
/** Each hue's dark, mid, light and highlight. */
export const HUES: Record<PathHue | "gold", [string, string, string, string]> = {
  ember: ["#7a1d0e", "#d0451b", "#f39a2a", "#fff1a8"],
  frost: ["#24508c", "#4b8fd0", "#8fd0f6", "#ffffff"],
  storm: ["#3b1f6e", "#7b4fd6", "#c7a8ff", "#fff6ff"],
  steel: ["#4b5563", "#8b97a6", "#cfd6de", "#ffffff"],
  shadow: ["#2a0f14", "#6b1d2a", "#c0475a", "#f6cdd2"],
  verdant: ["#1f4a1c", "#3f8a34", "#8fd16a", "#e8ffd0"],
  grave: ["#1d3326", "#4f8a5e", "#9fdcae", "#effff2"],
  gold: ["#7a5212", "#c08a2a", "#f2c95a", "#fff3c4"],
};

/** Paints `icon` in `hue` onto an 11 × 11 canvas. */
export function paintPathIcon(canvas: HTMLCanvasElement, icon: PathIcon, hue: PathHue | "gold") {
  canvas.width = canvas.height = ICON_SIZE;
  const c = canvas.getContext("2d");
  if (!c) return;
  const [d, m, l, w] = HUES[hue], colour: Record<string, string> = { o: OUTLINE, d, m, l, w };
  c.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  ICONS[icon].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = colour[row[x]];
      if (!fill) continue;
      c.fillStyle = fill;
      c.fillRect(x, y, 1, 1);
    }
  });
}

/** Every icon's rows, for the test that keeps them square. */
export const ICON_ROWS: Readonly<Record<PathIcon, readonly string[]>> = ICONS;
