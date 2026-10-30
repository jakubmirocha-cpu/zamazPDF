import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { t } from "./i18n";
import { LockIcon } from "./LockIcon";

/**
 * The page under the start screen, as zamazpdf.pl shows it: the app is on top,
 * so one can drop a file at once, and below, for anyone who scrolls, what it does, set as working pieces of the
 * app itself. Gone as soon as a document is open.
 */
export function Landing({ dragActive, onChoose }: { dragActive: boolean; onChoose: () => void }) {
	const root = useRef<HTMLDivElement>(null);
	useReveal(root);
	return (
		<div className="landing" ref={root} role="region" aria-label={t.landing.label}>
			<Peel />
			<Steps />
			<Privacy />
			<Personal />
			<Faq />
			<Close dragActive={dragActive} onChoose={onChoose} />
			<Footer />
		</div>
	);
}

/** The order of a part within its section, for the staggered entrance. */
const order = (i: number) => ({ "--i": i }) as CSSProperties;
// data-reveal goes only on elements whose class React never changes: React would drop the "is-in" put there.

/**
 * Each part marked data-reveal arrives once, as it comes into view (landing.css). Without IntersectionObserver
 * nothing is hidden at all.
 */
function useReveal(root: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const element = root.current;
		if (!element || !("IntersectionObserver" in window)) return;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					entry.target.classList.add("is-in");
					observer.unobserve(entry.target);
				}
			},
			{ rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
		);
		for (const part of element.querySelectorAll("[data-reveal]")) observer.observe(part);
		element.classList.add("is-moving");
		return () => observer.disconnect();
	}, [root]);
}

/* The live piece: a black bar over a PESEL to push aside, as a sticker in a plain program and as Zamaż PDF's. */

function Peel() {
	const p = t.landing.peel;
	return (
		<section className="peel" aria-labelledby="peel-title">
			<div className="peel-copy">
				<h2 id="peel-title" className="landing-title" data-reveal="rise">
					{p.title}
				</h2>
				<p className="landing-statement" data-reveal="rise" style={order(1)}>
					{p.text}
				</p>
			</div>
			{/* The shutter is on the stage inside: the observer does not see an element clipped to nothing. */}
			<div className="peel-shutter" data-reveal="shutter">
				<div className="peel-stage">
					<p className="peel-hint">{p.hint}</p>
					<div className="peel-cards">
						<PeelCard kind="plain" />
						<PeelCard kind="ours" />
					</div>
				</div>
			</div>
		</section>
	);
}

/** The same PESEL as everywhere on this page, with a wrong check digit: no real person's number. */
const SAMPLE_PESEL = "85010112346";

function PeelCard({ kind }: { kind: "plain" | "ours" }) {
	const p = t.landing.peel;
	const bar = useRef<HTMLButtonElement>(null);
	const [offset, setOffset] = useState(0);
	const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
	const [dragging, setDragging] = useState(false);
	/** Far enough to the right to clear the number under it. */
	const travel = () => (bar.current?.offsetWidth ?? 0) + 12;
	const open = offset > 16;

	const down = (e: PointerEvent<HTMLButtonElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { x: e.clientX, from: offset, moved: false };
		setDragging(true);
	};
	const move = (e: PointerEvent<HTMLButtonElement>) => {
		const d = drag.current;
		if (!d) return;
		const dx = e.clientX - d.x;
		if (Math.abs(dx) > 3) d.moved = true;
		setOffset(Math.min(travel(), Math.max(0, d.from + dx)));
	};
	const up = () => setDragging(false);

	return (
		<figure className={`peel-card is-${kind}`}>
			<figcaption className="peel-label">{kind === "plain" ? p.plain : p.ours}</figcaption>
			<div className="peel-paper" data-ui="">
				<p className="peel-paper-title">Umowa najmu nr 12/2026</p>
				<p className="peel-paper-place">zawarta 3 marca 2026 r. w Krakowie</p>
				<p>Najemca: Jan Kowalski</p>
				<p className="peel-line">
					PESEL:{" "}
					<span className="peel-slot">
						<span className="peel-under">{kind === "plain" ? SAMPLE_PESEL : ""}</span>
						<button
							ref={bar}
							type="button"
							className={`peel-bar${dragging ? " is-dragging" : ""}`}
							style={{ transform: `translateX(${offset}px)` }}
							aria-label={p.move}
							aria-pressed={open}
							onPointerDown={down}
							onPointerMove={move}
							onPointerUp={up}
							onPointerCancel={up}
							onClick={() => {
								// A drag ends in a click too; only a press without moving pushes the bar aside or back.
								if (drag.current?.moved) return void (drag.current = null);
								drag.current = null;
								setOffset(open ? 0 : travel());
							}}
						/>
					</span>
				</p>
			</div>
			<p className="peel-result" aria-live="polite">
				{open ? (kind === "plain" ? p.plainFound : p.oursEmpty) : ""}
			</p>
		</figure>
	);
}

