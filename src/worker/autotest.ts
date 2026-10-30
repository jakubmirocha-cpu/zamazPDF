// The autotest: before a file is handed over, it is opened again and every page with redactions
// is drawn through our own MuPDF device, which records what the page really draws. Under no redaction may
// anything remain but the redaction itself: no text (also invisible), no line art, no shading, and images
// only where their pixels there are uniform. The rule: whatever touches a redaction
// at all is under it; no margin. Text next to a redaction, or the same words elsewhere, are no failure.
import * as mupdf from "mupdf";
import { pageRectToView } from "../shared/coords";
import type { Page, Rect } from "../shared/model";
import { boxOf, glyphBox, overlaps, transform, type Box } from "./glyphs";

export type CheckedPage = Pick<Page, "width" | "height" | "rotation"> & {
	redactions: Rect[];
	/** Saved as one image of the page: then the page must draw exactly one image and nothing else. */
	flattened: boolean;
};

export type AutotestResult = {
	/** Indexes (from 0) of the pages that failed, each with what was found. */
	pages: { index: number; problems: string[] }[];
	/** What the file as a whole must not have. */
	document: string[];
};

/** How far the pixels of an image under a redaction may differ: JPEG blurs the edge of the black box a little. */
const IMAGE_TOLERANCE = 96;
/** In image pixels: far below one pixel, above the rounding error of MuPDF's single-precision matrices. */
const EDGE = 0.01;

const CATALOG_KEYS = new Set(["Type", "Pages"]);
const PAGE_KEYS = new Set(["Type", "Parent", "MediaBox", "CropBox", "Rotate", "Resources", "Contents", "Group"]);
const TRAILER_KEYS = new Set(["Size", "Root", "ID"]);
/** Keys that may not appear in any object of the file. */
const FORBIDDEN_KEYS = ["Metadata", "JavaScript", "JS", "EmbeddedFiles", "EmbeddedFile", "AA", "OpenAction", "AcroForm", "Annots", "Outlines", "PieceInfo", "AF", "StructTreeRoot", "OCProperties", "Perms", "SigFlags"];
const FORBIDDEN_TYPES = new Set(["Sig", "EmbeddedFile", "Filespec", "Annot", "Metadata", "Action"]);

const fromRect = (r: mupdf.Rect): Box => ({ x0: r[0], y0: r[1], x1: r[2], y1: r[3] });

export function autotest(bytes: Uint8Array, pages: CheckedPage[]): AutotestResult {
	const doc = new mupdf.PDFDocument(bytes);
	try {
		const failed = pages.flatMap((page, index) => {
			if (page.redactions.length === 0 && !page.flattened) return [];
			const problems = checkPage(doc, index, page);
			return problems.length ? [{ index, problems }] : [];
		});
		return { pages: failed, document: checkDocument(doc) };
	} finally {
		doc.destroy();
	}
}

function checkPage(doc: mupdf.PDFDocument, index: number, page: CheckedPage): string[] {
	// Redactions are in the coordinates of the source page; the saved page may be turned by the user.
	const redactions = page.redactions.map((r) => {
		const v = pageRectToView(r, page, 1);
		return { x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h };
	});
	const under = (box: Box) => redactions.some((r) => overlaps(r, box));
	const problems: string[] = [];
	let images = 0;
	let other = 0;

	const text = (kind: string) => (t: mupdf.Text, ctm: mupdf.Matrix) => {
		other++;
		t.walk({
			showGlyph(font, trm, glyph, unicode) {
				if (under(glyphBox(font, glyph, mupdf.Matrix.concat(trm, ctm), unicode))) problems.push(kind);
			},
		});
	};
	const lineArt = (kind: string) => (path: mupdf.Path, stroke: mupdf.StrokeState | null, ctm: mupdf.Matrix, colorspace: mupdf.ColorSpace, color: number[]) => {
		other++;
		const box = fromRect(path.getBounds(stroke as mupdf.StrokeState, ctm));
		if (under(box) && !(kind === "fill" && isOurRedaction(box, redactions, colorspace, color))) problems.push(`line art (${kind})`);
	};
	const image = (kind: string) => (img: mupdf.Image, ctm: mupdf.Matrix) => {
		if (kind === "image") images++;
		else other++;
		const box = boxOf([...transform(ctm, 0, 0), ...transform(ctm, 1, 0), ...transform(ctm, 0, 1), ...transform(ctm, 1, 1)]);
		// The mask counts too: a soft mask can hold the shape of the text the image's pixels no longer show.
		const mask = img.getMask();
		for (const r of redactions) {
			if (overlaps(r, box) && !(uniformUnder(img, ctm, r) && (!mask || uniformUnder(mask, ctm, r)))) problems.push(kind);
		}
	};

	const device = new mupdf.Device({
		fillText: text("text"),
		strokeText: (t, _stroke, ctm) => text("text")(t, ctm),
		clipText: text("text used as a clip"),
		clipStrokeText: (t, _stroke, ctm) => text("text used as a clip")(t, ctm),
		ignoreText: text("invisible text"),
		fillPath: (path, _evenOdd, ctm, colorspace, color) => lineArt("fill")(path, null, ctm, colorspace, color),
		strokePath: (path, stroke, ctm, colorspace, color) => lineArt("stroke")(path, stroke, ctm, colorspace, color),
		fillShade(shade, ctm) {
			other++;
			const [x0, y0, x1, y1] = shade.getBounds();
			const box = boxOf([...transform(ctm, x0, y0), ...transform(ctm, x1, y0), ...transform(ctm, x0, y1), ...transform(ctm, x1, y1)]);
			if (under(box)) problems.push("shading");
		},
		fillImage: image("image"),
		fillImageMask: image("image mask"),
		clipImageMask: image("image mask used as a clip"),
		beginTile(area, _view, _xstep, _ystep, ctm) {
			other++;
			if (under(boxOf([...transform(ctm, area[0], area[1]), ...transform(ctm, area[2], area[3])]))) problems.push("pattern");
			return 0;
		},
	});
	const loaded = doc.loadPage(index);
	try {
		loaded.run(device, mupdf.Matrix.identity);
		device.close();
	} finally {
		device.destroy();
		loaded.destroy();
	}
	if (page.flattened && (images !== 1 || other !== 0)) problems.push(`page image: ${images} images and ${other} other things drawn`);
	return [...new Set(problems)];
}

