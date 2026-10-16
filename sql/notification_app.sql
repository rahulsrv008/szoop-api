-- Which app a registered phone, notification or support ticket belongs to
-- ('customer' | 'agent'). One user (one mobile) can be both a customer and an
-- agent, so pushes and notification lists are kept per app. Null: older rows
-- (shown in both apps; phones get tagged when their app registers again).
-- NotificationDispatchService also ensures these at boot. Safe to re-run.

ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS app VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS app VARCHAR(20);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS app VARCHAR(20);
