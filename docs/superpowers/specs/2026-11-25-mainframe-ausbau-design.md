# Mainframe – Ausbau (Design)

Stand: 2026-11-25. Ergänzt `2026-11-23-mainframe-design.md`. Wo sich beide widersprechen, gilt dieses Dokument.

## Worum geht's und warum

Teil 1 (Grundgerüst) steht: Login, Live-Übersicht, App-Katalog, AdGuard, Befehlspalette, Windows-Autostart. Jonas will Mainframe jetzt deutlich ausbauen. Es soll sich hochwertig anfühlen: viele Einstellungen, schöner, mehr Funktionen.

Geändert gegenüber dem alten Design:

- **Mainframe ist nur für Jonas.** Keine Registrierung, keine zentrale Website, kein öffentliches Release. Alles bleibt kostenlos.
- Der Abschnitt „Veröffentlichung und Sicherheit“ im alten Design entfällt bis auf die Sicherheitsregeln.

Erfolg heißt:

- Jonas öffnet Mainframe am PC und am Handy (als App auf dem Home-Bildschirm).
- Er sieht auf einen Blick, ob alle Dienste laufen, und kann fast alles am System über die Einstellungen steuern.
- Er bekommt eine Nachricht aufs Handy, wenn etwas ausfällt.
- Der Server-Speicher taucht am Main-PC im Explorer auf.
- Den Server kann er vom Main-PC aus ein- und ausschalten.

## Reihenfolge (Teile)

Jonas: „Mir ist egal, womit du anfängst, du sollst eh alles machen.“ Die Reihenfolge ist deshalb Claudes Entscheidung. Jeder Teil ist ein eigener Plan und ein eigener Pull Request.

| Teil | Inhalt | Braucht den Server? |
|---|---|---|
| **2** | Einstellungen (viele, in Bereichen), Design-Überarbeitung, Handy-App (PWA) | nein |
| **2.1** | Rückmeldungen nach Teil 2: Übersicht aufräumen, Detailansicht mit großem Graphen, Tab-Effekt am Handy, Minecraft-Tab („Kommt bald“), erste neue Apps | nein |
| **3** | Startseite „Dienste“ mit Erreichbarkeits-Prüfung, Netzwerk-Scanner | nein |
| **4** | Umzug auf den Server: Setup-Skript, Tailscale, AdGuard fürs ganze WLAN, Netzwerkfreigabe im Explorer, Wake-on-LAN, Neustart/Herunterfahren | ja |
| **5** | Minecraft (wie im alten Design) | besser ja |
| **6** | Benachrichtigungen (Handy + Discord), automatische Sicherungen | teilweise |
| **7** | Discord-Bot (Status, Dienste starten/stoppen, Warnungen) | ja (läuft dort 24/7) |
| **8** | Mehr Apps im Katalog | nein |

Teil 4 wird vorgezogen, sobald der OptiPlex da ist.

## Teil 2: Einstellungen, Design, Handy-App (erledigt)

### Einstellungen

Grundsätze:

- **Viele Einstellungen, trotzdem gut auffindbar.** Apple rät eigentlich zu wenigen Einstellungen (`settings.md › Best practices`: „Minimize the number of settings you offer“). Jonas will ausdrücklich viele. Lösung: Jede Einstellung hat einen guten Standardwert, die Einstellungen sind in klar benannte Bereiche sortiert, und ein Suchfeld findet jede Einstellung.
- **Aufbau wie bei Apple:**
  - **Am Desktop:** links die Liste der Bereiche, rechts der gewählte Bereich mit gruppierten Zeilen.
  - **Am Handy:** zuerst die Liste der Bereiche, dann der Bereich als eigene Seite mit Zurück.
  - Der zuletzt geöffnete Bereich wird beim nächsten Öffnen wiederhergestellt (`settings.md › Desktop`: „Restore the most recently viewed pane“). `Strg+,` öffnet die Einstellungen.
