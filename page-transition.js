// Lightweight page-view transition for same-tab navigation.
// Fades in on load and fades out before navigating.

(function () {
  const READY_CLASS = 'is-ready';
  const LEAVING_CLASS = 'is-leaving';

  function isModifiedClick(e) {
    return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
  }

  function isSameOriginLink(a) {
    try {
      const url = new URL(a.href, window.location.href);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function shouldHandleLink(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    if (!isSameOriginLink(a)) return false;
    if (a.getAttribute('href')?.startsWith('#')) return false;
    return true;
  }

  window.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
      document.body.classList.add(READY_CLASS);
    });
  });

  // Handle BFCache restore.
  window.addEventListener('pageshow', () => {
    document.body.classList.remove(LEAVING_CLASS);
    document.body.classList.add(READY_CLASS);
  });

  document.addEventListener('click', (e) => {
    if (isModifiedClick(e)) return;
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (!a) return;
    if (!shouldHandleLink(a)) return;

    const href = a.href;
    if (href === window.location.href) return;

    e.preventDefault();
    document.body.classList.remove(READY_CLASS);
    document.body.classList.add(LEAVING_CLASS);

    // Match CSS transition duration.
    window.setTimeout(() => {
      window.location.href = href;
    }, 180);
  });
})();

