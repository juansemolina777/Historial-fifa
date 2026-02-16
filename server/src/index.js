import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { MatchType, Prisma, PrismaClient } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT) || 3001;
const corsOrigin = process.env.CORS_ORIGIN?.trim();
const JWT_SECRET = process.env.JWT_SECRET || "change-this-jwt-secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET no esta configurado. Usa una clave fuerte en produccion.");
}

const publicUserSelect = {
  id: true,
  name: true,
  bio: true,
  avatarUrl: true,
  createdAt: true,
};

const friendUserSelect = {
  ...publicUserSelect,
  email: true,
};

const authUserSelect = {
  id: true,
  name: true,
  email: true,
  bio: true,
  avatarUrl: true,
  createdAt: true,
};

const authUserWithPasswordSelect = {
  ...authUserSelect,
  passwordHash: true,
};

app.use(
  cors({
    origin: corsOrigin
      ? corsOrigin.split(",").map((origin) => origin.trim())
      : true,
  })
);
app.use(express.json());

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function parseDateOnly(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return null;
  const parsed = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeEmail(rawValue) {
  return String(rawValue || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

function signAuthToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function buildFriendPair(userIdA, userIdB) {
  return [userIdA, userIdB].sort((left, right) => left.localeCompare(right));
}

async function listFriendsByUserId(userId) {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
    include: {
      user1: { select: friendUserSelect },
      user2: { select: friendUserSelect },
    },
    orderBy: { createdAt: "desc" },
  });

  return friendships.map((friendship) =>
    friendship.user1Id === userId ? friendship.user2 : friendship.user1
  );
}

function toStandingsRow(user) {
  return {
    userId: user.id,
    name: user.name,
    pj: 0,
    pg: 0,
    pe: 0,
    pp: 0,
    gf: 0,
    gc: 0,
    dg: 0,
    pts: 0,
  };
}

function computeStandings({ participants, matches }) {
  const table = new Map();

  for (const user of participants) {
    table.set(user.id, toStandingsRow(user));
  }

  const ensure = (user) => {
    if (!table.has(user.id)) {
      table.set(user.id, toStandingsRow(user));
    }
    return table.get(user.id);
  };

  for (const match of matches) {
    const rowA = ensure(match.playerA);
    const rowB = ensure(match.playerB);

    rowA.pj += 1;
    rowB.pj += 1;

    rowA.gf += match.scoreA;
    rowA.gc += match.scoreB;
    rowB.gf += match.scoreB;
    rowB.gc += match.scoreA;

    if (match.scoreA > match.scoreB) {
      rowA.pg += 1;
      rowA.pts += 3;
      rowB.pp += 1;
      continue;
    }

    if (match.scoreB > match.scoreA) {
      rowB.pg += 1;
      rowB.pts += 3;
      rowA.pp += 1;
      continue;
    }

    rowA.pe += 1;
    rowA.pts += 1;
    rowB.pe += 1;
    rowB.pts += 1;
  }

  for (const row of table.values()) {
    row.dg = row.gf - row.gc;
  }

  return Array.from(table.values());
}

function sortStandings(rows) {
  rows.sort(
    (a, b) =>
      b.pts - a.pts ||
      b.dg - a.dg ||
      b.gf - a.gf ||
      a.name.localeCompare(b.name)
  );
}

function buildH2H(matches, player1Id, player2Id) {
  const summary = {
    player1Id,
    player2Id,
    played: 0,
    wins1: 0,
    wins2: 0,
    draws: 0,
    goals1: 0,
    goals2: 0,
  };

  for (const match of matches) {
    summary.played += 1;

    const player1IsA = match.playerAId === player1Id;
    const goals1 = player1IsA ? match.scoreA : match.scoreB;
    const goals2 = player1IsA ? match.scoreB : match.scoreA;

    summary.goals1 += goals1;
    summary.goals2 += goals2;

    if (goals1 > goals2) summary.wins1 += 1;
    else if (goals2 > goals1) summary.wins2 += 1;
    else summary.draws += 1;
  }

  return summary;
}

function toLeaderboardRows(standingsRows) {
  return standingsRows.map((row) => {
    const winRate = row.pj > 0 ? Number(((row.pg / row.pj) * 100).toFixed(1)) : 0;

    return {
      userId: row.userId,
      name: row.name,
      played: row.pj,
      wins: row.pg,
      draws: row.pe,
      losses: row.pp,
      goalsFor: row.gf,
      goalsAgainst: row.gc,
      goalDiff: row.dg,
      pts: row.pts,
      winRate,
    };
  });
}

function sortLeaderboardRows(rows) {
  rows.sort(
    (a, b) =>
      b.wins - a.wins ||
      b.pts - a.pts ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name)
  );
}

