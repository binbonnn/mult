/*
 * ISI FILE INI DENGAN CONFIG FIREBASE KAMU SENDIRI.
 *
 * Cara dapatnya:
 * 1. Buka https://console.firebase.google.com, buat project baru (gratis).
 * 2. Di project itu, buat "Firestore Database" (mode production, pilih lokasi server terdekat).
 * 3. Di menu Project settings > General > "Your apps", klik ikon web "</>" untuk daftarkan web app.
 * 4. Firebase akan menampilkan object seperti di bawah ini — salin & tempel ke sini, ganti semuanya.
 *
 * File ini AMAN untuk diunggah ke GitHub / dibuka publik: kunci di bawah ini
 * bukan password, hanya alamat pengenal project. Yang menjaga keamanan data
 * adalah "Firestore Rules" yang kamu atur di Firebase Console (lihat panduan
 * yang diberikan bersama file ini).
 *
 * Jika file ini TIDAK diisi (masih placeholder di bawah), game akan otomatis
 * memakai localStorage sebagai cadangan (skor hanya tersimpan di HP/browser
 * masing-masing pemain, seperti sebelumnya).
 */
const firebaseConfig = {
  apiKey: "AIzaSyBWuk5aC5rt_EQaHh9Ofm0jVuu1VrUKOjw",
  authDomain: "multgame-9f7e6.firebaseapp.com",
  projectId: "multgame-9f7e6",
  storageBucket: "multgame-9f7e6.firebasestorage.app",
  messagingSenderId: "812456927291",
  appId: "1:812456927291:web:af920785c9080e9eb17c1e",
  measurementId: "G-15TJ5ZTNST"
};