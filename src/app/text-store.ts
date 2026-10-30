// The text of every page, read in the background right after a file opens, ready for searching
// and for snapping redactions to words. Derived from the sources, so kept apart from the model and its history.
import { useEffect } from "react";
import { create } from "zustand";
import type { Doc } from "../shared/model";
import { call } from "./engine";
import { metrics } from "./metrics";
import { enqueue, Priority } from "./render-queue";
import { indexPage, type PageIndex } from "./search";

type TextStore = {
	/** By textKey(). */
	pages: Record<string, PageIndex>;
	add: (key: string, index: PageIndex) => void;
	clear: () => void;
};

export const textKey = (sourceId: string, pageIndex: number) => `${sourceId}:${pageIndex}`;

export const useTextStore = create<TextStore>()((set) => ({
	pages: {},
	add: (key, index) => set((s) => ({ pages: { ...s.pages, [key]: index } })),
	clear: () => set({ pages: {} }),
}));

/** Reads, page by page and after everything on screen, the text of the pages not read yet. */
export function useTextReading(doc: Doc, enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		const { pages, add } = useTextStore.getState();
		const tickets = doc.pages
			.filter((page) => !pages[textKey(page.sourceId, page.sourcePageIndex)])
			.map((page) =>
				enqueue(
					Priority.text,
					() => call("extractText", page.sourceId, page.sourcePageIndex),
					(text) => {
						if (text instanceof Error) return; // the page stays unsearchable; its picture still shows
						add(textKey(page.sourceId, page.sourcePageIndex), indexPage(text));
						metrics.textRead(Object.keys(useTextStore.getState().pages).length);
					},
				),
			);
		return () => tickets.forEach((ticket) => ticket.cancel());
		// Pages are read once per source: redactions changing the model must not start the reading again.
	}, [doc.sources, enabled]);
}
