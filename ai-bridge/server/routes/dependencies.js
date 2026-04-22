import { Router } from 'express';
import { execFile, spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { readFile, access, mkdir, writeFile } from 'fs/promises';

const router = Router();

const DEPS_DIR = join(homedir(), '.cc-gui', 'dependencies');

function getSdkPackageId(sdkId) {
  return sdkId === 'claude-sdk' ? '@anthropic-ai/claude-agent-sdk' : '@openai/codex-sdk';
}

async function getInstalledVersion(sdkId) {
  const pkgId = getSdkPackageId(sdkId);
  const pkgJsonPath = join(DEPS_DIR, sdkId, 'node_modules', pkgId, 'package.json');
  try {
    await access(pkgJsonPath);
    const content = await readFile(pkgJsonPath, 'utf-8');
    return JSON.parse(content).version;
  } catch {
    return undefined;
  }
}

async function getInstallPath(sdkId) {
  const pkgId = getSdkPackageId(sdkId);
  const pkgPath = join(DEPS_DIR, sdkId, 'node_modules', pkgId);
  try {
    await access(pkgPath);
    return pkgPath;
  } catch {
    return undefined;
  }
}

async function ensurePackageJson(dir, sdkId) {
  const pkgJsonPath = join(dir, 'package.json');
  try {
    await access(pkgJsonPath);
  } catch {
    await writeFile(pkgJsonPath, JSON.stringify({ name: `${sdkId}-local`, version: '1.0.0', private: true }, null, 2));
  }
}

function checkNodeAvailable() {
  return new Promise((resolve) => {
    execFile('node', ['--version'], (err, stdout) => {
      if (err) {
        resolve({ available: false, error: err.message });
      } else {
        resolve({ available: true, version: stdout.trim() });
      }
    });
  });
}

function fetchNpmVersions(pkgId) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFile(cmd, ['view', pkgId, 'versions', '--json'], { timeout: 15000, shell: true }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      try {
        const versions = JSON.parse(stdout);
        resolve(Array.isArray(versions) ? versions : []);
      } catch {
        resolve(null);
      }
    });
  });
}

router.get('/status', async (_req, res) => {
  const claudeInstalled = await getInstalledVersion('claude-sdk');
  const codexInstalled = await getInstalledVersion('codex-sdk');

  res.json({
    'claude-sdk': {
      id: 'claude-sdk',
      name: 'Claude Code SDK',
      status: claudeInstalled ? 'installed' : 'not_installed',
      installedVersion: claudeInstalled,
      installPath: await getInstallPath('claude-sdk'),
    },
    'codex-sdk': {
      id: 'codex-sdk',
      name: 'OpenAI Codex SDK',
      status: codexInstalled ? 'installed' : 'not_installed',
      installedVersion: codexInstalled,
      installPath: await getInstallPath('codex-sdk'),
    },
  });
});

router.get('/versions', async (_req, res) => {
  const [claudeVersions, codexVersions] = await Promise.all([
    fetchNpmVersions('@anthropic-ai/claude-agent-sdk'),
    fetchNpmVersions('@openai/codex-sdk'),
  ]);

  const result = {};

  if (claudeVersions) {
    const latest = claudeVersions[claudeVersions.length - 1];
    result['claude-sdk'] = {
      sdkId: 'claude-sdk',
      versions: claudeVersions,
      source: 'remote',
      latestVersion: latest,
    };
  } else {
    result['claude-sdk'] = {
      sdkId: 'claude-sdk',
      versions: ['1.0.0'],
      fallbackVersions: ['1.0.0'],
      source: 'fallback',
      latestVersion: '1.0.0',
    };
  }

  if (codexVersions) {
    const latest = codexVersions[codexVersions.length - 1];
    result['codex-sdk'] = {
      sdkId: 'codex-sdk',
      versions: codexVersions,
      source: 'remote',
      latestVersion: latest,
    };
  } else {
    result['codex-sdk'] = {
      sdkId: 'codex-sdk',
      versions: ['0.1.0'],
      fallbackVersions: ['0.1.0'],
      source: 'fallback',
      latestVersion: '0.1.0',
    };
  }

  res.json(result);
});

router.get('/check-updates', async (_req, res) => {
  const claudeInstalled = await getInstalledVersion('claude-sdk');
  const codexInstalled = await getInstalledVersion('codex-sdk');

  const [claudeVersions, codexVersions] = await Promise.all([
    fetchNpmVersions('@anthropic-ai/claude-agent-sdk'),
    fetchNpmVersions('@openai/codex-sdk'),
  ]);

  const result = {};

  if (claudeInstalled && claudeVersions) {
    const latest = claudeVersions[claudeVersions.length - 1];
    result['claude-sdk'] = {
      sdkId: 'claude-sdk',
      sdkName: 'Claude Code SDK',
      hasUpdate: latest !== claudeInstalled,
      currentVersion: claudeInstalled,
      latestVersion: latest,
    };
  } else {
    result['claude-sdk'] = {
      sdkId: 'claude-sdk',
      sdkName: 'Claude Code SDK',
      hasUpdate: false,
    };
  }

  if (codexInstalled && codexVersions) {
    const latest = codexVersions[codexVersions.length - 1];
    result['codex-sdk'] = {
      sdkId: 'codex-sdk',
      sdkName: 'Codex SDK',
      hasUpdate: latest !== codexInstalled,
      currentVersion: codexInstalled,
      latestVersion: latest,
    };
  } else {
    result['codex-sdk'] = {
      sdkId: 'codex-sdk',
      sdkName: 'Codex SDK',
      hasUpdate: false,
    };
  }

  res.json(result);
});

router.get('/node-environment', async (_req, res) => {
  const status = await checkNodeAvailable();
  res.json(status);
});

// Install SDK
router.post('/install', async (req, res) => {
  const { sdkId, version } = req.body;
  const pkgId = getSdkPackageId(sdkId);
  const installDir = join(DEPS_DIR, sdkId);
  const pkgToInstall = version ? `${pkgId}@${version}` : pkgId;

  try {
    await mkdir(installDir, { recursive: true });
    await ensurePackageJson(installDir, sdkId);
  } catch { /* dir may exist */ }

  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(cmd, ['install', pkgToInstall, '--save', '--no-package-lock'], {
    cwd: installDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });

  child.on('close', (code) => {
    if (code === 0) {
      const installedVersion = version || stdout.match(/@(\d+\.\d+\.\d+)/)?.[1] || 'unknown';
      res.json({ success: true, sdkId, installedVersion, output: stdout });
    } else {
      res.json({ success: false, sdkId, error: stderr || stdout || 'Install failed', output: stdout + stderr });
    }
  });

  child.on('error', (err) => {
    res.json({ success: false, sdkId, error: err.message });
  });
});

// Uninstall SDK
router.post('/uninstall', async (req, res) => {
  const { sdkId } = req.body;
  const pkgId = getSdkPackageId(sdkId);
  const installDir = join(DEPS_DIR, sdkId);

  try {
    await ensurePackageJson(installDir, sdkId);
  } catch { /* may not exist */ }

  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(cmd, ['uninstall', pkgId, '--save'], {
    cwd: installDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });

  child.on('close', (code) => {
    if (code === 0) {
      res.json({ success: true, sdkId, output: stdout });
    } else {
      res.json({ success: false, sdkId, error: stderr || stdout || 'Uninstall failed', output: stdout + stderr });
    }
  });

  child.on('error', (err) => {
    res.json({ success: false, sdkId, error: err.message });
  });
});

export default router;
