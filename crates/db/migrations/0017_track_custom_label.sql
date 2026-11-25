ALTER TABLE tracks
  ALTER COLUMN difficulty TYPE TEXT,
  ALTER COLUMN difficulty SET DEFAULT '';

UPDATE tracks
SET difficulty = ''
WHERE LOWER(BTRIM(difficulty)) IN ('beginner', 'intermediate', 'advanced');
