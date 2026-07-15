const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.disable('x-powered-by');

// Native clients do not rely on browser CORS. The dashboard is same-origin in
// production; optional extra origins can be provided as a comma-separated env.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin is not allowed by CORS'));
  }
}));
app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  next();
});

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("[SERVER] FATAL: Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.");
  console.error("[SERVER] SUPABASE_URL:", supabaseUrl ? "SET" : "MISSING");
  console.error("[SERVER] SUPABASE_SERVICE_ROLE_KEY:", supabaseKey ? "SET" : "MISSING");
} else {
  console.log(`[SERVER] Supabase connected: ${supabaseUrl}`);
}

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAdminSessionToken(adminPassword) {
  const payload = Buffer.from(JSON.stringify({
    exp: Date.now() + 12 * 60 * 60 * 1000,
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', adminPassword).update(payload).digest('base64url');
  return `ADM_${payload}.${signature}`;
}

function verifyAdminSessionToken(token, adminPassword) {
  if (!token.startsWith('ADM_')) return false;
  const separator = token.lastIndexOf('.');
  if (separator < 5) return false;
  const payload = token.slice(4, separator);
  const signature = token.slice(separator + 1);
  const expected = crypto.createHmac('sha256', adminPassword).update(payload).digest('base64url');
  if (!safeEqualText(signature, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number(decoded.exp) > Date.now();
  } catch {
    return false;
  }
}

const adminLoginAttempts = new Map();
function allowAdminLogin(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const current = adminLoginAttempts.get(key);
  if (!current || now >= current.resetAt) {
    adminLoginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

// Middleware to verify admin authorization header
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({ success: false, message: "Server configuration error: ADMIN_PASSWORD not set." });
  }

  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const validPassword = bearerToken && safeEqualText(bearerToken, adminPassword);
  const validSession = bearerToken && verifyAdminSessionToken(bearerToken, adminPassword);
  if (!validPassword && !validSession) {
    return res.status(401).json({ success: false, message: "Unauthorized: Invalid admin password." });
  }
  next();
};

// Global error wrapper for all API routes
function apiWrapper(handler) {
  return async (req, res, next) => {
    // Check Supabase config before any DB operation
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ 
        success: false, 
        message: "Server misconfiguration: Database connection not set up. Please configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables in Vercel." 
      });
    }
    try {
      await handler(req, res, next);
    } catch (err) {
      console.error("[API] Unhandled error:", err.message || err);
      res.status(500).json({ success: false, message: "Internal server error. Check server logs." });
    }
  };
}

// Helper: generate random alphanumeric string
function randomAlphaNum(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, byte => chars[byte % chars.length]).join('');
}

