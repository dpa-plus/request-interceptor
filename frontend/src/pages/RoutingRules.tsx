import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';

interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  matchType: string;
  matchPattern: string;
  matchHeader: string | null;
  targetUrl: string;
  createdAt: string;
  updatedAt: string;
}

const MATCH_TYPES = [
  {
    value: 'path_prefix',
    label: 'Path Prefix',
    description: 'Match if request path starts with the pattern',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    ),
    placeholder: '/v1/chat',
    example: '/v1/chat/completions',
  },
  {
    value: 'path_regex',
    label: 'Path Regex',
    description: 'Match path against a regular expression',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
      </svg>
    ),
    placeholder: '^/v1/.*',
    example: '/v1/anything',
  },
  {
    value: 'header_regex',
    label: 'Header Regex',
    description: 'Match a specific header value against regex',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    placeholder: '.*openai.*',
    example: 'x-provider: openai-compatible',
  },
];

const EXAMPLE_RULES = [
  {
    name: 'OpenAI API',
    matchType: 'path_prefix',
    matchPattern: '/v1/',
    targetUrl: 'https://api.openai.com',
    description: 'Route all /v1/* requests to OpenAI',
  },
  {
    name: 'Anthropic API',
    matchType: 'path_prefix',
    matchPattern: '/v1/messages',
    targetUrl: 'https://api.anthropic.com',
    description: 'Route /v1/messages to Anthropic',
  },
  {
    name: 'OpenRouter',
    matchType: 'path_prefix',
    matchPattern: '/api/v1/',
    targetUrl: 'https://openrouter.ai',
    description: 'Route /api/v1/* to OpenRouter',
  },
];

