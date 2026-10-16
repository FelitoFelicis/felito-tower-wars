/**
 * v0.17: single-player campaign. 30 missions, each with a short scene, an enemy with its own
 * traits (sends, towers, maze, temper) and a weakness to exploit, and special start settings.
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
const FLYERS = [C.sheep, C.machine, C.zeppelin, C.shade, C.batRider, C.voidWalker, C.frostWyrm, C.gryphon, C.blackDragon];
const UNDEAD = [C.skeleton, C.necro, C.skelGrunt, C.zombie, C.skelMage, C.ghoul, C.acolyte, C.abomination, C.frostWyrm];
const FAST = [C.wolf, C.raider, C.satyr, C.centaur, C.troll, C.felRaider, C.hound, C.dryad];
const DEMONS = [C.imp, C.grunt, C.felRaider, C.hound, C.voidWalker, C.warlock, C.demonHunter, C.pitLord, C.satyr, C.marauder];
const elements = (a, b) => [a, b, ...["water", "fire", "earth", "storm", "arcane", "plague"].filter((e) => e !== a && e !== b)];

export const MISSIONS = [
  {
    title: "The Goblin King",
    enemy: "Grumbo",
    art: "creep-goblin",
    scene: [
      ["Pip", "Your first duel, boss! Over there sits Grumbo, self-crowned King of the Goblins."],
      ["Grumbo", "Bow before Grumbo! Grumbo has a smiley maze. SMILEY. Fear it!"],
      ["Pip", "He only sends goblins and horses. Build a few archers, send creeps of your own, and watch his crown wobble."],
    ],
    briefing: "Win the duel. Grumbo sends only Goblins and Horses.",
    weakness: "His smiley maze is all teeth and no bite.",
    setup: { level: "veryEasy", waves: false, player: {}, enemies: [{ name: "Grumbo", art: "creep-goblin", level: "veryEasy", sends: [C.goblin, C.horse, C.imp, C.boar], maze: "smiley" }] },
  },
  {
    title: "Counting Sheep",
    enemy: "Shepherd Shaun",
    art: "creep-sheep-fly",
    scene: [
      ["Shaun", "Baaa-ware! My flock flies, little builder. Flies!"],
      ["Pip", "Flying sheep… only towers that shoot air can hit those. Archers do."],
      ["Pip", "And between us: Shaun never built a single tower that looks up."],
    ],
    briefing: "Shaun sends flying sheep. Keep anti-air ready.",
    weakness: "His towers can't hit flyers: send your own Flying Sheep.",
    setup: { level: "veryEasy", player: {}, enemies: [{ name: "Shepherd Shaun", art: "creep-sheep-fly", level: "easy", sends: [C.sheep, C.goblin, C.machine, C.imp], noAir: true, maze: "pillars" }] },
  },
  {
    title: "Bonehilda's Choir",
    enemy: "Bonehilda",
    art: "creep-necromancer",
    scene: [
      ["Bonehilda", "La-la-laaa! My skeletons sing in perfect harmony. Join the choir… permanently!"],
      ["Pip", "Undead are slow and stubborn. A long maze and steady damage break them."],
      ["Pip", "She's a terrible singer, though. And her heart-shaped maze has holes."],
    ],
    briefing: "Bonehilda sends only undead. She starts with 20 lives.",
    weakness: "Slow armies and a leaky heart maze. Hit her early.",
    setup: { level: "easy", player: {}, enemies: [{ name: "Bonehilda", art: "creep-necromancer", level: "easy", lives: 20, sends: UNDEAD, maze: "heart" }] },
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
    briefing: "Eight rocks block your field. Clear them for 40 gold each, or crack one with every life you steal.",
    weakness: "Mortimer is slow to build. Early creeps crack your rocks for free.",
    setup: { level: "easy", rocksOnSteal: true, rockCost: 40, player: { rocks: "1,1 4,1 2,3 3,3 0,5 5,5 2,7 3,7" }, enemies: [{ name: "Mason Mortimer", art: "creep-golem", level: "easy", sleep: 30 }] },
  },
  {
    title: "Professor Boom",
    enemy: "Professor Boom",
    art: "creep-alchemist",
    scene: [
      ["Boom", "KA-BOOM! Cannons, cannons, cannons! The only towers worth building!"],
      ["Pip", "Cannons smash crowds on the ground. They never look up."],
      ["Boom", "Up? Why would anything come from… up?"],
    ],
    briefing: "Boom builds only Bombards. His creeps come in big ground crowds.",
    weakness: "Bombards can't hit flyers. Sheep and Flying Machines walk right through.",
    setup: { level: "easy", player: {}, enemies: [{ name: "Professor Boom", art: "creep-alchemist", level: "normal", towers: [T.cannon], sends: [C.goblin, C.gnoll, C.grunt, C.raider, C.imp, C.skelGrunt, C.troll, C.zombie, C.marauder] }] },
  },
  {
    title: "Wolfgang's Pack",
    enemy: "Wolfgang",
    art: "creep-wolf",
    scene: [
      ["Wolfgang", "Awoooo! My pack runs faster than your arrows fly!"],
      ["Pip", "Wolves, Raiders, Centaurs… all speed, little armour. A long maze and splash damage tame them."],
      ["Pip", "Here, 150 gold from the farm folk. Spend it on a good maze."],
    ],
    briefing: "Wolfgang sends only fast creeps. You start with 150 extra gold.",
    weakness: "Fast but fragile: Bombards near the portal shred the pack.",
    setup: { level: "easy", player: { gold: 150 }, enemies: [{ name: "Wolfgang", art: "creep-wolf", level: "normal", sends: FAST }] },
  },
  {
    title: "Last Stand at Pip's Farm",
    enemy: "Captain Krag",
    art: "creep-orc",
    scene: [
      ["Pip", "Bad news, boss. Krag's raiders burned the fences. We're down to 6 lives!"],
      ["Krag", "Six lives! Hah! I'll be eating your pumpkins by round ten."],
      ["Pip", "We don't have to beat him. Hold out for 14 rounds and the king's army arrives."],
    ],
    briefing: "You have only 6 lives. Survive 14 rounds to win. Three archers already stand guard.",
    weakness: "Krag never saves for big pushes. Steady defence wins.",
    setup: { level: "normal", waves: false, goal: { survive: 14 }, player: { lives: 6, prebuild: [{ id: T.archer, cells: "2,2 3,4 2,6" }] }, enemies: [{ name: "Captain Krag", art: "creep-orc", level: "normal", persona: { saveMore: 0, push: 0 } }] },
  },
  {
    title: "The Pacifist",
    enemy: "Brother Tumbleweed",
    art: "creep-shaman",
    scene: [
      ["Tumbleweed", "Peace, friend. I shall never send a single creep against you."],
      ["Pip", "Suspicious. But true: he only builds. Thick walls, lots of lives."],
      ["Pip", "The monks will vote for him if you don't win by round 22. Throw everything at him!"],
    ],
    briefing: "Tumbleweed never attacks, but has 40 lives. Win before round 22.",
    weakness: "Zero offence: put every coin into sends.",
    setup: { level: "normal", goal: { deadline: 22 }, player: {}, enemies: [{ name: "Brother Tumbleweed", art: "creep-shaman", level: "normal", lives: 40, sends: [], gold: 200 }] },
  },
  {
    title: "Lady Tuskana",
    enemy: "Lady Tuskana",
    art: "creep-boar",
    scene: [
      ["Tuskana", "Charge, my darlings! Tusks forward!"],
      ["Pip", "Boars and Centaurs, sturdy and stubborn. And she loves her pillar garden."],
      ["Pip", "Pillars look pretty, but creeps slip right between them."],
    ],
    briefing: "Tuskana sends Boars, Centaurs and Trolls. Neutral waves are on.",
    weakness: "Her pillar maze is short: your creeps reach her quickly.",
    setup: { level: "normal", waves: true, player: {}, enemies: [{ name: "Lady Tuskana", art: "creep-boar", level: "normal", sends: [C.boar, C.centaur, C.troll, C.horse, C.gnoll, C.grunt, C.marauder, C.captain, C.cairne], maze: "pillars" }] },
  },
  {
    title: "Goldfinger",
    enemy: "Goldfinger",
    art: "creep-orc-warlord",
    scene: [
      ["Goldfinger", "Gold, gold, gold! I earn more than you and I keep it. Towers are so… expensive."],
      ["Pip", "He hoards for one giant wave. When it comes, it'll hurt."],
      ["Pip", "But a miser builds few towers. Hit him early and often."],
    ],
    briefing: "Goldfinger earns more than you and saves for huge waves. He never builds more than 12 towers.",
    weakness: "A tower limit of 12: early pressure breaks through.",
    setup: { level: "normal", player: {}, enemies: [{ name: "Goldfinger", art: "creep-orc-warlord", level: "normal", income: 10, maxTowers: 12, persona: { saveMore: 3, greed: 0.6 } }] },
  },
  {
    title: "The Troll Bridge",
    enemy: "Toll-Troll Gunther",
    art: "creep-troll",
    scene: [
      ["Gunther", "Nobody crosses my bridge without paying the toll! And your lane is full of rubble. Toll included."],
      ["Pip", "Six rocks again. 30 gold each to clear, or crack them by stealing lives."],
      ["Pip", "His trolls are tough and fast. Don't let them stroll through."],
    ],
    briefing: "Gunther sends Imps and Trolls. Six rocks block your field (30 gold each, or crack them by stealing lives).",
    weakness: "Gunther spends everything on trolls and forgets anti-air.",
    setup: { level: "normal", rocksOnSteal: true, rockCost: 30, player: { rocks: "0,2 5,2 2,4 3,4 1,6 4,6" }, enemies: [{ name: "Toll-Troll Gunther", art: "creep-troll", level: "normal", sends: [C.goblin, C.wolf, C.raider, C.imp, C.troll, C.marauder, C.felRaider, C.hound], noAir: true }] },
  },
  {
    title: "Baron von Zeppelin",
    enemy: "Baron von Zeppelin",
    art: "creep-zeppelin",
    scene: [
      ["Baron", "Mein fleet rules the skies! Sheep, machines, zeppelins: all airborne, all glorious!"],
      ["Pip", "Everything he sends flies. We need anti-air everywhere."],
      ["Pip", "And his towers? Footmen. Swords. They can't touch anything above their helmets."],
    ],
    briefing: "The Baron sends only flyers. His towers are all Footmen.",
    weakness: "Footmen can't hit flyers. Answer air with air.",
    setup: { level: "normal", player: {}, enemies: [{ name: "Baron von Zeppelin", art: "creep-zeppelin", level: "normal", sends: FLYERS, towers: [T.footman] }] },
  },
  {
    title: "Archie Two-Shoes",
    enemy: "Archie Two-Shoes",
    art: "creep-darkknight",
    scene: [
      ["Archie", "One arrow, one kill. That's my motto. I only trust bows."],
      ["Pip", "Archer towers hit one target at a time. No splash."],
      ["Pip", "So… what happens if a hundred tiny creeps show up at once?"],
    ],
    briefing: "Archie builds only archer towers.",
    weakness: "No splash damage: swarms of cheap creeps overwhelm him.",
    setup: { level: "normal", player: {}, enemies: [{ name: "Archie Two-Shoes", art: "creep-darkknight", level: "normal", towers: [T.archer] }] },
  },
  {
    title: "Double Trouble",
    enemy: "The Twins",
    art: "creep-satyr",
    scene: [
      ["Pib", "We are Pib and Pob! Two lanes, one brain!"],
      ["Pob", "Mostly Pib's brain."],
      ["Pip", "Two enemies, but each has only 15 lives. Knock one out quickly and the other one is alone."],
    ],
    briefing: "Three-way battle against Pib and Pob. Each twin has 15 lives.",
    weakness: "Low lives: one good push knocks a twin out.",
    setup: { seats: 3, level: "normal", player: {}, enemies: [{ name: "Pib", art: "creep-satyr", level: "easy", lives: 15 }, { name: "Pob", art: "creep-dryad", level: "normal", lives: 15 }] },
  },
  {
    title: "The Minimalist",
    enemy: "Master Mo",
    art: "creep-spider",
    scene: [
      ["Mo", "Less is more. You may build only ten towers today. I insist."],
      ["Pip", "Ten towers?! Then every one of them has to count. Upgrade, don't spread."],
      ["Mo", "And I send many, many small things. Less is more, more is… also fine."],
    ],
    briefing: "You may build at most 10 towers. Mo sends swarms of cheap creeps.",
    weakness: "Mo's creeps are cheap and weak: well-upgraded splash towers eat them.",
    setup: { level: "normal", player: { maxTowers: 10, gold: 100 }, enemies: [{ name: "Master Mo", art: "creep-spider", level: "normal", sends: [C.goblin, C.horse, C.gnoll, C.imp, C.boar, C.zombie, C.acolyte, C.scarab] }] },
  },
  {
    title: "Count Batula",
    enemy: "Count Batula",
    art: "creep-bat-rider",
    scene: [
      ["Pip", "Shhh. The Count sleeps until sunset… about 45 seconds from now."],
      ["Batula", "Zzz… bats… zzz… blood… zzz…"],
      ["Pip", "When he wakes, the sky fills with bats. Hurt him while he snores!"],
    ],
    briefing: "Batula sleeps for the first 45 seconds, then sends only flyers. A few bat guards watch his lane.",
    weakness: "A slow start: rush him while he sleeps.",
    setup: { level: "normal", player: {}, enemies: [{ name: "Count Batula", art: "creep-bat-rider", level: "normal", sleep: 45, sends: FLYERS, prebuild: [{ id: T.archer, cells: "1,3 4,3 2,6" }] }] },
  },
  {
    title: "Glass Cannon Gary",
    enemy: "Gary",
    art: "creep-raider",
    scene: [
      ["Gary", "I've got the biggest income in the valley. I am unstoppable!"],
      ["Pip", "He also has 8 lives and builds like a toddler."],
      ["Gary", "…Who told you that?"],
    ],
    briefing: "Gary has a big income and a reckless push. But only 8 lives.",
    weakness: "Eight lives and a thin defence: one breakthrough is enough.",
    setup: { level: "normal", player: {}, enemies: [{ name: "Gary", art: "creep-raider", level: "normal", lives: 8, income: 15, persona: { caution: 0.6, saveMore: 2 } }] },
  },
  {
    title: "The Marathon",
    enemy: "Marathon Maxi",
    art: "creep-centaur",
    scene: [
      ["Maxi", "Endurance, my friend! Thirty rounds of non-stop creeps!"],
      ["Pip", "We don't need to beat Maxi. Just still be standing after round 30."],
      ["Pip", "Neutral waves join the race too. Pace yourself."],
    ],
    briefing: "Survive 30 rounds. Neutral waves are on.",
    weakness: "Maxi spends evenly and never saves: a strong economy outlasts him.",
    setup: { level: "normal", waves: true, goal: { survive: 30 }, player: {}, enemies: [{ name: "Marathon Maxi", art: "creep-centaur", level: "normal", persona: { saveMore: 0 } }] },
  },
  {
    title: "The Undead Choir",
    enemy: "Bonehilda & Mortis",
    art: "creep-ghoul",
    scene: [
      ["Bonehilda", "I'm back! And I brought my duet partner!"],
      ["Mortis", "*rattling noises*"],
      ["Pip", "Two lanes full of undead. Take out Bonehilda first, she never learned to defend."],
    ],
    briefing: "Three-way battle against two undead armies.",
    weakness: "Bonehilda's defence is still a joke.",
    setup: { seats: 3, level: "normal", player: {}, enemies: [{ name: "Bonehilda", art: "creep-necromancer", level: "easy", sends: UNDEAD, maze: "heart" }, { name: "Mortis", art: "creep-ghoul", level: "normal", sends: UNDEAD }] },
  },
  {
    title: "Seasick",
    enemy: "Siren Seraphina",
    art: "creep-siren",
    scene: [
      ["Seraphina", "My song makes your walkers seasick. Only your flyers can reach me now."],
      ["Pip", "She's right, our ground creeps won't march. Only flyers this time!"],
      ["Pip", "Good thing her towers are all swords and cannons."],
    ],
    briefing: "You can only send flyers (and bosses). Seraphina builds Footmen and Bombards.",
    weakness: "No anti-air at all: your flyers rule the sea.",
    setup: { level: "normal", player: { sends: FLYERS }, enemies: [{ name: "Siren Seraphina", art: "creep-siren", level: "normal", towers: [T.footman, T.cannon] }] },
  },
  {
    title: "Fortress Fritz",
    enemy: "Fortress Fritz",
    art: "creep-minotaur",
    scene: [
      ["Fritz", "My fortress was finished before you even woke up. Forty lives. Twelve towers. Good luck."],
      ["Pip", "The king sent us 500 gold for this siege. And a deadline: round 35."],
      ["Pip", "Fritz barely attacks. He believes walls win wars."],
    ],
    briefing: "Fritz starts with a full maze and 40 lives. You get 500 gold. Win by round 35.",
    weakness: "He hardly sends. Outscale him with income, then flood him.",
    setup: { level: "hard", goal: { deadline: 35 }, player: { gold: 500 }, enemies: [{ name: "Fortress Fritz", art: "creep-minotaur", level: "hard", lives: 40, persona: { greed: 0.5, saveMore: 0 }, prebuild: [{ id: T.archer, cells: "4,0 5,0 3,0 2,1 1,2 0,8 1,8 2,8 3,7 4,6 1,3 1,4" }] }] },
  },
  {
    title: "Zara Stormcaller",
    enemy: "Zara Stormcaller",
    art: "creep-warlock",
    scene: [
      ["Zara", "Storm and arcane, lightning and starlight. My towers sparkle!"],
      ["Pip", "She only builds archers and mages. Fancy, but single-target."],
      ["Pip", "Swarm her. Cheap, many, all at once."],
    ],
    briefing: "Zara always picks Storm and Arcane, and builds only archer and magic towers.",
    weakness: "No splash: big swarms get through.",
    setup: { level: "hard", player: {}, enemies: [{ name: "Zara Stormcaller", art: "creep-warlock", level: "hard", towers: [T.archer, T.magic], persona: { elementOrder: elements("storm", "arcane"), smartElements: 0 } }] },
  },
  {
    title: "The Rock Garden",
    enemy: "Gardener Grizelda",
    art: "creep-yeti",
    scene: [
      ["Grizelda", "I love rocks. You get rocks. I get rocks. Everybody gets rocks!"],
      ["Pip", "Ten rocks each. Every life you steal cracks one of ours, every life she steals cracks one of hers."],
      ["Pip", "Whoever hits first gets a free maze. Let's hit first."],
    ],
    briefing: "Both fields hold 10 rocks (35 gold to clear). Stealing lives cracks your own rocks.",
    weakness: "Grizelda's rocks clog her maze early. Strike before she clears them.",
    setup: { level: "hard", rocksOnSteal: true, rockCost: 35, player: { rocks: "0,1 2,1 4,1 1,3 3,3 5,3 0,5 2,5 4,5 3,7" }, enemies: [{ name: "Gardener Grizelda", art: "creep-yeti", level: "normal", rocks: "1,1 3,1 5,1 0,3 2,3 4,3 1,5 3,5 5,5 2,7" }] },
  },
  {
    title: "Brunhilde Blitzkrieg",
    enemy: "Brunhilde",
    art: "creep-orc-warlord",
    scene: [
      ["Brunhilde", "Defence is for cowards! ATTACK! ATTACK! ATTACK!"],
      ["Pip", "She saves for huge waves and goes for the kill when we're low."],
      ["Pip", "But she builds almost nothing. One counter-punch could end it."],
    ],
    briefing: "Brunhilde saves for crushing waves and goes for the kill.",
    weakness: "A paper-thin defence.",
    setup: { level: "hard", player: {}, enemies: [{ name: "Brunhilde", art: "creep-orc-warlord", level: "hard", persona: { caution: 0.55, saveMore: 3, killShot: 15 } }] },
  },
  {
    title: "Pit Lord Pete",
    enemy: "Pit Lord Pete",
    art: "creep-pit-lord",
    scene: [
      ["Pete", "Welcome to the pit! Demons, hounds and hellfire, all on my side."],
      ["Pip", "He starts with 40 extra income. That's… a lot."],
      ["Pip", "The king gave us 10 extra lives. And demons hate a long, long maze."],
    ],
    briefing: "Pete sends demons and starts with +40 income. You have 40 lives.",
    weakness: "Pete builds slowly while he counts his gold.",
    setup: { level: "hard", player: { lives: 40 }, enemies: [{ name: "Pit Lord Pete", art: "creep-pit-lord", level: "hard", income: 40, sends: DEMONS, sleep: 20 }] },
  },
  {
    title: "The Accountant",
    enemy: "Ledger Lenny",
    art: "creep-gnoll",
    scene: [
      ["Lenny", "My spreadsheets predict your defeat in round 29. Compound interest is undefeated."],
      ["Pip", "He starts with +30 income and invests every coin. If this goes long, he wins."],
      ["Pip", "Win by round 28. Go loud, go early."],
    ],
    briefing: "Lenny starts with +30 income. Win by round 28.",
    weakness: "He invests, not defends: early pushes hurt him.",
    setup: { level: "hard", goal: { deadline: 28 }, player: {}, enemies: [{ name: "Ledger Lenny", art: "creep-gnoll", level: "hard", income: 30, persona: { greed: 2.4, caution: 0.8 } }] },
  },
  {
    title: "No Mercy Nora",
    enemy: "Nora",
    art: "creep-demon-slayer",
    scene: [
      ["Nora", "Twelve lives. That's all you get. I don't do mercy."],
      ["Pip", "One mistake and we're done. Build careful, build strong."],
      ["Pip", "Neutral waves too. Don't forget the neutral waves."],
    ],
    briefing: "You have only 12 lives against a hard enemy. Neutral waves are on.",
    weakness: "Nora rarely builds anti-air. Flyers sneak through.",
    setup: { level: "hard", waves: true, player: { lives: 12 }, enemies: [{ name: "Nora", art: "creep-demon-slayer", level: "hard", persona: { airThreshold: 0.05 } }] },
  },
  {
    title: "Twin Terror",
    enemy: "Pib & Pob, all grown up",
    art: "creep-dryad",
    scene: [
      ["Pob", "We've been training! Pib is now… slightly smarter!"],
      ["Pib", "Hard mode, baby!"],
      ["Pip", "Pob still plays normal. Knock him out first, then deal with Pib."],
    ],
    briefing: "Three-way battle: Pib (hard) and Pob (normal).",
    weakness: "Pob is the weak link.",
    setup: { seats: 3, level: "hard", player: {}, enemies: [{ name: "Pib", art: "creep-satyr", level: "hard" }, { name: "Pob", art: "creep-dryad", level: "normal" }] },
  },
  {
    title: "The Gauntlet",
    enemy: "The Council",
    art: "creep-shaman",
    scene: [
      ["Pip", "The Council of Three wants to see if you're worthy of the Line Lord."],
      ["Council", "Three lanes. Three judges. One survivor."],
      ["Pip", "Two of them are only normal. Survive the rotation, pick them off one by one."],
    ],
    briefing: "Four-way battle against the Council: two normal judges and one hard.",
    weakness: "The normal judges fall first; their lives become yours.",
    setup: { seats: 4, level: "normal", waves: true, player: {}, enemies: [{ name: "Judge Ash", art: "creep-shaman", level: "normal" }, { name: "Judge Bramble", art: "creep-dryad", level: "normal" }, { name: "Judge Cinder", art: "creep-infernal", level: "hard" }] },
  },
  {
    title: "The Line Lord",
    enemy: "Stevito, the Line Lord",
    art: "creep-mountain-golem",
    scene: [
      ["Stevito", "So, Felito's champion finally arrives. I invented this lane, you know."],
      ["Pip", "He has 40 lives and +25 income. And he goes for the kill."],
      ["Stevito", "Oh, and I left you a few rocks. Old habit."],
      ["Pip", "Every life we steal cracks a rock. Let's take this lane back. For Felito!"],
    ],
    briefing: "The final duel: Stevito has 40 lives and +25 income. Six rocks in your field crack when you steal lives. Neutral waves are on.",
    weakness: "Even legends get greedy: he saves for giant waves and leaves gaps in between.",
    setup: { level: "hard", waves: true, rocksOnSteal: true, rockCost: 50, player: { rocks: "1,2 4,2 2,4 3,4 1,6 4,6" }, enemies: [{ name: "Stevito", art: "creep-mountain-golem", level: "hard", lives: 40, income: 25, persona: { killShot: 12, saveMore: 2 } }] },
  },
];
MISSIONS.forEach((m, i) => {
  m.id = i + 1;
  m.setup.id = i + 1;
});
export const CAMPAIGN_PREF = "felito.campaign";
