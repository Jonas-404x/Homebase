# Minecraft-Server, Teil 1: Einrichten, Konsole, Mods

Stand: 2026-11-28. Roadmap-Teil 5 von Mainframe, erster Abschnitt.

## Worum es geht

Jonas will auf seinem neuen Server (Ubuntu 24.04, 4 Kerne, 7,6 GB RAM) so schnell wie möglich Minecraft spielen, und zwar mit einem Panel, das sich anfühlt wie bei einem gemieteten Server. Dieser erste Abschnitt macht den Minecraft-Tab von „Kommt bald“ zu einer echten Seite: Server einrichten, starten/stoppen, Live-Konsole mit Befehlen und eigene Mods per Drag & Drop. Heute soll er mit Freunden im Heimnetz darauf spielen können.

Erfolg heißt: Jonas richtet den Server im Minecraft-Tab ein, startet ihn, sieht die Konsole, tippt `/op`-artige Befehle ein, zieht ein paar Mods rein und joint über `192.168.0.177:25565`.

## Ziele (dieser Abschnitt)

1. **Einrichten im Minecraft-Tab** (eigenes Formular, nicht das allgemeine Install-Sheet):
   - Server-Typ: **Paper** oder **Fabric** (Java Edition).
   - Version: Liste aller Release-Versionen von Mojang, vorausgewählt die neueste (heute 26.3).
   - RAM: 2–6 GB, Standard 4 GB.
   - Haken „Spar-Mods vorinstallieren“ (nur bei Fabric, Standard an): Fabric API, Lithium, FerriteCore, Krypton von Modrinth.
   - Haken „Ich akzeptiere die Minecraft-EULA“ (Link zur EULA), Pflicht. Ohne Haken kein Einrichten.
2. **Server-Seite** nach dem Einrichten:
   - Status (läuft / startet / gestoppt / Fehler) mit Start, Stopp, Neustart.
   - Adresse im Heimnetz (`<LAN-IP>:<Port>`) mit Kopier-Knopf, dazu Typ und Version.
   - **Live-Konsole**: Server-Log live, Eingabefeld für Befehle (ohne führenden `/`, ein `/` wird entfernt), Antwort des Servers wird angezeigt, Befehlsverlauf mit Pfeil hoch/runter (im Browser gemerkt).
   - **Mods bzw. Plugins**: Liste der `.jar`-Dateien (Name, Größe), Hochladen per Drag & Drop auf die Karte oder per „Datei auswählen“ (mehrere auf einmal), Löschen pro Datei. Hinweis „Wird beim nächsten Neustart aktiv“ mit Neustart-Knopf, sobald sich etwas geändert hat.
   - **Einstellungen ändern**: Typ, Version, RAM, Spar-Mods. Speichern erzeugt den Container neu, die Welt bleibt. Warnhinweis: Mods müssen zur neuen Version/zum Typ passen; beim Typwechsel liegen die alten Dateien im anderen Ordner (`mods` vs. `plugins`) und bleiben unangetastet.
   - Entfernen läuft wie bisher über die Apps-Seite.
3. Minecraft taucht weiter in Apps-Liste, Übersicht, Status, Diagnose und Server-Monitor auf (kommt durch den Katalog automatisch).

## Nicht-Ziele (dieser Abschnitt, kommen in eigenen PRs)

- playit.gg (öffentliche Adresse für Freunde von außerhalb). Nächster PR, möglichst noch heute.
- Welten: neue erzeugen mit Seed, `.zip` hochladen, wechseln.
- Spieler mit Skins, Statistiken, Troll-Knöpfe (Sounds, Teleport …), Chat.
- Einstellungs-Editor für `server.properties`, Gamerules, Server-Icon.
- Backups und Zeitpläne.
- Mod-Browser/Modrinth-Suche in Mainframe (Jonas: übertrieben).
- Bedrock/Geyser, Forge/NeoForge, mehrere Minecraft-Server.

## Anti-Ziele

