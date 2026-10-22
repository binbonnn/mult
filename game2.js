/* =====================================================================================
   GAME PENGETAHUAN DASAR
   (sengaja ditulis paralel/terpisah dari game Perkalian, bukan berbagi satu "engine" --
   supaya aman: perubahan di sini tidak berisiko merusak game Perkalian yang sudah jalan)
===================================================================================== */

/* ---- Konstanta & state ---- */
const KNOWLEDGE_ROUND_DURATION_MS = 60000; // 60 detik per ronde
const KNOWLEDGE_ROUND_BUFFER = 80; // soal yang disiapkan di depan per ronde (jauh lebih dari cukup utk 60 detik)
const MAX_KNOWLEDGE_LEADERBOARD = 10;
const KNOWLEDGE_DUEL_START_BUFFER_MS = 6000;
const KNOWLEDGE_DUEL_HEARTBEAT_INTERVAL_MS = 5000;
const KNOWLEDGE_DUEL_HEARTBEAT_TIMEOUT_MS = 13000;

let knowledgeUsedQuestionIds = [];
let knowledgeLastResolved = null; // soal TERAKHIR yang selesai diproses {q, status:'correct'|'burned'} -> sumber panel pembahasan

/* ---- Bank soal: penjelasan per opsi ----
   Bentuk utama:  { id, category, question, options:[4 teks], correctIndex, explanations:[4 teks sejajar dengan options] }
   Bentuk lain yang juga dikenali (supaya 2.000 soal Anda terbaca apa adanya):
     - options berupa objek: [{ text|teks|label, explanation|penjelasan|pembahasan, isCorrect|benar }]
     - penjelasan sejajar opsi: explanations / penjelasan / penjelasanOpsi / optionExplanations / pembahasan (array 4)
     - penjelasan per huruf: explanationA..D / penjelasanA..D / penjelasan_a..d / explanation0..3
     - penjelasan benar + pengecoh terpisah: penjelasanBenar | correctExplanation  +  penjelasanPengecoh | wrongExplanations (3, urutan pengecoh)
     - answer|jawaban + distractors|pengecoh (opsi diacak otomatis, penjelasan ikut terhubung ke opsinya)
   Awalan "Penjelasan:" di teks dibuang otomatis. */
function knPick(raw, keys) {
    for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k];
    }
    return undefined;
}

function knCleanExplanation(v) {
    if (v === undefined || v === null) return null;
    const text = String(v).trim().replace(/^penjelasan\s*:\s*/i, '').trim();
    return text === '' ? null : text;
}

