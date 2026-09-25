/* Eigene Datei statt Inline-Script, weil script-src auf 'self' steht.
   Laedt synchron vor dem Stilblatt, sonst erscheint kurz das falsche Theme. */
(function () {
  try {
    var t = localStorage.getItem('kriterion.theme') || localStorage.getItem('kriterion.thema');
    var light = t === 'light' || (t === 'device' && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
