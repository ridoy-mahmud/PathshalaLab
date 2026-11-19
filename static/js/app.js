// Pathshala exam engine — vanilla ESM, offline-tolerant.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const API = '/api';
let token = localStorage.getItem('pathshala_token') || '';
let state = { subjects: [], topics: [], exam: null, answers: {}, idx: 0, timer: null, startedAt: 0, mode: 'practice' };
let flaggedQuestionIds = new Set();
let bankOffset = 0, bankLimit = 12, bankTotal = 0;

const t = k => ({ explanation:'ব্যাখ্যা', score:'স্কোর' }[k] || k);

/* ---------- small reliability helpers ---------- */
const toAsciiDigits = s => String(s ?? '').replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d));
const fieldErr = (id, msg) => { const el = $('#' + id); if (!el) return; el.textContent = msg || ''; const input = el.closest('.field')?.querySelector('.input'); if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false'); };
const validPhone = p => /^01\d{9}$/.test(p);
const readNum = (id, min, max, fallback) => { const n = Number($('#' + id)?.value); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; };

// Prevents double-submission and gives visible "working" feedback.
async function once(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true; btn.classList.add('is-loading');
  try { return await fn(); }
  finally { btn.disabled = false; btn.classList.remove('is-loading'); }
}

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 2800);
}
async function api(path, opts = {}) {
  const headers = { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let res;
  try { res = await fetch(API + path, { ...opts, headers }); }
  catch { throw new Error('সংযোগ নেই। ইন্টারনেট চেক করে আবার চেষ্টা করুন।'); }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 503 || res.status >= 500) throw new Error('সার্ভারে সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।');
    if (res.status === 401) throw new Error('সেশনের মেয়াদ শেষ। আবার লগইন করুন।');
    throw new Error(text || ('অনুরোধ ব্যর্থ (HTTP ' + res.status + ')'));
  }
  return res.json();
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtNum = n => new Intl.NumberFormat('bn-BD').format(Number(n) || 0);

