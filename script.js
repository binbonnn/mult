/* =====================================================================
   KONSTANTA & STATE
===================================================================== */
const QUESTION_COUNT_OPTIONS = [10, 20, 30];
const WARNING_TIME_SECONDS = 180; // 3 menit sebelum stopwatch full merah
const MAX_LEADERBOARD_RECORDS = 10;
const AVATAR_OPTIONS = ['😀', '😎', '🥳', '🤠', '🐱', '🐶', '🦊', '🐼', '🦁', '🐸', '🐵', '🤖'];

let currentQuestionCount = QUESTION_COUNT_OPTIONS[1]; // default 20 soal saat main
let currentQuestionIndex = 0;
let correctAnswers = 0;
let startTime;
let stopwatchInterval;
let elapsedTime = 0; // dalam detik
let mistakes = 0;
let previousQuestions = [];
let questions = [];
let gameInProgress = false;

let activeLeaderboardCount = QUESTION_COUNT_OPTIONS[0]; // tab papan peringkat yang sedang dilihat
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
    return `playerRecords_${count}`;
}

// Mencegah XSS: teks dari input pengguna tidak boleh langsung masuk ke innerHTML
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function generateRandomNumber(max) {
    return Math.floor(Math.random() * max) + 1;
}

function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function avatarGlyph(avatar) {
    return avatar ? avatar : '👤';
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
function getRecordsForCount(count) {
    try {
        return JSON.parse(safeGetLocalStorage(getRecordsKey(count), '[]'));
    } catch (e) {
        return [];
    }
}

function setActiveLeaderboardTab(count) {
    activeLeaderboardCount = count;
    document.querySelectorAll('.leaderboard-tab').forEach(tab => {
        tab.classList.toggle('is-active', parseInt(tab.dataset.count, 10) === count);
    });
    renderLeaderboardPanel(count);
}

function renderLeaderboardPanel(count) {
    const records = getRecordsForCount(count);
    renderPodium(records);
    renderRankList(records);
}

function renderPodium(records) {
    const podiumEl = document.getElementById('podium');
    const displayOrder = [1, 0, 2]; // tampil dari kiri ke kanan: peringkat 2, 1, 3

    podiumEl.innerHTML = displayOrder.map(rankIndex => {
        const place = rankIndex + 1;
        const spotClass = place === 1 ? 'podium-first' : place === 2 ? 'podium-second' : 'podium-third';
        const record = records[rankIndex];

        if (!record) {
            return `
                <div class="podium-spot ${spotClass} is-empty">
                    <div class="podium-avatar-wrap">
                        <div class="podium-avatar">👤</div>
                        <span class="podium-rank-badge">${place}</span>
                    </div>
                    <div class="podium-name">—</div>
                    <div class="podium-score">--:--</div>
                </div>
            `;
        }

        return `
            <div class="podium-spot ${spotClass}">
                ${place === 1 ? '<div class="podium-crown">👑</div>' : ''}
                <div class="podium-avatar-wrap">
                    <div class="podium-avatar">${avatarGlyph(record.avatar)}</div>
                    <span class="podium-rank-badge">${place}</span>
                </div>
                <div class="podium-name">${escapeHtml(record.name)}</div>
                <div class="podium-score">${formatTime(record.time)}</div>
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

    const rest = records.slice(3);
    if (rest.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = rest.map((record, i) => {
        const rank = i + 4;
        const mistakesText = record.mistakes === 0 ? 'Sempurna' : `${record.mistakes} salah`;
        return `
            <li class="rank-list-row">
                <span class="rank-list-position">${rank}</span>
                <span class="rank-list-avatar">${avatarGlyph(record.avatar)}</span>
                <span class="rank-list-name">${escapeHtml(record.name)}</span>
                <span class="rank-list-dots" aria-hidden="true"></span>
                <span class="rank-list-score">${formatTime(record.time)}<small>${mistakesText}</small></span>
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
    new bootstrap.Modal(document.getElementById('helpModal')).show();
});

document.getElementById('openStartModalButton').addEventListener('click', () => {
    new bootstrap.Modal(document.getElementById('chooseCountModal')).show();
});

document.querySelectorAll('.count-option-button').forEach(btn => {
    btn.addEventListener('click', () => {
        const count = parseInt(btn.dataset.count, 10);
        bootstrap.Modal.getInstance(document.getElementById('chooseCountModal'))?.hide();
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
    const fillMultiplicationData = (parentElementId) => {
        const parentElement = document.getElementById(parentElementId);
        parentElement.innerHTML = ''; // bersihkan konten sebelumnya

        for (let i = 1; i <= 10; i++) {
            const col = document.createElement('div');
            col.className = 'col-6 col-md';

            let multiplicationData = '';
            for (let j = 1; j <= 10; j++) {
                multiplicationData += `${i} x ${j} = ${i * j}<br>`;
            }

            col.innerHTML = multiplicationData;
            parentElement.appendChild(col);
        }
    };

    fillMultiplicationData('multiplicationRow');
    new bootstrap.Modal(document.getElementById('hintModal')).show();
});

function checkAnswer() {
    if (!answerInput.value.trim()) { // jika input kosong
        new bootstrap.Modal(document.getElementById('emptyInputModal')).show();
        return;
    }

    const userAnswer = parseInt(answerInput.value, 10);
    const [a, b] = questions[currentQuestionIndex];

    if (userAnswer !== a * b) {
        mistakes++;
        showToast('danger', 'Salah! 😅');
        answerInput.classList.add('wiggle-animation');
        answerInput.value = '';
        setTimeout(() => answerInput.classList.remove('wiggle-animation'), 400);
    } else {
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

function endGame() {
    gameInProgress = false;
    stopStopwatch();
    updateProgress();

    const endTime = new Date().getTime();
    const timeTaken = Math.round((endTime - startTime) / 1000);

    const currentBackgroundColor = document.getElementById('stopwatch').style.backgroundColor;
    safeSetLocalStorage('lastGameBackgroundColor', currentBackgroundColor);

    document.getElementById('finalTime').textContent = formatTime(timeTaken);
    document.getElementById('mistakesCount').textContent = mistakes.toString();

    // Nonaktifkan keypad
    answerInput.disabled = true;
    document.querySelectorAll('.buttonKeypad, .buttonDelete, .buttonStart').forEach(btn => {
        btn.disabled = true;
    });
    document.getElementById('question').innerText = '';
    document.getElementById('buttonHint').style.display = 'none';

    const playerRecords = getRecordsForCount(currentQuestionCount);
    const saveScoreButton = document.getElementById('saveScoreButton');
    const timeDifferenceInfo = document.getElementById('timeDifferenceInfo');
    const worstRecord = playerRecords[MAX_LEADERBOARD_RECORDS - 1];

    // Jika papan peringkat sudah penuh dan waktu pemain lebih lambat/sama dengan
    // rekor terbawah, tidak perlu menawarkan simpan skor (pasti akan terpotong).
    if (playerRecords.length >= MAX_LEADERBOARD_RECORDS && timeTaken >= worstRecord.time) {
        const timeDifference = timeTaken - worstRecord.time;
        const timeDifferenceElement = document.getElementById('timeDifference');
        if (timeTaken > worstRecord.time) {
            timeDifferenceElement.textContent = `Waktumu ${timeDifference} detik lebih lambat dari peringkat terbawah.`;
        } else {
            timeDifferenceElement.textContent = `Waktumu sama dengan peringkat terbawah :( Coba lebih cepat lagi ya.`;
        }
        timeDifferenceInfo.style.display = 'block';
        saveScoreButton.style.display = 'none';
    } else {
        timeDifferenceInfo.style.display = 'none';
        saveScoreButton.style.display = 'inline-block';
    }

    new bootstrap.Modal(document.getElementById('endGameModal')).show();
}

/* =====================================================================
   SIMPAN SKOR
===================================================================== */
document.getElementById('saveScoreButton').addEventListener('click', () => {
    bootstrap.Modal.getInstance(document.getElementById('endGameModal'))?.hide();
    new bootstrap.Modal(document.getElementById('saveRecordModal')).show();
});

document.getElementById('buttonSavePlayerRecord').addEventListener('click', savePlayerRecord);

function savePlayerRecord() {
    const playerNameInput = document.getElementById('playerName');
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
        alert('Isi dulu namamu ya!');
        return;
    }

    const key = getRecordsKey(currentQuestionCount);
    let playerRecords = getRecordsForCount(currentQuestionCount);
    const savedBackgroundColor = safeGetLocalStorage('lastGameBackgroundColor');

    playerRecords.push({
        name: playerName,
        time: elapsedTime,
        mistakes: mistakes,
        avatar: selectedAvatar,
        bgColor: savedBackgroundColor
    });

    playerRecords.sort((a, b) => {
        if (a.time === b.time) {
            return a.mistakes - b.mistakes;
        }
        return a.time - b.time;
    });

    playerRecords = playerRecords.slice(0, MAX_LEADERBOARD_RECORDS);
    safeSetLocalStorage(key, JSON.stringify(playerRecords));

    bootstrap.Modal.getInstance(document.getElementById('saveRecordModal'))?.hide();
    playerNameInput.value = '';

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
        new bootstrap.Modal(document.getElementById('confirmExitModal')).show();
    } else {
        goToDashboard();
    }
});

document.getElementById('confirmExitYesButton').addEventListener('click', () => {
    bootstrap.Modal.getInstance(document.getElementById('confirmExitModal'))?.hide();
    stopStopwatch();
    gameInProgress = false;
    goToDashboard();
});

document.getElementById('playAgainButton').addEventListener('click', () => {
    bootstrap.Modal.getInstance(document.getElementById('endGameModal'))?.hide();
    startGameWithCount(currentQuestionCount);
});

document.getElementById('endGameBackToDashboardButton').addEventListener('click', () => {
    bootstrap.Modal.getInstance(document.getElementById('endGameModal'))?.hide();
    goToDashboard(currentQuestionCount);
});

/* =====================================================================
   STOPWATCH
===================================================================== */
function startStopwatch() {
    clearInterval(stopwatchInterval);
    stopwatchInterval = setInterval(() => {
        elapsedTime++;
        document.getElementById('stopwatch').textContent = formatTime(elapsedTime);
        if (elapsedTime >= WARNING_TIME_SECONDS) {
            document.getElementById('stopwatch').style.backgroundColor = '#dc3545';
        } else {
            const opacity = elapsedTime / WARNING_TIME_SECONDS;
            document.getElementById('stopwatch').style.backgroundColor = `rgba(255, 0, 0, ${opacity})`;
        }
    }, 1000);
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
function showToast(type, message) {
    const toast = document.createElement('div');
    toast.className = `toast-alert toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1400);
}

/* =====================================================================
   INISIALISASI
===================================================================== */
buildAvatarPicker();
setActiveLeaderboardTab(activeLeaderboardCount);