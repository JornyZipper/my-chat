const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const multer = require("multer");
const nodemailer = require("nodemailer");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
const VERIFIED_USERNAME = (process.env.VERIFIED_USERNAME || "Z1pperJ").toLowerCase();
const VERIFIED_CLAIM_CODE = process.env.VERIFIED_CLAIM_CODE || "";

if (!DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }
});

let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

const vapidReady =
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT;

if (vapidReady) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

const onlineSockets = new Map(); // userId -> Set<WebSocket>
const wsUsers = new WeakMap();

function id() {
    return crypto.randomUUID();
}

function norm(v) {
    return String(v || "").trim().toLowerCase();
}

function clean(v, max) {
    return String(v || "").trim().slice(0, max);
}

function validUsername(v) {
    const n = clean(v, 24);
    return n.length >= 2 && n.length <= 24 && /^[\p{L}\p{N}_.-]+$/u.test(n);
}

function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function sendToUser(userId, data) {
    const sockets = onlineSockets.get(userId);
    if (!sockets) return;
    for (const ws of sockets) send(ws, data);
}

function addSocket(userId, ws) {
    if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
    onlineSockets.get(userId).add(ws);
    wsUsers.set(ws, userId);
}

function removeSocket(ws) {
    const userId = wsUsers.get(ws);
    if (!userId) return null;
    const set = onlineSockets.get(userId);
    if (set) {
        set.delete(ws);
        if (!set.size) onlineSockets.delete(userId);
    }
    wsUsers.delete(ws);
    return userId;
}

function isOnline(userId) {
    return onlineSockets.has(userId);
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

function issueToken(userId) {
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function publicProfile(row, viewerId = null) {
    if (!row) return null;
    const online = isOnline(row.id);
    const canShowOnline = row.privacy_online !== "nobody" || viewerId === row.id;
    const visibleOnline = online && canShowOnline;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio || "",
        status: visibleOnline ? (row.presence_status || "online") : "offline",
        presenceStatus: row.presence_status || "online",
        online: online && canShowOnline,
        verified: Boolean(row.verified_badge),
        privacyOnline: row.privacy_online || "everyone",
        avatarUrl: row.avatar_data ? `/api/avatar/${row.id}` : "",
        avatarColor: row.avatar_color || "#3390ec",
        createdAt: row.created_at
    };
}

function pushPayloadForMessage(message, sender) {
    return {
        title: sender.display_name,
        body: message.deleted_at ? "Сообщение удалено" : (message.text || "Вложение"),
        icon: sender.avatar_data ? `/api/avatar/${sender.id}` : "/icon.svg",
        badge: "/icon.svg",
        data: { userId: sender.id }
    };
}

async function pushNotify(recipientId, payload) {
    if (!vapidReady) return;
    const { rows } = await pool.query(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1",
        [recipientId]
    );
    for (const sub of rows) {
        try {
            await webpush.sendNotification(
                {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                },
                JSON.stringify(payload)
            );
        } catch (err) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                await pool.query("DELETE FROM push_subscriptions WHERE id=$1", [sub.id]);
            }
        }
    }
}

async function email(to, subject, html) {
    if (!mailer) return false;
    await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject,
        html
    });
    return true;
}

async function createMailToken(userId, type) {
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
        `INSERT INTO mail_tokens (id,user_id,token,type,expires_at)
         VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 minutes')`,
        [id(), userId, token, type]
    );
    return token;
}

async function blockedBetween(a, b) {
    const { rows } = await pool.query(
        `SELECT EXISTS(
             SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2
         ) AS a_blocks_b,
         EXISTS(
             SELECT 1 FROM blocks WHERE blocker_id=$2 AND blocked_id=$1
         ) AS b_blocks_a`,
        [a, b]
    );
    return rows[0];
}

async function getUser(idValue) {
    const { rows } = await pool.query(
        `SELECT id,username,username_norm,display_name,password_hash,email,email_verified,
                avatar_data,avatar_mime,avatar_color,bio,presence_status,privacy_online,verified_badge,created_at
         FROM users WHERE id=$1`,
        [idValue]
    );
    return rows[0] || null;
}

async function getUserByUsername(username) {
    const { rows } = await pool.query(
        `SELECT id,username,username_norm,display_name,password_hash,email,email_verified,
                avatar_data,avatar_mime,avatar_color,bio,presence_status,privacy_online,verified_badge,created_at
         FROM users WHERE username_norm=$1`,
        [norm(username)]
    );
    return rows[0] || null;
}

async function isMember(conversationId, userId) {
    const { rowCount } = await pool.query(
        "SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2",
        [conversationId, userId]
    );
    return rowCount > 0;
}

