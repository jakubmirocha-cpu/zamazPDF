// A PNG's image data (its IDAT chunks) is a zlib stream of rows with PNG filters, which is exactly what a
// PDF image with /FlateDecode and a PNG predictor holds. So MuPDF's PNG encoder compresses a page image for
// the saved file right away, instead of the image waiting uncompressed in memory until the whole file is saved.

export type PngData = { width: number; height: number; channels: 1 | 3; zlib: Uint8Array };

/** The compressed rows of an 8-bit grey or RGB, non-interlaced PNG; null for anything else. */
export function pngData(png: Uint8Array): PngData | null {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (signature.some((b, i) => png[i] !== b)) return null;
	let header: Omit<PngData, "zlib"> | null = null;
	const parts: Uint8Array[] = [];
	for (let at = 8; at + 8 <= png.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		const data = png.subarray(at + 8, at + 8 + length);
		if (type === "IHDR") {
			const [depth, colour, interlace] = [data[8], data[9], data[12]];
			if (depth !== 8 || interlace !== 0 || (colour !== 0 && colour !== 2)) return null;
			header = { width: view.getUint32(at + 8), height: view.getUint32(at + 12), channels: colour === 0 ? 1 : 3 };
		} else if (type === "IDAT") parts.push(data);
		else if (type === "IEND") break;
		at += 12 + length;
	}
	if (!header || parts.length === 0) return null;
	const zlib = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		zlib.set(part, at);
		at += part.length;
	}
	return { ...header, zlib };
}
