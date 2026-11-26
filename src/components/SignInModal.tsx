import React, { useEffect, useRef, useState } from 'react';
import {
  ConfirmationResult,
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  ArrowLeft,
  KeyRound,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '@/src/lib/firebase';
import { ADMIN_BOOTSTRAP_EMAIL } from '@/src/types';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void | Promise<void>;
}

type AuthMethodTab = 'email' | 'phone' | 'admin';

function normalizePhoneNumber(raw: string): string {
  return raw.replace(/[\s()-]/g, '');
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
      return 'Incorrect email or password. If you previously signed in with Google, click "Send Password Setup Link" or sign in with Google and set a password in Admin Console.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Use "Sign in as Admin" or click "Send Password Setup Link" to set or reset your password.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/invalid-phone-number':
      return 'Enter a valid phone number including country code (e.g. +14155552671 or +919876543210).';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-verification-code':
      return 'The verification code does not match. Check the SMS code and try again.';
    case 'auth/code-expired':
      return 'That verification code expired. Request a new SMS code.';
    case 'auth/captcha-check-failed':
      return 'reCAPTCHA verification failed. Ensure this app domain is listed under Authorized Domains in Firebase Authentication.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Authentication. Add this app URL under Authentication -> Settings -> Authorized domains in the Firebase Console.';
    case 'auth/billing-not-enabled':
      return 'Real SMS verification requires Firebase Blaze billing, or you can add a free Test Phone Number inside Authentication -> Sign-in method -> Phone -> Phone numbers for testing.';
    default:
      return err instanceof Error ? err.message : 'Unable to complete sign-in.';
  }
}

