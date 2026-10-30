// Marked content out of a page ("Zachowaj tekst"). MuPDF's redaction removes the characters
// under a redaction, but the marked content around them stays, and its property lists can still hold that
// very text: /ActualText (what the characters say), /Alt (a description), /E (an expansion). Nothing is
// drawn differently without marked content; it only ties content to the structure tree, which the result
// has none of anyway.
import * as mupdf from "mupdf";

const MARKED = new Set(["BDC", "BMC", "EMC", "DP", "MP"]);
/** Operators that start binary data this does not take apart. */
const BINARY = new Set(["BI", "ID", "EI"]);

const isWhite = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const DELIMITERS = new Set([...'()<>[]{}/%'].map((c) => c.charCodeAt(0)));
const isRegular = (c: number) => !isWhite(c) && !DELIMITERS.has(c);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/**
 * A content stream without its marked-content operators (BDC … EMC, BMC, DP, MP) and their operands.
 * Everything else is copied byte for byte. Null for an inline image (BI … ID … EI), whose data this does
 * not read: the page is then saved as an image.
 */
export function withoutMarkedContent(bytes: Uint8Array): Uint8Array | null {
	const kept: Uint8Array[] = [];
	let keptFrom = 0; // start of what is not copied yet
	let operands = 0; // where the operands of the next operator start
	let i = 0;
	while (i < bytes.length) {
		const c = bytes[i]!;
		if (isWhite(c)) i++;
		else if (c === 0x25) {
			// % comment, to the end of the line
			while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
		} else if (c === 0x28) i = afterString(bytes, i);
		else if (c === 0x3c && bytes[i + 1] === 0x3c) i += 2; // <<
		else if (c === 0x3e && bytes[i + 1] === 0x3e) i += 2; // >>
		else if (c === 0x3c) {
			// <hex string>
			while (i < bytes.length && bytes[i] !== 0x3e) i++;
			i++;
		} else if (c === 0x2f) {
			// /Name
			i++;
			while (i < bytes.length && isRegular(bytes[i]!)) i++;
		} else if (!isRegular(c)) i++; // [ ] { } and a stray >
		else {
			const start = i;
			while (i < bytes.length && isRegular(bytes[i]!)) i++;
			const token = String.fromCharCode(...bytes.subarray(start, i));
			if (NUMBER.test(token) || token === "true" || token === "false" || token === "null") continue;
			if (BINARY.has(token)) return null;
			if (MARKED.has(token)) {
				kept.push(bytes.subarray(keptFrom, operands), new Uint8Array([0x0a]));
				keptFrom = i;
			}
			operands = i;
		}
	}
	kept.push(bytes.subarray(keptFrom));
	return concat(kept);
}

function concat(parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** Index just after the (literal string) starting at `i`: nested brackets count, a backslash escapes. */
function afterString(bytes: Uint8Array, i: number) {
	let depth = 0;
	for (; i < bytes.length; i++) {
		const c = bytes[i];
		if (c === 0x5c) i++;
		else if (c === 0x28) depth++;
		else if (c === 0x29 && --depth === 0) return i + 1;
	}
	return i;
}

/**
 * Takes the marked content out of a page and of everything it draws with a content stream of its own: forms
 * (annotations baked into the page are forms too) and tiling patterns. Their named property lists go as well.
 * Returns false when some stream cannot be taken apart.
 */
export function stripMarkedContent(doc: mupdf.PDFDocument, page: mupdf.PDFObject): boolean {
	const contents = page.get("Contents");
	const streams = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => contents.get(i)) : [contents];
	const parts: Uint8Array[] = [];
	for (const stream of streams.filter((s) => s.isStream())) {
		const stripped = withoutMarkedContent(stream.readStream().asUint8Array().slice());
		if (!stripped) return false;
		parts.push(stripped, new Uint8Array([0x0a]));
	}
	page.put("Contents", doc.addStream(concat(parts), {}));
	return stripResources(page.getInheritable("Resources"), new Set());
}

function stripResources(resources: mupdf.PDFObject, seen: Set<number>): boolean {
	if (!resources.isDictionary()) return true;
	resources.delete("Properties");
	let ok = true;
	for (const kind of ["XObject", "Pattern"]) {
		resources.get(kind).forEach((value) => {
			if (!ok || !value.isStream()) return; // shading patterns and images have no content stream
			if (kind === "XObject" && !(value.get("Subtype").isName() && value.get("Subtype").asName() === "Form")) return;
			if (value.isIndirect()) {
				if (seen.has(value.asIndirect())) return;
				seen.add(value.asIndirect());
			}
			const stripped = withoutMarkedContent(value.readStream().asUint8Array().slice());
			if (!stripped) {
				ok = false;
				return;
			}
			value.writeStream(stripped);
			ok = stripResources(value.get("Resources"), seen);
		});
	}
	return ok;
}
