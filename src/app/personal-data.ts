// "Znajdź dane osobowe": personal data recognised in the text of a page. Numbers are told
// apart by their check digits, or by the label before them ("PESEL", "NIP", "tel."); e-mail addresses, street
// addresses, dates of birth and a few document numbers by their shape. Pure functions over the page text read
// by the worker, as in search.ts. Nothing is redacted here, only found: the user decides.
import { fold, type PageIndex, type Range } from "./search";

/** What a finding is, in the order of the list. */
export const KINDS = [
	"pesel",
	"idCard",
	"passport",
	"account",
	"card",
	"nip",
	"regon",
	"phone",
	"email",
	"address",
	"birthDate",
	"drivingLicence",
	"plate",
	"vin",
	"landRegister",
	"clientNumber",
	"mrz",
] as const;

export type Kind = (typeof KINDS)[number];

/** A place on the page (characters of its text, end not included) and what is there. */
export type Finding = Range & { kind: Kind };

// Check digits ---------------------------------------------------------------------------------------------

/** A digit as it is, a capital letter as 10 (A) to 35 (Z): the values of check digit sums. */
const value = (c: string) => (c >= "A" ? c.charCodeAt(0) - 55 : c.charCodeAt(0) - 48);
const weighted = (s: string, weights: number[]) => weights.reduce((sum, w, i) => sum + w * value(s[i]!), 0);

/** PESEL: the check digit, and a real date of birth (the month tells the century: +20 for the 2000s). */
export function isPesel(digits: string) {
	if (!/^\d{11}$/.test(digits)) return false;
	if ((10 - (weighted(digits, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]) % 10)) % 10 !== value(digits[10]!)) return false;
	const coded = Number(digits.slice(2, 4));
	const century = [1900, 2000, 2100, 2200, 1800][Math.floor(coded / 20)];
	const month = coded % 20;
	if (!century || month < 1 || month > 12) return false;
	const day = Number(digits.slice(4, 6));
	return day >= 1 && day <= new Date(Date.UTC(century + Number(digits.slice(0, 2)), month, 0)).getUTCDate();
}

export function isNip(digits: string) {
	if (!/^\d{10}$/.test(digits)) return false;
	const sum = weighted(digits, [6, 5, 7, 2, 3, 4, 5, 6, 7]) % 11;
	return sum !== 10 && sum === value(digits[9]!);
}

/** REGON of 9 digits (a company) or 14 (its local unit). */
export function isRegon(digits: string) {
	const weights = digits.length === 9 ? [8, 9, 2, 3, 4, 5, 6, 7] : digits.length === 14 ? [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8] : null;
	if (!weights || !/^\d+$/.test(digits)) return false;
	return (weighted(digits, weights) % 11) % 10 === value(digits.at(-1)!);
}

/** IBAN (country code, two check digits, the account): modulo 97 of it, the first four characters moved to the end. */
export function isIban(iban: string) {
	if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
	let rest = 0;
	for (const c of iban.slice(4) + iban.slice(0, 4)) for (const digit of String(value(c))) rest = (rest * 10 + Number(digit)) % 97;
	return rest === 1;
}

/** A payment card number: the Luhn sum. */
export function isLuhn(digits: string) {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let n = value(digits[digits.length - 1 - i]!);
		if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
		sum += n;
	}
	return sum % 10 === 0;
}

/** A Polish ID card, "ABA300000": three letters, then the check digit and five more digits. */
export const isIdCard = (s: string) => /^[A-Z]{3}\d{6}$/.test(s) && weighted(s, [7, 3, 1, 9, 7, 3, 1, 7, 3]) % 10 === 0;

/** A Polish passport, "ZS0000177": two letters, then the check digit and six more digits. */
export const isPassport = (s: string) => /^[A-Z]{2}\d{7}$/.test(s) && weighted(s, [7, 3, 9, 1, 7, 3, 1, 7, 3]) % 10 === 0;

// Labels ---------------------------------------------------------------------------------------------------

/** What a number is said to be by the words before it; "other" for the numbers of things, not people. */
type Label = "pesel" | "nip" | "regon" | "phone" | "idCard" | "passport" | "other";

