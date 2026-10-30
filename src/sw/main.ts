// The service worker: from a server it keeps the app's files in the browser, so after
// one visit the app opens and works with no connection, and the installed app starts from here. It keeps the app's
// own files and nothing else: the page reads documents from disk and saves them as downloads, so no document ever
// passes through it. Its CSP comes from the server, in the header of sw.js: other sites are out of its reach.
//
// Each file is kept under its address plus its SHA-256 (APP_FILES), e.g. app.js?sha256=…. A new version of the app
// comes with a new sw.js, which the browser looks for whenever the app starts with a connection. The new one
// installs beside the running one and fetches only the files whose sum changed, so the 14 MB engine comes again
// only with a new MuPDF. It takes over once every window of the app is closed: the app open meanwhile keeps the
// version it started with, and the next start gets the new one.

export {}; // a module, so that `self` below can be the service worker's own
declare const self: ServiceWorkerGlobalScope;
/** Every file of the app but this one, as path → SHA-256 in hex; put in by scripts/build.mjs. */
declare const APP_FILES: Record<string, string>;

const CACHE = "zamazpdf";
const scope = self.registration.scope;
const keyOf = (path: string) => `${new URL(path, scope).href}?sha256=${APP_FILES[path]}`;

self.addEventListener("install", (event) => event.waitUntil(install()));
self.addEventListener("activate", (event) => event.waitUntil(removeOldFiles()));
self.addEventListener("fetch", (event) => {
	const path = appFile(event.request);
	if (path) event.respondWith(fromCache(path, event.request));
});

async function install() {
	const cache = await caches.open(CACHE);
	await Promise.all(
		Object.entries(APP_FILES).map(async ([path, sum]) => {
			if (await cache.match(keyOf(path))) return; // unchanged since the version before
			// "no-cache": the server answers "not modified" when the browser has the file already, as it has
			// right after the first visit, so nothing is downloaded twice. The page is asked for by the folder's
			// address, as the browser and the installed app open it.
			const url = path === "index.html" ? scope : new URL(path, scope);
			const response = await fetch(url, { cache: "no-cache" });
			const body = await response.arrayBuffer();
			// A file that does not match its sum, e.g. from a server halfway through an update, stops the install;
			// the browser tries again at the next start.
			if (!response.ok || (await sha256(body)) !== sum) throw new Error(`${path} is not the file of this version`);
			// Only the headers that tell the browser what the file is and what it may do: the body is already
			// unpacked, so the server's Content-Length and Content-Encoding would no longer be true.
			const headers = new Headers();
			for (const name of ["Content-Type", "Content-Security-Policy"]) {
				const value = response.headers.get(name);
				if (value) headers.set(name, value);
			}
			await cache.put(keyOf(path), new Response(body, { headers }));
		}),
	);
}

async function removeOldFiles() {
	const current = new Set(Object.keys(APP_FILES).map(keyOf));
	const cache = await caches.open(CACHE);
	for (const request of await cache.keys()) if (!current.has(request.url)) await cache.delete(request);
}

/** The app's file a request asks for, if it asks for one: a GET of a file in the app's folder. */
function appFile(request: Request): string | undefined {
	if (request.method !== "GET" || !request.url.startsWith(scope)) return;
	const path = new URL(request.url).pathname.slice(new URL(scope).pathname.length) || "index.html";
	return Object.hasOwn(APP_FILES, path) ? path : undefined;
}

async function fromCache(path: string, request: Request) {
	const cache = await caches.open(CACHE);
	// Missing only when the browser has cleared the site's storage: then from the server, as with no service worker.
	return (await cache.match(keyOf(path))) ?? fetch(request);
}

async function sha256(data: ArrayBuffer) {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
