import { useEffect, useRef } from "react";
import { t } from "./i18n";

type Props = { onStay: () => void; onLeave: () => void };

/**
 * "Zamknij plik" with redactions not saved yet: they would be lost, so it asks first, as the
 * browser does when the tab is closed. Going back is the highlighted answer, and what Esc and a click beside
 * the dialog do.
 */
export function CloseDialog({ onStay, onLeave }: Props) {
	const stay = useRef<HTMLButtonElement>(null);
	useEffect(() => stay.current?.focus(), []);

	return (
		<div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onStay()}>
			<div
				className="dialog"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="close-title"
				aria-describedby="close-text"
				onKeyDown={(e) => e.key === "Escape" && onStay()}
			>
				<h2 id="close-title" className="dialog-title">
					{t.document.closeTitle}
				</h2>
				<p id="close-text" className="dialog-text">
					{t.document.closeText}
				</p>
				<div className="actions">
					<button ref={stay} type="button" className="button" onClick={onStay}>
						{t.document.closeStay}
					</button>
					<button type="button" className="button-quiet" onClick={onLeave}>
						{t.document.closeLeave}
					</button>
				</div>
			</div>
		</div>
	);
}
