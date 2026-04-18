import React from 'react';
import { useApp } from '../App';
import CrewCard from '../components/CrewCard';
import ActivityFeed from '../components/ActivityFeed';

export default function Crew() {
  const { users } = useApp();

  return (
    <div className="max-w-[1600px]">
      <header className="mb-6">
        <h1 className="font-display text-5xl text-white tracking-wide">The Crew</h1>
        <p className="text-muted mt-1">4 N Games members — their lists, progress, and activity</p>
      </header>

      <div className="grid grid-cols-2 gap-5 mb-10">
        {users.map(u => <CrewCard key={u.id} user={u} />)}
      </div>

      <section>
        <h2 className="font-display text-3xl text-white tracking-wide mb-4">Recent Activity</h2>
        <div className="bg-bg2 border border-border rounded-xl p-4">
          <ActivityFeed />
        </div>
      </section>
    </div>
  );
}