async function buildLeaderboard(limit = 10) {
  const [participants, matches] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.match.findMany({
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
    }),
  ]);

  const standings = computeStandings({ participants, matches });
  const rows = toLeaderboardRows(standings);
  sortLeaderboardRows(rows);

  return rows.slice(0, limit);
}

async function requireAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const userId = typeof payload === "object" ? payload.sub : null;

    if (!userId || typeof userId !== "string") {
      return res.status(401).json({ error: "Token invalido" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: authUserSelect,
    });

    if (!user) {
      return res.status(401).json({ error: "Sesion invalida" });
    }

    req.authUser = user;
    return next();
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Sesion expirada" });
    }

    if (error?.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Token invalido" });
    }

    return next(error);
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Servidor andando" });
});

app.get(
  "/health/db",
  asyncHandler(async (req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, message: "DB conectada" });
  })
);

app.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (name.length < 2) {
      return res.status(400).json({ error: "Nombre invalido" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Email invalido" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password minimo: 6 caracteres" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          bio: "",
          avatarUrl: null,
        },
        select: authUserSelect,
      });

      const token = signAuthToken(user.id);

      return res.status(201).json({ user, token });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Ese email ya esta registrado" });
      }
      throw error;
    }
  })
);

app.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email y password son obligatorios" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: authUserWithPasswordSelect,
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: "Credenciales invalidas" });
    }

    const token = signAuthToken(user.id);
    const { passwordHash, ...safeUser } = user;

    res.json({ user: safeUser, token });
  })
);

app.get(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.authUser });
  })
);

app.patch(
  "/auth/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const updateData = {};
    const payload = req.body || {};

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      const name = String(payload.name || "").trim();
      if (name.length < 2) {
        return res.status(400).json({ error: "Nombre invalido" });
      }
      updateData.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "email")) {
      const email = normalizeEmail(payload.email);
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Email invalido" });
      }
      updateData.email = email;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "bio")) {
      const bio = String(payload.bio || "").trim();
      if (bio.length > 280) {
        return res.status(400).json({ error: "La bio no puede superar 280 caracteres" });
      }
      updateData.bio = bio;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "avatarUrl")) {
      const avatarUrl = String(payload.avatarUrl || "").trim();

      if (avatarUrl) {
        try {
          // eslint-disable-next-line no-new
          new URL(avatarUrl);
        } catch {
          return res.status(400).json({ error: "URL de avatar invalida" });
        }
      }

      updateData.avatarUrl = avatarUrl || null;
    }

    const newPassword = String(payload.newPassword || "").trim();
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "Password minimo: 6 caracteres" });
      }

      const currentPassword = String(payload.currentPassword || "");

      const currentUser = await prisma.user.findUnique({
        where: { id: req.authUser.id },
        select: { passwordHash: true },
      });

      if (currentUser?.passwordHash) {
        if (!currentPassword) {
          return res.status(400).json({ error: "Debes ingresar tu password actual" });
        }

        const passwordOk = await bcrypt.compare(currentPassword, currentUser.passwordHash);
        if (!passwordOk) {
          return res.status(401).json({ error: "Password actual incorrecto" });
        }
      }

      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No hay cambios para guardar" });
    }

    try {
      const user = await prisma.user.update({
        where: { id: req.authUser.id },
        data: updateData,
        select: authUserSelect,
      });

      res.json({ user });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Ese email ya esta en uso" });
      }
      throw error;
    }
  })
);

app.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: "asc" },
    });

    res.json(users);
  })
);

app.post(
  "/users",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const emailInput = normalizeEmail(req.body?.email);

    if (name.length < 2) {
      return res.status(400).json({ error: "Nombre invalido" });
    }

    if (emailInput && !isValidEmail(emailInput)) {
      return res.status(400).json({ error: "Email invalido" });
    }

    try {
      const user = await prisma.user.create({
        data: {
          name,
          email: emailInput || null,
        },
        select: publicUserSelect,
      });

      res.status(201).json(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Ese email ya esta en uso" });
      }
      throw error;
    }
  })
);

app.get(
  "/friends",
  requireAuth,
  asyncHandler(async (req, res) => {
    const friends = await listFriendsByUserId(req.authUser.id);
    res.json(friends);
  })
);

