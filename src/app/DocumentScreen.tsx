import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { clampRect, pageRectToView, viewRectToPage, viewSize } from "../shared/coords";
import { t } from "./i18n";
import { LockIcon } from "./LockIcon";
import { metrics } from "./metrics";
import type { Doc, Page, Rect } from "../shared/model";
import { PageSheet } from "./PageSheet";
import { PersonalDataPanel, usePersonalData } from "./PersonalDataPanel";
import { CloseIcon, PhoneBar, PhoneMenu, RotateLeftIcon, RotateRightIcon, Sheet, useNarrow } from "./PhoneControls";
import { Priority } from "./render-queue";
import { CloseDialog } from "./CloseDialog";
import { canShareFile, SaveDialog, shareFile, useSave, type Saved } from "./SaveDialog";
import { SaveOptions } from "./SaveOptions";
import { SearchPanel, useSearch } from "./SearchPanel";
import { hasUnsavedChanges, isChanged, useDocStore } from "./store";
import { useTextReading } from "./text-store";
import { Thumbnails } from "./Thumbnails";
import { touch } from "./touch";

/** 100% shows a page at its printed size on a 96 dpi screen, as other PDF viewers do. */
const CSS_PX_PER_PT = 96 / 72;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
/** "Dopasuj" fits the widest page to the window, but no larger than this: a page wider than a laptop screen is no easier to read. */
const FIT_MAX = 1.5;
/** Around the pages. `top`: room for the hint line. On a phone the page runs to the screen's edges, and the bar over the bottom of the last page can be scrolled clear of it. */
const WIDE_SPACE = { gap: 24, padding: 32, top: 64, bottom: 32 };
const PHONE_SPACE = { gap: 8, padding: 0, top: 0, bottom: 72 };
type Space = typeof WIDE_SPACE;
/** Scrolled this far (CSS pixels) in one direction, the bar on a phone goes or comes back. */
const BAR_SCROLL = 8;
/** Three in a row on a 360-pixel screen. */
const PHONE_THUMB_WIDTH = 92;
/**
 * Biggest render of one page; beyond it the render is stretched (16 Mpx ≈ 64 MB of RGBA). With a finger for a
 * pointer 4 Mpx ≈ 16 MB, about an A4 at 200 dpi as it is saved: Safari drops a tab with no warning when memory
 * runs out, and the work is lost.
 */
const MAX_RENDER_PIXELS = window.matchMedia("(pointer: coarse)").matches ? 4_000_000 : 16_000_000;
/** One empty list for every page without search highlights, so those pages need not draw again. */
const NO_HITS: { rects: Rect[]; current: boolean }[] = [];

type Box = { x: number; y: number; w: number; h: number };
/** `ids`: the page of each box, so a page can be found again after another one is removed. */
type Layout = { scale: number; ids: string[]; boxes: Box[]; width: number; height: number };
type Viewport = { width: number; height: number; dpr: number };

/** Pages one under another, centred, at `scale` CSS pixels per point. */
function pageLayout(pages: Page[], scale: number, viewportWidth: number, space: Space): Layout {
	const widest = Math.max(...pages.map((p) => viewSize(p, scale).w));
	const width = Math.max(viewportWidth, widest + 2 * space.padding);
	let y = space.top;
	const boxes = pages.map((page) => {
		const { w, h } = viewSize(page, scale);
		const box = { x: (width - w) / 2, y, w, h };
		y += h + space.gap;
		return box;
	});
	return { scale, ids: pages.map((p) => p.id), boxes, width, height: y - space.gap + space.bottom };
}

const zoomStep = (zoom: number, direction: 1 | -1) =>
	direction > 0
		? (ZOOM_STEPS.find((z) => z > zoom + 0.005) ?? ZOOM_STEPS.at(-1)!)
		: (ZOOM_STEPS.findLast((z) => z < zoom - 0.005) ?? ZOOM_STEPS[0]!);

/** Device pixels per point for a page, capped so one render never gets too big. */
const renderScale = (page: Page, scale: number) =>
	Math.min(scale, Math.sqrt(MAX_RENDER_PIXELS / (page.width * page.height)));

