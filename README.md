# Zamaż PDF

[zamazpdf.pl](https://zamazpdf.pl)

Narzędzie do trwałego zamazywania danych osobowych w dokumentach PDF, zanim trafią do kogoś albo do AI. Działa w całości w przeglądarce: serwer tylko podaje stronę, a plik PDF jest czytany, zamazywany i zapisywany na Twoim urządzeniu, bez wysyłania gdziekolwiek. Działa na komputerze i na telefonie, można je zainstalować jako aplikację (PWA) i otworzyć bez internetu.

## Jak używać

1. Otwórz [zamazpdf.pl](https://zamazpdf.pl) albo zbudowany plik `dist/index.html`.
2. Wybierz plik PDF.
3. Zaznacz to, co chcesz zamazać, albo wpisz nazwisko czy PESEL w „Szukaj i zamaż”. Na telefonie stuknięcie zamazuje słowo, a przytrzymanie i przeciągnięcie palcem większy fragment. „Znajdź dane osobowe” pokazuje listę PESEL-i, numerów kont, telefonów, adresów i innych danych z tekstu dokumentu. Imion i nazwisk ta lista nie zna: te wpisz w „Szukaj i zamaż”.
4. Wybierz „Zapisz bezpieczną kopię”. Plik „ZAMAZANY - <nazwa>.pdf” trafi do pobranych plików.
5. Obejrzyj zapisany plik. Program sprawdza, że pod zamazaniami nic nie zostało. Czy niczego nie pominięto, trzeba ocenić samemu.

Strony z zamazaniami są domyślnie zapisywane jako obraz, bo tak jest najpewniej. Pod „Więcej” jest „Zachowaj tekst”: wtedy tekst obok zamazań da się dalej zaznaczać i kopiować. Strona z tekstem, którego nie widać (np. warstwą ze skanera), zawsze jest zapisywana jako obraz, a tego tekstu w pliku już nie ma.

## Jak sprawdzić, że nic nie wysyła

- **Jedna linijka na początku strony.** Zobacz źródło strony (Ctrl+U). Na początku jest `<meta http-equiv="Content-Security-Policy" …>` z `default-src 'none'` i `connect-src 'none'`: przeglądarka pozwala tej stronie wczytać tylko jej własne skrypty i style, a jej i jej workerowi nie pozwala połączyć się z niczym, nawet z serwerem, z którego przyszła.
- **Bez internetu.** Gdy strona się wczyta, wyłącz Wi-Fi albo włącz tryb samolotowy. Wszystko działa tak samo.
- **Narzędzia przeglądarki.** Naciśnij F12, zakładka „Sieć” (Network), odśwież stronę, otwórz i zapisz plik. Widać tylko pliki aplikacji oraz adresy `blob:` i `data:`, czyli dane w pamięci. Otwarcie i zapis pliku nie dodają ani jednej pozycji. W zakładce „Aplikacja” (Application, w Firefoksie „Dane”) ciasteczka, pamięć lokalna i IndexedDB są puste. W „Pamięci podręcznej” (Cache Storage) jest `zamazpdf` z samymi plikami aplikacji, każdy pod swoją sumą SHA-256, tą samą co w `sw.js`.

To, co wpisujesz (PESEL, nazwisko, hasło do pliku), nie trafia do autouzupełniania, sprawdzania pisowni, podpowiedzi pisania ani tłumacza przeglądarki: strona i każde pole tekstowe mają to wyłączone.

Przycisk „Udostępnij” przekazuje zapisaną kopię do programu, który sam wskażesz. Co dalej stanie się z plikiem, zależy od tego programu.

## Uwaga: rozszerzenia przeglądarki

Rozszerzenia (dodatki) przeglądarki widzą zawartość każdej otwartej strony, także tej, i żadna strona nie może ich wyłączyć. Dokumentów z danymi najlepiej nie otwierać przy rozszerzeniach, którym nie ufasz. Najprościej otworzyć aplikację w oknie prywatnym:

- Edge: Ctrl+Shift+N (okno InPrivate), rozszerzenia są w nim domyślnie wyłączone.
- Firefox: Ctrl+Shift+P (okno prywatne), działają w nim tylko rozszerzenia, którym wprost na to pozwolono.

## Budowanie (wymaga Node.js 24)

```
npm ci
npm run build
```

W folderze `dist/` powstają zwykłe pliki: `index.html`, `app.js`, `app.css`, `assets/mupdf-wasm.js` (silnik MuPDF, ok. 14 MB), strony „Jak to działa” i „Polityka prywatności”, `licencje.txt`, a do instalacji ze strony `manifest.webmanifest` i `sw.js` (service worker z sumami pozostałych plików). Dla wyszukiwarek i podglądu linków są `robots.txt`, `sitemap.xml`, `llms.txt` i `og.png`, a treść strony jest od razu w `index.html`, także bez uruchamiania skryptów. `index.html` działa otwarty dwuklikiem z dysku, a ten sam folder idzie na serwer, razem z ukrytym plikiem `.htaccess` (ustawienia serwera Apache). Wersję w aplikacji budowanie bierze z gita; „+ zmiany” za wersją znaczy, że w folderze były zmiany spoza commita.

`npm run check` sprawdza typy (TypeScript).

Kod: `src/app` to interfejs (React), `src/worker` to MuPDF w workerze (zapis, autotest, tekst stron), `src/shared` to model dokumentu i komunikaty między nimi, `src/sw` to service worker, `src/pages` to strony informacyjne, a `scripts/build.mjs` buduje `dist/`.

## Licencja

GNU AGPL-3.0 lub późniejsza ([LICENSE](LICENSE)); tego wymaga silnik MuPDF. Link „Kod źródłowy, wersja …” na ekranie startowym prowadzi do kodu dokładnie tej wersji. Licencje bibliotek i czcionki, które są w aplikacji (MuPDF, React, Zustand, Hanken Grotesk), `npm run build` zbiera do `dist/licencje.txt`.
