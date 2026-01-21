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
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md text-green-700">
          Settings saved successfully!
        </div>
      )}

      <form onSubmit={saveConfig} className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">General Settings</h2>

        <div className="space-y-6">
          <div>
            <label
              htmlFor="defaultTargetUrl"
              className="block text-sm font-medium text-gray-700"
            >
              Default Target URL
            </label>
            <p className="text-sm text-gray-500 mt-1">
              Fallback URL when no __target parameter or routing rule matches
            </p>
            <input
              type="url"
              id="defaultTargetUrl"
              value={defaultTargetUrl}
              onChange={(e) => setDefaultTargetUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm border px-3 py-2"
            />
          </div>

          <div>
            <label
              htmlFor="maxBodySize"
              className="block text-sm font-medium text-gray-700"
            >
              Max Body Size for Logging
            </label>
            <p className="text-sm text-gray-500 mt-1">
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
              <span className="text-sm text-gray-700 w-20">{formatBytes(maxBodySize)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-t border-b">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Enable Logging
              </label>
              <p className="text-sm text-gray-500">
                Log all incoming requests to the database
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLogEnabled(!logEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                logEnabled ? 'bg-blue-600' : 'bg-gray-200'
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
              <label className="block text-sm font-medium text-gray-700">
                AI Request Detection
              </label>
              <p className="text-sm text-gray-500">
                Automatically detect and parse OpenAI-compatible API requests
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAiDetectionEnabled(!aiDetectionEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                aiDetectionEnabled ? 'bg-purple-600' : 'bg-gray-200'
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
            <div className="pt-4 border-t">
              <p className="text-sm text-gray-500">
                Last updated: {new Date(config.updatedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={saving}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      {/* AI Model Pricing */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">AI Model Pricing</h2>
        <p className="text-sm text-gray-500 mb-4">
          Pricing used for cost estimation (micro-dollars per 1M tokens)
        </p>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
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
            <tbody className="bg-white divide-y divide-gray-200">
              {pricing.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-sm text-gray-900 capitalize">
                    {p.provider}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                    {p.modelPattern}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">
                    {formatPrice(p.inputPricePerMillion)}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-900 text-right">
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
      <div className="bg-white shadow rounded-lg p-6 mt-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Usage</h2>

        <div className="space-y-4 text-sm text-gray-600">
          <div>
            <h3 className="font-medium text-gray-900">__target Query Parameter</h3>
            <p className="mt-1">
              Add <code className="bg-gray-100 px-1 rounded">__target=https://api.example.com</code> to any request to override the target URL.
            </p>
            <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-auto">
{`curl "http://localhost:3001/v1/chat/completions?__target=https://api.openai.com" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello!"}]}'`}
            </pre>
          </div>

          <div>
            <h3 className="font-medium text-gray-900">Routing Rules</h3>
            <p className="mt-1">
              Configure routing rules to automatically route requests based on path patterns or headers.
              Rules are evaluated in priority order (highest first).
            </p>
          </div>

          <div>
            <h3 className="font-medium text-gray-900">AI Request Detection</h3>
            <p className="mt-1">
              Requests to OpenAI-compatible endpoints (e.g., <code className="bg-gray-100 px-1 rounded">/v1/chat/completions</code>)
              are automatically detected and parsed. The proxy supports both streaming and non-streaming responses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
