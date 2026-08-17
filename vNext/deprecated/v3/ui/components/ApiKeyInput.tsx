// @ts-nocheck
import React, { useEffect, useState } from 'react';

interface ApiKeyInputProps {
  apiKey: string;
  onChange: (key: string) => void;
}

const ApiKeyInput: React.FC<ApiKeyInputProps> = ({ apiKey, onChange }) => {
  const [localKey, setLocalKey] = useState(apiKey);

  useEffect(() => {
    const saved = sessionStorage.getItem('openai_api_key');
    if (saved && !apiKey) {
      onChange(saved);
      setLocalKey(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    onChange(localKey.trim());
    if (localKey.trim()) sessionStorage.setItem('openai_api_key', localKey.trim());
    else sessionStorage.removeItem('openai_api_key');
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-cyan-400">OpenAI API Key</h3>
        <span className="text-xs text-gray-400">Client-only (dev); key visible in browser</span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={localKey}
          onChange={(e) => setLocalKey(e.target.value)}
          placeholder="sk-..."
          className="flex-grow bg-gray-700 text-gray-200 placeholder-gray-400 rounded-md px-4 py-2 border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition-all"
        />
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-500 transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
};

export default ApiKeyInput;


