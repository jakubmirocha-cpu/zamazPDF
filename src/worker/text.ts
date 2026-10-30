// A page's text with a box for every character, read right after a file opens.
import * as mupdf from "mupdf";
import type { PageText } from "../shared/engine-protocol";
import { glyphBox, type Box } from "./glyphs";
import { pageContent } from "./page-content";

/** Fewer visible characters than this: the page has no text to search. */
const MIN_CHARS = 3;
/** More than this share of unreadable characters (no ToUnicode): the text cannot be searched. */
const UNREADABLE = 0.3;
/** How far (points) a character's origin may be from its glyph's to be the same: float rounding only. */
const SAME_ORIGIN = 0.05;

export function pageText(page: mupdf.Page): PageText {
	let text = "";
	const boxes: number[] = [];
	const ink: number[] = [];
	const outlineAt = glyphOutlines(page);
	const stext = page.toStructuredText("");
	try {
		stext.walk({
			onChar(c, origin, _font, _size, quad) {
				const xs = [quad[0], quad[2], quad[4], quad[6]];
				const ys = [quad[1], quad[3], quad[5], quad[7]];
				const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
				// A character whose glyph is not found (a ligature's second letter) keeps its whole box: larger, so safe.
				const outline = outlineAt(origin[0], origin[1]);
				const drawn = outline ? [outline.x0, outline.y0, outline.x1, outline.y1] : box;
				// One box per UTF-16 unit, so that `text`, `boxes` and `ink` share their indexes.
				for (let unit = 0; unit < c.length; unit++) {
					boxes.push(...box);
					ink.push(...drawn);
				}
				text += c;
			},
			endLine() {
				text += "\n";
				boxes.push(0, 0, 0, 0);
				ink.push(0, 0, 0, 0);
			},
		});
	} finally {
		stext.destroy();
	}

	const visible = [...text].filter((c) => !/\s/u.test(c));
	const unreadable = visible.filter((c) => c === "�" || /[\p{Co}\p{Cc}]/u.test(c)).length;
	const content = pageContent(page);
	const [x0, y0, x1, y1] = page.getBounds();
	return {
		width: x1 - x0,
		height: y1 - y0,
		text,
		boxes: new Float32Array(boxes),
		ink: new Float32Array(ink),
		kind: visible.length < MIN_CHARS ? "none" : unreadable > visible.length * UNREADABLE ? "unreadable" : "text",
		scan: content.invisibleText || content.scanDpi > 0,
	};
}

/**
 * The outline (glyphs.ts) of every glyph the page draws, found again by the point where the glyph starts:
 * the structured text gives each character that point, but not its glyph.
 */
function glyphOutlines(page: mupdf.Page): (x: number, y: number) => Box | null {
	const cells = new Map<string, { x: number; y: number; box: Box }[]>();
	const cell = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
	const text = (t: mupdf.Text, ctm: mupdf.Matrix) =>
		t.walk({
			showGlyph(font, trm, glyph, unicode) {
				const m = mupdf.Matrix.concat(trm, ctm);
				const key = cell(m[4], m[5]);
				cells.set(key, [...(cells.get(key) ?? []), { x: m[4], y: m[5], box: glyphBox(font, glyph, m, unicode) }]);
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
	return (x, y) => {
		// Glyphs drawn at the same point (bold made by drawing twice) count together.
		let found: Box | null = null;
		for (const dx of [-1, 0, 1]) {
			for (const dy of [-1, 0, 1]) {
				for (const g of cells.get(cell(x + dx, y + dy)) ?? []) {
					if (Math.abs(g.x - x) > SAME_ORIGIN || Math.abs(g.y - y) > SAME_ORIGIN) continue;
					found = found
						? { x0: Math.min(found.x0, g.box.x0), y0: Math.min(found.y0, g.box.y0), x1: Math.max(found.x1, g.box.x1), y1: Math.max(found.y1, g.box.y1) }
						: g.box;
				}
			}
		}
		return found;
	};
}
