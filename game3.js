/* =====================================================================================
   GAME PERKALIAN 1-10 LANJUTAN
   (sengaja ditulis paralel/terpisah dari game Perkalian, bukan berbagi satu "engine" --
   supaya aman: perubahan di sini tidak berisiko merusak game Perkalian yang sudah jalan)
===================================================================================== */

/* ---- Konstanta & state ---- */
const ADVMATH_COUNT_OPTIONS = [10, 20, 30];
const MAX_ADVMATH_LEADERBOARD = 7;        // papan peringkat per jumlah soal (sama seperti game Perkalian 1-10)
const MAX_ADVMATH_DUEL_LEADERBOARD = 10;  // papan kemenangan duel (tidak berubah)
const ADVMATH_DUEL_START_BUFFER_MS = 6000;
const ADVMATH_DUEL_HEARTBEAT_INTERVAL_MS = 5000;
const ADVMATH_DUEL_HEARTBEAT_TIMEOUT_MS = 13000;

// Hukuman jawaban salah: kumulatif & terpisah (salah ke-1, ke-2, ke-3 pada SATU soal), dalam detik
const ADVMATH_WRONG_PENALTIES = [60, 180, 300];
const ADVMATH_MAX_WRONG = ADVMATH_WRONG_PENALTIES.length; // salah ke-3 => soal hangus
// Hint: hukuman (detik, dikenakan sekali per tingkat per soal) & durasi akses clue (detik)
const ADVMATH_HINT_CONFIG = {
    1: { penalty: 100, durationSec: 30 },
    2: { penalty: 200, durationSec: 30 },
    3: { penalty: 300, durationSec: 45 }   // Hint 3 = pembahasan penuh => soal langsung hangus
};
const ADVMATH_HINT_LEVELS = [1, 2, 3];
const ADVMATH_CORRECT_ADVANCE_DELAY_MS = 450;

let advmathUsedQuestionIds = [];
let advmathSequence = [];
let advmathCount = 20;                 // jumlah soal pada sesi yang sedang berjalan
let advmathSeqIndex = 0;
let advmathCorrectCount = 0;
let advmathBurnedCount = 0;
let advmathMistakeCount = 0;           // total klik jawaban salah
let advmathHintsUsed = 0;              // total tingkat hint yang dibuka (tiap tingkat dihitung sekali per soal)
let advmathPenaltySeconds = 0;         // total hukuman waktu yang SUDAH diterapkan (satu-satunya sumber hukuman)
let advmathStartTime = 0;              // ms, diambil saat countdown selesai
let advmathFinalLocked = false;
let advmathFinalSeconds = 0;           // total waktu akhir resmi (aktual + hukuman) -> dasar peringkat & simpan
let advmathActualSeconds = 0;          // bagian waktu aktual dari total akhir (untuk rincian di layar hasil)
let advmathGameInProgress = false;
let advmathUiInterval = null;
let advmathLastShownSeconds = -1;
let advmathLastSavedRecord = null;
let advmathActiveLeaderboardTab = '10'; // '10' | '20' | '30' | 'duel'
let advmathLeaderboardRequestToken = 0;
let advmathSelectedAvatar = null;
let advmathDuelCreateSelectedAvatar = null;
let advmathDuelJoinSelectedAvatar = null;
let advmathDuelState = null;
let advmathDuelHeartbeatInterval = null;

// Status SATU soal yang sedang aktif. Dibuat ulang total setiap pindah soal (lihat resetAdvmathQuestionState).
let advmathQ = null;
let advmathQuestionToken = 0; // naik tiap pindah soal; callback tertunda yang membawa token lama otomatis diabaikan

// Satu nama = satu baris di papan peringkat duel (dipakai sebagai ID dokumen Firestore)
function nameToDocId(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'anon';
}

/* ---- Format waktu: mm:ss, dan h:mm:ss kalau lebih dari 1 jam (hukuman bisa membuat total waktu panjang) ---- */
function formatAdvmathDuration(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* ---- Bank soal: toleran terhadap beberapa penamaan field supaya file 2.000 soal Anda tetap terbaca ----
   Bentuk utama (disarankan):
     { id, category, question, options: [4 teks], correctIndex, clue1, clue2, clue3 }
   Bentuk lain yang juga dikenali:
     - pertanyaan / soal            -> question
     - kategori                     -> category
     - pilihan / opsi               -> options
     - answer|jawaban + distractors|pengecoh (3 teks) -> options diacak otomatis
     - clue_1 / hint1 / petunjuk1 / clues:[..] / hints:[..] / petunjuk:[..]  -> clue1..clue3
*/
function advmathPick(raw, keys) {
    for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k];
    }
    return undefined;
}

function normalizeAdvmathQuestion(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const question = advmathPick(raw, ['question', 'pertanyaan', 'soal', 'q']);
    if (question === undefined) return null;

    let options = advmathPick(raw, ['options', 'pilihan', 'opsi', 'choices']);
    let correctIndex = advmathPick(raw, ['correctIndex', 'answerIndex', 'indexJawaban', 'kunci']);

    if (!Array.isArray(options) || options.length < 2) {
        const answer = advmathPick(raw, ['answer', 'jawaban', 'jawabanBenar', 'correct', 'correctAnswer']);
        const distractors = advmathPick(raw, ['distractors', 'pengecoh', 'jawabanPengecoh', 'wrongAnswers']);
        if (answer === undefined || !Array.isArray(distractors)) return null;
        options = [answer, ...distractors];
        // acak urutan supaya jawaban benar tidak selalu di posisi pertama
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        correctIndex = options.findIndex(o => String(o) === String(answer));
    }
    options = options.map(o => String(o));
    correctIndex = Number(correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;

    const clueArray = advmathPick(raw, ['clues', 'hints', 'petunjuk']);
    const clues = [1, 2, 3].map(n => {
        const direct = advmathPick(raw, [`clue${n}`, `clue_${n}`, `Clue${n}`, `Clue_${n}`, `clue ${n}`, `hint${n}`, `hint_${n}`, `petunjuk${n}`, `petunjuk_${n}`]);
        if (direct !== undefined) return String(direct);
        if (Array.isArray(clueArray) && clueArray[n - 1] !== undefined) return String(clueArray[n - 1]);
        return 'Clue untuk tingkat ini belum tersedia pada soal ini.';
    });

    const id = raw.id !== undefined ? raw.id : index + 1;
    const category = Number(advmathPick(raw, ['category', 'kategori'])) || 1;
    return { id, category, question: String(question), options, correctIndex, clues };
}

const ADVMATH_BANK = (typeof ADVMATH_QUESTIONS !== 'undefined' && Array.isArray(ADVMATH_QUESTIONS))
    ? ADVMATH_QUESTIONS.map((raw, i) => normalizeAdvmathQuestion(raw, i)).filter(Boolean)
    : [];
if (typeof ADVMATH_QUESTIONS !== 'undefined' && ADVMATH_BANK.length !== ADVMATH_QUESTIONS.length) {
    console.warn(`[Perkalian 1-10 Lanjutan] ${ADVMATH_QUESTIONS.length - ADVMATH_BANK.length} soal dilewati karena formatnya tidak dikenali.`);
}

/* ---- Soal: rotasi kategori 1,2,3,...,N,1,2,3,...  (N ikut jumlah kategori yang ADA di data) ---- */
function getAdvmathCategories() {
    const set = new Set(ADVMATH_BANK.map(q => q.category));
    return Array.from(set).sort((a, b) => a - b);
}

function generateAdvmathSequence(count) {
    const categories = getAdvmathCategories();
    if (categories.length === 0) return [];
    const byCategory = {};
    categories.forEach(c => { byCategory[c] = ADVMATH_BANK.filter(q => q.category === c); });

    // Reset riwayat soal yang sudah pernah keluar kalau sisa pool sudah hampir habis,
    // supaya tidak pernah terjebak (sama seperti pola di game Perkalian)
    if (advmathUsedQuestionIds.length >= ADVMATH_BANK.length - count) {
        advmathUsedQuestionIds = [];
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
            !advmathUsedQuestionIds.includes(q.id) && !sequence.some(s => s.id === q.id)
        );
        if (pool.length === 0) continue; // kategori ini lagi kering sementara, lanjut putaran berikutnya
        const pick = pool[Math.floor(Math.random() * pool.length)];
        sequence.push(pick);
        advmathUsedQuestionIds.push(pick.id);
    }
    return sequence;
}

/* ---- Papan peringkat solo per jumlah soal: urut TOTAL WAKTU terkecil ---- */
function advmathRecordsKey(count) {
    return `advmath_records_${count}`;
}

