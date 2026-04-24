import cors from 'cors';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    try {
      const url = new URL(origin);
      if (
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        [5173, 5174, 3001].includes(Number(url.port))
      ) {
        return callback(null, true);
      }
      // Allow LAN access from private networks (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) && url.port === '5174') {
        return callback(null, true);
      }
      callback(null, false);
    } catch {
      callback(null, false);
    }
  },
  credentials: true,
});
