# Mainframe – Design

Stand: 2026-11-23

## Worum geht's und warum

Jonas hat einen gebrauchten Büro-PC als Heimserver bestellt: **Dell OptiPlex 3050 SFF, i5-7500 (4 Kerne, bis 3,8 GHz), 8 GB DDR4-2400, 256 GB SATA-SSD, Gigabit-LAN**. Empfohlenes späteres Upgrade: auf 16 GB RAM, plus HDD für Musik. Er will damit „was Geiles machen“ und das Ganze komfortabel vom Main-PC und vom Handy aus steuern, ohne für normale Aufgaben ein Terminal aufzumachen.

**Mainframe** ist das selbstgebaute Cockpit für diesen Server: eine Web-App, die auf dem Server läuft und mit der er Dienste per Klick installiert, startet, stoppt und beobachtet. Fertige Lösungen (CasaOS, Portainer, Umbrel) gibt es. Der Punkt hier ist, dass er es selbst baut, es so aussieht, wie er will, und es Dinge kann, die nur er braucht (z. B. eine API für seinen späteren Discord-Bot).

Erfolg heißt: Der Server läuft, Werbung im ganzen WLAN ist weg, ein Minecraft-Server für Freunde läuft, und alles davon ist aus Mainframe heraus bedienbar, auch per Handy von unterwegs.

## Ziele (Version 1)

1. **Dashboard**: CPU, RAM, Speicher, Temperatur, Uptime, Netzwerk, live aktualisiert.
2. **App-Katalog mit Ein-Klick-Installation** für:
   - **AdGuard Home** (Werbeblocker fürs ganze Netz). Muss in V1 drin sein.
   - **Minecraft-Server** (Paper). Muss in V1 drin sein.
   - **Navidrome** (eigener Musik-Server). „Eventuell“ laut Jonas, also mit rein, aber zuletzt.
   - **Eigener Container / Discord-Bot-Slot**: Mainframe kann einen eigenen Container (Image oder lokales Dockerfile-Verzeichnis) starten, damit der spätere Discord-Bot dort 24/7 laufen kann.
3. **App-Verwaltung**: Status, Start/Stop/Neustart, Entfernen, Live-Logs, Link zur Weboberfläche der App.
4. **Minecraft-Bereich auf dem Niveau eines gemieteten Servers** (Details im eigenen Abschnitt unten). Das ist das Herzstück, auf das sich Jonas am meisten freut.
5. **AdGuard-Widget**: Heute blockierte Anfragen, Schutz an/aus, plus Anleitung „Router-DNS auf den Server stellen“.
6. **Command-Palette** (`Strg+K`): Aktionen wie „Minecraft neustarten“ oder „AdGuard pausieren“ schnell ausführen.
7. **Lese-API mit Token**, damit der spätere Discord-Bot Server-Daten abfragen kann (Stats, App-Status, Minecraft-Spieler).
8. **Server-Setup-Skript**: Ein Skript, das auf frischem Ubuntu Server Docker, Tailscale und Mainframe einrichtet, plus Anleitung (Ubuntu installieren, Router-DNS, Tailscale anmelden).
9. **Handy-tauglich**: responsive, als PWA installierbar.

## Nicht-Ziele (V1)

- Remote-Desktop, Maus- oder Bildschirmsteuerung
- Backups vom Main-PC, Foto-Sync (Jonas hat iCloud)
- Medienzentrale (Jellyfin). Kommt vielleicht später als Katalog-Eintrag.
- Den Discord-Bot selbst schreiben. Das ist ein eigenes Projekt, V1 liefert nur Slot und API.
- Allgemeiner Dateimanager, Upload von Musik über Mainframe. Musik kommt in V1 per Netzwerkfreigabe oder Kopieren in den Musikordner. (Ausnahme: Welt-Upload und Server-Icon im Minecraft-Bereich.)
- Mehrere Minecraft-Server gleichzeitig (8 GB RAM reichen für genau einen).
- Mehrere Benutzer, Rollen
- Erreichbarkeit aus dem offenen Internet

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Mainframe oder der Docker-Socket ist aus dem Internet erreichbar.
- Stürzt Mainframe ab, gehen Minecraft, AdGuard usw. mit runter. Die Dienste müssen unabhängig weiterlaufen.
- Für normale Aufgaben muss Jonas doch wieder ins Terminal.
- Es sieht aus wie ein generisches Admin-Panel. Es soll sich anfühlen wie ein eigenes, schickes Produkt (wie seine Vextify-App).
- Mainframe frisst selbst so viel RAM, dass Minecraft auf 8 GB knapp wird.