// Seri waktu: lebih sedikit soal hangus, lalu lebih sedikit hint, lalu lebih sedikit salah
function sortAdvmathRecords(records) {
    return [...records].sort((a, b) => {
        if (a.time !== b.time) return a.time - b.time;
        if ((a.burned || 0) !== (b.burned || 0)) return (a.burned || 0) - (b.burned || 0);
        if ((a.hints || 0) !== (b.hints || 0)) return (a.hints || 0) - (b.hints || 0);
        return (a.mistakes || 0) - (b.mistakes || 0);
    });
}

function getAdvmathRecordsFromLocalStorage(count) {
    try {
        const list = JSON.parse(safeGetLocalStorage(advmathRecordsKey(count), '[]'));
        return sortAdvmathRecords(list.filter(r => typeof r.time === 'number')).slice(0, MAX_ADVMATH_LEADERBOARD);
    } catch (e) {
        return [];
    }
}

async function getAdvmathRecordsForCount(count) {
    if (firebaseReady) {
        try {
            const snapshot = await firestoreDb.collection(advmathRecordsKey(count))
                .orderBy('time', 'asc')
                .limit(MAX_ADVMATH_LEADERBOARD)
                .get();
            return sortAdvmathRecords(snapshot.docs.map(doc => doc.data())).slice(0, MAX_ADVMATH_LEADERBOARD);
        } catch (e) {
            console.warn('[Perkalian 1-10 Lanjutan] Gagal memuat dari Firebase, memakai localStorage.', e);
        }
    }
    return getAdvmathRecordsFromLocalStorage(count);
}

async function saveAdvmathRecord(count, record) {
    if (firebaseReady) {
        try {
            await firestoreDb.collection(advmathRecordsKey(count)).add(record);
            return { online: true, error: null };
        } catch (e) {
            console.warn('[Perkalian 1-10 Lanjutan] Gagal menyimpan ke Firebase, menyimpan ke localStorage saja.', e);
        }
    }
    let records = getAdvmathRecordsFromLocalStorage(count);
    records.push(record);
    records = sortAdvmathRecords(records).slice(0, MAX_ADVMATH_LEADERBOARD);
    safeSetLocalStorage(advmathRecordsKey(count), JSON.stringify(records));
    return { online: false, error: null };
}

/* ---- Papan peringkat duel (kemenangan) -- logika tidak berubah ---- */
function getAdvmathDuelWinsFromLocalStorage() {
    try {
        return JSON.parse(safeGetLocalStorage('advmath_duel_wins', '[]'));
    } catch (e) {
        return [];
    }
}

async function getAdvmathDuelWinsLeaderboard() {
    if (firebaseReady) {
        try {
            const snapshot = await firestoreDb.collection('advmath_duel_wins')
                .orderBy('wins', 'desc')
                .limit(MAX_ADVMATH_DUEL_LEADERBOARD)
                .get();
            return snapshot.docs.map(doc => doc.data());
        } catch (e) {
            console.warn('[Perkalian 1-10 Lanjutan] Gagal memuat papan duel dari Firebase.', e);
        }
    }
    return [...getAdvmathDuelWinsFromLocalStorage()].sort((a, b) => b.wins - a.wins).slice(0, MAX_ADVMATH_DUEL_LEADERBOARD);
}

// Nama yang dipakai konsisten akan terus bertambah jumlah kemenangannya (satu nama = satu baris)
async function recordAdvmathDuelWin(name, avatar) {
    const docId = nameToDocId(name);
    if (firebaseReady) {
        try {
            await firestoreDb.collection('advmath_duel_wins').doc(docId).set({
                name: name,
                avatar: avatar,
                wins: firebase.firestore.FieldValue.increment(1),
                updatedAt: Date.now()
            }, { merge: true });
            return;
        } catch (e) {
            console.warn('[Perkalian 1-10 Lanjutan] Gagal mencatat kemenangan ke Firebase.', e);
        }
    }
    let records = getAdvmathDuelWinsFromLocalStorage();
    let rec = records.find(r => r.docId === docId);
    if (rec) {
        rec.wins = (rec.wins || 0) + 1;
        rec.avatar = avatar;
        rec.name = name;
    } else {
        records.push({ docId, name, avatar, wins: 1 });
    }
    safeSetLocalStorage('advmath_duel_wins', JSON.stringify(records));
}

/* ---- Dashboard: tab & papan peringkat ---- */
function setAdvmathLeaderboardTab(tabName) {
    advmathActiveLeaderboardTab = String(tabName);
    document.querySelectorAll('#advmathDashboardView .leaderboard-tab[data-alboard]').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.alboard === advmathActiveLeaderboardTab);
    });
    renderAdvmathLeaderboardPanel(advmathActiveLeaderboardTab);
}

document.querySelectorAll('#advmathDashboardView .leaderboard-tab[data-alboard]').forEach(tab => {
    tab.addEventListener('click', () => setAdvmathLeaderboardTab(tab.dataset.alboard));
});

function showAdvmathLeaderboardLoading() {
    document.getElementById('advmathPodium').innerHTML = '<div class="leaderboard-loading">Memuat papan peringkat...</div>';
    document.getElementById('advmathRankList').innerHTML = '';
}

async function renderAdvmathLeaderboardPanel(tabName) {
    const myToken = ++advmathLeaderboardRequestToken;
    showAdvmathLeaderboardLoading();
    if (tabName === 'duel') {
        const records = await getAdvmathDuelWinsLeaderboard();
        if (myToken !== advmathLeaderboardRequestToken) return; // tab sudah berpindah, abaikan hasil basi
        renderAdvmathDuelWinsPodium(records);
        renderAdvmathDuelWinsList(records);
    } else {
        const records = await getAdvmathRecordsForCount(parseInt(tabName, 10));
        if (myToken !== advmathLeaderboardRequestToken) return;
        renderAdvmathSoloPodium(records);
        renderAdvmathSoloList(records);
    }
}

function isAdvmathLastSavedSolo(record) {
    return !!advmathLastSavedRecord
        && String(advmathLastSavedRecord.count) === advmathActiveLeaderboardTab
        && advmathLastSavedRecord.name === record.name
        && advmathLastSavedRecord.time === record.time
        && advmathLastSavedRecord.mistakes === record.mistakes
        && advmathLastSavedRecord.hints === record.hints
        && advmathLastSavedRecord.burned === record.burned;
}

function advmathMetaText(record) {
    return `✖${record.mistakes || 0} · 💡${record.hints || 0} · 💀${record.burned || 0}`;
}

function renderAdvmathSoloPodium(records) {
    const podiumEl = document.getElementById('advmathPodium');
    const displayOrder = [1, 0, 2];

    podiumEl.innerHTML = displayOrder.map(rankIndex => {
        const place = rankIndex + 1;
        const spotClass = place === 1 ? 'podium-first' : place === 2 ? 'podium-second' : 'podium-third';
        const record = records[rankIndex];
        const medal = `<div class="podium-medal" aria-hidden="true">${place === 1 ? '👑' : place === 2 ? '🥈' : '🥉'}</div>`;

        if (!record) {
            return `
                <div class="podium-spot ${spotClass} is-empty">
                    ${medal}
                    <div class="podium-avatar-wrap"><div class="podium-avatar">👤</div></div>
                    <div class="podium-name">—</div>
                    <div class="podium-score">--:--</div>
                    <div class="podium-mistakes">&nbsp;</div>
                    <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
                </div>
            `;
        }

        const isYou = isAdvmathLastSavedSolo(record);
        return `
            <div class="podium-spot ${spotClass}${isYou ? ' is-you' : ''}" role="group"
                 aria-label="Peringkat ${place}: ${escapeHtml(record.name)}, total waktu ${formatAdvmathDuration(record.time)}, ${record.mistakes || 0} salah, ${record.hints || 0} hint, ${record.burned || 0} soal hangus">
                ${medal}
                <div class="podium-avatar-wrap"><div class="podium-avatar">${avatarGlyph(record.avatar)}</div></div>
                <div class="podium-name" title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</div>
                <div class="podium-score">${formatAdvmathDuration(record.time)}</div>
                <div class="podium-mistakes">${advmathMetaText(record)}</div>
                ${isYou ? '<div class="you-chip">⭐ Kamu</div>' : ''}
                <div class="podium-base" aria-hidden="true"><span>${place}</span></div>
            </div>
        `;
    }).join('');
}

