/* =====================================================================
   MEMO MAYHEM — EXPERIMENT ENGINE + LAYAR PERMAINAN
   State machine: ready → briefing → observing → transitioning →
   recalling → evaluating → feedback → (briefing | completed | failed)
   + paused / abandoned. Semua timer memakai satu "ticker" yang berhenti
   saat jeda (tidak memakai jumlah render sebagai ukuran waktu).
===================================================================== */
(function () {
    'use strict';
    const C = MemoCore, D = MemoData, sfx = D.sfx;
    const MM = window.MM = {};
    const root = document.getElementById('mmRoot');
    const view = document.getElementById('memoView');
    MM.root = root; MM.view = view;

    /* ---------- Util DOM ---------- */
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const $ = (s, el) => (el || root).querySelector(s);
    const $$ = (s, el) => Array.from((el || root).querySelectorAll(s));
    MM.esc = esc; MM.$ = $; MM.$$ = $$;
    const objHTML = (o, cls) => '<span class="mm-obj ' + (cls || '') + '" style="color:' + C.colorById(o.color).hex + '" aria-hidden="true">' + C.shapeById(o.shape).g + '</span>';
    MM.objHTML = objHTML;
    function optHTML(o) {
        if (o.t === 'obj') return objHTML(o, 'mm-obj-md') + '<small>' + esc(o.label) + '</small>';
        if (o.t === 'color') return '<span class="mm-swatch" style="background:' + C.colorById(o.color).hex + '"></span><small>' + esc(o.label) + '</small>';
        if (o.t === 'num') return '<b class="mm-num">' + o.n + '</b>';
        return '<span class="mm-opt-text">' + esc(o.text) + '</span>';
    }
    MM.optHTML = optHTML;
    const fmtMs = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' dtk';
    MM.fmtMs = fmtMs;

    /* ---------- Maskot Mimo (SVG) ---------- */
    function mimo(mood, pose, cls) {
        return '<svg class="mimo ' + (cls || '') + '" viewBox="0 0 120 140" data-mood="' + (mood || 'happy') + '" data-pose="' + (pose || 'idle') + '" role="img" aria-label="Mimo, maskot">' +
            '<g class="mimo-fig">' +
            '<line x1="60" y1="20" x2="60" y2="38" class="mimo-ant"/><circle class="mimo-bulb" cx="60" cy="14" r="7"/>' +
            '<ellipse class="mimo-foot" cx="45" cy="127" rx="13" ry="7"/><ellipse class="mimo-foot" cx="75" cy="127" rx="13" ry="7"/>' +
            '<ellipse class="mimo-body" cx="60" cy="82" rx="38" ry="42"/><ellipse class="mimo-belly" cx="60" cy="96" rx="21" ry="20"/>' +
            '<g class="mimo-arm mimo-armL"><path d="M27 88 Q9 96 11 114"/></g><g class="mimo-arm mimo-armR"><path d="M93 88 Q111 96 109 114"/></g>' +
            '<g class="mimo-eyes"><g class="mimo-eye"><circle class="mimo-white" cx="47" cy="68" r="11"/><circle class="mimo-pupil" cx="48" cy="69" r="5.5"/></g>' +
            '<g class="mimo-eye mimo-eyeR"><circle class="mimo-white" cx="73" cy="68" r="11"/><circle class="mimo-pupil" cx="72" cy="69" r="5.5"/></g></g>' +
            '<circle class="mimo-cheek" cx="36" cy="84" r="5"/><circle class="mimo-cheek" cx="84" cy="84" r="5"/>' +
            '<path class="m-happy" d="M49 86 Q60 98 71 86"/><path class="m-sad" d="M50 94 Q60 84 70 94"/><ellipse class="m-wow" cx="60" cy="90" rx="6" ry="7"/><path class="m-think" d="M51 90 L69 88"/>' +
            '</g></svg>';
    }
    MM.mimo = mimo;
    function setMimo(el, mood, pose) { if (!el) return; const s = el.querySelector ? (el.matches && el.matches('svg') ? el : el.querySelector('svg')) : el; if (!s) return; if (mood) s.setAttribute('data-mood', mood); if (pose) s.setAttribute('data-pose', pose); }

    /* ---------- Overlay & konfirmasi ---------- */
    function overlay(html, cls) {
        closeOverlay();
        const el = document.createElement('div');
        el.className = 'mm-overlay ' + (cls || '');
        el.id = 'mmOverlay';
        el.innerHTML = '<div class="mm-dialog" role="dialog" aria-modal="true">' + html + '</div>';
        view.appendChild(el);
        const first = el.querySelector('button, input, select');
        if (first) first.focus({ preventScroll: true });
        return el;
    }
    function closeOverlay() { const o = document.getElementById('mmOverlay'); if (o) o.remove(); }
    function confirmBox(o) {
        const el = overlay('<h3>' + esc(o.title) + '</h3><p>' + esc(o.text) + '</p><div class="mm-dialog-actions"><button class="btn-playful btn-playful-secondary" data-c="no">' + esc(o.cancel || 'Batal') + '</button><button class="btn-playful btn-playful-primary ' + (o.danger ? 'mm-danger' : '') + '" data-c="yes">' + esc(o.ok || 'Ya') + '</button></div>', 'mm-confirm');
        el.addEventListener('click', ev => {
            const b = ev.target.closest('[data-c]'); if (!b) return;
            closeOverlay();
            if (b.dataset.c === 'yes') o.onOk && o.onOk(); else o.onCancel && o.onCancel();
        });
    }
    MM.overlay = overlay; MM.closeOverlay = closeOverlay; MM.confirmBox = confirmBox;

    /* =====================================================================
       STATE MACHINE
    ===================================================================== */
    const FLOW = {
        ready: ['briefing', 'abandoned'],
        briefing: ['observing', 'paused', 'abandoned'],
        observing: ['transitioning', 'recalling', 'paused', 'abandoned'],
        transitioning: ['recalling', 'paused', 'abandoned'],
        recalling: ['evaluating', 'paused', 'abandoned'],
        evaluating: ['feedback', 'abandoned'],
        feedback: ['briefing', 'completed', 'failed', 'paused', 'abandoned'],
        paused: ['briefing', 'observing', 'transitioning', 'recalling', 'feedback', 'abandoned'],
        completed: ['ready'], failed: ['ready'], abandoned: ['ready']
    };
    const E = MM.E = {
        st: 'ready', cfg: null, i: 0, total: 0, round: null, recent: [], results: [], score: 0, combo: 0, bestCombo: 0,
        lives: 3, livesLost: 0, hintsLeft: 3, token: 0, phase: null, paused: false, prevState: null, tickId: null, last: 0,
        input: null, roundHints: 0, miniWrong: false, player: null, stopped: false
    };
    function setState(s) {
        if (E.st === s) return true;
        if (!FLOW[E.st] || !FLOW[E.st].includes(s)) { console.warn('[MemoMayhem] transisi tidak valid', E.st, '→', s); return false; }
        if (s === 'paused') E.prevState = E.st;
        E.st = s;
        view.setAttribute('data-mm-state', s);
        return true;
    }
    MM.state = () => E.st;

    /* ---------- Ticker / fase berwaktu ---------- */
    function startTicker() { stopTicker(); E.last = performance.now(); E.tickId = setInterval(tick, 40); }
    function stopTicker() { if (E.tickId) { clearInterval(E.tickId); E.tickId = null; } }
    function tick() {
        const now = performance.now(); const dt = Math.min(100, now - E.last); E.last = now;
        if (E.paused || !E.phase) return;
        const ph = E.phase;
        ph.t += dt;
        for (const ev of ph.events) { if (!ev.done && ph.t >= ev.at) { ev.done = true; ev.fn(); if (E.phase !== ph) return; } }
        if (ph.onTick) ph.onTick(ph.t, ph.dur);
        if (E.phase !== ph) return;
        if (ph.dur != null && ph.t >= ph.dur) { E.phase = null; if (ph.onEnd) ph.onEnd(); }
    }
    function startPhase(name, dur, o) {
        o = o || {};
        E.phase = { name, dur, t: 0, events: (o.events || []).map(e => ({ at: e.at, fn: e.fn, done: false })), onEnd: o.onEnd, onTick: o.onTick, token: E.token };
        setTimerUI(name, 0, dur, o.kind);
        return E.phase;
    }
    function setTimerUI(name, t, dur, kind) {
        const fill = $('#mmTimerFill'), txt = $('#mmTimerText'), lbl = $('#mmPhaseLbl'), box = $('.mm-timer');
        if (!fill) return;
        if (name) { lbl.textContent = PHASE_LABEL[kind || name] || ''; box.setAttribute('data-phase', kind || name); }
        if (dur == null) { fill.style.width = '0%'; txt.textContent = ''; return; }
        const left = Math.max(0, dur - t), pct = Math.max(0, Math.min(100, left / dur * 100));
        fill.style.width = pct + '%';
        const sec = Math.ceil(left / 1000);
        if (txt.textContent !== String(sec)) txt.textContent = String(sec);
        box.classList.toggle('is-low', (kind || name) === 'recall' && pct < 25);
    }
    const PHASE_LABEL = { brief: 'Bersiap', observe: 'AMATI', hide: 'Menyimpan', scan: 'Memindai', interference: 'Sinyal asing', delay: 'Jeda', mini: 'Hitung cepat', recall: 'JAWAB' };

    /* =====================================================================
       SESI
    ===================================================================== */
    MM.startSession = function (cfg, player) {
        MM.abort(true);
        E.token++; E.cfg = cfg; E.player = player || D.activeProfile();
        E.i = 0; E.total = C.totalRounds(cfg); E.recent = []; E.results = []; E.score = 0; E.combo = 0; E.bestCombo = 0;
        const noLives = cfg.practice || cfg.type === 'duel';
        E.lives = noLives ? Infinity : 3; E.livesLost = 0;
        E.hintsLeft = cfg.practice ? Infinity : (cfg.type === 'duel' ? 0 : 3);
        E.stopped = false; E.paused = false; E.phase = null; E.prevState = null;
        E.st = 'ready'; E.hintUsedTotal = 0;
        sfx.unlock();
        renderPlayShell();
        startTicker();
        setState('briefing');
        beginRound();
    };
    MM.abort = function (silent) {
        E.token++; E.phase = null; E.paused = false; stopTicker();
        if (E.st !== 'ready' && E.st !== 'completed' && E.st !== 'failed' && E.st !== 'abandoned') { E.st = 'abandoned'; }
        E.st = 'ready'; closeOverlay();
        document.removeEventListener('keydown', onKey);
    };

    function planAndGenerate() {
        const plan = C.planRound(E.cfg, E.i, E.recent);
        const round = C.generateRound(plan);
        round.phase = plan.phase; round.phaseTitle = plan.phaseTitle;
        E.recent.push(round.kind); if (E.recent.length > 4) E.recent.shift();
        return round;
    }

    function beginRound() {
        const token = E.token;
        E.round = planAndGenerate();
        E.input = { sel: [], seq: [], taps: [], choice: null, corrections: 0, eliminated: [], hinted: [], hintCells: [] };
        E.roundHints = 0; E.miniWrong = false;
        document.addEventListener('keydown', onKey);
        updateHUD();
        const r = E.round;
        $('#mmFeedback').hidden = true; $('#mmFeedback').innerHTML = '';
        $('#mmMain').innerHTML = ''; $('#mmMain').className = 'mm-main';
        $('#mmPrompt').textContent = 'Bersiap…';
        renderBanner(r);
        setMimo($('#mmMimoMini'), 'think', 'idle');
        renderControls();
        setState('briefing');
        const dur = r.mods.length || r.phaseTitle ? 2400 : 1500;
        $('#mmMain').innerHTML = '<div class="mm-brief"><div class="mm-brief-ico">' + C.MODE_INFO[r.mode].icon + '</div><h2>' + esc(r.title) + '</h2><p>' + esc(C.MODE_INFO[r.mode].name) + ' · ' + C.DIFF_INFO[r.diff].label + '</p>' +
            (r.mods.length ? '<div class="mm-brief-mods">' + r.mods.map(m => '<span class="mm-modchip" title="' + esc(C.MODIFIERS[m].desc) + '">' + C.MODIFIERS[m].icon + ' ' + esc(C.MODIFIERS[m].name) + '</span>').join('') + '</div><p class="mm-brief-desc">' + r.mods.map(m => esc(C.MODIFIERS[m].desc)).join(' ') + '</p>' : '') +
            '</div>';
        startPhase('brief', dur, { onEnd: () => { if (token === E.token) observe(); } });
        E.skip = () => { if (E.phase && E.phase.name === 'brief') { E.phase.t = E.phase.dur; } };
    }

    function renderBanner(r) {
        const b = $('#mmBanner');
        b.innerHTML = (r.phaseTitle ? '<span class="mm-bossphase">👾 ' + esc(r.phaseTitle) + '</span>' : '') +
            r.mods.map(m => '<span class="mm-modchip" title="' + esc(C.MODIFIERS[m].desc) + '">' + C.MODIFIERS[m].icon + ' ' + esc(C.MODIFIERS[m].name) + '</span>').join('');
        b.hidden = !b.innerHTML;
    }

    function updateHUD() {
        const cfg = E.cfg, r = E.round;
        $('#mmRoundLbl').textContent = 'Ronde ' + (E.i + 1) + (E.total === Infinity ? '' : ' / ' + E.total);
        $('#mmModeLbl').textContent = (r ? C.MODE_INFO[r.mode].name : '') + (cfg.type === 'standard' && cfg.practice ? ' · LATIHAN' : cfg.type === 'daily' ? ' · HARIAN' : cfg.type === 'endless' ? ' · ENDLESS' : cfg.type === 'boss' ? ' · BOSS' : cfg.type === 'duel' ? ' · DUEL' : '');
        $('#mmScore').textContent = E.score;
        const mult = C.comboMult(E.combo);
        $('#mmCombo').textContent = '×' + mult.toFixed(1).replace('.', ',') + (E.combo > 0 ? ' (' + E.combo + ')' : '');
        const lb = $('#mmLivesBox');
        if (E.lives === Infinity) { lb.hidden = true; }
        else { lb.hidden = false; $('#mmLives').textContent = '❤️'.repeat(Math.max(0, E.lives)) + '🖤'.repeat(Math.max(0, 3 - Math.max(0, E.lives))); }
        const pr = $('#mmProgress'); if (pr) pr.style.width = (E.total === Infinity ? Math.min(100, E.i * 5) : (E.i / E.total * 100)) + '%';
    }

    /* =====================================================================
       FASE: OBSERVE
    ===================================================================== */
    function observe() {
        const token = E.token, r = E.round;
        if (!setState('observing')) return;
        sfx.phase();
        const main = $('#mmMain');
        main.className = 'mm-main mm-m-' + r.mode;
        $('#mmPrompt').textContent = r.scene.caption || 'Amati baik-baik';
        setMimo($('#mmMimoMini'), 'wow', 'idle');
        const events = renderObserve(r, main);
        if (r.distraction) addDecoys(main);
        renderControls();
        startPhase('observe', r.observeMs, { events, onTick: (t, d) => setTimerUI('observe', t, d), onEnd: () => { if (token === E.token) afterObserve(); } });
        E.skip = () => { if (E.phase && E.phase.name === 'observe') E.phase.t = E.phase.dur; };
    }

    function gridHTML(cols, rows, cellFn, tag, cls) {
        let h = '<div class="mm-grid ' + (cls || '') + '" style="--cols:' + cols + ';--rows:' + rows + '">';
        for (let c = 0; c < cols * rows; c++) h += '<' + tag + ' class="mm-cell" data-c="' + c + '">' + cellFn(c) + '</' + tag + '>';
        return h + '</div>';
    }

    function renderObserve(r, main) {
        const sc = r.scene, ev = [];
        if (r.mode === 'snapshot') {
            const byCell = {}; sc.items.forEach(i => { byCell[i.cell] = i; });
            main.innerHTML = gridHTML(sc.cols, sc.rows, c => byCell[c] ? objHTML(byCell[c]) : '', 'div');
        } else if (r.mode === 'glitch') {
            main.innerHTML = gridHTML(sc.cols, sc.rows, c => sc.A[c] ? objHTML(sc.A[c]) : '', 'div');
        } else if (r.mode === 'sequence') {
            main.innerHTML = '<div class="mm-seq-stage"><div class="mm-seq-dots">' + sc.items.map((_, i) => '<i data-i="' + i + '"></i>').join('') + '</div><div class="mm-seq-big" id="mmSeqBig"><span class="mm-seq-wait">· · ·</span></div></div>';
            const big = $('#mmSeqBig');
            sc.items.forEach((it, i) => {
                const at = 500 + i * (sc.step + sc.gap);
                ev.push({ at, fn: () => { big.innerHTML = '<span class="mm-seq-item ' + (sc.symbolMode === 'digit' ? 'is-digit' : '') + '">' + esc(it.g) + '</span>'; const d = $('.mm-seq-dots i[data-i="' + i + '"]'); if (d) d.classList.add('on'); sfx.tick(); } });
                ev.push({ at: at + sc.step, fn: () => { big.innerHTML = '<span class="mm-seq-wait">· · ·</span>'; } });
            });
        } else if (r.mode === 'copycat') {
            main.innerHTML = '<div class="mm-mimo-stage">' + mimo('happy', 'idle', 'mimo-big') + '<div class="mm-act-label" id="mmActLabel">Siap?</div><div class="mm-seq-dots">' + sc.items.map((_, i) => '<i data-i="' + i + '"></i>').join('') + '</div></div>';
            const m = $('.mimo', main), lab = $('#mmActLabel');
            sc.items.forEach((it, i) => {
                const extra = sc.second && i >= sc.second.start ? 800 : 0;
                const at = 600 + i * (sc.step + sc.gap) + extra;
                if (sc.second && i === sc.second.start) ev.push({ at: at - 600, fn: () => { lab.textContent = 'Tayangan ke-2'; setMimo(m, null, 'idle'); } });
                ev.push({ at, fn: () => { setMimo(m, 'happy', it.id); lab.innerHTML = '<span class="mm-act-ico">' + it.g + '</span> ' + esc(it.n); const d = $('.mm-seq-dots i[data-i="' + i + '"]'); if (d) d.classList.add('on'); sfx.tick(); } });
                ev.push({ at: at + sc.step, fn: () => { setMimo(m, null, 'idle'); lab.textContent = '…'; } });
            });
        } else if (r.mode === 'echo') {
            if (sc.rhythm) {
                const total = sc.rhythm.reduce((a, b) => a + b, 0);
                main.innerHTML = '<div class="mm-rhythm-stage"><button class="mm-bigpad" id="mmBigPad" disabled tabindex="-1" aria-hidden="true">🥁</button><div class="mm-timeline" id="mmTimeline"></div><p class="mm-hint-line">Dengarkan & lihat ketukan muncul di garis waktu</p></div>';
                const pad = $('#mmBigPad'), tl = $('#mmTimeline');
                let t = 600;
                const beat = (at, x) => ev.push({ at, fn: () => { pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 140); sfx.tone(330, 0.16, 'triangle', 0.25); tl.insertAdjacentHTML('beforeend', '<i style="left:' + (x * 100) + '%"></i>'); } });
                beat(t, 0);
                let acc = 0;
                sc.rhythm.forEach(iv => { t += iv; acc += iv; beat(t, acc / total); });
            } else {
                const pool = r.recall.pool;
                main.innerHTML = '<div class="mm-pads mm-pads-' + pool.length + '">' + pool.map(p => '<div class="mm-pad" data-id="' + p.id + '" style="--pc:' + p.color + '"><span>' + p.g + '</span><small>' + esc(p.n) + '</small></div>').join('') + '</div>';
                sc.items.forEach((it, i) => {
                    const at = 600 + i * (sc.step + sc.gap);
                    ev.push({ at, fn: () => { const el = $('.mm-pad[data-id="' + it.id + '"]', main); if (el) el.classList.add('lit'); sfx.pad(it); } });
                    ev.push({ at: at + sc.step * 0.75, fn: () => { const el = $('.mm-pad[data-id="' + it.id + '"]', main); if (el) el.classList.remove('lit'); } });
                });
            }
        } else if (r.mode === 'mindtrap') {
            main.innerHTML = '<div class="mm-card mm-facts" id="mmFacts"></div>';
            const box = $('#mmFacts');
            const show = ph => {
                box.innerHTML = '<h3>' + esc(ph.title) + '</h3>' + ph.lines.map(l => l.update ? '<div class="mm-fact mm-fact-update">' + esc(l.update) + '</div>' :
                    '<div class="mm-fact"><span class="mm-fact-name">' + esc(l.name) + '</span><span class="mm-fact-item">' + esc(l.item) + '</span>' + (l.room ? '<span class="mm-fact-room">' + esc(l.room) + '</span>' : '') + (l.color ? '<span class="mm-fact-col"><i style="background:' + l.colorHex + '"></i>' + esc(l.color) + '</span>' : '') + '</div>').join('');
            };
            let t = 0;
            sc.phases.forEach((ph, i) => { ev.push({ at: t, fn: () => { show(ph); if (i > 0) sfx.phase(); } }); t += ph.ms; });
        }
        return ev;
    }

    function addDecoys(main) {
        const glyphs = ['✦', '✧', '☄️', '🌟', '🪐', '✺', '·', '✶', '☆', '🛰️'];
        let h = '';
        for (let k = 0; k < 14; k++) {
            const top = k % 2 ? 'auto' : (2 + (k * 7) % 14) + 'px', bottom = k % 2 ? (2 + (k * 5) % 14) + 'px' : 'auto';
            h += '<span class="mm-decoy" style="left:' + ((k * 37) % 94) + '%;top:' + top + ';bottom:' + bottom + ';animation-delay:-' + (k * 0.6) + 's">' + glyphs[k % glyphs.length] + '</span>';
        }
        const wrap = document.createElement('div'); wrap.className = 'mm-decoys'; wrap.setAttribute('aria-hidden', 'true'); wrap.innerHTML = h;
        main.appendChild(wrap);
    }

    /* =====================================================================
       FASE: TRANSITION
    ===================================================================== */
    function afterObserve() {
        const token = E.token, r = E.round;
        const steps = [];
        if (r.mode === 'glitch') steps.push('scan'); else steps.push('hide');
        if (r.interference) steps.push('interference');
        if (r.delayMs) steps.push('delay');
        if (r.mini) steps.push('mini');
        if (!setState('transitioning')) return;
        setMimo($('#mmMimoMini'), 'think', 'idle');
        renderControls();
        const run = i => {
            if (token !== E.token) return;
            if (i >= steps.length) { startRecall(); return; }
            const s = steps[i], main = $('#mmMain'), next = () => run(i + 1);
            main.className = 'mm-main mm-trans';
            if (s === 'hide') {
                $('#mmPrompt').textContent = 'Menyimpan memori…';
                main.innerHTML = '<div class="mm-hide"><span class="mm-dots"><i></i><i></i><i></i></span></div>';
                startPhase('hide', steps.length === 1 ? 600 : 500, { kind: 'hide', onTick: (t, d) => setTimerUI('hide', t, d, 'hide'), onEnd: next });
            } else if (s === 'scan') {
                $('#mmPrompt').textContent = 'Sistem sedang mengubah adegan…';
                main.innerHTML = '<div class="mm-scan"><div class="mm-scan-bar"></div><span>📡 MEMINDAI…</span></div>';
                startPhase('scan', r.scanMs, { kind: 'scan', onTick: (t, d) => setTimerUI('scan', t, d, 'scan'), onEnd: next });
            } else if (s === 'interference') {
                $('#mmPrompt').textContent = '📡 Sinyal asing masuk — ABAIKAN!';
                main.innerHTML = '<div class="mm-noise"><div class="mm-noise-row">' + r.interference.items.map(o => objHTML(o, 'mm-obj-md')).join('') + '</div><p>Ini bukan bagian dari yang harus diingat.</p></div>';
                startPhase('interference', r.interference.ms, { kind: 'interference', onTick: (t, d) => setTimerUI('interference', t, d, 'interference'), onEnd: next });
            } else if (s === 'delay') {
                $('#mmPrompt').textContent = 'Tahan ingatanmu…';
                main.innerHTML = '<div class="mm-hide"><span class="mm-dots"><i></i><i></i><i></i></span><p class="mm-hint-line">Jeda sebelum menjawab</p></div>';
                startPhase('delay', r.delayMs, { kind: 'delay', onTick: (t, d) => setTimerUI('delay', t, d, 'delay'), onEnd: next });
            } else if (s === 'mini') {
                $('#mmPrompt').textContent = 'Double Recall: hitung dulu!';
                main.innerHTML = '<div class="mm-mini"><div class="mm-mini-q">' + esc(r.mini.text) + ' = ?</div><div class="mm-options mm-cols-4">' + r.mini.options.map((o, k) => '<button class="mm-opt" data-k="' + k + '"><b class="mm-num">' + o + '</b></button>').join('') + '</div></div>';
                let done = false;
                const finish = ok => { if (done || token !== E.token) return; done = true; if (!ok) E.miniWrong = true; sfx[ok ? 'tick' : 'wrong'](); E.phase = null; next(); };
                $$('.mm-opt', main).forEach(b => b.addEventListener('click', () => finish(+b.dataset.k === r.mini.answer)));
                startPhase('mini', r.mini.ms, { kind: 'mini', onTick: (t, d) => setTimerUI('mini', t, d, 'mini'), onEnd: () => finish(false) });
                E.skip = null;
            }
        };
        E.skip = null;
        run(0);
    }

    /* =====================================================================
       FASE: RECALL
    ===================================================================== */
    function startRecall() {
        const token = E.token, r = E.round;
        if (!setState('recalling')) return;
        const main = $('#mmMain');
        main.className = 'mm-main mm-recalling mm-m-' + r.mode;
        $('#mmPrompt').textContent = r.prompt;
        const pi = r.promptObj ? objHTML(r.promptObj, 'mm-obj-sm') + ' ' : '';
        if (pi) $('#mmPrompt').innerHTML = pi + esc(r.prompt);
        setMimo($('#mmMimoMini'), 'think', 'idle');
        renderRecall(r, main);
        renderControls();
        startPhase('recall', r.recallMs, { kind: 'recall', onTick: (t, d) => setTimerUI('recall', t, d, 'recall'), onEnd: () => { if (token === E.token) submit(true); } });
        E.skip = null;
        sfx.phase();
    }

    function renderRecall(r, main) {
        const rc = r.recall;
        if (rc.type === 'choice') {
            main.innerHTML = '<div class="mm-options mm-cols-' + (rc.cols || 2) + '">' + rc.options.map((o, i) => '<button class="mm-opt" data-i="' + i + '" aria-label="Pilihan ' + (i + 1) + ': ' + esc(o.label || o.text) + '"><span class="mm-opt-k">' + (i + 1) + '</span>' + optHTML(o) + '</button>').join('') + '</div>';
            $$('.mm-opt', main).forEach(b => b.addEventListener('click', () => { if (b.disabled || b.classList.contains('is-eliminated')) return; submit(false, +b.dataset.i); }));
        } else if (rc.type === 'cells') {
            const byCell = {};
            if (rc.base === 'B') r.scene.B.forEach((o, c) => { if (o) byCell[c] = o; });
            main.innerHTML = gridHTML(rc.cols, rc.rows, c => byCell[c] ? objHTML(byCell[c]) : '', 'button', 'mm-grid-input') +
                '<div class="mm-recall-bar"><span class="mm-count" id="mmCellCount"></span><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmClear">🗑 Ulang</button><button class="btn-playful btn-playful-primary mm-mini-btn" id="mmSubmit">✔ Kirim</button></div>';
            $$('.mm-cell', main).forEach(b => b.setAttribute('aria-label', 'Sel baris ' + (Math.floor(+b.dataset.c / rc.cols) + 1) + ' kolom ' + (+b.dataset.c % rc.cols + 1)));
            $$('.mm-cell', main).forEach(b => b.addEventListener('click', () => toggleCell(+b.dataset.c)));
            $('#mmClear').addEventListener('click', () => { if (E.input.sel.length) E.input.corrections++; E.input.sel = []; refreshCells(); });
            $('#mmSubmit').addEventListener('click', () => { if (E.input.sel.length === rc.pick) submit(false); });
            refreshCells();
        } else if (rc.type === 'seq') {
            renderSeqRecall(r, main);
        } else if (rc.type === 'rhythm') {
            main.innerHTML = '<div class="mm-rhythm-stage"><button class="mm-bigpad" id="mmBigPad" aria-label="Ketuk ritme">🥁<small>KETUK</small></button><div class="mm-beat-dots" id="mmBeatDots">' + Array.from({ length: rc.beats }, () => '<i></i>').join('') + '</div><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmClear">🗑 Ulangi ketukan</button></div>';
            const pad = $('#mmBigPad');
            const hit = ev => {
                if (E.st !== 'recalling' || E.input.taps.length >= rc.beats) return;
                const t = ev && ev.timeStamp ? ev.timeStamp : performance.now();
                E.input.taps.push(t);
                pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 120);
                sfx.tone(330, 0.16, 'triangle', 0.25);
                $$('#mmBeatDots i').forEach((d, k) => d.classList.toggle('on', k < E.input.taps.length));
                if (E.input.taps.length === rc.beats) { const tok = E.token; setTimeout(() => { if (tok === E.token && E.st === 'recalling') submit(false); }, 350); }
            };
            pad.addEventListener('pointerdown', ev => { ev.preventDefault(); hit(ev); });
            pad.addEventListener('keydown', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!ev.repeat) hit(ev); } });
            $('#mmClear').addEventListener('click', () => { E.input.taps = []; E.input.corrections++; $$('#mmBeatDots i').forEach(d => d.classList.remove('on')); });
        }
        if (r.legend) {
            const ids = new Set(rc.pool.map(p => p.id));
            const pairs = C.MIRROR_PAIRS.filter(p => ids.has(p[0]) && ids.has(p[1])).map(p => { const a = C.ACTIONS.find(x => x.id === p[0]), b = C.ACTIONS.find(x => x.id === p[1]); return '<span>' + a.g + ' ↔ ' + b.g + '</span>'; }).join('');
            main.insertAdjacentHTML('afterbegin', '<div class="mm-legend">Cermin: ' + pairs + '</div>');
        }
    }

    function toggleCell(c) {
        const rc = E.round.recall, sel = E.input.sel;
        if (E.st !== 'recalling') return;
        const at = sel.indexOf(c);
        if (at >= 0) { sel.splice(at, 1); E.input.corrections++; }
        else { if (sel.length >= rc.pick) { sel.shift(); E.input.corrections++; } sel.push(c); }
        refreshCells();
    }
    function refreshCells() {
        const rc = E.round.recall, sel = E.input.sel;
        $$('.mm-cell').forEach(b => { const c = +b.dataset.c; b.classList.toggle('is-sel', sel.includes(c)); b.classList.toggle('is-hint', E.input.hintCells.includes(c) && !sel.includes(c)); });
        const cnt = $('#mmCellCount'); if (cnt) cnt.textContent = sel.length + ' / ' + rc.pick + ' dipilih';
        const s = $('#mmSubmit'); if (s) s.disabled = sel.length !== rc.pick;
    }

    function renderSeqRecall(r, main) {
        const rc = r.recall;
        const padCls = rc.sound ? 'mm-padbtn' : 'mm-symbtn';
        const isDigit = rc.pool === C.DIGITS || rc.pool[0].id.startsWith('d');
        main.innerHTML = '<div class="mm-slots" id="mmSlots"></div>' +
            '<div class="mm-keys ' + (isDigit ? 'mm-keys-digit' : 'mm-keys-' + Math.min(rc.pool.length, 8)) + '" id="mmKeys">' +
            rc.pool.map(p => '<button class="' + padCls + '" data-id="' + p.id + '" ' + (rc.sound ? 'style="--pc:' + p.color + '"' : '') + ' aria-label="' + esc(p.n) + '"><span class="mm-key-g">' + esc(p.g) + '</span>' + (isDigit ? '' : '<small>' + esc(p.n) + '</small>') + '</button>').join('') + '</div>' +
            '<div class="mm-recall-bar"><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmUndo">⌫ Hapus</button><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmClear">🗑 Ulang</button><button class="btn-playful btn-playful-primary mm-mini-btn" id="mmSubmit">✔ Kirim</button></div>';
        $$('#mmKeys button').forEach(b => b.addEventListener('click', () => {
            if (E.st !== 'recalling' || b.classList.contains('is-eliminated')) return;
            const p = rc.pool.find(x => x.id === b.dataset.id);
            if (rc.sound) { sfx.pad(p); b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 180); }
            if (E.input.seq.length < rc.need) E.input.seq.push(p.id);
            else if (rc.need === 1) E.input.seq = [p.id];
            refreshSeq();
        }));
        $('#mmUndo').addEventListener('click', () => { if (E.input.seq.length) { E.input.seq.pop(); E.input.corrections++; refreshSeq(); } });
        $('#mmClear').addEventListener('click', () => { if (E.input.seq.length) E.input.corrections++; E.input.seq = []; E.input.hinted = []; refreshSeq(); });
        $('#mmSubmit').addEventListener('click', () => { if (E.input.seq.length === rc.need) submit(false); });
        refreshSeq();
    }
    function slotHTML(p, cls) { return '<span class="mm-slot ' + (cls || '') + '">' + (p ? '<span class="mm-slot-g">' + esc(p.g) + '</span>' : '') + '</span>'; }
    function refreshSeq() {
        const rc = E.round.recall, seq = E.input.seq;
        const find = id => rc.pool.find(p => p.id === id);
        let h = '';
        if (rc.slots) { // elemen hilang
            rc.slots.forEach(s => { h += s ? slotHTML(s, 'is-given') : slotHTML(seq[0] ? find(seq[0]) : null, 'is-hole'); });
        } else {
            for (let i = 0; i < rc.need; i++) h += slotHTML(seq[i] ? find(seq[i]) : null, (i === seq.length ? 'is-next ' : '') + (E.input.hinted.includes(i) ? 'is-hinted' : ''));
        }
        $('#mmSlots').innerHTML = h;
        const sub = $('#mmSubmit'); if (sub) sub.disabled = seq.length !== rc.need;
    }

    /* =====================================================================
       HINT
    ===================================================================== */
    function hintAvailable() {
        return E.st === 'recalling' && (E.hintsLeft === Infinity || E.hintsLeft > 0) && !E.hintBusy;
    }
    function useHint() {
        if (!hintAvailable()) return;
        const r = E.round, rc = r.recall, inp = E.input;
        let used = false;
        if (rc.type === 'choice') {
            const wrongs = rc.options.map((_, i) => i).filter(i => i !== r.answer && !inp.eliminated.includes(i));
            const n = Math.min(wrongs.length - 1, Math.max(1, Math.floor(rc.options.length / 2)));
            if (n > 0) { C.makeRng('h' + Date.now()).shuffle(wrongs).slice(0, n).forEach(i => { inp.eliminated.push(i); const b = $('.mm-opt[data-i="' + i + '"]'); if (b) { b.classList.add('is-eliminated'); b.disabled = true; } }); used = true; }
        } else if (rc.type === 'cells') {
            const left = r.answer.filter(c => !inp.sel.includes(c) && !inp.hintCells.includes(c));
            if (left.length) { inp.hintCells.push(left[0]); refreshCells(); used = true; }
        } else if (rc.type === 'seq') {
            if (rc.need === 1) {
                const wrongs = rc.pool.filter(p => p.id !== r.answer[0]).map(p => p.id).filter(id => !inp.eliminated.includes(id));
                const n = Math.floor(wrongs.length / 2);
                if (n > 0) { C.makeRng('h' + Date.now()).shuffle(wrongs).slice(0, n).forEach(id => { inp.eliminated.push(id); const b = $('#mmKeys button[data-id="' + id + '"]'); if (b) { b.classList.add('is-eliminated'); b.disabled = true; } }); used = true; }
            } else {
                let k = 0; while (k < inp.seq.length && inp.seq[k] === r.answer[k]) k++;
                if (k < rc.need) { inp.seq = r.answer.slice(0, k + 1); inp.hinted = Array.from({ length: k + 1 }, (_, i) => i); refreshSeq(); used = true; }
            }
        } else if (rc.type === 'rhythm') {
            E.hintBusy = true; const tok = E.token;
            const dots = []; let t = 0; const ints = rc.intervals;
            const pad = $('#mmBigPad');
            const pulse = () => { pad.classList.add('hit'); setTimeout(() => pad.classList.remove('hit'), 140); sfx.tone(330, 0.16, 'triangle', 0.25); };
            pulse();
            ints.forEach(iv => { t += iv; setTimeout(() => { if (tok === E.token) pulse(); }, t); });
            setTimeout(() => { E.hintBusy = false; renderControls(); }, t + 200);
            used = true;
        }
        if (!used) return;
        E.roundHints++; E.hintUsedTotal++;
        if (E.hintsLeft !== Infinity) E.hintsLeft--;
        renderControls();
    }

    function renderControls() {
        const c = $('#mmControls'); if (!c) return;
        const st = E.st;
        let h = '';
        if (st === 'recalling') {
            const left = E.hintsLeft === Infinity ? '∞' : E.hintsLeft;
            const dis = !hintAvailable();
            h += '<button class="mm-ctl" id="mmHint" ' + (dis ? 'disabled' : '') + '>💡 Hint <b>' + left + '</b>' + (E.hintsLeft !== Infinity && E.cfg.type !== 'duel' ? '<small>−' + C.SCORE_CFG.hintPenalty + ' poin</small>' : '') + '</button>';
            if (E.cfg.type === 'duel') h = '';
        }
        if (st === 'observing' || st === 'briefing') h += '<button class="mm-ctl" id="mmSkip">⏭ ' + (st === 'observing' ? 'Saya siap' : 'Lewati') + '</button>';
        c.innerHTML = h;
        const hb = $('#mmHint'); if (hb) hb.addEventListener('click', useHint);
        const sb = $('#mmSkip'); if (sb) sb.addEventListener('click', () => E.skip && E.skip());
    }

    /* =====================================================================
       EVALUASI & FEEDBACK
    ===================================================================== */
    function collectInput() {
        const rc = E.round.recall, inp = E.input;
        if (rc.type === 'choice') return inp.choice;
        if (rc.type === 'cells') return inp.sel.slice();
        if (rc.type === 'seq') return inp.seq.slice();
        if (rc.type === 'rhythm') { const b = inp.taps[0] || 0; return inp.taps.map(t => t - b); }
        return null;
    }
    function submit(timeout, choiceIdx) {
        if (E.st !== 'recalling') return;
        const r = E.round;
        const elapsed = E.phase ? Math.min(E.phase.t, r.recallMs) : r.recallMs;
        if (r.recall.type === 'choice' && choiceIdx != null) E.input.choice = choiceIdx;
        if (!setState('evaluating')) return;
        E.phase = null;
        const input = collectInput();
        const val = C.validate(r, input);
        const practice = !!E.cfg.practice;
        const sc = C.scoreRound({ diff: r.diff, prevCombo: E.combo, correct: val.correct, elapsedMs: timeout ? r.recallMs : elapsed, recallMs: r.recallMs, hints: E.roundHints, corrections: E.input.corrections, miniWrong: E.miniWrong, practice });
        const penaltyOnly = !val.correct ? 0 : sc.penalty;
        E.score += sc.total;
        const prevCombo = E.combo;
        if (val.correct) { E.combo++; if (E.combo > E.bestCombo) E.bestCombo = E.combo; } else E.combo = 0;
        let lostLife = false;
        if (!val.correct && E.lives !== Infinity) { E.lives--; E.livesLost++; lostLife = true; }
        const res = {
            i: E.i, mode: r.mode, kind: r.kind, diff: r.diff, mods: r.mods.slice(), correct: val.correct, accuracy: val.accuracy, ms: Math.round(timeout ? r.recallMs : elapsed),
            timeout: !!timeout, score: sc.total, hints: E.roundHints, detail: val.detail, phase: r.phase, seqLen: r.recall.type === 'seq' && r.mode === 'sequence' ? r.recall.need : 0, comboAfter: E.combo
        };
        E.results.push(res);
        sfx[val.correct ? 'correct' : 'wrong']();
        if (val.correct && E.combo >= 3 && E.combo % 3 === 0) setTimeout(() => sfx.combo(E.combo), 350);
        if (!val.correct && lostLife) flashLife();
        updateHUD();
        setState('feedback');
        renderFeedback(r, input, val, sc, timeout, lostLife);
    }
    function flashLife() { const b = $('#mmLivesBox'); if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); } }

    function markSolution(r, input, val) {
        const rc = r.recall, main = $('#mmMain');
        main.classList.add('is-reviewed');
        if (rc.type === 'choice') {
            $$('.mm-opt', main).forEach((b, i) => {
                b.disabled = true;
                if (i === r.answer) b.classList.add('is-correct');
                else if (i === E.input.choice) b.classList.add('is-wrong');
                const mark = i === r.answer ? '✔' : i === E.input.choice ? '✖' : '';
                if (mark) b.insertAdjacentHTML('beforeend', '<span class="mm-mark">' + mark + '</span>');
            });
        } else if (rc.type === 'cells') {
            $$('.mm-cell', main).forEach(b => {
                const c = +b.dataset.c; b.disabled = true; b.classList.remove('is-sel', 'is-hint');
                const inAns = r.answer.includes(c), inSel = (input || []).includes(c);
                if (inAns && inSel) { b.classList.add('is-correct'); b.insertAdjacentHTML('beforeend', '<span class="mm-mark">✔</span>'); }
                else if (inAns) { b.classList.add('is-missed'); b.insertAdjacentHTML('beforeend', '<span class="mm-mark">◎</span>'); }
                else if (inSel) { b.classList.add('is-wrong'); b.insertAdjacentHTML('beforeend', '<span class="mm-mark">✖</span>'); }
            });
            const bar = $('.mm-recall-bar', main); if (bar) bar.remove();
        } else if (rc.type === 'seq') {
            const find = id => rc.pool.find(p => p.id === id);
            const entered = input || [];
            let h = '<div class="mm-review"><div class="mm-review-row"><span class="mm-review-lbl">Jawabanmu</span>';
            for (let i = 0; i < r.answer.length; i++) { const ok = entered[i] === r.answer[i]; h += '<span class="mm-slot ' + (ok ? 'is-correct' : 'is-wrong') + '">' + (entered[i] ? '<span class="mm-slot-g">' + esc(find(entered[i]).g) + '</span>' : '<span class="mm-slot-g">–</span>') + '<em>' + (ok ? '✔' : '✖') + '</em></span>'; }
            h += '</div><div class="mm-review-row"><span class="mm-review-lbl">Seharusnya</span>';
            r.answer.forEach(id => { h += '<span class="mm-slot is-given"><span class="mm-slot-g">' + esc(find(id).g) + '</span></span>'; });
            h += '</div></div>';
            main.innerHTML = h;
        } else if (rc.type === 'rhythm') {
            const want = rc.intervals, got = val.detail.got || [];
            let h = '<div class="mm-review"><div class="mm-review-row"><span class="mm-review-lbl">Targetmu</span>' + want.map(w => '<span class="mm-chip">' + w + ' ms</span>').join('') + '</div>' +
                '<div class="mm-review-row"><span class="mm-review-lbl">Ketukanmu</span>' + (got.length ? want.map((w, i) => '<span class="mm-chip ' + (val.detail.flags[i] ? 'is-correct' : 'is-wrong') + '">' + (i < got.length ? Math.round(got[i]) + ' ms ' + (val.detail.flags[i] ? '✔' : '✖') : '— ✖') + '</span>').join('') : '<span class="mm-chip is-wrong">Belum ada ketukan</span>') + '</div></div>';
            main.innerHTML = h;
        }
    }

    function renderFeedback(r, input, val, sc, timeout, lostLife) {
        const duel = E.cfg.type === 'duel';
        if (!duel) markSolution(r, input, val); else { $('#mmMain').classList.add('is-reviewed'); $$('.mm-opt, .mm-cell, .mm-keys button').forEach(b => { b.disabled = true; }); }
        const fb = $('#mmFeedback');
        const status = val.correct ? ['good', '✅ Benar!'] : timeout ? ['bad', '⏱ Waktu habis'] : ['bad', '❌ Belum tepat'];
        setMimo($('#mmMimoMini'), val.correct ? 'happy' : 'sad', val.correct ? 'jump' : 'idle');
        $('#mmPrompt').textContent = val.correct ? (E.combo >= 3 ? 'Combo ' + E.combo + '! Mimo bangga.' : 'Mantap!') : (lostLife ? 'Stabilitas turun…' : 'Tidak apa-apa, coba lagi!');
        const parts = [];
        if (val.correct) {
            parts.push('<span>Dasar ' + sc.base + ' <small>(100 × ' + sc.diffMult + ' × combo ' + sc.comboMult.toFixed(1).replace('.', ',') + ')</small></span>');
            if (sc.speed) parts.push('<span>Kecepatan +' + sc.speed + '</span>');
            if (sc.accuracy) parts.push('<span>Akurasi +' + sc.accuracy + '</span>');
            if (sc.perfect) parts.push('<span>Sempurna +' + sc.perfect + '</span>');
            if (sc.penalty) parts.push('<span class="is-neg">Penalti −' + sc.penalty + '</span>');
        }
        let why = '';
        if (!duel) {
            if (!val.correct && r.recall.type === 'choice' && input != null && r.recall.options[input] && r.recall.options[input].reason) why = '<p class="mm-why">💡 ' + esc(r.recall.options[input].reason) + '</p>';
            why += '<p class="mm-expl">' + esc(r.explain || '') + '</p>';
            if (r.mods.includes('doubleRecall') && E.miniWrong) why += '<p class="mm-expl">🧮 Hitungan singkat salah: penalti −' + C.SCORE_CFG.miniPenalty + '.</p>';
        } else {
            why = '<p class="mm-expl">Detail jawaban disembunyikan di mode duel supaya adil.</p>';
        }
        const last = E.i + 1 >= E.total || (E.lives !== Infinity && E.lives <= 0);
        fb.innerHTML = '<div class="mm-fb-head is-' + status[0] + '"><b>' + status[1] + '</b><span class="mm-fb-score">' + (val.correct ? '+' + sc.total : '+0') + ' poin</span></div>' +
            (parts.length ? '<div class="mm-fb-parts">' + parts.join('') + '</div>' : '') + why +
            '<div class="mm-fb-foot"><span class="mm-fb-combo">' + (E.combo > 0 ? '🔥 Combo ' + E.combo : 'Combo putus') + '</span>' +
            (E.cfg.type === 'endless' ? '<button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmStop">🏁 Berhenti</button>' : '') +
            '<button class="btn-playful btn-playful-primary mm-next" id="mmNext">' + (last ? '🏁 Lihat Hasil' : 'Lanjut ▶') + '</button></div>';
        fb.hidden = false;
        fb.className = 'mm-feedback is-' + status[0];
        renderControls();
        $('#mmNext').addEventListener('click', nextRound);
        const st = $('#mmStop'); if (st) st.addEventListener('click', () => { E.stopped = true; finish('completed'); });
        setTimeout(() => { const n = $('#mmNext'); if (n) n.focus({ preventScroll: true }); }, 50);
    }

    function nextRound() {
        if (E.st !== 'feedback') return;
        if (E.lives !== Infinity && E.lives <= 0) { finish('failed'); return; }
        E.i++;
        if (E.i >= E.total) { finish('completed'); return; }
        beginRound();
    }

    /* =====================================================================
       AKHIR SESI
    ===================================================================== */
    function finish(status) {
        if (!setState(status)) { E.st = status; }
        stopTicker(); E.phase = null; E.token++;
        document.removeEventListener('keydown', onKey);
        const res = E.results;
        const answered = res.filter(x => !x.timeout);
        const sess = {
            type: E.cfg.type, practice: !!E.cfg.practice, mode: E.cfg.mode || null, diff: E.cfg.diff || null,
            plannedRounds: E.total === Infinity ? 0 : E.total, rounds: res.length, total: res.length,
            correct: res.filter(x => x.correct).length, score: E.score, bestCombo: E.bestCombo,
            accuracy: res.length ? res.filter(x => x.correct).length / res.length : 0,
            avgMs: answered.length ? Math.round(answered.reduce((a, b) => a + b.ms, 0) / answered.length) : 0,
            totalMs: res.reduce((a, b) => a + b.ms, 0),
            failed: status === 'failed', done: status === 'completed' && !(E.cfg.type === 'endless' && !E.stopped && false),
            stopped: E.stopped, livesLost: E.livesLost, seed: E.cfg.seed, dateKey: E.cfg.type === 'daily' ? E.cfg.seed : null,
            profileId: E.player.id, name: E.player.name, icon: E.player.icon,
            maxSeqLen: res.reduce((m, x) => (x.correct && x.seqLen > m ? x.seqLen : m), 0),
            modesSeen: Array.from(new Set(res.map(x => x.mode))),
            perRound: res.map(x => ({ c: x.correct ? 1 : 0, a: +x.accuracy.toFixed(2), ms: x.ms, s: x.score, k: x.kind, m: x.mode, d: x.diff, p: x.phase }))
        };
        if (E.cfg.type === 'endless') sess.done = true;
        if (E.cfg.type === 'boss') sess.done = status === 'completed';
        sfx[status === 'completed' ? 'win' : 'lose']();
        MM.onSessionEnd(sess, res.slice(), E.cfg, status);
    }

    /* =====================================================================
       JEDA / KELUAR
    ===================================================================== */
    function togglePause() {
        if (E.paused) return resume();
        if (!['briefing', 'observing', 'transitioning', 'recalling', 'feedback'].includes(E.st)) return;
        if (!setState('paused')) return;
        E.paused = true;
        const el = overlay('<h3>⏸ Dijeda</h3><p>Timer berhenti selama jeda.</p><div class="mm-dialog-actions mm-col">' +
            '<button class="btn-playful btn-playful-primary" data-a="resume">▶ Lanjutkan</button>' +
            '<button class="btn-playful btn-playful-secondary" data-a="restart">🔁 Mulai Ulang</button>' +
            (E.cfg.type === 'endless' && E.results.length ? '<button class="btn-playful btn-playful-secondary" data-a="stop">🏁 Berhenti & lihat hasil</button>' : '') +
            '<button class="btn-playful btn-playful-secondary" data-a="exit">🚪 Keluar</button></div>', 'mm-pause');
        el.addEventListener('click', ev => {
            const b = ev.target.closest('[data-a]'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'resume') resume();
            else if (a === 'restart') confirmBox({ title: 'Mulai ulang sesi?', text: 'Skor dan progres sesi ini akan dibersihkan.', ok: 'Mulai Ulang', danger: true, onOk: () => { const cfg = Object.assign({}, E.cfg); if (cfg.type === 'standard' || cfg.type === 'endless') cfg.seed = 'r' + Date.now().toString(36); MM.startSession(cfg, E.player); }, onCancel: () => { togglePause(); } });
            else if (a === 'stop') { closeOverlay(); E.paused = false; setState(E.prevState); E.stopped = true; E.st = 'feedback'; finish('completed'); }
            else if (a === 'exit') confirmBox({ title: 'Keluar dari sesi?', text: 'Progres sesi ini akan hilang dan tidak disimpan.', ok: 'Keluar', danger: true, onOk: () => MM.exitSession(), onCancel: () => { togglePause(); } });
        });
    }
    function resume() {
        if (!E.paused) return;
        closeOverlay(); E.paused = false; E.last = performance.now();
        setState(E.prevState || 'recalling');
    }
    MM.exitSession = function (noHome) { E.token++; stopTicker(); E.phase = null; E.paused = false; E.st = 'abandoned'; E.st = 'ready'; document.removeEventListener('keydown', onKey); closeOverlay(); if (noHome !== true) MM.onExit && MM.onExit(); };
    // leaveFn (opsional): dipakai navigasi Back perangkat agar "Keluar" kembali ke halaman sebelumnya, bukan Beranda.
    MM.requestExit = function (leaveFn) {
        const custom = typeof leaveFn === 'function' ? leaveFn : null;
        if (E.st === 'ready') { if (custom) custom(); else MM.onExit && MM.onExit(); return; }
        if (!E.paused && ['briefing', 'observing', 'transitioning', 'recalling'].includes(E.st)) togglePause();
        confirmBox({ title: 'Keluar dari sesi?', text: 'Progres sesi ini akan hilang dan tidak disimpan.', ok: 'Keluar', danger: true, onOk: () => (custom ? (MM.exitSession(true), custom()) : MM.exitSession()), onCancel: () => { if (E.paused) togglePause(); } });
    };

    /* ---------- Papan ketik ---------- */
    function onKey(e) {
        if (!view.classList.contains('active')) return;
        if (document.getElementById('mmOverlay') && e.key !== 'Escape') return;
        if (e.key === 'Escape') { e.preventDefault(); if (document.getElementById('mmOverlay') && E.paused) { resume(); } else if (!document.getElementById('mmOverlay')) togglePause(); return; }
        if (E.paused) return;
        const tag = (e.target && e.target.tagName) || '';
        if (e.key === 'Enter' || e.key === ' ') {
            if (E.st === 'feedback') { if (tag !== 'BUTTON' || e.target.id === 'mmNext') { e.preventDefault(); nextRound(); } }
            else if ((E.st === 'observing' || E.st === 'briefing') && tag !== 'BUTTON') { e.preventDefault(); E.skip && E.skip(); }
            else if (E.st === 'recalling' && e.key === 'Enter') { const s = $('#mmSubmit'); if (s && !s.disabled) { e.preventDefault(); s.click(); } }
        } else if (E.st === 'recalling' && /^[1-9]$/.test(e.key)) {
            const rc = E.round.recall;
            if (rc.type === 'choice') { const b = $('.mm-opt[data-i="' + (+e.key - 1) + '"]'); if (b && !b.disabled) b.click(); }
            else if (rc.type === 'seq' && rc.pool[0].id.startsWith('d')) { const b = $('#mmKeys button[data-id="d' + e.key + '"]'); if (b) b.click(); }
        } else if (E.st === 'recalling' && e.key === '0' && E.round.recall.type === 'seq' && E.round.recall.pool[0].id.startsWith('d')) {
            const b = $('#mmKeys button[data-id="d0"]'); if (b) b.click();
        } else if (E.st === 'recalling' && e.key === 'Backspace' && E.round.recall.type === 'seq') { const u = $('#mmUndo'); if (u) u.click(); }
    }

    /* ---------- Cangkang layar bermain ---------- */
    function renderPlayShell() {
        view.classList.toggle('mm-reduce', !!D.data.settings.reduceMotion);
        view.setAttribute('data-mm-screen', 'play');
        if (window.HubNav) HubNav.memoScreen('play');
        root.innerHTML = '<div class="mm-screen mm-play" id="mmPlay">' +
            '<div class="mm-hud"><button class="icon-button" id="mmPause" aria-label="Jeda">⏸</button>' +
            '<div class="mm-hud-info"><div class="mm-hud-round" id="mmRoundLbl"></div><div class="mm-hud-mode" id="mmModeLbl"></div><div class="mm-progress"><i id="mmProgress"></i></div></div>' +
            '<div class="mm-hud-stats"><div class="mm-stat"><small>Skor</small><b id="mmScore">0</b></div><div class="mm-stat"><small>Combo</small><b id="mmCombo">×1,0</b></div><div class="mm-stat" id="mmLivesBox"><small>Stabilitas</small><b id="mmLives"></b></div></div></div>' +
            '<div class="mm-timer" role="timer" data-phase="brief"><div class="mm-timer-track"><i id="mmTimerFill"></i></div><span class="mm-timer-text" id="mmTimerText"></span><em id="mmPhaseLbl"></em></div>' +
            '<div class="mm-banner" id="mmBanner" hidden></div>' +
            '<div class="mm-board"><div class="mm-say"><div class="mm-mimo-mini" id="mmMimoMini">' + mimo('think', 'idle') + '</div><p id="mmPrompt" class="mm-prompt"></p></div>' +
            '<div class="mm-main" id="mmMain" aria-live="polite"></div><div class="mm-feedback" id="mmFeedback" hidden></div></div>' +
            '<div class="mm-controls" id="mmControls"></div></div>';
        $('#mmPause').addEventListener('click', togglePause);
    }

    MM.setMimo = setMimo;
})();