## Minecraft-Bereich im Detail

Ziel laut Jonas: „so viele Funktionen, wie ein Server hat, den man für Geld mietet“, schön und übersichtlich, auch am Handy. Wichtig: **Alles Visuelle (Skins, 3D-Ansicht, Graphen) wird im Browser auf dem Main-PC bzw. Handy gerendert**, nicht auf dem Server. Der Server liefert nur Daten. Skins kosten den Server also null RAM.

**V1:**
- **Übersicht**: Status, öffentliche playit-Adresse mit Kopier-Knopf, Spieler online/max, TPS und MSPT (Paper-Befehl `tps`/`mspt` per RCON), RAM- und CPU-Verbrauch des Containers, Uptime, Start/Stop/Neustart.
- **Spieler**:
  - *Gerade online* und *Alle, die je drauf waren*, jeweils mit **Skin-Kopf**, Name, erster/letzter Besuch, Gesamtspielzeit, Anzahl Sessions.
  - Filter-Reiter: Alle, Online, Whitelist, Operatoren, Gebannt (Spieler und IPs). Suche nach Name oder UUID.
  - **Spieler-Detailseite** (Vorbild: Screenshots eines Hoster-Panels, die Jonas geschickt hat, bewusst abgespeckt):
    - Kopf: **3D-Skin-Ansicht** (drehbar, im Browser gerendert, z. B. skinview3d), Name, Online-Status, OP-Abzeichen.
    - **Aktivität**: Spielzeit der letzten 30 Tage als kleines Balkendiagramm, Platz in der Spielzeit-Rangliste, Session-Verlauf.
    - **Status**: Leben, Hunger, Erfahrungslevel (bei Offline-Spielern Stand beim Ausloggen).
    - **Standort**: aktuelle bzw. letzte Koordinaten mit Dimension, Respawn-Punkt, Kopier-Knopf, „Zu Spieler teleportieren“.
    - **Statistiken**: Spielzeit, gelaufene Strecke, Tode, Mob-Kills, Spieler-Kills, abgebaute/platzierte/hergestellte Blöcke, Top-Blöcke.
    - **Fortschritte**: Anteil freigeschalteter Advancements in Prozent, die letzten Highlights.
    - **Aktionen**: kicken, verwarnen (Nachricht auf dem Bildschirm), bannen/entbannen, IP bannen, OP geben/nehmen, Whitelist, Spielmodus (Überleben/Kreativ/Abenteuer/Zuschauer), Troll-Knöpfe für genau diesen Spieler.
  - **Wartungsmodus**: ein Schalter. Whitelist wird auf „nur OPs“ beschränkt, alle anderen werden mit Nachricht gekickt. Beim Ausschalten wird der alte Stand wiederhergestellt.
  - Datenquellen, alle ohne Plugin: Mainframe liest das Server-Log mit (Join/Leave/Chat) und speichert die Session-Historie selbst. Statistiken und Fortschritte kommen aus den Vanilla-Dateien der Welt (`stats/<uuid>.json`, `advancements/<uuid>.json`), Status und Standort aus `playerdata/<uuid>.dat` (NBT) bzw. bei Online-Spielern live per RCON (`data get entity`). Skins kommen per UUID von einem öffentlichen Skin-Dienst (z. B. mc-heads.net) direkt in den Browser.
  - **Bewusst nicht in V1** (aus den Hoster-Screenshots): Inventar-Ansicht (braucht Item-Grafiken), „Auf Karte finden“ (braucht eine Web-Karte wie BlueMap, die viel RAM kostet), Weltänderungen „wer hat hier abgebaut?“ (braucht das CoreProtect-Plugin), Fähigkeiten wie Fliegen/Gottmodus und Stummschalten (gehen in Vanilla nicht ohne Plugin), Moderations-Akte mit Notizen. Kandidaten für Phase 2.
