import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  Lock,
  Mail,
  Phone,
  User as UserIcon,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '@/src/lib/firebase';
import { savePendingSignupPhone } from '@/src/lib/studyService';
import { VALIDATION_LIMITS } from '@/src/types';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void | Promise<void>;
}

type AuthMode = 'signin' | 'signup';

function isValidPhoneInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > VALIDATION_LIMITS.phoneNumberMax) return false;
  if (!/^[+\d][\d\s()-]{6,29}$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Authentication yet. Enable it in your Firebase Console (Authentication -> Sign-in method).';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. If you normally sign in with Google, click "Continue with Google" or use "Forgot password?" to set a password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in with Email or click "Forgot password?" to reset your password.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication. Add this app URL under Authentication -> Settings -> Authorized domains in the Firebase Console.';
    default:
      return err instanceof Error ? err.message : 'Unable to complete sign-in.';
  }
}

export function SignInModal({ isOpen, onClose, onAuthSuccess }: SignInModalProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('signin');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setErrorMsg(null);
      setInfoMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isSignUp = authMode === 'signup';
  const isBusy = loadingGoogle || loadingEmail;

  function switchAuthMode(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setErrorMsg(null);
    setInfoMsg(null);
  }

  async function handleGoogleSignIn() {
    setErrorMsg(null);
    setInfoMsg(null);
    setLoadingGoogle(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await cred.user.reload();
      await cred.user.getIdToken(true);
      await onAuthSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingGoogle(false);
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const cleanEmail = email.trim();
    const cleanName = fullName.trim();
    const cleanPhone = phoneNumber.trim();

    if (isSignUp) {
      if (!cleanName) {
        setErrorMsg('Please enter your full name.');
        return;
      }
      if (!isValidPhoneInput(cleanPhone)) {
        setErrorMsg('Please enter a valid phone number (at least 7 digits, e.g. +91 98765 43210).');
        return;
      }
    }

    if (!cleanEmail || password.length < 6) {
      setErrorMsg('Enter a valid email address and a password of at least 6 characters.');
      return;
    }

    setLoadingEmail(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        savePendingSignupPhone(cred.user.uid, cleanPhone);
        await updateProfile(cred.user, { displayName: cleanName });
        await sendEmailVerification(cred.user);
        await onAuthSuccess?.();
        onClose();
      } else {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        await cred.user.reload();
        await cred.user.getIdToken(true);
        await onAuthSuccess?.();
        onClose();
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handlePasswordReset(targetEmail: string) {
    setErrorMsg(null);
    setInfoMsg(null);
    const cleanEmail = targetEmail.trim();
    if (!cleanEmail) {
      setErrorMsg('Enter your email address first so we can send a password reset link.');
      return;
    }
    setLoadingEmail(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(
        `If an Email & Password account exists for ${cleanEmail}, Firebase sent a reset link (check Spam/Promotions). If you normally sign in with Google, click "Continue with Google" instead.`
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingEmail(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-modal-title"
      className="fixed inset-0 z-50 bg-[#0B1120]/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full max-h-[92dvh] overflow-y-auto my-auto p-5 sm:p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 id="signin-modal-title" className="text-lg font-bold text-[#0B1120]">
              {isSignUp ? 'Create New Account' : 'Sign in to Cadence Study'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isSignUp
                ? 'Register with your email and phone number to enroll in batches.'
                : 'Sign in through email or Google to access your batches and study logs.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close sign in dialog"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-1 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="pt-5 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 leading-relaxed">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 leading-relaxed">
              {infoMsg}
            </div>
          )}

          {/* Mode Switch: Sign In (Email) | Create Account */}
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {(
              [
                { id: 'signin', label: 'Sign In' },
                { id: 'signup', label: 'Create Account' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={authMode === tab.id}
                onClick={() => switchAuthMode(tab.id)}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  authMode === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Google Sign-In */}
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleGoogleSignIn()}
            className="w-full py-2.5 px-4 bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>{loadingGoogle ? 'Connecting Google...' : 'Continue with Google'}</span>
          </button>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-slate-200" />
            <span className="shrink-0 mx-3 text-xs text-slate-400">
              {isSignUp ? 'or register with email' : 'or sign in with email'}
            </span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            {isSignUp && (
              <div>
                <label
                  htmlFor="auth-fullname"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-fullname"
                    type="text"
                    required
                    maxLength={VALIDATION_LIMITS.displayNameMax}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-indigo-600"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-indigo-600"
                />
              </div>
            </div>

            {isSignUp && (
              <div>
                <label
                  htmlFor="auth-phone"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    maxLength={VALIDATION_LIMITS.phoneNumberMax}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-base sm:text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-indigo-600"
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-slate-700"
                >
                  Password
                </label>
                {!isSignUp && (
                  <button
                    type="button"
                    onClick={() => void handlePasswordReset(email)}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-indigo-600"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isBusy}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {loadingEmail
                ? isSignUp
                  ? 'Creating account...'
                  : 'Signing in...'
                : isSignUp
                ? 'Create Account'
                : 'Sign in with Email'}
            </button>

            <p className="text-center text-xs text-slate-600 pt-1">
              {isSignUp ? 'Already have an account? ' : 'New student? '}
              <button
                type="button"
                onClick={() => switchAuthMode(isSignUp ? 'signin' : 'signup')}
                className="text-indigo-600 font-medium hover:underline"
              >
                {isSignUp ? 'Sign in with Email' : 'Create an account'}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
