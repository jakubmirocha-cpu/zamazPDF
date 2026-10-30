// Runs before MuPDF initialises (main.ts imports it first): waits for the WASM from the page and hands
// the bytes to MuPDF, so MuPDF never tries to fetch mupdf-wasm.wasm. Nothing may be fetched.
import type { ToWorker } from "../shared/engine-protocol";

type Init = Extract<ToWorker, { type: "init" }>;

// The page sends the WASM first, before any call (src/app/engine.ts).
const init = await new Promise<Init>((resolve) => {
	self.addEventListener("message", (e: MessageEvent<Init>) => resolve(e.data), { once: true });
});

export const wasmArrivedAt = performance.now();

const binary = atob(init.wasmBase64);
const wasmBinary = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) wasmBinary[i] = binary.charCodeAt(i);

// Declared (as any) by MuPDF's own types.
globalThis.$libmupdf_wasm_Module = { wasmBinary, locateFile: (path: string) => path };
