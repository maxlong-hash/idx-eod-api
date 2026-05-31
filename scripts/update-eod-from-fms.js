import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    fmsFiles: [],
    target: process.env.EOD_FILE_PATH ? path.resolve(process.env.EOD_FILE_PATH) : path.join(ROOT_DIR, 'EOD 2023-2026.txt'),
    outputDir: path.join(ROOT_DIR, 'tmp', 'ihsg-update'),
    python: process.env.PYTHON_BIN || 'python',
    ihsgStartDate: null,
    ihsgEndDate: null,
    replaceExisting: true,
    runScreener: true
  };

  const valueFlags = new Set(['--target', '--output-dir', '--python', '--ihsg-start-date', '--ihsg-end-date']);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, directValue] = arg.split(/=(.*)/s, 2);

    if (name === '--target') {
      options.target = path.resolve(directValue ?? argv[++index]);
    } else if (name === '--output-dir') {
      options.outputDir = path.resolve(directValue ?? argv[++index]);
    } else if (name === '--python') {
      options.python = directValue ?? argv[++index];
    } else if (name === '--ihsg-start-date') {
      options.ihsgStartDate = directValue ?? argv[++index];
    } else if (name === '--ihsg-end-date') {
      options.ihsgEndDate = directValue ?? argv[++index];
    } else if (arg === '--no-replace-existing') {
      options.replaceExisting = false;
    } else if (arg === '--skip-screener') {
      options.runScreener = false;
    } else if (arg.startsWith('--')) {
      if (valueFlags.has(arg)) index += 1;
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.fmsFiles.push(path.resolve(arg));
    }
  }

  if (options.fmsFiles.length === 0) {
    throw new Error('Usage: npm run eod:update:auto -- <fms-file> [more-fms-files]');
  }

  return options;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeDatasetDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

async function inferDateRange(files) {
  const dates = [];

  for (const file of files) {
    const text = await fsp.readFile(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('<date>')) continue;

      const [rawDate] = trimmed.split(',');
      const date = normalizeDatasetDate(rawDate);
      if (date) dates.push(date);
    }
  }

  if (dates.length === 0) {
    throw new Error('Unable to infer trading date from FMS file. Expected <date> values like MM/DD/YYYY.');
  }

  dates.sort();
  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1]
  };
}

function runCommand(command, args, { cwd = ROOT_DIR } = {}) {
  return new Promise((resolve, reject) => {
    console.error(`[run] ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function findNewestIhsgFile(outputDir) {
  const entries = await fsp.readdir(outputDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^IHSG\d{8}\.txt$/i.test(entry.name)) continue;
    const filePath = path.join(outputDir, entry.name);
    const stats = await fsp.stat(filePath);
    files.push({ filePath, mtimeMs: stats.mtimeMs });
  }

  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return files[0]?.filePath ?? null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  for (const file of options.fmsFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`FMS file not found: ${file}`);
    }
  }
  if (!fs.existsSync(options.target)) {
    throw new Error(`Target EOD file not found: ${options.target}`);
  }

  const inferredRange = await inferDateRange(options.fmsFiles);
  const ihsgStartDate = options.ihsgStartDate ?? inferredRange.startDate;
  const ihsgEndDate = options.ihsgEndDate ?? inferredRange.endDate;

  await fsp.mkdir(options.outputDir, { recursive: true });

  const ihsgScript = path.join(ROOT_DIR, 'EOD IHSG', 'IHSG.py');
  await runCommand(options.python, [
    ihsgScript,
    '--headless',
    '--start-date',
    ihsgStartDate,
    '--end-date',
    ihsgEndDate,
    '--output-dir',
    options.outputDir
  ]);

  const ihsgFile = await findNewestIhsgFile(options.outputDir);
  if (!ihsgFile) {
    throw new Error(`IHSG downloader did not create an IHSG*.txt file in ${options.outputDir}`);
  }

  const updateArgs = [
    'scripts/apply-eod-update.js',
    ...options.fmsFiles,
    ihsgFile,
    `--target=${options.target}`
  ];
  if (options.replaceExisting) updateArgs.push('--replace-existing');
  await runCommand(process.execPath, updateArgs);

  if (options.runScreener) {
    await runCommand(process.execPath, [
      'node_modules/tsx/dist/cli.mjs',
      'screener-max/scripts/export-max-screener.ts'
    ]);
  }

  console.log(JSON.stringify({
    target: options.target,
    fmsFiles: options.fmsFiles,
    ihsgFile,
    ihsgStartDate,
    ihsgEndDate,
    screenerUpdated: options.runScreener
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