/* Three statements, and beside them one piece of the app that follows them: a file, a bar being drawn, saved. */

function Steps() {
	const s = t.landing.steps;
	const [active, setActive] = useState(0);
	const blocks = useRef<(HTMLDivElement | null)[]>([]);

	useEffect(() => {
		if (!("IntersectionObserver" in window)) return;
		// The statement crossing the middle of the window is the one the piece shows; on a phone, what the piece
		// pinned over the top leaves free, wide enough that a flick of the finger cannot jump over a statement.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
				}
			},
			{ rootMargin: window.matchMedia("(max-width: 959px)").matches ? "-45% 0px -30% 0px" : "-45% 0px -45% 0px" },
		);
		for (const block of blocks.current) if (block) observer.observe(block);
		return () => observer.disconnect();
	}, []);

	return (
		<section className="steps" aria-labelledby="steps-title">
			<div className="steps-text">
				<h2 id="steps-title" className="steps-title" data-reveal="rise">
					{s.title}
				</h2>
				{s.items.map((item, i) => (
					<div
						key={item.lead}
						ref={(el) => void (blocks.current[i] = el)}
						className={`step${i === active ? " is-active" : ""}`}
						data-step={i}
					>
						<p className="step-lead">{item.lead}</p>
						<p className="step-text">{item.text}</p>
					</div>
				))}
			</div>
			<div className="steps-stage">
				<div className="steps-sticky">
					<StepsPiece active={active} />
				</div>
			</div>
		</section>
	);
}

function StepsPiece({ active }: { active: number }) {
	const s = t.landing.steps;
	const state = (i: number) => `steps-state${i === active ? " is-active" : ""}`;
	return (
		<div className="steps-piece" data-ui="" aria-hidden="true">
			<div className={state(0)}>
				<div className="piece-drop">
					<p className="piece-drop-title">{s.dropTitle}</p>
					<div className="piece-file">
						<FileIcon />
						{s.file}
					</div>
					<Pointer />
				</div>
			</div>
			<div className={state(1)}>
				<PiecePaper drawing />
			</div>
			<div className={state(2)}>
				<div className="piece-passed">
					<CheckIcon />
					<p>
						<strong>{t.preview.passed}</strong> {t.preview.look(s.saved)}
					</p>
				</div>
				<PiecePaper />
			</div>
		</div>
	);
}

/** The top of the contract in the app's viewer: while drawing, the bar over the name lets the text show through. */
function PiecePaper({ drawing = false }: { drawing?: boolean }) {
	return (
		<div className="piece-paper">
			<p className="piece-paper-title">Umowa najmu nr 12/2026</p>
			<p>zawarta 3 marca 2026 r. w Krakowie</p>
			<p>
				Najemca:{" "}
				<span className={`piece-box${drawing ? " is-drawing" : ""}`}>
					<span className="piece-box-text">Jan Kowalski</span>
					{drawing && (
						<>
							<span className="piece-handle is-nw" />
							<span className="piece-handle is-se" />
							<Pointer />
						</>
					)}
				</span>
			</p>
			<p>
				PESEL: <span className="piece-box is-pesel" />
			</p>
			<p>
				Adres: ul. <span className="piece-box is-address" />
			</p>
			<p>Wynajmujący oddaje Najemcy w używanie lokal mieszkalny</p>
		</div>
	);
}

/*
 * "Znajdź dane osobowe": the app's own list beside the contract it found the places in. Unticking a place takes
 * its marker off the page; "Zamaż zaznaczone" blacks out the ticked ones and takes them off the list, as in the
 * app, and "Cofnij" brings them back.
 */

type Kind = keyof typeof t.personal.kinds;