// Short synthesized cues keep this offline-friendly and avoid extra audio assets.
let soundEnabled = localStorage.getItem('pathshala_sound') !== 'off';
let audioContext = null;
let timerCueExamId = null;
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const soundCues = {
  timerStart:   [{ hz:587, at:0,    len:.09 }, { hz:784, at:.12, len:.14 }],
  questionStart:[{ hz:523, at:0,    len:.10 }],
  questionEnd:  [{ hz:659, at:0,    len:.07 }, { hz:784, at:.09, len:.11 }],
  timerEnd:     [{ hz:587, at:0,    len:.13 }, { hz:440, at:.16, len:.15 }, { hz:330, at:.34, len:.24 }],
  submit:       [{ hz:523, at:0,    len:.11 }, { hz:659, at:.12, len:.12 }, { hz:784, at:.25, len:.18 }],
};
function unlockAudio() {
  if (!soundEnabled || !AudioContextClass) return Promise.resolve();
  try {
    audioContext ||= new AudioContextClass();
    return audioContext.state === 'suspended' ? audioContext.resume().catch(() => {}) : Promise.resolve();
  } catch { return Promise.resolve(); }
}
function playCue(name) {
  if (!soundEnabled || !soundCues[name]) return;
  unlockAudio().then(() => {
    if (!soundEnabled || !audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    for (const note of soundCues[name]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = start + note.at;
      oscillator.type = name === 'timerEnd' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(note.hz, at);
      gain.gain.setValueAtTime(.0001, at);
      gain.gain.linearRampToValueAtTime(name === 'timerEnd' ? .045 : .038, at + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, at + note.len);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + note.len + .015);
    }
  }).catch(() => {});
}
function paintSoundControl() {
  const button = $('#soundBtn');
  if (!button) return;
  const waves = soundEnabled
    ? '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'
    : '<path d="m16 9 5 6m0-6-5 6"/>';
  button.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${waves}</svg>`;
  button.setAttribute('aria-pressed', String(soundEnabled));
  button.setAttribute('aria-label', soundEnabled ? 'শব্দ বন্ধ করুন' : 'শব্দ চালু করুন');
  button.dataset.tip = soundEnabled ? 'শব্দ চালু' : 'শব্দ বন্ধ';
}
paintSoundControl();
$('#soundBtn').onclick = () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem('pathshala_sound', soundEnabled ? 'on' : 'off');
  paintSoundControl();
  if (soundEnabled) { unlockAudio(); playCue('questionStart'); }
};
document.addEventListener('pointerdown', unlockAudio, { once:true, capture:true });
document.addEventListener('keydown', unlockAudio, { once:true, capture:true });

// A small, self-contained MCQ sample makes the exam interaction tangible
// before visitors enter the full exam flow.
const demoQuestions = [
  { prompt:'বাংলা ভাষার আদি নিদর্শন কোনটি?', options:['শ্রীকৃষ্ণকীর্তন','চর্যাপদ','মঙ্গলকাব্য'], answer:1, why:'চর্যাপদ বাংলা ভাষা ও সাহিত্যের প্রাচীনতম নিদর্শন।' },
  { prompt:'বাংলা সাহিত্যের প্রথম সার্থক উপন্যাস কোনটি?', options:['দুর্গেশনন্দিনী','আলালের ঘরের দুলাল','কপালকুণ্ডলা'], answer:0, why:'বঙ্কিমচন্দ্র চট্টোপাধ্যায়ের দুর্গেশনন্দিনী (১৮৬৫) প্রথম সার্থক বাংলা উপন্যাস।' },
  { prompt:'‘বিদ্রোহী’ কবিতার রচয়িতা কে?', options:['জীবনানন্দ দাশ','কাজী নজরুল ইসলাম','সুকান্ত ভট্টাচার্য'], answer:1, why:'কাজী নজরুল ইসলামের ‘বিদ্রোহী’ কবিতা ১৯২২ সালে প্রকাশিত হয়।' },
];
function initHeroDemo() {
  const card = $('.demo-paper');
  if (!card) return;
  let index = 0, answered = false;
  const paint = () => {
    const q = demoQuestions[index];
    $('#demoQuestion').textContent = q.prompt;
    $('#demoCount').textContent = `${fmtNum(index + 1)} / ${fmtNum(demoQuestions.length)}`;
    $('#demoProgress').style.width = `${((index + 1) / demoQuestions.length) * 100}%`;
    $('#demoFeedback').textContent = 'একটি উত্তর বেছে নিন—সাথে সাথে ব্যাখ্যা দেখুন।';
    $('#demoFeedback').className = 'demo-feedback';
    $$('.demo-option', card).forEach((button, i) => {
      button.querySelector('span:nth-child(2)').textContent = q.options[i];
      button.disabled = false;
      button.classList.remove('is-correct', 'is-wrong');
      button.setAttribute('aria-pressed', 'false');
    });
    $('#demoNext').disabled = true;
    $('#demoNext').textContent = index === demoQuestions.length - 1 ? 'আবার দেখুন' : 'পরের প্রশ্ন →';
    answered = false;
  };
  $$('.demo-option', card).forEach(button => button.addEventListener('click', () => {
    if (answered) return;
    answered = true;
    const q = demoQuestions[index], selected = Number(button.dataset.demoAnswer);
    const correct = selected === q.answer;
    $$('.demo-option', card).forEach(option => {
      const right = Number(option.dataset.demoAnswer) === q.answer;
      option.disabled = true;
      option.setAttribute('aria-pressed', String(option === button));
      if (right) option.classList.add('is-correct');
      else if (option === button) option.classList.add('is-wrong');
    });
    const feedback = $('#demoFeedback');
    feedback.className = `demo-feedback ${correct ? 'is-correct' : 'is-wrong'}`;
    feedback.textContent = `${correct ? 'সঠিক উত্তর। ' : 'সঠিক উত্তর: ' + q.options[q.answer] + '। '}${q.why}`;
    $('#demoNext').disabled = false;
  }));
  $('#demoNext').addEventListener('click', () => { index = (index + 1) % demoQuestions.length; paint(); });
  paint();
}
initHeroDemo();

// ---------- theme ----------
const THEME_ICON = {
  dark: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  light: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = dark ? '#1b1c24' : '#F0EAFB';
  document.querySelectorAll('[data-theme-logo]').forEach(img => {
    img.src = '/icons/logo-aubergine.svg?v=2';
  });
  const b = $('#themeBtn');
  b.innerHTML = dark ? THEME_ICON.light : THEME_ICON.dark;
  b.setAttribute('aria-label', dark ? 'হালকা থিমে যান' : 'অন্ধকার থিমে যান');
  b.dataset.tip = dark ? 'হালকা থিম' : 'অন্ধকার থিম';
  const f = $('#footerTheme');
  if (f) { f.innerHTML = b.innerHTML; f.setAttribute('aria-label', b.getAttribute('aria-label')); f.dataset.tip = b.dataset.tip; }
  localStorage.setItem('pathshala_theme', dark ? 'dark' : 'light');
}
const _forceTheme = new URLSearchParams(location.search).get('theme');
applyTheme(_forceTheme ? _forceTheme === 'dark' : localStorage.getItem('pathshala_theme') !== 'light');
const toggleTheme = () => applyTheme(!document.documentElement.classList.contains('dark'));
$('#themeBtn').onclick = toggleTheme;
$('#footerTheme').onclick = toggleTheme;
$('#toTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });

// ---------- global question, subject and topic search ----------
const searchModal = $('#searchModal'), searchInput = $('#globalSearch'), searchResults = $('#searchResults');
let searchTimer = null, searchRequest = 0;
function renderSearchResults(query, topics, subjects, questions) {
  const term = query.toLocaleLowerCase();
  const matches = [
    ...subjects.filter(x => `${x.name_bn} ${x.name_en}`.toLocaleLowerCase().includes(term))
      .slice(0, 3).map(x => ({ kind: 'subject', id: x.id, title: x.name_bn, detail: 'বিষয় · ' + fmtNum(x.count) + ' প্রশ্ন' })),
    ...topics.filter(x => x.name.toLocaleLowerCase().includes(term))
      .slice(0, 5).map(x => ({ kind: 'topic', id: x.id, title: x.name, detail: 'টপিক · ' + fmtNum(x.count) + ' প্রশ্ন' })),
    ...questions.map(x => ({ kind: 'question', id: x.id, title: x.prompt, detail: `${x.subject_bn} · ${x.topic_name}` })),
  ];
  searchResults.innerHTML = matches.length ? matches.map(x => `<button class="search-result" type="button" role="option" data-search-kind="${x.kind}" data-search-id="${x.id}"><span class="search-result-title">${esc(x.title)}</span><span class="search-result-detail">${esc(x.detail)}</span></button>`).join('') : '<p class="meta">কোনো ফলাফল পাওয়া যায়নি। অন্য শব্দ দিয়ে খুঁজুন।</p>';
}
async function searchEverywhere(query) {
  const request = ++searchRequest;
  if (!query) { searchResults.innerHTML = '<p class="meta">প্রশ্ন, বিষয় বা টপিক খুঁজতে লিখুন।</p>'; return; }
  if (query.trim().length < 2) { searchResults.innerHTML = '<p class="meta">আরও অক্ষর লিখুন…</p>'; return; }
  searchResults.innerHTML = '<p class="meta">খোঁজা হচ্ছে…</p>';
  try {
    const [subjects, topics, questions] = await Promise.all([
      state.subjects.length ? state.subjects : api('/subjects'),
      state.topics.length ? state.topics : api('/topics'),
      api('/questions?q=' + encodeURIComponent(query.trim()) + '&limit=8'),
    ]);
    state.subjects = subjects; state.topics = topics;
    if (request === searchRequest) renderSearchResults(query.trim(), topics, subjects, questions);
  } catch (e) {
    if (request === searchRequest) searchResults.innerHTML = `<p class="meta">${esc(e.message)}</p>`;
  }
}
$('#searchBtn').onclick = () => openModal(searchModal);
$('#searchClose').onclick = () => closeModal(searchModal);
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchEverywhere(searchInput.value.trim()), 220);
});
searchResults.addEventListener('click', async e => {
  const item = e.target.closest('[data-search-kind]'); if (!item) return;
  const { searchKind: kind, searchId: id } = item.dataset;
  closeModal(searchModal);
  if (kind === 'question') return startDeepLink({ quick: id });
  if (kind === 'topic') {
    const topic = state.topics.find(x => x.id === +id);
    return beginExam({ token, mode: 'practice', title: topic ? topic.name : 'টপিক প্র্যাকটিস', subject_ids: topic ? [topic.subject_id] : [], topic_ids: [+id], n: 20, duration_min: 20, negative: 0.5 });
  }
  const subject = state.subjects.find(x => x.id === +id);
  return beginExam({ token, mode: 'practice', title: subject ? subject.name_bn : 'বিষয়ভিত্তিক', subject_ids: [+id], topic_ids: [], n: 20, duration_min: 20, negative: 0.5 });
});
searchModal.addEventListener('modalclose', () => { searchInput.value = ''; searchResults.innerHTML = '<p class="meta">প্রশ্ন, বিষয় বা টপিক খুঁজতে লিখুন।</p>'; });
// ---------- routing ----------
function go(view) {
  // Keep old analytics deep links working after analytics moved onto the dashboard.
  if (view === 'analytics') view = 'dashboard';
  $$('.view').forEach(v => v.classList.add('hidden'));
  const el = $('#view-' + view);
  if (el) {
    el.classList.remove('hidden'); el.classList.add('animate-in');
    // Move assistive-tech focus to the new view's heading.
    const heading = el.querySelector('h1, h2');
    if (heading) { heading.setAttribute('tabindex', '-1'); setTimeout(() => heading.focus({ preventScroll: true }), 0); }
  }
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  const flaggedNav = $('#flaggedNavBtn');
  flaggedNav.classList.toggle('active', view === 'flagged');
  if (view === 'flagged') flaggedNav.setAttribute('aria-current', 'page');
  else flaggedNav.removeAttribute('aria-current');
  const activeTab = $('#mobileNav .nav-btn.active');
  if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'dashboard') loadDashboard();
  if (view === 'setup') loadSetup();
  if (view === 'review') loadReview();
  if (view === 'random') loadRandom();
  if (view === 'bookmarks') loadBookmarks();
  if (view === 'flagged') { refreshFlaggedIds(); loadFlagged(); }
}

// Loader helpers
function showLoader(text = 'লোড হচ্ছে…') {
  const el = $('#loader'); if (!el) return;
  $('#loaderText').textContent = text;
  el.style.opacity = '1'; el.style.pointerEvents = 'auto'; el.classList.remove('hidden');
}
function hideLoader() {
  const el = $('#loader'); if (!el) return;
  el.style.opacity = '0'; el.style.pointerEvents = 'none';
  setTimeout(() => el.classList.add('hidden'), 500);
}

// Render $...$ math with KaTeX when available.
function math(el) {
  if (!el || typeof katex === 'undefined') return;
  el.innerHTML = el.innerHTML.replace(/\$([^$]{1,300})\$/g, (m, tex) => {
    try { return katex.renderToString(tex, { throwOnError: false, displayMode: false }); }
    catch { return m; }
  });
}
function mathAll(root = document) { $$('.mathzone', root).forEach(math); }

// Reveal data bars only when their content is actually painted.
function animateBars(root = document) {
  requestAnimationFrame(() => $$('.bar-fill, .meter > span', root).forEach(el => {
    const target = el.dataset.w || el.style.width;
    if (!target) return;
    el.style.width = '0%';
    requestAnimationFrame(() => { el.style.width = target; });
  }));
}
// Animated stat counters
function countUp() {
  $$('.stat-value').forEach(el => {
    const target = +el.dataset.count; if (!target || el._done) return; el._done = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = target.toLocaleString('bn-BD'); return; }
    const dur = 900, t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / dur);
      const val = Math.round(target * (1 - Math.pow(1 - p, 3)));
      el.textContent = val.toLocaleString('bn-BD');
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go);
  const flag = e.target.closest('[data-flag-question]');
  if (flag) { e.preventDefault(); toggleQuestionFlag(Number(flag.dataset.flagQuestion), flag); }
});

// ---------- login ----------
function renderUser() {
  // Login is optional: guests can take exams and see questions.
  $('#userArea').textContent = token ? '' : 'গেস্ট মোড';
  $('#loginBtn').textContent = token ? 'লগআউট' : 'লগইন';
}
const setToken = tk => { token = tk; localStorage.setItem('pathshala_token', tk); renderUser(); };

// ---------- dialog system: trap, Escape, outside click, focus restoration ----------
const CHROME = () => [$('header.topbar'), $('#mobileNav'), $('#main')].filter(Boolean);
let _openModal = null, _modalReturnFocus = null;

function openModal(el) {
  if (!el || _openModal === el) return;
  _modalReturnFocus = document.activeElement;
  el.hidden = false; el.classList.remove('is-closing');
  document.body.classList.add('modal-open');
  CHROME().forEach(n => { n.inert = true; });
  _openModal = el;
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    requestAnimationFrame(() => {
      const f = el.querySelector('[data-autofocus]') || el.querySelector('input, button');
      if (f) { try { f.focus({ preventScroll: true }); } catch { f.focus(); } }
    });
  });
}
function closeModal(el, immediate = false) {
  if (!el || el.hidden) return;
  const finish = () => {
    el.hidden = true; el.classList.remove('is-open', 'is-closing');
    el.dispatchEvent(new CustomEvent('modalclose'));
    if (_openModal === el) _openModal = null;
    if (!_openModal) {
      document.body.classList.remove('modal-open');
      CHROME().forEach(n => { n.inert = false; });
      if (_modalReturnFocus && _modalReturnFocus.focus) {
        try { _modalReturnFocus.focus({ preventScroll: true }); } catch { _modalReturnFocus.focus(); }
      }
      _modalReturnFocus = null;
    }
  };
  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  el.classList.add('is-closing');
  setTimeout(finish, 170);
}
document.addEventListener('keydown', e => {
  const m = _openModal; if (!m) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(m); return; }
  if (e.key !== 'Tab') return;
  const f = $$('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])', m)
    .filter(x => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!m.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) closeModal(m); }));
function confirmDialog({ title, message, okText = 'জমা দিন' }) {
  return new Promise(resolve => {
    const m = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmDesc').textContent = message;
    $('#confirmOk').textContent = okText;
    const onDismiss = () => resolve(false);
    m.addEventListener('modalclose', onDismiss, { once: true });
    const done = v => {
      m.removeEventListener('modalclose', onDismiss);
      $('#confirmOk').onclick = null; $('#confirmCancel').onclick = null;
      closeModal(m); resolve(v);
    };
    $('#confirmOk').onclick = () => done(true);
    $('#confirmCancel').onclick = () => done(false);
    openModal(m);
  });
}

function openLogin() { fieldErr('phoneError', ''); openModal($('#loginModal')); }
function closeLogin() { closeModal($('#loginModal')); }
$('#loginBtn').onclick = () => {
  if (token) { setToken(''); toast('গেস্ট মোডে ফিরে গেছি'); loadDashboard(); }
  else openLogin();
};
$('#closeLogin').onclick = closeLogin;
$('#examInfoBtn').onclick = () => openModal($('#infoModal'));
$('#infoClose').onclick = () => closeModal($('#infoModal'));
$('#loginPhone').addEventListener('input', () => fieldErr('phoneError', ''));
$('#doLogin').onclick = () => once($('#doLogin'), async () => {
  const phone = toAsciiDigits($('#loginPhone').value.trim());
  if (!phone) { fieldErr('phoneError', 'মোবাইল নম্বর দিন।'); $('#loginPhone').focus(); return; }
  if (!validPhone(phone)) { fieldErr('phoneError', 'নম্বরটি ১১ ডিজিটের হতে হবে এবং ০১ দিয়ে শুরু হতে হবে।'); $('#loginPhone').focus(); return; }
  try {
    const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone, name: $('#loginName').value.trim() }) });
    setToken(r.token); closeLogin(); toast('স্বাগতম!'); loadDashboard();
  } catch (e) { toast('লগইন ব্যর্থ: ' + e.message); }
});
renderUser();

// ---------- icon system (authored SVG, one stroke weight) ----------
const ICO = {
  random:'<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M4 4l5 5M15 15l6 6"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  calc:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  brain:'<path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 1 5 3 3 0 0 0 4 3V3z"/><path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-1 5 3 3 0 0 1-4 3V3z"/>',
  book:'<path d="M12 6c-2-2-5-2-8-1v14c3-1 6-1 8 1 2-2 5-2 8-1V5c-3-1-6-1-8 1z"/><path d="M12 6v14"/>',
  pen:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  flag:'<path d="M5 21V4"/><path d="M5 5h12l-2 4 2 4H5"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/>',
  atom:'<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5M15 1v5M9 18v5M15 18v5M1 9h5M1 15h5M18 9h5M18 15h5"/>',
  map:'<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  news:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 9h6M7 13h10M7 17h10"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-2.3 6.2"/><path d="M20 4v7h-7"/>',
  bookmark:'<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>'
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[n] || ICO.info}</svg>`;
// Fill authored SVG icons used by static (About) content.
$$('[data-ico]').forEach(el => { el.innerHTML = ico(el.dataset.ico); });

// ---------- dashboard ----------
let _dashRevealed = false;
async function loadDashboard() {
  if (!_dashRevealed) {
    _dashRevealed = true;
    const view = $('#view-dashboard');
    view.classList.add('dash-reveal');
    setTimeout(() => view.classList.remove('dash-reveal'), 900);
  }
  try {
    const [s, st] = await Promise.all([api('/subjects'), api('/stats')]);
    state.subjects = s;
    $('#statsGrid').innerHTML = [
      ['মোট প্রশ্ন', st.total], ['যাচাইকৃত', st.verified], ['সংশোধিত উত্তর', st.answers_corrected], ['বিষয়', s.length],
    ].map(([k, v]) => `<div class="stat"><div class="stat-label">${k}</div><div class="stat-value num" data-count="${v}">0</div></div>`).join('');
    countUp();

    $('#quickActions').innerHTML = [
      ['random','এলোমেলো প্রশ্ন','সব বিষয় থেকে ১০/২০/৫০ প্রশ্ন','random'],
      ['list','ব্লুপ্রিন্ট মক','BPSC ওজন অনুযায়ী ১০০ প্রশ্ন','blueprint'],
      ['book','সংরক্ষিত প্রশ্ন','আগের গুরুত্বপূর্ণ প্রশ্ন দেখুন','bookmarks'],
      ['flag','Flagged MCQs','ভুল বা ত্রুটিপূর্ণ প্রশ্নগুলো দেখুন','flagged'],
    ].map(([ic,title,hint,view]) => `<button data-go="${view}" class="action-row">
      <span class="ai">${ico(ic)}</span><span><span class="at">${title}</span><span class="ah">${hint}</span></span>
      <span class="ar">${ico('arrow')}</span></button>`).join('');

    const SUB_ICO = {
      'mathematical-reasoning':'calc','mental-ability':'brain','english':'book','bangla':'pen',
      'bangladesh-affairs':'flag','international-affairs':'globe','general-science':'atom',
      'computer-and-ict':'cpu','geography-and-environment':'map','current-affairs':'news'
    };
    $('#subjectGrid').innerHTML = s.map(x => `
      <button data-sid="${x.id}" class="subject-row" aria-label="${esc(x.name_bn)} — ${fmtNum(x.count)} প্রশ্ন দিয়ে শুরু করুন">
        <span class="si">${ico(SUB_ICO[x.slug] || 'book')}</span>
        <span class="min-w-0"><span class="sn">${esc(x.name_bn)}</span><span class="sc">${fmtNum(x.count)} প্রশ্ন</span></span>
        <span class="sa">${ico('arrow')}</span>
      </button>`).join('');
    $$('#subjectGrid [data-sid]').forEach(b => b.onclick = () => startDeepLink({ subject: b.dataset.sid }));
    loadBlueprint();
    const ex = await api('/exams');
    $('#recentExams').innerHTML = ex.exams.length ? `<div class="divider-list">${ex.exams.slice(0, 5).map(e => `
      <div class="divider-row">
        <span class="min-w-0">${esc(e.title)} <span class="meta">· ${e.n} প্রশ্ন</span></span>
        <span class="font-semibold num">${e.score == null ? 'চলছে' : Number(e.score).toFixed(2)}</span>
      </div>`).join('')}</div>` : 'এখনো কোনো পরীক্ষা দেননি।';
    await loadAnalytics();
  } catch (e) { toast(e.message); }
}

// ---------- setup ----------
function toggleChip(btn) {
  const on = !btn.classList.contains('chip-on');
  btn.classList.toggle('chip-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  return on;
}
async function loadSetup() {
  if (!state.subjects.length) state.subjects = await api('/subjects');
  $('#setupSubjects').innerHTML = state.subjects.map(s => `<button data-s="${s.id}" class="chip" aria-pressed="false">${esc(s.name_bn)}</button>`).join('');
  $$('#setupSubjects [data-s]').forEach(b => b.onclick = () => { toggleChip(b); updateSummary(); });
  const ts = await api('/topics'); state.topics = ts;
  $('#setupTopic').innerHTML = '<option value="">সব টপিক</option>' + ts.slice(0, 150).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  updateSummary();
}
function selectSubject(id) { const b = $(`#setupSubjects [data-s="${id}"]`); if (b && !b.classList.contains('chip-on')) toggleChip(b); updateSummary(); }
$$('#modePick .chip').forEach(b => b.onclick = () => {
  $$('#modePick .chip').forEach(x => { x.classList.remove('chip-on'); x.setAttribute('aria-pressed', 'false'); });
  b.classList.add('chip-on'); b.setAttribute('aria-pressed', 'true');
  state.mode = b.dataset.mode; updateSummary();
});
['setupN','setupDur','setupNeg','setupTopic'].forEach(id => $('#' + id).addEventListener('input', () => {
  fieldErr('setupNErr', ''); fieldErr('setupDurErr', ''); fieldErr('setupNegErr', ''); updateSummary();
}));
function selSubjects() { return $$('#setupSubjects .chip-on').map(b => +b.dataset.s); }
function updateSummary() {
  const n = readNum('setupN', 5, 200, 20), d = readNum('setupDur', 1, 180, 20), neg = readNum('setupNeg', 0, 2, 0.5);
  const rows = [
    ['ধরন', state.mode === 'model' ? 'মডেল টেস্ট' : state.mode === 'section' ? 'সেকশনাল' : 'প্র্যাকটিস'],
    ['প্রশ্ন', `${n} টি`], ['সময়', `${d} মিনিট`],
    ['স্কোর', `সঠিকে +১ · ভুলে −${neg}`], ['বিষয়', selSubjects().length ? `${selSubjects().length}টি বছানো` : 'সব'],
  ];
  $('#setupSummary').innerHTML = rows.map(([k, v]) => `<div class="flex justify-between gap-3 border-b border-[var(--line)] pb-1"><dt class="meta">${k}</dt><dd class="font-semibold text-end">${v}</dd></div>`).join('');
}
function validateSetup() {
  let ok = true;
  const checks = [
    ['setupN', 5, 200, 'setupNErr', 'প্রশ্ন সংখ্যা ৫ থেকে ২০০ এর মধ্যে দিন।'],
    ['setupDur', 1, 180, 'setupDurErr', 'সময় ১ থেকে ১৮০ মিনিটের মধ্যে দিন।'],
    ['setupNeg', 0, 2, 'setupNegErr', 'নেগেটিভ মার্ক ০ থেকে ২ এর মধ্যে দিন।'],
  ];
  for (const [id, min, max, errId, msg] of checks) {
    const raw = $('#' + id).value.trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < min || n > max) { fieldErr(errId, msg); ok = false; }
    else fieldErr(errId, '');
  }
  if (!ok) toast('সেটিংস ঠিক করে আবার চেষ্টা করুন।');
  return ok;
}
/* An in-progress exam survives a refresh or an interrupted tab. */
const EXAM_KEY = 'pathshala_exam_state';
function saveExamState() {
  if (!state.exam) return;
  try { localStorage.setItem(EXAM_KEY, JSON.stringify({
    exam: state.exam, answers: state.answers, idx: state.idx,
    startedAt: state.startedAt, mode: state.mode, title: state.title || ''
  })); } catch { /* storage disabled — exam still works in memory */ }
}
function clearExamState() { try { localStorage.removeItem(EXAM_KEY); } catch {} }
function restoreExamState() {
  try {
    const raw = localStorage.getItem(EXAM_KEY); if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.exam || !Array.isArray(s.exam.questions) || !s.exam.questions.length) { clearExamState(); return false; }
    if (s.exam.duration - Math.floor((Date.now() - s.startedAt) / 1000) <= 0) { clearExamState(); return false; }
    state.exam = s.exam; state.answers = s.answers || {};
    state.idx = Math.min(Math.max(s.idx || 0, 0), s.exam.questions.length - 1);
    state.startedAt = s.startedAt; state.mode = s.mode || 'practice'; state.title = s.title || '';
    return true;
  } catch { clearExamState(); return false; }
}
window.addEventListener('beforeunload', e => {
  if (state.exam && !state.submitting) { e.preventDefault(); e.returnValue = ''; }
});

