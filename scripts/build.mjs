// Builds the app into dist/: plain files that work opened from disk by double-click and, as they are, from
// zamazpdf.pl. A browser loads scripts and stylesheets from disk but fetches nothing there,
// so everything is a script or a stylesheet:
//   index.html             the page, copied from src/index.html
//   app.js, app.css        the interface; the engine worker's code inside app.js, the fonts inside app.css
//   assets/mupdf-wasm.js   MuPDF's WASM (the engine), base64-encoded in a script
//   manifest.webmanifest   for installing the app (PWA), with the icons inside
//   jak-to-dziala.html, polityka-prywatnosci.html   the information pages from src/pages, no scripts; the version put in
//   licencje.txt           the licences of the code and the font inside the app
//   .htaccess              the server's settings (Apache)
//   sw.js                  the service worker, with the SHA-256 of every other file; from a server only
// The worker is started from a blob: URL, so the page's CSP binds it too.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng } from "./icon.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

const common = {
	bundle: true,
	write: false,
	platform: "browser",
	target: "es2022",
	minify: true,
	charset: "ascii",
	logLevel: "warning",
	metafile: true, // which packages went in: licencje.txt
};

copyFileSync(join(root, "src/index.html"), join(dist, "index.html"));

// The version, shown on the start screen with the link to its code on GitHub: its name from
// package.json, and the commit it was built from, so anyone can compare the app with the code, and whether the
// files differ from that commit. No commit outside git.
const { repository, version: versionName } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = { name: versionName, ...gitVersion() };

// The information pages: plain HTML with no script, styled by app.css. The privacy policy
// gives the version with its commit, {{version}}, linked to that code on GitHub ({{source}}).
const pages = readdirSync(join(root, "src/pages")).filter((name) => name.endsWith(".html"));
const versionText = version.commit
	? `${version.name} (${version.commit.slice(0, 7)}${version.changed ? " + zmiany" : ""})`
	: version.name;
const sourceUrl = version.commit ? `${repository.url}/tree/${version.commit}` : repository.url;
for (const page of pages) {
	const html = readFileSync(join(root, "src/pages", page), "utf8");
	writeFileSync(join(dist, page), html.replaceAll("{{version}}", versionText).replaceAll("{{source}}", sourceUrl));
}

// The page reads MUPDF_WASM once the script has run and hands it to the worker (src/app/engine.ts).
const engineFile = "assets/mupdf-wasm.js";
const wasm = readFileSync(join(root, "node_modules/mupdf/dist/mupdf-wasm.wasm")).toString("base64");
writeFileSync(join(dist, engineFile), `self.MUPDF_WASM="${wasm}";\n`);