app.post(
  "/friends",
  requireAuth,
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Email invalido" });
    }

    const friend = await prisma.user.findUnique({
      where: { email },
      select: friendUserSelect,
    });

    if (!friend) {
      return res.status(404).json({ error: "No existe un usuario con ese email" });
    }

    if (friend.id === req.authUser.id) {
      return res.status(400).json({ error: "No puedes agregarte como amigo" });
    }

    const [user1Id, user2Id] = buildFriendPair(req.authUser.id, friend.id);

    try {
      await prisma.friendship.create({
        data: { user1Id, user2Id },
      });
      return res.status(201).json({ friend });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Ese usuario ya esta en tu lista de amigos" });
      }
      throw error;
    }
  })
);

app.delete(
  "/friends/:friendId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const friendId = String(req.params.friendId || "");

    if (!friendId) {
      return res.status(400).json({ error: "Falta friendId" });
    }

    const [user1Id, user2Id] = buildFriendPair(req.authUser.id, friendId);
    const result = await prisma.friendship.deleteMany({
      where: { user1Id, user2Id },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Ese usuario no esta en tu lista de amigos" });
    }

    res.json({ ok: true });
  })
);

app.get(
  "/friends/matches",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isInteger(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 100;

    const friendIdFilter = String(req.query.friendId || "").trim();
    const friends = await listFriendsByUserId(req.authUser.id);
    const friendIds = friends.map((friend) => friend.id);

    if (friendIds.length === 0) {
      return res.json([]);
    }

    if (friendIdFilter && !friendIds.includes(friendIdFilter)) {
      return res.status(404).json({ error: "Ese usuario no esta en tu lista de amigos" });
    }

    const where = friendIdFilter
      ? {
          OR: [{ playerAId: friendIdFilter }, { playerBId: friendIdFilter }],
        }
      : {
          OR: [{ playerAId: { in: friendIds } }, { playerBId: { in: friendIds } }],
        };

    const matches = await prisma.match.findMany({
      where,
      take: limit,
      include: {
        tournament: { select: { id: true, name: true, year: true } },
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
      orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
    });

    res.json(matches);
  })
);

app.get(
  "/stats/leaderboard",
  asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit || 10);
    const limit = Number.isInteger(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 50)
      : 10;

    const leaderboard = await buildLeaderboard(limit);

    res.json({
      updatedAt: new Date().toISOString(),
      leaderboard,
    });
  })
);

app.get(
  "/stats/overview",
  asyncHandler(async (req, res) => {
    const [
      usersCount,
      tournamentsCount,
      totalMatches,
      friendliesCount,
      tournamentMatchesCount,
      recentMatches,
      leaderboard,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.tournament.count(),
      prisma.match.count(),
      prisma.match.count({ where: { type: MatchType.AMISTOSO } }),
      prisma.match.count({ where: { type: MatchType.TORNEO } }),
      prisma.match.findMany({
        take: 6,
        orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
        include: {
          tournament: { select: { id: true, name: true, year: true } },
          playerA: { select: { id: true, name: true } },
          playerB: { select: { id: true, name: true } },
        },
      }),
      buildLeaderboard(10),
    ]);

    const topWinner = leaderboard[0] || null;
    const topScorer =
      leaderboard
        .slice()
        .sort(
          (a, b) =>
            b.goalsFor - a.goalsFor ||
            b.goalDiff - a.goalDiff ||
            a.name.localeCompare(b.name)
        )[0] || null;

    res.json({
      usersCount,
      tournamentsCount,
      totalMatches,
      friendliesCount,
      tournamentMatchesCount,
      topWinner,
      topScorer,
      leaderboard,
      recentMatches,
    });
  })
);

app.get(
  "/tournaments",
  asyncHandler(async (req, res) => {
    const tournaments = await prisma.tournament.findMany({
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    });
    res.json(tournaments);
  })
);

app.post(
  "/tournaments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const year = Number(req.body?.year);

    if (name.length < 2) {
      return res.status(400).json({ error: "Nombre de torneo invalido" });
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "Anio invalido" });
    }

    const tournament = await prisma.tournament.create({
      data: { name, year },
    });

    res.status(201).json(tournament);
  })
);

