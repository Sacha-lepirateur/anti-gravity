-- Create messages table for the dating app
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender TEXT NOT NULL,
  receiver TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read messages they're involved in
CREATE POLICY "Users can read their own messages" ON messages
  FOR SELECT USING (auth.uid()::text = sender OR auth.uid()::text = receiver);

-- Create policy to allow users to insert messages
CREATE POLICY "Users can send messages" ON messages
  FOR INSERT WITH CHECK (auth.uid()::text = sender);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender, receiver);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

-- Note: Since this app uses anonymous access, we'll allow all operations
-- In production, you'd want proper authentication