function normalizeKnowledgeQuestion(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const question = knPick(raw, ['question', 'pertanyaan', 'soal', 'q']);
    if (question === undefined) return null;

    const optsRaw = knPick(raw, ['options', 'pilihan', 'opsi', 'choices']);
    let items = []; // {text, expl, correct}

    if (Array.isArray(optsRaw) && optsRaw.length >= 2) {
        optsRaw.forEach((o, j) => {
            if (o && typeof o === 'object') {
                items.push({
                    text: String(knPick(o, ['text', 'teks', 'label', 'option', 'opsi', 'value', 'jawaban']) ?? ''),
                    expl: knPick(o, ['explanation', 'penjelasan', 'pembahasan', 'alasan', 'reason']),
                    correct: [o.isCorrect, o.benar, o.correct, o.is_correct].includes(true)
                });
            } else {
                items.push({ text: String(o), expl: undefined, correct: false });
            }
        });
    } else {
        const answer = knPick(raw, ['answer', 'jawaban', 'jawabanBenar', 'correctAnswer']);
        const distractors = knPick(raw, ['distractors', 'pengecoh', 'jawabanPengecoh', 'wrongAnswers']);
        if (answer === undefined || !Array.isArray(distractors)) return null;
        const answerExpl = knPick(raw, ['answerExplanation', 'penjelasanBenar', 'penjelasanJawaban', 'correctExplanation', 'explanationCorrect', 'pembahasanBenar']);
        const wrongExpl = knPick(raw, ['distractorExplanations', 'penjelasanPengecoh', 'wrongExplanations', 'penjelasanSalah', 'explanationWrong']) || [];
        items = [{ text: String(answer), expl: answerExpl, correct: true }].concat(
            distractors.map((d, j) => ({ text: String(d), expl: Array.isArray(wrongExpl) ? wrongExpl[j] : undefined, correct: false })));
        for (let i = items.length - 1; i > 0; i--) { // acak posisi; penjelasan ikut menempel pada opsinya
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
    }

    // indeks jawaban benar
    let correctIndex = items.findIndex(it => it.correct);
    if (correctIndex < 0) {
        const ci = knPick(raw, ['correctIndex', 'answerIndex', 'indexJawaban', 'kunci']);
        if (typeof ci === 'string' && /^[A-Da-d]$/.test(ci.trim())) correctIndex = ci.trim().toUpperCase().charCodeAt(0) - 65;
        else if (ci !== undefined && Number.isInteger(Number(ci))) correctIndex = Number(ci);
    }
    if (correctIndex < 0) {
        const ans = knPick(raw, ['answer', 'jawaban', 'jawabanBenar', 'correctAnswer']);
        if (ans !== undefined) correctIndex = items.findIndex(it => it.text === String(ans));
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= items.length) return null;

    // penjelasan: sejajar-opsi (array), per-huruf, atau benar+pengecoh terpisah -- hanya mengisi yang masih kosong
    const arr = knPick(raw, ['explanations', 'penjelasan', 'penjelasanOpsi', 'optionExplanations', 'pembahasan', 'penjelasan_opsi']);
    if (Array.isArray(arr)) arr.forEach((e, j) => { if (items[j] && items[j].expl === undefined) items[j].expl = e; });
    ['A', 'B', 'C', 'D'].forEach((L, j) => {
        if (!items[j] || items[j].expl !== undefined) return;
        const v = knPick(raw, [`explanation${L}`, `penjelasan${L}`, `penjelasan_${L.toLowerCase()}`, `explanation_${L.toLowerCase()}`, `explanation${j}`, `penjelasan${j}`]);
        if (v !== undefined) items[j].expl = v;
    });
    const cExpl = knPick(raw, ['penjelasanBenar', 'correctExplanation', 'explanationCorrect', 'pembahasanBenar', 'penjelasanJawabanBenar']);
    if (cExpl !== undefined && items[correctIndex].expl === undefined) items[correctIndex].expl = cExpl;
    const wExpl = knPick(raw, ['penjelasanPengecoh', 'wrongExplanations', 'distractorExplanations', 'penjelasanSalah', 'explanationWrong']);
    if (Array.isArray(wExpl)) {
        let k = 0;
        items.forEach((it, j) => { if (j !== correctIndex) { if (it.expl === undefined) it.expl = wExpl[k]; k++; } });
    }

    const id = raw.id !== undefined ? raw.id : index + 1;
    const category = Number(knPick(raw, ['category', 'kategori'])) || 1;
    return {
        id, category, question: String(question),
        options: items.map(it => it.text),
        correctIndex,
        explanations: items.map(it => knCleanExplanation(it.expl))
    };
}

const KNOWLEDGE_BANK = (typeof KNOWLEDGE_QUESTIONS !== 'undefined' && Array.isArray(KNOWLEDGE_QUESTIONS))
    ? KNOWLEDGE_QUESTIONS.map((raw, i) => normalizeKnowledgeQuestion(raw, i)).filter(Boolean)
    : [];
(function reportKnowledgeBankHealth() {
    if (typeof KNOWLEDGE_QUESTIONS === 'undefined') return;
    const skipped = KNOWLEDGE_QUESTIONS.length - KNOWLEDGE_BANK.length;
    const noExpl = KNOWLEDGE_BANK.filter(q => q.explanations.some(e => !e)).length;
    if (skipped > 0) console.warn(`[Pengetahuan Dasar] ${skipped} soal dilewati karena formatnya tidak dikenali.`);
    if (noExpl > 0) console.warn(`[Pengetahuan Dasar] ${noExpl} soal punya opsi tanpa penjelasan (akan tampil "belum tersedia").`);
})();
let knowledgeSequence = [];
let knowledgeSeqIndex = 0;
let knowledgeCorrectCount = 0;
// Skor disimpan dalam "persepuluhan" (10 = 1,0 poin) supaya penjumlahan 0,7 + 0,3 dst. tidak kena error pecahan desimal
let knowledgeScoreTenths = 0;
let knowledgeBurnedCount = 0;
let knowledgeHintsUsed = 0;
let knowledgeWrongClicksThisQuestion = 0;
let knowledgeHintUsedThisQuestion = false;
let knowledgeGameInProgress = false;
let knowledgeRoundTimerInterval = null;
let knowledgeRoundEndAt = 0;
let knowledgeLastSavedRecord = null;
let knowledgeActiveLeaderboardTab = 'solo';
let knowledgeSelectedAvatar = null;
let knowledgeDuelCreateSelectedAvatar = null;
let knowledgeDuelJoinSelectedAvatar = null;
let knowledgeDuelState = null;
let knowledgeDuelHeartbeatInterval = null;

// Satu nama = satu baris di papan peringkat duel (dipakai sebagai ID dokumen Firestore)
function nameToDocId(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'anon';
}

/* ---- Soal: rotasi kategori 1,2,3,...,N,1,2,3,...  (N ikut jumlah kategori yang ADA di data) ---- */
function getKnowledgeCategories() {
    const set = new Set(KNOWLEDGE_BANK.map(q => q.category));
    return Array.from(set).sort((a, b) => a - b);
}

function generateKnowledgeSequence(count) {
    const categories = getKnowledgeCategories();
    const byCategory = {};
    categories.forEach(c => { byCategory[c] = KNOWLEDGE_BANK.filter(q => q.category === c); });

    // Reset riwayat soal yang sudah pernah keluar kalau sisa pool sudah hampir habis,
    // supaya tidak pernah terjebak (sama seperti pola di game Perkalian)
    if (knowledgeUsedQuestionIds.length >= KNOWLEDGE_BANK.length - count) {
        knowledgeUsedQuestionIds = [];
    }

    const sequence = [];
    let pointer = 0;
    let safety = 0;
    const safetyLimit = count * 50 + 500;
    while (sequence.length < count && safety < safetyLimit) {
        safety++;
        const cat = categories[pointer % categories.length];
        pointer++;
        const pool = byCategory[cat].filter(q =>
            !knowledgeUsedQuestionIds.includes(q.id) && !sequence.some(s => s.id === q.id)
        );
        if (pool.length === 0) continue; // kategori ini lagi kering sementara, lanjut putaran berikutnya
        const pick = pool[Math.floor(Math.random() * pool.length)];
        sequence.push(pick);
        knowledgeUsedQuestionIds.push(pick.id);
    }
    return sequence;
}

/* ---- Sistem skor Pengetahuan Dasar (berdasarkan "klik ke berapa" jawaban benar) ---- */
const KNOWLEDGE_POINTS_CLICK_1 = 10;  // benar di klik pertama  = 1,0
const KNOWLEDGE_POINTS_CLICK_2 = 7;   // benar di klik kedua    = 0,7
const KNOWLEDGE_POINTS_CLICK_3 = 3;   // benar di klik ketiga   = 0,3 (juga batas maksimal jika memakai hint)
const KNOWLEDGE_POINTS_BURNED = -10;  // soal hangus            = -1,0

function knowledgePointsForCorrect(wrongClicksBefore, hintUsed) {
    const base = wrongClicksBefore === 0 ? KNOWLEDGE_POINTS_CLICK_1
        : wrongClicksBefore === 1 ? KNOWLEDGE_POINTS_CLICK_2
        : KNOWLEDGE_POINTS_CLICK_3;
    return hintUsed ? Math.min(base, KNOWLEDGE_POINTS_CLICK_3) : base;
}

/* ---- Bonus streak (benar di klik pertama, tanpa Hint, berturut-turut) & info poin di layar ---- */
let knowledgeStreak = 0;
function knowledgeStreakBonusTenths(streak) {
    if (streak <= 0 || streak % 5 !== 0) return 0;
    return streak === 5 ? 30 : streak === 10 ? 70 : 100; // +3, +7, lalu +10 (maksimal) untuk 15, 20, 25, ...
}
function knowledgeStreakLevel(streak) { return streak >= 15 ? 3 : streak >= 10 ? 2 : 1; }
function formatKnowledgePlain(tenths) {
    return (Math.abs(Math.round(tenths)) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '');
}
let knowledgeGainTimer = null;
function showKnowledgeGain(tenths, bonusTenths) {
    const chip = document.getElementById('knowledgeGainChip');
    if (!chip) return;
    chip.classList.remove('is-visible', 'is-gain', 'is-loss', 'is-bonus', 'is-break');
    chip.textContent = tenths < 0
        ? `\u2212${formatKnowledgePlain(tenths)} poin`
        : `+${formatKnowledgePlain(tenths)} poin` + (bonusTenths ? ` tambah +${formatKnowledgePlain(bonusTenths)} bonus poin` : '');
    chip.classList.add(tenths < 0 ? 'is-loss' : bonusTenths ? 'is-bonus' : 'is-gain');
    void chip.offsetWidth;
    chip.classList.add('is-visible');
    clearTimeout(knowledgeGainTimer);
    knowledgeGainTimer = setTimeout(clearKnowledgeGain, 1800);
}
function breakKnowledgeStreak() {
    // Hanya diumumkan bila memang ada streak yang putus (streak >= 1)
    if (knowledgeStreak <= 0) return;
    knowledgeStreak = 0;
    const chip = document.getElementById('knowledgeGainChip');
    if (!chip) return;
    chip.classList.remove('is-visible', 'is-gain', 'is-loss', 'is-bonus', 'is-break');
    chip.textContent = 'Streak putus';
    chip.classList.add('is-break');
    void chip.offsetWidth;
    chip.classList.add('is-visible');
    clearTimeout(knowledgeGainTimer);
    knowledgeGainTimer = setTimeout(clearKnowledgeGain, 1800);
}
function clearKnowledgeGain() {
    const chip = document.getElementById('knowledgeGainChip');
    if (chip) { chip.classList.remove('is-visible', 'is-gain', 'is-loss', 'is-bonus', 'is-break'); chip.textContent = ''; }
}
function triggerKnowledgeStreakFx(streak) {
    const level = knowledgeStreakLevel(streak);
    const fx = document.getElementById('knowledgeStreakFx');
    const view = document.getElementById('knowledgeGameView');
    if (fx) {
        fx.classList.remove('is-on', 'is-lvl-1', 'is-lvl-2', 'is-lvl-3');
        void fx.offsetWidth;
        fx.classList.add('is-lvl-' + level, 'is-on');
    }
    if (view) {
        view.classList.remove('is-streak-shake', 'shake-1', 'shake-2', 'shake-3');
        void view.offsetWidth;
        view.classList.add('is-streak-shake', 'shake-' + level);
        setTimeout(() => view.classList.remove('is-streak-shake', 'shake-1', 'shake-2', 'shake-3'), 700);
    }
    try { if (navigator.vibrate) navigator.vibrate(level === 1 ? [80] : level === 2 ? [90, 40, 90] : [120, 40, 120, 40, 200]); } catch (e) { /* abaikan */ }
}

function tenthsToScore(tenths) {
    return Math.round(tenths) / 10;
}

// Format Indonesia: koma desimal, 1 angka di belakang koma, tanda minus sungguhan (mis. "7,3" / "−1,0")
function formatKnowledgeScore(score) {
    const tenths = Math.round((Number(score) || 0) * 10);
    const text = (Math.abs(tenths) / 10).toFixed(1).replace('.', ',');
    return tenths < 0 ? `\u2212${text}` : text;
}

function formatKnowledgeGain(points) {
    const tenths = Math.round(points);
    return tenths < 0 ? `\u2212${(Math.abs(tenths) / 10).toFixed(1).replace('.', ',')}` : `+${(tenths / 10).toFixed(1).replace('.', ',')}`;
}

function knowledgeScoreTenthsOf(record) {
    return Math.round((Number(record && record.score) || 0) * 10);
}

/* ---- Papan peringkat: data layer (solo & duel-wins) ---- */
function getKnowledgeSoloRecordsFromLocalStorage() {
    try {
        return JSON.parse(safeGetLocalStorage('knowledge_records', '[]'));
    } catch (e) {
        return [];
    }
}

function sortKnowledgeSoloRecords(records) {
    // Skor lebih tinggi = lebih baik; kalau seri, lebih sedikit hint lalu lebih sedikit hangus = lebih baik.
    // Rekor lama (sebelum sistem skor baru, tanpa field "score") tidak ikut karena aturannya tidak sebanding.
    return records.filter(r => typeof r.score === 'number').sort((a, b) => {
        const diff = knowledgeScoreTenthsOf(b) - knowledgeScoreTenthsOf(a);
        if (diff !== 0) return diff;
        if (a.hints !== b.hints) return a.hints - b.hints;
        return a.burned - b.burned;
    });
}

async function getKnowledgeSoloRecords() {
    if (firebaseReady) {
        try {
            const snapshot = await firestoreDb.collection('knowledge_records')
                .orderBy('score', 'desc')
                .limit(MAX_KNOWLEDGE_LEADERBOARD)
                .get();
            return sortKnowledgeSoloRecords(snapshot.docs.map(doc => doc.data())).slice(0, MAX_KNOWLEDGE_LEADERBOARD);
        } catch (e) {
            console.warn('[Pengetahuan Dasar] Gagal memuat dari Firebase, memakai localStorage.', e);
        }
    }
    return sortKnowledgeSoloRecords(getKnowledgeSoloRecordsFromLocalStorage()).slice(0, MAX_KNOWLEDGE_LEADERBOARD);
}

async function saveKnowledgeSoloRecord(record) {
    if (firebaseReady) {
        try {
            await firestoreDb.collection('knowledge_records').add(record);
            return { online: true, error: null };
        } catch (e) {
            console.warn('[Pengetahuan Dasar] Gagal menyimpan ke Firebase, menyimpan ke localStorage saja.', e);
        }
    }
    let records = getKnowledgeSoloRecordsFromLocalStorage();
    records.push(record);
    records = sortKnowledgeSoloRecords(records).slice(0, MAX_KNOWLEDGE_LEADERBOARD);
    safeSetLocalStorage('knowledge_records', JSON.stringify(records));
    return { online: false, error: null };
}

function getKnowledgeDuelWinsFromLocalStorage() {
    try {
        return JSON.parse(safeGetLocalStorage('knowledge_duel_wins', '[]'));
    } catch (e) {
        return [];
    }
}

async function getKnowledgeDuelWinsLeaderboard() {
    if (firebaseReady) {
        try {
            const snapshot = await firestoreDb.collection('knowledge_duel_wins')
                .orderBy('wins', 'desc')
                .limit(MAX_KNOWLEDGE_LEADERBOARD)
                .get();
            return snapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.warn('[Pengetahuan Dasar] Gagal memuat papan duel dari Firebase.', e);
        }
    }
    return [...getKnowledgeDuelWinsFromLocalStorage()].sort((a, b) => b.wins - a.wins).slice(0, MAX_KNOWLEDGE_LEADERBOARD);
}

// Nama yang dipakai konsisten akan terus bertambah jumlah kemenangannya (satu nama = satu baris)
async function recordKnowledgeDuelWin(name, avatar) {
    const docId = nameToDocId(name);
    if (firebaseReady) {
        try {
            await firestoreDb.collection('knowledge_duel_wins').doc(docId).set({
                name: name,
                avatar: avatar,
                wins: firebase.firestore.FieldValue.increment(1),
                updatedAt: Date.now()
            }, { merge: true });
            return;
        } catch (e) {
            console.warn('[Pengetahuan Dasar] Gagal mencatat kemenangan ke Firebase.', e);
        }
    }
    let records = getKnowledgeDuelWinsFromLocalStorage();
    let rec = records.find(r => r.docId === docId);
    if (rec) {
        rec.wins = (rec.wins || 0) + 1;
        rec.avatar = avatar;
        rec.name = name;
    } else {
        records.push({ docId, name, avatar, wins: 1 });
    }
    safeSetLocalStorage('knowledge_duel_wins', JSON.stringify(records));
}

/* ---- Dashboard: tab & papan peringkat ---- */
function setKnowledgeLeaderboardTab(tabName) {
    knowledgeActiveLeaderboardTab = tabName;
    document.querySelectorAll('#knowledgeDashboardView .leaderboard-tab[data-klboard]').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.klboard === tabName);
    });
    renderKnowledgeLeaderboardPanel(tabName);
}

