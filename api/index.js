const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Enable CORS for all origins (cURL and ImGui client access)
app.use(cors());
app.use(express.json());

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

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Middleware to verify admin authorization header
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).json({ success: false, message: "Server configuration error: ADMIN_PASSWORD not set." });
  }

  if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
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
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ==========================================
// Health check
// ==========================================
app.get('/api', (req, res) => {
  res.json({ status: "ok", message: "Key Management API is operational.", timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: "ok", message: "Key Management API is operational.", timestamp: new Date().toISOString() });
});

// ==========================================
// TOKEN ADMIN ENDPOINTS
// ==========================================

// [POST] /api/admin/create-token
app.post('/api/admin/create-token', verifyAdmin, async (req, res) => {
  const { token_name, max_days, description, display_text } = req.body;

  if (!token_name || !token_name.trim()) {
    return res.status(400).json({ success: false, message: "token_name is required." });
  }

  const token_string = `TKN_${randomAlphaNum(12)}`;

  try {
    const { data, error } = await supabase
      .from('tokens')
      .insert([{
        token_name: token_name.trim(),
        token_string,
        max_days: max_days !== undefined && max_days !== null ? parseInt(max_days) : null,
        description: description || null,
        display_text: display_text && display_text.trim() ? display_text.trim() : "ServerKey by #wtuananh6868"
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

  if (parsedMaxDevices < 1) {
    return res.status(400).json({ success: false, message: "max_devices must be >= 1." });
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
      if (custom_key_string && custom_key_string.trim()) {
        const trimmedCustom = custom_key_string.trim();
        key_string = parsedCount === 1 ? trimmedCustom : `${trimmedCustom}-${i + 1}`;
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
        note: note || null
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

  const newStatus = action === 'unban' ? 'unactivated' : 'banned';

  try {
    const updateData = { status: newStatus };
    // If unbanning, also reset expires_at so the key can be reused
    if (action === 'unban') {
      updateData.expires_at = null;

      // Also clear devices when unbanning
      const { data: keyData } = await supabase
        .from('keys_management')
        .select('id')
        .eq('key_string', key_string)
        .maybeSingle();

      if (keyData) {
        await supabase
          .from('key_devices')
          .delete()
          .eq('key_id', keyData.id);
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

    return res.json({ success: true, message: `Key ${newStatus === 'banned' ? 'banned' : 'unbanned'} successfully.` });
  } catch (error) {
    console.error("Error banning/unbanning key:", error);
    return res.status(500).json({ success: false, message: "Database error." });
  }
});

// [GET] /api/admin/get-keys — Returns all keys with token info and device info
app.get('/api/admin/get-keys', verifyAdmin, async (req, res) => {
  try {
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
      .order('logged_at', { ascending: false });

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

    const stats = {
      totalTokens: tokens.length,
      total: keys.length,
      unactivated: keys.filter(k => k.status === 'unactivated').length,
      activated: keys.filter(k => k.status === 'activated').length,
      expired: keys.filter(k => k.status === 'expired').length,
      banned: keys.filter(k => k.status === 'banned').length,
      fraudAlerts: fraudLogs.length
    };

    return res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching stats." });
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
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginRateLimit) {
    if (now > v.resetTime + 60000) loginRateLimit.delete(k);
  }
}, 60000);

// [POST] /api/client/login
app.post('/api/client/login', async (req, res) => {
  const { token_string, key_string, hwid } = req.body;

  console.log(`[CLIENT LOGIN] Request: token="${token_string}", key="${key_string}", hwid="${hwid}"`);

  if (!token_string || !key_string || !hwid) {
    console.log(`[CLIENT LOGIN] Missing fields: token=${!!token_string}, key=${!!key_string}, hwid=${!!hwid}`);
    return res.status(400).json({ success: false, message: "token_string, key_string, and hwid are required." });
  }

  // Basic rate limiting
  if (!checkClientRateLimit(hwid)) {
    console.log(`[CLIENT LOGIN] Rate limited: hwid="${hwid}"`);
    return res.status(429).json({ success: false, message: "Too many requests. Please wait." });
  }

  try {
    // Step 1: Find the token by token_string
    const { data: tokenData, error: tokenError } = await supabase
      .from('tokens')
      .select('*')
      .eq('token_string', token_string)
      .maybeSingle();

    if (tokenError) throw tokenError;

    if (!tokenData) {
      return res.status(403).json({ success: false, message: "Invalid Token" });
    }

    // Step 2: Find the key by key_string
    const { data: keyData, error: keyError } = await supabase
      .from('keys_management')
      .select('*')
      .eq('key_string', key_string)
      .maybeSingle();

    if (keyError) throw keyError;

    if (!keyData) {
      await supabase.from('fraud_logs').insert([
        { hwid, reason: `Sai Key (Attempted Key: ${key_string})` }
      ]);
      return res.status(403).json({ success: false, message: "Invalid Key" });
    }

    // Step 3: Verify key.token_id matches token.id
    if (keyData.token_id !== tokenData.id) {
      await supabase.from('fraud_logs').insert([
        { hwid, reason: `Key không thuộc Token (Key: ${key_string}, Token: ${token_string})` }
      ]);
      return res.status(403).json({ success: false, message: "Key không thuộc Token này" });
    }

    // Step 4: Check banned
    if (keyData.status === 'banned') {
      return res.status(403).json({ success: false, message: "Key has been banned" });
    }

    // Step 5: If unactivated → activate
    if (keyData.status === 'unactivated') {
      let expiresAt = null;

      // -1 means lifetime key
      if (keyData.duration_days > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + keyData.duration_days);
        expiresAt = expDate.toISOString();
      }

      // Update key status to activated
      const { error: updateError } = await supabase
        .from('keys_management')
        .update({ status: 'activated', expires_at: expiresAt })
        .eq('id', keyData.id);

      if (updateError) throw updateError;

      // Insert device into key_devices
      const { error: deviceError } = await supabase
        .from('key_devices')
        .insert([{ key_id: keyData.id, hwid }]);

      if (deviceError) throw deviceError;

      const sessionToken = `SESSION_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;

      return res.json({
        success: true,
        message: "Activation successful",
        token: sessionToken,
        expires_at: expiresAt,
        token_name: tokenData.token_name,
        display_text: tokenData.display_text
      });
    }

    // Step 6: If activated
    if (keyData.status === 'activated') {
      // Check expiry first
      if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
        await supabase
          .from('keys_management')
          .update({ status: 'expired' })
          .eq('id', keyData.id);

        return res.status(403).json({ success: false, message: "Key has expired" });
      }

      // Check if this hwid already exists in key_devices for this key
      const { data: existingDevice, error: existingDeviceError } = await supabase
        .from('key_devices')
        .select('id')
        .eq('key_id', keyData.id)
        .eq('hwid', hwid)
        .maybeSingle();

      if (existingDeviceError) throw existingDeviceError;

      if (existingDevice) {
        // HWID already registered — login successful
        return res.json({
          success: true,
          message: "Login successful",
          expires_at: keyData.expires_at,
          token_name: tokenData.token_name,
          display_text: tokenData.display_text
        });
      }

      // HWID not found — check device count
      const { data: currentDevices, error: countError } = await supabase
        .from('key_devices')
        .select('id')
        .eq('key_id', keyData.id);

      if (countError) throw countError;

      const currentCount = currentDevices ? currentDevices.length : 0;

      if (currentCount < keyData.max_devices) {
        // Still room — add new device
        const { error: insertDeviceError } = await supabase
          .from('key_devices')
          .insert([{ key_id: keyData.id, hwid }]);

        if (insertDeviceError) throw insertDeviceError;

        return res.json({
          success: true,
          message: "Login successful",
          expires_at: keyData.expires_at,
          token_name: tokenData.token_name,
          display_text: tokenData.display_text
        });
      }

      // Device limit reached
      await supabase.from('fraud_logs').insert([
        { hwid, reason: `Vượt giới hạn thiết bị (Key: ${key_string}, Limit: ${keyData.max_devices})` }
      ]);
      return res.status(403).json({ success: false, message: "Đã đạt giới hạn thiết bị" });
    }

    // Step 7: If expired
    if (keyData.status === 'expired') {
      return res.status(403).json({ success: false, message: "Key has expired" });
    }

    return res.status(500).json({ success: false, message: "Unknown key state error." });

  } catch (error) {
    console.error("[CLIENT LOGIN] Internal error:", error.message || error);
    return res.status(500).json({ success: false, message: "Database or internal server error." });
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
