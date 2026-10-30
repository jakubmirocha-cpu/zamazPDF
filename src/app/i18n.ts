// Interface text. Polish now; English can join with the same shape.

/** A finger rather than a mouse: words like "przeciągnij" and "myszką" mean nothing there. */
const finger = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

const pl = {
	appName: "Zamaż PDF",
	privacy: "Plik nie opuszcza Twojego urządzenia",
	start: {
		statement: "Zamaż PESEL, nazwisko albo adres, zanim wyślesz dokument dalej.",
		promise: "Tego, co zamażesz, nie da się potem odczytać ani skopiować.",
		specimenLabel: "Przykład: w umowie zamazane nazwisko, PESEL i adres",
		specimenTitle: "Umowa najmu nr 12/2026",
		specimenPlace: "zawarta 3 marca 2026 r. w Krakowie",
		specimenTenant: "Najemca: Jan",
		specimenPesel: "PESEL:",
		specimenAddress: "Adres: ul.",
		drop: finger ? "Stuknij tutaj i wybierz plik" : "Przeciągnij plik tutaj albo kliknij",
		dropActive: "Upuść plik, żeby go otworzyć",
		choose: "Wybierz plik PDF",
		notPdf: (name: string) => `„${name}” to nie jest plik PDF. Wybierz plik z końcówką .pdf.`,
		loading: "Wczytywanie programu…",
		about: "O programie",
		howItWorks: "Jak to działa",
		privacyPolicy: "Polityka prywatności",
		source: "Kod źródłowy",
		version: (name: string, changed: boolean) => `wersja ${name}${changed ? " + zmiany" : ""}`,
		sourceHint: (commit: string | undefined) => `Kod tej wersji na GitHubie${commit ? ` (${commit})` : ""}`,
		sourceChangedHint: "Ta wersja ma zmiany, których nie ma w kodzie na GitHubie",
	},
	open: {
		reading: "Otwieranie pliku…",
		failed: (name: string) => `Nie udało się otworzyć „${name}”. Plik może być uszkodzony.`,
		passwordTitle: "Ten plik jest chroniony hasłem",
		passwordHint: (name: string) => `Wpisz hasło do „${name}”. Hasło zostaje na tym urządzeniu.`,
		passwordLabel: "Hasło",
		showPassword: "Pokaż hasło",
		passwordWrong: "To hasło nie pasuje. Spróbuj jeszcze raz.",
		unlock: "Otwórz",
		cancel: "Anuluj",
	},
	document: {
		pageOf: (page: number, count: number) => `Strona ${page} z ${count}`,
		pageShort: (page: number, count: number) => `${page} / ${count}`,
		tools: "Narzędzia",
		menu: "Menu",
		closeSheet: "Zamknij",
		zoom: "Powiększenie",
		zoomOut: "Pomniejsz",
		zoomIn: "Powiększ",
		zoomFit: "Dopasuj",
		zoomFitHint: "Dopasuj stronę do szerokości okna",
		close: "Zamknij plik",
		closeTitle: "Zamknąć plik bez zapisywania?",
		closeText: "Zmiany nie zostały zapisane. Po zamknięciu pliku przepadną.",
		closeStay: "Wróć do zamazywania",
		closeLeave: "Zamknij bez zapisywania",
		pages: "Strony",
		page: (page: number) => `Strona ${page}`,
		removePage: "Usuń stronę",
		rotateLeftPage: (page: number) => `Obróć stronę ${page} w lewo`,
		rotateRightPage: (page: number) => `Obróć stronę ${page} w prawo`,
		removePageNumber: (page: number) => `Usuń stronę ${page}`,
		onlyPage: "Jedynej strony nie można usunąć",
		pageFailed: "Nie udało się pokazać tej strony.",
		hint: "Zaznacz myszką to, co chcesz zamazać: przytrzymaj przycisk i przeciągnij.",
		fingerHint: "Stuknij słowo, żeby je zamazać. Większy fragment: przytrzymaj palec i przeciągnij.",
		undo: "Cofnij",
		undoHint: "Cofnij (Ctrl+Z)",
		redo: "Ponów",
		redoHint: "Ponów (Ctrl+Y)",
		remove: "Usuń",
		redaction: (n: number, page: number) => `Zamazanie ${n} na stronie ${page}`,
		signed: "Ten dokument jest podpisany elektronicznie.",
		signedText: "Po zamazaniu podpis przestanie być ważny.",
		signedOk: "Rozumiem",
	},
	save: {
		button: "Zapisz bezpieczną kopię",
		short: "Zapisz",
		nothingYet: "Najpierw zamaż coś na stronie",
		more: "Więcej",
		modeTitle: "Jak zapisać strony z zamazaniami",
		modeImage: "Jako obraz (zalecane)",
		modeImageText: "Najpewniejszy sposób. Tekstu na tych stronach nie da się potem zaznaczyć ani skopiować.",
		modeText: "Zachowaj tekst",
		modeTextText:
			"Tekst obok zamazań da się dalej zaznaczać i kopiować. Linie i tła, które dotykają zamazania, znikają w całości.",
		saving: "Zapisywanie bezpiecznej kopii…",
		progress: (done: number, total: number) => `Strona ${done} z ${total}`,
		checking: "Sprawdzanie zapisanego pliku…",
		checkingText: "Czy pod zamazaniami na pewno nic nie zostało.",
		nameTitle: "Nazwa pliku zdradza zamazane dane",
		nameText: (removed: string[]) =>
			`W nazwie pliku jest to, co zamazujesz: ${removed.map((w) => `„${w}”`).join(", ")}. Proponujemy nazwę bez tego:`,
		nameLabel: "Nazwa pliku",
		download: "Pobierz plik",
		cancel: "Anuluj",
		back: "Wróć do dokumentu",
		failedTitle: "Nie udało się zapisać",
		autotestFailed: (pages: number[]) =>
			`Na ${pages.length > 1 ? "stronach" : "stronie"} ${pages.join(", ")} coś zostało pod zamazaniem, więc plik nie został zapisany. Nic nie trafiło do pobranych.`,
		failedText: "Spróbuj jeszcze raz. Jeśli to się powtórzy, ten plik może być uszkodzony.",
	},
	search: {
		label: "Szukaj i zamaż",
		placeholder: "imię i nazwisko albo PESEL",
		clear: "Wyczyść",
		close: "Zamknij wyszukiwanie",
		clearHint: "Wyczyść wyszukiwanie (Esc)",
		hint: "Enter: następny wynik, Shift+Enter: poprzedni, Esc: wyczyść",
		previous: "Poprzedni wynik",
		next: "Następny wynik",
		count: (at: number, of: number) => `${at} z ${of}`,
		allCovered: "wszystkie zamazane",
		none: "0 wyników",
		redactAll: (n: number) => `Zamaż wszystkie (${n})`,
		similar: "Podobne słowa w dokumencie:",
		similarWord: (word: string, count: number) => `${word} (${count})`,
		similarAsk: "— zamazać też?",
		reading: (read: number, total: number) => `Czytanie tekstu dokumentu: ${read} z ${total} stron…`,
		alsoOn: (pages: string) => `Ten tekst jest jeszcze na str. ${pages} — zamazać też?`,
		nothing: "Nie znaleziono w tekście — sprawdź wzrokowo.",
		noText: (pages: string, count: number) =>
			`${count > 1 ? "Na stronach" : "Na stronie"} ${pages} nie ma tekstu do przeszukania — zamaż ręcznie.`,
		scans: (pages: string, count: number) =>
			`${count > 1 ? `Strony ${pages} to skany` : `Strona ${pages} to skan`} — wyszukiwanie może coś pominąć albo trafić obok, sprawdź wzrokowo.`,
	},
	personal: {
		button: "Znajdź dane osobowe",
		buttonHint: "Pokaż listę PESEL-i, numerów kont, telefonów, adresów i innych danych w tym dokumencie",
		title: "Dane osobowe",
		close: "Zamknij listę",
		closeHint: "Zamknij listę danych osobowych (Esc)",
		found: (n: number) => `Znaleziono ${n} ${plural(n, "miejsce", "miejsca", "miejsc")}. Zaznaczone zostaną zamazane.`,
		left: (open: number, found: number) => `Niezamazane: ${open} z ${found}. Zaznaczone zostaną zamazane.`,
		allRedacted: "Wszystkie znalezione dane są zamazane.",
		nothing: "Nie znaleziono danych osobowych w tekście — sprawdź wzrokowo.",
		kind: (name: string, count: number) => `${name} (${count})`,
		kinds: {
			pesel: "PESEL",
			idCard: "Dowód osobisty",
			passport: "Paszport",
			account: "Numer konta",
			card: "Karta płatnicza",
			nip: "NIP",
			regon: "REGON",
			phone: "Telefon",
			email: "E-mail",
			address: "Adres",
			birthDate: "Data urodzenia",
			drivingLicence: "Prawo jazdy",
			plate: "Numer rejestracyjny",
			vin: "Numer VIN",
			landRegister: "Księga wieczysta",
			clientNumber: "Numer klienta lub polisy",
			mrz: "Strefa MRZ (dowód, paszport)",
		},
		pick: (text: string) => `Zamazać „${text}”`,
		showHint: "Pokaż na stronie",
		page: (page: number) => `str. ${page}`,
		redact: (n: number) => `Zamaż zaznaczone (${n})`,
		unseen:
			"Lista nie obejmuje imion i nazwisk — wpisz je w „Szukaj i zamaż”, każde słowo zostanie znalezione także osobno. Sprawdź też wzrokowo podpisy odręczne, zdjęcia, kody QR i kreskowe oraz nagłówek i stopkę wydruku ze strony internetowej.",
	},
	preview: {
		passed: "Zamazane miejsca są puste — dane spod prostokątów zostały trwale usunięte.",
		/** Saved with pages turned or removed, but nothing redacted. */
		savedClean: "Plik zapisany od nowa, bez metadanych.",
		removedPages: (n: number) => (n > 1 ? "Usuniętych stron nie ma w pliku." : "Usuniętej strony nie ma w pliku."),
		look: (name: string) => `Tak wygląda zapisany plik „${name}” (jest w pobranych plikach). Sprawdź, czy niczego nie pominięto.`,
		keptText: "Tekst poza zamazaniami został zachowany.",
		imagePages: (pages: number[]) =>
			pages.length > 1
				? `Strony ${pageList(pages)} zapisano jako obraz, bo nie dało się na nich bezpiecznie zachować tekstu.`
				: `Stronę ${pages[0]} zapisano jako obraz, bo nie dało się na niej bezpiecznie zachować tekstu.`,
		hiddenPages: (pages: number[]) =>
			pages.length > 1
				? `Na stronach ${pageList(pages)} był tekst, którego nie widać (np. ze skanera), więc zapisano je jako obraz. Tego tekstu już w pliku nie ma, a tych stron nie da się przeszukiwać.`
				: `Na stronie ${pages[0]} był tekst, którego nie widać (np. ze skanera), więc zapisano ją jako obraz. Tego tekstu już w pliku nie ma, a tej strony nie da się przeszukiwać.`,
		back: "Wróć do zamazywania",
		share: "Udostępnij",
		shareFailed: "Nie udało się udostępnić. Plik jest w pobranych plikach.",
	},
	engineFailed: "Nie udało się wczytać programu. Sprawdź połączenie z internetem i odśwież stronę.",
	/** The theme button: what a press switches to. */
	theme: { light: "Włącz jasny motyw", dark: "Włącz ciemny motyw" },
	/** The page under the start screen: for anyone, without technical terms. */
	landing: {
		label: "O programie Zamaż PDF",
		peel: {
			title: "Pod spodem nic nie ma",
			text: "W wielu programach czarny prostokąt to tylko naklejka: tekst pod nim zostaje i da się go skopiować. W Zamaż PDF to, co zamażesz, znika z pliku.",
			hint: finger ? "Przesuń czarne prostokąty palcem." : "Przesuń czarne prostokąty myszką.",
			plain: "Zwykły czarny prostokąt",
			ours: "Zamaż PDF",
			move: "Odsuń czarny prostokąt",
			plainFound: "PESEL dalej jest w pliku. Da się go zaznaczyć i skopiować.",
			oursEmpty: "Pusto. Tego PESEL-u nie ma już w pliku.",
		},
		steps: {
			title: "Jak to działa",
			items: [
				{
					lead: "Najpierw otwórz plik.",
					text: finger
							? "Stuknij „Wybierz plik PDF” i wskaż plik. Otwiera się u Ciebie, na telefonie."
							: "Przeciągnij plik PDF do okna albo kliknij „Wybierz plik PDF”. Plik otwiera się u Ciebie, na komputerze.",
				},
				{
					lead: "Potem zaznacz, co ukryć.",
					text: finger
							? "Stuknij słowo albo przytrzymaj palec i przeciągnij po nazwisku czy numerze. Pojawi się czarny prostokąt, który możesz przesunąć, powiększyć albo usunąć."
							: "Przeciągnij myszką po nazwisku albo numerze. Pojawi się czarny prostokąt, który możesz przesunąć, powiększyć albo usunąć.",
				},
				{
					lead: "Na koniec zapisz kopię.",
					text: "Program sprawdzi, czy pod prostokątami nic nie zostało, i zapisze nowy plik w pobranych. Twój plik zostaje taki, jaki był.",
				},
			],
			dropTitle: finger ? "Wybierz plik PDF" : "Upuść plik, żeby go otworzyć",
			file: "umowa-najmu.pdf",
			saved: "ZAMAZANY - umowa-najmu.pdf",
		},
		personal: {
			title: "Znajdź dane osobowe",
			lead: "Jeden przycisk zbiera z całego dokumentu numery PESEL, numery kont, telefony, adresy i e-maile. Odznacz to, co ma zostać, a resztę zamaż za jednym razem.",
			hint: "Odznacz telefon i zobacz, co się zmieni.",
			// What the list finds in the contract beside it; made up, the PESEL with a wrong check digit.
			items: [
				{ kind: "pesel", text: "85010112346", page: 1, ticked: true },
				{ kind: "pesel", text: "850 101 12346", page: 2, ticked: true },
				{ kind: "account", text: "12 1020 3040 5060 7080 9010 1112", page: 1, ticked: true },
				{ kind: "phone", text: "123 456 789", page: 1, ticked: true },
				{ kind: "email", text: "jan.kowalski@example.com", page: 1, ticked: true },
				{ kind: "address", text: "ul. Przykładowa 12, 30-001 Kraków", page: 1, ticked: true },
			],
			undo: "Cofnij",
		},
		faq: {
			title: "Pytania i odpowiedzi",
			// Asked the way people ask them.
			items: [
				{
					q: "Czy to jest bezpieczne?",
					a: "Tak. Plik nie opuszcza Twojego urządzenia: program działa w przeglądarce i niczego nie wysyła, ani do nas, ani nigdzie indziej. To, co zamażesz, jest z pliku naprawdę usunięte, a przed zapisem program sam sprawdza, czy pod czarnymi prostokątami nic nie zostało.",
				},
				{
					q: "Czy to naprawdę jest za darmo? Gdzie jest haczyk?",
					a: "Nie ma haczyka. Nie płacisz, nie zakładasz konta, nie oglądasz reklam, a my nie zbieramy żadnych danych. Kod programu jest otwarty, więc każdy może sprawdzić, co program robi.",
				},
				{
					q: "Czy program sam znajdzie wszystkie moje dane?",
					a: "Nie wszystkie. W tekście dokumentu znajdzie numery PESEL, numery kont, telefony, adresy i e-maile. Imion i nazwisk sam nie rozpozna, nie zauważy też podpisów, pieczątek, zdjęć ani kodów QR. Dlatego po zapisie zawsze obejrzyj plik: program pokaże go od razu.",
				},
				{
					q: "Moje nazwisko jest na kilku stronach. Muszę zamazywać każde osobno?",
					a: "Nie. Wpisz je w pole „Szukaj i zamaż” i wybierz „Zamaż wszystkie”. Program znajdzie je na wszystkich stronach, także odmienione, na przykład „Kowalskiego”, i zapisane bez polskich liter.",
				},
				{
					q: "A jeśli zamażę coś przez pomyłkę?",
					a: "Dopóki pracujesz nad plikiem, przycisk „Cofnij” cofa każdy krok, także zamazanie wszystkich miejsc naraz. Z zapisanej, zamazanej kopii tych danych nie da się już odzyskać: zostały z niej usunięte na zawsze. Twój plik zostaje taki, jaki był, więc zawsze możesz zacząć od nowa.",
				},
				{
					q: "Mam zeskanowany dokument. Czy to zadziała?",
					a: "Tak, ale zamazujesz ręcznie. Na skanie albo zdjęciu strony program zwykle nie przeczyta tekstu, więc sam niczego nie znajdzie. Zaznacz ręcznie wszystko, co chcesz ukryć: zamazanie działa tak samo.",
				},
				{
					q: "Mój plik ma hasło. Co wtedy?",
					a: "Program poprosi o hasło. Wpisujesz je u siebie, na swoim urządzeniu, a zapisana kopia jest już bez hasła.",
				},
				{
					q: "Jedna strona jest zbędna, a inna leży bokiem. Da się to poprawić?",
					a: finger
							? "Tak. Obrócisz ją i usuniesz w menu, pod trzema kreskami. Usuniętej strony nie będzie w zapisanym pliku."
							: "Tak. Strzałkami obok numeru strony ją obrócisz, a koszem przy miniaturze usuniesz. Usuniętej strony nie będzie w zapisanym pliku.",
				},
				{
					q: "Dokument ma podpis elektroniczny. Czy po zamazaniu będzie ważny?",
					a: "Nie. Po zamazaniu dokument jest już inny, więc podpis elektroniczny przestaje być ważny. Program uprzedza o tym, gdy otworzysz taki plik.",
				},
			],
			more: "Masz inne pytanie? Napisz:",
			email: "kontakt@vespero-studio.pl",
		},
		privacy: {
			title: "Plik zostaje u Ciebie",
			statement: "Dokument nie jest nigdzie wysyłany: ani do nas, ani nigdzie indziej. Zamaż PDF robi wszystko w Twojej przeglądarce.",
			text: "Gdy strona się wczyta, możesz wyłączyć internet, a wszystko zadziała tak samo. W Chrome i Edge możesz też zainstalować Zamaż PDF jak zwykłą aplikację, także na telefonie.",
			facts: [
				{ label: "Konto", value: "niepotrzebne", link: false },
				{ label: "Cena", value: "za darmo, bez reklam", link: false },
				{ label: "Bez internetu", value: "działa", link: false },
				{ label: "Kod", value: "otwarty, na GitHubie", link: true },
			],
		},
		close: {
			title: "Zamaż swój plik",
			text: finger ? "Stuknij przycisk i wskaż plik PDF." : "Przeciągnij plik PDF w dowolne miejsce tej strony albo kliknij przycisk.",
		},
		footer: {
			what: "Zamaż PDF: zamazywanie danych w plikach PDF",
			links: "Strony o programie",
			year: "2026",
			studio: "Vespero Studio",
			studioUrl: "https://vespero-studio.pl",
		},
	},
};

/** The Polish form for `n`: 1 miejsce, 2–4 miejsca (also 22–24…), 5 miejsc (also 12–14). */
function plural(n: number, one: string, few: string, many: string) {
	if (n === 1) return one;
	const [tens, units] = [n % 100, n % 10];
	return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

/** "1–3, 7": page numbers for a message. */
export function pageList(numbers: number[]) {
	const runs: string[] = [];
	for (let i = 0; i < numbers.length; i++) {
		let j = i;
		while (j + 1 < numbers.length && numbers[j + 1] === numbers[j]! + 1) j++;
		runs.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
		i = j;
	}
	return runs.join(", ");
}

export type Messages = typeof pl;

export const t: Messages = pl;