app.get(
  "/tournaments/:id/participants",
  asyncHandler(async (req, res) => {
    const tournamentId = req.params.id;

    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      include: {
        user: { select: publicUserSelect },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json(participants.map((item) => item.user));
  })
);

app.post(
  "/tournaments/:id/participants",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tournamentId = req.params.id;
    const userId = String(req.body?.userId || "");

    if (!userId) {
      return res.status(400).json({ error: "Falta userId" });
    }

    const [tournament, user] = await Promise.all([
      prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: publicUserSelect,
      }),
    ]);

    if (!tournament) {
      return res.status(404).json({ error: "Torneo no encontrado" });
    }

    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    try {
      await prisma.tournamentParticipant.create({
        data: { tournamentId, userId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return res.status(409).json({ error: "Ese usuario ya esta en el torneo" });
      }
      throw error;
    }

    res.status(201).json(user);
  })
);

app.delete(
  "/tournaments/:id/participants/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tournamentId = req.params.id;
    const userId = req.params.userId;

    const result = await prisma.tournamentParticipant.deleteMany({
      where: { tournamentId, userId },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Ese usuario no esta en el torneo" });
    }

    res.json({ ok: true });
  })
);

app.post(
  "/matches",
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = String(req.body?.type || "").toUpperCase();
    const tournamentId = req.body?.tournamentId ? String(req.body.tournamentId) : null;
    const playerAId = String(req.body?.playerAId || "");
    const playerBId = String(req.body?.playerBId || "");
    const scoreA = Number(req.body?.scoreA);
    const scoreB = Number(req.body?.scoreB);
    const playedAt = parseDateOnly(req.body?.playedAt);

    if (type !== MatchType.AMISTOSO && type !== MatchType.TORNEO) {
      return res.status(400).json({ error: "type invalido" });
    }

    if (!playerAId || !playerBId) {
      return res.status(400).json({ error: "Faltan jugadores" });
    }

    if (playerAId === playerBId) {
      return res.status(400).json({ error: "Los jugadores no pueden ser el mismo" });
    }

    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      return res.status(400).json({ error: "Goles invalidos" });
    }

    if (!playedAt) {
      return res.status(400).json({ error: "playedAt debe ser YYYY-MM-DD" });
    }

    if (type === MatchType.TORNEO && !tournamentId) {
      return res.status(400).json({ error: "tournamentId es obligatorio si type=TORNEO" });
    }

    if (type === MatchType.AMISTOSO && tournamentId) {
      return res.status(400).json({ error: "Un amistoso no debe tener tournamentId" });
    }

    const players = await prisma.user.findMany({
      where: { id: { in: [playerAId, playerBId] } },
      select: { id: true },
    });

    if (players.length !== 2) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }

    if (type === MatchType.TORNEO) {
      const tournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true },
      });

      if (!tournament) {
        return res.status(404).json({ error: "Torneo no encontrado" });
      }

      const registeredPlayers = await prisma.tournamentParticipant.count({
        where: { tournamentId, userId: { in: [playerAId, playerBId] } },
      });

      if (registeredPlayers !== 2) {
        return res
          .status(400)
          .json({ error: "Ambos jugadores deben ser participantes del torneo" });
      }
    }

    const match = await prisma.match.create({
      data: {
        type,
        tournamentId: type === MatchType.TORNEO ? tournamentId : null,
        playerAId,
        playerBId,
        scoreA,
        scoreB,
        playedAt,
      },
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(match);
  })
);

app.delete(
  "/matches/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const matchId = req.params.id;

    try {
      await prisma.match.delete({ where: { id: matchId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return res.status(404).json({ error: "Partido no encontrado" });
      }
      throw error;
    }

    res.json({ ok: true });
  })
);

app.get(
  "/friendlies",
  asyncHandler(async (req, res) => {
    const matches = await prisma.match.findMany({
      where: { type: MatchType.AMISTOSO },
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
      orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
    });

    res.json(matches);
  })
);

app.get(
  "/friendlies/h2h",
  asyncHandler(async (req, res) => {
    const player1Id = String(req.query.player1Id || "");
    const player2Id = String(req.query.player2Id || "");

    if (!player1Id || !player2Id) {
      return res.status(400).json({ error: "Faltan player1Id o player2Id" });
    }

    if (player1Id === player2Id) {
      return res.status(400).json({ error: "Los jugadores deben ser distintos" });
    }

    const [player1, player2] = await Promise.all([
      prisma.user.findUnique({
        where: { id: player1Id },
        select: { id: true, name: true, avatarUrl: true },
      }),
      prisma.user.findUnique({
        where: { id: player2Id },
        select: { id: true, name: true, avatarUrl: true },
      }),
    ]);

    if (!player1 || !player2) {
      return res.status(404).json({ error: "Jugador no encontrado" });
    }

    const matches = await prisma.match.findMany({
      where: {
        type: MatchType.AMISTOSO,
        OR: [
          { playerAId: player1Id, playerBId: player2Id },
          { playerAId: player2Id, playerBId: player1Id },
        ],
      },
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
      orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
    });

    const summary = buildH2H(matches, player1Id, player2Id);

    res.json({ player1, player2, summary, matches });
  })
);

