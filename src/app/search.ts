// "Szukaj i zamaż": text found the way people type it, and where it is on the page.
// Also snapping a hand-drawn redaction to whole words. Pure functions; the page text comes from the worker.
import type { PageText } from "../shared/engine-protocol";
import type { Rect } from "../shared/model";

/** A page's text prepared for searching, with the way back from every folded character to the page. */
export type PageIndex = {
	page: PageText;
	/** Lower case, no Polish letters or accents, NFKC, one space between words, words broken over lines joined. */
	folded: string;
	/** For every unit of `folded`: the index in `page.text` of the character it came from. */
	foldedFrom: Int32Array;
	/** `folded` without spaces, dashes and dots: numbers as typed without them (PESEL, account, phone). */
	compact: string;
	compactFrom: Int32Array;
	/** Line number of every character of `page.text`. */
	lineOf: Int32Array;
	/** E-mail and web addresses in `page.text`: a match inside one takes all of it (find()). */
	addresses: Range[];
};

/** Characters of `page.text`, end not included. */
export type Range = { start: number; end: number };

export type Similar = { key: string; word: string; count: number };

const IGNORED = /[­​-‍⁠﻿]/u; // soft hyphen and zero-width characters
const SPACE = /[\s  -   　]/u;
const HYPHEN = /[-­‐‑]/u;
const LETTER = /\p{L}/u;
const WORD = /[\p{L}\p{N}]/u;
const DIGIT = /\p{N}/u;
const NUMBER_SEPARATOR = /[ \-.]/g;
/** On a scan the text layer is often off the picture: its redactions grow by this part of the line height. */
const SCAN_MARGIN = 0.2;
/** A hand-drawn redaction takes in a word it covers at least this part of the height of. */
const SNAP_SHARE = 0.25;
/** Points a redaction keeps from the letters of other lines (keepClear): invisible, above rounding errors. */
const CLEARANCE = 0.01;

/** One character as search compares it: "Ś" → "s", "ﬁ" → "fi", a hard space → " ", a soft hyphen → "". */
export function fold(c: string): string {
	if (IGNORED.test(c)) return "";
	if (SPACE.test(c)) return " ";
	return c.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").replace(/[łŁ]/g, "l").toLowerCase();
}

export const foldQuery = (query: string) => [...query].map(fold).join("").replace(/ +/g, " ").trim();

/**
 * A number (PESEL, account, contract number), whose spaces, dashes and dots do not matter: digits
 * only, from the first one typed, so that typing on never switches how a number is found; or mostly digits
 * with a few letters (an IBAN, an ID card number).
 */
export function isNumberQuery(query: string) {
	const alnum = query.replace(/[^\p{L}\p{N}]/gu, "");
	const digits = alnum.replace(/\P{N}/gu, "").length;
	return digits > 0 && (digits === alnum.length || (digits >= 4 && digits * 2 >= alnum.length));
}

/** "Kowal-" at a line end and "skiego" on the next line are one word; "Warszawa-" + "Kraków" are not. */
function brokenWord(text: string, lineEnd: number) {
	const last = text[lineEnd - 1] ?? "";
	const next = text[lineEnd + 1] ?? "";
	return HYPHEN.test(last) && LETTER.test(text[lineEnd - 2] ?? "") && LETTER.test(next) && next === next.toLowerCase();
}

export function indexPage(page: PageText): PageIndex {
	const { text } = page;
	let folded = "";
	const foldedFrom: number[] = [];
	const lineOf = new Int32Array(text.length);
	const add = (s: string, from: number) => {
		for (const unit of s) {
			if (unit === " " && (folded === "" || folded.endsWith(" "))) continue;
			folded += unit;
			foldedFrom.push(from);
		}
	};
	let line = 0;
	for (let i = 0; i < text.length; i++) {
		lineOf[i] = line;
		if (text[i] !== "\n") {
			add(fold(text[i]!), i);
			continue;
		}
		line++;
		if (brokenWord(text, i)) {
			if (folded.endsWith("-")) {
				folded = folded.slice(0, -1);
				foldedFrom.pop();
			}
		} else add(" ", i);
	}

	let compact = "";
	const compactFrom: number[] = [];
	for (let k = 0; k < folded.length; k++) {
		if (folded[k]!.match(NUMBER_SEPARATOR)) continue;
		compact += folded[k];
		compactFrom.push(foldedFrom[k]!);
	}
	return { page, folded, foldedFrom: Int32Array.from(foldedFrom), compact, compactFrom: Int32Array.from(compactFrom), lineOf, addresses: addressesIn(text) };
}

