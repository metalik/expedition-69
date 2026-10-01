// Shared colour palette, fonts and per-zone colour schemes for Expedition 69.
// Pure data: safe to import from any module (including Node tests).

export const FONTS = {
  title: '"Cinzel", "Trajan Pro", Georgia, serif',
  body: '"Cormorant Garamond", Georgia, "Times New Roman", serif',
};

export const PALETTE = {
  ink: '#15100d',
  inkSoft: '#231a15',
  panel: 'rgba(16, 12, 10, 0.82)',
  night: '#1b1828',
  dusk: '#3a2b4a',
  plum: '#5a3550',
  ember: '#e2733b',
  gold: '#e0b458',
  paleGold: '#f3dba0',
  brass: '#b8893b',
  ivory: '#f5eedf',
  parchment: '#e9dcc0',
  crimson: '#a3302a',
  rose: '#d9837b',
  teal: '#2e7775',
  sea: '#3f8fa0',
  frost: '#a8d8ea',
  leaf: '#c9a43a',
  moss: '#5c6b3a',
  porcelain: '#e8e4dc',
  violet: '#8a5cc4',
  shadow: 'rgba(8, 5, 3, 0.55)',
  hpGood: '#8fcf6b',
  hpMid: '#e6c14a',
  hpLow: '#e0553d',
  ap: '#f3dba0',
  breakBar: '#f0a23a',
  shield: '#9fd3ff',
};

export const ELEMENT_COLORS = {
  physical: '#efe6d6',
  fire: '#f07a3a',
  ice: '#9fd9f0',
  lightning: '#f4e36a',
  earth: '#c49a5a',
  light: '#fff3c2',
  dark: '#9b6fd6',
};

// Enemy hit types (defense QTE). Always pair colour with a distinct cue shape.
export const HIT_TYPE_COLORS = {
  normal: '#ffffff',
  unparryable: '#ff4a3d',
  jump: '#ffcc33',
  gradient: '#c77dff',
  feint: '#ffffff',
};

export const STATUS_COLORS = {
  burn: '#f07a3a',
  chill: '#9fd9f0',
  mark: '#ff5a7a',
  powerful: '#f0b040',
  shell: '#7fc8ff',
  haste: '#9fe88a',
  slow: '#8a8fb0',
  weakened: '#b07a9a',
  defenseless: '#ff8a4a',
  stun: '#f4e36a',
  regen: '#7fe0a8',
  silence: '#b8a0e8',
};

export const QTE_COLORS = {
  perfect: '#fff3c2',
  good: '#9fe0ff',
  miss: '#b0a8a0',
};

// Per-zone painterly schemes: sky gradient stops (top → horizon), plus accents.
export const ZONE_PALETTES = {
  shore: {
    sky: ['#2b2340', '#6b4a63', '#d9876a', '#f3c98b'],
    sun: '#ffd79a',
    ground: ['#c9a77c', '#8f6f52'],
    water: ['#3f8fa0', '#1f4f5f'],
    accent: '#2e7775',
    fog: 'rgba(243, 201, 139, 0.18)',
  },
  thicket: {
    sky: ['#2a2230', '#5a4630', '#c9953f', '#f1d38a'],
    sun: '#ffe2a0',
    ground: ['#6f6a2e', '#3c3a1c'],
    foliage: ['#c9a43a', '#e3c15b', '#8a6b24'],
    accent: '#c9a43a',
    fog: 'rgba(241, 211, 138, 0.16)',
  },
  spire: {
    sky: ['#161826', '#2f3350', '#7a6a7a', '#d3a877'],
    sun: '#f5c77e',
    ground: ['#6b5a45', '#3a3027'],
    metal: ['#b8893b', '#6f5426', '#e8c16a'],
    accent: '#b8893b',
    fog: 'rgba(211, 168, 119, 0.14)',
  },
  summit: {
    sky: ['#0d0b14', '#2a1c33', '#8a4a3a', '#f0b25a'],
    sun: '#fff0c0',
    ground: ['#4a3b33', '#1f1814'],
    accent: '#e0b458',
    fog: 'rgba(240, 178, 90, 0.2)',
  },
  training: {
    sky: ['#2c2533', '#5b4a55', '#b98a6a', '#e8c79a'],
    sun: '#ffe0a8',
    ground: ['#8a7358', '#5a4a39'],
    accent: '#a3302a',
    fog: 'rgba(232, 199, 154, 0.15)',
  },
};