async function getDirectConversation(a, b) {
    const { rows } = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_members x ON x.conversation_id=c.id AND x.user_id=$1
         JOIN conversation_members y ON y.conversation_id=c.id AND y.user_id=$2
         WHERE c.type='direct' LIMIT 1`,
        [a, b]
    );
    return rows[0]?.id || null;
}

async function ensureDirectConversation(a, b) {
    let conversationId = await getDirectConversation(a, b);
    if (conversationId) return conversationId;

    conversationId = id();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(
            "INSERT INTO conversations (id,type) VALUES ($1,'direct')",
            [conversationId]
        );
        await client.query(
            "INSERT INTO conversation_members (conversation_id,user_id) VALUES ($1,$2),($1,$3)",
            [conversationId, a, b]
        );
        await client.query("COMMIT");
        return conversationId;
    } catch (e) {
        await client.query("ROLLBACK");
        const retry = await getDirectConversation(a, b);
        if (retry) return retry;
        throw e;
    } finally {
        client.release();
    }
}

async function broadcastPresence() {
    const { rows } = await pool.query(
        `SELECT id,username,display_name,avatar_data,bio,presence_status,
                privacy_online,verified_badge,created_at
         FROM users ORDER BY username_norm`
    );
    const list = rows.map(r => publicProfile(r));
    for (const userId of onlineSockets.keys()) {
        sendToUser(userId, { type: "users", users: list });
    }
}

async function broadcastChatRefresh(userIds) {
    for (const uid of new Set(userIds)) {
        sendToUser(uid, { type: "chat_refresh" });
    }
}

async function messagePayload(messageId) {
    const { rows } = await pool.query(
        `SELECT m.id,m.conversation_id,m.sender_id,m.text,m.created_at,m.edited_at,m.deleted_at,
                m.delivered_at,m.read_at,m.reply_to_id,m.forwarded_from_id,
                u.username AS sender_username,u.display_name AS sender_display_name,u.verified_badge AS sender_verified,
                a.id AS attachment_id,a.filename AS attachment_filename,a.mime_type AS attachment_mime,a.size AS attachment_size,
                rm.text AS reply_text, ru.username AS reply_username,
                rj.reactions
         FROM messages m
         JOIN users u ON u.id=m.sender_id
         LEFT JOIN attachments a ON a.id=m.attachment_id
         LEFT JOIN messages rm ON rm.id=m.reply_to_id
         LEFT JOIN users ru ON ru.id=rm.sender_id
         LEFT JOIN LATERAL (
             SELECT COALESCE(json_agg(json_build_object('emoji',r.emoji,'userId',r.user_id)), '[]'::json) AS reactions
             FROM reactions r WHERE r.message_id=m.id
         ) rj ON true
         WHERE m.id=$1`,
        [messageId]
    );
    if (!rows[0]) return null;
    const m = rows[0];
    return {
        id: m.id,
        conversationId: m.conversation_id,
        senderId: m.sender_id,
        senderUsername: m.sender_username,
        senderDisplayName: m.sender_display_name,
        senderVerified: Boolean(m.sender_verified),
        text: m.deleted_at ? "Сообщение удалено" : (m.text || ""),
        deleted: Boolean(m.deleted_at),
        edited: Boolean(m.edited_at),
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deliveredAt: m.delivered_at,
        readAt: m.read_at,
        replyTo: m.reply_to_id ? {
            id: m.reply_to_id,
            text: m.reply_text || "",
            username: m.reply_username || ""
        } : null,
        forwarded: Boolean(m.forwarded_from_id),
        attachment: m.attachment_id ? {
            id: m.attachment_id,
            filename: m.attachment_filename,
            mime: m.attachment_mime,
            size: Number(m.attachment_size || 0),
            url: `/api/media/${m.attachment_id}`
        } : null,
        reactions: m.reactions || []
    };
}

async function broadcastMessageToConversation(conversationId, message) {
    const { rows } = await pool.query(
        "SELECT user_id FROM conversation_members WHERE conversation_id=$1",
        [conversationId]
    );
    for (const row of rows) {
        sendToUser(row.user_id, { type: "message", message });
    }
}

function authMiddleware(req, res, next) {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const decoded = verifyToken(token);
    if (!decoded?.sub) return res.status(401).json({ error: "Не авторизован." });
    req.userId = decoded.sub;
    next();
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_data BYTEA,
  avatar_mime TEXT,
  avatar_color TEXT NOT NULL DEFAULT '#3390ec',
  bio TEXT NOT NULL DEFAULT '',
  presence_status TEXT NOT NULL DEFAULT 'online',
  privacy_online TEXT NOT NULL DEFAULT 'everyone',
  verified_badge BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_username_norm_idx ON users(username_norm);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT,
  attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
  reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  forwarded_from_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id,user_id,emoji)
);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(blocker_id,blocked_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mail_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

/* ================================
   AUTH
================================ */

app.post("/api/auth/register", async (req, res) => {
    try {
        const username = clean(req.body.username, 24);
        const displayName = clean(req.body.displayName, 40);
        const emailValue = clean(req.body.email, 120).toLowerCase();
        const password = String(req.body.password || "");
        const claimCode = String(req.body.claimCode || "");

        if (!validUsername(username)) return res.status(400).json({ error: "Неверный username." });
        if (displayName.length < 1) return res.status(400).json({ error: "Введите имя." });
        if (password.length < 8) return res.status(400).json({ error: "Пароль должен быть не короче 8 символов." });
        if (!validEmail(emailValue)) return res.status(400).json({ error: "Введите корректный email." });

        const special = norm(username) === VERIFIED_USERNAME;
        if (special && (!VERIFIED_CLAIM_CODE || claimCode !== VERIFIED_CLAIM_CODE)) {
            return res.status(403).json({ error: "Для @Z1pperJ требуется код подтверждения владельца." });
        }

        const existing = await getUserByUsername(username);
        if (existing) return res.status(409).json({ error: "Этот username уже занят." });
        const emailExisting = await pool.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [emailValue]);
        if (emailExisting.rowCount) return res.status(409).json({ error: "Этот email уже зарегистрирован." });

        const userId = id();
        const passwordHash = await bcrypt.hash(password, 12);
        const verified = special;
        const emailVerified = !REQUIRE_EMAIL_VERIFICATION;

        await pool.query(
            `INSERT INTO users
             (id,username,username_norm,display_name,password_hash,email,email_verified,verified_badge)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [userId, username, norm(username), displayName, passwordHash, emailValue, emailVerified, verified]
        );

        if (REQUIRE_EMAIL_VERIFICATION) {
            const token = await createMailToken(userId, "verify_email");
            const url = `${APP_URL || ""}/?verify=${encodeURIComponent(token)}`;
            try {
                await email(
                    emailValue,
                    "Подтверждение My Chat",
                    `<p>Привет, ${displayName}!</p><p>Нажми <a href="${url}">здесь</a>, чтобы подтвердить email.</p>`
                );
            } catch (mailError) {
                console.error("Mail error:", mailError.message);
            }
        }

        const user = await getUser(userId);
        if (!emailVerified) {
            return res.json({
                verificationRequired: true,
                message: mailer
                    ? "Проверь email для завершения регистрации."
                    : "REQUIRE_EMAIL_VERIFICATION включён, но SMTP не настроен. Настрой SMTP в Render."
            });
        }

        const token = issueToken(userId);
        res.json({ token, profile: publicProfile(user, userId) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Ошибка регистрации." });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const username = clean(req.body.username, 24);
        const password = String(req.body.password || "");
        const user = await getUserByUsername(username);
        if (!user) return res.status(401).json({ error: "Неверный username или пароль." });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: "Неверный username или пароль." });
        if (REQUIRE_EMAIL_VERIFICATION && !user.email_verified) {
            return res.status(403).json({ error: "Сначала подтверди email." });
        }
        const token = issueToken(user.id);
        res.json({ token, profile: publicProfile(user, user.id) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Ошибка входа." });
    }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: "Профиль не найден." });
    res.json({ profile: publicProfile(user, req.userId), email: user.email || "", emailVerified: user.email_verified });
});

