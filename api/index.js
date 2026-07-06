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
  console.error("Missing Supabase configuration. Please check your .env variables.");
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
// ADMIN ENDPOINTS (Require Admin Bearer Token)
// ==========================================

// [POST] /api/admin/create-key
app.post('/api/admin/create-key', verifyAdmin, async (req, res) => {
  const { duration_days, note } = req.body;

  if (duration_days === undefined || duration_days === null) {
    return res.status(400).json({ success: false, message: "duration_days is required." });
  }

  // Generate a strong random unique key (12 char alphanumeric)
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomStr = '';
  for (let i = 0; i < 12; i++) {
    randomStr += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  const key_string = `KEY_${randomStr}`;

  try {
    const { data, error } = await supabase
      .from('keys_management')
      .insert([
        {
          key_string,
          duration_days: parseInt(duration_days),
          note: note || '',
          status: 'unactivated',
          expires_at: null,
          hwid: null
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, key: data });
  } catch (error) {
    console.error("Error creating key:", error);
    return res.status(500).json({ success: false, message: "Database error while generating key." });
  }
});

// [POST] /api/admin/reset-hwid
app.post('/api/admin/reset-hwid', verifyAdmin, async (req, res) => {
  const { key_string } = req.body;

  if (!key_string) {
    return res.status(400).json({ success: false, message: "key_string is required." });
  }

  try {
    const { data, error } = await supabase
      .from('keys_management')
      .update({
        hwid: null,
        status: 'unactivated',
        expires_at: null
      })
      .eq('key_string', key_string)
      .select();

    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    return res.json({ success: true, message: "Hardware ID reset successfully." });
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
    // If unbanning, also reset HWID and expires_at so the key can be reused
    if (action === 'unban') {
      updateData.hwid = null;
      updateData.expires_at = null;
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

// [GET] /api/admin/get-keys
app.get('/api/admin/get-keys', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('keys_management')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return res.json({ success: true, keys: data });
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

    const stats = {
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

// [POST] /api/client/login
app.post('/api/client/login', async (req, res) => {
  const { key_string, hwid } = req.body;

  if (!key_string || !hwid) {
    return res.status(400).json({ success: false, message: "key_string and hwid are required." });
  }

  try {
    // 1. Check if the key exists
    const { data: keyData, error: keyError } = await supabase
      .from('keys_management')
      .select('*')
      .eq('key_string', key_string)
      .maybeSingle();

    if (keyError) throw keyError;

    // 2. Handle invalid key
    if (!keyData) {
      await supabase.from('fraud_logs').insert([
        { hwid, reason: `Sai Key (Attempted Key: ${key_string})` }
      ]);
      return res.status(403).json({ success: false, message: "Invalid Key" });
    }

    // 3. Handle banned key
    if (keyData.status === 'banned') {
      return res.status(403).json({ success: false, message: "Key has been banned" });
    }

    const durationDays = keyData.duration_days;

    // 4. Handle unactivated key — first activation
    if (keyData.status === 'unactivated') {
      let expiresAt = null;

      // -1 means lifetime key
      if (durationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + durationDays);
        expiresAt = expDate.toISOString();
      }

      const { error: updateError } = await supabase
        .from('keys_management')
        .update({ hwid, status: 'activated', expires_at: expiresAt })
        .eq('key_string', key_string);

      if (updateError) throw updateError;

      const token = `SESSION_${Math.random().toString(36).substring(2, 15).toUpperCase()}`;

      return res.json({
        success: true,
        message: "Activation successful",
        token,
        expires_at: expiresAt
      });
    }

    // 5. Handle activated key
    if (keyData.status === 'activated') {
      // Check if key is expired
      if (keyData.expires_at && new Date() > new Date(keyData.expires_at)) {
        await supabase
          .from('keys_management')
          .update({ status: 'expired' })
          .eq('key_string', key_string);

        return res.status(403).json({ success: false, message: "Key has expired" });
      }

      // Check if HWID matches
      if (keyData.hwid === hwid) {
        return res.json({
          success: true,
          message: "Login successful",
          expires_at: keyData.expires_at
        });
      } else {
        // HWID mismatch — fraud alert
        await supabase.from('fraud_logs').insert([
          { hwid, reason: `Bypass Login (Key: ${key_string} - Khác HWID)` }
        ]);
        return res.status(403).json({ success: false, message: "Key đã dùng cho máy khác" });
      }
    }

    // 6. Handle expired key status
    if (keyData.status === 'expired') {
      return res.status(403).json({ success: false, message: "Key has expired" });
    }

    return res.status(500).json({ success: false, message: "Unknown key state error." });

  } catch (error) {
    console.error("Client login processing error:", error);
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
