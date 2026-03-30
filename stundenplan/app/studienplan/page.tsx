"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Cookies from "js-cookie";

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

// Environment Variable für API URL
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
  const [aktuelleWoche, setAktuelleWoche] = useState<number>(17);
  const [aktuelleWocheInfo, setAktuelleWocheInfo] = useState<Woche | null>(null);
  const [wochenLabel, setWochenLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wochenAuswahlOffen, setWochenAuswahlOffen] = useState(false);

  useEffect(() => {
    const login = Cookies.get("login");
    const passwort = Cookies.get("passwort");

    if (!login || !passwort) {
      router.push("/");
      return;
    }

    // Wochen abrufen
    fetch(`${API_URL}/wochen`)
      .then(res => res.json())
      .then(data => {
        setWochen(data);
        
        // Aktuelle Kalenderwoche basierend auf Datum bestimmen
        const heute = new Date();
        const aktuelleWocheInfo = data.find((w: Woche) => {
          const wochenStart = new Date(w.label.split(".").reverse().join("-"));
          const wochenEnde = new Date(wochenStart);
          wochenEnde.setDate(wochenEnde.getDate() + 6);
          return heute >= wochenStart && heute <= wochenEnde;
        });
        
        if (aktuelleWocheInfo) {
          setAktuelleWocheInfo(aktuelleWocheInfo);
          setAktuelleWoche(aktuelleWocheInfo.woche);
        }
      })
      .catch((err) => {
        console.error("Konnte Wochen nicht laden:", err);
        setError("Wochen konnten nicht geladen werden.");
      });

    stundenplanLaden(login, passwort, 17);
  }, [router]);

  function istHeute(tagKurz: string): boolean {
    // Nur wenn wir wissen, welche Woche aktuell ist
    if (!aktuelleWocheInfo) return false;
    
    // Prüfen, ob die angezeigte Woche die aktuelle Kalenderwoche ist
    if (aktuelleWoche !== aktuelleWocheInfo.woche) return false;
    
    // Prüfen, ob der Wochentag mit dem heutigen Datum übereinstimmt
    const heute = new Date();
    const heutigerWochentag = heute.getDay(); // 0 = Sonntag, 1 = Montag, ...
    const tagIndex = TAG_ZU_INDEX[tagKurz];
    
    return tagIndex === heutigerWochentag;
  }

  function stundenplanLaden(login: string, passwort: string, woche: number) {
    setLoading(true);
    setError("");
    
    fetch(`${API_URL}/stundenplan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, passwort, woche }),
    })
      .then(res => {
        if (!res.ok) throw new Error("Fehler beim Laden");
        return res.json();
      })
      .then((data: StundenplanResponse) => {
        setStudienplan(data.tage);
        setAktuelleWoche(data.woche);
        setWochenLabel(data.label);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Fehler beim Laden des Stundenplans:", err);
        setError("Studienplan konnte nicht geladen werden.");
        setLoading(false);
      });
  }

  function handleWochenWechsel(woche: number) {
    const login = Cookies.get("login");
    const passwort = Cookies.get("passwort");
    if (login && passwort) {
      stundenplanLaden(login, passwort, woche);
      setWochenAuswahlOffen(false);
    }
  }

  function handleLogout() {
    Cookies.remove("login");
    Cookies.remove("passwort");
    router.push("/");
  }

  function getWochenText(): string {
    if (aktuelleWoche === 17 && wochenLabel) {
      return `Woche ${aktuelleWoche} (${wochenLabel})`;
    }
    const wocheInfo = wochen.find(w => w.woche === aktuelleWoche);
    if (wocheInfo) {
      return `Woche ${aktuelleWoche} (${wocheInfo.label})`;
    }
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
      <div className="max-w-4xl mx-auto px-4 py-8">

        <div className="flex items-center justify-between mb-8">
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Studienplan</h1>
            <div className="relative mt-2">
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
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white border border-white/10 px-4 py-2 rounded-xl transition"
          >
            Abmelden
          </button>
        </div>

        <div className="space-y-4">
          {studienplan.map(({ tag, vorlesungen }) => {
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
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <p className="font-medium text-white">{v.fach}</p>
                            <p className="text-sm text-gray-400 mt-1">{v.dozent}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm text-gray-300">{v.zeit}</p>
                            <p className="text-xs text-gray-500 mt-1">{v.raum}</p>
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
      </div>
    </main>
  );
}