function renderAdvmathSoloList(records) {
    const listEl = document.getElementById('advmathRankList');
    if (records.length === 0) {
        listEl.innerHTML = `<li class="rank-list-empty">Belum ada pemain di sini.<br>Jadilah yang pertama mencatat waktu! 🏁</li>`;
        return;
    }
    const rest = records.slice(3, MAX_ADVMATH_LEADERBOARD);
    if (rest.length === 0) {
        listEl.innerHTML = '';
        return;
    }
    listEl.innerHTML = rest.map((record, i) => {
        const rank = i + 4;
        const isYou = isAdvmathLastSavedSolo(record);
        return `
            <li class="rank-list-row${isYou ? ' is-you' : ''}">
                <span class="rank-list-position">${rank}</span>
                <span class="rank-list-avatar">${avatarGlyph(record.avatar)}</span>
                <span class="rank-list-name">${escapeHtml(record.name)}${isYou ? ' <span class="you-chip">⭐ Kamu</span>' : ''}</span>
                <span class="rank-list-dots" aria-hidden="true"></span>
                <span class="rank-list-score">${formatAdvmathDuration(record.time)}<small>${advmathMetaText(record)}</small></span>
            </li>
        `;
    }).join('');
}

function renderAdvmathDuelWinsPodium(records) {
    const podiumEl = document.getElementById('advmathPodium');
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

function renderAdvmathDuelWinsList(records) {
    const listEl = document.getElementById('advmathRankList');
    if (records.length === 0) {
        listEl.innerHTML = `<li class="rank-list-empty">Belum ada duel yang dimenangkan di sini.<br>Jadilah yang pertama! 🏁</li>`;
        return;
    }
    const rest = records.slice(3, MAX_ADVMATH_DUEL_LEADERBOARD);
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

function goToAdvmathDashboard(focusTab) {
    countdownRunToken++;
    document.getElementById('countdownOverlay').classList.remove('is-visible');
    stopAdvmathRoundTimer();
    setAdvmathLeaderboardTab(focusTab || advmathActiveLeaderboardTab);
    switchView('advmathDashboard');
}

/* ---- Avatar picker (simpan skor solo & form duel) ---- */
buildAvatarPicker('advmathAvatarPicker', (avatar) => { advmathSelectedAvatar = avatar; });
buildAvatarPicker('advmathDuelCreateAvatarPicker', (avatar) => { advmathDuelCreateSelectedAvatar = avatar; });
buildAvatarPicker('advmathDuelJoinAvatarPicker', (avatar) => { advmathDuelJoinSelectedAvatar = avatar; });

/* ---- Bantuan & konfirmasi keluar ---- */
document.getElementById('advmathHelpButton').addEventListener('click', () => {
    showModal('advmathHelpModal');
});

document.getElementById('advmathBackToDashboardButton').addEventListener('click', () => {
    if (advmathGameInProgress || advmathDuelState) {
        showModal('advmathConfirmExitModal');
    } else {
        goToAdvmathDashboard();
    }
});

document.getElementById('advmathConfirmExitYesButton').addEventListener('click', async () => {
    hideModal('advmathConfirmExitModal');
    stopAdvmathRoundTimer();
    advmathGameInProgress = false;
    if (advmathDuelState) {
        await abandonAdvmathDuel();
    }
    goToAdvmathDashboard();
});

/* =====================================================================================
   ALUR GAME (berbasis waktu: total waktu = waktu aktual + semua hukuman)
===================================================================================== */
// Pilih jumlah soal: logika sama seperti game Perkalian 1-10 (modal berisi 10/20/30 soal)
document.getElementById('advmathOpenSoloButton').addEventListener('click', () => {
    showModal('advmathChooseCountModal');
});

document.querySelectorAll('#advmathChooseCountModal .count-option-button').forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count, 10);
        hideModal('advmathChooseCountModal');
        startAdvmathSoloGame(count);
    });
});

function advmathHintButtons() {
    return Array.from(document.querySelectorAll('#advmathHintRow .advmath-hint-btn'));
}

function advmathOptionButtons() {
    return Array.from(document.querySelectorAll('.advmath-option-btn'));
}

function prepareAdvmathGameUI() {
    // Tampilkan overlay countdown SINKRON bareng switchView, supaya tidak ada celah
    // "layar game polos" sempat kelihatan sebelum overlay menutupinya.
    const overlay = document.getElementById('countdownOverlay');
    document.getElementById('countdownNumber').textContent = COUNTDOWN_STEPS[0].text;
    document.getElementById('countdownLabel').textContent = COUNTDOWN_STEPS[0].label;
    overlay.classList.add('is-visible');

    stopAdvmathRoundTimer();
    advmathQuestionToken++;
    advmathQ = null;
    advmathGameInProgress = true;
    advmathLastSavedRecord = null;
    advmathCorrectCount = 0;
    advmathBurnedCount = 0;
    advmathMistakeCount = 0;
    advmathHintsUsed = 0;
    advmathPenaltySeconds = 0;
    advmathFinalLocked = false;
    advmathFinalSeconds = 0;
    advmathActualSeconds = 0;
    advmathSeqIndex = 0;
    advmathLastShownSeconds = -1;

    document.getElementById('advmathTimer').textContent = '00:00';
    document.getElementById('advmathProgressBarFill').style.width = '0%';
    document.getElementById('advmathProgressLabel').textContent = `Soal 1 dari ${advmathCount}`;
    document.getElementById('advmathQuestionText').textContent = '';
    document.getElementById('advmathBurnBanner').style.display = 'none';
    advmathOptionButtons().forEach(btn => {
        btn.disabled = true;
        btn.textContent = '';
        btn.className = 'advmath-option-btn';
    });
    advmathHintButtons().forEach(btn => {
        btn.disabled = true;
        btn.className = 'advmath-hint-btn';
        btn.style.removeProperty('--p');
        btn.querySelector('.advmath-hint-status').textContent = '';
    });
    hideModal('advmathHintModal');

    switchView('advmathGame');
}

function startAdvmathSoloGame(count) {
    advmathDuelState = null;
    advmathCount = count;
    advmathSequence = generateAdvmathSequence(count);
    if (advmathSequence.length === 0) {
        showToast('danger', 'Bank soal belum tersedia. Cek file advmath-questions.js.', 5000);
        return;
    }
    advmathCount = advmathSequence.length; // jaga-jaga kalau bank soal lebih sedikit dari jumlah yang dipilih
    prepareAdvmathGameUI();
    document.getElementById('advmathDuelOpponentBar').style.display = 'none';
    document.getElementById('advmathDuelDisconnectBanner').style.display = 'none';
    runCountdown(() => {
        beginAdvmathRound();
    });
}

// Dipanggil SETELAH countdown selesai: baru di sini timer permainan mulai berjalan
function beginAdvmathRound() {
    advmathStartTime = Date.now();
    displayAdvmathQuestion();
    startAdvmathRoundTimer();
}

/* ---- Timer permainan ---- */
function advmathCurrentTotalSeconds(now) {
    const actual = Math.floor(((now || Date.now()) - advmathStartTime) / 1000);
    return Math.max(0, actual) + advmathPenaltySeconds;
}

function renderAdvmathTimer(force) {
    const total = advmathFinalLocked ? advmathFinalSeconds : advmathCurrentTotalSeconds();
    if (!force && total === advmathLastShownSeconds) return;
    advmathLastShownSeconds = total;
    const text = formatAdvmathDuration(total);
    const timerEl = document.getElementById('advmathTimer');
    timerEl.textContent = text;
    const modalTimer = document.getElementById('advmathHintTimer');
    if (modalTimer) modalTimer.textContent = text;
}

function startAdvmathRoundTimer() {
    clearInterval(advmathUiInterval);
    advmathUiInterval = setInterval(advmathUiTick, 100);
    renderAdvmathTimer(true);
}

// Menghentikan SEMUA timer/callback milik sesi (interval tampilan + callback perpindahan soal tertunda)
function stopAdvmathRoundTimer() {
    clearInterval(advmathUiInterval);
    advmathUiInterval = null;
    advmathQuestionToken++;
    if (advmathQ && advmathQ.autoAdvanceTimeout) {
        clearTimeout(advmathQ.autoAdvanceTimeout);
        advmathQ.autoAdvanceTimeout = null;
    }
}

function advmathUiTick() {
    if (!advmathGameInProgress && !advmathFinalLocked) return;
    renderAdvmathTimer(false);
    updateAdvmathHintUI();
}

// Mengunci total waktu akhir tepat saat soal TERAKHIR selesai. Hanya boleh terjadi sekali per sesi
// (jadi hukuman tidak pernah terhitung ulang saat hasil ditampilkan atau disimpan).
function lockAdvmathFinalTime() {
    if (advmathFinalLocked) return;
    const now = Date.now();
    advmathActualSeconds = Math.max(0, Math.floor((now - advmathStartTime) / 1000));
    advmathFinalSeconds = advmathActualSeconds + advmathPenaltySeconds;
    advmathFinalLocked = true;
    renderAdvmathTimer(true);
}

