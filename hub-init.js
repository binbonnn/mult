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
