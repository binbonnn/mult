/* =====================================================================
   MEMO MAYHEM — SINKRONISASI FIREBASE (Firestore + Auth anonim)
   Memakai project Firebase yang SAMA dengan Game 1–3 (firebase-config.js,
   app default yang dibuat di script.js). Semua data Memo Mayhem hanya
   ditulis ke koleksi berawalan "memo_" — koleksi game lain tidak disentuh.

   Struktur data:
     memo_names/{nameKey}                  kunci nama unik (khusus Memo Mayhem)
     memo_profiles/{pid}                   profil publik + statistik + pencapaian
     memo_profiles/{pid}/sessions/{sid}    riwayat sesi (id unik → anti-duplikat)
     memo_boards/{boardKey}/entries/{pid}  skor terbaik tiap pemain per kategori

   Semua penulisan memakai transaksi Firestore (tidak diantrikan offline),
   sehingga "berhasil" hanya dilaporkan setelah server mengonfirmasi.
===================================================================== */
(function () {
    'use strict';
    const D = window.MemoData;
    const COL = { names: 'memo_names', profiles: 'memo_profiles', boards: 'memo_boards' };
    const TIMEOUT_MS = 15000;

    let fs = null, uid = null, initP = null, lastFail = null;
    const state = { status: 'idle', reason: '' }; // idle | connecting | online | off | error
    const listeners = [];
    function setState(status, reason) {
        state.status = status; state.reason = reason || '';
        listeners.forEach(fn => { try { fn(state); } catch (e) { /* abaikan */ } });
    }

    /* ---------- Util ---------- */
    function withTimeout(p, ms) {
        let t;
        const timer = new Promise((_, rej) => { t = setTimeout(() => rej({ code: 'timeout', message: 'Server tidak merespons' }), ms || TIMEOUT_MS); });
        return Promise.race([p, timer]).finally(() => clearTimeout(t));
    }
    const rnd = n => { let s = ''; const a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }); a.forEach(b => { s += (b % 36).toString(36); }); return s; };
    const newPid = () => 'mm' + rnd(18);
    const newSid = () => 's' + Date.now().toString(36) + rnd(10);
    const stamp = () => firebase.firestore.FieldValue.serverTimestamp();
    const millis = v => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : 0);

    function describe(e) {
        const c = (e && e.code) || '';
        if (c === 'timeout' || c === 'unavailable' || c === 'deadline-exceeded' || /network|offline/i.test((e && e.message) || '')) return 'Tidak bisa terhubung ke server. Periksa koneksi internetmu.';
        if (c === 'permission-denied') return 'Server menolak penyimpanan (aturan keamanan). Pastikan Firestore Rules Memo Mayhem sudah dipublikasikan.';
        if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') return 'Login anonim belum diaktifkan di Firebase Console (Authentication → Sign-in method → Anonymous).';
        if (c === 'unauthenticated') return 'Sesi login anonim belum siap.';
        if (c === 'resource-exhausted') return 'Kuota server sedang penuh. Coba lagi nanti.';
        return 'Terjadi kesalahan saat berkomunikasi dengan server' + (c ? ' (' + c + ')' : '') + '.';
    }

    /* ---------- Normalisasi & validasi nama (identik dengan Firestore Rules) ---------- */
    function normName(raw) {
        const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
        if (name.length < 3) return { ok: false, error: 'Nama minimal 3 karakter.' };
        if (name.length > 14) return { ok: false, error: 'Nama maksimal 14 karakter.' };
        if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(name)) return { ok: false, error: 'Gunakan huruf, angka, spasi, _ . atau - saja (tanpa emoji) dan mulai dengan huruf/angka.' };
        return { ok: true, name, key: name.toLowerCase().replace(/ /g, '_') };
    }

    /* ---------- Koneksi ---------- */
    function sdkReady() {
        return typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && typeof firebase.firestore === 'function';
    }
    function init(force) {
        if (initP && !(force && state.status === 'error')) return initP;
        setState('connecting');
        initP = (async () => {
            if (!sdkReady()) { setState('off', 'Firebase belum dikonfigurasi atau gagal dimuat'); return { ok: false, code: 'off', message: 'Mode lokal: Firebase tidak tersedia di perangkat ini.' }; }
            if (typeof firebase.auth !== 'function') { setState('off', 'SDK Auth tidak dimuat'); return { ok: false, code: 'off', message: 'Mode lokal: SDK Firebase Auth tidak dimuat.' }; }
            try {
                fs = firebase.firestore();
                const auth = firebase.auth();
                let user = await withTimeout(new Promise(res => { const un = auth.onAuthStateChanged(u => { un(); res(u); }); }), 8000);
                if (!user) user = (await withTimeout(auth.signInAnonymously(), TIMEOUT_MS)).user;
                uid = user.uid;
                setState('online');
                return { ok: true, uid };
            } catch (e) {
                const msg = describe(e);
                lastFail = { ok: false, code: (e && e.code) || 'error', message: msg };
                setState('error', msg);
                return lastFail;
            }
        })();
        return initP;
    }
    function retryInit() { initP = null; return init(true); }
    function isOnline() { return state.status === 'online'; }

    /* ---------- Nama: ketersediaan ---------- */
    async function checkName(raw, ownPid) {
        const nn = normName(raw); if (!nn.ok) return { ok: false, code: 'format', message: nn.error };
        const c = await init(); if (!c.ok) return { ok: false, code: 'offline', message: c.message };
        try {
            const s = await withTimeout(fs.collection(COL.names).doc(nn.key).get());
            if (s.exists && !(ownPid && s.data().pid === ownPid)) return { ok: true, free: false, name: nn.name, key: nn.key };
            return { ok: true, free: true, name: nn.name, key: nn.key };
        } catch (e) { return { ok: false, code: 'error', message: describe(e) }; }
    }

    /* ---------- Registrasi profil (nama unik, atomik) ---------- */
    async function registerProfile(local, rawName) {
        const nn = normName(rawName); if (!nn.ok) return { ok: false, code: 'format', message: nn.error };
        const c = await init(); if (!c.ok) return { ok: false, code: 'offline', message: c.message };
        const pid = local.pid || newPid();
        const nameRef = fs.collection(COL.names).doc(nn.key), profRef = fs.collection(COL.profiles).doc(pid);
        const ach = {};
        const done = () => ({ ok: true, pid, owner: uid, name: nn.name, key: nn.key });
        const taken = () => ({ ok: false, code: 'taken', message: 'Nama ini sudah digunakan di Memo Mayhem. Coba nama lain.' });
        try {
            const r = await withTimeout(fs.runTransaction(async tx => {
                const s = await tx.get(nameRef);
                if (s.exists) { const d = s.data(); return (d.pid === pid && d.owner === uid) ? 'mine' : 'taken'; }
                tx.set(nameRef, { pid, owner: uid, name: nn.name, createdAt: stamp() });
                tx.set(profRef, {
                    v: 1, name: nn.name, nameKey: nn.key, owner: uid, icon: local.icon || '👽', createdAt: stamp(), updatedAt: stamp(), lastSid: '',
                    st: { sessions: 0, bestScore: 0, accSumP: 0, totalMs: 0, bestCombo: 0, maxSeqLen: 0, duels: 0, duelWins: 0, bossClears: 0, endlessBest: 0, modes: {} },
                    ach
                });
                return 'created';
            }));
            return r === 'taken' ? taken() : done();
        } catch (e) {
            // Transaksi bisa ditolak Rules bila ada pendaftar lain yang menang di waktu bersamaan → periksa siapa pemilik nama.
            try {
                const s = await withTimeout(nameRef.get());
                if (s.exists) { const d = s.data(); return (d.pid === pid && d.owner === uid) ? done() : taken(); }
            } catch (_) { /* jatuh ke pesan umum */ }
            return { ok: false, code: (e && e.code) || 'error', message: describe(e) };
        }
    }

    /* ---------- Simpan sesi (idempoten: 1 sid = 1 catatan) ---------- */
    function sessionDoc(item, prof) {
        const p = item.payload;
        return {
            pid: item.pid, owner: uid, name: prof.name, type: p.type, mode: p.mode || '', diff: p.diff || '', plannedRounds: p.plannedRounds | 0,
            total: p.total | 0, correct: p.correct | 0, score: p.score | 0, accP: p.accP | 0, totalMs: p.totalMs | 0, bestCombo: p.bestCombo | 0,
            livesLost: p.livesLost | 0, maxSeqLen: p.maxSeqLen | 0, done: !!p.done, failed: !!p.failed, won: !!p.won,
            dateKey: p.dateKey || '', bk: p.bk || '', modesSeen: (p.modesSeen || []).slice(0, 6), ts: stamp()
        };
    }
    async function pushSession(item) {
        const c = await init(); if (!c.ok) return { ok: false, code: 'offline', message: c.message };
        const local = D.data.profiles.find(p => p.pid === item.pid);
        if (!local) return { ok: true, dropped: true };
        if (local.owner && local.owner !== uid) return { ok: false, code: 'foreign', permanent: true, message: 'Profil ini terdaftar oleh sesi/perangkat lain, jadi tidak bisa menyimpan dari sini.' };
        const profRef = fs.collection(COL.profiles).doc(item.pid);
        const sessRef = profRef.collection('sessions').doc(item.sid);
        const bk = item.payload.bk;
        const entryRef = bk ? fs.collection(COL.boards).doc(bk).collection('entries').doc(item.pid) : null;
        try {
            const res = await withTimeout(fs.runTransaction(async tx => {
                const sSnap = await tx.get(sessRef);
                if (sSnap.exists) return { dup: true };
                const pSnap = await tx.get(profRef);
                if (!pSnap.exists) throw { code: 'profile-missing', message: 'Profil tidak ditemukan di server' };
                const eSnap = entryRef ? await tx.get(entryRef) : null;
                const prof = pSnap.data(), st = Object.assign({ modes: {} }, prof.st), p = item.payload;
                const modes = Object.assign({}, st.modes);
                (p.modesSeen || []).forEach(m => { modes[m] = (modes[m] || 0) + 1; });
                const nst = {
                    sessions: st.sessions + 1, bestScore: Math.max(st.bestScore, p.score | 0), accSumP: st.accSumP + (p.accP | 0), totalMs: st.totalMs + (p.totalMs | 0),
                    bestCombo: Math.max(st.bestCombo, p.bestCombo | 0), maxSeqLen: Math.max(st.maxSeqLen, p.maxSeqLen | 0),
                    duels: st.duels + (p.type === 'duel' ? 1 : 0), duelWins: st.duelWins + (p.type === 'duel' && p.won ? 1 : 0),
                    bossClears: st.bossClears + (p.type === 'boss' && p.done ? 1 : 0), endlessBest: p.type === 'endless' ? Math.max(st.endlessBest, p.total | 0) : st.endlessBest, modes
                };
                const ach = Object.assign({}, prof.ach);
                Object.keys(item.ach || {}).forEach(k => { if (!(k in ach)) ach[k] = item.ach[k]; });
                tx.set(sessRef, sessionDoc(item, prof));
                tx.update(profRef, { st: nst, ach, lastSid: item.sid, updatedAt: stamp() });
                let entered = false;
                if (entryRef && (p.score | 0) > 0 && (!eSnap.exists || (p.score | 0) > eSnap.data().score)) {
                    tx.set(entryRef, { pid: item.pid, owner: uid, name: prof.name, icon: prof.icon || '👽', score: p.score | 0, accP: p.accP | 0, total: p.total | 0, sid: item.sid, ts: stamp() });
                    entered = true;
                }
                return { saved: true, entered };
            }));
            return Object.assign({ ok: true }, res);
        } catch (e) {
            const code = (e && e.code) || 'error';
            return { ok: false, code, permanent: code === 'permission-denied' || code === 'profile-missing', message: code === 'profile-missing' ? e.message : describe(e) };
        }
    }

    /* ---------- Outbox: antrean sesi yang belum terkonfirmasi server ---------- */
    let flushing = null;
    const outcomes = {}; // sid → hasil terakhir
    function pending() { return (D.data.outbox || []).length; }
    function flush() {
        if (flushing) return flushing;
        flushing = (async () => {
            const box = D.data.outbox || [];
            for (let i = 0; i < box.length;) {
                const it = box[i];
                const r = await pushSession(it);
                outcomes[it.sid] = r;
                if (r.ok) { box.splice(i, 1); D.save(); }
                else if (r.code === 'offline' || r.code === 'timeout' || r.code === 'unavailable') break; // koneksi bermasalah → hentikan, coba lagi nanti
                else { it.err = r.message; it.tries = (it.tries || 0) + 1; i++; }
            }
            D.save();
            return outcomes;
        })().finally(() => { flushing = null; });
        return flushing;
    }
    window.addEventListener('online', () => { if (pending()) { init(true).then(() => flush()); } });

    /* ---------- Baca data publik ---------- */
    async function getBoard(bk) {
        const c = await init(); if (!c.ok) return { ok: false, message: c.message };
        try {
            const q = await withTimeout(fs.collection(COL.boards).doc(bk).collection('entries').orderBy('score', 'desc').limit(10).get());
            const rows = q.docs.map(d => { const x = d.data(); return { pid: d.id, name: x.name, icon: x.icon, score: x.score, acc: (x.accP || 0) / 1000, total: x.total, ts: millis(x.ts) }; });
            rows.sort((a, b) => b.score - a.score || a.ts - b.ts);
            return { ok: true, rows };
        } catch (e) { return { ok: false, message: describe(e) }; }
    }
    async function getProfile(pid) {
        const c = await init(); if (!c.ok) return { ok: false, message: c.message };
        try {
            const s = await withTimeout(fs.collection(COL.profiles).doc(pid).get());
            if (!s.exists) return { ok: false, message: 'Profil tidak ditemukan.' };
            const d = s.data();
            return { ok: true, profile: { pid, name: d.name, icon: d.icon, createdAt: millis(d.createdAt), st: d.st, ach: d.ach || {} } };
        } catch (e) { return { ok: false, message: describe(e) }; }
    }
    async function getHistory(pid, n) {
        const c = await init(); if (!c.ok) return { ok: false, message: c.message };
        try {
            const q = await withTimeout(fs.collection(COL.profiles).doc(pid).collection('sessions').orderBy('ts', 'desc').limit(n || 15).get());
            return { ok: true, rows: q.docs.map(d => Object.assign({ id: d.id }, d.data(), { ts: millis(d.data().ts) })) };
        } catch (e) { return { ok: false, message: describe(e) }; }
    }
    async function updateIcon(pid, icon) {
        const c = await init(); if (!c.ok) return { ok: false, message: c.message };
        try { await withTimeout(fs.collection(COL.profiles).doc(pid).update({ icon, updatedAt: stamp() })); return { ok: true }; }
        catch (e) { return { ok: false, message: describe(e) }; }
    }

    window.MemoCloud = { state, onChange: fn => listeners.push(fn), init, retryInit, isOnline, normName, checkName, registerProfile, newPid, newSid, flush, pending, outcomes, getBoard, getProfile, getHistory, updateIcon, describe };
})();
