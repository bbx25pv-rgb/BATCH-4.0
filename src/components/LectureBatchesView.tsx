import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Lock,
  Play,
  PlayCircle,
  QrCode,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import {
  purchaseBatch,
  recordLectureOpened,
  toggleLectureCompleted,
} from '@/src/lib/studyService';
import {
  compressPaymentScreenshotDataUrl,
  formatInr,
  resolveAssetUrl,
} from '@/src/lib/utils';
import { loadYouTubeIframeApi } from '@/src/lib/youtubeApi';
import {
  Batch,
  BatchProgress,
  BatchPurchase,
  Lecture,
  LecturePreview,
  PaymentMethod,
  VALIDATION_LIMITS,
} from '@/src/types';
import { CadenceVideoPlayer } from '@/src/components/CadenceVideoPlayer';

type DisplayLecture = LecturePreview & Partial<Pick<Lecture, 'youtubeUrl' | 'youtubeVideoId'>>;

interface LectureBatchesViewProps {
  userId: string | null;
  isAdmin: boolean;
  onRequireSignIn: (batchId?: string) => void;
  pendingEnrollBatchId?: string | null;
  onClearPendingEnroll?: () => void;
  requestedOpenBatchId?: string | null;
  onClearRequestedOpenBatch?: () => void;
  batches: Batch[];
  purchases: BatchPurchase[];
  batchProgressList: BatchProgress[];
  paymentMethods: PaymentMethod[];
  loadingBatches: boolean;
}

interface SubmittedReceipt {
  batchTitle: string;
  amountPaid: number;
  utr: string;
  screenshotUrl: string;
  updated: boolean;
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
      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
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
      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
    />
  );
}

