import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  Edit3,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Habit,
  SessionMode,
  StudySession,
  Subject,
  SubjectColorKey,
  VALIDATION_LIMITS,
} from '@/src/types';
import {
  createSubject,
  deleteStudySession,
  deleteSubject,
  logStudySession,
  updateSessionNotes,
} from '@/src/lib/studyService';
import {
  formatMinutesAsHours,
  getSubjectBarClass,
  getTodayDateString,
} from '@/src/lib/utils';

interface SessionLogsViewProps {
  userId: string | null;
  onRequireSignIn: () => void;
  onBrowseBatches?: () => void;
  subjects: Subject[];
  sessions: StudySession[];
  habits: Habit[];
  loadingData: boolean;
}

export function SessionLogsView({
  userId,
  onRequireSignIn,
  onBrowseBatches,
  subjects,
  sessions,
  habits,
  loadingData,
}: SessionLogsViewProps) {
  const [subjectFilter, setSubjectFilter] = useState<string>('all');
  const [modeFilter, setModeFilter] = useState<'all' | SessionMode>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Subject form state
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [subjName, setSubjName] = useState('');
  const [subjCode, setSubjCode] = useState('');
  const [subjTarget, setSubjTarget] = useState(240);
  const [subjColor, setSubjColor] = useState<SubjectColorKey>('cobalt');
  const [savingSubject, setSavingSubject] = useState(false);

  // Log Manual Session state
  const [showLogSession, setShowLogSession] = useState(false);
  const [logSubjectId, setLogSubjectId] = useState('');
  const [logMinutes, setLogMinutes] = useState(45);
  const [logNotes, setLogNotes] = useState('');
  const [savingLog, setSavingLog] = useState(false);

  // Edit note inline
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const today = getTodayDateString();

  const stats = useMemo(() => {
    const totalMinutes = sessions.reduce((acc, s) => acc + s.durationMinutes, 0);
    const totalTargetMinutes = subjects.reduce(
      (acc, s) => acc + s.targetMinutesPerWeek,
      0
    );
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyMinutes = sessions
      .filter((s) => s.completedAt && s.completedAt.toMillis() >= sevenDaysAgo)
      .reduce((acc, s) => acc + s.durationMinutes, 0);
    const weeklyPct =
      totalTargetMinutes > 0
        ? Math.min(100, Math.round((weeklyMinutes / totalTargetMinutes) * 100))
        : 0;
    const maxStreak = habits.reduce((max, h) => Math.max(max, h.streakDays), 0);

    return {
      totalMinutes,
      sessionCount: sessions.length,
      weeklyMinutes,
      weeklyPct,
      maxStreak,
    };
  }, [sessions, subjects, habits]);

  const weeklyBySubject = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    sessions.forEach((s) => {
      if (s.completedAt && s.completedAt.toMillis() >= sevenDaysAgo) {
        map.set(s.subjectId, (map.get(s.subjectId) ?? 0) + s.durationMinutes);
      }
    });
    return map;
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (subjectFilter !== 'all' && s.subjectId !== subjectFilter) return false;
      if (modeFilter !== 'all' && s.mode !== modeFilter) return false;
      if (q) {
        const matchSubj = s.subjectName.toLowerCase().includes(q);
        const matchNote = s.notes.toLowerCase().includes(q);
        const matchLec = s.lectureTitle.toLowerCase().includes(q);
        if (!matchSubj && !matchNote && !matchLec) return false;
      }
      return true;
    });
  }, [sessions, subjectFilter, modeFilter, searchQuery]);

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return onRequireSignIn();
    if (!subjName.trim() || !subjCode.trim()) {
      setFormError('Subject name and course code are required.');
      return;
    }
    setFormError(null);
    setSavingSubject(true);
    try {
      await createSubject(userId, {
        name: subjName,
        code: subjCode,
        targetMinutesPerWeek: subjTarget,
        colorKey: subjColor,
      });
      setSubjName('');
      setSubjCode('');
      setSubjTarget(240);
      setShowAddSubject(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to add subject.');
    } finally {
      setSavingSubject(false);
    }
  }

  async function handleLogManual(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return onRequireSignIn();
    const targetSubj =
      subjects.find((s) => s.id === logSubjectId) ?? subjects[0];
    if (!targetSubj) {
      setFormError('Create a subject before logging a study session.');
      return;
    }
    setFormError(null);
    setSavingLog(true);
    try {
      await logStudySession(userId, {
        subject: targetSubj,
        durationMinutes: logMinutes,
        mode: 'manual',
        notes: logNotes,
        habitsToAdvance: habits,
      });
      setLogNotes('');
      setLogMinutes(45);
      setShowLogSession(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to log session.');
    } finally {
      setSavingLog(false);
    }
  }

  async function handleSaveNote(sessionId: string) {
    await updateSessionNotes(sessionId, editNoteText);
    setEditingSessionId(null);
  }

  if (!userId) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-10 text-center max-w-xl mx-auto">
          <BookOpen className="w-8 h-8 text-blue-600 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            Subject Session Logs & Academic Goals
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            Sign in with Google or your phone number to track cumulative hours per subject, review your chronological study logs, and monitor weekly target attainment.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRequireSignIn}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Sign in
            </button>
            {onBrowseBatches && (
              <button
                type="button"
                onClick={onBrowseBatches}
                className="px-5 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Browse Lecture Batches
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Subject Session Logs
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Track cumulative effort across subjects and review every completed Pomodoro, lecture, and offline study session.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setShowAddSubject((v) => !v);
              setShowLogSession(false);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Subject</span>
          </button>
          <button
            type="button"
            disabled={subjects.length === 0}
            onClick={() => {
              if (!logSubjectId && subjects[0]) setLogSubjectId(subjects[0].id);
              setShowLogSession((v) => !v);
              setShowAddSubject(false);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Log Study Session</span>
          </button>
        </div>
      </div>

      {/* 4-column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Logged Study</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {formatMinutesAsHours(stats.totalMinutes)}
          </p>
          <p className="mt-1 text-xs text-slate-500">All recorded sessions</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Completed Sessions</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.sessionCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Pomodoro, lecture & manual</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Weekly Goal Attainment</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.weeklyPct}%
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {formatMinutesAsHours(stats.weeklyMinutes)} logged past 7 days
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Top Habit Streak</p>
          <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {stats.maxStreak} days
          </p>
          <p className="mt-1 text-xs text-slate-500">As of {today}</p>
        </div>
      </div>

      {formError && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
          {formError}
        </div>
      )}

      {/* Add Subject Panel */}
      {showAddSubject && (
        <form
          onSubmit={handleAddSubject}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">New Academic Subject</h2>
            <button
              type="button"
              onClick={() => setShowAddSubject(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="subj-name" className="block text-xs font-medium text-slate-700 mb-1">
                Subject Name
              </label>
              <input
                id="subj-name"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.subjectNameMax}
                value={subjName}
                onChange={(e) => setSubjName(e.target.value)}
                placeholder="e.g., Linear Algebra"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label htmlFor="subj-code" className="block text-xs font-medium text-slate-700 mb-1">
                Course Code
              </label>
              <input
                id="subj-code"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.subjectCodeMax}
                value={subjCode}
                onChange={(e) => setSubjCode(e.target.value)}
                placeholder="MATH 240"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label htmlFor="subj-target" className="block text-xs font-medium text-slate-700 mb-1">
                Weekly Target (min)
              </label>
              <input
                id="subj-target"
                type="number"
                min={30}
                max={6000}
                value={subjTarget}
                onChange={(e) => setSubjTarget(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-xs font-medium text-slate-700">Bar Accent:</span>
              {(['cobalt', 'emerald', 'amber', 'rose', 'slate'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSubjColor(key)}
                  className={`min-h-[36px] px-2.5 py-1 text-xs rounded-md border capitalize ${
                    subjColor === key
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={savingSubject}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
            >
              {savingSubject ? 'Creating...' : 'Create Subject'}
            </button>
          </div>
        </form>
      )}

      {/* Manual Study Session Form */}
      {showLogSession && (
        <form
          onSubmit={handleLogManual}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">
              Log Manual Study Session
            </h2>
            <button
              type="button"
              onClick={() => setShowLogSession(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="manual-subj" className="block text-xs font-medium text-slate-700 mb-1">
                Subject
              </label>
              <select
                id="manual-subj"
                value={logSubjectId || subjects[0]?.id || ''}
                onChange={(e) => setLogSubjectId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="manual-mins" className="block text-xs font-medium text-slate-700 mb-1">
                Duration (minutes)
              </label>
              <input
                id="manual-mins"
                type="number"
                min={1}
                max={480}
                value={logMinutes}
                onChange={(e) => setLogMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="manual-note" className="block text-xs font-medium text-slate-700 mb-1">
                Academic Milestone / Notes
              </label>
              <input
                id="manual-note"
                type="text"
                maxLength={VALIDATION_LIMITS.sessionNotesMax}
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
                placeholder="e.g., Reviewed textbook problems 1-14 and made flashcard deck"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingLog}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
            >
              {savingLog ? 'Saving...' : 'Save Session Log'}
            </button>
          </div>
        </form>
      )}

      {/* Subject Weekly Targets Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-slate-900">
            Academic Subject Progress
          </h2>
          <span className="text-xs text-slate-500">
            Past 7 days vs weekly goal
          </span>
        </div>

        {loadingData ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="h-24 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : subjects.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-600">
            No academic subjects yet. Add your first subject above to start logging sessions.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {subjects.map((subject) => {
              const weeklyMins = weeklyBySubject.get(subject.id) ?? 0;
              const pct = Math.min(
                100,
                Math.round(
                  (weeklyMins / Math.max(1, subject.targetMinutesPerWeek)) * 100
                )
              );

              return (
                <div
                  key={subject.id}
                  className="pt-4 border-t border-slate-100 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-mono text-slate-500">
                          {subject.code}
                        </p>
                        <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                          {subject.name}
                        </h3>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete ${subject.name}`}
                        onClick={() => void deleteSubject(subject.id)}
                        className="p-1 text-slate-400 hover:text-rose-700 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getSubjectBarClass(
                            subject.colorKey
                          )}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-700">
                        {pct}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                    <span>
                      {formatMinutesAsHours(weeklyMins)} /{' '}
                      {formatMinutesAsHours(subject.targetMinutesPerWeek)} wk
                    </span>
                    <span>Total {formatMinutesAsHours(subject.totalMinutesLogged)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chronological Subject Session Log Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-3">
            <div className="relative flex-1 sm:flex-initial min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes, subjects, or lectures..."
                className="pl-9 pr-3 py-2 sm:py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-xs text-slate-900 w-full sm:w-64 focus:outline-2 focus:outline-blue-600"
              />
            </div>

            <select
              aria-label="Filter by subject"
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 sm:py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-base sm:text-xs text-slate-800"
            >
              <option value="all">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start max-w-full overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'pomodoro', label: 'Pomodoro' },
                { id: 'lecture', label: 'Lecture' },
                { id: 'manual', label: 'Manual' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModeFilter(m.id)}
                className={`px-3 py-1.5 sm:py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  modeFilter === m.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile Card Ledger View */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredSessions.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-slate-500">
              {sessions.length === 0
                ? 'No study sessions logged yet. Start a Pomodoro timer or log a manual session to build momentum.'
                : 'No sessions match your current filters.'}
            </div>
          ) : (
            filteredSessions.map((session) => {
              const completedDate = session.completedAt
                ? session.completedAt.toDate()
                : new Date();
              const dateFormatted = completedDate.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
              const timeFormatted = completedDate.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              });
              const subjectStillExists = subjects.some(
                (s) => s.id === session.subjectId
              );

              return (
                <div key={session.id} className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-mono tabular-nums text-slate-500">
                        {dateFormatted} · {timeFormatted} ·{' '}
                        <span className="capitalize font-sans">{session.mode}</span>
                      </p>
                      <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                        {session.subjectName}
                      </p>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-slate-900 shrink-0">
                      {session.durationMinutes} min
                    </span>
                  </div>

                  {editingSessionId === session.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        maxLength={VALIDATION_LIMITS.sessionNotesMax}
                        value={editNoteText}
                        onChange={(e) => setEditNoteText(e.target.value)}
                        className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-base sm:text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSaveNote(session.id)}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg"
                        aria-label="Save note"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSessionId(null)}
                        className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
                        aria-label="Cancel edit"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {session.lectureTitle && (
                          <p className="text-xs font-medium text-blue-700 mb-0.5">
                            Lecture: {session.lectureTitle}
                          </p>
                        )}
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {session.notes || 'Focus block completed'}
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          aria-label="Edit session note"
                          onClick={() => {
                            setEditingSessionId(session.id);
                            setEditNoteText(session.notes);
                          }}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-slate-800 rounded-lg transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete session log"
                          onClick={() =>
                            void deleteStudySession(session, subjectStillExists)
                          }
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-rose-700 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="py-3 px-5">Date</th>
                <th className="py-3 px-4">Subject</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4 text-right">Duration</th>
                <th className="py-3 px-4">Milestone & Notes</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-slate-500">
                    {sessions.length === 0
                      ? 'No study sessions logged yet. Start a Pomodoro timer or log a manual session to build momentum.'
                      : 'No sessions match your current filters.'}
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => {
                  const completedDate = session.completedAt
                    ? session.completedAt.toDate()
                    : new Date();
                  const dateFormatted = completedDate.toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  });
                  const timeFormatted = completedDate.toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const subjectStillExists = subjects.some(
                    (s) => s.id === session.subjectId
                  );

                  return (
                    <tr key={session.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-5 whitespace-nowrap text-xs font-mono tabular-nums text-slate-600">
                        {dateFormatted} · {timeFormatted}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {session.subjectName}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 capitalize whitespace-nowrap">
                        {session.mode}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {session.durationMinutes} min
                      </td>
                      <td className="py-3 px-4 text-slate-700 max-w-md">
                        {editingSessionId === session.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              maxLength={VALIDATION_LIMITS.sessionNotesMax}
                              value={editNoteText}
                              onChange={(e) => setEditNoteText(e.target.value)}
                              className="flex-1 px-2.5 py-1 border border-slate-300 rounded text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => void handleSaveNote(session.id)}
                              className="p-1 text-emerald-700 hover:bg-emerald-50 rounded"
                              aria-label="Save note"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSessionId(null)}
                              className="p-1 text-slate-500 hover:bg-slate-100 rounded"
                              aria-label="Cancel edit"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div>
                            {session.lectureTitle && (
                              <p className="text-xs font-medium text-blue-700 mb-0.5">
                                Lecture: {session.lectureTitle}
                              </p>
                            )}
                            <p className="text-xs text-slate-600">
                              {session.notes || 'Focus block completed'}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Edit session note"
                            onClick={() => {
                              setEditingSessionId(session.id);
                              setEditNoteText(session.notes);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-800 rounded transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete session log"
                            onClick={() =>
                              void deleteStudySession(session, subjectStillExists)
                            }
                            className="p-1.5 text-slate-400 hover:text-rose-700 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