/** On folded text (search.ts: lower case, no Polish letters). */
const LABELS: [RegExp, Label][] = [
	[/pesel/g, "pesel"],
	[/\bnip\b/g, "nip"],
	[/\bregon\b/g, "regon"],
	[/\b(?:tel|telefon\w*|kom|komork\w*|fax|faks)\b/g, "phone"],
	[/\b(?:dowod\w*|d\.\s?o\.)/g, "idCard"],
	[/\bpaszport\w*/g, "passport"],
	[/\b(?:umow\w*|faktur\w*|zamowieni\w*|spraw\w*|art|poz|ust|pkt|krs|kwot\w*|sygn\w*|zl|pln)\b/g, "other"],
	// Numbers found by their own labels further down (a client number, a licence): not a phone number as well.
	[/\b(?:polis\w*|klient\w*|pacjent\w*|legitymac\w*|ubezpieczon\w*|rej|rejestracyjn\w*|jazdy)\b/g, "other"],
];

/** How far back on its line a label may stand. */
const LABEL_REACH = 40;

/**
 * The label right before `at` on the same line: the nearest one, with no other number in between (that number
 * would be the one it names). "PESEL 850 101 12345, tel. 600 100 200": the phone number's label is "tel.".
 */
function labelBefore(text: string, at: number): Label | null {
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	const before = [...text.slice(Math.max(lineStart, at - LABEL_REACH), at)].map(fold).join("");
	let nearest: { end: number; label: Label } | null = null;
	for (const [pattern, label] of LABELS) {
		for (const match of before.matchAll(pattern)) {
			const end = match.index + match[0].length;
			if (!nearest || end > nearest.end) nearest = { end, label };
		}
	}
	return nearest && !/\d/.test(before.slice(nearest.end)) ? nearest.label : null;
}

// Numbers --------------------------------------------------------------------------------------------------

const SPACE = /[    ]/u;
const SEPARATOR = /[-.‐‑–]/u;
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
const isAlnum = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const COUNTRY = /^[A-Z]{2}$/;

/** Digits written in groups, as people write numbers: "850 101 12345", "123-456-32-18", "(22) 123 45 67". */
type Run = {
	groups: Range[];
	/** Where it begins on the page, with its "+" or "(". */
	from: number;
	/** "+48 600 100 200": an international phone number. */
	plus: boolean;
	/** Two capitals before it, as "PL" before an account number or a NIP; `glued` without a space. */
	country: { start: number; code: string; glued: boolean } | null;
	/** Decimals or a currency after it: an amount of money, nobody's number. */
	amount: boolean;
};

function runsIn(text: string): Run[] {
	const runs: Run[] = [];
	for (let i = 0; i < text.length; i++) {
		if (!isDigit(text[i])) continue;
		const before = text[i - 1];
		let country: Run["country"] = null;
		if (isAlnum(before)) {
			// "PL1234567890" is a number with its country; any other word with digits in it ("nr12", "A4") is not.
			if (COUNTRY.test(text.slice(i - 2, i)) && !isAlnum(text[i - 3])) country = { start: i - 2, code: text.slice(i - 2, i), glued: true };
			else {
				while (isAlnum(text[i + 1])) i++;
				continue;
			}
		} else if (SPACE.test(before ?? "") && COUNTRY.test(text.slice(i - 3, i - 1)) && !isAlnum(text[i - 4])) {
			country = { start: i - 3, code: text.slice(i - 3, i - 1), glued: false };
		}
		const plus = before === "+";
		const from = plus ? (text[i - 2] === "(" ? i - 2 : i - 1) : before === "(" ? i - 1 : i;

		const groups: Range[] = [];
		let at = i;
		for (;;) {
			let end = at;
			while (isDigit(text[end])) end++;
			groups.push({ start: at, end });
			// Between two groups: a bracket, a space, a dash or a dot, a space, a bracket; one of them at least.
			let k = end;
			if (text[k] === ")") k++;
			if (SPACE.test(text[k] ?? "")) k++;
			if (SEPARATOR.test(text[k] ?? "")) k++;
			if (SPACE.test(text[k] ?? "")) k++;
			if (text[k] === "(") k++;
			if (k === end || !isDigit(text[k])) break;
			at = k;
		}
		const end = groups.at(-1)!.end;
		i = end - 1;
		if (isAlnum(text[end])) {
			// Glued to a word on the right ("12A", "123abc"): a house number or a code, not a number of a person.
			while (isAlnum(text[i + 1])) i++;
			continue;
		}
		const amount = /^(?:,\d|[  ]?(?:zł|zl|pln|eur|usd|gr|%))/iu.test(text.slice(end, end + 5));
		runs.push({ groups, from, plus, country, amount });
	}
	return runs;
}

