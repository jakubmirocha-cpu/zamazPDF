import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Doc } from "../shared/model";
import { t } from "./i18n";
import { LockIcon } from "./LockIcon";
import { SaveOptions } from "./SaveOptions";
import { useDocStore } from "./store";

/** A phone, upright or on its side: the page takes the whole screen, and everything else opens when asked for. */
const narrow = window.matchMedia("(max-width: 759px), (max-height: 500px)");

export const useNarrow = () =>
	useSyncExternalStore(
		(changed) => {
			narrow.addEventListener("change", changed);
			return () => narrow.removeEventListener("change", changed);
		},
		() => narrow.matches,
	);

export function RotateLeftIcon() {
	return (
		<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 20a7 7 0 1 0-7-7" />
			<path d="M2 10.5l3 3 3-3" />
		</svg>
	);
}

export function RotateRightIcon() {
	return (
		<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 20a7 7 0 1 1 7-7" />
			<path d="M16 10.5l3 3 3-3" />
		</svg>
	);
}

export function CloseIcon() {
	return (
		<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M6 6l12 12M18 6L6 18" />
		</svg>
	);
}

type BarProps = {
	/** Out of the way while the document is scrolled down. */
	hidden: boolean;
	/** On the preview of a saved file: nothing to undo, search or save, only the way back. */
	onBack?: () => void;
	canUndo: boolean;
	changed: boolean;
	page: number;
	pages: number;
	onMenu: () => void;
	onUndo: () => void;
	onPages: () => void;
	onSearch: () => void;
	onSave: () => void;
};

/** The one bar of the document screen on a phone: at the bottom, under the thumb, with only what is used all the time. */
export function PhoneBar({ hidden, onBack, canUndo, changed, page, pages, onMenu, onUndo, onPages, onSearch, onSave }: BarProps) {
	return (
		<nav className={hidden ? "phone-bar is-hidden" : "phone-bar"} aria-label={t.document.tools}>
			<button type="button" className="phone-tool phone-menu-button" aria-label={t.document.menu} onClick={onMenu}>
				<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M4 7h16M4 12h16M4 17h16" />
				</svg>
			</button>
			{!onBack && (
				<button type="button" className="phone-tool" aria-label={t.document.undo} disabled={!canUndo} onClick={onUndo}>
					<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 5 5v1" />
					</svg>
				</button>
			)}
			<button type="button" className="phone-tool phone-pages-button" aria-label={t.document.pageOf(page, pages)} onClick={onPages}>
				{t.document.pageShort(page, pages)}
			</button>
			{!onBack && (
				<button type="button" className="phone-tool phone-search-button" aria-label={t.search.label} onClick={onSearch}>
					<svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="10.5" cy="10.5" r="6" />
						<path d="M15 15l5 5" />
					</svg>
				</button>
			)}
			{onBack ? (
				<button type="button" className="button phone-save" onClick={onBack}>
					{t.preview.back}
				</button>
			) : (
				<button type="button" className="button phone-save" aria-label={t.save.button} title={changed ? undefined : t.save.nothingYet} disabled={!changed} onClick={onSave}>
					{t.save.short}
				</button>
			)}
		</nav>
	);
}

/** Over the bottom of the screen, with the document still in view above it; a press beside it closes it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
	const panel = useRef<HTMLElement>(null);
	useEffect(() => panel.current?.focus(), []);
	return (
		<div
			className="sheet-layer"
			onPointerDown={(e) => e.target === e.currentTarget && onClose()}
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				e.stopPropagation();
				onClose();
			}}
		>
			<section ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
				<header className="sheet-head">
					<h2 className="sheet-title">{title}</h2>
					<button type="button" className="phone-tool sheet-close" aria-label={t.document.closeSheet} onClick={onClose}>
						<CloseIcon />
					</button>
				</header>
				<div className="sheet-body">{children}</div>
			</section>
		</div>
	);
}

type MenuProps = {
	doc: Doc;
	current: number;
	/** False on the preview of a saved file. */
	editable: boolean;
	zoom: number;
	zoomIsFit: boolean;
	onZoomStep: (direction: 1 | -1) => void;
	onZoomFit: () => void;
	/** On the preview of a saved file, where the browser can pass a file on. */
	onShare?: () => void;
	onPersonal: () => void;
	onCloseFile: () => void;
};

/** Everything that has no place on the bar: the page shown (turning, removing), the view, saving's one choice, the file. */
export function PhoneMenu({ doc, current, editable, zoom, zoomIsFit, onZoomStep, onZoomFit, onShare, onPersonal, onCloseFile }: MenuProps) {
	const canRedo = useDocStore((s) => s.future.length > 0);
	const redo = useDocStore((s) => s.redo);
	const rotatePage = useDocStore((s) => s.rotatePage);
	const removePage = useDocStore((s) => s.removePage);
	const page = doc.pages[current]!;
	return (
		<div className="phone-menu">
			{onShare && (
				<button type="button" className="menu-row" onClick={onShare}>
					{t.preview.share}
				</button>
			)}
			{editable && (
				<button type="button" className="menu-row" onClick={onPersonal}>
					{t.personal.button}
				</button>
			)}
			{editable && (
				<button type="button" className="menu-row" disabled={!canRedo} onClick={redo}>
					{t.document.redo}
				</button>
			)}
			{editable && (
				<div className="menu-group">
					<p className="menu-label">{t.document.page(current + 1)}</p>
					<div className="menu-tools">
						<button type="button" className="button-quiet icon-button" aria-label={t.document.rotateLeftPage(current + 1)} onClick={() => rotatePage(page.id, -1)}>
							<RotateLeftIcon />
						</button>
						<button type="button" className="button-quiet icon-button" aria-label={t.document.rotateRightPage(current + 1)} onClick={() => rotatePage(page.id, 1)}>
							<RotateRightIcon />
						</button>
						<button type="button" className="button-quiet" disabled={doc.pages.length === 1} title={doc.pages.length === 1 ? t.document.onlyPage : undefined} onClick={() => removePage(page.id)}>
							{t.document.removePage}
						</button>
					</div>
				</div>
			)}
			<div className="menu-group">
				<p className="menu-label">{t.document.zoom}</p>
				<div className="menu-tools">
					<button type="button" className="button-quiet zoom-step" aria-label={t.document.zoomOut} onClick={() => onZoomStep(-1)}>
						−
					</button>
					<output className="zoom-value">{Math.round(zoom * 100)}%</output>
					<button type="button" className="button-quiet zoom-step" aria-label={t.document.zoomIn} onClick={() => onZoomStep(1)}>
						+
					</button>
					<button type="button" className="button-quiet" aria-pressed={zoomIsFit} onClick={onZoomFit}>
						{t.document.zoomFit}
					</button>
				</div>
			</div>
			{editable && <SaveOptions label={t.save.modeTitle} />}
			<button type="button" className="menu-row" onClick={onCloseFile}>
				{t.document.close}
			</button>
			<p className="privacy menu-privacy">
				<LockIcon />
				{t.privacy}
			</p>
		</div>
	);
}
