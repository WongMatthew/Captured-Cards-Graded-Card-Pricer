/* global GCPPlatforms */
// Runs on eBay search pages the user opens. On a Sold/Completed results page it reads the listings
// and hands them to the side panel (used when eBay turns away the panel's own background request).
(function () {
  if (window.top !== window || window.__gcpEbayReader) return;
  window.__gcpEbayReader = true;
  const params = new URLSearchParams(location.search);
  if (params.get('LH_Sold') !== '1' && params.get('LH_Complete') !== '1') return;
  function read() {
    const sales = GCPPlatforms.parseEbay(document);
    if (!sales.length) return;
    chrome.runtime.sendMessage({
      type: 'ebay-page-sales', url: location.href, nkw: params.get('_nkw') || '',
      sales: sales.map(s => ({ ...s, date: s.date.toISOString() }))
    }).catch(() => {});
  }
  if (document.readyState === 'complete') read(); else window.addEventListener('load', read);
})();
