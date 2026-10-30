// Builds the saved file. The result is always a new document; from the source it gets
// only what the whitelist below names, so nothing has to be remembered in order to be removed. Pages with
// redactions become one image each, with every pixel a redaction touches turned black; in "Zachowaj tekst"
// MuPDF removes what is under the redactions from the page instead, and the rest of its text stays text.
import * as mupdf from "mupdf";
import { outward, pageRectToView } from "../shared/coords";
import type { SaveJob, SaveProgress, SaveResult } from "../shared/engine-protocol";
import type { Rect } from "../shared/model";
import { autotest, type CheckedPage } from "./autotest";
import { boxOfRect, emBox, glyphBox, overlaps, type Box } from "./glyphs";
import { hasHiddenContent } from "./hidden-content";
import { stripJpegMetadata } from "./jpeg";
import { stripMarkedContent } from "./marked-content";
import { pageContent } from "./page-content";
import { pngData } from "./png";

const PT_PER_INCH = 72;
/** Pages with redactions are rendered at this resolution… */
const DPI = 200;
/** …and scans at their own, but no finer than this. */
const SCAN_DPI_MAX = 300;
const JPEG_QUALITY = 85;

/** Never carried into the result, wherever they sit: hidden data, links to other files, layers, structure. */
const DROPPED_KEYS = ["Metadata", "PieceInfo", "AF", "OC", "OPI", "Alternates", "Ref", "StructParent", "StructParents", "LastModified"];

type JobPage = SaveJob["pages"][number];
type Prepared = { doc: mupdf.PDFDocument; flattenAll: boolean };

/** An image whose metadata cannot be removed: the whole result is then made of page images. */
class Uncleanable extends Error {}

/** How a build differs from the plain one: after an uncleanable image, or after pages failed the autotest. */
type BuildOptions = {
	flattenEverything: boolean;
	/** Pages redacted by MuPDF ("Zachowaj tekst") that failed: made as page images instead. */
	asImage: Set<number>;
	/** Page images that failed: made again without JPEG. */
	lossless: Set<number>;
};

/**
 * Builds the file and runs the autotest on it. A page that fails is made again from scratch,
 * one step safer each time: with its text kept → as a page image → as a lossless page image. When a page
 * fails even then, no file is handed over at all. `check` is always the autotest; the tests swap it to
 * reach the retries and the refusal.
 */
export function save(job: SaveJob, progress: (p: SaveProgress) => void, check = autotest): SaveResult {
	const sources = new Map(job.sources.map((source) => [source.id, prepare(source)]));
	try {
		// Read before anything is removed: the words under the redactions, for the file name.
		const hiddenWords = hiddenWordsOf(job, sources);
		const keptText = job.keepText ? redactKeepingText(job, sources) : new Set<number>();
		let options: BuildOptions = { flattenEverything: false, asImage: new Set(), lossless: new Set() };
		for (;;) {
			let built: Built;
			try {
				built = build(job, sources, keptText, options, progress);
			} catch (error) {
				if (!(error instanceof Uncleanable) || options.flattenEverything) throw error;
				options = { ...options, flattenEverything: true };
				continue;
			}
			progress({ phase: "checking", done: 0, total: job.pages.length });
			const result = check(built.bytes, built.checked);
			if (result.pages.length === 0 && result.document.length === 0) {
				const imagePages = job.keepText ? built.checked.flatMap((p, i) => (p.redactions.length > 0 && p.flattened && !built.hiddenPages.includes(i + 1) ? [i + 1] : [])) : [];
				return { status: "ok", bytes: built.bytes, hiddenWords, imagePages, hiddenPages: built.hiddenPages };
			}
			const next: BuildOptions = { ...options, asImage: new Set(options.asImage), lossless: new Set(options.lossless) };
			let stuck = result.document.length > 0;
			for (const { index } of result.pages) {
				if (!built.checked[index]!.flattened) next.asImage.add(index);
				else if (!options.lossless.has(index)) next.lossless.add(index);
				else stuck = true;
			}
			if (stuck) {
				console.error("autotest failed", JSON.stringify(result)); // stays in this browser's console: page numbers and kinds only
				return { status: "failed", pages: result.pages.map((p) => p.index + 1) };
			}
			options = next;
		}
	} finally {
		for (const { doc } of sources.values()) doc.destroy();
	}
}

