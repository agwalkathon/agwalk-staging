-- Create athlete_points_summary table to cache calculated leaderboard scores
CREATE TABLE IF NOT EXISTS public.athlete_points_summary (
    athlete_id text NOT NULL,
    event_id integer NOT NULL,
    full_name text,
    gender text,
    shift text,
    leaderboard_team text,
    total_distance_km numeric(10,2) DEFAULT 0.00,
    total_moving_time_sec integer DEFAULT 0,
    activities_count integer DEFAULT 0,
    base_points numeric(10,2) DEFAULT 0.00,
    bonus_points numeric(10,2) DEFAULT 0.00,
    challenge_points numeric(10,2) DEFAULT 0.00,
    total_points numeric(10,2) DEFAULT 0.00,
    old_total_points numeric(10,2) DEFAULT 0.00,
    last_updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (athlete_id, event_id)
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.athlete_points_summary ENABLE ROW LEVEL SECURITY;

-- Create public select policy
CREATE POLICY "Allow public read access to athlete_points_summary" 
ON public.athlete_points_summary FOR SELECT 
TO public 
USING (true);

-- Create public insert/update/delete policy (matching registration table access)
CREATE POLICY "Allow anon insert/update/delete to athlete_points_summary" 
ON public.athlete_points_summary FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);
