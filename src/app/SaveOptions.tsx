import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { useDocStore } from "./store";

/**
 * "Więcej" by "Zapisz bezpieczną kopię": the one choice saving has, how pages with redactions
 * are saved. The label stays short, so the bar fits a 1280-pixel screen in one row; the preview
 * after saving says when the text was kept.
 */
export function SaveOptions({ label = t.save.more }: { label?: string }) {
	const keepText = useDocStore((s) => s.keepText);
	const setKeepText = useDocStore((s) => s.setKeepText);
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (!open) return;
		root.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
		const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
		window.addEventListener("pointerdown", outside);
		return () => window.removeEventListener("pointerdown", outside);
	}, [open]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key !== "Escape" || !open) return;
		e.stopPropagation(); // Esc here closes the panel, nothing else
		setOpen(false);
		button.current?.focus();
	};

	return (
		<div className="more" ref={root} onKeyDown={onKeyDown}>
			<button
				ref={button}
				type="button"
				className="button-quiet"
				aria-expanded={open}
				aria-controls="save-options"
				onClick={() => setOpen(!open)}
			>
				{label}
			</button>
			{open && (
				<div id="save-options" className="more-panel" role="radiogroup" aria-labelledby="save-options-title">
					<p id="save-options-title" className="more-title">
						{t.save.modeTitle}
					</p>
					<Choice checked={!keepText} title={t.save.modeImage} text={t.save.modeImageText} onChoose={() => setKeepText(false)} />
					<Choice checked={keepText} title={t.save.modeText} text={t.save.modeTextText} onChoose={() => setKeepText(true)} />
				</div>
			)}
		</div>
	);
}

function Choice({ checked, title, text, onChoose }: { checked: boolean; title: string; text: string; onChoose: () => void }) {
	return (
		<label className={checked ? "choice is-checked" : "choice"}>
			<input type="radio" name="save-mode" checked={checked} onChange={onChoose} />
			<span className="choice-body">
				<span className="choice-title">{title}</span>
				<span className="choice-text">{text}</span>
			</span>
		</label>
	);
}
