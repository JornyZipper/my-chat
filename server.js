'use strict';
// BurmalpticajopaChat backend: original API compatibility + protected owner admin.
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const nodemailer = require('nodemailer');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;
const DATABASE_URL = process.env.DATABASE_URL;
// No hardcoded JWT key: missing JWT_SECRET uses a temporary random key, invalidating sessions on restart.
const JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
    ? process.env.JWT_SECRET : crypto.randomBytes(32).toString('hex');
const APP_URL = (String(process.env.APP_URL || '').trim() || 'https://my-chat-ucw4.onrender.com').replace(/\/+$/, '');
const REQUIRE_EMAIL_VERIFICATION = process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
const VERIFIED_USERNAME = (process.env.VERIFIED_USERNAME || 'Z1pperJ').toLowerCase();
const VERIFIED_CLAIM_CODE = process.env.VERIFIED_CLAIM_CODE || '';
const SUPPORT_ID = 'bpc-official-support';
const SUPPORT_USERNAME = 'BurmalSupport';
const SUPPORT_NORM = 'burmalsupport';
if (!DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(1); }
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.warn('WARNING: Set a strong, stable JWT_SECRET (32+ characters) in Render. Until then, the temporary key makes sessions expire after each restart.');
}
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailer = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
}
const vapidReady = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
if (vapidReady) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
const onlineSockets = new Map();
const wsUsers = new WeakMap();
function id() { return crypto.randomUUID(); }
function norm(value) { return String(value || '').trim().toLowerCase(); }
function clean(value, max) { return String(value || '').trim().slice(0, max); }
// MIME types are sent in HTTP headers and must be ASCII tokens, never arbitrary Unicode.
function safeMediaMime(value, fallback = 'application/octet-stream') {
    const mime = String(value || '').trim();
    return /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime) ? mime : fallback;
}
function validUsername(value) {
    const n = clean(value, 24);
    return n.length >= 2 && n.length <= 24 && /^[\p{L}\p{N}_.-]+$/u.test(n);
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim()); }
function send(ws, data) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
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
    if (set) { set.delete(ws); if (!set.size) onlineSockets.delete(userId); }
    wsUsers.delete(ws);
    return userId;
}
function isOnline(userId) { return onlineSockets.has(userId); }
function verifyToken(token) {
    try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function issueToken(userId) { return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' }); }
let officialOwnerBadgeId = null; // loaded from app_admin_owner; never inferred just from username
function publicProfile(row, viewerId = null) {
    if (!row) return null;
    const online = isOnline(row.id);
    const canShowOnline = row.privacy_online !== 'nobody' || viewerId === row.id;
    const visibleOnline = online && canShowOnline;
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: row.bio || '',
        status: visibleOnline ? (row.presence_status || 'online') : 'offline',
        presenceStatus: row.presence_status || 'online',
        online: online && canShowOnline,
        verified: Boolean(row.verified_badge),
        ownerBadge: Boolean(row.verified_badge && officialOwnerBadgeId === row.id && norm(row.username) === 'z1pperj'),
        privacyOnline: row.privacy_online || 'everyone',
        avatarUrl: row.avatar_data ? `/api/avatar/${row.id}` : '',
        avatarColor: row.avatar_color || '#3390ec',
        createdAt: row.created_at,
        phone: row.official_number || (row.phone_verified && (viewerId === row.id || row.phone_visible) ? (row.phone_e164 || '') : ''),
        officialNumber: row.official_number || '',
        hasOfficialNumber: Boolean(row.official_number),
        ...(viewerId === row.id ? { linkedPhone: row.phone_verified ? (row.phone_e164 || '') : '', callPrivacy: row.call_privacy || 'everyone' } : {}),
        ...(viewerId === row.id ? { phoneVisible: Boolean(row.phone_visible), phoneVerified: Boolean(row.phone_verified) } : {})
    };
}
function pushPayloadForMessage(message, sender) {
    return {
        title: sender.display_name,
        body: message.deleted_at ? 'Сообщение удалено' : (message.text || 'Вложение'),
        icon: sender.avatar_data ? `/api/avatar/${sender.id}` : '/icon.svg',
        badge: '/icon.svg', data: { userId: sender.id }
    };
}
async function pushNotify(recipientId, payload) {
    if (!vapidReady) return;
    const { rows } = await pool.query('SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1', [recipientId]);
    for (const sub of rows) {
        try {
            await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload));
        } catch (err) {
            if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]);
            }
        }
    }
}
async function email(to, subject, html) {
    if (!mailer) return false;
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
    return true;
}
async function createMailToken(userId, type) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
        `INSERT INTO mail_tokens (id,user_id,token,type,expires_at)
         VALUES ($1,$2,$3,$4,NOW()+INTERVAL '30 minutes')`,
        [id(), userId, token, type]
    );
    return token;
}
async function blockedBetween(a, b) {
    const { rows } = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2) AS a_blocks_b,
                EXISTS(SELECT 1 FROM blocks WHERE blocker_id=$2 AND blocked_id=$1) AS b_blocks_a`,
        [a, b]
    );
    return rows[0];
}
async function getUser(idValue) {
    const { rows } = await pool.query(
        `SELECT id,username,username_norm,display_name,password_hash,email,email_verified,
                avatar_data,avatar_mime,avatar_color,bio,presence_status,privacy_online,verified_badge,created_at,phone_e164,phone_visible,phone_verified,official_number,call_privacy
         FROM users WHERE id=$1`,
        [idValue]
    );
    return rows[0] || null;
}
async function getUserByUsername(username) {
    const { rows } = await pool.query(
        `SELECT id,username,username_norm,display_name,password_hash,email,email_verified,
                avatar_data,avatar_mime,avatar_color,bio,presence_status,privacy_online,verified_badge,created_at,phone_e164,phone_visible,phone_verified,official_number,call_privacy
         FROM users WHERE username_norm=$1`,
        [norm(username)]
    );
    return rows[0] || null;
}
async function isMember(conversationId, userId) {
    const { rowCount } = await pool.query(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [conversationId, userId]
    );
    return rowCount > 0;
}
async function getDirectConversation(a, b) {
    const { rows } = await pool.query(
        `SELECT c.id FROM conversations c
         JOIN conversation_members x ON x.conversation_id=c.id AND x.user_id=$1
         JOIN conversation_members y ON y.conversation_id=c.id AND y.user_id=$2
         WHERE c.type='direct' LIMIT 1`, [a, b]
    );
    return rows[0]?.id || null;
}
async function ensureDirectConversation(a, b) {
    let conversationId = await getDirectConversation(a, b);
    if (conversationId) return conversationId;
    conversationId = id();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('INSERT INTO conversations (id,type) VALUES ($1,\'direct\')', [conversationId]);
        await client.query(
            'INSERT INTO conversation_members (conversation_id,user_id) VALUES ($1,$2),($1,$3)',
            [conversationId, a, b]
        );
        await client.query('COMMIT');
        return conversationId;
    } catch (error) {
        await client.query('ROLLBACK');
        const retry = await getDirectConversation(a, b);
        if (retry) return retry;
        throw error;
    } finally { client.release(); }
}
async function broadcastPresence() {
    const { rows } = await pool.query(
        `SELECT id,username,display_name,avatar_data,bio,presence_status,
                privacy_online,verified_badge,created_at,phone_e164,phone_visible,phone_verified,official_number,call_privacy
         FROM users ORDER BY username_norm`
    );
    for (const userId of onlineSockets.keys()) {
        const owner = rows.some(r => r.id === userId && norm(r.username) === VERIFIED_USERNAME);
        let allowed = null;
        if (!owner) {
            const contacts = await pool.query(`SELECT DISTINCT other.user_id FROM conversation_members mine
                JOIN conversation_members other ON other.conversation_id=mine.conversation_id
                WHERE mine.user_id=$1 AND other.user_id<>$1`, [userId]);
            allowed = new Set(contacts.rows.map(r => r.user_id));
        }
        const visible = owner ? rows : rows.filter(r => allowed.has(r.id));
        sendToUser(userId, { type: 'users', users: visible.map(r => publicProfile(r, userId)) });
    }
}
async function broadcastChatRefresh(userIds) {
    for (const userId of new Set(userIds)) sendToUser(userId, { type: 'chat_refresh' });
}
async function messagePayload(messageId) {
    const { rows } = await pool.query(
        `SELECT m.id,m.conversation_id,m.sender_id,m.text,m.created_at,m.edited_at,m.deleted_at,
                m.delivered_at,m.read_at,m.reply_to_id,m.forwarded_from_id,
                u.username AS sender_username,u.display_name AS sender_display_name,u.verified_badge AS sender_verified,
                a.id AS attachment_id,a.filename AS attachment_filename,a.mime_type AS attachment_mime,a.size AS attachment_size,
                rm.text AS reply_text,ru.username AS reply_username,rj.reactions
         FROM messages m
         JOIN users u ON u.id=m.sender_id
         LEFT JOIN attachments a ON a.id=m.attachment_id
         LEFT JOIN messages rm ON rm.id=m.reply_to_id
         LEFT JOIN users ru ON ru.id=rm.sender_id
         LEFT JOIN LATERAL (
             SELECT COALESCE(json_agg(json_build_object('emoji',r.emoji,'userId',r.user_id)), '[]'::json) AS reactions
             FROM reactions r WHERE r.message_id=m.id
         ) rj ON TRUE WHERE m.id=$1`, [messageId]
    );
    if (!rows[0]) return null;
    const m = rows[0];
    return {
        id: m.id, conversationId: m.conversation_id, senderId: m.sender_id,
        senderUsername: m.sender_username, senderDisplayName: m.sender_display_name,
        senderVerified: Boolean(m.sender_verified),
        text: m.deleted_at ? 'Сообщение удалено' : (m.text || ''),
        deleted: Boolean(m.deleted_at), edited: Boolean(m.edited_at),
        createdAt: m.created_at, editedAt: m.edited_at,
        deliveredAt: m.delivered_at, readAt: m.read_at,
        replyTo: m.reply_to_id ? { id: m.reply_to_id, text: m.reply_text || '', username: m.reply_username || '' } : null,
        forwarded: Boolean(m.forwarded_from_id),
        attachment: m.attachment_id ? {
            id: m.attachment_id, filename: m.attachment_filename,
            mime: m.attachment_mime, size: Number(m.attachment_size || 0),
            url: `/api/media/${m.attachment_id}`
        } : null,
        reactions: m.reactions || []
    };
}
async function broadcastMessageToConversation(conversationId, message) {
    const { rows } = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1', [conversationId]);
    for (const row of rows) {
        const hidden=await pool.query('SELECT 1 FROM message_hidden_for WHERE message_id=$1 AND user_id=$2',[message.id,row.user_id]);
        if(!hidden.rowCount)sendToUser(row.user_id,{type:'message',message});
    }
}
function authMiddleware(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const decoded = verifyToken(token);
    if (!decoded?.sub) return res.status(401).json({ error: 'Не авторизован.' });
    req.userId = decoded.sub;
    next();
}

// The admin implementation is embedded so GitHub needs only this server.js file.


// Admin routes for BurmalpticajopaChat's existing Express/PostgreSQL backend.
// They authorize the stored immutable owner account ID, not an editable username.



function createOwnerAdmin({ pool, authMiddleware, broadcastPresence, verifiedUsername = 'z1pperj', claimCode = '' }) {
  if (!pool || !authMiddleware || typeof broadcastPresence !== 'function') {
    throw new Error('owner-admin: pool, authMiddleware and broadcastPresence are required');
  }
  const router = express.Router();
  const ownerUsername = String(verifiedUsername).trim().toLowerCase();
  const code = String(claimCode || '');

  async function init() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_admin_owner (
        slot SMALLINT PRIMARY KEY CHECK(slot=1),
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    officialOwnerBadgeId = await currentOwnerId();
  }

  async function currentOwnerId() {
    const { rows } = await pool.query('SELECT user_id FROM app_admin_owner WHERE slot=1 LIMIT 1');
    return rows[0]?.user_id || null;
  }
  async function profileForId(userId) {
    const { rows } = await pool.query(
      'SELECT id, username, username_norm, verified_badge FROM users WHERE id=$1 LIMIT 1', [userId]
    );
    return rows[0] || null;
  }
  async function isRealOwner(userId) {
    const [ownerId, user] = await Promise.all([currentOwnerId(), profileForId(userId)]);
    return Boolean(ownerId && ownerId === userId && user && user.username_norm === ownerUsername && user.verified_badge);
  }

  function safeMatches(received, expected) {
    const a = crypto.createHash('sha256').update(String(received)).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // Claim endpoint is intentionally restricted, with a simple per-IP throttle.
  const claimAttempts = new Map();
  function rateLimitClaim(req, res, next) {
    const key = String(req.ip || 'unknown');
    const now = Date.now();
    for (const [ip, item] of claimAttempts) if (item.resetAt <= now) claimAttempts.delete(ip);
    let item = claimAttempts.get(key);
    if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + 15 * 60 * 1000 };
    item.count += 1;
    claimAttempts.set(key, item);
    if (item.count > 6) return res.status(429).json({ error: 'Слишком много попыток. Повтори позже.' });
    next();
  }

  router.use(authMiddleware);

  router.get('/me', async (req, res) => {
    try { res.json({ isAdmin: await isRealOwner(req.userId) }); }
    catch (error) { console.error('admin/me:', error); res.status(500).json({ error: 'Не удалось проверить права.' }); }
  });

  router.post('/claim', rateLimitClaim, async (req, res) => {
    try {
      const user = await profileForId(req.userId);
      if (!user || user.username_norm !== ownerUsername) {
        return res.status(403).json({ error: 'Активация доступна только аккаунту @Z1pperJ.' });
      }
      if (await isRealOwner(req.userId)) return res.json({ ok: true, isAdmin: true });
      if (await currentOwnerId()) return res.status(409).json({ error: 'Владелец уже назначен. Нельзя назначить другого.' });
      const submitted = String(req.body?.claimCode || '');
      if (!code || code.length < 16) {
        return res.status(503).json({ error: 'Настрой VERIFIED_CLAIM_CODE длиной не менее 16 символов в Render.' });
      }
      if (!submitted || !safeMatches(submitted, code)) {
        return res.status(403).json({ error: 'Неверный код владельца.' });
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          'INSERT INTO app_admin_owner(slot,user_id) VALUES(1,$1) ON CONFLICT DO NOTHING RETURNING user_id',
          [req.userId]
        );
        if (!inserted.rowCount) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Владелец уже назначен.' });
        }
        // On older databases the reserved account can exist without its badge.
        // The authenticated account + matching secret claim both the admin slot and badge.
        await client.query('UPDATE users SET verified_badge=TRUE WHERE id=$1', [req.userId]);
        await client.query('COMMIT');
        officialOwnerBadgeId = req.userId;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      res.json({ ok: true, isAdmin: true });
      Promise.resolve(broadcastPresence()).catch(error => console.error('admin presence:', error));
    } catch (error) { console.error('admin/claim:', error); res.status(500).json({ error: 'Не удалось активировать владельца.' }); }
  });

  async function requireOwner(req, res, next) {
    try {
      if (!(await isRealOwner(req.userId))) return res.status(403).json({ error: 'Только владелец может управлять галочками.' });
      next();
    } catch (error) { console.error('admin/auth:', error); res.status(500).json({ error: 'Не удалось проверить права.' }); }
  }

  router.get('/users', requireOwner, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().replace(/^@/, '').slice(0, 50).toLowerCase();
      const { rows } = await pool.query(
        `SELECT id,username,display_name,verified_badge,avatar_color,
                (avatar_data IS NOT NULL) AS has_avatar
         FROM users
         WHERE ($1 = '' OR username_norm LIKE $2 OR lower(display_name) LIKE $2)
         ORDER BY username_norm LIMIT 100`,
        [q, `%${q}%`]
      );
      const ownerId = await currentOwnerId();
      res.json({ users: rows.map(u => ({
        id: u.id, username: u.username, displayName: u.display_name,
        verified: u.verified_badge, isOwner: u.id === ownerId,
        avatarColor: u.avatar_color,
        avatarUrl: u.has_avatar ? `/api/avatar/${encodeURIComponent(u.id)}` : ''
      })) });
    } catch (error) { console.error('admin/users:', error); res.status(500).json({ error: 'Не удалось загрузить пользователей.' }); }
  });

  router.patch('/users/:userId/verified', requireOwner, async (req, res) => {
    try {
      if (typeof req.body?.verified !== 'boolean') return res.status(400).json({ error: 'verified должен быть true либо false.' });
      if (req.params.userId === await currentOwnerId()) return res.status(403).json({ error: 'Галочку владельца нельзя изменять.' });
      const result = await pool.query(
        'UPDATE users SET verified_badge=$1 WHERE id=$2 RETURNING id,username,verified_badge',
        [req.body.verified, req.params.userId]
      );
      if (!result.rowCount) return res.status(404).json({ error: 'Пользователь не найден.' });
      res.json({ ok: true, user: {
        id: result.rows[0].id, username: result.rows[0].username,
        verified: result.rows[0].verified_badge
      }});
      Promise.resolve(broadcastPresence()).catch(error => console.error('admin presence:', error));
    } catch (error) { console.error('admin/verified:', error); res.status(500).json({ error: 'Не удалось изменить галочку.' }); }
  });


  // Official +888 identifiers: owner approval, support DM with one-time code.
  router.get('/official-numbers', requireOwner, async (_req, res) => {
    try {
      const { rows } = await pool.query(`SELECT r.id,r.number,r.status,r.created_at,r.approved_at,
         u.id AS user_id,u.username,u.display_name FROM official_number_requests r
         JOIN users u ON u.id=r.user_id ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 150`);
      res.json({ requests: rows.map(r => ({ id:r.id,number:r.number,status:r.status,userId:r.user_id,
         username:r.username,displayName:r.display_name,createdAt:r.created_at,approvedAt:r.approved_at })) });
    } catch(e) { console.error('official admin list:',e);res.status(500).json({error:'Ошибка загрузки заявок.'}); }
  });
  router.post('/official-numbers/:requestId/approve', requireOwner, async (req,res) => {
    try {
      const answer=await approveOfficialRequest(req.params.requestId,req.userId,false);
      res.json(answer);
    } catch(e) { officialError(res,e,'Не удалось одобрить заявку.'); }
  });
  router.post('/official-numbers/:requestId/resend', requireOwner, async (req,res) => {
    try { res.json(await approveOfficialRequest(req.params.requestId,req.userId,true)); }
    catch(e) { officialError(res,e,'Не удалось отправить новый код.'); }
  });
  router.post('/official-numbers/:requestId/reject', requireOwner, async (req,res) => {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const result=await client.query(`UPDATE official_number_requests
        SET status='rejected',code_hash=NULL,code_salt=NULL,code_expires_at=NULL,updated_at=NOW()
        WHERE id=$1 AND status='pending' RETURNING user_id,number`,[req.params.requestId]);
      if (!result.rowCount) { await client.query('ROLLBACK');return res.status(409).json({error:'Заявка уже рассмотрена.'}); }
      await client.query('COMMIT');
      sendToUser(result.rows[0].user_id,{type:'official_number_update',status:'rejected'});
      res.json({ok:true});
    } catch(e) { await client.query('ROLLBACK').catch(()=>{});officialError(res,e,'Не удалось отклонить заявку.'); }
    finally {client.release();}
  });

  return { router, init };
};

const ownerAdmin = createOwnerAdmin({
    pool, authMiddleware, broadcastPresence,
    verifiedUsername: VERIFIED_USERNAME, claimCode: VERIFIED_CLAIM_CODE
});
app.use('/api/admin', ownerAdmin.router);


/* ================================
   OFFICIAL +888 NUMBERS (IN-APP IDENTIFIERS, NOT SMS OR REAL PHONE NUMBERS)
   Admin approves; one-time code delivered only through system Support DM.
================================ */
function officialError(res,e,fallback) {
    if (e?.publicStatus) return res.status(e.publicStatus).json({error:e.message});
    if (e?.code === '23505') return res.status(409).json({error:'Номер уже занят или у тебя есть активная заявка.'});
    console.error('Official number:',e);
    return res.status(500).json({error:fallback});
}
function officialFail(status,message){const e=new Error(message);e.publicStatus=status;return e;}
function officialCodeDigest(requestId,salt,code){return crypto.createHmac('sha256',JWT_SECRET).update(`${requestId}:${salt}:${code}`).digest('hex');}
function officialValidNumber(input){return /^\d{8}$/.test(String(input||''));}
const officialRequestThrottle = new Map();
function officialLimited(userId) {
    const now=Date.now();
    if (officialRequestThrottle.size>5000) for(const [k,v] of officialRequestThrottle) if(v.until<now)officialRequestThrottle.delete(k);
    const record=officialRequestThrottle.get(userId)||{until:now+86400000,count:0};
    if(record.until<=now){record.until=now+86400000;record.count=0;}
    record.count++;officialRequestThrottle.set(userId,record);
    return record.count<=5;
}
async function sendOfficialSupportMessage(userId,textValue){
    const conversationId=await ensureDirectConversation(SUPPORT_ID,userId);
    const messageId=id();
    await pool.query(`INSERT INTO messages(id,conversation_id,sender_id,text,delivered_at)
      VALUES($1,$2,$3,$4,$5)`,[messageId,conversationId,SUPPORT_ID,textValue,isOnline(userId)?new Date():null]);
    const payload=await messagePayload(messageId);
    await broadcastMessageToConversation(conversationId,payload);
    await broadcastChatRefresh([userId]);
    try { await pushNotify(userId,{title:'Поддержка BurmalpticajopaChat',body:'Новое сообщение о номере +888',data:{userId:SUPPORT_ID}}); } catch(e){console.error('Official push:',e);}
}
async function approveOfficialRequest(requestId,ownerId,resend){
    if(!/^[0-9a-f-]{36}$/.test(String(requestId||''))) throw officialFail(400,'Неверный ID заявки.');
    const client=await pool.connect();
    let result;
    let code;
    try {
      await client.query('BEGIN');
      const locked=await client.query(`SELECT * FROM official_number_requests WHERE id=$1 FOR UPDATE`,[requestId]);
      const row=locked.rows[0];
      if(!row || row.status!==(resend?'approved':'pending')) throw officialFail(409,'Заявка недоступна для этого действия.');
      const ownerOfNumber=await client.query('SELECT id FROM users WHERE official_number=$1',[row.number]);
      if(ownerOfNumber.rowCount) throw officialFail(409,'Номер уже привязан.');
      code=String(crypto.randomInt(0,100000000)).padStart(8,'0');
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=officialCodeDigest(row.id,salt,code);
      const approved=await client.query(`UPDATE official_number_requests
          SET status='approved',approved_by=$2,approved_at=COALESCE(approved_at,NOW()),
          code_hash=$3,code_salt=$4,code_expires_at=NOW()+INTERVAL '24 hours',code_attempts=0,updated_at=NOW()
          WHERE id=$1 RETURNING user_id,number`,[row.id,ownerId,hash,salt]);
      result=approved.rows[0];
      await client.query('COMMIT');
    } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;}
    finally {client.release();}
    // Approval is committed before DM; if sending fails, owner can press "Send code again".
    await sendOfficialSupportMessage(result.user_id,
        `Твоя заявка на внутренний номер ${result.number} одобрена. Код подтверждения: ${code}. `+
        'Действует 24 часа. Открой Профиль → Настройки → Официальный номер и введи этот номер с кодом. Никому не сообщай код.');
    sendToUser(result.user_id,{type:'official_number_update',status:'approved'});
    return {ok:true,message:'Код отправлен пользователю в личные сообщения от поддержки.'};
}
app.get('/api/official-number/me',authMiddleware,async(req,res)=>{
  try {
    const user=await getUser(req.userId);
    if(!user)return res.status(401).json({error:'Аккаунт не найден.'});
    const {rows}=await pool.query(`SELECT id,number,status,created_at,code_expires_at
      FROM official_number_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,[req.userId]);
    res.json({officialNumber:user.official_number||'',request:rows[0]?{
      id:rows[0].id,number:rows[0].number,status:rows[0].status,
      createdAt:rows[0].created_at,codeExpiresAt:rows[0].code_expires_at
    }:null});
  }catch(e){officialError(res,e,'Не удалось загрузить номер.');}
});
app.post('/api/official-number/request',authMiddleware,async(req,res)=>{
  const digits=String(req.body?.digits||'').trim();
  if(!officialValidNumber(digits))return res.status(400).json({error:'Введи ровно 8 цифр после +888.'});
  if(!officialLimited(req.userId))return res.status(429).json({error:'Слишком много заявок. Повтори завтра.'});
  try {
    const account=await getUser(req.userId);
    if(!account || req.userId===SUPPORT_ID)return res.status(403).json({error:'Недоступно для аккаунта.'});
    if(account.official_number)return res.status(409).json({error:'К аккаунту уже привязан официальный номер.'});
    const number='+888'+digits;
    const taken=await pool.query('SELECT 1 FROM users WHERE official_number=$1',[number]);
    if(taken.rowCount)return res.status(409).json({error:'Этот номер уже занят.'});
    const requestId=id();
    await pool.query('INSERT INTO official_number_requests(id,user_id,number) VALUES($1,$2,$3)',[requestId,req.userId,number]);
    const owner=await pool.query('SELECT user_id FROM app_admin_owner WHERE slot=1');
    if(owner.rows[0]?.user_id) {
      const ownerId=owner.rows[0].user_id;
      sendToUser(ownerId,{type:'official_number_new_request',requestId});
      // A real private chat notification, not only an unhandled WebSocket event.
      sendOfficialSupportMessage(ownerId,`Новая заявка на внутренний номер ${number}. Пользователь: @${account.username}. Открой админ-панель → Заявки +888.`)
        .catch(err=>console.error('Owner request notification:',err));
    }
    res.status(201).json({ok:true,request:{id:requestId,number,status:'pending'},message:'Запрос отправлен владельцу.'});
  }catch(e){officialError(res,e,'Не удалось отправить запрос.');}
});
app.post('/api/official-number/cancel',authMiddleware,async(req,res)=>{
  try {
    const r=await pool.query(`UPDATE official_number_requests
      SET status='cancelled',code_hash=NULL,code_salt=NULL,updated_at=NOW()
      WHERE user_id=$1 AND status='pending' RETURNING id`,[req.userId]);
    if(!r.rowCount)return res.status(409).json({error:'Нет ожидающей заявки для отмены.'});
    res.json({ok:true});
  }catch(e){officialError(res,e,'Не удалось отменить заявку.');}
});
app.post('/api/official-number/confirm',authMiddleware,async(req,res)=>{
    const number=String(req.body?.number||'').trim();
    const code=String(req.body?.code||'').trim();
    if(!/^\+888\d{8}$/.test(number)|| !/^\d{8}$/.test(code))return res.status(400).json({error:'Нужен номер +888 и 8-значный код из чата поддержки.'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const {rows}=await client.query(`SELECT * FROM official_number_requests
          WHERE user_id=$1 AND number=$2 AND status='approved' FOR UPDATE`,[req.userId,number]);
      const r=rows[0];
      if(!r)throw officialFail(404,'Одобренной заявки с таким номером нет.');
      if(!r.code_expires_at || new Date(r.code_expires_at).getTime()<=Date.now())throw officialFail(410,'Код истёк. Попроси владельца отправить новый.');
      if(r.code_attempts>=5)throw officialFail(429,'Попытки исчерпаны. Попроси новый код у владельца.');
      const hash=officialCodeDigest(r.id,r.code_salt,code);
      if(!crypto.timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(r.code_hash,'hex'))){
         await client.query('UPDATE official_number_requests SET code_attempts=code_attempts+1 WHERE id=$1',[r.id]);
         await client.query('COMMIT');
         return res.status(400).json({error:'Неверный код.'});
      }
      const occupied=await client.query('SELECT id FROM users WHERE official_number=$1',[number]);
      if(occupied.rowCount)throw officialFail(409,'Номер уже занят.');
      await client.query('UPDATE users SET official_number=$1 WHERE id=$2 AND official_number IS NULL',[number,req.userId]);
      await client.query(`UPDATE official_number_requests SET status='active',code_hash=NULL,code_salt=NULL,
          code_expires_at=NULL,updated_at=NOW() WHERE id=$1`,[r.id]);
      await client.query('COMMIT');
      sendToUser(req.userId,{type:'official_number_update',status:'active'});
      const profile=publicProfile(await getUser(req.userId),req.userId);
      res.json({ok:true,profile});
    }catch(e){await client.query('ROLLBACK').catch(()=>{});officialError(res,e,'Не удалось привязать номер.');}
    finally {client.release();}
});

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
  phone_e164 TEXT UNIQUE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_visible BOOLEAN NOT NULL DEFAULT FALSE,
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
  client_message_id TEXT,
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
CREATE TABLE IF NOT EXISTS pending_phone_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
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
app.post('/api/auth/register', async (req, res) => {
    try {
        const username = clean(req.body.username, 24);
        const displayName = clean(req.body.displayName, 40);
        const emailValue = clean(req.body.email, 120).toLowerCase();
        const password = String(req.body.password || '');
        const claimCode = String(req.body.claimCode || '');
        const confirm = req.body.passwordConfirm;

        if (!validUsername(username)) return res.status(400).json({ error: 'Неверный username.' });
        if (norm(username) === SUPPORT_NORM) return res.status(403).json({ error: 'Это имя зарезервировано для поддержки.' });
        if (displayName.length < 1) return res.status(400).json({ error: 'Введите имя.' });
        if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
        // Desktop clients send passwordConfirm; older browser clients do not yet have this field.
        // Validate it when present, without breaking registration on the current website.
        if (confirm !== undefined && String(confirm) !== password) {
            return res.status(400).json({ error: 'Пароли не совпадают.' });
        }
        if (!validEmail(emailValue)) return res.status(400).json({ error: 'Введите корректный email.' });

        const special = norm(username) === VERIFIED_USERNAME;
        if (special && (VERIFIED_CLAIM_CODE.length < 16 || claimCode !== VERIFIED_CLAIM_CODE)) {
            return res.status(403).json({ error: 'Для @Z1pperJ требуется код подтверждения владельца.' });
        }
        const existing = await getUserByUsername(username);
        if (existing) return res.status(409).json({ error: 'Этот username уже занят.' });
        const emailExisting = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [emailValue]);
        if (emailExisting.rowCount) return res.status(409).json({ error: 'Этот email уже зарегистрирован.' });

        const userId = id();
        const passwordHash = await bcrypt.hash(password, 12);
        const emailVerified = !REQUIRE_EMAIL_VERIFICATION;
        await pool.query(
            `INSERT INTO users (id,username,username_norm,display_name,password_hash,email,email_verified,verified_badge)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [userId, username, norm(username), displayName, passwordHash, emailValue, emailVerified, special]
        );
        if (REQUIRE_EMAIL_VERIFICATION) {
            const token = await createMailToken(userId, 'verify_email');
            const url = `${APP_URL || ''}/?verify=${encodeURIComponent(token)}`;
            try {
                await email(emailValue, 'Подтверждение BurmalpticajopaChat',
                    `<p>Привет, ${displayName}!</p><p>Нажми <a href="${url}">здесь</a>, чтобы подтвердить email.</p>`);
            } catch (mailError) { console.error('Mail error:', mailError.message); }
        }
        const user = await getUser(userId);
        if (!emailVerified) {
            return res.json({ verificationRequired: true,
                message: mailer ? 'Проверь email для завершения регистрации.' : 'REQUIRE_EMAIL_VERIFICATION включён, но SMTP не настроен. Настрой SMTP в Render.' });
        }
        const token = issueToken(userId);
        res.json({ token, profile: publicProfile(user, userId) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка регистрации.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const username = clean(req.body.username, 24);
        const password = String(req.body.password || '');
        const user = await getUserByUsername(username);
        if (!user || user.id === SUPPORT_ID) return res.status(401).json({ error: 'Неверный username или пароль.' });
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) return res.status(401).json({ error: 'Неверный username или пароль.' });
        if (REQUIRE_EMAIL_VERIFICATION && !user.email_verified) return res.status(403).json({ error: 'Сначала подтверди email.' });
        res.json({ token: issueToken(user.id), profile: publicProfile(user, user.id) });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Ошибка входа.' }); }
});
/* ================================
   PHONE AUTH: Twilio Verify, never send or store raw verification codes.
   Legacy username/password login remains available.
================================ */
const PHONE_VERIFY_READY = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
const smsLimits = new Map();
function phoneValue(input) {
    const value = String(input || '').replace(/[()\s-]/g, '');
    // +888 is only a BurmalpticajopaChat internal identifier, never an SMS destination.
    if (/^\+888\d{8}$/.test(value)) return null;
    return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
}
function limitPhoneRequest(req, phone, action, max = 5) {
    const key = crypto.createHash('sha256').update([String(req.ip), phone, action].join(':')).digest('hex');
    const now = Date.now();
    if (smsLimits.size > 5000) for (const [k,v] of smsLimits) if (now > v.until) smsLimits.delete(k);
    const prior = smsLimits.get(key);
    const next = prior && prior.until > now ? prior : { count: 0, until: now + 15 * 60 * 1000 };
    next.count++;
    smsLimits.set(key, next);
    return next.count <= max;
}
async function twilioVerify(endpoint, values) {
    if (!PHONE_VERIFY_READY) throw Object.assign(new Error('SMS-вход пока не подключён администратором сервера.'), { status: 503 });
    const account = process.env.TWILIO_ACCOUNT_SID;
    const service = process.env.TWILIO_VERIFY_SERVICE_SID;
    const url = `https://verify.twilio.com/v2/Services/${encodeURIComponent(service)}/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(account + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64') },
            body: new URLSearchParams(values).toString(), signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.warn('Twilio Verify response', response.status, body.code || '');
            throw Object.assign(new Error('SMS не удалось отправить или проверить. Проверь номер и попробуй позже.'), { status: response.status === 429 ? 429 : 502 });
        }
        return body;
    } finally { clearTimeout(timeout); }
}
function phoneErr(res, error) {
    if (error && error.status === 503) return res.status(503).json({ error: error.message });
    console.warn('SMS error:', error && error.message);
    return res.status(error?.status === 429 ? 429 : 502).json({ error: 'Ошибка сервиса SMS. Попробуй позже.' });
}
app.post('/api/profile/phone/start', authMiddleware, async (req, res) => {
    const phone = phoneValue(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Введи номер в международном формате, например +380XXXXXXXXX.' });
    if (!limitPhoneRequest(req, phone, 'link') || !limitPhoneRequest(req, 'all-phones', 'global-send', 12)) return res.status(429).json({ error: 'Слишком часто. Подожди 15 минут.' });
    try {
        const existing = await pool.query('SELECT id FROM users WHERE phone_e164=$1 AND phone_verified=TRUE AND id<>$2', [phone, req.userId]);
        if (existing.rowCount) return res.status(409).json({ error: 'Номер уже привязан к другому аккаунту.' });
        await twilioVerify('Verifications', { To: phone, Channel: 'sms' });
        await pool.query(`INSERT INTO pending_phone_links(user_id,phone_e164,expires_at)
            VALUES ($1,$2,NOW()+INTERVAL '10 minutes') ON CONFLICT(user_id)
            DO UPDATE SET phone_e164=EXCLUDED.phone_e164,expires_at=EXCLUDED.expires_at`, [req.userId, phone]);
        res.json({ ok: true, message: 'SMS-код отправлен.' });
    } catch (error) { phoneErr(res, error); }
});
app.post('/api/profile/phone/confirm', authMiddleware, async (req, res) => {
    const code = String(req.body.code || '').trim();
    if (!/^\d{4,8}$/.test(code)) return res.status(400).json({ error: 'Введи код из SMS.' });
    if (!limitPhoneRequest(req, req.userId, 'link-check', 10)) return res.status(429).json({ error: 'Слишком много попыток. Подожди.' });
    try {
        const pending = await pool.query('SELECT phone_e164 FROM pending_phone_links WHERE user_id=$1 AND expires_at>NOW()', [req.userId]);
        if (!pending.rows[0]) return res.status(400).json({ error: 'Запрос кода истёк. Отправь код заново.' });
        const phone = pending.rows[0].phone_e164;
        const checked = await twilioVerify('VerificationCheck', { To: phone, Code: code });
        if (checked.status !== 'approved') return res.status(400).json({ error: 'Неверный или истёкший SMS-код.' });
        const changed = await pool.query(`UPDATE users SET phone_e164=$1,phone_verified=TRUE,phone_visible=FALSE
              WHERE id=$2 AND NOT EXISTS(SELECT 1 FROM users WHERE phone_e164=$1 AND phone_verified=TRUE AND id<>$2)`, [phone, req.userId]);
        if (!changed.rowCount) return res.status(409).json({ error: 'Номер уже занят.' });
        await pool.query('DELETE FROM pending_phone_links WHERE user_id=$1', [req.userId]);
        res.json({ ok: true, profile: publicProfile(await getUser(req.userId), req.userId) });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Номер уже занят.' });
        phoneErr(res, error);
    }
});
app.post('/api/auth/phone/start', async (req, res) => {
    const phone = phoneValue(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Введи международный номер с + и кодом страны.' });
    if (!PHONE_VERIFY_READY) return res.status(503).json({ error: 'SMS-вход пока не настроен на сервере.' });
    if (!limitPhoneRequest(req, phone, 'login') || !limitPhoneRequest(req, 'all-phones', 'global-send', 12)) return res.status(429).json({ error: 'Слишком часто. Подожди 15 минут.' });
    try {
        const found = await pool.query('SELECT id FROM users WHERE phone_e164=$1 AND phone_verified=TRUE', [phone]);
        if (found.rowCount) await twilioVerify('Verifications', { To: phone, Channel: 'sms' });
        // Same response regardless of whether the number belongs to an account.
        res.json({ ok: true, message: 'Если номер привязан к аккаунту, SMS отправлено.' });
    } catch (error) { phoneErr(res, error); }
});
app.post('/api/auth/phone/verify', async (req, res) => {
    const phone = phoneValue(req.body.phone);
    const code = String(req.body.code || '').trim();
    if (!phone || !/^\d{4,8}$/.test(code)) return res.status(400).json({ error: 'Неверный номер или код.' });
    if (!limitPhoneRequest(req, phone, 'login-check', 10)) return res.status(429).json({ error: 'Слишком много попыток.' });
    try {
        const found = await pool.query('SELECT id FROM users WHERE phone_e164=$1 AND phone_verified=TRUE', [phone]);
        if (!found.rows[0]) return res.status(401).json({ error: 'Неверный или истёкший код.' });
        const checked = await twilioVerify('VerificationCheck', { To: phone, Code: code });
        if (checked.status !== 'approved') return res.status(401).json({ error: 'Неверный или истёкший код.' });
        const user = await getUser(found.rows[0].id);
        if (!user || (REQUIRE_EMAIL_VERIFICATION && !user.email_verified)) return res.status(403).json({ error: 'Аккаунт недоступен.' });
        res.json({ token: issueToken(user.id), profile: publicProfile(user, user.id) });
    } catch (error) { phoneErr(res, error); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'Профиль не найден.' });
    res.json({ profile: publicProfile(user, req.userId), email: user.email || '', emailVerified: user.email_verified });
});
app.get('/api/auth/verify', async (req, res) => {
    try {
        const token = clean(req.query.token, 128);
        const { rows } = await pool.query(
            `SELECT * FROM mail_tokens WHERE token=$1 AND type='verify_email' AND used=FALSE AND expires_at>NOW() LIMIT 1`,
            [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Ссылка недействительна или устарела.' });
        await pool.query('UPDATE users SET email_verified=TRUE WHERE id=$1', [rows[0].user_id]);
        await pool.query('UPDATE mail_tokens SET used=TRUE WHERE id=$1', [rows[0].id]);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Не удалось подтвердить email.' }); }
});
app.post('/api/auth/forgot', async (req, res) => {
    try {
        const emailValue = clean(req.body.email, 120).toLowerCase();
        const { rows } = await pool.query('SELECT id,display_name FROM users WHERE lower(email)=lower($1) LIMIT 1', [emailValue]);
        if (rows[0] && mailer) {
            const token = await createMailToken(rows[0].id, 'reset_password');
            const url = `${APP_URL || ''}/?reset=${encodeURIComponent(token)}`;
            await email(emailValue, 'Сброс пароля BurmalpticajopaChat',
                `<p>Привет!</p><p>Сбросить пароль можно <a href="${url}">по этой ссылке</a>. Ссылка действует 30 минут.</p>`);
        }
        res.json({ message: 'Если такой email существует, инструкция отправлена.' });
    } catch { res.json({ message: 'Если такой email существует, инструкция отправлена.' }); }
});
app.post('/api/auth/reset', async (req, res) => {
    try {
        const token = clean(req.body.token, 128);
        const password = String(req.body.password || '');
        if (password.length < 8) return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов.' });
        const { rows } = await pool.query(
            `SELECT * FROM mail_tokens WHERE token=$1 AND type='reset_password' AND used=FALSE AND expires_at>NOW() LIMIT 1`,
            [token]
        );
        if (!rows[0]) return res.status(400).json({ error: 'Ссылка недействительна или устарела.' });
        const hash = await bcrypt.hash(password, 12);
        await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
        await pool.query('UPDATE mail_tokens SET used=TRUE WHERE id=$1', [rows[0].id]);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Не удалось изменить пароль.' }); }
});

/* ================================
   PROFILE
================================ */
app.get('/api/profile', authMiddleware, async (req, res) => {
    const user = await getUser(req.userId);
    if (!user) return res.status(404).json({ error: 'Профиль не найден.' });
    res.json({ profile: publicProfile(user, req.userId), email: user.email || '', emailVerified: user.email_verified });
});
app.patch('/api/profile', authMiddleware, async (req, res) => {
    try {
        const user = await getUser(req.userId);
        if (!user) return res.status(404).json({ error: 'Профиль не найден.' });
        const username = clean(req.body.username, 24);
        const displayName = clean(req.body.displayName, 40);
        const bio = clean(req.body.bio, 160);
        const avatarColor = /^#[0-9a-fA-F]{6}$/.test(String(req.body.avatarColor || ''))
            ? String(req.body.avatarColor) : (user.avatar_color || '#3390ec');
        const presenceStatus = ['online','away','dnd'].includes(req.body.presenceStatus)
            ? req.body.presenceStatus : user.presence_status;
        const privacyOnline = ['everyone','nobody'].includes(req.body.privacyOnline)
            ? req.body.privacyOnline : user.privacy_online;
        const callPrivacy = ['everyone','contacts','nobody'].includes(req.body.callPrivacy)
            ? req.body.callPrivacy : (user.call_privacy || 'everyone');
        if (!validUsername(username)) return res.status(400).json({ error: 'Неверный username.' });
        if (norm(username) === SUPPORT_NORM) return res.status(403).json({ error: 'Это имя зарезервировано для поддержки.' });
        if (!displayName) return res.status(400).json({ error: 'Имя не может быть пустым.' });
        const existing = await getUserByUsername(username);
        if (existing && existing.id !== req.userId) return res.status(409).json({ error: 'Этот username уже занят.' });
        // Owner account cannot be renamed or replaced via normal profile editing.
        if (user.username_norm === VERIFIED_USERNAME && norm(username) !== VERIFIED_USERNAME) {
            return res.status(403).json({ error: 'Имя аккаунта владельца нельзя изменить.' });
        }
        if (norm(username) === VERIFIED_USERNAME && user.username_norm !== VERIFIED_USERNAME) {
            return res.status(403).json({ error: 'Имя владельца защищено.' });
        }
        // CRITICAL: never overwrite verified_badge when saving profile settings.
        await pool.query(
            `UPDATE users SET username=$1,username_norm=$2,display_name=$3,bio=$4,
             presence_status=$5,privacy_online=$6,avatar_color=$7,phone_visible=$9,call_privacy=$10 WHERE id=$8`,
            [username, norm(username), displayName, bio, presenceStatus, privacyOnline, avatarColor, req.userId, Boolean(req.body.phoneVisible === undefined ? user.phone_visible : req.body.phoneVisible === true), callPrivacy]
        );
        const updated = await getUser(req.userId);
        res.json({ profile: publicProfile(updated, req.userId) });
        await broadcastPresence();
    } catch (error) { console.error(error); res.status(500).json({ error: 'Не удалось сохранить профиль.' }); }
});
app.post('/api/profile/avatar', authMiddleware, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не выбран.' });
        if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Нужна картинка.' });
        if (req.file.size > 4 * 1024 * 1024) return res.status(400).json({ error: 'Аватар слишком большой.' });
        await pool.query('UPDATE users SET avatar_data=$1,avatar_mime=$2 WHERE id=$3',
            [req.file.buffer, req.file.mimetype, req.userId]);
        const user = await getUser(req.userId);
        res.json({ profile: publicProfile(user, req.userId) });
        await broadcastPresence();
    } catch { res.status(500).json({ error: 'Не удалось загрузить аватар.' }); }
});
app.delete('/api/profile/avatar', authMiddleware, async (req, res) => {
    await pool.query('UPDATE users SET avatar_data=NULL,avatar_mime=NULL WHERE id=$1', [req.userId]);
    const user = await getUser(req.userId);
    res.json({ profile: publicProfile(user, req.userId) });
    await broadcastPresence();
});
app.get('/api/avatar/:userId', async (req, res) => {
    const { rows } = await pool.query('SELECT avatar_data,avatar_mime FROM users WHERE id=$1', [req.params.userId]);
    if (!rows[0]?.avatar_data) return res.status(404).end();
    res.set('Content-Type', safeMediaMime(rows[0].avatar_mime, 'image/jpeg'));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(rows[0].avatar_data);
});

/* ================================
   USERS / SEARCH
================================ */
app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const current = await getUser(req.userId);
        if (!current) return res.status(401).json({ error: 'Аккаунт не найден.' });
        if (current.username_norm !== VERIFIED_USERNAME) {
            // No directory access for ordinary users. Exact @username lookup still lets them start chats.
            const exact = clean(req.query.q, 50);
            if (!exact.startsWith('@') || !validUsername(exact.slice(1))) {
                return res.status(403).json({ error: 'Общий список людей доступен только владельцу. Для поиска введи точный @username.' });
            }
            const found = await getUserByUsername(exact.slice(1));
            if (!found || found.id === req.userId) return res.json({ users: [] });
            const blocks = await blockedBetween(req.userId, found.id);
            if (blocks.a_blocks_b || blocks.b_blocks_a) return res.json({ users: [] });
            return res.json({ users: [publicProfile(found, req.userId)] });
        }
        const q = clean(req.query.q, 50).replace(/^@/, '').toLowerCase();
        const params = [req.userId];
        let where = 'u.id <> $1';
        if (q) { params.push(`%${q}%`); where += ' AND (u.username_norm LIKE $2 OR lower(u.display_name) LIKE $2)'; }
        const { rows } = await pool.query(
            `SELECT u.id,u.username,u.display_name,u.avatar_data,u.bio,u.presence_status,u.privacy_online,u.verified_badge,u.created_at,u.phone_e164,u.phone_visible,u.phone_verified,u.official_number,
                    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=$1 AND b.blocked_id=u.id) AS blocked,
                    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id=u.id AND b.blocked_id=$1) AS blocked_me
             FROM users u WHERE ${where}
             ORDER BY (u.id IN (SELECT user_id FROM conversation_members)) DESC,u.username_norm LIMIT 100`,
            params
        );
        res.json({ users: rows.filter(row => !row.blocked && !row.blocked_me)
            .map(row => ({ ...publicProfile(row, req.userId), blocked: false, blockedMe: false })) });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Ошибка поиска.' }); }
});

// Individual profiles are accessible to signed-in users, independent of the owner-only directory.
app.get('/api/users/:userId', authMiddleware, async (req, res) => {
    try {
        const user = await getUser(clean(req.params.userId, 120));
        if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });
        const blocked = await blockedBetween(req.userId, user.id);
        if (blocked.a_blocks_b || blocked.b_blocks_a) return res.status(403).json({ error: 'Профиль недоступен.' });
        res.json({ profile: publicProfile(user, req.userId) });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Не удалось открыть профиль.' }); }
});

