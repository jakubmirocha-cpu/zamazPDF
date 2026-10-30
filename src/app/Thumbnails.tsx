import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { outward, pageRectToView, viewSize } from "../shared/coords";
import type { Doc, Page } from "../shared/model";
import { t } from "./i18n";
import { PageImage } from "./PageImage";
import { Priority } from "./render-queue";
import { useDocStore } from "./store";

/** CSS pixels; the width of the side column in styles.css follows it. */
const THUMB_WIDTH = 112;

type Props = {
	doc: Doc;
	current: number;
	dpr: number;
	/** False on the preview of a saved file: its pages cannot be turned or removed. */
	editable: boolean;
	/** CSS pixels: a phone fits three in a row; the column has its own width. */
	width?: number;
	onSelect: (index: number) => void;
};

/** The column of page thumbnails, with removing a page at each. */
export function Thumbnails({ doc, current, dpr, editable, width = THUMB_WIDTH, onSelect }: Props) {
	const list = useRef<HTMLElement>(null);

	useEffect(() => {
		list.current?.querySelector(`[data-thumb-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
	}, [current]);

	return (
		<nav className="thumbs" ref={list} aria-label={t.document.pages}>
			{doc.pages.map((page, i) => (
				<Thumbnail
					key={page.id}
					page={page}
					index={i}
					only={doc.pages.length === 1}
					current={i === current}
					dpr={dpr}
					editable={editable}
					width={width}
					root={list}
					onSelect={onSelect}
				/>
			))}
		</nav>
	);
}

type ThumbnailProps = {
	page: Page;
	index: number;
	/** The document's only page, which cannot be removed. */
	only: boolean;
	current: boolean;
	dpr: number;
	editable: boolean;
	width: number;
	root: RefObject<HTMLElement | null>;
	onSelect: (index: number) => void;
};

/**
 * A page in small, turned as the user turned it. Beside its number, on the current page and the one under
 * the mouse, the button that removes it — never over the page itself, so that a click on the page
 * only ever shows it. Only the current page's button is in the Tab order, so a long document is not one more
 * stop per page. Turning is in the bar, beside "Strona X z N".
 */
const Thumbnail = memo(function Thumbnail({ page, index, only, current, dpr, editable, width, root, onSelect }: ThumbnailProps) {
	const button = useRef<HTMLButtonElement>(null);
	const [near, setNear] = useState(false);
	const removePage = useDocStore((s) => s.removePage);
	const scale = width / viewSize(page, 1).w; // CSS pixels per point
	const paper = viewSize(page, scale);

	useEffect(() => {
		const observer = new IntersectionObserver(([entry]) => setNear(entry!.isIntersecting), {
			root: root.current,
			rootMargin: "400px 0px",
		});
		observer.observe(button.current!);
		return () => observer.disconnect();
	}, [root]);

	return (
		<div className={current ? "thumb-item is-current" : "thumb-item"}>
			<button
				ref={button}
				type="button"
				className={current ? "thumb is-current" : "thumb"}
				data-thumb-index={index}
				aria-current={current ? "page" : undefined}
				aria-label={t.document.page(index + 1)}
				onClick={() => onSelect(index)}
			>
				<span className="thumb-paper" style={{ width: paper.w, height: paper.h }}>
					{near && (
						<PageImage
							sourceId={page.sourceId}
							pageIndex={page.sourcePageIndex}
							geometry={page}
							viewScale={scale}
							scale={scale * dpr}
							priority={Priority.thumbnail}
						/>
					)}
					{page.redactions.map((redaction) => {
						const box = outward(pageRectToView(redaction.rect, page, scale));
						return (
							<span key={redaction.id} className="thumb-redaction" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
						);
					})}
				</span>
				<span className="thumb-number">{index + 1}</span>
			</button>
			{editable && (
				<button
					type="button"
					className="thumb-remove"
					tabIndex={current ? undefined : -1}
					disabled={only}
					title={only ? t.document.onlyPage : t.document.removePage}
					aria-label={t.document.removePageNumber(index + 1)}
					onClick={() => removePage(page.id)}
				>
					<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5" />
					</svg>
				</button>
			)}
		</div>
	);
});
