// The app's icon for the PWA manifest: a page with one line blacked out, on the green of the
// "Wybierz plik PDF" button (src/app/styles.css). Drawn with MuPDF straight into PNGs, so there is no image file
// to keep. The page stays inside the middle 80% circle, so the same picture also serves as a maskable icon, which
// a phone crops to its own shape.
import * as mupdf from "mupdf";

const size = 512;
const shapes = [
	{ color: 0x4a6649, rect: [0, 0, 512, 512] }, // --accent
	{ color: 0xffffff, rect: [136, 96, 376, 416] }, // the page: corners 200 from the middle
	{ color: 0xb9b8b0, rect: [168, 140, 288, 164] }, // lines of text
	{ color: 0x1c1c1c, rect: [168, 196, 344, 268] }, // the redaction, --ink
	{ color: 0xb9b8b0, rect: [168, 300, 312, 324] },
	{ color: 0xb9b8b0, rect: [168, 344, 272, 368] },
];

/** The icon as a PNG of `pixels` × `pixels`. */
export function iconPng(pixels) {
	const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, pixels, pixels], false);
	const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
	const scale = mupdf.Matrix.scale(pixels / size, pixels / size);
	for (const { color, rect } of shapes) {
		const path = new mupdf.Path();
		path.rect(...rect);
		const rgb = [color >> 16, (color >> 8) & 0xff, color & 0xff].map((c) => c / 255);
		device.fillPath(path, false, scale, mupdf.ColorSpace.DeviceRGB, rgb, 1);
	}
	device.close();
	return pixmap.asPNG();
}
