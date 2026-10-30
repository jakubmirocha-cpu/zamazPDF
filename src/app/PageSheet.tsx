import { memo, useRef, useState, type PointerEvent } from "react";
import { clampRect, outward, pageRectToView, viewRectToPage, viewSize, type Point } from "../shared/coords";
import { t } from "./i18n";
import type { Page, Rect } from "../shared/model";
import { PageImage } from "./PageImage";
import { snapToWords, textUnder } from "./search";
import { useDocStore } from "./store";
import { textKey, useTextStore } from "./text-store";
import { touch } from "./touch";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** What the pointer is doing on this page, in view pixels. `from` is the redaction's box when the drag began. */
type Drag =
	| { kind: "draw"; start: Point; now: Point }
	| { kind: "move"; id: string; from: Rect; start: Point; now: Point }
	| { kind: "resize"; id: string; handle: Handle; from: Rect; start: Point; now: Point };

/** A press without dragging this far is a click: it draws nothing. */
const MIN_DRAW = 4;
/** A finger held still this long (ms) starts drawing; a finger that moves this far (CSS pixels) before that is scrolling. */
const HOLD = 350;
const HOLD_SLOP = 8;

/** The rectangle a drag leads to, kept inside the page. */
function dragRect(drag: Drag, width: number, height: number): Rect {
	if (drag.kind === "draw") {
		const { start: a, now: b } = drag;
		return clampRect({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }, width, height);
	}
	const dx = drag.now.x - drag.start.x;
	const dy = drag.now.y - drag.start.y;
	const { from } = drag;
	if (drag.kind === "move") {
		return {
			x: Math.min(Math.max(from.x + dx, 0), width - from.w),
			y: Math.min(Math.max(from.y + dy, 0), height - from.h),
			w: from.w,
			h: from.h,
		};
	}
	let [x0, y0, x1, y1] = [from.x, from.y, from.x + from.w, from.y + from.h];
	if (drag.handle.includes("w")) x0 += dx;
	if (drag.handle.includes("e")) x1 += dx;
	if (drag.handle.includes("n")) y0 += dy;
	if (drag.handle.includes("s")) y1 += dy;
	const rect = clampRect({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }, width, height);
	return { ...rect, w: Math.max(rect.w, 1), h: Math.max(rect.h, 1) };
}

type Props = {
	page: Page;
	index: number;
	/** Where the page sits in the workspace, in CSS pixels. */
	left: number;
	top: number;
	/** CSS pixels per point. */
	scale: number;
	/** Device pixels per point for the page image, or null to leave it unrendered (far from the screen). */
	renderScale: number | null;
	priority: number;
	/** False on the preview of a saved file: nothing can be drawn there. */
	editable: boolean;
	/** Places "Szukaj i zamaż" found on this page and has not redacted yet; `current` is the one shown now. */
	hits: readonly { rects: Rect[]; current: boolean }[];
	onShown?: () => void;
	/** A redaction was drawn by hand (snapped), with this rectangle in page coordinates. */
	onDrawn?: (index: number, rect: Rect) => void;
};

/**
 * One page of the workspace: its image, search highlights, its redactions, and the mouse on it. Dragging on
 * the page draws a new redaction, snapped to the words it cuts into; dragging a redaction moves it, its
 * handles resize it.
 */
