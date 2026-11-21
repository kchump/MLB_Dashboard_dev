// ====================================================================
// EXISTING PAGES INSIDE THE PILOT
// This runs only in the pilot frame. The dashboard stays on its current files.
// ====================================================================
window.installPilotOverlay = (frame, photos, yahoo) => {
  const doc = frame.contentDocument;
  if (!doc || doc.documentElement.dataset.pilotOverlay) return;
  doc.documentElement.dataset.pilotOverlay = '1';

  const style = doc.createElement('style');
  style.textContent = `
    .pilot-inline-photo,.pilot-img-space { display:inline-block;width:20px;height:20px;object-fit:contain;margin-right:4px;vertical-align:middle; }
    .pilot-help-label { text-decoration:underline dotted;text-underline-offset:3px; }
    .pilot-help { position:fixed;z-index:100000;max-width:min(280px,calc(100vw - 16px));box-sizing:border-box;padding:8px;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:5px;font:13px Arial,sans-serif;pointer-events:none; }
    .player_year_own_pct[hidden] { display:none!important; }
    .pilot-help[hidden] { display:none!important; }
    .pilot-avatar-list th:first-child,.pilot-avatar-list td:first-child { text-align:left; }
    .pilot-avatar-list tbody td { font-variant-numeric:tabular-nums; }
  `;
  doc.head.append(style);
  const pilotBase = new URL('data/thumbs/',location.href);
  const aliases = new Map();
  const normalize = name => String(name || '').normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  for (const [page, path] of Object.entries(photos)) {
    const person = page.replace(/^[^-]+-(?:batters|starters|bullpen|relievers)-/,'');
    if (!aliases.has(person)) aliases.set(person,path);
    else if (aliases.get(person)!==path) aliases.set(person,null);
  }

  const defs = {
    'whiff%':'Swings and misses divided by swings.',
    'player score':'The season grade combining the player’s component scores.',
    'csw%':'Called strikes and swinging strikes divided by pitches.',
    'all':'The season grade across pitch types.',
    'pitch score':'The season grade across pitch types.',
    'rall':'Rolling pitch grade. The window depends on the player role.',
    'pera':'Average of xERA, FIP, xFIP and SIERA.',
    'whip':'Walks, hits and hit batters divided by innings pitched.',
    'pitches +/−':'Pitch grade difference before the consistency adjustment.',
    'pitches +/-':'Pitch grade difference before the consistency adjustment.',
    'matchup score':'Pitch grade difference with a consistency adjustment. Positive favors the player being graded.',
    'val (season)':'Value scaled to a full workload for the player’s role.'
  };
  const help = doc.createElement('div');
  help.hidden = true;
  help.className = 'pilot-help';
  help.setAttribute('role','tooltip');
  help.id = 'pilot-stat-definition';
  doc.body.append(help);
  let active;
  function hideHelp() {
    active?.removeAttribute('aria-describedby');
    active=null;
    help.hidden=true;
  }
  function showHelp(target) {
    if (active !== target) hideHelp();
    active=target;
    help.textContent=target.dataset.pilotDefinition;
    help.hidden=false;
    target.setAttribute('aria-describedby',help.id);
    const box=target.getBoundingClientRect();
    const view=doc.defaultView;
    help.style.left=Math.max(8,Math.min(box.left,view.innerWidth-help.offsetWidth-8))+'px';
    help.style.top=Math.max(8,box.bottom+help.offsetHeight+8<=view.innerHeight ?
      box.bottom+5 : box.top-help.offsetHeight-5)+'px';
  }
  function tagDefinition(node, definition) {
    if (!definition || node.dataset.pilotDefinition) return;
    node.dataset.pilotDefinition=definition;
    node.classList.add('pilot-help-label');
    if (node.tabIndex < 0) node.tabIndex=0;
    node.addEventListener('pointerenter',ev=>{if(ev.pointerType!=='touch')showHelp(node);});
    node.addEventListener('pointerleave',()=>{if(doc.activeElement!==node)hideHelp();});
    node.addEventListener('focus',()=>showHelp(node));
    node.addEventListener('blur',hideHelp);
    node.addEventListener('keydown',event=>{if(event.key==='Escape')hideHelp();});
    node.addEventListener('pointerup',event=>{
      if(event.pointerType==='touch')showHelp(node);
    });
  }
  doc.addEventListener('scroll',()=>{if(active?.isConnected && !help.hidden)showHelp(active);else hideHelp();},true);

  function playerRoute(link) {
    const page = link.dataset.page || link.dataset.pageId || '';
    if (photos[page]) return page;
    const href=link.getAttribute('href') || '';
    try {
      return href.startsWith('#') ? decodeURIComponent(href.slice(1).split('?')[0]) : '';
    } catch (error) {
      return '';
    }
  }
  function decorateNames(root) {
    const selector = 'a.toc_link,a.matchups_player_link,a.compare_player_name_link,a.snapshot_pitcher,span.fantasy_trends_player_name,'+
      '#content_root table td a[href^="#"],#content_root table th a[href^="#"]';
    for (const link of root.querySelectorAll(selector)) {
      if (link.dataset.pilotPhoto) continue;
      const route = playerRoute(link);
      const key = normalize(link.dataset.name || link.textContent);
      const knownRoute = /^[^-]+-(?:batters|starters|bullpen|relievers)-/.test(route);
      const filename = photos[route] || (!knownRoute ? aliases.get(key) : null);
      if (!filename && !knownRoute && !aliases.has(key)) continue;
      link.dataset.pilotPhoto='1';
      if (!filename) {
        const gap=doc.createElement('span');
        gap.className='pilot-img-space';
        gap.setAttribute('aria-hidden','true');
        link.prepend(gap);
        continue;
      }
      const img=link.querySelector(':scope > img:not(.team_logo)') || doc.createElement('img');
      img.classList.add('pilot-inline-photo');
      img.width=20;img.height=20;img.alt='';img.loading='lazy';img.decoding='async';
      img.src=filename.startsWith('https://')?filename:new URL(encodeURIComponent(filename),pilotBase).href;
      img.addEventListener('error',()=>{
        const gap=doc.createElement('span');
        gap.className='pilot-img-space';
        gap.setAttribute('aria-hidden','true');
        img.replaceWith(gap);
      },{once:true});
      if(!img.parentElement)link.prepend(img);
    }
  }
  function yahooValues(route) {
    const player = yahoo.routes[route];
    if (!/^\d+$/.test(String(player || ''))) return {};
    const own = yahoo.ownership?.[player]?.value;
    const adp = yahoo.opening_adp?.values?.[player];
    return {
      own: typeof own==='number' && own>=0 && own<=100 ? own : null,
      adp: Number.isFinite(adp) && adp>=1 ? adp : null,
    };
  }

  function renderYahoo(content) {
    if (!yahoo) return;
    const season = Number(content.querySelector('.year_select option:checked')?.dataset.year);
    const nativeBadge = content.querySelector('.player_year_own_pct');
    const route = doc.querySelector('.toc_link.active')?.dataset.page;
    if (nativeBadge && season===yahoo.season && route && !nativeBadge.parentElement.querySelector('[data-pilot-yahoo]')) {
      const {own,adp} = yahooValues(route);
      if (own!=null || adp!=null) {
        const badge = doc.createElement('span');
        badge.dataset.pilotYahoo = '1';
        if (own!=null) {
          nativeBadge.hidden = true;
          badge.textContent = 'Yahoo Own%: '+own+'%';
        }
        if (adp!=null) {
          badge.append((own!=null ? ' · ' : '')+'Opening Day ADP: '+adp);
          badge.title = yahoo.opening_adp?.as_of || '';
        }
        nativeBadge.after(badge);
      }
    }

    if (Number(content.querySelector('#fantasy_year')?.value)!==yahoo.season) return;
    for (const table of content.querySelectorAll('table')) {
      const heading = table.tHead?.rows[0];
      if (table.tHead?.rows.length!==1 || heading.querySelector('[data-pilot-yahoo]')) continue;
      const ownIndex = [...heading.cells].findIndex(cell=>cell.textContent.trim().startsWith('Own%'));
      if (ownIndex<0) continue;
      const rows = [...table.tBodies].flatMap(body=>[...body.rows]);
      if (!rows.some(row=>row.querySelector('.fantasy_player_link'))) continue;
      const column = doc.createElement('th');
      column.dataset.pilotYahoo = '1';
      column.scope = 'col';
      column.textContent = 'Opening Day ADP';
      heading.cells[ownIndex].after(column);
      for (const row of rows) {
        const ownCell = row.cells[ownIndex];
        if (!ownCell) continue;
        const link = row.querySelector('.fantasy_player_link');
        const values = yahooValues(link?.dataset.page_id || '');
        if (values.own!=null) {
          ownCell.textContent = values.own+'%';
          ownCell.title = 'Yahoo Own%';
        }
        const adp = doc.createElement('td');
        adp.dataset.pilotYahoo = '1';
        adp.textContent = values.adp ?? '—';
        ownCell.after(adp);
      }
    }
  }

  function refresh() {
    const content=doc.getElementById('content_root');
    const sidebar=doc.querySelector('.sidebar');
    if(sidebar)decorateNames(sidebar);
    if(!content)return;
    decorateNames(content);
    renderYahoo(content);
    const matchup = !!content.querySelector('#matchups');
    const chartPage = !!content.querySelector('.year_buttons[data-person_key]');
    for (const table of content.querySelectorAll('table'))table.classList.add('pilot-avatar-list');
    if (chartPage || matchup) {
      for (const header of content.querySelectorAll('thead th,.ytick text')) {
        const label=header.textContent.trim().toLowerCase();
        const definition=label==='score'?defs[matchup?'matchup score':'player score']:defs[label];
        tagDefinition(header,definition);
      }
    }
    if(matchup) {
      const result=content.querySelector('#matchups_results_root');
      if(result?.children.length && !result.querySelector('[data-pilot-roster]') &&
         doc.defaultView.location.hash.includes('gameday_matchup')) {
        const label=doc.createElement('p');
        label.dataset.pilotRoster='1';
        label.textContent='Roster';
        result.prepend(label);
      }
    }
  }
  let queued = false;
  const observer = new MutationObserver(records => {
    if (queued || !records.some(record=>Array.from(record.addedNodes).some(node=>node.nodeType===1 &&
      !node.matches?.('.pilot-inline-photo,.pilot-img-space,.pilot-banner-portrait,[data-pilot-game-logs],[data-pilot-roster],[data-pilot-yahoo]')))) return;
    queued=true;
    doc.defaultView.requestAnimationFrame(()=>{queued=false;refresh();});
  });
  const sidebar=doc.querySelector('.sidebar');
  const content=doc.getElementById('content_root');
  if(sidebar)observer.observe(sidebar,{childList:true,subtree:true});
  if (content)observer.observe(content,{childList:true,subtree:true});
  refresh();
};