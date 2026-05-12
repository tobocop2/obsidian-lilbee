// Interactivity for the lilbee for Obsidian landing page: the
// copy-to-clipboard button on the install slug.

(function () {
  'use strict';

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

  initCopyButton();
})();