/* ================================
   CHATS
================================ */
app.get('/api/chats', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.id AS conversation_id,
                    u.id,u.username,u.display_name,u.avatar_data,u.bio,u.presence_status,u.privacy_online,u.verified_badge,u.created_at,u.official_number,
                    cm1.pinned,cm1.muted,
                    lm.id AS last_message_id,lm.text AS last_text,lm.created_at AS last_time,lm.sender_id AS last_sender_id,
                    (SELECT COUNT(*) FROM messages um
                     WHERE um.conversation_id=c.id AND um.sender_id=u.id AND um.read_at IS NULL AND um.deleted_at IS NULL
                     AND NOT EXISTS(SELECT 1 FROM message_hidden_for h WHERE h.message_id=um.id AND h.user_id=$1)) AS unread
             FROM conversations c
             JOIN conversation_members cm1 ON cm1.conversation_id=c.id AND cm1.user_id=$1
             JOIN conversation_members cm2 ON cm2.conversation_id=c.id AND cm2.user_id<>$1
             JOIN users u ON u.id=cm2.user_id
             LEFT JOIN LATERAL (
                 SELECT id,text,created_at,sender_id FROM messages
                 WHERE conversation_id=c.id AND NOT EXISTS(SELECT 1 FROM message_hidden_for h WHERE h.message_id=messages.id AND h.user_id=$1)
                 ORDER BY created_at DESC LIMIT 1
             ) lm ON TRUE
             ORDER BY cm1.pinned DESC,lm.created_at DESC NULLS LAST`, [req.userId]
        );
        res.json({ chats: rows.map(row => ({
            conversationId: row.conversation_id, user: publicProfile(row, req.userId),
            pinned: Boolean(row.pinned), muted: Boolean(row.muted), unread: Number(row.unread || 0),
            lastMessage: row.last_message_id ? {
                id: row.last_message_id, text: row.last_text || 'Вложение',
                senderId: row.last_sender_id, time: row.last_time
            } : null
        })) });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Не удалось загрузить чаты.' }); }
});
app.get('/api/chats/:userId/messages', authMiddleware, async (req, res) => {
    try {
        const targetId = req.params.userId;
        if (targetId === req.userId) return res.status(400).json({ error: 'Нельзя открыть чат с самим собой.' });
        const target = await getUser(targetId);
        if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
        const blocked = await blockedBetween(req.userId, targetId);
        if (blocked.a_blocks_b || blocked.b_blocks_a) return res.status(403).json({ error: 'Этот пользователь заблокирован.' });
        const conversationId = await ensureDirectConversation(req.userId, targetId);
        const delivered = await pool.query(
            `UPDATE messages SET delivered_at=COALESCE(delivered_at,NOW())
             WHERE conversation_id=$1 AND sender_id=$2 AND delivered_at IS NULL AND deleted_at IS NULL RETURNING id`,
            [conversationId, targetId]
        );
        if (delivered.rows.length) sendToUser(targetId, {
            type: 'receipts', kind: 'delivered', messageIds: delivered.rows.map(row => row.id)
        });
        const search = clean(req.query.search, 100);
        const params = [conversationId,req.userId];
        let where = 'm.conversation_id=$1 AND NOT EXISTS(SELECT 1 FROM message_hidden_for hf WHERE hf.message_id=m.id AND hf.user_id=$2)';
        if (search) { params.push(`%${search}%`); where += ' AND m.text ILIKE $3'; }
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
             WHERE ${where} ORDER BY m.created_at ASC LIMIT 300`, params
        );
        const ids = rows.map(row => row.id);
        const reactions = ids.length ? (await pool.query(
            'SELECT message_id,user_id,emoji FROM reactions WHERE message_id=ANY($1::text[])', [ids]
        )).rows : [];
        const reactionMap = new Map();
        for (const reaction of reactions) {
            if (!reactionMap.has(reaction.message_id)) reactionMap.set(reaction.message_id, []);
            reactionMap.get(reaction.message_id).push({ emoji: reaction.emoji, userId: reaction.user_id });
        }
        res.json({ conversationId, messages: rows.map(m => ({
            id: m.id, conversationId: m.conversation_id, senderId: m.sender_id,
            senderUsername: m.sender_username, senderDisplayName: m.sender_display_name,
            senderVerified: Boolean(m.sender_verified),
            text: m.deleted_at ? 'Сообщение удалено' : (m.text || ''),
            deleted: Boolean(m.deleted_at), edited: Boolean(m.edited_at), createdAt: m.created_at,
            deliveredAt: m.delivered_at, readAt: m.read_at,
            replyTo: m.reply_to_id ? { id: m.reply_to_id, text: m.reply_text || '', username: m.reply_username || '' } : null,
            forwarded: Boolean(m.forwarded_from_id),
            attachment: m.attachment_id ? {
                id: m.attachment_id, filename: m.attachment_filename, mime: m.attachment_mime,
                size: Number(m.attachment_size || 0), url: `/api/media/${m.attachment_id}`
            } : null,
            reactions: reactionMap.get(m.id) || []
        })) });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Не удалось загрузить сообщения.' }); }
});
app.post('/api/chats/:userId/settings', authMiddleware, async (req, res) => {
    try {
        const conversationId = await ensureDirectConversation(req.userId, req.params.userId);
        const pinned = Boolean(req.body.pinned), muted = Boolean(req.body.muted);
        await pool.query('UPDATE conversation_members SET pinned=$1,muted=$2 WHERE conversation_id=$3 AND user_id=$4',
            [pinned, muted, conversationId, req.userId]);
        res.json({ ok: true });
        await broadcastChatRefresh([req.userId]);
    } catch { res.status(500).json({ error: 'Не удалось сохранить настройки чата.' }); }
});