type Built = { bytes: Uint8Array; checked: CheckedPage[]; hiddenPages: number[] };

/**
 * A working copy of a source , the source itself untouched: annotations and form
 * fields baked into the page content, the encryption taken off (MuPDF would keep it), and each page's
 * resources cut down to what its content uses. MuPDF's "sanitize" does that cut, also inside forms drawn
 * on a page.
 */
function prepare(source: SaveJob["sources"][number]): Prepared {
	const baked = new mupdf.PDFDocument(source.bytes);
	try {
		if (baked.needsPassword() && !baked.authenticatePassword(source.password ?? "")) throw new Error("wrong password");
		baked.bake(true, true);
		// Hidden layers would show once the layer settings are gone, so a document with layers becomes images.
		const layers = !baked.getTrailer().get("Root", "OCProperties").isNull();
		try {
			return { doc: new mupdf.PDFDocument(baked.saveToBuffer("encrypt=none,sanitize")), flattenAll: layers };
		} catch {
			// Content MuPDF cannot rewrite can still be drawn: every page becomes an image.
			return { doc: new mupdf.PDFDocument(baked.saveToBuffer("encrypt=none")), flattenAll: true };
		}
	} finally {
		baked.destroy();
	}
}

/**
 * "Zachowaj tekst": MuPDF removes what is under the redactions from the page of the working
 * copy, which then goes through the whitelist like a page without redactions, the rest of its text still
 * text. Returns the pages done so; any other page with redactions becomes an image, as in the safe mode.
 */
function redactKeepingText(job: SaveJob, sources: Map<string, Prepared>): Set<number> {
	const done = new Set<number>();
	job.pages.forEach((page, i) => {
		const { doc, flattenAll } = sources.get(page.sourceId)!;
		if (page.redactions.length === 0 || flattenAll) return;
		const loaded = doc.loadPage(page.sourcePageIndex);
		try {
			if (redactPage(doc, loaded, page.redactions)) done.add(i);
		} catch {
			// What MuPDF cannot redact is drawn as an image of the page instead.
		} finally {
			loaded.destroy();
		}
	});
	return done;
}

/** For a character a redaction touches: the middle of its box, clear of the characters around it. */
const GLYPH_CORE = [0.25, 0.75, 0.1, 0.5] as const;

