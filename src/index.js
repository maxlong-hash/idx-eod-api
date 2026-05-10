import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EodDataStore } from './eod-store.js';
import { createEodMcpServer } from './mcp-server.js';
import { buildOpenApiSchema, getRequestBaseUrl } from './openapi.js';
import { BroksumDataStore } from './broksum-store.js';
import { OwnershipDataStore } from './ownership-store.js';
import { ScreenerMaxStore } from './screener-max-store.js';

const DOWNLOAD_EXPIRES_PARAM = 'expires';
const DOWNLOAD_TOKEN_PARAM = 'downloadToken';
const DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60;

function getArgValue(flagName) {
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

function resolveOptions() {
  const transport = getArgValue('--transport') ?? process.env.MCP_TRANSPORT ?? 'http';
  const port = Number(getArgValue('--port') ?? process.env.PORT ?? 3000);
  const host = getArgValue('--host') ?? process.env.HOST ?? '127.0.0.1';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? null;
  const filePath = process.env.EOD_FILE_PATH
    ? path.resolve(process.env.EOD_FILE_PATH)
    : path.resolve(process.cwd(), 'EOD 2023-2026.txt');
  const ownershipDataDir = process.env.OWNERSHIP_DATA_DIR
    ? path.resolve(process.env.OWNERSHIP_DATA_DIR)
    : path.resolve(process.cwd(), 'data', 'ownership');
  const screenerResultsDir = process.env.SCREENER_MAX_RESULTS_DIR
    ? path.resolve(process.env.SCREENER_MAX_RESULTS_DIR)
    : path.resolve(process.cwd(), 'screner MAX');
  const broksumDataDir = process.env.BROKSUM_DATA_DIR
    ? path.resolve(process.env.BROKSUM_DATA_DIR)
    : path.resolve(process.cwd(), 'Scrape stockbit', '2023');
  const apiKey = process.env.API_KEY || process.env.EOD_API_KEY || null;
  const screenerApiKey = process.env.SCREENER_API_KEY || null;

  return {
    transport,
    port,
    host,
    publicBaseUrl,
    filePath,
    ownershipDataDir,
    screenerResultsDir,
    broksumDataDir,
    apiKey,
    screenerApiKey
  };
}

function sendError(response, statusCode, message) {
  response.status(statusCode).json({ error: message });
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function serializeRecordsToCsv(records) {
  const headers = [
    '<date>',
    '<ticker>',
    '<open>',
    '<high>',
    '<low>',
    '<close>',
    '<volume>',
    '<freq>',
    '<valuasi>',
    '<nbsa>'
  ];

  const lines = [
    headers.join(',')
  ];

  for (const record of records) {
    lines.push(
      [
        record.date,
        record.ticker,
        record.open,
        record.high,
        record.low,
        record.close,
        record.volume,
        record.tradeFrequency,
        record.tradeValue,
        record.nbsa
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return lines.join('\n');
}

function flattenCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}

function serializeGenericRecordsToCsv(records) {
  const rows = Array.isArray(records) ? records : [];
  const headers = Array.from(
    rows.reduce((set, record) => {
      for (const key of Object.keys(record ?? {})) {
        set.add(key);
      }
      return set;
    }, new Set())
  );

  if (headers.length === 0) {
    return '';
  }

  return [
    headers.join(','),
    ...rows.map((record) => headers.map((header) => csvEscape(flattenCsvValue(record?.[header]))).join(','))
  ].join('\n');
}

function canonicalizeDownloadParams(searchParams) {
  const pairs = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === DOWNLOAD_EXPIRES_PARAM || key === DOWNLOAD_TOKEN_PARAM) {
      continue;
    }

    pairs.push([key, value]);
  }

  pairs.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey === rightKey) {
      return leftValue.localeCompare(rightValue);
    }

    return leftKey.localeCompare(rightKey);
  });

  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function signDownloadToken(apiKey, pathname, searchParams, expiresAt) {
  const canonicalQuery = canonicalizeDownloadParams(searchParams);
  const payload = `${pathname}\n${canonicalQuery}\n${expiresAt}`;

  return crypto
    .createHmac('sha256', apiKey)
    .update(payload)
    .digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidBearerOrApiKey(request, apiKey) {
  const authorization = request.get?.('authorization') ?? '';
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : null;
  const headerToken = request.get?.('x-api-key') ?? null;

  return bearerToken === apiKey || headerToken === apiKey;
}

function hasValidSignedDownloadToken(request, apiKey) {
  const url = new URL(request.originalUrl ?? request.url, 'http://localhost');
  const pathname = url.pathname;

  if (!pathname.startsWith('/files/')) {
    return false;
  }

  const token = url.searchParams.get(DOWNLOAD_TOKEN_PARAM);
  const expiresAt = Number(url.searchParams.get(DOWNLOAD_EXPIRES_PARAM));

  if (!token || !Number.isFinite(expiresAt)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiresAt < now) {
    return false;
  }

  const expectedToken = signDownloadToken(apiKey, pathname, url.searchParams, String(expiresAt));
  return safeEqual(token, expectedToken);
}

function requireApiKey(apiKey, { allowSignedDownloadToken = false } = {}) {
  return (request, response, next) => {
    if (!apiKey) {
      next();
      return;
    }

    if (
      hasValidBearerOrApiKey(request, apiKey)
      || (allowSignedDownloadToken && hasValidSignedDownloadToken(request, apiKey))
    ) {
      next();
      return;
    }

    response.status(401).json({ error: 'Missing or invalid API key' });
  };
}

function buildHistoryFilename(ticker, startDate, endDate) {
  return `${ticker}_${startDate}_${endDate}.csv`;
}

function buildProtectedDownloadUrl(baseUrl, pathname, query, apiKey) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    addOptionalParam(params, key, value);
  }

  if (apiKey) {
    const expiresAt = String(Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS);
    params.set(DOWNLOAD_EXPIRES_PARAM, expiresAt);
    params.set(DOWNLOAD_TOKEN_PARAM, signDownloadToken(apiKey, pathname, params, expiresAt));
  }

  const suffix = params.toString();
  return suffix ? `${baseUrl}${pathname}?${suffix}` : `${baseUrl}${pathname}`;
}