/** What groups `i`…`j` of a run are, if anyone's number. */
function classify(text: string, run: Run, i: number, j: number, label: Label | null): Kind | null {
	const groups = run.groups.slice(i, j + 1);
	const digits = groups.map((g) => text.slice(g.start, g.end)).join("");
	const n = digits.length;
	if (i === 0 && run.plus) return n >= 8 && n <= 15 ? "phone" : null;
	if (i === 0 && run.country) {
		const { code } = run.country;
		if (isIban(code + digits) || (code === "PL" && n === 26)) return "account";
		if (code === "PL" && n === 10 && (isNip(digits) || label === "nip")) return "nip";
		if (run.country.glued) return null;
	}
	// What the label says comes first: a PESEL with a mistake in it is still someone's PESEL.
	if (label === "other") return null;
	if (label === "pesel" && n === 11) return "pesel";
	if (label === "nip" && n === 10) return "nip";
	if (label === "regon" && (n === 9 || n === 14)) return "regon";
	if (label === "phone" && n >= 7 && n <= 15) return "phone";
	if (n === 26) return "account"; // an account number (NRB), even mistyped: nothing else has 26 digits
	if (n === 14 && isRegon(digits)) return "regon";
	if (n === 11 && isPesel(digits)) return "pesel";
	if (n >= 13 && n <= 19 && /^[2-6]/.test(digits) && isLuhn(digits)) return "card";
	if (n === 11 && text.slice(groups[0]!.start, groups[0]!.end) === "48") return "phone"; // "48 600 100 200"
	if (n >= 11 && n <= 15 && digits.startsWith("00")) return "phone"; // "0048 600 100 200"
	if (n === 10 && isNip(digits)) return "nip";
	if (n === 9) return "phone"; // landline or mobile, however grouped
	return null;
}

/** The numbers of a page that are someone's: each run split into the longest pieces that are. */
function numbersIn(text: string, addresses: Range[]): Finding[] {
	const findings: Finding[] = [];
	for (const run of runsIn(text)) {
		if (run.amount || addresses.some((a) => a.start <= run.from && run.from < a.end)) continue; // in "www.firma.pl/123456789"
		const start0 = run.country?.start ?? run.from;
		const label = labelBefore(text, start0);
		for (let i = 0; i < run.groups.length; ) {
			let found: { kind: Kind; j: number } | null = null;
			for (let j = run.groups.length - 1; j >= i && !found; j--) {
				const kind = classify(text, run, i, j, i === 0 ? label : null);
				if (kind) found = { kind, j };
			}
			if (!found) {
				i++;
				continue;
			}
			const { kind, j } = found;
			const start = i > 0 ? run.groups[i]!.start : run.country && (kind === "account" || kind === "nip") ? run.country.start : run.from;
			findings.push({ kind, start, end: run.groups[j]!.end });
			i = j + 1;
		}
	}
	return findings;
}

// Shapes ---------------------------------------------------------------------------------------------------

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const ID_CARD = /(?<![\p{L}\p{N}])([A-Z]{3})[  ]?(\d{6})(?![\p{L}\p{N}])/gu;
const PASSPORT = /(?<![\p{L}\p{N}])([A-Z]{2})[  ]?(\d{7})(?![\p{L}\p{N}])/gu;
/** A vehicle identification number: 17 letters and digits, no I, O or Q. */
const VIN = /(?<![\p{L}\p{N}])[A-HJ-NPR-Z0-9]{17}(?![\p{L}\p{N}])/gu;
/** Księga wieczysta: court, number, check digit ("KR1P/00012345/6"). */
const LAND_REGISTER = /(?<![\p{L}\p{N}])[A-Z]{2}\d[A-Z]\/\d{8}\/\d(?![\p{N}])/gu;
/** A Polish driving licence number ("01234/16/1234"). */
const DRIVING_LICENCE = /(?<![\p{L}\p{N}/])\d{5}\/\d{2}\/\d{4}(?![\p{N}/])/gu;
/** Postal code and the place after it: "30-001 Kraków", "43-300 Bielsko-Biała". */
const POSTAL = /(?<![\p{L}\p{N}])\d{2}[-‐‑–]\d{3}(?![\p{N}])[  ]+\p{Lu}\p{L}*(?:[-  ]\p{Lu}\p{L}*){0,2}/gu;
/**
 * A street with its number: "ul. Krótka 12/4", "al. Jana Pawła II 5 m. 3", "ul. gen. Andersa 7", "przy ulicy
 * 3 Maja 7". The name is up to four words with capitals (a day of a month first, as in "3 Maja", and titles
 * such as "gen." or "św." before it); the number may be missing.
 */
