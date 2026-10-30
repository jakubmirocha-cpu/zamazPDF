import { useEffect, useEffectEvent, useState } from "react";

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

/**
 * Files dragged anywhere over the window, not only over the drop field: a big target is easier to hit.
 * Every file drop is cancelled, so the browser never leaves the app to show the PDF itself; with
 * `onFile` null (a document is open) the drop is simply ignored. Returns whether a file is being dragged in.
 */
export function useWindowFileDrop(onFile: ((file: File) => void) | null) {
	const [active, setActive] = useState(false);
	const accepting = onFile !== null;
	const handleFile = useEffectEvent((file: File) => onFile?.(file));

	useEffect(() => {
		let depth = 0; // dragenter/dragleave also fire when moving between child elements
		const enter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth++;
			setActive(accepting);
		};
		const leave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) setActive(false);
		};
		const over = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = accepting ? "copy" : "none";
		};
		const drop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			depth = 0;
			setActive(false);
			const file = e.dataTransfer?.files[0];
			if (file && accepting) handleFile(file);
		};
		window.addEventListener("dragenter", enter);
		window.addEventListener("dragleave", leave);
		window.addEventListener("dragover", over);
		window.addEventListener("drop", drop);
		return () => {
			window.removeEventListener("dragenter", enter);
			window.removeEventListener("dragleave", leave);
			window.removeEventListener("dragover", over);
			window.removeEventListener("drop", drop);
		};
	}, [accepting]);

	return active;
}
