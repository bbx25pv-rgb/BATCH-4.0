import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserCheck,
  Video,
  X,
} from 'lucide-react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import {
  addUnlistedLecture,
  adminGrantBatchAccess,
  adminTogglePurchaseStatus,
  createBatch,
  deleteUnlistedLecture,
  seedStarterBatches,
  updateBatch,
  updateLectureThumbnail,
} from '@/src/lib/studyService';
import {
  compressImageToThumbnailDataUrl,
  isSafeThumbnailUrl,
  parseYouTubeVideoId,
  resolveAssetUrl,
} from '@/src/lib/utils';
import {
  BATCH_COVER_IMAGES,
  Batch,
  BatchPurchase,
  Lecture,
  VALIDATION_LIMITS,
} from '@/src/types';
import { CadenceVideoPlayer } from '@/src/components/CadenceVideoPlayer';

interface AdminConsoleViewProps {
  adminUid: string;
  batches: Batch[];
  purchases: BatchPurchase[];
  onAuthRefresh: () => Promise<void>;
}

export function AdminConsoleView({
  adminUid,
  batches,
  purchases,
  onAuthRefresh,
}: AdminConsoleViewProps) {
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(false);

  // Batch creation state
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');
  const [subjectTag, setSubjectTag] = useState('');
  const [instructor, setInstructor] = useState('');
  const [description, setDescription] = useState('');
  const [priceUsd, setPriceUsd] = useState(79);
  const [coverImage, setCoverImage] = useState<string>(BATCH_COVER_IMAGES[0].path);
  const [isPublished, setIsPublished] = useState(true);
  const [savingBatch, setSavingBatch] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Lecture creation state (Admin only adds YouTube unlisted links)
  const [lecTitle, setLecTitle] = useState('');
  const [lecModule, setLecModule] = useState('Module 1');
  const [lecOrder, setLecOrder] = useState(1);
  const [lecDuration, setLecDuration] = useState(35);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [lecSummary, setLecSummary] = useState('');
  const [lecThumbnailUrl, setLecThumbnailUrl] = useState('');
  const [savingLecture, setSavingLecture] = useState(false);

  // Inline lecture thumbnail editor state
  const [editingThumbLecId, setEditingThumbLecId] = useState<string | null>(null);
  const [editingThumbUrl, setEditingThumbUrl] = useState('');
  const [savingThumb, setSavingThumb] = useState(false);

  // Grant access state
  const [grantUid, setGrantUid] = useState('');
  const [grantBatchId, setGrantBatchId] = useState('');
  const [granting, setGranting] = useState(false);

  // Admin password setup state
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [confirmAdminPassword, setConfirmAdminPassword] = useState('');
  const [savingAdminPassword, setSavingAdminPassword] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentUser = auth.currentUser;
  const hasPasswordProvider =
    currentUser?.providerData.some((p) => p.providerId === 'password') ?? false;

  useEffect(() => {
    if (!selectedBatchId && batches[0]) {
      setSelectedBatchId(batches[0].id);
    }
    if (!grantBatchId && batches[0]) {
      setGrantBatchId(batches[0].id);
    }
  }, [batches, selectedBatchId, grantBatchId]);

  useEffect(() => {
    if (!selectedBatchId) {
      setLectures([]);
      return;
    }
    setLoadingLectures(true);
    const path = `batches/${selectedBatchId}/lectures`;
    const q = query(collection(db, path), orderBy('orderIndex', 'asc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: Lecture[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Lecture, 'id'>),
        }));
        setLectures(items);
        setLecOrder(items.length + 1);
        setLoadingLectures(false);
      },
      (err) => {
        setLoadingLectures(false);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [selectedBatchId]);

  const parsedPreviewId = useMemo(
    () => parseYouTubeVideoId(youtubeUrl),
    [youtubeUrl]
  );

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId]
  );

  async function ensureVerifiedAdminSession(): Promise<boolean> {
    const activeUser = auth.currentUser;
    if (!activeUser) {
      setErrorMsg('Please sign in with your verified administrator account.');
      return false;
    }
    await activeUser.reload();
    await activeUser.getIdToken(true);
    if (!activeUser.emailVerified) {
      setErrorMsg(
        `Your email (${activeUser.email}) is currently marked unverified in Firebase Auth. Click "Verify with Google" in the verification banner above or open the verification link in your inbox.`
      );
      await onAuthRefresh();
      return false;
    }
    return true;
  }

  async function handleSeedStarterBatches() {
    setErrorMsg(null);
    setFeedback(null);
    setSeeding(true);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      await seedStarterBatches(adminUid);
      setFeedback('Published 4 starter academic batches. Select any batch below to attach unlisted YouTube lecture links.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create starter batches.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    setSavingBatch(true);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      const id = await createBatch(adminUid, {
        title: batchTitle,
        subjectTag,
        instructor,
        description,
        priceUsd,
        coverImage,
        isPublished,
      });
      setSelectedBatchId(id);
      setBatchTitle('');
      setSubjectTag('');
      setInstructor('');
      setDescription('');
      setShowBatchForm(false);
      setFeedback('New academic batch created.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create batch.');
    } finally {
      setSavingBatch(false);
    }
  }

  async function handleToggleBatchPublished(batch: Batch) {
    setErrorMsg(null);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      await updateBatch(batch.id, {
        title: batch.title,
        subjectTag: batch.subjectTag,
        instructor: batch.instructor,
        description: batch.description,
        priceUsd: batch.priceUsd,
        coverImage: batch.coverImage,
        isPublished: !batch.isPublished,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update batch.');
    }
  }

  async function handleAddLecture(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBatchId) {
      setErrorMsg('Select a batch first.');
      return;
    }
    if (!parsedPreviewId) {
      setErrorMsg('Enter a valid YouTube unlisted video link (e.g. https://youtu.be/VIDEO_ID or https://www.youtube.com/watch?v=VIDEO_ID).');
      return;
    }
    if (!isSafeThumbnailUrl(lecThumbnailUrl)) {
      setErrorMsg('Thumbnail URL must start with https:// or be an uploaded image.');
      return;
    }
    setErrorMsg(null);
    setFeedback(null);
    setSavingLecture(true);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      await addUnlistedLecture(adminUid, selectedBatchId, {
        title: lecTitle,
        moduleName: lecModule,
        orderIndex: Math.max(0, lecOrder - 1),
        durationMinutes: lecDuration,
        youtubeUrl,
        summary: lecSummary,
        thumbnailUrl: lecThumbnailUrl,
      });
      setLecTitle('');
      setYoutubeUrl('');
      setLecSummary('');
      setLecThumbnailUrl('');
      setFeedback('Unlisted YouTube lecture added to the batch. Only purchased students and admins can view it.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to add lecture.');
    } finally {
      setSavingLecture(false);
    }
  }

  async function handleThumbnailFileUpload(
    file: File | undefined,
    onResult: (dataUrl: string) => void
  ) {
    if (!file) return;
    setErrorMsg(null);
    try {
      const dataUrl = await compressImageToThumbnailDataUrl(file);
      onResult(dataUrl);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to process selected thumbnail image.'
      );
    }
  }

  async function handleSaveEditedThumbnail(lectureId: string) {
    if (!selectedBatchId) return;
    if (!isSafeThumbnailUrl(editingThumbUrl)) {
      setErrorMsg('Thumbnail URL must start with https:// or be an uploaded image.');
      return;
    }
    setErrorMsg(null);
    setSavingThumb(true);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      await updateLectureThumbnail(selectedBatchId, lectureId, editingThumbUrl);
      setEditingThumbLecId(null);
      setEditingThumbUrl('');
      setFeedback('Lecture thumbnail updated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update thumbnail.');
    } finally {
      setSavingThumb(false);
    }
  }

  const matchingStudentPurchase = useMemo(() => {
    const cleanUid = grantUid.trim();
    if (!cleanUid || !grantBatchId) return null;
    return (
      purchases.find(
        (p) => p.userId === cleanUid && p.batchId === grantBatchId
      ) ?? null
    );
  }, [purchases, grantUid, grantBatchId]);

  async function handleGrantStudentAccess(e: React.FormEvent) {
    e.preventDefault();
    const targetBatch = batches.find((b) => b.id === grantBatchId);
    if (!targetBatch) {
      setErrorMsg('Choose a batch to grant access to.');
      return;
    }
    const cleanUid = grantUid.trim();
    setErrorMsg(null);
    setFeedback(null);
    setGranting(true);
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      const outcome = await adminGrantBatchAccess(adminUid, cleanUid, targetBatch);
      if (outcome === 'already_active') {
        setFeedback(`Student ${cleanUid} already has active access to ${targetBatch.title}.`);
      } else if (outcome === 'restored') {
        setGrantUid('');
        setFeedback(`Restored active access to ${targetBatch.title} for ${cleanUid}.`);
      } else {
        setGrantUid('');
        setFeedback(`Granted active access to ${targetBatch.title}.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to grant access.');
    } finally {
      setGranting(false);
    }
  }

  async function handleTogglePurchaseStatus(purchase: BatchPurchase) {
    setErrorMsg(null);
    setFeedback(null);
    const nextStatus = purchase.status === 'active' ? 'revoked' : 'active';
    try {
      if (!(await ensureVerifiedAdminSession())) return;
      await adminTogglePurchaseStatus(adminUid, purchase.id, nextStatus);
      setFeedback(
        nextStatus === 'active'
          ? `Restored access to ${purchase.batchTitle} for ${purchase.userId}.`
          : `Revoked access to ${purchase.batchTitle} for ${purchase.userId}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update student batch access.');
    }
  }

  async function handleSaveAdminPassword(e: React.FormEvent) {
    e.preventDefault();
    const activeUser = auth.currentUser;
    if (!activeUser || !activeUser.email) {
      setErrorMsg('An admin email is required to configure an admin password.');
      return;
    }
    if (newAdminPassword.length < 6) {
      setErrorMsg('Admin password must be at least 6 characters long.');
      return;
    }
    if (newAdminPassword !== confirmAdminPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setErrorMsg(null);
    setFeedback(null);
    setSavingAdminPassword(true);

    const applyPasswordChange = async () => {
      if (activeUser.providerData.some((p) => p.providerId === 'password')) {
        await updatePassword(activeUser, newAdminPassword);
      } else {
        const cred = EmailAuthProvider.credential(activeUser.email!, newAdminPassword);
        await linkWithCredential(activeUser, cred);
      }
      await activeUser.reload();
      await activeUser.getIdToken(true);
    };

    try {
      await applyPasswordChange();
      setNewAdminPassword('');
      setConfirmAdminPassword('');
      if (!activeUser.emailVerified) {
        try {
          await sendEmailVerification(activeUser);
        } catch {
          // Ignore rate-limit on verification send; user can verify with Google or resend
        }
        await onAuthRefresh();
        setFeedback(
          `Admin password saved for ${activeUser.email}. Verify your email via Google or your inbox link to re-enable batch creation.`
        );
      } else {
        await onAuthRefresh();
        setFeedback(`Admin password saved for ${activeUser.email}. You can now sign in under Admin Login.`);
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/requires-recent-login') {
        try {
          await reauthenticateWithPopup(activeUser, googleProvider);
          await applyPasswordChange();
          setNewAdminPassword('');
          setConfirmAdminPassword('');
          await onAuthRefresh();
          setFeedback(`Admin password saved for ${activeUser.email}.`);
        } catch (retryErr) {
          setErrorMsg(
            retryErr instanceof Error
              ? retryErr.message
              : 'Re-authentication failed. Try signing out and back in.'
          );
        }
      } else if (code === 'auth/operation-not-allowed') {
        setErrorMsg(
          'Email/Password sign-in must be enabled in Firebase Console (Authentication -> Sign-in method -> Email/Password) before setting a password.'
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to save admin password.');
      }
    } finally {
      setSavingAdminPassword(false);
    }
  }

  return (
    <section className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Administrator Lecture & Batch Control</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">
            Admin Console
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl">
            Manage academic batches, attach YouTube unlisted lecture video links, and control student batch enrollment access.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {batches.length === 0 && (
            <button
              type="button"
              disabled={seeding}
              onClick={() => void handleSeedStarterBatches()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span>{seeding ? 'Publishing...' : 'Publish 4 Starter Batches'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowBatchForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showBatchForm ? 'Close Form' : 'Create New Batch'}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {errorMsg && (
        <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
          {errorMsg}
        </div>
      )}

      {/* Create Batch Form */}
      {showBatchForm && (
        <form
          onSubmit={handleCreateBatch}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <h2 className="text-base font-semibold text-slate-900">Create Academic Batch</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="b-title" className="block text-xs font-medium text-slate-700 mb-1">
                Batch Title
              </label>
              <input
                id="b-title"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.batchTitleMax}
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="e.g., Quantum Mechanics I"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label htmlFor="b-tag" className="block text-xs font-medium text-slate-700 mb-1">
                Subject Tag
              </label>
              <input
                id="b-tag"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.subjectTagMax}
                value={subjectTag}
                onChange={(e) => setSubjectTag(e.target.value)}
                placeholder="Physics"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="b-inst" className="block text-xs font-medium text-slate-700 mb-1">
                Instructor
              </label>
              <input
                id="b-inst"
                type="text"
                required
                maxLength={VALIDATION_LIMITS.instructorMax}
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
                placeholder="Dr. Vikram Rao"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label htmlFor="b-price" className="block text-xs font-medium text-slate-700 mb-1">
                Batch Price (USD)
              </label>
              <input
                id="b-price"
                type="number"
                min={0}
                max={5000}
                value={priceUsd}
                onChange={(e) => setPriceUsd(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="b-cover" className="block text-xs font-medium text-slate-700 mb-1">
                Cover Artwork
              </label>
              <select
                id="b-cover"
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                {BATCH_COVER_IMAGES.map((img) => (
                  <option key={img.path} value={img.path}>
                    {img.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="b-desc" className="block text-xs font-medium text-slate-700 mb-1">
              Batch Description
            </label>
            <textarea
              id="b-desc"
              rows={2}
              required
              maxLength={VALIDATION_LIMITS.batchDescriptionMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Concise syllabus overview for students..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Publish batch to student catalog immediately</span>
            </label>
            <button
              type="submit"
              disabled={savingBatch}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
            >
              {savingBatch ? 'Saving...' : 'Create Batch'}
            </button>
          </div>
        </form>
      )}

      {/* Main Admin Split: Unlisted YouTube Lecture Manager + Batch Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 7 cols: Add & Manage Unlisted YouTube Lectures */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Video className="w-4 h-4 text-blue-600" />
                <span>Unlisted YouTube Lecture Manager</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Only admins can attach unlisted YouTube links. Students see lectures only for batches they purchase.
              </p>
            </div>

            <select
              aria-label="Select target batch"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 max-w-xs"
            >
              {batches.length === 0 ? (
                <option value="">No batches created</option>
              ) : (
                batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.lectureCount})
                  </option>
                ))
              )}
            </select>
          </div>

          <form onSubmit={handleAddLecture} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="lec-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Lecture Title
                </label>
                <input
                  id="lec-title"
                  type="text"
                  required
                  maxLength={VALIDATION_LIMITS.lectureDocTitleMax}
                  value={lecTitle}
                  onChange={(e) => setLecTitle(e.target.value)}
                  placeholder="e.g., Lecture 01: Euler-Lagrange Equations"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
              <div>
                <label htmlFor="lec-mod" className="block text-xs font-medium text-slate-700 mb-1">
                  Module / Unit
                </label>
                <input
                  id="lec-mod"
                  type="text"
                  required
                  maxLength={VALIDATION_LIMITS.moduleNameMax}
                  value={lecModule}
                  onChange={(e) => setLecModule(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="lec-url" className="block text-xs font-medium text-slate-700 mb-1">
                  YouTube Unlisted Video Link
                </label>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="lec-url"
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.youtubeUrlMax}
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://youtu.be/unlisted_id"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="lec-dur" className="block text-xs font-medium text-slate-700 mb-1">
                  Duration (min)
                </label>
                <input
                  id="lec-dur"
                  type="number"
                  min={1}
                  max={600}
                  value={lecDuration}
                  onChange={(e) => setLecDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="lec-order" className="block text-xs font-medium text-slate-700 mb-1">
                  Lesson Order
                </label>
                <input
                  id="lec-order"
                  type="number"
                  min={1}
                  max={1000}
                  value={lecOrder}
                  onChange={(e) => setLecOrder(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <label htmlFor="lec-sum" className="block text-xs font-medium text-slate-700 mb-1">
                Lecture Notes / Key Takeaways (optional)
              </label>
              <input
                id="lec-sum"
                type="text"
                maxLength={VALIDATION_LIMITS.lectureSummaryMax}
                value={lecSummary}
                onChange={(e) => setLecSummary(e.target.value)}
                placeholder="Topics covered and practice set references..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            {/* Lecture Thumbnail Option */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="lec-thumb" className="block text-xs font-medium text-slate-700">
                  Lecture Thumbnail (optional)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {parsedPreviewId && (
                    <button
                      type="button"
                      onClick={() =>
                        setLecThumbnailUrl(`https://i.ytimg.com/vi/${parsedPreviewId}/hqdefault.jpg`)
                      }
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      Use Video Thumbnail
                    </button>
                  )}
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap">
                    <Upload className="w-3 h-3" />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        void handleThumbnailFileUpload(file, setLecThumbnailUrl);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {lecThumbnailUrl && (
                    <button
                      type="button"
                      onClick={() => setLecThumbnailUrl('')}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-700 whitespace-nowrap"
                    >
                      <X className="w-3 h-3" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <ImageIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="lec-thumb"
                    type="text"
                    value={
                      lecThumbnailUrl.startsWith('data:image/')
                        ? 'Uploaded custom thumbnail image'
                        : lecThumbnailUrl
                    }
                    readOnly={lecThumbnailUrl.startsWith('data:image/')}
                    onChange={(e) => setLecThumbnailUrl(e.target.value)}
                    placeholder="https://... or upload a 16:9 image (defaults to batch cover)"
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400"
                  />
                </div>
                {(lecThumbnailUrl || selectedBatch?.coverImage) && (
                  <img
                    src={resolveAssetUrl(lecThumbnailUrl || selectedBatch?.coverImage)}
                    alt="Lecture thumbnail preview"
                    referrerPolicy="no-referrer"
                    className="w-16 aspect-video rounded border border-slate-200 object-cover shrink-0 bg-slate-100"
                  />
                )}
              </div>
            </div>

            {parsedPreviewId && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs font-mono text-slate-600 mb-2">
                  Verified Unlisted Video ID: <strong className="text-slate-900">{parsedPreviewId}</strong>
                </p>
                <div className="w-full max-w-sm rounded-md overflow-hidden bg-slate-950">
                  <CadenceVideoPlayer
                    videoId={parsedPreviewId}
                    title={lecTitle || 'Lecture Preview'}
                    posterImage={lecThumbnailUrl || selectedBatch?.coverImage}
                    compact
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingLecture || !selectedBatchId}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{savingLecture ? 'Adding Lecture...' : 'Add Unlisted Lecture'}</span>
              </button>
            </div>
          </form>

          {/* Existing Lectures in Selected Batch */}
          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-xs font-semibold text-slate-700 mb-3">
              Lectures in Selected Batch
            </h3>
            {loadingLectures ? (
              <div className="h-20 bg-slate-100 rounded-lg animate-pulse" />
            ) : lectures.length === 0 ? (
              <p className="text-xs text-slate-500 py-4">
                No unlisted lecture videos attached to this batch yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {lectures.map((lec) => {
                  const thumbSrc = lec.thumbnailUrl || selectedBatch?.coverImage;
                  const isEditingThumb = editingThumbLecId === lec.id;
                  return (
                    <div key={lec.id} className="py-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-20 aspect-video rounded bg-slate-100 border border-slate-200 overflow-hidden shrink-0">
                            {thumbSrc ? (
                              <img
                                src={resolveAssetUrl(thumbSrc)}
                                alt={lec.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400">
                                <Video className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {lec.orderIndex + 1}. {lec.title}
                            </p>
                            <p className="text-xs text-slate-500 font-mono truncate">
                              {lec.moduleName} · {lec.durationMinutes}m · ID: {lec.youtubeVideoId}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            aria-label={`Edit thumbnail for ${lec.title}`}
                            title="Set lecture thumbnail"
                            onClick={() => {
                              if (isEditingThumb) {
                                setEditingThumbLecId(null);
                                setEditingThumbUrl('');
                              } else {
                                setEditingThumbLecId(lec.id);
                                setEditingThumbUrl(lec.thumbnailUrl ?? '');
                              }
                            }}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded transition-colors"
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${lec.title}`}
                            onClick={() => void deleteUnlistedLecture(selectedBatchId, lec.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-700 rounded transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {isEditingThumb && (
                        <div className="pl-23 flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            aria-label="Lecture thumbnail URL"
                            value={
                              editingThumbUrl.startsWith('data:image/')
                                ? 'Uploaded custom thumbnail image'
                                : editingThumbUrl
                            }
                            readOnly={editingThumbUrl.startsWith('data:image/')}
                            onChange={(e) => setEditingThumbUrl(e.target.value)}
                            placeholder="https://... or upload image"
                            className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-slate-200 rounded-md text-xs"
                          />
                          <label className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap">
                            <Upload className="w-3 h-3" />
                            <span>Upload</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                void handleThumbnailFileUpload(file, setEditingThumbUrl);
                                e.target.value = '';
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingThumbUrl(
                                `https://i.ytimg.com/vi/${lec.youtubeVideoId}/hqdefault.jpg`
                              )
                            }
                            className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-md whitespace-nowrap"
                          >
                            Video Frame
                          </button>
                          {editingThumbUrl && (
                            <button
                              type="button"
                              onClick={() => setEditingThumbUrl('')}
                              className="px-2 py-1.5 text-xs text-slate-500 hover:text-rose-700"
                            >
                              Reset
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={savingThumb}
                            onClick={() => void handleSaveEditedThumbnail(lec.id)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md disabled:opacity-50 whitespace-nowrap"
                          >
                            {savingThumb ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right 5 cols: Batch Visibility & Student Purchase Access */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Published Batches
            </h2>
            {batches.length === 0 ? (
              <p className="text-xs text-slate-500">No batches yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {batches.map((b) => (
                  <div
                    key={b.id}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {b.title}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        ${b.priceUsd} · {b.lectureCount} lectures ·{' '}
                        {b.isPublished ? 'Published' : 'Draft'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleBatchPublished(b)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-md hover:bg-slate-50 shrink-0"
                    >
                      {b.isPublished ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5 text-slate-500" />
                          <span>Hide</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5 text-blue-600" />
                          <span>Publish</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Student Enrollment & Access Control */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <span>Student Batch Enrollments</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Grant or revoke access to batch lectures by student UID.
              </p>
            </div>

            <form onSubmit={handleGrantStudentAccess} className="space-y-3">
              <div>
                <label htmlFor="grant-uid" className="block text-xs font-medium text-slate-700 mb-1">
                  Student User UID
                </label>
                <input
                  id="grant-uid"
                  type="text"
                  required
                  value={grantUid}
                  onChange={(e) => setGrantUid(e.target.value)}
                  placeholder="Firebase Auth UID"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Batch to grant"
                  value={grantBatchId}
                  onChange={(e) => setGrantBatchId(e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={
                    granting ||
                    batches.length === 0 ||
                    matchingStudentPurchase?.status === 'active'
                  }
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {granting
                    ? 'Saving...'
                    : matchingStudentPurchase?.status === 'active'
                    ? 'Already Active'
                    : matchingStudentPurchase?.status === 'revoked'
                    ? 'Restore Access'
                    : 'Grant Access'}
                </button>
              </div>
              {matchingStudentPurchase && (
                <p className="text-[11px] text-slate-600">
                  {matchingStudentPurchase.status === 'active'
                    ? 'This student already has active access to the selected batch.'
                    : 'This student previously had access revoked. Click Restore Access to re-enable.'}
                </p>
              )}
            </form>

            <div className="pt-3 border-t border-slate-100 divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {purchases.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  No student batch purchases recorded yet.
                </p>
              ) : (
                purchases.map((p) => (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">
                        {p.batchTitle}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 truncate">
                        UID: {p.userId} · {p.status}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleTogglePurchaseStatus(p)}
                      className={`px-2.5 py-1 text-xs font-medium rounded border shrink-0 ${
                        p.status === 'active'
                          ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      {p.status === 'active' ? 'Revoke' : 'Restore'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Admin Password Setup Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-blue-600" />
                <span>Admin Login & Password</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {hasPasswordProvider
                  ? `Password login is active for ${currentUser?.email ?? 'this admin account'}. Update your password below.`
                  : `Link a password to ${currentUser?.email ?? 'your admin account'} so you can sign in with Email & Password in addition to Google.`}
              </p>
            </div>

            <form onSubmit={handleSaveAdminPassword} className="space-y-3">
              <div>
                <label htmlFor="set-admin-pass" className="block text-xs font-medium text-slate-700 mb-1">
                  {hasPasswordProvider ? 'New Admin Password' : 'Create Admin Password'}
                </label>
                <input
                  id="set-admin-pass"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label htmlFor="confirm-admin-pass" className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm Password
                </label>
                <input
                  id="confirm-admin-pass"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmAdminPassword}
                  onChange={(e) => setConfirmAdminPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={savingAdminPassword}
                className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg disabled:opacity-50"
              >
                {savingAdminPassword
                  ? 'Saving Password...'
                  : hasPasswordProvider
                  ? 'Update Admin Password'
                  : 'Save Admin Password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
