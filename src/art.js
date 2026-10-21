/** Generated art (Higgsfield, GPT Image 2.5) and the mapping from catalog entries to art keys. */
import { ART_SETS, UI_ICONS } from "./art-sets.js";
import { currentDesign } from "./design.js";
const BASE_ART = {
  // v0.23a (creep graphic overhaul): the bestiary figures of the original design (stills; walking creeps use ANIM_MANIFEST)
  "creep-n-abomination": { w: 234, h: 145, footY: 141 },
  "creep-n-acid-slime": { w: 153, h: 110, footY: 106 },
  "creep-n-arcane-golem": { w: 107, h: 85, footY: 80 },
  "creep-n-armored-boar": { w: 152, h: 111, footY: 106 },
  "creep-n-armored-boar-fel": { w: 194, h: 138, footY: 134 },
  "creep-n-bat": { w: 182, h: 81, footY: 76 },
  "creep-n-boar": { w: 159, h: 124, footY: 120 },
  "creep-n-bomber": { w: 141, h: 120, footY: 116 },
  "creep-n-bone-knight": { w: 151, h: 140, footY: 136 },
  "creep-n-brute": { w: 210, h: 137, footY: 133 },
  "creep-n-brute-brown": { w: 210, h: 137, footY: 133 },
  "creep-n-burrower": { w: 200, h: 118, footY: 114 },
  "creep-n-crystal-worm": { w: 176, h: 117, footY: 113 },
  "creep-n-crystal-worm-green": { w: 176, h: 117, footY: 113 },
  "creep-n-demon-hound": { w: 125, h: 92, footY: 87 },
  "creep-n-demon-lord": { w: 255, h: 145, footY: 141 },
  "creep-n-demon-lord-fel": { w: 255, h: 145, footY: 141 },
  "creep-n-desert-wyrm": { w: 244, h: 158, footY: 154 },
  "creep-n-dire-wolf": { w: 177, h: 147, footY: 143 },
  "creep-n-fire-imp": { w: 160, h: 135, footY: 131 },
  "creep-n-fire-imp-fel": { w: 160, h: 135, footY: 131 },
  "creep-n-flying-machine": { w: 144, h: 104, footY: 99 },
  "creep-n-flying-sheep": { w: 132, h: 91, footY: 86 },
  "creep-n-forest-golem": { w: 185, h: 140, footY: 136 },
  "creep-n-forest-golem-autumn": { w: 185, h: 140, footY: 136 },
  "creep-n-forest-troll": { w: 95, h: 105, footY: 100 },
  "creep-n-frost-dragon": { w: 271, h: 148, footY: 144 },
  "creep-n-ghoul": { w: 172, h: 128, footY: 124 },
  "creep-n-ghoul-green": { w: 172, h: 128, footY: 124 },
  "creep-n-giant-bat": { w: 268, h: 142, footY: 138 },
  "creep-n-gnoll": { w: 104, h: 98, footY: 97 }, // v0.23d: new gnoll sheet
  "creep-n-horse": { w: 113, h: 102, footY: 101 }, // v0.23d: hay pony
  "creep-n-goblin": { w: 125, h: 89, footY: 84 },
  "creep-n-grunt": { w: 130, h: 103, footY: 98 },
  "creep-n-harpy": { w: 203, h: 134, footY: 130 },
  "creep-n-ice-imp": { w: 143, h: 137, footY: 133 },
  "creep-n-ice-imp-violet": { w: 143, h: 137, footY: 133 },
  "creep-n-ice-slime": { w: 145, h: 107, footY: 103 },
  "creep-n-imp": { w: 159, h: 134, footY: 130 },
  "creep-n-imp-void": { w: 159, h: 134, footY: 130 },
  "creep-n-infernal-golem": { w: 121, h: 93, footY: 88 },
  "creep-n-inferno-dragon": { w: 222, h: 154, footY: 150 },
  "creep-n-lava-golem": { w: 198, h: 136, footY: 132 },
  "creep-n-lava-worm": { w: 211, h: 120, footY: 116 },
  "creep-n-lich-king": { w: 212, h: 169, footY: 165 },
  "creep-n-meat-golem": { w: 124, h: 96, footY: 91 },
  "creep-n-mountain-golem": { w: 142, h: 106, footY: 101 },
  "creep-n-mud-golem": { w: 137, h: 97, footY: 92 },
  "creep-n-necromancer": { w: 129, h: 108, footY: 103 },
  "creep-n-ogre": { w: 183, h: 140, footY: 136 },
  "creep-n-orc": { w: 162, h: 137, footY: 133 },
  "creep-n-orc-berserker": { w: 181, h: 136, footY: 132 },
  "creep-n-orc-berserker-violet": { w: 181, h: 136, footY: 132 },
  "creep-n-orc-shadow": { w: 162, h: 137, footY: 133 },
  "creep-n-plague-zombie": { w: 171, h: 131, footY: 127 },
  "creep-n-raider": { w: 138, h: 107, footY: 102 },
  "creep-n-rock-golem": { w: 140, h: 102, footY: 97 },
  "creep-n-sand-worm": { w: 148, h: 103, footY: 99 },
  "creep-n-satyr": { w: 107, h: 106, footY: 101 },
  "creep-n-sea-kraken": { w: 251, h: 173, footY: 169 },
  "creep-n-shade": { w: 147, h: 99, footY: 94 },
  "creep-n-shaman": { w: 116, h: 101, footY: 96 },
  "creep-n-siege-golem": { w: 120, h: 102, footY: 97 },
  "creep-n-skeleton": { w: 155, h: 127, footY: 123 },
  "creep-n-skeleton-archer": { w: 142, h: 128, footY: 124 },
  "creep-n-skeleton-mage": { w: 158, h: 136, footY: 132 },
  "creep-n-skeleton-mage-green": { w: 158, h: 136, footY: 132 },
  "creep-n-sky-raider": { w: 172, h: 133, footY: 129 },
  "creep-n-slime": { w: 138, h: 95, footY: 91 },
  "creep-n-spawn-spider": { w: 129, h: 83, footY: 78 },
  "creep-n-spearman": { w: 136, h: 136, footY: 132 },
  "creep-n-spiked-slime": { w: 156, h: 103, footY: 99 },
  "creep-n-spiked-slime-violet": { w: 156, h: 103, footY: 99 },
  "creep-n-spiritwolf": { w: 132, h: 97, footY: 92 },
  "creep-n-stone-titan": { w: 225, h: 148, footY: 144 },
  "creep-n-storm-imp": { w: 157, h: 135, footY: 131 },
  "creep-n-troll": { w: 177, h: 141, footY: 137 },
  "creep-n-troll-brown": { w: 177, h: 141, footY: 137 },
  "creep-n-void-dragon": { w: 258, h: 162, footY: 158 },
  "creep-n-wolf": { w: 146, h: 124, footY: 120 },
  "creep-n-zombie": { w: 106, h: 95, footY: 90 },
  "creep-alchemist": { w: 350, h: 400, footY: 384 },
  "creep-bat-rider": { w: 400, h: 387, footY: 371 },
  "creep-black-dragon": { w: 400, h: 352, footY: 336 },
  "creep-boar": { w: 298, h: 400, footY: 384 },
  "creep-centaur": { w: 400, h: 395, footY: 379 },
  "creep-darkknight": { w: 394, h: 400, footY: 384 },
  "creep-demon-slayer": { w: 395, h: 400, footY: 384 },
  "creep-dragonspawn": { w: 400, h: 387, footY: 371 },
  "creep-dryad": { w: 378, h: 400, footY: 384 },
  "creep-fel-raider": { w: 324, h: 400, footY: 383 },
  "creep-flesh-golem": { w: 400, h: 395, footY: 379 },
  "creep-frost-wyrm": { w: 400, h: 329, footY: 311 },
  "creep-ghoul": { w: 363, h: 400, footY: 384 },
  "creep-gnoll": { w: 336, h: 400, footY: 384 },
  "creep-goblin": { w: 356, h: 400, footY: 384 },
  "creep-wichtel": { w: 356, h: 400, footY: 384 },
  "creep-golem": { w: 378, h: 400, footY: 384 },
  "creep-gryphon": { w: 400, h: 398, footY: 382 },
  "creep-gyrocopter": { w: 400, h: 387, footY: 371 },
  "creep-harpy": { w: 400, h: 382, footY: 366 },
  "creep-hellhound": { w: 326, h: 400, footY: 384 },
  "creep-horse": { w: 302, h: 400, footY: 384 },
  "creep-infernal": { w: 371, h: 400, footY: 384 },
  "creep-marauder": { w: 400, h: 372, footY: 356 },
  "creep-minotaur": { w: 400, h: 391, footY: 375 },
  "creep-mountain-golem": { w: 374, h: 400, footY: 384 },
  "creep-necromancer": { w: 385, h: 400, footY: 384 },
  "creep-orc": { w: 400, h: 383, footY: 367 },
  "creep-orc-warlord": { w: 400, h: 366, footY: 350 },
  "creep-pit-lord": { w: 400, h: 390, footY: 374 },
  "creep-raider": { w: 356, h: 400, footY: 384 },
  "creep-satyr": { w: 317, h: 400, footY: 384 },
  "creep-scarab": { w: 395, h: 400, footY: 384 },
  "creep-shade": { w: 400, h: 389, footY: 373 },
  "creep-shaman": { w: 378, h: 400, footY: 384 },
  "creep-sheep-fly": { w: 400, h: 343, footY: 327 },
  "creep-siege-golem": { w: 369, h: 400, footY: 384 },
  "creep-siren": { w: 351, h: 400, footY: 384 },
  "creep-skeleton": { w: 396, h: 400, footY: 384 },
  "creep-spellbreaker": { w: 353, h: 400, footY: 384 },
  "creep-spider": { w: 391, h: 400, footY: 384 },
  "creep-troll": { w: 390, h: 400, footY: 384 },
  "creep-voidwalker": { w: 396, h: 400, footY: 384 },
  "creep-warlock": { w: 325, h: 400, footY: 384 },
  "creep-wolf": { w: 283, h: 400, footY: 384 },
  "creep-yeti": { w: 396, h: 400, footY: 384 },
  "creep-zeppelin": { w: 366, h: 400, footY: 384 },
  "tower-arcane": { w: 338, h: 400, plateW: 251, plateCX: 173.5, plateCY: 284.0, plateTop: 220 },
  "tower-arcane-archer": { w: 317, h: 400, plateW: 249, plateCX: 139.5, plateCY: 283.5, plateTop: 220 },
  "tower-archangel": { w: 384, h: 400, plateW: 242, plateCX: 185.0, plateCY: 284.5, plateTop: 220 },
  "tower-archer": { w: 306, h: 400, plateW: 251, plateCX: 140.5, plateCY: 283.5, plateTop: 220 },
  "tower-archer-elite": { w: 331, h: 400, plateW: 247, plateCX: 142.5, plateCY: 284.0, plateTop: 220 },
  "tower-archmage": { w: 320, h: 400, plateW: 243, plateCX: 136.5, plateCY: 284.0, plateTop: 220 },
  "tower-arrowtower": { w: 341, h: 400, plateW: 282, plateCX: 156.0, plateCY: 281.5, plateTop: 220 },
  "tower-bash": { w: 270, h: 400, plateW: 232, plateCX: 138.0, plateCY: 297.5, plateTop: 245 },
  "tower-birdhunter": { w: 295, h: 400, plateW: 227, plateCX: 128.5, plateCY: 299.5, plateTop: 248 },
  "tower-cannon": { w: 299, h: 400, plateW: 265, plateCX: 147.5, plateCY: 282.5, plateTop: 220 },
  "tower-cannon-elite": { w: 303, h: 400, plateW: 272, plateCX: 151.0, plateCY: 284.5, plateTop: 223 },
  "tower-death-knight": { w: 359, h: 400, plateW: 237, plateCX: 152.5, plateCY: 295.5, plateTop: 242 },
  "tower-disease": { w: 348, h: 400, plateW: 303, plateCX: 166.5, plateCY: 280.0, plateTop: 220 },
  "tower-earth": { w: 327, h: 400, plateW: 250, plateCX: 145.0, plateCY: 289.0, plateTop: 231 },
  "tower-earth-laser": { w: 333, h: 400, plateW: 274, plateCX: 152.0, plateCY: 282.0, plateTop: 220 },
  "tower-farm": { w: 292, h: 400, plateW: 261, plateCX: 145.5, plateCY: 282.5, plateTop: 220 },
  "tower-fire": { w: 325, h: 400, plateW: 245, plateCX: 150.5, plateCY: 293.5, plateTop: 238 },
  "tower-fire-archer": { w: 339, h: 400, plateW: 249, plateCX: 139.5, plateCY: 283.5, plateTop: 220 },
  "tower-fire-elemental": { w: 331, h: 400, plateW: 275, plateCX: 175.5, plateCY: 278.0, plateTop: 220 },
  "tower-fire-lord": { w: 331, h: 400, plateW: 241, plateCX: 158.5, plateCY: 284.5, plateTop: 220 },
  "tower-flame-crusader": { w: 362, h: 400, plateW: 247, plateCX: 208.5, plateCY: 282.5, plateTop: 220 },
  "tower-frost": { w: 336, h: 400, plateW: 246, plateCX: 146.0, plateCY: 283.5, plateTop: 220 },
  "tower-frost-archer": { w: 328, h: 400, plateW: 239, plateCX: 135.5, plateCY: 284.0, plateTop: 220 },
  "tower-glaive": { w: 341, h: 400, plateW: 249, plateCX: 139.5, plateCY: 283.5, plateTop: 220 },
  "tower-guard": { w: 300, h: 400, plateW: 250, plateCX: 147.0, plateCY: 284.0, plateTop: 220 },
  // Level 1 (wooden sword and shield, leather) and level 2 (steel sword, leather harness) recolours.
  "tower-guard-l1": { w: 300, h: 400, plateW: 250, plateCX: 147.0, plateCY: 284.0, plateTop: 220 },
  "tower-guard-l2": { w: 300, h: 400, plateW: 250, plateCX: 147.0, plateCY: 284.0, plateTop: 220 },
  "tower-guard-champion": { w: 353, h: 400, plateW: 243, plateCX: 180.5, plateCY: 284.5, plateTop: 220 },
  "tower-guard-elite": { w: 287, h: 400, plateW: 245, plateCX: 140.5, plateCY: 284.0, plateTop: 220 },
  "tower-hall": { w: 283, h: 400, plateW: 252, plateCX: 141.0, plateCY: 290.0, plateTop: 233 },
  "tower-wall": { w: 320, h: 330, plateW: 262, plateCX: 160.0, plateCY: 232.0, plateTop: 122 }, // v0.12: Fortifications
  "deco-rock": { w: 200, h: 182, plateW: 176, plateCX: 100.0, plateCY: 140.0, plateTop: 70 }, // v0.17: campaign rocks
  "tower-headhunter": { w: 331, h: 400, plateW: 245, plateCX: 138.5, plateCY: 292.5, plateTop: 237 },
  "tower-hydra": { w: 341, h: 400, plateW: 248, plateCX: 166.0, plateCY: 283.5, plateTop: 220 },
  "tower-lich": { w: 287, h: 400, plateW: 221, plateCX: 130.5, plateCY: 285.5, plateTop: 220 },
  "tower-lumbermill": { w: 326, h: 400, plateW: 263, plateCX: 161.5, plateCY: 282.0, plateTop: 220 },
  "tower-exp-generator": { w: 283, h: 400, plateW: 252, plateCX: 141.0, plateCY: 290.0, plateTop: 233 },
  "tower-magic-city": { w: 263, h: 400, plateW: 222, plateCX: 126.0, plateCY: 303.0, plateTop: 254 },
  "tower-magic-elite": { w: 332, h: 400, plateW: 243, plateCX: 148.5, plateCY: 284.0, plateTop: 220 },
  "tower-magic-grand": { w: 317, h: 400, plateW: 241, plateCX: 152.5, plateCY: 284.0, plateTop: 220 },
  "tower-naga-archer": { w: 332, h: 400, plateW: 241, plateCX: 141.5, plateCY: 285.0, plateTop: 220 },
  "tower-naga-guard": { w: 309, h: 400, plateW: 245, plateCX: 166.5, plateCY: 284.5, plateTop: 220 },
  "tower-ogre": { w: 322, h: 400, plateW: 246, plateCX: 169.0, plateCY: 284.0, plateTop: 220 },
  "tower-phoenix": { w: 345, h: 400, plateW: 230, plateCX: 172.0, plateCY: 285.0, plateTop: 220 },
  "tower-pit-lord": { w: 370, h: 400, plateW: 265, plateCX: 147.5, plateCY: 280.5, plateTop: 220 },
  "tower-poison": { w: 284, h: 400, plateW: 249, plateCX: 139.5, plateCY: 283.5, plateTop: 220 },
  "tower-poison-archer": { w: 316, h: 400, plateW: 251, plateCX: 140.5, plateCY: 283.5, plateTop: 220 },
  "tower-robogoblin": { w: 341, h: 400, plateW: 250, plateCX: 165.0, plateCY: 283.5, plateTop: 220 },
  "tower-stomp": { w: 362, h: 400, plateW: 244, plateCX: 178.0, plateCY: 284.5, plateTop: 220 },
  "tower-storm": { w: 304, h: 400, plateW: 221, plateCX: 129.5, plateCY: 286.0, plateTop: 220 },
  "tower-treant": { w: 312, h: 400, plateW: 235, plateCX: 135.5, plateCY: 284.5, plateTop: 220 },
  "tower-tree-of-life": { w: 284, h: 400, plateW: 244, plateCX: 137.0, plateCY: 285.0, plateTop: 222 },
  "tower-trueshot": { w: 337, h: 400, plateW: 248, plateCX: 139.0, plateCY: 284.0, plateTop: 220 },
  "tower-water-elemental": { w: 307, h: 400, plateW: 247, plateCX: 146.5, plateCY: 284.0, plateTop: 220 },
  "tower-zombie": { w: 371, h: 400, plateW: 264, plateCX: 198.0, plateCY: 282.5, plateTop: 220 },
};
/** Level variants of tower art, recoloured from the base figure: v1 dull iron and bronze, v2 leather,
 *  v3 wood and linen. The lower a tower stands in its line, the plainer its figure. */