document.querySelectorAll('#knowledgeDashboardView .leaderboard-tab[data-klboard]').forEach(tab => {
    tab.addEventListener('click', () => setKnowledgeLeaderboardTab(tab.dataset.klboard));
});

function showKnowledgeLeaderboardLoading() {
    document.getElementById('knowledgePodium').innerHTML = '<div class="leaderboard-loading">Memuat papan peringkat...</div>';
    document.getElementById('knowledgeRankList').innerHTML = '';
}

async function renderKnowledgeLeaderboardPanel(tabName) {
    showKnowledgeLeaderboardLoading();
    if (tabName === 'duel') {
        const records = await getKnowledgeDuelWinsLeaderboard();
        renderKnowledgeDuelWinsPodium(records);
        renderKnowledgeDuelWinsList(records);
    } else {
        const records = await getKnowledgeSoloRecords();
        renderKnowledgeSoloPodium(records);
        renderKnowledgeSoloList(records);
    }
}

function isKnowledgeLastSavedSolo(record) {
    return !!knowledgeLastSavedRecord
        && knowledgeLastSavedRecord.name === record.name
        && knowledgeLastSavedRecord.score === record.score
        && knowledgeLastSavedRecord.hints === record.hints
        && knowledgeLastSavedRecord.burned === record.burned;
}

function renderKnowledgeSoloPodium(records) {
    const podiumEl = document.getElementById('knowledgePodium');
    const displayOrder = [1, 0, 2];

    podiumEl.innerHTML = displayOrder.map(rankIndex => {
        const place = rankIndex + 1;
        const spotClass = place === 1 ? 'podium-first' : place === 2 ? 'podium-second' : 'podium-third';
        const record = records[rankIndex];

        if (!record) {
            return `
                <div class="podium-spot ${spotClass} is-empty">
                    <div class="podium-avatar-wrap"><div class="podium-avatar">👤</div></div>
                    <div class="podium-name">—</div>
                    <div class="podium-score">--</div>
                    <div class="podium-mistakes">&nbsp;</div>
                    <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
                </div>
            `;
        }

        const isYou = isKnowledgeLastSavedSolo(record);
        return `
            <div class="podium-spot ${spotClass}${isYou ? ' is-you' : ''}" role="group"
                 aria-label="Peringkat ${place}: ${escapeHtml(record.name)}, skor ${formatKnowledgeScore(record.score)}">
                ${place === 1 ? '<div class="podium-medal" aria-hidden="true">👑</div>' : `<div class="podium-medal" aria-hidden="true">${place === 2 ? '🥈' : '🥉'}</div>`}
                <div class="podium-avatar-wrap"><div class="podium-avatar">${avatarGlyph(record.avatar)}</div></div>
                <div class="podium-name" title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</div>
                <div class="podium-score"><span>${formatKnowledgeScore(record.score)}</span> <span class="podium-score-unit">poin</span></div>
                <div class="podium-mistakes">💡${record.hints} · 💀${record.burned}</div>
                ${isYou ? '<div class="you-chip">⭐ Kamu</div>' : ''}
                <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
            </div>
        `;
    }).join('');
}

function renderKnowledgeSoloList(records) {
    const listEl = document.getElementById('knowledgeRankList');
    if (records.length === 0) {
        listEl.innerHTML = `<li class="rank-list-empty">Belum ada pemain di sini.<br>Jadilah yang pertama mencatat skor! 🏁</li>`;
        return;
    }
    const rest = records.slice(3, MAX_KNOWLEDGE_LEADERBOARD);
    if (rest.length === 0) {
        listEl.innerHTML = '';
        return;
    }
    listEl.innerHTML = rest.map((record, i) => {
        const rank = i + 4;
        const isYou = isKnowledgeLastSavedSolo(record);
        return `
            <li class="rank-list-row${isYou ? ' is-you' : ''}">
                <span class="rank-list-position">${rank}</span>
                <span class="rank-list-avatar">${avatarGlyph(record.avatar)}</span>
                <span class="rank-list-name">${escapeHtml(record.name)}${isYou ? ' <span class="you-chip">⭐ Kamu</span>' : ''}</span>
                <span class="rank-list-dots" aria-hidden="true"></span>
                <span class="rank-list-score">${formatKnowledgeScore(record.score)} poin<small>💡${record.hints} · 💀${record.burned}</small></span>
            </li>
        `;
    }).join('');
}

function renderKnowledgeDuelWinsPodium(records) {
    const podiumEl = document.getElementById('knowledgePodium');
    const displayOrder = [1, 0, 2];

    podiumEl.innerHTML = displayOrder.map(rankIndex => {
        const place = rankIndex + 1;
        const spotClass = place === 1 ? 'podium-first' : place === 2 ? 'podium-second' : 'podium-third';
        const record = records[rankIndex];

        if (!record) {
            return `
                <div class="podium-spot ${spotClass} is-empty">
                    <div class="podium-avatar-wrap"><div class="podium-avatar">👤</div></div>
                    <div class="podium-name">—</div>
                    <div class="podium-score">--</div>
                    <div class="podium-mistakes">&nbsp;</div>
                    <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
                </div>
            `;
        }

        return `
            <div class="podium-spot ${spotClass}" role="group"
                 aria-label="Peringkat ${place}: ${escapeHtml(record.name)}, ${record.wins} menang">
                ${place === 1 ? '<div class="podium-medal" aria-hidden="true">👑</div>' : `<div class="podium-medal" aria-hidden="true">${place === 2 ? '🥈' : '🥉'}</div>`}
                <div class="podium-avatar-wrap"><div class="podium-avatar">${avatarGlyph(record.avatar)}</div></div>
                <div class="podium-name" title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</div>
                <div class="podium-score"><span>${record.wins}x</span> <span class="podium-score-unit">menang</span></div>
                <div class="podium-mistakes">&nbsp;</div>
                <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
            </div>
        `;
    }).join('');
}

