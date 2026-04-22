import { Router } from 'express';
import { readFile, writeFile, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const router = Router();
const SKILLS_FILE = join(homedir(), '.cc-gui', 'skills.json');

function loadSkills() {
  try {
    if (existsSync(SKILLS_FILE)) return JSON.parse(readFile(SKILLS_FILE, 'utf8'));
  } catch {}
  return { skills: [] };
}

function saveSkills(data) {
  const dir = join(homedir(), '.cc-gui');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFile(SKILLS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (_req, res) => res.json(loadSkills()));
router.put('/', (req, res) => { saveSkills(req.body); res.json(req.body); });

export default router;
