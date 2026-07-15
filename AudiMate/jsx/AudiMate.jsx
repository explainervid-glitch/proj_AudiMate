// AudiMate.jsx
// ExtendScript (ES3) for Adobe Animate 2024
// Imports a cut WAV file into the library and places it as a sound
// on the active layer at the current playhead frame.
//
// Author: Zeus 2026

// ES3 has no JSON - minimal polyfill (only used if needed elsewhere)
if (typeof JSON === "undefined") {
    JSON = {};
}
if (typeof JSON.stringify !== "function") {
    JSON.stringify = function (obj) {
        var t = typeof obj;
        if (t !== "object" || obj === null) {
            if (t === "string") obj = '"' + obj.replace(/"/g, '\\"') + '"';
            return String(obj);
        } else {
            var json = [];
            var isArray = (obj && obj.constructor === Array);
            for (var k in obj) {
                if (!obj.hasOwnProperty(k)) continue;
                var v = obj[k];
                t = typeof v;
                if (t === "string") {
                    v = '"' + v.replace(/"/g, '\\"') + '"';
                } else if (t === "object" && v !== null) {
                    v = JSON.stringify(v);
                }
                json.push((isArray ? "" : '"' + k + '":') + String(v));
            }
            return (isArray ? "[" : "{") + String(json) + (isArray ? "]" : "}");
        }
    };
}

// ES3 may not have encodeURI - minimal polyfill covering the characters
// commonly found in Windows file paths (space and a few others).
if (typeof encodeURI !== "function") {
    encodeURI = function (str) {
        return str.replace(/[^A-Za-z0-9\-_.!~*'()/:]/g, function (ch) {
            var hex = ch.charCodeAt(0).toString(16).toUpperCase();
            if (hex.length === 1) hex = "0" + hex;
            return "%" + hex;
        });
    };
}

/**
 * Imports a WAV file into the document's library (if not already present)
 * and adds it to the stage, which Animate places onto the active layer at
 * the current playhead frame - same as a manual drag-and-drop from the Library panel.
 *
 * @param {string} filePath - Absolute path to the WAV file (Windows-style backslashes allowed)
 * @param {string} libName  - Desired library item name (e.g. "VO_intro.wav")
 * @returns {string} Status message - "OK:<details>" on success, "ERROR:<message>" on failure
 */
function importAudioToLayer(filePath, libName) {
    try {
        var doc = fl.getDocumentDOM();
        if (!doc) {
            return "ERROR: No active document.";
        }

        // document.importFile appears to require a file:// URI in Animate 2024.
        // A raw path (even with forward slashes) throws "Invalid URI" when it
        // contains spaces or other characters that need percent-encoding.
        var fsPath = filePath.replace(/\\\\/g, "/").replace(/\\/g, "/");

        var fileURI;
        if (fsPath.indexOf("file://") === 0) {
            fileURI = fsPath;
        } else if (/^[A-Za-z]:\//.test(fsPath)) {
            // Windows drive path e.g. C:/foo bar/baz.wav -> file:///C:/foo%20bar/baz.wav
            fileURI = "file:///" + encodeURI(fsPath);
        } else if (fsPath.indexOf("/") === 0) {
            // Unix-style absolute path
            fileURI = "file://" + encodeURI(fsPath);
        } else {
            fileURI = "file:///" + encodeURI(fsPath);
        }

        var library = doc.library;

        // Check if an item with this name already exists in the library
        var existingItem = null;
        var items = library.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].name === libName) {
                existingItem = items[i];
                break;
            }
        }

        if (!existingItem) {
            // Import the file into the library.
            // document.importFile(uri, libraryItemName, importToLibraryFolder)
            var importResult = doc.importFile(fileURI, libName, true);
            if (!importResult) {
                return "ERROR: document.importFile failed for " + fileURI;
            }

            // Re-find the imported item by name
            items = library.items;
            for (var j = 0; j < items.length; j++) {
                if (items[j].name === libName) {
                    existingItem = items[j];
                    break;
                }
            }

            if (!existingItem) {
                return "ERROR: Imported file but could not locate library item '" + libName + "'.";
            }
        }

        if (existingItem.itemType !== "sound") {
            return "ERROR: Library item '" + libName + "' is not a sound item (type: " + existingItem.itemType + ").";
        }

        // Select the item in the library, then add it to the stage at the
        // current playhead position - Animate handles placing it onto the
        // active layer's current frame, same as a manual drag from the Library panel.
        library.selectItem(existingItem.name);

        var addResult = library.addItemToDocument({ x: 0, y: 0 });
        if (!addResult) {
            return "ERROR: library.addItemToDocument failed for '" + libName + "'.";
        }

        var timeline = doc.getTimeline();
        var layerIndex = timeline.currentLayer;
        var layerName = (layerIndex >= 0 && timeline.layers[layerIndex]) ? timeline.layers[layerIndex].name : "?";
        var frameIndex = timeline.currentFrame;

        return "OK: Added '" + libName + "' to stage on layer '" + layerName + "' at frame " + (frameIndex + 1) + ".";

    } catch (e) {
        return "ERROR: Exception - " + e.toString();
    }
}