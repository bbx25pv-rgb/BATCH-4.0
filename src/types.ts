import { Timestamp } from 'firebase/firestore';

export type SubjectColorKey = 'cobalt' | 'emerald' | 'amber' | 'rose' | 'slate';
export type SessionMode = 'pomodoro' | 'manual' | 'lecture';
export type HabitCategory = 'focus' | 'practice' | 'reading' | 'revision';
export type HabitUnit = 'minutes' | 'sessions' | 'pages';
export type PurchaseStatus = 'active' | 'revoked';

export const ADMIN_BOOTSTRAP_EMAIL = 'preetverma.bbx@gmail.com';

export const VALIDATION_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  datePattern: /^\d{4}-\d{2}-\d{2}$/,
  youtubeIdPattern: /^[a-zA-Z0-9_-]{11}$/,
  displayNameMax: 100,
  emailMax: 200,
  phoneNumberMax: 30,
  subjectNameMax: 80,
  subjectCodeMax: 20,
  sessionNotesMax: 500,
  lectureTitleMax: 160,
  habitTitleMax: 80,
  batchTitleMax: 120,
  subjectTagMax: 40,
  instructorMax: 80,
  batchDescriptionMax: 600,
  coverImageMax: 300,
  lectureDocTitleMax: 140,
  moduleNameMax: 80,
  youtubeUrlMax: 300,
  lectureSummaryMax: 600,
  thumbnailUrlMax: 150000,
} as const;

export const BATCH_COVER_IMAGES = [
  {
    label: 'Physics & Mechanics',
    path: '/src/assets/images/batch_physics_mechanics_1795673778406.jpg',
  },
  {
    label: 'Organic Chemistry',
    path: '/src/assets/images/batch_organic_chemistry_1795673778595.jpg',
  },
  {
    label: 'Calculus & Analysis',
    path: '/src/assets/images/batch_calculus_analysis_1795673778392.jpg',
  },
  {
    label: 'Algorithms & CS',
    path: '/src/assets/images/batch_algorithms_cs_1795673779629.jpg',
  },
] as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  phoneNumber: string;
  dailyGoalMinutes: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Subject {
  id: string;
  userId: string;
  name: string;
  code: string;
  targetMinutesPerWeek: number;
  colorKey: SubjectColorKey;
  totalMinutesLogged: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface StudySession {
  id: string;
  userId: string;
  subjectId: string;
  subjectName: string;
  durationMinutes: number;
  mode: SessionMode;
  notes: string;
  lectureTitle: string;
  completedAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  category: HabitCategory;
  targetValue: number;
  unit: HabitUnit;
  currentProgress: number;
  lastResetDate: string;
  streakDays: number;
  linkedSubjectId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Batch {
  id: string;
  title: string;
  subjectTag: string;
  instructor: string;
  description: string;
  priceUsd: number;
  coverImage: string;
  lectureCount: number;
  isPublished: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Lecture {
  id: string;
  batchId: string;
  title: string;
  moduleName: string;
  orderIndex: number;
  durationMinutes: number;
  youtubeUrl: string;
  youtubeVideoId: string;
  summary: string;
  thumbnailUrl?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BatchPurchase {
  id: string;
  userId: string;
  batchId: string;
  batchTitle: string;
  amountPaid: number;
  status: PurchaseStatus;
  grantedBy: string;
  purchasedAt: Timestamp;
  updatedAt: Timestamp;
}

export type ActiveTab = 'logs' | 'batches' | 'admin';