// v8.5.5: bounded 2 MiB chunk uploads. All file types are accepted.
// On managed PostgreSQL this consumes database storage: monitor your plan's disk limit.
const MAX_CHAT_FILE_BYTES = 250 * 1024 * 1024;
const CHAT_FILE_CHUNK = 2 * 1024 * 1024;
const safeUploadMime = value => /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(String(value || ''))
    ? String(value) : 'application/octet-stream';
const safeUploadName = value => clean(String(value || 'file').replace(/[\\/\r\n\0]/g,'_'), 180) || 'file';
app.post('/api/upload-chunks/init', authMiddleware, async (req, res) => {
    try {
        const size = Number(req.body?.size);
        const chunks = Math.ceil(size / CHAT_FILE_CHUNK);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_CHAT_FILE_BYTES)
            return res.status(413).json({error:'Максимальный размер одного файла — 250 МБ.'});
        const active = await pool.query('SELECT COUNT(*)::int AS count FROM upload_sessions WHERE owner_id=$1 AND expires_at>NOW()', [req.userId]);
        if (active.rows[0].count >= 3) return res.status(429).json({error:'Сначала заверши предыдущие загрузки (не более трёх одновременно).'});
        const uploadId = id();
        await pool.query(`INSERT INTO upload_sessions(id,owner_id,filename,mime_type,total_size,total_chunks)
            VALUES ($1,$2,$3,$4,$5,$6)`, [uploadId, req.userId, safeUploadName(req.body?.name), safeUploadMime(req.body?.mime), size, chunks]);
        res.status(201).json({uploadId,chunkSize:CHAT_FILE_CHUNK,chunks});
    } catch(err) {console.error('Upload init:',err);res.status(500).json({error:'Не удалось начать отправку файла.'});}
});
app.put('/api/upload-chunks/:id/:index', authMiddleware,
    express.raw({type:'application/octet-stream', limit:'2.1mb'}), async(req,res)=>{
    try {
        const index=Number(req.params.index), uploadId=String(req.params.id||'');
        if(!Number.isSafeInteger(index)||index<0||!req.body||!Buffer.isBuffer(req.body))
            return res.status(400).json({error:'Некорректный фрагмент файла.'});
        const {rows}=await pool.query(`SELECT total_size,total_chunks FROM upload_sessions
            WHERE id=$1 AND owner_id=$2 AND expires_at>NOW()`,[uploadId,req.userId]);
        const job=rows[0];
        if(!job) return res.status(404).json({error:'Загрузка не найдена или истекла.'});
        if(index>=job.total_chunks) return res.status(400).json({error:'Недопустимый номер фрагмента.'});
        const expected=Math.min(CHAT_FILE_CHUNK,Number(job.total_size)-index*CHAT_FILE_CHUNK);
        if(req.body.length!==expected) return res.status(400).json({error:'Неправильный размер фрагмента.'});
        await pool.query(`INSERT INTO attachment_chunks(attachment_id,chunk_index,data)
            VALUES($1,$2,$3) ON CONFLICT(attachment_id,chunk_index)
            DO UPDATE SET data=EXCLUDED.data`,[uploadId,index,req.body]);
        res.json({ok:true,index});
    }catch(err){console.error('Upload chunk:',err);res.status(500).json({error:'Ошибка сохранения фрагмента.'});}
});
app.post('/api/upload-chunks/:id/complete',authMiddleware,async(req,res)=>{
    const client=await pool.connect();
    try{
        await client.query('BEGIN');
        const {rows}=await client.query(`SELECT * FROM upload_sessions WHERE id=$1 AND owner_id=$2
            AND expires_at>NOW() FOR UPDATE`,[req.params.id,req.userId]);
        const job=rows[0];
        if(!job){await client.query('ROLLBACK');return res.status(404).json({error:'Загрузка не найдена.'});}
        const result=await client.query(`SELECT COUNT(*)::int AS n,
            COALESCE(SUM(octet_length(data)),0)::bigint AS bytes
            FROM attachment_chunks WHERE attachment_id=$1`,[job.id]);
        if(result.rows[0].n!==job.total_chunks || Number(result.rows[0].bytes)!==Number(job.total_size)){
            await client.query('ROLLBACK');return res.status(409).json({error:'Файл загрузился не полностью.'});
        }
        // Empty BYTEA preserves the existing schema's NOT NULL constraint.
        // Actual bytes reside in attachment_chunks to avoid a 250 MB Node Buffer.
        await client.query(`INSERT INTO attachments(id,owner_id,filename,mime_type,size,data)
            VALUES($1,$2,$3,$4,$5,$6)`,[job.id,req.userId,job.filename,job.mime_type,job.total_size,Buffer.alloc(0)]);
        await client.query('DELETE FROM upload_sessions WHERE id=$1',[job.id]);
        await client.query('COMMIT');
        res.json({attachment:{id:job.id,filename:job.filename,mime:job.mime_type,
            size:Number(job.total_size),url:`/api/media/${job.id}`}});
    }catch(err){await client.query('ROLLBACK').catch(()=>{});console.error('Upload complete:',err);
        res.status(500).json({error:'Не удалось завершить загрузку.'});}
    finally{client.release();}
});

