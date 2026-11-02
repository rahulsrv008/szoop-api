-- Add end_otp column to bookings table.
-- The end OTP is generated when the agent starts the job (status → ongoing)
-- and shown to the customer in their app. The agent must enter it to complete
-- the job, confirming the customer is satisfied.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_otp VARCHAR(20);
