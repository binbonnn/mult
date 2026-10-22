/* =====================================================================
   KONSTANTA & STATE
===================================================================== */
const QUESTION_COUNT_OPTIONS = [10, 20, 30];
const WARNING_TIME_SECONDS = 180; // 3 menit sebelum stopwatch full merah
const MAX_LEADERBOARD_RECORDS = 7; // papan peringkat dibatasi 7 besar
const AVATAR_OPTIONS = ['😀', '😎', '🥳', '🤠', '🐱', '🐶', '🦊', '🐼', '🦁', '🐸', '🐵', '🤖'];

let currentQuestionCount = QUESTION_COUNT_OPTIONS[1]; // default 20 soal saat main
let currentQuestionIndex = 0;
let correctAnswers = 0;
let startTime;
let stopwatchInterval;
let elapsedTime = 0; // dalam detik (untuk tampilan stopwatch)
let finalTimeSeconds = 0; // waktu akhir resmi saat game selesai (dipakai untuk peringkat & simpan skor)
let lastSavedRecord = null; // untuk menandai skor milik pemain di papan peringkat
let mistakes = 0;
let previousQuestions = [];
let questions = [];
let gameInProgress = false;

let activeLeaderboardCount = QUESTION_COUNT_OPTIONS[0]; // tab papan peringkat yang sedang dilihat
let leaderboardRequestToken = 0; // penjaga supaya hasil fetch basi tidak menimpa tab yang lebih baru
let selectedAvatar = null; // null = "tanpa foto profil"
let countdownRunToken = 0;

// ---- Duel 1v1 ----
let duelState = null; // null = tidak sedang duel; lihat createDuelRoom/joinDuelRoom untuk bentuknya
let duelCreateSelectedAvatar = null;
let duelJoinSelectedAvatar = null;
let duelHeartbeatInterval = null;
const DUEL_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // tanpa 0/O/1/I/L biar gak ketuker
const DUEL_HEARTBEAT_INTERVAL_MS = 5000;
const DUEL_HEARTBEAT_TIMEOUT_MS = 13000;
const DUEL_START_BUFFER_MS = 6000; // jeda setelah lawan bergabung, sebelum countdown mulai (untuk sinkronisasi)

/* =====================================================================
   REFERENSI DOM (diambil sekali di awal)
===================================================================== */
const hubView = document.getElementById('hubView');
const dashboardView = document.getElementById('dashboardView');
const gameView = document.getElementById('gameView');
const knowledgeDashboardView = document.getElementById('knowledgeDashboardView');
const knowledgeGameView = document.getElementById('knowledgeGameView');
const advmathDashboardView = document.getElementById('advmathDashboardView');
const advmathGameView = document.getElementById('advmathGameView');
const answerInput = document.querySelector('.answer-input');

/* =====================================================================
   UTIL: localStorage AMAN (tidak crash di private browsing dsb)
===================================================================== */
function safeGetLocalStorage(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : fallback;
    } catch (e) {
        console.warn('localStorage tidak tersedia:', e);
        return fallback;
    }
}

function safeSetLocalStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('localStorage tidak tersedia, data tidak disimpan:', e);
    }
}

function getRecordsKey(count) {
    return `records_${count}`;
}

// Mencegah XSS: teks dari input pengguna tidak boleh langsung masuk ke innerHTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Selalu pakai satu instance modal per elemen (mencegah listener/backdrop ganda)
function showModal(id) {
    bootstrap.Modal.getOrCreateInstance(document.getElementById(id)).show();
}

function hideModal(id) {
    bootstrap.Modal.getInstance(document.getElementById(id))?.hide();
}

// Bootstrap menyembunyikan modal lewat transisi CSS yang berjalan ASYNC. Kalau modal lain
// langsung ditampilkan sebelum transisi itu benar-benar selesai, sesekali terjadi race:
// modal lama bisa tersangkut dengan class "show" dan backdrop-nya menutupi layar.
// Fungsi ini menunggu event 'hidden.bs.modal' dulu (dengan jaring pengaman waktu) sebelum
// kode lanjut menampilkan modal berikutnya.
function waitForModalHidden(id) {
    return new Promise(resolve => {
        const el = document.getElementById(id);
        if (!el || !el.classList.contains('show')) {
            resolve();
            return;
        }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        el.addEventListener('hidden.bs.modal', finish, { once: true });
        setTimeout(finish, 400); // jaring pengaman jika event entah kenapa tidak terpicu
    });
}

