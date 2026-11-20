//====================================================================
// TODAY'S SNAPSHOT
// The slate is a DEV example. Pull the actual Score from the same
// pitcher-vs-team fragment Matchups uses, without the big index.
//====================================================================
let today_preview_request;
function load_today_preview() {
  if (!today_preview_request) {
    today_preview_request = fetch('assets/preview/today.json?v=review').then(response => {
      if (!response.ok) throw new Error('Today preview unavailable');
      return response.json();
    }).catch(error => {
      today_preview_request = null;
      throw error;
    });
  }
  return today_preview_request;
}

function snapshot_score_badge(raw, sample, role) {
  const badge = document.createElement('span');
  badge.className = 'snapshot_score_value';
  badge.textContent = raw ?? '—';
  const score = parse_matchup_stat_number(raw);
  if (!Number.isFinite(score)) return badge;
  const alpha = row_sample_alpha_mult([role === 'hitter' ? 'PA' : 'IP'], [sample], {});
  const gold = score >= matchup_gold_threshold('Score', role);
  const background = gold ? gold_gradient_fill(alpha) : rgba_from_two_sided_value(score, -40, -5, 5, 40, alpha);
  badge.style.background = background;
  badge.style.color = gold ? '#171717' : matchup_heat_text_color(background);
  return badge;
}

async function init_today_snapshot(content) {
  const snapshot = content.querySelector('.today_snapshot');
  if (!snapshot) return;

  const divisions = {
    'AL East': ['NYY', 'BAL', 'BOS', 'TOR', 'TB'],
    'AL Central': ['DET', 'CLE', 'KC', 'MIN', 'CHW'],
    'AL West': ['SEA', 'HOU', 'TEX', 'ATH', 'LAA'],
    'NL East': ['PHI', 'ATL', 'NYM', 'MIA', 'WAS'],
    'NL Central': ['CHC', 'MIL', 'STL', 'CIN', 'PIT'],
    'NL West': ['LAD', 'SD', 'SF', 'ARI', 'COL']
  };
  const records = [[47, 33], [44, 36], [41, 39], [38, 42], [34, 46]];
  let data;
  try {
    data = await load_today_preview();
  } catch (error) {
    snapshot.querySelector('[data-snapshot-games]').textContent = 'The example slate could not load.';
    return;
  }
  if (!snapshot.isConnected) return;
  const slate = data.games;
  const photos = 'https://kchump.github.io/mlb_dashboard_player_photos/player_photos/';
  const picker = snapshot.querySelector('#snapshot_division');
  const standings = snapshot.querySelector('tbody');

  function teamBadge(team) {
    return '<span class="snapshot_team">' + team_logo_html(team) + '<strong>' + team + '</strong></span>';
  }

  function showDivision() {
    standings.innerHTML = divisions[picker.value].map((team, i) => {
      const [wins, losses] = records[i];
      const [leadWins, leadLosses] = records[0];
      const gamesBack = (leadWins - wins + losses - leadLosses) / 2;
      return '<tr><th scope="row">' + teamBadge(team) + '</th><td>' + wins +
        '</td><td>' + losses + '</td><td>' + (gamesBack || '—') + '</td></tr>';
    }).join('');
  }

  async function showPitcherScore(cell, name, side, opponent) {
    const path = 'assets/matchups/fragments/2026/sp_vs_team/' +
      encodeURIComponent(name.replaceAll(' ', '_')) + '/' + side + '/' + opponent + '.html';
    const html = await load_matchup_fragment(path);
    if (!html || !cell.isConnected) return;
    const fragment = new DOMParser().parseFromString(html, 'text/html');
    const headers = [...fragment.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const row = [...fragment.querySelectorAll('tbody tr:first-child td')].map(td => td.textContent.trim());
    const raw = row[headers.indexOf('Score')];
    const score = parse_matchup_stat_number(raw);
    if (!Number.isFinite(score)) return;

    cell.replaceChildren(snapshot_score_badge(raw, row[headers.indexOf('IP')], 'pitcher'));
  }

  Object.keys(divisions).forEach(division => picker.add(new Option(division)));
  picker.value = 'AL West';
  picker.addEventListener('change', showDivision);
  showDivision();

  const games = snapshot.querySelector('[data-snapshot-games]');
  for (const [i, game] of slate.entries()) {
    const card = document.createElement('details');
    card.open = i === 0;
    card.innerHTML = '<summary><span class="snapshot_matchup">' + teamBadge(game.away) +
      '<span>at</span>' + teamBadge(game.home) + '</span><span class="snapshot_game_time">' +
      game.time + ' · Scheduled</span></summary>';
    if (game.pitchers.length) {
      const table = document.createElement('table');
      table.setAttribute('aria-label', game.away + ' at ' + game.home + ' probable pitchers');
      table.innerHTML = '<thead><tr><th scope="col">Probable pitcher</th><th scope="col">Matchup Score</th></tr></thead><tbody></tbody>';
      game.pitchers.forEach((name, index) => {
        const row = table.tBodies[0].insertRow();
        const side = index === 0 ? 'Away' : 'Home';
        const team = index === 0 ? game.away : game.home;
        const opponent = index === 0 ? game.home : game.away;
        const player = document.createElement('th');
        player.scope = 'row';
        const link = document.createElement('a');
        link.className = 'snapshot_pitcher';
        link.href = '#' + team + '-starters-' + name.toLowerCase().replaceAll(' ', '-');
        const photo = document.createElement('img');
        photo.alt = '';
        photo.loading = 'lazy';
        photo.width = 33;
        photo.height = 33;
        photo.src = photos + name.toLowerCase().replaceAll(' ', '_') + '.png';
        photo.addEventListener('error', () => photo.remove(), { once: true });
        link.append(photo, document.createTextNode(name));
        player.append(link);
        row.append(player);
        const cell = row.insertCell();
        cell.className = 'snapshot_score';
        cell.textContent = '—';
        showPitcherScore(cell, name, side, opponent);
      });
      card.append(table);
    } else {
      const status = document.createElement('p');
      status.textContent = 'Probable pitchers TBD';
      card.append(status);
    }
    const preview = document.createElement('a');
    preview.className = 'snapshot_gameday';
    preview.href = '#matchups?mode=gameday_matchup&day=DEV+example&team=' + game.home + '&fixture=dev';
    preview.textContent = 'Gameday Matchup Preview';
    card.append(preview);

    const forecast = document.createElement('p');
    forecast.textContent = game.weather;
    card.append(forecast);
    games.append(card);
  }
  // The rankings are built from the same fragments and stay cheap to load.
  for (const [group, rows] of Object.entries(data.rankings)) {
    const body = snapshot.querySelector('[data-snapshot-ranks="' + group + '"]');
    for (const [index, entry] of rows.entries()) {
      const row = body.insertRow();
      row.insertCell().textContent = index + 1;
      const nameCell = row.insertCell();
      const name = document.createElement(entry.page ? 'a' : 'span');
      if (entry.page) name.href = '#' + entry.page;
      name.textContent = entry.name;
      nameCell.append(name);
      row.insertCell().innerHTML = teamBadge(entry.team) + ' <span class="snapshot_vs">vs</span> ' + teamBadge(entry.opponent);
      row.insertCell().append(snapshot_score_badge(entry.score.toFixed(2), entry.sample,
        group === 'hitters' ? 'hitter' : 'pitcher'));
    }
  }

}