function RoutingRules() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<Partial<RoutingRule> | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [testPath, setTestPath] = useState('');

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/routing-rules');
      if (!response.ok) throw new Error('Failed to fetch routing rules');
      const data = await response.json();
      setRules(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Test if the current pattern matches the test path
  const patternMatch = useMemo(() => {
    if (!editingRule?.matchPattern || !testPath) return null;

    try {
      if (editingRule.matchType === 'path_prefix') {
        return testPath.startsWith(editingRule.matchPattern);
      } else if (editingRule.matchType === 'path_regex') {
        const regex = new RegExp(editingRule.matchPattern);
        return regex.test(testPath);
      }
      return null;
    } catch {
      return null;
    }
  }, [editingRule?.matchType, editingRule?.matchPattern, testPath]);

  const saveRule = async () => {
    if (!editingRule) return;

    try {
      setSaving(true);
      const isNew = !editingRule.id;
      const url = isNew ? '/api/routing-rules' : `/api/routing-rules/${editingRule.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingRule),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save rule');
      }

      toast.success(isNew ? 'Rule created!' : 'Rule updated!');
      setEditingRule(null);
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string) => {
    try {
      const response = await fetch(`/api/routing-rules/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete rule');
      toast.success('Rule deleted');
      setDeleteConfirm(null);
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const toggleEnabled = async (rule: RoutingRule) => {
    try {
      await fetch(`/api/routing-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      toast.success(rule.enabled ? 'Rule disabled' : 'Rule enabled');
      fetchRules();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle rule');
    }
  };

  const movePriority = async (rule: RoutingRule, direction: 'up' | 'down') => {
    const newPriority = direction === 'up' ? rule.priority + 10 : rule.priority - 10;
    try {
      await fetch(`/api/routing-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: newPriority }),
      });
      fetchRules();
    } catch (err) {
      toast.error('Failed to update priority');
    }
  };

  const openNewRule = (example?: typeof EXAMPLE_RULES[0]) => {
    setEditingRule({
      name: example?.name || '',
      priority: Math.max(0, ...rules.map((r) => r.priority)) + 10,
      enabled: true,
      matchType: example?.matchType || 'path_prefix',
      matchPattern: example?.matchPattern || '',
      matchHeader: null,
      targetUrl: example?.targetUrl || '',
    });
    setShowExamples(false);
    setTestPath(example?.matchPattern || '');
  };

  const matchTypeConfig = MATCH_TYPES.find((t) => t.value === editingRule?.matchType);

  if (loading && rules.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-gray-500">Loading rules...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Routing Rules</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure how requests are routed to target URLs
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <button
              onClick={() => setShowExamples(!showExamples)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Examples
              <svg className="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showExamples && (
              <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-lg border z-20">
                <div className="p-2">
                  <div className="text-xs font-medium text-gray-500 px-2 py-1">Quick Start Templates</div>
                  {EXAMPLE_RULES.map((example) => (
                    <button
                      key={example.name}
                      onClick={() => openNewRule(example)}
                      className="w-full text-left px-3 py-2 rounded hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900 text-sm">{example.name}</div>
                      <div className="text-xs text-gray-500">{example.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => openNewRule()}
            className="px-4 py-2 bg-blue-600 rounded-md text-sm font-medium text-white hover:bg-blue-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Rule
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Routing Priority Info */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg mb-6 p-4">
        <h2 className="text-sm font-medium text-blue-900 mb-2 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          How Routing Works
        </h2>
        <ol className="text-sm text-blue-800 space-y-1">
          <li className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-xs flex items-center justify-center font-bold">1</span>
            <code className="bg-blue-100 px-1 rounded">__target</code> query parameter (highest priority)
          </li>
          <li className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-xs flex items-center justify-center font-bold">2</span>
            <code className="bg-blue-100 px-1 rounded">X-Target-URL</code> header
          </li>
          <li className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-xs flex items-center justify-center font-bold">3</span>
            Routing rules (by priority, highest number first)
          </li>
          <li className="flex items-center gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-200 text-blue-800 text-xs flex items-center justify-center font-bold">4</span>
            Default target URL from settings
          </li>
        </ol>
      </div>

      {/* Rules List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        {rules.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-1">No routing rules</h3>
            <p className="text-gray-500 mb-4">Get started by creating your first routing rule</p>
            <button
              onClick={() => openNewRule()}
              className="px-4 py-2 bg-blue-600 rounded-md text-sm font-medium text-white hover:bg-blue-700"
            >
              Create First Rule
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rules
              .sort((a, b) => b.priority - a.priority)
              .map((rule) => (
                <div
                  key={rule.id}
                  className={`p-4 hover:bg-gray-50 transition-colors ${!rule.enabled ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {/* Enable/Disable Toggle */}
                      <button
                        onClick={() => toggleEnabled(rule)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                          rule.enabled ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                        title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            rule.enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      {/* Rule Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{rule.name}</span>
                          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                            Priority: {rule.priority}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                            rule.matchType === 'path_prefix' ? 'bg-green-100 text-green-700' :
                            rule.matchType === 'path_regex' ? 'bg-purple-100 text-purple-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {MATCH_TYPES.find((t) => t.value === rule.matchType)?.label}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          <code className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-mono text-xs">
                            {rule.matchPattern}
                          </code>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                          <span className="text-gray-500 truncate">{rule.targetUrl}</span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => movePriority(rule, 'up')}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Increase priority"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => movePriority(rule, 'down')}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        title="Decrease priority"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          setEditingRule(rule);
                          setTestPath(rule.matchPattern);
                        }}
                        className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                        title="Edit rule"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(rule.id)}
                        className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                        title="Delete rule"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Delete Rule</h3>
                <p className="text-sm text-gray-500">
                  Are you sure you want to delete "{rules.find((r) => r.id === deleteConfirm)?.name}"?
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteRule(deleteConfirm)}
                className="px-4 py-2 bg-red-600 rounded-md text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Create Modal */}
      {editingRule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0 bg-white">
              <h2 className="text-lg font-medium">
                {editingRule.id ? 'Edit Routing Rule' : 'Create Routing Rule'}
              </h2>
              <button
                onClick={() => setEditingRule(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
                <input
                  type="text"
                  value={editingRule.name || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="OpenAI API"
                />
                <p className="text-xs text-gray-500 mt-1">A descriptive name to identify this rule</p>
              </div>

              {/* Match Type Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Match Type</label>
                <div className="grid grid-cols-1 gap-2">
                  {MATCH_TYPES.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => setEditingRule({ ...editingRule, matchType: type.value })}
                      className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-colors ${
                        editingRule.matchType === type.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`p-2 rounded ${
                        editingRule.matchType === type.value ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {type.icon}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{type.label}</div>
                        <div className="text-xs text-gray-500">{type.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pattern */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Match Pattern
                  {editingRule.matchType?.includes('regex') && (
                    <span className="ml-1 text-purple-600">(Regex)</span>
                  )}
                </label>
                <input
                  type="text"
                  value={editingRule.matchPattern || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, matchPattern: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2 font-mono focus:ring-blue-500 focus:border-blue-500"
                  placeholder={matchTypeConfig?.placeholder}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Example match: <code className="bg-gray-100 px-1 rounded">{matchTypeConfig?.example}</code>
                </p>
              </div>

              {/* Header Name (for header_regex) */}
              {editingRule.matchType === 'header_regex' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Header Name</label>
                  <input
                    type="text"
                    value={editingRule.matchHeader || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, matchHeader: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2"
                    placeholder="X-Api-Provider"
                  />
                  <p className="text-xs text-gray-500 mt-1">The HTTP header to match against</p>
                </div>
              )}

              {/* Live Test */}
              {editingRule.matchType !== 'header_regex' && editingRule.matchPattern && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Test Pattern</label>
                  <input
                    type="text"
                    value={testPath}
                    onChange={(e) => setTestPath(e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2 font-mono text-sm"
                    placeholder="/v1/chat/completions"
                  />
                  {testPath && (
                    <div className={`mt-2 flex items-center gap-2 text-sm ${
                      patternMatch ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {patternMatch ? (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Pattern matches this path
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Pattern does not match
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Target URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target URL</label>
                <input
                  type="url"
                  value={editingRule.targetUrl || ''}
                  onChange={(e) => setEditingRule({ ...editingRule, targetUrl: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2"
                  placeholder="https://api.openai.com"
                />
                <p className="text-xs text-gray-500 mt-1">Requests matching this rule will be forwarded here</p>
              </div>

              {/* Priority & Enabled */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <input
                    type="number"
                    value={editingRule.priority || 0}
                    onChange={(e) => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm border px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">Higher = checked first</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <div className="flex items-center gap-3 h-[42px]">
                    <button
                      type="button"
                      onClick={() => setEditingRule({ ...editingRule, enabled: !editingRule.enabled })}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        editingRule.enabled ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          editingRule.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-sm text-gray-700">
                      {editingRule.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 sticky bottom-0">
              <button
                onClick={() => setEditingRule(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRule}
                disabled={saving || !editingRule.name || !editingRule.matchPattern || !editingRule.targetUrl}
                className="px-4 py-2 bg-blue-600 rounded-md text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {saving && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {saving ? 'Saving...' : editingRule.id ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoutingRules;
