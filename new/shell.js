document.addEventListener('DOMContentLoaded', () => {
  const categoryDetails = document.querySelector('details.category-label-container');
  const paperContainer = document.getElementById('paperContainer');
  const clearButton = document.getElementById('textSearchClear');
  const paperModal = document.getElementById('paperModal');
  const layoutSwitch = document.getElementById('readerLayoutSwitch');
  const layoutStorageKey = 'ctcmp-reader-layout';
  const validLayouts = new Set(['info-left', 'info-right', 'pdf-only']);

  const setReaderLayout = layout => {
    const nextLayout = validLayouts.has(layout) ? layout : 'info-right';
    if (paperModal) paperModal.dataset.readerLayout = nextLayout;
    layoutSwitch?.querySelectorAll('[data-reader-layout]').forEach(option => {
      option.setAttribute('aria-checked', String(option.dataset.readerLayout === nextLayout));
      option.tabIndex = option.dataset.readerLayout === nextLayout ? 0 : -1;
    });
    try { localStorage.setItem(layoutStorageKey, nextLayout); } catch (_) { /* Storage can be unavailable. */ }
  };

  let savedLayout = 'info-right';
  try { savedLayout = localStorage.getItem(layoutStorageKey) || savedLayout; } catch (_) { /* Use default. */ }
  setReaderLayout(savedLayout);

  layoutSwitch?.addEventListener('click', event => {
    const option = event.target.closest('[data-reader-layout]');
    if (!option) return;
    setReaderLayout(option.dataset.readerLayout);
  });

  layoutSwitch?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const options = [...layoutSwitch.querySelectorAll('[data-reader-layout]')];
    const currentIndex = options.indexOf(document.activeElement);
    event.preventDefault();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextOption = options[(currentIndex + direction + options.length) % options.length];
    if (nextOption) {
      setReaderLayout(nextOption.dataset.readerLayout);
      nextOption.focus();
    }
  });

  const keepDesktopCollectionsOpen = () => {
    if (categoryDetails && window.innerWidth >= 900) categoryDetails.open = true;
  };

  keepDesktopCollectionsOpen();
  window.addEventListener('resize', keepDesktopCollectionsOpen, { passive: true });

  if (clearButton) {
    const observer = new MutationObserver(() => {
      clearButton.hidden = clearButton.style.display === 'none';
    });
    observer.observe(clearButton, { attributes: true, attributeFilter: ['style'] });
  }

  if (paperContainer) {
    const labelCards = () => {
      paperContainer.querySelectorAll('.paper-card').forEach(card => {
        if (!card.hasAttribute('tabindex')) {
          card.setAttribute('tabindex', '0');
          card.setAttribute('role', 'button');
          card.setAttribute('aria-label', `Open paper: ${card.querySelector('.paper-card-title')?.textContent || ''}`);
          card.addEventListener('keydown', event => {
            if (event.key === 'Enter') card.click();
          });
        }
      });
    };

    new MutationObserver(labelCards).observe(paperContainer, { childList: true, subtree: true });
    labelCards();
  }
});
