// Runs in the page's own JS world on Alt / Collectr, before their scripts.
// Only for pages this extension opened (URL carries #gcp=… once; remembered per tab in sessionStorage):
// makes the site believe it is on a phone so it serves its mobile layout.
(function () {
  try {
    let on = /[#&]gcp=/.test(location.hash);
    if (on) sessionStorage.setItem('gcp-mobile', '1');
    else on = sessionStorage.getItem('gcp-mobile') === '1';
    if (!on) return;
    const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const def = (obj, key, val) => { try { Object.defineProperty(obj, key, { get: () => val, configurable: true }); } catch (e) { /* ignore */ } };
    const N = Navigator.prototype;
    def(N, 'userAgent', UA);
    def(N, 'appVersion', UA.replace('Mozilla/', ''));
    def(N, 'platform', 'iPhone');
    def(N, 'vendor', 'Apple Computer, Inc.');
    def(N, 'maxTouchPoints', 5);
    if ('userAgentData' in N) {
      def(N, 'userAgentData', { mobile: true, platform: 'iOS', brands: [], getHighEntropyValues: async () => ({ mobile: true, platform: 'iOS', model: 'iPhone' }), toJSON: () => ({ mobile: true, platform: 'iOS' }) });
    }
    if (!('ontouchstart' in window)) window.ontouchstart = null;
    const mm = window.matchMedia.bind(window);
    const fake = (q, matches) => ({ matches, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.matchMedia = (q) => {
      if (/\(\s*(pointer|any-pointer)\s*:\s*coarse\s*\)|\(\s*(hover|any-hover)\s*:\s*none\s*\)/i.test(q)) return fake(q, true);
      if (/\(\s*(pointer|any-pointer)\s*:\s*fine\s*\)|\(\s*(hover|any-hover)\s*:\s*hover\s*\)/i.test(q)) return fake(q, false);
      return mm(q);
    };
  } catch (e) { /* never break the page */ }
})();
