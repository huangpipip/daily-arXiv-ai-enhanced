document.addEventListener('DOMContentLoaded', () => {
  const categoryDetails = document.querySelector('details.category-label-container');
  const headerContent = document.querySelector('.header-content');
  const catalogBar = document.querySelector('.catalog-bar');
  const dataSourcePanel = document.querySelector('.header-side-left');
  const paperContainer = document.getElementById('paperContainer');
  const clearButton = document.getElementById('textSearchClear');
  const paperModal = document.getElementById('paperModal');
  const layoutSwitch = document.getElementById('readerLayoutSwitch');
  const layoutStorageKey = 'ctcmp-reader-layout';
  const validLayouts = new Set(['info-left', 'info-right', 'pdf-only']);
  const dataSourceHome = document.createComment('data-source-home');
  if (dataSourcePanel) dataSourcePanel.before(dataSourceHome);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  document.body.classList.toggle('is-standalone', isStandalone);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    }));
  }

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

  const placeDataSourceSelector = () => {
    if (!dataSourcePanel || !catalogBar || !headerContent) return;
    if (window.innerWidth < 900) {
      if (dataSourcePanel.parentElement !== catalogBar) catalogBar.prepend(dataSourcePanel);
    } else if (dataSourcePanel.parentElement !== headerContent) {
      dataSourceHome.after(dataSourcePanel);
    }
  };

  keepDesktopCollectionsOpen();
  placeDataSourceSelector();
  window.addEventListener('resize', keepDesktopCollectionsOpen, { passive: true });
  window.addEventListener('resize', placeDataSourceSelector, { passive: true });

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

  const installButton = document.getElementById('installAppButton');
  const installPrompt = document.getElementById('installPrompt');
  const installBackdrop = document.getElementById('installPromptBackdrop');
  const installClose = document.getElementById('installPromptClose');
  const installDismiss = document.getElementById('installPromptDismiss');
  const installAction = document.getElementById('installPromptAction');
  const installSteps = document.getElementById('installPromptSteps');
  const installVisitKey = 'ctcmp-install-visits';
  const installDismissedKey = 'ctcmp-install-dismissed-until';
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let deferredInstallPrompt = null;
  let overflowBeforeInstallPrompt = '';

  const updateInstallInstructions = () => {
    if (!installSteps || !installAction) return;
    if (deferredInstallPrompt) {
      installSteps.innerHTML = '<strong>Ready to install.</strong> CTCMP Daily will open without the browser toolbar.';
      installAction.textContent = 'Install app';
    } else if (isIos) {
      installSteps.innerHTML = 'Tap the <strong>Share</strong> button in Safari, then choose <strong>Add to Home Screen</strong>.';
      installAction.textContent = 'Got it';
    } else {
      installSteps.innerHTML = 'Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.';
      installAction.textContent = 'Got it';
    }
  };

  const closeInstallPrompt = () => {
    if (!installPrompt || !installBackdrop) return;
    installPrompt.hidden = true;
    installBackdrop.hidden = true;
    document.body.style.overflow = overflowBeforeInstallPrompt;
  };

  const openInstallPrompt = () => {
    if (isStandalone || !installPrompt || !installBackdrop) return;
    updateInstallInstructions();
    overflowBeforeInstallPrompt = document.body.style.overflow;
    installPrompt.hidden = false;
    installBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    installAction?.focus();
  };

  if (!isStandalone && installButton) installButton.hidden = false;
  installButton?.addEventListener('click', openInstallPrompt);
  installClose?.addEventListener('click', closeInstallPrompt);
  installBackdrop?.addEventListener('click', closeInstallPrompt);
  installDismiss?.addEventListener('click', () => {
    try { localStorage.setItem(installDismissedKey, String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch (_) { /* Ignore storage failures. */ }
    closeInstallPrompt();
  });
  installAction?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      closeInstallPrompt();
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    closeInstallPrompt();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallInstructions();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (installButton) installButton.hidden = true;
    closeInstallPrompt();
  });

  if (!isStandalone && window.matchMedia('(max-width: 899px)').matches) {
    let visits = 1;
    let dismissedUntil = 0;
    try {
      visits = Number(localStorage.getItem(installVisitKey) || 0) + 1;
      dismissedUntil = Number(localStorage.getItem(installDismissedKey) || 0);
      localStorage.setItem(installVisitKey, String(visits));
    } catch (_) { /* Keep the non-intrusive default. */ }
    if (visits >= 2 && Date.now() > dismissedUntil) setTimeout(openInstallPrompt, 1600);
  }

  if (isStandalone) {
    const scrollStorageKey = 'ctcmp-standalone-scroll-y';
    let savedScrollY = 0;
    try { savedScrollY = Number(localStorage.getItem(scrollStorageKey) || 0); } catch (_) { /* Ignore storage failures. */ }
    if (savedScrollY > 0 && paperContainer) {
      const restoreScroll = () => {
        if (!paperContainer.querySelector('.paper-card')) return false;
        requestAnimationFrame(() => window.scrollTo(0, savedScrollY));
        return true;
      };
      if (!restoreScroll()) {
        const restoreObserver = new MutationObserver(() => {
          if (restoreScroll()) restoreObserver.disconnect();
        });
        restoreObserver.observe(paperContainer, { childList: true, subtree: true });
      }
    }
    window.addEventListener('pagehide', () => {
      try { localStorage.setItem(scrollStorageKey, String(Math.round(window.scrollY))); } catch (_) { /* Ignore storage failures. */ }
    });
  }

  window.addEventListener('popstate', () => {
    if (paperModal?.classList.contains('active') && typeof window.closeModal === 'function') window.closeModal(true);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && installPrompt && !installPrompt.hidden) closeInstallPrompt();
  });
});
