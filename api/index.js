const express = require('express');
const cors = require('cors');
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

// Base health check route
app.get('/api', (req, res) => {
  res.json({ status: "ok", message: "Key Management API is operational." });
});

// ==========================================
// ADMIN ENDPOINTS (Require Admin Bearer Token)
// ==========================================

// 1. [POST] /api/admin/create-key
app.post('/api/admin/create-key', verifyAdmin, async (req, res) => {
  const { duration_days, note } = req.body;

  if (duration_days === undefined || duration_days === null) {
    return res.status(400).json({ success: false, message: "duration_days is required." });
  }

  // Generate a random unique key string formatted as KEY_XXXXXX (8 character alphanumeric code)
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let randomStr = '';
  for (let i = 0; i < 8; i++) {
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

    if (error) {
      throw error;
    }

    return res.status(201).json({ success: true, key: data });
  } catch (error) {
    console.error("Error creating key:", error);
    return res.status(500).json({ success: false, message: "Database error while generating key." });
  }
});

// 2. [POST] /api/admin/reset-hwid
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
        expires_at: null // Reset expiry timer as per reactivation policy
      })
      .eq('key_string', key_string)
      .select();

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    return res.json({ success: true, message: "Hardware ID reset successfully." });
  } catch (error) {
    console.error("Error resetting HWID:", error);
    return res.status(500).json({ success: false, message: "Database error during HWID reset." });
  }
});

// 3. [DELETE] /api/admin/delete-key
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

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: "Key not found." });
    }

    return res.json({ success: true, message: "Key deleted successfully." });
  } catch (error) {
    console.error("Error deleting key:", error);
    return res.status(500).json({ success: false, message: "Database error while deleting key." });
  }
});

// 4. [GET] /api/admin/get-keys
app.get('/api/admin/get-keys', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('keys_management')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({ success: true, keys: data });
  } catch (error) {
    console.error("Error fetching keys:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching keys." });
  }
});

// 5. [GET] /api/admin/get-fraud
app.get('/api/admin/get-fraud', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('fraud_logs')
      .select('*')
      .order('logged_at', { ascending: false });

    if (error) {
      throw error;
    }

    return res.json({ success: true, logs: data });
  } catch (error) {
    console.error("Error fetching fraud logs:", error);
    return res.status(500).json({ success: false, message: "Database error while fetching fraud logs." });
  }
});


// ==========================================
// CLIENT ENDPOINTS (For ImGui client verification)
// ==========================================

// 1. [POST] /api/client/login
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

    if (keyError) {
      throw keyError;
    }

    // 2. Handle invalid key
    if (!keyData) {
      // Log invalid key login attempt
      await supabase.from('fraud_logs').insert([
        {
          hwid,
          reason: `Sai Key (Attempted Key: ${key_string})`
        }
      ]);

      return res.status(403).json({ success: false, message: "Invalid Key" });
    }

    // 3. Handle banned key
    if (keyData.status === 'banned') {
      return res.status(403).json({ success: false, message: "Key has been banned" });
    }

    const durationDays = keyData.duration_days;

    // 4. Handle unactivated key
    if (keyData.status === 'unactivated') {
      let expiresAt = null;

      // -1 means lifetime key, so expires_at remains null
      if (durationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + durationDays);
        expiresAt = expDate.toISOString();
      }

      // Update key status to activated, bind HWID and calculate expiration time
      const { error: updateError } = await supabase
        .from('keys_management')
        .update({
          hwid,
          status: 'activated',
          expires_at: expiresAt
        })
        .eq('key_string', key_string);

      if (updateError) {
        throw updateError;
      }

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
        // Update key status to expired in database
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
        // HWID mismatch - log fraud attempt
        await supabase.from('fraud_logs').insert([
          {
            hwid,
            reason: `Bypass Login (Key: ${key_string} - Khác HWID)`
          }
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

// Start listening if run directly (useful for local development)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
