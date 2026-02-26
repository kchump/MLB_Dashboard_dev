/* =============================================================================
   MLB Dashboard JS (assets/app.js)
   - Sections:
     1) Caching + localStorage helpers
     2) Page loading + activation
     3) Team role tabs
     4) Search mode behavior
     5) Search + filters
     6) Collapse/expand persistence
     7) Mobile scaling
     8) DOMContentLoaded init wiring
   ============================================================================= */

/* =============================================================================
   1) Caching + localStorage helpers
   ============================================================================= */
const page_cache = new Map();

let year_page_lookup = null;

function safe_page_filename(s) {
  const raw = String(s || '').trim();
  const out = raw.replace(/[^a-zA-Z0-9_\-\.]+/g, '_').replace(/^_+|_+$/g, '');
  return out || 'page';
}

async function load_year_page_lookup() {
  if (year_page_lookup !== null) return year_page_lookup;

  try {
    const r = await fetch('assets/year_page_lookup.json', { cache: 'no-store' });
    if (!r.ok) {
      year_page_lookup = {};
      return year_page_lookup;
    }
    year_page_lookup = await r.json();
    return year_page_lookup;
  } catch (e) {
    year_page_lookup = {};
    return year_page_lookup;
  }
}

function render_year_select_in_content(content_root) {
  if (!content_root || !year_page_lookup) return;

  const year_blocks = Array.from(content_root.querySelectorAll('.year_buttons'));
  if (!year_blocks.length) return;

  const years = Object.keys(year_page_lookup).sort().reverse();
  const current_year = years.length ? years[0] : '';

  year_blocks.forEach(el => {
    const person_key = (el.getAttribute('data-person_key') || '').trim();
    const role = (el.getAttribute('data-role') || '').trim();

    el.innerHTML = '';
    if (!person_key || !role) return;

    const active_file = (document.querySelector('.toc_link.active')?.dataset.file || '');

    const wrap = document.createElement('div');
    wrap.className = 'year_select_wrap';

    const label = document.createElement('div');
    label.className = 'year_select_label';
    label.textContent = 'Year';

    const sel = document.createElement('select');
    sel.className = 'year_select';

    function add_opt(text, file, is_selected) {
      const o = document.createElement('option');
      o.value = file;
      o.textContent = text;
      if (is_selected) o.selected = true;
      sel.appendChild(o);
    }

    // Build options:
    // - Current year appears as "Current" and points to the current-year page file.
    // - Historical years appear as their numeric year.
    years.forEach(y => {
      const role_map = (year_page_lookup[y] || {})[role] || {};
      const file = role_map[person_key];
      if (!file) return;

      const is_current = (String(y) === String(current_year));
      const label_text = is_current ? 'Current' : String(y);
      const is_selected = (file === active_file);

      add_opt(label_text, file, is_selected);
    });

    // If we didn’t match active_file (edge case), default to first option
    if (!sel.querySelector('option[selected]') && sel.options.length) {
      sel.selectedIndex = 0;
    }

    sel.addEventListener('change', (e) => {
      e.preventDefault();
      const file = sel.value;
      if (!file) return;
      load_page(file, (document.querySelector('.toc_link.active')?.dataset.page || ''));
    });

    wrap.appendChild(label);
    wrap.appendChild(sel);
    el.appendChild(wrap);
  });
}

function team_storage_key(team) {
  return 'mlb_dash_team_open__' + team;
}

function division_storage_key(div_id) {
  return 'mlb_dash_div_open__' + div_id;
}

function read_collapsed(key, default_collapsed) {
  try {
    const v = localStorage.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) {}
  return default_collapsed;
}

function write_collapsed(key, collapsed) {
  try {
    localStorage.setItem(key, collapsed ? '1' : '0');
  } catch (e) {}
}

/* =============================================================================
   2) Page loading + activation
   ============================================================================= */
