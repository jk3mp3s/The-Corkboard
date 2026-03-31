import { SUPABASE_URL, SUPABASE_KEY, NOTE_CLS, COMPRESS_MAX_WIDTH, COMPRESS_QUALITY } from './config.js';

// ── CLIENT ────────────────────────────────────────────────────────
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CONFIG ────────────────────────────────────────────────────────

/**
 * Load the single config row from Supabase.
 * Returns the config object or null on error.
 */
export async function dbLoadConfig() {
  const { data, error } = await sb
    .from('config')
    .select('*')
    .eq('id', 1)
    .single();
  if (error) { console.error('config load:', error); return null; }
  return data;
}

/**
 * Update the config row with a partial object of changed fields.
 * Returns true on success, false on failure.
 */
export async function dbSaveConfig(updates) {
  const { error } = await sb
    .from('config')
    .update(updates)
    .eq('id', 1);
  if (error) { console.error('config save:', error); return false; }
  return true;
}

// ── POSTS ─────────────────────────────────────────────────────────

/**
 * Load all non-expired posts, with photo image data joined in.
 * Returns an array of post objects with expiresAt/postedAt as timestamps.
 */
export async function dbLoadMessages() {
  const now = new Date().toISOString();

  const { data: posts, error } = await sb
    .from('posts')
    .select('*')
    .gt('expires_at', now)
    .order('posted_at', { ascending: true });

  if (error) { console.error('load messages:', error); return []; }

  // Fetch image data for photo posts in one query
  const photoPosts = posts.filter(p => p.type === 'photo');
  const photoMap   = {};
  if (photoPosts.length) {
    const ids = photoPosts.map(p => p.id);
    const { data: photos } = await sb
      .from('photos')
      .select('*')
      .in('post_id', ids);
    if (photos) photos.forEach(ph => photoMap[ph.post_id] = ph.image_data);
  }

  return posts.map(p => ({
    ...p,
    img:       photoMap[p.id] || null,
    expiresAt: new Date(p.expires_at).getTime(),
    postedAt:  new Date(p.posted_at).getTime(),
  }));
}

/**
 * Insert a new text note.
 * Returns true on success, false on failure.
 */
export async function dbPostNote({ text, pinBg, deviceId, msgLifetimeSec, isAdmin }) {
  const expiresAt = new Date(Date.now() + msgLifetimeSec * 1000).toISOString();
  const { error } = await sb.from('posts').insert({
    type:       'note',
    text:       text.trim(),
    pin_bg:     pinBg,
    note_class: NOTE_CLS[Math.floor(Math.random() * NOTE_CLS.length)],
    rotation:   parseFloat((Math.random() * 8 - 4).toFixed(2)),
    device_id:  deviceId,
    expires_at: expiresAt,
    is_admin:   isAdmin || false,
  });
  if (error) { console.error('insert note:', error); return false; }
  return true;
}

/**
 * Insert a new photo post + its image row.
 * Returns true on success, false on failure.
 */
export async function dbPostPhoto({ dataUrl, caption, pinBg, deviceId, msgLifetimeSec, isAdmin }) {
  const compressed = await compressImage(dataUrl, COMPRESS_MAX_WIDTH, COMPRESS_QUALITY);
  const expiresAt  = new Date(Date.now() + msgLifetimeSec * 1000).toISOString();

  const { data: post, error: postErr } = await sb.from('posts').insert({
    type:       'photo',
    caption:    (caption || '').trim().slice(0, 30),
    pin_bg:     pinBg,
    rotation:   parseFloat((Math.random() * 8 - 4).toFixed(2)),
    device_id:  deviceId,
    expires_at: expiresAt,
    is_admin:   isAdmin || false,
  }).select().single();

  if (postErr) { console.error('insert photo post:', postErr); return false; }

  const { error: photoErr } = await sb.from('photos').insert({
    post_id:    post.id,
    image_data: compressed,
  });

  if (photoErr) { console.error('insert photo data:', photoErr); return false; }
  return true;
}

/**
 * Delete all expired posts (called on reset).
 */
export async function dbDeleteExpired() {
  const { error } = await sb
    .from('posts')
    .delete()
    .lt('expires_at', new Date().toISOString());
  if (error) console.error('delete expired:', error);
}

/**
 * Delete ALL posts (used by admin clear board).
 */
export async function dbClearAllPosts() {
  const { error } = await sb
    .from('posts')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) console.error('clear board:', error);
}

// ── REAL-TIME ─────────────────────────────────────────────────────

/**
 * Subscribe to live INSERT/DELETE changes on the posts table.
 * Calls the provided callback whenever the board changes.
 */
export function setupRealtime(onChange) {
  sb.channel('board-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, onChange)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, onChange)
    .subscribe();
}

// ── IMAGE COMPRESSION ─────────────────────────────────────────────

/**
 * Resize and compress an image data URL to a max width, returning a JPEG data URL.
 */
export function compressImage(dataUrl, maxW, quality = 0.78) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}