function generateRandomNumber(max) {
    return Math.floor(Math.random() * max) + 1;
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function formatMistakes(mistakeCount) {
    return mistakeCount === 0 ? 'Sempurna' : `${mistakeCount} salah`;
}

function avatarGlyph(avatar) {
    return avatar ? avatar : '👤';
}

let soundEnabled = safeGetLocalStorage('soundEnabled', 'true') !== 'false';

/* =====================================================================
   PAPAN PERINGKAT BERSAMA (Firebase Firestore, fallback ke localStorage)
===================================================================== */
let firestoreDb = null;
let firebaseReady = false;

// Indikator status di bawah papan peringkat, supaya jelas skor disimpan di mana.
// Dipakai bersama oleh dashboard game Perkalian & Pengetahuan Dasar (satu koneksi Firebase yang sama).
function setLeaderboardStatus(mode, detail) {
    ['leaderboardStatus', 'knowledgeLeaderboardStatus', 'advmathLeaderboardStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.className = `leaderboard-status is-${mode}`;
        if (mode === 'online') {
            el.textContent = '🌐 Papan peringkat online: dilihat semua pemain';
        } else if (mode === 'local') {
            el.textContent = `📴 Mode lokal: skor hanya tersimpan di perangkat ini${detail ? ` (${detail})` : ''}`;
        } else {
            el.textContent = `⚠️ Gagal terhubung ke server${detail ? ` (${detail})` : ''}. Memakai data lokal.`;
        }
    });
}

function initFirebase() {
    try {
        if (typeof firebaseConfig === 'undefined' || !firebaseConfig.apiKey || firebaseConfig.apiKey.indexOf('ISI_') === 0) {
            console.warn('[Papan Peringkat] Firebase belum dikonfigurasi (lihat firebase-config.js). Memakai localStorage sebagai cadangan di perangkat ini saja.');
            setLeaderboardStatus('local', 'firebase-config.js belum diisi');
            return;
        }
        if (typeof firebase === 'undefined') {
            console.warn('[Papan Peringkat] SDK Firebase gagal dimuat. Memakai localStorage sebagai cadangan.');
            setLeaderboardStatus('local', 'SDK Firebase gagal dimuat');
            return;
        }
        firebase.initializeApp(firebaseConfig);
        firestoreDb = firebase.firestore();
        firebaseReady = true;
    } catch (e) {
        console.warn('[Papan Peringkat] Gagal menyambung ke Firebase, memakai localStorage sebagai cadangan.', e);
        setLeaderboardStatus('error', e.code || e.message);
    }
}
initFirebase();

// Urutan resmi: waktu tercepat dulu, jika sama maka kesalahan paling sedikit
function sortRecords(records) {
    return [...records].sort((a, b) => (a.time === b.time ? a.mistakes - b.mistakes : a.time - b.time));
}

function getRecordsFromLocalStorage(count) {
    try {
        return sortRecords(JSON.parse(safeGetLocalStorage(getRecordsKey(count), '[]'))).slice(0, MAX_LEADERBOARD_RECORDS);
    } catch (e) {
        return [];
    }
}

async function getRecordsForCount(count) {
    if (firebaseReady) {
        try {
            const snapshot = await firestoreDb
                .collection(getRecordsKey(count))
                .orderBy('time', 'asc')
                .limit(MAX_LEADERBOARD_RECORDS)
                .get();
            setLeaderboardStatus('online');
            return sortRecords(snapshot.docs.map(doc => doc.data())).slice(0, MAX_LEADERBOARD_RECORDS);
        } catch (e) {
            console.warn('[Papan Peringkat] Gagal memuat dari Firebase, memakai localStorage.', e);
            setLeaderboardStatus('error', e.code || e.message);
        }
    }
    return getRecordsFromLocalStorage(count);
}