- **Nur echte Einstellungen.** Jede Zeile funktioniert wirklich. Kein Platzhalter-Schalter, der nichts tut.
  - Ausnahme: Funktionen, die es nur auf dem Ubuntu-Server gibt (Freigabe, Herunterfahren, Tailscale). Sie stehen schon da, sind am Windows-PC aber ausgegraut und mit „Nur auf dem Server“ beschriftet.
- **App-spezifische Einstellungen bleiben in ihrem Bereich.** Was Minecraft betrifft, kommt in den Minecraft-Bereich, nicht in die allgemeinen Einstellungen (Jonas: „nicht spezifisch für Minecraft … sondern allgemeine Einstellungen zum ganzen System“).
- **Gefährliches braucht Bestätigung:**
  - Alles, was Daten löscht oder den Server abschaltet, öffnet einen Dialog mit „Abbrechen“.
  - Bei besonders folgenreichen Aktionen muss man zusätzlich das Passwort eingeben: Netzwerkfreigabe aus, alles zurücksetzen, Herunterfahren.

Bereiche und Inhalte:

1. **Allgemein**
   - Gerätename: erscheint in der Seitenleiste, im Browser-Tab und am Handy.
   - Startseite beim Öffnen: Übersicht, Dienste oder Apps.
   - Zeitzone.
   - Sprache bleibt Deutsch, deshalb keine Einstellung dafür.
2. **Konto & Sicherheit**
   - Benutzername ändern, Passwort ändern.
   - **Angemeldete Geräte:** Browser/Gerät, zuletzt aktiv. Einzeln abmelden oder „alle anderen abmelden“.
   - Wie lange „Angemeldet bleiben“ gilt: 7, 30 oder 90 Tage.
   - **Anmelde-Protokoll:** die letzten 50 erfolgreichen und fehlgeschlagenen Anmeldungen mit Zeit und IP.
3. **Darstellung**
   - **Akzentfarbe:** 6 Vorgaben, alle in hell und dunkel auf mindestens 4,5:1 Kontrast geprüft.
   - **Dichte:** normal oder kompakt.
   - **Aktualisierung der Live-Werte:** 1, 2 oder 5 Sekunden.
   - **Einheiten:** GB oder GiB. Netzwerk in MB/s oder Mbit/s.
   - Hell/Dunkel folgt weiter dem Gerät, ohne eigenen Schalter (`dark-mode.md`: „Avoid offering an app-specific appearance setting“).
4. **Übersicht**
   - Welche Karten erscheinen und in welcher Reihenfolge: CPU, RAM, Speicher, Temperatur, Netzwerk, Laufzeit, AdGuard.
   - **Warnschwellen:** RAM %, Speicher %, Temperatur °C. Ab da wird die Karte gelb bzw. rot, und in Teil 6 kommt eine Benachrichtigung.
   - Verlauf der Live-Werte: wie lange zurück die Diagramme reichen (15 min, 1 h, 6 h).
5. **Netzwerk**
   - Hostname, IP-Adressen, Port von Mainframe (nur Anzeige).
   - **„Am Handy öffnen“:** ein QR-Code mit der Adresse von Mainframe im WLAN.
   - Tailscale-Status (nur auf dem Server).
   - **Netzwerkfreigabe** (Teil 4, siehe unten).
6. **Docker & Apps**
   - Docker-Status und Version.
   - **Speicherverbrauch** von Images, Containern und Volumes.
   - **„Aufräumen“:** unbenutzte Images und Build-Reste entfernen. Mit Bestätigung, die vorher zeigt, wie viel frei wird.
   - Ob Apps nach einem Absturz automatisch neu starten (Standard an).
7. **System**
   - Mainframe-Version, Laufzeit, Speicherort der Daten.
   - **Protokoll** von Mainframe live ansehen.
   - **Neustart / Herunterfahren** des Servers (Teil 4, nur auf dem Server).
   - **Wake-on-LAN-Info:** MAC-Adresse, Status (Teil 4).
