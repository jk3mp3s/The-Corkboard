import {
  PINS, NOTE_CLS, MAX_NOTE_CHARS, MAX_CAPTION_CHARS,
  ADMIN_PASSWORD, ADMIN_LS_KEY, CFG_DEFAULTS,
} from './config.js';

import {
  dbLoadConfig, dbSaveConfig,
  dbLoadMessages, dbPostNote, dbPostPhoto,
  dbDeleteExpired, dbClearAllPosts,
  setupRealtime,
} from './supabase.js';

// ── STATE ─────────────────────────────────────────────────────────
let cfg             = { ...CFG_DEFAULTS };
let messages        = [];
let nextReset       = null;
let selectedPinNote  = 'red';
let selectedPinPhoto = 'blue';
let photoDataUrl    = null;
let isAdminUnlocked = false;
let lbItems         = [];
let lbIndex         = 0;

// ── DEVICE ID ────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('cork_device');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('cork_device', id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();

function hasPosted()  { return !!localStorage.getItem('cork_posted_' + (nextReset ? new Date(nextReset).getTime() : 0)); }
function markPosted() { localStorage.setItem('cork_posted_' + (nextReset ? new Date(nextReset).getTime() : 0), '1'); }
function clearPosted(){ Object.keys(localStorage).forEach(k => { if (k.startsWith('cork_posted_')) localStorage.removeItem(k); }); }

// ── ADMIN SESSION ─────────────────────────────────────────────────
function checkAdminSession() {
  isAdminUnlocked = localStorage.getItem(ADMIN_LS_KEY) === '1';
  document.getElementById('adminPostRow').classList.toggle('visible', isAdminUnlocked);
  if (isAdminUnlocked) document.getElementById('adminPanel').classList.add('unlocked');
}

function unlockAdmin() {
  isAdminUnlocked = true;
  localStorage.setItem(ADMIN_LS_KEY, '1');
  document.getElementById('adminPanel').classList.add('unlocked');
  document.getElementById('adminPostRow').classList.add('visible');
}

function lockAdmin() {
  isAdminUnlocked = false;
  localStorage.removeItem(ADMIN_LS_KEY);
  document.getElementById('adminPanel').classList.remove('unlocked', 'open');
  document.getElementById('adminPostRow').classList.remove('visible');
  document.getElementById('adminPostCheck').checked = false;
}

// ── CONFIG ────────────────────────────────────────────────────────
async function loadConfig() {
  const data = await dbLoadConfig();
  if (data) {
    cfg      = data;
    nextReset = data.next_reset ? new Date(data.next_reset).getTime() : null;
  }
  syncAdmin();
}

async function saveConfig(updates) {
  const ok = await dbSaveConfig(updates);
  if (!ok) { showToast('Save failed ✗', 'error'); return false; }
  cfg = { ...cfg, ...updates };
  syncAdmin();
  return true;
}

// ── RESET ────────────────────────────────────────────────────────
async function checkAndHandleReset() {
  const now = Date.now();
  if (!nextReset || now < nextReset) return;
  await dbDeleteExpired();
  const newReset = new Date(now + cfg.reset_interval_sec * 1000).toISOString();
  await saveConfig({ next_reset: newReset });
  nextReset = now + cfg.reset_interval_sec * 1000;
  clearPosted();
}

// ── MESSAGES ─────────────────────────────────────────────────────
async function loadMessages() {
  messages = await dbLoadMessages();
}

// ── POST ──────────────────────────────────────────────────────────
async function postNote(text, pinBg, isAdmin) {
  const notesCount = messages.filter(m => m.type === 'note').length;
  if (notesCount >= cfg.max_notes) { showToast('Note slots are full! 🍂', 'error'); return false; }
  const ok = await dbPostNote({ text, pinBg, deviceId: DEVICE_ID, msgLifetimeSec: cfg.msg_lifetime_sec, isAdmin });
  if (!ok) { showToast('Something went wrong ✗', 'error'); return false; }
  if (!isAdmin) markPosted();
  return true;
}

async function postPhoto(dataUrl, caption, pinBg, isAdmin) {
  const photosCount = messages.filter(m => m.type === 'photo').length;
  if (photosCount >= cfg.max_photos) { showToast('Polaroid slots are full! 📷', 'error'); return false; }
  const ok = await dbPostPhoto({ dataUrl, caption, pinBg, deviceId: DEVICE_ID, msgLifetimeSec: cfg.msg_lifetime_sec, isAdmin });
  if (!ok) { showToast('Something went wrong ✗', 'error'); return false; }
  if (!isAdmin) markPosted();
  return true;
}

