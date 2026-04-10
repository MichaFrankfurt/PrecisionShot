import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ShotList from '../components/ShotList';
import AIFeedback from '../components/AIFeedback';
import { api } from '../api';
import { useI18n } from '../i18n/useI18n';

const SIZE = 340;
const CENTER = SIZE / 2;
const RINGS = 10;
const RING_WIDTH = (SIZE / 2 - 10) / RINGS;

export default function SessionDetail() {
  const { t } = useI18n();
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getSession(id).then(setSession).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-gray-400 text-center mt-12">{t.loading}</p>;
  if (!session) return <p className="text-gray-400 text-center mt-12">{t.sessionNotFound}</p>;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/" className="text-gray-400 hover:text-white transition">&larr; {t.back}</Link>
        <h2 className="text-2xl font-bold">{t.series} #{session.id}</h2>
        <span className="text-gray-500 text-sm">{session.date}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="flex justify-center">
          <svg width={SIZE} height={SIZE}>
            <circle cx={CENTER} cy={CENTER} r={CENTER - 5} fill="#1a1a2e" stroke="#0f3460" strokeWidth="2" />
            {Array.from({ length: RINGS }, (_, i) => {
              const r = (RINGS - i) * RING_WIDTH;
              const isInner = i >= 7;
              return (
                <circle key={i} cx={CENTER} cy={CENTER} r={r} fill="none"
                  stroke={isInner ? 'rgba(233, 69, 96, 0.3)' : 'rgba(15, 52, 96, 0.5)'} strokeWidth="1" />
              );
            })}
            <circle cx={CENTER} cy={CENTER} r={3} fill="#e94560" />
            {session.shots?.map((shot, i) => (
              <g key={i}>
                <circle cx={CENTER + shot.x} cy={CENTER + shot.y} r={8}
                  fill="rgba(233, 69, 96, 0.3)" stroke="#e94560" strokeWidth="2" />
                <text x={CENTER + shot.x} y={CENTER + shot.y + 4}
                  textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>

        <div className="space-y-4">
          <AIFeedback feedback={session.ai_feedback} totalScore={session.total_score} />
          <ShotList shots={session.shots || []} />
        </div>
      </div>
    </div>
  );
}
