/**
 * Vokabeln · Oberfläche und Ablauf
 *
 * Ablauf: Thema wählen → Karte für Karte abfragen → Ergebnis.
 * Der Fortschritt pro Vokabel wird nach jeder Antwort gespeichert, damit
 * der Algorithmus beim nächsten Mal dort weitermacht, wo du aufgehört hast.
 */
(function () {
    'use strict';

    const Store = window.VokabelStore;
    const { Scheduler } = window.VokabelScheduler;

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

    const ICONS = {
        sun: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.5 6.5 4.9 4.9M19.1 19.1l-1.6-1.6M17.5 6.5l1.6-1.6M4.9 19.1l1.6-1.6"/></svg>',
        moon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4Z"/></svg>',
        check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg>',
        cross: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        dash: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>'
    };

    const settings = Store.loadSettings();

    const state = {
        topics: [],
        topicId: settings.topicId || null,
        direction: settings.direction === 'en-de' ? 'en-de' : 'de-en',
        mastery: [3, 5, 7, 10].indexOf(settings.mastery) >= 0 ? settings.mastery : 5,
        scheduler: null,
        card: null,
        phase: 'ask',            // 'ask' | 'review'
        session: { asked: 0, correct: 0, mastered: 0 }
    };

    const el = {
        screens: {},
        topicList: $('#topic-list'),
        loadingNote: $('#loading-note'),
        startBtn: $('#start-btn'),
        resetBtn: $('#reset-btn'),
        direction: $('#direction'),
        mastery: $('#mastery'),
        themeToggle: $('#theme-toggle'),
        studyBack: $('#study-back'),
        studyTopic: $('#study-topic'),
        studyCounter: $('#study-counter'),
        studyProgress: $('#study-progress'),
        card: $('#card'),
        cardHint: $('#card-hint'),
        cardWord: $('#card-word'),
        input: $('#answer-input'),
        feedback: $('#feedback'),
        feedbackMark: $('#feedback-mark'),
        feedbackText: $('#feedback-text'),
        dots: $('#dots'),
        checkBtn: $('#check-btn'),
        skipBtn: $('#skip-btn'),
        summaryEyebrow: $('#summary-eyebrow'),
        summaryTitle: $('#summary-title'),
        summarySubtitle: $('#summary-subtitle'),
        summaryStats: $('#summary-stats'),
        summaryOpen: $('#summary-open'),
        summaryOpenPanel: $('#summary-open-panel'),
        summaryContinue: $('#summary-continue'),
        summaryHome: $('#summary-home')
    };

    /* ==================================================================== */
    /* Erscheinungsbild                                                      */
    /* ==================================================================== */

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        el.themeToggle.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
        const meta = $('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#f5f5f7');
    }

    function initTheme() {
        const stored = localStorage.getItem('vokabeln.theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light'));
    }

    el.themeToggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        localStorage.setItem('vokabeln.theme', next);
        applyTheme(next);
    });

    /* ==================================================================== */
    /* Antwortprüfung                                                        */
    /* ==================================================================== */

    const ARTICLES = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/;

    function normalize(value) {
        return String(value)
            .toLowerCase()
            .replace(/[‘’ʼ]/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/^[\s\-–—]+/, '')
            .replace(/[\s.!?,;:]+$/, '')
            .trim();
    }

    /** Alle zulässigen Schreibweisen einer Lösung ("a / b", "a, b", Klammern). */
    function variantsOf(answer) {
        const found = [];
        const seen = new Set();

        function add(raw) {
            const v = normalize(raw);
            if (!v || seen.has(v)) return;
            seen.add(v);
            found.push(v);
        }

        const bare = String(answer).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ');
        bare.split(/[,;/]/).forEach(add);
        add(bare);
        String(answer).split(/[,;/]/).forEach(add);

        // Führende Artikel bzw. "to"/"sich" sind optional.
        found.slice().forEach((v) => {
            add(v.replace(ARTICLES, ''));
            add(v.replace(/^(to|sich)\s+/, ''));
        });

        return found;
    }

    /** Editierabstand mit Obergrenze; -1 wenn größer als max. */
    function distance(a, b, max) {
        if (a === b) return 0;
        if (Math.abs(a.length - b.length) > max) return -1;

        let prev = new Array(b.length + 1);
        let curr = new Array(b.length + 1);
        for (let j = 0; j <= b.length; j++) prev[j] = j;

        for (let i = 1; i <= a.length; i++) {
            curr[0] = i;
            let rowMin = curr[0];
            for (let j = 1; j <= b.length; j++) {
                const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
                if (curr[j] < rowMin) rowMin = curr[j];
            }
            if (rowMin > max) return -1;
            const swap = prev;
            prev = curr;
            curr = swap;
        }
        return prev[b.length] <= max ? prev[b.length] : -1;
    }

    function toleranceFor(length) {
        if (length >= 20) return 3;
        if (length >= 10) return 2;
        if (length >= 5) return 1;
        return 0;
    }

    /**
     * @returns {{status:'empty'|'correct'|'close'|'wrong', expected:string, typed:string}}
     */
    function evaluate(input, answer) {
        const typed = normalize(input);
        if (!typed) return { status: 'empty', expected: answer, typed: '' };

        const variants = variantsOf(answer);
        if (variants.indexOf(typed) !== -1) {
            return { status: 'correct', expected: answer, typed: typed };
        }

        let closest = null;
        let closestDistance = Infinity;
        for (let i = 0; i < variants.length; i++) {
            const max = toleranceFor(variants[i].length);
            if (!max) continue;
            const d = distance(typed, variants[i], max);
            if (d >= 0 && d < closestDistance) {
                closestDistance = d;
                closest = variants[i];
            }
        }

        if (closest) {
            return { status: 'close', expected: closest, typed: typed };
        }
        return { status: 'wrong', expected: answer, typed: typed };
    }

    /* ==================================================================== */
    /* Daten                                                                 */
    /* ==================================================================== */

    async function loadTopics() {
        const response = await fetch('data/topics.json', { cache: 'no-cache' });
        if (!response.ok) throw new Error('topics.json nicht gefunden');
        const list = await response.json();

        return Promise.all(list.map(async (topic) => {
            try {
                const res = await fetch('data/' + topic.id + '.json', { cache: 'no-cache' });
                if (!res.ok) throw new Error('fehlt');
                const words = await res.json();
                return { id: topic.id, title: topic.title, words: words, broken: false };
            } catch (err) {
                return { id: topic.id, title: topic.title, words: [], broken: true };
            }
        }));
    }

    function currentTopic() {
        for (let i = 0; i < state.topics.length; i++) {
            if (state.topics[i].id === state.topicId) return state.topics[i];
        }
        return state.topics[0] || null;
    }

    function progressOf(topic, direction) {
        if (!topic || topic.broken) return { mastered: 0, total: 0 };
        const saved = Store.loadProgress(topic.id, direction);
        const mastery = state.mastery;
        let mastered = 0;
        topic.words.forEach((w) => {
            const p = saved[window.VokabelScheduler.keyOf(w)];
            if (p && (p.points | 0) >= mastery) mastered++;
        });
        return { mastered: mastered, total: topic.words.length };
    }

    /* ==================================================================== */
    /* Übersicht                                                             */
    /* ==================================================================== */

    function renderTopics() {
        el.topicList.innerHTML = '';

        state.topics.forEach((topic) => {
            const stats = progressOf(topic, state.direction);
            const percent = stats.total ? Math.round((stats.mastered / stats.total) * 100) : 0;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'topic' + (topic.broken ? ' topic--error' : '');
            btn.setAttribute('role', 'radio');
            btn.setAttribute('aria-checked', String(topic.id === state.topicId));
            btn.innerHTML =
                '<span class="topic__name"></span>' +
                '<span class="topic__meta"></span>' +
                '<span class="topic__bar"><i></i></span>';

            $('.topic__name', btn).textContent = topic.title;
            $('.topic__meta', btn).textContent = topic.broken
                ? 'Daten fehlen'
                : stats.mastered + ' von ' + stats.total;
            $('.topic__bar > i', btn).style.width = percent + '%';

            if (!topic.broken) {
                btn.addEventListener('click', () => selectTopic(topic.id));
            }
            el.topicList.appendChild(btn);
        });

        updateStartButton();
    }

    function selectTopic(id) {
        state.topicId = id;
        Store.saveSettings({ topicId: id });
        $$('.topic', el.topicList).forEach((btn, index) => {
            btn.setAttribute('aria-checked', String(state.topics[index].id === id));
        });
        updateStartButton();
    }

    function updateStartButton() {
        const topic = currentTopic();
        const ready = !!topic && !topic.broken && topic.words.length > 0;
        const open = topic ? progressOf(topic, state.direction) : { mastered: 0, total: 0 };
        el.startBtn.disabled = !ready;

        if (!ready) {
            el.startBtn.textContent = 'Lernen starten';
        } else if (open.total && open.mastered >= open.total) {
            el.startBtn.textContent = 'Alle Vokabeln sitzen – trotzdem wiederholen';
        } else {
            el.startBtn.textContent = 'Lernen starten';
        }
    }

    /* ==================================================================== */
    /* Bildschirme                                                           */
    /* ==================================================================== */

    function show(screenName) {
        Object.keys(el.screens).forEach((name) => {
            const node = el.screens[name];
            const active = name === screenName;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-hidden', String(!active));
        });
        window.scrollTo(0, 0);
    }

    /* ==================================================================== */
    /* Lernen                                                                */
    /* ==================================================================== */

    function startSession() {
        const topic = currentTopic();
        if (!topic || !topic.words.length) return;

        const progress = Store.loadProgress(topic.id, state.direction);
        state.scheduler = new Scheduler(topic.words, progress, { mastery: state.mastery });
        state.session = { asked: 0, correct: 0, mastered: 0 };

        el.studyTopic.textContent = topic.title;
        show('study');

        if (!advance()) {
            showSummary();
        }
    }

    /** Nächste Karte holen; false, wenn alles sitzt. */
    function advance() {
        const card = state.scheduler.next();
        if (!card) return false;

        state.card = card;
        state.phase = 'ask';

        const toEnglish = state.direction === 'de-en';
        el.cardHint.textContent = toEnglish ? 'Übersetze ins Englische' : 'Übersetze ins Deutsche';
        el.cardWord.textContent = toEnglish ? card.word.de : card.word.en;

        el.input.value = '';
        el.input.disabled = false;
        el.feedback.hidden = true;
        el.feedbackText.textContent = '';
        el.feedbackMark.innerHTML = '';
        el.card.classList.remove('is-correct', 'is-wrong', 'is-close');

        el.checkBtn.textContent = 'Prüfen';
        el.checkBtn.disabled = true;
        el.skipBtn.hidden = false;
        el.checkBtn.hidden = false;

        renderDots();
        updateProgressBar();
        el.input.focus();
        return true;
    }

    function renderDots() {
        const card = state.card;
        el.dots.innerHTML = '';
        if (!card) return;

        for (let i = 0; i < state.mastery; i++) {
            const pip = document.createElement('span');
            pip.className = 'dots__pip' + (i < card.points ? ' is-filled' : '');
            el.dots.appendChild(pip);
        }

        const label = document.createElement('span');
        label.className = 'dots__label';
        label.textContent = card.points >= state.mastery
            ? 'sitzt'
            : card.points + '/' + state.mastery + ' richtig';
        el.dots.appendChild(label);
    }

    function updateProgressBar() {
        const total = state.scheduler.total;
        const mastered = state.scheduler.masteredCount;
        el.studyCounter.textContent = mastered + '/' + total;
        el.studyProgress.style.width = (total ? (mastered / total) * 100 : 0) + '%';
    }

    function check() {
        if (state.phase !== 'ask' || !state.card) return;

        const card = state.card;
        const answer = state.direction === 'de-en' ? card.word.en : card.word.de;
        const result = evaluate(el.input.value, answer);
        if (result.status === 'empty') return;

        const correct = result.status === 'correct' || result.status === 'close';
        state.session.asked++;
        if (correct) state.session.correct++;

        const wasMastered = card.mastered;
        state.scheduler.grade(card, result.status);
        if (!wasMastered && card.mastered) state.session.mastered++;

        el.card.classList.remove('is-correct', 'is-wrong', 'is-close');
        el.card.classList.add('is-' + result.status);
        el.feedback.hidden = false;
        el.feedback.className = 'feedback feedback--' + result.status;
        el.input.disabled = true;

        if (result.status === 'correct') {
            el.feedbackMark.innerHTML = ICONS.check;
            el.feedbackText.textContent = card.mastered
                ? 'Richtig – das sitzt jetzt.'
                : 'Richtig';
        } else if (result.status === 'close') {
            el.feedbackMark.innerHTML = ICONS.check;
            el.feedbackText.textContent = 'Fast richtig – geschrieben wird es „' + result.expected + '“';
        } else {
            el.feedbackMark.innerHTML = ICONS.cross;
            el.feedbackText.textContent = 'Lösung: ' + result.expected;
        }

        el.checkBtn.textContent = 'Weiter';
        el.skipBtn.hidden = true;
        state.phase = 'review';

        persist();
        renderDots();
        updateProgressBar();
        el.checkBtn.focus();
    }

    function reveal() {
        if (state.phase !== 'ask' || !state.card) return;
        el.input.value = '';
        el.input.disabled = true;

        const card = state.card;
        const answer = state.direction === 'de-en' ? card.word.en : card.word.de;

        state.session.asked++;
        state.scheduler.grade(card, 'revealed');

        el.card.classList.add('is-wrong');
        el.feedback.hidden = false;
        el.feedback.className = 'feedback feedback--wrong';
        el.feedbackMark.innerHTML = ICONS.dash;
        el.feedbackText.textContent = 'Lösung: ' + answer;

        el.checkBtn.textContent = 'Weiter';
        el.skipBtn.hidden = true;
        state.phase = 'review';

        persist();
        renderDots();
        updateProgressBar();
        el.checkBtn.focus();
    }

    function nextStep() {
        if (state.phase !== 'review') return;
        if (!advance()) showSummary();
    }

    function persist() {
        if (!state.scheduler) return;
        Store.saveProgress(state.topicId, state.direction, state.scheduler.serialize());
    }

    /* ==================================================================== */
    /* Ergebnis                                                              */
    /* ==================================================================== */

    function showSummary() {
        const s = state.scheduler;
        const asked = state.session.asked;
        const rate = asked ? Math.round((state.session.correct / asked) * 100) : 0;

        el.summaryEyebrow.textContent = s.openCount === 0 ? 'Thema abgeschlossen' : 'Runde abgeschlossen';
        el.summaryTitle.textContent = s.openCount === 0 ? 'Alle Vokabeln sitzen' : 'Gut gemacht';
        el.summarySubtitle.textContent = s.openCount === 0
            ? 'Du hast jedes Vokabel dieses Themas ' + state.mastery + '-mal richtig beantwortet.'
            : 'Noch ' + s.openCount + ' Vokabeln sind nicht sicher. Weiter geht’s genau da, wo du aufgehört hast.';

        el.summaryStats.innerHTML = '';
        [
            { value: asked, label: 'Fragen' },
            { value: rate + '%', label: 'Richtig' },
            { value: state.session.mastered, label: 'Neu gelernt' }
        ].forEach((stat) => {
            const node = document.createElement('div');
            node.className = 'stat';
            node.innerHTML = '<span class="stat__value"></span><span class="stat__label"></span>';
            $('.stat__value', node).textContent = String(stat.value);
            $('.stat__label', node).textContent = stat.label;
            el.summaryStats.appendChild(node);
        });

        const open = s.cards
            .filter((c) => !c.mastered)
            .sort((a, b) => (b.lapses - a.lapses) || (a.points - b.points));

        el.summaryOpen.innerHTML = '';
        if (!open.length) {
            el.summaryOpenPanel.style.display = 'none';
        } else {
            el.summaryOpenPanel.style.display = '';
            $('#summary-open-label').textContent = 'Noch nicht sicher · ' + open.length;
            open.slice(0, 40).forEach((card) => {
                const li = document.createElement('li');
                li.className = 'wordlist__row';
                li.innerHTML = '<span><span class="wordlist__en"></span> – <span class="wordlist__de"></span></span>' +
                               '<span class="wordlist__tag"></span>';
                $('.wordlist__en', li).textContent = card.word.en;
                $('.wordlist__de', li).textContent = card.word.de;
                $('.wordlist__tag', li).textContent = card.points + '/' + state.mastery;
                el.summaryOpen.appendChild(li);
            });
        }

        el.summaryContinue.textContent = s.openCount === 0 ? 'Nochmal von vorne' : 'Weiter lernen';
        show('summary');
    }

    function continueAfterSummary() {
        const s = state.scheduler;
        if (s.openCount === 0) {
            // Alles sitzt: Punkte zurücksetzen, Statistik behalten, Runde neu starten.
            s.cards.forEach((c) => {
                c.points = 0;
                c.streak = 0;
                c.mastered = false;
                c.seen = true;
                c.due = 0;
                c.askedInSession = 0;
            });
            s.step = 0;
            Store.saveProgress(state.topicId, state.direction, s.serialize());
        }
        state.session = { asked: 0, correct: 0, mastered: 0 };
        show('study');
        if (!advance()) showSummary();
    }

    /* ==================================================================== */
    /* Interaktion                                                           */
    /* ==================================================================== */

    el.input.addEventListener('input', () => {
        if (state.phase === 'ask') el.checkBtn.disabled = el.input.value.trim() === '';
    });

    el.input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (state.phase === 'ask') check();
            else nextStep();
        }
    });

    el.checkBtn.addEventListener('click', () => {
        if (state.phase === 'ask') check();
        else nextStep();
    });

    el.skipBtn.addEventListener('click', reveal);

    el.studyBack.addEventListener('click', () => {
        persist();
        renderTopics();
        show('start');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const active = $('.screen.is-active');
        if (!active) return;
        if (active.dataset.screen === 'study') {
            persist();
            renderTopics();
            show('start');
        }
    });

    if (el.summaryContinue) el.summaryContinue.addEventListener('click', continueAfterSummary);
    el.summaryHome.addEventListener('click', () => {
        renderTopics();
        show('start');
    });

    el.resetBtn.addEventListener('click', () => {
        const topic = currentTopic();
        if (!topic) return;
        const sure = window.confirm('Fortschritt für „' + topic.title + '“ (' + state.direction + ') zurücksetzen?');
        if (!sure) return;
        Store.clearProgress(topic.id);
        renderTopics();
        toast('Fortschritt zurückgesetzt');
    });

    function setupSegmented(container, onPick) {
        container.addEventListener('click', (event) => {
            const button = event.target.closest('.segmented__item');
            if (!button || button.disabled) return;
            $$('.segmented__item', container).forEach((item) => {
                item.setAttribute('aria-checked', String(item === button));
            });
            onPick(button.dataset.value);
        });
    }

    setupSegmented(el.direction, (value) => {
        state.direction = value;
        Store.saveSettings({ direction: value });
        renderTopics();
    });

    setupSegmented(el.mastery, (value) => {
        state.mastery = parseInt(value, 10);
        Store.saveSettings({ mastery: state.mastery });
        renderTopics();
    });

    function toast(message) {
        const node = document.createElement('div');
        node.className = 'toast';
        node.textContent = message;
        document.body.appendChild(node);
        requestAnimationFrame(() => node.classList.add('is-visible'));
        setTimeout(() => {
            node.classList.remove('is-visible');
            setTimeout(() => node.remove(), 300);
        }, 2000);
    }

    /* ==================================================================== */
    /* Start                                                                 */
    /* ==================================================================== */

    function markSegmented(container, value) {
        $$('.segmented__item', container).forEach((item) => {
            item.setAttribute('aria-checked', String(item.dataset.value === String(value)));
        });
    }

    async function init() {
        initTheme();
        $$('.screen').forEach((node) => { el.screens[node.dataset.screen] = node; });
        show('start');

        markSegmented(el.direction, state.direction);
        markSegmented(el.mastery, state.mastery);

        try {
            state.topics = await loadTopics();
        } catch (err) {
            el.loadingNote.textContent = 'Die Vokabeldaten konnten nicht geladen werden. Auf GitHub Pages funktioniert die Seite; lokal braucht sie einen kleinen Webserver.';
            return;
        }

        el.loadingNote.hidden = true;
        if (!state.topicId || !state.topics.some((t) => t.id === state.topicId)) {
            state.topicId = state.topics.length ? state.topics[0].id : null;
        }
        renderTopics();
    }

    init();
})();