export const VARIANT_ART = [
  "tower-arcane-archer-v2",
  "tower-arcane-archer-v3",
  "tower-arcane-v2",
  "tower-arcane-v3",
  "tower-archer-elite-v2",
  "tower-archer-elite-v3",
  "tower-archer-v2",
  "tower-arrowtower-v2",
  "tower-arrowtower-v3",
  "tower-bash-v1",
  "tower-bash-v2",
  "tower-bash-v3",
  "tower-birdhunter-v1",
  "tower-birdhunter-v2",
  "tower-birdhunter-v3",
  "tower-cannon-elite-v1",
  "tower-cannon-elite-v2",
  "tower-cannon-v2",
  "tower-cannon-v3",
  "tower-disease-v1",
  "tower-disease-v2",
  "tower-disease-v3",
  "tower-earth-laser-v1",
  "tower-earth-laser-v2",
  "tower-earth-laser-v3",
  "tower-earth-v2",
  "tower-earth-v3",
  "tower-fire-archer-v1",
  "tower-fire-archer-v2",
  "tower-fire-archer-v3",
  "tower-fire-elemental-v2",
  "tower-fire-elemental-v3",
  "tower-fire-v2",
  "tower-fire-v3",
  "tower-flame-crusader-v1",
  "tower-flame-crusader-v2",
  "tower-flame-crusader-v3",
  "tower-frost-archer-v1",
  "tower-frost-archer-v2",
  "tower-frost-archer-v3",
  "tower-frost-v2",
  "tower-frost-v3",
  "tower-glaive-v1",
  "tower-glaive-v2",
  "tower-glaive-v3",
  "tower-guard-champion-v1",
  "tower-exp-generator-v1",
  "tower-exp-generator-v2",
  "tower-exp-generator-v3",
  "tower-magic-elite-v1",
  "tower-magic-grand-v1",
  "tower-naga-guard-v1",
  "tower-naga-guard-v2",
  "tower-naga-guard-v3",
  "tower-ogre-v1",
  "tower-ogre-v2",
  "tower-ogre-v3",
  "tower-poison-archer-v1",
  "tower-poison-archer-v2",
  "tower-poison-archer-v3",
  "tower-poison-v2",
  "tower-poison-v3",
  "tower-stomp-v1",
  "tower-stomp-v2",
  "tower-stomp-v3",
  "tower-storm-v2",
  "tower-storm-v3",
  "tower-treant-v1",
  "tower-treant-v2",
  "tower-treant-v3",
  "tower-trueshot-v1",
  "tower-trueshot-v2",
  "tower-trueshot-v3",
  "tower-water-elemental-v2",
  "tower-water-elemental-v3",
  "tower-zombie-v1",
  "tower-zombie-v2",
  "tower-zombie-v3",
];
export const ART_MANIFEST = Object.freeze({
  ...BASE_ART,
  ...Object.fromEntries(VARIANT_ART.map((k) => [k, BASE_ART[k.replace(/-v\d$/, "")]])),
});