function renderKnowledgeDuelWinsList(records) {
    const listEl = document.getElementById('knowledgeRankList');
    if (records.length === 0) {
        listEl.innerHTML = `<li class="rank-list-empty">Belum ada duel yang dimenangkan di sini.<br>Jadilah yang pertama! 🏁</li>`;
        return;
    }
    const rest = records.slice(3, MAX_KNOWLEDGE_LEADERBOARD);
    if (rest.length === 0) {
        listEl.innerHTML = '';
        return;
    }
    listEl.innerHTML = rest.map((record, i) => {
        const rank = i + 4;
        return `
            <li class="rank-list-row">
                <span class="rank-list-position">${rank}</span>
                <span class="rank-list-avatar">${avatarGlyph(record.avatar)}</span>
                <span class="rank-list-name">${escapeHtml(record.name)}</span>
                <span class="rank-list-dots" aria-hidden="true"></span>
                <span class="rank-list-score">${record.wins}x<small>menang</small></span>
            </li>
        `;
    }).join('');
}

function goToKnowledgeDashboard(focusTab) {
    countdownRunToken++;
    document.getElementById('countdownOverlay').classList.remove('is-visible');
    setKnowledgeLeaderboardTab(focusTab || knowledgeActiveLeaderboardTab);
    switchView('knowledgeDashboard');
}

/* ---- Avatar picker (simpan skor solo & form duel) ---- */
buildAvatarPicker('knowledgeAvatarPicker', (avatar) => { knowledgeSelectedAvatar = avatar; });
buildAvatarPicker('knowledgeDuelCreateAvatarPicker', (avatar) => { knowledgeDuelCreateSelectedAvatar = avatar; });
buildAvatarPicker('knowledgeDuelJoinAvatarPicker', (avatar) => { knowledgeDuelJoinSelectedAvatar = avatar; });

/* ---- Bantuan & konfirmasi keluar ---- */
document.getElementById('knowledgeHelpButton').addEventListener('click', () => {
    showModal('knowledgeHelpModal');
});


document.getElementById('knowledgeBackToDashboardButton').addEventListener('click', () => {
    if (knowledgeGameInProgress || knowledgeDuelState) {
        showModal('knowledgeConfirmExitModal');
    } else {
        goToKnowledgeDashboard();
    }
});

document.getElementById('knowledgeConfirmExitYesButton').addEventListener('click', async () => {
    hideModal('knowledgeConfirmExitModal');
    stopKnowledgeRoundTimer();
    knowledgeGameInProgress = false;
    if (knowledgeDuelState) {
        await abandonKnowledgeDuel();
    }
    goToKnowledgeDashboard();
});

/* =====================================================================================
   ALUR GAME SOLO
===================================================================================== */
document.getElementById('knowledgeOpenSoloButton').addEventListener('click', () => {
    startKnowledgeSoloGame();
});

function prepareKnowledgeGameUI() {
    // Tampilkan overlay countdown SINKRON bareng switchView, supaya tidak ada celah
    // "layar game polos" sempat kelihatan sebelum overlay menutupinya (lihat catatan
    // yang sama di prepareDuelGameUI milik game Perkalian).
    const overlay = document.getElementById('countdownOverlay');
    document.getElementById('countdownNumber').textContent = COUNTDOWN_STEPS[0].text;
    document.getElementById('countdownLabel').textContent = COUNTDOWN_STEPS[0].label;
    overlay.classList.add('is-visible');

    knowledgeGameInProgress = true;
    knowledgeLastSavedRecord = null;
    knowledgeCorrectCount = 0;
    knowledgeScoreTenths = 0;
    knowledgeStreak = 0;
    clearKnowledgeGain();
    knowledgeBurnedCount = 0;
    knowledgeHintsUsed = 0;
    knowledgeSeqIndex = 0;
    knowledgeLastResolved = null;
    renderKnowledgeRecap();

    document.getElementById('knowledgeTimer').textContent = '01:00';
    document.getElementById('knowledgeTimerBarFill').style.width = '100%';
    document.getElementById('knowledgeTimerBarFill').style.backgroundColor = '';
    document.getElementById('knowledgeProgressLabel').textContent = 'Skor: 0,0';
    document.getElementById('knowledgeQuestionText').textContent = '';
    document.querySelectorAll('.knowledge-option-btn').forEach(btn => {
        resetKnowledgeOptionButton(btn, '');
        btn.disabled = true;
    });
    document.getElementById('knowledgeHintButton').disabled = true;

    switchView('knowledgeGame');
}

function startKnowledgeSoloGame() {
    knowledgeDuelState = null;
    knowledgeSequence = generateKnowledgeSequence(KNOWLEDGE_ROUND_BUFFER);
    prepareKnowledgeGameUI();
    document.getElementById('knowledgeDuelOpponentBar').style.display = 'none';
    document.getElementById('knowledgeDuelDisconnectBanner').style.display = 'none';
    runCountdown(() => {
        beginKnowledgeRound(Date.now() + KNOWLEDGE_ROUND_DURATION_MS);
    });
}

function beginKnowledgeRound(endAtMillis) {
    knowledgeRoundEndAt = endAtMillis;
    displayKnowledgeQuestion();
    startKnowledgeRoundTimer();
}

function startKnowledgeRoundTimer() {
    clearInterval(knowledgeRoundTimerInterval);
    knowledgeRoundTimerInterval = setInterval(() => {
        const remainingMs = knowledgeRoundEndAt - Date.now();
        const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
        const minutes = Math.floor(remainingSec / 60).toString().padStart(2, '0');
        const seconds = (remainingSec % 60).toString().padStart(2, '0');
        document.getElementById('knowledgeTimer').textContent = `${minutes}:${seconds}`;
        const pct = Math.max(0, Math.min(100, (remainingMs / KNOWLEDGE_ROUND_DURATION_MS) * 100));
        const fill = document.getElementById('knowledgeTimerBarFill');
        fill.style.width = `${pct}%`;
        fill.style.backgroundColor = remainingSec <= 10 ? 'var(--color-danger)' : '';

        if (remainingMs <= 0) {
            stopKnowledgeRoundTimer();
            if (knowledgeDuelState) {
                endKnowledgeDuelRound();
            } else {
                endKnowledgeSoloRound();
            }
        }
    }, 200);
}

function stopKnowledgeRoundTimer() {
    clearInterval(knowledgeRoundTimerInterval);
    knowledgeRoundTimerInterval = null;
}

/* ---- Tombol opsi: keadaan normal / salah (bisa dibuka penjelasannya) ---- */
function resetKnowledgeOptionButton(btn, text) {
    btn.innerHTML = '';
    btn.className = 'knowledge-option-btn';
    btn.style.display = 'flex';
    btn.removeAttribute('data-state');
    btn.removeAttribute('aria-expanded');
    const label = document.createElement('span');
    label.className = 'kn-opt-text';
    label.textContent = text === undefined || text === null ? '' : text;
    btn.appendChild(label);
}

// Opsi salah: merah + tidak dicoret, teks tetap terbaca, tombol berubah fungsi jadi pembuka penjelasan
function markKnowledgeOptionWrong(btn, idx, q) {
    btn.dataset.state = 'wrong';
    btn.classList.add('is-wrong');
    btn.setAttribute('aria-expanded', 'false');

    const cue = document.createElement('span');
    cue.className = 'kn-opt-cue';
    cue.textContent = 'ⓘ Lihat penjelasan';
    btn.appendChild(cue);

    const explain = document.createElement('span');
    explain.className = 'kn-opt-explain';
    explain.hidden = true;
    explain.textContent = q.explanations[idx] || 'Penjelasan untuk opsi ini belum tersedia.';
    btn.appendChild(explain);
}

