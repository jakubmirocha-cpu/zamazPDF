import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { Landing } from "./Landing";
import { LockIcon } from "./LockIcon";
import { ThemeButton } from "./ThemeButton";
import type { PdfSource } from "../shared/model";

export type Notice = { kind: "info" | "error"; text: string };

/** Where opening a file stands; the drop field shows it. */
export type Opening =
	| { step: "idle"; notice: Notice | null }
	| { step: "reading"; name: string }
	| { step: "password"; name: string; wrong: boolean; source: PdfSource };

type Props = {
	opening: Opening;
	dragActive: boolean;
	/** The engine is still loading (from a server, over a slow connection, that takes a while). */
	engineStarting: boolean;
	engineFailed: boolean;
	onFile: (file: File) => void;
	onUnlock: (password: string) => void;
	onCancel: () => void;
};

export function StartScreen({ opening, dragActive, engineStarting, engineFailed, onFile, onUnlock, onCancel }: Props) {
	const input = useRef<HTMLInputElement>(null);
	const slow = useLater(1000);
	const idle = opening.step === "idle";
	const notice: Notice | null = engineFailed ? { kind: "error", text: t.engineFailed } : idle ? opening.notice : null;

	return (
		<>
			<main className="start">
				<section className="start-intro">
					<div className="start-head">
						<h1 className="wordmark">
							<span className="wordmark-mark" aria-hidden="true" />
							{t.appName}
						</h1>
						<ThemeButton />
					</div>
					<div className="start-copy">
						<p className="statement">{t.start.statement}</p>
						<p className="promise">{t.start.promise}</p>
					</div>
					<p className="privacy">
						<LockIcon />
						{t.privacy}
					</p>
				</section>

				{/* While idle the whole field opens the file picker; the button is there for the keyboard and for clarity. */}
				<section
					className={["drop", dragActive && "is-active", idle && "is-idle"].filter(Boolean).join(" ")}
					onClick={idle ? () => input.current?.click() : undefined}
				>
					{opening.step === "password" ? (
						<PasswordForm key={opening.source.id} opening={opening} onUnlock={onUnlock} onCancel={onCancel} />
					) : (
						<div className="drop-content">
							<p className="drop-title">
								{dragActive ? t.start.dropActive : idle ? t.start.drop : t.open.reading}
							</p>
							{idle ? (
								<button type="button" className="button">
									{t.start.choose}
								</button>
							) : (
								<p className="drop-file">{opening.name}</p>
							)}
							{/* From disk or from the browser's cache the engine starts in a moment: this shows only when it takes
							    a while, or when a file is waiting for it. */}
							{engineStarting && (slow || !idle) && <Loading />}
							<p className={`drop-notice is-${notice?.kind ?? "info"}`} role="status">
								{notice?.text}
							</p>
						</div>
					)}
					{/* The password step needs the room; the field must not push the privacy line off screen. */}
					{opening.step !== "password" && <Specimen />}
				</section>

				<input
					ref={input}
					type="file"
					accept="application/pdf,.pdf"
					hidden
					onChange={(e) => {
						const file = e.currentTarget.files?.[0];
						e.currentTarget.value = ""; // choosing the same file again must still fire onChange
						if (file) onFile(file);
					}}
				/>

				<About />
			</main>
			{/* zamazpdf.pl: under the app, for anyone who scrolls, what it does. */}
			<Landing dragActive={dragActive} onChoose={() => input.current?.click()} />
		</>
	);
}

/**
 * The information pages and the code this version was built from, under the privacy line.
 * Each opens in a new tab, so nothing interrupts the work. After the drop field, so Tab reaches the main action first.
 */
function About() {
	const { name, commit, changed } = APP_VERSION;
	const source = commit ? `${SOURCE_URL}/tree/${commit}` : SOURCE_URL;
	return (
		<nav className="about" aria-label={t.start.about}>
			<a href="jak-to-dziala.html" target="_blank">
				{t.start.howItWorks}
			</a>
			<a href="polityka-prywatnosci.html" target="_blank">
				{t.start.privacyPolicy}
			</a>
			<a
				href={source}
				target="_blank"
				rel="noreferrer"
				title={changed ? t.start.sourceChangedHint : t.start.sourceHint(commit?.slice(0, 7))}
			>
				{t.start.source}, {t.start.version(name, changed)}
			</a>
		</nav>
	);
}

/** True once `ms` have passed since the first render. */
function useLater(ms: number) {
	const [passed, setPassed] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setPassed(true), ms);
		return () => clearTimeout(timer);
	}, [ms]);
	return passed;
}

/**
 * "Wczytywanie programu…" over a moving bar: the engine loading. A script gives no progress
 * as it arrives, so the bar only shows that something is happening.
 */
function Loading() {
	return (
		<div className="loading" role="progressbar" aria-label={t.start.loading}>
			<p>{t.start.loading}</p>
			<div className="progress">
				<div className="progress-done" />
			</div>
		</div>
	);
}

/** The password is typed here, stays in memory only and never goes into a <form>. */
function PasswordForm({
	opening,
	onUnlock,
	onCancel,
}: {
	opening: Extract<Opening, { step: "password" }>;
	onUnlock: (password: string) => void;
	onCancel: () => void;
}) {
	const [password, setPassword] = useState("");
	const [shown, setShown] = useState(false);
	const submit = () => password && onUnlock(password);

	return (
		<div className="drop-content">
			<p className="drop-title">{t.open.passwordTitle}</p>
			<p className="drop-text">{t.open.passwordHint(opening.name)}</p>
			<label className="field">
				<span className="field-label">{t.open.passwordLabel}</span>
				<input
					className="field-input"
					type={shown ? "text" : "password"}
					value={password}
					autoFocus
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					onChange={(e) => setPassword(e.currentTarget.value)}
					onKeyDown={(e) => e.key === "Enter" && submit()}
				/>
			</label>
			<label className="check">
				<input type="checkbox" checked={shown} onChange={(e) => setShown(e.currentTarget.checked)} />
				{t.open.showPassword}
			</label>
			<div className="actions">
				<button type="button" className="button" onClick={submit}>
					{t.open.unlock}
				</button>
				<button type="button" className="button-quiet" onClick={onCancel}>
					{t.open.cancel}
				</button>
			</div>
			<p className="drop-notice is-error" role="status">
				{opening.wrong ? t.open.passwordWrong : ""}
			</p>
		</div>
	);
}

/**
 * The top of a contract after Zamaż PDF, peeking up from the bottom of the drop field: what the app does,
 * shown instead of explained. Nothing sits under the black bars, here as in the saved files.
 */
function Specimen() {
	return (
		<figure className="specimen" data-ui="" role="img" aria-label={t.start.specimenLabel}>
			<p className="specimen-title">{t.start.specimenTitle}</p>
			<p>{t.start.specimenPlace}</p>
			<p>
				{t.start.specimenTenant} <span className="redaction redaction-name" />
			</p>
			<p>
				{t.start.specimenPesel} <span className="redaction redaction-pesel" />
			</p>
			<p>
				{t.start.specimenAddress} <span className="redaction redaction-address" />
			</p>
		</figure>
	);
}
