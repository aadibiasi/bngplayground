import React, { useState, useEffect, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { BioParser } from '../services/grammar/parser';
import { BNGLGenerator } from '../services/grammar/generator';
import { BioSentence } from '../services/grammar/types';
import { CheatsheetModal } from './CheatsheetModal';
import { Button } from './ui/Button';
import { BNGLModel } from '../types';
import { Card } from './ui/Card';

interface DesignerPanelProps {
  isCollapsed?: boolean;
  onExpand?: () => void;
  text: string;
  onTextChange: (text: string) => void;
  modelName?: string | null;
  onModelNameChange?: (name: string | null) => void;
  onCodeChange: (code: string) => void;
  onParse: () => Promise<BNGLModel | null>;
  onSimulate: (model?: BNGLModel) => void;
}

const DEFAULT_TEXT = `# Welcome to Bio-Designer
# Write biology in natural language!

# Define your molecules
Define Lck
Define TCR with sites itam
Define Zap70
Define SHP1

# Describe interactions (many synonyms work!)
Lck binds TCR
Lck phosphorylates TCR at itam

# The parser understands flexible phrasing:
# "binds", "interacts with", "associates with", "recruits" all work!

# Initialize molecules
Start with 100 of Lck
Start with 100 of TCR
Start with 50 of Zap70
Start with 20 of SHP1

# Run simulation
Simulate for 0.25s with 200 steps
`;

export const DesignerPanel: React.FC<DesignerPanelProps> = ({ isCollapsed, onExpand, text, onTextChange, modelName, onModelNameChange, onCodeChange, onParse, onSimulate }) => {
  // Use DEFAULT_TEXT if no text provided (first time opening designer)
  const displayText = text || DEFAULT_TEXT;
  const [isCheatsheetOpen, setIsCheatsheetOpen] = useState(false);

  // 1. Parse Text -> Logic (Immediate derived state)
  const sentences = useMemo(() => BioParser.parseDocument(displayText), [displayText]);

  // 2. Logic -> BNGL Code (Derived state)
  const lastGeneratedCode = useMemo(() => {
    const validSentences = sentences.filter(s => s.isValid);
    if (validSentences.length === 0 && displayText.trim() !== '') return '';

    try {
      return BNGLGenerator.generate(sentences);
    } catch (e) {
      console.error("Generation failed", e);
      return '';
    }
  }, [sentences, displayText]);

  // Initialize text with default if empty
  useEffect(() => {
    if (!text) {
      onTextChange(DEFAULT_TEXT);
    }
  }, []);

  // Sync generated code with parent
  useEffect(() => {
    if (lastGeneratedCode) {
      onCodeChange(lastGeneratedCode);
    }
  }, [lastGeneratedCode, onCodeChange]);

  // Manual Sync function to force visualization update and run simulation
  const handleSync = async () => {
    if (lastGeneratedCode) {
      onCodeChange(lastGeneratedCode); // Ensure parent has latest
      const parsedModel = await onParse(); // Trigger parse/refresh in App
      if (parsedModel) {
        onSimulate(parsedModel); // Auto-run simulation after parsing
      }
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onTextChange(e.target.value);
  };

  const handleModelNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onModelNameChange?.(value.trim() ? value : null);
  };

  if (isCollapsed) {
    return (
      <Card 
        className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-900/50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 dark:border-slate-700 items-center justify-start py-6 overflow-hidden cursor-pointer hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 transition-colors" 
        onClick={() => onExpand?.()}
        data-testid="designer-panel-collapsed"
      >
         <div 
           className="whitespace-nowrap flex items-center gap-3 mt-4 mb-auto pointer-events-none"
           style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
         >
            <span className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-400 dark:text-slate-600 dark:text-slate-400">Designer</span>
         </div>
         
         <div className="mt-auto flex flex-col items-center gap-5 pb-4">
            <div className="flex flex-col items-center gap-1 group">
               <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  handleSync();
                }} 
                className="w-11 h-11 flex items-center justify-center rounded-full bg-blue-600 shadow-lg border border-blue-500 text-white hover:scale-110 active:scale-95 transition-all" 
                title="Sync & Visualize"
              >
                 <span className="text-xl pl-1">⚡</span>
               </button>
               <span className="text-[8px] font-black uppercase text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">Sync</span>
            </div>
         </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900/50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 dark:border-slate-800">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 dark:border-slate-700 bg-white dark:bg-slate-900 dark:bg-slate-900 flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold mb-1">Designer Mode</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Describe your biology in structured English.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="subtle" onClick={() => setIsCheatsheetOpen(true)} className="text-xs">
            ? Cheatsheet
          </Button>
          <Button variant="primary" onClick={handleSync} className="text-xs">
            ⚡ Sync & Visualize
          </Button>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="mb-3">
          <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Model Name
          </label>
          <input
            type="text"
            value={modelName ?? ''}
            onChange={handleModelNameChange}
            placeholder="Optional model title (for editor/export)"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        {/* Main Editor Row */}
        <div className="flex-[1.35] flex gap-4 min-h-0">
          {/* NLP Text Editor */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Natural Language Input</h3>
            <textarea
              className="flex-1 p-4 font-mono text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:border-slate-700 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              value={displayText}
              onChange={handleTextChange}
              spellCheck={false}
              placeholder="Type your biological sentences here..."
            />
          </div>

          {/* Logic Parser Feedback */}
          <div className="w-1/4 flex flex-col min-h-0">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Logic Parser</h3>
            <div className="flex-1 bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 dark:border-slate-700 rounded-md overflow-y-auto p-2">
              <div className="space-y-1">
                {sentences.filter(s => s.type !== 'COMMENT').map((s) => (
                  <div
                    key={s.id}
                    className={`p-2 rounded text-xs border-l-4 ${s.type === 'INVALID' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' :
                        'border-green-500 bg-green-50 dark:bg-green-900/20'
                      }`}
                  >
                    <div className="font-semibold mb-0.5 text-[10px] uppercase tracking-wider opacity-70">{s.type}</div>
                    {s.type === 'INVALID' ? (
                      <div className="text-red-600 dark:text-red-400 font-medium">{s.error?.message || 'Syntax Error'}</div>
                    ) : (
                      <div className="text-slate-700 dark:text-slate-200 truncate font-medium" title={s.text}>
                        {s.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* BNGL Preview (Monaco) */}
        <div className="h-40 flex flex-col border-t border-slate-200 dark:border-slate-700 dark:border-slate-800 pt-3 mt-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Generated BNGL Code</h3>
            <span className="text-xs text-slate-400">
              {lastGeneratedCode ? `${lastGeneratedCode.split('\n').length} lines` : 'No code generated'}
            </span>
          </div>
          <div className="flex-1 min-h-0 border border-slate-200 dark:border-slate-700 dark:border-slate-700 rounded-md overflow-hidden shadow-sm">
             <Editor
                height="100%"
                defaultLanguage="bngl"
                value={lastGeneratedCode || '# BNGL code will appear here as you type...'}
                theme="vs-dark" // We can toggle this based on system theme if needed, sticking to dark for code usually looks good or standard. Let's assume VS Dark for now as it contrasts well.
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                  lineNumbers: 'on',
                  renderLineHighlight: 'none',
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  domReadOnly: true,
                  readOnlyMessage: { value: "Generated from natural language. Edit above to change." }
                }}
              />
          </div>
        </div>
      </div>

      <CheatsheetModal isOpen={isCheatsheetOpen} onClose={() => setIsCheatsheetOpen(false)} />
    </div>
  );
};
