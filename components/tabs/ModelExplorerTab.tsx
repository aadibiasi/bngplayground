import React from 'react';

interface ModelExplorerTabProps {
  onLoadModel?: (code: string, name: string, id: string) => void;
}

export const ModelExplorerTab: React.FC<ModelExplorerTabProps> = ({ onLoadModel }) => {
    const handleLaunch = () => {
        // Use document.baseURI as the source of truth for the base path
        const base = document.baseURI || window.location.origin + '/';
        const url = new URL('umap.html', base);
        window.location.href = url.toString();
    };

    return (
        <div className="h-full min-h-0 flex flex-col px-2 md:px-4 pb-4">
            <div className="w-full h-full min-h-[420px] rounded-2xl border border-slate-200 dark:border-slate-700 dark:border-slate-700 bg-gradient-to-br from-slate-900 to-slate-950 p-6 md:p-8 shadow-sm flex items-center justify-center">
                <div className="w-full max-w-4xl mx-auto text-center space-y-6">
                <div className="text-6xl mb-4">🌎</div>
                <h2 className="text-3xl font-bold text-white">Model Explorer</h2>
                <p className="text-lg text-slate-300">
                    Explore 198 BioNetGen models in an interactive space using UMAP projection of semantic embeddings.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left my-8">
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                        <div className="text-teal-400 font-semibold mb-2">🔍 Search</div>
                        <p className="text-sm text-slate-400">Find models by name, observables, or biological content</p>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                        <div className="text-teal-400 font-semibold mb-2">🧬 Biology</div>
                        <p className="text-sm text-slate-400">Discover models by category: Cancer, Immunology, etc.</p>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                        <div className="text-teal-400 font-semibold mb-2">📊 Similarity</div>
                        <p className="text-sm text-slate-400">See how models relate through semantic clustering</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                    <button 
                        onClick={handleLaunch}
                        className="px-8 py-4 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-lg shadow-lg shadow-teal-900/20 transition-all hover:scale-105 active:scale-95"
                    >
                        Launch Interactive Explorer
                    </button>
                </div>
                
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-8">
                    Uses local ML embeddings to project high-dimensional model content onto a 2D/3D map.
                </p>
                </div>
            </div>
        </div>
    );
};

export default ModelExplorerTab;
