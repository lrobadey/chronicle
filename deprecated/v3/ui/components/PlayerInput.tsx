
import React, { useState } from 'react';

interface PlayerInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

const PlayerInput: React.FC<PlayerInputProps> = ({ onSend, disabled }) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 p-4 bg-gray-800 rounded-lg">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What do you do?"
        disabled={disabled}
        className="flex-grow bg-gray-700 text-gray-200 placeholder-gray-400 rounded-md px-4 py-2 border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition-all"
      />
      <button
        type="submit"
        disabled={disabled}
        className="px-6 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
      >
        Send
      </button>
    </form>
  );
};

export default PlayerInput;
