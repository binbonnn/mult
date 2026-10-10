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

/* =====================================================================
   DASHBOARD: TAB PAPAN PERINGKAT (podium ala gambar referensi)
===================================================================== */
function setActiveLeaderboardTab(count) {
    activeLeaderboardCount = count;
    document.querySelectorAll('#dashboardView .leaderboard-tab').forEach(tab => {
        tab.classList.toggle('is-active', parseInt(tab.dataset.count, 10) === count);
    });
    renderLeaderboardPanel(count);
}

function showLeaderboardLoading() {
    document.getElementById('podium').innerHTML = '<div class="leaderboard-loading">Memuat papan peringkat...</div>';
    document.getElementById('rankList').innerHTML = '';
}

async function renderLeaderboardPanel(count) {
    const myToken = ++leaderboardRequestToken;
    showLeaderboardLoading();

    const records = await getRecordsForCount(count);
    if (myToken !== leaderboardRequestToken) return; // tab sudah berpindah lagi, abaikan hasil basi

    renderPodium(records);
    renderRankList(records);
}

const PODIUM_MEDALS = { 1: '👑', 2: '🥈', 3: '🥉' };

function isLastSavedRecord(record) {
    return !!lastSavedRecord
        && lastSavedRecord.count === activeLeaderboardCount
        && lastSavedRecord.name === record.name
        && lastSavedRecord.time === record.time
        && lastSavedRecord.mistakes === record.mistakes;
}

function renderPodium(records) {
    const podiumEl = document.getElementById('podium');
    const displayOrder = [1, 0, 2]; // tampil dari kiri ke kanan: peringkat 2, 1, 3

    podiumEl.innerHTML = displayOrder.map(rankIndex => {
        const place = rankIndex + 1;
        const spotClass = place === 1 ? 'podium-first' : place === 2 ? 'podium-second' : 'podium-third';
        const record = records[rankIndex];
        const medal = `<div class="podium-medal" aria-hidden="true">${PODIUM_MEDALS[place]}</div>`;
        const base = `<div class="podium-base" aria-hidden="true"><span>${place}</span></div>`;

        if (!record) {
            return `
                <div class="podium-spot ${spotClass} is-empty" role="group" aria-label="Peringkat ${place}: masih kosong">
                    ${medal}
                    <div class="podium-avatar-wrap"><div class="podium-avatar">👤</div></div>
                    <div class="podium-name">—</div>
                    <div class="podium-score">--:--</div>
                    <div class="podium-mistakes">&nbsp;</div>
                    ${base}
                </div>
            `;
        }

        const isYou = isLastSavedRecord(record);
        return `
            <div class="podium-spot ${spotClass}${isYou ? ' is-you' : ''}" role="group"
                 aria-label="Peringkat ${place}: ${escapeHtml(record.name)}, ${formatTime(record.time)}, ${formatMistakes(record.mistakes)}">
                ${medal}
                <div class="podium-avatar-wrap"><div class="podium-avatar">${avatarGlyph(record.avatar)}</div></div>
                <div class="podium-name" title="${escapeHtml(record.name)}">${escapeHtml(record.name)}</div>
                <div class="podium-score">${formatTime(record.time)}</div>
                <div class="podium-mistakes">${formatMistakes(record.mistakes)}</div>
                ${isYou ? '<div class="you-chip">⭐ Kamu</div>' : ''}
                ${base}
            </div>
        `;
    }).join('');
}

function renderRankList(records) {
    const listEl = document.getElementById('rankList');

    if (records.length === 0) {
        listEl.innerHTML = `<li class="rank-list-empty">Belum ada pemain di sini.<br>Jadilah yang pertama mencatat skor! 🏁</li>`;
        return;
    }

    const rest = records.slice(3, MAX_LEADERBOARD_RECORDS);
    if (rest.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = rest.map((record, i) => {
        const rank = i + 4;
        const isYou = isLastSavedRecord(record);
        return `
            <li class="rank-list-row${isYou ? ' is-you' : ''}">
                <span class="rank-list-position">${rank}</span>
                <span class="rank-list-avatar">${avatarGlyph(record.avatar)}</span>
                <span class="rank-list-name">${escapeHtml(record.name)}${isYou ? ' <span class="you-chip">⭐ Kamu</span>' : ''}</span>
                <span class="rank-list-dots" aria-hidden="true"></span>
                <span class="rank-list-score">${formatTime(record.time)}<small>${formatMistakes(record.mistakes)}</small></span>
            </li>
        `;
    }).join('');
}

document.querySelectorAll('#dashboardView .leaderboard-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveLeaderboardTab(parseInt(tab.dataset.count, 10)));
});

/* =====================================================================
   AVATAR PICKER (dipakai saat menyimpan skor)
===================================================================== */
function buildAvatarPicker(containerId, onSelect) {
    const picker = document.getElementById(containerId);
    if (!picker) return;
    const noProfileButton = `<button type="button" class="avatar-option is-selected" data-avatar="" aria-label="Tanpa foto profil">👤</button>`;
    const optionButtons = AVATAR_OPTIONS.map(avatar =>
        `<button type="button" class="avatar-option" data-avatar="${avatar}" aria-label="Avatar ${avatar}">${avatar}</button>`
    ).join('');

    picker.innerHTML = noProfileButton + optionButtons;

    picker.querySelectorAll('.avatar-option').forEach(btn => {
        btn.addEventListener('click', () => {
            picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            onSelect(btn.dataset.avatar || null);
        });
    });
}

/* =====================================================================
   MODAL: BANTUAN & PILIH JUMLAH SOAL
===================================================================== */
document.getElementById('helpButton').addEventListener('click', () => {
    showModal('helpModal');
});

document.getElementById('openStartModalButton').addEventListener('click', () => {
    showModal('chooseCountModal');
});

document.querySelectorAll('#chooseCountModal .count-option-button').forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count, 10);
        hideModal('chooseCountModal');
        startGameWithCount(count);
    });
});

