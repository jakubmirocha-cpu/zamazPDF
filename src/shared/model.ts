// The document model. The interface shows and changes it; saving only reads it.

export type Rect = { x: number; y: number; w: number; h: number };

export type Source = { id: string; kind: "pdf"; name: string; bytes: Uint8Array; password?: string }; // PDF only

export type PdfSource = Extract<Source, { kind: "pdf" }>;

export type Page = {
	id: string;
	sourceId: string;
	sourcePageIndex: number;
	/** Points, in the page coordinate system: MuPDF's page.getBounds() of the source page. */
	width: number;
	height: number;
	rotation: 0 | 90 | 180 | 270; // added by the user, separate from the source's /Rotate
	redactions: Redaction[];
};

export type Redaction = {
	id: string;
	rect: Rect; // in page coordinates (points), never screen pixels
	origin: "manual" | "search" | "detector" | "ocr";
};

/** Sources are read-only; the saved file is always built anew from this. */
export type Doc = {
	sources: Source[];
	pages: Page[];
};

let lastId = 0;
export const newId = (prefix: string) => `${prefix}${++lastId}`;
