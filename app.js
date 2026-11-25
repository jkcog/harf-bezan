// Harf Bezan: say it first, then reveal. No build step; serve this folder statically.

const app = document.getElementById('app');

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return e;
};

// ---------- persistence ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = Object.assign({ blurFin: false, assemble: true, sound: true }, store.get('hb_settings', {}));
const saveSettings = () => store.set('hb_settings', settings);

// ---------- audio ----------
let current = null;
let audioMissing = false;

function stopAudio() { if (current) { current.pause(); current = null; } window.speechSynthesis?.cancel(); }

function play(step) {
  if (!settings.sound || !step?.audio) return;
  stopAudio();
  const a = new Audio(`audio/${step.audio}.mp3`);
  current = a;
  const fallback = () => {
    if (current !== a) return;
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (voices.some(v => v.lang?.toLowerCase().startsWith('fa'))) {
      const u = new SpeechSynthesisUtterance(step.fa);
      u.lang = 'fa-IR';
      speechSynthesis.speak(u);
    } else if (!audioMissing) {
      audioMissing = true;
      render();
    }
  };
  a.addEventListener('error', fallback, { once: true });
  a.play().catch(() => { /* autoplay blocked or file missing: error handler covers missing */ });
}

// ---------- state ----------
const S = {
  view: 'home',      // home | step | done
  lessons: [],
  lesson: null,
  queue: [],
  i: 0,
  phase: 'think',    // think | revealed
  total: 0,
  completed: new Set(),
  missed: new Set(),
  vocab: [],
  bank: [], built: [], hint: false, solvedByBuild: false,
};

async function load() {
  const ids = await (await fetch('lessons/index.json')).json();
  S.lessons = await Promise.all(ids.map(async id => (await fetch(`lessons/${id}.json`)).json()));
  render();
}

function flatten(lesson) {
  const q = [];
  for (const s of lesson.steps) {
    if (s.type === 'review') {
      q.push({ type: 'interlude', id: s.id, say: s.say });
      s.items.forEach(it => q.push({ ...it, type: 'prompt' }));
    } else q.push(s);
  }
  return q;
}

function startLesson(lesson) {
  S.lesson = lesson;
  S.queue = flatten(lesson);
  S.total = S.queue.filter(s => s.type !== 'interlude').length;
  S.completed = new Set();
  S.missed = new Set();
  const seen = new Map();
  for (const s of S.queue) for (const w of s.words || []) seen.set(w.fin, w);
  S.vocab = [...seen.values()];
  S.i = 0;
  S.view = 'step';
  enterStep();
  render();
  autoplayIfTeach();
}

function enterStep() {
  S.phase = 'think'; S.hint = false; S.built = []; S.solvedByBuild = false;
  const step = S.queue[S.i];
  if (step?.type === 'prompt') {
    const answer = step.words.map(w => w.fin);
    const extra = S.vocab.filter(w => !answer.includes(w.fin)).sort(() => Math.random() - 0.5).slice(0, 2);
    const bank = [...step.words, ...extra].map((w, k) => ({ ...w, k }));
    for (let t = 0; t < 10; t++) {
      bank.sort(() => Math.random() - 0.5);
      if (bank.map(b => b.fin).join() !== answer.join()) break;
    }
    S.bank = bank;
  }
}

function autoplayIfTeach() { const s = S.queue[S.i]; if (s?.type === 'teach') play(s); }

function next() {
  stopAudio();
  S.i++;
  if (S.i >= S.queue.length) { finish(); return; }
  enterStep();
  render();
  autoplayIfTeach();
  window.scrollTo(0, 0);
}

function finish() {
  const done = store.get('hb_done', {});
  done[S.lesson.id] = { at: Date.now(), missed: S.missed.size, total: S.total };
  store.set('hb_done', done);
  S.view = 'done';
  render();
}

function rate(step, good) {
  if (good) S.completed.add(step.id);
  else {
    S.missed.add(step.id);
    if (!step.retry) S.queue.push({ ...step, retry: true });
  }
  next();
}

// ---------- views ----------
function legend() {
  return h('div', { class: 'legend' },
    h('span', { style: '--c:var(--neg)' }, 'not (ne-)'),
    h('span', { style: '--c:var(--prefix)' }, 'prefix'),
    h('span', { style: '--c:var(--stem)' }, 'stem'),
    h('span', { style: '--c:var(--ending)' }, 'ending (who)'));
}

function toggle(label, key, after) {
  return h('label', {},
    h('input', { type: 'checkbox', ...(settings[key] ? { checked: true } : {}), onchange: e => { settings[key] = e.target.checked; saveSettings(); after?.(); } }),
    label);
}

function settingsBar() {
  return h('div', { class: 'settings' },
    toggle('Sound', 'sound', () => stopAudio()),
    toggle('Build sentences from blocks', 'assemble', () => { if (S.view === 'step') { enterStep(); } render(); }),
    toggle('Blur transliteration', 'blurFin', () => render()));
}