async function load_page(file, page_id) {
  const content = document.getElementById('content_root');
  if (!content) return;

  content.innerHTML = '<div style="padding:12px;color:rgba(96,103,112,0.95);">Loading…</div>';

  let html = page_cache.get(file);
  if (!html) {
    const r = await fetch(file);
    html = await r.text();
    page_cache.set(file, html);
  }

  content.innerHTML = html;

  // Plotly fragments include inline <script> tags; scripts inserted via innerHTML do not run.
  // Re-create those script tags so the browser executes them.
  const scripts = Array.from(content.querySelectorAll('script'));
  scripts.forEach(old => {
    const s = document.createElement('script');
    if (old.type) s.type = old.type;
    if (old.src) {
      s.src = old.src;
    } else {
      s.text = old.textContent || '';
    }
    content.appendChild(s);
    old.remove();
  });

  // Sidebar active highlight
  const links = document.querySelectorAll('.toc_link');
  links.forEach(a => a.classList.toggle('active', a.dataset.page === page_id));

  try { localStorage.setItem('mlb_dash_active_page', page_id); } catch (e) {}

  // Year buttons (current player page -> historical page links)
  await load_year_page_lookup();
  render_year_select_in_content(content);

  // If this is a matchups/static meta page, wire its JS here too (see section 3D)
  init_matchups_page_if_present(content);

  // Warm a couple pages ahead (best-effort)
  const active = document.querySelector(`.toc_link[data-page="${page_id}"]`);
  if (active) {
    const lis = Array.from(active.closest('.player_list')?.querySelectorAll('.toc_link') || []);
    const i = lis.indexOf(active);
    [i + 1, i + 2].forEach(j => {
      const a = lis[j];
      if (!a) return;
      const f = a.dataset.file;
      if (!f || page_cache.has(f)) return;
      fetch(f).then(r => r.text()).then(t => page_cache.set(f, t)).catch(() => {});
    });
  }
}

function activate_page(page_id) {
  let a = null;
  document.querySelectorAll('.toc_link').forEach(x => {
    if (x.dataset.page === page_id) a = x;
  });
  if (!a) return;

  const file = a.dataset.file;
  if (!file) return;

  load_page(file, page_id);

  // update hash without hard jump
  history.replaceState(null, '', '#' + encodeURIComponent(page_id));
}

function default_page_id() {
  const h = window.location.hash || '';
  const raw = h.startsWith('#') ? h.slice(1) : h;
  if (raw) return decodeURIComponent(raw);

  try {
    const saved = localStorage.getItem('mlb_dash_active_page');
    if (saved) return saved;
  } catch (e) {}

  return 'home';
}

function on_hash_change() {
  const pid = default_page_id();
  activate_page(pid);
}

/* =============================================================================
   3) Team role tabs
   ============================================================================= */
function set_team_role_tab(team, role) {
  document.querySelectorAll('.role_tab').forEach(btn => {
    if (btn.dataset.team === team) {
      btn.classList.toggle('active', btn.dataset.role === role);
    }
  });

  document.querySelectorAll('.role_list').forEach(list => {
    if (list.dataset.team === team) {
      list.style.display = (list.dataset.role === role) ? '' : 'none';
    }
  });

  const search = document.getElementById('player_search');
  apply_search_and_filters((search && search.value) ? search.value : '');
}

/* =============================================================================
   4) Search mode behavior (force open while searching, restore after)
   ============================================================================= */
