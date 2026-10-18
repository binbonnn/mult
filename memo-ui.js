/* =====================================================================
   MEMO MAYHEM — LAYAR MENU: beranda, setup, briefing, hasil + Memory
   Autopsy, statistik/papan peringkat lokal, pencapaian, pengaturan,
   bantuan, duel lokal, Daily/Endless/Boss.
===================================================================== */
(function () {
    'use strict';
    const C = MemoCore, D = MemoData, MM = window.MM, sfx = D.sfx, CL = window.MemoCloud;
    const { esc, $, $$, root, view, mimo, confirmBox, overlay, closeOverlay } = MM;
    const mode = id => C.MODE_INFO[id];
    const fmtDate = ts => { const d = new Date(ts); return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); };
    const pct = x => Math.round(x * 100) + '%';
    const UI = { setupKind: 'standard', setup: Object.assign({ mods: [] }, D.data.settings.last), duel: null, statsTab: 'board', board: { sel: 'snapshot', diff: 'normal', rounds: 10 }, lastCfg: null };
    UI.setup.mods = [];

    function show(html, name) {
        MM.closeOverlay();
        view.classList.toggle('mm-reduce', !!D.data.settings.reduceMotion);
        view.setAttribute('data-mm-screen', name);
        if (window.HubNav) HubNav.memoScreen(name);
        root.innerHTML = '<div class="mm-screen mm-menu mm-s-' + name + '">' + html + '</div>';
        window.scrollTo(0, 0);
    }
    const backBtn = (id, label) => '<button type="button" class="breadcrumb-back" id="' + id + '">' + (label || '← Kembali') + '</button>';
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };

    /* =====================================================================
       BERANDA
    ===================================================================== */
    function home() {
        MM.abort(true);
        const pr = D.activeProfile(), today = C.dateKey();
        const dd = (D.data.daily[today] || {})[pr.id];
        initCloud();
        const eb = D.data.endless.best, bb = D.data.boss.best;
        show(
            backBtn('mmBackHub', '← Semua Game') +
            '<header class="mm-hero"><div class="mm-hero-text"><p class="mm-kicker">RECALL STATION · MINDCORE ERROR</p>' +
            '<h1 class="mm-title">MEMO MAYHEM<span>COSMIC RECALL</span></h1><p class="mm-tagline">Trust your memory. Question everything.</p></div>' +
            '<div class="mm-hero-mimo">' + mimo('happy', 'idle', 'mimo-hero') + '</div></header>' +
            '<button type="button" class="btn-playful btn-playful-primary mm-cta" id="mmStart">▶️ Mulai Eksperimen</button>' + registerBanner(pr) +
            '<div class="mm-special-grid">' +
            '<button type="button" class="mm-special" id="mmDaily"><span class="mm-sp-ico">📅</span><b>Daily Challenge</b><small>' + (dd ? 'Terbaikmu hari ini: ' + dd.best : 'Set sama untuk semua pemain hari ini') + '</small></button>' +
            '<button type="button" class="mm-special" id="mmEndless"><span class="mm-sp-ico">♾️</span><b>Endless Mode</b><small>' + (eb ? 'Rekor: ' + eb.rounds + ' ronde' : 'Bertahan selama mungkin') + '</small></button>' +
            '<button type="button" class="mm-special" id="mmBoss"><span class="mm-sp-ico">👾</span><b>Boss Experiment</b><small>' + (D.data.boss.clears ? 'Ditaklukkan ' + D.data.boss.clears + '×' : '5 fase, 10 ronde') + '</small></button>' +
            '<button type="button" class="mm-special" id="mmDuel"><span class="mm-sp-ico">⚔️</span><b>Duel Lokal</b><small>Dua pemain, satu perangkat</small></button></div>' +
            '<nav class="mm-links"><button type="button" id="mmGoStats">📊 Statistik</button><button type="button" id="mmGoAch">🏆 Pencapaian</button><button type="button" id="mmGoSet">⚙️ Pengaturan</button><button type="button" id="mmGoHelp">❔ Cara Main</button></nav>' +
            cloudBanner(pr) +
            '<button type="button" class="mm-profile-chip" id="mmProfileChip" aria-label="Ganti profil">' + esc(pr.icon) + ' ' + esc(pr.name) + ' <span class="mm-cloud-ico" title="' + (pr.pid ? 'Terdaftar online' : 'Profil lokal') + '">' + (pr.pid ? '☁️' : '📴') + '</span> ▾</button>', 'home');
        on('#mmRegister', () => registerFlow(pr, { after: home }));
        on('#mmCloudRetry', () => { CL.retryInit().then(() => { CL.flush(); home(); }); });
        on('#mmBackHub', () => { MM.abort(true); if (typeof switchView === 'function') switchView('hub'); });
        on('#mmStart', () => { UI.setupKind = 'standard'; setupScreen(); });
        on('#mmDuel', () => { UI.setupKind = 'duel'; if (!UI.duel) UI.duel = { p1: D.data.profiles[0].id, p2: (D.data.profiles[1] || D.data.profiles[0]).id }; setupScreen(); });
        on('#mmDaily', () => briefing({ type: 'daily', seed: today, practice: false, mods: 'auto' }));
        on('#mmEndless', () => briefing({ type: 'endless', seed: 'e' + Date.now().toString(36), practice: false, mods: 'auto' }));
        on('#mmBoss', () => briefing({ type: 'boss', seed: 'boss-v1', practice: false }));
        on('#mmGoStats', () => statsScreen());
        on('#mmGoAch', achScreen);
        on('#mmGoSet', settingsScreen);
        on('#mmGoHelp', helpScreen);
        on('#mmProfileChip', () => profilePicker(home));
    }
    MM.home = home;

    /* ---------- Pemilih profil ---------- */
    function profilePicker(after) {
        const render = () => {
            const el = overlay('<h3>👤 Pilih Profil</h3><div class="mm-prof-list">' + D.data.profiles.map(p => '<button class="mm-prof ' + (p.id === D.data.active ? 'is-active' : '') + '" data-id="' + p.id + '"><span>' + esc(p.icon) + '</span>' + esc(p.name) + ' <small>' + (p.pid ? '☁️' : '📴') + '</small></button>').join('') + '</div>' +
                '<div class="mm-dialog-actions"><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmAddProf">＋ Profil baru</button><button class="btn-playful btn-playful-primary" id="mmProfDone">Selesai</button></div>');
            el.addEventListener('click', ev => {
                const b = ev.target.closest('.mm-prof'); if (b) { D.setActive(b.dataset.id); render(); }
            });
            $('#mmAddProf', el).addEventListener('click', () => newProfileFlow(p => { D.setActive(p.id); profilePicker(after); }, () => profilePicker(after)));
            $('#mmProfDone', el).addEventListener('click', () => { closeOverlay(); after && after(); });
        };
        render();
    }

    /* =====================================================================
       FIREBASE: koneksi, daftar nama unik, status simpan
    ===================================================================== */
    let cloudBooted = false;
    function initCloud() {
        if (!CL || cloudBooted) return;
        cloudBooted = true;
        CL.init().then(r => { if (r.ok && CL.pending()) CL.flush(); if (view.getAttribute('data-mm-screen') === 'home') home(); });
    }
    function cloudText() {
        if (!CL) return { cls: 'off', t: '📴 Mode lokal' };
        const st = CL.state;
        if (st.status === 'online') return { cls: 'on', t: '🌐 Terhubung ke server' + (CL.pending() ? ' · ' + CL.pending() + ' sesi menunggu disimpan' : '') };
        if (st.status === 'connecting' || st.status === 'idle') return { cls: 'busy', t: '⏳ Menghubungkan ke server…' };
        if (st.status === 'off') return { cls: 'off', t: '📴 Mode lokal — ' + st.reason };
        return { cls: 'err', t: '⚠️ Server tidak terjangkau — ' + st.reason };
    }
    function cloudLineHTML() { const c = cloudText(); return '<p class="mm-cloudline is-' + c.cls + '" id="mmCloudLine" role="status">' + esc(c.t) + '</p>'; }
    function registerBanner(pr) {
        if (!pr.pid && CL && CL.state.status !== 'off') return '<div class="mm-cloudbanner"><div><b>☁️ Daftarkan nama pemain</b><small>Profil "' + esc(pr.name) + '" masih lokal. Daftarkan nama unik agar skor, statistik, dan pencapaianmu tersimpan di server serta tampil di papan peringkat semua pemain.</small></div><button type="button" class="btn-playful btn-playful-primary mm-mini-btn" id="mmRegister">Daftarkan</button></div>';
        return '';
    }
    function cloudBanner() {
        const retry = CL && CL.state.status === 'error' ? ' <button type="button" class="mm-linkbtn" id="mmCloudRetry">Coba lagi</button>' : '';
        return cloudLineHTML().replace('</p>', retry + '</p>');
    }

    /* Daftarkan nama (unik khusus Memo Mayhem). lp = profil lokal yang didaftarkan, atau null untuk profil baru. */
    function registerFlow(lp, opts) {
        opts = opts || {};
        const draft = { pid: (lp && lp.pid) || CL.newPid(), icon: (lp && lp.icon) || '👽' };
        const el = overlay('<h3>☁️ ' + (lp ? 'Daftarkan nama pemain' : 'Profil baru') + '</h3>' +
            '<p>Nama tampil di papan peringkat Memo Mayhem dan harus <b>unik</b> (huruf besar/kecil dianggap sama). Setelah terdaftar, nama tidak bisa diubah. Nama yang sama di game lain tidak berpengaruh.</p>' +
            '<label class="mm-field">Nama pemain<input id="mmRegName" maxlength="14" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(lp ? lp.name : '') + '" placeholder="3–14 karakter"></label>' +
            '<p class="mm-reg-msg" id="mmRegMsg" role="status" aria-live="polite"></p>' +
            '<div class="mm-dialog-actions mm-col"><button class="btn-playful btn-playful-primary" id="mmRegGo">☁️ Daftarkan</button>' +
            (opts.allowLocal ? '<button class="btn-playful btn-playful-secondary" id="mmRegLocal">Buat profil lokal saja</button>' : '') +
            '<button class="btn-playful btn-playful-secondary" id="mmRegCancel">Batal</button></div>', 'mm-reg');
        const input = $('#mmRegName', el), msg = $('#mmRegMsg', el), go = $('#mmRegGo', el);
        const say = (t, cls) => { msg.textContent = t; msg.className = 'mm-reg-msg ' + (cls || ''); };
        let seq = 0, timer = null, busy = false;
        const check = () => {
            const my = ++seq, v = input.value;
            if (!v.trim()) { say(''); return; }
            const nn = CL.normName(v);
            if (!nn.ok) { say(nn.error, 'is-bad'); return; }
            say('Memeriksa ketersediaan…', 'is-busy');
            CL.checkName(v, draft.pid).then(r => {
                if (my !== seq) return;
                if (!r.ok) say(r.message, 'is-bad');
                else say(r.free ? '✅ Nama tersedia.' : 'Nama ini sudah digunakan di Memo Mayhem. Coba nama lain.', r.free ? 'is-ok' : 'is-bad');
            });
        };
        input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 450); });
        input.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
        go.addEventListener('click', async () => {
            if (busy) return;
            const nn = CL.normName(input.value);
            if (!nn.ok) { say(nn.error, 'is-bad'); input.focus(); return; }
            busy = true; go.disabled = true; seq++; say('Mendaftarkan nama…', 'is-busy');
            const r = await CL.registerProfile(draft, input.value);
            busy = false; go.disabled = false;
            if (!r.ok) { say(r.message, 'is-bad'); input.focus(); return; } // isian tetap, pemain bisa mencoba nama lain
            let p = lp;
            if (!p) p = D.addProfile(r.name, D.unlockedCreatures()[0]);
            D.markOnline(p.id, r);
            closeOverlay();
            opts.after && opts.after(p);
        });
        const cancel = () => { closeOverlay(); opts.cancel && opts.cancel(); };
        $('#mmRegCancel', el).addEventListener('click', cancel);
        const lc = $('#mmRegLocal', el);
        if (lc) lc.addEventListener('click', () => { const p = D.addProfile(input.value, D.unlockedCreatures()[0]); closeOverlay(); opts.after && opts.after(p); });
        setTimeout(() => { input.focus(); if (input.value) check(); }, 50);
    }
    function newProfileFlow(after, cancel, allowLocal) {
        if (!CL) { const p = D.addProfile('', D.unlockedCreatures()[0]); after && after(p); return; }
        CL.init().then(r => {
            if (r.ok) return registerFlow(null, { after, cancel, allowLocal: true });
            overlay('<h3>📴 Server tidak tersedia</h3><p>' + esc(r.message) + '</p><p>Kamu tetap bisa membuat profil lokal sekarang dan mendaftarkan namanya ke server nanti.</p>' +
                '<div class="mm-dialog-actions mm-col"><button class="btn-playful btn-playful-primary" id="mmLocOk">Buat profil lokal</button><button class="btn-playful btn-playful-secondary" id="mmLocNo">Batal</button></div>');
            on('#mmLocOk', () => { closeOverlay(); const p = D.addProfile('', D.unlockedCreatures()[0]); after && after(p); });
            on('#mmLocNo', () => { closeOverlay(); cancel && cancel(); });
        });
    }

    /* Status penyimpanan di layar hasil: "tersimpan" hanya setelah server mengonfirmasi. */
    async function syncUI(sids, label) {
        const box = () => $('#mmSync');
        const first = sids.filter(Boolean);
        if (!box() || !first.length) return;
        const set = (cls, html) => { const b = box(); if (b) { b.className = 'mm-sync is-' + cls; b.innerHTML = html; } };
        set('busy', '⏳ Menyimpan ke server…');
        await CL.flush();
        if (!box()) return;
        const rs = first.map(s => CL.outcomes[s]);
        if (rs.every(r => r && r.ok)) {
            let html = '✅ Tersimpan di server' + (rs.some(r => r.entered) ? ' · masuk papan peringkat online' : '');
            set('ok', html);
            const r0 = rs[0];
            if (label && label.bk && r0.entered !== undefined) {
                const bd = await CL.getBoard(label.bk);
                if (bd.ok && box()) { const i = bd.rows.findIndex(x => x.pid === label.pid); if (i >= 0) set('ok', html + ' · peringkat <b>#' + (i + 1) + '</b> di papan online'); }
            }
            return;
        }
        const bad = rs.find(r => !r || !r.ok);
        const why = bad && bad.message ? bad.message : (CL.state.reason || 'Menunggu koneksi.');
        set('err', '⚠️ Belum tersimpan di server: ' + esc(why) + '<br><small>Skormu aman di perangkat ini dan akan dicoba lagi otomatis.</small> <button type="button" class="mm-linkbtn" id="mmSyncRetry">Coba lagi</button>');
        const b = $('#mmSyncRetry'); if (b) b.addEventListener('click', () => { CL.retryInit().then(() => syncUI(sids, label)); });
    }

    /* Profil publik pemain lain (data dari server) */
    async function showPlayer(pid) {
        const el = overlay('<h3>Memuat profil…</h3>');
        const r = await CL.getProfile(pid);
        if (!r.ok) { closeOverlay(); overlay('<h3>Profil tidak dapat dimuat</h3><p>' + esc(r.message) + '</p><div class="mm-dialog-actions"><button class="btn-playful btn-playful-primary" onclick="MM.closeOverlay()">Tutup</button></div>'); return; }
        const p = r.profile, st = p.st || {}, modes = st.modes || {};
        const fav = Object.keys(modes).sort((a, b) => modes[b] - modes[a])[0];
        const unlocked = D.ACH.filter(a => p.ach[a.id]);
        closeOverlay();
        overlay('<h3>' + esc(p.icon || '👽') + ' ' + esc(p.name) + '</h3><p class="mm-sub">Bergabung ' + (p.createdAt ? new Date(p.createdAt).toLocaleDateString('id-ID') : '—') + '</p>' +
            statGrid({ sessions: st.sessions || 0, best: st.bestScore || 0, acc: st.sessions ? (st.accSumP / 1000) / st.sessions : null, combo: st.bestCombo || 0, wins: st.duelWins || 0, fav }) +
            '<p class="mm-note">🏆 ' + unlocked.length + ' pencapaian ' + unlocked.map(a => a.creature).join(' ') + '</p>' +
            '<div class="mm-dialog-actions"><button class="btn-playful btn-playful-primary" onclick="MM.closeOverlay()">Tutup</button></div>');
    }
    function statGrid(x) {
        return '<div class="mm-ap-top"><div class="mm-ap-stat"><b>' + x.sessions + '</b><small>Total sesi</small></div><div class="mm-ap-stat"><b>' + x.best + '</b><small>Skor terbaik</small></div><div class="mm-ap-stat"><b>' + (x.acc == null ? '—' : pct(x.acc)) + '</b><small>Akurasi rata-rata</small></div><div class="mm-ap-stat"><b>' + x.combo + '</b><small>Combo terbaik</small></div><div class="mm-ap-stat"><b>' + x.wins + '</b><small>Menang duel</small></div><div class="mm-ap-stat"><b>' + (x.fav ? mode(x.fav).icon : '—') + '</b><small>Mode favorit</small></div></div>';
    }

    /* =====================================================================
       SETUP (standar & duel)
    ===================================================================== */
    function allModsForMode(m) {
        const set = new Set();
        C.kindsFor(m, 'expert').concat(C.kindsFor(m, 'normal')).forEach(k => C.modifiersFor(m, k).forEach(x => set.add(x)));
        return Array.from(set);
    }
    function setupScreen() {
        const S = UI.setup, duel = UI.setupKind === 'duel';
        const profOpts = sel => D.data.profiles.map(p => '<option value="' + p.id + '" ' + (p.id === sel ? 'selected' : '') + '>' + esc(p.icon + ' ' + p.name) + '</option>').join('');
        const mods = allModsForMode(S.mode);
        show(
            backBtn('mmBack') +
            '<header class="mm-head"><h2>' + (duel ? '⚔️ Duel Lokal' : '🧪 Atur Eksperimen') + '</h2><p>' + (duel ? 'Kedua pemain memainkan set tantangan yang SAMA, bergantian di perangkat ini.' : 'Pilih mode, kesulitan, dan jumlah ronde.') + '</p></header>' +
            '<section class="mm-sec"><h3>1 · Mode</h3><div class="mm-mode-grid">' + C.MODES.map(m => '<button type="button" class="mm-mode ' + (S.mode === m ? 'is-sel' : '') + '" data-mode="' + m + '" aria-pressed="' + (S.mode === m) + '"><span class="mm-mode-ico">' + mode(m).icon + '</span><b>' + mode(m).name + '</b><small>' + mode(m).sub + '</small><em>' + mode(m).desc + '</em></button>').join('') + '</div></section>' +
            '<section class="mm-sec mm-sec-row"><div><h3>2 · Kesulitan</h3><div class="mm-chips">' + C.DIFFS.map(d => '<button type="button" class="mm-chip-btn ' + (S.diff === d ? 'is-sel' : '') + '" data-diff="' + d + '" aria-pressed="' + (S.diff === d) + '"><b>' + C.DIFF_INFO[d].label + '</b><small>' + C.DIFF_INFO[d].tag + '</small></button>').join('') + '</div></div>' +
            '<div><h3>3 · Ronde</h3><div class="mm-chips mm-chips-sm">' + [10, 20, 30].map(n => '<button type="button" class="mm-chip-btn ' + (S.rounds === n ? 'is-sel' : '') + '" data-rounds="' + n + '" aria-pressed="' + (S.rounds === n) + '"><b>' + n + '</b><small>ronde</small></button>').join('') + '</div></div></section>' +
            (duel ? '<section class="mm-sec"><h3>4 · Pemain</h3><div class="mm-duel-pick"><label>Pemain 1<select id="mmP1">' + profOpts(UI.duel.p1) + '</select></label><span class="mm-vs">VS</span><label>Pemain 2<select id="mmP2">' + profOpts(UI.duel.p2) + '</select></label></div>' +
                '<div class="mm-dialog-actions"><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmAddProf">＋ Pemain baru</button></div>' +
                '<p class="mm-note">Aturan adil: set tantangan, timer, dan skor identik. Tanpa Hint & tanpa batas stabilitas (semua ronde dimainkan). Detail jawaban disembunyikan. <b>Tie-break:</b> skor sama → akurasi lebih tinggi → total waktu respons lebih cepat → seri.</p></section>' :
                '<section class="mm-sec"><h3>4 · Tipe permainan</h3><div class="mm-chips"><button type="button" class="mm-chip-btn ' + (S.play !== 'practice' ? 'is-sel' : '') + '" data-play="standard"><b>Standar</b><small>3 stability · 3 Hint (−20)</small></button><button type="button" class="mm-chip-btn ' + (S.play === 'practice' ? 'is-sel' : '') + '" data-play="practice"><b>Practice Lab</b><small>Tanpa penalti sesi · tidak masuk peringkat</small></button></div>' +
                (S.play === 'practice' ? '<div class="mm-modlab"><h4>Modifier (opsional)</h4><div class="mm-mod-list">' + mods.map(m => '<label class="mm-mod"><input type="checkbox" data-mod="' + m + '" ' + (S.mods.includes(m) ? 'checked' : '') + '><span>' + C.MODIFIERS[m].icon + ' <b>' + esc(C.MODIFIERS[m].name) + '</b><small>' + esc(C.MODIFIERS[m].desc) + '</small></span></label>').join('') + '</div><p class="mm-note">Dipilih = selalu aktif bila kompatibel (maks. 2, Double Recall tidak bersama Interference). Kosong = tanpa modifier.</p></div>' :
                    '<p class="mm-note">Modifier muncul otomatis sesuai kesulitan dan selalu ditandai di awal ronde.</p>') + '</section>') +
            '<div class="mm-cta-row"><button type="button" class="btn-playful btn-playful-primary mm-cta" id="mmGo">▶️ ' + (duel ? 'Mulai Duel' : 'Lanjut ke Briefing') + '</button></div>', 'setup');
        on('#mmBack', home);
        $$('.mm-mode').forEach(b => b.addEventListener('click', () => { S.mode = b.dataset.mode; S.mods = S.mods.filter(m => allModsForMode(S.mode).includes(m)); setupScreen(); }));
        $$('[data-diff]').forEach(b => b.addEventListener('click', () => { S.diff = b.dataset.diff; setupScreen(); }));
        $$('[data-rounds]').forEach(b => b.addEventListener('click', () => { S.rounds = +b.dataset.rounds; setupScreen(); }));
        $$('[data-play]').forEach(b => b.addEventListener('click', () => { S.play = b.dataset.play; setupScreen(); }));
        $$('[data-mod]').forEach(b => b.addEventListener('change', () => { const m = b.dataset.mod; S.mods = b.checked ? S.mods.concat(m) : S.mods.filter(x => x !== m); }));
        if (duel) {
            $('#mmP1').addEventListener('change', e => { UI.duel.p1 = e.target.value; });
            $('#mmP2').addEventListener('change', e => { UI.duel.p2 = e.target.value; });
            on('#mmAddProf', () => newProfileFlow(p => { UI.duel.p2 = p.id; setupScreen(); }, () => setupScreen(), true));
        }
        on('#mmGo', () => {
            D.data.settings.last = { mode: S.mode, diff: S.diff, rounds: S.rounds, play: S.play || 'standard' }; D.save();
            if (duel) {
                if (UI.duel.p1 === UI.duel.p2) { overlay('<h3>Pilih dua pemain berbeda</h3><p>Duel membutuhkan dua profil yang berbeda.</p><div class="mm-dialog-actions"><button class="btn-playful btn-playful-primary" onclick="MM.closeOverlay()">Mengerti</button></div>'); return; }
                startDuel();
            } else {
                const practice = S.play === 'practice';
                briefing({ type: 'standard', mode: S.mode, diff: S.diff, rounds: S.rounds, seed: 'r' + Date.now().toString(36), practice, mods: practice ? S.mods.slice() : 'auto' });
            }
        });
    }

    /* =====================================================================
       BRIEFING SESI
    ===================================================================== */
    function briefing(cfg, player) {
        UI.lastCfg = cfg;
        const pr = player || D.activeProfile();
        const practice = cfg.practice;
        const kinds = cfg.type === 'standard' ? Array.from(new Set(C.kindsFor(cfg.mode, cfg.diff))).map(k => C.KIND_TITLES[k === 'count' && cfg.mode === 'mindtrap' ? 'count2' : k]).join(' · ') : '';
        let title, lines = [];
        if (cfg.type === 'standard') { title = mode(cfg.mode).icon + ' ' + mode(cfg.mode).name; lines.push(mode(cfg.mode).desc, C.DIFF_INFO[cfg.diff].label + ' — ' + C.DIFF_INFO[cfg.diff].tag + ' · ' + cfg.rounds + ' ronde.', 'Jenis tantangan: ' + kinds + '.'); }
        else if (cfg.type === 'daily') { title = '📅 Daily Challenge'; lines.push('10 ronde campuran dengan seed tanggal ' + cfg.seed + ': semua pemain hari ini mendapat set yang sama.', 'Ronde 1–5 Normal, 6–10 Hard.'); }
        else if (cfg.type === 'endless') { title = '♾️ Endless Mode'; lines.push('Tantangan berlanjut sampai stabilitasmu habis atau kamu memilih berhenti.', 'Kesulitan naik bertahap tiap 4 ronde (Easy → Expert), lalu bertahan di Expert.'); }
        else if (cfg.type === 'boss') { title = '👾 Boss Experiment'; lines.push('MINDCORE menggabungkan mekanik dalam 5 fase (2 ronde per fase). Pola setiap fase tetap — bisa dipelajari.', C.BOSS_PHASES.map(p => p.title.replace(/^Fase \d · /, '')).join(' → ') + '.'); }
        const stab = practice ? 'Tanpa batas stabilitas.' : '3 stability point; salah menguranginya 1. Habis = sesi berakhir.';
        const hint = practice ? 'Hint gratis tanpa batas.' : '3 Hint per sesi; tiap Hint −' + C.SCORE_CFG.hintPenalty + ' poin dan menghilangkan bonus akurasi & sempurna.';
        show(
            backBtn('mmBack') +
            '<header class="mm-head"><div class="mm-head-mimo">' + mimo('happy', 'idle') + '</div><div><h2>' + title + '</h2><p class="mm-sub">Briefing Eksperimen' + (practice ? ' · Practice Lab' : '') + '</p></div></header>' +
            '<div class="mm-card mm-brief-card"><ul class="mm-rules">' + lines.map(l => '<li>' + esc(l) + '</li>').join('') +
            '<li>' + stab + '</li><li>' + hint + '</li>' +
            '<li>Skor ronde = 100 × pengali kesulitan × combo (maks ×2,0) + bonus kecepatan (0–50) + bonus akurasi (25) + ronde sempurna (100). Salah = 0 poin & memutus combo.</li>' +
            '<li>Alur tiap ronde: Amati → Simpan → Jawab → Umpan balik. Esc = jeda. Satu jawaban dinilai sekali.</li>' +
            (practice ? '<li><b>Practice Lab tidak masuk papan peringkat.</b></li>' : '') + '</ul></div>' +
            '<div class="mm-cta-row"><button type="button" class="btn-playful btn-playful-primary mm-cta" id="mmGo">🚀 Mulai Eksperimen</button></div>', 'briefing');
        on('#mmBack', () => (cfg.type === 'standard' ? setupScreen() : home()));
        on('#mmGo', () => { sfx.unlock(); MM.startSession(cfg, pr); });
    }

    /* =====================================================================
       DUEL
    ===================================================================== */
    function startDuel() {
        const S = UI.setup;
        const p1 = D.data.profiles.find(p => p.id === UI.duel.p1), p2 = D.data.profiles.find(p => p.id === UI.duel.p2);
        const cfg = { type: 'duel', mode: S.mode, diff: S.diff, rounds: S.rounds, seed: 'duel-' + Date.now().toString(36), practice: false, mods: 'auto' };
        UI.duelRun = { cfg, p1, p2, s1: null, s2: null, stage: 1 };
        duelStage(1);
    }
    function duelStage(n) {
        const run = UI.duelRun, pl = n === 1 ? run.p1 : run.p2;
        show('<header class="mm-head mm-center"><div class="mm-head-mimo">' + mimo('think', 'idle') + '</div><h2>' + esc(pl.icon + ' ' + pl.name) + ', giliranmu!</h2>' +
            '<p>' + (n === 1 ? 'Pemain 1 main dulu. Pemain 2 jangan melihat layar ya.' : 'Pemain 1 sudah selesai — skornya disembunyikan sampai kamu selesai. Set tantangannya sama persis.') + '</p></header>' +
            '<div class="mm-card"><ul class="mm-rules"><li>' + mode(run.cfg.mode).icon + ' ' + mode(run.cfg.mode).name + ' · ' + C.DIFF_INFO[run.cfg.diff].label + ' · ' + run.cfg.rounds + ' ronde</li><li>Semua ronde dimainkan (tanpa batas stabilitas), tanpa Hint.</li></ul></div>' +
            '<div class="mm-cta-row"><button type="button" class="btn-playful btn-playful-primary mm-cta" id="mmGo">▶️ ' + esc(pl.name) + ' Siap</button></div>' +
            '<div class="mm-cta-row"><button type="button" class="mm-linkbtn" id="mmCancel">Batalkan duel</button></div>', 'handoff');
        on('#mmGo', () => { sfx.unlock(); run.stage = n; MM.startSession(Object.assign({}, run.cfg), pl); });
        on('#mmCancel', () => confirmBox({ title: 'Batalkan duel?', text: 'Hasil duel ini tidak akan disimpan.', ok: 'Batalkan', danger: true, onOk: () => { UI.duelRun = null; home(); } }));
    }
    function duelResult() {
        const run = UI.duelRun, a = run.s1, b = run.s2;
        let winner = null, why = '';
        if (a.score !== b.score) { winner = a.score > b.score ? run.p1.id : run.p2.id; why = 'Skor lebih tinggi'; }
        else if (a.accuracy !== b.accuracy) { winner = a.accuracy > b.accuracy ? run.p1.id : run.p2.id; why = 'Skor seri — akurasi lebih tinggi'; }
        else if (a.totalMs !== b.totalMs) { winner = a.totalMs < b.totalMs ? run.p1.id : run.p2.id; why = 'Skor & akurasi seri — total waktu lebih cepat'; }
        else why = 'Semua metrik sama';
        const pack = (p, s) => ({ id: p.id, name: p.name, icon: p.icon, score: s.score, acc: s.accuracy, ms: s.totalMs, combo: s.bestCombo });
        const newAch = D.recordDuel({ mode: run.cfg.mode, diff: run.cfg.diff, rounds: run.cfg.rounds, seed: run.cfg.seed, p1: pack(run.p1, a), p2: pack(run.p2, b), winner }, [a, b]);
        const duelSids = [a.cloudSid, b.cloudSid].filter(Boolean);
        const wp = winner === run.p1.id ? run.p1 : winner === run.p2.id ? run.p2 : null;
        sfx.win();
        const col = (p, s, win) => '<div class="mm-duel-col ' + (win ? 'is-win' : '') + '"><div class="mm-duel-ava">' + esc(p.icon) + '</div><b>' + esc(p.name) + '</b><div class="mm-duel-score">' + s.score + '</div><small>Akurasi ' + pct(s.accuracy) + ' · Benar ' + s.correct + '/' + s.total + '</small><small>Combo terbaik ' + s.bestCombo + ' · Waktu ' + (s.totalMs / 1000).toFixed(1).replace('.', ',') + ' dtk</small>' + (win ? '<span class="mm-crown">👑 Pemenang</span>' : '') + '</div>';
        show('<header class="mm-head mm-center"><div class="mm-head-mimo">' + mimo(wp ? 'wow' : 'happy', wp ? 'jump' : 'idle') + '</div><h2>' + (wp ? esc(wp.icon + ' ' + wp.name) + ' menang!' : '🤝 Duel seri!') + '</h2><p>' + esc(why) + '</p></header>' +
            '<div class="mm-duel-res">' + col(run.p1, a, winner === run.p1.id) + '<span class="mm-vs">VS</span>' + col(run.p2, b, winner === run.p2.id) + '</div>' +
            (newAch.length ? achBox(newAch) : '') +
            (duelSids.length ? '<p class="mm-sync is-busy" id="mmSync" role="status" aria-live="polite">⏳ Menyimpan ke server…</p>' : '<p class="mm-sync is-off">📴 Pemain berprofil lokal tidak disimpan ke server.</p>') +
            '<div class="mm-cta-row"><button type="button" class="btn-playful btn-playful-primary" id="mmRe">🔁 Duel Ulang (set baru)</button><button type="button" class="btn-playful btn-playful-secondary" id="mmHome">🏠 Beranda</button></div>', 'duelres');
        on('#mmRe', startDuel); on('#mmHome', () => { UI.duelRun = null; home(); });
        if (duelSids.length) syncUI(duelSids, null);
    }

    /* =====================================================================
       AKHIR SESI → HASIL
    ===================================================================== */
    MM.onSessionEnd = function (sess, results, cfg, status) {
        if (cfg.type === 'duel') {
            const run = UI.duelRun;
            D.recordSession(sess, { duel: true });
            if (run.stage === 1) { run.s1 = sess; duelStage(2); } else { run.s2 = sess; duelResult(); }
            return;
        }
        const rec = D.recordSession(sess);
        resultScreen(sess, results, cfg, status, rec);
    };
    MM.onExit = function () { if (UI.duelRun) UI.duelRun = null; home(); };

    /* ---------- Antarmuka untuk navigasi Back tingkat hub (nav.js) ---------- */
    MM.nav = { home, setup: setupScreen, stats: statsScreen, ach: achScreen, settings: settingsScreen, help: helpScreen };
    MM.leave = function () { MM.abort(true); UI.duelRun = null; MM.closeOverlay(); };
    MM.atRisk = function () {
        const st = MM.state();
        if (!['ready', 'completed', 'failed', 'abandoned'].includes(st)) return true;
        return !!UI.duelRun && view.getAttribute('data-mm-screen') === 'handoff';
    };
    // Tampilkan konfirmasi keluar (sama seperti tombol keluar biasa). leaveFn dipanggil bila pemain memilih "Keluar".
    MM.askLeave = function (leaveFn) {
        if (!['ready', 'completed', 'failed', 'abandoned'].includes(MM.state())) { MM.requestExit(leaveFn); return; }
        MM.confirmBox({ title: 'Batalkan duel?', text: 'Hasil duel ini tidak akan disimpan.', ok: 'Keluar', cancel: 'Tetap di sini', danger: true, onOk: () => { UI.duelRun = null; leaveFn(); } });
    };

    function achBox(list) {
        return '<div class="mm-card mm-newach"><h3>🏆 Pencapaian baru!</h3>' + list.map(a => '<div class="mm-ach-row"><span class="mm-ach-ico">' + a.icon + '</span><div><b>' + esc(a.name) + '</b><small>' + esc(a.desc) + '</small></div><span class="mm-creature" title="Makhluk memori baru">' + a.creature + '</span></div>').join('') + '</div>';
    }

    function autopsy(results, cfg) {
        const n = results.length; if (!n) return '<p class="mm-note">Belum ada ronde yang diselesaikan.</p>';
        const ok = results.filter(r => r.correct).length;
        const ans = results.filter(r => !r.timeout);
        const avg = ans.length ? ans.reduce((a, b) => a + b.ms, 0) / ans.length : 0;
        const bars = results.map((r, i) => '<div class="mm-bar ' + (r.correct ? 'is-ok' : r.accuracy > 0 ? 'is-part' : 'is-bad') + '" title="Ronde ' + (i + 1) + ': ' + pct(r.accuracy) + '"><i style="height:' + Math.max(6, Math.round(r.accuracy * 100)) + '%"></i><span>' + (i + 1) + '</span></div>').join('');
        // per kesulitan
        const byD = {}; results.forEach(r => { const o = byD[r.diff] = byD[r.diff] || { n: 0, ok: 0 }; o.n++; if (r.correct) o.ok++; });
        const diffRows = Object.keys(byD).length > 1 ? '<div class="mm-ap-block"><h4>Performa per kesulitan</h4>' + C.DIFFS.filter(d => byD[d]).map(d => '<div class="mm-ap-row"><span>' + C.DIFF_INFO[d].label + '</span><div class="mm-ap-meter"><i style="width:' + Math.round(byD[d].ok / byD[d].n * 100) + '%"></i></div><b>' + byD[d].ok + '/' + byD[d].n + '</b></div>').join('') + '</div>' : '';
        // jenis paling sering salah
        const byK = {}; results.forEach(r => { const k = (r.mode + ':' + r.kind); const o = byK[k] = byK[k] || { n: 0, bad: 0, mode: r.mode, kind: r.kind }; o.n++; if (!r.correct) o.bad++; });
        const worst = Object.values(byK).filter(o => o.bad > 0).sort((a, b) => b.bad / b.n - a.bad / a.n || b.bad - a.bad).slice(0, 3);
        const worstHTML = worst.length ? '<div class="mm-ap-block"><h4>Jenis tantangan yang paling sering meleset</h4>' + worst.map(o => '<div class="mm-ap-row"><span>' + mode(o.mode).icon + ' ' + esc(C.KIND_TITLES[o.kind] || o.kind) + '</span><div class="mm-ap-meter is-bad"><i style="width:' + Math.round(o.bad / o.n * 100) + '%"></i></div><b>' + o.bad + '/' + o.n + ' salah</b></div>').join('') + '</div>' : '<div class="mm-ap-block"><h4>Jenis tantangan</h4><p class="mm-note">Tidak ada jenis yang meleset. Kerja bagus!</p></div>';
        // posisi urutan
        const pos = {}; let seqWrong = 0, seqTot = 0;
        results.forEach(r => { const f = r.detail && r.detail.flags; if (f && f.length > 1) { f.forEach((x, i) => { seqTot++; if (!x) { seqWrong++; pos[i + 1] = (pos[i + 1] || 0) + 1; } }); } });
        let seqHTML = '';
        if (seqTot) {
            const top = Object.keys(pos).sort((a, b) => pos[b] - pos[a])[0];
            seqHTML = '<div class="mm-ap-block"><h4>Kesalahan urutan</h4>' + (seqWrong ? '<p>' + seqWrong + ' dari ' + seqTot + ' elemen keliru. Paling sering di <b>posisi ke-' + top + '</b> (' + pos[top] + '×).</p>' : '<p>Semua elemen urutan tepat.</p>') + '</div>';
        }
        let cellHTML = ''; let missed = 0, wrongSel = 0, cellR = 0;
        results.forEach(r => { if (r.detail && r.detail.missed) { cellR++; missed += r.detail.missed.length; wrongSel += r.detail.wrong.length; } });
        if (cellR && (missed || wrongSel)) cellHTML = '<div class="mm-ap-block"><h4>Deteksi sel</h4><p>' + missed + ' sel berubah terlewat · ' + wrongSel + ' sel salah ditandai.</p></div>';
        const hints = results.reduce((a, b) => a + b.hints, 0), tos = results.filter(r => r.timeout).length;
        return '<div class="mm-autopsy"><div class="mm-ap-top"><div class="mm-ap-stat"><b>' + pct(ok / n) + '</b><small>Akurasi</small></div><div class="mm-ap-stat"><b>' + ok + '/' + n + '</b><small>Benar</small></div><div class="mm-ap-stat"><b>' + (avg / 1000).toFixed(1).replace('.', ',') + ' dtk</b><small>Respons rata-rata</small></div><div class="mm-ap-stat"><b>' + hints + '</b><small>Hint dipakai</small></div><div class="mm-ap-stat"><b>' + tos + '</b><small>Waktu habis</small></div></div>' +
            '<div class="mm-ap-block"><h4>Akurasi per ronde</h4><div class="mm-bars">' + bars + '</div></div>' + diffRows + worstHTML + seqHTML + cellHTML +
            '<p class="mm-disclaimer">Ini ringkasan performa permainan ini saja — bukan diagnosis atau pengukuran ilmiah kemampuan kognitif.</p></div>';
    }

    function resultScreen(sess, results, cfg, status, rec) {
        const failed = status === 'failed';
        const mood = failed ? 'sad' : (sess.accuracy >= 0.8 ? 'wow' : 'happy');
        const label = cfg.type === 'standard' ? mode(cfg.mode).icon + ' ' + mode(cfg.mode).name + ' · ' + C.DIFF_INFO[cfg.diff].label + ' · ' + cfg.rounds + ' ronde' + (cfg.practice ? ' · Latihan' : '') :
            cfg.type === 'daily' ? '📅 Daily Challenge ' + cfg.seed : cfg.type === 'endless' ? '♾️ Endless Mode' : '👾 Boss Experiment';
        const title = failed ? 'Stabilitas Habis' : cfg.type === 'boss' ? 'Boss Experiment Selesai!' : cfg.type === 'endless' ? 'Endless Selesai' : 'Eksperimen Selesai!';
        let phases = '';
        if (cfg.type === 'boss') {
            phases = '<div class="mm-card"><h3>Performa per fase</h3>' + C.BOSS_PHASES.map((p, i) => { const rs = results.filter(r => r.phase === i); if (!rs.length) return '<div class="mm-ap-row is-dim"><span>' + esc(p.title) + '</span><div class="mm-ap-meter"><i style="width:0"></i></div><b>—</b></div>'; const ok = rs.filter(r => r.correct).length; return '<div class="mm-ap-row"><span>' + esc(p.title) + '</span><div class="mm-ap-meter"><i style="width:' + Math.round(ok / rs.length * 100) + '%"></i></div><b>' + ok + '/' + rs.length + ' · ' + rs.reduce((a, b) => a + b.score, 0) + ' poin</b></div>'; }).join('') + '</div>';
        }
        const prof = D.data.profiles.find(p => p.id === sess.profileId) || {};
        const online = !!prof.pid;
        const recLine = cfg.practice ? '<p class="mm-rec">🧪 Practice Lab — tidak dicatat di papan peringkat.</p>' : rec.isRecord ? '<p class="mm-rec is-new">🏅 Rekor pribadi baru' + (!online && rec.rank ? ' · peringkat #' + rec.rank + ' di papan lokal' : '') + '!</p>' : (!online && rec.rank) ? '<p class="mm-rec">Masuk papan peringkat lokal: peringkat #' + rec.rank + '.</p>' : '';
        const syncLine = cfg.practice ? '' : online ? '<p class="mm-sync is-busy" id="mmSync" role="status" aria-live="polite">⏳ Menyimpan ke server…</p>' :
            '<p class="mm-sync is-off" role="status">📴 Profil lokal — skor hanya tersimpan di perangkat ini dan tidak masuk papan peringkat online. ' + (CL && CL.state.status !== 'off' ? '<button type="button" class="mm-linkbtn" id="mmRegHere">Daftarkan nama</button>' : '') + '</p>';
        const rows = results.map((r, i) => '<tr class="' + (r.correct ? 'is-ok' : 'is-bad') + '"><td>' + (i + 1) + '</td><td>' + mode(r.mode).icon + ' ' + esc(C.KIND_TITLES[r.kind] || r.kind) + (r.mods.length ? ' ' + r.mods.map(m => C.MODIFIERS[m].icon).join('') : '') + '</td><td>' + C.DIFF_INFO[r.diff].label + '</td><td>' + (r.correct ? '✔' : r.timeout ? '⏱' : '✖') + '</td><td>' + (r.ms / 1000).toFixed(1).replace('.', ',') + ' dtk</td><td>' + r.score + '</td></tr>').join('');
        show('<header class="mm-head mm-center"><div class="mm-head-mimo">' + mimo(mood, failed ? 'idle' : 'jump') + '</div><h2>' + title + '</h2><p class="mm-sub">' + esc(label) + '</p></header>' +
            '<div class="mm-result-top"><div class="mm-bigscore"><small>Skor Akhir</small><b>' + sess.score + '</b></div>' +
            '<div class="mm-res-chips"><span>🎯 ' + pct(sess.accuracy) + ' akurasi</span><span>✅ ' + sess.correct + '/' + sess.total + ' benar</span><span>🔥 Combo ' + sess.bestCombo + '</span>' + (cfg.type === 'endless' ? '<span>♾️ ' + sess.total + ' ronde</span>' : '') + '</div></div>' + recLine + syncLine +
            (rec.newAch.length ? achBox(rec.newAch) : '') + phases +
            '<div class="mm-card"><h3>🔬 Memory Autopsy</h3>' + autopsy(results, cfg) + '</div>' +
            '<details class="mm-card mm-rounds"><summary>📋 Rincian skor per ronde (jumlah = ' + sess.score + ')</summary><div class="mm-tablewrap"><table class="mm-table"><thead><tr><th>#</th><th>Tantangan</th><th>Lvl</th><th></th><th>Waktu</th><th>Poin</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
            '<div class="mm-cta-row"><button type="button" class="btn-playful btn-playful-primary" id="mmAgain">🔁 Main Lagi</button><button type="button" class="btn-playful btn-playful-secondary" id="mmChange">⚙️ ' + (cfg.type === 'standard' ? 'Ganti Pengaturan' : 'Beranda') + '</button><button type="button" class="btn-playful btn-playful-secondary" id="mmStat">📊 Statistik</button></div>', 'result');
        on('#mmRegHere', () => registerFlow(prof, { after: () => resultScreen(sess, results, cfg, status, rec) }));
        if (online && !cfg.practice) syncUI([rec.sid], { bk: D.remoteKey(sess), pid: prof.pid });
        on('#mmAgain', () => { const c = Object.assign({}, cfg); if (c.type === 'standard' || c.type === 'endless') c.seed = (c.type === 'endless' ? 'e' : 'r') + Date.now().toString(36); MM.startSession(c, D.activeProfile()); });
        on('#mmChange', () => (cfg.type === 'standard' ? setupScreen() : home()));
        on('#mmStat', () => { UI.statsTab = 'board'; if (cfg.type === 'standard') UI.board = { sel: cfg.mode, diff: cfg.diff, rounds: cfg.rounds }; else UI.board.sel = cfg.type; statsScreen(); });
    }

    /* =====================================================================
       STATISTIK, PAPAN PERINGKAT, RIWAYAT, DUEL, PROFIL
    ===================================================================== */
    function statsScreen() {
        const tabs = [['board', '🏅 Peringkat'], ['hist', '🕘 Riwayat'], ['duel', '⚔️ Duel'], ['prof', '👤 Profil']];
        const T = UI.statsTab;
        let body = '';
        if (T === 'board') body = boardTab(); else if (T === 'hist') body = histTab(); else if (T === 'duel') body = duelTab(); else body = profTab();
        show(backBtn('mmBack') + '<header class="mm-head"><h2>📊 Statistik & Papan Peringkat</h2><p>Peringkat dan statistik pemain online diambil dari server. ' + (D.memoryOnly ? '<b>⚠ Penyimpanan browser tidak tersedia: cadangan lokal hilang saat halaman ditutup.</b>' : '') + '</p></header>' + cloudLineHTML() +
            '<div class="mm-tabs" role="tablist">' + tabs.map(t => '<button type="button" role="tab" class="mm-tab ' + (T === t[0] ? 'is-sel' : '') + '" data-tab="' + t[0] + '" aria-selected="' + (T === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' + body, 'stats');
        on('#mmBack', home);
        $$('.mm-tab').forEach(b => b.addEventListener('click', () => { UI.statsTab = b.dataset.tab; statsScreen(); }));
        bindStatsTab(T);
    }
    function boardKeyOf() {
        const B = UI.board;
        if (C.MODES.includes(B.sel)) return ['std', B.sel, B.diff, B.rounds].join('|');
        return B.sel === 'daily' ? 'daily|' + C.dateKey() : B.sel;
    }
    function rankRows(list, src) {
        if (!list.length) return '<li class="mm-empty">Belum ada skor di kategori ini. Jadilah yang pertama! 🏁</li>';
        const me = D.activeProfile().pid;
        return list.map((e, i) => {
            const inner = '<span class="mm-rank-n">' + (['🥇', '🥈', '🥉'][i] || (i + 1)) + '</span><span class="mm-rank-name">' + esc(e.icon || '👽') + ' ' + esc(e.name) + (me && e.pid === me ? ' <em>(kamu)</em>' : '') + '</span><span class="mm-rank-acc">' + (e.total != null && UI.board.sel === 'endless' ? e.total + ' ronde · ' : (e.extra != null ? e.extra + ' ronde · ' : '')) + pct(e.acc || 0) + '</span><b class="mm-rank-score">' + e.score + '</b>';
            return '<li class="mm-rank ' + (i < 3 ? 'is-top' : '') + '">' + (src === 'online' ? '<button type="button" class="mm-rank-btn" data-pid="' + esc(e.pid) + '" aria-label="Lihat profil ' + esc(e.name) + '">' + inner + '</button>' : inner) + '</li>';
        }).join('');
    }
    function boardTab() {
        const B = UI.board;
        const sels = C.MODES.map(m => [m, mode(m).icon + ' ' + mode(m).name]).concat([['daily', '📅 Daily'], ['endless', '♾️ Endless'], ['boss', '👾 Boss']]);
        const std = C.MODES.includes(B.sel);
        let extra = '';
        if (B.sel === 'daily') { const days = Object.keys(D.data.daily).sort().reverse().slice(0, 7); extra = '<h4 class="mm-sub-h">Riwayat Daily-mu di perangkat ini</h4>' + (days.length ? '<ul class="mm-plain">' + days.map(d => '<li><b>' + d + '</b> — ' + Object.values(D.data.daily[d]).map(x => esc(x.name) + ' ' + x.best).join(', ') + '</li>').join('') + '</ul>' : '<p class="mm-note">Belum ada riwayat Daily.</p>'); }
        const cat = std ? '<div class="mm-filter"><div class="mm-chips mm-chips-sm">' + C.DIFFS.map(d => '<button class="mm-chip-btn ' + (B.diff === d ? 'is-sel' : '') + '" data-bd="' + d + '"><b>' + C.DIFF_INFO[d].label + '</b></button>').join('') + '</div><div class="mm-chips mm-chips-sm">' + [10, 20, 30].map(n => '<button class="mm-chip-btn ' + (B.rounds === n ? 'is-sel' : '') + '" data-br="' + n + '"><b>' + n + ' ronde</b></button>').join('') + '</div></div>' : '';
        const note = std ? 'Hanya sesi Standar dengan mode, kesulitan, dan jumlah ronde yang sama yang dibandingkan.' : B.sel === 'daily' ? 'Papan ini untuk set tantangan tanggal ' + C.dateKey() + '.' : B.sel === 'endless' ? 'Skor Endless dibandingkan sesama sesi Endless.' : 'Skor Boss dibandingkan sesama sesi Boss.';
        return '<div class="mm-card"><label class="mm-selwrap">Kategori <select id="mmBoardSel">' + sels.map(s => '<option value="' + s[0] + '" ' + (B.sel === s[0] ? 'selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label>' + cat + '<p class="mm-note">' + note + '</p><p class="mm-note" id="mmBoardSrc">⏳ Memuat peringkat dari server…</p><ol class="mm-ranklist" id="mmRankList"></ol>' + extra + '</div>';
    }
    async function loadBoard() {
        const key = boardKeyOf(), want = key;
        const list = $('#mmRankList'), src = $('#mmBoardSrc'); if (!list) return;
        const r = CL ? await CL.getBoard(key.replace(/\|/g, '_')) : { ok: false, message: 'Mode lokal.' };
        if (!$('#mmRankList') || boardKeyOf() !== want) return; // pengguna sudah pindah kategori
        if (r.ok) {
            $('#mmBoardSrc').textContent = '🌐 Peringkat online — dilihat semua pemain. Ketuk nama untuk melihat profil.';
            $('#mmRankList').innerHTML = rankRows(r.rows, 'online');
            $$('.mm-rank-btn').forEach(b => b.addEventListener('click', () => showPlayer(b.dataset.pid)));
        } else {
            $('#mmBoardSrc').innerHTML = '⚠️ ' + esc(r.message) + ' Menampilkan skor lokal di perangkat ini (bukan peringkat online).';
            $('#mmRankList').innerHTML = rankRows(D.board(key), 'local');
        }
    }
    function histRow(s, remote) {
        const m = s.mode ? mode(s.mode) : null;
        const title = s.type === 'standard' ? (m ? m.name : 'Standar') : s.type === 'duel' ? 'Duel ' + (m ? m.name : '') : String(s.type).toUpperCase();
        const total = s.total, acc = remote ? (s.accP || 0) / 1000 : s.accuracy;
        return '<li><span class="mm-hist-ico">' + esc(remote ? (D.activeProfile().icon || '👽') : (s.icon || '👽')) + '</span><div class="mm-hist-main"><b>' + esc(s.name) + ' · ' + esc(title) + (s.type === 'duel' ? (s.won ? ' · 🏆 Menang' : '') : '') + '</b><small>' + (s.diff ? C.DIFF_INFO[s.diff].label + ' · ' : '') + total + ' ronde · ' + pct(acc) + ' · ' + fmtDate(s.ts) + (s.practice ? ' · Latihan' : '') + (s.failed ? ' · Gagal' : '') + '</small></div><b class="mm-hist-score">' + s.score + '</b></li>';
    }
    function histTab() {
        const pr = D.activeProfile();
        return '<div class="mm-card"><p class="mm-note" id="mmHistSrc">' + (pr.pid ? '⏳ Memuat riwayat dari server…' : '📴 Profil lokal — menampilkan riwayat di perangkat ini.') + '</p><div id="mmHistBody">' + (pr.pid ? '' : localHist()) + '</div></div>';
    }
    function localHist() {
        const list = D.data.sessions.slice(0, 15);
        return list.length ? '<ul class="mm-hist">' + list.map(s => histRow(s, false)).join('') + '</ul>' : '<p class="mm-empty">Belum ada sesi. Mulai eksperimen pertamamu!</p>';
    }
    async function loadHist() {
        const pr = D.activeProfile(); if (!pr.pid || !$('#mmHistBody')) return;
        const r = await CL.getHistory(pr.pid, 15);
        if (!$('#mmHistBody')) return;
        if (r.ok) {
            $('#mmHistSrc').textContent = '🌐 Riwayat tersimpan di server untuk ' + pr.name + '.';
            $('#mmHistBody').innerHTML = r.rows.length ? '<ul class="mm-hist">' + r.rows.map(x => histRow(x, true)).join('') + '</ul>' : '<p class="mm-empty">Belum ada sesi tersimpan. Mulai eksperimen pertamamu!</p>';
        } else {
            $('#mmHistSrc').innerHTML = '⚠️ ' + esc(r.message) + ' Menampilkan riwayat lokal di perangkat ini.';
            $('#mmHistBody').innerHTML = localHist();
        }
    }
    function duelTab() {
        const ds = D.data.duels;
        const stats = D.data.profiles.map(p => { const s = D.profileStats(p.id); return { p, w: s.wins, n: s.duelsPlayed }; }).filter(x => x.n > 0).sort((a, b) => b.w - a.w);
        if (!ds.length) return '<div class="mm-card"><p class="mm-empty">Belum ada duel. Coba Duel Lokal dari beranda! ⚔️</p></div>';
        return '<div class="mm-card"><h4 class="mm-sub-h">Kemenangan</h4><ul class="mm-plain">' + stats.map(x => '<li>' + esc(x.p.icon + ' ' + x.p.name) + ' — <b>' + x.w + '</b> menang dari ' + x.n + ' duel</li>').join('') + '</ul><h4 class="mm-sub-h">Duel terbaru</h4><ul class="mm-hist">' + ds.slice(0, 10).map(d => '<li><span class="mm-hist-ico">⚔️</span><div class="mm-hist-main"><b>' + esc(d.p1.name) + ' ' + d.p1.score + ' : ' + d.p2.score + ' ' + esc(d.p2.name) + '</b><small>' + mode(d.mode).name + ' · ' + C.DIFF_INFO[d.diff].label + ' · ' + d.rounds + ' ronde · ' + fmtDate(d.ts) + '</small></div><b class="mm-hist-score">' + (d.winner ? '🏆 ' + esc(d.winner === d.p1.id ? d.p1.name : d.p2.name) : '🤝') + '</b></li>').join('') + '</ul></div>';
    }
    function profTab() {
        const pr = D.activeProfile(), st = D.profileStats(pr.id), un = D.unlockedCreatures();
        const loc = { sessions: st.sessions, best: st.bestScore, acc: st.avgAcc, combo: st.bestCombo, wins: st.wins, fav: st.favMode };
        const nameRow = pr.pid ? '<p class="mm-note">☁️ Nama <b>' + esc(pr.name) + '</b> terdaftar di server dan tidak dapat diubah.</p>' :
            '<div class="mm-prof-add"><input id="mmRename" maxlength="14" value="' + esc(pr.name) + '" aria-label="Nama profil"><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmRenameBtn">Simpan nama</button></div>' +
            (CL && CL.state.status !== 'off' ? '<div class="mm-dialog-actions"><button class="btn-playful btn-playful-primary mm-mini-btn" id="mmRegProf">☁️ Daftarkan nama online</button></div>' : '');
        return '<div class="mm-card"><div class="mm-prof-head"><span class="mm-prof-ava">' + esc(pr.icon) + '</span><div><b>' + esc(pr.name) + '</b><small>' + (pr.pid ? 'Profil online · tanpa email/password' : 'Profil lokal · belum terdaftar online') + '</small></div></div>' +
            '<p class="mm-note" id="mmProfSrc">' + (pr.pid ? '⏳ Memuat statistik dari server…' : '📴 Statistik dari perangkat ini.') + '</p><div id="mmProfStats">' + statGrid(loc) + '</div>' +
            '<h4 class="mm-sub-h">Ganti ikon (makhluk memori terbuka)</h4><div class="mm-icons">' + D.CREATURES.map(c => '<button class="mm-icon-btn ' + (pr.icon === c ? 'is-sel' : '') + '" data-icon="' + c + '" ' + (un.includes(c) ? '' : 'disabled') + ' aria-label="Ikon ' + c + (un.includes(c) ? '' : ' terkunci') + '">' + (un.includes(c) ? c : '🔒') + '</button>').join('') + '</div><p class="mm-note" id="mmIconMsg"></p>' +
            nameRow +
            '<div class="mm-dialog-actions"><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmSwitchProf">👤 Ganti / tambah profil</button></div></div>';
    }
    async function loadProf() {
        const pr = D.activeProfile(); if (!pr.pid || !$('#mmProfStats')) return;
        const r = await CL.getProfile(pr.pid);
        if (!$('#mmProfStats')) return;
        if (r.ok) {
            const st = r.profile.st || {}, modes = st.modes || {};
            const fav = Object.keys(modes).sort((a, b) => modes[b] - modes[a])[0];
            $('#mmProfSrc').textContent = '🌐 Statistik tersimpan di server · ' + (st.sessions || 0) + ' sesi tercatat · total waktu main ' + ((st.totalMs || 0) < 60000 ? Math.round((st.totalMs || 0) / 1000) + ' dtk' : Math.round((st.totalMs || 0) / 60000) + ' menit') + '.';
            $('#mmProfStats').innerHTML = statGrid({ sessions: st.sessions || 0, best: st.bestScore || 0, acc: st.sessions ? (st.accSumP / 1000) / st.sessions : null, combo: st.bestCombo || 0, wins: st.duelWins || 0, fav });
        } else $('#mmProfSrc').innerHTML = '⚠️ ' + esc(r.message) + ' Menampilkan statistik lokal di perangkat ini.';
    }
    function bindStatsTab(T) {
        if (T === 'board') {
            const sel = $('#mmBoardSel'); if (sel) sel.addEventListener('change', e => { UI.board.sel = e.target.value; statsScreen(); });
            $$('[data-bd]').forEach(b => b.addEventListener('click', () => { UI.board.diff = b.dataset.bd; statsScreen(); }));
            $$('[data-br]').forEach(b => b.addEventListener('click', () => { UI.board.rounds = +b.dataset.br; statsScreen(); }));
            loadBoard();
        } else if (T === 'hist') {
            loadHist();
        } else if (T === 'prof') {
            $$('.mm-icon-btn').forEach(b => b.addEventListener('click', async () => {
                if (b.disabled) return;
                const pr = D.activeProfile(), icon = b.dataset.icon;
                if (pr.pid) {
                    const r = await CL.updateIcon(pr.pid, icon);
                    if (!r.ok) { const m = $('#mmIconMsg'); if (m) m.textContent = '⚠️ Ikon belum tersimpan di server: ' + r.message; return; }
                }
                D.updateProfile(D.data.active, { icon }); statsScreen();
            }));
            on('#mmRenameBtn', () => { D.updateProfile(D.data.active, { name: $('#mmRename').value }); statsScreen(); });
            on('#mmRegProf', () => registerFlow(D.activeProfile(), { after: statsScreen }));
            on('#mmSwitchProf', () => profilePicker(statsScreen));
            loadProf();
        }
    }

    /* =====================================================================
       PENCAPAIAN
    ===================================================================== */
    function achScreen() {
        const am = D.achMap(), got = D.ACH.filter(a => am[a.id]).length;
        show(backBtn('mmBack') + '<header class="mm-head"><h2>🏆 Pencapaian</h2><p>' + got + ' dari ' + D.ACH.length + ' terbuka. Makhluk memori hanya kosmetik — tanpa keunggulan gameplay.</p></header>' +
            '<div class="mm-ach-grid">' + D.ACH.map(a => { const u = am[a.id]; return '<div class="mm-ach ' + (u ? 'is-unlocked' : '') + '"><span class="mm-ach-ico">' + (u ? a.icon : '🔒') + '</span><div><b>' + esc(a.name) + '</b><small>' + esc(a.desc) + '</small>' + (u ? '<em>' + new Date(u).toLocaleDateString('id-ID') + '</em>' : '') + '</div><span class="mm-creature ' + (u ? '' : 'is-locked') + '">' + (u ? a.creature : '❔') + '</span></div>'; }).join('') + '</div>', 'ach');
        on('#mmBack', home);
    }

    /* =====================================================================
       PENGATURAN
    ===================================================================== */
    function settingsScreen() {
        const s = D.data.settings;
        show(backBtn('mmBack') + '<header class="mm-head"><h2>⚙️ Pengaturan</h2></header>' +
            '<div class="mm-card mm-settings">' +
            '<label class="mm-set-row"><span>🔊 Suara<small>Efek & nada Echo Chamber. Mode Echo tetap bisa dimainkan lewat tampilan visual.</small></span><input type="checkbox" id="mmSound" ' + (s.sound ? 'checked' : '') + '></label>' +
            '<label class="mm-set-row"><span>🎚 Volume<small id="mmVolTxt">' + Math.round(s.volume * 100) + '%</small></span><input type="range" min="0" max="100" value="' + Math.round(s.volume * 100) + '" id="mmVol" aria-label="Volume"></label>' +
            '<label class="mm-set-row"><span>🌀 Kurangi animasi<small>Menonaktifkan getaran, dekorasi melayang, dan animasi berulang.</small></span><input type="checkbox" id="mmReduce" ' + (s.reduceMotion ? 'checked' : '') + '></label>' +
            '<div class="mm-set-row"><span>🔈 Tes suara<small>Pastikan perangkatmu mengeluarkan bunyi.</small></span><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmTest">Putar</button></div>' +
            '<div class="mm-set-row"><span>☁️ Server<small id="mmSetCloud">' + esc(cloudText().t) + '</small></span><button class="btn-playful btn-playful-secondary mm-mini-btn" id="mmSyncNow">Sinkronkan</button></div>' +
            '<div class="mm-set-row"><span>🗑 Reset data di perangkat ini<small>Menghapus profil, skor, riwayat, dan pencapaian Memo Mayhem yang tersimpan di browser ini (tidak memengaruhi game lain). Data yang sudah ada di server tetap ada, dan nama yang sudah terdaftar tetap terpakai.</small></span><button class="btn-playful btn-playful-secondary mm-mini-btn mm-danger" id="mmReset">Reset…</button></div></div>', 'settings');
        on('#mmBack', home);
        $('#mmSound').addEventListener('change', e => { s.sound = e.target.checked; D.save(); });
        $('#mmVol').addEventListener('input', e => { s.volume = +e.target.value / 100; $('#mmVolTxt').textContent = e.target.value + '%'; });
        $('#mmVol').addEventListener('change', () => D.save());
        $('#mmReduce').addEventListener('change', e => { s.reduceMotion = e.target.checked; D.save(); view.classList.toggle('mm-reduce', s.reduceMotion); });
        on('#mmTest', () => { sfx.unlock(); sfx.correct(); });
        on('#mmSyncNow', async () => { const t = $('#mmSetCloud'); if (t) t.textContent = '⏳ Menyinkronkan…'; await CL.retryInit(); await CL.flush(); const t2 = $('#mmSetCloud'); if (t2) t2.textContent = cloudText().t; });
        on('#mmReset', () => confirmBox({ title: 'Reset semua data?', text: 'Profil, skor, riwayat, duel, dan pencapaian Memo Mayhem di browser ini akan dihapus' + (D.data.profiles.some(p => p.pid) ? '. Profil online yang sudah terdaftar tetap ada di server, tetapi tidak bisa lagi dikelola dari browser ini' : '') + '. Tindakan ini tidak bisa dibatalkan.', ok: 'Ya, hapus', danger: true, onOk: () => { D.resetAll(); UI.setup = Object.assign({ mods: [] }, D.data.settings.last); UI.duel = null; home(); } }));
    }

    /* =====================================================================
       BANTUAN
    ===================================================================== */
    function helpScreen() {
        show(backBtn('mmBack') + '<header class="mm-head"><h2>❔ Cara Main</h2><p>Setiap ronde: <b>Amati → Simpan → Jawab → Umpan balik</b>.</p></header>' +
            '<div class="mm-help-grid">' + C.MODES.map(m => '<div class="mm-card"><h3>' + mode(m).icon + ' ' + mode(m).name + '</h3><p class="mm-sub">' + mode(m).sub + '</p><p>' + mode(m).desc + '</p><small>' + Array.from(new Set(C.kindsFor(m, 'expert').concat(C.kindsFor(m, 'normal')))).map(k => C.KIND_TITLES[k === 'count' && m === 'mindtrap' ? 'count2' : k]).join(' · ') + '</small></div>').join('') + '</div>' +
            '<div class="mm-card"><h3>🧮 Skor</h3><p>Skor ronde = 100 × kesulitan (Easy 1,0 · Normal 1,5 · Hard 2,0 · Expert 2,5) × combo (naik 0,1 tiap benar beruntun, maks ×2,0) + kecepatan (0–50, hanya bila benar) + akurasi (25, tanpa Hint) + ronde sempurna (100: benar, tanpa Hint, tanpa koreksi, tanpa penalti). Salah = 0 poin dan memutus combo.</p></div>' +
            '<div class="mm-card"><h3>✨ Modifier</h3><ul class="mm-plain">' + Object.keys(C.MODIFIERS).map(k => '<li>' + C.MODIFIERS[k].icon + ' <b>' + esc(C.MODIFIERS[k].name) + '</b> — ' + esc(C.MODIFIERS[k].desc) + '</li>').join('') + '</ul></div>' +
            '<div class="mm-card"><h3>⌨️ Kontrol</h3><p>Esc = jeda · Spasi/Enter = lewati amati / lanjut · 1–9 = pilih jawaban · Backspace = hapus elemen terakhir · di mode ritme, ketuk pad sesuai pola.</p></div>', 'help');
        on('#mmBack', home);
    }

    /* =====================================================================
       HUB
    ===================================================================== */
    function openFromHub() { if (typeof switchView === 'function') switchView('memo'); home(); }
    const hubBtn = document.getElementById('hubOpenMemoButton');
    if (hubBtn) hubBtn.addEventListener('click', openFromHub);
    MM.open = openFromHub;
})();
