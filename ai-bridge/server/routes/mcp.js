import { Router } from 'express';

const router = Router();

router.get('/status', async (_req, res) => {
  res.json({ servers: [] });
});

router.get('/tools', async (_req, res) => {
  res.json({ tools: [] });
});

export default router;