/** "Keep text" mode draws its own black box: a filled black shape exactly over a redaction is no failure. */
function isOurRedaction(box: Box, redactions: Box[], colorspace: mupdf.ColorSpace, color: number[]) {
	const black =
		colorspace.getNumberOfComponents() === 4 ? color[3]! >= 0.99 && color.slice(0, 3).every((c) => c <= 0.01) : color.every((c) => c <= 0.01);
	const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;
	return black && redactions.some((r) => near(r.x0, box.x0) && near(r.y0, box.y0) && near(r.x1, box.x1) && near(r.y1, box.y1));
}

/** Are the image's pixels that a redaction touches all (nearly) the same? */
function uniformUnder(image: mupdf.Image, ctm: mupdf.Matrix, r: Box): boolean {
	const pixmap = image.toPixmap();
	try {
		const [w, h, n, stride] = [pixmap.getWidth(), pixmap.getHeight(), pixmap.getNumberOfComponents(), pixmap.getStride()];
		// The image fills the unit square: from the page back into image pixels, rounding outward. MuPDF keeps
		// matrices in single precision, so an edge exactly between two pixels comes back a hair off (199.99998
		// for 200); EDGE keeps that from pulling in the pixel next to the redaction.
		const inverse = mupdf.Matrix.invert(ctm);
		const unit = boxOf([...transform(inverse, r.x0, r.y0), ...transform(inverse, r.x1, r.y0), ...transform(inverse, r.x0, r.y1), ...transform(inverse, r.x1, r.y1)]);
		const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
		const [x0, x1] = [clamp(Math.floor(unit.x0 * w + EDGE), w), clamp(Math.ceil(unit.x1 * w - EDGE), w)];
		const [y0, y1] = [clamp(Math.floor(unit.y0 * h + EDGE), h), clamp(Math.ceil(unit.y1 * h - EDGE), h)];
		const samples = pixmap.getPixels();
		const low = new Array(n).fill(255);
		const high = new Array(n).fill(0);
		for (let y = y0; y < y1; y++) {
			for (let x = x0; x < x1; x++) {
				for (let c = 0; c < n; c++) {
					const v = samples[y * stride + x * n + c]!;
					if (v < low[c]) low[c] = v;
					if (v > high[c]) high[c] = v;
				}
			}
		}
		return high.every((v, c) => v - low[c] <= IMAGE_TOLERANCE);
	} finally {
		pixmap.destroy();
	}
}

/** No metadata, attachments, scripts, forms, signatures, comments or earlier versions in the file. */
function checkDocument(doc: mupdf.PDFDocument): string[] {
	const problems: string[] = [];
	const keys = (obj: mupdf.PDFObject) => {
		const found: string[] = [];
		obj.forEach((_, key) => found.push(String(key)));
		return found;
	};
	if (doc.countVersions() !== 1) problems.push("earlier versions inside the file");
	for (const key of keys(doc.getTrailer())) if (!TRAILER_KEYS.has(key)) problems.push(`trailer: ${key}`);
	for (const key of keys(doc.getTrailer().get("Root"))) if (!CATALOG_KEYS.has(key)) problems.push(`catalog: ${key}`);
	for (let i = 0; i < doc.countPages(); i++) {
		for (const key of keys(doc.findPage(i))) if (!PAGE_KEYS.has(key)) problems.push(`page ${i + 1}: ${key}`);
	}
	for (let num = 1; num < doc.countObjects(); num++) {
		const obj = doc.newIndirect(num);
		if (!obj.isDictionary()) continue;
		for (const key of FORBIDDEN_KEYS) if (!obj.get(key).isNull()) problems.push(`object ${num}: ${key}`);
		const type = obj.get("Type");
		if (type.isName() && FORBIDDEN_TYPES.has(type.asName())) problems.push(`object ${num}: ${type.asName()}`);
	}
	return [...new Set(problems)];
}
