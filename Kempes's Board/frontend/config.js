// ── SUPABASE CONNECTION ───────────────────────────────────────────
export const SUPABASE_URL = 'https://bgzquygijfaiovzbyhdc.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_OOg55V4zSkKRSf1Y4KHZKQ_-ZZ72RV6';

// ── ADMIN ─────────────────────────────────────────────────────────
export const ADMIN_PASSWORD = 'cuo8FPJy8nmvbzgeBwMk';
export const ADMIN_LS_KEY   = 'cork_admin_unlocked';

// ── PIN COLOURS ───────────────────────────────────────────────────
export const PINS = [
  { id: 'red',    bg: '#e05050' },
  { id: 'orange', bg: '#f08030' },
  { id: 'yellow', bg: '#f0c030' },
  { id: 'green',  bg: '#50b870' },
  { id: 'blue',   bg: '#4090e0' },
  { id: 'purple', bg: '#9060d0' },
  { id: 'pink',   bg: '#e060a0' },
  { id: 'white',  bg: '#f0ece4' },
];

// ── NOTE COLOUR CLASSES ───────────────────────────────────────────
export const NOTE_CLS = [
  'note-y', 'note-p', 'note-b', 'note-g',
  'note-o', 'note-r', 'note-m', 'note-t',
];

// ── CHARACTER LIMITS ──────────────────────────────────────────────
export const MAX_NOTE_CHARS    = 100;
export const MAX_CAPTION_CHARS = 30;

// ── IMAGE COMPRESSION ─────────────────────────────────────────────
export const COMPRESS_MAX_WIDTH = 400;
export const COMPRESS_QUALITY   = 0.78;

// ── CONFIG DEFAULTS (used if Supabase row is missing) ─────────────
export const CFG_DEFAULTS = {
  max_notes:          30,
  max_photos:         15,
  reset_interval_sec: 3600,
  msg_lifetime_sec:   3600,
  next_reset:         null,
};
