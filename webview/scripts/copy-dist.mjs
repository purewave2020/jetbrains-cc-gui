import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const distFile = path.resolve(cwd, 'dist/index.html');
const intellijTarget = path.resolve(cwd, '../src/main/resources/html/claude-chat.html');

const main = async () => {
  const html = await readFile(distFile, 'utf-8');

  // Copy to IntelliJ plugin target if it exists (plugin mode)
  if (existsSync(path.dirname(intellijTarget))) {
    await mkdir(path.dirname(intellijTarget), { recursive: true });
    await writeFile(intellijTarget, html, 'utf-8');
    console.log(`[copy-dist] 已同步 ${distFile} -> ${intellijTarget}`);
  } else {
    console.log(`[copy-dist] IntelliJ target not found, skipping (web app mode)`);
  }
};

main().catch((error) => {
  console.error('[copy-dist] 复制构建产物失败', error);
  process.exit(1);
});