// The worker is a classic script started from a blob: URL: Chromium refuses module workers from blob: on pages
// opened from disk. So no import/export may remain in the ESM bundle, and top-level await goes into a function.
const worker = await build({
	...common,
	entryPoints: [join(root, "src/worker/main.ts")],
	format: "esm",
	external: ["module", "node:*"], // MuPDF imports these only when running under Node
});
const workerEsm = worker.outputFiles[0].text;
if (/^\s*(import\s*[^(\s]|export\s)/m.test(workerEsm)) throw new Error("worker bundle still has a static import/export");
const workerJs =
	"(async()=>{" +
	workerEsm.replaceAll("import.meta.url", "self.location.href") +
	'})().catch(e=>postMessage({type:"fatal",message:String(e&&e.stack||e)}));';

const app = await build({
	...common,
	entryPoints: { app: join(root, "src/app/main.tsx") },
	format: "iife",
	outdir: dist,
	jsx: "automatic",
	loader: { ".woff2": "dataurl" },
	define: {
		"process.env.NODE_ENV": '"production"',
		// src/app/build.d.ts
		ENGINE_WORKER_CODE: JSON.stringify(workerJs),
		ENGINE_SCRIPT: JSON.stringify(engineFile),
		APP_VERSION: JSON.stringify(version),
		SOURCE_URL: JSON.stringify(repository.url),
	},
});
for (const file of app.outputFiles) writeFileSync(file.path, file.contents);

// Every package the app and the worker took from node_modules, with its licence file as it came, after a list of
// them all. The BOM tells a browser showing the file that it is UTF-8.
const packages = [worker, app]
	.flatMap((result) => Object.keys(result.metafile.inputs))
	.map((input) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1])
	.filter((name, i, all) => name && all.indexOf(name) === i)
	.toSorted()
	.map((name) => ({ name, ...JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")) }));
const licence = ({ name }) => readFileSync(join(root, "node_modules", name, "LICENSE"), "utf8").trim();
writeFileSync(
	join(dist, "licencje.txt"),
	"﻿Zamaż PDF — licencje\n\n" +
		`Zamaż PDF: GNU AGPL-3.0 lub późniejsza, kod źródłowy: ${repository.url}\n\n` +
		"W aplikacji są też te programy i czcionka, każde na swojej licencji:\n\n" +
		packages.map((p) => `  ${p.name} ${p.version} (${p.license})\n`).join("") +
		packages.map((p) => `\n\n${"=".repeat(78)}\n${p.name} ${p.version}\n${"=".repeat(78)}\n\n${licence(p)}\n`).join(""),
);

// The icons go into the manifest as data: URLs. The browser downloads them under the page's CSP, which lets
// images come from blob: and data: only (img-src): icon files next to the page would be blocked.
const manifest = JSON.parse(readFileSync(join(root, "src/manifest.webmanifest"), "utf8"));
for (const icon of manifest.icons) {
	icon.src = `data:image/png;base64,${Buffer.from(iconPng(Number.parseInt(icon.sizes))).toString("base64")}`;
}
writeFileSync(join(dist, "manifest.webmanifest"), `${JSON.stringify(manifest, null, "\t")}\n`);

// The server's settings, with the CSP of the pages as they are: the header and the <meta> cannot drift apart.
const cspOf = (html) => {
	const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
	if (!csp) throw new Error("a page without a CSP");
	return csp;
};
const pageCsps = new Set(pages.map((page) => cspOf(readFileSync(join(root, "src/pages", page), "utf8"))));
if (pageCsps.size !== 1) throw new Error("the information pages differ in their CSP, and .htaccess has one for them");
writeFileSync(
	join(dist, ".htaccess"),
	readFileSync(join(root, "src/.htaccess"), "utf8")
		.replace("{{csp-app}}", cspOf(readFileSync(join(root, "src/index.html"), "utf8")))
		.replace("{{csp-pages}}", [...pageCsps][0]),
);

// Last, as it lists every other file with its SHA-256: a change in any file makes a new sw.js, and that is how the
// browser learns of a new version. Not minified, so anyone can read what it does and which files it keeps. Not
// .htaccess: no server gives that file out, and one file missing would stop the install.
const sums = Object.fromEntries(
	readdirSync(dist, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name !== ".htaccess")
		.map((entry) => relative(dist, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
		.toSorted()
		.map((path) => [path, createHash("sha256").update(readFileSync(join(dist, path))).digest("hex")]),
);
const sw = await build({
	...common,
	entryPoints: [join(root, "src/sw/main.ts")],
	format: "iife",
	minify: false,
	define: { APP_FILES: JSON.stringify(sums) },
});
writeFileSync(join(dist, "sw.js"), sw.outputFiles[0].contents);

const kB = (bytes) => `${Math.round(bytes / 1e3)} kB`;
console.log(
	`dist/: index.html, ${app.outputFiles.map((f) => `${basename(f.path)} ${kB(f.contents.length)}`).join(", ")}` +
		` (worker ${kB(workerJs.length)} inside app.js), ${engineFile} ${kB(wasm.length)}, manifest.webmanifest,` +
		` ${pages.join(", ")}, licencje.txt (${packages.map((p) => p.name).join(", ")}), sw.js`,
);
console.log(
	`version ${version.name}, ` +
		(version.commit
			? `commit ${version.commit.slice(0, 7)}${version.changed ? ", with changes not committed" : ""}`
			: "commit unknown: not built from a git repository"),
);

function gitVersion() {
	try {
		const git = (...args) =>
			execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return { commit: git("rev-parse", "HEAD"), changed: git("status", "--porcelain") !== "" };
	} catch {
		return { commit: null, changed: false };
	}
}
