# Intelligent label printing – instrukcja

[English](en.md) · **Polski**

Intelligent label printing to wtyczka do Chrome, która sama znajduje etykietę kurierską w PDF-ie, obcina zbędną biel i drukuje ją jednym kliknięciem na wybranej drukarce, na drukarce etykiet albo na zwykłej kartce A4.

## Instalacja

1. Zainstaluj wtyczkę z [Chrome Web Store](https://chromewebstore.google.com/detail/intelligent-label-printin/fcfpnegfonhlplflgmjapjgkdcpdfkma) i przypnij jej ikonę do paska narzędzi.
2. Otwórz ustawienia wtyczki (ikona koła zębatego w okienku wtyczki). W sekcji programu pomocniczego jest przycisk pobrania dla Twojego systemu.
3. Zainstaluj program pomocniczy:
    - **Windows:** kliknij dwukrotnie pobrany plik `.exe`. Jeśli pojawi się Windows SmartScreen, wybierz **Więcej informacji → Uruchom mimo to**. Uprawnienia administratora nie są potrzebne.
    - **macOS:** otwórz pobrany plik `.pkg`. Jeśli system napisze, że nie może zweryfikować dewelopera, otwórz **Ustawienia systemowe → Prywatność i ochrona** i kliknij **Otwórz mimo to**.
4. Uruchom ponownie Chrome i w ustawieniach wtyczki kliknij **Sprawdź ponownie**. Zielona kropka oznacza, że wszystko działa.

Program pomocniczy jest potrzebny, bo Chrome nie pozwala wtyczkom drukować na wybraną drukarkę bez okna dialogowego. Bez niego wtyczka nadal przycina etykiety, ale drukuje przez zwykłe okno drukowania. Ostrzeżenia przy instalacji wynikają z braku cyfrowego podpisu; kod programu jest publiczny na [GitHubie](https://github.com/kepak1/intelligent-label-printing).

## Konfiguracja

1. W ustawieniach wybierz profil albo dodaj nowy.
2. Wybierz **drukarkę** z listy.
3. Wybierz **rozmiar nośnika w sterowniku**, pasujący do papieru w drukarce. Rozmiar papieru i niedrukowalne marginesy ustawią się same.
4. Ustaw najczęściej używany profil jako **aktywny**.

| Papier w profilu | Wynik |
| --- | --- |
| Etykieta (A6, 100×150 mm, 4×6" albo własny rozmiar) | Etykieta wypełnia całą naklejkę |
| A4 | Etykieta w polu A6 (105×148 mm) z liniami cięcia; opcjonalnie 2 lub 4 na kartce |

Wskazówki:
- **Własne rozmiary papieru** z okna drukowania macOS albo z Windows („Właściwości serwera wydruku”) są na górze listy. Wiele drukarek etykiet drukuje stabilnie tylko na takim rozmiarze.
- **★** oznacza rozmiar ostatnio używany dla tej drukarki w oknie drukowania macOS.
- **Kilka komputerów:** **Zapisz do pliku** i **Wczytaj z pliku** przenoszą wszystkie profile.

## Drukowanie

| Skąd jest etykieta | Co zrobić |
| --- | --- |
| PDF otwarty w karcie | Ikona wtyczki → **Drukuj PDF z tej karty** |
| Link do PDF-a | Prawy przycisk na linku → **Intelligent label printing → Drukuj: (profil)** |
| Bez myszki | Skrót **Alt+Shift+P** |
| Plik pobrany przed chwilą | Okienko wtyczki → **Drukuj** przy pliku |
| Plik na dysku | **Otwórz plik z dysku…** albo przeciągnij plik na stronę podglądu |

**Podgląd** pokazuje wynik przed wydrukiem. **Automatyczny druk** (w ustawieniach) drukuje PDF-y pobrane z podanych stron.

## Najczęstsze problemy

- **Drukarka miga na czerwono i nic nie drukuje:** rozmiar nośnika nie pasuje do załadowanej rolki. Wybierz własny rozmiar, którego używasz w systemowym oknie drukowania.
- **Etykieta w kilku kawałkach albo obrócona i powiększona:** wybrano taśmę ciągłą zamiast naklejek wycinanych. Wybierz rozmiar odpowiadający naklejkom.
- **Ucięte brzegi:** zwiększ *Margines wewnątrz pola etykiety* albo ustaw *Skalowanie po stronie drukarki* na *Dopasuj do strony*.
- **„Brak hosta”:** program pomocniczy nie jest zainstalowany albo Chrome go nie widzi. Strona ustawień pokazuje dokładny błąd i podpowiedź.
- **Wycięto za dużo albo za mało:** zmień *Tryb przycinania* w profilu.

Błędy i pomysły zgłaszaj na [GitHubie](https://github.com/kepak1/intelligent-label-printing/issues).
