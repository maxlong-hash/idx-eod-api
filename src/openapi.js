export function getRequestBaseUrl(request, configuredPublicBaseUrl = null) {
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = request.get?.('x-forwarded-proto');
  const protocol = forwardedProto ?? request.protocol ?? 'http';
  const host = request.get?.('host') ?? request.headers?.host ?? '127.0.0.1:3000';

  return `${protocol}://${host}`;
}

export function buildOpenApiSchema(baseUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'IDX EOD History API',
      version: '1.0.0',
      description:
        'Read-only API for retrieving full raw IDX end-of-day history for a ticker, either across the full available range or for a custom date range.'
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    paths: {
      '/api/eod/history': {
        get: {
          operationId: 'getEodHistory',
          summary: 'Get full raw EOD history',
          description:
            'Returns full raw EOD history for a ticker. If no dates are provided, the API returns the full available range. Default format is file_url so ChatGPT can fetch the CSV as a file. Use format=json for inline JSON or format=csv for inline CSV.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Stock ticker, for example BBCA.'
            },
            {
              name: 'startDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional custom start date in YYYY-MM-DD format.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional custom end date in YYYY-MM-DD format.'
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'asc'
              },
              description: 'Sort order for returned rows. Default is asc.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['file_url', 'json', 'csv'],
                default: 'file_url'
              },
              description: 'Response format. file_url returns a downloadable CSV file URL in openaiFileResponse.'
            }
          ],
          responses: {
            '200': {
              description: 'Raw EOD history.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        $ref: '#/components/schemas/EodHistoryResponse'
                      },
                      {
                        $ref: '#/components/schemas/EodHistoryFileResponse'
                      }
                    ]
                  }
                },
                'text/csv': {
                  schema: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        EodRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ticker: { type: 'string' },
            date: { type: 'string', format: 'date' },
            open: { type: ['number', 'null'] },
            high: { type: ['number', 'null'] },
            low: { type: ['number', 'null'] },
            close: { type: ['number', 'null'] },
            volume: { type: ['number', 'null'] },
            tradeFrequency: { type: ['number', 'null'] },
            tradeValue: { type: ['number', 'null'] },
            nbsa: { type: ['number', 'null'] },
            previousClose: { type: ['number', 'null'] },
            change: { type: ['number', 'null'] },
            changePercent: { type: ['number', 'null'] },
            documentUrl: { type: 'string' }
          },
          required: [
            'id',
            'ticker',
            'date',
            'open',
            'high',
            'low',
            'close',
            'volume',
            'tradeFrequency',
            'tradeValue',
            'nbsa',
            'previousClose',
            'change',
            'changePercent',
            'documentUrl'
          ]
        },
        EodHistoryResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            latestAvailableDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/EodRecord'
              }
            }
          },
          required: ['ticker', 'startDate', 'endDate', 'latestAvailableDate', 'returned', 'records']
        },
        EodHistoryFileResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            latestAvailableDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            downloadUrl: { type: 'string', format: 'uri' },
            openaiFileResponse: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uri'
              }
            }
          },
          required: [
            'ticker',
            'startDate',
            'endDate',
            'latestAvailableDate',
            'returned',
            'downloadUrl',
            'openaiFileResponse'
          ]
        }
      }
    }
  };
}