function useViewport(element: RefObject<HTMLElement | null>) {
	const [viewport, setViewport] = useState<Viewport | null>(null);
	useLayoutEffect(() => {
		const el = element.current!;
		// Browser zoom (Ctrl +/−) resizes the element too, so devicePixelRatio is read here as well.
		const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight, dpr: window.devicePixelRatio || 1 });
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [element]);
	return viewport;
}

/** `value`, but changes reach the result only once they stop for `ms`: zooming re-renders pages once, not at every step. */
function useSettled(value: number, ms: number) {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		if (value === settled) return;
		const timer = setTimeout(() => setSettled(value), settled ? ms : 0);
		return () => clearTimeout(timer);
	}, [value, settled, ms]);
	return settled || value;
}

/**
 * The saved file, shown after saving for a last look: read-only, with the autotest's verdict.
 * `keptText`: saved with "Zachowaj tekst"; `imagePages`: pages saved as images all the same. `redacted`: there
 * were redactions (else only pages turned or removed); `removedPages`: how many pages were removed.
 */
export type Preview = { bytes: Uint8Array; name: string; keptText: boolean; imagePages: number[]; hiddenPages: number[]; redacted: boolean; removedPages: number; onBack: () => void };

type Props = {
	doc: Doc;
	/** Set when this screen shows a saved file rather than the document being redacted. */
	preview?: Preview;
	/** The document is signed electronically: the notice shows until `onSignedSeen`. */
	signed?: boolean;
	onSignedSeen?: () => void;
	onSaved?: (saved: Saved, name: string) => void;
	onClose: () => void;
};

