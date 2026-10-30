// Put in by scripts/build.mjs.

/** The engine worker's code, started from a blob: URL (src/app/engine.ts). */
declare const ENGINE_WORKER_CODE: string;
/** The script with MuPDF's WASM, next to the page; it sets self.MUPDF_WASM (base64). */
declare const ENGINE_SCRIPT: string;
/**
 * The version: its name (package.json), the git commit it was built from (null outside a git repository), and
 * whether the files differ from that commit.
 */
declare const APP_VERSION: { name: string; commit: string | null; changed: boolean };
/** The app's code on GitHub (package.json, repository). */
declare const SOURCE_URL: string;