const STREET =
	/(?<![\p{L}\p{N}.@])(?:(?:[Uu]l|[Aa]l|[Oo]s|[Pp]l)\.[  ]*|(?:[Uu]lic[aęyi]|[Aa]lej[aię]|[Aa]le[ij]|[Oo]siedl[eu]|[Pp]lac[u]?)[  ]+)(?:(?:gen|ks|św|sw|płk|plk|marsz|kard|bp|prof|dr|im)\.?[  ]+)*(?:\d{1,2}[  ]+)?\p{Lu}[\p{L}'-]*(?:\.(?=[  ]+\p{Lu}))?(?:[  ]+\p{Lu}[\p{L}'-]*(?:\.(?=[  ]+\p{Lu}))?){0,3}(?:[  ]+\d+[A-Za-z]?(?![\p{N}])(?:[  ]?\/[  ]?\d+[A-Za-z]?)?(?:,?[  ]+(?:m|lok|mieszk)\.?[  ]?\d+[A-Za-z]?)?)?/gu;
/** Words that say an address follows ("zam.", "zamieszkała", "adres zamieszkania:"), but not "adres e-mail". */
const ADDRESS_LABEL =
	/(?<![\p{L}])(?:zam\.|zamieszka[lł]\p{L}*|zameldowan\p{L}*|adres(?:[  ]+zamieszkania|[  ]+do[  ]+korespondencji)?(?![\p{L}]))(?![  ]*(?:e-?mail|poczty|strony|www|ip|url|nr|numer)(?![\p{L}]))[  ]*:?[  ]*/giu;
/** Where an address after its label ends: a semicolon, a comma before a lower-case word, another label. */
const ADDRESS_END = /;|,[  ]+(?=\p{Ll})|[,\s]+(?=(?:PESEL|NIP|REGON|tel\.|telefon|e-?mail)(?![\p{L}]))/u;
const BIRTH_LABEL = /(?<![\p{L}])(?:ur\.|urodzon\p{L}*|urodzeni|data[  ]+(?:ur\.|urodzenia))[  ]*:?[  ]*(?:dnia[  ]+|w[  ]+dniu[  ]+)?/giu;
const DATE =
	/\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}(?:[  ]?r\.)?|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}|\d{1,2}[  ]+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)[  ]+\d{4}(?:[  ]?r\.)?/iuy;
const CLIENT_LABEL =
	/(?<![\p{L}])(?:(?:nr|numer|id|identyfikator)\.?[  ]+(?:polisy|klienta|pacjenta|legitymacji|ubezpieczonego|karty[  ]+(?:klienta|pacjenta))|polis[ay][  ]+nr\.?)[  ]*:?[  ]*/giu;
/** A number named by its label: one word with a digit in it, or digits in groups ("123 456 789"). */
const LABELLED = /(?=[\p{L}\p{N}/.-]*\d)[\p{L}\p{N}](?:[\p{L}\p{N}/.-]*[\p{L}\p{N}])?(?:[  ]\d+)*/uy;
const PLATE_LABEL =
	/(?<![\p{L}])(?:nr\.?[  ]+rej(?:\.|estracyjny)|numer[  ]+rejestracyjny|tablic\p{L}*[  ]+rejestracyjn\p{L}*)(?:[  ]+pojazdu)?[  ]*:?[  ]*/giu;
