export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientSecret) {
    return response.status(500).json({ error: 'WHOOP_CLIENT_SECRET is not configured.' });
  }

  try {
    const upstream = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...request.body, client_secret: clientSecret }),
    });

    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return response.send(text);
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'WHOOP token request failed.',
    });
  }
}
