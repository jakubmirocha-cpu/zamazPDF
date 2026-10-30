// The MuPDF worker. All PDF work happens here, so the interface never freezes.
// Built as a classic worker started from a blob: URL; see scripts/build.mjs.
import { wasmArrivedAt } from "./setup";
import * as mupdf from "mupdf";
import type { EngineApi, FromWorker, Method, OpenResult, ToWorker } from "../shared/engine-protocol";
import { save } from "./save";
import { isSigned } from "./signature";
import { pageText } from "./text";

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer);

/** Reports progress of the call being handled. Calls that use it run without a pause, so it cannot mix two up. */
let progress: (value: unknown) => void = () => {};

type Handlers = {
	[M in Method]: (...args: Parameters<EngineApi[M]>) => ReturnType<EngineApi[M]> | Promise<ReturnType<EngineApi[M]>>;
};

/** Open documents by Source id. A password-protected one waits here for unlock(). */
const documents = new Map<string, mupdf.Document>();

function documentFor(sourceId: string) {
	const doc = documents.get(sourceId);
	if (!doc) throw new Error(`no open document ${sourceId}`);
	return doc;
}

function opened(doc: mupdf.Document): OpenResult {
	const pages = [];
	for (let i = 0; i < doc.countPages(); i++) {
		const page = doc.loadPage(i);
		const [x0, y0, x1, y1] = page.getBounds();
		pages.push({ width: x1 - x0, height: y1 - y0 });
		page.destroy();
	}
	return { status: "opened", pages, signed: isSigned(doc) };
}

const handlers: Handlers = {
	open(sourceId, bytes) {
		const doc = mupdf.Document.openDocument(bytes, "application/pdf");
		documents.set(sourceId, doc);
		return doc.needsPassword() ? { status: "password-required" } : opened(doc);
	},

	unlock(sourceId, password) {
		const doc = documentFor(sourceId);
		return doc.authenticatePassword(password) ? opened(doc) : { status: "wrong-password" };
	},

	close(sourceId) {
		documents.get(sourceId)?.destroy();
		documents.delete(sourceId);
	},

	renderPage(sourceId, pageIndex, scale) {
		const page = documentFor(sourceId).loadPage(pageIndex);
		try {
			const matrix = mupdf.Matrix.scale(scale, scale);
			const [x0, y0, x1, y1] = mupdf.Rect.transform(page.getBounds(), matrix);
			// Opaque white RGBA: the samples can go straight into ImageData, no conversion.
			const bbox: mupdf.Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
			const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);
			pixmap.clear(255);
			const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
			page.run(device, matrix); // contents, annotations and form fields: what the user sees
			device.close();
			device.destroy();
			const image = new ImageData(new Uint8ClampedArray(pixmap.getPixels()), pixmap.getWidth(), pixmap.getHeight());
			pixmap.destroy();
			return createImageBitmap(image);
		} finally {
			page.destroy();
		}
	},

	extractText(sourceId, pageIndex) {
		const page = documentFor(sourceId).loadPage(pageIndex);
		try {
			return pageText(page);
		} finally {
			page.destroy();
		}
	},

	save(job) {
		return save(job, progress);
	},
};

/** Results moved to the page rather than copied: rendered pages, saved files, character boxes. */
function transferables(value: unknown): Transferable[] {
	if (value instanceof ImageBitmap) return [value];
	if (!value || typeof value !== "object") return [];
	if ("bytes" in value && value.bytes instanceof Uint8Array) return [value.bytes.buffer as ArrayBuffer];
	if ("boxes" in value && value.boxes instanceof Float32Array && "ink" in value && value.ink instanceof Float32Array) {
		return [value.boxes.buffer as ArrayBuffer, value.ink.buffer as ArrayBuffer];
	}
	return [];
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
	const message = e.data;
	if (message.type !== "call") return;
	try {
		const handler = handlers[message.method] as (...args: unknown[]) => unknown;
		progress = (value) => post({ type: "progress", id: message.id, value });
		const value = await handler(...message.args);
		post({ type: "result", id: message.id, value }, transferables(value));
	} catch (error) {
		post({ type: "error", id: message.id, message: String((error as Error)?.message ?? error) });
	}
};

// Prove the engine really works before reporting it ready: build and save an empty PDF.
const probe = new mupdf.PDFDocument();
probe.insertPage(-1, probe.addPage([0, 0, 595, 842], 0, {}, ""));
probe.saveToBuffer("").destroy();
probe.destroy();

post({ type: "ready", mupdfInitMs: Math.round(performance.now() - wasmArrivedAt) });
