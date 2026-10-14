/**
 * Persistenz: Fortschritt und Einstellungen liegen im localStorage des Browsers.
 * Schlüssel sind versioniert, damit spätere Formatänderungen nichts kaputt machen.
 */
(function (root) {
    'use strict';

    const PROGRESS_KEY = 'vokabeln.progress.v1';
    const SETTINGS_KEY = 'vokabeln.settings.v1';

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : fallback;
        } catch (err) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (err) {
            return false;
        }
    }

    function scope(topicId, direction) {
        return topicId + '|' + direction;
    }

    const Store = {
        /** Fortschritt eines Themas in einer Richtung. */
        loadProgress(topicId, direction) {
            const all = readJSON(PROGRESS_KEY, {});
            return all[scope(topicId, direction)] || {};
        },

        saveProgress(topicId, direction, progress) {
            const all = readJSON(PROGRESS_KEY, {});
            all[scope(topicId, direction)] = progress;
            return writeJSON(PROGRESS_KEY, all);
        },

        clearProgress(topicId, direction) {
            const all = readJSON(PROGRESS_KEY, {});
            if (topicId) {
                const prefix = topicId + '|';
                Object.keys(all).forEach((k) => {
                    if (direction ? k === scope(topicId, direction) : k.indexOf(prefix) === 0) {
                        delete all[k];
                    }
                });
            } else {
                return writeJSON(PROGRESS_KEY, {});
            }
            return writeJSON(PROGRESS_KEY, all);
        },

        loadSettings() {
            return readJSON(SETTINGS_KEY, {});
        },

        saveSettings(patch) {
            const next = Object.assign(readJSON(SETTINGS_KEY, {}), patch);
            writeJSON(SETTINGS_KEY, next);
            return next;
        }
    };

    root.VokabelStore = Store;
})(window);