app.get(
  "/tournaments/:id/matches",
  asyncHandler(async (req, res) => {
    const tournamentId = req.params.id;

    const matches = await prisma.match.findMany({
      where: {
        type: MatchType.TORNEO,
        tournamentId,
      },
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
      orderBy: [{ playedAt: "desc" }, { createdAt: "desc" }],
    });

    res.json(matches);
  })
);

app.get(
  "/tournaments/:id/standings",
  asyncHandler(async (req, res) => {
    const tournamentId = req.params.id;

    const [participantsRows, matches] = await Promise.all([
      prisma.tournamentParticipant.findMany({
        where: { tournamentId },
        include: {
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.match.findMany({
        where: {
          type: MatchType.TORNEO,
          tournamentId,
        },
        include: {
          playerA: { select: { id: true, name: true } },
          playerB: { select: { id: true, name: true } },
        },
      }),
    ]);

    const participants = participantsRows.map((entry) => entry.user);
    const standings = computeStandings({ participants, matches });
    sortStandings(standings);

    res.json({
      tournamentId,
      matchesCount: matches.length,
      standings,
    });
  })
);

app.get(
  "/seasons/:year/standings",
  asyncHandler(async (req, res) => {
    const year = Number(req.params.year);

    if (!Number.isInteger(year)) {
      return res.status(400).json({ error: "Anio invalido" });
    }

    const [participants, tournaments] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.tournament.findMany({
        where: { year },
        select: { id: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const tournamentIds = tournaments.map((tournament) => tournament.id);

    const allMatches = await prisma.match.findMany({
      where: {
        type: MatchType.TORNEO,
        tournamentId: { in: tournamentIds },
      },
      include: {
        playerA: { select: { id: true, name: true } },
        playerB: { select: { id: true, name: true } },
      },
      orderBy: [{ playedAt: "asc" }, { createdAt: "asc" }],
    });

    const totalStandings = computeStandings({ participants, matches: allMatches });
    sortStandings(totalStandings);

    const byTournament = [];

    for (const tournament of tournaments) {
      const tournamentMatches = allMatches.filter(
        (match) => match.tournamentId === tournament.id
      );

      const standings = computeStandings({
        participants,
        matches: tournamentMatches,
      });
      sortStandings(standings);

      byTournament.push({
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        matchesCount: tournamentMatches.length,
        standings,
      });
    }

    res.json({
      season: year,
      tournaments,
      totalMatchesCount: allMatches.length,
      totalStandings,
      byTournament,
    });
  })
);

app.get(
  "/seasons/:year/friendlies/standings",
  asyncHandler(async (req, res) => {
    const year = Number(req.params.year);

    if (!Number.isInteger(year)) {
      return res.status(400).json({ error: "Anio invalido" });
    }

    const start = new Date(`${year}-01-01T00:00:00`);
    const end = new Date(`${year + 1}-01-01T00:00:00`);

    const [participants, matches] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.match.findMany({
        where: {
          type: MatchType.AMISTOSO,
          playedAt: { gte: start, lt: end },
        },
        include: {
          playerA: { select: { id: true, name: true } },
          playerB: { select: { id: true, name: true } },
        },
        orderBy: [{ playedAt: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const standings = computeStandings({ participants, matches });
    sortStandings(standings);

    res.json({ season: year, matchesCount: matches.length, standings });
  })
);

app.use((req, res) => {
  res.status(404).json({ error: "Ruta no encontrada" });
});

app.use((error, req, res, next) => {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return res.status(503).json({ error: "Base de datos no disponible" });
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return res.status(409).json({ error: "Registro duplicado" });
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2025"
  ) {
    return res.status(404).json({ error: "Registro no encontrado" });
  }

  if (error?.name === "TokenExpiredError") {
    return res.status(401).json({ error: "Sesion expirada" });
  }

  if (error?.name === "JsonWebTokenError") {
    return res.status(401).json({ error: "Token invalido" });
  }

  console.error(error);
  return res.status(500).json({ error: "Error interno del servidor" });
});

const server = app.listen(PORT, () => {
  console.log(`API en http://localhost:${PORT}`);
});

async function shutdown(signal) {
  console.log(`\nCerrando API (${signal})...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