async function beginExam(payload) {
  showLoader('প্রশ্ন লোড হচ্ছে…');
  try {
    const r = await api('/exams/start', { method: 'POST', body: JSON.stringify(payload) });
    state.exam = { id: r.exam_id, questions: r.questions, duration: r.duration_secs, negative: r.negative };
    state.answers = {}; state.idx = 0; state.startedAt = Date.now();
    state.mode = payload.mode; state.title = payload.title || '';
    saveExamState();
    go('exam'); renderQuestion(); startTimer();
  } catch (e) { toast(e.message); }
  finally { hideLoader(); }
}
$('#startExam').onclick = () => once($('#startExam'), () => {
  if (!validateSetup()) return;
  return beginExam({
    token, mode: state.mode, title: state.mode === 'model' ? 'মডেল টেস্ট' : 'প্র্যাকটিস',
    subject_ids: selSubjects(), topic_ids: $('#setupTopic').value ? [+$('#setupTopic').value] : [],
    n: readNum('setupN', 5, 200, 20), duration_min: readNum('setupDur', 1, 180, 20),
    negative: readNum('setupNeg', 0, 2, 0.5),
  });
});

// Deep links: /app?topic=ID  or  /app?subject=ID  → open that MCQ set directly
async function startDeepLink(p) {
  if (p.quick) {
    showLoader('প্রশ্ন লোড হচ্ছে…');
    try {
      const r = await api('/exams/single/' + p.quick, { method:'POST' });
      state.exam = { id:r.exam_id, questions:r.questions, duration:r.duration_secs, negative:r.negative };
      state.answers={}; state.idx=0; state.startedAt=Date.now(); state.mode='practice'; state.title='একক প্রশ্ন';
      saveExamState();
      go('exam'); renderQuestion(); startTimer();
    } catch(e) { toast(e.message); }
    finally { hideLoader(); }
    return;
  }
  if (p.topic) {
    const ts = state.topics.length ? state.topics : await api('/topics');
    const t = ts.find(x => x.id === +p.topic);
    toast('টপিক: ' + (t ? t.name : 'নির্বাচিত') + ' — প্রশ্ন লোড হচ্ছে…');
    return beginExam({ token, mode:'practice', title: t ? t.name : 'টপিক প্র্যাকটিস',
      subject_ids: t ? [t.subject_id] : [], topic_ids: [+p.topic], n: 20, duration_min: 20, negative: 0.5 });
  }
  if (p.subject) {
    const ss = state.subjects.length ? state.subjects : await api('/subjects');
    const s = ss.find(x => x.id === +p.subject);
    toast('বিষয়: ' + (s ? s.name_bn : 'নির্বাচিত') + ' — প্রশ্ন লোড হচ্ছে…');
    return beginExam({ token, mode:'practice', title: s ? s.name_bn : 'বিষয়ভিত্তিক',
      subject_ids: [+p.subject], topic_ids: [], n: 20, duration_min: 20, negative: 0.5 });
  }
  if (p.view) go(p.view);
}

