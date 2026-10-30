// Starts the MuPDF worker and passes calls to it. The worker's code comes inside this script (scripts/build.mjs)
// and runs from a blob: URL, so the page's CSP binds it too. MuPDF's WASM comes in a script of its own, which
// a browser loads from disk as well as from a server; the page hands it to the worker.
import type { Call, EngineApi, FromWorker, Method, ToWorker } from "../shared/engine-protocol";

export type EngineState =
	| { status: "starting" }
	| { status: "ready"; readyAtMs: number }
	| { status: "failed"; message: string };

let state: EngineState = { status: "starting" };
const listeners = new Set<() => void>();

let worker: Worker | null = null;
let nextCallId = 1;
const pending = new Map<
	number,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: (value: unknown) => void }
>();
// The worker listens for calls only once MuPDF is up, so calls made earlier wait here.
const waiting: Call[] = [];

function setState(next: EngineState) {
	state = next;
	// Read by the automated tests: the page reports engine readiness without any global variables.
	document.documentElement.dataset.engine = next.status;
	if (next.status === "ready") {
		document.documentElement.dataset.engineReadyMs = String(next.readyAtMs);
		for (const call of waiting.splice(0)) worker!.postMessage(call);
	}
	if (next.status === "failed") {
		waiting.length = 0;
		for (const { reject } of pending.values()) reject(new Error(next.message));
		pending.clear();
	}
	for (const listener of listeners) listener();
}

export const engineState = {
	get: () => state,
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function startEngine(): void {
	setState(state);
	try {
		worker = new Worker(URL.createObjectURL(new Blob([ENGINE_WORKER_CODE], { type: "text/javascript" })));
		worker.onerror = (e) => setState({ status: "failed", message: e.message || "worker error" });
		worker.onmessage = (e: MessageEvent<FromWorker>) => {
			const message = e.data;
			if (message.type === "ready") setState({ status: "ready", readyAtMs: Math.round(performance.now()) });
			else if (message.type === "fatal") setState({ status: "failed", message: message.message });
			else if (message.type === "progress") pending.get(message.id)?.onProgress?.(message.value);
			else {
				const call = pending.get(message.id);
				pending.delete(message.id);
				if (message.type === "result") call?.resolve(message.value);
				else call?.reject(new Error(message.message));
			}
		};
		const script = document.createElement("script");
		script.src = ENGINE_SCRIPT;
		script.onload = () => {
			const scope = globalThis as { MUPDF_WASM?: string };
			const init: ToWorker = { type: "init", wasmBase64: scope.MUPDF_WASM ?? "" };
			delete scope.MUPDF_WASM; // the worker keeps its copy; the page has no use for 14 MB of text
			worker!.postMessage(init);
		};
		script.onerror = () => setState({ status: "failed", message: `${ENGINE_SCRIPT} did not load` });
		document.head.append(script);
	} catch (e) {
		setState({ status: "failed", message: String(e) });
	}
}

/** Runs `method` in the worker. Arguments are copied, not transferred: the page keeps its own data. */
export function call<M extends Method>(method: M, ...args: Parameters<EngineApi[M]>): Promise<ReturnType<EngineApi[M]>> {
	return callWithProgress(method, args);
}

/** Like call(), and `onProgress` hears what the worker reports on the way (save: SaveProgress). */
export function callWithProgress<M extends Method>(
	method: M,
	args: Parameters<EngineApi[M]>,
	onProgress?: (value: unknown) => void,
): Promise<ReturnType<EngineApi[M]>> {
	return new Promise((resolve, reject) => {
		if (state.status === "failed") return reject(new Error(state.message));
		const id = nextCallId++;
		pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
		const message = { type: "call", id, method, args } as Call;
		if (state.status === "ready") worker!.postMessage(message);
		else waiting.push(message);
	});
}