/* ================================
   ATTACHMENTS
================================ */
app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не выбран.' });
        const attachmentId = id();
        const filename = clean(req.file.originalname, 255);
        const mime = req.file.mimetype || 'application/octet-stream';
        await pool.query(
            `INSERT INTO attachments(id,owner_id,filename,mime_type,size,data)
             VALUES($1,$2,$3,$4,$5,$6)`,
            [attachmentId, req.userId, filename, mime, req.file.size, req.file.buffer]
        );
        res.json({ attachment: {
            id: attachmentId, filename, mime, size: req.file.size, url: `/api/media/${attachmentId}`
        } });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Не удалось загрузить файл.' }); }
});
app.get('/api/media/:id', async (req, res) => {
    try {
        const header = req.get('authorization') || '';
        const bearer = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
        const decoded = verifyToken(String(bearer));
        const mediaUserId = decoded?.sub;
        if (!mediaUserId) return res.status(401).end();
        const { rows } = await pool.query(
            `SELECT a.filename,a.mime_type,a.size,
                EXISTS(SELECT 1 FROM attachment_chunks ch WHERE ch.attachment_id=a.id) AS chunked,
                CASE WHEN EXISTS(SELECT 1 FROM attachment_chunks ch WHERE ch.attachment_id=a.id)
                  THEN NULL ELSE a.data END AS data
             FROM attachments a
             WHERE a.id=$1 AND (
               a.owner_id=$2 OR EXISTS(
                 SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
                 WHERE m.attachment_id=a.id AND cm.user_id=$2
               )
             )`,
            [req.params.id, mediaUserId]
        );
        if (!rows[0]) return res.status(404).end();
        const contentType = safeMediaMime(rows[0].mime_type);
        res.set('Content-Type', contentType);
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Content-Security-Policy', 'sandbox');
        // Safe ASCII-only header: Unicode filename remains in attachment JSON metadata.
        // Avoid Node/Electron ByteString errors for files named e.g. "изображение.png".
        // Unknown file types must download, never execute HTML/SVG from our own origin.
        const safeInline = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|mp4|ogg|wav|webm)|application\/pdf)$/i.test(contentType);
        res.set('Content-Disposition', req.query.download === '1' || !safeInline ? 'attachment' : 'inline');
        const item=rows[0];
        if(!item.chunked) return res.send(item.data);
        const size=Number(item.size);
        const range=req.headers.range;
        let start=0,end=size-1;
        if(range){
            const m=/^bytes=(\d+)-(\d*)$/.exec(String(range));
            if(!m){res.set('Content-Range',`bytes */${size}`);return res.status(416).end();}
            start=Number(m[1]); end=m[2]?Number(m[2]):size-1;
            if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){
                res.set('Content-Range',`bytes */${size}`);return res.status(416).end();}
            end=Math.min(end,size-1);
            res.status(206).set('Content-Range',`bytes ${start}-${end}/${size}`);
        }
        res.set('Accept-Ranges','bytes');
        res.set('Content-Length',String(end-start+1));
        res.flushHeaders();
        const first=Math.floor(start/CHAT_FILE_CHUNK),last=Math.floor(end/CHAT_FILE_CHUNK);
        for(let part=first;part<=last;part++){
            if(res.destroyed) break;
            const chunk=await pool.query(`SELECT data FROM attachment_chunks
                WHERE attachment_id=$1 AND chunk_index=$2`,[req.params.id,part]);
            if(!chunk.rows[0]){res.destroy();return;}
            const bytes=chunk.rows[0].data;
            const lo=part===first?start-part*CHAT_FILE_CHUNK:0;
            const hi=part===last?end-part*CHAT_FILE_CHUNK+1:bytes.length;
            if(!res.write(bytes.subarray(lo,hi))){
                await new Promise(resolve=>{res.once('drain',resolve);res.once('close',resolve);});
            }
        }
        if(!res.destroyed) res.end();
    } catch { res.status(500).end(); }
});

