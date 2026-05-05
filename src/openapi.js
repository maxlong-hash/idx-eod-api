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
            'Returns raw EOD history for one ticker. Default format=file_url returns a CSV file URL. Use format=json or format=csv for inline data.',
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
      },
      '/api/eod/ihsg': {
        get: {
          operationId: 'getIhsgHistory',
          summary: 'Get raw IHSG EOD history',
          description:
            'Returns raw IHSG index EOD history. Default format=file_url returns a CSV file URL. Use optional dates for a custom range.',
          parameters: [
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
              description: 'Raw IHSG EOD history.',
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
      },
      '/api/ownership/holders': {
        get: {
          operationId: 'getOwnershipHolders',
          summary: 'Get ownership holders',
          description:
            'Returns shareholder ownership rows for a ticker and period. Default format=file_url returns a CSV URL.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional period YYYY-MM. Defaults to latest holder snapshot.'
            },
            {
              name: 'investorType',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional investor type filter, for example CP, IS, ID, MF, SC.'
            },
            {
              name: 'localForeign',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['L', 'F', 'LOCAL', 'FOREIGN'] },
              description: 'Optional local or foreign filter.'
            },
            {
              name: 'minPercentage',
              in: 'query',
              required: false,
              schema: { type: 'number' },
              description: 'Optional minimum ownership percentage.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
              description: 'Maximum rows to return.'
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['percentage_desc', 'shares_desc', 'name_asc'],
                default: 'percentage_desc'
              },
              description: 'Sort order.'
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
              description: 'Response format. file_url returns a downloadable CSV URL.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership holder rows.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/OwnershipHoldersResponse' },
                      { $ref: '#/components/schemas/OwnershipFileResponse' }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/history': {
        get: {
          operationId: 'getOwnershipHistory',
          summary: 'Get ownership history',
          description:
            'Returns monthly local and foreign ownership history for a ticker. Default format=file_url returns CSV.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'startDate',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional start date or period, for example 2026-02 or 2026-02-01.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional end date or period, for example 2026-03 or 2026-03-31.'
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
              description: 'Sort order.'
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
              description: 'Response format. file_url returns a downloadable CSV URL.'
            }
          ],
          responses: {
            '200': {
              description: 'Monthly ownership history.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/OwnershipHistoryResponse' },
                      { $ref: '#/components/schemas/OwnershipFileResponse' }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/compare': {
        get: {
          operationId: 'compareOwnership',
          summary: 'Compare ownership metric',
          description:
            'Compares one ownership metric between two dates or monthly periods for a ticker.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'from',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Start date or period, for example 2026-02.'
            },
            {
              name: 'to',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'End date or period, for example 2026-03.'
            },
            {
              name: 'metric',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'local_total' },
              description: 'Metric such as local_total, foreign_total, or price.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership metric comparison.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipCompareResponse' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/investor-holdings': {
        get: {
          operationId: 'getOwnershipInvestorHoldings',
          summary: 'Get holder stock list',
          description:
            'Returns stocks held by one ownership holder in a period. Example holder=PANIN.',
          parameters: [
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder or investor name search text.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional ticker filter.'
            },
            {
              name: 'minPercentage',
              in: 'query',
              required: false,
              schema: { type: 'number' },
              description: 'Optional minimum ownership percentage.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 2000 },
              description: 'Maximum rows.'
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['percentage_desc', 'shares_desc', 'ticker_asc'],
                default: 'percentage_desc'
              },
              description: 'Sort order.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder stock list.',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      },
      '/api/ownership/holder-compare': {
        get: {
          operationId: 'compareOwnershipHolder',
          summary: 'Compare holder in a stock',
          description:
            'Compares one holder in one ticker between two periods. Use for accumulation or distribution.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder search text, for example PANIN.'
            },
            {
              name: 'from',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Start period YYYY-MM. Defaults to previous snapshot.'
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'End period YYYY-MM. Defaults to latest snapshot.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder comparison.',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      },
      '/api/ownership/investor-compare': {
        get: {
          operationId: 'compareOwnershipInvestor',
          summary: 'Compare holder portfolio',
          description:
            'Compares all stocks held by one holder between two periods.',
          parameters: [
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder search text, for example PANIN.'
            },
            {
              name: 'from',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Start period YYYY-MM. Defaults to previous snapshot.'
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'End period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional ticker filter.'
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['new', 'removed', 'increased', 'decreased', 'scripless_shift', 'script_shift', 'rebalanced', 'unchanged']
              },
              description: 'Optional change status filter.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 1000 },
              description: 'Maximum rows.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder portfolio comparison.',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      },
      '/api/ownership/network': {
        get: {
          operationId: 'getOwnershipNetwork',
          summary: 'Get ownership network',
          description:
            'Returns nodes and links for stock-to-holder or holder-to-stock ownership network.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Ticker root, for example PGAS.'
            },
            {
              name: 'holder',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Holder root if ticker is not provided.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
              description: 'Primary node limit.'
            },
            {
              name: 'neighborLimit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 5, minimum: 0, maximum: 25 },
              description: 'Neighbor node limit per primary node.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership graph nodes and links.',
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: true }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        OwnershipHolderRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            date: { type: 'string', format: 'date' },
            period: { type: 'string' },
            ticker: { type: 'string' },
            issuer_name: { type: 'string' },
            investor_name: { type: 'string' },
            investor_type: { type: 'string' },
            local_foreign: { type: 'string' },
            total_holding_shares: { type: ['number', 'null'] },
            percentage: { type: ['number', 'null'] }
          }
        },
        OwnershipHistoryRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: 'string' },
            date: { type: 'string', format: 'date' },
            price: { type: ['number', 'null'] },
            local_total: { type: ['number', 'null'] },
            foreign_total: { type: ['number', 'null'] }
          }
        },
        OwnershipHoldersResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            period: { type: ['string', 'null'] },
            date: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderRecord' }
            }
          },
          required: ['ticker', 'period', 'date', 'returned', 'records']
        },
        OwnershipHistoryResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHistoryRecord' }
            }
          },
          required: ['ticker', 'startDate', 'endDate', 'returned', 'records']
        },
        OwnershipCompareResponse: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: 'string' },
            metric: { type: 'string' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            before: { type: ['number', 'null'] },
            after: { type: ['number', 'null'] },
            diff: { type: ['number', 'null'] },
            changePercent: { type: ['number', 'null'] }
          },
          required: ['ticker', 'metric', 'from', 'to', 'before', 'after', 'diff', 'changePercent']
        },
        OwnershipFileResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
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
          required: ['ticker', 'returned', 'downloadUrl', 'openaiFileResponse']
        },
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
