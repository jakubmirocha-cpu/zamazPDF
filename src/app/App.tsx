import { useEffect, useState, useSyncExternalStore } from "react";
import type { OpenResult, PageSize } from "../shared/engine-protocol";
import { newId, type Doc, type Page, type PdfSource } from "../shared/model";
import { DocumentScreen } from "./DocumentScreen";
import { call, engineState } from "./engine";
import { t } from "./i18n";
import { metrics } from "./metrics";
import type { Saved } from "./SaveDialog";
import { StartScreen, type Notice, type Opening } from "./StartScreen";
import { hasUnsavedChanges, useDocStore } from "./store";
import { useTextStore } from "./text-store";
import { useWindowFileDrop } from "./use-file-drop";

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** The model's pages for a newly opened source, in its own order. */
const pagesOf = (source: PdfSource, sizes: PageSize[]): Page[] =>
	sizes.map((size, i) => ({ id: newId("page"), sourceId: source.id, sourcePageIndex: i, ...size, rotation: 0, redactions: [] }));

/** Closing or reloading the tab asks first while there are changes not saved yet. */
function useLeaveWarning() {
	const unsaved = useDocStore(hasUnsavedChanges);
	useEffect(() => {
		if (!unsaved) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [unsaved]);
}

export function App() {
	const engine = useSyncExternalStore(engineState.subscribe, engineState.get);
	const doc = useDocStore((s) => s.doc);
	const setDoc = useDocStore((s) => s.setDoc);
	const [opening, setOpening] = useState<Opening>({ step: "idle", notice: null });
	const [preview, setPreview] = useState<{ doc: Doc; name: string; saved: Saved } | null>(null);
	/** The open document is signed electronically and the notice about it has not been dismissed yet. */
	const [signed, setSigned] = useState(false);
	useLeaveWarning();

	const fail = (notice: Notice) => setOpening({ step: "idle", notice });

	const finish = (source: PdfSource, result: OpenResult) => {
		if (result.status !== "opened") {
			setOpening({ step: "password", name: source.name, wrong: result.status === "wrong-password", source });
			return;
		}
		setDoc({ sources: [source], pages: pagesOf(source, result.pages) });
		setSigned(result.signed);
		setOpening({ step: "idle", notice: null });
	};

	const openFile = async (file: File) => {
		if (opening.step === "reading") return;
		// Chosen or dropped further down the page: what happens next shows in the drop field at the top.
		window.scrollTo({ top: 0 });
		if (opening.step === "password") void call("close", opening.source.id);
		if (!isPdf(file)) return fail({ kind: "error", text: t.start.notPdf(file.name) });

		metrics.openStarted();
		setOpening({ step: "reading", name: file.name });
		const source: PdfSource = { id: newId("source"), kind: "pdf", name: file.name, bytes: new Uint8Array() };
		try {
			source.bytes = new Uint8Array(await file.arrayBuffer());
			finish(source, await call("open", source.id, source.bytes));
		} catch {
			void call("close", source.id);
			fail({ kind: "error", text: t.open.failed(file.name) });
		}
	};

	const unlock = async (password: string) => {
		if (opening.step !== "password") return;
		const source = { ...opening.source, password };
		try {
			finish(source, await call("unlock", source.id, password));
		} catch {
			fail({ kind: "error", text: t.open.failed(source.name) });
		}
	};

	const cancel = () => {
		if (opening.step === "password") void call("close", opening.source.id);
		setOpening({ step: "idle", notice: null });
	};

	/** After saving, the saved file itself is opened and shown, next to the document still open. */
	const showSaved = async (saved: Saved, name: string) => {
		const source: PdfSource = { id: newId("saved"), kind: "pdf", name, bytes: saved.bytes };
		try {
			const result = await call("open", source.id, saved.bytes);
			if (result.status === "opened") setPreview({ name, saved, doc: { sources: [source], pages: pagesOf(source, result.pages) } });
		} catch {
			// The file is saved and downloaded all the same; there is just no preview.
		}
	};

	const leavePreview = () => {
		for (const source of preview?.doc.sources ?? []) void call("close", source.id);
		setPreview(null);
	};

	const close = () => {
		leavePreview();
		for (const source of doc?.sources ?? []) void call("close", source.id);
		setDoc(null);
		setSigned(false);
		useTextStore.getState().clear(); // the document's text stays nowhere once it is closed
	};

	const dragActive = useWindowFileDrop(doc ? null : openFile);

	if (preview) {
		return (
			<DocumentScreen
				key={preview.doc.sources[0]!.id}
				doc={preview.doc}
				preview={{ name: preview.name, ...preview.saved, onBack: leavePreview }}
				onClose={close}
			/>
		);
	}
	if (doc) return <DocumentScreen doc={doc} signed={signed} onSignedSeen={() => setSigned(false)} onSaved={showSaved} onClose={close} />;
	return (
		<StartScreen
			opening={opening}
			dragActive={dragActive}
			engineStarting={engine.status === "starting"}
			engineFailed={engine.status === "failed"}
			onFile={openFile}
			onUnlock={unlock}
			onCancel={cancel}
		/>
	);
}
