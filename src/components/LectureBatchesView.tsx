import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Play,
  PlayCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { purchaseBatch } from '@/src/lib/studyService';
import { resolveAssetUrl } from '@/src/lib/utils';
import { Batch, BatchPurchase, Lecture } from '@/src/types';
import { CadenceVideoPlayer } from '@/src/components/CadenceVideoPlayer';

interface LectureBatchesViewProps {
  userId: string | null;
  isAdmin: boolean;
  onRequireSignIn: () => void;
  batches: Batch[];
  purchases: BatchPurchase[];
  loadingBatches: boolean;
}

function BatchCover({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex flex-col items-center justify-center p-4 text-slate-500">
        <BookOpen className="w-8 h-8 mb-2 text-slate-400" />
        <span className="text-xs font-medium text-center line-clamp-2">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={resolveAssetUrl(src)}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover"
    />
  );
}

function LectureThumbnail({ src, title }: { src?: string; title: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center text-slate-400">
        <PlayCircle className="w-8 h-8" />
      </div>
    );
  }

  return (
    <img
      src={resolveAssetUrl(src)}
      alt={title}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-full h-full object-cover"
    />
  );
}

export function LectureBatchesView({
  userId,
  isAdmin,
  onRequireSignIn,
  batches,
  purchases,
  loadingBatches,
}: LectureBatchesViewProps) {
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'purchased' | 'available'>('all');
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [checkoutBatch, setCheckoutBatch] = useState<Batch | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // Lectures loaded ONLY for an active purchased batch (or admin)
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
  const [isPlayerCardOpen, setIsPlayerCardOpen] = useState(false);
  const [playTrigger, setPlayTrigger] = useState(0);

  const activePurchasedBatchIds = useMemo(() => {
    const set = new Set<string>();
    purchases.forEach((p) => {
      if (p.status === 'active') set.add(p.batchId);
    });
    return set;
  }, [purchases]);

  const visibleBatches = useMemo(() => {
    return batches.filter((b) => {
      if (!b.isPublished && !isAdmin) return false;
      const owned = activePurchasedBatchIds.has(b.id);
      if (catalogFilter === 'purchased') return owned;
      if (catalogFilter === 'available') return !owned;
      return true;
    });
  }, [batches, isAdmin, activePurchasedBatchIds, catalogFilter]);

  const canAccessSelectedBatch = useMemo(() => {
    if (!selectedBatch || !userId) return false;
    return isAdmin || activePurchasedBatchIds.has(selectedBatch.id);
  }, [selectedBatch, userId, isAdmin, activePurchasedBatchIds]);

  useEffect(() => {
    if (!selectedBatch || !canAccessSelectedBatch) {
      setLectures([]);
      setModuleFilter('all');
      setActiveLectureId(null);
      setIsPlayerCardOpen(false);
      setPlayTrigger(0);
      return;
    }

    setLoadingLectures(true);
    setModuleFilter('all');
    const path = `batches/${selectedBatch.id}/lectures`;
    const q = query(collection(db, path), orderBy('orderIndex', 'asc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: Lecture[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Lecture, 'id'>),
        }));
        setLectures(items);
        setActiveLectureId((prev) => {
          if (prev && items.some((l) => l.id === prev)) return prev;
          return items[0]?.id ?? null;
        });
        setLoadingLectures(false);
      },
      (error) => {
        setLoadingLectures(false);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [selectedBatch, canAccessSelectedBatch]);

  const moduleNames = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    lectures.forEach((l) => {
      const name = l.moduleName?.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        list.push(name);
      }
    });
    return list;
  }, [lectures]);

  const filteredLectures = useMemo(() => {
    if (moduleFilter === 'all') return lectures;
    return lectures.filter((l) => l.moduleName === moduleFilter);
  }, [lectures, moduleFilter]);

  const totalDurationMinutes = useMemo(
    () => lectures.reduce((sum, l) => sum + (l.durationMinutes || 0), 0),
    [lectures]
  );

  const activeLectureIndex = useMemo(() => {
    if (lectures.length === 0) return -1;
    const idx = lectures.findIndex((l) => l.id === activeLectureId);
    return idx >= 0 ? idx : 0;
  }, [lectures, activeLectureId]);

  const activeLecture =
    activeLectureIndex >= 0 ? lectures[activeLectureIndex] : null;
  const previousLecture =
    activeLectureIndex > 0 ? lectures[activeLectureIndex - 1] : null;
  const nextLecture =
    activeLectureIndex >= 0 && activeLectureIndex + 1 < lectures.length
      ? lectures[activeLectureIndex + 1]
      : null;

  useEffect(() => {
    if (!isPlayerCardOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        setIsPlayerCardOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlayerCardOpen]);

  function handleOpenLectureCard(lectureId: string) {
    setActiveLectureId(lectureId);
    setPlayTrigger((c) => c + 1);
    setIsPlayerCardOpen(true);
  }

  async function handleConfirmPurchase() {
    if (!userId || !checkoutBatch) return;
    setPurchaseError(null);
    setPurchasing(true);
    try {
      await purchaseBatch(userId, checkoutBatch);
      const enrolled = checkoutBatch;
      setCheckoutBatch(null);
      setSelectedBatch(enrolled);
    } catch (err) {
      setPurchaseError(
        err instanceof Error ? err.message : 'Unable to complete batch enrollment.'
      );
    } finally {
      setPurchasing(false);
    }
  }

  // Classroom View for an enrolled batch — displays subject lectures as clickable cards
  if (selectedBatch && canAccessSelectedBatch) {
    return (
      <section className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setIsPlayerCardOpen(false);
              setSelectedBatch(null);
              setPlayTrigger(0);
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Lecture Batches</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium whitespace-nowrap shrink-0">
            <ShieldCheck className="w-4 h-4" />
            <span>
              {isAdmin && !activePurchasedBatchIds.has(selectedBatch.id)
                ? 'Admin Preview Access'
                : 'Enrolled Batch Access'}
            </span>
          </div>
        </div>

        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs text-slate-500">
              <span>{selectedBatch.subjectTag}</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              <span>{selectedBatch.instructor}</span>
              <span aria-hidden="true" className="mx-1.5">·</span>
              <span className="font-mono tabular-nums">
                {lectures.length} {lectures.length === 1 ? 'lecture' : 'lectures'}
              </span>
              {totalDurationMinutes > 0 && (
                <>
                  <span aria-hidden="true" className="mx-1.5">·</span>
                  <span className="font-mono tabular-nums">{totalDurationMinutes} min total</span>
                </>
              )}
            </p>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mt-1 text-balance">
              {selectedBatch.title}
            </h1>
            {selectedBatch.description && (
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                {selectedBatch.description}
              </p>
            )}
          </div>

          {moduleNames.length > 1 && (
            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              <button
                type="button"
                onClick={() => setModuleFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  moduleFilter === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Modules
              </button>
              {moduleNames.map((mod) => (
                <button
                  key={mod}
                  type="button"
                  onClick={() => setModuleFilter(mod)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    moduleFilter === mod
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {mod}
                </button>
              ))}
            </div>
          )}
        </div>

        {loadingLectures ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-80 bg-white border border-slate-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : lectures.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <PlayCircle className="w-9 h-9 text-slate-400 mx-auto mb-3" />
            <h2 className="text-base font-semibold text-slate-900">
              No lectures published in this batch yet
            </h2>
            <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
              Unlisted lecture videos added by the administrator for this batch will appear here immediately.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredLectures.map((lec) => {
              const lessonNumber =
                lectures.findIndex((item) => item.id === lec.id) + 1;
              const isSelected = isPlayerCardOpen && activeLecture?.id === lec.id;

              return (
                <button
                  key={lec.id}
                  type="button"
                  onClick={() => handleOpenLectureCard(lec.id)}
                  className={`group text-left bg-white border rounded-xl overflow-hidden flex flex-col justify-between transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    isSelected
                      ? 'border-blue-600'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="w-full">
                    <div className="relative aspect-video w-full bg-slate-950 overflow-hidden border-b border-slate-100">
                      <LectureThumbnail
                        src={lec.thumbnailUrl || selectedBatch.coverImage}
                        title={lec.title}
                      />
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="w-12 h-12 rounded-full bg-slate-950/75 group-hover:bg-blue-600 text-white flex items-center justify-center transition-colors">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </span>
                      </div>
                      <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-xs font-mono tabular-nums text-white">
                        <span>Lesson {String(lessonNumber).padStart(2, '0')}</span>
                        <span>{lec.durationMinutes} min</span>
                      </div>
                    </div>

                    <div className="p-5">
                      <p className="text-xs text-slate-500">
                        <span>{selectedBatch.subjectTag}</span>
                        <span aria-hidden="true" className="mx-1.5">·</span>
                        <span>{lec.moduleName}</span>
                      </p>

                      <h2 className="mt-1.5 text-base font-bold text-slate-900 group-hover:text-blue-700 leading-snug transition-colors line-clamp-2">
                        {lec.title}
                      </h2>

                      {lec.summary && (
                        <p className="mt-2 text-sm text-slate-600 line-clamp-2 leading-relaxed">
                          {lec.summary}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="w-full px-5 pb-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-500 truncate">
                      {selectedBatch.instructor}
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 group-hover:text-blue-700 transition-colors whitespace-nowrap shrink-0">
                      <PlayCircle className="w-4 h-4" />
                      <span>Watch Lecture</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Lecture Player Card Modal */}
        {isPlayerCardOpen && activeLecture && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lecture-player-card-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsPlayerCardOpen(false);
              }
            }}
            className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
          >
            <div className="bg-white border border-slate-200 rounded-xl max-w-4xl w-full overflow-hidden shadow-2xl my-auto">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500 truncate">
                    <span>{selectedBatch.subjectTag}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span>{activeLecture.moduleName}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">
                      Lesson {activeLectureIndex + 1} of {lectures.length}
                    </span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">
                      {activeLecture.durationMinutes} min
                    </span>
                  </p>
                  <h2
                    id="lecture-player-card-title"
                    className="text-lg font-bold text-slate-900 mt-0.5 truncate"
                  >
                    {activeLecture.title}
                  </h2>
                </div>

                <button
                  type="button"
                  aria-label="Close lecture card"
                  onClick={() => setIsPlayerCardOpen(false)}
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <CadenceVideoPlayer
                key={activeLecture.id}
                videoId={activeLecture.youtubeVideoId}
                title={activeLecture.title}
                subtitle={`${activeLecture.moduleName} · Lesson ${activeLectureIndex + 1}`}
                posterImage={activeLecture.thumbnailUrl || selectedBatch.coverImage}
                playTrigger={playTrigger}
                hasNextLecture={Boolean(nextLecture)}
                onNextLecture={() => {
                  if (nextLecture) {
                    setActiveLectureId(nextLecture.id);
                    setPlayTrigger((c) => c + 1);
                  }
                }}
              />

              <div className="p-5 bg-white border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {activeLecture.summary ? (
                    <p className="text-sm text-slate-600 leading-relaxed">
                      {activeLecture.summary}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">
                      {selectedBatch.title} · {selectedBatch.instructor}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!previousLecture}
                    onClick={() => {
                      if (previousLecture) {
                        setActiveLectureId(previousLecture.id);
                        setPlayTrigger((c) => c + 1);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  <button
                    type="button"
                    disabled={!nextLecture}
                    onClick={() => {
                      if (nextLecture) {
                        setActiveLectureId(nextLecture.id);
                        setPlayTrigger((c) => c + 1);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Next Lecture</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Batch Catalog Grid
  return (
    <section className="max-w-[1280px] mx-auto px-6 py-8">
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Academic Lecture Batches
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Enroll in structured subject cohorts. Unlisted lecture videos are strictly restricted to students with an active batch purchase.
          </p>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          {(
            [
              { id: 'all', label: 'All Batches' },
              { id: 'purchased', label: 'My Purchased' },
              { id: 'available', label: 'Available' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCatalogFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                catalogFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loadingBatches ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-96 bg-white border border-slate-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : visibleBatches.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" />
          <h2 className="text-base font-semibold text-slate-900">
            {catalogFilter === 'purchased'
              ? 'No purchased batches yet'
              : 'No batches available'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
            {catalogFilter === 'purchased'
              ? 'Enroll in a cohort from Available Batches to unlock its unlisted lecture library.'
              : isAdmin
              ? 'Open the Admin Console to publish batches and add unlisted YouTube lecture links.'
              : 'An administrator has not published course batches yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleBatches.map((batch) => {
            const isOwned = activePurchasedBatchIds.has(batch.id);
            const canOpen = userId !== null && (isOwned || isAdmin);

            const handleBatchAction = () => {
              if (canOpen) {
                setSelectedBatch(batch);
                return;
              }
              if (!userId) {
                onRequireSignIn();
                return;
              }
              setPurchaseError(null);
              setCheckoutBatch(batch);
            };

            return (
              <article
                key={batch.id}
                className="group bg-white border border-slate-200 hover:border-slate-300 rounded-xl overflow-hidden flex flex-col justify-between transition-colors"
              >
                <button
                  type="button"
                  onClick={handleBatchAction}
                  className="text-left w-full flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
                >
                  <div className="aspect-video w-full bg-slate-100 overflow-hidden border-b border-slate-100">
                    <BatchCover src={batch.coverImage} title={batch.title} />
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {batch.subjectTag} · {batch.instructor}
                      </span>
                      <span className="font-mono tabular-nums shrink-0">
                        {batch.lectureCount} {batch.lectureCount === 1 ? 'lecture' : 'lectures'}
                      </span>
                    </div>

                    <h2 className="mt-2 text-lg font-bold text-slate-900 group-hover:text-blue-700 leading-snug transition-colors">
                      {batch.title}
                    </h2>

                    <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">
                      {batch.description}
                    </p>
                  </div>
                </button>

                <div className="px-6 pb-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    {isOwned ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Enrolled</span>
                      </span>
                    ) : isAdmin ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                        <span>Admin Access</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
                          ${batch.priceUsd}
                        </span>
                        <span>· Purchase required</span>
                      </span>
                    )}
                  </div>

                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => setSelectedBatch(batch)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Open Lectures</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleBatchAction}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Purchase Batch</span>
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Enrollment Checkout Modal */}
      {checkoutBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkout-title"
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-500">Batch Enrollment</p>
                <h2 id="checkout-title" className="text-lg font-bold text-slate-900 mt-0.5">
                  {checkoutBatch.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutBatch(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-5 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Instructor</span>
                <span className="font-medium text-slate-900">{checkoutBatch.instructor}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Unlisted Lectures</span>
                <span className="font-mono tabular-nums font-medium text-slate-900">
                  {checkoutBatch.lectureCount} videos
                </span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <span className="font-medium text-slate-900">Batch Tuition</span>
                <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  ${checkoutBatch.priceUsd}
                </span>
              </div>
              <p className="text-xs text-slate-500 pt-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>Instant lifetime access to all batch lectures upon enrollment.</span>
              </p>
              {purchaseError && (
                <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2.5">
                  {purchaseError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCheckoutBatch(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={purchasing}
                onClick={() => void handleConfirmPurchase()}
                className="px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {purchasing ? 'Enrolling...' : `Confirm Purchase · $${checkoutBatch.priceUsd}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