// Buka/tutup penjelasan opsi salah. TIDAK menilai jawaban dan TIDAK mengubah opsi lain.
function toggleKnowledgeOptionExplanation(btn) {
    const explain = btn.querySelector('.kn-opt-explain');
    const cue = btn.querySelector('.kn-opt-cue');
    if (!explain || !cue) return;
    const willOpen = explain.hidden;
    explain.hidden = !willOpen;
    btn.classList.toggle('is-open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
    cue.textContent = willOpen ? '▴ Sembunyikan' : 'ⓘ Lihat penjelasan';
}

// Panel "Pembahasan soal sebelumnya": isi dari data soal yang BARU SAJA selesai, disimpan saat soal selesai diproses
function renderKnowledgeRecap() {
    const box = document.getElementById('knowledgeRecap');
    if (!box) return;
    if (!knowledgeLastResolved) {
        box.style.display = 'none';
        return;
    }
    const { q, status } = knowledgeLastResolved;
    document.getElementById('knowledgeRecapStatus').textContent =
        status === 'correct' ? '📖 Pembahasan soal sebelumnya · ✅ Dijawab benar' : '📖 Pembahasan soal sebelumnya · 💀 Soal hangus';
    document.getElementById('knowledgeRecapQuestion').textContent = q.question;
    document.getElementById('knowledgeRecapAnswer').textContent = q.options[q.correctIndex];
    document.getElementById('knowledgeRecapExplanation').textContent =
        q.explanations[q.correctIndex] || 'Penjelasan untuk jawaban ini belum tersedia.';
    box.style.display = 'block';
}

function displayKnowledgeQuestion() {
    if (knowledgeSeqIndex >= knowledgeSequence.length) {
        knowledgeSequence = knowledgeSequence.concat(generateKnowledgeSequence(KNOWLEDGE_ROUND_BUFFER));
    }
    const q = knowledgeSequence[knowledgeSeqIndex];
    knowledgeWrongClicksThisQuestion = 0;
    knowledgeHintUsedThisQuestion = false;

    document.getElementById('knowledgeQuestionText').textContent = q.question;
    const btns = document.querySelectorAll('.knowledge-option-btn');
    btns.forEach((btn, i) => {
        resetKnowledgeOptionButton(btn, q.options[i]);
        btn.disabled = false;
    });
    document.getElementById('knowledgeHintButton').disabled = false;
    renderKnowledgeRecap(); // pembahasan soal TERAKHIR yang selesai (benar atau hangus); kosong di soal nomor 1
    document.getElementById('knowledgeProgressLabel').textContent = `Skor: ${formatKnowledgeScore(tenthsToScore(knowledgeScoreTenths))}`;
}

document.querySelectorAll('.knowledge-option-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => handleKnowledgeOptionClick(idx));
});

function handleKnowledgeOptionClick(idx) {
    if (!knowledgeGameInProgress) return;
    const btns = Array.from(document.querySelectorAll('.knowledge-option-btn'));
    const btn = btns[idx];
    if (!btn || btn.disabled) return;

    // Opsi yang sudah ditandai salah: tekan lagi = buka/tutup penjelasannya (bukan jawaban baru)
    if (btn.dataset.state === 'wrong') {
        toggleKnowledgeOptionExplanation(btn);
        return;
    }

    const q = knowledgeSequence[knowledgeSeqIndex];

    if (idx === q.correctIndex) {
        btn.classList.add('is-correct');
        playCorrectSound();
        const gained = knowledgePointsForCorrect(knowledgeWrongClicksThisQuestion, knowledgeHintUsedThisQuestion);
        // Streak hanya bertambah bila benar di klik pertama dan tanpa Hint; selain itu streak putus
        const cleanAnswer = knowledgeWrongClicksThisQuestion === 0 && !knowledgeHintUsedThisQuestion;
        knowledgeStreak = cleanAnswer ? knowledgeStreak + 1 : 0;
        const bonus = knowledgeStreakBonusTenths(knowledgeStreak);
        knowledgeScoreTenths += gained + bonus;
        showKnowledgeGain(gained, bonus);
        if (bonus > 0) triggerKnowledgeStreakFx(knowledgeStreak);
        knowledgeCorrectCount++;
        knowledgeLastResolved = { q, status: 'correct' };
        document.getElementById('knowledgeProgressLabel').textContent = `Skor: ${formatKnowledgeScore(tenthsToScore(knowledgeScoreTenths))}`;
        btns.forEach(b => { b.disabled = true; });
        if (knowledgeDuelState) reportKnowledgeDuelProgress();
        setTimeout(advanceKnowledgeQuestion, 450);
        return;
    }

    markKnowledgeOptionWrong(btn, idx, q);
    playWrongSound();
    knowledgeWrongClicksThisQuestion++;
    breakKnowledgeStreak();
    // Sudah 2 opsi salah ditekan: hint tidak relevan lagi, nonaktifkan tombolnya
    if (knowledgeWrongClicksThisQuestion >= 2) document.getElementById('knowledgeHintButton').disabled = true;

    // Hangus bila tidak ada lagi opsi salah yang masih bisa dipilih (tersisa jawaban benar saja)
    const selectableDistractors = btns.filter((b, i) =>
        i !== q.correctIndex && b.dataset.state !== 'wrong' && b.style.display !== 'none').length;
    if (selectableDistractors === 0) {
        knowledgeBurnedCount++;
        knowledgeScoreTenths += KNOWLEDGE_POINTS_BURNED;
        showKnowledgeGain(KNOWLEDGE_POINTS_BURNED, 0);
        knowledgeLastResolved = { q, status: 'burned' };
        document.getElementById('knowledgeProgressLabel').textContent = `Skor: ${formatKnowledgeScore(tenthsToScore(knowledgeScoreTenths))}`;
        btns.forEach(b => { b.disabled = true; });
        if (knowledgeDuelState) reportKnowledgeDuelProgress();
        setTimeout(advanceKnowledgeQuestion, 650);
    }
}

function advanceKnowledgeQuestion() {
    knowledgeSeqIndex++;
    if (knowledgeRoundEndAt - Date.now() > 0 && knowledgeGameInProgress) {
        displayKnowledgeQuestion();
    }
    // Kalau waktu sudah habis tepat di momen ini, interval timer yang akan menangani endRound.
}

document.getElementById('knowledgeHintButton').addEventListener('click', () => {
    if (knowledgeHintUsedThisQuestion || !knowledgeGameInProgress || knowledgeWrongClicksThisQuestion >= 2) return;
    const q = knowledgeSequence[knowledgeSeqIndex];
    const btns = Array.from(document.querySelectorAll('.knowledge-option-btn'));

    // Opsi yang masih "hidup" = bukan jawaban benar, belum ditandai salah, belum disembunyikan
    const viableDistractorIdx = btns
        .map((b, i) => i)
        .filter(i => i !== q.correctIndex && btns[i].dataset.state !== 'wrong' && btns[i].style.display !== 'none');

    if (viableDistractorIdx.length === 0) return; // sudah tersisa 1 opsi (benar) saja, hint tak relevan lagi

    knowledgeHintUsedThisQuestion = true;
    knowledgeHintsUsed++;
    breakKnowledgeStreak(); // memakai Hint memutus streak
    document.getElementById('knowledgeHintButton').disabled = true;

    // Dari distraktor yang masih "hidup", sisakan 1 secara acak, sembunyikan sisanya.
    // Opsi yang sudah ditandai salah TIDAK disembunyikan, supaya penjelasannya tetap bisa dibuka.
    const keepIndex = viableDistractorIdx[Math.floor(Math.random() * viableDistractorIdx.length)];
    viableDistractorIdx.forEach(i => {
        if (i !== keepIndex) btns[i].style.display = 'none';
    });

});