function Personal() {
	const p = t.landing.personal;
	const [ticked, setTicked] = useState(() => p.items.map((item) => item.ticked));
	const [redacted, setRedacted] = useState(() => p.items.map(() => false));
	const open = p.items.map((_, i) => i).filter((i) => !redacted[i]);
	const count = open.filter((i) => ticked[i]).length;
	const kinds = [...new Set(open.map((i) => p.items[i]!.kind as Kind))];
	const tick = (indexes: number[], on: boolean) => setTicked((now) => now.map((was, i) => (indexes.includes(i) ? on : was)));
	const summary =
		open.length === p.items.length
			? t.personal.found(p.items.length)
			: open.length === 0
				? t.personal.allRedacted
				: t.personal.left(open.length, p.items.length);
	const mark = (i: number) => {
		const text = p.items[i]!.text;
		// Redacted, there is nothing under the bar, as in the saved file: spaces as wide as figures.
		if (redacted[i]) return <span className="personal-mark is-redacted">{" ".repeat(text.length)}</span>;
		return <span className={ticked[i] ? "personal-mark is-ticked" : "personal-mark"}>{text}</span>;
	};

	return (
		<section className="personal-section" aria-labelledby="personal-title-landing">
			<div className="personal-copy">
				<h2 id="personal-title-landing" className="landing-title" data-reveal="rise">
					{p.title}
				</h2>
				<p className="landing-statement" data-reveal="rise" style={order(1)}>
					{p.lead}
				</p>
			</div>
			<div className="personal-stage" data-reveal="rise" style={order(2)}>
				<p className="personal-hint">{p.hint}</p>
				<div className="personal-pieces">
					<div className="personal-piece" data-ui="">
						<p className="personal-title">{t.personal.title}</p>
						<p className="personal-summary" aria-live="polite">
							{summary}
						</p>
						<div className="personal-list">
							{kinds.map((kind) => {
								const items = open.filter((i) => p.items[i]!.kind === kind);
								return (
									<div key={kind} className="personal-group">
										<KindCheck
											label={t.personal.kind(t.personal.kinds[kind], items.length)}
											on={items.filter((i) => ticked[i]).length}
											of={items.length}
											onChange={(on) => tick(items, on)}
										/>
										<ul className="personal-items">
											{items.map((i) => (
												<li key={i} className="personal-item">
													<input
														type="checkbox"
														aria-label={t.personal.pick(p.items[i]!.text)}
														checked={ticked[i]}
														onChange={(e) => tick([i], e.currentTarget.checked)}
													/>
													<span className="personal-show">
														<span className="personal-text">{p.items[i]!.text}</span>
														<span className="personal-page">{t.personal.page(p.items[i]!.page)}</span>
													</span>
												</li>
											))}
										</ul>
									</div>
								);
							})}
						</div>
						<div className="personal-foot">
							{open.length > 0 && (
								<button
									type="button"
									className="button-strong"
									disabled={count === 0}
									onClick={() => setRedacted((now) => now.map((was, i) => was || ticked[i]!))}
								>
									{t.personal.redact(count)}
								</button>
							)}
							{open.length < p.items.length && (
								<button type="button" className="button-quiet" onClick={() => setRedacted(p.items.map(() => false))}>
									{p.undo}
								</button>
							)}
						</div>
					</div>
					<div className="personal-paper" data-ui="" aria-hidden="true">
						<p className="piece-paper-title">Umowa najmu nr 12/2026</p>
						<p>zawarta 3 marca 2026 r. w Krakowie</p>
						<p className="personal-paper-text">
							Najemca: Jan Kowalski, PESEL {mark(0)}, zamieszkały {mark(5)}, tel. {mark(3)}, <span className="nowrap">e-mail</span> {mark(4)}.
						</p>
						<p className="personal-paper-text">Czynsz płatny do 10. dnia miesiąca na rachunek {mark(2)}.</p>
						<p className="personal-paper-page">str. 2</p>
						<p className="personal-paper-text">Najemca (PESEL {mark(1)}) oświadcza, że zapoznał się ze stanem lokalu.</p>
					</div>
				</div>
			</div>
		</section>
	);
}

/** "PESEL (2)": ticks or unticks the whole kind; half ticked when only some of it is (as in the app). */
function KindCheck({ label, on, of, onChange }: { label: string; on: number; of: number; onChange: (on: boolean) => void }) {
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => {
		box.current!.indeterminate = on > 0 && on < of;
	});
	return (
		<label className="check personal-kind">
			<input ref={box} type="checkbox" checked={on === of} onChange={(e) => onChange(e.currentTarget.checked)} />
			{label}
		</label>
	);
}

