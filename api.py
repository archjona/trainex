from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs
from collections import defaultdict
from datetime import date, timedelta
import re
import time
import concurrent.futures
import secrets
import sqlite3
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*",
        "http://localhost:3000",
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

LOGIN_URL = "https://trex.phwt.de/phwt-trainex/start.cfm"
STUNDENPLAN_URL = "https://trex.phwt.de/phwt-trainex/cfm/einsatzplan/einsatzplan_stundenplan.cfm"

TAG_KURZ = {
    "Montag": "Mo", "Dienstag": "Di", "Mittwoch": "Mi",
    "Donnerstag": "Do", "Freitag": "Fr", "Samstag": "Sa", "Sonntag": "So"
}

TAG_INDEX = {"Mo": 0, "Di": 1, "Mi": 2, "Do": 3, "Fr": 4, "Sa": 5, "So": 6}

WOCHEN = []
start = date(2026, 4, 20)
for i in range(13):
    montag = start + timedelta(weeks=i)
    WOCHEN.append({
        "woche": 17 + i,
        "datum": montag.strftime("{ts '%Y-%m-%d 00:00:00'}"),
        "label": montag.strftime("%d.%m.%Y"),
    })

# --- Datenbank für Token ---
DB_PATH = os.path.join(os.path.dirname(__file__), "tokens.db")
TOKEN_TTL = 60 * 60 * 24 * 30   # 30 Tage

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS tokens (
            token TEXT PRIMARY KEY,
            login TEXT NOT NULL,
            passwort TEXT NOT NULL,
            ts REAL NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def save_token(token: str, login: str, passwort: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO tokens VALUES (?, ?, ?, ?)",
              (token, login, passwort, time.time()))
    conn.commit()
    conn.close()

def get_credentials(token: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT login, passwort, ts FROM tokens WHERE token = ?", (token,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="Ungültiger Token")
    login, passwort, ts = row
    if (time.time() - ts) > TOKEN_TTL:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM tokens WHERE token = ?", (token,))
        conn.commit()
        conn.close()
        raise HTTPException(status_code=401, detail="Token abgelaufen")
    return login, passwort

init_db()

# --- Session‑Cache (für PHWT‑Sitzung) ---
session_cache: dict = {}
stundenplan_cache: dict = {}

SESSION_TTL = 60 * 20            # 20 Minuten
STUNDENPLAN_TTL = 60 * 60        # 1 Stunde

class LoginData(BaseModel):
    token: str
    woche: int = 17

class LoginRequest(BaseModel):
    login: str
    passwort: str

class CacheData(BaseModel):
    token: str

def get_or_create_session(login: str, passwort: str):
    cached = session_cache.get(login)
    if cached and (time.time() - cached["ts"]) < SESSION_TTL:
        return cached

    sess = requests.Session()
    sess.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:148.0) Gecko/20100101 Firefox/148.0",
        "Referer": "https://trex.phwt.de/phwt-trainex/navigation/TraiNex",
    })

    try:
        login_response = sess.post(LOGIN_URL, data={
            "Login": login,
            "Passwort": passwort,
            "Domaene": "0",
            "einloggen": "Anmelden",
        }, timeout=30)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Verbindungsfehler: {str(e)}")

    params = parse_qs(urlparse(login_response.url).query)
    if "TokCF19" not in params:
        raise HTTPException(status_code=401, detail="Login fehlgeschlagen")

    tok = params["TokCF19"][0]
    idp = params["IDphp17"][0]
    sec = params["sec18m"][0]

    try:
        response_ohne_kid = sess.get(STUNDENPLAN_URL, params={
            "TokCF19": tok, "IDphp17": idp, "sec18m": sec,
            "area": "Kursraum", "subarea": "studienplan",
        }, timeout=30)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Fehler beim Abrufen: {str(e)}")

    kid_match = re.search(r"kid=(\d+)", response_ohne_kid.text)
    kid_sec_match = re.search(r"kid_sec_stud=(\d+)", response_ohne_kid.text)

    if not kid_match or not kid_sec_match:
        raise HTTPException(status_code=500, detail="kid konnte nicht gefunden werden")

    entry = {
        "session": sess,
        "tok": tok,
        "idp": idp,
        "sec": sec,
        "kid": kid_match.group(1),
        "kid_sec_stud": kid_sec_match.group(1),
        "ts": time.time(),
    }
    session_cache[login] = entry
    return entry