function applyAdvmathPenalty(seconds) {
    advmathPenaltySeconds += seconds;
    renderAdvmathTimer(true); // timer langsung menunjukkan perubahan

    const timerEl = document.getElementById('advmathTimer');
    timerEl.classList.remove('is-penalty');
    void timerEl.offsetWidth;
    timerEl.classList.add('is-penalty');

    const chip = document.getElementById('advmathPenaltyChip');
    chip.textContent = `+${seconds} detik`;
    chip.classList.remove('is-visible');
    void chip.offsetWidth;
    chip.classList.add('is-visible');
}

/* ---- Status & tampilan satu soal ---- */
function newAdvmathQuestionState() {
    const hints = {};
    ADVMATH_HINT_LEVELS.forEach(l => { hints[l] = { openedAt: null, deadline: null }; });
    return { wrong: 0, burned: false, resolved: false, hints, lastOpenedLevel: null, shownLevel: null, burnDeadline: null, autoAdvanceTimeout: null };
}

function resetAdvmathQuestionState() {
    advmathQuestionToken++; // callback otomatis soal sebelumnya jadi basi
    if (advmathQ && advmathQ.autoAdvanceTimeout) clearTimeout(advmathQ.autoAdvanceTimeout);
    advmathQ = newAdvmathQuestionState();
}

function displayAdvmathQuestion() {
    const q = advmathSequence[advmathSeqIndex];
    resetAdvmathQuestionState();
    closeAdvmathHintModalSilently();

    document.getElementById('advmathQuestionText').textContent = q.question;
    advmathOptionButtons().forEach((btn, i) => {
        btn.textContent = q.options[i] !== undefined ? q.options[i] : '';
        btn.style.display = q.options[i] !== undefined ? 'flex' : 'none';
        btn.disabled = false;
        btn.className = 'advmath-option-btn';
    });
    document.getElementById('advmathBurnBanner').style.display = 'none';
    document.getElementById('advmathProgressLabel').textContent = `Soal ${advmathSeqIndex + 1} dari ${advmathCount}`;
    document.getElementById('advmathProgressBarFill').style.width = `${(advmathSeqIndex / advmathCount) * 100}%`;
    updateAdvmathHintUI();
}

document.querySelectorAll('.advmath-option-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => handleAdvmathOptionClick(idx));
});

function handleAdvmathOptionClick(idx) {
    if (!advmathGameInProgress || !advmathQ || advmathQ.burned || advmathQ.resolved) return;
    const btns = advmathOptionButtons();
    const btn = btns[idx];
    if (!btn || btn.disabled) return;
    const q = advmathSequence[advmathSeqIndex];

    if (idx === q.correctIndex) {
        advmathQ.resolved = true;
        btn.classList.add('is-correct');
        btns.forEach(b => { b.disabled = true; });
        playCorrectSound();
        advmathCorrectCount++;
        const isLast = advmathSeqIndex >= advmathCount - 1;
        if (isLast) lockAdvmathFinalTime(); // waktu berhenti tepat saat soal terakhir dijawab benar
        updateAdvmathHintUI();
        if (advmathDuelState) reportAdvmathDuelProgress(advmathSeqIndex + 1);
        closeAdvmathHintModalSilently();
        const token = advmathQuestionToken;
        setTimeout(() => proceedAfterAdvmathQuestion(token), ADVMATH_CORRECT_ADVANCE_DELAY_MS);
        return;
    }

    // Jawaban salah: hukuman langsung diterapkan, terpisah & kumulatif (60 -> 180 -> 300)
    btn.disabled = true;
    btn.classList.add('is-wrong');
    playWrongSound();
    advmathQ.wrong++;
    advmathMistakeCount++;
    const penalty = ADVMATH_WRONG_PENALTIES[advmathQ.wrong - 1];
    applyAdvmathPenalty(penalty);

    if (advmathQ.wrong >= ADVMATH_MAX_WRONG) {
        burnAdvmathQuestion();
    }
}

/* ---- Soal hangus: tidak ada hukuman tambahan di sini (hukuman sudah diberikan oleh tindakan pemicunya) ---- */
function pickAdvmathReferenceDeadline() {
    const now = Date.now();
    const q = advmathQ;
    // 1) hint yang sedang ditampilkan di pop-up
    if (q.shownLevel && q.hints[q.shownLevel].deadline && q.hints[q.shownLevel].deadline > now) {
        return q.hints[q.shownLevel].deadline;
    }
    // 2) kalau tidak ada yang ditampilkan: countdown aktif yang paling akhir dibuka
    let best = null;
    ADVMATH_HINT_LEVELS.forEach(l => {
        const h = q.hints[l];
        if (h.deadline && h.deadline > now && (!best || h.openedAt > best.openedAt)) best = h;
    });
    return best ? best.deadline : null;
}

function burnAdvmathQuestion() {
    const q = advmathQ;
    if (!q || q.burned || q.resolved) return;
    q.burned = true;
    advmathBurnedCount++;

    const current = advmathSequence[advmathSeqIndex];
    advmathOptionButtons().forEach((b, i) => {
        b.disabled = true;
        if (i === current.correctIndex) b.classList.add('is-reveal'); // bantuan pemulihan: tunjukkan jawaban yang benar
    });
    if (advmathDuelState) reportAdvmathDuelProgress(advmathSeqIndex + 1);

    const token = advmathQuestionToken;
    const deadline = pickAdvmathReferenceDeadline();

    if (!deadline) {
        // Tidak ada countdown hint aktif -> langsung pindah, tanpa waktu tunggu tambahan
        updateAdvmathHintUI();
        proceedAfterAdvmathQuestion(token);
        return;
    }

    // Ada countdown hint aktif -> tetap di soal sampai sisa countdown habis atau pemain menekan "Lanjut"
    q.burnDeadline = deadline;
    document.getElementById('advmathBurnBanner').style.display = 'flex';
    const waitMs = Math.max(0, deadline - Date.now());
    q.autoAdvanceTimeout = setTimeout(() => proceedAfterAdvmathQuestion(token), waitMs);
    updateAdvmathHintUI();
}

document.getElementById('advmathNextButton').addEventListener('click', () => {
    if (!advmathQ || !advmathQ.burned) return;
    proceedAfterAdvmathQuestion(advmathQuestionToken);
});

document.getElementById('advmathHintNextButton').addEventListener('click', () => {
    if (!advmathQ || !advmathQ.burned) return;
    proceedAfterAdvmathQuestion(advmathQuestionToken);
});

// SATU-SATUNYA pintu perpindahan soal. Token memastikan tiap soal hanya berpindah sekali, walau tombol "Lanjut",
// timeout otomatis, dan beberapa countdown berakhir hampir bersamaan.
function proceedAfterAdvmathQuestion(token) {
    if (token !== advmathQuestionToken) return;
    if (!advmathGameInProgress && !advmathFinalLocked) return;
    advmathQuestionToken++;
    if (advmathQ && advmathQ.autoAdvanceTimeout) {
        clearTimeout(advmathQ.autoAdvanceTimeout);
        advmathQ.autoAdvanceTimeout = null;
    }
    closeAdvmathHintModalSilently();

    if (advmathSeqIndex >= advmathCount - 1) {
        finishAdvmathGame();
        return;
    }
    advmathSeqIndex++;
    displayAdvmathQuestion();
    if (advmathDuelState) reportAdvmathDuelProgress(advmathSeqIndex);
}

/* ---- Hint 1/2/3 ---- */
function updateAdvmathHintUI() {
    const q = advmathQ;
    const now = Date.now();
    advmathHintButtons().forEach(btn => {
        const level = parseInt(btn.dataset.level, 10);
        const cfg = ADVMATH_HINT_CONFIG[level];
        const statusEl = btn.querySelector('.advmath-hint-status');
        btn.classList.remove('is-active', 'is-expired', 'is-locked');
        if (!q || !advmathGameInProgress) {
            btn.disabled = true;
            return;
        }
        const h = q.hints[level];
        if (h.deadline) {
            const remainingMs = h.deadline - now;
            if (remainingMs > 0) {
                btn.classList.add('is-active');
                btn.disabled = false;
                btn.style.setProperty('--p', Math.max(0, Math.min(1, remainingMs / (cfg.durationSec * 1000))).toFixed(4));
                statusEl.textContent = `${Math.ceil(remainingMs / 1000)} dtk`;
                btn.setAttribute('aria-label', `Hint ${level}, sisa akses ${Math.ceil(remainingMs / 1000)} detik`);
            } else {
                btn.classList.add('is-expired');
                btn.disabled = true;
                btn.style.setProperty('--p', 0);
                statusEl.textContent = 'Hangus 🔥';
                btn.setAttribute('aria-label', `Hint ${level} sudah kedaluwarsa`);
            }
        } else if (q.burned || q.resolved) {
            btn.classList.add('is-locked');
            btn.disabled = true;
            btn.style.setProperty('--p', 1);
            statusEl.textContent = '';
            btn.setAttribute('aria-label', `Hint ${level} tidak tersedia`);
        } else {
            btn.disabled = false;
            btn.style.setProperty('--p', 1);
            statusEl.textContent = '';
            btn.setAttribute('aria-label', `Hint ${level}, hukuman tambahan ${cfg.penalty} detik`);
        }
    });

    // Banner "soal hangus": hitung mundur sisa waktu tunggu
    const banner = document.getElementById('advmathBurnBanner');
    if (q && q.burned && q.burnDeadline) {
        const remaining = Math.max(0, Math.ceil((q.burnDeadline - now) / 1000));
        document.getElementById('advmathBurnCountdown').textContent = String(remaining);
        banner.style.display = 'flex';
    }

    updateAdvmathHintModalUI();
}

