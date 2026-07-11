-- Enable Row Level Security (RLS) on participant_sessions table
ALTER TABLE public.participant_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to prevent conflicts
DROP POLICY IF EXISTS "Allow public inserts" ON public.participant_sessions;
DROP POLICY IF EXISTS "Allow updates by session_uuid" ON public.participant_sessions;
DROP POLICY IF EXISTS "Allow select for sessions" ON public.participant_sessions;

-- 1. Enable INSERT policy for participants to start sessions (anon and authenticated roles)
CREATE POLICY "Allow public inserts" ON public.participant_sessions
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 2. Enable UPDATE policy for participants to post heartbeats and logouts
CREATE POLICY "Allow updates by session_uuid" ON public.participant_sessions
FOR UPDATE TO anon, authenticated
USING (true)
WITH CHECK (true);

-- 3. Enable SELECT policy so the admin dashboard can read session analytics
CREATE POLICY "Allow select for sessions" ON public.participant_sessions
FOR SELECT TO anon, authenticated, service_role
USING (true);
