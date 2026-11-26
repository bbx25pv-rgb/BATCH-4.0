import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Lock,
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

  if (failed || !src) {
    return (
      <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
        <PlayCircle className="w-5 h-5" />
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
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
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
      setActiveLectureId(null);
      setPlayTrigger(0);
      return;
    }

    setLoadingLectures(true);
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
        setActiveLectureId((prev) =>
          prev && items.some((l) => l.id === prev) ? prev : items[0]?.id ?? null
        );
        setLoadingLectures(false);
      },
      (error) => {
        setLoadingLectures(false);
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [selectedBatch, canAccessSelectedBatch]);

  const activeLectureIndex = useMemo(() => {
    if (lectures.length === 0) return -1;
    const idx = lectures.findIndex((l) => l.id === activeLectureId);
    return idx >= 0 ? idx : 0;
  }, [lectures, activeLectureId]);

  const activeLecture =
    activeLectureIndex >= 0 ? lectures[activeLectureIndex] : null;
  const nextLecture =
    activeLectureIndex >= 0 && activeLectureIndex + 1 < lectures.length
      ? lectures[activeLectureIndex + 1]
      : null;

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

  // Classroom View for an enrolled batch
  if (selectedBatch && canAccessSelectedBatch) {
    return (
      <section className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setSelectedBatch(null);
              setPlayTrigger(0);
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Lecture Batches</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium">
            <ShieldCheck className="w-4 h-4" />
            <span>
              {isAdmin && !activePurchasedBatchIds.has(selectedBatch.id)
                ? 'Admin Preview Access'
                : 'Enrolled Batch Access'}
            </span>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-xs text-slate-500">
            {selectedBatch.subjectTag} · {selectedBatch.instructor}
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            {selectedBatch.title}
          </h1>
        </div>

        {loadingLectures ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 aspect-video bg-slate-200 rounded-xl animate-pulse" />
            <div className="lg:col-span-4 h-96 bg-slate-100 rounded-xl animate-pulse" />
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
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Video Player Stage */}
            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
              {activeLecture && (
                <>
                  <CadenceVideoPlayer
                    videoId={activeLecture.youtubeVideoId}
                    title={activeLecture.title}
                    subtitle={`${activeLecture.moduleName} · Lesson ${activeLecture.orderIndex + 1}`}
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
                  <div className="p-6">
                    <div className="pb-5 border-b border-slate-100">
                      <p className="text-xs text-slate-500">
                        {activeLecture.moduleName} · Lesson {activeLecture.orderIndex + 1} ·{' '}
                        <span className="font-mono tabular-nums">
                          {activeLecture.durationMinutes} min
                        </span>
                      </p>
                      <h2 className="text-xl font-bold text-slate-900 mt-1">
                        {activeLecture.title}
                      </h2>
                    </div>
                    {activeLecture.summary && (
                      <p className="mt-4 text-sm text-slate-600 leading-relaxed">
                        {activeLecture.summary}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Curriculum Playlist */}
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Batch Curriculum
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {lectures.length} {lectures.length === 1 ? 'lecture' : 'lectures'}
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
                {lectures.map((lec, idx) => {
                  const isActive = activeLecture?.id === lec.id;
                  return (
                    <button
                      key={lec.id}
                      type="button"
                      onClick={() => {
                        setActiveLectureId(lec.id);
                        setPlayTrigger((c) => c + 1);
                      }}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-center gap-3 ${
                        isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="relative w-20 aspect-video rounded-md overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                        <LectureThumbnail
                          src={lec.thumbnailUrl || selectedBatch.coverImage}
                          title={lec.title}
                        />
                        <span
                          className={`absolute bottom-1 left-1 px-1 py-0.5 text-[10px] font-mono tabular-nums leading-none rounded ${
                            isActive
                              ? 'bg-blue-600 text-white font-semibold'
                              : 'bg-slate-950/80 text-white'
                          }`}
                        >
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium leading-snug line-clamp-2 ${
                            isActive ? 'text-blue-900' : 'text-slate-900'
                          }`}
                        >
                          {lec.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
                          <span className="truncate">{lec.moduleName}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums shrink-0">
                            {lec.durationMinutes}m
                          </span>
                        </p>
                      </div>
                    </button>
                  );
                })}
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

            return (
              <article
                key={batch.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col justify-between"
              >
                <div>
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

                    <h2 className="mt-2 text-lg font-bold text-slate-900 leading-snug">
                      {batch.title}
                    </h2>

                    <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">
                      {batch.description}
                    </p>
                  </div>
                </div>

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
                      <span>Open Classroom</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!userId) {
                          onRequireSignIn();
                          return;
                        }
                        setPurchaseError(null);
                        setCheckoutBatch(batch);
                      }}
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