advmathHintButtons().forEach(btn => {
    btn.addEventListener('click', () => openAdvmathHint(parseInt(btn.dataset.level, 10)));
});

async function openAdvmathHint(level) {
    if (!advmathGameInProgress || !advmathQ || advmathQ.resolved) return;
    const q = advmathQ;
    const h = q.hints[level];
    const cfg = ADVMATH_HINT_CONFIG[level];
    const now = Date.now();

    if (h.deadline) {
        // Sudah pernah dibuka: tidak ada hukuman baru & countdown TIDAK di-reset
        if (now >= h.deadline) {
            return;
        }
        q.shownLevel = level;
        await showAdvmathHintModal(level);
        return;
    }

    if (q.burned) return; // soal sudah hangus: tidak boleh membuka hint tambahan

    // Pertama kali dibuka: hukuman langsung diterapkan SEKALI & countdown mulai
    h.openedAt = now;
    h.deadline = now + cfg.durationSec * 1000;
    q.lastOpenedLevel = level;
    q.shownLevel = level;
    advmathHintsUsed++;
    applyAdvmathPenalty(cfg.penalty);

    if (level === 3) {
        burnAdvmathQuestion(); // memakai countdown Hint 3 (sedang ditampilkan) sebagai acuan waktu tunggu
    }
    if (advmathDuelState) reportAdvmathDuelProgress(advmathSeqIndex);
    updateAdvmathHintUI();
    await showAdvmathHintModal(level);
}

async function showAdvmathHintModal(level) {
    const q = advmathQ;
    if (!q) return;
    const current = advmathSequence[advmathSeqIndex];
    const cfg = ADVMATH_HINT_CONFIG[level];
    q.shownLevel = level;

    document.getElementById('advmathHintModalLabel').textContent = `💡 Hint ${level}`;
    document.getElementById('advmathHintClue').textContent = current.clues[level - 1];
    document.getElementById('advmathHintPenaltyInfo').textContent = `Hukuman +${cfg.penalty} detik sudah diterapkan. Membuka ulang hint ini tidak menambah hukuman.`;
    document.getElementById('advmathHintModal').dataset.level = String(level);
    updateAdvmathHintModalUI();

    await waitForModalHidden('advmathHintModal');
    if (!advmathQ || advmathQ !== q) return; // sudah pindah soal selama menunggu
    q.shownLevel = level;
    showModal('advmathHintModal');
}

function updateAdvmathHintModalUI() {
    const modal = document.getElementById('advmathHintModal');
    if (!modal) return;
    const q = advmathQ;
    const level = parseInt(modal.dataset.level, 10);
    if (!q || !level || !q.hints[level]) return;
    const cfg = ADVMATH_HINT_CONFIG[level];
    const h = q.hints[level];
    const now = Date.now();
    const remainingMs = h.deadline ? h.deadline - now : 0;

    document.getElementById('advmathHintCountdownText').textContent =
        remainingMs > 0 ? `Sisa akses: ${Math.ceil(remainingMs / 1000)} detik` : 'Akses hint habis 🔥';
    document.getElementById('advmathHintCountdownFill').style.width =
        `${Math.max(0, Math.min(100, (remainingMs / (cfg.durationSec * 1000)) * 100))}%`;
    modal.classList.toggle('is-level-3', level === 3);

    const burnNote = document.getElementById('advmathHintBurnNote');
    const nextBtn = document.getElementById('advmathHintNextButton');
    burnNote.style.display = q.burned ? 'block' : 'none';
    nextBtn.style.display = q.burned ? 'inline-block' : 'none';

    // Akses habis -> tutup pop-up otomatis (tanpa hukuman tambahan)
    if (h.deadline && remainingMs <= 0 && modal.classList.contains('show') && q.shownLevel === level) {
        q.shownLevel = null;
        hideModal('advmathHintModal');
    }
}

// Pop-up ditutup (tombol X / Tutup / klik di luar): countdown tetap berjalan di latar belakang
document.getElementById('advmathHintModal').addEventListener('hidden.bs.modal', () => {
    if (advmathQ) advmathQ.shownLevel = null;
});

function closeAdvmathHintModalSilently() {
    if (advmathQ) advmathQ.shownLevel = null;
    hideModal('advmathHintModal');
    // Jaring pengaman: kalau pop-up sedang di tengah animasi buka, hide() pertama diabaikan Bootstrap.
    // Cek lagi sesaat kemudian; tutup hanya kalau pemain belum membuka hint baru di soal berikutnya.
    setTimeout(() => {
        const m = document.getElementById('advmathHintModal');
        if (m && m.classList.contains('show') && (!advmathQ || !advmathQ.shownLevel)) hideModal('advmathHintModal');
    }, 450);
}

/* ---- Selesai ---- */
function finishAdvmathGame() {
    lockAdvmathFinalTime();
    advmathGameInProgress = false;
    clearInterval(advmathUiInterval);
    advmathUiInterval = null;
    advmathOptionButtons().forEach(b => { b.disabled = true; });
    advmathHintButtons().forEach(b => { b.disabled = true; });
    document.getElementById('advmathBurnBanner').style.display = 'none';
    document.getElementById('advmathProgressBarFill').style.width = '100%';
    document.getElementById('advmathTimer').textContent = formatAdvmathDuration(advmathFinalSeconds);

    if (advmathDuelState) {
        endAdvmathDuelGame();
    } else {
        endAdvmathSoloGame();
    }
}

// Selisih detik yang dibutuhkan untuk MENGALAHKAN rekor tertentu (minimal 1 detik lebih cepat)
function advmathSecondsToBeat(timeTaken, record) {
    return Math.max(1, timeTaken - record.time + 1);
}

function buildAdvmathRankInsight(timeTaken, mistakes, burned, hints, records) {
    const sorted = sortAdvmathRecords(records);
    const beatenBy = sorted.filter(r => {
        if (r.time !== timeTaken) return r.time < timeTaken;
        if ((r.burned || 0) !== burned) return (r.burned || 0) < burned;
        if ((r.hints || 0) !== hints) return (r.hints || 0) < hints;
        return (r.mistakes || 0) <= mistakes;
    }).length;
    const rank = beatenBy + 1;
    const qualifies = rank <= MAX_ADVMATH_LEADERBOARD;
    const details = [];
    const top = sorted[0];
    const third = sorted[2];
    const lastPlace = sorted[MAX_ADVMATH_LEADERBOARD - 1];
    const medals = { 1: '👑', 2: '🥈', 3: '🥉' };

    if (sorted.length === 0) {
        return {
            rank: 1, qualifies: true, tone: 'top',
            headline: '🏆 Kamu pemain pertama di level ini!',
            details: [{ icon: '💾', text: 'Simpan waktumu untuk jadi peringkat 1 di papan peringkat.' }]
        };
    }

    if (rank === 1) {
        const gap = top.time - timeTaken;
        details.push({ icon: gap > 0 ? '⚡' : '🎯', text: gap > 0
            ? `${formatAdvmathDuration(gap)} lebih cepat dari rekor sebelumnya (${top.name}).`
            : 'Waktu sama dengan rekor sebelumnya, tapi soal hangus/hint/salahmu lebih sedikit.' });
        return { rank, qualifies, tone: 'top', headline: '👑 Rekor baru! Kamu peringkat 1', details };
    }

    const gapToTop = timeTaken - top.time;

    if (rank <= 3) {
        const above = sorted[rank - 2];
        details.push({ icon: '🐢', text: gapToTop > 0
            ? `${formatAdvmathDuration(gapToTop)} lebih lambat dari peringkat 1.`
            : 'Waktu sama dengan peringkat 1, tapi kalah di soal hangus/hint/salah.' });
        details.push({ icon: '🚀', text: `${formatAdvmathDuration(advmathSecondsToBeat(timeTaken, above))} lagi untuk naik ke peringkat ${rank - 1}.` });
        return { rank, qualifies, tone: 'top', headline: `${medals[rank]} Kamu masuk 3 besar! Peringkat ${rank}`, details };
    }

    if (qualifies) {
        details.push({ icon: '🥉', text: `${formatAdvmathDuration(advmathSecondsToBeat(timeTaken, third))} lagi untuk masuk 3 besar.` });
        details.push({ icon: '🐢', text: `${formatAdvmathDuration(gapToTop)} lebih lambat dari peringkat 1.` });
        return { rank, qualifies, tone: 'ok', headline: `🎯 Kamu masuk papan peringkat! Peringkat ${rank}`, details };
    }

    details.push({ icon: '📉', text: `${formatAdvmathDuration(timeTaken - lastPlace.time)} lebih lambat dari peringkat ${MAX_ADVMATH_LEADERBOARD}.` });
    details.push({ icon: '🎯', text: `${formatAdvmathDuration(advmathSecondsToBeat(timeTaken, lastPlace))} lagi untuk masuk papan peringkat.` });
    details.push({ icon: '💡', text: 'Tip: setiap salah, hint, dan soal hangus menambah waktu. Jawab yakin supaya waktumu singkat.' });
    return { rank, qualifies, tone: 'miss', headline: '💪 Belum masuk papan peringkat, ayo coba lagi!', details };
}

