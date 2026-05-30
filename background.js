/**
 * LESCO Translator - background.js (Service Worker)
 * On install: marca que hay que hacer el pre-caché de palabras comunes.
 * El pre-caché real lo hace el content script la primera vez que corre en Meet,
 * porque los videos vienen de lesco.cenarec.go.cr y el caché debe vivir
 * en el origen de la página (meet.google.com) para que el content script lo lea.
 */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install" || reason === "update") {
    // Resetear el flag para que el content script vuelva a pre-cachear
    // (útil en updates donde los videos comunes pueden haber cambiado)
    chrome.storage.local.set({ lesco_precache_done: false });
    console.log("[LESCO BG] Instalado/actualizado — pre-caché pendiente");
  }
});
