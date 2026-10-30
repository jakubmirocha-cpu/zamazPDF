// The saved file's name: "ZAMAZANY - <name>.pdf", and when the original name gives away a word
// that was redacted (a surname, a PESEL), the proposal leaves that part out.

const PREFIX = "ZAMAZANY - ";
const SEPARATORS = /([\s_\-.,;()[\]]+)/;

/** Lower case, no Polish letters: "WISNIEWSKI" and "Wiśniewski" compare equal. */
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();
const digitsOf = (s: string) => s.replace(/\D/g, "");
/** A word without its last two letters (at least three kept), to match "Kowalski" with "Kowalskiego". */
const stem = (word: string) => word.slice(0, Math.max(3, word.length - 2));

function givesAway(part: string, hiddenWords: string[]): boolean {
	const p = plain(part).replace(/[^\p{L}\p{N}]/gu, "");
	const pDigits = digitsOf(p);
	return hiddenWords.some((word) => {
		const h = plain(word).replace(/[^\p{L}\p{N}]/gu, "");
		const hDigits = digitsOf(h);
		// Numbers: the same number, or a piece of five digits or more (four would also catch every year).
		if (pDigits.length >= 4 && hDigits.length >= 4) {
			return pDigits === hDigits || pDigits.includes(hDigits) || (pDigits.length >= 5 && hDigits.includes(pDigits));
		}
		if (p.length < 3 || h.length < 3 || Math.abs(p.length - h.length) > 4) return false;
		const [shorter, longer] = p.length <= h.length ? [p, h] : [h, p];
		return longer.startsWith(stem(shorter));
	});
}

export function savedFileName(original: string, hiddenWords: string[]): { name: string; removed: string[] } {
	let base = original.replace(/\.pdf$/i, "");
	if (base.startsWith(PREFIX)) base = base.slice(PREFIX.length);
	const removed: string[] = [];
	const parts = base.split(SEPARATORS).map((part, i) => {
		if (i % 2 === 1 || !givesAway(part, hiddenWords)) return part; // odd parts are the separators
		removed.push(part);
		return "";
	});
	const cleaned = parts
		.join("")
		.replace(/([\s_\-.,;()[\]])[\s_\-.,;()[\]]+/g, "$1")
		.replace(/^[\s_\-.,;()[\]]+|[\s_\-.,;()[\]]+$/g, "");
	return { name: `${PREFIX}${cleaned || "dokument"}.pdf`, removed };
}
