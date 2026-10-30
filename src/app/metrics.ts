// Timings for the performance targets, reported on <html data-…> for the automated tests.

let openStartedAt = 0;
const data = () => document.documentElement.dataset;

export const metrics = {
	openStarted() {
		openStartedAt = performance.now();
		delete data().firstPageMs;
	},
	firstPageShown() {
		if (openStartedAt && data().firstPageMs === undefined) {
			data().firstPageMs = String(Math.round(performance.now() - openStartedAt));
		}
	},
	/** Pages whose text has been read so far, in the background. */
	textRead(pages: number) {
		data().textPages = String(pages);
	},
	/** How long the last search over all pages took. */
	searched(ms: number) {
		data().searchMs = ms.toFixed(1);
	},
};
