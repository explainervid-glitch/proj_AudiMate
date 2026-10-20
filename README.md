# AudiMate

A panel extension (CEP) for **Adobe Animate** that lets you trim audio and drop it straight onto your timeline — built for voiceover and lip-sync work where you constantly cut a long recording into short clips.

> Load a recording → select the part you want on the waveform → save it as a WAV, or save **and** place it on the active layer at the current frame in one click.

## Demo



https://github.com/user-attachments/assets/9a87ab22-6706-4017-b55e-a0ac532e85bd



<!-- Inline player: edit this file on github.com, drag "AudiMate Demo.mp4" into
     the editor, and replace the bare URL above with the generated
     https://github.com/user-attachments/assets/... URL. Keep it as a bare URL
     on its own line (no markdown link syntax) so GitHub renders a player. -->

---

## Features

- **Import audio** by drag-and-drop or a file picker — `wav`, `mp3`, `ogg`, `m4a`, `aac`.
- **Waveform + time ruler** with an Audacity-style click-and-drag selection.
- **Playback controls** — play/pause, stop, and "play inside region" to loop-audition just your selection.
- **Zoom & navigate** — `Ctrl+Scroll` to zoom on the cursor, `Shift+Scroll` (or middle-mouse drag) to pan.
- **Rename** the cut before saving.
- **Save Audio Only** — writes a 16-bit PCM WAV of your selection next to the source file.
- **Save & Add To Layer** — writes the WAV *and* imports it into the Library, then places it on the active layer at the current playhead frame (same as a manual drag from the Library panel).
- **Session memory** — reopens with your last file, selection, and zoom restored.
- **Update check** — tells you when a newer version is available.
- **Usage reporting for zeploy** — counts imports and saves for the team's zeploy dashboard (see [Usage reporting](#usage-reporting)).

> Output is always a **16-bit PCM WAV**, even if the source was an MP3.

---

## Requirements

- **Adobe Animate 2022 or newer** (host `FLPR`, CSXS 9+).
- **Windows** (the installer is a Windows `.bat` / PowerShell script).

---

## Installation

