import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import {
  BATCH_COVER_IMAGES,
  Batch,
  Habit,
  HabitCategory,
  HabitUnit,
  Lecture,
  PaymentMethodType,
  PurchaseStatus,
  SessionMode,
  Subject,
  SubjectColorKey,
  VALIDATION_LIMITS,
} from '@/src/types';
import {
  getTodayDateString,
  isSafeHttpsUrl,
  isSafeThumbnailUrl,
  parseYouTubeVideoId,
  sanitizeString,
} from '@/src/lib/utils';

function makeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export async function ensureUserProfile(user: User): Promise<void> {
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const fallbackName =
        user.displayName ||
        user.email?.split('@')[0] ||
        user.phoneNumber ||
        'Student';
      await setDoc(ref, {
        uid: user.uid,
        displayName: sanitizeString(fallbackName, VALIDATION_LIMITS.displayNameMax),
        email: sanitizeString(user.email || '', VALIDATION_LIMITS.emailMax),
        phoneNumber: sanitizeString(user.phoneNumber || '', VALIDATION_LIMITS.phoneNumberMax),
        dailyGoalMinutes: 120,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function seedStarterSubjectsAndHabits(userId: string): Promise<void> {
  const today = getTodayDateString();
  const batch = writeBatch(db);

  const starterSubjects: Array<{
    name: string;
    code: string;
    targetMinutesPerWeek: number;
    colorKey: SubjectColorKey;
  }> = [
    { name: 'Classical Mechanics', code: 'PHYS 101', targetMinutesPerWeek: 300, colorKey: 'cobalt' },
    { name: 'Organic Chemistry', code: 'CHEM 204', targetMinutesPerWeek: 240, colorKey: 'emerald' },
    { name: 'Multivariable Calculus', code: 'MATH 210', targetMinutesPerWeek: 300, colorKey: 'amber' },
  ];

  const createdSubjectIds: string[] = [];

  starterSubjects.forEach((subj) => {
    const id = makeDocId('subj');
    createdSubjectIds.push(id);
    batch.set(doc(db, 'subjects', id), {
      userId,
      name: subj.name,
      code: subj.code,
      targetMinutesPerWeek: subj.targetMinutesPerWeek,
      colorKey: subj.colorKey,
      totalMinutesLogged: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const starterHabits: Array<{
    title: string;
    category: HabitCategory;
    targetValue: number;
    unit: HabitUnit;
    linkedSubjectId: string;
  }> = [
    {
      title: 'Deep Focus Pomodoro Blocks',
      category: 'focus',
      targetValue: 100,
      unit: 'minutes',
      linkedSubjectId: createdSubjectIds[0],
    },
    {
      title: 'Problem Set Practice',
      category: 'practice',
      targetValue: 2,
      unit: 'sessions',
      linkedSubjectId: createdSubjectIds[2],
    },
    {
      title: 'Lecture Notes & Active Recall',
      category: 'revision',
      targetValue: 30,
      unit: 'minutes',
      linkedSubjectId: createdSubjectIds[1],
    },
  ];

  starterHabits.forEach((habit) => {
    const id = makeDocId('hab');
    batch.set(doc(db, 'habits', id), {
      userId,
      title: habit.title,
      category: habit.category,
      targetValue: habit.targetValue,
      unit: habit.unit,
      currentProgress: 0,
      lastResetDate: today,
      streakDays: 0,
      linkedSubjectId: habit.linkedSubjectId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'subjects');
  }
}

export async function createSubject(
  userId: string,
  input: {
    name: string;
    code: string;
    targetMinutesPerWeek: number;
    colorKey: SubjectColorKey;
  }
): Promise<string> {
  const id = makeDocId('subj');
  const path = `subjects/${id}`;
  try {
    await setDoc(doc(db, 'subjects', id), {
      userId,
      name: sanitizeString(input.name, VALIDATION_LIMITS.subjectNameMax),
      code: sanitizeString(input.code, VALIDATION_LIMITS.subjectCodeMax),
      targetMinutesPerWeek: Math.min(6000, Math.max(30, Math.round(input.targetMinutesPerWeek))),
      colorKey: input.colorKey,
      totalMinutesLogged: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSubject(
  subjectId: string,
  input: {
    name: string;
    code: string;
    targetMinutesPerWeek: number;
    colorKey: SubjectColorKey;
  }
): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await updateDoc(doc(db, 'subjects', subjectId), {
      name: sanitizeString(input.name, VALIDATION_LIMITS.subjectNameMax),
      code: sanitizeString(input.code, VALIDATION_LIMITS.subjectCodeMax),
      targetMinutesPerWeek: Math.min(6000, Math.max(30, Math.round(input.targetMinutesPerWeek))),
      colorKey: input.colorKey,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSubject(subjectId: string): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await deleteDoc(doc(db, 'subjects', subjectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function logStudySession(
  userId: string,
  input: {
    subject: Subject;
    durationMinutes: number;
    mode: SessionMode;
    notes: string;
    lectureTitle?: string;
    habitsToAdvance?: Habit[];
  }
): Promise<void> {
  const duration = Math.min(480, Math.max(1, Math.round(input.durationMinutes)));
  const sessionId = makeDocId('sess');
  const today = getTodayDateString();
  const batch = writeBatch(db);

  batch.set(doc(db, 'studySessions', sessionId), {
    userId,
    subjectId: input.subject.id,
    subjectName: sanitizeString(input.subject.name, VALIDATION_LIMITS.subjectNameMax),
    durationMinutes: duration,
    mode: input.mode,
    notes: sanitizeString(input.notes || '', VALIDATION_LIMITS.sessionNotesMax),
    lectureTitle: sanitizeString(input.lectureTitle || '', VALIDATION_LIMITS.lectureTitleMax),
    completedAt: Timestamp.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'subjects', input.subject.id), {
    totalMinutesLogged: increment(duration),
    updatedAt: serverTimestamp(),
  });

  // Automatically increment matching daily habit progress bars
  if (input.habitsToAdvance && input.habitsToAdvance.length > 0) {
    for (const habit of input.habitsToAdvance) {
      const isLinked = !habit.linkedSubjectId || habit.linkedSubjectId === input.subject.id;
      const shouldAdvance =
        isLinked &&
        (habit.unit === 'minutes' || habit.unit === 'sessions') &&
        (habit.category === 'focus' ||
          (input.mode === 'lecture' && habit.category === 'revision') ||
          (input.mode === 'manual' && habit.category === 'practice'));

      if (!shouldAdvance) continue;

      const delta = habit.unit === 'minutes' ? duration : 1;
      const baseProgress = habit.lastResetDate === today ? habit.currentProgress : 0;
      const nextProgress = Math.min(2000, baseProgress + delta);
      const crossedTarget = baseProgress < habit.targetValue && nextProgress >= habit.targetValue;

      batch.update(doc(db, 'habits', habit.id), {
        currentProgress: nextProgress,
        lastResetDate: today,
        streakDays: crossedTarget ? Math.min(3650, habit.streakDays + 1) : habit.streakDays,
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `studySessions/${sessionId}`);
  }
}

export async function updateSessionNotes(sessionId: string, notes: string): Promise<void> {
  const path = `studySessions/${sessionId}`;
  try {
    await updateDoc(doc(db, 'studySessions', sessionId), {
      notes: sanitizeString(notes, VALIDATION_LIMITS.sessionNotesMax),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudySession(session: {
  id: string;
  subjectId: string;
  durationMinutes: number;
}, subjectExists: boolean): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'studySessions', session.id));
  if (subjectExists) {
    batch.update(doc(db, 'subjects', session.subjectId), {
      totalMinutesLogged: increment(-Math.max(0, session.durationMinutes)),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `studySessions/${session.id}`);
  }
}

export async function createHabit(
  userId: string,
  input: {
    title: string;
    category: HabitCategory;
    targetValue: number;
    unit: HabitUnit;
    linkedSubjectId: string;
  }
): Promise<void> {
  const id = makeDocId('hab');
  const path = `habits/${id}`;
  try {
    await setDoc(doc(db, 'habits', id), {
      userId,
      title: sanitizeString(input.title, VALIDATION_LIMITS.habitTitleMax),
      category: input.category,
      targetValue: Math.min(600, Math.max(1, Math.round(input.targetValue))),
      unit: input.unit,
      currentProgress: 0,
      lastResetDate: getTodayDateString(),
      streakDays: 0,
      linkedSubjectId: input.linkedSubjectId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adjustHabitProgress(habit: Habit, delta: number): Promise<void> {
  const today = getTodayDateString();
  const base = habit.lastResetDate === today ? habit.currentProgress : 0;
  const nextProgress = Math.min(2000, Math.max(0, base + delta));
  const crossedUp = base < habit.targetValue && nextProgress >= habit.targetValue;
  const crossedDown = base >= habit.targetValue && nextProgress < habit.targetValue;
  let nextStreak = habit.streakDays;
  if (crossedUp) nextStreak = Math.min(3650, habit.streakDays + 1);
  if (crossedDown) nextStreak = Math.max(0, habit.streakDays - 1);

  const path = `habits/${habit.id}`;
  try {
    await updateDoc(doc(db, 'habits', habit.id), {
      currentProgress: nextProgress,
      lastResetDate: today,
      streakDays: nextStreak,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteHabit(habitId: string): Promise<void> {
  const path = `habits/${habitId}`;
  try {
    await deleteDoc(doc(db, 'habits', habitId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Admin & Batch Operations ---

export async function createBatch(
  adminUid: string,
  input: {
    title: string;
    subjectTag: string;
    instructor: string;
    description: string;
    priceUsd: number;
    coverImage: string;
    isPublished: boolean;
  }
): Promise<string> {
  const cleanCover = input.coverImage.trim();
  if (!cleanCover || !isSafeThumbnailUrl(cleanCover)) {
    throw new Error('Cover artwork must be a studio preset, an https:// image URL, or an uploaded image.');
  }

  const id = makeDocId('batch');
  const path = `batches/${id}`;
  const rawPrice = Number(input.priceUsd);
  const safePrice = Number.isFinite(rawPrice) ? Math.min(500000, Math.max(0, rawPrice)) : 0;
  try {
    await setDoc(doc(db, 'batches', id), {
      title: sanitizeString(input.title, VALIDATION_LIMITS.batchTitleMax),
      subjectTag: sanitizeString(input.subjectTag, VALIDATION_LIMITS.subjectTagMax),
      instructor: sanitizeString(input.instructor, VALIDATION_LIMITS.instructorMax),
      description: sanitizeString(input.description, VALIDATION_LIMITS.batchDescriptionMax),
      priceUsd: safePrice,
      coverImage: sanitizeString(cleanCover, VALIDATION_LIMITS.coverImageMax),
      lectureCount: 0,
      isPublished: input.isPublished,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBatch(
  batchId: string,
  input: {
    title: string;
    subjectTag: string;
    instructor: string;
    description: string;
    priceUsd: number;
    coverImage: string;
    isPublished: boolean;
  }
): Promise<void> {
  const cleanCover = input.coverImage.trim();
  if (!cleanCover || !isSafeThumbnailUrl(cleanCover)) {
    throw new Error('Cover artwork must be a studio preset, an https:// image URL, or an uploaded image.');
  }

  const path = `batches/${batchId}`;
  const rawPrice = Number(input.priceUsd);
  const safePrice = Number.isFinite(rawPrice) ? Math.min(500000, Math.max(0, rawPrice)) : 0;
  try {
    await updateDoc(doc(db, 'batches', batchId), {
      title: sanitizeString(input.title, VALIDATION_LIMITS.batchTitleMax),
      subjectTag: sanitizeString(input.subjectTag, VALIDATION_LIMITS.subjectTagMax),
      instructor: sanitizeString(input.instructor, VALIDATION_LIMITS.instructorMax),
      description: sanitizeString(input.description, VALIDATION_LIMITS.batchDescriptionMax),
      priceUsd: safePrice,
      coverImage: sanitizeString(cleanCover, VALIDATION_LIMITS.coverImageMax),
      isPublished: input.isPublished,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addUnlistedLecture(
  adminUid: string,
  batchId: string,
  input: {
    title: string;
    moduleName: string;
    orderIndex: number;
    durationMinutes: number;
    youtubeUrl: string;
    summary: string;
    thumbnailUrl?: string;
  }
): Promise<string> {
  const videoId = parseYouTubeVideoId(input.youtubeUrl);
  if (!videoId) {
    throw new Error('Please enter a valid YouTube unlisted video URL or 11-character video ID.');
  }

  const cleanThumb = (input.thumbnailUrl ?? '').trim();
  if (!isSafeThumbnailUrl(cleanThumb)) {
    throw new Error('Thumbnail must be an https:// URL, uploaded image, or studio artwork.');
  }

  const lectureId = makeDocId('lec');
  const cleanTitle = sanitizeString(input.title, VALIDATION_LIMITS.lectureDocTitleMax);
  const cleanModule = sanitizeString(input.moduleName, VALIDATION_LIMITS.moduleNameMax);
  const cleanOrder = Math.min(1000, Math.max(0, Math.round(input.orderIndex)));
  const cleanDuration = Math.min(600, Math.max(1, Math.round(input.durationMinutes)));
  const cleanSummary = sanitizeString(input.summary || '', VALIDATION_LIMITS.lectureSummaryMax);

  const batch = writeBatch(db);
  batch.set(doc(db, 'batches', batchId, 'lectures', lectureId), {
    batchId,
    title: cleanTitle,
    moduleName: cleanModule,
    orderIndex: cleanOrder,
    durationMinutes: cleanDuration,
    youtubeUrl: sanitizeString(input.youtubeUrl, VALIDATION_LIMITS.youtubeUrlMax),
    youtubeVideoId: videoId,
    summary: cleanSummary,
    thumbnailUrl: cleanThumb,
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'batches', batchId, 'syllabus', lectureId), {
    batchId,
    title: cleanTitle,
    moduleName: cleanModule,
    orderIndex: cleanOrder,
    durationMinutes: cleanDuration,
    summary: cleanSummary,
    thumbnailUrl: cleanThumb,
    createdBy: adminUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'batches', batchId), {
    lectureCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return lectureId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `batches/${batchId}/lectures/${lectureId}`);
  }
}

export async function updateUnlistedLecture(
  batchId: string,
  lectureId: string,
  input: {
    title: string;
    moduleName: string;
    orderIndex: number;
    durationMinutes: number;
    youtubeUrl: string;
    summary: string;
    thumbnailUrl?: string;
  }
): Promise<void> {
  const videoId = parseYouTubeVideoId(input.youtubeUrl);
  if (!videoId) {
    throw new Error('Please enter a valid YouTube unlisted video URL or 11-character video ID.');
  }

  const cleanThumb = (input.thumbnailUrl ?? '').trim();
  if (!isSafeThumbnailUrl(cleanThumb)) {
    throw new Error('Thumbnail must be an https:// URL, uploaded image, or studio artwork.');
  }

  const cleanTitle = sanitizeString(input.title, VALIDATION_LIMITS.lectureDocTitleMax);
  const cleanModule = sanitizeString(input.moduleName, VALIDATION_LIMITS.moduleNameMax);
  const cleanOrder = Math.min(1000, Math.max(0, Math.round(input.orderIndex)));
  const cleanDuration = Math.min(600, Math.max(1, Math.round(input.durationMinutes)));
  const cleanSummary = sanitizeString(input.summary || '', VALIDATION_LIMITS.lectureSummaryMax);

  const lectureRef = doc(db, 'batches', batchId, 'lectures', lectureId);
  const syllabusRef = doc(db, 'batches', batchId, 'syllabus', lectureId);
  const path = `batches/${batchId}/lectures/${lectureId}`;

  try {
    const syllabusSnap = await getDoc(syllabusRef);
    const batch = writeBatch(db);
    batch.update(lectureRef, {
      title: cleanTitle,
      moduleName: cleanModule,
      orderIndex: cleanOrder,
      durationMinutes: cleanDuration,
      youtubeUrl: sanitizeString(input.youtubeUrl, VALIDATION_LIMITS.youtubeUrlMax),
      youtubeVideoId: videoId,
      summary: cleanSummary,
      thumbnailUrl: cleanThumb,
      updatedAt: serverTimestamp(),
    });
    if (syllabusSnap.exists()) {
      batch.update(syllabusRef, {
        title: cleanTitle,
        moduleName: cleanModule,
        orderIndex: cleanOrder,
        durationMinutes: cleanDuration,
        summary: cleanSummary,
        thumbnailUrl: cleanThumb,
        updatedAt: serverTimestamp(),
      });
    } else {
      const lectureSnap = await getDoc(lectureRef);
      const createdBy = auth.currentUser?.uid || lectureSnap.data()?.createdBy;
      if (createdBy) {
        batch.set(syllabusRef, {
          batchId,
          title: cleanTitle,
          moduleName: cleanModule,
          orderIndex: cleanOrder,
          durationMinutes: cleanDuration,
          summary: cleanSummary,
          thumbnailUrl: cleanThumb,
          createdBy,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateLectureThumbnail(
  batchId: string,
  lectureId: string,
  thumbnailUrl: string
): Promise<void> {
  const cleanThumb = thumbnailUrl.trim();
  if (!isSafeThumbnailUrl(cleanThumb)) {
    throw new Error('Thumbnail must be an https:// URL, uploaded image, or studio artwork.');
  }

  const lectureRef = doc(db, 'batches', batchId, 'lectures', lectureId);
  const syllabusRef = doc(db, 'batches', batchId, 'syllabus', lectureId);
  const path = `batches/${batchId}/lectures/${lectureId}`;
  try {
    const syllabusSnap = await getDoc(syllabusRef);
    const batch = writeBatch(db);
    batch.update(lectureRef, {
      thumbnailUrl: cleanThumb,
      updatedAt: serverTimestamp(),
    });
    if (syllabusSnap.exists()) {
      batch.update(syllabusRef, {
        thumbnailUrl: cleanThumb,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteUnlistedLecture(batchId: string, lectureId: string): Promise<void> {
  const syllabusRef = doc(db, 'batches', batchId, 'syllabus', lectureId);
  const path = `batches/${batchId}/lectures/${lectureId}`;
  try {
    const syllabusSnap = await getDoc(syllabusRef);
    const batch = writeBatch(db);
    batch.delete(doc(db, 'batches', batchId, 'lectures', lectureId));
    if (syllabusSnap.exists()) {
      batch.delete(syllabusRef);
    }
    batch.update(doc(db, 'batches', batchId), {
      lectureCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncBatchSyllabusPreviews(
  adminUid: string,
  batchId: string
): Promise<void> {
  try {
    const [lecturesSnap, syllabusSnap] = await Promise.all([
      getDocs(collection(db, 'batches', batchId, 'lectures')),
      getDocs(collection(db, 'batches', batchId, 'syllabus')),
    ]);

    const existingIds = new Set(syllabusSnap.docs.map((d) => d.id));
    const missing = lecturesSnap.docs.filter((d) => !existingIds.has(d.id));
    if (missing.length === 0) return;

    const batch = writeBatch(db);
    missing.forEach((d) => {
      const data = d.data() as Omit<Lecture, 'id'>;
      batch.set(doc(db, 'batches', batchId, 'syllabus', d.id), {
        batchId,
        title: sanitizeString(data.title || 'Lecture', VALIDATION_LIMITS.lectureDocTitleMax),
        moduleName: sanitizeString(data.moduleName || 'Module 1', VALIDATION_LIMITS.moduleNameMax),
        orderIndex: Math.min(1000, Math.max(0, Math.round(data.orderIndex ?? 0))),
        durationMinutes: Math.min(600, Math.max(1, Math.round(data.durationMinutes ?? 10))),
        summary: sanitizeString(data.summary || '', VALIDATION_LIMITS.lectureSummaryMax),
        thumbnailUrl: isSafeThumbnailUrl(data.thumbnailUrl ?? '') ? (data.thumbnailUrl ?? '') : '',
        createdBy: data.createdBy || adminUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  } catch {
    // Non-blocking background sync
  }
}

export async function purchaseBatch(
  userId: string,
  batch: Batch,
  paymentDetails?: {
    paymentMethodId?: string;
    paymentMethodLabel?: string;
    paymentReference?: string;
  }
): Promise<void> {
  const purchaseId = `${userId}_${batch.id}`;
  const path = `purchases/${purchaseId}`;
  const ref = doc(db, 'purchases', purchaseId);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData?.status === 'active') {
        return;
      }
      throw new Error(
        'Access to this batch was revoked by an administrator. Contact your instructor to restore access.'
      );
    }

    const payload: Record<string, unknown> = {
      userId,
      batchId: batch.id,
      batchTitle: sanitizeString(batch.title, VALIDATION_LIMITS.batchTitleMax),
      amountPaid: batch.priceUsd,
      status: 'active',
      grantedBy: userId,
      purchasedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (paymentDetails?.paymentMethodId) {
      payload.paymentMethodId = sanitizeString(paymentDetails.paymentMethodId, 128);
    }
    if (paymentDetails?.paymentMethodLabel) {
      payload.paymentMethodLabel = sanitizeString(
        paymentDetails.paymentMethodLabel,
        VALIDATION_LIMITS.paymentLabelMax
      );
    }
    if (paymentDetails?.paymentReference?.trim()) {
      payload.paymentReference = sanitizeString(
        paymentDetails.paymentReference,
        VALIDATION_LIMITS.paymentReferenceMax
      );
    }

    await setDoc(ref, payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes('revoked by an administrator')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminGrantBatchAccess(
  adminUid: string,
  studentUid: string,
  batch: Batch
): Promise<'granted' | 'restored' | 'already_active'> {
  const cleanStudentUid = studentUid.trim();
  if (!VALIDATION_LIMITS.idPattern.test(cleanStudentUid)) {
    throw new Error('Student UID must contain only letters, numbers, underscores, or hyphens.');
  }
  const purchaseId = `${cleanStudentUid}_${batch.id}`;
  const path = `purchases/${purchaseId}`;
  const ref = doc(db, 'purchases', purchaseId);
  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const existingData = existingSnap.data();
      if (existingData?.status === 'active') {
        return 'already_active';
      }
      await updateDoc(ref, {
        status: 'active',
        batchTitle: sanitizeString(batch.title, VALIDATION_LIMITS.batchTitleMax),
        amountPaid: batch.priceUsd,
        grantedBy: adminUid,
        updatedAt: serverTimestamp(),
      });
      return 'restored';
    }

    await setDoc(ref, {
      userId: cleanStudentUid,
      batchId: batch.id,
      batchTitle: sanitizeString(batch.title, VALIDATION_LIMITS.batchTitleMax),
      amountPaid: batch.priceUsd,
      status: 'active',
      grantedBy: adminUid,
      purchasedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return 'granted';
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminTogglePurchaseStatus(
  adminUid: string,
  purchaseId: string,
  nextStatus: PurchaseStatus
): Promise<void> {
  const path = `purchases/${purchaseId}`;
  try {
    await updateDoc(doc(db, 'purchases', purchaseId), {
      status: nextStatus,
      grantedBy: adminUid,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function seedStarterBatches(adminUid: string): Promise<void> {
  const starterCatalog = [
    {
      title: 'Classical Mechanics & Rotational Dynamics',
      subjectTag: 'Physics',
      instructor: 'Dr. Elena Rostova',
      description: 'Rigorous problem-solving cohort covering Lagrangian intuition, rotational inertia, oscillations, and central force motion.',
      priceUsd: 999,
      coverImage: BATCH_COVER_IMAGES[0].path,
    },
    {
      title: 'Organic Reaction Mechanisms Mastery',
      subjectTag: 'Chemistry',
      instructor: 'Prof. Arjun Mehta',
      description: 'Structured synthesis and stereochemistry curriculum designed around arrow-pushing logic and spectroscopic analysis.',
      priceUsd: 1299,
      coverImage: BATCH_COVER_IMAGES[1].path,
    },
    {
      title: 'Multivariable Calculus & Vector Fields',
      subjectTag: 'Mathematics',
      instructor: 'Dr. Claire Beaumont',
      description: 'Visual and analytical deep dive into partial derivatives, line integrals, Stokes theorem, and optimization.',
      priceUsd: 899,
      coverImage: BATCH_COVER_IMAGES[2].path,
    },
    {
      title: 'Algorithms, Graphs & Dynamic Programming',
      subjectTag: 'Computer Science',
      instructor: 'Marcus Vance',
      description: 'Competitive and academic foundations in graph traversal, shortest paths, recurrence relations, and DP state design.',
      priceUsd: 1499,
      coverImage: BATCH_COVER_IMAGES[3].path,
    },
  ];

  const batch = writeBatch(db);
  starterCatalog.forEach((item) => {
    const id = makeDocId('batch');
    batch.set(doc(db, 'batches', id), {
      ...item,
      lectureCount: 0,
      isPublished: true,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'batches');
  }
}

export interface PaymentMethodInput {
  label: string;
  type: PaymentMethodType;
  isActive: boolean;
  upiId: string;
  payeeName: string;
  qrImageUrl: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  paymentLinkUrl: string;
  instructions: string;
}

function normalizePaymentMethodInput(input: PaymentMethodInput) {
  const label = sanitizeString(input.label, VALIDATION_LIMITS.paymentLabelMax);
  if (!label) {
    throw new Error('Enter a display label for this payment method.');
  }

  const upiId = sanitizeString(input.upiId || '', VALIDATION_LIMITS.upiIdMax);
  const payeeName = sanitizeString(input.payeeName || '', VALIDATION_LIMITS.payeeNameMax);
  const qrImageUrl = (input.qrImageUrl || '').trim();
  const bankName = sanitizeString(input.bankName || '', VALIDATION_LIMITS.bankNameMax);
  const accountNumber = sanitizeString(
    input.accountNumber || '',
    VALIDATION_LIMITS.accountNumberMax
  );
  const ifscCode = sanitizeString(input.ifscCode || '', VALIDATION_LIMITS.ifscCodeMax).toUpperCase();
  const paymentLinkUrl = sanitizeString(
    input.paymentLinkUrl || '',
    VALIDATION_LIMITS.paymentLinkUrlMax
  );
  const instructions = sanitizeString(
    input.instructions || '',
    VALIDATION_LIMITS.paymentInstructionsMax
  );

  if (qrImageUrl && (!isSafeThumbnailUrl(qrImageUrl) || qrImageUrl.startsWith('/src/assets/'))) {
    throw new Error('QR code image must be an https:// URL or an uploaded image.');
  }

  if (paymentLinkUrl && !isSafeHttpsUrl(paymentLinkUrl)) {
    throw new Error('Payment link URL must start with https://.');
  }

  if (input.type === 'upi' && upiId.length < 3 && qrImageUrl.length < 10) {
    throw new Error('Enter a valid UPI ID (e.g. name@okaxis) or upload a UPI QR code.');
  }

  if (
    input.type === 'bank' &&
    (bankName.length < 2 || accountNumber.length < 4 || ifscCode.length < 4)
  ) {
    throw new Error('Bank transfer requires Bank Name, Account Number, and IFSC Code.');
  }

  if (input.type === 'gateway' && paymentLinkUrl.length < 10) {
    throw new Error('Enter a valid https:// payment link URL.');
  }

  if (input.type === 'manual' && instructions.length < 3) {
    throw new Error('Enter instructions for offline / cash payment.');
  }

  return {
    label,
    type: input.type,
    isActive: Boolean(input.isActive),
    upiId,
    payeeName,
    qrImageUrl,
    bankName,
    accountNumber,
    ifscCode,
    paymentLinkUrl,
    instructions,
  };
}

export async function createPaymentMethod(
  adminUid: string,
  input: PaymentMethodInput
): Promise<string> {
  const id = makeDocId('pay');
  const path = `paymentMethods/${id}`;
  const normalized = normalizePaymentMethodInput(input);
  try {
    await setDoc(doc(db, 'paymentMethods', id), {
      ...normalized,
      createdBy: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updatePaymentMethod(
  methodId: string,
  input: PaymentMethodInput
): Promise<void> {
  const path = `paymentMethods/${methodId}`;
  const normalized = normalizePaymentMethodInput(input);
  try {
    await updateDoc(doc(db, 'paymentMethods', methodId), {
      ...normalized,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function togglePaymentMethodActive(
  methodId: string,
  isActive: boolean
): Promise<void> {
  const path = `paymentMethods/${methodId}`;
  try {
    await updateDoc(doc(db, 'paymentMethods', methodId), {
      isActive,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deletePaymentMethod(methodId: string): Promise<void> {
  const path = `paymentMethods/${methodId}`;
  try {
    await deleteDoc(doc(db, 'paymentMethods', methodId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export type { Lecture };
