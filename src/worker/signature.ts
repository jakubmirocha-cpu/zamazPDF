// Is the document signed electronically? Then the user hears, on opening it, that redacting ends
// the signature's validity. The signature itself never reaches the saved file: the whitelist has no forms.
import * as mupdf from "mupdf";

/** Fields looked at, at most: a form is never this big, a broken file with a loop in it might be. */
const MAX_FIELDS = 10_000;

/** A signature field that holds a signature: field type /Sig (inherited from a parent too) and a value. */
export function isSigned(doc: mupdf.Document): boolean {
	const pdf = doc.asPDF();
	if (!pdf) return false;
	const fields = pdf.getTrailer().get("Root", "AcroForm", "Fields");
	const queue: { field: mupdf.PDFObject; sig: boolean }[] = [];
	const add = (list: mupdf.PDFObject, sig: boolean) => {
		if (list.isArray()) for (let i = 0; i < list.length; i++) queue.push({ field: list.get(i), sig });
	};
	add(fields, false);
	for (let seen = 0; queue.length > 0 && seen < MAX_FIELDS; seen++) {
		const { field, sig: parentSig } = queue.shift()!;
		if (!field.isDictionary()) continue;
		const type = field.get("FT");
		const sig = type.isName() ? type.asName() === "Sig" : parentSig;
		if (sig && field.get("V").isDictionary()) return true;
		add(field.get("Kids"), sig);
	}
	return false;
}
