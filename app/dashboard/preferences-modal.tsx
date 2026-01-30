"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface Preferences {
    training_days: string[];
    long_run_day: string;
    max_weekly_km: number;
    notes: string;
}

interface LactateData {
    test_date: string;
    aerobic_threshold_hr: string;
    aerobic_threshold_pace: string;
    anaerobic_threshold_hr: string;
    anaerobic_threshold_pace: string;
    max_hr: string;
    vo2max: string;
    // Editable HR zones (stored as "min-max" strings)
    z1_hr?: string;  // e.g., "100-120"
    z2_hr?: string;  // e.g., "120-144"
    z3_hr?: string;  // e.g., "144-150"
    z4_hr?: string;  // e.g., "150-157"
    z5_hr?: string;  // e.g., "157-180"
}

interface PreferencesModalProps {
    onClose: () => void;
    onSave: () => void;
}

const DAYS = [
    { id: 'mon', label: 'Mon' },
    { id: 'tue', label: 'Tue' },
    { id: 'wed', label: 'Wed' },
    { id: 'thu', label: 'Thu' },
    { id: 'fri', label: 'Fri' },
    { id: 'sat', label: 'Sat' },
    { id: 'sun', label: 'Sun' },
];

export function PreferencesModal({ onClose, onSave }: PreferencesModalProps) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [preferences, setPreferences] = useState<Preferences>({
        training_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
        long_run_day: 'sunday',
        max_weekly_km: 80,
        notes: '',
    });
    const [athleteProfile, setAthleteProfile] = useState<{
        firstName?: string;
        sex?: string;
        age?: number;
        weight?: number;
    } | null>(null);
    const [lactateData, setLactateData] = useState<LactateData>({
        test_date: '',
        aerobic_threshold_hr: '',
        aerobic_threshold_pace: '',
        anaerobic_threshold_hr: '',
        anaerobic_threshold_pace: '',
        max_hr: '',
        vo2max: '',
    });
    const [savingLactate, setSavingLactate] = useState(false);
    const [parsingPdf, setParsingPdf] = useState(false);
    const [pdfError, setPdfError] = useState('');
    const [journalEntries, setJournalEntries] = useState<Array<{
        date: string;
        sleep_quality?: number;
        stress_level?: number;
        nutrition_score?: number;
        hrv_status?: string;
        notes?: string;
        tags?: string[];
        custom_data?: Record<string, unknown>;
    }>>([]);
    const [showJournal, setShowJournal] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);

    // Fetch preferences, profile, lactate data, and journal on mount
    useEffect(() => {
        async function fetchData() {
            try {
                const [prefsRes, profileRes, lactateRes, journalRes] = await Promise.all([
                    fetch('/api/preferences'),
                    fetch('/api/athlete-profile'),
                    fetch('/api/lactate-test'),
                    fetch('/api/journal?days=90'),
                ]);

                if (prefsRes.ok) {
                    const data = await prefsRes.json();
                    setPreferences({
                        training_days: data.training_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
                        long_run_day: data.long_run_day || 'sunday',
                        max_weekly_km: data.max_weekly_km || 80,
                        notes: data.notes || '',
                    });
                }

                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    setAthleteProfile(profile);
                }

                if (lactateRes.ok) {
                    const { test } = await lactateRes.json();
                    if (test) {
                        setLactateData({
                            test_date: test.test_date ? new Date(test.test_date).toISOString().split('T')[0] : '',
                            aerobic_threshold_hr: test.aerobic_threshold_hr?.toString() || '',
                            aerobic_threshold_pace: test.aerobic_threshold_pace || '',
                            anaerobic_threshold_hr: test.anaerobic_threshold_hr?.toString() || '',
                            anaerobic_threshold_pace: test.anaerobic_threshold_pace || '',
                            max_hr: test.max_hr?.toString() || '',
                            vo2max: test.vo2max?.toString() || '',
                            z1_hr: test.z1_hr || '',
                            z2_hr: test.z2_hr || '',
                            z3_hr: test.z3_hr || '',
                            z4_hr: test.z4_hr || '',
                            z5_hr: test.z5_hr || '',
                        });
                    }
                }

                if (journalRes.ok) {
                    const { entries } = await journalRes.json();
                    setJournalEntries(entries || []);
                }
            } catch (err) {
                console.error('Failed to fetch data:', err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, []);

    // Escape key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Prevent body scroll
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preferences),
            });
            if (res.ok) {
                onSave();
                onClose();
            }
        } catch (err) {
            console.error('Failed to save preferences:', err);
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (day: string) => {
        setPreferences(p => ({
            ...p,
            training_days: p.training_days.includes(day)
                ? p.training_days.filter(d => d !== day)
                : [...p.training_days, day]
        }));
    };

    const handleSaveLactate = async () => {
        if (!lactateData.test_date) return;
        setSavingLactate(true);
        try {
            // Calculate default zone values for fallback
            const lt1 = parseInt(lactateData.aerobic_threshold_hr) || 0;
            const lt2 = parseInt(lactateData.anaerobic_threshold_hr) || 0;
            const maxHR = parseInt(lactateData.max_hr) || (lt2 ? lt2 + 15 : 190);
            const z1Min = lt1 ? Math.round(lt1 * 0.70) : 100;
            const z1Max = lt1 ? Math.round(lt1 * 0.85) : 120;
            const z2Max = lt1 || 145;
            const z3Max = lt1 && lt2 ? Math.round((lt1 + lt2) / 2) : 160;
            const z4Max = lt2 || 175;

            // Use saved values or calculated defaults
            const dataToSave = {
                ...lactateData,
                z1_hr: lactateData.z1_hr || `${z1Min}-${z1Max}`,
                z2_hr: lactateData.z2_hr || `${z1Max}-${z2Max}`,
                z3_hr: lactateData.z3_hr || `${z2Max}-${z3Max}`,
                z4_hr: lactateData.z4_hr || `${z3Max}-${z4Max}`,
                z5_hr: lactateData.z5_hr || `${z4Max}-${maxHR}`,
            };

            const res = await fetch('/api/lactate-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dataToSave),
            });
            if (res.ok) {
                // Update local state with saved values
                setLactateData(dataToSave);
                // Trigger page reload to refresh AI context with new lactate data
                onSave();
                onClose();
            }
        } catch (err) {
            console.error('Failed to save lactate data:', err);
        } finally {
            setSavingLactate(false);
        }
    };

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setParsingPdf(true);
        setPdfError('');

        try {
            const formData = new FormData();
            formData.append('pdf', file);

            const res = await fetch('/api/lactate-test/parse-pdf', {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (!data.success) {
                setPdfError(data.error || 'Failed to parse PDF');
                return;
            }

            // Auto-fill the form with extracted data
            setLactateData(prev => ({
                ...prev,
                test_date: data.test_date || prev.test_date,
                max_hr: data.max_hr?.toString() || prev.max_hr,
                aerobic_threshold_hr: data.aerobic_threshold_hr?.toString() || prev.aerobic_threshold_hr,
                aerobic_threshold_pace: data.aerobic_threshold_pace || prev.aerobic_threshold_pace,
                anaerobic_threshold_hr: data.anaerobic_threshold_hr?.toString() || prev.anaerobic_threshold_hr,
                anaerobic_threshold_pace: data.anaerobic_threshold_pace || prev.anaerobic_threshold_pace,
                vo2max: data.vo2max?.toString() || prev.vo2max,
            }));

            // Show success message with summary
            const zonesCount = data.hr_zones?.length || 0;
            const curvePoints = data.lactate_curve?.length || 0;
            setPdfError(`✓ Extracted: ${zonesCount} HR zones, ${curvePoints} lactate curve points`);

        } catch (err) {
            console.error('PDF parsing error:', err);
            setPdfError('Failed to upload PDF. Please try again.');
        } finally {
            setParsingPdf(false);
            // Reset the input so the same file can be selected again
            if (pdfInputRef.current) {
                pdfInputRef.current.value = '';
            }
        }
    };

    const modalContent = (
        <div
            ref={modalRef}
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: 99999 }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="absolute inset-0 bg-black/80" />
            <div className="relative bg-slate-800 rounded-2xl border border-white/20 p-5 w-full max-w-lg max-h-[90vh] overflow-auto shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">⚙️ Coach Memory & Preferences</h3>
                    <button
                        onClick={onClose}
                        className="text-purple-400 hover:text-white text-2xl leading-none p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <p className="text-xs text-purple-300/60 mb-4">
                    The AI coach will remember these settings and use them in future conversations.
                </p>

                {loading ? (
                    <div className="text-center py-8 text-purple-300/60">Loading...</div>
                ) : (
                    <div className="space-y-5">
                        {/* Strava Profile Info */}
                        {athleteProfile && (
                            <div className="bg-slate-700/30 rounded-xl p-4 border border-white/5">
                                <label className="block text-sm text-white font-medium mb-3">
                                    🏔️ Your Strava Profile
                                </label>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    {athleteProfile.firstName && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-300/60">Name:</span>
                                            <span className="text-white">{athleteProfile.firstName}</span>
                                        </div>
                                    )}
                                    {athleteProfile.sex && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-300/60">Gender:</span>
                                            <span className="text-white">{athleteProfile.sex === 'M' ? 'Male' : 'Female'}</span>
                                        </div>
                                    )}
                                    {athleteProfile.age && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-300/60">Age:</span>
                                            <span className="text-white">{athleteProfile.age} years</span>
                                        </div>
                                    )}
                                    {athleteProfile.weight && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-purple-300/60">Weight:</span>
                                            <span className="text-white">{athleteProfile.weight} kg</span>
                                        </div>
                                    )}
                                </div>
                                {!athleteProfile.age && !athleteProfile.weight && (
                                    <p className="text-xs text-purple-300/40 mt-2">
                                        Add birthday & weight in Strava settings to see them here
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Lactate Test Data */}
                        <div className="bg-slate-700/30 rounded-xl p-4 border border-white/5">
                            <label className="block text-sm text-white font-medium mb-3">
                                🔬 Lab Test Data
                            </label>
                            <p className="text-xs text-purple-300/60 mb-3">
                                From your lactate test - the coach will use these for precise training zones
                            </p>

                            {/* PDF Upload Section */}
                            <div className="mb-4 p-3 bg-slate-800/50 rounded-lg border border-dashed border-purple-500/30">
                                <input
                                    ref={pdfInputRef}
                                    type="file"
                                    accept=".pdf"
                                    onChange={handlePdfUpload}
                                    className="hidden"
                                    id="lactate-pdf-upload"
                                />
                                <label
                                    htmlFor="lactate-pdf-upload"
                                    className={`flex items-center justify-center gap-2 cursor-pointer py-2 px-4 rounded-lg text-sm transition-colors ${parsingPdf
                                        ? 'bg-purple-500/20 text-purple-300'
                                        : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 hover:text-purple-300'
                                        }`}
                                >
                                    {parsingPdf ? (
                                        <><span className="animate-spin">⏳</span> Parsing PDF...</>
                                    ) : (
                                        <>📄 Upload Lactate Test PDF</>
                                    )}
                                </label>
                                <p className="text-[10px] text-purple-300/40 text-center mt-2">
                                    AI will extract thresholds, zones, and VO2max automatically
                                </p>
                                {pdfError && (
                                    <p className={`text-xs text-center mt-2 ${pdfError.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                                        {pdfError}
                                    </p>
                                )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-purple-300/60">Test Date</label>
                                    <input
                                        type="date"
                                        value={lactateData.test_date}
                                        onChange={(e) => setLactateData(d => ({ ...d, test_date: e.target.value }))}
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-purple-300/60">Max HR</label>
                                    <input
                                        type="number"
                                        value={lactateData.max_hr}
                                        onChange={(e) => setLactateData(d => ({ ...d, max_hr: e.target.value }))}
                                        placeholder="e.g., 185"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-purple-300/60">Aerobic Threshold HR (LT1)</label>
                                    <input
                                        type="number"
                                        value={lactateData.aerobic_threshold_hr}
                                        onChange={(e) => setLactateData(d => ({ ...d, aerobic_threshold_hr: e.target.value }))}
                                        placeholder="e.g., 145"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-purple-300/60">LT1 Pace (/km)</label>
                                    <input
                                        type="text"
                                        value={lactateData.aerobic_threshold_pace}
                                        onChange={(e) => setLactateData(d => ({ ...d, aerobic_threshold_pace: e.target.value }))}
                                        placeholder="e.g., 5:30"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-purple-300/60">Anaerobic Threshold HR (LT2)</label>
                                    <input
                                        type="number"
                                        value={lactateData.anaerobic_threshold_hr}
                                        onChange={(e) => setLactateData(d => ({ ...d, anaerobic_threshold_hr: e.target.value }))}
                                        placeholder="e.g., 165"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-purple-300/60">LT2 Pace (/km)</label>
                                    <input
                                        type="text"
                                        value={lactateData.anaerobic_threshold_pace}
                                        onChange={(e) => setLactateData(d => ({ ...d, anaerobic_threshold_pace: e.target.value }))}
                                        placeholder="e.g., 4:45"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-xs text-purple-300/60">VO2max</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={lactateData.vo2max}
                                        onChange={(e) => setLactateData(d => ({ ...d, vo2max: e.target.value }))}
                                        placeholder="e.g., 52.5"
                                        className="w-full px-2 py-1.5 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                                    />
                                </div>
                            </div>

                            {/* Editable HR Zones */}
                            {(lactateData.aerobic_threshold_hr || lactateData.anaerobic_threshold_hr) && (
                                <div className="mt-4 p-3 bg-gradient-to-r from-purple-500/10 to-orange-500/10 rounded-lg border border-purple-500/20">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-xs text-purple-300 font-medium">📊 Your HR Training Zones</p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                // Recalculate zones from thresholds
                                                const lt1 = parseInt(lactateData.aerobic_threshold_hr) || 0;
                                                const lt2 = parseInt(lactateData.anaerobic_threshold_hr) || 0;
                                                const maxHR = parseInt(lactateData.max_hr) || (lt2 ? lt2 + 15 : 190);
                                                const z1Min = lt1 ? Math.round(lt1 * 0.70) : 100;
                                                const z1Max = lt1 ? Math.round(lt1 * 0.85) : 120;
                                                const z2Max = lt1 || 145;
                                                const z3Max = lt1 && lt2 ? Math.round((lt1 + lt2) / 2) : 160;
                                                const z4Max = lt2 || 175;
                                                setLactateData(d => ({
                                                    ...d,
                                                    z1_hr: `${z1Min}-${z1Max}`,
                                                    z2_hr: `${z1Max}-${z2Max}`,
                                                    z3_hr: `${z2Max}-${z3Max}`,
                                                    z4_hr: `${z3Max}-${z4Max}`,
                                                    z5_hr: `${z4Max}-${maxHR}`,
                                                }));
                                            }}
                                            className="text-[10px] text-purple-400 hover:text-purple-300 px-2 py-0.5 bg-purple-500/10 rounded"
                                        >
                                            🔄 Recalculate
                                        </button>
                                    </div>
                                    <div className="space-y-1.5">
                                        {(() => {
                                            const lt1 = parseInt(lactateData.aerobic_threshold_hr) || 0;
                                            const lt2 = parseInt(lactateData.anaerobic_threshold_hr) || 0;
                                            const maxHR = parseInt(lactateData.max_hr) || (lt2 ? lt2 + 15 : 190);
                                            const z1Min = lt1 ? Math.round(lt1 * 0.70) : 100;
                                            const z1Max = lt1 ? Math.round(lt1 * 0.85) : 120;
                                            const z2Max = lt1 || 145;
                                            const z3Max = lt1 && lt2 ? Math.round((lt1 + lt2) / 2) : 160;
                                            const z4Max = lt2 || 175;

                                            const zones = [
                                                { key: 'z1_hr', zone: 'Z1', name: 'Recovery', defaultVal: `${z1Min}-${z1Max}`, color: 'bg-blue-500' },
                                                { key: 'z2_hr', zone: 'Z2', name: 'Aerobic', defaultVal: `${z1Max}-${z2Max}`, color: 'bg-green-500' },
                                                { key: 'z3_hr', zone: 'Z3', name: 'Tempo', defaultVal: `${z2Max}-${z3Max}`, color: 'bg-yellow-500' },
                                                { key: 'z4_hr', zone: 'Z4', name: 'Threshold', defaultVal: `${z3Max}-${z4Max}`, color: 'bg-orange-500' },
                                                { key: 'z5_hr', zone: 'Z5', name: 'VO2max', defaultVal: `${z4Max}-${maxHR}`, color: 'bg-red-500' },
                                            ] as const;

                                            return zones.map(z => (
                                                <div key={z.zone} className="flex items-center gap-2 text-xs">
                                                    <div className={`w-8 h-6 ${z.color} rounded flex items-center justify-center text-white font-bold text-[10px]`}>
                                                        {z.zone}
                                                    </div>
                                                    <span className="text-white w-16">{z.name}</span>
                                                    <input
                                                        type="text"
                                                        value={lactateData[z.key] || z.defaultVal}
                                                        onChange={(e) => setLactateData(d => ({ ...d, [z.key]: e.target.value }))}
                                                        placeholder={z.defaultVal}
                                                        className="w-20 px-1.5 py-0.5 bg-slate-700/50 border border-white/10 rounded text-white text-xs text-center"
                                                    />
                                                    <span className="text-purple-300/50">bpm</span>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                    <p className="text-[10px] text-purple-300/40 mt-2">
                                        Format: min-max (e.g., 120-144). Edit to override calculated values.
                                    </p>
                                </div>
                            )}

                            {!lactateData.aerobic_threshold_hr && !lactateData.anaerobic_threshold_hr && (
                                <p className="text-xs text-purple-300/40 mt-3 text-center">
                                    💡 Enter LT1/LT2 values above to see your personalized HR zones
                                </p>
                            )}

                            {lactateData.test_date && (
                                <button
                                    onClick={handleSaveLactate}
                                    disabled={savingLactate}
                                    className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg disabled:opacity-50"
                                >
                                    {savingLactate ? 'Saving...' : '💾 Save Lab Test Data'}
                                </button>
                            )}
                        </div>

                        {/* Coach Memory (Notes) - Most Important! */}
                        <div>
                            <label className="block text-sm text-white font-medium mb-2">
                                🧠 Coach Memory
                            </label>
                            <p className="text-xs text-purple-300/60 mb-2">
                                Anything you want the coach to remember about you (diet, injuries, preferences, etc.)
                            </p>
                            <textarea
                                value={preferences.notes}
                                onChange={(e) => setPreferences(p => ({ ...p, notes: e.target.value }))}
                                placeholder="e.g., I'm vegetarian. Recovering from IT band injury. I prefer running in the morning. Add nutrition tips to my plans..."
                                rows={4}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm placeholder-purple-300/40 resize-none"
                            />
                        </div>

                        {/* Training Days */}
                        <div>
                            <label className="block text-sm text-white font-medium mb-2">
                                📅 Training Days
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {DAYS.map(day => (
                                    <button
                                        key={day.id}
                                        onClick={() => toggleDay(day.id)}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${preferences.training_days.includes(day.id)
                                            ? 'bg-purple-500 text-white'
                                            : 'bg-slate-700/50 text-purple-300/60 hover:bg-slate-700'
                                            }`}
                                    >
                                        {day.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Long Run Day */}
                        <div>
                            <label className="block text-sm text-white font-medium mb-2">
                                🏔️ Preferred Long Run Day
                            </label>
                            <select
                                value={preferences.long_run_day}
                                onChange={(e) => setPreferences(p => ({ ...p, long_run_day: e.target.value }))}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-white/10 rounded-lg text-white text-sm"
                            >
                                <option value="saturday">Saturday</option>
                                <option value="sunday">Sunday</option>
                                <option value="friday">Friday</option>
                            </select>
                        </div>

                        {/* Max Weekly KM */}
                        <div>
                            <label className="block text-sm text-white font-medium mb-2">
                                📏 Max Weekly Volume: {preferences.max_weekly_km} km
                            </label>
                            <input
                                type="range"
                                min={20}
                                max={200}
                                step={5}
                                value={preferences.max_weekly_km}
                                onChange={(e) => setPreferences(p => ({ ...p, max_weekly_km: parseInt(e.target.value) }))}
                                className="w-full accent-purple-500"
                            />
                            <div className="flex justify-between text-xs text-purple-300/40 mt-1">
                                <span>20km</span>
                                <span>200km</span>
                            </div>
                        </div>

                        {/* Life Log History (Collapsible) */}
                        <div className="bg-slate-700/30 rounded-xl p-4 border border-white/5">
                            <button
                                onClick={() => setShowJournal(!showJournal)}
                                className="w-full flex items-center justify-between text-sm text-white font-medium"
                            >
                                <span>📔 Life Log History ({journalEntries.length} entries)</span>
                                <span className="text-purple-400">{showJournal ? '▼' : '▶'}</span>
                            </button>

                            {showJournal && (
                                <div className="mt-3 space-y-2 max-h-64 overflow-auto">
                                    {journalEntries.length === 0 ? (
                                        <p className="text-xs text-purple-300/50 text-center py-4">
                                            No life log entries yet. Chat with the coach about your sleep, stress, nutrition, or anything else to start tracking.
                                        </p>
                                    ) : (
                                        journalEntries.map((entry, i) => (
                                            <div key={i} className="bg-slate-800/50 rounded-lg p-2.5 border border-white/5">
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <span className="text-xs font-medium text-white">
                                                        {new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                                    </span>
                                                    {entry.tags && entry.tags.length > 0 && (
                                                        <div className="flex gap-1">
                                                            {entry.tags.map((tag, ti) => (
                                                                <span key={ti} className="text-[9px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">
                                                                    {tag}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-[10px]">
                                                    {entry.sleep_quality && (
                                                        <span className="text-blue-400">😴 Sleep: {entry.sleep_quality}/10</span>
                                                    )}
                                                    {entry.stress_level && (
                                                        <span className="text-orange-400">😰 Stress: {entry.stress_level}/10</span>
                                                    )}
                                                    {entry.nutrition_score && (
                                                        <span className="text-green-400">🥗 Nutrition: {entry.nutrition_score}/10</span>
                                                    )}
                                                    {entry.hrv_status && (
                                                        <span className="text-purple-400">💓 HRV: {entry.hrv_status}</span>
                                                    )}
                                                </div>
                                                {entry.notes && (
                                                    <p className="text-xs text-purple-300/60 mt-1.5 italic">"{entry.notes}"</p>
                                                )}
                                                {entry.custom_data && (() => {
                                                    const customData = entry.custom_data as { mentions?: Array<{ category: string; item: string; detail?: string }> };
                                                    const mentions = customData.mentions;
                                                    if (!mentions || mentions.length === 0) return null;
                                                    const categoryEmoji: Record<string, string> = {
                                                        wellness: '😴', physical_state: '💪', cross_training: '🏋️',
                                                        recovery: '🧘', nutrition: '🥗', life_context: '📅',
                                                        mood: '🧠', other: '📝'
                                                    };
                                                    return (
                                                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                            {mentions.map((m, mi) => (
                                                                <span key={mi} className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">
                                                                    {categoryEmoji[m.category] || '📝'} {m.item}{m.detail ? `: ${m.detail}` : ''}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                            <p className="text-[10px] text-purple-300/40 mt-2">
                                ✓ Data is safely stored in the database and persists across sessions
                            </p>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-slate-700/50 text-purple-300 rounded-lg text-sm hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="flex-1 py-2.5 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Preferences'}
                    </button>
                </div>
            </div>
        </div>
    );

    if (typeof window !== 'undefined') {
        return createPortal(modalContent, document.body);
    }
    return null;
}