function buildHistoryDownloadUrl(baseUrl, { ticker, startDate, endDate, order }, apiKey) {
  const params = new URLSearchParams({
    ticker,
    startDate,
    endDate,
    order
  });

  return buildProtectedDownloadUrl(baseUrl, '/files/eod-history.csv', Object.fromEntries(params.entries()), apiKey);
}

function addOptionalParam(params, name, value) {
  if (value !== undefined && value !== null && value !== '') {
    params.set(name, String(value));
  }
}

function buildOwnershipDownloadUrl(baseUrl, fileName, query, apiKey) {
  return buildProtectedDownloadUrl(baseUrl, `/files/${fileName}.csv`, query, apiKey);
}

function buildScreenerDownloadUrl(baseUrl, query, apiKey) {
  const filteredQuery = {};
  for (const key of ['ticker', 'tickers', 'filter', 'signal', 'regime', 'quadrant', 'minScore', 'limit', 'sort']) {
    if (query[key] !== undefined && query[key] !== null && query[key] !== '') {
      filteredQuery[key] = query[key];
    }
  }

  return buildProtectedDownloadUrl(baseUrl, '/files/screener-max.csv', filteredQuery, apiKey);
}

function addScreenerFreshness(result, store) {
  const latestEodDate = store.getLatestAvailableDate();
  const isStale = Boolean(result.snapshotDate && latestEodDate && result.snapshotDate < latestEodDate);

  return {
    ...result,
    latestEodDate,
    isStale,
    staleReason: isStale
      ? `Screener snapshot ${result.snapshotDate} is older than latest EOD date ${latestEodDate}. Regenerate the screner MAX export.`
      : null
  };
}

