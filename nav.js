/* =====================================================================
   NAVIGASI BACK TINGKAT HUB (Game 1–4)
   - Satu lapisan untuk seluruh hub: memakai History API (pushState + popstate)
     yang dikaitkan ke switchView() dan layar-layar Memo Mayhem.
   - Setiap halaman = satu entri riwayat. Tombol/gestur Back perangkat dan
     tombol Back/Forward browser berjalan lewat popstate yang sama.
   - URL tidak diubah (tidak butuh konfigurasi server / GitHub Pages).
   - Tidak mengubah logika game: Back saat gameplay memakai dialog konfirmasi
     yang SAMA dengan tombol X di tiap game, dan hanya muncul bila progres berisiko.
===================================================================== */
(function () {
    'use strict';
    if (!window.history || !history.pushState || typeof window.switchView !== 'function') return;

    const origSwitch = window.switchView;
    const MEMO_PAGES = ['home', 'setup', 'stats', 'ach', 'settings', 'help'];
    const GAME_KEYS = ['game', 'knowledgeGame', 'advmathGame'];
    const EXIT_BTN = { game: 'backToDashboardButton', knowledgeGame: 'knowledgeBackToDashboardButton', advmathGame: 'advmathBackToDashboardButton' };

    let stack = ['hub'];       // kunci halaman sampai entri riwayat saat ini
    let applying = false;      // true saat popstate sedang menggambar halaman (hook tidak boleh push)
    let pending = null;        // pop programatik yang sedang ditunggu
    let pendingTimer = null;
    let deferredKey = null;

    const MM = () => window.MM;
    const memoKey = name => MEMO_PAGES.indexOf(name) >= 0 ? 'memo:' + name : 'memo:session'; // briefing/play/duel/hasil = 1 entri sesi
    const isGame = k => GAME_KEYS.indexOf(k) >= 0;
    const restorable = k => !isGame(k) && k !== 'memo:session';
    const top = () => stack[stack.length - 1];
    const stateOf = st => ({ hubNav: 1, stack: st.slice() });

    function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

    /* ---------- Apakah progres gameplay berisiko hilang? (sama dengan syarat tombol X) ---------- */
    function atRisk(key) {
        if (key === 'game') return safe(() => !!(gameInProgress || duelState), false);
        if (key === 'knowledgeGame') return safe(() => !!(knowledgeGameInProgress || knowledgeDuelState), false);
        if (key === 'advmathGame') return safe(() => !!(advmathGameInProgress || advmathDuelState), false);
        if (key === 'memo:session') return safe(() => !!(MM() && MM().atRisk && MM().atRisk()), false);
        return false;
    }

    /* ---------- Menggambar halaman dari kunci (dipakai Back/Forward) ---------- */
    function render(key) {
        applying = true;
        try {
            if (key.indexOf('memo:') === 0) {
                origSwitch('memo');
                const page = key.slice(5);
                if (MM() && MM().nav && MM().nav[page]) MM().nav[page](); else if (MM() && MM().nav) MM().nav.home();
            } else {
                if (MM() && MM().leave && document.getElementById('memoView').classList.contains('active')) MM().leave();
                if (key === 'dashboard') goToDashboard();
                else if (key === 'knowledgeDashboard') goToKnowledgeDashboard();
                else if (key === 'advmathDashboard') goToAdvmathDashboard();
                else goToHub();
            }
        } finally { applying = false; }
    }

    /* ---------- Penulisan riwayat ---------- */
    function setPending(extra) {
        pending = extra || {};
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => { if (pending) finishPending(null); }, 800); // pengaman bila popstate tidak datang
    }
    function finishPending(state) {
        const p = pending; pending = null; clearTimeout(pendingTimer);
        if (state && state.hubNav) stack = state.stack.slice();
        else if (p && p.target) stack = p.target.slice();
        if (p && p.after) p.after();
        if (deferredKey) { const k = deferredKey; deferredKey = null; navTo(k); }
    }
    function push(key) {
        stack = stack.concat(key);
        try { history.pushState(stateOf(stack), ''); } catch (e) { /* riwayat tidak tersedia: abaikan */ }
    }
    // Dipanggil setiap kali tampilan berganti lewat kode aplikasi (bukan lewat Back).
    function navTo(key) {
        if (applying) return;
        if (pending) { deferredKey = key; return; }
        if (key === top()) return;
        const j = stack.slice(0, -1).lastIndexOf(key);
        if (j >= 0) { // halaman itu sudah ada di belakang: mundur ke sana, jangan menumpuk entri ganda
            const target = stack.slice(0, j + 1);
            setPending({ target });
            history.go(j - (stack.length - 1));
        } else push(key);
    }

    /* ---------- Sesuatu yang terbuka di atas halaman (modal/overlay)? Back menutupnya dulu ---------- */
    function closeTransient() {
        const m = document.querySelector('.modal.show');
        if (m) {
            if (m.getAttribute('data-bs-backdrop') !== 'static') safe(() => bootstrap.Modal.getInstance(m).hide());
            return true; // modal statis (mis. simpan skor / hasil) tidak ditutup lewat Back, tapi Back tidak keluar juga
        }
        const o = document.getElementById('mmOverlay');
        if (o) {
            const no = o.querySelector('[data-c="no"]');
            if (no) no.click();
            else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                if (document.getElementById('mmOverlay')) MM().closeOverlay();
            }
            return true;
        }
        return false;
    }

    /* ---------- Keluar dari gameplay lewat Back (setelah pemain memilih "Keluar") ---------- */
    function leaveSessionBack() {
        const prev = stack[stack.length - 2];
        const dest = prev && restorable(prev) ? prev : 'hub';
        render(dest);
        setPending({ target: stack.slice(0, Math.max(1, stack.length - 1)) });
        history.back();
    }
    function askLeave(key) {
        if (key === 'memo:session') { MM().askLeave(leaveSessionBack); return; }
        const btn = document.getElementById(EXIT_BTN[key]);
        if (btn) btn.click(); // membuka dialog "keluar?" yang sama seperti tombol X
    }

    /* ---------- popstate: tombol Back/Forward perangkat & browser ---------- */
    window.addEventListener('popstate', ev => {
        if (pending) { finishPending(ev.state); return; }
        const from = stack, fromKey = top();
        const st = ev.state && ev.state.hubNav ? ev.state : null;
        const to = st ? st.stack : ['hub'], toKey = to[to.length - 1];
        const stepBack = to.length < from.length;
        const undo = () => { setPending({ target: from }); history.go(stepBack ? 1 : -1); };

        // 1) modal/overlay terbuka → Back menutupnya, halaman tetap
        if (closeTransient()) { undo(); return; }
        // 2) gameplay berisiko → batalkan perpindahan & tanyakan dulu (Stay/Leave)
        if (toKey !== fromKey && atRisk(fromKey)) { setPending({ target: from, after: () => askLeave(fromKey) }); history.go(stepBack ? 1 : -1); return; }
        // 3) tujuan tak bisa dipulihkan (layar gameplay lama) → lewati ke belakang / abaikan maju
        if (!restorable(toKey)) { history.back(); return; }
        // 4) halaman biasa
        stack = to.slice();
        if (toKey !== fromKey) render(toKey);
    });

    /* ---------- Hook ---------- */
    window.switchView = function (viewName) {
        origSwitch.apply(this, arguments);
        navTo(viewName === 'memo' ? 'memo:home' : viewName);
    };
    window.HubNav = {
        memoScreen(name) { navTo(memoKey(name)); },
        stack: () => stack.slice()
    };

    // Entri awal: selalu mulai dari hub (reload di tengah game kembali ke hub).
    try { history.replaceState(stateOf(['hub']), ''); } catch (e) { /* abaikan */ }
})();
