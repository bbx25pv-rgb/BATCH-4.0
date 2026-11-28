import { useCallback, useEffect, useState } from 'react';
import {
  onIdTokenChanged,
  sendEmailVerification,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { Check, Copy, MailCheck, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '@/src/lib/firebase';
import {
  ensureUserProfile,
  seedStarterSubjectsAndHabits,
} from '@/src/lib/studyService';
import {
  ActiveTab,
  ADMIN_BOOTSTRAP_EMAIL,
  Batch,
  BatchProgress,
  BatchPurchase,
  Habit,
  PaymentMethod,
  StudySession,
  Subject,
  UserProfile,
} from '@/src/types';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { Navbar } from '@/src/components/Navbar';
import { SessionLogsView } from '@/src/components/SessionLogsView';
import { LectureBatchesView } from '@/src/components/LectureBatchesView';
import { AdminConsoleView } from '@/src/components/AdminConsoleView';
import { SignInModal } from '@/src/components/SignInModal';

function CadenceApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('batches');
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isVerifiedUser, setIsVerifiedUser] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [pendingEnrollBatchId, setPendingEnrollBatchId] = useState<string | null>(null);
  const [requestedOpenBatchId, setRequestedOpenBatchId] = useState<string | null>(null);
  const [requestedPurchaseBatchId, setRequestedPurchaseBatchId] = useState<string | null>(null);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [verifyingAction, setVerifyingAction] = useState(false);

  // Firestore collections
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [purchases, setPurchases] = useState<BatchPurchase[]>([]);
  const [batchProgressList, setBatchProgressList] = useState<BatchProgress[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [copiedFooterUid, setCopiedFooterUid] = useState(false);
  const [loadingUserData, setLoadingUserData] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(true);

  const syncUserSession = useCallback(async (nextUser: User | null) => {
    setUser(nextUser);

    if (!nextUser) {
      setVerificationNotice(null);
      setIsVerifiedUser(false);
      setIsAdmin(false);
      setSubjects([]);
      setSessions([]);
      setHabits([]);
      setPurchases([]);
      setBatchProgressList([]);
      setPaymentMethods([]);
      setStudents([]);
      setAuthReady(true);
      return;
    }

    const verified =
      Boolean(nextUser.emailVerified) || Boolean(nextUser.phoneNumber);
    setIsVerifiedUser(verified);
    if (verified) {
      setVerificationNotice(null);
    }

    // Check Admin privileges cleanly (email-based admin strictly requires verified email)
    let adminFlag =
      Boolean(nextUser.emailVerified) &&
      nextUser.email === ADMIN_BOOTSTRAP_EMAIL;

    if (!adminFlag && verified) {
      try {
        const adminSnap = await getDoc(doc(db, 'admins', nextUser.uid));
        if (adminSnap.exists()) {
          adminFlag = true;
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `admins/${nextUser.uid}`);
      }
    }

    setIsAdmin(adminFlag);
    setAuthReady(true);

    // Initialize brand-new verified user profile + starter subjects/habits once
    if (verified) {
      try {
        const userSnap = await getDoc(doc(db, 'users', nextUser.uid));
        const isNewUser = !userSnap.exists();
        await ensureUserProfile(nextUser);
        if (isNewUser) {
          await seedStarterSubjectsAndHabits(nextUser.uid);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${nextUser.uid}`);
      }
    }
  }, []);

  // Auth & ID token listener (captures sign-in, sign-out, linkWithCredential, and token refreshes)
  useEffect(() => {
    const unsub = onIdTokenChanged(auth, (nextUser) => {
      void syncUserSession(nextUser);
    });

    return () => unsub();
  }, [syncUserSession]);

  // Public catalog listener: show all published batches even before sign-in
  useEffect(() => {
    if (!authReady) return;

    setLoadingBatches(true);
    const batchesQuery = isAdmin
      ? query(collection(db, 'batches'))
      : query(collection(db, 'batches'), where('isPublished', '==', true));

    const unsubBatches = onSnapshot(
      batchesQuery,
      (snap) => {
        const items: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Batch, 'id'>),
        }));
        items.sort((a, b) => a.title.localeCompare(b.title));
        setBatches(items);
        setLoadingBatches(false);
      },
      (err) => {
        setLoadingBatches(false);
        handleFirestoreError(err, OperationType.LIST, 'batches');
      }
    );

    return () => {
      unsubBatches();
    };
  }, [authReady, isAdmin]);

  // Attach user-scoped Firestore listeners ONLY when authReady && verified user
  useEffect(() => {
    if (!authReady || !user || !isVerifiedUser) {
      setLoadingUserData(false);
      return;
    }

    setLoadingUserData(true);

    const unsubSubjects = onSnapshot(
      query(collection(db, 'subjects'), where('userId', '==', user.uid)),
      (snap) => {
        const items: Subject[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Subject, 'id'>),
        }));
        items.sort((a, b) => a.name.localeCompare(b.name));
        setSubjects(items);
        setLoadingUserData(false);
      },
      (err) => {
        setLoadingUserData(false);
        handleFirestoreError(err, OperationType.LIST, 'subjects');
      }
    );

    const unsubSessions = onSnapshot(
      query(collection(db, 'studySessions'), where('userId', '==', user.uid)),
      (snap) => {
        const items: StudySession[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StudySession, 'id'>),
        }));
        items.sort((a, b) => {
          const ta = a.completedAt ? a.completedAt.toMillis() : 0;
          const tb = b.completedAt ? b.completedAt.toMillis() : 0;
          return tb - ta;
        });
        setSessions(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'studySessions');
      }
    );

    const unsubHabits = onSnapshot(
      query(collection(db, 'habits'), where('userId', '==', user.uid)),
      (snap) => {
        const items: Habit[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<Habit, 'id'>),
        }));
        items.sort((a, b) => a.title.localeCompare(b.title));
        setHabits(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'habits');
      }
    );

    const purchasesQuery = isAdmin
      ? query(collection(db, 'purchases'))
      : query(collection(db, 'purchases'), where('userId', '==', user.uid));

    const unsubPurchases = onSnapshot(
      purchasesQuery,
      (snap) => {
        const items: BatchPurchase[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BatchPurchase, 'id'>),
        }));
        setPurchases(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'purchases');
      }
    );

    const paymentMethodsQuery = isAdmin
      ? query(collection(db, 'paymentMethods'))
      : query(collection(db, 'paymentMethods'), where('isActive', '==', true));

    const unsubPaymentMethods = onSnapshot(
      paymentMethodsQuery,
      (snap) => {
        const items: PaymentMethod[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PaymentMethod, 'id'>),
        }));
        items.sort((a, b) => {
          const ta = a.createdAt ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt ? b.createdAt.toMillis() : 0;
          return ta - tb;
        });
        setPaymentMethods(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'paymentMethods');
      }
    );

    const unsubBatchProgress = onSnapshot(
      query(collection(db, 'batchProgress'), where('userId', '==', user.uid)),
      (snap) => {
        const items: BatchProgress[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<BatchProgress, 'id'>),
        }));
        setBatchProgressList(items);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'batchProgress');
      }
    );

    let unsubStudents: (() => void) | null = null;
    if (isAdmin) {
      unsubStudents = onSnapshot(
        query(collection(db, 'users')),
        (snap) => {
          const items: UserProfile[] = snap.docs.map((d) => ({
            ...(d.data() as UserProfile),
            uid: d.id,
          }));
          items.sort((a, b) => a.displayName.localeCompare(b.displayName));
          setStudents(items);
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'users');
        }
      );
    } else {
      setStudents([]);
    }

    return () => {
      unsubSubjects();
      unsubSessions();
      unsubHabits();
      unsubPurchases();
      unsubPaymentMethods();
      unsubBatchProgress();
      if (unsubStudents) unsubStudents();
    };
  }, [authReady, user, isVerifiedUser, isAdmin]);

  async function handleSignOut() {
    await signOut(auth);
    setPendingEnrollBatchId(null);
    setRequestedOpenBatchId(null);
    setRequestedPurchaseBatchId(null);
    if (activeTab === 'admin') setActiveTab('batches');
  }

  async function handleResendVerification() {
    if (!user) return;
    setVerifyingAction(true);
    try {
      await sendEmailVerification(user);
      setVerificationNotice(`Verification link sent to ${user.email}. Check Inbox and Spam.`);
    } catch (err) {
      setVerificationNotice(
        err instanceof Error ? err.message : 'Unable to send verification email.'
      );
    } finally {
      setVerifyingAction(false);
    }
  }

  async function handleRefreshVerification() {
    if (!user) return;
    setVerifyingAction(true);
    try {
      await user.reload();
      await user.getIdToken(true);
      await syncUserSession(auth.currentUser);
      if (auth.currentUser && !auth.currentUser.emailVerified && !auth.currentUser.phoneNumber) {
        setVerificationNotice('Still awaiting verification. Click the inbox link or verify with Google.');
      }
    } finally {
      setVerifyingAction(false);
    }
  }

  async function handleVerifyWithGoogle() {
    setVerifyingAction(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await cred.user.reload();
      await cred.user.getIdToken(true);
      await syncUserSession(auth.currentUser);
    } catch (err) {
      setVerificationNotice(
        err instanceof Error ? err.message : 'Google verification did not complete.'
      );
    } finally {
      setVerifyingAction(false);
    }
  }

  const canVerifyWithGoogle = Boolean(
    user &&
      (user.email === ADMIN_BOOTSTRAP_EMAIL ||
        user.email?.toLowerCase().endsWith('@gmail.com') ||
        user.providerData.some((p) => p.providerId === 'google.com'))
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F5F9] text-[#0B1120] overflow-x-clip">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={user}
        isAdmin={isAdmin}
        onSignIn={() => setShowSignInModal(true)}
        onSignOut={() => void handleSignOut()}
      />

      {user && !isVerifiedUser && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-amber-950">
            <div className="flex items-center gap-2">
              <MailCheck className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                {user.email === ADMIN_BOOTSTRAP_EMAIL ? (
                  <>
                    Verify your administrator email (<strong>{user.email}</strong>) to unlock the Admin Console, batch creation, and study logs.
                  </>
                ) : (
                  <>
                    Verify your email address (<strong>{user.email}</strong>) via the link sent to your inbox to unlock study logs and batch purchases.
                  </>
                )}
                {verificationNotice && (
                  <span className="ml-2 font-medium text-emerald-800">
                    {verificationNotice}
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {canVerifyWithGoogle && (
                <button
                  type="button"
                  disabled={verifyingAction}
                  onClick={() => void handleVerifyWithGoogle()}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-medium whitespace-nowrap disabled:opacity-50"
                >
                  Verify with Google
                </button>
              )}
              <button
                type="button"
                disabled={verifyingAction}
                onClick={() => void handleResendVerification()}
                className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 rounded-md font-medium whitespace-nowrap disabled:opacity-50"
              >
                Resend Email
              </button>
              <button
                type="button"
                disabled={verifyingAction}
                onClick={() => void handleRefreshVerification()}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#0B1120] hover:bg-slate-800 text-white rounded-md font-medium whitespace-nowrap disabled:opacity-50"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh Status</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'logs' && (
          <SessionLogsView
            userId={user && isVerifiedUser ? user.uid : null}
            onRequireSignIn={() => setShowSignInModal(true)}
            onBrowseBatches={() => setActiveTab('batches')}
            onOpenBatch={(batchId) => {
              setRequestedOpenBatchId(batchId);
              setActiveTab('batches');
            }}
            onPurchaseBatch={(batchId) => {
              setRequestedPurchaseBatchId(batchId);
              setActiveTab('batches');
            }}
            subjects={subjects}
            sessions={sessions}
            habits={habits}
            batches={batches}
            purchases={purchases}
            batchProgressList={batchProgressList}
            loadingData={loadingUserData}
          />
        )}

        {activeTab === 'batches' && (
          <LectureBatchesView
            userId={user && isVerifiedUser ? user.uid : null}
            isAdmin={isAdmin}
            onRequireSignIn={(batchId) => {
              if (batchId) {
                setPendingEnrollBatchId(batchId);
              }
              setShowSignInModal(true);
            }}
            pendingEnrollBatchId={pendingEnrollBatchId}
            onClearPendingEnroll={() => setPendingEnrollBatchId(null)}
            requestedOpenBatchId={requestedOpenBatchId}
            onClearRequestedOpenBatch={() => setRequestedOpenBatchId(null)}
            requestedPurchaseBatchId={requestedPurchaseBatchId}
            onClearRequestedPurchaseBatch={() => setRequestedPurchaseBatchId(null)}
            batches={batches}
            purchases={purchases}
            batchProgressList={batchProgressList}
            paymentMethods={paymentMethods}
            loadingBatches={loadingBatches}
          />
        )}

        {activeTab === 'admin' && isAdmin && user && (
          <AdminConsoleView
            adminUid={user.uid}
            batches={batches}
            purchases={purchases}
            paymentMethods={paymentMethods}
            students={students}
            onAuthRefresh={async () => {
              await syncUserSession(auth.currentUser);
            }}
          />
        )}

        {activeTab === 'admin' && !isAdmin && authReady && (
          <section className="max-w-[720px] mx-auto px-6 py-16">
            <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-800">
                <ShieldAlert className="w-4 h-4" />
                <span>Admin Verification Required</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">
                {user && !isVerifiedUser
                  ? 'Verify your admin email to create batches'
                  : 'Sign in with a verified administrator account'}
              </h1>
              <p className="text-sm text-slate-600">
                {user && !isVerifiedUser
                  ? `You are signed in as ${user.email}, but Firebase Auth currently marks emailVerified as false. Firestore rules require a verified email token before creating academic batches or managing unlisted lectures.`
                  : 'Administrator privileges are restricted to verified admin accounts.'}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                {!user ? (
                  <button
                    type="button"
                    onClick={() => setShowSignInModal(true)}
                    className="px-4 py-2 bg-[#0B1120] hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
                  >
                    Sign in
                  </button>
                ) : !isVerifiedUser ? (
                  <>
                    {canVerifyWithGoogle && (
                      <button
                        type="button"
                        disabled={verifyingAction}
                        onClick={() => void handleVerifyWithGoogle()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                      >
                        Verify Instantly with Google
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={verifyingAction}
                      onClick={() => void handleResendVerification()}
                      className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg disabled:opacity-50"
                    >
                      Resend Verification Email
                    </button>
                    <button
                      type="button"
                      disabled={verifyingAction}
                      onClick={() => void handleRefreshVerification()}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                    >
                      Refresh Status
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveTab('logs')}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg"
                  >
                    Return to Session Logs
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        onAuthSuccess={async () => {
          await syncUserSession(auth.currentUser);
        }}
      />

      <footer className="border-t border-slate-200/80 bg-white mt-14">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Cadence Study · Academic Focus & Cohort Lectures</span>
          {user && (
            <div className="flex flex-wrap items-center gap-2 max-w-full">
              <span className="font-mono truncate max-w-full sm:max-w-md">
                Signed in as {user.email || user.phoneNumber || 'User'} · UID: {user.uid}
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(user.uid);
                    setCopiedFooterUid(true);
                    window.setTimeout(() => setCopiedFooterUid(false), 1500);
                  } catch {
                    // Clipboard unavailable
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-medium transition-colors shrink-0"
              >
                {copiedFooterUid ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>Copied UID</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy UID</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CadenceApp />
    </ErrorBoundary>
  );
}
