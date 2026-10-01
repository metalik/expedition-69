// Story text for Expedition 69: intro/ending slides, dialogues, lost-expedition journals, tutorial hints, zone titles.
// Pure data. Hint strings contain {action} tokens ({parry} {dodge} {jump} {gradient} {qte} {confirm} …) that the UI
// replaces with the current device's key labels — see fillTokens().

/**
 * @typedef {{ title?:string, text:string }} Slide
 * @typedef {{ speaker:string, text:string }} Line      speaker: 'gideon' | 'nyra' | 'sable' | 'narrator' | a free name
 * @typedef {{ zone:string, title:string, author:string, text:string }} Journal
 */

/** Dialogue ids other modules rely on (SPEC §3.8). */
export const REQUIRED_DIALOGUE_IDS = [
  'shore_arrival', 'flag_first', 'warden_pre', 'warden_post', 'thicket_arrival',
  'bellwether_pre', 'bellwether_post', 'spire_arrival', 'summit_arrival', 'stillkeeper_pre',
  'stillkeeper_phase2', 'stillkeeper_post', 'merchant_greet', 'trainer_greet',
];

/** Tutorial hint keys (SPEC §3.8). */
export const HINT_KEYS = [
  'firstTurn', 'ap', 'skills', 'qte', 'parry', 'dodge', 'jump', 'unparryable',
  'gradientHit', 'counter', 'freeAim', 'shields', 'break', 'gradientMeter', 'stances', 'glyphs', 'surge',
];

/** Journal ids: j1–j3 shore, j4–j6 thicket, j7–j9 spire. */
export const JOURNAL_IDS = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8', 'j9'];

/** Input-action tokens that may appear in hint text as {token}. */
export const HINT_TOKENS = ['parry', 'dodge', 'jump', 'gradient', 'qte', 'confirm', 'cancel', 'menu'];

/** Display names for the fixed speaker ids (free-name speakers are shown as written). */
export const SPEAKER_NAMES = { gideon: 'Gideon', nyra: 'Nyra', sable: 'Sable', narrator: '' };