/* =====================================================================
   ALUR GAME
===================================================================== */
const COUNTDOWN_STEPS = [
    { text: '3', label: 'Bersiap-siap...' },
    { text: '2', label: 'Fokus...' },
    { text: '1', label: 'Konsentrasi!' },
    { text: 'Mulai!', label: 'Ayo jawab secepat mungkin!' }
];

function startGameWithCount(count) {
    currentQuestionCount = count;
    currentQuestionIndex = 0;
    correctAnswers = 0;
    mistakes = 0;
    elapsedTime = 0;
    gameInProgress = true;
    lastSavedRecord = null;
    questions = generateUniqueQuestions(count);

    const stopwatchEl = document.getElementById('stopwatch');
    stopwatchEl.textContent = '00:00';
    stopwatchEl.style.backgroundColor = 'white';

    // Reset UI, tapi keypad & soal masih disembunyikan/nonaktif sampai countdown selesai
    answerInput.value = '';
    answerInput.disabled = true;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => {
        btn.disabled = true;
    });
    document.querySelector('.buttonStart').textContent = 'Jawab';
    document.getElementById('question').innerText = '';
    document.getElementById('buttonHint').style.display = 'none';
    document.getElementById('progressLabel').textContent = `Soal 1 dari ${count}`;
    document.getElementById('progressBarFill').style.width = '0%';

    switchView('game');
    runCountdown(() => {
        answerInput.disabled = false;
        document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => {
            btn.disabled = false;
        });
        displayQuestion();
        startTime = new Date().getTime();
        startStopwatch();
        answerInput.focus();
    });
}

function runCountdown(onComplete) {
    const overlay = document.getElementById('countdownOverlay');
    const numberEl = document.getElementById('countdownNumber');
    const labelEl = document.getElementById('countdownLabel');
    const myToken = ++countdownRunToken;
    let stepIndex = 0;

    overlay.classList.add('is-visible');

    function showStep() {
        if (myToken !== countdownRunToken) return; // dibatalkan oleh countdown/navigasi lain

        const step = COUNTDOWN_STEPS[stepIndex];
        numberEl.textContent = step.text;
        labelEl.textContent = step.label;
        playCountdownTick(stepIndex);

        // Re-trigger animasi tiap langkah dengan memaksa reflow
        numberEl.classList.remove('countdown-pop');
        labelEl.style.animation = 'none';
        void numberEl.offsetWidth;
        numberEl.classList.add('countdown-pop');
        labelEl.style.animation = '';

        stepIndex++;
        if (stepIndex < COUNTDOWN_STEPS.length) {
            setTimeout(showStep, 800);
        } else {
            setTimeout(() => {
                if (myToken !== countdownRunToken) return;
                overlay.classList.remove('is-visible');
                onComplete();
            }, 650);
        }
    }

    showStep();
}

function updateProgress() {
    document.getElementById('progressLabel').textContent =
        `Soal ${Math.min(currentQuestionIndex + 1, currentQuestionCount)} dari ${currentQuestionCount}`;
    const pct = (currentQuestionIndex / currentQuestionCount) * 100;
    document.getElementById('progressBarFill').style.width = `${pct}%`;
}

function displayQuestion() {
    const [a, b] = questions[currentQuestionIndex];
    document.getElementById('question').innerText = `${a} x ${b} = ...`;
    document.getElementById('buttonHint').style.display = 'inline-flex';
    updateProgress();
}

document.getElementById('buttonHint').addEventListener('click', function () {
    const grid = document.getElementById('multiplicationRow');
    grid.innerHTML = '';

    for (let i = 1; i <= 10; i++) {
        const cell = document.createElement('div');
        cell.className = 'multiplication-cell';

        let lines = `<div class="multiplication-title">Tabel ${i}</div>`;
        for (let j = 1; j <= 10; j++) {
            lines += `<div class="multiplication-line">${i} x ${j} = <strong>${i * j}</strong></div>`;
        }
        cell.innerHTML = lines;
        grid.appendChild(cell);
    }

    showModal('hintModal');
});

function checkAnswer() {
    if (!answerInput.value.trim()) { // jika input kosong
        showToast('danger', 'Isi dulu jawabannya ya! 😉');
        answerInput.focus();
        return;
    }

    const userAnswer = parseInt(answerInput.value, 10);
    const [a, b] = questions[currentQuestionIndex];

    if (userAnswer !== a * b) {
        mistakes++;
        playWrongSound();
        showToast('danger', 'Salah! 😅');
        answerInput.classList.add('wiggle-animation');
        answerInput.value = '';
        setTimeout(() => answerInput.classList.remove('wiggle-animation'), 400);
    } else {
        playCorrectSound();
        showToast('success', 'Benar! 🎉');
        correctAnswers++;
        currentQuestionIndex++;
        answerInput.value = '';

        if (correctAnswers === currentQuestionCount - 1) {
            document.querySelector('.buttonStart').textContent = 'Selesai';
        }

        if (correctAnswers === currentQuestionCount) {
            if (duelState) {
                endDuelGame();
            } else {
                endGame();
            }
        } else {
            displayQuestion();
            if (duelState) reportDuelProgress();
        }
    }
}

// Selisih detik yang dibutuhkan untuk MENGALAHKAN rekor tertentu (minimal 1 detik lebih cepat)
function secondsToBeat(timeTaken, record) {
    return Math.max(1, timeTaken - record.time + 1);
}