8. **Sicherung & Zurücksetzen**
   - **Einstellungen exportieren und importieren:** eine Datei ohne Passwort-Hashes und ohne Sitzungen.
   - Automatische Sicherungen kommen in Teil 6 dazu.
   - **„Mainframe zurücksetzen“:** mit Passwort. Installierte Apps bleiben laufen.
9. **Über Mainframe**
   - Version, Link zum GitHub-Projekt, Änderungsprotokoll (CHANGELOG), verwendete Open-Source-Bausteine.

Benachrichtigungen (Teil 6) und Netzwerk-Scanner (Teil 3) bekommen eigene Bereiche, sobald es sie gibt.

### Design-Überarbeitung

- **Grundhaltung bleibt:** ruhig, schick, „gut aussehen, aber nicht übertrieben fancy“. Der Inhalt ist die Farbe.
- **Neu: Verlaufsdiagramme.**
  - CPU, RAM und Netzwerk bekommen in der Übersicht eine kleine Kurve der letzten Minuten.
  - Der Verlauf wird serverseitig im Speicher gehalten, damit die Kurve beim Öffnen sofort da ist.
  - Mainframe soll trotzdem unter ~150 MB RAM bleiben.
- **Das Erkennungsmerkmal** wird beim Bauen mit dem apple-design-Skill festgelegt. Vorgabe: ein einziges markantes Element, alles drumherum zurückhaltend (`branding.md`). Bis zu Minecraft (Teil 5) sind das die Live-Kurven der Übersicht.
- **Handy:**
  - Navigation als Tab-Leiste unten.
  - Sichere Bereiche (Notch, Home-Balken) werden respektiert.
  - Touch-Ziele mindestens 44 px.
- **Ablauf:**
  - Vor dem Umbau: ein Design-Review der aktuellen Oberfläche nach dem apple-design-Skill.
  - Danach: Token-Plan mit Farben, Schrift, Abständen und Kontrastwerten.
  - Dann der Umbau.
  - Am Ende: Kontrast, Tastatur-Fokus, „Bewegung reduzieren“ und große Schrift prüfen.

### Handy-App (PWA)

- In Safari über „Teilen → Zum Home-Bildschirm“ wird Mainframe eine App:
  - eigenes Symbol (das Eisblau-Logo),
  - startet ohne Browser-Leiste,
  - dunkle Statusleiste.
- **Ohne Internet-Verbindung zum Server** zeigt die App eine verständliche Seite statt eines weißen Bildschirms.
- **Einschränkung:** Echte Offline-Funktion und Push-Nachrichten brauchen HTTPS. Das kommt mit Tailscale in Teil 4. Im WLAN über `http://` klappt der Home-Bildschirm trotzdem.

### Ergänzungen von Jonas (2026-11-25)

- **Logo auf dem Home-Bildschirm.** Das Mainframe-Logo (Eisblau) muss auf dem iPhone-Home-Bildschirm erscheinen: `apple-touch-icon` 180 × 180 ohne Transparenz, App-Name „Mainframe“. Das ist ihm wichtig.
- **Handy wie eine echte App.**
  - Mainframe ist durchgehend fürs Handy optimiert: Tab-Leiste unten, keine abgeschnittenen Inhalte, keine waagerechte Scrollleiste.
  - Dezente Animationen: kurzer Übergang beim Wechsel der Bereiche, sanftes Einblenden von Inhalten, eine Rückmeldung beim Antippen der Tabs.
  - Nicht überladen, kurz (≤ 250 ms). Bei „Bewegung reduzieren“ aus.
- **Kein Aufploppen beim Laden.**
  - Daten, die sicher kommen (Leistungswerte der Übersicht), bekommen ihre Karten **sofort in fester Größe**.
  - Statt Wert und Balken zeigt die Karte bis dahin einen animierten Ladebalken bzw. Platzhalter-Schimmer.
  - Dann wird nur der Inhalt ausgetauscht, ohne dass sich das Layout verschiebt.
  - Das deckt sich mit Apple (`loading.md`: „consider showing placeholder text, graphics, or animations as content loads“).
  - Kommt nach ein paar Sekunden nichts, steht in der Karte ein verständlicher Fehler.
