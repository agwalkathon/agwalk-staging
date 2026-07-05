-- 1. Add is_hidden to announcements table (for show/hide feed posts)
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;

-- 2. Add custom_answers to registration table (for custom registration questions)
ALTER TABLE registration ADD COLUMN IF NOT EXISTS custom_answers JSONB DEFAULT '{}'::jsonb;