- Ein Stopp zerstört die Welt (Container wird hart gekillt, bevor gespeichert ist).
- Mainframe-Absturz reißt den Minecraft-Server mit (bleibt Container mit `restart: unless-stopped`).
- RCON oder Konsole sind ohne Login erreichbar oder aus dem Netz offen.
- Upload erlaubt Pfade außerhalb des Mod-Ordners.

## Rahmenbedingungen

- Repo ist öffentlich: keine echten IPs, Passwörter oder Pfade in Code, Tests oder Doku (Beispiele mit 192.168.1.x).
- UI-Text Deutsch, Code-Kommentare wie im Rest des Repos Deutsch, Doku/Commits/PR Englisch.
- Muss im Dev-Modus auf Windows mit Docker Desktop laufen und testbar sein.
- RAM-Budget: Minecraft-Heap Standard 4 GB, Mainframe bleibt klein.

## Ansätze

| | Ansatz | Abwägung |
|---|---|---|
| **A** ✅ gewählt | Katalog-App `minecraft` + eigene Minecraft-Seite und kleines Server-Modul (`apps/server/src/minecraft/`) | Installieren, Start/Stopp, Logs, Absturz-Erkennung, Status und Monitor gibt es schon. Neu sind nur Befehle, Mods, Einstellungen-Ändern. Am wenigsten Code, heute schaffbar, spätere Teile bauen darauf auf. |
| B | Eigener Minecraft-Bereich komplett neben dem Katalog | Mehr Freiheit, aber Start/Stopp/Logs/Status doppelt. Ein Tag mehr ohne sichtbaren Nutzen. |
| C | Nur Katalog-Eintrag ohne eigene Seite | Eine Stunde, aber kein Hoster-Gefühl. Verworfen. |

Jonas hat **A** gewählt.

## Bauweise

### Katalog-Eintrag `catalog/minecraft/`