function wordsView(step, { fullFin = true } = {}) {
  const blur = settings.blurFin;
  const words = step.words.map(w => {
    const parts = w.parts.length ? w.parts : [{ fin: w.fin, role: 'plain', gloss: '' }];
    return h('div', { class: 'word' },
      h('div', { class: 'fa', lang: 'fa', dir: 'rtl' }, w.fa),
      h('div', { class: 'parts' + (blur ? ' blur' : '') }, parts.map(p =>
        h('div', { class: `part role-${p.role}` },
          h('span', { class: 'fin', onclick: e => e.currentTarget.classList.add('show') }, p.fin),
          p.gloss ? h('span', { class: 'gloss' }, p.gloss) : null))));
  });
  return h('div', {},
    h('div', { class: 'words', dir: 'rtl' }, words),
    step.fa.trim().endsWith('؟') ? h('p', { class: 'note' }, '↗ question: let your voice rise at the end') : null,
    fullFin ? h('div', { class: 'fullfin' + (blur ? ' blur-text' : ''), onclick: e => e.currentTarget.classList.add('show') }, step.fin) : null);
}

function topbar() {
  const pct = Math.round(100 * S.completed.size / S.total);
  return h('div', { class: 'top' },
    h('button', { class: 'icon ghost', title: 'Home', onclick: () => { stopAudio(); S.view = 'home'; render(); } }, '←'),
    h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
    h('span', { class: 'hint' }, `${S.completed.size}/${S.total}`));
}

function listenBtn(step) {
  return h('button', { class: 'ghost', onclick: () => play(step) }, '🔊 Listen');
}

function homeView() {
  const done = store.get('hb_done', {});
  const slides = S.lessons.map((l, n) => h('div', { class: 'card lesson' },
    h('div', { class: 'label' }, `Lesson ${n + 1}`),
    h('h2', {}, l.title),
    h('p', { class: 'goal' }, l.goal),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: () => startLesson(l) }, done[l.id] ? 'Do it again' : 'Start'),
      done[l.id] ? h('span', { class: 'badge' }, `✓ completed, ${done[l.id].total - done[l.id].missed}/${done[l.id].total} first time`) : null)));
  const track = h('div', { class: 'carousel' }, slides);

  let active = 0;
  const goTo = (n, smooth) => {
    n = ((n % slides.length) + slides.length) % slides.length;
    slides[n].scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  };
  const dots = S.lessons.map((_, n) => h('button', { class: 'dot', 'aria-label': `Go to lesson ${n + 1}`, onclick: () => goTo(n, true) }));
  const prevBtn = h('button', { class: 'icon ghost', 'aria-label': 'Previous lesson', onclick: () => goTo(active - 1, true) }, '‹');
  const nextBtn = h('button', { class: 'icon ghost', 'aria-label': 'Next lesson', onclick: () => goTo(active + 1, true) }, '›');
  const setActive = n => {
    active = n;
    dots.forEach((d, i) => d.classList.toggle('active', i === n));
    slides.forEach((s, i) => s.classList.toggle('is-active', i === n));
  };
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) setActive(slides.indexOf(e.target)); });
  }, { root: track, threshold: 0.6 });
  slides.forEach(s => io.observe(s));

  const initial = S.lessons.findIndex(l => !done[l.id]);
  const initialIndex = initial < 0 ? slides.length - 1 : initial;
  setActive(initialIndex);
  queueMicrotask(() => goTo(initialIndex, false));

  return h('div', {},
    h('div', { class: 'brand' }, h('h1', {}, 'Harf Bezan'), h('span', { class: 'fa', lang: 'fa' }, 'حرف بزن')),
    h('p', { class: 'tag' }, 'Speak colloquial Persian from the first minute. Say it out loud first, then check.'),
    track,
    h('div', { class: 'carousel-nav' }, prevBtn, h('div', { class: 'dots' }, dots), nextBtn),
    h('div', { class: 'card' }, h('div', { class: 'label' }, 'Colour key'), legend(), h('div', { style: 'height:14px' }), settingsBar()));
}

function teachView(step) {
  return h('div', { class: 'card' },
    step.say ? h('div', { class: 'say' }, step.say) : null,
    h('div', { class: 'label' }, 'In Persian'),
    h('div', { class: 'en' }, step.en),
    wordsView(step),
    step.note ? h('p', { class: 'note' }, step.note) : null,
    h('div', { class: 'actions' }, listenBtn(step),
      h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => { S.completed.add(step.id); next(); } }, 'I said it →')));
}

function interludeView(step) {
  return h('div', { class: 'card' },
    h('div', { class: 'label' }, 'Your turn'),
    h('div', { class: 'say' }, step.say),
    h('div', { class: 'actions' }, h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: next }, 'Start →')));
}

function reveal(step, byBuild) {
  S.phase = 'revealed'; S.solvedByBuild = !!byBuild;
  render();
  play(step);
}