// ---------- exam engine ----------
function startTimer() {
  clearInterval(state.timer);
  const examCueId = String(state.exam.id);
  if (timerCueExamId !== examCueId) { timerCueExamId = examCueId; playCue('timerStart'); }
  const box = $('#timerBox'), wrap = box.closest('.timer');
  const paint = left => {
    box.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    wrap.classList.toggle('low', left < 60);
  };
  paint(Math.max(0, state.exam.duration - Math.floor((Date.now() - state.startedAt) / 1000)));
  state.timer = setInterval(() => {
    const left = state.exam.duration - Math.floor((Date.now() - state.startedAt) / 1000);
    if (left <= 0) { clearInterval(state.timer); paint(0); playCue('timerEnd'); toast('সময় শেষ — উত্তর জমা হচ্ছে।'); submitExam(true); return; }
    paint(left);
    if (left % 30 === 0) wrap.setAttribute('aria-label', `বাকি সময় ${Math.floor(left / 60)} মিনিট ${left % 60} সেকেন্ড`);
  }, 1000);
}
let activeQuestionCueKey = null;
let activeQuestionFinished = false;
function renderQuestion() {
  const ex = state.exam, q = ex.questions[state.idx];
  if (!q) return;
  $('#prevQ').disabled = state.idx === 0;
  $('#nextQ').disabled = state.idx === ex.questions.length - 1;
  const cueKey = `${ex.id}:${q.id}`;
  if (cueKey !== activeQuestionCueKey) {
    if (activeQuestionCueKey && !activeQuestionFinished) playCue('questionEnd');
    activeQuestionCueKey = cueKey;
    activeQuestionFinished = state.answers[q.id] !== undefined && state.answers[q.id] !== null;
    playCue('questionStart');
  }
  $('#examTitle').textContent = state.title || (state.mode === 'model' ? 'মডেল টেস্ট' : 'প্র্যাকটিস');
  $('#examMeta').textContent = `প্রশ্ন ${state.idx + 1} / ${ex.questions.length} · ${q.subject_bn} · ${q.topic_name}`;
  const sel = state.answers[q.id];
  $('#questionCard').innerHTML = `
    <div class="q-crumb">${esc(q.subject_bn)} › ${esc(q.topic_name)}</div>
    <h2 class="q-prompt mathzone">${esc(q.prompt)}</h2>
    <div class="q-options mathzone" id="opts" role="radiogroup" aria-label="উত্তর বেছে নিন">
      ${q.options.map((o, i) => `<button class="question-option ${sel === i ? 'sel' : ''}" data-i="${i}" role="radio" aria-checked="${sel === i ? 'true' : 'false'}">
        <span class="opt-key" aria-hidden="true">${i + 1}</span><span class="min-w-0 wrap-anywhere">${esc(o)}</span></button>`).join('')}
    </div>
    <div class="question-flag-row">
      <button id="flagQuestion" class="question-flag" type="button" aria-pressed="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 5h12l-2 4 2 4H5"/></svg>
        <span>প্রশ্নে সমস্যা জানান</span>
      </button>
      <span class="meta">ভুল উত্তর, বানান বা ভাঙা প্রশ্ন—পরে ঠিক করার জন্য জমা হবে</span>
    </div>`;
  paintFlagButton(q.id);
  $('#flagQuestion').dataset.flagQuestion = q.id;
  math($('#questionCard h2')); math($('#opts'));
  $$('#opts .question-option').forEach(b => b.onclick = () => answer(+b.dataset.i));
  renderPalette();
}
function updateProgress() {
  if (!state.exam) return;
  const qs = state.exam.questions;
  const answered = qs.filter(q => typeof state.answers[q.id] === 'number').length;
  const pct = qs.length ? Math.round(answered / qs.length * 100) : 0;
  const fill = $('#examProgress'); if (fill) fill.style.width = pct + '%';
  const track = $('#progressTrack'); if (track) track.setAttribute('aria-valuenow', pct);
  const label = $('#progressLabel'); if (label) label.textContent = `${fmtNum(answered)}/${fmtNum(qs.length)} উত্তর দিয়েছেন`;
}
function renderPalette() {
  const ex = state.exam;
  $('#palette').innerHTML = ex.questions.map((q, i) => {
    const a = state.answers[q.id];
    const cls = a === undefined ? '' : a === null ? 'skipped' : 'answered';
    const label = a === undefined ? 'এখনো দেখেননি' : a === null ? 'স্কিপ করা' : 'উত্তর দিয়েছেন';
    return `<button class="palette-btn ${i === state.idx ? 'current ' : ''}${cls}" data-i="${i}"
      aria-label="প্রশ্ন ${i + 1}, ${label}" ${i === state.idx ? 'aria-current="true"' : ''}>${i + 1}</button>`;
  }).join('');
  $$('#palette button').forEach(b => b.onclick = () => { state.idx = +b.dataset.i; saveExamState(); renderQuestion(); });
  updateProgress();
}
async function answer(i) {
  const ex = state.exam, q = ex.questions[state.idx];
  const answeredBefore = typeof state.answers[q.id] === 'number';
  state.answers[q.id] = i;
  if (!answeredBefore) { activeQuestionFinished = true; playCue('questionEnd'); }
  saveExamState();
  renderQuestion();
  // Answers must be persisted for guests too — otherwise /submit sees no selections.
  api(`/exams/${ex.id}/answer`, { method: 'POST', body: JSON.stringify({ token, question_id: q.id, selected: i, time_ms: Date.now() }) }).catch(() => {});
  if (state.mode !== 'model') { /* practice: immediate feedback locally when result known via /submit later */ }
}
$('#nextQ').onclick = () => { if (state.exam && state.idx < state.exam.questions.length - 1) { state.idx++; saveExamState(); renderQuestion(); } };
$('#prevQ').onclick = () => { if (state.exam && state.idx > 0) { state.idx--; saveExamState(); renderQuestion(); } };
document.addEventListener('keydown', e => {
  if ($('#view-exam').classList.contains('hidden')) return;
  if (/^[1-4]$/.test(e.key)) answer(+e.key - 1);
  if (e.key === 'ArrowRight') $('#nextQ').click();
  if (e.key === 'ArrowLeft') $('#prevQ').click();
});
$('#submitExam').onclick = () => submitExam();
async function submitExam(force = false) {
  if (!state.exam || state.submitting || state.confirming) return;
  const ex = state.exam;
  const btn = $('#submitExam');
  const unanswered = ex.questions.filter(q => state.answers[q.id] === undefined || state.answers[q.id] === null).length;

  // A calm, explicit confirmation replaces the double-press guard.
  if (!force && unanswered > 0) {
    state.confirming = true;
    let ok = false;
    try {
      ok = await confirmDialog({
        title: 'জমা দিন?',
        message: `${unanswered}টি প্রশ্নের উত্তর দেননি। বাকিগুলো স্কিপ করে এখনই জমা দিতে চান?`,
        okText: 'জমা দিন',
      });
    } finally { state.confirming = false; }
    if (!ok) return;
  }

  state.submitting = true;
  clearInterval(state.timer);
  btn.disabled = true; btn.classList.add('is-loading');
  try {
    const r = await api(`/exams/${ex.id}/submit`, { method: 'POST' });
    playCue('submit');
    const pct = r.total ? (r.correct / r.total * 100) : 0;
    $('#resultHead').innerHTML = `<div class="card result-card">
      <div class="result-top">
        <div><div class="meta">${t('score')} · মোট ${r.total} প্রশ্ন</div>
          <div class="score-value num ${pct >= 60 ? 'good' : 'low'}">${r.score.toFixed(2)}</div></div>
        <div class="result-grade num">${Math.round(pct)}%</div>
      </div>
      <div class="tally-grid" role="group" aria-label="ফলাফলের বিবরণ">
        <div class="tally-box ok"><span class="tally-num num">${r.correct}</span><span class="tally-label">সঠিক উত্তর</span></div>
        <div class="tally-box bad"><span class="tally-num num">${r.wrong}</span><span class="tally-label">ভুল</span></div>
        <div class="tally-box neutral"><span class="tally-num num">${r.skipped}</span><span class="tally-label">স্কিপ</span></div>
      </div>
      <div class="meter" role="img" aria-label="${Math.round(pct)} শতাংশ সঠিক"><span data-w="${pct}%" style="width:0%"></span></div>
    </div>`;
    animateBars($('#resultHead'));
    $('#resultItems').innerHTML = r.items.map((it, i) => `<article class="result-item">
      <div class="meta">${i + 1}. ${esc(it.subject_bn)} › ${esc(it.topic_name)}</div>
      <h3 class="h3 mathzone">${esc(it.prompt)}</h3>
      <div class="verdict ${it.is_correct ? 'ok' : 'bad'}">
        ${it.is_correct ? '✓ সঠিক উত্তর' : `✕ আপনি: ${it.selected == null ? 'স্কিপ' : esc(it.options[it.selected])} · সঠিক: ${esc(it.options[it.answer])}`}
      </div>
      ${it.explanation && it.explanation !== 'বইয়ে দেওয়া উত্তর।' ? `<div class="explanation mathzone"><b>${t('explanation')}:</b> ${esc(it.explanation)}</div>` : ''}
      <div class="flex flex-wrap gap-4 mt-2">
        <button class="grade action-link" data-id="${it.question_id}">${ico('refresh')} স্মার্ট রিভিউতে যোগ করুন</button>
        <button class="bm action-link amber" data-id="${it.question_id}">${ico('bookmark')} <span class="bm-label">সংরক্ষণ করুন</span></button>
      </div>
    </article>`).join('');
    mathAll($('#resultItems'));
    $$('.grade').forEach(b => b.onclick = async () => {
      try { await api('/review/grade', { method:'POST', body: JSON.stringify({ token, question_id:+b.dataset.id, grade:4 }) }); toast('রিভিউতে যোগ করা হয়েছে'); b.remove(); }
      catch (e) { toast(e.message); }
    });
    $$('.bm').forEach(b => b.onclick = async () => {
      try { const x = await api('/bookmark/' + b.dataset.id, { method: 'POST' }); $('.bm-label', b).textContent = x.saved ? 'সংরক্ষিত' : 'সংরক্ষণ করুন'; }
      catch (e) { toast(e.message); }
    });
    state.exam = null; state.submitting = false; clearExamState();
    btn.textContent = 'জমা দিন'; btn.disabled = false; btn.classList.remove('is-loading');
    go('result');
  } catch (e) {
    state.submitting = false; btn.textContent = 'জমা দিন'; btn.disabled = false; btn.classList.remove('is-loading');
    toast(e.message);
    if (ex.duration - Math.floor((Date.now() - state.startedAt) / 1000) > 0) startTimer();
  }
}

