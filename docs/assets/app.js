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

let active_content_file = '';
let active_page_id = '';

function render_year_select_in_content(content_root) {
  if (!content_root || !year_page_lookup) return;

  const year_blocks = Array.from(content_root.querySelectorAll('.year_buttons'));
  if (!year_blocks.length) return;

  const years = Object.keys(year_page_lookup)
    .map(y => String(y))
    .filter(y => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));

  const current_year = years.length ? String(years[0]) : '';

  year_blocks.forEach(el => {
    const person_key = (el.getAttribute('data-person_key') || '').trim();
    const role = (el.getAttribute('data-role') || '').trim();

    el.innerHTML = '';
    if (!person_key || !role) return;

    const active_file = active_content_file || (document.querySelector('.toc_link.active')?.dataset.file || '');

    const wrap = document.createElement('div');
    wrap.className = 'year_select_wrap';

    const label = document.createElement('div');
    label.className = 'year_select_label';
    label.textContent = 'Year';

    const sel = document.createElement('select');
    sel.className = 'year_select';

    let any_selected = false;

    function add_opt(text, file, is_selected) {
      const o = document.createElement('option');
      o.value = file;
      o.textContent = text;
      if (is_selected) {
        o.selected = true;
        any_selected = true;
      }
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
    if (!any_selected && sel.options.length) {
      sel.selectedIndex = 0;
    }

    sel.addEventListener('change', (e) => {
      e.preventDefault();
      const file = sel.value;
      if (!file) return;
      load_page(file, active_page_id || (document.querySelector('.toc_link.active')?.dataset.page || ''));
      // keep hash aligned with "this player's id" so refresh/back works predictably
      if (active_page_id) history.replaceState(null, '', '#' + encodeURIComponent(active_page_id));
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
  active_content_file = file || '';
  active_page_id = page_id || active_page_id || '';

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
    dbg('loaded matchups_index.json keys:', Object.keys(matchups_index || {}));
    return matchups_index;
  } catch (e) {
    matchups_index = null;
    return null;
  }
}

let matchups_lists = null;
const MATCHUPS_DEBUG = true;

function dbg(...args) {
  if (!MATCHUPS_DEBUG) return;
  console.log('[matchups]', ...args);
}

async function load_matchups_lists() {
  if (matchups_lists !== null) return matchups_lists;

  try {
    const r = await fetch('assets/matchups/matchups_lists.json', { cache: 'no-store' });
    if (!r.ok) {
      matchups_lists = null;
      return null;
    }
    matchups_lists = await r.json();
    dbg('loaded matchups_lists.json keys:', Object.keys(matchups_lists || {}));
if (matchups_lists && matchups_lists.by_year && typeof matchups_lists.by_year === 'object') {
  dbg('matchups_lists by_year years:', Object.keys(matchups_lists.by_year).slice(0, 10));
} else {
  dbg('matchups_lists has no by_year (or wrong shape)');
}
    return matchups_lists;
  } catch (e) {
    matchups_lists = null;
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
  sel.dataset.field = String(id || '').replace(/^matchups_/, '');
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

  (options || []).forEach(v => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
  });
}

function set_grouped_or_flat(sel, groups, flat, placeholder) {
  const has_groups = Array.isArray(groups) && groups.length;
  if (has_groups) {
    set_select_options_grouped(sel, groups, placeholder);
    return;
  }
  set_select_options(sel, flat || [], placeholder);
}

function set_select_options_grouped(sel, groups, placeholder) {
  sel.innerHTML = '';

  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  sel.appendChild(ph);

  (groups || []).forEach(g => {
    const og = document.createElement('optgroup');
    og.label = g.label;

    (g.options || []).forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      og.appendChild(o);
    });

    sel.appendChild(og);
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
  if (!idx || !idx.modes || !idx.modes[mode]) return null;

  let cur = idx.modes[mode].fragments;
  if (!cur) return null;

  cur = cur[String(year)];
  if (!cur) return null;

  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return null;
    cur = cur[String(k)];
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
  const prev_year = document.getElementById('matchups_year')?.value || '';
  clear_results();

  const idx = await load_matchups_index();
  if (!idx) return;
const lists = await load_matchups_lists();

dbg('build_form mode:', mode_select.value);
dbg('idx years:', idx && idx.years ? idx.years : '(none)');
dbg('lists years:', (lists && Array.isArray(lists.years)) ? lists.years : '(none)');

function derive_years(idx_obj) {
  const out = new Set();

  const direct = idx_obj && idx_obj.years ? idx_obj.years : [];
  (direct || []).forEach(y => {
    const s = String(y || '').trim();
    if (/^\d{4}$/.test(s)) out.add(s);
  });

  if (out.size) {
    return Array.from(out).sort((a, b) => Number(b) - Number(a));
  }

  const modes_obj = (idx_obj && idx_obj.modes) ? idx_obj.modes : {};
  Object.keys(modes_obj).forEach(m => {
    const fr = (modes_obj[m] && modes_obj[m].fragments) ? modes_obj[m].fragments : null;
    if (!fr || typeof fr !== 'object') return;
    Object.keys(fr).forEach(y => {
      const s = String(y || '').trim();
      if (/^\d{4}$/.test(s)) out.add(s);
    });
  });

  return Array.from(out).sort((a, b) => Number(b) - Number(a));
}

let years = derive_years(idx);

if (lists && Array.isArray(lists.years) && lists.years.length) {
  years = Array.from(new Set(lists.years.map(y => String(y).trim())))
    .filter(y => /^\d{4}$/.test(y))
    .sort((a, b) => Number(b) - Number(a));
}

  let hitters = [];
  let pitchers = [];
  let teams = [];
  let year_lists = { hitters_by_team: [], pitchers_by_team: [] };

  function last_name_key(name) {
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.split(/\s+/);
    return parts[parts.length - 1].toLowerCase();
  }

  function get_mode_year_fragments(idx_obj, mode, y) {
    if (!idx_obj || !idx_obj.modes || !idx_obj.modes[mode]) return null;
    const fr = idx_obj.modes[mode].fragments;
    if (!fr || typeof fr !== 'object') return null;
    return fr[String(y)] || null;
  }

function refresh_lists_from_year(y) {
  const year_val = String(y || '').trim();

  hitters = [];
  pitchers = [];
  teams = [];
  year_lists = { hitters_by_team: [], pitchers_by_team: [] };

  if (!year_val) return;
  dbg('refresh_lists_from_year year:', year_val);

  // Use precomputed per-year dropdown lists (fast path)
  const by_year = (lists && lists.by_year && typeof lists.by_year === 'object') ? lists.by_year : null;
  const pack = by_year ? by_year[year_val] : null;

dbg('lists.by_year exists:', !!by_year);
dbg('pack exists for year:', !!pack);
if (by_year && !pack) {
  dbg('available by_year years:', Object.keys(by_year).slice(0, 20));
}

  if (pack && typeof pack === 'object') {
    hitters = Array.isArray(pack.hitters) ? pack.hitters : [];
    pitchers = Array.isArray(pack.pitchers) ? pack.pitchers : [];
    teams = Array.isArray(pack.teams) ? pack.teams : [];
dbg('pack sizes', {
  hitters: hitters.length,
  pitchers: pitchers.length,
  teams: teams.length,
  hitters_by_team: Array.isArray(year_lists.hitters_by_team) ? year_lists.hitters_by_team.length : 0,
  pitchers_by_team: Array.isArray(year_lists.pitchers_by_team) ? year_lists.pitchers_by_team.length : 0,
});

    year_lists = {
      hitters_by_team: Array.isArray(pack.hitters_by_team) ? pack.hitters_by_team : [],
      pitchers_by_team: Array.isArray(pack.pitchers_by_team) ? pack.pitchers_by_team : [],
    };

    return;
  }

  // Fallback: derive from fragments for this year (slower)
  const sp_team_root = get_mode_year_fragments(idx, 'sp_vs_team', year_val);
  const sp_2_root = get_mode_year_fragments(idx, 'sp_vs_2', year_val);
  const hvp_root = get_mode_year_fragments(idx, 'hitter_vs_pitcher', year_val);
  const rp_root = get_mode_year_fragments(idx, 'rp_inning', year_val);

dbg('fallback roots present', {
  sp_vs_team: !!sp_team_root,
  sp_vs_2: !!sp_2_root,
  hitter_vs_pitcher: !!hvp_root,
  rp_inning: !!rp_root,
});

  const hitters_set = new Set();
  const pitchers_set = new Set();
  const teams_set = new Set();

  const hitters_by_team = new Map();
  const pitchers_by_team = new Map();

dbg('fallback sizes', { hitters: hitters.length, pitchers: pitchers.length, teams: teams.length });

  function add_player(map_obj, team, player) {
    const t = String(team || '').trim() || 'Other';
    const p = String(player || '').trim();
    if (!p) return;
    if (!map_obj.has(t)) map_obj.set(t, new Set());
    map_obj.get(t).add(p);
  }

  if (sp_team_root && typeof sp_team_root === 'object') {
    Object.keys(sp_team_root).forEach(p => {
      pitchers_set.add(p);
      const sides = sp_team_root[p] || {};
      Object.keys(sides).forEach(s => {
        const tmap = sides[s] || {};
        Object.keys(tmap).forEach(t => {
          teams_set.add(t);
          add_player(pitchers_by_team, t, p);
        });
      });
    });
  }

  if (sp_2_root && typeof sp_2_root === 'object') {
    Object.keys(sp_2_root).forEach(p => {
      pitchers_set.add(p);
      const sides = sp_2_root[p] || {};
      Object.keys(sides).forEach(s => {
        const tmap = sides[s] || {};
        Object.keys(tmap).forEach(t => {
          teams_set.add(t);
          add_player(pitchers_by_team, t, p);
        });
      });
    });
  }

  if (hvp_root && typeof hvp_root === 'object') {
    Object.keys(hvp_root).forEach(h => {
      hitters_set.add(h);
      const sides = hvp_root[h] || {};
      Object.keys(sides).forEach(s => {
        const pmap = sides[s] || {};
        Object.keys(pmap).forEach(p => {
          pitchers_set.add(p);
        });
      });
    });
  }

  if (rp_root && typeof rp_root === 'object') {
    Object.keys(rp_root).forEach(rp => {
      pitchers_set.add(rp);
      const b1s = rp_root[rp] || {};
      Object.keys(b1s).forEach(b1 => {
        hitters_set.add(b1);
        const b2s = b1s[b1] || {};
        Object.keys(b2s).forEach(b2 => {
          hitters_set.add(b2);
          const b3s = b2s[b2] || {};
          Object.keys(b3s).forEach(b3 => {
            hitters_set.add(b3);
          });
        });
      });
    });
  }

  function last_name_key(name) {
    const s = String(name || '').trim();
    if (!s) return '';
    const parts = s.split(/\s+/);
    return parts[parts.length - 1].toLowerCase();
  }

  hitters = Array.from(hitters_set).sort((a, b) => {
    const ka = last_name_key(a);
    const kb = last_name_key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a).localeCompare(String(b));
  });

  pitchers = Array.from(pitchers_set).sort((a, b) => {
    const ka = last_name_key(a);
    const kb = last_name_key(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a).localeCompare(String(b));
  });

  teams = Array.from(teams_set).sort();

  function map_to_groups(map_obj) {
    const groups = [];
    Array.from(map_obj.keys()).sort().forEach(t => {
      const opts = Array.from(map_obj.get(t) || []).sort((a, b) => {
        const ka = last_name_key(a);
        const kb = last_name_key(b);
        if (ka !== kb) return ka < kb ? -1 : 1;
        return String(a).localeCompare(String(b));
      });
      groups.push({ label: t, options: opts });
    });
    return groups;
  }

  year_lists = {
    hitters_by_team: map_to_groups(hitters_by_team),
    pitchers_by_team: map_to_groups(pitchers_by_team),
  };
}

  const mode = mode_select.value;

function build_select(id, label_text, options, placeholder) {
  const { wrap, sel } = make_select(id, label_text);
  set_select_options(sel, options, placeholder);
  return { wrap, sel };
}

function build_side_select(id) {
  return build_select(id, 'vs./@', ['@', 'vs.'], 'Select');
}

function append_row(row_root, items) {
  const row_div = document.createElement('div');
  row_div.style.display = 'flex';
  row_div.style.flexWrap = 'wrap';
  row_div.style.gap = '8px';
  row_div.style.alignItems = 'flex-end';

  (items || []).forEach(x => {
    if (!x || !x.wrap) return;
    row_div.appendChild(x.wrap);
  });

  row_root.appendChild(row_div);
  return row_div;
}

function build_submit_button(text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;

btn.className = 'matchups_submit';

  const wrap = document.createElement('div');
  wrap.style.marginTop = '10px';
  wrap.appendChild(btn);

  form_root.appendChild(wrap);
  return btn;
}

const year_obj = build_select('matchups_year', 'Year', years, 'Select year');
form_root.appendChild(year_obj.wrap);
const year_sel = year_obj.sel;

const preferred_year = String(window.DEFAULT_SEASON_YEAR || '2026');
const prev_year_s = String(prev_year || '').trim();

if (prev_year_s && years.includes(prev_year_s)) {
  year_sel.value = prev_year_s;
} else if (years.includes(preferred_year)) {
  year_sel.value = preferred_year;
} else if (years.length) {
  year_sel.value = years[0];
}

year_sel.addEventListener('change', () => {
  refresh_lists_from_year(year_sel.value);
  clear_results();
});

refresh_lists_from_year(year_sel.value);

  async function render_one(path) {
    await render_fragments([path]);
  }

  async function render_many(paths) {
    await render_fragments(paths.filter(Boolean));
  }

  if (mode === 'sp_vs_team') {
const pitcher_obj = make_select('matchups_pitcher', 'Pitcher');
set_grouped_or_flat(pitcher_obj.sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');

const side_obj = build_side_select('matchups_side');

const team_obj = build_select('matchups_team', 'Team', teams, 'Select team');

append_row(form_root, [
  { wrap: pitcher_obj.wrap, sel: pitcher_obj.sel },
  side_obj,
  team_obj,
]);

const pitcher_sel = pitcher_obj.sel;
const side_sel = side_obj.sel;
const team_sel = team_obj.sel;

    async function submit() {
      const y = year_sel.value;
      const p = pitcher_sel.value;
      const s = side_sel.value;
      const t = team_sel.value;
      if (!y || !p || !s || !t) return;

      const path = resolve_fragment(idx, y, 'sp_vs_team', [p, s, t]);
      await render_one(path);
    }

    
const submit_btn = build_submit_button('Submit');
submit_btn.addEventListener('click', submit);
      function refresh_mode_options() {
        clear_results();
      set_grouped_or_flat(pitcher_sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');
      set_select_options(team_sel, teams, 'Select team');

      pitcher_sel.value = '';
      side_sel.value = '';
      team_sel.value = '';
    }

    year_sel.addEventListener('change', refresh_mode_options);
    return;
  }

  if (mode === 'sp_vs_2') {
const pitcher_obj = make_select('matchups_pitcher', 'Pitcher');
set_grouped_or_flat(pitcher_obj.sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');
form_root.appendChild(pitcher_obj.wrap);

const side_0_obj = build_side_select('matchups_side_0');
const team_0_obj = build_select('matchups_team_0', 'Team (1)', teams, 'Select team');

const side_1_obj = build_side_select('matchups_side_1');
const team_1_obj = build_select('matchups_team_1', 'Team (2)', teams, 'Select team');

append_row(form_root, [side_0_obj, team_0_obj]);
append_row(form_root, [side_1_obj, team_1_obj]);

const pitcher_sel = pitcher_obj.sel;
const side_sel_0 = side_0_obj.sel;
const team_sel_0 = team_0_obj.sel;
const side_sel_1 = side_1_obj.sel;
const team_sel_1 = team_1_obj.sel;

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

const submit_btn = build_submit_button('Submit');
submit_btn.addEventListener('click', submit);
        function refresh_mode_options() {
          clear_results();
      set_grouped_or_flat(pitcher_sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');
      set_select_options(team_sel_0, teams, 'Select team');
      set_select_options(team_sel_1, teams, 'Select team');

      pitcher_sel.value = '';
      side_sel_0.value = '';
      team_sel_0.value = '';
      side_sel_1.value = '';
      team_sel_1.value = '';
    }

    year_sel.addEventListener('change', refresh_mode_options);
    return;
  }

if (mode === 'hitter_vs_pitcher') {
  const hitter_obj = make_select('matchups_hitter', 'Hitter');
  set_grouped_or_flat(hitter_obj.sel, year_lists.hitters_by_team, hitters, 'Select hitter');

  const side_obj = build_side_select('matchups_side');

  const pitcher_obj = make_select('matchups_pitcher', 'Pitcher');
  set_grouped_or_flat(pitcher_obj.sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');

  append_row(form_root, [
    { wrap: hitter_obj.wrap, sel: hitter_obj.sel },
    side_obj,
    { wrap: pitcher_obj.wrap, sel: pitcher_obj.sel },
  ]);

  const hitter_sel = hitter_obj.sel;
  const side_sel = side_obj.sel;
  const pitcher_sel = pitcher_obj.sel;

  async function submit() {
    const y = year_sel.value;
    const h = hitter_sel.value;
    const s = side_sel.value;
    const p = pitcher_sel.value;
    if (!y || !h || !s || !p) return;

    const path = resolve_fragment(idx, y, 'hitter_vs_pitcher', [h, s, p]);
    await render_one(path);
  }

  const submit_btn = build_submit_button('Submit');
  submit_btn.addEventListener('click', submit);

  function refresh_mode_options() {
    clear_results();
    set_grouped_or_flat(hitter_sel, year_lists.hitters_by_team, hitters, 'Select hitter');
    set_grouped_or_flat(pitcher_sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');
    hitter_sel.value = '';
    side_sel.value = '';
    pitcher_sel.value = '';
  }

  year_sel.addEventListener('change', refresh_mode_options);
  return;
}

  if (mode === 'multi_hitter') {
    const rows = [];

    function add_row(i) {
      const row_div = document.createElement('div');
      row_div.style.display = 'flex';
      row_div.style.flexWrap = 'wrap';
      row_div.style.gap = '8px';
      row_div.style.alignItems = 'flex-end';

      const { wrap: h_wrap, sel: h_sel } = make_select(`matchups_hitter_${i}`, `Hitter ${i + 1}`);
      set_grouped_or_flat(h_sel, year_lists.hitters_by_team, hitters, 'Select hitter');

      const { wrap: s_wrap, sel: s_sel } = make_select(`matchups_side_${i}`, 'vs./@');
      set_select_options(s_sel, ['@', 'vs.'], 'Select');

      const { wrap: p_wrap, sel: p_sel } = make_select(`matchups_pitcher_${i}`, 'Pitcher');
      set_grouped_or_flat(p_sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');

      row_div.appendChild(h_wrap);
      row_div.appendChild(s_wrap);
      row_div.appendChild(p_wrap);

      form_root.appendChild(row_div);

      rows.push({ h_sel, s_sel, p_sel });
    }

    for (let i = 0; i < 5; i++) add_row(i);
        function refresh_mode_options() {
          clear_results();
      rows.forEach(r => {
set_grouped_or_flat(r.h_sel, year_lists.hitters_by_team, hitters, 'Select hitter');
set_grouped_or_flat(r.p_sel, year_lists.pitchers_by_team, pitchers, 'Select pitcher');
        r.h_sel.value = '';
        r.s_sel.value = '';
        r.p_sel.value = '';
      });
    }

    year_sel.addEventListener('change', refresh_mode_options);

    async function submit() {
      const y = year_sel.value;
      if (!y) return;

      const paths = rows
        .filter(r => r.h_sel.value && r.s_sel.value && r.p_sel.value)
        .map(r => resolve_fragment(idx, y, 'hitter_vs_pitcher', [r.h_sel.value, r.s_sel.value, r.p_sel.value]));

      await render_many(paths);
    }

const submit_btn = build_submit_button('Submit');
submit_btn.addEventListener('click', submit);
    return;
  }

  if (mode === 'rp_inning') {
const rp_obj = make_select('matchups_rp', 'RP');
set_grouped_or_flat(rp_obj.sel, year_lists.pitchers_by_team, pitchers, 'Select RP');
const rp_sel = rp_obj.sel;

    const { wrap: b1_wrap, sel: b1_sel } = make_select('matchups_b1', 'Batter 1');
    set_grouped_or_flat(b1_sel, year_lists.hitters_by_team, hitters, 'Select batter');

    const { wrap: b2_wrap, sel: b2_sel } = make_select('matchups_b2', 'Batter 2');
    set_grouped_or_flat(b2_sel, year_lists.hitters_by_team, hitters, 'Select batter');

    const { wrap: b3_wrap, sel: b3_sel } = make_select('matchups_b3', 'Batter 3');
    set_grouped_or_flat(b3_sel, year_lists.hitters_by_team, hitters, 'Select batter');

    form_root.appendChild(rp_obj.wrap);
    form_root.appendChild(b1_wrap);
    form_root.appendChild(b2_wrap);
    form_root.appendChild(b3_wrap);

    async function submit() {
      const y = year_sel.value;
      if (!y || !rp_sel.value || !b1_sel.value || !b2_sel.value || !b3_sel.value) return;

      const path = resolve_fragment(idx, y, 'rp_inning', [rp_sel.value, b1_sel.value, b2_sel.value, b3_sel.value]);
      await render_one(path);
    }

const submit_btn = build_submit_button('Submit');
submit_btn.addEventListener('click', submit);
        function refresh_mode_options() {
          clear_results();
      set_grouped_or_flat(b1_sel, year_lists.hitters_by_team, hitters, 'Select batter');
      set_grouped_or_flat(b2_sel, year_lists.hitters_by_team, hitters, 'Select batter');
      set_grouped_or_flat(b3_sel, year_lists.hitters_by_team, hitters, 'Select batter');

      rp_sel.value = '';
      b1_sel.value = '';
      b2_sel.value = '';
      b3_sel.value = '';
    }

    year_sel.addEventListener('change', refresh_mode_options);
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