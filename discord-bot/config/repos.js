// ── Game & app repo registry ───────────────────────────────────────────────
// Add a new game here — no other files need to change.
// emoji: shown in Discord embeds
// color: hex integer for embed sidebar color
module.exports = [
  {
    id:    'chaos-casino',
    name:  'Chaos Casino',
    emoji: '🎰',
    color: 0xe04040,
    repo:  'ktdtech223dev/chaos-holdem-client',
  },
  {
    id:    'nkart',
    name:  'N Kart',
    emoji: '🏎️',
    color: 0xf0c040,
    repo:  'ktdtech223dev/nkart',
  },
  {
    id:    'blacks-dungeon',
    name:  'Shape of Blacks',
    emoji: '⚔️',
    color: 0x6366f1,
    repo:  'ktdtech223dev/sob',
  },
  {
    id:    'case-sim',
    name:  'Case Sim',
    emoji: '🎁',
    color: 0x40c0e0,
    repo:  'ktdtech223dev/csgocasesim',
  },
  {
    id:    'project-x',
    name:  'N Arena',
    emoji: '🏟️',
    color: 0x80e060,
    repo:  'ktdtech223dev/nigarena',
  },
  {
    id:    'cuunsurf',
    name:  'CuunSurf',
    emoji: '🏄',
    color: 0x38bdf8,
    repo:  'ktdtech223dev/surf-game',
  },
  {
    id:    'nstreams',
    name:  'N Streams',
    emoji: '📺',
    color: 0x9d5cff,
    repo:  'ktdtech223dev/nstreams',
  },
  {
    id:    'interrogating-blacks',
    name:  'Interrogating Blacks',
    emoji: '🎙️',
    color: 0xffd700,
    repo:  'ktdtech223dev/InterrogatingBlacks',
  },
  {
    id:         'n-games-launcher',
    name:       'N Games Launcher',
    emoji:      '🚀',
    color:      0x80e060,
    repo:       'ktdtech223dev/n-games-launcher',
    isLauncher: true, // launcher updates: no @everyone, different embed title
  },
];