- **Troll- und Spaß-Knöpfe** (Ziel: ein Spieler oder alle):
  - Fertige Knöpfe, z. B. Creeper-Zischen hinter dem Spieler, Ghast-Schrei, Donner, Blitz neben dem Spieler (ohne Schaden), Titel-Nachricht mitten auf dem Bildschirm, kurz in die Luft schweben lassen, Fake-Explosionsgeräusch.
  - **Eigene Knöpfe**: Jonas kann eigene Befehle als Knopf speichern, mit Platzhalter `{player}`, Name und Emoji.
- **Chat**: Ingame-Chat live mitlesen, Nachrichten als „[Server]“ schreiben.
- **Konsole**: Live-Log, Befehle senden, Befehls-Verlauf mit Pfeiltasten.
- **Welt**:
  - **Eigene Map hochladen** (ZIP). Vorher wird automatisch ein Backup der aktuellen Welt gemacht.
  - Aktuelle Welt herunterladen.
  - Backups: Liste, „Backup jetzt“, wiederherstellen, löschen (Automatik täglich, die letzten 7 bleiben).
  - Neue Welt erzeugen (optional mit Seed).
- **Plugins**: Paper-Plugins über die Modrinth-API suchen, installieren, aktualisieren, entfernen. Hinweis, dass jedes Plugin etwas RAM kostet.
- **Einstellungen**: freundlicher Editor statt rohem `server.properties` (Schwierigkeit, Spielmodus, PvP, Sichtweite, Simulationsweite, MOTD, max. Spieler, Spawn-Schutz, Whitelist an/aus), wichtige Gamerules als Schalter (z. B. keepInventory, doDaylightCycle, Mob-Griefing), Minecraft-Version, RAM-Zuteilung, **Server-Icon hochladen**.
- **Zeitpläne**: tägliches Backup (Standard an), optionaler täglicher Neustart mit Ingame-Vorwarnung.

**Phase 2 (nach V1):**
- **Discord-Chat-Brücke**: Ingame-Chat landet in einem Discord-Channel, Discord-Nachrichten erscheinen ingame mit Discord-Abzeichen davor. Ob das über ein fertiges Plugin (DiscordSRV) oder über Jonas' eigenen Discord-Bot läuft, wird mit dem Discord-Bot-Projekt entschieden.
- Dateimanager für den Server-Ordner, Mods/Modpacks (Fabric/Forge).

**RAM**: Alles in V1 kostet auf dem Server praktisch nichts zusätzlich (Log mitlesen, RCON-Befehle, eine kleine Datenbank). Nur installierte Plugins verbrauchen Minecraft-RAM, das zeigt Mainframe an.

## Aussehen (Design-Richtung, angelehnt an Apples Human Interface Guidelines)

Jonas' Vorgabe: gut aussehen, aber nicht übertrieben fancy.

- **Grundhaltung**: ruhiges, aufgeräumtes Werkzeug. Die Inhalte sind die Farbe, allen voran die **Spieler-Skins**. Sie sind das Erkennungsmerkmal von Mainframe, alles drumherum bleibt zurückhaltend (`branding.md`: „Ensure branding always defers to content“).
- **Hell/Dunkel**: folgt der Systemeinstellung, dunkel wird zuerst gestaltet. Keine eigene Umschaltung in der App (`dark-mode.md`: „Avoid offering an app-specific appearance setting“).
- **Farben**: kleine Palette aus benannten Rollen statt fester Werte: Hintergrund, erhöhte Fläche, Text, Nebentext, **eine** Akzentfarbe für Hauptaktionen, Status grün/gelb/rot. Status steht immer zusätzlich als Text oder Symbol da, nie nur als Farbe. Text-Kontrast mindestens 4,5:1.
- **Schrift**: System-Schrift des Geräts (Segoe UI auf Windows, SF auf iPhone), Monospace nur für Konsole und Zahlenwerte. Hierarchie über Größe und Gewicht, keine Deko-Schriften.
- **Navigation**: am Desktop eine Seitenleiste (Übersicht, Apps, Minecraft, Einstellungen), am Handy dieselben Bereiche als Tab-Leiste unten. Tabs navigieren nur. Aktionen wie Start/Stop sitzen in einer Werkzeugleiste des jeweiligen Bereichs (`tab-bars.md`: „Use a tab bar to support navigation, not to provide actions“).
- **Übersichtlichkeit**: Details erst auf Nachfrage (Spieler-Detailseite, aufklappbare Bereiche) statt alles auf einmal (`layout.md`: progressive disclosure).
- **Bedienbarkeit**: Touch-Ziele am Handy mindestens 44 × 44 px, sichtbarer Tastatur-Fokus am Desktop, „Bewegung reduzieren“ wird respektiert. Animationen nur kurz und sparsam.
- **Kein** Glas-/Blur-Overkill, keine Neon-Gradients, kein generisches Admin-Template.

