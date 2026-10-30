// What a page holds that nobody can see: text in a scanner's invisible layer, white on white, under a black
// rectangle or an image, or outside the page's visible area. It would pass into the saved file unnoticed, so such a
// page is saved as an image of what it shows (save.ts).
import * as mupdf from "mupdf";
import { boxOf, glyphOutline, overlaps, transform, type Box } from "./glyphs";

/** Device pixels per point for looking at the drawn page: fine enough to show the dot of a small "i". */
const SCALE = 2;
/** Colour values (of 255) within which a place counts as one flat colour: less than the eye tells apart. */
const FLAT = 16;

/** Could this character be data? Not a space, a dot or a bullet; a character the file gives no meaning for could be. */
const mayBeData = (unicode: number) => !unicode || unicode === 0xfffd || !/[\s\p{P}\p{S}]/u.test(String.fromCodePoint(unicode));
const isLetterOrDigit = (unicode: number) => /[\p{L}\p{N}]/u.test(String.fromCodePoint(unicode || 0xfffd));
/** Where an image lands on the page: it fills the unit square of its matrix. */
const unitSquare = (ctm: mupdf.Matrix) => boxOf([...transform(ctm, 0, 0), ...transform(ctm, 1, 0), ...transform(ctm, 0, 1), ...transform(ctm, 1, 1)]);

export function hasHiddenContent(page: mupdf.Page): boolean {
	const [x0, y0, x1, y1] = page.getBounds();
	const sheet: Box = { x0, y0, x1, y1 };
	let found = false;
	/** The ink of the glyphs drawn so far, still to be looked for on the drawn page. */
	const ink: Box[] = [];

	const drawn = (text: mupdf.Text, ctm: mupdf.Matrix) =>
		text.walk({
			showGlyph(font, trm, glyph, unicode) {
				const box = glyphOutline(font, glyph, mupdf.Matrix.concat(trm, ctm));
				// No outline: a font without glyphs, as some OCR software uses. A blank in an ordinary font is no text.
				if (!box) found ||= isLetterOrDigit(unicode);
				else if (!mayBeData(unicode)) return;
				else if (!overlaps(sheet, box)) found = true;
				else ink.push(box);
			},
		});
	const image = (picture: mupdf.Image, ctm: mupdf.Matrix, alpha: number) => {
		const box = unitSquare(ctm);
		if (!overlaps(sheet, box)) found = true;
		// Text drawn first and then an opaque image over it, as some scanners lay out their text. The picture may hold
		// any marks there, so the drawn page would not tell.
		else if (alpha >= 0.99 && !picture.getMask()) {
			if (ink.some((g) => g.x0 >= box.x0 && g.x1 <= box.x1 && g.y0 >= box.y0 && g.y1 <= box.y1)) found = true;
		}
	};
	const device = new mupdf.Device({
		fillText: (text, ctm) => drawn(text, ctm),
		strokeText: (text, _stroke, ctm) => drawn(text, ctm),
		ignoreText(text) {
			text.walk({
				showGlyph(_font, _trm, _glyph, unicode) {
					if (mayBeData(unicode)) found = true;
				},
			});
		},
		fillImage: image,
		fillImageMask(_mask, ctm) {
			if (!overlaps(sheet, unitSquare(ctm))) found = true;
		},
	});
	try {
		page.run(device, mupdf.Matrix.identity);
		device.close();
	} finally {
		device.destroy();
	}
	if (found) return true;
	if (ink.length === 0) return false; // no text: nothing to draw the page for

	const pixmap = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
	try {
		return ink.some((box) => isFlat(pixmap, box));
	} finally {
		pixmap.destroy();
	}
}

/** Is the place of this glyph, and a pixel around it, one flat colour on the drawn page? Then the glyph shows nothing. */
function isFlat(pixmap: mupdf.Pixmap, box: Box): boolean {
	const [left, top, width, height, stride] = [pixmap.getX(), pixmap.getY(), pixmap.getWidth(), pixmap.getHeight(), pixmap.getStride()];
	const samples = pixmap.getPixels();
	const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
	const [px0, px1] = [clamp(Math.floor(box.x0 * SCALE) - 1 - left, width), clamp(Math.ceil(box.x1 * SCALE) + 1 - left, width)];
	const [py0, py1] = [clamp(Math.floor(box.y0 * SCALE) - 1 - top, height), clamp(Math.ceil(box.y1 * SCALE) + 1 - top, height)];
	if (px0 >= px1 || py0 >= py1) return false;
	const first = py0 * stride + px0 * 3;
	const [r, g, b] = [samples[first]!, samples[first + 1]!, samples[first + 2]!];
	for (let y = py0; y < py1; y++) {
		for (let x = px0; x < px1; x++) {
			const at = y * stride + x * 3;
			if (Math.abs(samples[at]! - r) > FLAT || Math.abs(samples[at + 1]! - g) > FLAT || Math.abs(samples[at + 2]! - b) > FLAT) return false;
		}
	}
	return true;
}