- **Keine Platzhalter für Dinge, die es noch nicht gibt.**
  - Der Minecraft-Tab („Kommt bald“) fliegt raus, bis Teil 5 ihn mit echtem Inhalt füllt.
  - Ladeplatzhalter gibt es nur für Daten, die wirklich unterwegs sind.
- **Minecraft (Teil 5):** Eine **Live-Konsole** mit Befehlseingabe ist Pflicht (steht schon im alten Design: Live-Log, Befehle senden, Verlauf mit Pfeiltasten).

## Teil 2.1: Rückmeldungen von Jonas nach Teil 2 (2026-11-25)

Jonas fand die Einstellungen und die Ladeanimation „deutlich hochwertiger“. Das soll so bleiben. Geändert werden soll:

- **Übersicht nur für Systemwerte:**
  - Der Werbeblocker (AdGuard-Karte) gehört nicht zwischen die PC-Werte. Er zieht in eine eigene Zeile darunter (Überschrift „Dienste“) bzw. später auf die Dienste-Seite aus Teil 3.
  - Karten in einer Reihe sind gleich hoch, aber nicht künstlich gestreckt: „Netzwerk“ und „Läuft seit“ waren viel zu groß, weil die Reihe sich nach der AdGuard-Karte richtete.
- **Kleine Kurven auf den Karten:**
  - Zeigen nur die **letzte Minute**, laufend von rechts nach links. Kein gequetschter Strich am rechten Rand mehr. Das war der „Grafikfehler“ auf Jonas' Screenshot: Der Zeitraum war 60 Minuten, es gab aber erst wenige Minuten Daten.
  - Solange weniger als eine Minute Daten da ist, füllt die Kurve nur den vorhandenen Teil, sauber am rechten Rand ausgerichtet.
- **Detailansicht per Klick:**
  - Klick (Linksklick, am Handy Tippen) auf Prozessor, Arbeitsspeicher oder Netzwerk öffnet eine Detailansicht: großer Graph mit Achsen und Zeitangaben, Min/Max/Durchschnitt, weitere Infos.
  - Beispiele: Prozessor mit Kernen, Takt und Last pro Kern; Arbeitsspeicher mit belegt/frei/Cache und Swap; Netzwerk mit Down- und Upload getrennt und Adapter.
  - Zeitraum der großen Kurve wählbar (15 Min., 1 Std., 6 Std., 24 Std.). Der Standard ist in Einstellungen → Übersicht einstellbar. Dafür speichert der Server den Verlauf 24 Stunden.
  - Am Computer als großes Fenster, am Handy als eigene Seite mit „Zurück“.
- **Handy: Tab-Effekt wie bei Android.** Beim Wechsel zwischen Übersicht, Apps und Einstellungen leuchtet hinter dem Symbol des aktiven Tabs eine helle, abgerundete Fläche („Pille“) auf, die beim Wechsel kurz einblendet (Material-Navigation-Bar-Stil, wie in der App „ScooterHacking Utility“). Bei „Bewegung reduzieren“ ohne Animation.
- **Minecraft-Tab wieder in die Navigation:** Er führt zu einer Seite „Kommt bald“ mit kurzer Vorschau, was kommt (Live-Konsole, Spieler, Welten, Backups). Das ist eine bewusste Ausnahme von „keine Platzhalter“: Jonas will den Tab sehen.
- **Mehr Apps im Katalog:** schon jetzt einige aus Teil 8 vorziehen (zum Beispiel Uptime Kuma, Jellyfin, Navidrome, Vaultwarden, Immich, Home Assistant, ntfy), jede mit sinnvollen Standardwerten.
- **Eigene Ideen von Claude** zum Mitbauen, wenn Jonas zustimmt (siehe Chat vom 2026-11-25): Prozess-Liste („was frisst gerade CPU?“), Speicherplatz-Warnung pro Laufwerk, „Seit wann läuft Mainframe“ in der Übersicht.

## Teil 3: Dienste-Startseite und Netzwerk-Scanner

