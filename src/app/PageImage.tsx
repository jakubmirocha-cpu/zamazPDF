import { useEffect, useRef, useState } from "react";
import { imageTransform, type PageGeometry } from "../shared/coords";
import { t } from "./i18n";
import { usePageRender } from "./render-queue";

type Props = {
	sourceId: string;
	pageIndex: number;
	/** The page's size and the user's rotation, and its CSS pixels per point: where the image goes on screen. */
	geometry: PageGeometry;
	viewScale: number;
	/** Device pixels per point. */
	scale: number;
	priority: number;
	onShown?: () => void;
};

/**
 * A rendered page filling its box. The page is rendered as the source draws it and turned on screen
 *, so turning it needs no new render. Until a sharper render arrives after zooming, the previous one
 * stays on the canvas, stretched.
 */
export function PageImage({ sourceId, pageIndex, geometry, viewScale, scale, priority, onShown }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [failed, setFailed] = useState(false);

	// Safari frees a canvas long after it leaves the page, and past its limit for all canvases new ones stay blank.
	useEffect(() => {
		const element = canvas.current;
		return () => {
			if (!element) return;
			element.width = 0;
			element.height = 0;
		};
	}, []);

	usePageRender(sourceId, pageIndex, scale, priority, (result) => {
		const element = canvas.current;
		if (result instanceof Error) return setFailed(true);
		if (!element) return result.close();
		element.width = result.width;
		element.height = result.height;
		element.getContext("bitmaprenderer")!.transferFromImageBitmap(result);
		element.dataset.rendered = String(element.width); // read by the tests
		onShown?.();
	});

	if (failed) return <p className="page-failed">{t.document.pageFailed}</p>;
	return (
		<canvas
			ref={canvas}
			className="page-canvas"
			style={{
				width: geometry.width * viewScale,
				height: geometry.height * viewScale,
				transform: imageTransform(geometry, viewScale),
			}}
		/>
	);
}
