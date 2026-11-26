import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Banknote,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
import { purchaseBatch } from '@/src/lib/studyService';
import { compressPaymentScreenshotDataUrl, formatInr, resolveAssetUrl } from '@/src/lib/utils';
import { loadYouTubeIframeApi } from '@/src/lib/youtubeApi';
import {
  Batch,
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
  batches: Batch[];
  purchases: BatchPurchase[];
  paymentMethods: PaymentMethod[];
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
  pendingEnrollBatchId,
  onClearPendingEnroll,
  batches,
  purchases,
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
  const [purchaseSuccess, setPurchaseSuccess] = useState<string | null>(null);

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

  const checkoutPurchase = useMemo(
    () => (checkoutBatch ? purchaseByBatchId.get(checkoutBatch.id) ?? null : null),
    [checkoutBatch, purchaseByBatchId]
  );

  function openCheckoutModal(batch: Batch) {
    const existing = purchaseByBatchId.get(batch.id);
    setPurchaseError(null);
    setPurchaseSuccess(null);
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
      setPurchaseSuccess(null);
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

  // Signed-out users can only browse the batch/course catalog, never lectures inside
  useEffect(() => {
    if (!userId) {
      setSelectedBatchId(null);
      setIsPlayerCardOpen(false);
      setCheckoutBatch(null);
      setPlayTrigger(0);
    }
  }, [userId]);

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
      setPurchaseSuccess(null);
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
    setPurchaseSuccess(null);

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
        setSelectedBatchId(enrolled.id);
      } else if (outcome === 'updated_pending') {
        setPurchaseSuccess(
          'Updated your UTR number and payment screenshot. Waiting for administrator verification and approval.'
        );
      } else {
        setPurchaseSuccess(
          'Payment proof submitted! An administrator will verify your UTR and payment screenshot, then approve your access to the lectures.'
        );
      }
    } catch (err) {
      setPurchaseError(
        err instanceof Error ? err.message : 'Unable to submit payment verification.'
      );
    } finally {
      setPurchasing(false);
    }
  }

  // Classroom & Private Curriculum View for a signed-in user opening a batch — displays subject lectures as clickable cards
  if (selectedBatch && userId) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setIsPlayerCardOpen(false);
              setSelectedBatchId(null);
              setPlayTrigger(0);
            }}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Lecture Batches</span>
          </button>

          {canAccessSelectedBatch ? (
            <div className="flex items-center gap-2 text-xs text-emerald-700 font-medium whitespace-nowrap shrink-0">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isAdmin && !activePurchasedBatchIds.has(selectedBatch.id)
                  ? 'Admin Preview Access'
                  : 'Enrolled Batch Access'}
              </span>
            </div>
          ) : selectedBatchPurchase?.status === 'pending' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-medium whitespace-nowrap shrink-0">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                <span>Payment Submitted · Awaiting Admin Approval</span>
              </span>
              <button
                type="button"
                onClick={() => openCheckoutModal(selectedBatch)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>View / Update Payment Proof</span>
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
                  onClick={() => {
                    if (!userId) {
                      onRequireSignIn();
                      return;
                    }
                    openCheckoutModal(selectedBatch);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>
                    {userId
                      ? `Purchase Batch · ${formatInr(selectedBatch.priceUsd)}`
                      : `Sign in to Enroll · ${formatInr(selectedBatch.priceUsd)}`}
                  </span>
                </button>
              )}
            </div>
          )}
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
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setModuleFilter('all')}
                className={`px-3 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
                  className={`px-3 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
                  onClick={() => handleOpenLectureCard(lec)}
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
                        className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent opacity-85 group-hover:opacity-95 transition-opacity"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        {canAccessSelectedBatch ? (
                          <span className="w-12 h-12 rounded-full bg-slate-950/75 group-hover:bg-blue-600 text-white flex items-center justify-center transition-colors">
                            <Play className="w-5 h-5 fill-current ml-0.5" />
                          </span>
                        ) : (
                          <span className="w-12 h-12 rounded-full bg-slate-950/80 group-hover:bg-blue-600 text-white flex items-center justify-center transition-colors">
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
                    {canAccessSelectedBatch ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 group-hover:text-blue-700 transition-colors whitespace-nowrap shrink-0">
                        <PlayCircle className="w-4 h-4" />
                        <span>Watch Lecture</span>
                      </span>
                    ) : selectedBatchPurchase?.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 whitespace-nowrap shrink-0">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Awaiting Approval</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 group-hover:text-blue-700 transition-colors whitespace-nowrap shrink-0">
                        <Lock className="w-3.5 h-3.5" />
                        <span>{userId ? 'Enroll to Watch' : 'Private · Sign in'}</span>
                      </span>
                    )}
                  </div>
                </button>
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
            className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-2 sm:p-6 overflow-y-auto"
          >
            <div className="bg-white border border-slate-200 rounded-xl max-w-4xl w-full max-h-[94dvh] flex flex-col overflow-hidden shadow-2xl my-auto">
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
                    className="text-base sm:text-lg font-bold text-slate-900 mt-0.5 truncate"
                  >
                    {activeLecture.title}
                  </h2>
                </div>

                <button
                  type="button"
                  aria-label="Close lecture card"
                  onClick={() => setIsPlayerCardOpen(false)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
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
                      onNextLecture={() => {
                        if (nextLecture) {
                          setActiveLectureId(nextLecture.id);
                          setPlayTrigger((c) => c + 1);
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
                        }
                      }}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
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
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none rounded-lg transition-colors whitespace-nowrap shrink-0"
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
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Academic Lecture Batches
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            {userId
              ? 'Enroll in structured subject cohorts. Unlisted lecture videos are strictly restricted to students with an active batch purchase.'
              : 'Browse all available courses and batches below. Sign in to view lectures inside a batch and enroll.'}
          </p>
        </div>

        {userId ? (
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start max-w-full overflow-x-auto">
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
                className={`px-3 py-1.5 min-h-[34px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  effectiveFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onRequireSignIn()}
            className="min-h-[40px] px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
          >
            Sign in to Enroll
          </button>
        )}
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
            const batchPurchase = purchaseByBatchId.get(batch.id) ?? null;
            const isOwned = activePurchasedBatchIds.has(batch.id);
            const isPending = pendingPurchasedBatchIds.has(batch.id);
            const isRevoked = batchPurchase?.status === 'revoked';
            const canOpen = userId !== null && (isOwned || isAdmin);

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
                className="group bg-white border border-slate-200 hover:border-slate-300 rounded-xl overflow-hidden flex flex-col justify-between transition-colors"
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
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Pending Verification</span>
                      </span>
                    ) : isRevoked ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Access Revoked</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        <Lock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono tabular-nums font-semibold text-slate-900">
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
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>Open Lectures</span>
                    </button>
                  ) : isPending ? (
                    <button
                      type="button"
                      onClick={handleDirectEnroll}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Awaiting Approval</span>
                    </button>
                  ) : isRevoked ? (
                    <span className="px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium rounded-lg whitespace-nowrap shrink-0">
                      Contact Admin
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDirectEnroll}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
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
          className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full max-h-[92dvh] overflow-y-auto my-auto p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-500">Batch Enrollment</p>
                <h2 id="checkout-title" className="text-lg font-bold text-slate-900 mt-0.5">
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

            <div className="py-5 space-y-4 text-sm text-slate-600">
              <div className="space-y-2.5">
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
                    {formatInr(checkoutBatch.priceUsd)}
                  </span>
                </div>
                {userId && (
                  <div className="flex items-center justify-between gap-2 pt-2 text-xs">
                    <span className="text-slate-500">Student User UID</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyValue('uid', userId)}
                      className="inline-flex items-center gap-1.5 font-mono text-slate-800 hover:text-blue-700 max-w-[220px]"
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
                      <p className="text-xs font-semibold text-slate-900">
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
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs font-medium transition-colors ${
                                  active
                                    ? 'border-blue-600 bg-blue-50 text-blue-900'
                                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {method.type === 'upi' ? (
                                  <QrCode className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                ) : method.type === 'bank' ? (
                                  <Building2 className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                ) : method.type === 'gateway' ? (
                                  <Globe className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                ) : (
                                  <Banknote className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                                )}
                                <span className="truncate">{method.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {selectedPaymentMethod && (
                        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5 text-xs">
                          {selectedPaymentMethod.payeeName && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500">Payee</span>
                              <span className="font-medium text-slate-900">
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
                                    className="inline-flex items-center gap-1.5 font-mono text-slate-900 hover:text-blue-700"
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
                                <span className="font-medium text-slate-900">
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
                                  className="inline-flex items-center gap-1.5 font-mono text-slate-900 hover:text-blue-700"
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
                                  className="inline-flex items-center gap-1.5 font-mono text-slate-900 hover:text-blue-700"
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
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:border-blue-400 hover:text-blue-700 rounded-md font-medium text-slate-900 transition-colors"
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
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-950">
                      <p className="font-semibold flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span>Payment Submitted · Pending Admin Approval</span>
                      </p>
                      <p className="text-[11px] text-amber-900 leading-relaxed">
                        Your UTR number and payment screenshot have been sent to the administrator. Lectures will unlock as soon as the admin approves your payment.
                      </p>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="checkout-payment-ref"
                      className="block text-[11px] font-medium text-slate-700 mb-1"
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
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-base sm:text-xs font-mono text-slate-900"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="block text-[11px] font-medium text-slate-700">
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
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                        <img
                          src={paymentScreenshotUrl}
                          alt="Uploaded payment screenshot preview"
                          className="w-full max-h-48 object-contain rounded border border-slate-200 bg-white"
                        />
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Screenshot attached</span>
                          </span>
                          <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 font-medium rounded cursor-pointer">
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
                      <label className="flex flex-col items-center justify-center gap-1.5 px-4 py-4 border border-dashed border-slate-300 hover:border-blue-500 bg-slate-50/70 hover:bg-blue-50/40 rounded-lg cursor-pointer transition-colors text-center">
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-blue-600">
                          {uploadingScreenshot ? (
                            <Clock className="w-4 h-4 animate-pulse" />
                          ) : (
                            <ImageIcon className="w-4 h-4" />
                          )}
                        </div>
                        <span className="text-xs font-medium text-slate-800">
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
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-950">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    <span>Enrollment Request Pending Admin Approval</span>
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
              {purchaseSuccess && (
                <p className="text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded p-2.5 leading-relaxed">
                  {purchaseSuccess}
                </p>
              )}
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
                {checkoutPurchase?.status === 'pending' ? 'Close' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={purchasing || uploadingScreenshot}
                onClick={() => void handleConfirmPurchase()}
                className="px-5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {purchasing
                  ? 'Submitting...'
                  : checkoutPurchase?.status === 'pending'
                  ? 'Update Payment Proof'
                  : `Confirm Payment · ${formatInr(checkoutBatch.priceUsd)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