export function DocumentScreen({ doc, preview, signed, onSignedSeen, onSaved, onClose }: Props) {
	const { pages } = doc;
	const viewer = useRef<HTMLDivElement>(null);
	const viewport = useViewport(viewer);
	const [scroll, setScroll] = useState({ top: 0, left: 0 });
	const lastScroll = useRef(scroll);
	const [zoomSetting, setZoomSetting] = useState<number | "fit">("fit");
	/** Where in the viewer the point to keep still while zooming is; the top left corner if not set. */
	const zoomAnchor = useRef<{ x: number; y: number } | null>(null);

	const narrow = useNarrow();
	const space = narrow ? PHONE_SPACE : WIDE_SPACE;
	/** What opens over the bottom of the screen on a phone. */
	const [sheet, setSheet] = useState<"menu" | "pages" | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [barHidden, setBarHidden] = useState(false);
	/** The saved file's verdict, closed to see the whole page; and the hint, gone once the document is scrolled. */
	const [passedClosed, setPassedClosed] = useState(false);
	const [hintGone, setHintGone] = useState(false);
	const [shareFailed, setShareFailed] = useState(false);
	const sharing = useRef(false);
	const share = async () => {
		// A second press while the system's window is opening would fail, and say so, though the first one worked.
		if (!preview || sharing.current) return;
		sharing.current = true;
		const shared = await shareFile(preview.bytes, preview.name);
		sharing.current = false;
		setShareFailed(!shared);
		if (!shared) setPassedClosed(false); // the message is on the band
	};

	const widest = Math.max(...pages.map((p) => viewSize(p, 1).w));
	const fit = viewport ? Math.max(ZOOM_STEPS[0]!, (viewport.width - 2 * space.padding) / (widest * CSS_PX_PER_PT)) : 1;
	const canUndo = useDocStore((s) => s.past.length > 0);
	const canRedo = useDocStore((s) => s.future.length > 0);
	const undo = useDocStore((s) => s.undo);
	const redo = useDocStore((s) => s.redo);
	const select = useDocStore((s) => s.select);
	const rotatePage = useDocStore((s) => s.rotatePage);
	const hasRedactions = pages.some((p) => p.redactions.length > 0);
	// Redactions, or pages turned or removed: something to save.
	const changed = useDocStore(isChanged);
	const save = useSave(doc, (saved, name) => onSaved?.(saved, name));
	// "Zamknij plik" asks first while there are changes not in the file saved last.
	const unsaved = useDocStore(hasUnsavedChanges);
	const [closing, setClosing] = useState(false);
	const addRedactions = useDocStore((s) => s.addRedactions);
	const searchInput = useRef<HTMLInputElement>(null);
	const search = useSearch(doc);
	const personal = usePersonalData(doc);
	useTextReading(doc, !preview);
	// The list of personal data and "Szukaj i zamaż" never highlight at once: typing a query closes the list.
	useEffect(() => {
		if (search.query) personal.close();
	}, [search.query]);
	const zoom = zoomSetting === "fit" ? Math.min(fit, FIT_MAX) : zoomSetting;
	// Laid out again only when a page's size on screen changes (zoom, a page turned or removed), not with
	// every redaction.
	const shape = pages.map((p) => `${p.id}:${p.rotation}`).join(" ");
	const layout = useMemo(() => pageLayout(pages, zoom * CSS_PX_PER_PT, viewport?.width ?? 0, space), [shape, zoom, viewport?.width, space]);
	const deviceScale = useSettled(viewport ? layout.scale * viewport.dpr : 0, 150);

	// Keep the same spot of the document under the anchor when the layout changes: zooming, or a page turned
	// or removed above the one in view.
	const previousLayout = useRef(layout);
	useLayoutEffect(() => {
		const before = previousLayout.current;
		previousLayout.current = layout;
		const el = viewer.current;
		if (!el || before === layout) return;
		const { x, y } = zoomAnchor.current ?? { x: 0, y: 0 };
		zoomAnchor.current = null;
		const docX = lastScroll.current.left + x;
		const docY = lastScroll.current.top + y;
		const index = Math.max(0, before.boxes.findLastIndex((b) => b.y <= docY));
		const from = before.boxes[index]!;
		const to = layout.boxes[layout.ids.indexOf(before.ids[index]!)];
		if (!to) return; // that page was removed: the next one has moved up into its place
		el.scrollTop = to.y + ((docY - from.y) / from.h) * to.h - y;
		el.scrollLeft = to.x + ((docX - from.x) / from.w) * to.w - x;
		lastScroll.current = { top: el.scrollTop, left: el.scrollLeft };
		setScroll(lastScroll.current); // before paint, so the page number never shows the old position on the new layout
	}, [layout]);

	const zoomTo = (next: number | "fit", anchor?: { x: number; y: number }) => {
		zoomAnchor.current = anchor ?? (viewport ? { x: viewport.width / 2, y: viewport.height / 2 } : null);
		setZoomSetting(next);
	};

	const onWheel = useEffectEvent((e: WheelEvent) => {
		if (!e.ctrlKey) return;
		e.preventDefault(); // Ctrl + wheel (and touchpad pinch) zooms the document, not the whole interface
		const rect = viewer.current!.getBoundingClientRect();
		zoomTo(zoomStep(zoom, e.deltaY < 0 ? 1 : -1), { x: e.clientX - rect.left, y: e.clientY - rect.top });
	});
	useEffect(() => {
		const el = viewer.current!;
		const listener = (e: WheelEvent) => onWheel(e);
		el.addEventListener("wheel", listener, { passive: false });
		el.focus();
		return () => el.removeEventListener("wheel", listener);
	}, []);

	// Two fingers zoom the document (the browser's own zoom would take the bar and the sheets with it), around the
	// spot between them, never below the whole width of the page. One finger held still draws (PageSheet): no scrolling.
	const pinch = useRef<{ spread: number; zoom: number } | null>(null);
	const onTouch = useEffectEvent((e: TouchEvent) => {
		if (touch.drawing) return e.preventDefault();
		if (e.touches.length !== 2) {
			if (pinch.current && zoom <= fit * 1.03) setZoomSetting("fit");
			pinch.current = null;
			return;
		}
		const [a, b] = [e.touches[0]!, e.touches[1]!];
		const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
		if (!pinch.current) pinch.current = { spread, zoom };
		e.preventDefault();
		const rect = viewer.current!.getBoundingClientRect();
		const next = Math.min(Math.max(pinch.current.zoom * (spread / pinch.current.spread), Math.min(fit, FIT_MAX)), ZOOM_STEPS.at(-1)!);
		zoomTo(next, { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top });
	});
	useEffect(() => {
		if (!narrow) return;
		const el = viewer.current!;
		const listener = (e: TouchEvent) => onTouch(e);
		for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) el.addEventListener(type, listener as EventListener, { passive: false });
		return () => {
			for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) el.removeEventListener(type, listener as EventListener);
		};
	}, [narrow]);

	// The phone's Back goes one step back in the app (a sheet, the search, the file) instead of leaving the page and
	// the work on it: the browser's question on leaving is not sure to come on a phone.
	const onBackButton = useEffectEvent(() => {
		history.pushState(null, "");
		if (sheet) setSheet(null);
		else if (personal.open) personal.close();
		else if (search.query || searchOpen) closeSearch();
		else if (preview) preview.onBack();
		else if (unsaved) setClosing(true);
		else onClose();
	});
	useEffect(() => {
		if (!narrow) return;
		history.pushState(null, "");
		const listener = () => onBackButton();
		window.addEventListener("popstate", listener);
		return () => window.removeEventListener("popstate", listener);
	}, [narrow]);

	const closeSearch = () => {
		search.setQuery("");
		setSearchOpen(false);
	};

	// Keys work wherever the focus is, except in a text field, which keeps its own undo and Delete.
	const onKey = useEffectEvent((e: KeyboardEvent) => {
		if (preview || save.state.step !== "idle" || closing) return;
		const ctrl = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (ctrl && key === "f") {
			// The page is a picture, so the browser's own search finds nothing in it: ours does.
			e.preventDefault();
			searchInput.current?.focus();
			searchInput.current?.select();
			return;
		}
		if ((e.target as HTMLElement).closest("input, textarea")) return;
		const store = useDocStore.getState();
		if (ctrl && key === "z" && !e.shiftKey) store.undo();
		else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) store.redo();
		else if (store.selected && (e.key === "Delete" || e.key === "Backspace")) store.removeRedaction(store.selected);
		else if (store.selected && e.key === "Escape") store.select(null);
		else if (store.selected && e.key.startsWith("Arrow")) nudge(store.selected, e.key, e.shiftKey ? 10 : 1);
		else return;
		e.preventDefault();
	});
	useEffect(() => {
		const listener = (e: KeyboardEvent) => onKey(e);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, []);

	/** Arrow keys move the selected redaction by `step` points in the direction seen on screen. */
	const nudge = (id: string, key: string, step: number) => {
		const page = pages.find((p) => p.redactions.some((r) => r.id === id))!;
		const view = pageRectToView(page.redactions.find((r) => r.id === id)!.rect, page, 1);
		const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
		const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
		const size = viewSize(page, 1);
		const moved = { ...view, x: Math.min(Math.max(view.x + dx, 0), size.w - view.w), y: Math.min(Math.max(view.y + dy, 0), size.h - view.h) };
		useDocStore.getState().moveRedaction(id, viewRectToPage(clampRect(moved, size.w, size.h), page, 1));
	};

	const frame = useRef(0);
	const barScroll = useRef(0);
	const onScroll = () => {
		const el = viewer.current!;
		if (narrow) {
			const moved = el.scrollTop - barScroll.current;
			if (Math.abs(moved) >= BAR_SCROLL) {
				barScroll.current = el.scrollTop;
				// Back at either end of the document, where there is nothing more to scroll to bring it back.
				setBarHidden(moved > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - BAR_SCROLL);
				setHintGone(true);
			}
		}
		lastScroll.current = { top: el.scrollTop, left: el.scrollLeft };
		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(() => setScroll(lastScroll.current));
	};

	// Render what is on screen, and the pages next to it (at least one on each side, at most a screen away)
	// so scrolling finds them ready.
	const top = scroll.top;
	const bottom = scroll.top + (viewport?.height ?? 0);
	const reach = viewport?.height ?? 0;
	const overlaps = layout.boxes.map((box) => Math.min(box.y + box.h, bottom) - Math.max(box.y, top));
	const current = overlaps.indexOf(Math.max(...overlaps));
	const firstVisible = overlaps.findIndex((o) => o > 0);
	const lastVisible = overlaps.findLastIndex((o) => o > 0);
	const priorities = layout.boxes.map((box, i) => {
		if (overlaps[i]! > 0) return Priority.visible;
		if (i === firstVisible - 1 || i === lastVisible + 1) return Priority.nearby;
		if (box.y < bottom + reach && box.y + box.h > top - reach) return Priority.nearby;
		return null;
	});

	// One function for the whole document, so a thumbnail need not redraw at every frame of scrolling.
	const boxes = useRef(layout.boxes);
	boxes.current = layout.boxes;
	const gap = useRef(space.gap);
	gap.current = space.gap;
	const goTo = useCallback((index: number) => {
		viewer.current!.scrollTop = boxes.current[index]!.y - gap.current;
		setSheet(null);
	}, []);

	// "Szukaj i zamaż", or the list of personal data while it is open: the places not redacted yet, by page,
	// and the current one brought into view.
	const marks = personal.open ? personal.marks : search.open;
	const shownHit = personal.open ? personal.current : search.open[search.current];
	const hitsByPage = useMemo(() => {
		const byPage = new Map<number, { rects: Rect[]; current: boolean }[]>();
		for (const hit of marks) {
			byPage.set(hit.pageIndex, [...(byPage.get(hit.pageIndex) ?? []), { rects: hit.rects, current: hit === shownHit }]);
		}
		return byPage;
	}, [marks, shownHit]);

	// Showing a place of the list again (shownTimes) scrolls to it again, even if it is the same one.
	const shownKey = shownHit ? `${shownHit.pageIndex}:${shownHit.rects[0]!.x}:${shownHit.rects[0]!.y}:${personal.open ? personal.shownTimes : ""}` : "";
	const reveal = useEffectEvent(() => {
		const el = viewer.current;
		if (!shownHit || !el || !viewport) return;
		const page = pages[shownHit.pageIndex]!;
		const box = layout.boxes[shownHit.pageIndex]!;
		const rect = pageRectToView(shownHit.rects[0]!, page, layout.scale);
		// On a phone the place stays clear of what is open over the page: the list below it, the search above it.
		el.scrollTop = box.y + rect.y - viewport.height * (narrow ? (personal.open ? 1 / 4 : 1 / 2) : 1 / 3);
		if (box.x + rect.x < el.scrollLeft || box.x + rect.x + rect.w > el.scrollLeft + viewport.width) {
			el.scrollLeft = box.x + rect.x - viewport.width / 3;
		}
	});
	// Not right after a suggestion (search.still): the workspace stays where the user has just drawn.
	const still = search.still && !personal.open;
	useEffect(() => {
		if (shownKey && !still) reveal();
	}, [shownKey, still]);

	const redactAll = () =>
		addRedactions(
			search.open.flatMap((hit) => hit.rects.map((rect) => ({ pageId: hit.pageId, rect }))),
			"search",
		);

	const redactPersonal = () =>
		addRedactions(
			personal.ticked.flatMap((item) => item.rects.map((rect) => ({ pageId: item.pageId, rect }))),
			"detector",
		);

	/** Opening the list clears the search, so that only the list is highlighted. */
	const togglePersonal = () => {
		if (!personal.open) search.setQuery("");
		personal.toggleOpen();
	};

	// A redaction drawn by hand: is its text anywhere else? One function for all pages, so they need not redraw.
	// Not while the list of personal data is open: the suggestion would take its place.
	const suggest = useRef(search.suggest);
	useLayoutEffect(() => {
		suggest.current = personal.open ? () => {} : search.suggest;
	});
	const onDrawn = useCallback((pageIndex: number, rect: Rect) => suggest.current(pageIndex, rect), []);

	const askToClose = () => (unsaved && !preview ? setClosing(true) : onClose());
	const showSearch = !preview && (!narrow || searchOpen || !!search.query);

	return (
		<div className={["document", preview && "is-preview", narrow && "is-phone"].filter(Boolean).join(" ")}>
			{!narrow && (
			<header className="bar">
				<h1 className="bar-file" title={doc.sources[0]?.name}>
					{doc.sources[0]?.name}
				</h1>
				{!preview && (
					<div className="history">
						<button type="button" className="button-quiet" title={t.document.undoHint} disabled={!canUndo} onClick={undo}>
							{t.document.undo}
						</button>
						<button type="button" className="button-quiet" title={t.document.redoHint} disabled={!canRedo} onClick={redo}>
							{t.document.redo}
						</button>
					</div>
				)}
				{/* The page shown, and turning it: where PDF viewers keep turning. */}
				<div className="pages">
					<p className="bar-page" aria-live="polite">
						{t.document.pageOf(current + 1, pages.length)}
					</p>
					{!preview && (
						<>
							<button
								type="button"
								className="button-quiet icon-button"
								title={t.document.rotateLeftPage(current + 1)}
								aria-label={t.document.rotateLeftPage(current + 1)}
								onClick={() => rotatePage(pages[current]!.id, -1)}
							>
								<RotateLeftIcon />
							</button>
							<button
								type="button"
								className="button-quiet icon-button"
								title={t.document.rotateRightPage(current + 1)}
								aria-label={t.document.rotateRightPage(current + 1)}
								onClick={() => rotatePage(pages[current]!.id, 1)}
							>
								<RotateRightIcon />
							</button>
						</>
					)}
				</div>
				<div className="zoom" role="group" aria-label={t.document.zoom}>
					<button type="button" className="button-quiet zoom-step" aria-label={t.document.zoomOut} onClick={() => zoomTo(zoomStep(zoom, -1))}>
						−
					</button>
					<output className="zoom-value">{Math.round(zoom * 100)}%</output>
					<button type="button" className="button-quiet zoom-step" aria-label={t.document.zoomIn} onClick={() => zoomTo(zoomStep(zoom, 1))}>
						+
					</button>
					<button
						type="button"
						className="button-quiet"
						title={t.document.zoomFitHint}
						aria-pressed={zoomSetting === "fit"}
						onClick={() => zoomTo("fit")}
					>
						{t.document.zoomFit}
					</button>
				</div>
				<button type="button" className="button-quiet" onClick={askToClose}>
					{t.document.close}
				</button>
				{preview ? (
					<button type="button" className="button" onClick={preview.onBack}>
						{t.preview.back}
					</button>
				) : (
					<div className="save">
						<SaveOptions />
						<button
							type="button"
							className="button"
							disabled={!changed}
							title={changed ? undefined : t.save.nothingYet}
							onClick={save.start}
						>
							{t.save.button}
						</button>
					</div>
				)}
			</header>
			)}

			{preview && !(narrow && passedClosed) && (
				<div className="passed" role="status">
					<CheckIcon />
					<div className="passed-body">
						<p>
							<strong>{preview.redacted ? t.preview.passed : t.preview.savedClean}</strong> {t.preview.look(preview.name)}
							{preview.redacted && preview.keptText && ` ${t.preview.keptText}`}
							{preview.imagePages.length > 0 && ` ${t.preview.imagePages(preview.imagePages)}`}
							{preview.hiddenPages.length > 0 && ` ${t.preview.hiddenPages(preview.hiddenPages)}`}
							{preview.removedPages > 0 && ` ${t.preview.removedPages(preview.removedPages)}`}
							{shareFailed && <strong> {t.preview.shareFailed}</strong>}
						</p>
						{canShareFile(preview.name) && (
							<button type="button" className="button-quiet passed-share" onClick={share}>
								{t.preview.share}
							</button>
						)}
					</div>
					{narrow && (
						<button type="button" className="phone-tool passed-close" aria-label={t.document.closeSheet} onClick={() => setPassedClosed(true)}>
							<CloseIcon />
						</button>
					)}
				</div>
			)}

			{signed && !preview && (
				<div className="notice" role="status">
					<p>
						<strong>{t.document.signed}</strong> {t.document.signedText}
					</p>
					<button type="button" className="button-quiet" onClick={onSignedSeen}>
						{t.document.signedOk}
					</button>
				</div>
			)}

			{showSearch && (
				<SearchPanel
					search={search}
					total={pages.length}
					input={searchInput}
					onRedactAll={redactAll}
					personalOpen={personal.open}
					onPersonal={togglePersonal}
					onClose={narrow ? closeSearch : undefined}
				/>
			)}

			{!preview && personal.open && <PersonalDataPanel data={personal} total={pages.length} onRedact={redactPersonal} />}

			{closing && <CloseDialog onStay={() => setClosing(false)} onLeave={onClose} />}

			{save.state.step !== "idle" && (
				<SaveDialog key={save.state.step} state={save.state} onDownload={save.finish} onClose={save.close} />
			)}

			{/* The privacy line sits bottom left, where it was on the start screen, and stays in view all the time. */}
			{!narrow && (
				<aside className="side">
					<Thumbnails doc={doc} current={current} dpr={viewport?.dpr ?? 1} editable={!preview} onSelect={goTo} />
					<p className="privacy side-privacy">
						<LockIcon />
						{t.privacy}
					</p>
				</aside>
			)}

			{narrow && (
				<PhoneBar
					hidden={barHidden}
					onBack={preview?.onBack}
					canUndo={canUndo}
					changed={changed}
					page={current + 1}
					pages={pages.length}
					onMenu={() => setSheet("menu")}
					onUndo={undo}
					onPages={() => setSheet("pages")}
					onSearch={() => {
						if (personal.open) personal.close();
						setSearchOpen(true);
					}}
					onSave={save.start}
				/>
			)}

			{narrow && !preview && !hasRedactions && !hintGone && !sheet && !showSearch && !personal.open && <p className="phone-hint">{t.document.fingerHint}</p>}

			{sheet === "menu" && (
				<Sheet title={doc.sources[0]?.name ?? t.document.menu} onClose={() => setSheet(null)}>
					<PhoneMenu
						doc={doc}
						current={current}
						editable={!preview}
						zoom={zoom}
						zoomIsFit={zoomSetting === "fit"}
						onZoomStep={(direction) => zoomTo(zoomStep(zoom, direction))}
						onZoomFit={() => zoomTo("fit")}
						// The band with the button can be closed, and the file is still there to pass on.
						onShare={
							preview && canShareFile(preview.name)
								? () => {
										setSheet(null);
										void share();
									}
								: undefined
						}
						onPersonal={() => {
							setSheet(null);
							setSearchOpen(false);
							togglePersonal();
						}}
						onCloseFile={() => {
							setSheet(null);
							askToClose();
						}}
					/>
				</Sheet>
			)}
			{sheet === "pages" && (
				<Sheet title={t.document.pages} onClose={() => setSheet(null)}>
					<Thumbnails doc={doc} current={current} dpr={viewport?.dpr ?? 1} editable={!preview} width={PHONE_THUMB_WIDTH} onSelect={goTo} />
				</Sheet>
			)}

			<div className="viewer" ref={viewer} tabIndex={0} onScroll={onScroll}>
				{viewport && (
					<div
						className="viewer-content"
						style={{ width: layout.width, height: layout.height }}
						onPointerDown={(e) => e.target === e.currentTarget && select(null)}
					>
						{!hasRedactions && !preview && !narrow && (
							<p className="viewer-hint" style={{ left: layout.boxes[0]!.x }}>
								{t.document.hint}
							</p>
						)}
						{pages.map((page, i) => {
							const box = layout.boxes[i]!;
							const priority = priorities[i] ?? Priority.nearby;
							return (
								<PageSheet
									key={page.id}
									page={page}
									index={i}
									left={box.x}
									top={box.y}
									scale={layout.scale}
									renderScale={priorities[i] == null ? null : renderScale(page, deviceScale)}
									priority={priority}
									editable={!preview}
									hits={hitsByPage.get(i) ?? NO_HITS}
									onShown={i === 0 ? metrics.firstPageShown : undefined}
									onDrawn={onDrawn}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function CheckIcon() {
	return (
		<svg className="passed-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4.5 12.5l5 5 10-11" />
		</svg>
	);
}
