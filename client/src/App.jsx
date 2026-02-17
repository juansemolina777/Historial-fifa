
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Analytics } from "@vercel/analytics/react";
import "./App.css";

const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const TOKEN_KEY = "historial_fifa_token";
const DRAW_MANUAL_TEAMS_KEY = "historial_fifa_draw_manual_teams";
const THEME_KEY = "historial_fifa_theme";

function getInitialTheme() {
  if (typeof window === "undefined") return "light";

  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;

  if (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
    return "dark";
  }

  return "light";
}

function todayValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleDateString("es-AR");
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function profileFromUser(user) {
  return {
    name: user?.name || "",
    email: user?.email || "",
    bio: user?.bio || "",
    avatarUrl: user?.avatarUrl || "",
    currentPassword: "",
    newPassword: "",
  };
}

function messageOf(error, fallback) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseManualTeamNames(rawValue) {
  const chunks = String(rawValue || "")
    .split(/[\n,;]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return Array.from(new Set(chunks));
}

function shuffleArray(items) {
  const cloned = [...items];
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [cloned[index], cloned[randomIndex]] = [cloned[randomIndex], cloned[index]];
  }
  return cloned;
}

function buildWorldTeamsCatalog() {
  const fallback = [
    "Argentina",
    "Brasil",
    "Uruguay",
    "Colombia",
    "Chile",
    "Paraguay",
    "Estados Unidos",
    "Mexico",
    "Espana",
    "Francia",
    "Alemania",
    "Italia",
    "Portugal",
    "Inglaterra",
    "Paises Bajos",
    "Belgica",
    "Croacia",
    "Marruecos",
    "Japon",
    "Corea del Sur",
  ];

  try {
    if (
      typeof Intl === "undefined" ||
      typeof Intl.DisplayNames !== "function" ||
      typeof Intl.supportedValuesOf !== "function"
    ) {
      return fallback;
    }

    const displayNames = new Intl.DisplayNames(["es-AR", "es"], { type: "region" });
    const names = Intl.supportedValuesOf("region")
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => displayNames.of(code))
      .filter((name) => typeof name === "string" && name.length > 1)
      .map((name) => name.trim());

    const uniqueSorted = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "es"));
    return uniqueSorted.length > 0 ? uniqueSorted : fallback;
  } catch {
    return fallback;
  }
}

async function fetchCountrySoccerTeams(countryName) {
  const endpoint = `https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?s=Soccer&c=${encodeURIComponent(countryName)}`;
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });

  if (!response.ok) {
    throw new Error(`No pude cargar equipos de ${countryName}`);
  }

  const data = await response.json();
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  return teams
    .map((entry) => String(entry?.strTeam || "").trim())
    .filter((team) => team.length > 0);
}