function renderAdvmathRankInsight(insight) {
    const box = document.getElementById('advmathRankInsight');
    box.className = `rank-insight is-${insight.tone}`;
    document.getElementById('advmathRankInsightHeadline').textContent = insight.headline;
    const list = document.getElementById('advmathRankInsightDetails');
    list.innerHTML = '';
    insight.details.forEach(detail => {
        const li = document.createElement('li');
        li.dataset.icon = detail.icon;
        li.textContent = detail.text;
        list.appendChild(li);
    });
    box.style.display = 'block';
}

async function endAdvmathSoloGame() {
    document.getElementById('advmathFinalTime').textContent = formatAdvmathDuration(advmathFinalSeconds);
    document.getElementById('advmathFinalActual').textContent = formatAdvmathDuration(advmathActualSeconds);
    document.getElementById('advmathFinalPenalty').textContent = `+${formatAdvmathDuration(advmathPenaltySeconds)}`;
    document.getElementById('advmathFinalMistakes').textContent = advmathMistakeCount.toString();
    document.getElementById('advmathFinalHints').textContent = advmathHintsUsed.toString();
    document.getElementById('advmathFinalBurned').textContent = advmathBurnedCount.toString();
    document.getElementById('advmathEndCountLabel').textContent = `${advmathCount} soal`;

    const records = await getAdvmathRecordsForCount(advmathCount);
    const insight = buildAdvmathRankInsight(advmathFinalSeconds, advmathMistakeCount, advmathBurnedCount, advmathHintsUsed, records);
    renderAdvmathRankInsight(insight);
    document.getElementById('advmathSaveScoreButton').style.display = insight.qualifies ? 'inline-block' : 'none';

    showModal('advmathEndModal');
    launchConfetti();
    playFinishSounds(insight.qualifies);
}

document.getElementById('advmathSaveScoreButton').addEventListener('click', async () => {
    hideModal('advmathEndModal');
    await waitForModalHidden('advmathEndModal');
    showModal('advmathSaveRecordModal');
});

document.getElementById('advmathButtonSavePlayerRecord').addEventListener('click', saveAdvmathPlayerRecord);

async function saveAdvmathPlayerRecord() {
    const nameInput = document.getElementById('advmathPlayerName');
    const playerName = nameInput.value.trim();
    if (!playerName) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    const saveBtn = document.getElementById('advmathButtonSavePlayerRecord');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';

    // Nilai yang disimpan = total waktu akhir yang SUDAH dikunci (aktual + hukuman), tanpa dihitung ulang
    const record = {
        name: playerName,
        time: advmathFinalSeconds,
        mistakes: advmathMistakeCount,
        hints: advmathHintsUsed,
        burned: advmathBurnedCount,
        avatar: advmathSelectedAvatar
    };
    const savedCount = advmathCount;

    let saveResult = null;
    try {
        saveResult = await saveAdvmathRecord(savedCount, record);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Simpan';
    }

    hideModal('advmathSaveRecordModal');
    nameInput.value = '';
    advmathLastSavedRecord = { count: savedCount, name: playerName, time: record.time, mistakes: record.mistakes, hints: record.hints, burned: record.burned };

    if (saveResult && saveResult.error) {
        showToast('danger', `Gagal simpan online: ${saveResult.error}`, 6000);
    }

    goToAdvmathDashboard(String(savedCount));
}

document.getElementById('advmathSaveRecordModal').addEventListener('shown.bs.modal', function () {
    document.getElementById('advmathPlayerName').focus();
});

document.getElementById('advmathPlayAgainButton').addEventListener('click', () => {
    hideModal('advmathEndModal');
    startAdvmathSoloGame(advmathCount);
});

document.getElementById('advmathEndBackToDashboardButton').addEventListener('click', () => {
    hideModal('advmathEndModal');
    goToAdvmathDashboard(String(advmathCount));
});

/* Tombol X / tombol Esc pada pop up hasil game = sama dengan tombol "Dashboard" */
[['endGameModal', 'endGameBackToDashboardButton'],
 ['knowledgeEndModal', 'knowledgeEndBackToDashboardButton'],
 ['advmathEndModal', 'advmathEndBackToDashboardButton']].forEach(([modalId, dashBtnId]) => {
    const modalEl = document.getElementById(modalId);
    const toDashboard = () => document.getElementById(dashBtnId).click();
    modalEl.querySelector('.end-modal-close').addEventListener('click', toDashboard);
    modalEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); toDashboard(); } });
});

/* =====================================================================================
   DUEL 1v1 PERKALIAN 1-10 LANJUTAN
===================================================================================== */
function advmathDuelDocRef(roomCode) {
    return firestoreDb.collection('advmath_duels').doc(roomCode);
}

document.getElementById('advmathOpenDuelButton').addEventListener('click', () => {
    if (!requireFirebaseForDuel()) return;
    showModal('advmathDuelModal');
});

document.getElementById('advmathDuelCreateRoomButton').addEventListener('click', async () => {
    hideModal('advmathDuelModal');
    await waitForModalHidden('advmathDuelModal');
    showModal('advmathDuelCreateModal');
});

document.getElementById('advmathDuelJoinRoomButton').addEventListener('click', async () => {
    hideModal('advmathDuelModal');
    await waitForModalHidden('advmathDuelModal');
    showModal('advmathDuelJoinModal');
});

document.getElementById('advmathDuelJoinCode').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

// Host memilih jumlah soal di modal buat-room (sama seperti duel di game Perkalian 1-10)
document.querySelectorAll('#advmathDuelCreateModal .count-option-button').forEach(btn => {
    btn.addEventListener('click', () => createAdvmathDuelRoom(parseInt(btn.dataset.count, 10)));
});

async function createAdvmathDuelRoom(count) {
    const nameInput = document.getElementById('advmathDuelCreateName');
    const name = nameInput.value.trim();
    if (!name) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    cleanupAdvmathDuel();
    hideModal('advmathDuelCreateModal');

    const sequence = generateAdvmathSequence(count);
    if (sequence.length === 0) {
        showToast('danger', 'Bank soal belum tersedia. Cek file advmath-questions.js.', 5000);
        return;
    }
    let roomCode = null;

    try {
        for (let attempt = 0; attempt < 6 && !roomCode; attempt++) {
            const candidate = generateRoomCode();
            const snap = await advmathDuelDocRef(candidate).get();
            if (!snap.exists) roomCode = candidate;
        }
        if (!roomCode) throw new Error('kode-habis');

        await advmathDuelDocRef(roomCode).set({
            count: sequence.length,
            status: 'waiting',
            createdAt: Date.now(),
            startAtMillis: null,
            winner: null,
            rematch: null,
            questions: sequence,
            host: { name: name, avatar: advmathDuelCreateSelectedAvatar, progress: 0, mistakes: 0, burned: 0, hints: 0, time: null, finishedAt: null, lastSeen: Date.now() },
            guest: null
        });
    } catch (e) {
        showToast('danger', `Gagal membuat room: ${e.code || e.message}`, 5000);
        return;
    }

    advmathDuelState = {
        roomCode, role: 'host', sequence, count: sequence.length,
        lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false
    };
    document.getElementById('advmathDuelRoomCodeDisplay').textContent = roomCode;
    await waitForModalHidden('advmathDuelCreateModal');
    showModal('advmathDuelWaitingModal');
    listenToAdvmathDuelRoom(roomCode);
    startAdvmathDuelHeartbeat();
}

