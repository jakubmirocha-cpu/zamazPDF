// Where a glyph is on the page: one rule for the autotest, for removing text in "Zachowaj tekst", and for the
// boxes the page's text is searched and snapped with (a character whose outline a redaction
// touches is under it).
import * as mupdf from "mupdf";
import type { Rect } from "../shared/model";

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Glyph box in font sizes, for a glyph without an outline: x from 0 to the advance, y from the descender to the ascender. */
const DESCENDER = -0.25;
const ASCENDER = 0.95;
/** Glyph outlines are measured at this many units per font size: MuPDF pads the bounds it gives by one unit. */
const OUTLINE_UNITS = 1000;

export const boxOf = (points: number[]): Box => {
	const xs = points.filter((_, i) => i % 2 === 0);
	const ys = points.filter((_, i) => i % 2 === 1);
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
export const transform = (m: mupdf.Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** Positive overlap: touching edges alone is not "under". */
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export const boxOfRect = (r: Rect): Box => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

/** The box (x0, x1, y0, y1 in glyph space) on the page, `m` being the glyph's text matrix times the device's. */
const onPage = (m: mupdf.Matrix, x0: number, x1: number, y0: number, y1: number) =>
	boxOf([...transform(m, x0, y0), ...transform(m, x1, y0), ...transform(m, x0, y1), ...transform(m, x1, y1)]);

/**
 * A glyph's em box on the page: its advance wide, from DESCENDER to ASCENDER font sizes high. The other
 * arguments pick a part of it: x as a share of the advance, y in font sizes from the baseline.
 */
export function emBox(font: mupdf.Font, glyph: number, m: mupdf.Matrix, x0 = 0, x1 = 1, y0 = DESCENDER, y1 = ASCENDER): Box {
	const advance = font.advanceGlyph(glyph) || 0.5;
	return onPage(m, x0 * advance, x1 * advance, y0, y1);
}

/**
 * The outline of a glyph on the page: the box round the ink, not round the line. A lower-case "a" has
 * nothing above its x-height, so a redaction over the empty space above it leaves it alone. Without an
 * outline: a space sits on the baseline, half a font size high, like a small letter (so the spaces of the
 * lines above and below are as safe as their letters); a letter of a font without glyphs (the text layer of
 * some OCR software) gets its whole em box.
 */
export function glyphBox(font: mupdf.Font, glyph: number, m: mupdf.Matrix, unicode: number): Box {
	return glyphOutline(font, glyph, m) ?? (/\s/u.test(String.fromCodePoint(unicode || 0xfffd)) ? emBox(font, glyph, m, 0, 1, 0, 0.5) : emBox(font, glyph, m));
}

/** The box round a glyph's outline on the page; null when the glyph has none and so draws nothing. */
export function glyphOutline(font: mupdf.Font, glyph: number, m: mupdf.Matrix): Box | null {
	const text = new mupdf.Text();
	try {
		text.showGlyph(font, mupdf.Matrix.scale(OUTLINE_UNITS, OUTLINE_UNITS), glyph, 0);
		const [x0, y0, x1, y1] = text.getBounds(null as unknown as mupdf.StrokeState, mupdf.Matrix.identity).map((v) => v / OUTLINE_UNITS) as mupdf.Rect;
		// Nothing drawn comes back as the padding round the origin alone.
		return x1 - x0 > 3 / OUTLINE_UNITS || y1 - y0 > 3 / OUTLINE_UNITS ? onPage(m, x0, x1, y0, y1) : null;
	} finally {
		text.destroy();
	}
}