/**
 * Where `query` is on the page. Words match from the start of a word and take the whole word:
 * "Jan" finds "Jana", not "Bojan"; with `exact`, only the word itself. A name of several words is also found
 * word by word (separateWords()). Numbers likewise, without their separators: from the start of a number,
 * never from its middle, and the whole number. So the more digits are typed, the fewer numbers match: "12"
 * finds "123456789" and "art. 12", "1234" only "123456789".
 */
export function find(index: PageIndex, query: string, exact = false): Range[] {
	const q = foldQuery(query);
	if (q.length < 2) return [];
	if (isNumberQuery(q)) return wholeAddresses(index, findNumber(index, q.replace(NUMBER_SEPARATOR, "")));
	return wholeAddresses(index, [...findWords(index, q, exact), ...separateWords(q).flatMap((word) => findWords(index, word, exact))]);
}

/**
 * The words of a query of names ("Jan Kowalski", "Nowak-Wiśniewska Anna") to find each on its own as well:
 * in a text the first name and the surname often stand apart, the other
 * way round or inflected ("Pan Kowalski", "Kowalskiego Jana"); a double surname also by its parts. Only for
 * words alone, without digits or signs inside: "ul. Krótka 12/4" or "Sp. z o.o." are found as typed. Words
 * under three letters ("z", "ul"), titles ("Pani", "mgr") and the commonest small words ("nie", "oraz") would
 * find too much on their own: they are found only within the whole.
 */
