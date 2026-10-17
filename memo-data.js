/* =====================================================================
   MEMO MAYHEM — DATA LOKAL, PROFIL, PAPAN PERINGKAT, PENCAPAIAN, SUARA
   Cache & cadangan di localStorage; profil online disinkronkan ke Firebase
   lewat memo-cloud.js. Aman bila data rusak atau localStorage tidak tersedia.
===================================================================== */
(function () {
    'use strict';
    const C = MemoCore;
    const KEY = 'memoMayhemCosmicRecall_v1';
    const SCHEMA = 1;

    function defaults() {
        return {
            v: SCHEMA,
            profiles: [{ id: 'p1', name: 'Pemain 1', icon: '👽', ach: {} }],
            active: 'p1',
            sessions: [],
            outbox: [],
            boards: {},
            daily: {},
            endless: { best: null },
            boss: { clears: 0, best: null },
            duels: [],
            ach: {},
            counters: { modes: {}, maxSeqLen: 0 },
            settings: { sound: true, volume: 0.7, reduceMotion: false, last: { mode: 'snapshot', diff: 'normal', rounds: 10, play: 'standard' } }
        };
    }

    let memoryOnly = false;
    let data = load();

    function load() {
        let raw = null;
        try { raw = localStorage.getItem(KEY); } catch (e) { memoryOnly = true; }
        if (!raw) return defaults();
        try {
            const d = JSON.parse(raw);
            if (!d || typeof d !== 'object' || d.v !== SCHEMA || !Array.isArray(d.profiles) || !d.profiles.length) throw new Error('skema');
            const base = defaults();
            const out = Object.assign(base, d);
            out.settings = Object.assign(base.settings, d.settings || {});
            out.settings.last = Object.assign(base.settings.last, (d.settings || {}).last || {});
            out.counters = Object.assign(base.counters, d.counters || {});
            if (!Array.isArray(out.outbox)) out.outbox = [];
            out.profiles.forEach((p, i) => { if (!p.ach || typeof p.ach !== 'object') p.ach = (i === 0 && d.ach && typeof d.ach === 'object') ? d.ach : {}; });
            if (!out.profiles.some(p => p.id === out.active)) out.active = out.profiles[0].id;
            return out;
        } catch (e) {
            try { localStorage.setItem(KEY + '_corrupt', raw); } catch (_) { /* abaikan */ }
            return defaults();
        }
    }
    function save() {
        if (memoryOnly) return false;
        try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { memoryOnly = true; return false; }
    }

    /* ---------- Profil ---------- */
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const activeProfile = () => data.profiles.find(p => p.id === data.active) || data.profiles[0];
    function addProfile(name, icon) {
        name = String(name || '').trim().slice(0, 14) || ('Pemain ' + (data.profiles.length + 1));
        const p = { id: 'p' + uid(), name, icon: icon || '👽', ach: {} };
        data.profiles.push(p); save(); return p;
    }
    function markOnline(id, info) {
        const p = data.profiles.find(x => x.id === id); if (!p) return;
        p.pid = info.pid; p.owner = info.owner; p.name = info.name; p.regAt = Date.now(); save();
    }
    function setActive(id) { if (data.profiles.some(p => p.id === id)) { data.active = id; save(); } }
    function updateProfile(id, patch) {
        const p = data.profiles.find(x => x.id === id); if (!p) return;
        if (patch.name != null && !p.pid) p.name = String(patch.name).trim().slice(0, 14) || p.name;
        if (patch.icon) p.icon = patch.icon;
        save();
    }

    /* ---------- Pencapaian & makhluk memori (kosmetik, tanpa efek gameplay) ---------- */
    const ACH = [
        { id: 'first', icon: '🌱', name: 'First Recall', desc: 'Selesaikan sesi pertamamu.', creature: '🐙', test: x => x.s.done },
        { id: 'sharp', icon: '👁️', name: 'Sharp Eyes', desc: 'Akurasi ≥ 90% pada sesi Snapshot (≥ 10 ronde).', creature: '🦉', test: x => x.s.mode === 'snapshot' && x.s.type === 'standard' && x.s.done && x.s.total >= 10 && x.s.accuracy >= 0.9 },
        { id: 'seqmaster', icon: '🔢', name: 'Sequence Master', desc: 'Jawab benar sebuah urutan sepanjang 7 elemen atau lebih.', creature: '🐢', test: x => x.data.counters.maxSeqLen >= 7 },
        { id: 'nomistakes', icon: '💎', name: 'No Mistakes', desc: 'Selesaikan sesi (≥ 10 ronde) tanpa satu pun kesalahan.', creature: '🦊', test: x => x.s.type === 'standard' && x.s.done && x.s.total >= 10 && x.s.correct === x.s.total },
        { id: 'comeback', icon: '🔥', name: 'Comeback', desc: 'Selesaikan sesi setelah kehilangan 2 stability point.', creature: '🦅', test: x => x.s.type === 'standard' && x.s.done && x.s.livesLost >= 2 },
        { id: 'combo10', icon: '⚡', name: 'Combo 10', desc: 'Capai combo 10 jawaban benar beruntun.', creature: '🦄', test: x => x.s.bestCombo >= 10 },
        { id: 'expert', icon: '🧠', name: 'Expert Clear', desc: 'Selesaikan sesi standar tingkat Expert.', creature: '🐲', test: x => x.s.type === 'standard' && x.s.diff === 'expert' && x.s.done },
        { id: 'marathon', icon: '🏃', name: 'Marathon', desc: 'Selesaikan sesi 30 ronde.', creature: '🦖', test: x => x.s.type === 'standard' && x.s.done && x.s.plannedRounds >= 30 },
        { id: 'allmodes', icon: '🗺️', name: 'Penjelajah', desc: 'Mainkan keenam mode inti sedikitnya sekali.', creature: '🦉', test: x => C.MODES.every(m => (x.data.counters.modes[m] || 0) > 0) },
        { id: 'daily', icon: '📅', name: 'Rutin Harian', desc: 'Selesaikan sebuah Daily Challenge.', creature: '🐝', test: x => x.s.type === 'daily' && x.s.done },
        { id: 'mindcore', icon: '🛠️', name: 'Mindcore Breaker', desc: 'Taklukkan Boss Experiment.', creature: '👾', test: x => x.s.type === 'boss' && x.s.done },
        { id: 'duelwin', icon: '⚔️', name: 'Pemenang Duel', desc: 'Menangkan satu duel lokal.', creature: '🦁', test: x => x.duelWin }
    ];
    const CREATURES = ['👽'].concat(ACH.map(a => a.creature).filter((v, i, a) => a.indexOf(v) === i));
    const achMap = pid => { const p = data.profiles.find(x => x.id === pid) || activeProfile(); return p.ach || (p.ach = {}); };
    const unlockedCreatures = () => { const m = achMap(); return ['👽'].concat(ACH.filter(a => m[a.id]).map(a => a.creature)).filter((v, i, a) => a.indexOf(v) === i); };

    function checkAch(ctx, pid) {
        const out = [], m = achMap(pid);
        ACH.forEach(a => { if (!m[a.id] && a.test(ctx)) { m[a.id] = Date.now(); out.push(a); } });
        return out;
    }

    /* ---------- Papan peringkat ---------- */
    function boardKey(s) {
        if (s.type === 'standard') return ['std', s.mode, s.diff, s.plannedRounds].join('|');
        if (s.type === 'daily') return 'daily|' + s.dateKey;
        return s.type; // endless | boss
    }
    function board(key) { return data.boards[key] || []; }
    const remoteKey = s => boardKey(s).replace(/\|/g, '_'); // kunci kategori di Firebase (tanpa karakter khusus)

    /* ---------- Antrean sinkronisasi Firebase (outbox) ----------
       Setiap sesi profil online masuk antrean dengan id unik; baru dihapus
       dari antrean setelah server mengonfirmasi (lihat memo-cloud.js). */
    function enqueue(s, extra) {
        const pr = data.profiles.find(p => p.id === s.profileId);
        if (!pr || !pr.pid || s.practice) return null;
        extra = extra || {};
        const bk = (s.type === 'standard' || s.type === 'daily' || s.type === 'endless' || s.type === 'boss') && !extra.noBoard ? remoteKey(s) : '';
        const item = {
            sid: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12), pid: pr.pid, t: Date.now(),
            ach: extra.ach || {},
            payload: {
                type: s.type, mode: s.mode || '', diff: s.diff || '', plannedRounds: s.plannedRounds || 0, total: s.total, correct: s.correct, score: s.score,
                accP: Math.round(s.accuracy * 1000), totalMs: s.totalMs || 0, bestCombo: s.bestCombo || 0, livesLost: s.livesLost || 0, maxSeqLen: s.maxSeqLen || 0,
                done: !!s.done, failed: !!s.failed, won: !!extra.won, dateKey: s.dateKey || '', bk, modesSeen: s.modesSeen || []
            }
        };
        data.outbox.push(item);
        s.cloudSid = item.sid;
        return item;
    }
    const achObj = list => { const o = {}; (list || []).forEach(a => { o[a.id] = Date.now(); }); return o; };

    /* ---------- Rekam sesi ---------- */
    function recordSession(s, opts) {
        opts = opts || {};
        s.id = uid(); s.ts = Date.now();
        data.sessions.unshift(s);
        if (data.sessions.length > 300) data.sessions.length = 300;
        let rank = null, isRecord = false;
        if (!s.practice) {
            // penghitung
            if (s.type === 'standard') data.counters.modes[s.mode] = (data.counters.modes[s.mode] || 0) + 1;
            else (s.modesSeen || []).forEach(m => { data.counters.modes[m] = (data.counters.modes[m] || 0) + 1; });
            if (s.maxSeqLen && s.maxSeqLen > data.counters.maxSeqLen) data.counters.maxSeqLen = s.maxSeqLen;
            if (!opts.duel) {
                const key = boardKey(s);
                const list = data.boards[key] || [];
                const entry = { score: s.score, name: s.name, icon: s.icon, pid: s.profileId, ts: s.ts, acc: s.accuracy, extra: s.type === 'endless' ? s.total : null };
                const prevBest = list.filter(e => e.pid === s.profileId).reduce((m, e) => Math.max(m, e.score), -1);
                isRecord = s.score > prevBest && s.score > 0;
                list.push(entry);
                list.sort((a, b) => b.score - a.score || a.ts - b.ts);
                if (list.length > 10) list.length = 10;
                data.boards[key] = list;
                const idx = list.findIndex(e => e.ts === s.ts && e.pid === s.profileId);
                rank = idx >= 0 ? idx + 1 : null;
                if (s.type === 'daily') {
                    const d = data.daily[s.dateKey] = data.daily[s.dateKey] || {};
                    const cur = d[s.profileId];
                    d[s.profileId] = { best: Math.max(cur ? cur.best : 0, s.score), plays: (cur ? cur.plays : 0) + 1, name: s.name };
                    const keys = Object.keys(data.daily).sort();
                    while (keys.length > 60) delete data.daily[keys.shift()];
                }
                if (s.type === 'endless') {
                    const b = data.endless.best;
                    if (!b || s.total > b.rounds || (s.total === b.rounds && s.score > b.score)) data.endless.best = { rounds: s.total, score: s.score, name: s.name, ts: s.ts };
                }
                if (s.type === 'boss' && s.done) { data.boss.clears++; if (!data.boss.best || s.score > data.boss.best.score) data.boss.best = { score: s.score, name: s.name, ts: s.ts }; }
            }
        }
        let newAch = [];
        if (!s.practice) newAch = checkAch({ s, data, duelWin: !!opts.duelWin }, s.profileId);
        if (!opts.duel && !s.practice) enqueue(s, { ach: achObj(newAch) });
        save();
        return { rank, isRecord, newAch, sid: s.cloudSid || null };
    }
    function recordDuel(d, sess) {
        d.id = uid(); d.ts = Date.now();
        data.duels.unshift(d); if (data.duels.length > 100) data.duels.length = 100;
        let newAch = [];
        if (d.winner) {
            const ctxS = { done: true, type: 'duel', mode: d.mode, diff: d.diff, bestCombo: 0, accuracy: 0, total: 0, correct: 0, livesLost: 0, plannedRounds: d.rounds };
            newAch = checkAch({ s: ctxS, data, duelWin: true }, d.winner);
        }
        if (sess) {
            [[d.p1, sess[0]], [d.p2, sess[1]]].forEach(([p, ss]) => {
                if (ss) enqueue(ss, { won: d.winner === p.id, noBoard: true, ach: d.winner === p.id ? achObj(newAch) : {} });
            });
        }
        save();
        return newAch;
    }

    /* ---------- Statistik profil ---------- */
    function profileStats(pid) {
        const mine = data.sessions.filter(s => s.profileId === pid);
        const real = mine.filter(s => !s.practice);
        const accs = real.filter(s => s.total > 0).map(s => s.accuracy);
        const modeCount = {};
        real.forEach(s => { const ms = s.type === 'standard' ? [s.mode] : (s.modesSeen || []); ms.forEach(m => { modeCount[m] = (modeCount[m] || 0) + 1; }); });
        const fav = Object.keys(modeCount).sort((a, b) => modeCount[b] - modeCount[a])[0] || null;
        const wins = data.duels.filter(d => d.winner === pid).length;
        const duelsPlayed = data.duels.filter(d => d.p1.id === pid || d.p2.id === pid).length;
        return {
            sessions: mine.length, practice: mine.length - real.length,
            bestScore: real.reduce((m, s) => Math.max(m, s.score), 0),
            avgAcc: accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null,
            bestCombo: mine.reduce((m, s) => Math.max(m, s.bestCombo || 0), 0),
            favMode: fav, wins, duelsPlayed
        };
    }

    function resetAll() {
        const keepSettings = data.settings;
        data = defaults(); data.settings = keepSettings; save();
    }

    /* =====================================================================
       SUARA (Web Audio) — dapat dimatikan, volume diatur di pengaturan
    ===================================================================== */
    let actx = null;
    function ctx() {
        if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
        if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
        return actx;
    }
    function tone(freq, dur, wave, vol, delay) {
        if (!data.settings.sound || data.settings.volume <= 0) return;
        const c = ctx(); if (!c) return;
        const t0 = c.currentTime + (delay || 0);
        const o = c.createOscillator(), g = c.createGain();
        o.type = wave || 'sine'; o.frequency.setValueAtTime(freq, t0);
        const peak = Math.max(0.0001, (vol == null ? 0.2 : vol) * data.settings.volume);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t0); o.stop(t0 + dur + 0.03);
    }
    const sfx = {
        unlock() { ctx(); },
        tone,
        pad(p) { tone(p.freq, 0.34, p.wave, p.wave === 'sine' ? 0.28 : 0.14); },
        tick() { tone(880, 0.05, 'triangle', 0.08); },
        correct() { tone(523, 0.12, 'sine', 0.2); tone(659, 0.12, 'sine', 0.2, 0.1); tone(784, 0.2, 'sine', 0.2, 0.2); },
        wrong() { tone(220, 0.22, 'sawtooth', 0.12); tone(165, 0.3, 'sawtooth', 0.12, 0.15); },
        combo(n) { const b = 600 + Math.min(n, 12) * 40; tone(b, 0.08, 'square', 0.1); tone(b * 1.25, 0.08, 'square', 0.1, 0.07); tone(b * 1.5, 0.14, 'square', 0.1, 0.14); },
        phase() { tone(440, 0.1, 'triangle', 0.15); tone(660, 0.16, 'triangle', 0.15, 0.09); },
        win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.2, i * 0.13)); },
        lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.18, i * 0.18)); }
    };

    window.MemoData = {
        get data() { return data; }, get memoryOnly() { return memoryOnly; },
        save, activeProfile, addProfile, markOnline, setActive, updateProfile, remoteKey,
        ACH, CREATURES, achMap, unlockedCreatures, boardKey, board, recordSession, recordDuel, profileStats, resetAll, sfx
    };
})();
