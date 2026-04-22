import React, { useState, useEffect, useCallback } from 'react';

const STEPS_BY_USER = {
  arisa: [
    {
      emoji: '👋',
      title: "Welcome to N Streams, Ari!",
      body: "This is where the crew watches movies, shows, and anime together. Let's take a quick look around so you know where everything is.",
    },
    {
      emoji: '🔍',
      title: 'Browse & Discover',
      body: "Click Browse in the top nav to explore movies, TV shows, and anime. Search for anything or scroll through what's trending right now.",
    },
    {
      emoji: '📋',
      title: 'My List',
      body: "Add anything to your personal list — track what you're currently watching, what you've finished, and what you plan to watch next.",
    },
    {
      emoji: '👥',
      title: 'The Crew Tab',
      body: "Head over to Crew to see what everyone's been watching lately. It's a great way to find something new based on what the squad is into.",
    },
    {
      emoji: '🎉',
      title: 'Watch Parties',
      body: "Open any content and hit \"Watch Party\" to sync a video with the crew in real-time — everyone watches together, no matter where they are.",
    },
    {
      emoji: '🌐',
      title: 'Sites & Services',
      body: "The Sites tab lists all the streaming services the crew uses. Free and paid — the built-in player handles ads so you can focus on the show.",
    },
    {
      emoji: '✅',
      title: "You're All Set!",
      body: "That's everything. Pick something from Browse, add it to your list, and hit Play. The crew is watching — join in! 📺",
    },
  ],
};

// Profiles that get a tutorial in N Streams (by username)
const TUTORIAL_USERNAMES = new Set(['arisa']);

export default function TutorialOverlay({ username }) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  const steps = STEPS_BY_USER[username] ?? null;

  useEffect(() => {
    if (!username || !steps) return;
    if (!TUTORIAL_USERNAMES.has(username)) return;

    (async () => {
      const key = `nstreams_tutorial_done_${username}`;
      const done = window.electron ? await window.electron.getStore(key) : null;
      if (!done) {
        setStep(0);
        setVisible(true);
      }
    })();
  }, [username]);

  const next = useCallback(async () => {
    if (!steps) return;
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      // Last step — mark done and close
      const key = `nstreams_tutorial_done_${username}`;
      if (window.electron) await window.electron.setStore(key, true);
      setVisible(false);
    }
  }, [step, steps, username]);

  const back = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  if (!visible || !steps) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl p-8 text-center"
        style={{
          background: 'var(--surface-2, #1a1a2e)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 0 80px rgba(99,102,241,0.25)',
        }}
      >
        {/* Step counter */}
        <div className="flex justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i <= step ? 'var(--accent, #6366f1)' : 'rgba(255,255,255,0.15)',
                transition: 'all 0.3s',
              }}
            />
          ))}
        </div>

        {/* Emoji */}
        <div style={{ fontSize: 52, marginBottom: 12, lineHeight: 1 }}>
          {current.emoji}
        </div>

        {/* Title */}
        <div
          className="text-white font-bold mb-3"
          style={{ fontSize: 20 }}
        >
          {current.title}
        </div>

        {/* Body */}
        <div
          className="mb-8 leading-relaxed"
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}
        >
          {current.body}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-center">
          {!isFirst && (
            <button
              onClick={back}
              className="btn btn-ghost"
              style={{ minWidth: 80 }}
            >
              ← Back
            </button>
          )}
          <button
            onClick={next}
            className="btn btn-primary"
            style={{ minWidth: isLast ? 140 : 100 }}
          >
            {isLast ? "Let's Watch! 📺" : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