function checkBuild(step, slotsInner) {
  const answer = step.words.map(w => w.fin);
  const got = S.built.map(k => S.bank.find(b => b.k === k).fin);
  if (got.join() === answer.join()) { reveal(step, true); return; }
  slotsInner.classList.add('wrong');
  slotsInner.addEventListener('animationend', () => { S.built = []; render(); }, { once: true });
}

function builder(step) {
  const answer = step.words.map(w => w.fin);
  const full = S.built.length === answer.length;
  const slotsInner = h('div', { class: 'slots-inner' },
    S.built.length ? S.built.map(k => {
      const w = S.bank.find(b => b.k === k);
      return h('button', { class: 'chip', onclick: () => { S.built = S.built.filter(x => x !== k); render(); } },
        h('span', { class: 'f', lang: 'fa' }, w.fa), h('span', { class: 't' }, w.fin));
    }) : h('span', { class: 'ph' }, 'Tap the blocks in order…'));
  const slots = h('div', { class: 'slots' }, slotsInner);
  const bank = h('div', { class: 'bank' }, S.bank.map(w =>
    h('button', {
      class: 'chip' + (S.built.includes(w.k) ? ' used' : ''),
      disabled: S.built.includes(w.k) || full,
      onclick: () => { S.built.push(w.k); render(); },
    }, h('span', { class: 'f', lang: 'fa' }, w.fa), h('span', { class: 't' }, w.fin))));
  return h('div', {}, slots, bank,
    full ? h('div', { class: 'actions' }, h('span', { class: 'grow' }),
      h('button', { class: 'primary btn-balanced', onclick: () => checkBuild(step, slotsInner) }, 'Check')) : null);
}

function promptView(step) {
  const card = h('div', { class: 'card' });
  card.append(
    h('div', { class: 'label' }, step.retry ? 'Once more' : 'Say it in Persian'),
    h('div', { class: 'big' }, step.en.replace(/^How do you say:\s*/i, '').replace(/^Say:\s*/i, '').replace(/\?$/, '')));
  if (S.phase === 'think') {
    if (settings.assemble) card.append(builder(step));
    else card.append(h('p', { class: 'hint' }, 'Say it out loud, then reveal.'));
    if (step.hint) card.append(S.hint ? h('p', { class: 'hint' }, '💡 ' + step.hint) : h('button', { class: 'ghost', onclick: () => { S.hint = true; render(); } }, 'Hint'));
    card.append(h('div', { class: 'actions' }, h('span', { class: 'grow' }),
      h('button', { class: 'primary btn-balanced', onclick: () => reveal(step, false) }, 'Reveal')));
  } else {
    if (S.solvedByBuild) card.append(h('p', { class: 'ok center' }, '✓ Built it'));
    card.append(
      wordsView(step),
      h('div', { class: 'actions' }, listenBtn(step), h('span', { class: 'grow' }),
        h('button', { onclick: () => rate(step, false) }, 'Not yet'),
        h('button', { class: 'good', onclick: () => rate(step, true) }, 'Got it ✓')));
  }
  return card;
}

function doneView() {
  const first = S.total - S.missed.size;
  return h('div', {},
    h('div', { class: 'card center' },
      h('div', { class: 'label' }, 'Lesson complete'),
      h('h2', {}, S.lesson.title),
      h('div', { class: 'stat' }, `${first}/${S.total}`),
      h('p', { class: 'hint' }, 'right first time'),
      h('p', { class: 'goal' }, S.lesson.goal),
      h('div', { class: 'actions', style: 'justify-content:center' },
        h('button', { onclick: () => startLesson(S.lesson) }, 'Do it again'),
        h('button', { class: 'primary', onclick: () => { S.view = 'home'; render(); } }, 'Home'))));
}

function render() {
  app.replaceChildren();
  app.className = `view-${S.view}`;
  if (S.view === 'home') app.append(homeView());
  else if (S.view === 'done') app.append(doneView());
  else {
    const step = S.queue[S.i];
    app.append(topbar(),
      step.type === 'teach' ? teachView(step) : step.type === 'interlude' ? interludeView(step) : promptView(step),
      audioMissing && settings.sound ? h('p', { class: 'warn' }, 'No audio file found. Run scripts/generate_audio.py to create it.') : '',
      legend());
  }
}

document.addEventListener('keydown', e => {
  if (S.view === 'home' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    document.querySelector(`.carousel-nav button:${e.key === 'ArrowLeft' ? 'first-child' : 'last-child'}`)?.click();
    return;
  }
  if (e.key !== 'Enter' || document.activeElement instanceof HTMLButtonElement) return;
  document.querySelector('button.primary')?.click();
});

load().catch(err => {
  app.append(h('div', { class: 'card' }, h('p', {}, 'Could not load lessons. Serve this folder over http (./serve.sh) rather than opening the file directly.'), h('p', { class: 'hint' }, String(err))));
});