function redactPage(doc: mupdf.PDFDocument, page: mupdf.PDFPage, redactions: Rect[]): boolean {
	// The text goes by the autotest's rule: every character whose outline a redaction
	// touches. MuPDF's own rule is another (it takes a character's whole line height, shrunk by a tenth): it
	// keeps a character the redaction only grazes, and takes letters of the lines above and below that the
	// black box does not even reach. So the characters are named to MuPDF one by one, each by the middle of
	// its box, which MuPDF certainly removes and which reaches no other character, without black boxes…
	const touched = touchedGlyphs(page, redactions);
	if (touched.length > 0) applyRedactions(page, touched, false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
	// …then the redactions themselves, every parameter spelled out, the text already done.
	applyRedactions(page, redactions, true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED, mupdf.PDFPage.REDACT_TEXT_NONE);
	// The removed characters' text can live on in marked content (ActualText, Alt): that goes too.
	return stripMarkedContent(doc, page.getObject());
}

function applyRedactions(page: mupdf.PDFPage, rects: Rect[], blackBoxes: boolean, images: number, lineArt: number, text: number) {
	const annotations = rects.map((r) => {
		const annotation = page.createAnnotation("Redact");
		annotation.setRect([r.x, r.y, r.x + r.w, r.y + r.h]);
		return annotation;
	});
	page.applyRedactions(blackBoxes, images, lineArt, text);
	for (const annotation of annotations) annotation.destroy();
}

/**
 * The middles of the characters whose outline a redaction touches (the autotest's own glyph box). Neighbours
 * on one line come as one rectangle, which keeps a redaction across a whole page of text fast.
 */
function touchedGlyphs(page: mupdf.PDFPage, redactions: Rect[]): Rect[] {
	const boxes = redactions.map(boxOfRect);
	const cores: Box[] = [];
	const text = (t: mupdf.Text, ctm: mupdf.Matrix) =>
		t.walk({
			showGlyph(font, trm, glyph, unicode) {
				const m = mupdf.Matrix.concat(trm, ctm);
				if (!boxes.some((box) => overlaps(box, glyphBox(font, glyph, m, unicode)))) return;
				const core = emBox(font, glyph, m, ...GLYPH_CORE);
				// The next character of the line: closer than its own width (the core is half of it).
				const last = cores.at(-1);
				const sameLine = last && Math.abs(last.y0 - core.y0) < 0.01 && Math.abs(last.y1 - core.y1) < 0.01;
				if (sameLine && core.x0 >= last.x0 && core.x0 - last.x1 < 2 * (core.x1 - core.x0)) last.x1 = Math.max(last.x1, core.x1);
				else cores.push(core);
			},
		});
	const device = new mupdf.Device({
		fillText: text,
		strokeText: (t, _stroke, ctm) => text(t, ctm),
		clipText: text,
		clipStrokeText: (t, _stroke, ctm) => text(t, ctm),
		ignoreText: text,
	});
	try {
		page.run(device, mupdf.Matrix.identity);
		device.close();
	} finally {
		device.destroy();
	}
	return cores.map((c) => ({ x: c.x0, y: c.y0, w: c.x1 - c.x0, h: c.y1 - c.y0 }));
}

/** `keptText`: pages already redacted by MuPDF ("Zachowaj tekst"), which go through the whitelist. */
function build(job: SaveJob, sources: Map<string, Prepared>, keptText: Set<number>, options: BuildOptions, progress: (p: SaveProgress) => void): Built {
	const out = new mupdf.PDFDocument();
	const graft = out.newGraftMap();
	const hiddenPages: number[] = [];
	try {
		// Page by page: each page image is made, compressed into the result and freed before the next.
		const checked = job.pages.map((page, i): CheckedPage => {
			const { doc, flattenAll } = sources.get(page.sourceId)!;
			const redactions = page.redactions;
			const textKept = keptText.has(i) && !options.asImage.has(i);
			const hidden = !flattenAll && !options.flattenEverything && (redactions.length === 0 || textKept) && pageHasHiddenContent(doc, page.sourcePageIndex);
			if (hidden) hiddenPages.push(i + 1);
			let result: CheckedPage;
			if (hidden || flattenAll || options.flattenEverything || (redactions.length > 0 && !textKept)) {
				const size = addPageImage(out, doc, page, options.lossless.has(i));
				result = { ...size, rotation: page.rotation, redactions, flattened: true };
			} else {
				addWhitelisted(out, graft, doc, page);
				// Without redactions there is nothing to check; a page MuPDF redacted is checked like any other.
				const size = textKept ? sizeOf(doc, page.sourcePageIndex) : { width: 0, height: 0 };
				result = { ...size, rotation: page.rotation, redactions, flattened: false };
			}
			progress({ phase: "building", done: i + 1, total: job.pages.length });
			return result;
		});
		out.getTrailer().get("Root").delete("Info"); // where MuPDF puts its Producer in a new document
		scrub(out);
		// Always a full save; a new document gets no /ID, so the source's ID does not come along either.
		const bytes = out.saveToBuffer("garbage=deduplicate,compress").asUint8Array().slice();
		return { bytes, checked, hiddenPages };
	} finally {
		graft.destroy();
		out.destroy();
	}
}

function pageHasHiddenContent(doc: mupdf.PDFDocument, pageIndex: number) {
	const page = doc.loadPage(pageIndex);
	try {
		return hasHiddenContent(page);
	} finally {
		page.destroy();
	}
}

function sizeOf(doc: mupdf.PDFDocument, pageIndex: number) {
	const page = doc.loadPage(pageIndex);
	try {
		const [, , width, height] = page.getBounds(); // starts at 0,0
		return { width, height };
	} finally {
		page.destroy();
	}
}

/**
 * A page with redactions: the page as drawn, one image, the redactions burnt into its pixels.
 * `lossless`: never JPEG, used again for a page whose JPEG failed the autotest. Returns the page size.
 */
function addPageImage(out: mupdf.PDFDocument, doc: mupdf.PDFDocument, page: JobPage, lossless: boolean) {
	const source = doc.loadPage(page.sourcePageIndex);
	try {
		const [, , width, height] = source.getBounds(); // starts at 0,0
		const { scanDpi, picture } = pageContent(source); // a scan keeps its own resolution, a photo or scan goes as JPEG
		const scale = (scanDpi ? Math.min(Math.round(scanDpi), SCAN_DPI_MAX) : DPI) / PT_PER_INCH;

		const pixmap = source.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
		try {
			burn(pixmap, page.redactions, { width, height, rotation: 0 }, scale);
			const image = addCompressed(out, pixmap, picture && !lossless);
			const [x, y, w, h] = [pixmap.getX(), pixmap.getY(), pixmap.getWidth(), pixmap.getHeight()].map((v) => v / scale) as [number, number, number, number];
			// PDF space has y going up: the image's top edge goes to the page's top edge.
			const content = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(height - y - h)} cm /Im0 Do Q`;
			out.insertPage(-1, out.addPage([0, 0, width, height], page.rotation, { XObject: { Im0: image } }, content));
			return { width, height };
		} finally {
			pixmap.destroy();
		}
	} finally {
		source.destroy();
	}
}

const num = (n: number) => String(Number(n.toFixed(4)));

/** Every pixel a redaction touches at all becomes black: rounding always outward. */
function burn(pixmap: mupdf.Pixmap, redactions: Rect[], geometry: { width: number; height: number; rotation: 0 }, scale: number) {
	const [left, top, width, height] = [pixmap.getX(), pixmap.getY(), pixmap.getWidth(), pixmap.getHeight()];
	const n = pixmap.getNumberOfComponents();
	const stride = pixmap.getStride();
	const samples = pixmap.getPixels(); // the pixmap's own memory: writing here changes the image
	const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
	for (const rect of redactions) {
		const r = outward(pageRectToView(rect, geometry, scale));
		const x0 = clamp(r.x - left, width);
		const x1 = clamp(r.x + r.w - left, width);
		for (let y = clamp(r.y - top, height); y < clamp(r.y + r.h - top, height); y++) {
			samples.fill(0, y * stride + x0 * n, y * stride + x1 * n);
		}
	}
}

/**
 * The page image into the result, already compressed: lossless greyscale for a text page, JPEG for a page
 * with a photo or a scan, colour only where there is colour. (MuPDF's addImage would keep a lossless image
 * uncompressed in memory until the whole file is saved: 4–12 MB a page.)
 */
function addCompressed(out: mupdf.PDFDocument, pixmap: mupdf.Pixmap, picture: boolean): mupdf.PDFObject {
	const target = isGrey(pixmap) ? pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceGray, false) : pixmap;
	const add = (image: mupdf.Image) => {
		try {
			return out.addImage(image);
		} finally {
			image.destroy();
		}
	};
	try {
		if (picture) return add(new mupdf.Image(target.asJPEG(JPEG_QUALITY, false)));
		const png = pngData(target.asPNG());
		if (!png) return add(new mupdf.Image(target)); // not expected; still correct, only heavier on memory
		return out.addRawStream(png.zlib, {
			Type: "XObject",
			Subtype: "Image",
			Width: png.width,
			Height: png.height,
			BitsPerComponent: 8,
			ColorSpace: png.channels === 1 ? "DeviceGray" : "DeviceRGB",
			Filter: "FlateDecode",
			DecodeParms: { Predictor: 15, Colors: png.channels, BitsPerComponent: 8, Columns: png.width },
		});
	} finally {
		if (target !== pixmap) target.destroy();
	}
}

function isGrey(pixmap: mupdf.Pixmap) {
	const samples = pixmap.getPixels();
	const n = pixmap.getNumberOfComponents();
	for (let i = 0; i < samples.length; i += n) {
		if (Math.abs(samples[i]! - samples[i + 1]!) > 2 || Math.abs(samples[i + 1]! - samples[i + 2]!) > 2) return false;
	}
	return true;
}

/** Words a redaction touches at all, so the file name can be checked for them. */
function hiddenWordsOf(job: SaveJob, sources: Map<string, Prepared>): string[] {
	const words = new Set<string>();
	for (const page of job.pages) {
		if (page.redactions.length === 0) continue;
		const loaded = sources.get(page.sourceId)!.doc.loadPage(page.sourcePageIndex);
		try {
			collectHiddenWords(loaded, page.redactions, words);
		} finally {
			loaded.destroy();
		}
	}
	return [...words];
}

function collectHiddenWords(page: mupdf.PDFPage, redactions: Rect[], words: Set<string>) {
	const text = page.toStructuredText("preserve-whitespace");
	let word = "";
	let hidden = false;
	const flush = () => {
		if (hidden && word) words.add(word);
		word = "";
		hidden = false;
	};
	text.walk({
		onChar(c, _origin, _font, _size, quad) {
			if (/\s/.test(c)) return flush();
			word += c;
			const xs = [quad[0], quad[2], quad[4], quad[6]];
			const ys = [quad[1], quad[3], quad[5], quad[7]];
			const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
			if (redactions.some((r) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0)) hidden = true;
		},
		endLine: flush,
	});
	flush();
	text.destroy();
}

/**
 * A page without redactions, copied by the whitelist: its boxes, rotation, content and the
 * resources that content uses. Never the page dictionary itself, which graftPage would bring whole.
 */
function addWhitelisted(out: mupdf.PDFDocument, graft: mupdf.PDFGraftMap, doc: mupdf.PDFDocument, page: JobPage) {
	const source = doc.findPage(page.sourcePageIndex);
	const box = (key: string): mupdf.Rect | null => {
		const value = source.getInheritable(key);
		return value.isArray() && value.length === 4 ? [0, 1, 2, 3].map((i) => value.get(i).asNumber()) as mupdf.Rect : null;
	};
	const sourceRotate = Math.round(source.getInheritable("Rotate").asNumber() / 90) * 90;
	const rotate = (((sourceRotate + page.rotation) % 360) + 360) % 360;
	const resources = source.getInheritable("Resources");

	const added = out.addPage(
		box("MediaBox") ?? [0, 0, 612, 792],
		rotate as 0 | 90 | 180 | 270,
		resources.isNull() ? {} : graft.graftObject(resources),
		contentOf(source),
	);
	const cropBox = box("CropBox");
	if (cropBox) added.put("CropBox", cropBox);
	const group = source.get("Group"); // the page's transparency group: how its colours blend
	if (!group.isNull()) added.put("Group", graft.graftObject(group));
	out.insertPage(-1, added);
}

/** The page's content streams, decoded and joined. */
function contentOf(page: mupdf.PDFObject): Uint8Array {
	const contents = page.get("Contents");
	const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => contents.get(i)) : [contents];
	const parts = streams.filter((s) => s.isStream()).map((s) => s.readStream().asUint8Array().slice());
	const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length + 1, 0));
	let at = 0;
	for (const part of parts) {
		joined.set(part, at);
		joined[at + part.length] = 0x0a; // a line break, so operators from two streams never run together
		at += part.length + 1;
	}
	return joined;
}

/**
 * The second line of defence, after the whitelist: in whatever made it into the result, no metadata, private
 * application data or links to other files remain, and JPEGs lose EXIF (with GPS), XMP and IPTC.
 */
function scrub(out: mupdf.PDFDocument) {
	for (let num = 1; num < out.countObjects(); num++) {
		const obj = out.newIndirect(num); // a reference, not resolved: only a reference knows it is a stream
		dropKeys(obj);
		if (obj.isStream() && obj.get("Subtype").isName() && obj.get("Subtype").asName() === "Image") cleanImage(obj);
	}
}

function dropKeys(obj: mupdf.PDFObject) {
	if (obj.isDictionary()) for (const key of DROPPED_KEYS) obj.delete(key);
	if (obj.isDictionary() || obj.isArray()) {
		obj.forEach((value) => {
			if (!value.isIndirect()) dropKeys(value); // indirect objects get their own turn in scrub()
		});
	}
}

function cleanImage(image: mupdf.PDFObject) {
	const filter = image.get("Filter");
	const filters = filter.isArray()
		? Array.from({ length: filter.length }, (_, i) => filter.get(i).asName())
		: filter.isName()
			? [filter.asName()]
			: [];
	if (filters.length === 1 && filters[0] === "DCTDecode") {
		const jpeg = image.readRawStream().asUint8Array().slice();
		const stripped = stripJpegMetadata(jpeg);
		if (!stripped) throw new Uncleanable();
		if (stripped.length !== jpeg.length) image.writeRawStream(stripped);
	} else if (filters.includes("DCTDecode") || filters.includes("JPXDecode")) {
		// A JPEG wrapped in another filter, or JPEG 2000 with its own metadata boxes: not taken apart here.
		throw new Uncleanable();
	}
}