function buildRankInsight(timeTaken, mistakeCount, records) {
    const sorted = sortRecords(records);
    const beatenBy = sorted.filter(r => r.time < timeTaken || (r.time === timeTaken && r.mistakes <= mistakeCount)).length;
    const rank = beatenBy + 1;
    const qualifies = rank <= MAX_LEADERBOARD_RECORDS;
    const details = [];
    const top = sorted[0];
    const third = sorted[2];
    const lastPlace = sorted[MAX_LEADERBOARD_RECORDS - 1];

    if (sorted.length === 0) {
        return {
            rank: 1, qualifies: true, tone: 'top',
            headline: '🏆 Kamu pemain pertama di level ini!',
            details: [{ icon: '💾', text: 'Simpan skormu untuk jadi peringkat 1 di papan peringkat.' }]
        };
    }

    if (rank === 1) {
        const gap = top.time - timeTaken;
        if (gap > 0) {
            details.push({ icon: '⚡', text: `${gap} detik lebih cepat dari rekor sebelumnya (${top.name}).` });
        } else {
            details.push({ icon: '🎯', text: `Waktu sama dengan rekor sebelumnya, tapi kesalahanmu lebih sedikit.` });
        }
        return { rank, qualifies, tone: 'top', headline: '👑 Rekor baru! Kamu peringkat 1', details };
    }

    const gapToTop = timeTaken - top.time;

    if (rank <= 3) {
        const above = sorted[rank - 2];
        let topText;
        if (gapToTop > 0) {
            topText = `${gapToTop} detik lebih lambat dari peringkat 1.`;
        } else if (top.mistakes < mistakeCount) {
            topText = 'Waktu sama dengan peringkat 1, tapi kalah di jumlah kesalahan.';
        } else {
            topText = 'Seri dengan peringkat 1. Rekor yang lebih dulu tercatat tetap di atas.';
        }
        details.push({ icon: '🐢', text: topText });
        details.push({ icon: '🚀', text: `${secondsToBeat(timeTaken, above)} detik lagi untuk naik ke peringkat ${rank - 1}.` });
        return { rank, qualifies, tone: 'top', headline: `${PODIUM_MEDALS[rank]} Kamu masuk 3 besar! Peringkat ${rank}`, details };
    }

    if (qualifies) {
        details.push({ icon: '🥉', text: `${secondsToBeat(timeTaken, third)} detik lagi untuk masuk 3 besar.` });
        details.push({ icon: '🐢', text: `${gapToTop} detik lebih lambat dari peringkat 1.` });
        return { rank, qualifies, tone: 'ok', headline: `🎯 Kamu masuk papan peringkat! Peringkat ${rank}`, details };
    }

    details.push({ icon: '📉', text: `${timeTaken - lastPlace.time} detik lebih lambat dari peringkat ${MAX_LEADERBOARD_RECORDS}.` });
    details.push({ icon: '🎯', text: `${secondsToBeat(timeTaken, lastPlace)} detik lagi untuk masuk papan peringkat.` });
    details.push({ icon: '🥉', text: `${secondsToBeat(timeTaken, third)} detik lagi untuk masuk 3 besar.` });
    return { rank, qualifies, tone: 'miss', headline: '💪 Belum masuk papan peringkat, ayo coba lagi!', details };
}

function renderRankInsight(insight) {
    const box = document.getElementById('rankInsight');
    box.className = `rank-insight is-${insight.tone}`;
    document.getElementById('rankInsightHeadline').textContent = insight.headline;

    const list = document.getElementById('rankInsightDetails');
    list.innerHTML = '';
    insight.details.forEach(detail => {
        const li = document.createElement('li');
        li.dataset.icon = detail.icon;
        li.textContent = detail.text; // textContent: aman dari XSS (nama pemain lain ikut tampil)
        list.appendChild(li);
    });
    box.style.display = 'block';
}

async function endGame() {
    gameInProgress = false;
    stopStopwatch();
    updateProgress();

    finalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    const currentBackgroundColor = document.getElementById('stopwatch').style.backgroundColor;
    safeSetLocalStorage('lastGameBackgroundColor', currentBackgroundColor);

    document.getElementById('finalTime').textContent = formatTime(finalTimeSeconds);
    document.getElementById('mistakesCount').textContent = mistakes.toString();

    // Nonaktifkan keypad
    answerInput.disabled = true;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => {
        btn.disabled = true;
    });
    document.getElementById('question').innerText = '';
    document.getElementById('buttonHint').style.display = 'none';

    const playerRecords = await getRecordsForCount(currentQuestionCount);
    const insight = buildRankInsight(finalTimeSeconds, mistakes, playerRecords);
    renderRankInsight(insight);

    // Skor yang tidak akan masuk papan peringkat tidak perlu ditawarkan untuk disimpan
    document.getElementById('saveScoreButton').style.display = insight.qualifies ? 'inline-block' : 'none';

    showModal('endGameModal');
    launchConfetti();
    playFinishSounds(insight.qualifies);
}

/* =====================================================================
   SIMPAN SKOR
===================================================================== */
document.getElementById('saveScoreButton').addEventListener('click', async () => {
    hideModal('endGameModal');
    await waitForModalHidden('endGameModal');
    showModal('saveRecordModal');
});

document.getElementById('buttonSavePlayerRecord').addEventListener('click', savePlayerRecord);

async function savePlayerRecord() {
    const playerNameInput = document.getElementById('playerName');
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
        alert('Isi dulu namamu ya!');
        return;
    }

    const saveButton = document.getElementById('buttonSavePlayerRecord');
    saveButton.disabled = true;
    saveButton.textContent = 'Menyimpan...';

    const savedBackgroundColor = safeGetLocalStorage('lastGameBackgroundColor');

    let saveResult = null;
    try {
        saveResult = await saveRecord(currentQuestionCount, {
            name: playerName,
            time: finalTimeSeconds,
            mistakes: mistakes,
            avatar: selectedAvatar,
            bgColor: savedBackgroundColor
        });
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Simpan';
    }

    hideModal('saveRecordModal');
    playerNameInput.value = '';

    lastSavedRecord = { count: currentQuestionCount, name: playerName, time: finalTimeSeconds, mistakes: mistakes };

    if (saveResult && saveResult.error) {
        showToast('danger', `Gagal simpan online: ${saveResult.error}`, 6000);
    }

    goToDashboard(currentQuestionCount);
}

document.getElementById('saveRecordModal').addEventListener('shown.bs.modal', function () {
    document.getElementById('playerName').focus();
});