// ---------- spaced repetition review ----------
async function loadReview() {
  try {
    const r = await api('/review/due');
    $('#reviewList').innerHTML = r.due.length ? r.due.map(q => `<article class="card" data-id="${q.id}">
      <div class="meta">${esc(q.subject)} › ${esc(q.topic)} · ${q.interval} দিন অন্তর</div>
      <h2 class="h3 mathzone mt-2">${esc(q.prompt)}</h2>
      <p class="text-sm mt-2" style="color:var(--success)">✓ ${esc(q.options[0])}</p>
      <div class="flex flex-wrap gap-2 mt-3">
        ${[[1,'আবার দেখুন','১ দিন'],[3,'মনে আছে','৩ দিন'],[5,'সহজ','৫ দিন']].map(([g,label,days]) => `<button data-g="${g}" class="grade2 btn-ghost !text-xs">${label} <span class="meta">· ${days}</span></button>`).join('')}
      </div></article>`).join('') : `<div class="empty"><h2 class="h3">আজ পর্যালোচনা করার মতো কিছু নেই</h2>
        <p>পরীক্ষায় ভুল হওয়া প্রশ্নগুলো স্বয়ংক্রিয়ভাবে এখানে যোগ হবে।</p>
        <button data-go="setup" class="btn-primary">পরীক্ষা দিন</button></div>`;
    $$('.grade2').forEach(b => b.onclick = async () => {
      const card = b.closest('article');
      try {
        await api('/review/grade', { method:'POST', body: JSON.stringify({ token, question_id:+card.dataset.id, grade:+b.dataset.g }) });
        card.remove(); toast('রিভিউ আপডেট হয়েছে');
      } catch (e) { toast(e.message); }
    });
  } catch (e) { toast(e.message); }
}