/**
 * v0.23: version key on every art URL (figures, animations, icons): raise it whenever pictures in
 * assets/art, assets/anim, assets/art-toy or assets/art-pets change, so browsers fetch the new ones (see the README).
 */
export const ART_VERSION = "v023m";
// ---- art sets of the Circle Tower Wars designs ------------------------------------------------------
// Sonnenwiese and Bonbon draw every figure as a round toy ("toy"), Pfotenwelt as a cute animal ("pets").
// A set holds one picture per figure; level variants (-v1..-v3, -l1, -l2) share their base figure there.
// The original design keeps Felix's art and everything in ART_MANIFEST unchanged.
export const artSetFor = (design) => (design === "pets" ? "pets" : design === "sonne" || design === "bonbon" ? "toy" : null);
let artSet = artSetFor(currentDesign());
export const activeArtSet = () => artSet;
/** Called when the design changes; returns true when the figures change too. */
export function useArtSet(set) {
  set = set && ART_SETS[set] ? set : null;
  if (set === artSet) return false;
  artSet = set;
  return true;
}
export const baseArtKey = (key) => String(key).replace(/-(v|l)\d$/, "");
/** Keys a set replaces: figures, and the rock of campaign rocks and quarry stones (not the original scenery). */
export const SET_ART = /^(tower|creep)-|^deco-rock$/;
const inSet = (key) => !!artSet && SET_ART.test(key) && !!ART_SETS[artSet][baseArtKey(key)];
/** The key the active set draws for an art key (variants fold into their base figure). */
export const setArtKey = (key) => (inSet(key) ? baseArtKey(key) : key);
/** Size and plate data of an art key in a set (null: the original art). */
export const setArtMeta = (set, key) => (set && ART_SETS[set]?.[baseArtKey(key)]) || null;
/** Extra pictures of a set that are not figures (board props, logo). */
export const setPropUrl = (set, name) => `assets/art-${set}/${name}.webp?v=${ART_VERSION}`; // v0.23a: ART_VERSION on the set pictures too