document.getElementById('advmathDuelCopyCodeButton').addEventListener('click', () => {
    const code = document.getElementById('advmathDuelRoomCodeDisplay').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast('success', 'Kode disalin!')).catch(() => {});
    }
});

document.getElementById('advmathDuelCancelWaitingButton').addEventListener('click', async () => {
    hideModal('advmathDuelWaitingModal');
    await abandonAdvmathDuel();
});

document.getElementById('advmathDuelJoinSubmitButton').addEventListener('click', joinAdvmathDuelRoom);

async function joinAdvmathDuelRoom() {
    const codeInput = document.getElementById('advmathDuelJoinCode');
    const nameInput = document.getElementById('advmathDuelJoinName');
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

    const submitBtn = document.getElementById('advmathDuelJoinSubmitButton');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menghubungkan...';

    try {
        const ref = advmathDuelDocRef(code);
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

        const startAtMillis = Date.now() + ADVMATH_DUEL_START_BUFFER_MS;
        await ref.update({
            guest: { name: name, avatar: advmathDuelJoinSelectedAvatar, progress: 0, mistakes: 0, burned: 0, hints: 0, time: null, finishedAt: null, lastSeen: Date.now() },
            status: 'countdown',
            startAtMillis: startAtMillis
        });

        cleanupAdvmathDuel();
        advmathDuelState = {
            roomCode: code, role: 'guest', sequence: room.questions, count: room.count,
            lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false
        };
        codeInput.value = '';
        nameInput.value = '';
        hideModal('advmathDuelJoinModal');
        listenToAdvmathDuelRoom(code);
        startAdvmathDuelHeartbeat();
    } catch (e) {
        showToast('danger', `Gagal gabung room: ${e.code || e.message}`, 5000);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gabung';
    }
}

function listenToAdvmathDuelRoom(roomCode) {
    if (!advmathDuelState) return;
    advmathDuelState.unsubscribe = advmathDuelDocRef(roomCode).onSnapshot(
        snap => {
            if (!snap.exists) {
                if (!advmathDuelState) return;
                showToast('danger', 'Room duel sudah tidak tersedia.', 4000);
                cleanupAdvmathDuel();
                goToAdvmathDashboard('duel');
                return;
            }
            handleAdvmathDuelRoomUpdate(snap.data());
        },
        err => console.warn('[Duel Perkalian 1-10 Lanjutan] listener error', err)
    );
}

async function handleAdvmathDuelRoomUpdate(room) {
    if (!advmathDuelState) return;

    const opponentRole = advmathDuelState.role === 'host' ? 'guest' : 'host';
    const opponent = room[opponentRole];

    if (room.status === 'abandoned') {
        showToast('danger', 'Lawan meninggalkan duel.', 4000);
        cleanupAdvmathDuel();
        goToAdvmathDashboard('duel');
        return;
    }

    if (room.status === 'countdown' && room.startAtMillis !== advmathDuelState.lastStartAtMillis) {
        advmathDuelState.lastStartAtMillis = room.startAtMillis;
        advmathDuelState.lastRematchUpdatedAt = null;
        advmathDuelState.resultShown = false;
        advmathDuelState.sequence = room.questions;
        advmathDuelState.count = room.count;
        advmathDuelState.opponentName = opponent ? opponent.name : 'Lawan';
        advmathDuelState.opponentAvatar = opponent ? opponent.avatar : null;

        hideModal('advmathDuelWaitingModal');
        hideModal('advmathDuelResultModal');
        hideModal('advmathDuelWaitingResultModal');
        hideModal('advmathDuelRematchWaitingModal');
        hideModal('advmathDuelRematchRequestModal');
        beginAdvmathDuelCountdown(room.startAtMillis);
    }

    if ((room.status === 'playing' || room.status === 'countdown') && opponent) {
        updateAdvmathDuelOpponentUI(opponent);
    }

    if (room.status === 'finished' && !advmathDuelState.resultShown) {
        advmathDuelState.resultShown = true;
        if (advmathGameInProgress) {
            advmathGameInProgress = false;
            stopAdvmathRoundTimer();
            advmathOptionButtons().forEach(b => { b.disabled = true; });
            advmathHintButtons().forEach(b => { b.disabled = true; });
        }
        await waitForModalHidden('advmathDuelWaitingResultModal');
        showAdvmathDuelResult(room);
    }

    if (room.rematch && room.rematch.updatedAt !== advmathDuelState.lastRematchUpdatedAt) {
        advmathDuelState.lastRematchUpdatedAt = room.rematch.updatedAt;
        const iAmRequester = room.rematch.requestedBy === advmathDuelState.role;

        if (room.rematch.status === 'pending') {
            if (iAmRequester) {
                showModal('advmathDuelRematchWaitingModal');
            } else {
                document.getElementById('advmathDuelRematchRequestText').textContent =
                    `${opponent ? opponent.name : 'Lawan'} ingin main lagi. Setuju?`;
                showModal('advmathDuelRematchRequestModal');
            }
        } else if (room.rematch.status === 'declined') {
            hideModal('advmathDuelRematchWaitingModal');
            hideModal('advmathDuelRematchRequestModal');
            if (iAmRequester) {
                showToast('danger', 'Lawan menolak ajakan main lagi.', 4000);
                await waitForModalHidden('advmathDuelRematchWaitingModal');
                showModal('advmathDuelResultModal');
                advmathDuelDocRef(advmathDuelState.roomCode).update({ rematch: null }).catch(() => {});
            }
        }
    }

    checkAdvmathDuelOpponentHeartbeat(opponent, room.status);
}

function beginAdvmathDuelCountdown(startAtMillis) {
    const countdownDurationMs = COUNTDOWN_STEPS.length * 800 + 650;
    const waitMs = Math.max(0, (startAtMillis - Date.now()) - countdownDurationMs);

    advmathSequence = advmathDuelState.sequence;
    advmathCount = advmathSequence.length;
    prepareAdvmathGameUI();

    const oppBar = document.getElementById('advmathDuelOpponentBar');
    oppBar.style.display = 'flex';
    document.getElementById('advmathDuelOpponentAvatar').textContent = avatarGlyph(advmathDuelState.opponentAvatar);
    document.getElementById('advmathDuelOpponentName').textContent = advmathDuelState.opponentName || 'Lawan';
    document.getElementById('advmathDuelOpponentFill').style.width = '0%';
    document.getElementById('advmathDuelOpponentCount').textContent = `0/${advmathCount} soal`;
    document.getElementById('advmathDuelDisconnectBanner').style.display = 'none';

    setTimeout(() => {
        if (!advmathDuelState) return;
        runCountdown(() => {
            beginAdvmathRound();
        });
    }, waitMs);

    advmathDuelDocRef(advmathDuelState.roomCode).update({ status: 'playing' }).catch(() => {});
}

function updateAdvmathDuelOpponentUI(opponent) {
    const fill = document.getElementById('advmathDuelOpponentFill');
    const countEl = document.getElementById('advmathDuelOpponentCount');
    if (!fill || !countEl) return;
    const total = (advmathDuelState && advmathDuelState.count) || advmathCount || 1;
    const done = Math.max(0, Math.min(total, Number(opponent.progress) || 0));
    fill.style.width = `${(done / total) * 100}%`;
    countEl.textContent = `${done}/${total} soal`;
}

// progress = jumlah soal yang sudah selesai (dijawab benar atau hangus)
function reportAdvmathDuelProgress(progress) {
    if (!advmathDuelState) return;
    advmathDuelDocRef(advmathDuelState.roomCode).update({
        [`${advmathDuelState.role}.progress`]: progress,
        [`${advmathDuelState.role}.mistakes`]: advmathMistakeCount,
        [`${advmathDuelState.role}.burned`]: advmathBurnedCount,
        [`${advmathDuelState.role}.hints`]: advmathHintsUsed,
        [`${advmathDuelState.role}.lastSeen`]: Date.now()
    }).catch(e => console.warn('[Duel Perkalian 1-10 Lanjutan] gagal kirim progres', e));
}