const PLATE = /(?=[A-Z0-9  ]*\d)[A-Z]{1,3}[  ]?[0-9A-Z]{3,5}(?![\p{L}\p{N}])/uy;
const LICENCE_LABEL = /(?<![\p{L}])praw[oa][  ]+jazdy(?:[  ]+(?:nr|numer))?\.?[  ]*:?[  ]*/giu;

/** `label` matches, each followed by what `value` (a sticky pattern) finds right after it. */
function afterLabels(text: string, label: RegExp, value: RegExp, kind: Kind): Finding[] {
	const found: Finding[] = [];
	for (const match of text.matchAll(label)) {
		value.lastIndex = match.index + match[0].length;
		const v = value.exec(text);
		if (v) found.push({ kind, start: v.index, end: v.index + v[0].length });
	}
	return found;
}

function addressesAfterLabels(text: string): Finding[] {
	const found: Finding[] = [];
	for (const match of text.matchAll(ADDRESS_LABEL)) {
		const start = match.index + match[0].length;
		const lineEnd = text.indexOf("\n", start);
		let rest = text.slice(start, lineEnd < 0 ? text.length : lineEnd).slice(0, 100);
		const stop = ADDRESS_END.exec(rest);
		if (stop) rest = rest.slice(0, stop.index);
		rest = rest.replace(/[\s,.;:]+$/u, "");
		if (/[\d\p{Lu}]/u.test(rest)) found.push({ kind: "address", start, end: start + rest.length });
	}
	return found;
}

const all = (text: string, pattern: RegExp, kind: Kind, keep: (m: RegExpMatchArray) => boolean = () => true): Finding[] =>
	[...text.matchAll(pattern)].filter(keep).map((m) => ({ kind, start: m.index!, end: m.index! + m[0].length }));

/** The lines of a machine-readable zone: 30 to 44 of capitals, digits and "<", spaces aside. */
function mrzLines(text: string): Finding[] {
	const found: Finding[] = [];
	let start = 0;
	for (const line of text.split("\n")) {
		const packed = line.replace(/[  ]/gu, "");
		if (packed.length >= 30 && packed.length <= 44 && /^[A-Z0-9<]+$/.test(packed) && packed.includes("<")) {
			const lead = line.length - line.trimStart().length;
			found.push({ kind: "mrz", start: start + lead, end: start + line.trimEnd().length });
		}
		start += line.length + 1;
	}
	return found;
}

/** Same kind and overlapping: one place ("ul. Długa 5/3" inside "ul. Długa 5/3, 31-147 Kraków"). */
function merged(findings: Finding[]): Finding[] {
	const out: Finding[] = [];
	for (const f of [...findings].sort((a, b) => a.start - b.start || b.end - a.end)) {
		const same = out.findLast((o) => o.kind === f.kind && o.end > f.start);
		if (same) same.end = Math.max(same.end, f.end);
		else out.push({ ...f });
	}
	return out.sort((a, b) => a.start - b.start);
}

/** Personal data on one page, in the order of its text. Pages without readable text have none. */
export function findPersonalData(index: PageIndex): Finding[] {
	if (index.page.kind !== "text") return [];
	const { text } = index.page;
	const label = (kind: Label) => (m: RegExpMatchArray) => labelBefore(text, m.index!) === kind;
	return merged([
		...numbersIn(text, index.addresses),
		...all(text, EMAIL, "email"),
		...all(text, ID_CARD, "idCard", (m) => isIdCard(m[1]! + m[2]!) || label("idCard")(m)),
		...all(text, PASSPORT, "passport", (m) => isPassport(m[1]! + m[2]!) || label("passport")(m)),
		...all(text, VIN, "vin", (m) => /\d/.test(m[0]) && /[A-Z]/.test(m[0])),
		...all(text, LAND_REGISTER, "landRegister"),
		...all(text, DRIVING_LICENCE, "drivingLicence"),
		...afterLabels(text, LICENCE_LABEL, LABELLED, "drivingLicence"),
		...all(text, POSTAL, "address"),
		...all(text, STREET, "address"),
		...addressesAfterLabels(text),
		...afterLabels(text, BIRTH_LABEL, DATE, "birthDate"),
		...afterLabels(text, CLIENT_LABEL, LABELLED, "clientNumber"),
		...afterLabels(text, PLATE_LABEL, PLATE, "plate"),
		...mrzLines(text),
	]);
}