export const STORY = {
  intro: [
    {
      title: 'Veyra',
      text: 'Once, the Clockwork Sun crossed the sky above Veyra every day, wound by the city\'s horologists like the '
        + 'grandest watch ever made. Sixty-eight years ago, at twenty to seven in the evening, it stopped.',
    },
    {
      title: 'The Endless Dusk',
      text: 'It has been evening ever since. The light never fades and never returns. Children grow up without a '
        + 'single night; the old have forgotten the shape of the stars. The tide stands halfway out. Autumn never '
        + 'finishes falling.',
    },
    {
      title: 'The Gloam',
      text: 'With the stillness came the Gloam — creatures of stopped time. Lanterns that swim. Knights of porcelain. '
        + 'Smoke that wears clock hands. Where they gather, moments catch like cloth on a nail, and do not tear free.',
    },
    {
      title: 'The Expeditions',
      text: 'Every year Veyra sends an expedition across the Shattered Sea to the Meridian Spire, where the Sun\'s great '
        + 'hand is held still. Sixty-eight have gone. None have come back. Only their journals return, now and then, '
        + 'on a tide that does not move.',
    },
    {
      title: 'Expedition 69',
      text: 'This year there are three. A harbour captain who has watched too many crews sail out. A scholar who reads '
        + 'the lost journals aloud at every camp. A duellist whose mother marched with the sixty-eighth.',
    },
    {
      title: 'Brinegate Shore',
      text: 'The first crews named the far shore after the harbour they had left, so there would be something of home to '
        + 'land on. The boat grounds on sand still warm from a sunset sixty-eight years long. Somewhere ahead, something '
        + 'is holding the world\'s breath. Expedition 69 has come to let it go.',
    },
  ],

  ending: [
    {
      title: 'The Hand Moves',
      text: 'The Sun\'s great hand slides past twenty to seven. Gears older than the city turn over with a sound like a '
        + 'long sigh. Where the Stillkeeper knelt there is only cooling gilt, a pair of spectacles, and a child\'s '
        + 'drawing of a sun with a face.',
    },
    {
      title: 'Sunset',
      text: 'It sets — slowly, the way sunsets do. Crimson, then violet, then gone. In Veyra, people stand in the streets '
        + 'and weep without knowing why. Most of them have never seen anything end.',
    },
    {
      title: 'Night',
      text: 'Then the first stars. Nyra counts them until she loses count, and keeps counting anyway. Gideon sits with his '
        + 'back against a warm gear and, for the first time in twenty years, sleeps without keeping watch.',
    },
    {
      title: 'The Ones Who Stayed',
      text: 'Across the Summit, the crews of sixty-eight expeditions lower their arms and look about like sleepers woken '
        + 'from a nap. One by one they smile and thin into the dark like breath on glass. A woman in a salt-stained coat '
        + 'sees the white plume in Sable\'s hat, laughs, and does not need to say anything at all.',
    },
    {
      title: 'Morning',
      text: 'And then — because that is what nights are for — morning. The Sun climbs over the Shattered Sea, pink and '
        + 'ordinary, and the wave that hung above Brinegate for sixty-eight years finally breaks upon the shore.',
    },
    {
      title: 'Expedition 69',
      text: 'In Veyra\'s harbour someone has already begun painting SEVENTY on the prow of a new boat, just in case. '
        + 'Gideon tells them to paint it over. Nyra opens a fresh journal and writes the first line: '
        + '"Expedition 69 — Day 1. The Sun rose. We are coming home."',
    },
  ],

  dialogues: {
    shore_arrival: [
      { speaker: 'narrator', text: 'Brinegate Shore. The sea stands halfway out, one great wave curled overhead that never falls.' },
      { speaker: 'sable', text: 'Sixty-eight expeditions, and not one of them thought to build a pier.' },
      { speaker: 'nyra', text: 'Look at the water — it isn\'t frozen, it\'s paused. The spray is still in mid-air. The tide\'s frequency is exactly zero.' },
      { speaker: 'gideon', text: 'Eyes up. Something\'s glowing in the shallows, and it isn\'t a harbour light.' },
      { speaker: 'nyra', text: 'Driftlings. The journals say they sting, but they\'re slow. Watch how they move before they strike.' },
      { speaker: 'gideon', text: 'Stay behind me. That isn\'t a suggestion. That\'s the whole plan.' },
      { speaker: 'sable', text: 'Your plan has a flaw, Captain. I\'m faster than you.' },
    ],

    flag_first: [
      { speaker: 'narrator', text: 'An Expedition Pennant, planted by a crew that never came home. It still stirs in a wind that isn\'t blowing.' },
      { speaker: 'nyra', text: 'Expedition 41\'s colours. They rested here — there\'s a ring of stones for a fire.' },
      { speaker: 'gideon', text: 'Then so do we. Patch the wounds, count the tinctures. A pennant keeps the Gloam off while we rest.' },
      { speaker: 'sable', text: 'Does it do breakfast?' },
      { speaker: 'gideon', text: 'It does not.' },
      { speaker: 'narrator', text: 'Resting at a pennant heals the party and refills items — but the Gloam you have cleared will drift back.' },
    ],

    warden_pre: [
      { speaker: 'narrator', text: 'The wreck line. A hulk of brass and barnacles rises from the sand, its anchor chain rattling in the stillness.' },
      { speaker: 'nyra', text: 'That\'s a diving suit. Harbour Guild issue — look at the collar plate. "EXP. VII."' },
      { speaker: 'gideon', text: 'Seven. My grandfather waved Seven off from the harbour wall.' },
      { speaker: 'sable', text: 'Then it\'s long overdue for retirement. Let\'s help it along.' },
      { speaker: 'gideon', text: 'It swings that anchor slow and heavy. Wait for it to come down — don\'t flinch early.' },
      { speaker: 'The Wreck Warden', text: '…DEPTH… HOLDING… ALL HANDS… HOLD…' },
    ],

    warden_post: [
      { speaker: 'narrator', text: 'The Warden sinks to its knees. The porthole light gutters, and something inside the helm breathes out for the first time in sixty-two years.' },
      { speaker: 'nyra', text: 'It was still holding its breath. All this time.' },
      { speaker: 'gideon', text: 'Rest easy, sailor. Your watch is over.' },
      { speaker: 'sable', text: '…That was a person once. Wasn\'t it?' },
      { speaker: 'gideon', text: 'Once. Keep moving, Arden. The way to the Thicket is open.' },
    ],

    thicket_arrival: [
      { speaker: 'narrator', text: 'The Gilded Thicket: autumn caught at its most golden, every leaf hanging mid-fall in the dusk.' },
      { speaker: 'nyra', text: 'They\'re falling. Every single leaf is falling — and none of them ever land.' },
      { speaker: 'sable', text: 'Gorgeous. Unsettling. Like a portrait whose eyes follow you round the room.' },
      { speaker: 'gideon', text: 'Stags in the trees. Masks, too. The Gloam here lie with their bodies — listen before you trust your eyes.' },
      { speaker: 'nyra', text: 'If a swing stops short, don\'t answer it. Wait for the one that means it.' },
    ],

    bellwether_pre: [
      { speaker: 'narrator', text: 'In a clearing of bronze leaves stands a ram-horned giant with a great bell for a head. It is ringing twenty to seven.' },
      { speaker: 'nyra', text: 'The bell is inscribed. "Ring for Lise at every hour…" Lise. Whoever she was, someone wanted her to hear this.' },
      { speaker: 'sable', text: 'Is it counting down, or counting up?' },
      { speaker: 'gideon', text: 'Neither. It\'s stuck. Like everything else out here.' },
      { speaker: 'The Bellwether', text: 'LATE. LATE. LATE. THE HOUR IS LATE.' },
      { speaker: 'nyra', text: 'When it swings back, the world will lose its colour — that\'s no ordinary blow. Meet it with a Prism Counter and its toll will ring back on itself.' },
    ],

    bellwether_post: [
      { speaker: 'narrator', text: 'The great bell splits with a sound like a held note finally allowed to end.' },
      { speaker: 'The Bellwether', text: '…tell her… coming… home…' },
      { speaker: 'sable', text: 'Tell who?' },
      { speaker: 'nyra', text: 'Lise. Someone called Lise, whose father promised to come home from the Spire. Sixty-eight years ago.' },
      { speaker: 'gideon', text: 'Then he never made it home. And I\'d wager he\'s the one waiting for us at the top.' },
      { speaker: 'sable', text: 'Good. I have questions for him. Most of them end in a point.' },
    ],

    spire_arrival: [
      { speaker: 'narrator', text: 'The Meridian Spire: a mountain of clockwork climbing into the frozen sun, its stair ticking as it builds itself.' },
      { speaker: 'gideon', text: 'That\'s no tower. That\'s a mechanism.' },
      { speaker: 'nyra', text: 'Every gear is signed. "A.V." … "A.V." … "A.V." One maker. One man built all of this.' },
      { speaker: 'sable', text: 'One man and sixty-eight years of spare time.' },
      { speaker: 'nyra', text: 'The Gloam here will be quick — hounds, knights, things made of hours. Keep your rhythm. Count aloud if you have to.' },
      { speaker: 'gideon', text: 'And stay close. We\'ve come too far to lose anyone on the stairs.' },
    ],

    summit_arrival: [
      { speaker: 'narrator', text: 'The Summit. Above the clouds the Clockwork Sun hangs vast and silent, its great hand held back by a knight of gilt and glass.' },
      { speaker: 'sable', text: 'There are people up here. Standing. Hundreds of them.' },
      { speaker: 'nyra', text: 'The expeditions — all of them. They didn\'t vanish. They stayed.' },
      { speaker: 'gideon', text: 'Stayed? Of their own will?' },
      { speaker: 'nyra', text: '"Only one more evening." That\'s what the journals say he asks. And they said yes.' },
      { speaker: 'sable', text: 'Is she — no. Don\'t answer that. Let\'s finish this.' },
      { speaker: 'gideon', text: 'Together, then. On my mark.' },
    ],

    stillkeeper_pre: [
      { speaker: 'The Stillkeeper', text: 'Softly. Please. She is sleeping.' },
      { speaker: 'nyra', text: 'Aurèle Vantine. Master of the Horologists\' Guild. You built the Sun.' },
      { speaker: 'The Stillkeeper', text: 'I built it for her — a toy for the whole sky. And when she fell ill, I climbed up to give her more time. One more evening. Only one more.' },
      { speaker: 'gideon', text: 'It\'s been sixty-eight years, Master Vantine.' },
      { speaker: 'The Stillkeeper', text: 'Has it? Then stay with me, as the others stayed. It is such a gentle evening.' },
      { speaker: 'sable', text: 'My mother stayed. I\'ve come to take her home. Step aside, old man.' },
      { speaker: 'The Stillkeeper', text: '…Then I am sorry. I cannot let it end.' },
    ],

    stillkeeper_phase2: [
      { speaker: 'narrator', text: 'The cracked halo shatters. Its shards whirl up into a storm of stopped seconds.' },
      { speaker: 'The Stillkeeper', text: 'No — no, the hand is slipping — I will not let it set!' },
      { speaker: 'nyra', text: 'He\'s unwinding! Everything he\'s held back is pouring out at once — there\'s no rhythm left in it!' },
      { speaker: 'gideon', text: 'Then we keep the rhythm for him. Watch the feet, watch the colour, and don\'t you dare stop.' },
      { speaker: 'sable', text: 'Faster? Finally. I was starting to get bored.' },
    ],

    stillkeeper_post: [
      { speaker: 'narrator', text: 'The Stillkeeper kneels. For the first time in sixty-eight years, its grip on the Sun\'s great hand loosens.' },
      { speaker: 'The Stillkeeper', text: 'She asked me to watch the sunset with her. I could not bear the ending… so I never let it come.' },
      { speaker: 'nyra', text: 'Then let it come now. She would have wanted to see the stars.' },
      { speaker: 'The Stillkeeper', text: 'Stars. I had forgotten there were stars.' },
      { speaker: 'gideon', text: 'Let go, Master Vantine. We\'ll keep the watch from here.' },
      { speaker: 'The Stillkeeper', text: 'Lise… it\'s time. Goodnight, my dear. Goodnight.' },
      { speaker: 'narrator', text: 'The great hand moves. Far below, over Brinegate, the waiting wave stirs.' },
    ],

    merchant_greet: [
      { speaker: 'Pellam Quist', text: 'Customers! Living ones, even. Oh, this is shaping up to be a good year.' },
      { speaker: 'Pellam Quist', text: 'Pellam Quist, late of Expedition 61. I found retail survives rather better than heroics.' },
      { speaker: 'sable', text: 'You\'ve been out here eight years selling trinkets to monsters?' },
      { speaker: 'Pellam Quist', text: 'The monsters are terrible customers. You three, though — relics, shards, all priced in glint. No refunds; nobody\'s ever come back to ask.' },
    ],

    trainer_greet: [
      { speaker: 'Drillmaster Hesper', text: 'Another crew! Line up. Chin up. Guard up.' },
      { speaker: 'Drillmaster Hesper', text: 'Hesper, Expedition 30. I drilled twelve crews in Veyra before I crossed, and every crew that\'s passed since. My mannequin has never lost.' },
      { speaker: 'Drillmaster Hesper', text: 'Practise on it as often as you like. It hits soft, it never tires, and it never tells anyone how badly you did.' },
      { speaker: 'sable', text: 'Then it\'s going to keep a lot of my secrets.' },
      { speaker: 'Drillmaster Hesper', text: 'They all do, girl. They all do.' },
    ],

    npc_lamplighter: [
      { speaker: 'Lamplighter', text: 'Mind the Driftlings, travellers. They\'re not wicked. Only lost.' },
      { speaker: 'Lamplighter', text: 'Forty-one, I came over with. I light a lantern for them every evening so they can find their way home.' },
      { speaker: 'nyra', text: 'Does it work?' },
      { speaker: 'Lamplighter', text: 'Not yet. But it\'s always evening, so I never run out of chances.' },
    ],

    npc_frozen_gull: [
      { speaker: 'narrator', text: 'A gull hangs in the air above the sand, beak open, caught mid-squawk for sixty-eight years.' },
      { speaker: 'sable', text: 'I have never related to a bird so deeply.' },
      { speaker: 'gideon', text: 'Leave it be. It\'ll finish that thought when the rest of the world does.' },
    ],

    npc_cartographer: [
      { speaker: 'Cartographer', text: 'Don\'t tread on the leaves! Well — you can\'t, can you. They never land.' },
      { speaker: 'Cartographer', text: 'Expedition 57. I\'ve mapped every leaf in this Thicket. Not one has moved since I started. Most accurate map I ever drew.' },
      { speaker: 'nyra', text: 'May I copy it? For the archive?' },
      { speaker: 'Cartographer', text: 'Take it. Take it and go up. Somebody should see what the map looks like after.' },
    ],

    npc_apprentice: [
      { speaker: 'Apprentice', text: 'Master Vantine? You\'ve heard of him! He was kind to apprentices, you know. He let us wind the little suns in the workshop.' },
      { speaker: 'Apprentice', text: 'Twenty-two, I came with. I thought if I climbed high enough I could ask him to come down. He only asked me to stay.' },
      { speaker: 'gideon', text: 'And you did.' },
      { speaker: 'Apprentice', text: 'He looked so tired. Tell him — if you reach him — tell him it\'s all right to rest.' },
    ],

    npc_quist_rumours: [
      { speaker: 'Pellam Quist', text: 'Free advice, for old customers: anything that glows red when it swings, you get out of the way. Don\'t argue with it.' },
      { speaker: 'Pellam Quist', text: 'Gold ripples on the ground? Hop. And when the colour drains out of the world, that\'s your cue to be very clever or very quick.' },
      { speaker: 'sable', text: 'That\'s actually useful.' },
      { speaker: 'Pellam Quist', text: 'I know. That\'s why it\'s free — nobody values useful. Madame Orrery\'s the one selling here; tell her I sent you. She\'ll charge you double.' },
    ],
  },

  journals: {
    j1: {
      zone: 'shore',
      title: 'Expedition 41 — Day 2',
      author: 'Rosa Marchetti, surveyor',
      text: 'The tide has been out for forty-one years and the sea still has not noticed. You can walk a mile across the '
        + 'flats with the water standing at your knees like glass, and a wave curled over your head that never falls. '
        + 'Aldo says the Gloam came down from the Spire. I don\'t think they came from anywhere. The floating lanterns '
        + 'are Veyra\'s own harbour lights — I saw the Harbour Watch crest on one. They were lit when the Sun stopped, '
        + 'and they have been waiting to be put out ever since.',
    },
    j2: {
      zone: 'shore',
      title: 'Expedition 52 — Day 9',
      author: 'Tobiah Kress, engineer',
      text: 'Kress\'s log. The arc-gauntlet works: enough stored lightning to jolt a stopped heart, and we mean to jolt a '
        + 'stopped Sun. The great diver on the wreck line nearly had my arm off before I got it charged. Brass suit, '
        + 'porthole helm, and "EXP. VII" stamped on the collar plate. Seven. It walked into this sea forty-five years ago '
        + 'and has been walking ever since. I don\'t believe the Gloam kill anyone. I think this place keeps what it '
        + 'catches. If the gauntlet washes home without me: it still works. Mind the recoil.',
    },
    j3: {
      zone: 'shore',
      title: 'Expedition 64 — Day 1',
      author: 'Wren Oriel, deckhand',
      text: 'We came ashore at the wrong end of the beach and found a lifeboat older than all of us put together. Under '
        + 'the thwart, sealed in a biscuit tin: a child\'s drawing. A sun with a smiling face, a tall thin man flying it '
        + 'on a string like a kite, and underneath, in careful capitals, PAPA\'S SUN — FOR LISE. The man has spectacles '
        + 'and a tool-belt. The sun has a winding key in its back. I can\'t stop wondering who would draw the Sun as a '
        + 'toy — and who would build one.',
    },
    j4: {
      zone: 'thicket',
      title: 'Expedition 29 — Day 17',
      author: 'Hollis Brand, botanist',
      text: 'The Thicket was a garden once — somebody\'s garden, before it was everybody\'s forest. There are brass '
        + 'plant-labels under the leaf mould, and the golden trees stand in rows if you squint. In the old glasshouse I '
        + 'found a plaque beside an oak sapling that has not grown an inch since the dusk: PLANTED BY A. VANTINE FOR '
        + 'LISE, ON HER FIFTH BIRTHDAY. AUTUMN, HER FAVOURITE. Well. It is autumn now, forever, and the leaves never '
        + 'finish falling. Someone got their wish. I wonder whether it was the child\'s.',
    },
    j5: {
      zone: 'thicket',
      title: 'Expedition 50 — Day 23',
      author: 'Celeste Varga, bandmaster',
      text: 'For the fiftieth they sent us with a brass band. Half of it is gone now. The Harlequins took Albrecht\'s trumpet '
        + 'and play it back to us without a sound — they mime whatever we have lost, perfectly and silently. The '
        + 'rose-headed women tend blooms that have been open for fifty years; I watched one pick up a fallen petal and '
        + 'press it back onto the flower. That is the whole Thicket, I think: a place where nothing is permitted to end. '
        + 'It ought to feel like paradise. It feels like a sickroom where no one will open the curtains.',
    },
    j6: {
      zone: 'thicket',
      title: 'Expedition 57 — Day 31',
      author: 'Brother Osk, chaplain',
      text: 'The great bell-creature in the clearing rang again. It rings every hour, and every hour is the same one: '
        + 'twenty to seven, evening. We counted two hundred tolls and the sky never moved. While it slept I climbed its '
        + 'frame and copied the words cast around its lip: RING FOR LISE AT EVERY HOUR, THAT SHE MAY KNOW HER FATHER IS '
        + 'COMING HOME. So he was coming home — from the Spire, I suppose. I wonder if he ever did. I wonder what he '
        + 'found when he got there, at twenty to seven.',
    },
    j7: {
      zone: 'spire',
      title: 'Expedition 3 — Day 40',
      author: 'Captain Idris Talbot\'s second',
      text: 'The Spire was a tower when we landed. Now it is a mountain of clockwork, and the stair builds itself one '
        + 'flight ahead of us every time we sleep. Today we saw the Keeper at the summit: a great knight holding the Sun\'s hand '
        + 'still, the way you would hold a door for someone. It did not attack. It spoke very softly, like a man at a '
        + 'bedside. "Stay," it said. "Only one more evening. She is sleeping." Talbot laughed and said he would stay, and '
        + 'walked up to it, and he has not moved since.',
    },
    j8: {
      zone: 'spire',
      title: 'Expedition 46 — Day 38',
      author: 'Ansel Deverin, archivist',
      text: 'Found the Horologists\' Guild ledger in a flooded workshop on the fourth landing. Master Aurèle Vantine, maker '
        + 'of the Clockwork Sun, resigned his chair on the evening of the stopping. A clerk\'s note in the margin: '
        + '"Daughter very ill. Master V. gone up the Spire with his tools. Says he will buy her more time." The next page '
        + 'is blank, and every page after it. The wraiths up here are made of hours — I saw Marguerite\'s pocket-watch '
        + 'spinning inside one — and I think I finally know whose bill they are paying.',
    },
    j9: {
      zone: 'spire',
      title: 'Expedition 68 — Day 44',
      author: 'Maren Arden',
      text: 'We have seen the Keeper, and it is a man — or was, before he buried himself in his own clockwork. Vantine. '
        + 'He did not stop the Sun to hurt Veyra. He stopped it so that one evening would never end: the evening his '
        + 'daughter lay dying. She died anyway. He kept the light she died in. He asked us to stay, and some of us '
        + 'wanted to. I am sending my plume home on the tide, so someone knows we got this far. If a fencer with a mouth '
        + 'on her ever reads this: it was for luck. Ending this will take someone braver than we were — and kinder.',
    },
  },

  hints: {
    firstTurn: 'It\'s your turn. Pick a command and press {confirm} — Attack costs nothing and earns 1 AP.',
    ap: 'Skills cost Action Points (max 9). You gain 1 AP each turn, 1 per Basic Attack and 1 for every parry.',
    skills: 'Skills hit harder and cost AP. Most have timed hits — press {qte} as each ring closes for bonus damage.',
    qte: 'Press {qte} just as the ring closes on the target. Perfect timing deals ×1.4 damage and charges the Prism gauge.',
    parry: 'Press {parry} the instant a white-cued hit lands to parry it: no damage, +1 AP. The window is tight.',
    dodge: 'Press {dodge} as a hit lands to dodge it. Dodging is more forgiving than parrying, but earns no AP and no counter.',
    jump: 'Gold waves roll along the ground — press {jump} as one reaches you to leap over it. Only a jump avoids them.',
    unparryable: 'Red, spiked cues cannot be parried. {dodge} them — a parry attempt will fail.',
    gradientHit: 'When the world turns grey and a violet prism appears, press {gradient} for a Prism Counter and a riposte — or {dodge} to simply survive.',
    counter: 'Answer every hit an attack aims at someone with a parry, a jump or a Prism Counter and they strike back automatically. Dodges don\'t count.',
    freeAim: 'Free Aim spends 1 AP per shot and does not end your turn. Shoot glowing weak points to crit, break or strip shields.',
    shields: 'Each shield blocks one hit completely. Break them with multi-hit skills, or shoot a shield weak point to strip two at once.',
    break: 'Hits fill the orange Break gauge. When it\'s full the enemy is Broken: it loses its next turn and takes 25% more damage.',
    gradientMeter: 'Parries, jumps, dodges and perfect QTEs fill the Prism gauge. Each full charge fires a character\'s Prism skill for 0 AP.',
    stances: 'Sable\'s skills shift her stance: Assault hits harder, Guard takes less, and Assault twice becomes Bravura. Any hit she fails to avoid resets it.',
    glyphs: 'Nyra\'s scripts inscribe elemental glyphs (up to 4). Her sigils consume them for powerful bonus effects.',
    surge: 'Gideon builds Surge by landing hits, taking hits and parrying. Finishers consume it for up to ×3 damage.',
  },

  zoneTitles: {
    shore: 'Brinegate Shore',
    thicket: 'The Gilded Thicket',
    spire: 'The Meridian Spire',
    summit: 'The Summit',
    training: 'The Practice Yard',
  },

  /** Banner subtitles shown under the zone title on arrival (addition to the spec'd shape). */
  zoneSubtitles: {
    shore: 'Where the tide stopped',
    thicket: 'Autumn, caught mid-fall',
    spire: 'The stair that builds itself',
    summit: 'Twenty to seven, forever',
    training: 'Hesper\'s mannequin never loses',
  },
};

/**
 * Replace {token} placeholders with labels, e.g. fillTokens(STORY.hints.parry, (a) => input.keyLabel(a)).
 * Unknown tokens, or tokens for which `labelFor` returns a non-string/empty value, are left untouched.
 * @param {string} text
 * @param {(token:string) => (string|null|undefined)} labelFor
 * @returns {string}
 */
export function fillTokens(text, labelFor) {
  return String(text).replace(/\{([a-zA-Z]+)\}/g, (whole, token) => {
    const label = labelFor(token);
    return typeof label === 'string' && label.length ? label : whole;
  });
}

/**
 * Dialogue lines by id (empty array when unknown, so callers never crash).
 * @param {string} id
 * @returns {Line[]}
 */
export function getDialogue(id) {
  return Object.prototype.hasOwnProperty.call(STORY.dialogues, id) ? STORY.dialogues[id] : [];
}

/**
 * Display name for a speaker id ('' for the narrator; free names are returned as-is).
 * @param {string} speaker
 * @returns {string}
 */
export function speakerName(speaker) {
  return Object.prototype.hasOwnProperty.call(SPEAKER_NAMES, speaker) ? SPEAKER_NAMES[speaker] : speaker;
}
