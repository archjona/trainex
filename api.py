from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs
from collections import defaultdict
from datetime import date, timedelta
import re

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOGIN_URL = "https://trex.phwt.de/phwt-trainex/start.cfm"
STUNDENPLAN_URL = "https://trex.phwt.de/phwt-trainex/cfm/einsatzplan/einsatzplan_stundenplan.cfm"

TAG_KURZ = {
    "Montag": "Mo", "Dienstag": "Di", "Mittwoch": "Mi",
    "Donnerstag": "Do", "Freitag": "Fr", "Samstag": "Sa", "Sonntag": "So"
}

# Wochen von 17 (20. April) bis 29 (19. Juli)
WOCHEN = []
start = date(2026, 4, 20)
for i in range(13):  # 13 weeks to go from week 17 to week 29
    montag = start + timedelta(weeks=i)
    WOCHEN.append({
        "woche": 17 + i,
        "datum": montag.strftime("{ts '%Y-%m-%d 00:00:00'}"),
        "label": montag.strftime("%d.%m.%Y"),
    })

class LoginData(BaseModel):
    login: str
    passwort: str
    woche: int = 17

def scrape_stundenplan(login: str, passwort: str, woche: int):
    woche_info = next((w for w in WOCHEN if w["woche"] == woche), None)
    if not woche_info:
        raise HTTPException(status_code=400, detail="Ungültige Woche")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0",
        "Referer": "https://trex.phwt.de/phwt-trainex/navigation/TraiNex",
    })

    login_response = session.post(LOGIN_URL, data={
        "Login": login,
        "Passwort": passwort,
        "Domaene": "0",
        "einloggen": "Anmelden",
    })

    params = parse_qs(urlparse(login_response.url).query)
    if "TokCF19" not in params:
        raise HTTPException(status_code=401, detail="Login fehlgeschlagen")

    tok = params["TokCF19"][0]
    idp = params["IDphp17"][0]
    sec = params["sec18m"][0]

    response = session.get(STUNDENPLAN_URL, params={
        "TokCF19": tok, "IDphp17": idp, "sec18m": sec,
        "area": "Kursraum", "subarea": "studienplan",
        "anf_dat": woche_info["datum"],
        "kid_sec_stud": "21672750",
        "kid": "222",
    })

    soup = BeautifulSoup(response.text, "html.parser")
    table = soup.find_all("table")[4]

    tag_spalten = {}
    for row in table.find_all("tr"):
        cells = row.find_all("td", colspan="12")
        tage_in_row = [c for c in cells if re.match(r"(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)", c.get_text(strip=True))]
        if len(tage_in_row) >= 5:
            col = 0
            for cell in row.find_all("td"):
                text = cell.get_text(strip=True)
                cs = int(cell.get("colspan", 1))
                for name, kurz in TAG_KURZ.items():
                    if text.startswith(name):
                        tag_spalten[col] = kurz
                        break
                col += cs
            break

    def get_col_position(cell):
        row = cell.parent
        col = 0
        for c in row.find_all("td"):
            if c == cell:
                return col
            col += int(c.get("colspan", 1))
        return 0

    def get_tag(cell):
        col_pos = get_col_position(cell)
        spalten = sorted(tag_spalten.keys())
        for i, sp in enumerate(spalten):
            next_sp = spalten[i + 1] if i + 1 < len(spalten) else sp + 12
            mitte = sp + (next_sp - sp) / 2
            if col_pos < mitte:
                return tag_spalten[sp]
        return tag_spalten[spalten[-1]]

    def parse_cell(cell):
        font = cell.find("font")
        if not font:
            return None
        text = cell.get_text(strip=True)
        zeit_match = re.match(r"(\d{2}:\d{2} - \d{2}:\d{2})", text)
        if not zeit_match:
            return None
        zeit = zeit_match.group(1)
        fach_tag = font.find("b")
        fach = fach_tag.get_text(strip=True) if fach_tag else "?"
        typ_match = re.search(r"\(([^)]+)\)", text)
        typ = typ_match.group(1) if typ_match else "Online"
        dozent = "?"
        raum = "?"
        for link in font.find_all("a"):
            onclick = link.get("onclick", "")
            if "adress_bild" in onclick:
                dozent = link.get_text(strip=True)
            elif "ressourcen_beschreibung" in onclick:
                raum = link.get_text(separator=" ", strip=True)
        return {
            "tag": get_tag(cell),
            "zeit": zeit,
            "fach": fach,
            "typ": typ,
            "dozent": dozent,
            "raum": raum,
        }

    vorlesungen = []
    seen = set()
    for cell in table.find_all("td", rowspan=True):
        if cell.get("colspan") != "12":
            continue
        text = cell.get_text(strip=True)
        if not re.match(r"\d{2}:\d{2}", text):
            continue
        if text in seen:
            continue
        seen.add(text)
        v = parse_cell(cell)
        if v:
            vorlesungen.append(v)

    tage_order = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    nach_tag = defaultdict(list)
    for v in vorlesungen:
        nach_tag[v["tag"]].append(v)

    return {
        "woche": woche,
        "label": woche_info["label"],
        "tage": [
            {
                "tag": tag,
                "vorlesungen": sorted(nach_tag.get(tag, []), key=lambda x: x["zeit"])
            }
            for tag in tage_order
        ]
    }

@app.post("/stundenplan")
def get_stundenplan(data: LoginData):
    return scrape_stundenplan(data.login, data.passwort, data.woche)

@app.get("/wochen")
def get_wochen():
    return WOCHEN

@app.get("/health")
def health():
    return {"status": "ok"}