app.get("/api/auth/verify", async (req, res) => {
    try {
        const token = clean(req.query.token, 128);
        const { rows } = await pool.query(
            `SELECT * FROM mail_tokens
             WHERE token=$1 AND type='verify_email' AND used=FALSE AND expires_at>NOW() LIMIT 1`,
            [token]
        );
        if (!rows[0]) return res.status(400).json({ error: "Ссылка недействительна или устарела." });
        await pool.query("UPDATE users SET email_verified=TRUE WHERE id=$1", [rows[0].user_id]);
        await pool.query("UPDATE mail_tokens SET used=TRUE WHERE id=$1", [rows[0].id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: "Не удалось подтвердить email." });
    }
});

app.post("/api/auth/forgot", async (req, res) => {
    try {
        const emailValue = clean(req.body.email, 120).toLowerCase();
        const { rows } = await pool.query("SELECT id,display_name FROM users WHERE lower(email)=lower($1) LIMIT 1", [emailValue]);
        if (rows[0] && mailer) {
            const token = await createMailToken(rows[0].id, "reset_password");
            const url = `${APP_URL || ""}/?reset=${encodeURIComponent(token)}`;
            await email(
                emailValue,
                "Сброс пароля My Chat",
                `<p>Привет!</p><p>Сбросить пароль можно <a href="${url}">по этой ссылке</a>. Ссылка действует 30 минут.</p>`
            );
        }
        res.json({ message: "Если такой email существует, инструкция отправлена." });
    } catch {
        res.json({ message: "Если такой email существует, инструкция отправлена." });
    }
});

app.post("/api/auth/reset", async (req, res) => {
    try {
        const token = clean(req.body.token, 128);
        const password = String(req.body.password || "");
        if (password.length < 8) return res.status(400).json({ error: "Пароль должен быть не короче 8 символов." });
        const { rows } = await pool.query(
            `SELECT * FROM mail_tokens
             WHERE token=$1 AND type='reset_password' AND used=FALSE AND expires_at>NOW() LIMIT 1`,
            [token]
        );
        if (!rows[0]) return res.status(400).json({ error: "Ссылка недействительна или устарела." });
        const hash = await bcrypt.hash(password, 12);
        await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, rows[0].user_id]);
        await pool.query("UPDATE mail_tokens SET used=TRUE WHERE id=$1", [rows[0].id]);
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: "Не удалось изменить пароль." });
    }
});