/* ================================
   MESSAGE ACTIONS
================================ */
app.patch('/api/messages/:id', authMiddleware, async (req, res) => {
    try {
        const text = clean(req.body.text, 4000);
        const { rows } = await pool.query('SELECT * FROM messages WHERE id=$1 AND sender_id=$2', [req.params.id, req.userId]);
        const message = rows[0];
        if (!message) return res.status(404).json({ error: 'Сообщение не найдено.' });
        if (message.deleted_at) return res.status(400).json({ error: 'Сообщение уже удалено.' });
        if ((Date.now() - new Date(message.created_at).getTime()) > 15 * 60 * 1000) {
            return res.status(403).json({ error: 'Сообщение можно редактировать только первые 15 минут.' });
        }
        await pool.query('UPDATE messages SET text=$1,edited_at=NOW() WHERE id=$2', [text, req.params.id]);
        const payload = await messagePayload(req.params.id);
        await broadcastMessageToConversation(message.conversation_id, payload);
        res.json({ message: payload });
    } catch { res.status(500).json({ error: 'Не удалось изменить сообщение.' }); }
});
// Delete for me: only changes current user's view, never the other participant's history.
app.post('/api/messages/:id/hide', authMiddleware, async (req,res) => {
    try {
        const { rows }=await pool.query(`SELECT m.id,m.conversation_id FROM messages m
          JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2
          WHERE m.id=$1`,[req.params.id,req.userId]);
        if(!rows[0])return res.status(404).json({error:'Сообщение не найдено.'});
        await pool.query('INSERT INTO message_hidden_for(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.params.id,req.userId]);
        sendToUser(req.userId,{type:'message_hidden',messageId:req.params.id});
        sendToUser(req.userId,{type:'chat_refresh'});
        res.json({ok:true});
    }catch(err){console.error('Hide message:',err);res.status(500).json({error:'Не удалось скрыть сообщение.'});}
});
app.delete('/api/messages/:id', authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT conversation_id FROM messages WHERE id=$1 AND sender_id=$2',
            [req.params.id, req.userId]);
        if (!rows[0]) return res.status(404).json({ error: 'Сообщение не найдено.' });
        await pool.query('UPDATE messages SET text=NULL,attachment_id=NULL,deleted_at=NOW(),edited_at=NULL WHERE id=$1',
            [req.params.id]);
        const payload = await messagePayload(req.params.id);
        await broadcastMessageToConversation(rows[0].conversation_id, payload);
        res.json({ message: payload });
    } catch { res.status(500).json({ error: 'Не удалось удалить сообщение.' }); }
});
app.post('/api/messages/:id/reactions', authMiddleware, async (req, res) => {
    try {
        const emoji = clean(req.body.emoji, 8);
        if(!['👍','❤️','😂','🔥','😮','😢','👏','👎'].includes(emoji))return res.status(400).json({error:'Недопустимая реакция.'});
        const { rows } = await pool.query(
            `SELECT m.id,m.conversation_id FROM messages m
             JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2
             WHERE m.id=$1`, [req.params.id, req.userId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Сообщение не найдено.' });
        const conversationId = rows[0].conversation_id;
        const existing = await pool.query('SELECT id FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
            [req.params.id, req.userId, emoji]);
        if (existing.rowCount) await pool.query('DELETE FROM reactions WHERE id=$1', [existing.rows[0].id]);
        else await pool.query('INSERT INTO reactions(id,message_id,user_id,emoji) VALUES($1,$2,$3,$4)',
            [id(), req.params.id, req.userId, emoji]);
        const rr = await pool.query('SELECT user_id,emoji FROM reactions WHERE message_id=$1', [req.params.id]);
        const reactionList = rr.rows.map(r => ({ userId: r.user_id, emoji: r.emoji }));
        const { rows: members } = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1',
            [conversationId]);
        for (const member of members) sendToUser(member.user_id, {
            type: 'reaction', messageId: req.params.id, reactions: reactionList
        });
        res.json({ reactions: reactionList });
    } catch { res.status(500).json({ error: 'Не удалось изменить реакцию.' }); }
});
app.post('/api/messages/:id/forward', authMiddleware, async (req, res) => {
    try {
        const targetId = String(req.body.toUserId || '');
        const sourceResult = await pool.query('SELECT * FROM messages WHERE id=$1', [req.params.id]);
        const source = sourceResult.rows[0];
        if (!source) return res.status(404).json({ error: 'Сообщение не найдено.' });
        // Prevent forwarding a private message from a conversation the user is not a member of.
        if (!(await isMember(source.conversation_id, req.userId))) {
            return res.status(403).json({ error: 'Нет доступа к исходному сообщению.' });
        }
        if (source.deleted_at) return res.status(400).json({ error: 'Сообщение удалено.' });
        if (!targetId || targetId === req.userId) return res.status(400).json({ error: 'Укажи другого получателя.' });
        if (targetId === SUPPORT_ID) return res.status(403).json({error:'Поддержка принимает только служебные сообщения.'});
        const target = await getUser(targetId);
        if (!target) return res.status(404).json({ error: 'Получатель не найден.' });
        const blocked = await blockedBetween(req.userId, targetId);
        if (blocked.a_blocks_b || blocked.b_blocks_a) return res.status(403).json({ error: 'Этот пользователь заблокирован.' });
        const conversationId = await ensureDirectConversation(req.userId, targetId);
        const recipientOnline = isOnline(targetId);
        const newId = id();
        await pool.query(
            `INSERT INTO messages(id,conversation_id,sender_id,text,attachment_id,forwarded_from_id,delivered_at)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [newId, conversationId, req.userId, source.text, source.attachment_id, source.id,
                recipientOnline ? new Date() : null]
        );
        const payload = await messagePayload(newId);
        await broadcastMessageToConversation(conversationId, payload);
        res.json({ message: payload });
        await broadcastChatRefresh([req.userId, targetId]);
        if (!recipientOnline) {
            const sender = await getUser(req.userId);
            await pushNotify(targetId, pushPayloadForMessage(payload, sender));
        }
    } catch { res.status(500).json({ error: 'Не удалось переслать сообщение.' }); }
});

/* ================================
   BLOCK / REPORT
================================ */
app.post('/api/users/:userId/block', authMiddleware, async (req, res) => {
    if (req.params.userId === SUPPORT_ID) return res.status(403).json({ error: 'Нельзя блокировать служебные сообщения поддержки.' });
    if (req.params.userId === req.userId) return res.status(400).json({ error: 'Нельзя заблокировать себя.' });
    await pool.query('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.userId, req.params.userId]);
    res.json({ ok: true });
    await broadcastPresence();
});
app.delete('/api/users/:userId/block', authMiddleware, async (req, res) => {
    await pool.query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.userId, req.params.userId]);
    res.json({ ok: true });
    await broadcastPresence();
});
app.post('/api/users/:userId/report', authMiddleware, async (req, res) => {
    const reason = clean(req.body.reason, 500) || 'Без причины';
    await pool.query('INSERT INTO reports(id,reporter_id,target_id,reason) VALUES($1,$2,$3,$4)',
        [id(), req.userId, req.params.userId, reason]);
    res.json({ ok: true });
});

/* ================================
   PUSH
================================ */
app.get('/api/push/public-key', authMiddleware, (_req, res) => {
    res.json({ publicKey: vapidReady ? process.env.VAPID_PUBLIC_KEY : '' });
});
app.post('/api/push/subscribe', authMiddleware, async (req, res) => {
    try {
        const sub = req.body.subscription;
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return res.status(400).json({ error: 'Некорректная подписка.' });
        }
        await pool.query(
            `INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth)
             VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,
            [id(), req.userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
        );
        res.json({ ok: true });
    } catch { res.status(500).json({ error: 'Не удалось включить уведомления.' }); }
});

/* ================================
   WEBRTC CONFIG
================================ */
app.get('/api/rtc-config', authMiddleware, (_req, res) => {
    const iceServers = [
        { urls: String(process.env.RTC_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302').split(',').map(v => v.trim()).filter(Boolean) }
    ];
    const turnUrls = String(process.env.RTC_TURN_URLS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (turnUrls.length && process.env.RTC_TURN_USERNAME && process.env.RTC_TURN_CREDENTIAL) {
        iceServers.push({ urls: turnUrls, username: process.env.RTC_TURN_USERNAME,
            credential: process.env.RTC_TURN_CREDENTIAL });
    }
    res.set('Cache-Control', 'no-store');
    res.json({ iceServers, turnConfigured: iceServers.some(s => s.username && s.credential) });
});

/* ================================
   STATUS
================================ */
app.get('/api/status', async (_req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*)::int AS users FROM users');
        res.json({ online: true, users: result.rows[0].users, onlineUsers: onlineSockets.size, database: true });
    } catch (error) { console.error('Status error:', error); res.status(503).json({ online: false, database: false }); }
});

/* ================================
   WEBSOCKET: CHAT & CALLS
================================ */
wss.on('connection', ws => {
    ws.isAlive = true;
    ws.authed = false;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', async raw => {
        try {
            const data = JSON.parse(raw.toString());
            if (data.type === 'auth') {
                const decoded = verifyToken(String(data.token || ''));
                if (!decoded?.sub) { send(ws, { type: 'auth_error', error: 'Сессия недействительна.' }); return ws.close(); }
                const user = await getUser(decoded.sub);
                if (!user || user.id === SUPPORT_ID) { send(ws, { type: 'auth_error', error: 'Пользователь не найден.' }); return ws.close(); }
                // Reauth/reconnect cleanup for this socket.
                if (ws.authed) removeSocket(ws);
                ws.authed = true;
                ws.userId = user.id;
                addSocket(user.id, ws);
                send(ws, { type: 'auth_ok', profile: publicProfile(user, user.id) });
                await broadcastPresence();
                return;
            }
            if (!ws.authed) return;
            const userId = ws.userId;
            if (data.type === 'call_offer') {
                const targetId = String(data.toUserId || '');
                const callId = clean(data.callId, 120);
                if (!targetId || !callId || !data.offer || targetId === userId) return;
                if (targetId === SUPPORT_ID || userId === SUPPORT_ID) {
                    send(ws,{type:'call_error',callId,error:'В поддержку нельзя звонить.'});return;
                }
                const target = await getUser(targetId);
                if (!target) {send(ws,{type:'call_error',callId,error:'Пользователь не найден.'});return;}
                const policy=target.call_privacy||'everyone';
                // A chat can be auto-created when opening a profile; this alone is not consent.
                // 'contacts' here means people to whom the recipient has written at least once.
                let isContact = false;
                if (policy === 'contacts') {
                    const priorConversation = await getDirectConversation(userId, targetId);
                    if (priorConversation) {
                        const previousReply = await pool.query(
                          'SELECT 1 FROM messages WHERE conversation_id=$1 AND sender_id=$2 AND deleted_at IS NULL LIMIT 1',
                          [priorConversation, targetId]);
                        isContact = Boolean(previousReply.rowCount);
                    }
                }
                if (policy==='nobody'||(policy==='contacts'&&!isContact)) {
                    send(ws,{type:'call_error',callId,error:'Этот пользователь ограничил входящие звонки.'});return;
                }
                const blocked = await blockedBetween(userId, targetId);
                if (blocked.a_blocks_b || blocked.b_blocks_a) {
                    send(ws, { type: 'call_error', callId, error: 'Нельзя позвонить этому пользователю.' });
                    return;
                }
                if (!isOnline(targetId)) {
                    send(ws, { type: 'call_unavailable', callId, toUserId: targetId, error: 'Пользователь сейчас не в сети.' });
                    return;
                }
                sendToUser(targetId, {
                    type: 'call_offer', callId, fromUserId: userId,
                    from: publicProfile(await getUser(userId), userId), video: Boolean(data.video), offer: data.offer
                });
                return;
            }
            if (data.type === 'call_answer') {
                const targetId = String(data.toUserId || '');
                const callId = clean(data.callId, 120);
                if (!targetId || !callId || !data.answer) return;
                sendToUser(targetId, { type: 'call_answer', callId, fromUserId: userId, answer: data.answer });
                return;
            }
            if (data.type === 'call_ice') {
                const targetId = String(data.toUserId || '');
                const callId = clean(data.callId, 120);
                if (!targetId || !callId || !data.candidate) return;
                sendToUser(targetId, { type: 'call_ice', callId, fromUserId: userId, candidate: data.candidate });
                return;
            }
            if (data.type === 'call_reject' || data.type === 'call_end') {
                const targetId = String(data.toUserId || '');
                const callId = clean(data.callId, 120);
                if (!targetId || !callId) return;
                sendToUser(targetId, {
                    type: data.type, callId, fromUserId: userId, reason: clean(data.reason, 120)
                });
                return;
            }
            if (data.type === 'call_busy') {
                const targetId = String(data.toUserId || '');
                const callId = clean(data.callId, 120);
                if (!targetId || !callId) return;
                sendToUser(targetId, { type: 'call_busy', callId, fromUserId: userId });
                return;
            }
            if (data.type === 'typing') {
                const targetId = String(data.toUserId || '');
                if (!targetId) return;
                const blocked = await blockedBetween(userId, targetId);
                if (blocked.a_blocks_b || blocked.b_blocks_a) return;
                sendToUser(targetId, { type: 'typing', fromId: userId, isTyping: Boolean(data.isTyping) });
                return;
            }
            if (data.type === 'read') {
                const targetId = String(data.withUserId || '');
                const conversationId = await getDirectConversation(userId, targetId);
                if (!conversationId) return;
                const delivered = await pool.query(
                    `UPDATE messages SET delivered_at=COALESCE(delivered_at,NOW())
                     WHERE conversation_id=$1 AND sender_id=$2 AND delivered_at IS NULL AND deleted_at IS NULL RETURNING id`,
                    [conversationId, targetId]
                );
                if (delivered.rows.length) sendToUser(targetId, {
                    type: 'receipts', kind: 'delivered', messageIds: delivered.rows.map(row => row.id)
                });
                const result = await pool.query(
                    `UPDATE messages SET read_at=COALESCE(read_at,NOW())
                     WHERE conversation_id=$1 AND sender_id=$2 AND read_at IS NULL AND deleted_at IS NULL RETURNING id`,
                    [conversationId, targetId]
                );
                await pool.query('UPDATE conversation_members SET last_read_at=NOW() WHERE conversation_id=$1 AND user_id=$2',
                    [conversationId, userId]);
                if (result.rows.length) sendToUser(targetId, {
                    type: 'receipts', kind: 'read', messageIds: result.rows.map(row => row.id)
                });
                sendToUser(userId, { type: 'chat_refresh' });
                sendToUser(targetId, { type: 'chat_refresh' });
                return;
            }
            if (data.type === 'send') {
                const targetId = String(data.toUserId || '');
                const text = clean(data.text, 4000);
                const attachmentId = data.attachmentId ? String(data.attachmentId) : null;
                const replyToId = data.replyToId ? String(data.replyToId) : null;
                const clientMessageId = clean(data.clientMessageId, 80) || null;
                if (!targetId || (!text && !attachmentId) || targetId === userId) return;
                if (targetId === SUPPORT_ID) { send(ws, { type: 'error', error: 'Это служебный канал поддержки: ответы отключены.' }); return; }
                const target = await getUser(targetId);
                const sender = await getUser(userId);
                if (!target || !sender) return;
                const blocked = await blockedBetween(userId, targetId);
                if (blocked.a_blocks_b || blocked.b_blocks_a) {
                    send(ws, { type: 'error', error: 'Нельзя отправить сообщение этому пользователю.' });
                    return;
                }
                const conversationId = await ensureDirectConversation(userId, targetId);
                if (replyToId) {
                    // Only allow replies within the current conversation.
                    const checkReply = await pool.query(
                        'SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2', [replyToId, conversationId]
                    );
                    if (!checkReply.rowCount) return;
                }
                if (attachmentId) {
                    const a = await pool.query('SELECT 1 FROM attachments WHERE id=$1 AND owner_id=$2',
                        [attachmentId, userId]);
                    if (!a.rowCount) return;
                }
                const messageId = id();
                const deliveredAt = isOnline(targetId) ? new Date() : null;
                const inserted = await pool.query(
                    `INSERT INTO messages(id,conversation_id,sender_id,text,attachment_id,reply_to_id,client_message_id,delivered_at)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
                    [messageId, conversationId, userId, text || null, attachmentId, replyToId, clientMessageId, deliveredAt]
                );
                if (!inserted.rowCount && clientMessageId) {
                    const existing = await pool.query(
                        `SELECT id FROM messages WHERE sender_id=$1 AND client_message_id=$2 LIMIT 1`,
                        [userId, clientMessageId]
                    );
                    if (existing.rowCount) {
                        const payload = await messagePayload(existing.rows[0].id);
                        send(ws, { type: 'message', message: payload });
                        return;
                    }
                }
                if (!inserted.rowCount) return;
                const payload = await messagePayload(inserted.rows[0].id);
                await broadcastMessageToConversation(conversationId, payload);
                await broadcastChatRefresh([userId, targetId]);
                if (!isOnline(targetId)) await pushNotify(targetId, pushPayloadForMessage(payload, sender));
                return;
            }
        } catch (error) {
            console.error('WS message error', error);
            send(ws, { type: 'error', error: 'Ошибка обработки запроса.' });
        }
    });
    ws.on('close', async () => {
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
wss.on('close', () => clearInterval(heartbeat));

async function init() {
    await pool.query(schema);
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data BYTEA').catch(() => {});
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT').catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT '#3390ec'").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS presence_status TEXT NOT NULL DEFAULT 'online'").catch(() => {});
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_online TEXT NOT NULL DEFAULT 'everyone'").catch(() => {});
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_badge BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_visible BOOLEAN NOT NULL DEFAULT FALSE');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS official_number TEXT UNIQUE');
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS call_privacy TEXT NOT NULL DEFAULT 'everyone'");
    await pool.query(`CREATE TABLE IF NOT EXISTS message_hidden_for (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(message_id,user_id))`);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_official_number_idx ON users(official_number) WHERE official_number IS NOT NULL');
    await pool.query(`CREATE TABLE IF NOT EXISTS official_number_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending','approved','active','rejected','cancelled')),
        code_hash TEXT, code_salt TEXT, code_expires_at TIMESTAMPTZ,code_attempts SMALLINT NOT NULL DEFAULT 0,
        approved_by TEXT REFERENCES users(id),approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS official_request_number_reserved ON official_number_requests(number) WHERE status IN ('pending','approved','active')`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS official_request_one_per_user ON official_number_requests(user_id) WHERE status IN ('pending','approved','active')`);
    await pool.query(`INSERT INTO users(id,username,username_norm,display_name,password_hash,verified_badge,bio,privacy_online)
        VALUES($1,$2,$3,'Поддержка BurmalpticajopaChat',$4,TRUE,'Официальные сообщения о номерах +888','nobody')
        ON CONFLICT DO NOTHING`,[SUPPORT_ID,SUPPORT_USERNAME,SUPPORT_NORM,await bcrypt.hash(crypto.randomBytes(32).toString('hex'),10)]);
    const supportCheck=await pool.query('SELECT id FROM users WHERE username_norm=$1',[SUPPORT_NORM]);
    if (supportCheck.rows[0]?.id!==SUPPORT_ID) throw new Error('Имя BurmalSupport занято другим аккаунтом. Освободи его перед запуском.');
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON users(phone_e164) WHERE phone_e164 IS NOT NULL');
    await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id TEXT').catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_message_id_idx
        ON messages(sender_id,client_message_id) WHERE client_message_id IS NOT NULL`).catch(() => {});
    await pool.query(`CREATE TABLE IF NOT EXISTS upload_sessions (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,mime_type TEXT NOT NULL,total_size BIGINT NOT NULL,
        total_chunks INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours')`);
    await pool.query(`CREATE TABLE IF NOT EXISTS attachment_chunks (
        attachment_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(attachment_id,chunk_index))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS attachment_chunks_created_idx ON attachment_chunks(created_at)`);
    await pool.query(`DELETE FROM attachment_chunks c WHERE c.created_at<NOW()-INTERVAL '48 hours'
      AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.id=c.attachment_id)`);
    await pool.query(`DELETE FROM upload_sessions WHERE expires_at<NOW()`);
    // Admin table is deliberately initialized only after users exists.
    await ownerAdmin.init();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`BurmalpticajopaChat running on port ${PORT}`);
        if (!mailer) console.log('SMTP not configured: email sending is disabled.');
        if (!vapidReady) console.log('VAPID not configured: push notifications are disabled.');
    });
}
init().catch(error => {
    console.error('Startup error', error);
    process.exit(1);
});