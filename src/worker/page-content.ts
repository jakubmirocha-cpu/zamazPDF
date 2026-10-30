// What a page is made of, as far as saving and searching need to know: is it a scan, does it hold a photo,
// is there invisible text on it (a scanner's OCR layer)?
import * as mupdf from "mupdf";

const PT_PER_INCH = 72;

export type PageContent = {
	/** Resolution of an image covering nearly the whole page (a scan); 0 when there is none. */
	scanDpi: number;
	/** An image over more than a twentieth of the page: a photo or a scan. */
	picture: boolean;
	/** Text drawn invisibly (render mode 3), as OCR software leaves over a scan. */
	invisibleText: boolean;
};

export function pageContent(page: mupdf.Page): PageContent {
	const [x0, y0, x1, y1] = page.getBounds();
	const area = (x1 - x0) * (y1 - y0);
	const content: PageContent = { scanDpi: 0, picture: false, invisibleText: false };
	const device = new mupdf.Device({
		fillImage(image, ctm) {
			const w = Math.hypot(ctm[0], ctm[1]);
			const h = Math.hypot(ctm[2], ctm[3]);
			if (w * h > 0.05 * area) content.picture = true;
			if (w * h > 0.9 * area) {
				content.scanDpi = Math.max(content.scanDpi, image.getWidth() / (w / PT_PER_INCH), image.getHeight() / (h / PT_PER_INCH));
			}
		},
		ignoreText() {
			content.invisibleText = true;
		},
	});
	try {
		page.run(device, mupdf.Matrix.identity);
		device.close();
	} finally {
		device.destroy();
	}
	return content;
}
