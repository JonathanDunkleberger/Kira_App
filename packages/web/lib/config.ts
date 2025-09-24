export const publicEnv = {
  NEXT_PUBLIC_WEBSOCKET_URL:
    process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'wss://kira-socket-server.onrender.com',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
};