- **Seite „Dienste“:** Kacheln aller Dienste auf dem Server.
  - Von Mainframe installierte Apps werden automatisch eingetragen.
  - Eigene Links kann man hinzufügen, zum Beispiel die Router-Oberfläche.
  - Jede Kachel: Symbol, Name, Adresse, Status (erreichbar / nicht erreichbar, als Text und Farbe), Antwortzeit.
- **Erreichbarkeits-Prüfung:**
  - Mainframe prüft jeden Dienst regelmäßig per HTTP oder TCP, Intervall einstellbar.
  - Es speichert einen 24-Stunden- und einen 7-Tage-Verlauf und zeigt die Verfügbarkeit in Prozent.
- **Netzwerk-Scanner:** listet alle Geräte im Heimnetz mit IP, MAC, Hersteller (aus der MAC) und Namen, wenn er ermittelbar ist.
  - Geräte bekommen einen eigenen Namen und eine Notiz („Inventar“).
  - Neue, unbekannte Geräte werden markiert.
  - Scan per Knopf und automatisch alle X Minuten.
  - Am Windows-PC funktioniert der Scan eingeschränkt, auf dem Server vollständig (ARP).

## Teil 4: Umzug auf den Server

Wie im alten Design (Setup-Skript für Ubuntu, Docker, Tailscale, `ufw`, AdGuard auf Port 53), dazu:

- **Netzwerkfreigabe im Explorer:**
  - Samba-Freigabe „Mainframe“ auf dem Server.
  - Am Main-PC erscheint sie als **Netzlaufwerk** (Laufwerksbuchstabe) im Explorer. Ein Skript für den Main-PC richtet das ein.
  - **Wie man sie schaltet:**
    - In den Einstellungen unter Netzwerk, und zwar nicht als einfacher Schalter, sondern als bewusster Vorgang (Jonas: „soll nicht so einfach auszustellen sein“).
    - Einschalten: über einen eigenen kleinen Assistenten mit eigenem Freigabe-Passwort.
    - Ausschalten: nur mit Mainframe-Passwort und Warnhinweis.
  - **Sicherheit:** Die Freigabe ist nur aus dem WLAN und über Tailscale erreichbar, mit Benutzer und Passwort.
  - Der Speicherplatz (frei/belegt) steht in der Übersicht.
- **Wake-on-LAN für den Server:**
  - Das Setup-Skript schaltet es auf dem Server ein. Im BIOS muss Jonas es einmal selbst aktivieren, mit Anleitung.
  - **Einschalten** vom Main-PC: Skript bzw. Verknüpfung „Server einschalten“, das das Weck-Signal schickt. Fürs Handy wird eine kostenlose Wake-on-LAN-App erklärt.
  - **Ausschalten / Neustart:** in Mainframe (Einstellungen → System) und als Skript am Main-PC.
  - Den Main-PC weckt Jonas weiter über seine WLAN-Steckdose. Kein doppeltes Wake-on-LAN dafür.
- **AdGuard fürs ganze WLAN:**
  - Die Vodafone Station erlaubt vermutlich keinen eigenen DNS-Server. Das wird geprüft, wenn der Server da ist.
  - Plan B: AdGuard übernimmt DHCP (Router-DHCP aus), oder man trägt den DNS pro Gerät ein.
  - Router-Einstellungen macht Jonas selbst, Claude gibt die Klick-Anleitung. Claude bekommt kein Router-Passwort.

## Teil 6: Benachrichtigungen und Sicherungen

- **Benachrichtigungen,** alles kostenlos:
  - **Handy:** über die App **ntfy** (kostenlos, läuft als Container auf dem Server, iPhone-App vorhanden). Funktioniert auch ohne HTTPS-PWA.
  - **Discord:** über einen Webhook.
  - **Auslöser:** Dienst nicht erreichbar, App abgestürzt, Warnschwelle erreicht, Sicherung fehlgeschlagen, neues unbekanntes Gerät im WLAN.
  - Jeder Auslöser einzeln ein/aus, dazu „Ruhezeiten“ (zum Beispiel nachts).