/* ================================
   PROFILE
================================ */

app.get("/api/profile", authMiddleware, async (req, res) => {
    const user = await getUser(req.userId);
    res.json({ profile: publicProfile(user, req.userId), email: user.email || "", emailVerified: user.email_verified });
});

app.patch("/api/profile", authMiddleware, async (req, res) => {
    try {
        const user = await getUser(req.userId);
        if (!user) return res.status(404).json({ error: "Профиль не найден." });

        const username = clean(req.body.username, 24);
        const displayName = clean(req.body.displayName, 40);
        const bio = clean(req.body.bio, 160);
        const avatarColor = /^#[0-9a-fA-F]{6}$/.test(String(req.body.avatarColor || "")) ? String(req.body.avatarColor) : (user.avatar_color || "#3390ec");
        const presenceStatus = ["online", "away", "dnd"].includes(req.body.presenceStatus) ? req.body.presenceStatus : user.presence_status;
        const privacyOnline = ["everyone", "nobody"].includes(req.body.privacyOnline) ? req.body.privacyOnline : user.privacy_online;
        const claimCode = String(req.body.claimCode || "");

        if (!validUsername(username)) return res.status(400).json({ error: "Неверный username." });
        if (!displayName) return res.status(400).json({ error: "Имя не может быть пустым." });

        const existing = await getUserByUsername(username);
        if (existing && existing.id !== req.userId) return res.status(409).json({ error: "Этот username уже занят." });

        if (norm(username) === VERIFIED_USERNAME && user.verified_badge !== true) {
            if (!VERIFIED_CLAIM_CODE || claimCode !== VERIFIED_CLAIM_CODE) {
                return res.status(403).json({ error: "Для @Z1pperJ нужен код владельца." });
            }
        }

        await pool.query(
            `UPDATE users SET username=$1,username_norm=$2,display_name=$3,bio=$4,
             presence_status=$5,privacy_online=$6,verified_badge=$7,avatar_color=$8 WHERE id=$9`,
            [username, norm(username), displayName, bio, presenceStatus, privacyOnline, norm(username) === VERIFIED_USERNAME, avatarColor, req.userId]
        );

        const updated = await getUser(req.userId);
        res.json({ profile: publicProfile(updated, req.userId) });
        await broadcastPresence();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Не удалось сохранить профиль." });
    }
});

app.post("/api/profile/avatar", authMiddleware, upload.single("avatar"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Файл не выбран." });
        if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "Нужна картинка." });
        if (req.file.size > 4 * 1024 * 1024) return res.status(400).json({ error: "Аватар слишком большой." });
        await pool.query(
            "UPDATE users SET avatar_data=$1,avatar_mime=$2 WHERE id=$3",
            [req.file.buffer, req.file.mimetype, req.userId]
        );
        const user = await getUser(req.userId);
        res.json({ profile: publicProfile(user, req.userId) });
        await broadcastPresence();
    } catch {
        res.status(500).json({ error: "Не удалось загрузить аватар." });
    }
});

app.delete("/api/profile/avatar", authMiddleware, async (req, res) => {
    await pool.query("UPDATE users SET avatar_data=NULL,avatar_mime=NULL WHERE id=$1", [req.userId]);
    const user = await getUser(req.userId);
    res.json({ profile: publicProfile(user, req.userId) });
    await broadcastPresence();
});

app.get("/api/avatar/:userId", async (req, res) => {
    const { rows } = await pool.query(
        "SELECT avatar_data,avatar_mime FROM users WHERE id=$1",
        [req.params.userId]
    );
    if (!rows[0]?.avatar_data) return res.status(404).end();
    res.set("Content-Type", rows[0].avatar_mime || "image/jpeg");
    res.set("Cache-Control", "public, max-age=300");
    res.send(rows[0].avatar_data);
});

/* ================================
   USERS / SEARCH
================================ */

