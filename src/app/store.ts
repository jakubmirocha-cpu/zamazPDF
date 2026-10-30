// The one store holding the document model (Zustand). Every change to the model is one step
// of the undo history; the selection is interface state and stays out of it.
import { create } from "zustand";
import { newId, type Doc, type Page, type Rect, type Redaction } from "../shared/model";

const HISTORY_LIMIT = 200;

type DocStore = {
	doc: Doc | null;
	past: Doc[];
	future: Doc[];
	/** The selected redaction, if any. */
	selected: string | null;
	/** The document as opened: what "changed" is measured against. */
	opened: Doc | null;
	/** The document as last saved: closing the tab with other changes asks first. */
	saved: Doc | null;
	/** "Zachowaj tekst" under "Więcej". Kept, in memory only, until the tab is closed. */
	keepText: boolean;
	/** A newly opened document (or none): the history starts afresh. */
	setDoc: (doc: Doc | null) => void;
	markSaved: (doc: Doc) => void;
	setKeepText: (keepText: boolean) => void;
	addRedaction: (pageId: string, rect: Rect, origin: Redaction["origin"]) => void;
	/** Many at once ("Zamaż wszystkie"), as one step to undo. */
	addRedactions: (items: { pageId: string; rect: Rect }[], origin: Redaction["origin"]) => void;
	moveRedaction: (id: string, rect: Rect) => void;
	removeRedaction: (id: string) => void;
	/** Turns a page a quarter clockwise (1) or anticlockwise (-1); its redactions stay on the same content. */
	rotatePage: (pageId: string, by: 1 | -1) => void;
	/** Removes a page with its redactions. The last page stays. */
	removePage: (pageId: string) => void;
	select: (id: string | null) => void;
	undo: () => void;
	redo: () => void;
};

const hasRedaction = (doc: Doc, id: string | null) => doc.pages.some((p) => p.redactions.some((r) => r.id === id));

const mapPages = (doc: Doc, update: (page: Page) => Page): Doc => ({ ...doc, pages: doc.pages.map(update) });

export const useDocStore = create<DocStore>()((set, get) => {
	/** One undoable step. The old document stays as it was: snapshots share everything unchanged. */
	const change = (update: (doc: Doc) => Doc, selected = get().selected) => {
		const { doc, past } = get();
		if (!doc) return;
		set({ doc: update(doc), past: [...past, doc].slice(-HISTORY_LIMIT), future: [], selected });
	};

	return {
		doc: null,
		past: [],
		future: [],
		selected: null,
		opened: null,
		saved: null,
		keepText: false,

		setDoc: (doc) => set({ doc, past: [], future: [], selected: null, opened: doc, saved: null }),
		markSaved: (saved) => set({ saved }),
		setKeepText: (keepText) => set({ keepText }),

		addRedaction: (pageId, rect, origin) => {
			const redaction: Redaction = { id: newId("redaction"), rect, origin };
			change(
				(doc) => mapPages(doc, (p) => (p.id === pageId ? { ...p, redactions: [...p.redactions, redaction] } : p)),
				redaction.id,
			);
		},

		addRedactions: (items, origin) => {
			if (items.length === 0) return;
			const byPage = new Map<string, Redaction[]>();
			for (const { pageId, rect } of items) {
				byPage.set(pageId, [...(byPage.get(pageId) ?? []), { id: newId("redaction"), rect, origin }]);
			}
			change(
				(doc) => mapPages(doc, (p) => (byPage.has(p.id) ? { ...p, redactions: [...p.redactions, ...byPage.get(p.id)!] } : p)),
				null,
			);
		},

		moveRedaction: (id, rect) =>
			change((doc) =>
				mapPages(doc, (p) =>
					p.redactions.some((r) => r.id === id)
						? { ...p, redactions: p.redactions.map((r) => (r.id === id ? { ...r, rect } : r)) }
						: p,
				),
			),

		removeRedaction: (id) =>
			change(
				(doc) =>
					mapPages(doc, (p) =>
						p.redactions.some((r) => r.id === id) ? { ...p, redactions: p.redactions.filter((r) => r.id !== id) } : p,
					),
				null,
			),

		rotatePage: (pageId, by) =>
			change((doc) =>
				mapPages(doc, (p) => (p.id === pageId ? { ...p, rotation: ((p.rotation + by * 90 + 360) % 360) as Page["rotation"] } : p)),
			),

		removePage: (pageId) => {
			const { doc, selected } = get();
			const page = doc?.pages.find((p) => p.id === pageId);
			if (!doc || !page || doc.pages.length < 2) return;
			change(
				(d) => ({ ...d, pages: d.pages.filter((p) => p !== page) }),
				page.redactions.some((r) => r.id === selected) ? null : selected,
			);
		},

		select: (selected) => set({ selected }),

		undo: () => {
			const { doc, past, future, selected } = get();
			const previous = past.at(-1);
			if (!doc || !previous) return;
			set({
				doc: previous,
				past: past.slice(0, -1),
				future: [doc, ...future],
				selected: hasRedaction(previous, selected) ? selected : null,
			});
		},

		redo: () => {
			const { doc, past, future, selected } = get();
			const next = future[0];
			if (!doc || !next) return;
			set({ doc: next, past: [...past, doc], future: future.slice(1), selected: hasRedaction(next, selected) ? selected : null });
		},
	};
});

/**
 * The document is not the file as opened: it has redactions, or pages turned or removed. Undoing
 * every change makes it the file as opened again.
 */
export const isChanged = (s: DocStore) =>
	!!s.doc &&
	!!s.opened &&
	(s.doc.pages.length !== s.opened.pages.length || s.doc.pages.some((p) => p.rotation !== 0 || p.redactions.length > 0));

/**
 * Changes not in the file saved last (or there is none): what closing the tab would lose. Undo after a save
 * makes another document, so it counts as not saved, as it should.
 */
export const hasUnsavedChanges = (s: DocStore) => isChanged(s) && s.doc !== s.saved;
