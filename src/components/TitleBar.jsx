import React from 'react';

export default function TitleBar() {
  const handle = (op) => {
    if (window.electron) window.electron[op]();
  };

  return (
    <div
      className="h-9 bg-bg border-b border-border flex items-center justify-between drag-region px-3"
      style={{ flexShrink: 0 }}
    >
      <div className="flex items-center gap-2 no-drag">
        <span className="font-display text-accent text-xl leading-none">N</span>
        <span className="text-xs text-muted">streams</span>
      </div>
      <div className="flex-1 drag-region h-full" />
      <div className="flex gap-1 no-drag">
        <button
          onClick={() => handle('minimize')}
          className="w-8 h-7 hover:bg-bg3 rounded text-muted hover:text-white transition flex items-center justify-center"
        >
          ─
        </button>
        <button
          onClick={() => handle('maximize')}
          className="w-8 h-7 hover:bg-bg3 rounded text-muted hover:text-white transition flex items-center justify-center text-xs"
        >
          ◻
        </button>
        <button
          onClick={() => handle('close')}
          className="w-8 h-7 hover:bg-red rounded text-muted hover:text-white transition flex items-center justify-center"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
