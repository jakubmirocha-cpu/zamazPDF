// What scripts/build.mjs runs to put the start screen and the page under it into index.html. Search engines and AI
// crawlers then read the page without running any script, and a visitor sees it before app.js arrives; main.tsx
// replaces it with the living one. Text for a mouse: a phone gets its own wording from app.js.
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "./i18n";
import { StartScreen } from "./StartScreen";

const nothing = () => {};

export const startScreen = renderToStaticMarkup(
	<StartScreen opening={{ step: "idle", notice: null }} dragActive={false} engineStarting engineFailed={false} onFile={nothing} onUnlock={nothing} onCancel={nothing} />,
);

/** The questions on the page, for the structured data: what it says there, word for word. */
export const questions = t.landing.faq.items;