// ── HELPERS ───────────────────────────────────────────────────────
function timeFmt(ms) {
  const s = Math.floor(ms / 1000);
  if (s <= 0)   return 'now';
  if (s < 60)   return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ── RENDER HELPERS ────────────────────────────────────────────────
function pinOrRibbon(isFirst, pinBg) {
  if (isFirst) return `<div class="ribbon-wrap"><span class="ribbon-bow">🎀</span><span class="ribbon-tag">FIRST</span></div>`;
  return `<div class="item-pin" style="--pin-bg:${pinBg}"></div>`;
}

// ── RENDER BOARD ──────────────────────────────────────────────────
function renderBoard() {
  const grid = document.getElementById('notesGrid');
  const now  = Date.now();
  const live = messages.filter(m => m.expiresAt > now);
  const notes  = live.filter(m => m.type === 'note');
  const photos = live.filter(m => m.type === 'photo');
  const firstNoteId  = notes.length  ? notes[0].id  : null;
  const firstPhotoId = photos.length ? photos[0].id : null;

  document.getElementById('msgCount').textContent  = live.length + ' item' + (live.length === 1 ? '' : 's') + ' pinned';
  document.getElementById('slotStatus').textContent = '📝 ' + notes.length + '/' + cfg.max_notes + ' · 📷 ' + photos.length + '/' + cfg.max_photos;

  if (!live.length) {
    grid.innerHTML = '<div class="empty-state"><span class="emoji">🍂</span><p>No notes yet — be the first!</p></div>';
    return;
  }

  grid.innerHTML = live.map((m, i) => {
    const isFirst  = (m.type === 'note'  && m.id === firstNoteId) || (m.type === 'photo' && m.id === firstPhotoId);
    const adminCls = m.is_admin ? ' admin-note' : '';
    const top      = pinOrRibbon(isFirst, m.pin_bg);

    if (m.type === 'note') return `
      <div class="note ${m.note_class}${adminCls}" style="--rot:${m.rotation}deg;animation-delay:${i * .04}s"
           onclick="openLightbox('note','${m.id}')">
        ${top}
        <div class="note-lines"></div>
        <div class="note-text">${esc(m.text || '')}</div>
        <div class="note-footer">
          <span class="note-time">${fmtTime(m.postedAt)}</span>
          <span class="note-expire">exp ${timeFmt(m.expiresAt - now)}</span>
        </div>
      </div>`;

    return `
      <div class="polaroid${adminCls}" style="--rot:${m.rotation}deg;animation-delay:${i * .04}s"
           onclick="openLightbox('photo','${m.id}')">
        ${top}
        <img class="polaroid-img" src="${m.img || ''}" alt="photo" loading="lazy">
        ${m.caption
          ? `<div class="polaroid-caption">${esc(m.caption)}</div>`
          : `<div class="polaroid-caption" style="color:#c8b098;font-size:0.85rem">no caption</div>`}
        <div class="polaroid-footer">
          <span class="polaroid-time">${fmtTime(m.postedAt)}</span>
          <span class="polaroid-expire">exp ${timeFmt(m.expiresAt - now)}</span>
        </div>
      </div>`;
  }).join('');
}

// ── UPDATE COMPOSE STATE ──────────────────────────────────────────
function updateCompose() {
  const posted  = hasPosted();
  const isAdmin = isAdminUnlocked && document.getElementById('adminPostCheck').checked;
  const nc = messages.filter(m => m.type === 'note').length;
  const pc = messages.filter(m => m.type === 'photo').length;

  const nb = document.getElementById('postNoteBtn');
  const nn = document.getElementById('noteNotice');
  if (posted && !isAdmin)      { nb.disabled = true;  nb.textContent = 'Posted ✓';    nn.style.display = 'none'; }
  else if (nc >= cfg.max_notes){ nb.disabled = true;  nb.textContent = 'Notes full';  nn.textContent = 'Note slots full!'; nn.style.display = 'block'; }
  else                         { nb.disabled = false; nb.textContent = isAdmin ? '📌 Post as Admin' : 'Pin it!'; nn.style.display = 'none'; }

  const pb = document.getElementById('postPhotoBtn');
  const pn = document.getElementById('photoNotice');
  if (posted && !isAdmin)        { pb.disabled = true;  pb.textContent = 'Posted ✓';    pn.style.display = 'none'; }
  else if (pc >= cfg.max_photos) { pb.disabled = true;  pb.textContent = 'Photos full'; pn.textContent = 'Polaroid slots full!'; pn.style.display = 'block'; }
  else                           { pb.disabled = false; pb.textContent = isAdmin ? '📌 Post as Admin' : 'Pin it!'; pn.style.display = 'none'; }
}

function updateTimer() {
  if (!nextReset) return;
  const d = nextReset - Date.now();
  document.getElementById('resetTimer').textContent = d > 0 ? timeFmt(d) : 'any moment…';
}

// ── LIGHTBOX ─────────────────────────────────────────────────────
window.openLightbox = function(type, id) {
  const now = Date.now();
  lbItems = messages.filter(m => m.type === type && m.expiresAt > now);
  lbIndex = lbItems.findIndex(m => m.id === id);
  if (lbIndex < 0) lbIndex = 0;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
};

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

function renderLightbox() {
  if (!lbItems.length) return;
  const m     = lbItems[lbIndex];
  const now   = Date.now();
  const limit = m.type === 'note' ? cfg.max_notes : cfg.max_photos;
  const posInAll = messages.filter(x => x.type === m.type && x.expiresAt > now).findIndex(x => x.id === m.id) + 1;
  const adminCls = m.is_admin ? ' admin-note' : '';
  const firstOfType = messages.filter(x => x.type === m.type && x.expiresAt > now)[0];
  const isFirst = firstOfType && firstOfType.id === m.id;

  const topEl = isFirst
    ? `<div class="lb-ribbon-wrap"><span class="ribbon-bow" style="font-size:1.8rem">🎀</span><span class="ribbon-tag">FIRST</span></div>`
    : `<div style="position:absolute;top:-14px;left:50%;transform:translateX(-50%);width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 37% 30%,color-mix(in srgb,${m.pin_bg} 55%,white),${m.pin_bg});box-shadow:0 3px 8px rgba(0,0,0,0.38);z-index:5;"></div>`;

  let cardHtml = '';
  if (m.type === 'note') {
    cardHtml = `
      <div class="lb-note ${m.note_class}${adminCls}" style="position:relative">
        ${topEl}
        <div class="note-lines"></div>
        <div class="note-text" style="font-size:1.3rem;padding-top:0.3rem">${esc(m.text || '')}</div>
        <div class="note-footer" style="margin-top:0.8rem">
          <span class="note-time">${fmtTime(m.postedAt)}</span>
          <span class="note-expire">exp ${timeFmt(m.expiresAt - now)}</span>
        </div>
      </div>`;
  } else {
    cardHtml = `
      <div class="lb-polaroid${adminCls}" style="position:relative">
        ${topEl}
        <img src="${m.img || ''}" style="width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">
        ${m.caption ? `<div class="polaroid-caption" style="font-size:1.2rem;margin-top:6px">${esc(m.caption)}</div>` : ''}
        <div class="polaroid-footer" style="margin-top:4px">
          <span class="polaroid-time">${fmtTime(m.postedAt)}</span>
          <span class="polaroid-expire">exp ${timeFmt(m.expiresAt - now)}</span>
        </div>
      </div>`;
  }

  document.getElementById('lbCard').innerHTML = cardHtml + `<button class="lb-close" id="lbCloseBtn">✕</button>`;
  document.getElementById('lbCounter').textContent = (m.type === 'note' ? 'note ' : 'photo ') + posInAll + '/' + limit;
  document.getElementById('lbPrev').disabled = lbIndex === 0;
  document.getElementById('lbNext').disabled = lbIndex === lbItems.length - 1;
  document.getElementById('lbCloseBtn').addEventListener('click', closeLightbox);
}

// ── TABS ─────────────────────────────────────────────────────────
window.switchTab = function(tab) {
  document.getElementById('tabNote').classList.toggle('active',  tab === 'note');
  document.getElementById('tabPhoto').classList.toggle('active', tab === 'photo');
  document.getElementById('panelNote').classList.toggle('active',  tab === 'note');
  document.getElementById('panelPhoto').classList.toggle('active', tab === 'photo');
};

// ── PIN PICKERS ───────────────────────────────────────────────────
function buildPins(containerId, defaultPin, onChange) {
  const wrap = document.getElementById(containerId);
  PINS.forEach(p => {
    const el = document.createElement('div');
    el.className   = 'pin-opt' + (p.id === defaultPin ? ' selected' : '');
    el.style.background = p.bg;
    el.title       = p.id;
    el.dataset.id  = p.id;
    el.addEventListener('click', () => {
      onChange(p.id);
      wrap.querySelectorAll('.pin-opt').forEach(o => o.classList.toggle('selected', o.dataset.id === p.id));
    });
    wrap.appendChild(el);
  });
}

// ── ADMIN UI ──────────────────────────────────────────────────────
function syncAdmin() {
  document.getElementById('cfgMax').value       = cfg.max_notes;
  document.getElementById('cfgMaxPhotos').value = cfg.max_photos;
  document.getElementById('cfgLife').value      = cfg.msg_lifetime_sec;
  const sel = document.getElementById('cfgReset');
  [...sel.options].forEach(o => o.selected = parseInt(o.value) === cfg.reset_interval_sec);
}

// ── EVENT LISTENERS ───────────────────────────────────────────────
function bindEvents() {
  // Char counters
  const msgInput  = document.getElementById('msgInput');
  const charCount = document.getElementById('charCount');
  msgInput.addEventListener('input', () => {
    const l = msgInput.value.length;
    charCount.textContent = l + '/' + MAX_NOTE_CHARS;
    charCount.className = 'char-count' + (l >= MAX_NOTE_CHARS ? ' over' : l >= 80 ? ' warn' : '');
  });

  const captionInput = document.getElementById('captionInput');
  const captionCount = document.getElementById('captionCount');
  captionInput.addEventListener('input', () => {
    const l = captionInput.value.length;
    captionCount.textContent = l + '/' + MAX_CAPTION_CHARS;
    captionCount.className = 'char-count' + (l >= MAX_CAPTION_CHARS ? ' over' : l >= 24 ? ' warn' : '');
  });

  // Admin checkbox
  document.getElementById('adminPostCheck').addEventListener('change', updateCompose);

  // Photo upload
  const cameraInput  = document.getElementById('cameraInput');
  const galleryInput = document.getElementById('galleryInput');
  const uploadArea   = document.getElementById('uploadArea');
  const previewWrap  = document.getElementById('previewWrap');

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      photoDataUrl = e.target.result;
      document.getElementById('photoPreview').src = photoDataUrl;
      uploadArea.style.display  = 'none';
      previewWrap.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  cameraInput.addEventListener('change',  e => handleFile(e.target.files[0]));
  galleryInput.addEventListener('change', e => handleFile(e.target.files[0]));

  [document.getElementById('galleryBtn'), document.getElementById('cameraBtn')].forEach(btn => {
    btn.addEventListener('dragover',  e => { e.preventDefault(); btn.classList.add('dragover'); });
    btn.addEventListener('dragleave', ()  => btn.classList.remove('dragover'));
    btn.addEventListener('drop',      e  => { e.preventDefault(); btn.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
  });

  document.getElementById('removePhoto').addEventListener('click', () => {
    photoDataUrl = null; cameraInput.value = ''; galleryInput.value = '';
    uploadArea.style.display = 'block'; previewWrap.style.display = 'none';
    captionInput.value = ''; captionCount.textContent = '0/' + MAX_CAPTION_CHARS; captionCount.className = 'char-count';
  });

  // Post note
  document.getElementById('postNoteBtn').addEventListener('click', async () => {
    const text = msgInput.value.trim();
    if (text.length < 1) { showToast('Write something first! ✏️', 'error'); return; }
    const isAdmin = isAdminUnlocked && document.getElementById('adminPostCheck').checked;
    const btn = document.getElementById('postNoteBtn'); btn.textContent = 'Pinning…'; btn.disabled = true;
    const pin = PINS.find(p => p.id === selectedPinNote) || PINS[0];
    const ok  = await postNote(text, pin.bg, isAdmin);
    if (ok) {
      msgInput.value = ''; charCount.textContent = '0/' + MAX_NOTE_CHARS; charCount.className = 'char-count';
      await loadMessages(); renderBoard();
      showToast(isAdmin ? 'Admin note pinned! ✨' : 'Note pinned! 📌', 'success');
    }
    updateCompose();
  });

  // Post photo
  document.getElementById('postPhotoBtn').addEventListener('click', async () => {
    if (!photoDataUrl) { showToast('Pick a photo first! 🖼️', 'error'); return; }
    const isAdmin = isAdminUnlocked && document.getElementById('adminPostCheck').checked;
    const btn = document.getElementById('postPhotoBtn'); btn.textContent = 'Pinning…'; btn.disabled = true;
    const pin = PINS.find(p => p.id === selectedPinPhoto) || PINS[4];
    const ok  = await postPhoto(photoDataUrl, captionInput.value, pin.bg, isAdmin);
    if (ok) {
      photoDataUrl = null; cameraInput.value = ''; galleryInput.value = '';
      uploadArea.style.display = 'block'; previewWrap.style.display = 'none';
      captionInput.value = ''; captionCount.textContent = '0/' + MAX_CAPTION_CHARS; captionCount.className = 'char-count';
      await loadMessages(); renderBoard();
      showToast(isAdmin ? 'Admin photo pinned! ✨' : 'Photo pinned! 📷', 'success');
    }
    updateCompose();
  });

  // Admin panel
  document.getElementById('adminToggle').addEventListener('click', () => document.getElementById('adminPanel').classList.toggle('open'));
  document.getElementById('pwSubmit').addEventListener('click', () => {
    if (document.getElementById('pwInput').value === ADMIN_PASSWORD) {
      unlockAdmin(); document.getElementById('pwInput').value = ''; document.getElementById('pwError').style.display = 'none';
    } else { document.getElementById('pwError').style.display = 'block'; }
  });
  document.getElementById('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pwSubmit').click(); });
  document.getElementById('lockBtn').addEventListener('click', lockAdmin);

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const updates = {
      max_notes:          Math.max(1, parseInt(document.getElementById('cfgMax').value)       || 30),
      max_photos:         Math.max(1, parseInt(document.getElementById('cfgMaxPhotos').value) || 15),
      reset_interval_sec: parseInt(document.getElementById('cfgReset').value) || 3600,
      msg_lifetime_sec:   Math.max(60, parseInt(document.getElementById('cfgLife').value)     || 3600),
    };
    const ok = await saveConfig(updates);
    if (ok) { document.getElementById('adminPanel').classList.remove('open'); showToast('Settings saved ✓', 'success'); renderBoard(); updateCompose(); }
  });

  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear the whole board right now?')) return;
    await dbClearAllPosts();
    const newReset = new Date(Date.now() + cfg.reset_interval_sec * 1000).toISOString();
    await saveConfig({ next_reset: newReset });
    nextReset = new Date(newReset).getTime();
    messages = []; clearPosted();
    document.getElementById('adminPanel').classList.remove('open');
    renderBoard(); updateCompose(); showToast('Board cleared 🧹', 'success');
  });

  // Lightbox navigation
  document.getElementById('lbPrev').addEventListener('click', () => { if (lbIndex > 0) { lbIndex--; renderLightbox(); } });
  document.getElementById('lbNext').addEventListener('click', () => { if (lbIndex < lbItems.length - 1) { lbIndex++; renderLightbox(); } });
  document.getElementById('lightbox').addEventListener('click', e => { if (e.target === document.getElementById('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('open')) return;
    if (e.key === 'ArrowLeft'  && lbIndex > 0)                    { lbIndex--; renderLightbox(); }
    if (e.key === 'ArrowRight' && lbIndex < lbItems.length - 1)   { lbIndex++; renderLightbox(); }
    if (e.key === 'Escape') closeLightbox();
  });
}

// ── TOAST ─────────────────────────────────────────────────────────
let toastTmr;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => t.className = 'toast', 2800);
}

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  buildPins('pinOptionsNote',  'red',  id => selectedPinNote  = id);
  buildPins('pinOptionsPhoto', 'blue', id => selectedPinPhoto = id);
  checkAdminSession();
  await loadConfig();
  await checkAndHandleReset();
  await loadMessages();
  renderBoard();
  updateCompose();
  updateTimer();
  setupRealtime(async () => { await loadMessages(); renderBoard(); updateCompose(); });
  setInterval(async () => { await checkAndHandleReset(); updateTimer(); }, 5000);
  setInterval(updateTimer, 1000);
  bindEvents();
}

init();
