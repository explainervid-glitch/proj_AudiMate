/* AudiMate v1.0.0
 * Audio cutting panel for Adobe Animate 2024
 * Author: Zeus 2026
 */

(function () {
    "use strict";

    var csInterface = new CSInterface();

    // ---------- Update check ----------
    // Single source of truth for the running version. Bump this on each release
    // (and match it in CSXS/manifest.xml). The panel compares it against
    // version.json hosted in the GitHub repo and shows an "Update" pill if newer.
    var CURRENT_VERSION = "1.5.2";
    var UPDATE_CHECK_URL = "https://raw.githubusercontent.com/explainervid-glitch/proj_AudiMate/main/version.json";
    var RELEASES_URL = "https://github.com/explainervid-glitch/proj_AudiMate/releases";

    // This CEP host does not expose Node's require() (require === "undefined"),
    // but window.cep.fs IS available - use that for all file I/O instead.
    var cepFs = (window.cep && window.cep.fs) ? window.cep.fs : null;

    // Minimal path helpers (replacement for Node's "path" module)
    var pathUtil = {
        dirname: function (p) {
            var norm = p.replace(/\\/g, "/");
            var idx = norm.lastIndexOf("/");
            return idx >= 0 ? p.substring(0, idx) : "";
        },
        basename: function (p, ext) {
            var norm = p.replace(/\\/g, "/");
            var idx = norm.lastIndexOf("/");
            var base = idx >= 0 ? p.substring(idx + 1) : p;
            if (ext && base.slice(-ext.length).toLowerCase() === ext.toLowerCase()) {
                base = base.slice(0, -ext.length);
            }
            return base;
        },
        extname: function (p) {
            var base = pathUtil.basename(p);
            var idx = base.lastIndexOf(".");
            return idx > 0 ? base.substring(idx) : "";
        },
        join: function (dir, file) {
            if (!dir) return file;
            var sep = dir.indexOf("\\") >= 0 ? "\\" : "/";
            if (dir.charAt(dir.length - 1) === sep) return dir + file;
            return dir + sep + file;
        }
    };
    var path = pathUtil;

    // ---------- Base64 / ArrayBuffer helpers ----------
    function base64ToArrayBuffer(base64) {
        var binaryStr = atob(base64);
        var len = binaryStr.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function arrayBufferToBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = "";
        var chunkSize = 0x8000; // avoid call stack issues on large buffers
        for (var i = 0; i < bytes.length; i += chunkSize) {
            var chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    // ---------- cep.fs wrappers ----------
    var fileApi = {
        readFileAsArrayBuffer: function (filePath) {
            var result = cepFs.readFile(filePath, cep.encoding.Base64);
            if (result.err !== cep.fs.NO_ERROR) {
                throw new Error("readFile error code " + result.err);
            }
            return base64ToArrayBuffer(result.data);
        },
        writeFileFromArrayBuffer: function (filePath, arrayBuffer) {
            var base64 = arrayBufferToBase64(arrayBuffer);
            var result = cepFs.writeFile(filePath, base64, cep.encoding.Base64);
            if (result.err !== cep.fs.NO_ERROR) {
                throw new Error("writeFile error code " + result.err);
            }
        },
        exists: function (filePath) {
            var result = cepFs.stat(filePath);
            return result.err === cep.fs.NO_ERROR;
        }
    };

    // AudioContext init - guard too, in case it throws in this CEF build.
    var audioCtx = null;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        audioCtx = null;
    }

    // ---------- State ----------
    var state = {
        filePath: null,
        fileDir: null,
        fileBaseName: null, // without extension
        audioBuffer: null,
        sampleRate: 0,
        duration: 0,
        mode: "straight", // locked to "straight" — Multiple mode hidden for now
        exportFormat: "wav", // "wav" (MP3 support planned)
        exportSampleRate: 44100, // Hz; resampled on export if != source rate
        zoom: 1, // pixels per second multiplier base
        regions: [], // {id, start, end, name}
        nextRegionId: 1,
        isPlaying: false,
        playStartTime: 0, // audioContext.currentTime when playback started
        playStartOffset: 0, // offset in buffer where playback started
        playRegion: null, // region being played (for stop bound), or null = whole
        playInsideRegion: true, // toggle: when true, Play button plays inside the straight region
        rafId: null,
        dragState: null // active drag info
    };

    var sourceNode = null;

    // ---------- DOM refs ----------
    var dropZone = document.getElementById("dropZone");
    var dropZoneText = document.getElementById("dropZoneText");
    var namingInput = document.getElementById("namingInput");
    var modeStraightBtn = document.getElementById("modeStraightBtn");
    var modeMultipleBtn = document.getElementById("modeMultipleBtn");
    var waveformCanvas = document.getElementById("waveformCanvas");
    var rulerCanvas = document.getElementById("rulerCanvas");
    var regionsOverlay = document.getElementById("regionsOverlay");
    var playhead = document.getElementById("playhead");
    var playBtn = document.getElementById("playBtn");
    var stopBtn = document.getElementById("stopBtn");
    var playRegionBtn = document.getElementById("playRegionBtn");
    var zoomToPlayheadBtn = document.getElementById("zoomToPlayheadBtn");
    var zoomResetBtn = document.getElementById("zoomResetBtn");
    var zoomLabel = document.getElementById("zoomLabel");
    var currentTimeLabel = document.getElementById("currentTimeLabel");
    var durationLabel = document.getElementById("durationLabel");
    var regionsInfo = document.getElementById("regionsInfo");
    var addRegionBtn = document.getElementById("addRegionBtn");
    var cutBtn = document.getElementById("cutBtn");
    var cutPortBtn = document.getElementById("cutPortBtn");
    var multiList = document.getElementById("multiList");
    var statusEl = document.getElementById("status");
    var settingsBtn = document.getElementById("settingsBtn");
    var settingsPanel = document.getElementById("settingsPanel");
    var formatSelect = document.getElementById("formatSelect");
    var sampleRateSelect = document.getElementById("sampleRateSelect");
    var waveformContainer = document.querySelector(".waveform-container");

    var wfCtx = waveformCanvas.getContext("2d");
    var rulerCtx = rulerCanvas.getContext("2d");

    // Region swatch palette - read from CSS variables (css/style.css :root)
    // so colors stay centralized in one place.
    var REGION_COLORS = (function () {
        var styles = getComputedStyle(document.documentElement);
        var colors = [];
        for (var i = 1; i <= 8; i++) {
            var c = styles.getPropertyValue("--region-color-" + i).trim();
            if (c) colors.push(c);
        }
        return colors.length > 0 ? colors : ["#4a90d9", "#ffb43c", "#6dbf6d", "#d96fd9", "#e8865a", "#7fd4d4", "#d96f6f", "#a8d96f"];
    })();

    // Canvas drawing colors - read from CSS variables (css/style.css :root)
    // so the waveform/ruler match the rest of the theme.
    var THEME = (function () {
        var styles = getComputedStyle(document.documentElement);
        function v(name, fallback) {
            var val = styles.getPropertyValue(name).trim();
            return val || fallback;
        }
        return {
            waveformBg: v("--bg-panel-1", "#1a1a1a"),
            waveformLine: v("--accent", "#4a90d9"),
            waveformCenterLine: "rgba(255,255,255,0.08)",
            rulerBg: v("--bg-panel-3", "#232323"),
            rulerTick: "#555",
            rulerText: v("--text-muted", "#999")
        };
    })();

    // ---------- Utility ----------
    function formatTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        var m = Math.floor(sec / 60);
        var s = sec - m * 60;
        return m + ":" + s.toFixed(3).padStart(6, "0");
    }

    var statusTimer = null;
    function setStatus(msg, type) {
        statusEl.textContent = msg || "";
        statusEl.className = "status" + (type ? " " + type : "");
        if (statusTimer) clearTimeout(statusTimer);
        if (msg) {
            // Timer Status
            statusTimer = setTimeout(function () {
                statusEl.textContent = "";
                statusEl.className = "status";
                statusTimer = null;
            }, 5000);
        }
    }

    function sanitizeFileName(name) {
        return name.replace(/[\\/:*?"<>|]/g, "_").trim();
    }

    function clamp(v, lo, hi) {
        return Math.min(hi, Math.max(lo, v));
    }

    // ---------- Import button ----------
    var importBtn = document.getElementById("importBtn");

    importBtn.addEventListener("click", function () {
        try {
            var result = window.cep.fs.showOpenDialog(false, false, "Select audio file",
                state.fileDir || "", ["wav", "mp3", "ogg", "m4a", "aac"]);
            if (result && result.err === 0 && result.data && result.data.length > 0) {
                loadAudioFile(result.data[0]);
            }
        } catch (err) {
            setStatus("Failed to open file dialog: " + err.message, "error");
        }
    });

    // ---------- Drag & Drop ----------
    // Prevent CEF's default behavior (navigating to / playing the dropped file)
    ["dragenter", "dragover", "drop"].forEach(function (evt) {
        window.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
        document.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ["dragenter", "dragover"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add("dragover");
        });
        waveformContainer.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            waveformContainer.classList.add("dragover");
        });
    });

    ["dragleave", "dragend"].forEach(function (evt) {
        dropZone.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove("dragover");
        });
        waveformContainer.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            waveformContainer.classList.remove("dragover");
        });
    });

    // Shared handler — used by both dropZone and waveformContainer
    function handleAudioDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove("dragover");
        waveformContainer.classList.remove("dragover");

        var files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        var file = files[0];

        if (file.path) {
            // Native path available - use cep.fs path-based loader (consistent with Import button)
            loadAudioFile(file.path);
        } else {
            // Fallback: read via FileReader (no fs path available, Cut/CutPort
            // output dir will be unavailable until user also imports via dialog)
            loadAudioFromDroppedFile(file);
        }
    }

    dropZone.addEventListener("drop", handleAudioDrop);
    waveformContainer.addEventListener("drop", handleAudioDrop);

    // ---------- Load audio (by filesystem path, via cep.fs) ----------
    function loadAudioFile(filePath) {
        setStatus("Loading " + filePath + " ...");

        try {
            var arrayBuffer = fileApi.readFileAsArrayBuffer(filePath);

            audioCtx.decodeAudioData(arrayBuffer, function (decoded) {
                onAudioDecoded(decoded, filePath);
            }, function (err) {
                setStatus("Failed to decode audio: " + err, "error");
            });
        } catch (err) {
            setStatus("Failed to read file: " + err.message, "error");
        }
    }

    // ---------- Load audio (from a dropped File object, via FileReader) ----------
    function loadAudioFromDroppedFile(file) {
        setStatus("Loading " + file.name + " ...");

        var reader = new FileReader();
        reader.onload = function () {
            audioCtx.decodeAudioData(reader.result, function (decoded) {
                // No reliable filesystem path - use the file name only.
                // Cut/CutPort will be disabled until a path-based file is loaded.
                onAudioDecoded(decoded, null, file.name);
            }, function (err) {
                setStatus("Failed to decode audio: " + err, "error");
            });
        };
        reader.onerror = function () {
            setStatus("Failed to read dropped file: " + file.name, "error");
        };
        reader.readAsArrayBuffer(file);
    }

    // ---------- Shared finisher once an AudioBuffer is decoded ----------
    function onAudioDecoded(decoded, filePath, fallbackName) {
        state.audioBuffer = decoded;
        state.sampleRate = decoded.sampleRate;
        state.duration = decoded.duration;

        var displayName;
        if (filePath) {
            state.filePath = filePath;
            state.fileDir = path.dirname(filePath);
            state.fileBaseName = path.basename(filePath, path.extname(filePath));
            displayName = path.basename(filePath);
        } else {
            state.filePath = null;
            state.fileDir = null;
            var rawName = fallbackName || "audio";
            var ext = path.extname(rawName);
            state.fileBaseName = path.basename(rawName, ext);
            displayName = rawName;
        }

        // Reset regions
        state.regions = [];
        state.nextRegionId = 1;

        // Default naming field to empty
        namingInput.value = "";

        // Update UI
        dropZone.classList.add("loaded");
        var fileInfo = dropZone.querySelector(".file-info");
        if (!fileInfo) {
            fileInfo = document.createElement("div");
            fileInfo.className = "file-info";
            dropZone.appendChild(fileInfo);
        }
        dropZoneText.style.display = "none";

        var nameEl = fileInfo.querySelector(".file-name");
        if (!nameEl) {
            nameEl = document.createElement("div");
            nameEl.className = "file-name";
            fileInfo.appendChild(nameEl);
        }
        nameEl.textContent = displayName;
        nameEl.title = filePath ? filePath : "(no file path - drag from Explorer or use Import for Cut/CutPort)";

        durationLabel.textContent = formatTime(state.duration);
        currentTimeLabel.textContent = formatTime(0);

        playBtn.disabled = false;
        addRegionBtn.disabled = false;
        updateButtonStates();

        resizeCanvases();
        drawWaveform();
        drawRuler();
        renderRegions();

        var statusMsg = "Loaded: " + displayName + " (" + formatTime(state.duration) + ")";
        if (!filePath) {
            statusMsg += " - no file path, Cut/CutPort disabled";
        }
        setStatus(statusMsg, "success");

        // Restore previous session state if this load was triggered by tryRestoreSession
        if (state._pendingRestore) {
            var session = state._pendingRestore;
            state._pendingRestore = null;
            applyRestoredSession(session);
            setStatus("Session restored: " + displayName, "success");
        } else {
            // Fresh load — persist the new file path immediately
            saveSession();
        }
    }

    // ---------- Canvas sizing ----------
    function resizeCanvases() {
        var dpr = window.devicePixelRatio || 1;

        var wfRect = waveformContainer.getBoundingClientRect();
        waveformCanvas.width = wfRect.width * dpr;
        waveformCanvas.height = wfRect.height * dpr;
        waveformCanvas.style.width = wfRect.width + "px";
        waveformCanvas.style.height = wfRect.height + "px";

        var rulerRect = rulerCanvas.parentElement.getBoundingClientRect();
        rulerCanvas.width = rulerRect.width * dpr;
        rulerCanvas.height = rulerRect.height * dpr;
        rulerCanvas.style.width = rulerRect.width + "px";
        rulerCanvas.style.height = rulerRect.height + "px";
    }

    window.addEventListener("resize", function () {
        resizeCanvases();
        drawWaveform();
        drawRuler();
        renderRegions();
        updatePlayheadPosition();
    });

    // ---------- Drawing waveform ----------
    function drawWaveform() {
        var dpr = window.devicePixelRatio || 1;
        var w = waveformCanvas.width;
        var h = waveformCanvas.height;

        wfCtx.clearRect(0, 0, w, h);
        wfCtx.fillStyle = THEME.waveformBg;
        wfCtx.fillRect(0, 0, w, h);

        if (!state.audioBuffer) return;

        var channelData = state.audioBuffer.getChannelData(0);
        var numChannels = state.audioBuffer.numberOfChannels;
        var ch2 = numChannels > 1 ? state.audioBuffer.getChannelData(1) : null;

        var totalSamples = channelData.length;
        var samplesPerPixel = Math.max(1, Math.floor(totalSamples / w));

        var mid = h / 2;
        wfCtx.strokeStyle = THEME.waveformLine;
        wfCtx.lineWidth = 1 * dpr;
        wfCtx.beginPath();

        for (var x = 0; x < w; x++) {
            var startSample = Math.floor(x * samplesPerPixel);
            var endSample = Math.min(totalSamples, startSample + samplesPerPixel);

            var min = 1.0, max = -1.0;
            for (var i = startSample; i < endSample; i++) {
                var v = channelData[i];
                if (ch2) v = (v + ch2[i]) / 2;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (min > max) { min = 0; max = 0; }

            var yMin = mid - max * mid * 0.95;
            var yMax = mid - min * mid * 0.95;

            wfCtx.moveTo(x, yMin);
            wfCtx.lineTo(x, yMax);
        }
        wfCtx.stroke();

        // center line
        wfCtx.strokeStyle = THEME.waveformCenterLine;
        wfCtx.lineWidth = 1;
        wfCtx.beginPath();
        wfCtx.moveTo(0, mid);
        wfCtx.lineTo(w, mid);
        wfCtx.stroke();
    }

    // ---------- Ruler ----------
    function drawRuler() {
        var dpr = window.devicePixelRatio || 1;
        var w = rulerCanvas.width;
        var h = rulerCanvas.height;

        rulerCtx.clearRect(0, 0, w, h);
        rulerCtx.fillStyle = THEME.rulerBg;
        rulerCtx.fillRect(0, 0, w, h);

        if (!state.audioBuffer || state.duration <= 0) return;

        rulerCtx.strokeStyle = THEME.rulerTick;
        rulerCtx.fillStyle = THEME.rulerText;
        rulerCtx.font = (10 * dpr) + "px Consolas, monospace";
        rulerCtx.lineWidth = 1;

        // choose a nice tick interval based on duration & width
        var pxPerSec = w / state.duration;
        var targetPxPerTick = 70 * dpr;
        var rawInterval = targetPxPerTick / pxPerSec;
        var niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
        var interval = niceIntervals[niceIntervals.length - 1];
        for (var i = 0; i < niceIntervals.length; i++) {
            if (rawInterval <= niceIntervals[i]) {
                interval = niceIntervals[i];
                break;
            }
        }

        for (var t = 0; t <= state.duration; t += interval) {
            var x = (t / state.duration) * w;
            rulerCtx.beginPath();
            rulerCtx.moveTo(x, 0);
            rulerCtx.lineTo(x, h);
            rulerCtx.stroke();

            var label = formatTime(t);
            rulerCtx.fillText(label, x + 3, h * 0.7);
        }
    }

    // ---------- Time <-> pixel conversion ----------
    function timeToX(t) {
        var rect = waveformContainer.getBoundingClientRect();
        if (state.duration <= 0) return 0;
        return (t / state.duration) * rect.width;
    }

    function xToTime(x) {
        var rect = waveformContainer.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        return clamp((x / rect.width) * state.duration, 0, state.duration);
    }

    // ---------- Regions management ----------

    // True when user typed "/number" in the naming field — pure integer counter mode.
    function isNumberMode() {
        return namingInput.value.trim() === "/number";
    }

    // Seed name for the very first region in Multiple mode.
    function firstRegionName() {
        if (isNumberMode()) return "1";
        return namingInput.value || state.fileBaseName || "cut";
    }

    // Returns the next auto-name by incrementing the trailing number of `prev`.
    //   /number mode : "3" -> "4"  (pure integer, always)
    //   "sound"      -> "sound_1"  (no trailing number: append _1)
    //   "sound_3"    -> "sound_4"  (underscore+number: increment)
    //   "sound3"     -> "sound4"   (digit glued: increment in-place)
    function nextName(prev) {
        if (isNumberMode()) {
            var n = parseInt(prev, 10);
            return isNaN(n) ? "1" : String(n + 1);
        }
        var underMatch = prev.match(/^([\s\S]+?)_(\d+)$/);
        if (underMatch) {
            return underMatch[1] + "_" + (parseInt(underMatch[2], 10) + 1);
        }
        var digitMatch = prev.match(/^([\s\S]+?)(\d+)$/);
        if (digitMatch) {
            return digitMatch[1] + (parseInt(digitMatch[2], 10) + 1);
        }
        return prev + "_1";
    }

    function addRegion(start, end, name) {
        var id = state.nextRegionId++;
        var defaultName = name || nextName(firstRegionName());
        state.regions.push({
            id: id,
            start: start,
            end: end,
            name: defaultName
        });
        return id;
    }

    function removeRegion(id) {
        state.regions = state.regions.filter(function (r) { return r.id !== id; });
    }

    function getRegionColor(index) {
        return REGION_COLORS[index % REGION_COLORS.length];
    }

    addRegionBtn.addEventListener("click", function () {
        if (!state.audioBuffer) return;

        if (state.mode === "straight") {
            // Only one region allowed
            state.regions = [];
            var start = 0;
            var end = state.duration;
            addRegion(start, end, namingInput.value.trim());
        } else {
            // Multiple mode: spawn region at playhead position
            var playheadTime = state.playStartOffset;
            var defaultLen = Math.min(1, state.duration / 4) || state.duration;
            var newStart = clamp(playheadTime, 0, state.duration);
            var newEnd = clamp(newStart + defaultLen, newStart + 0.01, state.duration);
            if (newEnd <= newStart) {
                newStart = clamp(state.duration - defaultLen, 0, state.duration);
                newEnd = state.duration;
            }
            // If no regions exist, always start fresh from the seed (never increment).
            // If regions exist, chain from the last one's name.
            var name = state.regions.length > 0
                ? nextName(state.regions[state.regions.length - 1].name)
                : firstRegionName();
            addRegion(newStart, newEnd, name);
        }

        renderRegions();
        renderMultiList();
        updateButtonStates();
        saveSession();
    });

    // Mode toggle buttons — disabled while Cut Mode is locked to Straight/Mono.
    // Uncomment the listeners below to re-enable Multiple mode.
    // modeStraightBtn.addEventListener("click", function () { setMode("straight"); });
    // modeMultipleBtn.addEventListener("click", function () { setMode("multiple"); });

    function setMode(mode) {
        if (state.mode === mode) return;
        state.mode = mode;
        modeStraightBtn.classList.toggle("active", mode === "straight");
        modeMultipleBtn.classList.toggle("active", mode === "multiple");

        // Leaving straight mode: reset play region state
        if (mode === "multiple") {
            state.playInsideRegion = false;
        }

        // Straight mode: keep only first region (if any)
        if (mode === "straight" && state.regions.length > 1) {
            state.regions = [state.regions[0]];
        }

        multiList.classList.toggle("visible", mode === "multiple");
        renderRegions();
        renderMultiList();
        updateButtonStates();
        saveSession();
    }

    // ---------- Render regions on waveform ----------
    function renderRegions() {
        regionsOverlay.innerHTML = "";

        state.regions.forEach(function (region, idx) {
            var el = document.createElement("div");
            el.className = "region";
            el.dataset.regionId = region.id;

            var color = getRegionColor(idx);
            el.style.borderColor = color;
            el.style.background = hexToRgba(color, 0.16);

            var x1 = timeToX(region.start);
            var x2 = timeToX(region.end);
            el.style.left = x1 + "px";
            el.style.width = Math.max(1, x2 - x1) + "px";

            var label = document.createElement("div");
            label.className = "region-label";
            label.textContent = region.name + "  " + formatTime(region.start) + " - " + formatTime(region.end);
            el.appendChild(label);

            // Start handle
            var startHandle = document.createElement("div");
            startHandle.className = "region-handle start";
            startHandle.addEventListener("mousedown", function (e) {
                e.preventDefault(); e.stopPropagation();
                startDrag(e, region.id, "start");
            });
            el.appendChild(startHandle);

            // End handle
            var endHandle = document.createElement("div");
            endHandle.className = "region-handle end";
            endHandle.addEventListener("mousedown", function (e) {
                e.preventDefault(); e.stopPropagation();
                startDrag(e, region.id, "end");
            });
            el.appendChild(endHandle);

            // Body — for move drag; pointer-events on .region itself is none
            var bodyEl = document.createElement("div");
            bodyEl.className = "region-body";
            bodyEl.addEventListener("mousedown", function (e) {
                e.preventDefault(); e.stopPropagation();
                startDrag(e, region.id, "move");
            });
            el.appendChild(bodyEl);

            regionsOverlay.appendChild(el);
        });

        updateRegionsInfo();
    }

    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }

    function updateRegionsInfo() {
        if (state.regions.length === 0) {
            regionsInfo.textContent = "No regions";
            return;
        }
        if (state.mode === "straight") {
            var r = state.regions[0];
            regionsInfo.textContent = "Region: " + formatTime(r.start) + " - " + formatTime(r.end) +
                " (" + formatTime(r.end - r.start) + ")";
        } else {
            regionsInfo.textContent = state.regions.length + " region(s)";
        }
    }

    // ---------- Drag handling for regions ----------
    function startDrag(e, regionId, type) {
        e.preventDefault();
        e.stopPropagation();

        var region = state.regions.find(function (r) { return r.id === regionId; });
        if (!region) return;

        state.dragState = {
            regionId: regionId,
            type: type, // 'start' | 'end' | 'move'
            startX: e.clientX,
            origStart: region.start,
            origEnd: region.end
        };

        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragEnd);
    }

    function onDragMove(e) {
        if (!state.dragState) return;
        var ds = state.dragState;
        var region = state.regions.find(function (r) { return r.id === ds.regionId; });
        if (!region) return;

        var rect = waveformContainer.getBoundingClientRect();
        var deltaPx = e.clientX - ds.startX;
        var deltaTime = (deltaPx / rect.width) * state.duration;

        if (ds.type === "start") {
            var newStart = clamp(ds.origStart + deltaTime, 0, ds.origEnd - 0.005);
            region.start = newStart;
        } else if (ds.type === "end") {
            var newEnd = clamp(ds.origEnd + deltaTime, ds.origStart + 0.005, state.duration);
            region.end = newEnd;
        } else if (ds.type === "move") {
            var len = ds.origEnd - ds.origStart;
            var newStartM = clamp(ds.origStart + deltaTime, 0, state.duration - len);
            region.start = newStartM;
            region.end = newStartM + len;
        }

        renderRegions();
        renderMultiList();
    }

    function onDragEnd() {
        state.dragState = null;
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        saveSession();
    }

    // ---------- Audacity-style waveform interaction ----------
    // Rules (canvas clicks only — region handles/body absorb their own events):
    //   mousedown            → place playhead at click point, arm pending action
    //   mousemove > threshold → commit to region-create drag (Straight mode only)
    //   mouseup  no drag     → pure click, just seeks playhead
    //   region handle        → resize (handled inside renderRegions via startDrag)
    //   region body          → move  (handled inside renderRegions via startDrag)

    var DRAG_THRESHOLD = 4; // px before committing to a region drag

    waveformContainer.addEventListener("mousedown", function (e) {
        if (!state.audioBuffer) return;
        if (e.target !== waveformCanvas) return;

        e.preventDefault();

        var rect = waveformContainer.getBoundingClientRect();
        var anchorTime = xToTime(e.clientX - rect.left);
        var anchorX = e.clientX;
        var committed = false;
        var newRegionId = null;

        var wasPlaying = state.isPlaying;
        if (wasPlaying) stopPlayback();

        // Immediately place playhead
        seekToSilent(anchorTime);

        function onMove(ev) {
            var dx = ev.clientX - anchorX;

            if (!committed) {
                if (Math.abs(dx) < DRAG_THRESHOLD) return;
                committed = true;

                if (state.mode === "straight") {
                    state.regions = [];
                    var name = namingInput.value.trim() || state.fileBaseName || "cut";
                    newRegionId = addRegion(anchorTime, anchorTime, name);
                    renderRegions();
                    updateButtonStates();
                }
            }

            var rect2 = waveformContainer.getBoundingClientRect();
            var currentTime = xToTime(ev.clientX - rect2.left);

            if (state.mode === "straight" && newRegionId !== null) {
                var region = state.regions.find(function (r) { return r.id === newRegionId; });
                if (region) {
                    if (currentTime >= anchorTime) {
                        region.start = anchorTime;
                        region.end = clamp(currentTime, anchorTime + 0.001, state.duration);
                    } else {
                        region.start = clamp(currentTime, 0, anchorTime);
                        region.end = anchorTime;
                    }
                    seekToSilent(region.start);
                    renderRegions();
                    renderMultiList();
                }
            } else {
                // Multiple mode or pre-commit: scrub playhead
                seekToSilent(currentTime);
            }
        }

        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);

            if (!committed) {
                // Pure click — just resume if was playing
                if (wasPlaying) startPlayback();
            } else {
                if (state.mode === "straight" && newRegionId !== null) {
                    var region = state.regions.find(function (r) { return r.id === newRegionId; });
                    if (region && (region.end - region.start) < 0.01) {
                        // Too small — discard, treat as click
                        state.regions = [];
                        renderRegions();
                    }
                }
                updateButtonStates();
                renderMultiList();
            }
            saveSession();
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // Ruler — always seeks only, no region creation
    rulerCanvas.parentElement.addEventListener("mousedown", function (e) {
        if (!state.audioBuffer) return;
        e.preventDefault();
        var rect = waveformContainer.getBoundingClientRect();
        var wasPlaying = state.isPlaying;
        if (wasPlaying) stopPlayback();
        seekToSilent(xToTime(e.clientX - rect.left));

        function onMove(ev) {
            var rect2 = waveformContainer.getBoundingClientRect();
            seekToSilent(xToTime(ev.clientX - rect2.left));
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (wasPlaying) startPlayback();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // Playhead handle — drag to scrub
    playhead.addEventListener("mousedown", function (e) {
        if (!state.audioBuffer) return;
        e.preventDefault();
        e.stopPropagation();
        var wasPlaying = state.isPlaying;
        if (wasPlaying) stopPlayback();

        function onMove(ev) {
            var rect = waveformContainer.getBoundingClientRect();
            seekToSilent(xToTime(ev.clientX - rect.left));
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            if (wasPlaying) startPlayback();
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });

    // Move playhead position only, without touching playback state.
    // Used while drag-scrubbing so audio doesn't restart on every mousemove.
    function seekToSilent(t) {
        state.playStartOffset = clamp(t, 0, state.duration);
        currentTimeLabel.textContent = formatTime(state.playStartOffset);
        updatePlayheadPosition();
    }

    // ---------- Playback ----------
    playRegionBtn.addEventListener("click", function () {
        state.playInsideRegion = !state.playInsideRegion;
        playRegionBtn.classList.toggle("active", state.playInsideRegion);
        // If currently playing, restart so the new mode takes effect immediately
        if (state.isPlaying) {
            stopPlayback();
            startPlayback();
        }
    });

    playBtn.addEventListener("click", function () {
        if (state.isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });

    stopBtn.addEventListener("click", function () {
        stopPlayback();
        state.playStartOffset = 0;
        currentTimeLabel.textContent = formatTime(0);
        updatePlayheadPosition();
    });

    // ---------- Space bar → play / pause ----------
    // ---------- Ctrl + Space → play from region start ----------
    // Guard: ignore when focus is inside any text input so typing still works.
    document.addEventListener("keydown", function (e) {
        if (e.code !== "Space") return;
        var tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (!state.audioBuffer) return;

        if (e.ctrlKey) {
            // Ctrl+Space: restart from region start (Straight mode), or time 0
            stopPlayback();
            var regionStart = (state.mode === "straight" && state.regions.length === 1)
                ? state.regions[0].start
                : 0;
            seekToSilent(regionStart);
            startPlayback();
        } else {
            // Space: play / pause from current playhead position
            if (state.isPlaying) {
                stopPlayback();
            } else {
                startPlayback();
            }
        }
    });

    function startPlayback() {
        if (!state.audioBuffer) return;

        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = state.audioBuffer;
        sourceNode.connect(audioCtx.destination);

        var offset = state.playStartOffset;

        // Play Inside Region: straight mode only, must have exactly 1 region
        var region = (state.playInsideRegion && state.mode === "straight" && state.regions.length === 1)
            ? state.regions[0] : null;

        if (region) {
            // Clamp start offset inside the region
            offset = clamp(offset, region.start, region.end - 0.001);
            state.playRegion = region;
        } else {
            state.playRegion = null;
        }

        sourceNode.start(0, offset);
        state.playStartOffset = offset;
        state.playStartTime = audioCtx.currentTime;
        state.isPlaying = true;
        playBtn.innerHTML = '<svg><use href="#lc-pause"/></svg>';
        stopBtn.disabled = false;
        playhead.style.display = "block";

        sourceNode.onended = function () {
            if (state.isPlaying) {
                stopPlayback();
                state.playStartOffset = 0;
                currentTimeLabel.textContent = formatTime(0);
                updatePlayheadPosition();
            }
        };

        tickPlayhead();
    }

    function stopPlayback() {
        if (sourceNode) {
            try { sourceNode.onended = null; sourceNode.stop(); } catch (e) {}
            sourceNode.disconnect();
            sourceNode = null;
        }
        if (state.isPlaying) {
            state.playStartOffset = clamp(
                state.playStartOffset + (audioCtx.currentTime - state.playStartTime),
                0, state.duration
            );
        }
        state.isPlaying = false;
        state.playRegion = null;
        playBtn.innerHTML = '<svg><use href="#lc-play"/></svg>';
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
    }

    function tickPlayhead() {
        if (!state.isPlaying) return;
        var elapsed = audioCtx.currentTime - state.playStartTime;
        var current = clamp(state.playStartOffset + elapsed, 0, state.duration);
        currentTimeLabel.textContent = formatTime(current);
        updatePlayheadPosition(current);

        // Stop at region end when playing inside region
        if (state.playRegion && current >= state.playRegion.end) {
            var regionStart = state.playRegion.start;
            var regionEnd = state.playRegion.end;
            // Mark isPlaying false BEFORE stopPlayback so its internal clamp is skipped
            state.isPlaying = false;
            stopPlayback();
            // Now safely park offset at region start so next Play begins there
            state.playStartOffset = regionStart;
            currentTimeLabel.textContent = formatTime(regionEnd);
            updatePlayheadPosition(regionEnd);
            return;
        }

        if (current >= state.duration) {
            stopPlayback();
            state.playStartOffset = 0;
            currentTimeLabel.textContent = formatTime(0);
            updatePlayheadPosition();
            return;
        }

        state.rafId = requestAnimationFrame(tickPlayhead);
    }

    function updatePlayheadPosition(t) {
        if (t === undefined) t = state.playStartOffset;
        if (!state.audioBuffer) {
            playhead.style.display = "none";
            return;
        }
        var x = timeToX(t);
        playhead.style.left = x + "px";
        playhead.style.display = state.isPlaying ? "block" : (t > 0 ? "block" : "none");
    }

    // ---------- Zoom (Ctrl+Scroll wheel, centered on cursor position) ----------
    var timelineScroll = document.querySelector(".timeline-scroll");

    timelineScroll.addEventListener("wheel", function (e) {
        if (!e.ctrlKey) return;
        if (!state.audioBuffer) return;

        e.preventDefault();

        var rect = waveformContainer.getBoundingClientRect();
        var cursorX = e.clientX - rect.left; // px within current (possibly zoomed) waveform
        var cursorTime = xToTime(cursorX);

        var zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setZoom(state.zoom * zoomFactor, cursorTime, e.clientX - timelineScroll.getBoundingClientRect().left);
    }, { passive: false });

    function setZoom(z, anchorTime, anchorViewportX) {
        state.zoom = clamp(z, 1, 20);
        zoomLabel.textContent = Math.round(state.zoom * 100) + "%";

        var baseWidth = timelineScroll.getBoundingClientRect().width;
        var newWidth = baseWidth * state.zoom;

        waveformContainer.style.width = newWidth + "px";
        rulerCanvas.parentElement.style.width = newWidth + "px";

        resizeCanvases();
        drawWaveform();
        drawRuler();
        renderRegions();
        updatePlayheadPosition();

        // Adjust scroll position so anchorTime stays under anchorViewportX
        if (anchorTime !== undefined && state.duration > 0) {
            var newX = (anchorTime / state.duration) * newWidth;
            var targetScrollLeft = newX - (anchorViewportX !== undefined ? anchorViewportX : 0);
            timelineScroll.scrollLeft = Math.max(0, targetScrollLeft);
        }
    }

    // Zoom to playhead: center the view on the current playhead position
    function zoomToPlayhead(z) {
        if (!state.audioBuffer) return;
        var viewportWidth = timelineScroll.getBoundingClientRect().width;
        setZoom(z, state.playStartOffset, viewportWidth / 2);
    }

    zoomToPlayheadBtn.addEventListener("click", function () {
        // Zoom in further centered on the playhead, or just re-center if already zoomed
        var targetZoom = state.zoom > 1 ? state.zoom : state.zoom * 5;
        zoomToPlayhead(targetZoom);
    });

    zoomResetBtn.addEventListener("click", function () {
        setZoom(1);
        timelineScroll.scrollLeft = 0;
    });

    // ---------- Middle-mouse drag to pan (same axis as Shift+Scroll) ----------
    // Hold middle mouse button anywhere over the timeline and drag left/right
    // to scroll the waveform, matching Shift+Scroll behavior.
    var panState = null;

    timelineScroll.addEventListener("mousedown", function (e) {
        if (e.button !== 1) return; // middle mouse only
        if (!state.audioBuffer) return;

        e.preventDefault(); // stop browser's native middle-click autoscroll icon

        panState = {
            startX: e.clientX,
            startScrollLeft: timelineScroll.scrollLeft
        };

        timelineScroll.classList.add("panning");

        document.addEventListener("mousemove", onPanMove);
        document.addEventListener("mouseup", onPanEnd);
    });

    function onPanMove(e) {
        if (!panState) return;
        var dx = e.clientX - panState.startX;
        // Dragging right moves content right → scroll left decreases (and vice versa)
        timelineScroll.scrollLeft = panState.startScrollLeft - dx;
    }

    function onPanEnd() {
        panState = null;
        timelineScroll.classList.remove("panning");
        document.removeEventListener("mousemove", onPanMove);
        document.removeEventListener("mouseup", onPanEnd);
    }

    // Prevent the browser's default middle-click "autoscroll" cursor/behavior
    // from firing on the timeline (some browsers trigger this on auxclick/contextmenu too).
    timelineScroll.addEventListener("auxclick", function (e) {
        if (e.button === 1) e.preventDefault();
    });

    // ---------- Naming input changes update region names live for straight mode ----------
    namingInput.addEventListener("input", function () {
        if (state.mode === "straight" && state.regions.length > 0) {
            state.regions[0].name = namingInput.value.trim();
            renderRegions();
        }
        updateButtonStates();
        saveSession();
    });

    // ---------- Multiple cut list rendering ----------
    function renderMultiList() {
        multiList.innerHTML = "";
        if (state.mode !== "multiple") return;

        state.regions.forEach(function (region, idx) {
            var item = document.createElement("div");
            item.className = "multi-list-item";

            var swatch = document.createElement("div");
            swatch.className = "swatch";
            swatch.style.background = getRegionColor(idx);
            item.appendChild(swatch);

            var nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = region.name;
            nameInput.placeholder = "cut name";
            nameInput.addEventListener("input", function () {
                region.name = nameInput.value;
                renderRegions();
                saveSession();
            });
            item.appendChild(nameInput);

            var rangeLabel = document.createElement("div");
            rangeLabel.className = "range-label";
            rangeLabel.textContent = formatTime(region.start) + " - " + formatTime(region.end);
            item.appendChild(rangeLabel);

            var removeBtn = document.createElement("button");
            removeBtn.className = "remove-btn";
            removeBtn.textContent = "×";
            removeBtn.title = "Remove this region";
            removeBtn.addEventListener("click", function () {
                removeRegion(region.id);
                renderRegions();
                renderMultiList();
                updateButtonStates();
                saveSession();
            });
            item.appendChild(removeBtn);

            multiList.appendChild(item);
        });
    }

    // refresh range labels in multi list periodically during drag
    var originalRenderRegions = renderRegions;
    renderRegions = function () {
        originalRenderRegions();
        if (state.mode === "multiple") {
            // update existing range labels without full rebuild for perf during drag
            var items = multiList.querySelectorAll(".multi-list-item");
            items.forEach(function (item, idx) {
                var region = state.regions[idx];
                if (!region) return;
                var rangeLabel = item.querySelector(".range-label");
                if (rangeLabel) {
                    rangeLabel.textContent = formatTime(region.start) + " - " + formatTime(region.end);
                }
            });
        }
    };

    // ---------- Button states ----------
    function updateButtonStates() {
        var hasAudio = !!state.audioBuffer;
        var hasRegions = state.regions.length > 0;
        var hasFileDir = !!state.fileDir;
        var isStraight = state.mode === "straight";
        var hasName = namingInput.value.trim().length > 0;

        // Show/hide based on mode
        addRegionBtn.style.display = isStraight ? "none" : "";
        cutPortBtn.style.display = isStraight ? "" : "none";

        cutBtn.disabled = !hasAudio || !hasRegions || !hasFileDir;
        cutPortBtn.disabled = !hasAudio || !hasFileDir || state.regions.length !== 1 || !hasName;
        addRegionBtn.disabled = !hasAudio;

        // Play Region: only in straight mode with a region
        playRegionBtn.disabled = !hasAudio || !isStraight || state.regions.length !== 1;
        playRegionBtn.classList.toggle("active", state.playInsideRegion && isStraight && state.regions.length === 1);
    }

    // ---------- WAV Encoding ----------
    // Encodes an AudioBuffer slice (start/end in seconds) to a 16-bit PCM WAV ArrayBuffer
    function encodeWavSlice(audioBuffer, startSec, endSec) {
        var sampleRate = audioBuffer.sampleRate;
        var numChannels = audioBuffer.numberOfChannels;

        var startSample = Math.floor(startSec * sampleRate);
        var endSample = Math.min(audioBuffer.length, Math.ceil(endSec * sampleRate));
        var frameCount = Math.max(0, endSample - startSample);

        var bytesPerSample = 2; // 16-bit
        var blockAlign = numChannels * bytesPerSample;
        var dataSize = frameCount * blockAlign;
        var bufferSize = 44 + dataSize;

        var arrayBuffer = new ArrayBuffer(bufferSize);
        var view = new DataView(arrayBuffer);

        // RIFF header
        writeString(view, 0, "RIFF");
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, "WAVE");

        // fmt chunk
        writeString(view, 12, "fmt ");
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // bits per sample

        // data chunk
        writeString(view, 36, "data");
        view.setUint32(40, dataSize, true);

        // Interleave and write PCM samples
        var channels = [];
        for (var c = 0; c < numChannels; c++) {
            channels.push(audioBuffer.getChannelData(c));
        }

        var offset = 44;
        for (var i = 0; i < frameCount; i++) {
            var sampleIndex = startSample + i;
            for (var ch = 0; ch < numChannels; ch++) {
                var sample = channels[ch][sampleIndex] || 0;
                sample = clamp(sample, -1, 1);
                var intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, intSample, true);
                offset += 2;
            }
        }

        return arrayBuffer;
    }

    function writeString(view, offset, str) {
        for (var i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    // ---------- Region -> encoded ArrayBuffer (async, honors export settings) ----------
    // Resamples the region to state.exportSampleRate via OfflineAudioContext when it
    // differs from the source rate, then encodes to WAV. Calls cb(arrayBuffer) on
    // success, or cb(null, errorMessage) on failure.
    function encodeRegionToBuffer(region, cb) {
        var targetRate = state.exportSampleRate;
        var sourceRate = state.audioBuffer.sampleRate;

        // No resampling needed — encode directly at the source rate.
        if (!targetRate || targetRate === sourceRate) {
            try {
                cb(encodeWavSlice(state.audioBuffer, region.start, region.end));
            } catch (e) {
                cb(null, e.message);
            }
            return;
        }

        var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtx) {
            // Resampling unavailable in this host — fall back to source rate.
            try {
                cb(encodeWavSlice(state.audioBuffer, region.start, region.end));
            } catch (e) {
                cb(null, e.message);
            }
            return;
        }

        try {
            var duration = Math.max(0, region.end - region.start);
            var frameCount = Math.max(1, Math.ceil(duration * targetRate));
            var offline = new OfflineCtx(state.audioBuffer.numberOfChannels, frameCount, targetRate);
            var src = offline.createBufferSource();
            src.buffer = state.audioBuffer;
            src.connect(offline.destination);
            // Play only the region; the offline context resamples to targetRate.
            src.start(0, region.start, duration);

            offline.oncomplete = function (e) {
                try {
                    // Rendered buffer is already the region, at targetRate — encode whole.
                    cb(encodeWavSlice(e.renderedBuffer, 0, e.renderedBuffer.duration));
                } catch (err) {
                    cb(null, err.message);
                }
            };
            offline.startRendering();
        } catch (e) {
            cb(null, e.message);
        }
    }

    // ---------- Build output file path — aborts on name collision instead of auto-suffixing ----------
    function getOutputPath(name) {
        var safeName = sanitizeFileName(name || "cut");
        var fileName = safeName + "." + state.exportFormat;
        var fullPath = path.join(state.fileDir, fileName);
        return { path: fullPath, name: fileName, exists: fileApi.exists(fullPath) };
    }

    // Checks all given region names for filename collisions in fileDir.
    // Returns null if all clear, or the first colliding file name if not.
    function findNameCollision(regions) {
        for (var i = 0; i < regions.length; i++) {
            var candidate = getOutputPath(regions[i].name);
            if (candidate.exists) {
                return candidate.name;
            }
        }
        return null;
    }

    // ---------- Cut button ----------
    cutBtn.addEventListener("click", function () {
        if (!state.audioBuffer || state.regions.length === 0) return;

        var collision = findNameCollision(state.regions);
        if (collision) {
            setStatus("Save aborted: \"" + collision + "\" already exists. Rename the cut to avoid duplication.", "error");
            return;
        }

        var regions = state.regions.slice();
        var outputPaths = [];
        var idx = 0;

        setStatus("Encoding " + regions.length + " file(s)...");

        function saveNext() {
            if (idx >= regions.length) {
                setStatus("Saved " + outputPaths.length + " file(s) to " + state.fileDir, "success");
                return;
            }
            var region = regions[idx++];
            encodeRegionToBuffer(region, function (buffer, errMsg) {
                if (!buffer) {
                    setStatus("Cut failed: " + errMsg, "error");
                    return;
                }
                try {
                    var outPath = getOutputPath(region.name).path;
                    fileApi.writeFileFromArrayBuffer(outPath, buffer);
                    outputPaths.push(outPath);
                    saveNext();
                } catch (err) {
                    setStatus("Cut failed: " + err.message, "error");
                }
            });
        }

        saveNext();
    });

    // ---------- CutPort button ----------
    cutPortBtn.addEventListener("click", function () {
        if (!state.audioBuffer || state.mode !== "straight" || state.regions.length !== 1) return;

        var region = state.regions[0];

        var collision = findNameCollision([region]);
        if (collision) {
            setStatus("Send aborted: \"" + collision + "\" already exists. Rename the cut to avoid duplication.", "error");
            return;
        }

        setStatus("Encoding...");

        encodeRegionToBuffer(region, function (buffer, errMsg) {
            if (!buffer) {
                setStatus("CutPort failed: " + errMsg, "error");
                return;
            }
            try {
                var outPath = getOutputPath(region.name).path;
                fileApi.writeFileFromArrayBuffer(outPath, buffer);

                setStatus("Saved " + outPath + ", importing to Animate...");

                var escapedPath = outPath.replace(/\\/g, "\\\\");
                var libName = path.basename(outPath);
                var jsxCall = "importAudioToLayer('" + escapedPath + "', '" + libName.replace(/'/g, "\\'") + "')";

                csInterface.evalScript(jsxCall, function (result) {
                    if (result && result.indexOf("ERROR") === 0) {
                        setStatus("Saved file, but import failed: " + result, "error");
                    } else {
                        setStatus("CutPort done: " + outPath + " -> " + result, "success");
                    }
                });
            } catch (err) {
                setStatus("CutPort failed: " + err.message, "error");
            }
        });
    });

    // ---------- Session persistence (localStorage) ----------
    var SESSION_KEY = "audimate_session_v1";

    function saveSession() {
        if (!state.audioBuffer) return; // nothing loaded, nothing to save
        try {
            var data = {
                filePath:       state.filePath,
                mode:           state.mode,
                zoom:           state.zoom,
                playStartOffset: state.playStartOffset,
                nextRegionId:   state.nextRegionId,
                playInsideRegion: state.playInsideRegion,
                regions:        state.regions.map(function (r) {
                    return { id: r.id, start: r.start, end: r.end, name: r.name };
                }),
                namingInput:    namingInput.value
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify(data));
        } catch (e) { /* localStorage not available in this CEF build — silently skip */ }
    }

    function clearSession() {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    // Restore saved session after an audio file has been decoded.
    // Called from onAudioDecoded when it detects a restore is in progress.
    function applyRestoredSession(session) {
        // Regions
        state.regions       = session.regions || [];
        state.nextRegionId  = session.nextRegionId || (state.regions.length + 1);
        state.playStartOffset = clamp(session.playStartOffset || 0, 0, state.duration);
        state.playInsideRegion = !!session.playInsideRegion;

        // Naming input
        if (session.namingInput !== undefined) {
            namingInput.value = session.namingInput;
        }

        // Mode
        setMode(session.mode === "multiple" ? "multiple" : "straight");

        // Zoom (setZoom handles clamping)
        if (session.zoom && session.zoom > 1) {
            setZoom(session.zoom, state.playStartOffset);
        }

        // Playhead
        currentTimeLabel.textContent = formatTime(state.playStartOffset);
        updatePlayheadPosition();

        // Re-render everything
        renderRegions();
        renderMultiList();
        updateButtonStates();

        playRegionBtn.classList.toggle("active", state.playInsideRegion &&
            state.mode === "straight" && state.regions.length === 1);
    }

    // Attempt to restore a previous session on startup.
    function tryRestoreSession() {
        var raw;
        try { raw = localStorage.getItem(SESSION_KEY); } catch (e) { return; }
        if (!raw) return;

        var session;
        try { session = JSON.parse(raw); } catch (e) { clearSession(); return; }

        if (!session.filePath) return;

        // Check the file still exists on disk
        if (!fileApi.exists(session.filePath)) {
            setStatus("Previous session file no longer found: " + session.filePath, "error");
            clearSession();
            return;
        }

        setStatus("Restoring previous session...");

        // Flag so onAudioDecoded knows to restore state instead of starting fresh
        state._pendingRestore = session;

        loadAudioFile(session.filePath);
    }

    // ---------- Export settings (persisted separately from session) ----------
    var SETTINGS_KEY = "audimate_settings_v1";

    function loadSettings() {
        try {
            var raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                var s = JSON.parse(raw);
                if (s.format === "wav" || s.format === "mp3") state.exportFormat = s.format;
                var sr = parseInt(s.sampleRate, 10);
                if (!isNaN(sr)) state.exportSampleRate = sr;
            }
        } catch (e) { /* localStorage unavailable — use defaults */ }

        // MP3 not implemented yet — force WAV so exports never break.
        if (state.exportFormat !== "wav") state.exportFormat = "wav";

        // Reflect settings into the UI controls.
        if (formatSelect) formatSelect.value = state.exportFormat;
        if (sampleRateSelect) sampleRateSelect.value = String(state.exportSampleRate);
    }

    function saveSettings() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                format: state.exportFormat,
                sampleRate: state.exportSampleRate
            }));
        } catch (e) { /* ignore */ }
    }

    if (formatSelect) {
        formatSelect.addEventListener("change", function () {
            state.exportFormat = formatSelect.value === "mp3" ? "mp3" : "wav";
            saveSettings();
        });
    }

    if (sampleRateSelect) {
        sampleRateSelect.addEventListener("change", function () {
            var sr = parseInt(sampleRateSelect.value, 10);
            if (!isNaN(sr)) {
                state.exportSampleRate = sr;
                saveSettings();
            }
        });
    }

    // Toggle the settings popover; close on outside click / Escape.
    function toggleSettings(show) {
        if (!settingsPanel) return;
        var visible = show !== undefined ? show : settingsPanel.style.display === "none";
        settingsPanel.style.display = visible ? "block" : "none";
    }

    if (settingsBtn) {
        settingsBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            toggleSettings();
        });
    }

    document.addEventListener("click", function (e) {
        if (!settingsPanel || settingsPanel.style.display === "none") return;
        if (settingsPanel.contains(e.target) || (settingsBtn && settingsBtn.contains(e.target))) return;
        toggleSettings(false);
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") toggleSettings(false);
    });

    // ---------- Update check (notify + link) ----------
    // Parse "1.5.0" / "v1.5.0" into [1,5,0].
    function parseVersion(v) {
        return String(v).replace(/^v/i, "").split(".").map(function (n) {
            var num = parseInt(n, 10);
            return isNaN(num) ? 0 : num;
        });
    }

    // True if `remote` is a higher version than `current`.
    function isNewerVersion(remote, current) {
        var a = parseVersion(remote);
        var b = parseVersion(current);
        var len = Math.max(a.length, b.length);
        for (var i = 0; i < len; i++) {
            var x = a[i] || 0;
            var y = b[i] || 0;
            if (x > y) return true;
            if (x < y) return false;
        }
        return false; // equal
    }

    var updateNoticeEl = document.getElementById("updateNotice");
    var versionLabelEl = document.getElementById("versionLabel");

    function showUpdateNotice(info) {
        if (!updateNoticeEl) return;
        var v = String(info.version).replace(/^v/i, "");
        updateNoticeEl.textContent = "Update v" + v + " →";
        updateNoticeEl.title = info.notes ? ("What's new: " + info.notes) : "Download the latest version";
        updateNoticeEl.setAttribute("data-url", info.url || RELEASES_URL);
        updateNoticeEl.style.display = "inline-block";
    }

    if (updateNoticeEl) {
        updateNoticeEl.addEventListener("click", function (e) {
            e.preventDefault();
            var url = updateNoticeEl.getAttribute("data-url") || RELEASES_URL;
            try {
                csInterface.openURLInDefaultBrowser(url);
            } catch (err) {
                setStatus("Could not open browser: " + err.message, "error");
            }
        });
    }

    // Fetch version.json from GitHub and reveal the pill if a newer version exists.
    // Never throws into the panel — any network/parse failure is ignored silently.
    function checkForUpdate() {
        if (typeof fetch !== "function") return;
        try {
            fetch(UPDATE_CHECK_URL, { cache: "no-store" })
                .then(function (res) { return res && res.ok ? res.json() : null; })
                .then(function (data) {
                    if (!data || !data.version) return;
                    if (isNewerVersion(data.version, CURRENT_VERSION)) {
                        showUpdateNotice(data);
                    }
                })
                .catch(function () { /* offline or blocked — ignore */ });
        } catch (e) { /* fetch unavailable — ignore */ }
    }

    // ---------- Init ----------
    function init() {
        // Keep the version badge in sync with CURRENT_VERSION (single source).
        if (versionLabelEl) versionLabelEl.textContent = "v" + CURRENT_VERSION;
        loadSettings();
        checkForUpdate();

        resizeCanvases();
        drawWaveform();
        drawRuler();
        updateButtonStates();
        playhead.style.display = "none";

        if (!cepFs || !window.cep || !window.cep.encoding) {
            setStatus("cep.fs not available in this CEP host. Import disabled.", "error");
            importBtn.disabled = true;
        } else if (!audioCtx) {
            setStatus("AudioContext could not be created. Audio decoding disabled.", "error");
            importBtn.disabled = true;
        } else {
            // Try to reload the previous session (only when cep.fs is available)
            tryRestoreSession();
        }
    }

    init();

})();