def parse_stundenplan(html: str, woche: int, label: str, woche_info: dict):
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    if len(tables) < 5:
        return None

    table = tables[4]
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
        if not tag_spalten:
            return "Mo"
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
                raum_text = link.get_text(separator=" ", strip=True)
                raum = re.sub(r'\s*\([^)]*\)', '', raum_text).strip()
                if not raum:
                    raum = raum_text
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

    wochenbeginn_str = woche_info["datum"].replace("{ts '", "").replace(" 00:00:00'}", "")
    wochenbeginn = date.fromisoformat(wochenbeginn_str)

    return {
        "woche": woche,
        "label": label,
        "tage": [
            {
                "tag": tag,
                "datum": (wochenbeginn + timedelta(days=TAG_INDEX[tag])).strftime("%d.%m."),
                "vorlesungen": sorted(nach_tag.get(tag, []), key=lambda x: x["zeit"])
            }
            for tag in tage_order
        ]
    }

def fetch_woche(sess_entry: dict, woche_info: dict):
    cache_key = f"{sess_entry['kid']}:{woche_info['woche']}"
    cached = stundenplan_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < STUNDENPLAN_TTL:
        return woche_info["woche"], cached["data"]

    try:
        response = sess_entry["session"].get(STUNDENPLAN_URL, params={
            "TokCF19": sess_entry["tok"],
            "IDphp17": sess_entry["idp"],
            "sec18m": sess_entry["sec"],
            "area": "Kursraum",
            "subarea": "studienplan",
            "anf_dat": woche_info["datum"],
            "kid_sec_stud": sess_entry["kid_sec_stud"],
            "kid": sess_entry["kid"],
        }, timeout=30)
    except Exception:
        return woche_info["woche"], None

    data = parse_stundenplan(response.text, woche_info["woche"], woche_info["label"], woche_info)
    if data:
        stundenplan_cache[cache_key] = {"data": data, "ts": time.time()}
    return woche_info["woche"], data

@app.post("/login")
def login(data: LoginRequest):
    get_or_create_session(data.login, data.passwort)
    token = secrets.token_urlsafe(32)
    save_token(token, data.login, data.passwort)
    return {"token": token}

@app.post("/stundenplan")
def get_stundenplan(data: LoginData):
    try:
        login, passwort = get_credentials(data.token)
        woche_info = next((w for w in WOCHEN if w["woche"] == data.woche), None)
        if not woche_info:
            raise HTTPException(status_code=400, detail="Ungültige Woche")

        sess_entry = get_or_create_session(login, passwort)
        cache_key = f"{sess_entry['kid']}:{data.woche}"
        cached = stundenplan_cache.get(cache_key)
        if cached and (time.time() - cached["ts"]) < STUNDENPLAN_TTL:
            return cached["data"]

        _, result = fetch_woche(sess_entry, woche_info)
        if not result:
            raise HTTPException(status_code=500, detail="Stundenplan konnte nicht geparst werden")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Interner Fehler: {str(e)}")

@app.post("/cache-leeren")
def cache_leeren(data: CacheData):
    login, _ = get_credentials(data.token)
    if login in session_cache:
        del session_cache[login]
    stundenplan_cache.clear()
    return {"status": "ok"}

@app.get("/wochen")
def get_wochen():
    heute = date.today()

    # Für die Wochenauswahl: Sonntag → nächste Woche anzeigen
    # "heute" selbst bleibt unverändert, damit die Heute-Markierung im Frontend korrekt bleibt
    anzeigedatum = heute + timedelta(days=1) if heute.weekday() == 6 else heute

    def parse_wochenbeginn(w):
        return date.fromisoformat(w["datum"].replace("{ts '", "").replace(" 00:00:00'}", ""))

    aktuelle_woche = None
    for w in WOCHEN:
        wochenbeginn = parse_wochenbeginn(w)
        wochenende = wochenbeginn + timedelta(days=6)
        if wochenbeginn <= anzeigedatum <= wochenende:
            aktuelle_woche = w["woche"]
            break

    # Fallback: vor dem Semester → erste Woche, nach dem Semester → letzte Woche
    if aktuelle_woche is None:
        if anzeigedatum < parse_wochenbeginn(WOCHEN[0]):
            aktuelle_woche = WOCHEN[0]["woche"]
        else:
            aktuelle_woche = WOCHEN[-1]["woche"]

    return {"wochen": WOCHEN, "aktuelle_woche": aktuelle_woche}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.options("/login")
async def options_login():
    return {"message": "OK"}

@app.options("/stundenplan")
async def options_stundenplan():
    return {"message": "OK"}

@app.options("/cache-leeren")
async def options_cache_leeren():
    return {"message": "OK"}
