-- Create keys_management table
CREATE TABLE IF NOT EXISTS keys_management (
    id SERIAL PRIMARY KEY,
    key_string TEXT UNIQUE NOT NULL,
    duration_days INT NOT NULL,
    expires_at TIMESTAMPTZ,
    hwid TEXT,
    status TEXT NOT NULL DEFAULT 'unactivated' CHECK (status IN ('unactivated', 'activated', 'banned', 'expired')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create fraud_logs table
CREATE TABLE IF NOT EXISTS fraud_logs (
    id SERIAL PRIMARY KEY,
    hwid TEXT NOT NULL,
    reason TEXT NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_keys_management_key_string ON keys_management(key_string);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_logged_at ON fraud_logs(logged_at DESC);
