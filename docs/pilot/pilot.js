(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const key = value => String(value ?? '').normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase().trim();
  const slug = value => key(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const cache = new Map();
  const photoByName = new Map();
  const photoByPage = new Map();
  let currentView;
  const params = new URLSearchParams(location.search);
  const requestedPlayer = params.get('player');
  const careerPlayer = location.hash === '#career' ? requestedPlayer : null;
  const logPlayer = location.hash === '#logs' ? requestedPlayer : null;
  const replayIndex = () => get('data/replays/index.json').catch(()=>[]);
  const photoRequest = get('data/photos.json').then(data => {
    for (const [page, path] of Object.entries(data)) {
      photoByPage.set(page,path);
      const name = page.replace(/^[^-]+-(?:batters|starters|bullpen|relievers)-/,'');
      const existing = photoByName.get(name);
      if (existing === undefined) photoByName.set(name,path);
      else if (existing !== path) photoByName.set(name,null);
    }
    return data;
  });

  function get(path) {
    if (!cache.has(path)) {
      cache.set(path, fetch(path).then(r => {
        if (!r.ok) throw new Error('Could not load ' + path);
        return r.json();
      }).catch(error => {
        cache.delete(path);
        throw error;
      }));
    }
    return cache.get(path);
  }

  function logo(team) {
    return /^[A-Z]{2,3}$/.test(team || '') ? '<img class="logo" alt="'+safe(team)+'" src="../team_logos/'+team+'.png" loading="lazy">' : safe(team);
  }

  function photoPath(path) {
    return path.startsWith('https://') ? path : 'data/thumbs/' + encodeURIComponent(path);
  }

  function nameCell(name, page, label = name) {
    const path = page ? photoByPage.get(page) : photoByName.get(slug(name));
    const img = path ? '<img class="face" src="'+safe(photoPath(path))+'" alt="" loading="lazy" decoding="async">' : '';
    const text = page ? '<a href="../#'+encodeURIComponent(page)+'">'+safe(label)+'</a>' : safe(label);
    return '<span class="name"><span class="face-slot">'+img+'</span>'+text+'</span>';
  }

  function table(headers, rows, dividers = [], groups = []) {
    const div = i => dividers.includes(i) ? ' class="divider"' : '';
    const groupRow = groups.length ? '<tr>'+groups.map(([group,count],i)=>
      '<th scope="colgroup" colspan="'+count+'"'+(i ? ' class="divider"' : '')+'>'+safe(group)+'</th>').join('')+'</tr>' : '';
    return '<table><thead>'+groupRow+'<tr>'+headers.map((h,i)=>'<th scope="col"'+div(i)+'>'+h+'</th>').join('')+
      '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((cell,i)=>i===0?
        '<th scope="row">'+cell+'</th>':'<td'+div(i)+'>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }

  function heat(value, scale, display = value) {
    if (value === '' || value === null || value === undefined) return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return safe(value);
    const low = scale?.neutral_lo ?? 0, high = scale?.neutral_hi ?? 0;
    const betterUp = scale?.higher_is_better !== false;
    const gold = scale?.gold !== undefined && (betterUp ? num >= scale.gold : num <= scale.gold);
    const warm = betterUp ? num > Math.max(low,high) : num < Math.min(low,high);
    const cold = betterUp ? num < Math.min(low,high) : num > Math.max(low,high);
    return '<b class="heat '+(gold ? 'gold' : warm ? 'hot' : cold ? 'cold' : '')+'">'+safe(display)+'</b>';
  }

  function options(select, values, choice) {
    select.replaceChildren(...values.map(value => new Option(value,value)));
    if (values.includes(choice)) select.value = choice;
  }

  const lens = {
    Score:'The player’s season score from the dashboard.',
    All:'The season grade across pitch types.',
    'Matchup Score':'Pitch grades with a consistency adjustment. Positive favors the player being graded.',
    'Game points':'Box-score events multiplied by the hitter weights.'
  };
  function glossary(label) {
    return '<abbr class="glossary-label" tabindex="0" title="'+safe(lens[label])+'">'+safe(label)+'</abbr>';
  }

  async function showCareer() {
    const [index, scales, columns] = await Promise.all([
      get('data/career-index.json'),get('data/scales.json'),get('data/career-columns.json')
    ]);
    const select = $('career-player');
    const requestedKey = new URLSearchParams(location.search).get('careerKey');
    const byName = index.filter(row=>key(row[1])===key(careerPlayer));
    const defaultKey = 'hitters|mike trout';
    const requested = requestedKey || (byName.length===1 ? byName[0][0] : null);
    const entries = new Map(index.map(row=>[row[0],row]));
    select.replaceChildren(...index.map(([identity,,label])=>new Option(label,identity)));
    select.value = entries.has(requested) ? requested : defaultKey;
    if ((careerPlayer || requestedKey) && !entries.has(requested)) {
      select.prepend(new Option((careerPlayer || 'Player')+' · unavailable','',true,true));
    }

    let revision = 0;
    async function render() {
      const id = ++revision;
      const selected = select.value;
      const entry = entries.get(selected);
      let rows;
      try {
        rows = entry && (await get('data/career-shards/'+entry[3]+'.json'))[selected];
      } catch (error) {
        rows = null;
      }
      if (id!==revision) return;
      if (!rows?.length) {
        $('career-traditional').replaceChildren();
        $('career-table').textContent = 'Career season data unavailable.';
        return;
      }
      const hitter = rows.every(row => row.role === 'hitters');
      const ordered = rows.slice().reverse();
      const {traditional, advanced} = columns[ordered[0].role];
      const labels = {All:'Pitch Score',Stf:'Stuff',Con:'Contact',Disc:'Approach',pos:'Pos',pos2:'2nd Pos'};
      const prefix = row => [safe(row.year),logo(row.team)];
      const format = (row, metric) => {
        const raw = row[metric];
        if (raw == null || raw === '') return '—';
        const scale = scales['majors|'+row.role+'|'+metric];
        const digits = ['AVG','OBP','SLG','OPS'].includes(metric) ? 3 :
          ['ERA','WHIP'].includes(metric) ? 2 : null;
        let value = digits === null ? raw : Number(raw).toFixed(digits);
        if (typeof raw === 'number' && digits === null) value = Math.round(raw*100)/100;
        if (scale?.fmt === 'pct') value = (Number(raw)*100).toFixed(2)+'%';
        if (metric === 'Own%') value = Number(raw).toFixed(1)+'%';
        return scale ? heat(raw,scale,value) : safe(value);
      };
      $('career-traditional').innerHTML = '<h3>Traditional stats</h3><div class="scroll" role="region" aria-label="Traditional stats by season" tabindex="0">' +
        table(['Year','Team',...traditional.map(metric=>metric==='PA' && !hitter ?
          '<abbr title="Batters faced" tabindex="0">PA</abbr>' : metric)],ordered.map(row=>[
          ...prefix(row),...traditional.map(metric=>format(row,metric))
        ]),[2]) + '</div>';
      $('career-table').innerHTML = '<h3>Advanced grades</h3><div class="scroll" role="region" aria-label="Advanced grades by season" tabindex="0">' +
        table(['Year','Team',...advanced.map(metric=>metric==='Score'?glossary(metric):safe(labels[metric] || metric))],
          ordered.map(row=>[...prefix(row),...advanced.map(metric=>format(row,metric))]),[2]) + '</div>';
    }
    select.onchange = render;
    render();
  }

  async function showTrade() {
    const [index, scales, seasons] = await Promise.all([
      get('data/career-index.json'),get('data/scales.json'),get('data/career-seasons.json'),photoRequest,
    ]);
    const range = $('trade-seasons');
    const entries = new Map(index.map(row=>[row[0],row]));
    const a=$('trade-a'), b=$('trade-b');
    for (const [select, initial] of [[a,'hitters|mike trout'],[b,'hitters|aaron judge']]) {
      select.replaceChildren(...index.map(([identity,,label])=>new Option(label,identity)));
      select.value = initial;
    }

    let revision = 0;
    async function render() {
      const id = ++revision;
      const selections = [entries.get(a.value),entries.get(b.value)];
      try {
        const [left,right] = await Promise.all(selections.map(async ([key,,,shard])=>
          (await get('data/career-shards/'+shard+'.json'))[key]));
        if (id!==revision) return;
        const count = Number(range.value);
        const years = count
          ? Array.from({length:count},(_,i)=>seasons.latest-i)
          : [...new Set([...left,...right].map(row=>row.year))].sort((x,y)=>y-x);
        $('trade-names').innerHTML = [left,right].map((rows,i)=>{
          const last = rows.at(-1);
          const [,name,label,,page] = selections[i];
          return '<div>'+logo(last.team)+' '+nameCell(name,page,label)+'</div>';
        }).join('');
        $('trade-table').innerHTML = table(
          ['Year','Score','Pitch Score','PPG','Score','Pitch Score','PPG'],
          years.map(year=>{
            const cells = [left,right].flatMap(side=>{
              const row=side.find(item=>item.year===year);
              if (!row) return ['—','—','—'];
              const scale = stat => scales['majors|'+row.role+'|'+stat];
              return [heat(row.Score,scale('Score')),heat(row.All,scale('All')),safe(row.PPG ?? '—')];
            });
            return [safe(year),...cells];
          }),[1,4],[['Season',1],[selections[0][2],3],[selections[1][2],3]]);
      } catch (error) {
        if (id===revision) {
          $('trade-names').replaceChildren();
          $('trade-table').textContent = 'Comparison data unavailable.';
        }
      }
    }
    a.onchange=render; b.onchange=render; range.onchange=render; render();
  }

  async function showFree() {
    const [rows] = await Promise.all([get('data/free-agents.json'),photoRequest]);
    const controls = $('free-modes');
    function render(mode) {
      controls.querySelectorAll('button').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.free===mode)));
      const score = row => mode==='Pickups' ? row.streak : mode==='Buy Low' ? row.ppg-row.delta : -row.delta;
      const sorted = rows.slice().sort((a,b)=>score(b)-score(a)).slice(0,12);
      $('free-table').innerHTML = '<aside>2026 sample · Rostered 50% or less</aside>' +
        table(['Player','Team','Rostered','Streak PPG','Season PPG','Δ PPG'],sorted.map(row=>[
          nameCell(row.name),logo(row.team),safe(row.own+'%'),safe(row.streak),safe(row.ppg),heat(row.delta)
        ]),[2,3],[['Player',2],['Availability',1],['Results',3]]);
    }
    controls.onclick = event => {const btn=event.target.closest('[data-free]');if(btn)render(btn.dataset.free);};
    render('Pickups');
  }

  async function showDepth() {
    const [clubs, scales] = await Promise.all([get('data/depth/index.json'),get('data/scales.json'),photoRequest]);
    const select = $('depth-team');
    const teams = Object.entries(clubs).sort(([,a],[,b])=>a.name.localeCompare(b.name));
    select.replaceChildren(...teams.map(([code,club])=>new Option(club.name,code)));
    const selected = params.get('team');
    select.value = Object.hasOwn(clubs,selected) ? selected : 'LAA';
    select.onchange = () => {
      const url = new URL(location.href);
      url.searchParams.set('team',select.value);
      url.hash = 'depth';
      location.assign(url);
    };
    const club = clubs[select.value];
    const data = await get('data/depth/'+select.value+'.json');
    $('depth-title').textContent = club.name+' depth chart';
    $('depth-source').href = 'https://www.mlb.com/'+club.slug+'/roster/depth-chart';
    $('depth-status').textContent = 'MLB roster by position · '+data.gradeSeason+' season grades';
    const groups=Object.groupBy(data.rows,row=>row[1]);
    $('depth-table').innerHTML=Object.entries(groups).map(([pos,players])=>{
      const metrics = [['Score','Score'],['All','Pitch Score'],['Val','Val']];
      if (['P','SP','RP'].includes(pos)) {
        metrics.push(['Velo','pVelo'],['Stf','Stuff'],['LCon','Location Contact'],['LDisc','Location Approach']);
      }
      return '<h3>'+safe(pos)+'</h3>'+table(['Player','Status',...metrics.map(([,label])=>label)],
        players.map(([name,,status,,match])=>[nameCell(name,match?.page),safe(status),...metrics.map(([metric])=>{
          const value = match?.grades[metric];
          const scale = scales['majors|'+match?.role+'|'+metric];
          const display = typeof value === 'number' ? Math.round(value*100)/100 : value;
          return scale ? heat(display,scale) : safe(display === '' || display == null ? '—' : display);
        })]),[2]);
    }).join('');
  }

  async function showProspects() {
    const [data] = await Promise.all([get('../assets/preview/prospects.json'),photoRequest]);
    const org = $('org-picker');
    const selected = $('org-selected');
    const teams = [...new Set(data.organizations.map(row=>row.team))].sort();
    function choose(team) {
      selected.innerHTML = logo(team)+' '+safe(team);
      $('org-options').querySelectorAll('button').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.value===team)));
      $('org-table').innerHTML=table(['Player','Rank','Pos','Level','ETA'],
        data.organizations.filter(row=>row.team===team).map(prospectRow),[2]);
      org.open=false;
    }
    function prospectRow(row) {
      return [nameCell(row.name,row.page),safe(row.rank),safe(row.position),safe(row.level),safe(row.eta)];
    }
    $('national').innerHTML=table(['Player','Rank','Team','Pos','Level'],data.national.map(row=>[
      nameCell(row.name,row.page),safe(row.rank),logo(row.team),safe(row.position),safe(row.level)
    ]),[3]);
    $('org-options').innerHTML=teams.map(team=>'<button value="'+safe(team)+'">'+logo(team)+' '+safe(team)+'</button>').join('');
    $('org-options').onclick=event=>{
      const button=event.target.closest('button');
      if(button) { choose(button.value);selected.focus(); }
    };
    org.onkeydown=event=>{if(event.key==='Escape'){org.open=false;selected.focus();}};
    choose('SEA');
  }

  async function showArchive() {
    const root = '../assets/matchups/starter-bundles/2026/';
    const index = typeof DecompressionStream==='function' ? get(root+'pitchers.json').catch(()=>[]) : [];
    const [data, pitchers] = await Promise.all([get('data/matchups.json'),index,photoRequest]);
    const year = $('archive-year');
    const player = $('archive-player');
    const note = $('archive-note');
    const target = $('archive-table');
    const examples = [...new Set(data.rows.map(row=>row[0]))];
    options(year,['2026 · actual rows','2025 · example rows']);
    let request = 0;

    async function render() {
      const id = ++request;
      const example = year.selectedIndex===1;
      const selection = player.value;
      let rows = data.rows.filter(row=>row[0]===selection);
      note.textContent = example ? 'Example 2025 grades' : '2026 dashboard grades';
      if (!example && pitchers.includes(selection)) {
        target.textContent = '';
        try {
          const response = await fetch(root+encodeURIComponent(selection)+'.bin');
          if (!response.ok || !response.body) throw new Error('Unavailable pitcher bundle');
          const fragments = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
          const parser = new DOMParser();
          rows = Object.values(fragments).map(html=>{
            const doc = parser.parseFromString(html,'text/html');
            const heads = [...doc.querySelectorAll('thead th')].map(cell=>cell.textContent.trim());
            const cells = [...doc.querySelectorAll('tbody td')].map(cell=>cell.textContent.trim());
            return data.columns.map(column=>cells[heads.indexOf(column)] ?? '');
          });
        } catch (error) {
          rows = data.rows.filter(row=>row[0]===selection.replaceAll('_',' '));
        }
      }
      if (id!==request) return;
      if (!rows.length) {
        target.textContent = 'No matchup rows available for this pitcher.';
        return;
      }
      target.innerHTML=table(
        ['Pitcher','Club','Side','Opponent','IP',glossary('Matchup Score'),'Pitches +/−','FB +/−','SL +/−'],
        rows.map(row=>[nameCell(row[0]),logo(row[1]),safe(row[2]),logo(row[3]),safe(row[4]),
          ...row.slice(5).map((value,i)=>heat(example && value!=='' ? (Number(value)*(i===0?.83:.91)).toFixed(2) : value))]),
        [4,7],[['Matchup',4],['Grades',3],['Pitch splits',2]]);
    }

    function selectYear() {
      const example = year.selectedIndex===1;
      const useBundles = !example && pitchers.length;
      player.replaceChildren(...(useBundles ? pitchers : examples).map(value=>
        new Option(useBundles ? value.replaceAll('_',' ') : value,value)));
      player.value = useBundles ? 'Logan_Gilbert' : 'Logan Gilbert';
      if (!player.value) player.selectedIndex=0;
      render();
    }
    year.onchange=selectYear;
    player.onchange=render;
    selectYear();
  }

  // ====================================================================
  // GAME LOG & PITCH LOCATIONS
  // ====================================================================
  const colors = {FF:'#d04450',SI:'#ad561e',FC:'#8d3384',SL:'#2d65ad',ST:'#56739f',
    CU:'#6244a9',KC:'#72528d',CH:'#16856b',FS:'#93700d',SV:'#147561'};
  const pitchColor = code => colors[code] || '#66788d';
  const svgNS = 'http://www.w3.org/2000/svg';
  const plateHalfWidth = 17 / 24;
  const sampleInputs = {FF:[14,3,-1],SL:[8,5,2],CH:[4,2,0],SI:[9,-1,4],FC:[10,1,1]};
  const sitePitchKeys = {FF:'FB',SI:'SI',FC:'CT',SL:'SL',ST:'SW',CU:'CB',KC:'CB',CH:'CH',FS:'SP',KN:'KN'};
  function svgElement(name, attributes) {
    const el=document.createElementNS(svgNS,name);
    Object.entries(attributes).forEach(([k,v])=>el.setAttribute(k,v));
    return el;
  }

  async function showSeasonGameLogs() {
    const host = $('season-game-logs');
    if (!logPlayer || typeof DecompressionStream!=='function') return;
    host.hidden = false;
    host.textContent = 'Loading 2026 game logs…';
    try {
      const [index, replays, scales] = await Promise.all([
        get('data/career-index.json'),replayIndex(),get('data/replay-grade-scales.json'),
      ]);
      const availableReplays = new Set(replays);
      const routeKey = new URLSearchParams(location.search).get('careerKey');
      const byName = index.filter(row=>key(row[1])===key(logPlayer));
      const entry = routeKey ? index.find(row=>row[0]===routeKey) : byName.length===1 ? byName[0] : null;
      if (!entry) throw new Error('No player history');
      const [identity,,label,shard] = entry;
      const response = await fetch('data/game-shards/2026/'+shard+'.bin');
      if (!response.ok || !response.body) throw new Error('Game logs unavailable');
      const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      const games = data[identity];
      if (!games?.length) throw new Error('No games');
      const hitter = identity.startsWith('hitters|');
      host.innerHTML = '<h2>'+safe(label)+' · 2026 game logs</h2><div class="scroll" role="region" aria-label="Regular-season game logs" tabindex="0">'+
        table(['Game','Opponent',hitter?'PA':'IP','Fantasy Pts','Score','Pitch Score',
          ...(hitter ? ['R Eye%','L Eye%'] : ['Pitch mix']),'Scoring events'],
        games.map(([day,id,opponent,side,workload,points,events,grades])=>[
          '<a href="https://www.mlb.com/gameday/'+safe(id)+'">'+safe(day)+'</a>'+
            (availableReplays.has(id) ? ' <a class="game-log-replay" href="?game='+id+'#logs">Replay</a>' : ''),
          safe((side==='Away'?'at ':'vs ')+opponent),
          safe(hitter?workload:Math.floor(workload/3)+'.'+workload%3),
          heat(points),
          heat(grades?.score,hitter ? scales.hitterScore : scales.pitcherScore),
          heat(grades?.pitchScore,hitter ? scales.hitterPitchScore : scales.pitchScore),
          ...(hitter ? ['R Eye','L Eye'].map(metric=>Number.isFinite(grades?.[metric]) ? (100*grades[metric]).toFixed(1)+'%' : '—')
            : [formatPitchMix(grades)]),
          events ? safe([
            ...(!hitter ? [workload+' outs ('+workload+' pts)'] : []),
            ...events.map(([stat,count,weight])=>count+' '+(!hitter && stat==='SO' ? 'K' : stat)+' ('+(count*weight)+' pts)'),
          ].join(' · ') || 'No scoring events') : '—',
        ]),[3])+'</div>';
    } catch (error) {
      host.textContent = 'No local 2026 game logs available for '+logPlayer+'.';
    }
  }

  function formatPitchMix(row) {
    return safe(row?.mix?.map(([code,count])=>code+' '+(100*count/row.tracked).toFixed(0)+'%').join(' · ') || '—');
  }

  async function showLogs() {
    const requestedGame = params.get('game');
    $('game-replay').hidden = true;
    if (logPlayer && !requestedGame) {
      await showSeasonGameLogs();
      return;
    }
    const [gradeScales, replay] = await Promise.all([get('data/replay-grade-scales.json'),loadReplay(requestedGame),photoRequest]);
    const {game, pitches: pitchDetails, batters: batterEye, pitchers} = replay;
    $('game-replay').hidden = false;
    $('game-title').textContent=game.teams.away+' at '+game.teams.home;
    $('game-link').innerHTML=safe(game.date)+' · <a href="https://www.mlb.com/gameday/'+game.id+'">MLB Gameday</a>';
    const focus = game.logs.find(row=>key(row.name)===key(logPlayer));
    $('game-scores').innerHTML=(logPlayer && !focus ? '<aside>Game log sample · '+safe(logPlayer)+' did not play in this game.</aside>' : '')+
      table(['Player','PA',glossary('Game points'),'<abbr title="Advanced score calculated using this game only" tabindex="0">Score</abbr>','Pitch Score','R Eye%','L Eye%','Miss distance','Events'],
        (focus?[focus,...game.logs.filter(row=>row!==focus)]:game.logs).map(row=>[
          nameCell(row.name),safe(row.pa),heat(row.points),heat(batterEye[row.id]?.score,gradeScales.hitterScore),
          heat(batterEye[row.id]?.pitchScore,gradeScales.hitterPitchScore),
          ...['R Eye','L Eye'].map(metric=>{
            const value=batterEye[row.id]?.[metric];
            return Number.isFinite(value) ? (100*value).toFixed(1)+'%' : '—';
          }),replayMissDistance(batterEye[row.id]?.missDistance),
          safe(Object.entries(row.events).map(([stat,count])=>count+' '+stat).join(' · '))
        ]),[2]);
    $('replay-pitchers').innerHTML=table(['Pitcher','IP','BB','K','ER','Pitches','Score','Pitch Score','Fantasy Pts','Scoring events','Pitch mix'],
      pitchers.map(row=>[nameCell(row.name),Math.floor(row.outs/3)+'.'+row.outs%3,row.bb,row.k,row.er,row.pitches,
        heat(row.score,gradeScales.pitcherScore),heat(row.pitchScore,gradeScales.pitchScore),heat(row.points),
        safe([row.outs+' outs',...row.events.map(([stat,count,weight])=>count+' '+stat+' ('+(count*weight)+')')].join(' · ')),
        formatPitchMix(row)]),[6,10]);
    function showOrders() {
      const official=$('posted').checked;
      $('orders').innerHTML=Object.entries(game.lineups).map(([side,confirmed])=>{
        const order=confirmed.slice();
        if (!official) [order[1],order[2]]=[order[2],order[1]];
        return '<div><h3>'+safe(game.teams[side])+'</h3><p>'+(official?'Confirmed lineup':'Projected lineup · example')+'</p><ol>'+
          order.map(name=>'<li>'+nameCell(name)+'</li>').join('')+'</ol></div>';
      }).join('');
    }
    $('posted').onchange=showOrders;showOrders();
    const selection=$('at-bat');
    const pitcherFilter=$('replay-pitcher');
    pitcherFilter.replaceChildren(new Option('All pitchers','all'),...pitchers.map(row=>new Option(row.name,String(row.id))));
    selection.replaceChildren(new Option('Full game','all'),...game.atBats.map(ab=>new Option(ab.label,String(ab.id))));
    const requestedPA = params.get('pa');
    if (game.atBats.some(ab=>String(ab.id)===requestedPA)) selection.value = requestedPA;
    $('example-grades').checked = params.get('grades') === '1';
    const typeFilter=$('pitch-type');
    const types=new Map(game.pitches.map(row=>[row[2],row[3]]));
    const appearances = new Map(game.atBats.map(row=>[row.id,row]));
    function velocity(ab, pitch) {
      const perceived = pitchDetails[ab+':'+pitch]?.pvelo;
      return Number.isFinite(perceived) ? heat(perceived.toFixed(1),gradeScales.pvelo) : '—';
    }
    function pitchType(code, type) {
      return '<span><i class="dot" style="background:'+pitchColor(code)+'"></i>'+safe(type)+'</span>';
    }
    typeFilter.replaceChildren(new Option('All pitch types','all'),...Array.from(types,
      ([code,label])=>new Option(label,code)));
    let currentPitch;
    function showPitch(pitch) {
      currentPitch=pitch;
      const [ab,num,code,type,x,z,,result,swing,bottom,top]=pitch;
      const measured = pitchDetails[ab+':'+num];
      const appearance = appearances.get(ab);
      const facts = [
        ['Pitch',safe(num)+' · '+pitchType(code,type)],
        ['pVelo (MPH)',velocity(ab,num)],
        ['Result',safe(result)],
      ];
      if ([x,z,bottom,top].every(Number.isFinite)) {
        const position = z>top ? 'High' : z<bottom ? 'Low' : Math.abs(x)>plateHalfWidth ? 'Off the plate' : 'Over the plate';
        facts.push(['Plate location',position]);
      }
      if (Number.isFinite(measured?.location)) facts.push(['Location score',safe(measured.location.toFixed(2))]);
      if (Number.isFinite(measured?.miss_distance)) facts.push(['Miss distance',safe(measured.miss_distance.toFixed(2))+' in']);
      const gradeRows = [];
      const qualityGrade = (metric,value)=>{
        const {good,bad} = gradeScales.quality[metric];
        const tone = value>=good ? 'hot' : value<bad ? 'cold' : '';
        return '<b class="heat '+tone+'">'+safe(Number(value.toFixed(2)))+'</b>';
      };
      const stuffScale = gradeScales.stuff[sitePitchKeys[code]];
      if (Number.isFinite(measured?.stuff)) facts.push(['Stuff',stuffScale ? heat(measured.stuff,stuffScale) : safe(measured.stuff)]);
      if (Number.isFinite(measured?.qual)) facts.push(['Qual',qualityGrade('Qual',measured.qual)]);
      if (Number.isFinite(measured?.qcon)) facts.push(['Hitter QCon',qualityGrade('QCon',measured.qcon)]);
      if (Number.isFinite(measured?.qdisc)) facts.push(['Hitter QDisc',qualityGrade('QDisc',measured.qdisc)]);
      if ($('example-grades').checked) {
        const [stuff,lcon,ldisc]=sampleInputs[code] || [5,1,0];
        gradeRows.push(['Stuff',stuffScale ? heat(stuff,stuffScale) : safe(stuff)]);
        if (swing) {
          gradeRows.push(['QCon',qualityGrade('QCon',stuff+2*lcon)],['QDisc',qualityGrade('QDisc',stuff+.66*ldisc)]);
        }
      }
      const stats = rows => '<dl class="pitch-stats">'+rows.map(([label,value])=>
        '<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>';
      $('pitch-detail').innerHTML = '<h4>'+safe(appearance?.label)+'</h4>'+stats(facts)+
        (gradeRows.length ? '<p class="pitch-note">Example grades</p>'+stats(gradeRows) : '');
      $('pitch-map').querySelectorAll('[data-pitch-id]').forEach(mark=>{
        mark.setAttribute('aria-pressed',String(mark.getAttribute('data-pitch-id')===ab+':'+num));
      });
      $('pitch-sequence').querySelectorAll('[data-pitch]').forEach(button=>{
        button.setAttribute('aria-pressed',String(Number(button.dataset.pitch)===num));
      });
    }
    function renderPitches() {
      const only=selection.value;
      const pitcher=pitcherFilter.value;
      const sequence=game.pitches.filter(row=>(only==='all'||String(row[0])===only)&&
        (pitcher==='all'||String(pitchDetails[row[0]+':'+row[1]]?.pitcher)===pitcher));
      const rows=typeFilter.value==='all'?sequence:sequence.filter(row=>row[2]===typeFilter.value);
      const map=$('pitch-map');map.replaceChildren();
      const x=value=>180+Number(value)*84;
      const y=value=>332-Number(value)*64;
      const zone=only==='all'?null:sequence.find(pitch=>Number.isFinite(pitch[9])&&Number.isFinite(pitch[10]));
      const [bottom,top]=zone?[zone[9],zone[10]]:[1.5,3.5];
      map.append(svgElement('rect',{x:x(-plateHalfWidth),y:y(top),width:x(plateHalfWidth)-x(-plateHalfWidth),height:y(bottom)-y(top),
        fill:'none',stroke:'currentColor','stroke-dasharray':only==='all'?'5 3':'0'}));
      map.append(svgElement('path',{d:'M 140 333 L 220 333 L 220 342 L 180 355 L 140 342 Z',fill:'none',stroke:'currentColor'}));
      const typeNames=new Map(rows.map(row=>[row[2],row[3]]));
      $('pitch-legend').innerHTML=[...typeNames].map(([code,name])=>'<span><i class="dot" style="background:'+pitchColor(code)+'"></i>'+safe(name)+'</span>').join('');
      const markers = [];
      rows.forEach((pitch,i)=>{
        const [ab,num,code,type,px,pz]=pitch;
        const mark=svgElement('circle',{cx:Math.max(6,Math.min(354,x(px))),cy:Math.max(6,Math.min(354,y(pz))),
          r:only==='all'?4:7,fill:pitchColor(code),tabindex:i===0?0:-1,role:'button',
          'data-pitch-id':ab+':'+num,'aria-pressed':'false',
          'aria-label':'Plate appearance '+(ab+1)+', pitch '+num+', '+type});
        mark.addEventListener('pointerenter',()=>showPitch(pitch));
        mark.addEventListener('focus',()=>showPitch(pitch));
        mark.addEventListener('click',()=>showPitch(pitch));
        mark.addEventListener('keydown',event=>{
          if (event.key==='Enter' || event.key===' ') { event.preventDefault();showPitch(pitch); }
          if (['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(event.key)) {
            event.preventDefault();
            const next=(i+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+markers.length)%markers.length;
            mark.setAttribute('tabindex','-1');markers[next].setAttribute('tabindex','0');markers[next].focus();
          }
        });
        map.append(mark);markers.push(mark);
      });
      $('pitch-sequence').innerHTML=only==='all'?'<aside>'+rows.length+' pitches · Reference strike zone</aside>':
        table(['#','Pitch','pVelo','Result'],rows.map(pitch=>[
          '<button type="button" class="pitch-number" data-pitch="'+safe(pitch[1])+'" aria-label="View pitch '+safe(pitch[1])+'">'+safe(pitch[1])+'</button>',
          pitchType(pitch[2],pitch[3]),velocity(pitch[0],pitch[1]),safe(pitch[7])
        ]),[2]);
      $('pitch-sequence').onclick=event=>{
        const number = event.target.closest('[data-pitch]')?.dataset.pitch;
        const pitch = rows.find(row=>row[1]===Number(number));
        if (pitch) showPitch(pitch);
      };
      if(rows.length)showPitch(rows[0]);
      else {$('pitch-detail').textContent='No pitches for this selection.';currentPitch=null;}
    }
    selection.onchange=renderPitches;
    pitcherFilter.onchange=()=>{selection.value='all';renderPitches();};
    typeFilter.onchange=renderPitches;
    $('example-grades').onchange=()=>{if(currentPitch)showPitch(currentPitch);};
    renderPitches();
  }

  async function loadReplay(requestedGame) {
    if (requestedGame !== null) {
      const id = Number(requestedGame);
      if (!/^\d+$/.test(requestedGame) || !(await replayIndex()).includes(id)) throw new Error('Replay unavailable');
      const response = await fetch('data/replays/'+id+'.bin');
      if (!response.ok || !response.body) throw new Error('Replay unavailable');
      const replay = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
      if (replay.game.id !== id) throw new Error('Replay game mismatch');
      return replay;
    }
    const [game,pitches,batters,pitchers] = await Promise.all([
      get('data/game.json'),get('data/replay-pitch-details.json'),
      get('data/replay-batter-eye.json'),get('data/replay-pitchers.json'),
    ]);
    return {game,pitches,batters,pitchers};
  }

  function replayMissDistance(distance) {
    if (!distance) return '—';
    const format = row => (row.tracked ? row.average.toFixed(2)+' in' : '—')+' ('+row.tracked+'/'+row.whiffs+' tracked)';
    return '<details><summary>'+format(distance)+'</summary><ul>'+Object.entries(distance.pitchTypes)
      .map(([code,row])=>'<li>'+safe(code)+' '+format(row)+'</li>').join('')+'</ul></details>';
  }

  // ====================================================================
  // PILOT NAVIGATION
  // ====================================================================
  let yahooSnapshot;
  if (['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
    $('yahoo-preview').hidden = false;
    $('yahoo-file').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (!Number.isInteger(payload.season) || !payload.routes || !Object.keys(payload.routes).length) {
          throw new Error('Missing season or player routes');
        }
        yahooSnapshot = payload;
        $('yahoo-status').textContent = 'Loaded '+payload.season+' snapshot';
        $('base-dashboard').contentWindow.location.reload();
      } catch (error) {
        $('yahoo-status').textContent = 'Could not load this snapshot. Check the season and Yahoo route map.';
      }
    });
  }

  async function showSite() {
    const photos = await photoRequest;
    const frame = $('base-dashboard');
    const select = $('pilot-route');
    function load() { frame.src = '../#' + select.value; }
    select.onchange = load;
    const banner = $('player-banner-preview');
    if (!frame.getAttribute('src')) {
      const page = params.get('page');
      if ([...select.options].some(option=>option.value===page)) select.value = page;
      banner.checked = params.get('banner') === '1';
    }
    banner.onchange = () => frame.contentWindow?.set_dev_player_banner?.(banner.checked);
    frame.onload = () => {
      banner.onchange();
      window.installPilotOverlay(frame, photos, yahooSnapshot);
    };
    if (!frame.getAttribute('src')) load();
  }
  async function showMissDistance() {
    const people = await get('data/miss-distance.json');
    const picker = $('miss-hitter');
    const inches = value=>value==null ? '—' : Number(value).toFixed(2);
    $('miss-table').innerHTML = table(['Hitter','Tracked whiffs','Median (in)','Avg (in)'],
      people.map(row=>[safe(row.name),safe(row.tracked+'/'+row.whiffs),inches(row.median),inches(row.average)]));
    picker.replaceChildren(...people.map(row=>new Option(row.name,String(row.id))));
    function renderExamples() {
      const hitter = people.find(row=>String(row.id)===picker.value);
      $('miss-pitches').innerHTML = table(['Pitch','Tracked whiffs','Median (in)','Avg (in)'],
        hitter.pitch_types.map(row=>[safe(row.pitch),safe(row.tracked+'/'+row.whiffs),inches(row.median),inches(row.average)]));
      $('miss-examples').innerHTML = table(['Sample','Game','Pitch','Miss (in)'],
        hitter.examples.map(([day,game,,,pitch,distance],i)=>[
          i ? 'Widest' : 'Closest',
          '<a href="https://www.mlb.com/gameday/'+safe(game)+'">'+safe(day)+'</a>',
          safe(pitch),inches(distance),
        ]));
    }
    const requested = new URLSearchParams(location.search).get('hitter');
    if (people.some(row=>String(row.id)===requested)) picker.value = requested;
    picker.onchange=renderExamples;
    renderExamples();
  }

  const renders={site:showSite,depth:showDepth,career:showCareer,logs:showLogs,history:showArchive,
    trade:showTrade,free:showFree,prospects:showProspects,'bat-tracking':showMissDistance};
  function show(id) {
    if (!renders[id]) return;
    currentView=id;
    document.querySelectorAll('main>section').forEach(section=>section.hidden=section.id!==id);
    document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-current',String(button.dataset.view===id)));
    $('load-error').hidden=true;
    renders[id]().catch(error=>{
      if(currentView===id) {$('load-error').hidden=false;$('load-error').textContent=error.message;}
    });
  }
  function navigate(id) {
    if (location.hash !== '#'+id) history.pushState(null,'','#'+id);
    show(id);
  }
  addEventListener('hashchange',()=>show(location.hash.slice(1) || 'site'));
  document.querySelector('nav').addEventListener('click',event=>{
    const button=event.target.closest('[data-view]');
    if(button)navigate(button.dataset.view);
  });
  show(location.hash.slice(1) || 'site');
})();
