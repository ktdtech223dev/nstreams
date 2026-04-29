import React, { useState } from 'react';
import { useApp } from '../App';
import CrewCard from '../components/CrewCard';
import CrewProfileModal from '../components/CrewProfileModal';
import ActivityFeed from '../components/ActivityFeed';

export default function Crew() {
  const { users } = useApp();
  const [profileUser, setProfileUser] = useState(null);

  return (
    <div>
      <header className="mb-8">
        <h1 className="display-lg text-white">The Crew</h1>
        <p className="text-muted mt-1 text-sm">4 N Games members · their lists, progress, and activity</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-12">
        {users.map(u => (
          <CrewCard
            key={u.id}
            user={u}
            onViewProfile={setProfileUser}
          />
        ))}
      </div>

      <section>
        <h2 className="row-title mb-4">Recent Activity</h2>
        <div className="surface rounded-2xl p-5">
          <ActivityFeed />
        </div>
      </section>

      {profileUser && (
        <CrewProfileModal
          user={profileUser}
          onClose={() => setProfileUser(null)}
        />
      )}
    </div>
  );
}
