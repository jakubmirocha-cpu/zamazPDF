// Messages between the page and the MuPDF worker.
import type { Page, Rect } from "./model";

/** What saving needs from the model: the sources and the pages, in the order of the result. */
export type SaveJob = {
	sources: { id: string; bytes: Uint8Array; password?: string }[];
	pages: (Pick<Page, "sourceId" | "sourcePageIndex" | "rotation"> & { redactions: Rect[] })[];
	/** "Zachowaj tekst": pages with redactions keep the rest of their text instead of becoming images. */
	keepText: boolean;
};

export type SaveResult =
	| {
			status: "ok";
			bytes: Uint8Array;
			/** Words that were under a redaction, so the file name can be checked for them. In memory only. */
			hiddenWords: string[];
			/** With keepText: pages with redactions (numbers from 1) saved as images all the same, their text not kept. */
			imagePages: number[];
			/** Pages (numbers from 1) saved as images because of text no one could see on them; it is gone from the file. */
			hiddenPages: number[];
	  }
	/** The autotest found something under a redaction even on a second try: no file is handed over. */
	| { status: "failed"; pages: number[] };

/** Reported while saving: pages built so far, then the autotest. */
export type SaveProgress = { phase: "building" | "checking"; done: number; total: number };

/** A page's text with where each character is: for "Szukaj i zamaż" and for snapping redactions to words. */
export type PageText = {
	/** The characters in reading order, with "\n" after every line. */
	text: string;
	/** For every UTF-16 unit of `text`: x0, y0, x1, y1 in page coordinates; all 0 for the line breaks. */
	boxes: Float32Array;
	/**
	 * The same for the ink: the outline of the character's glyph (src/worker/glyphs.ts), so that a redaction can
	 * stay clear of the lines above and below, whose boxes reach into its line. The box where no glyph is found.
	 */
	ink: Float32Array;
	/** "none": nothing to search (empty, or text turned into curves or an image); "unreadable": no ToUnicode. */
	kind: "text" | "none" | "unreadable";
	/** A scan with a text layer (invisible text, or text over a page-size image): positions may be off. */
	scan: boolean;
	width: number;
	height: number;
};

/** Page size in points, in page coordinates (source /Rotate and CropBox applied). */
export type PageSize = { width: number; height: number };

export type OpenResult =
	/** `signed`: signed electronically, so redacting ends the signature's validity. */
	| { status: "opened"; pages: PageSize[]; signed: boolean }
	| { status: "password-required" }
	| { status: "wrong-password" };

/**
 * What the page can ask the worker to do. Documents are kept open in the worker under the id of their
 * Source until close().
 */
export type EngineApi = {
	open(sourceId: string, bytes: Uint8Array): OpenResult;
	unlock(sourceId: string, password: string): OpenResult;
	close(sourceId: string): void;
	/** The page at `scale` device pixels per point, on white. */
	renderPage(sourceId: string, pageIndex: number, scale: number): ImageBitmap;
	extractText(sourceId: string, pageIndex: number): PageText;
	/** Builds the saved file, reporting SaveProgress on the way. */
	save(job: SaveJob): SaveResult;
};

export type Method = keyof EngineApi;

export type Call = {
	[M in Method]: { type: "call"; id: number; method: M; args: Parameters<EngineApi[M]> };
}[Method];

/** Page → worker. The first message carries MuPDF's WASM, base64-encoded as it comes in assets/mupdf-wasm.js. */
export type ToWorker = { type: "init"; wasmBase64: string } | Call;

/** Worker → page. */
export type FromWorker =
	| { type: "ready"; mupdfInitMs: number }
	| { type: "fatal"; message: string }
	| { type: "result"; id: number; value: unknown }
	| { type: "progress"; id: number; value: unknown }
	| { type: "error"; id: number; message: string };
