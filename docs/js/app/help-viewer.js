(() => {
    const app = window.DicomViewerApp = window.DicomViewerApp || {};
    const { $ } = app.dom;
    const { escapeHtml } = app.utils;

    function setActiveHelpTocItem(sectionId) {
        document.querySelectorAll('.help-toc-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sectionId === sectionId);
        });
    }

    function onHelpContentScroll() {
        const contentEl = $('helpContent');
        if (!contentEl) return;

        const sections = Array.from(contentEl.querySelectorAll('.help-section'));
        if (!sections.length) return;

        const offset = contentEl.scrollTop + 40;
        let activeSectionId = sections[0].dataset.sectionId;

        for (const section of sections) {
            if (section.offsetTop <= offset) {
                activeSectionId = section.dataset.sectionId;
            } else {
                break;
            }
        }

        setActiveHelpTocItem(activeSectionId);
    }

    function renderHelpContent() {
        const tocEl = $('helpToc');
        const contentEl = $('helpContent');
        if (!tocEl || !contentEl || !Array.isArray(HELP_SECTIONS)) return;

        tocEl.innerHTML = HELP_SECTIONS.map(section => `
            <a href="#help-${escapeHtml(section.id)}" class="help-toc-item" data-section-id="${escapeHtml(section.id)}">
                ${escapeHtml(section.title)}
            </a>
        `).join('');

        // HELP_SECTIONS content is authored static HTML from help-content.js, not user input.
        contentEl.innerHTML = HELP_SECTIONS.map(section => `
            <section id="help-${escapeHtml(section.id)}" class="help-section" data-section-id="${escapeHtml(section.id)}">
                <h2>${escapeHtml(section.title)}</h2>
                ${section.content}
            </section>
        `).join('');

        tocEl.querySelectorAll('.help-toc-item').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                const sectionId = item.dataset.sectionId;
                const target = contentEl.querySelector(`#help-${CSS.escape(sectionId)}`);
                if (!target) return;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveHelpTocItem(sectionId);
            });
        });

        contentEl.removeEventListener('scroll', onHelpContentScroll);
        contentEl.addEventListener('scroll', onHelpContentScroll);
        onHelpContentScroll();
    }

    function openHelpViewer() {
        $('helpViewer').style.display = 'flex';
        renderHelpContent();
        const contentEl = $('helpContent');
        if (contentEl) contentEl.scrollTop = 0;
        onHelpContentScroll();
    }

    function closeHelpViewer() {
        $('helpViewer').style.display = 'none';
    }

    app.helpViewer = {
        closeHelpViewer,
        openHelpViewer
    };
})();
