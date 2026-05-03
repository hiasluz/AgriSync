import React, { useState, useMemo } from 'react';
import { ClipboardCopy, Trash2, Edit3, PlusCircle, AlertCircle, ArrowRight, Sprout, Map as MapIcon, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * AgriSync - FIONA vs. Portal Abgleich
 * 
 * Tool zum Vergleichen von landwirtschaftlichen Schlagdaten zwischen FIONA-CSV-Exporten
 * und der Portal-HTML-Struktur. Generiert TSV-Daten für AHK-Skripte.
 */

interface AreaData {
  bezeichnung: string;
  flurstueck: string;
  schlag: string;
  gemarkung: string;
  flik: string;
  flaeche: number;
  flaecheStr: string;
  kultur?: string;
  kulturVJ?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'umgebung' | 'ertrag'>('umgebung');
  const [csvData, setCsvData] = useState('');
  const [htmlData, setHtmlData] = useState('');
  const [results, setResults] = useState<{
    toAdd: AreaData[];
    toChange: { fiona: AreaData; portal: AreaData; isSizeChange: boolean; isFlurChange: boolean; isSchlagChange: boolean; }[];
    toDelete: AreaData[];
  } | null>(null);
  const [error, setError] = useState('');
  const [copiedMsg, setCopiedMsg] = useState('');

  const normalizeStr = (val: string) => (val || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const normalizeSchlag = (val: string) => {
    const v = (val || '').trim();
    if (!v) return '';
    const parsed = parseInt(v, 10);
    return isNaN(parsed) ? v : parsed.toString();
  };

  const parseFionaCSV = (csv: string): AreaData[] => {
    const lines = csv.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(';').map(h => h.trim());
    const idxBez = headers.indexOf('Bezeichnung');
    const idxFlur = headers.indexOf('Flurstueckskennung');
    const idxSchlag = headers.indexOf('Schlag-Nr.');
    const idxFlik = headers.indexOf('FLIK');
    const idxFlaeche = headers.indexOf('Nutzflaeche');
    const idxKultur = headers.indexOf('NutzungscodeBezeichnung');
    const idxKulturVJ = headers.indexOf('NutzungscodeBezeichnungVJ');

    if ([idxBez, idxFlur, idxSchlag, idxFlik, idxFlaeche].includes(-1)) {
      throw new Error('CSV-Format ungültig. Es fehlen Pflichtspalten (Bezeichnung, Flurstueckskennung, Schlag-Nr., FLIK oder Nutzflaeche).');
    }

    const data: AreaData[] = [];
    for (let i = 1; i < lines.length; i++) {
       if (!lines[i].trim()) continue;
       const cols = lines[i].split(';');

       const fionaKennung = (cols[idxFlur] || '').trim();
       let gemarkung = '';
       let flurstueck = '';
       
       if (fionaKennung) {
         const parts = fionaKennung.split('-');
         if (parts.length >= 3) {
           const gStr = parts[0];
           gemarkung = gStr.length === 6 ? gStr.substring(2) : gStr;
           const fParts = parts[2].split('/');
           flurstueck = parseInt(fParts[0], 10).toString();
           if (fParts.length > 1 && parseInt(fParts[1], 10) > 0) {
             flurstueck += '/' + parseInt(fParts[1], 10);
           }
         } else {
           flurstueck = fionaKennung;
         }
       }

       const flaecheStr = (cols[idxFlaeche] || '').trim();
       const flaeche = parseFloat(flaecheStr.replace(',', '.'));

       data.push({
         bezeichnung: (cols[idxBez] || '').trim(),
         flurstueck,
         schlag: normalizeSchlag(cols[idxSchlag]),
         gemarkung,
         flik: normalizeStr(cols[idxFlik]),
         flaeche,
         flaecheStr,
         kultur: idxKultur !== -1 ? (cols[idxKultur] || '').trim() : '',
         kulturVJ: idxKulturVJ !== -1 ? (cols[idxKulturVJ] || '').trim() : ''
       });
    }
    return data;
  };

  const parsePortalHTML = (html: string): AreaData[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('tr.datatable_elem_1st, tr.datatable_elem_2nd');
    
    const data: AreaData[] = [];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 6) {
        if (cells[0].textContent?.includes('Fläche') && !cells[2].textContent?.trim()) return;

        const bezeichnung = cells[0].textContent?.replace(/SID:\s*\d+/g, '').replace(/\n/g, '').trim() || '';
        const flurstueckRaw = cells[1].textContent?.trim() || '';
        const flurstueck = flurstueckRaw.split('\n')[0].trim();
        const schlag = normalizeSchlag(cells[2].textContent || '');
        const gemarkung = cells[3].textContent?.trim() || '';
        const flik = normalizeStr(cells[4].textContent || '');
        
        const flaecheStr = cells[5].textContent?.trim().replace(/\s*ha/g, '').replace(/\s/g, '') || '0';
        const flaeche = parseFloat(flaecheStr.replace(',', '.'));

        if (schlag !== '') {
          data.push({ bezeichnung, flurstueck, schlag, gemarkung, flik, flaeche, flaecheStr });
        }
      }
    });
    return data;
  };

  const handleCompareUmgebung = () => {
    setError('');
    setResults(null);
    try {
      if (!csvData) throw new Error('Bitte FIONA CSV-Daten einfügen.');
      if (!htmlData) throw new Error('Bitte Portal HTML-Daten einfügen.');

      const fionaData = parseFionaCSV(csvData);
      const portalData = parsePortalHTML(htmlData);

      const toAdd: AreaData[] = [];
      const toChange: { fiona: AreaData; portal: AreaData; isSizeChange: boolean; isFlurChange: boolean; isSchlagChange: boolean; }[] = [];
      const toDelete: AreaData[] = [];

      let remainingPortal = [...portalData];
      const unmatchedFiona: AreaData[] = [];

      fionaData.forEach(f => {
        const fFlik = normalizeStr(f.flik);
        const fSchlag = normalizeSchlag(f.schlag);
        const fFlur = normalizeStr(f.flurstueck);

        const matchIdx = remainingPortal.findIndex(p => 
          normalizeStr(p.flik) === fFlik && 
          normalizeSchlag(p.schlag) === fSchlag &&
          normalizeStr(p.flurstueck) === fFlur &&
          Math.abs(p.flaeche - f.flaeche) < 0.0001
        );

        if (matchIdx !== -1) {
          remainingPortal.splice(matchIdx, 1);
        } else {
          unmatchedFiona.push(f);
        }
      });

      unmatchedFiona.forEach(f => {
        const fFlik = normalizeStr(f.flik);
        const fSchlag = normalizeSchlag(f.schlag);
        const fFlur = normalizeStr(f.flurstueck);

        let matchIdx = remainingPortal.findIndex(p => 
          normalizeStr(p.flik) === fFlik && normalizeSchlag(p.schlag) === fSchlag
        );

        if (matchIdx === -1) {
          matchIdx = remainingPortal.findIndex(p => 
            normalizeStr(p.flik) === fFlik && normalizeStr(p.flurstueck) === fFlur
          );
        }

        if (matchIdx !== -1) {
          const p = remainingPortal.splice(matchIdx, 1)[0];
          
          const isSizeChange = Math.abs(p.flaeche - f.flaeche) >= 0.0001;
          const isFlurChange = normalizeStr(p.flurstueck) !== fFlur;
          const isSchlagChange = normalizeSchlag(p.schlag) !== fSchlag;

          toChange.push({
            fiona: f, portal: p,
            isSizeChange, isFlurChange, isSchlagChange
          });
        } else {
          toAdd.push(f);
        }
      });

      remainingPortal.forEach(p => toDelete.push(p));

      setResults({ toAdd, toChange, toDelete });
    } catch (err: any) {
      setError(err.message || 'Ein unbekannter Fehler ist aufgetreten.');
    }
  };

  const copyToClipboard = async (text: string, msg: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedMsg(msg);
        setTimeout(() => setCopiedMsg(''), 2000);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) {
          setCopiedMsg(msg);
          setTimeout(() => setCopiedMsg(''), 2000);
        } else {
          throw new Error('Kopieren fehlgeschlagen.');
        }
      }
    } catch (err) {
      setError('Kopieren in die Zwischenablage ist blockiert. Überprüfen Sie Ihre Browsereinstellungen.');
    }
  };

  const formatTsv = (data: AreaData) => {
    return `${data.bezeichnung}\t${data.flurstueck}\t${data.schlag}\t${data.gemarkung}\t${data.flik}\t${data.flaecheStr}`;
  };

  const cropGroups = useMemo(() => {
    if (!csvData) return [];
    try {
      const fionaData = parseFionaCSV(csvData);
      const changedCrops = fionaData.filter(f => f.kultur !== f.kulturVJ && f.kultur !== '');
      
      const groups: { [key: string]: AreaData[] } = {};
      changedCrops.forEach(f => {
        const key = f.kultur || 'Unbekannt';
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });

      return Object.entries(groups)
        .map(([kulturName, flaechen]) => ({
          kulturName,
          flaechen
        }))
        .sort((a, b) => b.flaechen.length - a.flaechen.length);
    } catch (err) {
      return [];
    }
  }, [csvData]);

  return (
    <div className="min-h-screen bg-[#0A0C10] text-[#E2E8F0] font-sans selection:bg-indigo-500/30">
      {/* Background Gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-24 w-64 h-64 bg-slate-900 rounded-full blur-3xl" />
      </div>

      <header className="bg-[#0F1117] border-b border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
           <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path d="M0,100 C20,80 40,90 60,70 C80,50 100,60 100,40" stroke="white" strokeWidth="0.5" fill="none" />
              <path d="M0,80 C30,60 50,70 70,40 C90,10 100,30 100,0" stroke="white" strokeWidth="0.5" fill="none" />
           </svg>
        </div>
        
        <div className="max-w-6xl mx-auto px-10 py-12 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-5 mb-8"
          >
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Sprout className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">AgriSync</h1>
              <p className="text-slate-500 text-sm font-medium">Professional Agricultural Data Analysis</p>
            </div>
          </motion.div>
          
          <div className="flex gap-2 p-1 bg-white/5 backdrop-blur-xl rounded-2xl w-fit border border-white/5">
            <button 
              onClick={() => setActiveTab('umgebung')}
              className={`relative px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 z-10 ${
                activeTab === 'umgebung' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {activeTab === 'umgebung' && (
                <motion.div 
                  layoutId="activeTab" 
                  className="absolute inset-0 bg-indigo-600 rounded-xl -z-10 shadow-lg shadow-indigo-600/30"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <MapIcon className="w-4 h-4"/> Flächen-Abgleich
            </button>
            <button 
              onClick={() => setActiveTab('ertrag')}
              className={`relative px-6 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 z-10 ${
                activeTab === 'ertrag' ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {activeTab === 'ertrag' && (
                <motion.div 
                  layoutId="activeTab" 
                  className="absolute inset-0 bg-indigo-600 rounded-xl -z-10 shadow-lg shadow-indigo-600/30"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
              <Sprout className="w-4 h-4"/> Ertrag & Kulturen
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-10 py-12 relative">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-red-500/10 border border-red-500/20 px-6 py-4 rounded-2xl flex items-start gap-4 text-red-400 shadow-xl mb-10"
            >
              <AlertCircle className="w-5 h-5 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold">Eingabefehler</h4>
                <p className="text-sm opacity-80">{error}</p>
              </div>
              <button onClick={() => setError('')} className="text-red-400/50 hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {activeTab === 'umgebung' ? (
            <motion.div 
              key="umgebung"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-10"
            >
              {/* Analysis Header with Action Button */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white/2 p-6 rounded-3xl border border-white/5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center border border-indigo-500/20 text-indigo-400">
                    <MapIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-tight leading-none">Flächen-Analyse</h2>
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em] mt-2">FIONA vs. Portal Datenbank</p>
                  </div>
                </div>
                
                <motion.button
                  whileHover={{ scale: 1.02, backgroundColor: '#4F46E5' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    handleCompareUmgebung();
                    // Small delay to allow state update before scrolling
                    setTimeout(() => {
                      document.getElementById('analysis-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                  }}
                  className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-xl shadow-xl shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 group text-sm self-start sm:self-center"
                >
                  <span>Analyse ausführen</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </motion.button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">1</span>
                    FIONA CSV Import
                  </label>
                  <div className="relative border border-white/10 rounded-2xl bg-[#161922] overflow-hidden transition-all focus-within:border-indigo-500/50 shadow-sm">
                    <textarea
                      className="w-full min-h-[200px] p-6 text-xs font-mono resize-y bg-transparent outline-none leading-relaxed text-slate-300 placeholder:text-slate-700"
                      placeholder="Paste FIONA CSV database structure here..."
                      value={csvData}
                      onChange={(e) => setCsvData(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-md bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">2</span>
                    Portal HTML Scraping
                  </label>
                  <div className="relative border border-white/10 rounded-2xl bg-[#161922] overflow-hidden transition-all focus-within:border-indigo-500/50 shadow-sm">
                    <textarea
                      className="w-full min-h-[200px] p-6 text-xs font-mono resize-y bg-transparent outline-none leading-relaxed text-slate-300 placeholder:text-slate-700"
                      placeholder="Paste Portal DOM source code here..."
                      value={htmlData}
                      onChange={(e) => setHtmlData(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {results && (
                  <motion.div 
                    id="analysis-results"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 gap-10 mt-16 pt-10 border-t border-white/5"
                  >
                    <div className="flex items-center gap-3 px-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                      <h3 className="text-lg font-bold text-white">Analyse-Ergebnisse</h3>
                      <span className="text-[10px] text-slate-600 font-bold uppercase tracking-widest ml-auto">Generiert am {new Date().toLocaleTimeString()}</span>
                    </div>
                    <ResultCard 
                      title="Einträge hinzufügen" 
                      count={results.toAdd.length} 
                      type="add"
                      icon={<PlusCircle className="w-6 h-6" />}
                    >
                      {results.toAdd.length === 0 ? (
                        <div className="py-16 bg-white/2 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-slate-600">
                           <CheckCircle2 className="w-12 h-12 mb-3 opacity-20" />
                           <p className="font-medium italic">Vollständiger Abgleich erfolgt.</p>
                        </div>
                      ) : (
                        <div className="overflow-hidden border border-white/5 rounded-2xl bg-[#1C212E]">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-white/2 text-slate-500 font-bold uppercase tracking-widest">
                              <tr>
                                <th className="px-6 py-4">Bezeichnung</th>
                                <th className="px-6 py-4">Flurstück</th>
                                <th className="px-6 py-4">Schlag</th>
                                <th className="px-6 py-4">Fläche</th>
                                <th className="px-6 py-4 text-right">Aktion</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {results.toAdd.map((item, i) => (
                                <tr key={i} className="hover:bg-indigo-500/5 transition-colors">
                                  <td className="px-6 py-4 font-semibold text-slate-300">{item.bezeichnung}</td>
                                  <td className="px-6 py-4 font-mono text-slate-500">{item.flurstueck}</td>
                                  <td className="px-6 py-4 text-slate-500">{item.schlag}</td>
                                  <td className="px-6 py-4 font-bold text-indigo-400">{item.flaecheStr} ha</td>
                                  <td className="px-6 py-4 text-right">
                                    <button 
                                      onClick={() => copyToClipboard(formatTsv(item), `TSV kopiert: ${item.bezeichnung}`)}
                                      className="inline-flex items-center gap-2 bg-white/5 text-slate-300 hover:bg-indigo-600 hover:text-white px-4 py-2 rounded-lg border border-white/5 text-[10px] font-bold transition-all shadow-lg"
                                    >
                                      <ClipboardCopy className="w-3.5 h-3.5" />
                                      <span>Kopieren</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </ResultCard>

                    <ResultCard 
                      title="Werte korrigieren" 
                      count={results.toChange.length} 
                      type="change"
                      icon={<Edit3 className="w-6 h-6" />}
                    >
                      {results.toChange.length === 0 ? (
                        <div className="py-16 bg-white/2 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-slate-600">
                           <CheckCircle2 className="w-12 h-12 mb-3 opacity-20" />
                           <p className="font-medium italic">Keine Abweichungen detektiert.</p>
                        </div>
                      ) : (
                        <div className="grid gap-5">
                          {results.toChange.map((item, i) => (
                            <motion.div 
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.05 }}
                              key={i} 
                              className="bg-[#1C212E] border border-white/5 p-6 rounded-2xl border-l-[6px] border-l-amber-500/50 hover:bg-[#23293A] transition-all"
                            >
                              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div className="space-y-3">
                                  <h4 className="font-bold text-white text-lg tracking-tight">{item.portal.bezeichnung}</h4>
                                  <div className="flex flex-wrap gap-3">
                                    {item.isSizeChange && (
                                      <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black uppercase border border-amber-500/20">
                                        Fläche: <span className="line-through opacity-40">{item.portal.flaecheStr}</span> → <span className="text-white underline decoration-amber-500/50">{item.fiona.flaecheStr}</span>
                                      </span>
                                    )}
                                    {item.isFlurChange && (
                                      <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black uppercase border border-amber-500/20">
                                        Flur: <span className="line-through opacity-40">{item.portal.flurstueck}</span> → <span className="text-white underline decoration-amber-500/50">{item.fiona.flurstueck}</span>
                                      </span>
                                    )}
                                    {item.isSchlagChange && (
                                      <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-[10px] font-black uppercase border border-amber-500/20">
                                        Schlag: <span className="line-through opacity-40">{item.portal.schlag}</span> → <span className="text-white underline decoration-amber-500/50">{item.fiona.schlag}</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button 
                                  onClick={() => copyToClipboard(formatTsv(item.fiona), `Neue Werte kopiert: ${item.fiona.bezeichnung}`)}
                                  className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-6 py-3.5 rounded-xl shadow-xl shadow-amber-600/10 text-xs font-bold transition-all"
                                >
                                  <ClipboardCopy className="w-4.5 h-4.5" />
                                  <span>Sync-Daten kopieren</span>
                                </button>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </ResultCard>

                    <ResultCard 
                      title="Portal-Bereinigung" 
                      count={results.toDelete.length} 
                      type="delete"
                      icon={<Trash2 className="w-6 h-6" />}
                    >
                      {results.toDelete.length === 0 ? (
                        <div className="py-16 bg-white/2 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-slate-600">
                           <CheckCircle2 className="w-12 h-12 mb-3 opacity-20" />
                           <p className="font-medium italic">Keine verwaisten Einträge vorhanden.</p>
                        </div>
                      ) : (
                        <div className="overflow-hidden border border-white/5 rounded-2xl bg-[#1C212E]">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-white/2 text-slate-500 font-bold uppercase tracking-widest">
                              <tr>
                                <th className="px-6 py-4">Bezeichnung</th>
                                <th className="px-6 py-4">Flurstück</th>
                                <th className="px-6 py-4">Schlag</th>
                                <th className="px-6 py-4 text-right">Fläche</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {results.toDelete.map((item, i) => (
                                <tr key={i} className="hover:bg-red-500/5 transition-colors">
                                  <td className="px-6 py-4 font-semibold text-slate-300">{item.bezeichnung}</td>
                                  <td className="px-6 py-4 font-mono text-slate-500">{item.flurstueck}</td>
                                  <td className="px-6 py-4 text-slate-500">{item.schlag}</td>
                                  <td className="px-6 py-4 text-right font-bold text-red-400">{item.flaecheStr} ha</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </ResultCard>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div 
              key="ertrag"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-12"
            >
              <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900/20 to-slate-900 border border-indigo-500/20 p-10 rounded-[2.5rem] shadow-2xl">
                <div className="absolute top-0 right-0 p-10 opacity-10 pointer-events-none">
                  <Sprout className="w-48 h-48 text-indigo-400 rotate-12" />
                </div>
                <div className="relative z-10 flex flex-col md:flex-row gap-10">
                  <div className="space-y-4 max-w-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-indigo-600/30 shadow-lg">
                        <Sprout className="w-8 h-8 text-white" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-black text-white tracking-tight leading-none">Produktions-Sync</h2>
                        <p className="text-indigo-300/60 text-sm font-medium mt-1">Ertrags-Optimierung & Kulturen</p>
                      </div>
                    </div>
                    <p className="text-slate-400 text-sm leading-relaxed">
                      Verwenden Sie diese Ansicht, um Kulturwechsel zwischen FIONA und dem Portal schnell zu identifizieren und in der "Schnellbearbeitung" nachzupflegen.
                    </p>
                  </div>
                  
                  <div className="flex-1 grid grid-cols-1 gap-3">
                    <WorkflowStep number="1" text="Navigieren Sie zum Portal-Reiter 'Produktionsertrag'." />
                    <WorkflowStep number="2" text="Kopieren Sie die Ernte 2025 über den Button links unten." />
                    <WorkflowStep number="3" text="Nutzen Sie die Schnellbearbeitung für die unten gelisteten SCHLÄGE." />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 flex items-center justify-between">
                  FIONA Stammdaten (CSV)
                  <span className="text-indigo-400/50 normal-case font-medium">Auto-Parsing aktiv</span>
                </label>
                <div className="relative border border-white/5 rounded-2xl bg-[#161922] focus-within:border-indigo-500/40 shadow-sm overflow-hidden">
                  <textarea
                    className="w-full min-h-[180px] p-6 text-xs font-mono resize-y bg-transparent outline-none leading-relaxed text-slate-300"
                    placeholder="Einfügen der FIONA-CSV für Kulturanalyse..."
                    value={csvData}
                    onChange={(e) => setCsvData(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-8">
                <div className="flex items-center justify-between">
                   <h3 className="text-2xl font-bold text-white tracking-tight">Vorgemerkte Kulturänderungen</h3>
                   <div className="px-4 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-xs font-black text-indigo-400 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      {cropGroups.length} Gruppen detektiert
                   </div>
                </div>

                {cropGroups.length === 0 ? (
                  <div className="py-24 bg-white/2 border border-white/5 rounded-[3rem] flex flex-col items-center justify-center text-slate-700">
                    <Sprout className="w-16 h-16 mb-4 opacity-5" />
                    <p className="font-bold text-xl uppercase tracking-widest">Keine Datenquelle</p>
                    <p className="text-sm opacity-50 font-medium">Warten auf Import-Stream...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {cropGroups.map((group, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        key={idx} 
                        className="bg-[#161922] border border-white/5 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col hover:border-indigo-500/20 transition-all group"
                      >
                        <div className="bg-white/2 p-8 flex justify-between items-start">
                          <div>
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-2 block">Ziel-Kultur:</span>
                            <h3 className="text-xl font-bold text-white leading-tight">{group.kulturName}</h3>
                          </div>
                          <span className="bg-indigo-600 text-white text-[10px] font-black px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/20 uppercase tracking-widest">
                            {group.flaechen.length} {group.flaechen.length === 1 ? 'Fläche' : 'Flächen'}
                          </span>
                        </div>
                        <div className="flex-1 overflow-y-auto max-h-[400px]">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-[#1C212E] sticky top-0 z-10 border-b border-white/5">
                              <tr>
                                <th className="px-8 py-4 font-bold text-slate-500 uppercase tracking-widest">Schlag</th>
                                <th className="px-8 py-4 font-bold text-amber-500/50 uppercase tracking-widest">Vorfrucht</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/2">
                              {group.flaechen.map((f, i) => (
                                <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                                  <td className="px-8 py-5">
                                    <div className="font-bold text-slate-200">{f.bezeichnung}</div>
                                    <div className="text-[10px] font-mono text-slate-600 mt-1">ID: {f.schlag}</div>
                                  </td>
                                  <td className="px-8 py-5">
                                    <div className="text-amber-400/80 bg-amber-400/5 px-3 py-1.5 rounded-lg border border-amber-400/10 font-bold">
                                       {f.kulturVJ || 'UNDEFINED'}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="p-5 bg-black/20 text-[10px] font-bold text-slate-600 text-center uppercase tracking-[0.4em]">
                           Reference Data Block
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {copiedMsg && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30, x: '-50%' }}
              animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, scale: 0.9, y: 30, x: '-50%' }}
              className="fixed bottom-12 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-10 py-5 rounded-2xl shadow-[0_20px_50px_rgba(79,70,229,0.3)] z-[100] flex items-center gap-4 border border-white/10 backdrop-blur-3xl"
            >
              <div className="bg-white/20 rounded-full p-1.5">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-sm tracking-tight">{copiedMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-6xl mx-auto px-10 py-16 text-center">
        <p className="text-[10px] font-black text-slate-700 uppercase tracking-[0.5em]">Lumina Agriculture Systems • v2.0</p>
      </footer>
    </div>
  );
}

function ResultCard({ title, count, type, icon, children }: { title: string; count: number; type: 'add' | 'change' | 'delete', icon: React.ReactNode, children: React.ReactNode }) {
  const colors = {
    add: 'from-indigo-500 to-indigo-600 shadow-indigo-500/20 border-indigo-500/10',
    change: 'from-amber-500 to-amber-600 shadow-amber-500/20 border-amber-500/10',
    delete: 'from-red-500/80 to-red-600 shadow-red-500/20 border-red-500/10'
  };

  const borderColors = {
    add: 'border-indigo-500/10 bg-indigo-500/5',
    change: 'border-amber-500/10 bg-amber-500/5',
    delete: 'border-red-500/10 bg-red-500/5'
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.99 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-[3rem] p-3 border ${borderColors[type]} overflow-hidden`}
    >
      <div className="bg-[#161922] rounded-[2.5rem] p-10 border border-white/5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
           {icon}
        </div>
        <div className="flex items-center justify-between mb-10 relative z-10">
          <div className="flex items-center gap-6">
            <div className={`p-5 rounded-2xl bg-gradient-to-br ${colors[type]} text-white shadow-xl ring-4 ring-white/5`}>
              {icon}
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white tracking-tight leading-none">{title}</h2>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-[0.3em] mt-3">Task Completion Summary</p>
            </div>
          </div>
          <div className={`text-5xl font-black ${type === 'add' ? 'text-indigo-400' : type === 'change' ? 'text-amber-400' : 'text-red-400'} tabular-nums drop-shadow-lg`}>
            {count}
          </div>
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </motion.div>
  );
}

function WorkflowStep({ number, text }: { number: string, text: string }) {
  return (
    <div className="flex gap-5 items-start bg-white/2 p-5 rounded-3xl border border-white/5 hover:bg-white/5 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex-shrink-0 flex items-center justify-center text-sm font-black shadow-lg shadow-indigo-600/20 border border-white/10">
        {number}
      </div>
      <p className="text-sm font-semibold text-slate-300 leading-tight pt-1.5">
        {text}
      </p>
    </div>
  );
}
