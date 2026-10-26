/**
 * v0.17: single-player campaign. 30 missions, each with a short scene, an enemy with its own
 * traits (sends, towers, maze, temper) and special start settings.
 * v0.26: briefings name only the rules (lives, goal, limits); what the enemy does is for the player
 * to find out. `aux`: Neutral Auxiliaries, neutral creeps on the enemy's side that enter only the
 * player's lane (simulation.js missionAux: { unit, from, until, tier, share, group, variant }).
 * `setup` goes to createGame({ mission }) as plain data; the rules live in simulation.js
 * (applyMission). Cells are "x,y" on the 6×9 board (x 0–5 left to right, y 0–8 portal to exit).
 */

// creeps by tier (ids from the map data)
const C = {
  goblin: "n00E", horse: "n007", gnoll: "n00K", wolf: "n00L", skeleton: "n00R", grunt: "n00M", satyr: "n00Q", necro: "n00N", sheep: "n00P", raider: "n00S", alchemist: "n021",
  imp: "n00U", boar: "n00W", centaur: "n00X", machine: "n00V", skelGrunt: "n011", treant: "n00Y", troll: "n010", wizard: "n002", zeppelin: "n012", spider: "n02V", grom: "n014",
  zombie: "n016", marauder: "n00O", skelMage: "n01B", shade: "n019", captain: "n018", siren: "n03A", shaman: "n01A", felRaider: "n01C", batRider: "n01E", spiritwalker: "n01G", cairne: "n01F",
  acolyte: "n013", ghoul: "n01D", hound: "n02L", witchDoctor: "n00F", voidWalker: "n01L", sasquatch: "n039", dragonspawn: "n01N", spellbreaker: "n02M", warlock: "n01R", frostWyrm: "n02N", demonHunter: "n02O",
  scarab: "n01S", faceless: "n01Y", dryad: "n023", gryphon: "n025", druid: "n026", wendigo: "n02J", abomination: "n02E", garithos: "n02I", blackDragon: "n02K", warden: "n02P", pitLord: "n02Q",
};
// tower lines (their roots; every upgrade of a root belongs to its line)
const T = { archer: "h003", footman: "h000", cannon: "h02R", magic: "h03V", halls: "h05L", exp: "h01F" };
const FLYERS = [C.sheep, C.machine, C.zeppelin, C.shade, C.voidWalker, C.frostWyrm, C.gryphon, C.blackDragon];
const UNDEAD = [C.skeleton, C.necro, C.skelGrunt, C.zombie, C.ghoul, C.acolyte, C.abomination, C.frostWyrm];
const FAST = [C.wolf, C.raider, C.centaur, C.troll, C.felRaider, C.hound, C.dryad];
const DEMONS = [C.imp, C.grunt, C.felRaider, C.hound, C.voidWalker, C.demonHunter, C.pitLord, C.marauder];
const elements = (a, b) => [a, b, ...["water", "fire", "earth", "storm", "arcane", "plague"].filter((e) => e !== a && e !== b)];

