import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

function resolveArgValue(flagName) {
  const direct = process.argv.find((arg) => arg.startsWith(`${flagName}=`));
  if (direct) {
    return direct.slice(flagName.length + 1);
  }

  const index = process.argv.findIndex((arg) => arg === flagName);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return null;
}

function normalizeDate(rawDate) {
  const match = String(rawDate ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  return `${match[3]}-${match[1]}-${match[2]}`;
}

function buildKey(parts) {
  const date = normalizeDate(parts[0]);
  const ticker = String(parts[1] ?? '').trim().toUpperCase();

  if (!date || !ticker) {
    return null;
  }

  return `${date}|${ticker}`;
}

function hasFlag(flagName) {
  return process.argv.includes(flagName);
}

async function collectExistingRows(targetPath) {
  const rows = new Map();
  const stream = fs.createReadStream(targetPath, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let lineNumber = 0;

  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (lineNumber === 1 && trimmed.startsWith('<date>')) {
      continue;
    }

    const parts = trimmed.split(',');
    if (parts.length < 10) {
      continue;
    }

    const key = buildKey(parts);
    if (key) {
      rows.set(key, trimmed);
    }
  }

  return rows;
}

async function collectUpdates(updatePath, existingRows, replaceExisting) {
  const newLines = [];
  const duplicateKeys = [];
  const replacements = new Map();
  const stream = fs.createReadStream(updatePath, { encoding: 'utf8' });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let lineNumber = 0;

  for await (const line of reader) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (lineNumber === 1 && trimmed.startsWith('<date>')) {
      continue;
    }

    const parts = trimmed.split(',');
    if (parts.length < 10) {
      continue;
    }

    const key = buildKey(parts);
    if (!key) {
      continue;
    }

    const existingLine = existingRows.get(key);
    if (existingLine) {
      if (replaceExisting && existingLine !== trimmed) {
        replacements.set(key, trimmed);
        existingRows.set(key, trimmed);
      }
      duplicateKeys.push(key);
      continue;
    }

    existingRows.set(key, trimmed);
    newLines.push(trimmed);
  }

  return {
    newLines,
    duplicateKeys,
    replacements
  };
}

function applyReplacements(targetPath, replacements) {
  if (replacements.size === 0) {
    return;
  }

  const lines = fs.readFileSync(targetPath, 'utf8').split(/\r?\n/);
  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('<date>')) {
      return line;
    }

    const parts = trimmed.split(',');
    if (parts.length < 10) {
      return line;
    }

    const key = buildKey(parts);
    return key && replacements.has(key) ? replacements.get(key) : line;
  });

  fs.writeFileSync(targetPath, updatedLines.join('\n'), 'utf8');
}

async function main() {
  const targetArg = resolveArgValue('--target');
  const replaceExisting = hasFlag('--replace-existing');
  const positionalArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const updateFiles = positionalArgs.length > 0 ? positionalArgs : ['fms260420.txt'];
  const targetPath = path.resolve(targetArg ?? path.join(process.cwd(), 'EOD 2023-2026.txt'));

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target dataset not found: ${targetPath}`);
  }

  const resolvedUpdateFiles = updateFiles.map((file) => path.resolve(process.cwd(), file));
  for (const filePath of resolvedUpdateFiles) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Update file not found: ${filePath}`);
    }
  }

  const existingRows = await collectExistingRows(targetPath);
  const appendChunks = [];
  const replacements = new Map();
  const summary = [];

  for (const updatePath of resolvedUpdateFiles) {
    const result = await collectUpdates(updatePath, existingRows, replaceExisting);
    const { newLines, duplicateKeys } = result;
    if (newLines.length > 0) {
      appendChunks.push(newLines.join('\n'));
    }

    for (const [key, line] of result.replacements.entries()) {
      replacements.set(key, line);
    }

    summary.push({
      file: path.basename(updatePath),
      appended: newLines.length,
      duplicatesSkipped: duplicateKeys.length,
      replaced: result.replacements.size
    });
  }

  applyReplacements(targetPath, replacements);

  if (appendChunks.length > 0) {
    const prefix = fs.statSync(targetPath).size > 0 ? '\n' : '';
    fs.appendFileSync(targetPath, `${prefix}${appendChunks.join('\n')}\n`, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        target: targetPath,
        files: summary,
        totalAppended: summary.reduce((sum, item) => sum + item.appended, 0),
        totalReplaced: summary.reduce((sum, item) => sum + item.replaced, 0)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
