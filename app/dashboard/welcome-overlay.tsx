"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface WelcomeOverlayProps {
    userName: string;
    onComplete: () => void;
}

const TOUR_STEPS = [
    {
        title: "Welcome to UltraCoach! 🏔️",
        description: "Your AI-powered running coach that learns from your Strava data and adapts to your race calendar. Let me show you around!",
        icon: "👋"
    },
    {
        title: "Your Weekly Plan",
        description: "A personalized 7-day training plan that updates based on your goals and recovery. Click any day to discuss it with the coach.",
        icon: "📅"
    },
    {
        title: "Add Your Races",
        description: "Add upcoming races using the + button. The coach automatically calculates your training phases and taper based on race date.",
        icon: "🏁"
    },
    {
        title: "Life Logging",
        description: "Tell the coach about sleep, stress, pain, or anything affecting your training. Just type naturally: \"slept poorly\" or \"right calf is tight\". It remembers!",
        icon: "📝"
    },
    {
        title: "Your Heart Rate Zones",
        description: "Click ⚙️ Settings → Lactate Data to enter your test results or customize HR zones. These are used in all workout prescriptions.",
        icon: "❤️"
    },
    {
        title: "Training Preferences",
        description: "In Settings, set your available training days, preferred long run day, and weekly volume cap. The coach respects these limits.",
        icon: "⚙️"
    },
    {
        title: "Coach Memory",
        description: "Add permanent notes the coach remembers: injuries, dietary restrictions, work schedule, anything relevant to your training.",
        icon: "🧠"
    },
    {
        title: "Just Chat!",
        description: "Ask anything about training, recovery, nutrition, or race strategy. The coach knows your history and adapts to you.",
        icon: "💬"
    }
];

export function WelcomeOverlay({ userName, onComplete }: WelcomeOverlayProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    const handleNext = () => {
        if (currentStep < TOUR_STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            // Mark as completed in localStorage
            localStorage.setItem('ultracoach_onboarded', 'true');
            onComplete();
        }
    };

    const handleSkip = () => {
        localStorage.setItem('ultracoach_onboarded', 'true');
        onComplete();
    };

    const step = TOUR_STEPS[currentStep];

    if (!mounted) return null;

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center p-4"
            style={{ zIndex: 100000 }}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

            {/* Modal */}
            <div className="relative bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-white/20 p-8 max-w-md w-full shadow-2xl">
                {/* Progress dots */}
                <div className="flex justify-center gap-2 mb-6">
                    {TOUR_STEPS.map((_, idx) => (
                        <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-colors ${idx === currentStep
                                ? 'bg-gradient-to-r from-purple-500 to-orange-500'
                                : idx < currentStep
                                    ? 'bg-purple-500/50'
                                    : 'bg-slate-600'
                                }`}
                        />
                    ))}
                </div>

                {/* Icon */}
                <div className="text-5xl text-center mb-4">
                    {step.icon}
                </div>

                {/* Content */}
                <h2 className="text-xl font-bold text-white text-center mb-3">
                    {currentStep === 0 ? `Hey ${userName?.split(' ')[0] || 'there'}! ${step.title}` : step.title}
                </h2>
                <p className="text-purple-300/80 text-center mb-6">
                    {step.description}
                </p>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={handleSkip}
                        className="flex-1 py-2.5 text-purple-400 hover:text-white text-sm transition-colors"
                    >
                        Skip tour
                    </button>
                    <button
                        onClick={handleNext}
                        className="flex-1 py-2.5 bg-gradient-to-r from-purple-500 to-orange-500 text-white font-bold rounded-xl text-sm hover:opacity-90 transition-opacity"
                    >
                        {currentStep < TOUR_STEPS.length - 1 ? 'Next →' : 'Get Started! 🚀'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// Hook to check if user needs onboarding
export function useOnboarding() {
    const [showOnboarding, setShowOnboarding] = useState(false);

    useEffect(() => {
        const hasOnboarded = localStorage.getItem('ultracoach_onboarded');
        if (!hasOnboarded) {
            // Small delay to let the page render first
            setTimeout(() => setShowOnboarding(true), 500);
        }
    }, []);

    return {
        showOnboarding,
        completeOnboarding: () => setShowOnboarding(false),
        startOnboarding: () => setShowOnboarding(true)
    };
}