export const artUrl = (key) => (inSet(key) ? setPropUrl(artSet, baseArtKey(key)) : `assets/art/${key}.webp?v=${ART_VERSION}`); // v0.23a: the active art set's picture
export const iconUrl = (name) => uiArt(`assets/art/icon-${name}.webp?v=${ART_VERSION}`);
/**
 * Design variants: icons and reward pictures in the toy look (assets/art-toy/ui, same file names as in
 * assets/art and assets/art/perks). Any other picture, and every picture in the original design, stays as it is.
 */
export function uiArt(url) {
  if (!artSet) return url;
  const m = /^assets\/art\/(?:perks\/)?([a-z0-9-]+)\.webp/.exec(url);
  return m && UI_ICONS.has(m[1]) ? `assets/art-toy/ui/${m[1]}.webp?v=${ART_VERSION}` : url;
}

/** Cut-out frame animations (rigged from the still art). attack = played on each shot from `start`, walk = looped. */
export const ANIM_MANIFEST = Object.freeze({
  "tower-guard": { kind: "attack", frames: 10, cols: 5, fw: 380, fh: 420, ox: 40, oy: 20, ms: 45, start: 2 },
  "tower-guard-l1": { kind: "attack", frames: 10, cols: 5, fw: 380, fh: 420, ox: 40, oy: 20, ms: 45, start: 2 },
  "tower-guard-l2": { kind: "attack", frames: 10, cols: 5, fw: 380, fh: 420, ox: 40, oy: 20, ms: 45, start: 2 },
  "creep-skeleton": { kind: "walk", frames: 8, cols: 4, fw: 444, fh: 412, ox: 24, oy: 12, ms: 80 },
  // v0.23a (creep graphic overhaul): 8-way walks (rows: front, front-right, right, back-right, back, back-left,
  // left, front-left; 6 frames each, foot point footX/footY, figure height figH, size figS = max(figH, width / 1.4)) and 6-frame deaths (key + "-death")
  "creep-n-arcane-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 124, fh: 95, footX: 62, footY: 91, figH: 79, ms: 95, figS: 79 },
  "creep-n-arcane-golem-death": { kind: "death", frames: 6, cols: 6, fw: 240, fh: 175, footX: 120, footY: 171, ms: 110 },
  "creep-n-bat": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 208, fh: 85, footX: 104, footY: 81, figH: 73, ms: 95, figS: 125 },
  "creep-n-bat-death": { kind: "death", frames: 6, cols: 6, fw: 234, fh: 119, footX: 117, footY: 115, ms: 110 },
  "creep-n-armored-boar": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 178, fh: 125, footX: 89, footY: 121, figH: 105, ms: 95, figS: 105 },
  "creep-n-demon-hound": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 180, fh: 105, footX: 90, footY: 101, figH: 83, ms: 95, figS: 92 },
  "creep-n-demon-hound-death": { kind: "death", frames: 6, cols: 6, fw: 238, fh: 145, footX: 119, footY: 141, ms: 110 },
  "creep-n-flying-machine": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 162, fh: 109, footX: 81, footY: 105, figH: 86, ms: 95, figS: 92 },
  "creep-n-flying-machine-death": { kind: "death", frames: 6, cols: 6, fw: 232, fh: 202, footX: 116, footY: 198, ms: 110 },
  "creep-n-flying-sheep": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 170, fh: 104, footX: 85, footY: 100, figH: 85, ms: 95, figS: 97, scale: 0.8 }, // v0.23j: smaller
  "creep-n-flying-sheep-death": { kind: "death", frames: 6, cols: 6, fw: 200, fh: 119, footX: 100, footY: 115, ms: 110 },
  "creep-n-forest-troll": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 126, fh: 113, footX: 63, footY: 109, figH: 95, ms: 95, figS: 95 },
  "creep-n-forest-troll-death": { kind: "death", frames: 6, cols: 6, fw: 264, fh: 166, footX: 132, footY: 162, ms: 110 },
  "creep-n-gnoll": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 145, fh: 117, footX: 72, footY: 113, figH: 95, ms: 95, figS: 95 },
  "creep-n-gnoll-death": { kind: "death", frames: 6, cols: 6, fw: 160, fh: 152, footX: 80, footY: 148, ms: 110 },
  // v0.23d: hay pony: four poses per direction (stand, walk, run, walk) and seven death frames
  "creep-n-horse": { kind: "walk", dirs: 8, frames: 4, cols: 4, fw: 146, fh: 112, footX: 73, footY: 108, figH: 95, ms: 120, figS: 95 },
  "creep-n-horse-death": { kind: "death", frames: 7, cols: 7, fw: 149, fh: 109, footX: 74, footY: 105, ms: 105 },
  "creep-n-goblin": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 146, fh: 93, footX: 73, footY: 89, figH: 81, ms: 95, figS: 81 },
  "creep-n-goblin-death": { kind: "death", frames: 6, cols: 6, fw: 216, fh: 103, footX: 108, footY: 99, ms: 110 },
  "creep-n-grunt": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 138, fh: 110, footX: 69, footY: 106, figH: 97, ms: 95, figS: 97 },
  "creep-n-grunt-death": { kind: "death", frames: 6, cols: 6, fw: 180, fh: 130, footX: 90, footY: 126, ms: 110 },
  "creep-n-infernal-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 134, fh: 96, footX: 67, footY: 92, figH: 81, ms: 95, figS: 81 },
  "creep-n-infernal-golem-death": { kind: "death", frames: 6, cols: 6, fw: 198, fh: 172, footX: 99, footY: 168, ms: 110 },
  "creep-n-meat-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 142, fh: 115, footX: 71, footY: 111, figH: 92, ms: 95, figS: 92 },
  "creep-n-meat-golem-death": { kind: "death", frames: 6, cols: 6, fw: 226, fh: 141, footX: 113, footY: 137, ms: 110 },
  "creep-n-mountain-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 156, fh: 111, footX: 78, footY: 107, figH: 99, ms: 95, figS: 99 },
  "creep-n-mountain-golem-death": { kind: "death", frames: 6, cols: 6, fw: 216, fh: 115, footX: 108, footY: 111, ms: 110 },
  "creep-n-mud-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 154, fh: 106, footX: 77, footY: 102, figH: 92, ms: 95, figS: 92 },
  "creep-n-mud-golem-death": { kind: "death", frames: 6, cols: 6, fw: 226, fh: 125, footX: 113, footY: 121, ms: 110 },
  "creep-n-necromancer": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 160, fh: 113, footX: 80, footY: 109, figH: 96, ms: 95, figS: 96 },
  "creep-n-necromancer-death": { kind: "death", frames: 6, cols: 6, fw: 210, fh: 141, footX: 105, footY: 137, ms: 110 },
  "creep-n-raider": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 176, fh: 110, footX: 88, footY: 106, figH: 94, ms: 95, figS: 97, scale: 0.8 }, // v0.23j: smaller
  "creep-n-raider-death": { kind: "death", frames: 6, cols: 6, fw: 210, fh: 136, footX: 105, footY: 132, ms: 110 },
  "creep-n-rock-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 152, fh: 107, footX: 76, footY: 103, figH: 93, ms: 95, figS: 93 },
  "creep-n-rock-golem-death": { kind: "death", frames: 6, cols: 6, fw: 200, fh: 132, footX: 100, footY: 128, ms: 110 },
  "creep-n-satyr": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 132, fh: 117, footX: 66, footY: 113, figH: 102, ms: 95, figS: 102 },
  "creep-n-satyr-death": { kind: "death", frames: 6, cols: 6, fw: 192, fh: 134, footX: 96, footY: 130, ms: 110 },
  "creep-n-shade": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 172, fh: 105, footX: 86, footY: 101, figH: 92, ms: 95, figS: 98 },
  "creep-n-shade-death": { kind: "death", frames: 6, cols: 6, fw: 178, fh: 137, footX: 89, footY: 133, ms: 110 },
  "creep-n-shaman": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 132, fh: 104, footX: 66, footY: 100, figH: 91, ms: 95, figS: 91 },
  "creep-n-shaman-death": { kind: "death", frames: 6, cols: 6, fw: 226, fh: 154, footX: 113, footY: 150, ms: 110 },
  "creep-n-siege-golem": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 142, fh: 111, footX: 71, footY: 107, figH: 94, ms: 95, figS: 94 },
  "creep-n-siege-golem-death": { kind: "death", frames: 6, cols: 6, fw: 236, fh: 134, footX: 118, footY: 130, ms: 110 },
  "creep-n-spawn-spider": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 152, fh: 99, footX: 76, footY: 95, figH: 74, ms: 95, figS: 91 },
  "creep-n-spawn-spider-death": { kind: "death", frames: 6, cols: 6, fw: 168, fh: 128, footX: 84, footY: 124, ms: 110 },
  "creep-n-spiritwolf": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 196, fh: 108, footX: 98, footY: 104, figH: 85, ms: 95, figS: 93 },
  "creep-n-spiritwolf-death": { kind: "death", frames: 6, cols: 6, fw: 248, fh: 173, footX: 124, footY: 169, ms: 110 },
  "creep-n-zombie": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 116, fh: 101, footX: 58, footY: 97, figH: 87, ms: 95, figS: 87 },
  "creep-n-zombie-death": { kind: "death", frames: 6, cols: 6, fw: 176, fh: 97, footX: 88, footY: 93, ms: 110 },
  "creep-n-wolf": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 254, fh: 166, footX: 127, footY: 160, figH: 138, figS: 138, ms: 95 },
  "creep-n-skeleton": { kind: "walk", dirs: 8, frames: 6, cols: 6, fw: 190, fh: 151, footX: 95, footY: 145, figH: 133, figS: 133, ms: 95, scale: 0.82 }, // v0.23j: smaller
});
/** v0.23a (creep graphic overhaul): painted head portraits for the send buttons, by the creep's art key (original design). */
export const CREEP_PORTRAIT = Object.freeze({
  "creep-n-arcane-golem": "creep-p-arcane-golem",
  "creep-n-bat": "creep-p-bat",
  "creep-n-demon-hound": "creep-p-demon-hound",
  "creep-n-flying-machine": "creep-p-flying-machine",
  "creep-n-flying-sheep": "creep-p-flying-sheep",
  "creep-n-forest-troll": "creep-p-forest-troll",
  "creep-n-gnoll": "creep-p-gnoll",
  "creep-n-horse": "creep-p-horse",
  "creep-n-goblin": "creep-p-goblin",
  "creep-n-grunt": "creep-p-grunt",
  "creep-n-infernal-golem": "creep-p-infernal-golem",
  "creep-n-meat-golem": "creep-p-meat-golem",
  "creep-n-mountain-golem": "creep-p-mountain-golem",
  "creep-n-mud-golem": "creep-p-mud-golem",
  "creep-n-necromancer": "creep-p-necromancer",
  "creep-n-raider": "creep-p-raider",
  "creep-n-rock-golem": "creep-p-rock-golem",
  "creep-n-satyr": "creep-p-satyr",
  "creep-n-shade": "creep-p-shade",
  "creep-n-shaman": "creep-p-shaman",
  "creep-n-siege-golem": "creep-p-siege-golem",
  "creep-n-spawn-spider": "creep-p-spawn-spider",
  "creep-n-spiritwolf": "creep-p-spiritwolf",
  "creep-n-zombie": "creep-p-zombie",
});
export const animUrl = (key) => `assets/anim/${key}.webp?v=${ART_VERSION}`;
export const TOWER_ART = Object.keys(ART_MANIFEST).filter((k) => k.startsWith("tower-"));
export const CREEP_ART = Object.keys(ART_MANIFEST).filter((k) => k.startsWith("creep-"));
export const ELEMENT_ICON = {
  water: "el-water",
  fire: "el-fire",
  storm: "el-storm",
  earth: "el-earth",
  arcane: "el-arcane",
  plague: "el-plague",
};