async function startStdioServer(store) {
  const server = createEodMcpServer(store);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`[idx-eod-mcp] stdio server ready with dataset ${store.filePath}`);

  const shutdown = async () => {
    await server.close();
    await transport.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startHttpServer(store, ownershipStore, screenerStore, broksumStore, options) {
  const app = createMcpExpressApp({ host: options.host });
  const requireDataAuth = requireApiKey(options.apiKey, { allowSignedDownloadToken: true });
  const requireScreenerAuth = requireApiKey(options.apiKey ? null : options.screenerApiKey, {
    allowSignedDownloadToken: true
  });

  app.get('/', async (_request, response) => {
    response.json({
      name: 'idx-eod-mcp',
      status: 'ok',
      transport: 'http',
      mcpEndpoint: '/mcp',
      openApiEndpoint: '/openapi.json',
      privacyPolicyEndpoint: '/privacy',
      historyEndpoint: '/api/eod/history',
      ihsgEndpoint: '/api/eod/ihsg',
      screenerMaxEndpoint: '/api/screener/max',
      broksumEndpoints: {
        availability: '/api/broksum/availability',
        tickerHistory: '/api/broksum/ticker/history',
        tickerBrokers: '/api/broksum/ticker/brokers',
        marketRanking: '/api/broksum/market/ranking',
        raw: '/api/broksum/raw',
        brokerHistory: '/api/broksum/broker/history',
        signal: '/api/broksum/signal',
        compare: '/api/broksum/compare',
        export: '/api/broksum/export'
      },
      authRequiredForDataEndpoints: Boolean(options.apiKey),
      ownershipEndpoints: {
        holders: '/api/ownership/holders',
        history: '/api/ownership/history',
        compare: '/api/ownership/compare',
        investorHoldings: '/api/ownership/investor-holdings',
        holderCompare: '/api/ownership/holder-compare',
        investorCompare: '/api/ownership/investor-compare',
        network: '/api/ownership/network'
      },
      stats: store.getStats(),
      ownershipStats: ownershipStore.getStats(),
      screenerMaxStats: screenerStore.getStats(),
      broksumStats: broksumStore.getStats()
    });
  });

  app.get('/health', async (_request, response) => {
    response.json({
      status: 'ok',
      stats: store.getStats(),
      ownershipStats: ownershipStore.getStats(),
      screenerMaxStats: screenerStore.getStats(),
      broksumStats: broksumStore.getStats()
    });
  });

  app.get('/privacy', async (request, response) => {
    const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
    response.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>IDX EOD API Privacy Policy</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.6;">
  <h1>IDX EOD API Privacy Policy</h1>
  <p>This API provides read-only access to raw IDX end-of-day stock market history from a locally maintained dataset.</p>
  <p>The API can also expose cached screner MAX stock screening results generated by the operator.</p>
  <p>The API does not require account login and does not intentionally store end-user personal information submitted through requests.</p>
  <p>Basic server logs may record request metadata such as timestamps and IP addresses for reliability and abuse prevention.</p>
  <p>Data returned by this API is limited to raw market history records for a ticker and date range.</p>
  <p>Operator contact: replace this text with your real contact email before publishing publicly.</p>
  <p>Service base URL: <a href="${baseUrl}">${baseUrl}</a></p>
</body>
</html>`);
  });

  app.get('/openapi.json', async (request, response) => {
    const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
    response.json(buildOpenApiSchema(baseUrl));
  });

  app.use(['/api', '/files', '/mcp'], requireDataAuth);

  app.get('/files/eod-history.csv', async (request, response) => {
    try {
      const ticker = String(request.query.ticker ?? '').trim();
      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const latestAvailableDate = store.getLatestAvailableDate(ticker);
      if (!latestAvailableDate) {
        sendError(response, 404, `No history found for ticker ${ticker.toUpperCase()}`);
        return;
      }

      const requestedStartDate = request.query.startDate ? String(request.query.startDate) : undefined;
      const requestedEndDate = request.query.endDate ? String(request.query.endDate) : undefined;
      const order = request.query.order === 'desc' ? 'desc' : 'asc';
      const records = store.getHistory({
        ticker,
        startDate: requestedStartDate,
        endDate: requestedEndDate,
        order
      });

      if (records.length === 0) {
        sendError(
          response,
          404,
          requestedStartDate || requestedEndDate
            ? `No history found for ${ticker.toUpperCase()} in the requested date range`
            : `No history found for ${ticker.toUpperCase()}`
        );
        return;
      }

      const serializedRecords = records.map((record) => store.serializeRecord(record));
      const startDate = serializedRecords[0]?.date ?? latestAvailableDate;
      const endDate = serializedRecords[serializedRecords.length - 1]?.date ?? latestAvailableDate;
      const fileName = buildHistoryFilename(ticker.toUpperCase(), startDate, endDate);

      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.type('text/csv; charset=utf-8').send(serializeRecordsToCsv(serializedRecords));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/files/screener-max.csv', requireScreenerAuth, async (request, response) => {
    try {
      const result = addScreenerFreshness(await screenerStore.query(request.query), store);
      const fileName = `screener-max-${result.snapshotDate ?? 'latest'}.csv`;

      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.type('text/csv; charset=utf-8').send(screenerStore.serializeToCsv(result.records));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/files/ownership-holders.csv', async (request, response) => {
    try {
      const result = ownershipStore.getHolders({
        ticker: request.query.ticker,
        period: request.query.period,
        investorType: request.query.investorType,
        localForeign: request.query.localForeign,
        minPercentage: request.query.minPercentage,
        limit: request.query.limit,
        sort: request.query.sort
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership holders found for ticker ${result.ticker}`);
        return;
      }

      const fileName = `${result.ticker}_ownership_holders_${result.period}.csv`;
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.type('text/csv; charset=utf-8').send(ownershipStore.serializeHoldersToCsv(result.records));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/files/ownership-history.csv', async (request, response) => {
    try {
      const result = ownershipStore.getHistory({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        order: request.query.order === 'desc' ? 'desc' : 'asc'
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership history found for ticker ${result.ticker}`);
        return;
      }

      const fileName = `${result.ticker}_ownership_history_${result.startDate}_${result.endDate}.csv`;
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.type('text/csv; charset=utf-8').send(ownershipStore.serializeHistoryToCsv(result.records));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  const sendHistoryResponse = async (request, response, fixedTicker = null) => {
    try {
      const ticker = fixedTicker ?? String(request.query.ticker ?? '').trim();
      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const startDate = request.query.startDate ? String(request.query.startDate) : undefined;
      const endDate = request.query.endDate ? String(request.query.endDate) : undefined;
      const order = request.query.order === 'desc' ? 'desc' : 'asc';
      const format = String(request.query.format ?? 'file_url').trim().toLowerCase();

      if (format !== 'json' && format !== 'csv' && format !== 'file_url') {
        sendError(response, 400, 'format must be one of json, csv, or file_url');
        return;
      }

      const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
      const latestAvailableDate = store.getLatestAvailableDate(ticker);
      if (!latestAvailableDate) {
        sendError(response, 404, `No history found for ticker ${ticker.toUpperCase()}`);
        return;
      }

      const records = store.getHistory({
        ticker,
        startDate,
        endDate,
        order
      });

      if (records.length === 0) {
        sendError(
          response,
          404,
          startDate || endDate
            ? `No history found for ${ticker.toUpperCase()} in the requested date range`
            : `No history found for ${ticker.toUpperCase()}`
        );
        return;
      }

      const serializedRecords = records.map((record) => store.serializeRecord(record));
      const earliestReturnedDate = records.reduce(
        (current, record) => (current === null || record.date < current ? record.date : current),
        null
      );
      const latestReturnedDate = records.reduce(
        (current, record) => (current === null || record.date > current ? record.date : current),
        null
      );

      if (format === 'csv') {
        response
          .type('text/csv; charset=utf-8')
          .send(serializeRecordsToCsv(serializedRecords));
        return;
      }

      const downloadUrl = buildHistoryDownloadUrl(baseUrl, {
        ticker: ticker.toUpperCase(),
        startDate: earliestReturnedDate,
        endDate: latestReturnedDate,
        order
      }, options.apiKey);

      if (format === 'file_url') {
        response.json({
          ticker: ticker.toUpperCase(),
          startDate: earliestReturnedDate,
          endDate: latestReturnedDate,
          latestAvailableDate,
          returned: records.length,
          downloadUrl,
          openaiFileResponse: [downloadUrl]
        });
        return;
      }

      response.json({
        ticker: ticker.toUpperCase(),
        startDate: earliestReturnedDate,
        endDate: latestReturnedDate,
        latestAvailableDate,
        returned: records.length,
        records: serializedRecords
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  };

  app.get('/api/eod/history', async (request, response) => {
    await sendHistoryResponse(request, response);
  });

  app.get('/api/eod/ihsg', async (request, response) => {
    await sendHistoryResponse(request, response, 'IHSG');
  });

  app.get('/api/screener/max', requireScreenerAuth, async (request, response) => {
    try {
      const format = String(request.query.format ?? 'json').trim().toLowerCase();
      if (format !== 'json' && format !== 'csv' && format !== 'file_url') {
        sendError(response, 400, 'format must be one of json, csv, or file_url');
        return;
      }

      const result = addScreenerFreshness(await screenerStore.query(request.query), store);

      if (format === 'csv') {
        response.type('text/csv; charset=utf-8').send(screenerStore.serializeToCsv(result.records));
        return;
      }

      if (format === 'file_url') {
        const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
        const downloadUrl = buildScreenerDownloadUrl(baseUrl, request.query, options.apiKey ?? options.screenerApiKey);
        response.json({
          name: result.name,
          sourceFile: result.sourceFile,
          snapshotDate: result.snapshotDate,
          latestEodDate: result.latestEodDate,
          isStale: result.isStale,
          staleReason: result.staleReason,
          generatedAt: result.generatedAt,
          totalMatches: result.totalMatches,
          returned: result.returned,
          downloadUrl,
          openaiFileResponse: [downloadUrl]
        });
        return;
      }

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/availability', async (request, response) => {
    try {
      response.json(await broksumStore.getAvailability({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/raw', async (request, response) => {
    try {
      response.json(await broksumStore.getRaw({
        ticker: request.query.ticker,
        date: request.query.date,
        broker: request.query.broker,
        transactionType: request.query.transactionType,
        investorGroup: request.query.investorGroup,
        limit: request.query.limit,
        sort: request.query.sort
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/ticker/history', async (request, response) => {
    try {
      response.json(await broksumStore.getTickerHistory({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        order: request.query.order,
        topN: request.query.topN,
        limit: request.query.limit
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/ticker/brokers', async (request, response) => {
    try {
      response.json(await broksumStore.getTickerBrokers({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        broker: request.query.broker,
        limit: request.query.limit,
        sort: request.query.sort,
        includeDaily: request.query.includeDaily === 'true'
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/market/ranking', async (request, response) => {
    try {
      response.json(await broksumStore.getMarketRanking({
        date: request.query.date,
        side: request.query.side,
        limit: request.query.limit,
        topN: request.query.topN
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/broker/history', async (request, response) => {
    try {
      response.json(await broksumStore.getBrokerHistory({
        broker: request.query.broker,
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        limit: request.query.limit,
        sort: request.query.sort
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/signal', async (request, response) => {
    try {
      response.json(await broksumStore.getSignal({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/compare', async (request, response) => {
    try {
      response.json(await broksumStore.compare({
        ticker: request.query.ticker,
        fromStart: request.query.fromStart,
        fromEnd: request.query.fromEnd,
        toStart: request.query.toStart,
        toEnd: request.query.toEnd
      }));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/broksum/export', async (request, response) => {
    try {
      const type = String(request.query.type ?? 'history').trim().toLowerCase();
      const format = String(request.query.format ?? 'csv').trim().toLowerCase();
      if (format !== 'json' && format !== 'csv') {
        sendError(response, 400, 'format must be json or csv');
        return;
      }

      let result;
      let records;
      if (type === 'brokers') {
        result = await broksumStore.getTickerBrokers({
          ticker: request.query.ticker,
          startDate: request.query.startDate,
          endDate: request.query.endDate,
          broker: request.query.broker,
          limit: request.query.limit,
          sort: request.query.sort
        });
        records = result.records;
      } else if (type === 'raw') {
        result = await broksumStore.getRaw({
          ticker: request.query.ticker,
          date: request.query.date,
          broker: request.query.broker,
          transactionType: request.query.transactionType,
          investorGroup: request.query.investorGroup,
          limit: request.query.limit,
          sort: request.query.sort
        });
        records = result.records.map((record) => ({
          ...record,
          brokerCode: record.broker?.code,
          brokerName: record.broker?.name
        }));
      } else {
        result = await broksumStore.getTickerHistory({
          ticker: request.query.ticker,
          startDate: request.query.startDate,
          endDate: request.query.endDate,
          order: request.query.order,
          topN: request.query.topN,
          limit: request.query.limit
        });
        records = result.records.map((record) => ({
          ticker: record.ticker,
          date: record.date,
          rawRecords: record.rawRecords,
          brokerCount: record.brokerCount,
          buyValue: record.buyValue,
          sellValue: record.sellValue,
          totalValue: record.totalValue,
          foreignNetValue: record.foreignNetValue,
          localNetValue: record.localNetValue,
          governmentNetValue: record.governmentNetValue,
          brokerConcentrationPct: record.brokerConcentrationPct,
          topNetBuyerCode: record.topNetBuyer?.code,
          topNetBuyerValue: record.topNetBuyer?.netValue,
          topNetSellerCode: record.topNetSeller?.code,
          topNetSellerValue: record.topNetSeller?.netValue,
          signalLabel: record.bandarSignal?.label,
          signalScore: record.bandarSignal?.score,
          close: record.eod?.close,
          changePercent: record.eod?.changePercent,
          nbsa: record.eod?.nbsa
        }));
      }

      if (format === 'json') {
        response.json({ ...result, exportType: type });
        return;
      }

      const ticker = String(request.query.ticker ?? 'broksum').trim().toUpperCase();
      response.setHeader('Content-Disposition', `attachment; filename="${ticker}_${type}_broksum.csv"`);
      response.type('text/csv; charset=utf-8').send(serializeGenericRecordsToCsv(records));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/holders', async (request, response) => {
    try {
      const format = String(request.query.format ?? 'file_url').trim().toLowerCase();
      if (format !== 'json' && format !== 'csv' && format !== 'file_url') {
        sendError(response, 400, 'format must be one of json, csv, or file_url');
        return;
      }

      const result = ownershipStore.getHolders({
        ticker: request.query.ticker,
        period: request.query.period,
        investorType: request.query.investorType,
        localForeign: request.query.localForeign,
        minPercentage: request.query.minPercentage,
        limit: request.query.limit,
        sort: request.query.sort
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership holders found for ticker ${result.ticker}`);
        return;
      }

      if (format === 'csv') {
        response.type('text/csv; charset=utf-8').send(ownershipStore.serializeHoldersToCsv(result.records));
        return;
      }

      const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
      const downloadUrl = buildOwnershipDownloadUrl(baseUrl, 'ownership-holders', {
        ticker: result.ticker,
        period: result.period,
        investorType: request.query.investorType,
        localForeign: request.query.localForeign,
        minPercentage: request.query.minPercentage,
        limit: request.query.limit,
        sort: request.query.sort
      }, options.apiKey);

      if (format === 'file_url') {
        response.json({
          ticker: result.ticker,
          period: result.period,
          date: result.date,
          returned: result.returned,
          downloadUrl,
          openaiFileResponse: [downloadUrl]
        });
        return;
      }

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/history', async (request, response) => {
    try {
      const format = String(request.query.format ?? 'file_url').trim().toLowerCase();
      if (format !== 'json' && format !== 'csv' && format !== 'file_url') {
        sendError(response, 400, 'format must be one of json, csv, or file_url');
        return;
      }

      const order = request.query.order === 'desc' ? 'desc' : 'asc';
      const result = ownershipStore.getHistory({
        ticker: request.query.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        order
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership history found for ticker ${result.ticker}`);
        return;
      }

      if (format === 'csv') {
        response.type('text/csv; charset=utf-8').send(ownershipStore.serializeHistoryToCsv(result.records));
        return;
      }

      const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
      const downloadUrl = buildOwnershipDownloadUrl(baseUrl, 'ownership-history', {
        ticker: result.ticker,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        order
      }, options.apiKey);

      if (format === 'file_url') {
        response.json({
          ticker: result.ticker,
          startDate: result.startDate,
          endDate: result.endDate,
          returned: result.returned,
          downloadUrl,
          openaiFileResponse: [downloadUrl]
        });
        return;
      }

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/compare', async (request, response) => {
    try {
      const result = ownershipStore.compare({
        ticker: request.query.ticker,
        from: request.query.from,
        to: request.query.to,
        metric: request.query.metric
      });

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/investor-holdings', async (request, response) => {
    try {
      const result = ownershipStore.getInvestorHoldings({
        holder: request.query.holder,
        period: request.query.period,
        ticker: request.query.ticker,
        minPercentage: request.query.minPercentage,
        limit: request.query.limit,
        sort: request.query.sort
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership holdings found for holder ${request.query.holder ?? ''}`);
        return;
      }

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/holder-compare', async (request, response) => {
    try {
      const result = ownershipStore.compareHolder({
        ticker: request.query.ticker,
        holder: request.query.holder,
        from: request.query.from,
        to: request.query.to
      });

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/investor-compare', async (request, response) => {
    try {
      const result = ownershipStore.compareInvestor({
        holder: request.query.holder,
        from: request.query.from,
        to: request.query.to,
        ticker: request.query.ticker,
        status: request.query.status,
        limit: request.query.limit
      });

      if (result.records.length === 0) {
        sendError(response, 404, `No ownership comparison found for holder ${request.query.holder ?? ''}`);
        return;
      }

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/ownership/network', async (request, response) => {
    try {
      const result = ownershipStore.getNetwork({
        period: request.query.period,
        ticker: request.query.ticker,
        holder: request.query.holder,
        limit: request.query.limit,
        neighborLimit: request.query.neighborLimit
      });

      response.json(result);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.post('/mcp', async (request, response) => {
    const server = createEodMcpServer(store);

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);

      response.on('close', async () => {
        await transport.close();
        await server.close();
      });
    } catch (error) {
      console.error('[idx-eod-mcp] HTTP transport error:', error);

      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.delete('/mcp', async (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.listen(options.port, options.host, () => {
    console.log(
      `[idx-eod-mcp] HTTP server listening on http://${options.host}:${options.port} with dataset ${store.filePath}`
    );
  });
}

async function main() {
  const options = resolveOptions();
  const store = new EodDataStore({
    filePath: options.filePath,
    publicBaseUrl: options.publicBaseUrl
  });
  const ownershipStore = new OwnershipDataStore({
    dataDir: options.ownershipDataDir
  });
  const screenerStore = new ScreenerMaxStore({
    resultsDir: options.screenerResultsDir
  });
  const broksumStore = new BroksumDataStore({
    dataDir: options.broksumDataDir,
    eodStore: store
  });

  await store.ensureLoaded();
  await ownershipStore.ensureLoaded();
  await broksumStore.ensureLoaded();
  try {
    await screenerStore.ensureLoaded();
  } catch (error) {
    console.warn(`[idx-eod-mcp] screner MAX cache not loaded: ${error.message}`);
  }

  if (options.transport === 'stdio') {
    await startStdioServer(store);
    return;
  }

  if (options.transport === 'http') {
    await startHttpServer(store, ownershipStore, screenerStore, broksumStore, options);
    return;
  }

  throw new Error(`Unsupported transport: ${options.transport}`);
}

main().catch((error) => {
  console.error('[idx-eod-mcp] fatal error:', error);
  process.exit(1);
});
