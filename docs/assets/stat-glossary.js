(() => {
  const content = document.getElementById('content_root');
  const terms = new Set([
    'xOPS', 'BB%', 'Wk/PA', 'Bar/PA', 'Pwr/PA', 'ICR/PA', 'SwSp%', 'P/PA',
    'Whiff%', 'CSW%', 'Good Swings', 'Bad Swings', 'Fan Val', 'pVelo', 'QS/SV',
    'WHIP', 'SwStr%', 'Strike%', 'Loc for Con', 'Loc for K/BB', 'pERA', 'Pitches +/-',
    'rAll', 'Squared', 'Eye', 'Stf', 'Funkiness', 'Matchup Score'
  ]);
  const definitions = new Map();
  let glossaryRequest;
  function loadGlossary() {
    if (!glossaryRequest) {
      glossaryRequest = fetch('pages/key.html').then(async response => {
        if (!response.ok) throw new Error('Glossary unavailable');
        const key = new DOMParser().parseFromString(await response.text(), 'text/html');
        key.querySelectorAll('.key_table tbody tr').forEach(row => {
          const label = row.cells[0]?.querySelector('b')?.textContent.trim();
          if (!terms.has(label)) return;
          const definition = [...row.cells].slice(0, 2)
            .map(cell => cell.textContent.trim()).filter(text => text && text !== '—').join(' ');
          if (!definitions.has(label)) definitions.set(label, definition);
        });
      }).catch(() => { glossaryRequest = undefined; });
    }
    return glossaryRequest;
  }
  const tip = document.createElement('div');
  tip.className = 'stat_glossary_tip';
  tip.id = 'stat_glossary_tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let active;
  function hideTip(link = active) {
    if (link !== active) return;
    active?.removeAttribute('aria-describedby');
    active = undefined;
    tip.hidden = true;
  }
  async function showTip(link, term) {
    hideTip();
    active = link;
    await loadGlossary();
    if (active !== link || !link.isConnected || !definitions.has(term)) return;
    tip.textContent = definitions.get(term);
    tip.hidden = false;
    link.setAttribute('aria-describedby', tip.id);
    positionTip(link);
  }
  function positionTip(link) {
    const box = link.getBoundingClientRect();
    const maxLeft = Math.max(8, document.documentElement.clientWidth - tip.offsetWidth - 8);
    tip.style.left = Math.max(8, Math.min(box.left, maxLeft)) + 'px';
    const top = box.bottom + tip.offsetHeight + 8 <= innerHeight
      ? box.bottom + 5 : Math.max(8, box.top - tip.offsetHeight - 5);
    tip.style.top = top + 'px';
  }
  const bound = new WeakSet();
  function bindTip(control, term) {
    if (bound.has(control)) return;
    bound.add(control);
    control.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showTip(control, term);
    });
    control.addEventListener('pointerleave', () => {
      if (document.activeElement !== control) hideTip(control);
    });
    control.addEventListener('focus', () => showTip(control, term));
    control.addEventListener('blur', () => hideTip(control));
  }
  function decorateHeaders() {
    if (!active?.isConnected) hideTip();
    if (content.querySelector('#key')) return;
    content.querySelectorAll('table thead th').forEach(cell => {
      const sort = cell.querySelector('button[data-sort_key]');
      const label = sort?.dataset.sort_key || cell.textContent.trim();
      const term = label === 'Score' && cell.closest('.today_snapshot') ? 'Matchup Score' : label;
      if (!terms.has(term)) return;
      if (sort) {
        bindTip(sort, term);
        return;
      }
      if (cell.childElementCount) return;
      const link = document.createElement('a');
      link.href = '#key';
      link.className = 'stat_glossary_link';
      link.textContent = label;
      bindTip(link, term);
      link.addEventListener('click', event => {
        event.stopPropagation();
        hideTip(link);
      });
      cell.replaceChildren(link);
    });
  }
  new MutationObserver(decorateHeaders).observe(content, { childList: true, subtree: true });
  addEventListener('resize', () => hideTip());
  addEventListener('scroll', () => {
    if (tip.hidden) return;
    if (active?.isConnected && document.activeElement === active) positionTip(active);
    else hideTip();
  }, true);
  addEventListener('keydown', event => { if (event.key === 'Escape') hideTip(); });
  decorateHeaders();
})();