/* =====================================================================
   NAVIGASI: KEMBALI KE DASHBOARD / MAIN LAGI
===================================================================== */
document.getElementById('backToDashboardButton').addEventListener('click', () => {
    if (gameInProgress || duelState) {
        showModal('confirmExitModal');
    } else {
        goToDashboard();
    }
});

document.getElementById('confirmExitYesButton').addEventListener('click', async () => {
    hideModal('confirmExitModal');
    stopStopwatch();
    gameInProgress = false;
    if (duelState) {
        await abandonDuel();
    }
    goToDashboard();
});

document.getElementById('playAgainButton').addEventListener('click', () => {
    hideModal('endGameModal');
    startGameWithCount(currentQuestionCount);
});

document.getElementById('endGameBackToDashboardButton').addEventListener('click', () => {
    hideModal('endGameModal');
    goToDashboard(currentQuestionCount);
});

/* =====================================================================
   STOPWATCH
===================================================================== */
function startStopwatch() {
    clearInterval(stopwatchInterval);
    stopwatchInterval = setInterval(() => {
        const seconds = Math.floor((Date.now() - startTime) / 1000);
        if (seconds === elapsedTime) return;
        elapsedTime = seconds;

        const stopwatchEl = document.getElementById('stopwatch');
        stopwatchEl.textContent = formatTime(elapsedTime);
        if (elapsedTime >= WARNING_TIME_SECONDS) {
            stopwatchEl.style.backgroundColor = '#dc3545';
        } else {
            const opacity = elapsedTime / WARNING_TIME_SECONDS;
            stopwatchEl.style.backgroundColor = `rgba(255, 0, 0, ${opacity})`;
        }
    }, 250);
}

function stopStopwatch() {
    clearInterval(stopwatchInterval);
}

/* =====================================================================
   KEYPAD & INPUT
===================================================================== */
document.querySelectorAll('.buttonKeypad').forEach(btn => {
    btn.addEventListener('click', () => {
        answerInput.value += btn.dataset.digit;
    });
});

document.querySelector('.buttonDelete').addEventListener('click', () => {
    answerInput.value = answerInput.value.slice(0, -1);
});

document.querySelector('.buttonStart').addEventListener('click', checkAnswer);

// Boleh juga ketik langsung pakai keyboard fisik: hanya angka, Enter = submit
answerInput.addEventListener('input', () => {
    answerInput.value = answerInput.value.replace(/[^0-9]/g, '');
});

answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        checkAnswer();
    }
});

