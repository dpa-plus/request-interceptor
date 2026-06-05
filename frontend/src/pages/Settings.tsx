import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/apiFetch';

interface Config {
  id: string;
  defaultTargetUrl: string | null;
  logEnabled: boolean;
  maxBodySize: number;
  logRetentionDays: number;
  credentialRetentionDays: number;
  mediaRetentionDays: number;
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

interface RoutingRuleSummary {
  id: string;
  enabled: boolean;
}

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [pricing, setPricing] = useState<AiPricing[]>([]);
  const [routingRules, setRoutingRules] = useState<RoutingRuleSummary[]>([]);
  const [defaultTargetUrl, setDefaultTargetUrl] = useState('');
  const [logEnabled, setLogEnabled] = useState(true);
  const [maxBodySize, setMaxBodySize] = useState(1048576);
  const [logRetentionDays, setLogRetentionDays] = useState(30);
  const [credentialRetentionDays, setCredentialRetentionDays] = useState(0);
  const [mediaRetentionDays, setMediaRetentionDays] = useState(30);
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
      const [configRes, pricingRes, routingRes] = await Promise.all([
        apiFetch('/api/config'),
        apiFetch('/api/pricing'),
        apiFetch('/api/routing-rules'),
      ]);

      if (!configRes.ok) throw new Error('Failed to fetch config');

      const configData: Config = await configRes.json();
      const pricingData: AiPricing[] = await pricingRes.json();
      const routingData: RoutingRuleSummary[] = routingRes.ok ? await routingRes.json() : [];

      setConfig(configData);
      setPricing(pricingData);
      setRoutingRules(routingData);
      setDefaultTargetUrl(configData.defaultTargetUrl || '');
      setLogEnabled(configData.logEnabled);
      setMaxBodySize(configData.maxBodySize);
      setLogRetentionDays(configData.logRetentionDays ?? 30);
      setCredentialRetentionDays(configData.credentialRetentionDays ?? 0);
      setMediaRetentionDays(configData.mediaRetentionDays ?? 30);
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
      const response = await apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultTargetUrl: defaultTargetUrl || null,
          logEnabled,
          maxBodySize,
          logRetentionDays,
          credentialRetentionDays,
          mediaRetentionDays,
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