## Rahmenbedingungen

- **Hardware**: 4 Kerne, 8 GB RAM, 256 GB SSD. RAM-Budget grob: Linux + Docker ~1 GB, Minecraft 3–4 GB Heap, Rest < 0,5 GB. Mainframe selbst sollte unter ~150 MB RAM bleiben. Die Minecraft-Backups gehen in V1 auf die SSD, die Anzeige zeigt deshalb den Platzverbrauch der Backups.
- **Server-OS**: Ubuntu Server 24.04 LTS (Windows fliegt runter).
- **Entwicklung vorerst auf dem Main-PC** (Windows 11, Docker Desktop 29, Node 24 vorhanden, kein WSL). Alles muss dort entwickel- und testbar sein, bevor der Server da ist. Abweichungen im Dev-Modus sind ok (z. B. Host-Stats zeigen die Docker-VM, AdGuard-DNS auf anderem Port).
- **Sprache der Oberfläche**: Deutsch, lockerer Ton.
- **Zugriff**: im LAN und über Tailscale. Kein Port-Forwarding.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **A** ✅ gewählt | **TypeScript-Web-App** (Node-Backend + React-Frontend), steuert Dienste über Docker | Stärkstes Ökosystem für Web-UI und Live-Daten, vom Handy nutzbar, Discord-Bot später in derselben Sprache. Neue Sprache gegenüber Vextify (C#). |
| B | C#/.NET-Backend + Web-Frontend | Jonas kennt C# von Vextify, aber dann zwei Sprachen und weniger fertige Bausteine für Docker und Live-Konsolen. |
| – | Windows-Desktop-App wie Vextify | Verworfen: am Handy nicht nutzbar. |
| – | CasaOS / Portainer nutzen | Verworfen: Jonas will selbst bauen. |

Jonas hat **A** gewählt.

## Entschiedene Bauweise

- **Alle Dienste laufen als Docker-Container**, jeder mit `restart: unless-stopped`, sodass sie ohne Mainframe weiterlaufen und nach einem Neustart des Servers von selbst hochkommen.
- **Mainframe selbst** ist ein Node-/TypeScript-Backend plus React-Frontend (Vite) und läuft auf dem Server ebenfalls als Container mit Zugriff auf den Docker-Socket. Im Dev-Modus auf Windows läuft es direkt mit Node gegen Docker Desktop.
- **Katalog = Vorlagen im Repo**: Jede App hat eine Beschreibung (Name, Icon, Beschreibung, einstellbare Felder, Ports) und eine Docker-Compose-Vorlage. „Installieren“ erzeugt daraus eine Compose-Datei im Datenordner und startet sie. Container werden per Label als „von Mainframe verwaltet“ markiert.
- **Minecraft** über das bewährte Image `itzg/minecraft-server` mit `TYPE=PAPER`. Befehle in die Konsole gehen über RCON.
- **AdGuard Home** als Container auf Port 53. Das Setup-Skript gibt Port 53 auf Ubuntu frei (systemd-resolved Stub-Listener aus). Das Widget nutzt die AdGuard-API.
- **Navidrome** als Container mit einem festen Musikordner auf dem Server.
- **Tailscale** läuft direkt auf dem Server (nicht im Container), eingerichtet vom Setup-Skript.
- **Login**: ein Admin-Passwort, beim ersten Start festgelegt, gehasht gespeichert, Session-Cookie. Die Discord-API nutzt separate Tokens, nur lesend.
- **Live-Daten** (Stats, Logs, Minecraft-Konsole) über WebSockets.

## Präzisierungen (Entscheidungen von Claude, von Jonas überprüfbar)

- **Installationsmechanik**: Das Mainframe-Image enthält die Docker-CLI mit Compose-Plugin (das kostet Image-Größe, kaum RAM). Installieren heißt: Compose-Datei nach `<DATA_ROOT>/apps/<app-id>/docker-compose.yml` schreiben, dann `docker compose up -d`. `DATA_ROOT` ist auf dem Server `/srv/mainframe`, und es ist im Mainframe-Container unter **demselben absoluten Pfad** gemountet, damit Bind-Mounts auf dem Host stimmen. Im Dev-Modus läuft Mainframe nativ mit Node auf Windows, und `DATA_ROOT` ist konfigurierbar (z. B. `C:\mainframe-data`).
- **Mainframe-Lebenszyklus**: Das Setup-Skript startet Mainframe über eine eigene Compose-Datei (`restart: unless-stopped`, **Host-Netzwerk**, damit Netzwerk-Stats und Temperaturen stimmen). Mainframe hört auf **Port 80** (`http://<server>/`). Updates von Mainframe laufen in V1 per Skript-Befehl (`mainframe update`), nicht aus der UI.
- **Sicherheit**: Der Docker-Socket wird direkt gemountet, das ist ein akzeptiertes Risiko, weil Mainframe nur im LAN und über Tailscale erreichbar ist. Das Setup-Skript richtet `ufw` ein: Port 80, 53, Navidrome und SSH nur aus dem LAN- und Tailscale-Netz. Kein Port-Forwarding für Mainframe.
- **HTTPS / PWA**: Über `tailscale serve` bekommt Mainframe eine HTTPS-Adresse im Tailnet. Dort ist die PWA installierbar. Im LAN reicht normales HTTP (ohne PWA-Installation).
- **AdGuard**: Mainframe schreibt beim Installieren eine Start-Konfiguration mit erzeugten Admin-Zugangsdaten (Wizard wird übersprungen), sodass das Widget sofort funktioniert. Die AdGuard-Weboberfläche läuft auf Port 3000. Die Anleitung erklärt eine feste IP für den Server (DHCP-Reservierung im Router) und dann den DNS-Eintrag.
- **Freunde-Zugang zu Minecraft über playit.gg** (Entscheidung von Jonas): Es soll sich anfühlen wie ein gemieteter Server. Freunde tragen eine feste Adresse (z. B. `xyz.joinmc.link`) in Minecraft ein und joinen, ohne irgendwas zu installieren. Umsetzung: Der playit-Agent läuft als eigener Container (offizielles Image `ghcr.io/playit-cloud/playit-agent`, Host-Netz). Im Minecraft-Panel gibt es einen Schritt-für-Schritt-Ablauf „Für Freunde freigeben“: Agent starten, den Claim-Link aus den Agent-Logs anzeigen, Jonas verknüpft ihn in seinem playit.gg-Konto und legt dort den Minecraft-Tunnel an, dann trägt er die öffentliche Adresse in Mainframe ein. Danach zeigt das Panel sie groß mit Kopier-Knopf. Whitelist ist standardmäßig an. Kein Port-Forwarding im Router.
- **Minecraft**: „Version“ ist eine Auswahl der Minecraft-Version. Upgrades sind erlaubt (mit Hinweis), Downgrades einer bestehenden Welt werden blockiert. Einstellungsänderungen erzeugen den Container neu (die Welt bleibt erhalten). **Welt-Backups**: Knopf „Backup jetzt“ plus automatisch täglich, die letzten 7 bleiben.
- **Eigene Container (Discord-Bot-Slot)**: Beliebig viele. Quelle ist entweder ein Docker-Image oder ein **Git-Repo-URL mit Dockerfile** (so schreibt Jonas den Bot am Main-PC, pusht auf GitHub und Mainframe baut ihn). Einstellbar sind Umgebungsvariablen (Geheimnisse wie der Bot-Token werden verdeckt angezeigt), Ports und ein Daten-Volume. Build-Logs sind live sichtbar. Ein Knopf „Neu bauen“ holt den neuesten Stand.
- **Lese-API**: unter `/api/v1/...` auf demselben Port. Tokens werden in den Mainframe-Einstellungen erstellt und widerrufen, es kann mehrere geben. Endpunkte: Stats, App-Liste mit Status, Minecraft-Status und Spieler. Eigene Container erreichen die API über das Host-Netz (`http://host.docker.internal` bzw. die Server-IP).
- **Dev-Modus**: Temperatur, Tailscale-Status und Port-53-Handling sind auf Windows nicht testbar und werden dort ausgeblendet. AdGuard-DNS läuft in Dev auf Port 5353. Das Setup-Skript wird getestet, sobald die Hardware da ist (optional vorher in einer Hyper-V-VM).

## Veröffentlichung und Sicherheit (Wunsch von Jonas, 2026-11-24)

Ziel: Mainframe ist am Ende fertige Software, die sich jeder von GitHub holen und auf **seinem eigenen** Server installieren kann. Wer sie herunterlädt, darf **auf keinen Fall** Zugriff auf Jonas' Server bekommen, und generell soll niemand von außen reinkommen.

- **Jede Installation ist eine eigene Insel.** Es gibt keinen zentralen Mainframe-Server, keine gemeinsamen Konten, kein „Nach-Hause-Telefonieren“. Der Code auf GitHub enthält keine Zugangsdaten, Adressen oder Schlüssel von Jonas. Wer ihn installiert, hat nur seinen eigenen Server mit seinem eigenen Passwort.
- **Verteilung:** Mainframe läuft auf einem Linux-Server, die Oberfläche im Browser. Deshalb gibt es statt einer `.exe` ein **GitHub-Release** mit einem fertigen Docker-Image (GitHub Container Registry) und einem **Ein-Zeilen-Installationsskript** für Ubuntu. Releases bekommen Prüfsummen. (Eine Windows-`.exe` wäre höchstens später ein optionaler Helfer, kein Muss.)
- **Erstes Einrichten absichern:** Solange kein Passwort gesetzt ist, verlangt die Einrichtung einen **einmaligen Einrichtungscode**, den nur der Besitzer sieht (Ausgabe des Installationsskripts bzw. Server-Log). So kann niemand anderes im WLAN schneller sein und sich das Admin-Konto schnappen. (Umsetzung in Teil 4.)
- **Nicht aus dem Internet erreichbar:** Das Panel ist nur im LAN und über Tailscale erreichbar (`ufw`, kein Port-Forwarding). playit.gg tunnelt **nur den Minecraft-Port**, nie das Panel.
- **Schutz im Code:** Passwörter mit scrypt gehasht, Login-Bremse (5 Versuche pro Minute), Session-Cookie `httpOnly` + `SameSite`, unter HTTPS zusätzlich `Secure`. Dazu (Teil 4): Origin-Prüfung bei allen schreibenden Anfragen (gegen CSRF), Sicherheits-Header (CSP, `X-Frame-Options`, `nosniff`), API-Tokens nur gehasht gespeichert, Abhängigkeiten automatisch auf Lücken geprüft (Dependabot bzw. `npm audit` in CI).
- **Die Grenze ehrlich benannt:** Mainframe steuert Docker und ist damit faktisch Admin auf dem Server. Deshalb bleibt es hinter LAN/Tailscale, und das Admin-Passwort ist der wichtigste Schlüssel.

## Dem Builder überlassen

- Konkrete Libraries (Web-Framework, Docker-Client, Stats-Library, UI-Kit), Projektstruktur, Speicherformat der Einstellungen
- Konkrete Farbwerte und Abstände im Rahmen des Abschnitts „Aussehen“ (beim Bauen mit dem apple-design-Skill gegenprüfen)
- Genaue Auswahl und Wirkung der fertigen Troll-Knöpfe
- Wie Host-Stats aus dem Container heraus gelesen werden (Host-Mounts o. Ä.)
- Reihenfolge der Umsetzung, solange Dashboard + AdGuard + Minecraft vor Navidrome und Custom-Container kommen
- Teststrategie