1. **Download** the latest release from the [Releases page](https://github.com/explainervid-glitch/proj_AudiMate/releases), or clone/download this repository.
2. **Close Adobe Animate** if it's running.
3. **Run `install.bat`** (double-click it). It will:
   - Request administrator rights (needed to write into the Adobe CEP folder).
   - Copy the `AudiMate/` panel into Animate's extensions folder.
   - Enable unsigned-extension debug mode (`PlayerDebugMode`) so the panel loads.
4. **Open Adobe Animate** → **Window → Extensions → AudiMate**.

The panel installs to whichever exists:
`C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\AudiMate` (system), or
`%APPDATA%\Adobe\CEP\extensions\AudiMate` (per-user).

---

## Usage

1. **Load audio** — click **Import** or drag an audio file onto the panel.
2. **Select a region** — click and drag across the waveform to mark the part you want to keep. Drag the edge handles to fine-tune, or drag the middle to move the whole selection.
3. **Audition** — press **Space** to play/pause. Toggle **Region** to loop only inside your selection. **Ctrl+Space** restarts from the region start.
4. **Name it** — type a name in the **Rename** field (this becomes the WAV filename).
5. **Save** — choose one:
   - **Save Audio Only** — writes `<name>.wav` in the same folder as the source.
   - **Save & Add To Layer** — writes the WAV, imports it into the Library, and drops it on the **active layer at the current frame**. Position the timeline playhead and select the target layer *before* clicking.

**Keyboard & mouse:**

| Action | Shortcut |
|---|---|
| Play / pause | `Space` |
| Play from region start | `Ctrl + Space` |
| Zoom (on cursor) | `Ctrl + Scroll` |
| Navigate / pan | `Shift + Scroll` or middle-mouse drag |

> **Note:** if a file with the target name already exists in the folder, the save is **aborted** (it won't overwrite) — rename the cut and try again.

---

## Usage reporting

AudiMate counts how often it is used, for the team's zeploy dashboard: each
file loaded with **Import** or drag-and-drop ("import"; reopening the last
session does not count), each **Save Audio Only** ("save") and each **Save &
Add To Layer** ("add to layer"), with how long the save took, plus an error
when one of those fails. Every use appends one line to
`%LOCALAPPDATA%\zeploy\usage\com.zeus.audimate.jsonl`; the zeploy agent sends
daily totals to the admin app and deletes the file.

- Only the plugin id, version, event name and duration are written: no file
  names, paths or user names.
- Nothing is written on a PC without zeploy (no `%LOCALAPPDATA%\zeploy`
  folder), and AudiMate sends nothing over the network for this (the update
  check is separate).
- A save aborted because the file already exists is not counted.

`AudiMate/js/zeploy-usage.js` is zeploy's helper, copied unchanged; the
counting is in `js/main.js` (search for `zeployUsage`). The contract is
`docs/plugin-usage.md` in the zeploy repository.

### Installing with zeploy

`zeploy.json` lets the zeploy admin app install AudiMate the way
`install.bat` does, as `CEP\extensions\AudiMate`. In zeploy, add this repository
folder (`proj_AudiMate`, not the `AudiMate/` panel folder) under **Add package**.

---

## Updating

### As a user

When a newer version is available, an **"Update v… →"** pill appears next to the version number in the panel. Click it to open the Releases page, download the latest version, and run `install.bat` again (it replaces the previous install).

You can also just check the [Releases page](https://github.com/explainervid-glitch/proj_AudiMate/releases) manually at any time.

### As a developer / maintainer

The panel checks [`version.json`](version.json) in this repo on startup and compares it to the version baked into the code. To publish an update, bump the version in **four** places so they stay in sync:

1. **`AudiMate/js/main.js`** — `var CURRENT_VERSION = "x.y.z";`
2. **`AudiMate/CSXS/manifest.xml`** — `<Extension Id="com.zeus.audimate.panel" Version="x.y.z" />`
3. **`version.json`** (repo root) — `"version"`, plus a short `"notes"` line.
4. **`zeploy.json`** (repo root) — `"version"`.

The version zeploy's usage reporting sends is `CURRENT_VERSION`, so it needs no separate change.

Then:

```bash
git add -A
git commit -m "Release vX.Y.Z"
git push origin main
```

Then cut a **GitHub Release** so users have something to download (the `version.json` "url" points at the Releases page). **Do this only after the version bump is committed and pushed** — a release tags the latest pushed commit.

#### Step A — Build the download zip

The release asset must contain `install.bat` + `operator.ps1` + the `AudiMate/` folder, so users can extract and run the installer. From the repo root in **PowerShell** (replace the version):

```powershell
Compress-Archive -Path install.bat, operator.ps1, AudiMate -DestinationPath Builds\AudiMate-vX.Y.Z.zip -Force
```

The `Builds/` folder is gitignored, so the zip stays out of the repo — it lives only on the release.

#### Step B — Create the release

**Option 1 — GitHub website:**

1. Repo → **Releases** (right sidebar) → **Draft a new release**.
2. **Choose a tag** → type `vX.Y.Z` → **"Create new tag on publish"**.
3. **Release title:** `vX.Y.Z`.
4. **Description:** a short changelog (match the `notes` in `version.json`).
5. Drag `Builds\AudiMate-vX.Y.Z.zip` into the **"Attach binaries"** box; wait for the upload to finish.
6. Click **Publish release**.

**Option 2 — `gh` CLI (one command, after Step A):**

```bash
gh release create vX.Y.Z "Builds/AudiMate-vX.Y.Z.zip" --title "vX.Y.Z" --notes "What changed"
```

Once `version.json` on `main` reports the new version, every installed panel shows the update pill on next open.

> The raw `version.json` is served via GitHub's CDN, which caches for a few minutes — the pill may take a short while to appear after you push.

---

## Project structure

```
proj_AudiMate/
├── install.bat            # Installer launcher (run this)
├── operator.ps1           # Installer logic (self-elevating PowerShell)
├── version.json           # Update manifest checked by the panel
├── zeploy.json            # How zeploy installs it
├── README.md
└── AudiMate/              # The CEP panel itself
    ├── CSXS/manifest.xml  # Extension registration (host, version, size)
    ├── AudiMate.html      # Panel UI
    ├── css/style.css      # Theme + layout
    ├── js/main.js         # Panel logic (audio, waveform, WAV encode, I/O)
    ├── js/zeploy-usage.js # zeploy's usage helper (unchanged copy)
    ├── jsx/AudiMate.jsx   # ExtendScript bridge (imports WAV into Animate)
    └── fonts/             # Bundled Inter font
```

### Developing locally

Instead of copying files on every change, symlink the `AudiMate/` folder into the CEP extensions directory so edits are picked up on panel reload:

```
mklink /D "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\AudiMate" "<path>\proj_AudiMate\AudiMate"
```

The panel has remote debugging enabled (see `AudiMate/.debug`). With Animate and the panel open, browse to **`http://localhost:8088`** in Chrome to inspect the console, network, and DOM.

---

## License

Add your license here (e.g. MIT) if you intend to share this publicly.
