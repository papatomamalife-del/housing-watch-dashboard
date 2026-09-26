// 最小限のサービスワーカー。
// 目的は「一度開けばオフラインでも直近のデータが見られる」こと。
// データは index.html に埋め込まれているため、HTML をキャッシュすれば足りる。
// ビルドごとに名前が変わるので、古いキャッシュは activate 時に必ず消える
const CACHE = "housing-watch-5f668445";
// ?v=... 付きの URL はページ側から要求されるため、ここでは基本ファイルのみ先読みする
const ASSETS = ["./", "./index.html", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // ネットワーク優先・失敗したらキャッシュ(常に最新を出しつつオフラインでも動く)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