const ELEMENT_TOWER = {
  water: "tower-frost",
  fire: "tower-fire",
  storm: "tower-storm",
  earth: "tower-earth",
  arcane: "tower-arcane",
  plague: "tower-poison",
};
const ROOT_TOWER = {
  h003: "tower-archer",
  h000: "tower-guard",
  h02R: "tower-cannon",
  h03V: "tower-arcane",
  h02Q: "tower-farm",
  h05L: "tower-hall",
  hWAL: "tower-wall", // v0.12
  hROK: "deco-rock", // v0.17: campaign rocks
};
const RESEARCH_ART = {
  R00M: "tower-fire",
  R00N: "tower-frost",
  R00O: "tower-storm",
  R00P: "tower-poison",
  R00Q: "tower-earth",
  R00R: "tower-arcane",
  R00K: "tower-archer",
  R00U: "tower-guard",
  R00V: "tower-guard",
  R00W: "tower-storm",
  R00X: "tower-arcane",
  R001: "tower-frost",
  R002: "tower-guard",
  R006: "tower-arcane",
  R00C: "tower-fire",
  R00D: "creep-wolf",
};
/** Monster figures; the first matching name wins. Missing art falls back to the generic set. */
/** Monster figures of the original design; the first matching name wins. */
const CREEP_PATTERNS = [
  // v0.23a (creep graphic overhaul): every creep uses a bestiary figure; a figure shared by two creeps gets a colour variant
  [/\[murloc\]/i, "creep-n-sea-kraken"], // Naga Siren's death spawns
  [/flying sheep/i, "creep-n-flying-sheep"],
  [/flying machine/i, "creep-n-flying-machine"],
  [/zeppelin/i, "creep-n-giant-bat"],
  [/shade/i, "creep-n-shade"],
  [/bat rider/i, "creep-n-bat"],
  [/void walker/i, "creep-n-imp-void"],
  [/frost wyrm/i, "creep-n-frost-dragon"],
  [/gryphon/i, "creep-n-inferno-dragon"],
  [/black dragon/i, "creep-n-void-dragon"],
  [/^wisp$|\bwisp\b/i, "creep-n-ice-imp"],
  [/rock golem/i, "creep-n-rock-golem"],
  [/mud golem/i, "creep-n-mud-golem"],
  [/arcane golem/i, "creep-n-arcane-golem"],
  [/siege golem/i, "creep-n-siege-golem"],
  [/meat golem/i, "creep-n-meat-golem"],
  [/infernal golem/i, "creep-n-infernal-golem"],
  [/mountain golem/i, "creep-n-mountain-golem"],
  [/midfernal|babyfernal|inferno \w*berth|infernal/i, "creep-n-lava-golem"],
  [/abomination/i, "creep-n-abomination"],
  [/clockwork goblin/i, "creep-n-bomber"],
  [/iron maiden/i, "creep-n-bone-knight"],
  [/horse/i, "creep-n-horse"], // v0.23d: hay pony
  [/satyr/i, "creep-n-satyr"],
  [/skeleton mage/i, "creep-n-skeleton-archer"],
  [/necromancer/i, "creep-n-necromancer"],
  [/witch doctor/i, "creep-n-skeleton-mage-green"],
  [/akolyte|acolyte/i, "creep-n-plague-zombie"],
  [/fel raider/i, "creep-n-armored-boar-fel"],
  [/raider/i, "creep-n-raider"],
  [/alchemist/i, "creep-n-bomber"],
  [/boar|scout/i, "creep-n-armored-boar"],
  [/centaur/i, "creep-n-spiked-slime"],
  [/skeleton (grunt|berserker)/i, "creep-n-bone-knight"],
  [/treant/i, "creep-n-forest-golem"],
  [/forest troll/i, "creep-n-forest-troll"],
  [/rouge wizard|rogue wizard/i, "creep-n-fire-imp"],
    [/spider/i, "creep-n-spawn-spider"],
  [/grom/i, "creep-n-orc-berserker"],
  [/zombie/i, "creep-n-zombie"],
  [/marauder/i, "creep-n-crystal-worm"],
  [/rouge captain|rogue captain/i, "creep-n-ogre"],
  [/naga|siren/i, "creep-n-sea-kraken"],
  [/spiritwalker/i, "creep-n-ice-slime"],
  [/shaman/i, "creep-n-shaman"],
  [/cairne|tauren/i, "creep-n-brute-brown"],
  [/ghoul/i, "creep-n-ghoul"],
  [/demon hound/i, "creep-n-demon-hound"],
  [/sasquatch/i, "creep-n-troll-brown"],
  [/dragonspawn/i, "creep-n-burrower"],
  [/spellbreaker/i, "creep-n-orc-berserker-violet"],
  [/warlock/i, "creep-n-fire-imp-fel"],
  [/demon hunter/i, "creep-n-orc-shadow"],
  [/scarab/i, "creep-n-sand-worm"],
  [/faceless/i, "creep-n-crystal-worm-green"],
  [/dryad/i, "creep-n-forest-golem-autumn"],
  [/druid/i, "creep-n-spiked-slime-violet"],
  [/wendigo/i, "creep-n-ice-imp-violet"],
  [/garithos/i, "creep-n-bone-knight"],
  [/warden/i, "creep-n-ghoul-green"],
  [/pit lord/i, "creep-n-demon-lord-fel"],
  [/spirit ?wolf/i, "creep-n-spiritwolf"],
  [/wolf/i, "creep-n-wolf"],
  [/skeleton/i, "creep-n-skeleton"],
  [/gnoll/i, "creep-n-gnoll"],
  [/grunt|\borc\b/i, "creep-n-grunt"],
  [/chaos peon|wichtel|^imp$|\bimp\b/i, "creep-n-imp"],
  [/peon|goblin|peasant/i, "creep-n-goblin"],
];
/** Design variants (art sets): the monster figures the sets know. */
const SET_CREEP_PATTERNS = [
  [/\[murloc\]/i, "creep-siren", "creep-siren"], // v0.21p: Naga Siren's death spawns look like little Naga Sirens
  [/flying sheep/i, "creep-sheep-fly", "creep-harpy"],
  [/flying machine/i, "creep-gyrocopter", "creep-harpy"],
  [/zeppelin/i, "creep-zeppelin", "creep-harpy"],
  [/shade/i, "creep-shade", "creep-harpy"],
  [/bat rider/i, "creep-bat-rider", "creep-harpy"],
  [/void walker/i, "creep-voidwalker", "creep-harpy"],
  [/frost wyrm/i, "creep-frost-wyrm", "creep-harpy"],
  [/gryphon/i, "creep-gryphon", "creep-harpy"],
  [/black dragon/i, "creep-black-dragon", "creep-harpy"],
  [/rock golem/i, "creep-golem", "creep-golem"],
  [/arcane golem/i, "creep-golem", "creep-golem"], // v0.12
  [/^wisp$/i, "creep-shade", "creep-shade"], // v0.17c: the Treant's Wisp gets art that carries the player colour
  [/siege golem/i, "creep-siege-golem", "creep-golem"],
  [/meat golem|abomination/i, "creep-flesh-golem", "creep-ghoul"],
  [/infernal/i, "creep-infernal", "creep-golem"],
  [/mountain golem/i, "creep-mountain-golem", "creep-golem"],
  [/horse/i, "creep-horse", "creep-boar"],
  [/satyr/i, "creep-satyr", "creep-orc"],
  [/necromancer|akolyte|skeleton mage/i, "creep-necromancer", "creep-shaman"],
  [/fel raider/i, "creep-fel-raider", "creep-boar"],
  [/raider/i, "creep-raider", "creep-boar"],
  [/alchemist/i, "creep-alchemist", "creep-shaman"],
  [/centaur/i, "creep-centaur", "creep-boar"],
  [/troll/i, "creep-troll", "creep-orc"],
  [/spider|arachnatid/i, "creep-spider", "creep-orc"],
  [/grom|green grunt/i, "creep-orc-warlord", "creep-orc"],
  [/marauder/i, "creep-marauder", "creep-darkknight"],
  [/demon hunter|warden/i, "creep-demon-slayer", "creep-darkknight"],
  [/siren/i, "creep-siren", "creep-shaman"],
  [/shieldbearer/i, "creep-spellbreaker", "creep-darkknight"], // v0.22o2: the former Spiritwalker carries a shield
  [/cairne|spiritwalker/i, "creep-minotaur", "creep-orc"],
  [/demon hound/i, "creep-hellhound", "creep-wolf"],
  [/sasquatch|wendigo|druid/i, "creep-yeti", "creep-wolf"],
  [/dragonspawn/i, "creep-dragonspawn", "creep-orc"],
  [/warlock|rouge wizard|rogue wizard/i, "creep-warlock", "creep-shaman"],
  [/scarab/i, "creep-scarab", "creep-orc"],
  [/dryad|treant/i, "creep-dryad", "creep-goblin"],
  [/pit lord|faceless/i, "creep-pit-lord", "creep-darkknight"],
  [/spellbreaker|garithos/i, "creep-spellbreaker", "creep-darkknight"],
  [/wolf|hound/i, "creep-wolf"],
  [/skeleton/i, "creep-skeleton"],
  [/zombie|ghoul/i, "creep-ghoul"],
  [/gnoll/i, "creep-gnoll"],
  [/boar|scout/i, "creep-boar"],
  [/shaman|wizard|witch|mage/i, "creep-shaman"],
  [/knight|captain|hunter/i, "creep-darkknight"],
  [/grunt|orc|ogre|golem/i, "creep-orc"],
  [/chaos peon|wichtel|^imp$|\bimp\b/i, "creep-wichtel", "creep-goblin"], // v0.21m: Chaos Peon is called Imp
  [/peon|goblin/i, "creep-goblin"],
];
/** Tower figures by name and level: upgrades change the figure, not just a badge. */
const TOWER_PATTERNS = [
  [/headhunter/i, () => "tower-headhunter"],
  [/naga archer/i, () => "tower-naga-archer"],
  [/death knight/i, () => "tower-death-knight"],
  [/archangel/i, () => "tower-archangel"],
  [/tree of life/i, () => "tower-tree-of-life"],
  [/fire lord/i, () => "tower-fire-lord"],
  [/magic city/i, () => "tower-magic-city"],
  [/archmage/i, () => "tower-archmage"],
  [/pit lord/i, () => "tower-pit-lord"],
  [/phoenix/i, () => "tower-phoenix"],
  [/hydra/i, () => "tower-hydra"],
  [/kel ?thuzad/i, () => "tower-lich"],
  [/robogoblin/i, () => "tower-robogoblin"],
  [/bird hunter/i, () => "tower-birdhunter"],
  [/water elemental/i, () => "tower-water-elemental"],
  [/fire elemental/i, () => "tower-fire-elemental"],
  [/frost archer/i, () => "tower-frost-archer"],
  [/earth laser/i, () => "tower-earth-laser"],
  [/fire archer/i, () => "tower-fire-archer"],
  [/poison archer/i, () => "tower-poison-archer"],
  [/trueshot/i, () => "tower-trueshot"],
  [/arcane tower/i, () => "tower-arcane-archer"],
  [/arrow tower|detector/i, (l) => (l >= 4 ? "tower-arrowtower" : "tower-archer-elite")],
  [/ogre/i, () => "tower-ogre"],
  [/naga guard/i, () => "tower-naga-guard"],
  [/stomp/i, () => "tower-stomp"],
  [/flame crusader/i, () => "tower-flame-crusader"],
  [/bash/i, () => "tower-bash"],
  [/zombie/i, () => "tower-zombie"],
  [/glaive/i, () => "tower-glaive"],
  [/treant/i, () => "tower-treant"],
  [/disease/i, () => "tower-disease"],
  [/lumbermill|exp[- ]generator/i, () => "tower-exp-generator"], // v0.21m: Lumbermill is called EXP Generator
  [/repurpose\] footman/i, () => "tower-guard"],
  [/repurpose\] bombard/i, () => "tower-cannon"],
  [/repurpose\] magic/i, () => "tower-arcane"],
  // Guard levels: 1 wood and leather, 2 steel sword + leather, 3 full steel with helmet, 4 elite, 5+ champion.
  [/footman/i, (l) => (l >= 5 ? "tower-guard-champion" : l >= 4 ? "tower-guard-elite" : l >= 3 ? "tower-guard" : l >= 2 ? "tower-guard-l2" : "tower-guard-l1")],
  [/bombard/i, (l) => (l >= 4 ? "tower-cannon-elite" : "tower-cannon")],
  [/magic tower/i, (l) => (l >= 5 ? "tower-magic-grand" : l >= 3 ? "tower-magic-elite" : "tower-arcane")],
  [/archer/i, (l) => (l >= 3 ? "tower-archer-elite" : "tower-archer")],
];
const has = (key) => Object.hasOwn(ART_MANIFEST, key);