export function LectureBatchesView({
  userId,
  isAdmin,
  onRequireSignIn,
  pendingEnrollBatchId,
  onClearPendingEnroll,
  requestedOpenBatchId,
  onClearRequestedOpenBatch,
  batches,
  purchases,
  batchProgressList,
  paymentMethods,
  loadingBatches,
}: LectureBatchesViewProps) {
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'purchased' | 'available'>('all');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [checkoutBatch, setCheckoutBatch] = useState<Batch | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string>('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentScreenshotUrl, setPaymentScreenshotUrl] = useState('');
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [submittedReceipt, setSubmittedReceipt] = useState<SubmittedReceipt | null>(null);
  const [togglingLectureId, setTogglingLectureId] = useState<string | null>(null);
  const [pendingResumeLectureId, setPendingResumeLectureId] = useState<string | null>(null);

  const activePaymentMethods = useMemo(
    () => paymentMethods.filter((m) => m.isActive),
    [paymentMethods]
  );

  const courseSpecificPaymentOption = useMemo<PaymentMethod | null>(() => {
    if (!checkoutBatch) return null;
    const qrUrl = checkoutBatch.paymentQrUrl?.trim() || '';
    const upiId = checkoutBatch.paymentUpiId?.trim() || '';
    if (!qrUrl && !upiId) return null;
    return {
      id: '__course_qr__',
      label: 'Course Payment QR',
      type: 'upi',
      isActive: true,
      upiId,
      payeeName: checkoutBatch.title,
      qrImageUrl: qrUrl,
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      paymentLinkUrl: '',
      instructions: `Scan the QR code for ${checkoutBatch.title} to pay ${formatInr(
        checkoutBatch.priceUsd
      )} and enter your UTR / transaction ID below.`,
      createdBy: checkoutBatch.createdBy,
      createdAt: checkoutBatch.createdAt,
      updatedAt: checkoutBatch.updatedAt,
    };
  }, [checkoutBatch]);

  const checkoutPaymentOptions = useMemo(() => {
    if (courseSpecificPaymentOption) {
      return [courseSpecificPaymentOption, ...activePaymentMethods];
    }
    return activePaymentMethods;
  }, [courseSpecificPaymentOption, activePaymentMethods]);

  const selectedPaymentMethod = useMemo(
    () =>
      checkoutPaymentOptions.find((m) => m.id === selectedPaymentMethodId) ??
      checkoutPaymentOptions[0] ??
      null,
    [checkoutPaymentOptions, selectedPaymentMethodId]
  );

  const purchaseByBatchId = useMemo(() => {
    const map = new Map<string, BatchPurchase>();
    purchases.forEach((p) => {
      if (!userId || p.userId === userId) {
        map.set(p.batchId, p);
      }
    });
    return map;
  }, [purchases, userId]);

  const progressByBatchId = useMemo(() => {
    const map = new Map<string, BatchProgress>();
    batchProgressList.forEach((prog) => {
      if (!userId || prog.userId === userId) {
        map.set(prog.batchId, prog);
      }
    });
    return map;
  }, [batchProgressList, userId]);

  const checkoutPurchase = useMemo(
    () => (checkoutBatch ? purchaseByBatchId.get(checkoutBatch.id) ?? null : null),
    [checkoutBatch, purchaseByBatchId]
  );

  function openCheckoutModal(batch: Batch) {
    const existing = purchaseByBatchId.get(batch.id);
    setPurchaseError(null);
    setSubmittedReceipt(null);
    setPaymentReference(existing?.paymentReference ?? '');
    setPaymentScreenshotUrl(existing?.paymentScreenshotUrl ?? '');
    setSelectedPaymentMethodId(existing?.paymentMethodId ?? '');
    setCheckoutBatch(batch);
  }

  useEffect(() => {
    if (!checkoutBatch) {
      setSelectedPaymentMethodId('');
      setPaymentReference('');
      setPaymentScreenshotUrl('');
      setUploadingScreenshot(false);
      setCopiedField(null);
      setPurchaseError(null);
      setSubmittedReceipt(null);
      return;
    }
    if (
      checkoutPaymentOptions.length > 0 &&
      !checkoutPaymentOptions.some((m) => m.id === selectedPaymentMethodId)
    ) {
      setSelectedPaymentMethodId(checkoutPaymentOptions[0].id);
    }
  }, [checkoutBatch, checkoutPaymentOptions, selectedPaymentMethodId]);

  async function handleCopyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(() => {
        setCopiedField((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      // Clipboard unavailable
    }
  }

  const selectedBatch = useMemo(
    () => (selectedBatchId ? batches.find((b) => b.id === selectedBatchId) ?? null : null),
    [batches, selectedBatchId]
  );

  // Full lectures (with video IDs) for enrolled users/admins; syllabus previews (no video IDs) for public visitors
  const [lectures, setLectures] = useState<DisplayLecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [activeLectureId, setActiveLectureId] = useState<string | null>(null);
  const [isPlayerCardOpen, setIsPlayerCardOpen] = useState(false);
  const [playTrigger, setPlayTrigger] = useState(0);

  const activePurchasedBatchIds = useMemo(() => {
    const set = new Set<string>();
    purchaseByBatchId.forEach((p, batchId) => {
      if (p.status === 'active') set.add(batchId);
    });
    return set;
  }, [purchaseByBatchId]);

  const pendingPurchasedBatchIds = useMemo(() => {
    const set = new Set<string>();
    purchaseByBatchId.forEach((p, batchId) => {
      if (p.status === 'pending') set.add(batchId);
    });
    return set;
  }, [purchaseByBatchId]);

  // Overall study progress across all enrolled batches
  const overallProgress = useMemo(() => {
    if (!userId) return null;
    const enrolled = batches.filter(
      (b) => (b.isPublished || isAdmin) && activePurchasedBatchIds.has(b.id)
    );
    if (enrolled.length === 0) return null;

    let totalLectures = 0;
    let totalCompleted = 0;
    let latestBatch: Batch | null = null;
    let latestProgress: BatchProgress | null = null;
    let latestUpdatedMillis = -1;

    enrolled.forEach((b) => {
      const count = Math.max(0, b.lectureCount || 0);
      totalLectures += count;
      const prog = progressByBatchId.get(b.id);
      if (prog) {
        const completedInBatch =
          count > 0
            ? Math.min(count, prog.completedLectureIds.length)
            : prog.completedLectureIds.length;
        totalCompleted += completedInBatch;
        const ts = prog.updatedAt ? prog.updatedAt.toMillis() : 0;
        if (prog.lastLectureId && ts >= latestUpdatedMillis) {
          latestUpdatedMillis = ts;
          latestBatch = b;
          latestProgress = prog;
        }
      }
    });

    const pct =
      totalLectures > 0 ? Math.min(100, Math.round((totalCompleted / totalLectures) * 100)) : 0;

    return {
      enrolledCount: enrolled.length,
      totalLectures,
      totalCompleted,
      pct,
      latestBatch: latestBatch as Batch | null,
      latestProgress: latestProgress as BatchProgress | null,
    };
  }, [userId, batches, isAdmin, activePurchasedBatchIds, progressByBatchId]);

  const publishedLectureTotal = useMemo(
    () =>
      batches
        .filter((b) => b.isPublished || isAdmin)
        .reduce((sum, b) => sum + Math.max(0, b.lectureCount || 0), 0),
    [batches, isAdmin]
  );

  const effectiveFilter = userId ? catalogFilter : 'all';

  const visibleBatches = useMemo(() => {
    return batches.filter((b) => {
      if (!b.isPublished && !isAdmin) return false;
      const owned = activePurchasedBatchIds.has(b.id);
      if (effectiveFilter === 'purchased') return owned;
      if (effectiveFilter === 'available') return !owned;
      return true;
    });
  }, [batches, isAdmin, activePurchasedBatchIds, effectiveFilter]);

  const canAccessSelectedBatch = useMemo(() => {
    if (!selectedBatch || !userId) return false;
    return isAdmin || activePurchasedBatchIds.has(selectedBatch.id);
  }, [selectedBatch, userId, isAdmin, activePurchasedBatchIds]);

  const selectedBatchPurchase = useMemo(
    () => (selectedBatch ? purchaseByBatchId.get(selectedBatch.id) ?? null : null),
    [selectedBatch, purchaseByBatchId]
  );

  const selectedBatchProgress = useMemo(
    () => (selectedBatch ? progressByBatchId.get(selectedBatch.id) ?? null : null),
    [selectedBatch, progressByBatchId]
  );

  const completedLectureSet = useMemo(
    () => new Set(selectedBatchProgress?.completedLectureIds ?? []),
    [selectedBatchProgress]
  );

  // Signed-out users can only browse the batch/course catalog, never lectures inside
  useEffect(() => {
    if (!userId) {
      setSelectedBatchId(null);
      setIsPlayerCardOpen(false);
      setCheckoutBatch(null);
      setPlayTrigger(0);
    }
  }, [userId]);

  // If jumped to a batch from Session Logs
  useEffect(() => {
    if (!requestedOpenBatchId) return;
    setSelectedBatchId(requestedOpenBatchId);
    onClearRequestedOpenBatch?.();
  }, [requestedOpenBatchId, onClearRequestedOpenBatch]);

  // If a visitor clicked a batch to enroll before creating an account, open that course checkout right after sign-in
  useEffect(() => {
    if (!userId || !pendingEnrollBatchId || batches.length === 0) return;
    const targetBatch = batches.find((b) => b.id === pendingEnrollBatchId);
    onClearPendingEnroll?.();
    if (!targetBatch) return;

    if (isAdmin || activePurchasedBatchIds.has(targetBatch.id)) {
      setSelectedBatchId(targetBatch.id);
    } else {
      const existing = purchaseByBatchId.get(targetBatch.id);
      setPurchaseError(null);
      setSubmittedReceipt(null);
      setPaymentReference(existing?.paymentReference ?? '');
      setPaymentScreenshotUrl(existing?.paymentScreenshotUrl ?? '');
      setSelectedPaymentMethodId(existing?.paymentMethodId ?? '');
      setCheckoutBatch(targetBatch);
    }
  }, [userId, pendingEnrollBatchId, batches, isAdmin, activePurchasedBatchIds, purchaseByBatchId, onClearPendingEnroll]);

  useEffect(() => {
    if (userId && canAccessSelectedBatch) {
      void loadYouTubeIframeApi().catch(() => {});
    }
  }, [userId, canAccessSelectedBatch]);

  useEffect(() => {
    if (!selectedBatch || !userId) {
      setLectures([]);
      setModuleFilter('all');
      setActiveLectureId(null);
      setIsPlayerCardOpen(false);
      setPlayTrigger(0);
      return;
    }

    setLoadingLectures(true);
    setModuleFilter('all');
    const subcollection = canAccessSelectedBatch ? 'lectures' : 'syllabus';
    const path = `batches/${selectedBatch.id}/${subcollection}`;
    const q = query(collection(db, path), orderBy('orderIndex', 'asc'));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const items: DisplayLecture[] = snapshot.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<DisplayLecture, 'id'>),
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
  }, [selectedBatch, userId, canAccessSelectedBatch]);

  // If user clicked "Resume" from the catalog hero, open the player once lectures load
  useEffect(() => {
    if (!pendingResumeLectureId || loadingLectures || lectures.length === 0) return;
    const match = lectures.find((l) => l.id === pendingResumeLectureId);
    setPendingResumeLectureId(null);
    if (match && canAccessSelectedBatch && match.youtubeVideoId) {
      setActiveLectureId(match.id);
      setPlayTrigger((c) => c + 1);
      setIsPlayerCardOpen(true);
    }
  }, [pendingResumeLectureId, loadingLectures, lectures, canAccessSelectedBatch]);

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

  const batchCompletedCount = useMemo(
    () => lectures.filter((l) => completedLectureSet.has(l.id)).length,
    [lectures, completedLectureSet]
  );

  const batchProgressPct = useMemo(
    () =>
      lectures.length > 0
        ? Math.min(100, Math.round((batchCompletedCount / lectures.length) * 100))
        : 0,
    [batchCompletedCount, lectures.length]
  );

  const resumeLecture = useMemo(() => {
    if (lectures.length === 0) return null;
    if (selectedBatchProgress?.lastLectureId) {
      const last = lectures.find((l) => l.id === selectedBatchProgress.lastLectureId);
      if (last) return last;
    }
    const firstIncomplete = lectures.find((l) => !completedLectureSet.has(l.id));
    return firstIncomplete ?? lectures[0];
  }, [lectures, selectedBatchProgress, completedLectureSet]);

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

  function handleOpenLectureCard(lecture: DisplayLecture) {
    if (!canAccessSelectedBatch || !lecture.youtubeVideoId) {
      if (!userId) {
        onRequireSignIn();
        return;
      }
      if (selectedBatch) {
        openCheckoutModal(selectedBatch);
      }
      return;
    }
    setActiveLectureId(lecture.id);
    setPlayTrigger((c) => c + 1);
    setIsPlayerCardOpen(true);

    if (userId && selectedBatch) {
      void recordLectureOpened(
        userId,
        selectedBatch.id,
        lecture.id,
        lecture.title,
        selectedBatchProgress
      ).catch(() => {});
    }
  }

  async function handleToggleLectureComplete(lecture: DisplayLecture, forceState?: boolean) {
    if (!userId || !selectedBatch || !canAccessSelectedBatch) return;
    const currentlyCompleted = completedLectureSet.has(lecture.id);
    const nextCompleted = forceState !== undefined ? forceState : !currentlyCompleted;
    if (forceState !== undefined && currentlyCompleted === forceState) return;

    setTogglingLectureId(lecture.id);
    try {
      await toggleLectureCompleted(
        userId,
        selectedBatch.id,
        lecture.id,
        lecture.title,
        nextCompleted,
        selectedBatchProgress
      );
    } finally {
      setTogglingLectureId((prev) => (prev === lecture.id ? null : prev));
    }
  }

  async function handlePaymentScreenshotChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPurchaseError(null);
    setUploadingScreenshot(true);
    try {
      const dataUrl = await compressPaymentScreenshotDataUrl(file);
      setPaymentScreenshotUrl(dataUrl);
    } catch (err) {
      setPurchaseError(
        err instanceof Error ? err.message : 'Unable to process the selected payment screenshot.'
      );
    } finally {
      setUploadingScreenshot(false);
    }
  }

  async function handleConfirmPurchase() {
    if (!userId || !checkoutBatch) return;
    setPurchaseError(null);

    const trimmedRef = paymentReference.trim();
    if (checkoutBatch.priceUsd > 0) {
      if (trimmedRef.length < 4) {
        setPurchaseError('Please enter your UTR / Transaction Number (minimum 4 characters).');
        return;
      }
      if (paymentScreenshotUrl.length < 30) {
        setPurchaseError('Please upload a screenshot of your payment before confirming.');
        return;
      }
    }

    setPurchasing(true);
    try {
      const paymentDetails =
        checkoutBatch.priceUsd > 0
          ? {
              paymentMethodId: selectedPaymentMethod
                ? selectedPaymentMethod.id === '__course_qr__'
                  ? `course_qr_${checkoutBatch.id}`
                  : selectedPaymentMethod.id
                : 'direct_upi',
              paymentMethodLabel: selectedPaymentMethod
                ? selectedPaymentMethod.id === '__course_qr__'
                  ? `${checkoutBatch.title} QR`
                  : selectedPaymentMethod.label
                : 'Manual Payment Proof',
              paymentReference: trimmedRef,
              paymentScreenshotUrl,
            }
          : trimmedRef || paymentScreenshotUrl
          ? {
              paymentReference: trimmedRef,
              paymentScreenshotUrl,
            }
          : undefined;
      const outcome = await purchaseBatch(userId, checkoutBatch, paymentDetails);
      const enrolled = checkoutBatch;
      if (outcome === 'already_active') {
        setCheckoutBatch(null);
        setPaymentReference('');
        setPaymentScreenshotUrl('');
        setSubmittedReceipt(null);
        setSelectedBatchId(enrolled.id);
      } else {
        setSubmittedReceipt({
          batchTitle: enrolled.title,
          amountPaid: enrolled.priceUsd,
          utr: trimmedRef,
          screenshotUrl: paymentScreenshotUrl,
          updated: outcome === 'updated_pending',
        });
      }
    } catch (err) {
      setPurchaseError(
        err instanceof Error ? err.message : 'Unable to submit payment verification.'
      );
    } finally {
      setPurchasing(false);
    }
  }

  // Classroom & Private Curriculum View for a signed-in user opening a batch
  if (selectedBatch && userId) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setIsPlayerCardOpen(false);
              setSelectedBatchId(null);
              setPlayTrigger(0);
            }}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-[#0B1120] transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Lecture Batches</span>
          </button>

          {canAccessSelectedBatch ? (
            <div className="inline-flex items-center gap-2 text-xs text-emerald-700 font-semibold whitespace-nowrap shrink-0">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAdmin && !activePurchasedBatchIds.has(selectedBatch.id)
                  ? 'Admin Preview Access'
                  : 'Enrolled Batch Access'}
              </span>
            </div>
          ) : selectedBatchPurchase?.status === 'pending' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 font-semibold whitespace-nowrap shrink-0">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                <span>Thank you! Your payment will be approved soon.</span>
              </span>
              <button
                type="button"
                onClick={() => openCheckoutModal(selectedBatch)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>View / Update Proof</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 font-medium whitespace-nowrap shrink-0">
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                <span>
                  {selectedBatchPurchase?.status === 'revoked'
                    ? 'Access Revoked · Contact Admin'
                    : 'Private Lectures · Enrollment Required'}
                </span>
              </span>
              {selectedBatchPurchase?.status !== 'revoked' && (
                <button
                  type="button"
                  onClick={() => openCheckoutModal(selectedBatch)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Purchase Batch · {formatInr(selectedBatch.priceUsd)}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Batch Editorial Classroom Header + Study Progress Meter */}
        <div className="bg-[#0B1120] text-white rounded-2xl border border-slate-800 p-6 sm:p-8 relative overflow-hidden">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-indigo-600/20 blur-3xl"
          />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-xs text-slate-300 font-medium">
                <span>{selectedBatch.subjectTag}</span>
                <span aria-hidden="true" className="mx-2 text-slate-500">·</span>
                <span>{selectedBatch.instructor}</span>
                <span aria-hidden="true" className="mx-2 text-slate-500">·</span>
                <span className="font-mono tabular-nums">
                  {lectures.length} {lectures.length === 1 ? 'lecture' : 'lectures'}
                </span>
                {totalDurationMinutes > 0 && (
                  <>
                    <span aria-hidden="true" className="mx-2 text-slate-500">·</span>
                    <span className="font-mono tabular-nums">{totalDurationMinutes} min total</span>
                  </>
                )}
              </p>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white mt-2 text-balance">
                {selectedBatch.title}
              </h1>
              {selectedBatch.description && (
                <p className="mt-2.5 text-sm text-slate-300 leading-relaxed">
                  {selectedBatch.description}
                </p>
              )}
            </div>

            {canAccessSelectedBatch && lectures.length > 0 && (
              <div className="w-full lg:w-80 bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 shrink-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Batch Study Progress</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-400">
                    {batchProgressPct}%
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-[width] duration-300"
                    style={{ width: `${batchProgressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span className="font-mono tabular-nums">
                    {batchCompletedCount} / {lectures.length} completed
                  </span>
                  {resumeLecture && (
                    <button
                      type="button"
                      onClick={() => handleOpenLectureCard(resumeLecture)}
                      className="inline-flex items-center gap-1 text-indigo-300 hover:text-white font-semibold transition-colors whitespace-nowrap"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>
                        {selectedBatchProgress?.lastLectureId ? 'Resume Lecture' : 'Start Course'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {moduleNames.length > 1 && (
          <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200/80 rounded-xl max-w-full overflow-x-auto">
            <button
              type="button"
              onClick={() => setModuleFilter('all')}
              className={`px-3.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                moduleFilter === 'all'
                  ? 'bg-[#0B1120] text-white'
                  : 'text-slate-600 hover:text-[#0B1120]'
              }`}
            >
              All Modules
            </button>
            {moduleNames.map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => setModuleFilter(mod)}
                className={`px-3.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  moduleFilter === mod
                    ? 'bg-[#0B1120] text-white'
                    : 'text-slate-600 hover:text-[#0B1120]'
                }`}
              >
                {mod}
              </button>
            ))}
          </div>
        )}

        {loadingLectures ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse"
              />
            ))}
          </div>
        ) : lectures.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
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
              const isCompleted = completedLectureSet.has(lec.id);
              const isLastWatched = selectedBatchProgress?.lastLectureId === lec.id;

              return (
                <article
                  key={lec.id}
                  className={`group bg-white border rounded-2xl overflow-hidden flex flex-col justify-between transition-all shadow-[0_1px_2px_rgba(11,17,32,0.04)] ${
                    isSelected
                      ? 'border-indigo-600 ring-1 ring-indigo-600/20'
                      : isCompleted
                      ? 'border-emerald-200 hover:border-emerald-300'
                      : 'border-slate-200/90 hover:border-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleOpenLectureCard(lec)}
                    className="text-left w-full flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                  >
                    <div className="relative aspect-video w-full bg-slate-950 overflow-hidden border-b border-slate-100">
                      <LectureThumbnail
                        src={lec.thumbnailUrl || selectedBatch.coverImage}
                        title={lec.title}
                      />
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent opacity-85 group-hover:opacity-95 transition-opacity"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        {canAccessSelectedBatch ? (
                          <span className="w-12 h-12 rounded-full bg-[#0B1120]/80 group-hover:bg-indigo-600 text-white flex items-center justify-center transition-colors">
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        ) : (
                          <span className="w-12 h-12 rounded-full bg-[#0B1120]/80 group-hover:bg-indigo-600 text-white flex items-center justify-center transition-colors">
                            <Lock className="w-5 h-5" />
                          </span>
                        )}
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
                        {isLastWatched && !isCompleted && (
                          <>
                            <span aria-hidden="true" className="mx-1.5">·</span>
                            <span className="font-semibold text-indigo-700">Last watched</span>
                          </>
                        )}
                      </p>

                      <h2 className="mt-1.5 text-base font-bold text-[#0B1120] group-hover:text-indigo-700 leading-snug transition-colors line-clamp-2">
                        {lec.title}
                      </h2>

                      {lec.summary && (
                        <p className="mt-2 text-sm text-slate-600 line-clamp-2 leading-relaxed">
                          {lec.summary}
                        </p>
                      )}
                    </div>
                  </button>

                  <div className="w-full px-5 pb-5 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 text-xs">
                    {canAccessSelectedBatch ? (
                      <>
                        <button
                          type="button"
                          disabled={togglingLectureId === lec.id}
                          onClick={() => void handleToggleLectureComplete(lec)}
                          className={`inline-flex items-center gap-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                            isCompleted
                              ? 'text-emerald-700 hover:text-emerald-800'
                              : 'text-slate-500 hover:text-[#0B1120]'
                          }`}
                        >
                          {isCompleted ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Circle className="w-4 h-4" />
                          )}
                          <span>{isCompleted ? 'Completed' : 'Mark Complete'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenLectureCard(lec)}
                          className="inline-flex items-center gap-1.5 font-semibold text-[#0B1120] hover:text-indigo-700 transition-colors whitespace-nowrap shrink-0"
                        >
                          <PlayCircle className="w-4 h-4" />
                          <span>{isCompleted ? 'Rewatch' : 'Watch Lecture'}</span>
                        </button>
                      </>
                    ) : selectedBatchPurchase?.status === 'pending' ? (
                      <>
                        <span className="text-slate-500 truncate">
                          {selectedBatch.instructor}
                        </span>
                        <button
                          type="button"
                          onClick={() => openCheckoutModal(selectedBatch)}
                          className="inline-flex items-center gap-1.5 font-semibold text-amber-700 hover:text-amber-800 whitespace-nowrap shrink-0"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Awaiting Approval</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-slate-500 truncate">
                          {selectedBatch.instructor}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleOpenLectureCard(lec)}
                          className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-indigo-700 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>{userId ? 'Enroll to Watch' : 'Private · Sign in'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Lecture Player Card Modal */}
        {isPlayerCardOpen && canAccessSelectedBatch && activeLecture && activeLecture.youtubeVideoId && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="lecture-player-card-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setIsPlayerCardOpen(false);
              }
            }}
            className="fixed inset-0 z-50 bg-[#0B1120]/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-6 overflow-y-auto"
          >
            <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[94dvh] flex flex-col overflow-hidden shadow-2xl my-auto">
              <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
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
                    className="text-base sm:text-lg font-bold text-[#0B1120] mt-0.5 truncate"
                  >
                    {activeLecture.title}
                  </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={togglingLectureId === activeLecture.id}
                    onClick={() => void handleToggleLectureComplete(activeLecture)}
                    className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-50 ${
                      completedLectureSet.has(activeLecture.id)
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
                    }`}
                  >
                    {completedLectureSet.has(activeLecture.id) ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Completed</span>
                      </>
                    ) : (
                      <>
                        <Circle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Mark Completed</span>
                        <span className="sm:hidden">Complete</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    aria-label="Close lecture card"
                    onClick={() => setIsPlayerCardOpen(false)}
                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1">
                <div className="w-full bg-slate-950">
                  <div className="w-full max-w-[calc(70dvh*16/9)] mx-auto">
                    <CadenceVideoPlayer
                      key={activeLecture.id}
                      videoId={activeLecture.youtubeVideoId}
                      title={activeLecture.title}
                      subtitle={`${activeLecture.moduleName} · Lesson ${activeLectureIndex + 1}`}
                      posterImage={activeLecture.thumbnailUrl || selectedBatch.coverImage}
                      playTrigger={playTrigger}
                      hasNextLecture={Boolean(nextLecture)}
                      onEnded={() => {
                        void handleToggleLectureComplete(activeLecture, true);
                      }}
                      onNextLecture={() => {
                        if (nextLecture) {
                          setActiveLectureId(nextLecture.id);
                          setPlayTrigger((c) => c + 1);
                          void recordLectureOpened(
                            userId,
                            selectedBatch.id,
                            nextLecture.id,
                            nextLecture.title,
                            selectedBatchProgress
                          ).catch(() => {});
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="p-4 sm:p-5 bg-white border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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

                  <div className="flex items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!previousLecture}
                      onClick={() => {
                        if (previousLecture) {
                          setActiveLectureId(previousLecture.id);
                          setPlayTrigger((c) => c + 1);
                          void recordLectureOpened(
                            userId,
                            selectedBatch.id,
                            previousLecture.id,
                            previousLecture.title,
                            selectedBatchProgress
                          ).catch(() => {});
                        }
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
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
                          void recordLectureOpened(
                            userId,
                            selectedBatch.id,
                            nextLecture.id,
                            nextLecture.title,
                            selectedBatchProgress
                          ).catch(() => {});
                        }
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1120] hover:bg-indigo-700 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>Next Lecture</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
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
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Deep Ink Editorial Hero & Study Progress Showcase */}
      <div className="bg-[#0B1120] text-white rounded-2xl border border-slate-800 p-6 sm:p-8 lg:p-10 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-indigo-600/20 blur-3xl"
        />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              Cadence Study · Structured Cohorts
            </p>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white mt-2 text-balance">
              Academic Lecture Batches
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              {userId
                ? 'Master subjects step by step with distraction-free cohort lectures and live completion tracking.'
                : 'Explore structured academic batches led by specialist instructors. Sign in to enroll and unlock lectures.'}
            </p>
            {!userId && (
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onRequireSignIn()}
                  className="min-h-[42px] px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  Sign in to Enroll
                </button>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {batches.filter((b) => b.isPublished).length} cohorts · {publishedLectureTotal} lectures
                </span>
              </div>
            )}
          </div>

          {userId && overallProgress ? (
            <div className="w-full lg:w-[360px] bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">
                  Batch Study Progress
                </span>
                <span className="text-sm font-bold font-mono tabular-nums text-emerald-400">
                  {overallProgress.pct}%
                </span>
              </div>

              <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-[width] duration-300"
                  style={{ width: `${overallProgress.pct}%` }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">Enrolled Cohorts</p>
                  <p className="mt-0.5 text-base font-bold font-mono tabular-nums text-white">
                    {overallProgress.enrolledCount}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Lectures Completed</p>
                  <p className="mt-0.5 text-base font-bold font-mono tabular-nums text-white">
                    {overallProgress.totalCompleted} / {overallProgress.totalLectures}
                  </p>
                </div>
              </div>

              {overallProgress.latestBatch && overallProgress.latestProgress?.lastLectureId && (
                <button
                  type="button"
                  onClick={() => {
                    if (!overallProgress.latestBatch || !overallProgress.latestProgress) return;
                    setPendingResumeLectureId(overallProgress.latestProgress.lastLectureId);
                    setSelectedBatchId(overallProgress.latestBatch.id);
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  <span className="truncate">
                    Continue: {overallProgress.latestProgress.lastLectureTitle}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
            </div>
          ) : userId ? (
            <div className="w-full lg:w-72 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-2 shrink-0">
              <p className="text-xs font-semibold text-slate-200">Study Readiness</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-white">
                {visibleBatches.length} {visibleBatches.length === 1 ? 'Cohort' : 'Cohorts'}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Enroll in a batch to track lecture completion and resume right where you left off.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Filter Bar */}
      {userId && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200/90 rounded-xl max-w-full overflow-x-auto">
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
                className={`px-3.5 py-1.5 min-h-[34px] text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  effectiveFilter === tab.id
                    ? 'bg-[#0B1120] text-white'
                    : 'text-slate-600 hover:text-[#0B1120]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="text-xs font-mono tabular-nums text-slate-500">
            Showing {visibleBatches.length} {visibleBatches.length === 1 ? 'batch' : 'batches'}
          </p>
        </div>
      )}

      {loadingBatches ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-96 bg-white border border-slate-200 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      ) : visibleBatches.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
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
            const batchPurchase = purchaseByBatchId.get(batch.id) ?? null;
            const isOwned = activePurchasedBatchIds.has(batch.id);
            const isPending = pendingPurchasedBatchIds.has(batch.id);
            const isRevoked = batchPurchase?.status === 'revoked';
            const canOpen = userId !== null && (isOwned || isAdmin);
            const batchProgress = progressByBatchId.get(batch.id) ?? null;
            const totalLec = Math.max(0, batch.lectureCount || 0);
            const completedLec = batchProgress
              ? totalLec > 0
                ? Math.min(totalLec, batchProgress.completedLectureIds.length)
                : batchProgress.completedLectureIds.length
              : 0;
            const progressPct =
              totalLec > 0 ? Math.min(100, Math.round((completedLec / totalLec) * 100)) : 0;

            const handleDirectEnroll = () => {
              if (!userId) {
                onRequireSignIn(batch.id);
                return;
              }
              openCheckoutModal(batch);
            };

            return (
              <article
                key={batch.id}
                className="group bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl overflow-hidden flex flex-col justify-between transition-all shadow-[0_1px_2px_rgba(11,17,32,0.04)] hover:shadow-[0_6px_18px_rgba(11,17,32,0.06)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (!userId) {
                      onRequireSignIn(batch.id);
                      return;
                    }
                    setSelectedBatchId(batch.id);
                  }}
                  className="text-left w-full flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600"
                >
                  <div className="aspect-video w-full bg-slate-100 overflow-hidden border-b border-slate-100">
                    <BatchCover src={batch.coverImage} title={batch.title} />
                  </div>

                  <div className="p-6">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">
                        {batch.subjectTag} · {batch.instructor}
                      </span>
                      <span className="font-mono tabular-nums shrink-0">
                        {batch.lectureCount} {batch.lectureCount === 1 ? 'lecture' : 'lectures'}
                      </span>
                    </div>

                    <h2 className="mt-2 text-lg font-bold text-[#0B1120] group-hover:text-indigo-700 leading-snug transition-colors">
                      {batch.title}
                    </h2>

                    <p className="mt-2 text-sm text-slate-600 line-clamp-3 leading-relaxed">
                      {batch.description}
                    </p>

                    {canOpen && (
                      <div className="mt-4 pt-3.5 border-t border-slate-100 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-600">Study Progress</span>
                          <span className="font-mono tabular-nums font-semibold text-[#0B1120]">
                            {completedLec}/{totalLec} · {progressPct}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${
                              progressPct === 100 ? 'bg-emerald-600' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        {batchProgress?.lastLectureTitle && (
                          <p className="text-[11px] text-slate-500 truncate">
                            Last watched: {batchProgress.lastLectureTitle}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <div className="px-6 pb-6 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    {isOwned ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Enrolled</span>
                      </span>
                    ) : isAdmin ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <ShieldCheck className="w-4 h-4 text-indigo-600" />
                        <span>Admin Access</span>
                      </span>
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Pending Approval</span>
                      </span>
                    ) : isRevoked ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Access Revoked</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono tabular-nums font-bold text-[#0B1120]">
                          {formatInr(batch.priceUsd)}
                        </span>
                        <span>
                          · {userId ? 'Private lectures' : 'Sign in to view'}
                        </span>
                      </span>
                    )}
                  </div>

                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => setSelectedBatchId(batch.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1120] hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>{completedLec > 0 ? 'Continue' : 'Open Lectures'}</span>
                    </button>
                  ) : isPending ? (
                    <button
                      type="button"
                      onClick={handleDirectEnroll}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Awaiting Approval</span>
                    </button>
                  ) : isRevoked ? (
                    <span className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0">
                      Contact Admin
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDirectEnroll}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>{userId ? 'Purchase Batch' : 'Sign in to View'}</span>
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
          className="fixed inset-0 z-50 bg-[#0B1120]/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full max-h-[92dvh] overflow-y-auto my-auto p-5 sm:p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs font-medium text-slate-500">Batch Enrollment</p>
                <h2 id="checkout-title" className="text-lg font-bold text-[#0B1120] mt-0.5">
                  {checkoutBatch.title}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close enrollment checkout"
                onClick={() => setCheckoutBatch(null)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {submittedReceipt ? (
              <div className="py-6 space-y-5 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-lg font-bold text-[#0B1120]">
                    Thank you! Your payment will be approved soon.
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-sm mx-auto">
                    {submittedReceipt.updated
                      ? 'Your updated UTR number and payment screenshot have been received. Lectures unlock automatically once an admin verifies your payment.'
                      : 'We have received your payment details for verification. Lectures will unlock automatically as soon as an admin approves your enrollment.'}
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Batch</span>
                    <span className="font-semibold text-[#0B1120] text-right">
                      {submittedReceipt.batchTitle}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Tuition</span>
                    <span className="font-mono tabular-nums font-semibold text-[#0B1120]">
                      {formatInr(submittedReceipt.amountPaid)}
                    </span>
                  </div>
                  {submittedReceipt.utr && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">UTR / Ref No.</span>
                      <span className="font-mono font-semibold text-[#0B1120]">
                        {submittedReceipt.utr}
                      </span>
                    </div>
                  )}
                  {submittedReceipt.screenshotUrl && (
                    <div className="pt-2 border-t border-slate-200/80">
                      <img
                        src={submittedReceipt.screenshotUrl}
                        alt="Submitted payment screenshot"
                        className="w-full max-h-40 object-contain rounded-lg border border-slate-200 bg-white"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSubmittedReceipt(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Edit Proof
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheckoutBatch(null)}
                    className="px-5 py-2 text-xs font-semibold text-white bg-[#0B1120] hover:bg-indigo-700 rounded-lg"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="py-5 space-y-4 text-sm text-slate-600">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span>Instructor</span>
                      <span className="font-semibold text-[#0B1120]">
                        {checkoutBatch.instructor}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Unlisted Lectures</span>
                      <span className="font-mono tabular-nums font-semibold text-[#0B1120]">
                        {checkoutBatch.lectureCount} videos
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <span className="font-semibold text-[#0B1120]">Batch Tuition</span>
                      <span className="text-lg font-bold font-mono tabular-nums text-[#0B1120]">
                        {formatInr(checkoutBatch.priceUsd)}
                      </span>
                    </div>
                    {userId && (
                      <div className="flex items-center justify-between gap-2 pt-2 text-xs">
                        <span className="text-slate-500">Student User UID</span>
                        <button
                          type="button"
                          onClick={() => void handleCopyValue('uid', userId)}
                          className="inline-flex items-center gap-1.5 font-mono text-slate-800 hover:text-indigo-700 max-w-[220px]"
                          title="Copy your Student User UID"
                        >
                          <span className="truncate">{userId}</span>
                          {copiedField === 'uid' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {checkoutBatch.priceUsd > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-3">
                      {checkoutPaymentOptions.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-[#0B1120]">
                            {checkoutPaymentOptions.length > 1
                              ? 'Select Payment Method'
                              : selectedPaymentMethod?.id === '__course_qr__'
                              ? `Scan QR to Pay for ${checkoutBatch.title}`
                              : 'Payment Details'}
                          </p>
                          {checkoutPaymentOptions.length > 1 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {checkoutPaymentOptions.map((method) => {
                                const active = selectedPaymentMethod?.id === method.id;
                                return (
                                  <button
                                    key={method.id}
                                    type="button"
                                    onClick={() => setSelectedPaymentMethodId(method.id)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs font-semibold transition-colors ${
                                      active
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-950'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {method.type === 'upi' ? (
                                      <QrCode className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                                    ) : method.type === 'bank' ? (
                                      <Building2 className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                                    ) : method.type === 'gateway' ? (
                                      <Globe className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                                    ) : (
                                      <Banknote className="w-3.5 h-3.5 shrink-0 text-indigo-600" />
                                    )}
                                    <span className="truncate">{method.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {selectedPaymentMethod && (
                            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5 text-xs">
                              {selectedPaymentMethod.payeeName && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-500">Payee</span>
                                  <span className="font-semibold text-[#0B1120]">
                                    {selectedPaymentMethod.payeeName}
                                  </span>
                                </div>
                              )}

                              {selectedPaymentMethod.type === 'upi' && (
                                <>
                                  {selectedPaymentMethod.upiId && (
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-slate-500">UPI ID</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleCopyValue('upi', selectedPaymentMethod.upiId)
                                        }
                                        className="inline-flex items-center gap-1.5 font-mono text-[#0B1120] hover:text-indigo-700"
                                      >
                                        <span>{selectedPaymentMethod.upiId}</span>
                                        {copiedField === 'upi' ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                                        )}
                                      </button>
                                    </div>
                                  )}
                                  {selectedPaymentMethod.qrImageUrl && (
                                    <div className="pt-1 flex justify-center">
                                      <img
                                        src={selectedPaymentMethod.qrImageUrl}
                                        alt={`${selectedPaymentMethod.label} QR code`}
                                        className="w-40 h-40 object-contain bg-white border border-slate-200 rounded-lg p-1.5"
                                      />
                                    </div>
                                  )}
                                </>
                              )}

                              {selectedPaymentMethod.type === 'bank' && (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">Bank</span>
                                    <span className="font-semibold text-[#0B1120]">
                                      {selectedPaymentMethod.bankName}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">Account No.</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleCopyValue(
                                          'acc',
                                          selectedPaymentMethod.accountNumber
                                        )
                                      }
                                      className="inline-flex items-center gap-1.5 font-mono text-[#0B1120] hover:text-indigo-700"
                                    >
                                      <span>{selectedPaymentMethod.accountNumber}</span>
                                      {copiedField === 'acc' ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                                      )}
                                    </button>
                                  </div>
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-slate-500">IFSC</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleCopyValue('ifsc', selectedPaymentMethod.ifscCode)
                                      }
                                      className="inline-flex items-center gap-1.5 font-mono text-[#0B1120] hover:text-indigo-700"
                                    >
                                      <span>{selectedPaymentMethod.ifscCode}</span>
                                      {copiedField === 'ifsc' ? (
                                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                                      ) : (
                                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {selectedPaymentMethod.type === 'gateway' &&
                                selectedPaymentMethod.paymentLinkUrl && (
                                  <a
                                    href={selectedPaymentMethod.paymentLinkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-indigo-400 hover:text-indigo-700 rounded-md font-semibold text-[#0B1120] transition-colors"
                                  >
                                    <span>Open Payment Page</span>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}

                              {selectedPaymentMethod.instructions && (
                                <p className="text-[11px] text-slate-600 leading-relaxed pt-1 border-t border-slate-200/70">
                                  {selectedPaymentMethod.instructions}
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {checkoutPurchase?.status === 'pending' && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs text-amber-950">
                          <p className="font-semibold flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                            <span>Thank you! Your payment will be approved soon.</span>
                          </p>
                          <p className="text-[11px] text-amber-900 leading-relaxed">
                            Your UTR number and payment screenshot are with the administrator. You can update them below if needed.
                          </p>
                        </div>
                      )}

                      <div>
                        <label
                          htmlFor="checkout-payment-ref"
                          className="block text-[11px] font-semibold text-slate-700 mb-1"
                        >
                          UTR / Transaction Number <span className="text-rose-600">*</span>
                        </label>
                        <input
                          id="checkout-payment-ref"
                          type="text"
                          required
                          minLength={4}
                          maxLength={VALIDATION_LIMITS.paymentReferenceMax}
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(e.target.value)}
                          placeholder="Enter 12-digit UTR / Transaction ID"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-base sm:text-xs font-mono text-[#0B1120] focus:outline-2 focus:outline-indigo-600"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="block text-[11px] font-semibold text-slate-700">
                            Payment Screenshot <span className="text-rose-600">*</span>
                          </span>
                          {paymentScreenshotUrl && (
                            <button
                              type="button"
                              onClick={() => setPaymentScreenshotUrl('')}
                              className="text-[11px] text-rose-700 hover:underline"
                            >
                              Remove screenshot
                            </button>
                          )}
                        </div>

                        {paymentScreenshotUrl ? (
                          <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                            <img
                              src={paymentScreenshotUrl}
                              alt="Uploaded payment screenshot preview"
                              className="w-full max-h-48 object-contain rounded-lg border border-slate-200 bg-white"
                            />
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Screenshot attached</span>
                              </span>
                              <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-semibold rounded cursor-pointer">
                                <Upload className="w-3 h-3" />
                                <span>{uploadingScreenshot ? 'Processing...' : 'Replace'}</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  disabled={uploadingScreenshot}
                                  onChange={(e) => void handlePaymentScreenshotChange(e)}
                                />
                              </label>
                            </div>
                          </div>
                        ) : (
                          <label className="flex flex-col items-center justify-center gap-1.5 px-4 py-4 border border-dashed border-slate-300 hover:border-indigo-500 bg-slate-50/70 hover:bg-indigo-50/40 rounded-xl cursor-pointer transition-colors text-center">
                            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-indigo-600">
                              {uploadingScreenshot ? (
                                <Clock className="w-4 h-4 animate-pulse" />
                              ) : (
                                <ImageIcon className="w-4 h-4" />
                              )}
                            </div>
                            <span className="text-xs font-semibold text-slate-800">
                              {uploadingScreenshot
                                ? 'Compressing screenshot...'
                                : 'Upload Payment Screenshot'}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              PNG, JPG, or WebP showing amount & UTR number
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              disabled={uploadingScreenshot}
                              onChange={(e) => void handlePaymentScreenshotChange(e)}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {checkoutBatch.priceUsd === 0 && checkoutPurchase?.status === 'pending' && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-xs text-amber-950">
                      <p className="font-semibold flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span>Thank you! Your enrollment will be approved soon.</span>
                      </p>
                      <p className="text-[11px] text-amber-900 leading-relaxed">
                        Your request has been sent to the administrator for approval.
                      </p>
                    </div>
                  )}

                  <p className="text-xs text-slate-500 pt-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      Lectures unlock automatically as soon as an admin verifies your UTR & screenshot and approves access.
                    </span>
                  </p>
                  {purchaseError && (
                    <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                      {purchaseError}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setCheckoutBatch(null)}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    {checkoutPurchase?.status === 'pending' ? 'Close' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    disabled={purchasing || uploadingScreenshot}
                    onClick={() => void handleConfirmPurchase()}
                    className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                  >
                    {purchasing
                      ? 'Submitting...'
                      : checkoutPurchase?.status === 'pending'
                      ? 'Update Payment Proof'
                      : `Confirm Payment · ${formatInr(checkoutBatch.priceUsd)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
