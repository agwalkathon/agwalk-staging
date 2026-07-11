-- Create public.participant_sessions table for tracking participant sessions
CREATE TABLE IF NOT EXISTS public.participant_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_uuid VARCHAR(100) UNIQUE NOT NULL,      -- Unique token grouping login to logout
    device_uuid VARCHAR(100) NOT NULL,              -- Persistent browser/device fingerprint
    emp_code VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    athlete_name VARCHAR(255),
    login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    logout_at TIMESTAMPTZ,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    device_type VARCHAR(20) NOT NULL,               -- 'Mobile' | 'Web'
    device_name VARCHAR(100) NOT NULL,              -- e.g. 'Chrome on Windows 11', 'Safari on iOS'
    ip_address VARCHAR(45) NOT NULL,                -- Captures IPv4 or IPv6
    user_agent TEXT NOT NULL,
    pwa_installed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indices for performance filtering
CREATE INDEX IF NOT EXISTS idx_sessions_emp_code ON public.participant_sessions(emp_code);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON public.participant_sessions(last_active_at, logout_at);

-- Grant permissions for anon and authenticated access
GRANT ALL ON TABLE public.participant_sessions TO anon;
GRANT ALL ON TABLE public.participant_sessions TO authenticated;
GRANT ALL ON TABLE public.participant_sessions TO service_role;
