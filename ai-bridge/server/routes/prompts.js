import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const router = Router();
const PROMPTS_FILE = join(homedir(), '.cc-gui', 'prompt.json');

function loadPrompts() {
  try {
    if (existsSync(PROMPTS_FILE)) return JSON.parse(readFile(PROMPTS_FILE, 'utf8'));
  } catch {}
  return { prompts: [], globalPrompts: [], projectPrompts: [] };
}

function savePrompts(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(PROMPTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadPrompts()));
router.put('/', (req, res) => { savePrompts(req.body); res.json(req.body); });

export default router;