- **Sicherungen:**
  - Täglich automatisch: Mainframe-Daten und die Daten jeder App (zum Beispiel AdGuard-Einstellungen), auf die Server-SSD oder auf die Netzwerkfreigabe.
  - Die letzten N bleiben erhalten, N ist einstellbar.
  - Wiederherstellen per Knopf.

## Teil 7 und 8 (kurz)

- **Discord-Bot (7):**
  - Läuft als eigener Container auf dem Server, nutzt die Lese-API aus dem alten Design.
  - Für Starten/Stoppen bekommt er zusätzlich ein eigenes, widerrufbares Token mit Schreibrecht nur für diese Aktionen.
  - Befehle: `/status`, `/dienste`, `/start <app>`, `/stop <app>`. Warnungen kommen über Teil 6.
- **Mehr Apps (8):**
  - Jellyfin (Mediencenter), Immich (Fotos), Navidrome (Musik), Vaultwarden (Passwörter), Home Assistant, ntfy.
  - Jede App mit Katalog-Eintrag, Zugangsdaten-Anzeige und sinnvollen Standardwerten.

## Teil 9 (Idee von Jonas, 2026-11-25): Claude auf dem Server

- Claude Code wird auf dem Server installiert (Teil 4), damit Jonas Dinge erledigen kann, für die es keinen fertigen Knopf gibt.
- **Erster Schritt (Teil 4, kein eigener Bau):** Die eingebaute Fernsteuerung von Claude Code nutzen. Damit kann er eine Claude-Sitzung auf dem Server vom Main-PC oder aus der Claude-App am Handy steuern.
- **Später (Teil 9):** ein Bereich „Assistent“ in Mainframe:
  - Er schickt eine Frage an Claude Code auf dem Server (Kopf-loser Modus) und zeigt die Antwort live an.
  - Jede Aktion, die etwas verändert, braucht eine Bestätigung in Mainframe.
  - Läuft über Jonas' eigenes Claude-Abo, kein extra API-Schlüssel.
- **Was Claude dürfen soll (Jonas, 2026-11-25):** echte Server-Arbeit: Systemdaten auslesen, Programme installieren, Dienste einrichten und reparieren.
  - **Nur für Server-Sachen,** nicht für Aufsätze, Hausaufgaben oder Webseiten bauen.
  - Umsetzung: eine feste Rollen-Anweisung („Du bist der Admin dieses Servers, lehne alles ohne Server-Bezug ab“), eine Werkzeug-Liste nur mit Shell und Dateien im Server-Bereich, kein Web-Zugriff außer Paketquellen, Arbeitsordner auf den Server beschränkt.
  - Ehrlich gesagt: Eine Anweisung kann ein Sprachmodell nicht zu 100 % festnageln. Die harte Grenze sind die Werkzeuge und Ordner, nicht der Text.
- **RAM:** Claude Code braucht nur, während es arbeitet, grob einige hundert MB. Auf 8 GB passt das, nur nicht gleichzeitig mit einem voll ausgelasteten Minecraft-Server.

## Nicht-Ziele

- Mehrere Benutzer, Registrierung, zentrale Website, öffentliches Release.
- Bezahldienste jeder Art.
- Mainframe oder die Freigabe aus dem offenen Internet erreichbar machen.

## Anti-Ziele

- Einstellungen, die nichts tun oder nur so aussehen.
- Eine Einstellungsseite, auf der man nichts mehr findet.
- Die Netzwerkfreigabe ist versehentlich mit einem Klick aus.
- Der Server lässt sich von außerhalb des Heimnetzes oder ohne Tailscale steuern.

## Dem Builder überlassen

- Konkrete Farben, Schrift und Abstände (mit dem apple-design-Skill festlegen und mit Kontrastwerten belegen).
- Bibliothek für Diagramme und QR-Code.
- Speicherformat der neuen Einstellungen (vorhandene `settings`-Tabelle in SQLite).
- Genaue Scan-Technik des Netzwerk-Scanners.
