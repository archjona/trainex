"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [passwort, setPasswort] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Prüfen, ob bereits ein Token im localStorage existiert
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      router.push("/studienplan");
    }
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, passwort }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("token", data.token);  // Token speichern
        router.push("/studienplan");
      } else {
        setError("Login fehlgeschlagen. Bitte überprüfe deine Zugangsdaten.");
      }
    } catch {
      setError("Server nicht erreichbar.");
    }

    setLoading(false);
  }

  return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">PHWT Studienplan</h1>
          <p className="text-gray-400">Melde dich mit deinen TraiNex-Daten an</p>
        </div>

        <form onSubmit={handleLogin} className="bg-[#1a1d27] rounded-2xl p-8 shadow-xl border border-white/10">
          <div className="mb-5">
            <label className="block text-sm text-gray-400 mb-2">Login</label>
            <input
              type="text"
              value={login}
              onChange={e => setLogin(e.target.value)}
              className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition"
              placeholder="vorname.nachname"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">Passwort</label>
            <input
              type="password"
              value={passwort}
              onChange={e => setPasswort(e.target.value)}
              className="w-full bg-[#0f1117] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition disabled:opacity-50"
          >
            {loading ? "Laden..." : "Anmelden"}
          </button>
        </form>
      </div>
    </main>
  );
}
