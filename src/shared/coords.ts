// The one place where page coordinates (points) and view coordinates (pixels inside the page's
// box on screen, or in a rendered page image) meet. Everything else converts through these functions.
import type { Page, Rect } from "./model";

export type Point = { x: number; y: number };

/** All a conversion needs to know about a page. */
export type PageGeometry = Pick<Page, "width" | "height" | "rotation">;

/** The page as shown, in view pixels: the user's rotation swaps width and height. */
export function viewSize(page: PageGeometry, scale: number) {
	const turned = page.rotation === 90 || page.rotation === 270;
	return { w: (turned ? page.height : page.width) * scale, h: (turned ? page.width : page.height) * scale };
}

/** `scale`: view pixels per point. The user's rotation turns the page clockwise. */
export function pagePointToView(p: Point, page: PageGeometry, scale: number): Point {
	const { width: w, height: h } = page;
	switch (page.rotation) {
		case 0:
			return { x: p.x * scale, y: p.y * scale };
		case 90:
			return { x: (h - p.y) * scale, y: p.x * scale };
		case 180:
			return { x: (w - p.x) * scale, y: (h - p.y) * scale };
		case 270:
			return { x: p.y * scale, y: (w - p.x) * scale };
	}
}

export function viewPointToPage(v: Point, page: PageGeometry, scale: number): Point {
	const { width: w, height: h } = page;
	const x = v.x / scale;
	const y = v.y / scale;
	switch (page.rotation) {
		case 0:
			return { x, y };
		case 90:
			return { x: y, y: h - x };
		case 180:
			return { x: w - x, y: h - y };
		case 270:
			return { x: w - y, y: x };
	}
}

/**
 * A CSS transform (origin at the top left) that lays an image of the page as the source draws it, `scale`
 * pixels per point, onto the view: the user's rotation without rendering the page again. The same mapping as
 * pagePointToView.
 */
export function imageTransform(page: PageGeometry, scale: number): string {
	const w = page.width * scale;
	const h = page.height * scale;
	switch (page.rotation) {
		case 0:
			return "none";
		case 90:
			return `matrix(0, 1, -1, 0, ${h}, 0)`;
		case 180:
			return `matrix(-1, 0, 0, -1, ${w}, ${h})`;
		case 270:
			return `matrix(0, -1, 1, 0, 0, ${w})`;
	}
}

const between = (a: Point, b: Point): Rect => ({
	x: Math.min(a.x, b.x),
	y: Math.min(a.y, b.y),
	w: Math.abs(a.x - b.x),
	h: Math.abs(a.y - b.y),
});

export const pageRectToView = (r: Rect, page: PageGeometry, scale: number): Rect =>
	between(pagePointToView({ x: r.x, y: r.y }, page, scale), pagePointToView({ x: r.x + r.w, y: r.y + r.h }, page, scale));

export const viewRectToPage = (r: Rect, page: PageGeometry, scale: number): Rect =>
	between(viewPointToPage({ x: r.x, y: r.y }, page, scale), viewPointToPage({ x: r.x + r.w, y: r.y + r.h }, page, scale));

/** Whole pixels covering all of `r`: a pixel the rectangle touches at all is inside. */
export function outward(r: Rect): Rect {
	const x = Math.floor(r.x);
	const y = Math.floor(r.y);
	return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

/** `r` cut to the area 0…width × 0…height. */
export function clampRect(r: Rect, width: number, height: number): Rect {
	const x0 = Math.min(Math.max(r.x, 0), width);
	const y0 = Math.min(Math.max(r.y, 0), height);
	const x1 = Math.min(Math.max(r.x + r.w, 0), width);
	const y1 = Math.min(Math.max(r.y + r.h, 0), height);
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
