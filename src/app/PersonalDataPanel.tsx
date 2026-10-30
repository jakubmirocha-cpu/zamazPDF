import { useEffect, useMemo, useRef, useState } from "react";
import type { Doc, Rect } from "../shared/model";
import { pageList, t } from "./i18n";
import { findPersonalData, KINDS, type Finding, type Kind } from "./personal-data";
import { useNarrow } from "./PhoneControls";
import { rectsOf, type PageIndex } from "./search";
import { notRedacted } from "./SearchPanel";
import { useDocStore } from "./store";
import { textKey, useTextStore } from "./text-store";

/** One place on the list: what it is, its text as on the page, and its rectangles (one per line). */
export type Item = { key: string; kind: Kind; pageIndex: number; pageId: string; text: string; rects: Rect[] };

/** Each page's findings, worked out once per page text: redactions change the model, not the text. */
const cache = new WeakMap<PageIndex, (Finding & { rects: Rect[] })[]>();
function findingsOf(index: PageIndex) {
	let findings = cache.get(index);
	if (!findings) {
		findings = findPersonalData(index).map((f) => ({ ...f, rects: rectsOf(index, f) }));
		cache.set(index, findings);
	}
	return findings;
}

/**
 * "Znajdź dane osobowe": the list of what was found, all ticked to begin with. Nothing
 * is redacted until "Zamaż zaznaczone"; places already under a redaction leave the list.
 */
export function usePersonalData(doc: Doc) {
	const [open, setOpen] = useState(false);
	/** Places the user unticked. */
	const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
	/** The place last shown on the page, and how many times anything was shown (the same one again scrolls again). */
	const [shown, setShown] = useState<{ key: string; times: number } | null>(null);
	const texts = useTextStore((s) => s.pages);
	const indexes = useMemo(() => doc.pages.map((p) => texts[textKey(p.sourceId, p.sourcePageIndex)]), [doc.pages, texts]);

	const { found, items } = useMemo(() => {
		if (!open) return { found: 0, items: [] };
		const all: Item[] = indexes.flatMap((index, pageIndex) => {
			if (!index) return [];
			const page = doc.pages[pageIndex]!;
			return findingsOf(index).map(({ kind, start, end, rects }) => ({
				key: `${page.id}:${start}:${end}`,
				kind,
				pageIndex,
				pageId: page.id,
				text: index.page.text.slice(start, end).replace(/\s+/gu, " "),
				rects,
			}));
		});
		return { found: all.length, items: all.filter(notRedacted(doc)) };
	}, [open, indexes, doc]);

	const ticked = items.filter((item) => !skipped.has(item.key));
	const current = items.find((item) => item.key === shown?.key) ?? null;

	return {
		open,
		toggleOpen: () => {
			setSkipped(new Set());
			setShown(null);
			setOpen(!open);
		},
		close: () => setOpen(false),
		/** How many places were found, redacted ones included. */
		found,
		items,
		ticked,
		isTicked: (item: Item) => !skipped.has(item.key),
		/** Ticks or unticks these places together (a whole kind, or one). */
		tick: (some: Item[], on: boolean) =>
			setSkipped((before) => {
				const after = new Set(before);
				for (const item of some) {
					if (on) after.delete(item.key);
					else after.add(item.key);
				}
				return after;
			}),
		current,
		shownTimes: shown?.times ?? 0,
		show: (item: Item) => setShown((before) => ({ key: item.key, times: (before?.times ?? 0) + 1 })),
		/** Highlighted on the pages: what will be redacted, and the place shown even if unticked. */
		marks: items.filter((item) => !skipped.has(item.key) || item === current),
		read: indexes.filter(Boolean).length,
		noText: indexes.flatMap((index, i) => (index && index.page.kind !== "text" ? [i + 1] : [])),
		scans: indexes.flatMap((index, i) => (index && index.page.kind === "text" && index.page.scan ? [i + 1] : [])),
	};
}

export type PersonalData = ReturnType<typeof usePersonalData>;

type Props = { data: PersonalData; total: number; onRedact: () => void };

export function PersonalDataPanel({ data, total, onRedact }: Props) {
	const panel = useRef<HTMLElement>(null);
	const narrow = useNarrow();
	useEffect(() => panel.current?.focus(), []);
	const groups = KINDS.map((kind) => ({ kind, items: data.items.filter((item) => item.kind === kind) })).filter((g) => g.items.length > 0);
	const notes = (
		<>
			<p className="personal-note">{t.personal.unseen}</p>
			{data.noText.length > 0 && <p className="personal-note">{t.search.noText(pageList(data.noText), data.noText.length)}</p>}
			{data.scans.length > 0 && <p className="personal-note">{t.search.scans(pageList(data.scans), data.scans.length)}</p>}
		</>
	);
	const summary =
		data.read < total
			? t.search.reading(data.read, total)
			: data.found === 0
				? t.personal.nothing
				: data.items.length === 0
					? t.personal.allRedacted
					: data.items.length === data.found
						? t.personal.found(data.found)
						: t.personal.left(data.items.length, data.found);

	return (
		<aside
			ref={panel}
			id="personal-panel"
			className="personal"
			aria-labelledby="personal-title"
			tabIndex={-1}
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				e.preventDefault();
				data.close();
			}}
		>
			<div className="personal-head">
				<h2 id="personal-title" className="personal-title">
					{t.personal.title}
				</h2>
				<button type="button" className="search-clear" aria-label={t.personal.close} title={t.personal.closeHint} onClick={data.close}>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>
			<p className="personal-summary" aria-live="polite">
				{summary}
			</p>

			{groups.length > 0 && (
				<div className="personal-list">
					{groups.map(({ kind, items }) => (
						<section key={kind} className="personal-group" aria-label={t.personal.kinds[kind]}>
							<KindCheck data={data} kind={kind} items={items} />
							<ul className="personal-items">
								{items.map((item) => (
									<li key={item.key} className={item === data.current ? "personal-item is-current" : "personal-item"}>
										<input
											type="checkbox"
											aria-label={t.personal.pick(item.text)}
											checked={data.isTicked(item)}
											onChange={(e) => data.tick([item], e.currentTarget.checked)}
										/>
										<button type="button" className="personal-show" title={t.personal.showHint} onClick={() => data.show(item)}>
											<span className="personal-text">{item.text}</span>
											<span className="personal-page">{t.personal.page(item.pageIndex + 1)}</span>
										</button>
									</li>
								))}
							</ul>
						</section>
					))}
					{/* On a phone the reminders close the list, so that the button stays in view. */}
					{narrow && <div className="personal-list-notes">{notes}</div>}
				</div>
			)}

			<div className="personal-foot">
				{data.items.length > 0 && (
					<button type="button" className="button-strong" disabled={data.ticked.length === 0} onClick={onRedact}>
						{t.personal.redact(data.ticked.length)}
					</button>
				)}
				{(!narrow || groups.length === 0) && notes}
			</div>
		</aside>
	);
}

/** "PESEL (2)": ticks or unticks the whole kind; half ticked when only some of it is. */
function KindCheck({ data, kind, items }: { data: PersonalData; kind: Kind; items: Item[] }) {
	const box = useRef<HTMLInputElement>(null);
	const count = items.filter(data.isTicked).length;
	useEffect(() => {
		box.current!.indeterminate = count > 0 && count < items.length;
	});
	return (
		<label className="check personal-kind">
			<input ref={box} type="checkbox" checked={count === items.length} onChange={(e) => data.tick(items, e.currentTarget.checked)} />
			{t.personal.kind(t.personal.kinds[kind], items.length)}
		</label>
	);
}