app.get("/api/users", authMiddleware, async (req, res) => {
    try {
        const q = clean(req.query.q, 50).replace(/^@/, "").toLowerCase();
        const params = [req.userId];
        let where = "u.id <> $1";
        if (q) {
            params.push(`%${q}%`);
            where += ` AND (u.username_norm LIKE $2 OR lower(u.display_name) LIKE $2)`;
        }
        const { rows } = await pool.query(
            `SELECT u.id,u.username,u.display_name,u.avatar_data,u.bio,u.presence_status,u.privacy_online,u.verified_badge,u.created_at,
                    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=$1 AND b.blocked_id=u.id) AS blocked,
                    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$1) AS blocked_me
             FROM users u WHERE ${where}
             ORDER BY (u.id IN (SELECT user_id FROM conversation_members)) DESC,u.username_norm LIMIT 100`,
            params
        );
        res.json({
            users: rows
                .filter(r => !r.blocked && !r.blocked_me)
                .map(r => ({ ...publicProfile(r, req.userId), blocked: false, blockedMe: false }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Ошибка поиска." });
    }
});

/* ================================
   CHATS
================================ */

app.get("/api/chats", authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.id,
                    u.id AS user_id,u.username,u.display_name,u.avatar_data,u.bio,u.presence_status,u.privacy_online,u.verified_badge,u.created_at,
                    cm1.pinned,cm1.muted,
                    lm.id AS last_message_id,lm.text AS last_text,lm.created_at AS last_time,lm.sender_id AS last_sender_id,
                    (SELECT COUNT(*) FROM messages um
                     WHERE um.conversation_id=c.id AND um.sender_id=u.id AND um.read_at IS NULL AND um.deleted_at IS NULL) AS unread
             FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=$1
             JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id<>$1
             JOIN users u ON u.id=cm2.user_id
             LEFT JOIN LATERAL (
                 SELECT id,text,created_at,sender_id FROM messages
                 WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1
             ) lm ON TRUE
             ORDER BY cm1.pinned DESC, lm.created_at DESC NULLS LAST`,
            [req.userId]
        );
        res.json({
            chats: rows.map(r => ({
                conversationId: r.id,
                user: publicProfile(r, req.userId),
                pinned: Boolean(r.pinned),
                muted: Boolean(r.muted),
                unread: Number(r.unread || 0),
                lastMessage: r.last_message_id ? {
                    id: r.last_message_id,
                    text: r.last_text || "Вложение",
                    senderId: r.last_sender_id,
                    time: r.last_time
                } : null
            }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Не удалось загрузить чаты." });
    }
});

app.get("/api/chats/:userId/messages", authMiddleware, async (req, res) => {
    try {
        const targetId = req.params.userId;
        if (targetId === req.userId) return res.status(400).json({ error: "Нельзя открыть чат с самим собой." });
        const blocked = await blockedBetween(req.userId, targetId);
        if (blocked.a_blocks_b || blocked.b_blocks_a) return res.status(403).json({ error: "Этот пользователь заблокирован." });
        const conversationId = await ensureDirectConversation(req.userId, targetId);
        const delivered = await pool.query(
            `UPDATE messages SET delivered_at=COALESCE(delivered_at,NOW())
             WHERE conversation_id=$1 AND sender_id=$2 AND delivered_at IS NULL AND deleted_at IS NULL
             RETURNING id`,
            [conversationId, targetId]
        );
        if (delivered.rows.length) sendToUser(targetId, {type:"receipts", kind:"delivered", messageIds:delivered.rows.map(r=>r.id)});
        const search = clean(req.query.search, 100);
        const params = [conversationId];
        let where = "m.conversation_id=$1";
        if (search) {
            params.push(`%${search}%`);
            where += " AND m.text ILIKE $2";
        }
        const { rows } = await pool.query(
            `SELECT m.id,m.conversation_id,m.sender_id,m.text,m.created_at,m.edited_at,m.deleted_at,
                    m.delivered_at,m.read_at,m.reply_to_id,m.forwarded_from_id,
                    u.username AS sender_username,u.display_name AS sender_display_name,u.verified_badge AS sender_verified,
                    a.id AS attachment_id,a.filename AS attachment_filename,a.mime_type AS attachment_mime,a.size AS attachment_size,
                    rm.text AS reply_text,ru.username AS reply_username
             FROM messages m
             JOIN users u ON u.id=m.sender_id
             LEFT JOIN attachments a ON a.id=m.attachment_id
             LEFT JOIN messages rm ON rm.id=m.reply_to_id
             LEFT JOIN users ru ON ru.id=rm.sender_id
             WHERE ${where}
             ORDER BY m.created_at ASC LIMIT 300`,
            params
        );
        const ids = rows.map(r => r.id);
        let reactions = [];
        if (ids.length) {
            const rr = await pool.query(
                "SELECT message_id,user_id,emoji FROM reactions WHERE message_id=ANY($1::text[])",
                [ids]
            );
            reactions = rr.rows;
        }
        const reactionMap = new Map();
        for (const r of reactions) {
            if (!reactionMap.has(r.message_id)) reactionMap.set(r.message_id, []);
            reactionMap.get(r.message_id).push({ emoji: r.emoji, userId: r.user_id });
        }
        res.json({
            conversationId,
            messages: rows.map(m => ({
                id: m.id,
                conversationId: m.conversation_id,
                senderId: m.sender_id,
                senderUsername: m.sender_username,
                senderDisplayName: m.sender_display_name,
                senderVerified: Boolean(m.sender_verified),
                text: m.deleted_at ? "Сообщение удалено" : (m.text || ""),
                deleted: Boolean(m.deleted_at),
                edited: Boolean(m.edited_at),
                createdAt: m.created_at,
                deliveredAt: m.delivered_at,
                readAt: m.read_at,
                replyTo: m.reply_to_id ? { id: m.reply_to_id, text: m.reply_text || "", username: m.reply_username || "" } : null,
                forwarded: Boolean(m.forwarded_from_id),
                attachment: m.attachment_id ? { id: m.attachment_id, filename: m.attachment_filename, mime: m.attachment_mime, size: Number(m.attachment_size || 0), url: `/api/media/${m.attachment_id}` } : null,
                reactions: reactionMap.get(m.id) || []
            }))
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Не удалось загрузить сообщения." });
    }
});

app.post("/api/chats/:userId/settings", authMiddleware, async (req, res) => {
    try {
        const conversationId = await ensureDirectConversation(req.userId, req.params.userId);
        const pinned = Boolean(req.body.pinned);
        const muted = Boolean(req.body.muted);
        await pool.query(
            `UPDATE conversation_members SET pinned=$1,muted=$2 WHERE conversation_id=$3 AND user_id=$4`,
            [pinned, muted, conversationId, req.userId]
        );
        res.json({ ok: true });
        await broadcastChatRefresh([req.userId]);
    } catch {
        res.status(500).json({ error: "Не удалось сохранить настройки чата." });
    }
});

/* ================================
   ATTACHMENTS
================================ */

app.post("/api/upload", authMiddleware, upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Файл не выбран." });
        const attachmentId = id();
        await pool.query(
            `INSERT INTO attachments(id,owner_id,filename,mime_type,size,data)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [attachmentId, req.userId, clean(req.file.originalname, 255), req.file.mimetype || "application/octet-stream", req.file.size, req.file.buffer]
        );
        res.json({
            attachment: {
                id: attachmentId,
                filename: clean(req.file.originalname, 255),
                mime: req.file.mimetype || "application/octet-stream",
                size: req.file.size,
                url: `/api/media/${attachmentId}`
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Не удалось загрузить файл." });
    }
});

app.get("/api/media/:id", async (req, res) => {
    try {
        let mediaUserId = null;
        const header = req.get("authorization") || "";
        const bearer = header.startsWith("Bearer ") ? header.slice(7) : (req.query.token || "");
        const decoded = verifyToken(String(bearer));
        if (decoded?.sub) mediaUserId = decoded.sub;
        if (!mediaUserId) return res.status(401).end();
        const { rows } = await pool.query(
            `SELECT a.filename,a.mime_type,a.data
             FROM attachments a
             WHERE a.id=$1 AND (
               a.owner_id=$2 OR EXISTS(
                 SELECT 1 FROM messages m
                 JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
                 WHERE m.attachment_id=a.id AND cm.user_id=$2
               )
             )`,
            [req.params.id, mediaUserId]
        );
        if (!rows[0]) return res.status(404).end();
        res.set("Content-Type", rows[0].mime_type);
        res.set("Content-Disposition", `inline; filename="${rows[0].filename.replace(/"/g, "")}"`);
        res.send(rows[0].data);
    } catch {
        res.status(500).end();
    }
});

/* ================================
   MESSAGE ACTIONS
================================ */

app.patch("/api/messages/:id", authMiddleware, async (req, res) => {
    try {
        const text = clean(req.body.text, 4000);
        const { rows } = await pool.query(
            "SELECT * FROM messages WHERE id=$1 AND sender_id=$2",
            [req.params.id, req.userId]
        );
        const message = rows[0];
        if (!message) return res.status(404).json({ error: "Сообщение не найдено." });
        if (message.deleted_at) return res.status(400).json({ error: "Сообщение уже удалено." });
        if ((Date.now() - new Date(message.created_at).getTime()) > 15 * 60 * 1000) {
            return res.status(403).json({ error: "Сообщение можно редактировать только первые 15 минут." });
        }
        await pool.query(
            "UPDATE messages SET text=$1,edited_at=NOW() WHERE id=$2",
            [text, req.params.id]
        );
        const payload = await messagePayload(req.params.id);
        await broadcastMessageToConversation(message.conversation_id, payload);
        res.json({ message: payload });
    } catch {
        res.status(500).json({ error: "Не удалось изменить сообщение." });
    }
});

app.delete("/api/messages/:id", authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT conversation_id FROM messages WHERE id=$1 AND sender_id=$2",
            [req.params.id, req.userId]
        );
        if (!rows[0]) return res.status(404).json({ error: "Сообщение не найдено." });
        await pool.query(
            "UPDATE messages SET text=NULL,attachment_id=NULL,deleted_at=NOW(),edited_at=NULL WHERE id=$1",
            [req.params.id]
        );
        const payload = await messagePayload(req.params.id);
        await broadcastMessageToConversation(rows[0].conversation_id, payload);
        res.json({ message: payload });
    } catch {
        res.status(500).json({ error: "Не удалось удалить сообщение." });
    }
});

app.post("/api/messages/:id/reactions", authMiddleware, async (req, res) => {
    try {
        const emoji = clean(req.body.emoji, 8);
        const { rows } = await pool.query(
            `SELECT m.id,m.conversation_id FROM messages m
             JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2
             WHERE m.id=$1`,
            [req.params.id, req.userId]
        );
        if (!rows[0]) return res.status(404).json({ error: "Сообщение не найдено." });
        const conversationId = rows[0].conversation_id;
        const existing = await pool.query(
            "SELECT id FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3",
            [req.params.id, req.userId, emoji]
        );
        if (existing.rowCount) {
            await pool.query("DELETE FROM reactions WHERE id=$1", [existing.rows[0].id]);
        } else {
            await pool.query(
                "INSERT INTO reactions(id,message_id,user_id,emoji) VALUES($1,$2,$3,$4)",
                [id(), req.params.id, req.userId, emoji]
            );
        }
        const rr = await pool.query(
            "SELECT user_id,emoji FROM reactions WHERE message_id=$1",
            [req.params.id]
        );
        const reactionList = rr.rows.map(r => ({ userId: r.user_id, emoji: r.emoji }));
        const { rows: members } = await pool.query("SELECT user_id FROM conversation_members WHERE conversation_id=$1", [conversationId]);
        for (const member of members) {
            sendToUser(member.user_id, {
                type: "reaction",
                messageId: req.params.id,
                reactions: reactionList
            });
        }
        res.json({ reactions: reactionList });
    } catch {
        res.status(500).json({ error: "Не удалось изменить реакцию." });
    }
});

app.post("/api/messages/:id/forward", authMiddleware, async (req, res) => {
    try {
        const targetId = String(req.body.toUserId || "");
        const sourceResult = await pool.query(
            "SELECT * FROM messages WHERE id=$1",
            [req.params.id]
        );
        const source = sourceResult.rows[0];
        if (!source) return res.status(404).json({ error: "Сообщение не найдено." });
        const blocked = await blockedBetween(req.userId, targetId);
        if (blocked.a_blocks_b || blocked.b_blocks_a) return res.status(403).json({ error: "Этот пользователь заблокирован." });
        const conversationId = await ensureDirectConversation(req.userId, targetId);
        const recipientOnline = isOnline(targetId);
        const newId = id();
        await pool.query(
            `INSERT INTO messages(id,conversation_id,sender_id,text,attachment_id,forwarded_from_id,delivered_at)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [newId, conversationId, req.userId, source.text, source.attachment_id, source.id, recipientOnline ? new Date() : null]
        );
        const payload = await messagePayload(newId);
        await broadcastMessageToConversation(conversationId, payload);
        res.json({ message: payload });
        await broadcastChatRefresh([req.userId, targetId]);
        if (!recipientOnline) {
            const sender = await getUser(req.userId);
            await pushNotify(targetId, pushPayloadForMessage(payload, sender));
        }
    } catch {
        res.status(500).json({ error: "Не удалось переслать сообщение." });
    }
});

/* ================================
   BLOCK / REPORT
================================ */

app.post("/api/users/:userId/block", authMiddleware, async (req, res) => {
    if (req.params.userId === req.userId) return res.status(400).json({ error: "Нельзя заблокировать себя." });
    await pool.query(
        "INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [req.userId, req.params.userId]
    );
    res.json({ ok: true });
    await broadcastPresence();
});

app.delete("/api/users/:userId/block", authMiddleware, async (req, res) => {
    await pool.query(
        "DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2",
        [req.userId, req.params.userId]
    );
    res.json({ ok: true });
    await broadcastPresence();
});

app.post("/api/users/:userId/report", authMiddleware, async (req, res) => {
    const reason = clean(req.body.reason, 500) || "Без причины";
    await pool.query(
        "INSERT INTO reports(id,reporter_id,target_id,reason) VALUES($1,$2,$3,$4)",
        [id(), req.userId, req.params.userId, reason]
    );
    res.json({ ok: true });
});

/* ================================
   PUSH
================================ */

app.get("/api/push/public-key", authMiddleware, (req, res) => {
    res.json({ publicKey: vapidReady ? process.env.VAPID_PUBLIC_KEY : "" });
});

app.post("/api/push/subscribe", authMiddleware, async (req, res) => {
    try {
        const sub = req.body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return res.status(400).json({ error: "Некорректная подписка." });
        }
        await pool.query(
            `INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,
            [id(), req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
        );
        res.json({ ok: true });
    } catch {
        res.status(500).json({ error: "Не удалось включить уведомления." });
    }
});

/* ================================
   STATUS
================================ */

app.get("/api/status", async (req, res) => {
    const r = await pool.query("SELECT COUNT(*)::int AS users FROM users");
    res.json({
        online: true,
        users: r.rows[0].users,
        onlineUsers: onlineSockets.size,
        database: true
    });
});

/* ================================
   WEBSOCKET
================================ */

wss.on("connection", ws => {
    ws.isAlive = true;
    ws.authed = false;

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("message", async raw => {
        try {
            const data = JSON.parse(raw.toString());

            if (data.type === "auth") {
                const decoded = verifyToken(String(data.token || ""));
                if (!decoded?.sub) {
                    send(ws, { type: "auth_error", error: "Сессия недействительна." });
                    return ws.close();
                }
                const user = await getUser(decoded.sub);
                if (!user) {
                    send(ws, { type: "auth_error", error: "Пользователь не найден." });
                    return ws.close();
                }
                ws.authed = true;
                ws.userId = user.id;
                addSocket(user.id, ws);
                send(ws, { type: "auth_ok", profile: publicProfile(user, user.id) });
                await broadcastPresence();
                return;
            }

            if (!ws.authed) return;
            const userId = ws.userId;

            if (data.type === "typing") {
                const targetId = String(data.toUserId || "");
                if (!targetId) return;
                const blocked = await blockedBetween(userId, targetId);
                if (blocked.a_blocks_b || blocked.b_blocks_a) return;
                sendToUser(targetId, {
                    type: "typing",
                    fromId: userId,
                    isTyping: Boolean(data.isTyping)
                });
                return;
            }

            if (data.type === "read") {
                const targetId = String(data.withUserId || "");
                const conversationId = await getDirectConversation(userId, targetId);
                if (!conversationId) return;
                const delivered = await pool.query(
                    `UPDATE messages SET delivered_at=COALESCE(delivered_at,NOW())
                     WHERE conversation_id=$1 AND sender_id=$2 AND delivered_at IS NULL AND deleted_at IS NULL
                     RETURNING id`,
                    [conversationId, targetId]
                );
                if (delivered.rows.length) sendToUser(targetId, {type:"receipts",kind:"delivered",messageIds:delivered.rows.map(r=>r.id)});
                const result = await pool.query(
                    `UPDATE messages SET read_at=COALESCE(read_at,NOW())
                     WHERE conversation_id=$1 AND sender_id=$2 AND read_at IS NULL AND deleted_at IS NULL
                     RETURNING id`,
                    [conversationId, targetId]
                );
                await pool.query(
                    "UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2",
                    [conversationId, userId]
                );
                if (result.rows.length) {
                    sendToUser(targetId, {
                        type: "receipts",
                        kind: "read",
                        messageIds: result.rows.map(r => r.id)
                    });
                }
                sendToUser(userId, { type: "chat_refresh" });
                sendToUser(targetId, { type: "chat_refresh" });
                return;
            }

            if (data.type === "send") {
                const targetId = String(data.toUserId || "");
                const text = clean(data.text, 4000);
                const attachmentId = data.attachmentId ? String(data.attachmentId) : null;
                const replyToId = data.replyToId ? String(data.replyToId) : null;

                if (!targetId || (!text && !attachmentId)) return;
                if (targetId === userId) return;
                const target = await getUser(targetId);
                const sender = await getUser(userId);
                if (!target || !sender) return;

                const blocked = await blockedBetween(userId, targetId);
                if (blocked.a_blocks_b || blocked.b_blocks_a) {
                    send(ws, { type: "error", error: "Нельзя отправить сообщение этому пользователю." });
                    return;
                }

                if (replyToId) {
                    const checkReply = await pool.query("SELECT 1 FROM messages WHERE id=$1", [replyToId]);
                    if (!checkReply.rowCount) return;
                }

                if (attachmentId) {
                    const a = await pool.query("SELECT 1 FROM attachments WHERE id=$1 AND owner_id=$2", [attachmentId, userId]);
                    if (!a.rowCount) return;
                }

                const conversationId = await ensureDirectConversation(userId, targetId);
                const messageId = id();
                const deliveredAt = isOnline(targetId) ? new Date() : null;
                await pool.query(
                    `INSERT INTO messages(id,conversation_id,sender_id,text,attachment_id,reply_to_id,delivered_at)
                     VALUES($1,$2,$3,$4,$5,$6,$7)`,
                    [messageId, conversationId, userId, text || null, attachmentId, replyToId, deliveredAt]
                );

                const payload = await messagePayload(messageId);
                await broadcastMessageToConversation(conversationId, payload);
                await broadcastChatRefresh([userId, targetId]);

                if (!isOnline(targetId)) {
                    await pushNotify(targetId, pushPayloadForMessage(payload, sender));
                }
                return;
            }
        } catch (e) {
            console.error("WS message error", e);
            send(ws, { type: "error", error: "Ошибка обработки запроса." });
        }
    });

    ws.on("close", async () => {
        const userId = removeSocket(ws);
        if (userId) await broadcastPresence();
    });
});

const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            try { ws.terminate(); } catch {}
            continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch {}
    }
}, 15000);

wss.on("close", () => clearInterval(heartbeat));

async function init() {
    await pool.query(schema);
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT '#3390ec'").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_status TEXT NOT NULL DEFAULT 'online'").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_online TEXT NOT NULL DEFAULT 'everyone'").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN NOT NULL DEFAULT FALSE").catch(() => {});
    server.listen(PORT, "0.0.0.0", () => {
        console.log(`My Chat running on port ${PORT}`);
        if (!mailer) console.log("SMTP not configured: email sending is disabled.");
        if (!vapidReady) console.log("VAPID not configured: push notifications are disabled.");
    });
}

init().catch(err => {
    console.error("Startup error", err);
    process.exit(1);
});