- Image `itzg/minecraft-server` (wählt Java selbst passend zur Version). Daten nach `${app.dataDir}:/data` (Bind-Mount, damit Mainframe Mods direkt in `mods/` bzw. `plugins/` schreiben kann).
- Felder (alle `string`/`boolean`/`secret` wie bisher): `serverType` (`PAPER`|`FABRIC`), `version`, `memory` (z. B. `4G`), `perfMods` (boolean), `rconPassword` (secret, wird erzeugt), `eula` (muss `true` sein), `modrinthProjects` (abgeleitet, siehe unten).
- Umgebung: `EULA=TRUE` (nur nach Jonas' Haken), `TYPE`, `VERSION`, `MEMORY`, `RCON_PASSWORD`, `MODRINTH_PROJECTS`, `ENABLE_RCON=true`, `CREATE_CONSOLE_IN_PIPE` nicht nötig.
- Port `game` 25565/tcp. RCON-Port wird **nicht** veröffentlicht.
- `stop_grace_period: 90s`, damit der Server beim Stopp die Welt speichert.

### Erweiterungen im App-Engine (generisch, für alle Apps nutzbar)

- `AppHook.prepare(values) => values`: läuft vor dem Rendern (beim Installieren und beim Ändern). Minecraft prüft hier Eingaben (Typ, Versionsformat, RAM 2–6 GB, EULA) und leitet `modrinthProjects` ab (Fabric + Haken → `fabric-api,lithium,ferrite-core,krypton`, sonst leer). Fehler sind `MainframeError` mit deutschem Satz und kommen vor dem Anlegen von Ordnern.
- `engine.reconfigure(id, input)`: alte Werte + neue Eingaben → `prepare` → Compose neu rendern → speichern → `compose up -d` (erzeugt den Container neu). Geheime Felder (RCON-Passwort) bleiben erhalten. Schlägt `up` fehl, werden alte Compose-Datei und Werte wiederhergestellt und neu gestartet.
- `ComposeRunner.exec(dir, service, args)`: `docker compose exec -T <service> …`, gibt stdout zurück.

### Server-Modul `apps/server/src/minecraft/`

- `GET /api/minecraft/versions`: Release-Versionen aus dem Mojang-Manifest (`piston-meta.mojang.com`), eine Stunde zwischengespeichert. Ohne Internet: Fehler mit Satz; die Seite bietet dann ein Freitextfeld.
- `GET /api/minecraft/info`: LAN-Adresse (`lanSubnet().self` + Port), Typ, Version, RAM, Spar-Mods.
- `POST /api/minecraft/command` `{ command }`: über `rcon-cli` im Container (`compose exec`). Nur wenn der Server läuft, sonst Satz „Der Server läuft gerade nicht.“ Antwort-Text zurück. Befehl max. 1000 Zeichen, keine Zeilenumbrüche.
- `GET /api/minecraft/mods`, `PUT /api/minecraft/mods/:name` (Body `application/octet-stream`, max. 100 MB), `DELETE /api/minecraft/mods/:name`. Ordner `mods/` bei Fabric, `plugins/` bei Paper. Dateiname nur `^[A-Za-z0-9._+() -]+\.jar$`, kein `..`; vorhandene Datei wird überschrieben.
- `PUT /api/minecraft/settings`: ruft `engine.reconfigure`.
- Alles hinter dem bestehenden Login (Auth-Guard). Aktionen landen im Ereignis-Log.

### Web `apps/web/src/pages/Minecraft.tsx` (+ Komponenten)

- Nicht installiert: Einrichten-Karte wie oben. Während der Installation (Image-Download, erster Start dauert Minuten) Hinweis „Lädt Minecraft herunter …“.
- Installiert: Kopf mit Status-Badge und Knöpfen, Adress-Karte, Konsole (nutzt das bestehende `subscribe-logs` über den WebSocket), Mods-Karte, Einstellungen als Dialog.
- Gestaltung im bestehenden Mainframe-Stil (Karten, Badges, Akzentfarbe), Kontrast-Check grün, Handy-tauglich.

## Entscheidungen aus der Builder-Prüfung (Claudes Calls)

- **Dateirechte**: itzg läuft als UID/GID 1000. Mainframe läuft auf dem Server als root. Nach dem Schreiben einer Mod-Datei setzt Mainframe unter Linux den Besitzer auf den Besitzer des Datenordners (`/data` gehört nach dem ersten Start 1000:1000). Unter Windows entfällt das.
- **Spar-Mods ohne passende Version**: `prepare` fragt Modrinth (`/v2/project/<id>/version` mit Version und Loader `fabric`). Nur Mods mit passendem Build kommen in `MODRINTH_PROJECTS`. Fehlt einer, zeigt die Seite das an („Krypton gibt es für 26.3 noch nicht“). Ohne Internet: Spar-Mods weglassen, mit Hinweis. Fabric API ist Pflicht, wenn irgendein Spar-Mod dabei ist.
- **Downgrade**: Eine ältere Version als die aktuelle lehnt `reconfigure` mit einem Satz ab: „Ältere Versionen können deine Welt kaputt machen.“ Die Reihenfolge kommt aus dem Mojang-Manifest.
- **Gestoppt bleibt gestoppt**: War der Server von Jonas angehalten, folgt auf `up` direkt `stop`, und `stoppedByUser` bleibt. Lief er, läuft er danach mit den neuen Werten.
- **Übrig gebliebene Jars**: Beim Abwählen der Spar-Mods oder beim Wechsel Fabric → Paper bleiben die Dateien liegen. Sie stehen in der Mod-Liste und lassen sich von Hand löschen (beim Typwechsel im alten Ordner, also unsichtbar und unschädlich).
- **Port**: Katalog-Port `game`, Standard 25565 (Dev ebenfalls). Das Formular zeigt ihn nicht, `info` liest den gespeicherten Wert.

## Dem Builder überlassen

- Genaue Aufteilung in Komponenten und Dateien, Texte im Detail.
- Wie viele Log-Zeilen die Konsole hält (Vorschlag: 1000).
- Ob die Befehlsantwort als eigene Zeile in der Konsole erscheint oder separat.