/* ---- Insight peringkat (analog buildRankInsight milik game Perkalian, tapi "lebih tinggi = lebih baik") ---- */
function buildKnowledgeRankInsight(score, hints, burned, records) {
    const myTenths = Math.round(score * 10);
    const sorted = sortKnowledgeSoloRecords(records);
    const better = sorted.filter(r => {
        const t = knowledgeScoreTenthsOf(r);
        return t > myTenths || (t === myTenths && (r.hints < hints || (r.hints === hints && r.burned <= burned)));
    }).length;
    const rank = better + 1;
    const qualifies = rank <= MAX_KNOWLEDGE_LEADERBOARD;
    const gapText = (tenths) => formatKnowledgeScore(Math.max(1, tenths) / 10);

    if (sorted.length === 0) {
        return {
            rank: 1, qualifies: true, tone: 'top',
            headline: '🏆 Kamu pemain pertama di sini!',
            details: [{ icon: '💾', text: 'Simpan skormu untuk jadi peringkat 1 di papan peringkat.' }]
        };
    }

    const top = sorted[0];
    const details = [];

    if (rank === 1) {
        const gap = myTenths - knowledgeScoreTenthsOf(top);
        details.push({ icon: '⚡', text: gap > 0 ? `${gapText(gap)} poin lebih tinggi dari rekor sebelumnya.` : `Skor sama, tapi hint/hangus-mu lebih sedikit.` });
        return { rank, qualifies, tone: 'top', headline: '👑 Rekor baru! Kamu peringkat 1', details };
    }

    if (rank <= 3) {
        const gapToTop = knowledgeScoreTenthsOf(top) - myTenths;
        details.push({ icon: '🎯', text: `${gapText(gapToTop)} poin lagi untuk menyamai peringkat 1.` });
        return { rank, qualifies, tone: 'top', headline: `${rank === 2 ? '🥈' : '🥉'} Kamu masuk 3 besar! Peringkat ${rank}`, details };
    }

    if (qualifies) {
        const third = sorted[2];
        details.push({ icon: '🥉', text: `${gapText(knowledgeScoreTenthsOf(third) - myTenths + 1)} poin lagi untuk masuk 3 besar.` });
        return { rank, qualifies, tone: 'ok', headline: `🎯 Kamu masuk papan peringkat! Peringkat ${rank}`, details };
    }

    const last = sorted[MAX_KNOWLEDGE_LEADERBOARD - 1];
    details.push({ icon: '📉', text: `${gapText(knowledgeScoreTenthsOf(last) - myTenths + 1)} poin lagi untuk masuk papan peringkat.` });
    return { rank, qualifies, tone: 'miss', headline: '💪 Belum masuk papan peringkat, ayo coba lagi!', details };
}

function renderKnowledgeRankInsight(insight) {
    const box = document.getElementById('knowledgeRankInsight');
    box.className = `rank-insight is-${insight.tone}`;
    document.getElementById('knowledgeRankInsightHeadline').textContent = insight.headline;
    const list = document.getElementById('knowledgeRankInsightDetails');
    list.innerHTML = '';
    insight.details.forEach(detail => {
        const li = document.createElement('li');
        li.dataset.icon = detail.icon;
        li.textContent = detail.text;
        list.appendChild(li);
    });
    box.style.display = 'block';
}

async function endKnowledgeSoloRound() {
    knowledgeGameInProgress = false;
    document.querySelectorAll('.knowledge-option-btn').forEach(b => { b.disabled = true; });
    document.getElementById('knowledgeHintButton').disabled = true;

    const finalScore = tenthsToScore(knowledgeScoreTenths);
    document.getElementById('knowledgeFinalScore').textContent = formatKnowledgeScore(finalScore);
    document.getElementById('knowledgeFinalCorrect').textContent = knowledgeCorrectCount.toString();
    document.getElementById('knowledgeFinalHints').textContent = knowledgeHintsUsed.toString();
    document.getElementById('knowledgeFinalBurned').textContent = knowledgeBurnedCount.toString();

    const records = await getKnowledgeSoloRecords();
    const insight = buildKnowledgeRankInsight(finalScore, knowledgeHintsUsed, knowledgeBurnedCount, records);
    renderKnowledgeRankInsight(insight);
    document.getElementById('knowledgeSaveScoreButton').style.display = insight.qualifies ? 'inline-block' : 'none';

    showModal('knowledgeEndModal');
    launchConfetti();
    playFinishSounds(insight.qualifies);
}

document.getElementById('knowledgeSaveScoreButton').addEventListener('click', async () => {
    hideModal('knowledgeEndModal');
    await waitForModalHidden('knowledgeEndModal');
    showModal('knowledgeSaveRecordModal');
});

document.getElementById('knowledgeButtonSavePlayerRecord').addEventListener('click', saveKnowledgePlayerRecord);

async function saveKnowledgePlayerRecord() {
    const nameInput = document.getElementById('knowledgePlayerName');
    const playerName = nameInput.value.trim();
    if (!playerName) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    const saveBtn = document.getElementById('knowledgeButtonSavePlayerRecord');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';

    let saveResult = null;
    try {
        saveResult = await saveKnowledgeSoloRecord({
            name: playerName,
            score: tenthsToScore(knowledgeScoreTenths),
            correct: knowledgeCorrectCount,
            hints: knowledgeHintsUsed,
            burned: knowledgeBurnedCount,
            avatar: knowledgeSelectedAvatar
        });
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
    }

    hideModal('knowledgeSaveRecordModal');
    nameInput.value = '';
    knowledgeLastSavedRecord = { name: playerName, score: tenthsToScore(knowledgeScoreTenths), hints: knowledgeHintsUsed, burned: knowledgeBurnedCount };

    if (saveResult && saveResult.error) {
        showToast('danger', `Gagal simpan online: ${saveResult.error}`, 6000);
    }

    goToKnowledgeDashboard('solo');
}

document.getElementById('knowledgeSaveRecordModal').addEventListener('shown.bs.modal', function () {
    document.getElementById('knowledgePlayerName').focus();
});

document.getElementById('knowledgePlayAgainButton').addEventListener('click', () => {
    hideModal('knowledgeEndModal');
    startKnowledgeSoloGame();
});

document.getElementById('knowledgeEndBackToDashboardButton').addEventListener('click', () => {
    hideModal('knowledgeEndModal');
    goToKnowledgeDashboard('solo');
});

/* =====================================================================================
   DUEL 1v1 PENGETAHUAN DASAR
===================================================================================== */
function knowledgeDuelDocRef(roomCode) {
    return firestoreDb.collection('knowledge_duels').doc(roomCode);
}

document.getElementById('knowledgeOpenDuelButton').addEventListener('click', () => {
    if (!requireFirebaseForDuel()) return;
    showModal('knowledgeDuelModal');
});

document.getElementById('knowledgeDuelCreateRoomButton').addEventListener('click', async () => {
    hideModal('knowledgeDuelModal');
    await waitForModalHidden('knowledgeDuelModal');
    showModal('knowledgeDuelCreateModal');
});

document.getElementById('knowledgeDuelJoinRoomButton').addEventListener('click', async () => {
    hideModal('knowledgeDuelModal');
    await waitForModalHidden('knowledgeDuelModal');
    showModal('knowledgeDuelJoinModal');
});

document.getElementById('knowledgeDuelJoinCode').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

document.getElementById('knowledgeDuelCreateSubmitButton').addEventListener('click', createKnowledgeDuelRoom);

async function createKnowledgeDuelRoom() {
    const nameInput = document.getElementById('knowledgeDuelCreateName');
    const name = nameInput.value.trim();
    if (!name) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    cleanupKnowledgeDuel();
    hideModal('knowledgeDuelCreateModal');

    const sequence = generateKnowledgeSequence(KNOWLEDGE_ROUND_BUFFER);
    let roomCode = null;

    try {
        for (let attempt = 0; attempt < 6 && !roomCode; attempt++) {
            const candidate = generateRoomCode();
            const snap = await knowledgeDuelDocRef(candidate).get();
            if (!snap.exists) roomCode = candidate;
        }
        if (!roomCode) throw new Error('kode-habis');

        await knowledgeDuelDocRef(roomCode).set({
            status: 'waiting',
            createdAt: Date.now(),
            startAtMillis: null,
            winner: null,
            rematch: null,
            questions: sequence,
            host: { name: name, avatar: knowledgeDuelCreateSelectedAvatar, score: 0, correct: 0, burned: 0, hints: 0, finishedAt: null, lastSeen: Date.now() },
            guest: null
        });
    } catch (e) {
        showToast('danger', `Gagal membuat room: ${e.code || e.message}`, 5000);
        return;
    }

    knowledgeDuelState = {
        roomCode, role: 'host', sequence,
        lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false
    };
    document.getElementById('knowledgeDuelRoomCodeDisplay').textContent = roomCode;
    await waitForModalHidden('knowledgeDuelCreateModal');
    showModal('knowledgeDuelWaitingModal');
    listenToKnowledgeDuelRoom(roomCode);
    startKnowledgeDuelHeartbeat();
}

document.getElementById('knowledgeDuelCopyCodeButton').addEventListener('click', () => {
    const code = document.getElementById('knowledgeDuelRoomCodeDisplay').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast('success', 'Kode disalin!')).catch(() => {});
    }
});

document.getElementById('knowledgeDuelCancelWaitingButton').addEventListener('click', async () => {
    hideModal('knowledgeDuelWaitingModal');
    await abandonKnowledgeDuel();
});

document.getElementById('knowledgeDuelJoinSubmitButton').addEventListener('click', joinKnowledgeDuelRoom);

