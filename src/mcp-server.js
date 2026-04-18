import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

function jsonText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function csvText(csv) {
  return {
    content: [
      {
        type: 'text',
        text: csv
      }
    ]
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
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

  const lines = [headers.join(',')];

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

export function createEodMcpServer(store) {
  const server = new McpServer({
    name: 'idx-eod-history-mcp',
    version: '1.0.0'
  });

  server.registerTool(
    'get_eod_history',
    {
      title: 'Get EOD history',
      description:
        'Get full raw EOD history for a ticker from the earliest available date to the latest available date, or for a custom date range.',
      inputSchema: {
        ticker: z.string().trim().min(2).max(8).describe('Stock ticker, for example BBCA'),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional custom start date, prefer YYYY-MM-DD'),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional custom end date, prefer YYYY-MM-DD'),
        order: z
          .enum(['asc', 'desc'])
          .default('asc')
          .describe('Sort order for returned rows. Default is asc.'),
        format: z
          .enum(['json', 'csv'])
          .default('json')
          .describe('Response format. Use csv for raw export.')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ ticker, startDate, endDate, order, format }) => {
      await store.ensureLoaded();
      const latestAvailableDate = store.getLatestAvailableDate(ticker);
      if (!latestAvailableDate) {
        throw new Error(`No history found for ticker ${ticker.toUpperCase()}`);
      }

      const records = store.getHistory({
        ticker,
        startDate,
        endDate,
        order
      });

      if (records.length === 0) {
        throw new Error(
          startDate || endDate
            ? `No history found for ${ticker.toUpperCase()} in the requested date range`
            : `No history found for ${ticker.toUpperCase()}`
        );
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
        return csvText(serializeRecordsToCsv(serializedRecords));
      }

      return jsonText({
        ticker: ticker.toUpperCase(),
        startDate: earliestReturnedDate,
        endDate: latestReturnedDate,
        latestAvailableDate,
        returned: records.length,
        records: serializedRecords
      });
    }
  );

  return server;
}
