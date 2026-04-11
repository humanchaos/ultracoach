"use client";

import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import ReactMarkdown from "react-markdown";
import {
    parseActionBlocks,
    validateRaceAdd,
    validateRaceDelete,
    validateProfileUpdate,
    validateGoalSet,
    validatePlanModification,
    validateMemorySave,
    validateLifeLog,
    ActionBlock,
} from "@/lib/coaching/action-blocks";

// NOTE: System prompt is now handled by the API using lib/coaching/system-prompt.ts (v3 architecture)
// This ensures a single source of truth for the coach's personality and expertise

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
}

interface Activity {
    name: string;
    date: string;
    dateISO?: string;  // ISO date for accurate parsing
    distance_km: number;
    pace?: string;
    heart_rate?: number;
}

interface Race {
    id: number;
    name: string;
    date: string;
    distance_km: number;
    goal_time?: string;
}

interface ChatInterfaceProps {
    trainingContext: string;
    activities?: Activity[];
    races?: Race[];
}

export interface ChatInterfaceRef {
    sendMessage: (message: string) => void;
}

export const ChatInterface = forwardRef<ChatInterfaceRef, ChatInterfaceProps>(
    function ChatInterface({ trainingContext, activities, races }, ref) {
        const [messages, setMessages] = useState<Message[]>([]);
        const [input, setInput] = useState("");
        const [isLoading, setIsLoading] = useState(false);
        const [showPrompts, setShowPrompts] = useState(false);
        const lastAssistantMessageRef = useRef<HTMLDivElement>(null);
        const [lastAssistantId, setLastAssistantId] = useState<string | null>(null);
        const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set());  // Track which messages are collapsed
        const [lastUserWasLifelog, setLastUserWasLifelog] = useState(false);  // Track if last message was lifelogging

        // Scroll to the START of the assistant message when it first appears
        // This allows users to read the AI response from the beginning
        useEffect(() => {
            if (lastAssistantId && lastAssistantMessageRef.current) {
                lastAssistantMessageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, [lastAssistantId]);

        // PROACTIVE ASSESSMENT: Auto-trigger workout analysis when new activities are synced
        const hasTriggeredRef = useRef(false);
        useEffect(() => {
            // Only trigger once per session and if we have activities
            if (hasTriggeredRef.current || !activities || activities.length === 0) return;

            // Get the most recent activity
            const latestActivity = activities[0];
            if (!latestActivity?.dateISO && !latestActivity?.date) return;

            // Create a unique key for this activity
            const activityKey = `${latestActivity.name}_${latestActivity.distance_km}_${latestActivity.dateISO || latestActivity.date}`;

            // Check if we've already assessed this activity
            const lastAssessedKey = localStorage.getItem('ultracoach_last_assessed_activity');
            if (lastAssessedKey === activityKey) return;

            // Check if activity is recent (within last 24 hours)
            const activityDate = new Date(latestActivity.dateISO || latestActivity.date);
            const now = new Date();
            const hoursSinceActivity = (now.getTime() - activityDate.getTime()) / (1000 * 60 * 60);

            // Only auto-assess if activity is within last 24 hours
            if (hoursSinceActivity > 24) return;

            // Mark as triggered and store the key
            hasTriggeredRef.current = true;
            localStorage.setItem('ultracoach_last_assessed_activity', activityKey);

            // Send proactive assessment trigger (slight delay for UX)
            setTimeout(() => {
                const triggerMessage = `[SYNC_TRIGGER] New workout synced: ${latestActivity.name} (${latestActivity.distance_km}km)`;
                sendInternalMessage(triggerMessage);
            }, 500);
        }, [activities]); // eslint-disable-line react-hooks/exhaustive-deps

        // Expose sendMessage to parent via ref
        useImperativeHandle(ref, () => ({
            sendMessage: (message: string) => {
                if (message.trim() && !isLoading) {
                    setInput(message);
                    // Trigger submit programmatically
                    setTimeout(() => {
                        const form = document.getElementById('chat-form') as HTMLFormElement;
                        form?.requestSubmit();
                    }, 0);
                }
            }
        }));

        // Internal message sender (for SYNC_TRIGGER — hidden from UI)
        const sendInternalMessage = (internalContent: string) => {
            if (isLoading) return;
            sendChatMessage(internalContent, true);
        };

        const handleSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            if (!input.trim() || isLoading) return;
            sendChatMessage(input, false);
        };

        const sendChatMessage = async (messageText: string, isInternal: boolean) => {
            const isSyncTrigger = messageText.startsWith('[SYNC_TRIGGER]');

            // For sync triggers, show a natural message in the UI instead of system internals
            const displayContent = isSyncTrigger
                ? `Just finished a workout — what do you think?`
                : messageText;

            const userMessage: Message = {
                id: Date.now().toString(),
                role: "user",
                content: displayContent,
            };

            if (!isInternal || isSyncTrigger) {
                setMessages((prev) => [...prev, userMessage]);
            }
            setInput("");
            setIsLoading(true);

            // Detect if this looks like a lifelogging message (explicit wellness/pain/sleep updates)
            const lifelogPatterns = /^(pain|sleep|tired|sore|stress:\s*\d|hrv:\s*\d|energy:\s*\d|injury|sick|ill|my .*(hurts|aching)|\d+\s*\/\s*10|slept|fatigued|exhausted|recovered|feeling (tired|great|sore|good|bad))/i;
            const coachingQuestionPatterns = /\?$|what should|how should|recommend|suggest|focus|today|plan|workout|train/i;
            const isCoachingQuestion = coachingQuestionPatterns.test(messageText.trim());
            const isLifelogMessage = lifelogPatterns.test(messageText.trim()) && !isCoachingQuestion;
            setLastUserWasLifelog(isLifelogMessage);

            // Sliding window: send last 8 messages + condensed summary of earlier ones
            const allMessages = [...messages.map((m) => ({ role: m.role, content: m.content })), { role: "user" as const, content: messageText }];
            const MAX_HISTORY = 8;
            let messagesToSend;
            if (allMessages.length > MAX_HISTORY) {
                const earlier = allMessages.slice(0, allMessages.length - MAX_HISTORY);
                const summary = `[Earlier in this conversation: ${earlier.length} messages exchanged covering: ${earlier.filter(m => m.role === 'user').map(m => m.content.slice(0, 50)).join('; ')}]`;
                messagesToSend = [
                    { role: 'system' as const, content: summary },
                    ...allMessages.slice(-MAX_HISTORY),
                ];
            } else {
                messagesToSend = allMessages;
            }

            try {
                const response = await fetch("/api/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        messages: messagesToSend,
                        trainingContext,
                        activities: activities || [],
                        races: races || [],
                    }),
                });

                if (!response.ok) throw new Error("Failed to get response");

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                let assistantContent = "";

                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: "",
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setLastAssistantId(assistantMessage.id);

                // Auto-collapse coach detailed responses by default (will be expanded after streaming completes if needed)
                // Details will be hidden, summary visible
                setCollapsedMessages(prev => new Set([...prev, assistantMessage.id]));

                while (reader) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split("\n");
                    for (const line of lines) {
                        if (line.startsWith("0:")) {
                            const text = line.slice(2).trim();
                            if (text.startsWith('"') && text.endsWith('"')) {
                                assistantContent += JSON.parse(text);
                                setMessages((prev) =>
                                    prev.map((m) =>
                                        m.id === assistantMessage.id
                                            ? { ...m, content: assistantContent }
                                            : m
                                    )
                                );
                            }
                        }
                    }
                }

                // Parse all action blocks from the response using unified parser
                const actionBlocks = parseActionBlocks(assistantContent);
                const statusMessages: string[] = [];

                for (const block of actionBlocks) {
                    try {
                        switch (block.type) {
                            case 'PLAN_MODIFICATION': {
                                const validated = validatePlanModification(block.payload);
                                if (validated) {
                                    console.log('[Chat] Detected plan modification:', validated);
                                    const res = await fetch('/api/training-plan/modify', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            dayName: validated.day,
                                            updates: validated.updates,
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Plan modification applied');
                                        statusMessages.push('✅ Plan updated');
                                    } else {
                                        console.error('[Chat] Plan modification failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'MEMORY_SAVE': {
                                const validated = validateMemorySave(block.payload);
                                if (validated) {
                                    console.log('[Chat] Saving memory:', validated);
                                    const res = await fetch('/api/coach-memory', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            memory_type: validated.memory_type,
                                            content: validated.content,
                                            extracted_from: 'chat',
                                            expires_in_days: validated.expires_in_days,
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Memory saved');
                                        statusMessages.push('🧠 Saved to memory');
                                    } else {
                                        console.error('[Chat] Memory save failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'RACE_ADD': {
                                const validated = validateRaceAdd(block.payload);
                                if (validated) {
                                    console.log('[Chat] Adding race:', validated);
                                    const res = await fetch('/api/races', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            name: validated.name,
                                            date: validated.date,
                                            distance_km: validated.distance_km,
                                            race_type: validated.race_type,
                                            priority: validated.priority,
                                            goal_time: validated.goal_time,
                                            notes: validated.notes,
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Race added');
                                        statusMessages.push('🏁 Race added to calendar');
                                    } else {
                                        console.error('[Chat] Race add failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'RACE_DELETE': {
                                const validated = validateRaceDelete(block.payload);
                                if (validated) {
                                    console.log('[Chat] Deleting race:', validated.race_id);
                                    const res = await fetch(`/api/races?id=${validated.race_id}`, {
                                        method: 'DELETE',
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Race deleted');
                                        statusMessages.push('🗑️ Race removed');
                                    } else {
                                        console.error('[Chat] Race delete failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'PROFILE_UPDATE': {
                                const validated = validateProfileUpdate(block.payload);
                                if (validated) {
                                    console.log('[Chat] Profile update:', validated);
                                    // Store as a memory since Strava is the official source
                                    // This captures the athlete's stated value for coaching context
                                    const content = [];
                                    if (validated.weight_kg) content.push(`Current weight: ${validated.weight_kg}kg`);
                                    if (validated.height_cm) content.push(`Height: ${validated.height_cm}cm`);

                                    const res = await fetch('/api/coach-memory', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            memory_type: 'health_note',
                                            content: content.join('. '),
                                            extracted_from: 'chat',
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Profile update saved as memory');
                                        statusMessages.push('📝 Profile noted');
                                    } else {
                                        console.error('[Chat] Profile update failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'GOAL_SET': {
                                const validated = validateGoalSet(block.payload);
                                if (validated) {
                                    console.log('[Chat] Setting goal:', validated);
                                    const res = await fetch('/api/goals', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            goal_type: validated.goal_type,
                                            running_experience: validated.running_experience,
                                            target_pace: validated.target_pace,
                                            weekly_mileage_km: validated.weekly_mileage_km,
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Goal set');
                                        statusMessages.push('🎯 Goal updated');
                                    } else {
                                        console.error('[Chat] Goal set failed:', await res.text());
                                    }
                                }
                                break;
                            }

                            case 'LIFE_LOG': {
                                const validated = validateLifeLog(block.payload);
                                if (validated) {
                                    console.log('[Chat] Logging wellness:', validated);
                                    const res = await fetch('/api/journal', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            date: validated.date || new Date().toISOString().split('T')[0],
                                            sleep_quality: validated.sleep_quality,
                                            stress_level: validated.stress_level,
                                            nutrition_score: validated.nutrition_score,
                                            hrv_status: validated.hrv_status,
                                            notes: validated.notes,
                                            tags: validated.tags,
                                            custom_data: validated.custom_data,
                                        }),
                                    });
                                    if (res.ok) {
                                        console.log('[Chat] Wellness logged');
                                        // Silent logging - no status message (per system prompt)
                                    } else {
                                        console.error('[Chat] Journal save failed:', await res.text());
                                    }
                                }
                                break;
                            }
                        }
                    } catch (blockError) {
                        console.error(`[Chat] Error processing ${block.type}:`, blockError);
                    }
                }

                // Append status messages to the assistant response
                if (statusMessages.length > 0) {
                    const statusNote = `\n\n*${statusMessages.join(' • ')} — Refresh to see changes.*`;
                    assistantContent += statusNote;
                    setMessages((prev) =>
                        prev.map((m) =>
                            m.id === assistantMessage.id
                                ? { ...m, content: assistantContent }
                                : m
                        )
                    );
                }
            } catch (error: unknown) {
                console.error("Chat error:", error);
                // Specific error messages based on error type
                let errorMsg = "Something went wrong. Please try again in a moment.";
                if (error instanceof TypeError && error.message.includes('fetch')) {
                    errorMsg = "Connection lost. Check your internet and try again.";
                } else if (error instanceof Error && error.message.includes('429')) {
                    errorMsg = "Too many requests — wait a moment and try again.";
                } else if (error instanceof Error && error.message.includes('timeout')) {
                    errorMsg = "Response took too long. Try a shorter question.";
                }
                setMessages((prev) => [
                    ...prev,
                    {
                        id: Date.now().toString(),
                        role: "assistant",
                        content: errorMsg,
                    },
                ]);
            } finally {
                setIsLoading(false);
            }
        };

        // Dynamic quick prompts based on athlete state
        const quickPrompts = (() => {
            const prompts: string[] = [];
            const latestActivity = activities?.[0];
            const hasRaces = races && races.length > 0;
            const noRecentActivity = !latestActivity || (() => {
                const d = new Date(latestActivity.dateISO || latestActivity.date);
                return (Date.now() - d.getTime()) > 3 * 24 * 60 * 60 * 1000;
            })();

            if (noRecentActivity) {
                prompts.push("I took some days off — what should I do now?");
            } else {
                prompts.push("How was my last workout?");
            }
            prompts.push("What should I focus on this week?");
            if (hasRaces) {
                prompts.push(`How should I prepare for ${races[0].name}?`);
            } else {
                prompts.push("Help me set a race goal");
            }
            prompts.push("Am I training too hard or too easy?");
            return prompts;
        })();

        return (
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-white/10 flex flex-col h-full">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center text-lg">
                                🤖
                            </div>
                            <div>
                                <h2 className="font-bold text-white">UltraCoach AI</h2>
                                <p className="text-sm text-purple-300/60">
                                    Your personal training intelligence
                                </p>
                            </div>
                        </div>
                        {messages.length > 0 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowPrompts(!showPrompts)}
                                    className="text-purple-300/60 hover:text-purple-300 text-xs px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                                    title="Quick prompts"
                                >
                                    💡
                                </button>
                                <button
                                    onClick={() => setMessages([])}
                                    className="text-purple-300/60 hover:text-purple-300 text-xs px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
                                    title="Clear chat"
                                >
                                    🗑️
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <div className="text-6xl mb-4">🏔️</div>
                            <h3 className="text-xl font-bold text-white mb-2">
                                Ready to optimize your training?
                            </h3>
                            <p className="text-purple-300/60 mb-4 max-w-md">
                                I analyze your Strava runs, adapt to your race calendar, and create personalized plans.
                            </p>
                            <div className="text-xs text-purple-300/40 mb-6 max-w-sm">
                                💡 Tip: Click ⚙️ in the header to save preferences I&apos;ll remember—like dietary needs or injury history.
                            </div>
                            <div className="flex flex-wrap justify-center gap-2">
                                {quickPrompts.map((prompt, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setInput(prompt)}
                                        className="px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-purple-200 text-sm rounded-full border border-white/10 transition-all hover:border-purple-500/50"
                                    >
                                        {prompt}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        messages.map((message) => {
                            const isCollapsed = collapsedMessages.has(message.id);
                            const firstLine = message.content.split('\n')[0].replace(/[\[\*#]/g, '').trim();

                            return (
                                <div
                                    key={message.id}
                                    ref={message.id === lastAssistantId ? lastAssistantMessageRef : null}
                                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                                >
                                    <div
                                        className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === "user"
                                            ? "bg-gradient-to-r from-purple-500 to-orange-500 text-white"
                                            : "bg-slate-700/50 text-purple-100 border border-white/5"
                                            }`}
                                    >
                                        {message.role === "assistant" ? (
                                            <div className="prose prose-sm prose-invert max-w-none prose-headings:text-purple-200 prose-headings:font-semibold prose-p:text-purple-100 prose-strong:text-white prose-ul:text-purple-100 prose-li:marker:text-purple-400">
                                                <ReactMarkdown>
                                                    {message.content
                                                        .replace(/\[COACH'S LOGIC\]/g, '**Coach\'s Analysis:**')
                                                        .replace(/\[THE PLAN\]/g, '\n**This Week\'s Plan:**')
                                                        .replace(/\[CHECK-IN\]/g, '\n**Check-in:**')
                                                    }
                                                </ReactMarkdown>
                                            </div>
                                        ) : (
                                            <div className="text-sm font-medium">{message.content}</div>
                                        )}
                                    </div>
                                </div>
                            )
                        })
                    )}
                    {isLoading && messages[messages.length - 1]?.role === "user" && (
                        <div className="flex justify-start">
                            <div className="bg-slate-700/50 rounded-2xl px-4 py-3 border border-white/5">
                                <div className="flex items-center gap-2">
                                    <div className="flex gap-1.5">
                                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" />
                                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                                        <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                                    </div>
                                    <span className="text-xs text-purple-300/60">🛡️ Safety Guardian prüft...</span>
                                </div>
                            </div>
                        </div>
                    )}

                </div>

                {/* Quick Prompts Panel (when toggled) */}
                {showPrompts && messages.length > 0 && (
                    <div className="px-4 py-2 border-t border-white/10 bg-slate-800/30">
                        <div className="flex flex-wrap gap-2">
                            {quickPrompts.map((prompt, i) => (
                                <button
                                    key={i}
                                    onClick={() => {
                                        setInput(prompt);
                                        setShowPrompts(false);
                                    }}
                                    className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-purple-200 text-xs rounded-full border border-white/10 transition-all hover:border-purple-500/50"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Input */}
                <form id="chat-form" onSubmit={handleSubmit} className="p-4 border-t border-white/10 shrink-0">
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask UltraCoach anything..."
                            className="flex-1 px-4 py-3 bg-slate-700/50 border border-white/10 rounded-xl text-white placeholder-purple-300/40 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-transparent"
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/20"
                        >
                            Send
                        </button>
                    </div>
                </form>
            </div>
        );
    }
);
