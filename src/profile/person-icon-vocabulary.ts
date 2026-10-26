// Adapted from mxbaylee/circus-health src/shared/person-icon-vocabulary.ts at 2ab77af.
// Updated for Spinel's Lucide 1.59 renames while preserving saved names and local tags.
// Local vocabulary augments upstream tags without renaming the actual Lucide icon.
export const ICON_EXTRA_TAGS: Record<string, string[]> = {
  'flower-2': [
    'lotus',
    'water lily',
    'petals',
    'bloom',
    'blossom',
    'garden',
    'floral',
    'botanical',
  ],
  flower: ['flower', 'rose', 'tulip', 'daisy', 'sunflower', 'petals', 'garden', 'floral'],
  'user-round': ['person', 'self', 'patient', 'human', 'profile'],
  stethoscope: ['doctor', 'physician', 'nurse', 'primary care', 'specialist'],
  'party-popper': ['jester', 'clown', 'celebration', 'confetti'],
  'venetian-mask': ['jester', 'theatre', 'theater', 'masquerade'],
  cookie: ['cookie dough', 'baking', 'biscuit'],
  'a-arrow-down': ['decrease', 'shrink', 'reduce', 'typography'],
  'a-arrow-up': ['increase', 'grow', 'enlarge', 'typography'],
  'a-large-small': ['resize', 'typography', 'text size'],
  accessibility: ['a11y', 'assistive technology', 'accommodation', 'universal access'],
  activity: ['heartbeat', 'cardiogram', 'electrocardiogram', 'ecg', 'ekg'],
  ad: ['advertisement', 'promotion', 'sponsored', 'billboard', 'banner'],
  'air-vent': ['ventilation', 'hvac', 'duct', 'ductwork', 'airflow', 'grille'],
  airplay: ['broadcast', 'screencast', 'wireless display', 'television'],
  'alarm-clock-check': ['acknowledge', 'confirmed', 'verified', 'alarm set'],
  'alarm-clock-minus': ['cancel', 'delete', 'unschedule', 'remove alarm'],
  'alarm-clock-off': ['disable', 'mute', 'silent', 'deactivate'],
  'alarm-clock-plus': ['create', 'schedule', 'set alarm', 'new alarm'],
  'alarm-clock': ['wake', 'wake-up', 'reminder', 'ringing'],
  'alarm-smoke': ['co alarm', 'fumes', 'combustion', 'toxic gas'],
  'square-bookmark': ['photo album', 'scrapbook', 'gallery', 'music collection', 'record', 'vinyl'],
  'align-center-horizontal': ['horizontal alignment', 'centered horizontally', 'middle'],
  'align-center-vertical': ['vertical alignment', 'centered vertically', 'middle'],
};

// Keep saved aliases valid while browsing and searching each renamed icon once.
export const ICON_SEARCH_ALIASES: Record<string, string> = {
  'alarm-check': 'alarm-clock-check',
  'alarm-minus': 'alarm-clock-minus',
  'alarm-plus': 'alarm-clock-plus',
  album: 'square-bookmark',
  'book-marked': 'book-bookmark',
  'building-2': 'building-complex',
  music: 'eighth-notes',
  'music-2': 'eighth-note',
  'music-3': 'half-note',
  'music-4': 'sixteenth-notes',
};
