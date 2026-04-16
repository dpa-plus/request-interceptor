import { useState, useEffect } from 'react';

interface Config {
  id: string;
  defaultTargetUrl: string | null;
  logEnabled: boolean;
  maxBodySize: number;
  aiDetectionEnabled: boolean;
  updatedAt: string;
}

interface AiPricing {
  id: string;
  provider: string;
  modelPattern: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [pricing, setPricing] = useState<AiPricing[]>([]);
  const [defaultTargetUrl, setDefaultTargetUrl] = useState('');
  const [logEnabled, setLogEnabled] = useState(true);
  const [maxBodySize, setMaxBodySize] = useState(1048576);
  const [aiDetectionEnabled, setAiDetectionEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [configRes, pricingRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/pricing'),
      ]);

      if (!configRes.ok) throw new Error('Failed to fetch config');

      const configData: Config = await configRes.json();
      const pricingData: AiPricing[] = await pricingRes.json();

      setConfig(configData);
      setPricing(pricingData);
      setDefaultTargetUrl(configData.defaultTargetUrl || '');
      setLogEnabled(configData.logEnabled);
      setMaxBodySize(configData.maxBodySize);
      setAiDetectionEnabled(configData.aiDetectionEnabled);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setSuccess(false);
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultTargetUrl: defaultTargetUrl || null,
          logEnabled,
          maxBodySize,
          aiDetectionEnabled,
        }),
      });
      if (!response.ok) throw new Error('Failed to save config');
      const data: Config = await response.json();
      setConfig(data);
      setSuccess(true);
      setError(null);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatPrice = (micros: number) => {
    return `$${(micros / 1_000_000).toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-4 overflow-auto h-[calc(100vh-44px)]">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Settings</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-900/40 border border-red-800 rounded-md text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-900/40 border border-green-800 rounded-md text-green-300">
          Settings saved successfully!
        </div>
      )}

      <form onSubmit={saveConfig} className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium text-gray-100 mb-4">General Settings</h2>

        <div className="space-y-6">
          <div>
            <label
              htmlFor="defaultTargetUrl"
              className="block text-sm font-medium text-gray-300"
            >
              Default Target URL
            </label>
            <p className="text-sm text-gray-400 mt-1">
              Fallback URL when no __target parameter or routing rule matches
            </p>
            <input
              type="url"
              id="defaultTargetUrl"
              value={defaultTargetUrl}
              onChange={(e) => setDefaultTargetUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="mt-2 block w-full rounded-md border-[#30363d] bg-[#0d1117] text-gray-200 focus:border-[#1f6feb] focus:ring-[#1f6feb] sm:text-sm border px-3 py-2"
            />
          </div>

          <div>
            <label
              htmlFor="maxBodySize"
              className="block text-sm font-medium text-gray-300"
            >
              Max Body Size for Logging
            </label>
            <p className="text-sm text-gray-400 mt-1">
              Request/response bodies larger than this will be truncated in logs
            </p>
            <div className="mt-2 flex items-center gap-4">
              <input
                type="range"
                id="maxBodySize"
                min={102400}
                max={10485760}
                step={102400}
                value={maxBodySize}
                onChange={(e) => setMaxBodySize(parseInt(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm text-gray-300 w-20">{formatBytes(maxBodySize)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-t border-b border-[#30363d]">
            <div>
              <label className="block text-sm font-medium text-gray-300">
                Enable Logging
              </label>
              <p className="text-sm text-gray-400">
                Log all incoming requests to the database
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLogEnabled(!logEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#1f6feb] focus:ring-offset-2 ${
                logEnabled ? 'bg-blue-600' : 'bg-[#30363d]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  logEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-300">
                AI Request Detection
              </label>
              <p className="text-sm text-gray-400">
                Automatically detect and parse OpenAI-compatible API requests
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAiDetectionEnabled(!aiDetectionEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#1f6feb] focus:ring-offset-2 ${
                aiDetectionEnabled ? 'bg-purple-600' : 'bg-[#30363d]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  aiDetectionEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {config && (
            <div className="pt-4 border-t border-[#30363d]">
              <p className="text-sm text-gray-400">
                Last updated: {new Date(config.updatedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={saving}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1f6feb] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* AI Model Pricing */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-100 mb-4">AI Model Pricing</h2>
        <p className="text-sm text-gray-400 mb-4">
          Pricing used for cost estimation (micro-dollars per 1M tokens)
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[#21262d]">
            <thead className="bg-[#0d1117]">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Provider
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Model Pattern
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                  Input (per 1M)
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                  Output (per 1M)
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#161b22] divide-y divide-[#21262d]">
              {pricing.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-sm text-gray-300 capitalize">
                    {p.provider}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-300 font-mono">
                    {p.modelPattern}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-300 text-right">
                    {formatPrice(p.inputPricePerMillion)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-300 text-right">
                    {formatPrice(p.outputPricePerMillion)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-400 mt-4">
          Pricing data is pre-seeded with common models. Use the API to add custom pricing.
        </p>
      </div>

      {/* Usage Instructions */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mt-6">
        <h2 className="text-lg font-medium text-gray-100 mb-4">Target Routing</h2>
        <p className="text-sm text-gray-400 mb-4">
          The proxy needs to know where to forward requests. There are three ways to specify the target (in priority order):
        </p>

        <div className="space-y-6 text-sm text-gray-400">
          <div>
            <h3 className="font-medium text-gray-100 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1f6feb33] text-[#58a6ff] text-xs font-bold">1</span>
              Query Parameter
            </h3>
            <p className="mt-1 ml-7">
              Add <code className="bg-[#1c2333] px-1 rounded">__target</code> to the URL. The parameter is stripped before forwarding.
            </p>
            <pre className="mt-2 ml-7 p-3 bg-[#0d1117] rounded text-xs overflow-auto">
{`curl "http://localhost:3001/v1/chat/completions?__target=https://api.openai.com" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -d '{"model": "gpt-4o-mini", "messages": [...]}'`}
            </pre>
          </div>

          <div>
            <h3 className="font-medium text-gray-100 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1f6feb33] text-[#58a6ff] text-xs font-bold">2</span>
              X-Target-URL Header
            </h3>
            <p className="mt-1 ml-7">
              Set the <code className="bg-[#1c2333] px-1 rounded">X-Target-URL</code> header. The header is stripped before forwarding.
            </p>
            <pre className="mt-2 ml-7 p-3 bg-[#0d1117] rounded text-xs overflow-auto">
{`curl http://localhost:3001/v1/chat/completions \\
  -H "X-Target-URL: https://api.openai.com" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -d '{"model": "gpt-4o-mini", "messages": [...]}'`}
            </pre>
          </div>

          <div>
            <h3 className="font-medium text-gray-100 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#1f6feb33] text-[#58a6ff] text-xs font-bold">3</span>
              Routing Rules / Default Target
            </h3>
            <p className="mt-1 ml-7">
              If no query parameter or header is provided, the proxy checks configured routing rules (by priority).
              If no rule matches, the default target URL (configured above) is used.
            </p>
          </div>
        </div>
      </div>

      {/* Additional Info */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-6 mt-6">
        <h2 className="text-lg font-medium text-gray-100 mb-4">Features</h2>

        <div className="space-y-4 text-sm text-gray-400">
          <div>
            <h3 className="font-medium text-gray-100">AI Request Detection</h3>
            <p className="mt-1">
              Requests to OpenAI-compatible endpoints (e.g., <code className="bg-[#1c2333] px-1 rounded">/v1/chat/completions</code>)
              are automatically detected and parsed. The proxy supports both streaming and non-streaming responses,
              extracting token usage and calculating cost estimates.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-100">OpenRouter Integration</h3>
            <p className="mt-1">
              For OpenRouter requests, the proxy fetches additional metadata (actual provider, precise costs)
              from the OpenRouter Generation API after the request completes.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-100">Data Retention</h3>
            <p className="mt-1">
              Request logs are automatically deleted after <strong>30 days</strong>.
              Authorization headers are redacted after <strong>3 days</strong> for security.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-100">Real-time Updates</h3>
            <p className="mt-1">
              The dashboard uses Socket.IO for real-time updates. New requests appear immediately
              and update when the response is received.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
