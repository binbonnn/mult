/* =====================================================================
   MEMO MAYHEM: COSMIC RECALL — INTI LOGIKA (tanpa DOM)
   Berisi: RNG berbenih, data, generator tantangan (6 mode), validator,
   solver (untuk pengujian otomatis) dan rumus skor.
   Dipakai oleh memo.js (browser) dan tes Node (require).
===================================================================== */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MemoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ---------- RNG berbenih (mulberry32) ---------- */
    function hashSeed(str) {
        let h = 2166136261;
        str = String(str);
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }
    function makeRng(seed) {
        let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
        const f = () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        f.int = n => Math.floor(f() * n);
        f.range = (lo, hi) => lo + f.int(hi - lo + 1);
        f.pick = arr => arr[f.int(arr.length)];
        f.chance = p => f() < p;
        f.shuffle = arr => { const x = arr.slice(); for (let i = x.length - 1; i > 0; i--) { const j = f.int(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
        return f;
    }

    /* ---------- Data dasar ---------- */
    const DIFFS = ['easy', 'normal', 'hard', 'expert'];
    const DIFF_INFO = {
        easy: { label: 'Easy', tag: 'Learn the Pattern', mult: 1.0, idx: 0 },
        normal: { label: 'Normal', tag: 'Stay Focused', mult: 1.5, idx: 1 },
        hard: { label: 'Hard', tag: 'Think Under Pressure', mult: 2.0, idx: 2 },
        expert: { label: 'Expert', tag: 'Memory Overload', mult: 2.5, idx: 3 }
    };
    const MODES = ['snapshot', 'sequence', 'glitch', 'copycat', 'echo', 'mindtrap'];
    const MODE_INFO = {
        snapshot: { name: 'SNAPSHOT', sub: 'Visual Recall', icon: '📸', desc: 'Ingat objek, warna, dan posisinya di sebuah adegan.' },
        sequence: { name: 'SEQUENCE BREAKER', sub: 'Sequence Recall', icon: '🔢', desc: 'Ingat dan ulangi urutan simbol atau angka.' },
        glitch: { name: 'GLITCH HUNTER', sub: 'Change Detection', icon: '🔍', desc: 'Temukan sel yang berubah setelah adegan diganggu.' },
        copycat: { name: 'COPYCAT CHAOS', sub: 'Action Memory', icon: '🐙', desc: 'Tiru urutan aksi yang diperagakan Mimo.' },
        echo: { name: 'ECHO CHAMBER', sub: 'Audio Memory', icon: '🎵', desc: 'Ingat urutan nada, warna bunyi, atau pola ritme.' },
        mindtrap: { name: 'MIND TRAP', sub: 'Memory & Reasoning', icon: '🧩', desc: 'Ingat data awak stasiun, lalu nalar jawaban yang tepat.' }
    };
    const MODIFIERS = {
        reverse: { name: 'Reverse Order', icon: '↩️', desc: 'Masukkan urutan secara TERBALIK.' },
        doubleRecall: { name: 'Double Recall', icon: '🧮', desc: 'Selesaikan hitungan singkat dulu, baru jawab.' },
        distraction: { name: 'Distraction Field', icon: '🌠', desc: 'Ada bintang pengganggu di tepi layar saat mengamati.' },
        falseFamiliarity: { name: 'False Familiarity', icon: '🪞', desc: 'Pilihan salah dibuat sangat mirip (beda satu detail).' },
        interference: { name: 'Memory Interference', icon: '📡', desc: 'Sinyal asing muncul sebelum menjawab. Abaikan!' }
    };

    const SHAPES = [
        { id: 'circle', g: '●', n: 'Bulat' }, { id: 'square', g: '■', n: 'Kotak' }, { id: 'triangle', g: '▲', n: 'Segitiga' },
        { id: 'diamond', g: '◆', n: 'Berlian' }, { id: 'star', g: '★', n: 'Bintang' }, { id: 'hex', g: '⬢', n: 'Segi enam' },
        { id: 'cross', g: '✚', n: 'Plus' }
    ];
    const COLORS = [
        { id: 'red', n: 'Merah', hex: '#ff5d6c' }, { id: 'blue', n: 'Biru', hex: '#4da3ff' }, { id: 'green', n: 'Hijau', hex: '#4ade80' },
        { id: 'yellow', n: 'Kuning', hex: '#ffd166' }, { id: 'purple', n: 'Ungu', hex: '#c084fc' }, { id: 'orange', n: 'Oranye', hex: '#ff9f43' }
    ];
    const shapeById = id => SHAPES.find(s => s.id === id);
    const colorById = id => COLORS.find(c => c.id === id);
    const objKey = o => o.shape + ':' + o.color;
    const objName = o => shapeById(o.shape).n + ' ' + colorById(o.color).n;

    const SEQ_SYMS = [
        { id: 'rocket', g: '🚀', n: 'Roket' }, { id: 'moon', g: '🌙', n: 'Bulan' }, { id: 'star2', g: '⭐', n: 'Bintang' },
        { id: 'planet', g: '🪐', n: 'Planet' }, { id: 'comet', g: '☄️', n: 'Komet' }, { id: 'ufo', g: '🛸', n: 'UFO' },
        { id: 'alien', g: '👽', n: 'Alien' }, { id: 'sat', g: '🛰️', n: 'Satelit' }
    ];
    const DIGITS = Array.from({ length: 10 }, (_, i) => ({ id: 'd' + i, g: String(i), n: String(i) }));

    const ACTIONS = [
        { id: 'jump', g: '⬆️', n: 'Lompat' }, { id: 'duck', g: '⬇️', n: 'Jongkok' }, { id: 'waveL', g: '👈', n: 'Lambai kiri' },
        { id: 'waveR', g: '👉', n: 'Lambai kanan' }, { id: 'clap', g: '👏', n: 'Tepuk' }, { id: 'wink', g: '😉', n: 'Kedip' },
        { id: 'spin', g: '🔄', n: 'Berputar' }, { id: 'shrug', g: '🤷', n: 'Angkat bahu' }
    ];
    const MIRROR = { jump: 'duck', duck: 'jump', waveL: 'waveR', waveR: 'waveL', clap: 'wink', wink: 'clap', spin: 'shrug', shrug: 'spin' };
    const MIRROR_PAIRS = [['jump', 'duck'], ['waveL', 'waveR'], ['clap', 'wink'], ['spin', 'shrug']];

    // Pad Echo Chamber: nada (Hz) dan "timbre" (gelombang)
    const ECHO_PADS = [
        { id: 'p0', g: '🔴', n: 'Do', freq: 261.63, wave: 'sine', color: '#ff5d6c' },
        { id: 'p1', g: '🟠', n: 'Re', freq: 293.66, wave: 'sine', color: '#ff9f43' },
        { id: 'p2', g: '🟡', n: 'Mi', freq: 329.63, wave: 'sine', color: '#ffd166' },
        { id: 'p3', g: '🟢', n: 'Sol', freq: 392.0, wave: 'sine', color: '#4ade80' },
        { id: 'p4', g: '🔵', n: 'La', freq: 440.0, wave: 'sine', color: '#4da3ff' },
        { id: 'p5', g: '🟣', n: 'Si', freq: 523.25, wave: 'sine', color: '#c084fc' }
    ];
    const ECHO_TIMBRES = [
        { id: 't0', g: '〰️', n: 'Halus', freq: 330, wave: 'sine', color: '#4ade80' },
        { id: 't1', g: '🔲', n: 'Kotak', freq: 330, wave: 'square', color: '#ff5d6c' },
        { id: 't2', g: '🪚', n: 'Gergaji', freq: 330, wave: 'sawtooth', color: '#ffd166' },
        { id: 't3', g: '🔺', n: 'Segitiga', freq: 330, wave: 'triangle', color: '#4da3ff' }
    ];

    const NAMES = ['Zara', 'Bimo', 'Nila', 'Rafi', 'Sari', 'Dito', 'Luna', 'Kai'];
    const ITEMS = [
        { id: 'key', g: '🔑', n: 'Kunci', cls: 'alat' }, { id: 'torch', g: '🔦', n: 'Senter', cls: 'alat' },
        { id: 'sample', g: '🧪', n: 'Sampel', cls: 'sains' }, { id: 'antenna', g: '📡', n: 'Antena', cls: 'sains' },
        { id: 'wrench', g: '🔧', n: 'Kunci Inggris', cls: 'alat' }, { id: 'magnet', g: '🧲', n: 'Magnet', cls: 'sains' }
    ];

    /* ---------- Parameter kesulitan (indeks: easy, normal, hard, expert) ---------- */
    const P = {
        snapshot: {
            cols: [3, 4, 4, 5], rows: [3, 3, 4, 4], n: [3, 4, 6, 8],
            observeMs: [6000, 5500, 5000, 4800], recallMs: [20000, 18000, 16000, 15000],
            kinds: [['position', 'colorOf', 'count'], ['position', 'colorOf', 'count', 'present', 'rowcol'],
                ['position', 'count', 'present', 'rowcol', 'rightof'], ['rowcol', 'present', 'rightof', 'count', 'position']],
            lookalike: [false, false, true, true]
        },
        sequence: {
            poolN: [4, 5, 6, 8], len: [[3, 4], [4, 5], [5, 6], [6, 8]], step: [900, 800, 700, 600],
            recallBase: [14000, 14000, 15000, 16000], recallPer: [2500, 2500, 2600, 2800],
            kinds: [['repeat'], ['repeat', 'reverse', 'continue', 'missing'],
                ['repeat', 'reverse', 'continue', 'missing', 'arith', 'transform'], ['repeat', 'reverse', 'continue', 'arith', 'transform', 'missing']]
        },
        glitch: {
            cols: [3, 4, 4, 5], rows: [3, 3, 4, 4], n: [3, 5, 8, 11], k: [1, 1, 2, 3],
            observeMs: [6000, 6000, 6000, 6500], recallMs: [20000, 20000, 20000, 22000],
            kinds: [['changes'], ['changes'], ['changes'], ['changes']],
            types: [['add', 'remove', 'recolor'], ['add', 'remove', 'recolor', 'move', 'reshape'],
                ['add', 'remove', 'recolor', 'move', 'reshape', 'swap'], ['add', 'remove', 'recolor', 'move', 'reshape', 'swap']]
        },
        copycat: {
            poolN: [4, 5, 6, 8], len: [[3, 3], [3, 4], [4, 6], [6, 8]], step: [1000, 900, 800, 700],
            recallBase: [14000, 14000, 15000, 16000], recallPer: [2500, 2500, 2600, 2800],
            delay: [0, 0, 3500, 5000],
            kinds: [['repeat'], ['repeat', 'mirror', 'variant'], ['repeat', 'mirror', 'variant', 'delayed', 'reverse'],
                ['repeat', 'mirror', 'variant', 'delayed', 'reverse']]
        },
        echo: {
            pads: [4, 4, 5, 6], len: [[3, 4], [4, 5], [5, 6], [6, 7]], step: [800, 700, 600, 520],
            recallBase: [14000, 14000, 15000, 16000], recallPer: [2500, 2500, 2600, 2800],
            beats: [3, 4, 5, 6], tolerance: [0.45, 0.4, 0.35, 0.3],
            kinds: [['tones', 'rhythm'], ['tones', 'timbre', 'rhythm'], ['tones', 'timbre', 'rhythm'], ['tones', 'timbre', 'rhythm']]
        },
        mindtrap: {
            crew: [3, 4, 5, 6], observeMs: [8000, 10000, 12000, 14000], updateMs: [0, 0, 4000, 4500],
            recallMs: [22000, 24000, 26000, 28000],
            kinds: [['who', 'attrItem'], ['who', 'attrItem', 'room', 'statement'],
                ['who', 'attrItem', 'room', 'statement', 'count', 'only', 'update'], ['who', 'statement', 'count', 'only', 'update', 'room']]
        }
    };

    const KIND_TITLES = {
        position: 'Posisi Objek', colorOf: 'Warna Objek', count: 'Hitung Objek', present: 'Objek yang Muncul', rowcol: 'Isi Sel', rightof: 'Hubungan Spasial',
        repeat: 'Ulangi Urutan', reverse: 'Urutan Terbalik', continue: 'Lanjutkan Pola', missing: 'Elemen Hilang', arith: 'Pola Hitung', transform: 'Transformasi',
        changes: 'Deteksi Perubahan',
        mirror: 'Aturan Cermin', variant: 'Tayangan Berbeda', delayed: 'Ingat Setelah Jeda',
        tones: 'Urutan Nada', timbre: 'Warna Bunyi', rhythm: 'Pola Ritme',
        who: 'Siapa Itu?', attrItem: 'Barang Bawaan', room: 'Lokasi Lab', statement: 'Pernyataan Benar', count2: 'Hitung Kondisi', only: 'Satu-satunya', update: 'Data Berubah'
    };

    /* ---------- Util pilihan ganda ---------- */
    function buildChoice(r, correct, distractors) {
        const seen = new Set([correct.key]);
        const ds = [];
        for (const d of distractors) { if (!seen.has(d.key)) { seen.add(d.key); ds.push(d); } }
        const opts = r.shuffle([Object.assign({}, correct, { _c: 1 })].concat(ds.map(d => Object.assign({}, d))));
        const answer = opts.findIndex(o => o._c);
        opts.forEach(o => { delete o._c; });
        return { options: opts, answer };
    }
    const optObj = (o, reason) => ({ t: 'obj', shape: o.shape, color: o.color, key: objKey(o), label: objName(o), reason });
    const optColor = (cid, reason) => ({ t: 'color', color: cid, key: 'c:' + cid, label: colorById(cid).n, reason });
    const optNum = (n, reason) => ({ t: 'num', n, key: 'n:' + n, label: String(n), reason });
    const optText = (text, key, reason) => ({ t: 'text', text, key: key || text, label: text, reason });
    const optItem = (it, reason) => ({ t: 'text', text: it.g + ' ' + it.n, key: 'i:' + it.id, label: it.n, reason });

    function variantsOf(o, r) {
        const out = [];
        SHAPES.forEach(s => { if (s.id !== o.shape) out.push({ shape: s.id, color: o.color }); });
        COLORS.forEach(c => { if (c.id !== o.color) out.push({ shape: o.shape, color: c.id }); });
        return r.shuffle(out);
    }
    function randomObj(r, shapePool, colorPool) { return { shape: r.pick(shapePool).id, color: r.pick(colorPool).id }; }

    /* ---------- Parameter waktu ---------- */
    const seqRecallMs = (p, i, len) => p.recallBase[i] + p.recallPer[i] * len;

    /* =====================================================================
       GENERATOR: SNAPSHOT
    ===================================================================== */
    function genSnapshot(r, di, kind, mods) {
        const p = P.snapshot, cols = p.cols[di], rows = p.rows[di], total = cols * rows;
        const n = p.n[di];
        const look = p.lookalike[di] || mods.includes('falseFamiliarity');
        const shapePool = look ? r.shuffle(SHAPES.slice()).slice(0, 4) : SHAPES;
        const colorPool = look ? r.shuffle(COLORS.slice()).slice(0, 4) : COLORS;
        const items = [];
        const keys = new Set();
        const usedCells = new Set();
        const addItem = cell => {
            let o, guard = 0;
            do { o = randomObj(r, shapePool, colorPool); guard++; } while (keys.has(objKey(o)) && guard < 200);
            keys.add(objKey(o)); usedCells.add(cell); items.push({ cell, shape: o.shape, color: o.color });
            return items[items.length - 1];
        };
        let T = null, N = null;
        if (kind === 'rightof') {
            const cands = [];
            for (let c = 0; c < total; c++) if (c % cols < cols - 1) cands.push(c);
            const tc = r.pick(cands);
            T = addItem(tc); N = addItem(tc + 1);
        }
        const rest = r.shuffle([...Array(total).keys()].filter(c => !usedCells.has(c)));
        while (items.length < n) addItem(rest.shift());
        const rc = c => 'baris ' + (Math.floor(c / cols) + 1) + ', kolom ' + ((c % cols) + 1);
        const scene = { cols, rows, items };
        const round = { scene, observeMs: p.observeMs[di], recallMs: p.recallMs[di] };
        const sceneKeys = keys;
        const distractAbsent = (base, cnt) => {
            const out = [];
            const pool = look ? variantsOf(base, r) : r.shuffle(SHAPES.flatMap(s => COLORS.map(c => ({ shape: s.id, color: c.id }))));
            for (const o of pool) { if (!sceneKeys.has(objKey(o)) && objKey(o) !== objKey(base)) out.push(o); if (out.length >= cnt) break; }
            return out;
        };

        if (kind === 'position') {
            const t = r.pick(items);
            round.prompt = 'Di mana ' + objName(t) + ' tadi?';
            round.promptObj = { shape: t.shape, color: t.color };
            round.recall = { type: 'cells', cols, rows, pick: 1, base: 'empty' };
            round.answer = [t.cell];
            round.explain = objName(t) + ' ada di ' + rc(t.cell) + '.';
        } else if (kind === 'colorOf') {
            const t = r.pick(items);
            round.prompt = 'Objek di ' + rc(t.cell) + ' berwarna apa?';
            const present = [...new Set(items.map(i => i.color))].filter(c => c !== t.color);
            const others = r.shuffle(COLORS.map(c => c.id).filter(c => c !== t.color));
            const ordered = [...new Set(look ? present.concat(others) : others)];
            const ds = ordered.slice(0, 3).map(c => optColor(c, 'Warna objek itu ' + colorById(t.color).n + ', bukan ' + colorById(c).n + '.'));
            const ch = buildChoice(r, optColor(t.color), ds);
            round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
            round.explain = 'Objek di ' + rc(t.cell) + ' adalah ' + objName(t) + '.';
        } else if (kind === 'count') {
            const cnt = {}; items.forEach(i => { cnt[i.color] = (cnt[i.color] || 0) + 1; });
            const cid = r.pick(Object.keys(cnt));
            const k = cnt[cid];
            round.prompt = 'Berapa banyak objek berwarna ' + colorById(cid).n + '?';
            const cand = [k - 2, k - 1, k + 1, k + 2, k + 3].filter(x => x >= 0 && x !== k);
            const ds = r.shuffle(cand).slice(0, 3).map(x => optNum(x, 'Jumlah sebenarnya ' + k + '.'));
            const ch = buildChoice(r, optNum(k), ds);
            round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
            round.explain = 'Ada ' + k + ' objek ' + colorById(cid).n + ' di adegan.';
        } else if (kind === 'present') {
            const t = r.pick(items);
            round.prompt = 'Objek mana yang TADI ada di adegan?';
            const ds = distractAbsent(t, 3).map(o => optObj(o, objName(o) + ' tidak ada di adegan.'));
            const ch = buildChoice(r, optObj(t), ds);
            round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
            round.explain = objName(t) + ' ada di ' + rc(t.cell) + '.';
        } else if (kind === 'rowcol') {
            const t = r.pick(items);
            round.prompt = 'Objek apa yang ada di ' + rc(t.cell) + '?';
            const pool = look ? variantsOf(t, r) : r.shuffle(items.filter(i => objKey(i) !== objKey(t)));
            const ds = pool.slice(0, 3).map(o => optObj(o, 'Di ' + rc(t.cell) + ' adalah ' + objName(t) + '.'));
            const ch = buildChoice(r, optObj(t), ds);
            round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
            round.explain = 'Di ' + rc(t.cell) + ' ada ' + objName(t) + '.';
        } else if (kind === 'rightof') {
            round.prompt = 'Apa yang ada tepat di KANAN ' + objName(T) + '?';
            round.promptObj = { shape: T.shape, color: T.color };
            const others = items.filter(i => objKey(i) !== objKey(N)).map(i => ({ shape: i.shape, color: i.color }));
            const pool = r.shuffle(others).concat(distractAbsent(N, 3));
            const ds = pool.slice(0, 3 + 3).map(o => optObj(o, 'Di kanan ' + objName(T) + ' adalah ' + objName(N) + '.'));
            const ch = buildChoice(r, optObj(N), ds.slice(0, 3));
            round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
            round.explain = objName(N) + ' berada tepat di kanan ' + objName(T) + '.';
        }
        round.scene.hideNote = 'Ingat objek, warna, dan posisinya';
        return round;
    }

    /* =====================================================================
       GENERATOR: SEQUENCE BREAKER
    ===================================================================== */
    function pickPool(r, base, n) { return r.shuffle(base.slice()).slice(0, n); }
    function randomSeq(r, pool, len) {
        const out = [];
        for (let i = 0; i < len; i++) {
            let g = r.pick(pool), guard = 0;
            while (i > 0 && g.id === out[i - 1].id && guard++ < 30) g = r.pick(pool);
            out.push(g);
        }
        if (len > 1 && out.every(x => x.id === out[0].id)) out[1] = pool.find(x => x.id !== out[0].id);
        return out;
    }
    const idsOf = a => a.map(x => x.id);

    function genSequence(r, di, kind, mods) {
        const p = P.sequence;
        const step = p.step[di];
        const round = {};
        let pool, shown, answer, need, slots = null, prompt, explain, caption;
        const [lo, hi] = p.len[di];
        let len = r.range(lo, hi);
        const rev = kind === 'reverse' || mods.includes('reverse');
        if (kind === 'repeat' || kind === 'reverse') {
            pool = pickPool(r, SEQ_SYMS, p.poolN[di]);
            if (len > pool.length + 3) len = pool.length + 3;
            shown = randomSeq(r, pool, len);
            answer = rev ? shown.slice().reverse() : shown.slice();
            need = len;
            prompt = rev ? 'Masukkan urutan secara TERBALIK (dari yang terakhir).' : 'Masukkan urutan sesuai tayangan.';
            explain = 'Urutan asli: ' + shown.map(x => x.g).join(' ') + (rev ? '  → terbalik: ' + answer.map(x => x.g).join(' ') : '');
            caption = rev ? 'Ingat urutannya — nanti dibalik!' : 'Ingat urutannya';
        } else if (kind === 'continue') {
            const per = [2, 2, 3, 4][di];
            pool = pickPool(r, SEQ_SYMS, Math.max(p.poolN[di], per));
            const base = pool.slice(0, per);
            const total = per * 2 + 1;
            shown = []; for (let i = 0; i < total; i++) shown.push(base[i % per]);
            need = di <= 1 ? 2 : 3;
            answer = []; for (let i = 0; i < need; i++) answer.push(base[(total + i) % per]);
            prompt = 'Lanjutkan pola: isi ' + need + ' elemen berikutnya.';
            explain = 'Pola berulang tiap ' + per + ' elemen (' + base.map(x => x.g).join(' ') + '), jadi lanjutannya ' + answer.map(x => x.g).join(' ') + '.';
            caption = 'Perhatikan polanya';
        } else if (kind === 'missing') {
            pool = pickPool(r, SEQ_SYMS, p.poolN[di]);
            shown = randomSeq(r, pool, Math.max(len, 4));
            const hole = r.int(shown.length);
            answer = [shown[hole]]; need = 1;
            slots = shown.map((x, i) => (i === hole ? null : x));
            prompt = 'Satu elemen hilang. Elemen apa yang hilang?';
            explain = 'Urutan asli: ' + shown.map(x => x.g).join(' ') + ' — yang hilang di posisi ' + (hole + 1) + ' adalah ' + answer[0].g + '.';
            caption = 'Ingat setiap elemen dan posisinya';
        } else if (kind === 'arith') {
            pool = DIGITS;
            const k = r.range(1, 3), L = di >= 3 ? 5 : 4, s = r.int(10);
            shown = []; for (let i = 0; i < L; i++) shown.push(DIGITS[(s + i * k) % 10]);
            need = 2; answer = []; for (let i = 0; i < need; i++) answer.push(DIGITS[(s + (L + i) * k) % 10]);
            prompt = 'Pola naik +' + k + ' (lewat 9 kembali ke 0). Isi 2 angka berikutnya.';
            explain = 'Tiap angka bertambah ' + k + ' (modulo 10): ' + shown.map(x => x.g).join(', ') + ' → ' + answer.map(x => x.g).join(', ') + '.';
            caption = 'Cari aturan naik-turunnya';
        } else { // transform
            pool = DIGITS;
            const d = r.pick([1, 2, 3, -1, -2]);
            const L = [3, 3, 4, 5][di];
            shown = []; let prev = -1;
            for (let i = 0; i < L; i++) { let v = r.int(10), g = 0; while (v === prev && g++ < 20) v = r.int(10); shown.push(DIGITS[v]); prev = v; }
            answer = shown.map(x => DIGITS[((+x.g + d) % 10 + 10) % 10]); need = L;
            const rule = (d > 0 ? '+' : '−') + Math.abs(d);
            prompt = 'Tiap angka diubah ' + rule + ' (modulo 10). Masukkan hasilnya.';
            explain = shown.map(x => x.g).join(' ') + ' dengan ' + rule + ' → ' + answer.map(x => x.g).join(' ') + '.';
            caption = 'Ingat angkanya. Aturan: ' + rule + ' tiap angka';
        }
        round.scene = { items: shown, step, gap: 220, caption, symbolMode: pool === DIGITS ? 'digit' : 'symbol' };
        round.observeMs = shown.length * (step + 220) + 400;
        round.recallMs = seqRecallMs(p, di, need);
        round.prompt = prompt; round.explain = explain;
        round.recall = { type: 'seq', pool: pool === DIGITS ? DIGITS : pool, need, slots, reversed: rev, answerIds: idsOf(answer) };
        round.answer = idsOf(answer);
        return round;
    }

    /* =====================================================================
       GENERATOR: GLITCH HUNTER
    ===================================================================== */
    function genGlitch(r, di, kind, mods) {
        const p = P.glitch, cols = p.cols[di], rows = p.rows[di], total = cols * rows, n = p.n[di];
        const look = mods.includes('falseFamiliarity');
        const shapePool = di >= 2 || look ? r.shuffle(SHAPES.slice()).slice(0, 4) : SHAPES;
        const colorPool = di >= 2 || look ? r.shuffle(COLORS.slice()).slice(0, 4) : COLORS;
        const cells = r.shuffle([...Array(total).keys()]);
        const A = new Array(total).fill(null);
        for (let i = 0; i < n; i++) A[cells[i]] = randomObj(r, shapePool, colorPool);
        const B = A.map(o => (o ? { shape: o.shape, color: o.color } : null));
        const used = new Set();
        const desc = [];
        const k = p.k[di];
        let guard = 0, done = 0;
        const types = p.types[di];
        while (done < k && guard++ < 400) {
            const t = r.pick(types);
            const occ = [...Array(total).keys()].filter(c => B[c] && !used.has(c));
            const emp = [...Array(total).keys()].filter(c => !B[c] && !used.has(c));
            const same = (a, b) => a.shape === b.shape && a.color === b.color;
            if (t === 'add' && emp.length) { const c = r.pick(emp); B[c] = randomObj(r, shapePool, colorPool); used.add(c); desc.push('Objek baru muncul di ' + cellName(c, cols)); done++; }
            else if (t === 'remove' && occ.length > 1) { const c = r.pick(occ); B[c] = null; used.add(c); desc.push('Objek di ' + cellName(c, cols) + ' menghilang'); done++; }
            else if (t === 'recolor' && occ.length) { const c = r.pick(occ); const cs = COLORS.filter(x => x.id !== B[c].color); B[c] = { shape: B[c].shape, color: r.pick(cs).id }; used.add(c); desc.push('Warna objek di ' + cellName(c, cols) + ' berubah'); done++; }
            else if (t === 'reshape' && occ.length) { const c = r.pick(occ); const ss = SHAPES.filter(x => x.id !== B[c].shape); B[c] = { shape: r.pick(ss).id, color: B[c].color }; used.add(c); desc.push('Bentuk objek di ' + cellName(c, cols) + ' berubah'); done++; }
            else if (t === 'move' && occ.length && emp.length) { const a = r.pick(occ), b = r.pick(emp); B[b] = B[a]; B[a] = null; used.add(a); used.add(b); desc.push('Objek pindah dari ' + cellName(a, cols) + ' ke ' + cellName(b, cols)); done++; }
            else if (t === 'swap' && occ.length > 1) {
                const a = r.pick(occ); const cand = occ.filter(c => c !== a && !same(B[c], B[a]));
                if (cand.length) { const b = r.pick(cand); const tmp = B[a]; B[a] = B[b]; B[b] = tmp; used.add(a); used.add(b); desc.push('Objek di ' + cellName(a, cols) + ' dan ' + cellName(b, cols) + ' bertukar'); done++; }
            }
        }
        // Jawaban = sel yang benar-benar berbeda (dihitung ulang, bukan dari catatan)
        const answer = [];
        for (let c = 0; c < total; c++) {
            const a = A[c], b = B[c];
            if ((!a) !== (!b) || (a && b && (a.shape !== b.shape || a.color !== b.color))) answer.push(c);
        }
        const round = {
            scene: { cols, rows, A, B, caption: 'Hafalkan susunannya' },
            observeMs: p.observeMs[di], recallMs: p.recallMs[di], scanMs: 1400
        };
        round.prompt = 'Ada ' + answer.length + ' sel yang berubah. Tandai semuanya.';
        round.recall = { type: 'cells', cols, rows, pick: answer.length, base: 'B' };
        round.answer = answer; round.explain = desc.join('; ') + '.';
        round.changes = desc;
        return round;
    }
    function cellName(c, cols) { return 'baris ' + (Math.floor(c / cols) + 1) + ' kolom ' + ((c % cols) + 1); }

    /* =====================================================================
       GENERATOR: COPYCAT CHAOS
    ===================================================================== */
    function genCopycat(r, di, kind, mods) {
        const p = P.copycat, step = p.step[di];
        const [lo, hi] = p.len[di];
        let len = r.range(lo, hi);
        let pool;
        if (kind === 'mirror') {
            const pairsN = [2, 2, 3, 4][di];
            pool = r.shuffle(MIRROR_PAIRS.slice()).slice(0, pairsN).flat().map(id => ACTIONS.find(a => a.id === id));
        } else {
            pool = pickPool(r, ACTIONS, p.poolN[di]);
            if (di >= 2 && !(pool.find(a => a.id === 'waveL') && pool.find(a => a.id === 'waveR'))) {
                const keep = pool.filter(a => a.id !== 'waveL' && a.id !== 'waveR').slice(0, pool.length - 2);
                pool = keep.concat(ACTIONS.filter(a => a.id === 'waveL' || a.id === 'waveR'));
            }
        }
        const rev = kind === 'reverse' || mods.includes('reverse');
        let seq = randomSeq(r, pool, len);
        // aksi yang mirip berdekatan (Hard/Expert)
        if (di >= 2 && kind !== 'variant' && kind !== 'mirror') {
            const a = pool.find(x => x.id === 'waveL'), b = pool.find(x => x.id === 'waveR');
            if (a && b && len >= 3) {
                const at = r.int(len - 1); const pair = r.chance(0.5) ? [a, b] : [b, a];
                seq[at] = pair[0]; seq[at + 1] = pair[1];
            }
        }
        const round = { scene: { items: seq, step, gap: 260, caption: 'Perhatikan gerakan Mimo' }, recallMs: seqRecallMs(p, di, len) };
        if (kind === 'variant') {
            const alt = seq.slice(); const pos = r.int(len);
            let o = r.pick(pool.filter(x => x.id !== seq[pos].id)); alt[pos] = o;
            round.scene.items = seq.concat(alt);
            round.scene.second = { start: len, pos };
            round.scene.caption = 'Mimo memeragakan DUA tayangan. Cari bedanya!';
            round.prompt = 'Pada tayangan kedua, aksi ke berapa yang BERBEDA?';
            const opts = [...Array(len).keys()].map(i => optNum(i + 1, 'Aksi ke-' + (i + 1) + ' sama di kedua tayangan.'));
            round.recall = { type: 'choice', options: opts, cols: Math.min(4, len) };
            round.answer = pos; round.recallMs = 14000 + 1200 * len;
            round.explain = 'Tayangan 1: ' + seq.map(x => x.g).join(' ') + ' · Tayangan 2: ' + alt.map(x => x.g).join(' ') + ' → beda di aksi ke-' + (pos + 1) + '.';
            round.observeMs = round.scene.items.length * (step + 260) + 1200;
            round.legend = false;
        } else {
            let answer = seq.slice();
            if (kind === 'mirror') {
                answer = seq.map(a => ACTIONS.find(x => x.id === MIRROR[a.id]));
                round.legend = true;
                round.prompt = 'ATURAN CERMIN: masukkan kebalikan tiap aksi' + (rev ? ' dan urutannya TERBALIK.' : '.');
                round.scene.caption = 'Aturan cermin! Kebalikan tiap aksi akan diminta';
            } else {
                round.prompt = rev ? 'Masukkan aksi secara TERBALIK (dari yang terakhir).' : 'Masukkan aksi sesuai urutan yang diperagakan.';
            }
            if (rev) answer = answer.slice().reverse();
            if (kind === 'delayed') { round.delayMs = p.delay[di] || 3500; round.prompt += ' (Setelah jeda!)'; }
            round.recall = { type: 'seq', pool, need: len, slots: null, reversed: rev, answerIds: idsOf(answer) };
            round.answer = idsOf(answer);
            round.explain = 'Aksi diperagakan: ' + seq.map(x => x.g).join(' ') + (kind === 'mirror' ? ' → cermin: ' + answer.map(x => x.g).join(' ') : rev ? ' → terbalik: ' + answer.map(x => x.g).join(' ') : '');
            round.observeMs = len * (step + 260) + 600;
        }
        return round;
    }

    /* =====================================================================
       GENERATOR: ECHO CHAMBER
    ===================================================================== */
    function genEcho(r, di, kind, mods) {
        const p = P.echo, step = p.step[di];
        const round = {};
        if (kind === 'rhythm') {
            const beats = p.beats[di] + r.int(2);
            const levels = di >= 2 ? [300, 600, 900] : [350, 700];
            const ints = []; let prev = -1;
            for (let i = 0; i < beats - 1; i++) { let v = r.pick(levels), g = 0; if (i > 0 && !ints.includes(levels[0]) && g++ < 1) v = levels[0]; ints.push(v); prev = v; }
            if (new Set(ints).size === 1 && levels.length > 1) ints[r.int(ints.length)] = levels.find(l => l !== ints[0]);
            round.scene = { rhythm: ints, caption: 'Dengarkan dan lihat pola ketukannya' };
            round.observeMs = ints.reduce((a, b) => a + b, 0) + 1400;
            round.recallMs = 12000 + ints.reduce((a, b) => a + b, 0) * 1.5;
            round.prompt = 'Ketuk pad ' + beats + ' kali dengan ritme yang sama.';
            round.recall = { type: 'rhythm', beats, intervals: ints, tolerance: p.tolerance[di] };
            round.answer = { beats, intervals: ints };
            round.explain = 'Jeda antar ketukan: ' + ints.map(x => (x < 450 ? 'pendek' : x < 750 ? 'sedang' : 'panjang')).join(' · ') + '.';
        } else {
            const isT = kind === 'timbre';
            const pool = isT ? ECHO_TIMBRES : ECHO_PADS.slice(0, p.pads[di]);
            const [lo, hi] = p.len[di];
            let len = r.range(lo, hi);
            const seq = randomSeq(r, pool, len);
            const rev = mods.includes('reverse');
            const ans = rev ? seq.slice().reverse() : seq.slice();
            round.scene = { items: seq, step, gap: 200, caption: isT ? 'Dengarkan warna bunyinya' : 'Dengarkan nadanya (pad juga menyala)', sound: true };
            round.observeMs = len * (step + 200) + 500;
            round.recallMs = seqRecallMs(p, di, len);
            round.prompt = (rev ? 'Tekan pad dalam urutan TERBALIK.' : 'Tekan pad sesuai urutan bunyi.') + (isT ? ' (Nada sama, warna bunyi beda)' : '');
            round.recall = { type: 'seq', pool, need: len, slots: null, reversed: rev, answerIds: idsOf(ans), sound: true };
            round.answer = idsOf(ans);
            round.explain = 'Urutan bunyi: ' + seq.map(x => x.g + x.n).join(' ') + (rev ? ' → terbalik: ' + ans.map(x => x.g + x.n).join(' ') : '');
        }
        return round;
    }

    /* =====================================================================
       GENERATOR: MIND TRAP
    ===================================================================== */
    const PRED = {
        roomOdd: { t: 'berada di Lab bernomor ganjil', f: p => p.room % 2 === 1, fam: 'room' },
        roomEven: { t: 'berada di Lab bernomor genap', f: p => p.room % 2 === 0, fam: 'room' },
        roomHigh: { t: 'berada di Lab nomor 4 ke atas', f: p => p.room >= 4, fam: 'room' },
        roomLow: { t: 'berada di Lab nomor 3 ke bawah', f: p => p.room <= 3, fam: 'room' },
        tool: { t: 'membawa alat (Kunci, Senter, atau Kunci Inggris)', f: p => p.item.cls === 'alat', fam: 'item' },
        sains: { t: 'membawa perlengkapan sains (Sampel, Antena, atau Magnet)', f: p => p.item.cls === 'sains', fam: 'item' },
        warm: { t: 'berbaju hangat (Merah, Kuning, atau Oranye)', f: p => ['red', 'yellow', 'orange'].includes(p.color.id), fam: 'col' },
        cool: { t: 'berbaju dingin (Biru, Hijau, atau Ungu)', f: p => ['blue', 'green', 'purple'].includes(p.color.id), fam: 'col' }
    };

    function genMindtrap(r, di, kind, mods) {
        const p = P.mindtrap;
        const N = p.crew[di];
        const hasRoom = di >= 1, hasColor = di >= 2;
        const names = r.shuffle(NAMES.slice());
        const crewNames = names.slice(0, N), absentNames = names.slice(N);
        const items = r.shuffle(ITEMS.slice()), rooms = r.shuffle([1, 2, 3, 4, 5, 6]), colors = r.shuffle(COLORS.slice());
        const crew = crewNames.map((name, i) => ({ name, item: items[i], room: rooms[i], color: colors[i] }));
        const free = items.slice(N);
        const freeRooms = rooms.slice(N);
        const state0 = crew.map(c => Object.assign({}, c));
        const line = (c, withUpdate) => ({ name: c.name, item: c.item.g + ' ' + c.item.n, room: hasRoom ? 'Lab ' + c.room : null, color: hasColor ? c.color.n : null, colorHex: hasColor ? c.color.hex : null });
        const phases = [{ title: 'Data Awak Stasiun', lines: crew.map(c => line(c)), ms: p.observeMs[di] }];
        const look = mods.includes('falseFamiliarity');
        const round = { recallMs: p.recallMs[di] };
        const desc = c => c.name + ' membawa ' + c.item.g + ' ' + c.item.n + (hasRoom ? ', di Lab ' + c.room : '') + (hasColor ? ', baju ' + c.color.n : '');
        const stmt = (c, over) => {
            const it = over.item || c.item, rm = over.room != null ? over.room : c.room, cl = over.color || c.color;
            return c.name + ' membawa ' + it.n + (hasRoom ? ' di Lab ' + rm : '') + (hasColor ? ' dan berbaju ' + cl.n : '');
        };
        let cur = crew.map(c => Object.assign({}, c)); // keadaan terkini (setelah update)

        if (kind === 'update') {
            const upd = [];
            const type = (free.length === 0 && freeRooms.length === 0) || !hasRoom ? 'swapItem' : r.pick(['moveRoom', 'swapItem']);
            if (type === 'moveRoom' && freeRooms.length && hasRoom) {
                const c = r.pick(cur), old = c.room, nr = r.pick(freeRooms);
                upd.push('🔄 ' + c.name + ' pindah dari Lab ' + old + ' ke Lab ' + nr); c.room = nr;
                round.updateInfo = { type, who: c.name, old, now: nr };
            } else {
                const a = r.pick(cur); const b = r.pick(cur.filter(x => x.name !== a.name));
                upd.push('🔄 ' + a.name + ' dan ' + b.name + ' bertukar barang');
                round.updateInfo = { type: 'swapItem', a: a.name, b: b.name, itemA: a.item.n, itemB: b.item.n };
                const t = a.item; a.item = b.item; b.item = t;
            }
            phases.push({ title: 'Pembaruan Data', lines: upd.map(u => ({ update: u })), ms: p.updateMs[di] || 4000 });
        }
        const initial = crew; // keadaan awal
        const byName = (arr, n) => arr.find(c => c.name === n);

        if (kind === 'who' || (kind === 'update' && round.updateInfo.type === 'swapItem')) {
            const upd = kind === 'update';
            const tgt = r.pick(upd ? cur.filter(c => c.name === round.updateInfo.a || c.name === round.updateInfo.b) : cur);
            const it = tgt.item;
            round.prompt = (upd ? 'SEKARANG, siapa yang membawa ' : 'Siapa yang membawa ') + it.g + ' ' + it.n + '?';
            const ds = [];
            cur.filter(c => c.name !== tgt.name).forEach(c => ds.push(optText(c.name, 'n:' + c.name, upd && byName(initial, c.name).item.id === it.id ? c.name + ' membawa ' + it.n + ' hanya di data lama; setelah pembaruan barangnya berbeda.' : c.name + ' membawa ' + c.item.n + ', bukan ' + it.n + '.')));
            if (upd) { // jebakan: pemilik lama
                const old = initial.find(c => c.item.id === it.id);
                if (old && old.name !== tgt.name) { const idx = ds.findIndex(d => d.key === 'n:' + old.name); if (idx > 0) { const x = ds.splice(idx, 1)[0]; ds.unshift(x); } }
            }
            absentNames.slice(0, 2).forEach(n => ds.push(optText(n, 'n:' + n, n + ' tidak ada di data.')));
            const trap = ds.slice(0, 1), restD = r.shuffle(ds.slice(1));
            const ch = buildChoice(r, optText(tgt.name, 'n:' + tgt.name), (upd ? trap.concat(restD) : r.shuffle(ds)).slice(0, 3));
            round.recall = { type: 'choice', options: ch.options, cols: 2 }; round.answer = ch.answer;
            round.explain = (upd ? 'Setelah pembaruan, ' : '') + tgt.name + ' membawa ' + it.g + ' ' + it.n + '.';
        } else if (kind === 'update') { // moveRoom
            const nm = round.updateInfo.who, now = round.updateInfo.now, old = round.updateInfo.old;
            round.prompt = 'SEKARANG, di Lab berapa ' + nm + ' berada?';
            const others = cur.filter(c => c.name !== nm).map(c => c.room);
            const ds = [optNum(old, 'Lab ' + old + ' adalah data lama; ' + nm + ' sudah pindah.')].concat(others.slice(0, 2).map(x => optNum(x, 'Lab ' + x + ' ditempati kru lain.')));
            freeRooms.filter(x => x !== now).slice(0, 1).forEach(x => ds.push(optNum(x, 'Tidak ada yang berada di Lab ' + x + '.')));
            const ch = buildChoice(r, optNum(now), ds);
            ch.options.forEach(o => { o.text = 'Lab ' + o.n; o.t = 'text'; });
            round.recall = { type: 'choice', options: ch.options, cols: 2 }; round.answer = ch.answer;
            round.explain = nm + ' pindah dari Lab ' + old + ' ke Lab ' + now + '.';
        } else if (kind === 'attrItem') {
            const tgt = r.pick(cur);
            round.prompt = 'Apa yang dibawa ' + tgt.name + '?';
            const ds = cur.filter(c => c.name !== tgt.name).map(c => optItem(c.item, c.item.n + ' dibawa ' + c.name + '.'))
                .concat(free.map(it => optItem(it, it.n + ' tidak dibawa siapa pun.')));
            const ch = buildChoice(r, optItem(tgt.item), r.shuffle(ds).slice(0, 3));
            round.recall = { type: 'choice', options: ch.options, cols: 2 }; round.answer = ch.answer;
            round.explain = tgt.name + ' membawa ' + tgt.item.g + ' ' + tgt.item.n + '.';
        } else if (kind === 'room') {
            const tgt = r.pick(cur);
            round.prompt = 'Di Lab berapa ' + tgt.name + ' berada?';
            const ds = cur.filter(c => c.name !== tgt.name).map(c => optNum(c.room, 'Lab ' + c.room + ' ditempati ' + c.name + '.'))
                .concat(freeRooms.map(x => optNum(x, 'Tidak ada yang berada di Lab ' + x + '.')));
            const ch = buildChoice(r, optNum(tgt.room), r.shuffle(ds).slice(0, 3));
            ch.options.forEach(o => { o.text = 'Lab ' + o.n; o.t = 'text'; });
            round.recall = { type: 'choice', options: ch.options, cols: 2 }; round.answer = ch.answer;
            round.explain = tgt.name + ' berada di Lab ' + tgt.room + '.';
        } else if (kind === 'statement') {
            const tgt = r.pick(cur);
            round.prompt = 'Pernyataan mana yang BENAR sesuai data tadi?';
            const attrs = ['item'].concat(hasRoom ? ['room'] : []).concat(hasColor ? ['color'] : []);
            const ds = [], seen = new Set([stmt(tgt, {})]);
            let guard = 0;
            while (ds.length < 3 && guard++ < 80) {
                const a = r.pick(attrs); const over = {}; let reason;
                const others = cur.filter(c => c.name !== tgt.name);
                const oth = r.pick(others);
                if (a === 'item') { over.item = look ? r.pick(others).item : r.pick(items.filter(i => i.id !== tgt.item.id)); reason = 'Sebenarnya ' + tgt.name + ' membawa ' + tgt.item.n + ', bukan ' + over.item.n + '.'; }
                else if (a === 'room') { over.room = r.pick(rooms.filter(x => x !== tgt.room)); reason = 'Sebenarnya ' + tgt.name + ' di Lab ' + tgt.room + ', bukan Lab ' + over.room + '.'; }
                else { over.color = oth.color; reason = 'Sebenarnya ' + tgt.name + ' berbaju ' + tgt.color.n + ', bukan ' + over.color.n + '.'; }
                const text = stmt(tgt, over);
                if (!seen.has(text)) { seen.add(text); ds.push(optText(text, text, reason)); }
            }
            const ch = buildChoice(r, optText(stmt(tgt, {}), stmt(tgt, {})), ds);
            round.recall = { type: 'choice', options: ch.options, cols: 1 }; round.answer = ch.answer;
            round.explain = desc(tgt) + '.';
        } else if (kind === 'count' || kind === 'only') {
            const famsAvail = ['room', 'item'].concat(hasColor ? ['col'] : []);
            let pick = null;
            for (let g = 0; g < 200 && !pick; g++) {
                const fams = r.shuffle(famsAvail).slice(0, r.chance(0.35) && famsAvail.length > 2 ? 3 : 2);
                const ps = fams.map(f => r.pick(Object.keys(PRED).filter(k => PRED[k].fam === f)));
                const match = cur.filter(c => ps.every(k => PRED[k].f(c)));
                if (kind === 'only') {
                    if (match.length === 1 && ps.every(k => cur.filter(c => PRED[k].f(c)).length >= 2)) pick = { ps, match };
                } else if (match.length <= 4 && ps.every(k => cur.filter(c => PRED[k].f(c)).length >= 1)) pick = { ps, match };
            }
            if (!pick) return genMindtrap(r, di, 'who', mods);
            const cond = pick.ps.map(k => PRED[k].t).join(' DAN ');
            if (kind === 'only') {
                const ans = pick.match[0];
                round.prompt = 'Siapa SATU-SATUNYA kru yang ' + cond + '?';
                const ds = cur.filter(c => c.name !== ans.name).map(c => {
                    const failing = pick.ps.filter(k => !PRED[k].f(c)).map(k => PRED[k].t.replace('berada di', 'tidak berada di').replace('membawa', 'tidak membawa').replace('berbaju', 'tidak berbaju'));
                    return optText(c.name, 'n:' + c.name, c.name + ': ' + (failing[0] || '') + '.');
                });
                ds.push(...absentNames.slice(0, 1).map(n => optText(n, 'n:' + n, n + ' tidak ada di data.')));
                const ch = buildChoice(r, optText(ans.name, 'n:' + ans.name), r.shuffle(ds).slice(0, 3));
                round.recall = { type: 'choice', options: ch.options, cols: 2 }; round.answer = ch.answer;
                round.explain = ans.name + ' memenuhi semua syarat: ' + desc(ans) + '.';
            } else {
                const k = pick.match.length;
                round.prompt = 'Berapa kru yang ' + cond + '?';
                const cand = [k - 2, k - 1, k + 1, k + 2, k + 3].filter(x => x >= 0 && x !== k && x <= N);
                const ch = buildChoice(r, optNum(k), r.shuffle(cand).slice(0, 3).map(x => optNum(x, 'Jumlah yang memenuhi syarat adalah ' + k + '.')));
                round.recall = { type: 'choice', options: ch.options, cols: 4 }; round.answer = ch.answer;
                round.explain = k === 0 ? 'Tidak ada kru yang memenuhi semua syarat.' : 'Yang memenuhi: ' + pick.match.map(m => m.name).join(', ') + '.';
            }
            round.kindOverride = kind === 'count' ? 'count2' : 'only';
        }
        round.scene = { phases, caption: 'Hafalkan data kru' };
        round.observeMs = phases.reduce((a, b) => a + b.ms, 0);
        round.crew = crew.map(c => ({ name: c.name, item: c.item.n, room: c.room, color: c.color.n }));
        return round;
    }

    /* =====================================================================
       Mini-task (Double Recall) & interferensi
    ===================================================================== */
    function genMini(r) {
        const a = r.range(3, 9), b = r.range(2, 8), plus = r.chance(0.6);
        const ans = plus ? a + b : Math.abs(a - b) === 0 ? a + 1 - 1 : a - b > 0 ? a - b : a + b;
        const text = plus ? a + ' + ' + b : (a - b > 0 ? a + ' − ' + b : a + ' + ' + b);
        const cand = [ans - 2, ans - 1, ans + 1, ans + 2, ans + 3].filter(x => x >= 0 && x !== ans);
        const ds = r.shuffle(cand).slice(0, 3);
        const options = r.shuffle([ans].concat(ds));
        return { text, options, answer: options.indexOf(ans), ms: 7000 };
    }
    function genInterference(r) {
        const items = []; const keys = new Set();
        while (items.length < 4) { const o = randomObj(r, SHAPES, COLORS); if (!keys.has(objKey(o))) { keys.add(objKey(o)); items.push(o); } }
        return { items, ms: 2200 };
    }

    /* =====================================================================
       Pemilih jenis soal & modifier
    ===================================================================== */
    function kindsFor(mode, diff) { return P[mode].kinds[DIFF_INFO[diff].idx]; }
    function modifiersFor(mode, kind) {
        const m = [];
        if ((mode === 'sequence' && kind === 'repeat') || (mode === 'copycat' && kind === 'repeat') || (mode === 'echo' && (kind === 'tones' || kind === 'timbre'))) m.push('reverse');
        m.push('doubleRecall');
        if (['snapshot', 'sequence', 'glitch', 'copycat'].includes(mode)) m.push('distraction');
        if (['snapshot', 'mindtrap', 'glitch'].includes(mode)) m.push('falseFamiliarity');
        if (mode !== 'echo') m.push('interference');
        return m;
    }
    function compatible(mods) {
        if (mods.includes('doubleRecall') && mods.includes('interference')) return false;
        return mods.length <= 2;
    }
    function chooseMods(r, mode, kind, di, spec) {
        const avail = modifiersFor(mode, kind);
        if (Array.isArray(spec)) {
            const out = [];
            for (const m of spec) if (avail.includes(m) && !out.includes(m) && compatible(out.concat(m))) out.push(m);
            return out;
        }
        const probs = [0, 0.3, 0.6, 0.85];
        if (!r.chance(probs[di])) return [];
        const out = [];
        const first = r.pick(avail); out.push(first);
        if (di >= 2 && r.chance(di === 3 ? 0.5 : 0.25)) {
            const rest = avail.filter(m => m !== first && compatible(out.concat(m)));
            if (rest.length) out.push(r.pick(rest));
        }
        return out;
    }

    /* =====================================================================
       generateRound — satu-satunya pintu masuk generator
       opts: {mode, diff, seed, index, mods('auto'|[]), kind(opsional), recent([])}
    ===================================================================== */
    function generateRound(opts) {
        const mode = opts.mode, diff = opts.diff, di = DIFF_INFO[diff].idx;
        const r = makeRng(String(opts.seed) + '#' + opts.index + '#' + mode + '#' + diff);
        let kinds = kindsFor(mode, diff);
        let kind = opts.kind;
        if (!kind) {
            const recent = (opts.recent || []).slice(-2);
            const fresh = kinds.filter(k => !recent.includes(k));
            kind = r.pick(fresh.length ? fresh : kinds);
        }
        const mods = chooseMods(r, mode, kind, di, opts.mods === undefined ? 'auto' : opts.mods);
        let round;
        if (mode === 'snapshot') round = genSnapshot(r, di, kind, mods);
        else if (mode === 'sequence') round = genSequence(r, di, kind, mods);
        else if (mode === 'glitch') round = genGlitch(r, di, kind, mods);
        else if (mode === 'copycat') round = genCopycat(r, di, kind, mods);
        else if (mode === 'echo') round = genEcho(r, di, kind, mods);
        else round = genMindtrap(r, di, kind, mods);
        round.mode = mode; round.diff = diff; round.index = opts.index; round.seed = String(opts.seed);
        round.kind = kind === 'count' && mode === 'mindtrap' ? 'count2' : (round.kindOverride || kind);
        if (round.kind === 'who' && mode === 'mindtrap' && kind !== 'who') round.kind = 'who';
        round.title = KIND_TITLES[round.kind] || round.kind;
        round.mods = mods;
        if (mods.includes('doubleRecall')) round.mini = genMini(r);
        if (mods.includes('interference')) round.interference = genInterference(r);
        if (mods.includes('distraction')) round.distraction = true;
        round.observeMs = Math.round(round.observeMs); round.recallMs = Math.round(round.recallMs);
        return round;
    }

    /* =====================================================================
       Validator & solver
    ===================================================================== */
    function validate(round, input) {
        const rc = round.recall;
        if (rc.type === 'choice') {
            const ok = input === round.answer;
            return { correct: ok, accuracy: ok ? 1 : 0, detail: { chosen: input } };
        }
        if (rc.type === 'cells') {
            const sel = Array.from(new Set(input || []));
            const ans = round.answer;
            const inter = sel.filter(c => ans.includes(c)).length;
            const ok = sel.length === ans.length && inter === ans.length;
            const denom = Math.max(ans.length, sel.length) || 1;
            return { correct: ok, accuracy: inter / denom, detail: { selected: sel, missed: ans.filter(c => !sel.includes(c)), wrong: sel.filter(c => !ans.includes(c)) } };
        }
        if (rc.type === 'seq') {
            const ans = round.answer, inp = input || [];
            const flags = ans.map((a, i) => inp[i] === a);
            const good = flags.filter(Boolean).length;
            const ok = inp.length === ans.length && good === ans.length;
            return { correct: ok, accuracy: good / ans.length, detail: { flags, entered: inp.slice() } };
        }
        if (rc.type === 'rhythm') {
            const taps = input || [];
            const want = rc.intervals;
            const got = [];
            for (let i = 1; i < taps.length; i++) got.push(taps[i] - taps[i - 1]);
            const flags = want.map((w, i) => i < got.length && Math.abs(got[i] - w) <= Math.max(rc.tolerance >= 0.4 ? 170 : 140, rc.tolerance * w));
            const good = flags.filter(Boolean).length;
            const ok = taps.length === rc.beats && good === want.length;
            return { correct: ok, accuracy: good / want.length, detail: { flags, got, taps: taps.length } };
        }
        return { correct: false, accuracy: 0, detail: {} };
    }
    function solve(round) {
        const rc = round.recall;
        if (rc.type === 'choice') return round.answer;
        if (rc.type === 'cells') return round.answer.slice();
        if (rc.type === 'seq') return round.answer.slice();
        if (rc.type === 'rhythm') { const t = [0]; rc.intervals.forEach(i => t.push(t[t.length - 1] + i)); return t; }
        return null;
    }

    /* =====================================================================
       Skor
    ===================================================================== */
    const SCORE_CFG = { base: 100, speedMax: 50, accuracyBonus: 25, perfectBonus: 100, comboStep: 0.1, comboMax: 2.0, hintPenalty: 20, miniPenalty: 10 };
    function comboMult(prevCombo) { return Math.min(SCORE_CFG.comboMax, 1 + SCORE_CFG.comboStep * prevCombo); }
    function scoreRound(a) {
        // a: {diff, prevCombo, correct, elapsedMs, recallMs, hints, corrections, miniWrong}
        const dm = DIFF_INFO[a.diff].mult, cm = comboMult(a.prevCombo || 0);
        const penalty = (a.hints || 0) * SCORE_CFG.hintPenalty * (a.practice ? 0 : 1) + (a.miniWrong ? SCORE_CFG.miniPenalty : 0);
        if (!a.correct) return { base: 0, diffMult: dm, comboMult: cm, speed: 0, accuracy: 0, perfect: 0, penalty: 0, total: 0, perfectRound: false };
        const base = Math.round(SCORE_CFG.base * dm * cm);
        const ratio = Math.max(0, Math.min(1, 1 - (a.elapsedMs || 0) / a.recallMs));
        const speed = Math.round(SCORE_CFG.speedMax * ratio);
        const noHint = !(a.hints > 0);
        const accuracy = noHint ? SCORE_CFG.accuracyBonus : 0;
        const perfectRound = noHint && !(a.corrections > 0) && !a.miniWrong;
        const perfect = perfectRound ? SCORE_CFG.perfectBonus : 0;
        const gross = base + speed + accuracy + perfect;
        const pen = Math.min(penalty, gross);
        return { base, diffMult: dm, comboMult: cm, speed, accuracy, perfect, penalty: pen, total: gross - pen, perfectRound };
    }

    /* =====================================================================
       Rencana sesi (daily / boss / endless / standar)
    ===================================================================== */
    const BOSS_PHASES = [
        { title: 'Fase 1 · Pemindai Visual', mode: 'snapshot', diff: 'hard', kind: 'rowcol', mods: ['falseFamiliarity'], rounds: 2 },
        { title: 'Fase 2 · Urutan Terbalik', mode: 'sequence', diff: 'hard', kind: 'repeat', mods: ['reverse'], rounds: 2 },
        { title: 'Fase 3 · Perburuan Glitch', mode: 'glitch', diff: 'hard', kind: null, mods: ['distraction'], rounds: 2 },
        { title: 'Fase 4 · Cermin Mimo', mode: 'copycat', diff: 'hard', kind: 'mirror', mods: [], rounds: 2 },
        { title: 'Fase 5 · Jebakan MINDCORE', mode: 'mindtrap', diff: 'expert', kind: 'update', mods: [], rounds: 2 }
    ];
    function dateKey(d) { d = d || new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

    function planRound(cfg, i, recent) {
        const t = cfg.type;
        if (t === 'boss') {
            let acc = 0;
            for (let ph = 0; ph < BOSS_PHASES.length; ph++) {
                const B = BOSS_PHASES[ph];
                if (i < acc + B.rounds) return { mode: B.mode, diff: B.diff, seed: 'boss-v1-' + ph, index: i - acc, kind: B.kind || undefined, mods: B.mods, phase: ph, phaseTitle: B.title };
                acc += B.rounds;
            }
        }
        if (t === 'daily') {
            const r = makeRng('daily-' + cfg.seed + '-plan');
            const order = r.shuffle(MODES.slice()).concat(r.shuffle(MODES.slice()).slice(0, 4));
            return { mode: order[i], diff: i < 5 ? 'normal' : 'hard', seed: 'daily-' + cfg.seed, index: i, mods: 'auto', recent };
        }
        if (t === 'endless') {
            const r = makeRng(cfg.seed + '-endless-' + i);
            const tier = Math.min(3, Math.floor(i / 4));
            return { mode: r.pick(MODES), diff: DIFFS[tier], seed: cfg.seed, index: i, mods: 'auto', recent };
        }
        return { mode: cfg.mode, diff: cfg.diff, seed: cfg.seed, index: i, mods: cfg.mods === undefined ? 'auto' : cfg.mods, recent };
    }
    function totalRounds(cfg) {
        if (cfg.type === 'boss') return BOSS_PHASES.reduce((a, b) => a + b.rounds, 0);
        if (cfg.type === 'daily') return 10;
        if (cfg.type === 'endless') return Infinity;
        return cfg.rounds;
    }

    return {
        DIFFS, DIFF_INFO, MODES, MODE_INFO, MODIFIERS, SHAPES, COLORS, SEQ_SYMS, DIGITS, ACTIONS, MIRROR, MIRROR_PAIRS, ECHO_PADS, ECHO_TIMBRES,
        KIND_TITLES, SCORE_CFG, BOSS_PHASES, P,
        makeRng, hashSeed, generateRound, validate, solve, scoreRound, comboMult, planRound, totalRounds, dateKey,
        shapeById, colorById, objName, objKey, kindsFor, modifiersFor, compatible
    };
});