function randomSessionToken() {
  return `SKS_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 128);
  }
  return String(req.socket?.remoteAddress || '').slice(0, 128) || null;
}

function sanitizeString(value, maxLength, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

function parseVersionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersionParts(left);
  const b = parseVersionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function getClientAuthorization(config, appVersion) {
  const announcement = sanitizeString(config?.announcement, 1000);
  if (config?.maintenance_mode) {
    return {
      authorized: false,
      code: 'maintenance',
      message: announcement || 'Hệ thống đang bảo trì.'
    };
  }
  if (!config?.menu_enabled) {
    return {
      authorized: false,
      code: 'all_clients_disabled',
      message: announcement || 'Quyền truy cập của toàn bộ client đang bị khóa.'
    };
  }
  if (config?.minimum_version && !parseVersionParts(appVersion)) {
    return {
      authorized: false,
      code: 'invalid_version',
      message: announcement || 'Client không cung cấp phiên bản semantic hợp lệ.'
    };
  }
  if (config?.minimum_version && compareVersions(appVersion, config.minimum_version) < 0) {
    return {
      authorized: false,
      code: 'upgrade_required',
      message: announcement || `Cần cập nhật client lên phiên bản ${config.minimum_version} hoặc mới hơn.`
    };
  }
  return {
    authorized: true,
    code: 'ok',
    message: announcement || 'Client đã được ServerKey cấp quyền.'
  };
}

app.locals.getClientAuthorization = getClientAuthorization;
app.locals.compareVersions = compareVersions;

async function getClientPolicy() {
  const [{ data: config, error: configError }, { data: flags, error: flagsError }] = await Promise.all([
    supabase.from('client_config').select('*').eq('id', 1).single(),
    supabase.from('feature_flags').select('feature_key, display_name, description, enabled, locked, sort_order').order('sort_order')
  ]);

  if (configError) throw configError;
  if (flagsError) throw flagsError;

  return {
    config,
    features: Object.fromEntries((flags || []).map(flag => [flag.feature_key, {
      enabled: flag.enabled,
      locked: flag.locked,
      display_name: flag.display_name,
      description: flag.description || '',
      sort_order: flag.sort_order || 0
    }]))
  };
}

async function bumpConfigRevision() {
  const { data, error } = await supabase
    .from('client_config')
    .select('config_revision')
    .eq('id', 1)
    .single();
  if (error) throw error;

  const nextRevision = Number(data.config_revision || 0) + 1;
  const { error: updateError } = await supabase
    .from('client_config')
    .update({ config_revision: nextRevision, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (updateError) throw updateError;
  return nextRevision;
}

async function recordSecurityEvent({ hwid, reason, eventType, keyId = null, deviceId = null, metadata = {} }) {
  const { error } = await supabase.from('fraud_logs').insert([{
    hwid: hwid || 'unknown',
    reason,
    event_type: eventType,
    key_id: keyId,
    device_id: deviceId,
    metadata
  }]);
  if (error) console.error('[SECURITY EVENT]', error.message || error);
}

// ==========================================
// Health check
// ==========================================
app.get('/api', (req, res) => {
  res.json({ status: "ok", message: "Key Management API is operational.", timestamp: new Date().toISOString() });
});

app.get('/api/health', async (req, res) => {
  const databaseConfigured = Boolean(supabase);
  if (!databaseConfigured) {
    return res.status(503).json({
      status: 'degraded',
      database_configured: false,
      schema_ready: false,
      version: '4.2.0',
      message: 'Database environment variables are missing.',
      timestamp: new Date().toISOString()
    });
  }

  const { error: schemaError } = await supabase
    .from('client_config')
    .select('config_revision')
    .eq('id', 1)
    .maybeSingle();
  const schemaReady = !schemaError;
  return res.status(schemaReady ? 200 : 503).json({
    status: schemaReady ? 'ok' : 'migration_required',
    database_configured: true,
    schema_ready: schemaReady,
    version: '4.2.0',
    message: schemaReady ? 'ServerKey control plane is operational.' : 'Run supabase.sql to install the v4 database schema.',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/admin/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const suppliedPassword = typeof req.body.password === 'string' ? req.body.password : '';
  if (!allowAdminLogin(getClientIp(req))) {
    return res.status(429).json({ success: false, message: 'Too many login attempts. Try again later.' });
  }
  if (!adminPassword) {
    return res.status(500).json({ success: false, message: 'ADMIN_PASSWORD is not configured.' });
  }
  if (!suppliedPassword || !safeEqualText(suppliedPassword, adminPassword)) {
    return res.status(401).json({ success: false, message: 'Invalid admin password.' });
  }
  return res.json({ success: true, token: createAdminSessionToken(adminPassword), expires_in: 43200 });
});

// All database-backed APIs fail cleanly instead of crashing the whole function
// when Vercel environment variables have not been configured yet.
app.use(['/api/admin', '/api/client', '/api/v1/client'], (req, res, next) => {
  if (!supabase) {
    return res.status(503).json({
      success: false,
      message: 'Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
  }
  next();
});

// ==========================================
// TOKEN ADMIN ENDPOINTS
// ==========================================

// [POST] /api/admin/create-token
app.post('/api/admin/create-token', verifyAdmin, async (req, res) => {
  const { token_name, max_days, description, display_text } = req.body;

  const tokenName = sanitizeString(token_name, 100);
  const parsedMaxDays = max_days === undefined || max_days === null || max_days === ''
    ? null
    : Number.parseInt(max_days, 10);
  if (!tokenName) {
    return res.status(400).json({ success: false, message: "token_name is required." });
  }
  if (parsedMaxDays !== null && (!Number.isInteger(parsedMaxDays) || parsedMaxDays < 1 || parsedMaxDays > 3650)) {
    return res.status(400).json({ success: false, message: 'max_days must be between 1 and 3650.' });
  }

  const token_string = `TKN_${randomAlphaNum(12)}`;

  try {
    const { data, error } = await supabase
      .from('tokens')
      .insert([{
        token_name: tokenName,
        token_string,
        max_days: parsedMaxDays,
        description: sanitizeString(description, 300) || null,
        display_text: sanitizeString(display_text, 160) || "ServerKey by #wtuananh6868"
      }])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, token: data });
  } catch (error) {
    console.error("Error creating token:", error);
    return res.status(500).json({ success: false, message: "Database error while creating token." });
  }
});

// [GET] /api/admin/get-tokens
app.get('/api/admin/get-tokens', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, tokens: data });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching tokens." });
  }
});

// [DELETE] /api/admin/delete-token
app.delete('/api/admin/delete-token', verifyAdmin, async (req, res) => {
  const { token_id } = req.body;

  if (!token_id) {
    return res.status(400).json({ success: false, message: "token_id is required." });
  }

  try {
    const { data, error } = await supabase
      .from('tokens')
      .delete()
      .eq('id', token_id)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Token not found." });
    }

    return res.json({ success: true, message: "Token and associated keys deleted successfully." });
  } catch (error) {
    console.error("Error deleting token:", error);
    return res.status(500).json({ success: false, message: "Database error while deleting token." });
  }
});

// ==========================================
// KEY ADMIN ENDPOINTS
// ==========================================

// [POST] /api/admin/create-key
app.post('/api/admin/create-key', verifyAdmin, async (req, res) => {
  const { token_id, duration_days, count, note, max_devices, custom_key_string } = req.body;

  if (!token_id) {
    return res.status(400).json({ success: false, message: "token_id is required." });
  }

  if (duration_days === undefined || duration_days === null) {
    return res.status(400).json({ success: false, message: "duration_days is required." });
  }

  const parsedDuration = parseInt(duration_days);
  const parsedCount = Math.min(Math.max(parseInt(count) || 1, 1), 50);
  const parsedMaxDevices = parseInt(max_devices) || 1;

  if (parsedMaxDevices < 1 || parsedMaxDevices > 100) {
    return res.status(400).json({ success: false, message: "max_devices must be between 1 and 100." });
  }

  const customKey = sanitizeString(custom_key_string, 120);
  const safeNote = sanitizeString(note, 500) || null;
  if (customKey && !/^[A-Za-z0-9._-]+$/.test(customKey)) {
    return res.status(400).json({ success: false, message: 'custom_key_string may only contain letters, numbers, dot, underscore, and dash.' });
  }

  try {
    // Validate token exists and fetch max_days
    const { data: tokenData, error: tokenError } = await supabase
      .from('tokens')
      .select('*')
      .eq('id', token_id)
      .maybeSingle();

    if (tokenError) throw tokenError;

    if (!tokenData) {
      return res.status(404).json({ success: false, message: "Token not found." });
    }

    // Validate duration_days against token.max_days
    if (parsedDuration === -1) {
      // Lifetime key: only allowed if token.max_days is null (unlimited)
      if (tokenData.max_days !== null) {
        return res.status(400).json({ success: false, message: "Lifetime keys are not allowed for this token (token has max_days set)." });
      }
    } else if (parsedDuration > 0) {
      if (tokenData.max_days !== null && parsedDuration > tokenData.max_days) {
        return res.status(400).json({ success: false, message: `duration_days (${parsedDuration}) exceeds token max_days (${tokenData.max_days}).` });
      }
    } else {
      return res.status(400).json({ success: false, message: "duration_days must be a positive integer or -1 for lifetime." });
    }

    // Generate keys
    const keysToInsert = [];
    for (let i = 0; i < parsedCount; i++) {
      let key_string;
      if (customKey) {
        key_string = parsedCount === 1 ? customKey : `${customKey}-${i + 1}`;
      } else {
        const randomPart = randomAlphaNum(8);
        if (parsedDuration === -1) {
          key_string = `key-lifetime-${randomPart}`;
        } else {
          key_string = `key-${parsedDuration}day-${randomPart}`;
        }
      }

      keysToInsert.push({
        key_string,
        token_id: parseInt(token_id),
        duration_days: parsedDuration,
        max_devices: parsedMaxDevices,
        status: 'unactivated',
        expires_at: null,
        note: safeNote
      });
    }

    // Batch insert
    const { data, error } = await supabase
      .from('keys_management')
      .insert(keysToInsert)
      .select();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: "Tên Key đã tồn tại trong hệ thống. Vui lòng chọn tên khác." });
      }
      throw error;
    }

    return res.status(201).json({ success: true, keys: data });
  } catch (error) {
    console.error("Error creating key:", error);
    return res.status(500).json({ success: false, message: "Database error while generating keys." });
  }
});

// [POST] /api/admin/reset-hwid
app.post('/api/admin/reset-hwid', verifyAdmin, async (req, res) => {
  const { key_string } = req.body;

  if (!key_string) {
    return res.status(400).json({ success: false, message: "key_string is required." });
  }

  try {
    // Find the key
    const { data: keyData, error: keyError } = await supabase
      .from('keys_management')
      .select('id')
      .eq('key_string', key_string)
      .maybeSingle();

    if (keyError) throw keyError;

    if (!keyData) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    // Delete all device entries for this key
    const { error: deleteError } = await supabase
      .from('key_devices')
      .delete()
      .eq('key_id', keyData.id);

    if (deleteError) throw deleteError;

    // Reset key status and expires_at
    const { error: updateError } = await supabase
      .from('keys_management')
      .update({ status: 'unactivated', expires_at: null })
      .eq('key_string', key_string);

    if (updateError) throw updateError;

    const { error: revokeError } = await supabase
      .from('client_sessions')
      .update({ status: 'revoked' })
      .eq('key_id', keyData.id)
      .eq('status', 'active');
    if (revokeError) throw revokeError;

    return res.json({ success: true, message: "All devices reset successfully." });
  } catch (error) {
    console.error("Error resetting HWID:", error);
    return res.status(500).json({ success: false, message: "Database error during HWID reset." });
  }
});

// [DELETE] /api/admin/delete-key
app.delete('/api/admin/delete-key', verifyAdmin, async (req, res) => {
  const { key_string } = req.body;

  if (!key_string) {
    return res.status(400).json({ success: false, message: "key_string is required." });
  }

  try {
    const { data, error } = await supabase
      .from('keys_management')
      .delete()
      .eq('key_string', key_string)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    return res.json({ success: true, message: "Key deleted successfully." });
  } catch (error) {
    console.error("Error deleting key:", error);
    return res.status(500).json({ success: false, message: "Database error while deleting key." });
  }
});

// [POST] /api/admin/ban-key — Ban or Unban a key
app.post('/api/admin/ban-key', verifyAdmin, async (req, res) => {
  const { key_string, action } = req.body; // action: 'ban' or 'unban'

  if (!key_string) {
    return res.status(400).json({ success: false, message: "key_string is required." });
  }

  if (!['ban', 'unban'].includes(action)) {
    return res.status(400).json({ success: false, message: "action must be 'ban' or 'unban'." });
  }

  const newStatus = action === 'unban' ? 'unactivated' : 'banned';

  try {
    const updateData = { status: newStatus };
    // If unbanning, also reset expires_at so the key can be reused
    if (action === 'unban') {
      updateData.expires_at = null;

      // Also clear devices when unbanning
      const { data: keyData, error: keyLookupError } = await supabase
        .from('keys_management')
        .select('id')
        .eq('key_string', key_string)
        .maybeSingle();
      if (keyLookupError) throw keyLookupError;

      if (keyData) {
        const { error: clearDevicesError } = await supabase
          .from('key_devices')
          .delete()
          .eq('key_id', keyData.id);
        if (clearDevicesError) throw clearDevicesError;
      }
    }

    const { data, error } = await supabase
      .from('keys_management')
      .update(updateData)
      .eq('key_string', key_string)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    if (action === 'ban') {
      const { error: revokeError } = await supabase
        .from('client_sessions')
        .update({ status: 'revoked' })
        .eq('key_id', data[0].id)
        .eq('status', 'active');
      if (revokeError) throw revokeError;
    }

    return res.json({ success: true, message: `Key ${newStatus === 'banned' ? 'banned' : 'unbanned'} successfully.` });
  } catch (error) {
    console.error("Error banning/unbanning key:", error);
    return res.status(500).json({ success: false, message: "Database error." });
  }
});

// [GET] /api/admin/get-keys — Returns all keys with token info and device info
app.get('/api/admin/get-keys', verifyAdmin, async (req, res) => {
  try {
    // Dynamically update expired keys
    await supabase
      .from('keys_management')
      .update({ status: 'expired' })
      .eq('status', 'activated')
      .lt('expires_at', new Date().toISOString());

    // Fetch all keys with token info via join
    const { data: keys, error: keysError } = await supabase
      .from('keys_management')
      .select('*, tokens(id, token_name, token_string, max_days, display_text)')
      .order('created_at', { ascending: false });

    if (keysError) throw keysError;

    // Fetch all devices
    const { data: devices, error: devicesError } = await supabase
      .from('key_devices')
      .select('*');

    if (devicesError) throw devicesError;

    // Build a map: key_id -> list of hwids
    const deviceMap = {};
    for (const d of devices) {
      if (!deviceMap[d.key_id]) {
        deviceMap[d.key_id] = [];
      }
      deviceMap[d.key_id].push(d.hwid);
    }

    // Enrich keys with device info
    const enrichedKeys = keys.map(key => ({
      ...key,
      token_name: key.tokens?.token_name || null,
      token_string: key.tokens?.token_string || null,
      token_display_text: key.tokens?.display_text || null,
      device_count: (deviceMap[key.id] || []).length,
      hwids: deviceMap[key.id] || []
    }));

    return res.json({ success: true, keys: enrichedKeys });
  } catch (error) {
    console.error("Error fetching keys:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching keys." });
  }
});

// [GET] /api/admin/get-fraud
app.get('/api/admin/get-fraud', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('fraud_logs')
      .select('*')
      .order('logged_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    return res.json({ success: true, logs: data });
  } catch (error) {
    console.error("Error fetching fraud logs:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching fraud logs." });
  }
});

// [DELETE] /api/admin/clear-fraud — Clear all fraud logs
app.delete('/api/admin/clear-fraud', verifyAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('fraud_logs')
      .delete()
      .gte('id', 0); // delete all rows

    if (error) throw error;

    return res.json({ success: true, message: "All fraud logs cleared." });
  } catch (error) {
    console.error("Error clearing fraud logs:", error);
    return res.status(500).json({ success: false, message: "Database error while clearing fraud logs." });
  }
});

// [GET] /api/admin/stats — Dashboard statistics
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    // Dynamically update expired keys
    await supabase
      .from('keys_management')
      .update({ status: 'expired' })
      .eq('status', 'activated')
      .lt('expires_at', new Date().toISOString());

    const { data: keys, error: keysError } = await supabase
      .from('keys_management')
      .select('status');

    if (keysError) throw keysError;

    const { data: fraudLogs, error: fraudError } = await supabase
      .from('fraud_logs')
      .select('id');

    if (fraudError) throw fraudError;

    const { data: tokens, error: tokensError } = await supabase
      .from('tokens')
      .select('id');

    if (tokensError) throw tokensError;

    const [{ data: devices, error: devicesError }, { data: sessions, error: sessionsError }] = await Promise.all([
      supabase.from('devices').select('id, status'),
      supabase.from('client_sessions').select('id, status, expires_at')
    ]);
    if (devicesError) throw devicesError;
    if (sessionsError) throw sessionsError;

    const now = new Date();

    const stats = {
      totalTokens: tokens.length,
      total: keys.length,
      unactivated: keys.filter(k => k.status === 'unactivated').length,
      activated: keys.filter(k => k.status === 'activated').length,
      expired: keys.filter(k => k.status === 'expired').length,
      banned: keys.filter(k => k.status === 'banned').length,
      fraudAlerts: fraudLogs.length,
      devices: devices.length,
      bannedDevices: devices.filter(device => device.status === 'banned').length,
      activeSessions: sessions.filter(session => session.status === 'active' && new Date(session.expires_at) > now).length
    };

    return res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching stats." });
  }
});

// ==========================================
// CONTROL PLANE ADMIN ENDPOINTS (v4)
// ==========================================

app.get('/api/admin/control-config', verifyAdmin, async (req, res) => {
  try {
    const policy = await getClientPolicy();
    return res.json({ success: true, ...policy });
  } catch (error) {
    console.error('[CONTROL CONFIG] Fetch failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load client control configuration.' });
  }
});

app.patch('/api/admin/control-config', verifyAdmin, async (req, res) => {
  const heartbeat = Number.parseInt(req.body.heartbeat_interval_seconds, 10);
  const minimumVersion = sanitizeString(req.body.minimum_version, 32, '1.0.0');
  const latestVersion = sanitizeString(req.body.latest_version, 32, '1.0.0');
  if (!parseVersionParts(minimumVersion) || !parseVersionParts(latestVersion)) {
    return res.status(400).json({
      success: false,
      message: 'minimum_version and latest_version must use semantic version format, for example 1.2.3.'
    });
  }
  if (compareVersions(latestVersion, minimumVersion) < 0) {
    return res.status(400).json({
      success: false,
      message: 'latest_version cannot be lower than minimum_version.'
    });
  }
  const update = {
    menu_enabled: Boolean(req.body.menu_enabled),
    maintenance_mode: Boolean(req.body.maintenance_mode),
    auto_update_enabled: Boolean(req.body.auto_update_enabled),
    minimum_version: minimumVersion,
    latest_version: latestVersion,
    update_url: sanitizeString(req.body.update_url, 500) || null,
    heartbeat_interval_seconds: Number.isInteger(heartbeat) && heartbeat >= 15 && heartbeat <= 3600 ? heartbeat : 45,
    announcement: sanitizeString(req.body.announcement, 1000) || null,
    updated_at: new Date().toISOString()
  };

  if (update.update_url && !/^https:\/\//i.test(update.update_url)) {
    return res.status(400).json({ success: false, message: 'update_url must use HTTPS.' });
  }

  try {
    const { data: current, error: currentError } = await supabase
      .from('client_config')
      .select('config_revision')
      .eq('id', 1)
      .single();
    if (currentError) throw currentError;

    update.config_revision = Number(current.config_revision || 0) + 1;
    const { data, error } = await supabase
      .from('client_config')
      .update(update)
      .eq('id', 1)
      .select()
      .single();
    if (error) throw error;

    return res.json({ success: true, config: data });
  } catch (error) {
    console.error('[CONTROL CONFIG] Update failed:', error);
    return res.status(500).json({ success: false, message: 'Could not update client control configuration.' });
  }
});

app.post('/api/admin/feature-flag', verifyAdmin, async (req, res) => {
  const featureKey = sanitizeString(req.body.feature_key, 64).toLowerCase();
  const displayName = sanitizeString(req.body.display_name, 100);
  const description = sanitizeString(req.body.description, 300) || null;
  const sortOrder = Number.parseInt(req.body.sort_order, 10) || 0;

  if (!/^[a-z][a-z0-9_]{1,63}$/.test(featureKey) || !displayName) {
    return res.status(400).json({
      success: false,
      message: 'feature_key must be lowercase snake_case and display_name is required.'
    });
  }

  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .upsert({
        feature_key: featureKey,
        display_name: displayName,
        description,
        enabled: req.body.enabled !== false,
        locked: Boolean(req.body.locked),
        sort_order: sortOrder,
        updated_at: new Date().toISOString()
      }, { onConflict: 'feature_key' })
      .select()
      .single();
    if (error) throw error;
    const revision = await bumpConfigRevision();
    return res.json({ success: true, feature: data, config_revision: revision });
  } catch (error) {
    console.error('[FEATURE FLAG] Upsert failed:', error);
    return res.status(500).json({ success: false, message: 'Could not save feature flag.' });
  }
});

app.delete('/api/admin/feature-flag', verifyAdmin, async (req, res) => {
  const featureKey = sanitizeString(req.body.feature_key, 64).toLowerCase();
  if (!featureKey) {
    return res.status(400).json({ success: false, message: 'feature_key is required.' });
  }

  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .delete()
      .eq('feature_key', featureKey)
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'Feature flag not found.' });
    }
    const revision = await bumpConfigRevision();
    return res.json({ success: true, config_revision: revision });
  } catch (error) {
    console.error('[FEATURE FLAG] Delete failed:', error);
    return res.status(500).json({ success: false, message: 'Could not delete feature flag.' });
  }
});

app.get('/api/admin/devices', verifyAdmin, async (req, res) => {
  try {
    const [deviceResult, bindingResult, keyResult, sessionResult] = await Promise.all([
      supabase.from('devices').select('*').order('last_seen_at', { ascending: false }),
      supabase.from('key_devices').select('key_id, hwid, activated_at'),
      supabase.from('keys_management').select('id, key_string, status, expires_at'),
      supabase.from('client_sessions').select('device_id, status')
    ]);

    for (const result of [deviceResult, bindingResult, keyResult, sessionResult]) {
      if (result.error) throw result.error;
    }

    const keyMap = new Map((keyResult.data || []).map(key => [key.id, key]));
    const bindingMap = new Map();
    for (const binding of bindingResult.data || []) {
      if (!bindingMap.has(binding.hwid)) bindingMap.set(binding.hwid, []);
      const key = keyMap.get(binding.key_id);
      if (key) bindingMap.get(binding.hwid).push({ ...key, activated_at: binding.activated_at });
    }
    const activeSessionCounts = new Map();
    for (const session of sessionResult.data || []) {
      if (session.status === 'active') {
        activeSessionCounts.set(session.device_id, (activeSessionCounts.get(session.device_id) || 0) + 1);
      }
    }

    const devices = (deviceResult.data || []).map(device => ({
      ...device,
      licenses: bindingMap.get(device.hwid) || [],
      active_sessions: activeSessionCounts.get(device.id) || 0
    }));
    return res.json({ success: true, devices });
  } catch (error) {
    console.error('[DEVICES] Fetch failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load devices.' });
  }
});

app.post('/api/admin/device-status', verifyAdmin, async (req, res) => {
  const deviceId = Number.parseInt(req.body.device_id, 10);
  const status = req.body.status === 'banned' ? 'banned' : req.body.status === 'active' ? 'active' : '';
  const reason = sanitizeString(req.body.reason, 300) || null;
  if (!deviceId || !status) {
    return res.status(400).json({ success: false, message: 'Valid device_id and status are required.' });
  }

  try {
    const update = {
      status,
      ban_reason: status === 'banned' ? reason : null,
      banned_at: status === 'banned' ? new Date().toISOString() : null
    };
    const { data, error } = await supabase
      .from('devices')
      .update(update)
      .eq('id', deviceId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Device not found.' });

    if (status === 'banned') {
      const { error: revokeError } = await supabase
        .from('client_sessions')
        .update({ status: 'revoked' })
        .eq('device_id', deviceId)
        .eq('status', 'active');
      if (revokeError) throw revokeError;
      await recordSecurityEvent({
        hwid: data.hwid,
        reason: reason || 'Device banned by administrator',
        eventType: 'device_banned',
        deviceId
      });
    }

    return res.json({ success: true, device: data });
  } catch (error) {
    console.error('[DEVICE STATUS] Update failed:', error);
    return res.status(500).json({ success: false, message: 'Could not update device status.' });
  }
});

app.get('/api/admin/sessions', verifyAdmin, async (req, res) => {
  try {
    await supabase
      .from('client_sessions')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString());

    const [sessionResult, deviceResult, keyResult] = await Promise.all([
      supabase.from('client_sessions').select('id, key_id, device_id, status, created_at, last_seen_at, expires_at').order('last_seen_at', { ascending: false }).limit(500),
      supabase.from('devices').select('id, hwid, status, app_version'),
      supabase.from('keys_management').select('id, key_string, status')
    ]);
    for (const result of [sessionResult, deviceResult, keyResult]) {
      if (result.error) throw result.error;
    }

    const deviceMap = new Map((deviceResult.data || []).map(device => [device.id, device]));
    const keyMap = new Map((keyResult.data || []).map(key => [key.id, key]));
    const sessions = (sessionResult.data || []).map(session => ({
      ...session,
      device: deviceMap.get(session.device_id) || null,
      license: keyMap.get(session.key_id) || null
    }));
    return res.json({ success: true, sessions });
  } catch (error) {
    console.error('[SESSIONS] Fetch failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load sessions.' });
  }
});

app.post('/api/admin/revoke-session', verifyAdmin, async (req, res) => {
  const sessionId = Number.parseInt(req.body.session_id, 10);
  if (!sessionId) return res.status(400).json({ success: false, message: 'session_id is required.' });

  try {
    const { data, error } = await supabase
      .from('client_sessions')
      .update({ status: 'revoked' })
      .eq('id', sessionId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Session not found.' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[SESSION] Revoke failed:', error);
    return res.status(500).json({ success: false, message: 'Could not revoke session.' });
  }
});

// ==========================================
// CLIENT ENDPOINTS (For ImGui client verification)
// ==========================================

// ==========================================
// Client Login — Rate limiter (simple in-memory, 5 req/sec per HWID)
// ==========================================
const loginRateLimit = new Map(); // hwid -> { count, resetTime }

function checkClientRateLimit(hwid) {
  const now = Date.now();
  const key = hwid || 'unknown';
  if (!loginRateLimit.has(key)) {
    loginRateLimit.set(key, { count: 1, resetTime: now + 1000 });
    return true;
  }
  const record = loginRateLimit.get(key);
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + 1000;
    return true;
  }
  if (record.count >= 5) {
    return false; // rate limited
  }
  record.count++;
  return true;
}

// Garbage-collect expired rate limit records every 60s
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginRateLimit) {
    if (now > v.resetTime + 60000) loginRateLimit.delete(k);
  }
}, 60000);
if (typeof rateLimitCleanupTimer.unref === 'function') rateLimitCleanupTimer.unref();

const activationErrors = {
  invalid_token: [403, 'Invalid Token'],
  invalid_key: [403, 'Invalid Key'],
  license_banned: [403, 'Key has been banned'],
  license_expired: [403, 'Key has expired'],
  device_banned: [403, 'Device has been banned'],
  device_limit: [403, 'Đã đạt giới hạn thiết bị']
};

async function handleClientActivation(req, res) {
  const tokenString = sanitizeString(req.body.token_string, 128);
  const keyString = sanitizeString(req.body.key_string, 256);
  const hwid = sanitizeString(req.body.hwid, 256);
  const appVersion = sanitizeString(req.body.app_version, 32) || null;

  if (!tokenString || !keyString || !hwid) {
    return res.status(400).json({ success: false, message: 'token_string, key_string, and hwid are required.' });
  }
  if (!checkClientRateLimit(hwid)) {
    return res.status(429).json({ success: false, message: 'Too many requests. Please wait.' });
  }

  try {
    const { data: activation, error: activationError } = await supabase.rpc('activate_client_license', {
      p_token_string: tokenString,
      p_key_string: keyString,
      p_hwid: hwid,
      p_app_version: appVersion,
      p_ip: getClientIp(req)
    });
    if (activationError) throw activationError;

    if (!activation?.ok) {
      const [status, message] = activationErrors[activation?.code] || [403, 'Activation denied'];
      await recordSecurityEvent({
        hwid,
        reason: `${message} (${activation?.code || 'unknown'})`,
        eventType: activation?.code || 'activation_denied',
        keyId: activation?.key_id || null,
        deviceId: activation?.device_id || null,
        metadata: { app_version: appVersion }
      });
      return res.status(status).json({
        success: false,
        code: activation?.code || 'activation_denied',
        message: activation?.reason || message
      });
    }

    const rawSessionToken = randomSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (activation.expires_at) {
      const licenseExpiry = new Date(activation.expires_at);
      if (licenseExpiry < sessionExpiresAt) sessionExpiresAt.setTime(licenseExpiry.getTime());
    }

    await supabase
      .from('client_sessions')
      .update({ status: 'revoked' })
      .eq('key_id', activation.key_id)
      .eq('device_id', activation.device_id)
      .eq('status', 'active');

    const { data: session, error: sessionError } = await supabase
      .from('client_sessions')
      .insert([{
        session_token_hash: hashSessionToken(rawSessionToken),
        key_id: activation.key_id,
        device_id: activation.device_id,
        expires_at: sessionExpiresAt.toISOString()
      }])
      .select('id, expires_at')
      .single();
    if (sessionError) throw sessionError;

    const policy = await getClientPolicy();
    const authorization = getClientAuthorization(policy.config, appVersion);
    return res.json({
      success: true,
      authorized: authorization.authorized,
      authorization_code: authorization.code,
      authorization_message: authorization.message,
      message: 'Activation successful',
      token: rawSessionToken,
      session_id: session.id,
      session_expires_at: session.expires_at,
      expires_at: activation.expires_at,
      token_name: activation.token_name,
      display_text: activation.display_text,
      duration_days: activation.duration_days,
      device_id: activation.device_id,
      config: policy.config,
      features: policy.features
    });
  } catch (error) {
    console.error('[CLIENT ACTIVATE] Internal error:', error.message || error);
    return res.status(500).json({ success: false, message: 'Database or internal server error.' });
  }
}

app.post('/api/client/login', handleClientActivation);
app.post('/api/v1/client/activate', handleClientActivation);

async function authenticateClientSession(req, res) {
  const authHeader = req.headers.authorization || '';
  const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!rawToken) {
    res.status(401).json({
      success: false,
      authorized: false,
      code: 'session_missing',
      message: 'Missing client session token.'
    });
    return null;
  }

  const { data: session, error } = await supabase
    .from('client_sessions')
    .select('*')
    .eq('session_token_hash', hashSessionToken(rawToken))
    .maybeSingle();
  if (error) throw error;
  const expiredByTime = session && new Date(session.expires_at) <= new Date();
  if (!session || session.status !== 'active' || expiredByTime) {
    if (session?.status === 'active' && expiredByTime) {
      await supabase.from('client_sessions').update({ status: 'expired' }).eq('id', session.id);
    }
    const code = !session
      ? 'session_invalid'
      : (expiredByTime || session.status === 'expired')
        ? 'session_expired'
        : 'session_revoked';
    res.status(401).json({
      success: false,
      authorized: false,
      code,
      message: code === 'session_expired'
        ? 'Client session expired.'
        : 'Client session was revoked or is invalid.'
    });
    return null;
  }
  return session;
}

app.post('/api/v1/client/heartbeat', async (req, res) => {
  try {
    const session = await authenticateClientSession(req, res);
    if (!session) return;

    const [{ data: device, error: deviceError }, { data: license, error: licenseError }] = await Promise.all([
      supabase.from('devices').select('*').eq('id', session.device_id).single(),
      supabase.from('keys_management').select('id, status, expires_at').eq('id', session.key_id).single()
    ]);
    if (deviceError) throw deviceError;
    if (licenseError) throw licenseError;

    const licenseExpired = license.status === 'expired' || (license.expires_at && new Date(license.expires_at) <= new Date());
    if (device.status === 'banned' || license.status === 'banned' || licenseExpired) {
      await supabase.from('client_sessions').update({ status: 'revoked' }).eq('id', session.id);
      return res.status(403).json({
        success: false,
        authorized: false,
        code: device.status === 'banned' ? 'device_banned' : license.status === 'banned' ? 'license_banned' : 'license_expired',
        message: device.ban_reason || 'Access has been revoked.'
      });
    }

    const now = new Date().toISOString();
    const appVersion = sanitizeString(req.body.app_version, 32) || device.app_version;
    await Promise.all([
      supabase.from('client_sessions').update({ last_seen_at: now }).eq('id', session.id),
      supabase.from('devices').update({ last_seen_at: now, app_version: appVersion, last_ip: getClientIp(req) }).eq('id', device.id)
    ]);

    const policy = await getClientPolicy();
    const authorization = getClientAuthorization(policy.config, appVersion);
    return res.json({
      success: true,
      authorized: authorization.authorized,
      authorization_code: authorization.code,
      authorization_message: authorization.message,
      server_time: now,
      session_expires_at: session.expires_at,
      license_expires_at: license.expires_at,
      device_status: device.status,
      config: policy.config,
      features: policy.features
    });
  } catch (error) {
    console.error('[CLIENT HEARTBEAT] Internal error:', error.message || error);
    return res.status(500).json({ success: false, authorized: false, message: 'Heartbeat failed.' });
  }
});

app.post('/api/v1/client/logout', async (req, res) => {
  try {
    const session = await authenticateClientSession(req, res);
    if (!session) return;
    const { error } = await supabase.from('client_sessions').update({ status: 'revoked' }).eq('id', session.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[CLIENT LOGOUT] Internal error:', error.message || error);
    return res.status(500).json({ success: false, message: 'Logout failed.' });
  }
});


// ==========================================
// STATIC FILE SERVING (Local development only)
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    }
  });
}

// Start listening (local development only)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
  });
}

module.exports = app;