export function SignInModal({ isOpen, onClose, onAuthSuccess }: SignInModalProps) {
  const [methodTab, setMethodTab] = useState<AuthMethodTab>('email');

  // Student Email/password state
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);

  // Admin login/setup state
  const [adminEmail, setAdminEmail] = useState(ADMIN_BOOTSTRAP_EMAIL);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminCreateMode, setAdminCreateMode] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  // Phone auth state
  const [phoneInput, setPhoneInput] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);
  const [loadingPhone, setLoadingPhone] = useState(false);

  // Google & feedback state
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!isOpen) {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      setConfirmationResult(null);
      setOtpCode('');
      setPassword('');
      setAdminPassword('');
      setErrorMsg(null);
      setInfoMsg(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    };
  }, []);

  if (!isOpen) return null;

  const isBusy = loadingGoogle || loadingEmail || loadingPhone || loadingAdmin;

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
    if (!cleanEmail || password.length < 6) {
      setErrorMsg('Enter a valid email and a password of at least 6 characters.');
      return;
    }

    setLoadingEmail(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
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

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    const cleanEmail = adminEmail.trim();
    if (!cleanEmail || adminPassword.length < 6) {
      setErrorMsg('Enter the admin email and a password of at least 6 characters.');
      return;
    }

    setLoadingAdmin(true);
    try {
      if (adminCreateMode) {
        const cred = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          adminPassword
        );
        await updateProfile(cred.user, { displayName: 'Administrator' });
        await sendEmailVerification(cred.user);
        await onAuthSuccess?.();
        onClose();
      } else {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, adminPassword);
        await cred.user.reload();
        await cred.user.getIdToken(true);
        await onAuthSuccess?.();
        onClose();
      }
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingAdmin(false);
    }
  }

  async function handlePasswordReset(targetEmail: string) {
    setErrorMsg(null);
    setInfoMsg(null);
    const cleanEmail = targetEmail.trim();
    if (!cleanEmail) {
      setErrorMsg('Enter an email address first so we can send a password setup/reset link.');
      return;
    }
    setLoadingEmail(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfoMsg(
        `If an Email & Password account exists for ${cleanEmail}, Firebase sent a reset link (check Spam/Promotions). If you normally use Google Sign-In or haven't created a password yet, sign in with Google and set your password in Admin Console, or use Create Account / Create Admin Password.`
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingEmail(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    const formatted = normalizePhoneNumber(phoneInput);
    if (!/^\+[1-9]\d{6,14}$/.test(formatted)) {
      setErrorMsg(
        'Include your country code starting with + (e.g., +14155552671 or +919876543210).'
      );
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoadingPhone(true);
    try {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      if (!recaptchaContainerRef.current) {
        throw new Error('Verification widget unavailable.');
      }

      const verifier = new RecaptchaVerifier(auth, recaptchaContainerRef.current, {
        size: 'invisible',
      });
      recaptchaVerifierRef.current = verifier;

      const result = await signInWithPhoneNumber(auth, formatted, verifier);
      setConfirmationResult(result);
    } catch (err) {
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingPhone(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmationResult) return;
    const cleanCode = otpCode.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setErrorMsg('Enter the 6-digit verification code sent to your phone.');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoadingPhone(true);
    try {
      await confirmationResult.confirm(cleanCode);
      await onAuthSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoadingPhone(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-modal-title"
      className="fixed inset-0 z-50 bg-slate-950/40 flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 id="signin-modal-title" className="text-lg font-bold text-slate-900">
              Sign in to Cadence Study
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Access your subject session logs, lecture batches, or admin console.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close sign in dialog"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700"
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

          {/* Option 1: Google Sign-In */}
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
            <span className="shrink-0 mx-3 text-xs text-slate-400">or</span>
            <div className="flex-grow border-t border-slate-200" />
          </div>

          {/* Method Switch: Email & Password | Phone Number | Admin */}
          <div
            role="tablist"
            aria-label="Sign-in method"
            className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {(
              [
                { id: 'email', label: 'Email' },
                { id: 'phone', label: 'Phone' },
                { id: 'admin', label: 'Admin Login' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={methodTab === tab.id}
                onClick={() => {
                  setMethodTab(tab.id);
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  methodTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Student Email & Password Form */}
          {methodTab === 'email' && (
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
                      maxLength={100}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Your name"
                      className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-600"
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
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-600"
                  />
                </div>
              </div>

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
                      className="text-xs text-blue-600 hover:underline"
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
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
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
                  onClick={() => {
                    setIsSignUp((v) => !v);
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="text-blue-600 font-medium hover:underline"
                >
                  {isSignUp ? 'Sign in instead' : 'Create an account'}
                </button>
              </p>
            </form>
          )}

          {/* Phone Number SMS OTP Form */}
          {methodTab === 'phone' && (
            <>
              {!confirmationResult ? (
                <form onSubmit={handleSendOtp} className="space-y-3">
                  <div>
                    <label
                      htmlFor="phone-number-input"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      Phone Number (with country code)
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="phone-number-input"
                        type="tel"
                        required
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="+1 415 555 2671"
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-600"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isBusy}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {loadingPhone ? 'Sending Code...' : 'Send Verification Code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Code sent to {normalizePhoneNumber(phoneInput)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmationResult(null);
                        setOtpCode('');
                        setErrorMsg(null);
                      }}
                      className="text-blue-600 hover:underline"
                    >
                      Change
                    </button>
                  </div>

                  <div>
                    <label
                      htmlFor="otp-code-input"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      6-Digit SMS Verification Code
                    </label>
                    <input
                      id="otp-code-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-base font-mono tracking-widest text-center text-slate-900 focus:outline-2 focus:outline-blue-600"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmationResult(null);
                        setOtpCode('');
                        setErrorMsg(null);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                    <button
                      type="submit"
                      disabled={isBusy}
                      className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {loadingPhone ? 'Verifying...' : 'Verify & Sign In'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* Dedicated Admin Login & Password Setup Tab */}
          {methodTab === 'admin' && (
            <form onSubmit={handleAdminSubmit} className="space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
                <KeyRound className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  {adminCreateMode
                    ? 'Create an Email & Password credential for your authorized admin email, or sign in with Google and link a password inside the Admin Console.'
                    : 'Sign in with your verified administrator email and password to manage batches and unlisted YouTube lectures.'}
                </span>
              </div>

              <div>
                <label
                  htmlFor="admin-email"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Admin Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="admin-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono text-slate-900 focus:outline-2 focus:outline-blue-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="admin-password"
                    className="block text-xs font-medium text-slate-700"
                  >
                    {adminCreateMode ? 'Choose Admin Password' : 'Admin Password'}
                  </label>
                  <button
                    type="button"
                    onClick={() => void handlePasswordReset(adminEmail)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Send Password Setup Link
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="admin-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={adminCreateMode ? 'new-password' : 'current-password'}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isBusy}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {loadingAdmin
                  ? adminCreateMode
                    ? 'Creating Admin Login...'
                    : 'Signing in...'
                  : adminCreateMode
                  ? 'Create Admin Login & Password'
                  : 'Sign in as Admin'}
              </button>

              <p className="text-center text-xs text-slate-600 pt-1">
                {adminCreateMode
                  ? 'Already set an admin password? '
                  : 'First time using email/password for admin? '}
                <button
                  type="button"
                  onClick={() => {
                    setAdminCreateMode((v) => !v);
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="text-blue-600 font-medium hover:underline"
                >
                  {adminCreateMode ? 'Sign in as Admin' : 'Create Admin Password'}
                </button>
              </p>
            </form>
          )}

          {/* Invisible reCAPTCHA anchor */}
          <div ref={recaptchaContainerRef} />
        </div>
      </div>
    </div>
  );
}
