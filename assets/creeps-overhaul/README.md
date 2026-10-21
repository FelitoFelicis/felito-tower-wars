# Creep graphic overhaul – staged sheets

Cut from the 21.10.2026 sprite sheets with `tools/creep-sheets/cut_creep_sheet.py`
(labels, pills and separator lines removed, halo-free edges). Not wired into the game yet.

Per creep: `anim/<key>.webp` (8 directions x 6 walk frames; rows front, front-right, right,
back-right, back, back-left, left, front-left), `anim/<key>-death.webp` (6 death frames),
`art/<key>.webp` (still), `art/creep-p-*.webp` (portrait for the send button),
`meta/<key>.json` (frame size, foot point, figure height).

| Key | Creep |
| --- | --- |
| creep-n-spawn-spider | Spawn Spider |
| creep-n-forest-troll | Forest Troll |
| creep-n-spiritwolf | Spiritwolf |
| creep-n-demon-hound | Demon Hound |
| creep-n-flying-machine | Flying Machine |
| creep-n-infernal-golem | Infernal Golem |
| creep-n-meat-golem | Meat Golem |
| creep-n-arcane-golem | Arcane Golem (crystal golem) |
| creep-n-grunt | Grunt |
| creep-n-siege-golem | Siege Golem (bronze) |
| creep-n-mountain-golem | Mountain Golem (stone, armoured) |
| creep-n-rock-golem | Rock Golem |
| creep-n-mud-golem | Mud Golem |
| creep-n-satyr | Satyr |
| creep-n-necromancer | Necromancer |
| creep-n-shade | Shade |
| creep-n-raider | Raider |
| creep-n-shaman | Shaman |

Already in the game on this branch (v0.22f): Goblin, Gnoll, Bat Rider (bat), Flying Sheep,
Zombie (all with death animation and portrait), Boar (walk only; Boar Scout renamed to Boar).
Air golem, gold golem and banshee sheets are not used yet.