/* Questions as people ask them, on the left; the answers beside them, all in one grey field (on a phone, each
   under its question). The heading on the same line as "Znajdź dane osobowe". Everything at once: no clicking,
   nothing opening while one scrolls past. */

function Faq() {
	const f = t.landing.faq;
	return (
		<section className="faq" aria-labelledby="faq-title">
			<h2 id="faq-title" className="landing-title" data-reveal="rise">
				{f.title}
			</h2>
			{/* One piece: the field must not come apart while it arrives. */}
			<dl className="faq-list" data-reveal="rise">
				{f.items.map((item) => (
					<div key={item.q} className="faq-item">
						<dt>{item.q}</dt>
						<dd>{item.a}</dd>
					</div>
				))}
			</dl>
			<p className="faq-more" data-reveal="rise">
				{f.more}{" "}
				<a className="link" href={`mailto:${f.email}`}>
					{f.email}
				</a>
			</p>
		</section>
	);
}

/* The file stays on the computer: the one section in the other colour. */

function Privacy() {
	const p = t.landing.privacy;
	return (
		<section className="privacy-band" aria-labelledby="privacy-title">
			<h2 id="privacy-title" className="landing-title" data-reveal="rise">
				<LockIcon />
				{p.title}
			</h2>
			<div className="privacy-grid">
				<dl className="privacy-facts">
					{p.facts.map((fact, i) => (
						<div key={fact.label} data-reveal="rise" style={order(i)}>
							<dt>{fact.label}</dt>
							<dd>
								{fact.link ? (
									<a className="link" href={SOURCE_URL} target="_blank" rel="noreferrer">
										{fact.value}
									</a>
								) : (
									fact.value
								)}
							</dd>
						</div>
					))}
				</dl>
				<div className="privacy-text">
					<p className="landing-statement" data-reveal="rise" style={order(1)}>
						{p.statement}
					</p>
					<p data-reveal="rise" style={order(2)}>
						{p.text}
					</p>
				</div>
			</div>
		</section>
	);
}

function Close({ dragActive, onChoose }: { dragActive: boolean; onChoose: () => void }) {
	const c = t.landing.close;
	return (
		<section className={`close${dragActive ? " is-active" : ""}`} aria-labelledby="close-title">
			<h2 id="close-title" className="landing-title" data-reveal="rise">
				{c.title}
			</h2>
			<p className="landing-statement" data-reveal="rise" style={order(1)}>
				{c.text}
			</p>
			<button type="button" className="button" data-reveal="rise" style={order(2)} onClick={onChoose}>
				{t.start.choose}
			</button>
		</section>
	);
}

function Footer() {
	const f = t.landing.footer;
	const { name, commit, changed } = APP_VERSION;
	return (
		<footer className="site-footer">
			<p>{f.what}</p>
			<nav className="site-footer-links" aria-label={f.links}>
				<a href="jak-to-dziala.html" target="_blank">
					{t.start.howItWorks}
				</a>
				<a href="polityka-prywatnosci.html" target="_blank">
					{t.start.privacyPolicy}
				</a>
				<a href={commit ? `${SOURCE_URL}/tree/${commit}` : SOURCE_URL} target="_blank" rel="noreferrer">
					{t.start.source}
				</a>
			</nav>
			<p className="site-footer-made">
				{t.start.version(name, changed)} · {f.year}{" "}
				<a className="link" href={f.studioUrl} target="_blank" rel="noreferrer">
					{f.studio}
				</a>
			</p>
		</footer>
	);
}

function FileIcon() {
	return (
		<svg className="piece-file-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M6 2.5h8l4.5 4.5v14.5H6z" />
			<path d="M14 2.5V7h4.5" />
			<path d="M8.5 13h7M8.5 16h7" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg className="passed-icon" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4.5 12.5l5 5 10-11" />
		</svg>
	);
}

/** The mouse pointer, where the hand would be. */
function Pointer() {
	return (
		<svg className="piece-pointer" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M5 3l14 8.5-6.2 1.3 3.6 6.9-2.6 1.3-3.6-6.9L5 18.5z" />
		</svg>
	);
}
