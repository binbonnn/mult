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

/* =====================================================================
   REFERENSI DOM (diambil sekali di awal)
===================================================================== */
const dashboardView = document.getElementById('dashboardView');
const gameView = document.getElementById('gameView');
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

// Indikator status di bawah papan peringkat, supaya jelas skor disimpan di mana
function setLeaderboardStatus(mode, detail) {
    const el = document.getElementById('leaderboardStatus');
    if (!el) return;
    el.className = `leaderboard-status is-${mode}`;
    if (mode === 'online') {
        el.textContent = '🌐 Papan peringkat online: dilihat semua pemain';
    } else if (mode === 'local') {
        el.textContent = `📴 Mode lokal: skor hanya tersimpan di perangkat ini${detail ? ` (${detail})` : ''}`;
    } else {
        el.textContent = `⚠️ Gagal terhubung ke server${detail ? ` (${detail})` : ''}. Memakai data lokal.`;
    }
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

function updateSoundToggleButton() {
    const btn = document.getElementById('soundToggleButton');
    if (!btn) return;
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    btn.setAttribute('aria-label', soundEnabled ? 'Matikan suara' : 'Aktifkan suara');
}

document.getElementById('soundToggleButton').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    safeSetLocalStorage('soundEnabled', soundEnabled ? 'true' : 'false');
    updateSoundToggleButton();
    if (soundEnabled) {
        getAudioContext(); // "bangunkan" audio context selagi ada interaksi user
        playTone({ freq: 660, duration: 0.1, type: 'sine', volume: 0.18 });
    }
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
   VIEW SWITCHING (Dashboard <-> Game)
===================================================================== */
function switchView(viewName) {
    dashboardView.classList.toggle('active', viewName === 'dashboard');
    gameView.classList.toggle('active', viewName === 'game');
}

function goToDashboard(focusCount) {
    countdownRunToken++; // batalkan countdown yang mungkin masih berjalan
    document.getElementById('countdownOverlay').classList.remove('is-visible');
    setActiveLeaderboardTab(focusCount || activeLeaderboardCount);
    switchView('dashboard');
}

/* =====================================================================
   DASHBOARD: TAB PAPAN PERINGKAT (podium ala gambar referensi)
===================================================================== */
function setActiveLeaderboardTab(count) {
    activeLeaderboardCount = count;
    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
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

document.querySelectorAll('.leaderboard-tab').forEach(tab => {
    tab.addEventListener('click', () => setActiveLeaderboardTab(parseInt(tab.dataset.count, 10)));
});

/* =====================================================================
   AVATAR PICKER (dipakai saat menyimpan skor)
===================================================================== */
function buildAvatarPicker() {
    const picker = document.getElementById('avatarPicker');
    const noProfileButton = `<button type="button" class="avatar-option is-selected" data-avatar="" aria-label="Tanpa foto profil">👤</button>`;
    const optionButtons = AVATAR_OPTIONS.map(avatar =>
        `<button type="button" class="avatar-option" data-avatar="${avatar}" aria-label="Avatar ${avatar}">${avatar}</button>`
    ).join('');

    picker.innerHTML = noProfileButton + optionButtons;

    picker.querySelectorAll('.avatar-option').forEach(btn => {
        btn.addEventListener('click', () => {
            picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            selectedAvatar = btn.dataset.avatar || null;
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

document.querySelectorAll('.count-option-button').forEach(btn => {
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
            endGame();
        } else {
            displayQuestion();
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
document.getElementById('saveScoreButton').addEventListener('click', () => {
    hideModal('endGameModal');
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
    if (gameInProgress) {
        showModal('confirmExitModal');
    } else {
        goToDashboard();
    }
});

document.getElementById('confirmExitYesButton').addEventListener('click', () => {
    hideModal('confirmExitModal');
    stopStopwatch();
    gameInProgress = false;
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
   INISIALISASI
===================================================================== */
buildAvatarPicker();
setActiveLeaderboardTab(activeLeaderboardCount);
