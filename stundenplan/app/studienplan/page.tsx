"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Vorlesung {
  tag: string;
  zeit: string;
  fach: string;
  typ: string;
  dozent: string;
  raum: string;
}

interface Tag {
  tag: string;
  datum: string;
  vorlesungen: Vorlesung[];
}

interface Woche {
  woche: number;
  label: string;
  datum: string;
}

interface StundenplanResponse {
  woche: number;
  label: string;
  tage: Tag[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TAG_NAMEN: Record<string, string> = {
  Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch",
  Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag"
};

const TAG_ZU_INDEX: Record<string, number> = {
  Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6, So: 0
};

const TYP_FARBEN: Record<string, string> = {
  "Vorlesung": "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Online": "bg-purple-500/20 text-purple-300 border-purple-500/30",
  "Übung": "bg-green-500/20 text-green-300 border-green-500/30",
  "Labor": "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

export default function StudienplanPage() {
  const router = useRouter();
  const [studienplan, setStudienplan] = useState<Tag[]>([]);
  const [wochen, setWochen] = useState<Woche[]>([]);
  const [aktuelleWoche, setAktuelleWoche] = useState<number | null>(null);
  const [aktuelleWocheInfo, setAktuelleWocheInfo] = useState<Woche | null>(null);
  const [wochenLabel, setWochenLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState("");
  const [wochenAuswahlOffen, setWochenAuswahlOffen] = useState(false);

  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    setToken(storedToken);
    if (!storedToken) {
      router.push("/");
      return;
    }
  }, [router]);

  useEffect(() => {
    if (!token) return;

    fetch(`${API_URL}/wochen`)
      .then(res => res.json())
      .then(data => {
        const wochenListe: Woche[] = data.wochen;
        const startwoche: number = data.aktuelle_woche;
        setWochen(wochenListe);
        const wocheInfo = wochenListe.find(w => w.woche === startwoche) || null;
        setAktuelleWocheInfo(wocheInfo);
        stundenplanLaden(startwoche);
      })
      .catch(() => setError("Wochen konnten nicht geladen werden."));
  }, [token]);

  function istHeute(tagKurz: string): boolean {
    if (!aktuelleWocheInfo) return false;
    if (aktuelleWoche !== aktuelleWocheInfo.woche) return false;
    const heute = new Date();
    const heutigerWochentag = heute.getDay();
    const tagIndex = TAG_ZU_INDEX[tagKurz];
    return tagIndex === heutigerWochentag;
  }

  function stundenplanLaden(woche: number) {
    if (!token) return;
    setLoading(true);
    setError("");

    fetch(`${API_URL}/stundenplan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, woche }),
    })
      .then(async res => {
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem("token");
            router.push("/");
            throw new Error("Session abgelaufen");
          }
          throw new Error("Fehler beim Laden");
        }
        return res.json();
      })
      .then((data: StundenplanResponse) => {
        setStudienplan(data.tage);
        setAktuelleWoche(data.woche);
        setWochenLabel(data.label);
        setLoading(false);
      })
      .catch(err => {
        if (err.message !== "Session abgelaufen") {
          setError("Studienplan konnte nicht geladen werden.");
        }
        setLoading(false);
      });
  }

  async function handleReload() {
    if (!token || aktuelleWoche === null) return;
    setReloading(true);
    try {
      await fetch(`${API_URL}/cache-leeren`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      // trotzdem neu laden
    }
    stundenplanLaden(aktuelleWoche);
    setReloading(false);
  }

  function handleWochenWechsel(woche: number) {
    if (!token) return;
    stundenplanLaden(woche);
    setWochenAuswahlOffen(false);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    router.push("/");
  }

  function getWochenText(): string {
    const wocheInfo = wochen.find(w => w.woche === aktuelleWoche);
    if (wocheInfo) return `Woche ${aktuelleWoche} (${wocheInfo.label})`;
    if (wochenLabel) return `Woche ${aktuelleWoche} (${wochenLabel})`;
    return `Woche ${aktuelleWoche}`;
  }

  if (loading) return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="text-gray-400 text-lg">Studienplan wird geladen...</div>
    </main>
  );

  if (error) return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="text-red-400">{error}</div>
    </main>
  );

  return (
    <main className="min-h-screen bg-[#0f1117] text-white">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-[#0f1117]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-start gap-4">
          {/* Linke Seite: Titel + Wochenauswahl */}
          <div className="flex-1">
            <h1 className="text-xl font-bold">Studienplan</h1>
            <div className="relative mt-1">
              <button
                onClick={() => setWochenAuswahlOffen(!wochenAuswahlOffen)}
                className="text-sm text-gray-400 hover:text-white border border-white/10 px-3 py-1.5 rounded-xl transition flex items-center gap-2 bg-[#1a1d27]"
              >
                <span>{getWochenText()}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {wochenAuswahlOffen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setWochenAuswahlOffen(false)}
                  />
                  <div className="absolute top-full left-0 mt-2 w-64 bg-[#1a1d27] border border-white/10 rounded-xl shadow-xl z-20 max-h-96 overflow-y-auto">
                    <div className="p-2">
                      {wochen.map((woche) => (
                        <button
                          key={woche.woche}
                          onClick={() => handleWochenWechsel(woche.woche)}
                          className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${
                            aktuelleWoche === woche.woche
                              ? "bg-blue-500/20 text-blue-300"
                              : "text-gray-400 hover:bg-white/5 hover:text-white"
                          }`}
                        >
                          Woche {woche.woche} ({woche.label})
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Rechte Seite: Buttons vertikal gestapelt */}
          <div className="flex flex-col gap-2 items-end shrink-0">
            <button
              onClick={handleReload}
              disabled={reloading}
              className="flex items-center gap-2 text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition disabled:opacity-50"
            >
              <svg
                className={`w-4 h-4 ${reloading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {reloading ? "Lädt..." : "Aktualisieren"}
            </button>

            <button
              onClick={handleLogout}
              className="text-sm text-gray-400 hover:text-white border border-white/10 px-4 py-2 rounded-xl transition"
            >
              Abmelden
            </button>
          </div>
        </div>
      </div>

      {/* Inhalt */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {studienplan.map(({ tag, datum, vorlesungen }) => {
          const istHeuteTag = istHeute(tag);
          return (
            <div
              key={tag}
              className={`rounded-2xl border transition ${
                istHeuteTag
                  ? "border-blue-500/50 bg-blue-500/5"
                  : "border-white/10 bg-[#1a1d27]"
              }`}
            >
              <div className="px-5 py-4 flex items-center gap-3">
                <span className={`text-sm font-semibold ${istHeuteTag ? "text-blue-400" : "text-gray-400"}`}>
                  {TAG_NAMEN[tag]}
                </span>
                <span className="text-sm text-gray-600">{datum}</span>
                {istHeuteTag && (
                  <span className="text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full">
                    Heute
                  </span>
                )}
              </div>

              {vorlesungen.length === 0 ? (
                <div className="px-5 pb-4 text-gray-600 text-sm">Frei</div>
              ) : (
                <div className="px-5 pb-4 space-y-3">
                  {vorlesungen.map((v, i) => (
                    <div key={i} className="bg-[#0f1117] rounded-xl p-4 border border-white/5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white break-words">{v.fach}</p>
                          <p className="text-sm text-gray-400 mt-1 break-words">{v.dozent}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm text-gray-300 whitespace-nowrap">{v.zeit}</p>
                          <p className="text-xs text-gray-500 mt-1 whitespace-nowrap">{v.raum}</p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${TYP_FARBEN[v.typ] || TYP_FARBEN["Vorlesung"]}`}>
                          {v.typ}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
