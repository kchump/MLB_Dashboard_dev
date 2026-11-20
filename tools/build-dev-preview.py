"""Build the small Today and Prospects demos from existing DEV inputs."""

import json
import re
import unicodedata
from collections import defaultdict
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
BASEBALL = ROOT.parent / "Baseball" / "src"
YEAR = "2026"

# ====================================================================
# PLAYER CARD LINKS
# ====================================================================
def name_key(name):
    return "".join(
        char for char in unicodedata.normalize("NFKD", name.casefold())
        if char.isascii() and char.isalnum()
    )


class SidebarLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.players = defaultdict(list)

    def handle_starttag(self, tag, attrs):
        item = dict(attrs)
        if tag != "a" or "toc_link" not in item.get("class", "").split():
            return
        name, file, page = (item.get(key, "") for key in ("data-name", "data-file", "data-page"))
        if name and file and page and (DOCS / file.split("?", 1)[0]).is_file():
            self.players[name_key(name)].append((item.get("data-team"), page))

    def find(self, name, team, allow_previous_team=False):
        matches = self.players[name_key(name)]
        same_team = set(page for club, page in matches if club == team)
        if len(same_team) == 1:
            return next(iter(same_team))
        if allow_previous_team and not same_team:
            # The ranking sheet can be ahead of DEV's roster. Link a unique card.
            all_pages = set(page for club, page in matches)
            if len(all_pages) == 1:
                return next(iter(all_pages))
        return None


# ====================================================================
# TODAY'S SCORES
# ====================================================================
def score_row(path):
    html = path.read_text(encoding="utf-8")
    heads = re.findall(r"<th\b[^>]*>(.*?)</th>", html, re.S)
    cells = re.findall(r"<td\b[^>]*>(.*?)</td>", html, re.S)
    values = {unescape(h): unescape(re.sub(r"<[^>]+>", "", c)) for h, c in zip(heads, cells)}
    try:
        return float(values["Score"]), values.get("PA", values.get("IP"))
    except (KeyError, ValueError):
        return None


def matchup_rows(games, links):
    assets = DOCS / "assets" / "matchups"
    indexes = json.loads((assets / "matchups_index.json").read_bytes())
    hit_index = indexes["modes"]["hitter_vs_pitcher"]["fragments"][YEAR]
    hit_keys = {name_key(key): key for key in hit_index}
    roster = json.loads((assets / "rosters.json").read_bytes())["hitters_by_team"]
    scores = {"hitters": [], "pitchers": []}

    for game_number, game in enumerate(games):
        for i, side in enumerate(("Away", "Home")):
            team, opponent = (game["away"], game["home"]) if i == 0 else (game["home"], game["away"])
            starter, opposing_starter = game["pitchers"][i], game["pitchers"][1 - i]
            pitcher_file = DOCS / f"assets/matchups/fragments/{YEAR}/sp_vs_team/{starter.replace(' ', '_')}/{side}/{opponent}.html"
            pitcher_score = score_row(pitcher_file)
            if pitcher_score:
                score, sample = pitcher_score
                scores["pitchers"].append(dict(name=starter, team=team, opponent=opponent,
                    score=score, sample=sample, game=game_number, page=links.find(starter, team)))

            for hitter in roster.get(team, []):
                hitter_key = hit_keys.get(name_key(hitter))
                pitcher_paths = hit_index.get(hitter_key, {}).get(side, {})
                path = pitcher_paths.get(opposing_starter.replace(" ", "_"))
                if not path:
                    path = next((value for key, value in pitcher_paths.items()
                        if name_key(key) == name_key(opposing_starter)), None)
                if not path:
                    continue
                hitter_score = score_row(DOCS / f"assets/matchups/fragments/{YEAR}" / path)
                if hitter_score:
                    score, sample = hitter_score
                    scores["hitters"].append(dict(name=hitter, team=team, opponent=opponent,
                        score=score, sample=sample, game=game_number, page=links.find(hitter, team)))

    return {key: sorted(rows, key=lambda row: (-row["score"], row["name"]))[:5] for key, rows in scores.items()}


# ====================================================================
# PROSPECTS WITH EXISTING CARDS
# ====================================================================
CLUBS = dict(zip(
    ("Arizona Diamondbacks|Athletics|Atlanta Braves|Baltimore Orioles|Boston Red Sox|Chicago Cubs|Chicago White Sox|"
     "Cincinnati Reds|Cleveland Guardians|Colorado Rockies|Detroit Tigers|Houston Astros|Kansas City Royals|"
     "Los Angeles Angels|Los Angeles Dodgers|Miami Marlins|Milwaukee Brewers|Minnesota Twins|New York Mets|"
     "New York Yankees|Philadelphia Phillies|Pittsburgh Pirates|San Diego Padres|San Francisco Giants|"
     "Seattle Mariners|St. Louis Cardinals|Tampa Bay Rays|Texas Rangers|Toronto Blue Jays|Washington Nationals").split("|"),
    "ARI ATH ATL BAL BOS CHC CHW CIN CLE COL DET HOU KC LAA LAD MIA MIL MIN NYM NYY PHI PIT SD SF SEA STL TB TEX TOR WAS".split(),
))


def prospect_rows(filename, links, cutoff):
    source = BASEBALL / "data" / "other_data" / "extra_stats" / filename
    frame = pd.read_excel(source).fillna("")
    rows = []
    for record in frame.to_dict("records"):
        team = CLUBS.get(str(record["Team"]).strip())
        rank = str(record["Rk"]).strip()
        if not team or not rank.isdigit() or int(rank) > cutoff:
            continue
        name = str(record["Name"]).strip()
        eta = str(record["ETA"]).strip()
        rows.append(dict(rank=int(rank), name=name, team=team, position=record["Position"],
                         level=record["Level"], eta=eta, page=links.find(name, team, allow_previous_team=True)))
    return rows


def save(name, data):
    dest = DOCS / "assets" / "preview" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sidebar = SidebarLinks()
    sidebar.feed((DOCS / "index.html").read_text(encoding="utf-8"))
    games = json.loads((ROOT / "tools" / "today-slate.json").read_bytes())
    rankings = matchup_rows(games, sidebar)
    national = prospect_rows("top_100_prospects.ods", sidebar, 100)
    by_club = prospect_rows("team_prospects.ods", sidebar, 10)
    save("today.json", {"games": games, "rankings": rankings})
    save("prospects.json", {"national": [row for row in national if row["page"]], "organizations": by_club})
    print({name: len(rows) for name, rows in rankings.items()})
    print("Prospects:", sum(bool(row["page"]) for row in national), "national cards;",
          len(by_club), "organization rows in", len({row["team"] for row in by_club}), "organizations")