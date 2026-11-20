//====================================================================
// PROSPECTS
// Top 100 shows players with a page. Org ranks keep all ten spots.
//====================================================================
let prospects_request;
async function init_prospects(content) {
  const prospect = content.querySelector('.prospects_page');
  if (!prospect) return;

  if (!prospects_request) {
    prospects_request = fetch('assets/preview/prospects.json?v=review').then(response => {
      if (!response.ok) throw new Error('Prospect data unavailable');
      return response.json();
    }).catch(error => {
      prospects_request = null;
      throw error;
    });
  }

  let data;
  try {
    data = await prospects_request;
  } catch (error) {
    prospect.querySelector('.snapshot_note').textContent = 'Prospect data could not load.';
    return;
  }
  if (!prospect.isConnected) return;

  function fillTable(body, players, showTeam) {
    body.replaceChildren();
    for (const player of players) {
      const row = body.insertRow();
      row.insertCell().textContent = player.rank;
      const cell = row.insertCell();
      if (player.page) {
        const link = document.createElement('a');
        link.href = '#' + player.page;
        link.textContent = player.name;
        cell.append(link);
      } else {
        cell.textContent = player.name;
      }
      if (showTeam) row.insertCell().innerHTML = team_logo_html(player.team);
      for (const column of ['position', 'level', 'eta']) row.insertCell().textContent = player[column] || '—';
    }
  }

  const picker = prospect.querySelector('#prospect_org');
  const orgs = [...new Set(data.organizations.map(player => player.team))].sort();
  orgs.forEach(team => picker.add(new Option(team)));
  const national = prospect.querySelector('[data-prospect-national]');
  const org = prospect.querySelector('[data-prospect-org]');
  fillTable(national, data.national, true);
  function showOrganization() {
    fillTable(org, data.organizations.filter(player => player.team === picker.value), false);
  }
  picker.addEventListener('change', showOrganization);
  showOrganization();
}