async function saveRecord(count, record) {
    let onlineError = null;
    if (firebaseReady) {
        try {
            await firestoreDb.collection(getRecordsKey(count)).add(record);
            setLeaderboardStatus('online');
            return { online: true, error: null };
        } catch (e) {
            console.warn('[Papan Peringkat] Gagal menyimpan ke Firebase, menyimpan ke localStorage saja.', e);
            onlineError = e.code || e.message || 'unknown';
            setLeaderboardStatus('error', onlineError);
        }
    }
    let records = getRecordsFromLocalStorage(count);
    records.push(record);
    records = sortRecords(records).slice(0, MAX_LEADERBOARD_RECORDS);
    safeSetLocalStorage(getRecordsKey(count), JSON.stringify(records));
    return { online: false, error: onlineError };
}

/* =====================================================================
   EFEK SUARA (Web Audio API — tanpa file audio eksternal)
===================================================================== */
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

function playTone({ freq = 440, duration = 0.15, type = 'sine', volume = 0.2, delay = 0, glideTo = null }) {
    if (!soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const startAt = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (glideTo) {
        osc.frequency.linearRampToValueAtTime(glideTo, startAt + duration);
    }

    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.05);
}

// Tik countdown: makin tinggi nadanya makin dekat ke waktu mulai (menambah ketegangan)
function playCountdownTick(stepIndex) {
    if (stepIndex < 3) {
        playTone({ freq: 380 + stepIndex * 70, duration: 0.16, type: 'square', volume: 0.16 });
    } else {
        playTone({ freq: 660, duration: 0.12, type: 'triangle', volume: 0.2 });
        playTone({ freq: 880, duration: 0.26, type: 'triangle', volume: 0.22, delay: 0.12 });
    }
}

function playCorrectSound() {
    playTone({ freq: 660, duration: 0.1, type: 'sine', volume: 0.2 });
    playTone({ freq: 880, duration: 0.16, type: 'sine', volume: 0.22, delay: 0.09 });
}

function playWrongSound() {
    playTone({ freq: 220, duration: 0.22, type: 'sawtooth', volume: 0.16, glideTo: 140 });
}

function playFinishJingle() {
    playTone({ freq: 523.25, duration: 0.14, type: 'triangle', volume: 0.2 });       // C5
    playTone({ freq: 659.25, duration: 0.14, type: 'triangle', volume: 0.2, delay: 0.14 }); // E5
    playTone({ freq: 783.99, duration: 0.14, type: 'triangle', volume: 0.2, delay: 0.28 }); // G5
    playTone({ freq: 1046.5, duration: 0.32, type: 'triangle', volume: 0.24, delay: 0.42 }); // C6
}

// Terompet kemenangan saat skor masuk papan peringkat
function playFanfare() {
    playTone({ freq: 523.25, duration: 0.16, type: 'sawtooth', volume: 0.18 });
    playTone({ freq: 523.25, duration: 0.16, type: 'sawtooth', volume: 0.18, delay: 0.18 });
    playTone({ freq: 523.25, duration: 0.16, type: 'sawtooth', volume: 0.18, delay: 0.36 });
    playTone({ freq: 698.46, duration: 0.55, type: 'sawtooth', volume: 0.22, delay: 0.54 });
}

function playFinishSounds(qualifiesForLeaderboard) {
    playFinishJingle();
    if (qualifiesForLeaderboard) {
        setTimeout(playFanfare, 550);
    }
}

const SOUND_TOGGLE_BUTTON_IDS = ['soundToggleButton', 'knowledgeSoundToggleButton', 'advmathSoundToggleButton'];

function updateSoundToggleButton() {
    const label = soundEnabled ? 'Matikan suara' : 'Aktifkan suara';
    SOUND_TOGGLE_BUTTON_IDS.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.textContent = soundEnabled ? '🔊' : '🔇';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    });
}

function toggleSound() {
    soundEnabled = !soundEnabled;
    safeSetLocalStorage('soundEnabled', soundEnabled ? 'true' : 'false');
    updateSoundToggleButton();
    if (soundEnabled) {
        getAudioContext();
        playTone({ freq: 660, duration: 0.1, type: 'sine', volume: 0.18 });
    }
}

