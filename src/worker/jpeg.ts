// JPEG files carry metadata in their own segments: EXIF (with GPS position and camera serial), XMP, IPTC,
// comments. The saved file keeps a JPEG's pixels and drops those segments.

const SOI = 0xd8;
const SOS = 0xda;
const APP0 = 0xe0; // JFIF: pixel density, kept
const APP2 = 0xe2; // ICC colour profile, kept
const APP14 = 0xee; // Adobe: how to read the colours, kept
const COM = 0xfe;

/** Segments to drop: every APPn except the three above (APP1 is EXIF and XMP, APP13 is IPTC), and comments. */
const isMetadata = (marker: number) =>
	marker === COM || (marker >= APP0 && marker <= 0xef && marker !== APP0 && marker !== APP2 && marker !== APP14);

/**
 * The JPEG without its metadata segments, or null when its structure cannot be read: then the caller must
 * not keep it at all.
 */
export function stripJpegMetadata(jpeg: Uint8Array): Uint8Array | null {
	if (jpeg[0] !== 0xff || jpeg[1] !== SOI) return null;
	const kept: Uint8Array[] = [jpeg.subarray(0, 2)];
	let i = 2;
	for (;;) {
		if (i + 4 > jpeg.length || jpeg[i] !== 0xff) return null;
		const marker = jpeg[i + 1]!;
		if (marker === 0xff) {
			i++; // fill byte before a marker
			continue;
		}
		if (marker === SOS) {
			kept.push(jpeg.subarray(i)); // the image data, to the end
			break;
		}
		const end = i + 2 + ((jpeg[i + 2]! << 8) | jpeg[i + 3]!);
		if (end > jpeg.length) return null;
		if (!isMetadata(marker)) kept.push(jpeg.subarray(i, end));
		i = end;
	}
	const result = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of kept) {
		result.set(part, at);
		at += part.length;
	}
	return result;
}
