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

async function collectExistingKeys(targetPath) {
  const keys = new Set();
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
      keys.add(key);
    }
  }

  return keys;
}

async function collectNewLines(updatePath, existingKeys) {
  const newLines = [];
  const duplicateKeys = [];
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

    if (existingKeys.has(key)) {
      duplicateKeys.push(key);
      continue;
    }

    existingKeys.add(key);
    newLines.push(trimmed);
  }

  return {
    newLines,
    duplicateKeys
  };
}

async function main() {
  const targetArg = resolveArgValue('--target');
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

  const existingKeys = await collectExistingKeys(targetPath);
  const appendChunks = [];
  const summary = [];

  for (const updatePath of resolvedUpdateFiles) {
    const { newLines, duplicateKeys } = await collectNewLines(updatePath, existingKeys);
    if (newLines.length > 0) {
      appendChunks.push(newLines.join('\n'));
    }

    summary.push({
      file: path.basename(updatePath),
      appended: newLines.length,
      duplicatesSkipped: duplicateKeys.length
    });
  }

  if (appendChunks.length > 0) {
    const prefix = fs.statSync(targetPath).size > 0 ? '\n' : '';
    fs.appendFileSync(targetPath, `${prefix}${appendChunks.join('\n')}\n`, 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        target: targetPath,
        files: summary,
        totalAppended: summary.reduce((sum, item) => sum + item.appended, 0)
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
