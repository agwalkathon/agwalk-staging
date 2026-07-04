-- =========================================================================
-- GRANT SELECT ON MISSING STATUS & PROFILE_PHOTO COLUMNS TO PUBLIC ROLES
-- Run this in your Supabase SQL Editor to restore employee/participant logins
-- =========================================================================

-- 1. Grant SELECT on status and profile_photo to the public anon role
GRANT SELECT (status, profile_photo) ON public.registration TO anon;

-- 2. Grant SELECT on status and profile_photo to the authenticated role
GRANT SELECT (status, profile_photo) ON public.registration TO authenticated;