function set_search_mode(is_searching) {
  // divisions
  document.querySelectorAll('.division_block').forEach(db => {
    const div_id = db.dataset.division || '';
    const btn = Array.from(document.querySelectorAll('.division_title')).find(b => (b.dataset.division || '') === div_id);

    if (is_searching) {
      if (db.dataset.prev_collapsed === undefined) {
        db.dataset.prev_collapsed = db.classList.contains('collapsed') ? '1' : '0';
      }
      db.classList.remove('collapsed');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    } else {
      let collapsed = false;

      if (db.dataset.prev_collapsed !== undefined) {
        collapsed = (db.dataset.prev_collapsed === '1');
        delete db.dataset.prev_collapsed;
      } else {
        collapsed = read_collapsed(division_storage_key(div_id), false);
      }

      db.classList.toggle('collapsed', collapsed);
      if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  });

  // teams
  document.querySelectorAll('.team_block').forEach(tb => {
    const team = tb.dataset.team || '';
    const btn = Array.from(document.querySelectorAll('.team_title')).find(b => (b.dataset.team || '') === team);

    if (is_searching) {
      if (tb.dataset.prev_collapsed === undefined) {
        tb.dataset.prev_collapsed = tb.classList.contains('collapsed') ? '1' : '0';
      }
      tb.classList.remove('collapsed');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    } else {
      let collapsed = true;

      if (tb.dataset.prev_collapsed !== undefined) {
        collapsed = (tb.dataset.prev_collapsed === '1');
        delete tb.dataset.prev_collapsed;
      } else {
        collapsed = read_collapsed(team_storage_key(team), true);
      }

      tb.classList.toggle('collapsed', collapsed);
      if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
  });

  // hide tabs during search
  document.querySelectorAll('.role_tabs').forEach(tabs => {
    tabs.style.display = is_searching ? 'none' : '';
  });

  // role lists
  document.querySelectorAll('.role_list').forEach(list => {
    if (is_searching) {
      list.style.display = '';
      return;
    }

    const team = list.dataset.team;
    const active_tab = Array.from(document.querySelectorAll('.role_tab.active')).find(t => (t.dataset.team || '') === team);
    const active_role = active_tab ? active_tab.dataset.role : 'batters';
    list.style.display = (list.dataset.role === active_role) ? '' : 'none';
  });
}

/* =============================================================================
   5) Search + filters
   ============================================================================= */
function is_visible(el) {
  if (!el) return false;
  return (el.style.display !== 'none');
}

function cleanup_role_list(role_list) {
  if (!role_list) return;

  const in_search = (document.body.dataset.is_searching === '1');
  const team = role_list.dataset.team || '';

  let active_tab = null;
  document.querySelectorAll('.role_tab.active').forEach(t => {
    if (t.dataset.team === team) active_tab = t;
  });

  const active_role = active_tab ? (active_tab.dataset.role || 'batters') : 'batters';
  const hidden_by_tab = (!in_search && (role_list.dataset.role !== active_role));
  if (hidden_by_tab) return;

  role_list.querySelectorAll('.sub_role_label').forEach(el => el.style.display = '');

  const lis = Array.from(role_list.querySelectorAll('.player_li'));
  const has_any_player_visible = lis.some(li => is_visible(li));

  role_list.style.display = has_any_player_visible ? '' : 'none';
  if (!has_any_player_visible) return;

  const ul = role_list.querySelector('.player_list');
  if (!ul) return;

  const kids = Array.from(ul.children);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (!kid.classList || !kid.classList.contains('sub_role_label')) continue;

    let any_visible_in_section = false;

    for (let j = i + 1; j < kids.length; j++) {
      const nxt = kids[j];

      if (nxt.classList && nxt.classList.contains('sub_role_label')) break;

      if (nxt.classList && nxt.classList.contains('player_li') && is_visible(nxt)) {
        any_visible_in_section = true;
        break;
      }

      const li = (nxt.querySelector ? nxt.querySelector('.player_li') : null);
      if (li && is_visible(li)) {
        any_visible_in_section = true;
        break;
      }
    }

    kid.style.display = any_visible_in_section ? '' : 'none';
  }
}

function current_filters() {
  const hide_minors = !!(document.getElementById('filter_hide_minors') && document.getElementById('filter_hide_minors').checked);
  const hide_hurt = !!(document.getElementById('filter_hide_hurt') && document.getElementById('filter_hide_hurt').checked);
  return { hide_minors, hide_hurt };
}

function apply_search_and_filters(q) {
  const query = (q || '').trim().toLowerCase();
  const searching = query.length > 0;

  const was_searching = (document.body.dataset.is_searching === '1');
  document.body.dataset.is_searching = searching ? '1' : '0';

  if (!searching) {
    set_search_mode(false);
  } else if (searching !== was_searching) {
    set_search_mode(true);
  }

  const f = current_filters();

  const team_blocks = document.querySelectorAll('.team_block');
  team_blocks.forEach(tb => {
    let any_visible_in_team = false;

    tb.querySelectorAll('.toc_link').forEach(a => {
      const name = a.dataset.name || '';
      const is_minors = (a.dataset.is_minors === '1');
      const is_hurt = (a.dataset.is_hurt === '1');
      const is_susp = (a.dataset.is_susp === '1');

      let show = true;

      if (searching && !name.includes(query)) show = false;
      if (f.hide_minors && is_minors) show = false;
      if (f.hide_hurt && (is_hurt || is_susp)) show = false;

      const li = a.closest('.player_li');
      if (li) li.style.display = show ? '' : 'none';
      if (show) any_visible_in_team = true;
    });

    tb.querySelectorAll('.role_list').forEach(role_list => {
      cleanup_role_list(role_list);
    });

    tb.style.display = any_visible_in_team ? '' : 'none';
  });

  document.querySelectorAll('.division_block').forEach(db => {
    const any_visible_team = Array.from(db.querySelectorAll('.team_block')).some(tb => tb.style.display !== 'none');
    db.style.display = any_visible_team ? '' : 'none';
  });
}

/* =============================================================================
   6) Collapse/expand persistence
   ============================================================================= */
function set_division_collapsed(div_id, collapsed) {
  const blocks = Array.from(document.querySelectorAll('.division_block'));
  const btns = Array.from(document.querySelectorAll('.division_title'));

  const block = blocks.find(b => (b.dataset.division || '') === div_id);
  const btn = btns.find(b => (b.dataset.division || '') === div_id);
  if (!block || !btn) return;

  write_collapsed(division_storage_key(div_id), collapsed);
  block.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function set_team_collapsed(team, collapsed) {
  let block = null;
  let btn = null;

  document.querySelectorAll('.team_block').forEach(b => {
    if (b.dataset.team === team) block = b;
  });

  document.querySelectorAll('.team_title').forEach(b => {
    if (b.dataset.team === team) btn = b;
  });

  if (!block || !btn) return;

  write_collapsed(team_storage_key(team), collapsed);
  block.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  if (!collapsed && document.body.dataset.is_searching !== '1') {
    set_team_role_tab(team, 'batters');
  }
}

/* =============================================================================
   7) Mobile scaling for Plotly-heavy pages
   ============================================================================= */
function apply_mobile_scale() {
  const is_touch_mobile = window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
  const content = document.getElementById('content_root');
  if (!content) return;

  const page = content.querySelector('.player_page');
  if (!page) return;

  // Do not scale static pages (Home / Key)
  const has_static = page.querySelector('.static_page');

  if (!is_touch_mobile || has_static) {
    content.style.transform = '';
    content.style.transformOrigin = '';
    content.style.width = '';
    return;
  }

  const pad = 20;
  const target_w = Math.max(320, window.innerWidth - pad);
  const scale = Math.min(1, target_w / 1350);

  content.style.transform = `scale(${scale})`;
  content.style.transformOrigin = 'top left';
  content.style.width = `${Math.ceil(1350 * scale)}px`;
}

const matchups_cache = new Map();
let matchups_index = null;

async function load_matchups_index() {
  if (matchups_index !== null) return matchups_index;

  try {
    const r = await fetch('assets/matchups/matchups_index.json', { cache: "no-store" });
    if (!r.ok) {
      matchups_index = null;
      return null;
    }
    matchups_index = await r.json();
    return matchups_index;
  } catch (e) {
    matchups_index = null;
    return null;
  }
}

function make_select(id, label_text) {
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = '6px';

  const label = document.createElement('div');
  label.textContent = label_text;
  label.style.fontSize = '12px';
  label.style.fontWeight = '700';
  label.style.color = 'rgba(96,103,112,0.95)';

  const sel = document.createElement('select');
  sel.id = id;
  sel.style.border = '1px solid var(--border)';
  sel.style.borderRadius = '10px';
  sel.style.padding = '8px 10px';
  sel.style.fontSize = '13px';
  sel.style.background = 'white';

  wrap.appendChild(label);
  wrap.appendChild(sel);

  return { wrap, sel };
}

function set_select_options(sel, options, placeholder) {
  sel.innerHTML = '';

  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  sel.appendChild(ph);

  options.forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function run_scripts_in(root) {
  const scripts = Array.from(root.querySelectorAll('script'));
  scripts.forEach(old => {
    const s = document.createElement('script');
    if (old.type) s.type = old.type;
    if (old.src) {
      s.src = old.src;
    } else {
      s.text = old.textContent || '';
    }
    root.appendChild(s);
    old.remove();
  });
}

function resolve_fragment(idx, year, mode, keys) {
  let cur = (idx && idx.fragments) ? idx.fragments : null;
  if (!cur) return null;

  const all = [String(year), String(mode), ...keys.map(k => String(k))];

  for (const k of all) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[k];
  }

  return (typeof cur === 'string') ? cur : null;
}

async function load_matchup_fragment(path) {
  if (!path) return null;

  const cached = matchups_cache.get(path);
  if (cached) return cached;

  try {
    const r = await fetch(path, { cache: "no-store" });
    if (!r.ok) return null;
    const html = await r.text();
    matchups_cache.set(path, html);
    return html;
  } catch (e) {
    return null;
  }
}

function init_matchups_page_if_present(content_root) {
  if (!content_root) return;

  const mode_root = content_root.querySelector('#matchups_mode_root');
  const form_root = content_root.querySelector('#matchups_form_root');
  const results_root = content_root.querySelector('#matchups_results_root');
  if (!mode_root || !form_root || !results_root) return;

  if (form_root.dataset.inited === '1') return;
  form_root.dataset.inited = '1';

  mode_root.innerHTML = '';
  form_root.innerHTML = '';
  results_root.innerHTML = '';

  const mode_select = document.createElement('select');
  mode_select.style.padding = '8px 10px';
  mode_select.style.border = '1px solid var(--border)';
  mode_select.style.borderRadius = '10px';

  const modes = [
    ['sp_vs_team', 'SP vs Team'],
    ['sp_vs_2', 'SP vs 2 Teams'],
    ['rp_inning', 'RP Inning'],
    ['hitter_vs_pitcher', 'Hitter vs Pitcher'],
    ['multi_hitter', 'Multiple Hitters']
  ];

  modes.forEach(m => {
    const o = document.createElement('option');
    o.value = m[0];
    o.textContent = m[1];
    mode_select.appendChild(o);
  });

  mode_root.appendChild(mode_select);

  function clear_results() {
    results_root.innerHTML = '';
  }

  async function render_fragments(paths) {
    clear_results();
    for (const p of paths) {
      if (!p) continue;
      const html = await load_matchup_fragment(p);
      if (!html) continue;

      const block = document.createElement('div');
      block.style.margin = '12px 0';
      block.innerHTML = html;
      results_root.appendChild(block);
      run_scripts_in(block);
    }
  }

  async function build_form() {
  form_root.innerHTML = '';
  clear_results();

  const idx = await load_matchups_index();
  if (!idx) return;

  const years = idx.years || [];
  const hitters = idx.hitters || [];
  const pitchers = idx.pitchers || [];
  const teams = idx.teams || [];

  const mode = mode_select.value;

  function build_select(id, label_text, options, placeholder) {
    const { wrap, sel } = make_select(id, label_text);
    set_select_options(sel, options, placeholder);
    form_root.appendChild(wrap);
    return sel;
  }

  function build_side_select(id) {
    return build_select(id, 'vs/@', ['@', 'vs'], 'Select');
  }

  const year_sel = build_select('matchups_year', 'Year', years, 'Select year');

  async function render_one(path) {
    await render_fragments([path]);
  }

  async function render_many(paths) {
    await render_fragments(paths.filter(Boolean));
  }

  if (mode === 'sp_vs_team') {
    const pitcher_sel = build_select('matchups_pitcher', 'Pitcher', pitchers, 'Select pitcher');
    const side_sel = build_side_select('matchups_side');
    const team_sel = build_select('matchups_team', 'Team', teams, 'Select team');

    async function submit() {
      const y = year_sel.value;
      const p = pitcher_sel.value;
      const s = side_sel.value;
      const t = team_sel.value;
      if (!y || !p || !s || !t) return;

      const path = resolve_fragment(idx, y, 'sp_vs_team', [p, s, t]);
      await render_one(path);
    }

    [pitcher_sel, side_sel, team_sel, year_sel].forEach(x => x.addEventListener('change', submit));
    return;
  }

  if (mode === 'sp_vs_2') {
    const pitcher_sel = build_select('matchups_pitcher', 'Pitcher', pitchers, 'Select pitcher');

    const side_sel_0 = build_side_select('matchups_side_0');
    const team_sel_0 = build_select('matchups_team_0', 'Team (1)', teams, 'Select team');

    const side_sel_1 = build_side_select('matchups_side_1');
    const team_sel_1 = build_select('matchups_team_1', 'Team (2)', teams, 'Select team');

    async function submit() {
      const y = year_sel.value;
      const p = pitcher_sel.value;
      if (!y || !p) return;

      const paths = [
        resolve_fragment(idx, y, 'sp_vs_2', [p, side_sel_0.value, team_sel_0.value]),
        resolve_fragment(idx, y, 'sp_vs_2', [p, side_sel_1.value, team_sel_1.value]),
      ];
      await render_many(paths);
    }

    [pitcher_sel, side_sel_0, team_sel_0, side_sel_1, team_sel_1, year_sel].forEach(x => x.addEventListener('change', submit));
    return;
  }

  if (mode === 'hitter_vs_pitcher') {
    const hitter_sel = build_select('matchups_hitter', 'Hitter', hitters, 'Select hitter');
    const side_sel = build_side_select('matchups_side');
    const pitcher_sel = build_select('matchups_pitcher', 'Pitcher', pitchers, 'Select pitcher');

    async function submit() {
      const y = year_sel.value;
      const h = hitter_sel.value;
      const s = side_sel.value;
      const p = pitcher_sel.value;
      if (!y || !h || !s || !p) return;

      const path = resolve_fragment(idx, y, 'hitter_vs_pitcher', [h, s, p]);
      await render_one(path);
    }

    [hitter_sel, side_sel, pitcher_sel, year_sel].forEach(x => x.addEventListener('change', submit));
    return;
  }

  if (mode === 'multi_hitter') {
    const rows = [];

    for (let i = 0; i < 5; i++) {
      const { wrap: h_wrap, sel: h_sel } = make_select(`matchups_hitter_${i}`, `Hitter ${i + 1}`);
      set_select_options(h_sel, hitters, 'Select hitter');

      const { wrap: s_wrap, sel: s_sel } = make_select(`matchups_side_${i}`, 'vs/@');
      set_select_options(s_sel, ['@', 'vs'], 'Select');

      const { wrap: p_wrap, sel: p_sel } = make_select(`matchups_pitcher_${i}`, 'Pitcher');
      set_select_options(p_sel, pitchers, 'Select pitcher');

      form_root.appendChild(h_wrap);
      form_root.appendChild(s_wrap);
      form_root.appendChild(p_wrap);

      rows.push({ h_sel, s_sel, p_sel });
    }

    async function submit() {
      const y = year_sel.value;
      if (!y) return;

      const paths = rows
        .filter(r => r.h_sel.value && r.s_sel.value && r.p_sel.value)
        .map(r => resolve_fragment(idx, y, 'hitter_vs_pitcher', [r.h_sel.value, r.s_sel.value, r.p_sel.value]));

      await render_many(paths);
    }

    rows.forEach(r => [r.h_sel, r.s_sel, r.p_sel].forEach(x => x.addEventListener('change', submit)));
    year_sel.addEventListener('change', submit);
    return;
  }

  if (mode === 'rp_inning') {
    const { wrap: rp_wrap, sel: rp_sel } = make_select('matchups_rp', 'RP');
    set_select_options(rp_sel, pitchers, 'Select RP');

    const { wrap: b1_wrap, sel: b1_sel } = make_select('matchups_b1', 'Batter 1');
    set_select_options(b1_sel, hitters, 'Select batter');

    const { wrap: b2_wrap, sel: b2_sel } = make_select('matchups_b2', 'Batter 2');
    set_select_options(b2_sel, hitters, 'Select batter');

    const { wrap: b3_wrap, sel: b3_sel } = make_select('matchups_b3', 'Batter 3');
    set_select_options(b3_sel, hitters, 'Select batter');

    form_root.appendChild(rp_wrap);
    form_root.appendChild(b1_wrap);
    form_root.appendChild(b2_wrap);
    form_root.appendChild(b3_wrap);

    async function submit() {
      const y = year_sel.value;
      if (!y || !rp_sel.value || !b1_sel.value || !b2_sel.value || !b3_sel.value) return;

      const path = resolve_fragment(idx, y, 'rp_inning', [rp_sel.value, b1_sel.value, b2_sel.value, b3_sel.value]);
      await render_one(path);
    }

    [rp_sel, b1_sel, b2_sel, b3_sel, year_sel].forEach(x => x.addEventListener('change', submit));
    return;
  }
}

  mode_select.addEventListener('change', build_form);
  build_form();
}

/* =============================================================================
   8) Init wiring
   ============================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const toggle_sidebar_btn = document.getElementById('toggle_sidebar');
  const is_touch_mobile = window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
  if (toggle_sidebar_btn && !is_touch_mobile) toggle_sidebar_btn.style.display = 'none';

  const sidebar = document.querySelector('.sidebar');

  function set_sidebar_hidden(hidden) {
    if (!sidebar) return;
    sidebar.classList.toggle('hidden', hidden);

    if (toggle_sidebar_btn) {
      toggle_sidebar_btn.textContent = hidden ? '☰ Teams' : 'Hide Teams';
    }
  }

  if (toggle_sidebar_btn) {
    toggle_sidebar_btn.addEventListener('click', () => {
      const hidden = sidebar && sidebar.classList.contains('hidden');
      set_sidebar_hidden(!hidden);
    });
  }

  // Team collapse clicks
  document.querySelectorAll('.team_title').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();

      const block = btn.closest('.team_block');
      if (!block) return;

      const team = block.dataset.team || '';
      const collapsed = block.classList.contains('collapsed');
      set_team_collapsed(team, !collapsed);
    });
  });

  // Division collapse clicks
  document.querySelectorAll('.division_title').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();

      const block = btn.closest('.division_block');
      if (!block) return;

      const div_id = block.dataset.division || '';
      const collapsed = block.classList.contains('collapsed');
      set_division_collapsed(div_id, !collapsed);
    });
  });

  // Init collapse defaults
  document.querySelectorAll('.team_block').forEach(tb => {
    const team = tb.dataset.team || '';
    const collapsed = read_collapsed(team_storage_key(team), true);
    set_team_collapsed(team, collapsed);
  });

  document.querySelectorAll('.division_block').forEach(db => {
    const div_id = db.dataset.division || '';
    const collapsed = read_collapsed(division_storage_key(div_id), false);
    set_division_collapsed(div_id, collapsed);
  });

  // Role tabs
  document.querySelectorAll('.role_tab').forEach(btn => {
    btn.addEventListener('click', () => {
      set_team_role_tab(btn.dataset.team, btn.dataset.role);
    });
  });

  // Link clicks load pages via fetch
  document.querySelectorAll('.toc_link').forEach(a => {
    const page_id = a.dataset.page;
    const file = a.dataset.file;
    if (!page_id || !file) return;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      activate_page(page_id);
    });
  });

  // Search + clear button
  const search = document.getElementById('player_search');
  const clear_btn = document.getElementById('search_clear');

  function sync_clear_btn() {
    if (!clear_btn || !search) return;
    const has_text = (search.value && search.value.trim().length);
    clear_btn.style.display = has_text ? 'inline-flex' : 'none';
  }

  if (search) {
    search.addEventListener('input', () => {
      apply_search_and_filters(search.value);
      sync_clear_btn();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        search.value = '';
        apply_search_and_filters('');
        sync_clear_btn();
      }
    });
  }

  if (clear_btn && search) {
    clear_btn.addEventListener('click', () => {
      search.value = '';
      apply_search_and_filters('');
      sync_clear_btn();
      search.focus();
    });
  }

  sync_clear_btn();

  const cb_minors = document.getElementById('filter_hide_minors');
  if (cb_minors) cb_minors.addEventListener('change', () => apply_search_and_filters((search && search.value) ? search.value : ''));

  const cb_hurt = document.getElementById('filter_hide_hurt');
  if (cb_hurt) cb_hurt.addEventListener('change', () => apply_search_and_filters((search && search.value) ? search.value : ''));

  window.addEventListener('hashchange', on_hash_change);

  window.addEventListener('resize', apply_mobile_scale);
  apply_mobile_scale();

  on_hash_change();
  apply_search_and_filters((search && search.value) ? search.value : '');
});