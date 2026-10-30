import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startEngine } from "./engine";
import "./fonts.css";
import "./styles.css";
import "./landing.css";
import "../pages/pages.css"; // the information pages have no script of their own, but take app.css

// The engine first: its download is what takes longest.
startEngine();
createRoot(document.getElementById("root")!).render(<App />);

// From a server, the service worker keeps the app for use with no connection (src/sw/main.ts). From disk there is
// nothing to keep, and browsers have no service workers there. Only once the page has loaded, engine included: the
// service worker then gets the files from the browser's cache instead of downloading them a second time.
if (location.protocol !== "file:" && "serviceWorker" in navigator) {
	window.addEventListener("load", () => void navigator.serviceWorker.register("sw.js").catch(() => {}));
}
