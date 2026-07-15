-- Setup and Migration Script for ServerKey Control Plane (v4.0)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Create tokens table
CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    token_name TEXT NOT NULL,
    token_string TEXT UNIQUE NOT NULL,
    max_days INT,
    description TEXT,
    display_text TEXT NOT NULL DEFAULT 'ServerKey by #wtuananh6868',
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
    max_devices INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'unactivated' CHECK (status IN ('unactivated', 'activated', 'banned', 'expired')),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Add foreign key to key_devices referencing keys_management conditionally
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_key_devices_key_id' 
          AND table_name = 'key_devices'
    ) THEN
        ALTER TABLE key_devices 
            ADD CONSTRAINT fk_key_devices_key_id 
            FOREIGN KEY (key_id) 
            REFERENCES keys_management(id) 
            ON DELETE CASCADE;
    END IF;
END $$;

-- 5. Create fraud_logs table
CREATE TABLE IF NOT EXISTS fraud_logs (
    id SERIAL PRIMARY KEY,
    hwid TEXT NOT NULL,
    reason TEXT NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Device registry. HWID remains compatible with key_devices while device
-- metadata and bans are managed independently from a license key.
CREATE TABLE IF NOT EXISTS devices (
    id BIGSERIAL PRIMARY KEY,
    hwid TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
    ban_reason TEXT,
    app_version TEXT,
    last_ip TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    banned_at TIMESTAMPTZ
);

-- 7. Short-lived client sessions. Only a SHA-256 hash of the bearer token is
-- stored; the raw token is returned once to the client.
CREATE TABLE IF NOT EXISTS client_sessions (
    id BIGSERIAL PRIMARY KEY,
    session_token_hash TEXT UNIQUE NOT NULL,
    key_id INT NOT NULL REFERENCES keys_management(id) ON DELETE CASCADE,
    device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 8. Singleton remote policy returned to authenticated clients.
CREATE TABLE IF NOT EXISTS client_config (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    menu_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    auto_update_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    minimum_version TEXT NOT NULL DEFAULT '1.0.0',
    latest_version TEXT NOT NULL DEFAULT '1.0.0',
    update_url TEXT,
    heartbeat_interval_seconds INT NOT NULL DEFAULT 45 CHECK (heartbeat_interval_seconds BETWEEN 15 AND 3600),
    announcement TEXT,
    config_revision BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO client_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 9. Generic feature/menu flags. Clients ignore keys they do not understand,
-- which lets the web panel add future flags without breaking older builds.
CREATE TABLE IF NOT EXISTS feature_flags (
    id BIGSERIAL PRIMARY KEY,
    feature_key TEXT UNIQUE NOT NULL CHECK (feature_key ~ '^[a-z][a-z0-9_]{1,63}$'),
    display_name TEXT NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feature_flags (feature_key, display_name, description, enabled, locked, sort_order)
VALUES
    ('menu_vip_core', 'VIP Core', 'Hiển thị nhóm VIP Core trên client.', TRUE, FALSE, 10),
    ('menu_aim', 'Aim', 'Hiển thị nhóm Aim trên client.', TRUE, FALSE, 20),
    ('menu_auto', 'Auto', 'Hiển thị nhóm Auto trên client.', TRUE, FALSE, 30),
    ('menu_information', 'Information', 'Hiển thị nhóm thông tin và trạng thái.', TRUE, FALSE, 40)
ON CONFLICT (feature_key) DO NOTHING;

-- 10. Migration logic for upgrading older schema (v1.0/v2.0/v3.0 -> v4.0)
DO $$
BEGIN
    -- Add token_id to keys_management if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='keys_management' AND column_name='token_id') THEN
        ALTER TABLE keys_management ADD COLUMN token_id INT REFERENCES tokens(id) ON DELETE CASCADE;
    END IF;

    -- Add max_devices to keys_management if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='keys_management' AND column_name='max_devices') THEN
        ALTER TABLE keys_management ADD COLUMN max_devices INT NOT NULL DEFAULT 1;
    END IF;

    -- Migrate max_devices value from tokens to keys_management if max_devices still exists in tokens
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tokens' AND column_name='max_devices') THEN
        UPDATE keys_management k
        SET max_devices = t.max_devices
        FROM tokens t
        WHERE k.token_id = t.id;

        ALTER TABLE tokens DROP COLUMN max_devices;
    END IF;

    -- Add display_text to tokens if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tokens' AND column_name='display_text') THEN
        ALTER TABLE tokens ADD COLUMN display_text TEXT NOT NULL DEFAULT 'ServerKey by #wtuananh6868';
    END IF;

    -- If the old keys_management table still has a standalone 'hwid' column, migrate its data to key_devices and drop it
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='keys_management' AND column_name='hwid') THEN
        INSERT INTO key_devices (key_id, hwid)
        SELECT id, hwid FROM keys_management WHERE hwid IS NOT NULL
        ON CONFLICT DO NOTHING;

        ALTER TABLE keys_management DROP COLUMN hwid;
    END IF;
END $$;

-- 11. Structured security-event columns, kept on fraud_logs for backward
-- dashboard compatibility.
ALTER TABLE fraud_logs ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE fraud_logs ADD COLUMN IF NOT EXISTS key_id INT REFERENCES keys_management(id) ON DELETE SET NULL;
ALTER TABLE fraud_logs ADD COLUMN IF NOT EXISTS device_id BIGINT REFERENCES devices(id) ON DELETE SET NULL;
ALTER TABLE fraud_logs ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 12. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_keys_management_key_string ON keys_management(key_string);
CREATE INDEX IF NOT EXISTS idx_keys_management_token_id ON keys_management(token_id);
CREATE INDEX IF NOT EXISTS idx_key_devices_key_id ON key_devices(key_id);
CREATE INDEX IF NOT EXISTS idx_fraud_logs_logged_at ON fraud_logs(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_tokens_token_string ON tokens(token_string);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen_at ON devices(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_sessions_status ON client_sessions(status);
CREATE INDEX IF NOT EXISTS idx_client_sessions_device_id ON client_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_client_sessions_last_seen_at ON client_sessions(last_seen_at DESC);

-- 13. Atomic activation/registration. The advisory lock prevents two parallel
-- requests from exceeding max_devices for the same license.
CREATE OR REPLACE FUNCTION activate_client_license(
    p_token_string TEXT,
    p_key_string TEXT,
    p_hwid TEXT,
    p_app_version TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token tokens%ROWTYPE;
    v_key keys_management%ROWTYPE;
    v_device devices%ROWTYPE;
    v_device_count INT;
BEGIN
    SELECT * INTO v_token FROM tokens WHERE token_string = p_token_string;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'invalid_token');
    END IF;

    SELECT * INTO v_key FROM keys_management WHERE key_string = p_key_string FOR UPDATE;
    IF NOT FOUND OR v_key.token_id IS DISTINCT FROM v_token.id THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'invalid_key');
    END IF;

    PERFORM pg_advisory_xact_lock(v_key.id);

    IF v_key.status = 'banned' THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'license_banned', 'key_id', v_key.id);
    END IF;

    IF v_key.status = 'expired' OR (v_key.expires_at IS NOT NULL AND v_key.expires_at <= NOW()) THEN
        UPDATE keys_management SET status = 'expired' WHERE id = v_key.id;
        RETURN jsonb_build_object('ok', FALSE, 'code', 'license_expired', 'key_id', v_key.id);
    END IF;

    INSERT INTO devices (hwid, app_version, last_ip, last_seen_at)
    VALUES (p_hwid, NULLIF(p_app_version, ''), NULLIF(p_ip, ''), NOW())
    ON CONFLICT (hwid) DO UPDATE SET
        app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
        last_ip = COALESCE(EXCLUDED.last_ip, devices.last_ip),
        last_seen_at = NOW()
    RETURNING * INTO v_device;

    IF v_device.status = 'banned' THEN
        RETURN jsonb_build_object(
            'ok', FALSE,
            'code', 'device_banned',
            'device_id', v_device.id,
            'key_id', v_key.id,
            'reason', v_device.ban_reason
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM key_devices WHERE key_id = v_key.id AND hwid = p_hwid
    ) THEN
        SELECT COUNT(*) INTO v_device_count FROM key_devices WHERE key_id = v_key.id;
        IF v_device_count >= v_key.max_devices THEN
            RETURN jsonb_build_object(
                'ok', FALSE,
                'code', 'device_limit',
                'device_id', v_device.id,
                'key_id', v_key.id,
                'limit', v_key.max_devices
            );
        END IF;

        INSERT INTO key_devices (key_id, hwid) VALUES (v_key.id, p_hwid);
    END IF;

    IF v_key.status = 'unactivated' THEN
        UPDATE keys_management
        SET status = 'activated',
            expires_at = CASE
                WHEN duration_days = -1 THEN NULL
                ELSE NOW() + make_interval(days => duration_days)
            END
        WHERE id = v_key.id
        RETURNING * INTO v_key;
    END IF;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'key_id', v_key.id,
        'device_id', v_device.id,
        'expires_at', v_key.expires_at,
        'duration_days', v_key.duration_days,
        'token_name', v_token.token_name,
        'display_text', v_token.display_text
    );
END;
$$;