SOUND_TOGGLE_BUTTON_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', toggleSound);
});

updateSoundToggleButton();

/* =====================================================================
   EFEK VISUAL: CONFETTI SAAT GAME SELESAI
===================================================================== */
function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function launchConfetti() {
    if (prefersReducedMotion()) return;

    const colors = ['#ffd166', '#ff7ad9', '#8b6cff', '#34d399', '#38bdf8'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const pieceCount = 60;
    for (let i = 0; i < pieceCount; i++) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
        piece.style.animationDuration = `${(2.2 + Math.random() * 1.2).toFixed(2)}s`;
        piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 140)}px`);
        piece.style.setProperty('--rotate', `${Math.round(Math.random() * 720 - 360)}deg`);
        container.appendChild(piece);
    }

    setTimeout(() => container.remove(), 3800);
}

/* =====================================================================
   SOAL
===================================================================== */
function generateUniqueQuestions(count) {
    // Hanya ada 100 kombinasi (1-10 x 1-10). Jika riwayat soal hampir
    // menghabiskan semua kombinasi yang tersisa, reset riwayat supaya
    // while loop di bawah tidak berjalan selamanya.
    if (previousQuestions.length >= 100 - count) {
        previousQuestions = [];
    }

    const set = new Set();
    while (set.size < count) {
        const a = generateRandomNumber(10);
        const b = generateRandomNumber(10);
        const key = a + '*' + b;
        if (!previousQuestions.includes(key) && !set.has(key)) {
            set.add(key);
        }
    }

    previousQuestions.push(...set);
    return Array.from(set).map(q => q.split('*').map(n => parseInt(n)));
}

/* =====================================================================
   VIEW SWITCHING (Hub <-> Dashboard <-> Game)
===================================================================== */
function switchView(viewName) {
    hubView.classList.toggle('active', viewName === 'hub');
    dashboardView.classList.toggle('active', viewName === 'dashboard');
    gameView.classList.toggle('active', viewName === 'game');
    knowledgeDashboardView.classList.toggle('active', viewName === 'knowledgeDashboard');
    knowledgeGameView.classList.toggle('active', viewName === 'knowledgeGame');
    advmathDashboardView.classList.toggle('active', viewName === 'advmathDashboard');
    advmathGameView.classList.toggle('active', viewName === 'advmathGame');
    const memoViewEl = document.getElementById('memoView');
    if (memoViewEl) memoViewEl.classList.toggle('active', viewName === 'memo');
}

function goToHub() {
    switchView('hub');
}

function goToDashboard(focusCount) {
    countdownRunToken++; // batalkan countdown yang mungkin masih berjalan
    document.getElementById('countdownOverlay').classList.remove('is-visible');
    setActiveLeaderboardTab(focusCount || activeLeaderboardCount);
    switchView('dashboard');
}

/* =====================================================================
   HUB: PILIH GAME
===================================================================== */
document.getElementById('hubOpenMultiplyButton').addEventListener('click', () => {
    goToDashboard();
});

document.getElementById('backToHubButton').addEventListener('click', () => {
    goToHub();
});

document.getElementById('hubOpenKnowledgeButton').addEventListener('click', () => {
    goToKnowledgeDashboard();
});

document.getElementById('knowledgeBackToHubButton').addEventListener('click', () => {
    goToHub();
});

document.getElementById('hubOpenAdvmathButton').addEventListener('click', () => {
    goToAdvmathDashboard();
});

document.getElementById('advmathBackToHubButton').addEventListener('click', () => {
    goToHub();
});

function showGameComingSoonToast(btn) {
    const title = btn.querySelector('.game-card-title')?.textContent?.trim() || 'Game ini';
    showToast('danger', `🔒 ${title} segera hadir, nantikan ya!`, 3500);
}

document.querySelectorAll('.game-card.is-coming-soon, .game-card-soon').forEach(btn => {
    btn.addEventListener('click', () => showGameComingSoonToast(btn));
});
