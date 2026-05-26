// Interactivity for the lilbee for Obsidian landing page: the demo-reel tabs
// and the copy-to-clipboard button on the install slug.

(function () {
  'use strict';

  /** Wire every [role="tablist"] on the page (the demo reel, anything else
      with the same ARIA shape). Click selection plus left/right arrow-key
      navigation. */
  function initTablists() {
    var tablists = document.querySelectorAll('[role="tablist"]');
    Array.prototype.forEach.call(tablists, function (tablist) {
      var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));

      function select(tab) {
        tabs.forEach(function (candidate) {
          var active = candidate === tab;
          candidate.setAttribute('aria-selected', active ? 'true' : 'false');
          candidate.tabIndex = active ? 0 : -1;
          var pane = document.getElementById(candidate.getAttribute('aria-controls'));
          if (pane) pane.hidden = !active;
        });
      }

      tablist.addEventListener('click', function (event) {
        var tab = event.target.closest('[role="tab"]');
        if (!tab) return;
        select(tab);
        tab.focus();
      });

      tablist.addEventListener('keydown', function (event) {
        var index = tabs.indexOf(document.activeElement);
        if (index < 0) return;
        var step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        var next = tabs[(index + step + tabs.length) % tabs.length];
        select(next);
        next.focus();
      });
    });
  }

  /** Copy the install slug to the clipboard when its [ COPY ] button is clicked. */
  function initCopyButton() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('.copy');
      if (!button) return;
      var row = button.closest('.install');
      var slug = row ? row.querySelector('.cmd') : null;
      copyText(slug ? slug.textContent : '', function () { flashCopied(button); });
    });
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
      return;
    }
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (error) { /* clipboard unavailable */ }
    document.body.removeChild(area);
    done();
  }

  function flashCopied(button) {
    if (button.textContent.indexOf('COPIED') !== -1) return;
    var original = button.textContent;
    button.textContent = '[ COPIED ]';
    setTimeout(function () { button.textContent = original; }, 1200);
  }

  initTablists();
  initCopyButton();
})();
