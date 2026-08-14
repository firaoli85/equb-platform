-- A GROUP BROADCAST HAS NO PERSON (D-10: one bot, one chat, one message to
-- everyone). Telegram group announcements log to message_logs with channel
-- TELEGRAM and no personId — attaching them to a member would put a group
-- message in somebody's personal history.
--
-- `channel` is already TEXT (not an enum), so 'TELEGRAM' needs no type
-- change; the one thing standing between a broadcast and its log row is the
-- NOT NULL on personId.
ALTER TABLE "message_logs" ALTER COLUMN "personId" DROP NOT NULL;