async function joinKnowledgeDuelRoom() {
    const codeInput = document.getElementById('knowledgeDuelJoinCode');
    const nameInput = document.getElementById('knowledgeDuelJoinName');
    const code = codeInput.value.trim().toUpperCase();
    const name = nameInput.value.trim();

    if (code.length !== 4) {
        showToast('danger', 'Kode room terdiri dari 4 karakter.');
        codeInput.focus();
        return;
    }
    if (!name) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    const submitBtn = document.getElementById('knowledgeDuelJoinSubmitButton');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menghubungkan...';

    try {
        const ref = knowledgeDuelDocRef(code);
        const snap = await ref.get();
        if (!snap.exists) {
            showToast('danger', 'Kode room tidak ditemukan.');
            return;
        }
        const room = snap.data();
        if (room.status !== 'waiting' || room.guest) {
            showToast('danger', 'Room ini sudah penuh atau sedang bermain.');
            return;
        }

        const startAtMillis = Date.now() + KNOWLEDGE_DUEL_START_BUFFER_MS;
        await ref.update({
            guest: { name: name, avatar: knowledgeDuelJoinSelectedAvatar, score: 0, correct: 0, burned: 0, hints: 0, finishedAt: null, lastSeen: Date.now() },
            status: 'countdown',
            startAtMillis: startAtMillis
        });

        cleanupKnowledgeDuel();
        knowledgeDuelState = {
            roomCode: code, role: 'guest', sequence: room.questions,
            lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false
        };
        codeInput.value = '';
        nameInput.value = '';
        hideModal('knowledgeDuelJoinModal');
        listenToKnowledgeDuelRoom(code);
        startKnowledgeDuelHeartbeat();
    } catch (e) {
        showToast('danger', `Gagal gabung room: ${e.code || e.message}`, 5000);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gabung';
    }
}

function listenToKnowledgeDuelRoom(roomCode) {
    if (!knowledgeDuelState) return;
    knowledgeDuelState.unsubscribe = knowledgeDuelDocRef(roomCode).onSnapshot(
        snap => {
            if (!snap.exists) {
                if (!knowledgeDuelState) return;
                showToast('danger', 'Room duel sudah tidak tersedia.', 4000);
                cleanupKnowledgeDuel();
                goToKnowledgeDashboard('duel');
                return;
            }
            handleKnowledgeDuelRoomUpdate(snap.data());
        },
        err => console.warn('[Duel Pengetahuan Dasar] listener error', err)
    );
}

async function handleKnowledgeDuelRoomUpdate(room) {
    if (!knowledgeDuelState) return;

    const opponentRole = knowledgeDuelState.role === 'host' ? 'guest' : 'host';
    const opponent = room[opponentRole];

    if (room.status === 'abandoned') {
        showToast('danger', 'Lawan meninggalkan duel.', 4000);
        cleanupKnowledgeDuel();
        goToKnowledgeDashboard('duel');
        return;
    }

    if (room.status === 'countdown' && room.startAtMillis !== knowledgeDuelState.lastStartAtMillis) {
        knowledgeDuelState.lastStartAtMillis = room.startAtMillis;
        knowledgeDuelState.lastRematchUpdatedAt = null;
        knowledgeDuelState.resultShown = false;
        knowledgeDuelState.sequence = room.questions;
        knowledgeDuelState.opponentName = opponent ? opponent.name : 'Lawan';
        knowledgeDuelState.opponentAvatar = opponent ? opponent.avatar : null;

        hideModal('knowledgeDuelWaitingModal');
        hideModal('knowledgeDuelResultModal');
        hideModal('knowledgeDuelWaitingResultModal');
        hideModal('knowledgeDuelRematchWaitingModal');
        hideModal('knowledgeDuelRematchRequestModal');
        beginKnowledgeDuelCountdown(room.startAtMillis);
    }

    if ((room.status === 'playing' || room.status === 'countdown') && opponent) {
        updateKnowledgeDuelOpponentUI(opponent);
    }

    if (room.status === 'finished' && !knowledgeDuelState.resultShown) {
        knowledgeDuelState.resultShown = true;
        if (knowledgeGameInProgress) {
            knowledgeGameInProgress = false;
            stopKnowledgeRoundTimer();
            document.querySelectorAll('.knowledge-option-btn').forEach(b => { b.disabled = true; });
            document.getElementById('knowledgeHintButton').disabled = true;
        }
        await waitForModalHidden('knowledgeDuelWaitingResultModal');
        showKnowledgeDuelResult(room);
    }

    if (room.rematch && room.rematch.updatedAt !== knowledgeDuelState.lastRematchUpdatedAt) {
        knowledgeDuelState.lastRematchUpdatedAt = room.rematch.updatedAt;
        const iAmRequester = room.rematch.requestedBy === knowledgeDuelState.role;

        if (room.rematch.status === 'pending') {
            if (iAmRequester) {
                showModal('knowledgeDuelRematchWaitingModal');
            } else {
                document.getElementById('knowledgeDuelRematchRequestText').textContent =
                    `${opponent ? opponent.name : 'Lawan'} ingin main lagi. Setuju?`;
                showModal('knowledgeDuelRematchRequestModal');
            }
        } else if (room.rematch.status === 'declined') {
            hideModal('knowledgeDuelRematchWaitingModal');
            hideModal('knowledgeDuelRematchRequestModal');
            if (iAmRequester) {
                showToast('danger', 'Lawan menolak ajakan main lagi.', 4000);
                await waitForModalHidden('knowledgeDuelRematchWaitingModal');
                showModal('knowledgeDuelResultModal');
                knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({ rematch: null }).catch(() => {});
            }
        }
    }

    checkKnowledgeDuelOpponentHeartbeat(opponent, room.status);
}

function beginKnowledgeDuelCountdown(startAtMillis) {
    const countdownDurationMs = COUNTDOWN_STEPS.length * 800 + 650;
    const waitMs = Math.max(0, (startAtMillis - Date.now()) - countdownDurationMs);

    knowledgeSequence = knowledgeDuelState.sequence;
    prepareKnowledgeGameUI();

    const oppBar = document.getElementById('knowledgeDuelOpponentBar');
    oppBar.style.display = 'flex';
    document.getElementById('knowledgeDuelOpponentAvatar').textContent = avatarGlyph(knowledgeDuelState.opponentAvatar);
    document.getElementById('knowledgeDuelOpponentName').textContent = knowledgeDuelState.opponentName || 'Lawan';
    document.getElementById('knowledgeDuelOpponentFill').style.width = '0%';
    document.getElementById('knowledgeDuelOpponentCount').textContent = '0 benar';
    document.getElementById('knowledgeDuelDisconnectBanner').style.display = 'none';

    setTimeout(() => {
        if (!knowledgeDuelState) return;
        runCountdown(() => {
            beginKnowledgeRound(startAtMillis + KNOWLEDGE_ROUND_DURATION_MS);
        });
    }, waitMs);

    knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({ status: 'playing' }).catch(() => {});
}

function updateKnowledgeDuelOpponentUI(opponent) {
    const fill = document.getElementById('knowledgeDuelOpponentFill');
    const countEl = document.getElementById('knowledgeDuelOpponentCount');
    if (!fill || !countEl) return;
    const oppScore = Number(opponent.score) || 0;
    const pct = Math.max(0, Math.min(100, (oppScore / 15) * 100)); // skala visual kasar, bukan target pasti
    fill.style.width = `${pct}%`;
    countEl.textContent = `${formatKnowledgeScore(oppScore)} poin`;
}

function reportKnowledgeDuelProgress() {
    if (!knowledgeDuelState) return;
    knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({
        [`${knowledgeDuelState.role}.score`]: tenthsToScore(knowledgeScoreTenths),
        [`${knowledgeDuelState.role}.correct`]: knowledgeCorrectCount,
        [`${knowledgeDuelState.role}.burned`]: knowledgeBurnedCount,
        [`${knowledgeDuelState.role}.hints`]: knowledgeHintsUsed,
        [`${knowledgeDuelState.role}.lastSeen`]: Date.now()
    }).catch(e => console.warn('[Duel Pengetahuan Dasar] gagal kirim progres', e));
}