function baseArtFor(item) {
  if (!item) return "tower-archer";
  if (item.kind === "research") return RESEARCH_ART[item.id] || ELEMENT_TOWER[item.element] || "tower-hall";
  const name = item.name || "";
  if (item.kind === "send" || item.kind === "unit") {
    if (!artSet) {
      // v0.23a (creep graphic overhaul): the original design draws the bestiary figures
      for (const [pattern, art] of CREEP_PATTERNS) if (pattern.test(name) && has(art)) return art;
      if (item.bossTier) return "creep-n-stone-titan";
      if (item.flying) return "creep-n-bat";
      return item.armor > 5 ? "creep-n-bone-knight" : item.hp > 400 ? "creep-n-grunt" : "creep-n-goblin";
    }
    for (const [pattern, art, fallback] of SET_CREEP_PATTERNS) if (pattern.test(name)) return has(art) ? art : fallback || "creep-goblin";
    if (item.bossTier) return "creep-golem";
    if (item.flying) return "creep-harpy";
    return item.armor > 5 ? "creep-darkknight" : item.hp > 400 ? "creep-orc" : "creep-goblin";
  }
  if (item.id === "h02Q" || item.support === "farm") return "tower-farm";
  if (item.id === "h05L") return "tower-hall";
  // Halls of a single element show that element's figure; combos have their own.
  if (/hall of/i.test(name)) return ELEMENT_TOWER[item.element] || "tower-hall";
  const level = item.level || 1;
  for (const [pattern, pick] of TOWER_PATTERNS)
    if (pattern.test(name)) {
      const key = pick(/instant/i.test(name) ? Math.max(3, level) : level);
      if (has(key)) return key;
      break;
    }
  if (ROOT_TOWER[item.id]) return ROOT_TOWER[item.id];
  if (ELEMENT_TOWER[item.element]) return ELEMENT_TOWER[item.element];
  if (/footman|knight|guard|soldier|bash|glaive|crusader/i.test(name)) return "tower-guard";
  if (/cannon|canon|bombard|siege|stomp|launcher|robogoblin|laser/i.test(name)) return "tower-cannon";
  if (/mage|magic|wizard|kel|death knight|archangel|phoenix/i.test(name)) return "tower-arcane";
  if (/lumbermill|exp generator|tree|treant|ogre/i.test(name)) return "tower-earth";
  return "tower-archer";
}
/** Visual tier for the pedestal aura: 4 silver, 5 gold, 6 violet, 7 prismatic (top tier and combos). */
export function towerTier(item) {
  if (!item) return 1;
  if ((item.level || 1) >= 7 || /&|all elements/i.test(item.name || "")) return 7;
  return item.level || 1;
}

