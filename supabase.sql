-- Setup and Migration Script for Token-Based Key Management System (v3.0)

-- 1. Create tokens table
CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    token_name TEXT NOT NULL,
    token_string TEXT UNIQUE NOT NULL,
    max_devices INT NOT NULL DEFAULT 1,
    max_days INT,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create key_devices table (multi-device support)
CREATE TABLE IF NOT EXISTS key_devices (
    id SERIAL PRIMARY KEY,
    key_id INT NOT NULL, -- Will reference keys_management(id), added FK later to prevent ordering issues
    hwid TEXT NOT NULL,
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(key_id, hwid)
);

-- 3. Create or alter keys_management table
CREATE TABLE IF NOT EXISTS keys_management (
    id SERIAL PRIMARY KEY,
    key_string TEXT UNIQUE NOT NULL,
    token_id INT REFERENCES tokens(id) ON DELETE CASCADE,
    duration_days INT NOT NULL,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'unactivated' CHECK (status IN ('unactivated', 'activated', 'banned', 'expired')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Add foreign key to key_devices referencing keys_management
ALTER TABLE key_devices 
    ADD CONSTRAINT fk_key_devices_key_id 
    FOREIGN KEY (key_id) 
    REFERENCES keys_management(id) 
    ON DELETE CASCADE;

-- 5. Create fraud_logs table
CREATE TABLE IF NOT EXISTS fraud_logs (
    id SERIAL PRIMARY KEY,
    hwid TEXT NOT NULL,
    reason TEXT NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Migration logic for upgrading older schema (v1.0/v2.0 -> v3.0)
DO $$
BEGIN
    -- Add token_id to keys_management if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='keys_management' AND column_name='token_id') THEN
        ALTER TABLE keys_management ADD COLUMN token_id INT REFERENCES tokens(id) ON DELETE CASCADE;
    END IF;

    -- If the old keys_management table still has a standalone 'hwid' column, migrate its data to key_devices and drop it
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='keys_management' AND column_name='hwid') THEN
        INSERT INTO key_devices (key_id, hwid)
        SELECT id, hwid FROM keys_management WHERE hwid IS NOT NULL
        ON CONFLICT DO NOTHING;

        ALTER TABLE keys_management DROP COLUMN hwid;
    END IF;
END $$;

-- 7. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_keys_management_key_string ON keys_management(key_string);
CREATE INDEX IF NOT EXISTS idx_keys_management_token_id ON keys_management(token_id);
CREATE INDEX IF NOT EXISTS idx_key_devices_key_id ON key_devices(key_id);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_logged_at ON fraud_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_token_string ON tokens(token_string);