/* =====================================================================
   TOAST NOTIFIKASI (Benar / Salah)
===================================================================== */
function showToast(type, message, duration = 1400) {
    const toast = document.createElement('div');
    toast.className = `toast-alert toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

/* =====================================================================
   DUEL 1v1 (room code, realtime lewat Firestore)
===================================================================== */
// Firestore TIDAK mendukung array bersarang (array di dalam array).
// questions lokal berbentuk [[a,b], [a,b], ...] harus diubah jadi [{a,b}, ...] sebelum
// ditulis ke Firestore, dan dikembalikan lagi ke bentuk [[a,b], ...] saat dibaca.
function questionsToFirestoreArray(qs) {
    return qs.map(pair => ({ a: pair[0], b: pair[1] }));
}

function questionsFromFirestoreArray(qs) {
    return qs.map(q => [q.a, q.b]);
}

function duelDocRef(roomCode) {
    return firestoreDb.collection('duels').doc(roomCode);
}

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += DUEL_CODE_CHARS[Math.floor(Math.random() * DUEL_CODE_CHARS.length)];
    }
    return code;
}

function requireFirebaseForDuel() {
    if (firebaseReady) return true;
    showToast('danger', 'Fitur duel butuh koneksi ke server. Cek firebase-config.js sudah diisi & Firestore Rules sudah di-publish.', 6000);
    return false;
}

document.getElementById('openDuelModalButton').addEventListener('click', () => {
    if (!requireFirebaseForDuel()) return;
    showModal('duelModal');
});

document.getElementById('duelCreateRoomButton').addEventListener('click', async () => {
    hideModal('duelModal');
    await waitForModalHidden('duelModal');
    showModal('duelCreateModal');
});

document.getElementById('duelJoinRoomButton').addEventListener('click', async () => {
    hideModal('duelModal');
    await waitForModalHidden('duelModal');
    showModal('duelJoinModal');
});

buildAvatarPicker('duelCreateAvatarPicker', (avatar) => { duelCreateSelectedAvatar = avatar; });
buildAvatarPicker('duelJoinAvatarPicker', (avatar) => { duelJoinSelectedAvatar = avatar; });

document.getElementById('duelJoinCode').addEventListener('input', function () {
    this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});

/* ---- Buat Room ---- */
document.querySelectorAll('#duelCreateModal .count-option-button').forEach(btn => {
    btn.addEventListener('click', () => createDuelRoom(parseInt(btn.dataset.count, 10)));
});

async function createDuelRoom(count) {
    const nameInput = document.getElementById('duelCreateName');
    const name = nameInput.value.trim();
    if (!name) {
        showToast('danger', 'Isi dulu namamu ya!');
        nameInput.focus();
        return;
    }

    cleanupDuel();
    hideModal('duelCreateModal');

    const questions = generateUniqueQuestions(count);
    let roomCode = null;

    try {
        for (let attempt = 0; attempt < 6 && !roomCode; attempt++) {
            const candidate = generateRoomCode();
            const snap = await duelDocRef(candidate).get();
            if (!snap.exists) roomCode = candidate;
        }
        if (!roomCode) throw new Error('kode-habis');

        await duelDocRef(roomCode).set({
            count: count,
            questions: questionsToFirestoreArray(questions),
            status: 'waiting',
            createdAt: Date.now(),
            startAtMillis: null,
            winner: null,
            rematch: null,
            host: { name: name, avatar: duelCreateSelectedAvatar, progress: 0, mistakes: 0, time: null, finishedAt: null, lastSeen: Date.now() },
            guest: null
        });
    } catch (e) {
        showToast('danger', `Gagal membuat room: ${e.code || e.message}`, 5000);
        return;
    }

    duelState = { roomCode, role: 'host', count, questions, lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false };
    document.getElementById('duelRoomCodeDisplay').textContent = roomCode;
    await waitForModalHidden('duelCreateModal');
    showModal('duelWaitingModal');
    listenToDuelRoom(roomCode);
    startDuelHeartbeat();
}

document.getElementById('duelCopyCodeButton').addEventListener('click', () => {
    const code = document.getElementById('duelRoomCodeDisplay').textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => showToast('success', 'Kode disalin!')).catch(() => {});
    }
});

document.getElementById('duelCancelWaitingButton').addEventListener('click', async () => {
    hideModal('duelWaitingModal');
    await abandonDuel();
});

/* ---- Gabung Room ---- */
document.getElementById('duelJoinSubmitButton').addEventListener('click', joinDuelRoom);

async function joinDuelRoom() {
    const codeInput = document.getElementById('duelJoinCode');
    const nameInput = document.getElementById('duelJoinName');
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

    const submitBtn = document.getElementById('duelJoinSubmitButton');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Menghubungkan...';

    try {
        const ref = duelDocRef(code);
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

        const startAtMillis = Date.now() + DUEL_START_BUFFER_MS;
        await ref.update({
            guest: { name: name, avatar: duelJoinSelectedAvatar, progress: 0, mistakes: 0, time: null, finishedAt: null, lastSeen: Date.now() },
            status: 'countdown',
            startAtMillis: startAtMillis
        });

        cleanupDuel();
        duelState = { roomCode: code, role: 'guest', count: room.count, questions: questionsFromFirestoreArray(room.questions), lastStartAtMillis: null, lastRematchUpdatedAt: null, resultShown: false };
        codeInput.value = '';
        nameInput.value = '';
        hideModal('duelJoinModal');
        listenToDuelRoom(code);
        startDuelHeartbeat();
    } catch (e) {
        showToast('danger', `Gagal gabung room: ${e.code || e.message}`, 5000);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Gabung';
    }
}

/* ---- Listener realtime: satu fungsi ini yang menggerakkan seluruh alur duel ---- */
function listenToDuelRoom(roomCode) {
    if (!duelState) return;
    duelState.unsubscribe = duelDocRef(roomCode).onSnapshot(
        snap => {
            if (!snap.exists) {
                if (!duelState) return;
                showToast('danger', 'Room duel sudah tidak tersedia.', 4000);
                cleanupDuel();
                goToDashboard();
                return;
            }
            handleDuelRoomUpdate(snap.data());
        },
        err => console.warn('[Duel] listener error', err)
    );
}

async function handleDuelRoomUpdate(room) {
    if (!duelState) return;

    const opponentRole = duelState.role === 'host' ? 'guest' : 'host';
    const opponent = room[opponentRole];

    if (room.status === 'abandoned') {
        showToast('danger', 'Lawan meninggalkan duel.', 4000);
        cleanupDuel();
        goToDashboard();
        return;
    }

    // Bandingkan startAtMillis (bukan boolean sepihak) supaya KEDUA sisi mendeteksi ronde baru
    // dengan cara yang sama, baik yang menekan "Main Lagi" maupun yang tidak.
    if (room.status === 'countdown' && room.startAtMillis !== duelState.lastStartAtMillis) {
        duelState.lastStartAtMillis = room.startAtMillis;
        duelState.lastRematchUpdatedAt = null;
        duelState.resultShown = false;
        duelState.questions = questionsFromFirestoreArray(room.questions);
        duelState.opponentName = opponent ? opponent.name : 'Lawan';
        duelState.opponentAvatar = opponent ? opponent.avatar : null;
        // Tutup modal apa pun yang mungkin masih terbuka di sisi ini (mis. sisi yang TIDAK
        // menekan "Main Lagi" tetap punya modal hasil pertandingan sebelumnya terbuka)
        hideModal('duelWaitingModal');
        hideModal('duelResultModal');
        hideModal('duelRematchWaitingModal');
        hideModal('duelRematchRequestModal');
        beginDuelCountdown(room.startAtMillis);
    }

    if ((room.status === 'playing' || room.status === 'countdown') && opponent) {
        updateDuelOpponentUI(opponent);
    }

    if (room.status === 'finished' && !duelState.resultShown) {
        duelState.resultShown = true;
        if (gameInProgress) { // saya diinterupsi sebelum sempat menjawab semua soal
            gameInProgress = false;
            stopStopwatch();
            answerInput.disabled = true;
            document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => { btn.disabled = true; });
        }
        showDuelResult(room);
    }

    // Ajakan main lagi: minta persetujuan lawan dulu sebelum benar-benar mengulang.
    // Dibandingkan lewat updatedAt (bukan boolean) supaya permintaan & penolakan berikutnya
    // tetap terdeteksi meski isi field-nya sempat sama.
    if (room.rematch && room.rematch.updatedAt !== duelState.lastRematchUpdatedAt) {
        duelState.lastRematchUpdatedAt = room.rematch.updatedAt;
        const iAmRequester = room.rematch.requestedBy === duelState.role;

        if (room.rematch.status === 'pending') {
            if (iAmRequester) {
                showModal('duelRematchWaitingModal');
            } else {
                document.getElementById('duelRematchRequestText').textContent =
                    `${opponent ? opponent.name : 'Lawan'} ingin main lagi. Setuju?`;
                showModal('duelRematchRequestModal');
            }
        } else if (room.rematch.status === 'declined') {
            hideModal('duelRematchWaitingModal');
            hideModal('duelRematchRequestModal');
            if (iAmRequester) {
                showToast('danger', 'Lawan menolak ajakan main lagi.', 4000);
                await waitForModalHidden('duelRematchWaitingModal');
                showModal('duelResultModal');
                duelDocRef(duelState.roomCode).update({ rematch: null }).catch(() => {});
            }
        }
    }

    checkDuelOpponentHeartbeat(opponent, room.status);
}

/* ---- Countdown tersinkron: dua HP mulai hitung mundur pada waktu yang (kurang lebih) sama ---- */
function beginDuelCountdown(startAtMillis) {
    const countdownDurationMs = COUNTDOWN_STEPS.length * 800 + 650; // total waktu runCountdown sampai onComplete
    const waitMs = Math.max(0, (startAtMillis - Date.now()) - countdownDurationMs);

    prepareDuelGameUI();

    setTimeout(() => {
        if (!duelState) return;
        runCountdown(beginDuelPlaying);
    }, waitMs);

    duelDocRef(duelState.roomCode).update({ status: 'playing' }).catch(() => {});
}

function prepareDuelGameUI() {
    // Tampilkan overlay countdown DI SINI, sinkron bareng switchView('game') di bawah.
    // Kalau overlay baru muncul lewat runCountdown() (yang dijadwalkan via setTimeout terpisah),
    // browser sempat merender satu frame "layar game polos" tanpa overlay lebih dulu -> kelihatan kedip.
    const overlay = document.getElementById('countdownOverlay');
    document.getElementById('countdownNumber').textContent = COUNTDOWN_STEPS[0].text;
    document.getElementById('countdownLabel').textContent = COUNTDOWN_STEPS[0].label;
    overlay.classList.add('is-visible');

    currentQuestionCount = duelState.count;
    currentQuestionIndex = 0;
    correctAnswers = 0;
    mistakes = 0;
    elapsedTime = 0;
    gameInProgress = true;
    lastSavedRecord = null;
    questions = duelState.questions;

    const stopwatchEl = document.getElementById('stopwatch');
    stopwatchEl.textContent = '00:00';
    stopwatchEl.style.backgroundColor = 'white';

    answerInput.value = '';
    answerInput.disabled = true;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => { btn.disabled = true; });
    document.querySelector('.buttonStart').textContent = 'Jawab';
    document.getElementById('question').innerText = '';
    document.getElementById('buttonHint').style.display = 'none';
    document.getElementById('progressLabel').textContent = `Soal 1 dari ${duelState.count}`;
    document.getElementById('progressBarFill').style.width = '0%';

    const oppBar = document.getElementById('duelOpponentBar');
    oppBar.style.display = 'flex';
    document.getElementById('duelOpponentAvatar').textContent = avatarGlyph(duelState.opponentAvatar);
    document.getElementById('duelOpponentName').textContent = duelState.opponentName || 'Lawan';
    document.getElementById('duelOpponentFill').style.width = '0%';
    document.getElementById('duelOpponentCount').textContent = `0/${duelState.count}`;
    document.getElementById('duelDisconnectBanner').style.display = 'none';

    switchView('game');
}

function beginDuelPlaying() {
    if (!duelState) return;
    answerInput.disabled = false;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => { btn.disabled = false; });
    displayQuestion();
    startTime = Date.now();
    startStopwatch();
    answerInput.focus();
}

function updateDuelOpponentUI(opponent) {
    if (!duelState) return;
    const fill = document.getElementById('duelOpponentFill');
    const countEl = document.getElementById('duelOpponentCount');
    if (!fill || !countEl) return;
    const pct = Math.min(100, (opponent.progress / duelState.count) * 100);
    fill.style.width = `${pct}%`;
    countEl.textContent = `${opponent.progress}/${duelState.count}`;
}

function reportDuelProgress() {
    if (!duelState) return;
    duelDocRef(duelState.roomCode).update({
        [`${duelState.role}.progress`]: correctAnswers,
        [`${duelState.role}.mistakes`]: mistakes,
        [`${duelState.role}.lastSeen`]: Date.now()
    }).catch(e => console.warn('[Duel] gagal kirim progres', e));
}

/* ---- Selesai: transaksi memastikan hanya yang PERTAMA selesai jadi pemenang ---- */
async function endDuelGame() {
    gameInProgress = false;
    stopStopwatch();
    updateProgress();
    finalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    answerInput.disabled = true;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => { btn.disabled = true; });
    document.getElementById('question').innerText = '';
    document.getElementById('buttonHint').style.display = 'none';

    const myRole = duelState.role;
    const roomRef = duelDocRef(duelState.roomCode);

    try {
        await firestoreDb.runTransaction(async (tx) => {
            const snap = await tx.get(roomRef);
            if (!snap.exists) return;
            const room = snap.data();

            const update = {
                [`${myRole}.progress`]: correctAnswers,
                [`${myRole}.mistakes`]: mistakes,
                [`${myRole}.time`]: finalTimeSeconds,
                [`${myRole}.finishedAt`]: Date.now()
            };

            if (room.status !== 'finished') {
                update.status = 'finished';
                update.winner = myRole;
            }

            tx.update(roomRef, update);
        });
    } catch (e) {
        showToast('danger', `Gagal mengirim hasil duel: ${e.code || e.message}`, 5000);
    }
    // Modal hasil akan muncul lewat listener (handleDuelRoomUpdate) begitu status 'finished' diterima,
    // supaya kedua pemain melihat hasil pada saat yang (hampir) bersamaan.
}

function showDuelResult(room) {
    stopDuelHeartbeat();
    const amIWinner = room.winner === duelState.role;
    const me = duelState.role === 'host' ? room.host : room.guest;
    const opponent = duelState.role === 'host' ? room.guest : room.host;

    const banner = document.getElementById('duelWinnerBanner');
    banner.textContent = amIWinner ? '🏆 Kamu Menang!' : `😅 ${opponent ? opponent.name : 'Lawan'} Menang`;
    banner.className = `duel-winner-banner ${amIWinner ? 'is-win' : 'is-lose'}`;

    const renderPlayer = (label, player, isWinnerSide) => {
        const finished = !!(player && player.finishedAt);
        const statLine = finished
            ? `${formatTime(player.time)} · ${formatMistakes(player.mistakes)}`
            : `Berhenti di soal ${player ? player.progress : 0}/${room.count}`;
        return `
            <div class="duel-result-card ${isWinnerSide ? 'is-winner' : ''}">
                <div class="duel-result-avatar">${avatarGlyph(player ? player.avatar : null)}</div>
                <div class="duel-result-name">${escapeHtml(player ? player.name : '—')}</div>
                <div class="duel-result-label">${label}</div>
                <div class="duel-result-stat">${statLine}</div>
            </div>
        `;
    };

    document.getElementById('duelResultGrid').innerHTML =
        renderPlayer('Kamu', me, amIWinner) + renderPlayer('Lawan', opponent, !amIWinner);

    showModal('duelResultModal');
    launchConfetti();
    playFinishSounds(amIWinner);
}

// Tombol "Main Lagi": hanya MENGAJUKAN permintaan, belum langsung mengulang duelnya.
// Duel baru benar-benar dimulai lagi setelah lawan menekan "Setuju" (lihat duelRematchAcceptButton).
document.getElementById('duelRematchButton').addEventListener('click', async () => {
    if (!duelState) return;
    hideModal('duelResultModal');
    await waitForModalHidden('duelResultModal');
    try {
        await duelDocRef(duelState.roomCode).update({
            rematch: { requestedBy: duelState.role, status: 'pending', updatedAt: Date.now() }
        });
        showModal('duelRematchWaitingModal');
    } catch (e) {
        showToast('danger', `Gagal mengirim ajakan main lagi: ${e.code || e.message}`, 5000);
        showModal('duelResultModal');
    }
});

document.getElementById('duelRematchCancelButton').addEventListener('click', async () => {
    hideModal('duelRematchWaitingModal');
    if (duelState) {
        try {
            await duelDocRef(duelState.roomCode).update({ rematch: null });
        } catch (e) {
            // room mungkin sudah berubah/hilang, aman diabaikan
        }
    }
    await waitForModalHidden('duelRematchWaitingModal');
    showModal('duelResultModal');
});

document.getElementById('duelRematchAcceptButton').addEventListener('click', async () => {
    if (!duelState) return;
    hideModal('duelRematchRequestModal');

    const newQuestions = generateUniqueQuestions(duelState.count);
    duelState.questions = newQuestions;

    try {
        await duelDocRef(duelState.roomCode).update({
            questions: questionsToFirestoreArray(newQuestions),
            status: 'countdown',
            startAtMillis: Date.now() + DUEL_START_BUFFER_MS,
            winner: null,
            rematch: null,
            'host.progress': 0, 'host.mistakes': 0, 'host.time': null, 'host.finishedAt': null, 'host.lastSeen': Date.now(),
            'guest.progress': 0, 'guest.mistakes': 0, 'guest.time': null, 'guest.finishedAt': null, 'guest.lastSeen': Date.now()
        });
    } catch (e) {
        showToast('danger', `Gagal memulai ulang duel: ${e.code || e.message}`, 5000);
    }
});

document.getElementById('duelRematchDeclineButton').addEventListener('click', async () => {
    if (!duelState) return;
    hideModal('duelRematchRequestModal');
    await waitForModalHidden('duelRematchRequestModal');
    showModal('duelResultModal');

    const requesterRole = duelState.role === 'host' ? 'guest' : 'host';
    try {
        await duelDocRef(duelState.roomCode).update({
            rematch: { requestedBy: requesterRole, status: 'declined', updatedAt: Date.now() }
        });
    } catch (e) {
        // room mungkin sudah berubah/hilang, aman diabaikan
    }
});

document.getElementById('duelResultDashboardButton').addEventListener('click', () => {
    hideModal('duelResultModal');
    cleanupDuel();
    goToDashboard();
});

/* ---- Deteksi lawan terputus (heartbeat) ---- */
function startDuelHeartbeat() {
    stopDuelHeartbeat();
    duelHeartbeatInterval = setInterval(() => {
        if (!duelState) return;
        duelDocRef(duelState.roomCode).update({
            [`${duelState.role}.lastSeen`]: Date.now()
        }).catch(() => {});
    }, DUEL_HEARTBEAT_INTERVAL_MS);
}

function stopDuelHeartbeat() {
    if (duelHeartbeatInterval) {
        clearInterval(duelHeartbeatInterval);
        duelHeartbeatInterval = null;
    }
}

function checkDuelOpponentHeartbeat(opponent, status) {
    const banner = document.getElementById('duelDisconnectBanner');
    if (!banner) return;
    if (!opponent || status === 'finished' || status === 'waiting') {
        banner.style.display = 'none';
        return;
    }
    const stale = opponent.lastSeen && (Date.now() - opponent.lastSeen > DUEL_HEARTBEAT_TIMEOUT_MS);
    banner.style.display = stale ? 'flex' : 'none';
}

document.getElementById('duelLeaveDisconnectedButton').addEventListener('click', async () => {
    await abandonDuel();
    goToDashboard();
});

/* ---- Keluar dari duel ---- */
async function abandonDuel() {
    if (!duelState) return;
    try {
        await duelDocRef(duelState.roomCode).update({ status: 'abandoned' });
    } catch (e) {
        // room mungkin sudah tidak ada / sudah selesai duluan, aman diabaikan
    }
    cleanupDuel();
}

function cleanupDuel() {
    if (duelState && typeof duelState.unsubscribe === 'function') {
        duelState.unsubscribe();
    }
    stopDuelHeartbeat();
    const oppBar = document.getElementById('duelOpponentBar');
    const banner = document.getElementById('duelDisconnectBanner');
    if (oppBar) oppBar.style.display = 'none';
    if (banner) banner.style.display = 'none';
    duelState = null;
}

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
    const set = new Set(KNOWLEDGE_QUESTIONS.map(q => q.category));
    return Array.from(set).sort((a, b) => a - b);
}

function generateKnowledgeSequence(count) {
    const categories = getKnowledgeCategories();
    const byCategory = {};
    categories.forEach(c => { byCategory[c] = KNOWLEDGE_QUESTIONS.filter(q => q.category === c); });

    // Reset riwayat soal yang sudah pernah keluar kalau sisa pool sudah hampir habis,
    // supaya tidak pernah terjebak (sama seperti pola di game Perkalian)
    if (knowledgeUsedQuestionIds.length >= KNOWLEDGE_QUESTIONS.length - count) {
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
    knowledgeBurnedCount = 0;
    knowledgeHintsUsed = 0;
    knowledgeSeqIndex = 0;

    document.getElementById('knowledgeTimer').textContent = '01:00';
    document.getElementById('knowledgeTimerBarFill').style.width = '100%';
    document.getElementById('knowledgeTimerBarFill').style.backgroundColor = '';
    document.getElementById('knowledgeProgressLabel').textContent = 'Skor: 0,0';
    document.getElementById('knowledgeQuestionText').textContent = '';
    document.querySelectorAll('.knowledge-option-btn').forEach(btn => {
        btn.disabled = true;
        btn.textContent = '';
        btn.className = 'knowledge-option-btn';
        btn.style.display = 'flex';
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
        btn.textContent = q.options[i];
        btn.disabled = false;
        btn.className = 'knowledge-option-btn';
        btn.style.display = 'flex';
    });
    document.getElementById('knowledgeHintButton').disabled = false;
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

    const q = knowledgeSequence[knowledgeSeqIndex];

    if (idx === q.correctIndex) {
        btn.classList.add('is-correct');
        playCorrectSound();
        const gained = knowledgePointsForCorrect(knowledgeWrongClicksThisQuestion, knowledgeHintUsedThisQuestion);
        knowledgeScoreTenths += gained;
        knowledgeCorrectCount++;
        showToast('success', `Benar! ${formatKnowledgeGain(gained)} poin 🎉`);
        document.getElementById('knowledgeProgressLabel').textContent = `Skor: ${formatKnowledgeScore(tenthsToScore(knowledgeScoreTenths))}`;
        btns.forEach(b => { b.disabled = true; });
        if (knowledgeDuelState) reportKnowledgeDuelProgress();
        setTimeout(advanceKnowledgeQuestion, 450);
        return;
    }

    btn.disabled = true;
    btn.classList.add('is-wrong');
    playWrongSound();
    knowledgeWrongClicksThisQuestion++;

    const visibleCount = btns.filter(b => b.style.display !== 'none').length;
    if (knowledgeWrongClicksThisQuestion >= visibleCount - 1) {
        // Sisa tinggal jawaban benar -> langsung hangus, jangan beri kesempatan asal tebak
        knowledgeBurnedCount++;
        knowledgeScoreTenths += KNOWLEDGE_POINTS_BURNED;
        showToast('danger', `Soal hangus! ${formatKnowledgeGain(KNOWLEDGE_POINTS_BURNED)} poin 💀`, 1800);
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
    if (knowledgeHintUsedThisQuestion || !knowledgeGameInProgress) return;
    const q = knowledgeSequence[knowledgeSeqIndex];
    const btns = Array.from(document.querySelectorAll('.knowledge-option-btn'));

    const viableDistractorIdx = btns
        .map((b, i) => i)
        .filter(i => i !== q.correctIndex && !btns[i].disabled && btns[i].style.display !== 'none');

    if (viableDistractorIdx.length === 0) return; // sudah tersisa 1 opsi (benar) saja, hint tak relevan lagi

    knowledgeHintUsedThisQuestion = true;
    knowledgeHintsUsed++;
    document.getElementById('knowledgeHintButton').disabled = true;

    // Sembunyikan opsi salah yg sudah ketahuan (sudah dicoba & disabled) biar tidak mengotori tampilan
    btns.forEach((b, i) => {
        if (i !== q.correctIndex && b.disabled) b.style.display = 'none';
    });

    // Dari distraktor yang masih "hidup", sisakan 1 secara acak, sembunyikan sisanya
    const keepIndex = viableDistractorIdx[Math.floor(Math.random() * viableDistractorIdx.length)];
    viableDistractorIdx.forEach(i => {
        if (i !== keepIndex) btns[i].style.display = 'none';
    });

    showToast('success', '💡 Hint dipakai! Tersisa 2 opsi (maks. +0,3 poin).');
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
        showToast('success', 'Benar! 🎉');
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
        showToast('danger', `Salah ke-${advmathQ.wrong}! +${penalty} detik · Soal hangus 💀`, 2200);
        burnAdvmathQuestion();
    } else {
        showToast('danger', `Salah ke-${advmathQ.wrong}! +${penalty} detik ⏱️`, 1800);
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
            showToast('danger', `Hint ${level} sudah kedaluwarsa 🔥`);
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
        showToast('danger', `Hint 3: +${cfg.penalty} detik · Soal hangus 🔥`, 2200);
        burnAdvmathQuestion(); // memakai countdown Hint 3 (sedang ditampilkan) sebagai acuan waktu tunggu
    } else {
        showToast('success', `💡 Hint ${level} dibuka: +${cfg.penalty} detik`, 1600);
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

/* =====================================================================
   INISIALISASI
===================================================================== */
buildAvatarPicker('avatarPicker', (avatar) => { selectedAvatar = avatar; });


/* Panel "Aturan Skor": terbuka otomatis saat pertama kali, lalu mengingat pilihan pemain (boleh dilipat) */
(function initKnowledgeScoreRules() {
    const details = document.getElementById('knowledgeScoreRules');
    if (!details) return;
    if (safeGetLocalStorage('knowledgeRulesCollapsed', 'false') === 'true') details.open = false;
    details.addEventListener('toggle', () => {
        safeSetLocalStorage('knowledgeRulesCollapsed', details.open ? 'false' : 'true');
    });
})();

/* Panel "Aturan Skor": terbuka otomatis saat pertama kali, lalu mengingat pilihan pemain (boleh dilipat) */
(function initAdvmathScoreRules() {
    const details = document.getElementById('advmathScoreRules');
    if (!details) return;
    if (safeGetLocalStorage('advmathRulesCollapsed', 'false') === 'true') details.open = false;
    details.addEventListener('toggle', () => {
        safeSetLocalStorage('advmathRulesCollapsed', details.open ? 'false' : 'true');
    });
})();