// ---- level variants ------------------------------------------------------------------
// Towers of one line that share a figure get plainer variants the further they are below the
// line's top level (level-1 roots one step plainer still), so every upgrade is visible.
const VARIANT_BY_ID = new Map();
const lineName = (name) =>
  String(name || "")
    .replace(/\|c\w{8}|\|r/g, "")
    .replace(/\s*\[Level \d+\]/i, "")
    .trim();
let variantEpoch = 0; // v0.23h: bumped when the tower variants are registered (artFor cache)
export function registerTowerArt(towers) {
  VARIANT_BY_ID.clear();
  variantEpoch++;
  const groups = new Map();
  for (const t of towers) {
    if (!t?.playable) continue;
    const key = baseArtFor(t),
      g = lineName(t.name) + "|" + key;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ t, key });
  }
  // The first band of a line (its lowest levels) runs the whole scale down to wood and linen;
  // later bands already use a grander figure and only step down to leather.
  const lineLow = new Map();
  for (const [g, list] of groups) {
    const line = g.split("|")[0],
      low = Math.min(...list.map((x) => x.t.level || 1));
    lineLow.set(line, Math.min(lineLow.get(line) ?? Infinity, low));
  }
  for (const [g, list] of groups) {
    const levels = list.map((x) => x.t.level || 1),
      top = Math.max(...levels),
      first = Math.min(...levels) === lineLow.get(g.split("|")[0]);
    for (const { t, key } of list) {
      const d = top - (t.level || 1),
        strength = first ? Math.min(3, d + (list.length <= 3 && d > 0 ? 1 : 0)) : Math.min(2, d),
        variant = strength > 0 ? `${key}-v${strength}` : null;
      if (variant && has(variant)) VARIANT_BY_ID.set(t.id, variant);
    }
  }
}
// v0.23h: the picture of a unit is looked up once per design set (the creep loop asked for it every frame,
// running dozens of name patterns per creep)
const ART_FOR_CACHE = new WeakMap();
export function artFor(item) {
  if (!item || typeof item !== "object") return (item && VARIANT_BY_ID.get(item.id)) || baseArtFor(item);
  const hit = ART_FOR_CACHE.get(item);
  if (hit && hit.set === artSet && hit.v === variantEpoch && hit.name === item.name) return hit.art;
  const art = VARIANT_BY_ID.get(item.id) || baseArtFor(item);
  ART_FOR_CACHE.set(item, { set: artSet, v: variantEpoch, name: item.name, art });
  return art;
}