export function separateWords(query: string): string[] {
	const q = foldQuery(query);
	if (/\p{N}/u.test(q)) return [];
	const words = q.split(" ").map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
	if (words.length < 2 || !words.every((word) => /^[\p{L}'’-]*$/u.test(word))) return [];
	const parts = words.flatMap((word) => (word.includes("-") ? [word, ...word.split("-")] : [word]));
	return [...new Set(parts.filter((word) => word.replace(/[^\p{L}]/gu, "").length >= 3 && !NOT_ALONE.has(word)))];
}

/** Folded, as foldQuery() gives them. */
const NOT_ALONE = new Set(
	"pan pana panu panem panie pani pania panstwo panstwa panna mgr inz prof hab doc nie jest oraz albo lub dla przy pod nad przez jak sie jego jej ich ten tej tym tego ktory ktora ktore ulica ulicy aleja alei osiedle plac".split(" "),
);

/**
 * A match inside an e-mail or web address takes the whole address: "kowalski" in "jan.kowalski@firma.pl"
 * leaves no "jan." and "@firma.pl" visible. A hand-drawn redaction snaps to the whole address the same way.
 * Matches inside another one are that one ("Kowalski" in "Jan Kowalski", two words in one address).
 */
function wholeAddresses({ addresses }: PageIndex, ranges: Range[]): Range[] {
	const grown = ranges
		.map((range) => addresses.reduce((r, a) => (a.start < r.end && r.start < a.end ? { start: Math.min(r.start, a.start), end: Math.max(r.end, a.end) } : r), range))
		.sort((a, b) => a.start - b.start || b.end - a.end);
	const places: Range[] = [];
	for (const range of grown) if (range.start >= (places.at(-1)?.end ?? 0)) places.push(range);
	return places;
}

/** E-mail addresses, and web addresses starting with a scheme or "www."; trailing punctuation is not theirs. */
const ADDRESS = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+|(?:https?:\/\/|www\.)[^\s]+/giu;

function addressesIn(text: string): Range[] {
	return [...text.matchAll(ADDRESS)].map((match) => {
		const end = match.index + match[0].replace(/[.,;:!?)\]}'"»”]+$/u, "").length;
		return { start: match.index, end };
	});
}

/**
 * Words match from the start of a word and take the whole word; a query that begins (or ends) with
 * punctuation, as ".kowalski" or "@firma.pl", needs no word boundary on that side.
 */
function findWords({ folded, foldedFrom }: PageIndex, q: string, exact: boolean): Range[] {
	const ranges: Range[] = [];
	const [opensWord, closesWord] = [WORD.test(q[0]!), WORD.test(q.at(-1)!)];
	for (let at = folded.indexOf(q); at !== -1; at = folded.indexOf(q, at + 1)) {
		if (opensWord && at > 0 && WORD.test(folded[at - 1]!)) continue;
		let end = at + q.length;
		if (exact && closesWord && end < folded.length && WORD.test(folded[end]!)) continue;
		while (closesWord && end < folded.length && WORD.test(folded[end]!)) end++;
		ranges.push({ start: foldedFrom[at]!, end: foldedFrom[end - 1]! + 1 });
		at = end - 1;
	}
	return ranges;
}

function findNumber({ compact, compactFrom }: PageIndex, q: string): Range[] {
	const ranges: Range[] = [];
	for (let at = compact.indexOf(q); at !== -1; at = compact.indexOf(q, at + 1)) {
		if (DIGIT.test(q[0]!) && at > 0 && DIGIT.test(compact[at - 1]!)) continue; // the middle of a number
		let end = at + q.length;
		if (DIGIT.test(q.at(-1)!)) while (end < compact.length && DIGIT.test(compact[end]!)) end++; // the whole number
		ranges.push({ start: compactFrom[at]!, end: compactFrom[end - 1]! + 1 });
		at = end - 1;
	}
	return ranges;
}

/**
 * One rectangle per line the range runs over, in page coordinates: the characters' boxes, clear
 * of the letters of other lines (keepClear); on a scan larger instead, its text being off the picture.
 */
export function rectsOf(index: PageIndex, range: Range): Rect[] {
	const { boxes, scan, width, height } = index.page;
	const lines = new Map<number, { box: [number, number, number, number]; chars: number[] }>();
	for (let i = range.start; i < range.end; i++) {
		const [x0, y0, x1, y1] = boxes.subarray(4 * i, 4 * i + 4) as unknown as number[];
		if (x0 === 0 && y0 === 0 && x1 === 0 && y1 === 0) continue; // a line break
		const line = lines.get(index.lineOf[i]!);
		if (!line) lines.set(index.lineOf[i]!, { box: [x0!, y0!, x1!, y1!], chars: [i] });
		else {
			line.box = [Math.min(line.box[0], x0!), Math.min(line.box[1], y0!), Math.max(line.box[2], x1!), Math.max(line.box[3], y1!)];
			line.chars.push(i);
		}
	}
	return [...lines.values()].map(({ box: [x0, y0, x1, y1], chars }) => {
		if (!scan) return keepClear(index, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, chars);
		const margin = SCAN_MARGIN * (y1 - y0);
		const [a, b, c, d] = [Math.max(0, x0 - margin), Math.max(0, y0 - margin), Math.min(width, x1 + margin), Math.min(height, y1 + margin)];
		return { x: a, y: b, w: c - a, h: d - b };
	});
}

/**
 * `rect`, its top and bottom moved off the letters of the lines above and below. A line's box (the font's
 * whole line height) often reaches into the next line, and a redaction touching a letter's outline takes the
 * letter: with "Zachowaj tekst" it would vanish from the line above. The ink of the rectangle's
 * own characters (`own`) stays covered whatever the neighbours.
 */
function keepClear(index: PageIndex, rect: Rect, own: number[]): Rect {
	const { text, ink } = index.page;
	const at = (i: number) => ink.subarray(4 * i, 4 * i + 4) as unknown as [number, number, number, number];
	const visible = own.filter((i) => !/\s/u.test(text[i]!));
	if (visible.length === 0) return rect;
	const ownTop = Math.min(...visible.map((i) => at(i)[1]));
	const ownBottom = Math.max(...visible.map((i) => at(i)[3]));
	const middle = (ownTop + ownBottom) / 2;
	const ownLines = new Set(own.map((i) => index.lineOf[i]));
	let [top, bottom] = [rect.y, rect.y + rect.h];
	for (let i = 0; i < text.length; i++) {
		if (ownLines.has(index.lineOf[i]) || /\s/u.test(text[i]!)) continue;
		const [x0, y0, x1, y1] = at(i);
		if (x1 <= rect.x || x0 >= rect.x + rect.w || y1 <= top || y0 >= bottom) continue;
		// CLEARANCE: the boxes here are single precision; the worker measures the same outlines in double.
		if ((y0 + y1) / 2 < middle) top = Math.max(top, y1 + CLEARANCE);
		else bottom = Math.min(bottom, y0 - CLEARANCE);
	}
	[top, bottom] = [Math.min(top, ownTop), Math.max(bottom, ownBottom)];
	return { x: rect.x, y: top, w: rect.w, h: bottom - top };
}

/**
 * Other forms of a one-word query, or of each word of a name (separateWords()): words that start
 * like it without its last one or two letters (at least three kept) and are not found by it already.
 * "Kowalski" → "Kowalska", "Kowalscy"; "Anna Nowak" → "Anny", "Annie".
 */
export function similarWords(indexes: PageIndex[], query: string): Similar[] {
	const q = foldQuery(query);
	if (isNumberQuery(q)) return [];
	const words = q.includes(" ") ? separateWords(q) : [q];
	const stems = words.flatMap((word) => [word.slice(0, -1), word.slice(0, -2)]).filter((stem) => stem.length >= 3);
	const found = new Map<string, Similar>();
	for (const index of indexes) {
		for (const match of index.folded.matchAll(/[\p{L}\p{N}]+/gu)) {
			const word = match[0];
			if (words.some((w) => word.startsWith(w)) || !stems.some((stem) => word.startsWith(stem))) continue;
			const entry = found.get(word);
			if (entry) entry.count++;
			else {
				const from = index.foldedFrom[match.index]!;
				const to = index.foldedFrom[match.index + word.length - 1]! + 1;
				found.set(word, { key: word, word: index.page.text.slice(from, to).replace(/[-­]?\n/g, ""), count: 1 });
			}
		}
	}
	return [...found.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** A word of the page: characters `start`…`end` (not included) of the text, with their box. */
type Word = { x0: number; y0: number; x1: number; y1: number; start: number; end: number };
const wordCache = new WeakMap<PageIndex, Word[]>();

/**
 * The words of the page, each with its box: runs of characters between spaces and line ends, without the
 * punctuation at either end ("Kowalski," is "Kowalski"), as "Szukaj i zamaż" finds them. A comma's tail
 * would otherwise pull a redaction down into the line below.
 */
function wordsOf(index: PageIndex): Word[] {
	const cached = wordCache.get(index);
	if (cached) return cached;
	const { text, boxes } = index.page;
	const words: Word[] = [];
	let start = -1;
	for (let i = 0; i <= text.length; i++) {
		if (i < text.length && !/\s/u.test(text[i]!)) {
			if (start < 0) start = i;
			continue;
		}
		if (start < 0) continue;
		let [from, to] = [start, i];
		while (from < to && !WORD.test(text[from]!)) from++;
		while (to > from && !WORD.test(text[to - 1]!)) to--;
		if (from === to) [from, to] = [start, i]; // all punctuation ("–", "§"): the run as it is
		const word: Word = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, start: from, end: to };
		for (let k = from; k < to; k++) {
			const [x0, y0, x1, y1] = boxes.subarray(4 * k, 4 * k + 4) as unknown as [number, number, number, number];
			Object.assign(word, { x0: Math.min(word.x0, x0), y0: Math.min(word.y0, y0), x1: Math.max(word.x1, x1), y1: Math.max(word.y1, y1) });
		}
		words.push(word);
		start = -1;
	}
	wordCache.set(index, words);
	return words;
}

/** The words a rectangle takes in: it crosses them and covers at least a quarter of their height. */
const wordsIn = (index: PageIndex, [x0, y0, x1, y1]: number[]) =>
	wordsOf(index).filter((word) => {
		const across = Math.min(x1!, word.x1) - Math.max(x0!, word.x0);
		const down = Math.min(y1!, word.y1) - Math.max(y0!, word.y0);
		return across > 0 && down >= SNAP_SHARE * (word.y1 - word.y0);
	});

/**
 * A redaction drawn by hand, grown to the whole words it cuts into, so that no half letter or
 * first digit stays visible. A word counts when the rectangle covers at least a quarter of its height, so
 * brushing the line above or below takes nothing in, and then it stays clear of those lines' letters
 * (keepClear), so it takes nothing away from them either. Not on a scan, whose text may be off the picture.
 */
export function snapToWords(index: PageIndex, rect: Rect): Rect {
	if (index.page.kind !== "text" || index.page.scan) return rect;
	let box = [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];
	const taken = wordsIn(index, box);
	for (const word of taken) box = [Math.min(box[0]!, word.x0), Math.min(box[1]!, word.y0), Math.max(box[2]!, word.x1), Math.max(box[3]!, word.y1)];
	const own = taken.flatMap((word) => Array.from({ length: word.end - word.start }, (_, k) => word.start + k));
	const [x0, y0, x1, y1] = box as [number, number, number, number];
	return keepClear(index, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, own);
}

/**
 * The text a hand-drawn redaction covers, as a search query ("Ten tekst jest jeszcze na
 * str. 4 i 7 — zamazać też?"): its words in reading order, a word broken over two lines joined again, without
 * punctuation at either end. Empty on a page without text.
 */
export function textUnder(index: PageIndex, rect: Rect): string {
	if (index.page.kind !== "text") return "";
	const { text } = index.page;
	const words = wordsIn(index, [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h]);
	let phrase = "";
	words.forEach((word, k) => {
		const part = text.slice(word.start, word.end);
		const previous = words[k - 1];
		// Only a hyphen and the line break between them: one word broken over two lines.
		const joined = previous && /^[-­‐‑]\n$/u.test(text.slice(previous.end, word.start)) && brokenWord(text, previous.end + 1);
		phrase = joined ? phrase + part : phrase ? `${phrase} ${part}` : part;
	});
	return phrase;
}