// Pemenang ditentukan setelah KEDUA pemain selesai: total waktu akhir (aktual + hukuman) paling singkat menang.
// (Berbeda dari duel Perkalian 1-10: di sini yang selesai duluan belum tentu menang karena ada hukuman waktu.)
async function endAdvmathDuelGame() {
    const myRole = advmathDuelState.role;
    const opponentRole = myRole === 'host' ? 'guest' : 'host';
    const roomRef = advmathDuelDocRef(advmathDuelState.roomCode);
    const myFinal = { time: advmathFinalSeconds, mistakes: advmathMistakeCount, burned: advmathBurnedCount, hints: advmathHintsUsed };

    try {
        await firestoreDb.runTransaction(async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists) return;
            const room = snap.data();

            const update = {
                [`${myRole}.progress`]: advmathCount,
                [`${myRole}.time`]: myFinal.time,
                [`${myRole}.mistakes`]: myFinal.mistakes,
                [`${myRole}.burned`]: myFinal.burned,
                [`${myRole}.hints`]: myFinal.hints,
                [`${myRole}.finishedAt`]: Date.now()
            };

            const opponentData = room[opponentRole];
            if (opponentData && opponentData.finishedAt) {
                update.status = 'finished';
                update.winner = determineAdvmathDuelWinner(myRole, myFinal, opponentRole, opponentData);
            }

            tx.update(roomRef, update);
        });
    } catch (e) {
        showToast('danger', `Gagal mengirim hasil duel: ${e.code || e.message}`, 5000);
    }

    if (!advmathDuelState.resultShown) {
        showModal('advmathDuelWaitingResultModal');
    }
}

function determineAdvmathDuelWinner(roleA, dataA, roleB, dataB) {
    if (dataA.time !== dataB.time) return dataA.time < dataB.time ? roleA : roleB;
    if ((dataA.burned || 0) !== (dataB.burned || 0)) return (dataA.burned || 0) < (dataB.burned || 0) ? roleA : roleB;
    if ((dataA.hints || 0) !== (dataB.hints || 0)) return (dataA.hints || 0) < (dataB.hints || 0) ? roleA : roleB;
    if ((dataA.mistakes || 0) !== (dataB.mistakes || 0)) return (dataA.mistakes || 0) < (dataB.mistakes || 0) ? roleA : roleB;
    return 'draw';
}

async function showAdvmathDuelResult(room) {
    stopAdvmathDuelHeartbeat();
    hideModal('advmathDuelWaitingResultModal');

    const isDraw = room.winner === 'draw';
    const amIWinner = room.winner === advmathDuelState.role;
    const me = advmathDuelState.role === 'host' ? room.host : room.guest;
    const opponent = advmathDuelState.role === 'host' ? room.guest : room.host;

    const banner = document.getElementById('advmathDuelWinnerBanner');
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
            ? `${formatAdvmathDuration(player.time)} · ✖${player.mistakes || 0} · 💡${player.hints || 0} · 💀${player.burned || 0}`
            : `Belum menyelesaikan soalnya`;
        return `
            <div class="duel-result-card">
                <div class="duel-result-avatar">${avatarGlyph(player ? player.avatar : null)}</div>
                <div class="duel-result-name">${escapeHtml(player ? player.name : '—')}</div>
                <div class="duel-result-label">${label}</div>
                <div class="duel-result-stat">${statLine}</div>
            </div>
        `;
    };

    document.getElementById('advmathDuelResultGrid').innerHTML =
        renderPlayer('Kamu', me) + renderPlayer('Lawan', opponent);

    if (amIWinner && me) {
        await recordAdvmathDuelWin(me.name, me.avatar);
    }

    showModal('advmathDuelResultModal');
    launchConfetti();
    playFinishSounds(amIWinner);
}

document.getElementById('advmathDuelRematchButton').addEventListener('click', async () => {
    if (!advmathDuelState) return;
    hideModal('advmathDuelResultModal');
    await waitForModalHidden('advmathDuelResultModal');
    try {
        await advmathDuelDocRef(advmathDuelState.roomCode).update({
            rematch: { requestedBy: advmathDuelState.role, status: 'pending', updatedAt: Date.now() }
        });
        showModal('advmathDuelRematchWaitingModal');
    } catch (e) {
        showToast('danger', `Gagal mengirim ajakan main lagi: ${e.code || e.message}`, 5000);
        showModal('advmathDuelResultModal');
    }
});

document.getElementById('advmathDuelRematchCancelButton').addEventListener('click', async () => {
    hideModal('advmathDuelRematchWaitingModal');
    if (advmathDuelState) {
        try {
            await advmathDuelDocRef(advmathDuelState.roomCode).update({ rematch: null });
        } catch (e) { /* abaikan */ }
    }
    await waitForModalHidden('advmathDuelRematchWaitingModal');
    showModal('advmathDuelResultModal');
});

document.getElementById('advmathDuelRematchAcceptButton').addEventListener('click', async () => {
    if (!advmathDuelState) return;
    hideModal('advmathDuelRematchRequestModal');
    await waitForModalHidden('advmathDuelRematchRequestModal');

    const newSequence = generateAdvmathSequence(advmathDuelState.count || advmathCount);
    advmathDuelState.sequence = newSequence;

    try {
        await advmathDuelDocRef(advmathDuelState.roomCode).update({
            questions: newSequence,
            count: newSequence.length,
            status: 'countdown',
            startAtMillis: Date.now() + ADVMATH_DUEL_START_BUFFER_MS,
            winner: null,
            rematch: null,
            'host.progress': 0, 'host.time': null, 'host.mistakes': 0, 'host.burned': 0, 'host.hints': 0, 'host.finishedAt': null, 'host.lastSeen': Date.now(),
            'guest.progress': 0, 'guest.time': null, 'guest.mistakes': 0, 'guest.burned': 0, 'guest.hints': 0, 'guest.finishedAt': null, 'guest.lastSeen': Date.now()
        });
    } catch (e) {
        showToast('danger', `Gagal memulai ulang duel: ${e.code || e.message}`, 5000);
    }
});

document.getElementById('advmathDuelRematchDeclineButton').addEventListener('click', async () => {
    if (!advmathDuelState) return;
    hideModal('advmathDuelRematchRequestModal');
    await waitForModalHidden('advmathDuelRematchRequestModal');
    showModal('advmathDuelResultModal');

    const requesterRole = advmathDuelState.role === 'host' ? 'guest' : 'host';
    try {
        await advmathDuelDocRef(advmathDuelState.roomCode).update({
            rematch: { requestedBy: requesterRole, status: 'declined', updatedAt: Date.now() }
        });
    } catch (e) { /* abaikan */ }
});

document.getElementById('advmathDuelResultDashboardButton').addEventListener('click', () => {
    hideModal('advmathDuelResultModal');
    cleanupAdvmathDuel();
    goToAdvmathDashboard('duel');
});

function startAdvmathDuelHeartbeat() {
    stopAdvmathDuelHeartbeat();
    advmathDuelHeartbeatInterval = setInterval(() => {
        if (!advmathDuelState) return;
        advmathDuelDocRef(advmathDuelState.roomCode).update({
            [`${advmathDuelState.role}.lastSeen`]: Date.now()
        }).catch(() => {});
    }, ADVMATH_DUEL_HEARTBEAT_INTERVAL_MS);
}

function stopAdvmathDuelHeartbeat() {
    if (advmathDuelHeartbeatInterval) {
        clearInterval(advmathDuelHeartbeatInterval);
        advmathDuelHeartbeatInterval = null;
    }
}

function checkAdvmathDuelOpponentHeartbeat(opponent, status) {
    const banner = document.getElementById('advmathDuelDisconnectBanner');
    if (!banner) return;
    if (!opponent || status === 'finished' || status === 'waiting') {
        banner.style.display = 'none';
        return;
    }
    const stale = opponent.lastSeen && (Date.now() - opponent.lastSeen > ADVMATH_DUEL_HEARTBEAT_TIMEOUT_MS);
    banner.style.display = stale ? 'flex' : 'none';
}

document.getElementById('advmathDuelLeaveDisconnectedButton').addEventListener('click', async () => {
    await abandonAdvmathDuel();
    goToAdvmathDashboard('duel');
});

async function abandonAdvmathDuel() {
    if (!advmathDuelState) return;
    try {
        await advmathDuelDocRef(advmathDuelState.roomCode).update({ status: 'abandoned' });
    } catch (e) { /* room mungkin sudah tidak ada / sudah selesai duluan, aman diabaikan */ }
    cleanupAdvmathDuel();
}

function cleanupAdvmathDuel() {
    if (advmathDuelState && typeof advmathDuelState.unsubscribe === 'function') {
        advmathDuelState.unsubscribe();
    }
    stopAdvmathDuelHeartbeat();
    const oppBar = document.getElementById('advmathDuelOpponentBar');
    const banner = document.getElementById('advmathDuelDisconnectBanner');
    if (oppBar) oppBar.style.display = 'none';
    if (banner) banner.style.display = 'none';
    advmathDuelState = null;
}