/**
 * Player colours. The art is painted in team blue; other colours move that blue to `hue`
 * and scale its saturation and brightness (brown and pink need the extra push).
 */
export const TEAM_COLORS = Object.freeze({
  // v0.08a: menu order and four new colours; black and white keep the cloth's shading
  blue: { name: "Blue", css: "#1c74e0", hex: 0x1c74e0, hue: null }, // v0.17: back to the original blue
  red: { name: "Red", css: "#cf241c", hex: 0xcf241c, hue: 356 },
  green: { name: "Green", css: "#16962e", hex: 0x16962e, hue: 128, sat: 1, val: 0.85 },
  yellow: { name: "Yellow", css: "#ffb703", hex: 0xffb703, hue: 43, sat: 1, val: 1.12 },
  orange: { name: "Orange", css: "#fb8500", hex: 0xfb8500, hue: 32, sat: 1, val: 1.08 },
  purple: { name: "Purple", css: "#5a17b5", hex: 0x5a17b5, hue: 271, sat: 1, val: 0.74 },
  teal: { name: "Teal", css: "#0b9c90", hex: 0x0b9c90, hue: 176, sat: 1, val: 0.85 },
  pink: { name: "Pink", css: "#ffc0cb", hex: 0xffc0cb, hue: 350, sat: 0.32, val: 1.3 },
  lightblue: { name: "Light blue", css: "#87ceeb", hex: 0x87ceeb, hue: 197, sat: 0.5, val: 1.22 },
  brown: { name: "Brown", css: "#7a4718", hex: 0x7a4718, hue: 28, sat: 0.85, val: 0.6 },
  black: { name: "Black", css: "#3a3c45", hex: 0x3a3c45, hue: 230, sat: 0.12, val: 0.5 }, // v0.09: a tad lighter
  white: { name: "White", css: "#eceae4", hex: 0xeceae4, hue: 45, sat: 0.07, val: 1.38 },
});
/** v0.15: cloth colours for recolouring: the player colours plus a muted leather brown for neutral creeps. */
export const CLOTH_COLORS = Object.freeze({ ...TEAM_COLORS, neutral: { name: "Neutral", css: "#8a8f96", hex: 0x8a8f96, hue: 215, sat: 0.08, val: 0.82 } });
/** Moves the saturated team blue in RGBA pixel data to a player colour (in place). */
export function recolorTeam(d, colorId) {
  const color = CLOTH_COLORS[colorId];
  if (!color || color.hue === null) return;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 10) continue;
    const r = d[i],
      g = d[i + 1],
      b = d[i + 2],
      mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      c = mx - mn;
    if (mx !== b || c < 0.38 * mx || mx < 40) continue; // only saturated blues
    const h = ((r - g) / c + 4) * 60; // hue of blue-max pixels, 180°..300°
    if (h < 205 || h > 258) continue; // team blue only, not teal glows or violet magic
    // same lightness and saturation, hue moved to the player's colour
    const v = Math.min(255, mx * (color.val || 1)),
      sat = Math.min(1, (c / mx) * (color.sat || 1)),
      nh = color.hue + (h - 230) * 0.25,
      hh = ((((nh % 360) + 360) % 360) / 60),
      k = Math.floor(hh),
      f = hh - k,
      p = v * (1 - sat),
      q = v * (1 - sat * f),
      t = v * (1 - sat * (1 - f)),
      rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][k % 6];
    d[i] = rgb[0];
    d[i + 1] = rgb[1];
    d[i + 2] = rgb[2];
  }
}
