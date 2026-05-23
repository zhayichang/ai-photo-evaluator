// api/analyze.js
export default async function handler(req, res) {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(404).json({ error: 'Not Found' });
  }

  try {
    const { provider, payload } = req.body;

    let apiKey;
    if (provider === 'moonshot') {
      apiKey = process.env.KIMI_API_KEY;
    } else if (provider === 'openai') {
      apiKey = process.env.OPENAI_API_KEY;
    }

    if (!apiKey) {
      return res.status(provider === 'openai' ? 400 : 500).json({ 
        error: provider === 'openai' 
          ? 'OpenAI API Key not configured. Please provide your own API Key.' 
          : 'Server Kimi API Key not configured' 
      });
    }

    const endpoints = {
      moonshot: 'https://api.moonshot.cn/v1/chat/completions',
      openai: 'https://api.openai.com/v1/chat/completions'
    };

    const endpoint = endpoints[provider] || endpoints.moonshot;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}