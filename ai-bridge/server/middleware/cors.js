import cors from 'cors';

export const corsMiddleware = cors({
  origin: ['http://localhost:5173', 'http://localhost:3001'],
  credentials: true,
});
