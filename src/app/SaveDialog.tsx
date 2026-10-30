import { useEffect, useRef, useState } from "react";
import type { SaveJob, SaveProgress } from "../shared/engine-protocol";
import type { Doc } from "../shared/model";
import { callWithProgress } from "./engine";
import { savedFileName } from "./file-name";
import { t } from "./i18n";
import { useDocStore } from "./store";

/**
 * A file that passed the autotest, saved with "Zachowaj tekst" or not. `imagePages`: see SaveResult. `redacted`:
 * it has redactions (else only pages turned or removed); `removedPages`: how many pages it left out;
 * `hiddenPages`: saved as images, for text no one could see on them.
 */
export type Saved = { bytes: Uint8Array; keptText: boolean; imagePages: number[]; hiddenPages: number[]; redacted: boolean; removedPages: number };

export type SaveState =
	| { step: "idle" }
	| ({ step: "saving" } & SaveProgress)
	| { step: "name"; saved: Saved; name: string; removed: string[] }
	/** `pages`: where the autotest found something under a redaction; empty when saving failed otherwise. */
	| { step: "failed"; pages: number[] };

/** What the worker needs from the model to build the file (saving only reads the model). */
const jobOf = (doc: Doc, keepText: boolean): SaveJob => ({
	sources: doc.sources.map((s) => ({ id: s.id, bytes: s.bytes, password: s.password })),
	pages: doc.pages.map((p) => ({
		sourceId: p.sourceId,
		sourcePageIndex: p.sourcePageIndex,
		rotation: p.rotation,
		redactions: p.redactions.map((r) => r.rect),
	})),
	keepText,
});

/** Hands the file to the browser as a download: nothing leaves the computer. */
function download(bytes: Uint8Array, name: string) {
	const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Whether this browser can hand a PDF to the system's share sheet. An empty file: only the type and name are looked at. */
export const canShareFile = (name: string) => navigator.canShare?.({ files: [new File([], name, { type: "application/pdf" })] }) ?? false;

/**
 * "Udostępnij": hands the saved file to the app the user picks in the system's window; this
 * app connects to nothing. False when that failed; a window closed without picking anything is not a failure.
 */
export async function shareFile(bytes: Uint8Array, name: string): Promise<boolean> {
	try {
		await navigator.share({ files: [new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/pdf" })] });
		return true;
	} catch (e) {
		return e instanceof DOMException && e.name === "AbortError";
	}
}

/**
 * "Zapisz bezpieczną kopię": the worker builds the file and runs the autotest; only a file that
 * passed it is downloaded, and then `onSaved` shows it.
 */
export function useSave(doc: Doc, onSaved: (saved: Saved, name: string) => void) {
	const [state, setState] = useState<SaveState>({ step: "idle" });
	const keepText = useDocStore((s) => s.keepText);
	const markSaved = useDocStore((s) => s.markSaved);

	const finish = (saved: Saved, name: string) => {
		const fileName = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
		download(saved.bytes, fileName);
		markSaved(doc); // the document cannot change while saving: the dialog covers it
		setState({ step: "idle" });
		onSaved(saved, fileName);
	};

	const start = async () => {
		setState({ step: "saving", phase: "building", done: 0, total: doc.pages.length });
		try {
			const result = await callWithProgress("save", [jobOf(doc, keepText)], (p) => setState({ step: "saving", ...(p as SaveProgress) }));
			if (result.status === "failed") return setState({ step: "failed", pages: result.pages });
			const opened = useDocStore.getState().opened ?? doc;
			const saved: Saved = {
				bytes: result.bytes,
				keptText: keepText,
				imagePages: result.imagePages,
				hiddenPages: result.hiddenPages,
				redacted: doc.pages.some((p) => p.redactions.length > 0),
				removedPages: opened.pages.length - doc.pages.length,
			};
			const proposal = savedFileName(doc.sources[0]?.name ?? "dokument.pdf", result.hiddenWords);
			if (proposal.removed.length > 0) setState({ step: "name", saved, ...proposal });
			else finish(saved, proposal.name);
		} catch {
			setState({ step: "failed", pages: [] });
		}
	};

	return { state, start, finish, close: () => setState({ step: "idle" }) };
}

type Props = {
	state: Exclude<SaveState, { step: "idle" }>;
	onDownload: (saved: Saved, name: string) => void;
	onClose: () => void;
};

/** Over the workspace while saving: progress, the name check or why nothing was saved. */
export function SaveDialog({ state, onDownload, onClose }: Props) {
	const first = useRef<HTMLElement>(null);
	const [name, setName] = useState(state.step === "name" ? state.name : "");
	useEffect(() => {
		// Not a text field under a finger: the keyboard would come up over the dialog for a name that is usually fine.
		if (first.current?.tagName === "INPUT" && window.matchMedia("(pointer: coarse)").matches) return;
		first.current?.focus();
	}, [state.step]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape" && state.step !== "saving") onClose();
	};

	return (
		<div className="overlay">
			<div className="dialog" role="dialog" aria-modal="true" aria-labelledby="save-title" onKeyDown={onKeyDown}>
				{state.step === "saving" && (
					<>
						<h2 id="save-title" className="dialog-title">
							{state.phase === "building" ? t.save.saving : t.save.checking}
						</h2>
						<div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.done}>
							<div className="progress-done" style={{ width: state.phase === "checking" ? "100%" : `${(100 * state.done) / Math.max(state.total, 1)}%` }} />
						</div>
						<p className="dialog-text">{state.phase === "building" ? t.save.progress(state.done, state.total) : t.save.checkingText}</p>
					</>
				)}

				{state.step === "name" && (
					<>
						<h2 id="save-title" className="dialog-title">
							{t.save.nameTitle}
						</h2>
						<p className="dialog-text">{t.save.nameText(state.removed)}</p>
						<label className="field">
							<span className="field-label">{t.save.nameLabel}</span>
							<input
								ref={first as React.RefObject<HTMLInputElement>}
								className="field-input"
								value={name}
								autoComplete="off"
								autoCorrect="off"
								autoCapitalize="off"
								spellCheck={false}
								onChange={(e) => setName(e.currentTarget.value)}
								onKeyDown={(e) => e.key === "Enter" && name.trim() && onDownload(state.saved, name.trim())}
							/>
						</label>
						<div className="actions">
							<button type="button" className="button" disabled={!name.trim()} onClick={() => onDownload(state.saved, name.trim())}>
								{t.save.download}
							</button>
							<button type="button" className="button-quiet" onClick={onClose}>
								{t.save.cancel}
							</button>
						</div>
					</>
				)}

				{state.step === "failed" && (
					<>
						<h2 id="save-title" className="dialog-title">
							{t.save.failedTitle}
						</h2>
						<p className="dialog-text">{state.pages.length > 0 ? t.save.autotestFailed(state.pages) : t.save.failedText}</p>
						<div className="actions">
							<button ref={first as React.RefObject<HTMLButtonElement>} type="button" className="button" onClick={onClose}>
								{t.save.back}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
