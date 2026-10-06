// Tiny deterministic motion engine: every frame is a pure function of time t (seconds).
// Preview: autoplays + loops. Render: ?render=1 exposes window.__seek(t) for frame capture.
(function () {
  const W = 1920, H = 1080;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const lerp = (a, b, x) => a + (b - a) * x;
  const E = {
    linear: x => x,
    out: x => 1 - Math.pow(1 - x, 3),
    in: x => x * x * x,
    inOut: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outQuint: x => 1 - Math.pow(1 - x, 5),
    outExpo: x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    back: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
    backSoft: x => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };

  // Keyframes: kf(t, [[time, value], [time, value, 'ease'], ...]) — ease applies to the segment ending at that key.
  function kf(t, frames) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1, e] = frames[i], [t0, v0] = frames[i - 1];
      if (t <= t1) return lerp(v0, v1, E[e || 'inOut'](prog(t, t0, t1)));
    }
    return frames[frames.length - 1][1];
  }
  // Envelope: 0 → 1 over [a, a+din], 1 → 0 over [b-dout, b].
  function env(t, a, b, din = 0.4, dout = 0.35) {
    if (t < a || t > b) return 0;
    return Math.min(E.out(prog(t, a, a + din)), 1 - E.in(prog(t, b - dout, b)));
  }

  // Position by center point.
  function S(el, o) {
    const x = o.x || 0, y = o.y || 0, s = o.s == null ? 1 : o.s, r = o.r || 0;
    const sx = o.sx == null ? 1 : o.sx;
    el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${s * sx},${s}) rotate(${r}deg)`;
    if (o.o != null) {
      el.style.opacity = o.o;
      el.style.visibility = o.o <= 0.001 ? 'hidden' : 'visible';
    }
    if (o.blur != null) el.style.filter = o.blur > 0.05 ? `blur(${o.blur}px)` : 'none';
  }
  function h(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function add(parent, html) { const el = h(html); el.classList.add('abs'); parent.appendChild(el); return el; }
  const typed = (str, p) => str.slice(0, Math.round(str.length * clamp(p)));

  // ---------- icons ----------
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg>',
    checkW: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5L19.5 7"/></svg>',
    cursor: '<svg viewBox="0 0 24 24"><path d="M4 2.5l15 9.2-6.6 1.4L16 20.5l-3 1.4-3.6-7.4L4 18.8z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  };

  // ---------- components ----------
  // Caption with per-word reveal. Use *word* for accent highlight.
  function caption(parent, text, cls = '') {
    const html = text.split(' ').map(w => {
      if (w === '/') return '<br>';
      const hl = /^\*.*\*[.,!?…]*$/.test(w), ul = /^_.*_[.,!?…]*$/.test(w);
      const clean = w.replace(/[*_]/g, '');
      const swoosh = ul ? '<svg viewBox="0 0 200 20" preserveAspectRatio="none"><path d="M4 13c38-7 84-10 128-8 22 1 44 3 64 6"/></svg>' : '';
      return `<span class="w${hl || ul ? ' hl' : ''}${ul ? ' u' : ''}">${clean}${swoosh}</span>`;
    }).join(' ').replace(/ <br> /g, '<br>');
    const el = add(parent, `<div class="cap ${cls}">${html}</div>`);
    el._w = [...el.querySelectorAll('.w')];
    return el;
  }
  // Show caption at (x,y) from a to b, words staggered.
  function showCap(el, t, a, b, x, y, opt = {}) {
    const st = opt.stagger ?? 0.07, dur = opt.dur ?? 0.45, dy = opt.dy ?? 40;
    const out = 1 - E.in(prog(t, b - 0.3, b));
    if (t < a || t > b) { S(el, { x, y, o: 0 }); return; }
    S(el, { x, y, o: 1, s: opt.s ?? 1 });
    el._w.forEach((w, i) => {
      const p = E.outQuint(prog(t, a + i * st, a + i * st + dur));
      const u = w._u || (w._u = w.querySelector('svg') || 0);
      if (u) u.style.clipPath = `inset(-50% ${(1 - E.inOut(prog(t, a + i * st + dur * 0.6, a + i * st + dur + 0.45))) * 100}% -50% 0)`;
      w.style.opacity = p * out;
      w.style.transform = `translateY(${(1 - p) * dy - (1 - out) * 20}px)`;
      w.style.filter = p < 0.98 ? `blur(${(1 - p) * 8}px)` : 'none';
    });
  }

  function terminal(parent, title, lines) {
    const body = lines.map(([cls, txt]) => `<div class="tl ${cls}">${txt}</div>`).join('');
    const el = add(parent, `<div class="term"><div class="term-bar"><i></i><i></i><i></i><span>${title}</span></div><div class="term-body">${body}<div class="tl st"></div></div><div class="badge">needs you</div></div>`);
    el._st = el.querySelector('.st'); el._badge = el.querySelector('.badge');
    return el;
  }

  function phone(parent) {
    const bars = Array.from({ length: 26 }, () => '<b></b>').join('');
    const el = add(parent, `<div class="phone"><div class="phone-notch"></div><div class="phone-screen">
      <div class="ph-time">9:41</div>
      <div class="ph-app">Contextli</div>
      <div class="ph-transcript"></div>
      <div class="ph-tag">#claude</div>
      <div class="ph-wave">${bars}</div>
      <div class="ph-ring"></div>
      <div class="ph-mic">${ICON.mic}</div>
      ${[0, 1, 2].map(() => `<div class="ph-notif"><div class="n-top"><div class="n-ic">${ICON.checkW}</div><span>Mail · Claude loop</span><span style="margin-left:auto">now</span></div><div class="n-title"></div><div class="n-body"></div></div>`).join('')}
    </div></div>`);
    el._time = el.querySelector('.ph-time');
    el._tr = el.querySelector('.ph-transcript');
    el._tag = el.querySelector('.ph-tag');
    el._bars = [...el.querySelectorAll('.ph-wave b')];
    el._ring = el.querySelector('.ph-ring');
    el._mic = el.querySelector('.ph-mic');
    el._notifs = [...el.querySelectorAll('.ph-notif')].map(n => ({ n, title: n.querySelector('.n-title'), body: n.querySelector('.n-body') }));
    return el;
  }
  // amp 0..1 = how loud; tp 0..1 typing progress; tag 0..1 tag pop.
  // notifs: [[progress 0..1, title, body], ...] — newest first is pushed to the top.
  function phoneState(ph, t, { text = '', tp = 0, amp = 0, tag = 0, notifs = [], time }) {
    if (time) ph._time.textContent = time;
    const shown = typed(text, tp);
    const caret = tp > 0 && tp < 1 ? '<span class="caret"></span>' : '';
    const html = shown + caret;
    if (ph._tr._h !== html) { ph._tr.innerHTML = html; ph._tr._h = html; }
    ph._tag.style.opacity = clamp(tag * 1.5);
    ph._tag.style.transform = `scale(${0.6 + 0.4 * E.back(clamp(tag))})`;
    ph._bars.forEach((b, i) => {
      const n = Math.abs(Math.sin(t * 9 + i * 0.7) * Math.sin(t * 4.3 + i * 1.9)) * 0.85 + 0.15;
      const env = Math.sin((i + 0.5) / ph._bars.length * Math.PI);
      b.style.height = `${8 + amp * n * env * 80}px`;
      b.style.opacity = 0.35 + amp * 0.65;
    });
    const pulse = (t * 1.4) % 1;
    ph._ring.style.opacity = amp > 0.05 ? (1 - pulse) * 0.6 * amp : 0;
    ph._ring.style.transform = `scale(${1 + pulse * 0.7})`;
    ph._mic.style.transform = `scale(${1 + amp * 0.06 * Math.sin(t * 12)})`;
    ph._notifs.forEach((N, i) => {
      const [p = 0, title = '', body = ''] = notifs[i] || [];
      // stack: each later notification pushes earlier ones down
      const below = notifs.slice(i + 1).reduce((n, x) => n + E.inOut(clamp(x[0] * 2)), 0);
      const np = E.backSoft(clamp(p));
      N.n.style.opacity = clamp(p * 2 - 0.4);
      N.n.style.transform = `translateY(${(1 - np) * -140 + below * 128}px)`;
      N.title.textContent = title; N.body.textContent = body;
    });
  }

  function ticket(parent, id, title) {
    const el = add(parent, `<div class="ticket"><div class="tk-row"><span class="tk-id">${id}</span><span class="tk-tag">#claude</span><span class="tk-status">${ICON.check}<em style="font-style:normal">Queued</em></span></div><div class="tk-title">${title}</div></div>`);
    el._stTxt = el.querySelector('.tk-status em');
    return el;
  }
  function ticketStatus(el, s) {
    if (el._s === s) return; el._s = s;
    el.classList.toggle('working', s === 'working');
    el.classList.toggle('done', s === 'done');
    el._stTxt.textContent = s === 'done' ? 'Done' : s === 'working' ? 'Working' : 'Queued';
  }

  // Loop ring: rot (deg) spins the comet arc; fill 0..1 draws progress.
  function ring(parent, size = 360) {
    const el = add(parent, `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="-200 -200 400 400">
      <circle r="170" fill="#fff" stroke="var(--line)" stroke-width="2"/>
      <circle class="r-track" r="150" fill="none" stroke="var(--accent-soft)" stroke-width="18"/>
      <circle class="r-fill" r="150" fill="none" stroke="var(--ok)" stroke-width="18" stroke-linecap="round" transform="rotate(-90)" stroke-dasharray="942.5" stroke-dashoffset="942.5"/>
      <g class="r-spin"><path d="M 0 -150 A 150 150 0 0 1 129.9 -75" fill="none" stroke="var(--accent)" stroke-width="18" stroke-linecap="round"/>
      <path d="M 144.5 -92.5 L 141 -54 L 109.5 -72.5 Z" fill="var(--accent)"/></g>
    </svg></div>`);
    el._spin = el.querySelector('.r-spin'); el._fill = el.querySelector('.r-fill');
    return el;
  }
  function ringState(el, rot, fill) {
    el._spin.setAttribute('transform', `rotate(${rot})`);
    el._fill.setAttribute('stroke-dashoffset', 942.5 * (1 - clamp(fill)));
  }

  // Canonical mark from brand/BRAND_GUIDELINES.md: listening node, stem, cyan bar (voice in), amber bar (polish out).
  const MARK = (ink = '#1c1f25', cyan = '#0092c6', amber = '#e6ac3d') => `<svg viewBox="0 0 112 100" fill="none"><circle class="m-dot" cx="20" cy="50" r="12" fill="${ink}"/><rect class="m-stem" x="43" y="6" width="6" height="88" rx="3" fill="${ink}"/><rect class="m-cy" x="60" y="37" width="44" height="11" rx="5.5" fill="${cyan}"/><rect class="m-am" x="60" y="55" width="44" height="11" rx="5.5" fill="${amber}"/></svg>`;
  function logo(parent, dark = false) {
    const el = add(parent, `<div class="logo">${dark ? MARK('#f5f7f9', '#3fd1f7', '#faca4b') : MARK()}<div class="wm"${dark ? ' style="color:#f5f7f9"' : ''}>Contextli</div></div>`);
    el._parts = ['.m-dot', '.m-stem', '.m-cy', '.m-am', '.wm'].map(q => el.querySelector(q));
    return el;
  }
  // Logo build-on: dot pops, stem grows, bars slide out, wordmark fades up. p = 0..1
  function logoIn(el, p) {
    const [dot, stem, cy, am, wm] = el._parts, k = (a, b) => E.outQuint(prog(p, a, b));
    dot.style.transformOrigin = '20px 50px'; dot.style.transform = `scale(${E.back(prog(p, 0, 0.3))})`;
    stem.style.transformOrigin = '46px 50px'; stem.style.transform = `scaleY(${k(0.15, 0.45)})`;
    cy.style.transformOrigin = '60px 42px'; cy.style.transform = `scaleX(${k(0.35, 0.65)})`;
    am.style.transformOrigin = '60px 60px'; am.style.transform = `scaleX(${k(0.45, 0.75)})`;
    wm.style.opacity = k(0.55, 0.95); wm.style.transform = `translateX(${(1 - k(0.55, 0.95)) * -16}px)`;
  }

  // ---------- player ----------
  function play({ duration, render }) {
    const stage = document.getElementById('stage');
    const params = new URLSearchParams(location.search);
    if (params.has('render')) {
      document.body.classList.add('render');
      window.__duration = duration;
      window.__seek = t => render(t);
      render(0);
      document.fonts.load('500 40px Newsreader').then(() => document.fonts.load('600 20px "Hanken Grotesk"')).then(() => document.fonts.load('500 20px "JetBrains Mono"')).then(() => document.fonts.ready).then(() => { window.__ready = true; });
      return;
    }
    const fit = () => { const s = Math.min(innerWidth / W, innerHeight / H); stage.style.transform = `translate(-50%,-50%) scale(${s})`; };
    addEventListener('resize', fit); fit();
    const ctl = document.createElement('div'); ctl.id = 'ctl';
    ctl.innerHTML = '<span class="pp">❚❚</span><div class="bar"><i></i></div><span class="tc">0.0s</span>';
    document.body.appendChild(ctl);
    const bar = ctl.querySelector('.bar'), fillEl = bar.querySelector('i'), tc = ctl.querySelector('.tc'), pp = ctl.querySelector('.pp');
    let t = +(params.get('t') || 0), last = performance.now(), paused = false;
    const toggle = () => { paused = !paused; pp.textContent = paused ? '▶' : '❚❚'; };
    pp.onclick = toggle;
    addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
    bar.onclick = e => { const r = bar.getBoundingClientRect(); t = (e.clientX - r.left) / r.width * duration; };
    stage.onclick = toggle;
    document.fonts.ready.then(() => {
      const loop = now => {
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (!paused) t = (t + dt) % duration;
        render(t);
        fillEl.style.width = (t / duration * 100) + '%'; tc.textContent = t.toFixed(1) + 's';
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  window.M = { W, H, clamp, prog, lerp, E, kf, env, S, h, add, typed, ICON, MARK, caption, showCap, terminal, phone, phoneState, ticket, ticketStatus, ring, ringState, logo, logoIn, play };
})();