// Berbeda dari duel Perkalian: di sini KEDUA pemain main penuh 60 detik (bukan lomba selesai duluan),
// jadi pemenang baru bisa ditentukan setelah KEDUA sisi sama-sama menuliskan hasil akhirnya.
async function endKnowledgeDuelRound() {
    knowledgeGameInProgress = false;
    document.querySelectorAll('.knowledge-option-btn').forEach(b => { b.disabled = true; });
    document.getElementById('knowledgeHintButton').disabled = true;

    const myRole = knowledgeDuelState.role;
    const opponentRole = myRole === 'host' ? 'guest' : 'host';
    const roomRef = knowledgeDuelDocRef(knowledgeDuelState.roomCode);
    const myFinal = { score: tenthsToScore(knowledgeScoreTenths), correct: knowledgeCorrectCount, burned: knowledgeBurnedCount, hints: knowledgeHintsUsed };

    try {
        await firestoreDb.runTransaction(async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists) return;
            const room = snap.data();

            const update = {
                [`${myRole}.score`]: myFinal.score,
                [`${myRole}.correct`]: myFinal.correct,
                [`${myRole}.burned`]: myFinal.burned,
                [`${myRole}.hints`]: myFinal.hints,
                [`${myRole}.finishedAt`]: Date.now()
            };

            const opponentData = room[opponentRole];
            if (opponentData && opponentData.finishedAt) {
                update.status = 'finished';
                update.winner = determineKnowledgeDuelWinner(myRole, myFinal, opponentRole, opponentData);
            }

            tx.update(roomRef, update);
        });
    } catch (e) {
        showToast('danger', `Gagal mengirim hasil duel: ${e.code || e.message}`, 5000);
    }

    if (!knowledgeDuelState.resultShown) {
        showModal('knowledgeDuelWaitingResultModal');
    }
}

function determineKnowledgeDuelWinner(roleA, dataA, roleB, dataB) {
    const tA = Math.round((Number(dataA.score) || 0) * 10);
    const tB = Math.round((Number(dataB.score) || 0) * 10);
    if (tA !== tB) return tA > tB ? roleA : roleB;
    if (dataA.hints !== dataB.hints) return dataA.hints < dataB.hints ? roleA : roleB;
    if (dataA.burned !== dataB.burned) return dataA.burned < dataB.burned ? roleA : roleB;
    return 'draw';
}

async function showKnowledgeDuelResult(room) {
    stopKnowledgeDuelHeartbeat();
    hideModal('knowledgeDuelWaitingResultModal');

    const isDraw = room.winner === 'draw';
    const amIWinner = room.winner === knowledgeDuelState.role;
    const me = knowledgeDuelState.role === 'host' ? room.host : room.guest;
    const opponent = knowledgeDuelState.role === 'host' ? room.guest : room.host;

    const banner = document.getElementById('knowledgeDuelWinnerBanner');
    if (isDraw) {
        banner.textContent = '🤝 Seri!';
        banner.className = 'duel-winner-banner is-lose';
    } else {
        banner.textContent = amIWinner ? '🏆 Kamu Menang!' : `😅 ${opponent ? opponent.name : 'Lawan'} Menang`;
        banner.className = `duel-winner-banner ${amIWinner ? 'is-win' : 'is-lose'}`;
    }

    const renderPlayer = (label, player) => {
        const finished = !!(player && player.finishedAt);
        const statLine = finished
            ? `${formatKnowledgeScore(player.score)} poin · ${player.correct} benar · 💡${player.hints} · 💀${player.burned}`
            : `Belum menyelesaikan waktunya`;
        return `
            <div class="duel-result-card">
                <div class="duel-result-avatar">${avatarGlyph(player ? player.avatar : null)}</div>
                <div class="duel-result-name">${escapeHtml(player ? player.name : '—')}</div>
                <div class="duel-result-label">${label}</div>
                <div class="duel-result-stat">${statLine}</div>
            </div>
        `;
    };

    document.getElementById('knowledgeDuelResultGrid').innerHTML =
        renderPlayer('Kamu', me) + renderPlayer('Lawan', opponent);

    if (amIWinner && me) {
        await recordKnowledgeDuelWin(me.name, me.avatar);
    }

    showModal('knowledgeDuelResultModal');
    launchConfetti();
    playFinishSounds(amIWinner);
}

document.getElementById('knowledgeDuelRematchButton').addEventListener('click', async () => {
    if (!knowledgeDuelState) return;
    hideModal('knowledgeDuelResultModal');
    await waitForModalHidden('knowledgeDuelResultModal');
    try {
        await knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({
            rematch: { requestedBy: knowledgeDuelState.role, status: 'pending', updatedAt: Date.now() }
        });
        showModal('knowledgeDuelRematchWaitingModal');
    } catch (e) {
        showToast('danger', `Gagal mengirim ajakan main lagi: ${e.code || e.message}`, 5000);
        showModal('knowledgeDuelResultModal');
    }
});

document.getElementById('knowledgeDuelRematchCancelButton').addEventListener('click', async () => {
    hideModal('knowledgeDuelRematchWaitingModal');
    if (knowledgeDuelState) {
        try {
            await knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({ rematch: null });
        } catch (e) { /* abaikan */ }
    }
    await waitForModalHidden('knowledgeDuelRematchWaitingModal');
    showModal('knowledgeDuelResultModal');
});

document.getElementById('knowledgeDuelRematchAcceptButton').addEventListener('click', async () => {
    if (!knowledgeDuelState) return;
    hideModal('knowledgeDuelRematchRequestModal');
    await waitForModalHidden('knowledgeDuelRematchRequestModal');

    const newSequence = generateKnowledgeSequence(KNOWLEDGE_ROUND_BUFFER);
    knowledgeDuelState.sequence = newSequence;

    try {
        await knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({
            questions: newSequence,
            status: 'countdown',
            startAtMillis: Date.now() + KNOWLEDGE_DUEL_START_BUFFER_MS,
            winner: null,
            rematch: null,
            'host.score': 0, 'host.correct': 0, 'host.burned': 0, 'host.hints': 0, 'host.finishedAt': null, 'host.lastSeen': Date.now(),
            'guest.score': 0, 'guest.correct': 0, 'guest.burned': 0, 'guest.hints': 0, 'guest.finishedAt': null, 'guest.lastSeen': Date.now()
        });
    } catch (e) {
        showToast('danger', `Gagal memulai ulang duel: ${e.code || e.message}`, 5000);
    }
});

document.getElementById('knowledgeDuelRematchDeclineButton').addEventListener('click', async () => {
    if (!knowledgeDuelState) return;
    hideModal('knowledgeDuelRematchRequestModal');
    await waitForModalHidden('knowledgeDuelRematchRequestModal');
    showModal('knowledgeDuelResultModal');

    const requesterRole = knowledgeDuelState.role === 'host' ? 'guest' : 'host';
    try {
        await knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({
            rematch: { requestedBy: requesterRole, status: 'declined', updatedAt: Date.now() }
        });
    } catch (e) { /* abaikan */ }
});

document.getElementById('knowledgeDuelResultDashboardButton').addEventListener('click', () => {
    hideModal('knowledgeDuelResultModal');
    cleanupKnowledgeDuel();
    goToKnowledgeDashboard('duel');
});

function startKnowledgeDuelHeartbeat() {
    stopKnowledgeDuelHeartbeat();
    knowledgeDuelHeartbeatInterval = setInterval(() => {
        if (!knowledgeDuelState) return;
        knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({
            [`${knowledgeDuelState.role}.lastSeen`]: Date.now()
        }).catch(() => {});
    }, KNOWLEDGE_DUEL_HEARTBEAT_INTERVAL_MS);
}

function stopKnowledgeDuelHeartbeat() {
    if (knowledgeDuelHeartbeatInterval) {
        clearInterval(knowledgeDuelHeartbeatInterval);
        knowledgeDuelHeartbeatInterval = null;
    }
}

function checkKnowledgeDuelOpponentHeartbeat(opponent, status) {
    const banner = document.getElementById('knowledgeDuelDisconnectBanner');
    if (!banner) return;
    if (!opponent || status === 'finished' || status === 'waiting') {
        banner.style.display = 'none';
        return;
    }
    const stale = opponent.lastSeen && (Date.now() - opponent.lastSeen > KNOWLEDGE_DUEL_HEARTBEAT_TIMEOUT_MS);
    banner.style.display = stale ? 'flex' : 'none';
}

document.getElementById('knowledgeDuelLeaveDisconnectedButton').addEventListener('click', async () => {
    await abandonKnowledgeDuel();
    goToKnowledgeDashboard('duel');
});

async function abandonKnowledgeDuel() {
    if (!knowledgeDuelState) return;
    try {
        await knowledgeDuelDocRef(knowledgeDuelState.roomCode).update({ status: 'abandoned' });
    } catch (e) { /* room mungkin sudah tidak ada / sudah selesai duluan, aman diabaikan */ }
    cleanupKnowledgeDuel();
}

function cleanupKnowledgeDuel() {
    if (knowledgeDuelState && typeof knowledgeDuelState.unsubscribe === 'function') {
        knowledgeDuelState.unsubscribe();
    }
    stopKnowledgeDuelHeartbeat();
    const oppBar = document.getElementById('knowledgeDuelOpponentBar');
    const banner = document.getElementById('knowledgeDuelDisconnectBanner');
    if (oppBar) oppBar.style.display = 'none';
    if (banner) banner.style.display = 'none';
    knowledgeDuelState = null;
}
