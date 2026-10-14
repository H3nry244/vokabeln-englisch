/**
 * Adaptiver Auswahl-Algorithmus für Vokabeln.
 *
 * Grundidee: Jedes Vokabel sammelt Punkte, bis es als "sitzt" gilt.
 * Richtig = +1 Punkt, falsch = -1 Punkt (nie unter 0), und ab `mastery`
 * Punkten (Standard: 5) ist das Vokabel gelernt. Ein Vokabel, das du auf
 * Anhieb kennst, wird also genau fünfmal gefragt; ein Vokabel, das du
 * nicht kennst, kommt entsprechend häufiger und jedes Mal früher zurück.
 *
 * Die Abstände zwischen zwei Abfragen desselben Vokabels wachsen mit dem
 * Punktestand (2, 4, 8, 16, 32 ... Fragen). Sichere Vokabeln rutschen
 * dadurch nach hinten, unsichere bleiben vorne - ohne dass du irgendetwas
 * einstellen musst.
 *
 * Dadurch lernt der Algorithmus, welche Vokabeln du kannst und welche nicht,
 * ohne dass du irgendetwas einstellen musst.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.VokabelScheduler = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
    'use strict';

    // Abstand in "Fragen" nach der n-ten richtigen Antwort in Folge.
    const BASE_GAPS = [2, 4, 8, 16, 32, 64, 128];

    const DEFAULTS = {
        mastery: 5,       // so oft richtig, bis ein Vokabel sitzt
        maxInFlight: 12,  // gleichzeitig "in Arbeit" befindliche Vokabeln
        jitter: 0.3,      // Streuung der Abstände, damit kein Muster entsteht
    };

    function keyOf(word) {
        return String(word.en || '').trim().toLowerCase();
    }

    class Scheduler {
        /**
         * @param {Array<{en: string, de: string}>} words
         * @param {Object} progress  vorheriger Stand: { [key]: {points, streak, lapses, correct, wrong} }
         * @param {Object} options   { mastery, maxInFlight, jitter, random }
         */
        constructor(words, progress, options) {
            this.options = Object.assign({}, DEFAULTS, options || {});
            this.mastery = Math.max(1, this.options.mastery | 0);
            this.random = this.options.random || Math.random;
            this.step = 0;

            const done = progress || {};
            this.cards = words.map(function (word, index) {
                const prev = done[keyOf(word)] || {};
                const points = Math.max(0, prev.points | 0);
                return {
                    key: keyOf(word),
                    index: index,
                    word: word,
                    points: points,
                    streak: Math.max(0, prev.streak | 0),
                    lapses: Math.max(0, prev.lapses | 0),
                    correct: Math.max(0, prev.correct | 0),
                    wrong: Math.max(0, prev.wrong | 0),
                    seen: points > 0 || (prev.lapses | 0) > 0,
                    mastered: points >= Math.max(1, (this.options.mastery | 0)),
                    due: 0,
                    askedInSession: 0
                };
            }, this);
        }

        /** Gleichmäßig verteilte Zufallszahl (injizierbar für Tests). */
        _rand() {
            return Math.random();
        }

        /** Nächstes Vokabel oder null, wenn alles sitzt. */
        next() {
            const open = this.cards.filter((c) => !c.mastered);
            if (!open.length) return null;

            const seen = open.filter((c) => c.seen);
            const fresh = open.filter((c) => !c.seen);

            // 1. Fällige Wiederholungen zuerst - die mit dem ältesten Termin.
            const dueNow = seen.filter((c) => c.due <= this.step);
            if (dueNow.length) return this._soonest(dueNow);

            // 2. Sonst ein neues Vokabel einführen (aber nicht zu viele auf einmal).
            if (fresh.length && seen.length < this.options.maxInFlight) {
                return fresh[Math.floor(this._rand() * fresh.length)];
            }

            // 3. Alles wartet noch: das mit dem frühesten Termin nehmen.
            if (seen.length) return this._soonest(seen);

            // 4. Nur noch neue Vokabeln übrig, Limit greift nicht mehr.
            return fresh[Math.floor(this._rand() * fresh.length)];
        }

        _soonest(list) {
            let best = list[0];
            for (let i = 1; i < list.length; i++) {
                if (list[i].due < best.due) best = list[i];
            }
            const ties = list.filter((c) => c.due === best.due);
            return ties[Math.floor(this._rand() * ties.length)];
        }

        /**
         * Ergebnis einer Antwort verbuchen.
         * @param {Object} card
         * @param {'correct'|'close'|'wrong'|'revealed'} outcome
         */
        grade(card, outcome) {
            const ok = outcome === 'correct' || outcome === 'close';
            card.seen = true;
            card.askedInSession++;

            if (ok) {
                card.correct++;
                card.streak++;
                card.points = Math.min(this.mastery, card.points + 1);
                if (card.points >= this.mastery) {
                    card.mastered = true;
                    card.due = Infinity;
                } else {
                    card.due = this.step + this._gapAfter(card.points);
                }
            } else {
                card.wrong++;
                card.lapses++;
                card.streak = 0;
                card.points = Math.max(0, card.points - 1);
                card.due = this.step + 1 + Math.floor(this._rand() * 3);
            }

            this.step++;
            return card;
        }

        _gapAfter(points) {
            const base = BASE_GAPS[Math.min(points, BASE_GAPS.length - 1)];
            const j = this.options.jitter;
            const factor = 1 - j + this._rand() * 2 * j;
            return Math.max(1, Math.round(base * factor));
        }

        /** Aktueller Stand zum Speichern. */
        serialize() {
            const out = {};
            this.cards.forEach((c) => {
                out[c.key] = {
                    points: c.points,
                    streak: c.streak,
                    lapses: c.lapses,
                    correct: c.correct,
                    wrong: c.wrong
                };
            });
            return out;
        }

        get total() { return this.cards.length; }
        get masteredCount() { return this.cards.filter((c) => c.mastered).length; }
        get openCount() { return this.cards.filter((c) => !c.mastered).length; }
        get masteredThisSession() { return this.cards.filter((c) => c.mastered && c.askedInSession > 0); }
    }

    return { Scheduler: Scheduler, BASE_GAPS: BASE_GAPS, keyOf: keyOf };
});
