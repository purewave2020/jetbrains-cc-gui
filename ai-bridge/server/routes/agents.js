import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const router = Router();
const AGENTS_FILE = join(homedir(), '.cc-gui', 'agent.json');

function loadAgents() {
  try {
    if (existsSync(AGENTS_FILE)) return JSON.parse(readFile(AGENTS_FILE, 'utf8'));
  } catch {}
  return { agents: [] };
}

function saveAgents(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(AGENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadAgents()));
router.put('/', (req, res) => { saveAgents(req.body); res.json(req.body); });

export default router;
