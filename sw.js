/* Guarda os arquivos do app para abrir rápido e funcionar sem internet (os preços sempre vêm da rede). */
const VERSAO = "robo-cripto-v1";
const ARQUIVOS = ["./", "index.html", "app.js", "motor.js", "manifest.webmanifest", "icone-180.png", "icone-192.png", "icone-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // Binance e fontes: sempre rede
  e.respondWith(fetch(e.request).then(r => {                 // rede primeiro, cache como reserva
    const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); return r;
  }).catch(() => caches.match(e.request)));
});