  const enabledRoutingRules = routingRules.filter((rule) => rule.enabled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-4 overflow-auto h-[calc(100vh-44px)]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">Routing, capture limits, and AI parsing defaults.</p>
        </div>
        <Link
          to="/routing"
          className="inline-flex items-center gap-2 rounded-md border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm font-medium text-gray-300 hover:bg-[#1c2333]"
        >
          <svg className="h-4 w-4 text-[#58a6ff]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5-5 5M6 12h12" />
          </svg>
          Routing rules
        </Link>
      </div>

      <SetupOverview
        defaultTargetUrl={defaultTargetUrl}
        enabledRules={enabledRoutingRules}
        totalRules={routingRules.length}
        logEnabled={logEnabled}
        aiDetectionEnabled={aiDetectionEnabled}
        maxBodySize={formatBytes(maxBodySize)}
        logRetentionDays={logRetentionDays}
        credentialRetentionDays={credentialRetentionDays}
        mediaRetentionDays={mediaRetentionDays}
      />

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

          <div className="border-t border-[#30363d] pt-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-100">Data retention</h3>
              <p className="mt-1 text-sm text-gray-400">
                Cleanup runs hourly. Shorter media retention can leave old request rows with missing media previews.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <RetentionControl
                label="Requests"
                value={logRetentionDays}
                onChange={setLogRetentionDays}
                helper="Deletes request logs and linked AI traces."
                presets={[7, 14, 30, 90]}
                minValue={1}
              />
              <RetentionControl
                label="Credentials"
                value={credentialRetentionDays}
                onChange={setCredentialRetentionDays}
                helper="Redacts auth, API key, and cookie headers."
                presets={[0, 1, 3, 7]}
                zeroLabel="Immediate"
              />
              <RetentionControl
                label="Media"
                value={mediaRetentionDays}
                onChange={setMediaRetentionDays}
                helper="Deletes stored images, audio, video, PDFs, and files."
                presets={[1, 7, 30, 90]}
                minValue={1}
              />
            </div>
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

function SetupOverview({
  defaultTargetUrl,
  enabledRules,
  totalRules,
  logEnabled,
  aiDetectionEnabled,
  maxBodySize,
  logRetentionDays,
  credentialRetentionDays,
  mediaRetentionDays,
}: {
  defaultTargetUrl: string;
  enabledRules: number;
  totalRules: number;
  logEnabled: boolean;
  aiDetectionEnabled: boolean;
  maxBodySize: string;
  logRetentionDays: number;
  credentialRetentionDays: number;
  mediaRetentionDays: number;
}) {
  return (
    <section className="mb-6 grid gap-3 md:grid-cols-5">
      <SetupCard
        label="Default target"
        value={defaultTargetUrl ? 'Configured' : 'Not set'}
        detail={defaultTargetUrl || 'Rules or per-request targets required'}
        tone={defaultTargetUrl ? 'green' : 'yellow'}
      />
      <SetupCard
        label="Routing rules"
        value={`${enabledRules}/${totalRules} active`}
        detail={totalRules > 0 ? 'Priority order controls matching' : 'Add templates for common APIs'}
        tone={enabledRules > 0 ? 'blue' : 'neutral'}
        href="/routing"
      />
      <SetupCard
        label="Logging"
        value={logEnabled ? 'Enabled' : 'Paused'}
        detail={`Body cap ${maxBodySize}`}
        tone={logEnabled ? 'green' : 'red'}
      />
      <SetupCard
        label="Retention"
        value={`${logRetentionDays}d logs`}
        detail={`${credentialRetentionDays === 0 ? 'Immediate' : `${credentialRetentionDays}d`} credentials · ${mediaRetentionDays}d media`}
        tone="yellow"
      />
      <SetupCard
        label="AI parsing"
        value={aiDetectionEnabled ? 'Enabled' : 'Off'}
        detail="OpenAI-compatible calls get decoded"
        tone={aiDetectionEnabled ? 'purple' : 'neutral'}
      />
    </section>
  );
}

function SetupCard({
  label,
  value,
  detail,
  tone,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'blue' | 'green' | 'purple' | 'yellow' | 'red' | 'neutral';
  href?: string;
}) {
  const tones = {
    blue: 'bg-[#1f6feb22] text-[#58a6ff] border-[#1f6feb55]',
    green: 'bg-green-900/20 text-green-300 border-green-800/70',
    purple: 'bg-purple-900/20 text-purple-300 border-purple-800/70',
    yellow: 'bg-yellow-900/20 text-yellow-300 border-yellow-800/70',
    red: 'bg-red-900/20 text-red-300 border-red-800/70',
    neutral: 'bg-[#1c2333] text-gray-300 border-[#30363d]',
  };

  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
        <span className={`h-2 w-2 rounded-full border ${tones[tone]}`} />
      </div>
      <div className="mt-3 text-base font-semibold text-gray-100">{value}</div>
      <div className="mt-1 truncate text-xs text-gray-500" title={detail}>{detail}</div>
    </>
  );

  if (href) {
    return (
      <Link to={href} className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 hover:bg-[#1c2333]">
        {content}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
      {content}
    </div>
  );
}

function RetentionControl({
  label,
  value,
  onChange,
  helper,
  presets,
  zeroLabel = '0 days',
  minValue = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  helper: string;
  presets: number[];
  zeroLabel?: string;
  minValue?: number;
}) {
  const setSafeValue = (next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(Math.max(minValue, Math.floor(next)));
  };

  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <label className="text-sm font-medium text-gray-200">{label}</label>
          <p className="mt-1 text-xs text-gray-500">{helper}</p>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={minValue}
            step={1}
            value={value}
            onChange={(e) => setSafeValue(Number(e.target.value))}
            className="w-16 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-right text-sm text-gray-200 focus:border-[#1f6feb] focus:outline-none focus:ring-1 focus:ring-[#1f6feb]"
          />
          <span className="text-xs text-gray-500">days</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setSafeValue(preset)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              value === preset
                ? 'bg-[#1f6feb33] text-[#58a6ff]'
                : 'bg-[#161b22] text-gray-400 hover:bg-[#1c2333] hover:text-gray-200'
            }`}
          >
            {preset === 0 ? zeroLabel : `${preset}d`}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Settings;
