// Hand-authored exploration maps for Expedition 69 (SPEC §3.6, §4.11): ASCII tile rows + legend (char → generic
// tile type from src/world/tilemap.js) + entities in tile coordinates. Every map is validated by validateWorld()
// (dev/world.html?validate=1): entities on walkable tiles, everything reachable, all referenced ids exist, and
// roaming patrols clear of the camps' no-aggro radius (tilemap.js SAFE_RADIUS; `safe: r` overrides, 0 = none).
// Entity types: player (start), flag {id,name} (an Expedition Pennant), enemy {id, encounter, patrol, tutorial?,
// later?}, boss {id, encounter, dialogue, postDialogue}, chest {id, loot, hidden?}, journal {id},
// npc {id, look, dialogue}, merchant {id, shopId, greet?}, trainer {id}, exit {id, to, toX, toY, w, h,
// requires?:{boss}, label}, prop {kind, …}. Pure data.

/** @type {Record<string, {id:string, name:string, legend:Record<string,string>, tiles:string[], entities:object[]}>} */
export const MAPS = {
  shore: {
    id: 'shore',
    name: 'Brinegate Shore',
    legend: {
      'W': 'deep',
      '~': 'shallow',
      ',': 'wet',
      '.': 'ground',
      '"': 'grass',
      ':': 'path',
      '=': 'planks',
      '#': 'cliff',
      '^': 'rock',
      'T': 'tree',
      'b': 'bush',
      '*': 'flowers',
      'R': 'ruin',
      's': 'stone',
    },
    tiles: [
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW######', //  0
      'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW######', //  1
      'WWWWWWWWW,,,WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.,,WWW#####', //  2
      'WWWWWWWW,####WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW,...#####W#####', //  3
      'WWWWWWWW,#####WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW~W,^^^..#####,~####', //  4
      'WWWWWWWW,####,W~~WWWWWWWWWWWWWWWWWWWWWWWWWW~W~,..^....###..,####', //  5
      'WW~~~~~~,,,,,~~~~~~WWW~~WWW~~~~W~~WWWWWWW~~~~,,,..........,,####', //  6
      'WW~~~~~~~,..,~~,,~~~~~~~~~WW~~^W~~~~,~~~~~~,~,,,,...:....,,,####', //  7
      'WW~~,,,,,..,,,,,,,,~~~,~~~WW~~~~~~,,,,,~~~,,,.......:.......####', //  8
      'WW~,,,,,,..,,,....,,,,,~~~^,^,,~~~~,,,~W^~,.,.......:.......####', //  9
      'W~~,....,.,.........,..~~~,,,,,,~~~~~~WWW~.....TWWWW.:.....#####', // 10
      'W~~,....,.,.............~~~,,,,,~WW~~~^W...""..WWWWW~:.....#####', // 11
      'W~,,....,.,.......T..."..~~~~~~~~^~~~,...""b""*WWWWW~:....^#####', // 12
      'W~~,....,,,.....T...""""::.....~~..........."..~WWW~~~.....#####', // 13
      'W~~,..............."""":""...^................,~~~~~~:,.....####', // 14
      'W~~,..............."""::*....................^,~~~~~,:,.....####', // 15
      'W~~,..................:...T..................::=======....######', // 16
      'WW~,..................................^.........,,,,,...........', // 17
      'W~~,.....::::......................................,,.......::::', // 18
      'WW~,........:::.............................::.....^...:::..::::', // 19
      'WW~,,..........:::.........T..............T.::::::::...:::..::::', // 20
      'WW~,..............:::.......T......:::::::::................::::', // 21
      'WW~,.T......^.........:::::T::::::::.....T..................::::', // 22
      'W~~,.............:..........:..............T.........^..........', // 23
      'W~~,T...........:..............RR.RsRRRR...........b.......#####', // 24
      'W~~,..........::................ssssss.R.........*"".......#####', // 25
      'WW~,..T......:T................RssR.ssss..........""""*"".######', // 26
      'W~~,.........:.T................sssssssR.........."""b*"...#####', // 27
      'W~~,....^*".:T""...............ssssssRsR..........""""....^#####', // 28
      'WW~,....."::"""""""".....^.....RsssssssR.".."""""..."......#####', // 29
      'WW~.....::"""""""*"*"......."."RRRsssR.R*"*"""""""b""..T...#####', // 30
      'WW~......."""."*"*"*""""*"""""""..."""""*"""*"b"""""".......####', // 31
      'WW.,..,.."b""*"""T"""""""""""""""..b""b"""""""""*"*"*.......####', // 32
      '###,,,,,###T.##""##.""T.TT""""T###......#.."#"..T.......T..#####', // 33
      '###,,,,##############TT.#T##.####################....##...######', // 34
      '###################..#..T#######################################', // 35
      '#################......#########################################', // 36
      '#################..,,..#########################################', // 37
      '##################,,,,##########################################', // 38
      '################################################################', // 39
    ],
    entities: [
      // ── the landing: the party rows ashore on the west beach
      { type: 'player', x: 8, y: 18 },
      { type: 'prop', kind: 'rowboat', x: 5, y: 17, solid: [[-1,0,2,1]] },
      { type: 'enemy', id: 'shore_e1', encounter: 'tutorial_driftling', tutorial: true, later: 'shore_driftling_pair', x: 15, y: 15, patrol: {r: 1.5} },
      // ── Driftwood Camp: first pennant, the Driftmarket stall, Hesper and her mannequin, the Lamplighter
      { type: 'flag', id: 'shore_camp_flag', name: 'Driftwood Camp', x: 20, y: 19 },
      { type: 'prop', kind: 'tent', x: 22, y: 17, dx: 20, solid: [[0,0,2,1]] },
      { type: 'prop', kind: 'campfire', x: 23, y: 19, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'stall', x: 26, y: 17, solid: [[-1,0,3,1]] },
      { type: 'merchant', id: 'shore_merchant', shopId: 'shore_camp', look: 'quist', greet: 'merchant_greet', x: 26, y: 18 },
      { type: 'prop', kind: 'crates', x: 18, y: 17, solid: [[0,0,1,1]] },
      { type: 'trainer', id: 'trainer', x: 20, y: 24 },
      { type: 'prop', kind: 'lantern', x: 15, y: 22, solid: [[0,0,1,1]] },
      { type: 'npc', id: 'lamplighter', look: 'lamplighter', dialogue: 'npc_lamplighter', x: 16, y: 23 },
      { type: 'prop', kind: 'signpost', x: 24, y: 23, solid: [[0,0,1,1]] },
      // ── the tide flats under the frozen wave
      { type: 'npc', id: 'frozen_gull', look: 'gull', dialogue: 'npc_frozen_gull', verb: 'Look', safe: 0, x: 23, y: 12 },
      { type: 'journal', id: 'j1', x: 28, y: 10 },
      { type: 'chest', id: 'shore_chest_flats', loot: {glint: 60}, x: 36, y: 8 },
      { type: 'enemy', id: 'shore_e2', encounter: 'shore_driftling_pair', x: 31, y: 12, patrol: {r: 2.5} },
      { type: 'enemy', id: 'shore_e3', encounter: 'shore_driftling_pair', x: 40, y: 8, patrol: {r: 2} },
      { type: 'prop', kind: 'frozen_wave', x: 31, y: 3 },
      // ── NW islet and the first broken lighthouse
      { type: 'prop', kind: 'lighthouse', x: 11, y: 5, dx: -20, solid: [] },
      { type: 'chest', id: 'shore_chest_lighthouse', loot: {relic: 'aegis_thread'}, x: 12, y: 6 },
      // ── central dunes and the southern belt
      { type: 'enemy', id: 'shore_e4', encounter: 'shore_shellguard', x: 33, y: 16, patrol: {r: 2.2} },
      { type: 'enemy', id: 'shore_e5', encounter: 'shore_shell_and_drift', x: 10, y: 29, patrol: {r: 2} },
      { type: 'enemy', id: 'shore_e6', encounter: 'shore_tidecaller', x: 27, y: 31, patrol: {r: 2.5} },
      // ── the far south-west, "the wrong end of the beach" (j3)
      { type: 'prop', kind: 'rowboat', variant: 1, x: 5, y: 32, solid: [[-1,0,2,1]] },
      { type: 'journal', id: 'j3', x: 7, y: 31 },
      { type: 'chest', id: 'shore_chest_dunes', loot: {glint: 35}, x: 13, y: 31 },
      // ── secret cove behind the south cliffs, reached under the pines
      { type: 'chest', id: 'shore_chest_cove', loot: {shard: 'tonic_shard'}, hidden: true, x: 19, y: 37 },
      // ── the old harbour customs house
      { type: 'flag', id: 'shore_ruins_flag', name: 'Customs House Ruins', x: 35, y: 27 },
      { type: 'chest', id: 'shore_chest_ruins', loot: {shard: 'tincture_shard'}, x: 38, y: 29 },
      { type: 'enemy', id: 'shore_e7', encounter: 'shore_tide_and_shell', x: 42, y: 25, patrol: {r: 2.5} },
      { type: 'enemy', id: 'shore_e8', encounter: 'shore_driftling_school', x: 44, y: 30, patrol: {r: 2.5} },
      // ── NE headland and the second lighthouse
      { type: 'prop', kind: 'lighthouse', variant: 1, x: 55, y: 5, solid: [] },
      { type: 'chest', id: 'shore_chest_headland', loot: {glint: 90}, x: 52, y: 6 },
      { type: 'enemy', id: 'shore_e9', encounter: 'shore_shellguard', x: 50, y: 8, patrol: {r: 2} },
      { type: 'enemy', id: 'shore_e10', encounter: 'shore_driftling_school', x: 46, y: 12, patrol: {r: 2} },
      // ── the wreck line
      { type: 'prop', kind: 'wreck', w: 4, x: 47, y: 27, solid: [[-2,0,4,1]] },
      { type: 'chest', id: 'shore_chest_wreck', loot: {glint: 45}, x: 47, y: 25 },
      { type: 'prop', kind: 'wreck', w: 3, flip: true, x: 54, y: 25, solid: [[-1,0,3,1]] },
      { type: 'prop', kind: 'wreck', w: 3, x: 50, y: 12, dy: 10 },
      { type: 'prop', kind: 'anchor', x: 44, y: 22, solid: [[0,0,1,1]] },
      { type: 'journal', id: 'j2', x: 52, y: 22 },
      { type: 'flag', id: 'shore_wreck_flag', name: 'Wreck Line Beacon', x: 50, y: 18 },
      { type: 'enemy', id: 'shore_e11', encounter: 'shore_wreckline', x: 51, y: 28, patrol: {r: 2} },
      { type: 'enemy', id: 'shore_e12', encounter: 'shore_wreckline', x: 55, y: 14, patrol: {r: 1.8} },
      // ── the Wreck Warden guards the pass east; the exit to the Thicket
      { type: 'boss', id: 'wreck_warden', encounter: 'boss_wreck_warden', dialogue: 'warden_pre', postDialogue: 'warden_post', x: 59, y: 20, trigger: 3.6 },
      { type: 'exit', id: 'shore_to_thicket', to: 'thicket', toX: 2, toY: 20, x: 63, y: 18, w: 1, h: 5, edge: 'east', facing: 'right', requires: {boss: 'wreck_warden'}, label: 'The Gilded Thicket' },
    ],
  },
  thicket: {
    id: 'thicket',
    name: 'The Gilded Thicket',
    legend: {
      'T': 'tree',
      'b': 'bush',
      '.': 'ground',
      '"': 'grass',
      ':': 'path',
      '*': 'flowers',
      'W': 'deep',
      ',': 'wet',
      '#': 'cliff',
      '^': 'rock',
      'R': 'ruin',
      's': 'stone',
      '=': 'bridge',
    },
    tiles: [
      'TTTTTTTTTTTTTTTTTTT,WW,TTTTTTTTTTTTTTTTTTTTT#######.:::########T', //  0
      'TTTTTTTTTTbTTTTTTTTT,WWTTTTTTTTTTTTTTTTTTTTTTTT.TTb.::T..TTTTTTT', //  1
      'TTTTTTTT.....TTTTTTT,WW,TTbTTTTTTTTTTTTTTTTTTTT.....::....bTTTTT', //  2
      'TTTTbT........bTTTTTT,W,T...TTTTTTTTTTTTTTTTTTT.....::...bTTTTTT', //  3
      'TTTb..........TTTTTTT,WW,.......TTTTTTTTTTTTTTb.....::.....bTTTT', //  4
      'TTTT...RR..RRRRR..bTT,WW,."""".bTTTTTTTTTTTTTT......::......bTTT', //  5
      'TTTT...R.ssssssR..TTT,WW,..:""".TTTTTTTTTTTTTT......:.......TTTT', //  6
      'TTTT...Rsss.RssR.....:WW,:::*""".bTTTTTTTTTTTT......:......TTTTT', //  7
      'TTTT...Rsss.ssss::...:==:.""""...TTTTTTTTTTTTTT.....:.......TTTT', //  8
      'TTTTb..RsssssssR.TTTT,WW,."....TTTTTTTTTTTTTT###^...:....##TTTTT', //  9
      'TTTTT..Rss..sssR.bTTT,WW,TTTTTTTTTTTTTTTTTTTT####..:..b.###TTTTT', // 10
      'TTTTT..RRRRssRRRTTTTT,WW,TTTTTTTTTTTTTTTTTTTTT##T.::.TT###TTTTTT', // 11
      'TTTTTTTT....:T..TTTTT,W,TTTTTTTTTTTTTTTTTTTTT####.:.TTT####TTTTT', // 12
      'TTTTTTTTTT..:TTTTTTT,WW,TTTTTbTTTTTTTTTTTTTTT####.:.TTT##T#TTTTT', // 13
      'TTTTTTTTTTT.:.TTTTTT,WW,TT.T....bTTTTTTTTTTTT####.:.TTTT##TTTTTT', // 14
      'TTTbTTTTTTT.::TTTTTT,WW,T...^.....TTTTTTTTTTT####.:.TTTTT##TTTTT', // 15
      'TTb.....TTTT.:TTTTT,WW,T.TTTb...b....TTTTTTTT#T#..:..Tb####TTTTT', // 16
      'T........TTT.:.b.TT,WW,b....""........bTTTTTT##...:....####TTTTT', // 17
      '..."..**.T...:...bT,WWTTb..""""""*"....bTTTTTT...."""..bTTT...TT', // 18
      ':::::::::::::::::.,WW,......:::...........:::::::"""""..bTT...TT', // 19
      '::::::::.....T..:::==::::::::::::::::::::::::::::""""...TTTT.TTT', // 20
      ':*""""""".TTTTTb.:,WW,....."""......::.....TTT.."""""".......TTT', // 21
      '.*""""""bTTTTTTT.:,WW,TT..*"""""""".:.TTTTTTTTb.."""....TTTTTTTT', // 22
      'TT.."""..TTTTTb.::,WW,TTT..""*""""..:.TTTTTTTTTT.......TTTTTTTTT', // 23
      'TTTTTTTTTTTTTTT.:.,WW,TTTT..""...TT.:.TTTTTTTTTTT..TTTTTTTTTTTTT', // 24
      'TTTTTTTTTTTTTT..:T,WW,TTTT.T.TTTTTTT.:TTTTTTTTTTTTTTTTTTTTTTTTTT', // 25
      'TTTTTTTTTTTTTb.:.T,WW,TTTTTTTTTTTTT..:."T""TTTTTTTTTTTTTTTTTTTTT', // 26
      'TTTTTTTTTT..".::TTT,W,TTTTTTTTTTTT...::"""""TTTTTTTTTTTTTTTTTTTT', // 27
      'TTTTTTTTT."".::*"T.,WW,TTTTTTTTTT.."".."""""*...TTTTTTTTTTTTTTTT', // 28
      'TTTTTTT..""".:.""".,WW,TTTTTTTT...b"""""",,,,."..TTTTTTTTTTTTTTT', // 29
      'TTTTTTT..""".."""".,WW,TTTTTTT......""",WW,,,,...bTTTTTTTTTTTTTT', // 30
      'TTTTTTT.b""""""""".T,W,TTTTTTTT......,WWWWWWWW,,.TTTTTTTTTTTTTTT', // 31
      'TTTTTTT.."""""""".TT,WW,TTTTTTTb.....WWWWWWWWW,,.TTTTTTTTTTTTTTT', // 32
      'TTTTTTT...""""....TT,WW,TTTTTTT.....,,,,,,==""W,.TTTTTTTTTTTTTTT', // 33
      'TTTTTTTT....."....bTT,WWTTTTTTTT...b.,WWWWWW",,.TTTTTTTTTTTTTTTT', // 34
      'TTTTTTTTTTTT.....TTTT,WW,TTTTTTTT....,,,WWWW,,T.TTTTTTTTTTTTTTTT', // 35
      'TTTTTTTTTTTTTTTTTTTTT,WW,TTTTTTTTTTT.b.,,,TTTTTTTTTTTTTTTTTTTTTT', // 36
      'TTTTTTTTTTTTTTTTTTTTT,WW,TTTTTTTTTTTTTT...TTTTTTTTTTTTTTTTTTTTTT', // 37
      'TTTTTTTTTTTTTTTTTTTTT,WW,TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 38
      'TTTTTTTTTTTTTTTTTTTTT,WW,TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT', // 39
    ],
    entities: [
      // ── forest edge: arrival from the shore
      { type: 'player', x: 3, y: 20 },
      { type: 'exit', id: 'thicket_to_shore', to: 'shore', toX: 61, toY: 20, x: 0, y: 19, w: 1, h: 3, edge: 'west', facing: 'left', label: 'Brinegate Shore' },
      { type: 'flag', id: 'thicket_edge_flag', name: 'Forest Edge', x: 6, y: 18 },
      { type: 'prop', kind: 'signpost', x: 9, y: 18, solid: [[0,0,1,1]] },
      // ── the chapel ruins (secret nook behind the broken north wall)
      { type: 'prop', kind: 'statue', x: 11, y: 9, dx: 20, solid: [[0,0,2,1]] },
      { type: 'journal', id: 'j4', x: 9, y: 9 },
      { type: 'chest', id: 'thicket_chest_chapel', loot: {relic: 'thorn_wreath'}, hidden: true, x: 10, y: 3 },
      { type: 'prop', kind: 'arch', x: 18, y: 8, dy: 0 },
      // ── north glade by the stream
      { type: 'chest', id: 'thicket_chest_glade', loot: {glint: 120}, x: 29, y: 6 },
      { type: 'prop', kind: 'log', x: 27, y: 9, solid: [[0,0,2,1]] },
      // ── the Gilded Caravan glade
      { type: 'prop', kind: 'wagon', x: 31, y: 17, solid: [[-1,0,4,1]] },
      { type: 'merchant', id: 'thicket_merchant', shopId: 'thicket_camp', look: 'orrery', greet: false, x: 29, y: 18 },
      { type: 'npc', id: 'quist', look: 'quist', dialogue: 'npc_quist_rumours', x: 34, y: 19 },
      { type: 'flag', id: 'thicket_caravan_flag', name: 'The Gilded Caravan', x: 31, y: 22 },
      { type: 'prop', kind: 'campfire', x: 33, y: 21, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'crates', x: 35, y: 17, solid: [[0,0,1,1]] },
      // ── mushroom dell and the pond hollow
      { type: 'npc', id: 'cartographer', look: 'cartographer', dialogue: 'npc_cartographer', x: 12, y: 30 },
      { type: 'chest', id: 'thicket_chest_dell', loot: {glint: 150}, x: 16, y: 33 },
      { type: 'journal', id: 'j5', x: 37, y: 29 },
      { type: 'chest', id: 'thicket_chest_island', loot: {shard: 'draught_shard'}, x: 45, y: 33 },
      { type: 'prop', kind: 'log', x: 34, y: 33, solid: [[0,0,2,1]] },
      // ── the mossy gorge and the Bronze Hollow (the Bellwether)
      { type: 'chest', id: 'thicket_chest_gorge', loot: {shard: 'tonic_shard'}, x: 49, y: 12 },
      { type: 'flag', id: 'thicket_hollow_flag', name: 'Bronze Hollow', x: 49, y: 17 },
      { type: 'journal', id: 'j6', x: 49, y: 14 },
      { type: 'prop', kind: 'bellframe', x: 49, y: 5, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'bellframe', x: 58, y: 5, solid: [[0,0,1,1]] },
      { type: 'boss', id: 'bellwether', encounter: 'boss_bellwether', dialogue: 'bellwether_pre', postDialogue: 'bellwether_post', x: 53, y: 4, trigger: 3.8 },
      { type: 'exit', id: 'thicket_to_spire', to: 'spire', toX: 27, toY: 41, x: 52, y: 0, w: 3, h: 1, edge: 'north', facing: 'up', requires: {boss: 'bellwether'}, label: 'The Meridian Spire' },
      // ── hidden grove east of the glade, through a gap in the trees
      { type: 'chest', id: 'thicket_chest_grove', loot: {relic: 'shatterglass'}, hidden: true, x: 61, y: 19 },
      { type: 'chest', id: 'thicket_chest_east', loot: {glint: 200}, x: 53, y: 23 },
      // ── roaming Gloam: weaker west, stronger north-east
      { type: 'enemy', id: 'thicket_e1', encounter: 'thicket_thornstag', x: 16, y: 17, patrol: {r: 1.8} },
      { type: 'enemy', id: 'thicket_e2', encounter: 'thicket_mime', x: 12, y: 14, patrol: {r: 1.6} },
      { type: 'enemy', id: 'thicket_e3', encounter: 'thicket_thornstag', x: 11, y: 7, patrol: {r: 1.8} },
      { type: 'enemy', id: 'thicket_e4', encounter: 'thicket_stag_and_mime', x: 27, y: 8, patrol: {r: 1.8} },
      { type: 'enemy', id: 'thicket_e5', encounter: 'thicket_bloomwitch', x: 15, y: 34, patrol: {r: 1.6} },
      { type: 'enemy', id: 'thicket_e6', encounter: 'thicket_mime', x: 24, y: 22, patrol: {r: 1.6} },
      { type: 'enemy', id: 'thicket_e7', encounter: 'thicket_masquerade', x: 41, y: 21, patrol: {r: 2} },
      { type: 'enemy', id: 'thicket_e8', encounter: 'thicket_rose_court', x: 42, y: 29, patrol: {r: 2.4} },
      { type: 'enemy', id: 'thicket_e9', encounter: 'thicket_bloomwitch', x: 37, y: 35, patrol: {r: 2} },
      { type: 'enemy', id: 'thicket_e10', encounter: 'thicket_gilded_hunt', x: 54, y: 22, patrol: {r: 2} },
      { type: 'enemy', id: 'thicket_e11', encounter: 'thicket_gilded_hunt', x: 51, y: 11, patrol: {r: 1.4} },
      { type: 'enemy', id: 'thicket_e12', encounter: 'thicket_stag_and_mime', x: 56, y: 9, patrol: {r: 1.8} },
    ],
  },
  spire: {
    id: 'spire',
    name: 'The Meridian Spire',
    legend: {
      'X': 'void',
      '.': 'ground',
      ':': 'stone',
      'G': 'gear',
      '=': 'bridge',
      's': 'stairs',
      '#': 'wall',
      'P': 'pillar',
      'M': 'machine',
      'p': 'path',
      '^': 'rock',
    },
    tiles: [
      'XXXXXXXXXXXXXXXXXXXXXXXXXXsssXXXXXXXXXXXXXXXXXXXXXXXXXXX', //  0
      'XXXXXXXXXXXXXXXXXXXX.......p.......XXXXXXXXXXXXXXXXXXXXX', //  1
      'XXXXXXXGGXXXXXXXXXX.:P:::::p:::::P:.XXXXXXXXXXXXXXXXXXXX', //  2
      'XXXXXXGGGGXXXXXXXX..:::::::p:::::::..XXXXXGGGGXXXXXXXXXX', //  3
      'XXXXXXGGGGXXXXXXXX..:::::^:p:::::::..XXXXXGGGGXXXXXXXXXX', //  4
      'XXXXXXXGGXXXXXXXXX..:::::::p:::::::..XXXXXGGGGXXXXXXXXXX', //  5
      'XXXXXXXXXXXXXXXXXXX.:::::::p:::::::.XXXXXXGGGGXXXXXXXXXX', //  6
      'XXXXXXXXXXXXXXXXXXXX.......p.......XXXXXXXXXXXXXXXXXXXXX', //  7
      'XXXXXXXXXXXXXXXXXXXXXXXXsssssssXXXXXXXXXXXXXXXXXXXXXXXXX', //  8
      'XXXXXX###################sssss####################XXXXXX', //  9
      'XXXXXXXX...................p....................XXXXXXXX', // 10
      'XXXXXXX.::::P:::::P::::::::^::::::::P:::::P:::::^XXXXXXX', // 11
      '....XX..::::::::::::.......p.......:::::^:::::::..X....X', // 12
      '.::.XX..::::::::::::....GGGGGGG....:::::::^:::::..=....X', // 13
      '....XX..::::::::::::....GGGGGGG....:::::::::::::..=....X', // 14
      '=XXXXX..::::::::::::....GGGGGGG....:::::::::::::..X....X', // 15
      '=XXXXX..::::::::::::....GGGGGGG....:::::::::::::..XXXXXX', // 16
      '=XXXXX..::::::::::::.......p.......:::::::::::::..XXXXXX', // 17
      '=XXXXX..::::P:::::P::::::::p::::::::P:::::P:::::..XXXXXX', // 18
      '=XXXXXX....................p.....................XXXXXXX', // 19
      '=XXXXXXX...................p.....^..............XXXXXXXX', // 20
      '=XXXXXXXXssXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXssXXXXXXXXX', // 21
      '=XXXXXXXXssXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXssXXXXXXXXX', // 22
      '=X#..............XXXXXXXXXXXXXXXXXXXXXX######..#######XX', // 23
      '=X#.MM.......M...XXXXXXXXXXXXXXXXXXXXXX.MM...........#XX', // 24
      '=X#.::::...::::..XXXXXXXXXXXXXXXXXXXXXX..:::::::::::.#XX', // 25
      '=X#.:::::::::::..XXXXXXXXXXXXXXXXXXXXXX..:::::...:::.#XX', // 26
      '=X#.:::GGGGG:::..XXXXXXXXXXXXXXXXXXXXXX..:::::::::::.#XX', // 27
      '=X#.:::GGGGG:::..XXXXXXXXXXXXXXXXXXXXXX..:::^:::::::.#XX', // 28
      '==..:::GGGGG:::..XXXXXXXXXXXXXXXXXXXXXX..:::::::::::.#XX', // 29
      'XX..:::GGGGG:::..XXXXXXXXXXXXXXXXXXXXXX..:::::::::::.#XX', // 30
      'XX#.:::GGGGG:::..XXXXXXXXXXXXXXXXXXXXXX.^:::::::::::.#XX', // 31
      'XX#.:::::::::::..XXXXXXXXXXXXXXXXXXXXXX..:::::::::::.#XX', // 32
      'XX#.:::::::::::..XX........p........XXX..::^::::::::.#XX', // 33
      'XX#M.............=..P......p......P..XX..:::::::^:::.#XX', // 34
      'XX#...........^.....:::::::p:::::::...=.......^......#XX', // 35
      'XXXXXXXXXXXXXXXXX...::.....p.....::...X..............#XX', // 36
      'XXXXXXXXXXXXXXXXX...::.....p.....::...XXXXXXXXXXXXXXXXXX', // 37
      'XXXXXXXXXXXXXXXXX...::.....p.....::...XXXXXXXXGGGXXXXXXX', // 38
      'XXXXGGGGXXXXXXXXX...:::::::p:::::::...XXXXXXXGGGGXXXXXXX', // 39
      'XXXXGGGGXXXXXXXXXX..P......p......P..XXXXXXXXGGGGXXXXXXX', // 40
      'XXXXXXXXXXXXXXXXXXX........p.........XXXXXXXXXGGXXXXXXXX', // 41
      'XXXXXXXXXXXXXXXXXXXXXXXXXsssssXXXXXXXXXXXXXXXXXXXXXXXXXX', // 42
      'XXXXXXXXXXXXXXXXXXXXXXXXXsssssXXXXXXXXXXXXXXXXXXXXXXXXXX', // 43
    ],
    entities: [
      // ── Stair Foot: arrival terrace
      { type: 'player', x: 27, y: 40 },
      { type: 'exit', id: 'spire_to_thicket', to: 'thicket', toX: 53, toY: 1, x: 26, y: 43, w: 3, h: 1, edge: 'south', facing: 'down', label: 'The Gilded Thicket' },
      { type: 'flag', id: 'spire_foot_flag', name: 'Stair Foot', x: 23, y: 37 },
      { type: 'prop', kind: 'steamvent', x: 31, y: 36 },
      { type: 'prop', kind: 'steamvent', x: 19, y: 38 },
      { type: 'chest', id: 'spire_chest_foot', loot: {glint: 220}, x: 36, y: 41 },
      // ── west terrace (a gap in its wall leads to a hidden girder)
      { type: 'prop', kind: 'geartower', x: 9, y: 25, solid: [[-1,0,3,1]] },
      { type: 'journal', id: 'j7', x: 5, y: 32 },
      { type: 'chest', id: 'spire_chest_west', loot: {shard: 'tincture_shard'}, x: 14, y: 34 },
      // ── hidden ledge north-west of the hall
      { type: 'chest', id: 'spire_chest_ledge', loot: {relic: 'quickened_gear'}, hidden: true, x: 1, y: 13 },
      // ── east terrace: the Last Stall
      { type: 'prop', kind: 'bench', x: 47, y: 26, solid: [[-1,0,3,1]] },
      { type: 'merchant', id: 'spire_merchant', shopId: 'spire_camp', look: 'horologist', greet: false, x: 47, y: 27 },
      { type: 'npc', id: 'apprentice', look: 'apprentice', dialogue: 'npc_apprentice', x: 50, y: 31 },
      { type: 'flag', id: 'spire_stall_flag', name: 'The Last Stall', x: 43, y: 31 },
      { type: 'prop', kind: 'clock', x: 51, y: 26, solid: [[0,0,1,1]] },
      { type: 'journal', id: 'j8', x: 41, y: 34 },
      { type: 'chest', id: 'spire_chest_stall', loot: {glint: 260}, x: 52, y: 35 },
      // ── the great gear hall
      { type: 'prop', kind: 'geartower', x: 22, y: 12, solid: [[-1,0,3,1]] },
      { type: 'prop', kind: 'geartower', x: 32, y: 12, solid: [[-1,0,3,1]] },
      { type: 'prop', kind: 'clock', x: 22, y: 10, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'clock', x: 32, y: 10, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'steamvent', x: 15, y: 15 },
      { type: 'prop', kind: 'steamvent', x: 40, y: 15 },
      { type: 'chest', id: 'spire_chest_east_ledge', loot: {relic: 'prism_shard'}, x: 53, y: 13 },
      // ── Meridian Landing and the stair to the Summit
      { type: 'flag', id: 'spire_landing_flag', name: 'Meridian Landing', x: 24, y: 4 },
      { type: 'journal', id: 'j9', x: 32, y: 4 },
      { type: 'chest', id: 'spire_chest_top', loot: {relic: 'sun_fragment'}, x: 35, y: 6 },
      { type: 'exit', id: 'spire_to_summit', to: 'summit', toX: 15, toY: 23, x: 26, y: 0, w: 3, h: 1, edge: 'north', facing: 'up', label: 'The Summit' },
      // ── roaming Gloam
      { type: 'enemy', id: 'spire_e1', encounter: 'spire_sentinel', x: 31, y: 38, patrol: {r: 1.8} },
      { type: 'enemy', id: 'spire_e2', encounter: 'spire_coghound_pair', x: 8, y: 33, patrol: {r: 2.2} },
      { type: 'enemy', id: 'spire_e3', encounter: 'spire_hourwraith', x: 12, y: 26, patrol: {r: 2} },
      { type: 'enemy', id: 'spire_e4', encounter: 'spire_stair_watch', x: 41, y: 25, patrol: {r: 1.8} },
      { type: 'enemy', id: 'spire_e5', encounter: 'spire_coghound_pair', x: 48, y: 36, patrol: {r: 1.6} },
      { type: 'enemy', id: 'spire_e6', encounter: 'spire_lost_hours', x: 14, y: 14, patrol: {r: 2.2} },
      { type: 'enemy', id: 'spire_e7', encounter: 'spire_gallery', x: 27, y: 18, patrol: {r: 2} },
      { type: 'enemy', id: 'spire_e8', encounter: 'spire_stair_watch', x: 40, y: 13, patrol: {r: 2} },
      { type: 'enemy', id: 'spire_e9', encounter: 'spire_hourwraith', x: 45, y: 17, patrol: {r: 1.8} },
      { type: 'enemy', id: 'spire_e10', encounter: 'spire_gallery', x: 9, y: 13, patrol: {r: 1.6} },
      { type: 'enemy', id: 'spire_e11', encounter: 'spire_clockwork_pack', x: 33, y: 10, patrol: {r: 1.8} },
      { type: 'enemy', id: 'spire_e12', encounter: 'spire_clockwork_pack', x: 31, y: 3, patrol: {r: 1.6} },
    ],
  },
  summit: {
    id: 'summit',
    name: 'The Summit',
    legend: {
      'X': 'void',
      '.': 'ground',
      ':': 'stone',
      'd': 'dial',
      's': 'stairs',
      'P': 'pillar',
      '#': 'wall',
    },
    tiles: [
      'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', //  0
      'XXXXXXXXXXXXXX...XXXXXXXXXXXXXX', //  1
      'XXXXXXXXXXXX.::P::.XXXXXXXXXXXX', //  2
      'XXXXXXXXXX..:::::::..XXXXXXXXXX', //  3
      'XXXXXXXXXP:::ddddd:::PXXXXXXXXX', //  4
      'XXXXXXXX.::ddddddddd::.XXXXXXXX', //  5
      'XXXXXXX.::ddddddddddd::.XXXXXXX', //  6
      'XXXXXX.::ddddddddddddd::.XXXXXX', //  7
      'XXXXXXP::ddddddddddddd::PXXXXXX', //  8
      'XXXXXX.:ddddddddddddddd:.XXXXXX', //  9
      'XXXXX.::ddddddddddddddd::.XXXXX', // 10
      'XXXXX.::ddddddddddddddd::.XXXXX', // 11
      'XXXXX.::ddddddddddddddd::.XXXXX', // 12
      'XXXXXX.:ddddddddddddddd:.XXXXXX', // 13
      'XXXXXXP::ddddddddddddd::PXXXXXX', // 14
      'XXXXXX.::ddddddddddddd::.XXXXXX', // 15
      'XXXXXXX.::ddddddddddd::.XXXXXXX', // 16
      'XXXXXXXX.::ddddddddd::.XXXXXXXX', // 17
      'XXXXXXXXX.:::ddddd:::.XXXXXXXXX', // 18
      'XXXXXXXXXX...........XXXXXXXXXX', // 19
      'XXXXXXXXXX..:::::::..XXXXXXXXXX', // 20
      'XXXXXXXXXX..:::::::..XXXXXXXXXX', // 21
      'XXXXXXXXXX#.........#XXXXXXXXXX', // 22
      'XXXXXXXXXXXXXXsssXXXXXXXXXXXXXX', // 23
      'XXXXXXXXXXXXXXsssXXXXXXXXXXXXXX', // 24
      'XXXXXXXXXXXXXXsssXXXXXXXXXXXXXX', // 25
      'XXXXXXXXXXXXXXsssXXXXXXXXXXXXXX', // 26
    ],
    entities: [
      // ── the last stair and the landing
      { type: 'player', x: 15, y: 23 },
      { type: 'exit', id: 'summit_to_spire', to: 'spire', toX: 27, toY: 1, x: 14, y: 26, w: 3, h: 1, edge: 'south', facing: 'down', label: 'The Meridian Spire' },
      { type: 'flag', id: 'summit_flag', name: 'Twenty to Seven', x: 12, y: 20 },
      // ── the great dial and the Stillkeeper
      { type: 'prop', kind: 'dial', w: 7, x: 15, y: 11, dx: 20, dy: -20, sort: -100000 },
      { type: 'boss', id: 'stillkeeper', encounter: 'boss_stillkeeper', dialogue: 'stillkeeper_pre', postDialogue: 'stillkeeper_post', x: 15, y: 4, trigger: 5.2, scale: 0.5 },
      // ── the last watch on the dial: an honour guard past the pennant, the long vigil nearer the Stillkeeper
      { type: 'enemy', id: 'summit_e1', encounter: 'summit_honor_guard', x: 18, y: 15, patrol: {r: 1.6} },
      { type: 'enemy', id: 'summit_e2', encounter: 'summit_vigil', x: 12, y: 11, patrol: {r: 1.6} },
      { type: 'prop', kind: 'figure', look: 'ghost', x: 23, y: 13, flip: true, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost2', x: 22, y: 16, flip: true, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost', x: 9, y: 16, flip: false, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost2', x: 7, y: 13, flip: false, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost', x: 7, y: 9, flip: false, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost2', x: 8, y: 6, flip: false, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost', x: 11, y: 4, flip: false, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost2', x: 18, y: 4, flip: true, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost', x: 21, y: 6, flip: true, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'figure', look: 'ghost2', x: 23, y: 9, flip: true, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'banners', variant: 0, x: 11, y: 19, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'banners', variant: 1, x: 19, y: 19, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'banners', variant: 2, x: 10, y: 2, solid: [[0,0,1,1]] },
      { type: 'prop', kind: 'banners', variant: 3, x: 20, y: 2, solid: [[0,0,1,1]] },
    ],
  },
};
