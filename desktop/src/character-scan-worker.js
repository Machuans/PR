const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');

function postProgress(patch) {
  parentPort.postMessage({
    type: 'progress',
    progress: {
      phase: 'scanning',
      scannedDirs: 0,
      scannedFiles: 0,
      foundCharacters: 0,
      ...patch,
    },
  });
}

function readCharacterTemplate(templatePath) {
  if (!templatePath || !fs.existsSync(templatePath)) {
    return { path: templatePath || null, data: null, error: 'Character template was not found.' };
  }

  try {
    return {
      path: templatePath,
      data: JSON.parse(fs.readFileSync(templatePath, 'utf8')),
    };
  } catch (error) {
    return { path: templatePath, data: null, error: error.message };
  }
}

function readWorldInfoTemplate(templatePath) {
  if (!templatePath || !fs.existsSync(templatePath)) {
    return { path: templatePath || null, entries: [], error: 'World info template was not found.' };
  }

  try {
    const entries = fs.readFileSync(templatePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { path: templatePath, entries };
  } catch (error) {
    return { path: templatePath, entries: [], error: error.message };
  }
}

function summarizeCharacterJson(filePath, source) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const data = raw.data || raw;
    const name = data.name || path.basename(filePath, path.extname(filePath));
    return {
      id: `${source}:${filePath}`,
      name,
      subtitle: data.character_version || data.creator_notes || data.scenario || '',
      description: data.description || '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      source,
      filePath,
      type: 'json',
    };
  } catch (error) {
    return {
      id: `${source}:${filePath}`,
      name: path.basename(filePath, path.extname(filePath)),
      subtitle: '读取失败',
      description: error.message,
      tags: [],
      source,
      filePath,
      type: 'json',
      error: error.message,
    };
  }
}

function summarizeCharacterFile(filePath, source) {
  if (/\.json$/i.test(filePath)) {
    return summarizeCharacterJson(filePath, source);
  }

  return {
    id: `${source}:${filePath}`,
    name: path.basename(filePath, path.extname(filePath)),
    subtitle: '图片角色卡',
    description: '图片角色卡会由 SillyTavern 读取，PR Desktop 仅展示文件入口。',
    tags: [],
    source,
    filePath,
    type: path.extname(filePath).replace('.', '').toLowerCase() || 'file',
  };
}

function listCharacterFilesInDir(dir, source, progress) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  progress.scannedDirs += 1;
  postProgress({ ...progress, phase: `扫描 ${path.basename(dir) || dir}` });

  const characters = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(json|png|webp)$/i.test(entry.name)) {
      continue;
    }

    progress.scannedFiles += 1;
    const character = summarizeCharacterFile(path.join(dir, entry.name), source);
    characters.push(character);
    progress.foundCharacters += 1;

    if (progress.scannedFiles % 10 === 0) {
      postProgress({ ...progress });
    }
  }

  return characters;
}

function getSillyTavernCharacterDirs(sillyTavernDir) {
  const dataDir = path.join(sillyTavernDir, 'data');
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dataDir, entry.name, 'characters'))
    .filter((dir) => fs.existsSync(dir));
}

function scanCharacters() {
  const {
    localCharacterDir,
    sillyTavernDir,
    characterTemplatePath,
    worldInfoTemplatePath,
  } = workerData;
  const progress = {
    phase: '读取模板',
    scannedDirs: 0,
    scannedFiles: 0,
    foundCharacters: 0,
  };

  postProgress(progress);
  const template = readCharacterTemplate(characterTemplatePath);
  const worldInfo = readWorldInfoTemplate(worldInfoTemplatePath);
  const localCharacters = listCharacterFilesInDir(localCharacterDir, 'PR Local', progress);
  const sillyTavernDirs = getSillyTavernCharacterDirs(sillyTavernDir);
  const sillyTavernCharacters = sillyTavernDirs.flatMap((dir) => (
    listCharacterFilesInDir(dir, `SillyTavern:${path.basename(path.dirname(dir))}`, progress)
  ));

  const templateCharacter = template.data ? {
    id: 'template:character-card-v2',
    name: template.data.data?.name || '角色卡模板',
    subtitle: 'PR 结构化角色卡模板',
    description: template.data.data?.description || '',
    tags: template.data.data?.tags || [],
    source: 'Template',
    filePath: template.path,
    type: 'template',
  } : null;
  const characters = [
    ...(templateCharacter ? [templateCharacter] : []),
    ...localCharacters,
    ...sillyTavernCharacters,
  ];

  postProgress({
    ...progress,
    phase: '完成',
    foundCharacters: characters.length,
  });

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    characters,
    template,
    worldInfo,
    paths: {
      localCharacterDir,
      sillyTavernDir,
      sillyTavernCharacterDirs: sillyTavernDirs,
    },
  };
}

try {
  parentPort.postMessage({ type: 'result', payload: scanCharacters() });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    error: error.message,
    stack: error.stack,
  });
}
