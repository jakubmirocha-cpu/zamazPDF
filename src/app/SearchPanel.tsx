import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Doc, Rect } from "../shared/model";
import { pageList, t } from "./i18n";
import { metrics } from "./metrics";
import { CloseIcon } from "./PhoneControls";
import { find, rectsOf, similarWords, textUnder, type PageIndex, type Similar } from "./search";
import { useDocStore } from "./store";
import { textKey, useTextStore } from "./text-store";

/** One place the query was found: its rectangles (one per line) on one page. */
export type Hit = { pageIndex: number; pageId: string; rects: Rect[] };

const NONE: Hit[] = [];

const contains = (outer: Rect, inner: Rect) =>
	inner.x >= outer.x - 0.01 &&
	inner.y >= outer.y - 0.01 &&
	inner.x + inner.w <= outer.x + outer.w + 0.01 &&
	inner.y + inner.h <= outer.y + outer.h + 0.01;

/** Where the query (and the similar words chosen with it) is found, page by page. */
function hitsOf(doc: Doc, indexes: (PageIndex | undefined)[], query: string, chosen: string[]): Hit[] {
	const hits: Hit[] = [];
	indexes.forEach((index, pageIndex) => {
		if (!index) return;
		const ranges = [...find(index, query), ...chosen.flatMap((word) => find(index, word, true))].sort((a, b) => a.start - b.start);
		for (const range of ranges) hits.push({ pageIndex, pageId: doc.pages[pageIndex]!.id, rects: rectsOf(index, range) });
	});
	return hits;
}

/** A found place already under a redaction is done: no highlight, not counted again. */
export const notRedacted = (doc: Doc) => (hit: Pick<Hit, "pageIndex" | "rects">) => {
	const redactions = doc.pages[hit.pageIndex]!.redactions;
	return !hit.rects.every((rect) => redactions.some((r) => contains(r.rect, rect)));
};

/** A hand-drawn redaction's text worth looking for elsewhere: three letters or digits at least, not a paragraph. */
const worthFinding = (phrase: string) => phrase.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 && phrase.length <= 60;

/** "Szukaj i zamaż": the query, what it finds, and which of it is not redacted yet. */
export function useSearch(doc: Doc) {
	const [query, setQuery] = useState("");
	/** Similar words the user also wants found ("Kowalskiego" for "Kowalski"). */
	const [chosen, setChosen] = useState<string[]>([]);
	const [current, setCurrent] = useState(0);
	/** The query is the text of a redaction just drawn by hand, not typed (suggest()). */
	const [suggested, setSuggested] = useState(false);
	/** Not moved through yet: the workspace stays where the user just drew, rather than jump to the next place found. */
	const [still, setStill] = useState(false);
	const texts = useTextStore((s) => s.pages);
	const indexes = useMemo(() => doc.pages.map((p) => texts[textKey(p.sourceId, p.sourcePageIndex)]), [doc.pages, texts]);

	const found = useMemo(() => {
		if (!query.trim()) return { hits: NONE, similar: [] as Similar[] };
		const start = performance.now();
		const hits = hitsOf(doc, indexes, query, chosen);
		const similar = similarWords(indexes.filter((index): index is PageIndex => !!index), query);
		metrics.searched(performance.now() - start);
		return { hits, similar };
	}, [query, chosen, indexes, doc]);

	const open = useMemo(() => found.hits.filter(notRedacted(doc)), [found.hits, doc]);
	const at = Math.min(current, Math.max(open.length - 1, 0));

	const search = (next: string, fromRedaction = false) => {
		setQuery(next);
		setChosen([]);
		setCurrent(0);
		setSuggested(fromRedaction);
		setStill(fromRedaction);
	};

	return {
		query,
		setQuery: (next: string) => search(next),
		suggested: suggested && open.length > 0,
		still,
		/**
		 * After a redaction drawn by hand on page `pageIndex`: when its text is somewhere
		 * else too, not redacted yet, it becomes the query, so those places light up and "Zamaż wszystkie"
		 * takes them. Nothing is redacted without the user. A suggestion nobody took goes with the next drawing.
		 */
		suggest: (pageIndex: number, rect: Rect) => {
			const now = useDocStore.getState().doc; // with the redaction just added
			const index = indexes[pageIndex];
			const phrase = now && index ? textUnder(index, rect) : "";
			if (now && worthFinding(phrase) && hitsOf(now, indexes, phrase, []).some(notRedacted(now))) search(phrase, true);
			else if (suggested) search("");
		},
		chosen,
		toggle: (word: string) => setChosen((words) => (words.includes(word) ? words.filter((w) => w !== word) : [...words, word])),
		hits: found.hits,
		open,
		similar: found.similar,
		current: at,
		step: (by: 1 | -1) => {
			if (open.length === 0) return;
			// The first step from a suggestion shows the place it stands on; later ones move on.
			if (still) setStill(false);
			else setCurrent((at + by + open.length) % open.length);
		},
		read: indexes.filter(Boolean).length,
		noText: indexes.flatMap((index, i) => (index && index.page.kind !== "text" ? [i + 1] : [])),
		scans: indexes.flatMap((index, i) => (index && index.page.kind === "text" && index.page.scan ? [i + 1] : [])),
	};
}

