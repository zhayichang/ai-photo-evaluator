export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        });
    }

    const url = new URL(req.url);
    if (url.pathname !== '/api/analyze' || req.method !== 'POST') {
        return new Response('Not Found', { status: 404 });
    }

    try {
        const body = await req.json();
        const { provider, payload } = body;

        let apiKey;
        if (provider === 'moonshot') {
            apiKey = process.env.KIMI_API_KEY;
        } else if (provider === 'openai') {
            apiKey = process.env.OPENAI_API_KEY;
        }

        if (!apiKey) {
            return new Response(JSON.stringify({
                error: provider === 'openai'
                    ? 'OpenAI API Key not configured. Please provide your own API Key.'
                    : 'Server Kimi API Key not configured'
            }), {
                status: provider === 'openai' ? 400 : 500,
                headers: { 'Content-Type': 'application/json' }
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

        const data = await response.text();
        return new Response(data, {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}