// ---------- RANDOM MCQ ----------
let rndSubject = null, rndN = 20;
async function loadRandom() {
  if (!state.subjects.length) state.subjects = await api('/subjects');
  $('#randomSubjects').innerHTML = `<button data-rs="" class="chip chip-on" aria-pressed="true">সব বিষয়</button>` +
    state.subjects.map(s => `<button data-rs="${s.id}" class="chip" aria-pressed="false">${esc(s.name_bn)}</button>`).join('');
  $$('#randomSubjects [data-rs]').forEach(b => b.onclick = () => {
    $$('#randomSubjects [data-rs]').forEach(x => { x.classList.remove('chip-on'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('chip-on'); b.setAttribute('aria-pressed', 'true'); rndSubject = b.dataset.rs || null;
  });
  $('#rndCounts').innerHTML = [10,20,50].map(n => `<button data-n="${n}" class="chip rnd-n ${n===20?'chip-on':''}" aria-pressed="${n===20}">${n} টি</button>`).join('');
  $$('.rnd-n').forEach(b => b.onclick = () => {
    $$('.rnd-n').forEach(x => { x.classList.remove('chip-on'); x.setAttribute('aria-pressed', 'false'); });
    b.classList.add('chip-on'); b.setAttribute('aria-pressed', 'true'); rndN = +b.dataset.n;
  });
  $('#randomStart').onclick = () => once($('#randomStart'), () => beginExam({ token, mode:'practice', title:'এলোমেলো প্রশ্ন',
    subject_ids: rndSubject ? [+rndSubject] : [], topic_ids: [], n: rndN, duration_min: Math.max(5, rndN), negative: 0.5 }));
  try {
    const quick = await api('/questions/random?n=10');
    $('#quickTen').innerHTML = quick.map((q,i) => `<article class="card quickq-item">
      <button class="quickq-open text-start" type="button" data-id="${q.id}">
        <div class="meta">${i+1}. ${esc(q.subject_bn)}</div>
        <div class="text-sm mt-1 mathzone">${esc(q.prompt)}</div>
      </button>
      <button class="question-flag quickq-flag" type="button" data-flag-question="${q.id}" aria-label="এই MCQ Flagged MCQs-এ রাখুন" aria-pressed="false">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 5h12l-2 4 2 4H5"/></svg>
      </button>
    </article>`).join('');
    mathAll($('#quickTen'));
    $$('.quickq-open').forEach(b => b.onclick = () => startDeepLink({ quick: b.dataset.id }));
    quick.forEach(q => paintFlagButton(q.id));
  } catch (e) { $('#quickTen').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
}

// ---------- BCS BLUEPRINT ----------
async function loadBlueprint() {
  const W = [['গাণিতিক যুক্তি',7.5],['মানসিক দক্ষতা',7.5],['ইংরেজি',17.5],['বাংলা',17.5],
    ['বাংলাদেশ বিষয়াবলি',15],['আন্তর্জাতিক বিষয়াবলি',10],['সাধারণ বিজ্ঞান',7.5],
    ['কম্পিউটার ও আইসিটি',7.5],['ভূগোল ও পরিবেশ',5],['সাম্প্রতিক',5]];
  $('#blueprintWeights').innerHTML = W.map(([n,w]) => `<div class="bar-row text-sm">
    <span class="font-medium">${n}</span>
    <span class="bar-track"><span class="bar-fill mid" data-w="${w*4}%" style="display:block;width:0%"></span></span>
    <span class="num text-end font-semibold">${w}%</span></div>`).join('');
  animateBars($('#blueprintWeights'));
  $('#bpStart').onclick = () => once($('#bpStart'), async () => {
    const n = readNum('bpN', 20, 200, 100), dur = readNum('bpDur', 10, 240, 120);
    showLoader('ব্লুপ্রিন্ট মক তৈরি হচ্ছে…');
    try {
      const r = await api('/exams/blueprint', { method:'POST', body: JSON.stringify({ token, n, duration_min: dur }) });
      state.exam = { id:r.exam_id, questions:r.questions, duration:r.duration_secs, negative:r.negative };
      state.answers={}; state.idx=0; state.startedAt=Date.now(); state.mode='model'; state.title='ব্লুপ্রিন্ট মক টেস্ট';
      saveExamState();
      go('exam'); renderQuestion(); startTimer();
    } catch(e) { toast(e.message); }
    finally { hideLoader(); }
  });
}

// ---------- ANALYTICS ----------
async function loadAnalytics() {
  try {
    const d = await api('/analytics');
    const meta = s => s.pct >= 70 ? ['good', 'ভালো'] : s.pct >= 40 ? ['mid', 'মাঝারি'] : ['low', 'দুর্বল'];
    $('#analyticsBody').innerHTML = `<div class="card mb-5">
      <div class="meta">মোট পরীক্ষা</div><div class="stat-value num mt-1">${fmtNum(d.exams)}</div>
      <p class="meta mt-2">প্রতিটি পরীক্ষার পর বিষয়ভিত্তিক নিখুঁততা এখানে যোগ হয়।</p></div>
      ${d.subjects.length ? `<div class="card grid gap-3">
        ${d.subjects.map(s => { const [tone, word] = meta(s); return `<div class="bar-row">
          <div class="text-sm font-semibold">${esc(s.subject)}</div>
          <div class="bar-track"><span class="bar-fill ${tone}" data-w="${s.pct}%" style="display:block;width:0%"></span></div>
          <div class="num text-end font-bold">${s.pct.toFixed(0)}%</div>
          <div class="meta text-end">${word} · ${s.correct}/${s.attempted}</div>
        </div>`; }).join('')}
        <p class="meta border-t pt-3" style="border-color:var(--line)">রঙের পাশাপাশি প্রতিটি সারিতে অবস্থার লেখাও দেওয়া হয়েছে।</p>
      </div>` : `<div class="empty"><h2 class="h3">এখনো কোনো ফলাফল নেই</h2>
        <p>একটি পরীক্ষা দিলেই বিষয়ভিত্তিক নিখুঁততা এখানে দেখা যাবে।</p>
        <button data-go="setup" class="btn-primary">পরীক্ষা দিন</button></div>`}`;
    animateBars($('#analyticsBody'));
  } catch(e) { toast(e.message); }
}

// ---------- BOOKMARKS ----------
async function loadBookmarks() {
  try {
    const d = await api('/bookmarks');
    $('#bookmarkList').innerHTML = d.bookmarks.length ? d.bookmarks.map(b => `<article class="card">
      <div class="meta">${esc(b.subject)} › ${esc(b.topic)}</div>
      <h2 class="h3 mathzone mt-1">${esc(b.prompt)}</h2>
      <div class="text-sm mt-2" style="color:var(--success)">✓ ${esc(b.options[b.answer])}</div>
      ${b.explanation && b.explanation !== 'বইয়ে দেওয়া উত্তর।' ? `<p class="copy text-sm mt-2 mathzone">${esc(b.explanation)}</p>` : ''}
      <div class="bookmark-actions">
        <button class="bmdel action-link" style="color:var(--danger)" data-id="${b.id}">সংরক্ষণ বাতিল করুন</button>
        <button class="question-flag" type="button" data-flag-question="${b.id}" aria-label="এই MCQ Flagged MCQs-এ রাখুন" aria-pressed="false">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 5h12l-2 4 2 4H5"/></svg><span>সমস্যা flag করুন</span>
        </button>
      </div>
    </article>`).join('') : `<div class="empty"><h2 class="h3">কোনো সংরক্ষিত প্রশ্ন নেই</h2>
      <p>পরীক্ষার ফলাফলে “সংরক্ষণ করুন” চাপ দিলে প্রশ্নটি এখানে যোগ হবে।</p>
      <button data-go="setup" class="btn-primary">পরীক্ষা দিন</button></div>`;
    mathAll($('#bookmarkList'));
    d.bookmarks.forEach(b => paintFlagButton(b.id));
    $$('.bmdel').forEach(x => x.onclick = async () => {
      try { await api('/bookmark/' + x.dataset.id, { method:'POST' }); x.closest('article').remove(); toast('সংরক্ষণ বাতিল করা হয়েছে'); }
      catch (e) { toast(e.message); }
    });
  } catch(e) { toast(e.message); }
}

// ---------- FLAGGED MCQS ----------
let flaggedStatus = 'open', flaggedOffset = 0, flaggedTerm = '', flaggedTotal = 0;
const FLAGGED_PAGE_SIZE = 40;
function paintFlagButton(id) {
  const marked = flaggedQuestionIds.has(Number(id));
  $$(`[data-flag-question="${Number(id)}"]`).forEach(b => {
    b.classList.toggle('is-flagged', marked);
    b.setAttribute('aria-pressed', String(marked));
    const label = b.querySelector('span');
    if (label) label.textContent = marked ? 'Flagged MCQs-এ আছে · সরিয়ে দিন' : 'প্রশ্নে সমস্যা জানান';
    b.setAttribute('aria-label', marked ? 'এই MCQ Flagged MCQs থেকে সরান' : 'এই MCQ Flagged MCQs-এ রাখুন');
  });
}
async function refreshFlaggedIds() {
  try {
    const r = await api('/flagged/ids');
    flaggedQuestionIds = new Set(r.question_ids.map(Number));
    if (state.exam?.questions?.[state.idx]) paintFlagButton(state.exam.questions[state.idx].id);
  } catch { /* The flag action remains available if the list cannot load. */ }
}
async function toggleQuestionFlag(id, button) {
  button.disabled = true;
  try {
    if (flaggedQuestionIds.has(Number(id))) {
      await api('/flagged/' + id, { method:'DELETE' });
      flaggedQuestionIds.delete(Number(id));
      toast('Flagged MCQs তালিকা থেকে সরানো হয়েছে।');
    } else {
      await api('/flagged', { method:'POST', body:JSON.stringify({ question_id:id, issue_type:'needs_review' }) });
      flaggedQuestionIds.add(Number(id));
      toast('Flagged MCQs-এ জমা হয়েছে।');
    }
    paintFlagButton(id);
  } catch (e) { toast(e.message, 'err'); }
  finally { button.disabled = false; }
}
function flaggedIssueLabel(type) {
  return ({
    verification_unrecoverable:'প্রশ্ন বা উত্তর যাচাই দরকার', broken_math_option:'গণিতের অপশন ভাঙা',
    image_alt_artifact_in_option:'অপশনে ছবি-সংক্রান্ত ত্রুটি', empty_or_tiny_stem:'প্রশ্ন অসম্পূর্ণ',
    empty_option:'অপশন খালি', wrong_answer:'উত্তর ভুল', wrong_category:'ক্যাটাগরি ভুল', spelling:'বানান ভুল',
    broken_question:'প্রশ্ন ভাঙা', other:'অন্য সমস্যা', needs_review:'পর্যালোচনা দরকার'
  })[type] || type;
}
function flaggedCard(item) {
  const answer = item.answer == null ? '' : String(item.answer);
  const issueTypes = ['needs_review','wrong_answer','wrong_category','spelling','broken_question','other'];
  if (!issueTypes.includes(item.issue_type)) issueTypes.unshift(item.issue_type);
  const needsCategory = item.issue_type === 'wrong_category';
  return `<article class="card flagged-item" data-flagged-id="${item.id}">
    <div class="flagged-item-head">
      <div class="min-w-0">
        <div class="meta">MCQ #${fmtNum(item.question_id)} · ${esc(item.subject || 'বিষয় নেই')}${item.topic ? ` › ${esc(item.topic)}` : ''}</div>
        <h2 class="h3 mt-1">${esc(flaggedIssueLabel(item.issue_type))}</h2>
      </div>
      <span class="flagged-origin">${item.origin === 'quarantine' ? 'আগের ত্রুটিপূর্ণ প্রশ্ন' : 'আপনার flag'}</span>
    </div>
    ${item.expected_category ? `<p class="flagged-category-note">সঠিক ক্যাটাগরি হিসেবে বেছে রাখা হয়েছে: <strong>${esc(item.expected_category)}</strong></p>` : ''}
    ${item.reason ? `<details class="flagged-reason"><summary>সমস্যার বিবরণ</summary><p>${esc(item.reason)}</p></details>` : ''}
    <div class="flagged-editor">
      <label class="lbl" for="flag-prompt-${item.id}">প্রশ্ন</label>
      <textarea id="flag-prompt-${item.id}" class="input flag-prompt" rows="3">${esc(item.prompt)}</textarea>
      <div class="flagged-option-grid">
        ${item.options.map((o,i) => `<label class="flagged-option"><span class="lbl">অপশন ${fmtNum(i+1)}</span><textarea class="input flag-option" rows="2">${esc(o)}</textarea></label>`).join('')}
      </div>
      <label class="lbl" for="flag-answer-${item.id}">সঠিক উত্তর (জানা থাকলে)</label>
      <select id="flag-answer-${item.id}" class="input flag-answer">
        <option value="" ${answer === '' ? 'selected' : ''}>জানা নেই</option>
        ${item.options.map((o,i) => `<option value="${i}" ${answer === String(i) ? 'selected' : ''}>${fmtNum(i+1)} · ${esc(o || 'খালি অপশন')}</option>`).join('')}
      </select>
      <label class="lbl mt-3" for="flag-type-${item.id}">সমস্যার ধরন</label>
      <select id="flag-type-${item.id}" class="input flag-type">
        ${issueTypes.map(type => `<option value="${esc(type)}" ${type === item.issue_type ? 'selected' : ''}>${esc(flaggedIssueLabel(type))}</option>`).join('')}
      </select>
      <div class="flag-category-field" ${needsCategory ? '' : 'hidden'}>
        <label class="lbl mt-3" for="flag-category-${item.id}">সঠিক ক্যাটাগরি</label>
        <select id="flag-category-${item.id}" class="input flag-category">
          <option value="">কোন ক্যাটাগরিতে যাবে বেছে নিন</option>
          <option value="0" ${Number(item.expected_category_id) === 0 ? 'selected' : ''}>সাধারণ জ্ঞান (GK)</option>
          ${state.subjects.map(subject => `<option value="${subject.id}" ${Number(item.expected_category_id) === subject.id ? 'selected' : ''}>${esc(subject.name_bn)}</option>`).join('')}
        </select>
        <span class="hint">যেমন: মানসিক দক্ষতার প্রশ্নটি আসলে সাধারণ জ্ঞানের হলে, সাধারণ জ্ঞান বেছে নিন।</span>
      </div>
      <label class="lbl mt-3" for="flag-explanation-${item.id}">ব্যাখ্যা / সংশোধনের নোট</label>
      <textarea id="flag-explanation-${item.id}" class="input flag-explanation" rows="3">${esc(item.explanation)}</textarea>
    </div>
    <div class="flagged-item-actions">
      <button class="btn-primary" type="button" data-flag-save="${item.id}">সংশোধন সংরক্ষণ</button>
      ${item.status === 'open'
        ? `<button class="btn-ghost" type="button" data-flag-resolve="${item.id}">সমাধান হয়েছে</button>`
        : `<button class="btn-ghost" type="button" data-flag-reopen="${item.id}">আবার খোলা</button>`}
    </div>
  </article>`;
}
async function loadFlagged(append = false) {
  if (!state.subjects.length) {
    try { state.subjects = await api('/subjects'); }
    catch (e) { toast(e.message, 'err'); }
  }
  if (!append) {
    flaggedOffset = 0;
    $('#flaggedList').innerHTML = '<div class="empty">Flagged MCQs লোড হচ্ছে…</div>';
  }
  const params = new URLSearchParams({ status:flaggedStatus, limit:String(FLAGGED_PAGE_SIZE), offset:String(flaggedOffset) });
  if (flaggedTerm) params.set('q', flaggedTerm);
  try {
    const r = await api('/flagged?' + params.toString());
    if (!append) $('#flaggedList').innerHTML = '';
    if (!r.items.length && !append) {
      $('#flaggedList').innerHTML = `<div class="empty"><h2 class="h3">${flaggedTerm ? 'কোনো মিল পাওয়া যায়নি' : 'এই তালিকায় প্রশ্ন নেই'}</h2><p>${flaggedTerm ? 'অন্য শব্দ দিয়ে খুঁজে দেখুন।' : 'MCQ-তে লাল flag চাপলে সেটি এখানে জমা হবে।'}</p></div>`;
    } else {
      $('#flaggedList').insertAdjacentHTML('beforeend', r.items.map(flaggedCard).join(''));
      mathAll($('#flaggedList'));
    }
    flaggedOffset = r.offset + r.items.length;
    flaggedTotal = r.total;
    $('#flaggedSummary').textContent = `${fmtNum(Math.min(flaggedOffset, flaggedTotal))} / ${fmtNum(flaggedTotal)} টি দেখানো হচ্ছে · আলাদা Flagged MCQs database-এ সংরক্ষিত`;
    $('#flagOpenCount').textContent = fmtNum(r.open);
    $('#flagFixedCount').textContent = fmtNum(r.fixed);
    $('#flaggedMore').hidden = flaggedOffset >= flaggedTotal;
    bindFlaggedActions();
  } catch (e) {
    $('#flaggedList').innerHTML = `<div class="empty"><h2 class="h3">Flagged MCQs লোড করা যায়নি</h2><p>${esc(e.message)}</p><button class="btn-ghost" type="button" id="flaggedRetry">আবার চেষ্টা করুন</button></div>`;
    $('#flaggedRetry').onclick = () => loadFlagged();
  }
}
function bindFlaggedActions() {
  $$('.flag-type').forEach(select => select.onchange = () => {
    const field = select.closest('.flagged-editor').querySelector('.flag-category-field');
    field.hidden = select.value !== 'wrong_category';
  });
  $$('[data-flag-save]').forEach(button => button.onclick = async () => {
    const card = button.closest('.flagged-item');
    const options = $$('.flag-option', card).map(el => el.value.trim());
    const answerValue = $('.flag-answer', card).value;
    try {
      await once(button, () => api('/flagged/' + button.dataset.flagSave, { method:'PUT', body:JSON.stringify({
        prompt:$('.flag-prompt', card).value, options, answer:answerValue === '' ? null : Number(answerValue),
        issue_type:$('.flag-type', card).value, explanation:$('.flag-explanation', card).value,
        expected_category_id:$('.flag-category', card).value === '' ? null : Number($('.flag-category', card).value)
      }) }));
      toast('সংশোধন আলাদা database-এ সংরক্ষিত হয়েছে।');
      await loadFlagged();
    } catch (e) { toast(e.message, 'err'); }
  });
  $$('[data-flag-resolve]').forEach(button => button.onclick = async () => {
    try { await api('/flagged/' + button.dataset.flagResolve + '/resolve', { method:'POST' }); toast('সমাধান হিসেবে চিহ্নিত হয়েছে।'); await loadFlagged(); }
    catch (e) { toast(e.message, 'err'); }
  });
  $$('[data-flag-reopen]').forEach(button => button.onclick = async () => {
    try { await api('/flagged/' + button.dataset.flagReopen + '/reopen', { method:'POST' }); toast('প্রশ্নটি আবার খোলা হয়েছে।'); await loadFlagged(); }
    catch (e) { toast(e.message, 'err'); }
  });
}
$$('[data-flag-status]').forEach(button => button.onclick = () => {
  flaggedStatus = button.dataset.flagStatus;
  $$('[data-flag-status]').forEach(other => { const active = other === button; other.classList.toggle('chip-on', active); other.setAttribute('aria-pressed', String(active)); });
  loadFlagged();
});
$('#flaggedSearchForm').addEventListener('submit', e => { e.preventDefault(); flaggedTerm = $('#flaggedSearch').value.trim(); loadFlagged(); });
$('#flaggedMore').onclick = () => loadFlagged(true);

loadDashboard().finally(() => setTimeout(hideLoader, 350));
refreshFlaggedIds();

// Resume an exam interrupted by a refresh or a closed tab.
if (restoreExamState()) {
  showLoader('আগের পরীক্ষা পুনরুদ্ধার হচ্ছে…');
  setTimeout(() => {
    go('exam'); renderQuestion(); startTimer(); hideLoader();
    toast('আগের পরীক্ষা পুনরুদ্ধার করা হয়েছে।');
  }, 400);
}

// deep links: /app?topic=ID or /app?subject=ID open that MCQ set directly
const _params = new URLSearchParams(location.search);
if (_params.has('topic') || _params.has('subject') || _params.has('view')) {
  setTimeout(() => startDeepLink(Object.fromEntries(_params)), 300);
}

// service worker
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