export type Search = ReturnType<typeof useSearch>;

type Props = {
	search: Search;
	total: number;
	input: RefObject<HTMLInputElement | null>;
	/** The strip itself, to measure on a phone, where it lies over the page. */
	strip?: RefObject<HTMLDivElement | null>;
	onRedactAll: () => void;
	/** "Znajdź dane osobowe": whether its list is open, and opening or closing it. */
	personalOpen: boolean;
	onPersonal: () => void;
	/** On a phone the strip opens on demand and has this button to close it. */
	onClose?: () => void;
};

export function SearchPanel({ search, total, input, strip, onRedactAll, personalOpen, onPersonal, onClose }: Props) {
	// Opened on demand to type in: the keyboard comes with it. Not for a suggestion, which comes up by itself.
	useEffect(() => {
		if (onClose && !search.query) input.current?.focus();
	}, []);
	const searching = search.query.trim().length > 0;
	const notes: string[] = [];
	// The one note that asks something: set like the rest of the strip, not muted.
	const ask = search.suggested ? t.search.alsoOn(pageList([...new Set(search.open.map((hit) => hit.pageIndex + 1))])) : null;
	if (searching) {
		if (search.read < total) notes.push(t.search.reading(search.read, total));
		else if (search.hits.length === 0) notes.push(t.search.nothing);
		if (search.noText.length > 0) notes.push(t.search.noText(pageList(search.noText), search.noText.length));
		if (search.scans.length > 0) notes.push(t.search.scans(pageList(search.scans), search.scans.length));
	}
	const showSteps = !onClose || search.open.length > 1;
	const count =
		search.open.length > 0
			? t.search.count(search.current + 1, search.open.length)
			: search.hits.length > 0
				? t.search.allCovered
				: t.search.none;

	return (
		<div ref={strip} className={search.suggested ? "search is-suggestion" : "search"} role="search">
			<div className="search-row">
				<label className="search-label" htmlFor="search-input">
					{t.search.label}
				</label>
				<div className="search-field">
					<input
						id="search-input"
						ref={input}
						className="field-input search-input"
						value={search.query}
						placeholder={t.search.placeholder}
						title={t.search.hint}
						autoComplete="off"
						autoCorrect="off"
						autoCapitalize="off"
						spellCheck={false}
						onChange={(e) => search.setQuery(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") search.step(e.shiftKey ? -1 : 1);
							else if (e.key === "Escape") search.query ? search.setQuery("") : e.currentTarget.blur();
							else return;
							e.preventDefault();
						}}
					/>
					{/* Clears what was searched, a suggestion too: nothing stays hanging, nothing to delete by hand. */}
					{search.query && (
						<button type="button" className="search-clear" aria-label={t.search.clear} title={t.search.clearHint} onClick={() => search.setQuery("")}>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					)}
				</div>
				{onClose && (
					<button type="button" className="phone-tool phone-search-close" aria-label={t.search.close} onClick={onClose}>
						<CloseIcon />
					</button>
				)}
				{searching && (
					<>
						<div className="search-nav">
							{/* With one place or none there is nowhere to go, and on a phone no room to spare. */}
							{showSteps && (
								<button type="button" className="button-quiet zoom-step" aria-label={t.search.previous} disabled={search.open.length === 0} onClick={() => search.step(-1)}>
									‹
								</button>
							)}
							<output className="search-count" aria-live="polite">
								{count}
							</output>
							{showSteps && (
								<button type="button" className="button-quiet zoom-step" aria-label={t.search.next} disabled={search.open.length === 0} onClick={() => search.step(1)}>
									›
								</button>
							)}
						</div>
						<button type="button" className="button-strong" disabled={search.open.length === 0} onClick={onRedactAll}>
							{t.search.redactAll(search.open.length)}
						</button>
					</>
				)}
				{/* On a phone it is in the menu: here it would only take room from the page. */}
				{!onClose && (
					<button
						type="button"
						className="button-quiet search-personal"
						title={t.personal.buttonHint}
						aria-expanded={personalOpen}
						aria-controls="personal-panel"
						onClick={onPersonal}
					>
						{t.personal.button}
					</button>
				)}
			</div>
			{searching && search.similar.length > 0 && (
				<div className="search-similar">
					<span>{t.search.similar}</span>
					{search.similar.map((word) => (
						<label key={word.key} className="check">
							<input type="checkbox" checked={search.chosen.includes(word.key)} onChange={() => search.toggle(word.key)} />
							{t.search.similarWord(word.word, word.count)}
						</label>
					))}
					<span>{t.search.similarAsk}</span>
				</div>
			)}
			{ask && <p className="search-note is-ask">{ask}</p>}
			{notes.map((note) => (
				<p key={note} className="search-note">
					{note}
				</p>
			))}
		</div>
	);
}