export const PageSheet = memo(function PageSheet({ page, index, left, top, scale, renderScale, priority, editable, hits, onShown, onDrawn }: Props) {
	const text = useTextStore((s) => s.pages[textKey(page.sourceId, page.sourcePageIndex)]);
	// Only the page holding the selection re-renders when it changes.
	const selected = useDocStore((s) => (page.redactions.some((r) => r.id === s.selected) ? s.selected : null));
	const addRedaction = useDocStore((s) => s.addRedaction);
	const moveRedaction = useDocStore((s) => s.moveRedaction);
	const removeRedaction = useDocStore((s) => s.removeRedaction);
	const select = useDocStore((s) => s.select);
	const [drag, setDrag] = useState<Drag | null>(null);
	/** A finger down and not yet anything else: a tap, scrolling, or (held still) the start of drawing. */
	const press = useRef<{ start: Point; redaction: string | undefined; timer: number } | null>(null);
	const size = viewSize(page, scale);

	const pointer = (e: PointerEvent<HTMLElement>): Point => {
		const box = e.currentTarget.getBoundingClientRect();
		return { x: e.clientX - box.left, y: e.clientY - box.top };
	};

	const endPress = () => {
		if (press.current) clearTimeout(press.current.timer);
		press.current = null;
	};

	/** A tap on the page: the redaction under the finger is selected; else the selection is let go; else the word under the finger is redacted. */
	const onTap = (at: Point, redaction: string | undefined) => {
		if (redaction) return select(redaction);
		if (useDocStore.getState().selected) return select(null);
		if (!text) return;
		const spot = (reach: number) => viewRectToPage(clampRect({ x: at.x - reach, y: at.y - 3, w: 2 * reach, h: 6 }, size.w, size.h), page, scale);
		const hit = [1, 8].map(spot).find((rect) => textUnder(text, rect));
		if (!hit) return;
		const snapped = snapToWords(text, hit);
		addRedaction(page.id, snapped, "manual");
		select(null); // so that the next tap redacts the next word; handles over the text would only get in the way
		onDrawn?.(index, snapped);
	};

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		const target = e.target as HTMLElement;
		if (!editable || e.button !== 0 || target.closest("button")) return;
		if (e.pointerType === "touch") {
			if (!e.isPrimary) {
				// A second finger: zooming (DocumentScreen), and whatever the first was doing is off.
				endPress();
				touch.drawing = false;
				return setDrag(null);
			}
			const id = target.closest<HTMLElement>("[data-redaction-id]")?.dataset.redactionId;
			if (id !== selected) {
				const element = e.currentTarget;
				const { pointerId } = e;
				const start = pointer(e);
				const timer = window.setTimeout(() => {
					press.current = null;
					touch.drawing = true;
					element.setPointerCapture(pointerId);
					navigator.vibrate?.(10);
					setDrag({ kind: "draw", start, now: start });
				}, HOLD);
				press.current = { start, redaction: id, timer };
				return;
			}
			// The redaction selected: the finger moves and resizes it, as the mouse does (it has no scrolling to give way to: styles.css).
		}
		e.preventDefault(); // no text selection, no dragging the page image away
		e.currentTarget.setPointerCapture(e.pointerId);
		const start = pointer(e);
		const id = target.closest<HTMLElement>("[data-redaction-id]")?.dataset.redactionId;
		const redaction = page.redactions.find((r) => r.id === id);
		if (!redaction) return setDrag({ kind: "draw", start, now: start });
		select(redaction.id);
		const from = pageRectToView(redaction.rect, page, scale);
		const handle = target.dataset.handle as Handle | undefined;
		setDrag(handle ? { kind: "resize", id: redaction.id, handle, from, start, now: start } : { kind: "move", id: redaction.id, from, start, now: start });
	};

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (press.current) {
			const at = pointer(e);
			if (Math.hypot(at.x - press.current.start.x, at.y - press.current.start.y) > HOLD_SLOP) endPress();
		}
		if (drag) setDrag({ ...drag, now: pointer(e) });
	};

	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		touch.drawing = false;
		if (press.current) {
			const { start, redaction } = press.current;
			endPress();
			onTap(start, redaction);
			return;
		}
		if (!drag) return;
		setDrag(null);
		const rect = dragRect(drag, size.w, size.h);
		if (drag.kind === "draw") {
			if (rect.w < MIN_DRAW || rect.h < MIN_DRAW) select(null);
			else {
				const drawn = viewRectToPage(rect, page, scale);
				const snapped = text ? snapToWords(text, drawn) : drawn;
				addRedaction(page.id, snapped, "manual");
				if (e.pointerType === "touch") select(null); // as after a tap
				onDrawn?.(index, snapped);
			}
		} else if (drag.now.x !== drag.start.x || drag.now.y !== drag.start.y) {
			moveRedaction(drag.id, viewRectToPage(rect, page, scale));
		}
	};

	const selectedBox = selected && drag?.kind !== "resize" && drag?.kind !== "move"
		? outward(pageRectToView(page.redactions.find((r) => r.id === selected)!.rect, page, scale))
		: null;

	return (
		<div
			className={editable ? "page is-editable" : "page"}
			data-page-index={index}
			style={{ left, top, width: size.w, height: size.h }}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				// The browser took the finger for scrolling.
				endPress();
				touch.drawing = false;
				setDrag(null);
			}}
			onContextMenu={(e) => {
				// A held finger is drawing: no menu of the browser's over it.
				if (editable && (press.current || touch.drawing)) e.preventDefault();
			}}
		>
			{renderScale !== null && (
				<PageImage
					sourceId={page.sourceId}
					pageIndex={page.sourcePageIndex}
					geometry={page}
					viewScale={scale}
					scale={renderScale}
					priority={priority}
					onShown={onShown}
				/>
			)}

			{hits.flatMap((hit, n) =>
				hit.rects.map((rect, line) => {
					const box = pageRectToView(rect, page, scale);
					return (
						<div
							key={`${n}-${line}`}
							className={hit.current ? "hit is-current" : "hit"}
							data-hit={hit.current ? "current" : ""}
							style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
						/>
					);
				}),
			)}

			{page.redactions.map((redaction, n) => {
				const dragged = drag && drag.kind !== "draw" && drag.id === redaction.id;
				const box = outward(dragged ? dragRect(drag, size.w, size.h) : pageRectToView(redaction.rect, page, scale));
				const isSelected = redaction.id === selected;
				return (
					<div
						key={redaction.id}
						className={["redaction-box", isSelected && "is-selected", dragged && "is-dragging"].filter(Boolean).join(" ")}
						data-redaction-id={redaction.id}
						data-rect={JSON.stringify(redaction.rect)} // page coordinates, read by the tests
						style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
						tabIndex={0}
						role="img"
						aria-label={t.document.redaction(n + 1, index + 1)}
						// From the keyboard: the browser also focuses what a finger has just tapped, which must not select it.
						onFocus={(e) => e.currentTarget.matches(":focus-visible") && select(redaction.id)}
					>
						{isSelected && !dragged && HANDLES.map((handle) => <span key={handle} className={`handle handle-${handle}`} data-handle={handle} />)}
					</div>
				);
			})}

			{drag?.kind === "draw" && (() => {
				const box = outward(dragRect(drag, size.w, size.h));
				return <div className="redaction-box is-dragging" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />;
			})()}

			{selectedBox && (
				<button
					type="button"
					className="redaction-remove"
					style={{ left: selectedBox.x, top: selectedBox.y + selectedBox.h + 10 }}
					onClick={() => removeRedaction(selected!)}
				>
					{t.document.remove}
				</button>
			)}
		</div>
	);
});
