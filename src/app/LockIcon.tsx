/** The lock beside "Plik nie opuszcza Twojego urządzenia", drawn rather than an emoji, which differs per system. */
export function LockIcon() {
	return (
		<svg className="privacy-icon" viewBox="0 0 24 24" aria-hidden="true">
			<rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
			<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
		</svg>
	);
}