function buildDrawTeams(players, teamNames) {
  const teams = teamNames.map((name) => ({
    name,
    players: [],
  }));

  players.forEach((player, index) => {
    teams[index % teams.length].players.push(player);
  });

  return teams.filter((team) => team.players.length > 0);
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("DASHBOARD");
  const [notice, setNotice] = useState(null);
  const [themeMode, setThemeMode] = useState(getInitialTheme);

  const [authMode, setAuthMode] = useState("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });

  const [users, setUsers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [friendlies, setFriendlies] = useState([]);
  const [friends, setFriends] = useState([]);
  const [friendMatches, setFriendMatches] = useState([]);
  const [friendMatchFilter, setFriendMatchFilter] = useState("ALL");
  const [overview, setOverview] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [friendForm, setFriendForm] = useState({ email: "" });
  const [friendBusy, setFriendBusy] = useState(false);

  const [matchBusy, setMatchBusy] = useState(false);
  const [matchType, setMatchType] = useState("AMISTOSO");
  const [matchTournamentId, setMatchTournamentId] = useState("");
  const [matchParticipants, setMatchParticipants] = useState([]);
  const [matchHistory, setMatchHistory] = useState([]);
  const [matchStandings, setMatchStandings] = useState([]);
  const [matchForm, setMatchForm] = useState({
    playerAId: "",
    playerBId: "",
    scoreA: 0,
    scoreB: 0,
    playedAt: todayValue(),
  });

  const [quickPlayer, setQuickPlayer] = useState({ name: "", email: "" });
  const [quickPlayerBusy, setQuickPlayerBusy] = useState(false);
  const [newTournament, setNewTournament] = useState({ name: "", year: new Date().getFullYear() });
  const [newTournamentBusy, setNewTournamentBusy] = useState(false);

  const [adminTournamentId, setAdminTournamentId] = useState("");
  const [adminUserId, setAdminUserId] = useState("");
  const [adminParticipants, setAdminParticipants] = useState([]);
  const [adminMatches, setAdminMatches] = useState([]);
  const [adminStandings, setAdminStandings] = useState([]);

  const [h2h, setH2h] = useState({ player1Id: "", player2Id: "", loading: false, data: null });
  const [profile, setProfile] = useState(profileFromUser(null));
  const [profileBusy, setProfileBusy] = useState(false);
  const [drawSource, setDrawSource] = useState("ALL");
  const [drawTournamentId, setDrawTournamentId] = useState("");
  const [drawTeamCount, setDrawTeamCount] = useState(2);
  const [drawPool, setDrawPool] = useState([]);
  const [drawSelectedParticipantIds, setDrawSelectedParticipantIds] = useState([]);
  const [drawSelectedWorldTeams, setDrawSelectedWorldTeams] = useState([]);
  const [drawTeamSearch, setDrawTeamSearch] = useState("");
  const [drawManualTeamsText, setDrawManualTeamsText] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(DRAW_MANUAL_TEAMS_KEY) || "";
  });
  const [drawCountryTeams, setDrawCountryTeams] = useState([]);
  const [drawCountryTeamsBusy, setDrawCountryTeamsBusy] = useState(false);
  const [drawCountryTeamsSignature, setDrawCountryTeamsSignature] = useState("");
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawResult, setDrawResult] = useState(null);

  const notify = useCallback((type, text) => setNotice({ type, text }), []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setFriends([]);
    setFriendMatches([]);
    setFriendMatchFilter("ALL");
    setFriendForm({ email: "" });
    setTab("DASHBOARD");
  }, []);

  const onError = useCallback((error, fallback) => {
    if (error?.status === 401) {
      clearSession();
      notify("error", "Sesion vencida. Inicia sesion de nuevo.");
      return;
    }
    notify("error", messageOf(error, fallback));
  }, [clearSession, notify]);

  const loadCore = useCallback(async (authToken = token) => {
    const [u, t, f, o, l, fr, fm] = await Promise.all([
      api("/users", { token: authToken }),
      api("/tournaments", { token: authToken }),
      api("/friendlies", { token: authToken }),
      api("/stats/overview", { token: authToken }),
      api("/stats/leaderboard?limit=12", { token: authToken }),
      api("/friends", { token: authToken }),
      api("/friends/matches?limit=150", { token: authToken }),
    ]);
    setUsers(Array.isArray(u) ? u : []);
    setTournaments(Array.isArray(t) ? t : []);
    setFriendlies(Array.isArray(f) ? f : []);
    setOverview(o || null);
    setLeaderboard(Array.isArray(l?.leaderboard) ? l.leaderboard : []);
    setFriends(Array.isArray(fr) ? fr : []);
    setFriendMatches(Array.isArray(fm) ? fm : []);
  }, [token]);

  const loadTournamentPack = useCallback(async (tournamentId, mode = "match") => {
    const [participants, matches, standings] = await Promise.all([
      api(`/tournaments/${tournamentId}/participants`, { token }),
      api(`/tournaments/${tournamentId}/matches`, { token }),
      api(`/tournaments/${tournamentId}/standings`, { token }),
    ]);

    const safeParticipants = Array.isArray(participants) ? participants : [];
    const safeMatches = Array.isArray(matches) ? matches : [];
    const safeStandings = Array.isArray(standings?.standings) ? standings.standings : [];

    if (mode === "admin") {
      setAdminParticipants(safeParticipants);
      setAdminMatches(safeMatches);
      setAdminStandings(safeStandings);
      return;
    }

    setMatchParticipants(safeParticipants);
    setMatchHistory(safeMatches);
    setMatchStandings(safeStandings);
  }, [token]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    document.body.dataset.theme = themeMode;
    localStorage.setItem(THEME_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!token) return;
      try {
        const me = await api("/auth/me", { token });
        if (cancelled) return;
        if (!me?.user) {
          clearSession();
          return;
        }
        setUser(me.user);
        setProfile(profileFromUser(me.user));
        await loadCore(token);
      } catch (error) {
        if (cancelled) return;
        clearSession();
        notify("error", messageOf(error, "No pude restaurar tu sesion"));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [token, clearSession, loadCore, notify]);

  useEffect(() => {
    if (matchType === "AMISTOSO") {
      setMatchParticipants([]);
      setMatchHistory(friendlies);
      setMatchStandings([]);
      return;
    }

    if (!matchTournamentId) {
      setMatchParticipants([]);
      setMatchHistory([]);
      setMatchStandings([]);
      return;
    }

    void loadTournamentPack(matchTournamentId, "match").catch((error) => {
      onError(error, "No pude cargar datos del torneo para partidos");
    });
  }, [matchType, matchTournamentId, friendlies, loadTournamentPack, onError]);

  useEffect(() => {
    if (!adminTournamentId) {
      setAdminParticipants([]);
      setAdminMatches([]);
      setAdminStandings([]);
      return;
    }

    void loadTournamentPack(adminTournamentId, "admin").catch((error) => {
      onError(error, "No pude cargar el panel admin");
    });
  }, [adminTournamentId, loadTournamentPack, onError]);

  useEffect(() => {
    let cancelled = false;

    async function refreshDrawPool() {
      if (!token) {
        setDrawPool([]);
        setDrawBusy(false);
        return;
      }

      if (drawSource === "ALL") {
        setDrawPool(Array.isArray(users) ? users : []);
        setDrawBusy(false);
        return;
      }

      if (!drawTournamentId) {
        setDrawPool([]);
        setDrawBusy(false);
        return;
      }

      setDrawBusy(true);
      try {
        const participants = await api(`/tournaments/${drawTournamentId}/participants`, { token });
        if (cancelled) return;
        setDrawPool(Array.isArray(participants) ? participants : []);
      } catch (error) {
        if (cancelled) return;
        onError(error, "No pude cargar participantes para el sorteo");
      } finally {
        if (!cancelled) setDrawBusy(false);
      }
    }

    void refreshDrawPool();
    return () => {
      cancelled = true;
    };
  }, [drawSource, drawTournamentId, token, users, onError]);

  useEffect(() => {
    setDrawSelectedParticipantIds(drawPool.map((entry) => entry.id));
  }, [drawPool]);

  useEffect(() => {
    if (friendMatchFilter === "ALL") return;
    if (friends.some((entry) => entry.id === friendMatchFilter)) return;
    setFriendMatchFilter("ALL");
  }, [friends, friendMatchFilter]);

  const selectedCountriesSignature = useMemo(
    () => [...drawSelectedWorldTeams].sort((a, b) => a.localeCompare(b, "es")).join("|"),
    [drawSelectedWorldTeams]
  );

  useEffect(() => {
    setDrawCountryTeams([]);
    setDrawCountryTeamsSignature("");
  }, [selectedCountriesSignature]);

  useEffect(() => {
    setDrawResult(null);
  }, [drawSource, drawTournamentId, drawTeamCount, drawSelectedParticipantIds, drawSelectedWorldTeams, drawCountryTeams, drawManualTeamsText]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (drawManualTeamsText.trim()) {
      localStorage.setItem(DRAW_MANUAL_TEAMS_KEY, drawManualTeamsText);
      return;
    }
    localStorage.removeItem(DRAW_MANUAL_TEAMS_KEY);
  }, [drawManualTeamsText]);

  const worldTeamsCatalog = useMemo(() => buildWorldTeamsCatalog(), []);

  const filteredWorldTeams = useMemo(() => {
    const normalizedQuery = normalizeText(drawTeamSearch);
    if (!normalizedQuery) return worldTeamsCatalog;

    return worldTeamsCatalog.filter((team) => normalizeText(team).includes(normalizedQuery));
  }, [drawTeamSearch, worldTeamsCatalog]);

  const selectedParticipants = useMemo(() => {
    if (!drawSelectedParticipantIds.length) return [];
    const selectedIdSet = new Set(drawSelectedParticipantIds);
    return drawPool.filter((entry) => selectedIdSet.has(entry.id));
  }, [drawPool, drawSelectedParticipantIds]);

  const manualTeamNames = useMemo(
    () => parseManualTeamNames(drawManualTeamsText),
    [drawManualTeamsText]
  );

  const drawNeedsCountryTeamLoad = useMemo(
    () =>
      manualTeamNames.length === 0 &&
      drawSelectedWorldTeams.length > 0 &&
      (drawCountryTeams.length === 0 || drawCountryTeamsSignature !== selectedCountriesSignature),
    [manualTeamNames, drawSelectedWorldTeams, drawCountryTeams, drawCountryTeamsSignature, selectedCountriesSignature]
  );

  const chartData = useMemo(() => leaderboard.slice(0, 8).map((row) => ({
    name: row.name,
    victorias: row.wins,
    puntos: row.pts,
    goles: row.goalsFor,
  })), [leaderboard]);

  const visibleFriendMatches = useMemo(() => {
    if (friendMatchFilter === "ALL") return friendMatches;
    return friendMatches.filter((match) => {
      const playerAId = match?.playerA?.id || match?.playerAId;
      const playerBId = match?.playerB?.id || match?.playerBId;
      return playerAId === friendMatchFilter || playerBId === friendMatchFilter;
    });
  }, [friendMatches, friendMatchFilter]);

  const playerOptions = useMemo(() => matchType === "TORNEO" ? matchParticipants : users, [matchType, matchParticipants, users]);

  async function submitAuth(event) {
    event.preventDefault();
    if (authBusy) return;

    setAuthBusy(true);
    try {
      const email = authForm.email.trim();
      const password = authForm.password;

      if (!email || !password) {
        notify("error", "Completa email y password");
        return;
      }

      let response;

      if (authMode === "register") {
        const name = authForm.name.trim();
        if (name.length < 2) {
          notify("error", "Nombre invalido");
          return;
        }
        response = await api("/auth/register", { method: "POST", body: { name, email, password } });
      } else {
        response = await api("/auth/login", { method: "POST", body: { email, password } });
      }

      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      setProfile(profileFromUser(response.user));
      setAuthForm({ name: "", email: "", password: "" });
      await loadCore(response.token);
      notify("success", authMode === "register" ? "Cuenta creada" : "Sesion iniciada");
    } catch (error) {
      onError(error, "No pude autenticarte");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitMatch(event) {
    event.preventDefault();

    const payload = {
      type: matchType,
      playerAId: matchForm.playerAId,
      playerBId: matchForm.playerBId,
      scoreA: Number(matchForm.scoreA),
      scoreB: Number(matchForm.scoreB),
      playedAt: matchForm.playedAt,
    };

    if (matchType === "TORNEO") payload.tournamentId = matchTournamentId;

    if (!payload.playerAId || !payload.playerBId) return notify("error", "Faltan jugadores");
    if (payload.playerAId === payload.playerBId) return notify("error", "Jugadores repetidos");
    if (matchType === "TORNEO" && !matchTournamentId) return notify("error", "Selecciona torneo");

    setMatchBusy(true);
    try {
      await api("/matches", { method: "POST", token, body: payload });
      await loadCore();

      if (matchType === "TORNEO" && matchTournamentId) {
        await loadTournamentPack(matchTournamentId, "match");
        if (adminTournamentId === matchTournamentId) {
          await loadTournamentPack(adminTournamentId, "admin");
        }
      }

      setMatchForm((prev) => ({ ...prev, playerAId: "", playerBId: "", scoreA: 0, scoreB: 0 }));
      notify("success", "Partido guardado");
    } catch (error) {
      onError(error, "No pude guardar el partido");
    } finally {
      setMatchBusy(false);
    }
  }

  async function deleteMatch(matchId, tournamentId = null) {
    if (!window.confirm("Eliminar este partido?")) return;

    try {
      await api(`/matches/${matchId}`, { method: "DELETE", token });
      await loadCore();
      if (matchType === "TORNEO" && matchTournamentId) await loadTournamentPack(matchTournamentId, "match");
      if (adminTournamentId && (!tournamentId || tournamentId === adminTournamentId)) {
        await loadTournamentPack(adminTournamentId, "admin");
      }
      notify("success", "Partido eliminado");
    } catch (error) {
      onError(error, "No pude eliminar el partido");
    }
  }

  async function createTournament(event) {
    event.preventDefault();
    const name = newTournament.name.trim();
    const year = Number(newTournament.year);
    if (name.length < 2) return notify("error", "Nombre invalido");
    if (!Number.isInteger(year)) return notify("error", "Anio invalido");

    setNewTournamentBusy(true);
    try {
      await api("/tournaments", { method: "POST", token, body: { name, year } });
      await loadCore();
      setNewTournament({ name: "", year: new Date().getFullYear() });
      notify("success", "Torneo creado");
    } catch (error) {
      onError(error, "No pude crear torneo");
    } finally {
      setNewTournamentBusy(false);
    }
  }

  async function createQuickPlayer(event) {
    event.preventDefault();
    const name = quickPlayer.name.trim();
    if (name.length < 2) return notify("error", "Nombre invalido");

    setQuickPlayerBusy(true);
    try {
      await api("/users", { method: "POST", token, body: { name, email: quickPlayer.email.trim() || undefined } });
      await loadCore();
      setQuickPlayer({ name: "", email: "" });
      notify("success", "Jugador creado");
    } catch (error) {
      onError(error, "No pude crear jugador");
    } finally {
      setQuickPlayerBusy(false);
    }
  }

  async function addFriend(event) {
    event.preventDefault();
    if (friendBusy) return;

    const email = friendForm.email.trim();
    if (!email) return notify("error", "Ingresa un email");

    setFriendBusy(true);
    try {
      await api("/friends", { method: "POST", token, body: { email } });
      setFriendForm({ email: "" });
      await loadCore();
      notify("success", "Amigo agregado");
    } catch (error) {
      onError(error, "No pude agregar ese amigo");
    } finally {
      setFriendBusy(false);
    }
  }

  async function removeFriend(friendId) {
    if (friendBusy) return;
    if (!window.confirm("Quitar este amigo?")) return;

    setFriendBusy(true);
    try {
      await api(`/friends/${friendId}`, { method: "DELETE", token });
      await loadCore();
      notify("success", "Amigo eliminado");
    } catch (error) {
      onError(error, "No pude eliminar ese amigo");
    } finally {
      setFriendBusy(false);
    }
  }

  async function addParticipant() {
    if (!adminTournamentId || !adminUserId) return notify("error", "Selecciona torneo y jugador");
    try {
      await api(`/tournaments/${adminTournamentId}/participants`, { method: "POST", token, body: { userId: adminUserId } });
      setAdminUserId("");
      await loadTournamentPack(adminTournamentId, "admin");
      if (matchType === "TORNEO" && matchTournamentId === adminTournamentId) await loadTournamentPack(matchTournamentId, "match");
      notify("success", "Participante agregado");
    } catch (error) {
      onError(error, "No pude agregar participante");
    }
  }

  async function removeParticipant(userId) {
    if (!window.confirm("Quitar participante?")) return;
    try {
      await api(`/tournaments/${adminTournamentId}/participants/${userId}`, { method: "DELETE", token });
      await loadTournamentPack(adminTournamentId, "admin");
      if (matchType === "TORNEO" && matchTournamentId === adminTournamentId) await loadTournamentPack(matchTournamentId, "match");
      notify("success", "Participante removido");
    } catch (error) {
      onError(error, "No pude quitar participante");
    }
  }

  async function loadH2H() {
    if (!h2h.player1Id || !h2h.player2Id || h2h.player1Id === h2h.player2Id) {
      return notify("error", "Selecciona dos jugadores distintos");
    }

    setH2h((prev) => ({ ...prev, loading: true }));
    try {
      const data = await api(`/friendlies/h2h?player1Id=${h2h.player1Id}&player2Id=${h2h.player2Id}`, { token });
      setH2h((prev) => ({ ...prev, data }));
    } catch (error) {
      onError(error, "No pude cargar el H2H");
    } finally {
      setH2h((prev) => ({ ...prev, loading: false }));
    }
  }

  function toggleDrawParticipant(participantId) {
    setDrawSelectedParticipantIds((prev) =>
      prev.includes(participantId)
        ? prev.filter((id) => id !== participantId)
        : [...prev, participantId]
    );
  }

  function selectAllDrawParticipants() {
    setDrawSelectedParticipantIds(drawPool.map((entry) => entry.id));
  }

  function clearDrawParticipants() {
    setDrawSelectedParticipantIds([]);
  }

  function toggleDrawTeam(teamName) {
    setDrawSelectedWorldTeams((prev) =>
      prev.includes(teamName)
        ? prev.filter((entry) => entry !== teamName)
        : [...prev, teamName]
    );
  }

  function selectAllDrawTeams() {
    setDrawSelectedWorldTeams(worldTeamsCatalog);
  }

  function selectFilteredDrawTeams() {
    setDrawSelectedWorldTeams((prev) => {
      const merged = new Set(prev);
      filteredWorldTeams.forEach((team) => merged.add(team));
      return Array.from(merged);
    });
  }

  function clearDrawTeams() {
    setDrawSelectedWorldTeams([]);
    setDrawCountryTeams([]);
    setDrawCountryTeamsSignature("");
  }

  async function loadCountryTeamsForDraw({ silent = false } = {}) {
    if (drawCountryTeamsBusy) return;

    if (drawSelectedWorldTeams.length === 0) {
      if (!silent) notify("error", "Selecciona al menos un pais para cargar sus equipos");
      return [];
    }

    setDrawCountryTeamsBusy(true);
    try {
      const responses = await Promise.allSettled(
        drawSelectedWorldTeams.map((countryName) => fetchCountrySoccerTeams(countryName))
      );

      const mergedTeams = [];
      let failedCount = 0;

      responses.forEach((response) => {
        if (response.status === "fulfilled") {
          mergedTeams.push(...response.value);
          return;
        }

        failedCount += 1;
      });

      const uniqueTeams = Array.from(new Set(mergedTeams))
        .sort((a, b) => a.localeCompare(b, "es"));

      setDrawCountryTeams(uniqueTeams);
      setDrawCountryTeamsSignature(selectedCountriesSignature);

      if (uniqueTeams.length === 0) {
        if (!silent) notify("error", "No se encontraron equipos para los paises seleccionados");
        return [];
      }

      if (!silent && failedCount > 0) {
        notify("success", `Cargados ${uniqueTeams.length} equipos. ${failedCount} pais(es) sin datos.`);
        return uniqueTeams;
      }

      if (!silent) notify("success", `Cargados ${uniqueTeams.length} equipos de los paises elegidos`);
      return uniqueTeams;
    } catch (error) {
      if (!silent) onError(error, "No pude cargar equipos por pais");
      return [];
    } finally {
      setDrawCountryTeamsBusy(false);
    }
  }

  function clearLoadedCountryTeams() {
    setDrawCountryTeams([]);
    setDrawCountryTeamsSignature("");
  }

  function clearManualTeams() {
    setDrawManualTeamsText("");
  }

  async function runDraw(manualRawInput = drawManualTeamsText) {
    if (drawBusy || drawCountryTeamsBusy) return;

    if (selectedParticipants.length < 2) {
      notify("error", "Necesitas al menos 2 participantes para sortear");
      return;
    }

    const randomizedParticipants = shuffleArray(
      selectedParticipants.map((entry) => ({
        id: entry.id,
        name: entry.name,
        email: entry.email || "",
      }))
    );

    const maxTeams = Math.max(
      2,
      Math.min(Number(drawTeamCount) || 2, randomizedParticipants.length)
    );

    const effectiveManualTeamNames = parseManualTeamNames(manualRawInput);
    let selectedTeamNames;
    if (effectiveManualTeamNames.length > 0) {
      selectedTeamNames = shuffleArray(effectiveManualTeamNames).slice(
        0,
        Math.min(maxTeams, effectiveManualTeamNames.length)
      );
      if (selectedTeamNames.length < 2) {
        notify("error", "Escribe al menos 2 equipos manuales para usarlos en el sorteo");
        return;
      }
    } else {
    const hasLoadedCountryTeams =
      drawCountryTeams.length > 0 &&
      drawCountryTeamsSignature === selectedCountriesSignature;

    let availableCountryTeams = hasLoadedCountryTeams ? drawCountryTeams : [];
    if (drawSelectedWorldTeams.length > 0 && !hasLoadedCountryTeams) {
      availableCountryTeams = await loadCountryTeamsForDraw({ silent: true });
      if (!availableCountryTeams.length) {
        notify("error", "No pude cargar equipos para los paises seleccionados");
        return;
      }
      notify("success", `Cargados ${availableCountryTeams.length} equipos. Ejecutando sorteo...`);
    }

    if (availableCountryTeams.length > 0) {
      selectedTeamNames = shuffleArray(availableCountryTeams).slice(
        0,
        Math.min(maxTeams, availableCountryTeams.length)
      );
    } else {
      selectedTeamNames = Array.from(
        { length: maxTeams },
        (_, index) => `Equipo ${index + 1}`
      );
    }

    if (selectedTeamNames.length < 2) {
      notify("error", "Selecciona al menos 2 equipos para usar nombres personalizados");
      return;
    }
    }

    const teams = buildDrawTeams(randomizedParticipants, selectedTeamNames);
    const assignments = randomizedParticipants.map((player, index) => ({
      playerId: player.id,
      playerName: player.name,
      teamName: selectedTeamNames[index % selectedTeamNames.length],
    }));

    setDrawResult({
      createdAt: new Date().toISOString(),
      orderedParticipants: randomizedParticipants,
      teams,
      assignments,
    });
    notify("success", "Sorteo generado");
  }

  function handleDrawSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const manualRawInput = String(formData.get("manualTeams") || "");
    setDrawManualTeamsText(manualRawInput);
    void runDraw(manualRawInput);
  }

  function clearDrawResult() {
    setDrawResult(null);
  }

  function toggleThemeMode() {
    setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileBusy(true);
    try {
      const body = {
        name: profile.name,
        email: profile.email,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
      };

      if (profile.newPassword.trim()) {
        body.currentPassword = profile.currentPassword;
        body.newPassword = profile.newPassword;
      }

      const response = await api("/auth/profile", { method: "PATCH", token, body });
      setUser(response.user);
      setProfile(profileFromUser(response.user));
      await loadCore();
      notify("success", "Perfil actualizado");
    } catch (error) {
      onError(error, "No pude guardar perfil");
    } finally {
      setProfileBusy(false);
    }
  }

  function logout() {
    clearSession();
    notify("success", "Sesion cerrada");
  }

  if (!token || !user) {
    return (
      <div className="authWrap">
        <div className="themeDock">
          <button type="button" className="ghostBtn themeToggleBtn" onClick={toggleThemeMode}>
            {themeMode === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
        </div>
        <section className="authCard introCard">
          <h1>Historial FIFA Pro</h1>
          <p>
            Registro, login, perfil editable, panel de estadisticas y ranking de ganadores.
          </p>
          <ul>
            <li>Autenticacion real con sesion persistente</li>
            <li>Graficos de top ganadores y goles</li>
            <li>Admin de torneos y participantes</li>
          </ul>
        </section>

        <section className="authCard formCard">
          <div className="authTabs">
            <button type="button" className={authMode === "login" ? "authTab authTabActive" : "authTab"} onClick={() => setAuthMode("login")}>Iniciar sesion</button>
            <button type="button" className={authMode === "register" ? "authTab authTabActive" : "authTab"} onClick={() => setAuthMode("register")}>Registrarme</button>
          </div>

          {notice && <p className={notice.type === "error" ? "notice noticeError" : "notice noticeSuccess"}>{notice.text}</p>}

          <form onSubmit={submitAuth} className="formGrid">
            {authMode === "register" && (
              <label className="field">Nombre
                <input className="input" value={authForm.name} onChange={(event) => setAuthForm((prev) => ({ ...prev, name: event.target.value }))} />
              </label>
            )}

            <label className="field">Email
              <input type="email" className="input" value={authForm.email} onChange={(event) => setAuthForm((prev) => ({ ...prev, email: event.target.value }))} />
            </label>

            <label className="field">Password
              <input type="password" className="input" value={authForm.password} onChange={(event) => setAuthForm((prev) => ({ ...prev, password: event.target.value }))} />
            </label>

            <button type="submit" className="primaryBtn" disabled={authBusy}>{authBusy ? "Procesando..." : authMode === "register" ? "Crear cuenta" : "Entrar"}</button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="appShell">
      <header className="appHeader">
        <div>
          <h1 className="appTitle">Historial FIFA Pro</h1>
          <p className="appSubtitle">MVP real con auth, perfil y analiticas</p>
        </div>

        <div className="headerActions">
          <div className="userMini">
            <img className="avatarThumb" alt="avatar" src={user.avatarUrl || "https://api.dicebear.com/9.x/initials/svg?seed=" + encodeURIComponent(user.name || "U")} />
            <div><strong>{user.name}</strong><span>{user.email}</span></div>
          </div>
          <button type="button" className="ghostBtn themeToggleBtn" onClick={toggleThemeMode}>
            {themeMode === "dark" ? "Modo claro" : "Modo oscuro"}
          </button>
          <button type="button" className="ghostBtn" onClick={logout}>Cerrar sesion</button>
        </div>
      </header>

      <nav className="navTabs">
        {[ ["DASHBOARD", "Dashboard"], ["PARTIDOS", "Partidos"], ["TORNEOS", "Torneos"], ["SORTEO", "Sorteo"], ["AMIGOS", "Amigos"], ["H2H", "Cara a cara"], ["PERFIL", "Perfil"] ].map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "navTab navTabActive" : "navTab"} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {notice && <p className={notice.type === "error" ? "notice noticeError" : "notice noticeSuccess"}>{notice.text}</p>}

      {tab === "DASHBOARD" && (
        <section className="panelStack">
          <div className="kpiGrid">
            <article className="kpiCard"><span className="kpiLabel">Jugadores</span><strong className="kpiValue">{overview?.usersCount ?? users.length}</strong></article>
            <article className="kpiCard"><span className="kpiLabel">Torneos</span><strong className="kpiValue">{overview?.tournamentsCount ?? tournaments.length}</strong></article>
            <article className="kpiCard"><span className="kpiLabel">Partidos total</span><strong className="kpiValue">{overview?.totalMatches ?? 0}</strong></article>
            <article className="kpiCard"><span className="kpiLabel">Top ganador</span><strong className="kpiValue smallText">{overview?.topWinner?.name || "-"}</strong></article>
          </div>

          <div className="dashboardTop">
            <article className="panel chartPanel">
              <h2 className="panelTitle">Top ganadores</h2>
              <p className="panelSubtitle">Victorias, puntos y goles</p>
              <div className="chartBox">
                {chartData.length === 0 ? <p className="muted">No hay datos.</p> : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={chartData}><CartesianGrid strokeDasharray="4 4" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="victorias" fill="#ef5d2f" /><Bar dataKey="puntos" fill="#1f9d8f" /><Bar dataKey="goles" fill="#2f67ff" /></BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </article>

            <article className="panel tablePanel">
              <h2 className="panelTitle">Ranking global</h2>
              {leaderboard.length === 0 ? <p className="muted">Sin ranking.</p> : (
                <div className="tableBox">
                  <table className="compactTable"><thead><tr><th>Jugador</th><th>V</th><th>PJ</th><th>PTS</th><th>%Win</th></tr></thead><tbody>
                    {leaderboard.slice(0, 10).map((row) => (
                      <tr key={row.userId}><td>{row.name}</td><td>{row.wins}</td><td>{row.played}</td><td>{row.pts}</td><td>{row.winRate}%</td></tr>
                    ))}
                  </tbody></table>
                </div>
              )}
            </article>
          </div>

          <article className="panel">
            <h2 className="panelTitle">Partidos recientes</h2>
            {overview?.recentMatches?.length ? (
              <ul className="recentList">
                {overview.recentMatches.map((match) => (
                  <li key={match.id} className="rowItem">
                    <div className="rowMain">
                      <strong>{match.playerA.name} {match.scoreA} - {match.scoreB} {match.playerB.name}</strong>
                      <span className="rowMeta">{match.type} | {formatDate(match.playedAt)} {match.tournament ? `| ${match.tournament.name} ${match.tournament.year}` : ""}</span>
                    </div>
                    <button type="button" className="dangerBtn" onClick={() => deleteMatch(match.id, match.tournamentId || null)}>Eliminar</button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Sin actividad.</p>}
          </article>
        </section>
      )}

      {tab === "PARTIDOS" && (
        <section className="splitCols">
          <article className="panel">
            <h2 className="panelTitle">Cargar partido</h2>
            <form onSubmit={submitMatch} className="formGrid">
              <label className="field">Tipo
                <select className="select" value={matchType} onChange={(event) => { setMatchType(event.target.value); setMatchForm((prev) => ({ ...prev, playerAId: "", playerBId: "" })); }}>
                  <option value="AMISTOSO">Amistoso</option>
                  <option value="TORNEO">Torneo</option>
                </select>
              </label>

              {matchType === "TORNEO" && (
                <label className="field">Torneo
                  <select className="select" value={matchTournamentId} onChange={(event) => { setMatchTournamentId(event.target.value); setMatchForm((prev) => ({ ...prev, playerAId: "", playerBId: "" })); }}>
                    <option value="">Seleccionar</option>
                    {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} {tournament.year}</option>)}
                  </select>
                </label>
              )}

              <div className="twoCol">
                <label className="field">Jugador A
                  <select className="select" value={matchForm.playerAId} onChange={(event) => setMatchForm((prev) => ({ ...prev, playerAId: event.target.value }))} disabled={matchType === "TORNEO" && !matchTournamentId}>
                    <option value="">Seleccionar</option>
                    {playerOptions.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.id === matchForm.playerBId}>{entry.name}</option>)}
                  </select>
                </label>
                <label className="field">Jugador B
                  <select className="select" value={matchForm.playerBId} onChange={(event) => setMatchForm((prev) => ({ ...prev, playerBId: event.target.value }))} disabled={matchType === "TORNEO" && !matchTournamentId}>
                    <option value="">Seleccionar</option>
                    {playerOptions.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.id === matchForm.playerAId}>{entry.name}</option>)}
                  </select>
                </label>
              </div>

              <div className="twoCol">
                <label className="field">Goles A<input type="number" min="0" className="input" value={matchForm.scoreA} onChange={(event) => setMatchForm((prev) => ({ ...prev, scoreA: event.target.value }))} /></label>
                <label className="field">Goles B<input type="number" min="0" className="input" value={matchForm.scoreB} onChange={(event) => setMatchForm((prev) => ({ ...prev, scoreB: event.target.value }))} /></label>
              </div>

              <label className="field">Fecha<input type="date" className="input" value={matchForm.playedAt} onChange={(event) => setMatchForm((prev) => ({ ...prev, playedAt: event.target.value }))} /></label>
              <button type="submit" className="primaryBtn" disabled={matchBusy}>{matchBusy ? "Guardando..." : "Guardar partido"}</button>
            </form>
          </article>

          <article className="panel">
            <h2 className="panelTitle">Historial</h2>
            {matchHistory.length === 0 ? <p className="muted">No hay partidos.</p> : (
              <ul className="recentList">
                {matchHistory.slice(0, 20).map((match) => (
                  <li key={match.id} className="rowItem">
                    <div className="rowMain"><strong>{match.playerA.name} {match.scoreA} - {match.scoreB} {match.playerB.name}</strong><span className="rowMeta">{formatDate(match.playedAt)}</span></div>
                    <button type="button" className="dangerBtn" onClick={() => deleteMatch(match.id, match.tournamentId || null)}>Eliminar</button>
                  </li>
                ))}
              </ul>
            )}

            {matchType === "TORNEO" && (
              <div className="panelInner">
                <h3>Tabla torneo</h3>
                {matchStandings.length === 0 ? <p className="muted">Sin tabla.</p> : (
                  <div className="tableBox"><table className="compactTable"><thead><tr><th>Jugador</th><th>PTS</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>DG</th></tr></thead><tbody>
                    {matchStandings.map((row) => <tr key={row.userId}><td>{row.name}</td><td>{row.pts}</td><td>{row.pj}</td><td>{row.pg}</td><td>{row.pe}</td><td>{row.pp}</td><td>{row.dg}</td></tr>)}
                  </tbody></table></div>
                )}
              </div>
            )}
          </article>
        </section>
      )}

      {tab === "TORNEOS" && (
        <section className="panelStack">
          <div className="splitCols">
            <article className="panel">
              <h2 className="panelTitle">Crear torneo</h2>
              <form onSubmit={createTournament} className="formGrid">
                <label className="field">Nombre<input className="input" value={newTournament.name} onChange={(event) => setNewTournament((prev) => ({ ...prev, name: event.target.value }))} /></label>
                <label className="field">Anio<input type="number" className="input" value={newTournament.year} onChange={(event) => setNewTournament((prev) => ({ ...prev, year: event.target.value }))} /></label>
                <button type="submit" className="primaryBtn" disabled={newTournamentBusy}>{newTournamentBusy ? "Creando..." : "Crear torneo"}</button>
              </form>
            </article>

            <article className="panel">
              <h2 className="panelTitle">Alta rapida de jugador</h2>
              <form onSubmit={createQuickPlayer} className="formGrid">
                <label className="field">Nombre<input className="input" value={quickPlayer.name} onChange={(event) => setQuickPlayer((prev) => ({ ...prev, name: event.target.value }))} /></label>
                <label className="field">Email opcional<input type="email" className="input" value={quickPlayer.email} onChange={(event) => setQuickPlayer((prev) => ({ ...prev, email: event.target.value }))} /></label>
                <button type="submit" className="primaryBtn" disabled={quickPlayerBusy}>{quickPlayerBusy ? "Guardando..." : "Agregar jugador"}</button>
              </form>
            </article>
          </div>

          <article className="panel">
            <h2 className="panelTitle">Admin de torneo</h2>
            <label className="field">Torneo
              <select className="select" value={adminTournamentId} onChange={(event) => setAdminTournamentId(event.target.value)}>
                <option value="">Seleccionar torneo</option>
                {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} {tournament.year}</option>)}
              </select>
            </label>

            {adminTournamentId && (
              <div className="adminGrid">
                <section className="panelInner">
                  <h3>Participantes</h3>
                  <div className="twoCol tight">
                    <label className="field">Agregar
                      <select className="select" value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)}>
                        <option value="">Jugador</option>
                        {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                      </select>
                    </label>
                    <button type="button" className="primaryBtn" onClick={addParticipant} disabled={!adminUserId}>Agregar</button>
                  </div>

                  <ul className="recentList compact">
                    {adminParticipants.map((entry) => (
                      <li key={entry.id} className="rowItem"><div className="rowMain"><strong>{entry.name}</strong></div><button type="button" className="dangerBtn" onClick={() => removeParticipant(entry.id)}>Quitar</button></li>
                    ))}
                  </ul>
                </section>

                <section className="panelInner spanTwo">
                  <h3>Partidos torneo</h3>
                  <ul className="recentList compact">
                    {adminMatches.slice(0, 25).map((match) => (
                      <li key={match.id} className="rowItem"><div className="rowMain"><strong>{match.playerA.name} {match.scoreA} - {match.scoreB} {match.playerB.name}</strong><span className="rowMeta">{formatDate(match.playedAt)}</span></div><button type="button" className="dangerBtn" onClick={() => deleteMatch(match.id, adminTournamentId)}>Eliminar</button></li>
                    ))}
                  </ul>
                </section>

                <section className="panelInner spanTwo">
                  <h3>Tabla torneo</h3>
                  <div className="tableBox"><table className="compactTable"><thead><tr><th>Jugador</th><th>PTS</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>DG</th></tr></thead><tbody>
                    {adminStandings.map((row) => <tr key={row.userId}><td>{row.name}</td><td>{row.pts}</td><td>{row.pj}</td><td>{row.pg}</td><td>{row.pe}</td><td>{row.pp}</td><td>{row.dg}</td></tr>)}
                  </tbody></table></div>
                </section>
              </div>
            )}
          </article>
        </section>
      )}

      {tab === "SORTEO" && (
        <section className="panelStack">
          <article className="panel drawHeaderPanel">
            <h2 className="panelTitle">Sorteo de equipos y participantes</h2>
            <p className="panelSubtitle">Genera orden aleatorio y reparte jugadores en equipos automaticamente.</p>
            <div className="drawMetaRow">
              <span className="drawStatChip">Participantes en bolsa: {drawPool.length}</span>
              <span className="drawStatChip">Participantes elegidos: {selectedParticipants.length}</span>
              <span className="drawStatChip">Paises elegidos: {drawSelectedWorldTeams.length}</span>
              <span className="drawStatChip">Equipos cargados: {drawCountryTeams.length}</span>
              <span className="drawStatChip">Equipos manuales: {manualTeamNames.length}</span>
              {drawResult?.createdAt && (
                <span className="drawStatChip">Ultimo sorteo: {new Date(drawResult.createdAt).toLocaleString("es-AR")}</span>
              )}
            </div>
          </article>

          <div className="splitCols">
            <article className="panel">
              <h2 className="panelTitle">Configuracion</h2>
              <form className="formGrid" onSubmit={handleDrawSubmit}>
                <label className="field">Fuente de participantes
                  <select className="select" value={drawSource} onChange={(event) => setDrawSource(event.target.value)}>
                    <option value="ALL">Todos los jugadores</option>
                    <option value="TORNEO">Solo participantes de un torneo</option>
                  </select>
                </label>

                {drawSource === "TORNEO" && (
                  <label className="field">Torneo
                    <select className="select" value={drawTournamentId} onChange={(event) => setDrawTournamentId(event.target.value)}>
                      <option value="">Seleccionar torneo</option>
                      {tournaments.map((tournament) => (
                        <option key={tournament.id} value={tournament.id}>
                          {tournament.name} {tournament.year}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="field">Cantidad de equipos
                  <select className="select" value={drawTeamCount} onChange={(event) => setDrawTeamCount(Number(event.target.value))}>
                    {[2, 3, 4, 5, 6, 8, 10, 12].map((teamsCount) => (
                      <option key={teamsCount} value={teamsCount}>{teamsCount} equipos</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  Equipos manuales
                  <textarea
                    className="textarea"
                    name="manualTeams"
                    rows={5}
                    value={drawManualTeamsText}
                    onChange={(event) => setDrawManualTeamsText(event.target.value)}
                    placeholder={"Escribe un equipo por linea o separado por comas.\nEjemplo:\nBoca Juniors\nRiver Plate\nRacing Club"}
                  />
                </label>

                <div className="drawSelectionActions">
                  <button type="button" className="ghostBtn smallBtn" onClick={clearManualTeams} disabled={manualTeamNames.length === 0}>
                    Limpiar equipos manuales
                  </button>
                </div>

                <p className="muted">
                  Si escribes equipos manuales, se usan con prioridad. Si no, se usan equipos cargados por pais. Si no hay ninguno, se generan Equipo 1, Equipo 2, etc.
                </p>

                <div className="actionRow">
                  <button type="submit" className="primaryBtn" disabled={drawBusy || drawCountryTeamsBusy || selectedParticipants.length < 2}>
                    {drawBusy || drawCountryTeamsBusy ? "Cargando..." : "Sortear ahora"}
                  </button>
                  <button type="button" className="ghostBtn" onClick={clearDrawResult} disabled={!drawResult}>
                    Limpiar sorteo
                  </button>
                </div>

                {drawNeedsCountryTeamLoad && (
                  <p className="muted">Hay paises elegidos sin equipos cargados. Al sortear, se cargaran automaticamente.</p>
                )}
              </form>

              <div className="drawSelectionGrid">
                <section className="panelInner drawPoolPanel">
                  <div className="drawSelectionHeader">
                    <h3>Elegir participantes</h3>
                    <div className="drawSelectionActions">
                      <button type="button" className="ghostBtn smallBtn" onClick={selectAllDrawParticipants} disabled={drawPool.length === 0}>Todos</button>
                      <button type="button" className="ghostBtn smallBtn" onClick={clearDrawParticipants} disabled={drawSelectedParticipantIds.length === 0}>Ninguno</button>
                    </div>
                  </div>

                  {drawPool.length === 0 ? <p className="muted">No hay jugadores disponibles para el sorteo.</p> : (
                    <ul className="drawChoiceList">
                      {drawPool.map((entry) => (
                        <li key={entry.id}>
                          <label className="drawChoiceItem">
                            <input
                              type="checkbox"
                              checked={drawSelectedParticipantIds.includes(entry.id)}
                              onChange={() => toggleDrawParticipant(entry.id)}
                            />
                            <span>{entry.name}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="panelInner drawPoolPanel">
                  <div className="drawSelectionHeader">
                    <h3>Paises para equipos</h3>
                    <div className="drawSelectionActions">
                      <button type="button" className="ghostBtn smallBtn" onClick={selectAllDrawTeams}>Elegir todos</button>
                      <button type="button" className="ghostBtn smallBtn" onClick={clearDrawTeams} disabled={drawSelectedWorldTeams.length === 0}>Limpiar paises</button>
                    </div>
                  </div>

                  <label className="field">
                    Buscar pais
                    <input
                      className="input"
                      value={drawTeamSearch}
                      onChange={(event) => setDrawTeamSearch(event.target.value)}
                      placeholder="Ej: Argentina, Brasil, Francia..."
                    />
                  </label>

                  <div className="drawSelectionActions">
                    <button
                      type="button"
                      className="ghostBtn smallBtn"
                      onClick={selectFilteredDrawTeams}
                      disabled={filteredWorldTeams.length === 0}
                    >
                      Elegir paises filtrados
                    </button>
                    <button
                      type="button"
                      className="primaryBtn smallBtn"
                      onClick={loadCountryTeamsForDraw}
                      disabled={drawSelectedWorldTeams.length === 0 || drawCountryTeamsBusy}
                    >
                      {drawCountryTeamsBusy ? "Cargando equipos..." : "Cargar equipos de paises"}
                    </button>
                    <button
                      type="button"
                      className="ghostBtn smallBtn"
                      onClick={clearLoadedCountryTeams}
                      disabled={drawCountryTeams.length === 0}
                    >
                      Limpiar equipos cargados
                    </button>
                  </div>

                  <p className="muted">
                    Se cargan todos los equipos de futbol disponibles por cada pais elegido.
                  </p>

                  {filteredWorldTeams.length === 0 ? <p className="muted">No hay paises que coincidan con la busqueda.</p> : (
                    <ul className="drawChoiceList drawChoiceListTall">
                      {filteredWorldTeams.map((team) => (
                        <li key={team}>
                          <label className="drawChoiceItem">
                            <input
                              type="checkbox"
                              checked={drawSelectedWorldTeams.includes(team)}
                              onChange={() => toggleDrawTeam(team)}
                            />
                            <span>{team}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="drawLoadedTeamsWrap">
                    <h3>Equipos cargados</h3>
                    {drawCountryTeams.length === 0 ? <p className="muted">Aun no cargaste equipos por pais.</p> : (
                      <ul className="drawPoolList drawPoolListTall">
                        {drawCountryTeams.map((team) => <li key={`loaded-${team}`}>{team}</li>)}
                      </ul>
                    )}
                  </div>
                </section>
              </div>
            </article>

            <article className="panel">
              <h2 className="panelTitle">Resultado</h2>
              {!drawResult ? <p className="muted">Ejecuta un sorteo para ver los equipos y el orden de participantes.</p> : (
                <div className="drawResultStack">
                  <section className="panelInner">
                    <h3>Equipo asignado por jugador</h3>
                    <ul className="drawAssignmentList">
                      {drawResult.assignments?.map((entry, index) => (
                        <li key={`${entry.playerId}-${index}`}>
                          <strong>{entry.playerName}</strong>
                          <span className="drawAssignmentArrow">{"->"}</span>
                          <span className="drawAssignmentTeam">{entry.teamName}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="panelInner">
                    <h3>Orden aleatorio de participantes</h3>
                    <ol className="drawOrderList">
                      {drawResult.orderedParticipants.map((entry, index) => (
                        <li key={`${entry.id}-${index}`}>
                          <span>{index + 1}.</span>
                          <strong>{entry.name}</strong>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <section className="drawTeamsGrid">
                    {drawResult.teams.map((team) => (
                      <article key={team.name} className="panelInner teamCard">
                        <h3>{team.name}</h3>
                        <ul className="drawTeamList">
                          {team.players.map((player) => <li key={`${team.name}-${player.id}`}>{player.name}</li>)}
                        </ul>
                      </article>
                    ))}
                  </section>
                </div>
              )}
            </article>
          </div>
        </section>
      )}

      {tab === "AMIGOS" && (
        <section className="panelStack">
          <div className="splitCols">
            <article className="panel">
              <h2 className="panelTitle">Agregar amigo por correo</h2>
              <p className="panelSubtitle">
                Tu amigo debe tener cuenta registrada con ese email.
              </p>

              <form onSubmit={addFriend} className="formGrid">
                <label className="field">
                  Email
                  <input
                    type="email"
                    className="input"
                    value={friendForm.email}
                    onChange={(event) =>
                      setFriendForm((prev) => ({ ...prev, email: event.target.value }))
                    }
                    placeholder="amigo@correo.com"
                  />
                </label>
                <button type="submit" className="primaryBtn" disabled={friendBusy}>
                  {friendBusy ? "Guardando..." : "Agregar amigo"}
                </button>
              </form>
            </article>

            <article className="panel">
              <h2 className="panelTitle">Mis amigos</h2>
              {friends.length === 0 ? (
                <p className="muted">Aun no agregaste amigos.</p>
              ) : (
                <ul className="recentList">
                  {friends.map((entry) => (
                    <li key={entry.id} className="rowItem">
                      <div className="rowMain">
                        <strong>{entry.name}</strong>
                        <span className="rowMeta">
                          {entry.email || "Sin email"}
                          {entry.bio ? ` | ${entry.bio}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="dangerBtn"
                        onClick={() => removeFriend(entry.id)}
                        disabled={friendBusy}
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <article className="panel">
            <h2 className="panelTitle">Partidos de mis amigos</h2>
            <p className="panelSubtitle">
              Aqui puedes seguir todos los partidos de la gente que agregaste por correo.
            </p>

            {friends.length === 0 ? (
              <p className="muted">Agrega amigos para empezar a ver sus partidos.</p>
            ) : (
              <>
                <label className="field">
                  Filtrar por amigo
                  <select
                    className="select"
                    value={friendMatchFilter}
                    onChange={(event) => setFriendMatchFilter(event.target.value)}
                  >
                    <option value="ALL">Todos mis amigos</option>
                    {friends.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>

                {visibleFriendMatches.length === 0 ? (
                  <p className="muted">Todavia no hay partidos cargados para ese amigo.</p>
                ) : (
                  <ul className="recentList compact">
                    {visibleFriendMatches.slice(0, 40).map((match) => (
                      <li key={match.id} className="rowItem">
                        <div className="rowMain">
                          <strong>
                            {match.playerA.name} {match.scoreA} - {match.scoreB} {match.playerB.name}
                          </strong>
                          <span className="rowMeta">
                            {match.type} | {formatDate(match.playedAt)}
                            {match.tournament
                              ? ` | ${match.tournament.name} ${match.tournament.year}`
                              : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="dangerBtn"
                          onClick={() => deleteMatch(match.id, match.tournamentId || null)}
                        >
                          Eliminar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </article>
        </section>
      )}

      {tab === "H2H" && (
        <section className="panel">
          <h2 className="panelTitle">Cara a cara</h2>
          <div className="twoCol">
            <label className="field">Jugador 1
              <select className="select" value={h2h.player1Id} onChange={(event) => setH2h((prev) => ({ ...prev, player1Id: event.target.value }))}>
                <option value="">Seleccionar</option>
                {users.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.id === h2h.player2Id}>{entry.name}</option>)}
              </select>
            </label>
            <label className="field">Jugador 2
              <select className="select" value={h2h.player2Id} onChange={(event) => setH2h((prev) => ({ ...prev, player2Id: event.target.value }))}>
                <option value="">Seleccionar</option>
                {users.map((entry) => <option key={entry.id} value={entry.id} disabled={entry.id === h2h.player1Id}>{entry.name}</option>)}
              </select>
            </label>
          </div>

          <button type="button" className="primaryBtn" onClick={loadH2H} disabled={h2h.loading}>{h2h.loading ? "Buscando..." : "Ver H2H"}</button>

          {h2h.data && (
            <div className="h2hPanel">
              <h3>{h2h.data.player1.name} vs {h2h.data.player2.name}</h3>
              <p>PJ: {h2h.data.summary.played} | {h2h.data.player1.name}: {h2h.data.summary.wins1} | Empates: {h2h.data.summary.draws} | {h2h.data.player2.name}: {h2h.data.summary.wins2}</p>
              <ul className="recentList compact">
                {h2h.data.matches.slice(0, 12).map((match) => <li key={match.id} className="rowItem"><div className="rowMain"><strong>{match.playerA.name} {match.scoreA} - {match.scoreB} {match.playerB.name}</strong><span className="rowMeta">{formatDate(match.playedAt)}</span></div></li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === "PERFIL" && (
        <section className="panel profileGrid">
          <article className="panelInner profilePreview">
            <img className="avatarPreview" alt="avatar" src={profile.avatarUrl || "https://api.dicebear.com/9.x/initials/svg?seed=" + encodeURIComponent(profile.name || "U")} />
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <span className="badge">Cuenta activa</span>
          </article>

          <form onSubmit={saveProfile} className="panelInner formGrid">
            <h2 className="panelTitle">Editar perfil</h2>
            <label className="field">Nombre<input className="input" value={profile.name} onChange={(event) => setProfile((prev) => ({ ...prev, name: event.target.value }))} /></label>
            <label className="field">Email<input type="email" className="input" value={profile.email} onChange={(event) => setProfile((prev) => ({ ...prev, email: event.target.value }))} /></label>
            <label className="field">URL avatar<input className="input" value={profile.avatarUrl} onChange={(event) => setProfile((prev) => ({ ...prev, avatarUrl: event.target.value }))} /></label>
            <label className="field">Bio<textarea className="textarea" rows={4} maxLength={280} value={profile.bio} onChange={(event) => setProfile((prev) => ({ ...prev, bio: event.target.value }))} /></label>
            <div className="twoCol">
              <label className="field">Password actual<input type="password" className="input" value={profile.currentPassword} onChange={(event) => setProfile((prev) => ({ ...prev, currentPassword: event.target.value }))} /></label>
              <label className="field">Nueva password<input type="password" className="input" value={profile.newPassword} onChange={(event) => setProfile((prev) => ({ ...prev, newPassword: event.target.value }))} /></label>
            </div>
            <button type="submit" className="primaryBtn" disabled={profileBusy}>{profileBusy ? "Guardando..." : "Guardar cambios"}</button>
          </form>
        </section>
      )}
      <Analytics />
    </div>
  );
}