export const MISSIONS = [
  {
    title: "The Goblin King",
    enemy: "Grumbo",
    art: "creep-goblin",
    scene: [
      ["Pip", "Your first duel, boss! Over there sits Grumbo, self-crowned King of the Goblins."],
      ["Grumbo", "Bow before Grumbo! Grumbo has a smiley maze. SMILEY. Fear it!"],
      ["Grumbo", "And Grumbo's cousins come along. Lots of cousins. Every round!"],
    ],
    briefing: "Win the duel. You have 10 lives, Grumbo 10. Neutral auxiliaries fight on his side.",
    setup: {
      level: "veryEasy",
      waves: false,
      player: { lives: 10 },
      enemies: [{ name: "Grumbo", art: "creep-goblin", level: "veryEasy", lives: 10, sends: [C.goblin, C.horse, C.imp, C.boar], maze: "smiley" }],
      auxScale: 0.8, // the first mission stays gentle
      aux: [
        { unit: C.goblin, from: 1, until: 15 },
        { unit: C.imp, from: 16 },
      ],
    },
  },
  {
    title: "Counting Sheep",
    enemy: "Shepherd Shawn",
    art: "creep-sheep-fly",
    scene: [
      ["Shawn", "Baaa-ware, little builder! My flock is bigger than you think."],
      ["Pip", "A shepherd with a cannon? Since when do shepherds have cannons?"],
      ["Shawn", "Since the wolves came. Now the wolves work for me. Baaa-ha-ha!"],
    ],
    briefing: "Win the duel. You have 20 lives, Shawn 15. Neutral auxiliaries fight on his side.",
    setup: {
      level: "veryEasy",
      player: { lives: 20 },
      enemies: [{ name: "Shepherd Shawn", art: "creep-sheep-fly", level: "easy", lives: 15, sends: [C.sheep, C.goblin, C.machine, C.imp], towers: [T.footman, T.cannon], prebuild: [{ id: T.cannon, cells: "2,3" }], maze: "pillars" }],
      aux: [
        { unit: C.wolf, from: 4, until: 9 },
        { unit: C.sheep, from: 10 },
      ],
    },
  },
  {
    title: "Bonehilda's Choir",
    enemy: "Bonehilda",
    art: "creep-necromancer",
    scene: [
      ["Bonehilda", "La-la-laaa! My skeletons sing in perfect harmony. Join the choir… permanently!"],
      ["Pip", "Is it just me, or is the graveyard behind her getting… emptier?"],
      ["Bonehilda", "Everyone sings in my choir. Everyone. Even the ones who were resting."],
    ],
    briefing: "Win the duel. Bonehilda has 20 lives. Neutral auxiliaries fight on her side.",
    setup: {
      level: "easy",
      player: {},
      enemies: [{ name: "Bonehilda", art: "creep-necromancer", level: "easy", lives: 20, sends: UNDEAD, maze: "heart" }],
      auxScale: 1.25, // a slightly bigger choir than usual
      aux: [
        { unit: C.skeleton, from: 2, variant: "lesser" },
        { unit: C.skeleton, from: 7 },
        { unit: C.necro, from: 13 },
        { unit: C.skelGrunt, tier: 2 },
        { unit: C.zombie, tier: 3 },
      ],
    },
  },
  {
    title: "Rock Bottom",
    enemy: "Mason Mortimer",
    art: "creep-golem",
    scene: [
      ["Mortimer", "I dumped some rocks in your lane. Free of charge! You're welcome."],
      ["Pip", "Eight boulders in our field! Tap one to clear it for gold…"],
      ["Pip", "…or steal lives from Mortimer: every life you steal cracks one rock."],
    ],
    briefing: "Eight rocks block your field. Clear them for 40 gold each, or crack one with every life you steal. Neutral auxiliaries fight on Mortimer's side.",
    setup: {
      level: "easy",
      rocksOnSteal: true,
      rockCost: 40,
      player: { rocks: "1,1 4,1 2,3 3,3 0,5 5,5 2,7 3,7" },
      enemies: [{ name: "Mason Mortimer", art: "creep-golem", level: "easy", sleep: 30 }],
      aux: [
        { unit: C.gnoll, from: 3 },
        { unit: C.grunt, from: 12 },
      ],
    },
  },
  {
    title: "Professor Boom",
    enemy: "Professor Boom",
    art: "creep-alchemist",
    scene: [
      ["Boom", "KA-BOOM! Cannons, cannons, cannons! The only towers worth building!"],
      ["Pip", "Are those goblins carrying… barrels?"],
      ["Boom", "My lab assistants! Very enthusiastic. Very flammable."],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on Boom's side.",
    setup: {
      level: "easy",
      player: {},
      enemies: [{ name: "Professor Boom", art: "creep-alchemist", level: "normal", towers: [T.cannon], sends: [C.goblin, C.gnoll, C.grunt, C.raider, C.imp, C.skelGrunt, C.troll, C.zombie, C.marauder] }],
      aux: [
        { unit: C.goblin, from: 2 },
        { unit: C.imp, from: 12 },
      ],
    },
  },
  {
    title: "Wolfgang's Pack",
    enemy: "Wolfgang",
    art: "creep-wolf",
    scene: [
      ["Wolfgang", "Awoooo! My pack runs faster than your arrows fly!"],
      ["Pip", "The farm folk sent us 150 gold. They really don't like wolves."],
      ["Wolfgang", "Nobody likes wolves. That's why we bite."],
    ],
    briefing: "Win the duel. You start with 150 extra gold. Neutral auxiliaries fight on Wolfgang's side.",
    setup: {
      level: "easy",
      player: { gold: 150 },
      enemies: [{ name: "Wolfgang", art: "creep-wolf", level: "normal", sends: FAST }],
      aux: [
        { unit: C.wolf, from: 3 },
        { unit: C.raider, from: 12 },
      ],
    },
  },
  {
    title: "Last Stand at Pip's Farm",
    enemy: "Captain Krag",
    art: "creep-orc",
    scene: [
      ["Pip", "Bad news, boss. Krag's raiders burned the fences. We're down to 6 lives!"],
      ["Krag", "Six lives! Hah! I'll be eating your pumpkins by round ten."],
      ["Pip", "The king's army is on its way. It just needs a little… time."],
    ],
    briefing: "You have only 6 lives. Survive 25 rounds to win. Three archers already stand guard. Neutral auxiliaries fight on Krag's side.",
    setup: {
      level: "normal",
      waves: false,
      goal: { survive: 25 },
      player: { lives: 6, prebuild: [{ id: T.archer, cells: "2,2 3,4 2,6" }] },
      enemies: [{ name: "Captain Krag", art: "creep-orc", level: "normal", persona: { saveMore: 0, push: 0 } }],
      auxScale: 0.8,
      aux: [
        { unit: C.gnoll, from: 3 },
        { unit: C.grunt, from: 10 },
        { unit: C.boar, from: 18 },
      ],
    },
  },
  {
    title: "The Pacifist",
    enemy: "Brother Tumbleweed",
    art: "creep-shaman",
    scene: [
      ["Tumbleweed", "Peace, friend. I shall never send a single creep against you."],
      ["Pip", "Suspicious."],
      ["Tumbleweed", "The monks will vote for me if you have not won by round 30. Peace takes patience."],
    ],
    briefing: "Win before round 30. Tumbleweed has 40 lives and earns no bounty from kills. All your creeps are ready at once. No defensive perks are offered in this mission.",
    setup: {
      level: "normal",
      goal: { deadline: 30 },
      player: { noDefensePerks: true, noStartDelay: true }, // v0.26bF: every creep ready from the start
      // v0.26bF: start gold 200 % (30 + 30 = 60), no bounty from kills, at least 4 Archer-Line towers (1 before the end of round 4)
      enemies: [{ name: "Brother Tumbleweed", art: "creep-shaman", level: "normal", lives: 40, sends: [], gold: 30, income: 10, noBounty: true, archers: { total: 4, early: 1, by: 4 } }], // 60 gold, 30 income
    },
  },
  {
    title: "Lady Tuskana",
    enemy: "Lady Tuskana",
    art: "creep-boar",
    scene: [
      ["Tuskana", "Charge, my darlings! Tusks forward!"],
      ["Pip", "She has a pillar garden. Who keeps a pillar garden?"],
      ["Tuskana", "Elegance, little builder. Something you would not understand."],
    ],
    briefing: "Win the duel. Neutral waves are on.",
    setup: { level: "normal", waves: true, player: {}, enemies: [{ name: "Lady Tuskana", art: "creep-boar", level: "normal", sends: [C.boar, C.centaur, C.troll, C.horse, C.gnoll, C.grunt, C.marauder, C.captain, C.cairne], maze: "pillars" }] },
  },
  {
    title: "Goldfinger",
    enemy: "Goldfinger",
    art: "creep-orc-warlord",
    scene: [
      ["Goldfinger", "Gold, gold, gold! I earn more than you and I keep it. Towers are so… expensive."],
      ["Pip", "Is he counting coins? In the middle of a duel?"],
      ["Goldfinger", "Every coin counts. Especially the ones I take from you."],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on Goldfinger's side.",
    setup: {
      level: "normal",
      player: {},
      enemies: [{ name: "Goldfinger", art: "creep-orc-warlord", level: "normal", income: 10, maxTowers: 12, persona: { saveMore: 3, greed: 0.6 } }],
      aux: [
        { unit: C.horse, from: 2 },
        { unit: C.imp, from: 14 },
      ],
    },
  },
  {
    title: "The Troll Bridge",
    enemy: "Toll-Troll Gunther",
    art: "creep-troll",
    scene: [
      ["Gunther", "Nobody crosses my bridge without paying the toll! And your lane is full of rubble. Toll included."],
      ["Pip", "Six rocks again. 30 gold each to clear, or crack them by stealing lives."],
      ["Gunther", "Pay up, or my friends from under the bridge come to collect."],
    ],
    briefing: "Six rocks block your field (30 gold each, or crack one with every life you steal). Neutral auxiliaries fight on Gunther's side.",
    setup: {
      level: "normal",
      rocksOnSteal: true,
      rockCost: 30,
      player: { rocks: "0,2 5,2 2,4 3,4 1,6 4,6" },
      enemies: [{ name: "Toll-Troll Gunther", art: "creep-troll", level: "normal", sends: [C.goblin, C.wolf, C.raider, C.imp, C.troll, C.marauder, C.felRaider, C.hound], noAir: true }],
      aux: [
        { unit: C.gnoll, from: 3 },
        { unit: C.boar, from: 10 },
      ],
    },
  },
  {
    title: "Baron von Zeppelin",
    enemy: "Baron von Zeppelin",
    art: "creep-zeppelin",
    scene: [
      ["Baron", "Mein fleet rules the skies! Sheep, machines, zeppelins: all airborne, all glorious!"],
      ["Pip", "He really likes the sky."],
      ["Baron", "And the sky likes me! Look up, little builder. Look up!"],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on the Baron's side.",
    setup: {
      level: "normal",
      player: {},
      enemies: [{ name: "Baron von Zeppelin", art: "creep-zeppelin", level: "normal", sends: FLYERS, towers: [T.footman] }],
      auxScale: 0.7,
      aux: [
        { unit: C.sheep, from: 4 },
        { unit: C.machine, from: 18 },
      ],
    },
  },
  {
    title: "Archie Two-Shoes",
    enemy: "Archie Two-Shoes",
    art: "creep-darkknight",
    scene: [
      ["Archie", "One arrow, one kill. That's my motto. I only trust bows."],
      ["Pip", "Why is he called Two-Shoes?"],
      ["Archie", "Because I always land on my feet. Both of them."],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on Archie's side.",
    setup: {
      level: "normal",
      player: {},
      enemies: [{ name: "Archie Two-Shoes", art: "creep-darkknight", level: "normal", towers: [T.archer] }],
      aux: [
        { unit: C.gnoll, from: 3 },
        { unit: C.centaur, from: 14 },
      ],
    },
  },
  {
    title: "Double Trouble",
    enemy: "The Twins",
    art: "creep-satyr",
    scene: [
      ["Pib", "We are Pib and Pob! Two lanes, one brain!"],
      ["Pob", "Mostly Pib's brain."],
      ["Pip", "Two of them at once. Here we go."],
    ],
    briefing: "Three-way battle against Pib and Pob. Each twin has 15 lives.",
    setup: { seats: 3, level: "normal", player: {}, enemies: [{ name: "Pib", art: "creep-satyr", level: "easy", lives: 15 }, { name: "Pob", art: "creep-dryad", level: "normal", lives: 15 }] },
  },
  {
    title: "The Minimalist",
    enemy: "Master Mo",
    art: "creep-spider",
    scene: [
      ["Mo", "Less is more. You may build only ten towers today. I insist."],
      ["Pip", "Ten towers?!"],
      ["Mo", "And I send many, many small things. Less is more, more is… also fine."],
    ],
    briefing: "You may build at most 10 towers. You start with 100 extra gold. Neutral auxiliaries fight on Mo's side.",
    setup: {
      level: "normal",
      player: { maxTowers: 10, gold: 100 },
      enemies: [{ name: "Master Mo", art: "creep-spider", level: "normal", sends: [C.goblin, C.horse, C.gnoll, C.imp, C.boar, C.zombie, C.acolyte, C.scarab] }],
      auxScale: 0.7,
      aux: [{ unit: C.goblin, from: 2 }],
    },
  },
  {
    title: "Count Batula",
    enemy: "Count Batula",
    art: "creep-bat-rider",
    scene: [
      ["Pip", "Shhh. The Count sleeps until sunset… about 45 seconds from now."],
      ["Batula", "Zzz… bats… zzz… blood… zzz…"],
      ["Pip", "Tiptoe, boss. Tiptoe."],
    ],
    briefing: "Win the duel. Batula sleeps for the first 45 seconds. Neutral auxiliaries fight on his side.",
    setup: {
      level: "normal",
      player: {},
      enemies: [{ name: "Count Batula", art: "creep-bat-rider", level: "normal", sleep: 45, sends: FLYERS, prebuild: [{ id: T.archer, cells: "1,3 4,3 2,6" }] }],
      aux: [
        { unit: C.sheep, from: 6 },
        { unit: C.zeppelin, from: 18 },
      ],
    },
  },
  {
    title: "Glass Cannon Gary",
    enemy: "Gary",
    art: "creep-raider",
    scene: [
      ["Gary", "I've got the biggest income in the valley. I am unstoppable!"],
      ["Pip", "He says that every time."],
      ["Gary", "…Who told you that?"],
    ],
    briefing: "Win the duel. Gary has 8 lives. Neutral auxiliaries fight on his side.",
    setup: {
      level: "normal",
      player: {},
      enemies: [{ name: "Gary", art: "creep-raider", level: "normal", lives: 8, income: 15, persona: { caution: 0.6, saveMore: 2 } }],
      aux: [
        { unit: C.wolf, from: 3 },
        { unit: C.raider, from: 12 },
      ],
    },
  },
  {
    title: "The Marathon",
    enemy: "Marathon Maxi",
    art: "creep-centaur",
    scene: [
      ["Maxi", "Endurance, my friend! Thirty rounds of non-stop creeps!"],
      ["Pip", "We don't need to beat Maxi. Just still be standing after round 30."],
      ["Maxi", "Stretch your legs. It's a long way to the finish."],
    ],
    briefing: "Survive 30 rounds. Neutral waves are on.",
    setup: { level: "normal", waves: true, goal: { survive: 30 }, player: {}, enemies: [{ name: "Marathon Maxi", art: "creep-centaur", level: "normal", persona: { saveMore: 0 } }] },
  },
  {
    title: "The Undead Choir",
    enemy: "Bonehilda & Mortis",
    art: "creep-ghoul",
    scene: [
      ["Bonehilda", "I'm back! And I brought my duet partner!"],
      ["Mortis", "*rattling noises*"],
      ["Pip", "Two lanes full of undead. Lovely."],
    ],
    briefing: "Three-way battle against Bonehilda and Mortis.",
    setup: { seats: 3, level: "normal", player: {}, enemies: [{ name: "Bonehilda", art: "creep-necromancer", level: "easy", sends: UNDEAD, maze: "heart" }, { name: "Mortis", art: "creep-ghoul", level: "normal", sends: UNDEAD }] },
  },
  {
    title: "Seasick",
    enemy: "Siren Seraphina",
    art: "creep-siren",
    scene: [
      ["Seraphina", "My song makes your walkers seasick. Only your flyers can reach me now."],
      ["Pip", "She's right, our ground creeps won't march. Only flyers this time!"],
      ["Seraphina", "And my friends from the deep don't get seasick at all."],
    ],
    briefing: "You can only send flyers (and bosses). Neutral auxiliaries fight on Seraphina's side.",
    setup: {
      level: "normal",
      player: { sends: FLYERS },
      enemies: [{ name: "Siren Seraphina", art: "creep-siren", level: "normal", towers: [T.footman, T.cannon] }],
      aux: [
        { unit: C.gnoll, from: 3 },
        { unit: C.marauder, tier: 3 },
      ],
    },
  },
  {
    title: "Fortress Fritz",
    enemy: "Fortress Fritz",
    art: "creep-minotaur",
    scene: [
      ["Fritz", "My fortress was finished before you even woke up. Forty lives. Twelve towers. Good luck."],
      ["Pip", "The king sent us 500 gold for this siege. And a deadline: round 35."],
      ["Fritz", "My garrison gets bored behind the walls. Sometimes they go for a little walk."],
    ],
    briefing: "Win by round 35. Fritz starts with a full maze and 40 lives. You get 500 extra gold. Neutral auxiliaries fight on his side.",
    setup: {
      level: "hard",
      goal: { deadline: 35 },
      player: { gold: 500 },
      enemies: [{ name: "Fortress Fritz", art: "creep-minotaur", level: "hard", lives: 40, persona: { greed: 0.5, saveMore: 0 }, prebuild: [{ id: T.archer, cells: "4,0 5,0 3,0 2,1 1,2 0,8 1,8 2,8 3,7 4,6 1,3 1,4" }] }],
      aux: [
        { unit: C.grunt, from: 5 },
        { unit: C.boar, from: 12 },
        { unit: C.centaur, tier: 2 },
      ],
    },
  },
  {
    title: "Zara Stormcaller",
    enemy: "Zara Stormcaller",
    art: "creep-warlock",
    scene: [
      ["Zara", "Storm and arcane, lightning and starlight. My towers sparkle!"],
      ["Pip", "Is it going to rain?"],
      ["Zara", "Oh, it is going to do more than rain."],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on Zara's side.",
    setup: {
      level: "hard",
      player: {},
      enemies: [{ name: "Zara Stormcaller", art: "creep-warlock", level: "hard", towers: [T.archer, T.magic], persona: { elementOrder: elements("storm", "arcane"), smartElements: 0 } }],
      aux: [
        { unit: C.sheep, from: 5 },
        { unit: C.machine, from: 15 },
      ],
    },
  },
  {
    title: "The Rock Garden",
    enemy: "Gardener Grizelda",
    art: "creep-yeti",
    scene: [
      ["Grizelda", "I love rocks. You get rocks. I get rocks. Everybody gets rocks!"],
      ["Pip", "Ten rocks each. Every life you steal cracks one of ours, every life she steals cracks one of hers."],
      ["Grizelda", "My garden boars dig them up again. Good boars!"],
    ],
    briefing: "Both fields hold 10 rocks (35 gold to clear). Stealing lives cracks your own rocks. Neutral auxiliaries fight on Grizelda's side.",
    setup: {
      level: "hard",
      rocksOnSteal: true,
      rockCost: 35,
      player: { rocks: "0,1 2,1 4,1 1,3 3,3 5,3 0,5 2,5 4,5 3,7" },
      enemies: [{ name: "Gardener Grizelda", art: "creep-yeti", level: "normal", rocks: "1,1 3,1 5,1 0,3 2,3 4,3 1,5 3,5 5,5 2,7" }],
      aux: [{ unit: C.boar, from: 8 }],
    },
  },
  {
    title: "Brunhilde Blitzkrieg",
    enemy: "Brunhilde",
    art: "creep-orc-warlord",
    scene: [
      ["Brunhilde", "Defence is for cowards! ATTACK! ATTACK! ATTACK!"],
      ["Pip", "She's very loud."],
      ["Brunhilde", "LOUD IS A STRATEGY!"],
    ],
    briefing: "Win the duel. Neutral auxiliaries fight on Brunhilde's side.",
    setup: {
      level: "hard",
      player: {},
      enemies: [{ name: "Brunhilde", art: "creep-orc-warlord", level: "hard", persona: { caution: 0.55, saveMore: 3, killShot: 15 } }],
      aux: [
        { unit: C.grunt, from: 4 },
        { unit: C.centaur, tier: 2 },
      ],
    },
  },
  {
    title: "Pit Lord Pete",
    enemy: "Pit Lord Pete",
    art: "creep-pit-lord",
    scene: [
      ["Pete", "Welcome to the pit! Demons, hounds and hellfire, all on my side."],
      ["Pip", "The king gave us 10 extra lives for this one. That's never a good sign."],
      ["Pete", "My little helpers are already on their way. They love company."],
    ],
    briefing: "Win the duel. You have 40 lives. Neutral auxiliaries fight on Pete's side.",
    setup: {
      level: "hard",
      player: { lives: 40 },
      enemies: [{ name: "Pit Lord Pete", art: "creep-pit-lord", level: "hard", income: 40, sends: DEMONS, sleep: 20 }],
      aux: [
        { unit: C.imp, from: 3 },
        { unit: C.hound, tier: 4 },
      ],
    },
  },
  {
    title: "The Accountant",
    enemy: "Ledger Lenny",
    art: "creep-gnoll",
    scene: [
      ["Lenny", "My spreadsheets predict your defeat in round 29. Compound interest is undefeated."],
      ["Pip", "Round 28 is the deadline. After that, his numbers win."],
      ["Lenny", "My interns handle the small accounts. Your lane is a small account."],
    ],
    briefing: "Win by round 28. Neutral auxiliaries fight on Lenny's side.",
    setup: {
      level: "hard",
      goal: { deadline: 28 },
      player: {},
      enemies: [{ name: "Ledger Lenny", art: "creep-gnoll", level: "hard", income: 30, persona: { greed: 2.4, caution: 0.8 } }],
      aux: [
        { unit: C.gnoll, from: 2 },
        { unit: C.centaur, from: 12 },
      ],
    },
  },
  {
    title: "No Mercy Nora",
    enemy: "Nora",
    art: "creep-demon-slayer",
    scene: [
      ["Nora", "Twelve lives. That's all you get. I don't do mercy."],
      ["Pip", "Twelve. Okay. Twelve is a number."],
      ["Nora", "It is about to become a smaller one."],
    ],
    briefing: "You have only 12 lives. Neutral waves are on.",
    setup: { level: "hard", waves: true, player: { lives: 12 }, enemies: [{ name: "Nora", art: "creep-demon-slayer", level: "hard", persona: { airThreshold: 0.05 } }] },
  },
  {
    title: "Twin Terror",
    enemy: "Pib & Pob, all grown up",
    art: "creep-dryad",
    scene: [
      ["Pob", "We've been training! Pib is now… slightly smarter!"],
      ["Pib", "Hard mode, baby!"],
      ["Pip", "They grow up so fast."],
    ],
    briefing: "Three-way battle against Pib and Pob.",
    setup: { seats: 3, level: "hard", player: {}, enemies: [{ name: "Pib", art: "creep-satyr", level: "hard" }, { name: "Pob", art: "creep-dryad", level: "normal" }] },
  },
  {
    title: "The Gauntlet",
    enemy: "The Council",
    art: "creep-shaman",
    scene: [
      ["Pip", "The Council of Three wants to see if you're worthy of the Line Lord."],
      ["Council", "Three lanes. Three judges. One survivor."],
      ["Pip", "No pressure, boss."],
    ],
    briefing: "Four-way battle against the Council of Three. Neutral waves are on.",
    setup: { seats: 4, level: "normal", waves: true, player: {}, enemies: [{ name: "Judge Ash", art: "creep-shaman", level: "normal" }, { name: "Judge Bramble", art: "creep-dryad", level: "normal" }, { name: "Judge Cinder", art: "creep-infernal", level: "hard" }] },
  },
  {
    title: "The Line Lord",
    enemy: "Stevito, the Line Lord",
    art: "creep-mountain-golem",
    scene: [
      ["Stevito", "So, Felito's champion finally arrives. I invented this lane, you know."],
      ["Pip", "Forty lives. And he never stops grinning."],
      ["Stevito", "Oh, and I left you a few rocks. Old habit."],
      ["Pip", "Every life we steal cracks a rock. Let's take this lane back. For Felito!"],
    ],
    briefing: "The final duel: Stevito has 40 lives. Six rocks in your field crack when you steal lives. Neutral waves are on.",
    setup: { level: "hard", waves: true, rocksOnSteal: true, rockCost: 50, player: { rocks: "1,2 4,2 2,4 3,4 1,6 4,6" }, enemies: [{ name: "Stevito", art: "creep-mountain-golem", level: "hard", lives: 40, income: 25, persona: { killShot: 12, saveMore: 2 } }] },
  },
];
MISSIONS.forEach((m, i) => {
  m.id = i + 1;
  m.setup.id = i + 1;
});
export const CAMPAIGN_PREF = "felito.campaign";
