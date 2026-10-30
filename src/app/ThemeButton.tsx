import { useEffect, useState } from "react";
import { t } from "./i18n";

type Theme = "light" | "dark";

const darkSystem = () => matchMedia("(prefers-color-scheme: dark)");
/** The theme shown now: the one chosen with the button, or else the system's. */
const currentTheme = (): Theme =>
	(document.documentElement.dataset.theme as Theme | undefined) ?? (darkSystem().matches ? "dark" : "light");

/** The window's own colour (the browser's bar, the installed app's title bar): the page's background. */
const WINDOW_COLOUR: Record<Theme, string> = { light: "#ebeae6", dark: "#1c1c1c" };

/**
 * Light or dark against the system's choice: data-theme on <html>, which styles.css follows. Kept in
 * memory only: the page stores nothing in the browser (as the privacy policy says), so a new visit follows the
 * system again. The button shows the theme it switches to.
 */
export function ThemeButton() {
	const [theme, setTheme] = useState(currentTheme);
	const next: Theme = theme === "dark" ? "light" : "dark";

	// Until the button is used, the system may change its mind (e.g. dark at night): follow it.
	useEffect(() => {
		const media = darkSystem();
		const follow = () => setTheme(currentTheme());
		media.addEventListener("change", follow);
		return () => media.removeEventListener("change", follow);
	}, []);

	return (
		<button
			type="button"
			className="theme-button"
			aria-label={t.theme[next]}
			title={t.theme[next]}
			onClick={() => {
				document.documentElement.dataset.theme = next;
				for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
					meta.content = WINDOW_COLOUR[next];
				}
				setTheme(next);
			}}
		>
			<svg className="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
				{next === "dark" ? (
					<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
				) : (
					<>
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
					</>
				)}
			</svg>
		</button>
	);
}
