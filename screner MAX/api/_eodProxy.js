const DEFAULT_EOD_API_BASE_URL = 'https://eod.maxlong.my.id';

function getApiKey() {
  return process.env.EOD_API_KEY || process.env.API_KEY || '';
}

function copyQueryParams(sourceUrl, targetUrl) {
  for (const [key, value] of sourceUrl.searchParams.entries()) {
    targetUrl.searchParams.append(key, value);
  }
}

export async function proxyEodRequest(request, response, upstreamPath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    response.status(500).json({
      error: 'Server is missing EOD_API_KEY environment variable.'
    });
    return;
  }

  const requestUrl = new URL(request.url ?? '', 'http://localhost');
  const upstreamBaseUrl = (process.env.EOD_API_BASE_URL || DEFAULT_EOD_API_BASE_URL).replace(/\/+$/, '');
  const upstreamUrl = new URL(`${upstreamBaseUrl}${upstreamPath}`);
  copyQueryParams(requestUrl, upstreamUrl);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: request.headers.accept || 'application/json'
      }
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';
    const body = Buffer.from(await upstreamResponse.arrayBuffer());

    response.status(upstreamResponse.status);
    response.setHeader('content-type', contentType);
    response.send(body);
  } catch (error) {
    response.status(502).json({
      error: 'Failed to reach EOD API upstream.',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
