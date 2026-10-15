/* =====================================================================
   ui.js — perilaku ANTARMUKA saja (tidak menyentuh aturan skor, penalti, timer, duel).
   Dimuat setelah script.js. Semua fitur di sini aman dimatikan tanpa mengubah hasil game.
===================================================================== */
(function () {
    'use strict';

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
    const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } };
    const isActive = (id) => $('#' + id)?.classList.contains('active');

    /* ---------- Live region (feedback, timer, status) ---------- */
    const live = $('#liveRegion');
    function announce(text) {
        if (!live) return;
        live.textContent = '';
        setTimeout(() => { live.textContent = text; }, 40);
    }


    /* ---------- Mode gelap: ikuti sistem, tombol menimpa dan diingat ---------- */
    const root = document.documentElement;
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const isDark = () => root.getAttribute('data-theme') ? root.getAttribute('data-theme') === 'dark' : !!(mq && mq.matches);
    function syncTheme() {
        const dark = isDark();
        $$('.theme-toggle').forEach(b => {
            b.setAttribute('aria-pressed', dark ? 'true' : 'false');
            b.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
            b.firstElementChild.textContent = dark ? '☀️' : '🌙';
        });
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.theme-toggle')) return;
        const next = isDark() ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        lsSet('theme', next);
        syncTheme();
        announce(next === 'dark' ? 'Mode gelap aktif' : 'Mode terang aktif');
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', syncTheme);
    syncTheme();

    /* ---------- Toast -> live region ---------- */
    new MutationObserver(muts => {
        muts.forEach(mu => mu.addedNodes.forEach(n => {
            if (n.nodeType === 1 && n.classList.contains('toast-alert')) {
                announce(n.textContent);
            }
        }));
    }).observe(document.body, { childList: true });

    /* ---------- Offline banner ---------- */
    const banner = $('#offlineBanner');
    function syncOnline() { if (banner) banner.hidden = navigator.onLine; }
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    syncOnline();

    /* ---------- Debounce 300 ms per tombol (hindari klik ganda) ---------- */
    const lastClick = new WeakMap();
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.buttonStart, .knowledge-option-btn, .advmath-option-btn, #knowledgeHintButton');
        if (!btn) return;
        const now = Date.now();
        if (now - (lastClick.get(btn) || 0) < 300) {
            e.stopImmediatePropagation();
            e.preventDefault();
            return;
        }
        lastClick.set(btn, now);
    }, true);

    /* ---------- G1: tombol Jawab nonaktif bila input kosong ---------- */
    const answerInput = $('.answer-input');
    const submitBtn = $('.buttonStart');
    function syncSubmit() {
        if (!answerInput || !submitBtn || answerInput.disabled) return;
        const empty = answerInput.value.trim() === '';
        if (submitBtn.disabled !== empty) submitBtn.disabled = empty;
    }
    setInterval(syncSubmit, 120);

    /* ---------- Shortcut keyboard ---------- */
    const modalOpen = () => !!$('.modal.show') || $('#countdownOverlay')?.classList.contains('is-visible');
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (modalOpen()) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        const typing = tag === 'INPUT' || tag === 'TEXTAREA';

        if (isActive('gameView') && answerInput && !answerInput.disabled && !typing) {
            if (/^[0-9]$/.test(e.key)) { answerInput.value += e.key; syncSubmit(); e.preventDefault(); }
            else if (e.key === 'Backspace') { answerInput.value = answerInput.value.slice(0, -1); syncSubmit(); e.preventDefault(); }
            else if (e.key === 'Enter') { if (submitBtn && !submitBtn.disabled) submitBtn.click(); e.preventDefault(); }
            return;
        }

        const grid = isActive('knowledgeGameView') ? '.knowledge-option-btn' : isActive('advmathGameView') ? '.advmath-option-btn' : null;
        if (grid && !typing) {
            const k = e.key.toLowerCase();
            const idx = '1234'.indexOf(k) >= 0 && k.length === 1 ? '1234'.indexOf(k) : 'abcd'.indexOf(k) >= 0 && k.length === 1 ? 'abcd'.indexOf(k) : -1;
            if (idx >= 0) {
                const btn = $$(grid)[idx];
                if (btn && !btn.disabled && btn.offsetParent !== null) { btn.click(); e.preventDefault(); }
            }
        }
    });
    $$('.knowledge-option-btn, .advmath-option-btn').forEach((b, i) => b.setAttribute('data-key', 'ABCD'[i % 4]));

    /* ---------- Timer: pengumuman hanya 30 / 10 detik terakhir dan selesai ---------- */
    const kTimer = $('#knowledgeTimer');
    let lastK = '';
    setInterval(() => {
        if (!kTimer) return;
        const t = kTimer.textContent.trim();
        if (t === lastK) return;
        lastK = t;
        const m = /^(\d+):(\d+)$/.exec(t);
        if (!m) return;
        const sec = (+m[1]) * 60 + (+m[2]);
        const playing = isActive('knowledgeGameView');
        kTimer.classList.toggle('is-last10', playing && sec > 0 && sec <= 10);
        if (!playing) return;
        if (sec === 30) announce('30 detik lagi');
        else if (sec === 10) announce('10 detik lagi');
        else if (sec === 0 && lastK !== '01:00') announce('Waktu habis');
    }, 250);

    /* ---------- Konfirmasi Hint 3 (soal langsung hangus) ---------- */
    const modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.id = 'hint3ConfirmModal';
    modalEl.tabIndex = -1;
    modalEl.setAttribute('aria-labelledby', 'hint3ConfirmLabel');
    modalEl.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content playful-modal">' +
        '<div class="modal-header"><h2 class="modal-title" id="hint3ConfirmLabel">Buka Hint 3?</h2></div>' +
        '<div class="modal-body">Hint 3 berisi pembahasan lengkap. Soal ini langsung hangus dan waktu bertambah 300 detik.</div>' +
        '<div class="modal-footer"><button type="button" class="btn-playful btn-playful-outline" data-bs-dismiss="modal">Batal</button>' +
        '<button type="button" class="btn-playful btn-playful-danger" id="hint3ConfirmYes">Ya, buka</button></div></div></div>';
    document.body.appendChild(modalEl);
    let pendingHint3 = null;
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#advmathHintRow .advmath-hint-btn[data-level="3"]');
        if (!btn || btn.dataset.confirmed === '1') return;
        if (btn.disabled || btn.classList.contains('is-active') || btn.classList.contains('is-expired')) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        pendingHint3 = btn;
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }, true);
    $('#hint3ConfirmYes', modalEl).addEventListener('click', () => {
        const btn = pendingHint3;
        pendingHint3 = null;
        modalEl.addEventListener('hidden.bs.modal', () => {
            if (!btn) return;
            btn.dataset.confirmed = '1';
            btn.click();
            delete btn.dataset.confirmed;
        }, { once: true });
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    });

    /* ---------- Coach mark sekali (G1) ---------- */
    const gv = $('#gameView');
    if (gv && !lsGet('coachG1')) {
        new MutationObserver(() => {
            if (!gv.classList.contains('active') || lsGet('coachG1')) return;
            lsSet('coachG1', '1');
            const c = document.createElement('div');
            c.className = 'coach-mark';
            c.setAttribute('role', 'status');
            c.innerHTML = '<span>Ketuk angka di keypad, lalu tekan Jawab. Kamu juga bisa pakai keyboard.</span><button type="button" class="btn-playful btn-playful-secondary">Oke</button>';
            document.body.appendChild(c);
            const close = () => c.remove();
            c.querySelector('button').addEventListener('click', close);
            setTimeout(close, 8000);
        }).observe(gv, { attributes: true, attributeFilter: ['class'] });
    }

    /* ---------- Fokus: pindahkan ke judul layar baru agar pembaca layar tahu ---------- */
    new MutationObserver(muts => {
        muts.forEach(mu => {
            const v = mu.target;
            if (v.classList.contains('active') && /DashboardView$|^dashboardView$|^hubView$/.test(v.id)) {
                const h = v.querySelector('h1');
                if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); window.scrollTo(0, 0); }
            }
        });
    }).observe($('#app'), { subtree: true, attributes: true, attributeFilter: ['class'] });
})();
